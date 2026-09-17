import { Suspense, type ReactNode } from "react";
import { ArchiveStage, ArchiveStagePending } from "./archive-stage";
import { AudioStage } from "./audio-stage";
import { buttonClass } from "./button";
import { PathHeader, TopBar } from "./chrome";
import { Detail } from "./detail";
import { FileActions } from "./file-actions";
import { DownloadIcon, KindIcon } from "./icons";
import { Kbd } from "./kbd";
import { LockControl } from "./lock-control";
import { PlaybackPanel } from "./playback-panel";
import { SiblingNav } from "./sibling-nav";
import { Timestamp } from "./timestamp";
import { VideoStage } from "./video-stage";
import { formatBytes } from "@/lib/format";
import type { LockInfo } from "@/lib/lock";
import { KIND_LABEL, rawHref, type Kind } from "@/lib/paths";
import type { Playback } from "@/lib/playback";

interface FileViewProps {
  segments: string[];
  kind: Kind;
  size: number;
  modified: number;
  contentType: string;
  preview: { text: string; truncated: boolean } | null;
  playback: Playback | null;
  /** WebVTT storyboard for a video's seek previews. */
  storyboard: string | null;
  /** Seconds into a video to start from. */
  startAt: number;
  lock: LockInfo;
  /** Hidden itself, or inside a hidden folder. */
  hidden: boolean;
  /** Hidden by name, so Unhide applies to it. */
  marked: boolean;
}

export function FileView({
  segments,
  kind,
  size,
  modified,
  contentType,
  preview,
  playback,
  storyboard,
  startAt,
  lock,
  hidden,
  marked,
}: FileViewProps) {
  return (
    <div className="flex h-full flex-col">
      <TopBar>
        <LockControl lock={lock} />
        <Suspense fallback={null}>
          <SiblingNav segments={segments} />
        </Suspense>
      </TopBar>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden">
        <section className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
          <PathHeader segments={segments} meta={`${KIND_LABEL[kind]} · ${formatBytes(size)}${hidden ? " · hidden" : ""}`} />
          <div className="h-[62dvh] min-h-[280px] shrink-0 px-4 pb-4 sm:px-6 sm:pb-6 lg:h-auto lg:min-h-0 lg:flex-1">
            <Stage
              segments={segments}
              kind={kind}
              size={size}
              preview={preview}
              playback={playback}
              storyboard={storyboard}
              startAt={startAt}
            />
          </div>
        </section>

        <aside className="shrink-0 border-t border-hairline lg:w-80 lg:overflow-auto lg:border-t-0 lg:border-l">
          <div className="flex flex-col gap-7 p-4 sm:p-6">
            <section>
              <h2 className="text-caption font-medium text-ink-subtle">Details</h2>
              <dl className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-caption">
                <Detail label="Kind">{KIND_LABEL[kind]}</Detail>
                <Detail label="Size" mono>
                  {formatBytes(size)}
                  <span className="text-ink-tertiary"> · {size.toLocaleString("en-US")} B</span>
                </Detail>
                <Detail label="Type" mono>
                  {contentType}
                </Detail>
                <Detail label="Modified" mono>
                  <Timestamp ms={modified} />
                </Detail>
                <Detail label="Path" mono>
                  /{segments.join("/")}
                </Detail>
              </dl>
            </section>

            {playback && <PlaybackPanel playback={playback} />}

            <FileActions segments={segments} lock={lock} marked={marked} />

            <section className="max-lg:hidden">
              <h2 className="text-caption font-medium text-ink-subtle">Keyboard</h2>
              <ul className="mt-3 flex flex-col gap-2 text-caption text-ink-subtle">
                <Shortcut keys={["J", "K"]}>Next / previous file</Shortcut>
                <Shortcut keys={["⌫"]}>Back to folder</Shortcut>
                <Shortcut keys={["D"]}>Download</Shortcut>
              </ul>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stage({
  segments,
  kind,
  size,
  preview,
  playback,
  storyboard,
  startAt,
}: Pick<FileViewProps, "segments" | "kind" | "size" | "preview" | "playback" | "storyboard" | "startAt">) {
  const name = segments.at(-1) ?? "";
  const src = rawHref(segments);

  if (kind === "video") {
    return <VideoStage segments={segments} hls={playback?.mode === "hls"} storyboard={storyboard} startAt={startAt} />;
  }

  if (kind === "audio") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-8 rounded-lg border border-hairline bg-surface-1 p-6">
        <KindIcon kind="audio" width={40} height={40} className="text-ink-tertiary" />
        <div className="w-full max-w-xl">
          <AudioStage src={src} />
        </div>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className="checkerboard flex h-full items-center justify-center overflow-hidden rounded-lg border border-hairline p-4">
        {/* A plain <img>: the file is already served from this origin at its original size. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  if (kind === "pdf") {
    return <iframe src={src} title={name} className="size-full rounded-lg border border-hairline bg-surface-1" />;
  }

  if (kind === "archive") {
    return (
      <Suspense fallback={<ArchiveStagePending />}>
        <ArchiveStage segments={segments} />
      </Suspense>
    );
  }

  if (kind === "text" && preview) {
    const lines = preview.text.split(/\r?\n/);
    if (lines.length > 1 && lines.at(-1) === "") lines.pop();
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-hairline bg-surface-1">
        <div className="min-h-0 flex-1 overflow-auto">
          <pre className="code-lines w-max min-w-full py-4 font-mono text-code text-ink-muted">
            {lines.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </pre>
        </div>
        {preview.truncated && (
          <p className="border-t border-hairline px-4 py-2 font-mono text-caption text-ink-subtle">
            Showing the first 512 KB. Download the file for the rest.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border border-hairline bg-surface-1 p-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-ink-subtle">
        <KindIcon kind={kind} width={24} height={24} />
      </span>
      <p className="text-body text-ink-subtle">No preview for this kind of file.</p>
      <a href={rawHref(segments, true)} className={buttonClass("primary")}>
        <DownloadIcon />
        Download · {formatBytes(size)}
      </a>
    </div>
  );
}

function Shortcut({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3">
      {children}
      <span className="flex gap-1">
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </span>
    </li>
  );
}
