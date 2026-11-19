import { test, expect, watchPage, refused, ERROR_PAGE, IS_PROD, type Who } from "../guard";
import fs from "node:fs";
import path from "node:path";

/**
 * Sign in as an administrator, an instructor and a driver, and visit every page each can reach by
 * following links from the navigation. Each distinct page shape (ids collapsed, e.g.
 * /admin/roster/:id) is opened up to PER_SHAPE times per person. A page passes when it answers
 * < 400, renders a heading, shows no error page, logs no page errors or 5xx, and did not try to
 * write just by being opened. Links to files (PDFs, the roster CSV) are fetched and checked for the
 * right kind of file. New pages are picked up without changing this test.
 *
 * Sandbox only: signing in is a write, so on the live site these tests skip.
 *
 * With UAT_CAPTURE_DIR set, each page shape is also saved as a screenshot at desktop and phone
 * width, plus its visible text, for the design review to look at.
 */
const START: Record<"admin" | "instructor" | "driver", string[]> = {
  admin: ["/home", "/schedule", "/track", "/alerts", "/me", "/me/tech", "/me/waivers", "/instructor", "/more",
    "/admin", "/admin/roster", "/admin/schedule", "/admin/instructors", "/admin/tech", "/admin/tech/grid", "/admin/tech/shops", "/admin/waivers",
    "/admin/promotions", "/admin/announcements", "/admin/incidents", "/admin/incidents/new", "/admin/events", "/admin/settings",
    "/track/docs", "/track/flags", "/track/maps", "/track/passing", "/track/rules", "/track/turns"],
  instructor: ["/home", "/schedule", "/track", "/alerts", "/me", "/me/tech", "/me/waivers", "/instructor", "/more"],
  driver: ["/home", "/schedule", "/track", "/alerts", "/me", "/me/tech", "/me/waivers", "/more", "/track/docs", "/track/turns"],
};
const WHO: Record<keyof typeof START, Who> = { admin: "marian", instructor: "rosalind", driver: "owen" };
const PER_SHAPE = Number(process.env.UAT_PER_SHAPE ?? 2);
const MAX_PAGES = Number(process.env.UAT_MAX_PAGES ?? 160);
const CAPTURE = process.env.UAT_CAPTURE_DIR ?? "";
// Administrators work at a desk; instructors and drivers use their phones at the track.
const VIEWS = [["desktop", { width: 1440, height: 900 }, 2600], ["phone", { width: 375, height: 812 }, 3200]] as const;
const CAPTURE_VIEWS: Record<keyof typeof START, string[]> = { admin: ["desktop"], instructor: ["phone"], driver: ["phone"] };
const FILE = /\.(pdf|csv)$|^\/admin\/roster\/export$|^\/api\/files\//;
const KEEP_VALUE = new Set(["tab", "status", "view", "group", "day", "filter", "kind"]);
// A role that may not open a page is sent back to the Now screen or told so; neither is a failure for a driver.
const ADMIN_ONLY = /^\/admin(\/|$)/;

function shape(p: string): string {
  const u = new URL(p, "http://x");
  const segs = u.pathname.split("/").map((s) => (/^[0-9a-f-]{16,}$/i.test(s) || /^[A-Za-z0-9_-]{18,}$/.test(s) ? ":id" : s)).join("/");
  const keys = [...u.searchParams.keys()].sort().map((k) => (KEEP_VALUE.has(k) ? `${k}=${u.searchParams.get(k)}` : k)).join("&");
  return keys ? `${segs}?${keys}` : segs;
}
const slug = (s: string) => s.replace(/^\//, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";

// The first screen anyone sees has no signed-in crawl to capture it.
if (CAPTURE) test("capture the sign-in page for the design review", async ({ page }) => {
  fs.mkdirSync(CAPTURE, { recursive: true });
  await page.goto("/login");
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  fs.writeFileSync(path.join(CAPTURE, "signed-out-login.txt"), `URL: /login\nSigned in as: nobody\n\n${await page.locator("body").innerText()}\n`);
  for (const [label, vp, cap] of VIEWS) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(250);
    const full = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.screenshot({ path: path.join(CAPTURE, `signed-out-login-${label}.jpg`), type: "jpeg", quality: 55, fullPage: true, clip: { x: 0, y: 0, width: vp.width, height: Math.min(full, cap) } });
  }
});

for (const role of Object.keys(START) as (keyof typeof START)[]) {
  test(`crawl every page the ${role} can reach`, async ({ page, signIn, blocked, baseURL, context }) => {
    test.setTimeout(20 * 60_000);
    await signIn(WHO[role]);
    const origin = new URL(baseURL!).origin;
    const queue = [...START[role]];
    const seenUrl = new Set<string>();
    const perShape = new Map<string, number>();
    const results: { url: string; shape: string; status: number; ms: number; heading: string; problems: string[] }[] = [];
    const files: { url: string; status: number; type: string; bytes: number; ok: boolean }[] = [];
    const failures: string[] = [];

    while (queue.length && results.length < MAX_PAGES) {
      const next = queue.shift()!;
      if (seenUrl.has(next)) continue;
      seenUrl.add(next);
      if (refused(next)) continue;
      const pathname = new URL(next, "http://x").pathname;
      const sh = shape(next);
      if ((perShape.get(sh) ?? 0) >= PER_SHAPE) continue;
      perShape.set(sh, (perShape.get(sh) ?? 0) + 1);

      if (FILE.test(pathname)) {
        // Fetched with the browser's own cookies, as a click would be.
        const res = await context.request.get(next, { maxRedirects: 0 });
        const body = await res.body();
        const type = res.headers()["content-type"] ?? "";
        let ok = res.status() === 200 && body.length > 0;
        if (pathname.endsWith(".pdf")) ok &&= type.includes("pdf") && body.subarray(0, 4).toString() === "%PDF";
        if (pathname === "/admin/roster/export" || pathname.endsWith(".csv")) ok &&= type.includes("csv");
        files.push({ url: next, status: res.status(), type, bytes: body.length, ok });
        if (!ok) failures.push(`file ${next}: HTTP ${res.status()}, ${type}, ${body.length} bytes`);
        continue;
      }

      const problems = watchPage(page);
      const before = blocked.length;
      const t0 = Date.now();
      const resp = await page.goto(next, { waitUntil: "domcontentloaded" }).catch((e) => { problems.push(`navigation failed: ${(e as Error).message.split("\n")[0]}`); return null; });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      const status = resp?.status() ?? 0;
      const landed = new URL(page.url()).pathname;
      const heading = (await page.locator("h1").first().textContent({ timeout: 4_000 }).catch(() => ""))?.trim() ?? "";
      const body = await page.locator("body").innerText().catch(() => "");
      if (status >= 400 || status === 0) problems.push(`HTTP ${status}`);
      if (ERROR_PAGE.test(body)) problems.push("error page shown");
      if (!heading) problems.push("no heading");
      if (landed === "/login") problems.push("sent to sign-in while signed in");
      if (role !== "admin" && ADMIN_ONLY.test(landed)) problems.push("a non-administrator reached an administrator page");
      const wrote = blocked.slice(before);
      if (wrote.length) problems.push(`tried to write just by being opened: ${wrote.map((b) => `${b.method} ${new URL(b.url).pathname}`).join(", ")}`);
      results.push({ url: next, shape: sh, status, ms: Date.now() - t0, heading, problems: [...problems] });
      if (problems.length) failures.push(`${next}: ${problems.join("; ")}`);
      page.removeAllListeners("pageerror"); page.removeAllListeners("response");

      if (CAPTURE && perShape.get(sh) === 1) {
        fs.mkdirSync(CAPTURE, { recursive: true });
        const name = `${role}-${slug(sh)}`;
        fs.writeFileSync(path.join(CAPTURE, `${name}.txt`), `URL: ${next}\nSigned in as: ${role}\n\n${body}\n`);
        for (const [label, vp, cap] of VIEWS.filter(([label]) => CAPTURE_VIEWS[role].includes(label))) {
          await page.setViewportSize(vp);
          await page.waitForTimeout(250);
          const full = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.screenshot({ path: path.join(CAPTURE, `${name}-${label}.jpg`), type: "jpeg", quality: 55, fullPage: true, clip: { x: 0, y: 0, width: vp.width, height: Math.min(full, cap) } }).catch(() => {});
        }
        await page.setViewportSize({ width: 1280, height: 900 });
      }

      const links = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);
      for (const href of links) {
        let u: URL;
        try { u = new URL(href); } catch { continue; }
        if (u.origin !== origin) continue;
        if (/^\/(login|_next|api\/(?!files\/))/.test(u.pathname)) continue;
        const clean = u.pathname + u.search;
        if (!seenUrl.has(clean)) queue.push(clean);
      }
    }

    fs.mkdirSync(".work", { recursive: true });
    fs.writeFileSync(`.work/crawl-${process.env.UAT_PASS_NAME ?? "readonly"}-${role}.json`, JSON.stringify({ role, pages: results, files, failures }, null, 2));
    test.info().annotations.push({ type: "coverage", description: `${role}: ${results.length} pages across ${perShape.size} page shapes, ${files.length} files${IS_PROD ? " (live site)" : ""}` });
    const slow = results.filter((r) => r.ms > 8_000).map((r) => `${r.url} ${r.ms}ms`);
    if (slow.length) test.info().annotations.push({ type: "slow pages", description: slow.join(", ") });
    expect(results.length, "pages visited").toBeGreaterThanOrEqual(START[role].length - 1);
    if (role !== "instructor") expect(files.some((f) => f.type.includes("pdf")), "a PDF was checked").toBe(true);
    expect(failures, "pages or files that failed").toEqual([]);
  });
}
