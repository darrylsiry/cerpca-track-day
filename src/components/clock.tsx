"use client";

import { createContext, use, useSyncExternalStore, type ReactNode } from "react";
import { zoned, type ZonedNow } from "@/lib/time";

/*
 * The track clock. Every "on track now / next up / you're in 12:40" on screen is
 * computed in the browser from this, once a second, against the schedule the
 * server sent. `offsetMs` is the demo clock shift (0 in normal use).
 */
type ClockValue = { tz: string; offsetMs: number; serverNowMs: number };
const ClockContext = createContext<ClockValue>({ tz: "America/New_York", offsetMs: 0, serverNowMs: 0 });

export function ClockProvider({ children, ...value }: ClockValue & { children: ReactNode }) {
  return <ClockContext value={value}>{children}</ClockContext>;
}

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) timer = setInterval(() => listeners.forEach((l) => l()), 1000);
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
const snapshot = () => Math.floor(Date.now() / 1000);

/** Current instant (ms) on the track clock, ticking every second. */
export function useNowMs(): number {
  const { offsetMs, serverNowMs } = use(ClockContext);
  // During hydration this returns the server's instant so the markup matches, then goes live.
  const sec = useSyncExternalStore(subscribe, snapshot, () => Math.floor((serverNowMs - offsetMs) / 1000));
  return sec * 1000 + offsetMs;
}

/** Local day + time at the track, plus seconds as a float for smooth progress. */
export function useTrackNow(): ZonedNow & { ms: number; tz: string; simulated: boolean } {
  const { tz, offsetMs } = use(ClockContext);
  const ms = useNowMs();
  return { ...zoned(new Date(ms), tz), ms, tz, simulated: offsetMs !== 0 };
}

export function useClockMeta() {
  return use(ClockContext);
}
