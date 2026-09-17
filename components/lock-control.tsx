"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, IconButton } from "./button";
import { EyeOffIcon, KeyIcon, LockIcon, UnlockIcon } from "./icons";
import { SecretDialog, UnlockDialog } from "./lock-dialogs";
import { hideControl, useRevealed } from "./reveal";
import { lockHidden } from "@/lib/api";
import type { LockInfo } from "@/lib/lock";

/**
 * Top-bar control for hidden items: set up, unlock, or — while unlocked — lock
 * and change the secret. Before and while locked it is not in the bar at all
 * until the mark gesture asks for it (see `reveal.tsx`); while unlocked it
 * always shows, so a browser holding hidden items stays noticeable.
 */
export function LockControl({ lock }: { lock: LockInfo }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"secret" | "unlock" | null>(null);
  const [pending, startTransition] = useTransition();
  const revealed = useRevealed();

  function done() {
    setDialog(null);
    router.refresh();
  }

  function lockNow() {
    startTransition(async () => {
      await lockHidden().catch(() => {});
      // Locking takes back the gesture too, so the bar looks as it did before.
      hideControl();
      router.refresh();
    });
  }

  return (
    <>
      {lock.state === "unset" && revealed && (
        <IconButton label="Set up hidden items" onClick={() => setDialog("secret")}>
          <EyeOffIcon />
        </IconButton>
      )}
      {lock.state === "locked" && revealed && (
        <IconButton label="Show hidden items" onClick={() => setDialog("unlock")}>
          <LockIcon />
        </IconButton>
      )}
      {lock.state === "unlocked" && (
        <>
          <IconButton label="Change PIN or password" onClick={() => setDialog("secret")}>
            <KeyIcon />
          </IconButton>
          <Button variant="ghost" onClick={lockNow} disabled={pending} aria-label="Lock hidden items">
            <UnlockIcon />
            <span className="max-sm:hidden">Lock</span>
          </Button>
        </>
      )}

      {dialog === "secret" && (
        <SecretDialog current={lock.state === "unlocked" ? lock.kind : null} onDone={done} onClose={() => setDialog(null)} />
      )}
      {dialog === "unlock" && lock.kind && <UnlockDialog kind={lock.kind} onDone={done} onClose={() => setDialog(null)} />}
    </>
  );
}
