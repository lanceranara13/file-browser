import type { ReactNode } from "react";

export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-hairline bg-surface-2 px-1 font-mono text-kbd text-ink-subtle ${className}`}
    >
      {children}
    </kbd>
  );
}
