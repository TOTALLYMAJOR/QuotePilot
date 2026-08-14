"use strict";

const { createHmac } = require("node:crypto");
const { canonicalJson, StripeConnectInterfaceError } = require("./interfaceContracts");
const { COLLECTIONS } = require("./connectControlRepository");

const RATE_LIMIT_SCHEMA_VERSION = 1;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;

const RATE_LIMIT_POLICIES = Object.freeze({
  refresh_status: Object.freeze([
    Object.freeze({ scope: "principal", limit: 6, windowSeconds: 5 * 60, minIntervalSeconds: 0 }),
    Object.freeze({ scope: "organization", limit: 6, windowSeconds: 5 * 60, minIntervalSeconds: 10 })
  ]),
  begin_onboarding: Object.freeze([
    Object.freeze({ scope: "principal", limit: 6, windowSeconds: 24 * 60 * 60, minIntervalSeconds: 0 }),
    Object.freeze({ scope: "organization", limit: 10, windowSeconds: 24 * 60 * 60, minIntervalSeconds: 0 })
  ]),
  prepare_onboarding_redirect: Object.freeze([
    Object.freeze({ scope: "principal", limit: 3, windowSeconds: 15 * 60, minIntervalSeconds: 0 }),
    Object.freeze({ scope: "organization", limit: 10, windowSeconds: 24 * 60 * 60, minIntervalSeconds: 0 })
  ])
});

class StripeConnectRateLimitError extends StripeConnectInterfaceError {
  constructor(message, retryAfterSeconds) {
    super("resource-exhausted", message);
    this.name = "StripeConnectRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function text(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function requireHmacKey(value) {
  const key = text(value, 4096);
  if (Buffer.byteLength(key, "utf8") < 32) fail("internal", "The Connect rate-limit key is unavailable.");
  return key;
}

function hmac(value, key) {
  return createHmac("sha256", key).update(String(value), "utf8").digest("hex");
}

function createConnectPrincipalHasher({ hmacKey } = {}) {
  const key = requireHmacKey(hmacKey);
  return async function hashPrincipal({ operation, organizationId, uid } = {}) {
    const normalizedOperation = text(operation, 80).toLowerCase();
    const normalizedOrganizationId = text(organizationId, 160);
    const normalizedUid = text(uid, 160);
    if (
      !SAFE_ID_PATTERN.test(normalizedOperation)
      || !SAFE_ID_PATTERN.test(normalizedOrganizationId)
      || !SAFE_ID_PATTERN.test(normalizedUid)
    ) {
      fail("invalid-argument", "The Connect rate-limit principal is invalid.");
    }
    return hmac(canonicalJson({
      schemaVersion: RATE_LIMIT_SCHEMA_VERSION,
      operation: normalizedOperation,
      organizationId: normalizedOrganizationId,
      uid: normalizedUid
    }), key);
  };
}

function normalizeConsumeInput(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-argument", "The Connect rate-limit request is invalid.");
  }
  const actual = Object.keys(value).sort();
  const expected = ["nowISO", "operation", "organizationId", "principalDigest"].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-argument", "The Connect rate-limit request contains unsupported fields.");
  }
  const operation = text(value.operation, 80).toLowerCase();
  const organizationId = text(value.organizationId, 160);
  const principalDigest = text(value.principalDigest, 64).toLowerCase();
  const nowMs = Date.parse(text(value.nowISO, 64));
  if (!RATE_LIMIT_POLICIES[operation]) fail("failed-precondition", "The Connect operation has no reviewed rate policy.");
  if (!SAFE_ID_PATTERN.test(organizationId) || !DIGEST_PATTERN.test(principalDigest) || !Number.isFinite(nowMs)) {
    fail("invalid-argument", "The Connect rate-limit request is invalid.");
  }
  return Object.freeze({ operation, organizationId, principalDigest, nowMs });
}

function createDurableConnectRateLimiter({ database, hmacKey } = {}) {
  if (!database || typeof database.doc !== "function" || typeof database.runTransaction !== "function") {
    fail("internal", "The durable Connect rate limiter is unavailable.");
  }
  const key = requireHmacKey(hmacKey);

  async function consume(value) {
    const input = normalizeConsumeInput(value);
    const organizationDigest = hmac(`organization\n${input.organizationId}`, key);
    const rules = RATE_LIMIT_POLICIES[input.operation].map((policy) => {
      const subjectDigest = policy.scope === "principal" ? input.principalDigest : organizationDigest;
      const bucketDigest = hmac(canonicalJson({
        schemaVersion: RATE_LIMIT_SCHEMA_VERSION,
        operation: input.operation,
        scope: policy.scope,
        subjectDigest,
        windowSeconds: policy.windowSeconds,
        limit: policy.limit,
        minIntervalSeconds: policy.minIntervalSeconds
      }), key);
      return Object.freeze({
        ...policy,
        subjectDigest,
        bucketDigest,
        ref: database.doc(`${COLLECTIONS.rateLimits}/${bucketDigest}`)
      });
    });

    try {
      return await database.runTransaction(async (transaction) => {
        const snapshots = [];
        for (const rule of rules) snapshots.push(await transaction.get(rule.ref));
        const updates = rules.map((rule, index) => {
          const existing = snapshots[index]?.exists ? snapshots[index].data() : null;
          if (existing && (
            existing.bucketDigest !== rule.bucketDigest
            || existing.operation !== input.operation
            || existing.scope !== rule.scope
            || existing.subjectDigest !== rule.subjectDigest
            || Number(existing.limit) !== rule.limit
            || Number(existing.windowSeconds) !== rule.windowSeconds
            || Number(existing.minIntervalSeconds || 0) !== rule.minIntervalSeconds
          )) {
            fail("data-loss", "The Connect rate-limit bucket binding is invalid.");
          }
          const windowStartMs = input.nowMs - rule.windowSeconds * 1000;
          const priorEvents = Array.isArray(existing?.eventsAtMs) ? existing.eventsAtMs : [];
          const activeEvents = priorEvents
            .map(Number)
            .filter((eventMs) => Number.isSafeInteger(eventMs) && eventMs > windowStartMs && eventMs <= input.nowMs)
            .sort((left, right) => left - right);
          const lastEventAtMs = activeEvents.at(-1);
          if (
            rule.minIntervalSeconds > 0
            && Number.isSafeInteger(lastEventAtMs)
            && input.nowMs < lastEventAtMs + rule.minIntervalSeconds * 1000
          ) {
            throw new StripeConnectRateLimitError(
              "Stripe settings are receiving requests too quickly. Wait before trying again.",
              Math.max(1, Math.ceil(
                (lastEventAtMs + rule.minIntervalSeconds * 1000 - input.nowMs) / 1000
              ))
            );
          }
          if (activeEvents.length >= rule.limit) {
            const retryAtMs = activeEvents[0] + rule.windowSeconds * 1000 + 1;
            throw new StripeConnectRateLimitError(
              "Stripe settings are receiving too many requests. Wait before trying again.",
              Math.max(1, Math.ceil((retryAtMs - input.nowMs) / 1000))
            );
          }
          const eventsAtMs = [...activeEvents, input.nowMs];
          return Object.freeze({
            ref: rule.ref,
            record: {
              schemaVersion: RATE_LIMIT_SCHEMA_VERSION,
              bucketDigest: rule.bucketDigest,
              operation: input.operation,
              scope: rule.scope,
              subjectDigest: rule.subjectDigest,
              limit: rule.limit,
              windowSeconds: rule.windowSeconds,
              minIntervalSeconds: rule.minIntervalSeconds,
              eventsAtMs,
              updatedAtISO: new Date(input.nowMs).toISOString(),
              expiresAt: new Date(eventsAtMs.at(-1) + rule.windowSeconds * 1000)
            }
          });
        });
        for (const update of updates) transaction.set(update.ref, update.record);
        return Object.freeze({ allowed: true, operation: input.operation, retryAfterSeconds: 0 });
      });
    } catch (error) {
      if (error instanceof StripeConnectInterfaceError) throw error;
      fail("internal", "The durable Connect rate limiter could not verify this request.");
    }
  }

  return Object.freeze({ consume });
}

module.exports = {
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCHEMA_VERSION,
  StripeConnectRateLimitError,
  createConnectPrincipalHasher,
  createDurableConnectRateLimiter,
  normalizeConsumeInput
};
