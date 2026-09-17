import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FsError } from "@/lib/files";
import type { Kind } from "@/lib/paths";
import { run } from "@/lib/run";
import { capabilities } from "./accel";
import { CACHE_ROOT, FFMPEG, fileInput } from "./ffmpeg";
import { even, probeMedia } from "./probe";
import { gpuDecoder, type GpuDecoder } from "./storyboard";

/*
 * Thumbnails for the icon views: one small WebP per picture, video or song, cut
 * by ffmpeg the first time a browser asks for it and kept on disk after that.
 *
 * A picture is decoded and shrunk, with its EXIF orientation applied by ffmpeg.
 * A video gives the keyframe at or before a tenth of its length, decoded on the
 * GPU where the frame can be shrunk there too. A song gives its cover art.
 *
 * What ffmpeg cannot draw — a HEIC photo, a song without cover art — is kept as
 * a `.none` marker, so it costs one run rather than one per visit. A run that
 * could not happen at all (no ffmpeg, a timeout) leaves nothing behind and is
 * tried again next time.
 */

/** Longest side: one size for every view — sharp at 2x on small and medium tiles, about 1x on the largest. */
const SIZE = 384;
const DIR = path.join(CACHE_ROOT, "thumbs");
/** ffmpeg processes at once, across every thumbnail. A folder of photos queues rather than forking one each. */
const MAX_RUNNING = 2;
const TIMEOUT_MS = 30_000;
/** A thumbnail nobody has asked the server for in this long is deleted. Browsers keep their own copy meanwhile. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

const ENCODE = ["-c:v", "libwebp", "-quality", "75", "-f", "webp"];
/** Never upscaled; the filter keeps the aspect, and even sides keep the 4:2:0 encode exact. */
const STILL_FILTER = `scale=w='min(${SIZE},iw)':h='min(${SIZE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;

type State = {
  running: number;
  queue: (() => void)[];
  /** Draws under way, with the signal of every request waiting for each. */
  pending: Map<string, { drawn: Promise<string | null>; signals: (AbortSignal | undefined)[] }>;
  prunedAt: number;
};
const store = globalThis as typeof globalThis & { __fbThumbnails?: State };
const state: State = (store.__fbThumbnails ??= { running: 0, queue: [], pending: new Map(), prunedAt: 0 });

/**
 * Resolves to the path of a file's thumbnail, drawing it first if needed, or to
 * null when ffmpeg cannot draw one. `stamp` changes with the file. A draw is
 * dropped before it runs once every request waiting for it has been aborted.
 */
export function thumbnail(file: string, kind: Kind, stamp: string, signal?: AbortSignal): Promise<string | null> {
  const key = createHash("sha1").update([file, stamp, SIZE].join("\n")).digest("hex").slice(0, 20);
  const target = path.join(DIR, `${key}.webp`);
  const none = path.join(DIR, `${key}.none`);
  if (existsSync(target)) {
    touch(target);
    return Promise.resolve(target);
  }
  if (existsSync(none)) return Promise.resolve(null);
  const joined = state.pending.get(key);
  if (joined) {
    joined.signals.push(signal);
    return joined.drawn;
  }
  // One request leaving must not fail another that joined it: a tile scrolled
  // away and straight back asks again while the first request is still queued.
  const signals = [signal];
  const abandoned = () => signals.every((each) => each?.aborted);
  const drawn = draw(file, kind, target, none, abandoned).finally(() => state.pending.delete(key));
  state.pending.set(key, { drawn, signals });
  return drawn;
}

async function draw(file: string, kind: Kind, target: string, none: string, abandoned: () => boolean) {
  prune();
  mkdirSync(DIR, { recursive: true });
  const temp = `${target}.tmp`;
  try {
    const drawn = kind === "video" ? await drawVideo(file, temp, abandoned) : await drawStill(file, temp, abandoned);
    if (!drawn) {
      writeFileSync(none, "");
      return null;
    }
    renameSync(temp, target);
    return target;
  } finally {
    rmSync(temp, { force: true });
  }
}

/** A picture, or the cover art a song carries: either way the file's first video stream. A song without art has none. */
function drawStill(file: string, temp: string, abandoned: () => boolean) {
  return attempt(["-i", fileInput(file), "-map", "0:v:0", "-an", "-frames:v", "1", "-vf", STILL_FILTER], temp, abandoned);
}

async function drawVideo(file: string, temp: string, abandoned: () => boolean) {
  const info = await probeMedia(file);
  // ffprobe failing may only mean it was busy, so that is not remembered; a file it reads without a picture is.
  if (!info) throw new FsError(503, "Could not read the video");
  if (!info.video) return false;

  const scale = Math.min(1, SIZE / Math.max(info.video.width, info.video.height));
  const frame = { width: even(info.video.width * scale), height: even(info.video.height * scale), rotated: info.video.rotated };
  const gpu = gpuDecoder((await capabilities()).accelerators[0], frame);
  const args = (seconds: number, decoder: GpuDecoder | null) => [
    ...(decoder?.input ?? []),
    "-noaccurate_seek", "-ss", seconds.toFixed(3),
    "-i", fileInput(file),
    "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1",
    "-vf", decoder?.filter ?? `scale=${frame.width}:${frame.height}`,
  ];

  // A tenth of the way in is past most fades from black. A seek that finds no
  // frame there — a damaged stretch, a wrong duration — falls back to the start.
  for (const seconds of info.duration > 0 ? [info.duration / 10, 0] : [0]) {
    if (gpu && (await attempt(args(seconds, gpu), temp, abandoned))) return true;
    if (await attempt(args(seconds, null), temp, abandoned)) return true;
  }
  return false;
}

/**
 * One ffmpeg run under the limit. True when it wrote a frame, false when ffmpeg
 * would not; throws when it could not run at all, which says nothing about the file.
 */
async function attempt(args: string[], temp: string, abandoned: () => boolean) {
  const result = await limited(abandoned, () =>
    run(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args, ...ENCODE, fileInput(temp)], TIMEOUT_MS),
  );
  if (result.code === null) throw new FsError(503, "Could not draw a thumbnail");
  return result.code === 0 && (statSync(temp, { throwIfNoEntry: false })?.size ?? 0) > 0;
}

async function limited<T>(abandoned: () => boolean, task: () => Promise<T>) {
  await acquire();
  try {
    // Nobody is waiting for it any more: the page moved on while it queued.
    if (abandoned()) throw new FsError(499, "Cancelled");
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

function touch(file: string) {
  try {
    const now = new Date();
    utimesSync(file, now, now);
  } catch {
    // Pruned in the meantime; it is drawn again on the next request.
  }
}

function prune() {
  if (Date.now() - state.prunedAt < PRUNE_EVERY_MS) return;
  state.prunedAt = Date.now();
  try {
    for (const name of readdirSync(DIR)) {
      const file = path.join(DIR, name);
      const modified = statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? Date.now();
      if (Date.now() - modified > KEEP_MS) rmSync(file, { force: true });
    }
  } catch {
    // Nothing drawn yet.
  }
}
