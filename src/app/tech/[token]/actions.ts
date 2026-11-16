"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import { TECH_ITEMS, tireCodeDate } from "@/lib/tech-form";
import { zoned } from "@/lib/time";
import type { TechFormData, TechItemResult } from "@/lib/types";
import { clientIp, clientUserAgent } from "@/server/auth";
import { notifyUsers } from "@/server/notify";
import { sealOf } from "@/server/tech";
import { asFailure, sha256, str } from "@/server/util";

export type ShopSubmitState = { ok: true } | { ok: false; error: string; field?: string } | null;

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const TIRE_LABEL: Record<string, string> = { lf: "left front", rf: "right front", lr: "left rear", rr: "right rear" };

/**
 * The technician's sign-off. Reached only through the single-use link emailed
 * to the shop: the token in that link is the credential, so there is no session
 * to check here. Everything is validated again on the server.
 */
export async function submitShopInspection(token: string, _prev: ShopSubmitState, fd: FormData): Promise<ShopSubmitState> {
  try {
    const db = await getDb();
    const [row] = await db
      .select({ insp: s.techInspections, tz: s.tracks.timezone })
      .from(s.techInspections)
      .innerJoin(s.events, eq(s.events.id, s.techInspections.eventId))
      .innerJoin(s.tracks, eq(s.tracks.id, s.events.trackId))
      .where(eq(s.techInspections.mechanicTokenHash, sha256(token)))
      .limit(1);
    if (!row) return { ok: false, error: "This link is no longer valid. Ask the driver to send you a new one." };
    const { insp, tz } = row;
    if (insp.status !== "with_shop" || insp.mechanicSignedAt) return { ok: false, error: "This form has already been signed. Ask the driver to send it back to you if it needs a correction." };
    if (!insp.mechanicTokenExpires || insp.mechanicTokenExpires.getTime() < Date.now()) return { ok: false, error: "This link has expired. Ask the driver to send you a new one." };

    const today = zoned(new Date(), tz).day;
    const items: Record<string, TechItemResult> = {};
    const itemNotes: Record<string, string> = {};
    for (const it of TECH_ITEMS) {
      const v = str(fd, `item_${it.key}`);
      if (v !== "pass" && v !== "fail" && !(v === "na" && it.optional)) {
        return { ok: false, field: `item-${it.key}`, error: `Mark "${it.label}" as ${it.optional ? "pass, fail or N/A" : "pass or fail"}.` };
      }
      items[it.key] = v;
      if (v === "fail") {
        const note = str(fd, `note_${it.key}`).slice(0, 500);
        if (!note) return { ok: false, field: `item-${it.key}`, error: `Add a note saying what is wrong with "${it.label}".` };
        itemNotes[it.key] = note;
      }
    }

    const tireDates = { lf: "", rf: "", lr: "", rr: "" };
    for (const k of ["lf", "rf", "lr", "rr"] as const) {
      const code = str(fd, `tire_${k}`).replace(/\D/g, "");
      const made = tireCodeDate(code);
      if (!made) return { ok: false, field: "tires", error: `Enter the ${TIRE_LABEL[k]} tire's date code as four digits: week then year, for example 2423.` };
      if (made.getTime() > Date.now() + 7 * 86400000) return { ok: false, field: "tires", error: `The ${TIRE_LABEL[k]} tire's date code is in the future. Check the four digits.` };
      tireDates[k] = code;
    }

    const brakeFluidDate = str(fd, "brakeFluidDate");
    if (!isDay(brakeFluidDate)) return { ok: false, field: "fluid", error: "Enter the date the brake fluid was last changed." };
    if (brakeFluidDate > today) return { ok: false, field: "fluid", error: "The brake fluid date cannot be in the future." };

    const inspectionDate = str(fd, "inspectionDate");
    if (!isDay(inspectionDate)) return { ok: false, field: "signoff", error: "Enter the date you inspected the car." };
    if (inspectionDate > today) return { ok: false, field: "signoff", error: "The inspection date cannot be in the future." };

    const mechanicName = str(fd, "mechanicName");
    if (mechanicName.length < 3) return { ok: false, field: "signoff", error: "Enter your full name." };
    if (fd.get("certify") !== "on") return { ok: false, field: "signoff", error: "Tick the box to certify the inspection." };
    const signature = str(fd, "signature");
    if (!signature.startsWith("data:image/")) return { ok: false, field: "signoff", error: "Sign in the box." };
    if (signature.length > 600_000) return { ok: false, field: "signoff", error: "That signature could not be saved. Clear the box and sign again." };

    const form: TechFormData = {
      items,
      itemNotes,
      tireDates,
      brakeFluidDate,
      helmet: str(fd, "helmet").slice(0, 40),
      notes: str(fd, "notes").slice(0, 1000),
    };
    const now = new Date();
    await db
      .update(s.techInspections)
      .set({
        status: "shop_signed",
        form,
        inspectionDate,
        mechanicName,
        mechanicSignature: signature,
        mechanicSignedAt: now,
        mechanicIp: await clientIp(),
        mechanicUserAgent: await clientUserAgent(),
        sealHash: sealOf({ form, inspectionDate, mechanicName, shopName: insp.shopName }),
        // The link is spent. The hash stays so the same link can show the shop its receipt, but it can never sign again.
        mechanicTokenExpires: null,
        updatedAt: now,
      })
      .where(eq(s.techInspections.id, insp.id));

    const failed = Object.values(items).filter((v) => v === "fail").length;
    await notifyUsers({
      userIds: [insp.userId],
      title: failed ? "Your shop finished the tech form, with failed items" : "Your shop signed your tech form",
      body: failed
        ? `${mechanicName} at ${insp.shopName ?? "your shop"} marked ${failed === 1 ? "one item" : `${failed} items`} as failed. Open the form to see what needs fixing.`
        : `${mechanicName} at ${insp.shopName ?? "your shop"} completed the inspection. Review it and sign your part to submit it to the tech team.`,
      href: "/me/tech",
      kind: "tech",
      eventId: insp.eventId,
      channels: ["inapp", "email"],
    });

    refresh();
    return { ok: true };
  } catch (err) {
    const r = asFailure(err);
    return r.ok ? null : { ok: false, error: r.error };
  }
}
