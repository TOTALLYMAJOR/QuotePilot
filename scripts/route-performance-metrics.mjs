export const ROUTES = Object.freeze([
  { id: "now", path: "/app" },
  { id: "clients", path: "/app/customers/route-perf-customer" },
  { id: "inventory", path: "/app/inventory" },
  { id: "quote-review", path: "/app/quotes/route-perf-quote" }
]);

export const PROFILE = Object.freeze({
  id: "ambient-local-staff-v1",
  browser: "chromium",
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  cpuSlowdown: 4,
  latencyMs: 40,
  downloadBytesPerSecond: 200000,
  uploadBytesPerSecond: 93750,
  cache: "disabled",
  fonts: "google-font-services-blocked-system-fallback",
  timezone: "America/Chicago",
  nowISO: "2026-10-10T12:00:00.000Z",
  fixture: "synthetic-admin-local-quotes-no-firebase-v1",
  build: "production-ambient"
});

export const METRICS = ["routeBytes", "usableCoreMs", "supplementalCompleteMs"];
export const ceilingWithHeadroom = (value) => Math.ceil(value * 110 / 100);

// Serialize this initializer into the browser. Playwright's clock also mocks
// Performance, which must remain native for marks, resources and monotonic time.
export function installRouteFixture({ quote, nowISO }) {
  const NativeDate = Date;
  const fixedTime = NativeDate.parse(nowISO);
  function FixtureDate(...args) {
    if (!new.target) return new NativeDate(fixedTime).toString();
    return new NativeDate(...(args.length ? args : [fixedTime]));
  }
  Object.setPrototypeOf(FixtureDate, NativeDate);
  FixtureDate.prototype = NativeDate.prototype;
  FixtureDate.now = () => fixedTime;
  globalThis.Date = FixtureDate;
  let seed = 17;
  Math.random = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  localStorage.setItem("qp.workspaceSoundsEnabled", "false");
  localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
  localStorage.setItem("quoteWizard.quoteHistory", "[]");
}

export function percentile(values, fraction) {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Performance samples must be finite nonnegative numbers.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function summarizeRoutes(samples, { calibrate = false, budget } = {}) {
  const requiredRuns = calibrate ? 5 : 3;
  const routes = {};
  for (const route of ROUTES) {
    const rows = samples.filter((sample) => sample.routeId === route.id);
    const runIds = new Set(rows.map((row) => row.run));
    const invalid = rows.some((row) => row.status !== "measured"
      || row.coreOutcome !== "ready"
      || !["ready", "partial"].includes(row.supplementalOutcome)
      || !/^n[0-9a-z]+$/.test(row.navigationId || "")
      || METRICS.some((metric) => !Number.isFinite(row[metric]) || row[metric] < 0)
      || row.routeBytes === 0
      || row.usableCoreMs > row.supplementalCompleteMs);
    if (rows.length !== requiredRuns || runIds.size !== requiredRuns || invalid) {
      routes[route.id] = { status: "BLOCKED", reason: "Successful matched route stages and bytes are required for every run.", runs: rows };
      continue;
    }
    const measured = Object.fromEntries(METRICS.map((metric) => [
      metric, percentile(rows.map((row) => row[metric]), calibrate ? 0.75 : 0.5)
    ]));
    if (calibrate) {
      routes[route.id] = {
        status: "CALIBRATED", p75: measured,
        ceilings: Object.fromEntries(METRICS.map((metric) => [metric, ceilingWithHeadroom(measured[metric])])),
        runs: rows
      };
      continue;
    }
    const ceilings = budget?.routes?.[route.id]?.ceilings;
    const calibration = budget?.routes?.[route.id]?.p75;
    const validCalibration = budget?.profileId === PROFILE.id
      && budget?.calibration?.runCount === 5
      && /^[a-f0-9]{64}$/.test(budget?.calibration?.buildSha256 || "")
      && METRICS.every((metric) => Number.isFinite(calibration?.[metric])
        && calibration[metric] >= 0
        && ceilings?.[metric] === ceilingWithHeadroom(calibration[metric]));
    if (!validCalibration) {
      routes[route.id] = { status: "BLOCKED", reason: "A measured five-run calibration is required; no default ceilings.", median: measured, runs: rows };
      continue;
    }
    const failures = METRICS.filter((metric) => measured[metric] > ceilings[metric]);
    routes[route.id] = { status: failures.length ? "FAIL" : "PASS", median: measured, ceilings, failures, runs: rows };
  }
  return { status: Object.values(routes).every((route) => route.status === (calibrate ? "CALIBRATED" : "PASS")) ? "PASS" : "FAIL", routes };
}
