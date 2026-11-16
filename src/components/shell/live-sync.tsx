"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "../toast";

type Live = { v: number; a: string | null; n: number; t?: string };

/**
 * Keeps an open app current without a page reload: every 20 seconds (and
 * whenever the tab comes back to the foreground) it asks the server for a tiny
 * fingerprint of the schedule, announcements and inbox, and re-renders if any
 * of them changed. Polling is deliberately simple: it works on any host and
 * through flaky paddock connections.
 */
export function LiveSync() {
  const router = useRouter();
  const last = useRef<Live | null>(null);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok || stopped) return;
        const next = (await res.json()) as Live;
        const prev = last.current;
        if (!prev) {
          last.current = next; // first answer is the baseline
          return;
        }
        if (next.v !== prev.v || next.a !== prev.a || next.n !== prev.n) {
          if (next.v !== prev.v) toast("The schedule was updated");
          else if (next.a !== prev.a && next.t) toast(`New announcement: ${next.t}`);
          last.current = next;
          router.refresh();
        }
      } catch {
        /* offline: try again on the next tick */
      }
    };
    check();
    const id = setInterval(check, 20000);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  return null;
}
