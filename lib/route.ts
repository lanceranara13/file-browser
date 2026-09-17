// Shared by the route handlers that change the files root.
import path from "node:path";
import type { NextRequest } from "next/server";
import { FILES_ROOT, FsError } from "./files";
import { view } from "./hidden";

/**
 * Resolves URL segments for a mutating request: refuses cross-site callers, and
 * treats anything at or inside a hidden path as "not found" to a browser that
 * has not unlocked it.
 */
export async function resolveTarget(request: NextRequest, segments: readonly string[]) {
  // Browsers label cross-site requests; refuse them so another site cannot
  // drive these endpoints with a simple form POST. curl sends no header.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new FsError(403, "Cross-site requests are not allowed");
  }
  if (!segments.length) throw new FsError(400, "The files root cannot be changed");
  const seen = await view();
  return { segments, seen, target: seen.resolve(segments) };
}

/** The shape every mutation answers with: the item's name and its path below the files root. */
export function describe(target: string, status: number) {
  return Response.json(
    { name: path.basename(target), path: path.relative(FILES_ROOT, target).split(path.sep) },
    { status },
  );
}
