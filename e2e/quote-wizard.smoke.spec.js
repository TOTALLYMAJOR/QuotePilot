import { expect, test } from "@playwright/test";

function parseMoney(text) {
  const normalized = String(text || "").replace(/[^0-9.-]/g, "");
  return Number(normalized || 0);
}

function historyDialogMessage(page, textPattern) {
  return page.getByRole("dialog").getByText(textPattern).first();
}

function futureDateISO(days = 60) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fillRequiredQuoteFields(page, {
  guests = 72,
  eventName = "E2E Launch Dinner",
  venue = "Birmingham Civic Hall",
  date = futureDateISO()
} = {}) {
  const eventType = page.getByLabel(/Event type/i);
  await expect(eventType).toBeVisible();
  const optionCount = await eventType.locator("option").count();
  if (optionCount > 1) {
    await eventType.selectOption({ index: 1 });
  }

  await page.getByLabel(/Event date/i).fill(date);
  await page.getByLabel(/Start time/i).fill("18:00");
  await page.getByRole("spinbutton", { name: /Event hours/i }).fill("4");
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill(String(guests));
  await page.getByRole("textbox", { name: /Event name/i }).fill(eventName);
  await page.getByRole("textbox", { name: /Venue/i }).first().fill(venue);
  await page.getByRole("textbox", { name: /Venue address/i }).fill("123 Event Way, Birmingham, AL");
  await page.getByRole("textbox", { name: /Your name/i }).fill("E2E Staff");
  await page.getByRole("textbox", { name: /Phone/i }).fill("205-555-0184");
  await page.getByRole("textbox", { name: /Email/i }).fill("client@example.com");
}

async function advanceToSaveButton(page, saveButtonLabel) {
  for (let step = 0; step < 6; step += 1) {
    const firstMenuChoice = page.locator(
      ".wizard-panel .menu-library input[type='checkbox']:not(:checked)"
    ).first();
    if (await firstMenuChoice.count()) {
      await firstMenuChoice.check();
    }
    const packageTier = page.getByLabel("Package tier");
    if (await packageTier.count()) {
      await packageTier.selectOption("premium");
    }
    const travelMiles = page.getByLabel("Travel (round trip miles)");
    if (await travelMiles.count()) {
      await travelMiles.fill("28");
    }
    const depositLink = page.getByLabel("Deposit payment link (optional)");
    if (await depositLink.count()) {
      await depositLink.fill("https://checkout.stripe.com/c/pay/cs_test_e2e_deposit");
    }

    const saveButton = page.getByRole("button", { name: saveButtonLabel });
    if (await saveButton.count()) {
      await expect(saveButton).toBeVisible();
      await saveButton.click();
      return;
    }

    const nextButton = page.getByRole("button", { name: /^Next:/ });
    if (!(await nextButton.count())) {
      break;
    }
    await nextButton.click();
  }
  throw new Error(`Unable to reach save button: ${saveButtonLabel}`);
}

async function createQuoteToHistory(page, { guests = 72, eventName, venue, date } = {}) {
  await fillRequiredQuoteFields(page, { guests, eventName, venue, date });
  await advanceToSaveButton(page, "Save draft");
  const history = page.getByRole("dialog", { name: "Quotes" });
  const handoff = history.locator(".saved-quote-handoff");
  await expect(handoff).toContainText(/Saved as a draft/i);
  await expect(handoff).toBeFocused();
  const historyHeading = history.getByRole("heading", { name: "Quotes" });
  await expect(historyHeading).toBeVisible();
}

function quoteRows(page) {
  return page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  });
}

async function setQuoteStatus(row, status) {
  const statusSelect = row.locator("select").first();
  await statusSelect.selectOption(status);
  await expect(statusSelect).toHaveValue(status);
}

async function openOperationsItem(page, name) {
  await page.getByRole("button", { name: "Operations" }).click();
  await page.getByRole("menuitem", { name }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/app");
  await expect(page.getByRole("button", { name: /New quote/i })).toBeVisible();
});

test("empty Workflow leads directly into the first quote", async ({ page }) => {
  await page.getByRole("button", { name: /Workflow/i }).click();
  await expect(page.getByRole("heading", {
    name: "Create the first quote to begin follow-up"
  })).toBeVisible();
  await expect(page.getByText(/QuotePilot will carry the saved quote, proposal readiness, decisions, and follow-ups/i)).toBeVisible();

  await page.getByRole("button", { name: "Start a quote" }).click();
  await expect(page.getByText("Creating this quote", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Create the first quote to begin follow-up"
  })).toHaveCount(0);
});

test("operator workspaces load only when first opened and stay mounted after close", async ({ page }) => {
  const modalResourceNames = async () => page.evaluate(() => (
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /(?:AdminCatalog|ImportStudio|QuoteHistory|SalesWorkflow|EventSchedule|IntegrationOps|Diagnostics|QuoteCompare|ReportingDashboard)Modal(?:-[^/?]+\.js|\.jsx)/.test(name))
  ));

  expect(await modalResourceNames()).toEqual([]);

  await page.getByRole("button", { name: "Workflow" }).click();
  await expect(page.getByRole("heading", { name: "Workflow" })).toBeVisible();
  await expect.poll(modalResourceNames).toEqual([
    expect.stringMatching(/SalesWorkflowModal(?:-[^/?]+\.js|\.jsx)/)
  ]);

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Workflow" })).toHaveCount(0);
  await page.getByRole("button", { name: "Workflow" }).click();
  await expect(page.getByRole("heading", { name: "Workflow" })).toBeVisible();
  expect(await modalResourceNames()).toHaveLength(1);
});

test("workflow attention throttles passive reads and retains a known count on refresh failure", async ({ page }) => {
  const emptyTrigger = page.getByRole("button", {
    name: /Workflow, no quote follow-ups in this view/i
  });
  await expect(emptyTrigger).toBeVisible();

  await page.evaluate(() => {
    const nativeGetItem = Storage.prototype.getItem;
    window.__quoteAttentionReadCount = 0;
    Storage.prototype.getItem = function countedGetItem(key) {
      if (key === "quoteWizard.quotes") window.__quoteAttentionReadCount += 1;
      return nativeGetItem.call(this, key);
    };
  });

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => page.evaluate(() => window.__quoteAttentionReadCount)).toBe(0);

  await page.evaluate(() => {
    const submittedAtISO = new Date().toISOString();
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([{
      id: "attention-refresh-quote",
      organizationId: "e2e-org",
      quoteNumber: "Q-ATTENTION-REFRESH",
      status: "viewed",
      customer: { name: "Refresh Customer", email: "refresh@example.com" },
      portalDecision: {
        decision: "changes_requested",
        message: "Please revise the service plan.",
        requestId: "request-attention-refresh",
        submittedAtISO
      },
      createdAtISO: submittedAtISO,
      updatedAtISO: submittedAtISO
    }]));
    window.dispatchEvent(new StorageEvent("storage", { key: "quoteWizard.quotes" }));
  });
  await expect(page.getByRole("button", {
    name: /Workflow, 1 quote needs attention/i
  })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__quoteAttentionReadCount)).toBe(1);

  await page.evaluate(() => {
    const futureNow = Date.now() + 61000;
    Date.now = () => futureNow;
    localStorage.setItem("quoteWizard.quotes", "not-json");
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => page.evaluate(() => window.__quoteAttentionReadCount)).toBe(2);
  await expect(page.getByRole("button", {
    name: /Workflow, 1 quote needs attention/i
  })).toBeVisible();
});

test("Quotes loads once, then searches and counts the tenant result locally", async ({ page }) => {
  await page.evaluate(() => {
    // Keep the loading contract observable even on fast CI workers. A 250 ms
    // delay can elapse while Playwright resolves and clicks the lazy modal.
    window.__quotePilotE2eDelays = { quoteHistoryMs: 1_500 };
    const base = {
      organizationId: "e2e-org",
      status: "draft",
      portalIssuedAtISO: "2026-12-01T12:00:00.000Z",
      portalExpiresAtISO: "2099-12-31T23:59:59.000Z",
      expiresAtISO: "2099-12-31T23:59:59.000Z",
      totals: { total: 2400, deposit: 720 },
      payment: { depositStatus: "unpaid", depositLink: "" },
      booking: {},
      selection: { eventTypeId: "wedding" },
      quoteMeta: {},
      lifecycle: { draftAtISO: "2026-12-01T12:00:00.000Z" }
    };
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([
      {
        ...base,
        id: "history-alpha",
        quoteNumber: "Q-ALPHA-1001",
        portalKey: "history-alpha-portal-key-1234567890",
        customerNameKey: "alex rivera",
        customer: { name: "Alex Rivera", email: "alex@example.com" },
        event: { name: "Winter Gala", date: "2027-01-05", guests: 80 },
        createdAtISO: "2026-12-01T12:00:00.000Z",
        updatedAtISO: "2026-12-02T12:00:00.000Z"
      },
      {
        ...base,
        id: "history-beta",
        quoteNumber: "Q-BETA-1002",
        portalKey: "history-beta-portal-key-12345678901",
        customerNameKey: "blair chen",
        customer: { name: "Blair Chen", email: "blair@example.com" },
        event: { name: "Spring Dinner", date: "2027-03-09", guests: 60 },
        createdAtISO: "2026-12-03T12:00:00.000Z",
        updatedAtISO: "2026-12-04T12:00:00.000Z"
      }
    ]));
  });

  await page.getByRole("button", { name: "Quotes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Quotes" });
  await expect(dialog.locator(".history-skeleton-row")).toHaveCount(3);
  await expect(dialog.getByText("Showing 2 of 2 quotes")).toBeVisible();
  await expect(dialog.getByText("Jan 5, 2027")).toBeVisible();

  const search = dialog.getByPlaceholder("Search customer, quote #, or event");
  for (const query of ["Q-ALPHA", "Winter Gala", "alex@example.com"]) {
    await search.fill(query);
    await expect(dialog.getByText("Showing 1 of 2 quotes")).toBeVisible();
    await expect(dialog.locator('tr[data-quote-id="history-alpha"]')).toBeVisible();
  }
  await search.fill("No such quote");
  await expect(dialog.getByText("Showing 0 of 2 quotes")).toBeVisible();
  await expect(dialog.getByText(/No quotes match/i)).toBeVisible();
  await dialog.getByRole("button", { name: "Clear filters" }).click();
  await expect(dialog.getByText("Showing 2 of 2 quotes")).toBeVisible();
});

test("desktop and mobile navigation stay bounded and menus restore focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const header = page.locator(".site-header");
  for (const name of ["New quote", "Quotes", "Operations", "Account"]) {
    await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(header.getByRole("button", { name: /^Workflow(?:,|$)/ })).toBeVisible();
  await expect(header.getByRole("button", { name: "More" })).toBeHidden();

  const operations = header.getByRole("button", { name: "Operations" });
  await operations.click();
  await expect(operations).toHaveAttribute("aria-expanded", "true");
  for (const name of [
    "Event Schedule",
    "Reporting Dashboard",
    "Integrations Ops",
    "Import Studio",
    "Catalog Admin",
    "Session Diagnostics"
  ]) {
    await expect(header.getByRole("menuitem", { name })).toBeVisible();
  }
  await header.getByRole("button", { name: "Account" }).click();
  await expect(operations).toHaveAttribute("aria-expanded", "false");
  await expect(header.getByText("e2e-admin@local.test")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(header.getByRole("button", { name: "Account" })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(header.getByRole("button", { name: "Operations" })).toBeHidden();
  const more = header.getByRole("button", { name: "More" });
  await expect(more).toBeVisible();
  await more.click();
  await expect(header.getByRole("menuitem", { name: "Event Schedule" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("New quote confirms only real edits and resets the canonical quote fields", async ({ page }) => {
  let dialogCount = 0;
  page.on("dialog", () => { dialogCount += 1; });
  await page.getByRole("button", { name: "New quote" }).click();
  expect(dialogCount).toBe(0);

  await page.getByRole("textbox", { name: /Event name/i }).fill("Unsaved Gala");
  await page.getByRole("textbox", { name: /Your name/i }).fill("Unsaved Client");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "New quote" }).click();
  expect(dialogCount).toBe(1);
  await expect(page.getByRole("textbox", { name: /Event name/i })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: /Your name/i })).toHaveValue("");
  await expect(page.getByText("Workspace open")).toBeVisible();
});

test("step 1 next stays actionable and explains missing required fields", async ({ page }) => {
  const nextButton = page.getByRole("button", { name: /^Next:/ });
  await expect(nextButton).toBeEnabled();
  await expect(page.getByText(/Missing required fields/i)).toBeVisible();

  await nextButton.click();
  await expect(page.getByText(/Complete required fields before continuing/i)).toBeVisible();
  await expect(page.locator("[aria-invalid='true']")).toHaveCount(7);
  await expect(page.getByText(/event type, event date, guest count, event name, venue, client name, valid client email/i)).toBeVisible();
  await expect(page.locator("[aria-invalid='true']").first()).toBeFocused();
  await expect(page.locator(".stepper-item[aria-current='step']")).toContainText("Event Basics");
  await nextButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[aria-invalid='true']")).toHaveCount(7);
  await expect(page.locator("[aria-invalid='true']").first()).toBeFocused();

  await fillRequiredQuoteFields(page, { guests: 58, eventName: "E2E Soft Lock", venue: "Guidance Hall" });
  await expect(page.getByText(/Missing required fields/i)).toHaveCount(0);
  await nextButton.click();
  await expect(page.getByRole("heading", { name: /Build the menu|Customized Cuisine Menu/i })).toBeVisible();
});

test("menu loading and empty states lead admins to the selected Catalog Admin menu", async ({ page }) => {
  await page.addInitScript(() => {
    window.__pendingMenuResolvers = [];
    window.__quotePilotE2eFunctions = {
      loadMenuByEvent: () => new Promise((resolve) => {
        window.__pendingMenuResolvers.push(resolve);
      })
    };
  });
  await page.reload();
  await fillRequiredQuoteFields(page, { guests: 54, eventName: "Menu State Test", venue: "Menu Hall" });
  const selectedEventTypeId = await page.getByLabel(/Event type/i).inputValue();
  const selectedEventType = await page.getByLabel(/Event type/i).locator("option:checked").textContent();
  await page.getByRole("button", { name: /^Next:/ }).click();
  await expect(page.locator(".menu-skeleton-row")).toHaveCount(3);
  await expect(page.locator(".menu-state")).toHaveAttribute("aria-busy", "true");

  await page.evaluate(() => {
    window.__pendingMenuResolvers.splice(0).forEach((resolve) => resolve([]));
  });
  await expect(page.getByText(`No menu items are configured for ${selectedEventType} yet.`)).toBeVisible();
  await page.getByRole("button", { name: "Add menu items" }).click();
  const catalogAdmin = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Catalog Admin" }) });
  await expect(catalogAdmin.getByRole("heading", { name: "Catalog Admin" })).toBeVisible();
  await expect(page.locator(".admin-tab.active")).toHaveText("Menu");
  await expect(catalogAdmin.getByRole("combobox", { name: "Event type", exact: true }))
    .toHaveValue(selectedEventTypeId);
});

test("a menu item created in Catalog Admin appears in the active quote immediately", async ({ page }) => {
  await fillRequiredQuoteFields(page, {
    guests: 55,
    eventName: "Immediate Menu Refresh",
    venue: "Refresh Hall"
  });
  const selectedEventTypeId = await page.getByLabel(/Event type/i).inputValue();
  await page.getByRole("button", { name: /^Next:/ }).click();

  await page.getByRole("button", { name: "Operations" }).click();
  await page.getByRole("menuitem", { name: "Catalog Admin" }).click();
  const catalogAdmin = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Catalog Admin" })
  });
  await catalogAdmin.getByRole("tab", { name: "Menu" }).click();
  await catalogAdmin.getByRole("combobox", { name: "Event type", exact: true })
    .selectOption(selectedEventTypeId);
  const category = catalogAdmin.getByRole("combobox", { name: "Category", exact: true });
  await expect.poll(() => category.locator("option").count()).toBeGreaterThan(1);
  await category.selectOption({ index: 1 });
  await catalogAdmin.getByPlaceholder("New item name").fill("Immediate Recovery Entree");
  await catalogAdmin.locator(".admin-inline-actions-create-item input[type='number']").fill("12.34");
  await catalogAdmin.getByRole("button", { name: "Add Item" }).click();
  const setupCatalogAdmin = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Catalog Admin" })
  });
  await expect(setupCatalogAdmin.getByRole("heading", { name: "Review Pricing Before Quoting" }))
    .toBeVisible();
  await setupCatalogAdmin.getByLabel("Pricing setup reviewed and approved").check();
  await setupCatalogAdmin.getByRole("button", { name: "Save catalog changes" }).first().click();
  await expect(setupCatalogAdmin).toHaveCount(0);

  await expect(page.getByRole("checkbox", { name: /Immediate Recovery Entree/i })).toBeVisible();
});

test("menu retry repeats the selected event request without clearing selections", async ({ page }) => {
  await page.addInitScript(() => {
    window.__menuShouldFail = false;
    window.__quotePilotE2eFunctions = {
      loadMenuByEvent: async () => {
        if (window.__menuShouldFail) throw new Error("temporary menu failure");
        return [{
          id: "entrees",
          name: "Entrees",
          items: [{ id: "menu-retry-chicken", name: "Herb Chicken", pricingType: "per_person", price: 12 }]
        }];
      }
    };
  });
  await page.reload();
  await fillRequiredQuoteFields(page, { guests: 56, eventName: "Menu Retry Test", venue: "Retry Hall" });
  await page.getByRole("button", { name: /^Next:/ }).click();
  const chicken = page.getByRole("checkbox", { name: /Herb Chicken/i });
  await expect(chicken).toBeVisible();
  await chicken.check();

  await page.getByRole("button", { name: "Back" }).click();
  await page.evaluate(() => { window.__menuShouldFail = true; });
  const eventType = page.getByLabel(/Event type/i);
  const optionCount = await eventType.locator("option").count();
  await eventType.selectOption({ index: Math.min(2, optionCount - 1) });
  await page.getByRole("button", { name: /^Next:/ }).click();
  await expect(page.getByRole("alert")).toContainText(/couldn't load the menu/i);
  await page.evaluate(() => { window.__menuShouldFail = false; });
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(chicken).toBeChecked();
});

test("staffing counts stay primary while optional rate values remain reviewable", async ({ page }) => {
  const staffingGroup = page.getByRole("group", { name: "Attendance & staffing" });
  const advancedPricing = page.getByRole("button", { name: /Advanced Pricing Overrides/i });
  const serverRateOverride = page.getByRole("spinbutton", { name: /^Server rate override/i });
  const serverRateMix = page.getByRole("textbox", { name: /^Server rates \(optional, one per server\)/i });
  const chefRateOverride = page.getByRole("spinbutton", { name: /^Chef rate override/i });
  const chefRateMix = page.getByRole("textbox", { name: /^Chef rates \(optional, one per chef\)/i });
  const bartenderRateOverride = page.getByRole("spinbutton", { name: /^Bartender rate override/i });
  const rateFields = [
    serverRateOverride,
    serverRateMix,
    chefRateOverride,
    chefRateMix,
    bartenderRateOverride
  ];
  const expectStaffingLayout = async ({ width, columns }) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await expect(staffingGroup).toBeVisible();
    const layout = await staffingGroup.evaluate((element) => {
      const fieldset = element.getBoundingClientRect();
      const panel = element.closest(".accordion-panel")?.getBoundingClientRect();
      const innerGrid = element.querySelector(":scope > .grid.two-col");
      return {
        columns: getComputedStyle(innerGrid).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        fieldsetLeft: fieldset.left,
        fieldsetRight: fieldset.right,
        panelLeft: panel?.left ?? 0,
        panelRight: panel?.right ?? document.documentElement.clientWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      };
    });
    expect(layout.columns).toBe(columns);
    expect(layout.fieldsetLeft).toBeGreaterThanOrEqual(layout.panelLeft - 1);
    expect(layout.fieldsetRight).toBeLessThanOrEqual(layout.panelRight + 1);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  };

  await expectStaffingLayout({ width: 1440, columns: 2 });
  await expectStaffingLayout({ width: 390, columns: 1 });
  await expectStaffingLayout({ width: 320, columns: 1 });
  await page.setViewportSize({ width: 1440, height: 900 });

  await expect(staffingGroup).toBeVisible();
  await expect(advancedPricing).toHaveAttribute("aria-expanded", "false");
  for (const field of rateFields) await expect(field).toHaveCount(0);

  await page.getByRole("button", { name: /Increase Bartenders/i }).click();
  await page.getByRole("button", { name: /Increase Bartenders/i }).click();
  await expect(page.getByRole("spinbutton", { name: "Bartenders" })).toHaveValue("2");

  await advancedPricing.click();
  await expect(advancedPricing).toHaveAttribute("aria-expanded", "true");
  for (const field of rateFields) await expect(field).toBeVisible();

  await serverRateOverride.fill("32");
  await serverRateMix.fill("31, 33");
  await chefRateOverride.fill("48");
  await chefRateMix.fill("45, 50");
  await bartenderRateOverride.fill("48");

  await advancedPricing.click();
  await expect(advancedPricing).toHaveAttribute("aria-expanded", "false");
  await expect(advancedPricing).toContainText("Staffing rate values are set");
  for (const field of rateFields) await expect(field).toHaveCount(0);

  await advancedPricing.click();
  await expect(serverRateOverride).toHaveValue("32");
  await expect(serverRateMix).toHaveValue("31, 33");
  await expect(chefRateOverride).toHaveValue("48");
  await expect(chefRateMix).toHaveValue("45, 50");
  await expect(bartenderRateOverride).toHaveValue("48");
});

test("hero CTA remains available and returns workflow focus to step 1", async ({ page }) => {
  await fillRequiredQuoteFields(page, { guests: 64, eventName: "E2E Hero CTA", venue: "CTA Ballroom" });
  await page.getByRole("button", { name: /^Next:/ }).click();
  await expect(page.getByRole("heading", { name: /Build the menu|Customized Cuisine Menu/i })).toBeVisible();

  await page.getByRole("button", { name: "New Quote" }).click();
  await expect(page.getByText("Core Event Basics")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next:/ })).toBeVisible();
});

test("live breakdown shows transient change cues when quote inputs update", async ({ page }) => {
  await fillRequiredQuoteFields(page, { guests: 52, eventName: "E2E Breakdown", venue: "Delta Center" });

  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("96");
  const totalRow = page.locator('[data-row-key="total"]');
  await expect(totalRow).toHaveAttribute("data-changed", "true");
  await expect(totalRow.locator(".row-delta")).toBeVisible();
});

test("mobile quote pricing stays visible through the workflow without covering controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileSummary = page.getByTestId("mobile-pricing-summary");
  const mobileTotal = page.getByTestId("mobile-pricing-total");
  const liveStatus = page.locator("[data-pricing-live-status]");
  const breakdown = page.locator("#live-breakdown");
  const breakdownToggle = mobileSummary.locator('button[aria-controls="live-breakdown"]');
  const expectCurrentStepContained = async (stepLabel) => {
    const currentStep = page.locator('.stepper-item[aria-current="step"]');
    await expect(currentStep).toContainText(stepLabel);
    await expect.poll(() => currentStep.evaluate((element) => {
      const item = element.getBoundingClientRect();
      const rail = element.parentElement.getBoundingClientRect();
      return item.left >= rail.left - 1 && item.right <= rail.right + 1;
    })).toBe(true);
  };

  await page.getByRole("button", { name: "New Quote" }).click();
  await expect(mobileSummary).toBeVisible();
  await expect(mobileSummary).toBeInViewport();
  await expect(breakdownToggle).toHaveAccessibleName("View breakdown");
  await expect(breakdown).toBeHidden();
  await fillRequiredQuoteFields(page, { guests: 72 });
  await page.getByRole("button", { name: /^Next:/ }).click();
  await page.locator(".menu-library input[type='checkbox']").first().check();

  await expect(mobileSummary).toBeVisible();
  await expect(mobileSummary).toBeInViewport();
  const initialTotal = parseMoney(await mobileTotal.innerText());
  const initialLiveStatus = await liveStatus.innerText();

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("110");
  await page.getByRole("button", { name: /^Next:/ }).click();
  await expect.poll(async () => parseMoney(await mobileTotal.innerText())).toBeGreaterThan(initialTotal);
  await expect.poll(async () => liveStatus.innerText()).not.toBe(initialLiveStatus);
  await expect(liveStatus).toContainText(await mobileTotal.innerText());

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(mobileSummary).toBeVisible();
  await expect(mobileSummary).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mobileSummary).toBeInViewport();

  const stepLabels = ["Add-ons / Rentals", "Pricing Summary", "Save Quote"];
  for (const stepLabel of stepLabels) {
    await page.getByRole("button", { name: /^Next:/ }).click();
    await expect(mobileSummary).toBeVisible();
    await expect(mobileSummary).toBeInViewport();
    await expectCurrentStepContained(stepLabel);
  }

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(mobileSummary).toBeVisible();
  await expect(mobileSummary).toBeInViewport();
  await expectCurrentStepContained("Save Quote");
  const saveButton = page.getByRole("button", { name: "Save draft" });
  await saveButton.evaluate((element) => element.scrollIntoView({ block: "center" }));

  const [summaryBox, saveBox, layout] = await Promise.all([
    mobileSummary.boundingBox(),
    saveButton.boundingBox(),
    page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      viewportHeight: window.innerHeight
    }))
  ]);
  expect(summaryBox).not.toBeNull();
  expect(saveBox).not.toBeNull();
  expect(summaryBox.x).toBeGreaterThanOrEqual(0);
  expect(summaryBox.x + summaryBox.width).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(summaryBox.y + summaryBox.height).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(saveBox.y).toBeGreaterThan(summaryBox.y + summaryBox.height);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

  await expect(breakdownToggle).toHaveAccessibleName("View breakdown");
  const toggleBox = await breakdownToggle.boundingBox();
  expect(toggleBox.height).toBeGreaterThanOrEqual(44);
  await expect(breakdownToggle).toHaveAttribute("aria-expanded", "false");
  await expect(liveStatus).toHaveCount(1);
  await expect(breakdown).not.toHaveAttribute("aria-live");
  await breakdownToggle.click();
  await expect(breakdownToggle).toHaveAttribute("aria-expanded", "true");
  await expect(breakdownToggle).toHaveAccessibleName("Hide breakdown");
  await expect(breakdown).toBeVisible();
  await expect(breakdown).toHaveAttribute("role", "dialog");
  await expect(breakdown).toHaveAttribute("aria-modal", "true");
  await expect.poll(() => page.locator(".wizard-panel").evaluate((element) => element.inert)).toBe(true);
  const closeBreakdown = page.getByRole("button", { name: "Close" });
  await expect(closeBreakdown).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeBreakdown).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(closeBreakdown).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(breakdown).toBeHidden();
  await expect(breakdownToggle).toHaveAttribute("aria-expanded", "false");
  await expect(breakdownToggle).toHaveAccessibleName("View breakdown");
  await expect(breakdownToggle).toBeFocused();
  await expect.poll(() => page.locator(".wizard-panel").evaluate((element) => element.inert)).toBe(false);

  await breakdownToggle.click();
  await expect(closeBreakdown).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(mobileSummary).toBeHidden();
  await expect(breakdownToggle).toHaveAttribute("aria-expanded", "false");
  await expect(breakdown).not.toHaveClass(/is-mobile-expanded/);
  await expect(breakdown).not.toHaveAttribute("role", "dialog");
  await expect(page.locator("main.wizard-grid")).toBeFocused();
  expect(await breakdown.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(mobileSummary).toBeVisible();
  await expect(mobileSummary).toBeInViewport();
  await expect(breakdown).toBeHidden();
  await expectCurrentStepContained("Save Quote");
});

test("good better best scenarios can be compared and applied", async ({ page }) => {
  await fillRequiredQuoteFields(page, {
    guests: 96,
    eventName: "E2E Scenario Gala",
    venue: "Scenario Hall"
  });
  await page.getByRole("button", { name: /^Next:/ }).click();
  await page.locator(".menu-library input[type='checkbox']").first().check();
  await page.getByRole("button", { name: "Compare Scenario" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Good", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Better", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Best", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Compare Best" }).click();
  await dialog.getByRole("button", { name: "Use Best" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: /^Next:/ }).click();
  await expect(page.getByLabel("Package tier")).toHaveValue("deluxe");
});

test("draft save handoff targets the exact new quote and stays truthful across saves", async ({ page }) => {
  await fillRequiredQuoteFields(page, { guests: 60, eventName: "E2E Quote A", venue: "Hall A" });
  await page.getByRole("button", { name: /^Next:/ }).click();

  const totalLocator = page.locator(".breakdown-panel [data-row-key='total'] dd strong");
  await page.waitForTimeout(700);
  const beforeTotal = parseMoney(await totalLocator.innerText());

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("110");
  await page.getByRole("button", { name: /^Next:/ }).click();

  await page.waitForTimeout(700);
  const afterTotal = parseMoney(await totalLocator.innerText());
  expect(afterTotal).toBeGreaterThan(beforeTotal);

  await advanceToSaveButton(page, "Save draft");

  const history = page.getByRole("dialog", { name: "Quotes" });
  const firstHandoff = history.locator(".saved-quote-handoff");
  await expect(firstHandoff).toContainText(/Saved as a draft/i);
  await expect(firstHandoff).toContainText(/has not been sent/i);
  await expect(firstHandoff).toBeFocused();
  await expect(page.locator(".portal-link-row")).toHaveCount(0);
  const firstQuoteId = await firstHandoff.getAttribute("data-quote-id");
  expect(firstQuoteId).toBeTruthy();
  const firstQuoteRow = page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  }).first();
  await expect(firstQuoteRow).toContainText("E2E Staff");
  await expect(firstQuoteRow).toContainText("110");
  await expect(history.locator("tr.history-row-target")).toHaveAttribute("data-quote-id", firstQuoteId);

  await history.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeFocused();
  await page.getByRole("button", { name: "New Quote" }).click();
  await fillRequiredQuoteFields(page, {
    guests: 61,
    eventName: "E2E Quote B",
    venue: "Hall B",
    date: futureDateISO(61)
  });
  await advanceToSaveButton(page, "Save draft");

  const secondHandoff = page.getByRole("dialog", { name: "Quotes" }).locator(".saved-quote-handoff");
  await expect(secondHandoff).toBeFocused();
  const secondQuoteId = await secondHandoff.getAttribute("data-quote-id");
  expect(secondQuoteId).toBeTruthy();
  expect(secondQuoteId).not.toBe(firstQuoteId);
  const secondTargetRow = page.getByRole("dialog", { name: "Quotes" })
    .locator("tr.history-row-target");
  await expect(secondTargetRow).toHaveAttribute("data-quote-id", secondQuoteId);
  await expect(secondTargetRow).toContainText("61");

  const customerSearch = page.getByRole("dialog", { name: "Quotes" })
    .getByPlaceholder("Search customer, quote #, or event");
  await customerSearch.fill("No Matching Customer");
  await expect(secondHandoff).toHaveCount(0);
  await expect(customerSearch).toBeFocused();
  await customerSearch.fill("");
  await expect(secondHandoff).toHaveAttribute("data-quote-id", secondQuoteId);
  await expect(customerSearch).toBeFocused();
});

test("unresolved quote delivery locks conflicting mutations but keeps read-only artifacts", async ({ page }) => {
  await createQuoteToHistory(page, {
    guests: 58,
    eventName: "Unresolved Delivery",
    venue: "Safety Hall"
  });
  const history = page.getByRole("dialog", { name: "Quotes" });
  const quoteId = await history.locator(".saved-quote-handoff").getAttribute("data-quote-id");
  expect(quoteId).toBeTruthy();
  await history.getByRole("button", { name: "Close" }).click();

  await page.evaluate((targetQuoteId) => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    const quote = quotes.find((item) => item.id === targetQuoteId);
    if (!quote) throw new Error("Saved quote fixture not found.");
    const explicit = String(quote.activeVersionId || quote.versionMeta?.versionId || "")
      .trim()
      .slice(0, 80);
    const versionNumber = Number(quote.latestVersionNumber || quote.versionMeta?.versionNumber);
    const contentRevisionId = explicit || (
      Number.isSafeInteger(versionNumber) && versionNumber > 0
        ? `v${String(versionNumber).padStart(4, "0")}`
        : "v0001"
    );
    quote.activeVersionId = contentRevisionId;
    quote.latestVersionNumber = Math.max(1, Number(quote.latestVersionNumber) || 0);
    const portalIssuedAt = String(quote.portalIssuedAtISO || "").trim();
    const parsedPortalIssuedAt = portalIssuedAt ? new Date(portalIssuedAt) : null;
    const portalIdentity = parsedPortalIssuedAt && !Number.isNaN(parsedPortalIssuedAt.getTime())
      ? parsedPortalIssuedAt.toISOString()
      : String(quote.portalKey || "").trim().slice(0, 64);
    const revisionId = portalIdentity
      ? `${contentRevisionId}@${portalIdentity}`
      : contentRevisionId;
    quote.workflow = {
      ...(quote.workflow || {}),
      quoteDelivery: {
        revisionId,
        state: "sending",
        attemptId: "e2e-unresolved",
        leaseExpiresAtISO: new Date(Date.now() + 60_000).toISOString()
      }
    };
    localStorage.setItem("quoteWizard.quotes", JSON.stringify(quotes));
  }, quoteId);

  await page.getByRole("button", { name: "Quotes", exact: true }).click();
  const row = page.locator(`tr[data-quote-id="${quoteId}"]`);
  await expect(row).toContainText("Delivery in progress");
  for (const control of await row.locator("select").all()) {
    await expect(control).toBeDisabled();
  }
  for (const name of ["Edit", "Rotate Portal", "Delete"]) {
    await expect(row.getByRole("button", { name })).toBeDisabled();
  }
  await expect(row.getByRole("button", { name: "Send Pay Request" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Duplicate" })).toBeEnabled();
  await expect(row.getByRole("button", { name: "PDF" })).toBeEnabled();
  await expect(row.getByRole("button", { name: "Copy Email" })).toBeEnabled();
});

test("quote history supports export and hides an unapproved payment link", async ({ page }) => {
  await createQuoteToHistory(page, { guests: 84 });

  const firstQuoteRow = page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  }).first();
  await expect(firstQuoteRow).toBeVisible();

  await firstQuoteRow.getByRole("button", { name: "Copy Email" }).click();
  await expect(page.getByRole("dialog").getByText(/Email template copied/i).first()).toContainText(/remains a draft/i);
  await expect(firstQuoteRow.getByRole("combobox").first()).toHaveValue("draft");
  await expect(firstQuoteRow.getByRole("button", { name: "Copy Portal" })).toBeDisabled();

  const downloadPromise = page.waitForEvent("download");
  await firstQuoteRow.getByRole("button", { name: "PDF" }).click();
  const pdfDownload = await downloadPromise;
  expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/i);

  const localBeoButton = firstQuoteRow.getByRole("button", {
    name: "Local BEO — no receipt",
    exact: true
  });
  await expect(localBeoButton).toBeEnabled();
  const kitchenSheetDownloadPromise = page.waitForEvent("download");
  await localBeoButton.click();
  const kitchenSheetDownload = await kitchenSheetDownloadPromise;
  expect(kitchenSheetDownload.suggestedFilename()).toMatch(/kitchen-beo\.pdf$/i);

  await expect(firstQuoteRow.getByRole("button", { name: "Copy Pay Link" })).toHaveCount(0);
});

test("sales workflow persists a follow-up plan", async ({ page }) => {
  const dueDate = futureDateISO(10);
  await createQuoteToHistory(page, {
    guests: 78,
    eventName: "E2E Follow-up Dinner",
    venue: "Follow-up Hall"
  });
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Workflow" }).click();

  const workflow = page.getByRole("dialog");
  await expect(workflow.getByRole("heading", { name: "Workflow" })).toBeVisible();
  await workflow.getByLabel("Due date").fill(dueDate);
  await workflow.getByLabel("Note").fill("Confirm final menu after tasting.");
  await workflow.getByRole("button", { name: "Save Follow-up" }).click();
  await expect(workflow.getByText(/Follow-up saved for/i)).toBeVisible();

  const quoteLabel = (await workflow.locator(".workflow-detail-head .eyebrow").textContent())?.trim() || "";
  await workflow.getByRole("button", { name: "Request", exact: true }).click();
  await expect(workflow.getByText(/Rotate portal link approval requested/i)).toBeVisible();
  await workflow.getByRole("tab", { name: "Attention (1)" }).click();
  await workflow.getByRole("button", { name: `Review approvals for ${quoteLabel}` }).click();
  const pendingApproval = workflow.locator(".approval-row[data-pending='true']");
  await expect(pendingApproval).toBeFocused();
  await workflow.getByLabel(`Resolution note for Rotate portal link on ${quoteLabel}`).fill(
    "Approved for the test workflow."
  );
  await workflow.getByRole("button", {
    name: `Approve Rotate portal link for ${quoteLabel}`
  }).click();
  await expect(pendingApproval).toHaveCount(0);
  const resolvedApproval = workflow.locator(".approval-row[data-pending='false']");
  await expect(resolvedApproval).toBeFocused();

  await resolvedApproval.getByRole("button", { name: "Execute in Quotes" }).click();
  const history = page.getByRole("dialog", { name: "Quotes" });
  const executionRow = history.locator(`tr[data-quote-id]`).filter({ hasText: quoteLabel }).first();
  await expect(executionRow).toBeVisible();
  const rotatePortalButton = executionRow.getByRole("button", { name: "Rotate Portal" });
  await expect(rotatePortalButton).toBeFocused();
  await rotatePortalButton.click();
  await expect(history.getByText(/Portal link rotated/i)).toBeVisible();
  await history.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Workflow" })).toBeFocused();
  await page.getByRole("button", { name: "Workflow" }).click();
  await expect(page.getByRole("dialog").getByLabel("Due date")).toHaveValue(dueDate);
  await expect(page.getByRole("dialog").getByLabel("Note")).toHaveValue("Confirm final menu after tasting.");
});

test("portal decision center records a customer change request", async ({ page }) => {
  const eventDate = futureDateISO(75);
  const eventDateLabel = new Date(`${eventDate}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  await createQuoteToHistory(page, {
    guests: 88,
    eventName: "E2E Portal Decision",
    venue: "Decision Hall",
    date: eventDate
  });
  await setQuoteStatus(quoteRows(page).first(), "sent");
  const portalKey = await page.evaluate(() => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    return quotes[0]?.portalKey || "";
  });
  expect(portalKey).toBeTruthy();

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", {
    name: /Workflow, no quote follow-ups in this view/i
  })).toBeVisible();
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Customer Portal" }).click();
  await expect(page.getByRole("heading", { name: "Your proposal" })).toBeVisible();
  await page.getByPlaceholder("Paste your quote key").fill(portalKey);
  await page.getByRole("button", { name: "Open Proposal" }).click();
  await expect(page.getByRole("heading", {
    name: `E2E Portal Decision on ${eventDateLabel}`
  })).toBeVisible();
  const viewEvidence = await page.evaluate((key) => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    const quote = quotes.find((item) => item.portalKey === key);
    return {
      status: quote?.status || "",
      viewedAtISO: quote?.lifecycle?.viewedAtISO || ""
    };
  }, portalKey);
  expect(viewEvidence.status).toBe("viewed");
  expect(viewEvidence.viewedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await page.getByRole("button", { name: "Request Changes" }).click();
  await page.getByLabel("Requested changes").fill("Please replace the entree with a vegetarian option.");
  await page.getByRole("button", { name: "Submit Decision" }).click();
  await expect(page.getByText("Changes requested", { exact: true })).toBeVisible();
  await expect(page.getByText(/caterer has your note and will follow up with a revised proposal/i)).toBeVisible();

  await page.getByRole("button", { name: /Staff sign in/i }).click();
  const salesWorkflowResources = async () => page.evaluate(() => (
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /SalesWorkflowModal(?:-[^/?]+\.js|\.jsx)/.test(name))
  ));
  expect(await salesWorkflowResources()).toEqual([]);

  const workflowTrigger = page.getByRole("button", {
    name: /Workflow, 1 quote needs attention/i
  });
  await expect(workflowTrigger).toBeVisible();
  expect(await salesWorkflowResources()).toEqual([]);
  await workflowTrigger.click();

  const workflow = page.getByRole("dialog");
  const attentionTab = workflow.getByRole("tab", { name: "Attention (1)" });
  await expect(attentionTab).toHaveAttribute("aria-selected", "true");
  await expect(workflow.locator("#workflow-panel-attention")).toBeVisible();
  await expect(workflow.locator("#workflow-panel-followups")).toBeHidden();
  await expect(workflow.locator("#workflow-panel-approvals")).toBeHidden();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await expect(workflow.getByText(/in-app queue/i)).toBeVisible();
  await expect(workflow.getByText("New customer change request")).toBeVisible();
  await expect(workflow.locator("#workflow-panel-attention").getByText(
    "Please replace the entree with a vegetarian option."
  )).toBeVisible();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const containment = await workflow.locator(".workflow-attention-row").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      };
    });
    expect(containment.left).toBeGreaterThanOrEqual(-1);
    expect(containment.right).toBeLessThanOrEqual(containment.clientWidth + 1);
    expect(containment.scrollWidth).toBeLessThanOrEqual(containment.clientWidth + 1);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  await attentionTab.focus();
  await attentionTab.press("ArrowRight");
  await expect(workflow.getByRole("tab", { name: "Follow-ups" })).toBeFocused();
  await workflow.getByRole("tab", { name: "Follow-ups" }).press("ArrowLeft");
  await expect(attentionTab).toBeFocused();
  await attentionTab.press("End");
  await expect(workflow.getByRole("tab", { name: "Approvals (0)" })).toBeFocused();
  await workflow.getByRole("tab", { name: "Approvals (0)" }).press("Home");
  await expect(attentionTab).toBeFocused();

  const attentionRow = workflow.locator(".workflow-attention-row");
  const quoteLabel = (await attentionRow.getByRole("heading").textContent())?.trim() || "";
  await expect(attentionRow).toHaveAccessibleName(`New customer change request ${quoteLabel}`);
  await expect(workflow.getByLabel(
    `Internal handling note (required to mark handled) — ${quoteLabel}`
  )).toBeVisible();

  await workflow.getByRole("button", { name: `Edit quote — ${quoteLabel}` }).click();
  await expect(workflow).toHaveCount(0);
  await expect(page.locator("main.wizard-grid")).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await page.getByRole("button", { name: /Workflow, 1 quote needs attention/i }).click();
  await expect(workflow.getByRole("tab", { name: "Attention (1)" })).toHaveAttribute("aria-selected", "true");

  await workflow.getByRole("button", { name: `Acknowledge internally — ${quoteLabel}` }).click();
  await expect(workflow.getByText("Acknowledged change request", { exact: true })).toBeVisible();
  await expect(workflow.getByText(/No customer message was sent/i)).toBeVisible();
  await expect(workflow.locator(".workflow-attention-row")).toBeFocused();
  await workflow.getByLabel(`Internal handling note (required to mark handled) — ${quoteLabel}`).fill(
    "Updated the menu selection and prepared the revised proposal."
  );
  await workflow.getByRole("button", { name: `Mark handled internally — ${quoteLabel}` }).click();
  const emptyAttentionHeading = workflow.getByRole("heading", { name: "No workflow attention needed" });
  await expect(emptyAttentionHeading).toBeVisible();
  await expect(emptyAttentionHeading).toBeFocused();

  const storedDecision = await page.evaluate(() => {
    const quote = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]")[0];
    return {
      portalDecision: quote?.portalDecision,
      handling: quote?.workflow?.changeRequestHandling
    };
  });
  expect(storedDecision.portalDecision).toMatchObject({
    decision: "changes_requested",
    message: "Please replace the entree with a vegetarian option."
  });
  expect(storedDecision.portalDecision.requestId).toMatch(/^[a-zA-Z0-9-]{20,80}$/);
  expect(storedDecision.handling).toMatchObject({
    sourceRequestId: storedDecision.portalDecision.requestId,
    state: "handled",
    sourceSubmittedAtISO: storedDecision.portalDecision.submittedAtISO,
    sourceMessage: storedDecision.portalDecision.message,
    note: "Updated the menu selection and prepared the revised proposal."
  });

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Workflow, no quote follow-ups in this view/i })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("portal acceptance requires typed consent and shows the signed revision receipt", async ({ page }) => {
  const eventDate = futureDateISO(80);
  await createQuoteToHistory(page, {
    guests: 96,
    eventName: "E2E Signed Proposal",
    venue: "Signature Hall",
    date: eventDate
  });
  await setQuoteStatus(quoteRows(page).first(), "sent");
  const portalKey = await page.evaluate(() => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    return quotes[0]?.portalKey || "";
  });

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Customer Portal" }).click();
  await page.getByPlaceholder("Paste your quote key").fill(portalKey);
  await page.getByRole("button", { name: "Open Proposal" }).click();

  const decisionGroup = page.getByRole("group", { name: "Proposal decision" });
  const signButton = page.getByRole("button", { name: /Sign and accept proposal/i });
  await expect(page.getByText(
    "Choose the response that matches what you want to do. Nothing is selected or submitted for you.",
    { exact: true }
  )).toBeVisible();
  await expect(signButton).toHaveCount(0);
  await expect(page.getByLabel("Full legal name")).toHaveCount(0);

  await decisionGroup.getByRole("button", { name: /Accept(?: proposal)?/i }).click();
  const signerName = page.getByLabel("Full legal name");
  const signatureConsent = page.getByLabel(
    /consent to use my typed name as my electronic signature/i
  );

  await signButton.click();
  await expect(page.getByText("Enter the signer’s full legal name.", { exact: true })).toBeVisible();
  await expect(signerName).toBeFocused();

  await signerName.fill("E2E Portal Customer");
  await signButton.click();
  await expect(page.getByText(
    "Confirm the electronic-signature statement before accepting.",
    { exact: true }
  )).toBeVisible();
  await expect(signatureConsent).toBeFocused();

  await signatureConsent.check();
  await signButton.click();

  await expect(page.getByText("Thank you—we have your approval", { exact: true })).toBeVisible();
  await expect(page.getByText("Electronic acceptance receipt", { exact: true })).toBeVisible();
  await expect(page.getByText(/Signed by E2E Portal Customer/i)).toBeVisible();
  await expect(page.getByText(/A deposit payment does not by itself confirm the event/i)).toBeVisible();

  const storedReceipt = await page.evaluate((key) => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    const quote = quotes.find((item) => item.portalKey === key);
    return {
      status: quote?.status,
      decision: quote?.portalDecision?.decision,
      receipt: quote?.acceptanceReceipt
    };
  }, portalKey);
  expect(storedReceipt).toMatchObject({
    status: "accepted",
    decision: "accepted",
    receipt: {
      signerName: "E2E Portal Customer",
      consentVersion: "proposal-acceptance-v1",
      currency: "USD"
    }
  });
  expect(storedReceipt.receipt.receiptId).toMatch(/^acceptance-[a-zA-Z0-9-]{20,}$/);
  expect(Number.isInteger(storedReceipt.receipt.totalMinor)).toBe(true);
  expect(Number.isInteger(storedReceipt.receipt.depositMinor)).toBe(true);
  expect(storedReceipt.receipt.quoteRevisionId).toBeTruthy();
});

test("portal refreshes webhook-backed payment state after a Stripe success return", async ({ page }) => {
  const portalKey = "portal-payment-return-12345678901234567890";
  const nowISO = new Date().toISOString();
  const expiresAtISO = "2099-12-31T23:59:59.000Z";
  await page.addInitScript(({ key, createdAtISO, portalExpiryISO }) => {
    const nativeClear = Storage.prototype.clear;
    Storage.prototype.clear = function preservePortalFixture() {
      if (this === localStorage) return;
      return nativeClear.call(this);
    };
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([{
      id: "quote-payment-return",
      quoteNumber: "Q-PAYMENT-RETURN",
      status: "accepted",
      portalKey: key,
      portalIssuedAtISO: createdAtISO,
      portalExpiresAtISO: portalExpiryISO,
      expiresAtISO: portalExpiryISO,
      createdAtISO,
      updatedAtISO: createdAtISO,
      customer: { name: "Payment Return Customer", email: "customer@example.com" },
      event: {
        name: "Payment Return Dinner",
        date: "2026-12-12",
        time: "18:00",
        hours: 4,
        guests: 80,
        venue: "Return Hall",
        style: "Plated"
      },
      totals: { total: 5000, deposit: 1500 },
      selection: {},
      payment: { depositStatus: "unpaid", depositConfirmedAtISO: "" },
      booking: {},
      quoteMeta: {},
      portalDecision: {
        decision: "accepted",
        message: "",
        requestId: "payment-return-request-12345",
        submittedAtISO: createdAtISO
      },
      lifecycle: { acceptedAtISO: createdAtISO }
    }]));
  }, { key: portalKey, createdAtISO: nowISO, portalExpiryISO: expiresAtISO });

  await page.goto(`/app?portal=${encodeURIComponent(portalKey)}&payment=success`);
  await expect(page.getByRole("heading", { name: /Payment Return Dinner on/i })).toBeVisible();
  const paymentReturnStatus = page.locator(".portal-pricing-section [role='status']");
  await expect(paymentReturnStatus).toContainText(/confirming (?:your )?payment securely/i);
  await expect(page).toHaveURL(new RegExp(`portal=${portalKey}$`));
  await expect(page.locator(".portal-payment-state strong")).toHaveText(/awaiting deposit/i);

  await page.evaluate(() => {
    window.setTimeout(() => {
      const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
      quotes[0].payment = {
        ...quotes[0].payment,
        depositStatus: "paid",
        depositConfirmedAtISO: new Date().toISOString()
      };
      localStorage.setItem("quoteWizard.quotes", JSON.stringify(quotes));
    }, 250);
  });

  await expect(page.locator(".portal-payment-state strong")).toHaveText(/paid/i, {
    timeout: 5000
  });
  await expect(paymentReturnStatus).toContainText(/payment confirmed/i);
});

test("valid and expired portal links use tenant branding without exposing token entry", async ({ page }) => {
  const activeKey = "portal-branded-active-12345678901234567890";
  const expiredKey = "portal-branded-expired-1234567890123456";
  const createdAtISO = "2026-08-06T12:00:00.000Z";
  await page.addInitScript(({ activePortalKey, expiredPortalKey, createdAt }) => {
    const nativeClear = Storage.prototype.clear;
    Storage.prototype.clear = function preservePortalFixture() {
      if (this === localStorage) return;
      return nativeClear.call(this);
    };
    const quote = (portalKey, portalExpiresAtISO, id) => ({
      id,
      organizationId: "e2e-org",
      quoteNumber: id === "portal-active" ? "Q-BRAND-ACTIVE" : "Q-BRAND-EXPIRED",
      status: "sent",
      portalKey,
      portalIssuedAtISO: createdAt,
      portalExpiresAtISO,
      expiresAtISO: portalExpiresAtISO,
      createdAtISO: createdAt,
      updatedAtISO: createdAt,
      customer: { name: "Portal Guest", email: "guest@example.com" },
      event: {
        name: "Family Celebration",
        date: "2027-04-18",
        time: "17:30",
        hours: 4,
        guests: 70,
        venue: "Garden Hall",
        style: "family_style"
      },
      totals: {
        total: 4200,
        deposit: 1260,
        serviceFee: 540,
        serviceFeePctApplied: 0.18
      },
      selection: { packageName: "Celebration Menu", menuItemNames: ["Herb Chicken"] },
      payment: { depositStatus: "unpaid", depositLink: "" },
      booking: {},
      quoteMeta: {
        organizationName: "Northstar Events",
        brandName: "Northstar Catering",
        brandLogoUrl: "https://cdn.example.test/northstar-logo.png",
        businessEmail: "events@northstar.test",
        businessPhone: "205-555-0100",
        brandPrimaryColor: "#8d611a",
        brandDarkAccentColor: "#5e3b08"
      },
      lifecycle: { sentAtISO: createdAt }
    });
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([
      quote(activePortalKey, "2099-12-31T23:59:59.000Z", "portal-active"),
      quote(expiredPortalKey, "2020-01-01T00:00:00.000Z", "portal-expired")
    ]));
  }, { activePortalKey: activeKey, expiredPortalKey: expiredKey, createdAt: createdAtISO });

  await page.goto(`/app?portal=${encodeURIComponent(activeKey)}`);
  await expect(page.getByRole("heading", { name: "Your proposal from Northstar Catering" })).toBeVisible();
  await expect(page.getByAltText("Northstar Catering logo")).toBeVisible();
  await expect(page.getByText("Family Style", { exact: true })).toBeVisible();
  await expect(page.getByText("Service charge (18%)", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Quote link key")).toHaveCount(0);
  const firstView = await page.evaluate(() => {
    const quote = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]")
      .find((item) => item.id === "portal-active");
    return { status: quote.status, viewedAtISO: quote.lifecycle?.viewedAtISO };
  });
  expect(firstView.status).toBe("viewed");
  expect(firstView.viewedAtISO).toBeTruthy();
  await page.getByRole("button", { name: "Staff sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Customer Portal" }).click();
  await page.getByLabel("Quote link key").fill(activeKey);
  await page.getByRole("button", { name: "Open Proposal" }).click();
  await expect(page.getByRole("heading", { name: "Your proposal from Northstar Catering" })).toBeVisible();
  expect(await page.evaluate(() => {
    const quote = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]")
      .find((item) => item.id === "portal-active");
    return quote.lifecycle?.viewedAtISO;
  })).toBe(firstView.viewedAtISO);

  await page.goto(`/app?portal=${encodeURIComponent(expiredKey)}`);
  await expect(page.getByRole("heading", { name: "Request a new link" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Email Northstar Catering" })).toHaveAttribute(
    "href",
    /^mailto:events@northstar\.test/
  );
  await expect(page.getByRole("link", { name: /Call 205-555-0100/ })).toHaveAttribute("href", "tel:2055550100");
  await expect(page.getByLabel("Quote link key")).toBeVisible();
  await page.getByRole("button", { name: "Try another key" }).click();
  await expect(page.getByLabel("Quote link key")).toBeFocused();
  await expect(page.getByLabel("Quote link key")).toHaveValue("");
  await page.getByLabel("Quote link key").fill("portal-missing-12345678901234567890");
  await page.getByRole("button", { name: "Open Proposal" }).click();
  await expect(page.getByRole("heading", { name: "Request a new link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try another key" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Email / })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Call / })).toHaveCount(0);
});

test("cancelled payment returns are consumed without changing stored payment evidence", async ({ page }) => {
  const portalKey = "portal-payment-cancelled-123456789012345";
  const createdAtISO = new Date().toISOString();
  await page.addInitScript(({ key, createdAt }) => {
    const nativeClear = Storage.prototype.clear;
    Storage.prototype.clear = function preservePortalFixture() {
      if (this === localStorage) return;
      return nativeClear.call(this);
    };
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([{
      id: "quote-payment-cancelled",
      organizationId: "e2e-org",
      quoteNumber: "Q-PAYMENT-CANCELLED",
      status: "accepted",
      portalKey: key,
      portalIssuedAtISO: createdAt,
      portalExpiresAtISO: "2099-12-31T23:59:59.000Z",
      expiresAtISO: "2099-12-31T23:59:59.000Z",
      createdAtISO: createdAt,
      updatedAtISO: createdAt,
      customer: { name: "Payment Guest", email: "guest@example.com" },
      event: { name: "Payment Dinner", date: "2027-05-12", guests: 50, style: "plated" },
      totals: { total: 3000, deposit: 900 },
      selection: {},
      payment: {
        depositStatus: "unpaid",
        depositLink: "https://checkout.stripe.com/c/pay/cs_test_cancelled"
      },
      booking: {},
      quoteMeta: { organizationName: "Northstar Events" },
      portalDecision: { decision: "accepted", requestId: "cancelled-payment-request-123", submittedAtISO: createdAt },
      lifecycle: { acceptedAtISO: createdAt }
    }]));
  }, { key: portalKey, createdAt: createdAtISO });

  await page.goto(`/app?portal=${encodeURIComponent(portalKey)}&payment=cancelled`);
  await expect(page.getByRole("status")).toContainText(/without a verified payment confirmation/i);
  await expect(page.getByRole("link", { name: "Pay deposit" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`portal=${portalKey}$`));
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]")[0].payment.depositStatus
  ))).toBe("unpaid");
});

test("accepted event production checklist persists completion", async ({ page }) => {
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  await createQuoteToHistory(page, {
    guests: 74,
    eventName: "E2E Production Event",
    venue: "Production Hall",
    date: today
  });

  const row = quoteRows(page).first();
  await setQuoteStatus(row, "sent");
  await setQuoteStatus(row, "accepted");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await openOperationsItem(page, "Event Schedule");

  const schedule = page.getByRole("dialog");
  await expect(schedule.getByText("E2E Production Event", { exact: true })).toBeVisible();
  const eventDetail = schedule.locator("article.schedule-event-card").filter({
    hasText: "E2E Production Event"
  });
  await schedule.getByRole("button", { name: /Focus event details for/i }).click();
  await expect(eventDetail).toBeFocused();
  const eventBrief = schedule.getByLabel("Event brief reviewed");
  await eventBrief.check();
  await expect(schedule.getByText(/Production checklist updated for/i)).toBeVisible();

  await schedule.getByRole("button", { name: "Close" }).click();
  await openOperationsItem(page, "Event Schedule");
  await expect(page.getByRole("dialog").getByLabel("Event brief reviewed")).toBeChecked();
});

test("create then edit keeps one quote row and reflects updated fields", async ({ page }) => {
  await createQuoteToHistory(page, { guests: 70 });

  const quoteRows = page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  });
  await expect(quoteRows).toHaveCount(1);
  await expect(quoteRows.first()).toContainText("70");
  const originalQuoteId = await quoteRows.first().getAttribute("data-quote-id");
  expect(originalQuoteId).toBeTruthy();

  await quoteRows.first().getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText(/Editing quote/i)).toBeVisible();

  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("95");
  await advanceToSaveButton(page, "Save Changes");

  const history = page.getByRole("dialog", { name: "Quotes" });
  const handoff = history.locator(".saved-quote-handoff");
  await expect(handoff).toHaveAttribute("data-quote-id", originalQuoteId);
  await expect(handoff.locator(".eyebrow")).toHaveText("Draft updated");
  await expect(handoff).toContainText(/Changes are saved/i);
  await expect(handoff).toBeFocused();
  await expect(history.locator("tr.history-row-target")).toHaveAttribute("data-quote-id", originalQuoteId);
  await expect(quoteRows).toHaveCount(1);
  await expect(quoteRows.first()).toContainText("95");

  await setQuoteStatus(quoteRows.first(), "sent");
  await expect(handoff.locator(".eyebrow")).toHaveText("Quote sent");
  await expect(handoff).toContainText("Current quote status is sent.");
  await expect(handoff).not.toContainText(/did not send|has not been sent/i);
});

test("Catalog Admin menu browsing never mutates the clean quote being edited", async ({ page }) => {
  await createQuoteToHistory(page, { guests: 70, eventName: "Admin Isolation Quote" });

  const row = quoteRows(page).first();
  await row.getByRole("button", { name: "Edit" }).click();
  const quoteEventType = page.getByLabel(/Event type/i);
  const originalEventType = await quoteEventType.inputValue();
  expect(originalEventType).toBeTruthy();

  await page.getByRole("button", { name: /^Next:/ }).click();
  const selectedMenuIds = await page.locator(".wizard-panel .menu-library input[type='checkbox']:checked")
    .evaluateAll((inputs) => inputs.map((input) => input.value).sort());
  expect(selectedMenuIds.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByRole("button", { name: "Operations" }).click();
  await page.getByRole("menuitem", { name: "Catalog Admin" }).click();
  const catalogAdmin = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Catalog Admin" })
  });
  await catalogAdmin.getByRole("tab", { name: "Menu" }).click();
  const adminEventType = catalogAdmin.getByRole("combobox", { name: "Event type", exact: true });
  await expect.poll(() => adminEventType.locator("option").count()).toBeGreaterThan(2);
  const alternative = await adminEventType.locator("option").evaluateAll((options, current) => (
    options.map((option) => option.value).find((value) => value && value !== current) || ""
  ), originalEventType);
  expect(alternative).toBeTruthy();
  await adminEventType.selectOption(alternative);
  await catalogAdmin.getByRole("button", { name: "Close" }).click();

  await expect(quoteEventType).toHaveValue(originalEventType);
  await page.getByRole("button", { name: /^Next:/ }).click();
  await expect(page.locator(".wizard-panel .menu-library input[type='checkbox']:checked"))
    .toHaveCount(selectedMenuIds.length);
  expect(await page.locator(".wizard-panel .menu-library input[type='checkbox']:checked")
    .evaluateAll((inputs) => inputs.map((input) => input.value).sort())).toEqual(selectedMenuIds);

  await page.evaluate(() => {
    window.__newQuoteConfirmations = [];
    window.confirm = (message) => {
      window.__newQuoteConfirmations.push(String(message));
      return false;
    };
  });
  await page.getByRole("button", { name: "New Quote" }).click();
  expect(await page.evaluate(() => window.__newQuoteConfirmations)).toEqual([]);
});

test("accepted quote can be converted and confirmation lifecycle is trackable", async ({ page }) => {
  await createQuoteToHistory(page, {
    guests: 68,
    eventName: "E2E Booking Lifecycle",
    venue: "Lifecycle Ballroom"
  });

  const row = quoteRows(page).first();
  await expect(row).toBeVisible();

  await setQuoteStatus(row, "sent");
  await setQuoteStatus(row, "accepted");

  await row.getByRole("button", { name: "Convert" }).click();
  await expect(historyDialogMessage(page, /Converted .* to contract/i)).toBeVisible();
  await expect(row.locator("select").first()).toHaveValue("booked");

  const confirmationSelect = row.locator("td").nth(10).locator("select");
  await expect(confirmationSelect).toHaveValue("pending");

  await confirmationSelect.selectOption("sent");
  await expect(confirmationSelect).toHaveValue("sent");
  await expect(historyDialogMessage(page, /Confirmation marked sent/i)).toBeVisible();

  await row.getByRole("button", { name: "Confirm" }).click();
  await expect(confirmationSelect).toHaveValue("confirmed");
  await expect(historyDialogMessage(page, /Confirmation marked confirmed/i)).toBeVisible();
  await expect(row.getByRole("button", { name: "Confirm" })).toHaveCount(0);
});

test("conversion is blocked when another quote is already booked for same venue/date", async ({ page }) => {
  await createQuoteToHistory(page, {
    guests: 75,
    eventName: "E2E Contract Baseline",
    venue: "Conflict Pavilion"
  });

  const baselineRow = quoteRows(page).first();
  await expect(baselineRow).toBeVisible();

  await setQuoteStatus(baselineRow, "sent");
  await setQuoteStatus(baselineRow, "accepted");
  await baselineRow.getByRole("button", { name: "Convert" }).click();
  await expect(historyDialogMessage(page, /Converted .* to contract/i)).toBeVisible();
  await expect(baselineRow.locator("select").first()).toHaveValue("booked");

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "New Quote" }).click();

  await fillRequiredQuoteFields(page, {
    guests: 92,
    eventName: "E2E Contract Conflict",
    venue: "Conflict Pavilion"
  });
  await advanceToSaveButton(page, "Save draft");
  await expect(page.getByText(/Availability conflict: this date\/venue is already booked/i)).toBeVisible();

  const historyHeading = page.getByRole("heading", { name: "Quotes" });
  if (!(await historyHeading.isVisible())) {
    await page.getByRole("button", { name: "Quotes", exact: true }).click();
  }
  await expect(historyHeading).toBeVisible();

  const conflictRows = quoteRows(page);
  await expect(conflictRows).toHaveCount(1);
  await expect(conflictRows.first().locator("select").first()).toHaveValue("booked");
});
