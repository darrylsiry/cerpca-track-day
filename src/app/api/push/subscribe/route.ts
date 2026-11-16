import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema as s } from "@/db";
import { getSessionUser } from "@/server/auth";

const Subscription = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

/** Remember this browser's push subscription for the signed-in person. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Subscription.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That is not a push subscription." }, { status: 400 });

  const { endpoint, keys } = parsed.data;
  const db = await getDb();
  const userAgent = request.headers.get("user-agent")?.slice(0, 250) ?? null;
  const [existing] = await db.select({ id: s.pushSubscriptions.id }).from(s.pushSubscriptions).where(eq(s.pushSubscriptions.endpoint, endpoint)).limit(1);
  if (existing) {
    // Same browser, possibly a different person signed in now: the device follows whoever is using it.
    await db.update(s.pushSubscriptions).set({ userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent }).where(eq(s.pushSubscriptions.id, existing.id));
  } else {
    await db.insert(s.pushSubscriptions).values({ userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent });
  }
  return NextResponse.json({ ok: true });
}

/** Forget this browser's subscription. */
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = z.object({ endpoint: z.string().url().max(2000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  const db = await getDb();
  await db.delete(s.pushSubscriptions).where(and(eq(s.pushSubscriptions.endpoint, parsed.data.endpoint), eq(s.pushSubscriptions.userId, user.id)));
  return NextResponse.json({ ok: true });
}
