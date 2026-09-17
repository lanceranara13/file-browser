import { Suspense } from "react";
import { Detail } from "./detail";
import { PlaybackSwitch } from "./playback-switch";
import { capabilities, describeAccelerator, offersHevc } from "@/lib/media/accel";
import type { Playback } from "@/lib/playback";

function formatMbps(bitsPerSecond: number) {
  const value = bitsPerSecond / 1_000_000;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} Mbps`;
}

export function PlaybackPanel({ playback }: { playback: Playback }) {
  const { source, renditions } = playback;
  return (
    <section>
      <h2 className="text-caption font-medium text-ink-subtle">Playback</h2>
      {/* The panel's one control: which stream plays swaps the player itself, so it cannot sit in the player's menu. */}
      {playback.switchable && <PlaybackSwitch mode={playback.mode} />}

      <dl className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-caption">
        {source && (
          <Detail label="Source" mono>
            {source.video} · {source.width}×{source.height}
            {source.audio ? ` · ${source.audio}` : ""}
            {source.bitrate ? ` · ${formatMbps(source.bitrate)}` : ""}
          </Detail>
        )}
        <Detail label="Mode" mono>
          {playback.mode === "direct" ? "direct" : "transcode"}
        </Detail>
        {renditions.length > 0 && (
          // Picked in the player's settings menu; listed here so the ladder is visible at a glance.
          <Detail label="Qualities" mono>
            {renditions.map(({ height }) => `${height}p`).join(" · ")}
          </Detail>
        )}
        {playback.reason === "unplayable" && playback.blocker && (
          <Detail label="Why">
            <span className="text-ink-subtle">Browsers can’t play </span>
            <span className="font-mono">{playback.blocker}</span>
          </Detail>
        )}
        {playback.reason === "bitrate" && source?.bitrate && playback.bitrateLimit && (
          <Detail label="Why">
            <span className="font-mono">{formatMbps(source.bitrate)}</span>
            <span className="text-ink-subtle"> is over the </span>
            <span className="font-mono">{formatMbps(playback.bitrateLimit)}</span>
            <span className="text-ink-subtle"> direct-play limit</span>
          </Detail>
        )}
        {playback.mode === "hls" && (
          <Suspense
            fallback={
              <Detail label="Encoder" mono>
                <span className="text-ink-tertiary">detecting…</span>
              </Detail>
            }
          >
            <EncoderDetails />
          </Suspense>
        )}
      </dl>
    </section>
  );
}

/** Hardware detection runs a few test encodes the first time; the panel must not wait for it. */
async function EncoderDetails() {
  const detected = await capabilities();
  if (!detected.ffmpeg) {
    return (
      <Detail label="Encoder">
        <span className="text-danger">ffmpeg not installed</span>
      </Detail>
    );
  }
  return (
    <>
      <Detail label="Codec">
        {offersHevc(detected) ? (
          <>
            <span className="font-mono">hevc</span>
            <span className="text-ink-subtle">, or </span>
            <span className="font-mono">h264</span>
            <span className="text-ink-subtle"> where the browser can’t decode HEVC</span>
          </>
        ) : (
          <span className="font-mono">h264</span>
        )}
      </Detail>
      <Detail label="Encoder" mono>
        {describeAccelerator(detected.accelerators[0])}
      </Detail>
    </>
  );
}
