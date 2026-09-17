import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { errorResponse, FsError } from "@/lib/files";
import { relativeSegments, view } from "@/lib/hidden";
import { capabilities, offersHevc } from "@/lib/media/accel";
import { playbackBlocker, probeMedia, renditionsFor } from "@/lib/media/probe";
import { masterPlaylist, openSession, playlist, waitForInit, waitForSegment } from "@/lib/media/transcode";
import { isCodec, isRendition } from "@/lib/playback";

type Context = RouteContext<"/api/hls/[...path]">;

const PLAYLIST_HEADERS = { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" };

/**
 * `/api/hls/<file path…>/master.m3u8` lists the renditions in H.264, or in HEVC
 * with `?codec=hevc` — which browsers that decode HEVC ask for, and which is
 * honored only when a GPU encodes it;
 * `/api/hls/<file path…>/<codec>/<rendition>/index.m3u8 | init.mp4 | seg-N.m4s` is one of them.
 *
 * Everything sits "inside" the file's path so the playlists can use plain
 * relative URIs.
 */
function parse(parts: string[]) {
  const resource = parts.at(-1) ?? "";
  if (resource === "master.m3u8") return { filePath: parts.slice(0, -1), resource, stream: null };
  const [codec, rendition] = parts.slice(-3, -1);
  if (parts.length < 4 || !isCodec(codec) || !isRendition(rendition)) return null;
  return { filePath: parts.slice(0, -3), resource, stream: { codec, rendition } };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const target = parse((await context.params).path);
    if (!target?.filePath.length) throw new FsError(404, "Not found");
    const { filePath, resource, stream } = target;

    const file = (await view()).resolve(filePath);
    const [stats, info, detected] = await Promise.all([fs.stat(file), probeMedia(file), capabilities()]);
    if (!stats.isFile() || !info?.video) throw new FsError(415, "Not a video ffmpeg can read");
    if (!detected.ffmpeg) throw new FsError(501, "ffmpeg is not installed on the server");

    const renditions = renditionsFor(info, !playbackBlocker(filePath.at(-1)!, info));
    const hevc = offersHevc(detected);
    if (!stream) {
      const codec = hevc && request.nextUrl.searchParams.get("codec") === "hevc" ? "hevc" : "h264";
      return new Response(masterPlaylist(info, codec, renditions), { headers: PLAYLIST_HEADERS });
    }
    if (!renditions.includes(stream.rendition) || (stream.codec === "hevc" && !hevc)) {
      throw new FsError(404, "No such rendition");
    }

    const stamp = `${stats.size}:${stats.mtimeMs}`;
    // The label is the resolved path, which is what the status endpoint judges hidden jobs by.
    const session = openSession(file, relativeSegments(file).join("/"), stamp, info, stream.codec, stream.rendition);
    if (resource === "index.m3u8") return new Response(playlist(session), { headers: PLAYLIST_HEADERS });

    const segment = /^seg-(\d+)\.m4s$/.exec(resource);
    const ready =
      resource === "init.mp4"
        ? await waitForInit(session, request.signal)
        : segment
          ? await waitForSegment(session, Number(segment[1]), request.signal)
          : null;
    if (!ready) throw new FsError(404, "Not found");

    const { size } = await fs.stat(ready);
    const stream_ = createReadStream(ready);
    request.signal.addEventListener("abort", () => stream_.destroy(), { once: true });
    return new Response(Readable.toWeb(stream_) as unknown as ReadableStream<Uint8Array>, {
      headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Cache-Control": "no-cache" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
