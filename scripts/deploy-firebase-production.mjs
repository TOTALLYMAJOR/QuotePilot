#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ID = "tonicatering";
const FUNCTIONS_ENV_PATH = path.join(ROOT, "functions", `.env.${PROJECT_ID}`);
const FUNCTIONS_ENV_KEYS = [
  "APP_BASE_URL",
  "APP_BASE_DOMAIN",
  "AUTH_PLATFORM_ADMIN_EMAILS",
  "NOTIFICATIONS_EMAIL_PROVIDER",
  "EMAIL_FROM_NAME",
  "EMAIL_FROM_EMAIL",
  "RESEND_API_KEY",
  "NOTIFICATIONS_SMS_PROVIDER",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "NOTIFICATIONS_OWNER_PHONE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET"
];

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function validateArgs() {
  const args = process.argv.slice(2);
  const allowed = new Set(["--scope", "--confirm"]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!allowed.has(token)) {
      throw new Error(`Unknown argument: ${token}`);
    }
    if (!args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error(`${token} requires a value.`);
    }
    index += 1;
  }
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

function validateCleanPublishedRevision() {
  if (capture("git", ["status", "--porcelain"])) {
    throw new Error("Refusing production deployment from a dirty working tree.");
  }
  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error("Refusing production deployment from anything other than main.");
  }
  const head = capture("git", ["rev-parse", "HEAD"]);
  const upstream = capture("git", ["rev-parse", "@{upstream}"]);
  if (head !== upstream) {
    throw new Error("Refusing production deployment until HEAD matches its configured upstream.");
  }
  const remoteLine = capture("git", ["ls-remote", "--heads", "origin", "refs/heads/main"]);
  const remoteHead = remoteLine.split(/\s+/)[0] || "";
  if (!remoteHead || head !== remoteHead) {
    throw new Error("Refusing production deployment until HEAD matches origin/main.");
  }

  const releaseTags = capture("git", [
    "tag",
    "--points-at",
    "HEAD",
    "--list",
    "v[0-9]*.[0-9]*.[0-9]*"
  ])
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  const publishedTag = releaseTags.find((tag) => {
    const result = spawnSync(
      "git",
      ["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: false
      }
    );
    if (result.status !== 0) return false;
    return String(result.stdout || "")
      .split(/\r?\n/)
      .some((line) => line.split(/\s+/)[0] === head);
  });
  if (!publishedTag) {
    throw new Error(
      "Refusing production deployment until HEAD has a semantic release tag published to origin."
    );
  }
}

function validateFunctionsEnvironment() {
  if (!fs.existsSync(FUNCTIONS_ENV_PATH)) {
    throw new Error(`Missing ignored Functions environment: functions/.env.${PROJECT_ID}.`);
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
    throw new Error(`functions/.env.${PROJECT_ID} must be ignored by git.`);
  }

  const validationEnv = { ...process.env };
  for (const key of FUNCTIONS_ENV_KEYS) delete validationEnv[key];
  delete validationEnv.VITE_FIREBASE_PROJECT_ID;
  validationEnv.FIREBASE_PROJECT_ID = PROJECT_ID;
  run(
    process.execPath,
    [
      `--env-file=${FUNCTIONS_ENV_PATH}`,
      path.join(ROOT, "scripts", "materialize-functions-env.mjs"),
      "--validate-only"
    ],
    { env: validationEnv }
  );
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
  functions: {
    selector: "firestore,functions",
    confirmation: `DEPLOY ${PROJECT_ID} firestore,functions`,
    build: false,
    functions: true
  },
  all: {
    selector: "hosting:app,firestore,functions",
    confirmation: `DEPLOY ${PROJECT_ID} hosting:app,firestore,functions`,
    build: true,
    functions: true
  }
};
const selected = scopes[scope];

if (!selected) {
  throw new Error("--scope must be one of: hosting, functions, all.");
}
if (readArg("--confirm") !== selected.confirmation) {
  throw new Error(`Production deployment requires --confirm "${selected.confirmation}".`);
}

validateCleanPublishedRevision();
run("npm", ["run", "check:env"]);
if (selected.functions) validateFunctionsEnvironment();
if (selected.build) run("npm", ["run", "build"]);

if (scope !== "functions") {
  run("npx", [
    "firebase-tools",
    "target:apply",
    "hosting",
    "app",
    PROJECT_ID,
    "--project",
    PROJECT_ID
  ]);
}

const deployArgs = [
  "firebase-tools",
  "deploy",
  "--only",
  selected.selector,
  "--project",
  PROJECT_ID,
  "--non-interactive"
];
run("npx", deployArgs);
