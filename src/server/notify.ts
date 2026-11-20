import { eq, inArray } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import type { Channel } from "@/lib/types";

/*
 * One place that knows how to reach people.
 *
 *  in-app  always works: rows in `notifications`, shown in the Alerts tab.
 *  email   Resend, when RESEND_API_KEY and EMAIL_FROM are set.
 *  text    Twilio, when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are set.
 *  push    Web Push, when the VAPID keys are set and the person enabled it on a device.
 *
 * A channel with no provider configured is recorded as "simulated" in the
 * delivery log instead of being sent, so the whole flow can be exercised locally.
 */

export type DeliveryStatus = "sent" | "simulated" | "failed";

export function channelStatus() {
  return {
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
    push: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  };
}

async function log(row: typeof s.messageLog.$inferInsert) {
  try {
    const db = await getDb();
    await db.insert(s.messageLog).values(row);
  } catch (err) {
    console.error("[notify] could not write delivery log", err);
  }
}

export async function sendEmail(input: {
  to: string;
  /** Always kept in the delivery log, which administrators read: never put a code, link or other secret in it. */
  subject: string;
  text: string;
  userId?: string | null;
  eventId?: string | null;
  kind?: string;
  /** Keep secrets (sign-in codes, shop links) out of the delivery log. */
  redactBody?: boolean;
}): Promise<DeliveryStatus> {
  let status: DeliveryStatus = "simulated";
  let error: string | null = null;
  if (channelStatus().email) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [input.to], subject: input.subject, text: input.text }),
      });
      status = res.ok ? "sent" : "failed";
      if (!res.ok) error = `${res.status} ${(await res.text()).slice(0, 300)}`;
    } catch (err) {
      status = "failed";
      error = String(err).slice(0, 300);
    }
  }
  await log({
    userId: input.userId ?? null,
    eventId: input.eventId ?? null,
    channel: "email",
    toAddress: input.to,
    subject: input.subject,
    body: input.redactBody ? "(contents withheld from the log)" : input.text,
    status,
    provider: status === "simulated" ? null : "resend",
    error,
    kind: input.kind ?? null,
  });
  return status;
}

function e164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.trim().startsWith("+") && digits.length >= 8 ? `+${digits}` : null;
}

export async function sendSms(input: { to: string; body: string; userId?: string | null; eventId?: string | null; kind?: string }): Promise<DeliveryStatus> {
  let status: DeliveryStatus = "simulated";
  let error: string | null = null;
  const to = e164(input.to);
  if (!to) {
    status = "failed";
    error = "Not a valid mobile number";
  } else if (channelStatus().sms) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: input.body }),
      });
      status = res.ok ? "sent" : "failed";
      if (!res.ok) error = `${res.status} ${(await res.text()).slice(0, 300)}`;
    } catch (err) {
      status = "failed";
      error = String(err).slice(0, 300);
    }
  }
  await log({
    userId: input.userId ?? null,
    eventId: input.eventId ?? null,
    channel: "sms",
    toAddress: input.to,
    body: input.body,
    status,
    provider: status === "simulated" ? null : "twilio",
    error,
    kind: input.kind ?? null,
  });
  return status;
}

type PushPayload = { title: string; body: string; href?: string; tag?: string };

async function sendPushToUsers(userIds: string[], payload: PushPayload, meta: { eventId?: string | null; kind?: string }) {
  if (!userIds.length) return 0;
  const db = await getDb();
  const subs = await db.select().from(s.pushSubscriptions).where(inArray(s.pushSubscriptions.userId, userIds));
  if (!subs.length) return 0;
  const configured = channelStatus().push;
  let delivered = 0;
  let webpush: typeof import("web-push") | null = null;
  if (configured) {
    webpush = (await import("web-push")).default;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  }
  await Promise.all(
    subs.map(async (sub) => {
      let status: DeliveryStatus = "simulated";
      let error: string | null = null;
      if (webpush) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 600, urgency: "high" });
          status = "sent";
          delivered += 1;
        } catch (err) {
          status = "failed";
          const code = (err as { statusCode?: number }).statusCode;
          error = `${code ?? ""} ${String((err as Error).message ?? err)}`.slice(0, 300);
          // 404/410: the browser dropped this subscription. Forget it.
          if (code === 404 || code === 410) await db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.id, sub.id));
        }
      }
      await log({
        userId: sub.userId,
        eventId: meta.eventId ?? null,
        channel: "push",
        toAddress: new URL(sub.endpoint).host,
        subject: payload.title,
        body: payload.body,
        status,
        provider: status === "simulated" ? null : "webpush",
        error,
        kind: meta.kind ?? null,
      });
    }),
  );
  return delivered;
}

/**
 * Deliver one message to a set of people over the chosen channels,
 * respecting each person's own notification settings.
 */
export async function notifyUsers(input: {
  userIds: string[];
  title: string;
  body: string;
  href?: string;
  kind: string;
  eventId?: string | null;
  announcementId?: string | null;
  urgent?: boolean;
  channels: Channel[];
}): Promise<{ recipients: number }> {
  const ids = [...new Set(input.userIds)];
  if (!ids.length) return { recipients: 0 };
  const db = await getDb();
  const people = await db.select().from(s.users).where(inArray(s.users.id, ids));

  if (input.channels.includes("inapp")) {
    await db.insert(s.notifications).values(
      people.map((p) => ({
        userId: p.id,
        eventId: input.eventId ?? null,
        announcementId: input.announcementId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body,
        href: input.href ?? null,
        urgent: Boolean(input.urgent),
      })),
    );
  }

  const jobs: Promise<unknown>[] = [];
  if (input.channels.includes("email")) {
    for (const p of people.filter((x) => x.notifyEmail)) {
      jobs.push(sendEmail({ to: p.email, subject: input.title, text: input.body, userId: p.id, eventId: input.eventId, kind: input.kind }));
    }
  }
  if (input.channels.includes("sms")) {
    for (const p of people.filter((x) => x.notifySms && x.phone)) {
      jobs.push(sendSms({ to: p.phone!, body: `${input.title}: ${input.body}`.slice(0, 300), userId: p.id, eventId: input.eventId, kind: input.kind }));
    }
  }
  if (input.channels.includes("push")) {
    jobs.push(
      sendPushToUsers(
        people.filter((x) => x.notifyPush).map((x) => x.id),
        { title: input.title, body: input.body, href: input.href, tag: input.kind },
        { eventId: input.eventId, kind: input.kind },
      ),
    );
  }
  await Promise.allSettled(jobs);
  return { recipients: people.length };
}
