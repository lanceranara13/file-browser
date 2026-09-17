import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { errorResponse, FsError } from "@/lib/files";
import { view } from "@/lib/hidden";
import { probeMedia } from "@/lib/media/probe";
import { sheet, storyboardFor, storyboardVtt, warm } from "@/lib/media/storyboard";
import { encodeSegments } from "@/lib/paths";

type Context = RouteContext<"/api/storyboard/[...path]">;

/**
 * `/api/storyboard/<file path…>/storyboard.vtt | sheet-N.jpg`
 *
 * Seek previews for a video. Sheet URLs in the VTT carry a version query that
 * changes whenever the file does.
 */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { path: parts } = await context.params;
    const resource = parts.at(-1) ?? "";
    const filePath = parts.slice(0, -1);
    const sheetName = /^sheet-(\d+)\.jpg$/.exec(resource);
    if (!filePath.length || (resource !== "storyboard.vtt" && !sheetName)) throw new FsError(404, "Not found");

    const seen = await view();
    const file = seen.resolve(filePath);
    const [stats, info] = await Promise.all([fs.stat(file), probeMedia(file)]);
    if (!stats.isFile() || !info?.video || !(info.duration > 0)) throw new FsError(415, "Not a video ffmpeg can read");
    // A hidden video's previews must not outlive a lock in the browser's cache.
    const hidden = seen.isHidden(file);

    const board = storyboardFor(file, `${stats.size}:${stats.mtimeMs}`, info);
    if (!sheetName) {
      // Opening the player is the cue to start cutting.
      warm(file, board);
      return new Response(storyboardVtt(board, info.duration, `/api/storyboard/${encodeSegments(filePath)}/`), {
        headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": hidden ? "private, no-store" : "no-cache" },
      });
    }

    const ready = await sheet(file, board, Number(sheetName[1]));
    const { size } = await fs.stat(ready);
    const stream = createReadStream(ready);
    request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
    const current = request.nextUrl.searchParams.get("v") === board.version;
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(size),
        "Cache-Control": hidden ? "private, no-store" : current ? "private, max-age=31536000, immutable" : "no-cache",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
