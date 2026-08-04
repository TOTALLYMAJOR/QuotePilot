#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import {
  STAGING_CONFIG_FILE,
  STAGING_DEPLOY_SCOPE,
  assertBrowserSourceSafety,
  assertFirebaseStagingConfig,
  assertNoAmbientDeploymentCredentials,
  assertStagingConfirmation,
  assertStagingFunctionsEnv,
  assertStagingGitState,
  assertStagingProjectId,
  buildExactStagingBrowserEnv,
  firebaseStagingDeployArgs,
  stagingAppHost,
  stagingAppUrl,
  stagingConfirmationToken
} from "./firebase-staging-contract.mjs";

const ROOT = process.cwd();
const FIREBASE_CLI = process.platform === "win32" ? "firebase.cmd" : "firebase";
const NPM_CLI = process.platform === "win32" ? "npm.cmd" : "npm";
const COMMANDS = new Set(["validate", "prepare", "deploy"]);
const VITE_ENV_FILES = [
  ".env",
  ".env.local",
  ".env.staging",
  ".env.staging.local"
];

const HELP = `QuotePilot isolated Firebase staging lane

Usage:
  npm run staging:firebase:validate -- --project quotepilot-staging-<name>
  npm run staging:firebase:prepare  -- --project quotepilot-staging-<name>
  npm run staging:firebase:deploy   -- --project quotepilot-staging-<name> --confirm "<token printed by prepare>"

Safety contract:
  - project id must match quotepilot-staging-* and can never be tonicatering
  - the worktree must be clean and HEAD must equal the live origin branch SHA
  - the only deploy scope is ${STAGING_DEPLOY_SCOPE}, using ${STAGING_CONFIG_FILE}
  - Firebase Web SDK values are read from the target project and injected exactly
  - export VITE_BUYER_ACCESS_ENABLED=true before validate, prepare, or deploy
  - use npm run staging:firebase:env -- --project <project> from a secret-injected
    shell; it creates ignored mode-0600 functions/.env.<project> with:
      BUYER_ACCESS_ENABLED=true
      STRIPE_MODE=test
      STRIPE_SECRET_KEY=<prefer a least-privilege rk_test_ key; sk_test_ is accepted>
      STRIPE_WEBHOOK_SECRET=<the test endpoint signing secret>
      NOTIFICATIONS_EMAIL_PROVIDER=none
      NOTIFICATIONS_SMS_PROVIDER=none
      APP_BASE_URL=https://<project>.web.app/app
      APP_BASE_DOMAIN=<project>.web.app
      AUTH_PLATFORM_ADMIN_EMAILS=<real operator allowlist>
    then unset those runtime values from the shell before validate/prepare/deploy
  - Resend/Twilio credentials, emulator/bypass flags, ambient runtime overrides,
    live Stripe mode/keys, service-account files, and legacy FIREBASE_TOKEN fail closed

validate performs Firebase read-only SDK-config lookup and safety checks.
prepare repeats validation and builds dist with a sanitized exact staging Vite environment.
deploy repeats prepare, requires the exact project+scope+SHA token, then performs the one
provider mutation: firebase deploy for Hosting + Functions + Firestore rules/indexes together.
`;

function cleanText(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }

  const command = cleanText(argv[0]);
  if (!COMMANDS.has(command)) {
    throw new Error("First argument must be one of: validate, prepare, deploy.");
  }

  const values = { command, projectId: "", confirmation: "" };
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--project", "--confirm"].includes(flag)) {
      throw new Error(`Unsupported staging argument: ${flag}.`);
    }
    if (seen.has(flag)) {
      throw new Error(`Duplicate staging argument: ${flag}.`);
    }
    seen.add(flag);
    const value = cleanText(argv[index + 1]);
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    if (flag === "--project") values.projectId = value;
    if (flag === "--confirm") values.confirmation = value;
    index += 1;
  }

  if (!values.projectId) {
    throw new Error("Pass the explicit staging Firebase project with --project.");
  }
  if (command !== "deploy" && values.confirmation) {
    throw new Error("--confirm is accepted only by the deploy subcommand.");
  }
  if (command === "deploy" && !values.confirmation) {
    throw new Error("The deploy subcommand requires the exact --confirm token printed by prepare.");
  }
  return values;
}

function runCaptured(command, args, { cwd = ROOT, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args[0] || "command"} failed.`);
  }
  return cleanText(result.stdout);
}

function runVisible(command, args, { cwd = ROOT, env = process.env, label } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit"
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label || command} failed.`);
  }
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function parseEnvFile(filePath, label) {
  try {
    return parseEnv(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`${label} must be a valid dotenv file.`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeCanonicalOrigin(remoteUrl) {
  return cleanText(remoteUrl)
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function readGitState() {
  const root = path.resolve(runCaptured("git", ["rev-parse", "--show-toplevel"]));
  if (root !== path.resolve(ROOT)) {
    throw new Error("Run the Firebase staging lane from the repository root.");
  }

  const remoteUrl = runCaptured("git", ["remote", "get-url", "origin"]);
  if (normalizeCanonicalOrigin(remoteUrl) !== "https://github.com/totallymajor/quoteflow") {
    throw new Error("origin must be the canonical TOTALLYMAJOR/quoteflow repository.");
  }

  const branch = runCaptured("git", ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const upstream = runCaptured("git", [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}"
  ]);
  const headSha = runCaptured("git", ["rev-parse", "HEAD"]);
  const status = runCaptured("git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all"
  ]);
  const remoteLine = runCaptured("git", [
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${branch}`
  ]);
  const remoteSha = cleanText(remoteLine.split(/\s+/)[0]);

  return assertStagingGitState({
    branch,
    upstream,
    headSha,
    remoteSha,
    status
  });
}

function assertProjectEnvironment(projectId) {
  for (const key of [
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT",
    "FIREBASE_PROJECT_ID"
  ]) {
    const configured = cleanText(process.env[key]);
    if (configured && configured !== projectId) {
      throw new Error(`${key} conflicts with the explicit Firebase staging project.`);
    }
  }
  if (cleanText(process.env.FIREBASE_CONFIG)) {
    throw new Error("FIREBASE_CONFIG is not accepted by the explicit Firebase staging lane.");
  }
}

function readFunctionsEnvironment(projectId) {
  const relativePath = `functions/.env.${projectId}`;
  const envPath = path.resolve(ROOT, relativePath);
  if (!fs.existsSync(envPath)) {
    throw new Error(`${relativePath} is required and must remain ignored by Git.`);
  }
  const stat = fs.lstatSync(envPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${relativePath} must be a regular non-symlink file.`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`${relativePath} must use mode 0600 (no group or other access).`);
  }

  const ignored = spawnSync("git", ["check-ignore", "--quiet", relativePath], {
    cwd: ROOT,
    stdio: "ignore"
  });
  if (ignored.status !== 0) {
    throw new Error(`${relativePath} must be ignored by Git before it may contain provider credentials.`);
  }

  const extraRuntimeFiles = fs.readdirSync(path.resolve(ROOT, "functions"))
    .filter((name) => name === ".env" || name.startsWith(".env."))
    .filter((name) => name !== ".env.example" && name !== `.env.${projectId}`);
  if (extraRuntimeFiles.length) {
    throw new Error(
      "The staging worktree must not contain other Functions runtime env files; use an isolated checkout."
    );
  }

  const contents = fs.readFileSync(envPath, "utf8");
  const env = parseEnvFile(envPath, relativePath);
  assertStagingFunctionsEnv({ projectId, env });
  return { env, digest: sha256(contents), path: envPath, relativePath };
}

function readFirebaseStagingConfig() {
  const configPath = path.resolve(ROOT, STAGING_CONFIG_FILE);
  if (!fs.existsSync(configPath) || !fs.lstatSync(configPath).isFile()) {
    throw new Error(`${STAGING_CONFIG_FILE} is required.`);
  }
  const contents = fs.readFileSync(configPath, "utf8");
  const config = readJsonFile(configPath, STAGING_CONFIG_FILE);
  assertFirebaseStagingConfig(config);
  return { digest: sha256(contents), path: configPath };
}

function parseFirebaseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Firebase CLI returned invalid JSON for ${label}.`);
  }
}

function readFirebaseWebSdkConfig(projectId) {
  runCaptured(FIREBASE_CLI, ["--version"]);
  const appsPayload = parseFirebaseJson(
    runCaptured(FIREBASE_CLI, ["apps:list", "--project", projectId, "--json"]),
    "apps:list"
  );
  const apps = Array.isArray(appsPayload?.result)
    ? appsPayload.result
    : Array.isArray(appsPayload?.result?.apps)
      ? appsPayload.result.apps
      : [];
  const webApps = apps.filter((app) => cleanText(app?.platform).toUpperCase() === "WEB");
  if (webApps.length !== 1) {
    throw new Error(`Expected exactly one Firebase Web app in ${projectId}; found ${webApps.length}.`);
  }
  const appId = cleanText(webApps[0]?.appId);
  if (!appId) {
    throw new Error("The Firebase Web app is missing its app id.");
  }

  const sdkPayload = parseFirebaseJson(
    runCaptured(FIREBASE_CLI, [
      "apps:sdkconfig",
      "WEB",
      appId,
      "--project",
      projectId,
      "--json"
    ]),
    "apps:sdkconfig"
  );
  const sdkConfig = sdkPayload?.result?.sdkConfig || {};
  if (cleanText(sdkConfig.appId) !== appId) {
    throw new Error("Firebase Web SDK config is not bound to the selected Web app.");
  }
  return sdkConfig;
}

function readBrowserSourceEnv({ projectId, sdkConfig }) {
  const merged = {};
  for (const fileName of VITE_ENV_FILES) {
    const filePath = path.resolve(ROOT, fileName);
    if (!fs.existsSync(filePath)) continue;
    const source = parseEnvFile(filePath, fileName);
    assertBrowserSourceSafety({
      projectId,
      env: source,
      sdkConfig,
      requireBuyerAccess: false
    });
    Object.assign(merged, source);
  }

  const ambientVite = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith("VITE_"))
  );
  Object.assign(merged, ambientVite);
  assertBrowserSourceSafety({
    projectId,
    env: merged,
    sdkConfig,
    requireBuyerAccess: true
  });
  return merged;
}

function sanitizedBuildEnvironment({ projectId, sdkConfig, sha, sourceEnv }) {
  const safeBase = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITE_"))
  );
  return {
    ...safeBase,
    GCLOUD_PROJECT: projectId,
    GOOGLE_CLOUD_PROJECT: projectId,
    FIREBASE_PROJECT_ID: projectId,
    ...buildExactStagingBrowserEnv({
      projectId,
      sourceEnv,
      sdkConfig,
      sha
    })
  };
}

function sanitizedFirebaseEnvironment(projectId) {
  const strippedNames = new Set([
    "APP_BASE_URL",
    "APP_BASE_DOMAIN",
    "AUTH_PLATFORM_ADMIN_EMAILS",
    "BUYER_ACCESS_ENABLED",
    "STRIPE_MODE",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NOTIFICATIONS_EMAIL_PROVIDER",
    "RESEND_API_KEY",
    "NOTIFICATIONS_SMS_PROVIDER",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
    "NOTIFICATIONS_OWNER_PHONE",
    "FIREBASE_CONFIG"
  ]);
  const safeBase = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => (
      !key.startsWith("VITE_") && !strippedNames.has(key)
    ))
  );
  return {
    ...safeBase,
    GCLOUD_PROJECT: projectId,
    GOOGLE_CLOUD_PROJECT: projectId,
    FIREBASE_PROJECT_ID: projectId
  };
}

function validateSnapshot(projectId) {
  assertStagingProjectId(projectId);
  assertProjectEnvironment(projectId);
  assertNoAmbientDeploymentCredentials(process.env);
  const git = readGitState();
  const config = readFirebaseStagingConfig();
  const functionsEnv = readFunctionsEnvironment(projectId);
  const sdkConfig = readFirebaseWebSdkConfig(projectId);
  const browserSourceEnv = readBrowserSourceEnv({ projectId, sdkConfig });

  return {
    browserSourceEnv,
    configDigest: config.digest,
    functionsEnvDigest: functionsEnv.digest,
    git,
    sdkConfig
  };
}

function assertSnapshotUnchanged(projectId, snapshot) {
  const git = readGitState();
  if (git.sha !== snapshot.git.sha || git.branch !== snapshot.git.branch) {
    throw new Error("Git branch or SHA changed after staging validation.");
  }
  const config = readFirebaseStagingConfig();
  if (config.digest !== snapshot.configDigest) {
    throw new Error(`${STAGING_CONFIG_FILE} changed after staging validation.`);
  }
  const functionsEnv = readFunctionsEnvironment(projectId);
  if (functionsEnv.digest !== snapshot.functionsEnvDigest) {
    throw new Error("The project-scoped Functions environment changed after staging validation.");
  }
}

function printPlan({ command, projectId, snapshot }) {
  const token = stagingConfirmationToken({ projectId, sha: snapshot.git.sha });
  console.log(`Firebase staging ${command} passed.`);
  console.log(`Project: ${projectId}`);
  console.log(`Branch: ${snapshot.git.branch}`);
  console.log(`SHA: ${snapshot.git.sha}`);
  console.log(`Scope: ${STAGING_DEPLOY_SCOPE}`);
  console.log(`App: ${stagingAppUrl(projectId)}`);
  console.log("Stripe: test mode (server-only key validated; value not printed)");
  console.log("Buyer access: enabled in browser and Functions runtime");
  console.log("Email/SMS: disabled");
  console.log(`Deploy confirmation: ${token}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const projectId = assertStagingProjectId(args.projectId);
  const snapshot = validateSnapshot(projectId);
  if (args.command === "deploy") {
    assertStagingConfirmation({
      projectId,
      sha: snapshot.git.sha,
      confirmation: args.confirmation
    });
  }

  if (args.command === "validate") {
    printPlan({ command: "validation", projectId, snapshot });
    return;
  }

  const buildEnv = sanitizedBuildEnvironment({
    projectId,
    sdkConfig: snapshot.sdkConfig,
    sha: snapshot.git.sha,
    sourceEnv: snapshot.browserSourceEnv
  });
  runVisible(NPM_CLI, ["run", "build", "--", "--mode", "staging"], {
    env: buildEnv,
    label: "Exact Firebase staging frontend build"
  });
  assertSnapshotUnchanged(projectId, snapshot);

  if (args.command === "prepare") {
    printPlan({ command: "preparation", projectId, snapshot });
    console.log("No provider state was mutated.");
    return;
  }

  runVisible(FIREBASE_CLI, firebaseStagingDeployArgs(projectId), {
    env: sanitizedFirebaseEnvironment(projectId),
    label: "Coordinated Firebase staging deployment"
  });
  printPlan({ command: "deployment", projectId, snapshot });
  console.log(`Hosted staging app: https://${stagingAppHost(projectId)}/app`);
}

main().catch((error) => {
  console.error(`Firebase staging lane failed: ${cleanText(error?.message) || "unknown error"}`);
  process.exitCode = 1;
});
