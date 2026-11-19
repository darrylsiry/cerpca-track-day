"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import { fullName } from "@/lib/cn";
import { instructorNeed } from "@/lib/instruction";
import type { ActionResult } from "@/lib/types";
import { getRosterView, usersByIds } from "@/server/admin";
import { requireEvent } from "@/server/auth";
import { notifyUsers } from "@/server/notify";
import { livePairings } from "@/server/pairings";
import { asFailure, fail, ok, str } from "@/server/util";

async function tellPair(
  eventId: string,
  instructorId: string,
  studentId: string,
) {
  const db = await getDb();
  const people = await usersByIds([instructorId, studentId]);
  const inst = people.get(instructorId);
  const student = people.get(studentId);
  if (!inst || !student) return;
  // A solo driver paired for a ride-along or a check-in is told why, in plain terms.
  const [reg] = await db
    .select({ request: s.registrations.instructorRequest })
    .from(s.registrations)
    .where(
      and(
        eq(s.registrations.eventId, eventId),
        eq(s.registrations.userId, studentId),
      ),
    )
    .limit(1);
  const request = reg?.request ?? null;
  await Promise.all([
    notifyUsers({
      userIds: [studentId],
      title:
        request === "ride_along"
          ? `${fullName(inst)} will ride along with you`
          : request === "check_in"
            ? `${fullName(inst)} will check in with you`
            : `Your instructor is ${fullName(inst)}`,
      body:
        request === "check_in"
          ? "The administrators have asked an instructor to ride with you at this event. Their car and phone number are on your Now screen."
          : "Meet at the grid ten minutes before each of your sessions. Their car and phone number are on your Now screen.",
      href: "/home",
      kind: "assignment",
      eventId,
      channels: ["inapp", "push"],
    }),
    notifyUsers({
      userIds: [instructorId],
      title:
        request === "ride_along"
          ? `Ride-along: ${fullName(student)}`
          : request === "check_in"
            ? `Check-in: ${fullName(student)}`
            : `New student: ${fullName(student)}`,
      body:
        request === "ride_along"
          ? "A solo driver asked for an instructor. What they want to work on is under My students."
          : request === "check_in"
            ? "The administrators asked for a check-in with this solo driver. Their note is under My students."
            : "Their car, run group and session times are under My students.",
      href: "/instructor",
      kind: "assignment",
      eventId,
      channels: ["inapp", "push"],
    }),
  ]);
}

/** Pair a student with an instructor for this event; an empty instructor removes the pairing. */
export async function assignInstructor(
  studentId: string,
  instructorId: string,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const db = await getDb();
    const [current] = await db
      .select()
      .from(s.instructorAssignments)
      .where(
        and(
          eq(s.instructorAssignments.eventId, v.event.id),
          eq(s.instructorAssignments.studentId, studentId),
        ),
      )
      .limit(1);
    if (!instructorId) {
      if (current)
        await db
          .delete(s.instructorAssignments)
          .where(eq(s.instructorAssignments.id, current.id));
      refresh();
      return ok("Pairing removed");
    }
    if (instructorId === studentId)
      return fail("A driver cannot instruct themselves.");
    const [reg] = await db
      .select()
      .from(s.registrations)
      .where(
        and(
          eq(s.registrations.eventId, v.event.id),
          eq(s.registrations.userId, instructorId),
        ),
      )
      .limit(1);
    if (!reg?.isInstructor)
      return fail("That person is not instructing at this event.");
    if (current?.instructorId === instructorId) return ok("Already paired");
    if (current)
      await db
        .update(s.instructorAssignments)
        .set({ instructorId })
        .where(eq(s.instructorAssignments.id, current.id));
    else
      await db
        .insert(s.instructorAssignments)
        .values({ eventId: v.event.id, instructorId, studentId });
    await tellPair(v.event.id, instructorId, studentId);
    refresh();
    return ok("Paired, and both have been told");
  } catch (err) {
    return asFailure(err);
  }
}

/**
 * Fill the gaps: give each unpaired student the least-loaded instructor who
 * doesn't already have a student in the same run group (two students in one
 * group are on track at the same time).
 */
export async function suggestPairings(): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const db = await getDb();
    const { rows } = await getRosterView(v.event.id, v.org.id);
    const policy = new Map(v.groups.map((g) => [g.id, g.instructorPolicy]));
    const needs = rows.filter(
      (r) => instructorNeed(policy.get(r.groupId), r) !== null,
    );
    const instructors = rows.filter((r) => r.isInstructor);
    const assignments = await livePairings(v.event.id);
    const groupOf = new Map(rows.map((r) => [r.userId, r.groupId]));
    const load = new Map<string, string[]>(
      instructors.map((i) => [i.userId, []]),
    );
    for (const a of assignments)
      load.get(a.instructorId)?.push(groupOf.get(a.studentId) ?? "");
    const assigned = new Set(assignments.map((a) => a.studentId));

    let made = 0;
    let stuck = 0;
    // Novices first: they cannot go out without an instructor. Solo drivers
    // who asked for a ride-along come last, since they can drive without one.
    const rank = (r: (typeof rows)[number]) =>
      ["required", "instructed", "check_in", "ride_along"].indexOf(
        instructorNeed(policy.get(r.groupId), r) ?? "ride_along",
      );
    const order = needs
      .filter((n) => !assigned.has(n.userId))
      .sort((a, b) => rank(a) - rank(b));
    for (const student of order) {
      const pick = instructors
        .filter(
          (i) =>
            !load.get(i.userId)!.includes(student.groupId) &&
            load.get(i.userId)!.length < 2,
        )
        .sort(
          (a, b) => load.get(a.userId)!.length - load.get(b.userId)!.length,
        )[0];
      if (!pick) {
        stuck += 1;
        continue;
      }
      // A leftover row from an instructor who has since left is replaced, not duplicated.
      await db
        .insert(s.instructorAssignments)
        .values({
          eventId: v.event.id,
          instructorId: pick.userId,
          studentId: student.userId,
        })
        .onConflictDoUpdate({
          target: [
            s.instructorAssignments.eventId,
            s.instructorAssignments.studentId,
          ],
          set: { instructorId: pick.userId, note: null },
        });
      load.get(pick.userId)!.push(student.groupId);
      await tellPair(v.event.id, pick.userId, student.userId);
      made += 1;
    }
    refresh();
    if (!made && !stuck)
      return ok("Everyone who needs an instructor already has one");
    return ok(
      `${made} paired${stuck ? `, ${stuck} still need an instructor (no one free without a clash)` : ""}`,
    );
  } catch (err) {
    return asFailure(err);
  }
}

/** Ask for an instructor to check in on a solo driver at this event. The driver is told only once they are paired. */
export async function addCheckIn(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const studentId = str(fd, "studentId");
    if (!studentId) return fail("Choose a driver.");
    const db = await getDb();
    const [reg] = await db
      .select()
      .from(s.registrations)
      .where(
        and(
          eq(s.registrations.eventId, v.event.id),
          eq(s.registrations.userId, studentId),
        ),
      )
      .limit(1);
    if (!reg) return fail("That driver is not on this event's roster.");
    const policy = v.groups.find((g) => g.id === reg.runGroupId)?.instructorPolicy;
    if (reg.isInstructor)
      return fail("Instructors are not paired with an instructor.");
    if (reg.instructorRequest)
      return fail("That driver is already on the pairing list.");
    if (instructorNeed(policy, { ...reg, instructorRequest: null }) !== null)
      return fail("That driver already rides with an instructor.");
    await db
      .update(s.registrations)
      .set({
        instructorRequest: "check_in",
        instructorRequestNote: str(fd, "note").slice(0, 500) || null,
      })
      .where(eq(s.registrations.id, reg.id));
    refresh();
    return ok("Added. Pick an instructor for them in the list.");
  } catch (err) {
    return asFailure(err);
  }
}

/** Drop a ride-along request or a check-in, and any pairing made for it. */
export async function clearInstructorRequest(
  studentId: string,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const db = await getDb();
    const [reg] = await db
      .select()
      .from(s.registrations)
      .where(
        and(
          eq(s.registrations.eventId, v.event.id),
          eq(s.registrations.userId, studentId),
        ),
      )
      .limit(1);
    if (!reg?.instructorRequest) return ok("Nothing to remove");
    const pairing = and(
      eq(s.instructorAssignments.eventId, v.event.id),
      eq(s.instructorAssignments.studentId, studentId),
    );
    const [paired] = await db
      .select()
      .from(s.instructorAssignments)
      .where(pairing)
      .limit(1);
    await db
      .update(s.registrations)
      .set({ instructorRequest: null, instructorRequestNote: null })
      .where(eq(s.registrations.id, reg.id));
    if (paired) {
      await db.delete(s.instructorAssignments).where(pairing);
      const people = await usersByIds([studentId]);
      const student = people.get(studentId);
      await notifyUsers({
        userIds: [paired.instructorId],
        title: `${student ? fullName(student) : "A driver"} is off your student list`,
        // A check-in is something the administrators set up; a ride-along is something the driver asked for.
        body:
          reg.instructorRequest === "check_in"
            ? "The administrators ended the check-in."
            : "The administrators ended the ride-along.",
        href: "/instructor",
        kind: "assignment",
        eventId: v.event.id,
        channels: ["inapp", "push"],
      });
    }
    refresh();
    return ok("Removed");
  } catch (err) {
    return asFailure(err);
  }
}
