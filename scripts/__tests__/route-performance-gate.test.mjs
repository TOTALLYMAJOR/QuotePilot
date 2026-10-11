import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { PROFILE, ROUTES, installRouteFixture, percentile, summarizeRoutes } from "../route-performance-metrics.mjs";

test("route fixture drops inherited credentials and only exposes the three read handlers", async () => {
  const { isolatedToolEnvironment, isIsolatedFunctionSource, READ_ONLY_FUNCTIONS } = await import("../route-performance-fixture.mjs");
  assert.deepEqual(isolatedToolEnvironment({ PATH: "/bin", HOME: "/tmp/test-user", STRIPE_SECRET_KEY: "do-not-copy", GOOGLE_APPLICATION_CREDENTIALS: "/private/key", VITE_FIREBASE_PROJECT_ID: "live", DEBUG: "release" }, "/tmp/route-fixture"), {
    PATH: "/bin", HOME: "/tmp/test-user", DEBUG: "",
    XDG_CONFIG_HOME: "/tmp/route-fixture/config", CLOUDSDK_CONFIG: "/tmp/route-fixture/gcloud",
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/route-fixture/credentials-disabled.json",
    FIREBASE_CLI_DISABLE_AUTOUPDATE: "true"
  });
  assert.throws(() => isolatedToolEnvironment({}), /run directory/i);
  assert.deepEqual(READ_ONLY_FUNCTIONS, ["getRevenueAutopilotOperations", "getDecisionDebtSnapshot", "getRevenueAutopilotCustomerControls"]);
  assert.equal(isIsolatedFunctionSource("functions/index.js"), true);
  assert.equal(isIsolatedFunctionSource("functions/package.json"), true);
  assert.equal(isIsolatedFunctionSource("functions/commercialDependencyGraphCore.cjs"), true);
  assert.equal(isIsolatedFunctionSource("functions/data/starterCatalogPacks.json"), true);
  for (const file of ["functions/.env.tonicatering", "functions/.secret.local", "functions/key.json", "functions/node_modules/a.js", "functions/../private.js", "outside.js", "functions/debug.log"]) {
    assert.equal(isIsolatedFunctionSource(file), false, file);
  }
});

test("route fixture refuses any non-isolated emulator destination before writes", async () => {
  const { assertRouteFixtureScope } = await import("../route-performance-fixture.mjs");
  const safe = {
    GCLOUD_PROJECT: "demo-qp-routeperf",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9498",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8488"
  };
  assert.doesNotThrow(() => assertRouteFixtureScope(safe));
  for (const override of [
    { GCLOUD_PROJECT: "tonicatering" },
    { GCLOUD_PROJECT: "demo-other-work" },
    { FIREBASE_AUTH_EMULATOR_HOST: "" },
    { FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" },
    { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8383" }
  ]) assert.throws(() => assertRouteFixtureScope({ ...safe, ...override }), /isolated/i);
});

test("fixed fixture changes Date/random/data without replacing native Performance or timers", () => {
  const nativePerformance = { mark() {}, getEntriesByType() { return ["native-entry"]; } };
  const nativeTimer = () => {};
  const stored = new Map();
  const context = {
    performance: nativePerformance, setTimeout: nativeTimer,
    localStorage: { setItem: (key, value) => stored.set(key, value) },
    input: { quote: { id: "fixture" }, nowISO: PROFILE.nowISO }
  };
  const install = `(${installRouteFixture.toString()})(input)`;
  runInNewContext(install, context);
  assert.equal(context.performance, nativePerformance);
  assert.equal(context.setTimeout, nativeTimer);
  assert.deepEqual(context.performance.getEntriesByType("mark"), ["native-entry"]);
  assert.equal(runInNewContext("new Date().toISOString()", context), PROFILE.nowISO);
  assert.equal(runInNewContext("Date.now()", context), Date.parse(PROFILE.nowISO));
  assert.equal(runInNewContext("new Date('2027-01-01T00:00:00Z').getUTCFullYear()", context), 2027);
  assert.equal(typeof runInNewContext("Date()", context), "string");
  assert.equal(JSON.parse(stored.get("quoteWizard.quotes"))[0].id, "fixture");
  const firstRandom = runInNewContext("Math.random()", context);
  runInNewContext(install, context);
  assert.equal(runInNewContext("Math.random()", context), firstRandom);
});

const samples = (runs) => ROUTES.flatMap(({ id }) => Array.from({ length: runs }, (_, run) => ({
  routeId: id, run, status: "measured", navigationId: "n1", coreOutcome: "ready", supplementalOutcome: "ready",
  pageErrors: [], externalOrigins: [],
  routeBytes: (run + 1) * 100, usableCoreMs: run + 1.2, supplementalCompleteMs: (run + 1) * 10
})));
const calibratedBudget = () => {
  const calibration = summarizeRoutes(samples(5), { calibrate: true });
  return {
    profileId: PROFILE.id, calibration: { runCount: 5, buildSha256: "a".repeat(64) },
    routes: Object.fromEntries(Object.entries(calibration.routes).map(([id, value]) => [id, { p75: value.p75, ceilings: value.ceilings }]))
  };
};

test("five runs use nearest-rank p75 and round up after ten percent headroom", () => {
  assert.equal(percentile([5, 1, 4, 2, 3], 0.75), 4);
  const result = summarizeRoutes(samples(5), { calibrate: true });
  assert.equal(result.status, "PASS");
  assert.equal(result.routes.now.p75.usableCoreMs, 4.2);
  assert.equal(result.routes.now.ceilings.usableCoreMs, 5);
  assert.equal(result.routes.now.ceilings.routeBytes, 440);
});

test("three runs evaluate median, not worst run or a passing retry", () => {
  const input = samples(3);
  input.find((row) => row.routeId === "now" && row.run === 2).routeBytes = 100000;
  const result = summarizeRoutes(input, { budget: calibratedBudget() });
  assert.equal(result.status, "PASS");
  assert.equal(result.routes.now.median.routeBytes, 200);
  input.find((row) => row.routeId === "now" && row.run === 1).routeBytes = 100000;
  assert.equal(summarizeRoutes(input, { budget: calibratedBudget() }).routes.now.status, "FAIL");
});

test("missing, duplicate, nonfinite, unordered or unsuccessful samples block calibration", () => {
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => { rows[0].run = 1; },
    (rows) => { rows[0].routeBytes = NaN; },
    (rows) => { rows[0].routeBytes = 0; },
    (rows) => { rows[0].coreOutcome = "unavailable"; },
    (rows) => { rows[0].navigationId = ""; },
    (rows) => { rows[0].usableCoreMs = 1000; },
    (rows) => { rows[0].status = "BLOCKED"; }
  ]) {
    const rows = samples(5); mutate(rows);
    assert.equal(summarizeRoutes(rows, { calibrate: true }).status, "FAIL");
  }
});

test("uncalibrated, mismatched-profile and arithmetically inconsistent ceilings fail closed", () => {
  assert.equal(summarizeRoutes(samples(3), { budget: {} }).routes.now.status, "BLOCKED");
  const budget = calibratedBudget();
  budget.profileId = "compatibility";
  assert.equal(summarizeRoutes(samples(3), { budget }).status, "FAIL");
  budget.profileId = PROFILE.id;
  budget.routes.now.ceilings.routeBytes += 1;
  assert.equal(summarizeRoutes(samples(3), { budget }).routes.now.status, "BLOCKED");
});

test("a failed browser runner cannot produce a passing receipt from otherwise valid samples", () => {
  assert.equal(summarizeRoutes(samples(5), { calibrate: true, runnerStatus: 1 }).status, "FAIL");
  assert.equal(summarizeRoutes(samples(3), { budget: calibratedBudget(), runnerStatus: 1 }).status, "FAIL");
});

test("late browser errors, external requests, or absent diagnostics block both modes", () => {
  for (const key of ["pageErrors", "externalOrigins"]) {
    for (const diagnostic of [["unexpected browser event"], undefined]) {
      for (const calibrate of [true, false]) {
        const rows = samples(calibrate ? 5 : 3);
        rows[0][key] = diagnostic;
        assert.equal(summarizeRoutes(rows, { calibrate, budget: calibratedBudget() }).status, "FAIL");
      }
    }
  }
});

test("profiled diagnostic arrivals cannot qualify or calibrate route budgets", () => {
  for (const calibrate of [true, false]) {
    const rows = samples(calibrate ? 5 : 3);
    rows[0].status = "diagnostic-only";
    assert.equal(summarizeRoutes(rows, { calibrate, budget: calibratedBudget() }).status, "FAIL");
  }
});
