"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { CheckIcon } from "./icons";

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      /** One of a set of choices: drawn with a check when picked, and announced as a radio. */
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
      /** A plain link, for downloads and anything else that must not go through client routing. */
      href?: string;
      onSelect?: () => void;
    }
  | "separator";

const GAP = 4;
const MARGIN = 8;
const ITEMS = "[role^=menuitem]:not(:disabled)";

/**
 * A button that opens a short list (DESIGN.md: menu). A native popover, so the
 * browser owns light dismiss, Escape, the top layer and giving focus back to the
 * button; this places it under the button and moves focus with the arrow keys.
 */
export function Menu({
  label,
  items,
  className,
  children,
}: {
  /** Names both the button and the menu. */
  label: string;
  items: readonly MenuItem[];
  className: string;
  children: ReactNode;
}) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!menu || !button) return;
    const close = () => menu.hidePopover();

    // Before it shows: under the button with the right edges aligned, which
    // takes no measuring — so the menu is never painted anywhere else first.
    const beforeToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      const anchor = button.getBoundingClientRect();
      menu.style.top = `${anchor.bottom + GAP}px`;
      menu.style.right = `${document.documentElement.clientWidth - anchor.right}px`;
      menu.style.left = "auto";
    };

    // Once it shows and has a size: keep it on screen, then hand it the focus.
    const toggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") {
        window.removeEventListener("scroll", close, true);
        window.removeEventListener("resize", close);
        return;
      }
      const anchor = button.getBoundingClientRect();
      const box = menu.getBoundingClientRect();
      if (box.left < MARGIN) {
        menu.style.right = "auto";
        menu.style.left = `${Math.max(MARGIN, anchor.left)}px`;
      }
      if (box.bottom > window.innerHeight - MARGIN && anchor.top - box.height - GAP >= MARGIN) {
        menu.style.top = `${anchor.top - box.height - GAP}px`;
      }
      (menu.querySelector<HTMLElement>(`${ITEMS}[aria-checked=true]`) ?? menu.querySelector<HTMLElement>(ITEMS))?.focus({
        preventScroll: true,
      });
      // A fixed menu would drift away from its button as the page moved under it.
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    };

    menu.addEventListener("beforetoggle", beforeToggle);
    menu.addEventListener("toggle", toggle);
    return () => {
      menu.removeEventListener("beforetoggle", beforeToggle);
      menu.removeEventListener("toggle", toggle);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      event.preventDefault();
      event.currentTarget.hidePopover();
      return;
    }
    const enabled = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
    const index = enabled.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: enabled.length - 1 };
    const next = moves[event.key];
    if (next === undefined || !enabled.length) return;
    event.preventDefault();
    enabled.at(next % enabled.length)?.focus();
  }

  const close = () => menuRef.current?.hidePopover();

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={id}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        className={className}
      >
        {children}
      </button>
      <div
        ref={menuRef}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="edge-lit fixed inset-auto m-0 min-w-44 rounded-md border border-hairline-strong bg-surface-2 p-1 text-ink"
      >
        {items.map((item, index) =>
          item === "separator" ? (
            <div key={index} role="separator" className="-mx-1 my-1 h-px bg-hairline" />
          ) : (
            <Item key={item.label} item={item} close={close} />
          ),
        )}
      </div>
    </>
  );
}

function Item({ item, close }: { item: Exclude<MenuItem, "separator">; close: () => void }) {
  const className = [
    "flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-button whitespace-nowrap text-ink-muted",
    "transition-colors duration-150 ease-out hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-40",
    item.danger ? "hover:text-danger focus-visible:text-danger" : "hover:text-ink focus-visible:text-ink",
  ].join(" ");
  const content = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center text-ink-subtle">
        {item.checked ? <CheckIcon className="text-ink" /> : item.icon}
      </span>
      {item.label}
    </>
  );

  if (item.href) {
    return (
      <a role="menuitem" href={item.href} onClick={close} className={className}>
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      role={item.checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={item.checked}
      disabled={item.disabled}
      onClick={() => {
        close();
        item.onSelect?.();
      }}
      className={className}
    >
      {content}
    </button>
  );
}
