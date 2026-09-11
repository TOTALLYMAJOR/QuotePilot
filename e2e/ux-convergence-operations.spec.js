import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  DEFAULT_ADDONS,
  DEFAULT_EVENT_TEMPLATES,
  DEFAULT_PACKAGES,
  DEFAULT_RENTALS,
  DEFAULT_SETTINGS
} from "../src/data/mockCatalog";

const ENABLED = [
  "VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED",
  "VITE_AMBIENT_UI_ENABLED",
  "VITE_PILOT_NOW_ENABLED",
  "VITE_OPERATIONAL_STAFFING_ENABLED"
]
  .every((name) => ["1", "true", "yes", "on"].includes(
    String(process.env[name] || "").trim().toLowerCase()
  ));

test.skip(!ENABLED, "Calendar-first Operations requires the Ambient workspace graph.");

async function resetViewportScroll(page) {
  await page.evaluate(async () => {
    const reset = () => {
      const scrollableNodes = [document.scrollingElement, document.documentElement, document.body, ...document.querySelectorAll("*")];
      scrollableNodes.forEach((node) => {
        if (!node || typeof node.scrollTo !== "function") return;
        node.scrollTo({ top: 0, left: 0, behavior: "instant" });
      });
    };
    reset();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    reset();
  });
}

const CAPABILITY_GATE_CATALOG = {
  packages: DEFAULT_PACKAGES,
  addons: DEFAULT_ADDONS,
  rentals: DEFAULT_RENTALS,
  settings: {
    ...DEFAULT_SETTINGS,
    catalogRevision: 41,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "operations-gate-admin",
      actorEmail: "operations-gate-admin@example.test",
      confirmedAtISO: "2026-09-04T20:00:00.000Z",
      confirmedCatalogRevision: 41
    },
    menuSections: [],
    eventTemplates: DEFAULT_EVENT_TEMPLATES,
    featureFlags: {
      ...(DEFAULT_SETTINGS.featureFlags || {}),
      eventSchedule: false,
      reportingDashboard: false
    }
  }
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("ux-convergence-operations-seeded") === "true") return;
    localStorage.clear();
    sessionStorage.clear();
    const now = new Date();
    const target = new Date(now);
    target.setDate(now.getDate() + 2);
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    const day = String(target.getDate()).padStart(2, "0");
    const date = `${year}-${month}-${day}`;
    const quote = (id, quoteNumber, time, guests, status = "booked") => ({
      id,
      organizationId: "e2e-org",
      quoteNumber,
      status,
      activeVersionId: "v0001",
      customer: { name: `${quoteNumber} Client`, email: `${id}@example.test` },
      event: {
        name: `${quoteNumber} Dinner`,
        date,
        time,
        hours: 4,
        guests,
        venue: "Operations Hall",
        style: "Buffet",
        servers: 4,
        chefs: 1,
        bartenders: 0
      },
      selection: { packageId: "basic", menuItems: ["salad"] },
      totals: { total: 3200, deposit: 800 },
      booking: {
        confirmationStatus: status === "booked" ? "confirmed" : "pending",
        staffLead: id === "operations-event-a" ? "Event Lead" : ""
      }
    });
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([
      quote("operations-event-a", "Q-OPS-1", "17:00", 260),
      quote("operations-event-b", "Q-OPS-2", "18:00", 220, "accepted")
    ]));
    localStorage.setItem("ux-convergence-operations-seeded", "true");
  });
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 },
  { width: 1487, height: 1058 }
]) {
  test(`renders the same Calendar authority at ${viewport.width}px`, async ({ page }, testInfo) => {
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.goto("/app/operations");

    const operations = page.getByTestId("operations-calendar");
    await expect(operations).toBeVisible();
    await expect(operations).toHaveAttribute("data-operations-mode", "calendar-first");
    await expect(operations.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
    await expect(operations.getByRole("button", { name: "Month", exact: true })).toBeVisible();
    await expect(operations.getByRole("button", { name: "Week", exact: true })).toBeVisible();
    await expect(operations.locator(".schedule-layout")).toHaveAttribute("data-view-mode", "month");
    const eventContext = operations.getByTestId("operations-event-context");
    await expect(eventContext).toHaveAttribute("data-context-placement", "below-calendar");

    if (viewport.width === 390) {
      await expect(operations.getByTestId("operations-mobile-agenda")).toBeVisible();
      await expect(operations.locator(".schedule-desktop-calendar")).toBeHidden();
      await expect(operations.getByTestId("operations-month-calendar")).toBeHidden();
      await operations.locator("[data-exact-event-id='operations-event-a'] button").first().click();
    } else {
      await expect(operations.getByTestId("operations-mobile-agenda")).toBeHidden();
      await expect(operations.locator(".schedule-desktop-calendar")).toBeVisible();
      await expect(operations.getByTestId("operations-month-calendar")).toBeVisible();
      await expect(operations.locator(".schedule-weekday-row span")).toHaveCount(7);
      await operations.locator("button.schedule-day-cell.has-conflict").first().click();
    }

    const focusedEvent = operations.getByTestId("operations-focused-event");
    await expect(focusedEvent).toHaveAttribute("data-exact-event-id", "operations-event-a");
    await expect(operations.getByTestId("operations-conflict-workflow")).toContainText("Q-OPS-2");
    await expect(operations).not.toContainText("Mark as resolved");
    for (const label of ["Run of show", "Production", "Kitchen timing", "Staffing"]) {
      await expect(
        operations.locator("details.schedule-operational-disclosure").filter({ hasText: label }).first()
      ).not.toHaveAttribute("open", "");
    }

    if (viewport.width >= 1400) {
      const monthPanel = operations.locator(".schedule-grid-panel");
      const [monthPanelBox, contextBox] = await Promise.all([
        monthPanel.boundingBox(),
        eventContext.boundingBox()
      ]);
      expect(monthPanelBox).not.toBeNull();
      expect(contextBox).not.toBeNull();
      expect(contextBox.y).toBeGreaterThanOrEqual(monthPanelBox.y + monthPanelBox.height - 1);
      expect(Math.abs(contextBox.x - monthPanelBox.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(contextBox.width - monthPanelBox.width)).toBeLessThanOrEqual(2);
      expect(await eventContext.evaluate((node) => getComputedStyle(node).position)).not.toBe("sticky");
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
      .toBe(true);

    const evidenceSha = String(process.env.UX_EVIDENCE_SHA || "working-tree").slice(0, 12);
    const monthScreenshotPath = testInfo.outputPath(`operations-month-${viewport.width}-${evidenceSha}.png`);
    await page.screenshot({ path: monthScreenshotPath, fullPage: true });
    await testInfo.attach(`Calendar-first Operations Month ${viewport.width}px at ${evidenceSha}`, {
      path: monthScreenshotPath,
      contentType: "image/png"
    });
    if ([390, 1440, 1487].includes(viewport.width)) {
      const monthViewportPath = testInfo.outputPath(`operations-month-${viewport.width}-viewport-${evidenceSha}.png`);
      await resetViewportScroll(page);
      await page.screenshot({ path: monthViewportPath });
      await testInfo.attach(`Calendar-first Operations Month ${viewport.width}px viewport at ${evidenceSha}`, {
        path: monthViewportPath,
        contentType: "image/png"
      });
    }

    await operations.getByRole("button", { name: "Week", exact: true }).click();
    await expect(operations.locator(".schedule-layout")).toHaveAttribute("data-view-mode", "week");
    if (viewport.width === 390) {
      await expect(operations.getByTestId("operations-mobile-agenda")).toBeVisible();
      await expect(operations.getByTestId("operations-week-timeline")).toBeHidden();
    } else {
      const weekTimeline = operations.getByTestId("operations-week-timeline");
      await expect(weekTimeline).toBeVisible();
      await expect(operations.getByTestId("operations-week-time-axis")).toBeVisible();
      await expect(weekTimeline.locator("[data-week-date]")).toHaveCount(7);
      const weekDates = await weekTimeline.locator("[data-week-date]").evaluateAll((nodes) => (
        nodes.map((node) => node.getAttribute("data-week-date"))
      ));
      expect(new Set(weekDates).size).toBe(7);
      expect(weekDates).toEqual([...weekDates].sort());
    }
    if (viewport.width >= 1400) {
      const weekTimeline = operations.getByTestId("operations-week-timeline");
      await expect(eventContext).toHaveAttribute("data-context-placement", "detail-rail");
      const [weekTimelineBox, detailRailBox] = await Promise.all([
        weekTimeline.boundingBox(),
        eventContext.boundingBox()
      ]);
      expect(weekTimelineBox).not.toBeNull();
      expect(detailRailBox).not.toBeNull();
      expect(detailRailBox.x).toBeGreaterThan(weekTimelineBox.x + weekTimelineBox.width);
      expect(await eventContext.evaluate((node) => getComputedStyle(node).position)).toBe("sticky");

      const eventA = weekTimeline.locator('[data-week-event-id="operations-event-a"]');
      const eventB = weekTimeline.locator('[data-week-event-id="operations-event-b"]');
      await expect(eventA).toHaveAttribute("data-start-minute", "1020");
      await expect(eventB).toHaveAttribute("data-start-minute", "1080");
      await expect(eventA).toHaveAttribute("data-duration-minutes", "240");
      await expect(eventB).toHaveAttribute("data-duration-minutes", "240");
      await expect(eventA).toHaveAttribute("data-collision-lane-count", "2");
      await expect(eventB).toHaveAttribute("data-collision-lane-count", "2");
      await expect(eventA).toHaveAttribute("aria-pressed", "true");

      const [laneA, laneB] = await Promise.all([
        eventA.getAttribute("data-collision-lane"),
        eventB.getAttribute("data-collision-lane")
      ]);
      expect(new Set([laneA, laneB]).size).toBe(2);

      const tick17 = operations.locator('[data-time-minute="1020"]');
      const tick18 = operations.locator('[data-time-minute="1080"]');
      const [eventABox, eventBBox, tick17Box, tick18Box] = await Promise.all([
        eventA.boundingBox(),
        eventB.boundingBox(),
        tick17.boundingBox(),
        tick18.boundingBox()
      ]);
      expect(eventABox).not.toBeNull();
      expect(eventBBox).not.toBeNull();
      expect(tick17Box).not.toBeNull();
      expect(tick18Box).not.toBeNull();
      const tick17Y = tick17Box.y + (tick17Box.height / 2);
      const tick18Y = tick18Box.y + (tick18Box.height / 2);
      const hourHeight = tick18Y - tick17Y;
      expect(hourHeight).toBeGreaterThan(0);
      expect(Math.abs(eventABox.y - tick17Y)).toBeLessThanOrEqual(3);
      expect(Math.abs(eventBBox.y - tick18Y)).toBeLessThanOrEqual(3);
      expect(Math.abs(eventABox.height - (hourHeight * 4))).toBeLessThanOrEqual(4);
      expect(Math.abs(eventBBox.height - (hourHeight * 4))).toBeLessThanOrEqual(4);
      expect(Math.abs(eventABox.x - eventBBox.x)).toBeGreaterThan(2);
    }
    await expect(operations.getByTestId("operations-focused-event"))
      .toHaveAttribute("data-exact-event-id", "operations-event-a");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
      .toBe(true);

    const axe = await new AxeBuilder({ page })
      .include("[data-testid='operations-calendar']")
      .analyze();
    expect(axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)))
      .toEqual([]);

    const weekScreenshotPath = testInfo.outputPath(`operations-week-${viewport.width}-${evidenceSha}.png`);
    await page.screenshot({ path: weekScreenshotPath, fullPage: true });
    await testInfo.attach(`Calendar-first Operations Week ${viewport.width}px at ${evidenceSha}`, {
      path: weekScreenshotPath,
      contentType: "image/png"
    });
    if ([390, 1440, 1487].includes(viewport.width)) {
      const weekViewportPath = testInfo.outputPath(`operations-week-${viewport.width}-viewport-${evidenceSha}.png`);
      await resetViewportScroll(page);
      await page.screenshot({ path: weekViewportPath });
      await testInfo.attach(`Calendar-first Operations Week ${viewport.width}px viewport at ${evidenceSha}`, {
        path: weekViewportPath,
        contentType: "image/png"
      });
    }
    expect(consoleErrors).toEqual([]);
  });
}

test("preserves the exact selected event across Month and Week presentation switches", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/operations");

  const operations = page.getByTestId("operations-calendar");
  const context = operations.getByTestId("operations-event-context");
  await operations.locator("button.schedule-day-cell.has-conflict").first().click();
  await expect(context).toHaveAttribute("data-selected-event-id", "operations-event-a");

  await operations.getByRole("button", { name: "Week", exact: true }).click();
  const eventB = operations.locator('[data-week-event-id="operations-event-b"]');
  await expect(operations.locator('[data-week-event-id="operations-event-a"]'))
    .toHaveAttribute("aria-pressed", "true");
  await eventB.click();
  await expect(context).toHaveAttribute("data-selected-event-id", "operations-event-b");
  await expect(eventB).toHaveAttribute("aria-pressed", "true");

  await operations.getByRole("button", { name: "Month", exact: true }).click();
  await expect(context).toHaveAttribute("data-context-placement", "below-calendar");
  await expect(context).toHaveAttribute("data-selected-event-id", "operations-event-b");
  await expect(operations.getByTestId("operations-focused-event"))
    .toHaveAttribute("data-exact-event-id", "operations-event-b");

  await operations.getByRole("button", { name: "Week", exact: true }).click();
  await expect(context).toHaveAttribute("data-context-placement", "detail-rail");
  await expect(context).toHaveAttribute("data-selected-event-id", "operations-event-b");
  await expect(operations.locator('[data-week-event-id="operations-event-b"]'))
    .toHaveAttribute("aria-pressed", "true");
});

test("honors Calendar and Reporting capability gates across navigation and direct routes", async ({ page }) => {
  await page.addInitScript((catalog) => {
    if (localStorage.getItem("operations-capability-gates-seeded") === "true") return;
    localStorage.setItem("quoteWizard.catalog", JSON.stringify(catalog));
    localStorage.setItem("quoteWizard.catalog.e2e-org", JSON.stringify(catalog));
    localStorage.setItem("operations-capability-gates-seeded", "true");
    sessionStorage.setItem("quotepilot:skipCatalogSetup:e2e-org", "1");
  }, CAPABILITY_GATE_CATALOG);

  await page.goto("/app");
  const primaryNavigation = page.getByRole("navigation", { name: "Primary workspace" });
  await expect(primaryNavigation).toBeVisible();
  await expect(primaryNavigation.getByRole("link", { name: "Operations", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open in Calendar", exact: true })).toHaveCount(0);

  await page.goto("/app/quotes/operations-event-a");
  await expect(page.locator(".ambient-living-opportunity")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Calendar", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open in Calendar", exact: true })).toHaveCount(0);

  await page.goto("/app/events");
  const eventsWorkspace = page.locator(".live-ops-route");
  await expect(eventsWorkspace.getByRole("heading", { name: "Accepted and booked events", exact: true })).toBeVisible();
  await expect(eventsWorkspace.getByRole("button", { name: "Operations", exact: true })).toHaveCount(0);

  await page.goto("/app/operations");
  await expect(page.getByTestId("operations-calendar")).toHaveCount(0);
  await page.goto("/app/schedule");
  await expect(page.locator("#event-schedule-title")).toHaveCount(0);

  await page.evaluate(() => {
    const key = "quoteWizard.catalog.e2e-org";
    const catalog = JSON.parse(localStorage.getItem(key) || "{}");
    catalog.settings.featureFlags.eventSchedule = true;
    catalog.settings.featureFlags.reportingDashboard = false;
    localStorage.setItem(key, JSON.stringify(catalog));
  });
  await page.goto("/app/operations");
  const operations = page.getByTestId("operations-calendar");
  await expect(operations).toBeVisible();
  await operations.getByTestId("operations-tools").getByText("Tools", { exact: true }).click();
  await expect(operations.getByRole("button", { name: "Reporting", exact: true })).toHaveCount(0);
});

test("preserves exact Now to Calendar and Calendar to Opportunity handoffs", async ({ page }) => {
  await page.goto("/app");
  const calendarHandoff = page.getByRole("button", { name: "Open Q-OPS-1 Dinner in Calendar", exact: true });
  await expect(calendarHandoff).toBeVisible();
  await calendarHandoff.click();

  await expect(page).toHaveURL(/\/app\/operations$/);
  const operations = page.getByTestId("operations-calendar");
  const exactEvent = operations.getByTestId("operations-focused-event").filter({ hasText: "Q-OPS-1" });
  await expect(exactEvent).toBeVisible();
  await expect(exactEvent).toBeFocused();
  await exactEvent.getByRole("button", { name: "Open opportunity", exact: true }).click();

  await expect(page).toHaveURL(/\/app\/quotes\/operations-event-a$/);
  await expect(page.getByRole("heading", { name: /Q-OPS-1 Dinner/ })).toBeVisible();
});

test("keeps daily Operations concise and preserves secondary tool reachability", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/operations");

  const primary = page.getByRole("navigation", { name: "Primary workspace" });
  await expect(primary.getByRole("link")).toHaveText([
    "Now",
    "Opportunities",
    "Operations",
    "Clients",
    "Library"
  ]);
  const primaryOperations = primary.getByRole("link", { name: "Operations", exact: true });
  await expect(primaryOperations).toHaveAttribute("aria-current", "page");
  await expect(primaryOperations).not.toHaveAttribute("aria-haspopup", "menu");

  const header = page.locator("header.site-header");
  await expect(header.getByRole("button", { name: "Operations", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "Operations", exact: true })).toHaveCount(0);

  await header.getByRole("button", { name: "Workspace and tools", exact: true }).click();
  const tools = page.getByRole("dialog", { name: "Workspace & tools", exact: true });
  const frequent = tools.locator('[data-workspace-tools-group="frequent"]');
  const daily = tools.locator('[data-workspace-tools-group="operations"]');
  await expect(frequent.getByRole("button")).toHaveText([
    "Search customers and opportunities",
    "Workflow",
    "Messages",
    "Pilot"
  ]);
  await expect(daily.getByRole("button")).toHaveText(["Operations", "Clear the Deck", "Staff"]);
  const administrationToggle = tools.getByRole("button", { name: "Show administration tools", exact: true });
  await expect(administrationToggle).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await administrationToggle.click();
  await expect(tools.locator("#workspace-tools-administration-actions").getByRole("button")).toHaveText([
    "Reporting Dashboard",
    "Integrations Ops",
    "Import Studio",
    "Session Diagnostics"
  ]);
});

test("shows conflict evidence and persists staffing and checklist work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/operations");

  const operations = page.getByTestId("operations-calendar");
  await operations.locator('[data-exact-event-id="operations-event-a"] button').first().click();
  const event = operations.locator('[data-schedule-event-id="operations-event-a"]');
  await expect(event).toBeVisible();
  await expect(operations.getByTestId("operations-conflict-workflow")).toContainText("Time overlap");
  await expect(operations.getByTestId("operations-conflict-workflow")).toContainText("Capacity risk");
  const comparisonDisclosure = operations.locator("details.schedule-conflict-comparison-disclosure");
  await expect(comparisonDisclosure).not.toHaveAttribute("open", "");
  await comparisonDisclosure.getByText("Compare event records", { exact: true }).click();
  await expect(comparisonDisclosure).toHaveAttribute("open", "");
  await expect(comparisonDisclosure).toContainText("Current event");
  await expect(comparisonDisclosure).toContainText("Compare with");

  const staffingSummary = operations.locator(".schedule-operational-disclosures > details > summary")
    .filter({ hasText: /^Staffing/ });
  await staffingSummary.click();
  const staffing = staffingSummary.locator("..");
  await staffing.getByLabel("Staff lead").selectOption("Kitchen Lead");
  await expect(operations.getByText("Assigned Kitchen Lead.", { exact: true })).toBeVisible();
  const productionSummary = operations.locator(".schedule-operational-disclosures > details > summary")
    .filter({ hasText: /^Production/ });
  await productionSummary.click();
  const production = productionSummary.locator("..");
  await production.getByRole("checkbox", { name: /^Event brief reviewed/ }).check();
  await expect(operations.getByText(/Production checklist updated for Q-OPS-1/)).toBeVisible();
  await expect(production.getByRole("checkbox", { name: /^Event brief reviewed/ })).toBeChecked();

  const stored = await page.evaluate(() => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    const quote = quotes.find((item) => item.id === "operations-event-a");
    return {
      staffLead: quote?.booking?.staffLead || "",
      eventBriefCompleted: quote?.booking?.productionChecklist?.find((item) => item.id === "event-brief")?.completed === true
    };
  });
  expect(stored).toEqual({ staffLead: "Kitchen Lead", eventBriefCompleted: true });

  await page.reload();
  await operations.locator('[data-exact-event-id="operations-event-a"] button').first().click();
  const reloadedStaffingSummary = operations.locator(".schedule-operational-disclosures > details > summary")
    .filter({ hasText: /^Staffing/ });
  await reloadedStaffingSummary.click();
  const reloadedStaffing = reloadedStaffingSummary.locator("..");
  await expect(reloadedStaffing.getByLabel("Staff lead")).toHaveValue("Kitchen Lead");
  const reloadedProductionSummary = operations.locator(".schedule-operational-disclosures > details > summary")
    .filter({ hasText: /^Production/ });
  await reloadedProductionSummary.click();
  const reloadedProduction = reloadedProductionSummary.locator("..");
  await expect(reloadedProduction.getByRole("checkbox", { name: /^Event brief reviewed/ })).toBeChecked();
});

test("preserves exact direct Event Focus and browser history continuity", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/events/operations-event-a");
  const eventFocus = page.locator(".live-ops-panel");
  await expect(eventFocus.locator(".eyebrow").filter({ hasText: /^Event Focus$/ })).toBeVisible();
  await expect(eventFocus.getByRole("heading", { name: "Q-OPS-1 Dinner", exact: true })).toBeVisible();
  await expect(eventFocus.getByRole("region", { name: "Event basics", exact: true })).toBeVisible();

  await page.goto("/app/operations");
  const operations = page.getByTestId("operations-calendar");
  const targetDay = operations.getByTestId("operations-mobile-agenda")
    .locator('[data-exact-event-id="operations-event-a"]')
    .getByRole("button");
  await targetDay.click();
  const event = operations.locator('[data-schedule-event-id="operations-event-a"]');
  await event.getByRole("button", { name: "Open opportunity", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/quotes\/operations-event-a$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/app\/operations$/);
  await expect(page.getByTestId("operations-calendar")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/quotes\/operations-event-a$/);
  await expect(page.getByRole("heading", { name: /Q-OPS-1 Dinner/ })).toBeVisible();
});

test("keeps the Schedule compatibility route on the same Calendar capability", async ({ page }) => {
  await page.goto("/app/schedule");
  await expect(page.getByRole("region", { name: "Event Schedule" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event Schedule", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Month", exact: true })).toBeVisible();
});

test("promotes Operations into the five primary destinations without a duplicate menu", async ({ page }) => {
  await page.goto("/app/operations");
  const primary = page.getByRole("navigation", { name: "Primary workspace" });
  await expect(primary.getByRole("link")).toHaveCount(5);
  await expect(primary.getByRole("link").allTextContents()).resolves.toEqual([
    "Now",
    "Opportunities",
    "Operations",
    "Clients",
    "Library"
  ]);
  await expect(primary.getByRole("link", { name: "Operations", exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("menu", { name: "Operations", exact: true })).toHaveCount(0);
});
