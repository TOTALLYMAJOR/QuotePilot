#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const policy = require(path.join(ROOT, "functions-connect", "runtimePolicy.js"));

function fail(message) {
  throw new Error(`Stripe Connect foundation check failed: ${message}`);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function assertPackagePin(directory, dependency, version) {
  const packageJson = readJson(`${directory}/package.json`);
  const lock = readJson(`${directory}/package-lock.json`);
  if (packageJson.dependencies?.[dependency] !== version) {
    fail(`${directory} must pin ${dependency}@${version} exactly.`);
  }
  if (lock.packages?.[`node_modules/${dependency}`]?.version !== version) {
    fail(`${directory}/package-lock.json does not resolve ${dependency}@${version}.`);
  }
}

assertPackagePin("functions", "stripe", policy.LEGACY_STRIPE_SDK_VERSION);
assertPackagePin("functions-connect", "stripe", policy.STRIPE_CONNECT_SDK_VERSION);
assertPackagePin("functions-connect", "firebase-admin", "14.2.0");
assertPackagePin("functions-connect", "firebase-functions", "7.3.2");
if (readJson("functions-connect/package.json").overrides?.uuid !== "11.1.1") {
  fail("functions-connect must keep the reviewed uuid security override pinned exactly.");
}

const firebase = readJson("firebase.json");
if (!Array.isArray(firebase.functions) || firebase.functions.length !== 2) {
  fail("firebase.json must declare exactly the default and connect Functions codebases.");
}
const codebases = Object.fromEntries(firebase.functions.map((entry) => [entry.codebase, entry.source]));
if (codebases.default !== "functions" || codebases.connect !== "functions-connect") {
  fail("Firebase Functions codebase/source mapping is not exact.");
}

const connectIndex = fs.readFileSync(path.join(ROOT, "functions-connect", "index.js"), "utf8");
if (!connectIndex.includes("module.exports = Object.freeze({});")) {
  fail("the Connect codebase must remain deploy-empty during foundation work.");
}
if (/\b(?:onCall|onRequest|onSchedule|new\s+Stripe|accounts\.|checkout\.)\b/.test(connectIndex)) {
  fail("provider or deployed function behavior appeared before the foundation gate.");
}

const manifest = readJson("config/stripe-connect/staging-foundation.json");
policy.validateStripeConnectFoundationManifest(manifest);

for (const relativePath of [
  "scripts/deploy-firebase-production.mjs",
  "scripts/deploy-release-candidate.mjs",
  "scripts/prepare-production-artifact.mjs"
]) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  if (!source.includes("functions:default")) {
    fail(`${relativePath} must select the legacy default codebase explicitly.`);
  }
}

const laneClassifier = fs.readFileSync(path.join(ROOT, "scripts", "ci-lane-classifier.mjs"), "utf8");
if (
  !laneClassifier.includes('"functions-connect/"')
  || !laneClassifier.includes('"config/stripe-connect/"')
  || !laneClassifier.includes('"infra/stripe-connect/"')
) {
  fail("Connect runtime, manifest, and infrastructure changes must remain high-risk CI inputs.");
}
const secretScanner = fs.readFileSync(path.join(ROOT, "scripts", "check-secret-assets.mjs"), "utf8");
if (
  !secretScanner.includes('"functions-connect/"')
  || !secretScanner.includes('"config/stripe-connect/"')
  || !secretScanner.includes('"infra/stripe-connect/"')
) {
  fail("Connect runtime, manifest, and infrastructure files must remain in the tracked secret scan.");
}

console.log("Stripe Connect foundation is isolated, deploy-empty, exactly pinned, and provider-disabled.");
