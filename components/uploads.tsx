"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { IconButton } from "./button";
import { CheckIcon, CloseIcon } from "./icons";
import { formatBytes } from "@/lib/format";
import { fsHref } from "@/lib/paths";

export interface UploadRequest {
  file: File;
  /** Path below the destination folder, ending with the file name. */
  path: string[];
}

interface UploadItem {
  id: number;
  label: string;
  loaded: number;
  total: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

interface Job {
  id: number;
  url: string;
  file: File;
}

const CONCURRENCY = 3;

// Plain closures rather than hooks: the queue outlives renders and must not
// restart when the component re-renders on every progress event.
function createUploader(setItems: Dispatch<SetStateAction<UploadItem[]>>) {
  const queue: Job[] = [];
  let active = 0;
  let onIdle = () => {};
  let nextId = 0; // not crypto.randomUUID(): that needs a secure context, and LAN http is not one

  const patch = (id: number, change: Partial<UploadItem>) =>
    setItems((items) => items.map((item) => (item.id === id ? { ...item, ...change } : item)));

  function send(job: Job) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", job.url);
      xhr.upload.onprogress = (event) => patch(job.id, { loaded: event.loaded });
      xhr.onload = () => {
        if (xhr.status < 300) return resolve();
        let message = `Upload failed (${xhr.status})`;
        try {
          message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
        } catch {}
        reject(new Error(message));
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(job.file);
    });
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const job = queue.shift()!;
      active++;
      patch(job.id, { status: "uploading" });
      send(job)
        .then(
          () => patch(job.id, { status: "done", loaded: job.file.size }),
          (error: Error) => patch(job.id, { status: "error", error: error.message }),
        )
        .finally(() => {
          active--;
          if (!active && !queue.length) onIdle();
          pump();
        });
    }
  }

  return {
    enqueue(requests: UploadRequest[], destination: readonly string[]) {
      const jobs = requests.map(({ file, path }) => ({
        id: nextId++,
        url: fsHref([...destination, ...path]),
        file,
        label: [...destination, ...path].join("/"),
      }));
      setItems((items) => [
        ...items.filter((item) => item.status !== "done"),
        ...jobs.map((job) => ({ id: job.id, label: job.label, loaded: 0, total: job.file.size, status: "queued" as const })),
      ]);
      queue.push(...jobs);
      pump();
    },
    dismiss() {
      setItems((items) => items.filter((item) => item.status === "queued" || item.status === "uploading"));
    },
    /** Called once the queue drains. */
    setIdleHandler(handler: () => void) {
      onIdle = handler;
    },
  };
}

export function useUploads(onIdle: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [uploader] = useState(() => createUploader(setItems));
  useEffect(() => {
    uploader.setIdleHandler(onIdle);
  });
  return { items, enqueue: uploader.enqueue, dismiss: uploader.dismiss };
}

/** Walks dropped folders so their structure is recreated on the server. */
export async function collectDropped(dataTransfer: DataTransfer): Promise<UploadRequest[]> {
  // Entries must be read synchronously, before the drop event's data expires.
  const roots = [...dataTransfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!roots.length) return [...dataTransfer.files].map((file) => ({ file, path: [file.name] }));

  const requests: UploadRequest[] = [];
  async function walk(entry: FileSystemEntry, parents: string[]): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      requests.push({ file, path: [...parents, entry.name] });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most ~100 entries per call.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, [...parents, entry.name]);
    }
  }
  for (const root of roots) await walk(root, []);
  return requests;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function UploadTray({ items, onDismiss }: { items: UploadItem[]; onDismiss: () => void }) {
  if (!items.length) return null;

  const done = items.filter((item) => item.status === "done").length;
  const failed = items.filter((item) => item.status === "error").length;
  const active = items.length - done - failed;
  const loaded = items.reduce((sum, item) => sum + item.loaded, 0);
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const heading = active
    ? `Uploading ${plural(active, "file")}`
    : failed
      ? `${failed} failed · ${done} uploaded`
      : `${plural(done, "upload")} complete`;

  return (
    <section
      aria-live="polite"
      className="edge-lit fixed right-4 bottom-10 z-30 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-lg border border-hairline-strong bg-surface-2 sm:right-6"
    >
      <header className="flex h-10 items-center justify-between gap-3 border-b border-hairline pr-1.5 pl-3.5">
        <p className="text-button font-medium">{heading}</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-caption text-ink-subtle tabular">
            {formatBytes(loaded)} / {formatBytes(total)}
          </span>
          {active ? null : (
            <IconButton label="Dismiss" onClick={onDismiss}>
              <CloseIcon />
            </IconButton>
          )}
        </div>
      </header>
      <ul className="max-h-64 overflow-auto py-1">
        {items.map((item) => {
          const percent = item.total ? Math.round((item.loaded / item.total) * 100) : item.status === "done" ? 100 : 0;
          return (
            <li key={item.id} className="px-3.5 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-caption text-ink-muted" title={item.label}>
                  {item.label}
                </span>
                <span className="shrink-0 font-mono text-caption tabular">
                  {item.status === "done" ? (
                    <CheckIcon className="text-success" aria-label="Uploaded" />
                  ) : item.status === "error" ? (
                    <span className="text-danger" title={item.error}>
                      Failed
                    </span>
                  ) : item.status === "queued" ? (
                    <span className="text-ink-tertiary">Queued</span>
                  ) : (
                    <span className="text-ink-subtle">{percent}%</span>
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-hairline">
                <div
                  className={`h-full transition-[width] duration-150 ${
                    item.status === "done" ? "bg-success" : item.status === "error" ? "bg-danger" : "bg-accent"
                  }`}
                  style={{ width: `${item.status === "error" ? 100 : percent}%` }}
                />
              </div>
              {item.status === "error" && item.error && (
                <p className="mt-1 text-caption text-ink-subtle">{item.error}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
