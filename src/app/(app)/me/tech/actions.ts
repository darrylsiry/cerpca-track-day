"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema as s } from "@/db";
import { fullName } from "@/lib/cn";
import { emptyTechForm, TECH_ITEMS } from "@/lib/tech-form";
import { dateRange, dayFull, zoned } from "@/lib/time";
import type { ActionResult } from "@/lib/types";
import { requireEvent } from "@/server/auth";
import { notifyUsers, sendEmail } from "@/server/notify";
import { saveUpload, UPLOAD_TYPES } from "@/server/storage";
import { adminUserIds, carLabel, getInspection, listShops, MAX_UPLOAD_BYTES, newShopToken, publicOrigin, SHOP_LINK_DAYS } from "@/server/tech";
import { asFailure, fail, ok, str } from "@/server/util";

const LOCKED = ["submitted", "approved"];
const LOCKED_MESSAGE = "This form has been submitted. If something needs to change, ask the tech team to send it back to you.";

async function driverContext() {
  const v = await requireEvent();
  if (!v.registration) throw new Error("You are not on the roster for this event, so there is no tech form to fill in.");
  const insp = await getInspection(v.event.id, v.user.id);
  return { v, insp };
}

const carSchema = z.object({
  year: z.coerce.number({ error: "Enter the model year as four digits." }).int().min(1940, "Enter the model year as four digits.").max(2100, "Enter the model year as four digits."),
  make: z.string().min(1, "Enter the make of the car."),
  model: z.string().min(1, "Enter the model of the car."),
  color: z.string(),
  carNumber: z.string().min(1, "Enter the car number you will run.").max(4, "Car numbers are up to four characters."),
  emergency1: z.string().min(5, "Enter an emergency contact's name and phone number."),
  driver2Name: z.string(),
  emergency2: z.string(),
});

/** Step 1: the car and who to call. Creates the form the first time it is saved. */
export async function saveCarDetails(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const { v, insp } = await driverContext();
    if (insp && LOCKED.includes(insp.status)) return fail(LOCKED_MESSAGE);
    const carLocked = Boolean(insp && insp.status !== "draft");

    const parsed = carSchema.safeParse({
      year: carLocked ? (insp!.vehicleYear ?? 2000) : str(fd, "year"),
      make: carLocked ? (insp!.vehicleMake ?? "-") : str(fd, "make"),
      model: carLocked ? (insp!.vehicleModel ?? "-") : str(fd, "model"),
      color: carLocked ? (insp!.vehicleColor ?? "") : str(fd, "color"),
      carNumber: carLocked ? (insp!.carNumber ?? "0") : str(fd, "carNumber"),
      emergency1: str(fd, "emergency1"),
      driver2Name: str(fd, "driver2Name"),
      emergency2: str(fd, "emergency2"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const d = parsed.data;
    if (d.driver2Name && d.emergency2.length < 5) return fail("Enter an emergency contact for the second driver.");

    const people = { emergency1: d.emergency1, driver2Name: d.driver2Name || null, emergency2: d.driver2Name ? d.emergency2 : null, updatedAt: new Date() };
    const car = { vehicleYear: d.year, vehicleMake: d.make, vehicleModel: d.model, vehicleColor: d.color || null, carNumber: d.carNumber };
    const db = await getDb();
    if (insp) {
      await db
        .update(s.techInspections)
        .set(carLocked ? people : { ...people, ...car })
        .where(eq(s.techInspections.id, insp.id));
    } else {
      await db.insert(s.techInspections).values({ eventId: v.event.id, userId: v.user.id, status: "draft", method: "online", form: emptyTechForm(), ...people, ...car });
    }
    refresh();
    return ok(insp ? "Details saved" : "Saved. Next, your shop inspection");
  } catch (err) {
    return asFailure(err);
  }
}

export type InviteState = { ok: true; sentTo: string; shopName: string; emailed: boolean; link?: string } | { ok: false; error: string } | null;

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * Step 2a: email the shop a single-use link to fill in and sign the checklist.
 * Only the hash of the link's token is stored, so the link cannot be recovered
 * from the database; sending again replaces it.
 */
export async function inviteShop(_prev: InviteState, fd: FormData): Promise<InviteState> {
  try {
    const { v, insp } = await driverContext();
    if (!insp) return { ok: false, error: "Save your car details first." };
    if (LOCKED.includes(insp.status)) return { ok: false, error: LOCKED_MESSAGE };

    const db = await getDb();
    const shops = await listShops(v.org.id);
    const pickedId = str(fd, "shopId");
    const picked = pickedId && pickedId !== "other" ? shops.find((x) => x.id === pickedId) : undefined;

    let shopId: string | null;
    let shopName: string;
    let shopEmail: string;
    let shopPhone: string | null;
    let mechanicName: string | null;

    if (picked) {
      if (!picked.email) return { ok: false, error: `The region has no email address on file for ${picked.name}. Choose "Another shop" and enter it.` };
      shopId = picked.id;
      shopName = picked.name;
      // For a shop in the registry the link always goes to the address the region holds, never one the driver types.
      shopEmail = picked.email;
      shopPhone = picked.phone;
      mechanicName = str(fd, "mechanicName") || picked.contactName;
    } else {
      shopName = str(fd, "shopName");
      shopEmail = str(fd, "shopEmail").toLowerCase();
      shopPhone = str(fd, "shopPhone") || null;
      mechanicName = str(fd, "mechanicName") || null;
      if (!shopName) return { ok: false, error: "Enter the shop's name." };
      if (!emailOk(shopEmail)) return { ok: false, error: "Enter the shop's email address so the link can be sent to them." };
      if (shopEmail === v.user.email.toLowerCase()) return { ok: false, error: "Use the shop's email address, not your own. The technician signs the form, not the driver." };
      const known = shops.find((x) => x.email && x.email.trim().toLowerCase() === shopEmail);
      if (known) {
        shopId = known.id;
      } else {
        // New to the region: add it to the registry, unverified, so the tech team can confirm it once.
        const [created] = await db
          .insert(s.shops)
          .values({ orgId: v.org.id, name: shopName, contactName: mechanicName, email: shopEmail, phone: shopPhone, verified: false, notes: `Added from ${fullName(v.user)}'s tech form.` })
          .returning();
        shopId = created.id;
      }
    }

    const { token, hash, expires } = newShopToken();
    await db
      .update(s.techInspections)
      .set({
        status: "with_shop",
        method: "online",
        shopId,
        shopName,
        shopEmail,
        shopPhone,
        mechanicName,
        paperFile: null,
        mechanicTokenHash: hash,
        mechanicTokenExpires: expires,
        mechanicInvitedAt: new Date(),
        // A new request voids any earlier sign-off; the checklist values stay so the shop can amend them.
        mechanicSignedAt: null,
        mechanicSignature: null,
        mechanicIp: null,
        mechanicUserAgent: null,
        sealHash: null,
        driverSignedName: null,
        driverSignature: null,
        driverSignedAt: null,
        submittedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(s.techInspections.id, insp.id));

    const link = `${await publicOrigin()}/tech/${token}`;
    const car = [carLabel(insp), insp.vehicleColor, insp.carNumber ? `car #${insp.carNumber}` : null].filter(Boolean).join(", ");
    const delivery = await sendEmail({
      to: shopEmail,
      subject: `Tech inspection form for ${fullName(v.user)}'s ${carLabel(insp) || "car"}`,
      text: [
        `${fullName(v.user)} has asked ${shopName} to complete the pre-event technical inspection for their car (${car}).`,
        `Event: ${v.event.name}, ${dateRange(v.event.startDate, v.event.endDate)}${v.track ? `, ${v.track.name}` : ""}. Organized by ${v.org.name}.`,
        `Open this link to fill in the checklist and sign it. No account is needed:\n${link}`,
        `The link is for your shop only. It works once and expires on ${dayFull(zoned(expires, v.tz).day)} (${SHOP_LINK_DAYS} days from now).`,
        `Questions about the form go to the driver: ${v.user.email}${v.user.phone ? `, ${v.user.phone}` : ""}.`,
      ].join("\n\n"),
      userId: v.user.id,
      eventId: v.event.id,
      kind: "tech",
      redactBody: true,
    });

    refresh();
    // The driver only gets to see the link when the email could not go out; otherwise it reaches the shop and nobody else.
    return { ok: true, sentTo: shopEmail, shopName, emailed: delivery === "sent", link: delivery === "sent" ? undefined : link };
  } catch (err) {
    const r = asFailure(err);
    return r.ok ? null : { ok: false, error: r.error };
  }
}

/** Withdraw a request that the shop has not signed yet. */
export async function cancelShopRequest(): Promise<ActionResult> {
  try {
    const { insp } = await driverContext();
    if (!insp || insp.status !== "with_shop") return fail("There is no open request to cancel.");
    const db = await getDb();
    await db
      .update(s.techInspections)
      .set({ status: "draft", mechanicTokenHash: null, mechanicTokenExpires: null, updatedAt: new Date() })
      .where(eq(s.techInspections.id, insp.id));
    refresh();
    return ok("Request cancelled. The link no longer works");
  } catch (err) {
    return asFailure(err);
  }
}

/** Step 2b: a photo or PDF of the stamped paper form instead of the online checklist. */
export async function uploadPaperForm(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const { v, insp } = await driverContext();
    if (!insp) return fail("Save your car details first.");
    if (LOCKED.includes(insp.status)) return fail(LOCKED_MESSAGE);

    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Choose a photo or PDF of the completed form.");
    if (file.size > MAX_UPLOAD_BYTES) return fail(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 6 MB; take the photo at a lower resolution or scan to PDF.`);
    if (!UPLOAD_TYPES[file.type]) return fail("Upload a photo (JPEG, PNG, WebP or HEIC) or a PDF.");

    const inspectionDate = str(fd, "inspectionDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inspectionDate)) return fail("Enter the date the shop inspected the car.");
    if (inspectionDate > zoned(new Date(), v.tz).day) return fail("The inspection date cannot be in the future.");
    const shopName = str(fd, "shopName");
    if (!shopName) return fail("Enter the name of the shop that stamped the form.");

    const ref = await saveUpload(file, `tech/${v.user.id}`);
    const db = await getDb();
    await db
      .update(s.techInspections)
      .set({
        status: "shop_signed",
        method: "paper",
        paperFile: ref,
        inspectionDate,
        shopId: null,
        shopName,
        shopEmail: null,
        shopPhone: null,
        mechanicName: null,
        form: emptyTechForm(),
        mechanicTokenHash: null,
        mechanicTokenExpires: null,
        mechanicInvitedAt: null,
        mechanicSignedAt: null,
        mechanicSignature: null,
        mechanicIp: null,
        mechanicUserAgent: null,
        sealHash: null,
        driverSignedName: null,
        driverSignature: null,
        driverSignedAt: null,
        submittedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(s.techInspections.id, insp.id));
    refresh();
    return ok("Form uploaded. Sign below to submit it");
  } catch (err) {
    return asFailure(err);
  }
}

/** Step 3: the driver's certification. Sends the form to the tech team. */
export async function signAndSubmit(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const { v, insp } = await driverContext();
    if (!insp) return fail("Save your car details first.");
    if (LOCKED.includes(insp.status)) return fail("This form has already been submitted.");
    const shopOnFile = insp.method === "paper" ? Boolean(insp.paperFile) : Boolean(insp.mechanicSignedAt);
    if (!shopOnFile || (insp.status !== "shop_signed" && insp.status !== "changes_requested")) {
      return fail("The shop inspection has to be on file before you can sign.");
    }
    if (insp.method === "online") {
      const failed = TECH_ITEMS.filter((it) => insp.form.items[it.key] === "fail");
      const missing = TECH_ITEMS.filter((it) => !insp.form.items[it.key]);
      if (failed.length) return fail(`The shop marked ${failed.length === 1 ? "an item" : `${failed.length} items`} as failed. Have it fixed and send the form back to the shop to update before you submit.`);
      if (missing.length) return fail("The shop left part of the checklist unmarked. Send the form back to the shop to finish it.");
    }

    const name = str(fd, "signedName");
    const signature = str(fd, "signature");
    if (name.length < 3) return fail("Type your full name as your signature.");
    if (!signature.startsWith("data:image/")) return fail("Draw your signature in the box.");
    if (signature.length > 600_000) return fail("That signature could not be saved. Clear the box and sign again.");
    if (fd.get("certify") !== "on") return fail("Tick the box to confirm the three statements.");

    const now = new Date();
    const db = await getDb();
    await db
      .update(s.techInspections)
      .set({ status: "submitted", driverSignedName: name, driverSignature: signature, driverSignedAt: now, submittedAt: now, reviewedById: null, reviewedAt: null, reviewNote: null, updatedAt: now })
      .where(eq(s.techInspections.id, insp.id));

    await notifyUsers({
      userIds: await adminUserIds(v.org.id),
      title: `Tech form to review: ${fullName(v.user)}`,
      body: `${carLabel(insp) || "Car"}${insp.carNumber ? `, #${insp.carNumber}` : ""}. ${insp.method === "paper" ? "Paper form upload." : `Signed by ${insp.shopName ?? "the shop"}.`}`,
      href: `/admin/tech/${insp.id}`,
      kind: "tech",
      eventId: v.event.id,
      channels: ["inapp"],
    });
    refresh();
    return ok("Submitted to the tech team");
  } catch (err) {
    return asFailure(err);
  }
}
