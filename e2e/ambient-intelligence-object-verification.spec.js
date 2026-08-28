import { expect, test } from "@playwright/test";

const AMBIENT_UI_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_AMBIENT_UI_ENABLED || "").trim().toLowerCase()
);
const PILOT_COMMAND_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_PILOT_COMMAND_ENABLED || "").trim().toLowerCase()
);
const CAPTURE_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_AMBIENT_BROWSER_PROOF || "").trim().toLowerCase()
);
const ATTENDANCE_PROOF_STAGE = String(
  process.env.ATTENDANCE_PROOF_STAGE || "current"
).trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "current";
const PROOF_DIRECTORY = "output/playwright/ambient-intelligence-current";
const ATTENDANCE_PROOF_DIRECTORY = "output/playwright/quotepilot-attendance-strip-audit";
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
];

const BASE_QUOTE = {
  organizationId: "e2e-org",
  id: "ambient-object-proof",
  quoteNumber: "Q-AMBIENT-OBJECT",
  status: "draft",
  activeVersionId: "v0007",
  latestVersionNumber: 7,
  createdAtISO: "2026-08-11T12:00:00.000Z",
  updatedAtISO: "2026-08-11T18:00:00.000Z",
  customer: {
    name: "Maya Bennett",
    email: "maya@example.test",
    phone: "205-555-0184"
  },
  event: {
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    hours: 6,
    venue: "The Foundry Hall",
    venueAddress: "1200 East Fifth Street, Austin, TX",
    style: "Plated",
    guests: 120,
    attendance: {
      schemaVersion: 1,
      planning: {
        kind: "approximate",
        value: 120,
        min: 100,
        max: 140,
        sourceType: "customer_inquiry",
        sourceReferenceId: "ambient-inquiry-001",
        observedAtISO: "2026-08-11T11:45:00.000Z",
        recordedByUid: "ambient-proof-admin"
      },
      confirmation: {
        state: "requested",
        requestedAtISO: "2026-09-01T15:00:00.000Z",
        dueDate: "2026-09-12",
        submittedCount: null,
        sourceType: "",
        sourceReferenceId: "",
        submittedAtISO: "",
        submittedByRole: "",
        appliedRevisionId: "",
        commercialChangeReceiptId: ""
      },
      commercialBasis: {
        source: "planning",
        sourceReferenceId: "ambient-inquiry-001",
        appliedRevisionId: ""
      }
    },
    servers: 8,
    chefs: 3,
    bartenders: 0
  },
  selection: {
    eventTypeId: "wedding",
    packageId: "classic",
    packageName: "Classic",
    packageInclusions: {
      menuItems: [
        { id: "garden-salad", name: "Garden Salad" },
        { id: "herb-chicken", name: "Herb Chicken" }
      ],
      addons: [{ id: "tea", name: "Tea Service" }],
      rentals: [{ id: "linens", name: "Table Linens" }]
    },
    menuItems: ["garden-salad", "herb-chicken"],
    menuItemsSnapshot: [
      {
        id: "garden-salad",
        name: "Garden Salad",
        quantity: 120,
        includedInPackage: true
      },
      {
        id: "herb-chicken",
        name: "Herb Chicken",
        quantity: 120,
        includedInPackage: true
      }
    ],
    menuItemNames: ["Garden Salad", "Herb Chicken"],
    menuItemQuantities: { "garden-salad": 120, "herb-chicken": 120 },
    rentals: ["linens"],
    addons: ["dessert", "premium-bar", "tea"],
    addonQuantities: { dessert: 2, "premium-bar": 2, tea: 120 },
    rentalQuantities: { linens: 15 },
    addonSnapshots: [
      {
        id: "dessert",
        name: "Dessert Upgrade",
        pricingType: "per_item",
        quantity: 2,
        price: 140
      },
      {
        id: "premium-bar",
        name: "Premium Bar",
        pricingType: "per_event",
        quantity: 2,
        price: 475
      },
      {
        id: "tea",
        name: "Tea Service",
        pricingType: "per_person",
        quantity: 120,
        price: 3
      }
    ],
    rentalSnapshots: [
      {
        id: "linens",
        name: "Table Linens",
        pricingType: "per_item",
        quantity: 15,
        price: 12
      }
    ],
    eventTemplateId: "custom"
  },
  totals: {
    total: 8400,
    deposit: 2520,
    serverLabor: 1200,
    chefLabor: 600,
    serviceFeePctApplied: 0.2,
    taxRateApplied: 0.1
  },
  pricing: {
    authority: "server_authoritative",
    calculatedAt: "2026-08-11T18:00:00.000Z",
    inputs: { event: { guests: 120 } },
    lineItems: [
      { id: "classic", category: "package", total: 6000 },
      { id: "labor", category: "labor", total: 1200 },
      { id: "service", category: "service_fee", total: 600 }
    ],
    tax: { amount: 600, regionId: "austin", regionName: "Austin" },
    discountTotal: 0,
    deposit: { pct: 0.3, amount: 2520 },
    subtotal: 7800,
    grandTotal: 8400,
    rulesSnapshot: { pricingSettingsVersion: 12 }
  },
  lifecycle: { draftAtISO: "2026-08-11T12:00:00.000Z" }
};

const LOCAL_CATALOG = {
  packages: [
    {
      id: "classic",
      name: "Classic",
      ppp: 50,
      costPpp: 31,
      active: true,
      includedMenuItemIds: ["garden-salad", "herb-chicken"],
      includedAddonIds: ["tea"],
      includedRentalIds: ["linens"]
    },
    {
      id: "premium",
      name: "Premium",
      ppp: 62,
      costPpp: 38,
      active: true,
      includedMenuItemIds: ["garden-salad", "herb-chicken", "cedar-plank-salmon"],
      includedAddonIds: ["tea"],
      includedRentalIds: ["linens"]
    }
  ],
  addons: [
    {
      id: "dessert",
      name: "Dessert Upgrade",
      pricingType: "per_item",
      price: 140,
      cost: 72,
      active: true
    },
    {
      id: "premium-bar",
      name: "Premium Bar",
      pricingType: "per_event",
      price: 475,
      cost: 260,
      staffRole: "bartender",
      active: true
    },
    {
      id: "tea",
      name: "Tea Service",
      pricingType: "per_person",
      price: 3,
      cost: 1,
      staffRole: "server",
      active: true
    }
  ],
  rentals: [
    {
      id: "linens",
      name: "Table Linens",
      pricingType: "per_item",
      price: 12,
      cost: 6,
      qtyPerGuests: 8,
      active: true
    }
  ],
  settings: {
    catalogRevision: 12,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "ambient-proof-admin",
      actorEmail: "ambient-proof-admin@example.test",
      confirmedAtISO: "2026-08-11T18:00:00.000Z",
      confirmedCatalogRevision: 12
    },
    upsellRules: [
      {
        id: "premium-bar-review",
        name: "Premium bar review",
        kind: "addon",
        targetId: "premium-bar",
        enabled: true,
        minGuests: 100,
        minHours: 5,
        reason: "The tenant bar-review threshold matches this event."
      }
    ],
    eventTemplates: [
      {
        id: "wedding",
        name: "Wedding"
      }
    ],
    menuSections: [
      {
        id: "starters",
        name: "Starters",
        items: [
          {
            id: "garden-salad",
            name: "Garden Salad",
            pricingType: "per_person",
            price: 6,
            active: true
          },
          {
            id: "roasted-beet-salad",
            name: "Roasted Beet Salad",
            pricingType: "per_person",
            price: 7,
            active: true
          }
        ]
      },
      {
        id: "entrees",
        name: "Entrees",
        items: [
          {
            id: "herb-chicken",
            name: "Herb Chicken",
            pricingType: "per_person",
            price: 18,
            active: true
          },
          {
            id: "cedar-plank-salmon",
            name: "Cedar Plank Salmon",
            pricingType: "per_person",
            price: 24,
            active: true
          }
        ]
      }
    ]
  }
};

const MESSAGE_QUOTE = {
  ...BASE_QUOTE,
  id: "ambient-message-proof",
  quoteNumber: "Q-AMBIENT-MESSAGE",
  status: "sent",
  portalKey: "ambient-message-proof-portal-1234567890",
  portalIssuedAtISO: "2026-08-11T18:00:00.000Z",
  portalExpiresAtISO: "2099-08-11T18:00:00.000Z",
  event: {
    ...BASE_QUOTE.event,
    name: "Autumn Benefit Dinner"
  },
  conversationSummary: {
    messageCount: 3,
    latestMessageId: "ambient-message-3",
    latestMessageAtISO: "2026-08-11T18:30:00.000Z",
    latestActorType: "customer"
  },
  workflow: {
    quoteDelivery: {
      revisionId: "v0007@2026-08-11T18:00:00.000Z",
      state: "provider_accepted",
      portalActivationState: "active",
      providerMessageId: "provider-ambient-message-proof",
      providerAcceptedAtISO: "2026-08-11T18:02:00.000Z",
      portalKey: "ambient-message-proof-portal-1234567890",
      portalIssuedAtISO: "2026-08-11T18:00:00.000Z"
    }
  }
};

const WORKFLOW_ARRIVAL_QUOTE = {
  ...BASE_QUOTE,
  id: "ambient-workflow-arrival",
  quoteNumber: "Q-AMBIENT-WORKFLOW",
  workflow: {
    approvalRequests: [{
      id: "approval-ambient-rotate",
      action: "rotate_portal_link",
      state: "pending",
      requestedAtISO: "2026-08-11T18:15:00.000Z"
    }]
  }
};

const CONVERSATION_ARRIVAL_QUOTE = {
  ...MESSAGE_QUOTE,
  id: "ambient-conversation-arrival",
  quoteNumber: "Q-AMBIENT-CONVERSATION",
  customerId: "ambient-arrival-customer"
};

async function seedQuotes(page) {
  const missingDateQuote = {
    ...BASE_QUOTE,
    id: "ambient-object-missing",
    quoteNumber: "Q-AMBIENT-MISSING",
    customer: { name: "Jordan Lee", email: "jordan@example.test" },
    event: {
      ...BASE_QUOTE.event,
      name: "Unscheduled Reception",
      date: "",
      venue: "Cedar Room",
      venueAddress: "42 Cedar Lane, Austin, TX",
      guests: 80,
      servers: 6,
      chefs: 2
    }
  };
  await page.addInitScript(({ catalog, quotes }) => {
    localStorage.clear();
    sessionStorage.clear();
    globalThis.__quotePilotE2eFunctions = {
      ...(globalThis.__quotePilotE2eFunctions || {}),
      loadMenuByEvent: async () => catalog.settings.menuSections
    };
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem("quoteWizard.quotes", JSON.stringify(quotes));
    localStorage.setItem("quoteWizard.catalog", JSON.stringify(catalog));
    localStorage.setItem("quoteWizard.catalog.e2e-org", JSON.stringify(catalog));
  }, { catalog: LOCAL_CATALOG, quotes: [BASE_QUOTE, missingDateQuote] });
}

async function openOpportunity(page, quoteId = BASE_QUOTE.id) {
  await page.goto(`/app/quotes/${quoteId}`);
  const surface = page.locator(".ambient-living-opportunity");
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute("data-ambient-model", "pilot-slice-alpha-v1");
  return surface;
}

async function expectNoHorizontalOverflow(page, surface) {
  const overflow = await page.evaluate(() => {
    const root = document.querySelector(".ambient-living-opportunity");
    const dialog = document.querySelector(".ambient-context-surface__dialog");
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      surface: root ? root.scrollWidth - root.clientWidth : null,
      dialog: dialog ? dialog.scrollWidth - dialog.clientWidth : 0
    };
  });
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.surface).not.toBeNull();
  expect(overflow.surface).toBeLessThanOrEqual(1);
  expect(overflow.dialog).toBeLessThanOrEqual(1);
  await expect(surface).toBeVisible();
}

async function stageGuestScenario(surface, value) {
  await surface.getByRole("button", { name: "Change Guest count scenario" }).click();
  await surface.getByRole("spinbutton", { name: "Guest count scenario" }).fill(String(value));
  await surface.getByRole("button", { name: "Apply change" }).click();
  const guestDialog = surface.getByRole("dialog", { name: "Guest count connections" });
  await expect(guestDialog).toBeVisible();
  await guestDialog.getByRole("button", { name: "Close context" }).click();
  await expect(guestDialog).toHaveCount(0);
}

async function readPersistedQuote(page, quoteId = BASE_QUOTE.id) {
  return page.evaluate((selectedQuoteId) => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    return quotes.find((quote) => quote.id === selectedQuoteId) || null;
  }, quoteId);
}

test.describe("Ambient intelligent-object browser verification", () => {
  test.skip(
    !AMBIENT_UI_ENABLED,
    "The Ambient intelligent-object proof runs only when the default-off Ambient gate is enabled."
  );

  test.beforeEach(async ({ page }) => {
    await seedQuotes(page);
  });

  for (const viewport of VIEWPORTS) {
    test(`keeps event-logistics context exclusive, complete, and overflow-safe at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const surface = await openOpportunity(page);
      if (viewport.width <= 620) {
        await surface.getByRole("button", { name: "Event", exact: true }).click();
        await expect(surface.getByRole("region", { name: "Event details" })).toBeVisible();
      }
      const dateTrigger = surface.getByRole("button", { name: /^Review event date:/u });
      const timeTrigger = surface.getByRole("button", { name: /^Review event time:/u });

      await dateTrigger.focus();
      await dateTrigger.click();
      let dialog = page.getByRole("dialog", { name: "Event date details" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(dialog.getByRole("button", { name: "Close context" })).toBeFocused();
      await expect(dialog).toContainText("Autumn Benefit Dinner, Q-AMBIENT-OBJECT");
      await expect(dialog).toContainText("Why this is here");
      await expect(dialog).toContainText("What this affects");
      await expect(dialog).toContainText("Saved value2026-09-19");
      await expect(dialog.locator('[data-evidence-state="missing"]')).toHaveCount(5);
      await expect(dialog).toContainText("If you do nothing");
      await expect(dialog).toContainText("Confidence: low");
      await expect(dialog).toContainText("Sources:");
      const acknowledgement = surface.locator('[data-result-kind="context"]');
      await expect(acknowledgement).toContainText("Event date details ready");
      await expect(acknowledgement).toContainText("does not reserve capacity");
      await expect(acknowledgement).toContainText("Continue event date in the editor");
      await expectNoHorizontalOverflow(page, surface);

      await timeTrigger.evaluate((button) => button.click());
      dialog = page.getByRole("dialog", { name: "Event time details" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(page.getByRole("dialog", { name: "Event date details" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(timeTrigger).toBeFocused();
      await expectNoHorizontalOverflow(page, surface);
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`keeps Guest count status, dependencies, and preview authority clear at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const surface = await openOpportunity(page);
      const savedBefore = await readPersistedQuote(page);
      const trigger = surface.getByRole("button", { name: "See connections" });

      await trigger.click();
      let dialog = page.getByRole("dialog", { name: "Guest count connections" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(dialog.locator("summary")).toHaveText("Why this view");
      await expect(dialog.getByText("Saved priced count", { exact: true })).toBeVisible();
      await expect(dialog).toContainText("Exact commercial basis on this quote");
      await expect(dialog).toContainText("Planning estimate: about 120 guests (100–140)");
      await expect(dialog).toContainText("Customer inquiry · Aug 11, 2026");
      await expect(dialog).toContainText("Final count requested · due Sep 12, 2026");
      await expect(dialog).toContainText("No response is inferred");
      await expect(dialog).toContainText("Price and scope");
      await expect(dialog).toContainText("Staffing");
      await expect(dialog).toContainText("Quantity rules");
      await expect(dialog).toContainText("does not confirm attendance");
      await expect(dialog.locator('[data-attendance-dimension="commercial-basis"]')).toBeVisible();
      await expect(dialog.locator('[data-attendance-dimension="best-evidence"]')).toBeVisible();
      await expect(dialog.locator('[data-attendance-dimension="decision-timing"]')).toBeVisible();
      await expect(dialog.locator('[data-context-arrival-duplicate="reason"]')).toBeHidden();
      await expectNoHorizontalOverflow(page, surface);

      if (CAPTURE_PROOF && [390, 1440].includes(viewport.width)) {
        await page.screenshot({
          path: `${ATTENDANCE_PROOF_DIRECTORY}/${ATTENDANCE_PROOF_STAGE}-${viewport.width}.png`,
          fullPage: true
        });
      }

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await surface.getByRole("button", { name: "Change Guest count scenario" }).click();
      await surface.getByRole("spinbutton", { name: "Guest count scenario" }).fill("150");
      await surface.getByRole("button", { name: "Apply change" }).click();
      dialog = page.getByRole("dialog", { name: "Guest count connections" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Unsaved guest-count preview", { exact: true })).toBeVisible();
      await expect(dialog).toContainText("Saved record: 120 guests");
      await expect(dialog).toContainText("150 guests");
      await expectNoHorizontalOverflow(page, surface);

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      expect(await readPersistedQuote(page)).toEqual(savedBefore);
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`keeps Package and Menu evidence populated, exclusive, and overflow-safe at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const surface = await openOpportunity(page);
      const packageTrigger = surface.getByRole("button", { name: "Review package" });
      const menuTrigger = surface.getByRole("button", { name: "Review menu" });

      await expect(packageTrigger).toBeVisible();
      await packageTrigger.click();
      let dialog = page.getByRole("dialog", { name: "Package details" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(dialog).toContainText("Autumn Benefit Dinner, Q-AMBIENT-OBJECT");
      await expect(dialog).toContainText("Why this is here");
      await expect(dialog).toContainText("What this affects");
      await expect(dialog).toContainText("Saved package");
      await expect(dialog).toContainText("Classic");
      await expect(dialog).toContainText("Garden Salad");
      await expect(dialog).toContainText("Herb Chicken");
      await expect(dialog).toContainText("Premium");
      await expect(dialog).toContainText("Why this matters");
      await expect(dialog).toContainText("If you do nothing");
      await expect(dialog).toContainText("Confidence: high");
      await expect(dialog).toContainText("Sources:");
      await expect(dialog).toContainText("Catalog revision 12");
      await expectNoHorizontalOverflow(page, surface);

      if (CAPTURE_PROOF && viewport.width === 1440) {
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-desktop-package-inspector-1440.png`,
          animations: "disabled"
        });
      }

      await menuTrigger.evaluate((button) => button.click());
      dialog = page.getByRole("dialog", { name: "Menu details" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(page.getByRole("dialog", { name: "Package details" })).toHaveCount(0);
      await expect(dialog).toContainText("Autumn Benefit Dinner, Q-AMBIENT-OBJECT");
      await expect(dialog).toContainText("Why this is here");
      await expect(dialog).toContainText("What this affects");
      await expect(dialog).toContainText("2 saved items");
      await expect(dialog).toContainText("Garden Salad");
      await expect(dialog).toContainText("Herb Chicken");
      await expect(dialog).toContainText("Quantity 120");
      await expect(dialog).toContainText("Roasted Beet Salad");
      await expect(dialog).toContainText("Cedar Plank Salmon");
      await expect(dialog).toContainText("Why this matters");
      await expect(dialog).toContainText("If you do nothing");
      await expect(dialog).toContainText("Confidence: high");
      await expect(dialog).toContainText("Sources:");
      await expectNoHorizontalOverflow(page, surface);

      if (CAPTURE_PROOF && viewport.width === 1440) {
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-desktop-menu-inspector-1440.png`,
          animations: "disabled"
        });
      }

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(menuTrigger).toBeFocused();
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`keeps Selection details contextual, reversible, and overflow-safe at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const surface = await openOpportunity(page);
      const savedBefore = await readPersistedQuote(page);
      const trigger = surface.getByRole("button", { name: "Review selections" });

      await expect(trigger).toBeVisible();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Selection details" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(dialog).toContainText("Autumn Benefit Dinner, Q-AMBIENT-OBJECT");
      await expect(dialog).toContainText("Why this is here");
      await expect(dialog).toContainText("What this affects");
      await expect(dialog.getByRole("heading", { name: "Add-ons", exact: true })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Rentals", exact: true })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Bar", exact: true })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Services", exact: true })).toBeVisible();
      await expect(dialog).toContainText("Dessert Upgrade");
      await expect(dialog).toContainText("Table Linens");
      await expect(dialog).toContainText("Premium Bar");
      await expect(dialog).toContainText("Tea Service");
      await expect(dialog).toContainText("What this connects to");
      await expect(dialog).toContainText("If you do nothing");
      await expect(dialog).toContainText("Confidence: high");
      await expect(dialog).toContainText("Sources:");
      await expect(dialog).toContainText("Swipe left to reduce or remove");

      const rental = dialog.locator('[data-selection-kind="rental"]');
      await expect(rental).toHaveAttribute("data-current-quantity", "15");
      await dialog.getByRole("button", { name: "Increase Table Linens preview quantity" }).click();
      await expect(rental).toHaveAttribute("data-current-quantity", "16");
      await expect(rental).toHaveAttribute("data-scenario-state", "changed");
      await expect(surface.locator('[data-result-kind="preview"]')).toContainText(
        "Table Linens preview quantity is 16"
      );
      await expect(surface.getByRole("region", { name: "Reversible scenarios" })).toBeVisible();

      if (viewport.width === 390) {
        const service = dialog.locator('[data-selection-kind="service"]');
        await expect(service).toHaveAttribute("data-current-quantity", "120");
        await service.dispatchEvent("pointerdown", {
          pointerId: 7,
          clientX: 260,
          clientY: 120
        });
        await service.dispatchEvent("pointerup", {
          pointerId: 7,
          clientX: 180,
          clientY: 122
        });
        await expect(service).toHaveAttribute("data-current-quantity", "0");
        await expect(surface.locator('[data-result-kind="preview"]')).toContainText(
          "Tea Service removed from unsaved preview"
        );
      }

      expect(await readPersistedQuote(page)).toEqual(savedBefore);
      await expectNoHorizontalOverflow(page, surface);

      if (CAPTURE_PROOF && viewport.width === 1440) {
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-desktop-selection-intelligence-1440.png`,
          animations: "disabled"
        });
      }

      await dialog.getByRole("button", { name: "Close context" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();

      if (viewport.width === 390) {
        await surface.getByRole("button", {
          name: "Undo Tea Service unsaved preview changed"
        }).click();
      }
      await surface.getByRole("button", {
        name: "Undo Table Linens unsaved preview changed"
      }).click();
      await expect(surface.getByRole("region", { name: "Reversible scenarios" })).toHaveCount(0);

      await trigger.click();
      const restoredDialog = page.getByRole("dialog", { name: "Selection details" });
      await expect(restoredDialog.locator('[data-selection-kind="rental"]'))
        .toHaveAttribute("data-current-quantity", "15");
      await expect(restoredDialog.locator('[data-selection-kind="rental"]'))
        .toHaveAttribute("data-scenario-state", "saved");
      if (viewport.width === 390) {
        await expect(restoredDialog.locator('[data-selection-kind="service"]'))
          .toHaveAttribute("data-current-quantity", "120");
      }
      await page.keyboard.press("Escape");
      await expect(restoredDialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await readPersistedQuote(page)).toEqual(savedBefore);
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`keeps Money evidence distinct, populated, and overflow-safe at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const surface = await openOpportunity(page);
      const savedBefore = await readPersistedQuote(page);
      const trigger = surface.getByRole("button", { name: "Review payments" });

      await expect(trigger).toBeVisible();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Payments and balance" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(dialog).toContainText("Autumn Benefit Dinner, Q-AMBIENT-OBJECT");
      await expect(dialog).toContainText("Why this is here");
      await expect(dialog).toContainText("What this affects");
      await expect(dialog.locator("[data-money-stage]")).toHaveCount(5);
      await expect(dialog.locator('[data-money-stage="deposit-policy"]')).toContainText("$2,520.00");
      await expect(dialog.locator('[data-money-stage="deposit-request"]')).toContainText("Not requested");
      await expect(dialog.locator('[data-money-stage="deposit-settlement"]')).toContainText("Not settled");
      await expect(dialog.locator('[data-money-stage="balance-request"]')).toContainText("Not requested");
      await expect(dialog.locator('[data-money-stage="final-settlement"]')).toContainText("Not settled");
      await expect(dialog).toContainText("If nothing changes");
      await expect(dialog).toContainText("What you can do next");
      await expect(dialog).toContainText("Browser returns");
      await expect(surface.locator('[data-result-kind="context"]')).toContainText(
        "Payment details ready"
      );
      await expectNoHorizontalOverflow(page, surface);

      if (CAPTURE_PROOF && [390, 1440].includes(viewport.width)) {
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-money-evidence-${viewport.width}.png`,
          animations: "disabled"
        });
      }

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(surface.locator('[data-result-kind="resolved"]')).toContainText(
        "Payment details closed"
      );
      expect(await readPersistedQuote(page)).toEqual(savedBefore);
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`keeps Proposal evidence distinct, populated, and overflow-safe at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const surface = await openOpportunity(page);
      const savedBefore = await readPersistedQuote(page);
      const row = surface.locator('[data-intelligent-object="proposal"]');
      const trigger = surface.getByRole("button", { name: "Review proposal" });

      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("data-proposal-state", "local_preview");
      await expect(row).toContainText("100% proposal completeness");
      await trigger.click();

      const dialog = page.getByRole("dialog", { name: "Proposal details" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(dialog).toContainText("Autumn Benefit Dinner, Q-AMBIENT-OBJECT");
      await expect(dialog).toContainText("Why this is here");
      await expect(dialog).toContainText("What this affects");
      await expect(dialog.locator('[data-ambient-intelligent-object="proposal"]'))
        .toHaveAttribute("data-proposal-state", "local_preview");
      await expect(dialog).toContainText("What the customer sees");
      await expect(dialog).toContainText("Proposal completeness");
      await expect(dialog).toContainText("What each status is based on");
      await expect(dialog).toContainText("What you can do next");
      await expect(dialog).toContainText("If you do nothing");
      await expect(dialog).toContainText("Confidence and source");
      await expect(dialog.locator("[data-proposal-evidence]")).toHaveCount(4);
      await expect(dialog.locator("[data-proposal-action]")).toHaveCount(4);
      await expect(dialog.getByRole("button", { name: /Send current proposal/iu })).toHaveCount(0);
      await expect(surface.locator('[data-result-kind="context"]')).toContainText(
        "Review what the customer sees or continue to the existing proposal controls"
      );
      await expectNoHorizontalOverflow(page, surface);

      if (CAPTURE_PROOF && [390, 1440].includes(viewport.width)) {
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-proposal-evidence-${viewport.width}.png`,
          animations: "disabled"
        });
      }

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(surface.locator('[data-result-kind="resolved"]')).toContainText(
        "Proposal details closed"
      );
      expect(await readPersistedQuote(page)).toEqual(savedBefore);
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`keeps Conversation evidence distinct, populated, and overflow-safe at ${viewport.width}px`, async ({ page }) => {
      await page.addInitScript(({ quote }) => {
        localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
      }, { quote: MESSAGE_QUOTE });
      await page.setViewportSize(viewport);
      const surface = await openOpportunity(page, MESSAGE_QUOTE.id);
      const savedBefore = await readPersistedQuote(page, MESSAGE_QUOTE.id);
      const row = surface.locator('[data-intelligent-object="conversation"]');
      const trigger = surface.getByRole("button", { name: "Review conversation" });

      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("data-conversation-state", "local_preview");
      await expect(row).toContainText("Sent, delivered, viewed, and replied stay separate");
      await trigger.click();

      const dialog = page.getByRole("dialog", { name: "Conversation details" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(dialog).toContainText("Autumn Benefit Dinner, Q-AMBIENT-MESSAGE");
      await expect(dialog).toContainText("Why this is here");
      await expect(dialog).toContainText("What this affects");
      await expect(dialog.locator('[data-ambient-intelligent-object="conversation"]'))
        .toHaveAttribute("data-conversation-state", "local_preview");
      await expect(dialog).toContainText("What you can do next");
      await expect(dialog).toContainText("Recorded conversation activity");
      await expect(dialog).toContainText("If you do nothing");
      await expect(dialog).toContainText("Confidence and source");
      await expect(dialog).toContainText("What this connects to");

      const evidenceRails = dialog.locator("[data-conversation-evidence]");
      await expect(evidenceRails).toHaveCount(5);
      expect(await evidenceRails.evaluateAll((nodes) => (
        nodes.map((node) => node.getAttribute("data-conversation-evidence"))
      ))).toEqual([
        "sent",
        "provider-delivered",
        "portal-viewed",
        "replied",
        "inferred-engagement"
      ]);
      await expect(dialog.getByRole("button", { name: /send|mark(?: as)? read/iu })).toHaveCount(0);
      await expect(surface.locator('[data-result-kind="context"]')).toContainText(
        "Conversation details ready"
      );
      await expect(surface.locator('[data-result-kind="context"]')).toContainText(
        "Staff can open the exact conversation or task. Existing access, customer-link, delivery, draft, pricing, and trusted-save checks still apply"
      );
      await expect(surface.locator('[data-result-kind="context"]')).toContainText(
        "The browser-local opportunity can support a bounded preview, but it is not exact connected evidence"
      );
      await expectNoHorizontalOverflow(page, surface);

      if (CAPTURE_PROOF && [390, 1440].includes(viewport.width)) {
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-conversation-evidence-${viewport.width}.png`,
          animations: "disabled"
        });
      }

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(surface.locator('[data-result-kind="resolved"]')).toContainText(
        "Conversation details closed"
      );
      expect(await readPersistedQuote(page, MESSAGE_QUOTE.id)).toEqual(savedBefore);
    });
  }

  test("keeps an exact customer-reply identity private and recovers when canonical bodies are unavailable", async ({ page }) => {
    await page.addInitScript(({ quote }) => {
      localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
    }, { quote: MESSAGE_QUOTE });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openOpportunity(page, MESSAGE_QUOTE.id);
    await page.evaluate(async ({ quoteId, messageId }) => {
      const { createWorkspaceArrivalHandoff } = await import("/src/lib/workspaceArrivalContract.js");
      const handoff = createWorkspaceArrivalHandoff({
        destination: "messages",
        object: { id: messageId, type: "customer-communication-evidence" },
        focus: { quoteId, messageId },
        intentId: "review_customer_reply"
      });
      if (!handoff.ok) throw new Error(`Exact reply handoff failed: ${handoff.recovery.code}`);
      window.history.pushState(handoff.navigation.state, "", handoff.navigation.path);
      window.dispatchEvent(new Event("quotepilot:locationchange"));
    }, {
      quoteId: MESSAGE_QUOTE.id,
      messageId: MESSAGE_QUOTE.conversationSummary.latestMessageId
    });
    await expect(page).toHaveURL(/\/app\/messages\?quoteId=ambient-message-proof$/u);

    const transport = await page.evaluate(() => ({
      search: window.location.search,
      messageId: window.history.state?.ambientArrival?.focus?.messageId || "",
      serializedState: JSON.stringify(window.history.state || {})
    }));
    expect(transport.search).toBe("?quoteId=ambient-message-proof");
    expect(transport.search).not.toContain("ambient-message-3");
    expect(transport.messageId).toBe("ambient-message-3");
    expect(transport.serializedState).not.toContain("customer@example");
    expect(transport.serializedState).not.toContain("message body");

    const notice = page.locator(
      '[data-arrival-surface="conversation"][data-arrival-state="recovery"]'
    );
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(
      /current exact state cannot be verified|exact quote-scoped conversation could not be loaded/iu
    );
    await expect(notice).toContainText("No other message was substituted");
    await expect(notice).toContainText(
      /nothing was sent and no read state changed|no message was sent or marked read/iu
    );
    await expect(page.locator('[data-arrival-focus="resolved"]')).toHaveCount(0);
  });

  test("rejects altered arrival state without selecting a substitute conversation", async ({ page }) => {
    await page.addInitScript(({ quote }) => {
      localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
    }, { quote: MESSAGE_QUOTE });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/app");
    await page.evaluate(async (quoteId) => {
      const { createWorkspaceArrivalHandoff } = await import("/src/lib/workspaceArrivalContract.js");
      const handoff = createWorkspaceArrivalHandoff({
        destination: "messages",
        object: { id: quoteId, type: "opportunity" },
        focus: { quoteId },
        intentId: "review_conversation"
      });
      if (!handoff.ok) throw new Error(`Arrival setup failed: ${handoff.recovery.code}`);
      const alteredState = structuredClone(handoff.navigation.state);
      alteredState.ambientArrival.reason = "Caller-authored text must not be trusted.";
      window.history.pushState(alteredState, "", handoff.navigation.path);
      window.dispatchEvent(new Event("quotepilot:locationchange"));
    }, MESSAGE_QUOTE.id);

    await expect(page).toHaveURL(/\/app\/messages\?quoteId=ambient-message-proof$/u);
    const notice = page.locator(
      '[data-arrival-surface="conversation"][data-arrival-state="recovery"]'
    );
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("altered or does not match its canonical semantic text");
    await expect(notice).toContainText("No workspace navigation or arrival state was produced or accepted");
    await expect(page.locator('.messaging-thread-row[aria-current="page"]')).toHaveCount(0);
    await expect(page.locator(".quote-conversation")).toHaveCount(0);
  });

  test("carries a Living Opportunity approval into the exact Workflow arrival", async ({ page }) => {
    await page.addInitScript(({ quote }) => {
      localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
    }, { quote: WORKFLOW_ARRIVAL_QUOTE });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const surface = await openOpportunity(page, WORKFLOW_ARRIVAL_QUOTE.id);

    await expect(surface).toContainText("Approval waiting");
    await surface.getByRole("button", { name: "Review in Workflow", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/workflow\?/u);

    const arrivalUrl = new URL(page.url());
    expect(arrivalUrl.pathname).toBe("/app/workflow");
    expect(Object.fromEntries(arrivalUrl.searchParams)).toEqual({
      quoteId: WORKFLOW_ARRIVAL_QUOTE.id,
      attentionType: "approval",
      requestId: "approval-ambient-rotate"
    });

    const notice = page.locator('[data-arrival-surface="workflow"]');
    await expect(notice).toBeVisible();
    await expect(notice.locator("strong")).toHaveText("Approval ready");
    await expect(notice.locator("span").nth(0)).toContainText(
      "A recorded approval request was selected for review."
    );
    await expect(notice.locator("span").nth(1)).toContainText(
      "The approval remains pending; navigation does not approve, reject, or execute it."
    );
    await expect(notice.locator("small")).toHaveText(
      "Next step: Review the focused approval and choose the next step available to your role."
    );
    await expect(page.getByRole("heading", { name: "Workflow", exact: true })).toBeVisible();

    if (CAPTURE_PROOF) {
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-workflow-exact-arrival-1440.png`,
        animations: "disabled"
      });
    }
  });

  test("carries Customer 360 context into Messages and recovers rather than trusting stale local evidence", async ({ page }) => {
    await page.addInitScript(({ quote }) => {
      localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
    }, { quote: CONVERSATION_ARRIVAL_QUOTE });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/app/customers/${CONVERSATION_ARRIVAL_QUOTE.customerId}`);

    await expect(page.getByRole("heading", { name: "Conversations", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open conversation", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/messages\?/u);

    const arrivalUrl = new URL(page.url());
    expect(arrivalUrl.pathname).toBe("/app/messages");
    expect(Object.fromEntries(arrivalUrl.searchParams)).toEqual({
      quoteId: CONVERSATION_ARRIVAL_QUOTE.id
    });

    const notice = page.locator('[data-arrival-surface="conversation"]');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute("data-arrival-state", "recovery");
    await expect(notice.locator("strong")).toHaveText("Opportunity unavailable");
    await expect(notice).toContainText("current exact state cannot be verified");
    await expect(notice).toContainText("No other message was substituted");
    await expect(notice).toContainText("no message was sent or marked read");
    await expect(notice.locator("small")).toHaveText(
      "Next step: Reconnect Messages and retry the exact conversation after the inbox is current."
    );
    await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();

    if (CAPTURE_PROOF) {
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-conversation-exact-arrival-1440.png`,
        animations: "disabled"
      });
    }
  });

  test("hands an exact Package replacement to pending review without mutating the saved quote", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const surface = await openOpportunity(page);
    const savedBefore = await readPersistedQuote(page);

    await surface.getByRole("button", { name: "Review package" }).click();
    const dialog = page.getByRole("dialog", { name: "Package details" });
    await dialog.getByRole("button", { name: /Premium.*Review replacement in editor/iu }).click();

    await expect(page).toHaveURL(/\/app\/quotes\/ambient-object-proof\/edit$/u);
    const review = page.locator('[data-ambient-draft-intent-review="package_menu"]');
    await expect(review).toBeVisible();
    await expect(review).toHaveAttribute("data-ambient-draft-review-state", "pending_review");
    await expect(review).toContainText("Premium");
    await expect(review.getByRole("button", { name: /Apply Premium.*to draft/iu })).toBeVisible();
    await expect(review.getByRole("button", { name: /Keep saved package/iu })).toBeVisible();
    await expect(page.locator(".source-note", { hasText: "Autumn Benefit Dinner:" })).toContainText(
      "No package, price, availability, or saved version changes until explicit adoption"
    );

    const savedAfter = await readPersistedQuote(page);
    expect(savedAfter).toEqual(savedBefore);
  });

  test("hands a keyboard-equivalent Menu reorder to pending review without mutating the saved quote", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const surface = await openOpportunity(page);
    const savedBefore = await readPersistedQuote(page);

    await surface.getByRole("button", { name: "Review menu" }).click();
    const dialog = page.getByRole("dialog", { name: "Menu details" });
    const moveLater = dialog.getByRole("button", { name: "Move Garden Salad later" });
    await moveLater.focus();
    await expect(moveLater).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/app\/quotes\/ambient-object-proof\/edit$/u);
    const review = page.locator('[data-ambient-draft-intent-review="package_menu"]');
    await expect(review).toBeVisible();
    await expect(review).toHaveAttribute("data-ambient-draft-review-state", "pending_review");
    await expect(review).toContainText("Garden Salad");
    await expect(review.getByRole("button", { name: /Apply proposed order.*to draft/iu })).toBeVisible();
    await expect(review.getByRole("button", { name: /Keep saved order/iu })).toBeVisible();
    await expect(page.locator(".source-note", { hasText: "Autumn Benefit Dinner:" })).toContainText(
      "No item, quantity, price, preparation, availability, or saved version changes until explicit adoption"
    );

    const savedAfter = await readPersistedQuote(page);
    expect(savedAfter).toEqual(savedBefore);
  });

  test("adopts an exact Package outcome only into the editor draft and exposes an outcome-named save", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const surface = await openOpportunity(page);
    const savedBefore = await readPersistedQuote(page);

    await surface.getByRole("button", { name: "Review package" }).click();
    await page.getByRole("dialog", { name: "Package details" })
      .getByRole("button", { name: /Premium.*Review replacement in editor/iu })
      .click();

    const review = page.locator('[data-ambient-draft-intent-review="package_menu"]');
    await expect(review).toHaveAttribute("data-ambient-draft-review-state", "pending_review");
    if (CAPTURE_PROOF) {
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-package-draft-review-pending-1440.png`,
        animations: "disabled"
      });
    }

    await review.getByRole("button", { name: /Apply Premium.*to draft/iu }).click();
    await expect(review).toHaveAttribute("data-ambient-draft-review-state", "resolved");
    await expect(review).toContainText("Draft updated");
    await expect(page.locator('select[data-ambient-field="pkg"]')).toHaveValue("premium");
    await expect(page.getByRole("complementary", { name: "Live Breakdown" })).toContainText("Premium");

    await page.getByRole("button", { name: /^Next:/ }).click();
    await page.getByRole("button", { name: /^Next:/ }).click();
    await expect(page.getByRole("button", { name: "Save package change" })).toBeVisible();
    expect(await readPersistedQuote(page)).toEqual(savedBefore);
  });

  test("returns a pending Package review to its exact resolution instead of allowing a dead save", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const surface = await openOpportunity(page);
    const savedBefore = await readPersistedQuote(page);

    await surface.getByRole("button", { name: "Review package" }).click();
    await page.getByRole("dialog", { name: "Package details" })
      .getByRole("button", { name: /Premium.*Review replacement in editor/iu })
      .click();
    const review = page.locator('[data-ambient-draft-intent-review="package_menu"]');
    const apply = review.getByRole("button", { name: /Apply Premium.*to draft/iu });

    for (let step = 1; step < 5; step += 1) {
      await page.getByRole("button", { name: /^Next:/ }).click();
    }
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(apply).toBeFocused();
    await expect(page.locator(".source-note", { hasText: "Resolve the pending Package or Menu review" }))
      .toBeVisible();
    await expect(review).toHaveAttribute("data-ambient-draft-review-state", "pending_review");
    expect(await readPersistedQuote(page)).toEqual(savedBefore);
  });

  test("keeps transient editor feedback in flow without covering the draft or breakdown", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const surface = await openOpportunity(page);

    await page.evaluate(() => {
      globalThis.__quotePilotE2eFunctions.loadMenuByEvent = async () => [];
    });

    await surface.getByRole("button", { name: "Review package" }).click();
    await page.getByRole("dialog", { name: "Package details" })
      .getByRole("button", { name: /Premium.*Review replacement in editor/iu })
      .click();
    await page.locator('[data-ambient-draft-intent-review="package_menu"]')
      .getByRole("button", { name: /Apply Premium.*to draft/iu })
      .click();

    const feedback = page.locator('[data-layout-audit-surface="workspace-feedback"]');
    const review = page.locator('[data-ambient-draft-intent-review="package_menu"]');
    const breakdown = page.getByRole("complementary", { name: "Live Breakdown" });
    await expect(feedback).toBeVisible();
    await expect(review).toBeVisible();
    await expect(breakdown).toBeVisible();
    const geometry = await page.evaluate(() => {
      const feedbackElement = document.querySelector('[data-layout-audit-surface="workspace-feedback"]');
      const reviewElement = document.querySelector('[data-ambient-draft-intent-review="package_menu"]');
      const breakdownElement = document.querySelector("#live-breakdown");
      const rect = (element) => {
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom
        };
      };
      const intersects = (first, second) => first.left < second.right
        && first.right > second.left
        && first.top < second.bottom
        && first.bottom > second.top;
      const feedbackRect = rect(feedbackElement);
      return {
        reviewCollision: intersects(feedbackRect, rect(reviewElement)),
        breakdownCollision: intersects(feedbackRect, rect(breakdownElement)),
        position: getComputedStyle(feedbackElement).position,
        overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    expect(geometry).toEqual({
      reviewCollision: false,
      breakdownCollision: false,
      position: "static",
      overflowPx: 0
    });
  });

  test("keeps a missing saved date inspectable while removing its stage handoff", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    const surface = await openOpportunity(page, "ambient-object-missing");
    const dateTrigger = surface.getByRole("button", {
      name: "Review event date: Event date not recorded"
    });

    await dateTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Event date details" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Saved valueEvent date not recorded");
    await expect(dialog).toContainText("Draft staging requires an exact available saved event date");
    await expect(dialog.getByRole("button", { name: /Continue event date in editor/iu })).toHaveCount(0);
    await expect(surface.locator('[data-ambient-action-id="stage-event-date"]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page, surface);
  });

  test("hands event date to the exact editor field without mutating the saved quote", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    const surface = await openOpportunity(page);
    await surface.getByRole("button", { name: /^Review event date:/u }).click();
    const dialog = page.getByRole("dialog", { name: "Event date details" });
    const continueAction = dialog.getByRole("button", { name: "Continue event date in editor" });

    await continueAction.click();
    await expect(page).toHaveURL(/\/app\/quotes\/ambient-object-proof\/edit$/u);
    const dateField = page.locator('[data-ambient-field="date"]');
    await expect(dateField).toBeVisible();
    await expect(dateField).toBeFocused();
    await expect(dateField).toHaveValue("2026-09-19");
    const arrivalStatus = page.locator(".source-note", { hasText: "Autumn Benefit Dinner:" });
    await expect(arrivalStatus).toContainText(
      "Continue the exact saved event date in the selected quote editor with draft-only intent metadata"
    );
    await expect(arrivalStatus).toContainText(
      "No value is applied, reserved, repriced, scheduled, or saved by this handoff"
    );
    await expect(arrivalStatus).toContainText(
      "Next step: Review event date and every dependency consequence"
    );

    const persistedDate = await page.evaluate((quoteId) => {
      const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
      return quotes.find((quote) => quote.id === quoteId)?.event?.date || null;
    }, BASE_QUOTE.id);
    expect(persistedDate).toBe("2026-09-19");
  });

  test("acknowledges a pricing scenario within 250ms and preserves exact arrival context", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const surface = await openOpportunity(page);
    await stageGuestScenario(surface, 150);

    const pricingTrigger = surface.getByRole("button", { name: "Review pricing" });
    await pricingTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Pricing details" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(dialog).toContainText("Autumn Benefit Dinner, Q-AMBIENT-OBJECT");
    await expect(dialog).toContainText("Why this is here");
    await expect(dialog).toContainText("What this affects");
    await expect(dialog).toContainText("If you do nothing");
    await expect(surface.locator('[data-result-kind="context"]')).toContainText(
      "Preview pricing for 150 guests or carry it into the editor"
    );
    await expectNoHorizontalOverflow(page, surface);

    if (CAPTURE_PROOF) {
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-desktop-pricing-inspector-1440.png`,
        animations: "disabled"
      });
    }

    const priceAction = dialog.getByRole("button", { name: "Price 150 guests" });
    await page.evaluate(() => {
      window.__ambientPricingTiming = { startedAt: null, pendingAt: null, pendingText: "" };
      const action = document.querySelector('[data-ambient-action-id="simulate-pricing-counterfactual"]');
      action?.addEventListener("click", () => {
        window.__ambientPricingTiming.startedAt = performance.now();
      }, { capture: true, once: true });
      const observer = new MutationObserver(() => {
        if (
          window.__ambientPricingTiming.pendingAt === null
          && document.querySelector('[data-result-kind="pending"]')
        ) {
          const pending = document.querySelector('[data-result-kind="pending"]');
          window.__ambientPricingTiming.pendingAt = performance.now();
          window.__ambientPricingTiming.pendingText = pending?.textContent || "";
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    });
    await priceAction.click();
    await page.waitForFunction(() => window.__ambientPricingTiming?.pendingAt !== null);
    const timing = await page.evaluate(() => ({
      ...window.__ambientPricingTiming,
      acknowledgementMs: window.__ambientPricingTiming.pendingAt
        - window.__ambientPricingTiming.startedAt
    }));
    expect(timing.startedAt).not.toBeNull();
    expect(timing.acknowledgementMs).toBeGreaterThanOrEqual(0);
    expect(timing.acknowledgementMs).toBeLessThanOrEqual(250);
    expect(timing.pendingText).toContain("Calculating the guest count preview");
    expect(timing.pendingText).toContain("Keep reviewing the saved details");
  });

  test("renders the staffing inspector as an overflow-safe mobile sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const surface = await openOpportunity(page);
    const staffingTrigger = surface.getByRole("button", { name: "Review staffing" });
    await staffingTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Staffing suggestion" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(dialog).toContainText("Autumn Benefit Dinner, Q-AMBIENT-OBJECT");
    await expect(dialog).toContainText("Why this is here");
    await expect(dialog).toContainText("What this affects");
    await expect(dialog).toContainText("If you do nothing");
    await expect(surface.locator('[data-result-kind="context"]')).toContainText(
      "Use the recommendation, keep the saved staffing, or review what it connects to"
    );
    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    });
    expect(geometry).toMatchObject({ left: 0, right: 390, viewportWidth: 390, viewportHeight: 844 });
    expect(Math.abs(geometry.bottom - geometry.viewportHeight)).toBeLessThanOrEqual(4);
    await expectNoHorizontalOverflow(page, surface);

    if (CAPTURE_PROOF) {
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-mobile-staffing-inspector-390.png`,
        animations: "disabled"
      });
    }
  });

  test("keeps the mobile opportunity remote in flow with exact populated object controls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const surface = await openOpportunity(page);
    const remote = surface.getByRole("region", { name: "Opportunity quick actions" });
    const hero = surface.locator(".ambient-opportunity-hero");

    await expect(remote).toBeVisible();
    await expect(remote).toContainText("Autumn Benefit Dinner");
    await expect(remote).toContainText("What matters");
    await expect(remote).toContainText("Next");
    await expect(remote.getByRole("button", { name: "Event", exact: true })).toBeVisible();
    await expect(remote.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
    await expect(remote.getByRole("button", { name: "Pricing", exact: true })).toBeVisible();
    await expect(remote.getByRole("button", { name: "Proposal", exact: true })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const control = document.querySelector(".ambient-mobile-remote");
      const opportunityHero = document.querySelector(".ambient-opportunity-hero");
      const opportunityGlance = document.querySelector(".ambient-opportunity-glance");
      const nextVisibleLayer = document.querySelector(".ambient-pilot-sentence");
      const controlRect = control?.getBoundingClientRect();
      const nextVisibleRect = nextVisibleLayer?.getBoundingClientRect();
      const controls = [...(control?.querySelectorAll("button:not(:disabled)") || [])]
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            label: button.textContent.trim(),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            actionId: button.dataset.ambientActionId || ""
          };
        });
      return {
        position: control ? getComputedStyle(control).position : "missing",
        remoteBottom: controlRect?.bottom ?? null,
        nextVisibleTop: nextVisibleRect?.top ?? null,
        desktopHeroDisplay: opportunityHero ? getComputedStyle(opportunityHero).display : "missing",
        desktopGlanceDisplay: opportunityGlance ? getComputedStyle(opportunityGlance).display : "missing",
        controls
      };
    });
    expect(geometry.position).toBe("static");
    expect(geometry.remoteBottom).not.toBeNull();
    expect(geometry.nextVisibleTop).toBeGreaterThanOrEqual(geometry.remoteBottom);
    expect(geometry.desktopHeroDisplay).toBe("none");
    expect(geometry.desktopGlanceDisplay).toBe("none");
    expect(geometry.controls.every((control) => control.height >= 44)).toBe(true);
    expect(geometry.controls.every((control) => Boolean(control.actionId))).toBe(true);

    await remote.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Menu details" })).toBeVisible();
    await page.getByRole("button", { name: "Close context" }).click();

    await remote.getByRole("button", { name: "Pricing", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Pricing details" })).toBeVisible();
    await page.getByRole("button", { name: "Close context" }).click();

    await remote.getByRole("button", { name: "Proposal", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Proposal details" })).toBeVisible();
    await page.getByRole("button", { name: "Close context" }).click();

    await remote.getByRole("button", { name: "Event", exact: true }).click();
    await expect(surface.locator("#ambient-mobile-event-details")).toBeVisible();
    await expect(surface.locator("#ambient-operational-facts")).toHaveCount(0);
    await expect(surface.locator('[data-result-kind="context"]')).toContainText("Event details shown");
    await expectNoHorizontalOverflow(page, surface);

    if (CAPTURE_PROOF) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-mobile-opportunity-remote-390.png`,
        animations: "disabled"
      });
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`opens global Pilot on the exact Living Opportunity and restores focus at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const surface = await openOpportunity(page);
      const trigger = page.getByRole("button", { name: "Open Pilot for the current context" });
      await expect(trigger).toHaveCount(1);
      await expect(trigger).toBeVisible();
      await trigger.click();

      const dialog = page.getByRole("dialog", { name: "Why this recommendation appears" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Autumn Benefit Dinner");
      await expect(dialog).toContainText("Why this is recommended");
      await expect(dialog).toContainText("What this affects");
      await expect(dialog).toContainText("What you can do next");
      await expect(surface.locator('[data-result-kind="context"]')).toContainText(
        "Pilot explanation opened"
      );
      await expectNoHorizontalOverflow(page, surface);

      if (CAPTURE_PROOF && viewport.width === 390) {
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-global-pilot-opportunity-390.png`,
          animations: "disabled"
        });
      }

      await dialog.getByRole("button", { name: "Close context" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }

  test("keeps global Pilot contextual outside an opportunity instead of opening generic chat", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");
    const trigger = page.getByRole("button", { name: "Open Pilot for the current context" });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Pilot", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Opportunities · Now");
    await expect(dialog).toContainText("Choose an opportunity to see guidance based on its saved details here in Now.");
    await expect(dialog).toContainText("No guidance appears until you choose one");
    await expect(dialog.getByRole("button", { name: "Choose an opportunity" })).toBeVisible();
    await expect(dialog.locator("input, textarea")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close Pilot" }).click();
    await expect(trigger).toBeFocused();
  });

  test("focuses the existing deterministic Pilot surface without running a draft action", async ({ page }) => {
    test.skip(!PILOT_COMMAND_ENABLED, "The exact draft-focus proof needs the independent Pilot command gate.");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/app/quotes/new");
    const trigger = page.getByRole("button", { name: "Open Pilot for the current context" });
    await trigger.click();

    const input = page.getByRole("textbox", { name: "Command for this draft" });
    await expect(input).toBeFocused();
    await expect(page.locator(".pilot-command-context")).toContainText("Current draft");
    await expect(page.locator(".pilot-command-context")).toContainText("New quote draft");
    await expect(page.locator(".pilot-command-preview")).toHaveCount(0);
    await expect(input).toHaveValue("");
  });

  for (const viewport of VIEWPORTS) {
    test(`keeps the focused Messages heading clear and overflow-safe at ${viewport.width}px`, async ({ page }) => {
      await page.addInitScript(({ quote }) => {
        localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
      }, { quote: MESSAGE_QUOTE });
      await page.setViewportSize(viewport);
      await page.goto("/app/messages");

      const station = page.locator(".messaging-station");
      const heading = page.getByRole("heading", { name: "Messages", exact: true });
      await expect(station).toBeVisible();
      await expect(heading).toBeVisible();
      await expect(heading).toBeFocused();
      await expect(station.getByRole("heading", { name: "Messages" })).toBeVisible();
      await expect(station).toContainText("Every conversation stays attached to one event and quote.");

      const geometry = await page.evaluate(async () => {
        const { auditWorkspaceLayout, rectanglesIntersect } = await import("/src/lib/workspaceLayoutAudit.js");
        const group = [...document.querySelectorAll('[data-layout-audit-group="messaging-route-heading"]')];
        const [activeHeading, subtitle] = group;
        const expand = (rect, reserve) => ({
          left: rect.left - reserve,
          top: rect.top - reserve,
          right: rect.right + reserve,
          bottom: rect.bottom + reserve
        });
        const focusRect = expand(activeHeading.getBoundingClientRect(), 2);
        const audit = auditWorkspaceLayout(document, { tolerancePx: 1, focusReservePx: 2 });
        const documentElement = document.documentElement;
        const stationElement = document.querySelector(".messaging-station");
        return {
          audit,
          groupSize: group.length,
          activeIsHeading: document.activeElement === activeHeading,
          focusRingIntersectsSubtitle: rectanglesIntersect(
            focusRect,
            subtitle.getBoundingClientRect(),
            1
          ),
          documentOverflowPx: documentElement.scrollWidth - documentElement.clientWidth,
          stationOverflowPx: stationElement.scrollWidth - stationElement.clientWidth,
          focusStyle: getComputedStyle(activeHeading).boxShadow
        };
      });

      expect(geometry.groupSize).toBe(2);
      expect(geometry.activeIsHeading).toBe(true);
      expect(geometry.focusStyle).not.toBe("none");
      expect(geometry.focusRingIntersectsSubtitle).toBe(false);
      expect(geometry.audit).toMatchObject({
        modelId: "workspace-layout-audit-v1",
        passed: true,
        collisions: [],
        overflow: []
      });
      expect(geometry.documentOverflowPx).toBeLessThanOrEqual(1);
      expect(geometry.stationOverflowPx).toBeLessThanOrEqual(1);

      if (CAPTURE_PROOF && viewport.width === 1440) {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-messages-heading-no-overlap-1440.png`,
          animations: "disabled"
        });
      }
    });
  }
});
