"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import type { TechInspection } from "@/db/schema";
import { waiverCount } from "@/lib/clearance";
import { fullName } from "@/lib/cn";
import { emptyTechForm, GRID_TECH_ITEMS } from "@/lib/tech-form";
import { monthDay } from "@/lib/time";
import type { ActionResult } from "@/lib/types";
import { requireAdmin, requireEvent } from "@/server/auth";
import { clearanceFor } from "@/server/clearance";
import { notifyUsers } from "@/server/notify";
import { getRoster } from "@/server/queries";
import {
  getInspection,
  inspectionWindow,
  listInspections,
  nextStickerNumber,
} from "@/server/tech";
import { asFailure, bool, fail, ok, str } from "@/server/util";

/** Load a tech form and make sure it belongs to this administrator's region. */
async function adminInspection(id: string) {
  const v = await requireAdmin();
  const db = await getDb();
  const [row] = await db
    .select({ insp: s.techInspections, event: s.events })
    .from(s.techInspections)
    .innerJoin(s.events, eq(s.events.id, s.techInspections.eventId))
    .where(and(eq(s.techInspections.id, id), eq(s.events.orgId, v.org.id)))
    .limit(1);
  if (!row) throw new Error("That tech form could not be found.");
  return { v, db, insp: row.insp, event: row.event };
}

/* ───────────── Review ───────────── */

export async function approveInspection(id: string): Promise<ActionResult> {
  try {
    const { v, db, insp, event } = await adminInspection(id);
    if (insp.status !== "submitted" && insp.status !== "changes_requested")
      return fail("Only a submitted form can be approved.");
    const now = new Date();
    await db
      .update(s.techInspections)
      .set({
        status: "approved",
        reviewedById: v.user.id,
        reviewedAt: now,
        reviewNote: null,
        updatedAt: now,
      })
      .where(eq(s.techInspections.id, id));
    await notifyUsers({
      userIds: [insp.userId],
      title: "Your tech form is approved",
      body: "Your shop inspection paperwork is done. At the track, bring the car to the tech shed with your helmet and your numbers on to get your sticker.",
      href: "/me/tech",
      kind: "tech",
      eventId: event.id,
      channels: ["inapp", "push"],
    });
    refresh();
    return ok("Approved. The driver has been told");
  } catch (err) {
    return asFailure(err);
  }
}

export async function requestChanges(
  id: string,
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const { v, db, insp, event } = await adminInspection(id);
    if (!["submitted", "approved", "changes_requested"].includes(insp.status))
      return fail(
        "This form has not been submitted yet, so there is nothing to send back.",
      );
    if (insp.stickerIssuedAt)
      return fail(
        "This car already has a sticker. Revoke the sticker in grid tech before sending the form back.",
      );
    const note = str(fd, "note");
    if (note.length < 10)
      return fail("Say what needs to change, so the driver knows what to fix.");
    const now = new Date();
    await db
      .update(s.techInspections)
      .set({
        status: "changes_requested",
        reviewedById: v.user.id,
        reviewedAt: now,
        reviewNote: note.slice(0, 2000),
        updatedAt: now,
      })
      .where(eq(s.techInspections.id, id));
    await notifyUsers({
      userIds: [insp.userId],
      title: "Your tech form needs changes",
      body: note.slice(0, 600),
      href: "/me/tech",
      kind: "tech",
      eventId: event.id,
      urgent: true,
      channels: ["inapp", "email", "push"],
    });
    refresh();
    return ok("Sent back to the driver");
  } catch (err) {
    return asFailure(err);
  }
}

/* ───────────── Reminders ───────────── */

const WAITING = ["none", "draft", "with_shop", "shop_signed"];

function reminderText(
  status: string,
  eventName: string,
  shopName: string | null,
  windowText: string,
) {
  if (status === "with_shop") {
    return `Your shop${shopName ? ` (${shopName})` : ""} has not completed your tech form for ${eventName} yet. Check with them, or send a new link from Tech inspection.`;
  }
  if (status === "shop_signed")
    return `Your shop has done its part for ${eventName}. Open Tech inspection, review the form and sign to submit it.`;
  return `Your shop inspection for ${eventName} has not been submitted. Open Tech inspection to send the form to your shop or upload the paper form. The inspection window is ${windowText}.`;
}

async function sendReminders(userIds: string[]): Promise<number> {
  const v = await requireEvent("admin");
  const [roster, inspections] = await Promise.all([
    getRoster(v.event.id),
    listInspections(v.event.id),
  ]);
  const byUser = new Map(inspections.map((i) => [i.userId, i]));
  const win = inspectionWindow(v.event, v.org);
  const windowText = `${monthDay(win.earliest)} to ${monthDay(win.latest)}`;
  const targets = roster
    .filter((r) => userIds.includes(r.user.id))
    .filter((r) => WAITING.includes(byUser.get(r.user.id)?.status ?? "none"));

  // One message per situation, so each driver is told the thing they actually need to do.
  const groups = new Map<string, string[]>();
  for (const r of targets) {
    const insp = byUser.get(r.user.id);
    const text = reminderText(
      insp?.status ?? "none",
      v.event.name,
      insp?.shopName ?? null,
      windowText,
    );
    groups.set(text, [...(groups.get(text) ?? []), r.user.id]);
  }
  for (const [body, ids] of groups) {
    await notifyUsers({
      userIds: ids,
      title: "Tech inspection: action needed",
      body,
      href: "/me/tech",
      kind: "tech",
      eventId: v.event.id,
      channels: ["inapp", "email", "push"],
    });
  }
  return targets.length;
}

export async function remindDriver(userId: string): Promise<ActionResult> {
  try {
    const n = await sendReminders([userId]);
    return n
      ? ok("Reminder sent")
      : fail(
          "This driver's form is already submitted, so no reminder was sent.",
        );
  } catch (err) {
    return asFailure(err);
  }
}

export async function remindAllWaiting(): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const roster = await getRoster(v.event.id);
    const n = await sendReminders(roster.map((r) => r.user.id));
    return n
      ? ok(`Reminder sent to ${n} driver${n === 1 ? "" : "s"}`)
      : fail("Nobody is waiting, so no reminders were sent.");
  } catch (err) {
    return asFailure(err);
  }
}

/* ───────────── Shops ───────────── */

export async function saveShop(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const id = str(fd, "id");
    const name = str(fd, "name");
    const email = str(fd, "email").toLowerCase();
    if (!name) return fail("Enter the shop's name.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return fail("That email address does not look right.");
    const verified = bool(fd, "verified");
    if (verified && !email)
      return fail(
        "A verified shop needs an email address: that is where its inspection links are sent.",
      );
    const values = {
      name,
      contactName: str(fd, "contactName") || null,
      email: email || null,
      phone: str(fd, "phone") || null,
      city: str(fd, "city") || null,
      notes: str(fd, "notes") || null,
      verified,
    };
    const db = await getDb();
    if (id) {
      const updated = await db
        .update(s.shops)
        .set(values)
        .where(and(eq(s.shops.id, id), eq(s.shops.orgId, v.org.id)))
        .returning({ id: s.shops.id });
      if (!updated.length) return fail("That shop could not be found.");
    } else {
      await db.insert(s.shops).values({ orgId: v.org.id, ...values });
    }
    refresh();
    return ok(id ? "Shop saved" : "Shop added");
  } catch (err) {
    return asFailure(err);
  }
}

export async function setShopVerified(
  id: string,
  verified: boolean,
): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const db = await getDb();
    const [shop] = await db
      .select()
      .from(s.shops)
      .where(and(eq(s.shops.id, id), eq(s.shops.orgId, v.org.id)))
      .limit(1);
    if (!shop) return fail("That shop could not be found.");
    if (verified && !shop.email)
      return fail("Add the shop's email address before verifying it.");
    await db.update(s.shops).set({ verified }).where(eq(s.shops.id, id));
    refresh();
    return ok(
      verified
        ? `${shop.name} is now verified`
        : `${shop.name} is no longer verified`,
    );
  } catch (err) {
    return asFailure(err);
  }
}

/* ───────────── Grid tech at the track ───────────── */

/** The driver's tech row for the event in focus, created if they never started one. */
async function gridRow(
  userId: string,
): Promise<{
  v: Awaited<ReturnType<typeof requireEvent>>;
  insp: TechInspection;
}> {
  const v = await requireEvent("admin");
  const db = await getDb();
  const existing = await getInspection(v.event.id, userId);
  if (existing) return { v, insp: existing };
  const person = (await getRoster(v.event.id)).find(
    (r) => r.user.id === userId,
  );
  if (!person)
    throw new Error("That driver is not on the roster for this event.");
  const [created] = await db
    .insert(s.techInspections)
    .values({
      eventId: v.event.id,
      userId,
      status: "draft",
      method: "online",
      form: emptyTechForm(),
      vehicleYear: person.vehicle?.year ?? null,
      vehicleMake: person.vehicle?.make ?? null,
      vehicleModel: person.vehicle?.model ?? null,
      vehicleColor: person.vehicle?.color ?? null,
      carNumber: person.reg.carNumber ?? person.vehicle?.carNumber ?? null,
      emergency1:
        [person.user.emergencyName, person.user.emergencyPhone]
          .filter(Boolean)
          .join(", ") || null,
    })
    .returning();
  return { v, insp: created };
}

/** Save the 10-point grid check, and issue the sticker when `intent` is "issue". */
export async function saveGridTech(
  userId: string,
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const { v, insp } = await gridRow(userId);
    const issue = str(fd, "intent") === "issue";
    const items = Object.fromEntries(
      GRID_TECH_ITEMS.map((g) => [g.key, bool(fd, `g_${g.key}`)]),
    );
    const notes = str(fd, "notes").slice(0, 1000);
    const now = new Date();
    const db = await getDb();
    const base = {
      gridTech: { items, notes },
      gridTechById: v.user.id,
      gridTechAt: now,
      updatedAt: now,
    };

    if (!issue) {
      await db
        .update(s.techInspections)
        .set(base)
        .where(eq(s.techInspections.id, insp.id));
      refresh();
      return ok("Checklist saved");
    }
    if (insp.stickerIssuedAt)
      return fail(`This car already has sticker ${insp.stickerNumber ?? ""}.`);
    if (insp.status !== "approved")
      return fail(
        "The shop inspection paperwork has to be approved before a sticker can be issued.",
      );
    const open = GRID_TECH_ITEMS.filter((g) => !items[g.key]);
    if (open.length)
      return fail(
        `Not checked yet: ${open.map((g) => g.label.toLowerCase()).join(", ")}.`,
      );

    const number = await nextStickerNumber(v.event);
    await db
      .update(s.techInspections)
      .set({ ...base, stickerIssuedAt: now, stickerNumber: number })
      .where(eq(s.techInspections.id, insp.id));
    // A car at grid tech is a driver at the track: check them in if nobody has yet.
    await db
      .update(s.registrations)
      .set({ checkedInAt: now })
      .where(and(eq(s.registrations.eventId, v.event.id), eq(s.registrations.userId, userId), isNull(s.registrations.checkedInAt)));
    // The sticker clears the car, not the driver: say so when waivers are still unsigned.
    const { waiversLeft } = await clearanceFor(v.org.id, v.event.id, userId);
    await notifyUsers({
      userIds: [userId],
      title: `Tech sticker ${number} issued`,
      body: waiversLeft
        ? `Your car passed grid tech. You still need to sign ${waiverCount(waiversLeft)} before you can drive. Keep the sticker on the windshield for the whole event.`
        : "Your car passed grid tech and you are cleared to go on track. Keep the sticker on the windshield for the whole event.",
      href: waiversLeft ? "/me/waivers" : "/me/tech",
      kind: "tech",
      eventId: v.event.id,
      channels: ["inapp"],
    });
    refresh();
    return ok(
      waiversLeft
        ? `Sticker ${number} issued. Not cleared yet: ${waiverCount(waiversLeft)} to sign`
        : `Sticker ${number} issued`,
    );
  } catch (err) {
    return asFailure(err);
  }
}

export async function revokeSticker(userId: string): Promise<ActionResult> {
  try {
    const { v, insp } = await gridRow(userId);
    if (!insp.stickerIssuedAt)
      return fail("This car has no sticker to revoke.");
    const db = await getDb();
    await db
      .update(s.techInspections)
      .set({
        stickerIssuedAt: null,
        stickerNumber: null,
        updatedAt: new Date(),
      })
      .where(eq(s.techInspections.id, insp.id));
    await notifyUsers({
      userIds: [userId],
      title: "Your tech sticker was withdrawn",
      body: "Your car is not cleared to go on track. See the tech team at the tech shed before your next session.",
      href: "/me/tech",
      kind: "tech",
      eventId: v.event.id,
      urgent: true,
      channels: ["inapp", "push"],
    });
    refresh();
    return ok(`Sticker ${insp.stickerNumber ?? ""} revoked`);
  } catch (err) {
    return asFailure(err);
  }
}

/** For the driver who turns up with the stamped paper form in hand: approve the paperwork on sight. */
export async function acceptPaperAtTrack(
  userId: string,
): Promise<ActionResult> {
  try {
    const { v, insp } = await gridRow(userId);
    if (insp.status === "approved")
      return fail("This driver's paperwork is already approved.");
    const now = new Date();
    // A form the shop has already signed online keeps its record; anything earlier becomes a paper form checked in person.
    const signedOnline =
      insp.method === "online" && Boolean(insp.mechanicSignedAt);
    const db = await getDb();
    await db
      .update(s.techInspections)
      .set({
        status: "approved",
        method: signedOnline ? "online" : "paper",
        mechanicTokenHash: signedOnline ? insp.mechanicTokenHash : null,
        mechanicTokenExpires: null,
        reviewedById: v.user.id,
        reviewedAt: now,
        reviewNote: `Paper form checked in person at the track by ${fullName(v.user)}.`,
        updatedAt: now,
      })
      .where(eq(s.techInspections.id, insp.id));
    refresh();
    return ok("Paperwork approved");
  } catch (err) {
    return asFailure(err);
  }
}
