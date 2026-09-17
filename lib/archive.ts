import fs from "node:fs/promises";
import path from "node:path";
import { assertValidName, availablePath, FsError, PART_SUFFIX } from "./files";
import { archiveStem, isExtractable } from "./paths";
import { run } from "./run";

/**
 * libarchive's `bsdtar`, one binary for every archive this app names. Chosen
 * over a zip-only npm library because `kindOf` already calls tar, gzip, bzip2,
 * xz, zstd, 7z, rar and iso archives, and because extraction here is the same
 * shape as the ffmpeg calls next door: spawn, wait, read the exit code.
 *
 * On Windows `C:\Windows\System32\tar.exe` is bsdtar, so point BSDTAR_PATH at
 * it to run this locally.
 */
export const BSDTAR = process.env.BSDTAR_PATH || "bsdtar";

function isPortableName(name: string) {
  try {
    assertValidName(name);
    return true;
  } catch {
    return false;
  }
}

const LIST_TIMEOUT_MS = 20_000;
const LIST_MAX_BYTES = 1 << 20;
const EXTRACT_TIMEOUT_MS = 30 * 60_000;

export interface ArchiveListing {
  names: string[];
  /** More entries than were read: the listing was cut short. */
  truncated: boolean;
}

/**
 * The names inside an archive, or null when bsdtar could not read it. Listing a
 * `.tar.gz` decompresses the whole stream, so this never blocks a first paint —
 * it streams into the page behind a Suspense boundary.
 */
export async function listArchive(file: string): Promise<ArchiveListing | null> {
  const result = await run(BSDTAR, ["-tf", file], LIST_TIMEOUT_MS, LIST_MAX_BYTES);
  if (result.code !== 0 && !result.truncated) return null;
  const names = result.stdout.split("\n").filter(Boolean);
  // A cut-off read ends mid-name; drop the partial one.
  if (result.truncated) names.pop();
  return { names, truncated: result.truncated };
}

/**
 * Deletes every symlink under `directory`. Nothing else in this app can create
 * one, so `/api/raw` does not check where a path really leads; an archive that
 * carries `passwd -> /etc/passwd` must not be the thing that introduces it.
 * bsdtar already refuses `..` entries and extraction *through* a symlink, so
 * this only has to stop the link itself from surviving.
 */
async function pruneSymlinks(directory: string) {
  const dirents = await fs.readdir(directory, { withFileTypes: true });
  await Promise.all(
    dirents.map(async (dirent) => {
      const child = path.join(directory, dirent.name);
      if (dirent.isSymbolicLink()) return fs.rm(child, { force: true });
      if (dirent.isDirectory()) return pruneSymlinks(child);
    }),
  );
}

/**
 * Unpacks `file` beside itself and resolves to the new folder — or to the one
 * item, when the archive holds a single top-level entry and unwrapping it saves
 * a `photos/photos` nest.
 *
 * Everything lands in a part directory first, which listings hide, so a failure
 * part way leaves nothing half-unpacked next to the archive.
 */
export async function extractArchive(file: string) {
  const parent = path.dirname(file);
  const name = path.basename(file);
  if (!isExtractable(name)) throw new FsError(400, "That is not an archive this app can unpack");

  const staging = path.join(parent, `.extract-${Date.now()}-${Math.random().toString(36).slice(2)}${PART_SUFFIX}`);
  await fs.mkdir(staging, { recursive: true });
  try {
    // No -p: permissions come from the umask, so an entry stored as mode 000
    // cannot land as a file the app is then unable to read or serve.
    const result = await run(BSDTAR, ["-x", "--no-same-permissions", "-f", file, "-C", staging], EXTRACT_TIMEOUT_MS);
    if (result.code === null) {
      const missing = result.stderr.includes("ENOENT");
      throw new FsError(
        503,
        missing ? "Unpacking is not available on this server" : `"${name}" took longer than 30 minutes to unpack`,
      );
    }
    if (result.code !== 0) {
      // bsdtar ends each line with CRLF on Windows, and prefixes every one with
      // whatever the binary is called — `tar.exe` there, `bsdtar` on the server.
      // Neither belongs in a message about the archive.
      const program = `${path.basename(BSDTAR)}: `;
      const first = result.stderr
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean);
      const detail = first?.startsWith(program) ? first.slice(program.length) : first;
      throw new FsError(422, detail ? `Could not unpack "${name}": ${detail}` : `Could not unpack "${name}"`);
    }
    await pruneSymlinks(staging);

    const unpacked = await fs.readdir(staging, { withFileTypes: true });
    if (!unpacked.length) throw new FsError(422, `"${name}" is empty`);

    // One top-level folder is the common shape; hoist it rather than nest it —
    // but only under a name this app would have allowed, since that one comes
    // from the archive rather than from anybody here.
    const [only] = unpacked;
    const single = unpacked.length === 1 && only.isDirectory() && isPortableName(only.name);
    const source = single ? path.join(staging, only.name) : staging;
    const destination = await availablePath(parent, single ? only.name : archiveStem(name));
    await fs.rename(source, destination);
    return destination;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
