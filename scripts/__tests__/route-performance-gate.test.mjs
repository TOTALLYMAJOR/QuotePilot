import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { PROFILE, ROUTES, installRouteFixture, percentile, summarizeRoutes } from "../route-performance-metrics.mjs";

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

test("uncalibrated, mismatched-profile and unmeasured ceiling increases fail closed", () => {
  assert.equal(summarizeRoutes(samples(3), { budget: {} }).routes.now.status, "BLOCKED");
  const budget = calibratedBudget();
  budget.profileId = "compatibility";
  assert.equal(summarizeRoutes(samples(3), { budget }).status, "FAIL");
  budget.profileId = PROFILE.id;
  budget.routes.now.ceilings.routeBytes += 1;
  assert.equal(summarizeRoutes(samples(3), { budget }).routes.now.status, "BLOCKED");
});
