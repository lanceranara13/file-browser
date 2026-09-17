// Shared between server and client: no Node imports here.

export type Kind = "folder" | "video" | "audio" | "image" | "pdf" | "text" | "archive" | "other";

export interface Entry {
  name: string;
  kind: Kind;
  /** Bytes; 0 for folders. */
  size: number;
  /** Last modified, epoch milliseconds. */
  modified: number;
  /** Hidden by name. Only ever sent to a browser that has unlocked hidden items. */
  hidden?: boolean;
}

export interface Storage {
  /** Bytes on the disk holding the files root. */
  total: number;
  /** Bytes in use — the whole disk's, not this folder's; a recursive walk is a far more expensive question. */
  used: number;
  /** Bytes this user may still write: `bavail`, which excludes the root-only reserve. */
  free: number;
}

export const KIND_LABEL: Record<Kind, string> = {
  folder: "Folder",
  video: "Video",
  audio: "Audio",
  image: "Image",
  pdf: "PDF",
  text: "Text",
  archive: "Archive",
  other: "File",
};

/** A name's extension, lowercased and without the dot. A dotfile has none. */
export function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Extensions bsdtar reads. `dmg` is in `ARCHIVE_EXTENSIONS` but is not one of them. */
const EXTRACTABLE = new Set("zip tar gz tgz bz2 tbz tbz2 xz txz zst tzst 7z rar iso jar war cbz cbr".split(" "));

/** Two-part suffixes, so `logs.tar.gz` unpacks to `logs`, not `logs.tar`. */
const COMPOUND = [".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst", ".tar.lz4", ".tar.lzma", ".tar.z"];

/** Compressors that wrap one file, so only a `.tar` inside them is an archive. */
const WRAPPERS = new Set("gz bz2 xz zst".split(" "));

export function isExtractable(name: string) {
  const extension = extensionOf(name);
  if (!EXTRACTABLE.has(extension)) return false;
  // `notes.txt.gz` is a compressed file rather than an archive, and bsdtar reads
  // it as neither. Saying so by leaving Unpack out beats a puzzling failure.
  const lower = name.toLowerCase();
  if (WRAPPERS.has(extension)) return COMPOUND.some((suffix) => lower.endsWith(suffix) && lower.length > suffix.length);
  return true;
}

/** `logs.tar.gz` → `logs`; `photos.zip` → `photos`; a name with no suffix is kept. */
export function archiveStem(name: string) {
  const lower = name.toLowerCase();
  const compound = COMPOUND.find((suffix) => lower.endsWith(suffix) && lower.length > suffix.length);
  if (compound) return name.slice(0, -compound.length);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function encodeSegments(segments: readonly string[]) {
  return segments.map(encodeURIComponent).join("/");
}

/** UI route for a folder or file. */
export function browseHref(segments: readonly string[]) {
  return segments.length ? `/files/${encodeSegments(segments)}` : "/files";
}

/** Byte stream of a file (supports Range requests). */
export function rawHref(segments: readonly string[], download = false) {
  return `/api/raw/${encodeSegments(segments)}${download ? "?download=1" : ""}`;
}

/** Kinds a thumbnail can be drawn for: a picture, a frame of a video, or a song's cover art. */
export const hasThumbnail = (kind: Kind) => kind === "image" || kind === "video" || kind === "audio";

/**
 * Changes with the file, and with how thumbnails are drawn (the leading `1`), so
 * a thumbnail URL carrying it can be cached for good.
 */
export const thumbVersion = (size: number, modified: number) =>
  `1-${size.toString(36)}-${Math.floor(modified).toString(36)}`;

/** A small WebP of a file, for the icon views. */
export function thumbHref(segments: readonly string[], { size, modified }: Pick<Entry, "size" | "modified">) {
  return `/api/thumb/${encodeSegments(segments)}?v=${thumbVersion(size, modified)}`;
}

/** Mutation endpoint: PUT upload, POST mkdir, PATCH rename, DELETE remove. */
export function fsHref(segments: readonly string[]) {
  return segments.length ? `/api/fs/${encodeSegments(segments)}` : "/api/fs";
}

/** Unpacks an archive beside itself: POST. */
export function extractHref(segments: readonly string[]) {
  return `/api/extract/${encodeSegments(segments)}`;
}

/**
 * A typed folder path as segments. Empty parts are dropped, so `/`, `` and
 * `a//b/` all behave; `..` is left for the server, which refuses anything that
 * lands outside the files root.
 */
export function parsePath(input: string) {
  return input
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== ".");
}

/** A folder path as typed: the root is `/`. */
export function formatPath(segments: readonly string[]) {
  return `/${segments.join("/")}`;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Folders first, then natural name order. */
export function compareEntries(a: Entry, b: Entry) {
  if ((a.kind === "folder") !== (b.kind === "folder")) return a.kind === "folder" ? -1 : 1;
  return collator.compare(a.name, b.name);
}

export function compareNames(a: string, b: string) {
  return collator.compare(a, b);
}
