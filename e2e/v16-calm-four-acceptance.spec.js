import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_GATES = [
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED,
  process.env.VITE_AMBIENT_UI_ENABLED,
  process.env.VITE_PILOT_NOW_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(
  String(value || "").trim().toLowerCase()
));

const ORGANIZATION_ID = "e2e-org";
const RIVERA_QUOTE_ID = "rivera-wedding";
const RIVERA_CLIENT_ID = "client-rivera";
const QUOTES_KEY = "quoteWizard.quotes";
const HISTORY_KEY = "quoteWizard.quoteHistory";
const OPPORTUNITY_PATH = `/app/quotes/${RIVERA_QUOTE_ID}`;
const CAPTURE_V16_BROWSER_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_V16_BROWSER_PROOF || "").trim().toLowerCase()
);
const V16_BROWSER_PROOF_DIR = resolve(
  process.cwd(),
  "output/playwright/v16-calm-four-current"
);

const RIVERA_QUOTE = Object.freeze({
  id: RIVERA_QUOTE_ID,
  organizationId: ORGANIZATION_ID,
  customerId: RIVERA_CLIENT_ID,
  quoteNumber: "QP-RIVERA-250",
  status: "draft",
  activeVersionId: "v0003",
  latestVersionNumber: 3,
  createdAtISO: "2026-08-01T14:00:00.000Z",
  updatedAtISO: "2026-08-20T15:30:00.000Z",
  expiresAtISO: "2099-12-31T00:00:00.000Z",
  customer: {
    name: "Avery & Jordan Rivera",
    email: "rivera@example.test",
    phone: "205-555-0250",
    organization: "Rivera Family"
  },
  event: {
    name: "Rivera Wedding",
    date: "2026-09-12",
    time: "17:30",
    hours: 5,
    venue: "The Glass House",
    venueAddress: "250 Garden Lane",
    style: "Plated",
    guests: 96,
    servers: 6,
    chefs: 2,
    bartenders: 1
  },
  selection: {
    eventTypeId: "wedding",
    packageId: "premium",
    packageName: "Premium",
    menuItems: ["wedding__meats__roasted-chicken"],
    menuItemNames: ["Roasted Chicken"],
    addons: [],
    rentals: [],
    eventTemplateId: "custom"
  },
  totals: {
    base: 2304,
    addons: 0,
    rentals: 0,
    menu: 0,
    serverLabor: 750,
    chefLabor: 300,
    bartenderLabor: 175,
    labor: 1225,
    travel: 0,
    serviceFee: 705.8,
    tax: 423.48,
    total: 4658.28,
    deposit: 1397.48,
    serviceFeePctApplied: 0.2,
    taxRateApplied: 0.1
  },
  booking: { confirmationStatus: "pending" },
  payment: { depositStatus: "unpaid", finalBalance: { status: "unpaid" } },
  lifecycle: { draftAtISO: "2026-08-01T14:00:00.000Z" }
});

const AUTUMN_QUOTE = Object.freeze({
  ...RIVERA_QUOTE,
  id: "autumn-benefit",
  customerId: "client-bennett",
  quoteNumber: "QP-AUTUMN-410",
  activeVersionId: "v0002",
  latestVersionNumber: 2,
  createdAtISO: "2026-08-04T14:00:00.000Z",
  updatedAtISO: "2026-08-21T13:00:00.000Z",
  customer: {
    name: "Maya Bennett",
    email: "maya@example.test",
    phone: "205-555-0184",
    organization: "Bennett Foundation"
  },
  event: {
    ...RIVERA_QUOTE.event,
    name: "Autumn Benefit Dinner",
    date: "2026-10-19",
    time: "18:00",
    venue: "The Foundry Hall",
    venueAddress: "200 Foundry Way",
    style: "Buffet",
    guests: 120,
    servers: 8,
    chefs: 3,
    bartenders: 0
  }
});

const CLOSED_QUOTE = Object.freeze({
  ...RIVERA_QUOTE,
  id: "spring-gala-closed",
  customerId: "client-chen",
  quoteNumber: "QP-SPRING-104",
  status: "declined",
  activeVersionId: "v0005",
  latestVersionNumber: 5,
  createdAtISO: "2026-04-01T14:00:00.000Z",
  updatedAtISO: "2026-08-22T13:00:00.000Z",
  customer: {
    name: "Lena Chen",
    email: "lena@example.test",
    phone: "205-555-0138"
  },
  event: {
    ...RIVERA_QUOTE.event,
    name: "Spring Gala",
    date: "2026-05-02",
    venue: "Museum Court"
  },
  lifecycle: {
    draftAtISO: "2026-04-01T14:00:00.000Z",
    declinedAtISO: "2026-08-22T13:00:00.000Z"
  }
});

// Intentionally not presentation ordered. The product projection must order
// from attention/current-work state and recorded dates, never fixture position.
const QUOTE_FIXTURES = Object.freeze([
  AUTUMN_QUOTE,
  RIVERA_QUOTE,
  CLOSED_QUOTE
]);

function dateOnlyDaysFromNow(days, now = new Date()) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildNowEvidenceFixtures(now = new Date()) {
  const overdueFollowUpDate = dateOnlyDaysFromNow(-1, now);
  const riveraEventDate = dateOnlyDaysFromNow(13, now);
  const autumnEventDate = dateOnlyDaysFromNow(5, now);

  return QUOTE_FIXTURES.map((quote) => {
    if (quote.id === RIVERA_QUOTE_ID) {
      return {
        ...quote,
        event: { ...quote.event, date: riveraEventDate },
        workflow: {
          ...(quote.workflow || {}),
          followUp: {
            completed: false,
            dueDate: overdueFollowUpDate,
            note: "Review final count with Avery and Jordan.",
            stage: "proposal_sent"
          }
        }
      };
    }
    if (quote.id === AUTUMN_QUOTE.id) {
      return {
        ...quote,
        status: "accepted",
        event: { ...quote.event, date: autumnEventDate }
      };
    }
    return quote;
  });
}

function addEvidenceAnnotation(type, description) {
  test.info().annotations.push({ type, description });
}

async function seedWorkspace(page, quotes = QUOTE_FIXTURES) {
  await page.addInitScript(({ quoteFixtures, quotesKey, historyKey }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem(quotesKey, JSON.stringify(quoteFixtures));
    localStorage.setItem(historyKey, JSON.stringify([]));
  }, {
    quoteFixtures: quotes,
    quotesKey: QUOTES_KEY,
    historyKey: HISTORY_KEY
  });
}

async function gotoWorkspace(page, path) {
  await page.goto(path);
  const setupHeading = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  const workspaceHeader = page.locator(".site-header");
  await expect(setupHeading.or(workspaceHeader)).toBeVisible({ timeout: 30_000 });
  if (await setupHeading.isVisible()) {
    await page.getByRole("button", { name: "Explore the workspace" }).click();
    await expect(workspaceHeader).toBeVisible({ timeout: 30_000 });
  }
}

async function gotoRiveraOpportunity(page) {
  await gotoWorkspace(page, OPPORTUNITY_PATH);
  const opportunity = page.locator(
    `[data-quote-id="${RIVERA_QUOTE_ID}"].ambient-living-opportunity`
  );
  await expect(opportunity).toBeVisible({ timeout: 30_000 });
  await expect(opportunity.getByRole("heading", { name: "Rivera Wedding" }).first()).toBeVisible();
  return opportunity;
}

async function openQuickUpdates(page) {
  const trigger = page.locator(
    'button[data-ambient-action-id="open-quick-updates"]:visible'
  );
  await expect(trigger).toHaveCount(1);
  await trigger.click();
  const panel = page.locator('[data-testid="quick-updates-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-quick-updates-phase", "clean");
  await expect(panel.getByRole("dialog")).toBeVisible();
  return { panel, trigger };
}

async function makeQuickUpdatesDirty(page) {
  const opened = await openQuickUpdates(page);
  const style = opened.panel.getByRole("combobox", { name: "Service style" });
  await expect(style).toHaveValue("Plated");
  await style.selectOption("Buffet");
  await expect(opened.panel).toHaveAttribute("data-quick-updates-phase", "dirty");
  await expect(opened.panel.getByText("1 unsaved change", { exact: true })).toBeVisible();
  await expect(opened.panel.getByRole("button", { name: "Review menu change" })).toBeEnabled();
  return { ...opened, style };
}

async function readLocalState(page, quoteId = RIVERA_QUOTE_ID) {
  return page.evaluate(({ id, quotesKey, historyKey }) => {
    const quotes = JSON.parse(localStorage.getItem(quotesKey) || "[]");
    const history = JSON.parse(localStorage.getItem(historyKey) || "[]");
    return {
      quote: quotes.find((item) => item.id === id) || null,
      quotes,
      history: history.filter((item) => item.quoteId === id)
    };
  }, { id: quoteId, quotesKey: QUOTES_KEY, historyKey: HISTORY_KEY });
}

async function expectGuard(page, attempt) {
  await attempt();
  const guard = page.getByRole("alertdialog", { name: "Discard unsaved Quick Updates?" });
  await expect(guard).toBeVisible();
  await expect(guard.getByRole("button", { name: "Keep editing" })).toBeFocused();
  return guard;
}

async function expectNoHorizontalOverflow(page, selector = "html") {
  const overflow = await page.locator(selector).evaluate((element) => (
    element.scrollWidth - element.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectQuickUpdatesLauncherLayout(page, { persistent }) {
  const opportunity = page.locator(
    `[data-quote-id="${RIVERA_QUOTE_ID}"].ambient-living-opportunity`
  );
  const contextBar = opportunity.getByRole("region", {
    name: "Rivera Wedding opportunity actions"
  });
  const contextTrigger = contextBar.locator(
    '[data-ambient-action-id="open-quick-updates"]'
  );
  const mobileTrigger = opportunity.locator(
    '.ambient-mobile-remote [data-ambient-action-id="open-quick-updates"]'
  );
  const visibleTriggers = opportunity.locator(
    'button[data-ambient-action-id="open-quick-updates"]:visible'
  );

  await expect(contextBar).toHaveAttribute("data-testid", "quick-updates-context-bar");
  await expect(opportunity.locator(
    '.ambient-title-line [data-ambient-action-id="open-quick-updates"]'
  )).toHaveCount(0);
  await expect(visibleTriggers).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  if (!persistent) {
    await expect(contextBar).toHaveCSS("position", "static");
    await expect(contextTrigger).toBeHidden();
    await expect(mobileTrigger).toBeVisible();
    await expect(mobileTrigger).toHaveCSS("position", "static");

    const mobileBox = await mobileTrigger.boundingBox();
    const bottomNavigationBox = await page.locator(
      ".ambient-primary-navigation"
    ).boundingBox();
    expect(mobileBox).not.toBeNull();
    expect(bottomNavigationBox).not.toBeNull();
    expect(mobileBox.y + mobileBox.height).toBeLessThanOrEqual(bottomNavigationBox.y - 8);
    return { contextBar, trigger: mobileTrigger };
  }

  await expect(contextBar).toHaveCSS("position", "sticky");
  await expect(contextTrigger).toBeVisible();
  await expect(mobileTrigger).toBeHidden();

  const scrollRange = await page.evaluate(() => (
    document.documentElement.scrollHeight - window.innerHeight
  ));
  expect(scrollRange).toBeGreaterThan(500);
  const firstScrollTop = Math.min(700, scrollRange - 240);
  await page.evaluate((top) => window.scrollTo({ top, left: 0, behavior: "instant" }), firstScrollTop);
  await expect.poll(async () => Math.round(await page.evaluate(() => window.scrollY)))
    .toBe(Math.round(firstScrollTop));

  const firstBox = await contextBar.boundingBox();
  const viewportWidth = page.viewportSize()?.width || 0;
  const chrome = viewportWidth >= 1181
    ? page.locator(".header-quick-cta:visible")
    : page.locator(".site-header:visible");
  const chromeBox = await chrome.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(chromeBox).not.toBeNull();
  expect(firstBox.y).toBeGreaterThanOrEqual(chromeBox.y + chromeBox.height + 8);

  const secondScrollTop = Math.min(firstScrollTop + 240, scrollRange);
  expect(secondScrollTop - firstScrollTop).toBeGreaterThanOrEqual(200);
  await page.evaluate((top) => window.scrollTo({ top, left: 0, behavior: "instant" }), secondScrollTop);
  const secondBox = await contextBar.boundingBox();
  expect(secondBox).not.toBeNull();
  expect(Math.abs(secondBox.y - firstBox.y)).toBeLessThanOrEqual(2);
  await expectNoHorizontalOverflow(page);
  return { contextBar, trigger: contextTrigger };
}

async function captureV16Proof(page, filename, { resetScroll = true } = {}) {
  if (!CAPTURE_V16_BROWSER_PROOF) return;
  mkdirSync(V16_BROWSER_PROOF_DIR, { recursive: true });
  // Proof must represent a settled route, not an entry animation or retained
  // scroll position from the preceding interaction.
  await page.waitForTimeout(320);
  await page.evaluate((shouldResetScroll) => {
    if (shouldResetScroll) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
    const active = document.activeElement;
    if (active?.matches?.("h1[tabindex='-1'], h2[tabindex='-1'], h3[tabindex='-1']")) {
      active.blur();
    }
  }, resetScroll);
  await page.screenshot({
    path: resolve(V16_BROWSER_PROOF_DIR, filename),
    animations: "disabled"
  });
}

test.describe("QuotePilot v0.16 Calm Four release acceptance", () => {
  test.skip(
    !REQUIRED_GATES,
    "The v0.16 release gate requires the customer-centered workspace and Ambient UI gates."
  );

  test.beforeEach(async ({ page }, testInfo) => {
    const quotes = testInfo.title.startsWith("1.")
      ? buildNowEvidenceFixtures()
      : QUOTE_FIXTURES;
    await seedWorkspace(page, quotes);
  });

  test("1. Calm Four remains the only primary navigation and secondary utilities stay reachable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoWorkspace(page, "/app");

    const primary = page.getByRole("navigation", { name: "Primary workspace" });
    await expect(primary.getByRole("button")).toHaveCount(4);
    await expect(primary.getByRole("button").allTextContents()).resolves.toEqual([
      "Now",
      "Opportunities",
      "Clients",
      "Library"
    ]);
    await expect(primary.getByRole("button", { name: "Now", exact: true }))
      .toHaveAttribute("aria-current", "page");
    const now = page.locator(".ambient-now");
    await expect(now).toBeVisible({ timeout: 30_000 });
    await expect(now.locator(".ambient-now__attention-label--desktop"))
      .toHaveText("One thing deserves attention");
    await expect(now.getByRole("list", { name: "Upcoming events" }))
      .toContainText("Autumn Benefit Dinner");
    await captureV16Proof(page, "01-desktop-now.png");

    const newQuote = page.locator('[data-ambient-utility="new-quote"]');
    await expect(newQuote).toHaveText(/New quote/u);
    await expect(newQuote).not.toHaveAttribute("aria-current", "page");
    await expect(primary.locator('[data-ambient-utility="new-quote"]')).toHaveCount(0);

    await primary.getByRole("button", { name: "Opportunities", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/quotes$/u);
    await expect(primary.getByRole("button", { name: "Opportunities", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await primary.getByRole("button", { name: "Clients", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/customers$/u);
    await primary.getByRole("button", { name: "Library", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/catalog$/u);
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/customers$/u);
    await expect(primary.getByRole("button", { name: "Clients", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await page.goForward();
    await expect(page).toHaveURL(/\/app\/catalog$/u);

    const header = page.locator(".site-header");
    await expect(header.getByRole("button", { name: "Search", exact: true })).toBeVisible();
    await expect(header.getByRole("button", { name: "Operations", exact: true })).toBeVisible();
    await header.getByRole("button", { name: "Operations", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Operations" })).toContainText("Operations");
    await header.getByRole("button", { name: "Operations", exact: true }).click();
    const desktopToolsTrigger = header.getByRole("button", {
      name: "Workspace and tools",
      exact: true
    });
    await desktopToolsTrigger.click();
    const desktopTools = page.getByRole("dialog", { name: "Workspace & tools" });
    await expect(desktopTools.getByRole("heading", { name: "Current workspace" })).toBeVisible();
    await expect(desktopTools.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(desktopTools.getByRole("button", { name: "Sign Out" })).toBeVisible();
    await expect(desktopTools.getByRole("button", { name: "Account settings" })).toBeVisible();
    await expect(desktopTools).toContainText(/admin/iu);
    await desktopTools.getByRole("button", { name: "Account settings" }).click();
    const desktopAccountSettings = page.getByRole("dialog", { name: "Account settings" });
    await expect(desktopAccountSettings).toBeVisible();
    await expect(desktopAccountSettings.getByRole("heading", { name: "Current sign-in" }))
      .toBeVisible();
    await expect(desktopAccountSettings.locator("dd").first()).toContainText("@");
    await expect(desktopAccountSettings.getByRole("button", { name: "Send password reset email" }))
      .toBeEnabled();
    await desktopAccountSettings.getByRole("button", { name: "Close account settings" }).click();
    await expect(desktopAccountSettings).toBeHidden();
    await expect(desktopToolsTrigger).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await primary.getByRole("button", { name: "Now", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/u);
    await expect(page.locator(".ambient-now")).toBeVisible({ timeout: 30_000 });
    await expect(primary.getByRole("button")).toHaveCount(4);
    await expectNoHorizontalOverflow(page);
    await captureV16Proof(page, "13-mobile-now.png");
    const mobileDestinations = [
      ["Now", /\/app$/u],
      ["Opportunities", /\/app\/quotes$/u],
      ["Clients", /\/app\/customers$/u],
      ["Library", /\/app\/catalog$/u]
    ];
    for (const [label, expectedPath] of mobileDestinations) {
      await primary.getByRole("button", { name: label, exact: true }).click();
      await expect(page).toHaveURL(expectedPath);
      await expect(header.getByRole("button", {
        name: "Workspace and tools",
        exact: true
      })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    await primary.getByRole("button", { name: "Now", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/u);
    const toolsTrigger = header.getByRole("button", {
      name: "Workspace and tools",
      exact: true
    });
    await expect(toolsTrigger).toBeVisible();
    await toolsTrigger.click();
    const tools = page.getByRole("dialog", { name: "Workspace & tools" });
    await expect(tools).toBeVisible();
    await captureV16Proof(page, "11-mobile-workspace-tools.png");
    await expect(tools.getByRole("button", { name: "Search customers and opportunities" })).toBeVisible();
    await expect(tools.getByRole("heading", { name: "Operations" })).toBeVisible();
    await expect(tools.getByRole("button", { name: "Operations", exact: true })).toBeVisible();
    await expect(tools.getByRole("button", { name: "Account settings" })).toBeVisible();
    await expect(tools.getByRole("button", { name: "Sign Out" })).toBeVisible();
    await tools.getByRole("button", { name: "Account settings" }).click();
    const mobileAccountSettings = page.getByRole("dialog", { name: "Account settings" });
    await expect(mobileAccountSettings).toBeVisible();
    await expect(mobileAccountSettings.locator("dd").first()).toContainText("@");
    await expectNoHorizontalOverflow(page);
    await mobileAccountSettings.getByRole("button", { name: "Close account settings" }).click();
    await expect(mobileAccountSettings).toBeHidden();
    await expect(toolsTrigger).toBeFocused();

    await toolsTrigger.click();
    await expect(tools).toBeVisible();
    const mobileRoute = page.url();
    await page.evaluate(() => window.history.back());
    await expect(tools).toBeHidden();
    expect(page.url()).toBe(mobileRoute);
    await expect(toolsTrigger).toBeFocused();
  });

  test("2. Opportunities index preserves ordering, object identity, history context, and a mobile landing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoWorkspace(page, "/app/quotes");

    const stream = page.locator(".ambient-opportunities");
    await expect(stream).toBeVisible({ timeout: 30_000 });
    const rows = stream.locator(".ambient-opportunity");
    await expect(rows).toHaveCount(3);
    await captureV16Proof(page, "02-desktop-opportunities-index.png");
    await expect(rows.evaluateAll((items) => items.map((item) => item.dataset.opportunityId)))
      .resolves.toEqual(["spring-gala-closed", RIVERA_QUOTE_ID, "autumn-benefit"]);
    await expect(stream.locator('[data-opportunity-id="spring-gala-closed"]'))
      .toHaveAttribute("data-needs-attention", "true");
    const riveraRow = stream.locator(`[data-opportunity-id="${RIVERA_QUOTE_ID}"]`);
    await expect(riveraRow).toContainText("Rivera Wedding");
    await expect(riveraRow).toContainText("The Glass House");
    await expect(riveraRow).toContainText("96");
    await riveraRow.locator(".ambient-opportunity__primary-action").click();
    await expect(page).toHaveURL(new RegExp(`${OPPORTUNITY_PATH}$`, "u"));

    const opportunity = page.locator(`[data-quote-id="${RIVERA_QUOTE_ID}"].ambient-living-opportunity`);
    await expect(opportunity).toBeVisible({ timeout: 30_000 });
    await expect(opportunity).toContainText("Rivera Wedding");
    await expect(opportunity).toContainText("Wedding");
    await expect(opportunity).toContainText("The Glass House");
    await expect(opportunity).toContainText("Sep 12");
    await expect(opportunity).toContainText("5:30 PM");
    await captureV16Proof(page, "03-desktop-opportunity.png");

    const riveraState = await readLocalState(page);
    expect(riveraState.quote).toMatchObject({
      id: RIVERA_QUOTE_ID,
      organizationId: ORGANIZATION_ID,
      customerId: RIVERA_CLIENT_ID,
      selection: {
        eventTypeId: "wedding",
        packageName: "Premium",
        menuItemNames: ["Roasted Chicken"]
      },
      event: {
        name: "Rivera Wedding",
        date: "2026-09-12",
        time: "17:30",
        venue: "The Glass House",
        guests: 96,
        servers: 6,
        chefs: 2,
        bartenders: 1
      },
      totals: { total: 4658.28 }
    });
    await expect(opportunity.locator('[data-intelligent-object="guest-count"]'))
      .toContainText("96 guests");
    await expect(opportunity.locator('[data-intelligent-object="menu"]'))
      .toContainText("1 saved item");
    await expect(opportunity.locator('[data-intelligent-object="staffing"]'))
      .toContainText("6 servers · 2 chefs · 1 bartender");
    await expect(opportunity.locator('[data-intelligent-object="pricing"]'))
      .toContainText("$4,658.28");
    await expect(opportunity.locator('[data-intelligent-object="proposal"]'))
      .toContainText("proposal completeness");
    await opportunity.getByRole("button", {
      name: "Show event, menu, staffing, and pricing"
    }).click();
    const operational = opportunity.locator('[data-disclosure-layer="operational"]');
    await expect(operational).toContainText("Plated");
    await expect(operational).toContainText("9 quoted staff");
    await opportunity.getByRole("button", { name: "Show more context" }).click();
    const supporting = opportunity.locator('[data-disclosure-layer="supporting"]');
    await expect(supporting).toContainText("Version 3");
    await expect(supporting).toContainText("No recorded activity");

    await page.goBack();
    await expect(page).toHaveURL(/\/app\/quotes$/u);
    await expect(stream.locator(`[data-opportunity-id="${RIVERA_QUOTE_ID}"]`)).toBeVisible();
    await stream.locator('[data-opportunity-id="autumn-benefit"] .ambient-opportunity__primary-action').click();
    await expect(page).toHaveURL(/\/app\/quotes\/autumn-benefit$/u);
    await expect(page.locator('[data-quote-id="autumn-benefit"]')).toContainText("Autumn Benefit Dinner");
    await expect(page.locator('[data-quote-id="autumn-benefit"]')).not.toContainText("Rivera Wedding");

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWorkspace(page, "/app/quotes");
    await expect(stream).toBeVisible();
    await expect(rows).toHaveCount(3);
    await expect(stream.getByRole("heading", { name: "Every event, with its next move.", exact: true })).toBeVisible();
    await expect(stream.locator(`[data-opportunity-id="${RIVERA_QUOTE_ID}"]`)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await captureV16Proof(page, "12-mobile-opportunities-index.png");
    const mobileRiveraRow = stream.locator(`[data-opportunity-id="${RIVERA_QUOTE_ID}"]`);
    await mobileRiveraRow.scrollIntoViewIfNeeded();
    const indexScrollTop = await page.evaluate(() => window.scrollY);
    // A compact three-record fixture can fit without scrolling on this phone.
    // Whether zero or non-zero, the exact practical index position must return.
    expect(indexScrollTop).toBeGreaterThanOrEqual(0);
    await mobileRiveraRow.locator(".ambient-opportunity__primary-action").click();
    await expect(page).toHaveURL(new RegExp(`${OPPORTUNITY_PATH}$`, "u"));
    await expect(page.locator(`[data-quote-id="${RIVERA_QUOTE_ID}"].ambient-living-opportunity`))
      .toBeVisible({ timeout: 30_000 });
    await captureV16Proof(page, "14-mobile-opportunity.png");
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/quotes$/u);
    await expect(rows).toHaveCount(3);
    await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - indexScrollTop))
      .toBeLessThanOrEqual(2);
  });

  test("3. Quick Updates opens contextually with zero mutation and restores focus", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoRiveraOpportunity(page);
    const before = await readLocalState(page);
    const beforeUrl = page.url();
    await expectQuickUpdatesLauncherLayout(page, { persistent: true });
    await captureV16Proof(page, "03a-desktop-opportunity-sticky-quick-updates.png", {
      resetScroll: false
    });
    const { panel, trigger } = await openQuickUpdates(page);

    await expect(page.locator(`[data-quote-id="${RIVERA_QUOTE_ID}"].ambient-living-opportunity`)).toBeVisible();
    expect(page.url()).toBe(beforeUrl);
    await expect(panel.getByRole("heading", { name: "Quick Updates" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Close Quick Updates" })).toBeFocused();
    await captureV16Proof(page, "04-desktop-quick-updates-open.png");

    const menu = panel.getByRole("button", { name: /Menu/u }).first();
    const staffing = panel.getByRole("button", { name: /Staffing/u }).first();
    const pricing = panel.getByRole("button", { name: /Pricing/u }).first();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await staffing.click();
    await expect(staffing).toHaveAttribute("aria-expanded", "true");
    await staffing.click();
    await pricing.click();
    await expect(pricing).toHaveAttribute("aria-expanded", "true");
    await pricing.click();

    expect(await readLocalState(page)).toEqual(before);
    await panel.getByRole("button", { name: "Close Quick Updates" }).click();
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await readLocalState(page)).toEqual(before);
    expect(page.url()).toBe(beforeUrl);

    await page.setViewportSize({ width: 768, height: 900 });
    await gotoRiveraOpportunity(page);
    const tabletBeforeUrl = page.url();
    await expectQuickUpdatesLauncherLayout(page, { persistent: true });
    await captureV16Proof(page, "03b-tablet-opportunity-sticky-quick-updates.png", {
      resetScroll: false
    });
    const tabletQuickUpdates = await openQuickUpdates(page);
    await tabletQuickUpdates.panel.getByRole("button", { name: "Close Quick Updates" }).click();
    await expect(tabletQuickUpdates.panel).toBeHidden();
    await expect(tabletQuickUpdates.trigger).toBeFocused();
    expect(page.url()).toBe(tabletBeforeUrl);
    expect(await readLocalState(page)).toEqual(before);

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRiveraOpportunity(page);
    const mobileBeforeUrl = page.url();
    await expectQuickUpdatesLauncherLayout(page, { persistent: false });
    const mobileQuickUpdates = await openQuickUpdates(page);
    await captureV16Proof(page, "15-mobile-quick-updates-open.png");
    await mobileQuickUpdates.panel.getByRole("button", { name: "Close Quick Updates" }).click();
    await expect(mobileQuickUpdates.panel).toBeHidden();
    await expect(mobileQuickUpdates.trigger).toBeFocused();
    expect(page.url()).toBe(mobileBeforeUrl);
    expect(await readLocalState(page)).toEqual(before);
  });

  test("4. Quick Updates dirty state is local, durable inside the panel, and never autosaves", async ({ page }) => {
    addEvidenceAnnotation(
      "state-trace",
      `${QUOTES_KEY}:${RIVERA_QUOTE_ID} is read before and after local draft interaction; no history entry or persisted field may change.`
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoRiveraOpportunity(page);
    const before = await readLocalState(page);
    const { panel, style } = await makeQuickUpdatesDirty(page);

    expect(await readLocalState(page)).toEqual(before);
    const menu = panel.getByRole("button", { name: /Menu/u }).first();
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(style).toHaveValue("Buffet");
    await expect(panel).toHaveAttribute("data-quick-updates-phase", "dirty");
    await captureV16Proof(page, "05-desktop-quick-updates-dirty.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureV16Proof(page, "16-mobile-quick-updates-dirty.png");
    expect(await readLocalState(page)).toEqual(before);
    expect(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(true);
  });

  test("5. every destructive dismissal path uses the same Keep editing and Discard draft guard", async ({ page }) => {
    test.setTimeout(120_000);
    addEvidenceAnnotation(
      "state-trace",
      "Each guard path verifies the exact local quote remains unchanged after Keep editing and after Discard draft. Browser back covers mobile back semantics."
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    const reset = async () => {
      await gotoRiveraOpportunity(page);
      const before = await readLocalState(page);
      const dirty = await makeQuickUpdatesDirty(page);
      return { before, ...dirty };
    };

    for (const dismissal of [
      {
        name: "X",
        attempt: (panel) => panel.getByRole("button", { name: "Close Quick Updates" }).click()
      },
      {
        name: "Cancel",
        attempt: (panel) => panel.getByRole("button", { name: "Cancel" }).click()
      },
      {
        name: "Escape",
        attempt: () => page.keyboard.press("Escape")
      },
      {
        name: "backdrop",
        attempt: (panel) => panel.click({ position: { x: 4, y: 4 } })
      }
    ]) {
      await test.step(dismissal.name, async () => {
        const { before, panel, style } = await reset();
        let guard = await expectGuard(page, () => dismissal.attempt(panel));
        if (dismissal.name === "X") {
          await captureV16Proof(page, "06a-desktop-quick-updates-dismissal-guard.png");
        }
        await guard.getByRole("button", { name: "Keep editing" }).click();
        await expect(panel).toHaveAttribute("data-quick-updates-phase", "dirty");
        await expect(style).toHaveValue("Buffet");
        expect(await readLocalState(page)).toEqual(before);

        guard = await expectGuard(page, () => dismissal.attempt(panel));
        await guard.getByRole("button", { name: "Discard draft" }).click();
        await expect(panel).toBeHidden();
        expect(await readLocalState(page)).toEqual(before);
      });
    }

    await test.step("Calm Four navigation", async () => {
      const { before, panel, style } = await reset();
      const now = page.locator('button[data-ambient-orientation="now"]');
      // The modal correctly blocks pointer interaction with the background.
      // Programmatic activation represents an app/navigation attempt reaching
      // the shared router while the drawer is dirty.
      let guard = await expectGuard(page, () => now.evaluate((button) => button.click()));
      await guard.getByRole("button", { name: "Keep editing" }).click();
      await expect(page).toHaveURL(new RegExp(`${OPPORTUNITY_PATH}$`, "u"));
      await expect(style).toHaveValue("Buffet");
      guard = await expectGuard(page, () => now.evaluate((button) => button.click()));
      await guard.getByRole("button", { name: "Discard draft" }).click();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(/\/app$/u);
      expect(await readLocalState(page)).toEqual(before);
    });

    await test.step("browser and mobile back", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoWorkspace(page, "/app/quotes");
      const row = page.locator(`[data-opportunity-id="${RIVERA_QUOTE_ID}"]`);
      await row.locator(".ambient-opportunity__primary-action").click();
      await expect(page).toHaveURL(new RegExp(`${OPPORTUNITY_PATH}$`, "u"));
      const before = await readLocalState(page);
      const { panel, style } = await makeQuickUpdatesDirty(page);

      let guard = await expectGuard(page, () => page.evaluate(() => window.history.back()));
      await guard.getByRole("button", { name: "Keep editing" }).click();
      await expect(page).toHaveURL(new RegExp(`${OPPORTUNITY_PATH}$`, "u"));
      await expect(style).toHaveValue("Buffet");
      guard = await expectGuard(page, () => page.evaluate(() => window.history.back()));
      await guard.getByRole("button", { name: "Discard draft" }).click();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(/\/app\/quotes$/u);
      expect(await readLocalState(page)).toEqual(before);
    });
  });

  test("6. local fallback refuses an authoritative Quick Updates save and hands off without mutation", async ({ page }) => {
    addEvidenceAnnotation(
      "state-trace",
      `Before/after snapshots use ${QUOTES_KEY} and ${HISTORY_KEY}; Firebase save/readback semantics are covered by the focused client, server-contract, and panel tests.`
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoRiveraOpportunity(page);
    const before = await readLocalState(page);
    const { panel, style } = await makeQuickUpdatesDirty(page);
    await panel.getByRole("button", { name: "Review menu change" }).click();
    await expect(panel).toHaveAttribute("data-quick-updates-phase", "failure");
    await expect(panel).toContainText("cannot claim an authoritative save");
    await expect(panel.getByRole("button", { name: "Save menu change" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Retry authoritative review" })).toHaveCount(0);
    await captureV16Proof(page, "06-desktop-quick-updates-local-handoff.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureV16Proof(page, "17-mobile-quick-updates-local-handoff.png");
    expect(await readLocalState(page)).toEqual(before);

    await panel.getByRole("button", { name: "Continue in quote editor" }).click();
    const guard = page.getByRole("alertdialog", { name: "Discard unsaved Quick Updates?" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Keep editing" }).click();
    await expect(style).toHaveValue("Buffet");
    expect(await readLocalState(page)).toEqual(before);
  });

  test("7. local Quick Updates never invents derived rules or writes parallel pricing", async ({ page }) => {
    addEvidenceAnnotation(
      "authority-evidence",
      "Browser trace proves the local fallback is browse-and-handoff only. Firebase simulation/save equivalence is asserted by commercialChangeAuthorityClient.test.js, commercialChangeAuthorityIntegration.server.test.js, and QuickUpdatesPanel.test.jsx."
    );
    await gotoRiveraOpportunity(page);
    const before = await readLocalState(page);
    const { panel } = await makeQuickUpdatesDirty(page);
    await panel.getByRole("button", { name: "Review menu change" }).click();
    await expect(panel).toHaveAttribute("data-quick-updates-phase", "failure");
    await expect(panel).toContainText("cannot claim an authoritative save");
    await expect(panel).not.toContainText("Enumerated material save effects");

    const after = await readLocalState(page);
    expect(after).toEqual(before);
  });

  test("8. standalone and contextual Library share catalog authority without leaking or mutating context", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoWorkspace(page, "/app/catalog");
    const library = page.locator(".ambient-library");
    await expect(library).toBeVisible({ timeout: 30_000 });
    await expect(library).toHaveAttribute("data-library-context", "standalone");
    await expect(library).not.toContainText("Rivera Wedding");
    await expect(library.locator('[data-library-record-kind="catalog-section"]')).toHaveCount(6);
    const standaloneCatalogRows = await library.locator('[data-library-record-kind="catalog-section"]')
      .evaluateAll((rows) => rows.map((row) => ({
        id: row.dataset.libraryRecordId,
        text: row.textContent.replace(/\s+/gu, " ").trim()
      })));
    await captureV16Proof(page, "07-desktop-library-standalone.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureV16Proof(page, "18-mobile-library-standalone.png");
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const sectionId of ["packages", "menu", "addons", "rentals", "templates", "pricing"]) {
      await expect(library.locator(`[data-library-record-id="${sectionId}"]`)).toBeVisible();
    }

    const before = await readLocalState(page);
    await gotoRiveraOpportunity(page);
    const { panel } = await openQuickUpdates(page);
    await panel.getByRole("button", { name: "Open full Library" }).click();
    await expect(page).toHaveURL(/\/app\/catalog$/u);
    await expect(library).toHaveAttribute("data-library-context", "opportunity");
    await expect(library).toContainText("Working with Rivera Wedding");
    let returnToRivera = library.getByRole("button", { name: /Return to Rivera Wedding/u });
    await expect(returnToRivera).toBeVisible();
    expect(await readLocalState(page)).toEqual(before);

    await page.reload();
    await expect(library).toBeVisible({ timeout: 30_000 });
    await expect(library).toHaveAttribute("data-library-context", "opportunity");
    await expect(library).toContainText("Working with Rivera Wedding");
    returnToRivera = library.getByRole("button", { name: /Return to Rivera Wedding/u });
    await expect(returnToRivera).toBeVisible();
    const contextualCatalogRows = await library.locator('[data-library-record-kind="catalog-section"]')
      .evaluateAll((rows) => rows.map((row) => ({
        id: row.dataset.libraryRecordId,
        text: row.textContent.replace(/\s+/gu, " ").trim()
      })));
    expect(contextualCatalogRows).toEqual(standaloneCatalogRows);
    await captureV16Proof(page, "08-desktop-library-contextual.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureV16Proof(page, "19-mobile-library-contextual.png");
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(await readLocalState(page)).toEqual(before);

    await library.locator('[data-library-record-id="menu"] button').click();
    await expect(library).toHaveAttribute("data-library-context", "opportunity");
    await expect(library.getByRole("button", { name: /Return to Rivera Wedding/u })).toBeVisible();
    await expect(page.locator('[data-admin-tab-id="menu"]')).toHaveClass(/active/u);
    expect(await readLocalState(page)).toEqual(before);
    await page.getByRole("button", { name: "Back to Library" }).click();
    await returnToRivera.click();
    await expect(page).toHaveURL(new RegExp(`${OPPORTUNITY_PATH}$`, "u"));
    await expect(page.locator(`[data-quote-id="${RIVERA_QUOTE_ID}"]`)).toContainText("Rivera Wedding");

    await page.getByRole("navigation", { name: "Primary workspace" })
      .getByRole("button", { name: "Library", exact: true }).click();
    await expect(library).toHaveAttribute("data-library-context", "standalone");
    await expect(library).not.toContainText("Working with Rivera Wedding");

    await gotoRiveraOpportunity(page);
    const reopened = await openQuickUpdates(page);
    await reopened.panel.getByRole("button", { name: "Open full Library" }).click();
    await expect(library).toHaveAttribute("data-library-context", "opportunity");
    await page.getByRole("navigation", { name: "Primary workspace" })
      .getByRole("button", { name: "Now", exact: true }).click();
    await page.getByRole("button", { name: "Operations", exact: true }).click();
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await expect(library).toHaveAttribute("data-library-context", "standalone");
    await expect(library).not.toContainText("Working with Rivera Wedding");
  });

  test("9. Clients empty/populated states are tenant-safe and keep relationship evidence correctable", async ({ page }) => {
    addEvidenceAnnotation(
      "tenant-state-trace",
      "The UI renders only recorded same-tenant client, contact, event, and status fields; it does not render derived relationship memory. Cross-tenant denial is paired with the Firestore emulator rules suite; browser-local fallback is intentionally one workspace."
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoWorkspace(page, "/app/customers");
    const clients = page.locator(".ambient-clients");
    await expect(clients).toBeVisible({ timeout: 30_000 });
    await expect(clients).toHaveAttribute("data-ambient-clients-state", /success|ready/u);
    await expect(clients).toContainText("Relationships, in context.");
    await expect(clients).toContainText("Recorded contact details");
    await expect(clients).toContainText("Avery & Jordan Rivera");
    await expect(clients).toContainText("rivera@example.test");
    await expect(clients).toContainText("205-555-0250");
    await expect(clients).not.toContainText("Truthful State");
    await expect(clients).toContainText("Upcoming event on file");
    await expect(clients).not.toContainText("relationship memory");
    await captureV16Proof(page, "09-desktop-clients-populated.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureV16Proof(page, "20-mobile-clients-populated.png");
    await page.setViewportSize({ width: 1440, height: 1000 });

    const search = clients.getByPlaceholder("Search clients");
    await search.fill("rivera@example.test");
    await clients.getByRole("button", { name: "Search", exact: true }).click();
    await expect(clients.locator('[data-client-id="client-rivera"]')).toBeVisible();
    await clients.locator('[data-client-id="client-rivera"] .ambient-client__primary').click();
    await expect(page).toHaveURL(new RegExp(`/app/customers/${RIVERA_CLIENT_ID}$`, "u"));
    const clientOverview = page.locator(`[data-client-id="${RIVERA_CLIENT_ID}"].ambient-client-overview`);
    await expect(clientOverview).toContainText("Avery & Jordan Rivera");
    const clientRecord = page.locator("details.ambient-client-overview__record");
    await expect(clientRecord.getByText("More client history and controls")).toBeVisible();
    await clientRecord.getByText("More client history and controls").click();
    for (const tab of ["Overview", "Quotes & Proposals", "Events", "Money", "Conversations"]) {
      await expect(clientRecord.getByRole("tab", { name: tab, exact: true })).toBeVisible();
    }

    await page.getByRole("navigation", { name: "Primary workspace" })
      .getByRole("button", { name: "Clients", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/customers$/u);
    await clients.getByPlaceholder("Search clients").fill("lena@example.test");
    await clients.getByRole("button", { name: "Search", exact: true }).click();
    await expect(clients.locator('[data-client-id="client-chen"]')).toContainText("Lena Chen");
    await clients.locator('[data-client-id="client-chen"] .ambient-client__primary').click();
    await expect(page).toHaveURL(/\/app\/customers\/client-chen$/u);
    await expect(page.locator('[data-client-id="client-chen"].ambient-client-overview')).toContainText("Lena Chen");
    await expect(page.locator('[data-client-id="client-chen"].ambient-client-overview')).not.toContainText("Avery & Jordan Rivera");

    await page.evaluate(({ quotesKey }) => {
      localStorage.setItem(quotesKey, "[]");
    }, { quotesKey: QUOTES_KEY });
    const primary = page.getByRole("navigation", { name: "Primary workspace" });
    await primary.getByRole("button", { name: "Now", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/u);
    await primary.getByRole("button", { name: "Clients", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/customers$/u);
    await expect(clients).toHaveAttribute("data-ambient-clients-state", "empty");
    await expect(clients.getByRole("heading", { name: "Your first client story starts here" })).toBeVisible();
    await expect(clients.getByRole("button", { name: "Start an opportunity" })).toBeVisible();
    await expect(clients.getByPlaceholder("Search clients")).toHaveCount(0);
    await expect(clients.locator(".ambient-clients__metrics, .ambient-clients__toolbar")).toHaveCount(0);
    await expect(clients).toContainText("Add the event details");
    await expect(clients).not.toContainText("New relationships");
    await captureV16Proof(page, "10-desktop-clients-empty.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureV16Proof(page, "21-mobile-clients-empty.png");
    await clients.getByRole("button", { name: "Start an opportunity" }).click();
    await expect(page).toHaveURL(/\/app\/quotes\/new$/u);
  });

  test("10. responsive, accessibility, permission, and stale-save recovery survive the redesign", async ({ page }) => {
    addEvidenceAnnotation(
      "failure-state-trace",
      "A concurrent local activeVersionId change must produce a visible conflict and retain the unsaved Quick Updates draft."
    );
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 900 },
      { width: 1280, height: 900 },
      { width: 1440, height: 1000 }
    ]) {
      await page.setViewportSize(viewport);
      await gotoWorkspace(page, "/app/quotes");
      await expect(page.locator(".ambient-opportunities")).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalOverflow(page);
      const navTargets = await page.getByRole("navigation", { name: "Primary workspace" })
        .getByRole("button")
        .evaluateAll((buttons) => buttons.filter((button) => {
          const style = getComputedStyle(button);
          const rect = button.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        }).map((button) => {
          const rect = button.getBoundingClientRect();
          return { label: button.textContent.trim(), width: rect.width, height: rect.height };
        }));
      expect(navTargets.filter(({ width, height }) => width < 44 || height < 44)).toEqual([]);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRiveraOpportunity(page);
    const { panel } = await openQuickUpdates(page);
    await expectNoHorizontalOverflow(page);
    const quickUpdatesAccessibility = await new AxeBuilder({ page })
      .include('[data-testid="quick-updates-panel"]')
      .analyze();
    expect(quickUpdatesAccessibility.violations).toEqual([]);
    await page.keyboard.press("Shift+Tab");
    expect(await panel.getByRole("dialog").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await panel.getByRole("button", { name: "Close Quick Updates" }).click();

    const salesPort = Number(process.env.PLAYWRIGHT_SALES_PORT || 4176);
    await page.goto(`http://127.0.0.1:${salesPort}/app/catalog`);
    await expect(page.getByText("Business Setup Center", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("#catalog-admin-title")).toHaveCount(0);

    await page.goto(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || 4173}${OPPORTUNITY_PATH}`);
    await expect(page.locator(`[data-quote-id="${RIVERA_QUOTE_ID}"]`)).toBeVisible({ timeout: 30_000 });
    const dirty = await makeQuickUpdatesDirty(page);
    await page.evaluate(({ quotesKey, quoteId }) => {
      const quotes = JSON.parse(localStorage.getItem(quotesKey) || "[]");
      const target = quotes.find((quote) => quote.id === quoteId);
      target.activeVersionId = "v0099";
      target.latestVersionNumber = 99;
      localStorage.setItem(quotesKey, JSON.stringify(quotes));
    }, { quotesKey: QUOTES_KEY, quoteId: RIVERA_QUOTE_ID });
    await dirty.panel.getByRole("button", { name: "Review menu change" }).click();
    await expect(dirty.panel).toHaveAttribute("data-quick-updates-phase", "conflict");
    await expect(dirty.panel).toContainText("changed after Quick Updates opened");
    await expect(dirty.panel).toContainText("Your draft still changes Plated dinner to Buffet");
    await expect(dirty.panel).toContainText("Nothing here claims that it was saved");
    const stale = await readLocalState(page);
    expect(stale.quote.event.style).toBe("Plated");
    expect(stale.history).toHaveLength(0);
  });
});
