"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { getDb, schema as s } from "@/db";
import { addDays, daysBetween } from "@/lib/time";
import type { ActionResult } from "@/lib/types";
import { EVENT_COOKIE, requireAdmin } from "@/server/auth";
import { asFailure, fail, ok, str } from "@/server/util";

const dateOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const slugify = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export async function saveEvent(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const db = await getDb();
    const id = str(fd, "id");
    const name = str(fd, "name");
    const startDate = str(fd, "startDate");
    const endDate = str(fd, "endDate") || startDate;
    if (name.length < 3) return fail("Give the event a name.");
    if (!dateOk(startDate) || !dateOk(endDate))
      return fail("Enter the event dates.");
    if (endDate < startDate)
      return fail("The last day cannot be before the first day.");
    if (daysBetween(startDate, endDate) > 6)
      return fail("Events can run for up to a week.");
    const status = ["draft", "published", "completed"].includes(
      str(fd, "status"),
    )
      ? str(fd, "status")
      : "draft";
    const base = {
      name,
      startDate,
      endDate,
      status,
      description: str(fd, "description") || null,
      registrationUrl: str(fd, "registrationUrl") || null,
    };

    if (id) {
      const [before] = await db
        .select()
        .from(s.events)
        .where(and(eq(s.events.id, id), eq(s.events.orgId, v.org.id)))
        .limit(1);
      if (!before) return fail("That event no longer exists.");
      await db.update(s.events).set(base).where(eq(s.events.id, id));
      // Moving the dates carries the schedule with it.
      const shift = daysBetween(before.startDate, startDate);
      if (shift !== 0) {
        const items = await db
          .select()
          .from(s.scheduleItems)
          .where(eq(s.scheduleItems.eventId, id));
        for (const i of items)
          await db
            .update(s.scheduleItems)
            .set({ day: addDays(i.day, shift) })
            .where(eq(s.scheduleItems.id, i.id));
      }
      refresh();
      return ok("Event saved");
    }

    const trackId = str(fd, "trackId");
    const [track] = await db
      .select()
      .from(s.tracks)
      .where(eq(s.tracks.id, trackId))
      .limit(1);
    if (!track) return fail("Choose the track.");
    let slug = `${slugify(name)}-${startDate.slice(0, 4)}`;
    const taken = await db
      .select({ slug: s.events.slug })
      .from(s.events)
      .where(eq(s.events.orgId, v.org.id));
    if (taken.some((t) => t.slug === slug))
      slug = `${slug}-${startDate.slice(5).replace("-", "")}`;
    const [event] = await db
      .insert(s.events)
      .values({ orgId: v.org.id, trackId, slug, ...base })
      .returning();

    const copyFrom = str(fd, "copyFromEventId");
    if (copyFrom) {
      const [source] = await db
        .select()
        .from(s.events)
        .where(and(eq(s.events.id, copyFrom), eq(s.events.orgId, v.org.id)))
        .limit(1);
      if (source) {
        const span = daysBetween(startDate, endDate);
        const items = await db
          .select()
          .from(s.scheduleItems)
          .where(eq(s.scheduleItems.eventId, source.id));
        const rows = items
          .map((i) => ({ i, offset: daysBetween(source.startDate, i.day) }))
          .filter((x) => x.offset >= 0 && x.offset <= span)
          .map(({ i, offset }) => ({
            eventId: event.id,
            day: addDays(startDate, offset),
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
      }
    }
    // Put the new event in focus so the administrator can start building it.
    (await cookies()).set(EVENT_COOKIE, event.id, {
      path: "/",
      sameSite: "lax",
      maxAge: 86400 * 7,
    });
    refresh();
    return ok(`${name} created. You are now working on it.`);
  } catch (err) {
    return asFailure(err);
  }
}
