// Shared between server and client: no Node imports here.

/** `unset` before a PIN or password exists (everything shows), then `locked` or `unlocked` per browser. */
export type LockState = "unset" | "locked" | "unlocked";
export type SecretKind = "pin" | "password";

export interface LockInfo {
  state: LockState;
  /** Which kind of secret unlocks hidden items; null before setup. */
  kind: SecretKind | null;
}

export const SECRET_LABEL: Record<SecretKind, string> = { pin: "PIN", password: "password" };

export function isSecretKind(value: unknown): value is SecretKind {
  return value === "pin" || value === "password";
}

/** Why a new PIN or password will not do, or null when it will. */
export function secretProblem(kind: SecretKind, secret: string) {
  if (kind === "pin") return /^\d{4,12}$/.test(secret) ? null : "A PIN is 4 to 12 digits.";
  return secret.length >= 6 && secret.length <= 256 ? null : "A password is 6 to 256 characters.";
}
