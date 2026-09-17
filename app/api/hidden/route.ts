import fs from "node:fs/promises";
import type { NextRequest } from "next/server";
import { errorResponse, FsError } from "@/lib/files";
import { changeSecret, lock, relativeSegments, rememberUnlock, setMark, setUp, unlock, view } from "@/lib/hidden";

/**
 * POST `{ "action": … }`:
 * `setup` { kind, secret } · `unlock` { secret } · `lock` · `change` { current, kind, secret } ·
 * `hide` / `unhide` { path: string[] }. Hiding and unhiding need an unlocked browser.
 */
export async function POST(request: NextRequest) {
  try {
    // Browsers label cross-site requests; refuse them so another site cannot
    // drive this endpoint with a simple form POST. curl sends no header.
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") {
      throw new FsError(403, "Cross-site requests are not allowed");
    }
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

    switch (body.action) {
      case "setup":
        await rememberUnlock(await setUp(body.kind, body.secret));
        break;
      case "unlock":
        await rememberUnlock(await unlock(body.secret));
        break;
      case "lock":
        await lock();
        break;
      case "change":
        if ((await view()).state !== "unlocked") throw new FsError(403, "Unlock hidden items first");
        await rememberUnlock(await changeSecret(body.current, body.kind, body.secret));
        break;
      case "hide":
      case "unhide": {
        const seen = await view();
        if (seen.state !== "unlocked") {
          throw new FsError(403, seen.state === "unset" ? "Set up a PIN or password first" : "Unlock hidden items first");
        }
        const segments = Array.isArray(body.path) && body.path.every((name) => typeof name === "string") ? body.path : [];
        const target = seen.resolve(segments);
        await fs.lstat(target);
        await setMark(relativeSegments(target), body.action === "hide");
        break;
      }
      default:
        throw new FsError(400, "Unknown action");
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
