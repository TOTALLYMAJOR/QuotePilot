import { expect, test } from "@playwright/test";

test("public marketing page presents the QuotePilot system and routes staff into the app", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Move from first inquiry/i })).toBeVisible();
  await expect(page.getByRole("img", { name: /workflow map connecting inquiry/i })).toBeVisible();
  await expect(page.getByText("Connected is", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The workflow." })).toBeVisible();

  const appLinks = page.getByRole("link", { name: /Launch app|Open workspace|Launch QuotePilot/i });
  await expect(appLinks.first()).toHaveAttribute("href", "/app");
});

test("marketing page stays contained on mobile and honors reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Move from first inquiry/i })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const orbitDuration = await page.locator(".marketing-orbit-a").evaluate((node) => getComputedStyle(node).animationDuration);
  expect(Number.parseFloat(orbitDuration)).toBeLessThanOrEqual(0.01);
});

