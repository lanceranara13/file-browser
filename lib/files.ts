import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";
import { compareEntries, type Entry, type Kind, type Storage } from "./paths";

/** Every path the app touches is resolved inside this directory. */
// turbopackIgnore: a runtime-chosen directory; tracing it would bundle the whole disk.
export const FILES_ROOT = path.resolve(/* turbopackIgnore: true */ process.env.FILES_ROOT || "storage");

/** Suffix for uploads still being written; hidden from listings. */
export const PART_SUFFIX = ".fb-part";

export class FsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let rootReady: Promise<unknown> | undefined;

export function ensureRoot() {
  rootReady ??= fs.mkdir(FILES_ROOT, { recursive: true });
  return rootReady;
}

/**
 * Resolves URL segments to an absolute path, refusing anything that lands
 * outside FILES_ROOT. `path.relative` is what makes this safe on Windows, where
 * a decoded segment like `..\x` would slip past a string-prefix check.
 */
export function resolvePath(segments: readonly string[] = []) {
  if (segments.some((segment) => segment.includes("\0"))) {
    throw new FsError(400, "Invalid path");
  }
  const target = path.resolve(FILES_ROOT, ...segments);
  const relative = path.relative(FILES_ROOT, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new FsError(403, "Path is outside the files root");
  }
  return target;
}

const FORBIDDEN_NAME_CHARS = /[<>:"/\\|?*]/;

/** Names we create must be portable across Linux, macOS and Windows. */
export function assertValidName(name: string) {
  const invalid =
    !name ||
    name.length > 255 ||
    FORBIDDEN_NAME_CHARS.test(name) ||
    /[. ]$/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32) ||
    name.endsWith(PART_SUFFIX);
  if (invalid) throw new FsError(400, `"${name}" is not a valid name`);
}

const TEXT_EXTENSIONS = new Set(
  (
    "txt md markdown mdx json jsonc json5 yaml yml toml ini cfg conf env log csv tsv xml html htm " +
    "css scss sass less js mjs cjs jsx ts mts cts tsx py rb go rs java kt kts c h cc cpp hpp cs php " +
    "sh bash zsh fish ps1 bat cmd sql graphql gql vue svelte astro lua r swift dart ex exs erl hs ml " +
    "clj scala pl nix tf hcl proto srt vtt ass diff patch gradle properties"
  ).split(" "),
);
const TEXT_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  "license",
  "readme",
  "changelog",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  ".env",
]);
const ARCHIVE_EXTENSIONS = new Set("zip tar gz tgz bz2 xz 7z rar zst iso dmg".split(" "));

export function kindOf(name: string, isDirectory = false): Kind {
  if (isDirectory) return "folder";
  const extension = path.extname(name).slice(1).toLowerCase();
  // Checked before MIME lookup: `.ts` would otherwise resolve to video/mp2t.
  if (TEXT_EXTENSIONS.has(extension) || TEXT_FILENAMES.has(name.toLowerCase())) return "text";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  const type = mime.lookup(name) || "";
  if (type === "application/pdf") return "pdf";
  const [top] = type.split("/");
  if (top === "video" || top === "audio" || top === "image") return top;
  if (top === "text") return "text";
  return "other";
}

export function contentTypeOf(name: string) {
  const type = mime.lookup(name) || "";
  if (kindOf(name) === "text") {
    return type.startsWith("text/") ? `${type}; charset=utf-8` : "text/plain; charset=utf-8";
  }
  return type || "application/octet-stream";
}

export async function listDirectory(directory: string): Promise<Entry[]> {
  const dirents = await fs.readdir(directory, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((dirent) => !dirent.name.endsWith(PART_SUFFIX))
      .map(async (dirent): Promise<Entry | null> => {
        // stat, not the dirent type, so symlinks report what they point at.
        const stats = await fs.stat(path.join(directory, dirent.name)).catch(() => null);
        if (!stats) return null;
        const isDirectory = stats.isDirectory();
        return {
          name: dirent.name,
          kind: kindOf(dirent.name, isDirectory),
          size: isDirectory ? 0 : stats.size,
          modified: stats.mtimeMs,
        };
      }),
  );
  return entries.filter((entry) => entry !== null).sort(compareEntries);
}

export const TEXT_PREVIEW_LIMIT = 512 * 1024;

/** First TEXT_PREVIEW_LIMIT bytes as text, or null when the file looks binary. */
export async function readTextPreview(file: string) {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(TEXT_PREVIEW_LIMIT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, Math.min(bytesRead, TEXT_PREVIEW_LIMIT));
    if (bytes.subarray(0, 8000).includes(0)) return null;
    return { text: new TextDecoder().decode(bytes), truncated: bytesRead > TEXT_PREVIEW_LIMIT };
  } finally {
    await handle.close();
  }
}

/** `name`, or `name (1).ext`, `name (2).ext`… — the first that does not exist. */
export async function availablePath(directory: string, name: string) {
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let attempt = 0; ; attempt++) {
    const target = path.join(directory, attempt === 0 ? name : `${stem} (${attempt})${extension}`);
    const exists = await fs.lstat(target).then(
      () => true,
      () => false,
    );
    if (!exists) return target;
  }
}

/**
 * One `statfs` on the disk behind FILES_ROOT, or null when it cannot be read.
 * Cheap enough to sit in a page's other reads rather than behind a second
 * round trip — it is a single syscall next to a readdir and a stat per entry.
 */
export async function diskUsage(): Promise<Storage | null> {
  try {
    const { bsize, blocks, bfree, bavail } = await fs.statfs(FILES_ROOT);
    return { total: blocks * bsize, used: (blocks - bfree) * bsize, free: bavail * bsize };
  } catch {
    return null;
  }
}

const ERRNO: Record<string, [number, string]> = {
  ENOENT: [404, "Not found"],
  ENOTDIR: [404, "Not found"],
  EEXIST: [409, "Something with that name already exists"],
  ENOTEMPTY: [409, "Folder is not empty"],
  EACCES: [403, "Permission denied"],
  EPERM: [403, "Permission denied"],
  EISDIR: [400, "That is a folder"],
  ENOSPC: [507, "Disk is full"],
  ENAMETOOLONG: [400, "Name is too long"],
};

export function toFsError(error: unknown) {
  if (error instanceof FsError) return error;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  const known = code ? ERRNO[code] : undefined;
  return known ? new FsError(...known) : new FsError(500, "Unexpected file system error");
}

export function errorResponse(error: unknown) {
  const fsError = toFsError(error);
  if (fsError.status >= 500) console.error(error);
  return Response.json({ error: fsError.message }, { status: fsError.status });
}
