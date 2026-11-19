import { and, eq, inArray, ne, or } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import { fullName } from "@/lib/cn";
import { instructorNeed } from "@/lib/instruction";
import type { Channel } from "@/lib/types";
import { notifyUsers } from "./notify";

/* Instructor and student pairings for an event, and what happens to them when someone leaves it. */

/**
 * The pairings that still stand: both people are on the roster and the
 * instructor is instructing at this event. Anything else is a leftover row and
 * must not make a student look paired.
 */
export async function livePairings(eventId: string) {
  const db = await getDb();
  const [assignments, regs] = await Promise.all([
    db.select().from(s.instructorAssignments).where(eq(s.instructorAssignments.eventId, eventId)),
    db
      .select({ userId: s.registrations.userId, isInstructor: s.registrations.isInstructor })
      .from(s.registrations)
      .where(and(eq(s.registrations.eventId, eventId), ne(s.registrations.status, "cancelled"))),
  ]);
  const instructing = new Map(regs.map((r) => [r.userId, r.isInstructor]));
  return assignments.filter((a) => instructing.get(a.instructorId) === true && instructing.has(a.studentId));
}

/**
 * End the pairings a person is part of at an event and tell the other person.
 * Call it when a registration is cancelled (both roles) or someone stops
 * instructing (their students only).
 */
export async function endPairings(
  eventId: string,
  userId: string,
  roles: { asInstructor: boolean; asStudent: boolean },
): Promise<{ students: number; needInstructor: number; instructors: number }> {
  const none = { students: 0, needInstructor: 0, instructors: 0 };
  if (!roles.asInstructor && !roles.asStudent) return none;
  const db = await getDb();
  const mine = or(
    roles.asInstructor ? eq(s.instructorAssignments.instructorId, userId) : undefined,
    roles.asStudent ? eq(s.instructorAssignments.studentId, userId) : undefined,
  );
  const rows = await db
    .select()
    .from(s.instructorAssignments)
    .where(and(eq(s.instructorAssignments.eventId, eventId), mine));
  if (!rows.length) return none;
  await db.delete(s.instructorAssignments).where(inArray(s.instructorAssignments.id, rows.map((r) => r.id)));

  const [person] = await db.select().from(s.users).where(eq(s.users.id, userId)).limit(1);
  const name = person ? fullName(person) : "Your instructor";
  const studentIds = rows.filter((r) => r.instructorId === userId).map((r) => r.studentId);
  const instructorIds = rows.filter((r) => r.studentId === userId).map((r) => r.instructorId);

  // Students who lose their instructor: those who must ride with one are told a new pairing is coming.
  let needInstructor = 0;
  if (studentIds.length) {
    const regs = await db
      .select({ reg: s.registrations, policy: s.runGroups.instructorPolicy })
      .from(s.registrations)
      .innerJoin(s.runGroups, eq(s.runGroups.id, s.registrations.runGroupId))
      .where(and(eq(s.registrations.eventId, eventId), inArray(s.registrations.userId, studentIds), ne(s.registrations.status, "cancelled")));
    const needs = regs.filter((r) => instructorNeed(r.policy, r.reg) !== null).map((r) => r.reg.userId);
    const solo = regs.filter((r) => instructorNeed(r.policy, r.reg) === null).map((r) => r.reg.userId);
    needInstructor = needs.length;
    const channels: Channel[] = ["inapp", "push"];
    const base = { title: `${name} is no longer your instructor`, href: "/home", kind: "assignment", eventId, channels };
    await Promise.all([
      needs.length
        ? notifyUsers({
            ...base,
            userIds: needs,
            urgent: true,
            body: "They are not instructing at this event any more. The administrators will pair you with another instructor, and you will get an alert when they do. Do not go on track without one.",
          })
        : null,
      solo.length
        ? notifyUsers({
            ...base,
            userIds: solo,
            body: "They are not instructing at this event any more. You drive solo, so nothing else changes.",
          })
        : null,
    ]);
  }
  if (instructorIds.length) {
    await notifyUsers({
      userIds: instructorIds,
      title: `${person ? fullName(person) : "A student"} is off your student list`,
      body: "They are no longer driving as a student at this event.",
      href: "/instructor",
      kind: "assignment",
      eventId,
      channels: ["inapp", "push"],
    });
  }
  return { students: studentIds.length, needInstructor, instructors: instructorIds.length };
}
