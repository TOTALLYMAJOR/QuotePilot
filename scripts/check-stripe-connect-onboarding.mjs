#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const contracts = require(path.join(ROOT, "functions-connect", "interfaceContracts.js"));
const handoff = require(path.join(ROOT, "functions-connect", "onboardingHandoff.js"));
const repository = require(path.join(ROOT, "functions-connect", "connectControlRepository.js"));
const limiter = require(path.join(ROOT, "functions-connect", "durableRateLimiter.js"));
const adapter = require(path.join(ROOT, "functions-connect", "stripeSandboxAdapter.js"));

function fail(message) {
  throw new Error(`Stripe Connect onboarding source check failed: ${message}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const indexSource = read("functions-connect/index.js");
if (!indexSource.includes("module.exports = Object.freeze({});")) {
  fail("functions-connect must remain deploy-empty before the applied infrastructure and App Check gates.");
}
for (const moduleName of [
  "interfaceContracts",
  "onboardingHandoff",
  "statusOnboardingService",
  "connectControlRepository",
  "durableRateLimiter",
  "stripeSandboxAdapter"
]) {
  if (indexSource.includes(moduleName)) fail(`${moduleName} must not be exported from the dormant codebase.`);
}

const source = [
  read("functions-connect/interfaceContracts.js"),
  read("functions-connect/onboardingHandoff.js"),
  read("functions-connect/statusOnboardingService.js"),
  read("functions-connect/connectControlRepository.js"),
  read("functions-connect/durableRateLimiter.js"),
  read("functions-connect/stripeSandboxAdapter.js")
].join("\n");
if (/require\(["']stripe["']\)|\bnew\s+Stripe\b|\bonCall\b|\bonRequest\b/.test(source)) {
  fail("dormant interface source must use injected adapters and expose no function or Stripe runtime.");
}
if (/\b(?:console|functions\.logger)\s*\./.test(source)) {
  fail("onboarding source must not log provider links, handoff tokens, or private bindings.");
}
for (const forbidden of ["application_fee_amount", "transfer_data", "on_behalf_of"]) {
  if (source.includes(forbidden)) fail(`${forbidden} is outside the zero-platform-fee direct-charge model.`);
}
if (!source.includes("principalDigest") || /\bprincipal:\s*actor\.uid\b/.test(source)) {
  fail("durable rate-limit storage must receive only a separately HMAC-hashed principal digest.");
}
const repositorySource = read("functions-connect/connectControlRepository.js");
if (!repositorySource.includes('databaseId !== CONNECT_DATABASE_ID')
  || !repositorySource.includes('getFirestore(firebaseApp, CONNECT_DATABASE_ID)')
  || /getFirestore\(firebaseApp\)(?!\s*,)/.test(repositorySource)) {
  fail("the Connect repository must select only the exact named database and never the default database.");
}
const limiterSource = read("functions-connect/durableRateLimiter.js");
if (!limiterSource.includes("database.runTransaction")
  || !limiterSource.includes("createHmac")
  || !limiterSource.includes("fail(\"internal\", \"The durable Connect rate limiter could not verify this request.\")")) {
  fail("the Connect limiter must be transactional, HMAC-scoped, and fail closed.");
}
const adapterSource = read("functions-connect/stripeSandboxAdapter.js");
if (!adapterSource.includes("stripeClient?.v2?.core?.accounts")
  || !adapterSource.includes("stripeClient?.v2?.core?.accountLinks")
  || adapterSource.includes('require("stripe")')
  || /\bnew\s+Stripe\b/.test(adapterSource)) {
  fail("the Sandbox adapter must use only an injected Accounts v2 client.");
}
if (adapter.REVIEWED_CONFIGURATION.chargePattern !== "direct"
  || adapter.REVIEWED_CONFIGURATION.platformApplicationFee !== false
  || adapter.REVIEWED_CONFIGURATION.dashboard !== "full"
  || adapter.REVIEWED_CONFIGURATION.feesCollector !== "stripe"
  || adapter.REVIEWED_CONFIGURATION.lossesCollector !== "stripe") {
  fail("the Sandbox adapter must retain the approved direct-charge responsibility model.");
}
if (!repository.COLLECTIONS.rateLimits || limiter.RATE_LIMIT_POLICIES.begin_onboarding.length < 2) {
  fail("the named repository and multi-window onboarding rate policy are incomplete.");
}

const request = {
  requestId: "onboarding-policy-request-0001",
  expectedRevision: 0,
  expectedGeneration: 0
};
request.payloadDigest = contracts.buildConnectMutationPayloadDigest("beginStripeConnectOnboarding", request);
contracts.normalizeMutationRequest(request, "beginStripeConnectOnboarding");
try {
  contracts.normalizeMutationRequest(
    { ...request, organizationId: "browser_scope_must_fail" },
    "beginStripeConnectOnboarding"
  );
  fail("browser mutation schemas must reject organizationId.");
} catch (error) {
  if (!(error instanceof contracts.StripeConnectInterfaceError)) throw error;
}

const prepared = handoff.prepareOneUseOnboardingHandoff({
  organizationId: "policy_org",
  generation: 0,
  revision: 0,
  requestId: request.requestId,
  payloadDigest: request.payloadDigest,
  canonicalReturnOrigin: "https://quotepilot-staging-20260804.web.app",
  hmacKey: "source-policy-handoff-key-with-at-least-thirty-two-bytes",
  nowMs: Date.parse("2026-08-13T12:00:00.000Z"),
  randomToken: () => "source-policy-one-use-token-32-bytes"
});
if (!prepared.browser.handoffUrl.startsWith("https://quotepilot-staging-20260804.web.app/")) {
  fail("the browser handoff must stay on the exact staging origin.");
}
if (prepared.browser.handoffUrl.includes("stripe.com")) {
  fail("application JavaScript must never receive a Stripe Account Link URL.");
}
if (prepared.browser.handoffMethod !== "POST" || prepared.browser.handoffUrl.includes(prepared.browser.handoffToken)) {
  fail("the one-use handoff token must travel in the same-tab POST body, never the URL.");
}
if (JSON.stringify(prepared.privateRecord).includes("source-policy-one-use-token-32-bytes")) {
  fail("the raw one-use handoff token must not be persisted.");
}

console.log("Stripe Connect onboarding contracts are strict, redacted, named-database-only, rate-limited, Sandbox-adapter-only, and deploy-dormant.");
