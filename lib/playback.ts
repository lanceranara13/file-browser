// Shared between server and client: no Node imports here.
import { encodeSegments } from "./paths";

/** Transcode rungs by output height, tallest first. A source is never upscaled. */
export const RENDITIONS = ["2160", "1440", "1080", "720", "480"] as const;
export type Rendition = (typeof RENDITIONS)[number];

export function isRendition(value: unknown): value is Rendition {
  return typeof value === "string" && (RENDITIONS as readonly string[]).includes(value);
}

/** Video codecs a transcode is encoded in. HEVC goes only to browsers that decode it, and only from a GPU. */
export const CODECS = ["h264", "hevc"] as const;
export type Codec = (typeof CODECS)[number];

export function isCodec(value: unknown): value is Codec {
  return typeof value === "string" && (CODECS as readonly string[]).includes(value);
}

/** What a browser is asked before it is sent HEVC: Main profile at level 4.1, as a 1080p rung declares. */
export const HEVC_PROBE_TYPE = 'video/mp4; codecs="hvc1.1.6.L123.B0"';

export interface Playback {
  /** `direct` streams the file itself; `hls` streams an on-the-fly transcode. */
  mode: "direct" | "hls";
  /** Browsers can play the original as it is, so the page offers both modes. */
  switchable: boolean;
  /**
   * Why the page transcodes: browsers cannot play the original, the original is
   * over the direct-play bitrate limit, or the viewer asked. Null for direct play.
   */
  reason: "unplayable" | "bitrate" | "chosen" | null;
  /** Output sizes the HLS stream offers, tallest first; empty for direct play. */
  renditions: { width: number; height: number }[];
  /** What stops a browser from playing the original, or null when nothing does. */
  blocker: string | null;
  /** Bits per second above which a playable original is transcoded anyway; null when there is no limit. */
  bitrateLimit: number | null;
  source: { video: string; width: number; height: number; audio: string | null; bitrate: number | null } | null;
}

/** Multivariant playlist of a video's transcode; the player switches renditions within it. */
export function hlsHref(segments: readonly string[], codec: Codec = "h264") {
  const query = codec === "h264" ? "" : `?codec=${codec}`;
  return `/api/hls/${encodeSegments(segments)}/master.m3u8${query}`;
}

/** WebVTT storyboard behind the time slider's seek previews. */
export function storyboardHref(segments: readonly string[]) {
  return `/api/storyboard/${encodeSegments(segments)}/storyboard.vtt`;
}
