"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Playback } from "@/lib/playback";
import { Segmented } from "./segmented";
import { playheadSeconds } from "./video-stage";

const OPTIONS = [
  { value: "direct", label: "Original" },
  { value: "hls", label: "Transcoded" },
] as const;

/**
 * Original or transcode, for a video browsers can play as it is. The pick goes
 * into the address (`transcode=1|0`) with the playhead (`t`), so the page renders
 * the other player and it carries on from the same moment.
 */
export function PlaybackSwitch({ mode }: { mode: Playback["mode"] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(next: Playback["mode"]) {
    if (next === mode) return;
    const query = new URLSearchParams({ transcode: next === "hls" ? "1" : "0" });
    const seconds = playheadSeconds();
    if (seconds >= 1) query.set("t", seconds.toFixed(1));
    // location.pathname stays percent-encoded, as the router expects.
    startTransition(() => router.replace(`${window.location.pathname}?${query}`, { scroll: false }));
  }

  return <Segmented label="Playback source" options={OPTIONS} value={mode} onChange={select} busy={pending} className="mt-3" />;
}
