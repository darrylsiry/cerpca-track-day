import { and, eq, inArray, lte, gte, ne } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import { inItem } from "@/lib/schedule";
import { clock, eachDay, zoned } from "@/lib/time";
import type { Channel } from "@/lib/types";
import { notifyUsers } from "./notify";

/*
 * Session reminders: "your run group is on track in 15 / 10 / 5 minutes".
 *
 * Runs once a minute (Vercel Cron in production, a timer in `next dev`). For
 * each published event happening today at its track, it finds the schedule
 * items that have just entered a reminder window and alerts the people in them.
 * `reminder_sends` makes each (item, lead time, day, start time) fire exactly
 * once, and a session moved to another day or time reminds again.
 */
export async function runReminders(
  now = new Date(),
): Promise<{ events: number; reminders: number; recipients: number }> {
  const db = await getDb();
  let reminders = 0;
  let recipients = 0;

  const rows = await db
    .select({ event: s.events, org: s.organizations, track: s.tracks })
    .from(s.events)
    .innerJoin(s.organizations, eq(s.organizations.id, s.events.orgId))
    .innerJoin(s.tracks, eq(s.tracks.id, s.events.trackId))
    .where(eq(s.events.status, "published"));

  let live = 0;
  for (const { event, org, track } of rows) {
    const local = zoned(now, track.timezone);
    const days = eachDay(event.startDate, event.endDate);
    const dayIndex = days.indexOf(local.day);
    if (dayIndex === -1) continue;
    live += 1;
    const offsets = [...(org.settings.reminderOffsets ?? [15, 10, 5])].sort(
      (a, b) => a - b,
    );
    const horizon = offsets[offsets.length - 1];

    const items = await db
      .select()
      .from(s.scheduleItems)
      .where(
        and(
          eq(s.scheduleItems.eventId, event.id),
          eq(s.scheduleItems.day, local.day),
          eq(s.scheduleItems.cancelled, false),
          ne(s.scheduleItems.audience, "none"),
          gte(s.scheduleItems.startMin, local.minutes + 1),
          lte(s.scheduleItems.startMin, local.minutes + horizon),
        ),
      );
    if (!items.length) continue;

    const regs = (
      await db
        .select()
        .from(s.registrations)
        .where(
          and(
            eq(s.registrations.eventId, event.id),
            eq(s.registrations.status, "confirmed"),
          ),
        )
    ).filter((r) =>
      dayIndex === 0 ? r.attendsDay1 : dayIndex === 1 ? r.attendsDay2 : true,
    );
    const assignments = await db
      .select()
      .from(s.instructorAssignments)
      .where(eq(s.instructorAssignments.eventId, event.id));

    for (const item of items) {
      const minutesUntil = item.startMin - local.minutes;
      // The window we are in: the smallest lead time that still covers "now".
      const offset = offsets.find((o) => minutesUntil <= o);
      if (!offset) continue;
      const claimed = await db
        .insert(s.reminderSends)
        .values({
          scheduleItemId: item.id,
          offsetMin: offset,
          day: item.day,
          startMin: item.startMin,
        })
        .onConflictDoNothing()
        .returning({ id: s.reminderSends.id });
      if (!claimed.length) continue; // already sent for this window

      const drivers =
        item.audience === "all"
          ? regs
          : item.audience === "instructors"
            ? regs.filter((r) => r.isInstructor)
            : regs.filter((r) =>
                inItem(
                  { groupIds: item.groupIds, groupParts: item.groupParts ?? {} },
                  r.runGroupId,
                  r.solo,
                ),
              );
      const driverIds = drivers.map((r) => r.userId);
      const studentSet = new Set(driverIds);
      const instructorIds =
        item.kind === "track" && item.audience === "groups"
          ? [
              ...new Set(
                assignments
                  .filter((a) => studentSet.has(a.studentId))
                  .map((a) => a.instructorId),
              ),
            ].filter(
              (id) =>
                !studentSet.has(id) &&
                regs.some((r) => r.userId === id && r.isInstructor),
            )
          : [];

      const href = `/schedule?day=${item.day}#${item.id}`;
      const all = [...driverIds, ...instructorIds];
      // Keep the inbox to one live reminder per session: the newer one replaces the older.
      if (all.length)
        await db
          .delete(s.notifications)
          .where(
            and(
              eq(s.notifications.kind, "reminder"),
              eq(s.notifications.href, href),
              inArray(s.notifications.userId, all),
            ),
          );

      const at = clock(item.startMin);
      const where =
        item.location ?? (item.kind === "track" ? "the grid" : null);
      const channels: Channel[] = ["inapp", "push", "sms"];
      const base = {
        href,
        kind: "reminder",
        eventId: event.id,
        channels,
        urgent: minutesUntil <= 5,
      };
      if (driverIds.length) {
        const res = await notifyUsers({
          ...base,
          userIds: driverIds,
          title:
            item.kind === "track"
              ? `${item.title}: on track in ${minutesUntil} min`
              : `${item.title} in ${minutesUntil} min`,
          body:
            item.kind === "track"
              ? minutesUntil <= 5
                ? `You go out at ${at}. Be on the grid now.`
                : `You go out at ${at}. Get your car to the grid.`
              : `Starts at ${at}${where ? ` at ${where}` : ""}.`,
        });
        recipients += res.recipients;
      }
      if (instructorIds.length) {
        const res = await notifyUsers({
          ...base,
          userIds: instructorIds,
          title: `Your student is on track in ${minutesUntil} min`,
          body: `${item.title} goes out at ${at}. Meet your student at the grid.`,
        });
        recipients += res.recipients;
      }
      await db
        .update(s.reminderSends)
        .set({ recipients: all.length })
        .where(eq(s.reminderSends.id, claimed[0].id));
      reminders += 1;
    }
  }
  return { events: live, reminders, recipients };
}
