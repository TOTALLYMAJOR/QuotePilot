import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  DEFAULT_ADDONS,
  DEFAULT_EVENT_TEMPLATES,
  DEFAULT_PACKAGES,
  DEFAULT_RENTALS,
  DEFAULT_SETTINGS
} from "../src/data/mockCatalog";

const REQUIRED_GATES = [
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED,
  process.env.VITE_AMBIENT_UI_ENABLED,
  process.env.VITE_PILOT_NOW_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(
  String(value || "").trim().toLowerCase()
));
const CAPTURE_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_RETURN_CONTEXT_PROOF || "").trim().toLowerCase()
);
const PROOF_DIRECTORY = "output/playwright/staff-app-return-context";
const ORGANIZATION_ID = "e2e-org";
const TARGET_QUOTE_ID = "opportunity-18";
const TARGET_CLIENT_ID = "client-31";
const PAGINATED_CLIENT_ID = "client-9";
const CLIENT_OPPORTUNITY_ID = "opportunity-31";
const MAYA_CLIENT_ID = "ambient-client-maya";
const PRIVATE_QUERY = "private-return-context";
const PRIVATE_CLIENT_EMAIL = "private-return-context-maya@example.test";
const OPPORTUNITY_QUERY = "Client";
const TEST_SEED_MARKER = "quotepilot.e2e.return-context-seeded";
const RETURN_TOKEN_KEYS = [
  "contextId",
  "destination",
  "modelId",
  "organizationId",
  "origin",
  "principal",
  "runtimeId",
  "surfaceId"
].sort();
const SAFE_REQUEST_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const requestLedgers = new WeakMap();
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
];

function quote(index, overrides = {}) {
  const customerId = index === 0 ? MAYA_CLIENT_ID : `client-${index}`;
  const quoteId = index === 0 ? "opportunity-autumn" : `opportunity-${index}`;
  const calendarMonth = 10 + Math.floor(index / 28);
  const calendarDay = (index % 28) + 1;
  return {
    organizationId: ORGANIZATION_ID,
    id: quoteId,
    customerId,
    quoteNumber: `QP-${String(index + 1).padStart(4, "0")}`,
    status: index % 2 ? "sent" : "draft",
    activeVersionId: "v0002",
    latestVersionNumber: 2,
    createdAtISO: `2026-08-${String(calendarDay).padStart(2, "0")}T12:00:00.000Z`,
    updatedAtISO: `2026-09-${String(calendarDay).padStart(2, "0")}T18:00:00.000Z`,
    expiresAtISO: "2099-12-31T23:59:59.000Z",
    customer: {
      name: index === 0 ? "Maya Bennett" : `Client ${index}`,
      email: index === 0 ? PRIVATE_CLIENT_EMAIL : `private-return-context-${index}@example.test`,
      phone: `205-555-${String(1800 + index)}`,
      organization: index === 0 ? "Bennett Foundation" : `Company ${index}`
    },
    event: {
      name: index === 0 ? "Autumn Benefit Dinner" : `Event ${index}`,
      date: `2099-${String(calendarMonth).padStart(2, "0")}-${String(calendarDay).padStart(2, "0")}`,
      time: "18:00",
      hours: 5,
      venue: index === 0 ? "The Foundry Hall" : `Venue ${index}`,
      style: index % 2 ? "Buffet" : "Plated",
      guests: 80 + index,
      servers: 5,
      chefs: 2,
      bartenders: 1
    },
    selection: {
      eventTypeId: index === 0 ? "benefit" : "wedding",
      packageId: "classic",
      packageName: "Classic Dinner",
      menuItems: ["herb-chicken"],
      menuItemNames: ["Herb Chicken"],
      addons: [],
      rentals: []
    },
    totals: { total: 8400 + index, deposit: 2520 },
    booking: { confirmationStatus: "pending" },
    payment: { depositStatus: "unpaid", finalBalance: { status: "unpaid" } },
    lifecycle: { draftAtISO: "2026-08-10T12:00:00.000Z" },
    ...overrides
  };
}

const QUOTES = Array.from({ length: 40 }, (_, index) => quote(index));
const CATALOG = {
  packages: DEFAULT_PACKAGES,
  addons: DEFAULT_ADDONS,
  rentals: DEFAULT_RENTALS,
  settings: {
    ...DEFAULT_SETTINGS,
    catalogRevision: 16,
    pricingSetupConfirmed: true,
    menuSections: [],
    eventTemplates: DEFAULT_EVENT_TEMPLATES
  }
};

async function seedWorkspace(page) {
  await page.addInitScript(({ quotes, catalog, marker }) => {
    if (sessionStorage.getItem(marker) === "true") return;
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem("quoteWizard.quotes", JSON.stringify(quotes));
    localStorage.setItem("quoteWizard.quoteHistory", JSON.stringify([]));
    localStorage.setItem("quoteWizard.catalog.e2e-org", JSON.stringify(catalog));
    sessionStorage.setItem(marker, "true");
  }, {
    quotes: QUOTES,
    catalog: CATALOG,
    marker: TEST_SEED_MARKER
  });
}

async function gotoWorkspace(page, path, readySelector) {
  await page.goto(path);
  const setupHeading = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  const ready = page.locator(readySelector);
  await expect(setupHeading.or(ready)).toBeVisible({ timeout: 30_000 });
  if (await setupHeading.isVisible()) {
    await page.getByRole("button", { name: "Explore the workspace" }).click();
  }
  await expect(ready).toBeVisible({ timeout: 30_000 });
  return ready;
}

async function readBusinessState(page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
    .filter(([key]) => (
      key === "quoteWizard.quotes"
      || key === "quoteWizard.quoteHistory"
      || key === "quoteWizard.catalog"
      || key.startsWith("quoteWizard.catalog.")
    ))
    .sort(([left], [right]) => left.localeCompare(right))));
}

async function readHistoryEntry(page) {
  return page.evaluate(() => ({
    length: history.length,
    sessionId: history.state?.__quotepilotHistory?.sessionId || "",
    entryId: history.state?.__quotepilotHistory?.entryId || "",
    position: history.state?.__quotepilotHistory?.position,
    state: history.state
  }));
}

function installRequestLedger(page) {
  const ledger = [];
  requestLedgers.set(page, ledger);
  page.on("request", (request) => {
    const method = request.method().toUpperCase();
    if (SAFE_REQUEST_METHODS.has(method)) return;
    ledger.push({ method, resourceType: request.resourceType(), url: request.url() });
  });
  return ledger;
}

function expectNoUnexpectedMutationRequests(page) {
  expect(
    requestLedgers.get(page) || [],
    "view-context navigation must not issue a non-GET business or provider request"
  ).toEqual([]);
}

async function beforeUnloadIsProtected(page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function assertReturnTokenIsPrivate(page, { originSearch = "" } = {}) {
  const state = await page.evaluate(() => history.state || {});
  const token = state.workspaceReturnContext;
  expect(token).toBeTruthy();
  expect(Object.keys(token).sort()).toEqual(RETURN_TOKEN_KEYS);
  expect(Object.keys(token.principal || {}).sort()).toEqual(["id", "role"]);
  expect(Object.keys(token.origin || {}).sort()).toEqual([
    "entryId", "pathname", "position", "routeId", "search"
  ]);
  expect(Object.keys(token.destination || {}).sort()).toEqual(["pathname", "routeId", "search"]);
  expect(token.origin.search).toBe(originSearch);
  const serialized = JSON.stringify(state);
  expect(serialized).toContain("workspace-return-context-v1");
  expect(serialized).not.toContain(PRIVATE_QUERY);
  expect(serialized).not.toContain(PRIVATE_CLIENT_EMAIL);
  expect(serialized).not.toContain("Maya Bennett");
  expect(serialized).not.toContain("Autumn Benefit Dinner");
  const durableBrowserState = await page.evaluate((seedMarker) => JSON.stringify({
    url: location.href,
    history: history.state,
    local: Object.fromEntries(Object.entries(localStorage).filter(([key]) => (
      !key.startsWith("quoteWizard.")
    ))),
    session: Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key !== seedMarker))
  }), TEST_SEED_MARKER);
  for (const privateValue of [
    PRIVATE_QUERY,
    PRIVATE_CLIENT_EMAIL,
    "Maya Bennett",
    "Autumn Benefit Dinner"
  ]) {
    expect(durableBrowserState).not.toContain(privateValue);
  }
  return token;
}

async function visibleIds(locator, attribute) {
  return locator.evaluateAll((elements, name) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    })
    .map((element) => element.getAttribute(name))
    .filter(Boolean), attribute);
}

async function expectExactDestinationEntry(page, destinationEntry, sourceEntry) {
  expect(destinationEntry.entryId).not.toBe(sourceEntry.entryId);
  expect(destinationEntry.sessionId).toBe(sourceEntry.sessionId);
  expect(destinationEntry.position).toBe(sourceEntry.position + 1);
  expect(destinationEntry.length).toBe(sourceEntry.length + 1);
  const current = await readHistoryEntry(page);
  expect(current.entryId).toBe(destinationEntry.entryId);
  expect(current.position).toBe(destinationEntry.position);
  expect(current.length).toBe(destinationEntry.length);
}

async function expectRestored(page, sourceEntry, focus, scrollY) {
  await expect(page.locator('[data-workspace-return-state="restored"]')).toBeVisible();
  await expect(focus).toBeFocused();
  await expect.poll(async () => page.evaluate((capturedScrollY) => {
    const restoredScrollY = window.scrollY;
    const difference = Math.abs(restoredScrollY - capturedScrollY);
    return [
      `withinTolerance=${difference <= 8}`,
      `captured=${capturedScrollY}`,
      `restored=${restoredScrollY}`,
      `difference=${difference}`,
      `max=${Math.max(0, document.documentElement.scrollHeight - window.innerHeight)}`,
      `fonts=${document.fonts?.status || "unsupported"}`,
      `incompleteImages=${Array.from(document.images).filter((image) => !image.complete).length}`
    ].join(";");
  }, scrollY), {
    message: `expected restored scroll to remain within 8px of ${scrollY}px`
  }).toMatch(/^withinTolerance=true;/u);
  const restoredScrollY = await page.evaluate(() => window.scrollY);
  expect(
    Math.abs(restoredScrollY - scrollY),
    `expected source scroll ${scrollY}px, received ${restoredScrollY}px after return`
  ).toBeLessThanOrEqual(8);
  const restoredEntry = await readHistoryEntry(page);
  expect(restoredEntry.entryId).toBe(sourceEntry.entryId);
  expect(restoredEntry.length).toBe(sourceEntry.length + 1);
}

async function expectFocusedWithDiagnostics(page, target, label) {
  await expect.poll(async () => target.evaluate((element) => {
    const active = document.activeElement;
    if (active === element) return "focused";
    return JSON.stringify({
      activeActionId: active?.dataset?.ambientActionId || active?.dataset?.libraryActionId || "",
      activeClass: typeof active?.className === "string" ? active.className : "",
      activeId: active?.id || "",
      activeTag: active?.tagName || "",
      returnState: document.querySelector("[data-workspace-return-state]")
        ?.getAttribute("data-workspace-return-state") || "",
      url: `${location.pathname}${location.search}`
    });
  }), { message: label }).toBe("focused");
}

async function settleVisualResources(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect.poll(() => page.evaluate(() => (
    Array.from(document.images).filter((image) => !image.complete).length
  ))).toBe(0);
}

async function setStableSourceScroll(page, preferredScrollY = 320) {
  const scrollY = await page.evaluate((requestedScrollY) => {
    const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const stableScrollY = Math.min(requestedScrollY, Math.max(0, maximum - 24));
    window.scrollTo({ top: stableScrollY, behavior: "auto" });
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      const bounds = active.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
        active.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      }
    }
    return window.scrollY;
  }, preferredScrollY);
  expect(scrollY, "the source must have a meaningful, non-terminal scroll position").toBeGreaterThan(100);
  return scrollY;
}

async function expectSourceQuality(page, surface, includeSelector) {
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(1);
  const undersized = await surface.locator("button:visible, input:visible, select:visible, summary:visible")
    .evaluateAll((controls) => controls.map((control) => {
      const rect = control.getBoundingClientRect();
      return {
        label: control.getAttribute("aria-label") || control.textContent.trim(),
        width: rect.width,
        height: rect.height
      };
    }).filter(({ width, height }) => width < 44 || height < 44));
  expect(undersized).toEqual([]);
  const accessibility = await new AxeBuilder({ page }).include(includeSelector).analyze();
  expect(accessibility.violations).toEqual([]);
}

async function expectAxeClean(page, includeSelector) {
  const builder = new AxeBuilder({ page });
  const accessibility = await (includeSelector ? builder.include(includeSelector) : builder).analyze();
  expect(accessibility.violations).toEqual([]);
}

async function expectNoHighImpactAxeViolations(page) {
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(({ impact }) => (
    impact === "serious" || impact === "critical"
  ))).toEqual([]);
}

async function runDiscardGuard(page, action, { accept }) {
  const dialogPromise = page.waitForEvent("dialog");
  const actionPromise = action();
  const dialog = await dialogPromise;
  expect(dialog.message()).toBe("Discard unsaved catalog, menu, and branding changes?");
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await actionPromise;
}

async function capture(page, name) {
  if (!CAPTURE_PROOF) return;
  mkdirSync(PROOF_DIRECTORY, { recursive: true });
  await page.screenshot({
    path: `${PROOF_DIRECTORY}/${name}.png`,
    animations: "disabled",
    fullPage: true
  });
}

async function openQuickUpdates(page) {
  const trigger = page.locator(
    'button[data-ambient-action-id="open-quick-updates"]:visible'
  );
  await expect(trigger).toHaveCount(1);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator('[data-testid="quick-updates-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-quick-updates-phase", "clean");
  return { panel, trigger };
}

test.describe("Staff app return context", () => {
  test.skip(!REQUIRED_GATES, "Return-context acceptance requires the Calm Four feature profile.");
  test.beforeEach(async ({ page }) => {
    installRequestLedger(page);
    await seedWorkspace(page);
  });
  test.afterEach(async ({ page }) => expectNoUnexpectedMutationRequests(page));

  for (const viewport of VIEWPORTS) {
    test(`Opportunities restores exact view context at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const stream = await gotoWorkspace(page, "/app/quotes", ".ambient-opportunities");
      const businessBefore = await readBusinessState(page);
      const administration = page.locator('[data-quote-administration="true"]');
      await administration.locator(":scope > summary").click();
      await administration.getByLabel("Search quotes").fill(OPPORTUNITY_QUERY);
      await administration.getByLabel("Event type").selectOption("wedding");
      await administration.getByLabel("Quote status").selectOption("draft");
      await expect(page).toHaveURL(/\/app\/quotes\?eventType=wedding&status=draft$/u);
      const row = stream.locator(`[data-opportunity-id="${TARGET_QUOTE_ID}"]`);
      await expect(row).toBeVisible();
      const disclosure = row.locator('[data-opportunity-disclosure="details"]');
      await disclosure.locator("summary").click();
      const readBoundary = stream.locator(".ambient-opportunities__boundary");
      await readBoundary.locator(":scope > summary").click();
      const sourceOrder = await visibleIds(stream.locator("[data-opportunity-id]"), "data-opportunity-id");
      expect(sourceOrder.length).toBeGreaterThan(1);
      await settleVisualResources(page);
      await row.scrollIntoViewIfNeeded();
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThan(100);
      const action = row.locator(".ambient-opportunity__primary-action");
      const actionId = await action.getAttribute("data-ambient-action-id");
      await action.focus();
      const sourceEntry = await readHistoryEntry(page);

      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/app/quotes/${TARGET_QUOTE_ID}$`, "u"));
      const destination = page.locator(`[data-quote-id="${TARGET_QUOTE_ID}"].ambient-living-opportunity`);
      await expect(destination).toBeVisible({ timeout: 30_000 });
      await expect(destination).toBeFocused();
      const token = await assertReturnTokenIsPrivate(page, {
        originSearch: "?eventType=wedding&status=draft"
      });
      expect(token.origin).toMatchObject({
        routeId: "quote-list",
        pathname: "/app/quotes",
        search: "?eventType=wedding&status=draft"
      });
      expect(token.destination).toEqual({
        routeId: "quote-detail",
        pathname: `/app/quotes/${TARGET_QUOTE_ID}`,
        search: ""
      });
      const destinationEntry = await readHistoryEntry(page);
      await expectExactDestinationEntry(page, destinationEntry, sourceEntry);
      await expectNoHighImpactAxeViolations(page);
      const back = page.locator('[data-ambient-action-id="back-to-opportunities"]');
      await back.focus();
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(/\/app\/quotes\?eventType=wedding&status=draft$/u);
      const restoredAction = page.locator(
        `[data-opportunity-id="${TARGET_QUOTE_ID}"] [data-ambient-action-id="${actionId}"]`
      );
      await expect(disclosure).toHaveAttribute("open", "");
      await expect(readBoundary).toHaveAttribute("open", "");
      await expect(administration).toHaveAttribute("open", "");
      await expect(administration.getByLabel("Search quotes")).toHaveValue(OPPORTUNITY_QUERY);
      await expect(administration.getByLabel("Event type")).toHaveValue("wedding");
      await expect(administration.getByLabel("Quote status")).toHaveValue("draft");
      expect(await visibleIds(stream.locator("[data-opportunity-id]"), "data-opportunity-id"))
        .toEqual(sourceOrder);
      await expectRestored(page, sourceEntry, restoredAction, scrollY);
      await expectSourceQuality(page, stream, ".ambient-opportunities");
      expect(await readBusinessState(page)).toEqual(businessBefore);
      await capture(page, `opportunities-restored-${viewport.width}`);

      await page.goForward();
      await expect(destination).toBeVisible();
      await expect(destination).toBeFocused();
      await expectExactDestinationEntry(page, destinationEntry, sourceEntry);
      await page.goBack();
      await expect(page).toHaveURL(/\/app\/quotes\?eventType=wedding&status=draft$/u);
      await expect(disclosure).toHaveAttribute("open", "");
      await expect(readBoundary).toHaveAttribute("open", "");
      await expect(administration).toHaveAttribute("open", "");
      await expect(administration.getByLabel("Search quotes")).toHaveValue(OPPORTUNITY_QUERY);
      expect(await visibleIds(stream.locator("[data-opportunity-id]"), "data-opportunity-id"))
        .toEqual(sourceOrder);
      await expectRestored(page, sourceEntry, restoredAction, scrollY);
      expect(await readBusinessState(page)).toEqual(businessBefore);
    });

    test(`Clients restores safe filters and session search at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const clients = await gotoWorkspace(page, "/app/customers", ".ambient-clients");
      const clientId = viewport.width === 768 ? PAGINATED_CLIENT_ID : TARGET_CLIENT_ID;
      const businessBefore = await readBusinessState(page);
      const filter = clients.getByLabel("Filter clients");
      await filter.selectOption("upcoming");
      await expect(page).toHaveURL(/\/app\/customers\?view=upcoming$/u);
      const search = clients.getByPlaceholder("Search clients");
      await search.fill(PRIVATE_QUERY);
      await search.press("Enter");
      let firstPageOrder = [];
      if (viewport.width === 768) {
        const pagination = clients.getByRole("navigation", { name: "Client pages" });
        await expect(pagination.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
        firstPageOrder = await visibleIds(clients.locator("[data-client-id]"), "data-client-id");
        expect(firstPageOrder.length).toBeGreaterThan(1);
        await pagination.getByRole("button", { name: "Next", exact: true }).click();
        await expect(pagination.getByRole("button", { name: "Previous", exact: true })).toBeEnabled();
      }
      const row = clients.locator(`[data-client-id="${clientId}"]`).first();
      await expect(row).toBeVisible();
      const about = clients.locator('[data-client-disclosure="about"]');
      await about.locator("summary").click();
      const sourceOrder = await visibleIds(clients.locator("[data-client-id]"), "data-client-id");
      expect(sourceOrder.length).toBeGreaterThan(1);
      await settleVisualResources(page);
      await row.scrollIntoViewIfNeeded();
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThan(100);
      const action = row.locator(".ambient-client__primary");
      const actionId = await action.getAttribute("data-ambient-action-id");
      await action.focus();
      const sourceEntry = await readHistoryEntry(page);

      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/app/customers/${clientId}$`, "u"));
      const destination = page.locator(`.ambient-client-overview[data-client-id="${clientId}"]`);
      await expect(destination).toBeVisible({ timeout: 30_000 });
      await expect(destination.locator("#ambient-client-overview-title")).toBeFocused();
      const token = await assertReturnTokenIsPrivate(page, { originSearch: "?view=upcoming" });
      expect(token.origin).toMatchObject({
        routeId: "customer-list",
        pathname: "/app/customers",
        search: "?view=upcoming"
      });
      expect(token.destination).toEqual({
        routeId: "customer-detail",
        pathname: `/app/customers/${clientId}`,
        search: ""
      });
      const destinationEntry = await readHistoryEntry(page);
      await expectExactDestinationEntry(page, destinationEntry, sourceEntry);
      await expectNoHighImpactAxeViolations(page);
      const back = page.getByRole("button", { name: "Back to Clients", exact: true });
      await back.focus();
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(/\/app\/customers\?view=upcoming$/u);
      const restoredClients = page.locator(".ambient-clients");
      const restoredAction = restoredClients.locator(
        `[data-client-id="${clientId}"] [data-ambient-action-id="${actionId}"]`
      ).first();
      await expect(restoredClients.getByPlaceholder("Search clients")).toHaveValue(PRIVATE_QUERY);
      await expect(restoredClients.getByLabel("Filter clients")).toHaveValue("upcoming");
      await expect(restoredClients.locator('[data-client-disclosure="about"]')).toHaveAttribute("open", "");
      expect(await visibleIds(restoredClients.locator("[data-client-id]"), "data-client-id"))
        .toEqual(sourceOrder);
      await expectRestored(page, sourceEntry, restoredAction, scrollY);
      if (viewport.width === 768) {
        await expect(restoredClients.getByRole("button", { name: "Previous", exact: true }))
          .toBeEnabled();
      }
      await expectSourceQuality(page, restoredClients, ".ambient-clients");
      expect(await readBusinessState(page)).toEqual(businessBefore);
      await capture(page, `clients-restored-${viewport.width}`);

      await page.goForward();
      await expect(destination).toBeVisible();
      await expect(destination.locator("#ambient-client-overview-title")).toBeFocused();
      await expectExactDestinationEntry(page, destinationEntry, sourceEntry);
      await page.goBack();
      await expect(page).toHaveURL(/\/app\/customers\?view=upcoming$/u);
      await expect(restoredClients.getByPlaceholder("Search clients")).toHaveValue(PRIVATE_QUERY);
      await expect(restoredClients.getByLabel("Filter clients")).toHaveValue("upcoming");
      await expect(restoredClients.locator('[data-client-disclosure="about"]')).toHaveAttribute("open", "");
      expect(await visibleIds(restoredClients.locator("[data-client-id]"), "data-client-id"))
        .toEqual(sourceOrder);
      await expectRestored(page, sourceEntry, restoredAction, scrollY);
      expect(await readBusinessState(page)).toEqual(businessBefore);
      if (viewport.width === 768) {
        const pagination = restoredClients.getByRole("navigation", { name: "Client pages" });
        await pagination.getByRole("button", { name: "Previous", exact: true }).click();
        await expect.poll(() => visibleIds(
          restoredClients.locator("[data-client-id]"),
          "data-client-id"
        )).toEqual(firstPageOrder);
        await expect(pagination.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
        await expect(pagination.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
        expect(await readBusinessState(page)).toEqual(businessBefore);
      }
    });

    test(`Library makes editor Back and Forward an exact round trip at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const library = await gotoWorkspace(page, "/app/catalog", ".ambient-library");
      const businessBefore = await readBusinessState(page);
      const templates = library.locator(".ambient-library__template-disclosure");
      await templates.locator("summary").click();
      const boundary = library.locator(".ambient-library__boundary");
      await boundary.locator("summary").click();
      const record = library.locator(
        '[data-library-record-kind="event-template"][data-library-record-id="wedding"]'
      );
      const action = record.locator("[data-library-action-id]");
      await settleVisualResources(page);
      await action.scrollIntoViewIfNeeded();
      const actionId = await action.getAttribute("data-library-action-id");
      const sourceOrder = await visibleIds(
        library.locator('[data-library-record-kind="event-template"][data-library-record-id]'),
        "data-library-record-id"
      );
      expect(sourceOrder).toContain("wedding");
      await action.focus();
      const scrollY = await setStableSourceScroll(page);
      await expect(action).toBeInViewport();
      const sourceEntry = await readHistoryEntry(page);

      await page.keyboard.press("Enter");
      const editor = page.locator('[data-ambient-library-state="editing"]');
      await expect(editor).toBeVisible();
      const weddingEditor = editor.locator(
        '[data-library-record-kind="event-template"][data-library-record-id="wedding"]'
      );
      await expect(weddingEditor.locator('[data-template-field="name"]')).toHaveValue("Wedding");
      await expect(weddingEditor.locator('[data-template-field="summary"]'))
        .toHaveAttribute("aria-expanded", "true");
      await expect(editor.locator("[data-library-acknowledgement]"))
        .toBeFocused();
      const token = await assertReturnTokenIsPrivate(page);
      expect(token.origin).toMatchObject({
        routeId: "catalog",
        pathname: "/app/catalog",
        search: ""
      });
      expect(token.destination).toEqual({
        routeId: "catalog",
        pathname: "/app/catalog",
        search: ""
      });
      const destinationEntry = await readHistoryEntry(page);
      await expectExactDestinationEntry(page, destinationEntry, sourceEntry);
      await expectNoHighImpactAxeViolations(page);
      const back = page.getByRole("button", { name: "Back to Library", exact: true });
      await back.focus();
      await page.keyboard.press("Enter");

      await expect(page.locator("#ambient-library-title")).toBeVisible();
      const restoredLibrary = page.locator(".ambient-library");
      const restoredAction = restoredLibrary.locator(`[data-library-action-id="${actionId}"]`);
      await expect(restoredLibrary.locator(".ambient-library__template-disclosure"))
        .toHaveAttribute("open", "");
      await expect(restoredLibrary.locator(".ambient-library__boundary")).toHaveAttribute("open", "");
      expect(await visibleIds(
        restoredLibrary.locator('[data-library-record-kind="event-template"][data-library-record-id]'),
        "data-library-record-id"
      )).toEqual(sourceOrder);
      await expectRestored(page, sourceEntry, restoredAction, scrollY);
      await expectSourceQuality(page, restoredLibrary, ".ambient-library");
      expect(await readBusinessState(page)).toEqual(businessBefore);
      await capture(page, `library-restored-${viewport.width}`);

      await page.goForward();
      await expect(editor).toBeVisible();
      await expect(weddingEditor.locator('[data-template-field="name"]')).toHaveValue("Wedding");
      await expect(weddingEditor.locator('[data-template-field="summary"]'))
        .toHaveAttribute("aria-expanded", "true");
      await expectExactDestinationEntry(page, destinationEntry, sourceEntry);
      await page.goBack();
      await expect(restoredLibrary.locator(".ambient-library__template-disclosure"))
        .toHaveAttribute("open", "");
      await expect(restoredLibrary.locator(".ambient-library__boundary")).toHaveAttribute("open", "");
      expect(await visibleIds(
        restoredLibrary.locator('[data-library-record-kind="event-template"][data-library-record-id]'),
        "data-library-record-id"
      )).toEqual(sourceOrder);
      await expectRestored(page, sourceEntry, restoredAction, scrollY);
      expect(await readBusinessState(page)).toEqual(businessBefore);
    });
  }

  test("Client 360 restores its exact opportunity action, tab, disclosure, and scroll", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    const client = await gotoWorkspace(
      page,
      `/app/customers/${TARGET_CLIENT_ID}`,
      `.ambient-client-overview[data-client-id="${TARGET_CLIENT_ID}"]`
    );
    const businessBefore = await readBusinessState(page);
    const record = page.locator("details.ambient-client-overview__record");
    await record.locator(":scope > summary").click();
    const eventsTab = record.getByRole("tab", { name: "Events", exact: true });
    await eventsTab.focus();
    await page.keyboard.press("Enter");
    await expect(eventsTab).toHaveAttribute("aria-selected", "true");

    const actionId = `review-client-opportunity:${CLIENT_OPPORTUNITY_ID}`;
    const action = client.locator(
      `[data-opportunity-id="${CLIENT_OPPORTUNITY_ID}"] [data-ambient-action-id="${actionId}"]`
    );
    await expect(action).toBeVisible();
    await action.focus();
    const sourceScrollY = await setStableSourceScroll(page);
    await expect(action).toBeInViewport();
    const sourceEntry = await readHistoryEntry(page);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/app/quotes/${CLIENT_OPPORTUNITY_ID}$`, "u"));
    const destination = page.locator(
      `[data-quote-id="${CLIENT_OPPORTUNITY_ID}"].ambient-living-opportunity`
    );
    await expect(destination).toBeVisible({ timeout: 30_000 });
    await expect(destination).toBeFocused();
    const token = await assertReturnTokenIsPrivate(page);
    expect(token.origin).toMatchObject({
      routeId: "customer-detail",
      pathname: `/app/customers/${TARGET_CLIENT_ID}`,
      search: ""
    });
    expect(token.destination).toEqual({
      routeId: "quote-detail",
      pathname: `/app/quotes/${CLIENT_OPPORTUNITY_ID}`,
      search: ""
    });
    const destinationEntry = await readHistoryEntry(page);
    await expectExactDestinationEntry(page, destinationEntry, sourceEntry);
    await expectNoHighImpactAxeViolations(page);

    const back = page.locator('[data-ambient-action-id="back-to-opportunities"]');
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/app/customers/${TARGET_CLIENT_ID}$`, "u"));
    const restoredClient = page.locator(
      `.ambient-client-overview[data-client-id="${TARGET_CLIENT_ID}"]`
    );
    const restoredRecord = page.locator("details.ambient-client-overview__record");
    const restoredEventsTab = restoredRecord.getByRole("tab", { name: "Events", exact: true });
    const restoredAction = restoredClient.locator(
      `[data-opportunity-id="${CLIENT_OPPORTUNITY_ID}"] [data-ambient-action-id="${actionId}"]`
    );
    await expect(restoredRecord).toHaveAttribute("open", "");
    await expect(restoredEventsTab).toHaveAttribute("aria-selected", "true");
    await expectRestored(page, sourceEntry, restoredAction, sourceScrollY);
    expect(await readBusinessState(page)).toEqual(businessBefore);

    await page.goForward();
    await expect(destination).toBeVisible();
    await expect(destination).toBeFocused();
    await expectExactDestinationEntry(page, destinationEntry, sourceEntry);
    await page.goBack();
    await expect(restoredRecord).toHaveAttribute("open", "");
    await expect(restoredEventsTab).toHaveAttribute("aria-selected", "true");
    await expectRestored(page, sourceEntry, restoredAction, sourceScrollY);
    expect(await readBusinessState(page)).toEqual(businessBefore);
  });

  test("nested contextual Library editor returns to its named opportunity without flattening history", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    const quotePath = `/app/quotes/${TARGET_QUOTE_ID}`;
    const opportunity = await gotoWorkspace(
      page,
      quotePath,
      `[data-quote-id="${TARGET_QUOTE_ID}"].ambient-living-opportunity`
    );
    const businessBefore = await readBusinessState(page);
    const quoteEntry = await readHistoryEntry(page);
    const quoteScrollY = await page.evaluate(() => window.scrollY);
    const { panel, trigger } = await openQuickUpdates(page);
    const openLibrary = panel.getByRole("button", { name: "Open full Library" });
    await openLibrary.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/app\/catalog$/u);
    const library = page.locator('.ambient-library[data-library-context="opportunity"]');
    await expect(library).toBeVisible({ timeout: 30_000 });
    const returnToOpportunity = library.locator('[data-library-return-context="Event 18"]');
    await expect(returnToOpportunity).toHaveAccessibleName(/Return to Event 18/u);
    const catalogEntry = await readHistoryEntry(page);
    await expectExactDestinationEntry(page, catalogEntry, quoteEntry);
    const opportunityToken = await assertReturnTokenIsPrivate(page);
    expect(opportunityToken.origin).toMatchObject({
      routeId: "quote-detail",
      pathname: quotePath,
      search: ""
    });
    expect(opportunityToken.destination).toEqual({
      routeId: "catalog",
      pathname: "/app/catalog",
      search: ""
    });

    const templates = library.locator(".ambient-library__template-disclosure");
    await templates.locator(":scope > summary").click();
    const weddingAction = library.locator(
      '[data-library-record-kind="event-template"][data-library-record-id="wedding"] [data-library-action-id]'
    );
    const weddingActionId = await weddingAction.getAttribute("data-library-action-id");
    await weddingAction.focus();
    await page.keyboard.press("Enter");
    const editor = page.locator('[data-ambient-library-state="editing"]');
    await expect(editor).toBeVisible();
    const weddingEditor = editor.locator(
      '[data-library-record-kind="event-template"][data-library-record-id="wedding"]'
    );
    await expect(weddingEditor.locator('[data-template-field="name"]')).toHaveValue("Wedding");
    await expect(weddingEditor.locator('[data-template-field="summary"]'))
      .toHaveAttribute("aria-expanded", "true");
    await expect(editor.locator('[data-library-return-context="Event 18"]'))
      .toHaveAccessibleName(/Return to Event 18/u);
    const editorEntry = await readHistoryEntry(page);
    await expectExactDestinationEntry(page, editorEntry, catalogEntry);
    const editorToken = await assertReturnTokenIsPrivate(page);
    expect(editorToken.origin).toMatchObject({
      routeId: "catalog",
      pathname: "/app/catalog",
      search: ""
    });
    expect(editorToken.destination).toEqual({
      routeId: "catalog",
      pathname: "/app/catalog",
      search: ""
    });

    const nestedReturn = editor.locator('[data-library-return-context="Event 18"]');
    await nestedReturn.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${quotePath}$`, "u"));
    await expect(opportunity).toBeVisible();
    await expectFocusedWithDiagnostics(
      page,
      trigger,
      "the named nested return must restore the exact Quick Updates trigger"
    );
    await expect(page.locator('[data-workspace-return-state="restored"]')).toBeVisible();
    const returnedQuoteEntry = await readHistoryEntry(page);
    expect(returnedQuoteEntry.entryId).toBe(quoteEntry.entryId);
    expect(returnedQuoteEntry.position).toBe(quoteEntry.position);
    expect(returnedQuoteEntry.length).toBe(quoteEntry.length + 2);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - quoteScrollY)).toBeLessThanOrEqual(8);
    expect(await readBusinessState(page)).toEqual(businessBefore);

    await page.goForward();
    await expect(library).toBeVisible();
    await expect(templates).toHaveAttribute("open", "");
    await expect(library.locator(
      `[data-library-record-id="wedding"] [data-library-action-id="${weddingActionId}"]`
    )).toBeFocused();
    expect((await readHistoryEntry(page)).entryId).toBe(catalogEntry.entryId);
    await page.goForward();
    await expect(editor).toBeVisible();
    await expect(weddingEditor.locator('[data-template-field="name"]')).toHaveValue("Wedding");
    await expect(weddingEditor.locator('[data-template-field="summary"]'))
      .toHaveAttribute("aria-expanded", "true");
    expect((await readHistoryEntry(page)).entryId).toBe(editorEntry.entryId);
    await expect(editor.locator('[data-library-return-context="Event 18"]'))
      .toHaveAccessibleName(/Return to Event 18/u);
    expect(await readBusinessState(page)).toEqual(businessBefore);
  });

  test("delayed Quote return stays restoring until the exact source read settles", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const stream = await gotoWorkspace(page, "/app/quotes", ".ambient-opportunities");
    const businessBefore = await readBusinessState(page);
    const action = stream.locator(
      `[data-opportunity-id="${TARGET_QUOTE_ID}"] .ambient-opportunity__primary-action`
    );
    await action.scrollIntoViewIfNeeded();
    await action.focus();
    const sourceScrollY = await page.evaluate(() => window.scrollY);
    const actionId = await action.getAttribute("data-ambient-action-id");
    const sourceEntry = await readHistoryEntry(page);

    await page.keyboard.press("Enter");
    const destination = page.locator(
      `[data-quote-id="${TARGET_QUOTE_ID}"].ambient-living-opportunity`
    );
    await expect(destination).toBeVisible({ timeout: 30_000 });
    const destinationEntry = await readHistoryEntry(page);
    await expectExactDestinationEntry(page, destinationEntry, sourceEntry);
    await page.evaluate(() => {
      globalThis.__quotePilotE2eDelays = {
        ...(globalThis.__quotePilotE2eDelays || {}),
        quoteHistoryMs: 3_000
      };
    });

    const startedAt = Date.now();
    const back = page.locator('[data-ambient-action-id="back-to-opportunities"]');
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/quotes$/u);
    const restoring = page.locator('[data-workspace-return-state="restoring"]');
    const restoredAction = page.locator(
      `[data-opportunity-id="${TARGET_QUOTE_ID}"] [data-ambient-action-id="${actionId}"]`
    );
    await expect(restoring).toBeAttached();
    await expect(restoring).toHaveText("Restoring your previous place.");
    await expect(restoredAction).not.toBeFocused();
    await page.waitForTimeout(2_200);
    await expect(restoring).toBeAttached();
    await expect(restoring).toHaveText("Restoring your previous place.");
    await expect(restoredAction).not.toBeFocused();
    await expectRestored(page, sourceEntry, restoredAction, sourceScrollY);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2_800);
    expect(await readBusinessState(page)).toEqual(businessBefore);
  });

  test("reload retains allowlisted client view only and clears free text", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const clients = await gotoWorkspace(page, "/app/customers", ".ambient-clients");
    await clients.getByLabel("Filter clients").selectOption("upcoming");
    const persistedBefore = await readBusinessState(page);
    await clients.getByPlaceholder("Search clients").fill(PRIVATE_QUERY);
    await clients.getByPlaceholder("Search clients").press("Enter");
    await expect(clients.getByPlaceholder("Search clients")).toHaveValue(PRIVATE_QUERY);

    const serializedBefore = await page.evaluate((seedMarker) => JSON.stringify({
      url: location.href,
      history: history.state,
      local: Object.fromEntries(Object.entries(localStorage).filter(([key]) => (
        !key.startsWith("quoteWizard.")
      ))),
      session: Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key !== seedMarker))
    }), TEST_SEED_MARKER);
    expect(serializedBefore).not.toContain(PRIVATE_QUERY);
    expect(serializedBefore).not.toContain(PRIVATE_CLIENT_EMAIL);
    await page.reload();

    const restoredClients = page.locator(".ambient-clients");
    await expect(restoredClients).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/app\/customers\?view=upcoming$/u);
    await expect(restoredClients.getByLabel("Filter clients")).toHaveValue("upcoming");
    await expect(restoredClients.getByPlaceholder("Search clients")).toHaveValue("");
    await expect(restoredClients.locator("[data-client-search-boundary]"))
      .toContainText("clears after a reload");
    expect(await readBusinessState(page)).toEqual(persistedBefore);
    await expectNoHighImpactAxeViolations(page);
  });

  test("reload retains allowlisted Opportunity filters and clears free text", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await gotoWorkspace(page, "/app/quotes", ".ambient-opportunities");
    const administration = page.locator('[data-quote-administration="true"]');
    await administration.locator(":scope > summary").click();
    await administration.getByLabel("Search quotes").fill(OPPORTUNITY_QUERY);
    await administration.getByLabel("Event type").selectOption("wedding");
    await administration.getByLabel("Quote status").selectOption("draft");
    await expect(page).toHaveURL(/\/app\/quotes\?eventType=wedding&status=draft$/u);
    const persistedBefore = await readBusinessState(page);

    await page.reload();

    await expect(page.locator(".ambient-opportunities")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/app\/quotes\?eventType=wedding&status=draft$/u);
    await administration.locator(":scope > summary").click();
    await expect(administration.getByLabel("Search quotes")).toHaveValue("");
    await expect(administration.getByLabel("Event type")).toHaveValue("wedding");
    await expect(administration.getByLabel("Quote status")).toHaveValue("draft");
    expect(await readBusinessState(page)).toEqual(persistedBefore);
    await expectAxeClean(page, ".ambient-opportunities");
  });

  test("foreign return token fails closed to canonical Opportunities without substitution", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const stream = await gotoWorkspace(page, "/app/quotes", ".ambient-opportunities");
    const persistedBefore = await readBusinessState(page);
    const action = stream.locator(
      `[data-opportunity-id="${TARGET_QUOTE_ID}"] .ambient-opportunity__primary-action`
    );
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`[data-quote-id="${TARGET_QUOTE_ID}"].ambient-living-opportunity`))
      .toBeVisible({ timeout: 30_000 });
    await assertReturnTokenIsPrivate(page);

    await page.evaluate(() => {
      const nextState = structuredClone(history.state);
      nextState.workspaceReturnContext.organizationId = "foreign-org";
      history.replaceState(nextState, "", location.href);
      dispatchEvent(new PopStateEvent("popstate", { state: nextState }));
    });
    await expect.poll(() => page.evaluate(() => (
      history.state?.workspaceReturnContext?.organizationId
    ))).toBe("foreign-org");
    const back = page.locator('[data-ambient-action-id="back-to-opportunities"]');
    await back.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/app\/quotes$/u);
    const recovery = page.locator('[data-workspace-return-state="recovery"]');
    await expect(recovery).toHaveCount(1);
    await expect(recovery).toContainText("previous place is no longer available");
    await expect(page.locator("#ambient-opportunities-heading")).toBeFocused();
    expect(await page.evaluate(() => (
      document.activeElement?.closest?.("[data-opportunity-id]")?.dataset.opportunityId || ""
    ))).toBe("");
    await expectAxeClean(page, ".ambient-opportunities");
    expect(await readBusinessState(page)).toEqual(persistedBefore);
  });

  test("reloaded destination with no runtime context recovers to canonical Opportunities", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const stream = await gotoWorkspace(page, "/app/quotes", ".ambient-opportunities");
    const persistedBefore = await readBusinessState(page);
    const action = stream.locator(
      `[data-opportunity-id="${TARGET_QUOTE_ID}"] .ambient-opportunity__primary-action`
    );
    await action.focus();
    await page.keyboard.press("Enter");
    const destination = page.locator(`[data-quote-id="${TARGET_QUOTE_ID}"].ambient-living-opportunity`);
    await expect(destination).toBeVisible({ timeout: 30_000 });
    await assertReturnTokenIsPrivate(page);

    await page.reload();
    await expect(destination).toBeVisible({ timeout: 30_000 });
    const back = page.locator('[data-ambient-action-id="back-to-opportunities"]');
    await back.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/app\/quotes$/u);
    const recovery = page.locator('[data-workspace-return-state="recovery"]');
    await expect(recovery).toHaveCount(1);
    await expect(recovery).toContainText("previous place is no longer available");
    await expect(page.locator("#ambient-opportunities-heading")).toBeFocused();
    expect(await page.evaluate(() => (
      document.activeElement?.closest?.("[data-opportunity-id]")?.dataset.opportunityId || ""
    ))).toBe("");
    await expectAxeClean(page, ".ambient-opportunities");
    expect(await readBusinessState(page)).toEqual(persistedBefore);
  });

  test("dirty Library editor guards explicit and native Back before confirmed discard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const library = await gotoWorkspace(page, "/app/catalog", ".ambient-library");
    const businessBefore = await readBusinessState(page);
    await library.locator(".ambient-library__template-disclosure > summary").click();
    const sourceAction = library.locator(
      '[data-library-record-kind="event-template"][data-library-record-id="wedding"] [data-library-action-id]'
    );
    await sourceAction.scrollIntoViewIfNeeded();
    const sourceScrollY = await page.evaluate(() => window.scrollY);
    const sourceActionId = await sourceAction.getAttribute("data-library-action-id");
    const sourceEntry = await readHistoryEntry(page);
    await sourceAction.click();
    const editor = page.locator('[data-ambient-library-state="editing"]');
    await expect(editor).toBeVisible();
    const name = editor.locator(
      '[data-library-record-kind="event-template"][data-library-record-id="wedding"] [data-template-field="name"]'
    );
    const privateDraft = "Wedding confidential browser draft";
    await name.fill(privateDraft);
    await expect.poll(() => beforeUnloadIsProtected(page)).toBe(true);
    const editorEntry = await readHistoryEntry(page);
    await expectExactDestinationEntry(page, editorEntry, sourceEntry);
    const explicitBack = page.getByRole("button", { name: "Back to Library", exact: true });
    const backBox = await explicitBack.boundingBox();
    expect(backBox?.width || 0).toBeGreaterThanOrEqual(44);
    expect(backBox?.height || 0).toBeGreaterThanOrEqual(44);

    await explicitBack.focus();
    await runDiscardGuard(page, () => page.keyboard.press("Enter"), { accept: false });
    await expect(editor).toBeVisible();
    await expect(name).toHaveValue(privateDraft);
    expect((await readHistoryEntry(page)).entryId).toBe(editorEntry.entryId);

    await runDiscardGuard(page, () => page.goBack(), { accept: false });
    await expect(editor).toBeVisible();
    await expect(name).toHaveValue(privateDraft);
    expect((await readHistoryEntry(page)).entryId).toBe(editorEntry.entryId);
    await assertReturnTokenIsPrivate(page);
    expect(JSON.stringify((await readHistoryEntry(page)).state)).not.toContain(privateDraft);
    await expectAxeClean(page);

    await runDiscardGuard(page, () => page.goBack(), { accept: true });
    await expect(page.locator("#ambient-library-title")).toBeVisible();
    await expect.poll(() => beforeUnloadIsProtected(page)).toBe(false);
    const restoredAction = page.locator(`[data-library-action-id="${sourceActionId}"]`);
    await expectRestored(page, sourceEntry, restoredAction, sourceScrollY);
    expect(await readBusinessState(page)).toEqual(businessBefore);

    await page.goForward();
    await expect(page.locator('[data-ambient-library-state="editing"]')).toBeVisible();
    await expect(page.locator(
      '[data-library-record-kind="event-template"][data-library-record-id="wedding"] [data-template-field="name"]'
    )).toHaveValue("Wedding");
    await expectExactDestinationEntry(page, editorEntry, sourceEntry);
    expect(await readBusinessState(page)).toEqual(businessBefore);
  });
});
