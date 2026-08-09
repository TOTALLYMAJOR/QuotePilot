import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIST_ASSETS_DIR = path.join(ROOT, "dist", "assets");
const BUDGET_FILE = path.join(ROOT, "docs", "performance", "bundle-budget.json");
const EXCEPTION_FILE = path.join(ROOT, "docs", "performance", "bundle-exception.json");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function readActiveException() {
  if (!fs.existsSync(EXCEPTION_FILE)) {
    return null;
  }

  const exception = readJson(EXCEPTION_FILE);
  if (exception.status !== "active") {
    throw new Error(
      `${path.relative(ROOT, EXCEPTION_FILE)} must be removed when its status is not active.`
    );
  }
  if (typeof exception.id !== "string" || !exception.id.trim()) {
    throw new Error(`${path.relative(ROOT, EXCEPTION_FILE)} must declare a non-empty id.`);
  }

  for (const metric of ["totalJsBytes", "largestJsChunkBytes"]) {
    const value = Number(exception.maxMetrics?.[metric]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(
        `${path.relative(ROOT, EXCEPTION_FILE)} must declare a positive integer maxMetrics.${metric}.`
      );
    }
  }

  return exception;
}

function collectJsMetrics() {
  if (!fs.existsSync(DIST_ASSETS_DIR)) {
    throw new Error(`Missing ${DIST_ASSETS_DIR}. Run npm run build first.`);
  }

  const files = fs
    .readdirSync(DIST_ASSETS_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort();

  if (!files.length) {
    throw new Error(`No JavaScript assets found in ${DIST_ASSETS_DIR}.`);
  }

  let totalJsBytes = 0;
  let largestJsChunkBytes = 0;

  for (const file of files) {
    const fullPath = path.join(DIST_ASSETS_DIR, file);
    const size = fs.statSync(fullPath).size;
    totalJsBytes += size;
    largestJsChunkBytes = Math.max(largestJsChunkBytes, size);
  }

  return { totalJsBytes, largestJsChunkBytes };
}

const current = collectJsMetrics();
const activeException = readActiveException();

if (UPDATE_BASELINE) {
  if (activeException) {
    throw new Error(
      `Remove active bundle exception ${activeException.id} before updating the clean-main baseline.`
    );
  }

  const existing = fs.existsSync(BUDGET_FILE)
    ? readJson(BUDGET_FILE)
    : { allowancePercent: 15 };

  const baseline = {
    generatedAt: toDateStamp(),
    allowancePercent: Number(existing.allowancePercent ?? 15),
    metrics: current
  };

  writeJson(BUDGET_FILE, baseline);
  console.log(`Updated bundle baseline in ${path.relative(ROOT, BUDGET_FILE)}`);
  console.log(JSON.stringify(baseline, null, 2));
  process.exit(0);
}

if (!fs.existsSync(BUDGET_FILE)) {
  throw new Error(
    `Missing ${path.relative(ROOT, BUDGET_FILE)}. Run npm run check:perf:bundle -- --update-baseline`
  );
}

const baseline = readJson(BUDGET_FILE);
const allowance = Number(baseline.allowancePercent ?? 15) / 100;
const standardMaximums = {
  totalJsBytes: Math.round(baseline.metrics.totalJsBytes * (1 + allowance)),
  largestJsChunkBytes: Math.round(baseline.metrics.largestJsChunkBytes * (1 + allowance))
};

if (activeException) {
  if (activeException.baselineGeneratedAt !== baseline.generatedAt) {
    throw new Error(
      `Bundle exception ${activeException.id} targets baseline ${activeException.baselineGeneratedAt}, not ${baseline.generatedAt}.`
    );
  }
  for (const metric of ["totalJsBytes", "largestJsChunkBytes"]) {
    if (Number(activeException.baselineMetrics?.[metric]) !== Number(baseline.metrics?.[metric])) {
      throw new Error(
        `Bundle exception ${activeException.id} does not match baseline ${metric} ${baseline.metrics?.[metric]}.`
      );
    }
  }
}

const effectiveMaximums = activeException
  ? {
      totalJsBytes: Number(activeException.maxMetrics.totalJsBytes),
      largestJsChunkBytes: Number(activeException.maxMetrics.largestJsChunkBytes)
    }
  : standardMaximums;

const failures = [];
if (current.totalJsBytes > effectiveMaximums.totalJsBytes) {
  failures.push(
    `totalJsBytes ${current.totalJsBytes} exceeds allowed ${effectiveMaximums.totalJsBytes} (baseline ${baseline.metrics.totalJsBytes}, normal +${baseline.allowancePercent}%)`
  );
}
if (current.largestJsChunkBytes > effectiveMaximums.largestJsChunkBytes) {
  failures.push(
    `largestJsChunkBytes ${current.largestJsChunkBytes} exceeds allowed ${effectiveMaximums.largestJsChunkBytes} (baseline ${baseline.metrics.largestJsChunkBytes}, normal +${baseline.allowancePercent}%)`
  );
}

console.log("Bundle budget baseline:", baseline.metrics);
console.log("Current bundle metrics:", current);
console.log("Normal allowance percent:", baseline.allowancePercent);
console.log("Normal maximum metrics:", standardMaximums);
if (activeException) {
  console.log("Active temporary exception:", activeException.id);
  console.log("Temporary exception maximum metrics:", effectiveMaximums);
}

if (failures.length) {
  console.error("Bundle budget check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Bundle budget check passed.");
