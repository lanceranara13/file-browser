// Client-side calls to /api/fs and /api/hidden.
import type { SecretKind } from "./lock";
import { extractHref, fsHref } from "./paths";

async function failure(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `Request failed (${response.status})`);
}

async function send(segments: readonly string[], init: RequestInit) {
  const response = await fetch(fsHref(segments), init);
  if (!response.ok) throw await failure(response);
  return response;
}

export async function createFolder(segments: readonly string[]) {
  await send(segments, { method: "POST" });
}

/** Returns the renamed entry's new path segments. */
export async function renameEntry(segments: readonly string[], name: string) {
  const response = await send(segments, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return ((await response.json()) as { path: string[] }).path;
}

/** Moves an entry into `to` — the destination folder's segments, `[]` for the root. Returns its new path segments. */
export async function moveEntry(segments: readonly string[], to: readonly string[]) {
  const response = await send(segments, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to }),
  });
  return ((await response.json()) as { path: string[] }).path;
}

/** Unpacks an archive beside itself. Returns the new folder's path segments. */
export async function extractEntry(segments: readonly string[]) {
  const response = await fetch(extractHref(segments), { method: "POST" });
  if (!response.ok) throw await failure(response);
  return ((await response.json()) as { path: string[] }).path;
}

export async function deleteEntry(segments: readonly string[]) {
  await send(segments, { method: "DELETE" });
}

async function hiddenAction(body: Record<string, unknown>) {
  const response = await fetch("/api/hidden", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
}

export async function setUpHidden(kind: SecretKind, secret: string) {
  await hiddenAction({ action: "setup", kind, secret });
}

export async function unlockHidden(secret: string) {
  await hiddenAction({ action: "unlock", secret });
}

export async function lockHidden() {
  await hiddenAction({ action: "lock" });
}

export async function changeHiddenSecret(current: string, kind: SecretKind, secret: string) {
  await hiddenAction({ action: "change", current, kind, secret });
}

/** Hides or unhides a file or folder; needs a browser that has unlocked hidden items. */
export async function setEntryHidden(segments: readonly string[], hidden: boolean) {
  await hiddenAction({ action: hidden ? "hide" : "unhide", path: segments });
}

/** Clipboard write that also works over plain http on a LAN address. */
export async function copyText(text: string) {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}
