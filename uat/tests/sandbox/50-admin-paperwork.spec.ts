import type { BrowserContext, Locator, Page } from "@playwright/test";
import fs from "node:fs";
import { test as base, expect, signIn, sql, val, openBrowser, PEOPLE, T } from "./fixtures";

// The paperwork an administrator handles: reviewing shop inspections and issuing tech stickers
// (as Hank Odom, the Chief Tech Inspector), waivers, and PCA incident reports.
//
// House rules for this file:
//  - Tessa Nakamura, Arjun Mehta and Owen Gallagher belong to the driver flows: their tech forms and
//    waivers are never opened for change here. Drivers to work on are picked from the roster at run time.
//  - The seeded waiver documents are left exactly as they are. The document tests add their own
//    document and retire it at the end.
//  - The seeded unverified shop is verified and then put back.

// ───── helpers

const PROTECTED: string[] = [PEOPLE.tessa.email, PEOPLE.arjun.email, PEOPLE.owen.email];
const NOT_PROTECTED = `u.email not in (${PROTECTED.map((e) => `'${e}'`).join(",")})`;
const q = (v: string) => v.replace(/'/g, "''");
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const count = (query: string) => Number(val(query));

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
const fmt = (day: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(`${day}T12:00:00Z`));
/** "Monday, November 23" */
const dayLong = (day: string) => fmt(day, { weekday: "long", month: "long", day: "numeric" });
/** "November 21, 2026" */
const dayFull = (day: string) => fmt(day, { month: "long", day: "numeric", year: "numeric" });
/** Today at the track, as "Nov 16". */
const todayShort = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date());
/** The next working day, or five working days on: when PCA wants an incident report. */
function businessDaysAfter(day: string, n: number) {
  let d = day;
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (w !== 0 && w !== 6) left -= 1;
  }
  return d;
}

const registered = () => count(`select count(*) from registrations where event_id = '${event().id}' and status <> 'cancelled'`);
/** Required waivers a person has not signed at the current version. A sticker alone does not clear a driver: these have to be signed too. */
const waiversLeft = (userId: string) =>
  count(
    `select count(*) from waiver_templates w join events e on e.org_id = w.org_id where e.id = '${event().id}' and w.active and w.required
       and not exists (select 1 from waiver_signatures g where g.template_id = w.id and g.event_id = e.id and g.user_id = '${userId}' and g.template_version >= w.version)`,
  );
/** The panel grid tech shows once a sticker is on the car: green and "cleared" only when the driver's waivers are signed too. */
async function expectStickerPanel(page: Page, driver: { id: string; first: string }) {
  const left = waiversLeft(driver.id);
  if (left) {
    await expect(page.getByText("Sticker issued · not cleared to drive")).toBeVisible();
    await expect(page.getByText("Cleared to go on track")).toHaveCount(0);
    await expect(page.locator("main")).toContainText(`${plural(left, "waiver")} still to sign. Send ${driver.first} to registration before they drive.`);
  } else {
    await expect(page.getByText("Cleared to go on track")).toBeVisible();
    await expect(page.getByText("Sticker issued · not cleared to drive")).toHaveCount(0);
  }
  return left;
}
/** Emails of everyone on the roster who matches a condition on their registration (r), user (u), tech form (t, may be missing) or run group (g). */
const people = (cond: string, order = "u.last_name, u.first_name") =>
  sql(
    `select u.id, u.first_name, u.last_name, u.email, coalesce(r.car_number, ''), g.name, coalesce(t.id, ''), coalesce(t.status, 'none'), coalesce(t.shop_name, ''), r.id
       from registrations r join users u on u.id = r.user_id join run_groups g on g.id = r.run_group_id join memberships m on m.user_id = u.id
       left join tech_inspections t on t.event_id = r.event_id and t.user_id = r.user_id
      where r.event_id = '${event().id}' and r.status <> 'cancelled' and (${cond}) order by ${order}`,
  ).map((r) => ({ id: r[0], first: r[1], last: r[2], name: `${r[1]} ${r[2]}`, email: r[3], car: r[4], group: r[5], techId: r[6], tech: r[7], shop: r[8], regId: r[9] }));
type Someone = ReturnType<typeof people>[number];
/** The alerts a person has, newest first. */
const alertsOf = (userId: string, title: string) => sql(`select body, urgent, kind from notifications where user_id = '${userId}' and title = '${q(title)}' order by created_at desc`);
/** What the delivery log recorded as sent to an address. Nothing really leaves the sandbox: every row must say "simulated". */
const emailed = (to: string, subject: string) => sql(`select status, body from message_log where channel = 'email' and to_address = '${q(to)}' and subject = '${q(subject)}' order by created_at desc`);

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
/** The value beside a label in a details list ("Signed by: Hank Odom"). */
const detail = (scope: Page | Locator, label: string) => scope.locator("dt").filter({ hasText: new RegExp(`^${esc(label)}$`) }).filter({ visible: true }).locator("xpath=following-sibling::dd[1]");
/** A page section by its small heading. */
const section = (page: Page, heading: string | RegExp) => page.locator("section").filter({ has: page.getByRole("heading", { name: heading }) }).filter({ visible: true });
/** The title block at the top of the screen. (After following a link the previous screen can linger, hidden, so only the visible one counts.) */
const pageHeader = (page: Page) => page.locator("main header").filter({ visible: true }).first();
/** The white card around a small label such as "Review" or "Grid tech". */
const cardOf = (label: Locator, levels = 2) => label.locator(`xpath=ancestor::div[${levels}]`);
/** One of the four numbers at the top of a screen. */
const stat = (page: Page, label: string) => page.locator("main").getByRole("link", { name: new RegExp(`^${esc(label)}`) }).filter({ visible: true }).first();
/** A row in a list, by the person's or thing's name. */
const rowFor = (page: Page, name: string) => page.locator("main").getByRole("listitem").filter({ hasText: name }).filter({ visible: true });

/** Sign with the mouse in a signature or sketch box. */
async function scribble(page: Page, box: Locator) {
  await box.scrollIntoViewIfNeeded();
  const b = (await box.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.15, b.y + b.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.25, { steps: 6 });
  await page.mouse.move(b.x + b.width * 0.45, b.y + b.height * 0.7, { steps: 6 });
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.35, { steps: 6 });
  await page.mouse.up();
}

/** Record the request a Server Action makes, so a test can check that someone without the role cannot replay it. */
async function captureAction(page: Page, trigger: () => Promise<unknown>) {
  const [req] = await Promise.all([page.waitForRequest((r) => r.method() === "POST" && Boolean(r.headers()["next-action"])), trigger()]);
  const h = await req.allHeaders();
  return { url: req.url(), body: req.postDataBuffer() ?? Buffer.from(""), headers: { "next-action": h["next-action"], "content-type": h["content-type"], accept: h["accept"] ?? "text/x-component", origin: new URL(req.url()).origin } };
}
type Captured = Awaited<ReturnType<typeof captureAction>>;
const replay = (as: Page, a: Captured) => as.context().request.post(a.url, { headers: a.headers, data: a.body, maxRedirects: 0, failOnStatusCode: false });

// ───── tech inspection, as the Chief Tech Inspector

const techCounts = () => {
  const on = `r.event_id = '${event().id}' and r.status <> 'cancelled'`;
  const n = (cond: string) => count(`select count(*) from registrations r left join tech_inspections t on t.event_id = r.event_id and t.user_id = r.user_id where ${on} and ${cond}`);
  return {
    total: n("true"),
    review: n("t.status = 'submitted'"),
    waiting: n("coalesce(t.status, 'none') in ('none', 'draft', 'with_shop', 'shop_signed')"),
    changes: n("t.status = 'changes_requested'"),
    approved: n("t.status = 'approved'"),
    stickers: n("t.sticker_issued_at is not null"),
    ready: n("t.status = 'approved' and t.sticker_issued_at is null"),
  };
};
const reviewCard = (page: Page) => cardOf(page.getByText("Review", { exact: true }).filter({ visible: true }));
const tabs = (page: Page) => page.getByRole("navigation", { name: "Tech forms by status" });
const SHOP = { name: `UAT Motorsport ${T}`, email: `service.${T}@uat-motorsport.example`.toLowerCase() };

test.describe("tech inspection for administrators", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "hank");
  });

  test("the review queue shows what is waiting, oldest first, and every count matches the forms on file", async ({ page }) => {
    const c = techCounts();
    await go(page, "/admin/tech");
    await expect(stat(page, "To review")).toHaveText(new RegExp(`^To review\\s*${c.review}$`));
    await expect(stat(page, "Not submitted")).toHaveText(new RegExp(`^Not submitted\\s*${c.waiting}${c.changes ? `\\s*plus ${c.changes} sent back` : ""}$`));
    await expect(stat(page, "Approved")).toHaveText(new RegExp(`^Approved\\s*${c.approved}/${c.total}$`));
    await expect(stat(page, "Stickers issued")).toHaveText(new RegExp(`^Stickers issued\\s*${c.stickers}/${c.total}$`));
    for (const [label, n] of [["Needs review", c.review], ["Waiting", c.waiting], ["Changes requested", c.changes], ["Approved", c.approved]] as const) {
      await expect(tabs(page).getByRole("link", { name: new RegExp(`^${label}`) })).toHaveText(new RegExp(`^${label}\\s*${n}$`));
    }
    // The menu carries the number waiting for review, on every screen.
    await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: /^Tech inspection/ }).last()).toHaveText(new RegExp(`Tech inspection\\s*${c.review || ""}$`));

    // Needs review: opens by default when anything is waiting, oldest submission first.
    const waitingReview = people("t.status = 'submitted'", "t.submitted_at");
    test.skip(!waitingReview.length, "no submitted forms are waiting for review");
    await expect(tabs(page).getByRole("link", { name: /^Needs review/ })).toHaveAttribute("aria-current", "page");
    const rows = page.locator("main").getByRole("listitem").filter({ has: page.getByRole("link", { name: /submitted/ }) });
    await expect(rows).toHaveCount(waitingReview.length);
    for (let i = 0; i < waitingReview.length; i++) await expect(rows.nth(i)).toContainText(waitingReview[i].name);
    const first = rows.first();
    await expect(first.getByLabel(`Car number ${waitingReview[0].car}`)).toBeVisible();
    await expect(first).toContainText(waitingReview[0].group);
    await expect(first).toContainText(`${waitingReview[0].shop} · submitted`);
    // A form from a shop the region has not verified is flagged in the list.
    const unverified = people(`t.status = 'submitted' and t.method = 'online' and not exists (select 1 from shops s where s.id = t.shop_id and s.verified)`)[0];
    if (unverified) await expect(rowFor(page, unverified.name)).toContainText(/\d+ flags?/);

    // Waiting: who has not submitted, and where each one is stuck.
    await tabs(page).getByRole("link", { name: /^Waiting/ }).click();
    await page.waitForURL("**/admin/tech?tab=waiting");
    const notStarted = people("t.id is null")[0];
    if (notStarted) {
      await expect(rowFor(page, notStarted.name)).toContainText("Has not started");
      await expect(rowFor(page, notStarted.name)).toContainText("Not started");
    }
    const withShop = people("t.status = 'with_shop'")[0];
    if (withShop) {
      await expect(rowFor(page, withShop.name)).toContainText(`Waiting on ${withShop.shop} since`);
      await expect(rowFor(page, withShop.name)).toContainText("With shop");
    }
    await expect(page.getByRole("button", { name: `Remind all ${c.waiting}` })).toBeVisible();

    // Changes requested: the note the driver was sent.
    await tabs(page).getByRole("link", { name: /^Changes requested/ }).click();
    await page.waitForURL("**/admin/tech?tab=changes");
    for (const [name, note] of sql(`select u.first_name || ' ' || u.last_name, t.review_note from tech_inspections t join users u on u.id = t.user_id join registrations r on r.event_id = t.event_id and r.user_id = t.user_id where t.event_id = '${event().id}' and r.status <> 'cancelled' and t.status = 'changes_requested'`)) {
      await expect(rowFor(page, name)).toContainText(note.slice(0, 40));
    }

    // Approved: with the sticker number, or a note that none has been issued.
    await tabs(page).getByRole("link", { name: /^Approved/ }).click();
    await page.waitForURL("**/admin/tech?tab=approved");
    const [stickered] = sql(`select u.first_name || ' ' || u.last_name, t.sticker_number from tech_inspections t join users u on u.id = t.user_id join registrations r on r.event_id = t.event_id and r.user_id = t.user_id where t.event_id = '${event().id}' and r.status <> 'cancelled' and t.status = 'approved' and t.sticker_issued_at is not null order by u.last_name limit 1`);
    if (stickered) await expect(rowFor(page, stickered[0])).toContainText(`Sticker ${stickered[1]}`);
    const unstickered = people("t.status = 'approved' and t.sticker_issued_at is null")[0];
    if (unstickered) await expect(rowFor(page, unstickered.name)).toContainText("No sticker yet");
  });

  test("the shop registry: adding a shop, the rules for verifying one, editing it", async ({ page }) => {
    await go(page, "/admin/tech");
    await page.getByRole("link", { name: "Shops", exact: true }).click();
    await page.waitForURL("**/admin/tech/shops");
    await expect(page.getByRole("heading", { level: 1, name: "Shops" })).toBeVisible();
    // The seeded shops are listed, verified ones marked.
    for (const [name, verified] of sql(`select name, verified from shops where name not like 'UAT %'`)) await expect(rowFor(page, name)).toContainText(verified === "t" ? "Verified" : "Not verified");
    const waiting = count(`select count(*) from shops where not verified`);
    if (waiting) await expect(page.getByText(`${plural(waiting, "shop")} waiting to be verified`)).toBeVisible();

    await page.getByRole("button", { name: "Add shop" }).click();
    const form = sheet(page);
    await expect(form.getByRole("heading", { name: "Add a shop" })).toBeVisible();
    await form.getByLabel("Shop name").fill(SHOP.name);
    await form.getByLabel("Contact or lead technician").fill("Lee Torque");
    await form.getByLabel("City").fill("Garden City, GA");
    await form.getByLabel("Phone").fill("(912) 555-0190");
    await form.getByLabel("Notes").fill("Added by the acceptance tests.");
    // A shop cannot be marked verified without the address its inspection links go to.
    await form.getByRole("checkbox", { name: /^Verified shop/ }).check();
    await form.getByRole("button", { name: "Add shop" }).click();
    await expect(form.getByRole("alert")).toHaveText("A verified shop needs an email address: that is where its inspection links are sent.");
    await form.getByRole("textbox", { name: /^Email/ }).fill("service@uat-motorsport");
    await form.getByRole("button", { name: "Add shop" }).click();
    await expect(form.getByRole("alert")).toHaveText("That email address does not look right.");
    expect(count(`select count(*) from shops where name = '${q(SHOP.name)}'`)).toBe(0);
    // Add it unverified, with no address yet.
    await form.getByRole("textbox", { name: /^Email/ }).fill("");
    await form.getByRole("checkbox", { name: /^Verified shop/ }).uncheck();
    await form.getByRole("button", { name: "Add shop" }).click();
    await expect(toast(page, "Shop added")).toBeVisible();
    const card = rowFor(page, SHOP.name);
    await expect(card).toContainText("Lee Torque · Garden City, GA");
    await expect(card).toContainText("Not verified");
    await expect(card).toContainText("No email on file");
    await expect(card).toContainText("Added by the acceptance tests.");
    await expect(page.getByText(`${plural(waiting + 1, "shop")} waiting to be verified`)).toBeVisible();

    // Verifying it is refused until it has an address.
    await card.getByRole("button", { name: "Mark verified" }).click();
    await expect(toast(page, "Add the shop's email address before verifying it.")).toBeVisible();
    await expect(card).toContainText("Not verified");

    // Edit: add the address. Then it can be verified, and unverified again.
    await card.getByRole("button", { name: `Edit ${SHOP.name}` }).click();
    await sheet(page).getByRole("textbox", { name: /^Email/ }).fill(SHOP.email);
    await sheet(page).getByLabel("City").fill("Savannah, GA");
    await sheet(page).getByRole("button", { name: "Save shop" }).click();
    await expect(toast(page, "Shop saved")).toBeVisible();
    await expect(card).toContainText(SHOP.email);
    await expect(card).toContainText("Lee Torque · Savannah, GA");
    let asked = nextConfirm(page);
    await card.getByRole("button", { name: "Mark verified" }).click();
    await expect(toast(page, `${SHOP.name} is now verified`)).toBeVisible();
    expect(asked.text).toBe(`Mark ${SHOP.name} as verified? Only do this once you have confirmed ${SHOP.email} belongs to the shop.`);
    await expect(rowFor(page, SHOP.name).getByText("Verified", { exact: true })).toBeVisible();
    asked = nextConfirm(page);
    await rowFor(page, SHOP.name).getByRole("button", { name: "Remove verification" }).click();
    await expect(toast(page, `${SHOP.name} is no longer verified`)).toBeVisible();
    expect(asked.text).toBe(`Remove ${SHOP.name} from the verified list? Its future sign-offs will be flagged for review.`);
    await expect(rowFor(page, SHOP.name)).toContainText("Not verified");
  });

  test("verifying a driver's shop clears that flag on their form; approving the form tells the driver", async ({ page, asEmail }) => {
    const [form] = sql(
      `select t.id, u.id, u.first_name, u.last_name, u.email, s.id, s.name
         from tech_inspections t join users u on u.id = t.user_id join registrations r on r.event_id = t.event_id and r.user_id = t.user_id join shops s on s.id = t.shop_id
        where t.event_id = '${event().id}' and r.status <> 'cancelled' and t.status = 'submitted' and t.method = 'online' and not s.verified and ${NOT_PROTECTED}
        order by t.submitted_at limit 1`,
    );
    test.skip(!form, "needs a submitted form from a shop that is not verified (the seed has one)");
    const [techId, driverId, first, last, email, shopId, shopName] = form;
    const before = techCounts();

    // Open the form from the queue.
    await go(page, "/admin/tech");
    await rowFor(page, `${first} ${last}`).getByRole("link").click();
    await page.waitForURL(`**/admin/tech/${techId}`);
    await expect(page.getByRole("heading", { level: 1, name: `${first} ${last}` })).toBeVisible();
    await expect(pageHeader(page)).toContainText(event().name);
    const review = reviewCard(page);
    await expect(review).toContainText("Ready for review");
    await expect(review.getByRole("listitem").filter({ hasText: "Shop is not on the region's verified list" })).toBeVisible();
    // The form itself: who inspected the car and what they recorded.
    const shopCard = cardOf(page.getByText("Shop inspection", { exact: true }).filter({ visible: true }));
    await expect(detail(shopCard, "Shop")).toHaveText(shopName);
    await expect(shopCard).toContainText("Not verified");
    await expect(detail(page, "Driver")).toHaveText(`${first} ${last}`);
    await expect(page.locator("main").getByText("Brake fluid", { exact: true })).toBeVisible();

    try {
      // Hank phones the shop, then marks it verified in the registry.
      await go(page, "/admin/tech/shops");
      const asked = nextConfirm(page);
      await rowFor(page, shopName).getByRole("button", { name: "Mark verified" }).click();
      await expect(toast(page, `${shopName} is now verified`)).toBeVisible();
      expect(asked.text).toContain(`Mark ${shopName} as verified?`);
      // The registry also says how many of this event's forms came from the shop.
      const fromShop = count(`select count(*) from tech_inspections t where t.event_id = '${event().id}' and t.method = 'online' and t.shop_id = '${shopId}'`);
      await expect(rowFor(page, shopName)).toContainText(`${plural(fromShop, "form")} this event`);

      // The flag is gone from the form, and the shop is shown as verified.
      await go(page, `/admin/tech/${techId}`);
      await expect(review.getByText("Shop is not on the region's verified list")).toHaveCount(0);
      await expect(shopCard).toContainText("Verified shop");

      await review.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(toast(page, "Approved. The driver has been told")).toBeVisible();
      await expect(review).toContainText("Approved");
      await expect(review).toContainText(new RegExp(`Approved by Hank Odom ${todayShort()}, \\d{1,2}:\\d{2} [AP]M\\.`));
      await expect(review.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      await expect(review.getByRole("button", { name: "Send back for changes" })).toBeVisible();
      await expect(cardOf(page.getByText("Grid tech", { exact: true }).filter({ visible: true }))).toContainText("No sticker yet. Paperwork is approved, so the car is ready for grid tech.");
    } finally {
      // Put the registry back the way it was seeded.
      if (val(`select verified from shops where id = '${shopId}'`) === "t") {
        await go(page, "/admin/tech/shops");
        await rowFor(page, shopName).getByRole("button", { name: "Remove verification" }).click();
        await expect(toast(page, `${shopName} is no longer verified`)).toBeVisible();
      }
    }

    // The queue is one shorter and the approved list one longer.
    const after = techCounts();
    expect(after.review).toBe(before.review - 1);
    expect(after.approved).toBe(before.approved + 1);
    await go(page, "/admin/tech?tab=approved");
    await expect(rowFor(page, `${first} ${last}`)).toContainText("No sticker yet");

    // The driver has the alert, and their own tech screen says approved.
    expect(alertsOf(driverId, "Your tech form is approved").length).toBe(1);
    const driver = await asEmail(email);
    await go(driver, "/alerts");
    const alert = driver.getByRole("listitem").filter({ hasText: "Your tech form is approved" });
    await expect(alert).toContainText("bring the car to the tech shed with your helmet and your numbers on to get your sticker");
    await expect(alert).toContainText("Tech inspection");
    await go(driver, "/me/tech");
    await expect(driver.locator("main")).toContainText("Your paperwork is done.");
    await go(driver, "/home");
    await expect(driver.getByRole("link", { name: /^Shop inspection/ })).toContainText("Reviewed and approved");
  });

  test("a form cannot be sent back without saying what to fix; the driver gets the reason", async ({ page, asEmail }) => {
    const [form] = sql(
      `select t.id, u.id, u.first_name, u.last_name, u.email, t.form->'tireDates'->>'lr'
         from tech_inspections t join users u on u.id = t.user_id join registrations r on r.event_id = t.event_id and r.user_id = t.user_id
        where t.event_id = '${event().id}' and r.status <> 'cancelled' and t.status = 'submitted' and ${NOT_PROTECTED}
        order by (t.form->'tireDates'->>'lr' = '4020') desc, t.submitted_at limit 1`,
    );
    test.skip(!form, "needs a submitted form waiting for review");
    const [techId, driverId, first, last, email, rearTire] = form;
    const oldTires = rearTire === "4020"; // the seeded form with six-year-old rear tires
    const before = techCounts();
    const reason = `UAT ${T}: the rear tires are past five years old. Fit newer tires and have the shop update the date codes.`;

    await go(page, `/admin/tech/${techId}`);
    const review = reviewCard(page);
    await expect(review).toContainText("Ready for review");
    if (oldTires) {
      await expect(review.getByRole("listitem").filter({ hasText: /^LR tire is \d\.\d years old \(limit: under 5\)$/ })).toBeVisible();
      await expect(review.getByRole("listitem").filter({ hasText: /^RR tire is \d\.\d years old \(limit: under 5\)$/ })).toBeVisible();
    }
    await review.getByRole("button", { name: "Request changes" }).click();
    const dialog = sheet(page);
    await expect(dialog.getByRole("heading", { name: "Send the form back" })).toBeVisible();
    await expect(dialog).toContainText(`${first} gets an alert, an email and a push notification with your note, and has to resubmit.`);
    const note = dialog.getByLabel("What needs to change");
    // The note starts with what the automatic checks found.
    if (oldTires) await expect(note).toHaveValue(/^LR tire is \d\.\d years old \(limit: under 5\)\. RR tire is .+ Have this fixed and ask your shop to update the form, then resubmit\.$/);
    // A few characters padded with spaces is not a reason.
    await note.fill("  redo it     ");
    await dialog.getByRole("button", { name: `Send back to ${first}` }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Say what needs to change, so the driver knows what to fix.");
    expect(val(`select status from tech_inspections where id = '${techId}'`)).toBe("submitted");

    await note.fill(reason);
    await dialog.getByRole("button", { name: `Send back to ${first}` }).click();
    await expect(review).toContainText("Changes requested");
    await expect(review).toContainText(new RegExp(`Sent back by Hank Odom ${todayShort()}, \\d{1,2}:\\d{2} [AP]M\\. Waiting on ${esc(first)} to resubmit\\.`));
    await expect(review.getByRole("alert")).toHaveText(reason);
    await expect(review.getByRole("button", { name: "Approve as it stands" })).toBeVisible();

    // It has left the review queue for the "Changes requested" list, with the note beside it.
    const after = techCounts();
    expect(after.review).toBe(before.review - 1);
    expect(after.changes).toBe(before.changes + 1);
    await go(page, "/admin/tech?tab=changes");
    await expect(rowFor(page, `${first} ${last}`)).toContainText(reason);
    // At the grid, the same note explains why this car cannot have a sticker.
    await go(page, `/admin/tech/grid?u=${driverId}`);
    await expect(page.getByText("Paperwork is not approved", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText(`The form was sent back: ${reason}`);
    await expect(page.getByRole("button", { name: "Issue sticker" })).toBeDisabled();
    await expect(page.getByText("Paperwork is not approved yet. The sticker can be issued once that is done.")).toBeVisible();

    // The driver: an urgent alert with the reason, an email (simulated), and their tech screen shows it.
    const got = alertsOf(driverId, "Your tech form needs changes");
    expect(got.length).toBe(1);
    expect(got[0]).toEqual([reason, "t", "tech"]);
    const mail = emailed(email, "Your tech form needs changes");
    expect(mail.length).toBe(1);
    expect(mail[0]).toEqual(["simulated", reason]);
    const driver = await asEmail(email);
    await go(driver, "/alerts");
    await expect(driver.getByRole("listitem").filter({ hasText: "Your tech form needs changes" })).toContainText(reason);
    await expect(driver.getByRole("listitem").filter({ hasText: "Your tech form needs changes" })).toContainText("Urgent");
    await go(driver, "/me/tech");
    await expect(driver.getByText("The tech team sent your form back")).toBeVisible();
    await expect(driver.locator("main")).toContainText(reason);
    await go(driver, "/home");
    await expect(driver.getByRole("link", { name: /^Before you drive/ })).toContainText("Fix your tech form");
  });

  test("reminders go to drivers who have not submitted, each told what they still have to do", async ({ page, asEmail }) => {
    const e = event();
    const stuck = people(`t.status = 'with_shop' and ${NOT_PROTECTED}`)[0];
    test.skip(!stuck, "needs a driver whose form is still with their shop");
    const title = "Tech inspection: action needed";
    const message = `Your shop (${stuck.shop}) has not completed your tech form for ${e.name} yet. Check with them, or send a new link from Tech inspection.`;
    const had = alertsOf(stuck.id, title).length;

    // One driver, from the Waiting list.
    await go(page, "/admin/tech?tab=waiting");
    await page.getByRole("button", { name: `Remind ${stuck.name}` }).click();
    await expect(toast(page, "Reminder sent")).toBeVisible();
    expect(alertsOf(stuck.id, title).length).toBe(had + 1);
    expect(alertsOf(stuck.id, title)[0][0]).toBe(message);
    expect(emailed(stuck.email, title)[0]).toEqual(["simulated", message]);
    const driver = await asEmail(stuck.email);
    await go(driver, "/alerts");
    await expect(driver.getByRole("listitem").filter({ hasText: title }).first()).toContainText(message);

    // The same from their form.
    await go(page, `/admin/tech/${stuck.techId}`);
    await expect(reviewCard(page)).toContainText(`Waiting on ${stuck.shop} to fill in and sign the checklist.`);
    await reviewCard(page).getByRole("button", { name: `Send ${stuck.first} a reminder` }).click();
    await expect(toast(page, "Reminder sent")).toBeVisible();
    expect(alertsOf(stuck.id, title).length).toBe(had + 2);

    // Everyone who has not submitted, in one go. Drivers whose forms are in already are left alone.
    const waiting = people("coalesce(t.status, 'none') in ('none', 'draft', 'with_shop', 'shop_signed')");
    const done = people(`t.status in ('submitted', 'approved', 'changes_requested') and ${NOT_PROTECTED}`)[0];
    const doneHad = alertsOf(done.id, title).length;
    const sentBefore = count(`select count(*) from notifications where title = '${q(title)}'`);
    await go(page, "/admin/tech?tab=waiting");
    const asked = nextConfirm(page);
    await page.getByRole("button", { name: `Remind all ${waiting.length}` }).click();
    await expect(toast(page, `Reminder sent to ${plural(waiting.length, "driver")}`)).toBeVisible();
    expect(asked.text).toBe(`Send a reminder to all ${waiting.length} drivers who have not submitted? Each gets an alert, an email and a push notification.`);
    expect(count(`select count(*) from notifications where title = '${q(title)}'`)).toBe(sentBefore + waiting.length);
    expect(alertsOf(done.id, title).length).toBe(doneHad);
    // Someone who has not even started is told about the inspection window rather than about a shop.
    const notStarted = people(`t.id is null and ${NOT_PROTECTED}`)[0];
    if (notStarted) expect(alertsOf(notStarted.id, title)[0][0]).toMatch(new RegExp(`^Your shop inspection for ${esc(e.name)} has not been submitted\\. .+ The inspection window is \\w{3} \\d{1,2} to \\w{3} \\d{1,2}\\.$`));
  });

  test("grid tech: find the car, run the ten checks, issue the sticker; a sticker can be revoked", async ({ page, asEmail }) => {
    const e = event();
    const car = people(`t.status = 'approved' and t.sticker_issued_at is null and r.checked_in_at is null and not m.is_admin and length(r.car_number) >= 2 and ${NOT_PROTECTED}`, "(g.key = 'black') desc, u.last_name")[0];
    test.skip(!car, "needs a driver whose paperwork is approved and who has no sticker yet");
    const before = techCounts();
    // The next sticker continues the numbering already in use at this event.
    const numbers = sql(`select sticker_number from tech_inspections where event_id = '${e.id}' and sticker_number is not null`).map((r) => /^(.*?)(\d+)$/.exec(r[0])).filter((m): m is RegExpExecArray => Boolean(m));
    const top = numbers.sort((a, b) => Number(b[2]) - Number(a[2]))[0];
    const next = top ? `${top[1]}${String(Number(top[2]) + 1).padStart(3, "0")}` : null;

    await go(page, "/admin/tech");
    await page.getByRole("link", { name: "Grid tech", exact: true }).first().click();
    await page.waitForURL("**/admin/tech/grid");
    await expect(pageHeader(page)).toContainText(`${before.stickers} of ${before.total} stickers issued${before.ready ? `, ${before.ready} more ready` : ""}.`);
    await expect(page.getByText("Pick a car")).toBeVisible();
    await expect(page.getByText(`${before.total} cars, by number`)).toBeVisible();

    // Find it by the number on the door, or by name.
    const find = page.getByLabel("Find a car by number or driver name");
    const sameStart = count(`select count(*) from registrations r join users u on u.id = r.user_id left join tech_inspections t on t.event_id = r.event_id and t.user_id = r.user_id where r.event_id = '${e.id}' and r.status <> 'cancelled' and (coalesce(t.car_number, r.car_number) like '${car.car}%' or lower(u.first_name || ' ' || u.last_name) like '%${car.car}%')`);
    await find.fill(car.car);
    await expect(page.getByText(`${sameStart} of ${before.total} cars`)).toBeVisible();
    await find.fill("no such car");
    await expect(page.getByText("No car matches \"no such car\". Check the number, or search by last name.")).toBeVisible();
    await find.fill(car.last.toLowerCase());
    const listed = page.getByRole("link", { name: new RegExp(esc(car.name)) });
    await expect(listed).toContainText("Ready");
    await listed.click();
    await page.waitForURL(`**/admin/tech/grid?u=${car.id}`);
    await expect(page.locator("main").getByText("Paperwork approved", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText(`Shop inspection by ${car.shop}, approved`);

    // Nothing is ticked, so no sticker yet, and the screen says why.
    const issue = page.getByRole("button", { name: "Issue sticker" });
    const boxes = page.getByRole("checkbox");
    await expect(boxes).toHaveCount(10);
    await expect(issue).toBeDisabled();
    await expect(page.getByText("10 of 10 still to check. The sticker can be issued once that is done.")).toBeVisible();
    // Three checks done and a note; save and come back later.
    await page.getByRole("checkbox", { name: /Functioning brake lights/ }).check();
    await page.getByRole("checkbox", { name: /Helmet with proper Snell rating/ }).check();
    await page.getByRole("checkbox", { name: /Car numbers in place/ }).check();
    await page.getByLabel("Notes").fill(`UAT ${T}: told to re-torque the lugs after the first session.`);
    await page.getByRole("button", { name: "Save checklist" }).click();
    await expect(toast(page, "Checklist saved")).toBeVisible();
    await go(page, `/admin/tech/grid?u=${car.id}`);
    await expect(page.getByRole("checkbox", { name: /Helmet with proper Snell rating/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Wheel lug nuts torqued/ })).not.toBeChecked();
    await expect(page.getByLabel("Notes")).toHaveValue(`UAT ${T}: told to re-torque the lugs after the first session.`);
    await expect(page.getByText("7 of 10 still to check. The sticker can be issued once that is done.")).toBeVisible();
    await expect(issue).toBeDisabled();
    expect(val(`select sticker_issued_at is null from tech_inspections where id = '${car.techId}'`)).toBe("t");

    // All ten, then the sticker.
    await page.getByRole("button", { name: "Check all 10" }).click();
    for (let i = 0; i < 10; i++) await expect(boxes.nth(i)).toBeChecked();
    await expect(issue).toBeEnabled();
    await issue.click();
    const left = await expectStickerPanel(page, car);
    const number = val(`select sticker_number from tech_inspections where id = '${car.techId}'`);
    if (next) expect(number, "the next number in the sequence").toBe(next);
    await expect(page.locator("main")).toContainText(new RegExp(`${esc(number)}\\s*Sticker issued ${todayShort()}, \\d{1,2}:\\d{2} [AP]M by Hank Odom\\.`));
    await expect(page.locator("main")).toContainText(`Note: UAT ${T}: told to re-torque the lugs after the first session.`);
    await expect(page.getByRole("link", { name: new RegExp(esc(car.name)) })).toContainText(number);
    await expect(pageHeader(page)).toContainText(`${before.stickers + 1} of ${before.total} stickers issued`);

    // A car at grid tech is a driver at the track: they are checked in, and they are told about the sticker.
    expect(val(`select checked_in_at is not null from registrations where id = '${car.regId}'`)).toBe("t");
    expect(alertsOf(car.id, `Tech sticker ${number} issued`).length).toBe(1);
    const driver = await asEmail(car.email);
    await go(driver, "/alerts");
    await expect(driver.getByRole("listitem").filter({ hasText: `Tech sticker ${number} issued` })).toContainText(
      left ? `Your car passed grid tech. You still need to sign ${plural(left, "waiver")} before you can drive.` : "Your car passed grid tech and you are cleared to go on track.",
    );
    await go(driver, "/home");
    await expect(driver.getByRole("link", { name: /^Tech sticker/ })).toContainText(`Sticker ${number} is on your car`);
    await go(driver, "/me/tech");
    await expect(driver.getByText(left ? "Your car has its sticker, but you are not cleared to drive yet" : "You are cleared to drive")).toBeVisible();
    // The form now records the sticker, and can no longer be sent back for changes.
    await go(page, `/admin/tech/${car.techId}`);
    await expect(cardOf(page.getByText("Grid tech", { exact: true }).filter({ visible: true }))).toContainText(new RegExp(`Sticker\\s*${esc(number)}\\s*issued .+ by Hank Odom\\.`));
    await expect(reviewCard(page).getByRole("button", { name: "Send back for changes" })).toHaveCount(0);

    // Revoke it: the car is no longer cleared and the driver is told, urgently.
    await page.getByRole("link", { name: "Open in grid tech" }).click();
    await page.waitForURL(`**/admin/tech/grid?u=${car.id}`);
    const asked = nextConfirm(page);
    await page.getByRole("button", { name: "Revoke sticker" }).click();
    await expect(toast(page, `Sticker ${number} revoked`)).toBeVisible();
    expect(asked.text).toBe(`Revoke sticker ${number}? ${car.first} is told their car is no longer cleared, and you should remove the sticker from the car.`);
    await expect(page.getByText("Cleared to go on track")).toHaveCount(0);
    await expect(page.getByText("Sticker issued · not cleared to drive")).toHaveCount(0);
    await expect(page.locator("main").getByText("Paperwork approved", { exact: true })).toBeVisible();
    await expect(issue).toBeEnabled(); // the ten checks are still on file
    expect(alertsOf(car.id, "Your tech sticker was withdrawn")[0]).toEqual(["Your car is not cleared to go on track. See the tech team at the tech shed before your next session.", "t", "tech"]);
    await go(driver, "/me/tech");
    await expect(driver.getByText("You are cleared to drive")).toHaveCount(0);
    await expect(driver.getByText("Your car has its sticker")).toHaveCount(0);
    expect(techCounts().stickers).toBe(before.stickers);
  });

  test("sending a form back, and issuing a sticker, are each confirmed with a message", async ({ page }) => {
    // Every other save in the app ends with a short confirmation at the foot of the screen. These two change the
    // screen (so the work is not lost), but "Sent back to the driver" and "Sticker … issued" should appear too.
    const [form] = sql(
      `select t.id, u.first_name from tech_inspections t join users u on u.id = t.user_id join registrations r on r.event_id = t.event_id and r.user_id = t.user_id
        where t.event_id = '${event().id}' and r.status <> 'cancelled' and t.status = 'changes_requested' and t.review_note like 'UAT ${q(T)}%' limit 1`,
    );
    const car = people(`t.status = 'approved' and t.sticker_issued_at is null and t.grid_tech->>'notes' like 'UAT ${q(T)}%'`)[0];
    test.skip(!form && !car, "needs the form sent back, or the car whose sticker was revoked, earlier in this file");
    if (form) {
      await go(page, `/admin/tech/${form[0]}`);
      const review = reviewCard(page);
      // Approve it as it stands, then send it back again with the same reason.
      const reason = val(`select review_note from tech_inspections where id = '${form[0]}'`);
      const asked = nextConfirm(page);
      await review.getByRole("button", { name: "Approve as it stands" }).click();
      await expect(toast(page, "Approved. The driver has been told")).toBeVisible();
      expect(asked.text).toBe("Approve this form as it stands, without waiting for the driver to resubmit?");
      await review.getByRole("button", { name: "Send back for changes" }).click();
      await sheet(page).getByLabel("What needs to change").fill(reason);
      await sheet(page).getByRole("button", { name: `Send back to ${form[1]}` }).click();
      await expect.soft(toast(page, "Sent back to the driver"), "a confirmation after sending the form back").toBeVisible({ timeout: 4_000 });
      await expect(review).toContainText("Changes requested");
    }
    if (car) {
      await go(page, `/admin/tech/grid?u=${car.id}`);
      await page.getByRole("button", { name: "Issue sticker" }).click();
      await expect.soft(toast(page, /^Sticker .+ issued/), "a confirmation after issuing the sticker").toBeVisible({ timeout: 4_000 });
      await expectStickerPanel(page, car);
    }
  });

  test("a stamped paper form checked in person at the track approves the paperwork, and the sticker follows", async ({ page }) => {
    const walkUp = people(`t.id is null and not m.is_admin and ${NOT_PROTECTED}`)[0];
    test.skip(!walkUp, "needs a driver who has not started a tech form");
    const before = techCounts();
    await go(page, `/admin/tech/grid?u=${walkUp.id}`);
    await expect(page.getByText("Paperwork is not approved", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText("No approved shop inspection is on file. If the driver has the stamped paper form with them, check it now.");
    await expect(page.locator("main")).toContainText("Not started");
    const issue = page.getByRole("button", { name: "Issue sticker" });
    await page.getByRole("button", { name: "Check all 10" }).click();
    await expect(issue).toBeDisabled(); // ten checks are not enough without the paperwork
    await expect(page.getByText("Paperwork is not approved yet. The sticker can be issued once that is done.")).toBeVisible();

    const asked = nextConfirm(page);
    await page.getByRole("button", { name: "Paper form checked in person" }).click();
    await expect(toast(page, "Paperwork approved")).toBeVisible();
    expect(asked.text).toBe(`Confirm that you have checked ${walkUp.first}'s completed, stamped paper tech form in person? This approves their paperwork.`);
    await expect(page.locator("main").getByText("Paperwork approved", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText("Paper form, approved");
    expect(techCounts().approved).toBe(before.approved + 1);

    // The ten checks ticked a moment ago are still ticked, so the sticker can go straight on.
    await expect(issue).toBeEnabled();
    await issue.click();
    await expectStickerPanel(page, walkUp);
    expect(techCounts().stickers).toBe(before.stickers + 1);
    // Their form, opened from the approved list, says how it was approved.
    await go(page, "/admin/tech?tab=approved");
    await rowFor(page, walkUp.name).getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1, name: walkUp.name })).toBeVisible();
    await expect(reviewCard(page)).toContainText("Paper form checked in person at the track by Hank Odom.");
    await expect(page.locator("main")).toContainText("Paper form checked in person. Nothing was uploaded, so there is no copy of it here.");
  });

  test("grid tech on a phone: the car list gives way to the checklist, and All cars goes back", async ({ as }) => {
    const car = people(`t.status = 'approved' and t.sticker_issued_at is null and ${NOT_PROTECTED}`)[0] ?? people(`t.sticker_issued_at is null and ${NOT_PROTECTED}`)[0];
    test.skip(!car, "needs a car without a sticker");
    const phone = await as("hank", { phone: true });
    await go(phone, "/admin/tech/grid");
    const find = phone.getByLabel("Find a car by number or driver name");
    await find.fill(car.last);
    await phone.getByRole("link", { name: new RegExp(esc(car.name)) }).click();
    await phone.waitForURL(`**/admin/tech/grid?u=${car.id}`);
    // The checklist has the whole screen: the list is out of the way, and each check is a big target for a gloved thumb.
    await expect(phone.getByRole("checkbox")).toHaveCount(10);
    await expect(find).toBeHidden();
    await expect(phone.getByRole("button", { name: "Issue sticker" })).toBeVisible();
    const firstRow = phone.getByRole("checkbox", { name: /Functioning brake lights/ }).locator("xpath=ancestor::label[1]");
    expect((await firstRow.boundingBox())!.height, "height of a checklist row, in pixels").toBeGreaterThanOrEqual(44);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "pixels the checklist is wider than the phone").toBeLessThanOrEqual(0);
    await phone.getByRole("link", { name: "All cars" }).click();
    await phone.waitForURL("**/admin/tech/grid");
    await expect(find).toBeVisible();
    await expect(phone.getByRole("checkbox")).toHaveCount(0);
  });
});

// ───── waivers

/** The documents drivers are asked to sign, in the order the screens list them. */
const documents = () => sql(`select id, title, version, required from waiver_templates where active order by sort_order, title`).map((r) => ({ id: r[0], title: r[1], version: Number(r[2]), required: r[3] === "t" }));
/** How many required documents each person on the roster still has to sign (a signature on an earlier version does not count). */
const outstanding = () =>
  sql(
    `select u.id, u.first_name, u.last_name, u.email,
            (select count(*) from waiver_templates w where w.active and w.required and not exists (select 1 from waiver_signatures s where s.template_id = w.id and s.event_id = r.event_id and s.user_id = r.user_id and s.template_version >= w.version))
       from registrations r join users u on u.id = r.user_id where r.event_id = '${event().id}' and r.status <> 'cancelled' order by u.last_name, u.first_name`,
  ).map((r) => ({ id: r[0], first: r[1], last: r[2], name: `${r[1]} ${r[2]}`, email: r[3], left: Number(r[4]) }));
const signedCount = (templateId: string) =>
  count(`select count(*) from registrations r join waiver_signatures s on s.event_id = r.event_id and s.user_id = r.user_id join waiver_templates w on w.id = s.template_id where r.event_id = '${event().id}' and r.status <> 'cancelled' and s.template_id = '${templateId}' and s.template_version >= w.version`);
/** The cell for one document in a person's row of the signatures list: "Track waiver: Not signed". */
const waiverCell = (row: Locator, title: string) => row.getByText(`${title}:`, { exact: true }).locator("..");
const DOC = { title: `UAT ${T} paddock rules`, summary: "Added by the acceptance tests: speed limit and fuelling rules.", body: `UAT ${T}. I will keep to 5 mph in the paddock.\n\nI will refuel only in the marked area, with the engine off.` };
const docId = () => val(`select id from waiver_templates where title = '${q(DOC.title)}'`);
/** The pill beside a document's title on a person's signed copies: "Signed", "Not signed", "Signed an earlier version". */
const copyStatus = (card: Locator) => card.getByRole("heading", { level: 2 }).locator("xpath=following-sibling::span[1]");
const docCard = (page: Page, title: string) => page.locator("main").getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) }).filter({ visible: true });
async function editDocument(page: Page, change: (form: Locator) => Promise<void>, confirmation: string) {
  await go(page, "/admin/waivers?tab=documents");
  await docCard(page, DOC.title).getByRole("button", { name: "Edit" }).click();
  await expect(sheet(page).getByRole("heading", { name: "Edit document" })).toBeVisible();
  await change(sheet(page));
  await sheet(page).getByRole("button", { name: "Save document" }).click();
  await expect(toast(page, confirmation)).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
}

test.describe("waivers for administrators", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "marian");
  });

  test("the signatures screen shows who has signed what, and can list only the people with something unsigned", async ({ page }) => {
    const total = registered();
    const docs = documents();
    const everyone = outstanding();
    const pending = everyone.filter((p) => p.left > 0);
    await go(page, "/admin/waivers");
    await expect(pageHeader(page)).toContainText(`Who has signed what for ${event().name}`);
    await expect(page.getByText("Confirm this with PCA before relying on it")).toBeVisible();

    // One tally per document.
    for (const d of docs) {
      const bar = page.getByRole("progressbar", { name: `${d.title}: signed` });
      await expect(bar).toHaveAttribute("aria-valuenow", String(signedCount(d.id)));
      await expect(bar).toHaveAttribute("aria-valuemax", String(total));
      await expect(bar.locator("..")).toContainText(`${signedCount(d.id)}/${total}`);
    }
    const filter = page.getByRole("navigation", { name: "Filter people" });
    await expect(filter.getByRole("link", { name: /^Everyone/ })).toHaveText(new RegExp(`^Everyone\\s*${total}$`));
    await expect(filter.getByRole("link", { name: /^Unsigned/ })).toHaveText(new RegExp(`^Unsigned\\s*${pending.length}$`));
    await expect(page.getByRole("link", { name: "Signed copies" })).toHaveCount(total);

    // Someone with everything signed: a date under each document and nothing to remind them about.
    const done = everyone.find((p) => p.left === 0 && !PROTECTED.includes(p.email))!;
    for (const d of docs.filter((x) => x.required)) await expect(waiverCell(rowFor(page, done.name), d.title)).toHaveText(new RegExp(`^${esc(d.title)}:\\s*Signed \\w{3} \\d{1,2}$`));
    await expect(rowFor(page, done.name).getByRole("button", { name: "Remind" })).toHaveCount(0);

    // Only the people with something unsigned.
    await filter.getByRole("link", { name: /^Unsigned/ }).click();
    await page.waitForURL("**/admin/waivers?show=unsigned");
    await expect(page.getByRole("link", { name: "Signed copies" })).toHaveCount(pending.length);
    for (const p of pending) {
      const row = rowFor(page, p.name);
      await expect(row.getByRole("button", { name: "Remind" })).toBeVisible();
      // Each document says signed or not, matching what is on file for them.
      for (const d of docs) {
        const has = count(`select count(*) from waiver_signatures where template_id = '${d.id}' and event_id = '${event().id}' and user_id = '${p.id}' and template_version >= ${d.version}`) > 0;
        await expect(waiverCell(row, d.title)).toHaveText(new RegExp(`^${esc(d.title)}:\\s*${has ? "Signed \\w{3} \\d{1,2}" : d.required ? "Not signed" : "Not signed \\(optional\\)"}$`));
      }
    }
    await expect(rowFor(page, done.name)).toHaveCount(0);
  });

  test("a person's signed copies can be opened, and they can be reminded about what is unsigned", async ({ page, asEmail }) => {
    const e = event();
    const docs = documents();
    const pending = outstanding().filter((p) => p.left > 0 && !PROTECTED.includes(p.email));
    const one = pending.find((p) => p.left === 1);
    const several = pending.find((p) => p.left > 1 && p.left < docs.filter((d) => d.required).length);
    test.skip(!one || !several, "needs one driver with a single waiver unsigned and one with several (the seed has both)");

    // Signed copies for the driver with one document left.
    await go(page, "/admin/waivers?show=unsigned");
    await rowFor(page, one!.name).getByRole("link", { name: "Signed copies" }).click();
    await page.waitForURL(`**/admin/waivers/person/${one!.id}`);
    await expect(page.getByRole("heading", { level: 1, name: one!.name })).toBeVisible();
    await expect(pageHeader(page)).toContainText(`Signed waivers for ${e.name}.`);
    for (const d of docs) {
      const card = cardOf(page.getByRole("heading", { level: 2, name: d.title }));
      const [sig] = sql(`select signed_name, coalesce(ip, ''), coalesce(user_agent, '') from waiver_signatures where template_id = '${d.id}' and event_id = '${e.id}' and user_id = '${one!.id}'`);
      if (sig) {
        await expect(copyStatus(card)).toHaveText("Signed");
        await expect(card.getByRole("img", { name: `Signature of ${sig[0]}` })).toBeVisible();
        await expect(detail(card, "Signed by")).toHaveText(sig[0]);
        await expect(detail(card, "Document version")).toHaveText(`Version ${d.version} (current)`);
        await expect(detail(card, "Wording")).toHaveText("Matches the wording in use today");
        await expect(detail(card, "IP address")).toHaveText(sig[1]);
        await expect(detail(card, "Device")).toHaveText(sig[2]);
      } else {
        await expect(copyStatus(card)).toHaveText("Not signed");
        await expect(card).toContainText("No signature on file for this event.");
      }
    }
    // Remind them from here.
    await page.getByRole("button", { name: "Remind about 1 unsigned" }).click();
    await expect(toast(page, `Reminder sent to ${one!.first}`)).toBeVisible();
    const body1 = `One waiver is still unsigned for ${e.name}. Sign before you arrive; it takes about two minutes.`;
    expect(alertsOf(one!.id, "You have a waiver to sign")[0]).toEqual([body1, "f", "waiver"]);
    expect(emailed(one!.email, "You have a waiver to sign")[0]).toEqual(["simulated", body1]);
    // The driver's alert takes them to their waivers.
    const driver = await asEmail(one!.email);
    await go(driver, "/alerts");
    const alert = driver.getByRole("listitem").filter({ hasText: "You have a waiver to sign" }).first();
    await expect(alert).toContainText(body1);
    await expect(alert).toContainText("Waivers");
    await alert.getByRole("button").click();
    await driver.waitForURL("**/me/waivers");
    await expect(driver.getByText("Needs your signature")).toHaveCount(1);

    // From the list: the driver with several left is told how many.
    await go(page, "/admin/waivers?show=unsigned");
    await rowFor(page, several!.name).getByRole("button", { name: "Remind" }).click();
    await expect(toast(page, `Reminder sent to ${several!.first}`)).toBeVisible();
    expect(alertsOf(several!.id, `You have ${several!.left} waivers to sign`)[0][0]).toBe(`${several!.left} waivers are still unsigned for ${e.name}. Sign before you arrive; it takes about two minutes.`);

    // Someone with nothing left has no reminder button on their page.
    const done = outstanding().find((p) => p.left === 0 && !PROTECTED.includes(p.email))!;
    await go(page, `/admin/waivers/person/${done.id}`);
    await expect(page.getByRole("heading", { level: 1, name: done.name })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remind about/ })).toHaveCount(0);
  });

  test("one button reminds everyone with unsigned waivers, and nobody else", async ({ page }) => {
    const pending = outstanding().filter((p) => p.left > 0);
    test.skip(!pending.length, "everyone has signed");
    const done = outstanding().find((p) => p.left === 0)!;
    const waiverAlerts = () => count(`select count(*) from notifications where kind = 'waiver'`);
    const had = waiverAlerts();
    const doneHad = count(`select count(*) from notifications where kind = 'waiver' and user_id = '${done.id}'`);
    await go(page, "/admin/waivers");
    const asked = nextConfirm(page);
    await page.getByRole("button", { name: "Remind everyone with unsigned waivers" }).click();
    await expect(toast(page, `Reminder sent to ${plural(pending.length, "person", "people")}`)).toBeVisible();
    expect(asked.text).toBe(`Send a reminder to ${plural(pending.length, "person", "people")} with unsigned waivers for ${event().name}? It goes out in the app, by email and as a push notification.`);
    expect(waiverAlerts()).toBe(had + pending.length);
    expect(count(`select count(*) from notifications where kind = 'waiver' and user_id = '${done.id}'`)).toBe(doneHad);
    // Each is told their own number.
    for (const p of pending) {
      const title = p.left === 1 ? "You have a waiver to sign" : `You have ${p.left} waivers to sign`;
      expect(alertsOf(p.id, title).length, `${p.name} was told about ${p.left}`).toBeGreaterThanOrEqual(1);
    }
  });

  test("a new document is offered to every driver; changing its wording, and asking for it to be signed again, shows against existing signatures", async ({ page, as }) => {
    const e = event();
    const total = registered();
    await go(page, "/admin/waivers");
    await page.getByRole("link", { name: "Documents", exact: true }).click();
    await page.waitForURL("**/admin/waivers?tab=documents");
    // The seeded documents, with a warning on the two that still hold placeholder wording.
    for (const [title, version, placeholder] of sql(`select title, version, body like '%PLACEHOLDER%' from waiver_templates where active and title not like 'UAT %'`)) {
      const card = docCard(page, title);
      await expect(card).toContainText("In use");
      await expect(card).toContainText(`Version ${version}`);
      if (placeholder === "t") await expect(card).toContainText("Still placeholder wording");
      else await expect(card).not.toContainText("Still placeholder wording");
    }

    // Add a document. It needs a real title and real wording.
    await page.getByRole("button", { name: "Add a document" }).click();
    const form = sheet(page);
    await form.getByLabel("Title").fill("No");
    await form.getByLabel("Wording").fill(DOC.body);
    await form.getByRole("button", { name: "Add document" }).click();
    await expect(form.getByRole("alert")).toHaveText("Give the document a title.");
    await form.getByLabel("Title").fill(DOC.title);
    await form.getByLabel("Wording").fill("Too short.");
    await form.getByRole("button", { name: "Add document" }).click();
    await expect(form.getByRole("alert")).toHaveText("Paste the full wording of the document.");
    expect(docId()).toBe("");
    await form.getByLabel("Summary").fill(DOC.summary);
    await form.getByLabel("Wording").fill(DOC.body);
    await expect(form.getByRole("checkbox", { name: /^Required/ })).toBeChecked();
    await expect(form.getByRole("checkbox", { name: /^In use/ })).toBeChecked();
    await form.getByRole("button", { name: "Add document" }).click();
    await expect(toast(page, "Document added")).toBeVisible();
    const card = docCard(page, DOC.title);
    await expect(card).toContainText("In use");
    await expect(card).toContainText("Required");
    await expect(card).toContainText(DOC.summary);
    await expect(card).toContainText("Version 1");
    await card.getByText("Read the wording").click();
    await expect(card).toContainText("I will refuel only in the marked area, with the engine off.");

    // Nobody has signed it yet, so the signatures screen counts everyone as having something unsigned.
    await go(page, "/admin/waivers");
    await expect(page.getByRole("progressbar", { name: `${DOC.title}: signed` })).toHaveAttribute("aria-valuenow", "0");
    await expect(page.getByRole("navigation", { name: "Filter people" }).getByRole("link", { name: /^Unsigned/ })).toHaveText(new RegExp(`^Unsigned\\s*${total}$`));

    // Hank, who is on the roster as a driver, finds it on his waivers and signs it.
    const hank = await as("hank");
    const hankId = val(`select id from users where email = '${PEOPLE.hank.email}'`);
    const required = documents().filter((d) => d.required).length;
    await go(hank, "/me/waivers");
    const tally = hank.locator("main").getByText(/^\d+\/\d+$/);
    await expect(tally).toHaveText(`${required - 1}/${required}`);
    const item = hank.getByRole("link", { name: new RegExp(`^${esc(DOC.title)}`) });
    await expect(item).toContainText("Needs your signature");
    await item.click();
    await hank.waitForURL(`**/me/waivers/${docId()}`);
    await expect(hank.locator("main")).toContainText("I will keep to 5 mph in the paddock.");
    await expect(hank.locator("main")).toContainText("Version 1");
    // It cannot be signed without ticking the box and drawing a signature.
    const sign = hank.getByRole("button", { name: "Sign this waiver" });
    await sign.click();
    await expect(hank.locator("main").getByRole("alert")).toHaveText("Tick the box to confirm you have read and understand the document.");
    await hank.getByRole("checkbox", { name: "I have read and understand this document" }).check();
    await sign.click();
    await expect(hank.locator("main").getByRole("alert")).toHaveText("Draw your signature in the box.");
    await expect(hank.getByLabel("Full legal name")).toHaveValue("Hank Odom");
    await scribble(hank, hank.getByRole("img", { name: "Sign here" }));
    await sign.click();
    await expect(toast(hank, "Waiver signed")).toBeVisible();
    await expect(hank.getByText(`Signed for ${e.name}`)).toBeVisible();
    await go(hank, "/me/waivers");
    await expect(tally).toHaveText(`${required}/${required}`);

    // The administrator sees his signature against the new document.
    await go(page, "/admin/waivers");
    await expect(page.getByRole("progressbar", { name: `${DOC.title}: signed` })).toHaveAttribute("aria-valuenow", "1");
    await expect(waiverCell(rowFor(page, "Hank Odom"), DOC.title)).toHaveText(new RegExp(`Signed ${todayShort()}$`));
    await go(page, `/admin/waivers/person/${hankId}`);
    const copy = cardOf(page.getByRole("heading", { level: 2, name: DOC.title }));
    await expect(copy.getByRole("img", { name: "Signature of Hank Odom" })).toBeVisible();
    await expect(detail(copy, "Document version")).toHaveText("Version 1 (current)");
    await expect(detail(copy, "Wording")).toHaveText("Matches the wording in use today");
    await expect(detail(copy, "Device")).toContainText("Mozilla");

    // A wording change without asking for new signatures: the form warns, and the signed copy is marked as different wording.
    await editDocument(
      page,
      async (f) => {
        await f.getByLabel("Wording").fill(`${DOC.body}\n\nI will not leave a jack under an unattended car.`);
        await expect(f.getByText("The wording has changed")).toBeVisible();
        await expect(f).toContainText("Tick “Require everyone to sign again” unless this is only a typo fix.");
      },
      "Document saved",
    );
    await expect(docCard(page, DOC.title)).toContainText("Version 1");
    await go(page, `/admin/waivers/person/${hankId}`);
    await expect(copyStatus(copy)).toHaveText("Signed");
    await expect(detail(copy, "Wording")).toHaveText("Signed different wording from what is in use today");

    // Now require everyone to sign again: version 2, and Hank's signature no longer counts.
    await editDocument(
      page,
      async (f) => {
        await expect(f).toContainText("Moves the document from version 1 to 2. Existing signatures stay on record but no longer count.");
        await f.getByRole("checkbox", { name: /^Require everyone to sign again/ }).check();
      },
      "Saved. Everyone will be asked to sign again.",
    );
    await expect(docCard(page, DOC.title)).toContainText("Version 2");
    await go(page, "/admin/waivers");
    await expect(page.getByRole("progressbar", { name: `${DOC.title}: signed` })).toHaveAttribute("aria-valuenow", "0");
    await expect(waiverCell(rowFor(page, "Hank Odom"), DOC.title)).toHaveText(new RegExp(`Signed an earlier version$`));
    await expect(rowFor(page, "Hank Odom").getByRole("button", { name: "Remind" })).toBeVisible();
    await go(page, `/admin/waivers/person/${hankId}`);
    await expect(copyStatus(copy)).toHaveText("Signed an earlier version");
    await expect(detail(copy, "Document version")).toHaveText("Version 1, now superseded by version 2");
    await expect(page.getByRole("button", { name: "Remind about 1 unsigned" })).toBeVisible();
    // Hank is asked to sign again.
    await go(hank, "/me/waivers");
    await expect(tally).toHaveText(`${required - 1}/${required}`);
    await expect(hank.getByRole("link", { name: new RegExp(`^${esc(DOC.title)}`) })).toContainText("Updated since you signed. Sign it again.");
    await hank.getByRole("link", { name: new RegExp(`^${esc(DOC.title)}`) }).click();
    await expect(hank.getByText("This document was updated after you signed it")).toBeVisible();
    await expect(hank.locator("main")).toContainText("I will not leave a jack under an unattended car.");
  });

  test("a signature on an earlier version stops counting everywhere: the roster, the overview and the driver's own Now screen", async ({ page, as }) => {
    const id = docId();
    test.skip(!id || val(`select version from waiver_templates where id = '${id}'`) !== "2", "needs the document moved to version 2 in the previous test");
    const hankId = val(`select id from users where email = '${PEOPLE.hank.email}'`);
    const stale = count(`select count(*) from waiver_signatures where template_id = '${id}' and user_id = '${hankId}' and template_version = 1`);
    test.skip(!stale, "needs Hank's signature on version 1");
    const required = documents().filter((d) => d.required).length;
    const done = outstanding().filter((p) => p.left === 0).length;
    // The waivers screen already says so (previous test). The other places that count waivers must agree with it.
    await go(page, "/admin/roster");
    await page.getByRole("searchbox").fill("Hank Odom");
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Odom, Hank", exact: true }) });
    await expect(row.getByRole("cell").nth(5), "Hank's waivers on the roster").toHaveText(`${required - 1}/${required}`);
    await go(page, `/admin/roster/${hankId}`);
    await expect(page.locator("dt").filter({ hasText: /^Waivers$/ }).locator("xpath=following-sibling::dd[1]"), "Hank's waivers on his roster page").toHaveText(`${required - 1} of ${required} signed`);
    await go(page, "/admin");
    await expect(section(page, "Paperwork").getByRole("link", { name: /Waivers signed/ }), "the overview's count of people with waivers signed").toHaveText(new RegExp(`Waivers signed\\s*${done}/${registered()}`));
    // Nobody with a waiver outstanding counts as cleared to drive, sticker or not.
    const stickered = count(
      `select count(*) from tech_inspections t join registrations r on r.event_id = t.event_id and r.user_id = t.user_id where t.event_id = '${event().id}' and r.status <> 'cancelled' and t.status = 'approved' and t.sticker_issued_at is not null`,
    );
    const clearedNow = sql(
      `select t.user_id from tech_inspections t join registrations r on r.event_id = t.event_id and r.user_id = t.user_id where t.event_id = '${event().id}' and r.status <> 'cancelled' and t.status = 'approved' and t.sticker_issued_at is not null`,
    ).filter((r) => waiversLeft(r[0]) === 0).length;
    expect(stickered, "cars with a sticker, to make the next check mean something").toBeGreaterThan(0);
    await expect(page.getByText("Cleared to drive", { exact: true }).locator(".."), "the overview's cleared count").toHaveText(new RegExp(`^Cleared to drive\\s*${clearedNow}/${registered()}`));
    const hank = await as("hank");
    await expect(hank.getByRole("link", { name: /^Waivers/ }).filter({ hasText: "signed" }), "the waivers line on Hank's Now screen").toContainText(`${required - 1} of ${required} signed`);
    await expect(hank.getByText("Cleared to drive"), "a cleared pill on Hank's Now screen").toHaveCount(0);

    // A sticker alone does not clear him either: grid tech and his own Tech screen both say what is missing.
    const sticker = val(`select coalesce(sticker_number, '') from tech_inspections where event_id = '${event().id}' and user_id = '${hankId}' and sticker_issued_at is not null`);
    test.skip(!sticker, "Hank's car has no sticker in this data, so the sticker screens cannot be checked on him");
    await go(page, `/admin/tech/grid?u=${hankId}`);
    await expect(page.getByText("Sticker issued · not cleared to drive")).toBeVisible();
    await expect(page.getByText("Cleared to go on track")).toHaveCount(0);
    await expect(page.locator("main")).toContainText(`Waivers: ${required - 1} of ${required} signed`);
    await expect(page.getByRole("link", { name: "Open their waivers" })).toHaveAttribute("href", `/admin/waivers/person/${hankId}`);
    await go(hank, "/me/tech");
    await expect(hank.getByText("Your car has its sticker, but you are not cleared to drive yet")).toBeVisible();
    await expect(hank.locator("main")).toContainText("You still need to sign 1 waiver before you go on track.");
    await expect(hank.getByText("You are cleared to drive")).toHaveCount(0);
  });

  test("signing the new version counts again; retiring a document takes it away from drivers and keeps the signatures", async ({ page, as }) => {
    const id = docId();
    test.skip(!id, "needs the document added earlier in this file");
    const e = event();
    const hankId = val(`select id from users where email = '${PEOPLE.hank.email}'`);
    const hank = await as("hank");
    const version = val(`select version from waiver_templates where id = '${id}'`);
    const current = () => count(`select count(*) from waiver_signatures where template_id = '${id}' and user_id = '${hankId}' and event_id = '${e.id}' and template_version >= ${version}`);
    if (val(`select active from waiver_templates where id = '${id}'`) === "t" && !current()) {
      await go(hank, `/me/waivers/${id}`);
      await hank.getByRole("checkbox", { name: "I have read and understand this document" }).check();
      await scribble(hank, hank.getByRole("img", { name: "Sign here" }));
      await hank.getByRole("button", { name: "Sign this waiver" }).click();
      await expect(toast(hank, "Waiver signed")).toBeVisible();
      await go(page, `/admin/waivers/person/${hankId}`);
      const copy = cardOf(page.getByRole("heading", { level: 2, name: DOC.title }));
      await expect(copyStatus(copy)).toHaveText("Signed");
      await expect(detail(copy, "Document version")).toHaveText(`Version ${version} (current)`);
      await expect(detail(copy, "Wording")).toHaveText("Matches the wording in use today");
    }
    expect(current(), "Hank's signature on the current version").toBe(1);

    // Retire it. This is also how the file leaves things as it found them: the seeded documents only.
    await editDocument(page, (f) => f.getByRole("checkbox", { name: /^In use/ }).uncheck(), "Document saved");
    await expect(docCard(page, DOC.title)).toContainText("Retired");
    await go(page, "/admin/waivers");
    await expect(page.getByRole("progressbar", { name: `${DOC.title}: signed` })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(DOC.title);
    await go(hank, "/me/waivers");
    await expect(hank.locator("main")).not.toContainText(DOC.title);
    await go(hank, `/me/waivers/${id}`);
    await expect(hank.getByText("That document is no longer in use")).toBeVisible();
    // The signature collected while it was in use is still on record.
    expect(count(`select count(*) from waiver_signatures where template_id = '${id}' and user_id = '${hankId}' and event_id = '${e.id}'`)).toBe(1);
    expect(documents().map((d) => d.title)).toEqual(sql(`select title from waiver_templates where active and title not like 'UAT %' order by sort_order, title`).map((r) => r[0]));
  });
});

// ───── incidents

/** One numbered item of the incident form ("Item 2: Driver"), as on the PCA paper form. */
const formItem = (page: Page, n: number, title: string) => cardOf(page.getByRole("heading", { level: 2, name: `Item ${n}: ${title}` }), 3);
/** Answer one of the form's Yes / No questions. */
const answer = (scope: Locator, question: string, yes: boolean) => pick(scope.getByRole("group", { name: question, exact: true }).getByRole("radio", { name: yes ? "Yes" : "No" }));
const statusCard = (page: Page) => cardOf(page.getByRole("heading", { level: 2, name: "Status" }));
const sendCard = (page: Page) => cardOf(page.getByRole("heading", { level: 2, name: "Send to PCA" }));
const openReports = () => count(`select count(*) from incidents where status <> 'sent'`);
const SUMMARY = `UAT ${T}: contact with the tire wall at Turn 3 exit; passenger taken to hospital.`;
const reportId = () => val(`select id from incidents where summary = '${q(SUMMARY)}'`);

test.describe("incident reports", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "marian");
  });

  test("the incident list groups reports by event with their status and due date, and explains when PCA wants one", async ({ page }) => {
    const e = event();
    const open = openReports();
    await go(page, "/admin/incidents");
    await expect(page.getByRole("heading", { level: 1, name: "Incidents" })).toBeVisible();
    if (open) await expect(page.getByText(`${open} report${open === 1 ? "" : "s"} not yet sent to PCA`)).toBeVisible();
    else await expect(page.getByText("When reports are due")).toBeVisible();
    await expect(page.locator("main")).toContainText("Reports are due at PCA within five business days of the incident. When there is bodily injury, the report is due the next business day. File one report per car.");
    // The five reporting criteria are a tap away.
    await page.getByText("When PCA requires a report").click();
    for (const c of ["Car-to-car contact of any sort", "Car damage from contact with an immovable object that cannot be buffed out", "Injury to a person", "Potential or actual injury to a person away from the track", "Verbal altercation with an event or region official"]) {
      await expect(page.getByText(c, { exact: true })).toBeVisible();
    }
    // Every report on file, under its event.
    for (const [driver, status, occurred, dueOn, eventName, eventId, location] of sql(`select coalesce(i.driver_name, 'Driver not recorded'), i.status, i.occurred_on, i.due_on, ev.name, ev.id, coalesce(i.location, '') from incidents i join events ev on ev.id = i.event_id where i.summary is null or i.summary not like 'UAT %'`)) {
      const group = section(page, eventId === e.id ? `${eventName} · event in focus` : eventName);
      const row = group.getByRole("listitem").filter({ hasText: driver }).first();
      await expect(row).toContainText({ draft: "Draft", final: "Final, not sent", sent: "Sent to PCA" }[status]!);
      await expect(row).toContainText(fmt(occurred, { month: "short", day: "numeric" }));
      if (location) await expect(row).toContainText(location);
      if (status !== "sent") await expect(row).toContainText(dayLong(dueOn));
    }
    // The menu counts the reports still to be sent.
    await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: /^Incidents/ })).toHaveText(new RegExp(`Incidents\\s*${open || ""}$`));
  });

  test("a report can be saved as a draft with gaps; it lists what is missing, prints as a draft, and can be deleted", async ({ page }) => {
    const e = event();
    const before = count(`select count(*) from incidents`);
    await go(page, "/admin/incidents");
    await page.getByRole("link", { name: "Report an incident" }).first().click();
    await page.waitForURL("**/admin/incidents/new");
    await expect(pageHeader(page)).toContainText(`Filed under ${e.name}.`);
    // What the app already knows is filled in.
    const settings = JSON.parse(val(`select settings::text from organizations`));
    await expect(page.getByLabel("PCA region")).toHaveValue(val(`select name from organizations`).replace(/,\s*Porsche Club of America$/i, ""));
    await expect(page.getByLabel("Name of event chair")).toHaveValue(settings.eventChair.name);
    await expect(page.getByRole("textbox", { name: /^Location/ })).toHaveValue("Roebling Road Raceway, 1135 Roebling Road, Bloomingdale, GA 31302");
    await expect(page.getByLabel("Type of event")).toHaveValue("Driver Education (HPDE)");
    await expect(formItem(page, 11, "Report prepared by").getByLabel("Name")).toHaveValue("Marian Castellanos");
    await expect(formItem(page, 11, "Report prepared by").getByLabel("Title")).toHaveValue("Event Chair");
    await expect(page.getByText("Nothing is checked, so PCA does not require a report.")).toBeVisible();

    // Without a date it cannot be saved at all.
    await page.getByLabel("Date of incident").fill("");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(toast(page, "The report was not saved")).toBeVisible();
    await expect(page.locator("main").getByRole("alert").filter({ hasText: "Enter the date" })).toHaveText("Enter the date of the incident.");
    expect(count(`select count(*) from incidents`)).toBe(before);

    // A date and one criterion: enough for a draft, and the form says when PCA needs it.
    await page.getByLabel("Date of incident").fill(e.start);
    await page.getByRole("checkbox", { name: /^Car damage from contact with an immovable object/ }).check();
    const due = businessDaysAfter(e.start, 5);
    await expect(page.getByText("A report is required")).toBeVisible();
    await expect(page.locator("main")).toContainText(`Due at PCA by ${dayLong(due)}: five business days after the incident. File one report per car.`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/admin\/incidents\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { level: 1, name: "Incident report" })).toBeVisible();
    await expect(statusCard(page)).toContainText("Draft");
    await expect(statusCard(page)).toContainText(`Due ${dayLong(due)}: five business days after the incident.`);
    await expect(statusCard(page)).toContainText("Before it can be marked final, add:");
    for (const missing of ["where it happened", "the driver's name", "whether the driver was injured", "whether the driver was a signed-in entrant", "whether there was a passenger", "whether any other party was injured", "a description of the automobile", "a description of the incident", "the preparer's signature"]) {
      await expect(statusCard(page).getByRole("listitem").filter({ hasText: new RegExp(`^${esc(missing)}$`) })).toBeVisible();
    }
    // A draft cannot be sent: there is no send panel yet.
    await expect(page.getByRole("heading", { name: "Send to PCA" })).toHaveCount(0);

    // Asking for final with gaps keeps it a draft and says why.
    await page.getByRole("button", { name: "Mark final" }).click();
    await expect(toast(page, "Saved as a draft")).toBeVisible();
    await expect(page.getByText("Saved as a draft. To mark it final, add:")).toBeVisible();
    expect(val(`select status from incidents where id = '${id}'`)).toBe("draft");

    // Printed, it is marked as a draft.
    await page.getByRole("link", { name: "Print or save as PDF" }).click();
    await page.waitForURL(`**/admin/incidents/${id}/print`);
    await expect(page.getByRole("heading", { level: 1, name: "Incident Report – Driving Event" })).toBeVisible();
    await expect(page.getByText("This report is still a draft")).toBeVisible();
    await expect(page.getByText("Draft · not for submission")).toBeVisible();
    await page.getByRole("link", { name: "Back to the report" }).click();
    await page.waitForURL(`**/admin/incidents/${id}`);

    // It is on the list and on the overview, until it is deleted.
    await go(page, "/admin");
    await expect(section(page, "Needs attention").getByRole("link", { name: /^Incident report in draft: unnamed driver/ })).toHaveAttribute("href", `/admin/incidents/${id}`);
    await go(page, `/admin/incidents/${id}`);
    const asked = nextConfirm(page);
    await page.getByRole("button", { name: "Delete this draft" }).click();
    await page.waitForURL("**/admin/incidents");
    expect(asked.text).toBe("Delete this draft? It cannot be recovered.");
    expect(count(`select count(*) from incidents`)).toBe(before);
    await page.goto(`/admin/incidents/${id}`);
    await expect(page.getByText("That report was not found")).toBeVisible();
  });

  test("a full report: every field of the PCA form, marked final, printed, sent on to the recipients and recorded as sent", async ({ page }) => {
    const e = event();
    const [d] = sql(
      `select u.id, u.first_name, u.last_name, u.email, u.phone, u.address1, u.city, u.state, u.zip, r.car_number, v.year, v.make, v.model, v.color
         from registrations r join users u on u.id = r.user_id join memberships m on m.user_id = u.id join vehicles v on v.id = r.vehicle_id
        where r.event_id = '${e.id}' and r.status <> 'cancelled' and r.checked_in_at is not null and not m.is_admin and not r.is_instructor and ${NOT_PROTECTED}
        order by u.last_name limit 1`,
    );
    const driver = { id: d[0], name: `${d[1]} ${d[2]}`, email: d[3], phone: d[4], address: `${d[5]}, ${d[6]}, ${d[7]} ${d[8]}`, option: `${d[2]}, ${d[1]} · #${d[9]}`, vehicle: `${d[10]} ${d[11]} ${d[12]}, ${d[13]}, car #${d[9]}.` };
    const where = "Turn 3 exit, driver's left";
    const description = `UAT ${T}. During the 2:05 PM session the car ran wide at the exit of Turn 3, crossed the grass and struck the tire wall with the left front corner at about 30 mph.\nThe left front fender and bumper cover are damaged. The passenger reported wrist pain.`;
    const comments = `UAT ${T}. Session was red-flagged for nine minutes while the tire wall was rebuilt.`;
    const dueOn = businessDaysAfter(e.start, 1);
    const emailsBefore = count(`select count(*) from message_log`);
    const openBefore = openReports();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    await go(page, "/admin/incidents/new");
    // Why a report is needed.
    await page.getByRole("checkbox", { name: /^Car damage from contact with an immovable object/ }).check();
    await page.getByRole("checkbox", { name: /^Injury to a person/ }).check();
    // 1. Event.
    const item1 = formItem(page, 1, "Event");
    await item1.getByLabel("Type of event").fill("Driver Education (HPDE), Blue run group");
    await item1.getByLabel("Date of incident").fill(e.start);
    await item1.getByLabel("Time", { exact: true }).fill("14:05");
    await item1.getByRole("button", { name: "Turn 3", exact: true }).click();
    await expect(item1.getByRole("textbox", { name: /^Where it happened/ })).toHaveValue("Turn 3");
    await item1.getByRole("textbox", { name: /^Where it happened/ }).fill(where);
    // With an injury ticked the report is due the next working day.
    await expect(page.locator("main")).toContainText(`Due at PCA by ${dayLong(dueOn)}: the next business day, because there is bodily injury.`);
    // 2. Driver: picked from the roster, which fills in their details, their car, and that they signed in.
    const item2 = formItem(page, 2, "Driver");
    await item2.getByLabel("Pick from the roster").selectOption({ label: driver.option });
    await expect(item2.getByLabel("Name of driver")).toHaveValue(driver.name);
    await expect(item2.getByLabel("Telephone")).toHaveValue(driver.phone);
    await expect(item2.getByLabel("Address")).toHaveValue(driver.address);
    await expect(item2.getByLabel("Email")).toHaveValue(driver.email);
    await expect(item2.getByRole("group", { name: "Was the driver a signed-in entrant?" }).getByRole("radio", { name: "Yes" })).toBeChecked();
    await answer(item2, "Any injuries?", false);
    await item2.getByLabel("Who determined?").fill("Track medical staff");
    // "No" to signed-in asks for an explanation; this driver did sign in, so back to "Yes".
    await answer(item2, "Was the driver a signed-in entrant?", false);
    await expect(item2.getByLabel("If no, please explain")).toBeVisible();
    await answer(item2, "Was the driver a signed-in entrant?", true);
    await expect(item2.getByLabel("If no, please explain")).toHaveCount(0);
    // 3. Passenger.
    const item3 = formItem(page, 3, "Passenger");
    await answer(item3, "Was there a passenger in the vehicle?", true);
    await item3.getByLabel("Name").fill("Pat Passenger");
    await item3.getByLabel("Telephone").fill("(912) 555-0173");
    await item3.getByLabel("Address").fill("44 Example Street, Savannah, GA 31401");
    await item3.getByLabel("Email").fill("pat.passenger@example.com");
    await answer(item3, "Any injuries?", true);
    await item3.getByLabel("Who determined?").fill("EMT at the scene");
    await answer(item3, "Was the passenger a signed-in entrant?", false);
    await item3.getByLabel("If no, please explain").fill("Guest of the driver who had not yet signed in at registration.");
    // 4. Other injured party.
    const item4 = formItem(page, 4, "Other injured party");
    await answer(item4, "Was there injury to any other party?", true);
    await item4.getByLabel("Name").fill("Casey Cornerworker");
    await item4.getByLabel("Telephone").fill("(912) 555-0174");
    await item4.getByLabel("Address").fill("9 Flag Station Road, Bloomingdale, GA 31302");
    await item4.getByLabel("Email").fill("casey.cornerworker@example.com");
    await item4.getByLabel("Who determined the injury?").fill("Track medical staff");
    await answer(item4, "Was the injured party a signed-in entrant?", true);
    await item4.getByLabel("If yes, in what role?").fill("Corner worker at Station 3");
    // 5. Waivers, with a link to the driver's signed copies.
    const item5 = formItem(page, 5, "Signed waivers");
    await item5.getByRole("checkbox", { name: "Signed waivers will be attached for everyone named in this report" }).check();
    await expect(item5.getByRole("link", { name: `Open ${driver.name}'s signed waivers` })).toHaveAttribute("href", `/admin/waivers/person/${driver.id}`);
    // 6 and 7. The car and what happened.
    await expect(page.getByLabel("Automobile involved")).toHaveValue(driver.vehicle);
    await page.getByLabel("Automobile involved").fill(`${driver.vehicle} Two-door coupe.`);
    await page.getByLabel("Description of the incident").fill(description);
    await page.getByLabel("One-line summary").fill(SUMMARY);
    // 8. Transport.
    const item8 = formItem(page, 8, "Transport");
    await item8.getByLabel("Name of person transported").fill("Pat Passenger");
    await item8.getByLabel("Name of hospital").fill("Memorial Health University Medical Center");
    await item8.getByLabel("Hospital address").fill("Savannah, GA 31404");
    await item8.getByLabel("Hospital telephone").fill("(912) 555-0175");
    await item8.getByRole("radio", { name: "Outpatient emergency room" }).check();
    // 9. Sketch: the car's path in pen, and where it came to rest.
    const item9 = formItem(page, 9, "Sketch of the incident");
    const pad = item9.getByRole("img", { name: "Sketch of the incident" });
    await scribble(page, pad);
    await item9.getByRole("radio", { name: "Car position" }).click();
    const box = (await pad.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await expect(item9.getByRole("button", { name: "Undo" })).toBeEnabled();
    // 10 and 11. Comments, who prepared it, and their signature.
    await page.getByLabel("Additional comments").fill(comments);
    const item11 = formItem(page, 11, "Report prepared by");
    await item11.getByLabel("Telephone (home)").fill("(912) 555-0176");
    await item11.getByLabel("Fax").fill("(912) 555-0177");
    await scribble(page, item11.getByRole("img", { name: "Preparer signs here" }));

    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/admin\/incidents\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { level: 1, name: driver.name })).toBeVisible();
    await expect(pageHeader(page)).toContainText(`${e.name} · ${dayLong(e.start)} · ${where}`);
    await expect(statusCard(page)).toContainText("Draft");
    await expect(statusCard(page)).toContainText(`Due ${dayLong(dueOn)}: the next business day, because there is bodily injury.`);
    await expect(statusCard(page)).toContainText("Nothing required is missing. Mark it final when you have checked it over.");
    // Everything typed came back from the server as typed.
    await expect(formItem(page, 3, "Passenger").getByLabel("If no, please explain")).toHaveValue("Guest of the driver who had not yet signed in at registration.");
    await expect(formItem(page, 4, "Other injured party").getByLabel("If yes, in what role?")).toHaveValue("Corner worker at Station 3");
    await expect(formItem(page, 8, "Transport").getByRole("radio", { name: "Outpatient emergency room" })).toBeChecked();
    await expect(formItem(page, 11, "Report prepared by").getByRole("img", { name: "Signature of Marian Castellanos" })).toBeVisible();
    await expect(formItem(page, 11, "Report prepared by")).toContainText(`Signed ${todayShort()}`);
    expect(val(`select sketch like 'data:image/png;base64,%' from incidents where id = '${id}'`), "the sketch was stored").toBe("t");

    // Mark it final.
    await page.getByRole("button", { name: "Mark final" }).click();
    await expect(toast(page, "Report marked final")).toBeVisible();
    await expect(statusCard(page)).toContainText("Final, not sent");
    await expect(page.getByRole("button", { name: "Delete this draft" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Move back to draft" })).toBeVisible();

    // It can go back to a draft and be made final again.
    await page.getByRole("button", { name: "Move back to draft" }).click();
    await expect(toast(page, "Draft saved")).toBeVisible();
    await expect(statusCard(page)).toContainText("Draft");
    await page.getByRole("button", { name: "Mark final" }).click();
    await expect(toast(page, "Report marked final")).toBeVisible();
    await expect(statusCard(page)).toContainText("Final, not sent");

    // The list and the overview now show it as ready to send, with the injury marked.
    await go(page, "/admin/incidents");
    const row = section(page, `${e.name} · event in focus`).getByRole("listitem").filter({ hasText: SUMMARY });
    await expect(row).toContainText(driver.name);
    await expect(row).toContainText("Final, not sent");
    await expect(row).toContainText("Bodily injury");
    await expect(row).toContainText(`2:05 PM · ${where}`);
    await expect(row).toContainText(dayLong(dueOn));
    await go(page, "/admin");
    await expect(section(page, "Needs attention").getByRole("link", { name: new RegExp(`^Incident report ready to send: ${esc(driver.name)}`) })).toHaveAttribute("href", `/admin/incidents/${id}`);

    // The printable PCA form: every answer, in the paper form's order, with the sketch and the signature.
    await go(page, `/admin/incidents/${id}/print`);
    await expect(page.getByRole("heading", { level: 1, name: "Incident Report – Driving Event" })).toBeVisible();
    await expect(page.getByText("Version January 2017")).toBeVisible();
    await expect(page.getByText("Draft · not for submission")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
    const form = page.locator("article");
    const line = (label: string, nth = 0) => form.getByText(label, { exact: true }).nth(nth).locator("xpath=following-sibling::span[1]");
    await expect(line("PCA Region:")).toHaveText("Coastal Empire Region");
    await expect(line("Name of Event Chair:")).toHaveText("Marian Castellanos");
    await expect(line("Location (specific street, city/town, state):")).toHaveText("Roebling Road Raceway, 1135 Roebling Road, Bloomingdale, GA 31302");
    await expect(line("Type of Event:")).toHaveText("Driver Education (HPDE), Blue run group");
    await expect(line("Date of Incident:")).toHaveText(`${dayFull(e.start)}, 2:05 PM · ${where}`);
    await expect(line("Name of Driver:")).toHaveText(driver.name);
    await expect(line("Address:", 0)).toHaveText(driver.address);
    await expect(line("Telephone:", 1)).toHaveText(driver.phone);
    await expect(line("E-mail:", 1)).toHaveText(driver.email);
    await expect(line("Who determined:", 0)).toHaveText("Track medical staff");
    await expect(line("If yes, Name of Passenger:")).toHaveText("Pat Passenger");
    await expect(line("Address:", 1)).toHaveText("44 Example Street, Savannah, GA 31401");
    await expect(line("Who determined:", 1)).toHaveText("EMT at the scene");
    await expect(line("If no, please explain?", 1)).toHaveText("Guest of the driver who had not yet signed in at registration.");
    await expect(line("If yes, Name of Injured Party:")).toHaveText("Casey Cornerworker");
    await expect(line("Who determined injury:")).toHaveText("Track medical staff");
    await expect(line("If yes, in what role? (i.e. photographer, caterer, etc)")).toHaveText("Corner worker at Station 3");
    await expect(line("Name of person transported:")).toHaveText("Pat Passenger");
    await expect(line("Name of Hospital:")).toHaveText("Memorial Health University Medical Center");
    await expect(line("Address (city/state/zip):")).toHaveText("Savannah, GA 31404");
    await expect(line("Report prepared by:")).toHaveText("Marian Castellanos");
    await expect(line("Title:")).toHaveText("Event Chair");
    await expect(line("Telephone (H):")).toHaveText("(912) 555-0176");
    await expect(line("Fax:")).toHaveText("(912) 555-0177");
    // The Yes / No boxes.
    const yesNo = (question: string, nth = 0) => form.getByText(question, { exact: true }).nth(nth).locator("..");
    await expect(yesNo("Any injuries?", 0)).toContainText("Answer: no");
    await expect(yesNo("Was driver a signed-in entrant?")).toContainText("Answer: yes");
    await expect(yesNo("Was there a passenger in the vehicle?")).toContainText("Answer: yes");
    await expect(yesNo("Any injuries?", 1)).toContainText("Answer: yes");
    await expect(yesNo("Was passenger a signed-in entrant?")).toContainText("Answer: no");
    await expect(yesNo("Was there injury to any other party?")).toContainText("Answer: yes");
    await expect(yesNo("Was injured party a signed in entrant?")).toContainText("Answer: yes");
    await expect(form).toContainText(`${driver.vehicle} Two-door coupe.`);
    await expect(form).toContainText("struck the tire wall with the left front corner at about 30 mph");
    await expect(form).toContainText("The passenger reported wrist pain.");
    await expect(form).toContainText(comments);
    await expect(form.getByRole("img", { name: "Sketch of the incident drawn over the circuit" })).toBeVisible();
    await expect(form.getByRole("img", { name: "Signature of Marian Castellanos" })).toBeVisible();
    // Who it goes to, from Settings, and when it is due.
    const recipients = (JSON.parse(val(`select settings::text from organizations`)).incidentRecipients as { role: string; name?: string; email: string }[]);
    for (const r of recipients) await expect(form.getByRole("row").filter({ hasText: r.role })).toContainText(r.email || "address to be confirmed");
    await expect(form).toContainText(`Final, not sent · Report due at PCA by ${dayFull(dueOn)} · Prepared with Track Day for CERPCA`);

    // Sending. The app never emails the report itself: it lists the recipients and opens the administrator's own email, addressed.
    await go(page, `/admin/incidents/${id}`);
    const send = sendCard(page);
    await expect(send).toContainText("Email the PDF, with the signed waivers, to everyone below.");
    for (const r of recipients) await expect(send.getByRole("listitem").filter({ hasText: r.role })).toContainText(r.email || "Needs an email address");
    const withAddress = recipients.map((r) => r.email.trim()).filter(Boolean);
    const mailto = new URL((await send.getByRole("link", { name: "Open email" }).getAttribute("href"))!);
    expect(mailto.protocol).toBe("mailto:");
    expect(decodeURIComponent(mailto.pathname).split(",")).toEqual(withAddress);
    expect(mailto.searchParams.get("subject")).toBe(`PCA Incident Report: Coastal Empire Region, ${e.name}, ${dayLong(e.start)}`);
    expect(mailto.searchParams.get("body")).toContain(`Submitted by Marian Castellanos, Event Chair, Coastal Empire Region.`);
    await send.getByRole("button", { name: "Copy addresses" }).click();
    await expect(toast(page, `${withAddress.length} addresses copied`)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(withAddress.join(", "));
    await expect(send.getByRole("link", { name: "Open the print view" })).toHaveAttribute("href", `/admin/incidents/${id}/print`);

    // Record it as sent: the due date stops counting and it leaves the overview.
    let asked = nextConfirm(page);
    await send.getByRole("button", { name: "Record as sent to PCA" }).click();
    await expect(toast(page, "Recorded as sent to PCA")).toBeVisible();
    expect(asked.text).toBe("Record this report as sent to PCA? Only do this after the email has gone out.");
    await expect(statusCard(page)).toContainText("Sent to PCA");
    await expect(send).toContainText(new RegExp(`Recorded as sent on ${todayShort()}, \\d{1,2}:\\d{2} [AP]M\\.`));
    await expect(page.locator("main")).toContainText("Already sent to PCA. Changes are saved to the record.");
    expect(openReports()).toBe(openBefore);
    await go(page, "/admin");
    await expect(section(page, "Needs attention")).not.toContainText(driver.name);
    await go(page, "/admin/incidents");
    await expect(row).toContainText("Sent to PCA");
    // A correction after sending is saved without changing its status.
    await go(page, `/admin/incidents/${id}`);
    await page.getByLabel("Additional comments").fill(`${comments} Passenger was released the same evening.`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Changes saved")).toBeVisible();
    expect(val(`select status from incidents where id = '${id}'`)).toBe("sent");

    // Recorded by mistake? It can be marked as not sent, and then sent again.
    asked = nextConfirm(page);
    await send.getByRole("button", { name: "Mark as not sent" }).click();
    await expect(toast(page, "Marked as not sent")).toBeVisible();
    expect(asked.text).toBe("Mark this report as not sent? The due date will start counting again.");
    await expect(statusCard(page)).toContainText("Final, not sent");
    expect(openReports()).toBe(openBefore + 1);
    await send.getByRole("button", { name: "Record as sent to PCA" }).click();
    await expect(toast(page, "Recorded as sent to PCA")).toBeVisible();
    expect(openReports()).toBe(openBefore);

    // Through all of that the app itself sent nothing: no email, text or push is in the delivery log.
    expect(count(`select count(*) from message_log`), "messages the app logged while the report was written, finalised and recorded as sent").toBe(emailsBefore);
  });
});

// ───── who may use these screens

test.describe("paperwork screens: who may use them", () => {
  test("a driver and an instructor are turned away from the tech, waiver and incident screens", async ({ as }) => {
    const e = event();
    const tech = val(`select t.id from tech_inspections t where t.event_id = '${e.id}' limit 1`);
    const incident = val(`select id from incidents order by created_at limit 1`);
    const someone = people(NOT_PROTECTED)[0];
    const pages = ["/admin/tech", "/admin/tech?tab=approved", `/admin/tech/${tech}`, "/admin/tech/grid", `/admin/tech/grid?u=${someone.id}`, "/admin/tech/shops", "/admin/waivers", "/admin/waivers?tab=documents", `/admin/waivers/person/${someone.id}`, "/admin/incidents", "/admin/incidents/new", `/admin/incidents/${incident}`, `/admin/incidents/${incident}/print`];
    for (const who of ["simone", "rosalind"] as const) {
      const page = await as(who);
      for (const path of pages) {
        await go(page, path);
        await page.waitForURL("**/home");
        await expect(page.locator("main"), `${who} at ${path}`).not.toContainText(someone.email);
        await expect(page.locator("main")).not.toContainText("Incident Report – Driving Event");
      }
    }
  });

  test("a driver or instructor cannot replay the tech inspector's actions", async ({ page, as }) => {
    const shop = sql(`select id, name from shops where name = '${q(SHOP.name)}'`)[0] ?? sql(`select id, name from shops where not verified and email is not null order by name limit 1`)[0];
    test.skip(!shop, "needs a shop that is not verified");
    await signIn(page, "hank");
    await go(page, "/admin/tech/shops");
    // Hank verifies a shop (recording what his browser sent), then removes the verification.
    const verify = await captureAction(page, () => rowFor(page, shop[1]).getByRole("button", { name: "Mark verified" }).click());
    await expect(toast(page, `${shop[1]} is now verified`)).toBeVisible();
    await rowFor(page, shop[1]).getByRole("button", { name: "Remove verification" }).click();
    await expect(toast(page, `${shop[1]} is no longer verified`)).toBeVisible();
    // The recording is good: replayed from Hank's own browser it verifies the shop again.
    await replay(page, verify);
    expect(val(`select verified from shops where id = '${shop[0]}'`), "the recorded request works for an administrator").toBe("t");
    await go(page, "/admin/tech/shops");
    await rowFor(page, shop[1]).getByRole("button", { name: "Remove verification" }).click();
    await expect(toast(page, `${shop[1]} is no longer verified`)).toBeVisible();
    // From a driver's or an instructor's browser it does nothing.
    for (const who of ["simone", "rosalind"] as const) {
      const other = await as(who);
      const res = await replay(other, verify);
      expect(res.status(), `${who} replaying "Mark verified"`).toBeLessThan(500);
      expect(val(`select verified from shops where id = '${shop[0]}'`), `the shop is still unverified after ${who} replayed the request`).toBe("f");
    }
  });
});
