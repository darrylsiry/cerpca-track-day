import { and, asc, eq, ne } from "drizzle-orm";
import {
  ChevronRight,
  ClipboardCheck,
  Megaphone,
  ShieldAlert,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { screen } from "@/components/shell/skeleton";
import {
  ButtonLink,
  Card,
  EmptyState,
  GroupChip,
  PageHeader,
  Pill,
  SectionTitle,
  Stat,
  type Tone,
} from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { clearedToDrive } from "@/lib/clearance";
import { cn, plural } from "@/lib/cn";
import { dateRange, daysBetween, monthDay } from "@/lib/time";
import { instructorNeed } from "@/lib/instruction";
import { getRosterView } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { livePairings } from "@/server/pairings";

export const metadata: Metadata = { title: "Overview" };

export default screen(async function AdminOverviewPage() {
  const v = await requireAdmin();
  if (!v.event) {
    return (
      <EmptyState
        title="No event yet"
        action={<ButtonLink href="/admin/events">Create an event</ButtonLink>}
      >
        Create the region&apos;s next track day to start building its roster and
        schedule.
      </EmptyState>
    );
  }
  const db = await getDb();
  const [{ rows, waiversTotal }, proposed, incidents, assignments] =
    await Promise.all([
      getRosterView(v.event.id, v.org.id),
      db
        .select({ id: s.promotions.id })
        .from(s.promotions)
        .where(
          and(
            eq(s.promotions.orgId, v.org.id),
            eq(s.promotions.status, "proposed"),
          ),
        ),
      db
        .select()
        .from(s.incidents)
        .where(
          and(eq(s.incidents.orgId, v.org.id), ne(s.incidents.status, "sent")),
        )
        .orderBy(asc(s.incidents.dueOn)),
      livePairings(v.event.id),
    ]);

  const total = rows.length;
  const checkedIn = rows.filter((r) => r.checkedIn).length;
  const waiversDone = rows.filter(
    (r) => r.waiversSigned >= waiversTotal,
  ).length;
  const techApproved = rows.filter((r) => r.techStatus === "approved").length;
  const techReview = rows.filter((r) => r.techStatus === "submitted").length;
  const techChanges = rows.filter(
    (r) => r.techStatus === "changes_requested",
  ).length;
  const techWaiting = rows.filter((r) =>
    ["none", "draft", "with_shop", "shop_signed"].includes(r.techStatus),
  ).length;
  const stickers = rows.filter((r) => r.sticker).length;
  const cleared = rows.filter((r) =>
    clearedToDrive({
      waiversSigned: r.waiversSigned,
      waiversTotal,
      techStatus: r.techStatus,
      sticker: Boolean(r.sticker),
    }),
  ).length;
  const policy = new Map(v.groups.map((g) => [g.id, g.instructorPolicy]));
  const paired = new Set(assignments.map((a) => a.studentId));
  const unpaired = rows.filter(
    (r) =>
      instructorNeed(policy.get(r.groupId), r) !== null &&
      !paired.has(r.userId),
  ).length;
  const today = v.now.day;
  const isLive = today >= v.event.startDate && today <= v.event.endDate;
  const daysOut = daysBetween(today, v.event.startDate);

  const attention: {
    href: string;
    text: string;
    detail?: string;
    tone: Tone;
  }[] = [];
  if (techReview)
    attention.push({
      href: "/admin/tech",
      text: `${plural(techReview, "tech form")} ready for review`,
      detail:
        "Approve them or ask for changes while drivers still have time to fix things.",
      tone: "warn",
    });
  if (techChanges)
    attention.push({
      href: "/admin/tech?tab=changes",
      text: `${plural(techChanges, "driver")} asked to fix their tech form`,
      tone: "bad",
    });
  if (techWaiting)
    attention.push({
      href: "/admin/tech?tab=waiting",
      text: `${plural(techWaiting, "driver")} without a submitted shop inspection`,
      detail: "Send a reminder from the tech screen.",
      tone: "neutral",
    });
  if (waiversDone < total)
    attention.push({
      href: "/admin/waivers",
      text: `${plural(total - waiversDone, "person", "people")} with unsigned waivers`,
      tone: "warn",
    });
  if (unpaired)
    attention.push({
      href: "/admin/instructors",
      text: `${plural(unpaired, "student")} without an instructor`,
      tone: "bad",
    });
  if (proposed.length)
    attention.push({
      href: "/admin/promotions",
      text: `${plural(proposed.length, "promotion recommendation")} waiting for sign-off`,
      tone: "warn",
    });
  for (const inc of incidents) {
    const left = daysBetween(today, inc.dueOn);
    attention.push({
      href: `/admin/incidents/${inc.id}`,
      text: `Incident report ${inc.status === "draft" ? "in draft" : "ready to send"}: ${inc.driverName ?? "unnamed driver"}`,
      detail:
        left < 0
          ? `Was due at PCA on ${monthDay(inc.dueOn)}.`
          : left === 0
            ? "Due at PCA today."
            : `Due at PCA by ${monthDay(inc.dueOn)}.`,
      tone: left <= 1 ? "bad" : "warn",
    });
  }
  if (isLive && checkedIn < total)
    attention.push({
      href: "/admin/roster",
      text: `${plural(total - checkedIn, "person", "people")} not checked in`,
      tone: "neutral",
    });

  const dot: Record<Tone, string> = {
    neutral: "bg-ink-3",
    info: "bg-info",
    warn: "bg-flag-yellow",
    good: "bg-good",
    bad: "bg-flag-red",
  };
  const bar = (n: number) => `${total ? Math.round((n / total) * 100) : 0}%`;

  return (
    <>
      <PageHeader
        title={v.event.name}
        lede={
          <span className="flex flex-wrap items-center gap-2">
            {dateRange(v.event.startDate, v.event.endDate)} · {v.track?.name}
            <Pill
              tone={
                v.event.status === "published"
                  ? "good"
                  : v.event.status === "draft"
                    ? "warn"
                    : "neutral"
              }
            >
              {v.event.status === "published"
                ? isLive
                  ? "Happening now"
                  : daysOut > 0
                    ? `In ${plural(daysOut, "day")}`
                    : "Published"
                : v.event.status === "draft"
                  ? "Draft"
                  : "Completed"}
            </Pill>
          </span>
        }
        actions={
          <>
            <ButtonLink href="/admin/announcements">
              <Megaphone className="size-4" /> Announce
            </ButtonLink>
            <ButtonLink href="/admin/tech/grid" variant="secondary">
              <ClipboardCheck className="size-4" /> Grid tech
            </ButtonLink>
            <ButtonLink href="/admin/incidents/new" variant="secondary">
              <ShieldAlert className="size-4" /> Report incident
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Registered"
          value={total}
          sub={`${rows.filter((r) => r.isInstructor).length} instructing`}
          href="/admin/roster"
        />
        <Stat
          label="Checked in"
          value={`${checkedIn}/${total}`}
          href="/admin/roster"
        />
        <Stat
          label="Tech stickers"
          value={`${stickers}/${total}`}
          sub="required to go on track"
          href="/admin/tech/grid"
        />
        <Stat
          label="Cleared to drive"
          value={`${cleared}/${total}`}
          sub="waivers signed and stickered"
          tone={cleared === total && total ? "good" : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          <SectionTitle>Needs attention</SectionTitle>
          {attention.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
              {attention.map((a, i) => (
                <li key={i}>
                  <Link
                    href={a.href}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-paper"
                  >
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        dot[a.tone],
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{a.text}</span>
                      {a.detail ? (
                        <span className="block text-sm text-ink-2">
                          {a.detail}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Card className="px-5 py-6 text-center">
              <p className="font-bold">Nothing is waiting on you</p>
              <p className="mt-1 text-[15px] text-ink-2">
                Paperwork is in, pairings are set and there are no open reports.
              </p>
            </Card>
          )}
        </section>

        <div className="min-w-0 space-y-6">
          <section>
            <SectionTitle>Paperwork</SectionTitle>
            <Card className="space-y-4 px-4 py-4 sm:px-5">
              {(
                [
                  ["Waivers signed", waiversDone, "/admin/waivers"],
                  [
                    "Shop inspection approved",
                    techApproved,
                    "/admin/tech?tab=approved",
                  ],
                  ["Tech sticker issued", stickers, "/admin/tech/grid"],
                ] as const
              ).map(([label, n, href]) => (
                <Link key={label} href={href} className="block">
                  <p className="flex items-baseline justify-between gap-3 text-[15px]">
                    <span className="font-semibold">{label}</span>
                    <span className="timing font-bold">
                      {n}/{total}
                    </span>
                  </p>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-sunk">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        n === total && total ? "bg-good" : "bg-ink",
                      )}
                      style={{ width: bar(n) }}
                    />
                  </div>
                </Link>
              ))}
            </Card>
          </section>

          <section>
            <SectionTitle>Run groups</SectionTitle>
            <Card className="px-4 py-3 sm:px-5">
              <ul className="space-y-2.5">
                {v.groups.map((g) => {
                  const n = rows.filter((r) => r.groupId === g.id).length;
                  const max = Math.max(
                    1,
                    ...v.groups.map(
                      (x) => rows.filter((r) => r.groupId === x.id).length,
                    ),
                  );
                  return (
                    <li key={g.id} className="flex items-center gap-3">
                      <GroupChip group={g} className="w-16 justify-center" />
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-sunk">
                        <div
                          className="h-full rounded-full border border-ink/20"
                          style={{
                            width: `${(n / max) * 100}%`,
                            background: g.color,
                          }}
                        />
                      </div>
                      <span className="timing w-6 text-right font-bold">
                        {n}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        </div>
      </div>
    </>
  );
});
