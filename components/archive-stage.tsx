import { listArchive } from "@/lib/archive";
import { view } from "@/lib/hidden";
import { isExtractable } from "@/lib/paths";

/** Names shown before the list is cut off; an archive can hold far more. */
const SHOWN = 500;

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col overflow-hidden rounded-lg border border-hairline bg-surface-1">{children}</div>;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Frame>
      <p className="flex h-full items-center justify-center px-6 text-center text-body text-ink-subtle">{children}</p>
    </Frame>
  );
}

export function ArchiveStagePending() {
  return <Note>Reading the archive…</Note>;
}

/**
 * What is inside an archive, read with bsdtar. Streams in behind a Suspense
 * boundary: listing a `.tar.gz` walks the whole compressed stream, so a large
 * tarball must never hold up the rest of the page.
 */
export async function ArchiveStage({ segments }: { segments: string[] }) {
  const name = segments.at(-1) ?? "";
  if (!isExtractable(name)) return <Note>This archive cannot be listed or unpacked here.</Note>;

  const seen = await view();
  const listing = await listArchive(seen.resolve(segments)).catch(() => null);
  if (!listing) return <Note>The contents of this archive could not be read.</Note>;
  if (!listing.names.length) return <Note>This archive is empty.</Note>;

  const shown = listing.names.slice(0, SHOWN);
  const more = listing.truncated || listing.names.length > shown.length;

  return (
    <Frame>
      <div className="min-h-0 flex-1 overflow-auto">
        <ul className="w-max min-w-full py-3 font-mono text-code text-ink-muted">
          {/* By index: a tar may carry the same path twice, and this list never reorders. */}
          {shown.map((entry, index) => (
            <li key={index} className="px-4 leading-6 [overflow-wrap:anywhere]">
              {entry}
            </li>
          ))}
        </ul>
      </div>
      <p className="border-t border-hairline px-4 py-2 font-mono text-caption text-ink-subtle">
        {more ? `Showing the first ${shown.length} entries.` : `${shown.length} ${shown.length === 1 ? "entry" : "entries"}.`}
      </p>
    </Frame>
  );
}
