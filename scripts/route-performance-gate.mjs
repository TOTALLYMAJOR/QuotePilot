import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir, cpus, platform, release } from "node:os";
import path from "node:path";
import { loadEnv } from "vite";
import { PROFILE, ROUTES, summarizeRoutes } from "./route-performance-metrics.mjs";

const calibrate = process.argv.includes("--calibrate");
const list = process.argv.includes("--list");
if (process.argv.slice(2).some((arg) => !["--calibrate", "--list"].includes(arg))) throw new Error("Supported options: --calibrate, --list.");
const scratch = await mkdtemp(path.join(tmpdir(), "quotepilot-route-performance-"));
const output = path.resolve("output/playwright", path.basename(scratch));
await mkdir(output, { recursive: true });
const buildDirectory = path.join(scratch, "build");
const env = { ...process.env };
// The fixed local fixture must never inherit a live Firebase project or optional feature matrix.
for (const key of new Set([...Object.keys(loadEnv("production", process.cwd(), "VITE_")), ...Object.keys(env)])) {
  if (key.startsWith("VITE_")) env[key] = "";
}
Object.assign(env, {
  NODE_ENV: "production", VITE_AMBIENT_UI_ENABLED: "true", VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED: "true",
  VITE_PILOT_NOW_ENABLED: "true", VITE_INVENTORY_AUTHORITY_ENABLED: "true",
  VITE_ALLOW_LOCAL_CATALOG_FALLBACK: "true", VITE_E2E_BYPASS_AUTH: "true", VITE_E2E_ROLE: "admin",
  VITE_E2E_ORGANIZATION_ID: "e2e-org", VITE_DEFAULT_ORGANIZATION_ID: "e2e-org",
  VITE_E2E_LOCAL_REVIEW_FIXTURES: "false", VITE_FIREBASE_APP_CHECK_ENABLED: "false",
  ROUTE_PERF_RUN_DIR: scratch, ROUTE_PERF_CALIBRATE: String(calibrate)
});
function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
if (list) {
  process.exitCode = run("bash", ["scripts/run-playwright.sh", "test", "--config", "playwright.route-performance.config.js", "--list"]);
} else {
  if (run("npm", ["run", "build", "--", "--outDir", buildDirectory]) !== 0) throw new Error("Isolated production build failed.");
  const hash = createHash("sha256");
  hash.update(await readFile(path.join(buildDirectory, "index.html")));
  for (const file of (await readdir(path.join(buildDirectory, "assets"))).sort()) {
    hash.update(file); hash.update(await readFile(path.join(buildDirectory, "assets", file)));
  }
  const git = (args) => spawnSync("git", args, { encoding: "utf8" }).stdout.trim();
  const identity = {
    recordedAt: new Date().toISOString(), root: process.cwd(), branch: git(["branch", "--show-current"]),
    head: git(["rev-parse", "HEAD"]), dirty: Boolean(git(["status", "--porcelain"])),
    buildSha256: hash.digest("hex"), profile: PROFILE,
    toolchain: { node: process.version, playwright: JSON.parse(await readFile("node_modules/@playwright/test/package.json", "utf8")).version },
    host: { platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
    evidenceClass: "local-production-transform-synthetic-staff-fixture",
    authEvidence: "Existing E2E synthetic admin session; Firebase authentication is not exercised.",
    inventoryEvidence: "No local Inventory authority fixture; successful Inventory calibration is BLOCKED."
  };
  await writeFile(path.join(scratch, "identity.json"), JSON.stringify(identity, null, 2));
  await writeFile(path.join(buildDirectory, "route-performance-build.json"), JSON.stringify(identity));
  const testStatus = run("bash", ["scripts/run-playwright.sh", "test", "--config", "playwright.route-performance.config.js"]);
  const samples = [];
  for (const route of ROUTES) {
    for (let runIndex = 0; runIndex < (calibrate ? 5 : 3); runIndex += 1) {
      try { samples.push(JSON.parse(await readFile(path.join(scratch, `${route.id}-${runIndex}.json`), "utf8"))); }
      catch { samples.push({ routeId: route.id, run: runIndex, status: "BLOCKED", reason: "Runner produced no sample." }); }
    }
  }
  const budget = JSON.parse(await readFile("docs/performance/route-performance-budget.json", "utf8"));
  const summary = summarizeRoutes(samples, { calibrate, budget });
  const receipt = { identity, mode: calibrate ? "five-run-p75-plus-10-percent" : "three-run-median", testStatus, ...summary };
  await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  if (calibrate && summary.status === "PASS") {
    const proposal = {
      schemaVersion: 1, profileId: PROFILE.id,
      calibration: { recordedAt: identity.recordedAt, buildSha256: identity.buildSha256, runCount: 5, receipt: path.relative(process.cwd(), path.join(output, "receipt.json")) },
      routes: Object.fromEntries(Object.entries(summary.routes).map(([id, route]) => [id, { p75: route.p75, ceilings: route.ceilings }]))
    };
    await writeFile(path.join(output, "budget-proposal.json"), JSON.stringify(proposal, null, 2));
  }
  for (const [id, route] of Object.entries(summary.routes)) console.log(`${id}: ${route.status} ${JSON.stringify(route.median || route.p75 || {})}`);
  console.log(`Receipt: ${path.join(output, "receipt.json")}\nRetained build and Playwright results: ${scratch}`);
  process.exitCode = testStatus === 0 && summary.status === "PASS" ? 0 : 1;
}
