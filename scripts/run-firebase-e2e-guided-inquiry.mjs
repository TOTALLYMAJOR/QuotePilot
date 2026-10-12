#!/usr/bin/env node

process.env.E2E_FIREBASE_PROJECT_ID ||= "demo-guided-inquiry";
process.env.E2E_FIREBASE_ORG_ID ||= "e2e-inquiry-org";
process.env.E2E_FIREBASE_SECOND_ORG_ID ||= "e2e-inquiry-other-org";
process.env.E2E_INCLUDE_FUNCTIONS = "true";
process.env.E2E_ALLOW_NON_AUTHORITATIVE_PRICING = "false";
process.env.E2E_START_BLANK = "false";
process.env.E2E_SEED_SECOND_PRINCIPAL = "true";
process.env.E2E_PLAYWRIGHT_SPEC = "e2e/firebase-guided-inquiry.smoke.spec.js";
delete process.env.TENANT_WORKFLOW_ORGANIZATION_ID;
process.env.INQUIRY_SHOWCASE_ENABLED = "true";
process.env.INQUIRY_TURNSTILE_HOSTNAMES = "example.com";
process.env.INQUIRY_TURNSTILE_SECRET = "1x0000000000000000000000000000000AA";
process.env.INQUIRY_RATE_LIMIT_SECRET = "guided-inquiry-emulator-rate-limit-secret";
process.env.NOTIFICATIONS_EMAIL_PROVIDER = "none";
process.env.VITE_INQUIRY_SHOWCASE_ENABLED = "true";
process.env.VITE_INQUIRY_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";

await import("./run-firebase-e2e.mjs");
