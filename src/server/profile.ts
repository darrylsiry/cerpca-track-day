import { and, asc, desc, eq, ne } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import type { Viewer } from "./auth";

/** Everything the profile screen shows about the signed-in person. */
export async function getProfile(v: Viewer) {
  const db = await getDb();
  const [vehicles, history, feedback, promotions] = await Promise.all([
    db.select().from(s.vehicles).where(eq(s.vehicles.userId, v.user.id)).orderBy(desc(s.vehicles.isPrimary), asc(s.vehicles.createdAt)),

    // Events attended, with the run group driven in at each.
    db
      .select({
        eventId: s.events.id,
        name: s.events.name,
        startDate: s.events.startDate,
        endDate: s.events.endDate,
        status: s.events.status,
        track: s.tracks.shortName,
        groupId: s.registrations.runGroupId,
        instructing: s.registrations.isInstructor,
        carNumber: s.registrations.carNumber,
      })
      .from(s.registrations)
      .innerJoin(s.events, eq(s.events.id, s.registrations.eventId))
      .innerJoin(s.tracks, eq(s.tracks.id, s.events.trackId))
      .where(and(eq(s.registrations.userId, v.user.id), eq(s.events.orgId, v.org.id), ne(s.registrations.status, "cancelled")))
      .orderBy(desc(s.events.startDate)),

    // Instructor feedback addressed to the student. Only the shared fields are selected:
    // `privateNotes` is for administrators and must never reach this screen.
    db
      .select({
        id: s.sessionLogs.id,
        label: s.sessionLogs.label,
        sharedNotes: s.sessionLogs.sharedNotes,
        focusAreas: s.sessionLogs.focusAreas,
        createdAt: s.sessionLogs.createdAt,
        eventName: s.events.name,
        instructorFirst: s.users.firstName,
        instructorLast: s.users.lastName,
      })
      .from(s.sessionLogs)
      .innerJoin(s.events, eq(s.events.id, s.sessionLogs.eventId))
      .innerJoin(s.users, eq(s.users.id, s.sessionLogs.instructorId))
      .where(and(eq(s.sessionLogs.studentId, v.user.id), eq(s.events.orgId, v.org.id)))
      .orderBy(desc(s.sessionLogs.createdAt))
      .limit(40),

    // Approved promotions only: recommendations still under review stay with the administrators.
    db
      .select({
        id: s.promotions.id,
        kind: s.promotions.kind,
        fromGroupId: s.promotions.fromGroupId,
        toGroupId: s.promotions.toGroupId,
        decidedAt: s.promotions.decidedAt,
        eventName: s.events.name,
        recommenderFirst: s.users.firstName,
        recommenderLast: s.users.lastName,
      })
      .from(s.promotions)
      .leftJoin(s.events, eq(s.events.id, s.promotions.eventId))
      .leftJoin(s.users, eq(s.users.id, s.promotions.recommendedById))
      .where(and(eq(s.promotions.userId, v.user.id), eq(s.promotions.orgId, v.org.id), eq(s.promotions.status, "approved")))
      .orderBy(desc(s.promotions.decidedAt)),
  ]);

  return { vehicle: vehicles[0] ?? null, history, feedback: feedback.filter((f) => f.sharedNotes.trim()), promotions };
}
