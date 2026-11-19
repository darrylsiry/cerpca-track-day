import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, gte, isNull, lt, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after, connection } from "next/server";
import { cache } from "react";
import { getDb, schema as s } from "@/db";
import type { EventRow, Membership, Organization, Registration, RunGroup, Track, User } from "@/db/schema";
import { zoned, type ZonedNow } from "@/lib/time";
import { channelStatus, sendEmail } from "./notify";
import { withinLimit } from "./rate-limit";

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

const CODE_MINUTES = 10;
/** Guesses allowed against one code. */
const CODE_ATTEMPTS = 5;
/*
 * Limits on asking for codes and on guessing them. Each use is counted in one
 * statement before anything else happens (see ./rate-limit), so a burst of
 * requests cannot share a budget.
 *
 *  - Per email: 5 codes in 15 minutes, and 10 guesses an hour across all of an
 *    address's codes. At 10 guesses an hour a 6-digit code cannot be found by
 *    guessing, however many fresh codes are requested.
 *  - Per network address: generous, because a whole paddock can share one
 *    address on the track's Wi-Fi on the morning of an event. It stops one
 *    machine from working through many accounts.
 */
const LIMIT = {
  codesPerEmail: { n: 5, minutes: 15 },
  codesPerAddress: { n: 100, minutes: 15 },
  triesPerEmail: { n: 10, minutes: 60 },
  triesPerAddress: { n: 300, minutes: 15 },
};

/** Count this request against its email and (when known) network address. False when either is over its limit. */
async function allowed(kind: "code" | "try", email: string): Promise<boolean> {
  const perEmail = kind === "code" ? LIMIT.codesPerEmail : LIMIT.triesPerEmail;
  const perAddress = kind === "code" ? LIMIT.codesPerAddress : LIMIT.triesPerAddress;
  const ip = await clientIp();
  const [emailOk, addressOk] = await Promise.all([
    withinLimit(`signin:${kind}:email`, email, perEmail.n, perEmail.minutes),
    // Without a proxy in front there is no address to count by; the per-email limits still apply.
    ip ? withinLimit(`signin:${kind}:address`, ip, perAddress.n, perAddress.minutes) : true,
  ]);
  return emailOk && addressOk;
}

export async function issueSignInCode(rawEmail: string): Promise<{ devCode?: string; limited?: boolean }> {
  const email = rawEmail.trim().toLowerCase();
  if (!(await allowed("code", email))) return { limited: true };
  const db = await getDb();
  const [user] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);

  // The same work is done whether or not the address is on a roster, so neither the answer nor how
  // long it takes can be used to probe for members. An address that is not gets a code nobody knows.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.delete(s.otpCodes).where(lt(s.otpCodes.expiresAt, new Date(Date.now() - 86_400_000)));
  await db.insert(s.otpCodes).values({
    email,
    codeHash: user ? sha(`${email}:${code}`) : sha(randomBytes(32).toString("hex")),
    expiresAt: new Date(Date.now() + CODE_MINUTES * 60000),
  });
  if (!user) return {};

  // The email goes out after the answer has been sent, for the same reason.
  after(async () => {
    await sendEmail({
      to: email,
      subject: `${code} is your Track Day sign-in code`,
      text: `Your sign-in code is ${code}. It expires in ${CODE_MINUTES} minutes.\n\nIf you did not ask for this, you can ignore this email.`,
      userId: user.id,
      kind: "signin",
      redactBody: true,
    });
  });
  // With no email provider configured, demo mode shows the code on screen instead.
  return !channelStatus().email && demoMode() ? { devCode: code } : {};
}

/** Check a sign-in code. `limited` means too many guesses were made and this one was not looked at. */
export async function verifySignInCode(rawEmail: string, code: string): Promise<{ user: User | null; limited: boolean }> {
  const email = rawEmail.trim().toLowerCase();
  if (!(await allowed("try", email))) return { user: null, limited: true };
  const wrong = { user: null, limited: false };
  const db = await getDb();
  const now = new Date();
  const [latest] = await db
    .select({ id: s.otpCodes.id })
    .from(s.otpCodes)
    .where(and(eq(s.otpCodes.email, email), isNull(s.otpCodes.consumedAt), gt(s.otpCodes.expiresAt, now)))
    .orderBy(desc(s.otpCodes.createdAt))
    .limit(1);
  if (!latest) return wrong;

  // Count the guess before looking at it, in one statement: guesses that arrive together each use one of the code's attempts.
  const [claimed] = await db
    .update(s.otpCodes)
    .set({ attempts: sql`${s.otpCodes.attempts} + 1` })
    .where(and(eq(s.otpCodes.id, latest.id), lt(s.otpCodes.attempts, CODE_ATTEMPTS), isNull(s.otpCodes.consumedAt), gt(s.otpCodes.expiresAt, now)))
    .returning({ codeHash: s.otpCodes.codeHash });
  if (!claimed) return wrong;
  const given = Buffer.from(sha(`${email}:${code.trim()}`), "hex");
  const stored = Buffer.from(claimed.codeHash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return wrong;

  // A code opens one session: only the request that marks it used goes on.
  const [used] = await db
    .update(s.otpCodes)
    .set({ consumedAt: now })
    .where(and(eq(s.otpCodes.id, latest.id), isNull(s.otpCodes.consumedAt)))
    .returning({ id: s.otpCodes.id });
  if (!used) return wrong;
  const [user] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);
  return { user: user ?? null, limited: false };
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
