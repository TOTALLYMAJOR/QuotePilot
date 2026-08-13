#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const contracts = require(path.join(ROOT, "functions-connect", "interfaceContracts.js"));
const handoff = require(path.join(ROOT, "functions-connect", "onboardingHandoff.js"));

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
for (const moduleName of ["interfaceContracts", "onboardingHandoff", "statusOnboardingService"]) {
  if (indexSource.includes(moduleName)) fail(`${moduleName} must not be exported from the dormant codebase.`);
}

const source = [
  read("functions-connect/interfaceContracts.js"),
  read("functions-connect/onboardingHandoff.js"),
  read("functions-connect/statusOnboardingService.js")
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

console.log("Stripe Connect onboarding contracts are strict, redacted, one-use, adapter-only, and deploy-dormant.");
