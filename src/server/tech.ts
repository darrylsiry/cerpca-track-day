import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb, schema as s } from "@/db";
import type { EventRow, Organization, Shop, TechInspection } from "@/db/schema";
import { TECH_ITEMS, techFlags, type TechFlag } from "@/lib/tech-form";
import { addDays } from "@/lib/time";
import type { TechFormData } from "@/lib/types";
import { sha256 } from "./util";

/* Reads and rules for tech inspection, shared by the driver flow, the shop page and the admin screens. */

export const SHOP_LINK_DAYS = 21;
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export async function getInspection(eventId: string, userId: string): Promise<TechInspection | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(s.techInspections)
    .where(and(eq(s.techInspections.eventId, eventId), eq(s.techInspections.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getInspectionById(id: string): Promise<TechInspection | null> {
  const db = await getDb();
  const [row] = await db.select().from(s.techInspections).where(eq(s.techInspections.id, id)).limit(1);
  return row ?? null;
}

export async function listInspections(eventId: string): Promise<TechInspection[]> {
  const db = await getDb();
  return db.select().from(s.techInspections).where(eq(s.techInspections.eventId, eventId));
}

export async function listShops(orgId: string): Promise<Shop[]> {
  const db = await getDb();
  return db.select().from(s.shops).where(eq(s.shops.orgId, orgId)).orderBy(desc(s.shops.verified), asc(s.shops.name));
}

/** The registry entry a form's shop corresponds to, by id or by email. */
export function matchShop(insp: Pick<TechInspection, "shopId" | "shopEmail">, shops: Shop[]): Shop | null {
  const byId = insp.shopId ? shops.find((x) => x.id === insp.shopId) : undefined;
  if (byId) return byId;
  const email = insp.shopEmail?.trim().toLowerCase();
  return (email && shops.find((x) => x.email && x.email.trim().toLowerCase() === email)) || null;
}

/** null for paper forms (nothing to verify online). */
export function shopVerified(insp: Pick<TechInspection, "shopId" | "shopEmail" | "method">, shops: Shop[]): boolean | null {
  if (insp.method !== "online") return null;
  return Boolean(matchShop(insp, shops)?.verified);
}

/** The shop's part is on file: the technician signed online, or a paper form was uploaded. */
export const shopPartDone = (insp: Pick<TechInspection, "status">) => ["shop_signed", "submitted", "changes_requested", "approved"].includes(insp.status);

export function flagsFor(insp: TechInspection, event: Pick<EventRow, "startDate">, org: Pick<Organization, "settings">, shops: Shop[]): TechFlag[] {
  if (insp.method === "online" && !insp.mechanicSignedAt) return [];
  if (insp.method === "paper" && !insp.paperFile) return [];
  return techFlags({
    form: insp.form,
    inspectionDate: insp.inspectionDate,
    eventStart: event.startDate,
    window: org.settings.techWindow,
    method: insp.method,
    shopVerified: shopVerified(insp, shops),
  });
}

/** The dates between which the shop inspection should be done. */
export function inspectionWindow(event: Pick<EventRow, "startDate">, org: Pick<Organization, "settings">) {
  const w = org.settings.techWindow;
  return { earliest: addDays(event.startDate, -w.earliestDays), latest: addDays(event.startDate, -w.latestDays) };
}

export function newShopToken() {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: sha256(token), expires: new Date(Date.now() + SHOP_LINK_DAYS * 86400000) };
}

/**
 * The exact text the seal is taken over: the checklist in form order, the
 * measurements, the inspection date and who signed. Any later change to one of
 * these no longer matches the stored seal.
 */
export function sealPayload(input: { form: TechFormData; inspectionDate: string | null; mechanicName: string | null; shopName: string | null }): string {
  const f = input.form;
  const items = Object.fromEntries(TECH_ITEMS.filter((it) => f.items[it.key]).map((it) => [it.key, f.items[it.key]]));
  const itemNotes = Object.fromEntries(TECH_ITEMS.filter((it) => f.itemNotes?.[it.key]).map((it) => [it.key, f.itemNotes![it.key]]));
  const form = {
    items,
    itemNotes,
    tireDates: { lf: f.tireDates.lf, rf: f.tireDates.rf, lr: f.tireDates.lr, rr: f.tireDates.rr },
    brakeFluidDate: f.brakeFluidDate,
    helmet: f.helmet ?? "",
    notes: f.notes ?? "",
  };
  return JSON.stringify([form, input.inspectionDate, input.mechanicName, input.shopName]);
}

export const sealOf = (input: Parameters<typeof sealPayload>[0]) => sha256(sealPayload(input));

/** true = record still matches what the technician signed; null = nothing to check. */
export function sealIntact(insp: TechInspection): boolean | null {
  if (!insp.sealHash || !insp.mechanicSignedAt) return null;
  return sealOf(insp) === insp.sealHash;
}

/** Short code the shop sees on its confirmation screen and the reviewer sees on the form. */
export const sealCode = (seal: string | null | undefined) => (seal ? seal.slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, "$1 ") : "");

/** Next sticker number for the event, continuing whatever sequence is already in use. */
export async function nextStickerNumber(event: Pick<EventRow, "id" | "name" | "startDate">): Promise<string> {
  const db = await getDb();
  const rows = await db
    .select({ n: s.techInspections.stickerNumber })
    .from(s.techInspections)
    .where(and(eq(s.techInspections.eventId, event.id), isNotNull(s.techInspections.stickerNumber)));
  let prefix = `${(event.name.trim()[0] ?? "T").toUpperCase()}${event.startDate.slice(2, 4)}-`;
  let max = 0;
  for (const r of rows) {
    const m = /^(.*?)(\d+)$/.exec(r.n ?? "");
    if (!m) continue;
    const n = Number(m[2]);
    if (n >= max) {
      max = n;
      prefix = m[1];
    }
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export async function adminUserIds(orgId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: s.memberships.userId })
    .from(s.memberships)
    .where(and(eq(s.memberships.orgId, orgId), eq(s.memberships.isAdmin, true)));
  return rows.map((r) => r.id);
}

/** Absolute origin of this deployment, for links that leave the app (the shop's email). */
export async function publicOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

export const carLabel = (i: Pick<TechInspection, "vehicleYear" | "vehicleMake" | "vehicleModel">) =>
  [i.vehicleYear, i.vehicleMake, i.vehicleModel].filter(Boolean).join(" ");
