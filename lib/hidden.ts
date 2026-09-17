import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { FILES_ROOT, FsError, listDirectory, resolvePath } from "./files";
import { isSecretKind, SECRET_LABEL, secretProblem, type LockInfo, type LockState, type SecretKind } from "./lock";
import type { Entry } from "./paths";

/*
 * Hidden items: files and folders that only a browser which has entered the PIN
 * or password can see. Everything that reads the files root goes through
 * `view()`, which refuses a hidden path to a locked request as though it did not
 * exist — pages, listings, raw bytes, streams, previews and changes alike.
 *
 * This hides things from people using the app. It is not encryption: anyone who
 * can read the disk, or reach the files directory some other way, sees everything.
 */

/** Persistent state, kept apart from FILES_ROOT so it is never listed or served. */
// turbopackIgnore: a runtime-chosen directory.
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "data");
const STORE_FILE = path.join(DATA_DIR, "hidden.json");

const COOKIE = "fb-unlock";
/** An unlock lapses after this long without a request that uses it. */
const IDLE_MS = 30 * 60 * 1000;
/** Wrong guesses allowed before each further one has to wait, doubling from BASE_WAIT_MS up to MAX_WAIT_MS. */
const FREE_ATTEMPTS = 5;
const BASE_WAIT_MS = 30_000;
const MAX_WAIT_MS = 15 * 60_000;

interface Secret {
  kind: SecretKind;
  salt: string;
  hash: string;
}

interface Store {
  /**
   * The scrypt hash of the PIN or password. Absent before setup — and deleting it
   * is the way back in after forgetting it: everything shows until a new one is
   * set, which hides the same items again.
   */
  secret?: Secret;
  /** Hidden files and folders, as path segments below FILES_ROOT. */
  paths: string[][];
  /** Wrong guesses in a row, and when the next guess is allowed (epoch ms). Stored, so a restart does not reset them. */
  failures: number;
  lockedUntil: number;
}

type Memory = {
  cache: { mtimeMs: number; store: Store } | null;
  /** Unlock token → when it was last used. In memory only, so a restart locks every browser. */
  sessions: Map<string, number>;
  writing: Promise<unknown>;
};
const globalStore = globalThis as typeof globalThis & { __fbHidden?: Memory };
const memory: Memory = (globalStore.__fbHidden ??= { cache: null, sessions: new Map(), writing: Promise.resolve() });

function parse(text: string): Store {
  const raw = JSON.parse(text) as Partial<Store>;
  const secret = raw.secret;
  return {
    secret:
      secret && isSecretKind(secret.kind) && typeof secret.salt === "string" && typeof secret.hash === "string"
        ? { kind: secret.kind, salt: secret.salt, hash: secret.hash }
        : undefined,
    paths: Array.isArray(raw.paths)
      ? raw.paths.filter(
          (entry): entry is string[] => Array.isArray(entry) && entry.length > 0 && entry.every((name) => typeof name === "string"),
        )
      : [],
    failures: Number(raw.failures) || 0,
    lockedUntil: Number(raw.lockedUntil) || 0,
  };
}

/** The store, read again whenever the file changes, so an edit by hand takes effect without a restart. */
async function load(): Promise<Store> {
  const stats = await fs.stat(STORE_FILE).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stats) return { paths: [], failures: 0, lockedUntil: 0 };
  if (memory.cache?.mtimeMs === stats.mtimeMs) return memory.cache.store;
  let store: Store;
  try {
    store = parse(await fs.readFile(STORE_FILE, "utf8"));
  } catch (error) {
    // Fail closed: an unreadable store must not quietly show everything.
    console.error(`[hidden] cannot read ${STORE_FILE}:`, error);
    throw new FsError(500, "The hidden-items store is unreadable");
  }
  memory.cache = { mtimeMs: stats.mtimeMs, store };
  return store;
}

/** Runs `change` on a copy of the store, then writes it back atomically. One change at a time. */
function update<T>(change: (store: Store) => T | Promise<T>): Promise<T> {
  const run = memory.writing.then(async () => {
    const store = structuredClone(await load());
    const result = await change(store);
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temp = `${STORE_FILE}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, STORE_FILE);
    memory.cache = { mtimeMs: (await fs.stat(STORE_FILE)).mtimeMs, store };
    return result;
  });
  memory.writing = run.catch(() => {});
  return run;
}

function derive(secret: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(secret.normalize("NFKC"), salt, 32, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

async function hashSecret(kind: SecretKind, secret: string): Promise<Secret> {
  const salt = randomBytes(16);
  return { kind, salt: salt.toString("base64"), hash: (await derive(secret, salt)).toString("base64") };
}

async function matches(stored: Secret, guess: unknown) {
  if (typeof guess !== "string" || guess.length > 256) return false;
  const expected = Buffer.from(stored.hash, "base64");
  const actual = await derive(guess, Buffer.from(stored.salt, "base64"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function newSecret(kind: unknown, secret: unknown) {
  if (!isSecretKind(kind)) throw new FsError(400, "Choose a PIN or a password");
  if (typeof secret !== "string") throw new FsError(400, `Enter a ${SECRET_LABEL[kind]}`);
  const problem = secretProblem(kind, secret);
  if (problem) throw new FsError(400, problem);
  return { kind, secret };
}

function openSession() {
  const now = Date.now();
  for (const [token, lastUsed] of memory.sessions) {
    if (now - lastUsed > IDLE_MS) memory.sessions.delete(token);
  }
  const token = randomBytes(32).toString("base64url");
  memory.sessions.set(token, now);
  return token;
}

/** Whether a token is a live unlock. Using it keeps it alive. */
function touchSession(token: string | undefined) {
  const lastUsed = token ? memory.sessions.get(token) : undefined;
  if (!token || lastUsed === undefined) return false;
  if (Date.now() - lastUsed > IDLE_MS) {
    memory.sessions.delete(token);
    return false;
  }
  memory.sessions.set(token, Date.now());
  return true;
}

/** A resolved target's segments below FILES_ROOT, so `a/../b` is judged as `b`. */
export function relativeSegments(target: string) {
  const relative = path.relative(FILES_ROOT, target);
  return relative ? relative.split(path.sep) : [];
}

/** Whether `full` is `prefix` or lies inside it, compared name by name (so `Videos2` is not inside `Videos`). */
export const within = (full: readonly string[], prefix: readonly string[]) =>
  prefix.length <= full.length && prefix.every((name, index) => name === full[index]);

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && within(a, b);

export interface View extends LockInfo {
  /** `resolvePath`, refusing a hidden path this request cannot see as though it did not exist. */
  resolve(segments?: readonly string[]): string;
  /** Whether this request may see a path given as segments below FILES_ROOT. */
  canSee(segments: readonly string[]): boolean;
  /** Hidden itself, or inside a hidden folder. */
  isHidden(target: string): boolean;
  /** Hidden by name, not only by lying inside a hidden folder. */
  isMarked(target: string): boolean;
  /** Whether a folder has hidden items somewhere inside it. */
  holdsHidden(target: string): boolean;
  /** A folder's entries this request may see, with the hidden ones marked. */
  list(directory: string): Promise<Entry[]>;
}

/** What the current request may see. Reads the unlock cookie, so it runs in pages and route handlers. */
export async function view(): Promise<View> {
  const [store, jar] = await Promise.all([load(), cookies()]);
  const state: LockState = !store.secret ? "unset" : touchSession(jar.get(COOKIE)?.value) ? "unlocked" : "locked";
  const hidden = (segments: readonly string[]) => store.paths.some((entry) => within(segments, entry));
  const marked = (segments: readonly string[]) => store.paths.some((entry) => same(entry, segments));
  const canSee = (segments: readonly string[]) => state !== "locked" || !hidden(segments);
  return {
    state,
    kind: store.secret?.kind ?? null,
    resolve(segments = []) {
      const target = resolvePath(segments);
      if (!canSee(relativeSegments(target))) throw new FsError(404, "Not found");
      return target;
    },
    canSee,
    isHidden: (target) => hidden(relativeSegments(target)),
    isMarked: (target) => marked(relativeSegments(target)),
    holdsHidden(target) {
      const segments = relativeSegments(target);
      return store.paths.some((entry) => entry.length > segments.length && within(entry, segments));
    },
    async list(directory) {
      const base = relativeSegments(directory);
      const entries = await listDirectory(directory);
      return entries.flatMap((entry) => {
        const segments = [...base, entry.name];
        if (!canSee(segments)) return [];
        return marked(segments) ? [{ ...entry, hidden: true }] : [entry];
      });
    },
  };
}

/** The first PIN or password. Resolves to an unlock for the browser that set it. */
export function setUp(kind: unknown, secret: unknown) {
  const next = newSecret(kind, secret);
  return update(async (store) => {
    if (store.secret) throw new FsError(409, "Hidden items are already set up");
    store.secret = await hashSecret(next.kind, next.secret);
    store.failures = 0;
    store.lockedUntil = 0;
    return openSession();
  });
}

function waitText(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
}

/**
 * Checks a guess and counts the wrong ones. Resolves to an unlock token; throws
 * 401 for a wrong guess, and 429 while guesses have to wait.
 */
export async function unlock(guess: unknown) {
  const outcome = await update<{ token: string } | { wrong: string; wait: number }>(async (store) => {
    if (!store.secret) throw new FsError(409, "Hidden items are not set up");
    const wait = store.lockedUntil - Date.now();
    if (wait > 0) throw new FsError(429, `Too many wrong attempts. Try again in ${waitText(wait)}.`);
    if (await matches(store.secret, guess)) {
      store.failures = 0;
      store.lockedUntil = 0;
      return { token: openSession() };
    }
    store.failures++;
    if (store.failures >= FREE_ATTEMPTS) {
      store.lockedUntil = Date.now() + Math.min(MAX_WAIT_MS, BASE_WAIT_MS * 2 ** (store.failures - FREE_ATTEMPTS));
    }
    return { wrong: `Wrong ${SECRET_LABEL[store.secret.kind]}.`, wait: store.lockedUntil - Date.now() };
  });
  if ("token" in outcome) return outcome.token;
  throw new FsError(401, outcome.wait > 0 ? `${outcome.wrong} Try again in ${waitText(outcome.wait)}.` : outcome.wrong);
}

/** A new PIN or password, given the current one. Every other unlocked browser has to unlock again. */
export function changeSecret(current: unknown, kind: unknown, secret: unknown) {
  const next = newSecret(kind, secret);
  return update(async (store) => {
    if (!store.secret) throw new FsError(409, "Hidden items are not set up");
    if (!(await matches(store.secret, current))) {
      throw new FsError(401, `The current ${SECRET_LABEL[store.secret.kind]} is wrong.`);
    }
    store.secret = await hashSecret(next.kind, next.secret);
    memory.sessions.clear();
    return openSession();
  });
}

/**
 * Remembers an unlock in this browser. httpOnly and SameSite=Strict; no Secure
 * flag, which plain http on a LAN would make the browser drop, and no expiry, so
 * it ends with the browser session — the idle timeout is the real limit, since
 * browsers that restore tabs also restore session cookies.
 */
export async function rememberUnlock(token: string) {
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "strict", path: "/" });
}

export async function lock() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) memory.sessions.delete(token);
  jar.delete(COOKIE);
}

/** Hides or unhides one file or folder, given as segments below FILES_ROOT. */
export function setMark(segments: readonly string[], hidden: boolean) {
  if (!segments.length) throw new FsError(400, "The files root cannot be hidden");
  return update((store) => {
    const others = store.paths.filter((entry) => !same(entry, segments));
    store.paths = hidden ? [...others, [...segments]] : others;
  });
}

/**
 * Copies every mark at or inside `from` to the same place below `to`. A rename
 * copies before it moves anything and drops the old marks after, so a failure
 * part way leaves the item hidden rather than showing it.
 */
export async function copyMarks(from: readonly string[], to: readonly string[]) {
  if (!(await load()).paths.some((entry) => within(entry, from))) return;
  await update((store) => {
    const copies = store.paths.filter((entry) => within(entry, from)).map((entry) => [...to, ...entry.slice(from.length)]);
    store.paths = [...store.paths.filter((entry) => !copies.some((copy) => same(copy, entry))), ...copies];
  });
}

/** Forgets the marks at or inside a path — after it was deleted, or moved away by a rename. */
export async function dropMarks(under: readonly string[]) {
  if (!(await load()).paths.some((entry) => within(entry, under))) return;
  await update((store) => {
    store.paths = store.paths.filter((entry) => !within(entry, under));
  });
}
