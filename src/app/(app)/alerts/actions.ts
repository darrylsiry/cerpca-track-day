"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema as s } from "@/db";
import type { ActionResult } from "@/lib/types";
import { getViewer } from "@/server/auth";
import { asFailure, fail, ok } from "@/server/util";

/** Mark one of the viewer's own alerts as read. */
export async function markRead(id: string): Promise<ActionResult> {
  try {
    const v = await getViewer();
    const parsed = z.string().min(1).max(64).safeParse(id);
    if (!parsed.success) return fail("That alert could not be found.");
    const db = await getDb();
    await db
      .update(s.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(s.notifications.id, parsed.data), eq(s.notifications.userId, v.user.id), isNull(s.notifications.readAt)));
    refresh();
    return ok();
  } catch (err) {
    return asFailure(err);
  }
}

export async function markAllRead(): Promise<ActionResult> {
  try {
    const v = await getViewer();
    const db = await getDb();
    await db.update(s.notifications).set({ readAt: new Date() }).where(and(eq(s.notifications.userId, v.user.id), isNull(s.notifications.readAt)));
    refresh();
    return ok("All alerts marked read");
  } catch (err) {
    return asFailure(err);
  }
}
