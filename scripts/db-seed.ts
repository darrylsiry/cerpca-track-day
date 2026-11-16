/* Load the CERPCA demo data into an empty database (hosted or local). */
import { sql } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import { seed } from "../src/db/seed";

async function main() {
  const db = await getDb(); // a brand-new local database seeds itself here
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.organizations);
  if (n > 0) {
    console.log("Database already has data. Nothing seeded.");
  } else {
    await seed(db);
    console.log("Seeded the CERPCA demo data.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
