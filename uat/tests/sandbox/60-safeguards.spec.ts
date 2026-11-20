import type { BrowserContext, Locator, Page } from "@playwright/test";
import fs from "node:fs";
import { test as base, expect, signIn, sql, val, openBrowser, PEOPLE, T } from "./fixtures";
import { clashesIfPaired, clashShort, clashText, isDoubleBooking, pairingClashes, type PairedStudent, type PairingPerson } from "../../../src/lib/pairing";

// Things that must not slip through at an event:
//  - a sign-in code cannot be found by guessing, however fast or however many codes are asked for;
//  - a student whose instructor leaves the event is unpaired again, and is told;
//  - a session moved to another run group tells the group that lost it;
//  - an urgent alert, a cancelled session and a moved session are all visible on the Now screen;
//  - importing the registration export again does not undo a run group set in the app.
//  - a sign-in code is never kept where an administrator can read it, and the delivery log shows one region only;
//  - an instructor is never quietly given two students who are on track at the same time.
//
// House rules for this file:
//  - It runs last. Tessa Nakamura, Arjun Mehta and Owen Gallagher are still left alone, and so are the
//    sample accounts' pairings. People to work on are picked from the roster at run time.
//  - The seeded sessions stay as they are. The schedule tests add one late-evening item of their own
//    on the first day (named by its note) and only move or cancel that.

// ───── helpers

const SAMPLE: string[] = Object.values(PEOPLE).map((p) => p.email);
const inList = (emails: string[]) => emails.map((e) => `'${e}'`).join(",");
const q = (v: string) => v.replace(/'/g, "''");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const count = (query: string) => Number(val(query));

/** The event everyone is working on: the seeded "Fall Driver Education" on the coming weekend. */
const event = () => {
  const [row] = sql(`select id, name, start_date, end_date from events where slug = 'fall-de'`);
  return { id: row[0], name: row[1], start: row[2], end: row[3] };
};
const weekday = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${day}T12:00:00Z`));

type Person = { id: string; first: string; last: string; name: string; email: string; regId: string; group: string };
/** Drivers on the roster who are not administrators, instructors or sample accounts, by a condition on their registration (r) or run group (g). */
const drivers = (where = "true", order = "u.last_name desc, u.first_name"): Person[] =>
  sql(
    `select u.id, u.first_name, u.last_name, u.email, r.id, g.name
       from registrations r join users u on u.id = r.user_id join run_groups g on g.id = r.run_group_id join memberships m on m.user_id = u.id
      where r.event_id = '${event().id}' and r.status <> 'cancelled' and not m.is_admin and not m.is_instructor and not r.is_instructor
        and u.email not in (${inList(SAMPLE)}) and (${where})
      order by ${order}`,
  ).map((r) => ({ id: r[0], first: r[1], last: r[2], name: `${r[1]} ${r[2]}`, email: r[3], regId: r[4], group: r[5] }));
/** Emails of everyone registered for the event who matches a condition on their registration (r) or run group (g). */
const audience = (cond: string) =>
  sql(
    `select u.email from registrations r join users u on u.id = r.user_id join run_groups g on g.id = r.run_group_id
      where r.event_id = '${event().id}' and r.status <> 'cancelled' and (${cond}) order by 1`,
  ).map((r) => r[0]);
/** The newest announcement with this title whose message contains a phrase, and who actually got the alert. */
function sentAlert(title: string, phrase: string) {
  const [row] = sql(`select id, urgent from announcements where title = '${q(title)}' and body like '%${q(phrase)}%' order by created_at desc limit 1`);
  if (!row) return null;
  return { id: row[0], urgent: row[1] === "t", to: sql(`select u.email from notifications n join users u on u.id = n.user_id where n.announcement_id = '${row[0]}' order by 1`).map((r) => r[0]) };
}

/** Sign in the way a member without a sample-account button does: the emailed one-time code (shown on screen in demo mode). */
async function signInWithCode(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /Email me a code/ }).click();
  const notice = page.getByText(/Your code is/);
  await expect(notice).toBeVisible();
  await page.getByLabel("Sign-in code").fill(((await notice.textContent()) ?? "").match(/\d{6}/)?.[0] ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/home", { timeout: 30_000 });
}

// One sign-in per person per run, shared with the administrator spec files: nobody is asked for more
// one-time codes than the app allows in a quarter of an hour.
type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const SESSIONS = `.work/admin-sessions-${T}.json`;
const knownSessions = (): Record<string, Cookies> => {
  try { return JSON.parse(fs.readFileSync(SESSIONS, "utf8")); } catch { return {}; }
};
function rememberSession(email: string, cookies: Cookies) {
  fs.mkdirSync(".work", { recursive: true });
  fs.writeFileSync(SESSIONS, JSON.stringify({ ...knownSessions(), [email]: cookies.filter((c) => c.name === "td_session") }));
}

const test = base.extend<{ asEmail: (email: string, opts?: { phone?: boolean }) => Promise<Page> }>({
  /** A signed-in page for any seeded person, by email, in their own browser. */
  asEmail: async ({ browser, problems }, use) => {
    const open: BrowserContext[] = [];
    await use(async (email, opts) => {
      const ctx = await openBrowser(browser, problems, opts?.phone ? { viewport: { width: 375, height: 812 } } : {});
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

/** Open a screen and wait until its content has arrived (every screen paints a grey placeholder first). */
async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main h1").filter({ visible: true }).first()).toBeVisible();
}
const sheet = (page: Page) => page.getByRole("dialog");
/** A brief confirmation at the bottom of the screen. */
const toast = (page: Page, text: string | RegExp) => page.locator("[aria-live='polite']").getByText(text).first();
/** Tap one of the pill-shaped choices (the real radio or checkbox sits hidden inside its label). */
const pick = (input: Locator) => input.locator("xpath=ancestor::label[1]").click();
/** One of the numbers at the top of a screen, by its label. */
const stat = (page: Page, label: string) => page.locator("main").getByText(label, { exact: true }).filter({ visible: true }).first().locator("..");
const clock = (min: number) => `${Math.floor(min / 60) % 12 === 0 ? 12 : Math.floor(min / 60) % 12}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;

/** Record the request a Server Action makes, so a test can send copies of it. */
async function captureAction(page: Page, trigger: () => Promise<unknown>) {
  const [req] = await Promise.all([page.waitForRequest((r) => r.method() === "POST" && Boolean(r.headers()["next-action"])), trigger()]);
  const h = await req.allHeaders();
  return { url: req.url(), body: req.postDataBuffer() ?? Buffer.from(""), headers: { "next-action": h["next-action"], "content-type": h["content-type"], accept: h["accept"] ?? "text/x-component", origin: new URL(req.url()).origin } };
}
type Captured = Awaited<ReturnType<typeof captureAction>>;
const replay = (as: Page, a: Captured) => as.context().request.post(a.url, { headers: a.headers, data: a.body, maxRedirects: 0, failOnStatusCode: false });

/** Limits are counted in fixed windows. Wait out the last moments of one, so a test's requests all land in the same window. */
async function clearOfWindowEnd(minutes: number, margin = 40_000) {
  const left = minutes * 60_000 - (Date.now() % (minutes * 60_000));
  if (left < margin) await new Promise((r) => setTimeout(r, left + 1500));
}

// ───── sign-in codes

test.describe("sign-in codes cannot be found by guessing", () => {
  const latestCode = (email: string) => {
    const [r] = sql(`select attempts, consumed_at is not null from otp_codes where email = '${q(email)}' order by created_at desc limit 1`);
    return { attempts: Number(r?.[0] ?? -1), used: r?.[1] === "t" };
  };
  const sessions = (userId: string) => count(`select count(*) from sessions where user_id = '${userId}'`);
  /**
   * Drivers to guess codes for. Nobody has asked a code for them in the last hour, so the hourly limit starts
   * from nothing; and they are not people the later tests sign in as (a student, or the White and Blue drivers
   * those tests pick), because these tests leave an address unable to sign in for the rest of the hour.
   */
  const fresh = () => {
    const later = [drivers("g.key = 'white' and r.attends_day1")[0], drivers("g.key = 'blue'")[0]].filter(Boolean).map((p) => p.email);
    return drivers(
      `not exists (select 1 from otp_codes o where o.email = u.email and o.created_at > now() - interval '61 minutes')
       and not exists (select 1 from instructor_assignments a where a.event_id = r.event_id and a.student_id = u.id)
       and u.email not in (${inList(["", ...later])})`,
      "u.last_name, u.first_name",
    );
  };
  /** The answer to the next sign-in form post. A step is only read or typed into once its answer is back. */
  const posted = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/login");
  /** Ask for a code, read it off the screen (demo mode shows it), and make one wrong guess, keeping a recording of that request. */
  async function wrongGuess(page: Page, email: string) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /Email me a code/ }).click();
    const notice = page.getByText(/Your code is/);
    await expect(notice).toBeVisible();
    const code = ((await notice.textContent()) ?? "").match(/\d{6}/)?.[0] ?? "";
    expect(code, "a 6-digit code on screen").toMatch(/^\d{6}$/);
    const wrong = code === "135790" ? "246801" : "135790";
    await page.getByLabel("Sign-in code").fill(wrong);
    const guess = await captureAction(page, () => page.getByRole("button", { name: "Sign in", exact: true }).click());
    await expect(page.getByText(/wrong or has expired/)).toBeVisible();
    expect(guess.body.toString("latin1"), "the recorded request carries the guess").toContain(wrong);
    return { code, wrong, guess };
  }

  test("guesses that arrive together cannot share a code's five attempts, and a spent code refuses even the right answer", async ({ page }) => {
    const who = fresh()[0];
    test.skip(!who, "needs a driver who has not signed in with a code in the last hour");
    await clearOfWindowEnd(60);
    const before = sessions(who.id);
    const { code, guess } = await wrongGuess(page, who.email);
    expect(latestCode(who.email).attempts, "attempts after one wrong guess").toBe(1);

    // Eight more copies of that wrong guess, all at once. Each must use up one of the code's five attempts:
    // if they could all read the count before any of them wrote it, the code would still have attempts left.
    const answers = await Promise.all(Array.from({ length: 8 }, () => replay(page, guess)));
    for (const a of answers) expect(a.status(), "a refused guess is an ordinary answer, not an error").toBeLessThan(500);
    expect(latestCode(who.email).attempts, "attempts counted against the code after nine guesses").toBe(5);
    expect(sessions(who.id), "sessions opened by wrong guesses").toBe(before);

    // The code is spent, so the right answer no longer opens anything.
    await page.getByLabel("Sign-in code").fill(code);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/wrong or has expired|Too many attempts/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect(sessions(who.id), "sessions opened with a spent code").toBe(before);

    // And the address itself is now held to ten guesses an hour, whatever code they are aimed at.
    const more = await Promise.all(Array.from({ length: 4 }, () => replay(page, guess)));
    for (const a of more) expect(a.status()).toBeLessThan(500);
    await Promise.all([posted(page), page.getByRole("button", { name: "Send a new code" }).click()]);
    const notice = page.getByText(/Your code is/);
    await expect(notice).not.toContainText(code);
    await page.getByLabel("Sign-in code").fill(((await notice.textContent()) ?? "").match(/\d{6}/)?.[0] ?? "");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Too many attempts. Wait a while, then send a new code.")).toBeVisible();
    expect(sessions(who.id), "sessions opened after the hourly limit").toBe(before);
    expect(latestCode(who.email).attempts, "a guess over the limit is not even looked at").toBe(0);
  });

  test("the right code opens one session, even when it is sent twice at once", async ({ page }) => {
    const who = fresh()[0];
    test.skip(!who, "needs a driver who has not signed in with a code in the last hour");
    const before = sessions(who.id);
    const { code, wrong, guess } = await wrongGuess(page, who.email);
    // The same request with the right code in place of the wrong one, sent twice together.
    const right: Captured = { ...guess, body: Buffer.from(guess.body.toString("latin1").split(wrong).join(code), "latin1") };
    const answers = await Promise.all([replay(page, right), replay(page, right)]);
    for (const a of answers) expect(a.status()).toBeLessThan(500);
    expect(latestCode(who.email).used, "the code is used up").toBe(true);
    expect(sessions(who.id) - before, "sessions opened by one code").toBe(1);
  });

  test("asking for code after code stops at five in a quarter of an hour, for any address", async ({ page }) => {
    // An address that is not on any roster is counted the same way as a member's.
    const email = `uat-limit-${T}@example.com`;
    await clearOfWindowEnd(15);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await Promise.all([posted(page), page.getByRole("button", { name: /Email me a code/ }).click()]);
    await expect(page.getByLabel("Sign-in code")).toBeVisible();
    for (let n = 2; n <= 5; n++) {
      await Promise.all([posted(page), page.getByRole("button", { name: "Send a new code" }).click()]);
      await expect(page.getByText(/Too many/), `request ${n} of 5`).toHaveCount(0);
    }
    await Promise.all([posted(page), page.getByRole("button", { name: "Send a new code" }).click()]);
    await expect(page.getByText("Too many sign-in codes have been requested. Wait 15 minutes, then try again.")).toBeVisible();
    expect(count(`select count(*) from otp_codes where email = '${email}'`), "codes stored for the address").toBe(5);
    expect(count(`select count(*) from message_log where to_address = '${email}'`), "emails sent to an address that is on no roster").toBe(0);
  });
});

// ───── pairings

test.describe("when an instructor leaves the event", () => {
  test("their students are unpaired again, are told, and show as needing an instructor", async ({ page, asEmail }) => {
    const e = event();
    // An instructor who is not a sample account or an administrator, with a student who has to ride with one.
    const needsOne = `(g.instructor_policy = 'required' or (g.instructor_policy = 'optional' and not rs.solo))`;
    const [row] = sql(
      `select i.id, i.first_name, i.last_name, s.id, s.first_name, s.last_name, s.email
         from instructor_assignments a
         join users i on i.id = a.instructor_id join registrations ri on ri.event_id = a.event_id and ri.user_id = i.id join memberships m on m.user_id = i.id
         join users s on s.id = a.student_id join registrations rs on rs.event_id = a.event_id and rs.user_id = s.id join run_groups g on g.id = rs.run_group_id
        where a.event_id = '${e.id}' and ri.status <> 'cancelled' and ri.is_instructor and rs.status <> 'cancelled' and not m.is_admin
          and i.email not in (${inList(SAMPLE)}) and s.email not in (${inList(SAMPLE)}) and ${needsOne}
        order by i.last_name, s.last_name limit 1`,
    );
    test.skip(!row, "needs an instructor, other than the sample accounts, with a student who must ride with one");
    const instructor = { id: row[0], first: row[1], name: `${row[1]} ${row[2]}` };
    const student = { id: row[3], name: `${row[4]} ${row[5]}`, email: row[6] };
    const students = count(`select count(*) from instructor_assignments where event_id = '${e.id}' and instructor_id = '${instructor.id}'`);
    const mustRide = count(
      `select count(*) from instructor_assignments a join registrations rs on rs.event_id = a.event_id and rs.user_id = a.student_id join run_groups g on g.id = rs.run_group_id
        where a.event_id = '${e.id}' and a.instructor_id = '${instructor.id}' and rs.status <> 'cancelled' and ${needsOne}`,
    );

    // The student sees their instructor on the Now screen to begin with.
    const theirs = await asEmail(student.email);
    await go(theirs, "/home");
    await expect(theirs.locator("main")).toContainText(instructor.name);

    await signIn(page, "marian");
    await go(page, "/admin/instructors");
    const unpairedBefore = Number((await stat(page, "Not paired yet").locator("p").nth(1).textContent()) ?? "x");
    expect(Number.isNaN(unpairedBefore), "a number under “Not paired yet”").toBe(false);

    await go(page, `/admin/roster/${instructor.id}`);
    await page.getByRole("button", { name: "Cancel registration" }).click();
    await expect(toast(page, `Registration cancelled. ${plural(mustRide, "student")} now ${mustRide === 1 ? "needs" : "need"} a new instructor: pair them under Instructor pairing`)).toBeVisible();
    expect(count(`select count(*) from instructor_assignments where event_id = '${e.id}' and instructor_id = '${instructor.id}'`), "pairings left with someone who is no longer at the event").toBe(0);
    expect(students).toBeGreaterThan(0);

    // The pairing page counts them as unpaired again, and offers to pair them.
    await go(page, "/admin/instructors");
    await expect(stat(page, "Not paired yet").locator("p").nth(1)).toHaveText(String(unpairedBefore + mustRide));
    await expect(page.getByRole("button", { name: "Pair the rest for me" })).toBeVisible();

    // The student is told, urgently, and their Now screen no longer names the instructor.
    const alert = sql(`select body, urgent from notifications where user_id = '${student.id}' and title = '${q(`${instructor.name} is no longer your instructor`)}' order by created_at desc limit 1`)[0];
    expect(alert, "an alert to the student").toBeTruthy();
    expect(alert[1], "the alert is urgent").toBe("t");
    expect(alert[0]).toContain("The administrators will pair you with another instructor");
    await go(theirs, "/home");
    await expect(theirs.getByRole("region", { name: "Urgent alerts" })).toContainText(`${instructor.name} is no longer your instructor`);
    await expect(theirs.locator("main")).toContainText("Not paired yet.");

    // Put it right: "Pair the rest for me" gives each of them an instructor who is still here.
    await page.getByRole("button", { name: "Pair the rest for me" }).click();
    await expect(toast(page, /\d+ paired/)).toBeVisible();
    const now = sql(
      `select ri.status, ri.is_instructor from instructor_assignments a join registrations ri on ri.event_id = a.event_id and ri.user_id = a.instructor_id
        where a.event_id = '${e.id}' and a.student_id = '${student.id}'`,
    )[0];
    if (now) expect(now, "the student's new instructor is on the roster and instructing").toEqual(["confirmed", "t"]);
  });
});

// ───── schedule changes

const NOTE = `UAT ${T} safeguards`;
const myItem = () => {
  const [r] = sql(`select id, title, day, start_min, end_min, cancelled, moved_from_min from schedule_items where event_id = '${event().id}' and note = '${q(NOTE)}'`);
  return r ? { id: r[0], title: r[1], day: r[2], start: Number(r[3]), end: Number(r[4]), cancelled: r[5] === "t", movedFrom: r[6] === "" ? null : Number(r[6]) } : null;
};
const editorRow = (page: Page) => page.getByRole("listitem").filter({ hasText: NOTE }).filter({ visible: true });
const NOTIFY = "Send an alert about this change to the people it affects";
/** The rows of the driver's own day on the Now screen. */
const myDayRows = (page: Page, day: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: `Your ${day}` }) }).filter({ visible: true }).getByRole("listitem");

test.describe("schedule changes on the day", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "marian");
  });

  test("moving a session to another run group tells the group that lost it as well as the group that gained it", async ({ page }) => {
    const e = event();
    const day = weekday(e.start);
    expect(count(`select count(*) from schedule_items where event_id = '${e.id}' and day = '${e.start}' and start_min >= ${20 * 60 + 55}`), `other late-evening items on ${day}`).toBe(0);

    // A late session for Green, added quietly.
    await go(page, `/admin/schedule?day=${e.start}`);
    await page.getByRole("button", { name: "Add item" }).click();
    const form = sheet(page);
    await form.getByLabel("Starts").fill("21:00");
    await form.getByLabel("Ends").fill("21:20");
    await pick(form.getByRole("checkbox", { name: "Green", exact: true }));
    await form.getByLabel("Note").fill(NOTE);
    await form.getByRole("checkbox", { name: NOTIFY }).uncheck();
    await form.getByRole("button", { name: "Add to schedule" }).click();
    await expect(toast(page, "Added to the schedule")).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    expect(myItem()?.title).toBe("Green");

    // Now it becomes White's session instead, with the alert on.
    await editorRow(page).getByRole("button", { name: "Edit Green" }).click();
    await pick(form.getByRole("checkbox", { name: "Green", exact: true }));
    await pick(form.getByRole("checkbox", { name: "White", exact: true }));
    await form.getByLabel("Title").fill("");
    await form.getByRole("checkbox", { name: NOTIFY }).check();
    await form.getByRole("button", { name: "Save changes" }).click();
    const green = audience("g.key = 'green'");
    const white = audience("g.key = 'white'");
    await expect(toast(page, `Schedule updated, and ${plural(green.length + white.length, "person", "people")} alerted`)).toBeVisible();
    expect(myItem()?.title).toBe("White");

    // White is told about the session; Green is told it is no longer theirs. Nobody gets both.
    const gained = sentAlert("Schedule change", "White at 9:00 PM was updated.");
    expect(gained, "an alert to the group that gained the session").not.toBeNull();
    expect(gained!.to).toEqual(white);
    const lost = sentAlert("Schedule change", `Green on ${day} at 9:00 PM is no longer on your schedule.`);
    expect(lost, "an alert to the group that lost the session").not.toBeNull();
    expect(lost!.urgent).toBe(true);
    expect(lost!.to).toEqual(green);
  });

  test("an urgent alert stays at the top of the Now screen until the driver taps “Got it”", async ({ asEmail }) => {
    test.skip(!myItem(), "needs the session added in the previous test");
    const driver = drivers("g.key = 'white' and r.attends_day1")[0];
    test.skip(!driver, "needs a White driver attending the first day");
    const phone = await asEmail(driver.email, { phone: true });
    await go(phone, "/home");
    const strip = phone.getByRole("region", { name: "Urgent alerts" });
    const mine = strip.locator("> div").filter({ hasText: "White at 9:00 PM was updated." });
    await expect(mine).toContainText("Schedule change");
    await expect(mine).toContainText("Urgent");
    // It comes before the board and the driver's own day, not below them.
    const top = (await mine.boundingBox())!.y;
    const board = (await phone.locator("main section[aria-live='off']").first().boundingBox())!.y;
    expect(top, "the alert sits above the pit board").toBeLessThan(board);
    // Still there after looking away and coming back.
    await go(phone, "/schedule");
    await go(phone, "/home");
    await expect(mine).toBeVisible();

    await mine.getByRole("button", { name: /^Got it/ }).click();
    await expect(mine).toHaveCount(0);
    expect(val(`select n.read_at is not null from notifications n join announcements a on a.id = n.announcement_id where n.user_id = '${driver.id}' and a.body like '%White at 9:00 PM was updated.%' order by n.created_at desc limit 1`), "the alert is marked read").toBe("t");
    // It has left the top of the screen for good; it is still in Announcements and Alerts, marked read.
    await go(phone, "/home");
    await expect(phone.getByRole("region", { name: "Urgent alerts" }).getByText("White at 9:00 PM was updated.")).toHaveCount(0);
  });

  test("a delayed session says what time it moved from, and a cancelled one is shown as cancelled rather than removed", async ({ page, asEmail }) => {
    const e = event();
    const item = myItem();
    test.skip(!item, "needs the session added earlier in this file");
    const driver = drivers("g.key = 'white' and r.attends_day1")[0];
    test.skip(!driver, "needs a White driver attending the first day");
    const day = weekday(e.start);

    // Ten minutes later from 8:55 PM. Only this file's session is that late.
    await go(page, `/admin/schedule?day=${e.start}`);
    await page.getByRole("button", { name: "Delay or advance" }).click();
    const form = sheet(page);
    await form.getByLabel("Starting from").fill("20:55");
    await form.getByLabel("Move by (minutes)").fill("10");
    await form.getByLabel("Direction").selectOption({ label: "Later" });
    await form.getByRole("button", { name: "Move the schedule" }).click();
    await expect(toast(page, /^1 items? moved 10 minutes later$/)).toBeVisible();
    expect(myItem()).toMatchObject({ start: item!.start + 10, movedFrom: item!.start });

    const phone = await asEmail(driver.email, { phone: true });
    await go(phone, "/home");
    const mine = myDayRows(phone, day).filter({ hasText: clock(item!.start + 10) }).filter({ hasText: "White" });
    await expect(mine).toContainText(`moved from ${clock(item!.start)}`);
    await go(phone, `/schedule?day=${e.start}`);
    await expect(phone.getByRole("region", { name: new RegExp(`^${day}`) }).getByRole("listitem").filter({ hasText: NOTE })).toContainText(`moved from ${clock(item!.start)}`);

    // Moving it back to where it started takes the note away again.
    await page.getByRole("button", { name: "Delay or advance" }).click();
    await form.getByLabel("Starting from").fill("20:55");
    await form.getByLabel("Move by (minutes)").fill("10");
    await form.getByLabel("Direction").selectOption({ label: "Earlier" });
    await form.getByRole("button", { name: "Move the schedule" }).click();
    await expect(toast(page, /^1 items? moved 10 minutes earlier$/)).toBeVisible();
    expect(myItem()).toMatchObject({ start: item!.start, movedFrom: null });

    // Cancelled: it stays in the driver's day, struck through and marked, instead of disappearing.
    await go(page, `/admin/schedule?day=${e.start}`);
    await editorRow(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editorRow(page).getByText("Cancelled", { exact: true })).toBeVisible();
    await go(phone, "/home");
    const off = myDayRows(phone, day).filter({ hasText: clock(item!.start) }).filter({ hasText: "White" });
    await expect(off.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(off).not.toContainText("moved from");
    await expect(phone.getByRole("region", { name: "Urgent alerts" })).toContainText(`Cancelled: White, ${clock(item!.start)}`);
    // "Mine only" on the schedule keeps it too.
    await go(phone, `/schedule?day=${e.start}&show=mine`);
    await expect(phone.getByRole("region", { name: new RegExp(`^${day}`) }).getByRole("listitem").filter({ hasText: NOTE }).getByText("Cancelled", { exact: true })).toBeVisible();
  });
});

// ───── importing registrations again

test.describe("importing the registration export again", () => {
  test("keeps a run group that was changed in the app, says so before importing, and can be told to use the file's instead", async ({ page }) => {
    const e = event();
    const driver = drivers("g.key = 'blue'")[0];
    test.skip(!driver, "needs a Blue driver");
    const group = () => val(`select g.name from registrations r join run_groups g on g.id = r.run_group_id where r.id = '${driver.regId}'`);
    const total = count(`select count(*) from registrations where event_id = '${e.id}' and status <> 'cancelled'`);
    const csv = (label: string) => ["First Name,Last Name,Email,Run Group,Status", `${driver.first},${driver.last},${driver.email},${label},Confirmed`].join("\r\n");

    await signIn(page, "marian");
    const preview = async (label: string) => {
      await go(page, "/admin/roster");
      await page.getByRole("button", { name: "Import" }).click();
      const panel = sheet(page);
      await panel.getByLabel("Export file (.csv or .xls)").setInputFiles({ name: "clubregistration-export.csv", mimeType: "text/csv", buffer: Buffer.from(csv(label)) });
      await expect(panel.getByText("clubregistration-export.csv")).toBeVisible();
      await panel.getByRole("button", { name: "Preview import" }).click();
      await expect(panel.getByText("1 row read, 1 ready to import")).toBeVisible();
      return panel;
    };

    // The export still says Green; the app has them in Blue (as after a promotion).
    let panel = await preview("Green - Novice");
    await expect(panel.getByText("1 person is in a different run group in the app")).toBeVisible();
    await expect(panel).toContainText(`${driver.name}: file says Green - Novice, app has Blue`);
    await expect(panel.getByRole("checkbox", { name: "Use the file's run group for them instead" })).not.toBeChecked();
    await panel.getByRole("button", { name: "Import 1 person" }).click();
    await expect(panel.getByText("Import finished")).toBeVisible();
    await expect(panel).toContainText("0 people added, 1 updated.");
    await expect(panel).toContainText("1 person kept the run group they have in the app.");
    expect(group(), "their run group after the import").toBe("Blue");
    expect(count(`select count(*) from registrations where event_id = '${e.id}' and status <> 'cancelled'`)).toBe(total);
    await panel.getByRole("button", { name: "Close" }).click();

    // When the file is the one that is right, the administrator can say so.
    panel = await preview("Green - Novice");
    await panel.getByRole("checkbox", { name: "Use the file's run group for them instead" }).check();
    await panel.getByRole("button", { name: "Import 1 person" }).click();
    await expect(panel.getByText("Import finished")).toBeVisible();
    await expect(panel).not.toContainText("kept the run group");
    expect(group()).toBe("Green");
    await panel.getByRole("button", { name: "Close" }).click();

    // Back to how it was. A file that agrees with the app raises nothing.
    panel = await preview("Blue");
    await panel.getByRole("checkbox", { name: "Use the file's run group for them instead" }).check();
    await panel.getByRole("button", { name: "Import 1 person" }).click();
    await expect(panel.getByText("Import finished")).toBeVisible();
    expect(group()).toBe("Blue");
    await panel.getByRole("button", { name: "Close" }).click();
    panel = await preview("Blue");
    await expect(panel.getByText(/different run group in the app/)).toHaveCount(0);
  });
});

// ───── sign-in codes and the delivery log

test.describe("the delivery log keeps sign-in codes and other regions out", () => {
  test("a sign-in code is in the email only: not in its subject, and not in the log administrators read", async ({ page, browser, problems }) => {
    // Someone no earlier test has asked a code for in the last hour, so the limits start from nothing.
    const who = drivers(`not exists (select 1 from otp_codes o where o.email = u.email and o.created_at > now() - interval '61 minutes')`, "u.last_name, u.first_name")[0];
    expect(who, "a driver who has not asked for a code in the last hour").toBeTruthy();
    await clearOfWindowEnd(15);
    await page.goto("/login");
    await page.getByLabel("Email").fill(who.email);
    await page.getByRole("button", { name: /Email me a code/ }).click();
    const notice = page.getByText(/Your code is/);
    await expect(notice).toBeVisible();
    const code = ((await notice.textContent()) ?? "").match(/\d{6}/)?.[0] ?? "";
    expect(code).toMatch(/^\d{6}$/);

    // The email is written to the log just after the page answers.
    const logged = () => sql(`select coalesce(subject, ''), body from message_log where kind = 'signin' and to_address = '${who.email}' order by created_at desc limit 1`)[0];
    await expect.poll(() => logged()?.[0], { message: "the subject of the sign-in email in the log" }).toBe("Your Track Day sign-in code");
    expect(logged()[1], "the body kept in the log").toBe("(contents withheld from the log)");
    expect(count(`select count(*) from message_log where kind = 'signin' and (subject ~ '[0-9]{6}' or body ~ '[0-9]{6}')`), "sign-in rows in the log that hold a six-digit code").toBe(0);

    // An administrator reading the delivery log sees that a code was sent to her, and not the code.
    const ctx = await openBrowser(browser, problems);
    const admin = await ctx.newPage();
    await signIn(admin, "marian");
    await go(admin, "/admin/announcements?tab=log");
    const row = admin.getByRole("main").getByRole("listitem").filter({ hasText: `to ${who.email}` }).first();
    await expect(row).toContainText("Your Track Day sign-in code");
    await expect(admin.getByRole("main")).not.toContainText(code);
    await ctx.close();
  });

  test("the delivery log lists this region's messages only", async ({ page }) => {
    // No screen can create a second region, so this one test writes rows straight into the sandbox's
    // database: a message to someone who is in no region here, and one tied to nobody. Both are removed afterwards.
    const stranger = `uat-other-region-${T}@example.com`;
    const ids = [`uat-log-a-${T}`, `uat-log-b-${T}`];
    sql(`insert into message_log (id, user_id, event_id, channel, to_address, subject, body, status, kind)
         values ('${ids[0]}', 'uat-nobody-${T}', null, 'email', '${stranger}', 'UAT ${T} another region', 'x', 'simulated', 'announcement'),
                ('${ids[1]}', null, null, 'email', '${stranger}', 'UAT ${T} tied to nobody', 'x', 'simulated', 'announcement')`);
    try {
      await signIn(page, "marian");
      await go(page, "/admin/announcements?tab=log");
      // The log is there and has this region's own messages in it.
      await expect(page.getByRole("main").getByRole("listitem").first()).toBeVisible();
      await expect(page.getByRole("main")).not.toContainText(stranger);
      await expect(page.getByRole("main")).not.toContainText(`UAT ${T} another region`);
      await expect(page.getByRole("main")).not.toContainText(`UAT ${T} tied to nobody`);
    } finally {
      sql(`delete from message_log where id in (${ids.map((i) => `'${i}'`).join(",")})`);
    }
  });
});

// ───── pairing clashes are judged from the schedule

// The rule itself, checked directly: it is a plain function of the schedule and who is paired with whom
// (src/lib/pairing.ts). The pairing page and "Pair the rest for me" both use it; 30-pairing-promotions
// checks what they show.
test.describe("an instructor's double bookings are worked out from the schedule", () => {
  const SAT = "2026-11-21";
  const SUN = "2026-11-22";
  let n = 0;
  const session = (day: string, startMin: number, title: string, groupIds: string[], more: { groupParts?: Record<string, "instructed" | "solo">; cancelled?: boolean } = {}) => ({
    id: `s${++n}`, day, startMin, endMin: startMin + 25, kind: "track", title, groupIds, groupParts: more.groupParts ?? {}, cancelled: more.cancelled ?? false,
  });
  const both = [SAT, SUN];
  const instructor: PairingPerson = { userId: "rosalind", groupId: "red", solo: true, days: both };
  const student = (name: string, groupId: string, need: PairedStudent["need"], more: Partial<PairedStudent> = {}): PairedStudent => ({ userId: name.toLowerCase(), name, groupId, solo: need === "ride_along" || need === "check_in", days: both, need, ...more });
  const owen = student("Owen", "green", "required");
  const simone = student("Simone", "blue", "instructed");
  // Saturday keeps the groups apart; Sunday ends with a combined Green and Blue session.
  const weekend = [
    session(SAT, 8 * 60, "Green", ["green"]),
    session(SAT, 9 * 60 + 45, "Blue", ["blue"]),
    session(SAT, 13 * 60 + 20, "Red", ["red"]),
    session(SUN, 10 * 60, "Green", ["green"]),
    session(SUN, 12 * 60 + 50, "Blue", ["blue"]),
    session(SUN, 14 * 60 + 45, "White", ["white"]),
    session(SUN, 15 * 60 + 10, "Green and Blue", ["green", "blue"]),
  ];
  const doubleBookings = (schedule: typeof weekend, students: PairedStudent[], who = instructor) => pairingClashes(schedule, who, students).filter(isDoubleBooking);

  test("two students in different run groups clash when one combined session puts them on track together", () => {
    const [clash, ...rest] = doubleBookings(weekend, [owen, simone]);
    expect(rest).toEqual([]);
    expect(clash.kind).toBe("together");
    expect(clash.sessions.map((s) => s.title)).toEqual(["Green and Blue"]);
    expect(clashText(clash)).toBe("Owen and Simone are on track at the same time: Sun 3:10 PM, Green and Blue.");
    expect(clashShort(clash)).toBe("clash Sun 3:10 PM");
    // Without that session there is nothing wrong with the pairing.
    expect(doubleBookings(weekend.filter((s) => s.title !== "Green and Blue"), [owen, simone])).toEqual([]);
    // Nor when it is cancelled, or when one of them is not there that day.
    expect(doubleBookings(weekend.map((s) => (s.title === "Green and Blue" ? { ...s, cancelled: true } : s)), [owen, simone])).toEqual([]);
    expect(doubleBookings(weekend, [owen, { ...simone, days: [SAT] }])).toEqual([]);
    expect(doubleBookings(weekend, [owen, simone], { ...instructor, days: [SAT] })).toEqual([]);
  });

  test("two students in one run group clash in every session, and before there is a schedule at all", () => {
    const tessa = student("Tessa", "green", "required");
    const [clash] = doubleBookings(weekend, [owen, tessa]);
    expect(clash.sameGroup).toBe(true);
    expect(clash.sessions).toHaveLength(3);
    expect(clashText(clash)).toBe("Owen and Tessa are in the same run group, so they are on track at the same time.");
    expect(clashShort(clash)).toBe("same group clash");
    expect(doubleBookings([], [owen, tessa]).map((c) => c.kind)).toEqual(["together"]);
    // Unless they come on different days.
    expect(doubleBookings(weekend, [{ ...owen, days: [SAT] }, { ...tessa, days: [SUN] }])).toEqual([]);
    expect(doubleBookings([], [{ ...owen, days: [SAT] }, { ...tessa, days: [SUN] }])).toEqual([]);
  });

  test("a split session keeps the two halves of a run group apart", () => {
    const split = [
      session(SAT, 12 * 60 + 45, "Green and Blue Instructed", ["green", "blue"], { groupParts: { blue: "instructed" } }),
      session(SAT, 13 * 60 + 15, "Blue Solo and White", ["blue", "white"], { groupParts: { blue: "solo" } }),
    ];
    const naomi = student("Naomi", "blue", "ride_along");
    // Simone (Blue Instructed) and Naomi (Blue Solo, a ride-along) are in one run group but never out together.
    expect(doubleBookings(split, [simone, naomi])).toEqual([]);
    // Owen (Green) and Simone are out together in the instructed session.
    expect(doubleBookings(split, [owen, simone]).map((c) => c.sessions.map((s) => s.title))).toEqual([["Green and Blue Instructed"]]);
  });

  test("a ride-along or check-in is a clash only when no session of theirs is left free", () => {
    const wendell = student("Wendell", "white", "check_in");
    const naomi = student("Naomi", "blue", "ride_along");
    // Wendell's White session is free, so pairing him with Owen and Simone's instructor adds nothing.
    expect(doubleBookings(weekend, [owen, simone, wendell]).map((c) => c.kind)).toEqual(["together"]);
    // Naomi is in Blue with Simone: Simone is out in every session Naomi has.
    const clashes = doubleBookings(weekend, [simone, naomi]);
    expect(clashes.map((c) => c.kind)).toEqual(["no_session"]);
    expect(clashText(clashes[0])).toBe("No session is free to ride with Naomi: this instructor's other students are on track in every one.");
    expect(clashShort(clashes[0])).toBe("no session free");
    // Two drivers who each need one session never block each other.
    expect(doubleBookings(weekend, [naomi, student("Victor", "blue", "ride_along")])).toEqual([]);
  });

  test("the instructor's own session is reported but is not a double booking", () => {
    const shared = [...weekend, session(SUN, 16 * 60, "Green and Red", ["green", "red"])];
    const all = pairingClashes(shared, instructor, [owen]);
    expect(all.map((c) => c.kind)).toEqual(["own"]);
    expect(clashText(all[0])).toBe("Owen is on track during this instructor's own session: Sun 4:00 PM, Green and Red.");
    expect(all.filter(isDoubleBooking)).toEqual([]);
    expect(clashesIfPaired(shared, instructor, [], owen)).toEqual([]);
  });

  test("pairing reports only the double bookings it would add", () => {
    const tessa = student("Tessa", "green", "required");
    // Owen and Simone already clash. Adding Wendell's check-in adds nothing; adding Tessa adds her clashes only.
    expect(clashesIfPaired(weekend, instructor, [owen, simone], student("Wendell", "white", "check_in"))).toEqual([]);
    const added = clashesIfPaired(weekend, instructor, [owen, simone], tessa);
    expect(added.map((c) => c.students.map((s) => s.name).join("+")).sort()).toEqual(["Owen+Tessa", "Simone+Tessa"]);
    // An instructor with nobody yet can take either student.
    expect(clashesIfPaired(weekend, instructor, [], simone)).toEqual([]);
    // Asking about someone they already have does not count them twice.
    expect(clashesIfPaired(weekend, instructor, [owen], owen)).toEqual([]);
  });
});
