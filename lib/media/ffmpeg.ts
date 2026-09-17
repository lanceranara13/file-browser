import os from "node:os";
import path from "node:path";

export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/** Scratch space: transcodes live in `fb-*` directories, seek-preview sheets in `sb-*`. */
export const CACHE_ROOT = path.resolve(
  /* turbopackIgnore: true */ process.env.TRANSCODE_DIR || path.join(os.tmpdir(), "file-browser-transcode"),
);

/**
 * ffmpeg reads `name:rest` as a protocol, so a file called `clip:1.mkv` would
 * not open. The explicit `file:` protocol makes every path literal.
 */
export const fileInput = (file: string) => `file:${file}`;
