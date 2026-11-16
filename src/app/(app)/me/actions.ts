"use server";

import { and, desc, eq, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema as s } from "@/db";
import type { ActionResult } from "@/lib/types";
import { getViewer } from "@/server/auth";
import { asFailure, fail, ok, str } from "@/server/util";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

const phone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => v === "" || (/^[\d\s()+.\-x]+$/i.test(v) && v.replace(/\D/g, "").length >= 7), "Enter a phone number with its area code.")
  .transform((v) => (v === "" ? null : v));

const Contact = z.object({
  phone,
  address1: optional(120),
  city: optional(80),
  state: optional(40),
  zip: optional(12),
  emergencyName: optional(100),
  emergencyPhone: phone,
  tshirtSize: optional(6),
  pcaMemberNumber: optional(24),
});

export async function updateContact(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const v = await getViewer();
    const parsed = Contact.safeParse(Object.fromEntries(Object.keys(Contact.shape).map((k) => [k, str(formData, k)])));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the details and try again.");
    const db = await getDb();
    // Text alerts need a number to go to.
    const patch = parsed.data.phone ? parsed.data : { ...parsed.data, notifySms: false };
    await db.update(s.users).set(patch).where(eq(s.users.id, v.user.id));
    refresh();
    return ok("Details saved");
  } catch (err) {
    return asFailure(err);
  }
}

const Car = z.object({
  year: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1900 && v <= 2100), "Enter the model year as four digits."),
  make: z.string().trim().min(1, "Enter the make.").max(40),
  model: z.string().trim().min(1, "Enter the model.").max(60),
  color: optional(40),
  carNumber: z
    .string()
    .trim()
    .max(4, "Car numbers are up to 4 characters.")
    .regex(/^[0-9A-Za-z]*$/, "Car numbers use digits and letters only.")
    .transform((v) => (v === "" ? null : v.toUpperCase())),
});

export async function updateCar(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const v = await getViewer();
    const parsed = Car.safeParse(Object.fromEntries(Object.keys(Car.shape).map((k) => [k, str(formData, k)])));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the car details and try again.");
    const car = parsed.data;
    const db = await getDb();

    // The car number on the roster for the event in focus follows the profile, unless the event is over.
    const liveRegistration = v.event && v.registration && v.event.status !== "completed" ? v.registration : null;
    if (liveRegistration && car.carNumber && car.carNumber !== liveRegistration.carNumber) {
      const [clash] = await db
        .select({ id: s.registrations.id })
        .from(s.registrations)
        .where(
          and(
            eq(s.registrations.eventId, liveRegistration.eventId),
            eq(s.registrations.carNumber, car.carNumber),
            ne(s.registrations.userId, v.user.id),
            ne(s.registrations.status, "cancelled"),
          ),
        )
        .limit(1);
      if (clash) return fail(`Car number ${car.carNumber} is already taken at this event. Choose another, or ask the registrar to sort it out.`);
    }

    const [existing] = await db.select().from(s.vehicles).where(eq(s.vehicles.userId, v.user.id)).orderBy(desc(s.vehicles.isPrimary)).limit(1);
    let vehicleId = existing?.id;
    if (existing) {
      await db.update(s.vehicles).set(car).where(eq(s.vehicles.id, existing.id));
    } else {
      const [created] = await db.insert(s.vehicles).values({ userId: v.user.id, ...car, isPrimary: true }).returning({ id: s.vehicles.id });
      vehicleId = created.id;
    }
    if (liveRegistration) {
      await db.update(s.registrations).set({ vehicleId, carNumber: car.carNumber }).where(eq(s.registrations.id, liveRegistration.id));
    }
    refresh();
    return ok("Car saved");
  } catch (err) {
    return asFailure(err);
  }
}

const PREFS = { email: "notifyEmail", sms: "notifySms", push: "notifyPush" } as const;

/** Per-person channel preference. Device-level push permission is handled by PushToggle. */
export async function setNotificationPref(channel: keyof typeof PREFS, enabled: boolean): Promise<ActionResult> {
  try {
    const v = await getViewer();
    if (!(channel in PREFS) || typeof enabled !== "boolean") return fail("That setting does not exist.");
    if (channel === "sms" && enabled && !v.user.phone) return fail("Add a mobile number to your details first.");
    const db = await getDb();
    await db
      .update(s.users)
      .set({ [PREFS[channel]]: enabled })
      .where(eq(s.users.id, v.user.id));
    refresh();
    return ok(enabled ? "Turned on" : "Turned off");
  } catch (err) {
    return asFailure(err);
  }
}
