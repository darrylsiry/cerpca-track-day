"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import { instructorNeed } from "@/lib/instruction";
import type { ActionResult } from "@/lib/types";
import { requireAdmin, type Viewer } from "@/server/auth";
import { notifyUsers } from "@/server/notify";
import { asFailure, bool, fail, ok, str } from "@/server/util";

/**
 * Make an approved promotion real: the driver's standing classification, and optionally this event's registration.
 * Returns true when the driver now drives solo at this event but is still paired with an instructor.
 * The pairing is left alone (the instructor often stays their contact for the weekend); the administrator is told.
 */
async function applyPromotion(
  v: Viewer,
  p: { userId: string; kind: string; toGroupId: string | null },
  applyNow: boolean,
): Promise<boolean> {
  const db = await getDb();
  const member = and(
    eq(s.memberships.orgId, v.org.id),
    eq(s.memberships.userId, p.userId),
  );
  if (p.kind === "solo")
    await db.update(s.memberships).set({ soloApproved: true }).where(member);
  else if (p.toGroupId)
    await db
      .update(s.memberships)
      .set({ runGroupId: p.toGroupId })
      .where(member);
  if (applyNow && v.event) {
    const reg = and(
      eq(s.registrations.eventId, v.event.id),
      eq(s.registrations.userId, p.userId),
    );
    if (p.kind === "solo")
      await db.update(s.registrations).set({ solo: true }).where(reg);
    else if (p.toGroupId)
      await db
        .update(s.registrations)
        .set({ runGroupId: p.toGroupId })
        .where(reg);
    const [now] = await db.select().from(s.registrations).where(reg).limit(1);
    const policy = v.groups.find(
      (g) => g.id === now?.runGroupId,
    )?.instructorPolicy;
    if (now && instructorNeed(policy, now) === null) {
      const [paired] = await db
        .select({ id: s.instructorAssignments.id })
        .from(s.instructorAssignments)
        .where(
          and(
            eq(s.instructorAssignments.eventId, v.event.id),
            eq(s.instructorAssignments.studentId, p.userId),
          ),
        )
        .limit(1);
      return Boolean(paired);
    }
  }
  return false;
}

const STILL_PAIRED =
  " They are still paired with an instructor: end it under Instructor pairing if they will drive alone.";

export async function decidePromotion(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const db = await getDb();
    const approve = str(fd, "decision") === "approve";
    const note = str(fd, "note");
    if (!approve && note.length < 5)
      return fail(
        "Say why, so the instructor and the driver's file have the reason.",
      );
    const [p] = await db
      .select()
      .from(s.promotions)
      .where(
        and(
          eq(s.promotions.id, str(fd, "id")),
          eq(s.promotions.orgId, v.org.id),
        ),
      )
      .limit(1);
    if (!p) return fail("That recommendation no longer exists.");
    if (p.status !== "proposed")
      return fail("This recommendation has already been decided.");

    await db
      .update(s.promotions)
      .set({
        status: approve ? "approved" : "declined",
        decidedById: v.user.id,
        decidedAt: new Date(),
        decisionNote: note || null,
      })
      .where(eq(s.promotions.id, p.id));
    const applyNow = bool(fd, "applyNow");
    const stillPaired = approve ? await applyPromotion(v, p, applyNow) : false;

    const to =
      v.groups.find((g) => g.id === p.toGroupId)?.name ?? "the next run group";
    const what = p.kind === "solo" ? "solo sign-off" : `promotion to ${to}`;
    if (approve) {
      await notifyUsers({
        userIds: [p.userId],
        title:
          p.kind === "solo"
            ? "You are signed off to drive solo"
            : `You have been promoted to ${to}`,
        body: `${applyNow ? "This takes effect now: check your schedule for your sessions." : "This takes effect from your next event."}${note ? ` Note from ${v.user.firstName}: ${note}` : ""}`,
        href: applyNow ? "/schedule" : "/me",
        kind: "promotion",
        eventId: p.eventId,
        channels: ["inapp", "push", "email"],
      });
    }
    if (p.recommendedById && p.recommendedById !== v.user.id) {
      await notifyUsers({
        userIds: [p.recommendedById],
        title: `${approve ? "Approved" : "Declined"}: your recommendation for ${what}`,
        body:
          note ||
          (approve
            ? "Signed off as recommended."
            : "See the driver's file for details."),
        href: `/instructor/${p.userId}`,
        kind: "promotion",
        eventId: p.eventId,
        channels: ["inapp", "push"],
      });
    }
    refresh();
    return ok(
      approve
        ? `Approved and recorded.${stillPaired ? STILL_PAIRED : ""}`
        : "Declined and recorded",
    );
  } catch (err) {
    return asFailure(err);
  }
}

/** An administrator promoting someone directly: the sign-off and the record in one step. */
export async function promoteDirect(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const db = await getDb();
    const userId = str(fd, "userId");
    const kind = str(fd, "kind") === "solo" ? "solo" : "group";
    const rationale = str(fd, "rationale");
    if (!userId) return fail("Choose a driver.");
    if (rationale.length < 20)
      return fail(
        "Record the reason for this change (at least 20 characters).",
      );
    const [member] = await db
      .select()
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.orgId, v.org.id),
          eq(s.memberships.userId, userId),
        ),
      )
      .limit(1);
    if (!member) return fail("That person is not a member of this region.");
    const toGroupId =
      kind === "solo" ? member.runGroupId : str(fd, "toGroupId");
    if (kind === "group" && (!toGroupId || toGroupId === member.runGroupId))
      return fail("Choose a different run group to move this driver to.");
    if (kind === "solo" && member.soloApproved)
      return fail("This driver is already signed off solo.");
    const applyNow = bool(fd, "applyNow");
    await db.insert(s.promotions).values({
      orgId: v.org.id,
      eventId: v.event?.id ?? null,
      userId,
      kind,
      fromGroupId: member.runGroupId,
      toGroupId,
      recommendedById: v.user.id,
      rationale,
      status: "approved",
      decidedById: v.user.id,
      decidedAt: new Date(),
    });
    const stillPaired = await applyPromotion(
      v,
      { userId, kind, toGroupId },
      applyNow,
    );
    const to = v.groups.find((g) => g.id === toGroupId)?.name ?? "";
    await notifyUsers({
      userIds: [userId],
      title:
        kind === "solo"
          ? "You are signed off to drive solo"
          : `Your run group is now ${to}`,
      body: applyNow
        ? "This takes effect now: check your schedule for your sessions."
        : "This takes effect from your next event.",
      href: applyNow ? "/schedule" : "/me",
      kind: "promotion",
      eventId: v.event?.id ?? null,
      channels: ["inapp", "push", "email"],
    });
    refresh();
    return ok(`Recorded.${stillPaired ? STILL_PAIRED : ""}`);
  } catch (err) {
    return asFailure(err);
  }
}
