"use strict";

const { createHash, createHmac } = require("node:crypto");

const OWNER_SMS_ATTEMPT_SCHEMA_VERSION = 1;
const OWNER_SMS_ATTEMPT_STATES = Object.freeze({
  QUEUED: "queued",
  DISPATCHING: "dispatching",
  PROVIDER_ACCEPTED: "provider_accepted",
  DEFINITE_FAILURE: "definite_failure",
  UNCERTAIN: "uncertain",
  DELIVERED: "delivered",
  FAILED: "failed"
});

const OWNER_SMS_PROVIDERS = new Set(["pingram", "twilio"]);
const OWNER_SMS_DISPATCH_OUTCOMES = new Set([
  OWNER_SMS_ATTEMPT_STATES.PROVIDER_ACCEPTED,
  OWNER_SMS_ATTEMPT_STATES.DEFINITE_FAILURE,
  OWNER_SMS_ATTEMPT_STATES.UNCERTAIN
]);
const OWNER_SMS_PROVIDER_EVENT_OUTCOMES = new Set([
  OWNER_SMS_ATTEMPT_STATES.DELIVERED,
  OWNER_SMS_ATTEMPT_STATES.FAILED
]);
const OWNER_SMS_ATTEMPT_ID_PATTERN = /^osa_[a-f0-9]{48}$/;
const OWNER_SMS_RECIPIENT_FINGERPRINT_PATTERN = /^osrf_[a-f0-9]{64}$/;
const OWNER_SMS_WEBHOOK_RECEIPT_ID_PATTERN = /^oswr_[a-f0-9]{48}$/;

class OwnerSmsAttemptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OwnerSmsAttemptError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new OwnerSmsAttemptError(code, message);
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function exactText(value, maxLength = 500) {
  const normalized = String(value ?? "").trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return "";
  }
  return normalized;
}

function normalizeISO(value) {
  const candidate = exactText(value, 64);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeSlug(value, maxLength = 64) {
  const normalized = exactText(value, maxLength).toLowerCase();
  return /^[a-z][a-z0-9_-]{1,63}$/.test(normalized) ? normalized : "";
}

function normalizeOrganizationId(value) {
  const normalized = exactText(value, 160);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(normalized)
    ? normalized
    : "";
}

function normalizeSourceId(value) {
  const normalized = exactText(value, 500);
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,499}$/.test(normalized)
    ? normalized
    : "";
}

function normalizeProviderTrackingId(value) {
  const normalized = exactText(value, 256);
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/.test(normalized)
    ? normalized
    : "";
}

function normalizeLeaseId(value) {
  const normalized = exactText(value, 160);
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/.test(normalized)
    ? normalized
    : "";
}

function normalizeReason(value) {
  const normalized = exactText(value, 160).toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return normalized.replace(/_{2,}/g, "_").replace(/^_|_$/g, "");
}

function normalizeSafeReasonCode(value) {
  const normalized = exactText(value, 80).toLowerCase();
  return /^[a-z][a-z0-9_]{2,79}$/.test(normalized) ? normalized : "";
}

function normalizeWebhookEventType(value) {
  const normalized = exactText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return normalized.replace(/_{2,}/g, "_").replace(/^_|_$/g, "");
}

function canonicalize(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("invalid-argument", "Owner SMS payload contains a non-finite number.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || value === undefined) {
    fail("invalid-argument", "Owner SMS payload must contain JSON-compatible values.");
  }
  if (seen.has(value)) {
    fail("invalid-argument", "Owner SMS payload must not contain circular references.");
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => canonicalize(item, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("invalid-argument", "Owner SMS payload must use plain JSON objects.");
    }
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        fail("invalid-argument", "Owner SMS payload must not contain undefined values.");
      }
      result[key] = canonicalize(value[key], seen);
    }
  }
  seen.delete(value);
  return result;
}

function canonicalJson(value) {
  const serialized = JSON.stringify(canonicalize(value));
  if (!serialized || Buffer.byteLength(serialized, "utf8") > 32 * 1024) {
    fail("invalid-argument", "Owner SMS payload exceeds the bounded digest input size.");
  }
  return serialized;
}

function normalizeAttemptIdentity(input = {}) {
  const source = normalizeSlug(input.source);
  const sourceId = normalizeSourceId(input.sourceId);
  const organizationId = normalizeOrganizationId(input.organizationId);
  const notificationType = normalizeSlug(input.notificationType);
  if (!source || !sourceId || !organizationId || !notificationType) {
    fail(
      "invalid-argument",
      "Owner SMS attempt identity requires a source, source ID, organization, and notification type."
    );
  }
  return { source, sourceId, organizationId, notificationType };
}

function buildOwnerSmsAttemptId(input = {}) {
  const identity = normalizeAttemptIdentity(input);
  const digest = createHash("sha256")
    .update(
      `quotepilot:owner-sms-attempt:v${OWNER_SMS_ATTEMPT_SCHEMA_VERSION}:`,
      "utf8"
    )
    .update(canonicalJson(identity), "utf8")
    .digest("hex");
  return `osa_${digest.slice(0, 48)}`;
}

function buildOwnerSmsPayloadDigest(payload) {
  return createHash("sha256")
    .update(
      `quotepilot:owner-sms-payload:v${OWNER_SMS_ATTEMPT_SCHEMA_VERSION}:`,
      "utf8"
    )
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

function buildOwnerSmsRecipientFingerprint({ organizationId, recipient, secret } = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedRecipient = exactText(recipient, 16);
  const normalizedSecret = exactText(secret, 512);
  if (!normalizedOrganizationId) {
    fail("invalid-argument", "Owner SMS recipient fingerprint requires an organization.");
  }
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalizedRecipient)) {
    fail("invalid-argument", "Owner SMS recipient must use E.164 format.");
  }
  if (normalizedSecret.length < 32) {
    fail("failed-precondition", "Owner SMS recipient fingerprinting is not configured.");
  }
  const digest = createHmac("sha256", normalizedSecret)
    .update(
      `quotepilot:owner-sms-recipient:v2:${normalizedOrganizationId}:${normalizedRecipient}`,
      "utf8"
    )
    .digest("hex");
  return `osrf_${digest}`;
}

function buildOwnerSmsWebhookReceiptId({
  provider,
  eventType,
  providerTrackingId = "",
  recipientFingerprint = ""
} = {}) {
  const normalizedProvider = normalizeSlug(provider, 32);
  const normalizedEventType = normalizeWebhookEventType(eventType);
  const normalizedTrackingId = normalizeProviderTrackingId(providerTrackingId);
  const normalizedRecipientFingerprint = text(recipientFingerprint, 69).toLowerCase();
  if (!OWNER_SMS_PROVIDERS.has(normalizedProvider) || !normalizedEventType) {
    fail("invalid-argument", "Owner SMS webhook receipt identity is invalid.");
  }
  const semanticObject = normalizedTrackingId
    ? `tracking:${normalizedTrackingId}`
    : OWNER_SMS_RECIPIENT_FINGERPRINT_PATTERN.test(normalizedRecipientFingerprint)
      ? `recipient:${normalizedRecipientFingerprint}`
      : "";
  if (!semanticObject) {
    fail(
      "invalid-argument",
      "Owner SMS webhook receipt requires a provider tracking ID or recipient fingerprint."
    );
  }
  const digest = createHash("sha256")
    .update(
      `quotepilot:owner-sms-webhook:v${OWNER_SMS_ATTEMPT_SCHEMA_VERSION}:`,
      "utf8"
    )
    .update(canonicalJson({
      eventType: normalizedEventType,
      provider: normalizedProvider,
      semanticObject
    }), "utf8")
    .digest("hex");
  return `oswr_${digest.slice(0, 48)}`;
}

function buildOwnerSmsAttemptReservation({
  source,
  sourceId,
  organizationId,
  notificationType,
  provider,
  payloadDigest,
  recipientFingerprint = "",
  nowISO
} = {}) {
  const identity = normalizeAttemptIdentity({
    source,
    sourceId,
    organizationId,
    notificationType
  });
  const normalizedProvider = normalizeSlug(provider, 32);
  const normalizedPayloadDigest = text(payloadDigest, 64).toLowerCase();
  const normalizedRecipientFingerprint = text(recipientFingerprint, 69).toLowerCase();
  const reservedAtISO = normalizeISO(nowISO);
  if (
    !OWNER_SMS_PROVIDERS.has(normalizedProvider)
    || !/^[a-f0-9]{64}$/.test(normalizedPayloadDigest)
    || (
      normalizedRecipientFingerprint
      && !OWNER_SMS_RECIPIENT_FINGERPRINT_PATTERN.test(normalizedRecipientFingerprint)
    )
    || !reservedAtISO
  ) {
    fail("invalid-argument", "Owner SMS attempt reservation evidence is invalid.");
  }
  return Object.freeze({
    schemaVersion: OWNER_SMS_ATTEMPT_SCHEMA_VERSION,
    attemptId: buildOwnerSmsAttemptId(identity),
    ...identity,
    provider: normalizedProvider,
    payloadDigest: normalizedPayloadDigest,
    recipientFingerprint: normalizedRecipientFingerprint,
    state: OWNER_SMS_ATTEMPT_STATES.QUEUED,
    revision: 0,
    attemptCount: 0,
    reservedAtISO,
    stateUpdatedAtISO: reservedAtISO,
    dispatchLeaseId: "",
    dispatchStartedAtISO: "",
    providerTrackingId: "",
    providerAcceptedAtISO: "",
    outcomeReason: "",
    outcomeRecordedAtISO: "",
    providerEventType: "",
    providerOccurrenceAtISO: "",
    webhookSentAtISO: "",
    webhookReceiptId: ""
  });
}

function normalizeOwnerSmsAttempt(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("failed-precondition", "Owner SMS attempt state is unavailable.");
  }
  const identity = normalizeAttemptIdentity(input);
  const attemptId = text(input.attemptId, 52).toLowerCase();
  const provider = normalizeSlug(input.provider, 32);
  const payloadDigest = text(input.payloadDigest, 64).toLowerCase();
  const recipientFingerprint = text(input.recipientFingerprint, 69).toLowerCase();
  const state = text(input.state, 32).toLowerCase();
  const revision = Number(input.revision);
  const attemptCount = Number(input.attemptCount);
  const reservedAtISO = normalizeISO(input.reservedAtISO);
  const stateUpdatedAtISO = normalizeISO(input.stateUpdatedAtISO);
  const dispatchLeaseId = input.dispatchLeaseId ? normalizeLeaseId(input.dispatchLeaseId) : "";
  const dispatchStartedAtISO = normalizeISO(input.dispatchStartedAtISO);
  const providerTrackingId = input.providerTrackingId
    ? normalizeProviderTrackingId(input.providerTrackingId)
    : "";
  const providerAcceptedAtISO = normalizeISO(input.providerAcceptedAtISO);
  const outcomeReason = input.outcomeReason ? normalizeReason(input.outcomeReason) : "";
  const outcomeRecordedAtISO = normalizeISO(input.outcomeRecordedAtISO);
  const providerEventType = input.providerEventType
    ? normalizeWebhookEventType(input.providerEventType)
    : "";
  const providerOccurrenceAtISO = normalizeISO(input.providerOccurrenceAtISO);
  const explicitWebhookSentAtISO = normalizeISO(input.webhookSentAtISO);
  // Before this model separated provider occurrence from webhook transmission,
  // providerEventAtISO held the signed webhook timestamp. Accept it only as a
  // legacy webhook-sent alias; never reinterpret it as provider occurrence.
  const legacyWebhookSentAtISO = normalizeISO(input.providerEventAtISO);
  const webhookSentAtISO = explicitWebhookSentAtISO || legacyWebhookSentAtISO;
  const webhookReceiptId = text(input.webhookReceiptId, 53).toLowerCase();
  if (
    !OWNER_SMS_ATTEMPT_ID_PATTERN.test(attemptId)
    || attemptId !== buildOwnerSmsAttemptId(identity)
    || !OWNER_SMS_PROVIDERS.has(provider)
    || !/^[a-f0-9]{64}$/.test(payloadDigest)
    || (
      recipientFingerprint
      && !OWNER_SMS_RECIPIENT_FINGERPRINT_PATTERN.test(recipientFingerprint)
    )
    || !Object.values(OWNER_SMS_ATTEMPT_STATES).includes(state)
    || !Number.isSafeInteger(revision)
    || revision < 0
    || !Number.isSafeInteger(attemptCount)
    || attemptCount < 0
    || !reservedAtISO
    || !stateUpdatedAtISO
    || Date.parse(stateUpdatedAtISO) < Date.parse(reservedAtISO)
    || (input.providerTrackingId && !providerTrackingId)
    || (input.providerOccurrenceAtISO && !providerOccurrenceAtISO)
    || (input.webhookSentAtISO && !explicitWebhookSentAtISO)
    || (input.providerEventAtISO && !legacyWebhookSentAtISO)
    || (
      explicitWebhookSentAtISO
      && legacyWebhookSentAtISO
      && explicitWebhookSentAtISO !== legacyWebhookSentAtISO
    )
  ) {
    fail("failed-precondition", "Owner SMS attempt identity or audit state is invalid.");
  }
  const normalized = {
    schemaVersion: Number(input.schemaVersion),
    attemptId,
    ...identity,
    provider,
    payloadDigest,
    recipientFingerprint,
    state,
    revision,
    attemptCount,
    reservedAtISO,
    stateUpdatedAtISO,
    dispatchLeaseId,
    dispatchStartedAtISO,
    providerTrackingId,
    providerAcceptedAtISO,
    outcomeReason,
    outcomeRecordedAtISO,
    providerEventType,
    providerOccurrenceAtISO,
    webhookSentAtISO,
    webhookReceiptId
  };
  if (normalized.schemaVersion !== OWNER_SMS_ATTEMPT_SCHEMA_VERSION) {
    fail("failed-precondition", "Owner SMS attempt schema version is unsupported.");
  }

  const noDispatchEvidence = !dispatchLeaseId
    && !dispatchStartedAtISO
    && !providerTrackingId
    && !providerAcceptedAtISO
    && !outcomeReason
    && !outcomeRecordedAtISO
    && !providerEventType
    && !providerOccurrenceAtISO
    && !webhookSentAtISO
    && !webhookReceiptId;
  if (
    state === OWNER_SMS_ATTEMPT_STATES.QUEUED
    && (revision !== 0 || attemptCount !== 0 || !noDispatchEvidence)
  ) {
    fail("failed-precondition", "Queued Owner SMS attempt evidence is invalid.");
  }

  const hasDispatchEvidence = attemptCount === 1
    && revision >= 1
    && OWNER_SMS_RECIPIENT_FINGERPRINT_PATTERN.test(recipientFingerprint)
    && dispatchLeaseId
    && dispatchStartedAtISO
    && Date.parse(dispatchStartedAtISO) >= Date.parse(reservedAtISO)
    && Date.parse(stateUpdatedAtISO) >= Date.parse(dispatchStartedAtISO);
  const isPreflightFailure = state === OWNER_SMS_ATTEMPT_STATES.DEFINITE_FAILURE
    && attemptCount === 0;
  if (
    state !== OWNER_SMS_ATTEMPT_STATES.QUEUED
    && !isPreflightFailure
    && !hasDispatchEvidence
  ) {
    fail("failed-precondition", "Owner SMS dispatch evidence is incomplete.");
  }
  if (
    isPreflightFailure
    && (
      revision !== 1
      || dispatchLeaseId
      || dispatchStartedAtISO
      || providerTrackingId
      || providerAcceptedAtISO
      || !normalizeSafeReasonCode(outcomeReason)
      || !outcomeRecordedAtISO
      || outcomeRecordedAtISO !== stateUpdatedAtISO
      || providerEventType
      || providerOccurrenceAtISO
      || webhookSentAtISO
      || webhookReceiptId
    )
  ) {
    fail("failed-precondition", "Owner SMS preflight-failure evidence is invalid.");
  }
  if (
    state === OWNER_SMS_ATTEMPT_STATES.DISPATCHING
    && (
      revision !== 1
      || stateUpdatedAtISO !== dispatchStartedAtISO
      || providerTrackingId
      || providerAcceptedAtISO
      || outcomeReason
      || outcomeRecordedAtISO
      || providerEventType
      || providerOccurrenceAtISO
      || webhookSentAtISO
      || webhookReceiptId
    )
  ) {
    fail("failed-precondition", "Dispatching Owner SMS attempt evidence is invalid.");
  }
  if (
    state === OWNER_SMS_ATTEMPT_STATES.PROVIDER_ACCEPTED
    && (
      revision !== 2
      || !providerTrackingId
      || !providerAcceptedAtISO
      || providerAcceptedAtISO !== stateUpdatedAtISO
      || outcomeReason !== "provider_accepted"
      || !outcomeRecordedAtISO
      || outcomeRecordedAtISO !== stateUpdatedAtISO
      || providerEventType
      || providerOccurrenceAtISO
      || webhookSentAtISO
      || webhookReceiptId
    )
  ) {
    fail("failed-precondition", "Provider-accepted Owner SMS evidence is invalid.");
  }
  if (
    state === OWNER_SMS_ATTEMPT_STATES.DEFINITE_FAILURE
    && !isPreflightFailure
    && (
      revision !== 2
      || providerTrackingId
      || !outcomeReason
      || !outcomeRecordedAtISO
      || outcomeRecordedAtISO !== stateUpdatedAtISO
      || providerAcceptedAtISO
      || providerEventType
      || providerOccurrenceAtISO
      || webhookSentAtISO
      || webhookReceiptId
    )
  ) {
    fail("failed-precondition", "Owner SMS dispatch outcome evidence is invalid.");
  }
  if (
    state === OWNER_SMS_ATTEMPT_STATES.UNCERTAIN
    && (
      revision !== 2
      || !outcomeReason
      || !outcomeRecordedAtISO
      || outcomeRecordedAtISO !== stateUpdatedAtISO
      || providerAcceptedAtISO
      || providerEventType
      || providerOccurrenceAtISO
      || webhookSentAtISO
      || webhookReceiptId
    )
  ) {
    fail("failed-precondition", "Owner SMS uncertain-outcome evidence is invalid.");
  }
  if (OWNER_SMS_PROVIDER_EVENT_OUTCOMES.has(state)) {
    const expectedEventType = state === OWNER_SMS_ATTEMPT_STATES.DELIVERED
      ? "sms_delivered"
      : "sms_failed";
    if (
      revision !== 3
      || !providerTrackingId
      || (
        providerAcceptedAtISO
        && Date.parse(providerAcceptedAtISO) > Date.parse(stateUpdatedAtISO)
      )
      || !outcomeReason
      || !outcomeRecordedAtISO
      || outcomeRecordedAtISO !== stateUpdatedAtISO
      || providerEventType !== expectedEventType
      || !webhookSentAtISO
      || !OWNER_SMS_WEBHOOK_RECEIPT_ID_PATTERN.test(webhookReceiptId)
      || webhookReceiptId !== buildOwnerSmsWebhookReceiptId({
        provider,
        eventType: providerEventType,
        providerTrackingId
      })
    ) {
      fail("failed-precondition", "Owner SMS provider-event evidence is invalid.");
    }
  }
  return normalized;
}

function planOwnerSmsPreflightFailure({
  attempt,
  safeReason,
  nowISO
} = {}) {
  const current = normalizeOwnerSmsAttempt(attempt);
  const normalizedSafeReason = normalizeSafeReasonCode(safeReason);
  if (!normalizedSafeReason) {
    fail(
      "invalid-argument",
      "Owner SMS preflight failure requires a redacted safe reason code."
    );
  }
  if (
    current.state === OWNER_SMS_ATTEMPT_STATES.DEFINITE_FAILURE
    && current.attemptCount === 0
  ) {
    if (current.outcomeReason === normalizedSafeReason) {
      return mergeAttempt(attempt, current);
    }
    fail("aborted", "Owner SMS preflight-failure replay does not match recorded evidence.");
  }
  if (current.state !== OWNER_SMS_ATTEMPT_STATES.QUEUED) {
    fail("failed-precondition", "Only queued Owner SMS work may fail provider preflight.");
  }
  const outcomeRecordedAtISO = transitionTime(current, nowISO);
  return mergeAttempt(attempt, current, {
    state: OWNER_SMS_ATTEMPT_STATES.DEFINITE_FAILURE,
    revision: current.revision + 1,
    attemptCount: 0,
    stateUpdatedAtISO: outcomeRecordedAtISO,
    outcomeReason: normalizedSafeReason,
    outcomeRecordedAtISO
  });
}

function transitionTime(attempt, nowISO) {
  const changedAtISO = normalizeISO(nowISO);
  if (!changedAtISO || Date.parse(changedAtISO) < Date.parse(attempt.stateUpdatedAtISO)) {
    fail("failed-precondition", "Owner SMS transition requires a monotonic server timestamp.");
  }
  return changedAtISO;
}

function mergeAttempt(input, normalized, patch = {}) {
  return Object.freeze({ ...input, ...normalized, ...patch });
}

function planOwnerSmsDispatch({
  attempt,
  leaseId,
  recipientFingerprint,
  nowISO
} = {}) {
  const current = normalizeOwnerSmsAttempt(attempt);
  const normalizedLeaseId = normalizeLeaseId(leaseId);
  const normalizedRecipientFingerprint = text(recipientFingerprint, 69).toLowerCase();
  if (
    !normalizedLeaseId
    || !OWNER_SMS_RECIPIENT_FINGERPRINT_PATTERN.test(normalizedRecipientFingerprint)
  ) {
    fail(
      "invalid-argument",
      "Owner SMS dispatch requires a bounded lease ID and HMAC recipient fingerprint."
    );
  }
  if (current.state === OWNER_SMS_ATTEMPT_STATES.DISPATCHING) {
    if (
      current.dispatchLeaseId === normalizedLeaseId
      && current.recipientFingerprint === normalizedRecipientFingerprint
    ) {
      return mergeAttempt(attempt, current);
    }
    fail("aborted", "Owner SMS attempt is already claimed by another dispatch lease.");
  }
  if (current.state !== OWNER_SMS_ATTEMPT_STATES.QUEUED) {
    fail("failed-precondition", "Only a queued Owner SMS attempt may begin dispatch.");
  }
  if (
    current.recipientFingerprint
    && current.recipientFingerprint !== normalizedRecipientFingerprint
  ) {
    fail("aborted", "Owner SMS dispatch recipient does not match the queued reservation.");
  }
  const dispatchStartedAtISO = transitionTime(current, nowISO);
  return mergeAttempt(attempt, current, {
    state: OWNER_SMS_ATTEMPT_STATES.DISPATCHING,
    revision: current.revision + 1,
    attemptCount: current.attemptCount + 1,
    stateUpdatedAtISO: dispatchStartedAtISO,
    dispatchLeaseId: normalizedLeaseId,
    dispatchStartedAtISO,
    recipientFingerprint: normalizedRecipientFingerprint
  });
}

function planOwnerSmsOutcome({
  attempt,
  outcome,
  nowISO,
  reason = "",
  providerTrackingId = "",
  providerEventType = "",
  providerOccurrenceAtISO = "",
  webhookSentAtISO = "",
  webhookReceiptId = ""
} = {}) {
  const current = normalizeOwnerSmsAttempt(attempt);
  const normalizedOutcome = text(outcome, 32).toLowerCase();
  const normalizedReason = normalizeReason(reason);
  const normalizedTrackingId = providerTrackingId
    ? normalizeProviderTrackingId(providerTrackingId)
    : "";
  if (providerTrackingId && !normalizedTrackingId) {
    fail("invalid-argument", "Owner SMS provider tracking ID is invalid.");
  }

  if (current.state === normalizedOutcome) {
    if (
      normalizedOutcome === OWNER_SMS_ATTEMPT_STATES.PROVIDER_ACCEPTED
      && normalizedTrackingId === current.providerTrackingId
    ) {
      return mergeAttempt(attempt, current);
    }
    if (
      [OWNER_SMS_ATTEMPT_STATES.DEFINITE_FAILURE, OWNER_SMS_ATTEMPT_STATES.UNCERTAIN].includes(normalizedOutcome)
      && (!normalizedReason || normalizedReason === current.outcomeReason)
      && (!normalizedTrackingId || normalizedTrackingId === current.providerTrackingId)
    ) {
      return mergeAttempt(attempt, current);
    }
    if (
      OWNER_SMS_PROVIDER_EVENT_OUTCOMES.has(normalizedOutcome)
      && text(webhookReceiptId, 53).toLowerCase() === current.webhookReceiptId
    ) {
      return mergeAttempt(attempt, current);
    }
    fail("aborted", "Owner SMS outcome replay does not match the recorded evidence.");
  }

  if (
    current.state === OWNER_SMS_ATTEMPT_STATES.DISPATCHING
    && OWNER_SMS_DISPATCH_OUTCOMES.has(normalizedOutcome)
  ) {
    const outcomeRecordedAtISO = transitionTime(current, nowISO);
    if (
      normalizedOutcome === OWNER_SMS_ATTEMPT_STATES.PROVIDER_ACCEPTED
      && !normalizedTrackingId
    ) {
      fail("invalid-argument", "Provider acceptance requires an exact tracking ID.");
    }
    if (
      normalizedOutcome !== OWNER_SMS_ATTEMPT_STATES.PROVIDER_ACCEPTED
      && !normalizedReason
    ) {
      fail("invalid-argument", "Owner SMS failure or uncertainty requires a reason.");
    }
    if (
      normalizedOutcome === OWNER_SMS_ATTEMPT_STATES.DEFINITE_FAILURE
      && normalizedTrackingId
    ) {
      fail("invalid-argument", "A definite provider failure cannot retain a tracking ID.");
    }
    return mergeAttempt(attempt, current, {
      state: normalizedOutcome,
      revision: current.revision + 1,
      stateUpdatedAtISO: outcomeRecordedAtISO,
      providerTrackingId: normalizedTrackingId,
      providerAcceptedAtISO: normalizedOutcome === OWNER_SMS_ATTEMPT_STATES.PROVIDER_ACCEPTED
        ? outcomeRecordedAtISO
        : "",
      outcomeReason: normalizedOutcome === OWNER_SMS_ATTEMPT_STATES.PROVIDER_ACCEPTED
        ? "provider_accepted"
        : normalizedReason,
      outcomeRecordedAtISO
    });
  }

  if (
    (
      current.state === OWNER_SMS_ATTEMPT_STATES.PROVIDER_ACCEPTED
      || (
        current.state === OWNER_SMS_ATTEMPT_STATES.UNCERTAIN
        && current.providerTrackingId
      )
    )
    && OWNER_SMS_PROVIDER_EVENT_OUTCOMES.has(normalizedOutcome)
  ) {
    if (normalizedTrackingId && normalizedTrackingId !== current.providerTrackingId) {
      fail("aborted", "Owner SMS webhook tracking ID does not match the accepted attempt.");
    }
    const normalizedEventType = normalizeWebhookEventType(providerEventType);
    const expectedEventType = normalizedOutcome === OWNER_SMS_ATTEMPT_STATES.DELIVERED
      ? "sms_delivered"
      : "sms_failed";
    const occurrenceAtISO = normalizeISO(providerOccurrenceAtISO);
    const sentAtISO = normalizeISO(webhookSentAtISO);
    const expectedReceiptId = buildOwnerSmsWebhookReceiptId({
      provider: current.provider,
      eventType: normalizedEventType,
      providerTrackingId: current.providerTrackingId
    });
    const suppliedReceiptId = text(webhookReceiptId, 53).toLowerCase();
    if (
      normalizedEventType !== expectedEventType
      || !sentAtISO
      || (providerOccurrenceAtISO && !occurrenceAtISO)
      || (suppliedReceiptId && suppliedReceiptId !== expectedReceiptId)
    ) {
      fail("invalid-argument", "Owner SMS provider-event outcome evidence is invalid.");
    }
    const outcomeRecordedAtISO = transitionTime(current, nowISO);
    return mergeAttempt(attempt, current, {
      state: normalizedOutcome,
      revision: current.revision + 1,
      stateUpdatedAtISO: outcomeRecordedAtISO,
      outcomeReason: normalizedOutcome === OWNER_SMS_ATTEMPT_STATES.DELIVERED
        ? "provider_reported_delivered"
        : normalizedReason || "provider_reported_failed",
      outcomeRecordedAtISO,
      providerEventType: normalizedEventType,
      providerOccurrenceAtISO: occurrenceAtISO,
      webhookSentAtISO: sentAtISO,
      webhookReceiptId: expectedReceiptId
    });
  }

  fail(
    "failed-precondition",
    `Owner SMS transition ${current.state} -> ${normalizedOutcome || "unknown"} is not allowed.`
  );
}

module.exports = {
  OWNER_SMS_ATTEMPT_SCHEMA_VERSION,
  OWNER_SMS_ATTEMPT_STATES,
  OwnerSmsAttemptError,
  buildOwnerSmsAttemptId,
  buildOwnerSmsAttemptReservation,
  buildOwnerSmsPayloadDigest,
  buildOwnerSmsRecipientFingerprint,
  buildOwnerSmsWebhookReceiptId,
  normalizeOwnerSmsAttempt,
  planOwnerSmsDispatch,
  planOwnerSmsPreflightFailure,
  planOwnerSmsOutcome
};
