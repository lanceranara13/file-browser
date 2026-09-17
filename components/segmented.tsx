"use client";

import type { ReactNode } from "react";

/**
 * A few mutually exclusive choices in a row (DESIGN.md: segmented control).
 * Buttons with aria-pressed rather than radios, so each is its own tab stop.
 * An option with an icon shows only the icon, and its label names it.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  busy = false,
  className = "",
}: {
  label: string;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={busy}
      className={`grid auto-cols-fr grid-flow-col gap-0.5 rounded-md border border-hairline bg-surface-1 p-0.5 transition-opacity duration-150 ${busy ? "opacity-60" : ""} ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            aria-label={option.icon ? option.label : undefined}
            title={option.icon ? option.label : undefined}
            onClick={() => onChange(option.value)}
            className={`h-[26px] rounded-sm text-button font-medium transition-colors duration-150 ease-out ${
              option.icon ? "inline-flex w-7 items-center justify-center" : ""
            } ${selected ? "bg-surface-3 text-ink" : "text-ink-subtle hover:text-ink"}`}
          >
            {option.icon ?? option.label}
          </button>
        );
      })}
    </div>
  );
}
