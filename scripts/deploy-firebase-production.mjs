#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateFirebaseToolsBinary } from "./firebase-tools-binary.mjs";
import {
  validateProductionReleaseProfileTarget,
  verifyDirectProductionReleaseEvidence
} from "./production-release-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ID = "tonicatering";
const FUNCTIONS_ENV_PATH = path.join(ROOT, "functions", `.env.${PROJECT_ID}`);
export const FUNCTIONS_DEPLOY_BATCH_SIZE = 35;
export const FUNCTIONS_DEPLOY_PAUSE_MS = 65_000;

const PRODUCTION_RUNTIME_BASE = Object.freeze({
  NOTIFICATIONS_SMS_PROVIDER: "none",
  STRIPE_MODE: "live",
  COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "false",
  OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "false",
  REVENUE_AUTOPILOT_ENABLED: "false",
  REVENUE_AUTOPILOT_SENDS_ENABLED: "false",
  BUYER_ACCESS_ENABLED: "false",
  BUYER_ACCESS_STRIPE_MODE: "test"
});

const PRODUCTION_RUNTIME_EXPECTED = Object.freeze({
  "safe-off": Object.freeze({
    ...PRODUCTION_RUNTIME_BASE,
    NOTIFICATIONS_EMAIL_PROVIDER: "none"
  }),
  "email-active": Object.freeze({
    ...PRODUCTION_RUNTIME_BASE,
    NOTIFICATIONS_EMAIL_PROVIDER: "resend"
  })
});

const SAFE_OFF_RUNTIME_FORBIDDEN = Object.freeze([
  "TWILIO_ACCOUNT_SID",
  "TWILIO_MESSAGING_SERVICE_SID",
  "NOTIFICATIONS_OWNER_PHONE",
  "NOTIFICATIONS_OWNER_SMS_CONSENT",
  "BUYER_ACCESS_ALLOWED_EMAILS",
  "BUYER_ACCESS_TURNSTILE_HOSTNAMES"
]);

export function listExpectedFunctionIds(source) {
  const ids = [...String(source || "").matchAll(/^exports\.([A-Za-z][A-Za-z0-9_]*)\s*=/gmu)]
    .map((match) => match[1]);
  const unique = [...new Set(ids)].sort();
  if (!unique.length || unique.length !== ids.length) {
    throw new Error("Firebase production deployment could not derive a unique Functions export inventory.");
  }
  return unique;
}

export function planFunctionDeployBatches(functionIds, batchSize = FUNCTIONS_DEPLOY_BATCH_SIZE) {
  const ids = [...new Set((functionIds || []).map((id) => String(id || "").trim()))]
    .filter(Boolean)
    .sort();
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 40) {
    throw new Error("Firebase production function batch size must be between 1 and 40.");
  }
  if (!ids.length || ids.some((id) => !/^[A-Za-z][A-Za-z0-9_]*$/u.test(id))) {
    throw new Error("Firebase production function inventory is empty or malformed.");
  }
  const batches = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    batches.push(ids.slice(index, index + batchSize));
  }
  return batches;
}

export function functionsDeployOutputHasFailure(output) {
  const value = String(output || "");
  return /failed to (?:create|update) function/iu.test(value)
    || /functions deploy had errors/iu.test(value);
}

export function validateProductionFunctionsReadback(
  response,
  expectedFunctionIds,
  releaseProfileValue = "safe-off"
) {
  const releaseProfile = validateProductionReleaseProfileTarget(
    releaseProfileValue,
    "firebase-backend"
  );
  const expectedRuntime = PRODUCTION_RUNTIME_EXPECTED[releaseProfile];
  if (response?.status !== "success" || !Array.isArray(response?.result)) {
    throw new Error("Firebase production Functions provider readback is missing or malformed.");
  }
  const expected = [...new Set(expectedFunctionIds || [])].sort();
  const entries = response.result;
  const actual = entries.map((entry) => String(entry?.id || "").trim()).sort();
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((id) => !actualSet.has(id));
  const extra = actual.filter((id) => !expectedSet.has(id));
  if (actualSet.size !== actual.length || missing.length || extra.length) {
    throw new Error(
      `Firebase production Functions inventory mismatch (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}).`
    );
  }
  for (const entry of entries) {
    const id = String(entry?.id || "").trim();
    if (
      entry?.project !== PROJECT_ID
      || entry?.region !== "us-central1"
      || entry?.state !== "ACTIVE"
      || !["gcfv1", "gcfv2", "run"].includes(String(entry?.platform || ""))
    ) {
      throw new Error(`Firebase production Functions provider state is invalid for ${id || "an unknown function"}.`);
    }
    const runtime = entry.environmentVariables || {};
    for (const [name, expectedValue] of Object.entries(expectedRuntime)) {
      if (String(runtime[name] ?? "").trim() !== expectedValue) {
        throw new Error(
          `Firebase production Functions readback does not prove ${releaseProfile} ${name} for ${id}.`
        );
      }
    }
    for (const name of SAFE_OFF_RUNTIME_FORBIDDEN) {
      if (String(runtime[name] ?? "").trim()) {
        throw new Error(`Firebase production Functions readback retains disabled runtime residue ${name} for ${id}.`);
      }
    }
  }
  return Object.freeze({ functionCount: entries.length, profile: releaseProfile });
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function validateArgs() {
  const allowed = new Set([
    "--scope",
    "--confirm",
    "--release-sha",
    "--ci-run-id",
    "--rollback-sha",
    "--release-profile"
  ]);
  const args = process.argv.slice(2);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name)) throw new Error(`Unknown argument: ${name || "<blank>"}`);
    if (seen.has(name)) throw new Error(`Duplicate argument: ${name}`);
    if (!value || String(value).startsWith("--")) throw new Error(`${name} requires a value.`);
    seen.add(name);
  }
  if (seen.size !== allowed.size) {
    throw new Error("Firebase deployment requires scope, confirmation, release SHA, CI run, rollback SHA, and release profile.");
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "Command failed.").trim());
  }
  return String(result.stdout || "").trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function runCheckedFirebaseDeploy(firebaseCliPath, args) {
  const result = spawnSync(firebaseCliPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (
    result.status !== 0
    || functionsDeployOutputHasFailure(output)
  ) {
    throw new Error("Firebase production deployment reported a Functions provider failure.");
  }
}

function parseJsonOutput(value, label) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

function readExpectedFunctionIds() {
  return listExpectedFunctionIds(
    fs.readFileSync(path.join(ROOT, "functions", "index.js"), "utf8")
  );
}

function verifyProductionFunctions(firebaseCliPath, expectedFunctionIds, releaseProfile) {
  const response = parseJsonOutput(capture(firebaseCliPath, [
    "functions:list",
    "--project",
    PROJECT_ID,
    "--json"
  ]), "Firebase production Functions provider readback");
  const verified = validateProductionFunctionsReadback(
    response,
    expectedFunctionIds,
    releaseProfile
  );
  console.log(`Verified ${verified.functionCount} active Firebase Functions on the ${verified.profile} profile.`);
}

async function deployFunctionBatches(firebaseCliPath, functionIds, releaseSha) {
  const batches = planFunctionDeployBatches(functionIds);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    console.log(`Deploying Firebase Functions batch ${index + 1}/${batches.length} (${batch.length} functions).`);
    runCheckedFirebaseDeploy(firebaseCliPath, [
      "deploy",
      "--only",
      batch.map((id) => `functions:${id}`).join(","),
      "--project",
      PROJECT_ID,
      "--non-interactive",
      "--message",
      `QuotePilot ${releaseSha}`,
      "--force"
    ]);
    if (index < batches.length - 1) {
      console.log(`Waiting ${FUNCTIONS_DEPLOY_PAUSE_MS / 1000} seconds for the provider write-quota window.`);
      await new Promise((resolve) => setTimeout(resolve, FUNCTIONS_DEPLOY_PAUSE_MS));
    }
  }
}

function validateWorkflowContext() {
  if (
    process.env.GITHUB_ACTIONS !== "true"
    || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || process.env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error("Firebase production deployment requires a main-branch manual GitHub workflow.");
  }
  const head = capture("git", ["rev-parse", "HEAD"]);
  if (String(process.env.GITHUB_SHA || "").toLowerCase() !== head.toLowerCase()) {
    throw new Error("Firebase production deployment refused because GITHUB_SHA does not match HEAD.");
  }
  return head;
}

function validateFunctionsEnvironment() {
  if (!fs.existsSync(FUNCTIONS_ENV_PATH)) {
    throw new Error(`Missing generated Functions environment: functions/.env.${PROJECT_ID}.`);
  }
  const mode = fs.statSync(FUNCTIONS_ENV_PATH).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`functions/.env.${PROJECT_ID} must not be readable by group or other users.`);
  }
  const ignored = spawnSync("git", ["check-ignore", "--quiet", FUNCTIONS_ENV_PATH], {
    cwd: ROOT,
    shell: false
  });
  if (ignored.status !== 0) {
    throw new Error(`functions/.env.${PROJECT_ID} must remain ignored by git.`);
  }
}

function validateApplicationDefaultCredentials() {
  if (String(process.env.FIREBASE_TOKEN || "").trim()) {
    throw new Error("Firebase production deployment forbids legacy FIREBASE_TOKEN authentication.");
  }
  const configuredPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (!configuredPath) {
    throw new Error("Firebase production deployment requires workload-identity Application Default Credentials.");
  }
  const credentialsPath = path.resolve(ROOT, configuredPath);
  const relativePath = path.relative(ROOT, credentialsPath);
  if (
    !relativePath
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
    || !/^gha-creds-[^/\\]+\.json$/u.test(path.basename(credentialsPath))
  ) {
    throw new Error("Firebase production credentials must be the GitHub workload-identity credentials file in the checkout.");
  }
  if (!fs.existsSync(credentialsPath) || !fs.statSync(credentialsPath).isFile()) {
    throw new Error("Firebase production workload-identity credentials file is missing.");
  }
  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  } catch {
    throw new Error("Firebase production workload-identity credentials file is not valid JSON.");
  }
  if (credentials?.type !== "external_account") {
    throw new Error("Firebase production deployment requires external-account workload identity credentials.");
  }
}

const scopes = {
  hosting: {
    selector: "hosting:app",
    confirmation: `DEPLOY ${PROJECT_ID} hosting:app`,
    build: true,
    functions: false
  },
  backend: {
    selector: "firestore,functions:default",
    confirmation: `DEPLOY ${PROJECT_ID} firestore,functions:default`,
    build: false,
    functions: true
  },
  all: {
    selector: "hosting:app,firestore,functions:default",
    confirmation: `DEPLOY ${PROJECT_ID} hosting:app,firestore,functions:default`,
    build: true,
    functions: true
  }
};
export async function main() {
  validateArgs();
  const scope = readArg("--scope");
  const selected = scopes[scope];
  if (!selected) throw new Error("--scope must be one of: hosting, backend, all.");
  const releaseProfile = validateProductionReleaseProfileTarget(
    readArg("--release-profile"),
    `firebase-${scope}`
  );
  if (readArg("--confirm") !== selected.confirmation) {
    throw new Error(`Production deployment requires --confirm "${selected.confirmation}".`);
  }
  validateApplicationDefaultCredentials();
  const firebaseCliPath = await validateFirebaseToolsBinary(process.env.FIREBASE_CLI_PATH);
  const releaseTarget = `firebase-${scope}`;
  const verify = (headSha) => verifyDirectProductionReleaseEvidence({
    releaseSha: readArg("--release-sha"),
    ciRunId: readArg("--ci-run-id"),
    rollbackSha: readArg("--rollback-sha"),
    target: releaseTarget,
    smsProvider: process.env.EXPECTED_SMS_PROVIDER,
    smsConfigurationGeneration: process.env.EXPECTED_SMS_CONFIGURATION_GENERATION,
    headSha,
    deploymentRunId: process.env.GITHUB_RUN_ID,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    approvalMode: process.env.RELEASE_APPROVAL_MODE,
    releaseProfile,
    soloOperatorIds: process.env.RELEASE_SOLO_OPERATOR_IDS,
    root: ROOT
  });

  await verify(validateWorkflowContext());
  run("npm", ["run", "check:env"]);
  if (selected.functions) validateFunctionsEnvironment();
  if (selected.build) run("npm", ["run", "build"]);
  await verify(validateWorkflowContext());

  if (scope !== "backend") {
    run(firebaseCliPath, [
      "target:apply",
      "hosting",
      "app",
      PROJECT_ID,
      "--project",
      PROJECT_ID
    ]);
  }

  if (!selected.functions) {
    runCheckedFirebaseDeploy(firebaseCliPath, [
      "deploy",
      "--only",
      selected.selector,
      "--project",
      PROJECT_ID,
      "--non-interactive",
      "--message",
      `QuotePilot ${readArg("--release-sha")}`
    ]);
    return;
  }

  const nonFunctionSelector = scope === "all" ? "hosting:app,firestore" : "firestore";
  runCheckedFirebaseDeploy(firebaseCliPath, [
    "deploy",
    "--only",
    nonFunctionSelector,
    "--project",
    PROJECT_ID,
    "--non-interactive",
    "--message",
    `QuotePilot ${readArg("--release-sha")}`
  ]);
  const expectedFunctionIds = readExpectedFunctionIds();
  await deployFunctionBatches(firebaseCliPath, expectedFunctionIds, readArg("--release-sha"));
  verifyProductionFunctions(firebaseCliPath, expectedFunctionIds, releaseProfile);
}

if (
  process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
