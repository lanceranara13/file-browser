"use client";

import { useState } from "react";
import { AudioIcon, KindIcon, VideoIcon } from "./icons";
import { hasThumbnail, thumbHref, type Entry } from "@/lib/paths";

/** Thumbnail URLs that had nothing to draw, so a folder visited again goes straight to the glyph. */
const failed = new Set<string>();

/**
 * A tile's square picture: the file's thumbnail once it has loaded, and its
 * kind's glyph until then — or for good, when there is nothing to draw. The
 * thumbnail is lazy, so only tiles near the screen ask the server for one.
 */
export function Thumbnail({
  segments,
  entry,
  glyph,
  badge,
}: {
  /** The entry's own path. */
  segments: readonly string[];
  entry: Entry;
  /** Glyph size in CSS pixels. */
  glyph: number;
  /** Mark a video or a song over its picture, so neither passes for a photo. */
  badge: boolean;
}) {
  const src = hasThumbnail(entry.kind) ? thumbHref(segments, entry) : null;
  // Keyed by URL: a file that changes while its tile is on screen starts over.
  const [result, setResult] = useState<{ src: string; loaded: boolean } | null>(null);
  const state = !src || failed.has(src) ? "failed" : result?.src !== src ? "loading" : result.loaded ? "loaded" : "failed";

  const settle = (loaded: boolean) => {
    if (!src || (result?.src === src && result.loaded === loaded)) return;
    if (!loaded) failed.add(src);
    setResult({ src, loaded });
  };

  const Badge = entry.kind === "video" ? VideoIcon : entry.kind === "audio" ? AudioIcon : null;
  return (
    <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-hairline bg-surface-1">
      {state !== "loaded" && (
        <KindIcon
          kind={entry.kind}
          width={glyph}
          height={glyph}
          // About 1.5px at any size, near the weight of the 16px glyphs.
          strokeWidth={24 / glyph}
          className={entry.kind === "folder" ? "text-ink-muted" : "text-ink-subtle"}
        />
      )}
      {src && state !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- already a small WebP; the image optimizer would cache hidden files past a lock.
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          // An image that finished before hydration fires no load event React sees.
          ref={(node) => {
            if (node?.complete) settle(node.naturalWidth > 0);
          }}
          onLoad={() => settle(true)}
          onError={() => settle(false)}
          className={`absolute inset-0 size-full object-contain transition-opacity duration-150 ease-out ${
            state === "loaded" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {badge && Badge && state === "loaded" && (
        <span className="absolute bottom-1.5 left-1.5 flex size-6 items-center justify-center rounded-xs border border-hairline bg-surface-2 text-ink-muted">
          <Badge />
        </span>
      )}
    </span>
  );
}
