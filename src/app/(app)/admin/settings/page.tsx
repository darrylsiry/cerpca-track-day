import { and, eq, or } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { screen } from "@/components/shell/skeleton";
import {
  Card,
  GroupChip,
  PageHeader,
  Pill,
  SectionTitle,
} from "@/components/ui";
import { getDb, schema as s, usingHostedDb } from "@/db";
import { fullName } from "@/lib/cn";
import { demoMode, requireAdmin } from "@/server/auth";
import { channelStatus } from "@/server/notify";
import { GroupSheet, RegionForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default screen(async function SettingsPage() {
  const v = await requireAdmin();
  const db = await getDb();
  const staff = await db
    .select({ m: s.memberships, u: s.users })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
    .where(
      and(
        eq(s.memberships.orgId, v.org.id),
        or(
          eq(s.memberships.isAdmin, true),
          eq(s.memberships.isInstructor, true),
        ),
      ),
    );
  const status = channelStatus();
  const sheets =
    v.track?.guide.passing.map((p) => ({ key: p.key, title: p.title })) ?? [];
  const admins = staff
    .filter((x) => x.m.isAdmin)
    .sort((a, b) => a.u.lastName.localeCompare(b.u.lastName));
  const instructors = staff
    .filter((x) => x.m.isInstructor)
    .sort((a, b) => a.u.lastName.localeCompare(b.u.lastName));

  const integrations: [string, boolean, string, string][] = [
    [
      "Database",
      usingHostedDb(),
      "Hosted Postgres",
      "Local file database (development only)",
    ],
    [
      "Email",
      status.email,
      "Connected through Resend",
      "Not connected: emails are logged, not sent",
    ],
    [
      "Text messages",
      status.sms,
      "Connected through Twilio",
      "Not connected: texts are logged, not sent",
    ],
    [
      "Push notifications",
      status.push,
      "Web Push keys are set",
      "Not connected: push is logged, not sent",
    ],
    [
      "Reminder job",
      Boolean(process.env.CRON_SECRET),
      "Protected by CRON_SECRET",
      "CRON_SECRET is not set",
    ],
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        lede="How the region is set up: run groups, who gets incident reports, the tech window, and what the app is connected to."
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Card className="px-4 py-5 sm:px-6">
            <RegionForm
              org={{
                name: v.org.name,
                shortName: v.org.shortName,
                website: v.org.website,
              }}
              settings={v.org.settings}
            />
          </Card>
        </div>

        <div className="min-w-0 space-y-7">
          <section>
            <SectionTitle>Run groups</SectionTitle>
            <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
              {v.groups.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center gap-3 py-2 pr-2 pl-4"
                >
                  <GroupChip
                    group={g}
                    size="lg"
                    className="w-20 justify-center"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{g.summary}</span>
                    <span className="block truncate text-[13px] text-ink-3">
                      {g.isInstructorGroup
                        ? "Instructor group"
                        : g.instructorPolicy === "required"
                          ? "Always instructed"
                          : g.instructorPolicy === "optional"
                            ? "Instructed, then solo"
                            : "Solo; instructor on request"}
                      {" · "}
                      {g.passingKey
                        ? (sheets.find((x) => x.key === g.passingKey)?.title ??
                          g.passingKey)
                        : "no passing sheet on file"}
                    </span>
                  </span>
                  <GroupSheet
                    group={{
                      id: g.id,
                      name: g.name,
                      summary: g.summary,
                      description: g.description,
                      color: g.color,
                      textColor: g.textColor,
                      instructorPolicy: g.instructorPolicy,
                      passingKey: g.passingKey,
                    }}
                    sheets={sheets}
                  />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionTitle>Connections</SectionTitle>
            <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
              {integrations.map(([label, on, yes, no]) => (
                <li
                  key={label}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{label}</span>
                    <span className="block text-[13px] text-ink-3">
                      {on ? yes : no}
                    </span>
                  </span>
                  <Pill tone={on ? "good" : "warn"}>
                    {on ? "Ready" : "To do"}
                  </Pill>
                </li>
              ))}
              {demoMode() ? (
                <li className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-semibold">Demo mode</span>
                    <span className="block text-[13px] text-ink-3">
                      Sample accounts and the simulated clock are on. Turn off
                      before real use.
                    </span>
                  </span>
                  <Pill tone="warn">On</Pill>
                </li>
              ) : null}
            </ul>
            <p className="mt-2 text-[13px] text-ink-3">
              These are set with environment variables. The README lists each
              one.
            </p>
          </section>

          <section>
            <SectionTitle>Administrators · {admins.length}</SectionTitle>
            <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
              {admins.map((x) => (
                <li key={x.u.id}>
                  <Link
                    href={`/admin/roster/${x.u.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-paper"
                  >
                    <span className="font-semibold">{fullName(x.u)}</span>
                    <span className="text-[13px] text-ink-3">
                      {x.m.adminTitle ?? "Administrator"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-ink-3">
              {instructors.length} people hold the instructor role. Open anyone
              from the{" "}
              <Link
                href="/admin/roster"
                className="underline underline-offset-4"
              >
                roster
              </Link>{" "}
              and choose Roles to change what they can do.
            </p>
          </section>
        </div>
      </div>
    </>
  );
});
