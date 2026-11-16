"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { fromTimeInput, offsetToReach } from "@/lib/time";
import type { ActionResult } from "@/lib/types";
import { CLOCK_COOKIE, demoMode, EVENT_COOKIE, getViewer, requireAdmin } from "@/server/auth";

/** Demo only: shift the app's clock so any moment of the weekend can be explored. */
export async function setDemoClock(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!demoMode()) return { ok: false, error: "The simulated clock is only available in demo mode." };
  const v = await getViewer();
  const day = String(formData.get("day") ?? "");
  const minutes = fromTimeInput(String(formData.get("time") ?? ""));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || minutes === null) return { ok: false, error: "Pick a day and a time." };
  const offset = offsetToReach(day, minutes, v.tz, new Date());
  (await cookies()).set(CLOCK_COOKIE, String(offset), { path: "/", sameSite: "lax", maxAge: 86400 });
  refresh();
  return { ok: true, message: "Clock set" };
}

export async function clearDemoClock(): Promise<ActionResult> {
  (await cookies()).delete(CLOCK_COOKIE);
  refresh();
  return { ok: true, message: "Back to real time" };
}

/** Administrators can put any event, past or future, in focus. */
export async function switchEvent(eventId: string | null): Promise<ActionResult> {
  await requireAdmin();
  const jar = await cookies();
  if (eventId) jar.set(EVENT_COOKIE, eventId, { path: "/", sameSite: "lax", maxAge: 86400 * 7 });
  else jar.delete(EVENT_COOKIE);
  refresh();
  return { ok: true, message: "Event switched" };
}
