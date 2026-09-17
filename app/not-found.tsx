import Link from "next/link";
import { connection } from "next/server";
import { buttonClass } from "@/components/button";
import { TopBar } from "@/components/chrome";
import { LockControl } from "@/components/lock-control";
import { view } from "@/lib/hidden";

export default async function NotFound() {
  // A hidden path lands here too, so the lock control has to be reachable from this page.
  await connection();
  const seen = await view();
  return (
    <div className="flex h-full flex-col">
      <TopBar>
        <LockControl lock={{ state: seen.state, kind: seen.kind }} />
      </TopBar>
      <main className="px-4 py-10 sm:px-6">
        <p className="font-mono text-caption text-ink-tertiary">404</p>
        <h1 className="mt-1 text-title font-semibold">Nothing here</h1>
        <p className="mt-2 text-body text-ink-subtle">That file or folder doesn’t exist, or it was moved.</p>
        <Link href="/files" className={buttonClass("secondary", "mt-5")}>
          Back to files
        </Link>
        {/* The knock is three taps on the mark. */}
        <p className="mt-10 font-mono text-caption text-ink-tertiary">Not everything missing is gone. Knock three times.</p>
      </main>
    </div>
  );
}
