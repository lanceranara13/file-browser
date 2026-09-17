import Link from "next/link";
import { Fragment, type AnchorHTMLAttributes, type ReactNode } from "react";
import { RevealTrigger } from "./reveal";
import { browseHref } from "@/lib/paths";

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 sm:px-6">
      {/* The mark is a button, not part of the home link: it carries the gesture that shows the lock control. */}
      <div className="flex items-center gap-2">
        <RevealTrigger />
        <Link href="/files" className="rounded-xs font-mono text-button font-medium text-ink">
          file-browser
        </Link>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}

/** Breadcrumb trail, the current name as the page title, and a mono meta line. */
export function PathHeader({
  segments,
  meta,
  crumbProps,
  children,
}: {
  segments: readonly string[];
  meta?: ReactNode;
  /**
   * Extra props for each crumb, given the folder it leads to. Only the browser
   * passes it, to make the trail a drop target for moving an item up; a server
   * render leaves it out and the crumbs stay plain links.
   */
  crumbProps?: (crumb: string[]) => AnchorHTMLAttributes<HTMLAnchorElement>;
  children?: ReactNode;
}) {
  const parents = segments.slice(0, -1);
  return (
    <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pt-5 pb-4 sm:px-6">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center font-mono text-caption text-ink-subtle">
          {segments.length === 0 ? (
            <span className="text-ink-tertiary">/</span>
          ) : (
            [["files", [] as string[]] as const, ...parents.map((name, i) => [name, parents.slice(0, i + 1)] as const)].map(
              ([label, crumb], i) => (
                <Fragment key={i}>
                  <Link
                    href={browseHref(crumb)}
                    {...crumbProps?.([...crumb])}
                    className="max-w-[20ch] truncate rounded-xs transition-colors duration-150 hover:text-ink data-drop:text-ink data-drop:outline data-drop:outline-dashed data-drop:outline-offset-2 data-drop:outline-hairline-strong"
                  >
                    {label}
                  </Link>
                  <span className="px-1.5 text-ink-tertiary">/</span>
                </Fragment>
              ),
            )
          )}
        </nav>
        <h1 className="mt-1 truncate text-title font-semibold">{segments.at(-1) ?? "Files"}</h1>
        {meta && <p className="mt-1 font-mono text-caption text-ink-subtle tabular">{meta}</p>}
      </div>
      {children}
    </div>
  );
}
