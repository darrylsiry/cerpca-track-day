import { mkdirSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

/**
 * One Postgres schema, two ways to run it:
 *
 *  - DATABASE_URL set  → a hosted Postgres (Neon, Supabase, RDS…) through `pg`.
 *                         This is what Vercel uses.
 *  - DATABASE_URL unset → PGlite, real Postgres compiled to WASM, stored in
 *                         ./.data/pglite. Zero setup for local development; it
 *                         migrates and seeds itself on first run.
 *
 * Both drivers expose the same query builder, so the rest of the app is typed
 * against one of them.
 */
export type DB = PgliteDatabase<typeof schema>;

const globalStore = globalThis as unknown as { __trackdayDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  if (!globalStore.__trackdayDb) {
    globalStore.__trackdayDb = connect().catch((err) => {
      globalStore.__trackdayDb = undefined;
      throw err;
    });
  }
  return globalStore.__trackdayDb;
}

export const usingHostedDb = () => Boolean(process.env.DATABASE_URL);

/**
 * Hosted Postgres URLs usually say `sslmode=require`. The `pg` driver verifies the
 * server certificate fully for that today, and warns on every start that a future
 * version will not. Asking for `verify-full` by name keeps the strict check and
 * stops the warning, which Vercel would otherwise log as an error on each cold start.
 */
export const pinSslMode = (url: string) => url.replace(/([?&]sslmode=)(prefer|require|verify-ca)\b/, "$1verify-full");

async function connect(): Promise<DB> {
  const migrationsFolder = path.join(process.cwd(), "drizzle");

  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: pinSslMode(process.env.DATABASE_URL), max: 5 });
    return drizzle(pool, { schema }) as unknown as DB;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.organizations);
  if (n === 0) {
    const { seed } = await import("./seed");
    await seed(db);
    console.log("[db] Local database created and seeded with the CERPCA demo event.");
  }
  return db;
}

export { schema };
