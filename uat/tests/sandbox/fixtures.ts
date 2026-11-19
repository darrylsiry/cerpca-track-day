import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { isLocalDb, isLocalUrl } from "../local";

// The sandbox (writing) suite. Runs only against the local sandbox that scripts/uat.sh builds:
// playwright.config.ts and the check below refuse anything else. Flows share one freshly seeded
// database and run in file order. Assertions state what a user should see: when the app misbehaves
// the test fails, on purpose.

export const BASE = process.env.UAT_BASE_URL ?? "http://127.0.0.1:3960";
if (!isLocalUrl(BASE)) throw new Error(`The sandbox suite only runs against a local sandbox, not ${BASE}`);

/** The sample people on the sign-in screen (src/db/seed.ts DEMO_PERSONAS). Demo mode signs them in with one tap. */
export const PEOPLE = {
  marian: { name: "Marian Castellanos", email: "marian.castellanos@example.com" },      // administrator, event chair, instructor
  hank: { name: "Hank Odom", email: "hank.odom@example.com" },                          // administrator, chief tech inspector, Black group
  rosalind: { name: "Rosalind Achterberg", email: "rosalind.achterberg@example.com" },  // instructor with two students and a check-in
  owen: { name: "Owen Gallagher", email: "owen.gallagher@example.com" },                // Green group, first track day
  tessa: { name: "Tessa Nakamura", email: "tessa.nakamura@example.com" },               // Green group, paperwork still open
  simone: { name: "Simone Baptiste", email: "simone.baptiste@example.com" },            // Blue group, instructed
  arjun: { name: "Arjun Mehta", email: "arjun.mehta@example.com" },                     // White group, solo
} as const;
export type Who = keyof typeof PEOPLE;

/** The secret scripts/uat.sh gives the sandbox for /api/cron/*. It protects nothing real. */
export const CRON_SECRET = "uat-sandbox-cron-secret";

/** A tag fixed for the whole run (see playwright.config.ts), for records that later tests look up. */
export const T = process.env.UAT_TAG ?? "local";
/** A short tag unique to this call. */
export const tag = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).slice(-7);

// ───── the database, for picking seeded records to work on and for checks a user can't see

const DB_URL = process.env.UAT_DB_URL ?? "postgres://postgres@127.0.0.1:54360/trackday_uat";
if (!isLocalDb(DB_URL)) throw new Error("The sandbox suite only reads a local throwaway database.");

/** Rows of a query in the sandbox database, each row an array of strings. */
export function sql(query: string): string[][] {
  const out = execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-tA", "-F", "\t", "-c", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.split("\n").filter((l) => l.length).map((l) => l.split("\t"));
}
/** The first value of the first row. */
export function val(query: string): string { return sql(query)[0]?.[0] ?? ""; }
/** A sample person's user id. */
export const userId = (who: Who) => val(`select id from users where email = '${PEOPLE[who].email}'`);

// ───── pages

/** Tap a sample account on the sign-in screen and wait for the Now screen. */
export async function signIn(page: Page, who: Who) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(PEOPLE[who].name) }).click();
  await page.waitForURL("**/home", { timeout: 30_000 });
}

/** Collect page errors and 5xx responses from this page from now on. */
export function watchPage(page: Page, problems: string[] = []): string[] {
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  return problems;
}

/** A fresh browser for one person, never leaving the sandbox. Confirm dialogs are accepted. */
export async function openBrowser(browser: Browser, problems: string[], opts: { viewport?: { width: number; height: number } } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: BASE, timezoneId: "America/New_York", acceptDownloads: true, serviceWorkers: "block", viewport: opts.viewport ?? { width: 1280, height: 900 } });
  const origin = new URL(BASE).origin;
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    return u.origin !== origin || /^\/admin\/app-tests(\/|$)/.test(u.pathname) ? r.abort("blockedbyclient") : r.continue();
  });
  ctx.on("page", (p) => { watchPage(p, problems); p.on("dialog", (d) => d.accept().catch(() => {})); });
  return ctx;
}

type Fixtures = {
  /** Page errors and 5xx responses seen by any page in this test. A test fails if any are left at the end. */
  problems: string[];
  /** A signed-in page for a sample person, in their own browser so several people can act in one test. */
  as: (who: Who, opts?: { phone?: boolean }) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  problems: async ({}, use) => {
    const problems: string[] = [];
    await use(problems);
    expect(problems, "page errors or server errors during this test").toEqual([]);
  },
  page: async ({ page, problems }, use) => {
    watchPage(page, problems);
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await use(page);
  },
  as: async ({ browser, problems }, use) => {
    const open: BrowserContext[] = [];
    await use(async (who, opts) => {
      const ctx = await openBrowser(browser, problems, opts?.phone ? { viewport: { width: 375, height: 812 } } : {});
      open.push(ctx);
      const page = await ctx.newPage();
      await signIn(page, who);
      return page;
    });
    for (const ctx of open) await ctx.close();
  },
});

export { expect };

/** What the framework shows when a page throws or does not exist. */
export const ERROR_PAGE = /This page couldn.t load|Application error|Internal Server Error|This page could not be found|404: This page/i;

/** Save something a later test needs, e.g. the id of a record this flow made. */
const STATE = ".work/sandbox-state.json";
export function readState(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; }
}
export function saveState(patch: Record<string, string | number>) {
  fs.mkdirSync(".work", { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ ...readState(), ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])) }, null, 2));
}
/** A record an earlier flow made; this test skips if that flow didn't get that far. */
export function need(key: string): string {
  const v = readState()[key];
  if (!v) base.skip(true, `needs ${key} from an earlier flow, which did not complete`);
  return v!;
}
