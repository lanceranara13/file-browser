import type { ReactNode } from "react";

/** One label/value row inside a `grid-cols-[72px_minmax(0,1fr)]` definition list. */
export function Detail({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-subtle">{label}</dt>
      <dd className={`min-w-0 text-ink [overflow-wrap:anywhere] ${mono ? "font-mono" : ""}`}>{children}</dd>
    </>
  );
}
