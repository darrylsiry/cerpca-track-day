/* Apply SQL migrations to the hosted Postgres named by DATABASE_URL. */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { pinSslMode } from "../src/db";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL is not set. The local PGlite database migrates itself on startup, so there is nothing to do.");
    return;
  }
  const pool = new Pool({ connectionString: pinSslMode(process.env.DATABASE_URL) });
  await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
