import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ClockProvider } from "@/components/clock";
import { DemoClockBar } from "@/components/shell/demo-clock";
import { LiveSync } from "@/components/shell/live-sync";
import { BottomNav, Sidebar, TopBar } from "@/components/shell/nav";
import { shellProps } from "@/components/shell/props";
import { Toaster } from "@/components/toast";
import { dateRange } from "@/lib/time";
import { clockProps, demoMode, getViewer } from "@/server/auth";
import { adminBadges, eventDays, unreadCount } from "@/server/queries";

/*
 * The frame is static so a tapped tab can paint immediately: the page area
 * shows its loading state (loading.tsx) while the page's live data streams in,
 * and the navigation chrome, which depends on who is signed in, streams in
 * beside it.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame min-h-dvh lg:pl-64">
      <Suspense fallback={<ChromeSkeleton />}>
        <Chrome />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+2.5rem)] sm:px-6 lg:px-8 lg:pt-8 lg:pb-16">{children}</main>
      <Toaster />
    </div>
  );
}

async function Chrome() {
  const v = await getViewer();
  const [unread, badges] = await Promise.all([
    unreadCount(v.user.id),
    v.isAdmin ? adminBadges(v.org.id, v.event?.id ?? null) : Promise.resolve({ tech: 0, promotions: 0, incidents: 0 }),
  ]);
  const props = shellProps(v, unread, badges);

  return (
    <ClockProvider {...clockProps(v)}>
      {/* The wristband: the whole app picks up the wearer's run-group colour. */}
      <style>{`:root{--group:${v.group?.color ?? "#14171a"};--group-ink:${v.group?.textColor ?? "#ffffff"}}`}</style>
      <Sidebar {...props} />
      <TopBar {...props} />
      {demoMode() && v.event ? <DemoClockBar days={eventDays(v.event)} simulated={v.clockOffsetMs !== 0} /> : null}
      {v.viewingOtherEvent && v.event ? (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 bg-flag-yellow px-4 py-2 text-sm font-semibold text-ink sm:px-6 lg:px-8">
          <span>
            You are looking at {v.event.name} ({dateRange(v.event.startDate, v.event.endDate)}), not the current event.
          </span>
          <Link href="/admin/events" className="underline underline-offset-4">
            Switch event
          </Link>
        </div>
      ) : null}
      <BottomNav {...props} />
      <LiveSync />
    </ClockProvider>
  );
}

function ChromeSkeleton() {
  return (
    <>
      <div className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-surface lg:block">
        <div className="h-1.5 bg-ink" />
        <div className="p-5">
          <p className="eyebrow text-ink-2">Track Day</p>
        </div>
      </div>
      <div className="lg:hidden">
        <div className="h-1.5 bg-ink" />
        <div className="h-13 border-b border-line" />
      </div>
      <div className="fixed inset-x-0 bottom-0 h-[var(--nav-h)] border-t border-line bg-surface lg:hidden" />
    </>
  );
}
