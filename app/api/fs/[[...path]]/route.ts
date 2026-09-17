import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { NextRequest } from "next/server";
import { assertValidName, availablePath, ensureRoot, errorResponse, FsError, PART_SUFFIX } from "@/lib/files";
import { copyMarks, dropMarks, relativeSegments, within } from "@/lib/hidden";
import { describe, resolveTarget } from "@/lib/route";

type Context = RouteContext<"/api/fs/[[...path]]">;

async function resolve(request: NextRequest, context: Context) {
  const { path: segments = [] } = await context.params;
  return resolveTarget(request, segments);
}

/**
 * Moves an item, carrying its hidden marks. Marks are copied to the new path
 * before the move and dropped from the old one after, so a failure part way
 * leaves the item hidden rather than showing it.
 */
async function relocate(target: string, destination: string) {
  const from = relativeSegments(target);
  const to = relativeSegments(destination);
  await copyMarks(from, to);
  try {
    await fs.rename(target, destination);
  } catch (error) {
    await dropMarks(to).catch(() => {});
    throw error;
  }
  await dropMarks(from);
}

/** Upload. The body is streamed to a hidden part file, then renamed into place. */
export async function PUT(request: NextRequest, context: Context) {
  let partial: string | undefined;
  try {
    const { target } = await resolve(request, context);
    assertValidName(path.basename(target));
    await ensureRoot();
    const directory = path.dirname(target);
    await fs.mkdir(directory, { recursive: true });

    partial = path.join(directory, `.upload-${Date.now()}-${Math.random().toString(36).slice(2)}${PART_SUFFIX}`);
    const source = request.body
      ? Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>)
      : Readable.from([]);
    await pipeline(source, createWriteStream(partial, { flags: "wx" }));

    // Never overwrite: a clash becomes "name (1).ext".
    const destination = await availablePath(directory, path.basename(target));
    await fs.rename(partial, destination);
    partial = undefined;
    return describe(destination, 201);
  } catch (error) {
    if (partial) await fs.rm(partial, { force: true }).catch(() => {});
    return errorResponse(error);
  }
}

/** Create a folder. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { target } = await resolve(request, context);
    assertValidName(path.basename(target));
    await ensureRoot();
    await fs.mkdir(target);
    return describe(target, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Rename, move, or both. Body: `{ "name"?: "new name", "to"?: ["folder"] }`.
 * `to` is the destination folder as segments below the files root — `[]` is the
 * root itself. Omitting a field keeps the current name or folder. Hidden marks
 * move with the item.
 */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { segments, seen, target } = await resolve(request, context);
    const body = (await request.json().catch(() => null)) as { name?: unknown; to?: unknown } | null;
    // A name is only checked when one was given: a plain move must not trip over
    // a name already on disk that this app would not have created.
    let name = path.basename(target);
    if (body?.name !== undefined) {
      name = typeof body.name === "string" ? body.name.trim() : "";
      assertValidName(name);
    }

    let parent: string[];
    if (body?.to === undefined) {
      parent = segments.slice(0, -1);
    } else if (Array.isArray(body.to) && body.to.every((segment) => typeof segment === "string")) {
      parent = body.to as string[];
    } else {
      throw new FsError(400, "Invalid destination folder");
    }

    await fs.stat(target);
    // A hidden destination is "not found" to a browser that has not unlocked it,
    // so `resolve` is what keeps a move from probing for hidden folders.
    const destinationParent = seen.resolve(parent);
    if (!(await fs.stat(destinationParent)).isDirectory()) {
      throw new FsError(400, "The destination is not a folder");
    }
    const destination = seen.resolve([...parent, name]);
    if (destination === target) return describe(target, 200);

    // Without this the rename fails with EINVAL, which has no friendly message.
    // Strictly longer: an equal path is a case-only rename, which the clash
    // check below is what handles.
    const fold = (names: string[]) => names.map((segment) => segment.toLowerCase());
    const from = fold(relativeSegments(target));
    const to = fold(relativeSegments(destination));
    if (to.length > from.length && within(to, from)) {
      throw new FsError(400, "A folder cannot be moved into itself");
    }

    const taken = await fs.lstat(destination).then(
      () => true,
      () => false,
    );
    // On case-insensitive disks a case-only rename finds the file itself.
    if (taken && destination.toLowerCase() !== target.toLowerCase()) {
      throw new FsError(409, `"${name}" already exists`);
    }

    await relocate(target, destination);
    return describe(destination, 200);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Delete a file, or a folder and everything in it. */
export async function DELETE(request: NextRequest, context: Context) {
  try {
    const { seen, target } = await resolve(request, context);
    await fs.stat(target);
    // Someone who cannot see hidden items cannot destroy them along with the folder around them.
    if (seen.state === "locked" && seen.holdsHidden(target)) {
      throw new FsError(409, "This folder holds hidden items. Unlock them to delete it.");
    }
    await fs.rm(target, { recursive: true });
    await dropMarks(relativeSegments(target));
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
