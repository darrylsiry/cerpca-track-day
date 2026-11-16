import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema as s } from "@/db";
import { getSessionUser } from "@/server/auth";
import { unreadCount } from "@/server/queries";

/**
 * A tiny fingerprint of "has anything changed for me?", polled by open apps.
 * v = schedule version, a = newest announcement, n = unread inbox count.
 * This is also the first endpoint a native app would call.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = await getDb();
  const [m] = await db.select({ orgId: s.memberships.orgId }).from(s.memberships).where(eq(s.memberships.userId, user.id)).limit(1);
  if (!m) return NextResponse.json({ v: 0, a: null, n: 0 });

  // Version of the most recently touched event; cheap and good enough to trigger a refresh.
  const events = await db.select({ id: s.events.id, v: s.events.scheduleVersion }).from(s.events).where(eq(s.events.orgId, m.orgId));
  const v = events.reduce((sum, e) => sum + e.v, 0);
  const [a] = await db
    .select({ id: s.announcements.id, title: s.announcements.title })
    .from(s.announcements)
    .where(eq(s.announcements.orgId, m.orgId))
    .orderBy(desc(s.announcements.createdAt))
    .limit(1);
  const n = await unreadCount(user.id);
  return NextResponse.json({ v, a: a?.id ?? null, n, t: a?.title }, { headers: { "Cache-Control": "no-store" } });
}
