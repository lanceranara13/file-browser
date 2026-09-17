import fs from "node:fs/promises";
import type { NextRequest } from "next/server";
import { extractArchive } from "@/lib/archive";
import { errorResponse, FsError } from "@/lib/files";
import { copyMarks, relativeSegments } from "@/lib/hidden";
import { describe, resolveTarget } from "@/lib/route";

type Context = RouteContext<"/api/extract/[...path]">;

/**
 * Unpacks an archive beside itself. The answer names the folder it produced, so
 * the browser can go straight there.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { path: segments } = await context.params;
    const { target } = await resolveTarget(request, segments);
    if ((await fs.stat(target)).isDirectory()) throw new FsError(400, "That is a folder");

    const unpacked = await extractArchive(target);
    // A hidden archive unpacks to hidden contents; the output must not be the
    // thing that reveals what the archive was holding.
    await copyMarks(relativeSegments(target), relativeSegments(unpacked));
    return describe(unpacked, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
