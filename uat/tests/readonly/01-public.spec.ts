import { test, expect, ERROR_PAGE } from "../guard";

// What anyone on the internet sees, with no sign-in. Tagged @public: this is the only part of the
// suite that runs against the live site. Forms are looked at, never submitted.
test.describe("signed out @public", () => {
  test("the sign-in page shows the form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: /Email me a code/ })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(ERROR_PAGE);
  });

  test("the home address sends a signed-out visitor to sign in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a protected page sends a signed-out visitor to sign in and remembers where they were going", async ({ page }) => {
    await page.goto("/schedule");
    await expect(page).toHaveURL(/\/login\?next=%2Fschedule/);
    await page.goto("/admin/roster");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Froster/);
  });

  test("the reminder job refuses a caller without its secret", async ({ anon }) => {
    const res = await anon.get("/api/cron/reminders");
    expect(res.status()).toBe(401);
    const wrong = await anon.get("/api/cron/reminders", { headers: { Authorization: "Bearer not-the-secret" } });
    expect(wrong.status()).toBe(401);
  });

  test("the live-update endpoint gives a signed-out caller nothing", async ({ anon }) => {
    const res = await anon.get("/api/live", { maxRedirects: 0 });
    expect([401, 307]).toContain(res.status());
    expect(await res.text()).not.toMatch(/"v":/);
  });

  test("an uploaded file is not served to a signed-out caller", async ({ anon }) => {
    const res = await anon.get("/api/files/tech/does-not-exist.jpg", { maxRedirects: 0 });
    expect(res.status()).not.toBe(200);
  });

  test("the roster export is not served to a signed-out caller", async ({ anon }) => {
    const res = await anon.get("/admin/roster/export", { maxRedirects: 0 });
    expect(res.status()).not.toBe(200);
    expect(res.headers()["content-type"] ?? "").not.toContain("csv");
  });

  test("a shop inspection link that does not exist says so without an error page", async ({ page }) => {
    const res = await page.goto("/tech/not-a-real-token");
    expect(res?.status() ?? 0).toBeLessThan(500);
    await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/i);
  });

  test("the app manifest and icons load", async ({ anon }) => {
    const manifest = await anon.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    const body = await manifest.json();
    expect(body.name).toBeTruthy();
    for (const icon of body.icons ?? []) {
      const res = await anon.get(icon.src);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()["content-type"], icon.src).toMatch(/image\//);
    }
  });

  test("the track guide documents are real PDFs", async ({ anon }) => {
    for (const name of ["roebling-road-rules", "flags", "cerpca-tech-form", "passing-zones-green-blue", "passing-zones-white"]) {
      const res = await anon.get(`/tracks/roebling-road/docs/${name}.pdf`);
      expect(res.status(), name).toBe(200);
      expect(res.headers()["content-type"], name).toContain("pdf");
      expect((await res.body()).subarray(0, 4).toString(), name).toBe("%PDF");
    }
  });

  test("nothing on the sign-in page tried to write just by being opened", async ({ page, blocked }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    expect(blocked).toEqual([]);
  });
});
