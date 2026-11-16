/* Throw away the local PGlite database. It is rebuilt and re-seeded on next start. */
import { rmSync } from "node:fs";
import path from "node:path";

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL is set. This script only resets the local PGlite database; it will not touch a hosted one.");
  process.exit(1);
}
const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}. Stop the dev server before running this, then start it again to rebuild the demo data.`);
