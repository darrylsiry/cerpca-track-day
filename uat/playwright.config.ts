import { defineConfig } from "@playwright/test";
import { isLocalUrl } from "./tests/local";

// Driven by scripts/uat.sh, which sets these. Never point UAT_MODE=sandbox at the live site: the
// sandbox suite writes (waivers, tech forms, schedule changes, pairings, promotions, incidents).
//   UAT_MODE      sandbox | readonly
//   UAT_BASE_URL  e.g. http://127.0.0.1:3960 or https://cerpca.siryous.app
//   UAT_PASS_NAME a label for the result files (sandbox, canary, prod, capture)
//   UAT_DB_URL    the sandbox's throwaway Postgres, for picking seeded records and for checks a user can't see
const mode = process.env.UAT_MODE ?? "readonly";
const baseURL = process.env.UAT_BASE_URL ?? "http://127.0.0.1:3960";
const name = process.env.UAT_PASS_NAME ?? mode;
// One tag per run, so record names are unique; workers inherit it, including after a failure restarts one.
process.env.UAT_TAG ??= Date.now().toString(36).slice(-6);
const isProd = !isLocalUrl(baseURL);

if (mode === "sandbox" && isProd) {
  throw new Error(`Refusing to run the sandbox (writing) suite against ${baseURL}: it only runs against a local sandbox.`);
}

export default defineConfig({
  testDir: mode === "sandbox" ? "tests/sandbox" : "tests/readonly",
  outputDir: `.work/artifacts-${name}`,
  fullyParallel: false,
  workers: 1,                       // flows share one seeded database, in file order
  retries: isProd ? 1 : 0,          // the live database sleeps when idle, so a first request can be slow
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: `.work/results-${name}.json` }],
  ],
  use: {
    baseURL,
    headless: true,
    serviceWorkers: "block",        // nothing may bypass the write guard's network interception
    screenshot: "only-on-failure",
    trace: isProd ? "off" : "retain-on-failure",
    acceptDownloads: true,
    timezoneId: "America/New_York", // the track's time zone; the server itself runs on UTC, as on Vercel
    actionTimeout: 20_000,
    viewport: { width: 1280, height: 900 },
  },
});
