import fs from "node:fs/promises";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Browser } from "@/components/browser";
import { FileView } from "@/components/file-view";
import { contentTypeOf, diskUsage, ensureRoot, kindOf, readTextPreview } from "@/lib/files";
import { view } from "@/lib/hidden";
import { planPlayback, probeMedia } from "@/lib/media/probe";
import { storyboardHref } from "@/lib/playback";
import { parsePrefs, PREFS_COOKIE } from "@/lib/prefs";

// Page params arrive still percent-encoded (`Mux%20sample.mp4`), unlike route
// handler params, which Next decodes. Malformed escapes are left as they are.
function decodeSegments(segments: string[] = []) {
  return segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: PageProps<"/files/[[...path]]">): Promise<Metadata> {
  const segments = decodeSegments((await params).path);
  return { title: segments.at(-1) ?? "Files" };
}

export default async function FilesPage({ params, searchParams }: PageProps<"/files/[[...path]]">) {
  // The listing is the disk at request time — never prerender it.
  await connection();
  // The cookie jar is the request's own headers, so reading the listing prefs costs nothing here.
  const [{ path }, query, seen, jar] = await Promise.all([params, searchParams, view(), cookies()]);
  const segments = decodeSegments(path);

  let target: string;
  try {
    // A hidden path is "not found" to a browser that has not unlocked it, like anything that isn't there.
    target = seen.resolve(segments);
  } catch {
    notFound();
  }
  await ensureRoot();

  // Whether the path is a folder or a file is unknown until stat resolves, so
  // both reads start together and the one that does not apply fails quietly.
  const name = segments.at(-1) ?? "";
  const kind = kindOf(name);
  // A video's codecs decide which player renders, so the probe is needed for
  // first paint and runs alongside the rest.
  const [stats, entries, storage, preview, media] = await Promise.all([
    fs.stat(target).catch(() => null),
    seen.list(target).catch(() => null),
    // One statfs, so it costs nothing beside the readdir and cannot lengthen the
    // critical path — which is why it is not a second round trip after paint.
    diskUsage(),
    segments.length && kind === "text" ? readTextPreview(target).catch(() => null) : null,
    segments.length && kind === "video" ? probeMedia(target) : null,
  ]);
  if (!stats) notFound();

  const lock = { state: seen.state, kind: seen.kind };
  if (stats.isDirectory()) {
    return (
      <Browser
        segments={segments}
        entries={entries ?? []}
        lock={lock}
        storage={storage}
        prefs={parsePrefs(jar.get(PREFS_COOKIE)?.value)}
      />
    );
  }

  // A video's mode can be picked on the page: `transcode=1` or `0` overrides the
  // server's choice, and `t` is the moment playback carries on from.
  const transcode = first(query.transcode);
  const start = Number(first(query.t));

  return (
    <FileView
      segments={segments}
      kind={kind}
      size={stats.size}
      modified={stats.mtimeMs}
      contentType={contentTypeOf(name)}
      preview={preview}
      playback={
        kind === "video" ? planPlayback(name, media, transcode === "1" ? "hls" : transcode === "0" ? "direct" : null) : null
      }
      // Previews are cut from the video by ffmpeg, so only offered for what ffprobe could read.
      storyboard={media?.video && media.duration > 0 ? storyboardHref(segments) : null}
      startAt={Number.isFinite(start) && start > 0 ? start : 0}
      lock={lock}
      hidden={seen.isHidden(target)}
      marked={seen.isMarked(target)}
    />
  );
}
