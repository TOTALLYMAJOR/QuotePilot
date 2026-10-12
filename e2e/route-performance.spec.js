import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { PROFILE, ROUTES, installRouteFixture } from "../scripts/route-performance-metrics.mjs";
import { EMULATORS, QUOTE as fixture, READ_ONLY_FUNCTIONS, STAFF } from "../scripts/route-performance-fixture.mjs";

const runDirectory = process.env.ROUTE_PERF_RUN_DIR;

for (const route of ROUTES) {
  test(`${route.id}: cold production-preview arrival`, async ({ page, request, baseURL, browser }, testInfo) => {
    const identity = JSON.parse(await readFile(`${runDirectory}/identity.json`, "utf8"));
    const marker = await request.get("/route-performance-build.json");
    expect(marker.ok()).toBe(true);
    expect(await marker.json()).toEqual(identity);
    const errors = [];
    const externalRequests = [];
    const blockedFontOrigins = new Set(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
    await page.route("**/*", (intercept) => {
      const url = new URL(intercept.request().url());
      const origin = url.origin;
      if (blockedFontOrigins.has(origin)) return intercept.abort();
      if (origin === "http://127.0.0.1:5998"
        && !READ_ONLY_FUNCTIONS.some((name) => url.pathname === `/${EMULATORS.projectId}/us-central1/${name}`)) return intercept.abort();
      if (origin !== baseURL && !identity.emulatorOrigins.includes(origin)) {
        externalRequests.push(origin);
        return intercept.abort();
      }
      return intercept.continue();
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      if (/^https?:/.test(req.url())) {
        const origin = new URL(req.url()).origin;
        if (origin !== baseURL && !identity.emulatorOrigins.includes(origin) && !blockedFontOrigins.has(origin)) externalRequests.push(origin);
      }
    });
    let sample = { routeId: route.id, path: route.path, run: testInfo.repeatEachIndex, browserVersion: browser.version(), status: "BLOCKED" };
    let collectDiagnostic = null;
    try {
      // Authenticate before measurement. The measured document reload still has a
      // cold HTTP cache, fresh JS state and real persisted emulator credentials.
      await page.goto("/app");
      await expect(page.getByRole("heading", { name: "Staff Sign In" })).toBeVisible();
      await page.getByLabel(/^Email$/i).fill(STAFF.email);
      await page.getByLabel(/^Password$/i).fill(STAFF.password);
      await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
      const onboarding = page.getByRole("button", { name: "Explore the workspace" });
      // Fresh sign-in on the catalog-independent Now route settles at setup.
      // Complete the real prompt before measuring; the header can appear first.
      await expect(onboarding).toBeVisible();
      await onboarding.click();
      await expect(onboarding).toBeHidden();
      await expect(page.locator(".site-header")).toBeVisible();
      await page.addInitScript(installRouteFixture, { nowISO: PROFILE.nowISO });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpuSlowdown });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false, latency: PROFILE.latencyMs,
        downloadThroughput: PROFILE.downloadBytesPerSecond, uploadThroughput: PROFILE.uploadBytesPerSecond
      });
      if (process.env.ROUTE_PERF_DIAGNOSTIC === "1") {
        const requests = new Map();
        cdp.on("Network.requestWillBeSent", ({ requestId, request, timestamp }) => {
          const url = new URL(request.url);
          requests.set(requestId, { path: `${url.origin}${url.pathname}`, method: request.method, start: timestamp });
        });
        cdp.on("Network.responseReceived", ({ requestId, response, timestamp }) => {
          const row = requests.get(requestId);
          if (row) Object.assign(row, { response: timestamp, status: response.status, timing: response.timing });
        });
        cdp.on("Network.loadingFinished", ({ requestId, timestamp, encodedDataLength }) => {
          const row = requests.get(requestId);
          if (row) Object.assign(row, { finish: timestamp, encodedDataLength });
        });
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
        collectDiagnostic = async () => {
          const { profile } = await cdp.send("Profiler.stop");
          const timing = await page.evaluate(() => ({
            timeOrigin: performance.timeOrigin,
            marks: performance.getEntriesByType("mark").map((entry) => entry.toJSON()),
            resources: performance.getEntriesByType("resource").map((entry) => ({
              path: `${new URL(entry.name).origin}${new URL(entry.name).pathname}`,
              start: entry.startTime, duration: entry.duration, responseEnd: entry.responseEnd,
              encodedBodySize: entry.encodedBodySize
            }))
          }));
          await writeFile(`${runDirectory}/${route.id}-${testInfo.repeatEachIndex}-diagnostic.json`, JSON.stringify({
            evidenceClass: "diagnostic-only-not-budget-eligible", profile, timing, requests: [...requests.values()]
          }, null, 2));
        };
      }
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(`${baseURL}${route.path}`);
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
        const assets = performance.getEntriesByType("resource").filter((entry) => new URL(entry.name).origin === location.origin
          && entry.responseEnd <= (supplemental?.startTime ?? Infinity));
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
      if (route.id === "now") {
        await expect(page.getByTestId("now-daily-brief")).toBeVisible();
        await expect(page.locator(".ambient-now__priorities")).toBeVisible();
        await expect(page.locator('[data-now-state="unavailable"]')).toHaveCount(0);
      }
      if (route.id === "clients") await expect(page.getByRole("heading", { name: fixture.customer.name, exact: true })).toBeVisible();
      if (route.id === "inventory") {
        const evidence = page.getByRole("region", { name: "Ingredient evidence table" });
        await expect(evidence).toBeVisible();
        await expect(evidence).toContainText("Chicken");
      }
      if (route.id === "quote-review") {
        const context = page.locator('[aria-label="Current saved quote context"]:visible');
        await expect(context).toContainText(fixture.quoteNumber);
        await expect(context).toContainText(fixture.activeVersionId);
        await expect(context).toContainText("Saved quote");
        await expect(page.getByRole("heading", { name: fixture.event.name, exact: true })).toBeVisible();
        const nextAction = page.locator("button.ambient-next-action[data-ambient-action-id]:visible");
        await expect(nextAction).toBeVisible();
        await expect(nextAction).toBeEnabled();
        await expect(nextAction).toHaveAttribute("data-ambient-action-id", /\S+/);
      }
      expect(externalRequests, "Fixed local profile must not use external services.").toEqual([]);
      expect(errors).toEqual([]);
      sample.status = collectDiagnostic ? "diagnostic-only" : "measured";
    } catch (error) {
      sample.reason = error.message;
      throw error;
    } finally {
      if (collectDiagnostic) await collectDiagnostic();
      sample.observedStages = await page.evaluate((routeId) => (window.__QUOTE_PILOT_ROUTE_PERFORMANCE__ || [])
        .filter((entry) => entry.routeId === routeId), route.id).catch(() => []);
      // Snapshot diagnostics after the last browser await so late events cannot
      // escape the receipt's fail-closed validation.
      sample.pageErrors = errors;
      sample.externalOrigins = [...new Set(externalRequests)];
      sample.fontPolicy = PROFILE.fonts;
      await writeFile(`${runDirectory}/${route.id}-${testInfo.repeatEachIndex}.json`, JSON.stringify(sample, null, 2));
    }
  });
}
