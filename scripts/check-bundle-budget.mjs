import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET_RELATIVE_PATH = "docs/performance/bundle-budget.json";
const EXCEPTION_RELATIVE_PATH = "docs/performance/bundle-exception.json";

export const BUNDLE_PROFILES = Object.freeze({
  compatibility: Object.freeze({
    markerPrefixes: Object.freeze(["LegacyQuoteHistoryModal-"])
  }),
  "ambient-production": Object.freeze({
    markerPrefixes: Object.freeze(["AmbientLivingOpportunityRoute-"])
  })
});

export const PRODUCTION_FIXTURE_CHUNK_PREFIXES = Object.freeze([
  "localCustomerDirectoryFixture-"
]);

export const PRODUCTION_FIXTURE_PAYLOAD_SENTINELS = Object.freeze([
  "avery.staff@example.com",
  "assignment-williams-avery-bar",
  "Avery Williams",
  "Foundation Dinner"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function validateMetricRecord(value, pathLabel) {
  for (const metric of ["totalJsBytes", "largestJsChunkBytes"]) {
    const metricValue = Number(value?.[metric]);
    if (!Number.isSafeInteger(metricValue) || metricValue <= 0) {
      throw new Error(`${pathLabel} must declare a positive integer ${metric}.`);
    }
  }
}

function readActiveException(root) {
  const exceptionPath = path.join(root, EXCEPTION_RELATIVE_PATH);
  if (!fs.existsSync(exceptionPath)) return null;

  const exception = readJson(exceptionPath);
  if (exception.status !== "active") {
    throw new Error(`${EXCEPTION_RELATIVE_PATH} must be removed when its status is not active.`);
  }
  if (typeof exception.id !== "string" || !exception.id.trim()) {
    throw new Error(`${EXCEPTION_RELATIVE_PATH} must declare a non-empty id.`);
  }
  if (!exception.profiles || typeof exception.profiles !== "object" || Array.isArray(exception.profiles)) {
    throw new Error(`${EXCEPTION_RELATIVE_PATH} must declare profile-specific ceilings.`);
  }
  Object.keys(BUNDLE_PROFILES).forEach((profile) => {
    validateMetricRecord(
      exception.profiles?.[profile]?.maxMetrics,
      `${EXCEPTION_RELATIVE_PATH} profiles.${profile}.maxMetrics`
    );
  });
  return exception;
}

function collectJsMetrics(root) {
  const assetsDirectory = path.join(root, "dist", "assets");
  if (!fs.existsSync(assetsDirectory)) {
    throw new Error(`Missing ${assetsDirectory}. Run npm run build first.`);
  }
  const files = fs.readdirSync(assetsDirectory).filter((name) => name.endsWith(".js")).sort();
  if (!files.length) throw new Error(`No JavaScript assets found in ${assetsDirectory}.`);

  let totalJsBytes = 0;
  let largestJsChunkBytes = 0;
  for (const file of files) {
    const size = fs.statSync(path.join(assetsDirectory, file)).size;
    totalJsBytes += size;
    largestJsChunkBytes = Math.max(largestJsChunkBytes, size);
  }
  return { files, metrics: { totalJsBytes, largestJsChunkBytes } };
}

function assertNoProductionFixtureArtifacts(root, files) {
  const assetsDirectory = path.join(root, "dist", "assets");
  const violations = [];

  for (const file of files) {
    for (const prefix of PRODUCTION_FIXTURE_CHUNK_PREFIXES) {
      if (file.startsWith(prefix)) {
        violations.push(`${file} matches development fixture chunk prefix ${prefix}`);
      }
    }

    const source = fs.readFileSync(path.join(assetsDirectory, file), "utf8");
    for (const sentinel of PRODUCTION_FIXTURE_PAYLOAD_SENTINELS) {
      if (source.includes(sentinel)) {
        violations.push(`${file} contains development fixture payload sentinel ${JSON.stringify(sentinel)}`);
      }
    }
  }

  if (violations.length) {
    throw new Error(
      `Production bundle contains development fixture artifacts:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`
    );
  }
}

export function detectBundleProfile(files = []) {
  const detected = Object.entries(BUNDLE_PROFILES)
    .filter(([, contract]) => contract.markerPrefixes.some((prefix) => (
      files.some((file) => String(file).startsWith(prefix))
    )))
    .map(([profile]) => profile);

  if (detected.length !== 1) {
    throw new Error(
      `Bundle profile detection must resolve exactly one graph; detected ${detected.join(", ") || "none"}.`
    );
  }
  return detected[0];
}

function compareBaseline(exception, baseline) {
  if (exception.baselineGeneratedAt !== baseline.generatedAt) {
    throw new Error(
      `Bundle exception ${exception.id} targets baseline ${exception.baselineGeneratedAt}, not ${baseline.generatedAt}.`
    );
  }
  for (const metric of ["totalJsBytes", "largestJsChunkBytes"]) {
    if (Number(exception.baselineMetrics?.[metric]) !== Number(baseline.metrics?.[metric])) {
      throw new Error(
        `Bundle exception ${exception.id} does not match baseline ${metric} ${baseline.metrics?.[metric]}.`
      );
    }
  }
}

export function checkBundleBudget({
  root = DEFAULT_ROOT,
  requestedProfile = process.env.BUNDLE_BUDGET_PROFILE || "",
  updateBaseline = false,
  log = console
} = {}) {
  const { files, metrics: current } = collectJsMetrics(root);
  assertNoProductionFixtureArtifacts(root, files);
  const detectedProfile = detectBundleProfile(files);
  const normalizedRequestedProfile = String(requestedProfile || "").trim();
  if (normalizedRequestedProfile && normalizedRequestedProfile !== detectedProfile) {
    throw new Error(
      `Requested bundle profile ${normalizedRequestedProfile} does not match detected graph ${detectedProfile}.`
    );
  }

  const budgetPath = path.join(root, BUDGET_RELATIVE_PATH);
  const activeException = readActiveException(root);
  if (updateBaseline) {
    if (detectedProfile !== "compatibility") {
      throw new Error("The clean-main baseline may be updated only from the compatibility graph.");
    }
    if (activeException) {
      throw new Error(`Remove active bundle exception ${activeException.id} before updating the clean-main baseline.`);
    }
    const existing = fs.existsSync(budgetPath)
      ? readJson(budgetPath)
      : { allowancePercent: 15 };
    const baseline = {
      generatedAt: toDateStamp(),
      allowancePercent: Number(existing.allowancePercent ?? 15),
      metrics: current
    };
    writeJson(budgetPath, baseline);
    log.log(`Updated bundle baseline in ${BUDGET_RELATIVE_PATH}`);
    log.log(JSON.stringify(baseline, null, 2));
    return Object.freeze({ profile: detectedProfile, current, baseline, updated: true });
  }

  if (!fs.existsSync(budgetPath)) {
    throw new Error(
      `Missing ${BUDGET_RELATIVE_PATH}. Run npm run check:perf:bundle -- --update-baseline`
    );
  }
  const baseline = readJson(budgetPath);
  const allowance = Number(baseline.allowancePercent ?? 15) / 100;
  const standardMaximums = {
    totalJsBytes: Math.round(baseline.metrics.totalJsBytes * (1 + allowance)),
    largestJsChunkBytes: Math.round(baseline.metrics.largestJsChunkBytes * (1 + allowance))
  };

  if (activeException) compareBaseline(activeException, baseline);
  const effectiveMaximums = activeException
    ? {
        totalJsBytes: Number(activeException.profiles[detectedProfile].maxMetrics.totalJsBytes),
        largestJsChunkBytes: Number(
          activeException.profiles[detectedProfile].maxMetrics.largestJsChunkBytes
        )
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

  log.log("Bundle profile:", detectedProfile);
  log.log("Bundle budget baseline:", baseline.metrics);
  log.log("Current bundle metrics:", current);
  log.log("Normal allowance percent:", baseline.allowancePercent);
  log.log("Normal maximum metrics:", standardMaximums);
  if (activeException) {
    log.log("Active temporary exception:", activeException.id);
    log.log("Profile exception maximum metrics:", effectiveMaximums);
  }
  if (failures.length) {
    throw new Error(`Bundle budget check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  log.log("Bundle budget check passed.");
  return Object.freeze({
    profile: detectedProfile,
    current,
    baseline,
    effectiveMaximums,
    exceptionId: activeException?.id || null,
    updated: false
  });
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    checkBundleBudget({ updateBaseline: process.argv.includes("--update-baseline") });
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
