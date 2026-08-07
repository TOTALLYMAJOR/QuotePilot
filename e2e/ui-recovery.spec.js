import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

async function openOperationsItem(page, name) {
  await page.getByRole("button", { name: "Operations" }).click();
  await page.getByRole("menuitem", { name }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test("workspace dialogs trap focus, close on Escape, restore focus, and pass an accessibility scan", async ({ page }) => {
  await page.goto("/app");
  const operationsTrigger = page.getByRole("button", { name: "Operations" });
  await expect(operationsTrigger).toBeVisible();
  await openOperationsItem(page, "Session Diagnostics");

  const dialog = page.getByRole("dialog", { name: "Session Diagnostics" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  const focusable = dialog.locator(FOCUSABLE_SELECTOR);
  const visibleCount = await focusable.evaluateAll((elements) => (
    elements.filter((element) => element.getClientRects().length > 0).length
  ));
  expect(visibleCount).toBeGreaterThan(1);

  await dialog.evaluate((root, selector) => {
    const elements = Array.from(root.querySelectorAll(selector))
      .filter((element) => element.getClientRects().length > 0);
    elements[elements.length - 1].focus();
  }, FOCUSABLE_SELECTOR);
  await page.keyboard.press("Tab");
  await expect(focusable.filter({ visible: true }).first()).toBeFocused();

  await focusable.filter({ visible: true }).first().focus();
  await page.keyboard.press("Shift+Tab");
  await expect(focusable.filter({ visible: true }).last()).toBeFocused();

  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(operationsTrigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("Escape preserves the Catalog Admin unsaved-change guard", async ({ page }) => {
  await page.goto("/app");
  const operationsTrigger = page.getByRole("button", { name: "Operations" });
  await openOperationsItem(page, "Catalog Admin");

  const catalog = page.getByRole("dialog", { name: "Catalog Admin" });
  await expect(catalog).toBeVisible();
  await catalog.getByRole("button", { name: "Pricing" }).click();
  const businessName = catalog.getByLabel("Business name");
  await businessName.fill(`${await businessName.inputValue()} recovery test`);
  await expect(catalog.getByText("Unsaved changes")).toBeVisible();

  let guardMessage = "";
  page.once("dialog", async (guard) => {
    guardMessage = guard.message();
    await guard.dismiss();
  });
  await page.keyboard.press("Escape");
  await expect.poll(() => guardMessage).toBe("Discard unsaved catalog and branding changes?");
  await expect(catalog).toBeVisible();

  page.once("dialog", (guard) => guard.accept());
  await catalog.getByRole("button", { name: "Close" }).click();
  await expect(catalog).toHaveCount(0);
  await expect(operationsTrigger).toBeFocused();
});

test("a failed workspace chunk keeps the app usable with safe executable recovery actions", async ({ page }) => {
  let chunkRequestCount = 0;
  await page.route("**/src/components/DiagnosticsModal.jsx*", (route) => {
    chunkRequestCount += 1;
    return route.abort("failed");
  });
  await page.goto("/app");
  const operationsTrigger = page.getByRole("button", { name: "Operations" });
  await openOperationsItem(page, "Session Diagnostics");

  const recovery = page.getByRole("dialog", { name: "Session Diagnostics did not load" });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Try again" })).toBeFocused();
  await expect(recovery.getByRole("button", { name: "Reload workspace" })).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Close tool" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Quote" })).toBeVisible();
  await expect(recovery).not.toContainText(/Failed to fetch|DiagnosticsModal\.jsx|\/src\//i);

  const recoveryEvents = await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("quoteWizard.sessionDiagnostics") || "{}");
    return (snapshot.events || []).filter((event) => event.type === "ui.recovery");
  });
  expect(recoveryEvents).toEqual(expect.arrayContaining([
    expect.objectContaining({
      message: "A recoverable user interface surface required recovery.",
      context: expect.objectContaining({
        action: "failure",
        surface: "Session Diagnostics",
        surfaceKind: "tool",
        failureKind: "chunk_load"
      })
    })
  ]));
  expect(JSON.stringify(recoveryEvents)).not.toMatch(/Failed to fetch|DiagnosticsModal\.jsx|\/src\//i);

  await recovery.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => chunkRequestCount).toBeGreaterThanOrEqual(2);
  await expect(recovery).toBeVisible();
  const retryEvents = await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("quoteWizard.sessionDiagnostics") || "{}");
    return (snapshot.events || []).filter((event) => event.type === "ui.recovery");
  });
  expect(retryEvents).toEqual(expect.arrayContaining([
    expect.objectContaining({ context: expect.objectContaining({ action: "retry" }) })
  ]));

  await recovery.getByRole("button", { name: "Close tool" }).click();
  await expect(recovery).toHaveCount(0);
  await expect(operationsTrigger).toBeFocused();
  await expect(page.getByRole("button", { name: "New Quote" })).toBeVisible();
});

test("a failed public route offers recovery and Reload page executes a clean retry", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/src/components/SystemMarketingPage.jsx*", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/system");
  const heading = page.getByRole("heading", { name: "QuotePilot platform overview did not load" });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Back to QuotePilot" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/Failed to fetch|SystemMarketingPage\.jsx|\/src\//i);

  await page.getByRole("button", { name: "Reload page" }).click();
  await expect(page).toHaveURL(/\/system$/);
  await expect(page.getByRole("heading", { name: /Move from first inquiry/i })).toBeVisible();
  expect(requestCount).toBeGreaterThanOrEqual(2);
});
