import { count, eq, ne } from "drizzle-orm";
import type { Metadata } from "next";
import { switchEvent } from "@/app/(app)/actions";
import { ActionButton } from "@/components/form";
import { screen } from "@/components/shell/skeleton";
import { Card, PageHeader, Pill, SectionTitle } from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { cn } from "@/lib/cn";
import { dateRange } from "@/lib/time";
import { orgEvents } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { EditEventSheet, NewEventSheet } from "./forms";

export const metadata: Metadata = { title: "Events and history" };

export default screen(async function EventsPage() {
  const v = await requireAdmin();
  const db = await getDb();
  const [events, tracks, regs, logs, promos, incidents] = await Promise.all([
    orgEvents(v.org.id),
    db.select({ id: s.tracks.id, name: s.tracks.name }).from(s.tracks),
    db
      .select({ eventId: s.registrations.eventId, n: count() })
      .from(s.registrations)
      .where(ne(s.registrations.status, "cancelled"))
      .groupBy(s.registrations.eventId),
    db
      .select({ eventId: s.sessionLogs.eventId, n: count() })
      .from(s.sessionLogs)
      .groupBy(s.sessionLogs.eventId),
    db
      .select({ eventId: s.promotions.eventId, n: count() })
      .from(s.promotions)
      .where(eq(s.promotions.status, "approved"))
      .groupBy(s.promotions.eventId),
    db
      .select({ eventId: s.incidents.eventId, n: count() })
      .from(s.incidents)
      .groupBy(s.incidents.eventId),
  ]);
  const n = (rows: { eventId: string | null; n: number }[], id: string) =>
    rows.find((r) => r.eventId === id)?.n ?? 0;
  const today = v.now.day;
  const upcoming = events.filter(
    (e) => e.endDate >= today && e.status !== "completed",
  );
  const past = events
    .filter((e) => !(e.endDate >= today && e.status !== "completed"))
    .reverse();
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  const simple = events
    .map((e) => ({
      id: e.id,
      name: `${e.name} (${dateRange(e.startDate, e.endDate)})`,
    }))
    .reverse();

  const card = (e: (typeof events)[number]) => {
    const focused = v.event?.id === e.id;
    return (
      <li key={e.id}>
        <Card
          className={cn("px-4 py-4 sm:px-5", focused && "border-2 border-ink")}
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="board text-2xl">{e.name}</p>
              <p className="mt-1.5 text-[15px] text-ink-2">
                {dateRange(e.startDate, e.endDate)} ·{" "}
                {trackName.get(e.trackId) ?? "Track"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {focused ? <Pill tone="info">Working on this</Pill> : null}
              <Pill
                tone={
                  e.status === "published"
                    ? "good"
                    : e.status === "draft"
                      ? "warn"
                      : "neutral"
                }
              >
                {e.status === "published"
                  ? "Published"
                  : e.status === "draft"
                    ? "Draft"
                    : "Completed"}
              </Pill>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {(
              [
                ["Registered", n(regs, e.id)],
                ["Sessions logged", n(logs, e.id)],
                ["Promotions", n(promos, e.id)],
                ["Incident reports", n(incidents, e.id)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="eyebrow text-[11px] text-ink-3">{label}</dt>
                <dd className="timing mt-0.5 text-xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
            {focused ? (
              v.viewingOtherEvent ? (
                <ActionButton
                  action={switchEvent.bind(null, null)}
                  variant="secondary"
                  size="sm"
                  successMessage="Back to the current event"
                >
                  Go back to the current event
                </ActionButton>
              ) : null
            ) : (
              <ActionButton
                action={switchEvent.bind(null, e.id)}
                variant="secondary"
                size="sm"
                successMessage={`Now showing ${e.name}`}
              >
                {e.endDate < today ? "Open the record" : "Work on this event"}
              </ActionButton>
            )}
            <EditEventSheet
              event={{
                id: e.id,
                name: e.name,
                startDate: e.startDate,
                endDate: e.endDate,
                status: e.status,
                description: e.description,
                registrationUrl: e.registrationUrl,
              }}
              tracks={tracks}
              others={simple.filter((x) => x.id !== e.id)}
            />
          </div>
        </Card>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Events and history"
        lede="Every event keeps its own roster, schedule, paperwork, session notes, promotions and incident reports. Open a past event and the whole administrator area shows that event's record."
        actions={<NewEventSheet tracks={tracks} others={simple} />}
      />
      <section>
        <SectionTitle>Current and upcoming</SectionTitle>
        {upcoming.length ? (
          <ul className="space-y-3">{upcoming.map(card)}</ul>
        ) : (
          <p className="text-[15px] text-ink-2">
            Nothing scheduled. Create the next event to get started.
          </p>
        )}
      </section>
      {past.length ? (
        <section className="mt-8">
          <SectionTitle>Past events</SectionTitle>
          <ul className="space-y-3">{past.map(card)}</ul>
        </section>
      ) : null}
    </>
  );
});
