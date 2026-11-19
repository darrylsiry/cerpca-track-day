import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import { isLocalUrl } from "./local";

/**
 * The read-only fixture: every test under tests/readonly uses `test` from here.
 *
 * The live site is protected in three layers, so no single mistake in a test can write to it:
 *  1. The browser: every request leaving the page goes through `context.route`. GET, HEAD and
 *     OPTIONS pass. Anything else is aborted before it leaves the machine and logged as a "blocked
 *     write". Next Server Actions are POSTs, so every button that changes something lands here.
 *  2. The API client: the `anon` fixture only has get(). The raw `request`, `page.request` and
 *     `context.request` objects, which bypass routing, throw on any non-GET call.
 *  3. scripts/uat.sh refuses to start the read-only suite if a spec file calls post/put/patch/delete/
 *     fetch directly, or touches the email sign-in form.
 *
 * Signing in: the app has no password. On the sandbox only, a read-only test may tap a sample account
 * on the sign-in screen, which is one Server Action POST to /login that adds a row to `sessions`
 * (left out of the canary's fingerprint). On the live site that POST is blocked like any other, so
 * only the signed-out (@public) checks run there.
 *
 * Also refused here:
 *  - Any URL under /admin/app-tests, in every pass and for every method: if this app ever shows the
 *    review reports there, this suite must stay independent of them.
 *  - Any request to another host.
 */

export const BASE = process.env.UAT_BASE_URL ?? "http://127.0.0.1:3960";
export const IS_PROD = !isLocalUrl(BASE);
const BLOCKED_LOG = `.work/blocked-${process.env.UAT_PASS_NAME ?? "readonly"}.jsonl`;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const NEVER_OPEN = /^\/admin\/app-tests(\/|$)/;

/** The sample people on the sign-in screen (src/db/seed.ts DEMO_PERSONAS). */
export const PEOPLE = {
  marian: "Marian Castellanos",     // administrator, event chair, instructor
  hank: "Hank Odom",                // administrator, chief tech inspector, Black group
  rosalind: "Rosalind Achterberg",  // instructor with two students and a check-in
  owen: "Owen Gallagher",           // Green group, first track day
  tessa: "Tessa Nakamura",          // Green group, paperwork still open
  simone: "Simone Baptiste",        // Blue group, instructed
  arjun: "Arjun Mehta",             // White group, solo
} as const;
export type Who = keyof typeof PEOPLE;

/** Why this path may not be opened, or null when it may. */
export function refused(path: string): string | null {
  const p = new URL(path, "http://x").pathname;
  if (NEVER_OPEN.test(p)) return "never opened in any pass";
  return null;
}

export type Blocked = { method: string; url: string; action: string | null; test: string; at: string };

function logBlocked(entry: Blocked) {
  fs.mkdirSync(".work", { recursive: true });
  fs.appendFileSync(BLOCKED_LOG, JSON.stringify(entry) + "\n");
}

async function guardContext(context: BrowserContext, origin: string, blocked: Blocked[], testTitle: string, allowSignIn: () => boolean) {
  await context.route("**/*", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin !== origin) return route.abort("blockedbyclient");
    const why = refused(u.pathname);
    const signIn = !IS_PROD && allowSignIn() && req.method() === "POST" && u.pathname === "/login";
    if (why || (!SAFE_METHODS.has(req.method()) && !signIn)) {
      const entry: Blocked = { method: req.method(), url: req.url(), action: req.headers()["next-action"] ?? null, test: testTitle, at: new Date().toISOString() };
      if (!why) blocked.push(entry);
      logBlocked(entry);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  // Close the side doors: this client does not go through context.route.
  lockToGet(context.request, "context.request");
}

function lockToGet(client: APIRequestContext, name: string) {
  for (const m of ["post", "put", "patch", "delete"] as const) {
    (client as unknown as Record<string, unknown>)[m] = () => { throw new Error(`UAT read-only mode: ${name}.${m}() is not allowed`); };
  }
  const fetchFn = client.fetch.bind(client);
  (client as unknown as Record<string, unknown>).fetch = (url: string, opts?: { method?: string }) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (!SAFE_METHODS.has(method)) throw new Error(`UAT read-only mode: ${name}.fetch(${method}) is not allowed`);
    return fetchFn(url, opts);
  };
}

export type SafeApi = { get: APIRequestContext["get"] };

function safeApi(ctx: APIRequestContext): SafeApi {
  return {
    get: (url, opts) => {
      const why = refused(url);
      if (why) throw new Error(`UAT read-only mode: GET ${url} refused: ${why}`);
      return ctx.get(url, opts);
    },
  };
}

type Fixtures = {
  blocked: Blocked[];
  anon: SafeApi;
  /** Tap a sample account on the sign-in screen. Sandbox only; skips the test on the live site. */
  signIn: (who: Who) => Promise<void>;
};

export const test = base.extend<Fixtures & { _signInOpen: { open: boolean } }>({
  blocked: async ({}, use) => use([]),
  _signInOpen: async ({}, use) => use({ open: false }),
  context: async ({ context, baseURL, blocked, _signInOpen }, use, info) => {
    await guardContext(context, new URL(baseURL!).origin, blocked, info.titlePath.slice(1).join(" › "), () => _signInOpen.open);
    await use(context);
  },
  page: async ({ page }, use) => {
    lockToGet(page.request, "page.request");
    await use(page);
  },
  request: async ({ request }, use) => {
    lockToGet(request, "request");
    await use(request);
  },
  anon: async ({ playwright, baseURL }, use) => {
    const ctx = await playwright.request.newContext({ baseURL });
    await use(safeApi(ctx));
    await ctx.dispose();
  },
  signIn: async ({ page, _signInOpen }, use) => {
    await use(async (who) => {
      base.skip(IS_PROD, "signing in is a write, so it never happens on the live site");
      await page.goto("/login");
      _signInOpen.open = true;   // the one write a read-only pass makes, and only on the sandbox
      try {
        await page.getByRole("button", { name: new RegExp(PEOPLE[who]) }).click();
        await page.waitForURL("**/home", { timeout: 30_000 });
      } finally {
        _signInOpen.open = false;
      }
    });
  },
});

export { expect };

/** Collect page errors and 5xx responses from this page from now on. */
export function watchPage(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  return problems;
}

/** What the framework shows when a page throws or does not exist. */
export const ERROR_PAGE = /This page couldn.t load|Application error|Internal Server Error|This page could not be found|404: This page/i;
