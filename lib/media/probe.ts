import fs from "node:fs/promises";
import path from "node:path";
import { RENDITIONS, type Playback, type Rendition } from "@/lib/playback";
import { run } from "@/lib/run";
import { FFPROBE, fileInput } from "./ffmpeg";

export interface MediaInfo {
  /** Seconds. */
  duration: number;
  /** Bits per second across the whole file, or null when neither ffprobe nor the size can say. */
  bitrate: number | null;
  /** Width and height are as displayed, i.e. already swapped for rotated footage. */
  video: { codec: string; pixFmt: string | null; width: number; height: number; rotated: boolean } | null;
  audio: { codec: string } | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  duration?: string;
  disposition?: { attached_pic?: number };
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

type ProbeCache = Map<string, { stamp: string; info: Promise<MediaInfo | null> }>;
const store = globalThis as typeof globalThis & { __fbProbeCache?: ProbeCache };
const cache = (store.__fbProbeCache ??= new Map());

/** ffprobe, cached per file until its size or mtime changes. Null when it cannot be read. */
export async function probeMedia(file: string): Promise<MediaInfo | null> {
  const stats = await fs.stat(file).catch(() => null);
  if (!stats?.isFile()) return null;
  const stamp = `${stats.size}:${stats.mtimeMs}`;
  const cached = cache.get(file);
  if (cached?.stamp === stamp) return cached.info;

  const info = readInfo(file, stats.size);
  cache.set(file, { stamp, info });
  // Failures are not remembered: ffprobe may simply have been busy.
  void info.then((result) => {
    if (!result && cache.get(file)?.info === info) cache.delete(file);
  });
  if (cache.size > 1000) cache.delete(cache.keys().next().value as string);
  return info;
}

async function readInfo(file: string, size: number): Promise<MediaInfo | null> {
  const result = await run(
    FFPROBE,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", fileInput(file)],
    20_000,
  );
  if (result.code !== 0) return null;
  try {
    const data = JSON.parse(result.stdout) as {
      streams?: FfprobeStream[];
      format?: { duration?: string; bit_rate?: string };
    };
    const streams = data.streams ?? [];
    const video = streams.find((stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic);
    const audio = streams.find((stream) => stream.codec_type === "audio");
    const rotation =
      Math.abs(Number(video?.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0)) %
      180;
    const duration = Number(data.format?.duration ?? video?.duration ?? 0);
    const declared = Number(data.format?.bit_rate);
    return {
      duration: Number.isFinite(duration) ? duration : 0,
      // A container that leaves bit_rate out still has a size and a duration, which give the same average.
      bitrate: declared > 0 ? declared : duration > 0 ? Math.round((size * 8) / duration) : null,
      video:
        video?.codec_name && video.width && video.height
          ? {
              codec: video.codec_name,
              pixFmt: video.pix_fmt ?? null,
              width: rotation === 90 ? video.height : video.width,
              height: rotation === 90 ? video.width : video.height,
              rotated: rotation === 90,
            }
          : null,
      audio: audio?.codec_name ? { codec: audio.codec_name } : null,
    };
  } catch {
    return null;
  }
}

// What every current desktop and mobile browser decodes without plugins.
const DIRECT_CONTAINERS = new Set(["mp4", "m4v", "mov", "webm"]);
const DIRECT_VIDEO = new Set(["h264", "vp8", "vp9", "av1"]);
const DIRECT_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

/**
 * A file browsers could play as it is is still transcoded above this bitrate, so a
 * 4K original does not have to reach the viewer at full weight. The page offers
 * the original all the same. TRANSCODE_DIRECT_MAX_MBPS; 0 turns the limit off.
 */
const DIRECT_LIMIT_MBPS = Number(process.env.TRANSCODE_DIRECT_MAX_MBPS ?? 20);
const DIRECT_MAX_BITRATE = DIRECT_LIMIT_MBPS > 0 ? DIRECT_LIMIT_MBPS * 1_000_000 : null;

export function playbackBlocker(name: string, info: MediaInfo) {
  const extension = path.extname(name).slice(1).toLowerCase();
  if (!DIRECT_CONTAINERS.has(extension)) return `.${extension || "?"} container`;
  if (info.video && !DIRECT_VIDEO.has(info.video.codec)) return `${info.video.codec.toUpperCase()} video`;
  if (info.video?.pixFmt && !/^yuvj?420p$/.test(info.video.pixFmt)) return `${info.video.pixFmt} pixel format`;
  if (info.audio && !DIRECT_AUDIO.has(info.audio.codec)) return `${info.audio.codec.toUpperCase()} audio`;
  return null;
}

export const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** Output frame size for a rendition: never upscaled, aspect kept, both sides even. */
export function outputSize(info: MediaInfo, rendition: Rendition) {
  const source = info.video ?? { width: 1280, height: 720 };
  const height = even(Math.min(Number(rendition), source.height));
  return { width: even((source.width * height) / source.height), height };
}

/**
 * The rungs a source is offered at: every one up to its height, or the lowest for
 * a small source. A source browsers can play as it is goes without 2160p: the
 * original is on offer at that size already, and a 4K encode runs too close to
 * real time to share the GPU with a second job.
 */
export function renditionsFor(info: MediaInfo, playable: boolean): Rendition[] {
  const fitting = RENDITIONS.filter(
    (rendition) => Number(rendition) <= (info.video?.height ?? 0) && !(playable && rendition === "2160"),
  );
  return fitting.length ? fitting : [RENDITIONS.at(-1)!];
}

/**
 * Direct play unless something calls for the transcode: browsers cannot play the
 * file, it is over the bitrate limit, or the viewer asked. `requested` is the
 * viewer's pick, which only a file browsers cannot play overrides.
 */
export function planPlayback(name: string, info: MediaInfo | null, requested: Playback["mode"] | null): Playback {
  // Without ffprobe there is nothing to decide with; hand the browser the file.
  if (!info?.video) {
    return { mode: "direct", switchable: false, reason: null, renditions: [], blocker: null, bitrateLimit: null, source: null };
  }

  const blocker = playbackBlocker(name, info);
  let reason: Playback["reason"] = null;
  if (blocker) reason = "unplayable";
  else if (requested) reason = requested === "hls" ? "chosen" : null;
  else if (DIRECT_MAX_BITRATE !== null && (info.bitrate ?? 0) > DIRECT_MAX_BITRATE) reason = "bitrate";

  return {
    mode: reason ? "hls" : "direct",
    switchable: !blocker,
    reason,
    renditions: reason ? renditionsFor(info, !blocker).map((rendition) => outputSize(info, rendition)) : [],
    blocker,
    bitrateLimit: DIRECT_MAX_BITRATE,
    source: {
      video: info.video.codec,
      width: info.video.width,
      height: info.video.height,
      audio: info.audio?.codec ?? null,
      bitrate: info.bitrate,
    },
  };
}
