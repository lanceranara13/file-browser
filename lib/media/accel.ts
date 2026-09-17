import { readdirSync, readFileSync } from "node:fs";
import type { Codec } from "@/lib/playback";
import { run } from "@/lib/run";
import { FFMPEG } from "./ffmpeg";

export type AccelKind = "nvenc" | "vaapi" | "cpu";

export interface Accelerator {
  kind: AccelKind;
  encoder: "h264_nvenc" | "h264_vaapi" | "libx264";
  /**
   * The HEVC encoder, when it passed a test encode too. Never on the CPU: libx265
   * is far too slow to transcode while someone watches.
   */
  hevc: "hevc_nvenc" | "hevc_vaapi" | null;
  vendor: string;
  /** DRM render node for VAAPI. */
  device: string | null;
  /** Whether frames can be scaled without leaving the GPU (scale_cuda / scale_vaapi). */
  gpuScaler: boolean;
}

export interface Capabilities {
  /** ffmpeg version, or null when no ffmpeg binary runs. */
  ffmpeg: string | null;
  /** Best first; the CPU is always last when ffmpeg exists. */
  accelerators: Accelerator[];
}

const PCI_VENDORS: Record<string, string> = { "0x1002": "AMD", "0x10de": "NVIDIA", "0x8086": "Intel" };

function renderNodes() {
  try {
    return readdirSync("/dev/dri")
      .filter((name) => name.startsWith("renderD"))
      .sort()
      .map((name) => `/dev/dri/${name}`);
  } catch {
    return [];
  }
}

function vendorOf(device: string) {
  try {
    const id = readFileSync(`/sys/class/drm/${device.split("/").pop()}/device/vendor`, "utf8").trim();
    return PCI_VENDORS[id] ?? "GPU";
  } catch {
    return "GPU";
  }
}

async function nvidiaName() {
  const result = await run("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], 5_000);
  return result.code === 0 ? result.stdout.split("\n")[0].trim() || null : null;
}

/**
 * A three-frame encode. Listing an encoder proves nothing about drivers, device
 * nodes or permissions inside a container; actually encoding proves all three.
 */
async function canEncode(before: string[], after: string[]) {
  const result = await run(
    FFMPEG,
    ["-hide_banner", "-nostdin", "-loglevel", "error", ...before, "-f", "lavfi", "-i", "color=black:s=320x240:r=5", "-frames:v", "3", ...after, "-f", "null", "-"],
    15_000,
  );
  return result.code === 0;
}

async function detect(): Promise<Capabilities> {
  const version = await run(FFMPEG, ["-hide_banner", "-version"], 10_000);
  if (version.code !== 0) return { ffmpeg: null, accelerators: [] };

  const [encoders, filters] = await Promise.all([
    run(FFMPEG, ["-hide_banner", "-encoders"]),
    run(FFMPEG, ["-hide_banner", "-filters"]),
  ]);
  const listed = (text: string, name: string) => new RegExp(`\\s${name}\\s`).test(text);
  const preference = (process.env.TRANSCODE_HWACCEL || "auto").toLowerCase();
  const allowed = (kind: AccelKind) => preference === "auto" || preference === kind;
  // TRANSCODE_HEVC=off skips the HEVC test encodes, so HEVC is never offered.
  const hevcAllowed = (process.env.TRANSCODE_HEVC || "auto").toLowerCase() !== "off";
  const accelerators: Accelerator[] = [];

  // NVIDIA: works wherever the driver's encode library is loadable — a host, or a
  // container the NVIDIA toolkit passed a GPU into.
  if (
    allowed("nvenc") &&
    listed(encoders.stdout, "h264_nvenc") &&
    (await canEncode([], ["-vf", "format=nv12", "-c:v", "h264_nvenc"]))
  ) {
    const hevc =
      hevcAllowed &&
      listed(encoders.stdout, "hevc_nvenc") &&
      (await canEncode([], ["-vf", "format=nv12", "-c:v", "hevc_nvenc"]));
    accelerators.push({
      kind: "nvenc",
      encoder: "h264_nvenc",
      hevc: hevc ? "hevc_nvenc" : null,
      vendor: (await nvidiaName()) ?? "NVIDIA",
      device: null,
      gpuScaler: listed(filters.stdout, "scale_cuda"),
    });
  }

  // AMD and Intel: VAAPI through a DRM render node.
  if (allowed("vaapi") && listed(encoders.stdout, "h264_vaapi")) {
    for (const device of renderNodes()) {
      if (await canEncode(["-vaapi_device", device], ["-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi"])) {
        const hevc =
          hevcAllowed &&
          listed(encoders.stdout, "hevc_vaapi") &&
          (await canEncode(["-vaapi_device", device], ["-vf", "format=nv12,hwupload", "-c:v", "hevc_vaapi"]));
        accelerators.push({
          kind: "vaapi",
          encoder: "h264_vaapi",
          hevc: hevc ? "hevc_vaapi" : null,
          vendor: vendorOf(device),
          device,
          gpuScaler: listed(filters.stdout, "scale_vaapi"),
        });
        break;
      }
    }
  }

  if (preference !== "auto" && preference !== "cpu" && !accelerators.length) {
    console.warn(`[transcode] TRANSCODE_HWACCEL=${preference}, but no working ${preference} encoder was found; using the CPU`);
  }
  accelerators.push({ kind: "cpu", encoder: "libx264", hevc: null, vendor: "CPU", device: null, gpuScaler: false });

  const ffmpeg = version.stdout.split("\n")[0]?.replace(/^ffmpeg version\s+/, "").split(" ")[0] || "unknown";
  console.log(`[transcode] ffmpeg ${ffmpeg}; encoders: ${accelerators.map((accelerator) => describeAccelerator(accelerator)).join(", ")}`);
  return { ffmpeg, accelerators };
}

const store = globalThis as typeof globalThis & { __fbCapabilities?: { nodes: string; detected: Promise<Capabilities> } };

/**
 * Detected on first use, and again whenever the DRM render nodes change. A GPU
 * driver that finishes loading after the app has started — as it can after a
 * boot — adds its node late, and the first detection would otherwise leave
 * transcoding on the CPU until a restart.
 */
export function capabilities() {
  const nodes = renderNodes().join(" ");
  const current = store.__fbCapabilities;
  if (current && current.nodes === nodes) return current.detected;
  const next = { nodes, detected: detect() };
  store.__fbCapabilities = next;
  return next.detected;
}

/** Whether HEVC transcodes are offered: some GPU passed an HEVC test encode. */
export function offersHevc({ accelerators }: Capabilities) {
  return accelerators.some((accelerator) => accelerator.hevc);
}

/** An accelerator's encoders — or, given a codec, the one for that codec — and the device behind them. */
export function describeAccelerator(accelerator: Accelerator, codec?: Codec) {
  const encoders = codec ? [codec === "hevc" ? accelerator.hevc : accelerator.encoder] : [accelerator.encoder, accelerator.hevc];
  return [...encoders, accelerator.vendor, accelerator.device?.split("/").pop()].filter(Boolean).join(" · ");
}
