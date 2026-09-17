import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { errorResponse, FsError, kindOf } from "@/lib/files";
import { view } from "@/lib/hidden";
import { thumbnail } from "@/lib/media/thumbnail";
import { hasThumbnail, thumbVersion } from "@/lib/paths";

type Context = RouteContext<"/api/thumb/[...path]">;

/**
 * `/api/thumb/<file path…>?v=<version>`
 *
 * A small WebP of a picture, a video or a song's cover art, for the icon views.
 * 404 when there is nothing to draw, which the page answers with the kind's
 * glyph. The version changes with the file, so a current URL is cached for good.
 */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { path: segments } = await context.params;
    const seen = await view();
    const file = seen.resolve(segments);
    const stats = await fs.stat(file);
    const kind = kindOf(path.basename(file));
    if (!stats.isFile() || !hasThumbnail(kind)) throw new FsError(404, "No thumbnail");

    // A hidden file's thumbnail must not outlive a lock in the browser's cache.
    const current = request.nextUrl.searchParams.get("v") === thumbVersion(stats.size, stats.mtimeMs);
    const cacheControl = seen.isHidden(file)
      ? "private, no-store"
      : current
        ? "private, max-age=31536000, immutable"
        : "no-cache";

    const drawn = await thumbnail(file, kind, `${stats.size}:${stats.mtimeMs}`, request.signal);
    if (!drawn) {
      return Response.json({ error: "No thumbnail" }, { status: 404, headers: { "Cache-Control": cacheControl } });
    }
    const { size } = await fs.stat(drawn);
    const stream = createReadStream(drawn);
    request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(size),
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
