import { lt, sql } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import { sha256 } from "./util";

/**
 * Count one use of something and say whether it is still within its limit.
 *
 * Counting is a single statement (insert, or add one on conflict), so requests
 * that arrive together each take their own place in the count: none of them
 * can read an old total and slip past. Windows are fixed (for example each
 * quarter hour), which is simple and good enough to stop guessing at scale.
 *
 * `subject` is the email or network address being limited. Only a hash of it
 * is stored.
 */
export async function withinLimit(name: string, subject: string, limit: number, windowMinutes: number, now = new Date()): Promise<boolean> {
  const db = await getDb();
  const windowMs = windowMinutes * 60_000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = `${name}:${sha256(subject).slice(0, 40)}`;
  const [row] = await db
    .insert(s.rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [s.rateLimits.key, s.rateLimits.windowStart], set: { count: sql`${s.rateLimits.count} + 1` } })
    .returning({ count: s.rateLimits.count });
  // The first use in a window is a cheap moment to drop windows that ended long ago.
  if (row.count === 1) await db.delete(s.rateLimits).where(lt(s.rateLimits.windowStart, new Date(now.getTime() - 86_400_000)));
  return row.count <= limit;
}
