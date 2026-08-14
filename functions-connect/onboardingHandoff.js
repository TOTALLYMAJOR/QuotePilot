"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");
const { canonicalJson, sha256, StripeConnectInterfaceError } = require("./interfaceContracts");

const HANDOFF_SCHEMA_VERSION = 2;
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

function deriveHandoffToken({
  organizationId,
  generation,
  revision,
  requestId,
  payloadDigest,
  ownerUid,
  authorityRevision,
  appIdDigest
} = {}, hmacKey) {
  return createHmac("sha256", requireHmacKey(hmacKey)).update(canonicalJson({
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    purpose: "stripe_connect_onboarding_handoff",
    organizationId,
    generation,
    revision,
    requestId,
    payloadDigest,
    ownerUid,
    authorityRevision,
    appIdDigest
  }), "utf8").digest("base64url");
}

function digestToken(token) {
  const protectedToken = text(token, 512);
  if (protectedToken.length < 32) fail("permission-denied", "This onboarding handoff is invalid or has already been used.");
  return sha256(canonicalJson({
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    purpose: "stripe_connect_onboarding_handoff_token",
    token: protectedToken
  }));
}

function safeReturnUrl(origin, state, attemptDigest) {
  const url = new URL("/app/integrations", origin);
  url.searchParams.set("focus", "stripe");
  url.searchParams.set("connect_return", state);
  url.searchParams.set("attempt", attemptDigest.slice(0, 24));
  return url.toString();
}

function buildOnboardingHandoffBrowser({ privateRecord = {}, canonicalReturnOrigin, hmacKey } = {}) {
  const origin = canonicalOrigin(canonicalReturnOrigin);
  const token = deriveHandoffToken(privateRecord, hmacKey);
  const tokenDigest = digestToken(token);
  const attemptDigest = sha256(canonicalJson({
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    organizationId: privateRecord.organizationId,
    generation: privateRecord.generation,
    revision: privateRecord.revision,
    requestId: privateRecord.requestId,
    payloadDigest: privateRecord.payloadDigest,
    ownerUid: privateRecord.ownerUid,
    authorityRevision: privateRecord.authorityRevision,
    appIdDigest: privateRecord.appIdDigest,
    tokenDigest
  }));
  if (
    Number(privateRecord.schemaVersion) !== HANDOFF_SCHEMA_VERSION
    || privateRecord.state !== "prepared"
    || !safeEqual(privateRecord.tokenDigest, tokenDigest)
    || !safeEqual(privateRecord.attemptDigest, attemptDigest)
    || !Number.isFinite(Date.parse(privateRecord.expiresAtISO || ""))
  ) {
    fail("data-loss", "The prepared onboarding handoff binding is invalid.");
  }
  return Object.freeze({
    handoffUrl: new URL("/stripe-connect/onboarding/handoff", origin).toString(),
    handoffMethod: "POST",
    handoffToken: token,
    expiresAtISO: new Date(Date.parse(privateRecord.expiresAtISO)).toISOString(),
    attempt: attemptDigest.slice(0, 24)
  });
}

function prepareOneUseOnboardingHandoff({
  organizationId,
  generation,
  revision,
  requestId,
  payloadDigest,
  ownerUid,
  authorityRevision,
  appIdDigest,
  canonicalReturnOrigin,
  hmacKey,
  nowMs = Date.now()
} = {}) {
  const token = deriveHandoffToken({
    organizationId,
    generation,
    revision,
    requestId,
    payloadDigest,
    ownerUid,
    authorityRevision,
    appIdDigest
  }, hmacKey);
  const origin = canonicalOrigin(canonicalReturnOrigin);
  if (
    token.length < 32
    || !organizationId
    || !requestId
    || !payloadDigest
    || !ownerUid
    || !Number.isSafeInteger(Number(authorityRevision))
    || Number(authorityRevision) < 1
    || !/^[a-f0-9]{64}$/.test(text(appIdDigest, 64).toLowerCase())
  ) {
    fail("failed-precondition", "The onboarding handoff cannot be prepared.");
  }
  const tokenDigest = digestToken(token);
  const expiresAtMs = Number(nowMs) + HANDOFF_MAX_AGE_SECONDS * 1000;
  const attemptDigest = sha256(canonicalJson({
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    organizationId,
    generation,
    revision,
    requestId,
    payloadDigest,
    ownerUid,
    authorityRevision,
    appIdDigest,
    tokenDigest
  }));
  const privateRecord = Object.freeze({
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      organizationId,
      generation,
      revision,
      requestId,
      payloadDigest,
      ownerUid,
      authorityRevision: Number(authorityRevision),
      appIdDigest: text(appIdDigest, 64).toLowerCase(),
      tokenDigest,
      attemptDigest,
      state: "prepared",
      createdAtISO: new Date(Number(nowMs)).toISOString(),
      expiresAtISO: new Date(expiresAtMs).toISOString()
    });
  return Object.freeze({
    browser: buildOnboardingHandoffBrowser({
      privateRecord,
      canonicalReturnOrigin: origin,
      hmacKey
    }),
    privateRecord
  });
}

function assertStripeAccountLink(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("unavailable", "Stripe onboarding did not return a usable handoff.");
  }
  const url = new URL(text(value.url, 4096));
  const expiresAtSeconds = Number(value.expiresAtSeconds);
  if (
    url.protocol !== "https:"
    || !STRIPE_ACCOUNT_LINK_HOSTS.has(url.hostname)
    || url.port
    || url.username
    || url.password
  ) {
    fail("unavailable", "Stripe onboarding returned an untrusted destination.");
  }
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0) {
    fail("unavailable", "Stripe onboarding returned an invalid expiry.");
  }
  return Object.freeze({ url: url.toString(), expiresAtSeconds });
}

function redirectResponse(location) {
  return Object.freeze({
    statusCode: 303,
    headers: Object.freeze({
      Location: location,
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "frame-ancestors 'none'"
    })
  });
}

async function consumeOneUseOnboardingHandoff({
  method,
  token,
  canonicalReturnOrigin,
  store,
  provider,
  now = () => Date.now()
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
  if (typeof now !== "function") fail("internal", "The onboarding handoff clock is unavailable.");
  const requestStartedAtMs = Number(now());
  if (!Number.isFinite(requestStartedAtMs)) fail("internal", "The onboarding handoff clock is invalid.");
  if (!text(token, 512)) fail("permission-denied", "This onboarding handoff is invalid or has already been used.");
  const tokenDigest = digestToken(token);
  const record = await store.consumePreparedHandoff({
    tokenDigest,
    nowISO: new Date(requestStartedAtMs).toISOString()
  });
  if (!record || !safeEqual(record.tokenDigest, tokenDigest)) {
    fail("permission-denied", "This onboarding handoff is invalid or has already been used.");
  }
  if (record.state !== "consumed" || Date.parse(record.expiresAtISO) <= requestStartedAtMs) {
    fail("failed-precondition", "This onboarding handoff expired. Return to Stripe settings to recover.");
  }
  const returnUrl = safeReturnUrl(canonicalReturnOrigin, "complete", record.attemptDigest);
  const refreshUrl = safeReturnUrl(canonicalReturnOrigin, "recover", record.attemptDigest);
  let providerLink;
  try {
    providerLink = assertStripeAccountLink(await provider.createAccountLink({
      privateAccountBinding: record.privateAccountBinding,
      returnUrl,
      refreshUrl,
      attemptDigest: record.attemptDigest
    }));
    const providerReturnedAtMs = Number(now());
    if (!Number.isFinite(providerReturnedAtMs)) {
      fail("internal", "The onboarding handoff clock is invalid after provider access.");
    }
    if (providerLink.expiresAtSeconds <= Math.floor(providerReturnedAtMs / 1000)) {
      fail("unavailable", "Stripe onboarding returned an expired handoff.");
    }
  } catch {
    // A failed or interrupted Account Link call can have an unknown provider
    // outcome. Leave the consumed attempt active until its local expiry so a
    // different request cannot silently create another bearer link.
    return redirectResponse(refreshUrl);
  }
  const providerReturnedAtMs = Number(now());
  if (!Number.isFinite(providerReturnedAtMs)) return redirectResponse(refreshUrl);
  const localCeilingSeconds = Math.floor(Date.parse(record.expiresAtISO) / 1000);
  const effectiveExpiresAtSeconds = Math.min(providerLink.expiresAtSeconds, localCeilingSeconds);
  if (effectiveExpiresAtSeconds <= Math.floor(providerReturnedAtMs / 1000)) {
    return redirectResponse(refreshUrl);
  }
  try {
    const issuance = await store.recordProviderExpiry({
      tokenDigest,
      attemptDigest: record.attemptDigest,
      expiresAtISO: new Date(effectiveExpiresAtSeconds * 1000).toISOString()
    });
    if (issuance?.state !== "provider_issued") return redirectResponse(refreshUrl);
  } catch {
    // Never disclose a provider URL when its post-provider authority/state
    // receipt could not be committed. The consumed attempt remains non-replayable.
    return redirectResponse(refreshUrl);
  }
  const disclosureAtMs = Number(now());
  if (
    !Number.isFinite(disclosureAtMs)
    || effectiveExpiresAtSeconds <= Math.floor(disclosureAtMs / 1000)
  ) {
    return redirectResponse(refreshUrl);
  }
  return redirectResponse(providerLink.url);
}

module.exports = {
  HANDOFF_MAX_AGE_SECONDS,
  HANDOFF_SCHEMA_VERSION,
  STRIPE_ACCOUNT_LINK_HOSTS,
  assertStripeAccountLink,
  buildOnboardingHandoffBrowser,
  consumeOneUseOnboardingHandoff,
  deriveHandoffToken,
  digestToken,
  prepareOneUseOnboardingHandoff
};
