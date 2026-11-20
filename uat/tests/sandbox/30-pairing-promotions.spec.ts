import type { BrowserContext, Locator, Page } from "@playwright/test";
import { test as base, expect, openBrowser, sql, val, userId, T } from "./fixtures";

// The administrator's side of instruction, as Marian Castellanos (event chair): pairing drivers with
// instructors, check-ins and ride-alongs for solo drivers, and signing off promotions.
//
// The seeded event has two drivers waiting for an instructor (Holly Pruitt, Green; Keiko Tanabe,
// White, who asked for a ride-along), and two recommendations waiting for sign-off (Simone Baptiste,
// solo in Blue, from Rosalind Achterberg; Marcus Feldman, Green to Blue, from Noelle Fairbanks).
// Flows here work on drivers this file owns and read the page for counts, so they hold whether or
// not the instructor flows (20-instructor) ran first. Tessa, Arjun and Owen are left alone.

const idOf = (email: string) => val(`select id from users where email = '${email}'`);
const emailOf = (name: string) => val(`select email from users where first_name || ' ' || last_name = '${name}'`);
const HOLLY = "holly.pruitt@example.com"; //   Green, first day only, not paired when seeded
const RAFAEL = "rafael.montoya@example.com"; // instructor with no students when seeded
const DALE = "dale.whitfield@example.com"; //   Chief Driving Instructor, no students when seeded
const FIONA = "fiona.castellan@example.com"; // White, solo
const ELENA = "elena.vasquez@example.com"; //   Black, solo
const MARCUS = "marcus.feldman@example.com"; // Green, Noelle's student
const NOELLE = "noelle.fairbanks@example.com";
const WENDELL = "wendell.park@example.com"; //  White, Rosalind's check-in
const JOANNA = "joanna.kessler@example.com"; // Blue, already solo
const MAYA = "maya.lindholm@example.com"; //    Blue, instructed, Noelle's student
const THEO = "theo.marchetti@example.com"; //   Blue, instructed, Gus's student
const GUS = "gus.lindqvist@example.com";

// Text this run writes, so each check can find exactly its own record. (No apostrophes: some are looked up in the database.)
const RIDE_NOTE = `Trail braking into Turn 4, and where I should be looking through Turn 5. (ref ${T})`;
const CHECK_NOTE = `Two late point-bys reported in the last Black session; ride one and watch the mirrors. (ref ${T})`;
const LATER_NOTE = `Agreed after reading the session notes ${T}. Blue from the next event, still instructed.`;
const DECLINE_REASON = `Not yet ${T}: two more clean weekends in White first, then ask again.`;
const SOLO_NOTE = `Rode with her at lunch ${T}: calm in traffic, signs early. Solo from now.`;
const BLACK_RATIONALE = `Wendell reads traffic two corners ahead and every point-by is early and clear. Ready for Black. (ref ${T}b)`;
const SOLO_RATIONALE = `No corrections from me in two sessions and she pits on her own judgement. Ready to drive solo. (ref ${T}b)`;
const MOVE_REASON = `Registrar correction ${T}: has run White pace with another region all season.`;
const DIRECT_SOLO_REASON = `Check ride with the Chief Driving Instructor on Saturday ${T}: ready to drive solo.`;
const WHITE_NOW_REASON = `Chief Driving Instructor decision ${T}: White from this weekend after two check rides.`;

/** A page for someone who is not a sample account: they sign in with the emailed one-time code, as real members do. */
const test = base.extend<{ person: (email: string) => Promise<Page> }>({
  person: async ({ browser, problems }, use) => {
    const open: BrowserContext[] = [];
    await use(async (email) => {
      const ctx = await openBrowser(browser, problems);
      open.push(ctx);
      const page = await ctx.newPage();
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: /Email me a code/ }).click();
      // No email service is connected in the sandbox, so demo mode shows the code on the screen.
      const notice = page.getByText(/Your code is/);
      await expect(notice).toBeVisible();
      await page.getByLabel("Sign-in code").fill(((await notice.textContent()) ?? "").match(/\d{6}/)?.[0] ?? "");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/home", { timeout: 30_000 });
      return page;
    });
    for (const ctx of open) await ctx.close();
  },
});

/** The event the app treats as current: the first published one that has not finished, by the track's calendar. */
function currentEvent() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const [row] = sql(`select id, name, start_date from events where status = 'published' and end_date >= '${today}' order by start_date limit 1`);
  return { id: row[0], name: row[1], start: row[2] };
}

/** Today's date as the app prints it for the track ("Nov 16, 2026"). */
const todayAtTrack = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(new Date());

// After a link is followed, the app keeps the screen the person came from in the page, hidden. These
// two read only the text that is actually on screen, so a check is never satisfied (or tripped) by it.
const shows = (page: Page, text: string | RegExp) => expect(page.getByRole("main")).toContainText(text, { useInnerText: true, ignoreCase: true });
const hides = (page: Page, text: string | RegExp) => expect(page.getByRole("main")).not.toContainText(text, { useInnerText: true, ignoreCase: true });

/** The confirmation that pops up at the bottom of the screen after an action (it stays for about three seconds). */
const confirmation = (page: Page, text: string) => page.locator('[aria-live="polite"]').getByText(text, { exact: true }).last();
const confirmed = (page: Page, text: string) => expect(confirmation(page, text), `the confirmation "${text}"`).toBeVisible();

/** The open dialog (a centred sheet on desktop, a bottom sheet on a phone). */
const sheet = (page: Page) => page.getByRole("dialog");

/** A titled block of a page ("Students", "Instructors", "History"). */
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

// ───── the pairing page

/** One of the four numbers at the top of the pairing page. */
const stat = (page: Page, label: string) => page.getByRole("main").getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
const count = async (page: Page, label: string) => Number((await stat(page, label).innerText()).trim());

/** A driver's row in the Students list, and an instructor's card beside it. */
const studentRow = (page: Page, name: string) => page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });
const instructorCard = studentRow;

/** The instructor picker on a driver's row, and the name it currently shows. */
const picker = (page: Page, student: string) => page.getByLabel(`Instructor for ${student}`);
const paired = (page: Page, student: string) => picker(page, student).locator("option:checked");

/** Pick an instructor for a driver (or "No instructor"), and wait for the list to show it. */
async function pair(page: Page, student: string, instructor: string | null) {
  const select = picker(page, student);
  if (instructor) await select.selectOption((await select.locator("option", { hasText: instructor }).getAttribute("value"))!);
  else await select.selectOption({ label: "No instructor" });
  await expect(paired(page, student)).toContainText(instructor ?? "No instructor");
  await expect(select).toBeEnabled();
}

/** The warning for two students of one instructor who share a session, in either order of their names. */
const TOGETHER_SUNDAY = (a: string, b: string) => new RegExp(`(${a} and ${b}|${b} and ${a}) are on track at the same time: Sun 3:10 PM, Green and Blue\\.`);
/** Any double-booking warning on the pairing page. */
const DOUBLE_BOOKED = /are on track at the same time|No session is free to ride with/;

/** A driver's "Your instructor" card on the Now screen. */
const instructorPanel = (page: Page) => page.getByRole("heading", { name: "Your instructor", exact: true }).locator("xpath=..");
const GRID = /Meet at the (false )?grid ten minutes before each of your sessions\./;

// ───── the promotions page

/** A recommendation that is waiting for sign-off, and a decided one in the history list. */
const waiting = (page: Page, driver: string) => page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("button", { name: "Approve" }) }).filter({ hasText: driver });
const decided = (page: Page, text: string) => block(page, "History").getByRole("listitem").filter({ hasText: text });

/** Make sure a recommendation from Rosalind is waiting for one of her students: she sends one if there is none. */
async function recommendIfNoneWaiting(rosalind: Page, studentId: string, kind: "group" | "solo", rationale: string) {
  if (val(`select count(*) from promotions where user_id = '${studentId}' and status = 'proposed'`) !== "0") return;
  await rosalind.goto(`/instructor/${studentId}`);
  await rosalind.getByRole("button", { name: "Recommend" }).click();
  if (kind === "solo") await sheet(rosalind).getByRole("radio", { name: /Sign off to drive solo/ }).check();
  await sheet(rosalind).getByLabel(/^Your rationale/).fill(rationale);
  await send(rosalind, sheet(rosalind).getByRole("button", { name: "Send for sign-off" }));
}

test.describe("instructor pairing", () => {
  test("the numbers at the top match who needs an instructor, who is unpaired and which instructors are free", async ({ as }) => {
    const page = await as("marian");
    const event = currentEvent();

    // Marian instructs too. With nobody paired with her yet, her My students points her at the pairing page.
    await page.goto("/instructor");
    await shows(page, "No students assigned to you yet");
    await page.getByRole("link", { name: "Open instructor pairing" }).click();
    await expect(page).toHaveURL(/\/admin\/instructors$/);
    await expect(page.getByRole("heading", { level: 1, name: "Instructor pairing" })).toBeVisible();
    // As an administrator she can open any driver's instructor page, paired with her or not.
    await page.goto(`/instructor/${idOf(HOLLY)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Holly Pruitt" })).toBeVisible();

    await page.goto("/home");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Instructor pairing" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Instructor pairing" })).toBeVisible();
    await shows(page, "Pairing someone alerts both people.");

    // What the lists on the page say.
    const pickers = page.getByRole("main").getByRole("combobox", { name: /^Instructor for / });
    const rows = await pickers.count();
    const soloNow = await page.getByRole("main").getByText("Solo now", { exact: true }).count();
    const unpaired = await pickers.evaluateAll((els) => els.filter((el) => (el as HTMLSelectElement).value === "").length);
    const cards = block(page, "Instructors").locator(":scope > ul > li");
    const instructors = await cards.count();
    const free = await cards.filter({ has: page.getByText("Free", { exact: true }) }).count();
    expect(rows, "drivers on the Students list").toBeGreaterThan(0);

    await expect(stat(page, "Need an instructor")).toHaveText(String(rows - soloNow));
    await expect(stat(page, "Not paired yet")).toHaveText(String(unpaired));
    await expect(stat(page, "Instructors here")).toHaveText(String(instructors));
    await expect(stat(page, "Instructors free")).toHaveText(String(free));

    // The same numbers worked out from the roster: instructed groups, Blue drivers not yet solo, and
    // solo drivers with a ride-along or check-in; instructors are those instructing at this event.
    const needs = `from registrations r join run_groups g on g.id = r.run_group_id
      where r.event_id = '${event.id}' and r.status <> 'cancelled' and not r.is_instructor
        and (g.instructor_policy = 'required' or (g.instructor_policy = 'optional' and not r.solo) or r.instructor_request in ('ride_along', 'check_in'))`;
    const hasInstructor = `exists (select 1 from instructor_assignments a where a.event_id = r.event_id and a.student_id = r.user_id)`;
    const teaching = `from registrations r where r.event_id = '${event.id}' and r.status <> 'cancelled' and r.is_instructor`;
    await expect(stat(page, "Need an instructor")).toHaveText(val(`select count(*) ${needs}`));
    await expect(stat(page, "Not paired yet")).toHaveText(val(`select count(*) ${needs} and not ${hasInstructor}`));
    await expect(stat(page, "Instructors here")).toHaveText(val(`select count(*) ${teaching}`));
    await expect(stat(page, "Instructors free")).toHaveText(val(`select count(*) ${teaching} and not exists (select 1 from instructor_assignments a where a.event_id = r.event_id and a.instructor_id = r.user_id)`));

    // Each row says who the driver is and why they are on the list.
    const holly = studentRow(page, "Holly Pruitt");
    await expect(holly).toContainText("2021 Mazda MX-5 Miata · first day only");
    await expect(holly.getByText("Green", { exact: true })).toBeVisible();
    await expect(holly.getByLabel("Car number 55")).toBeVisible();
    await expect(studentRow(page, "Luis Carvalho")).toContainText("second day only");
    const wendell = studentRow(page, "Wendell Park");
    await expect(wendell.getByText("Check-in", { exact: true })).toBeVisible();
    await expect(wendell).toContainText("“Ride one session and watch traffic awareness in the longer White passing zone.”");
    await expect(paired(page, "Wendell Park")).toContainText("Rosalind Achterberg");
    const keiko = studentRow(page, "Keiko Tanabe");
    await expect(keiko.getByText("Asked for a ride-along", { exact: true })).toBeVisible();
    await expect(keiko).toContainText("“I would like a second opinion on my line through Turns 4 and 5, and on braking into Turn 1.”");

    // An instructor's card lists their students, and the picker warns before two students in one run group share an instructor.
    const rosalind = instructorCard(page, "Rosalind Achterberg");
    for (const name of ["Owen Gallagher", "Simone Baptiste", "Wendell Park"]) await expect(rosalind).toContainText(name);
    const hers = await rosalind.getByRole("listitem").count();
    await expect(rosalind).toContainText(`${hers} students`);
    await expect(picker(page, "Holly Pruitt").locator("option", { hasText: "Rosalind Achterberg" })).toContainText("same group clash");
    await expect(picker(page, "Holly Pruitt").locator("option", { hasText: "Rafael Montoya" })).toHaveText("Rafael Montoya · free");

    // A clash is judged from the schedule, not from run-group names. Rosalind's Green and Blue Instructed
    // students are in different groups, but Sunday's last student session puts both groups on track together,
    // so she is flagged: on her card and at the top of the page, with the session named.
    await expect(rosalind).toContainText(TOGETHER_SUNDAY("Owen Gallagher", "Simone Baptiste"));
    const flagged = page.getByRole("main").getByRole("listitem").filter({ hasText: "Rosalind Achterberg:" });
    await expect(flagged).toContainText(TOGETHER_SUNDAY("Owen Gallagher", "Simone Baptiste"));
    await expect(page.getByRole("main").getByText(/^\d+ instructors? cannot be with every student who needs them$/)).toBeVisible();
    // Wendell's check-in needs only one session, and his White sessions are all free, so it is not a clash.
    await expect(rosalind).not.toContainText("No session is free");
    // The picker says so before anyone chooses: Calvin has a Green student, and Theo is Blue Instructed.
    await expect(picker(page, "Theo Marchetti").locator("option", { hasText: "Calvin Oduya" })).toContainText("clash Sun 3:10 PM");
    await expect(instructorCard(page, "Rafael Montoya").getByText("Free", { exact: true })).toBeVisible();
  });

  test("pairing a driver tells both people; changing it moves the student; No instructor ends it", async ({ as, person }) => {
    const marian = await as("marian");
    await marian.goto("/admin/instructors");
    await expect(paired(marian, "Holly Pruitt")).toHaveText("No instructor");
    const unpaired = await count(marian, "Not paired yet");
    const free = await count(marian, "Instructors free");

    // Pair Holly, a novice, with an instructor who has nobody yet.
    await pair(marian, "Holly Pruitt", "Rafael Montoya");
    await confirmed(marian, "Paired, and both have been told");
    await expect(stat(marian, "Not paired yet")).toHaveText(String(unpaired - 1));
    await expect(stat(marian, "Instructors free")).toHaveText(String(free - 1));
    const rafaelCard = instructorCard(marian, "Rafael Montoya");
    await expect(rafaelCard).toContainText("1 student");
    await expect(rafaelCard).toContainText("Holly Pruitt");

    // Holly is told who her instructor is and where to meet, and her Now screen shows how to find him.
    const holly = await person(HOLLY);
    const hollyAlert = await alertRow(holly, "Your instructor is Rafael Montoya");
    await expect(hollyAlert).toContainText("Meet at the grid ten minutes before each of your sessions. Their car and phone number are on your Now screen.");
    await expect(hollyAlert).toContainText("Instructor pairing");
    await hollyAlert.getByRole("button").click();
    await expect(holly).toHaveURL(/\/home$/);
    await expect(instructorPanel(holly)).toContainText("Rafael Montoya");
    await expect(instructorPanel(holly)).toContainText("2020 BMW M2 Competition");
    await expect(instructorPanel(holly).getByLabel("Car number 27")).toBeVisible();
    await expect(instructorPanel(holly).getByRole("link", { name: /\(912\) 555-01\d\d/ })).toHaveAttribute("href", /^tel:\d{10}$/);
    await expect(instructorPanel(holly)).toContainText(GRID);

    // Rafael is told he has a new student, and finds her under My students.
    const rafael = await person(RAFAEL);
    const rafaelAlert = await alertRow(rafael, "New student: Holly Pruitt");
    await expect(rafaelAlert).toContainText("Their car, run group and session times are under My students.");
    await rafaelAlert.getByRole("button").click();
    await expect(rafael).toHaveURL(/\/instructor$/);
    const hollyCard = rafael.getByRole("main").getByRole("link", { name: /^Holly Pruitt/ }).locator("xpath=..");
    await expect(hollyCard).toContainText("2021 Mazda MX-5 Miata");
    await expect(hollyCard.getByText("Instructed", { exact: true })).toBeVisible();
    await expect(hollyCard).toContainText("1 track day");

    // Marian changes her mind: Holly goes to Dale instead. The cards and both Now screens follow.
    await pair(marian, "Holly Pruitt", "Dale Whitfield");
    await expect(rafaelCard.getByText("Free", { exact: true })).toBeVisible();
    await expect(rafaelCard).not.toContainText("Holly Pruitt");
    await expect(instructorCard(marian, "Dale Whitfield")).toContainText("Holly Pruitt");
    await expect(stat(marian, "Not paired yet")).toHaveText(String(unpaired - 1));
    await alertRow(holly, "Your instructor is Dale Whitfield");
    await holly.goto("/home");
    await expect(instructorPanel(holly)).toContainText("Dale Whitfield");
    await expect(instructorPanel(holly)).not.toContainText("Rafael Montoya");
    await rafael.goto("/instructor");
    await shows(rafael, "No students assigned to you yet");
    const dale = await person(DALE);
    await alertRow(dale, "New student: Holly Pruitt");

    // Pairing her with an instructor who already has a Green student is allowed, but flagged: in the
    // picker before Marian chooses, and on the instructor's card afterwards.
    const calvinCard = instructorCard(marian, "Calvin Oduya");
    await expect(calvinCard).toContainText("Claire Whitaker");
    await expect(calvinCard).not.toContainText("in the same run group");
    await expect(picker(marian, "Holly Pruitt").locator("option", { hasText: "Calvin Oduya" })).toContainText("same group clash");
    await pair(marian, "Holly Pruitt", "Calvin Oduya");
    // The confirmation says what to check, so a double booking made by hand is never silent.
    await expect(marian.locator('[aria-live="polite"]').getByText(/^Paired, and both have been told\. Check this: .+ are in the same run group, so they are on track at the same time\.$/).last()).toBeVisible();
    await expect(calvinCard).toContainText("2 students");
    await expect(calvinCard).toContainText(/(Claire Whitaker and Holly Pruitt|Holly Pruitt and Claire Whitaker) are in the same run group, so they are on track at the same time\./);

    // "No instructor" ends the pairing: she is back among the unpaired, and her Now screen says so.
    await pair(marian, "Holly Pruitt", null);
    await confirmed(marian, "Pairing removed");
    await expect(stat(marian, "Not paired yet")).toHaveText(String(unpaired));
    await expect(calvinCard).not.toContainText("Holly Pruitt");
    await expect(calvinCard).not.toContainText("in the same run group");
    await holly.goto("/home");
    await expect(instructorPanel(holly)).toContainText("Not paired yet. The Chief Driving Instructor assigns instructors before the drivers meeting, and you will get an alert when yours is set.");
  });

  test("Pair the rest for me gives every waiting driver an instructor without double-booking anyone", async ({ as, person }) => {
    const marian = await as("marian");
    await marian.goto("/admin/instructors");
    const waitingNow = await count(marian, "Not paired yet");
    expect(waitingNow, "drivers waiting for an instructor (Holly at least)").toBeGreaterThan(0);
    await expect(paired(marian, "Holly Pruitt")).toHaveText("No instructor");
    // Every double booking on the page, whether two students share a run group or only one combined session.
    const clashesBefore = await marian.getByRole("main").getByText(DOUBLE_BOOKED).count();

    const asked: string[] = [];
    marian.on("dialog", (d) => asked.push(d.message()));
    await marian.getByRole("button", { name: "Pair the rest for me" }).click();
    await confirmed(marian, `${waitingNow} paired`);
    expect(asked).toEqual([`Pair the ${waitingNow} driver${waitingNow === 1 ? "" : "s"} without an instructor automatically? You can change any pairing afterwards.`]);

    // Nobody is left waiting, so the button has nothing more to do and goes away.
    await expect(stat(marian, "Not paired yet")).toHaveText("0");
    await expect(marian.getByRole("button", { name: "Pair the rest for me" })).toHaveCount(0);
    const pickers = marian.getByRole("main").getByRole("combobox", { name: /^Instructor for / });
    expect(await pickers.evaluateAll((els) => els.filter((el) => (el as HTMLSelectElement).value === "").length)).toBe(0);
    // It did not give any instructor two students who are on track at the same time.
    await expect(marian.getByRole("main").getByText(DOUBLE_BOOKED)).toHaveCount(clashesBefore);

    // Holly's new instructor: named in her file, told about her, and she is told about them.
    const instructor = ((await paired(marian, "Holly Pruitt").textContent()) ?? "").split(" · ")[0];
    expect(instructor).not.toBe("No instructor");
    const theirCard = instructorCard(marian, instructor);
    await expect(theirCard).toContainText("Holly Pruitt");
    expect(await theirCard.getByRole("listitem").count(), "students with Holly's instructor").toBeLessThanOrEqual(2);
    await marian.goto(`/admin/roster/${idOf(HOLLY)}`);
    await shows(marian, new RegExp(`Instructor\\s+${instructor}`));
    const holly = await person(HOLLY);
    const hollyAlert = await alertRow(holly, `Your instructor is ${instructor}`);
    await expect(hollyAlert).toContainText("Meet at the grid ten minutes before each of your sessions.");
    const theirs = await person(emailOf(instructor));
    await alertRow(theirs, "New student: Holly Pruitt");
    await theirs.goto("/instructor");
    await expect(theirs.getByRole("main").getByRole("link", { name: /^Holly Pruitt/ })).toBeVisible();
  });

  test("a solo driver's ride-along request joins the list, is paired with ride-along wording, and can be removed or withdrawn", async ({ as, person }) => {
    const marian = await as("marian");
    await marian.goto("/admin/instructors");
    const need = await count(marian, "Need an instructor");
    const unpaired = await count(marian, "Not paired yet");
    await expect(studentRow(marian, "Fiona Castellan")).toHaveCount(0);

    // Fiona drives solo in White and asks for an instructor from her Now screen.
    const fiona = await person(FIONA);
    await shows(fiona, "You drive solo in White.");
    await fiona.getByRole("button", { name: "Ask for an instructor" }).click();
    await sheet(fiona).getByLabel(/^What would you like to work on/).fill(RIDE_NOTE);
    await send(fiona, sheet(fiona).getByRole("button", { name: "Send request" }));
    await expect(instructorPanel(fiona)).toContainText("You asked for an instructor to ride along. Not paired yet; you will get an alert when one is assigned.");

    // Marian is alerted, and the alert opens the pairing page with Fiona on the list and her note.
    const request = await alertRow(marian, "Fiona Castellan asked for an instructor");
    await expect(request).toContainText(`White driver, ride-along request: “${RIDE_NOTE}”`);
    await request.getByRole("button").click();
    await expect(marian).toHaveURL(/\/admin\/instructors$/);
    const row = studentRow(marian, "Fiona Castellan");
    await expect(row.getByText("Asked for a ride-along", { exact: true })).toBeVisible();
    await expect(row).toContainText(`“${RIDE_NOTE}”`);
    await expect(row.getByText("White", { exact: true })).toBeVisible();
    await expect(paired(marian, "Fiona Castellan")).toHaveText("No instructor");
    await expect(stat(marian, "Need an instructor")).toHaveText(String(need + 1));
    await expect(stat(marian, "Not paired yet")).toHaveText(String(unpaired + 1));

    // Pairing her says "ride along" to both sides, not "your instructor" or "new student".
    await pair(marian, "Fiona Castellan", "Rafael Montoya");
    await confirmed(marian, "Paired, and both have been told");
    await expect(stat(marian, "Not paired yet")).toHaveText(String(unpaired));
    const told = await alertRow(fiona, "Rafael Montoya will ride along with you");
    await expect(told).toContainText("Meet at the grid ten minutes before each of your sessions. Their car and phone number are on your Now screen.");
    await hides(fiona, "Your instructor is");
    await fiona.goto("/home");
    await expect(instructorPanel(fiona)).toContainText("Rafael Montoya");
    await expect(instructorPanel(fiona)).toContainText("Riding along at your request.");
    await expect(instructorPanel(fiona)).toContainText(GRID);

    const rafael = await person(RAFAEL);
    const rideAlong = await alertRow(rafael, "Ride-along: Fiona Castellan");
    await expect(rideAlong).toContainText("A solo driver asked for an instructor. What they want to work on is under My students.");
    await rafael.goto("/instructor");
    const fionaCard = rafael.getByRole("main").getByRole("link", { name: /^Fiona Castellan/ }).locator("xpath=..");
    await expect(fionaCard.getByText("Ride-along", { exact: true })).toBeVisible();
    await expect(fionaCard).toContainText(`“${RIDE_NOTE}”`);

    // Marian takes the request off the list: she is warned the pairing goes too, and the instructor is told.
    await marian.goto("/admin/instructors");
    const asked: string[] = [];
    marian.on("dialog", (d) => asked.push(d.message()));
    await row.getByRole("button", { name: "Remove" }).click();
    await confirmed(marian, "Removed");
    expect(asked).toEqual(["Take Fiona Castellan off the list? Their pairing is removed and the instructor is told."]);
    await expect(row).toHaveCount(0);
    await expect(stat(marian, "Need an instructor")).toHaveText(String(need));
    await expect(stat(marian, "Not paired yet")).toHaveText(String(unpaired));
    await expect(instructorCard(marian, "Rafael Montoya")).not.toContainText("Fiona Castellan");
    const ended = await alertRow(rafael, "Fiona Castellan is off your student list");
    await expect(ended).toContainText("The administrators ended the ride-along.");
    await rafael.goto("/instructor");
    await expect(rafael.getByRole("heading", { level: 1, name: "My students" })).toBeVisible();
    await expect(rafael.getByRole("main").getByRole("link", { name: /^Fiona Castellan/ })).toHaveCount(0);
    // Fiona is solo again, and can ask another time.
    await fiona.goto("/home");
    await expect(fiona.getByRole("heading", { name: "Your instructor", exact: true })).toHaveCount(0);

    // She does, this time without saying what she wants to work on. Marian's alert and the list say so plainly.
    await fiona.getByRole("button", { name: "Ask for an instructor" }).click();
    await send(fiona, sheet(fiona).getByRole("button", { name: "Send request" }));
    await expect(instructorPanel(fiona)).toContainText("You asked for an instructor to ride along.");
    const second = await alertRow(marian, "Fiona Castellan asked for an instructor");
    await expect(second).toContainText("White driver asking for an instructor to ride along.");
    await marian.goto("/admin/instructors");
    await expect(row.getByText("Asked for a ride-along", { exact: true })).toBeVisible();
    await expect(row, "no note was written, so none is shown").not.toContainText("“");
    await pair(marian, "Fiona Castellan", "Rafael Montoya");
    await rafael.goto(`/instructor/${idOf(FIONA)}`);
    await expect(rafael.getByRole("heading", { level: 1, name: "Fiona Castellan" })).toBeVisible();
    await shows(rafael, "Fiona drives solo and asked for an instructor to ride along");
    await shows(rafael, "They did not say what they want to work on. Ask when you meet.");

    // This time Fiona withdraws it herself. She is warned her instructor will be told, and he is.
    await fiona.goto("/home");
    await expect(instructorPanel(fiona)).toContainText("Rafael Montoya");
    const warned: string[] = [];
    fiona.on("dialog", (d) => warned.push(d.message()));
    await fiona.getByRole("button", { name: "Withdraw request" }).click();
    await confirmed(fiona, "Request withdrawn");
    expect(warned).toEqual(["Withdraw your request? Your instructor will be told you no longer need a ride-along."]);
    await expect(fiona.getByRole("button", { name: "Ask for an instructor" })).toBeVisible();
    const withdrawn = await alertRow(rafael, "Fiona Castellan no longer needs a ride-along");
    await expect(withdrawn).toContainText("They withdrew their request, so they are off your student list.");
    await marian.goto("/admin/instructors");
    await expect(marian.getByRole("heading", { level: 1, name: "Instructor pairing" })).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(stat(marian, "Need an instructor")).toHaveText(String(need));
    await expect(instructorCard(marian, "Rafael Montoya")).not.toContainText("Fiona Castellan");
  });

  test("a check-in for a solo driver carries a private note the instructor sees and the driver never does", async ({ as, person }) => {
    const marian = await as("marian");
    await marian.goto("/admin/instructors");
    const need = await count(marian, "Need an instructor");
    const unpaired = await count(marian, "Not paired yet");

    // Only solo drivers who are not already on the list are offered.
    await marian.getByRole("button", { name: "Add a check-in" }).click();
    const form = sheet(marian);
    await expect(form).toContainText("For a solo driver you would like an instructor to ride with at this event.");
    await expect(form).toContainText("Only administrators and the instructor see this. The driver is told an instructor will check in with them, not why.");
    const offered = (await form.getByLabel(/^Driver/).locator("option").allTextContents()).join("\n");
    for (const name of ["Elena Vasquez · Black · #73", "Greg Thibodeaux · White · #396", "Joanna Kessler · Blue · #909"]) expect(offered).toContain(name);
    for (const name of ["Owen Gallagher", "Theo Marchetti", "Wendell Park", "Rosalind Achterberg"]) expect(offered, `${name} is not a solo driver waiting to be added`).not.toContain(name);

    await form.getByLabel(/^Driver/).selectOption({ label: "Elena Vasquez · Black · #73" });
    await form.getByLabel(/^What should the instructor look at/).fill(CHECK_NOTE);
    await form.getByRole("button", { name: "Add to the pairing list" }).click();
    await confirmed(marian, "Added. Pick an instructor for them in the list.");
    await expect(form).toHaveCount(0);

    // Elena joins the list as a check-in, not yet paired.
    const row = studentRow(marian, "Elena Vasquez");
    await expect(row.getByText("Check-in", { exact: true })).toBeVisible();
    await expect(row.getByText("Black", { exact: true })).toBeVisible();
    await expect(row).toContainText(`“${CHECK_NOTE}”`);
    await expect(paired(marian, "Elena Vasquez")).toHaveText("No instructor");
    await expect(stat(marian, "Need an instructor")).toHaveText(String(need + 1));
    await expect(stat(marian, "Not paired yet")).toHaveText(String(unpaired + 1));
    // She cannot be added twice.
    await marian.getByRole("button", { name: "Add a check-in" }).click();
    expect((await sheet(marian).getByLabel(/^Driver/).locator("option").allTextContents()).join("\n")).not.toContain("Elena Vasquez");
    await sheet(marian).getByRole("button", { name: "Close" }).click();

    // Until she is paired Elena gets no alert; her Now screen says an instructor will check in, and it is not hers to withdraw.
    const elena = await person(ELENA);
    await expect(instructorPanel(elena)).toContainText("The administrators have asked for an instructor to check in with you at this event. You will get an alert when one is assigned.");
    await expect(elena.getByRole("button", { name: "Withdraw request" })).toHaveCount(0);
    await elena.goto("/alerts");
    await expect(elena.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
    await hides(elena, "check in with you");

    // Pairing her uses check-in wording for both sides.
    await pair(marian, "Elena Vasquez", "Dale Whitfield");
    await confirmed(marian, "Paired, and both have been told");
    const told = await alertRow(elena, "Dale Whitfield will check in with you");
    await expect(told).toContainText("The administrators have asked an instructor to ride with you at this event. Their car and phone number are on your Now screen.");
    await hides(elena, "late point-bys");
    await elena.goto("/home");
    await expect(instructorPanel(elena)).toContainText("Dale Whitfield");
    await expect(instructorPanel(elena)).toContainText("The administrators have asked them to check in with you at this event.");
    await expect(instructorPanel(elena)).toContainText(GRID);
    await hides(elena, "late point-bys");
    await elena.goto("/me");
    await expect(elena.getByRole("heading", { level: 1, name: "Profile and car" })).toBeVisible();
    await hides(elena, "late point-bys");

    // Dale is told it is a check-in and where the note is, and reads it under My students.
    const dale = await person(DALE);
    const checkIn = await alertRow(dale, "Check-in: Elena Vasquez");
    await expect(checkIn).toContainText("The administrators asked for a check-in with this solo driver. Their note is under My students.");
    await checkIn.getByRole("button").click();
    await expect(dale).toHaveURL(/\/instructor$/);
    const elenaCard = dale.getByRole("main").getByRole("link", { name: /^Elena Vasquez/ }).locator("xpath=..");
    await expect(elenaCard.getByText("Solo", { exact: true })).toBeVisible();
    await expect(elenaCard.getByText("Check-in", { exact: true })).toBeVisible();
    await expect(elenaCard).toContainText("Elena drives solo. The administrators asked for a check-in.");
    await expect(elenaCard).toContainText(`“${CHECK_NOTE}”`);
    // Black is the top student group and she is already solo, so there is nothing for him to recommend.
    await elenaCard.getByRole("button", { name: "Recommend" }).click();
    await expect(sheet(dale)).toContainText("There is nothing to recommend: Elena already drives solo in the highest student group.");
    await expect(sheet(dale).getByRole("button", { name: "Send for sign-off" })).toHaveCount(0);

    // A check-in added by mistake comes straight off again: nobody is paired yet, so there is nothing to warn about.
    await marian.goto("/admin/instructors");
    await marian.getByRole("button", { name: "Add a check-in" }).click();
    await sheet(marian).getByLabel(/^Driver/).selectOption({ label: "Greg Thibodeaux · White · #396" });
    await sheet(marian).getByRole("button", { name: "Add to the pairing list" }).click();
    const mistake = studentRow(marian, "Greg Thibodeaux");
    await expect(mistake.getByText("Check-in", { exact: true })).toBeVisible();
    await expect(mistake, "no note was written, so none is shown").not.toContainText("“");
    const asked: string[] = [];
    marian.on("dialog", (d) => asked.push(d.message()));
    await mistake.getByRole("button", { name: "Remove" }).click();
    await confirmed(marian, "Removed");
    expect(asked, "no warning for an unpaired request").toEqual([]);
    await expect(mistake).toHaveCount(0);
    await expect(stat(marian, "Need an instructor")).toHaveText(String(need + 1));
  });

  test("taking a check-in off the list ends the pairing and tells the instructor what ended", async ({ as, person }) => {
    const event = currentEvent();
    const state = sql(`select r.instructor_request, (select count(*) from instructor_assignments a where a.event_id = r.event_id and a.student_id = r.user_id) from registrations r where r.event_id = '${event.id}' and r.user_id = '${idOf(ELENA)}'`)[0];
    test.skip(state[0] !== "check_in" || state[1] !== "1", "needs Elena's paired check-in from the flow before this one");

    const marian = await as("marian");
    await marian.goto("/admin/instructors");
    const need = await count(marian, "Need an instructor");
    const row = studentRow(marian, "Elena Vasquez");
    const asked: string[] = [];
    marian.on("dialog", (d) => asked.push(d.message()));
    await row.getByRole("button", { name: "Remove" }).click();
    await confirmed(marian, "Removed");
    expect(asked).toEqual(["Take Elena Vasquez off the list? Their pairing is removed and the instructor is told."]);
    await expect(row).toHaveCount(0);
    await expect(stat(marian, "Need an instructor")).toHaveText(String(need - 1));
    await expect(instructorCard(marian, "Dale Whitfield")).not.toContainText("Elena Vasquez");

    // Elena is an ordinary solo driver again.
    const elena = await person(ELENA);
    await expect(elena.getByRole("button", { name: "Ask for an instructor" })).toBeVisible();
    await expect(elena.getByRole("heading", { name: "Your instructor", exact: true })).toHaveCount(0);

    // Dale is told Elena is off his list. It was a check-in the administrators set up, so the alert
    // should not describe it as a ride-along (which is something a driver asks for).
    const dale = await person(DALE);
    const ended = await alertRow(dale, "Elena Vasquez is off your student list");
    await dale.goto("/instructor");
    await expect(dale.getByRole("heading", { level: 1, name: "My students" })).toBeVisible();
    await expect(dale.getByRole("main").getByRole("link", { name: /^Elena Vasquez/ })).toHaveCount(0);
    await dale.goto("/alerts");
    await expect(ended, "the instructor's alert about an ended check-in").not.toContainText(/ride-along/i, { timeout: 2000 });
  });

  test("on a phone the pairing page fits the screen and a pairing can be changed with the picker", async ({ as }) => {
    const page = await as("marian", { phone: true });
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "More" }).click();
    await page.getByRole("main").getByRole("link", { name: "Instructor pairing" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Instructor pairing" })).toBeVisible();
    await expect(stat(page, "Need an instructor")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the page does not scroll sideways").toBe(true);

    // Holly's picker is a full-width control under her name; choosing another instructor works as on a desktop.
    const was = ((await paired(page, "Holly Pruitt").textContent()) ?? "").split(" · ")[0];
    const to = was === "Rafael Montoya" ? "Dale Whitfield" : "Rafael Montoya";
    await picker(page, "Holly Pruitt").scrollIntoViewIfNeeded();
    const box = (await picker(page, "Holly Pruitt").boundingBox())!;
    expect(box.x + box.width, "the picker is inside the screen").toBeLessThanOrEqual(375);
    expect(box.height, "the picker is tall enough to tap").toBeGreaterThanOrEqual(40);
    await pair(page, "Holly Pruitt", to);
    await confirmed(page, "Paired, and both have been told");
    await expect(confirmation(page, "Paired, and both have been told")).toBeInViewport();

    // The check-in form opens as a sheet no wider than the phone.
    await page.getByRole("button", { name: "Add a check-in" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Add a check-in" }).click();
    await expect(sheet(page).getByRole("heading", { name: "Add a check-in" })).toBeVisible();
    expect((await sheet(page).boundingBox())!.width).toBeLessThanOrEqual(375);
    await sheet(page).getByRole("button", { name: "Close" }).click();
    await expect(sheet(page)).toHaveCount(0);
  });
});

test.describe("promotions", () => {
  test("the sign-off list shows each waiting recommendation with the instructor's reasons and the driver's record", async ({ as }) => {
    const page = await as("marian");
    const event = currentEvent();
    const open = Number(val("select count(*) from promotions where status = 'proposed'"));

    // The Now screen and the menu both point at what is waiting.
    await expect(page.getByRole("link", { name: /Promotions\s*\d+\s*waiting on sign-off/ })).toContainText(String(open));
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Promotions/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Promotions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: `Waiting for sign-off · ${open}` })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "Approve" })).toHaveCount(open);
    await expect(page.getByRole("main").getByRole("button", { name: "Decline" })).toHaveCount(open);

    // Marcus: Green to Blue, with Noelle's reasons and what the region knows about him.
    const marcus = waiting(page, "Marcus Feldman");
    await expect(marcus).toHaveCount(1);
    await expect(marcus.getByText("Green", { exact: true })).toBeVisible();
    await expect(marcus.getByText("Blue", { exact: true })).toBeVisible();
    await expect(marcus).toContainText(/Recommended by\s*Noelle Fairbanks/);
    await expect(marcus).toContainText(`at ${event.name}`);
    await expect(marcus).toContainText("Fifth event. The hands have calmed down since the summer");
    await expect(marcus).toContainText("4 track days");
    await expect(marcus).toContainText(/\d+ events? with the region/);
    await expect(marcus).toContainText(/\d+ sessions? logged by instructors/);

    // Simone: a solo sign-off in Blue, from Rosalind.
    const simone = waiting(page, "Simone Baptiste");
    await expect(simone).toHaveCount(1);
    await expect(simone.getByText("Solo sign-off", { exact: true })).toBeVisible();
    await expect(simone).toContainText(/Recommended by\s*Rosalind Achterberg/);

    // Earlier decisions stay on file with who decided and why.
    const theo = decided(page, "Theo Marchetti · solo sign-off in Blue");
    await expect(theo.getByText("Declined", { exact: true })).toBeVisible();
    await expect(theo).toContainText(/Summer Driver Education · recommended by Gus Lindqvist · decided by Dale Whitfield on \w{3} \d{1,2}, \d{4}/);
    await expect(theo).toContainText("Not yet. Mirror checks were inconsistent on my check ride. Revisit in the fall.");
    const keiko = decided(page, "Keiko Tanabe · Blue to White");
    await expect(keiko.getByText("Approved", { exact: true })).toBeVisible();
    await expect(keiko).toContainText("Agreed. Rode with her Sunday afternoon.");

    // The driver's file is one tap away, and shows the same recommendation as waiting.
    await marcus.getByRole("link", { name: "Read the driver's file" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/roster/${idOf(MARCUS)}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Marcus Feldman" })).toBeVisible();
    const onFile = block(page, "Promotions").getByRole("listitem").filter({ hasText: "Green to Blue" });
    await expect(onFile).toContainText("Awaiting sign-off");
    await expect(onFile.getByRole("link", { name: "Review this recommendation" })).toHaveAttribute("href", "/admin/promotions");
  });

  test("an instructor or a driver cannot open the pairing or promotions pages, or use what is behind them", async ({ as }) => {
    const event = currentEvent();
    const rosalind = await as("rosalind");
    const simone = await as("simone");
    for (const [who, page] of [["an instructor", rosalind], ["a driver", simone]] as const) {
      const menu = page.getByRole("navigation", { name: "Main" });
      await expect(menu.getByRole("link", { name: "Now" })).toBeVisible();
      await expect(menu.getByRole("link", { name: "Instructor pairing" }), `${who} has no pairing link`).toHaveCount(0);
      await expect(menu.getByRole("link", { name: /^Promotions/ }), `${who} has no promotions link`).toHaveCount(0);
      for (const path of ["/admin/instructors", "/admin/promotions"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle").catch(() => {});
        expect(new URL(page.url()).pathname, `where ${who} lands from ${path}`).toBe("/home");
        await hides(page, /Waiting for sign-off|Not paired yet/);
      }
    }

    // Marian makes one real pairing change, so the request her browser sends can be repeated by the others.
    const marian = await as("marian");
    const calls = recordActions(marian);
    await marian.goto("/admin/instructors");
    const hollyWas = ((await paired(marian, "Holly Pruitt").textContent()) ?? "").split(" · ")[0];
    const hollyTo = hollyWas === "Rafael Montoya" ? "Dale Whitfield" : "Rafael Montoya";
    await pair(marian, "Holly Pruitt", hollyTo);
    expect(calls.length, "the pairing request was seen").toBe(1);
    const pairCall = calls[0];
    const holly = idOf(HOLLY);

    // The same request from Rosalind's and Simone's sessions, trying to move Holly to Rosalind, is turned away.
    for (const [who, page] of [["an instructor", rosalind], ["a driver", simone]] as const) {
      const res = await replay(page, pairCall, JSON.stringify([holly, userId("rosalind")]));
      expect(res.sentTo, `${who}'s pairing request is sent back to the Now screen`).toContain("/home");
    }
    await marian.reload();
    await expect(paired(marian, "Holly Pruitt")).toContainText(hollyTo);
    expect(val(`select count(*) from instructor_assignments where event_id = '${event.id}' and student_id = '${holly}' and instructor_id = '${userId("rosalind")}'`)).toBe("0");
    // From Marian's own session the repeated request does reach the pairing code, so the refusals above are real ones.
    const own = await replay(marian, pairCall, JSON.stringify([holly, holly]));
    expect(own.text).toContain("A driver cannot instruct themselves.");

    // Promotions: Marian starts to decline Marcus's recommendation with a reason too short to be accepted, so nothing is decided.
    await marian.goto("/admin/promotions");
    calls.length = 0;
    await waiting(marian, "Marcus Feldman").getByRole("button", { name: "Decline" }).click();
    await sheet(marian).getByLabel(/^Reason/).fill("no");
    await sheet(marian).getByRole("button", { name: "Decline recommendation" }).click();
    await expect(sheet(marian).getByRole("alert")).toHaveText("Say why, so the instructor and the driver's file have the reason.");
    expect(calls.length, "the decision request was seen").toBe(1);
    const decideCall = calls[0];
    expect(decideCall.body).toContain("decline");

    // Repeated as an approval from the other two sessions, it changes nothing.
    for (const [who, page] of [["an instructor", rosalind], ["a driver", simone]] as const) {
      const res = await replay(page, decideCall, decideCall.body.replace("decline", "approve"));
      expect(res.sentTo, `${who}'s sign-off request is sent back to the Now screen`).toContain("/home");
    }
    await marian.reload();
    await expect(waiting(marian, "Marcus Feldman")).toHaveCount(1);
    expect(val(`select status from promotions where user_id = '${idOf(MARCUS)}' and event_id = '${event.id}'`)).toBe("proposed");
    expect(val(`select g.key from memberships m join run_groups g on g.id = m.run_group_id where m.user_id = '${idOf(MARCUS)}'`)).toBe("green");
    const ownDecision = await replay(marian, decideCall, decideCall.body);
    expect(ownDecision.text).toContain("Say why, so the instructor");
  });

  test("approving from the next event leaves the driver in their group this weekend and tells driver and instructor", async ({ as, person }) => {
    const event = currentEvent();
    const marian = await as("marian");
    await marian.goto("/admin/promotions");
    await waiting(marian, "Marcus Feldman").getByRole("button", { name: "Approve" }).click();
    const form = sheet(marian);
    await expect(form.getByRole("heading", { name: "Approve" })).toBeVisible();
    await expect(form).toContainText("Marcus Feldman: Green to Blue.");
    await expect(form).toContainText("Goes to the driver and the instructor, and into the driver's file.");
    // Unless the box is ticked, the change waits for the driver's next event.
    const now = form.getByRole("checkbox", { name: new RegExp(`Apply at ${event.name} now`) });
    await expect(now).not.toBeChecked();
    await expect(form).toContainText("Otherwise it takes effect from the driver's next event.");
    await form.getByLabel(/^Note/).fill(LATER_NOTE);
    await send(marian, form.getByRole("button", { name: "Sign off" }));

    // It leaves the waiting list for the history, with who decided, when and the note.
    await expect(waiting(marian, "Marcus Feldman")).toHaveCount(0);
    await expect.soft(confirmation(marian, "Approved and recorded."), "the confirmation after signing off").toBeVisible({ timeout: 2500 });
    const record = decided(marian, "Marcus Feldman · Green to Blue");
    await expect(record.getByText("Approved", { exact: true })).toBeVisible();
    await expect(record).toContainText(`${event.name} · recommended by Noelle Fairbanks · decided by Marian Castellanos on ${todayAtTrack()}`);
    await expect(record).toContainText(LATER_NOTE);

    // Marcus is told, by alert and by email, that it starts at his next event. This weekend he is still Green and instructed.
    const marcus = await person(MARCUS);
    const promoted = await alertRow(marcus, "You have been promoted to Blue");
    await expect(promoted).toContainText(`This takes effect from your next event. Note from Marian: ${LATER_NOTE}`);
    await expect(promoted).toContainText("Promotion");
    await promoted.getByRole("button").click();
    await expect(marcus).toHaveURL(/\/me$/);
    await shows(marcus, "Instructed: an instructor rides with you every session.");
    const earned = marcus.getByRole("main").getByRole("listitem").filter({ hasText: `recommended by Noelle Fairbanks · approved ${todayAtTrack()}` });
    await expect(earned).toContainText(event.name);
    await expect(earned.getByText("Green", { exact: true })).toBeVisible();
    await expect(earned.getByText("Blue", { exact: true })).toBeVisible();
    expect(sql(`select status from message_log where user_id = '${idOf(MARCUS)}' and channel = 'email' and subject = 'You have been promoted to Blue'`), "the email to the driver (simulated in the sandbox)").toEqual([["simulated"]]);

    // Noelle is told her recommendation went through, and sees it on Marcus's page.
    const noelle = await person(NOELLE);
    const outcome = await alertRow(noelle, "Approved: your recommendation for promotion to Blue");
    await expect(outcome).toContainText(LATER_NOTE);
    await outcome.getByRole("button").click();
    await expect(noelle).toHaveURL(new RegExp(`/instructor/${idOf(MARCUS)}$`));
    const hers = block(noelle, "Promotions").getByRole("listitem").filter({ hasText: `Decision: ${LATER_NOTE}` });
    await expect(hers).toContainText("Green to Blue");
    await expect(hers.getByText("Approved", { exact: true })).toBeVisible();
    const header = noelle.locator("header").filter({ has: noelle.getByRole("heading", { level: 1 }) });
    await expect(header.getByText("Green", { exact: true })).toBeVisible();
    await expect(header.getByText("Instructed", { exact: true })).toBeVisible();

    // For Marian: still Green and still Noelle's student this weekend, while his standing group is now Blue.
    await marian.goto("/admin/instructors");
    const row = studentRow(marian, "Marcus Feldman");
    await expect(row.getByText("Green", { exact: true })).toBeVisible();
    await expect(row.getByText("Solo now", { exact: true })).toHaveCount(0);
    await expect(paired(marian, "Marcus Feldman")).toContainText("Noelle Fairbanks");
    await marian.goto(`/admin/roster/${idOf(MARCUS)}`);
    await shows(marian, /Run group\s+Green · instructed/);
    await marian.goto("/admin/promotions");
    await marian.getByRole("button", { name: "Change a driver's group" }).click();
    await sheet(marian).getByLabel(/^Driver/).selectOption({ label: "Feldman, Marcus" });
    await expect(sheet(marian)).toContainText("Currently Blue.");
  });

  test("declining needs a reason, which goes to the instructor and the driver's file but not to the driver", async ({ as }) => {
    const event = currentEvent();
    const wendell = idOf(WENDELL);
    const rosalind = await as("rosalind");
    await recommendIfNoneWaiting(rosalind, wendell, "group", BLACK_RATIONALE);
    const alertsBefore = val(`select count(*) from notifications where user_id = '${wendell}'`);

    const marian = await as("marian");
    await marian.goto("/admin/promotions");
    const openBefore = Number(((await marian.getByRole("heading", { name: /Waiting for sign-off/ }).textContent()) ?? "").match(/\d+/)?.[0]);
    await waiting(marian, "Wendell Park").getByRole("button", { name: "Decline" }).click();
    const form = sheet(marian);
    await expect(form.getByRole("heading", { name: "Decline" })).toBeVisible();
    await expect(form).toContainText("Wendell Park: White to Black.");
    await expect(form).toContainText("Goes to the instructor and into the driver's file. The driver is not notified of a decline.");
    await expect(form.getByRole("checkbox")).toHaveCount(0);

    // "No" is not a reason.
    await form.getByLabel(/^Reason/).fill("no");
    await form.getByRole("button", { name: "Decline recommendation" }).click();
    await expect(form.getByRole("alert")).toHaveText("Say why, so the instructor and the driver's file have the reason.");
    await form.getByLabel(/^Reason/).fill(DECLINE_REASON);
    await send(marian, form.getByRole("button", { name: "Decline recommendation" }));

    await expect(waiting(marian, "Wendell Park")).toHaveCount(0);
    await expect.soft(confirmation(marian, "Declined and recorded"), "the confirmation after declining").toBeVisible({ timeout: 2500 });
    await expect(marian.getByRole("heading", { name: `Waiting for sign-off · ${openBefore - 1}` })).toBeVisible();
    const record = decided(marian, "Wendell Park · White to Black").filter({ hasText: DECLINE_REASON });
    await expect(record.getByText("Declined", { exact: true })).toBeVisible();
    await expect(record).toContainText(`${event.name} · recommended by Rosalind Achterberg · decided by Marian Castellanos on ${todayAtTrack()}`);

    // The driver's file keeps the decision and the reason.
    await marian.goto(`/admin/roster/${wendell}`);
    const onFile = block(marian, "Promotions").getByRole("listitem").filter({ hasText: DECLINE_REASON });
    await expect(onFile).toContainText("White to Black");
    await expect(onFile).toContainText(`Declined by Marian Castellanos on ${todayAtTrack()}: ${DECLINE_REASON}`);

    // Rosalind is told why, sees it on Wendell's page, and can recommend him again another time.
    const outcome = await alertRow(rosalind, "Declined: your recommendation for promotion to Black");
    await expect(outcome).toContainText(DECLINE_REASON);
    await outcome.getByRole("button").click();
    await expect(rosalind).toHaveURL(new RegExp(`/instructor/${wendell}$`));
    const hers = block(rosalind, "Promotions").getByRole("listitem").filter({ hasText: `Decision: ${DECLINE_REASON}` });
    await expect(hers.getByText("Declined", { exact: true })).toBeVisible();
    await rosalind.getByRole("button", { name: "Recommend" }).click();
    await expect(sheet(rosalind).getByRole("radio", { name: /Promote to Black/ })).toBeVisible();

    // Wendell hears nothing and stays in White.
    expect(val(`select count(*) from notifications where user_id = '${wendell}'`), "alerts to the driver after a decline").toBe(alertsBefore);
    expect(val(`select count(*) from message_log where user_id = '${wendell}' and kind = 'promotion'`), "emails to the driver about a decline").toBe("0");
    await marian.goto("/admin/instructors");
    await expect(studentRow(marian, "Wendell Park").getByText("White", { exact: true })).toBeVisible();
  });

  test("a solo sign-off applied now: the driver is solo at once, stays paired as Solo now, and Marian is told so", async ({ as }) => {
    const event = currentEvent();
    const rosalind = await as("rosalind");
    await recommendIfNoneWaiting(rosalind, userId("simone"), "solo", SOLO_RATIONALE);

    const marian = await as("marian");
    await marian.goto("/admin/instructors");
    const need = await count(marian, "Need an instructor");
    await expect(studentRow(marian, "Simone Baptiste").getByText("Solo now", { exact: true })).toHaveCount(0);
    await expect(paired(marian, "Simone Baptiste")).toContainText("Rosalind Achterberg");

    await marian.goto("/admin/promotions");
    await waiting(marian, "Simone Baptiste").getByRole("button", { name: "Approve" }).click();
    const form = sheet(marian);
    await expect(form).toContainText("Simone Baptiste: solo sign-off in Blue.");
    await form.getByLabel(/^Note/).fill(SOLO_NOTE);
    await form.getByRole("checkbox", { name: new RegExp(`Apply at ${event.name} now`) }).check();
    await send(marian, form.getByRole("button", { name: "Sign off" }));
    await expect(waiting(marian, "Simone Baptiste")).toHaveCount(0);
    // Simone is still paired with Rosalind, so the confirmation must tell Marian that and where to end it.
    await expect
      .soft(confirmation(marian, "Approved and recorded. They are still paired with an instructor: end it under Instructor pairing if they will drive alone."), "the approval message saying the driver is still paired")
      .toBeVisible({ timeout: 2500 });
    const record = decided(marian, "Simone Baptiste · solo sign-off in Blue").filter({ hasText: SOLO_NOTE });
    await expect(record.getByText("Approved", { exact: true })).toBeVisible();
    await expect(record).toContainText(`${event.name} · recommended by Rosalind Achterberg · decided by Marian Castellanos on ${todayAtTrack()}`);

    // On the pairing page she no longer counts as needing an instructor, but stays listed until Marian ends the pairing.
    await marian.goto("/admin/instructors");
    const row = studentRow(marian, "Simone Baptiste");
    await expect(row.getByText("Solo now", { exact: true })).toBeVisible();
    await expect(row).toContainText("No longer needs an instructor but is still paired. Choose “No instructor” to end the pairing.");
    await expect(paired(marian, "Simone Baptiste")).toContainText("Rosalind Achterberg");
    await expect(stat(marian, "Need an instructor")).toHaveText(String(need - 1));
    await expect(instructorCard(marian, "Rosalind Achterberg")).toContainText("Simone Baptiste");

    // Simone: told at once (alert and email), solo on her profile, and Rosalind is still her contact for the weekend.
    const simone = await as("simone");
    const signedOff = await alertRow(simone, "You are signed off to drive solo");
    await expect(signedOff).toContainText(`This takes effect now: check your schedule for your sessions. Note from Marian: ${SOLO_NOTE}`);
    await signedOff.getByRole("button").click();
    await expect(simone).toHaveURL(/\/schedule$/);
    await simone.goto("/me");
    await shows(simone, "Blue (Solo): signed off to drive without an instructor.");
    const earned = simone.getByRole("main").getByRole("listitem").filter({ hasText: "Signed off to drive solo" });
    await expect(earned).toContainText(`${event.name} · recommended by Rosalind Achterberg · approved ${todayAtTrack()}`);
    await simone.goto("/home");
    await expect(instructorPanel(simone)).toContainText("Rosalind Achterberg");
    await expect(instructorPanel(simone)).toContainText("You drive solo now. They are still your instructor contact at this event.");
    expect(sql(`select status from message_log where user_id = '${userId("simone")}' and channel = 'email' and subject = 'You are signed off to drive solo'`), "the email to the driver (simulated in the sandbox)").toEqual([["simulated"]]);

    // Rosalind: told it was approved, and Simone now shows as solo with nothing left to sign off in Blue.
    const outcome = await alertRow(rosalind, "Approved: your recommendation for solo sign-off");
    await expect(outcome).toContainText(SOLO_NOTE);
    await rosalind.goto("/instructor");
    const hers = rosalind.getByRole("main").getByRole("link", { name: /^Simone Baptiste/ }).locator("xpath=..");
    await expect(hers.getByText("Solo", { exact: true })).toBeVisible();
    await expect(hers.getByText("Instructed", { exact: true })).toHaveCount(0);
    await expect(hers.getByText("Recommended", { exact: true })).toHaveCount(0);
    await hers.getByRole("button", { name: "Recommend" }).click();
    await expect(sheet(rosalind).getByRole("radio")).toHaveCount(1);
    await expect(sheet(rosalind).getByRole("radio", { name: /Promote to White/ })).toBeVisible();

    // Marian ends the pairing with "No instructor": Simone leaves the list and Rosalind's card.
    await picker(marian, "Simone Baptiste").selectOption({ label: "No instructor" });
    await confirmed(marian, "Pairing removed");
    await expect(row).toHaveCount(0);
    await expect(instructorCard(marian, "Rosalind Achterberg")).not.toContainText("Simone Baptiste");
    await expect(stat(marian, "Need an instructor")).toHaveText(String(need - 1));
    await rosalind.goto("/instructor");
    await expect(rosalind.getByRole("heading", { level: 1, name: "My students" })).toBeVisible();
    await expect(rosalind.getByRole("main").getByRole("link", { name: /^Simone Baptiste/ })).toHaveCount(0);
    // Simone now drives alone, and like any solo driver can ask for a ride-along.
    await simone.goto("/home");
    await expect(simone.getByRole("button", { name: "Ask for an instructor" })).toBeVisible();
    await shows(simone, "You drive solo in Blue.");
    await expect(simone.getByRole("heading", { name: "Your instructor", exact: true })).toHaveCount(0);
  });

  test("Marian can change a driver's group herself: from the next event, or a solo sign-off that applies now", async ({ as, person }) => {
    const event = currentEvent();
    const marian = await as("marian");
    await marian.goto("/admin/promotions");

    // Joanna (Blue, solo) moves to White from her next event.
    await marian.getByRole("button", { name: "Change a driver's group" }).click();
    const form = sheet(marian);
    await expect(form).toContainText("For changes you are making yourself, without an instructor's recommendation. It is recorded in the driver's history with your name.");
    await form.getByLabel(/^Driver/).selectOption({ label: "Kessler, Joanna" });
    await expect(form).toContainText("Currently Blue.");
    // She already drives solo, so that choice is not available; instructors are not offered at all.
    await expect(form.getByLabel(/^Change/).locator("option", { hasText: "Sign off to drive solo" })).toHaveJSProperty("disabled", true);
    expect((await form.getByLabel(/^Driver/).locator("option").allTextContents()).join("\n")).not.toContain("Achterberg, Rosalind");
    const groups = (await form.getByLabel(/^New run group/).locator("option").allTextContents()).map((o) => o.trim());
    expect(groups, "groups she can be moved to").toContain("White");
    for (const not of ["Blue", "Red"]) expect(groups, "her own group and the instructor group are not offered").not.toContain(not);
    await form.getByLabel(/^New run group/).selectOption({ label: "White" });
    // A few words are not a reason for the record.
    const reason = form.getByLabel(/^Reason/);
    await reason.fill("Faster now.");
    await form.getByRole("button", { name: "Record the change" }).click();
    expect(await reason.evaluate((el: HTMLTextAreaElement) => el.validity.valid), "whether the form accepts a two-word reason").toBe(false);
    await reason.fill(MOVE_REASON);
    await form.getByRole("button", { name: "Record the change" }).click();
    await confirmed(marian, "Recorded.");
    await expect(form).toHaveCount(0);

    const moved = decided(marian, "Joanna Kessler · Blue to White");
    await expect(moved.getByText("Approved", { exact: true })).toBeVisible();
    await expect(moved).toContainText(`${event.name} · recommended by Marian Castellanos · decided by Marian Castellanos on ${todayAtTrack()}`);
    // The reason is kept in the driver's file.
    await marian.goto(`/admin/roster/${idOf(JOANNA)}`);
    const onFile = block(marian, "Promotions").getByRole("listitem").filter({ hasText: MOVE_REASON });
    await expect(onFile).toContainText("Blue to White");
    await expect(onFile).toContainText(`Signed off by Marian Castellanos on ${todayAtTrack()}`);
    await shows(marian, /Run group\s+Blue · solo/);

    // Joanna is told it starts next time; this weekend she is still in Blue.
    const joanna = await person(JOANNA);
    const told = await alertRow(joanna, "Your run group is now White");
    await expect(told).toContainText("This takes effect from your next event.");
    await told.getByRole("button").click();
    await expect(joanna).toHaveURL(/\/me$/);
    await shows(joanna, "Blue (Solo): signed off to drive without an instructor.");
    const earned = joanna.getByRole("main").getByRole("listitem").filter({ hasText: `recommended by Marian Castellanos · approved ${todayAtTrack()}` });
    await expect(earned.getByText("Blue", { exact: true })).toBeVisible();
    await expect(earned.getByText("White", { exact: true })).toBeVisible();

    // Maya (Blue, instructed, paired with Noelle) is signed off solo, applied at this event.
    await marian.goto("/admin/promotions");
    await marian.getByRole("button", { name: "Change a driver's group" }).click();
    await form.getByLabel(/^Driver/).selectOption({ label: "Lindholm, Maya" });
    await form.getByLabel(/^Change/).selectOption({ label: "Sign off to drive solo" });
    await expect(form.getByLabel(/^New run group/)).toHaveCount(0);
    await form.getByLabel(/^Reason/).fill(DIRECT_SOLO_REASON);
    await form.getByRole("checkbox", { name: new RegExp(`Apply at ${event.name} now`) }).check();
    await form.getByRole("button", { name: "Record the change" }).click();
    // She is still paired with Noelle, and Marian is told so.
    await confirmed(marian, "Recorded. They are still paired with an instructor: end it under Instructor pairing if they will drive alone.");
    await expect(decided(marian, "Maya Lindholm · solo sign-off in Blue").getByText("Approved", { exact: true })).toBeVisible();

    await marian.goto("/admin/instructors");
    const row = studentRow(marian, "Maya Lindholm");
    await expect(row.getByText("Solo now", { exact: true })).toBeVisible();
    await expect(paired(marian, "Maya Lindholm")).toContainText("Noelle Fairbanks");

    const maya = await person(MAYA);
    const signedOff = await alertRow(maya, "You are signed off to drive solo");
    await expect(signedOff).toContainText("This takes effect now: check your schedule for your sessions.");
    await maya.goto("/me");
    await shows(maya, "Blue (Solo): signed off to drive without an instructor.");
    await maya.goto("/home");
    await expect(instructorPanel(maya)).toContainText("Noelle Fairbanks");
    await expect(instructorPanel(maya)).toContainText("You drive solo now. They are still your instructor contact at this event.");

    // She cannot be signed off a second time.
    await marian.goto("/admin/promotions");
    await marian.getByRole("button", { name: "Change a driver's group" }).click();
    await form.getByLabel(/^Driver/).selectOption({ label: "Lindholm, Maya" });
    await expect(form.getByLabel(/^Change/).locator("option", { hasText: "Sign off to drive solo" })).toHaveJSProperty("disabled", true);
  });

  test("moving an instructed Blue driver up to White now makes him a solo driver on every screen", async ({ as, person }) => {
    const event = currentEvent();
    const theo = idOf(THEO);
    const marian = await as("marian");
    await marian.goto("/admin/instructors");
    await expect(paired(marian, "Theo Marchetti")).toContainText("Gus Lindqvist");
    await expect(studentRow(marian, "Theo Marchetti").getByText("Blue", { exact: true })).toBeVisible();

    await marian.goto("/admin/promotions");
    await marian.getByRole("button", { name: "Change a driver's group" }).click();
    const form = sheet(marian);
    await form.getByLabel(/^Driver/).selectOption({ label: "Marchetti, Theo" });
    await expect(form).toContainText("Currently Blue.");
    await form.getByLabel(/^New run group/).selectOption({ label: "White" });
    await form.getByLabel(/^Reason/).fill(WHITE_NOW_REASON);
    await form.getByRole("checkbox", { name: new RegExp(`Apply at ${event.name} now`) }).check();
    await form.getByRole("button", { name: "Record the change" }).click();
    // White drivers are solo, so Marian is reminded that he is still paired with Gus.
    await confirmed(marian, "Recorded. They are still paired with an instructor: end it under Instructor pairing if they will drive alone.");
    await expect(decided(marian, "Theo Marchetti · Blue to White").getByText("Approved", { exact: true })).toBeVisible();

    // The pairing page treats him as a solo driver who is still paired.
    await marian.goto("/admin/instructors");
    const row = studentRow(marian, "Theo Marchetti");
    await expect(row.getByText("White", { exact: true })).toBeVisible();
    await expect(row.getByText("Solo now", { exact: true })).toBeVisible();

    // Theo: told it applies now, in White on his profile, White sessions on his schedule, and "you drive solo now" on Now.
    const his = await person(THEO);
    const told = await alertRow(his, "Your run group is now White");
    await expect(told).toContainText("This takes effect now: check your schedule for your sessions.");
    await told.getByRole("button").click();
    await expect(his).toHaveURL(/\/schedule$/);
    await his.getByRole("button", { name: "Mine only" }).click();
    await expect(his.getByRole("main").getByRole("listitem").filter({ hasText: "Track session" }).filter({ has: his.getByText("You", { exact: true }) }).first()).toContainText("White");
    await his.goto("/me");
    await shows(his, "Solo. You can ask for an instructor to ride along from the Now screen.");
    await his.goto("/home");
    await expect(instructorPanel(his)).toContainText("You drive solo now. They are still your instructor contact at this event.");

    // The driver's file and his instructor's screens must say the same thing: a White driver, driving solo.
    await marian.goto(`/admin/roster/${theo}`);
    await expect(marian.getByRole("heading", { level: 1, name: "Theo Marchetti" })).toBeVisible();
    await expect.soft(marian.getByRole("main"), "the driver's file for a driver moved up to White").toContainText(/Run group\s+White · solo/i, { useInnerText: true, timeout: 2000 });
    // The roster list says the same beside his run group.
    await marian.goto("/admin/roster");
    const listed = marian.getByRole("main").getByRole("row").filter({ hasText: "Marchetti" });
    await expect(listed, "Theo's run group on the roster list").toContainText(/White\s*Solo/);
    await expect(listed.getByText("Instructed", { exact: true })).toHaveCount(0);
    const gus = await person(GUS);
    await gus.goto("/instructor");
    const card = gus.getByRole("main").getByRole("link", { name: /^Theo Marchetti/ }).locator("xpath=..");
    await expect(card.getByText("White", { exact: true })).toBeVisible();
    await expect.soft(card.getByText("Solo", { exact: true }), "the Solo status on his instructor's list").toBeVisible({ timeout: 2000 });
    await expect.soft(card.getByText("Instructed", { exact: true }), "an Instructed status on his instructor's list").toHaveCount(0, { timeout: 2000 });
    // There is no instructed half of White, so there is no solo sign-off left to recommend: only the next group up.
    await card.getByRole("button", { name: "Recommend" }).click();
    await expect(sheet(gus).getByRole("radio", { name: /Promote to Black/ })).toBeVisible();
    await expect.soft(sheet(gus).getByRole("radio", { name: /Sign off to drive solo/ }), "a solo sign-off choice for a White driver").toHaveCount(0, { timeout: 2000 });
  });
});
