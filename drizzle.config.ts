import { defineConfig } from "drizzle-kit";

// `npm run db:generate` only reads the schema and writes SQL into ./drizzle,
// so it needs no database connection. Migrations are applied by src/db/index.ts
// (local PGlite) or `npm run db:migrate` (hosted Postgres via DATABASE_URL).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
