import { expect, test } from "@playwright/test";

const STAFF_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const STAFF_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";

async function signInAsBlankOwner(page) {
  await page.goto("/app");
  const signInHeading = page.getByRole("heading", { name: "Staff Sign In" });
  const setupHeading = page.getByRole("heading", { name: "Configure Your Catalog" });
  await expect(signInHeading.or(setupHeading)).toBeVisible({ timeout: 45_000 });
  if (await signInHeading.isVisible()) {
    await page.getByLabel(/^Email$/i).fill(STAFF_EMAIL);
    await page.getByLabel(/^Password$/i).fill(STAFF_PASSWORD);
    await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  }
  await expect(setupHeading).toBeVisible({ timeout: 45_000 });
}

async function advanceBlankOwnerToPopulatedMenu(page) {
  await page.getByRole("button", { name: "New Quote" }).click();
  const eventType = page.getByLabel(/Event type/i);
  await eventType.selectOption("wedding-events");
  await page.getByLabel(/Event date/i).fill("2026-10-17");
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("80");
  await page.getByRole("textbox", { name: /Event name/i }).fill("Starter Catalog Proof");
  await page.getByRole("textbox", { name: /Venue/i }).first().fill("Starter Hall");
  await page.getByRole("textbox", { name: /Your name/i }).fill("E2E Owner");
  await page.getByRole("textbox", { name: /Email/i }).fill("owner@example.com");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { name: "Customized Cuisine Menu" })).toBeVisible({
    timeout: 45_000
  });
  await expect.poll(
    async () => page.locator(".menu-library input[type='checkbox']").count(),
    { timeout: 45_000 }
  ).toBeGreaterThan(0);
  await expect(page.getByRole("checkbox", { name: /Roasted Chicken/i })).toBeVisible();
}

test("blank owner stages a starter pack, reviews pricing, and unlocks quoting", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsBlankOwner(page);

  await page.getByRole("button", { name: "Open Admin Catalog" }).click();
  const catalogDialog = page.getByRole("dialog");
  await expect(catalogDialog.getByRole("heading", { name: "Catalog Admin" })).toBeVisible();
  const weddingCard = catalogDialog.locator(".starter-pack-card", { hasText: "Wedding & Events" });
  await expect(weddingCard).toContainText("22 menu items");
  await weddingCard.getByRole("button", { name: "Use Wedding & Events" }).click();

  await expect(catalogDialog.getByText("Your Wedding & Events catalog is populated."))
    .toBeVisible({ timeout: 45_000 });
  await expect(catalogDialog.getByRole("heading", { name: "Menu Management" })).toBeVisible();
  await expect.poll(
    async () => catalogDialog.locator(".admin-menu-row-managed").count(),
    { timeout: 45_000 }
  ).toBeGreaterThan(0);

  await catalogDialog.getByRole("button", { name: "Pricing", exact: true }).click();
  const pricingApproval = catalogDialog.getByLabel("Pricing setup reviewed and approved");
  await expect(pricingApproval).not.toBeChecked();
  await pricingApproval.check();
  const saveCatalog = catalogDialog.getByRole("button", { name: "Save catalog changes" }).first();
  await expect(saveCatalog).toBeEnabled();
  await saveCatalog.click();

  await expect(catalogDialog).toBeHidden({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "New Quote" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Configure Your Catalog" })).toHaveCount(0);
  await advanceBlankOwnerToPopulatedMenu(page);
});
