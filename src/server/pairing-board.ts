import { instructorNeed } from "@/lib/instruction";
import type { PairedStudent, PairingPerson } from "@/lib/pairing";
import { getRosterView } from "./admin";
import { livePairings } from "./pairings";
import { eventDays, getSchedule } from "./queries";

/**
 * The roster, the pairings that still stand and the schedule for an event, in
 * the shape the clash rules in @/lib/pairing take. The pairing page and the
 * pairing actions both read it, so they always judge a pairing the same way.
 */
export async function pairingBoard(
  event: { id: string; startDate: string; endDate: string },
  orgId: string,
  groups: { id: string; instructorPolicy: string }[],
) {
  const [{ rows }, assignments, schedule] = await Promise.all([getRosterView(event.id, orgId), livePairings(event.id), getSchedule(event.id)]);
  type Row = (typeof rows)[number];
  const days = eventDays(event);
  const policy = new Map(groups.map((g) => [g.id, g.instructorPolicy]));
  const byId = new Map(rows.map((r) => [r.userId, r]));

  const needOf = (r: Row) => instructorNeed(policy.get(r.groupId), r);
  const person = (r: Row): PairingPerson => ({
    userId: r.userId,
    groupId: r.groupId,
    solo: r.solo,
    days: days.filter((_, i) => (i === 0 ? r.day1 : i === 1 ? r.day2 : true)),
  });
  const student = (r: Row): PairedStudent => ({ ...person(r), name: r.name, need: needOf(r) });

  /** Each instructor's students, as the clash rules take them. Every instructor has an entry. */
  const studentsOf = new Map<string, PairedStudent[]>(rows.filter((r) => r.isInstructor).map((r) => [r.userId, []]));
  for (const a of assignments) {
    const r = byId.get(a.studentId);
    if (r) studentsOf.get(a.instructorId)?.push(student(r));
  }
  return { rows, assignments, schedule, byId, needOf, person, student, studentsOf };
}
