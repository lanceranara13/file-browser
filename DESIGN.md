---
name: file-browser
source: "VoltAgent/awesome-design-md → design-md/linear.app, adapted from a marketing-site extraction to a dense product UI"
colors:
  canvas: "#010102"
  surface-1: "#0f1011"
  surface-2: "#141516"
  surface-3: "#18191a"
  hairline: "#23252a"
  hairline-strong: "#34343a"
  ink: "#f7f8f8"
  ink-muted: "#d0d6e0"
  ink-subtle: "#8a8f98"
  ink-tertiary: "#62666d"
  accent: "#5e6ad2"
  accent-hover: "#828fff"
  success: "#27a644"
  danger: "#e5484d"
typography:
  sans: "Inter (cv01, ss03) — 400 / 500 / 600"
  mono: "JetBrains Mono — 400 / 500"
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
spacing: "4px base"
---

# file-browser — DESIGN.md

The single source of truth for how file-browser looks. Tokens live in
`app/globals.css` (`@theme`); this file says how to use them.

## 1. Visual theme & atmosphere

A tool, not a landing page. A near-black canvas with a faint blue tint, a
four-step surface ladder, 1px hairlines and exactly one chromatic accent. The
files are the protagonist and the chrome recedes: dense, quiet and precise, like
an editor's file tree that was given room to breathe.

## 2. Color roles

| Token             | Hex       | Role                                                        |
| ----------------- | --------- | ----------------------------------------------------------- |
| `canvas`          | `#010102` | App background                                              |
| `surface-1`       | `#0f1011` | Stage frames, inspector, inputs                             |
| `surface-2`       | `#141516` | Row hover, dialogs, upload tray                             |
| `surface-3`       | `#18191a` | Selected row, pressed secondary buttons                     |
| `hairline`        | `#23252a` | Dividers, panel borders                                     |
| `hairline-strong` | `#34343a` | Dialog borders, focused inputs, drop-zone outline           |
| `ink`             | `#f7f8f8` | Names, titles                                               |
| `ink-muted`       | `#d0d6e0` | Folder glyphs, secondary values                             |
| `ink-subtle`      | `#8a8f98` | Column headers, labels, file glyphs                         |
| `ink-tertiary`    | `#62666d` | Path separators, status bar, placeholders                   |
| `accent`          | `#5e6ad2` | Focus ring, selection marker, primary button, progress      |
| `success`         | `#27a644` | Completed upload — nothing else                             |
| `danger`          | `#e5484d` | Destructive confirmation, failed upload — nothing else      |

The accent is scarce. It is never a panel fill, never a gradient, never
decoration.

## 3. Typography

| Role                                  | Family         | Size    | Weight | Tracking |
| ------------------------------------- | -------------- | ------- | ------ | -------- |
| Page title (folder or file name)      | Inter          | 22px    | 600    | -0.4px   |
| Dialog title                          | Inter          | 15px    | 600    | -0.1px   |
| Rows, body, buttons                   | Inter          | 13–14px | 400/500| 0        |
| Column header, inspector label        | Inter          | 12px    | 500    | +0.2px   |
| Sizes, dates, MIME types, paths, keys | JetBrains Mono | 12–13px | 400    | 0, tabular |

**Rule:** anything a machine produced — bytes, timestamps, MIME types, paths,
shortcuts — is set in mono. Anything a person named is set in sans.

## 4. Components

- **Top bar** — 48px, canvas, bottom hairline. Mark + `file-browser` wordmark
  (mono 13/500), then the breadcrumb path in mono with `/` separators in
  `ink-tertiary`. Actions sit on the right.
- **Buttons** — 30px tall, `rounded-md`, 13px/500.
  Primary: `accent` fill, hover `accent-hover`. Secondary: `surface-1` + hairline.
  Ghost: transparent, `surface-2` on hover. Danger: ghost with `danger` text.
- **File table** — 36px rows, no dividers. Hover `surface-2`; selected
  `surface-3` with a 2px `accent` bar on the left edge. Sticky 32px header with
  12px/500 `ink-subtle` labels and a bottom hairline. Size and date columns are
  mono, right-aligned, tabular.
- **View switch** — a segmented control of four 16px glyphs beside the filter:
  Details, Small icons, Medium icons, Large icons. `V` steps through them.
  Details is the default. The pick and the sort order share one cookie, so the
  server renders a folder the way it was left and nothing reflows after the
  first paint.
- **Sort menu** — a secondary button between the filter and the view switch: a
  sort glyph, the key, and a 12px direction chevron. It opens a menu of Name /
  Modified / Size / Kind, a hairline, then Ascending / Descending, the pick in
  each group checked. Folders stay first either way. In Details the column
  headers sort too; both are the same setting.
- **Menu** — a native popover: `surface-2`, `hairline-strong`, `rounded-md`,
  4px padding, 4px under its button with the right edges aligned, or above it
  when there is no room below. 32px items in 13px `ink-muted`; hover and
  keyboard focus take `surface-3` and `ink`, a destructive item `danger`. A
  16px slot on the left holds the item's glyph or its check. Arrow keys move
  through it; Escape, a click outside and scrolling the page close it.
- **Tiles** — the icon views: a grid that fits as many 104 / 144 / 208px tiles
  to a row as it can and shares out the rest. A tile is canvas at rest, with no
  fill or border of its own: a square `surface-1` frame with a hairline and
  `rounded-md` holds the thumbnail, contained and never cropped, or the kind's
  glyph at 24 / 32 / 40px with a 1.5px stroke. Under it the name, centred in 13px
  `ink` — one line on small tiles, two on the others — and, for a file on medium
  and large tiles, its size in mono `ink-subtle`. Hover `surface-2`; selected
  `surface-3` with the same 2px `accent` bar on the left edge as a row. A folder
  tile takes a drop like a folder row. A thumbnail fades in over the glyph once it
  has loaded; where none can be drawn the glyph stays. On medium and large tiles
  a video's or a song's thumbnail carries a 24px `surface-2` badge with its kind
  glyph in the bottom-left corner, so neither passes for a photo.
- **Tile actions** — a tile has no room for a row's icons, so the same actions,
  in the same order, sit in a menu behind a 28px `surface-2` ⋯ button in its
  top-right corner, shown on hover, selection and focus, and always on touch
  screens. A click selects a tile and a double click opens it, as in a desktop
  file manager; a tap opens it.
- **Kind glyphs** — 16px monochrome strokes (1.25). Folders `ink-muted`, files
  `ink-subtle`. No colored icon sets, no emoji.
- **Status bar** — 28px, mono 12px `ink-tertiary`: item count, then the disk
  behind the files root as `… used · … free`, then keyboard hints rendered as
  `kbd`. The disk figures are the volume's, not this folder's — the folder's own
  total belongs in the path header. They are omitted rather than guessed at when
  the disk cannot be read.
- **kbd** — mono 11px, `surface-2`, hairline border, `rounded-xs`.
- **Inspector** — 320px column beside the stage: title, then a definition list
  of mono values, then actions.
- **Stage** — `surface-1` frame, `rounded-lg`, hairline border. Images sit on a
  quiet checkerboard; text renders in mono with a line-number gutter.
- **Video** — Video.js v10 `VideoSkin` only, themed through its public custom
  properties: `--media-accent-color: accent`, `--media-border-radius: 12px`,
  `--media-border-color: hairline`, `--media-font-family: Inter`. The skin's
  frosted control bar is the one sanctioned blur: it floats over moving
  footage, where a translucent backing is what keeps controls legible. Nothing
  in the app's own chrome borrows it. Player settings stay in the player:
  quality and speed in the skin's gear menu, seek previews above its time
  slider. The app never duplicates them in its own chrome.
- **Archive stage** — an archive's stage is its listing: the same `surface-1`
  frame as text, one mono `ink-muted` name per line at 24px, and a hairline
  footer counting the entries or saying how many are shown. It streams in behind
  a quiet "Reading the archive…" frame, because reading a `.tar.gz` walks the
  whole compressed stream. Anything it cannot read says so in one plain
  sentence, like every other empty state.
- **Unpack** — offered wherever an archive this app can read appears: a
  secondary full-width button under Copy link / Open raw on its page, and an
  icon in a row's hover actions, first after Download — both are ways at the
  contents, ahead of the actions that manage the row. `E` runs it from the
  keyboard. Unpacking can last minutes and neither place may look idle: the
  page's button reads "Unpacking…" and disables, and a row's run fills the
  status bar while every Unpack icon disables, since only one runs at a time.
  The page's failures sit under its button in mono `danger`; a row's go to the
  status notice.
- **Playback panel** — inspector section under Details for videos: mono
  Source / Mode / Qualities / Why / Codec / Encoder rows. The codec and encoder
  rows stream in; detection never blocks the page. Its one control is the
  Original / Transcoded switch, shown when browsers can play the original:
  which stream plays swaps the player itself, so it cannot live in the player's
  menu. It is a segmented control — a `surface-1` track with a hairline and 2px
  inset, two 26px options, the picked one `surface-3` in `ink`, the other
  `ink-subtle`. No accent.
- **Dialog** — native `<dialog>`, `surface-2`, `hairline-strong`, `rounded-lg`,
  400px, backdrop black at 60%.
- **Upload tray** — 360px `surface-2` panel pinned bottom-right; each row has a
  2px progress track filled with `accent`, turning `success` when done.
- **Drop overlay** — canvas at 85%, a 1px dashed `hairline-strong` outline inset
  12px, one centered mono line naming the destination. Files dragged in from the
  desktop only; a row dragged inside the app never raises it.
- **Move target** — dragging a row onto a folder row, or onto a breadcrumb above
  this folder, moves it there. The target takes `surface-2` and a 1px dashed
  `hairline-strong` outline — the same language as the drop overlay, at row
  scale; a crumb takes the outline at a 2px offset and no fill. No accent.
  Dragging is never the only way: Move sits in a row's hover actions after
  Rename and in the file inspector, `M` opens it from the keyboard, and its
  dialog takes a mono folder path.
- **Status notice** — a drop and a row's Unpack have no dialog to report into,
  so they replace the status bar's item count and disk figures. A failure is
  `danger` and clears itself after five seconds; work still running is
  `ink-subtle` and stays until it ends. Nothing else writes there.

## 5. Layout

- App shell is full-height: top bar / scrolling content / status bar.
- Gutters: 16px under 640px, 24px above.
- File view: stage fills the remaining space, inspector is a fixed 320px
  column; they stack under 960px.

## 6. Depth

No drop shadows. Lift is a surface step plus a hairline. Floating panels
(dialogs, tray, toasts) add a 1px inner top highlight, `rgb(255 255 255 / 4%)`.

## 7. Motion

150ms or less, ease-out, on opacity and background only. Nothing bounces,
nothing scales in.

## 8. Do / Don't

**Do** — let the listing be dense; keep one accent; put every machine value in
mono; make every action reachable from the keyboard; say empty states in one
plain sentence.

**Don't** — gradients, glass or backdrop blur, drop shadows, colored or emoji
icons, file tiles dressed as cards (a fill, border or shadow at rest), a grid as
the default listing, centered hero copy, a second accent, pill-shaped
buttons, uppercase shouting labels.

## 9. Responsive

- Under 640px: the table keeps Name and Size; Kind and Modified hide. Toolbar
  buttons collapse to icons, and the sort button keeps only its glyphs. Rows
  grow to 44px for touch. A tile's ⋯ button stays visible.
- Under 960px: the inspector drops below the stage.
