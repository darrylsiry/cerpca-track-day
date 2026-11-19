import { test, expect, signIn, sql, val, PEOPLE, ERROR_PAGE } from "./fixtures";

// Getting in and out: the sample accounts, the emailed one-time code, and what a signed-out or
// wrong-role visitor is shown.

test.describe("signing in", () => {
  test("each sample person can sign in with one tap and lands on their own Now screen", async ({ page, context }) => {
    for (const who of Object.keys(PEOPLE) as (keyof typeof PEOPLE)[]) {
      await signIn(page, who);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText(ERROR_PAGE);
      // Their own profile, not someone else's.
      await page.goto("/me");
      await expect(page.locator("body")).toContainText(PEOPLE[who].name.split(" ")[0]);
      await context.clearCookies();
    }
  });

  test("a one-time code signs a person in, and a wrong code does not", async ({ page }) => {
    const email = PEOPLE.owen.email;
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /Email me a code/ }).click();
    await expect(page.getByLabel("Sign-in code")).toBeVisible();
    // No email service is connected in the sandbox, so demo mode shows the code on the screen.
    const notice = page.getByText(/Your code is/);
    await expect(notice).toBeVisible();
    const code = ((await notice.textContent()) ?? "").match(/\d{6}/)?.[0] ?? "";
    expect(code, "a 6-digit code on screen").toMatch(/^\d{6}$/);

    const wrong = code === "000000" ? "111111" : "000000";
    await page.getByLabel("Sign-in code").fill(wrong);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/wrong or has expired/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Sign-in code").fill(code);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/home");
    await page.goto("/me");
    await expect(page.locator("body")).toContainText("Owen");
  });

  test("an address that is not on a roster gets the same answer and no code", async ({ page }) => {
    const email = "nobody.at.all@example.com";
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /Email me a code/ }).click();
    await expect(page.getByLabel("Sign-in code")).toBeVisible();
    await expect(page.getByText(/Your code is/)).toHaveCount(0);
    // Nothing is emailed to it. (A code nobody knows is stored, so the form takes the same time either way.)
    expect(val(`select count(*) from message_log where to_address = '${email}'`)).toBe("0");
  });

  test("a code cannot be reused", async ({ page, context }) => {
    const email = PEOPLE.arjun.email;
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /Email me a code/ }).click();
    const code = ((await page.getByText(/Your code is/).textContent()) ?? "").match(/\d{6}/)?.[0] ?? "";
    await page.getByLabel("Sign-in code").fill(code);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/home");
    await context.clearCookies();

    // Ask for the code screen again without requesting a new code is not possible, so request one
    // and then try the old code: it must be refused.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /Email me a code/ }).click();
    await expect(page.getByLabel("Sign-in code")).toBeVisible();
    const fresh = ((await page.getByText(/Your code is/).textContent()) ?? "").match(/\d{6}/)?.[0] ?? "";
    test.skip(fresh === code, "the new code happened to equal the old one");
    await page.getByLabel("Sign-in code").fill(code);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/wrong or has expired/)).toBeVisible();
  });

  test("a driver who types an administrator address is not shown the administrator page", async ({ page }) => {
    await signIn(page, "owen");
    await page.goto("/admin/roster");
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(new URL(page.url()).pathname, "where a driver lands").not.toMatch(/^\/admin/);
    await expect(page.locator("body")).not.toContainText("tessa.nakamura@example.com");
    const csv = await page.context().request.get("/admin/roster/export", { maxRedirects: 0 });
    expect(csv.headers()["content-type"] ?? "").not.toContain("csv");
  });

  test("sessions are stored hashed, never as the cookie value", async ({ page, context }) => {
    await signIn(page, "simone");
    const cookie = (await context.cookies()).find((c) => c.name === "td_session");
    expect(cookie?.httpOnly, "the session cookie is hidden from page scripts").toBe(true);
    expect(sql(`select 1 from sessions where id = '${cookie!.value.replace(/'/g, "")}'`).length, "the raw cookie value is not a session id").toBe(0);
  });
});
