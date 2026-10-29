import { test, expect } from "@playwright/test";

/**
 * Browser smoke tests for the public discovery journey.
 *
 * Setup:  npx playwright install chromium
 * Run:    npm run test:e2e
 *
 * The previous revision referenced selectors that do not exist in the app
 * (`/What do you need/i` placeholder), so it could never pass. These assertions
 * use only landmarks and copy that are rendered unconditionally, so an empty
 * database still produces a green run.
 */
test("visitor searches from the home page and lands on results", async ({ page }) => {
  await page.goto("/");
  // The header renders its own search form before the hero, so a global
  // "Search" button lookup clicked the header's empty form and never navigated.
  // This field's accessible name is unique to the hero, and pressing Enter
  // submits exactly the form that owns it.
  const search = page.getByRole("textbox", { name: /Search for real availability/i }).first();
  await expect(search).toBeVisible();
  await search.fill("Rice");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=Rice/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/product listings/i);
});

test("compare page explains merchant-listed pricing without fabricated history", async ({ page }) => {
  await page.goto("/compare?productName=Paracetamol");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Compare listings/i);
  await expect(page.getByText(/merchant-listed/i).first()).toBeVisible();
});

test("manual area selection works without GPS permission", async ({ page }) => {
  await page.goto("/search?area=Garki");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/product listings/i);
  await expect(page.getByText(/Scope:/i).first()).toBeVisible();
});

test("merchant contact details are not present in public page source", async ({ page }) => {
  // Whatever listing happens to be first, the phone number must not be in the
  // HTML that an unauthenticated crawler receives.
  await page.goto("/search");
  const html = await page.content();
  expect(html).not.toMatch(/href="tel:/);
});

test("an unknown URL shows the branded 404 with routes back into the app", async ({ page }) => {
  // Before src/app/not-found.tsx existed, Next's bare default screen was served
  // for every unknown URL and gave the visitor no way back.
  const response = await page.goto("/definitely-not-a-real-page-xyz");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/does not exist/i);
  await expect(page.getByRole("link", { name: /Search listings/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Home/i }).first()).toBeVisible();
});
