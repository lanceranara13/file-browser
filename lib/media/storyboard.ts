import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import path from "node:path";
import { FsError } from "@/lib/files";
import { run } from "@/lib/run";
import { capabilities, type Accelerator } from "./accel";
import { CACHE_ROOT, FFMPEG, fileInput } from "./ffmpeg";
import { even, type MediaInfo } from "./probe";

/*
 * Seek previews: a WebVTT track whose cues point into sprite sheets of small
 * frames, which the player's time slider shows under the pointer.
 *
 * The VTT follows from the duration alone, so it is served at once. A sheet is
 * cut the first time it is needed, then kept: one short ffmpeg run per preview
 * decodes a single keyframe — on the GPU when there is one — and a last run
 * tiles them. So a preview shows the keyframe at or before its time, and a sheet
 * of 4K HEVC takes seconds rather than a full decode.
 */

const COLUMNS = 10;
const ROWS = 10;
const PER_SHEET = COLUMNS * ROWS;
/** Longest side of one preview. The skin shows them at up to 192 CSS pixels. */
const THUMB_SIZE = 240;
/** About this many previews per video, but never closer together than MIN_INTERVAL seconds. */
const TARGET_PREVIEWS = 300;
const MIN_INTERVAL = 2;
/** ffmpeg processes at once, across every storyboard. */
const MAX_RUNNING = 3;
const CELL_TIMEOUT_MS = 30_000;
/** Sheets survive restarts; a storyboard nobody has opened for this long is deleted. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

export interface Storyboard {
  dir: string;
  /** Changes with the file, so sheet URLs carrying it can be cached for good. */
  version: string;
  /** Seconds between previews. */
  interval: number;
  count: number;
  sheets: number;
  width: number;
  height: number;
  /** Rotated footage is autorotated by a CPU filter, which cannot take GPU frames. */
  rotated: boolean;
}

type State = {
  running: number;
  queue: (() => void)[];
  pending: Map<string, Promise<string>>;
  warming: Set<string>;
  /** Storyboards whose previews the GPU failed to cut and the CPU did not. */
  cpuOnly: Set<string>;
  prunedAt: number;
};
const store = globalThis as typeof globalThis & { __fbStoryboards?: State };
const state: State = (store.__fbStoryboards ??= {
  running: 0,
  queue: [],
  pending: new Map(),
  warming: new Set(),
  cpuOnly: new Set(),
  prunedAt: 0,
});

export function storyboardFor(file: string, stamp: string, info: MediaInfo): Storyboard {
  const version = createHash("sha1")
    .update([file, stamp, THUMB_SIZE, TARGET_PREVIEWS, MIN_INTERVAL].join("\n"))
    .digest("hex")
    .slice(0, 16);
  const interval = Math.max(MIN_INTERVAL, Math.ceil(info.duration / TARGET_PREVIEWS));
  const count = Math.max(1, Math.ceil(info.duration / interval));
  const source = info.video ?? { width: 16, height: 9 };
  const scale = THUMB_SIZE / Math.max(source.width, source.height);
  return {
    dir: path.join(CACHE_ROOT, `sb-${version}`),
    version,
    interval,
    count,
    sheets: Math.ceil(count / PER_SHEET),
    width: even(source.width * scale),
    height: even(source.height * scale),
    rotated: Boolean(info.video?.rotated),
  };
}

/**
 * `base` is the URL path the sheets are served under. Cue URLs are
 * root-relative because the player resolves relative ones against the track's
 * src only when it can find the <track> element — which it cannot for HLS media.
 */
export function storyboardVtt(board: Storyboard, duration: number, base: string) {
  const lines = ["WEBVTT", ""];
  for (let index = 0; index < board.count; index++) {
    const start = index * board.interval;
    const cell = index % PER_SHEET;
    const x = (cell % COLUMNS) * board.width;
    const y = Math.floor(cell / COLUMNS) * board.height;
    lines.push(
      `${vttTime(start)} --> ${vttTime(Math.min(duration, start + board.interval))}`,
      `${base}sheet-${Math.floor(index / PER_SHEET)}.jpg?v=${board.version}#xywh=${x},${y},${board.width},${board.height}`,
      "",
    );
  }
  return lines.join("\n");
}

function vttTime(seconds: number) {
  const ms = Math.round(seconds * 1000);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  const clock = [Math.floor(ms / 3_600_000), Math.floor(ms / 60_000) % 60, Math.floor(ms / 1000) % 60].map((part) => pad(part));
  return `${clock.join(":")}.${pad(ms % 1000, 3)}`;
}

/** Resolves to the path of a finished sheet, cutting it first if it is not on disk yet. */
export function sheet(file: string, board: Storyboard, index: number): Promise<string> {
  if (!Number.isInteger(index) || index < 0 || index >= board.sheets) {
    return Promise.reject(new FsError(404, "No such sheet"));
  }
  const target = path.join(board.dir, `sheet-${index}.jpg`);
  if (existsSync(target)) {
    touch(board.dir);
    return Promise.resolve(target);
  }
  let pending = state.pending.get(target);
  if (!pending) {
    pending = cut(file, board, index, target).finally(() => state.pending.delete(target));
    state.pending.set(target, pending);
  }
  return pending;
}

/** Cuts the sheets in order in the background, so they are ready before the pointer gets there. */
export function warm(file: string, board: Storyboard) {
  touch(board.dir);
  if (state.warming.has(board.dir)) return;
  state.warming.add(board.dir);
  void (async () => {
    for (let index = 0; index < board.sheets; index++) await sheet(file, board, index).catch(() => {});
  })().finally(() => state.warming.delete(board.dir));
}

export interface GpuDecoder {
  /** Input options that decode on the GPU. */
  input: string[];
  /** Shrinks the frame on the GPU and copies only the preview back. */
  filter: string;
}

/**
 * Decoding a preview on the GPU and shrinking it there takes well under half the
 * CPU's time for 4K (about 0.4s against 1s on a two-core VM). Only where frames
 * can be scaled on the GPU, and not for rotated video. Thumbnails use it too.
 */
export function gpuDecoder(
  accelerator: Accelerator | undefined,
  frame: Pick<Storyboard, "width" | "height" | "rotated">,
): GpuDecoder | null {
  if (!accelerator?.gpuScaler || frame.rotated) return null;
  const { width, height } = frame;
  if (accelerator.kind === "vaapi") {
    return {
      input: ["-hwaccel", "vaapi", "-hwaccel_device", accelerator.device!, "-hwaccel_output_format", "vaapi"],
      filter: `scale_vaapi=w=${width}:h=${height}:format=nv12,hwdownload,format=nv12`,
    };
  }
  if (accelerator.kind === "nvenc") {
    return {
      input: ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"],
      filter: `scale_cuda=${width}:${height}:format=nv12,hwdownload,format=nv12`,
    };
  }
  return null;
}

async function cut(file: string, board: Storyboard, index: number, target: string) {
  prune();
  const first = index * PER_SHEET;
  const cells = Math.min(PER_SHEET, board.count - first);
  const work = path.join(board.dir, `sheet-${index}-cells`);
  const cellPath = (cell: number) => path.join(work, `${String(cell).padStart(3, "0")}.jpg`);
  const gpu = gpuDecoder((await capabilities()).accelerators[0], board);
  mkdirSync(work, { recursive: true });
  try {
    // Every cell is its own short ffmpeg run: an inexact seek lands on the
    // keyframe at or before the cell's time, and that one frame is decoded.
    // Decoding only keyframes in a single pass (-skip_frame nokey) would be
    // cheaper, but HEVC then emits them out of order and drops some.
    const cellArgs = (cell: number, decoder: GpuDecoder | null) => [
      ...(decoder?.input ?? []),
      "-noaccurate_seek", "-ss", ((first + cell) * board.interval).toFixed(3),
      "-i", fileInput(file),
      "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1",
      "-vf", decoder?.filter ?? `scale=${board.width}:${board.height}`,
      "-q:v", "5", "-f", "image2", "-update", "1", fileInput(cellPath(cell)),
    ];
    const failures = await Promise.all(
      Array.from({ length: cells }, (_, cell) =>
        limited(async () => {
          const decoder = state.cpuOnly.has(board.dir) ? null : gpu;
          if (decoder && !(await ffmpeg(cellArgs(cell, decoder), CELL_TIMEOUT_MS)) && existsSync(cellPath(cell))) return null;
          const error = await ffmpeg(cellArgs(cell, null), CELL_TIMEOUT_MS);
          // The CPU cut what the GPU could not, so the GPU does not decode this file: stop asking it.
          if (decoder && !error && existsSync(cellPath(cell))) state.cpuOnly.add(board.dir);
          return error;
        }),
      ),
    );

    // A seek that yields no frame (a damaged stretch, the very end) repeats its neighbour.
    const firstFound = Array.from({ length: cells }, (_, cell) => cell).find((cell) => existsSync(cellPath(cell)));
    if (firstFound === undefined) {
      console.error(`[storyboard] sheet ${index} of ${file}: no frames (${failures.find(Boolean)})`);
      throw new FsError(500, "Could not cut seek previews");
    }
    for (let cell = 0; cell < cells; cell++) {
      if (!existsSync(cellPath(cell))) copyFileSync(cellPath(cell < firstFound ? firstFound : cell - 1), cellPath(cell));
    }

    const temp = `${target}.tmp`;
    const error = await limited(() =>
      ffmpeg(
        [
          "-framerate", "1", "-start_number", "0", "-i", fileInput(path.join(work, "%03d.jpg")),
          "-vf", `tile=${COLUMNS}x${Math.ceil(cells / COLUMNS)}`,
          "-frames:v", "1", "-q:v", "5", "-f", "image2", "-update", "1", fileInput(temp),
        ],
        CELL_TIMEOUT_MS,
      ),
    );
    if (error || !existsSync(temp)) {
      console.error(`[storyboard] sheet ${index} of ${file}: tiling failed (${error})`);
      throw new FsError(500, "Could not cut seek previews");
    }
    renameSync(temp, target);
    return target;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Runs ffmpeg; resolves to null on success, or to the tail of its error output. */
async function ffmpeg(args: string[], timeoutMs: number) {
  const result = await run(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args], timeoutMs);
  return result.code === 0 ? null : `exit ${result.code}: ${result.stderr.trim().split("\n").slice(-2).join(" | ")}`;
}

async function limited<T>(task: () => Promise<T>) {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}

function acquire() {
  if (state.running < MAX_RUNNING) {
    state.running++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => state.queue.push(resolve));
}

function release() {
  const next = state.queue.shift();
  if (next) next();
  else state.running--;
}

function touch(dir: string) {
  try {
    const now = new Date();
    utimesSync(dir, now, now);
  } catch {
    // Not cut yet.
  }
}

function prune() {
  if (Date.now() - state.prunedAt < PRUNE_EVERY_MS) return;
  state.prunedAt = Date.now();
  try {
    for (const entry of readdirSync(CACHE_ROOT)) {
      const dir = path.join(CACHE_ROOT, entry);
      if (entry.startsWith("sb-") && Date.now() - statSync(dir).mtimeMs > KEEP_MS) {
        rmSync(dir, { recursive: true, force: true });
        state.cpuOnly.delete(dir);
      }
    }
  } catch {
    // The cache root may not exist yet; nothing to prune.
  }
}
