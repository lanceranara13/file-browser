import { SiblingControls } from "./sibling-controls";
import { view } from "@/lib/hidden";
import { browseHref, rawHref } from "@/lib/paths";

/**
 * Previous / next file in the same folder. Rendered behind <Suspense>: the
 * preview does not need it to paint, so the folder read must not block it.
 * Hidden siblings count only for a browser that has unlocked them.
 */
export async function SiblingNav({ segments }: { segments: string[] }) {
  const parent = segments.slice(0, -1);
  const seen = await view();
  const entries = await seen.list(seen.resolve(parent)).catch(() => []);
  const files = entries.filter((entry) => entry.kind !== "folder");
  const index = files.findIndex((entry) => entry.name === segments.at(-1));
  const hrefAt = (i: number) => (index >= 0 && files[i] ? browseHref([...parent, files[i].name]) : null);

  return (
    <SiblingControls
      previous={hrefAt(index - 1)}
      next={hrefAt(index + 1)}
      position={index >= 0 ? `${index + 1} / ${files.length}` : null}
      parent={browseHref(parent)}
      download={rawHref(segments, true)}
    />
  );
}
