import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/form";
import { PushToggle } from "@/components/push-toggle";
import { screen } from "@/components/shell/skeleton";
import { Card, EmptyState, PageHeader, Segmented } from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { cn, plural } from "@/lib/cn";
import { leadTimes, relativeTime } from "@/lib/time";
import { getViewer } from "@/server/auth";
import { markAllRead } from "./actions";
import { AlertList, type AlertRow } from "./alert-list";

export const metadata: Metadata = { title: "Alerts" };

const TABS = {
  all: { label: "All", kinds: null },
  announcements: { label: "Announcements", kinds: ["announcement"] },
  reminders: { label: "Reminders", kinds: ["reminder", "schedule"] },
} as const;
type Tab = keyof typeof TABS;

export default screen(async function AlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const v = await getViewer();
  const sp = await searchParams;
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "all";
  const db = await getDb();
  const mineOnly = eq(s.notifications.userId, v.user.id);
  const kinds = TABS[tab].kinds;

  const [rows, [unread], [devices]] = await Promise.all([
    db
      .select()
      .from(s.notifications)
      .where(kinds ? and(mineOnly, inArray(s.notifications.kind, [...kinds])) : mineOnly)
      .orderBy(desc(s.notifications.createdAt))
      .limit(150),
    db.select({ n: count() }).from(s.notifications).where(and(mineOnly, isNull(s.notifications.readAt))),
    db.select({ n: count() }).from(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, v.user.id)),
  ]);
  const unreadCount = unread?.n ?? 0;
  // Until some device of theirs has notifications on, lead with the switch: reminders depend on it.
  const pushFirst = (devices?.n ?? 0) === 0;

  // "15, 10 and 5 minutes", from the region's own reminder settings.
  const lead = leadTimes(v.org.settings.reminderOffsets) ?? "shortly";

  const list: AlertRow[] = rows.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href,
    urgent: n.urgent,
    read: Boolean(n.readAt),
    when: relativeTime(n.createdAt, v.nowMs),
  }));

  return (
    <>
      <PageHeader
        title="Alerts"
        lede={unreadCount ? `${plural(unreadCount, "unread alert")}. Announcements from the organizers and reminders before your sessions land here.` : "You are all caught up. Announcements from the organizers and reminders before your sessions land here."}
        actions={
          unreadCount ? (
            <ActionButton action={markAllRead} variant="secondary">
              Mark all read
            </ActionButton>
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className={cn("min-w-0", pushFirst && "order-2 lg:order-1")}>
          <Segmented
            label="Filter alerts"
            current={tab}
            items={(Object.keys(TABS) as Tab[]).map((key) => ({ key, href: key === "all" ? "/alerts" : `/alerts?tab=${key}`, label: TABS[key].label }))}
            className="mb-4"
          />
          {list.length ? (
            <AlertList rows={list} />
          ) : (
            <EmptyState title={tab === "all" ? "No alerts yet" : `No ${TABS[tab].label.toLowerCase()} yet`}>
              {tab === "reminders"
                ? `Reminders arrive ${lead} before your run group goes on track and before your classroom sessions.`
                : "When the organizers post an announcement for you or your run group, it will show up here."}
            </EmptyState>
          )}
        </div>

        <div className={cn("min-w-0 space-y-4", pushFirst && "order-1 lg:order-2")}>
          <PushToggle />
          <Card className="px-4 py-4 text-[15px] text-ink-2 sm:px-5">
            <h2 className="eyebrow mb-2 text-ink-2">How alerts reach you</h2>
            <p>Everything is always listed here. Email, text and push are extra, and you choose which ones you want.</p>
            <p className="mt-2">On iPhone and iPad, push notifications only work after you add Track Day to your Home Screen: in Safari tap Share, then Add to Home Screen, and open the app from there.</p>
            <Link href="/me#notifications" className="mt-2 inline-flex h-9 items-center font-semibold text-ink underline underline-offset-4">
              Notification settings
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
});
