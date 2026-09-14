import { expect, test } from "@playwright/test";

const PROPOSAL_COMPOSER_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_PROPOSAL_COMPOSER_ENABLED || "").trim().toLowerCase()
);

test.skip(!PROPOSAL_COMPOSER_ENABLED, "Proposal Composer flag is off in this lane.");

const deliveryCatalog = {
  packages: [{
    id: "classic",
    name: "Classic staffed buffet",
    ppp: 18,
    active: true,
    includedMenuItemIds: [],
    includedAddonIds: [],
    includedRentalIds: [],
    deliveryBlueprintRef: { id: "staffed-buffet", revision: "7" }
  }],
  addons: [],
  rentals: [],
  settings: {
    pricingSetupConfirmed: true,
    catalogRevision: 12,
    pricingConfirmation: {
      actorUid: "e2e-operator",
      actorEmail: "e2e-operator@example.test",
      confirmedAtISO: "2026-09-01T14:00:00.000Z",
      confirmedCatalogRevision: 12
    },
    deliveryPlanningEnabled: true,
    deliveryBlueprints: [{
      schemaVersion: "delivery-blueprint-v1",
      id: "staffed-buffet",
      revision: "7",
      label: "Staffed buffet",
      publicationState: "published",
      declaredBy: "e2e-operator",
      declaredAtISO: "2026-09-01T14:00:00.000Z",
      provenance: "local e2e fixture",
      compatibleServiceFormats: ["Buffet"],
      workBlocks: [{
        id: "kitchen-prep",
        label: "Kitchen prep",
        timing: { anchor: "service_start", offsetMinutes: -180, durationMinutes: 120 },
        requiredCapabilities: ["kitchen-prep"]
      }],
      productionComponents: [{
        componentId: "roasted-chicken",
        label: "Roasted chicken",
        required: true,
        quantityPolicyRef: { id: "chicken-portions", revision: "4" }
      }]
    }],
    quantityPolicies: [{
      schemaVersion: "quantity-policy-v1",
      id: "chicken-portions",
      revision: "4",
      publicationState: "published",
      declaredBy: "e2e-operator",
      declaredAtISO: "2026-09-01T14:00:00.000Z",
      provenance: "local e2e fixture",
      input: { kind: "guest_count", minimumGuestCount: 1, maximumGuestCount: 400 },
      output: { unitId: "portion", numerator: 6, denominator: 5, rounding: "ceil" },
      ingredients: [{
        ingredientId: "chicken-breast",
        label: "Chicken breast",
        unitId: "lb",
        quantityPerOutputMicros: 100000,
        purchasingPackRef: { id: "chicken-case", revision: "2" }
      }]
    }],
    purchasingPacks: [{
      id: "chicken-case",
      revision: "2",
      publicationState: "published",
      unitId: "lb",
      quantityMicros: 5000000
    }],
    eventTemplates: [{
      id: "corporate",
      name: "Corporate staffed buffet",
      pkg: "classic",
      style: "Buffet",
      deliveryBlueprintRef: { id: "staffed-buffet", revision: "7" }
    }],
    menuSections: [{
      id: "mains",
      name: "Mains",
      items: [{ id: "roasted-chicken", name: "Roasted chicken", active: true, price: 0, type: "per_person" }]
    }]
  }
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((catalog) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("quoteWizard.catalog", JSON.stringify(catalog));
    localStorage.setItem("quoteWizard.catalog.e2e-org", JSON.stringify(catalog));
  }, deliveryCatalog);
  await page.goto("/app/quotes/new");
  await expect(page.getByTestId("proposal-composer")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("delivery-proposal")).toBeVisible();
});

test("keeps advisory evidence and conflicts explicit without blocking the commercial draft", async ({ page }) => {
  const proposal = page.getByTestId("delivery-proposal");
  await expect(proposal).toHaveAttribute("data-delivery-proposal-state", "conflict");
  await expect(proposal).toContainText("Roasted chicken is required");
  await expect(proposal).toContainText("Staffing");
  await expect(proposal).toContainText("Unchecked");
  await expect(page.getByTestId("pc-save")).toBeEnabled();
  await page.getByRole("button", { name: "Review production" }).click();
  await expect(proposal.getByRole("status")).toContainText("Save the quote before opening production review");
});

test("keeps tenant activation in Library behind exact reviewed source", async ({ page }) => {
  await page.goto("/app/catalog");
  const deliveryTab = page.getByRole("tab", { name: "Delivery" });
  await expect(deliveryTab).toBeVisible({ timeout: 30_000 });
  await deliveryTab.click();

  const configuration = page.getByTestId("delivery-planning-configuration");
  await expect(configuration).toBeVisible();
  await expect(configuration).toContainText("Enabled in this draft");
  await expect(configuration).toContainText("QuotePilot will not infer them");
  await expect(configuration).toContainText("Exact published revisions only");
  await expect(configuration.getByRole("checkbox")).toBeChecked();

  const catalogCard = page.locator(".admin-catalog-card");
  await catalogCard.evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({
    path: "output/playwright/delivery-planning/delivery-configuration-1440.png"
  });
  await configuration.getByText("Reviewed source", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/delivery-planning/delivery-configuration-1440-bottom.png"
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await catalogCard.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  expect(await configuration.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: "output/playwright/delivery-planning/delivery-configuration-390.png"
  });
  await configuration.getByText("Reviewed source", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/delivery-planning/delivery-configuration-390-bottom.png"
  });
});

test("survives responsive, keyboard, forced-colors, and 200 percent layout pressure", async ({ page }, testInfo) => {
  const proposal = page.getByTestId("delivery-proposal");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(proposal).toBeVisible();
    const overflow = await proposal.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, `Delivery Proposal should not overflow at ${width}px`).toBeLessThanOrEqual(1);
    if (width === 1440 || width === 390) {
      const screenshot = await page.screenshot({
        fullPage: true,
        path: `output/playwright/delivery-planning/delivery-proposal-${width}.png`,
      });
      await testInfo.attach(`delivery-proposal-${width}`, {
        body: screenshot,
        contentType: "image/png",
      });
    }
  }

  await page.getByRole("button", { name: "Review staffing" }).focus();
  await expect(page.getByRole("button", { name: "Review staffing" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(proposal.getByRole("status")).toContainText("Save the quote before opening staffing review");

  await page.emulateMedia({ forcedColors: "active" });
  await expect(proposal).toHaveCSS("border-top-style", "solid");

  await page.emulateMedia({ forcedColors: "none" });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "200%";
  });
  await page.setViewportSize({ width: 768, height: 900 });
  const zoomOverflow = await proposal.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(zoomOverflow).toBeLessThanOrEqual(1);
});
