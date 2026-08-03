#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectId = process.env.E2E_FIREBASE_PROJECT_ID || "demo-e2e";
const orgId = process.env.E2E_FIREBASE_ORG_ID || "e2e-org";
const email = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const password = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";
const includeFunctions = ["1", "true", "yes", "on"].includes(
  String(process.env.E2E_INCLUDE_FUNCTIONS || "true").trim().toLowerCase()
);
const playwrightConfig = process.env.E2E_PLAYWRIGHT_CONFIG || "playwright.firebase.config.js";
const playwrightSpec = process.env.E2E_PLAYWRIGHT_SPEC || "e2e/firebase-auth-rules.smoke.spec.js";
const allowNonAuthoritativePricing = ["1", "true", "yes", "on"].includes(
  String(process.env.E2E_ALLOW_NON_AUTHORITATIVE_PRICING || "true").trim().toLowerCase()
);

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run("bash", ["./scripts/ensure-local-jre.sh"]);

const localJre = path.join(rootDir, ".cache", "tools", "jre21");
const env = {
  ...process.env,
  E2E_FIREBASE_PROJECT_ID: projectId,
  E2E_FIREBASE_ORG_ID: orgId,
  E2E_FIREBASE_EMAIL: email,
  E2E_FIREBASE_PASSWORD: password,
  E2E_PLAYWRIGHT_CONFIG: playwrightConfig,
  E2E_PLAYWRIGHT_SPEC: playwrightSpec,
  E2E_ALLOW_NON_AUTHORITATIVE_PRICING: allowNonAuthoritativePricing ? "true" : "false",
  E2E_FIREBASE_AUTH_EMULATOR_PORT: "9399",
  E2E_FIRESTORE_EMULATOR_PORT: "8383",
  E2E_FIREBASE_FUNCTIONS_EMULATOR_PORT: "5601",
  FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || "30000",
  TMPDIR: "/tmp",
  TMP: "/tmp",
  TEMP: "/tmp"
};

if (fs.existsSync(path.join(localJre, "bin", "java"))) {
  env.JAVA_HOME = localJre;
  env.PATH = `${path.join(localJre, "bin")}${path.delimiter}${process.env.PATH || ""}`;
}

run(
  "npx",
  [
    "firebase-tools",
    "--config",
    "firebase.e2e.json",
    "emulators:exec",
    "--project",
    projectId,
    "--only",
    includeFunctions ? "auth,firestore,functions" : "auth,firestore",
    "bash ./scripts/run-firebase-e2e-inner.sh"
  ],
  { env }
);
