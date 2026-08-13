#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyDirectProductionReleaseEvidence } from "./production-release-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ID = "tonicatering";
const FUNCTIONS_ENV_PATH = path.join(ROOT, "functions", `.env.${PROJECT_ID}`);

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
    "--rollback-sha"
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
    throw new Error("Firebase deployment requires scope, confirmation, release SHA, CI run, and rollback SHA.");
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

validateArgs();
const scope = readArg("--scope");
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
const selected = scopes[scope];
if (!selected) throw new Error("--scope must be one of: hosting, backend, all.");
if (readArg("--confirm") !== selected.confirmation) {
  throw new Error(`Production deployment requires --confirm "${selected.confirmation}".`);
}
if (!String(process.env.FIREBASE_TOKEN || "").trim()) {
  throw new Error("Firebase production deployment requires FIREBASE_TOKEN.");
}
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
  soloOperatorIds: process.env.RELEASE_SOLO_OPERATOR_IDS,
  root: ROOT
});

await verify(validateWorkflowContext());
run("npm", ["run", "check:env"]);
if (selected.functions) validateFunctionsEnvironment();
if (selected.build) run("npm", ["run", "build"]);
await verify(validateWorkflowContext());

if (scope !== "backend") {
  run("npx", [
    "--yes",
    "firebase-tools@15.24.0",
    "target:apply",
    "hosting",
    "app",
    PROJECT_ID,
    "--project",
    PROJECT_ID,
    "--token",
    process.env.FIREBASE_TOKEN
  ]);
}
run("npx", [
  "--yes",
  "firebase-tools@15.24.0",
  "deploy",
  "--only",
  selected.selector,
  "--project",
  PROJECT_ID,
  "--non-interactive",
  "--message",
  `QuotePilot ${readArg("--release-sha")}`,
  "--token",
  process.env.FIREBASE_TOKEN,
  ...(selected.functions ? ["--force"] : [])
]);
