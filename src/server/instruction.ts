import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import type { RunGroup } from "@/db/schema";
import { inItem } from "@/lib/schedule";
import { clock, weekdayShort, type ZonedNow } from "@/lib/time";
import type { ScheduleEntry } from "@/lib/types";
import type { Viewer } from "./auth";

export type SessionOption = { id: string; label: string; past: boolean };

/** A driver's track sessions as choices for "which session are you logging?". */
export function sessionOptions(
  schedule: ScheduleEntry[],
  driver: { groupId: string; solo: boolean },
  now: ZonedNow,
): { options: SessionOption[]; defaultId: string | null } {
  const items = schedule.filter(
    (i) =>
      i.kind === "track" &&
      !i.cancelled &&
      inItem(i, driver.groupId, driver.solo),
  );
  const options = items.map((i) => ({
    id: i.id,
    label: `${weekdayShort(i.day)} ${clock(i.startMin)} · ${i.title}`,
    past: i.day < now.day || (i.day === now.day && i.startMin <= now.minutes),
  }));
  const started = options.filter((o) => o.past);
  return {
    options,
    defaultId: started.length
      ? started[started.length - 1].id
      : (options[0]?.id ?? null),
  };
}

export function nextSession(
  schedule: ScheduleEntry[],
  driver: { groupId: string; solo: boolean },
  now: ZonedNow,
): ScheduleEntry | null {
  return (
    schedule.find(
      (i) =>
        i.kind === "track" &&
        !i.cancelled &&
        inItem(i, driver.groupId, driver.solo) &&
        (i.day > now.day || (i.day === now.day && i.endMin > now.minutes)),
    ) ?? null
  );
}

/** The next student run group above this one, if any. */
export function nextGroup(
  groups: RunGroup[],
  current: RunGroup | undefined,
): RunGroup | null {
  if (!current) return null;
  return (
    groups.filter(
      (g) => !g.isInstructorGroup && g.sortOrder > current.sortOrder,
    )[0] ?? null
  );
}

export async function isAssigned(
  v: Viewer,
  studentId: string,
): Promise<boolean> {
  if (!v.event) return false;
  const db = await getDb();
  const [a] = await db
    .select({ id: s.instructorAssignments.id })
    .from(s.instructorAssignments)
    .where(
      and(
        eq(s.instructorAssignments.eventId, v.event.id),
        eq(s.instructorAssignments.instructorId, v.user.id),
        eq(s.instructorAssignments.studentId, studentId),
      ),
    )
    .limit(1);
  return Boolean(a);
}

export async function logsForStudents(studentIds: string[]) {
  if (!studentIds.length) return [];
  const db = await getDb();
  return db
    .select()
    .from(s.sessionLogs)
    .where(inArray(s.sessionLogs.studentId, studentIds))
    .orderBy(desc(s.sessionLogs.createdAt));
}

export async function openPromotions(studentIds: string[]) {
  if (!studentIds.length) return [];
  const db = await getDb();
  return db
    .select()
    .from(s.promotions)
    .where(
      and(
        inArray(s.promotions.userId, studentIds),
        eq(s.promotions.status, "proposed"),
      ),
    );
}
