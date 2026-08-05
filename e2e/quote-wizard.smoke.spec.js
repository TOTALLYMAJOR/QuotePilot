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
  if (await eventType.count()) {
    const optionCount = await eventType.locator("option").count();
    if (optionCount > 1) {
      await eventType.selectOption({ index: 1 });
    }
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

    const nextButton = page.getByRole("button", { name: "Next" });
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
  const history = page.getByRole("dialog", { name: "Quote History" });
  const handoff = history.locator(".saved-quote-handoff");
  await expect(handoff).toContainText(/Saved as a draft/i);
  await expect(handoff).toBeFocused();
  const historyHeading = history.getByRole("heading", { name: "Quote History" });
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "New Quote" })).toBeVisible();
});

test("operator workspaces load only when first opened and stay mounted after close", async ({ page }) => {
  const modalResourceNames = async () => page.evaluate(() => (
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /(?:AdminCatalog|ImportStudio|QuoteHistory|SalesWorkflow|EventSchedule|IntegrationOps|Diagnostics|QuoteCompare|ReportingDashboard)Modal(?:-[^/?]+\.js|\.jsx)/.test(name))
  ));

  expect(await modalResourceNames()).toEqual([]);

  await page.getByRole("button", { name: "Sales Workflow" }).click();
  await expect(page.getByRole("heading", { name: "Sales Workflow" })).toBeVisible();
  await expect.poll(modalResourceNames).toEqual([
    expect.stringMatching(/SalesWorkflowModal(?:-[^/?]+\.js|\.jsx)/)
  ]);

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Sales Workflow" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sales Workflow" }).click();
  await expect(page.getByRole("heading", { name: "Sales Workflow" })).toBeVisible();
  expect(await modalResourceNames()).toHaveLength(1);
});

test("workflow attention throttles passive reads and retains a known count on refresh failure", async ({ page }) => {
  const emptyTrigger = page.getByRole("button", {
    name: /Sales Workflow, no quotes need attention/i
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
    name: /Sales Workflow, 1 quote needs attention/i
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
    name: /Sales Workflow, 1 quote needs attention/i
  })).toBeVisible();
});

test("step 1 next stays actionable and explains missing required fields", async ({ page }) => {
  const nextButton = page.getByRole("button", { name: "Next" });
  await expect(nextButton).toBeEnabled();
  await expect(page.getByText(/Missing required fields/i)).toBeVisible();

  await nextButton.click();
  await expect(page.getByText(/Complete required fields before continuing/i)).toBeVisible();
  await expect(page.locator("[aria-invalid='true']").first()).toBeFocused();
  await expect(page.locator(".stepper-item[aria-current='step']")).toContainText("Event Basics");

  await fillRequiredQuoteFields(page, { guests: 58, eventName: "E2E Soft Lock", venue: "Guidance Hall" });
  await expect(page.getByText(/Missing required fields/i)).toHaveCount(0);
  await nextButton.click();
  await expect(page.getByText(/Customized Cuisine Menu/i)).toBeVisible();
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
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Customized Cuisine Menu")).toBeVisible();

  await page.getByRole("button", { name: "New Quote" }).click();
  await expect(page.getByText("Core Event Basics")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
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
  await page.getByRole("button", { name: "Next" }).click();

  await expect(mobileSummary).toBeVisible();
  await expect(mobileSummary).toBeInViewport();
  const initialTotal = parseMoney(await mobileTotal.innerText());
  const initialLiveStatus = await liveStatus.innerText();

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("110");
  await page.getByRole("button", { name: "Next" }).click();
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
    await page.getByRole("button", { name: "Next" }).click();
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
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Compare Scenario" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Good", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Better", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Best", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Compare Best" }).click();
  await dialog.getByRole("button", { name: "Use Best" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByLabel("Package tier")).toHaveValue("deluxe");
});

test("draft save handoff targets the exact new quote and stays truthful across saves", async ({ page }) => {
  await fillRequiredQuoteFields(page, { guests: 60, eventName: "E2E Quote A", venue: "Hall A" });
  await page.getByRole("button", { name: "Next" }).click();

  const totalLocator = page.locator(".breakdown-panel [data-row-key='total'] dd strong");
  await page.waitForTimeout(700);
  const beforeTotal = parseMoney(await totalLocator.innerText());

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("110");
  await page.getByRole("button", { name: "Next" }).click();

  await page.waitForTimeout(700);
  const afterTotal = parseMoney(await totalLocator.innerText());
  expect(afterTotal).toBeGreaterThan(beforeTotal);

  await advanceToSaveButton(page, "Save draft");

  const history = page.getByRole("dialog", { name: "Quote History" });
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

  const secondHandoff = page.getByRole("dialog", { name: "Quote History" }).locator(".saved-quote-handoff");
  await expect(secondHandoff).toBeFocused();
  const secondQuoteId = await secondHandoff.getAttribute("data-quote-id");
  expect(secondQuoteId).toBeTruthy();
  expect(secondQuoteId).not.toBe(firstQuoteId);
  const secondTargetRow = page.getByRole("dialog", { name: "Quote History" })
    .locator("tr.history-row-target");
  await expect(secondTargetRow).toHaveAttribute("data-quote-id", secondQuoteId);
  await expect(secondTargetRow).toContainText("61");

  const customerSearch = page.getByRole("dialog", { name: "Quote History" })
    .getByPlaceholder("Search customer name");
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
  const history = page.getByRole("dialog", { name: "Quote History" });
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

  await page.getByRole("button", { name: "Quote History" }).click();
  const row = page.locator(`tr[data-quote-id="${quoteId}"]`);
  await expect(row).toContainText("Delivery in progress");
  for (const control of await row.locator("select").all()) {
    await expect(control).toBeDisabled();
  }
  for (const name of ["Edit", "Rotate Portal", "Create Stripe Link", "Delete"]) {
    await expect(row.getByRole("button", { name })).toBeDisabled();
  }
  await expect(row.getByRole("button", { name: "Duplicate" })).toBeEnabled();
  await expect(row.getByRole("button", { name: "PDF" })).toBeEnabled();
  await expect(row.getByRole("button", { name: "Copy Email" })).toBeEnabled();
});

test("quote history supports export and safely blocks an unconfigured payment link", async ({ page }) => {
  await createQuoteToHistory(page, { guests: 84 });

  const firstQuoteRow = page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  }).first();
  await expect(firstQuoteRow).toBeVisible();

  await firstQuoteRow.getByRole("button", { name: "Copy Email" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(/Email template copied/i);
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(/remains a draft/i);
  await expect(firstQuoteRow.getByRole("combobox").first()).toHaveValue("draft");
  await expect(firstQuoteRow.getByRole("button", { name: "Copy Portal" })).toBeDisabled();

  const downloadPromise = page.waitForEvent("download");
  await firstQuoteRow.getByRole("button", { name: "PDF" }).click();
  const pdfDownload = await downloadPromise;
  expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/i);

  await firstQuoteRow.getByRole("button", { name: "Copy Pay Link" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/No approved Stripe deposit link/i);
});

test("sales workflow persists a follow-up plan", async ({ page }) => {
  const dueDate = futureDateISO(10);
  await createQuoteToHistory(page, {
    guests: 78,
    eventName: "E2E Follow-up Dinner",
    venue: "Follow-up Hall"
  });
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Sales Workflow" }).click();

  const workflow = page.getByRole("dialog");
  await expect(workflow.getByRole("heading", { name: "Sales Workflow" })).toBeVisible();
  await workflow.getByLabel("Due date").fill(dueDate);
  await workflow.getByLabel("Note").fill("Confirm final menu after tasting.");
  await workflow.getByRole("button", { name: "Save Follow-up" }).click();
  await expect(workflow.getByText(/Follow-up saved for/i)).toBeVisible();

  const quoteLabel = (await workflow.locator(".workflow-detail-head .eyebrow").textContent())?.trim() || "";
  await workflow.getByRole("button", { name: "Request", exact: true }).click();
  await expect(workflow.getByText(/Send payment request approval requested/i)).toBeVisible();
  await workflow.getByRole("tab", { name: "Attention (1)" }).click();
  await workflow.getByRole("button", { name: `Review approvals for ${quoteLabel}` }).click();
  const pendingApproval = workflow.locator(".approval-row[data-pending='true']");
  await expect(pendingApproval).toBeFocused();
  await workflow.getByLabel(`Resolution note for Send payment request on ${quoteLabel}`).fill(
    "Approved for the test workflow."
  );
  await workflow.getByRole("button", {
    name: `Approve Send payment request for ${quoteLabel}`
  }).click();
  await expect(pendingApproval).toHaveCount(0);
  const resolvedApproval = workflow.locator(".approval-row[data-pending='false']");
  await expect(resolvedApproval).toBeFocused();

  await workflow.getByRole("button", { name: "Open Quote History" }).click();
  const history = page.getByRole("dialog", { name: "Quote History" });
  await expect(history.locator(".history-card")).toBeFocused();
  await history.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Quote History" })).toBeFocused();
  await page.getByRole("button", { name: "Sales Workflow" }).click();
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
    name: /Sales Workflow, no quotes need attention/i
  })).toBeVisible();
  await page.getByRole("button", { name: "Customer Portal" }).click();
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
  await expect(page.getByText(/current proposal remains unaccepted/i)).toBeVisible();

  await page.getByRole("button", { name: "Staff Sign In" }).click();
  const salesWorkflowResources = async () => page.evaluate(() => (
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /SalesWorkflowModal(?:-[^/?]+\.js|\.jsx)/.test(name))
  ));
  expect(await salesWorkflowResources()).toEqual([]);

  const workflowTrigger = page.getByRole("button", {
    name: /Sales Workflow, 1 quote needs attention/i
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
  await page.getByRole("button", { name: /Sales Workflow, 1 quote needs attention/i }).click();
  await expect(workflow.getByRole("tab", { name: "Attention (1)" })).toHaveAttribute("aria-selected", "true");

  await workflow.getByRole("button", { name: `Acknowledge internally — ${quoteLabel}` }).click();
  await expect(workflow.getByText("Acknowledged change request")).toBeVisible();
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
  await expect(page.getByRole("button", { name: /Sales Workflow, no quotes need attention/i })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("portal refreshes webhook-backed payment state after a Stripe success return", async ({ page }) => {
  const portalKey = "portal-payment-return-12345678901234567890";
  const nowISO = new Date().toISOString();
  const expiresAtISO = "2099-12-31T23:59:59.000Z";
  await page.goto(`/app?portal=${encodeURIComponent(portalKey)}&payment=success`);
  await expect(page.getByRole("heading", { name: "Your proposal" })).toBeVisible();
  await page.evaluate(({ key, createdAtISO, portalExpiryISO }) => {
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

  await page.getByRole("button", { name: "Open Proposal" }).click();
  await expect(page.getByRole("heading", { name: /Payment Return Dinner on/i })).toBeVisible();
  const paymentReturnStatus = page.locator(".portal-pricing-section [role='status']");
  await expect(paymentReturnStatus).toContainText(/confirming payment securely/i);
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
  await page.getByRole("button", { name: "Schedule" }).click();

  const schedule = page.getByRole("dialog");
  await expect(schedule.getByText("E2E Production Event")).toBeVisible();
  const eventBrief = schedule.getByLabel("Event brief reviewed");
  await eventBrief.check();
  await expect(schedule.getByText(/Production checklist updated for/i)).toBeVisible();

  await schedule.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Schedule" }).click();
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

  const history = page.getByRole("dialog", { name: "Quote History" });
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

  const historyHeading = page.getByRole("heading", { name: "Quote History" });
  if (!(await historyHeading.isVisible())) {
    await page.getByRole("button", { name: "Quote History" }).click();
  }
  await expect(historyHeading).toBeVisible();

  const conflictRows = quoteRows(page);
  await expect(conflictRows).toHaveCount(1);
  await expect(conflictRows.first().locator("select").first()).toHaveValue("booked");
});
