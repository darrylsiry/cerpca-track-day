import type { Browser, Locator, Page } from "@playwright/test";
import { test, expect, signIn, sql, val, userId, tag, openBrowser, saveState, readState, need, BASE, PEOPLE, T } from "./fixtures";

// Tech inspection from the driver's side, and the public page a shop uses to sign an inspection
// without an account.
//
// One driver, Tessa Nakamura, goes through every way of getting the shop's part done (a photo of
// the paper form, a PDF of it, a link sent to a shop on the region's list, a link sent to a shop
// the region has never heard of), then signs, is sent back by the tech team, signs again and is
// approved. The tests run in order and each one starts where the one before left her form.
// An administrator (Hank Odom, Chief Tech Inspector) is signed in only to review what Tessa sent.

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

/** Tessa's tech form as stored, for the things no screen shows. */
function form() {
  const [id, status, method, paperFile, shopName] = sql(
    `select id, status, method, coalesce(paper_file, ''), coalesce(shop_name, '') from tech_inspections where event_id = '${currentEvent().id}' and user_id = '${userId("tessa")}'`,
  )[0];
  return { id, status, method, paperFile, shopName };
}

const addDays = (day: string, n: number) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const fmt = (day: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(`${day}T12:00:00Z`));
const monthDay = (day: string) => fmt(day, { month: "short", day: "numeric" });
const dayFull = (day: string) => fmt(day, { month: "long", day: "numeric", year: "numeric" });

/**
 * Only what is showing. The app keeps the screens a person just left in the page, hidden, so that
 * going back is instant; a lookup by text or label would otherwise also find those.
 */
const shown = (found: Locator) => found.filter({ visible: true });

/** One of the five numbered steps on the driver's tech page. */
const step = (page: Page, n: number) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2, name: new RegExp(`^Step ${n}:`) }) });

/** A row of a "label: value" list, found by its label. */
const detail = (scope: Page | Locator, label: string) => shown(scope.locator(`dl > div:has(> dt:text-is("${label}"))`)).locator("dd");

/** The page a locator lives on. */
const pageOf = (scope: Page | Locator): Page => (typeof (scope as Locator).page === "function" ? (scope as Locator).page() : (scope as Page));

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

/** A browser with nobody signed in: the shop's computer or phone. */
async function shopBrowser(browser: Browser, problems: string[], link: string, phone = false) {
  const ctx = await openBrowser(browser, problems, phone ? { viewport: { width: 375, height: 812 } } : {});
  const page = await ctx.newPage();
  await page.goto(link);
  return { page, close: () => ctx.close() };
}

// Things one test makes that a later one needs (the shop's link cannot be read back from the
// database: only its fingerprint is stored). Kept in memory, and on disk in case a failure in
// between restarts the test worker.
const made: Record<string, string> = {};
const keep = (key: string, value: string) => {
  made[key] = value;
  saveState({ [`driverTech.${T}.${key}`]: value });
};
const recall = (key: string) => made[key] ?? need(`driverTech.${T}.${key}`);
const peek = (key: string): string | undefined => made[key] ?? readState()[`driverTech.${T}.${key}`];

// The smallest files that are really what they say they are.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1",
);

// A shop the region has never worked with, named after this run so a second run does not collide with the first.
const SHOP = { name: `UAT Garage ${T}`, tech: "Uma Wrench", phone: "(912) 555-0188" };
const shopEmail = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.com`;

/** Open the sheet that offers both ways of redoing the shop's part, whichever way was used last. */
async function openRedo(page: Page) {
  await step(page, 2).getByRole("button", { name: /Send it back to the shop|Replace the upload or use a shop link/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Redo the shop inspection" })).toBeVisible();
  return sheet;
}

/** The two ways of getting the shop's part done, side by side: a link for the shop, or an upload. */
const viaLink = (scope: Page | Locator) => scope.locator("section").filter({ has: pageOf(scope).getByRole("heading", { name: "Send it to my shop" }) });
const viaUpload = (scope: Page | Locator) => scope.locator("section").filter({ has: pageOf(scope).getByRole("heading", { name: "Upload the paper form" }) });

/** The link the driver is given to pass on when no email service is connected. */
async function linkOnScreen(page: Page) {
  const box = page.getByLabel("Link for your shop");
  await expect(box).toHaveValue(new RegExp(`^${BASE}/tech/[\\w-]{20,}$`));
  return box.inputValue();
}

/** On the shop's form, mark all 28 checklist items: not applicable where the form allows it, pass otherwise. */
async function markAll(page: Page) {
  const items = page.getByRole("group");
  await expect(items).toHaveCount(28);
  for (const item of await items.all()) {
    const na = item.getByText("N/A", { exact: true });
    await ((await na.count()) ? na : item.getByText("Pass", { exact: true })).click();
  }
  await expect(page.getByText("28 of 28 items marked")).toBeVisible();
}

/** A tire date code (week, then year) for week 10 of the year so many years before the event. */
const tireCode = (eventStart: string, yearsBefore: number) => `10${String(Number(eventStart.slice(0, 4)) - yearsBefore).slice(2)}`;

// ───── a driver who is finished

test.describe("tech inspection: a driver who is cleared", () => {
  test("sees their sticker, each step done, and can open the signed form", async ({ page }) => {
    const sticker = val(`select sticker_number from tech_inspections where event_id = '${currentEvent().id}' and user_id = '${userId("owen")}'`);
    await signIn(page, "owen");
    await page.goto("/me/tech");
    await expect(page.getByRole("heading", { level: 1, name: "Tech inspection" })).toBeVisible();
    await expect(page.getByText("You are cleared to drive")).toBeVisible();
    await expect(page.getByText(`Your waivers are signed and tech sticker ${sticker} is on your car.`)).toBeVisible();
    await expect(step(page, 2)).toContainText("Shop signed");
    await expect(step(page, 3)).toContainText("Signed by Owen Gallagher");
    await expect(step(page, 3)).toContainText(/Shop verification code [0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}/);
    await expect(step(page, 4)).toContainText("Approved");
    await expect(step(page, 4)).toContainText("Your paperwork is done.");
    await expect(step(page, 5)).toContainText(`Sticker ${sticker}`);
    await expect(step(page, 5)).toContainText("Keep it on the windshield for the whole event.");
    // Nothing is left to edit or redo once it is approved.
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Send it back to the shop/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Sign and submit/ })).toHaveCount(0);

    // The full form is one tap away.
    await expect(page.getByText("Wheel bolts and lugs")).toBeHidden();
    await page.getByText("Show the full form").click();
    await expect(page.getByText("Wheel bolts and lugs")).toBeVisible();
    await expect(page.getByRole("img", { name: "Signature of Owen Gallagher" })).toBeVisible();
    await page.getByText("Hide the full form").click();
    await expect(page.getByText("Wheel bolts and lugs")).toBeHidden();
  });
});

// ───── Tessa's form, start to finish

test.describe("tech inspection: from an open form to approved", () => {
  test("the driver sees the five steps, the inspection window, what the shop recorded, and cannot submit unsigned", async ({ page }) => {
    const ev = currentEvent();
    await signIn(page, "tessa");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tech inspection" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tech inspection" })).toBeVisible();

    // When the shop inspection has to be done by.
    await expect(page.getByText("Shop inspection window")).toBeVisible();
    await expect(page.getByText(`${monthDay(addDays(ev.start, -28))} to ${monthDay(addDays(ev.start, -14))}`)).toBeVisible();
    await expect(page.getByText(`No earlier than 4 weeks and no later than 2 weeks before ${dayFull(ev.start)}.`, { exact: false })).toBeVisible();

    // Five steps, with her place in them.
    for (const [n, title] of [[1, "Your car and emergency contact"], [2, "Shop inspection"], [3, "Review and sign"], [4, "Tech team review"], [5, "Grid tech at the track"]] as const) {
      await expect(page.getByRole("heading", { level: 2, name: `Step ${n}: ${title}` })).toBeVisible();
    }
    await expect(step(page, 1)).toContainText("2015 Porsche Cayman");
    await expect(shown(step(page, 1).getByLabel("Car number 402")).first()).toBeVisible();
    await expect(step(page, 2)).toContainText("Shop signed");
    await expect(step(page, 2)).toContainText(/Bram Ostrander at Lowcountry Motorwerks signed/);
    await expect(step(page, 2)).toContainText("Verified shop");

    // Step 3 shows what the shop recorded, item by item.
    const review = step(page, 3);
    await expect(review).toContainText("This is what your shop recorded.");
    await expect(review.getByRole("listitem").filter({ hasText: "Seat belts" })).toContainText("Pass");
    await expect(review.getByRole("listitem").filter({ hasText: "Roll bar and cages" })).toContainText("N/A");
    await expect(review).toContainText("1825");
    await expect(detail(review, "Helmet rating")).toHaveText("SA2020");
    await expect(review.getByRole("img", { name: "Signature of Bram Ostrander" })).toBeVisible();
    await expect(review).toContainText("Not signed yet.");

    // The driver's certification cannot be sent until it is ticked, named and signed.
    await expect(review.getByText("The undersigned hereby certifies that:")).toBeVisible();
    const submit = review.getByRole("button", { name: "Sign and submit to the tech team" });
    await expect(submit).toBeDisabled();
    await expect(review.getByText("Tick the box, type your name and sign to submit.")).toBeVisible();
    await expect(review.getByLabel("Full name")).toHaveValue("Tessa Nakamura");
    await review.getByLabel("I have read these three statements and certify that they are true.").check();
    await expect(submit).toBeDisabled();
    await drawSignature(page, review.getByRole("img", { name: "Driver signature" }));
    await expect(submit).toBeEnabled();
    await review.getByLabel("Full name").fill("T");
    await expect(submit).toBeDisabled();
    // She leaves without submitting: nothing has been sent.
    expect(form().status).toBe("shop_signed");

    // Step 5 tells her what happens at the track.
    await expect(step(page, 5)).toContainText("A car without a sticker does not go on track.");
    await expect(step(page, 5).getByRole("listitem").filter({ hasText: "Car numbers in place" })).toBeVisible();

    // The blank paper form is offered as a real PDF.
    const paper = page.getByRole("link", { name: "Download the CERPCA tech inspection form" });
    const res = await page.context().request.get((await paper.getAttribute("href"))!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    expect((await res.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("the driver changes the emergency contact and adds a second driver; the car is locked once a shop has signed for it", async ({ page }) => {
    await signIn(page, "tessa");
    await page.goto("/me/tech");
    await step(page, 1).getByRole("button", { name: "Edit" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/The car can't be changed once the form has gone to the shop/)).toBeVisible();
    await expect(sheet.getByLabel("Year")).toHaveCount(0);
    await sheet.getByLabel("Emergency contact and phone").fill("Robin Nakamura, (912) 555-0111");
    await sheet.getByLabel("A second driver is sharing this car").check();
    await sheet.getByLabel("Second driver", { exact: true }).fill("Kenji Nakamura");
    await sheet.getByLabel("Their emergency contact and phone").fill("Mika Nakamura, (912) 555-0122");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Details saved", { exact: true })).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(detail(step(page, 1), "Emergency contact")).toHaveText("Robin Nakamura, (912) 555-0111");
    await expect(detail(step(page, 1), "Second driver")).toHaveText("Kenji Nakamura");
    await expect(detail(step(page, 1), "Their emergency contact")).toHaveText("Mika Nakamura, (912) 555-0122");
    // The shop's record of the car is untouched.
    await expect(step(page, 1)).toContainText("2015 Porsche Cayman");
  });

  test("a photo of the stamped paper form can be uploaded in place of the shop's online record; other file types are refused", async ({ page }) => {
    const ev = currentEvent();
    const inspected = addDays(ev.start, -20);
    await signIn(page, "tessa");
    await page.goto("/me/tech");
    const sheet = await openRedo(page);
    const upload = viaUpload(sheet);

    // A text file is not a photo or a PDF. What she typed stays put.
    await upload.getByLabel("Photo or PDF of the completed form").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a tech form") });
    await upload.getByLabel("Shop that stamped it").fill("Lowcountry Motorwerks");
    await upload.getByLabel("Inspection date").fill(inspected);
    await upload.getByRole("button", { name: "Upload form" }).click();
    await expect(upload.getByRole("alert")).toHaveText("Upload a photo (JPEG, PNG, WebP or HEIC) or a PDF.");
    await expect(upload.getByLabel("Shop that stamped it")).toHaveValue("Lowcountry Motorwerks");
    await expect(upload.getByLabel("Inspection date")).toHaveValue(inspected);
    expect(form().method, "nothing was replaced by the refused upload").toBe("online");

    // A photo is accepted.
    await upload.getByLabel("Photo or PDF of the completed form").setInputFiles({ name: "tech-form.png", mimeType: "image/png", buffer: PNG });
    await upload.getByRole("button", { name: "Upload form" }).click();
    await expect(page.getByText("Form uploaded. Sign below to submit it")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Step 2 now describes a paper form, with the photo one tap away.
    await expect(step(page, 2)).toContainText("Paper form uploaded");
    await expect(step(page, 2)).toContainText(`Paper form from Lowcountry Motorwerks, inspected ${dayFull(inspected)}.`);
    const photo = step(page, 2).getByRole("link", { name: "Open the photo" });
    const res = await page.context().request.get((await photo.getAttribute("href"))!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect((await res.body()).equals(PNG), "the photo that comes back is the one she uploaded").toBe(true);

    // Step 3 shows the photo in place of a checklist and asks her to check it before signing.
    const review = step(page, 3);
    await expect(review).toContainText("Check that your upload is the complete, stamped form.");
    await expect(review).toContainText("Paper form: check the shop stamp and signature on the upload");
    await expect(review.getByRole("img", { name: "Uploaded paper tech form" })).toBeVisible();
    await expect(review).toContainText("Paper form: the checklist, shop stamp and technician signature are on the upload.");
    await expect(review.getByText("Seat belts")).toHaveCount(0);
    await expect(review.getByRole("button", { name: "Sign and submit to the tech team" })).toBeVisible();
  });

  test("a link can be sent to a shop on the region's list, replaced with a new one, and cancelled", async ({ as, browser, problems }) => {
    const tessa = await as("tessa");
    await tessa.goto("/me/tech");
    const sheet = await openRedo(tessa);
    const invite = viaLink(sheet);

    // The region's verified shops are offered by name; the link goes to the address the region holds.
    await invite.getByRole("combobox").selectOption({ label: "Tybee Autohaus (Thunderbolt, GA)" });
    await expect(invite.getByText("The link is emailed to the address the region has on file for this shop.")).toBeVisible();
    await expect(invite.getByLabel("Shop email")).toHaveCount(0);
    await invite.getByRole("button", { name: "Send link to shop" }).click();

    // No email service is connected here, so she is told plainly and given the link to pass on herself.
    await expect(step(tessa, 2)).toContainText("Waiting on shop");
    await expect(step(tessa, 2)).toContainText("Waiting on Tybee Autohaus");
    await expect(step(tessa, 2)).toContainText(/Link sent .+\. It works once and expires .+\. You'll get an alert here when the shop signs\./);
    await expect(tessa.getByText("The email was not sent")).toBeVisible();
    await expect(tessa.getByText(/Email is not set up in this environment, so nothing went to tech@tybeeautohaus\.example\./)).toBeVisible();
    const first = await linkOnScreen(tessa);
    // What a user cannot see: the attempt is in the delivery log as not really sent, without the link in it.
    const [status, body] = sql(`select status, body from message_log where to_address = 'tech@tybeeautohaus.example' and kind = 'tech' order by created_at desc limit 1`)[0];
    expect(status).toBe("simulated");
    expect(body).not.toContain("/tech/");

    // Copy puts the link on the clipboard.
    await tessa.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await tessa.getByRole("button", { name: "Copy link" }).click();
    await expect(tessa.getByText("Link copied")).toBeVisible();
    expect(await tessa.evaluate(() => navigator.clipboard.readText())).toBe(first);

    // Her uploaded photo is set aside, and the form is waiting on the shop.
    await expect(step(tessa, 2).getByRole("link", { name: "Open the photo" })).toHaveCount(0);
    await expect(step(tessa, 3).getByRole("button", { name: /Sign and submit/ })).toHaveCount(0);
    await tessa.goto("/home");
    await expect(tessa.getByRole("link", { name: /^Shop inspection\s*Waiting on shop/ })).toBeVisible();

    // The shop can open the link without signing in.
    const shop = await shopBrowser(browser, problems, first);
    await expect(shop.page.getByRole("heading", { level: 1, name: "2015 Porsche Cayman" })).toBeVisible();
    await expect(shop.page.getByText("This link was sent to Tybee Autohaus only.", { exact: false })).toBeVisible();

    // A new link replaces the old one.
    await tessa.goto("/me/tech");
    await tessa.getByRole("button", { name: "Send a new link" }).click();
    await expect(tessa.getByLabel("Link for your shop")).not.toHaveValue(first);
    const second = await linkOnScreen(tessa);
    await shop.page.reload();
    await expect(shop.page.getByRole("heading", { level: 1, name: "This link is not valid" })).toBeVisible();
    await shop.page.goto(second);
    await expect(shop.page.getByRole("heading", { level: 1, name: "2015 Porsche Cayman" })).toBeVisible();

    // Cancelling the request kills the link and puts both choices back.
    await tessa.getByRole("button", { name: "Cancel request" }).click();
    await expect(tessa.getByText("Request cancelled. The link no longer works")).toBeVisible();
    await expect(tessa.getByRole("heading", { name: "Send it to my shop" })).toBeVisible();
    await expect(tessa.getByRole("heading", { name: "Upload the paper form" })).toBeVisible();
    await expect(shown(tessa.getByText("Waiting on shop"))).toHaveCount(0);
    await shop.page.reload();
    await expect(shop.page.getByRole("heading", { level: 1, name: "This link is not valid" })).toBeVisible();
    await expect(shop.page.getByText(/the driver cancelled the request/)).toBeVisible();
    await expect(shop.page.getByRole("button", { name: /Sign and send/ })).toHaveCount(0);
    await shop.close();

    await tessa.goto("/home");
    await expect(tessa.getByRole("link", { name: /^Shop inspection\s*Not sent to a shop/ })).toBeVisible();
    await expect(tessa.getByRole("link", { name: /^Before you drive/ })).toContainText("Start your tech inspection");
  });

  test("a made-up shop link is turned away", async ({ browser, problems }) => {
    const shop = await shopBrowser(browser, problems, `${BASE}/tech/not-a-real-link-${tag()}`);
    await expect(shop.page.getByRole("heading", { level: 1, name: "This link is not valid" })).toBeVisible();
    await expect(shop.page.getByText("Ask the driver to send you a new link from their Track Day app.", { exact: false })).toBeVisible();
    // No form, and none of the app behind it.
    await expect(shop.page.getByRole("button")).toHaveCount(0);
    await expect(shop.page.getByRole("navigation")).toHaveCount(0);
    await shop.close();
  });

  test("with no shop on the form yet, the driver can correct the car; a year that cannot be right is refused and nothing typed is lost", async ({ page }) => {
    await signIn(page, "tessa");
    await page.goto("/me/tech");
    await step(page, 1).getByRole("button", { name: "Edit" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/The car can't be changed/)).toHaveCount(0);
    await sheet.getByLabel("Year").fill("1900");
    await sheet.getByLabel("Color").fill("Agate Grey Metallic");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Enter the model year as four digits.");
    await expect(sheet.getByLabel("Year")).toHaveValue("1900");
    await expect(sheet.getByLabel("Color")).toHaveValue("Agate Grey Metallic");
    await expect(sheet.getByLabel("Second driver", { exact: true })).toHaveValue("Kenji Nakamura");

    await sheet.getByLabel("Year").fill("2015");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Details saved", { exact: true })).toBeVisible();
    await expect(step(page, 1)).toContainText("2015 Porsche Cayman");
    await expect(step(page, 1)).toContainText("Agate Grey Metallic");
  });

  test("uploading the paper form as a PDF from the first-time screen is confirmed with a message", async ({ page }) => {
    const ev = currentEvent();
    await signIn(page, "tessa");
    await page.goto("/me/tech");
    const upload = viaUpload(page);
    await upload.getByLabel("Photo or PDF of the completed form").setInputFiles({ name: "tech-form.pdf", mimeType: "application/pdf", buffer: PDF });
    await upload.getByLabel("Shop that stamped it").fill("Bluffton European Auto");
    await upload.getByLabel("Inspection date").fill(addDays(ev.start, -18));
    await upload.getByRole("button", { name: "Upload form" }).click();
    await expect(step(page, 2)).toContainText("Paper form uploaded");
    // The screen moves on; she should also be told in words that the upload worked and what to do next.
    await expect(page.getByText("Form uploaded. Sign below to submit it")).toBeVisible({ timeout: 5_000 });
  });

  test("the uploaded PDF opens for the driver and the tech team, and for nobody else", async ({ as, browser, problems }) => {
    const ev = currentEvent();
    test.skip(form().method !== "paper", "needs the PDF uploaded in the test before");
    const tessa = await as("tessa");
    await tessa.goto("/me/tech");
    await expect(step(tessa, 2)).toContainText(`Paper form from Bluffton European Auto, inspected ${dayFull(addDays(ev.start, -18))}.`);
    const href = (await step(tessa, 2).getByRole("link", { name: "Open the PDF" }).getAttribute("href"))!;
    const mine = await tessa.context().request.get(href);
    expect(mine.status()).toBe(200);
    expect(mine.headers()["content-type"]).toBe("application/pdf");
    expect((await mine.body()).equals(PDF), "the PDF that comes back is the one she uploaded").toBe(true);
    await expect(step(tessa, 3).getByRole("link", { name: "Open the uploaded form (PDF)" })).toHaveAttribute("href", href);

    // Another driver who somehow had the address is refused.
    const owen = await as("owen");
    const theirs = await owen.context().request.get(href);
    expect(theirs.status(), "another driver asking for Tessa's upload").toBe(403);
    expect(await theirs.text()).not.toContain("%PDF");
    // So is someone who is not signed in.
    const anon = await openBrowser(browser, problems);
    const nobody = await anon.request.get(href, { maxRedirects: 0 });
    expect([401, 302, 303, 307, 308], "a signed-out visitor asking for Tessa's upload").toContain(nobody.status());
    expect(await nobody.text()).not.toContain("%PDF");
    await anon.close();
    // The tech team can open it to review.
    const hank = await as("hank");
    const reviewer = await hank.context().request.get(href);
    expect(reviewer.status()).toBe(200);
    expect((await reviewer.body()).equals(PDF)).toBe(true);
  });

  test("a refused request leaves the driver's choice of shop showing", async ({ page }) => {
    await signIn(page, "tessa");
    await page.goto("/me/tech");
    const invite = viaLink(await openRedo(page));
    const picker = invite.getByRole("combobox");
    await picker.selectOption({ label: "Another shop…" });
    await invite.getByLabel("Shop name").fill("Driveway Garage");
    await invite.getByLabel("Shop email").fill(PEOPLE.tessa.email);
    await invite.getByRole("button", { name: "Send link to shop" }).click();
    await expect(invite.getByRole("alert")).toHaveText("Use the shop's email address, not your own. The technician signs the form, not the driver.");
    // Nothing was sent, and the fields for her own shop are still on screen with what she typed...
    await expect(invite.getByLabel("Shop name")).toHaveValue("Driveway Garage");
    expect(form().status).toBe("shop_signed");
    // ...so the picker above them must still say "Another shop", not jump to a shop she did not choose.
    await expect(picker.locator("option:checked")).toHaveText("Another shop…", { timeout: 5_000 });
  });

  test("a link for a shop the region does not know: the driver's own address is refused, then the link is made", async ({ page }) => {
    await signIn(page, "tessa");
    await page.goto("/me/tech");
    const sheet = await openRedo(page);
    const invite = viaLink(sheet);
    await invite.getByRole("combobox").selectOption({ label: "Another shop…" });
    await expect(invite.getByText(/shows as "not verified" until the tech team confirms it/)).toBeVisible();

    // The technician signs, not the driver, so her own address will not do. What she typed stays.
    await invite.getByLabel("Shop name").fill(SHOP.name);
    await invite.getByLabel("Shop email").fill(PEOPLE.tessa.email);
    await invite.getByLabel("Shop phone").fill(SHOP.phone);
    await invite.getByLabel("Technician").fill(SHOP.tech);
    await invite.getByRole("button", { name: "Send link to shop" }).click();
    await expect(invite.getByRole("alert")).toHaveText("Use the shop's email address, not your own. The technician signs the form, not the driver.");
    await expect(invite.getByLabel("Shop name")).toHaveValue(SHOP.name);
    await expect(invite.getByLabel("Shop phone")).toHaveValue(SHOP.phone);
    await expect(invite.getByLabel("Technician")).toHaveValue(SHOP.tech);

    await invite.getByLabel("Shop email").fill(shopEmail(SHOP.name));
    await invite.getByRole("button", { name: "Send link to shop" }).click();
    await expect(step(page, 2)).toContainText(`Waiting on ${SHOP.name}`);
    await expect(page.getByText(new RegExp(`nothing went to ${shopEmail(SHOP.name).replace(/\./g, "\\.")}\\.`))).toBeVisible();
    keep("link", await linkOnScreen(page));
    // The paper upload is set aside now that a shop is doing it online.
    expect(form().paperFile).toBe("");
    // The car cannot be changed while the shop has the form.
    await step(page, 1).getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("dialog").getByText(/The car can't be changed once the form has gone to the shop/)).toBeVisible();
  });

  test("when the shop's form is refused, the technician's certification stays ticked", async ({ browser, problems }) => {
    const ev = currentEvent();
    const shop = await shopBrowser(browser, problems, recall("link"));
    const page = shop.page;
    try {
      await markAll(page);
      for (const wheel of ["Right front", "Left rear", "Right rear"]) await page.getByLabel(wheel).fill(tireCode(ev.start, 1));
      // Week 52 of 2099: the right shape, so the page lets it through, but the server knows it is in the future.
      await page.getByLabel("Left front").fill("5299");
      await page.getByLabel("Brake fluid last changed").fill(addDays(ev.start, -60));
      await page.getByRole("checkbox").check();
      await drawSignature(page, page.getByRole("img", { name: "Technician signature" }));
      await page.getByRole("button", { name: "Sign and send to the driver" }).click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText("The left front tire's date code is in the future. Check the four digits.");
      // Nothing was recorded: the form is still waiting on the shop.
      expect(form().status).toBe("with_shop");
      // The technician ticked the certification and did not untick it, so it should still show as ticked.
      await expect(page.getByRole("checkbox")).toBeChecked({ timeout: 5_000 });
    } finally {
      await shop.close();
    }
  });

  test("the shop fills in the form without an account; it cannot be sent until every part is done; a failed item is allowed but recorded", async ({ browser, problems, as }) => {
    test.skip(form().status !== "with_shop" || form().shopName !== SHOP.name, "needs the link made two tests before");
    const ev = currentEvent();
    // The shop says the first link never arrived, so Tessa sends a new one.
    const tessa = await as("tessa");
    await tessa.goto("/me/tech");
    await tessa.getByRole("button", { name: "Send a new link" }).click();
    keep("link", await linkOnScreen(tessa));
    const shop = await shopBrowser(browser, problems, recall("link"));
    const page = shop.page;
    const problem = page.getByRole("main").getByRole("alert");
    const send = page.getByRole("button", { name: "Sign and send to the driver" });

    // The page stands alone: the car, the driver and the event, and nothing of the app behind it.
    await expect(page.getByText("Technical inspection", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "2015 Porsche Cayman" })).toBeVisible();
    await expect(page.getByText("Agate Grey Metallic")).toBeVisible();
    await expect(page.getByLabel("Car number 402")).toBeVisible();
    await expect(detail(page, "Driver")).toHaveText("Tessa Nakamura and Kenji Nakamura");
    await expect(detail(page, "Event")).toContainText(ev.name);
    await expect(detail(page, "Track")).toHaveText("Roebling Road Raceway");
    await expect(detail(page, "Region")).toHaveText("Coastal Empire Region, Porsche Club of America");
    await expect(page.getByText(`This link was sent to ${SHOP.name} only.`, { exact: false })).toBeVisible();
    await expect(page.getByText(`The inspection should be done between ${monthDay(addDays(ev.start, -28))} and ${monthDay(addDays(ev.start, -14))}.`, { exact: false })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByText(PEOPLE.tessa.email)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toMatch(/^\/tech\//);

    // Nothing is marked yet, and sending says where to start.
    const items = page.getByRole("group");
    await expect(items).toHaveCount(28);
    await expect(page.getByText("0 of 28 items marked")).toBeVisible();
    await send.click();
    await expect(problem).toHaveText('"Roll bar and cages" is not marked yet.');

    // Mark everything: pass, or not applicable where the form allows it. Three items are optional.
    await expect(items.filter({ has: page.getByText("N/A", { exact: true }) })).toHaveCount(3);
    await markAll(page);

    // One item fails. A failure has to say what is wrong.
    await page.getByRole("group", { name: "Brake lights", exact: true }).getByText("Fail", { exact: true }).click();
    await expect(page.getByText("· 1 failed")).toBeVisible();
    await send.click();
    await expect(problem).toHaveText('Add a note saying what is wrong with "Brake lights".');
    await page.getByLabel("What is wrong?").fill("Left brake light is out");

    // Tire date codes: four digits each, week then year. The form works out each tire's age at the event.
    const tire = tireCode(ev.start, 1);
    await send.click();
    await expect(problem).toHaveText("Enter the left front tire's date code as four digits.");
    await page.getByLabel("Left front").fill("9925"); // there is no week 99
    await send.click();
    await expect(problem).toHaveText("Enter the left front tire's date code as four digits.");
    await page.getByLabel("Left front").fill(tireCode(ev.start, 7));
    await expect(page.getByText(/^[67]\.\d years at the event\. Over the limit\.$/)).toBeVisible();
    for (const wheel of ["Left front", "Right front", "Left rear", "Right rear"]) await page.getByLabel(wheel).fill(tire);
    await expect(page.getByText(/^[01]\.\d years at the event$/)).toHaveCount(4);
    await expect(page.getByText(/Over the limit/)).toHaveCount(0);

    // Brake fluid date: required, and flagged on the spot when it is more than a year before the event.
    await send.click();
    await expect(problem).toHaveText("Enter the date the brake fluid was last changed.");
    await page.getByLabel("Brake fluid last changed").fill(addDays(ev.start, -400));
    await expect(page.getByText("13 months before the event. It must be changed at least annually.")).toBeVisible();
    await page.getByLabel("Brake fluid last changed").fill(addDays(ev.start, -60));
    await expect(page.getByText(/It must be changed at least annually/)).toHaveCount(0);
    await page.getByLabel("Helmet Snell rating").fill("SA2020");
    await page.getByLabel("Anything else the tech team should know").fill("Pads at 70 percent all round.");

    // Sign-off: the technician's name is filled in from what the driver gave, then a tick and a signature.
    await expect(page.getByLabel("Your full name")).toHaveValue(SHOP.tech);
    await expect(page.getByText(`Shop: ${SHOP.name}`)).toBeVisible();
    await send.click();
    await expect(problem).toHaveText("Tick the box to certify the inspection.");
    await page.getByRole("checkbox").check();
    await send.click();
    await expect(problem).toHaveText("Sign in the box.");
    await drawSignature(page, page.getByRole("img", { name: "Technician signature" }));
    await expect(page.getByText("One item is marked as failed")).toBeVisible();

    // A date code from the future gets past the page but not the server. What was marked, typed and
    // signed survives the refusal, so once the code is corrected the form goes through as it stands.
    await page.getByLabel("Left front").fill("5299");
    await send.click();
    await expect(problem).toHaveText("The left front tire's date code is in the future. Check the four digits.");
    await expect(page.getByText("28 of 28 items marked")).toBeVisible();
    await expect(page.getByLabel("What is wrong?")).toHaveValue("Left brake light is out");
    await expect(page.getByLabel("Right front")).toHaveValue(tire);
    await expect(page.getByLabel("Helmet Snell rating")).toHaveValue("SA2020");
    await expect(page.getByRole("button", { name: "Clear" })).toBeEnabled();
    await page.getByLabel("Left front").fill(tire);
    await send.click();
    await expect(page.getByRole("heading", { level: 1, name: "Inspection recorded" })).toBeVisible();
    await expect(page.getByText(/Tessa has been notified and will sign their part before it goes to the CERPCA tech team/)).toBeVisible();
    await expect(detail(page, "Car")).toHaveText("2015 Porsche Cayman, #402");
    await expect(detail(page, "Signed by")).toHaveText(`${SHOP.tech}, ${SHOP.name}`);
    await expect(detail(page, "Result")).toHaveText("1 of 28 items failed");
    const code = page.getByText(/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
    await expect(code).toBeVisible();
    keep("failedCode", (await code.innerText()).trim());

    // The link is spent: opening it again shows the receipt, not a form.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Inspection recorded" })).toBeVisible();
    await expect(send).toHaveCount(0);
    await shop.close();

    // Tessa is told, in the app and by email (logged, as no email service is connected).
    await tessa.goto("/alerts");
    const alert = tessa.getByRole("button", { name: /Your shop finished the tech form, with failed items/ });
    await expect(alert).toContainText(`${SHOP.tech} at ${SHOP.name} marked one item as failed.`);
    expect(val(`select status from message_log where to_address = '${PEOPLE.tessa.email}' and subject = 'Your shop finished the tech form, with failed items' order by created_at desc limit 1`)).toBe("simulated");
    await alert.click();
    await expect(tessa).toHaveURL(/\/me\/tech$/);

    // She can read what failed and why, and cannot submit a car with a failed item.
    await expect(step(tessa, 2)).toContainText(`${SHOP.tech} at ${SHOP.name} signed`);
    await expect(step(tessa, 2)).toContainText("Not verified");
    const review = step(tessa, 3);
    await expect(review).toContainText("Can't submit yet");
    await expect(review).toContainText("The shop marked one item as failed");
    await expect(review).toContainText("Failed item: Brake lights");
    await expect(review).toContainText("Shop is not on the region's verified list");
    const light = review.getByRole("listitem").filter({ hasText: "Technician note" });
    await expect(light).toHaveText(/^Brake lights\s*Technician note: Left brake light is out\s*Fail$/);
    await expect(review).toContainText("Pads at 70 percent all round.");
    await expect(review.getByRole("button", { name: /Sign and submit/ })).toHaveCount(0);
  });

  test("the driver sends the form back to the shop, which corrects it on a phone with its earlier answers kept", async ({ as, browser, problems }) => {
    const before = recall("link");
    const tessa = await as("tessa");
    await tessa.goto("/me/tech");
    const sheet = await openRedo(tessa);
    const invite = viaLink(sheet);
    // The same shop is already filled in.
    await expect(invite.getByLabel("Shop name")).toHaveValue(SHOP.name);
    await expect(invite.getByLabel("Shop email")).toHaveValue(shopEmail(SHOP.name));
    await invite.getByRole("button", { name: "Send link to shop" }).click();
    await expect(step(tessa, 2)).toContainText(`Waiting on ${SHOP.name}`);
    const link = await linkOnScreen(tessa);
    expect(link).not.toBe(before);

    // The earlier link no longer opens the form; the new one does, on the technician's phone.
    const old = await shopBrowser(browser, problems, before);
    await expect(old.page.getByRole("heading", { level: 1, name: "This link is not valid" })).toBeVisible();
    await old.close();
    const shop = await shopBrowser(browser, problems, link, true);
    const page = shop.page;
    await expect(page.getByText("28 of 28 items marked")).toBeVisible();
    await expect(page.getByText("· 1 failed")).toBeVisible();
    await expect(page.getByLabel("What is wrong?")).toHaveValue("Left brake light is out");
    await expect(page.getByLabel("Left front")).toHaveValue(/^10\d\d$/);
    await expect(page.getByLabel("Brake fluid last changed")).not.toHaveValue("");
    await expect(page.getByLabel("Helmet Snell rating")).toHaveValue("SA2020");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the shop's form fits a phone").toBe(true);

    // The light is fixed. The technician certifies and signs again.
    await page.getByRole("button", { name: "Go to sign-off" }).click();
    await page.getByRole("group", { name: "Brake lights", exact: true }).getByText("Pass", { exact: true }).click();
    await expect(page.getByText("· 1 failed")).toHaveCount(0);
    await expect(page.getByLabel("What is wrong?")).toHaveCount(0);
    await page.getByRole("checkbox").check();
    await drawSignature(page, page.getByRole("img", { name: "Technician signature" }));
    await page.getByRole("button", { name: "Sign and send to the driver" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Inspection recorded" })).toBeVisible();
    await expect(detail(page, "Result")).toHaveText("All items passed or not applicable");
    const code = (await page.getByText(/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/).innerText()).trim();
    // The code is a fingerprint of what was signed, so a changed form has a different one.
    expect(code).not.toBe(recall("failedCode"));
    keep("code", code);
    await shop.close();

    // Tessa is told the shop has signed, and her form is ready for her signature.
    await tessa.goto("/alerts");
    const alert = tessa.getByRole("button", { name: /Your shop signed your tech form/ }).first();
    await expect(alert).toContainText(`${SHOP.tech} at ${SHOP.name} completed the inspection.`);
    await alert.click();
    await expect(tessa).toHaveURL(/\/me\/tech$/);
    await expect(step(tessa, 2)).toContainText("Shop signed");
    const review = step(tessa, 3);
    await expect(shown(review.getByText("Can't submit yet"))).toHaveCount(0);
    await expect(review).not.toContainText("Failed item");
    await expect(review.getByRole("listitem").filter({ hasText: "Brake lights" })).toContainText("Pass");
    await expect(review).toContainText(`Verification code ${code}`);
    await expect(review.getByRole("button", { name: "Sign and submit to the tech team" })).toBeVisible();
  });

  test("the driver signs and submits; the form locks, shows the shop's verification code, and reaches the tech team", async ({ as }) => {
    test.skip(form().status !== "shop_signed" || form().shopName !== SHOP.name, "needs the shop's corrected sign-off from the test before");
    const tessa = await as("tessa");
    await tessa.goto("/me/tech");
    const review = step(tessa, 3);
    await review.getByLabel("I have read these three statements and certify that they are true.").check();
    await drawSignature(tessa, review.getByRole("img", { name: "Driver signature" }));
    await review.getByRole("button", { name: "Sign and submit to the tech team" }).click();

    // The form is now locked and waiting on the tech team.
    await expect(step(tessa, 4)).toContainText("In review");
    await expect(step(tessa, 4)).toContainText(/Submitted \w+ \d+, \d+:\d\d [AP]M\./);
    await expect(review.getByText("Signed", { exact: true })).toBeVisible();
    await expect(review).toContainText("Signed by Tessa Nakamura");
    const code = peek("code");
    if (code) await expect(review).toContainText(`Shop verification code ${code}.`);
    else await expect(review).toContainText(/Shop verification code [0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}\./);
    await expect(step(tessa, 4)).toContainText("The Chief Tech Inspector reviews forms before the event");
    await expect(tessa.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(tessa.getByRole("button", { name: /Send it back to the shop/ })).toHaveCount(0);
    await expect(shown(tessa.getByText("Shop inspection window"))).toHaveCount(0);
    await tessa.getByText("Show the full form").click();
    await expect(review.getByRole("img", { name: "Signature of Tessa Nakamura" })).toBeVisible();
    await expect(review.getByRole("img", { name: `Signature of ${SHOP.tech}` })).toBeVisible();

    await tessa.goto("/home");
    await expect(tessa.getByRole("link", { name: /^Shop inspection\s*Ready for review/ })).toBeVisible();
    // Nothing about tech is left on her to-do banner.
    await expect(tessa.getByRole("link", { name: /^Before you drive.*tech/i })).toHaveCount(0);

    // The Chief Tech Inspector gets an alert that opens her form, with the flags worked out for him.
    const hank = await as("hank");
    await hank.goto("/alerts");
    const alert = hank.getByRole("button", { name: /Tech form to review: Tessa Nakamura/ }).first();
    await expect(alert).toContainText(`2015 Porsche Cayman, #402. Signed by ${SHOP.name}.`);
    await alert.click();
    await expect(hank).toHaveURL(new RegExp(`/admin/tech/${form().id}$`));
    await expect(hank.getByRole("heading", { level: 1, name: "Tessa Nakamura" })).toBeVisible();
    await expect(hank.getByText("Ready for review")).toBeVisible();
    await expect(hank.getByText("Shop is not on the region's verified list")).toBeVisible();
    await expect(hank.getByText(/Seal intact: the\s+record matches what the technician signed/)).toBeVisible();
    if (code) await expect(hank.getByText(code)).toBeVisible();
    await expect(hank.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  });

  test("the tech team sends the form back; the driver sees why, and signs again to resubmit", async ({ as }) => {
    test.skip(form().status !== "submitted" || form().shopName !== SHOP.name, "needs the form submitted in the test before");
    const note = `Emergency contact phone number looks one digit short (${tag()}). Please check it and resubmit.`;
    const hank = await as("hank");
    await hank.goto(`/admin/tech/${form().id}`);
    await hank.getByRole("button", { name: "Request changes" }).click();
    const sheet = hank.getByRole("dialog");
    await sheet.getByLabel("What needs to change").fill(note);
    await sheet.getByRole("button", { name: "Send back to Tessa" }).click();
    await expect(hank.getByText(/Sent back by Hank Odom .+\. Waiting on Tessa to resubmit\./)).toBeVisible();
    await expect(hank.getByText("Changes requested", { exact: true })).toBeVisible();

    // Tessa gets an urgent alert with the reviewer's words, and the form explains what to do.
    const tessa = await as("tessa");
    await tessa.goto("/alerts");
    const alert = tessa.getByRole("button", { name: /Your tech form needs changes/ }).first();
    await expect(alert).toContainText("Urgent");
    await expect(alert).toContainText(note);
    await alert.click();
    await expect(tessa).toHaveURL(/\/me\/tech$/);
    await expect(tessa.getByText("The tech team sent your form back")).toBeVisible();
    await expect(step(tessa, 4)).toContainText("Changes requested");
    await expect(step(tessa, 4)).toContainText("What the reviewer said");
    await expect(step(tessa, 4)).toContainText(note);
    await expect(step(tessa, 3)).toContainText("If the fix needed your shop, redo step 2 first.");
    await tessa.goto("/home");
    await expect(tessa.getByRole("link", { name: /^Before you drive/ })).toContainText("Fix your tech form");
    await expect(tessa.getByRole("link", { name: /^Shop inspection/ })).toContainText(note);

    // She fixes the contact (no shop needed for that) and signs again.
    await tessa.goto("/me/tech");
    await step(tessa, 1).getByRole("button", { name: "Edit" }).click();
    await tessa.getByRole("dialog").getByLabel(/^Emergency contact and phone/).fill("Robin Nakamura, (912) 555-0175");
    await tessa.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(tessa.getByText("Details saved", { exact: true })).toBeVisible();
    const review = step(tessa, 3);
    await review.getByLabel("I have read these three statements and certify that they are true.").check();
    await drawSignature(tessa, review.getByRole("img", { name: "Driver signature" }));
    await review.getByRole("button", { name: "Sign and submit to the tech team" }).click();
    await expect(step(tessa, 4)).toContainText("In review");
    await expect(shown(tessa.getByText("The tech team sent your form back"))).toHaveCount(0);
    // The shop's signature still stands: she changed nothing the shop signed for.
    await expect(step(tessa, 2)).toContainText("Shop signed");
  });

  test("a driver cannot approve a tech form, their own or anyone else's; the tech team can, and the driver is told", async ({ as }) => {
    test.skip(form().status !== "submitted" || form().shopName !== SHOP.name, "needs the form resubmitted in the test before");
    const id = form().id;
    const tessa = await as("tessa");
    const owen = await as("owen");
    const hank = await as("hank");
    // Tessa leaves her tech page open while she waits.
    const listening = tessa.waitForResponse((r) => r.url().endsWith("/api/live"));
    await tessa.goto("/me/tech");
    await listening;
    await expect(step(tessa, 4)).toContainText("In review");
    const alertsBefore = Number(val(`select count(*) from notifications where user_id = '${userId("tessa")}' and read_at is null`));
    await hank.goto(`/admin/tech/${id}`);

    // When the administrator presses Approve, the very same request is first sent from each
    // driver's browser. Neither may change anything; then the administrator's own goes through.
    const tried: { who: string; status: number; sentTo: string; after: string }[] = [];
    await hank.route(`**/admin/tech/${id}`, async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || tried.length) return route.continue();
      const headers = { ...req.headers() };
      for (const h of ["cookie", "content-length", "host"]) delete headers[h];
      for (const [who, driver] of [["Tessa", tessa], ["Owen", owen]] as const) {
        const res = await driver.context().request.post(req.url(), { headers, data: req.postDataBuffer()!, maxRedirects: 0 });
        tried.push({ who, status: res.status(), sentTo: res.headers()["x-action-redirect"] ?? res.headers()["location"] ?? "", after: form().status });
      }
      await route.continue();
    });
    await hank.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(hank.getByText("Approved. The driver has been told")).toBeVisible();
    expect(tried.map((t) => t.who)).toEqual(["Tessa", "Owen"]);
    for (const t of tried) {
      expect(t.after, `${t.who}'s attempt left the form waiting for review`).toBe("submitted");
      expect(t.sentTo, `${t.who} was sent back to their own Now screen`).toContain("/home");
    }

    // The administrator's screen shows the decision.
    await expect(hank.getByText(/Approved by Hank Odom/)).toBeVisible();
    await expect(hank.getByText("Paperwork is approved, so the car is ready for grid tech.", { exact: false })).toBeVisible();
    await hank.goto("/admin/tech?tab=approved");
    await expect(hank.getByRole("link", { name: /Tessa Nakamura/ })).toBeVisible();

    // Tessa looks at the tab she left open: it has caught up by itself, with no reload. (The app
    // checks every 20 seconds and whenever its tab comes back to the front.)
    await tessa.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(step(tessa, 4)).toContainText("Approved");
    await expect(tessa.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Alerts/ })).toHaveText(new RegExp(`Alerts\\s*${alertsBefore + 1}$`));

    // The alert tells her what happens next, and every screen of hers agrees.
    await tessa.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Alerts/ }).click();
    const alert = tessa.getByRole("button", { name: /Your tech form is approved/ });
    await expect(alert).toContainText("bring the car to the tech shed with your helmet and your numbers on");
    await alert.click();
    await expect(tessa).toHaveURL(/\/me\/tech$/);
    await expect(step(tessa, 4)).toContainText("Approved");
    await expect(step(tessa, 4)).toContainText("Your paperwork is done.");
    await expect(step(tessa, 3)).toContainText("Signed by Tessa Nakamura");
    await expect(step(tessa, 5)).toContainText("Bring the car to the tech shed");
    await expect(tessa.getByRole("button", { name: /Sign and submit|Edit|Send it back/ })).toHaveCount(0);
    await tessa.goto("/home");
    await expect(tessa.getByRole("link", { name: /^Shop inspection\s*Reviewed and approved/ })).toBeVisible();
    // The sticker is still to come at the track, so she is not yet shown as cleared.
    await expect(tessa.getByRole("link", { name: /^Tech sticker\s*Issued at the tech shed/ })).toBeVisible();
    await expect(shown(tessa.getByText("Cleared to drive"))).toHaveCount(0);
    await tessa.goto("/me");
    await expect(tessa.getByRole("link", { name: /^Tech inspection\s*Approved/ })).toBeVisible();
  });
});
