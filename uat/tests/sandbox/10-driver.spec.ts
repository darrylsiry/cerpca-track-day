import type { Locator, Page } from "@playwright/test";
import { test, expect, signIn, sql, val, userId, tag, PEOPLE, ERROR_PAGE } from "./fixtures";

// Everything a driver does outside tech inspection (that is 12-driver-tech.spec.ts): the Now
// screen, asking for an instructor, the schedule, alerts, profile and car, waivers, the track
// guide, the phone layout, and what a driver is not allowed to reach.
//
// The people used here: Owen Gallagher (Green, first track day, fully cleared), Tessa Nakamura
// (Green, one waiver and her tech form still open) and Arjun Mehta (White, solo). An administrator
// is only signed in to look at what one of these three did.

// ───── helpers

/** The event the app puts in focus: the published one that has not finished yet. */
function currentEvent() {
  const [id, name, start, end] = sql(
    `select id, name, start_date, end_date from events
     where status = 'published' and end_date >= to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD')
     order by start_date limit 1`,
  )[0];
  return { id, name, start, end };
}

type Slot = { title: string; start: number; end: number; kind: string; audience: string; groups: string[]; cancelled: boolean };

/** One day of the schedule as it is stored, so the checks below hold even if a time was moved. */
function slots(eventId: string, day: string): Slot[] {
  return sql(
    `select title, start_min, end_min, kind, audience, group_ids::text, cancelled from schedule_items
     where event_id = '${eventId}' and day = '${day}' order by start_min, title`,
  ).map(([title, start, end, kind, audience, groups, cancelled]) => ({ title, start: Number(start), end: Number(end), kind, audience, groups: JSON.parse(groups), cancelled: cancelled === "t" }));
}
const groupId = (key: string) => val(`select id from run_groups where key = '${key}'`);
/** Is this item on a driver's own day: something for everyone, or for their run group. */
const isFor = (slot: Slot, group: string) => !slot.cancelled && (slot.audience === "all" || (slot.audience === "groups" && slot.groups.includes(group)));

// The app's own way of writing times and days, so a test can say what a user should read.
const clock = (min: number) => `${Math.floor(min / 60) % 12 === 0 ? 12 : Math.floor(min / 60) % 12}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;
const timeInput = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const fmt = (day: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(`${day}T12:00:00Z`));
const weekday = (day: string) => fmt(day, { weekday: "long" });
const dayLong = (day: string) => fmt(day, { weekday: "long", month: "long", day: "numeric" });

/** Demo mode lets anyone move the app's clock to a moment of the weekend, so no test depends on today's date. */
async function setClock(page: Page, day: string, minutes: number) {
  await page.getByRole("button", { name: "Set clock" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Day").selectOption({ label: weekday(day) });
  await sheet.getByLabel("Time").fill(timeInput(minutes));
  await sheet.getByRole("button", { name: "Set clock" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(`${weekday(day).slice(0, 3)} ${clock(minutes)}`)).toBeVisible();
  await expect(page.getByText("simulated")).toBeVisible();
}

/**
 * Only what is showing. The app keeps the screens a person just left in the page, hidden, so that
 * going back is instant; a lookup by text or label would otherwise also find those.
 */
const shown = (found: Locator) => found.filter({ visible: true });

/** A row of a "label: value" list (Your details, Signed by …), found by its label. */
const detail = (page: Page, label: string) => shown(page.locator(`dl > div:has(> dt:text-is("${label}"))`)).locator("dd");

/** Draw a signature in a signing box the way a finger or mouse would. */
async function drawSignature(page: Page, box: Locator) {
  await box.scrollIntoViewIfNeeded();
  const b = (await box.boundingBox())!;
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + 30, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 30 + i * 22, y + (i % 2 ? -22 : 18), { steps: 3 });
  await page.mouse.up();
}

/** Nothing on the page is wider than the phone's screen. */
const fitsTheScreen = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const unread = (who: keyof typeof PEOPLE) => Number(val(`select count(*) from notifications where user_id = '${userId(who)}' and read_at is null`));

// ───── the Now screen

test.describe("a driver's Now screen", () => {
  test("a Green driver is called to the grid before their session, and sees their day, checklist and instructor", async ({ page }) => {
    const ev = currentEvent();
    const green = groupId("green");
    const saturday = slots(ev.id, ev.start);
    const mine = saturday.filter((x) => isFor(x, green));
    // Owen's second time on track on Saturday; twelve minutes before it, he should be heading to the grid.
    const session = mine.filter((x) => x.kind === "track")[1];
    const at = session.start - 12;
    const onTrack = saturday.find((x) => x.kind === "track" && !x.cancelled && x.start <= at && at < x.end);
    const instructor = sql(
      `select u.first_name || ' ' || u.last_name, u.phone from instructor_assignments a join users u on u.id = a.instructor_id
       where a.event_id = '${ev.id}' and a.student_id = '${userId("owen")}'`,
    )[0];
    const sticker = val(`select sticker_number from tech_inspections where event_id = '${ev.id}' and user_id = '${userId("owen")}'`);

    await signIn(page, "owen");
    await setClock(page, ev.start, at);

    // The board: who has the track now, and who is next.
    if (onTrack) {
      await expect(page.getByText("On track now")).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: onTrack.title, exact: true })).toBeVisible();
      await expect(page.getByText("left in session")).toBeVisible();
    }
    // His own call: 15 minutes out, "your next" turns into a call to the grid with a countdown.
    const call = shown(page.locator("section").filter({ hasText: "Head to the grid" }));
    await expect(call).toContainText(session.title);
    await expect(call).toContainText(clock(session.start).replace(/ [AP]M$/, ""));
    await expect(call).toContainText("False grid");
    await expect(call).toContainText(/1[01]:\d\d\s*to go/i);

    // His whole Saturday, and nothing that belongs to another run group.
    const day = shown(page.locator("section").filter({ has: page.getByRole("heading", { name: `Your ${weekday(ev.start)}` }) }));
    await expect(day.getByRole("listitem")).toHaveCount(mine.length);
    for (const title of new Set(mine.map((x) => x.title))) await expect(day.getByText(title, { exact: true }).first()).toBeVisible();
    await expect(day).not.toContainText("White");
    await expect(day.getByRole("link", { name: /Full schedule/ })).toHaveAttribute("href", `/schedule?day=${ev.start}`);

    // Before you drive: Owen has signed everything and has his sticker.
    await expect(page.getByText("Cleared to drive")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Waivers\s*All 3 signed/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Shop inspection\s*Reviewed and approved/ })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`^Tech sticker\\s*Sticker ${sticker} is on your car`) })).toBeVisible();
    // Nothing is left for him to do, so there is no "to do" banner at the top.
    await expect(page.getByRole("link", { name: /^Before you drive/ })).toHaveCount(0);

    // His instructor, with a phone number he can tap.
    await expect(page.getByRole("heading", { name: "Your instructor" })).toBeVisible();
    await expect(shown(page.getByText(instructor[0], { exact: true }))).toBeVisible();
    await expect(page.getByText("Meet at the false grid ten minutes before each of your sessions.")).toBeVisible();
    await expect(page.getByRole("link", { name: instructor[1] })).toHaveAttribute("href", `tel:${instructor[1].replace(/[^\d+]/g, "")}`);
    // A Green driver always rides with an instructor, so there is nothing to ask for.
    await expect(page.getByRole("button", { name: "Ask for an instructor" })).toHaveCount(0);

    // The latest announcements, with a way to the full list.
    const latest = sql(`select title from notifications where user_id = '${userId("owen")}' and kind = 'announcement' and event_id = '${ev.id}' order by created_at desc limit 3`).map((r) => r[0]);
    for (const title of latest) await expect(shown(page.getByRole("listitem").filter({ hasText: title })).first()).toBeVisible();
    // An urgent one he has not read is also the first thing on the screen, above the board, until he taps "Got it".
    const urgent = sql(`select title from notifications where user_id = '${userId("owen")}' and event_id = '${ev.id}' and urgent and read_at is null and kind <> 'reminder' order by created_at desc limit 2`).map((r) => r[0]);
    const strip = page.getByRole("region", { name: "Urgent alerts" });
    for (const title of urgent) await expect(strip.getByText(title, { exact: true })).toBeVisible();
    if (urgent.length) {
      expect((await strip.boundingBox())!.y, "the urgent alerts sit above the board").toBeLessThan((await page.locator("main section[aria-live='off']").first().boundingBox())!.y);
      await expect(strip.getByRole("button", { name: /^Got it/ })).toHaveCount(urgent.length);
    } else await expect(strip).toHaveCount(0);
    await page.getByRole("link", { name: "All alerts" }).click();
    await expect(page).toHaveURL(/\/alerts$/);
  });

  test("while one of their sessions is running, the driver is shown where they should be", async ({ page }) => {
    const ev = currentEvent();
    const green = groupId("green");
    const mine = slots(ev.id, ev.start).filter((x) => isFor(x, green));
    const track = mine.filter((x) => x.kind === "track")[1];
    const classroom = mine.find((x) => x.kind === "classroom")!;

    await signIn(page, "owen");
    const you = shown(page.locator("section").filter({ has: page.getByText("You", { exact: true }) }));

    // Three minutes into his own track session: the board is his run group's, and he is on track.
    await setClock(page, ev.start, track.start + 3);
    await expect(page.getByText("On track now")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: track.title, exact: true })).toBeVisible();
    await expect(you).toContainText("You are on track");
    await expect(you).toContainText(`until ${clock(track.end)}`);
    await expect(you.getByText("Now", { exact: true })).toBeVisible();

    // During ground school: the classroom, where it is, and when it ends.
    await setClock(page, ev.start, classroom.start + 5);
    await expect(you).toContainText(classroom.title);
    await expect(you).toContainText(`Classroom · Student classroom · until ${clock(classroom.end)}`);
    await expect(you).not.toContainText("You are on track");
  });

  test("after the last session the board says the day is done, and the clock can go back to real time", async ({ page }) => {
    const ev = currentEvent();
    const sunday = slots(ev.id, ev.end).filter((x) => !x.cancelled);
    const lastEnd = Math.max(...sunday.map((x) => x.end));

    await signIn(page, "owen");
    await setClock(page, ev.end, lastEnd + 20);
    await expect(page.getByText("Day complete")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Track is cold" })).toBeVisible();
    await expect(page.getByText("Nothing more on your schedule today.")).toBeVisible();

    await page.getByRole("button", { name: "Real time" }).click();
    await expect(page.getByText("real time")).toBeVisible();
    await expect(shown(page.getByText("simulated"))).toHaveCount(0);
  });

  test("a driver with paperwork open is told what is left, first thing", async ({ page }) => {
    await signIn(page, "tessa");

    // The banner at the top names both jobs and goes to the first one.
    const banner = page.getByRole("link", { name: /^Before you drive/ });
    await expect(banner).toContainText("Sign 1 waiver");
    await expect(banner).toContainText("Sign and submit your tech form");

    // The checklist says the same, and she is not shown as cleared.
    await expect(page.getByRole("link", { name: /^Waivers\s*2 of 3 signed\. Sign the rest before you arrive\./ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Shop inspection\s*Shop signed, driver to submit/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Tech sticker\s*Issued at the tech shed/ })).toBeVisible();
    await expect(shown(page.getByText("Cleared to drive"))).toHaveCount(0);

    await banner.click();
    await expect(page).toHaveURL(/\/me\/waivers$/);
    await expect(page.getByRole("heading", { level: 1, name: "Waivers" })).toBeVisible();
    // Each line of the checklist opens the screen where that job is done.
    await page.goBack();
    await page.getByRole("link", { name: /^Shop inspection/ }).click();
    await expect(page).toHaveURL(/\/me\/tech$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tech inspection" })).toBeVisible();
  });
});

// ───── asking for an instructor

test.describe("instructor ride-along", () => {
  test("a solo driver asks for an instructor, the administrators are told, and the driver can take the request back", async ({ as }) => {
    const note = `Braking into Turn 1, please (${tag()})`;
    const admins = Number(val(`select count(*) from memberships where is_admin`));

    // Arjun drives solo in White, so he is offered a ride-along rather than shown an instructor.
    const arjun = await as("arjun");
    await expect(arjun.getByRole("heading", { name: "Instructor ride-along" })).toBeVisible();
    await expect(arjun.getByText(/You drive solo\s+in White\./)).toBeVisible();
    await arjun.getByRole("button", { name: "Ask for an instructor" }).click();
    const sheet = arjun.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Ask for an instructor" })).toBeVisible();
    await sheet.getByLabel("What would you like to work on?").fill(note);
    await sheet.getByRole("button", { name: "Send request" }).click();

    // The form closes and the card now shows the request waiting.
    await expect(sheet).toBeHidden();
    await expect(arjun.getByRole("heading", { name: "Your instructor" })).toBeVisible();
    await expect(arjun.getByText("You asked for an instructor to ride along. Not paired yet; you will get an alert when one is assigned.")).toBeVisible();
    await expect(arjun.getByRole("button", { name: "Ask for an instructor" })).toHaveCount(0);

    // Every administrator gets an alert (checked in the database), and one of them reads it.
    expect(Number(val(`select count(distinct user_id) from notifications where title = 'Arjun Mehta asked for an instructor' and body like '%${note}%'`))).toBe(admins);
    const hank = await as("hank");
    await hank.goto("/alerts");
    const alert = hank.getByRole("button", { name: /Arjun Mehta asked for an instructor/ }).filter({ hasText: note });
    await expect(alert).toContainText("White driver, ride-along request");
    await expect(alert).toContainText("Instructor pairing");
    // Opening the alert takes the administrator to the pairing screen, where Arjun is now on the list with his note.
    await alert.click();
    await expect(hank).toHaveURL(/\/admin\/instructors$/);
    const row = hank.getByRole("listitem").filter({ has: hank.getByRole("link", { name: "Arjun Mehta", exact: true }) });
    await expect(row).toContainText("Asked for a ride-along");
    await expect(row).toContainText(note);

    // Arjun changes his mind. Nobody was paired with him yet, so it is one tap.
    await arjun.getByRole("button", { name: "Withdraw request" }).click();
    await expect(arjun.getByText("Request withdrawn", { exact: true })).toBeVisible();
    await expect(arjun.getByRole("heading", { name: "Instructor ride-along" })).toBeVisible();
    await expect(arjun.getByRole("button", { name: "Ask for an instructor" })).toBeVisible();

    // He is off the administrators' list again.
    await hank.reload();
    await expect(hank.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(hank.getByRole("link", { name: "Arjun Mehta", exact: true })).toHaveCount(0);
  });

  test("sending the request is confirmed with a message", async ({ as }) => {
    const arjun = await as("arjun");
    await arjun.getByRole("button", { name: "Ask for an instructor" }).click();
    await arjun.getByRole("dialog").getByRole("button", { name: "Send request" }).click();
    await expect(arjun.getByText(/You asked for an instructor to ride along/)).toBeVisible();
    try {
      // Every other form in the app confirms with a short message at the bottom of the screen; this one should too.
      await expect(arjun.getByText("Request sent. You will get an alert when an instructor is assigned.")).toBeVisible({ timeout: 5_000 });
    } finally {
      // Leave Arjun as he was, whatever happened above.
      await arjun.getByRole("button", { name: "Withdraw request" }).click();
      await expect(arjun.getByRole("button", { name: "Ask for an instructor" })).toBeVisible();
    }
  });
});

// ───── schedule

test.describe("the schedule", () => {
  test("both days are shown with the driver's own sessions marked, and the filters narrow the list", async ({ page }) => {
    const ev = currentEvent();
    const green = groupId("green");
    const white = groupId("white");
    const days = [ev.start, ev.end].map((day) => ({ day, all: slots(ev.id, day) }));

    await signIn(page, "owen");
    await page.goto("/schedule");
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
    await expect(shown(page.getByText(ev.name)).first()).toBeVisible();

    const region = (day: string) => page.getByRole("region", { name: dayLong(day) });
    const show = page.getByRole("group", { name: "Show" });

    // Everyone: every item of both days, side by side, with "You" on Owen's own.
    await expect(show.getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "true");
    for (const { day, all } of days) {
      await expect(region(day).getByRole("heading", { name: weekday(day) })).toBeVisible();
      await expect(region(day).getByRole("listitem")).toHaveCount(all.length);
      await expect(region(day).getByText("You", { exact: true })).toHaveCount(all.filter((x) => isFor(x, green)).length);
    }
    // A White session is not his; a Green one is.
    const whiteRow = region(ev.start).getByRole("listitem").filter({ has: page.getByText("White", { exact: true }) }).first();
    await expect(whiteRow).toContainText("Track session");
    await expect(whiteRow.getByText("You", { exact: true })).toHaveCount(0);
    const greenRow = region(ev.start).getByRole("listitem").filter({ has: page.getByText("Green", { exact: true }) }).first();
    await expect(greenRow.getByText("You", { exact: true })).toBeVisible();
    await expect(greenRow).toContainText("Track session");

    // Mine only: just his items, each marked.
    await show.getByRole("button", { name: "Mine only" }).click();
    for (const { day, all } of days) {
      const mine = all.filter((x) => isFor(x, green));
      await expect(region(day).getByRole("listitem")).toHaveCount(mine.length);
      await expect(region(day).getByText("You", { exact: true })).toHaveCount(mine.length);
    }
    await expect(page).toHaveURL(/show=mine/);

    // Another run group: that group's sessions plus what is for everyone.
    await show.getByRole("button", { name: "White", exact: true }).click();
    for (const { day, all } of days) {
      await expect(region(day).getByRole("listitem")).toHaveCount(all.filter((x) => x.audience === "all" || x.groups.includes(white)).length);
    }
    await expect(region(ev.start).getByText("Green ground school")).toHaveCount(0);

    // Classroom: only classroom sessions.
    await show.getByRole("button", { name: "Classroom" }).click();
    for (const { day, all } of days) {
      const rows = region(day).getByRole("listitem");
      await expect(rows).toHaveCount(all.filter((x) => x.kind === "classroom").length);
      for (const row of await rows.all()) await expect(row).toContainText("Classroom");
    }
    // The choice is kept in the address, so a reload (or a shared link) shows the same view.
    await expect(page).toHaveURL(/show=classroom/);
    await page.reload();
    await expect(page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Classroom" })).toHaveAttribute("aria-pressed", "true");
    await expect(region(ev.start).getByRole("listitem")).toHaveCount(days[0].all.filter((x) => x.kind === "classroom").length);

    await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Everyone" }).click();
    await expect(region(ev.start).getByRole("listitem")).toHaveCount(days[0].all.length);
  });

  test("on the day, the schedule shows what is on track now, what is next and the driver's own next session", async ({ page }) => {
    const ev = currentEvent();
    const green = groupId("green");
    const saturday = slots(ev.id, ev.start);
    const session = saturday.filter((x) => isFor(x, green) && x.kind === "track")[1];
    const at = session.start - 12;
    const onTrack = saturday.find((x) => x.kind === "track" && !x.cancelled && x.start <= at && at < x.end);
    const nextTrack = saturday.find((x) => x.kind === "track" && !x.cancelled && x.start > at)!;

    await signIn(page, "owen");
    await setClock(page, ev.start, at);
    await page.goto("/schedule");

    const now = page.getByRole("region", { name: "Right now" });
    if (onTrack) {
      await expect(now).toContainText("On track now");
      await expect(now).toContainText(onTrack.title);
    }
    await expect(now).toContainText("Next on track");
    await expect(now).toContainText(nextTrack.title);
    await expect(now).toContainText("Your next");
    await expect(now).toContainText(`${clock(session.start)} · in`);

    // Saturday is marked as today, and the session running now is marked in the list.
    const today = page.getByRole("region", { name: dayLong(ev.start) });
    await expect(today.getByText("Today", { exact: true })).toBeVisible();
    const running = today.getByRole("listitem").filter({ has: page.getByText("Now", { exact: true }) });
    if (onTrack) await expect(running.filter({ hasText: "Track session" })).toContainText(onTrack.title);
    await expect(page.getByRole("region", { name: dayLong(ev.end) }).getByText("Today", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Jump to now" }).click();
    if (onTrack) await expect(running.first()).toBeInViewport();
  });
});

// ───── alerts

test.describe("alerts", () => {
  test("a driver sees how many alerts are unread, opens one, and marks the rest read", async ({ page }) => {
    const before = unread("owen");
    expect(before, "Owen starts with unread alerts").toBeGreaterThanOrEqual(2);
    const plural = (n: number) => `${n} unread alert${n === 1 ? "" : "s"}.`;

    await signIn(page, "owen");
    const nav = page.getByRole("navigation", { name: "Main" });
    // The count is on the Alerts link from every screen.
    await expect(nav.getByRole("link", { name: /^Alerts/ })).toHaveText(new RegExp(`Alerts\\s*${before}$`));
    await nav.getByRole("link", { name: /^Alerts/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
    await expect(page.getByText(plural(before))).toBeVisible();
    await expect(shown(page.getByLabel("Unread"))).toHaveCount(before);

    // An urgent one stands out, and each says what kind of alert it is.
    const urgent = page.getByRole("button", { name: /Oil-dry at Turn 5 exit/ });
    await expect(urgent).toContainText("Urgent");
    await expect(urgent).toContainText("Announcement");
    await expect(urgent).toContainText("stay off the powder");

    // Opening one marks just that one read.
    const walk = page.getByRole("listitem").filter({ hasText: "Green drivers: track walk at lunch" });
    await expect(walk.getByLabel("Unread")).toBeVisible();
    await walk.getByRole("button").click();
    await expect(walk.getByLabel("Unread")).toHaveCount(0);
    await expect(page.getByText(plural(before - 1))).toBeVisible();
    await expect(nav.getByRole("link", { name: /^Alerts/ })).toHaveText(new RegExp(`Alerts\\s*${before - 1}$`));
    await expect(urgent.getByLabel("Unread")).toBeVisible();

    // The tabs split announcements from reminders.
    const tabs = page.getByRole("navigation", { name: "Filter alerts" });
    await tabs.getByRole("link", { name: "Announcements" }).click();
    await expect(page).toHaveURL(/tab=announcements/);
    await expect(shown(page.getByText("Oil-dry at Turn 5 exit"))).toBeVisible();
    await tabs.getByRole("link", { name: "Reminders" }).click();
    await expect(page).toHaveURL(/tab=reminders/);
    await expect(shown(page.getByText("Oil-dry at Turn 5 exit"))).toHaveCount(0);
    if (val(`select count(*) from notifications where user_id = '${userId("owen")}' and kind in ('reminder', 'schedule')`) === "0") {
      await expect(page.getByText("No reminders yet")).toBeVisible();
      await expect(page.getByText(/Reminders arrive 15, 10 and 5 minutes before your run group goes on track/)).toBeVisible();
    }
    await tabs.getByRole("link", { name: "All", exact: true }).click();

    // Mark all read clears the count everywhere, and stays cleared.
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.getByText("All alerts marked read")).toBeVisible();
    await expect(page.getByText(/^You are all caught up\./)).toBeVisible();
    await expect(shown(page.getByLabel("Unread"))).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /^Alerts/ })).toHaveText("Alerts");
    await page.reload();
    await expect(page.getByText(/^You are all caught up\./)).toBeVisible();
    // The alerts themselves are still there to read again.
    await expect(page.getByText("Green drivers: track walk at lunch")).toBeVisible();
    // And the Now screen no longer flags them as unread.
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Announcements" })).toBeVisible();
    await expect(shown(page.getByLabel("Unread"))).toHaveCount(0);
  });

  test("the alerts screen explains how alerts arrive", async ({ page }) => {
    await signIn(page, "owen");
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { name: "How alerts reach you" })).toBeVisible();
    await expect(page.getByText("Everything is always listed here. Email, text and push are extra, and you choose which ones you want.")).toBeVisible();
    // No push service is connected in the sandbox, and the screen says so instead of offering a dead switch.
    await expect(page.getByText("Notifications on this device")).toBeVisible();
    await expect(page.getByText("Not set up on this server")).toBeVisible();
    await expect(page.getByRole("button", { name: "Turn on notifications" })).toHaveCount(0);
  });

  test("the Notification settings link opens the profile at the notification choices", async ({ page }) => {
    await signIn(page, "owen");
    await page.goto("/alerts");
    await page.getByRole("link", { name: "Notification settings" }).click();
    await expect(page).toHaveURL(/\/me#notifications$/);
    await expect(page.getByRole("heading", { name: "How we reach you" })).toBeVisible();
    // The link points at that section, so the driver should land on it, not at the top of a long profile.
    await expect(page.getByRole("heading", { name: "How we reach you" })).toBeInViewport({ timeout: 5_000 });
  });
});

// ───── profile and car

test.describe("profile and car", () => {
  test("a driver sees their own profile: who they are, their run group, paperwork and history", async ({ page }) => {
    const ev = currentEvent();
    await signIn(page, "owen");
    await page.goto("/me");
    await expect(page.getByRole("heading", { level: 1, name: "Profile and car" })).toBeVisible();
    await expect(shown(page.getByText(PEOPLE.owen.email)).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: `Paperwork for ${ev.name}` })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Waivers\s*All 3 signed/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Tech inspection\s*Approved · sticker/ })).toBeVisible();
    // His run group and what it means for him.
    await expect(page.getByRole("heading", { name: "Your run group" })).toBeVisible();
    await expect(detail(page, "Driving")).toHaveText("Instructed: an instructor rides with you every session.");
    await expect(detail(page, "Experience")).toHaveText("First track day");
    // This event is in his history.
    const history = page.getByRole("listitem").filter({ hasText: ev.name }).filter({ hasText: "This event" });
    await expect(history).toBeVisible();
    // The link to his passing zones opens his own group's sheet.
    await page.getByRole("link", { name: /Your passing zones/ }).click();
    await expect(page).toHaveURL(/\/track\/passing$/);
    await expect(shown(page.getByText("Your run group", { exact: true }))).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Run group sheets" }).getByRole("link", { name: "Green and Blue" })).toHaveAttribute("aria-current", "page");
  });

  test("a returning driver's profile keeps their instructor's feedback, their promotion and their past events", async ({ page }) => {
    await signIn(page, "arjun");
    await page.goto("/me");
    await expect(detail(page, "Driving")).toHaveText("Solo. You can ask for an instructor to ride along from the Now screen.");
    // What his instructor wrote for him at the spring event, with the things to work on.
    await expect(page.getByRole("heading", { name: "Feedback from your instructors" })).toBeVisible();
    const note = page.getByRole("listitem").filter({ hasText: "Solo-quality driving all morning." });
    await expect(note).toContainText("Spring Driver Education · Gus Lindqvist");
    await expect(note).toContainText("Traffic");
    await expect(note).toContainText("Consistency");
    // His move from Blue to White, and who recommended it.
    await expect(page.getByRole("heading", { name: "Promotions" })).toBeVisible();
    const promotion = page.getByRole("listitem").filter({ hasText: "recommended by Gus Lindqvist" });
    await expect(promotion).toContainText("Blue");
    await expect(promotion).toContainText("White");
    await expect(promotion).toContainText("approved");
    // Every event he has been registered for, with the run group he was in at each.
    await expect(page.getByRole("heading", { name: "Events with CERPCA" })).toBeVisible();
    const been = sql(
      `select e.name, e.start_date, g.name from registrations r join events e on e.id = r.event_id join run_groups g on g.id = r.run_group_id
       where r.user_id = '${userId("arjun")}' and r.status <> 'cancelled' order by e.start_date`,
    );
    expect(been.length, "Arjun has past events as well as this one").toBeGreaterThan(1);
    const year = (day: string) => day.slice(0, 4);
    for (const [name, start, group] of been) {
      await expect(page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) }).filter({ hasText: `, ${year(start)} · Roebling Road` })).toContainText(group);
    }
    await expect(page.getByRole("listitem").filter({ hasText: "This event" })).toContainText("White");
  });

  test("a driver edits their contact details, and a mistake is explained without losing what was typed", async ({ page }) => {
    const t = tag();
    await signIn(page, "owen");
    await page.goto("/me");
    await page.getByRole("button", { name: "Edit your details" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Your details" })).toBeVisible();
    // The sign-in address is shown but cannot be edited here.
    await expect(sheet.getByLabel(/^Email/)).toHaveValue(PEOPLE.owen.email);
    await expect(sheet.getByLabel(/^Email/)).not.toBeEditable();

    // A phone number without an area code is refused...
    await sheet.getByLabel("Mobile phone").fill("555-01");
    await sheet.getByLabel("Street address").fill(`${t} Marsh Harbor Ln`);
    await sheet.getByLabel("City", { exact: true }).fill("Thunderbolt");
    await sheet.getByLabel("State", { exact: true }).fill("GA");
    await sheet.getByLabel("ZIP", { exact: true }).fill("31404");
    await sheet.getByLabel("Emergency contact", { exact: true }).fill(`Riley Gallagher ${t}`);
    await sheet.getByLabel("Their phone").fill("(912) 555-0199");
    await sheet.getByLabel("T-shirt size").selectOption("XL");
    await sheet.getByLabel("PCA member number").fill("2020123456");
    await sheet.getByRole("button", { name: "Save details" }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Enter a phone number with its area code.");
    // ...and everything else he typed is still in the form.
    await expect(sheet.getByLabel("Mobile phone")).toHaveValue("555-01");
    await expect(sheet.getByLabel("Street address")).toHaveValue(`${t} Marsh Harbor Ln`);
    await expect(sheet.getByLabel("City", { exact: true })).toHaveValue("Thunderbolt");
    await expect(sheet.getByLabel("Emergency contact", { exact: true })).toHaveValue(`Riley Gallagher ${t}`);
    await expect(sheet.getByLabel("T-shirt size")).toHaveValue("XL");

    // With a full number it saves, and the profile shows the new details.
    await sheet.getByLabel("Mobile phone").fill("(912) 555-0142");
    await sheet.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Details saved", { exact: true })).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(detail(page, "Mobile phone")).toHaveText("(912) 555-0142");
    await expect(detail(page, "Address")).toHaveText(`${t} Marsh Harbor Ln · Thunderbolt, GA · 31404`);
    await expect(detail(page, "Emergency contact")).toHaveText(`Riley Gallagher ${t} · (912) 555-0199`);
    await expect(detail(page, "T-shirt size")).toHaveText("XL");
    await expect(detail(page, "PCA member no.")).toHaveText("2020123456");
    // Still there after a reload, and the edit form opens with the saved values.
    await page.reload();
    await expect(detail(page, "Emergency contact")).toHaveText(`Riley Gallagher ${t} · (912) 555-0199`);
    await page.getByRole("button", { name: "Edit your details" }).click();
    await expect(page.getByRole("dialog").getByLabel("Street address")).toHaveValue(`${t} Marsh Harbor Ln`);
  });

  test("a driver edits their car; a number another driver already has is refused and nothing typed is lost", async ({ page, as }) => {
    const ev = currentEvent();
    const original = val(`select car_number from registrations where event_id = '${ev.id}' and user_id = '${userId("owen")}'`);
    const taken = val(`select car_number from registrations where event_id = '${ev.id}' and user_id = '${userId("arjun")}'`);

    await signIn(page, "owen");
    await page.goto("/me");
    await page.getByRole("button", { name: "Edit your car" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("This is the car on the roster and on your tech inspection for this event.")).toBeVisible();
    await expect(sheet.getByLabel("Car number")).toHaveValue(original);

    // Arjun's number is already in use at this event.
    await sheet.getByLabel("Color").fill("Gentian Blue Metallic");
    await sheet.getByLabel("Car number").fill(taken);
    await sheet.getByRole("button", { name: "Save car" }).click();
    await expect(sheet.getByRole("alert")).toHaveText(`Car number ${taken} is already taken at this event. Choose another, or ask the registrar to sort it out.`);
    await expect(sheet.getByLabel("Color")).toHaveValue("Gentian Blue Metallic");
    await expect(sheet.getByLabel("Car number")).toHaveValue(taken);

    // A year that cannot be right is refused too.
    await sheet.getByLabel("Year").fill("1800");
    await sheet.getByLabel("Car number").fill("31x");
    await sheet.getByRole("button", { name: "Save car" }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Enter the model year as four digits.");
    await expect(sheet.getByLabel("Model")).toHaveValue("718 Cayman");

    // A free number saves (letters are stored in capitals), and it shows on his profile and his wristband.
    await sheet.getByLabel("Year").fill("2023");
    await sheet.getByRole("button", { name: "Save car" }).click();
    await expect(page.getByText("Car saved", { exact: true })).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("2023 Porsche 718 Cayman", { exact: true })).toBeVisible();
    await expect(page.getByText("Gentian Blue Metallic", { exact: true })).toBeVisible();
    await expect(shown(page.getByLabel("Car number 31X")).first()).toBeVisible();
    await expect(shown(page.getByLabel(`Car number ${original}`))).toHaveCount(0);

    // The roster the administrators work from follows the profile.
    const hank = await as("hank");
    await hank.goto(`/admin/roster/${userId("owen")}`);
    await expect(hank.getByRole("heading", { level: 1 })).toContainText("Owen Gallagher");
    await expect(shown(hank.getByLabel("Car number 31X")).first()).toBeVisible();

    // Put the original number back, so the numbers on his car match his tech sticker again.
    await page.getByRole("button", { name: "Edit your car" }).click();
    await page.getByRole("dialog").getByLabel("Car number").fill(original);
    await page.getByRole("dialog").getByRole("button", { name: "Save car" }).click();
    await expect(page.getByText("Car saved", { exact: true }).last()).toBeVisible();
    await expect(shown(page.getByLabel(`Car number ${original}`)).first()).toBeVisible();
  });

  test("a driver chooses how they are reached, and text alerts need a phone number", async ({ page }) => {
    await signIn(page, "owen");
    await page.goto("/me");
    const email = page.getByRole("switch", { name: "Email" });
    const text = page.getByRole("switch", { name: "Text message" });
    const push = page.getByRole("switch", { name: "Push notification" });
    await expect(email).toHaveAttribute("aria-checked", "true");
    await expect(text).toHaveAttribute("aria-checked", "false");
    await expect(push).toHaveAttribute("aria-checked", "true");

    // Each switch saves as soon as it is flipped.
    await text.click();
    await expect(text).toHaveAttribute("aria-checked", "true");
    await email.click();
    await expect(email).toHaveAttribute("aria-checked", "false");
    await push.click();
    await expect(push).toHaveAttribute("aria-checked", "false");
    await expect(push).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("switch", { name: "Text message" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Email" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("switch", { name: "Push notification" })).toHaveAttribute("aria-checked", "false");

    // Taking the phone number off the profile turns text alerts off, and says why.
    const phone = (await detail(page, "Mobile phone").innerText()).trim();
    await page.getByRole("button", { name: "Edit your details" }).click();
    await page.getByRole("dialog").getByLabel("Mobile phone").fill("");
    await page.getByRole("dialog").getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Details saved", { exact: true })).toBeVisible();
    await expect(page.getByText("Add a mobile number to your details to get texts.")).toBeVisible();
    await expect(text).toBeDisabled();
    await expect(text).toHaveAttribute("aria-checked", "false");

    // With the number back, texts can be switched on again; leave email and push on as they were.
    await page.getByRole("button", { name: "Edit your details" }).click();
    await page.getByRole("dialog").getByLabel("Mobile phone").fill(phone);
    await page.getByRole("dialog").getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText(`Urgent announcements and session reminders, to ${phone}.`)).toBeVisible();
    await expect(text).toBeEnabled();
    await expect(text).toHaveAttribute("aria-checked", "false");
    await email.click();
    await expect(email).toHaveAttribute("aria-checked", "true");
    await push.click();
    await expect(push).toHaveAttribute("aria-checked", "true");
  });
});

// ───── waivers

test.describe("waivers", () => {
  test("a refused attempt to sign keeps the signature that was drawn", async ({ page }) => {
    await signIn(page, "tessa");
    await page.goto("/me/waivers");
    await page.getByRole("link", { name: /Needs your signature/ }).first().click();
    const name = page.getByLabel("Full legal name");
    const sign = page.getByRole("button", { name: "Sign this waiver" });
    const refusal = page.getByRole("main").getByRole("alert");
    await page.getByLabel("I have read and understand this document").check();
    await drawSignature(page, page.getByRole("img", { name: "Sign here" }));

    // A first name alone is not a legal name, so this is refused. Nothing is signed in this test.
    await name.fill("Tessa");
    await sign.click();
    await expect(refusal).toHaveText("Type your full legal name, first and last.");
    await expect(name).toHaveValue("Tessa");
    await expect(page.getByLabel("I have read and understand this document")).toBeChecked();
    await expect(page.getByRole("button", { name: "Clear" })).toBeEnabled();

    // Her signature is still showing in the box, so trying again must not claim it is missing:
    // the only thing wrong is still the name.
    await name.fill("Nakamura");
    await sign.click();
    await expect(sign).toBeEnabled();
    await expect(refusal).not.toHaveText("Draw your signature in the box.", { timeout: 5_000 });
    await expect(refusal).toHaveText("Type your full legal name, first and last.");
  });

  test("a driver reads what they have already signed, signs the one that is open, and is shown as done everywhere", async ({ as }) => {
    const ev = currentEvent();
    const open = "Roebling Road Raceway track waiver";
    const signed = "PCA Release and Waiver of Liability";

    // Before: the administrators' list of people with unsigned waivers includes Tessa.
    const hank = await as("hank");
    await hank.goto("/admin/waivers?show=unsigned");
    await expect(shown(hank.getByText("Tessa Nakamura")).first()).toBeVisible();

    const tessa = await as("tessa");
    await tessa.goto("/me/waivers");
    await expect(tessa.getByText("2/3")).toBeVisible();
    await expect(tessa.getByText("Required waivers signed")).toBeVisible();
    await expect(tessa.getByRole("link", { name: new RegExp(`${open}.*Needs your signature`) })).toBeVisible();
    await expect(tessa.getByRole("link", { name: /Signed on / })).toHaveCount(2);

    // A waiver she has signed: the wording, her signature, and a button on to the one still open.
    await tessa.getByRole("link", { name: new RegExp(signed) }).click();
    await expect(tessa.getByRole("heading", { level: 1, name: signed })).toBeVisible();
    await expect(shown(tessa.getByText(`Signed for ${ev.name}`))).toBeVisible();
    await expect(tessa.getByText(/I acknowledge that I have read the Porsche Club of America Release and Waiver of Liability/)).toBeVisible();
    await expect(tessa.getByRole("img", { name: "Signature of Tessa Nakamura" })).toBeVisible();
    await expect(detail(tessa, "Signed by")).toHaveText("Tessa Nakamura");
    await expect(tessa.getByRole("button", { name: "Sign this waiver" })).toHaveCount(0);
    await tessa.getByRole("link", { name: `Next: ${open}` }).click();

    // The open one: read it, then try to sign without doing each part.
    await expect(tessa.getByRole("heading", { level: 1, name: open })).toBeVisible();
    await expect(tessa.getByText(/I acknowledge that I have read and agree to the Roebling Road Raceway release and waiver/)).toBeVisible();
    await expect(shown(tessa.getByText("Version 1"))).toHaveCount(1);
    const name = tessa.getByLabel("Full legal name");
    await expect(name).toHaveValue("Tessa Nakamura");
    const sign = tessa.getByRole("button", { name: "Sign this waiver" });
    const refusal = tessa.getByRole("main").getByRole("alert");
    await sign.click();
    await expect(refusal).toHaveText("Tick the box to confirm you have read and understand the document.");
    await tessa.getByLabel("I have read and understand this document").check();
    await sign.click();
    await expect(refusal).toHaveText("Draw your signature in the box.");
    // The signing box can be cleared and drawn again.
    const box = tessa.getByRole("img", { name: "Sign here" });
    await expect(tessa.getByRole("button", { name: "Clear" })).toBeDisabled();
    await drawSignature(tessa, box);
    await tessa.getByRole("button", { name: "Clear" }).click();
    await expect(tessa.getByRole("button", { name: "Clear" })).toBeDisabled();
    await sign.click();
    await expect(refusal).toHaveText("Draw your signature in the box.");

    // Signed properly: the page turns into the record of her signature.
    await drawSignature(tessa, box);
    await sign.click();
    await expect(tessa.getByText("Waiver signed", { exact: true })).toBeVisible();
    await expect(shown(tessa.getByText(`Signed for ${ev.name}`))).toBeVisible();
    await expect(tessa.getByRole("img", { name: "Signature of Tessa Nakamura" })).toBeVisible();
    await expect(detail(tessa, "Signed by")).toHaveText("Tessa Nakamura");
    await expect(detail(tessa, "Document")).toHaveText("Version 1");
    await expect(detail(tessa, "For")).toHaveText(ev.name);
    await expect(sign).toHaveCount(0);

    // Back on the list everything is signed...
    await tessa.getByRole("link", { name: "Back to waivers" }).click();
    await expect(shown(tessa.getByText("3/3"))).toBeVisible();
    await expect(tessa.getByText("All required waivers are signed")).toBeVisible();
    await expect(tessa.getByText("Nothing more to do here.")).toBeVisible();
    await expect(shown(tessa.getByText("Needs your signature"))).toHaveCount(0);
    await expect(tessa.getByRole("link", { name: /Signed on / })).toHaveCount(3);

    // ...the Now screen stops asking for waivers (the tech form is still hers to do)...
    await tessa.goto("/home");
    await expect(tessa.getByRole("link", { name: /^Waivers\s*All 3 signed/ })).toBeVisible();
    const banner = tessa.getByRole("link", { name: /^Before you drive/ });
    await expect(banner).toContainText("tech form");
    await expect(banner).not.toContainText("waiver");
    // ...her profile agrees...
    await tessa.goto("/me");
    await expect(tessa.getByRole("link", { name: /^Waivers\s*All 3 signed/ })).toBeVisible();

    // ...and she is off the administrators' unsigned list.
    await hank.reload();
    await expect(hank.getByRole("heading", { level: 1, name: "Waivers" })).toBeVisible();
    await expect(shown(hank.getByText("Tessa Nakamura"))).toHaveCount(0);

    // What a user cannot see: the signature is stored with the document version and a fingerprint of the wording.
    const [version, hash, image] = sql(
      `select s.template_version, s.body_hash, left(s.signature_data, 22) from waiver_signatures s join waiver_templates t on t.id = s.template_id
       where s.user_id = '${userId("tessa")}' and s.event_id = '${ev.id}' and t.title = '${open}'`,
    )[0];
    expect(version).toBe("1");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(image).toBe("data:image/png;base64,");
  });

  test("a waiver address that does not exist says so and leads back to the list", async ({ page }) => {
    await signIn(page, "owen");
    await page.goto("/me/waivers/no-such-document");
    await expect(page.getByText("That document is no longer in use")).toBeVisible();
    await page.getByRole("link", { name: "Back to waivers" }).click();
    await expect(page).toHaveURL(/\/me\/waivers$/);
    // Owen signed everything before the event.
    await expect(page.getByText("3/3")).toBeVisible();
  });
});

// ───── track guide

/** Fetch a document the way the browser would with this person's session, and check it really is a PDF. */
async function expectRealPdf(page: Page, href: string) {
  const res = await page.context().request.get(href);
  expect(res.status(), `${href} opens`).toBe(200);
  expect(res.headers()["content-type"], `${href} is served as a PDF`).toContain("application/pdf");
  const body = await res.body();
  expect(body.subarray(0, 5).toString("latin1"), `${href} starts like a PDF`).toBe("%PDF-");
  expect(body.length, `${href} is not an empty file`).toBeGreaterThan(10_000);
  expect(body.subarray(-1024).toString("latin1"), `${href} is a complete PDF`).toContain("%%EOF");
}

test.describe("the track guide", () => {
  test("the overview shows the circuit and the facts, and leads to every section", async ({ page }) => {
    await signIn(page, "owen");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Track guide" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Roebling Road" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Map of Roebling Road Raceway with numbered turns" })).toBeVisible();
    for (const fact of ["2.02 mi", "Clockwise", "40 mph", "5 mph"]) await expect(page.getByText(fact, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get directions" })).toHaveAttribute("href", /google\.com\/maps.*Roebling/);

    // Each card in "In this guide" opens its section; the passing card names Owen's own run group.
    const sections: [RegExp, string, string][] = [
      [/^Turn by turn\s*All 9 turns/, "/track/turns", "Turn by turn"],
      [/^Passing zones\s*Green: 3 passing zones/, "/track/passing", "Passing zones"],
      [/^Flags\s*10 flags/, "/track/flags", "Flags"],
      [/^Track rules\s*30 rules from the track, in 6 sections/, "/track/rules", "Track rules"],
      [/^Maps\s*2 maps of the grounds/, "/track/maps", "Maps"],
      [/^Documents and glossary\s*8 documents/, "/track/docs", "Documents"],
    ];
    for (const [card, path, heading] of sections) {
      await page.goto("/track");
      await page.getByRole("link", { name: card }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.locator("body")).not.toContainText(ERROR_PAGE);
    }
    // The tabs across the top do the same from inside any section.
    const tabs = page.getByRole("navigation", { name: "Track guide sections" });
    await expect(tabs.getByRole("link", { name: "Documents" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/\/track$/);

    // Tapping a turn number on the map opens that turn.
    await page.getByRole("button", { name: "Turn 5", exact: true }).click();
    await expect(page).toHaveURL(/\/track\/turns\?turn=5$/);
    await expect(page.getByRole("button", { name: "Turn 5", exact: true }).last()).toHaveAttribute("aria-pressed", "true");
  });

  test("turn by turn: each turn can be picked from the numbers, the map, the arrows or the keyboard", async ({ page }) => {
    await signIn(page, "owen");
    await page.goto("/track/turns");
    const picker = page.getByRole("group", { name: "Choose a turn" });
    const map = page.getByRole("img", { name: /^Map of Roebling Road Raceway/ });
    // It opens on Turn 1.
    await expect(picker.getByRole("button", { name: "Turn 1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(map).toHaveAccessibleName(/Turn 1 is highlighted/);
    await expect(page.getByRole("heading", { name: "Through the corner" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "In full" })).toBeVisible();

    // From the numbers.
    await picker.getByRole("button", { name: "Turn 4", exact: true }).click();
    await expect(page).toHaveURL(/turn=4$/);
    await expect(map).toHaveAccessibleName(/Turn 4 is highlighted/);
    await expect(page.getByRole("img", { name: "Turn 4: the student line, illustrated" })).toBeVisible();
    // From the map.
    await map.getByRole("button", { name: "Turn 7", exact: true }).click();
    await expect(picker.getByRole("button", { name: "Turn 7", exact: true })).toHaveAttribute("aria-pressed", "true");
    // With the next and previous buttons under the turn.
    await page.getByRole("button", { name: "Turn 8", exact: true }).last().click();
    await expect(map).toHaveAccessibleName(/Turn 8 is highlighted/);
    await page.getByRole("button", { name: /^Turn 7$/ }).last().click();
    await expect(map).toHaveAccessibleName(/Turn 7 is highlighted/);
    // With the arrow keys.
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/turn=8$/);
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/turn=9$/);
    // After the last turn the lap starts again.
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/turn=1$/);

    // The card before Turn 1 is about joining the track.
    await picker.getByRole("button", { name: "Track entry" }).click();
    await expect(page.getByRole("heading", { name: "Track entry" })).toBeVisible();
    await expect(page.getByText("For your first lap out of the pits only.")).toBeVisible();
    await expect(page).toHaveURL(/turn=entry$/);
    // A link to one turn opens on that turn.
    await page.goto("/track/turns?turn=3");
    await expect(page.getByRole("group", { name: "Choose a turn" }).getByRole("button", { name: "Turn 3", exact: true })).toHaveAttribute("aria-pressed", "true");
    // The illustration enlarges and closes again.
    await page.getByRole("button", { name: "Enlarge: Turn 3: the student line, illustrated" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Zoom" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("passing zones: a driver opens on their own run group's sheet and is warned when looking at another", async ({ page, as }) => {
    // Owen is in Green, which shares a sheet with Blue.
    await signIn(page, "owen");
    await page.goto("/track/passing");
    await expect(shown(page.getByText("Your run group", { exact: true }))).toBeVisible();
    await expect(page.getByText("3 passing zones")).toBeVisible();
    await expect(page.getByText(/All passing is done on the right/).first()).toBeVisible();
    await expect(page.getByRole("img", { name: /Green and Blue passing zones marked in red/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The zones" })).toBeVisible();
    for (const n of [1, 2, 3]) await expect(page.getByLabel(`Zone ${n}`)).toBeVisible();
    const sheets = page.getByRole("navigation", { name: "Run group sheets" });
    await expect(sheets.getByRole("link", { name: "Green and Blue" })).toHaveAttribute("aria-current", "page");

    // The White sheet is clearly marked as not his, with a way back.
    await sheets.getByRole("link", { name: "White" }).click();
    await expect(page).toHaveURL(/sheet=white$/);
    await expect(page.getByText("This sheet is for White. Your run group, Green, uses a different one.")).toBeVisible();
    await expect(shown(page.getByText("Your run group", { exact: true }))).toHaveCount(0);
    await page.getByRole("link", { name: "Open your sheet" }).click();
    await expect(shown(page.getByText("Your run group", { exact: true }))).toBeVisible();

    // The official sheet is there as a picture and as a real PDF.
    await expect(page.getByRole("img", { name: /official passing-zone sheet/ })).toBeVisible();
    const pdf = page.getByRole("link", { name: "Open the PDF" });
    await expect(pdf).toHaveAttribute("target", "_blank");
    await expectRealPdf(page, (await pdf.getAttribute("href"))!);

    // Arjun, in White, opens on the White sheet.
    const arjun = await as("arjun");
    await arjun.goto("/track/passing");
    await expect(arjun.getByText("Your run group", { exact: true })).toBeVisible();
    await expect(arjun.getByRole("navigation", { name: "Run group sheets" }).getByRole("link", { name: "White" })).toHaveAttribute("aria-current", "page");
    await expectRealPdf(arjun, (await arjun.getByRole("link", { name: "Open the PDF" }).getAttribute("href"))!);
  });

  test("flags and rules are all listed, each with its printable sheet", async ({ page }) => {
    await signIn(page, "owen");
    await page.goto("/track/flags");
    await expect(page.getByRole("heading", { level: 1, name: "Flags" })).toBeVisible();
    const flags = ["Green", "Yellow", "Yellow with red stripes", "Blue with yellow diagonal stripe", "White", "Black", "Black with orange circle", "Red", "Checkered"];
    const card = (name: string) => page.getByRole("heading", { level: 2 }).filter({ has: page.getByText(name, { exact: true }) });
    for (const name of flags) await expect(card(name).first()).toBeVisible();
    // Ten cards: yellow appears twice, once held still and once waving.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(10);
    await expect(card("Yellow")).toHaveCount(2);
    await expect(page.getByText("Track is clear")).toBeVisible();
    await expectRealPdf(page, (await page.getByRole("link", { name: "Flag card PDF" }).getAttribute("href"))!);

    await page.goto("/track/rules");
    await expect(page.getByRole("heading", { level: 1, name: "Track rules" })).toBeVisible();
    for (const title of ["Arriving", "On track and in the pits", "Quiet hours and sound", "Fluids, fire and the grounds", "Paddock conduct", "Leaving"]) {
      await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("main").locator("section").getByRole("listitem")).toHaveCount(30);
    await expect(page.getByText("Start with the rules marked in red.")).toBeVisible();
    await expectRealPdf(page, (await page.getByRole("link", { name: "Rules sheet PDF" }).getAttribute("href"))!);
  });

  test("maps: both maps load, enlarge, and come with a PDF, and the paddock places are listed", async ({ page }) => {
    await signIn(page, "owen");
    await page.goto("/track/maps");
    await expect(page.getByRole("heading", { level: 1, name: "Maps" })).toBeVisible();
    for (const title of ["Green student map", "Facility map"]) {
      await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
      const picture = page.getByRole("img", { name: title, exact: true });
      await picture.scrollIntoViewIfNeeded();
      // The picture really loaded, rather than showing a broken image.
      await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(300);
    }
    const pdfs = page.getByRole("link", { name: "PDF", exact: true });
    await expect(pdfs).toHaveCount(2);
    for (const link of await pdfs.all()) await expectRealPdf(page, (await link.getAttribute("href"))!);

    await page.getByRole("button", { name: "Enlarge: Facility map" }).click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.getByRole("img", { name: "Facility map" })).toBeVisible();
    await viewer.getByRole("button", { name: "Zoom" }).click();
    await expect(viewer.getByRole("button", { name: "Fit" })).toBeVisible();
    await viewer.getByRole("button", { name: "Close" }).click();
    await expect(viewer).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Where things are" })).toBeVisible();
    for (const place of ["Tech shed", "False grid", "Student classroom", "Medical", "Fuel"]) await expect(page.getByText(place, { exact: true })).toBeVisible();
  });

  test("documents: every handout opens as a real PDF, and the glossary is there", async ({ page }) => {
    await signIn(page, "owen");
    await page.goto("/track/docs");
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
    const handouts = page.locator("section").filter({ has: page.getByRole("heading", { name: "Handouts" }) }).getByRole("link");
    await expect(handouts).toHaveCount(8);
    for (const link of await handouts.all()) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toContainText(/PDF · [\d.]+ (KB|MB)/);
      await expectRealPdf(page, (await link.getAttribute("href"))!);
    }
    // Tapping one opens it in its own tab rather than replacing the app.
    const [opened, served] = await Promise.all([
      page.context().waitForEvent("page"),
      page.context().waitForEvent("response", (r) => r.url().endsWith("/docs/roebling-road-rules.pdf")),
      handouts.filter({ hasText: "Rules of Roebling Road" }).click(),
    ]);
    expect(served.status()).toBe(200);
    await opened.close();
    await expect(page).toHaveURL(/\/track\/docs$/);

    await expect(page.getByRole("heading", { name: "Glossary" })).toBeVisible();
    await expect(page.getByRole("term")).toHaveCount(13);
    await expect(page.getByRole("term").filter({ hasText: "Apex" })).toBeVisible();
    await expect(page.getByText("The car seems to turn less than expected from the amount of steering input. Front wheels are not gripping.")).toBeVisible();
  });
});

// ───── on a phone

test.describe("on a phone (375px wide)", () => {
  test("the bottom navigation reaches every main screen and nothing spills off the side", async ({ as }) => {
    const page = await as("arjun", { phone: true });
    const tabs = page.getByRole("navigation", { name: "Main" });
    // Five tabs, and the desktop sidebar is not in the way.
    await expect(tabs.getByRole("link")).toHaveText([/^Now$/, /^Schedule$/, /^Track$/, /Alerts$/, /^More$/]);
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
    await expect(tabs.getByRole("link", { name: "Now" })).toHaveAttribute("aria-current", "page");
    const count = unread("arjun");
    // The number of unread alerts rides on the Alerts tab.
    if (count) await expect(tabs.getByRole("link", { name: /Alerts/ })).toHaveText(new RegExp(`^${count}\\s*Alerts$`));
    // The top bar shows who he is at this event: run group and car number.
    await expect(page.getByRole("link", { name: "Your profile" })).toContainText("White");
    expect(await fitsTheScreen(page), "the Now screen fits a phone").toBe(true);

    const stops: [string, RegExp, string][] = [
      ["Schedule", /\/schedule$/, "Schedule"],
      ["Track", /\/track$/, "Roebling Road"],
      ["Alerts", /\/alerts$/, "Alerts"],
      ["More", /\/more$/, "More"],
      ["Now", /\/home$/, "Now"],
    ];
    for (const [label, url, heading] of stops) {
      await tabs.getByRole("link", { name: new RegExp(label) }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeAttached();
      await expect(tabs.getByRole("link", { name: new RegExp(label) })).toHaveAttribute("aria-current", "page");
      await expect(page.locator("body")).not.toContainText(ERROR_PAGE);
      expect(await fitsTheScreen(page), `${label} fits a phone`).toBe(true);
      // The tab bar stays on screen on every page.
      await expect(tabs).toBeInViewport();
    }
  });

  test("the schedule shows one day at a time with a switch between them", async ({ as }) => {
    const ev = currentEvent();
    const page = await as("owen", { phone: true });
    await page.goto(`/schedule?day=${ev.start}`);
    const day = page.getByRole("group", { name: "Day" });
    await expect(day.getByRole("button", { name: weekday(ev.start) })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: dayLong(ev.start) })).toBeVisible();
    await expect(page.getByRole("region", { name: dayLong(ev.end) })).toBeHidden();
    await day.getByRole("button", { name: weekday(ev.end) }).click();
    await expect(page.getByRole("region", { name: dayLong(ev.end) })).toBeVisible();
    await expect(page.getByRole("region", { name: dayLong(ev.start) })).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`day=${ev.end}`));
    // The filter chips scroll sideways inside their own strip; the page itself does not.
    await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Classroom" }).click();
    await expect(page.getByRole("region", { name: dayLong(ev.end) }).getByRole("listitem").first()).toContainText("Classroom");
    expect(await fitsTheScreen(page), "the schedule fits a phone").toBe(true);
  });

  test("the More page leads to profile, tech inspection and waivers, shows no administrator tools, and signs out", async ({ as }) => {
    const page = await as("arjun", { phone: true });
    const tabs = page.getByRole("navigation", { name: "Main" });
    await tabs.getByRole("link", { name: "More" }).click();
    await expect(shown(page.getByText("Arjun Mehta"))).toBeVisible();
    await expect(shown(page.getByText("White run group"))).toBeVisible();
    await expect(shown(page.getByLabel("Car number 199")).last()).toBeVisible();
    await expect(page.getByRole("heading", { name: "You", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run the event" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Instructing" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Roster|Settings|Announcements/ })).toHaveCount(0);

    const main = page.getByRole("main");
    const stops: [string, RegExp, string][] = [
      ["Profile and car", /\/me$/, "Profile and car"],
      ["Tech inspection", /\/me\/tech$/, "Tech inspection"],
      ["Waivers", /\/me\/waivers$/, "Waivers"],
    ];
    for (const [label, url, heading] of stops) {
      await page.goto("/more");
      await main.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      // These live under More, so More stays the highlighted tab.
      await expect(tabs.getByRole("link", { name: "More" })).toHaveAttribute("aria-current", "page");
      expect(await fitsTheScreen(page), `${label} fits a phone`).toBe(true);
    }

    // A form opened on a phone comes up as a sheet that can be filled in and closed.
    await page.goto("/me");
    await page.getByRole("button", { name: "Edit your details" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Mobile phone")).toBeVisible();
    await sheet.getByRole("button", { name: "Save details" }).scrollIntoViewIfNeeded();
    await expect(sheet.getByRole("button", { name: "Save details" })).toBeInViewport();
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();

    // Signing out ends the session: the app's screens ask him to sign in again.
    await page.goto("/more");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/me");
    await expect(page).toHaveURL(/\/login/);
    await expect(shown(page.getByText("arjun.mehta@example.com"))).toHaveCount(0);
  });
});

// ───── what a driver cannot reach

test.describe("a driver's limits", () => {
  test("administrator and instructor screens send a driver back to their own Now screen", async ({ page }) => {
    const ev = currentEvent();
    const tessaForm = val(`select id from tech_inspections where event_id = '${ev.id}' and user_id = '${userId("tessa")}'`);
    await signIn(page, "owen");
    // The navigation offers him nothing beyond his own screens.
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveCount(7);
    await expect(nav.getByText("Run the event")).toHaveCount(0);
    await expect(nav.getByText("Instructing")).toHaveCount(0);

    const paths = [
      "/admin",
      "/admin/roster",
      `/admin/roster/${userId("tessa")}`,
      "/admin/schedule",
      "/admin/instructors",
      "/admin/tech",
      `/admin/tech/${tessaForm}`,
      "/admin/tech/grid",
      "/admin/tech/shops",
      "/admin/waivers",
      `/admin/waivers/person/${userId("tessa")}`,
      "/admin/promotions",
      "/admin/announcements",
      "/admin/incidents",
      "/admin/events",
      "/admin/settings",
      "/instructor",
      `/instructor/${userId("tessa")}`,
    ];
    for (const path of paths) {
      await page.goto(path, { waitUntil: "commit" });
      await expect(page, `a driver opening ${path}`).toHaveURL(/\/home$/);
      await expect(page.getByRole("heading", { level: 1, name: "Now" })).toBeAttached();
      // Nothing of another person's record came along with the redirect.
      await expect(page.locator("body")).not.toContainText(PEOPLE.tessa.email);
      await expect(page.locator("body")).not.toContainText("Robin Nakamura");
    }
    // And nothing about her is in what the server sends for those addresses, before any redirect in the browser.
    for (const path of paths.filter((x) => x.includes(userId("tessa")) || x.includes(tessaForm))) {
      const raw = await (await page.context().request.get(path)).text();
      expect(raw, `what the server sends a driver for ${path}`).not.toContain(PEOPLE.tessa.email);
      expect(raw, `what the server sends a driver for ${path}`).not.toContain("Robin Nakamura");
    }
  });

  test("a driver cannot mark, or otherwise touch, another person's alert", async ({ as }) => {
    // Arjun and Tessa both have the urgent "Oil-dry" announcement unread.
    const mine = val(`select id from notifications where user_id = '${userId("arjun")}' and title = 'Oil-dry at Turn 5 exit' and read_at is null`);
    const hers = val(`select id from notifications where user_id = '${userId("tessa")}' and title = 'Oil-dry at Turn 5 exit' and read_at is null`);
    expect(mine && hers, "both alerts are unread to begin with").toBeTruthy();

    const arjun = await as("arjun");
    await arjun.goto("/alerts");
    // Arjun's browser is made to send Tessa's alert in place of his own when he opens his alert.
    let answered = 0;
    await arjun.route("**/alerts", async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !(req.postData() ?? "").includes(mine)) return route.continue();
      const res = await route.fetch({ postData: req.postData()!.replaceAll(mine, hers) });
      answered = res.status();
      await route.fulfill({ response: res });
    });
    await arjun.getByRole("button", { name: /Oil-dry at Turn 5 exit/ }).click();
    await expect.poll(() => answered, "the altered request reached the app").toBe(200);

    // Tessa's alert is untouched: still unread in the database and on her screen.
    expect(val(`select read_at is null from notifications where id = '${hers}'`)).toBe("t");
    const tessa = await as("tessa");
    await tessa.goto("/alerts");
    await expect(tessa.getByRole("button", { name: /Oil-dry at Turn 5 exit/ }).getByLabel("Unread")).toBeVisible();
  });

  test("a signed-out visitor is sent to sign in, and brought back to where they were going", async ({ page }) => {
    await page.goto("/me/tech");
    await expect(page).toHaveURL(/\/login\?next=%2Fme%2Ftech$/);
    await expect(page.getByRole("button", { name: /Tessa Nakamura/ })).toBeVisible();
  });
});
