import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const STAFF_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const STAFF_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";
const STARTER_STAFF_EMAIL = process.env.E2E_FIREBASE_SECOND_EMAIL || "e2e-admin-blank@local.test";
const STARTER_STAFF_PASSWORD = process.env.E2E_FIREBASE_SECOND_PASSWORD || "Passw0rd!";
const STARTER_ORGANIZATION_ID = process.env.E2E_FIREBASE_SECOND_ORG_ID || "e2e-org-blank";
const STARTER_PACK_TITLES = [
  "Wedding & events",
  "Corporate drop-off",
  "BBQ / Southern",
  "Church & community"
];
const OUTPUT_DIR = "output/playwright/first-quote-library-continuation";
const AMBIENT_LIBRARY_ENABLED = [
  process.env.VITE_AMBIENT_UI_ENABLED,
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(
  String(value || "").trim().toLowerCase()
));

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
  const catalogDialog = page.getByRole("dialog", { name: "Library settings" });
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

async function readAuthoritativeQuoteIds(page) {
  return page.evaluate(async (organizationId) => {
    const { getQuoteHistory } = await import("/src/lib/quoteStore.js");
    const history = await getQuoteHistory({ organizationId, includeDeleted: true });
    if (history.source !== "firebase") {
      throw new Error("Expected authoritative Firebase quote history.");
    }
    return history.quotes.map((quote) => quote.id).sort();
  }, STARTER_ORGANIZATION_ID);
}

test("blank owner stages a starter pack, reviews pricing, and unlocks quoting", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsBlankOwner(page, {
    email: STARTER_STAFF_EMAIL,
    password: STARTER_STAFF_PASSWORD
  });

  const catalogDialog = await openCatalogAdmin(page);
  await expect(catalogDialog.getByRole("heading", { name: "Library settings" })).toBeVisible();
  for (const pack of STARTER_PACK_TITLES) {
    await expect(catalogDialog.getByRole("heading", { name: pack })).toBeVisible();
  }
  const weddingCard = catalogDialog.locator(".starter-pack-card", { hasText: "Wedding & events" });
  await expect(weddingCard).toContainText("22 menu items");
  await weddingCard.getByRole("button", { name: "Use Wedding & events" }).click();

  await expect(catalogDialog.getByRole("heading", { name: "Menu Builder" }))
    .toBeVisible({ timeout: 45_000 });
  await expect(catalogDialog.getByRole("button", { name: /Assorted Lemonade/ })).toBeVisible({ timeout: 45_000 });

  await catalogDialog.getByRole("tab", { name: "Pricing", exact: true }).click();
  const pricingApproval = catalogDialog.getByLabel("Pricing setup reviewed and approved");
  await expect(pricingApproval).not.toBeChecked();
  await pricingApproval.check();
  const checkDraft = catalogDialog.getByRole("button", { name: "Check draft before publishing" });
  await expect(checkDraft).toBeEnabled({ timeout: 45_000 });
  await checkDraft.click();
  const publishLibrary = catalogDialog.getByRole("button", { name: "Publish Library" });
  await expect(publishLibrary).toBeEnabled({ timeout: 45_000 });
  await publishLibrary.click();
  await expect(catalogDialog.getByText("Published Library is active", { exact: true })).toBeVisible({ timeout: 60_000 });
  await closeOverlayDialog(catalogDialog).click();

  await expect(catalogDialog).toBeHidden({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "New Quote" }).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Bring Your Catalog to Life" })).toHaveCount(0);

  if (AMBIENT_LIBRARY_ENABLED) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/app/catalog");
    await expect(page.locator("#ambient-library-title")).toHaveText("The choices behind every quote.", {
      timeout: 45_000
    });
    const action = page.locator('[data-library-start-quote="true"]');
    await expect(action).toHaveAccessibleName("Start a quote");
    await expect(page.getByText(
      "Opens a new quote draft. Nothing is saved until you complete and save it.",
      { exact: true }
    )).toBeVisible();
    await page.screenshot({
      path: `${OUTPUT_DIR}/admin-desktop-library-ready.png`,
      fullPage: true
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(action).toBeVisible();
    await page.screenshot({
      path: `${OUTPUT_DIR}/admin-mobile-library-ready.png`,
      fullPage: true
    });

    const quoteIdsBeforeDraft = await readAuthoritativeQuoteIds(page);
    expect(quoteIdsBeforeDraft).toEqual([]);
    await action.click();
    await expect(page).toHaveURL(/\/app\/quotes\/new$/u);
    await expect(page.getByRole("heading", { name: "What are you planning?" })).toBeVisible();
    await expect(page.getByText(/Nothing is saved or sent from here/u)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Quote (created|saved|completed)/u);
    expect(await readAuthoritativeQuoteIds(page)).toEqual(quoteIdsBeforeDraft);
  }
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
  const manualEntry = catalogDialog.getByRole("button", { name: "Set up Library manually" });
  if (await manualEntry.isVisible()) {
    await manualEntry.click();
  }

  await catalogDialog.getByRole("tab", { name: "Menu" }).click();
  await expect(catalogDialog.getByText("Loading menu data...")).toBeHidden({ timeout: 30_000 });
  const eventType = catalogDialog.getByRole("combobox", { name: "Event type", exact: true });
  if (await eventType.count() === 0 || await eventType.locator("option").count() <= 1) {
    await catalogDialog.getByLabel("New event type name").fill("Pilot events");
    await catalogDialog.getByRole("button", { name: "Add Event Type", exact: true }).click();
    await expect(catalogDialog.getByText('Event type "Pilot events" added to the setup draft.')).toBeVisible({ timeout: 30_000 });
  }
  const menuSection = catalogDialog.getByRole("combobox", { name: "Menu section", exact: true });
  if (await menuSection.count() === 0 || await menuSection.locator("option").count() <= 1) {
    await catalogDialog.getByLabel("New menu section name").fill("Entrées");
    await catalogDialog.getByRole("button", { name: "Add Menu Section", exact: true }).click();
    await expect(catalogDialog.getByText('Menu section "Entrées" added to the setup draft.')).toBeVisible({ timeout: 30_000 });
  }

  await expect(catalogDialog.getByText("Draft ready to check", { exact: true })).toBeVisible({ timeout: 30_000 });
  await catalogDialog.getByLabel("New menu item name").fill("Pilot chicken");
  await catalogDialog.locator('input[aria-label="New menu item price"]:visible').fill("18");
  await catalogDialog.getByRole("button", { name: "Add Item" }).click();
  await expect(catalogDialog.getByText("Menu item added to the setup draft.")).toBeVisible({ timeout: 30_000 });
  await expect(catalogDialog.getByRole("button", { name: /Pilot chicken/ })).toBeVisible();
});
