#!/usr/bin/env node

process.env.E2E_INCLUDE_FUNCTIONS = "true";
process.env.E2E_ALLOW_NON_AUTHORITATIVE_PRICING = "false";
process.env.E2E_START_BLANK = "true";
process.env.E2E_PLAYWRIGHT_SPEC = "e2e/firebase-starter-catalog-onboarding.smoke.spec.js";

await import("./run-firebase-e2e.mjs");
