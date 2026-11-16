import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, gte, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getDb, schema as s } from "@/db";
import type { EventRow, Membership, Organization, Registration, RunGroup, Track, User } from "@/db/schema";
import { zoned, type ZonedNow } from "@/lib/time";
import { sendEmail } from "./notify";

export const SESSION_COOKIE = "td_session";
export const EVENT_COOKIE = "td_event";
export const CLOCK_COOKIE = "td_clock";

const SESSION_DAYS = 30;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

/** Demo mode shows one-tap sample accounts and the simulated clock. Never enable it in production. */
export const demoMode = () => process.env.DEMO_MODE === "1";

/* ───────────── Sessions ───────────── */

export async function createSession(userId: string) {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  const ua = (await headers()).get("user-agent")?.slice(0, 250) ?? null;
  await db.insert(s.sessions).values({ id: sha(token), userId, expiresAt, userAgent: ua });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(s.sessions).where(eq(s.sessions.id, sha(token)));
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(EVENT_COOKIE);
  jar.delete(CLOCK_COOKIE);
}

export const getSessionUser = cache(async (): Promise<User | null> => {
  // Everything behind sign-in is live, per-person data: always render it at request time
  // rather than letting it be captured in a prefetched shell.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ user: s.users })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.id, sha(token)), gt(s.sessions.expiresAt, new Date())))
    .limit(1);
  return row?.user ?? null;
});

/* ───────────── One-time sign-in codes ───────────── */

export async function issueSignInCode(rawEmail: string): Promise<{ devCode?: string }> {
  const email = rawEmail.trim().toLowerCase();
  const db = await getDb();
  const [user] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);
  // Same answer whether or not the address is on a roster, so the form can't be used to probe for members.
  if (!user) return {};

  const recent = await db
    .select({ id: s.otpCodes.id })
    .from(s.otpCodes)
    .where(and(eq(s.otpCodes.email, email), gt(s.otpCodes.createdAt, new Date(Date.now() - 15 * 60000))));
  if (recent.length >= 5) return {};

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(s.otpCodes).values({ email, codeHash: sha(`${email}:${code}`), expiresAt: new Date(Date.now() + 10 * 60000) });
  const result = await sendEmail({
    to: email,
    subject: `${code} is your Track Day sign-in code`,
    text: `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for this, you can ignore this email.`,
    userId: user.id,
    kind: "signin",
    redactBody: true,
  });
  // With no email provider configured, demo mode shows the code on screen instead.
  return result === "simulated" && demoMode() ? { devCode: code } : {};
}

export async function verifySignInCode(rawEmail: string, code: string): Promise<User | null> {
  const email = rawEmail.trim().toLowerCase();
  const db = await getDb();
  const [row] = await db
    .select()
    .from(s.otpCodes)
    .where(and(eq(s.otpCodes.email, email), isNull(s.otpCodes.consumedAt), gt(s.otpCodes.expiresAt, new Date())))
    .orderBy(desc(s.otpCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= 5) return null;
  if (row.codeHash !== sha(`${email}:${code.trim()}`)) {
    await db.update(s.otpCodes).set({ attempts: row.attempts + 1 }).where(eq(s.otpCodes.id, row.id));
    return null;
  }
  await db.update(s.otpCodes).set({ consumedAt: new Date() }).where(eq(s.otpCodes.id, row.id));
  const [user] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);
  return user ?? null;
}

/* ───────────── The viewer: who is looking, at which event, in what role ───────────── */

export type Viewer = {
  user: User;
  org: Organization;
  membership: Membership;
  isAdmin: boolean;
  isInstructor: boolean;
  groups: RunGroup[];
  /** The event in focus: this weekend's by default; administrators can switch to any other. */
  event: EventRow | null;
  track: Track | null;
  registration: Registration | null;
  group: RunGroup | null;
  tz: string;
  /** Demo-only clock shift, so a schedule can be explored at any time of day. */
  clockOffsetMs: number;
  nowMs: number;
  now: ZonedNow;
  viewingOtherEvent: boolean;
};

export const getViewer = cache(async (): Promise<Viewer> => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const db = await getDb();
  const jar = await cookies();

  const [m] = await db
    .select({ membership: s.memberships, org: s.organizations })
    .from(s.memberships)
    .innerJoin(s.organizations, eq(s.organizations.id, s.memberships.orgId))
    .where(eq(s.memberships.userId, user.id))
    .orderBy(asc(s.memberships.createdAt))
    .limit(1);
  if (!m) redirect("/login?error=no-region");
  const { membership, org } = m;

  const clockOffsetMs = demoMode() ? Number(jar.get(CLOCK_COOKIE)?.value ?? 0) || 0 : 0;
  const nowMs = Date.now() + clockOffsetMs;

  const groups = await db.select().from(s.runGroups).where(eq(s.runGroups.orgId, org.id)).orderBy(asc(s.runGroups.sortOrder));

  const today = zoned(new Date(nowMs), org.timezone).day;
  const [upcoming] = await db
    .select()
    .from(s.events)
    .where(and(eq(s.events.orgId, org.id), eq(s.events.status, "published"), gte(s.events.endDate, today)))
    .orderBy(asc(s.events.startDate))
    .limit(1);
  let event: EventRow | null = upcoming ?? null;
  if (!event) {
    const [latest] = await db.select().from(s.events).where(eq(s.events.orgId, org.id)).orderBy(desc(s.events.startDate)).limit(1);
    event = latest ?? null;
  }
  const defaultEventId = event?.id ?? null;
  const chosen = jar.get(EVENT_COOKIE)?.value;
  if (chosen && membership.isAdmin && chosen !== defaultEventId) {
    const [other] = await db.select().from(s.events).where(and(eq(s.events.id, chosen), eq(s.events.orgId, org.id))).limit(1);
    if (other) event = other;
  }

  let track: Track | null = null;
  let registration: Registration | null = null;
  if (event) {
    [track] = await db.select().from(s.tracks).where(eq(s.tracks.id, event.trackId)).limit(1);
    const [reg] = await db
      .select()
      .from(s.registrations)
      .where(and(eq(s.registrations.eventId, event.id), eq(s.registrations.userId, user.id)))
      .limit(1);
    registration = reg && reg.status !== "cancelled" ? reg : null;
  }
  const groupId = registration?.runGroupId ?? membership.runGroupId;
  const tz = track?.timezone ?? org.timezone;

  return {
    user,
    org,
    membership,
    isAdmin: membership.isAdmin,
    isInstructor: membership.isInstructor,
    groups,
    event,
    track: track ?? null,
    registration,
    group: groups.find((g) => g.id === groupId) ?? null,
    tz,
    clockOffsetMs,
    nowMs,
    now: zoned(new Date(nowMs), tz),
    viewingOtherEvent: Boolean(event && defaultEventId && event.id !== defaultEventId),
  };
});

/** Props for <ClockProvider>, for any screen that shows live times. */
export const clockProps = (v: Viewer) => ({ tz: v.tz, offsetMs: v.clockOffsetMs, serverNowMs: v.nowMs });

export async function requireAdmin(): Promise<Viewer> {
  const v = await getViewer();
  if (!v.isAdmin) redirect("/home");
  return v;
}

export async function requireInstructor(): Promise<Viewer> {
  const v = await getViewer();
  if (!v.isInstructor && !v.isAdmin) redirect("/home");
  return v;
}

/** For Server Actions: the viewer plus a guaranteed event. */
export async function requireEvent(role: "any" | "admin" | "instructor" = "any") {
  const v = role === "admin" ? await requireAdmin() : role === "instructor" ? await requireInstructor() : await getViewer();
  if (!v.event) throw new Error("There is no event to work with yet.");
  return v as Viewer & { event: EventRow };
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

export async function clientUserAgent(): Promise<string | null> {
  return (await headers()).get("user-agent")?.slice(0, 300) ?? null;
}
