import { and, desc, eq } from "drizzle-orm";
import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/form";
import { screen } from "@/components/shell/skeleton";
import {
  Card,
  CarNumber,
  DefList,
  EmptyState,
  GroupChip,
  Notice,
  PageHeader,
  Pill,
  SectionTitle,
} from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { fullName, vehicleLabel } from "@/lib/cn";
import { canSignOffSolo, drivesSolo } from "@/lib/instruction";
import { dateOnly, dateTime } from "@/lib/time";
import { usersByIds } from "@/server/admin";
import { requireInstructor } from "@/server/auth";
import { isAssigned, nextGroup, sessionOptions } from "@/server/instruction";
import { getPeople, getSchedule } from "@/server/queries";
import { deleteSessionLog } from "../actions";
import { LogSessionSheet, PrivateNoteSheet, RecommendSheet } from "../forms";

export const metadata: Metadata = { title: "Student" };

export default screen(async function StudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const v = await requireInstructor();
  if (!v.event) notFound();
  if (!v.isAdmin && !(await isAssigned(v, studentId))) notFound();

  const db = await getDb();
  const [people, schedule, logs, promos, myNotes, [member], events] =
    await Promise.all([
      getPeople(v.event.id, [studentId]),
      getSchedule(v.event.id),
      db
        .select()
        .from(s.sessionLogs)
        .where(eq(s.sessionLogs.studentId, studentId))
        .orderBy(desc(s.sessionLogs.createdAt)),
      db
        .select()
        .from(s.promotions)
        .where(eq(s.promotions.userId, studentId))
        .orderBy(desc(s.promotions.createdAt)),
      db
        .select()
        .from(s.driverNotes)
        .where(
          and(
            eq(s.driverNotes.userId, studentId),
            eq(s.driverNotes.authorId, v.user.id),
          ),
        )
        .orderBy(desc(s.driverNotes.createdAt)),
      db
        .select()
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.orgId, v.org.id),
            eq(s.memberships.userId, studentId),
          ),
        )
        .limit(1),
      db.select().from(s.events).where(eq(s.events.orgId, v.org.id)),
    ]);
  const st = people.get(studentId);
  if (!st) notFound();

  const name = fullName(st.user);
  const group = v.groups.find((g) => g.id === st.groupId);
  const solo = drivesSolo(group?.instructorPolicy, st);
  const up = nextGroup(v.groups, group);
  const { options, defaultId } = sessionOptions(schedule, st, v.now);
  const authors = await usersByIds(
    [
      ...logs.map((l) => l.instructorId),
      ...promos.map((p) => p.recommendedById ?? ""),
    ].filter(Boolean),
  );
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  const here = logs.filter((l) => l.eventId === v.event!.id);
  const earlier = logs.filter((l) => l.eventId !== v.event!.id);
  const pending = promos.some((p) => p.status === "proposed");
  const groupName = (id: string | null) =>
    v.groups.find((g) => g.id === id)?.name ?? "";

  return (
    <>
      <PageHeader
        back={{ href: "/instructor", label: "My students" }}
        title={name}
        lede={
          <span className="flex flex-wrap items-center gap-2">
            <GroupChip group={group} /> <CarNumber n={st.carNumber} size="sm" />{" "}
            <span>{vehicleLabel(st.vehicle)}</span>
            <Pill tone={solo ? "good" : "neutral"}>
              {solo ? "Solo" : "Instructed"}
            </Pill>
            {solo && st.instructorRequest ? (
              <Pill tone="info">
                {st.instructorRequest === "ride_along"
                  ? "Ride-along"
                  : "Check-in"}
              </Pill>
            ) : null}
          </span>
        }
        actions={
          <>
            <LogSessionSheet
              studentId={studentId}
              studentName={name}
              sessions={options}
              defaultSessionId={defaultId}
            />
            <RecommendSheet
              studentId={studentId}
              studentName={name}
              groupName={group?.name ?? "their group"}
              nextGroupName={up?.name ?? null}
              canSolo={canSignOffSolo(group?.instructorPolicy, st)}
              pending={pending}
            />
            <PrivateNoteSheet studentId={studentId} studentName={name} />
          </>
        }
      />

      {solo && st.instructorRequest ? (
        <Notice
          tone="info"
          className="mb-6"
          title={
            st.instructorRequest === "ride_along"
              ? `${st.user.firstName} drives solo and asked for an instructor to ride along`
              : `${st.user.firstName} drives solo; the administrators asked for a check-in`
          }
        >
          {st.instructorRequestNote
            ? `“${st.instructorRequestNote}”`
            : st.instructorRequest === "ride_along"
              ? "They did not say what they want to work on. Ask when you meet."
              : "No note was left. Ask the Chief Driving Instructor if you are unsure what to look for."}
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <section>
            <SectionTitle>Sessions at this event</SectionTitle>
            {here.length ? (
              <ul className="space-y-3">
                {here.map((l) => (
                  <LogCard
                    key={l.id}
                    label={l.label}
                    when={dateTime(l.createdAt, v.tz)}
                    by={
                      authors.get(l.instructorId)
                        ? fullName(authors.get(l.instructorId)!)
                        : "Instructor"
                    }
                    shared={l.sharedNotes}
                    focus={l.focusAreas}
                    privateNote={
                      l.instructorId === v.user.id || v.isAdmin
                        ? l.privateNotes
                        : null
                    }
                    remove={
                      l.instructorId === v.user.id || v.isAdmin
                        ? deleteSessionLog.bind(null, l.id)
                        : undefined
                    }
                  />
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing logged yet">
                After each session, tap “Log a session” and write a few lines
                for {st.user.firstName}.
              </EmptyState>
            )}
          </section>

          {earlier.length ? (
            <section>
              <SectionTitle>Earlier events</SectionTitle>
              <ul className="space-y-3">
                {earlier.map((l) => (
                  <LogCard
                    key={l.id}
                    label={`${eventName.get(l.eventId) ?? "Earlier event"} · ${l.label}`}
                    when={dateOnly(l.createdAt, v.tz)}
                    by={
                      authors.get(l.instructorId)
                        ? fullName(authors.get(l.instructorId)!)
                        : "Instructor"
                    }
                    shared={l.sharedNotes}
                    focus={l.focusAreas}
                    privateNote={
                      l.instructorId === v.user.id || v.isAdmin
                        ? l.privateNotes
                        : null
                    }
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Card className="px-4 py-2 sm:px-5">
            <DefList
              rows={[
                ["Experience", member?.experience],
                [
                  "Attending",
                  st.attendsDay1 && st.attendsDay2
                    ? "Both days"
                    : st.attendsDay1
                      ? "First day only"
                      : "Second day only",
                ],
                [
                  "Phone",
                  st.user.phone ? (
                    <a
                      href={`tel:${st.user.phone.replace(/[^\d+]/g, "")}`}
                      className="underline underline-offset-4"
                    >
                      {st.user.phone}
                    </a>
                  ) : null,
                ],
                ["Email", st.user.email],
                [
                  "Emergency contact",
                  [st.user.emergencyName, st.user.emergencyPhone]
                    .filter(Boolean)
                    .join(", "),
                ],
              ]}
            />
          </Card>

          <section>
            <SectionTitle>Promotions</SectionTitle>
            {promos.length ? (
              <ul className="space-y-3">
                {promos.map((p) => (
                  <li key={p.id}>
                    <Card className="px-4 py-3 sm:px-5">
                      <p className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold">
                          {p.kind === "solo"
                            ? `Solo sign-off in ${groupName(p.fromGroupId)}`
                            : `${groupName(p.fromGroupId)} to ${groupName(p.toGroupId)}`}
                        </span>
                        <Pill
                          tone={
                            p.status === "approved"
                              ? "good"
                              : p.status === "declined"
                                ? "bad"
                                : "warn"
                          }
                        >
                          {p.status === "proposed"
                            ? "Awaiting sign-off"
                            : p.status === "approved"
                              ? "Approved"
                              : "Declined"}
                        </Pill>
                      </p>
                      <p className="mt-1 text-[13px] text-ink-3">
                        {eventName.get(p.eventId ?? "") ?? ""} · recommended by{" "}
                        {p.recommendedById && authors.get(p.recommendedById)
                          ? fullName(authors.get(p.recommendedById)!)
                          : "an instructor"}
                      </p>
                      <p className="mt-2 text-[15px]">{p.rationale}</p>
                      {p.decisionNote ? (
                        <p className="mt-2 border-t border-line pt-2 text-[15px] text-ink-2">
                          Decision: {p.decisionNote}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-ink-2">
                No recommendations on file.
              </p>
            )}
          </section>

          {myNotes.length ? (
            <section>
              <SectionTitle>Your private notes</SectionTitle>
              <ul className="space-y-2">
                {myNotes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-[12px] border border-line bg-surface px-4 py-3"
                  >
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
                      <Lock className="size-3.5" /> Administrators only ·{" "}
                      {dateOnly(n.createdAt, v.tz)}
                    </p>
                    <p className="mt-1 text-[15px]">{n.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
});

function LogCard({
  label,
  when,
  by,
  shared,
  focus,
  privateNote,
  remove,
}: {
  label: string;
  when: string;
  by: string;
  shared: string;
  focus: string[];
  privateNote: string | null;
  remove?: () => Promise<import("@/lib/types").ActionResult>;
}) {
  return (
    <li>
      <Card className="px-4 py-3.5 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold">{label}</p>
            <p className="text-[13px] text-ink-3">
              {by} · {when}
            </p>
          </div>
          {remove ? (
            <ActionButton
              action={remove}
              confirm="Remove this session entry? Your student will no longer see it."
              variant="ghost"
              size="sm"
              className="-mr-2 text-ink-2"
            >
              Remove
            </ActionButton>
          ) : null}
        </div>
        {focus.length ? (
          <p className="mt-2 flex flex-wrap gap-1.5">
            {focus.map((f) => (
              <span
                key={f}
                className="rounded-full bg-sunk px-2.5 py-0.5 text-[13px] font-semibold text-ink-2"
              >
                {f}
              </span>
            ))}
          </p>
        ) : null}
        <p className="mt-2.5 text-[15px] leading-relaxed whitespace-pre-line">
          {shared}
        </p>
        {privateNote ? (
          <div className="mt-3 rounded-[10px] bg-warn-soft px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-warn">
              <Lock className="size-3.5" /> Administrators only
            </p>
            <p className="mt-0.5 text-[15px]">{privateNote}</p>
          </div>
        ) : null}
      </Card>
    </li>
  );
}
