import { expect, test } from "@playwright/test";

const STAFF_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const STAFF_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";
const STARTER_STAFF_EMAIL = process.env.E2E_FIREBASE_SECOND_EMAIL || "e2e-admin-blank@local.test";
const STARTER_STAFF_PASSWORD = process.env.E2E_FIREBASE_SECOND_PASSWORD || "Passw0rd!";
const STARTER_PACK_TITLES = [
  "Wedding & events",
  "Corporate drop-off",
  "BBQ / Southern",
  "Church & community"
];

async function signInAsBlankOwner(page, {
  email = STAFF_EMAIL,
  password = STAFF_PASSWORD
} = {}) {
  await page.goto("/app");
  const signInHeading = page.getByRole("heading", { name: "Staff Sign In" });
  const setupHeading = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  await expect(signInHeading.or(setupHeading)).toBeVisible({ timeout: 45_000 });
  if (await signInHeading.isVisible()) {
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/^Password$/i).fill(password);
    await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  }
  await expect(setupHeading).toBeVisible({ timeout: 45_000 });
}

async function openCatalogAdmin(page) {
  await page.getByRole("button", { name: "Choose a starter or build my catalog" }).click();
  const catalogDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Catalog Admin" }) });
  await expect(catalogDialog).toBeVisible();
  return catalogDialog;
}

async function openImportStudio(page) {
  await page.getByRole("button", { name: "Import my menu" }).click();
  const importDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Import Studio" }) });
  await expect(importDialog).toBeVisible();
  return importDialog;
}

function closeOverlayDialog(dialog, { preferGhost = false } = {}) {
  return preferGhost
    ? dialog.getByRole("button", { name: "Close" })
    : (dialog.getByRole("button", { name: "Close" }).or(dialog.getByRole("button", { name: "Back to Home" })));
}

async function advanceBlankOwnerToPopulatedMenu(page) {
  await page.getByRole("button", { name: "New Quote" }).first().click();
  const guidedMode = page.getByRole("button", { name: "Guided mode" });
  if (await guidedMode.isVisible()) {
    await guidedMode.click();
  }
  const eventType = page.getByLabel(/Event type/i);
  await eventType.selectOption("wedding-events");
  await page.getByLabel(/Event date/i).fill("2026-10-17");
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("80");
  await page.getByRole("textbox", { name: /Event name/i }).fill("Starter Catalog Proof");
  await page.getByRole("textbox", { name: /Venue/i }).first().fill("Starter Hall");
  await page.getByRole("textbox", { name: /Your name/i }).fill("E2E Owner");
  await page.getByRole("textbox", { name: /Email/i }).fill("owner@example.com");
  await page.getByRole("button", { name: /^Next:/ }).click();

  await expect(page.getByRole("heading", { name: /Build the menu|Customized Cuisine Menu/i })).toBeVisible({
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
  await signInAsBlankOwner(page, {
    email: STARTER_STAFF_EMAIL,
    password: STARTER_STAFF_PASSWORD
  });

  const catalogDialog = await openCatalogAdmin(page);
  await expect(catalogDialog.getByRole("heading", { name: "Catalog Admin" })).toBeVisible();
  for (const pack of STARTER_PACK_TITLES) {
    await expect(catalogDialog.getByRole("heading", { name: pack })).toBeVisible();
  }
  const weddingCard = catalogDialog.locator(".starter-pack-card", { hasText: "Wedding & events" });
  await expect(weddingCard).toContainText("22 menu items");
  await weddingCard.getByRole("button", { name: "Use Wedding & events" }).click();

  await expect(catalogDialog.getByText("Your Wedding & events catalog is populated."))
    .toBeVisible({ timeout: 45_000 });
  await catalogDialog.getByRole("button", { name: "View populated menu" }).click();
  await expect(catalogDialog.getByRole("heading", { name: "Menu Management" })).toBeVisible();
  await expect.poll(
    async () => catalogDialog.locator(".admin-menu-row-managed").count(),
    { timeout: 45_000 }
  ).toBeGreaterThan(0);

  await catalogDialog.getByRole("tab", { name: "Pricing", exact: true }).click();
  const pricingApproval = catalogDialog.getByLabel("Pricing setup reviewed and approved");
  await expect(pricingApproval).not.toBeChecked();
  await pricingApproval.check();
  const saveCatalog = catalogDialog.getByRole("button", { name: "Save catalog changes" }).first();
  await expect(saveCatalog).toBeEnabled();
  await saveCatalog.click();

  await expect(catalogDialog).toBeHidden({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "New Quote" }).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Bring Your Catalog to Life" })).toHaveCount(0);
  await advanceBlankOwnerToPopulatedMenu(page);
});

test("blank owner can bypass setup and enter workspace", async ({ page }) => {
  test.setTimeout(60_000);
  await signInAsBlankOwner(page);

  await page.getByRole("button", { name: "Explore the workspace" }).click();
  await expect(page.getByRole("button", { name: "New Quote" }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Bring Your Catalog to Life" })).toHaveCount(0);
});

test("blank owner can open import studio during setup", async ({ page }) => {
  test.setTimeout(60_000);
  await signInAsBlankOwner(page);

  const importDialog = await openImportStudio(page);
  await expect(importDialog.getByRole("heading", { name: "Import Studio" })).toBeVisible();
  await expect(importDialog).toContainText("Adding only to");

  await closeOverlayDialog(importDialog).click();
  await expect(importDialog).toBeHidden({ timeout: 30_000 });
});

test("blank owner can switch to manual catalog entry path", async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsBlankOwner(page);

  const catalogDialog = await openCatalogAdmin(page);
  const manualEntry = catalogDialog.getByRole("button", { name: "Create my own catalog" });
  if (await manualEntry.isVisible()) {
    await manualEntry.click();
  }

  await catalogDialog.getByRole("tab", { name: "Menu" }).click();
  await expect(catalogDialog.getByText("Loading menu data...")).toBeHidden({ timeout: 30_000 });
  const eventType = catalogDialog.getByRole("combobox", { name: "Event type", exact: true });
  if (await eventType.locator("option").count() === 1) {
    await catalogDialog.getByLabel("New event type name").fill("Pilot events");
    await catalogDialog.getByRole("button", { name: "Add Event Type" }).click();
    await expect(catalogDialog.getByText('Event type "Pilot events" added.')).toBeVisible({ timeout: 30_000 });
    await catalogDialog.getByRole("tab", { name: "Menu" }).click();
  }
  const refreshedEventType = catalogDialog.getByRole("combobox", { name: "Event type", exact: true });
  await refreshedEventType.selectOption({ label: "Pilot events" });
  const category = catalogDialog.getByRole("combobox", { name: "Category", exact: true });
  if (await category.locator("option").count() === 1) {
    await catalogDialog.getByLabel("New category name").fill("Entrées");
    await catalogDialog.getByRole("button", { name: "Add Category" }).click();
    await expect(catalogDialog.getByText('Category "Entrées" added.')).toBeVisible({ timeout: 30_000 });
    await catalogDialog.getByRole("tab", { name: "Menu" }).click();
    await catalogDialog.getByRole("combobox", { name: "Event type", exact: true })
      .selectOption({ label: "Pilot events" });
  }
  await catalogDialog.getByRole("combobox", { name: "Category", exact: true })
    .selectOption({ label: "Entrées" });

  await expect(catalogDialog.getByRole("tab", { name: "Packages" })).toBeVisible();
  await catalogDialog.getByRole("tab", { name: "Packages" }).click();
  await expect(catalogDialog.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await catalogDialog.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(catalogDialog.getByLabel(/Package 1 name/)).toBeVisible();
  await catalogDialog.getByLabel(/Package 1 name/).fill("Pilot Starter");
  await catalogDialog.getByLabel(/Package 1 price per person/i).fill("45");
  await expect(catalogDialog.getByRole("button", { name: "Save catalog changes" }).first()).toBeEnabled();

  await catalogDialog.getByRole("tab", { name: "Menu" }).click();
  await catalogDialog.getByLabel("New menu item name").fill("Pilot chicken");
  await catalogDialog.getByLabel("New menu item price").fill("18");
  await catalogDialog.getByRole("button", { name: "Add Item" }).click();
  await expect(catalogDialog.getByText("Menu item added.")).toBeVisible({ timeout: 30_000 });
  await expect(catalogDialog.getByRole("textbox", { name: "Pilot chicken name" })).toBeVisible();
});
