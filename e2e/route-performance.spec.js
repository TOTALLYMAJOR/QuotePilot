import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { PROFILE, ROUTES, installRouteFixture } from "../scripts/route-performance-metrics.mjs";

const runDirectory = process.env.ROUTE_PERF_RUN_DIR;
const fixture = {
  id: "route-perf-quote", organizationId: "e2e-org", customerId: "route-perf-customer",
  quoteNumber: "Q-PERF-001", status: "draft", activeVersionId: "v0001", latestVersionNumber: 1,
  createdAtISO: "2026-10-09T12:00:00.000Z", updatedAtISO: "2026-10-09T12:00:00.000Z",
  expiresAtISO: "2099-12-31T23:59:59.000Z",
  customer: { name: "Performance Fixture Customer", email: "performance@example.test", phone: "205-555-0100" },
  event: { name: "Performance Fixture Dinner", date: "2027-09-19", time: "18:00", hours: 4, guests: 64, venue: "Fixture Hall", servers: 4, chefs: 2 },
  selection: { eventTypeId: "wedding", packageId: "classic", packageName: "Classic", menuItems: [], addons: [], rentals: [] },
  totals: { total: 5000, deposit: 1500, serviceFee: 800, taxRateApplied: 0.08, serviceFeePctApplied: 0.2 }
};

for (const route of ROUTES) {
  test(`${route.id}: cold production-preview arrival`, async ({ page, request, baseURL, browser }, testInfo) => {
    const identity = JSON.parse(await readFile(`${runDirectory}/identity.json`, "utf8"));
    const marker = await request.get("/route-performance-build.json");
    expect(marker.ok()).toBe(true);
    expect(await marker.json()).toEqual(identity);
    const errors = [];
    const externalRequests = [];
    const blockedFontOrigins = new Set(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
    await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (intercept) => intercept.abort());
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      if (!req.url().startsWith(baseURL) && /^https?:/.test(req.url()) && !blockedFontOrigins.has(new URL(req.url()).origin)) externalRequests.push(new URL(req.url()).origin);
    });
    await page.addInitScript(installRouteFixture, { quote: fixture, nowISO: PROFILE.nowISO });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpuSlowdown });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false, latency: PROFILE.latencyMs,
      downloadThroughput: PROFILE.downloadBytesPerSecond, uploadThroughput: PROFILE.uploadBytesPerSecond
    });
    let sample = { routeId: route.id, path: route.path, run: testInfo.repeatEachIndex, browserVersion: browser.version(), status: "BLOCKED" };
    try {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(`${baseURL}${route.path}`);
      const setup = page.getByRole("button", { name: "Explore the workspace" });
      const requiredLibrary = page.getByRole("heading", { name: "Library is required to start this quote.", exact: true });
      await expect(setup.or(page.locator(".site-header")).or(requiredLibrary)).toBeVisible();
      if (await requiredLibrary.isVisible()) throw new Error("Quote review is BLOCKED: production-transform Library availability requires Firebase; development-only local catalog fallback is not production evidence.");
      if (await setup.isVisible()) await setup.click();
      await expect(page.locator(".site-header")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Staff Sign In" })).toHaveCount(0);
      await expect.poll(() => page.evaluate((routeId) => {
        const stages = (window.__QUOTE_PILOT_ROUTE_PERFORMANCE__ || []).filter((entry) => entry.routeId === routeId);
        return stages.some((entry) => entry.stage === "supplemental-complete");
      }, route.id)).toBe(true);
      sample = { ...sample, ...await page.evaluate((routeId) => {
        const starts = performance.getEntriesByType("mark").filter((entry) => entry.detail?.routeId === routeId && entry.detail.stage === "route-start");
        const start = starts.filter((entry) => entry.name.startsWith("quotepilot:navigation:")).at(-1);
        const matched = performance.getEntriesByType("mark").filter((entry) => entry.name.startsWith("quotepilot:navigation:")
          && entry.detail?.navigationId === start?.detail.navigationId);
        const core = matched.find((entry) => entry.detail.stage === "usable-core");
        const supplemental = matched.find((entry) => entry.detail.stage === "supplemental-complete");
        const assets = performance.getEntriesByType("resource").filter((entry) => entry.startTime <= (supplemental?.startTime ?? Infinity));
        const navigation = performance.getEntriesByType("navigation")[0];
        return {
          navigationId: start?.detail.navigationId || null,
          coreOutcome: core?.detail.outcome || null,
          supplementalOutcome: supplemental?.detail.outcome || null,
          usableCoreMs: core && start ? core.startTime - start.startTime : null,
          supplementalCompleteMs: supplemental && start ? supplemental.startTime - start.startTime : null,
          routeBytes: assets.reduce((sum, entry) => sum + entry.encodedBodySize, navigation?.encodedBodySize || 0),
          resources: assets.map((entry) => ({ path: new URL(entry.name).pathname, encodedBytes: entry.encodedBodySize })),
          documentToRouteStartMs: start?.startTime ?? null
        };
      }, route.id) };
      expect(sample.coreOutcome, "An error/unavailable surface cannot establish usable core.").toBe("ready");
      expect(["ready", "partial"]).toContain(sample.supplementalOutcome);
      expect(sample.usableCoreMs).toBeGreaterThanOrEqual(0);
      expect(sample.supplementalCompleteMs).toBeGreaterThanOrEqual(sample.usableCoreMs);
      expect(sample.routeBytes).toBeGreaterThan(0);
      expect(externalRequests, "Fixed local profile must not use external services.").toEqual([]);
      expect(errors).toEqual([]);
      if (route.id === "clients") await expect(page.getByRole("heading", { name: fixture.customer.name, exact: true })).toBeVisible();
      if (route.id === "inventory") await expect(page.getByRole("region", { name: "Ingredient evidence table" })).toBeVisible();
      if (route.id === "quote-review") await expect(page.locator("body")).toContainText(fixture.quoteNumber);
      sample.status = "measured";
    } catch (error) {
      sample.reason = route.id === "inventory"
        ? "Inventory success requires the existing tenant-authorized Firebase emulator fixture; local fallback has no Inventory authority."
        : error.message;
      throw error;
    } finally {
      sample.pageErrors = errors;
      sample.externalOrigins = [...new Set(externalRequests)];
      sample.fontPolicy = PROFILE.fonts;
      sample.observedStages = await page.evaluate((routeId) => (window.__QUOTE_PILOT_ROUTE_PERFORMANCE__ || [])
        .filter((entry) => entry.routeId === routeId), route.id).catch(() => []);
      await writeFile(`${runDirectory}/${route.id}-${testInfo.repeatEachIndex}.json`, JSON.stringify(sample, null, 2));
    }
  });
}
