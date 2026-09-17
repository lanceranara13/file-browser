"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

const STEP = "inline-flex size-7 items-center justify-center rounded-sm text-ink-subtle transition-colors duration-150";

export function SiblingControls({
  previous,
  next,
  position,
  parent,
  download,
}: {
  previous: string | null;
  next: string | null;
  position: string | null;
  parent: string;
  download: string;
}) {
  const router = useRouter();

  // j / k rather than arrows: arrow keys belong to the video player's seeking.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || document.fullscreenElement) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], dialog")) {
      return;
    }
    if (event.key === "j" && next) router.push(next);
    else if (event.key === "k" && previous) router.push(previous);
    else if (event.key === "Backspace") router.push(parent);
    else if (event.key === "d") window.location.assign(download);
    else return;
    event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <nav aria-label="Files in this folder" className="flex items-center gap-1">
      {position && <span className="mr-1.5 font-mono text-caption text-ink-tertiary tabular">{position}</span>}
      <Step href={previous} label="Previous file">
        <ChevronLeftIcon />
      </Step>
      <Step href={next} label="Next file">
        <ChevronRightIcon />
      </Step>
    </nav>
  );
}

function Step({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  if (!href) {
    return (
      <span aria-hidden className={`${STEP} opacity-40`}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} prefetch={false} aria-label={label} title={label} className={`${STEP} hover:bg-surface-2 hover:text-ink`}>
      {children}
    </Link>
  );
}
