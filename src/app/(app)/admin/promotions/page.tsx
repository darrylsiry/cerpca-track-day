import { and, count, desc, eq, inArray } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { screen } from "@/components/shell/skeleton";
import {
  Card,
  EmptyState,
  GroupChip,
  PageHeader,
  Pill,
  SectionTitle,
} from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { fullName, plural } from "@/lib/cn";
import { dateOnly, relativeTime } from "@/lib/time";
import { usersByIds } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { groupLite } from "@/server/queries";
import { DecideSheet, PromoteSheet } from "./forms";

export const metadata: Metadata = { title: "Promotions" };

export default screen(async function PromotionsPage() {
  const v = await requireAdmin();
  const db = await getDb();
  const [promos, members, events] = await Promise.all([
    db
      .select()
      .from(s.promotions)
      .where(eq(s.promotions.orgId, v.org.id))
      .orderBy(desc(s.promotions.createdAt)),
    db
      .select({ m: s.memberships, u: s.users })
      .from(s.memberships)
      .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
      .where(eq(s.memberships.orgId, v.org.id)),
    db.select().from(s.events).where(eq(s.events.orgId, v.org.id)),
  ]);
  const open = promos.filter((p) => p.status === "proposed");
  const decided = promos.filter((p) => p.status !== "proposed");
  const people = await usersByIds(
    promos
      .flatMap((p) => [p.userId, p.recommendedById ?? "", p.decidedById ?? ""])
      .filter(Boolean),
  );
  const openIds = [...new Set(open.map((p) => p.userId))];
  const [logCounts, eventCounts] = openIds.length
    ? await Promise.all([
        db
          .select({ userId: s.sessionLogs.studentId, n: count() })
          .from(s.sessionLogs)
          .where(inArray(s.sessionLogs.studentId, openIds))
          .groupBy(s.sessionLogs.studentId),
        db
          .select({ userId: s.registrations.userId, n: count() })
          .from(s.registrations)
          .where(and(inArray(s.registrations.userId, openIds)))
          .groupBy(s.registrations.userId),
      ])
    : [[], []];
  const memberOf = new Map(members.map((x) => [x.u.id, x.m]));
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  const group = (id: string | null) => v.groups.find((g) => g.id === id);
  const who = (id: string | null) =>
    id && people.get(id) ? fullName(people.get(id)!) : "Unknown";
  const describe = (p: (typeof promos)[number]) =>
    p.kind === "solo"
      ? `solo sign-off in ${group(p.fromGroupId)?.name ?? ""}`
      : `${group(p.fromGroupId)?.name ?? ""} to ${group(p.toGroupId)?.name ?? ""}`;

  return (
    <>
      <PageHeader
        title="Promotions"
        lede="Instructors recommend; an administrator signs off. Every decision stays in the driver's history with the reasoning behind it."
        actions={
          <PromoteSheet
            drivers={members
              .filter((x) => !x.m.isInstructor)
              .map((x) => ({
                id: x.u.id,
                name: `${x.u.lastName}, ${x.u.firstName}`,
                groupId: x.m.runGroupId,
                solo: x.m.soloApproved,
              }))
              .sort((a, b) => a.name.localeCompare(b.name))}
            groups={v.groups.filter((g) => !g.isInstructorGroup).map(groupLite)}
            eventName={v.event?.name ?? null}
          />
        }
      />

      <section>
        <SectionTitle>Waiting for sign-off · {open.length}</SectionTitle>
        {open.length ? (
          <ul className="space-y-4">
            {open.map((p) => {
              const driver = people.get(p.userId);
              const m = memberOf.get(p.userId);
              const name = driver ? fullName(driver) : "Driver";
              return (
                <li key={p.id}>
                  <Card className="overflow-hidden">
                    <div className="px-4 pt-4 sm:px-5">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <Link
                          href={`/admin/roster/${p.userId}`}
                          className="board text-2xl underline-offset-4 hover:underline"
                        >
                          {name}
                        </Link>
                        <p className="flex items-center gap-2">
                          <GroupChip group={group(p.fromGroupId)} size="lg" />
                          {p.kind === "solo" ? (
                            <Pill tone="info" className="h-8 px-3 text-sm">
                              Solo sign-off
                            </Pill>
                          ) : (
                            <>
                              <ArrowRight
                                className="size-5 text-ink-2"
                                aria-label="to"
                              />
                              <GroupChip group={group(p.toGroupId)} size="lg" />
                            </>
                          )}
                        </p>
                      </div>
                      <p className="mt-1.5 text-sm text-ink-2">
                        Recommended by{" "}
                        <strong className="text-ink">
                          {who(p.recommendedById)}
                        </strong>{" "}
                        {relativeTime(p.createdAt, v.nowMs)}
                        {p.eventId && eventName.get(p.eventId)
                          ? ` at ${eventName.get(p.eventId)}`
                          : ""}
                      </p>
                      <blockquote className="mt-3 border-l-4 border-line-strong pl-4 text-base leading-relaxed">
                        {p.rationale}
                      </blockquote>
                      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
                        <span>
                          {m?.experience ?? "Experience not recorded"}
                        </span>
                        <span>
                          {plural(
                            eventCounts.find((x) => x.userId === p.userId)?.n ??
                              0,
                            "event",
                          )}{" "}
                          with the region
                        </span>
                        <span>
                          {plural(
                            logCounts.find((x) => x.userId === p.userId)?.n ??
                              0,
                            "session",
                          )}{" "}
                          logged by instructors
                        </span>
                        <Link
                          href={`/admin/roster/${p.userId}`}
                          className="font-semibold text-ink underline underline-offset-4"
                        >
                          Read the driver&apos;s file
                        </Link>
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-line bg-paper/60 px-4 py-3 sm:px-5">
                      <DecideSheet
                        id={p.id}
                        driver={name}
                        what={describe(p)}
                        approve
                        eventName={v.event?.name ?? null}
                      />
                      <DecideSheet
                        id={p.id}
                        driver={name}
                        what={describe(p)}
                        approve={false}
                        eventName={v.event?.name ?? null}
                      />
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Nothing waiting">
            When an instructor recommends a driver for promotion or solo
            sign-off, it appears here for your decision.
          </EmptyState>
        )}
      </section>

      <section className="mt-8">
        <SectionTitle>History</SectionTitle>
        {decided.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
            {decided.map((p) => (
              <li key={p.id} className="px-4 py-3 sm:px-5">
                <p className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <Link
                      href={`/admin/roster/${p.userId}`}
                      className="font-bold underline-offset-4 hover:underline"
                    >
                      {who(p.userId)}
                    </Link>
                    <span className="text-ink-2"> · {describe(p)}</span>
                  </span>
                  <Pill tone={p.status === "approved" ? "good" : "bad"}>
                    {p.status === "approved" ? "Approved" : "Declined"}
                  </Pill>
                </p>
                <p className="mt-0.5 text-[13px] text-ink-3">
                  {eventName.get(p.eventId ?? "") ?? "No event"} · recommended
                  by {who(p.recommendedById)} · decided by {who(p.decidedById)}{" "}
                  on {dateOnly(p.decidedAt, v.tz)}
                </p>
                {p.decisionNote ? (
                  <p className="mt-1 text-[15px] text-ink-2">
                    {p.decisionNote}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-ink-2">No decisions recorded yet.</p>
        )}
      </section>
    </>
  );
});
