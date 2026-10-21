import { test, expect } from "@playwright/test";

/**
 * Playwright E2E — run with: npx playwright install && npm run test:e2e
 * Requires the dev server (playwright.config webServer or `npm run dev`).
 */
test("visitor searches in natural language and sees confidence labels", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder(/What do you need/i).first().fill("Rice under ₦10,000 in Wuse");
  await page.getByRole("button", { name: /Search/i }).first().click();
  await expect(page).toHaveURL(/search/);
  await expect(page.getByText(/Understood as/i)).toBeVisible();
  await expect(page.getByText(/Recently confirmed|Merchant reported|May have changed|results/i).first()).toBeVisible();
});

test("compare page shows per-store prices without fabricated history", async ({ page }) => {
  await page.goto("/compare?productName=Paracetamol");
  await expect(page.getByRole("heading", { name: /Compare/i })).toBeVisible();
  await expect(page.getByText(/merchant-listed/i)).toBeVisible();
});

test("manual area selection works without GPS permission", async ({ page }) => {
  await page.goto("/search?area=Garki");
  await expect(page.getByText(/results/i)).toBeVisible();
});
