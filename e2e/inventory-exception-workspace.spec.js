import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function mountFixture(page) {
  await page.addInitScript(() => { delete globalThis.BarcodeDetector; });
  await page.goto("/");
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module" src="/e2e/inventory-task4-fixture.jsx"></script></body></html>`);
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Task 4 exception-first inventory", () => {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 }
  ]) {
    test(`${viewport.name} preserves hierarchy, accessibility, manual capture, and recovery states`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mountFixture(page);

      const main = page.locator('[data-capability-id="inventory-workspace"]');
      await expect(main).toHaveAttribute("data-capability-state", "success");
      await expect(page.getByRole("heading", { name: "Inventory exceptions" })).toBeVisible();
      await expect(page.locator('[data-inventory-exception="shortage"]')).toContainText("no uncommitted stock");
      await expect(page.getByText("Manual search is always available", { exact: false })).toBeVisible();
      await expect(page.getByRole("button", { name: "Scan barcode" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);

      const disclosure = page.getByText("Seven-axis inventory ledger", { exact: true });
      await disclosure.focus();
      await expect(disclosure).toBeFocused();
      await disclosure.press("Enter");
      await expect(page.getByRole("columnheader", { name: "Physical on hand" })).toBeVisible();

      await page.getByRole("searchbox", { name: "Search shelf ingredients" }).fill("Chicken");
      await page.getByLabel("Count (lb)").fill("24");
      const save = page.getByRole("button", { name: "Save count to device" });
      const box = await save.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      await save.click();
      await expect(page.getByRole("status").filter({ hasText: "Count saved on this device only" })).toBeVisible();

      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(page.getByText("Offline: counts are local device truth only", { exact: false })).toBeVisible();
      await expect(page.getByRole("button", { name: "Submit clean counts" })).toBeDisabled();
      await page.evaluate(() => window.dispatchEvent(new Event("online")));

      await page.evaluate(() => window.inventoryTask4Harness.setMode("loading"));
      await expect(main).toHaveAttribute("data-capability-state", "loading");
      await expect(page.getByText("Loading server-confirmed ingredient evidence", { exact: false })).toBeVisible();
      await page.evaluate(() => window.inventoryTask4Harness.setMode("error"));
      await expect(main).toHaveAttribute("data-capability-state", "error");
      await expect(page.getByRole("button", { name: "Try inventory again" })).toBeVisible();
      await page.evaluate(() => window.inventoryTask4Harness.setMode("empty"));
      await expect(main).toHaveAttribute("data-capability-state", "empty");
      await expect(page.getByRole("heading", { name: "No ingredients recorded" })).toBeVisible();
      await page.evaluate(() => window.inventoryTask4Harness.setMode("current"));

      const results = await new AxeBuilder({ page }).include("main").analyze();
      expect(results.violations).toEqual([]);
      await expectNoHorizontalOverflow(page);
    });
  }
});
