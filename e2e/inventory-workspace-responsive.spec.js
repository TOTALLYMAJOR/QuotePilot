import { expect, test } from "@playwright/test";
import { loadFirebaseAdmin } from "../scripts/firebase-admin-modular.mjs";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
];
const EVIDENCE_COLUMNS = [
  "Ingredient", "Physical on hand", "Committed", "Available to allocate", "Cost evidence", "Location", "Purchase packs"
];
const INVENTORY_ROUTE_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_INVENTORY_AUTHORITY_ENABLED || "").trim().toLowerCase()
) && ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED || "").trim().toLowerCase()
);
const FIREBASE_ROUTE_ACCEPTANCE = ["1", "true", "yes", "on"].includes(
  String(process.env.FIREBASE_INVENTORY_ROUTE_ACCEPTANCE || "").trim().toLowerCase()
);
const FIREBASE_PROJECT_ID = process.env.E2E_FIREBASE_PROJECT_ID || "demo-e2e";
const FIREBASE_ORGANIZATION_ID = process.env.E2E_FIREBASE_ORG_ID || "e2e-org";
const FIREBASE_STAFF_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const FIREBASE_STAFF_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";
const ROUTE_CATALOG = {
  source: "firebase-org",
  organizationName: "Responsive Inventory Catering",
  packages: [{ id: "package-dinner", name: "Dinner", ppp: 42, active: true }],
  eventTypes: [{ id: "dinner", name: "Dinner", active: true }],
  managedMenuItems: [{ id: "menu-chicken", name: "Chicken", cost: 8, active: true }],
  settings: {
    organizationName: "Responsive Inventory Catering",
    catalogRevision: 1,
    inventoryAuthorityEnabled: true,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "inventory-route-admin",
      actorEmail: "inventory-route-admin@example.test",
      confirmedCatalogRevision: 1,
      confirmedAtISO: "2026-09-22T11:00:00.000Z"
    },
    serviceFeePct: 0.2,
    taxRate: 0.08,
    depositPct: 0.3,
    perMileRate: 1,
    longDistancePerMileRate: 1,
    serverRate: 40,
    chefRate: 50,
    bartenderRate: 45,
    staffingLaborEnabled: false,
    eventTemplates: [{ id: "dinner", name: "Dinner" }]
  }
};

const model = {
  schemaVersion: 2,
  organizationId: "e2e-org",
  workspace: {
    organizationId: "e2e-org",
    locations: [{ locationId: "main-kitchen", name: "Main kitchen", active: true, revision: 1 }]
  },
  ingredients: [{
    organizationId: "e2e-org",
    ingredientId: "chicken",
    name: "Chicken",
    category: "Protein",
    active: true,
    stock: {
      state: "recorded",
      availability: "current",
      quantity: "40",
      committedQuantity: "25",
      availableToAllocateQuantity: "15",
      unit: "lb"
    },
    cost: {
      state: "not_recorded",
      availability: "not_yet_available"
    },
    packConversions: [{
      packUnitId: "case-40lb",
      packLabel: "40 lb case",
      baseUnitId: "lb",
      baseQuantity: "40",
      sourceLabel: "Supplier specification",
      revision: 2
    }],
    locationId: "main-kitchen",
    locationName: "Main kitchen"
  }],
  sources: {
    workspace: { state: "current", fromCache: false, hasPendingWrites: false },
    ingredients: { state: "current", fromCache: false, hasPendingWrites: false }
  },
  freshness: "current",
  bounded: false
};

test.beforeAll(async () => {
  if (!FIREBASE_ROUTE_ACCEPTANCE) return;
  const admin = loadFirebaseAdmin();
  if (!admin.getApps().length) admin.initializeApp({ projectId: FIREBASE_PROJECT_ID });
  const firestore = admin.getFirestore();
  await Promise.all([
    firestore.doc(`organizations/${FIREBASE_ORGANIZATION_ID}/settings/config`).set({
      inventoryAuthorityEnabled: true
    }, { merge: true }),
    firestore.doc(`organizations/${FIREBASE_ORGANIZATION_ID}/inventoryWorkspaceProjections/current`).set({
      authorityVersion: "inventory-ingredient-authority-v2",
      schemaVersion: 2,
      model: "inventory-workspace-projection-v2",
      organizationId: FIREBASE_ORGANIZATION_ID,
      projectionId: "current",
      workspaceRevision: 1,
      locations: [{ locationId: "main-kitchen", name: "Main kitchen", active: true, revision: 1 }],
      updatedAtISO: "2026-09-22T11:00:00.000Z"
    }),
    firestore.doc(`organizations/${FIREBASE_ORGANIZATION_ID}/inventoryIngredientProjections/chicken`).set({
      authorityVersion: "inventory-ingredient-authority-v2",
      schemaVersion: 2,
      model: "inventory-ingredient-projection-v2",
      organizationId: FIREBASE_ORGANIZATION_ID,
      ingredientId: "chicken",
      name: "Chicken",
      nameSortKey: "chicken",
      category: "Protein",
      baseUnitId: "lb",
      dimension: "mass",
      active: true,
      ingredientRevision: 1,
      stock: {
        availability: "current",
        stockRevision: 1,
        onHandMicros: 40_000_000,
        quantity: "40",
        locationId: "main-kitchen",
        lastMovementId: `imv_${"c".repeat(48)}`,
        allocationRevision: 1,
        committedMicros: 25_000_000,
        committedQuantity: "25",
        availableToAllocateMicros: 15_000_000,
        availableToAllocateQuantity: "15"
      },
      cost: {
        availability: "available",
        costRevision: 1,
        sourceLabel: "Opening invoice",
        observedAtISO: "2026-09-22T10:00:00.000Z",
        lastCostEvidenceId: `ice_${"d".repeat(48)}`,
        basisQuantityMicros: 40_000_000,
        totalCostMinor: 12_000,
        currency: "USD"
      },
      packConversions: [],
      updatedAtISO: "2026-09-22T11:00:00.000Z"
    })
  ]);
});

async function mountInventoryWorkspace(page) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      pageErrors.push(message.text());
      console.error(`Inventory browser: ${message.text()}`);
    }
  });
  await page.goto("/");
  await page.evaluate(async (projection) => {
    document.body.innerHTML = '<div id="inventory-responsive-harness"></div>';
    const [{ default: React }, ReactDomClient, { InventoryWorkspaceView }] = await Promise.all([
      import("/@id/react"),
      import("/@id/react-dom/client"),
      import("/src/components/InventoryWorkspace.jsx"),
      import("/src/styles.css")
    ]);
    const createRoot = ReactDomClient.createRoot || ReactDomClient.default.createRoot;
    const emptyAttempt = { state: "ready", error: "", requestId: "", receipt: null, confirmation: null };
    createRoot(document.getElementById("inventory-responsive-harness")).render(
      React.createElement(InventoryWorkspaceView, {
        access: {
          organizationId: "e2e-org",
          role: "admin",
          readEnabled: true,
          mutationEnabled: false,
          reason: ""
        },
        read: { state: "current", model: projection, error: "" },
        attempts: {
          location: emptyAttempt,
          ingredient: emptyAttempt,
          stock: emptyAttempt,
          receiving: emptyAttempt,
          cost: emptyAttempt,
          conversion: emptyAttempt
        },
        onRetry: () => {},
        onSubmit: () => {},
        onReconcile: () => {},
        onReset: () => {}
      })
    );
  }, model);
  await expect(page.getByRole("heading", { name: "Stock and cost by ingredient" })).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  return pageErrors;
}

async function expectNoPageOverflow(page) {
  const layout = await page.evaluate(() => ({
    bodyWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    escapedElements: [...document.querySelectorAll("main *")].filter((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.right > document.documentElement.clientWidth + 1
        && !element.closest(".inventory-evidence-table-wrap");
    }).map((element) => ({
      tag: element.tagName,
      className: element.className,
      right: element.getBoundingClientRect().right
    }))
  }));
  expect(layout.bodyWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

for (const viewport of VIEWPORTS) {
  test(`keeps all seven Inventory evidence axes reachable at ${viewport.width}px without page overflow`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const pageErrors = await mountInventoryWorkspace(page);
    await page.screenshot({ path: testInfo.outputPath("inventory-initial.png"), fullPage: true });
    await expectNoPageOverflow(page);

    const region = page.getByRole("region", { name: "Ingredient evidence table", includeHidden: true });
    const instruction = page.getByText("Scroll horizontally to review all seven evidence columns.");
    const cards = page.getByRole("list", { name: "Ingredient evidence cards", includeHidden: true });
    if (viewport.width <= 640) {
      await expect(region).toBeHidden();
      await expect(instruction).toBeHidden();
      await expect(cards).toBeVisible();
      const card = cards.locator('[data-inventory-phone-row="chicken"]');
      const disclosure = card.locator(":scope > details > summary");
      await expect(disclosure).toContainText("Chicken");
      await expect(disclosure).toContainText("Protein");
      await expect(disclosure).toContainText("15 lb");
      await disclosure.focus();
      await page.keyboard.press("Enter");
      await expect(card.locator(":scope > details")).toHaveAttribute("open", "");
      for (const [axis, value] of [
        ["Physical on hand", "40 lb"],
        ["Committed", "25 lb"],
        ["Available to allocate", "15 lb"],
        ["Cost evidence", "Cost not recorded"],
        ["Location", "Main kitchen"],
        ["Purchase packs", "1 declared"]
      ]) {
        const evidence = card.locator("dl > div").filter({ has: page.getByText(axis, { exact: true }) });
        await expect(evidence.locator("dt")).toBeVisible();
        await expect(evidence).toContainText(value);
      }
      await expect(card.getByText("40 − 25 = 15 lb", { exact: true })).toBeVisible();
      const packs = card.getByText("Show purchase-pack conversions", { exact: true });
      await packs.focus();
      await page.keyboard.press("Enter");
      await expect(card.getByText("1 40 lb case = 40 lb", { exact: true })).toBeVisible();
      await expectNoPageOverflow(page);
      expect(pageErrors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("inventory-expanded.png"), fullPage: true });
      return;
    }

    await expect(cards).toBeHidden();
    await expect(region).toBeVisible();
    await expect(region.locator("caption")).toHaveText(
      "Ingredient on-hand, committed, available-to-allocate, and independent purchase-cost evidence"
    );
    await expect(region.locator('th[scope="col"]')).toHaveText(EVIDENCE_COLUMNS);

    const layout = await region.evaluate((element) => ({
      bodyWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
      overscrollInline: getComputedStyle(element).overscrollBehaviorInline
    }));
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.left).toBeGreaterThanOrEqual(-1);
    expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.overflowX).toBe("auto");
    expect(layout.overscrollInline).toBe("contain");

    await region.focus();
    await expect(region).toBeFocused();
    const overflows = layout.scrollWidth > layout.clientWidth + 1;
    if (overflows) {
      await expect(instruction).toBeVisible();
      expect(await instruction.evaluate((element) => getComputedStyle(element).maxWidth)).not.toBe("none");
      for (let step = 0; step < 6; step += 1) {
        await page.keyboard.press("ArrowRight");
      }
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await region.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      const finalColumnBounds = await region.evaluate((element) => {
        const regionBounds = element.getBoundingClientRect();
        const finalHeaderBounds = element.querySelector('thead th:last-child').getBoundingClientRect();
        return {
          regionLeft: regionBounds.left,
          regionRight: regionBounds.right,
          headerLeft: finalHeaderBounds.left,
          headerRight: finalHeaderBounds.right
        };
      });
      expect(finalColumnBounds.headerLeft).toBeGreaterThanOrEqual(finalColumnBounds.regionLeft - 1);
      expect(finalColumnBounds.headerRight).toBeLessThanOrEqual(finalColumnBounds.regionRight + 1);
      const packs = region.getByText("Show 1 purchase pack", { exact: true });
      await packs.focus();
      await page.keyboard.press("Enter");
      await expect(region.getByRole("list", { name: "Declared purchase packs for Chicken" })).toContainText("1 case-40lb = 40 lb");
    } else {
      await expect(instruction).toBeVisible();
    }
    await expectNoPageOverflow(page);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("inventory-scrolled.png"), fullPage: true });
  });

  test(`keeps the visible Inventory evidence control focused in forced colors at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ forcedColors: "active" });
    const pageErrors = await mountInventoryWorkspace(page);

    const region = viewport.width <= 640
      ? page.getByRole("list", { name: "Ingredient evidence cards" }).locator('[data-inventory-phone-row="chicken"] > details > summary')
      : page.getByRole("region", { name: "Ingredient evidence table" });
    await expect(region).toBeVisible();
    await region.focus();
    await expect(region).toBeFocused();
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
    if (viewport.width > 640) {
      await expect(region).toHaveCSS("outline-style", "solid");
      await expect(region).toHaveCSS("outline-width", "3px");
      await expect(region).toHaveCSS("border-top-style", "solid");
      await expect(region).toHaveCSS("border-top-width", "1px");
    } else {
      await expect(region).not.toHaveCSS("outline-style", "none");
      expect(await region.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)))
        .toBeGreaterThanOrEqual(1);
      await page.keyboard.press("Enter");
      await expect(region.locator("..")).toHaveAttribute("open", "");
      await expect(region).toBeFocused();
      await expectNoPageOverflow(page);
    }
    expect(await region.evaluate((element) => {
      const styles = getComputedStyle(element);
      return [styles.outlineColor, styles.borderTopColor].every((color) => (
        color !== "transparent" && color !== "rgba(0, 0, 0, 0)"
      ));
    })).toBe(true);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("inventory-forced-colors.png"), fullPage: true });
  });
}

test("keeps the real Inventory route closed without tenant authority", async ({ page }) => {
  test.skip(
    FIREBASE_ROUTE_ACCEPTANCE || !INVENTORY_ROUTE_ENABLED,
    "Runs only in the local-fallback profile with browser gates enabled and tenant authority absent."
  );
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript((catalog) => {
    localStorage.setItem("quoteWizard.catalog.e2e-org", JSON.stringify(catalog));
  }, ROUTE_CATALOG);
  await page.goto("/app/inventory");

  await expect(page).toHaveURL(/\/app\/inventory$/u);
  const setupBypass = page.getByRole("button", { name: "Explore the workspace" });
  await expect(setupBypass).toBeVisible();
  await setupBypass.click();
  await expect.poll(() => pageErrors, { message: "Inventory route must render without an application error." })
    .toEqual([]);
  await expect(page.getByRole("heading", { name: "Workspace page not found" })).toBeVisible();
  await expect(page.locator("body")).toContainText("/app/inventory is not a QuotePilot staff workspace route.");
  await expect(page.locator('[data-capability-id="inventory-workspace"]')).toHaveCount(0);
});

test("renders evidence cards and the seven-axis table through the authenticated tenant-enabled Inventory route", async ({ page }) => {
  test.skip(!FIREBASE_ROUTE_ACCEPTANCE, "Requires the Firebase emulator tenant-authority profile.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");

  const signInHeading = page.getByRole("heading", { name: "Staff Sign In" });
  await expect(signInHeading).toBeVisible({ timeout: 45_000 });
  await page.getByLabel(/^Email$/i).fill(FIREBASE_STAFF_EMAIL);
  await page.getByLabel(/^Password$/i).fill(FIREBASE_STAFF_PASSWORD);
  await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("banner").getByRole("button", { name: "New quote", exact: true }))
    .toBeVisible({ timeout: 45_000 });

  await page.goto("/app/inventory");
  await expect(page).toHaveURL(/\/app\/inventory$/u);
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible({ timeout: 45_000 });
  const cards = page.getByRole("list", { name: "Ingredient evidence cards" });
  await expect(cards).toBeVisible({ timeout: 45_000 });
  const card = cards.locator('[data-inventory-phone-row="chicken"]');
  await card.locator(":scope > details > summary").click();
  await expect(card.locator("dt")).toHaveText(EVIDENCE_COLUMNS.slice(1));
  await expectNoPageOverflow(page);
  await page.setViewportSize({ width: 768, height: 900 });
  const region = page.getByRole("region", { name: "Ingredient evidence table" });
  await expect(region).toBeVisible({ timeout: 45_000 });
  await expect(region.locator('th[scope="col"]')).toHaveText(EVIDENCE_COLUMNS);
  await expect(page.getByText("Scroll horizontally to review all seven evidence columns.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
});
