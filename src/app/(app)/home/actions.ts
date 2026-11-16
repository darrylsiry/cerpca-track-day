"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import { fullName } from "@/lib/cn";
import { canAskForInstructor } from "@/lib/instruction";
import type { ActionResult } from "@/lib/types";
import { adminUserIds } from "@/server/admin";
import { getViewer } from "@/server/auth";
import { notifyUsers } from "@/server/notify";
import { asFailure, fail, ok, str } from "@/server/util";

/** A solo driver asks for an instructor to ride along at this event. Administrators do the pairing. */
export async function requestRideAlong(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await getViewer();
    if (!v.event || !v.registration)
      return fail("You are not on the roster for this event.");
    if (v.event.status === "completed") return fail("This event is over.");
    if (!canAskForInstructor(v.group, v.registration))
      return fail(
        v.registration.instructorRequest
          ? "An instructor has already been requested for you."
          : "You already ride with an instructor at this event.",
      );
    const note = str(fd, "note").slice(0, 500);
    const db = await getDb();
    await db
      .update(s.registrations)
      .set({ instructorRequest: "ride_along", instructorRequestNote: note || null })
      .where(eq(s.registrations.id, v.registration.id));
    await notifyUsers({
      userIds: (await adminUserIds(v.org.id)).filter((id) => id !== v.user.id),
      title: `${fullName(v.user)} asked for an instructor`,
      body: note
        ? `${v.group?.name ?? "Solo"} driver, ride-along request: “${note}”`
        : `${v.group?.name ?? "Solo"} driver asking for an instructor to ride along.`,
      href: "/admin/instructors",
      kind: "assignment",
      eventId: v.event.id,
      channels: ["inapp", "push"],
    });
    refresh();
    return ok("Request sent. You will get an alert when an instructor is assigned.");
  } catch (err) {
    return asFailure(err);
  }
}

/** Take back a ride-along request. A check-in set by administrators is theirs to remove. */
export async function withdrawRideAlong(): Promise<ActionResult> {
  try {
    const v = await getViewer();
    if (!v.event || !v.registration)
      return fail("You are not on the roster for this event.");
    if (v.registration.instructorRequest !== "ride_along")
      return fail("There is no ride-along request to withdraw.");
    const db = await getDb();
    const pairing = and(
      eq(s.instructorAssignments.eventId, v.event.id),
      eq(s.instructorAssignments.studentId, v.user.id),
    );
    const [paired] = await db.select().from(s.instructorAssignments).where(pairing).limit(1);
    await db
      .update(s.registrations)
      .set({ instructorRequest: null, instructorRequestNote: null })
      .where(eq(s.registrations.id, v.registration.id));
    if (paired) {
      await db.delete(s.instructorAssignments).where(pairing);
      await notifyUsers({
        userIds: [paired.instructorId],
        title: `${fullName(v.user)} no longer needs a ride-along`,
        body: "They withdrew their request, so they are off your student list.",
        href: "/instructor",
        kind: "assignment",
        eventId: v.event.id,
        channels: ["inapp", "push"],
      });
    }
    refresh();
    return ok("Request withdrawn");
  } catch (err) {
    return asFailure(err);
  }
}
