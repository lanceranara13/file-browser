"use client";

import "@videojs/react/audio/skin.css";
import type { CSSProperties } from "react";
import { Audio, AudioPlayer, AudioSkin } from "@videojs/react/audio";

const THEME = {
  "--media-accent-color": "#5e6ad2",
  "--media-accent-text-color": "#ffffff",
  "--media-border-color": "#23252a",
  "--media-border-radius": "12px",
  "--media-font-family": "var(--font-inter), system-ui, sans-serif",
} as CSSProperties;

export function AudioStage({ src }: { src: string }) {
  return (
    <AudioPlayer>
      <AudioSkin className="w-full" style={THEME}>
        <Audio src={src} preload="metadata" />
      </AudioSkin>
    </AudioPlayer>
  );
}
