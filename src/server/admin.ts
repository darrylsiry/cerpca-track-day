import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import { fullName, vehicleLabel } from "@/lib/cn";
import { inItem } from "@/lib/schedule";
import type { AnnouncementAudience } from "@/lib/types";
import { getRoster } from "./queries";

/* Read models and helpers shared by the administrator screens. */

export type RosterEntry = {
  userId: string;
  regId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  groupId: string;
  carNumber: string | null;
  car: string;
  day1: boolean;
  day2: boolean;
  isInstructor: boolean;
  isAdmin: boolean;
  solo: boolean;
  /** "ride_along" | "check_in" when a solo driver is riding with an instructor anyway. */
  instructorRequest: string | null;
  instructorRequestNote: string | null;
  status: string;
  checkedIn: boolean;
  tshirt: string | null;
  waiversSigned: number;
  techStatus: string;
  sticker: string | null;
  instructorName: string | null;
  studentCount: number;
};

export async function getRosterView(
  eventId: string,
  orgId: string,
): Promise<{ rows: RosterEntry[]; waiversTotal: number }> {
  const db = await getDb();
  const [roster, templates, sigs, tech, assignments, members] =
    await Promise.all([
      getRoster(eventId),
      db
        .select({ id: s.waiverTemplates.id })
        .from(s.waiverTemplates)
        .where(
          and(
            eq(s.waiverTemplates.orgId, orgId),
            eq(s.waiverTemplates.active, true),
            eq(s.waiverTemplates.required, true),
          ),
        ),
      db
        .select({
          userId: s.waiverSignatures.userId,
          templateId: s.waiverSignatures.templateId,
        })
        .from(s.waiverSignatures)
        .where(eq(s.waiverSignatures.eventId, eventId)),
      db
        .select({
          userId: s.techInspections.userId,
          status: s.techInspections.status,
          sticker: s.techInspections.stickerNumber,
          issued: s.techInspections.stickerIssuedAt,
        })
        .from(s.techInspections)
        .where(eq(s.techInspections.eventId, eventId)),
      db
        .select()
        .from(s.instructorAssignments)
        .where(eq(s.instructorAssignments.eventId, eventId)),
      db
        .select({
          userId: s.memberships.userId,
          isAdmin: s.memberships.isAdmin,
        })
        .from(s.memberships)
        .where(eq(s.memberships.orgId, orgId)),
    ]);
  const required = new Set(templates.map((t) => t.id));
  const signedBy = new Map<string, Set<string>>();
  for (const sig of sigs) {
    if (!required.has(sig.templateId)) continue;
    if (!signedBy.has(sig.userId)) signedBy.set(sig.userId, new Set());
    signedBy.get(sig.userId)!.add(sig.templateId);
  }
  const techBy = new Map(tech.map((t) => [t.userId, t]));
  const nameBy = new Map(roster.map((r) => [r.user.id, fullName(r.user)]));
  const instructorOf = new Map(
    assignments.map((a) => [a.studentId, a.instructorId]),
  );
  const studentCount = new Map<string, number>();
  for (const a of assignments)
    studentCount.set(
      a.instructorId,
      (studentCount.get(a.instructorId) ?? 0) + 1,
    );
  const admins = new Set(members.filter((m) => m.isAdmin).map((m) => m.userId));

  const rows = roster.map((r): RosterEntry => {
    const t = techBy.get(r.user.id);
    const inst = instructorOf.get(r.user.id);
    return {
      userId: r.user.id,
      regId: r.reg.id,
      name: fullName(r.user),
      firstName: r.user.firstName,
      lastName: r.user.lastName,
      email: r.user.email,
      phone: r.user.phone,
      groupId: r.group.id,
      carNumber: r.reg.carNumber,
      car: vehicleLabel(r.vehicle),
      day1: r.reg.attendsDay1,
      day2: r.reg.attendsDay2,
      isInstructor: r.reg.isInstructor,
      isAdmin: admins.has(r.user.id),
      solo: r.reg.solo,
      instructorRequest: r.reg.instructorRequest,
      instructorRequestNote: r.reg.instructorRequestNote,
      status: r.reg.status,
      checkedIn: Boolean(r.reg.checkedInAt),
      tshirt: r.reg.tshirtSize,
      waiversSigned: signedBy.get(r.user.id)?.size ?? 0,
      techStatus: t?.status ?? "none",
      sticker: t?.issued ? (t.sticker ?? "Issued") : null,
      instructorName: inst ? (nameBy.get(inst) ?? null) : null,
      studentCount: studentCount.get(r.user.id) ?? 0,
    };
  });
  return { rows, waiversTotal: required.size };
}

/** Resolve an announcement audience to the people registered for an event. */
export async function audienceUserIds(
  eventId: string,
  orgId: string,
  audience: AnnouncementAudience,
): Promise<string[]> {
  const db = await getDb();
  const regs = await db
    .select({
      userId: s.registrations.userId,
      groupId: s.registrations.runGroupId,
      isInstructor: s.registrations.isInstructor,
      solo: s.registrations.solo,
    })
    .from(s.registrations)
    .where(
      and(
        eq(s.registrations.eventId, eventId),
        ne(s.registrations.status, "cancelled"),
      ),
    );
  switch (audience.kind) {
    case "all":
      return regs.map((r) => r.userId);
    case "groups":
      // A schedule change for "Blue Solo" goes to the solo half of Blue only.
      return regs
        .filter((r) =>
          inItem(
            {
              groupIds: audience.groupIds ?? [],
              groupParts: audience.groupParts ?? {},
            },
            r.groupId,
            r.solo,
          ),
        )
        .map((r) => r.userId);
    case "instructors":
      return regs.filter((r) => r.isInstructor).map((r) => r.userId);
    case "students": {
      const a = await db
        .select({ studentId: s.instructorAssignments.studentId })
        .from(s.instructorAssignments)
        .where(eq(s.instructorAssignments.eventId, eventId));
      return a.map((x) => x.studentId);
    }
    case "admins": {
      const m = await db
        .select({ userId: s.memberships.userId })
        .from(s.memberships)
        .where(
          and(eq(s.memberships.orgId, orgId), eq(s.memberships.isAdmin, true)),
        );
      return m.map((x) => x.userId);
    }
  }
}

export async function adminUserIds(orgId: string): Promise<string[]> {
  const db = await getDb();
  const m = await db
    .select({ userId: s.memberships.userId })
    .from(s.memberships)
    .where(
      and(eq(s.memberships.orgId, orgId), eq(s.memberships.isAdmin, true)),
    );
  return m.map((x) => x.userId);
}

/** Every schedule edit bumps the event's version; open apps notice within seconds and refresh. */
export async function bumpSchedule(eventId: string) {
  const db = await getDb();
  await db
    .update(s.events)
    .set({ scheduleVersion: sql`${s.events.scheduleVersion} + 1` })
    .where(eq(s.events.id, eventId));
}

export async function usersByIds(ids: string[]) {
  if (!ids.length) return new Map<string, typeof s.users.$inferSelect>();
  const db = await getDb();
  const rows = await db
    .select()
    .from(s.users)
    .where(inArray(s.users.id, [...new Set(ids)]));
  return new Map(rows.map((u) => [u.id, u]));
}

export async function orgEvents(orgId: string) {
  const db = await getDb();
  return db
    .select()
    .from(s.events)
    .where(eq(s.events.orgId, orgId))
    .orderBy(asc(s.events.startDate));
}
