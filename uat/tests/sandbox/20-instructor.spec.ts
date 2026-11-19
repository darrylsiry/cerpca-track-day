import type { Locator, Page } from "@playwright/test";
import { test, expect, sql, val, userId, T } from "./fixtures";

// Everything an instructor does over the weekend, as Rosalind Achterberg. On a freshly seeded
// sandbox she is paired with Owen Gallagher (Green), Simone Baptiste (Blue, instructed, with a solo
// recommendation already waiting) and Wendell Park (White, a check-in the administrators asked for).
// Keiko Tanabe (White) has asked for a ride-along and is not paired yet.
//
// Owen is also someone else's test driver, so this file only reads his records. Sessions, notes and
// recommendations are written for Simone, Wendell and Keiko.

const ROSALIND = "Rosalind Achterberg";
const idOf = (email: string) => val(`select id from users where email = '${email}'`);
const WENDELL = "wendell.park@example.com";
const THEO = "theo.marchetti@example.com"; // Blue, instructed, paired with Gus Lindqvist: never Rosalind's student

// Text this run writes, so each check can find exactly its own record. (No apostrophes: some are looked up in the database.)
const SESSION_NOTE = `Smooth and consistent today. Brake a little earlier into Turn 1, keep your eyes up through Turn 4, and give the point-by before you are asked. Mirrors on every straight. (ref ${T})`;
const SESSION_PRIVATE = `Admin eyes only ${T}: drifts wide at the Turn 5 exit when she is tired.`;
const OTHER_NOTE = `Rode one lap in the passenger seat during the lunch parade laps. (ref ${T})`;
const DRIVER_NOTE = `For the Chief Driving Instructor ${T}: mentioned a sore wrist, check before Sunday.`;
const BLACK_RATIONALE = `Wendell reads traffic two corners ahead and every point-by is early and clear. Ready for Black. (ref ${T})`;
const DECLINE_REASON = `Not this weekend ${T}: I want one more check ride on Sunday morning first.`;
const SOLO_RATIONALE = `Second look after the check ride: no corrections from me in two sessions, mirrors every straight. (ref ${T})`;

/** The event the app treats as current: the first published one that has not finished, by the track's calendar. */
function currentEvent() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const [row] = sql(`select id, name, start_date from events where status = 'published' and end_date >= '${today}' order by start_date limit 1`);
  return { id: row[0], name: row[1], start: row[2] };
}

/** Today's date as the app prints it for the track ("Nov 16, 2026"). */
const todayAtTrack = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(new Date());

/** "8:15 AM" for minutes after midnight, as the app prints times. */
const clock = (min: number) => `${Math.floor(min / 60) % 12 === 0 ? 12 : Math.floor(min / 60) % 12}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;

// After a link is followed, the app keeps the screen the person came from in the page, hidden. These
// two read only the text that is actually on screen, so a check is never satisfied (or tripped) by it.
const shows = (page: Page, text: string | RegExp) => expect(page.getByRole("main")).toContainText(text, { useInnerText: true, ignoreCase: true });
const hides = (page: Page, text: string | RegExp) => expect(page.getByRole("main")).not.toContainText(text, { useInnerText: true, ignoreCase: true });

/** The confirmation that pops up at the bottom of the screen after an action (it stays for about three seconds). */
const confirmation = (page: Page, text: string) => page.locator('[aria-live="polite"]').getByText(text).last();
const confirmed = (page: Page, text: string) => expect(confirmation(page, text), `the confirmation "${text}"`).toBeVisible();

/** One student's card on the My students list. */
const card = (page: Page, name: string) => page.getByRole("main").getByRole("link", { name: new RegExp(`^${name}`) }).locator("xpath=..");

/** The open dialog (a centred sheet on desktop, a bottom sheet on a phone). */
const sheet = (page: Page) => page.getByRole("dialog");

/** A titled block of a page ("Promotions", "Earlier events"). */
const block = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

/** The newest alert with this title in the signed-in person's Alerts list. */
async function alertRow(page: Page, title: string): Promise<Locator> {
  await page.goto("/alerts");
  const row = page.getByRole("main").getByRole("listitem").filter({ hasText: title }).first();
  await expect(row, `an alert titled "${title}"`).toBeVisible();
  return row;
}

/** Press a form's button and wait until the server has answered. */
async function send(page: Page, button: Locator) {
  const answered = page.waitForResponse((r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]));
  await button.click();
  await answered;
}

/** Server Action calls a page makes, so a later step can repeat one as somebody else. */
type Call = { url: string; action: string; contentType: string; body: string };
function recordActions(page: Page): Call[] {
  const calls: Call[] = [];
  page.on("request", (r) => {
    const h = r.headers();
    if (r.method() === "POST" && h["next-action"]) calls.push({ url: r.url(), action: h["next-action"], contentType: h["content-type"] ?? "", body: r.postData() ?? "" });
  });
  return calls;
}
/** Send a recorded action again from this person's browser session, with a different body. */
async function replay(page: Page, call: Call, body: string) {
  const res = await page.context().request.post(call.url, { headers: { "next-action": call.action, "content-type": call.contentType, accept: "text/x-component" }, data: body, maxRedirects: 0 });
  return { status: res.status(), sentTo: res.headers()["x-action-redirect"] ?? "", text: await res.text() };
}

const WEEKDAY: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

test.describe("instructor: my students", () => {
  test("My students lists Rosalind's drivers with their car, run group, experience and status", async ({ as }) => {
    const page = await as("rosalind");
    const event = currentEvent();

    // She gets there from the menu, under "Instructing".
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My students" }).click();
    await expect(page).toHaveURL(/\/instructor$/);
    await expect(page.getByRole("heading", { level: 1, name: "My students" })).toBeVisible();
    await shows(page, `You are paired with 3 drivers for ${event.name}.`);
    await expect(page.getByRole("main").getByRole("button", { name: "Log a session" })).toHaveCount(3);

    // A novice: always instructed. (Owen's own details belong to another flow, so only who he is and his status are checked.)
    const owen = card(page, "Owen Gallagher");
    await expect(owen.getByText("Green", { exact: true })).toBeVisible();
    await expect(owen.getByText("Instructed", { exact: true })).toBeVisible();
    await expect(owen.getByText("Recommended", { exact: true })).toHaveCount(0);
    await expect(owen).toContainText("Next on track");

    // A Blue driver who still rides with an instructor, with Rosalind's solo recommendation waiting.
    const simone = card(page, "Simone Baptiste");
    await expect(simone).toContainText("2018 Porsche 718 Cayman S");
    await expect(simone.getByText("Blue", { exact: true })).toBeVisible();
    await expect(simone.getByLabel("Car number 718")).toBeVisible();
    await expect(simone).toContainText("7 track days");
    await expect(simone.getByText("Instructed", { exact: true })).toBeVisible();
    await expect(simone.getByText("Recommended", { exact: true })).toBeVisible();
    await expect(simone.getByText(/^\d+ sessions?$/)).toBeVisible();
    await expect(simone.getByRole("link", { name: "Call Simone Baptiste" })).toHaveAttribute("href", /^tel:\+?\d{10,}$/);

    // A solo driver the administrators asked her to check in on: the pill, the reason and their note.
    const wendell = card(page, "Wendell Park");
    await expect(wendell.getByText("White", { exact: true })).toBeVisible();
    await expect(wendell.getByText("Solo", { exact: true })).toBeVisible();
    await expect(wendell.getByText("Check-in", { exact: true })).toBeVisible();
    await expect(wendell.getByText("Instructed", { exact: true })).toHaveCount(0);
    await expect(wendell).toContainText("Wendell drives solo. The administrators asked for a check-in.");
    await expect(wendell).toContainText("“Ride one session and watch traffic awareness in the longer White passing zone.”");

    // The Now screen carries the same three, each a link to the student's page.
    await page.goto("/home");
    const mine = page.getByRole("heading", { name: "Your students" }).locator("xpath=../..");
    for (const name of ["Owen Gallagher", "Simone Baptiste", "Wendell Park"]) await expect(mine.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    await mine.getByRole("link", { name: /Simone Baptiste/ }).click();
    await expect(page).toHaveURL(new RegExp(`/instructor/${userId("simone")}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Simone Baptiste" })).toBeVisible();
  });

  test("a student's page shows who they are, how to reach them, and their history with the region", async ({ as }) => {
    const page = await as("rosalind");
    await page.goto("/instructor");
    await card(page, "Simone Baptiste").getByRole("link", { name: /^Simone Baptiste/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Simone Baptiste" })).toBeVisible();
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });

    // Who she is at this event.
    await expect(header.getByText("Blue", { exact: true })).toBeVisible();
    await expect(header.getByText("Instructed", { exact: true })).toBeVisible();
    await expect(header).toContainText("2018 Porsche 718 Cayman S");

    // How to reach her and who to call if something goes wrong.
    await shows(page, "7 track days");
    await shows(page, "Both days");
    await expect(page.getByRole("main").getByRole("link", { name: /\(912\) 555-01\d\d/ })).toHaveAttribute("href", /^tel:/);
    await shows(page, "simone.baptiste@example.com");
    await shows(page, /Emergency contact\s+\w+ Baptiste, \(912\) 555-01\d\d/);

    // What Rosalind wrote at the summer event, including her own private note from then.
    const earlier = block(page, "Earlier events");
    await expect(earlier).toContainText("Summer Driver Education · Saturday 10:10 · Green");
    await expect(earlier).toContainText("Summer Driver Education · Sunday 12:30 · Green");
    await expect(earlier).toContainText("I am recommending you for Blue.");
    await expect(earlier).toContainText("Strong candidate for Blue after this weekend.");

    // Her promotion history: the summer move to Blue, and the solo sign-off that is waiting.
    const promos = block(page, "Promotions");
    const toBlue = promos.getByRole("listitem").filter({ hasText: "Green to Blue" });
    await expect(toBlue).toContainText("Approved");
    await expect(toBlue).toContainText("Summer Driver Education · recommended by Rosalind Achterberg");
    await expect(toBlue).toContainText("Decision: Approved. Stays instructed in Blue to start.");
    await expect(promos.getByRole("listitem").filter({ hasText: "Solo sign-off in Blue" }).filter({ hasText: "Awaiting sign-off" })).toHaveCount(1);

    // The check-in student's page explains why a solo driver is on her list.
    await page.getByRole("main").getByRole("link", { name: "My students" }).click();
    await card(page, "Wendell Park").getByRole("link", { name: /^Wendell Park/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Wendell Park" })).toBeVisible();
    await shows(page, "Wendell drives solo; the administrators asked for a check-in");
    await shows(page, "“Ride one session and watch traffic awareness in the longer White passing zone.”");
    await expect(header.getByText("Check-in", { exact: true })).toBeVisible();
    await expect(header.getByText("Solo", { exact: true })).toBeVisible();
  });

  test("on a phone, My students is under More and a session can be logged from the card", async ({ as }) => {
    const page = await as("rosalind", { phone: true });
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "More" }).click();
    await page.getByRole("main").getByRole("link", { name: "My students" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My students" })).toBeVisible();
    await expect(card(page, "Wendell Park")).toContainText("The administrators asked for a check-in.");

    // The form opens as a sheet that fits the screen, and closes again without saving anything.
    await card(page, "Simone Baptiste").getByRole("button", { name: "Log a session" }).click();
    await expect(sheet(page).getByRole("heading", { name: "Log a session" })).toBeVisible();
    await sheet(page).getByRole("button", { name: "Save session" }).scrollIntoViewIfNeeded();
    await expect(sheet(page).getByRole("button", { name: "Save session" })).toBeInViewport();
    const box = await sheet(page).boundingBox();
    expect(box!.width, "the sheet is no wider than the phone").toBeLessThanOrEqual(375);
    await sheet(page).getByRole("button", { name: "Close" }).click();
    await expect(sheet(page)).toHaveCount(0);
  });
});

test.describe("instructor: schedule", () => {
  test("sessions Rosalind rides in are marked with her student's name, and her own with You", async ({ as }) => {
    const page = await as("rosalind");
    const event = currentEvent();
    // Track sessions as they stand now, with the run groups in each (the schedule may have been edited by another flow).
    const sessions = sql(
      `select s.day, s.start_min, s.title,
              (select string_agg(g.key, ',' order by g.sort_order) from run_groups g where s.group_ids ? g.id)
         from schedule_items s
        where s.event_id = '${event.id}' and s.kind = 'track' and s.audience = 'groups' and not s.cancelled and s.group_parts = '{}'::jsonb
        order by s.day, s.start_min`,
    ).map(([day, start, title, keys]) => ({ day, start: Number(start), title, keys }));
    const first = (keys: string) => sessions.find((s) => s.keys === keys);

    await page.goto("/schedule");
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
    const row = (s: { day: string; start: number; title: string }) => {
      const dayName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${s.day}T12:00:00Z`));
      const [time, period] = clock(s.start).split(" ");
      return page
        .getByRole("region", { name: dayName })
        .getByRole("listitem")
        .filter({ hasText: new RegExp(`^\\s*${time}\\s*${period}`) })
        .filter({ hasText: "Track session" });
    };

    // Each kind of session: who she rides with decides the label.
    const expected: [string, RegExp | null][] = [
      ["green", /^With Owen$/],
      ["blue", /^With Simone$/],
      ["white", /^With Wendell$/],
      ["red", /^You$/],
      ["black", null],
      ["green,blue", /^With (Owen and Simone|Simone and Owen)$/],
    ];
    let checked = 0;
    for (const [keys, label] of expected) {
      const s = first(keys);
      if (!s) continue;
      checked += 1;
      const r = row(s);
      await expect(r, `${s.title} at ${clock(s.start)} on ${s.day}`).toHaveCount(1);
      await expect(r).toContainText(s.title);
      if (label) await expect(r.getByText(label)).toBeVisible();
      else await expect(r.getByText(/^(With .+|You)$/)).toHaveCount(0);
    }
    expect(checked, "kinds of session checked").toBeGreaterThanOrEqual(4);

    // "Mine only" keeps her students' sessions and drops a run group she has nothing to do with.
    await page.getByRole("button", { name: "Mine only" }).click();
    await expect(row(first("green")!)).toHaveCount(1);
    if (first("black")) await expect(row(first("black")!)).toHaveCount(0);
  });

  test("ten minutes before a student's session, Now tells her to meet them at the grid", async ({ as }) => {
    const page = await as("rosalind");
    const event = currentEvent();
    // The second Green-only session of the first day, so an earlier one has already been driven.
    const green = sql(
      `select s.start_min, s.title from schedule_items s
        where s.event_id = '${event.id}' and s.day = '${event.start}' and s.kind = 'track' and not s.cancelled
          and s.group_ids = (select jsonb_build_array(id) from run_groups where key = 'green')
        order by s.start_min`,
    ).map(([start, title]) => ({ start: Number(start), title }));
    test.skip(green.length < 2, "the first day no longer has two Green sessions");
    const [earlier, next] = green;
    const at = next.start - 8;

    // Demo mode lets anyone move their own copy of the app's clock; nobody else is affected.
    await page.getByRole("button", { name: "Set clock" }).click();
    const firstDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${event.start}T12:00:00Z`));
    await sheet(page).getByLabel("Day").selectOption({ label: firstDay });
    await sheet(page).getByLabel("Time").fill(`${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`);
    await sheet(page).getByRole("button", { name: "Set clock" }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByText(`${clock(at)} simulated`)).toBeVisible();

    // The Now screen: her next item is the Green session, with Owen, and it is time to walk to the grid.
    await page.goto("/home");
    const you = page.locator("section").filter({ has: page.getByText("You", { exact: true }) }).filter({ hasText: "to go" });
    await expect(you).toContainText("Meet your student at the grid");
    await expect(you).toContainText(next.title);
    await expect(you).toContainText("with Owen");

    // My students: Owen's next session is that one, and the form offers the session he has just driven.
    await page.goto("/instructor");
    const owen = card(page, "Owen Gallagher");
    await expect(owen.getByText("Next on track").locator("xpath=..")).toContainText(clock(next.start));
    await owen.getByRole("button", { name: "Log a session" }).click();
    const picked = sheet(page).getByLabel(/^Session/).locator("option:checked");
    await expect(picked).toContainText(`${clock(earlier.start)} · ${earlier.title}`);
    await expect(picked).not.toContainText("(upcoming)");
    await sheet(page).getByRole("button", { name: "Close" }).click();
  });
});

test.describe("instructor: session notes", () => {
  test("logging a session sends the notes to the student, and the private note only to administrators", async ({ as }) => {
    const rosalind = await as("rosalind");
    const event = currentEvent();
    await rosalind.goto("/instructor");
    const simoneCard = card(rosalind, "Simone Baptiste");
    const before = Number(((await simoneCard.getByText(/^\d+ sessions?$/).textContent()) ?? "").match(/\d+/)?.[0]);

    await simoneCard.getByRole("button", { name: "Log a session" }).click();
    const form = sheet(rosalind);
    await expect(form.getByRole("heading", { name: "Log a session" })).toBeVisible();
    await expect(form).toContainText("Notes from a session with Simone Baptiste.");

    // The sessions offered are Simone's own (Blue), plus "Other".
    const session = form.getByLabel(/^Session/);
    const offered = (await session.locator("option").allTextContents()).map((o) => o.trim());
    expect(offered.at(-1)).toBe("Other / not on the schedule");
    const choice = offered[0];
    expect(choice, "the first session offered is a Blue track session").toMatch(/^(Sat|Sun) \d{1,2}:\d{2} (AM|PM) · .*Blue/);
    await session.selectOption({ label: choice });
    const [, wd, time, , title] = choice.match(/^(\w{3}) (\d{1,2}:\d{2}) (AM|PM) · (.+?)(?: \(upcoming\))?$/)!;
    const label = `${WEEKDAY[wd]} ${time} · ${title}`;

    // A couple of words is not a debrief: she is asked for more, and what she typed is kept.
    const notes = form.getByLabel(/^Notes for Simone/);
    await notes.fill("Good");
    await form.getByRole("button", { name: "Save session" }).click();
    await expect(form.getByRole("alert")).toHaveText("Write a few words for your student about this session.");
    await expect(notes).toHaveValue("Good");

    await notes.fill(SESSION_NOTE);
    await form.getByText("Vision", { exact: true }).click();
    await form.getByText("Braking", { exact: true }).click();
    await expect(form.getByLabel("Vision", { exact: true })).toBeChecked();
    await form.getByLabel(/Private note for administrators/).fill(SESSION_PRIVATE);
    await form.getByRole("button", { name: "Save session" }).click();
    await confirmed(rosalind, "Session logged");
    await expect(form).toHaveCount(0);
    await expect(simoneCard.getByText(/^\d+ sessions?$/)).toHaveText(`${before + 1} session${before + 1 === 1 ? "" : "s"}`);

    // Rosalind sees it on Simone's page, private note included, since she wrote it.
    await simoneCard.getByRole("link", { name: /^Simone Baptiste/ }).click();
    const entry = block(rosalind, "Sessions at this event").getByRole("listitem").filter({ hasText: SESSION_NOTE });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(label);
    await expect(entry).toContainText(ROSALIND);
    await expect(entry.getByText("Vision", { exact: true })).toBeVisible();
    await expect(entry.getByText("Braking", { exact: true })).toBeVisible();
    await expect(entry).toContainText("Administrators only");
    await expect(entry).toContainText(SESSION_PRIVATE);

    // Simone gets an alert with the start of the notes; opening it takes her to the full text.
    const simone = await as("simone");
    const alert = await alertRow(simone, "Rosalind added notes from your session");
    await expect(alert).toContainText(`${SESSION_NOTE.slice(0, 137)}…`);
    await expect(alert).toContainText("Session notes");
    await hides(simone, "Admin eyes only");
    await alert.getByRole("button").click();
    await expect(simone).toHaveURL(/\/me#feedback$/);
    const feedback = simone.getByRole("main").getByRole("listitem").filter({ hasText: SESSION_NOTE });
    await expect(feedback).toHaveCount(1);
    await expect(feedback).toContainText(label);
    await expect(feedback).toContainText(`${event.name} · ${ROSALIND}`);
    await expect(feedback.getByText("Vision", { exact: true })).toBeVisible();
    // The private note is for administrators: it is nowhere on the student's screens.
    await hides(simone, "Admin eyes only");
    await simone.goto("/home");
    await expect(simone.getByRole("heading", { name: "Your instructor" })).toBeVisible();
    await hides(simone, "Admin eyes only");

    // An administrator reads both in the driver's file.
    const marian = await as("marian");
    await marian.goto(`/admin/roster/${userId("simone")}`);
    const filed = marian.getByRole("main").getByRole("listitem").filter({ hasText: SESSION_NOTE });
    await expect(filed).toHaveCount(1);
    await expect(filed).toContainText(`${event.name} · ${label}`);
    await expect(filed).toContainText(ROSALIND);
    await expect(filed).toContainText("Administrators only");
    await expect(filed).toContainText(SESSION_PRIVATE);
  });

  test("a session that is not on the schedule can be logged, and an entry can be removed", async ({ as }) => {
    const page = await as("rosalind");
    await page.goto(`/instructor/${idOf(WENDELL)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Wendell Park" })).toBeVisible();
    await page.getByRole("button", { name: "Log a session" }).click();
    await sheet(page).getByLabel(/^Session/).selectOption({ label: "Other / not on the schedule" });
    await sheet(page).getByLabel(/^Notes for Wendell/).fill(OTHER_NOTE);
    await sheet(page).getByRole("button", { name: "Save session" }).click();
    await confirmed(page, "Session logged");

    const entry = page.getByRole("main").getByRole("listitem").filter({ hasText: OTHER_NOTE });
    await expect(entry).toHaveCount(1);
    await expect(entry.getByText("Session", { exact: true })).toBeVisible();
    // Nothing private was written, so there is no administrators-only block.
    await expect(entry).not.toContainText("Administrators only");

    // She logged it against the wrong driver: Remove asks first, then takes it away.
    const entryId = val(`select id from session_logs where shared_notes = '${OTHER_NOTE}'`);
    const calls = recordActions(page);
    const asked: string[] = [];
    page.on("dialog", (d) => asked.push(d.message()));
    await entry.getByRole("button", { name: "Remove" }).click();
    await confirmed(page, "Entry removed");
    expect(asked).toEqual(["Remove this session entry? Your student will no longer see it."]);
    await expect(entry).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Wendell Park" })).toBeVisible();
    await hides(page, OTHER_NOTE);
    expect(val(`select count(*) from session_logs where id = '${entryId}'`), "the removed entry is gone for the student too").toBe("0");

    // Remove is only offered on her own entries. Repeating the same request for an entry another
    // instructor wrote (Noelle's notes for Marcus from the summer) is refused, and the entry stays.
    const noelles = val(`select l.id from session_logs l join users u on u.id = l.instructor_id where u.email = 'noelle.fairbanks@example.com' order by l.created_at limit 1`);
    expect(calls.length, "the remove request was seen").toBe(1);
    expect(calls[0].body, "the remove request names the entry").toContain(entryId);
    const refused = await replay(page, calls[0], calls[0].body.replace(entryId, noelles));
    expect(refused.text).toContain("You can only remove entries you wrote.");
    expect(val(`select count(*) from session_logs where id = '${noelles}'`), "another instructor's entry is still there").toBe("1");
  });

  test("a private driver note reaches the administrators and never the student", async ({ as }) => {
    const rosalind = await as("rosalind");
    const event = currentEvent();
    await rosalind.goto(`/instructor/${userId("simone")}`);
    await rosalind.getByRole("button", { name: "Private note" }).click();
    const form = sheet(rosalind);
    await expect(form).toContainText("About Simone Baptiste. Only administrators and you can read it.");

    // An accidental tap on Save with next to nothing typed is refused.
    await form.getByLabel("Note").fill("abc");
    await form.getByRole("button", { name: "Save note" }).click();
    await expect(form.getByRole("alert")).toHaveText("Write the note first.");

    await form.getByLabel("Note").fill(DRIVER_NOTE);
    await form.getByRole("button", { name: "Save note" }).click();
    await confirmed(rosalind, "Note saved for administrators");
    await expect(form).toHaveCount(0);

    // It stays on the student's page for Rosalind, marked as private.
    const note = block(rosalind, "Your private notes").getByRole("listitem").filter({ hasText: DRIVER_NOTE });
    await expect(note).toHaveCount(1);
    await expect(note).toContainText(`Administrators only · ${todayAtTrack()}`);

    // The administrators find it in the driver's file, labelled as coming from an instructor.
    const marian = await as("marian");
    await marian.goto(`/admin/roster/${userId("simone")}`);
    const filed = marian.getByRole("main").getByRole("listitem").filter({ hasText: DRIVER_NOTE });
    await expect(filed).toHaveCount(1);
    await expect(filed).toContainText("From instructor");
    await expect(filed).toContainText(`${ROSALIND} · ${todayAtTrack()} · ${event.name}`);

    // Simone is not told and cannot find it.
    const simone = await as("simone");
    for (const path of ["/me", "/alerts", "/home"]) {
      await simone.goto(path);
      await expect(simone.getByRole("heading", { level: 1 })).toBeAttached();
      await hides(simone, "sore wrist");
    }
  });
});

test.describe("instructor: recommendations", () => {
  test("the choices offered depend on the student's run group and whether they already drive solo", async ({ as }) => {
    const page = await as("rosalind");
    await page.goto("/instructor");

    // Green is always instructed: the only step is up to Blue.
    await card(page, "Owen Gallagher").getByRole("button", { name: "Recommend" }).click();
    await expect(sheet(page)).toContainText("Owen Gallagher is in Green. An administrator signs off before anything changes.");
    await expect(sheet(page).getByRole("radio", { name: /Promote to Blue/ })).toBeChecked();
    await expect(sheet(page)).toContainText("Move up from Green.");
    await expect(sheet(page).getByRole("radio", { name: /Sign off to drive solo/ })).toHaveCount(0);
    await sheet(page).getByRole("button", { name: "Close" }).click();

    // A White driver already drives solo: the only step is up to Black.
    await card(page, "Wendell Park").getByRole("button", { name: "Recommend" }).click();
    await expect(sheet(page).getByRole("radio")).toHaveCount(1);
    await expect(sheet(page).getByRole("radio", { name: /Promote to Black/ })).toBeChecked();
    await sheet(page).getByRole("button", { name: "Close" }).click();

    // Simone's solo sign-off is already with the administrators: no second form.
    await card(page, "Simone Baptiste").getByRole("button", { name: "Recommend" }).click();
    await expect(sheet(page)).toContainText("A recommendation is already waiting for sign-off");
    await expect(sheet(page)).toContainText("You will get an alert when the Chief Driving Instructor decides.");
    await expect(sheet(page).getByRole("button", { name: "Send for sign-off" })).toHaveCount(0);
  });

  test("recommending a move to the next run group puts it in front of the administrators with her reasons", async ({ as }) => {
    const rosalind = await as("rosalind");
    const event = currentEvent();
    await rosalind.goto("/instructor");
    const wendell = card(rosalind, "Wendell Park");
    await expect(wendell.getByText("Recommended", { exact: true })).toHaveCount(0);
    await wendell.getByRole("button", { name: "Recommend" }).click();
    const form = sheet(rosalind);
    await expect(form).toContainText("Wendell Park is in White. An administrator signs off before anything changes.");

    // One line is not a rationale: the form will not send it.
    const rationale = form.getByLabel(/^Your rationale/);
    await rationale.fill("Ready for Black.");
    await form.getByRole("button", { name: "Send for sign-off" }).click();
    expect(await rationale.evaluate((el: HTMLTextAreaElement) => el.validity.valid), "whether the form accepts a one-line rationale").toBe(false);
    await expect(form.getByRole("button", { name: "Send for sign-off" })).toBeVisible();

    await rationale.fill(BLACK_RATIONALE);
    await send(rosalind, form.getByRole("button", { name: "Send for sign-off" }));
    // Like every other form in the app, this one should say it worked and close. (Checked without
    // stopping, so the rest of the flow is still verified if it does not.)
    await expect.soft(confirmation(rosalind, "Recommendation sent for sign-off"), "the confirmation after sending a recommendation").toBeVisible({ timeout: 2500 });
    await expect.soft(form, "the recommendation form, which closes once it is sent").toHaveCount(0, { timeout: 1000 });

    // What Rosalind sees afterwards: the pill on the list, no way to send a second one, and the record on his page.
    await rosalind.goto("/instructor");
    await expect(wendell.getByText("Recommended", { exact: true })).toBeVisible();
    await wendell.getByRole("button", { name: "Recommend" }).click();
    await expect(sheet(rosalind)).toContainText("A recommendation is already waiting for sign-off");
    await sheet(rosalind).getByRole("button", { name: "Close" }).click();
    await wendell.getByRole("link", { name: /^Wendell Park/ }).click();
    const record = block(rosalind, "Promotions").getByRole("listitem").filter({ hasText: BLACK_RATIONALE });
    await expect(record).toHaveCount(1);
    await expect(record).toContainText("White to Black");
    await expect(record).toContainText("Awaiting sign-off");
    await expect(record).toContainText(`${event.name} · recommended by ${ROSALIND}`);

    // Marian is alerted, and the alert opens the sign-off list with the rationale in full.
    const marian = await as("marian");
    const alert = await alertRow(marian, "Recommendation: Wendell Park, promotion to Black");
    await expect(alert).toContainText("Rosalind Achterberg recommends promotion to Black. Review the rationale and sign off.");
    await alert.getByRole("button").click();
    await expect(marian).toHaveURL(/\/admin\/promotions$/);
    const waiting = marian.getByRole("main").getByRole("listitem").filter({ has: marian.getByRole("button", { name: "Approve" }) }).filter({ hasText: "Wendell Park" });
    await expect(waiting).toHaveCount(1);
    await expect(waiting).toContainText(BLACK_RATIONALE);
    await expect(waiting).toContainText(`Recommended by ${ROSALIND}`);
    await expect(waiting).toContainText(`at ${event.name}`);
    await expect(waiting.getByText("White", { exact: true })).toBeVisible();
    await expect(waiting.getByText("Black", { exact: true })).toBeVisible();

    // Every administrator was told; Wendell was not, and nothing about him has changed yet.
    const admins = val("select count(*) from memberships where is_admin");
    expect(val("select count(*) from notifications where title = 'Recommendation: Wendell Park, promotion to Black'")).toBe(admins);
    expect(val(`select count(*) from notifications where user_id = '${idOf(WENDELL)}' and kind = 'promotion'`), "alerts to the driver about a recommendation").toBe("0");
    await rosalind.goto("/instructor");
    await expect(card(rosalind, "Wendell Park").getByText("White", { exact: true })).toBeVisible();
  });

  test("after a decline Rosalind sees the reason, and can recommend a solo sign-off in Blue again", async ({ as }) => {
    const event = currentEvent();
    // Marian declines the solo sign-off that is waiting for Simone, with a reason. (The administrator's
    // side of a decision, including its confirmation, is covered with the promotions flows.)
    const marian = await as("marian");
    await marian.goto("/admin/promotions");
    const waitingFor = (name: string) => marian.getByRole("main").getByRole("listitem").filter({ has: marian.getByRole("button", { name: "Approve" }) }).filter({ hasText: name });
    await expect(waitingFor("Simone Baptiste")).toHaveCount(1);
    await waitingFor("Simone Baptiste").getByRole("button", { name: "Decline" }).click();
    await expect(sheet(marian)).toContainText("Simone Baptiste: solo sign-off in Blue.");
    await sheet(marian).getByLabel(/^Reason/).fill(DECLINE_REASON);
    await sheet(marian).getByRole("button", { name: "Decline recommendation" }).click();
    await expect(waitingFor("Simone Baptiste")).toHaveCount(0);

    // Rosalind is told, with the reason, and the alert opens Simone's page.
    const rosalind = await as("rosalind");
    const alert = await alertRow(rosalind, "Declined: your recommendation for solo sign-off");
    await expect(alert).toContainText(DECLINE_REASON);
    await expect(alert).toContainText("Promotion");
    await alert.getByRole("button").click();
    await expect(rosalind).toHaveURL(new RegExp(`/instructor/${userId("simone")}$`));
    const promos = block(rosalind, "Promotions");
    const declined = promos.getByRole("listitem").filter({ hasText: `Decision: ${DECLINE_REASON}` });
    await expect(declined).toHaveCount(1);
    await expect(declined).toContainText("Solo sign-off in Blue");
    await expect(declined.getByText("Declined", { exact: true })).toBeVisible();
    await expect(promos.getByText("Awaiting sign-off")).toHaveCount(0);

    // The driver is not told about a decline, and still rides with her instructor.
    const simone = await as("simone");
    await simone.goto("/alerts");
    await expect(simone.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
    await hides(simone, "check ride");
    await simone.goto("/me");
    await shows(simone, "Blue (Instructed): an instructor rides with you until you are signed off solo.");

    // With nothing waiting, the form is back. In Blue she can recommend the next group or a solo sign-off.
    await rosalind.getByRole("button", { name: "Recommend" }).click();
    const form = sheet(rosalind);
    await expect(form.getByRole("radio")).toHaveCount(2);
    await expect(form.getByRole("radio", { name: /Promote to White/ })).toBeChecked();
    await form.getByRole("radio", { name: /Sign off to drive solo/ }).check();
    await expect(form).toContainText("Stay in Blue, without an instructor in the car.");
    await form.getByLabel(/^Your rationale/).fill(SOLO_RATIONALE);
    // (Whether this form confirms and closes is checked once, in the flow before this one.)
    await send(rosalind, form.getByRole("button", { name: "Send for sign-off" }));

    await rosalind.goto(`/instructor/${userId("simone")}`);
    const again = promos.getByRole("listitem").filter({ hasText: SOLO_RATIONALE });
    await expect(again).toHaveCount(1);
    await expect(again).toContainText("Solo sign-off in Blue");
    await expect(again).toContainText("Awaiting sign-off");
    await expect(again).toContainText(`${event.name} · recommended by ${ROSALIND}`);
    await rosalind.goto("/instructor");
    await expect(card(rosalind, "Simone Baptiste").getByText("Recommended", { exact: true })).toBeVisible();
    // Until an administrator signs it off, Simone is still instructed.
    await expect(card(rosalind, "Simone Baptiste").getByText("Instructed", { exact: true })).toBeVisible();

    // It is back on Marian's list as a solo sign-off, with the new rationale.
    const told = await alertRow(marian, "Recommendation: Simone Baptiste, solo sign-off");
    await expect(told).toContainText("Rosalind Achterberg recommends solo sign-off. Review the rationale and sign off.");
    await marian.goto("/admin/promotions");
    await expect(waitingFor("Simone Baptiste")).toHaveCount(1);
    await expect(waitingFor("Simone Baptiste")).toContainText(SOLO_RATIONALE);
    await expect(waitingFor("Simone Baptiste").getByText("Solo sign-off", { exact: true })).toBeVisible();
  });
});

test.describe("instructor: ride-along", () => {
  test("a solo driver's ride-along shows on her list with what the driver wants to work on", async ({ as }) => {
    const keikoNote = "I would like a second opinion on my line through Turns 4 and 5, and on braking into Turn 1.";
    // Marian pairs Keiko, who asked for an instructor, with Rosalind.
    const marian = await as("marian");
    await marian.goto("/admin/instructors");
    const pick = marian.getByLabel("Instructor for Keiko Tanabe");
    await pick.selectOption((await pick.locator("option", { hasText: ROSALIND }).getAttribute("value"))!);
    await confirmed(marian, "Paired, and both have been told");

    // Rosalind is told it is a ride-along, not a new novice, and where to find the driver's note.
    const rosalind = await as("rosalind");
    const alert = await alertRow(rosalind, "Ride-along: Keiko Tanabe");
    await expect(alert).toContainText("A solo driver asked for an instructor. What they want to work on is under My students.");
    await expect(alert).toContainText("Instructor pairing");
    await alert.getByRole("button").click();
    await expect(rosalind).toHaveURL(/\/instructor$/);
    await shows(rosalind, "You are paired with 4 drivers");

    const keiko = card(rosalind, "Keiko Tanabe");
    await expect(keiko.getByText("Solo", { exact: true })).toBeVisible();
    await expect(keiko.getByText("Ride-along", { exact: true })).toBeVisible();
    await expect(keiko.getByText("Check-in", { exact: true })).toHaveCount(0);
    await expect(keiko).toContainText("Keiko drives solo and asked for an instructor to ride along.");
    await expect(keiko).toContainText(`“${keikoNote}”`);

    // Her page leads with the request.
    await keiko.getByRole("link", { name: /^Keiko Tanabe/ }).click();
    await expect(rosalind.getByRole("heading", { level: 1, name: "Keiko Tanabe" })).toBeVisible();
    await shows(rosalind, "Keiko drives solo and asked for an instructor to ride along");
    await shows(rosalind, `“${keikoNote}”`);
    const header = rosalind.locator("header").filter({ has: rosalind.getByRole("heading", { level: 1 }) });
    await expect(header.getByText("Ride-along", { exact: true })).toBeVisible();
    await expect(header.getByText("Solo", { exact: true })).toBeVisible();

    // White sessions on her schedule now name both White drivers she rides with.
    await rosalind.goto("/schedule");
    await expect(rosalind.getByText(/^With (Wendell and Keiko|Keiko and Wendell)$/).first()).toBeVisible();
  });
});

test.describe("instructor: only her own students", () => {
  test("Rosalind cannot open, or write about, a driver who is not her student", async ({ as }) => {
    const rosalind = await as("rosalind");
    const theo = idOf(THEO);

    // Typing another instructor's student into the address gives "not found", with nothing about him.
    await rosalind.goto(`/instructor/${theo}`);
    await expect(rosalind.getByText("This page could not be found.")).toBeVisible();
    await hides(rosalind, /Theo|Marchetti/);

    // The forms behind her own student's page do not work for him either. She sends each form for
    // Simone with too little typed (so nothing is saved), then the same request is repeated with
    // Theo in Simone's place and a full note.
    const calls = recordActions(rosalind);
    await rosalind.goto(`/instructor/${userId("simone")}`);
    await rosalind.getByRole("button", { name: "Log a session" }).click();
    await sheet(rosalind).getByLabel(/^Notes for Simone/).fill("tooshort");
    await sheet(rosalind).getByRole("button", { name: "Save session" }).click();
    await expect(sheet(rosalind).getByRole("alert")).toBeVisible();
    await sheet(rosalind).getByRole("button", { name: "Close" }).click();
    await rosalind.getByRole("button", { name: "Private note" }).click();
    await sheet(rosalind).getByLabel("Note").fill("abc");
    await sheet(rosalind).getByRole("button", { name: "Save note" }).click();
    await expect(sheet(rosalind).getByRole("alert")).toBeVisible();
    expect(calls.length, "the two form submissions were seen").toBe(2);
    const [logCall, noteCall] = calls;
    const forged = `Written about a driver who is not mine ${T}`;

    const log = await replay(rosalind, logCall, logCall.body.replaceAll(userId("simone"), theo).replace("tooshort", forged));
    expect(log.text).toContain("This driver is not assigned to you at this event.");
    const note = await replay(rosalind, noteCall, noteCall.body.replaceAll(userId("simone"), theo).replace("abc", forged));
    expect(note.text).toContain("This driver is not assigned to you at this event.");
    expect(val(`select count(*) from session_logs where shared_notes = '${forged}'`), "session notes written for someone else's student").toBe("0");
    expect(val(`select count(*) from driver_notes where body = '${forged}'`), "private notes written for someone else's student").toBe("0");

    // The same repeated request for her own student does go through, so the refusals above are real ones.
    const followUp = `Follow-up for the Chief Driving Instructor ${T}: the wrist is fine.`;
    const own = await replay(rosalind, noteCall, noteCall.body.replace("abc", followUp));
    expect(own.text).toContain("Note saved for administrators");
    expect(val(`select count(*) from driver_notes where body = '${followUp}' and user_id = '${userId("simone")}'`)).toBe("1");
  });

  test("a driver has no My students, and cannot reach an instructor's pages or forms", async ({ as }) => {
    const simone = await as("simone");
    await expect(simone.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Now" })).toBeVisible();
    await expect(simone.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My students" })).toHaveCount(0);
    for (const path of ["/instructor", `/instructor/${userId("owen")}`, `/instructor/${userId("simone")}`]) {
      await simone.goto(path);
      await simone.waitForLoadState("networkidle").catch(() => {});
      expect(new URL(simone.url()).pathname, `where a driver lands from ${path}`).toBe("/home");
    }

    // Repeating an instructor's "save note" request from a driver's session is turned away.
    const rosalind = await as("rosalind");
    const calls = recordActions(rosalind);
    await rosalind.goto(`/instructor/${userId("simone")}`);
    await rosalind.getByRole("button", { name: "Private note" }).click();
    await sheet(rosalind).getByLabel("Note").fill("abc");
    await sheet(rosalind).getByRole("button", { name: "Save note" }).click();
    await expect(sheet(rosalind).getByRole("alert")).toBeVisible();
    const forged = `A driver writing a note meant for instructors ${T}`;
    const res = await replay(simone, calls[0], calls[0].body.replace("abc", forged));
    expect(res.sentTo, "a driver's request is sent back to the Now screen").toContain("/home");
    expect(res.text).not.toContain("Note saved");
    expect(val(`select count(*) from driver_notes where body = '${forged}'`)).toBe("0");
  });
});
