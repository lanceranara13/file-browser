"use client";

import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import { MarkIcon } from "./icons";

/*
 * The lock control is not in the top bar until it is asked for, so nothing on
 * screen says hiding exists. It is out of sight, not out of the page: this
 * button's own label names it, so a screen reader — or anyone reading the DOM —
 * still finds it. That is the trade for keeping the gesture reachable.
 *
 * Asking for it is TAPS quick presses on the mark — the same gesture with a
 * finger, a mouse, or Enter on the focused mark, which is what makes it work on
 * a phone as well as a desktop — or Shift+H where there is a keyboard.
 *
 * It lives in module state rather than storage: it lapses on reload, is never
 * sent to the server, and is only about what the chrome shows. Whether hidden
 * items themselves can be seen is the server's business, not this flag's.
 */

const TAPS = 3;
/** A tap this long after the last one starts the count again. */
const WINDOW_MS = 1200;

let revealed = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setRevealed(next: boolean) {
  if (next === revealed) return;
  revealed = next;
  for (const listener of listeners) listener();
}

/** Put the control away again — on Lock, so re-locking also takes back the gesture. */
export const hideControl = () => setRevealed(false);

/** Whether the lock control is showing. False during SSR and hydration, so both renders match. */
export function useRevealed() {
  return useSyncExternalStore(
    subscribe,
    () => revealed,
    () => false,
  );
}

/** The top-bar mark, which doubles as the gesture that shows or hides the lock control. */
export function RevealTrigger() {
  const taps = useRef({ count: 0, at: 0 });

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "H" || event.defaultPrevented || event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    setRevealed(!revealed);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // `click` rather than pointer or touch events: it is the one thing a finger, a
  // mouse and Enter on the focused button all produce.
  function tap() {
    const now = Date.now();
    const count = now - taps.current.at > WINDOW_MS ? 1 : taps.current.count + 1;
    taps.current = { count, at: now };
    if (count < TAPS) return;
    taps.current = { count: 0, at: 0 };
    setRevealed(!revealed);
  }

  return (
    <button
      type="button"
      onClick={tap}
      // Named for what it does, so a screen reader can reach it. The gesture
      // keeps the control out of sight, not out of the page.
      aria-label="Hidden items control"
      // touch-manipulation: without it iOS reads taps 2 and 3 as a zoom.
      className="-mx-1.5 flex size-7 shrink-0 cursor-default touch-manipulation items-center justify-center rounded-xs text-ink select-none"
    >
      <MarkIcon className="text-ink" />
    </button>
  );
}
