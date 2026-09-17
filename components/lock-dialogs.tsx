"use client";

import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";
import { Button } from "./button";
import { Dialog } from "./entry-dialogs";
import { Segmented } from "./segmented";
import { changeHiddenSecret, setUpHidden, unlockHidden } from "@/lib/api";
import { SECRET_LABEL, secretProblem, type SecretKind } from "@/lib/lock";

const KINDS = [
  { value: "pin", label: "PIN" },
  { value: "password", label: "Password" },
] as const;

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function SecretField({
  kind,
  label,
  value,
  onChange,
  autoComplete,
  ref,
}: {
  kind: SecretKind;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <input
      ref={ref}
      type="password"
      inputMode={kind === "pin" ? "numeric" : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      placeholder={label}
      autoComplete={autoComplete}
      spellCheck={false}
      className={`h-9 w-full rounded-md border border-hairline-strong bg-surface-1 px-3 text-body text-ink outline-none placeholder:tracking-normal placeholder:text-ink-tertiary focus-visible:outline-offset-0 ${
        kind === "pin" ? "font-mono tracking-[0.3em]" : ""
      }`}
    />
  );
}

function Actions({ submitLabel, pending, onClose }: { submitLabel: string; pending: boolean; onClose: () => void }) {
  return (
    <div className="mt-3 flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" type="submit" disabled={pending}>
        {submitLabel}
      </Button>
    </div>
  );
}

function Problem({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-caption text-danger">
      {error}
    </p>
  ) : null;
}

/** First setup or, given the current kind, a change of PIN or password. */
export function SecretDialog({
  current,
  onDone,
  onClose,
}: {
  current: SecretKind | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<SecretKind>(current ?? "pin");
  const [old, setOld] = useState("");
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  // After showModal(), which would otherwise focus the PIN / Password toggle.
  useEffect(() => {
    const frame = requestAnimationFrame(() => firstRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem =
      secretProblem(kind, secret) ?? (secret !== confirm ? `The two ${SECRET_LABEL[kind]}s don’t match.` : null);
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    try {
      if (current) await changeHiddenSecret(old, kind, secret);
      else await setUpHidden(kind, secret);
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
      setPending(false);
    }
  }

  return (
    <Dialog title={current ? "Change PIN or password" : "Set up hidden items"} onClose={onClose}>
      <p className="mt-2 text-body text-ink-subtle">
        {current
          ? "Every other browser that unlocked hidden items will have to unlock again."
          : "Hidden files and folders only show in a browser that has entered this."}
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
        {current && (
          <SecretField
            ref={firstRef}
            kind={current}
            label={`Current ${SECRET_LABEL[current]}`}
            value={old}
            onChange={setOld}
            autoComplete="current-password"
          />
        )}
        <Segmented
          label="Unlock with"
          options={KINDS}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setSecret("");
            setConfirm("");
            setError(null);
          }}
          className={current ? "mt-2" : ""}
        />
        <SecretField
          ref={current ? undefined : firstRef}
          kind={kind}
          label={`New ${SECRET_LABEL[kind]}`}
          value={secret}
          onChange={setSecret}
          autoComplete="new-password"
        />
        <SecretField
          kind={kind}
          label={`Confirm ${SECRET_LABEL[kind]}`}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        <p className="text-caption text-ink-tertiary">{kind === "pin" ? "4 to 12 digits." : "6 characters or more."}</p>
        <Problem error={error} />
        <Actions submitLabel={current ? "Change" : "Set up"} pending={pending} onClose={onClose} />
      </form>
    </Dialog>
  );
}

export function UnlockDialog({ kind, onDone, onClose }: { kind: SecretKind; onDone: () => void; onClose: () => void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!secret) return setError(`Enter the ${SECRET_LABEL[kind]}.`);
    setPending(true);
    setError(null);
    try {
      await unlockHidden(secret);
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
      setSecret("");
      setPending(false);
    }
  }

  return (
    <Dialog title="Show hidden items" onClose={onClose}>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
        <SecretField
          kind={kind}
          label={capitalized(SECRET_LABEL[kind])}
          value={secret}
          onChange={setSecret}
          autoComplete="current-password"
        />
        <Problem error={error} />
        <Actions submitLabel="Unlock" pending={pending} onClose={onClose} />
      </form>
    </Dialog>
  );
}
