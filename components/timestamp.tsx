"use client";

import { useSyncExternalStore } from "react";
import { formatTimestamp } from "@/lib/format";

const subscribe = () => () => {};

/** False during SSR and hydration, true afterwards — without a setState-in-effect. */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function Timestamp({ ms }: { ms: number }) {
  const hydrated = useHydrated();
  return <time dateTime={new Date(ms).toISOString()}>{formatTimestamp(ms, !hydrated)}</time>;
}
