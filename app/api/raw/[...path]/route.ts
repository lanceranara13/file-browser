import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { contentTypeOf, errorResponse, FsError, kindOf } from "@/lib/files";
import { view } from "@/lib/hidden";

type Context = RouteContext<"/api/raw/[...path]">;

/** A single `bytes=` range, `"unsatisfiable"`, or null to send the whole file. */
function parseRange(header: string | null, size: number) {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  // Multi-range and malformed headers fall back to a full 200 response.
  if (!match || (!match[1] && !match[2])) return null;
  const [, startText, endText] = match;
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (suffix === 0) return "unsatisfiable" as const;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Math.min(Number(endText), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "unsatisfiable" as const;
  return { start, end };
}

/** Media, PDFs and raster images render as themselves; anything else that could run script is sandboxed. */
function isInlineSafe(name: string) {
  const kind = kindOf(name);
  if (kind === "video" || kind === "audio" || kind === "pdf") return true;
  return kind === "image" && !/\.svgz?$/i.test(name);
}

async function serve(request: NextRequest, context: Context, includeBody: boolean) {
  try {
    const { path: segments } = await context.params;
    const file = (await view()).resolve(segments);
    const stats = await fs.stat(file);
    if (!stats.isFile()) throw new FsError(400, "Not a file");

    const name = path.basename(file);
    const disposition = request.nextUrl.searchParams.has("download") ? "attachment" : "inline";
    const asciiName = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type": contentTypeOf(name),
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Last-Modified": stats.mtime.toUTCString(),
      ETag: etag,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (!isInlineSafe(name)) headers.set("Content-Security-Policy", "sandbox");

    if (!request.headers.has("range") && request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    const range = stats.size > 0 ? parseRange(request.headers.get("range"), stats.size) : null;
    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${stats.size}`);
      return new Response(null, { status: 416, headers });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? stats.size - 1;
    headers.set("Content-Length", String(stats.size === 0 ? 0 : end - start + 1));
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);

    let body: ReadableStream<Uint8Array> | null = null;
    if (includeBody && stats.size > 0) {
      const stream = createReadStream(file, { start, end });
      // Media elements cancel range requests constantly while seeking; close the
      // file handle on disconnect even if the response stream is never cancelled.
      request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
      body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    }
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export function GET(request: NextRequest, context: Context) {
  return serve(request, context, true);
}

export function HEAD(request: NextRequest, context: Context) {
  return serve(request, context, false);
}
