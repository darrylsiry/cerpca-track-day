"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { ActionButton } from "@/components/form";
import { cn } from "@/lib/cn";
import { markRead } from "../alerts/actions";

export type UrgentAlert = { id: string; title: string; body: string; href: string | null; ago: string };

/**
 * Unread urgent alerts, first thing on the Now screen: a schedule change, a
 * cancelled session, a hazard on track. Each stays until the person taps
 * "Got it". Only the newest few are shown in full, so the board below is never
 * pushed off the first screen of a phone; the rest are one tap away.
 */
export function UrgentAlerts({ alerts, more }: { alerts: UrgentAlert[]; more: number }) {
  if (!alerts.length) return null;
  const several = alerts.length > 1;
  return (
    <section aria-label="Urgent alerts" className="mb-4 space-y-2">
      {alerts.map((a) => (
        <div key={a.id} className="flex overflow-hidden rounded-[14px] border border-ink/20 bg-flag-yellow text-ink">
          <span className="w-2 shrink-0 bg-ink" aria-hidden />
          <div className="min-w-0 flex-1 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow flex items-center gap-1.5 text-[11px]">
                  <TriangleAlert className="size-3.5 shrink-0" strokeWidth={2.6} aria-hidden />
                  Urgent · {a.ago}
                </p>
                <p className="mt-1 text-[17px] leading-snug font-bold">{a.title}</p>
              </div>
              <ActionButton action={markRead.bind(null, a.id)} variant="primary" successMessage={false} className="shrink-0" aria-label={`Got it: ${a.title}`}>
                Got it
              </ActionButton>
            </div>
            {a.body ? <p className={cn("mt-1 text-[15px]", several ? "line-clamp-2" : "line-clamp-3")}>{a.body}</p> : null}
            {a.href && a.href !== "/home" ? (
              <Link href={a.href} className="mt-1.5 inline-block text-[15px] font-semibold underline underline-offset-4">
                {a.href.startsWith("/schedule") ? "See the schedule" : "Open"}
              </Link>
            ) : null}
          </div>
        </div>
      ))}
      {more > 0 ? (
        <Link href="/alerts" className="flex items-center justify-between gap-3 rounded-[14px] border border-ink/20 bg-flag-yellow px-4 py-2.5 text-[15px] font-bold text-ink">
          <span>
            {more} more urgent alert{more === 1 ? "" : "s"} unread
          </span>
          <span className="underline underline-offset-4">See all</span>
        </Link>
      ) : null}
    </section>
  );
}
