import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "ghost-danger" | "danger";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "border border-hairline bg-surface-1 text-ink hover:bg-surface-2 active:bg-surface-3",
  ghost: "text-ink-subtle hover:bg-surface-2 hover:text-ink",
  "ghost-danger": "text-ink-subtle hover:bg-surface-2 hover:text-danger",
  danger: "bg-danger text-white hover:bg-danger/85",
};

export function buttonClass(variant: ButtonVariant = "secondary", className = "") {
  return [
    "inline-flex h-[30px] shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3",
    "text-button font-medium transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-50",
    VARIANT[variant],
    className,
  ].join(" ");
}

export function Button({
  variant,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type="button" {...props} className={buttonClass(variant, className)} />;
}

const ICON_BASE =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-subtle transition-colors duration-150 " +
  "hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-40";

export function IconButton({
  label,
  danger,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`${ICON_BASE} ${danger ? "hover:text-danger" : "hover:text-ink"} ${className}`}
    />
  );
}

/** Plain anchor for API URLs (downloads, raw files) that must not go through client routing. */
export function IconAnchor({ label, className = "", ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { label: string }) {
  return <a aria-label={label} title={label} {...props} className={`${ICON_BASE} hover:text-ink ${className}`} />;
}
