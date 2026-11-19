"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import { fullName } from "@/lib/cn";
import { clock, weekday } from "@/lib/time";
import type { ActionResult } from "@/lib/types";
import { adminUserIds } from "@/server/admin";
import { requireEvent, type Viewer } from "@/server/auth";
import { notifyUsers } from "@/server/notify";
import { asFailure, fail, ok, str, strs } from "@/server/util";

/** An instructor may act on a student only while assigned to them at this event; administrators always may. */
async function assertCanInstruct(
  v: Viewer & { event: { id: string } },
  studentId: string,
) {
  if (v.isAdmin) return;
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
  if (!a) throw new Error("This driver is not assigned to you at this event.");
}

export async function logSession(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("instructor");
    const studentId = str(fd, "studentId");
    await assertCanInstruct(v, studentId);
    const shared = str(fd, "sharedNotes");
    if (shared.length < 10)
      return fail("Write a few words for your student about this session.");
    const db = await getDb();
    const itemId = str(fd, "scheduleItemId");
    let day = v.now.day;
    let label = "Session";
    if (itemId) {
      const [item] = await db
        .select()
        .from(s.scheduleItems)
        .where(
          and(
            eq(s.scheduleItems.id, itemId),
            eq(s.scheduleItems.eventId, v.event.id),
          ),
        )
        .limit(1);
      if (!item)
        return fail("That session is no longer on the schedule. Pick another.");
      day = item.day;
      label = `${weekday(item.day)} ${clock(item.startMin).replace(/ (AM|PM)$/, "")} · ${item.title}`;
    }
    await db.insert(s.sessionLogs).values({
      eventId: v.event.id,
      instructorId: v.user.id,
      studentId,
      scheduleItemId: itemId || null,
      day,
      label,
      sharedNotes: shared,
      privateNotes: str(fd, "privateNotes") || null,
      focusAreas: strs(fd, "focus"),
    });
    await notifyUsers({
      userIds: [studentId],
      title: `${v.user.firstName} added notes from your session`,
      body: shared.length > 140 ? `${shared.slice(0, 137)}…` : shared,
      href: "/me#feedback",
      kind: "session",
      eventId: v.event.id,
      channels: ["inapp", "push"],
    });
    refresh();
    return ok("Session logged");
  } catch (err) {
    return asFailure(err);
  }
}

export async function addPrivateNote(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("instructor");
    const studentId = str(fd, "studentId");
    await assertCanInstruct(v, studentId);
    const body = str(fd, "body");
    if (body.length < 5) return fail("Write the note first.");
    const db = await getDb();
    await db
      .insert(s.driverNotes)
      .values({
        orgId: v.org.id,
        userId: studentId,
        authorId: v.user.id,
        eventId: v.event.id,
        category: "instructor",
        body,
      });
    refresh();
    return ok("Note saved for administrators");
  } catch (err) {
    return asFailure(err);
  }
}

export async function recommendPromotion(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("instructor");
    const studentId = str(fd, "studentId");
    await assertCanInstruct(v, studentId);
    const kind = str(fd, "kind") === "solo" ? "solo" : "group";
    const rationale = str(fd, "rationale");
    if (rationale.length < 40)
      return fail(
        "Explain your reasoning in a few sentences (at least 40 characters). The Chief Driving Instructor decides from what you write here.",
      );
    const db = await getDb();
    const [reg] = await db
      .select()
      .from(s.registrations)
      .where(
        and(
          eq(s.registrations.eventId, v.event.id),
          eq(s.registrations.userId, studentId),
        ),
      )
      .limit(1);
    if (!reg) return fail("This driver is not registered for the event.");
    const current = v.groups.find((g) => g.id === reg.runGroupId);
    if (!current) return fail("This driver has no run group.");

    let toGroupId = current.id;
    if (kind === "group") {
      const next = v.groups.filter(
        (g) => !g.isInstructorGroup && g.sortOrder > current.sortOrder,
      )[0];
      if (!next)
        return fail(
          `${current.name} is the highest student run group. There is nothing to promote to.`,
        );
      toGroupId = next.id;
    } else if (reg.solo) {
      return fail("This driver is already signed off to drive solo.");
    } else if (current.instructorPolicy === "required") {
      return fail(
        `${current.name} drivers always ride with an instructor. Recommend a move to the next run group instead.`,
      );
    } else if (current.instructorPolicy !== "optional") {
      return fail(
        `${current.name} drivers already drive solo, so there is no sign-off to recommend.`,
      );
    }

    const [open] = await db
      .select({ id: s.promotions.id })
      .from(s.promotions)
      .where(
        and(
          eq(s.promotions.userId, studentId),
          eq(s.promotions.status, "proposed"),
          eq(s.promotions.kind, kind),
        ),
      )
      .limit(1);
    if (open)
      return fail(
        "There is already a recommendation waiting for sign-off for this driver.",
      );

    await db.insert(s.promotions).values({
      orgId: v.org.id,
      eventId: v.event.id,
      userId: studentId,
      kind,
      fromGroupId: current.id,
      toGroupId,
      recommendedById: v.user.id,
      rationale,
    });
    const [student] = await db
      .select()
      .from(s.users)
      .where(eq(s.users.id, studentId))
      .limit(1);
    const target =
      kind === "solo"
        ? "solo sign-off"
        : `promotion to ${v.groups.find((g) => g.id === toGroupId)?.name}`;
    await notifyUsers({
      userIds: await adminUserIds(v.org.id),
      title: `Recommendation: ${student ? fullName(student) : "a driver"}, ${target}`,
      body: `${fullName(v.user)} recommends ${target}. Review the rationale and sign off.`,
      href: "/admin/promotions",
      kind: "promotion",
      eventId: v.event.id,
      channels: ["inapp", "push"],
    });
    refresh();
    return ok("Recommendation sent for sign-off");
  } catch (err) {
    return asFailure(err);
  }
}

export async function deleteSessionLog(logId: string): Promise<ActionResult> {
  try {
    const v = await requireEvent("instructor");
    const db = await getDb();
    const [log] = await db
      .select()
      .from(s.sessionLogs)
      .where(eq(s.sessionLogs.id, logId))
      .limit(1);
    if (!log) return fail("That entry is already gone.");
    if (log.instructorId !== v.user.id && !v.isAdmin)
      return fail("You can only remove entries you wrote.");
    await db.delete(s.sessionLogs).where(eq(s.sessionLogs.id, logId));
    refresh();
    return ok("Entry removed");
  } catch (err) {
    return asFailure(err);
  }
}
