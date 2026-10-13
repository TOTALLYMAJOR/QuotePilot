import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function mountFixture(page, { navigate = true } = {}) {
  await page.addInitScript(() => { delete globalThis.BarcodeDetector; });
  if (navigate) await page.goto("/");
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module" src="/e2e/inventory-task4-fixture.jsx"></script></body></html>`);
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page) {
  const evidence = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll("body *")]
      .map((element) => ({
        selector: [element, element.parentElement, element.parentElement?.parentElement, element.parentElement?.parentElement?.parentElement]
          .filter(Boolean)
          .map((node) => `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(" ").join(".")}` : ""}`)
          .reverse()
          .join(" > "),
        form: element.closest("form")?.getAttribute("aria-label") || "",
        region: element.closest("section")?.getAttribute("aria-labelledby") || "",
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width)
      }))
      .filter((entry) => entry.right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
  }));
  expect(evidence.overflow, JSON.stringify(evidence.offenders)).toBeLessThanOrEqual(1);
}

test.describe("Task 4 exception-first inventory", () => {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "tablet", width: 768, height: 1024 },
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

      // Shortage to operator-reviewed internal plan; this synthetic adapter never contacts a supplier.
      await page.getByLabel("Event supply plan").selectOption("quote-accepted");
      const supply = page.locator('[data-capability-id="event-supply-action-plan"]');
      await supply.getByLabel("Supplier reference", { exact: true }).fill("operator-supplier");
      await supply.getByLabel("Supplier label", { exact: true }).fill("Operator reviewed supplier");
      await supply.getByLabel("Planned quantity (lb)").fill("5");
      await supply.getByText("Exact policy and offer evidence", { exact: true }).click();
      await supply.getByLabel("Policy fingerprint").fill("d".repeat(64));
      await supply.getByLabel("Offer fingerprint").fill("e".repeat(64));
      await supply.getByRole("button", { name: "Save internal draft" }).click();
      await expect(supply).toHaveAttribute("data-capability-state", "receipt");
      await supply.getByRole("checkbox").check();
      await supply.getByRole("button", { name: "Approve internal plan" }).click();
      await expect(supply.locator("[data-supply-truth]")).toContainText("Plan: approved");
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
      await page.getByRole("button", { name: "Submit clean counts" }).click();
      await expect(page.locator('[data-capture-line-state="submitted"]')).toContainText("mock-chicken");

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
      await main.screenshot({ path: test.info().outputPath(`inventory-${viewport.width}.png`) });
    });
  }

  test("native drafts survive reload, isolate user scope, and retain receipt plus revision conflict", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mountFixture(page);
    await expect(page.locator('[data-e2e-authority="mock-server"]')).toBeVisible();

    await page.getByRole("searchbox", { name: "Search shelf ingredients" }).fill("Chicken");
    await page.getByLabel("Count (lb)").fill("24");
    const peer = await page.context().newPage();
    await peer.setViewportSize({ width: 768, height: 1024 });
    await mountFixture(peer);
    await peer.getByRole("searchbox", { name: "Search shelf ingredients" }).fill("Rice");
    await peer.getByLabel("Count (lb)").fill("16");
    await Promise.all([
      page.getByRole("button", { name: "Save count to device" }).click(),
      peer.getByRole("button", { name: "Save count to device" }).click()
    ]);
    await expect(page.getByRole("status").filter({ hasText: "Count saved on this device only" })).toBeVisible();
    await expect(peer.getByRole("status").filter({ hasText: "Count saved on this device only" })).toBeVisible();

    await page.reload();
    await mountFixture(page, { navigate: false });
    await expect(page.locator('[data-capture-line-state="draft"]').filter({ hasText: "Chicken" })).toBeVisible();
    await expect(page.locator('[data-capture-line-state="draft"]').filter({ hasText: "Rice" })).toBeVisible();
    await peer.close();

    await page.evaluate(() => window.inventoryTask4Harness.setUserId("other-e2e-admin"));
    await expect(page.getByText("No shelf-count draft at this location.")).toBeVisible();
    await expect(page.locator("[data-capture-line-state]")).toHaveCount(0);
    await page.evaluate(() => window.inventoryTask4Harness.setUserId("e2e-admin"));
    await expect(page.locator('[data-capture-line-state="draft"]').filter({ hasText: "Chicken" })).toBeVisible();

    await page.evaluate(() => window.inventoryTask4Harness.setRiceRevision(3));
    await page.getByRole("button", { name: "Submit clean counts" }).click();
    await expect(page.locator('[data-capture-line-state="submitted"]')).toContainText("Chicken");
    await expect(page.locator('[data-capture-line-state="submitted"]')).toContainText("mock-chicken");
    await expect(page.locator('[data-capture-line-state="conflict"]')).toContainText("Rice");
    await expect(page.getByRole("button", { name: "Review against current revision" })).toBeVisible();
  });
});
