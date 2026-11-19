import { and, asc, count, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import type { RunGroup, User, Vehicle } from "@/db/schema";
import { eachDay } from "@/lib/time";
import type { GroupLite, ScheduleEntry } from "@/lib/types";
import type { Viewer } from "./auth";
import { clearanceFor } from "./clearance";

/* Read models shared by several screens. Feature-specific reads live beside their pages. */

export const groupLite = (g: RunGroup): GroupLite => ({
  id: g.id,
  key: g.key,
  name: g.name,
  color: g.color,
  textColor: g.textColor,
  sortOrder: g.sortOrder,
  split: g.instructorPolicy === "optional",
  instructorPolicy: g.instructorPolicy,
});

export async function getSchedule(eventId: string): Promise<ScheduleEntry[]> {
  const db = await getDb();
  const rows = await db.select().from(s.scheduleItems).where(eq(s.scheduleItems.eventId, eventId)).orderBy(asc(s.scheduleItems.day), asc(s.scheduleItems.startMin));
  return rows.map((r) => ({
    id: r.id,
    day: r.day,
    startMin: r.startMin,
    endMin: r.endMin,
    kind: r.kind,
    title: r.title,
    location: r.location,
    audience: r.audience,
    groupIds: r.groupIds,
    groupParts: r.groupParts ?? {},
    note: r.note,
    cancelled: r.cancelled,
    movedFromDay: r.movedFromDay,
    movedFromMin: r.movedFromMin,
  }));
}

export async function unreadCount(userId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(s.notifications).where(and(eq(s.notifications.userId, userId), isNull(s.notifications.readAt)));
  return row?.n ?? 0;
}

export type PersonCard = {
  user: User;
  vehicle: Vehicle | null;
  groupId: string;
  carNumber: string | null;
  solo: boolean;
  /** "ride_along" | "check_in" when a solo driver is riding with an instructor anyway. */
  instructorRequest: string | null;
  instructorRequestNote: string | null;
  attendsDay1: boolean;
  attendsDay2: boolean;
  /** Instructing at this event. */
  isInstructor: boolean;
};

/** Students assigned to an instructor at an event, and the instructor assigned to a student. */
export async function getAssignments(eventId: string, userId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(s.instructorAssignments)
    .where(and(eq(s.instructorAssignments.eventId, eventId), or(eq(s.instructorAssignments.instructorId, userId), eq(s.instructorAssignments.studentId, userId))));
  const studentIds = rows.filter((r) => r.instructorId === userId).map((r) => r.studentId);
  const instructorId = rows.find((r) => r.studentId === userId)?.instructorId ?? null;
  const ids = [...studentIds, ...(instructorId ? [instructorId] : [])];
  const people = ids.length ? await getPeople(eventId, ids) : new Map<string, PersonCard>();
  return {
    students: studentIds.map((id) => people.get(id)).filter((p): p is PersonCard => Boolean(p)),
    // An instructor who has left the event, or stopped instructing at it, is nobody's instructor.
    instructor: (instructorId && people.get(instructorId)?.isInstructor ? people.get(instructorId) : null) ?? null,
  };
}

/** Registration-level cards for a set of people at an event. Cancelled registrations are left out. */
export async function getPeople(eventId: string, userIds: string[]): Promise<Map<string, PersonCard>> {
  const db = await getDb();
  if (!userIds.length) return new Map();
  const rows = await db
    .select({ user: s.users, reg: s.registrations, vehicle: s.vehicles })
    .from(s.registrations)
    .innerJoin(s.users, eq(s.users.id, s.registrations.userId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.registrations.vehicleId))
    .where(and(eq(s.registrations.eventId, eventId), inArray(s.registrations.userId, userIds), ne(s.registrations.status, "cancelled")));
  return new Map(
    rows.map((r) => [
      r.user.id,
      { user: r.user, vehicle: r.vehicle, groupId: r.reg.runGroupId, carNumber: r.reg.carNumber, solo: r.reg.solo, instructorRequest: r.reg.instructorRequest, instructorRequestNote: r.reg.instructorRequestNote, attendsDay1: r.reg.attendsDay1, attendsDay2: r.reg.attendsDay2, isInstructor: r.reg.isInstructor },
    ]),
  );
}

export function eventDays(event: { startDate: string; endDate: string }) {
  return eachDay(event.startDate, event.endDate);
}

/** How the viewer's schedule is picked out: their group, their solo status, and their students. */
export function viewerLens(v: Viewer, students: PersonCard[]) {
  return {
    groupId: v.registration?.runGroupId ?? null,
    solo: Boolean(v.registration?.solo),
    instructing: Boolean(v.registration?.isInstructor),
    students: students.map((st) => ({ groupId: st.groupId, solo: st.solo, firstName: st.user.firstName })),
    days: viewerDays(v),
  };
}

/** Which event days the viewer is attending (all of them if not registered). */
export function viewerDays(v: Viewer): string[] {
  if (!v.event) return [];
  const days = eventDays(v.event);
  if (!v.registration) return days;
  return days.filter((_, i) => (i === 0 ? v.registration!.attendsDay1 : i === 1 ? v.registration!.attendsDay2 : true));
}

/** The viewer's paperwork for the event in focus: waivers, tech form and sticker. */
export async function getChecklist(v: Viewer) {
  if (!v.event) return null;
  return clearanceFor(v.org.id, v.event.id, v.user.id);
}

/** Counts that drive the badges in the admin navigation. */
export async function adminBadges(orgId: string, eventId: string | null) {
  const db = await getDb();
  const [promo] = await db.select({ n: count() }).from(s.promotions).where(and(eq(s.promotions.orgId, orgId), eq(s.promotions.status, "proposed")));
  if (!eventId) return { tech: 0, promotions: promo?.n ?? 0, incidents: 0 };
  const [tech] = await db.select({ n: count() }).from(s.techInspections).where(and(eq(s.techInspections.eventId, eventId), eq(s.techInspections.status, "submitted")));
  const [inc] = await db.select({ n: count() }).from(s.incidents).where(and(eq(s.incidents.orgId, orgId), ne(s.incidents.status, "sent")));
  return { tech: tech?.n ?? 0, promotions: promo?.n ?? 0, incidents: inc?.n ?? 0 };
}

export async function latestAnnouncementId(orgId: string, eventId: string | null): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ id: s.announcements.id })
    .from(s.announcements)
    .where(eventId ? and(eq(s.announcements.orgId, orgId), eq(s.announcements.eventId, eventId)) : eq(s.announcements.orgId, orgId))
    .orderBy(desc(s.announcements.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export type RosterRow = {
  user: User;
  reg: typeof s.registrations.$inferSelect;
  vehicle: Vehicle | null;
  group: RunGroup;
};

/** Everyone registered for an event (cancelled registrations excluded), sorted by last name. */
export async function getRoster(eventId: string): Promise<RosterRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ user: s.users, reg: s.registrations, vehicle: s.vehicles, group: s.runGroups })
    .from(s.registrations)
    .innerJoin(s.users, eq(s.users.id, s.registrations.userId))
    .innerJoin(s.runGroups, eq(s.runGroups.id, s.registrations.runGroupId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.registrations.vehicleId))
    .where(and(eq(s.registrations.eventId, eventId), ne(s.registrations.status, "cancelled")))
    .orderBy(asc(s.users.lastName), asc(s.users.firstName));
  return rows;
}
