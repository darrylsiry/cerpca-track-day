/*
 * In production, Vercel Cron calls /api/cron/reminders every minute.
 * `next dev` has no cron, so this starts an in-process timer that does the same
 * job, which keeps "15 / 10 / 5 minutes before your session" testable locally.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") return;
  const store = globalThis as unknown as { __trackdayReminderTimer?: ReturnType<typeof setInterval> };
  if (store.__trackdayReminderTimer) return;
  store.__trackdayReminderTimer = setInterval(async () => {
    try {
      const { runReminders } = await import("@/server/reminders");
      const result = await runReminders();
      if (result.reminders) console.log(`[reminders] sent ${result.reminders} reminder(s) to ${result.recipients} recipient(s)`);
    } catch (err) {
      console.error("[reminders]", err);
    }
  }, 30_000);
}
