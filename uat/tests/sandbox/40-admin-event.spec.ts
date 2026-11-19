import type { BrowserContext, Locator, Page } from "@playwright/test";
import fs from "node:fs";
import { test as base, expect, signIn, sql, val, openBrowser, PEOPLE, T, CRON_SECRET } from "./fixtures";

// Running the event as an administrator: the overview, the roster, the schedule editor, session
// reminders, announcements, events and history, settings and the simulated clock.
//
// House rules for this file:
//  - Tessa Nakamura, Arjun Mehta and Owen Gallagher belong to the driver flows, so nobody here
//    edits them. Drivers to work on are picked from the seeded roster at run time.
//  - The seeded sessions stay as they are. Schedule tests add their own late-evening items
//    (named "UAT …") and only move, cancel or delete those.
//  - Anything changed in Settings is put back before the test ends.

// ───── helpers

const PROTECTED: string[] = [PEOPLE.tessa.email, PEOPLE.arjun.email, PEOPLE.owen.email];
const q = (v: string) => v.replace(/'/g, "''");
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The event everyone is working on: the seeded "Fall Driver Education" on the coming weekend. */
const event = () => {
  const [row] = sql(`select id, name, start_date, end_date from events where slug = 'fall-de'`);
  return { id: row[0], name: row[1], start: row[2], end: row[3] };
};
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const longDate = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const monthDay = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));

type Person = { id: string; first: string; last: string; name: string; email: string; regId: string; car: string; group: string; solo: boolean };
/** People registered for the event (never the three who belong to the driver flows), filtered by a SQL condition. */
function roster(where = "true", order = "u.last_name, u.first_name"): Person[] {
  return sql(
    `select u.id, u.first_name, u.last_name, u.email, r.id, coalesce(r.car_number, ''), g.name, r.solo
       from registrations r
       join users u on u.id = r.user_id
       join run_groups g on g.id = r.run_group_id
       join memberships m on m.user_id = u.id
      where r.event_id = '${event().id}' and r.status <> 'cancelled'
        and u.email not in (${PROTECTED.map((e) => `'${e}'`).join(",")})
        and (${where})
      order by ${order}`,
  ).map((r) => ({ id: r[0], first: r[1], last: r[2], name: `${r[1]} ${r[2]}`, email: r[3], regId: r[4], car: r[5], group: r[6], solo: r[7] === "t" }));
}
/** Drivers who are neither administrators nor instructors. */
const drivers = (where = "true", order?: string) => roster(`not m.is_admin and not m.is_instructor and not r.is_instructor and (${where})`, order);
const count = (query: string) => Number(val(query));
const registered = () => count(`select count(*) from registrations where event_id = '${event().id}' and status <> 'cancelled'`);

/** Sign in the way a member without a sample-account button does: the emailed one-time code (shown on screen in demo mode). */
async function signInWithCode(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /Email me a code/ }).click();
  const notice = page.getByText(/Your code is/);
  await expect(notice).toBeVisible();
  const code = ((await notice.textContent()) ?? "").match(/\d{6}/)?.[0] ?? "";
  await page.getByLabel("Sign-in code").fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/home", { timeout: 30_000 });
}

// One sign-in per person per run. The session cookie is kept in a file named after the run, so it is shared by
// both administrator spec files and survives a worker restart: nobody is asked for more one-time codes than the
// app allows in a quarter of an hour.
type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const SESSIONS = `.work/admin-sessions-${T}.json`;
const knownSessions = (): Record<string, Cookies> => {
  try { return JSON.parse(fs.readFileSync(SESSIONS, "utf8")); } catch { return {}; }
};
function rememberSession(email: string, cookies: Cookies) {
  fs.mkdirSync(".work", { recursive: true });
  fs.writeFileSync(SESSIONS, JSON.stringify({ ...knownSessions(), [email]: cookies.filter((c) => c.name === "td_session") }));
}

const test = base.extend<{ asEmail: (email: string) => Promise<Page> }>({
  /** A signed-in page for any seeded person, by email, in their own browser. */
  asEmail: async ({ browser, problems }, use) => {
    const open: BrowserContext[] = [];
    await use(async (email) => {
      const ctx = await openBrowser(browser, problems);
      open.push(ctx);
      const page = await ctx.newPage();
      const known = knownSessions()[email];
      if (known?.length) {
        await ctx.addCookies(known);
        await page.goto("/home");
      }
      if (!known?.length || new URL(page.url()).pathname !== "/home") {
        await signInWithCode(page, email);
        rememberSession(email, await ctx.cookies());
      }
      await expect(page.locator("main h1").filter({ visible: true }).first()).toBeVisible();
      return page;
    });
    for (const ctx of open) await ctx.close();
  },
});

/**
 * Open a screen and wait until its content has arrived. Every screen paints a grey placeholder first and
 * streams the real content in, so a check that something is absent must not run until the heading is there.
 */
async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main h1").filter({ visible: true }).first()).toBeVisible();
}

/** The open sheet (a dialog on desktop). */
const sheet = (page: Page) => page.getByRole("dialog");
/** A brief confirmation at the bottom of the screen. */
const toast = (page: Page, text: string | RegExp) => page.locator("[aria-live='polite']").getByText(text).first();
/** Remember what the next confirm box asked. The fixture accepts it. */
function nextConfirm(page: Page): { text: string } {
  const seen = { text: "" };
  page.once("dialog", (d) => { seen.text = d.message(); });
  return seen;
}
/** Tap one of the pill-shaped choices (the real radio or checkbox sits hidden inside its label). */
const pick = (input: Locator) => input.locator("xpath=ancestor::label[1]").click();
/** A person's row in the roster table. */
const rosterRow = (page: Page, p: Pick<Person, "first" | "last">) => page.getByRole("row").filter({ has: page.getByRole("link", { name: `${p.last}, ${p.first}`, exact: true }) });
/** The value beside a label in a details list ("Attending: Both days"). */
const detail = (scope: Page | Locator, label: string) => scope.locator("dt").filter({ hasText: new RegExp(`^${esc(label)}$`) }).filter({ visible: true }).locator("xpath=following-sibling::dd[1]");
/** A page section by its small heading. */
const section = (page: Page, heading: string | RegExp) => page.locator("section").filter({ has: page.getByRole("heading", { name: heading }) }).filter({ visible: true });
/** The title block at the top of the screen. (After following a link the previous screen can linger, hidden, so only the visible one counts.) */
const pageHeader = (page: Page) => page.locator("main header").filter({ visible: true }).first();

/** Record the request a Server Action makes, so a test can check that someone without the role cannot replay it. */
async function captureAction(page: Page, trigger: () => Promise<unknown>) {
  const [req] = await Promise.all([page.waitForRequest((r) => r.method() === "POST" && Boolean(r.headers()["next-action"])), trigger()]);
  const h = await req.allHeaders();
  return { url: req.url(), body: req.postDataBuffer() ?? Buffer.from(""), headers: { "next-action": h["next-action"], "content-type": h["content-type"], accept: h["accept"] ?? "text/x-component", origin: new URL(req.url()).origin } };
}
type Captured = Awaited<ReturnType<typeof captureAction>>;
const replay = (as: Page, a: Captured) => as.context().request.post(a.url, { headers: a.headers, data: a.body, maxRedirects: 0, failOnStatusCode: false });

const ADMIN_PAGES = [
  "/admin",
  "/admin/roster",
  "/admin/schedule",
  "/admin/announcements",
  "/admin/announcements?tab=log",
  "/admin/events",
  "/admin/settings",
  "/admin/instructors",
  "/admin/promotions",
];

// ───── who may use the administrator area

test.describe("administrator area: who may use it", () => {
  test("a driver and an instructor are turned away from every administrator page", async ({ as }) => {
    const anyone = roster("true")[0];
    for (const who of ["simone", "rosalind"] as const) {
      const page = await as(who);
      // Neither of them is offered the "Run the event" menu.
      await expect(page.getByRole("navigation", { name: "Main" }).first()).not.toContainText("Roster");
      for (const path of [...ADMIN_PAGES, `/admin/roster/${anyone.id}`]) {
        await go(page, path);
        await page.waitForURL("**/home");
        await expect(page.locator("body"), `${who} at ${path}`).not.toContainText(anyone.email);
      }
      // The roster download is refused outright, not served as a file.
      const csv = await page.context().request.get("/admin/roster/export", { maxRedirects: 0 });
      expect(csv.status(), `${who} asking for the roster file`).toBe(403);
      expect(await csv.text()).not.toContain(anyone.email);
    }
  });

  test("a driver or instructor cannot replay an administrator's actions", async ({ page, as }) => {
    const target = drivers("r.checked_in_at is null")[0];
    await signIn(page, "marian");
    await go(page, "/admin/roster");
    await page.getByRole("searchbox").fill(target.name);
    // Marian checks someone in (recording what her browser sent) and then undoes it.
    const checkIn = await captureAction(page, () => rosterRow(page, target).getByRole("button", { name: "Check in" }).click());
    await rosterRow(page, target).getByRole("button", { name: `Undo check-in for ${target.name}` }).click();
    await expect(rosterRow(page, target).getByRole("button", { name: "Check in" })).toBeVisible();

    // She also sends a note to the administrators only, again recording the request.
    const title = `UAT ${T} replay check`;
    await go(page, "/admin/announcements");
    await pick(page.getByRole("radio", { name: /^Administrators/ }));
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await page.getByRole("textbox", { name: "Message" }).fill("Sent once by an administrator. A replay by anyone else must not send it again.");
    const announce = await captureAction(page, () => page.getByRole("button", { name: /^Send to/ }).click());
    await expect(toast(page, /^Sent to \d+ (person|people)$/)).toBeVisible();
    expect(count(`select count(*) from announcements where title = '${q(title)}'`)).toBe(1);

    // First prove the recording is good: replayed from Marian's own browser it does check the person in.
    await replay(page, checkIn);
    expect(val(`select checked_in_at is not null from registrations where id = '${target.regId}'`), "the recorded request works for an administrator").toBe("t");
    await go(page, "/admin/roster");
    await page.getByRole("searchbox").fill(target.name);
    await rosterRow(page, target).getByRole("button", { name: `Undo check-in for ${target.name}` }).click();
    await expect(rosterRow(page, target).getByRole("button", { name: "Check in" })).toBeVisible();

    // The same two requests, sent from a driver's and an instructor's browser, change nothing.
    for (const who of ["simone", "rosalind"] as const) {
      const other = await as(who);
      const a = await replay(other, checkIn);
      expect(a.status(), `${who} replaying a check-in`).toBeLessThan(500);
      expect(val(`select checked_in_at is null from registrations where id = '${target.regId}'`), `${target.name} is still not checked in after ${who} replayed the check-in`).toBe("t");
      const b = await replay(other, announce);
      expect(b.status(), `${who} replaying an announcement`).toBeLessThan(500);
      expect(count(`select count(*) from announcements where title = '${q(title)}'`), `announcements titled "${title}" after ${who} replayed the send`).toBe(1);
    }
  });
});

// ───── overview

test.describe("overview", () => {
  test("the overview counts match the roster, paperwork and run groups", async ({ page }) => {
    const e = event();
    const on = `r.event_id = '${e.id}' and r.status <> 'cancelled'`;
    const total = registered();
    const instructing = count(`select count(*) from registrations r where ${on} and r.is_instructor`);
    const checkedIn = count(`select count(*) from registrations r where ${on} and r.checked_in_at is not null`);
    const tech = (cond: string) => count(`select count(*) from registrations r join tech_inspections t on t.event_id = r.event_id and t.user_id = r.user_id where ${on} and ${cond}`);
    const stickers = tech("t.sticker_issued_at is not null");
    const approved = tech("t.status = 'approved'");
    const toReview = tech("t.status = 'submitted'");
    // Someone's waivers are done when every required document in use has their signature on its current version.
    const waiversDoneSql = `not exists (select 1 from waiver_templates w where w.active and w.required and not exists (select 1 from waiver_signatures s where s.template_id = w.id and s.event_id = r.event_id and s.user_id = r.user_id and s.template_version >= w.version))`;
    const waiversDone = count(`select count(*) from registrations r where ${on} and ${waiversDoneSql}`);
    const cleared = count(`select count(*) from registrations r join tech_inspections t on t.event_id = r.event_id and t.user_id = r.user_id where ${on} and t.sticker_issued_at is not null and ${waiversDoneSql}`);

    await signIn(page, "marian");
    await go(page, "/admin");
    await expect(page.getByRole("heading", { level: 1, name: e.name })).toBeVisible();
    await expect(pageHeader(page)).toContainText("Roebling Road Raceway");

    await expect(page.getByRole("link", { name: /^Registered/ })).toHaveText(new RegExp(`^Registered\\s*${total}\\s*${instructing} instructing$`));
    await expect(page.getByRole("link", { name: /^Checked in/ })).toHaveText(new RegExp(`^Checked in\\s*${checkedIn}/${total}$`));
    await expect(page.getByRole("link", { name: /^Tech stickers/ })).toHaveText(new RegExp(`^Tech stickers\\s*${stickers}/${total}`));
    await expect(page.getByText("Cleared to drive", { exact: true }).locator("..")).toHaveText(new RegExp(`^Cleared to drive\\s*${cleared}/${total}`));

    const paperwork = section(page, "Paperwork");
    await expect(paperwork.getByRole("link", { name: /Waivers signed/ })).toHaveText(new RegExp(`Waivers signed\\s*${waiversDone}/${total}`));
    await expect(paperwork.getByRole("link", { name: /Shop inspection approved/ })).toHaveText(new RegExp(`Shop inspection approved\\s*${approved}/${total}`));
    await expect(paperwork.getByRole("link", { name: /Tech sticker issued/ })).toHaveText(new RegExp(`Tech sticker issued\\s*${stickers}/${total}`));

    // One bar per run group, with the number of drivers registered in it.
    const groups = section(page, "Run groups");
    for (const [name, n] of sql(`select g.name, (select count(*) from registrations r where ${on} and r.run_group_id = g.id) from run_groups g order by g.sort_order`)) {
      await expect(groups.getByRole("listitem").filter({ hasText: new RegExp(`^${esc(name)}`) })).toHaveText(new RegExp(`^${esc(name)}\\s*${n}$`));
    }

    // What needs doing is listed, each line leading to the screen that deals with it.
    const attention = section(page, "Needs attention");
    if (toReview) await expect(attention.getByRole("link", { name: new RegExp(`^${plural(toReview, "tech form")} ready for review`) })).toHaveAttribute("href", "/admin/tech");
    if (waiversDone < total) await expect(attention.getByRole("link", { name: `${plural(total - waiversDone, "person", "people")} with unsigned waivers` })).toHaveAttribute("href", "/admin/waivers");
    for (const [id, status, driver] of sql(`select id, status, coalesce(driver_name, 'unnamed driver') from incidents where status <> 'sent'`)) {
      await expect(attention.getByRole("link", { name: new RegExp(`^Incident report ${status === "draft" ? "in draft" : "ready to send"}: ${esc(driver)}`) }).first(), `open incident ${id}`).toBeVisible();
    }

    // The three shortcuts at the top go where they say.
    await expect(page.getByRole("link", { name: "Announce", exact: true })).toHaveAttribute("href", "/admin/announcements");
    await expect(page.getByRole("link", { name: "Grid tech", exact: true })).toHaveAttribute("href", "/admin/tech/grid");
    await expect(page.getByRole("link", { name: "Report incident", exact: true })).toHaveAttribute("href", "/admin/incidents/new");
  });
});

// ───── roster

/** Split one CSV document into rows of cells, honouring quoted cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.length)) rows.push(row);
  return rows;
}

// The people these tests add are named after the run, so a later test can find them again.
const ADDED = { first: "Uma", last: `Handadded-${T}`, email: `uma.handadded.${T}@example.com`.toLowerCase() };
const IMPORTED = { first: "Ivan", last: `Imported-${T}`, email: `ivan.imported.${T}@example.com`.toLowerCase() };
const addedId = (email: string) => val(`select id from users where email = '${q(email)}'`);

test.describe("roster", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "marian");
  });

  test("the roster can be searched and filtered, and each row shows that person's paperwork", async ({ page }) => {
    const e = event();
    const total = registered();
    const on = `r.event_id = '${e.id}' and r.status <> 'cancelled'`;
    const showing = (n: number) => expect(page.getByText(/^Showing \d+ of /)).toHaveText(`Showing ${n} of ${plural(total, "person", "people")}`);
    await go(page, "/admin/roster");
    await expect(page.getByRole("heading", { level: 1, name: "Roster" })).toBeVisible();
    await showing(total);
    await expect(page.getByRole("row")).toHaveCount(total + 1); // plus the heading row

    // By name: one driver.
    const someone = drivers("true")[0];
    const search = page.getByRole("searchbox");
    await search.fill(someone.name.toUpperCase());
    await showing(1);
    await expect(rosterRow(page, someone)).toBeVisible();

    // By the number on the car door.
    const numbered = drivers("length(r.car_number) = 3")[0];
    const sameStart = count(
      `select count(*) from registrations r join users u on u.id = r.user_id left join vehicles v on v.id = r.vehicle_id
        where ${on} and (r.car_number like '${numbered.car}%' or lower(u.first_name || ' ' || u.last_name) like '%${numbered.car}%' or u.email like '%${numbered.car}%'
              or lower(concat_ws(' ', v.year, v.make, v.model)) like '%${numbered.car}%')`,
    );
    await search.fill(numbered.car);
    await showing(sameStart);
    await expect(rosterRow(page, numbered)).toBeVisible();

    // Nothing matches: the screen says so rather than showing an empty table.
    await search.fill("zzzz-nobody");
    await expect(page.getByText("Nobody matches")).toBeVisible();
    await showing(0);
    await search.fill("");

    // By run group. The choice shows how many are in each.
    for (const key of ["green", "black"]) {
      const [name, n] = sql(`select g.name, (select count(*) from registrations r where ${on} and r.run_group_id = g.id) from run_groups g where g.key = '${key}'`)[0];
      await page.getByLabel("Run group").selectOption({ label: `${name} (${n})` });
      await showing(Number(n));
    }
    await page.getByLabel("Run group").selectOption({ label: "All run groups" });

    // The quick filters, each with its count.
    const waiversOpen = `exists (select 1 from waiver_templates w where w.active and w.required and not exists (select 1 from waiver_signatures s where s.template_id = w.id and s.event_id = r.event_id and s.user_id = r.user_id and s.template_version >= w.version))`;
    const techOf = `(select t.status from tech_inspections t where t.event_id = r.event_id and t.user_id = r.user_id)`;
    const noSticker = `not exists (select 1 from tech_inspections t where t.event_id = r.event_id and t.user_id = r.user_id and t.sticker_issued_at is not null)`;
    const quick: [string, number][] = [
      ["Not checked in", count(`select count(*) from registrations r where ${on} and r.checked_in_at is null`)],
      ["Paperwork open", count(`select count(*) from registrations r where ${on} and (${waiversOpen} or coalesce(${techOf}, 'none') <> 'approved')`)],
      ["No tech sticker", count(`select count(*) from registrations r where ${on} and ${noSticker}`)],
      ["Instructors", count(`select count(*) from registrations r where ${on} and r.is_instructor`)],
      ["Everyone", total],
    ];
    for (const [label, n] of quick) {
      const button = page.getByRole("button", { name: new RegExp(`^${label}`) });
      await expect(button).toHaveText(new RegExp(`^${label}\\s*${n}$`));
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await showing(n);
    }

    // One row, read across: number, group, car, days, waivers, tech sticker.
    const [stickered] = sql(
      `select u.first_name, u.last_name, r.car_number, g.name, t.sticker_number, concat_ws(' ', v.year, v.make, v.model)
         from registrations r join users u on u.id = r.user_id join run_groups g on g.id = r.run_group_id
         join tech_inspections t on t.event_id = r.event_id and t.user_id = r.user_id left join vehicles v on v.id = r.vehicle_id
        where ${on} and t.sticker_issued_at is not null and r.attends_day1 and r.attends_day2 and not ${waiversOpen}
          and u.email not in (${PROTECTED.map((x) => `'${x}'`).join(",")}) order by u.last_name limit 1`,
    );
    const row = rosterRow(page, { first: stickered[0], last: stickered[1] });
    await expect(row.getByLabel(`Car number ${stickered[2]}`)).toBeVisible();
    await expect(row.getByRole("cell").nth(2)).toContainText(stickered[3]);
    await expect(row.getByRole("cell").nth(3)).toHaveText(stickered[5]);
    await expect(row.getByRole("cell").nth(4)).toHaveText("Both");
    const required = count(`select count(*) from waiver_templates where active and required`);
    await expect(row.getByRole("cell").nth(5)).toHaveText(`${required}/${required}`);
    await expect(row.getByRole("cell").nth(6)).toHaveText(stickered[4]);
  });

  test("a person's page shows their contact details, car, registration and event history", async ({ page }) => {
    const e = event();
    const [p] = sql(
      `select u.id, u.first_name, u.last_name, u.email, u.phone, u.address1, u.city, u.state, u.zip, u.emergency_name, u.emergency_phone, u.pca_member_number,
              m.experience, g.name, r.car_number, concat_ws(' ', v.year, v.make, v.model), r.external_id
         from registrations r join users u on u.id = r.user_id join memberships m on m.user_id = u.id join run_groups g on g.id = r.run_group_id left join vehicles v on v.id = r.vehicle_id
        where r.event_id = '${e.id}' and r.status <> 'cancelled' and g.key = 'white' and r.solo and r.source = 'import' and not m.is_admin
          and u.email not in (${PROTECTED.map((x) => `'${x}'`).join(",")})
        order by u.last_name limit 1`,
    );
    await go(page, "/admin/roster");
    await page.getByRole("link", { name: `${p[2]}, ${p[1]}`, exact: true }).click();
    await page.waitForURL(`**/admin/roster/${p[0]}`);
    await expect(page.getByRole("heading", { level: 1, name: `${p[1]} ${p[2]}` })).toBeVisible();
    await expect(pageHeader(page)).toContainText(p[15]);
    await expect(pageHeader(page).getByLabel(`Car number ${p[14]}`)).toBeVisible();

    const reg = section(page, e.name);
    await expect(detail(reg, "Run group")).toHaveText(`${p[13]} · solo`);
    await expect(detail(reg, "Attending")).toHaveText("Both days");
    await expect(detail(reg, "Source")).toHaveText(`Imported (${p[16]})`);
    await expect(detail(reg, "Waivers")).toHaveText(/^\d of \d signed$/);

    const contact = section(page, "Contact");
    await expect(detail(contact, "Email")).toHaveText(p[3]);
    await expect(detail(contact, "Phone")).toHaveText(p[4]);
    await expect(detail(contact, "Address")).toHaveText(`${p[5]} · ${p[6]}, ${p[7]} · ${p[8]}`);
    await expect(detail(contact, "Emergency contact")).toHaveText(`${p[9]}, ${p[10]}`);
    await expect(detail(contact, "PCA member")).toHaveText(p[11]);
    await expect(detail(contact, "Experience")).toHaveText(p[12]);

    // Every event they have been registered for, newest first.
    const history = sql(`select ev.name from registrations r join events ev on ev.id = r.event_id where r.user_id = '${p[0]}' order by ev.start_date desc`).map((r) => r[0]);
    const listed = section(page, "Event history").getByRole("listitem");
    await expect(listed).toHaveCount(history.length);
    for (let i = 0; i < history.length; i++) await expect(listed.nth(i)).toContainText(history[i]);

    // The back link returns to the roster.
    await pageHeader(page).getByRole("link", { name: "Roster" }).click();
    await page.waitForURL("**/admin/roster");
  });

  test("checking someone in, and undoing it, shows on the roster, their page and the overview", async ({ page }) => {
    const total = registered();
    const before = count(`select count(*) from registrations where event_id = '${event().id}' and status <> 'cancelled' and checked_in_at is not null`);
    const p = drivers("r.checked_in_at is null")[0];
    await go(page, "/admin/roster");
    await page.getByRole("searchbox").fill(p.name);
    await rosterRow(page, p).getByRole("button", { name: "Check in" }).click();
    await expect(toast(page, `${p.first} checked in`)).toBeVisible();
    await expect(rosterRow(page, p).getByRole("button", { name: `Undo check-in for ${p.name}` })).toHaveText("In");

    await go(page, `/admin/roster/${p.id}`);
    await expect(detail(page, "Checked in")).toHaveText(new RegExp(`^${monthDay(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()))}, \\d{1,2}:\\d{2} [AP]M$`));
    await go(page, "/admin");
    await expect(page.getByRole("link", { name: /^Checked in/ })).toHaveText(new RegExp(`${before + 1}/${total}$`));
    // The "Not checked in" filter no longer lists them.
    await go(page, "/admin/roster");
    await page.getByRole("button", { name: /^Not checked in/ }).click();
    await expect(rosterRow(page, p)).toHaveCount(0);
    await page.getByRole("button", { name: /^Everyone/ }).click();

    // Tapping "In" undoes it.
    await page.getByRole("searchbox").fill(p.name);
    await rosterRow(page, p).getByRole("button", { name: `Undo check-in for ${p.name}` }).click();
    await expect(rosterRow(page, p).getByRole("button", { name: "Check in" })).toBeVisible();
    await go(page, `/admin/roster/${p.id}`);
    await expect(detail(page, "Checked in")).toHaveText("Not yet");
    await go(page, "/admin");
    await expect(page.getByRole("link", { name: /^Checked in/ })).toHaveText(new RegExp(`${before}/${total}$`));
  });

  test("changing which days someone attends changes the roster and what that driver's schedule marks as theirs", async ({ page, asEmail }) => {
    const e = event();
    const p = drivers("g.key = 'white' and r.solo and r.attends_day1 and r.attends_day2")[0];
    const sunday = (pg: Page) => pg.getByRole("region", { name: new RegExp(`^Sunday`) });
    const sat = (pg: Page) => pg.getByRole("region", { name: new RegExp(`^Saturday`) });
    const setDays = async (label: string) => {
      await go(page, `/admin/roster/${p.id}`);
      await page.getByRole("button", { name: "Edit" }).click();
      await expect(sheet(page).getByRole("heading", { name: `Edit ${p.first}` })).toBeVisible();
      await sheet(page).getByLabel("Attending").selectOption({ label });
      await sheet(page).getByRole("button", { name: "Save changes" }).click();
      await expect(toast(page, "Saved")).toBeVisible();
      await expect(sheet(page)).toHaveCount(0);
    };

    const driver = await asEmail(p.email);
    await go(driver, "/schedule");
    await expect(sat(driver).getByText("You", { exact: true }).first()).toBeVisible();
    await expect(sunday(driver).getByText("You", { exact: true }).first()).toBeVisible();

    try {
      await setDays("Saturday only");
      await expect(detail(section(page, e.name), "Attending")).toHaveText("Saturday only");
      await go(page, "/admin/roster");
      await page.getByRole("searchbox").fill(p.name);
      await expect(rosterRow(page, p).getByRole("cell").nth(4)).toHaveText("Sat");

      // The driver's Sunday no longer has anything marked as theirs; Saturday still does.
      await go(driver, "/schedule");
      await expect(sat(driver).getByText("You", { exact: true }).first()).toBeVisible();
      await expect(sunday(driver).getByText("You", { exact: true })).toHaveCount(0);
    } finally {
      await setDays("Both days");
    }
    await expect(detail(section(page, e.name), "Attending")).toHaveText("Both days");
    await go(driver, "/schedule");
    await expect(sunday(driver).getByText("You", { exact: true }).first()).toBeVisible();
    // Nothing else about them changed along the way.
    expect(roster(`u.id = '${p.id}'`)[0]).toEqual(p);
  });

  test("roles: an administrator can make someone an administrator or an instructor, and take it away again", async ({ page, asEmail }) => {
    const p = drivers("g.key = 'black'", "u.last_name desc")[0];
    const openRoles = async (id: string) => {
      await go(page, `/admin/roster/${id}`);
      await page.getByRole("button", { name: "Roles" }).click();
      await expect(sheet(page).getByRole("heading", { name: "Roles" })).toBeVisible();
    };
    const save = async () => {
      await sheet(page).getByRole("button", { name: "Save roles" }).click();
      await expect(toast(page, "Roles updated")).toBeVisible();
      await expect(sheet(page)).toHaveCount(0);
    };
    const person = await asEmail(p.email);
    const menu = person.getByRole("navigation", { name: "Main" }).first();
    await expect(menu).not.toContainText("Overview");
    await expect(menu).not.toContainText("My students");

    try {
      // Administrator, with a title.
      await openRoles(p.id);
      await sheet(page).getByRole("checkbox", { name: /^Administrator\./ }).check();
      await sheet(page).getByLabel("Title").fill("UAT Steward");
      await save();
      await expect(pageHeader(page)).toContainText("UAT Steward");
      await go(page, "/admin/settings");
      const admins = section(page, /^Administrators · \d+$/);
      await expect(admins.getByRole("link", { name: new RegExp(`^${esc(p.name)}`) })).toContainText("UAT Steward");
      await expect(section(page, /^Administrators/).getByRole("heading")).toHaveText(`Administrators · ${count("select count(*) from memberships where is_admin")}`);
      // They now have the administrator menu and can open the overview.
      await go(person, "/admin");
      await expect(person.getByRole("heading", { level: 1, name: event().name })).toBeVisible();
      await expect(person.getByRole("navigation", { name: "Main" }).first()).toContainText("Roster");

      // Swap administrator for instructor.
      await openRoles(p.id);
      await sheet(page).getByRole("checkbox", { name: /^Administrator\./ }).uncheck();
      await sheet(page).getByRole("checkbox", { name: /^Instructor\./ }).check();
      await sheet(page).getByLabel("Credential").fill("UAT Regional Instructor");
      await save();
      await expect(pageHeader(page)).not.toContainText("UAT Steward");
      await expect(pageHeader(page)).toContainText("Instructor");
      await go(person, "/admin");
      await person.waitForURL("**/home");
      await expect(person.getByRole("navigation", { name: "Main" }).first()).toContainText("My students");
      await expect(person.getByRole("navigation", { name: "Main" }).first()).not.toContainText("Roster");
    } finally {
      // Back to a plain driver.
      await openRoles(p.id);
      await sheet(page).getByRole("checkbox", { name: /^Administrator\./ }).uncheck();
      await sheet(page).getByRole("checkbox", { name: /^Instructor\./ }).uncheck();
      await save();
    }
    await expect(pageHeader(page)).not.toContainText("Instructor");
    await go(person, "/home");
    await expect(person.getByRole("navigation", { name: "Main" }).first()).not.toContainText("My students");
    expect(sql(`select is_admin, is_instructor, admin_title, instructor_credential from memberships where user_id = '${p.id}'`)[0]).toEqual(["f", "f", "", ""]);

    // Nobody can lock themselves out: Marian cannot remove her own administrator role.
    const marian = val(`select id from users where email = '${PEOPLE.marian.email}'`);
    await openRoles(marian);
    await sheet(page).getByRole("checkbox", { name: /^Administrator\./ }).uncheck();
    await sheet(page).getByRole("button", { name: "Save roles" }).click();
    await expect(sheet(page).getByRole("alert")).toHaveText("You cannot remove your own administrator access. Ask another administrator to do it.");
    await go(page, "/admin/settings");
    await expect(section(page, /^Administrators/).getByRole("link", { name: /^Marian Castellanos/ })).toContainText("Event Chair");
  });

  test("notes for administrators can be added to a driver's file and removed", async ({ page, asEmail }) => {
    const p = drivers("g.key = 'black'", "u.last_name desc")[0];
    const note = `UAT ${T}: arrived with a loose battery tie-down, fixed before grid tech.`;
    await go(page, `/admin/roster/${p.id}`);
    const notes = section(page, "Notes for administrators");
    // A note needs some words in it.
    await notes.getByLabel("New note").fill("ok");
    await notes.getByRole("button", { name: "Add note" }).click();
    await expect(notes.getByRole("alert")).toHaveText("Write the note first.");

    await notes.getByLabel("New note").fill(note);
    await notes.getByLabel("Category").selectOption({ label: "Safety" });
    await notes.getByRole("button", { name: "Add note" }).click();
    await expect(toast(page, "Note added")).toBeVisible();
    const item = notes.getByRole("listitem").filter({ hasText: note });
    await expect(item).toContainText("Safety");
    await expect(item).toContainText(`Marian Castellanos`);
    await expect(item).toContainText(event().name);
    await expect(notes.getByLabel("New note")).toHaveValue("");

    // The driver never sees it: it is not on their own profile.
    const driver = await asEmail(p.email);
    await go(driver, "/me");
    await expect(driver.locator("main")).toContainText(p.first);
    await expect(driver.locator("main")).not.toContainText("loose battery tie-down");

    const asked = nextConfirm(page);
    await item.getByRole("button", { name: "Remove" }).click();
    await expect(toast(page, "Note removed")).toBeVisible();
    expect(asked.text).toBe("Remove this note?");
    await expect(notes.getByText(note)).toHaveCount(0);
  });

  test("adding a person by hand puts them on the roster with everything that was typed", async ({ page, asEmail }) => {
    const total = registered();
    await go(page, "/admin/roster");
    await page.getByRole("button", { name: "Add person" }).click();
    const form = sheet(page);
    await expect(form.getByRole("heading", { name: "Add to the roster" })).toBeVisible();
    await form.getByLabel("First name").fill(ADDED.first);
    await form.getByLabel("Last name").fill(ADDED.last);
    // An address with no domain ending is refused, and nothing typed is lost.
    await form.getByLabel("Email").fill("uma@nowhere");
    await form.getByRole("button", { name: "Add to roster" }).click();
    await expect(form.getByRole("alert")).toHaveText("Enter a valid email address. It is how this person signs in.");
    await expect(form.getByLabel("First name")).toHaveValue(ADDED.first);
    expect(registered()).toBe(total);

    await form.getByLabel("Email").fill(ADDED.email);
    await form.getByLabel("Mobile phone").fill("(912) 555-0199");
    await form.getByLabel("T-shirt size").selectOption({ label: "L" });
    await form.getByLabel("Street address").fill("12 Paddock Lane");
    await form.getByLabel("City").fill("Savannah");
    await form.getByLabel("State").fill("GA");
    await form.getByLabel("ZIP").fill("31401");
    await form.getByLabel("Emergency contact").fill("Una Handadded");
    await form.getByLabel("Their phone").fill("(912) 555-0198");
    await form.getByLabel("PCA member number").fill("2026990001");
    await form.getByLabel("Experience").fill("14 track days");
    await form.getByLabel("Run group").selectOption({ label: "White" });
    await form.getByLabel("Attending").selectOption({ label: "Sunday only" });
    await form.getByRole("checkbox", { name: "Signed off to drive solo" }).check();
    await form.getByLabel("Year").fill("2017");
    await form.getByLabel("Make").fill("Porsche");
    await form.getByLabel("Model").fill("718 Cayman S");
    await form.getByLabel("Color").fill("Graphite Blue");
    await form.getByLabel("Car number").fill("977");
    await form.getByRole("button", { name: "Add to roster" }).click();
    await expect(toast(page, `${ADDED.first} ${ADDED.last} added to the roster`)).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);

    // On the roster straight away, one more than before.
    await expect(page.getByText(/^Showing \d+ of /)).toHaveText(`Showing ${total + 1} of ${total + 1} people`);
    await page.getByRole("searchbox").fill(ADDED.last);
    const row = rosterRow(page, ADDED);
    await expect(row.getByLabel("Car number 977")).toBeVisible();
    await expect(row.getByRole("cell").nth(2)).toHaveText(/White\s*Solo/);
    await expect(row.getByRole("cell").nth(3)).toHaveText("2017 Porsche 718 Cayman S");
    await expect(row.getByRole("cell").nth(4)).toHaveText("Sun");
    await expect(row.getByRole("cell").nth(5)).toHaveText(new RegExp(`^0/${count("select count(*) from waiver_templates where active and required")}$`));
    await expect(row.getByRole("cell").nth(6)).toHaveText("Not started");
    await expect(row.getByRole("button", { name: "Check in" })).toBeVisible();

    // Their page has every detail.
    await row.getByRole("link", { name: `${ADDED.last}, ${ADDED.first}` }).click();
    await page.waitForURL(`**/admin/roster/${addedId(ADDED.email)}`);
    const reg = section(page, event().name);
    await expect(detail(reg, "Run group")).toHaveText("White · solo");
    await expect(detail(reg, "Attending")).toHaveText("Sunday only");
    await expect(detail(reg, "Source")).toHaveText("Added by hand");
    const contact = section(page, "Contact");
    await expect(detail(contact, "Email")).toHaveText(ADDED.email);
    await expect(detail(contact, "Phone")).toHaveText("(912) 555-0199");
    await expect(detail(contact, "Address")).toHaveText("12 Paddock Lane · Savannah, GA · 31401");
    await expect(detail(contact, "Emergency contact")).toHaveText("Una Handadded, (912) 555-0198");
    await expect(detail(contact, "PCA member")).toHaveText("2026990001");
    await expect(detail(contact, "T-shirt")).toHaveText("L");
    await expect(detail(contact, "Experience")).toHaveText("14 track days");

    // Corrections are made from Edit. Someone else's email address cannot be taken.
    await page.getByRole("button", { name: "Edit" }).click();
    const edit = sheet(page);
    await expect(edit.getByRole("heading", { name: `Edit ${ADDED.first}` })).toBeVisible();
    await expect(edit.getByLabel("Email")).toHaveValue(ADDED.email);
    await expect(edit.getByLabel("Registration status")).toHaveValue("confirmed");
    await edit.getByLabel("Email").fill(PEOPLE.marian.email);
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit.getByRole("alert")).toHaveText("Another person already uses that email address.");
    // A new phone number, a move to Black, a different number on the car.
    await edit.getByLabel("Email").fill(ADDED.email);
    await edit.getByLabel("Mobile phone").fill("(912) 555-0196");
    await edit.getByLabel("Run group").selectOption({ label: "Black" });
    await edit.getByLabel("Car number").fill("978");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Saved")).toBeVisible();
    await expect(detail(reg, "Run group")).toHaveText("Black · solo");
    await expect(detail(contact, "Phone")).toHaveText("(912) 555-0196");
    await expect(pageHeader(page).getByLabel("Car number 978")).toBeVisible();
    expect(val(`select email from users where id = '${addedId(ADDED.email)}'`)).toBe(ADDED.email);

    // And the new person can sign in with that address and finds themselves in Black, car 978.
    const uma = await asEmail(ADDED.email);
    await go(uma, "/me");
    await expect(uma.locator("main")).toContainText("2017 Porsche 718 Cayman S");
    await expect(uma.locator("main").getByLabel("Car number 978").first()).toBeVisible();
    await expect(uma.getByRole("heading", { name: "Your run group" }).locator("..")).toContainText("Black");
  });

  test("importing a registration export previews it, says what will be skipped, and adds the rest", async ({ page }) => {
    const total = registered();
    await go(page, "/admin/roster");
    await page.getByRole("button", { name: "Import" }).click();
    const panel = sheet(page);
    await expect(panel.getByRole("heading", { name: "Import registrations" })).toBeVisible();
    const choose = (name: string, text: string) => panel.getByLabel("Export file (.csv or .xls)").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });

    // A file with no recognisable columns is turned down with the reason.
    await choose("notes.csv", "colour,shape\nred,round\n");
    await panel.getByRole("button", { name: "Preview import" }).click();
    await expect(panel.getByRole("alert")).toHaveText("No header row was recognised. The file needs at least a name and an email column.");

    // A small export: one good row, one unknown run group, one with no email, one cancelled.
    const csv = [
      "First Name,Last Name,Email,Phone,Run Group,Car Number,Year,Make,Model,Color,T-Shirt,Registration ID,Status,Favourite corner",
      `${IMPORTED.first},${IMPORTED.last},${IMPORTED.email},(912) 555-0197,Green - Novice,976,2014,Porsche,Cayman,Racing Yellow,XL,CR-UAT-${T},Confirmed,Turn 5`,
      `Pat,Purple-${T},pat.purple.${T}@example.com,,Purple,975,2010,Porsche,Boxster,Black,M,CR-UAT-2,Confirmed,`,
      `Noel,Noemail-${T},,,Blue,974,2011,Porsche,Cayman,White,M,CR-UAT-3,Confirmed,`,
      `Cass,Cancelled-${T},cass.cancelled.${T}@example.com,,White,973,2012,Porsche,911,Silver,M,CR-UAT-4,Cancelled,`,
    ].join("\r\n");
    await choose("clubregistration-export.csv", csv);
    await expect(panel.getByText("clubregistration-export.csv")).toBeVisible();
    await panel.getByRole("button", { name: "Preview import" }).click();
    await expect(panel.getByText("4 rows read, 1 ready to import")).toBeVisible();
    await expect(panel.getByText("1 row has no email address and will be skipped.")).toBeVisible();
    await expect(panel.getByText("1 row has a run group that was not recognised and will be skipped.")).toBeVisible();
    await expect(panel.getByText("Run group from “Run Group”")).toBeVisible();
    await expect(panel.getByText("Ignored: Favourite corner")).toBeVisible();
    const preview = panel.getByRole("row").filter({ hasText: IMPORTED.last });
    await expect(preview).toContainText(IMPORTED.email);
    await expect(preview).toContainText("2014 Porsche Cayman");
    expect(registered(), "nothing is written by the preview").toBe(total);

    await panel.getByRole("button", { name: "Import 1 person" }).click();
    await expect(panel.getByText("Import finished")).toBeVisible();
    await expect(panel.getByText("1 person added, 0 updated, 3 skipped.")).toBeVisible();
    await panel.getByRole("button", { name: "Close" }).click();

    await expect(page.getByText(/^Showing \d+ of /)).toHaveText(`Showing ${total + 1} of ${total + 1} people`);
    await page.getByRole("searchbox").fill(IMPORTED.last);
    const row = rosterRow(page, IMPORTED);
    await expect(row.getByLabel("Car number 976")).toBeVisible();
    await expect(row.getByRole("cell").nth(2)).toHaveText("Green");
    await expect(row.getByRole("cell").nth(3)).toHaveText("2014 Porsche Cayman");
    await go(page, `/admin/roster/${addedId(IMPORTED.email)}`);
    await expect(detail(section(page, event().name), "Source")).toHaveText(`Imported (CR-UAT-${T})`);
    await expect(detail(section(page, "Contact"), "T-shirt")).toHaveText("XL");
    // The skipped rows made nobody.
    expect(count(`select count(*) from users where email in ('pat.purple.${T.toLowerCase()}@example.com', 'cass.cancelled.${T.toLowerCase()}@example.com') or last_name = 'Noemail-${q(T)}'`)).toBe(0);
  });

  test("the roster export is a real CSV file with one row per registered person", async ({ page }) => {
    const e = event();
    await go(page, "/admin/roster");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export" }).click()]);
    expect(download.suggestedFilename()).toBe("fall-de-roster.csv");
    const text = fs.readFileSync(await download.path(), "utf8");
    expect(text.startsWith("<"), "the file is not a web page").toBe(false);
    const rows = parseCsv(text);
    const header = rows[0];
    expect(header).toEqual([
      "Car number", "Last name", "First name", "Run group", "Solo", "Instructor", "Email", "Phone", "Address", "City", "State", "ZIP", "Emergency contact", "Emergency phone",
      "PCA member number", "T-shirt", "Year", "Make", "Model", "Color", "Day 1", "Day 2", "Waivers signed", "Tech status", "Tech sticker", "Checked in", "Assigned instructor",
    ]);
    const data = rows.slice(1);
    for (const r of data) expect(r.length, `columns in the row for ${r[2]} ${r[1]}`).toBe(header.length);
    const col = (name: string) => header.indexOf(name);

    // Exactly the people on the roster: nobody missing, nobody twice, nobody whose registration was cancelled.
    const expected = sql(`select u.email from registrations r join users u on u.id = r.user_id where r.event_id = '${e.id}' and r.status <> 'cancelled' order by u.email`).map((r) => r[0]);
    expect(data.map((r) => r[col("Email")]).sort()).toEqual(expected);
    for (const [email] of sql(`select u.email from registrations r join users u on u.id = r.user_id where r.event_id = '${e.id}' and r.status = 'cancelled'`)) expect(text).not.toContain(email);

    // Each person's row carries what the database holds for them. "Solo" is how they drive, as every screen
    // states it: the run group decides first (Green never, White and Black always) and the sign-off second (Blue).
    const want = sql(
      `select u.email, coalesce(r.car_number, ''), u.last_name, u.first_name, g.name,
              case when r.is_instructor then true when g.instructor_policy = 'required' then false when g.instructor_policy = 'optional' then r.solo else true end, r.is_instructor, coalesce(u.phone, ''), coalesce(u.city, ''), coalesce(v.year::text, ''), coalesce(v.make, ''), coalesce(v.model, ''),
              r.attends_day1, r.attends_day2, r.checked_in_at is not null, coalesce(t.status, 'none'), case when t.sticker_issued_at is not null then coalesce(t.sticker_number, 'Issued') else '' end,
              coalesce((select iu.first_name || ' ' || iu.last_name from instructor_assignments a join users iu on iu.id = a.instructor_id where a.event_id = r.event_id and a.student_id = r.user_id limit 1), '')
         from registrations r join users u on u.id = r.user_id join run_groups g on g.id = r.run_group_id
         left join vehicles v on v.id = r.vehicle_id left join tech_inspections t on t.event_id = r.event_id and t.user_id = r.user_id
        where r.event_id = '${e.id}' and r.status <> 'cancelled'`,
    );
    const yn = (v: string) => (v === "t" ? "Yes" : "No");
    for (const w of want) {
      const r = data.find((x) => x[col("Email")] === w[0])!;
      const got = ["Car number", "Last name", "First name", "Run group", "Solo", "Instructor", "Phone", "City", "Year", "Make", "Model", "Day 1", "Day 2", "Checked in", "Tech status", "Tech sticker", "Assigned instructor"].map((c) => r[col(c)]);
      expect(got, `the row for ${w[0]}`).toEqual([w[1], w[2], w[3], w[4], yn(w[5]), yn(w[6]), w[7], w[8], w[9], w[10], w[11], yn(w[12]), yn(w[13]), yn(w[14]), w[15], w[16], w[17]]);
      expect(r[col("Waivers signed")]).toMatch(/^\d+\/\d+$/);
    }
    // Sorted by last name, as the roster is.
    const lastNames = data.map((r) => r[col("Last name")]);
    expect(lastNames).toEqual(sql(`select u.last_name from registrations r join users u on u.id = r.user_id where r.event_id = '${e.id}' and r.status <> 'cancelled' order by u.last_name, u.first_name`).map((r) => r[0]));
  });

  test("cancelling a registration takes the person off the roster and the export; saving their record registers them again", async ({ page }) => {
    const uma = addedId(ADDED.email);
    test.skip(!uma, "needs the person added by hand in an earlier test");
    const e = event();
    const cancel = async (id: string, first: string) => {
      await go(page, `/admin/roster/${id}`);
      const asked = nextConfirm(page);
      await page.getByRole("button", { name: "Cancel registration" }).click();
      await expect(toast(page, "Registration cancelled")).toBeVisible();
      expect(asked.text).toBe(`Cancel ${first}'s registration for ${e.name}?`);
      await expect(section(page, e.name)).toContainText("Not registered for this event.");
    };
    const before = registered();
    await cancel(uma, ADDED.first);
    expect(registered()).toBe(before - 1);
    await go(page, "/admin/roster");
    await expect(page.getByText(/^Showing \d+ of /)).toHaveText(`Showing ${before - 1} of ${before - 1} people`);
    await page.getByRole("searchbox").fill(ADDED.last);
    await expect(page.getByText("Nobody matches")).toBeVisible();
    const file = await page.context().request.get("/admin/roster/export");
    expect(file.headers()["content-type"]).toContain("text/csv");
    expect(await file.text()).not.toContain(ADDED.email);
    // Their history still records that they were registered and cancelled.
    await go(page, `/admin/roster/${uma}`);
    await expect(section(page, "Event history").getByRole("listitem").filter({ hasText: e.name })).toContainText("cancelled");

    // Edit says saving will add them back, and it does.
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(sheet(page)).toContainText(`${ADDED.first} is not registered for ${e.name}. Saving adds them.`);
    await sheet(page).getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Saved")).toBeVisible();
    await expect(detail(section(page, e.name), "Run group")).toHaveText("Black · solo");
    expect(registered()).toBe(before);

    // Leave the roster as it was found: both people this file added are cancelled again.
    await cancel(uma, ADDED.first);
    const ivan = addedId(IMPORTED.email);
    if (ivan && val(`select status from registrations where user_id = '${ivan}' and event_id = '${e.id}'`) !== "cancelled") await cancel(ivan, IMPORTED.first);
    expect(count(`select count(*) from registrations r join users u on u.id = r.user_id where r.event_id = '${e.id}' and r.status <> 'cancelled' and u.email like '%.${q(T.toLowerCase())}@example.com'`)).toBe(0);
  });

  test("on a phone the administrator screens are under More, and the roster's stacked rows check someone in", async ({ as }) => {
    const p = drivers("r.checked_in_at is null")[0];
    const phone = await as("marian", { phone: true });
    // The bottom bar has no room for the administrator menu: it is one tap away, under More.
    await phone.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "More" }).click();
    await phone.waitForURL("**/more");
    const menu = section(phone, "Run the event");
    for (const label of ["Overview", "Roster", "Schedule", "Instructor pairing", "Tech inspection", "Waivers", "Promotions", "Announcements", "Incidents", "Events and history", "Settings"]) {
      await expect(menu.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await menu.getByRole("link", { name: /^Roster/ }).click();
    await phone.waitForURL("**/admin/roster");
    // No table on a phone: one card per person, with their paperwork and the check-in button.
    await expect(phone.getByRole("table")).toHaveCount(0);
    await phone.getByRole("searchbox").fill(p.name);
    const card = phone.locator("main").getByRole("listitem").filter({ hasText: p.name }).filter({ visible: true });
    await expect(card).toContainText(/Waivers\s*\d\/\d/);
    await expect(card.getByLabel(`Car number ${p.car}`)).toBeVisible();
    await card.getByRole("button", { name: "Check in" }).click();
    await expect(toast(phone, `${p.first} checked in`)).toBeVisible();
    await card.getByRole("button", { name: `Undo check-in for ${p.name}` }).click();
    await expect(card.getByRole("button", { name: "Check in" })).toBeVisible();
    expect(val(`select checked_in_at is null from registrations where id = '${p.regId}'`)).toBe("t");
    // Nothing spills off the side of the screen.
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "pixels the roster is wider than the phone").toBeLessThanOrEqual(0);
  });
});

// ───── schedule editor

/** Emails of everyone registered for the event who matches a condition on their registration (r), run group (g) or membership (m). */
const audience = (cond: string) =>
  sql(
    `select u.email from registrations r join users u on u.id = r.user_id join run_groups g on g.id = r.run_group_id join memberships m on m.user_id = u.id
      where r.event_id = '${event().id}' and r.status <> 'cancelled' and (${cond}) order by 1`,
  ).map((r) => r[0]);
const BLUE_SOLO_AND_WHITE = "(g.key = 'blue' and r.solo) or g.key = 'white'";
/** The newest announcement with this title whose message contains a phrase: who it was recorded for and who actually got the alert. */
function sentAlert(title: string, phrase: string) {
  const [row] = sql(`select id, recipient_count, urgent from announcements where title = '${q(title)}' and body like '%${q(phrase)}%' order by created_at desc limit 1`);
  if (!row) return null;
  return { id: row[0], count: Number(row[1]), urgent: row[2] === "t", to: sql(`select u.email from notifications n join users u on u.id = n.user_id where n.announcement_id = '${row[0]}' order by 1`).map((r) => r[0]) };
}
const announcements = () => count(`select count(*) from announcements`);
/** Everything on the schedule that these tests did not add: it must come through untouched. */
const seededSchedule = () => sql(`select id, day, start_min, end_min, title, cancelled from schedule_items where event_id = '${event().id}' and coalesce(note, '') not like 'UAT %' order by id`);
/** The row this file added to the schedule editor, found by its note. */
const NOTE = `UAT ${T} session`;
const editorRow = (page: Page, text = NOTE) => page.getByRole("listitem").filter({ hasText: text }).filter({ visible: true });
/** A day's column on the driver's Schedule screen. */
const dayColumn = (page: Page, weekday: string) => page.getByRole("region", { name: new RegExp(`^${weekday}`) });
const myItem = () => {
  const [r] = sql(`select id, title, start_min, end_min, cancelled from schedule_items where event_id = '${event().id}' and note = '${q(NOTE)}'`);
  return r ? { id: r[0], title: r[1], start: Number(r[2]), end: Number(r[3]), cancelled: r[4] === "t" } : null;
};
const clock = (min: number) => `${Math.floor(min / 60) % 12 === 0 ? 12 : Math.floor(min / 60) % 12}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;

test.describe("schedule editor", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "marian");
  });

  test("a new session for Blue Solo and White names itself, shows both chips, and alerts only those drivers", async ({ page, asEmail }) => {
    const e = event();
    const untouched = seededSchedule();
    const solo = drivers("g.key = 'blue' and r.solo and r.attends_day2")[0];
    const instructed = drivers("g.key = 'blue' and not r.solo and r.attends_day2")[0];

    // A Blue Solo driver already has the schedule open on their phone or laptop.
    const soloPage = await asEmail(solo.email);
    await go(soloPage, `/schedule?day=${e.end}`);
    await expect(dayColumn(soloPage, "Sunday")).toBeVisible();

    await go(page, `/admin/schedule?day=${e.end}`);
    await expect(page.getByRole("heading", { level: 1, name: "Schedule editor" })).toBeVisible();
    await page.getByRole("button", { name: "Add item" }).click();
    const form = sheet(page);
    await expect(form.getByRole("heading", { name: "Add to the schedule" })).toBeVisible();
    await expect(form.getByLabel("Day")).toHaveValue(e.end);
    await form.getByLabel("Starts").fill("21:30");
    await form.getByLabel("Ends").fill("21:50");
    // Run groups is the default audience, and at least one has to be chosen.
    await form.getByRole("button", { name: "Add to schedule" }).click();
    await expect(form.getByRole("alert")).toHaveText("Choose at least one run group, or change who this is for.");

    await pick(form.getByRole("checkbox", { name: "Blue", exact: true }));
    await pick(form.getByRole("checkbox", { name: "White", exact: true }));
    // Blue has two halves, so the form asks which. White does not, so it is not asked about.
    await expect(form.getByLabel("Which White drivers")).toHaveCount(0);
    await form.getByLabel("Which Blue drivers").selectOption({ label: "Blue Solo only: drivers signed off solo" });
    // An end before the start is refused.
    await form.getByLabel("Ends").fill("21:10");
    await form.getByRole("button", { name: "Add to schedule" }).click();
    await expect(form.getByRole("alert")).toHaveText("The end time has to be after the start time.");
    await form.getByLabel("Ends").fill("21:50");
    await form.getByLabel("Location").fill("False grid");
    await form.getByLabel("Note").fill(NOTE);
    await form.getByRole("checkbox", { name: "Send an alert about this change to the people it affects" }).check();
    const before = announcements();
    await form.getByRole("button", { name: "Add to schedule" }).click();
    await expect(toast(page, "Added to the schedule")).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);

    // With the title left empty the session is named after who is in it, and carries a chip for each.
    const row = editorRow(page);
    await expect(row).toContainText("9:30 PM");
    await expect(row).toContainText("to 9:50 PM");
    await expect(row.getByText("Blue Solo and White", { exact: true })).toBeVisible();
    await expect(row.getByText("Blue Solo", { exact: true })).toBeVisible();
    await expect(row.getByText("White", { exact: true })).toBeVisible();
    await expect(row).toContainText("Track session");
    await expect(row).toContainText("False grid");

    // The alert went to Blue Solo and White drivers, and to nobody else.
    expect(announcements()).toBe(before + 1);
    const sent = sentAlert("Schedule change", "Added: Blue Solo and White, Sunday 9:30 PM to 9:50 PM.");
    expect(sent, "a Schedule change alert about the new session").not.toBeNull();
    const expected = audience(BLUE_SOLO_AND_WHITE);
    expect(sent!.to).toEqual(expected);
    expect(sent!.count).toBe(expected.length);
    expect(sent!.to).toContain(solo.email);
    expect(sent!.to).not.toContain(instructed.email);
    // The administrator sees the same on the announcements screen.
    await go(page, "/admin/announcements");
    const log = section(page, "Sent").getByRole("listitem").first();
    await expect(log).toContainText("Schedule change");
    await expect(log).toContainText("Added: Blue Solo and White, Sunday 9:30 PM to 9:50 PM.");
    await expect(log.getByText("Blue Solo", { exact: true })).toBeVisible();
    await expect(log.getByText("White", { exact: true })).toBeVisible();
    await expect(log).toContainText(`${plural(expected.length, "person", "people")}`);
    await expect(log).toContainText("Marian Castellanos");

    // The Blue Solo driver's open screen catches up by itself (the app checks every 20 seconds).
    const theirs = dayColumn(soloPage, "Sunday").getByRole("listitem").filter({ hasText: NOTE });
    await expect(theirs).toBeVisible({ timeout: 40_000 });
    await expect(theirs).toContainText("9:30");
    await expect(theirs.getByText("You", { exact: true })).toBeVisible();
    await expect(theirs.getByText("Blue Solo", { exact: true })).toBeVisible();
    await go(soloPage, "/alerts");
    const alert = soloPage.getByRole("listitem").filter({ hasText: "Added: Blue Solo and White, Sunday 9:30 PM to 9:50 PM." });
    await expect(alert).toContainText("Schedule change");
    await expect(alert).toContainText("Urgent");

    // A Blue driver who still rides with an instructor sees the session on the full schedule, but it is not theirs and they got no alert.
    const instructedPage = await asEmail(instructed.email);
    await go(instructedPage, `/schedule?day=${e.end}`);
    const others = dayColumn(instructedPage, "Sunday").getByRole("listitem").filter({ hasText: NOTE });
    await expect(others).toBeVisible();
    await expect(others.getByText("You", { exact: true })).toHaveCount(0);
    await instructedPage.getByRole("button", { name: "Mine only" }).click();
    await expect(others).toHaveCount(0);
    await go(instructedPage, "/alerts");
    await expect(instructedPage.locator("main")).not.toContainText("Added: Blue Solo and White");

    expect(seededSchedule(), "the seeded sessions").toEqual(untouched);
  });

  test("moving a session tells the drivers in it the old and new time; a small edit can be made quietly", async ({ page, asEmail }) => {
    const e = event();
    test.skip(!myItem(), "needs the session added in the previous test");
    const untouched = seededSchedule();
    const title = `UAT ${T} late session`;
    await go(page, `/admin/schedule?day=${e.end}`);
    await editorRow(page).getByRole("button", { name: `Edit ${myItem()!.title}` }).click();
    const form = sheet(page);
    await expect(form.getByRole("heading", { name: "Edit schedule item" })).toBeVisible();
    // The form opens with what was saved, including which half of Blue.
    await expect(form.getByLabel("Starts")).toHaveValue("21:30");
    await expect(form.getByLabel("Which Blue drivers")).toHaveValue("solo");
    await expect(form.getByRole("checkbox", { name: "Blue", exact: true })).toBeChecked();
    await expect(form.getByRole("checkbox", { name: "Green", exact: true })).not.toBeChecked();
    // On a published event the alert is offered by default.
    await expect(form.getByRole("checkbox", { name: "Send an alert about this change to the people it affects" })).toBeChecked();
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Starts").fill("21:40");
    await form.getByLabel("Ends").fill("22:00");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Schedule updated")).toBeVisible();
    const row = editorRow(page);
    await expect(row.getByText(title, { exact: true })).toBeVisible();
    await expect(row).toContainText("9:40 PM");
    await expect(row).toContainText("to 10:00 PM");

    const moved = sentAlert("Schedule change", `${title} moves from 9:30 PM to Sunday 9:40 PM.`);
    expect(moved, "an alert saying where the session moved from and to").not.toBeNull();
    expect(moved!.to).toEqual(audience(BLUE_SOLO_AND_WHITE));

    // A White driver sees the new time and the alert.
    const white = drivers("g.key = 'white' and r.attends_day2")[0];
    const whitePage = await asEmail(white.email);
    await go(whitePage, `/schedule?day=${e.end}`);
    const theirs = dayColumn(whitePage, "Sunday").getByRole("listitem").filter({ hasText: title });
    await expect(theirs).toContainText("9:40");
    await expect(theirs).toContainText("until 10:00 PM");
    await expect(theirs.getByText("You", { exact: true })).toBeVisible();
    await go(whitePage, "/alerts");
    await expect(whitePage.getByRole("listitem").filter({ hasText: `${title} moves from 9:30 PM to Sunday 9:40 PM.` })).toBeVisible();

    // Changing only the end time says so.
    await editorRow(page).getByRole("button", { name: `Edit ${title}` }).click();
    await form.getByLabel("Ends").fill("22:05");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Schedule updated")).toBeVisible();
    await expect(editorRow(page)).toContainText("to 10:05 PM");
    expect(sentAlert("Schedule change", `${title} at 9:40 PM now ends at 10:05 PM.`)?.to).toEqual(audience(BLUE_SOLO_AND_WHITE));

    // With the alert box unticked, a change to the location is saved without telling anyone.
    const before = announcements();
    await editorRow(page).getByRole("button", { name: `Edit ${title}` }).click();
    await form.getByLabel("Location").fill("Pit lane");
    await form.getByRole("checkbox", { name: "Send an alert about this change to the people it affects" }).uncheck();
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Schedule updated")).toBeVisible();
    await expect(editorRow(page)).toContainText("Pit lane");
    expect(announcements()).toBe(before);
    expect(seededSchedule(), "the seeded sessions").toEqual(untouched);
  });

  test("delaying the day moves everything from the chosen time and tells everyone", async ({ page, asEmail }) => {
    const e = event();
    const mine = myItem();
    test.skip(!mine, "needs the session added earlier in this file");
    const untouched = seededSchedule();
    // Nothing but this file's own session may sit at or after 9:25 PM on Sunday, or the delay below would move it too.
    expect(count(`select count(*) from schedule_items where event_id = '${e.id}' and day = '${e.end}' and start_min >= ${21 * 60 + 25} and coalesce(note, '') <> '${q(NOTE)}'`), "other late-evening items on Sunday").toBe(0);

    await go(page, `/admin/schedule?day=${e.end}`);
    await page.getByRole("button", { name: "Delay or advance" }).click();
    const form = sheet(page);
    await expect(form.getByRole("heading", { name: "Delay or advance the day" })).toBeVisible();
    await expect(form.getByLabel("Day")).toHaveValue(e.end);
    const move = form.getByRole("button", { name: "Move the schedule" });

    // Things the form refuses.
    await form.getByLabel("Starting from").fill("21:25");
    await form.getByLabel("Move by (minutes)").fill("0");
    await move.click();
    await expect(form.getByRole("alert")).toHaveText("Enter how many minutes to move things by (1 to 240).");
    await form.getByLabel("Move by (minutes)").fill("241");
    await move.click();
    await expect(form.getByRole("alert")).toHaveText("Enter how many minutes to move things by (1 to 240).");
    await form.getByLabel("Move by (minutes)").fill("200");
    await move.click();
    await expect(form.getByRole("alert")).toHaveText("That would push something past midnight. Use a smaller number.");
    await form.getByLabel("Starting from").fill("23:58");
    await form.getByLabel("Move by (minutes)").fill("10");
    await move.click();
    await expect(form.getByRole("alert")).toHaveText("Nothing is scheduled at or after that time.");
    expect(myItem()).toEqual(mine);

    // Ten minutes later from 9:25 PM, with a reason, announced to everyone.
    await form.getByLabel("Starting from").fill("21:25");
    await form.getByLabel("Direction").selectOption({ label: "Later" });
    await form.getByLabel("Reason").fill("Track is being dried after the shower.");
    await expect(form.getByRole("checkbox", { name: "Announce the change to everyone" })).toBeChecked();
    await move.click();
    await expect(toast(page, /^1 items? moved 10 minutes later$/)).toBeVisible();
    await expect(editorRow(page)).toContainText(clock(mine!.start + 10));
    await expect(editorRow(page)).toContainText(`to ${clock(mine!.end + 10)}`);
    expect(seededSchedule(), "sessions before 9:25 PM, and Saturday's").toEqual(untouched);

    const told = sentAlert("Schedule running 10 minutes later", "Everything from 9:25 PM on Sunday moves 10 minutes later. Track is being dried after the shower. Your times in the app are already updated.");
    expect(told, "an alert about the delay").not.toBeNull();
    expect(told!.to).toEqual(audience("true"));
    // Even a Green driver, who is not in the session that moved, is told.
    const green = drivers("g.key = 'green'")[0];
    const greenPage = await asEmail(green.email);
    await go(greenPage, "/alerts");
    await expect(greenPage.getByRole("listitem").filter({ hasText: "Schedule running 10 minutes later" }).first()).toContainText("Track is being dried after the shower.");
    await go(greenPage, "/home");
    await expect(greenPage.getByRole("heading", { name: "Announcements" }).locator("xpath=ancestor::div[2]")).toContainText("Schedule running 10 minutes later");

    // And back again, ten minutes earlier, this time without an announcement.
    const before = announcements();
    await page.getByRole("button", { name: "Delay or advance" }).click();
    await form.getByLabel("Starting from").fill("21:25");
    await form.getByLabel("Move by (minutes)").fill("10");
    await form.getByLabel("Direction").selectOption({ label: "Earlier" });
    await form.getByRole("checkbox", { name: "Announce the change to everyone" }).uncheck();
    await move.click();
    await expect(toast(page, /^1 items? moved 10 minutes earlier$/)).toBeVisible();
    await expect(editorRow(page)).toContainText(clock(mine!.start));
    expect(myItem()).toEqual(mine);
    expect(announcements()).toBe(before);
    expect(seededSchedule(), "the seeded sessions").toEqual(untouched);
  });

  test("cancelling a session alerts the drivers in it and shows as cancelled; restoring it puts it back", async ({ page, asEmail }) => {
    const e = event();
    const mine = myItem();
    test.skip(!mine, "needs the session added earlier in this file");
    const untouched = seededSchedule();
    const solo = drivers("g.key = 'blue' and r.solo and r.attends_day2")[0];
    const instructed = drivers("g.key = 'blue' and not r.solo and r.attends_day2")[0];
    const at = clock(mine!.start);

    await go(page, `/admin/schedule?day=${e.end}`);
    const asked = nextConfirm(page);
    await editorRow(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editorRow(page).getByText("Cancelled", { exact: true })).toBeVisible();
    expect(asked.text).toBe(`Cancel “${mine!.title}” at ${at}? Everyone in it is alerted straight away.`);
    await expect(editorRow(page).getByRole("button", { name: "Restore" })).toBeVisible();

    const cancelled = sentAlert(`Cancelled: ${mine!.title}, ${at}`, `Sunday's ${at} ${mine!.title} session will not run.`);
    expect(cancelled, "an alert that the session is off").not.toBeNull();
    expect(cancelled!.to).toEqual(audience(BLUE_SOLO_AND_WHITE));
    expect(cancelled!.to).not.toContain(instructed.email);

    // The driver in it sees it struck out on the schedule, no longer marked as theirs, and has the alert.
    const soloPage = await asEmail(solo.email);
    await go(soloPage, `/schedule?day=${e.end}`);
    const theirs = dayColumn(soloPage, "Sunday").getByRole("listitem").filter({ hasText: mine!.title });
    await expect(theirs.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(theirs.getByText("You", { exact: true })).toHaveCount(0);
    await go(soloPage, "/alerts");
    await expect(soloPage.getByRole("listitem").filter({ hasText: `Cancelled: ${mine!.title}, ${at}` })).toContainText("will not run");
    // The Blue driver who is not in it was not bothered.
    const instructedPage = await asEmail(instructed.email);
    await go(instructedPage, "/alerts");
    await expect(instructedPage.locator("main")).not.toContainText(`Cancelled: ${mine!.title}`);

    // Restore: back on the schedule, and the same drivers are told.
    await editorRow(page).getByRole("button", { name: "Restore" }).click();
    await expect(editorRow(page).getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await expect(editorRow(page).getByText("Cancelled", { exact: true })).toHaveCount(0);
    const back = sentAlert(`Back on: ${mine!.title}, ${at}`, `Sunday's ${at} ${mine!.title} session is back on the schedule.`);
    expect(back, "an alert that the session is back on").not.toBeNull();
    expect(back!.to).toEqual(audience(BLUE_SOLO_AND_WHITE));
    await go(soloPage, `/schedule?day=${e.end}`);
    await expect(theirs.getByText("Cancelled", { exact: true })).toHaveCount(0);
    await expect(theirs.getByText("You", { exact: true })).toBeVisible();
    expect(seededSchedule(), "the seeded sessions").toEqual(untouched);
  });

  test("items for every driver or for instructors need a title and reach the right people; deleting removes an item without an alert", async ({ page, asEmail }) => {
    const e = event();
    const untouched = seededSchedule();
    const add = async (audienceLabel: string, type: string, title: string, start: string, end: string, note: string) => {
      await go(page, `/admin/schedule?day=${e.end}`);
      await page.getByRole("button", { name: "Add item" }).click();
      const form = sheet(page);
      await form.getByLabel("Type").selectOption({ label: type });
      await form.getByLabel("Starts").fill(start);
      await form.getByLabel("Ends").fill(end);
      await form.getByLabel("Who it is for").selectOption({ label: audienceLabel });
      // The run group choices go away when the item is not for run groups, and a title becomes necessary.
      await expect(form.getByRole("checkbox", { name: "Blue", exact: true })).toHaveCount(0);
      await form.getByLabel("Note").fill(note);
      await form.getByRole("button", { name: "Add to schedule" }).click();
      await expect(form.getByRole("alert")).toHaveText("Give the item a title.");
      await form.getByLabel("Title").fill(title);
      await form.getByRole("checkbox", { name: "Send an alert about this change to the people it affects" }).check();
      await form.getByRole("button", { name: "Add to schedule" }).click();
      await expect(toast(page, "Added to the schedule")).toBeVisible();
    };
    const everyoneNote = `UAT ${T} everyone`;
    const instructorNote = `UAT ${T} instructors`;
    const infoNote = `UAT ${T} information`;
    await add("Every driver", "Meeting", `UAT ${T} closing meeting`, "22:10", "22:20", everyoneNote);
    await expect(editorRow(page, everyoneNote)).toContainText("Meeting · Every driver");
    expect(sentAlert("Schedule change", `Added: UAT ${T} closing meeting, Sunday 10:10 PM to 10:20 PM.`)?.to).toEqual(audience("true"));

    await add("Instructors", "Meeting", `UAT ${T} instructor debrief`, "22:20", "22:30", instructorNote);
    await expect(editorRow(page, instructorNote)).toContainText("Meeting · Instructors");
    expect(sentAlert("Schedule change", `Added: UAT ${T} instructor debrief, Sunday 10:20 PM to 10:30 PM.`)?.to).toEqual(audience("r.is_instructor"));

    // "Information only" appears on the schedule but alerts nobody, even with the box ticked.
    const before = announcements();
    await add("Information only, no reminders", "Information", `UAT ${T} gates close`, "22:30", "22:40", infoNote);
    await expect(editorRow(page, infoNote)).toContainText("Info · No reminders");
    expect(announcements()).toBe(before);

    // A Green driver: the meeting for every driver is theirs, the instructors' one is not.
    const green = drivers("g.key = 'green' and r.attends_day2")[0];
    const greenPage = await asEmail(green.email);
    await go(greenPage, `/schedule?day=${e.end}`);
    const sunday = dayColumn(greenPage, "Sunday");
    await expect(sunday.getByRole("listitem").filter({ hasText: everyoneNote }).getByText("You", { exact: true })).toBeVisible();
    await expect(sunday.getByRole("listitem").filter({ hasText: instructorNote })).toBeVisible();
    await expect(sunday.getByRole("listitem").filter({ hasText: instructorNote }).getByText("You", { exact: true })).toHaveCount(0);
    await expect(sunday.getByRole("listitem").filter({ hasText: infoNote })).toBeVisible();
    // An instructor has both meetings marked.
    const rosalind = await asEmail(PEOPLE.rosalind.email);
    await go(rosalind, `/schedule?day=${e.end}`);
    await expect(dayColumn(rosalind, "Sunday").getByRole("listitem").filter({ hasText: instructorNote }).getByText("You", { exact: true })).toBeVisible();

    // Delete everything this file added. Nobody is alerted about a deletion.
    const quiet = announcements();
    for (const note of [everyoneNote, instructorNote, infoNote, NOTE]) {
      await go(page, `/admin/schedule?day=${e.end}`);
      if (!count(`select count(*) from schedule_items where event_id = '${e.id}' and note = '${q(note)}'`)) continue;
      await editorRow(page, note).getByRole("button", { name: /^Edit / }).click();
      const asked = nextConfirm(page);
      await sheet(page).getByRole("button", { name: "Delete" }).click();
      await expect(toast(page, "Removed from the schedule")).toBeVisible();
      expect(asked.text).toMatch(/^Remove “.+” from the schedule\? Use Cancel instead if drivers should be told it is off\.$/);
      await expect(editorRow(page, note)).toHaveCount(0);
    }
    expect(announcements()).toBe(quiet);
    await go(greenPage, `/schedule?day=${e.end}`);
    await expect(dayColumn(greenPage, "Sunday")).not.toContainText(`UAT ${T}`);
    expect(count(`select count(*) from schedule_items where event_id = '${e.id}' and note like 'UAT ${q(T)}%'`)).toBe(0);
    expect(seededSchedule(), "the seeded sessions").toEqual(untouched);
  });
});

// ───── announcements

/** Emails the delivery log recorded for a message, by channel. Nothing is really sent from the sandbox: every row must say "simulated". */
const logged = (subjectOrBody: string, channel: "email" | "sms" | "push") =>
  sql(`select to_address, status from message_log where channel = '${channel}' and (subject = '${q(subjectOrBody)}' or body like '${q(subjectOrBody)}%') order by 1`);

test.describe("announcements", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "marian");
  });

  test("an announcement to everyone reaches every registered person's alerts and Now screen, and is logged for email and text", async ({ page, asEmail }) => {
    const total = registered();
    const title = `UAT ${T} gates open at 6:30`;
    const body = `UAT ${T}: gates open at 6:30 AM on Saturday. Have your numbers on before you reach tech.`;
    await go(page, "/admin/announcements");
    await expect(page.getByText(/Email and text messages are\s+not connected yet/)).toBeVisible();
    const send = page.getByRole("button", { name: /^Send to/ });
    // "Everyone" is the starting choice and the button says how many people that is.
    await expect(page.getByRole("radio", { name: /^Everyone/ })).toBeChecked();
    await expect(send).toHaveText(`Send to ${total} people`);

    // A two-letter title is not a title.
    await page.getByRole("textbox", { name: "Title" }).fill("Hi");
    await page.getByRole("textbox", { name: "Message" }).fill(body);
    let asked = nextConfirm(page);
    await send.click();
    await expect(page.getByRole("alert").filter({ hasText: "Give the announcement a short title." })).toBeVisible();
    expect(asked.text).toBe(`Send this to ${total} people?`);
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(body);

    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await page.getByRole("checkbox", { name: /^Text message/ }).check();
    await page.getByRole("checkbox", { name: /^Email/ }).check();
    await expect(page.getByRole("checkbox", { name: /^Push notification/ })).toBeChecked();
    asked = nextConfirm(page);
    await send.click();
    await expect(toast(page, `Sent to ${total} people`)).toBeVisible();
    // The form empties itself, ready for the next one.
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");

    const sent = section(page, "Sent").getByRole("listitem").filter({ hasText: title });
    await expect(sent).toContainText(body);
    await expect(sent).toContainText("Everyone");
    await expect(sent).toContainText(`${total} people`);
    await expect(sent).toContainText("App, Email, Text, Push");
    await expect(sent).toContainText("Marian Castellanos");

    // Everyone on the roster has it, once each.
    const got = sentAlert(title, body);
    expect(got!.to).toEqual(audience("true"));
    expect(got!.urgent).toBe(false);
    // Email goes to those who left email on; texts to those who turned texts on and have a number. All simulated.
    const emails = logged(title, "email");
    expect(emails.map((r) => r[0])).toEqual(sql(`select u.email from registrations r join users u on u.id = r.user_id where r.event_id = '${event().id}' and r.status <> 'cancelled' and u.notify_email order by 1`).map((r) => r[0]));
    const texts = logged(`${title}: `, "sms");
    expect(texts.map((r) => r[0])).toEqual(sql(`select u.phone from registrations r join users u on u.id = r.user_id where r.event_id = '${event().id}' and r.status <> 'cancelled' and u.notify_sms and u.phone is not null order by 1`).map((r) => r[0]));
    expect([...emails, ...texts].every((r) => r[1] === "simulated"), "every email and text is recorded as simulated").toBe(true);

    // The delivery log shows the same thing to the administrator.
    const reader = drivers("g.key = 'green' and u.notify_email")[0];
    await page.getByRole("link", { name: "Delivery log" }).click();
    await page.waitForURL("**/admin/announcements?tab=log");
    for (const [label, provider] of [["Email", "Resend"], ["Text messages", "Twilio"], ["Push notifications", "Web Push"]]) {
      const card = page.locator("main div").filter({ has: page.getByText(label, { exact: true }) }).filter({ hasText: "Not set up" }).last();
      await expect(card).toContainText(`Messages are logged as “simulated” until ${provider} keys are added.`);
    }
    const entry = page.getByRole("listitem").filter({ hasText: title }).filter({ hasText: `to ${reader.email}` });
    await expect(entry).toContainText("Email");
    await expect(entry).toContainText("Simulated");
    await expect(entry).toContainText("announcement");

    // A driver finds it under Alerts and on the Now screen.
    const driver = await asEmail(reader.email);
    await go(driver, "/alerts");
    const alert = driver.getByRole("listitem").filter({ hasText: title });
    await expect(alert).toContainText(body);
    await expect(alert).toContainText("Announcement");
    await expect(alert).not.toContainText("Urgent");
    await expect(alert.getByLabel("Unread")).toBeVisible();
    await go(driver, "/alerts?tab=reminders");
    await expect(driver.locator("main")).not.toContainText(title);
    await go(driver, "/home");
    await expect(driver.getByRole("heading", { name: "Announcements" }).locator("xpath=ancestor::div[2]").getByRole("listitem").first()).toContainText(title);
  });

  test("an urgent announcement to one run group reaches that group only, marked urgent", async ({ page, asEmail }) => {
    const title = `UAT ${T} Green: walk the track at lunch`;
    const body = `UAT ${T}: meet at the false grid at 12:15 for a walk of Turns 1 to 4.`;
    const greens = audience("g.key = 'green'");
    const blues = audience("g.key = 'blue'");
    await go(page, "/admin/announcements");
    await pick(page.getByRole("radio", { name: /^Run groups/ }));
    const send = page.getByRole("button", { name: /^Send to/ });
    // Nobody is chosen yet, so there is nobody to send to.
    await expect(send).toBeDisabled();
    await expect(send).toHaveText("Send to 0 people");
    // Each run group shows how many are in it, and the button adds them up.
    await expect(page.getByRole("checkbox", { name: new RegExp(`^Green\\s*${greens.length}$`) })).toBeAttached();
    await pick(page.getByRole("checkbox", { name: /^Green/ }));
    await pick(page.getByRole("checkbox", { name: /^Blue/ }));
    await expect(send).toHaveText(`Send to ${greens.length + blues.length} people`);
    await pick(page.getByRole("checkbox", { name: /^Blue/ }));
    await expect(send).toHaveText(`Send to ${plural(greens.length, "person", "people")}`);
    // The composer has no way to pick half of Blue (Instructed or Solo): a run group is all or nothing here.
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await page.getByRole("textbox", { name: "Message" }).fill(body);
    await page.getByRole("checkbox", { name: /^Urgent\./ }).check();
    await send.click();
    await expect(toast(page, `Sent to ${plural(greens.length, "person", "people")}`)).toBeVisible();

    const sent = section(page, "Sent").getByRole("listitem").filter({ hasText: title });
    await expect(sent.getByText("Green", { exact: true })).toBeVisible();
    await expect(sent).toContainText(`${plural(greens.length, "person", "people")}`);
    await expect(sent).toContainText("App, Push");
    const got = sentAlert(title, body);
    expect(got!.to).toEqual(greens);
    expect(got!.urgent).toBe(true);
    expect(logged(title, "email"), "no email was asked for, so none is logged").toEqual([]);

    // A Green driver: urgent, in Alerts and at the top of the Now screen's announcements.
    const green = await asEmail(drivers("g.key = 'green'")[0].email);
    await go(green, "/alerts");
    await expect(green.getByRole("listitem").filter({ hasText: title })).toContainText("Urgent");
    await go(green, "/home");
    const card = green.getByRole("heading", { name: "Announcements" }).locator("xpath=ancestor::div[2]").getByRole("listitem").first();
    await expect(card).toContainText(title);
    await expect(card).toContainText("Urgent");

    // A White driver does not have it anywhere.
    const white = await asEmail(drivers("g.key = 'white'")[0].email);
    await go(white, "/alerts");
    await expect(white.locator("main")).not.toContainText(title);
    await go(white, "/home");
    await expect(white.locator("main")).not.toContainText(title);
  });

  test("announcements for instructors, for students with an instructor, and for administrators reach exactly those people", async ({ page, as }) => {
    const e = event();
    const cases: { choose: RegExp; label: string; who: string[] }[] = [
      { choose: /^Instructors/, label: "Instructors", who: audience("r.is_instructor") },
      { choose: /^Students with an instructor/, label: "Students with an instructor", who: sql(`select u.email from instructor_assignments a join users u on u.id = a.student_id where a.event_id = '${e.id}' order by 1`).map((r) => r[0]) },
      { choose: /^Administrators/, label: "Administrators", who: sql(`select u.email from memberships m join users u on u.id = m.user_id where m.is_admin order by 1`).map((r) => r[0]) },
    ];
    await go(page, "/admin/announcements");
    for (const c of cases) {
      const title = `UAT ${T} for ${c.label.toLowerCase()}`;
      const body = `UAT ${T}: a note for ${c.label.toLowerCase()} only.`;
      await pick(page.getByRole("radio", { name: c.choose }));
      await expect(page.getByRole("radio", { name: c.choose })).toHaveAccessibleName(new RegExp(`${c.who.length}$`));
      await page.getByRole("textbox", { name: "Title" }).fill(title);
      await page.getByRole("textbox", { name: "Message" }).fill(body);
      await page.getByRole("button", { name: /^Send to/ }).click();
      await expect(toast(page, `Sent to ${plural(c.who.length, "person", "people")}`)).toBeVisible();
      await expect(section(page, "Sent").getByRole("listitem").filter({ hasText: title })).toContainText(c.label);
      expect(sentAlert(title, body)!.to, `who got the announcement for ${c.label.toLowerCase()}`).toEqual(c.who);
      await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
    }
    // Rosalind instructs but is not an administrator: she has the first and not the third.
    const rosalind = await as("rosalind");
    await go(rosalind, "/alerts");
    await expect(rosalind.getByRole("listitem").filter({ hasText: `UAT ${T} for instructors` })).toBeVisible();
    await expect(rosalind.locator("main")).not.toContainText(`UAT ${T} for administrators`);
  });
});

// ───── events and history

const weekdayOf = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${day}T12:00:00Z`));
/** "November 21–22, 2026", the way the app writes an event's dates. */
function dateRange(start: string, end: string) {
  if (start === end) return longDate(start);
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${end}T12:00:00Z`);
  const month = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(d);
  return a.getUTCMonth() === b.getUTCMonth() ? `${month(a)} ${a.getUTCDate()}–${b.getUTCDate()}, ${b.getUTCFullYear()}` : `${monthDay(start)} – ${monthDay(end)}, ${b.getUTCFullYear()}`;
}
const NEW_EVENT = `UAT ${T} Winter Driver Education`;
const newEvent = () => {
  const [r] = sql(`select id, start_date, end_date, status from events where name = '${q(NEW_EVENT)}'`);
  return r ? { id: r[0], start: r[1], end: r[2], status: r[3] } : null;
};
const eventCard = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) }).filter({ visible: true });
const otherEventBanner = (page: Page) => page.getByText(/^You are looking at .+, not the current event\.$/);
const dayTabs = (page: Page) => page.getByRole("navigation", { name: "Day" }).getByRole("link");

/** Open the test event's Edit sheet, change something, save. Every save should be confirmed with "Event saved". */
async function editEvent(page: Page, change: (form: Locator) => Promise<void>, expectConfirmation = true) {
  await eventCard(page, NEW_EVENT).getByRole("button", { name: "Edit" }).click();
  await expect(sheet(page).getByRole("heading", { name: "Edit event" })).toBeVisible();
  await change(sheet(page));
  await sheet(page).getByRole("button", { name: "Save event" }).click();
  if (expectConfirmation) await expect(toast(page, "Event saved")).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
}

test.describe("events and history", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "marian");
  });

  test("a new event starts as a draft the administrator is put to work on, and a schedule can be copied into it", async ({ page, as }) => {
    const e = event();
    const untouched = seededSchedule();
    const start = addDays(e.start, 70); // a Saturday, well after the current event
    const end = addDays(start, 1);
    await go(page, "/admin/events");
    // The list: the current event on top, marked as the one in hand, with its numbers; finished events below.
    const current = eventCard(page, e.name);
    await expect(section(page, "Current and upcoming").getByRole("listitem").filter({ hasText: e.name })).toBeVisible();
    await expect(current).toContainText("Working on this");
    await expect(current).toContainText("Published");
    await expect(current).toContainText(`${dateRange(e.start, e.end)} · Roebling Road Raceway`);
    await expect(current.locator("dt", { hasText: "Registered" }).locator("xpath=following-sibling::dd[1]")).toHaveText(String(registered()));
    for (const [name] of sql(`select name from events where status = 'completed' and name not like 'UAT %'`)) await expect(section(page, "Past events").getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) })).toContainText("Completed");

    await page.getByRole("button", { name: "New event" }).click();
    const form = sheet(page);
    await expect(form.getByRole("heading", { name: "New event" })).toBeVisible();
    await expect(form).toContainText("Creates a draft. Build the schedule and roster, then publish it.");
    await expect(form.getByLabel("Status")).toHaveValue("draft");
    await form.getByLabel("Name").fill(NEW_EVENT);
    await form.getByLabel("Track").selectOption({ label: "Roebling Road Raceway" });
    await form.getByLabel("Start from another event's schedule").selectOption({ label: "Start with an empty schedule" });
    await form.getByLabel("Registration link").fill("https://clubregistration.net/events/uat-winter");
    await form.getByLabel("Description").fill("Made by the acceptance tests.");
    // The dates have to make sense.
    await form.getByLabel("First day").fill(end);
    await form.getByLabel("Last day").fill(start);
    await form.getByRole("button", { name: "Create event" }).click();
    await expect(form.getByRole("alert")).toHaveText("The last day cannot be before the first day.");
    await form.getByLabel("First day").fill(start);
    await form.getByLabel("Last day").fill(addDays(start, 7));
    await form.getByRole("button", { name: "Create event" }).click();
    await expect(form.getByRole("alert")).toHaveText("Events can run for up to a week.");
    expect(newEvent(), "nothing is created while the form has an error").toBeNull();
    await form.getByLabel("Last day").fill(end);
    await form.getByRole("button", { name: "Create event" }).click();
    await expect(toast(page, `${NEW_EVENT} created. You are now working on it.`)).toBeVisible();

    // It is a draft, it is in focus, and a yellow strip says this is not the current event.
    await expect(otherEventBanner(page)).toHaveText(`You are looking at ${NEW_EVENT} (${dateRange(start, end)}), not the current event.`);
    const card = eventCard(page, NEW_EVENT);
    await expect(card).toContainText("Working on this");
    await expect(card).toContainText("Draft");
    await expect(current).not.toContainText("Working on this");
    await go(page, "/admin");
    await expect(page.getByRole("heading", { level: 1, name: NEW_EVENT })).toBeVisible();
    await expect(pageHeader(page)).toContainText("Draft");
    await expect(page.getByRole("link", { name: /^Registered/ })).toHaveText(/^Registered\s*0\s*0 instructing$/);

    // Its schedule is empty, and the editor warns that drivers cannot see a draft.
    await go(page, "/admin/schedule");
    await expect(page.getByText("This event is a draft")).toBeVisible();
    await expect(page.getByText("Drivers cannot see it until you publish the event under Events and history.")).toBeVisible();
    await expect(page.getByText("Nothing scheduled for Saturday")).toBeVisible();

    // Copy the summer event's schedule, which ran the alternate Sunday with Blue split in two.
    const summer = sql(`select id, name, start_date from events where slug = 'summer-de'`)[0];
    const perDay = (id: string, first: string) => [0, 1].map((i) => count(`select count(*) from schedule_items where event_id = '${id}' and day = '${addDays(first, i)}'`));
    const [sat, sun] = perDay(summer[0], summer[2]);
    await page.getByRole("button", { name: "Copy from an event" }).click();
    await expect(sheet(page).getByRole("heading", { name: "Copy a schedule" })).toBeVisible();
    await sheet(page).getByLabel("Copy from").selectOption({ label: `${summer[1]} (${dateRange(summer[2], addDays(summer[2], 1))})` });
    await sheet(page).getByRole("button", { name: "Copy schedule" }).click();
    await expect(toast(page, `Copied ${sat + sun} items from ${summer[1]}`)).toBeVisible();
    await expect(dayTabs(page).nth(0)).toHaveText(new RegExp(`^Saturday ${monthDay(start)}\\s*${sat}$`));
    await expect(dayTabs(page).nth(1)).toHaveText(new RegExp(`^Sunday ${monthDay(end)}\\s*${sun}$`));
    await dayTabs(page).nth(1).click();
    await page.waitForURL(`**/admin/schedule?day=${end}`);
    const split = page.getByRole("listitem").filter({ hasText: "Blue Solo and White" }).filter({ visible: true }).first();
    await expect(split).toContainText("1:15 PM");
    await expect(split.getByText("Blue Solo", { exact: true })).toBeVisible();
    await expect(split.getByText("White", { exact: true })).toBeVisible();

    // A second copy will not overwrite what is there unless told to.
    const spring = sql(`select id, name, start_date from events where slug = 'spring-de'`)[0];
    const springLabel = `${spring[1]} (${dateRange(spring[2], addDays(spring[2], 1))})`;
    await page.getByRole("button", { name: "Copy from an event" }).click();
    await sheet(page).getByLabel("Copy from").selectOption({ label: springLabel });
    await sheet(page).getByRole("button", { name: "Copy schedule" }).click();
    await expect(sheet(page).getByRole("alert")).toHaveText("This event already has a schedule. Tick “Replace the current schedule” to overwrite it.");
    expect(count(`select count(*) from schedule_items where event_id = '${newEvent()!.id}'`)).toBe(sat + sun);
    await sheet(page).getByRole("checkbox", { name: "Replace the current schedule" }).check();
    await sheet(page).getByRole("button", { name: "Copy schedule" }).click();
    const [sat2, sun2] = perDay(spring[0], spring[2]);
    await expect(toast(page, `Copied ${sat2 + sun2} items from ${spring[1]}`)).toBeVisible();
    await expect(dayTabs(page).nth(1)).toHaveText(new RegExp(`^Sunday ${monthDay(end)}\\s*${sun2}$`));
    await expect(page.getByRole("listitem").filter({ hasText: "Blue Solo and White" }).filter({ visible: true })).toHaveCount(0);

    // None of this touched the current event, and other people still see the current event.
    expect(seededSchedule(), "the current event's schedule").toEqual(untouched);
    const hank = await as("hank");
    await expect(otherEventBanner(hank)).toHaveCount(0);
    await go(hank, "/schedule");
    await expect(pageHeader(hank)).toContainText(e.name);
    const simone = await as("simone");
    await go(simone, "/schedule");
    await expect(pageHeader(simone)).toContainText(e.name);
  });

  test("publishing, switching between events, moving the dates and completing an event", async ({ page, as }) => {
    const e = event();
    const mine = newEvent();
    test.skip(!mine, "needs the event created in the previous test");
    const edit = (change: (form: Locator) => Promise<void>) => editEvent(page, change);
    // A fresh sign-in starts on the current event, not on whatever was open last time.
    await go(page, "/admin/events");
    await expect(otherEventBanner(page)).toHaveCount(0);
    await expect(eventCard(page, e.name)).toContainText("Working on this");

    // Publish. A later event does not take over from the one happening this weekend.
    await edit((form) => form.getByLabel("Status").selectOption({ label: "Published" }).then(() => {}));
    await expect(eventCard(page, NEW_EVENT)).toContainText("Published");
    const simone = await as("simone");
    await go(simone, "/schedule");
    await expect(pageHeader(simone)).toContainText(e.name);

    // Switch to it and back.
    await eventCard(page, NEW_EVENT).getByRole("button", { name: "Work on this event" }).click();
    await expect(toast(page, `Now showing ${NEW_EVENT}`)).toBeVisible();
    await expect(otherEventBanner(page)).toContainText(NEW_EVENT);
    await expect(eventCard(page, NEW_EVENT)).toContainText("Working on this");
    await go(page, "/admin/roster");
    await expect(pageHeader(page)).toContainText(`Everyone registered for ${NEW_EVENT}`);
    await otherEventBanner(page).locator("..").getByRole("link", { name: "Switch event" }).click();
    await page.waitForURL("**/admin/events");
    await eventCard(page, NEW_EVENT).getByRole("button", { name: "Go back to the current event" }).click();
    await expect(toast(page, "Back to the current event")).toBeVisible();
    await expect(otherEventBanner(page)).toHaveCount(0);
    await expect(eventCard(page, e.name)).toContainText("Working on this");

    // Move it a day later: the schedule moves with it.
    const before = [0, 1].map((i) => count(`select count(*) from schedule_items where event_id = '${mine!.id}' and day = '${addDays(mine!.start, i)}'`));
    const start = addDays(mine!.start, 1);
    const end = addDays(mine!.end, 1);
    await edit(async (form) => {
      await form.getByLabel("First day").fill(start);
      await form.getByLabel("Last day").fill(end);
    });
    await expect(eventCard(page, NEW_EVENT)).toContainText(dateRange(start, end));
    await eventCard(page, NEW_EVENT).getByRole("button", { name: "Work on this event" }).click();
    await expect(otherEventBanner(page)).toContainText(dateRange(start, end));
    await go(page, "/admin/schedule");
    await expect(dayTabs(page).nth(0)).toHaveText(new RegExp(`^${weekdayOf(start)} ${monthDay(start)}\\s*${before[0]}$`));
    await expect(dayTabs(page).nth(1)).toHaveText(new RegExp(`^${weekdayOf(end)} ${monthDay(end)}\\s*${before[1]}$`));

    // Mark it completed: it joins the past events and its screens say it is finished.
    await go(page, "/admin/events");
    // (Whether this particular save is confirmed with a message is checked in the next test.)
    await editEvent(page, (form) => form.getByLabel("Status").selectOption({ label: "Completed" }).then(() => {}), false);
    await expect(section(page, "Past events").getByRole("listitem").filter({ has: page.getByText(NEW_EVENT, { exact: true }) })).toContainText("Completed");
    await expect(section(page, "Current and upcoming")).not.toContainText(NEW_EVENT);
    await go(page, "/admin/schedule");
    await expect(page.getByText("This event is finished")).toBeVisible();
    await expect(page.getByText("You are editing the record of a past event.")).toBeVisible();
    await go(page, "/admin");
    await expect(pageHeader(page)).toContainText("Completed");
    expect(newEvent()!.status).toBe("completed");
  });

  test("saving an event is confirmed with a message even when the save moves it between the upcoming and past lists", async ({ page }) => {
    test.skip(!newEvent(), "needs the event created earlier in this file");
    await go(page, "/admin/events");
    const status = async (label: string) => {
      await eventCard(page, NEW_EVENT).getByRole("button", { name: "Edit" }).click();
      await sheet(page).getByLabel("Status").selectOption({ label });
      await sheet(page).getByRole("button", { name: "Save event" }).click();
    };
    try {
      // From the past list back to upcoming…
      await status("Draft");
      await expect.soft(toast(page, "Event saved"), "a confirmation after moving the event back to draft").toBeVisible({ timeout: 4_000 });
      await expect(section(page, "Current and upcoming").getByRole("listitem").filter({ has: page.getByText(NEW_EVENT, { exact: true }) })).toContainText("Draft");
    } finally {
      // …and to the past list again, which is where this file leaves it.
      if (newEvent()!.status !== "completed") {
        await go(page, "/admin/events");
        await status("Completed");
        await expect.soft(toast(page, "Event saved"), "a confirmation after marking the event completed").toBeVisible({ timeout: 4_000 });
      }
      await expect(section(page, "Past events").getByRole("listitem").filter({ has: page.getByText(NEW_EVENT, { exact: true }) })).toContainText("Completed");
    }
  });

  test("opening a past event shows that event's own records, and what it closes to changes", async ({ as }) => {
    const e = event();
    const summer = sql(`select id, name, start_date, end_date from events where slug = 'summer-de'`)[0];
    const hankId = val(`select id from users where email = '${PEOPLE.hank.email}'`);
    const page = await as("hank");

    // On the current event Hank, a solo driver, can ask for an instructor, and his car is the one on this event's roster.
    const canAskNow = val(`select r.instructor_request is null and not r.is_instructor from registrations r where r.event_id = '${e.id}' and r.user_id = '${hankId}'`) === "t";
    if (canAskNow) await expect(page.getByRole("button", { name: "Ask for an instructor" })).toBeVisible();
    await go(page, "/me");
    await page.getByRole("button", { name: "Edit your car" }).click();
    await expect(sheet(page)).toContainText("This is the car on the roster and on your tech inspection for this event.");
    await sheet(page).getByRole("button", { name: "Close" }).click();

    await go(page, "/admin/events");
    await eventCard(page, summer[1]).getByRole("button", { name: "Open the record" }).click();
    await expect(toast(page, `Now showing ${summer[1]}`)).toBeVisible();
    await expect(otherEventBanner(page)).toHaveText(`You are looking at ${summer[1]} (${dateRange(summer[2], summer[3])}), not the current event.`);

    // The whole administrator area now shows the summer event.
    const then = count(`select count(*) from registrations where event_id = '${summer[0]}' and status <> 'cancelled'`);
    await go(page, "/admin");
    await expect(page.getByRole("heading", { level: 1, name: summer[1] })).toBeVisible();
    await expect(pageHeader(page)).toContainText("Completed");
    const instructing = count(`select count(*) from registrations where event_id = '${summer[0]}' and status <> 'cancelled' and is_instructor`);
    await expect(page.getByRole("link", { name: /^Registered/ })).toHaveText(new RegExp(`^Registered\\s*${then}\\s*${instructing} instructing$`));
    await go(page, "/admin/roster");
    await expect(page.getByText(/^Showing \d+ of /)).toHaveText(`Showing ${then} of ${then} people`);
    await go(page, "/admin/schedule");
    await expect(page.getByText("This event is finished")).toBeVisible();
    await go(page, "/admin/incidents");
    await expect(page.getByRole("heading", { name: `${summer[1]} · event in focus` })).toBeVisible();
    await go(page, "/schedule");
    await expect(page.getByText("This event has finished. The schedule below is how the weekend ran.")).toBeVisible();

    // A finished event no longer takes ride-along requests, and editing the car no longer touches its roster.
    await go(page, "/home");
    await expect(page.getByRole("button", { name: "Ask for an instructor" })).toHaveCount(0);
    await go(page, "/me");
    await page.getByRole("button", { name: "Edit your car" }).click();
    await expect(sheet(page)).toContainText("The car you usually bring to the track.");
    await expect(sheet(page)).not.toContainText("Changing the number here changes it on this event's roster.");
    await sheet(page).getByRole("button", { name: "Close" }).click();

    // Back to the current event.
    await otherEventBanner(page).locator("..").getByRole("link", { name: "Switch event" }).click();
    await page.waitForURL("**/admin/events");
    await eventCard(page, summer[1]).getByRole("button", { name: "Go back to the current event" }).click();
    await expect(toast(page, "Back to the current event")).toBeVisible();
    await go(page, "/admin");
    await expect(page.getByRole("heading", { level: 1, name: e.name })).toBeVisible();
    await expect(otherEventBanner(page)).toHaveCount(0);
  });
});

// ───── settings

/** Everything the Settings screen stores, to prove a test put it all back. */
const storedSettings = () => sql(`select settings::text, name, short_name, coalesce(website, '') from organizations`)[0];
const storedGroup = (key: string) => sql(`select name, summary, description, color, text_color, instructor_policy, coalesce(passing_key, '') from run_groups where key = '${key}'`)[0];
const fieldset = (page: Page, legend: string) => page.getByRole("group", { name: legend, exact: true });
async function saveSettings(page: Page) {
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(toast(page, "Settings saved")).toBeVisible();
}

test.describe("settings", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "marian");
  });

  test("region details and the event chair are saved, show where they are used, and can be put back", async ({ page, as }) => {
    const original = storedSettings();
    const chair = JSON.parse(original[0]).eventChair as { name: string; phone?: string; email?: string };
    await go(page, "/admin/settings");
    const region = fieldset(page, "Region");
    const chairFields = fieldset(page, "Event chair");
    await expect(region.getByLabel("Name", { exact: true })).toHaveValue(original[1]);
    await expect(region.getByLabel("Short name")).toHaveValue(original[2]);
    await expect(chairFields.getByLabel("Name", { exact: true })).toHaveValue(chair.name);
    try {
      await region.getByLabel("Name", { exact: true }).fill("Coastal Empire Region UAT, Porsche Club of America");
      await region.getByLabel("Short name").fill("CER-UAT");
      await region.getByLabel("Website").fill("https://uat.example.org/");
      await chairFields.getByLabel("Name", { exact: true }).fill("Dale Whitfield");
      await chairFields.getByLabel("Phone").fill("(912) 555-0144");
      await chairFields.getByLabel("Email").fill("dale.whitfield@example.com");
      await saveSettings(page);

      // The short name heads everyone's menu.
      const simone = await as("simone");
      await expect(simone.getByText("CER-UAT · Track Day")).toBeVisible();
      // A new incident report starts with the region and the chair filled in from here.
      await go(page, "/admin/incidents/new");
      await expect(page.getByLabel("PCA region")).toHaveValue("Coastal Empire Region UAT");
      await expect(page.getByLabel("Name of event chair")).toHaveValue("Dale Whitfield");
      const eventItem = page.getByRole("heading", { name: "Item 1: Event" }).locator("xpath=ancestor::div[3]");
      await expect(eventItem.getByLabel("Telephone")).toHaveValue("(912) 555-0144");
      await expect(eventItem.getByLabel("Email")).toHaveValue("dale.whitfield@example.com");
    } finally {
      await go(page, "/admin/settings");
      await fieldset(page, "Region").getByLabel("Name", { exact: true }).fill(original[1]);
      await fieldset(page, "Region").getByLabel("Short name").fill(original[2]);
      await fieldset(page, "Region").getByLabel("Website").fill(original[3]);
      await fieldset(page, "Event chair").getByLabel("Name", { exact: true }).fill(chair.name);
      await fieldset(page, "Event chair").getByLabel("Phone").fill(chair.phone ?? "");
      await fieldset(page, "Event chair").getByLabel("Email").fill(chair.email ?? "");
      await saveSettings(page);
    }
    expect(storedSettings()).toEqual(original);
    await go(page, "/admin/settings");
    await expect(page.getByText(`${original[2]} · Track Day`)).toBeVisible();

    // What the app is connected to is spelled out: nothing leaves the sandbox.
    const connections = section(page, "Connections");
    await expect(connections.getByRole("listitem").filter({ hasText: "Email" })).toContainText("Not connected: emails are logged, not sent");
    await expect(connections.getByRole("listitem").filter({ hasText: "Text messages" })).toContainText("Not connected: texts are logged, not sent");
    await expect(connections.getByRole("listitem").filter({ hasText: "Reminder job" })).toContainText("Protected by CRON_SECRET");
    await expect(connections.getByRole("listitem").filter({ hasText: "Demo mode" })).toContainText("On");
  });

  test("incident report recipients can be added and corrected, and show on a report's send list and printout", async ({ page }) => {
    const original = storedSettings();
    const recipients = JSON.parse(original[0]).incidentRecipients as { role: string; name?: string; email: string }[];
    const zone = recipients.findIndex((r) => r.role === "Zone Representative");
    test.skip(zone === -1 || Boolean(recipients[zone].email), "expects the seeded Zone Representative with no address yet");
    const report = val(`select id from incidents where status = 'sent' order by created_at limit 1`);
    const next = recipients.length + 1; // the first of the two spare rows
    const list = fieldset(page, "Incident report recipients");

    // As seeded, a sent report's send list flags the recipient with no address.
    await go(page, `/admin/incidents/${report}`);
    const sendTo = page.getByRole("heading", { name: "Send to PCA" }).locator("xpath=ancestor::div[2]");
    await expect(sendTo.getByRole("listitem").filter({ hasText: "Zone Representative" })).toContainText("Needs an email address");

    await go(page, "/admin/settings");
    for (let i = 0; i < recipients.length; i++) await expect(list.getByLabel(`Recipient ${i + 1} role`)).toHaveValue(recipients[i].role);
    try {
      // A malformed address is refused, by name.
      await list.getByLabel(`Recipient ${zone + 1} email`).fill("zone-rep@pca");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "is not a valid email address" })).toHaveText("“zone-rep@pca” is not a valid email address.");
      expect(storedSettings()).toEqual(original);

      await list.getByLabel(`Recipient ${zone + 1} email`).fill("zone12.rep@example.org");
      await list.getByLabel(`Recipient ${zone + 1} name`).fill("Pat Example");
      await list.getByLabel(`Recipient ${next} role`).fill("Region President");
      await list.getByLabel(`Recipient ${next} name`).fill("Robin Sample");
      await list.getByLabel(`Recipient ${next} email`).fill("president@example.org");
      await saveSettings(page);
      // After a reload the new recipient has its own row and there are two spare rows again.
      await go(page, "/admin/settings");
      await expect(list.getByLabel(`Recipient ${next} role`)).toHaveValue("Region President");
      await expect(list.getByLabel(`Recipient ${next + 2} role`)).toHaveValue("");

      await go(page, `/admin/incidents/${report}`);
      await expect(sendTo.getByRole("listitem").filter({ hasText: "Zone Representative" })).toContainText("Pat Example");
      await expect(sendTo.getByRole("listitem").filter({ hasText: "Zone Representative" })).toContainText("zone12.rep@example.org");
      await expect(sendTo.getByRole("listitem").filter({ hasText: "Region President" })).toContainText("president@example.org");
      await expect(sendTo).not.toContainText("Needs an email address");
      const mailto = await sendTo.getByRole("link", { name: "Open email" }).getAttribute("href");
      expect(mailto).toContain("zone12.rep@example.org");
      expect(mailto).toContain("president@example.org");
      await go(page, `/admin/incidents/${report}/print`);
      const printed = page.getByRole("row").filter({ hasText: "Region President" });
      await expect(printed).toContainText("Robin Sample");
      await expect(printed).toContainText("president@example.org");
    } finally {
      await go(page, "/admin/settings");
      await list.getByLabel(`Recipient ${zone + 1} email`).fill("");
      await list.getByLabel(`Recipient ${zone + 1} name`).fill("");
      for (const part of ["role", "name", "email"]) await list.getByLabel(`Recipient ${next} ${part}`).fill("");
      await saveSettings(page);
    }
    expect(storedSettings()).toEqual(original);
  });

  test("the tech inspection window is checked, and changing it changes which shop inspections are flagged", async ({ page }) => {
    const original = storedSettings();
    const win = JSON.parse(original[0]).techWindow as { earliestDays: number; latestDays: number };
    const e = event();
    // A reviewed form whose shop inspection was inside the window as seeded.
    const [form] = sql(
      `select t.id, (date '${e.start}' - t.inspection_date::date) from tech_inspections t join users u on u.id = t.user_id
        where t.event_id = '${e.id}' and t.method = 'online' and t.mechanic_signed_at is not null and t.inspection_date is not null
          and (date '${e.start}' - t.inspection_date::date) between ${win.latestDays + 2} and ${win.earliestDays}
          and u.email not in (${PROTECTED.map((x) => `'${x}'`).join(",")})
        order by 2 desc, u.last_name limit 1`,
    );
    const days = Number(form[1]);
    const window = fieldset(page, "Tech inspection window");
    await go(page, `/admin/tech/${form[0]}`);
    await expect(page.locator("main")).not.toContainText(`Inspected ${days} days before the event`);

    await go(page, "/admin/settings");
    await expect(window.getByLabel("No earlier than (days before)")).toHaveValue(String(win.earliestDays));
    await expect(window.getByLabel("No later than (days before)")).toHaveValue(String(win.latestDays));
    try {
      // The earliest day has to be further out than the latest.
      await window.getByLabel("No earlier than (days before)").fill("10");
      await window.getByLabel("No later than (days before)").fill("14");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "inspection window" })).toHaveText("The inspection window needs an earliest day count larger than the latest (for example 28 and 14).");
      expect(storedSettings()).toEqual(original);

      // Tighten the window so that form's inspection is now too early.
      await window.getByLabel("No earlier than (days before)").fill(String(days - 1));
      await window.getByLabel("No later than (days before)").fill(String(win.latestDays));
      await saveSettings(page);
      await go(page, `/admin/tech/${form[0]}`);
      await expect(page.getByText(`Inspected ${days} days before the event (earliest allowed: ${days - 1})`)).toBeVisible();
    } finally {
      await go(page, "/admin/settings");
      await window.getByLabel("No earlier than (days before)").fill(String(win.earliestDays));
      await window.getByLabel("No later than (days before)").fill(String(win.latestDays));
      await saveSettings(page);
    }
    expect(storedSettings()).toEqual(original);
    await go(page, `/admin/tech/${form[0]}`);
    await expect(page.locator("main")).not.toContainText(`Inspected ${days} days before the event`);
  });

  test("reminder lead times are checked and tidied, and drivers are told the times that were set", async ({ page, asEmail }) => {
    const original = storedSettings();
    const offsets = (JSON.parse(original[0]).reminderOffsets as number[]).join(", ");
    const reminders = fieldset(page, "Session reminders").getByLabel("Minutes before a session");
    // A driver with no reminders yet reads, on their Alerts screen, when to expect them.
    const quiet = drivers(`not exists (select 1 from notifications n where n.user_id = u.id and n.kind in ('reminder', 'schedule'))`)[0];
    const driver = await asEmail(quiet.email);
    await go(driver, "/alerts?tab=reminders");
    await expect(driver.getByText("Reminders arrive 15, 10 and 5 minutes before your run group goes on track and before your classroom sessions.")).toBeVisible();

    await go(page, "/admin/settings");
    await expect(reminders).toHaveValue(offsets);
    try {
      await reminders.fill("soon");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "reminder time" })).toHaveText("Enter at least one reminder time in minutes, for example 15, 10, 5.");
      expect(storedSettings()).toEqual(original);

      // Typed out of order, with a repeat and two that make no sense: saved as 20 and 8.
      await reminders.fill("8 20, 8, 0, 500");
      await saveSettings(page);
      await go(page, "/admin/settings");
      await expect(reminders).toHaveValue("20, 8");
      await go(driver, "/alerts?tab=reminders");
      await expect(driver.getByText("Reminders arrive 20 and 8 minutes before your run group goes on track and before your classroom sessions.")).toBeVisible();
    } finally {
      await go(page, "/admin/settings");
      await reminders.fill(offsets);
      await saveSettings(page);
    }
    expect(storedSettings()).toEqual(original);
  });

  test("the schedule editor quotes the region's own reminder lead times, not a fixed 15, 10 and 5", async ({ page }) => {
    const original = storedSettings();
    const reminders = fieldset(page, "Session reminders").getByLabel("Minutes before a session");
    await go(page, "/admin/settings");
    try {
      await reminders.fill("20, 8");
      await saveSettings(page);
      await go(page, "/admin/schedule");
      // The editor tells the administrator when reminders go out; with 20 and 8 set it must not still say 15, 10 and 5.
      await expect.soft(pageHeader(page), "the lead times quoted at the top of the schedule editor").toContainText("Reminders go out 20 and 8 minutes before each session", { timeout: 3_000 });
    } finally {
      await go(page, "/admin/settings");
      await reminders.fill((JSON.parse(original[0]).reminderOffsets as number[]).join(", "));
      await saveSettings(page);
    }
    expect(storedSettings()).toEqual(original);
  });

  test("a run group's name, level, colours, instructor rule and passing sheet can be edited, and the change shows across the app", async ({ page, asEmail }) => {
    const original = storedGroup("black");
    const member = drivers("g.key = 'black'")[0];
    const inBlack = audience("g.key = 'black'").length;
    const whiteSheet = val(`select p->>'title' from tracks t, jsonb_array_elements(t.guide->'passing') p where p->>'key' = 'white' limit 1`);
    const groups = section(page, "Run groups");
    const openGroup = async (name: string) => {
      await go(page, "/admin/settings");
      await groups.getByRole("button", { name: `Edit ${name}` }).click();
      await expect(sheet(page).getByRole("heading", { name: `${name} run group` })).toBeVisible();
      return sheet(page);
    };

    let form = await openGroup(original[0]);
    await expect(form.getByLabel("Level")).toHaveValue(original[1]);
    await expect(form.getByLabel("Instructors")).toHaveValue(original[5]);
    await expect(form.getByLabel("Passing-zone sheet")).toHaveValue(original[6]);
    // A name of only spaces is no name.
    await form.getByLabel("Name").fill("   ");
    await form.getByRole("button", { name: "Save run group" }).click();
    await expect(form.getByRole("alert")).toHaveText("The run group needs a name.");
    expect(storedGroup("black")).toEqual(original);

    try {
      await form.getByLabel("Name").fill("Onyx");
      await form.getByLabel("Level").fill("Expert UAT");
      await form.getByLabel("Who belongs here").fill(`UAT ${T}: the most experienced drivers at the event.`);
      await form.getByLabel("Colour", { exact: true }).fill("#5b2a86");
      await form.getByLabel("Text on that colour").fill("#fff200");
      await form.getByLabel("Instructors").selectOption({ label: "Instructed until signed off solo (two halves)" });
      await form.getByLabel("Passing-zone sheet").selectOption({ label: whiteSheet });
      await form.getByRole("button", { name: "Save run group" }).click();
      await expect(toast(page, "Run group saved")).toBeVisible();

      // The settings list shows the new chip, level, rule and sheet.
      const row = groups.getByRole("listitem").filter({ hasText: "Expert UAT" });
      await expect(row.getByText("Onyx", { exact: true })).toHaveCSS("background-color", "rgb(91, 42, 134)");
      await expect(row.getByText("Onyx", { exact: true })).toHaveCSS("color", "rgb(255, 242, 0)");
      await expect(row).toContainText(`Instructed, then solo · ${whiteSheet}`);
      // The roster's run group filter uses the new name.
      await go(page, "/admin/roster");
      await expect(page.getByLabel("Run group").getByRole("option", { name: `Onyx (${inBlack})` })).toBeAttached();
      // A group with two halves gets the "which drivers" choice in the schedule form.
      await go(page, "/admin/schedule");
      await page.getByRole("button", { name: "Add item" }).click();
      await pick(sheet(page).getByRole("checkbox", { name: "Onyx", exact: true }));
      await expect(sheet(page).getByLabel("Which Onyx drivers")).toBeVisible();
      await sheet(page).getByRole("button", { name: "Close" }).click();
      // A driver in the group sees the new name, level and description on their profile.
      const driver = await asEmail(member.email);
      await go(driver, "/me");
      const card = driver.getByRole("heading", { name: "Your run group" }).locator("..");
      await expect(card.getByText("Onyx", { exact: true })).toBeVisible();
      await expect(card).toContainText("Expert UAT");
      await expect(card).toContainText(`UAT ${T}: the most experienced drivers at the event.`);
    } finally {
      const current = storedGroup("black")[0];
      form = await openGroup(current);
      await form.getByLabel("Name").fill(original[0]);
      await form.getByLabel("Level").fill(original[1]);
      await form.getByLabel("Who belongs here").fill(original[2]);
      await form.getByLabel("Colour", { exact: true }).fill(original[3]);
      await form.getByLabel("Text on that colour").fill(original[4]);
      await form.getByLabel("Instructors").selectOption(original[5]);
      await form.getByLabel("Passing-zone sheet").selectOption(original[6]);
      await form.getByRole("button", { name: "Save run group" }).click();
      await expect(toast(page, "Run group saved")).toBeVisible();
    }
    expect(storedGroup("black")).toEqual(original);
    await expect(groups.getByRole("listitem").filter({ hasText: original[1] }).getByText(original[0], { exact: true })).toBeVisible();
  });
});

// ───── the simulated clock (demo mode)

/** The thin strip under the header that shows the app's clock. */
const clockStrip = (page: Page) => page.locator("p").filter({ hasText: /^Demo\s*[A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M/ }).filter({ visible: true });
/** The real day and time at the track right now. */
function trackNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday };
}
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

test.describe("simulated clock", () => {
  test("setting the clock moves this browser to that moment of the weekend, for this person only, and Real time puts it back", async ({ page, as }) => {
    const e = event();
    const total = registered();
    const notIn = count(`select count(*) from registrations where event_id = '${e.id}' and status <> 'cancelled' and checked_in_at is null`);
    await signIn(page, "marian");
    await expect(clockStrip(page)).toHaveText(new RegExp(`^Demo\\s*${trackNow().weekday} \\d{1,2}:\\d{2} [AP]M\\s+real time`));

    // One of the ready-made moments: Saturday 9:58, Blue on track and Green next.
    await page.getByRole("button", { name: "Set clock" }).click();
    await expect(sheet(page).getByRole("heading", { name: "Simulated clock" })).toBeVisible();
    await expect(sheet(page)).toContainText("Reminders still follow real time.");
    await sheet(page).getByRole("button", { name: "Sat 9:58 · Green grids next" }).click();
    await expect(clockStrip(page)).toHaveText(/^Demo\s*Sat 9:5[89] AM\s+simulated/);
    await expect(sheet(page)).toHaveCount(0);

    // The whole app now behaves as if it were that moment.
    await go(page, "/home");
    await expect(page.getByText("On track now")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Blue", exact: true })).toBeVisible();
    await go(page, "/admin");
    await expect(pageHeader(page)).toContainText("Happening now");
    if (notIn) await expect(section(page, "Needs attention").getByRole("link", { name: `${plural(notIn, "person", "people")} not checked in` })).toHaveAttribute("href", "/admin/roster");
    await expect(page.getByRole("link", { name: /^Checked in/ })).toHaveText(new RegExp(`${total - notIn}/${total}$`));
    // The schedule editor opens on Saturday with the session in progress marked.
    await go(page, "/admin/schedule");
    await expect(dayTabs(page).nth(0)).toHaveAttribute("aria-current", "page");
    const blue = page.getByRole("listitem").filter({ hasText: "9:45 AM" }).filter({ has: page.getByText("Blue", { exact: true }) }).filter({ visible: true });
    await expect(blue.getByText("Now", { exact: true })).toBeVisible();
    // A delay starts from "now", and a new incident report is dated "now".
    await page.getByRole("button", { name: "Delay or advance" }).click();
    await expect(sheet(page).getByLabel("Starting from")).toHaveValue(/^09:5[89]$/);
    await sheet(page).getByRole("button", { name: "Close" }).click();
    await go(page, "/admin/incidents/new");
    await expect(page.getByLabel("Date of incident")).toHaveValue(e.start);
    await expect(page.getByLabel("Time", { exact: true })).toHaveValue(/^09:5[89]$/);

    // Any day and time can be typed in.
    await page.getByRole("button", { name: "Set clock" }).click();
    await sheet(page).getByLabel("Day").selectOption({ label: "Sunday" });
    await sheet(page).getByLabel("Time").fill("15:15");
    await sheet(page).getByRole("button", { name: "Set clock" }).click();
    await expect(clockStrip(page)).toHaveText(/^Demo\s*Sun 3:1[56] PM\s+simulated/);
    await go(page, "/home");
    await expect(page.getByRole("heading", { level: 2, name: "Green and Blue", exact: true })).toBeVisible();

    // The clock belongs to this browser: Hank is still on real time.
    const hank = await as("hank");
    await expect(clockStrip(hank)).toContainText("real time");

    // "Real time" puts it back.
    await page.getByRole("button", { name: "Real time" }).click();
    await expect(clockStrip(page)).toHaveText(new RegExp(`^Demo\\s*${trackNow().weekday} \\d{1,2}:\\d{2} [AP]M\\s+real time`));
    await expect(page.getByRole("button", { name: "Real time" })).toHaveCount(0);
    const today = trackNow().day;
    const daysOut = Math.round((Date.parse(`${e.start}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
    await go(page, "/admin");
    await expect(pageHeader(page)).toContainText(today >= e.start && today <= e.end ? "Happening now" : daysOut > 0 ? `In ${plural(daysOut, "day")}` : "Published");
  });
});

// ───── session reminders
//
// The reminder job reads the real clock, and the simulated clock is only a cookie in one browser. So:
//  - the content and recipients of real reminders are checked against a one-day event dated today, made here
//    and published only for the moment the job runs, with two sessions that really are minutes away;
//  - the simulated clock is shown not to trigger anything.
// Not covered: the reminder an instructor gets for a student's session (it needs a pairing), the hand-over from
// the 10-minute alert to the 5-minute one (it needs minutes of waiting), and reminders for the seeded weekend's
// own sessions (they only fall due on the real Saturday and Sunday).

const REMINDER_EVENT = `UAT ${T} reminder check`;
const GRETA = { first: "Greta", last: `Green-${T}`, email: `greta.green.${T}@example.com`.toLowerCase() };
const WADE = { first: "Wade", last: `White-${T}`, email: `wade.white.${T}@example.com`.toLowerCase() };
const cron = (page: Page, headers: Record<string, string> = { Authorization: `Bearer ${CRON_SECRET}` }) => page.context().request.get("/api/cron/reminders", { headers });
const reminderAlerts = (email: string) => sql(`select n.title, n.body, n.urgent from notifications n join users u on u.id = n.user_id where u.email = '${q(email)}' and n.kind = 'reminder' order by n.created_at`);

test.describe("session reminders", () => {
  test("the reminder job refuses a caller without its secret", async ({ request }) => {
    const attempts: Record<string, string>[] = [{}, { Authorization: "Bearer not-the-secret" }, { Authorization: CRON_SECRET }];
    for (const headers of attempts) {
      const res = await request.get("/api/cron/reminders", { headers });
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });

  test("sessions that really are minutes away send one reminder each, to the drivers in them only", async ({ page, asEmail }) => {
    const now = trackNow();
    test.skip(now.minutes + 20 > 23 * 60 + 59, "too close to midnight at the track to schedule a session a few minutes from now");
    const greenTitle = `UAT ${T} green laps`;
    const whiteTitle = `UAT ${T} white laps`;
    const setStatus = async (label: string) => {
      await go(page, "/admin/events");
      await eventCard(page, REMINDER_EVENT).getByRole("button", { name: "Edit" }).click();
      await sheet(page).getByLabel("Status").selectOption({ label });
      await sheet(page).getByRole("button", { name: "Save event" }).click();
      await expect(sheet(page)).toHaveCount(0);
      await expect(eventCard(page, REMINDER_EVENT)).toContainText(label);
    };
    await signIn(page, "marian");

    // A one-day event dated today, still a draft, with two drivers and two sessions a few minutes from now.
    await go(page, "/admin/events");
    await page.getByRole("button", { name: "New event" }).click();
    await sheet(page).getByLabel("Name").fill(REMINDER_EVENT);
    await sheet(page).getByLabel("First day").fill(now.day);
    await sheet(page).getByLabel("Last day").fill(now.day);
    await sheet(page).getByLabel("Start from another event's schedule").selectOption({ label: "Start with an empty schedule" });
    await sheet(page).getByRole("button", { name: "Create event" }).click();
    await expect(otherEventBanner(page)).toContainText(REMINDER_EVENT);
    let skipped = "";
    try {
      // The job rests for 30 minutes after a run that found no event today, and nothing but a run can tell.
      // So publish the empty event and ask once: if the job is resting, this test cannot go further.
      await setStatus("Published");
      const probe = await (await cron(page)).json();
      expect(probe.ok).toBe(true);
      if (probe.skipped) skipped = probe.skipped;
      else {
        expect(probe.events, "events the job found running today").toBeGreaterThanOrEqual(1);
        await setStatus("Draft");
        for (const [p, group] of [[GRETA, "Green"], [WADE, "White"]] as const) {
          await go(page, "/admin/roster");
          await expect(pageHeader(page)).toContainText(REMINDER_EVENT);
          await page.getByRole("button", { name: "Add person" }).click();
          await sheet(page).getByLabel("First name").fill(p.first);
          await sheet(page).getByLabel("Last name").fill(p.last);
          await sheet(page).getByLabel("Email").fill(p.email);
          await sheet(page).getByLabel("Run group").selectOption({ label: group });
          await sheet(page).getByRole("button", { name: "Add to roster" }).click();
          await expect(toast(page, `${p.first} ${p.last} added to the roster`)).toBeVisible();
        }
        const t = trackNow().minutes;
        for (const [title, group, start, end] of [[greenTitle, "Green", t + 4, t + 14], [whiteTitle, "White", t + 8, t + 18]] as const) {
          await go(page, "/admin/schedule");
          await page.getByRole("button", { name: "Add item" }).click();
          await sheet(page).getByLabel("Starts").fill(hhmm(start));
          await sheet(page).getByLabel("Ends").fill(hhmm(end));
          await pick(sheet(page).getByRole("checkbox", { name: group, exact: true }));
          await sheet(page).getByLabel("Title").fill(title);
          await sheet(page).getByRole("button", { name: "Add to schedule" }).click();
          await expect(toast(page, "Added to the schedule")).toBeVisible();
        }
        // Publish it and run the job, twice. (Running the job against the draft would only send it to rest again.)
        await setStatus("Published");
        const first = await (await cron(page)).json();
        expect(first.ok).toBe(true);
        expect(first.reminders, "reminders sent").toBeGreaterThanOrEqual(2);
        expect((await (await cron(page)).json()).ok).toBe(true);
      }
    } finally {
      // Finished with: it becomes history, and today's real event (if any) is the current one again.
      await setStatus("Completed");
      expect(val(`select status from events where name = '${q(REMINDER_EVENT)}'`)).toBe("completed");
    }
    test.skip(Boolean(skipped), `the job was resting after an earlier run found no event today (it does that for 30 minutes): ${skipped}`);

    // Greta (Green) has the Green reminder only; inside five minutes it is urgent and says to be on the grid.
    const greta = reminderAlerts(GRETA.email);
    expect(greta.length, "one reminder for Greta, however many times the job ran").toBe(1);
    expect(greta[0][0]).toMatch(new RegExp(`^${esc(greenTitle)}: on track in [1-5] min$`));
    expect(greta[0][1]).toMatch(/^You go out at \d{1,2}:\d{2} [AP]M\. Be on the grid now\.$/);
    expect(greta[0][2]).toBe("t");
    // Wade (White) has the White reminder only; with more than five minutes to go it says to get to the grid.
    const wade = reminderAlerts(WADE.email);
    expect(wade.length, "one reminder for Wade").toBe(1);
    expect(wade[0][0]).toMatch(new RegExp(`^${esc(whiteTitle)}: on track in ([6-9]|10) min$`));
    expect(wade[0][1]).toMatch(/^You go out at \d{1,2}:\d{2} [AP]M\. Get your car to the grid\.$/);
    expect(wade[0][2]).toBe("f");
    // Nobody outside the two sessions was reminded about them.
    expect(count(`select count(*) from notifications where kind = 'reminder' and title like 'UAT ${q(T)} %'`)).toBe(2);

    // What each of them sees.
    const wadePage = await asEmail(WADE.email);
    await go(wadePage, "/alerts?tab=reminders");
    const alert = wadePage.getByRole("listitem").filter({ hasText: whiteTitle });
    await expect(alert).toContainText("Get your car to the grid.");
    await expect(alert).toContainText("Reminder");
    await expect(alert).not.toContainText("Urgent");
    await expect(wadePage.locator("main")).not.toContainText(greenTitle);
    const gretaPage = await asEmail(GRETA.email);
    await go(gretaPage, "/alerts");
    await expect(gretaPage.getByRole("listitem").filter({ hasText: greenTitle })).toContainText("Urgent");
    await expect(gretaPage.locator("main")).not.toContainText(whiteTitle);
  });

  test("moving the simulated clock next to a session does not send reminders: the job follows the real clock", async ({ page }) => {
    const e = event();
    await signIn(page, "marian");
    // On the simulated clock it is Saturday 9:58, twelve minutes before Green goes out.
    await page.getByRole("button", { name: "Set clock" }).click();
    await sheet(page).getByRole("button", { name: "Sat 9:58 · Green grids next" }).click();
    await expect(clockStrip(page)).toHaveText(/Sat 9:5[89] AM\s+simulated/);

    const before = { sends: count(`select count(*) from reminder_sends`), alerts: count(`select count(*) from notifications where kind = 'reminder'`) };
    const res = await cron(page);
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // Whatever the job sent, it sent for sessions that start within the lead time of the real clock, never the simulated one.
    const now = trackNow();
    const horizon = Math.max(...(JSON.parse(storedSettings()[0]).reminderOffsets as number[]));
    const due = count(
      `select count(*) from schedule_items i join events ev on ev.id = i.event_id
        where ev.status = 'published' and i.day = '${now.day}' and not i.cancelled and i.audience <> 'none' and i.start_min between ${now.minutes} and ${now.minutes + horizon + 1}`,
    );
    const after = { sends: count(`select count(*) from reminder_sends`), alerts: count(`select count(*) from notifications where kind = 'reminder'`) };
    if (!due) expect(after, "nothing is really about to start, so nothing was sent").toEqual(before);
    const stray = sql(
      `select i.title, i.day, i.start_min from reminder_sends s join schedule_items i on i.id = s.schedule_item_id
        where s.sent_at > now() - interval '30 seconds' and not (i.day = '${now.day}' and i.start_min between ${now.minutes - 1} and ${now.minutes + horizon + 1})`,
    );
    expect(stray, "reminders sent for sessions that are not really about to start").toEqual([]);
    // In particular Saturday's 10:10 Green session got nothing, unless it really is that Saturday morning.
    const really = now.day === e.start && now.minutes >= 595 && now.minutes < 610;
    if (!really) expect(count(`select count(*) from reminder_sends s join schedule_items i on i.id = s.schedule_item_id where i.event_id = '${e.id}' and i.day = '${e.start}' and i.start_min = 610 and s.sent_at > now() - interval '30 seconds'`)).toBe(0);
  });
});
