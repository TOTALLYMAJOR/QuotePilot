import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir, cpus, platform, release } from "node:os";
import path from "node:path";
import { loadEnv } from "vite";
import { PROFILE, ROUTES, summarizeRoutes } from "./route-performance-metrics.mjs";
import { EMULATORS, READ_ONLY_FUNCTIONS, isolatedToolEnvironment, isIsolatedFunctionSource, seedRoutePerformanceFixture } from "./route-performance-fixture.mjs";

if (process.env.ROUTE_PERF_EMULATOR_CHILD === "1") {
  await seedRoutePerformanceFixture();
  const result = spawnSync("bash", ["scripts/run-playwright.sh", "test", "--config", "playwright.route-performance.config.js"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const calibrate = process.argv.includes("--calibrate");
const list = process.argv.includes("--list");
if (process.argv.slice(2).some((arg) => !["--calibrate", "--list"].includes(arg))) throw new Error("Supported options: --calibrate, --list.");
const scratch = await mkdtemp(path.join(tmpdir(), "quotepilot-route-performance-"));
const output = path.resolve("output/playwright", path.basename(scratch));
await mkdir(output, { recursive: true });
const buildDirectory = path.join(scratch, "build");
const env = isolatedToolEnvironment(process.env, scratch);
// The fixed local fixture must never inherit a live Firebase project or optional feature matrix.
for (const key of new Set([...Object.keys(loadEnv("production", process.cwd(), "VITE_")), ...Object.keys(process.env)])) {
  if (key.startsWith("VITE_")) env[key] = "";
}
Object.assign(env, {
  DEBUG: "",
  NODE_ENV: "production", VITE_AMBIENT_UI_ENABLED: "true", VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED: "true",
  VITE_PILOT_NOW_ENABLED: "true", VITE_INVENTORY_AUTHORITY_ENABLED: "true",
  VITE_ALLOW_LOCAL_CATALOG_FALLBACK: "false", VITE_E2E_BYPASS_AUTH: "false",
  VITE_E2E_ORGANIZATION_ID: "e2e-org", VITE_DEFAULT_ORGANIZATION_ID: "e2e-org",
  VITE_E2E_LOCAL_REVIEW_FIXTURES: "false", VITE_FIREBASE_APP_CHECK_ENABLED: "false",
  VITE_FIREBASE_API_KEY: "demo-api-key", VITE_FIREBASE_PROJECT_ID: EMULATORS.projectId,
  VITE_FIREBASE_AUTH_DOMAIN: `${EMULATORS.projectId}.firebaseapp.com`,
  VITE_FIREBASE_APP_ID: "1:1234567890:web:route-performance",
  VITE_USE_FIREBASE_EMULATORS: "true", VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
  VITE_FIREBASE_AUTH_EMULATOR_PORT: "9498", VITE_FIRESTORE_EMULATOR_PORT: "8488",
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: "5998",
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
  const firebaseVersion = spawnSync("firebase", ["--version"], { env, encoding: "utf8" });
  if (firebaseVersion.error || firebaseVersion.status !== 0) throw new Error("Install Firebase CLI before route calibration; firebase --version must succeed.");
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
    toolchain: { node: process.version, firebase: firebaseVersion.stdout.trim(), playwright: JSON.parse(await readFile("node_modules/@playwright/test/package.json", "utf8")).version },
    host: { platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
    evidenceClass: "local-production-transform-auth-firestore-read-only-functions-emulator",
    authEvidence: "Email/password sign-in against isolated Auth emulator; tenant role via real Firestore rules/read-only bootstrap fallback. Not hosted authentication.",
    inventoryEvidence: "Synthetic commands processed by Inventory authority runtime into isolated Firestore projections; browser uses tenant-authorized listeners.",
    emulatorOrigins: [`http://${EMULATORS.authHost}`, `http://${EMULATORS.firestoreHost}`, "http://127.0.0.1:5998"],
    functionsEvidence: "Isolated secret-free source exposes only three real staff-authorized read handlers; browser blocks all other callable paths including write/bootstrap endpoints.",
    readOnlyFunctions: READ_ONLY_FUNCTIONS,
    routeBytesScope: "Encoded same-origin document and resource bodies completed by supplemental completion; excludes unfinished requests, cross-origin emulator traffic and headers."
  };
  await writeFile(path.join(scratch, "identity.json"), JSON.stringify(identity, null, 2));
  await writeFile(path.join(buildDirectory, "route-performance-build.json"), JSON.stringify(identity));
  const emulatorConfig = path.join(scratch, "firebase.json");
  // Use current tracked code, but never copy local provider secrets or register
  // the application's write endpoints, schedules or Firestore triggers.
  const functionsDirectory = path.join(scratch, "functions");
  await mkdir(functionsDirectory);
  const tracked = spawnSync("git", ["ls-files", "-z", "--", "functions"], { encoding: "utf8" });
  if (tracked.status !== 0) throw new Error("Cannot enumerate isolated Functions source.");
  for (const file of tracked.stdout.split("\0").filter(isIsolatedFunctionSource)) {
    const destination = path.join(scratch, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(file, destination);
  }
  const functionsPackage = JSON.parse(await readFile(path.join(functionsDirectory, "package.json"), "utf8"));
  functionsPackage.main = "route-performance-readers.js";
  await writeFile(path.join(functionsDirectory, "package.json"), JSON.stringify(functionsPackage));
  await writeFile(path.join(functionsDirectory, functionsPackage.main), `const handlers = require('./index.js');\n${READ_ONLY_FUNCTIONS.map((name) => `exports.${name} = handlers.${name};`).join("\n")}\n`);
  await symlink(path.resolve("functions/node_modules"), path.join(functionsDirectory, "node_modules"), "dir");
  await writeFile(emulatorConfig, JSON.stringify({
    functions: { source: "functions", codebase: "route-performance-readers" },
    firestore: { rules: path.resolve("firestore.rules"), indexes: path.resolve("firestore.indexes.json") },
    emulators: {
      auth: { host: "127.0.0.1", port: 9498 }, firestore: { host: "127.0.0.1", port: 8488 },
      functions: { host: "127.0.0.1", port: 5998 },
      hub: { host: "127.0.0.1", port: 4459 }, logging: { host: "127.0.0.1", port: 4460 },
      ui: { enabled: false }, singleProjectMode: true
    }
  }));
  env.ROUTE_PERF_EMULATOR_CHILD = "1";
  const testStatus = run("firebase", ["--config", emulatorConfig,
    "--project", EMULATORS.projectId, "emulators:exec", "--only", "auth,firestore,functions", "node scripts/route-performance-gate.mjs"]);
  const samples = [];
  for (const route of ROUTES) {
    for (let runIndex = 0; runIndex < (calibrate ? 5 : 3); runIndex += 1) {
      try { samples.push(JSON.parse(await readFile(path.join(scratch, `${route.id}-${runIndex}.json`), "utf8"))); }
      catch { samples.push({ routeId: route.id, run: runIndex, status: "BLOCKED", reason: "Runner produced no sample." }); }
    }
  }
  const budget = JSON.parse(await readFile("docs/performance/route-performance-budget.json", "utf8"));
  const summary = summarizeRoutes(samples, { calibrate, budget, runnerStatus: testStatus });
  const receipt = { identity, mode: calibrate ? "five-run-p75-plus-10-percent" : "three-run-median", testStatus, ...summary };
  await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  if (calibrate && testStatus === 0 && summary.status === "PASS") {
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
