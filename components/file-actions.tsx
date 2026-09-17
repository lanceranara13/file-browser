"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "./button";
import { DeleteDialog, MoveDialog, NameDialog } from "./entry-dialogs";
import {
  CheckIcon,
  DownloadIcon,
  ExternalIcon,
  ExtractIcon,
  EyeIcon,
  EyeOffIcon,
  LinkIcon,
  MoveIcon,
  PencilIcon,
  TrashIcon,
} from "./icons";
import { SecretDialog } from "./lock-dialogs";
import { useRevealed } from "./reveal";
import { copyText, deleteEntry, extractEntry, moveEntry, renameEntry, setEntryHidden } from "@/lib/api";
import type { LockInfo } from "@/lib/lock";
import { browseHref, isExtractable, rawHref } from "@/lib/paths";

export function FileActions({ segments, lock, marked }: { segments: string[]; lock: LockInfo; marked: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"rename" | "move" | "delete" | "setup" | null>(null);
  const [copied, setCopied] = useState(false);
  // Unpacking can run for minutes, so the button reports it rather than the page
  // looking as though nothing happened. A refusal has no dialog to land in.
  const [extracting, setExtracting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const revealed = useRevealed();
  // Same rule as a folder row's Hide: nothing here says hiding exists until the
  // top-bar gesture asks for it, or the browser has already unlocked.
  const canHide = lock.state === "unlocked" || (lock.state === "unset" && revealed);
  const name = segments.at(-1) ?? "";
  const parent = segments.slice(0, -1);

  async function copyLink() {
    await copyText(new URL(rawHref(segments), window.location.origin).href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function extract() {
    setProblem(null);
    setExtracting(true);
    try {
      router.push(browseHref(await extractEntry(segments)));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not unpack this archive");
      setExtracting(false);
    }
  }

  async function toggleHidden() {
    if (lock.state === "unset") return setDialog("setup");
    // A refusal means the unlock lapsed; the refresh shows the locked state either way.
    await setEntryHidden(segments, !marked).catch(() => {});
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2">
      <a href={rawHref(segments, true)} className={buttonClass("primary", "w-full")}>
        <DownloadIcon />
        Download
      </a>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={copyLink}>
          {copied ? <CheckIcon className="text-success" /> : <LinkIcon />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <a href={rawHref(segments)} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
          <ExternalIcon />
          Open raw
        </a>
      </div>
      {isExtractable(name) && (
        <Button className="w-full" onClick={() => void extract()} disabled={extracting}>
          <ExtractIcon />
          {extracting ? "Unpacking…" : "Unpack here"}
        </Button>
      )}
      {problem && (
        <p role="alert" className="font-mono text-caption text-danger [overflow-wrap:anywhere]">
          {problem}
        </p>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        <Button variant="ghost" onClick={() => setDialog("rename")}>
          <PencilIcon />
          Rename
        </Button>
        <Button variant="ghost" onClick={() => setDialog("move")}>
          <MoveIcon />
          Move
        </Button>
        {canHide && (
          <Button variant="ghost" onClick={() => void toggleHidden()}>
            {marked ? <EyeIcon /> : <EyeOffIcon />}
            {marked ? "Unhide" : "Hide"}
          </Button>
        )}
        <Button variant="ghost-danger" onClick={() => setDialog("delete")}>
          <TrashIcon />
          Delete
        </Button>
      </div>

      {dialog === "rename" && (
        <NameDialog
          title="Rename"
          initial={name}
          submitLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async (next) => {
            const renamed = await renameEntry(segments, next);
            setDialog(null);
            router.replace(browseHref(renamed));
          }}
        />
      )}
      {dialog === "move" && (
        <MoveDialog
          name={name}
          from={parent}
          onClose={() => setDialog(null)}
          onSubmit={async (to) => {
            const moved = await moveEntry(segments, to);
            setDialog(null);
            router.replace(browseHref(moved));
          }}
        />
      )}
      {dialog === "delete" && (
        <DeleteDialog
          name={name}
          isFolder={false}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await deleteEntry(segments);
            setDialog(null);
            router.replace(browseHref(parent));
          }}
        />
      )}
      {dialog === "setup" && (
        <SecretDialog
          current={null}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            await setEntryHidden(segments, true).catch(() => {});
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
