"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "./button";
import { formatPath, parsePath } from "@/lib/paths";

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  // No close() in a cleanup: under StrictMode the remount would receive the
  // queued close event and dismiss the dialog it just opened.
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="edge-lit m-auto w-[min(400px,calc(100vw-32px))] rounded-lg border border-hairline-strong bg-surface-2 p-0 text-ink"
    >
      <div className="p-5">
        <h2 className="text-dialog font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

export function NameDialog({
  title,
  initial,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Select the name without its extension, the way desktop file managers do.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dot = initial.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a name.");
    if (trimmed === initial) return onClose();
    setPending(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (failure) {
      setError((failure as Error).message);
      setPending(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="mt-4">
        <input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Name"
          aria-invalid={error ? true : undefined}
          spellCheck={false}
          autoComplete="off"
          className="h-9 w-full rounded-md border border-hairline-strong bg-surface-1 px-3 text-body text-ink outline-none focus-visible:outline-offset-0"
        />
        {error && (
          <p role="alert" className="mt-2 text-caption text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Picks a destination folder by path. The keyboard route to what dragging a row onto a folder does. */
export function MoveDialog({
  name,
  from,
  onSubmit,
  onClose,
}: {
  name: string;
  /** The folder the item is in now, as segments. */
  from: readonly string[];
  onSubmit: (to: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState(formatPath(from));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const to = parsePath(destination);
    if (to.join("/") === [...from].join("/")) return onClose();
    setPending(true);
    setError(null);
    try {
      await onSubmit(to);
    } catch (failure) {
      setError((failure as Error).message);
      setPending(false);
    }
  }

  return (
    <Dialog title={`Move “${name}”`} onClose={onClose}>
      <form onSubmit={submit} className="mt-4">
        <input
          ref={inputRef}
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          aria-label="Destination folder"
          aria-invalid={error ? true : undefined}
          spellCheck={false}
          autoComplete="off"
          className="h-9 w-full rounded-md border border-hairline-strong bg-surface-1 px-3 font-mono text-code text-ink outline-none focus-visible:outline-offset-0"
        />
        <p className="mt-2 text-caption text-ink-tertiary">
          A folder path from the top of the files root. <span className="font-mono">/</span> is the top folder itself.
        </p>
        {error && (
          <p role="alert" className="mt-2 text-caption text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={pending}>
            Move
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteDialog({
  name,
  isFolder,
  onConfirm,
  onClose,
}: {
  name: string;
  isFolder: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (failure) {
      setError((failure as Error).message);
      setPending(false);
    }
  }

  return (
    <Dialog title={`Delete “${name}”?`} onClose={onClose}>
      <p className="mt-2 text-body text-ink-subtle">
        {isFolder ? "The folder and everything inside it will be permanently removed." : "The file will be permanently removed."}{" "}
        This can’t be undone.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}
      {/* Cancel comes first so it is what showModal() focuses. */}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={confirm} disabled={pending}>
          Delete
        </Button>
      </div>
    </Dialog>
  );
}
