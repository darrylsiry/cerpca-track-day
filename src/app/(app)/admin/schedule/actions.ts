"use server";

import { and, eq, gte } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import {
  clock,
  daysBetween,
  addDays,
  fromTimeInput,
  weekday,
} from "@/lib/time";
import { partName } from "@/lib/schedule";
import type {
  ActionResult,
  AnnouncementAudience,
  GroupPart,
} from "@/lib/types";
import { audienceUserIds, bumpSchedule } from "@/server/admin";
import { requireEvent, type Viewer } from "@/server/auth";
import { notifyUsers } from "@/server/notify";
import { eventDays } from "@/server/queries";
import { asFailure, bool, fail, ok, str, strs } from "@/server/util";

type EventViewer = Viewer & { event: NonNullable<Viewer["event"]> };

function audienceOf(item: {
  audience: string;
  groupIds: string[];
  groupParts?: Record<string, GroupPart> | null;
}): AnnouncementAudience | null {
  if (item.audience === "all") return { kind: "all" };
  if (item.audience === "instructors") return { kind: "instructors" };
  if (item.audience === "groups" && item.groupIds.length)
    return {
      kind: "groups",
      groupIds: item.groupIds,
      groupParts: item.groupParts ?? {},
    };
  return null;
}

/** Record a schedule change as an announcement and push it to the people it affects. */
async function announceChange(
  v: EventViewer,
  audience: AnnouncementAudience,
  title: string,
  body: string,
) {
  const db = await getDb();
  const userIds = await audienceUserIds(v.event.id, v.org.id, audience);
  const [row] = await db
    .insert(s.announcements)
    .values({
      orgId: v.org.id,
      eventId: v.event.id,
      title,
      body,
      audience,
      channels: ["inapp", "push"],
      urgent: true,
      authorId: v.user.id,
      recipientCount: userIds.length,
    })
    .returning();
  await notifyUsers({
    userIds,
    title,
    body,
    href: "/schedule",
    kind: "announcement",
    eventId: v.event.id,
    announcementId: row.id,
    urgent: true,
    channels: ["inapp", "push"],
  });
}

export async function saveItem(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const id = str(fd, "id");
    const day = str(fd, "day");
    if (!eventDays(v.event).includes(day))
      return fail("Pick one of the event's days.");
    const startMin = fromTimeInput(str(fd, "start"));
    const endMin = fromTimeInput(str(fd, "end"));
    if (startMin === null || endMin === null)
      return fail("Enter a start and an end time.");
    if (endMin <= startMin)
      return fail("The end time has to be after the start time.");
    const kind = str(fd, "kind") || "track";
    const audience = str(fd, "audience") || "groups";
    const groupIds =
      audience === "groups"
        ? strs(fd, "groupIds").filter((g) => v.groups.some((x) => x.id === g))
        : [];
    if (audience === "groups" && !groupIds.length)
      return fail("Choose at least one run group, or change who this is for.");
    // Only a group that is instructed until solo has two halves to choose between.
    const groupParts: Record<string, GroupPart> = {};
    for (const g of groupIds) {
      const part = str(fd, `part:${g}`);
      const splittable =
        v.groups.find((x) => x.id === g)?.instructorPolicy === "optional";
      if (splittable && (part === "instructed" || part === "solo"))
        groupParts[g] = part;
    }
    let title = str(fd, "title");
    if (!title)
      title = groupIds
        .map((g) => {
          const name = v.groups.find((x) => x.id === g)?.name;
          return name ? partName(name, groupParts[g]) : null;
        })
        .filter(Boolean)
        .join(" and ");
    if (!title) return fail("Give the item a title.");

    const values = {
      day,
      startMin,
      endMin,
      kind,
      title,
      location: str(fd, "location") || null,
      audience,
      groupIds,
      groupParts,
      note: str(fd, "note") || null,
      updatedAt: new Date(),
    };
    const db = await getDb();
    let changed = "";
    if (id) {
      const [before] = await db
        .select()
        .from(s.scheduleItems)
        .where(
          and(
            eq(s.scheduleItems.id, id),
            eq(s.scheduleItems.eventId, v.event.id),
          ),
        )
        .limit(1);
      if (!before) return fail("That item was removed by someone else.");
      await db
        .update(s.scheduleItems)
        .set(values)
        .where(eq(s.scheduleItems.id, id));
      if (before.startMin !== startMin || before.day !== day)
        changed = `${title} moves from ${clock(before.startMin)} to ${weekday(day)} ${clock(startMin)}.`;
      else if (before.endMin !== endMin)
        changed = `${title} at ${clock(startMin)} now ends at ${clock(endMin)}.`;
      else
        changed = `${title} at ${clock(startMin)} was updated. Check the schedule for details.`;
    } else {
      await db
        .insert(s.scheduleItems)
        .values({ eventId: v.event.id, ...values });
      changed = `Added: ${title}, ${weekday(day)} ${clock(startMin)} to ${clock(endMin)}.`;
    }
    await bumpSchedule(v.event.id);
    const audienceForNotice = audienceOf({ audience, groupIds, groupParts });
    if (bool(fd, "notify") && audienceForNotice)
      await announceChange(v, audienceForNotice, "Schedule change", changed);
    refresh();
    return ok(id ? "Schedule updated" : "Added to the schedule");
  } catch (err) {
    return asFailure(err);
  }
}

export async function setCancelled(
  id: string,
  cancelled: boolean,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const db = await getDb();
    const [item] = await db
      .select()
      .from(s.scheduleItems)
      .where(
        and(
          eq(s.scheduleItems.id, id),
          eq(s.scheduleItems.eventId, v.event.id),
        ),
      )
      .limit(1);
    if (!item) return fail("That item no longer exists.");
    await db
      .update(s.scheduleItems)
      .set({ cancelled, updatedAt: new Date() })
      .where(eq(s.scheduleItems.id, id));
    await bumpSchedule(v.event.id);
    const audience = audienceOf(item);
    // Cancelling (or restoring) a session always tells the people in it.
    if (audience) {
      await announceChange(
        v,
        audience,
        cancelled
          ? `Cancelled: ${item.title}, ${clock(item.startMin)}`
          : `Back on: ${item.title}, ${clock(item.startMin)}`,
        cancelled
          ? `${weekday(item.day)}'s ${clock(item.startMin)} ${item.title} session will not run.`
          : `${weekday(item.day)}'s ${clock(item.startMin)} ${item.title} session is back on the schedule.`,
      );
    }
    refresh();
    return ok(cancelled ? "Cancelled and announced" : "Restored and announced");
  } catch (err) {
    return asFailure(err);
  }
}

export async function deleteItem(id: string): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const db = await getDb();
    await db
      .delete(s.scheduleItems)
      .where(
        and(
          eq(s.scheduleItems.id, id),
          eq(s.scheduleItems.eventId, v.event.id),
        ),
      );
    await bumpSchedule(v.event.id);
    refresh();
    return ok("Removed from the schedule");
  } catch (err) {
    return asFailure(err);
  }
}

/** Weather hold, late start, oil-down: slide everything from a given time by N minutes. */
export async function shiftSchedule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const day = str(fd, "day");
    const from = fromTimeInput(str(fd, "from"));
    const minutes =
      Math.trunc(Number(str(fd, "minutes"))) *
      (str(fd, "direction") === "earlier" ? -1 : 1);
    if (!eventDays(v.event).includes(day) || from === null)
      return fail("Pick the day and the time the change starts from.");
    if (!minutes || Math.abs(minutes) > 240)
      return fail("Enter how many minutes to move things by (1 to 240).");
    const db = await getDb();
    const items = await db
      .select()
      .from(s.scheduleItems)
      .where(
        and(
          eq(s.scheduleItems.eventId, v.event.id),
          eq(s.scheduleItems.day, day),
          gte(s.scheduleItems.startMin, from),
        ),
      );
    if (!items.length)
      return fail("Nothing is scheduled at or after that time.");
    if (
      items.some(
        (i) => i.startMin + minutes < 0 || i.endMin + minutes > 24 * 60 - 1,
      )
    )
      return fail(
        "That would push something past midnight. Use a smaller number.",
      );
    for (const i of items) {
      await db
        .update(s.scheduleItems)
        .set({
          startMin: i.startMin + minutes,
          endMin: i.endMin + minutes,
          updatedAt: new Date(),
        })
        .where(eq(s.scheduleItems.id, i.id));
    }
    await bumpSchedule(v.event.id);
    if (bool(fd, "notify")) {
      const reason = str(fd, "reason");
      await announceChange(
        v,
        { kind: "all" },
        `Schedule running ${Math.abs(minutes)} minutes ${minutes > 0 ? "later" : "earlier"}`,
        `Everything from ${clock(from)} on ${weekday(day)} moves ${Math.abs(minutes)} minutes ${minutes > 0 ? "later" : "earlier"}.${reason ? ` ${reason}` : ""} Your times in the app are already updated.`,
      );
    }
    refresh();
    return ok(
      `${items.length} items moved ${Math.abs(minutes)} minutes ${minutes > 0 ? "later" : "earlier"}`,
    );
  } catch (err) {
    return asFailure(err);
  }
}

export async function copySchedule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const db = await getDb();
    const [source] = await db
      .select()
      .from(s.events)
      .where(
        and(
          eq(s.events.id, str(fd, "fromEventId")),
          eq(s.events.orgId, v.org.id),
        ),
      )
      .limit(1);
    if (!source) return fail("Choose the event to copy from.");
    const existing = await db
      .select({ id: s.scheduleItems.id })
      .from(s.scheduleItems)
      .where(eq(s.scheduleItems.eventId, v.event.id));
    if (existing.length && !bool(fd, "replace"))
      return fail(
        "This event already has a schedule. Tick “Replace the current schedule” to overwrite it.",
      );
    const items = await db
      .select()
      .from(s.scheduleItems)
      .where(eq(s.scheduleItems.eventId, source.id));
    if (!items.length) return fail(`${source.name} has no schedule to copy.`);
    if (existing.length)
      await db
        .delete(s.scheduleItems)
        .where(eq(s.scheduleItems.eventId, v.event.id));
    const days = eventDays(v.event);
    const rows = items
      .map((i) => ({ i, offset: daysBetween(source.startDate, i.day) }))
      .filter((x) => x.offset >= 0 && x.offset < days.length)
      .map(({ i, offset }) => ({
        eventId: v.event.id,
        day: addDays(v.event.startDate, offset),
        startMin: i.startMin,
        endMin: i.endMin,
        kind: i.kind,
        title: i.title,
        location: i.location,
        audience: i.audience,
        groupIds: i.groupIds,
        groupParts: i.groupParts,
        note: i.note,
      }));
    if (rows.length) await db.insert(s.scheduleItems).values(rows);
    await bumpSchedule(v.event.id);
    refresh();
    return ok(`Copied ${rows.length} items from ${source.name}`);
  } catch (err) {
    return asFailure(err);
  }
}
