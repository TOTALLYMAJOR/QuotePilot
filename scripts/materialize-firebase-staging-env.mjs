#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  assertStagingFunctionsEnv,
  assertStagingProjectId,
  normalizePlatformAdminAllowlist,
  stagingAppHost,
  stagingAppUrl
} from "./firebase-staging-contract.mjs";

const ROOT = process.cwd();
const REQUIRED_ENV_NAMES = Object.freeze([
  "APP_BASE_URL",
  "APP_BASE_DOMAIN",
  "AUTH_PLATFORM_ADMIN_EMAILS",
  "NOTIFICATIONS_EMAIL_PROVIDER",
  "NOTIFICATIONS_SMS_PROVIDER",
  "BUYER_ACCESS_ENABLED",
  "STRIPE_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET"
]);
const OPTIONAL_DISABLED_CREDENTIAL_NAMES = Object.freeze([
  "RESEND_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "NOTIFICATIONS_OWNER_PHONE"
]);

function text(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const result = { projectId: "", replace: false, confirmation: "" };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--project", "--replace", "--confirm"].includes(flag)) {
      throw new Error(`Unsupported staging environment argument: ${flag}.`);
    }
    if (seen.has(flag)) {
      throw new Error(`Duplicate staging environment argument: ${flag}.`);
    }
    seen.add(flag);
    if (flag === "--replace") {
      result.replace = true;
      continue;
    }
    const value = text(argv[index + 1]);
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    if (flag === "--project") result.projectId = value;
    if (flag === "--confirm") result.confirmation = value;
    index += 1;
  }
  if (!result.projectId) {
    throw new Error("Pass the explicit staging Firebase project with --project.");
  }
  if (result.confirmation && !result.replace) {
    throw new Error("--confirm is valid only with --replace.");
  }
  return result;
}

function helpText() {
  return `QuotePilot Firebase staging Functions environment materializer

Usage:
  npm run staging:firebase:env -- --project quotepilot-staging-<name>

Required process environment values (values are never printed):
  APP_BASE_URL=https://<project>.web.app/app
  APP_BASE_DOMAIN=<project>.web.app
  AUTH_PLATFORM_ADMIN_EMAILS=<comma-separated real operator emails>
  NOTIFICATIONS_EMAIL_PROVIDER=none
  NOTIFICATIONS_SMS_PROVIDER=none
  BUYER_ACCESS_ENABLED=true
  STRIPE_MODE=test
  STRIPE_SECRET_KEY=<prefer rk_test_; sk_test_ is accepted>
  STRIPE_WEBHOOK_SECRET=<test endpoint signing secret>

The command validates the complete test-only contract, then creates the ignored
functions/.env.<project> as mode 0600. It never calls Firebase or Stripe.

Existing files are never overwritten by default. After reviewing the existing file,
replacement requires both --replace and this exact project-bound token:
  --confirm "REPLACE functions/.env.<project> FOR <project>"

Unset the provider values from the shell after materialization. The deploy lane rejects
ambient runtime overrides and reads only this ignored project-scoped file.
`;
}

function assertRepositoryRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  if (result.error || result.status !== 0) {
    throw new Error("Run the staging environment materializer from a Git repository root.");
  }
  if (path.resolve(text(result.stdout)) !== path.resolve(ROOT)) {
    throw new Error("Run the staging environment materializer from the repository root.");
  }
}

function assertProjectEnvironment(projectId) {
  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "FIREBASE_PROJECT_ID"]) {
    const configured = text(process.env[key]);
    if (configured && configured !== projectId) {
      throw new Error(`${key} conflicts with the explicit Firebase staging project.`);
    }
  }
}

export function collectStagingFunctionsEnvironment(projectId, source = process.env) {
  const env = {};
  for (const key of [...REQUIRED_ENV_NAMES, ...OPTIONAL_DISABLED_CREDENTIAL_NAMES]) {
    env[key] = text(source[key]);
  }
  env.AUTH_PLATFORM_ADMIN_EMAILS = normalizePlatformAdminAllowlist(
    env.AUTH_PLATFORM_ADMIN_EMAILS
  );
  assertStagingFunctionsEnv({ projectId, env });
  return env;
}

export function assertStagingEnvironmentPathIgnored(relativePath, root = ROOT) {
  const result = spawnSync("git", ["check-ignore", "--quiet", relativePath], {
    cwd: root,
    stdio: "ignore"
  });
  if (result.status !== 0) {
    throw new Error(`${relativePath} must be ignored by Git before materialization.`);
  }
}

export function renderStagingFunctionsEnvironment(env) {
  const ordered = [
    "APP_BASE_URL",
    "APP_BASE_DOMAIN",
    "AUTH_PLATFORM_ADMIN_EMAILS",
    "NOTIFICATIONS_EMAIL_PROVIDER",
    "NOTIFICATIONS_SMS_PROVIDER",
    "BUYER_ACCESS_ENABLED",
    "STRIPE_MODE",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET"
  ];
  return [
    "# Generated by npm run staging:firebase:env. Ignored by Git; never commit.",
    "# Initial hosted buyer-access smoke: Stripe test mode, email off, SMS off.",
    ...ordered.map((key) => `${key}=${env[key]}`),
    ""
  ].join("\n");
}

function writeCreateOnly(outputPath, contents) {
  fs.writeFileSync(outputPath, contents, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  fs.chmodSync(outputPath, 0o600);
}

function writeAtomicReplacement(outputPath, contents) {
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, outputPath);
    fs.chmodSync(outputPath, 0o600);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

export function stagingEnvironmentReplacementConfirmation(projectId) {
  const target = assertStagingProjectId(projectId);
  return `REPLACE functions/.env.${target} FOR ${target}`;
}

export function materializeStagingFunctionsEnvironment({
  root = ROOT,
  projectId,
  env,
  replace = false,
  confirmation = ""
}) {
  const target = assertStagingProjectId(projectId);
  const normalizedEnv = {
    ...env,
    AUTH_PLATFORM_ADMIN_EMAILS: normalizePlatformAdminAllowlist(
      env?.AUTH_PLATFORM_ADMIN_EMAILS
    )
  };
  assertStagingFunctionsEnv({ projectId: target, env: normalizedEnv });
  const relativePath = `functions/.env.${target}`;
  const outputPath = path.resolve(root, relativePath);
  assertStagingEnvironmentPathIgnored(relativePath, root);
  const contents = renderStagingFunctionsEnvironment(normalizedEnv);
  const exists = fs.existsSync(outputPath);
  const expectedConfirmation = stagingEnvironmentReplacementConfirmation(target);

  if (exists) {
    const stat = fs.lstatSync(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${relativePath} must be a regular non-symlink file.`);
    }
    if (!replace) {
      throw new Error(
        `${relativePath} already exists. Refusing to overwrite it; use --replace only after review.`
      );
    }
    if (text(confirmation) !== expectedConfirmation) {
      throw new Error(`Replacing ${relativePath} requires --confirm "${expectedConfirmation}".`);
    }
    writeAtomicReplacement(outputPath, contents);
  } else {
    if (replace) {
      throw new Error(`--replace is invalid because ${relativePath} does not exist.`);
    }
    writeCreateOnly(outputPath, contents);
  }

  return { relativePath, replaced: exists };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(helpText());
    return;
  }

  const projectId = assertStagingProjectId(args.projectId);
  assertRepositoryRoot();
  assertProjectEnvironment(projectId);
  const env = collectStagingFunctionsEnvironment(projectId, process.env);
  const { relativePath } = materializeStagingFunctionsEnvironment({
    root: ROOT,
    projectId,
    env,
    replace: args.replace,
    confirmation: args.confirmation
  });

  console.log(`Validated staging Functions environment written to ${relativePath}.`);
  console.log(`Project: ${projectId}`);
  console.log(`App URL: ${stagingAppUrl(projectId)}`);
  console.log(`App host: ${stagingAppHost(projectId)}`);
  console.log("Stripe: test mode (credential values not printed)");
  console.log("Buyer access: enabled; email/SMS: disabled");
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedUrl) {
  try {
    main();
  } catch (error) {
    console.error(`Firebase staging environment failed: ${text(error?.message) || "unknown error"}`);
    process.exitCode = 1;
  }
}
