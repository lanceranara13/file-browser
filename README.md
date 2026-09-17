# file-browser

A self-hosted file browser with a quiet, dense interface.

- Browse folders as a detailed list or as thumbnails, sorted by name, date, size or kind.
- Preview video, audio, images, PDFs and text.
- Upload by drag-and-drop (whole folders too), move things by dragging, unpack archives in place.
- Share a direct link to any file.
- Videos a browser can't play — HEVC, MKV, 10-bit, AC-3 — are transcoded on the fly, on an NVIDIA, AMD or Intel GPU when there is one.

Built with Next.js 16, React 19, Tailwind CSS 4 and [Video.js v10](https://videojs.org/).

## Quick start (Docker)

```bash
git clone https://github.com/lanceranara13/file-browser.git
cd file-browser

# Create the data folders yourself, so they belong to you and not to root.
mkdir -p files cache data

# Optional: pick your GPU, port, user id and so on.
cp .env.example .env

docker compose up -d --build
```

Open <http://localhost:3300> and put your files in `./files`.

| Folder    | Holds                                                    |
| --------- | -------------------------------------------------------- |
| `./files` | Your files. This is what the app shows.                  |
| `./cache` | Transcodes, seek previews and thumbnails. Safe to delete. |
| `./data`  | App state. Keep it.                                      |

### Using a GPU

Without a GPU everything still works; transcoding just runs on the CPU. To use
one, set `COMPOSE_FILE` in `.env` (or pass the files with `-f`):

| GPU            | `.env`                                      | Host needs                                                   |
| -------------- | ------------------------------------------- | ------------------------------------------------------------ |
| AMD or Intel   | `COMPOSE_FILE=compose.yaml:compose.amd.yaml`    | Groups that own `/dev/dri`: check `getent group render video` and set `RENDER_GID` / `VIDEO_GID` if they aren't `993` / `44`. |
| NVIDIA         | `COMPOSE_FILE=compose.yaml:compose.nvidia.yaml` | The NVIDIA driver and `nvidia-container-toolkit`.            |

Then rebuild with `docker compose up -d --build`, and check what was detected:

```bash
curl localhost:3300/api/transcode/status
```

## Run without Docker

```bash
npm install
npm run dev   # http://localhost:3000, serving ./storage
```

For a production build:

```bash
npm run build
cp -r .next/static .next/standalone/.next/static
node .next/standalone/server.js
```

Optional tools, looked up on `PATH`:

- **`ffmpeg` and `ffprobe`** — transcoding, thumbnails and seek previews. Without
  them, videos play only if the browser supports the file as it is.
- **`bsdtar`** (libarchive) — opening and unpacking archives.
  `apt install libarchive-tools`, `brew install libarchive`, or on Windows the
  `tar.exe` already in `System32`.

## Configuration

Environment variables. The defaults are fine for most setups.

| Variable                    | Default                                        | Meaning                                                                 |
| --------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `FILES_ROOT`                | `./storage` (Docker: `/files`)                 | The folder that is browsed and written to.                              |
| `DATA_DIR`                  | `./data` (Docker: `/data`)                     | App state. Keep it outside `FILES_ROOT`.                                |
| `TRANSCODE_DIR`             | `<tmp>/file-browser-transcode` (Docker: `/cache`) | Scratch space for transcodes, seek previews and thumbnails.          |
| `TRANSCODE_HWACCEL`         | `auto`                                         | `auto`, `nvenc`, `vaapi` or `cpu`.                                      |
| `TRANSCODE_MAX_JOBS`        | `2`                                            | ffmpeg jobs at once; the least recently watched one is stopped.         |
| `TRANSCODE_IDLE_SECONDS`    | `60`                                           | Idle seconds before a transcode is stopped and its segments deleted.    |
| `TRANSCODE_DIRECT_MAX_MBPS` | `20`                                           | Transcode playable files above this bitrate too. `0` turns it off.      |
| `TRANSCODE_HEVC`            | `auto`                                         | `auto`: HEVC for browsers that decode it, when a GPU encodes it. `off`: always H.264. |
| `FFMPEG_PATH`               | `ffmpeg`                                       |                                                                         |
| `FFPROBE_PATH`              | `ffprobe`                                      |                                                                         |
| `BSDTAR_PATH`               | `bsdtar`                                       |                                                                         |

Docker Compose also reads these from `.env` — see [`.env.example`](./.env.example):
`COMPOSE_FILE`, `PORT` (3300), `FILES_DIR` / `CACHE_DIR` / `DATA_DIR` (the host
folders), `PUID` / `PGID` (1000), `RENDER_GID` (993), `VIDEO_GID` (44).

## How it works

### Views and sorting

A folder shows as **Details** (a table) or as **Small**, **Medium** or **Large
icons** with thumbnails of pictures, videos and songs. `V` switches view; the
sort menu orders by name, modified time, size or kind, with folders always
first. The choice is remembered per browser in a cookie.

Thumbnails are 384px WebP images cut by ffmpeg the first time they are needed
and kept in the cache; ones nobody has asked for in 30 days are deleted.

### Video playback

- **Direct play** when the browser can decode the file (`mp4` / `m4v` / `mov` /
  `webm` with H.264, VP8, VP9 or AV1 in 8-bit, and AAC, MP3, Opus, Vorbis or FLAC
  audio) and it is at most 20 Mbps.
- **Transcoded** to HLS otherwise, on demand, in every quality up to the
  source's (2160p to 480p). Pick a quality from the player's gear menu, or leave
  it on Auto. Seeking works anywhere. HEVC goes to browsers that can decode it.
- The **Playback** panel on a video's page shows the source, the mode and why,
  and the encoder in use. For a file that could play directly, it switches
  between the original and the transcode.
- Hovering the timeline shows **seek previews**.

Each transcode uses the first of these that works, and drops to the next if it
fails:

| Tier                | Decode       | Scale         | Encode                      |
| ------------------- | ------------ | ------------- | --------------------------- |
| NVIDIA              | NVDEC (CUDA) | `scale_cuda`  | `h264_nvenc` / `hevc_nvenc` |
| NVIDIA, hybrid      | CPU          | CPU           | `h264_nvenc` / `hevc_nvenc` |
| AMD / Intel         | VAAPI        | `scale_vaapi` | `h264_vaapi` / `hevc_vaapi` |
| AMD / Intel, hybrid | CPU          | CPU           | `h264_vaapi` / `hevc_vaapi` |
| CPU                 | CPU          | CPU           | `libx264` (H.264 only)      |

Encoders are tested with a short encode on first use, so a missing driver or
permission shows up as a fallback rather than a broken stream.

**Limits:** HDR is converted to 8-bit without tone mapping, only the first video
and audio stream are used, and subtitles are not carried over.

### Archives

An archive's page lists its contents and offers **Unpack here** (`E` in a
folder). `zip`, `tar`, `tar.gz`, `tar.bz2`, `tar.xz`, `tar.zst`, `7z`, `rar`,
`iso`, `jar`, `cbz` and `cbr` are supported; encrypted archives are not.

`photos.zip` unpacks to `photos/`, or to the single folder inside it if there is
one. Unpacking is all or nothing, paths leaving the folder are refused, and
symlinks are removed.

## Keyboard

| Where  | Keys                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Folder | `↑` `↓` select (`←` `→` in icon views) · `↵` open · `⌫` up · `/` filter · `V` view · `U` upload · `N` new folder · `R` rename · `M` move · `E` unpack · `Del` delete · `D` download |
| File   | `J` / `K` next / previous file · `⌫` back to folder · `D` download                                                           |

## HTTP API

Paths are URL-encoded segments relative to `FILES_ROOT`.

| Method       | Path                                    | Does                                                                          |
| ------------ | --------------------------------------- | ----------------------------------------------------------------------------- |
| `GET` `HEAD` | `/api/raw/<path>`                       | File bytes, with `Range` support. `?download=1` forces a download.            |
| `PUT`        | `/api/fs/<path>`                        | Upload; the body is the file. Missing folders are created, clashes become `name (1).ext`. |
| `POST`       | `/api/fs/<path>`                        | Create a folder.                                                              |
| `PATCH`      | `/api/fs/<path>`                        | Rename and/or move. Body: `{"name": "new name"}`, `{"to": ["Folder"]}` (`[]` is the root), or both. |
| `DELETE`     | `/api/fs/<path>`                        | Delete a file, or a folder and everything in it.                              |
| `POST`       | `/api/extract/<path>`                   | Unpack an archive beside itself. Answers `{"name", "path"}`.                  |
| `GET`        | `/api/hls/<path>/master.m3u8`           | Transcoded HLS stream. `?codec=hevc` for HEVC.                                |
| `GET`        | `/api/storyboard/<path>/storyboard.vtt` | Seek previews as WebVTT.                                                      |
| `GET`        | `/api/thumb/<path>`                     | A 384px WebP thumbnail, or 404 when there is nothing to draw.                 |
| `GET`        | `/api/transcode/status`                 | ffmpeg version, detected encoders and running jobs.                           |

```bash
curl -T clip.mp4 http://localhost:3300/api/fs/Videos/clip.mp4
```

## Security

There is **no login**. Anyone who can reach the port can read, upload, rename,
move and delete everything under `FILES_ROOT`, and start transcodes. Run it on a
trusted network, behind a VPN, or behind a reverse proxy that authenticates.

What it does guard against: paths can't leave `FILES_ROOT`; cross-site requests
can't change files; HTML, SVG and text are served sandboxed so they can't run
script; ffmpeg and bsdtar run without a shell; unpacked archives have their
symlinks removed.

## Design

The look is described in [`DESIGN.md`](./DESIGN.md), adapted from the Linear
entry in [awesome-design-md](https://github.com/VoltAgent/awesome-design-md).
Its tokens live in `app/globals.css`.
