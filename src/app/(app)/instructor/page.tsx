import { and, eq, inArray } from "drizzle-orm";
import { ChevronRight, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { screen } from "@/components/shell/skeleton";
import {
  Avatar,
  ButtonLink,
  Card,
  CarNumber,
  EmptyState,
  GroupChip,
  PageHeader,
  Pill,
} from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { fullName, plural, vehicleLabel } from "@/lib/cn";
import { canSignOffSolo, drivesSolo } from "@/lib/instruction";
import { clock, weekday } from "@/lib/time";
import { requireInstructor } from "@/server/auth";
import {
  logsForStudents,
  nextGroup,
  nextSession,
  openPromotions,
  sessionOptions,
} from "@/server/instruction";
import { getAssignments, getSchedule } from "@/server/queries";
import { LogSessionSheet, PrivateNoteSheet, RecommendSheet } from "./forms";

export const metadata: Metadata = { title: "My students" };

export default screen(async function InstructorPage() {
  const v = await requireInstructor();
  if (!v.event)
    return (
      <EmptyState title="No event is scheduled yet">
        Your students appear here once you are paired for an event.
      </EmptyState>
    );

  const [{ students }, schedule] = await Promise.all([
    getAssignments(v.event.id, v.user.id),
    getSchedule(v.event.id),
  ]);
  const ids = students.map((x) => x.user.id);
  const db = await getDb();
  const [logs, pending, members] = await Promise.all([
    logsForStudents(ids),
    openPromotions(ids),
    ids.length
      ? db
          .select()
          .from(s.memberships)
          .where(
            and(
              eq(s.memberships.orgId, v.org.id),
              inArray(s.memberships.userId, ids),
            ),
          )
      : Promise.resolve([]),
  ]);
  const groupById = new Map(v.groups.map((g) => [g.id, g]));

  return (
    <>
      <PageHeader
        title="My students"
        lede={
          students.length
            ? `You are paired with ${plural(students.length, "driver")} for ${v.event.name}. Log each session while it is fresh; your notes go straight to your student.`
            : undefined
        }
      />
      {!students.length ? (
        <EmptyState
          title="No students assigned to you yet"
          action={
            v.isAdmin ? (
              <ButtonLink href="/admin/instructors">
                Open instructor pairing
              </ButtonLink>
            ) : undefined
          }
        >
          The Chief Driving Instructor pairs instructors with students before
          the drivers meeting. You will get an alert when you are paired.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {students.map((st) => {
            const group = groupById.get(st.groupId);
            const name = fullName(st.user);
            const { options, defaultId } = sessionOptions(schedule, st, v.now);
            const upcoming = nextSession(schedule, st, v.now);
            const mine = logs.filter(
              (l) => l.studentId === st.user.id && l.eventId === v.event!.id,
            );
            const member = members.find((m) => m.userId === st.user.id);
            const up = nextGroup(v.groups, group);
            const hasPending = pending.some((p) => p.userId === st.user.id);
            const solo = drivesSolo(group?.instructorPolicy, st);
            return (
              <Card key={st.user.id} className="overflow-hidden">
                <Link
                  href={`/instructor/${st.user.id}`}
                  className="flex items-center gap-3 px-4 pt-4 pb-3 hover:bg-paper sm:px-5"
                >
                  <Avatar name={name} className="size-11 text-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg leading-tight font-bold">
                      {name}
                    </span>
                    <span className="block truncate text-sm text-ink-2">
                      {vehicleLabel(st.vehicle) || "Car not on file"}
                    </span>
                  </span>
                  <GroupChip group={group} />
                  <CarNumber n={st.carNumber} />
                  <ChevronRight className="size-4 shrink-0 text-ink-3" />
                </Link>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 py-3 text-sm sm:px-5">
                  <div>
                    <dt className="eyebrow text-[11px] text-ink-3">
                      Next on track
                    </dt>
                    <dd className="mt-0.5 font-semibold">
                      {upcoming ? (
                        <>
                          {upcoming.day === v.now.day
                            ? ""
                            : `${weekday(upcoming.day).slice(0, 3)} `}
                          <span className="timing">
                            {clock(upcoming.startMin)}
                          </span>
                          {upcoming.day === v.now.day &&
                          upcoming.startMin <= v.now.minutes
                            ? " (now)"
                            : ""}
                        </>
                      ) : (
                        "No more sessions"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow text-[11px] text-ink-3">
                      Experience
                    </dt>
                    <dd className="mt-0.5 font-semibold">
                      {member?.experience ?? "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow text-[11px] text-ink-3">
                      Logged this event
                    </dt>
                    <dd className="mt-0.5 font-semibold">
                      {plural(mine.length, "session")}
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow text-[11px] text-ink-3">Status</dt>
                    <dd className="mt-0.5 flex flex-wrap gap-1">
                      <Pill tone={solo ? "good" : "neutral"}>
                        {solo ? "Solo" : "Instructed"}
                      </Pill>
                      {solo && st.instructorRequest === "ride_along" ? (
                        <Pill tone="info">Ride-along</Pill>
                      ) : null}
                      {solo && st.instructorRequest === "check_in" ? (
                        <Pill tone="info">Check-in</Pill>
                      ) : null}
                      {hasPending ? <Pill tone="warn">Recommended</Pill> : null}
                    </dd>
                  </div>
                </dl>
                {solo && st.instructorRequest ? (
                  <p className="border-t border-line px-4 py-3 text-[15px] text-ink-2 sm:px-5">
                    {st.instructorRequest === "ride_along"
                      ? `${st.user.firstName} drives solo and asked for an instructor to ride along.`
                      : `${st.user.firstName} drives solo. The administrators asked for a check-in.`}
                    {st.instructorRequestNote ? (
                      <span className="mt-1 block text-ink">
                        “{st.instructorRequestNote}”
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 border-t border-line bg-paper/60 px-4 py-3 sm:px-5">
                  <LogSessionSheet
                    studentId={st.user.id}
                    studentName={name}
                    sessions={options}
                    defaultSessionId={defaultId}
                    compact
                  />
                  <RecommendSheet
                    studentId={st.user.id}
                    studentName={name}
                    groupName={group?.name ?? "their group"}
                    nextGroupName={up?.name ?? null}
                    canSolo={canSignOffSolo(group?.instructorPolicy, st)}
                    pending={hasPending}
                    compact
                  />
                  <PrivateNoteSheet
                    studentId={st.user.id}
                    studentName={name}
                    compact
                  />
                  {st.user.phone ? (
                    <a
                      href={`tel:${st.user.phone.replace(/[^\d+]/g, "")}`}
                      aria-label={`Call ${name}`}
                      className="ml-auto grid size-9 place-items-center rounded-[10px] border border-line-strong bg-surface hover:bg-sunk"
                    >
                      <Phone className="size-4" />
                    </a>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
});
