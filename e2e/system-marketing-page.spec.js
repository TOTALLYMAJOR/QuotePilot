import { expect, test } from "@playwright/test";

test("saved system landing page presents the QuotePilot operating model and routes staff into the app", async ({ page }) => {
  await page.goto("/system");

  await expect(page.getByRole("heading", { name: /Move from first inquiry/i })).toBeVisible();
  await expect(page.getByRole("img", { name: /workflow map connecting inquiry/i })).toBeVisible();
  await expect(page.getByText("Connected is", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The workflow." })).toBeVisible();

  const appLinks = page.getByRole("link", { name: /Launch app|Open workspace|Launch QuotePilot/i });
  await expect(appLinks.first()).toHaveAttribute("href", "/app");

  await page.getByRole("button", { name: "Features" }).click();
  const drawer = page.getByRole("dialog", { name: "Traceable event scope" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("img", { name: /event scope panel/i })).toBeVisible();

  await drawer.getByRole("button", { name: /Good, Better, Best/i }).click();
  const scenarioDrawer = page.getByRole("dialog", { name: "Good, Better, Best" });
  await expect(scenarioDrawer).toBeVisible();
  await expect(scenarioDrawer.getByRole("img", {
    name: /Good, Better, and Best package comparison/i
  })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(scenarioDrawer).toHaveCount(0);
});

test("saved system landing page stays contained on mobile and honors reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/system");

  await expect(page.getByRole("heading", { name: /Move from first inquiry/i })).toBeVisible();
  await page.getByRole("button", { name: "Features" }).click();
  await expect(page.getByRole("dialog", { name: "Traceable event scope" })).toBeVisible();
  await page.keyboard.press("Escape");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const orbitDuration = await page.locator(".marketing-orbit-a").evaluate(
    (node) => getComputedStyle(node).animationDuration
  );
  expect(Number.parseFloat(orbitDuration)).toBeLessThanOrEqual(0.01);
});
