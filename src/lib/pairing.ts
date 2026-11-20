import type { InstructorNeed } from "./instruction";
import { inItem } from "./schedule";
import { clock, weekdayShort } from "./time";
import type { ScheduleEntry } from "./types";

/*
 * When an instructor cannot be in two right seats at once.
 *
 * Pairings are judged against the schedule, not against run-group names. A
 * combined session ("Green and Blue") puts two groups on track together, and a
 * split one ("Blue Solo and White") keeps two halves of one group apart, so
 * comparing group ids gets both cases wrong.
 *
 * What counts as a double booking depends on what the student needs:
 *
 *  - "required" and "instructed" students need the instructor in the car every
 *    session. Two of them out at the same time, even once, is a double booking.
 *  - A ride-along or a check-in needs one session. Sharing a session with
 *    another student is fine as long as some session of theirs is left free.
 *
 * The instructor's own run group being out while a student needs them is
 * reported separately ("own"). It is not a double booking: the instructor gives
 * up that session, as instructors do, so it never blocks a pairing.
 */

type Session = Pick<ScheduleEntry, "id" | "day" | "startMin" | "endMin" | "title" | "kind" | "cancelled" | "groupIds" | "groupParts">;

export type PairingPerson = {
  userId: string;
  groupId: string | null;
  /** The solo sign-off: decides which half of a split group's sessions are theirs. */
  solo: boolean;
  /** The event days they attend. */
  days: string[];
};

export type PairedStudent = PairingPerson & { name: string; need: InstructorNeed | null };

export type PairingClash = {
  /**
   * "together": two every-session students are out at the same time.
   * "no_session": a ride-along or check-in has no session the instructor is free for.
   * "own": the instructor's own run group is out while an every-session student is.
   */
  kind: "together" | "no_session" | "own";
  /** Two students for "together", otherwise one. */
  students: PairedStudent[];
  /** The student's sessions it happens in, earliest first. Empty for two students in one run group before the schedule is built. */
  sessions: Session[];
  /** "together" only: the two share a run group, so it is every session, not the odd combined one. */
  sameGroup: boolean;
};

/** A clash that means someone goes without their instructor. */
export const isDoubleBooking = (c: PairingClash) => c.kind !== "own";

const everySession = (s: PairedStudent) => s.need === "required" || s.need === "instructed";
const oneSession = (s: PairedStudent) => s.need === "ride_along" || s.need === "check_in";
const overlaps = (a: Session, b: Session) => a.day === b.day && a.startMin < b.endMin && b.startMin < a.endMin;
const inOrder = (list: Session[]) => [...list].sort((a, b) => a.day.localeCompare(b.day) || a.startMin - b.startMin);

/** The track sessions a person is out in: not cancelled, on a day they attend. */
export function trackSessions(schedule: Session[], p: PairingPerson): Session[] {
  return schedule.filter((i) => i.kind === "track" && !i.cancelled && p.days.includes(i.day) && inItem(i, p.groupId, p.solo));
}

/** Everything that stops this instructor being where their students need them. */
export function pairingClashes(schedule: Session[], instructor: PairingPerson, students: PairedStudent[]): PairingClash[] {
  // Only days the instructor is there. On the others they are in nobody's car, which is a different problem.
  const out = new Map(students.map((s) => [s.userId, inOrder(trackSessions(schedule, s).filter((i) => instructor.days.includes(i.day)))]));
  const sessionsOf = (s: PairedStudent) => out.get(s.userId) ?? [];
  const every = students.filter(everySession);
  const clashes: PairingClash[] = [];

  for (let i = 0; i < every.length; i++) {
    for (let j = i + 1; j < every.length; j++) {
      const [a, b] = [every[i], every[j]];
      const sameGroup = Boolean(a.groupId) && a.groupId === b.groupId;
      const sessions = sessionsOf(a).filter((x) => sessionsOf(b).some((y) => overlaps(x, y)));
      // With no sessions on the schedule yet there is nothing to compare, but one run group always goes out together.
      const unscheduled = sameGroup && !sessionsOf(a).length && !sessionsOf(b).length && a.days.some((d) => b.days.includes(d) && instructor.days.includes(d));
      if (sessions.length || unscheduled) clashes.push({ kind: "together", students: [a, b], sessions, sameGroup });
    }
  }

  for (const o of students.filter(oneSession)) {
    const mine = sessionsOf(o);
    if (mine.length && mine.every((x) => every.some((e) => sessionsOf(e).some((y) => overlaps(x, y))))) {
      clashes.push({ kind: "no_session", students: [o], sessions: mine, sameGroup: false });
    }
  }

  const own = trackSessions(schedule, instructor);
  for (const e of every) {
    const sessions = sessionsOf(e).filter((x) => own.some((y) => overlaps(x, y)));
    if (sessions.length) clashes.push({ kind: "own", students: [e], sessions, sameGroup: false });
  }
  return clashes;
}

const key = (c: PairingClash) => `${c.kind}:${c.students.map((s) => s.userId).sort().join("+")}`;

/** The double bookings that pairing `student` with this instructor would add to the ones they already have. */
export function clashesIfPaired(schedule: Session[], instructor: PairingPerson, current: PairedStudent[], student: PairedStudent): PairingClash[] {
  const others = current.filter((s) => s.userId !== student.userId);
  const before = new Set(pairingClashes(schedule, instructor, others).filter(isDoubleBooking).map(key));
  return pairingClashes(schedule, instructor, [...others, student]).filter((c) => isDoubleBooking(c) && !before.has(key(c)));
}

/** "Sun 3:10 PM, Green and Blue" */
export const sessionLabel = (i: Pick<Session, "day" | "startMin" | "title">) => `${weekdayShort(i.day)} ${clock(i.startMin)}, ${i.title}`;

function when(sessions: Session[]): string {
  const more = sessions.length - 1;
  return `${sessionLabel(sessions[0])}${more > 0 ? `, and ${more} more session${more === 1 ? "" : "s"}` : ""}`;
}

/** One sentence for the pairing page and the confirmation after pairing by hand. */
export function clashText(c: PairingClash): string {
  const [a, b] = c.students.map((s) => s.name);
  if (c.kind === "together") {
    if (c.sameGroup || !c.sessions.length) return `${a} and ${b} are in the same run group, so they are on track at the same time.`;
    return `${a} and ${b} are on track at the same time: ${when(c.sessions)}.`;
  }
  if (c.kind === "no_session") return `No session is free to ride with ${a}: this instructor's other students are on track in every one.`;
  return `${a} is on track during this instructor's own session: ${when(c.sessions)}.`;
}

/** A few words for the instructor picker, where there is no room for a sentence. */
export function clashShort(c: PairingClash): string {
  if (c.kind === "together") return c.sameGroup || !c.sessions.length ? "same group clash" : `clash ${weekdayShort(c.sessions[0].day)} ${clock(c.sessions[0].startMin)}`;
  return "no session free";
}
