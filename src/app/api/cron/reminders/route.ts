import { NextResponse, type NextRequest } from "next/server";
import { runReminders } from "@/server/reminders";

export const maxDuration = 60;

/*
 * A hosted database that scales to zero (Neon's free plan sleeps after five idle
 * minutes) never sleeps if this job queries it every minute, and a month of
 * that uses up the plan's compute. So when no event is running today, the job
 * leaves the database alone for a while. The cost: an event published for the
 * same day can wait up to QUIET_MS for its first reminder. On event days the
 * job runs every minute as usual.
 *
 * The timestamp lives in module memory, which a warm function instance keeps
 * between calls; a cold start simply checks the database once more.
 */
const QUIET_MS = 30 * 60_000;
let quietUntil = 0;

/**
 * Called once a minute by Vercel Cron (see vercel.json), which sends
 * `Authorization: Bearer <CRON_SECRET>` when that environment variable is set.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (Date.now() < quietUntil) {
    return NextResponse.json({ ok: true, skipped: "No event today; checking again shortly." });
  }
  const result = await runReminders();
  quietUntil = result.events === 0 ? Date.now() + QUIET_MS : 0;
  return NextResponse.json({ ok: true, ...result });
}
