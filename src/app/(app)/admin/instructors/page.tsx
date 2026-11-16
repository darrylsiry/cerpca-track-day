import { eq } from "drizzle-orm";
import { TriangleAlert, Wand2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/form";
import { instructorNeed, NEED_LABEL } from "@/lib/instruction";
import { screen } from "@/components/shell/skeleton";
import {
  Card,
  CarNumber,
  EmptyState,
  GroupChip,
  Notice,
  PageHeader,
  Pill,
  SectionTitle,
  Stat,
} from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { plural } from "@/lib/cn";
import { getRosterView } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { clearInstructorRequest, suggestPairings } from "./actions";
import { AssignSelect } from "./assign-select";
import { CheckInSheet } from "./check-in-sheet";

export const metadata: Metadata = { title: "Instructor pairing" };

export default screen(async function PairingPage() {
  const v = await requireAdmin();
  if (!v.event)
    return (
      <EmptyState title="No event yet">
        Create an event and its roster first.
      </EmptyState>
    );
  const db = await getDb();
  const [{ rows }, assignments] = await Promise.all([
    getRosterView(v.event.id, v.org.id),
    db
      .select()
      .from(s.instructorAssignments)
      .where(eq(s.instructorAssignments.eventId, v.event.id)),
  ]);

  const groupById = new Map(v.groups.map((g) => [g.id, g]));
  const byId = new Map(rows.map((r) => [r.userId, r]));
  const needOf = (r: (typeof rows)[number]) =>
    instructorNeed(groupById.get(r.groupId)?.instructorPolicy, r);
  const pairedIds = new Set(assignments.map((a) => a.studentId));
  // Everyone who should ride with an instructor, plus anyone still paired after
  // being signed off solo or moved up, so that pairing can be seen and ended.
  const needs = rows
    .filter(
      (r) =>
        needOf(r) !== null || (pairedIds.has(r.userId) && !r.isInstructor),
    )
    .sort(
      (a, b) =>
        (groupById.get(a.groupId)?.sortOrder ?? 0) -
          (groupById.get(b.groupId)?.sortOrder ?? 0) ||
        a.lastName.localeCompare(b.lastName),
    );
  const instructors = rows
    .filter((r) => r.isInstructor)
    .sort((a, b) => a.lastName.localeCompare(b.lastName));
  const studentsOf = new Map<string, string[]>(
    instructors.map((i) => [i.userId, []]),
  );
  const instructorOf = new Map<string, string>();
  for (const a of assignments) {
    studentsOf.get(a.instructorId)?.push(a.studentId);
    instructorOf.set(a.studentId, a.instructorId);
  }
  const unpaired = needs.filter(
    (n) => needOf(n) !== null && !instructorOf.has(n.userId),
  );
  const free = instructors.filter(
    (i) => !(studentsOf.get(i.userId) ?? []).length,
  );
  // Solo drivers who could be given a check-in: not instructing, not already on the list.
  const soloDrivers = rows
    .filter(
      (r) =>
        !r.isInstructor &&
        needOf(r) === null &&
        !groupById.get(r.groupId)?.isInstructorGroup,
    )
    .map((r) => ({
      id: r.userId,
      label: `${r.name} · ${groupById.get(r.groupId)?.name ?? ""}${r.carNumber ? ` · #${r.carNumber}` : ""}`,
    }));
  // The lede names this region's own groups rather than assuming CERPCA's colours.
  const named = (policy: string) =>
    listNames(
      v.groups
        .filter((g) => g.instructorPolicy === policy && !g.isInstructorGroup)
        .map((g) => g.name),
    );
  const lede = [
    named("required") &&
      `${named("required")} drivers always ride with an instructor.`,
    named("optional") &&
      `${named("optional")} drivers do until they are signed off solo.`,
    named("none") &&
      `${named("none")} drivers are solo, and appear here when they ask for a ride-along or you add a check-in.`,
    "Pairing someone alerts both people.",
  ]
    .filter(Boolean)
    .join(" ");
  const clashFor = (instructorId: string) => {
    const groups = (studentsOf.get(instructorId) ?? []).map(
      (id) => byId.get(id)?.groupId,
    );
    return groups.length !== new Set(groups).size;
  };

  return (
    <>
      <PageHeader
        title="Instructor pairing"
        lede={lede}
        actions={
          <>
            {soloDrivers.length && instructors.length ? (
              <CheckInSheet drivers={soloDrivers} />
            ) : null}
            {unpaired.length ? (
              <ActionButton
                action={suggestPairings}
                variant="primary"
                confirm={`Pair the ${plural(unpaired.length, "driver")} without an instructor automatically? You can change any pairing afterwards.`}
              >
                <Wand2 className="size-4" /> Pair the rest for me
              </ActionButton>
            ) : null}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Need an instructor"
          value={needs.filter((n) => needOf(n) !== null).length}
        />
        <Stat
          label="Not paired yet"
          value={unpaired.length}
          tone={unpaired.length ? "bad" : "good"}
        />
        <Stat label="Instructors here" value={instructors.length} />
        <Stat label="Instructors free" value={free.length} />
      </div>

      {!instructors.length ? (
        <Notice
          tone="warn"
          className="mb-6"
          title="Nobody is marked as instructing at this event"
        >
          Open a person from the{" "}
          <Link href="/admin/roster" className="underline underline-offset-4">
            roster
          </Link>
          , choose Edit, and tick “Instructing at this event”.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          <SectionTitle>Students</SectionTitle>
          {needs.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
              {needs.map((st) => {
                const current = instructorOf.get(st.userId) ?? "";
                const need = needOf(st);
                const asked = need === "ride_along" || need === "check_in";
                return (
                  <li
                    key={st.userId}
                    className="grid grid-cols-1 items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <CarNumber n={st.carNumber} size="sm" />
                      <span className="min-w-0 flex-1">
                        <Link
                          href={`/admin/roster/${st.userId}`}
                          className="block truncate font-bold underline-offset-4 hover:underline"
                        >
                          {st.name}
                        </Link>
                        <span className="block truncate text-[13px] text-ink-3">
                          {st.car}
                          {st.day1 && st.day2
                            ? ""
                            : st.day1
                              ? " · first day only"
                              : " · second day only"}
                        </span>
                      </span>
                      <GroupChip group={groupById.get(st.groupId)} size="sm" />
                    </div>
                    {need === null ? (
                      <div className="min-w-0 sm:col-span-2 sm:row-start-2">
                        <Pill tone="warn">Solo now</Pill>
                        <p className="mt-1 text-[14px] text-ink-2">
                          No longer needs an instructor but is still paired.
                          Choose “No instructor” to end the pairing.
                        </p>
                      </div>
                    ) : null}
                    {asked ? (
                      <div className="min-w-0 sm:col-span-2 sm:row-start-2">
                        <div className="flex items-center justify-between gap-2">
                          <Pill tone={need === "check_in" ? "neutral" : "info"}>
                            {NEED_LABEL[need]}
                          </Pill>
                          <ActionButton
                            action={clearInstructorRequest.bind(
                              null,
                              st.userId,
                            )}
                            variant="ghost"
                            size="sm"
                            className="-mr-2 text-ink-2"
                            confirm={
                              current
                                ? `Take ${st.name} off the list? Their pairing is removed and the instructor is told.`
                                : undefined
                            }
                          >
                            Remove
                          </ActionButton>
                        </div>
                        {st.instructorRequestNote ? (
                          <p className="text-[14px] text-ink-2">
                            “{st.instructorRequestNote}”
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <AssignSelect
                      studentId={st.userId}
                      studentName={st.name}
                      value={current}
                      options={instructors.map((i) => {
                        const theirs = (studentsOf.get(i.userId) ?? []).filter(
                          (id) => id !== st.userId,
                        );
                        return {
                          id: i.userId,
                          name: i.name,
                          load: theirs.length,
                          clash: theirs.some(
                            (id) => byId.get(id)?.groupId === st.groupId,
                          ),
                        };
                      })}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No one needs an instructor">
              Drivers in instructed run groups appear here once they are on the
              roster, along with solo drivers who ask for a ride-along.
            </EmptyState>
          )}
        </section>

        <section className="min-w-0">
          <SectionTitle>Instructors</SectionTitle>
          <ul className="space-y-2">
            {instructors.map((i) => {
              const students = (studentsOf.get(i.userId) ?? [])
                .map((id) => byId.get(id))
                .filter((x) => x !== undefined);
              const clash = clashFor(i.userId);
              return (
                <li key={i.userId}>
                  <Card className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CarNumber n={i.carNumber} size="sm" />
                      <Link
                        href={`/admin/roster/${i.userId}`}
                        className="min-w-0 flex-1 truncate font-bold underline-offset-4 hover:underline"
                      >
                        {i.name}
                      </Link>
                      <Pill tone={students.length ? "neutral" : "good"}>
                        {students.length
                          ? plural(students.length, "student")
                          : "Free"}
                      </Pill>
                    </div>
                    {students.length ? (
                      <ul className="mt-2 space-y-1 border-t border-line pt-2">
                        {students.map((st) => (
                          <li
                            key={st.userId}
                            className="flex items-center justify-between gap-2 text-[15px]"
                          >
                            <span className="truncate">{st.name}</span>
                            <GroupChip
                              group={groupById.get(st.groupId)}
                              size="sm"
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {clash ? (
                      <p className="mt-2 flex items-start gap-1.5 text-[13px] font-semibold text-bad">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{" "}
                        Two students in the same run group are on track at the
                        same time.
                      </p>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
});

/** "Green", "Green and Blue", "White, Black and Gold". */
function listNames(names: string[]) {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
