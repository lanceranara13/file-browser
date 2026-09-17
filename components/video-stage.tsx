"use client";

import "@videojs/react/video/skin.css";
import { useCallback, useSyncExternalStore, type CSSProperties } from "react";
import { HlsVideo } from "@videojs/react/media/hls-video";
import { Video, VideoPlayer, VideoSkin } from "@videojs/react/video";
import { rawHref } from "@/lib/paths";
import { HEVC_PROBE_TYPE, hlsHref } from "@/lib/playback";
import { useHydrated } from "./timestamp";

// Only the skin's documented custom properties — its internals are private.
const THEME = {
  "--media-accent-color": "#5e6ad2",
  "--media-accent-text-color": "#ffffff",
  "--media-border-color": "#23252a",
  "--media-border-radius": "12px",
  // next/font renames the family, so the skin's own "Inter" lookup would miss it.
  "--media-font-family": "var(--font-inter), system-ui, sans-serif",
  "--media-object-fit": "contain",
} as CSSProperties;

interface VideoStageProps {
  segments: string[];
  /** Stream the multivariant HLS transcode; otherwise the file is streamed as-is. */
  hls: boolean;
  /** WebVTT storyboard for the time slider's seek previews. */
  storyboard: string | null;
  /** Seconds to start from: where playback was before switching between the original and the transcode. */
  startAt: number;
}

const subscribe = () => () => {};

type TypeProbe = { isTypeSupported(type: string): boolean };
let hevcDecodable: boolean | undefined;

/**
 * Whether Media Source Extensions here decode HEVC: Safari, and Chrome or Edge
 * with a hardware decoder, but not Firefox on most systems. Like the HLS engine,
 * this falls back to ManagedMediaSource where there is no MediaSource (iPhone).
 */
function decodesHevc() {
  if (hevcDecodable === undefined) {
    const { MediaSource: mse, ManagedMediaSource: managed } = globalThis as unknown as Partial<
      Record<"MediaSource" | "ManagedMediaSource", TypeProbe>
    >;
    hevcDecodable = (mse ?? managed)?.isTypeSupported(HEVC_PROBE_TYPE) ?? false;
  }
  return hevcDecodable;
}

/** The page's video element, so controls outside the player can read the playhead. */
let current: HTMLVideoElement | null = null;

/** Seconds into the video on the page, or 0 without one. */
export function playheadSeconds() {
  return current?.currentTime ?? 0;
}

export function VideoStage({ segments, hls, storyboard, startAt }: VideoStageProps) {
  const hydrated = useHydrated();
  const hevc = useSyncExternalStore(subscribe, decodesHevc, () => false);
  const src = rawHref(segments);

  // The HLS engine resolves init and segment URIs with `new URL(uri, playlistUrl)`,
  // which throws on a relative playlist URL, and it also starts fetching during
  // server rendering, where there is no origin. So it gets an absolute URL, and
  // only once running in the browser — which is also when the codec is known.
  const hlsSrc = hls && hydrated ? new URL(hlsHref(segments, hevc ? "hevc" : "h264"), window.location.href).href : undefined;
  // The skin's time slider reads a metadata track labeled "thumbnails"; `default`
  // is what makes the browser load its cues at all.
  const previews = storyboard ? <track kind="metadata" label="thumbnails" src={storyboard} default /> : null;

  const attach = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) {
        current = null;
        return;
      }
      current = video;
      const seek = () => {
        if (startAt > 0) video.currentTime = startAt;
        // `t` has done its job; without it, a reload later starts from the top.
        const url = new URL(window.location.href);
        if (!url.searchParams.has("t")) return;
        url.searchParams.delete("t");
        window.history.replaceState(null, "", url);
      };
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
      else video.addEventListener("loadedmetadata", seek, { once: true });
      return () => {
        video.removeEventListener("loadedmetadata", seek);
        if (current === video) current = null;
      };
    },
    [startAt],
  );

  return (
    // Keyed so another file, or the other mode, starts a fresh player and media
    // element. Not keyed on the codec, which is settled right after hydration.
    <VideoPlayer key={`${hls ? "hls" : "direct"}:${src}`}>
      <VideoSkin className="size-full bg-black" style={THEME}>
        {hls ? (
          // The skin's settings menu offers the playlist's renditions as Quality, with Auto first.
          <HlsVideo ref={attach} src={hlsSrc} streamType="on-demand" playsInline preload="metadata">
            {previews}
          </HlsVideo>
        ) : (
          <Video ref={attach} src={src} playsInline preload="metadata">
            {previews}
          </Video>
        )}
      </VideoSkin>
    </VideoPlayer>
  );
}
