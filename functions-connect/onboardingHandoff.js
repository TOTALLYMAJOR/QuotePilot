"use strict";

const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
const { canonicalJson, sha256, StripeConnectInterfaceError } = require("./interfaceContracts");

const HANDOFF_SCHEMA_VERSION = 1;
const HANDOFF_MAX_AGE_SECONDS = 600;
const STRIPE_ACCOUNT_LINK_HOSTS = Object.freeze(new Set(["accounts.stripe.com", "connect.stripe.com"]));

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function text(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left), "utf8");
  const b = Buffer.from(String(right), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireHmacKey(value) {
  const key = text(value, 4096);
  if (Buffer.byteLength(key, "utf8") < 32) fail("internal", "The onboarding handoff key is unavailable.");
  return key;
}

function canonicalOrigin(value) {
  const input = text(value, 2048);
  const url = new URL(input);
  if (url.protocol !== "https:" || input !== url.origin) {
    fail("internal", "The onboarding return origin is invalid.");
  }
  return url.origin;
}

function digestToken(token, hmacKey) {
  return createHmac("sha256", requireHmacKey(hmacKey)).update(text(token, 512), "utf8").digest("hex");
}

function safeReturnUrl(origin, state, attemptDigest) {
  const url = new URL("/app/integrations", origin);
  url.searchParams.set("focus", "stripe");
  url.searchParams.set("connect_return", state);
  url.searchParams.set("attempt", attemptDigest.slice(0, 24));
  return url.toString();
}

function prepareOneUseOnboardingHandoff({
  organizationId,
  generation,
  revision,
  requestId,
  payloadDigest,
  canonicalReturnOrigin,
  hmacKey,
  nowMs = Date.now(),
  randomToken = () => randomBytes(32).toString("base64url")
} = {}) {
  const token = text(randomToken(), 512);
  const origin = canonicalOrigin(canonicalReturnOrigin);
  if (token.length < 32 || !organizationId || !requestId || !payloadDigest) {
    fail("failed-precondition", "The onboarding handoff cannot be prepared.");
  }
  const tokenDigest = digestToken(token, hmacKey);
  const expiresAtMs = Number(nowMs) + HANDOFF_MAX_AGE_SECONDS * 1000;
  const attemptDigest = sha256(canonicalJson({
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    organizationId,
    generation,
    revision,
    requestId,
    payloadDigest,
    tokenDigest,
    expiresAtMs
  }));
  const handoffUrl = new URL("/stripe-connect/onboarding/handoff", origin).toString();
  return Object.freeze({
    browser: Object.freeze({
      handoffUrl,
      handoffMethod: "POST",
      handoffToken: token,
      expiresAtISO: new Date(expiresAtMs).toISOString(),
      attempt: attemptDigest.slice(0, 24)
    }),
    privateRecord: Object.freeze({
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      organizationId,
      generation,
      revision,
      requestId,
      payloadDigest,
      tokenDigest,
      attemptDigest,
      state: "prepared",
      createdAtISO: new Date(Number(nowMs)).toISOString(),
      expiresAtISO: new Date(expiresAtMs).toISOString()
    })
  });
}

function assertStripeAccountLink(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("unavailable", "Stripe onboarding did not return a usable handoff.");
  }
  const url = new URL(text(value.url, 4096));
  const expiresAtSeconds = Number(value.expiresAtSeconds);
  if (url.protocol !== "https:" || !STRIPE_ACCOUNT_LINK_HOSTS.has(url.hostname) || url.username || url.password) {
    fail("unavailable", "Stripe onboarding returned an untrusted destination.");
  }
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0) {
    fail("unavailable", "Stripe onboarding returned an invalid expiry.");
  }
  return Object.freeze({ url: url.toString(), expiresAtSeconds });
}

async function consumeOneUseOnboardingHandoff({
  method,
  token,
  hmacKey,
  canonicalReturnOrigin,
  store,
  provider,
  nowMs = Date.now()
} = {}) {
  if (!store || typeof store.consumePreparedHandoff !== "function" || typeof store.recordProviderExpiry !== "function") {
    fail("internal", "The onboarding handoff store is unavailable.");
  }
  if (!provider || typeof provider.createAccountLink !== "function") {
    fail("internal", "The Stripe onboarding provider is unavailable.");
  }
  if (text(method, 16).toUpperCase() !== "POST") {
    fail("permission-denied", "Stripe onboarding requires the one-use same-tab POST handoff.");
  }
  if (!text(token, 512)) fail("permission-denied", "This onboarding handoff is invalid or has already been used.");
  const tokenDigest = digestToken(token, hmacKey);
  const record = await store.consumePreparedHandoff({ tokenDigest, nowISO: new Date(Number(nowMs)).toISOString() });
  if (!record || !safeEqual(record.tokenDigest, tokenDigest)) {
    fail("permission-denied", "This onboarding handoff is invalid or has already been used.");
  }
  if (record.state !== "consumed" || Date.parse(record.expiresAtISO) <= Number(nowMs)) {
    fail("failed-precondition", "This onboarding handoff expired. Return to Stripe settings to recover.");
  }
  const returnUrl = safeReturnUrl(canonicalReturnOrigin, "complete", record.attemptDigest);
  const refreshUrl = safeReturnUrl(canonicalReturnOrigin, "recover", record.attemptDigest);
  try {
    const providerLink = assertStripeAccountLink(await provider.createAccountLink({
      privateAccountBinding: record.privateAccountBinding,
      returnUrl,
      refreshUrl,
      attemptDigest: record.attemptDigest
    }));
    if (providerLink.expiresAtSeconds <= Math.floor(Number(nowMs) / 1000)) {
      fail("unavailable", "Stripe onboarding returned an expired handoff.");
    }
    const localCeilingSeconds = Math.floor(Number(nowMs) / 1000) + HANDOFF_MAX_AGE_SECONDS;
    const effectiveExpiresAtSeconds = Math.min(providerLink.expiresAtSeconds, localCeilingSeconds);
    await store.recordProviderExpiry({
      tokenDigest,
      attemptDigest: record.attemptDigest,
      expiresAtISO: new Date(effectiveExpiresAtSeconds * 1000).toISOString()
    });
    return Object.freeze({
      statusCode: 303,
      headers: Object.freeze({
        Location: providerLink.url,
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "frame-ancestors 'none'"
      })
    });
  } catch (error) {
    if (typeof store.recordHandoffFailure === "function") {
      await store.recordHandoffFailure({
        tokenDigest,
        attemptDigest: record.attemptDigest,
        reason: error instanceof StripeConnectInterfaceError ? error.code : "provider_unavailable"
      });
    }
    return Object.freeze({
      statusCode: 303,
      headers: Object.freeze({
        Location: refreshUrl,
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "frame-ancestors 'none'"
      })
    });
  }
}

module.exports = {
  HANDOFF_MAX_AGE_SECONDS,
  HANDOFF_SCHEMA_VERSION,
  STRIPE_ACCOUNT_LINK_HOSTS,
  assertStripeAccountLink,
  consumeOneUseOnboardingHandoff,
  digestToken,
  prepareOneUseOnboardingHandoff
};
