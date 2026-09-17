import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { FsError } from "@/lib/files";
import type { Codec, Rendition } from "@/lib/playback";
import { capabilities, describeAccelerator, type Accelerator } from "./accel";
import { CACHE_ROOT, FFMPEG, fileInput } from "./ffmpeg";
import { outputSize, type MediaInfo } from "./probe";

/*
 * On-the-fly HLS, seekable anywhere (the Jellyfin approach):
 *
 * - The playlist is generated up front from the duration: every segment is
 *   SEGMENT_SECONDS long, so seg-N always starts at N × SEGMENT_SECONDS.
 * - One ffmpeg job per session (a file at one codec and rendition) writes
 *   segments in order. Keyframes are forced on every boundary, so a job started
 *   at any N produces identical cuts — in every rendition, which is what lets the
 *   player switch between them mid-stream.
 * - A request for a segment the job will reach soon waits for it; a request far
 *   outside it kills the job and starts a new one at that segment.
 * - Each job tries GPU decode + GPU scale + GPU encode first, then CPU decode +
 *   GPU encode, then the CPU alone, falling down a tier whenever one fails.
 * - Renditions are H.264, or HEVC for browsers that decode it when a GPU encodes
 *   it. One playlist never mixes the two: a player cannot switch codecs mid-stream.
 */

export const SEGMENT_SECONDS = 4;

/**
 * Every job's timestamps start this far in. Without it, the job at 0 has its
 * negative B-frame decode times shifted forward (~0.1s) while later jobs do not,
 * leaving a seam wherever a restarted job meets segments from an earlier one.
 * Players anchor the first segment they load to the playlist, so the base
 * itself never shows.
 */
const TIMELINE_BASE_SECONDS = 10;

const MAX_JOBS = Math.max(1, Number(process.env.TRANSCODE_MAX_JOBS) || 2);
const IDLE_MS = Math.max(10, Number(process.env.TRANSCODE_IDLE_SECONDS) || 60) * 1000;
/** How many segments ahead of a running job a request may be before the job is restarted there. */
const LOOKAHEAD = 4;
/** A job pauses once it is this many segments past what the player last asked for. */
const MAX_AHEAD = 15;
/** SIGSTOP / SIGCONT; Windows has no equivalent, so jobs there simply run to the end. */
const CAN_PAUSE = process.platform !== "win32";
const WAIT_MS = 30_000;
const AUDIO_BITRATE = 160_000;

type Mode = "gpu" | "hybrid" | "cpu";

interface Tier {
  accelerator: Accelerator;
  mode: Mode;
  label: string;
}

interface Job {
  process: ChildProcess;
  tier: Tier;
  /** First segment this job writes. */
  start: number;
  /** First segment not yet on disk, at or after `start`. */
  next: number;
  exited: boolean;
  code: number | null;
  /** Stopped by us — not a failure. */
  killed: boolean;
  /** SIGSTOPped because it got far ahead of the player. */
  paused: boolean;
  stderr: string;
}

interface Session {
  key: string;
  /** The file at its current size and mtime; shared by all of its renditions. */
  source: string;
  dir: string;
  file: string;
  /** Path relative to the files root, for logs and status. */
  label: string;
  codec: Codec;
  quality: Rendition;
  info: MediaInfo;
  /** Output size as the playlist advertises it, and the shape the picture keeps. */
  width: number;
  height: number;
  /** Size the frames are encoded at: the output size, except for HEVC (see `hevcCodedSize`). */
  coded: { width: number; height: number };
  segmentCount: number;
  lastAccess: number;
  /** Segment index the player asked for most recently. */
  lastRequested: number;
  job: Job | null;
  starting: Promise<void> | null;
  /** Tiers that already failed on this file. */
  failed: Set<string>;
}

type Manager = { sessions: Map<string, Session> };
const store = globalThis as typeof globalThis & { __fbTranscode?: Manager };

function manager(): Manager {
  if (store.__fbTranscode) return store.__fbTranscode;
  const created: Manager = { sessions: new Map() };
  store.__fbTranscode = created;

  // Segments from a previous process are orphans: their jobs are gone.
  mkdirSync(CACHE_ROOT, { recursive: true });
  for (const entry of readdirSync(CACHE_ROOT)) {
    if (entry.startsWith("fb-")) removeDir(path.join(CACHE_ROOT, entry));
  }
  setInterval(() => {
    const now = Date.now();
    for (const [key, session] of created.sessions) {
      if (now - session.lastAccess > IDLE_MS) {
        dispose(session);
        created.sessions.delete(key);
      }
    }
  }, 10_000).unref();
  setInterval(() => created.sessions.forEach(throttle), 1_000).unref();
  process.once("exit", () => created.sessions.forEach(dispose));
  return created;
}

/**
 * Keeps a job from racing through a whole film nobody is watching: pause it
 * once it is well ahead of the player, resume it when the player catches up.
 */
function throttle(session: Session) {
  const job = session.job;
  if (!CAN_PAUSE || !job || job.exited) return;
  while (existsSync(segmentPath(session, job.next))) job.next++;
  const ahead = job.next - session.lastRequested;
  try {
    if (!job.paused && ahead > MAX_AHEAD) {
      job.process.kill("SIGSTOP");
      job.paused = true;
    } else if (job.paused && ahead <= MAX_AHEAD / 2) {
      job.process.kill("SIGCONT");
      job.paused = false;
    }
  } catch {
    // The process exited between the check and the signal.
  }
}

function removeDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps files of a just-killed process locked; the next start cleans up.
  }
}

function stop(job: Job) {
  if (job.exited) return;
  job.killed = true;
  job.process.kill("SIGKILL");
}

function dispose(session: Session) {
  if (session.job) stop(session.job);
  removeDir(session.dir);
}

/**
 * HEVC is encoded at the width divisible by 64 and the height divisible by 16
 * nearest the output size, and `-aspect` restores the shape. At any other size
 * AMD's VAAPI encoder (radeonsi) pads the frame to those multiples in the
 * parameter sets it writes into the stream but keeps ffmpeg's smaller crop, so
 * browsers show a stretched picture with a strip of padding: 854×480 plays as
 * 894×480, 1920×1080 as 1920×1088. Stripping those in-stream parameter sets
 * instead breaks decoding, since the slices were coded for the padded size.
 */
function hevcCodedSize(width: number, height: number) {
  return { width: Math.max(64, Math.round(width / 64) * 64), height: Math.max(16, Math.round(height / 16) * 16) };
}

export function openSession(file: string, label: string, stamp: string, info: MediaInfo, codec: Codec, quality: Rendition) {
  const { sessions } = manager();
  const source = `${file}\0${stamp}`;
  const key = createHash("sha1").update(`${source}\0${codec}\0${quality}`).digest("hex").slice(0, 16);
  let session = sessions.get(key);
  if (!session) {
    const { width, height } = outputSize(info, quality);
    session = {
      key,
      source,
      dir: path.join(CACHE_ROOT, `fb-${key}`),
      file,
      label,
      codec,
      quality,
      info,
      width,
      height,
      coded: codec === "hevc" ? hevcCodedSize(width, height) : { width, height },
      // A sliver after the last boundary may not become a segment of its own.
      segmentCount: Math.max(1, Math.ceil((info.duration - 0.25) / SEGMENT_SECONDS)),
      lastAccess: Date.now(),
      lastRequested: 0,
      job: null,
      starting: null,
      failed: new Set(),
    };
    mkdirSync(session.dir, { recursive: true });
    sessions.set(key, session);
  }
  session.lastAccess = Date.now();
  return session;
}

export type { Session };

/** RFC 6381 codec string: H.264 High or HEVC Main, at a level picked from the frame height. */
function videoCodec(codec: Codec, height: number) {
  if (codec === "hevc") {
    const level = height <= 720 ? 93 : height <= 1080 ? 123 : height <= 1440 ? 150 : 153;
    return `hvc1.1.6.L${level}.B0`;
  }
  const level = height <= 720 ? "1f" : height <= 1080 ? "28" : height <= 1440 ? "32" : "33";
  return `avc1.6400${level}`;
}

/**
 * Multivariant playlist with every rendition in one codec. The player builds its
 * quality menu from it and, on Auto, picks renditions by measured throughput and
 * player size. Switching mid-stream works because all renditions share segment
 * boundaries and timestamps: any rendition's seg-N follows any other's seg-(N-1).
 */
export function masterPlaylist(info: MediaInfo, codec: Codec, renditions: Rendition[]) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  const audio = info.audio ? AUDIO_BITRATE : 0;
  for (const rendition of renditions) {
    const { width, height } = outputSize(info, rendition);
    const { bitrate, maxrate } = rates(height, codec);
    const codecs = [videoCodec(codec, height), info.audio ? "mp4a.40.2" : null].filter(Boolean).join(",");
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${maxrate + audio},AVERAGE-BANDWIDTH=${bitrate + audio},RESOLUTION=${width}x${height},CODECS="${codecs}"`,
      `${codec}/${rendition}/index.m3u8`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function playlist(session: Session) {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS + 1}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    '#EXT-X-MAP:URI="init.mp4"',
  ];
  for (let index = 0; index < session.segmentCount; index++) {
    const last = index === session.segmentCount - 1;
    const length = last ? Math.max(0.1, session.info.duration - index * SEGMENT_SECONDS) : SEGMENT_SECONDS;
    lines.push(`#EXTINF:${length.toFixed(6)},`, `seg-${index}.m4s`);
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

const segmentPath = (session: Session, index: number) => path.join(session.dir, `seg-${index}.m4s`);

/** Resolves to the path of a finished segment, starting or moving the job as needed. */
export function waitForSegment(session: Session, index: number, signal: AbortSignal) {
  if (!Number.isInteger(index) || index < 0 || index >= session.segmentCount) {
    return Promise.reject(new FsError(404, "No such segment"));
  }
  const target = segmentPath(session, index);
  session.lastRequested = index;
  throttle(session);
  // `temp_file` makes ffmpeg write to .tmp and rename, so existence means complete.
  return waitFor(session, index, () => existsSync(target), target, signal);
}

export function waitForInit(session: Session, signal: AbortSignal) {
  const target = path.join(session.dir, "init.mp4");
  // init.mp4 is written before the first segment is finished; trust it once one is.
  const ready = () => existsSync(target) && readdirSync(session.dir).some((name) => name.endsWith(".m4s"));
  return waitFor(session, null, ready, target, signal);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(session: Session, index: number | null, ready: () => boolean, target: string, signal: AbortSignal) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    session.lastAccess = Date.now();
    if (ready()) return target;
    if (signal.aborted) throw new FsError(499, "Request aborted");
    if (Date.now() > deadline) throw new FsError(504, "Timed out waiting for the transcoder");
    await ensureJob(session, index);
    await sleep(100);
  }
}

/**
 * Where to start a job that only the init segment is waiting for. The player
 * fetches init.mp4 before any segment of a rendition, so this is a guess at the
 * segment that comes next: where this rendition left off, or — on a switch to a
 * rendition not yet played — the segment the player last asked for in the one it
 * left, which it asks for again in the new rendition. A guess one later made that
 * request fall before the job and restarted it; this one costs at most a segment
 * of extra work when the player moves on instead.
 */
function initStart(session: Session) {
  if (session.job) return session.lastRequested;
  const previous = [...manager().sessions.values()]
    .filter((other) => other !== session && other.source === session.source && other.codec === session.codec && other.job)
    .sort((a, b) => b.lastAccess - a.lastAccess)[0];
  return previous?.lastRequested ?? 0;
}

/** `index` null means any running job will do (the init segment). */
async function ensureJob(session: Session, index: number | null) {
  const job = session.job;
  if (job && !job.exited) {
    while (existsSync(segmentPath(session, job.next))) job.next++;
    if (index === null || (index >= job.start && index <= job.next + LOOKAHEAD)) return;
    stop(job);
  } else if (job && !job.killed) {
    if (job.code === 0 && index !== null && index >= job.next) {
      throw new FsError(404, "Segment is past the end of the stream");
    }
    // It ended without producing what is being waited for: that tier is out.
    if (job.code !== 0) session.failed.add(job.tier.label);
  }
  await start(session, index ?? initStart(session));
}

async function tiersFor(session: Session): Promise<Tier[]> {
  const { accelerators } = await capabilities();
  return accelerators.flatMap((accelerator): Tier[] => {
    // A playlist that promised HEVC cannot fall back to H.264, and only GPUs encode HEVC.
    if (session.codec === "hevc" && !accelerator.hevc) return [];
    if (accelerator.kind === "cpu") return [{ accelerator, mode: "cpu", label: "cpu" }];
    const tiers: Tier[] = [];
    // Autorotation inserts a CPU filter, which cannot take frames that stay on the GPU.
    if (accelerator.gpuScaler && !session.info.video?.rotated) {
      tiers.push({ accelerator, mode: "gpu", label: `${accelerator.kind}-gpu` });
    }
    tiers.push({ accelerator, mode: "hybrid", label: `${accelerator.kind}-hybrid` });
    return tiers;
  });
}

function start(session: Session, index: number) {
  session.starting ??= (async () => {
    const tier = (await tiersFor(session)).find((candidate) => !session.failed.has(candidate.label));
    if (!tier) throw new FsError(500, "Transcoding failed with every available encoder");

    // Keep concurrent jobs bounded: stop whichever other session was used least recently.
    const others = [...manager().sessions.values()]
      .filter((other) => other !== session && other.job && !other.job.exited)
      .sort((a, b) => a.lastAccess - b.lastAccess);
    while (others.length >= MAX_JOBS) stop(others.shift()!.job!);

    // Run inside the session directory: ffmpeg resolves the init segment's name
    // against its working directory, not against the segment path.
    const child = spawn(FFMPEG, buildArgs(session, tier, index), {
      cwd: session.dir,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    const job: Job = {
      process: child,
      tier,
      start: index,
      next: index,
      exited: false,
      code: null,
      killed: false,
      paused: false,
      stderr: "",
    };
    child.stderr?.on("data", (chunk) => (job.stderr = (job.stderr + chunk).slice(-4000)));
    const finish = (code: number | null) => {
      if (job.exited) return;
      job.exited = true;
      job.code = code;
      if (!job.killed && code !== 0) {
        const tail = job.stderr.trim().split("\n").slice(-3).join(" | ");
        console.error(`[transcode] ${tier.label} failed (exit ${code}) on ${session.label} at segment ${index}: ${tail}`);
      }
    };
    child.on("error", (error) => {
      job.stderr += String(error);
      finish(null);
    });
    child.on("close", finish);
    session.job = job;
    console.log(
      `[transcode] ${tier.label} (${describeAccelerator(tier.accelerator, session.codec)}) ${session.label} ${session.height}p from segment ${index}`,
    );
  })().finally(() => {
    session.starting = null;
  });
  return session.starting;
}

/**
 * Video bits per second: the target, the peak the encoder may reach, and its buffer.
 *
 * BANDWIDTH advertises the peak, and before it has measured anything the player
 * takes the tallest rung whose BANDWIDTH fits 85% of a 5 Mbps guess. A peak of
 * 1.15× the target keeps 720p H.264 (4.2 Mbps with audio) inside that, so
 * playback opens at 720p rather than 480p. HEVC gets 70% of H.264's bits.
 */
function rates(height: number, codec: Codec) {
  const mbps =
    (height <= 480 ? 1.5 : height <= 720 ? 3.5 : height <= 1080 ? 6 : height <= 1440 ? 10 : 16) * (codec === "hevc" ? 0.7 : 1);
  return {
    bitrate: Math.round(mbps * 1_000_000),
    maxrate: Math.round(mbps * 1_150_000),
    bufsize: Math.round(mbps * 2_000_000),
  };
}

function buildArgs(session: Session, tier: Tier, index: number) {
  const { accelerator, mode } = tier;
  const { width, height, coded, codec } = session;
  const offset = index * SEGMENT_SECONDS;
  const { bitrate, maxrate, bufsize } = rates(height, codec);
  const limits = ["-maxrate", String(maxrate), "-bufsize", String(bufsize)];
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y"];

  // Decoder.
  if (mode === "gpu" && accelerator.kind === "nvenc") args.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");
  if (mode === "gpu" && accelerator.kind === "vaapi") {
    args.push("-hwaccel", "vaapi", "-hwaccel_device", accelerator.device!, "-hwaccel_output_format", "vaapi");
  }
  if (mode === "hybrid" && accelerator.kind === "vaapi") args.push("-vaapi_device", accelerator.device!);
  if (offset > 0) args.push("-ss", String(offset));
  args.push("-i", fileInput(session.file), "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1");

  // Scaler. 10-bit sources are converted to 8-bit 4:2:0 here, which H.264 High and HEVC Main require.
  const filter = {
    "nvenc-gpu": `scale_cuda=${coded.width}:${coded.height}:format=yuv420p`,
    "nvenc-hybrid": `scale=${coded.width}:${coded.height},format=nv12`,
    "vaapi-gpu": `scale_vaapi=w=${coded.width}:h=${coded.height}:format=nv12`,
    "vaapi-hybrid": `scale=${coded.width}:${coded.height},format=nv12,hwupload`,
    cpu: `scale=${coded.width}:${coded.height},format=yuv420p`,
  }[tier.label];
  args.push("-vf", filter ?? `scale=${coded.width}:${coded.height},format=yuv420p`);

  // Encoder.
  const profile = codec === "hevc" ? "main" : "high";
  if (accelerator.kind === "nvenc") {
    const encoder = codec === "hevc" ? "hevc_nvenc" : "h264_nvenc";
    args.push("-c:v", encoder, "-preset", "p4", "-rc", "vbr", "-b:v", String(bitrate), ...limits, "-profile:v", profile, "-forced-idr", "1");
  } else if (accelerator.kind === "vaapi") {
    const encoder = codec === "hevc" ? "hevc_vaapi" : "h264_vaapi";
    args.push("-c:v", encoder, "-rc_mode", "VBR", "-b:v", String(bitrate), ...limits, "-profile:v", profile);
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", ...limits, "-profile:v", "high");
  }
  // Safari plays HEVC only when it is tagged hvc1; ffmpeg's mp4 muxer writes hev1 by default.
  // The pixel aspect ratio -aspect sets is what keeps an aligned coded size in shape.
  if (codec === "hevc") args.push("-tag:v", "hvc1", "-aspect", `${width}:${height}`);

  args.push(
    // A keyframe on every boundary, counted from this job's first frame.
    "-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    "-c:a", "aac", "-ac", "2", "-b:a", String(AUDIO_BITRATE),
    // Segment N decodes at BASE + N × SEGMENT_SECONDS no matter which job wrote it.
    "-output_ts_offset", String(offset + TIMELINE_BASE_SECONDS),
    "-f", "hls",
    "-hls_time", String(SEGMENT_SECONDS),
    "-hls_list_size", "0",
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4",
    "-hls_fmp4_init_filename", "init.mp4",
    // frag_discont writes that time into each segment's tfdt. Without it the mp4
    // muxer restarts tfdt at 0 and hides the offset in an edit list in init.mp4,
    // so segments from different jobs disagree about where they belong.
    "-hls_segment_options", "movflags=+frag_discont",
    "-hls_segment_filename", "seg-%d.m4s",
    "-start_number", String(index),
    "-hls_flags", "temp_file+independent_segments",
    "ffmpeg.m3u8",
  );
  return args;
}

export function activeJobs() {
  return [...manager().sessions.values()].map((session) => ({
    file: session.label,
    codec: session.codec,
    quality: session.quality,
    output: `${session.width}x${session.height}`,
    coded: `${session.coded.width}x${session.coded.height}`,
    segments: session.segmentCount,
    tier: session.job?.tier.label ?? null,
    encoder: session.job ? describeAccelerator(session.job.tier.accelerator, session.codec) : null,
    running: Boolean(session.job && !session.job.exited),
    paused: Boolean(session.job?.paused),
    lastRequested: session.lastRequested,
    start: session.job?.start ?? null,
    next: session.job?.next ?? null,
    failedTiers: [...session.failed],
    idleSeconds: Math.round((Date.now() - session.lastAccess) / 1000),
  }));
}
