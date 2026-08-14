"use strict";

const { createHash } = require("node:crypto");

const CONNECT_INTERFACE_SCHEMA_VERSION = 1;
const CONNECT_RECENT_AUTH_MAX_AGE_SECONDS = 300;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{20,80}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;

const CONNECTION_STATES = new Set([
  "not_started",
  "provisioning",
  "onboarding",
  "pending_review",
  "ready",
  "attention_required",
  "access_lost",
  "closed",
  "security_review"
]);
const ROUTING_STATES = new Set(["legacy_platform", "cutover_pending", "connect_direct", "paused"]);
const REQUIREMENT_STATES = new Set(["unknown", "clear", "due", "past_due", "unavailable"]);
const HEALTH_STATES = new Set(["unknown", "healthy", "attention", "unavailable"]);

class StripeConnectInterfaceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StripeConnectInterfaceError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function text(value, max = 256) {
  return String(value || "").trim().slice(0, max);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-argument", `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-argument", `${label} must contain only the exact supported fields.`);
  }
}

function boundedInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    fail("invalid-argument", `${label} is invalid.`);
  }
  return parsed;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function buildConnectMutationPayloadDigest(operation, request = {}) {
  return sha256(canonicalJson({
    schemaVersion: CONNECT_INTERFACE_SCHEMA_VERSION,
    operation,
    requestId: request.requestId,
    expectedRevision: request.expectedRevision,
    expectedGeneration: request.expectedGeneration
  }));
}

function normalizeMutationRequest(value, operation) {
  exactKeys(
    value,
    ["expectedGeneration", "expectedRevision", "payloadDigest", "requestId"],
    `${operation} request`
  );
  const request = Object.freeze({
    requestId: text(value.requestId, 80),
    payloadDigest: text(value.payloadDigest, 64).toLowerCase(),
    expectedRevision: boundedInteger(value.expectedRevision, "expectedRevision"),
    expectedGeneration: boundedInteger(value.expectedGeneration, "expectedGeneration")
  });
  if (!REQUEST_ID_PATTERN.test(request.requestId)) {
    fail("invalid-argument", "requestId must be 20-80 letters, numbers, or hyphens.");
  }
  if (!DIGEST_PATTERN.test(request.payloadDigest)) {
    fail("invalid-argument", "payloadDigest must be a lowercase SHA-256 digest.");
  }
  const expectedDigest = buildConnectMutationPayloadDigest(operation, request);
  if (request.payloadDigest !== expectedDigest) {
    fail("invalid-argument", "payloadDigest does not match the exact request payload.");
  }
  return request;
}

function normalizeStatusRequest(value) {
  exactKeys(value, [], "getStripeConnectStatus request");
  return Object.freeze({});
}

function assertAuthenticatedAdmin(auth = {}) {
  const uid = text(auth.uid, 160);
  const token = auth.token && typeof auth.token === "object" ? auth.token : {};
  const organizationId = text(token.organizationId, 160).toLowerCase();
  const role = text(token.role, 32).toLowerCase();
  const email = text(token.email, 320).toLowerCase();
  if (!uid || !SAFE_ID_PATTERN.test(uid) || !organizationId || !SAFE_ID_PATTERN.test(organizationId)) {
    fail("unauthenticated", "A verified organization session is required.");
  }
  if (role !== "admin") {
    fail("permission-denied", "Same-organization admin authority is required.");
  }
  if (token.email_verified !== true || !email) {
    fail("failed-precondition", "A verified email is required for Stripe settings.");
  }
  return Object.freeze({
    uid,
    organizationId,
    role,
    email,
    authTimeSeconds: Number(token.auth_time)
  });
}

function assertCanonicalOwner(actor, authority = {}) {
  const ownerUid = text(authority.ownerUid, 160);
  const authorityOrganizationId = text(authority.organizationId, 160).toLowerCase();
  if (!ownerUid || authorityOrganizationId !== actor.organizationId || ownerUid !== actor.uid) {
    fail("permission-denied", "Only the canonical organization owner can continue Stripe onboarding.");
  }
  return actor;
}

function assertRecentAuthentication(actor, nowMs = Date.now()) {
  const now = Number(nowMs);
  const authTime = Number(actor?.authTimeSeconds);
  if (!Number.isFinite(now) || !Number.isFinite(authTime) || authTime <= 0) {
    fail("failed-precondition", "Recent authentication is required before starting Stripe onboarding.");
  }
  const ageSeconds = Math.floor(now / 1000) - Math.floor(authTime);
  if (ageSeconds < -30 || ageSeconds > CONNECT_RECENT_AUTH_MAX_AGE_SECONDS) {
    fail("failed-precondition", "Your sign-in is no longer recent. Sign in again before starting Stripe onboarding.");
  }
  return Object.freeze({ ageSeconds: Math.max(0, ageSeconds) });
}

function assertAppCheck(app = null, expectedAppId = "") {
  const appId = text(app?.appId, 256);
  const expected = text(expectedAppId, 256);
  if (!expected) {
    fail("internal", "The exact Connect App Check application binding is unavailable.");
  }
  if (!appId) {
    fail("failed-precondition", "App verification is required before starting Stripe onboarding.");
  }
  if (appId !== expected) {
    fail("permission-denied", "App verification does not match the reviewed Connect application.");
  }
  return Object.freeze({ appId });
}

function assertConsumedAppCheck(app = null, expectedAppId = "") {
  const verified = assertAppCheck(app, expectedAppId);
  if (app?.alreadyConsumed === true) {
    fail("permission-denied", "This onboarding verification was already used. Refresh and try again.");
  }
  return Object.freeze({ appId: verified.appId, replayProtection: "consume_required" });
}

function enumValue(value, allowed, fallback) {
  const normalized = text(value, 64).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function isoOrEmpty(value) {
  const normalized = text(value, 64);
  if (!normalized) return "";
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function safeCount(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.min(parsed, 999) : 0;
}

function buildStripeConnectStatusV1({ actor, authority = {}, record = {}, nowMs = Date.now() } = {}) {
  if (!actor?.organizationId || text(authority.organizationId, 160).toLowerCase() !== actor.organizationId) {
    fail("permission-denied", "Stripe status is unavailable outside the current organization.");
  }
  const actorIsOwner = text(authority.ownerUid, 160) === actor.uid;
  const refreshedAtISO = isoOrEmpty(record.refreshedAtISO);
  const staleAfterSeconds = 300;
  const refreshedAtMs = Date.parse(refreshedAtISO);
  const stale = !Number.isFinite(refreshedAtMs) || Number(nowMs) - refreshedAtMs > staleAfterSeconds * 1000;
  const connectionState = enumValue(record.connectionState, CONNECTION_STATES, "not_started");
  const routingState = enumValue(record.routingState, ROUTING_STATES, "legacy_platform");
  const requirementState = enumValue(record.requirementState, REQUIREMENT_STATES, "unknown");
  const healthState = enumValue(record.healthState, HEALTH_STATES, "unknown");
  const generation = Number.isSafeInteger(Number(record.generation)) && Number(record.generation) >= 0
    ? Number(record.generation)
    : 0;
  const revision = Number.isSafeInteger(Number(record.revision)) && Number(record.revision) >= 0
    ? Number(record.revision)
    : 0;
  return Object.freeze({
    schemaVersion: CONNECT_INTERFACE_SCHEMA_VERSION,
    revision,
    generation,
    connection: Object.freeze({
      state: connectionState,
      confirmedAtISO: isoOrEmpty(record.connectionConfirmedAtISO),
      confirmedAttempt: DIGEST_PATTERN.test(text(record.connectionConfirmedAttemptDigest, 64).toLowerCase())
        ? text(record.connectionConfirmedAttemptDigest, 64).toLowerCase().slice(0, 24)
        : ""
    }),
    routing: Object.freeze({
      state: routingState,
      acceptsNewPayments: routingState === "connect_direct" && record.acceptsNewPayments === true
    }),
    requirements: Object.freeze({
      state: requirementState,
      currentlyDue: safeCount(record.currentlyDueCount),
      pastDue: safeCount(record.pastDueCount)
    }),
    health: Object.freeze({
      state: healthState,
      source: "connect_control_cache",
      refreshedAtISO,
      stale
    }),
    actions: Object.freeze({
      canRefresh: true,
      canBeginOnboarding: actorIsOwner && ["not_started", "attention_required"].includes(connectionState),
      canContinueOnboarding: actorIsOwner && ["onboarding", "pending_review", "attention_required"].includes(connectionState)
    })
  });
}

function buildConnectMutationReceiptV1({ operation, request, outcome, completedAtISO }) {
  const timestamp = isoOrEmpty(completedAtISO);
  if (!timestamp) fail("internal", "Mutation receipt completion time is invalid.");
  return Object.freeze({
    schemaVersion: CONNECT_INTERFACE_SCHEMA_VERSION,
    operation: text(operation, 80),
    requestId: request.requestId,
    payloadDigest: request.payloadDigest,
    revision: boundedInteger(outcome.revision, "receipt revision"),
    generation: boundedInteger(outcome.generation, "receipt generation"),
    state: text(outcome.state, 64).toLowerCase(),
    completedAtISO: timestamp
  });
}

module.exports = {
  CONNECT_INTERFACE_SCHEMA_VERSION,
  CONNECT_RECENT_AUTH_MAX_AGE_SECONDS,
  StripeConnectInterfaceError,
  assertAppCheck,
  assertAuthenticatedAdmin,
  assertCanonicalOwner,
  assertConsumedAppCheck,
  assertRecentAuthentication,
  buildConnectMutationPayloadDigest,
  buildConnectMutationReceiptV1,
  buildStripeConnectStatusV1,
  canonicalJson,
  normalizeMutationRequest,
  normalizeStatusRequest,
  sha256
};
