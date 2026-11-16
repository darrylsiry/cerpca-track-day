import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { screen } from "@/components/shell/skeleton";
import {
  Card,
  EmptyState,
  GroupChip,
  Notice,
  PageHeader,
  Pill,
  SectionTitle,
  Segmented,
} from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { fullName, plural } from "@/lib/cn";
import { partName } from "@/lib/schedule";
import { dateTime, relativeTime } from "@/lib/time";
import { getRosterView, usersByIds } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { channelStatus } from "@/server/notify";
import { groupLite } from "@/server/queries";
import { Composer } from "./composer";

export const metadata: Metadata = { title: "Announcements" };

const CHANNEL: Record<string, string> = {
  inapp: "App",
  email: "Email",
  sms: "Text",
  push: "Push",
};

export default screen(async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const v = await requireAdmin();
  if (!v.event)
    return (
      <EmptyState title="No event yet">
        Announcements are sent to an event&apos;s roster. Create an event first.
      </EmptyState>
    );
  const tab = sp.tab === "log" ? "log" : "send";
  const db = await getDb();
  const status = channelStatus();

  const tabs = (
    <Segmented
      label="Announcements"
      current={tab}
      className="mb-5"
      items={[
        {
          key: "send",
          href: "/admin/announcements",
          label: "Send and history",
        },
        {
          key: "log",
          href: "/admin/announcements?tab=log",
          label: "Delivery log",
        },
      ]}
    />
  );

  if (tab === "log") {
    const log = await db
      .select()
      .from(s.messageLog)
      .orderBy(desc(s.messageLog.createdAt))
      .limit(150);
    return (
      <>
        <PageHeader
          title="Announcements"
          lede="Every email, text and push the app tried to send, including session reminders."
        />
        {tabs}
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          {(
            [
              ["Email", status.email, "Resend"],
              ["Text messages", status.sms, "Twilio"],
              ["Push notifications", status.push, "Web Push"],
            ] as const
          ).map(([label, on, provider]) => (
            <Card key={label} className="px-4 py-3">
              <p className="flex items-center justify-between gap-2">
                <span className="font-bold">{label}</span>
                <Pill tone={on ? "good" : "warn"}>
                  {on ? "Connected" : "Not set up"}
                </Pill>
              </p>
              <p className="mt-1 text-[13px] text-ink-2">
                {on
                  ? `Sending through ${provider}.`
                  : `Messages are logged as “simulated” until ${provider} keys are added. See the README.`}
              </p>
            </Card>
          ))}
        </div>
        {log.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
            {log.map((m) => (
              <li
                key={m.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2.5 text-[15px]"
              >
                <Pill tone="neutral" className="mt-0.5">
                  {CHANNEL[m.channel] ?? m.channel}
                </Pill>
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {m.subject ?? m.body}
                  </p>
                  <p className="truncate text-[13px] text-ink-3">
                    to {m.toAddress} · {dateTime(m.createdAt, v.tz)}
                    {m.kind ? ` · ${m.kind}` : ""}
                  </p>
                  {m.error ? (
                    <p className="text-[13px] text-bad">{m.error}</p>
                  ) : null}
                </div>
                <Pill
                  tone={
                    m.status === "sent"
                      ? "good"
                      : m.status === "failed"
                        ? "bad"
                        : "neutral"
                  }
                >
                  {m.status === "sent"
                    ? "Sent"
                    : m.status === "failed"
                      ? "Failed"
                      : "Simulated"}
                </Pill>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing sent yet">
            Emails, texts and push notifications appear here as they go out.
          </EmptyState>
        )}
      </>
    );
  }

  const [{ rows }, history, assigned, admins] = await Promise.all([
    getRosterView(v.event.id, v.org.id),
    db
      .select()
      .from(s.announcements)
      .where(
        and(
          eq(s.announcements.orgId, v.org.id),
          eq(s.announcements.eventId, v.event.id),
        ),
      )
      .orderBy(desc(s.announcements.createdAt))
      .limit(60),
    db
      .select({ id: s.instructorAssignments.studentId })
      .from(s.instructorAssignments)
      .where(eq(s.instructorAssignments.eventId, v.event.id)),
    db
      .select({ id: s.memberships.userId })
      .from(s.memberships)
      .where(
        and(eq(s.memberships.orgId, v.org.id), eq(s.memberships.isAdmin, true)),
      ),
  ]);
  const authors = await usersByIds(
    history.map((h) => h.authorId ?? "").filter(Boolean),
  );
  const byGroup: Record<string, number> = {};
  for (const r of rows) byGroup[r.groupId] = (byGroup[r.groupId] ?? 0) + 1;
  const groupById = new Map(v.groups.map((g) => [g.id, g]));
  const audienceLabel = (a: (typeof history)[number]["audience"]) =>
    a.kind === "all"
      ? "Everyone"
      : a.kind === "instructors"
        ? "Instructors"
        : a.kind === "students"
          ? "Students with an instructor"
          : a.kind === "admins"
            ? "Administrators"
            : null;

  return (
    <>
      <PageHeader
        title="Announcements"
        lede={`Reach everyone at ${v.event.name}, or just the people who need to know.`}
      />
      {tabs}
      {!status.email || !status.sms ? (
        <Notice tone="info" className="mb-4">
          {!status.email && !status.sms
            ? "Email and text messages are"
            : !status.email
              ? "Email is"
              : "Text messaging is"}{" "}
          not connected yet, so those sends are recorded in the delivery log
          instead of going out. In-app alerts work now.
        </Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          <SectionTitle>New announcement</SectionTitle>
          <Composer
            groups={v.groups.map(groupLite)}
            counts={{
              all: rows.length,
              instructors: rows.filter((r) => r.isInstructor).length,
              students: assigned.length,
              admins: admins.length,
              byGroup,
            }}
            channels={status}
          />
        </section>
        <section className="min-w-0">
          <SectionTitle>Sent</SectionTitle>
          {history.length ? (
            <ul className="space-y-2">
              {history.map((a) => (
                <li
                  key={a.id}
                  className="relative overflow-hidden rounded-[14px] border border-line bg-surface px-4 py-3"
                >
                  {a.urgent ? (
                    <span
                      className="absolute inset-y-0 left-0 w-1 bg-flag-yellow"
                      aria-hidden
                    />
                  ) : null}
                  <p className="font-bold">{a.title}</p>
                  <p className="mt-0.5 text-[15px] text-ink-2">{a.body}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
                    {audienceLabel(a.audience) ??
                      (a.audience.groupIds ?? []).map((g) => {
                        const group = groupById.get(g);
                        const part = a.audience.groupParts?.[g];
                        return group ? (
                          <GroupChip
                            key={g}
                            group={{ ...group, name: partName(group.name, part) }}
                            size="sm"
                          />
                        ) : null;
                      })}
                    <span>
                      · {plural(a.recipientCount, "person", "people")}
                    </span>
                    <span>
                      · {a.channels.map((c) => CHANNEL[c] ?? c).join(", ")}
                    </span>
                    <span>
                      ·{" "}
                      {a.authorId && authors.get(a.authorId)
                        ? fullName(authors.get(a.authorId)!)
                        : "System"}
                      , {relativeTime(a.createdAt, v.nowMs)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No announcements yet">
              Schedule changes you announce from the schedule editor also appear
              here.
            </EmptyState>
          )}
        </section>
      </div>
    </>
  );
});
