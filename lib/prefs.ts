// Shared between server and client: no Node imports here.
import { compareNames, extensionOf, KIND_LABEL, type Entry } from "./paths";

/** How a folder is laid out: the details table, or tiles with thumbnails at three sizes. */
export const LAYOUTS = ["details", "small", "medium", "large"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const LAYOUT_LABEL: Record<Layout, string> = {
  details: "Details",
  small: "Small icons",
  medium: "Medium icons",
  large: "Large icons",
};

export const SORT_KEYS = ["name", "modified", "size", "kind"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type Sort = { key: SortKey; descending: boolean };

export const SORT_LABEL: Record<SortKey, string> = { name: "Name", modified: "Modified", size: "Size", kind: "Kind" };

export interface Prefs {
  layout: Layout;
  sort: Sort;
}

/**
 * One cookie rather than local storage, so the server renders a folder the way
 * it was left and nothing changes shape after the first paint.
 */
export const PREFS_COOKIE = "fb-prefs";

const DEFAULT_PREFS: Prefs = { layout: "details", sort: { key: "name", descending: false } };

const isOneOf = <T extends string>(values: readonly T[], value: string | undefined): value is T =>
  (values as readonly (string | undefined)[]).includes(value);

/** `medium.modified.desc` → prefs. Each part that is not recognised falls back to its default on its own. */
export function parsePrefs(value: string | undefined): Prefs {
  const [layout, key, direction] = (value ?? "").split(".");
  return {
    layout: isOneOf(LAYOUTS, layout) ? layout : DEFAULT_PREFS.layout,
    sort: isOneOf(SORT_KEYS, key) ? { key, descending: direction === "desc" } : DEFAULT_PREFS.sort,
  };
}

export function formatPrefs({ layout, sort }: Prefs) {
  return [layout, sort.key, sort.descending ? "desc" : "asc"].join(".");
}

/** Newest and largest are what those keys are usually asked for; names and kinds read A to Z. */
export const firstDirection = (key: SortKey) => key === "modified" || key === "size";

/** Folders first whichever way it runs; then the key, then natural name order. */
export function sortEntries(entries: readonly Entry[], { key, descending }: Sort) {
  const direction = descending ? -1 : 1;
  return [...entries].sort((a, b) => {
    if ((a.kind === "folder") !== (b.kind === "folder")) return a.kind === "folder" ? -1 : 1;
    const difference =
      key === "size"
        ? a.size - b.size
        : key === "modified"
          ? a.modified - b.modified
          : key === "kind"
            ? compareNames(KIND_LABEL[a.kind], KIND_LABEL[b.kind]) || compareNames(extensionOf(a.name), extensionOf(b.name))
            : 0;
    return (difference || compareNames(a.name, b.name)) * direction;
  });
}
