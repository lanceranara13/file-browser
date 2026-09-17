"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import { Button, buttonClass, IconAnchor, IconButton } from "./button";
import { PathHeader, TopBar } from "./chrome";
import { DeleteDialog, MoveDialog, NameDialog } from "./entry-dialogs";
import {
  DetailsIcon,
  DownloadIcon,
  ExtractIcon,
  EyeIcon,
  EyeOffIcon,
  FolderPlusIcon,
  KindIcon,
  LargeIconsIcon,
  MediumIconsIcon,
  MoreIcon,
  MoveIcon,
  PencilIcon,
  SearchIcon,
  SmallIconsIcon,
  SortByIcon,
  SortIcon,
  TrashIcon,
  UploadIcon,
} from "./icons";
import { Kbd } from "./kbd";
import { LockControl } from "./lock-control";
import { SecretDialog } from "./lock-dialogs";
import { Menu, type MenuItem } from "./menu";
import { useRevealed } from "./reveal";
import { Segmented } from "./segmented";
import { Thumbnail } from "./thumbnail";
import { useHydrated } from "./timestamp";
import { UploadTray, collectDropped, useUploads, type UploadRequest } from "./uploads";
import { createFolder, deleteEntry, extractEntry, moveEntry, renameEntry, setEntryHidden } from "@/lib/api";
import { formatBytes, formatTimestamp } from "@/lib/format";
import type { LockInfo } from "@/lib/lock";
import { KIND_LABEL, browseHref, formatPath, isExtractable, rawHref, type Entry, type Storage } from "@/lib/paths";
import {
  LAYOUTS,
  LAYOUT_LABEL,
  PREFS_COOKIE,
  SORT_KEYS,
  SORT_LABEL,
  firstDirection,
  formatPrefs,
  sortEntries,
  type Layout,
  type Prefs,
  type Sort,
  type SortKey,
} from "@/lib/prefs";

type DialogState =
  | { type: "mkdir" }
  | { type: "rename"; entry: Entry }
  | { type: "move"; entry: Entry }
  | { type: "delete"; entry: Entry }
  // Setup reached through Hide: the entry is hidden once the PIN or password exists.
  | { type: "setup"; then: Entry }
  | null;

type Action = Exclude<MenuItem, "separator">;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const TH = "sticky top-0 z-10 h-8 border-b border-hairline bg-canvas px-3 text-caption font-medium text-ink-subtle";

const LAYOUT_ICON: Record<Layout, (props: SVGProps<SVGSVGElement>) => ReactNode> = {
  details: DetailsIcon,
  small: SmallIconsIcon,
  medium: MediumIconsIcon,
  large: LargeIconsIcon,
};

/** Tile layouts. The grid fills each row with as many tiles as fit, then shares out what is left. */
const TILES: Record<Exclude<Layout, "details">, { grid: string; glyph: number; name: string; detailed: boolean }> = {
  small: { grid: "grid-cols-[repeat(auto-fill,minmax(104px,1fr))]", glyph: 24, name: "min-w-0 truncate", detailed: false },
  medium: { grid: "grid-cols-[repeat(auto-fill,minmax(144px,1fr))]", glyph: 32, name: "line-clamp-2 wrap-anywhere", detailed: true },
  large: { grid: "grid-cols-[repeat(auto-fill,minmax(208px,1fr))]", glyph: 40, name: "line-clamp-2 wrap-anywhere", detailed: true },
};

/**
 * The prefs last picked in this tab. A folder the router restores from its cache
 * comes with the prefs it was rendered with, which may be older than these.
 */
let picked: Prefs | null = null;

/** Remembers a pick for this tab, and in the cookie for the server's next render of any folder. */
function remember(prefs: Prefs) {
  picked = prefs;
  document.cookie = `${PREFS_COOKIE}=${formatPrefs(prefs)}; path=/; max-age=31536000; samesite=lax`;
}

/** `entries` arrive already filtered: hidden ones are only there for a browser that has unlocked them. */
export function Browser({
  segments,
  entries,
  lock,
  storage,
  prefs: rendered,
}: {
  segments: string[];
  entries: Entry[];
  lock: LockInfo;
  /** The disk behind the files root; null when it could not be read. */
  storage: Storage | null;
  /** Layout and sort order, from the cookie the last pick wrote. */
  prefs: Prefs;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [query, setQuery] = useState("");
  const [prefs, setPrefs] = useState(() => picked ?? rendered);
  const { layout, sort } = prefs;
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  // The row being dragged. A ref, not state: `dataTransfer.getData` is blocked
  // during dragover, so the drop target has no other way to know what is coming.
  const dragged = useRef<Entry | null>(null);
  // The folder the pointer is over, as `"name"` for a row or `"/a/b"` for a crumb.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  // The archive being unpacked, if any. One at a time: unpacking is disk-heavy,
  // and serialising it is simpler than explaining a queue in a status bar.
  const [unpacking, setUnpacking] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const uploads = useUploads(() => router.refresh());
  const revealed = useRevealed();
  // Hide / Unhide appears where the lock control does: an unlocked browser, or
  // one that has asked for the control before a PIN or password exists. Showing
  // Hide on every row before setup would announce the feature the gesture hides.
  const canHide = lock.state === "unlocked" || (lock.state === "unset" && revealed);

  // Moving to another folder keeps this component mounted (so the upload tray
  // survives), but the filter and selection belong to the folder.
  const location = segments.join("/");
  const [shownLocation, setShownLocation] = useState(location);
  if (location !== shownLocation) {
    setShownLocation(location);
    setQuery("");
    setSelected(null);
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortEntries(needle ? entries.filter((entry) => entry.name.toLowerCase().includes(needle)) : entries, sort);
  }, [entries, query, sort]);

  const totals = useMemo(
    () =>
      entries.reduce(
        (sum, entry) =>
          entry.kind === "folder"
            ? { ...sum, folders: sum.folders + 1 }
            : { ...sum, files: sum.files + 1, bytes: sum.bytes + entry.size },
        { folders: 0, files: 0, bytes: 0 },
      ),
    [entries],
  );

  const hrefOf = (entry: Entry) => browseHref([...segments, entry.name]);
  // The hint only makes sense against the row it would act on, like `H` and hiding.
  const selectedIsArchive = selected !== null && isExtractable(selected);

  function select(index: number) {
    const entry = visible[index];
    if (!entry) return;
    setSelected(entry.name);
    rows.current.get(entry.name)?.scrollIntoView({ block: "nearest" });
  }

  /** Tiles per row, as the grid laid them out: auto-fill leaves the count to the width. */
  function columns() {
    const grid = gridRef.current;
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 1;
  }

  function upload(requests: UploadRequest[]) {
    if (requests.length) uploads.enqueue(requests, segments);
  }

  function choose(next: Prefs) {
    remember(next);
    setPrefs(next);
  }

  const sortBy = (next: Sort) => choose({ ...prefs, sort: next });

  function toggleSort(key: SortKey) {
    sortBy(sort.key === key ? { key, descending: !sort.descending } : { key, descending: firstDirection(key) });
  }

  /**
   * A drop or a row action has no dialog to report into, so the status bar says
   * it. A failure clears itself after five seconds; work in progress stays until
   * it ends, and `null` ends it.
   */
  function report(text: string | null, bad = false) {
    setNotice(text ? { text, bad } : null);
  }

  // Each notice is a new object, so a newer one cancels the older one's timer.
  useEffect(() => {
    if (!notice?.bad) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function move(entry: Entry, to: string[]) {
    try {
      await moveEntry([...segments, entry.name], to);
      setSelected(null);
      router.refresh();
    } catch (failure) {
      report((failure as Error).message, true);
    }
  }

  /** Unpacks an archive into this folder. It can run for minutes, so the status bar carries it. */
  async function unpack(entry: Entry) {
    if (unpacking) return;
    setUnpacking(entry.name);
    report(`Unpacking ${entry.name}…`);
    try {
      const [name] = (await extractEntry([...segments, entry.name])).slice(-1);
      report(null);
      setSelected(name ?? null);
      router.refresh();
    } catch (failure) {
      report((failure as Error).message, true);
    } finally {
      setUnpacking(null);
    }
  }

  async function toggleHidden(entry: Entry) {
    if (lock.state === "unset") return setDialog({ type: "setup", then: entry });
    // A refusal means the unlock lapsed; the refresh shows the locked state either way.
    await setEntryHidden([...segments, entry.name], !entry.hidden).catch(() => {});
    router.refresh();
  }

  /**
   * What can be done to an entry, in DESIGN.md's order: the ways at its contents
   * first, then the ones that manage it. A row shows them as icons, a tile in its menu.
   */
  function actionsFor(entry: Entry): Action[] {
    const actions: Action[] = [];
    if (entry.kind !== "folder") {
      actions.push({ label: "Download", icon: <DownloadIcon />, href: rawHref([...segments, entry.name], true) });
    }
    if (isExtractable(entry.name)) {
      actions.push({ label: "Unpack", icon: <ExtractIcon />, disabled: unpacking !== null, onSelect: () => void unpack(entry) });
    }
    if (canHide) {
      actions.push({
        label: entry.hidden ? "Unhide" : "Hide",
        icon: entry.hidden ? <EyeIcon /> : <EyeOffIcon />,
        onSelect: () => void toggleHidden(entry),
      });
    }
    actions.push(
      { label: "Rename", icon: <PencilIcon />, onSelect: () => setDialog({ type: "rename", entry }) },
      { label: "Move", icon: <MoveIcon />, onSelect: () => setDialog({ type: "move", entry }) },
      { label: "Delete", icon: <TrashIcon />, danger: true, onSelect: () => setDialog({ type: "delete", entry }) },
    );
    return actions;
  }

  /**
   * A tile behaves like one in a desktop file manager: a click selects it and a
   * double click opens it. A tap, Enter on the focused tile, and a click with a
   * modifier (a new tab) keep the link's own behaviour.
   */
  function selectOnClick(event: MouseEvent<HTMLAnchorElement>, entry: Entry) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.detail === 0) return;
    const pointer = (event.nativeEvent as PointerEvent).pointerType;
    // Browsers that still send clicks as plain mouse events say nothing of the pointer; the device's hover answers instead.
    if (pointer ? pointer !== "mouse" : matchMedia("(hover: none)").matches) return;
    event.preventDefault();
    setSelected(entry.name);
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || dialog) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable], [popover]")) return;
    // A focused link or button handles its own activation.
    if (target?.closest("a, button") && (event.key === "Enter" || event.key === " ")) return;

    const index = visible.findIndex((entry) => entry.name === selected);
    const current = visible[index];
    const tiles = layout !== "details";
    // Up and down move a row at a time: one entry in the table, a row of tiles in the grid.
    const across = tiles ? columns() : 1;
    const last = visible.length - 1;
    switch (event.key) {
      case "ArrowDown":
        select(index < 0 ? 0 : Math.floor(index / across) < Math.floor(last / across) ? Math.min(index + across, last) : index);
        break;
      case "ArrowUp":
        select(index < 0 ? 0 : index >= across ? index - across : index);
        break;
      case "j":
        select(index < 0 ? 0 : Math.min(index + 1, last));
        break;
      case "k":
        select(index < 0 ? 0 : Math.max(index - 1, 0));
        break;
      case "Home":
        select(0);
        break;
      case "End":
        select(last);
        break;
      case "ArrowRight":
        // Across a row of tiles; in the table, into the selected row.
        if (tiles) {
          select(index < 0 ? 0 : Math.min(index + 1, last));
          break;
        }
        if (!current) return;
        router.push(hrefOf(current));
        break;
      case "Enter":
        if (!current) return;
        router.push(hrefOf(current));
        break;
      case "ArrowLeft":
        if (tiles) {
          select(index < 0 ? 0 : Math.max(index - 1, 0));
          break;
        }
        if (!segments.length) return;
        router.push(browseHref(segments.slice(0, -1)));
        break;
      case "Backspace":
        if (!segments.length) return;
        router.push(browseHref(segments.slice(0, -1)));
        break;
      case "/":
        filterRef.current?.focus();
        break;
      case "v":
        choose({ ...prefs, layout: LAYOUTS[(LAYOUTS.indexOf(layout) + 1) % LAYOUTS.length] });
        break;
      case "u":
        fileInputRef.current?.click();
        break;
      case "n":
        setDialog({ type: "mkdir" });
        break;
      case "r":
      case "F2":
        if (!current) return;
        setDialog({ type: "rename", entry: current });
        break;
      case "m":
        if (!current) return;
        setDialog({ type: "move", entry: current });
        break;
      case "e":
        if (!current || !isExtractable(current.name)) return;
        void unpack(current);
        break;
      case "h":
        if (!current || !canHide) return;
        void toggleHidden(current);
        break;
      case "Delete":
        if (!current) return;
        setDialog({ type: "delete", entry: current });
        break;
      case "d":
        if (!current || current.kind === "folder") return;
        window.location.assign(rawHref([...segments, current.name], true));
        break;
      case "Escape":
        setSelected(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // An internal drag carries text, never files, so the upload overlay below stays out of its way.
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  /**
   * Makes a folder a place a dragged row can land: `key` is what the highlight
   * compares against, `to` the destination segments, `self` the name that may
   * not be dropped onto itself.
   */
  function dropZone(key: string, to: string[], self?: string) {
    return {
      onDragOver(event: DragEvent) {
        if (!dragged.current || dragged.current.name === self) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropTarget !== key) setDropTarget(key);
      },
      onDragLeave(event: DragEvent) {
        // dragleave also fires when the pointer crosses onto a child element.
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setDropTarget((current) => (current === key ? null : current));
      },
      onDrop(event: DragEvent) {
        event.preventDefault();
        const source = dragged.current;
        dragged.current = null;
        setDropTarget(null);
        if (source && source.name !== self) void move(source, to);
      },
      "data-drop": dropTarget === key || undefined,
    };
  }

  /** What makes a row or a tile an item: selecting, opening, dragging, and taking a drop when it is a folder. */
  function itemProps(entry: Entry) {
    return {
      "data-selected": entry.name === selected || undefined,
      onClick: () => setSelected(entry.name),
      onDoubleClick: (event: MouseEvent) => {
        // A double click in a tile's menu is two picks, not an open.
        if (event.target instanceof Element && event.target.closest("button, [popover]")) return;
        router.push(hrefOf(entry));
      },
      draggable: true,
      onDragStart: (event: DragEvent) => {
        dragged.current = entry;
        setSelected(entry.name);
        event.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag that carries nothing.
        event.dataTransfer.setData("text/plain", entry.name);
      },
      onDragEnd: () => {
        dragged.current = null;
        setDropTarget(null);
      },
      ...(entry.kind === "folder" ? dropZone(entry.name, [...segments, entry.name], entry.name) : {}),
    };
  }

  const sortItems: MenuItem[] = [
    // A new key starts the way a column header does; the picks below turn it round.
    ...SORT_KEYS.map((key) => ({
      label: SORT_LABEL[key],
      checked: sort.key === key,
      onSelect: () => sortBy({ key, descending: sort.key === key ? sort.descending : firstDirection(key) }),
    })),
    "separator",
    { label: "Ascending", checked: !sort.descending, onSelect: () => sortBy({ key: sort.key, descending: false }) },
    { label: "Descending", checked: sort.descending, onSelect: () => sortBy({ key: sort.key, descending: true }) },
  ];

  return (
    <div
      className="flex h-full flex-col"
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void collectDropped(event.dataTransfer).then(upload);
      }}
    >
      <TopBar>
        <LockControl lock={lock} />
        <Button onClick={() => setDialog({ type: "mkdir" })} aria-label="New folder">
          <FolderPlusIcon />
          <span className="max-sm:hidden">New folder</span>
        </Button>
        <Button variant="primary" onClick={() => fileInputRef.current?.click()} aria-label="Upload">
          <UploadIcon />
          <span className="max-sm:hidden">Upload</span>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            upload(files.map((file) => ({ file, path: [file.name] })));
          }}
        />
      </TopBar>

      <PathHeader
        segments={segments}
        meta={`${plural(totals.folders, "folder")} · ${plural(totals.files, "file")} · ${formatBytes(totals.bytes)}`}
        // The trail is how a row moves up: every crumb above this folder takes a drop.
        crumbProps={(crumb) => dropZone(formatPath(crumb), crumb)}
      >
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label className="relative flex h-[30px] min-w-0 flex-1 items-center sm:w-64 sm:flex-none">
            <SearchIcon className="pointer-events-none absolute left-2.5 text-ink-tertiary" />
            <input
              ref={filterRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  event.currentTarget.blur();
                } else if (event.key === "ArrowDown" || event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                  select(0);
                }
              }}
              placeholder="Filter"
              aria-label="Filter this folder"
              spellCheck={false}
              className="h-full w-full rounded-md border border-hairline bg-surface-1 pr-8 pl-8 text-button text-ink outline-none placeholder:text-ink-tertiary focus:border-hairline-strong focus-visible:outline-offset-0"
            />
            <Kbd className="pointer-events-none absolute right-2">/</Kbd>
          </label>
          <Menu
            label={`Sort by ${SORT_LABEL[sort.key]}, ${sort.descending ? "descending" : "ascending"}`}
            items={sortItems}
            className={buttonClass("secondary", "max-sm:px-2")}
          >
            <SortByIcon className="text-ink-subtle" />
            <span className="max-sm:hidden">{SORT_LABEL[sort.key]}</span>
            <SortIcon descending={sort.descending} className="text-ink-subtle" />
          </Menu>
          <Segmented
            label="View"
            options={LAYOUTS.map((value) => {
              const Icon = LAYOUT_ICON[value];
              return { value, label: LAYOUT_LABEL[value], icon: <Icon /> };
            })}
            value={layout}
            onChange={(next) => choose({ ...prefs, layout: next })}
            className="shrink-0"
          />
        </div>
      </PathHeader>

      <main className="min-h-0 flex-1 overflow-auto">
        {visible.length > 0 && layout === "details" ? (
          <table className="w-full table-fixed border-separate border-spacing-0 text-body">
            <thead>
              <tr>
                <SortHeader label="Name" column="name" sort={sort} onSort={toggleSort} className="pl-4 text-left sm:pl-6" />
                <SortHeader label="Kind" column="kind" sort={sort} onSort={toggleSort} className="w-[120px] text-left max-sm:hidden" />
                <SortHeader label="Size" column="size" sort={sort} onSort={toggleSort} className="w-[96px] text-right" />
                <SortHeader
                  label="Modified"
                  column="modified"
                  sort={sort}
                  onSort={toggleSort}
                  className="w-[152px] text-right max-sm:hidden"
                />
                <th scope="col" className={`${TH} ${canHide ? "w-[168px]" : "w-[138px]"} pr-4 sm:pr-6`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => {
                const isFolder = entry.kind === "folder";
                return (
                  <tr
                    key={entry.name}
                    ref={(node) => {
                      if (node) rows.current.set(entry.name, node);
                      return () => void rows.current.delete(entry.name);
                    }}
                    {...itemProps(entry)}
                    className="group h-9 transition-colors duration-150 hover:bg-surface-2 data-selected:bg-surface-3 data-drop:bg-surface-2 data-drop:outline data-drop:-outline-offset-1 data-drop:outline-dashed data-drop:outline-hairline-strong max-sm:h-11"
                  >
                    <td className="relative pr-3 pl-4 sm:pl-6">
                      <span
                        aria-hidden
                        className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-accent opacity-0 group-data-selected:opacity-100"
                      />
                      <Link
                        href={hrefOf(entry)}
                        prefetch={false}
                        // Otherwise the anchor's own link drag wins over the row's.
                        draggable={false}
                        className="flex min-w-0 items-center gap-2.5 rounded-xs focus-visible:outline-offset-0"
                      >
                        <KindIcon
                          kind={entry.kind}
                          className={`shrink-0 ${isFolder ? "text-ink-muted" : "text-ink-subtle"}`}
                        />
                        <span className="truncate">{entry.name}</span>
                        {entry.hidden && <HiddenMarker />}
                      </Link>
                    </td>
                    <td className="px-3 text-ink-subtle max-sm:hidden">{KIND_LABEL[entry.kind]}</td>
                    <td className="px-3 text-right font-mono text-caption text-ink-subtle tabular">
                      {isFolder ? "—" : formatBytes(entry.size)}
                    </td>
                    <td className="px-3 text-right font-mono text-caption text-ink-subtle tabular max-sm:hidden">
                      <time dateTime={new Date(entry.modified).toISOString()}>
                        {formatTimestamp(entry.modified, !hydrated)}
                      </time>
                    </td>
                    <td className="pr-4 sm:pr-6">
                      <div className="flex justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-data-selected:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
                        {actionsFor(entry).map((action) =>
                          action.href ? (
                            <IconAnchor
                              key={action.label}
                              href={action.href}
                              label={`${action.label} ${entry.name}`}
                              draggable={false}
                            >
                              {action.icon}
                            </IconAnchor>
                          ) : (
                            <IconButton
                              key={action.label}
                              label={`${action.label} ${entry.name}`}
                              danger={action.danger}
                              disabled={action.disabled}
                              onClick={action.onSelect}
                            >
                              {action.icon}
                            </IconButton>
                          ),
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : visible.length > 0 && layout !== "details" ? (
          <div ref={gridRef} className={`grid gap-1 p-2 sm:px-4 ${TILES[layout].grid}`}>
            {visible.map((entry) => {
              const tile = TILES[layout];
              return (
                <div
                  key={entry.name}
                  ref={(node) => {
                    if (node) rows.current.set(entry.name, node);
                    return () => void rows.current.delete(entry.name);
                  }}
                  {...itemProps(entry)}
                  className="group relative rounded-lg p-2 transition-colors duration-150 hover:bg-surface-2 data-selected:bg-surface-3 data-drop:bg-surface-2 data-drop:outline data-drop:-outline-offset-1 data-drop:outline-dashed data-drop:outline-hairline-strong"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-accent opacity-0 group-data-selected:opacity-100"
                  />
                  <Link
                    href={hrefOf(entry)}
                    prefetch={false}
                    draggable={false}
                    title={entry.name}
                    onClick={(event) => selectOnClick(event, entry)}
                    className="flex flex-col gap-2 rounded-md focus-visible:outline-offset-2"
                  >
                    <Thumbnail
                      segments={[...segments, entry.name]}
                      entry={entry}
                      glyph={tile.glyph}
                      badge={tile.detailed}
                    />
                    <span className="flex min-w-0 items-start justify-center gap-1 px-0.5 text-center text-button text-ink">
                      <span className={tile.name}>{entry.name}</span>
                      {entry.hidden && <HiddenMarker />}
                    </span>
                    {tile.detailed && entry.kind !== "folder" && (
                      <span className="-mt-1.5 text-center font-mono text-caption text-ink-subtle tabular">
                        {formatBytes(entry.size)}
                      </span>
                    )}
                  </Link>
                  <div className="absolute top-3 right-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-data-selected:opacity-100 focus-within:opacity-100 has-[:popover-open]:opacity-100 max-sm:opacity-100 pointer-coarse:opacity-100">
                    <Menu
                      label={`Actions for ${entry.name}`}
                      items={actionsFor(entry)}
                      className="inline-flex size-7 items-center justify-center rounded-sm border border-hairline bg-surface-2 text-ink-subtle transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
                    >
                      <MoreIcon />
                    </Menu>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-4 py-10 text-body text-ink-subtle sm:px-6">
            {entries.length ? (
              <>Nothing in this folder matches “{query}”.</>
            ) : (
              <>
                This folder is empty. Drop files anywhere, or press <Kbd>U</Kbd> to upload.
              </>
            )}
          </p>
        )}
      </main>

      <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-hairline px-4 font-mono text-caption text-ink-tertiary sm:px-6">
        {/* A failed move is the same family as a failed upload, so it borrows `danger` too. */}
        {notice ? (
          <span role={notice.bad ? "alert" : "status"} className={`truncate ${notice.bad ? "text-danger" : "text-ink-subtle"}`}>
            {notice.text}
          </span>
        ) : (
          <span className="truncate tabular">
            {query ? `${visible.length} of ${entries.length} shown` : plural(entries.length, "item")}
            {/* The disk, not this folder: the folder's own total is in the header. */}
            {storage && ` · ${formatBytes(storage.used)} used · ${formatBytes(storage.free)} free`}
          </span>
        )}
        <span className="flex items-center gap-4 max-md:hidden">
          <Hint keys={["↑", "↓"]}>select</Hint>
          <Hint keys={["↵"]}>open</Hint>
          <Hint keys={["⌫"]}>up</Hint>
          <Hint keys={["/"]}>filter</Hint>
          <Hint keys={["V"]}>view</Hint>
          <Hint keys={["U"]}>upload</Hint>
          <Hint keys={["N"]}>folder</Hint>
          <Hint keys={["M"]}>move</Hint>
          {selectedIsArchive && <Hint keys={["E"]}>unpack</Hint>}
          {canHide && <Hint keys={["H"]}>hide</Hint>}
        </span>
      </footer>

      <UploadTray items={uploads.items} onDismiss={uploads.dismiss} />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-canvas/85 p-3">
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-hairline-strong">
            <p className="px-6 text-center font-mono text-code text-ink-subtle">
              Drop to upload into <span className="text-ink">/{segments.join("/")}</span>
            </p>
          </div>
        </div>
      )}

      {dialog?.type === "mkdir" && (
        <NameDialog
          title="New folder"
          initial=""
          submitLabel="Create"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await createFolder([...segments, name]);
            setDialog(null);
            setSelected(name);
            router.refresh();
          }}
        />
      )}
      {dialog?.type === "rename" && (
        <NameDialog
          title="Rename"
          initial={dialog.entry.name}
          submitLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const renamed = await renameEntry([...segments, dialog.entry.name], name);
            setDialog(null);
            setSelected(renamed.at(-1) ?? null);
            router.refresh();
          }}
        />
      )}
      {dialog?.type === "move" && (
        <MoveDialog
          name={dialog.entry.name}
          from={segments}
          onClose={() => setDialog(null)}
          onSubmit={async (to) => {
            await moveEntry([...segments, dialog.entry.name], to);
            setDialog(null);
            setSelected(null);
            router.refresh();
          }}
        />
      )}
      {dialog?.type === "delete" && (
        <DeleteDialog
          name={dialog.entry.name}
          isFolder={dialog.entry.kind === "folder"}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await deleteEntry([...segments, dialog.entry.name]);
            setDialog(null);
            setSelected(null);
            router.refresh();
          }}
        />
      )}
      {dialog?.type === "setup" && (
        <SecretDialog
          current={null}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            await setEntryHidden([...segments, dialog.then.name], true).catch(() => {});
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function HiddenMarker() {
  return (
    <>
      <EyeOffIcon className="shrink-0 text-ink-tertiary" />
      <span className="sr-only">(hidden)</span>
    </>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className: string;
}) {
  const active = sort.key === column;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
      className={`${TH} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 rounded-xs transition-colors duration-150 hover:text-ink ${active ? "text-ink-muted" : ""}`}
      >
        {label}
        {active && <SortIcon descending={sort.descending} />}
      </button>
    </th>
  );
}

function Hint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex gap-0.5">
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </span>
      {children}
    </span>
  );
}
