import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const REVENUE_AUTOPILOT_CALLABLES = Object.freeze({
  getOperations: "getRevenueAutopilotOperations",
  getCustomerControls: "getRevenueAutopilotCustomerControls",
  configurePolicy: "configureRevenueAutopilotPolicy",
  configureCustomerControls: "configureRevenueAutopilotCustomerControls",
  materializeJobs: "materializeRevenueAutopilotJobs",
  reconcileJob: "reconcileRevenueAutopilotJob",
  acknowledgeReply: "acknowledgeRevenueAutopilotReply",
  getUnsubscribeContext: "getRevenueAutopilotUnsubscribeContext",
  unsubscribeEmail: "unsubscribeRevenueAutopilotEmail"
});

export const REVENUE_AUTOPILOT_MUTATION_OPERATIONS = Object.freeze({
  configurePolicy: "configure_policy",
  configureCustomerControls: "configure_customer_controls",
  materializeJobs: "materialize_jobs",
  reconcileJob: "reconcile_job",
  acknowledgeReply: "acknowledge_reply",
  unsubscribeEmail: "unsubscribe_email"
});

export const REVENUE_AUTOPILOT_KINDS = Object.freeze([
  "quote_follow_up",
  "deposit_reminder",
  "final_balance_reminder",
  "post_event_review_request",
  "unread_customer_reply"
]);

export const REVENUE_AUTOPILOT_REQUEST_ID_PATTERN = /^ra_request_[a-f0-9]{32}$/u;
export const MAX_PENDING_REVENUE_AUTOPILOT_ATTEMPTS = 25;
export const MAX_REVENUE_AUTOPILOT_JOB_READS = 100;
export const MAX_REVENUE_AUTOPILOT_ATTENTION_READS = 50;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/u;
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,256}$/u;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const FINAL_BALANCE_DAY_OFFSETS = Object.freeze([14, 7, 3]);
const MATERIALIZATION_KINDS = Object.freeze([
  "quote_follow_up",
  "deposit_reminder",
  "final_balance_reminder",
  "post_event_review_request"
]);
const MATERIALIZATION_STATES = new Set([
  "ready",
  "deferred",
  "blocked",
  "stopped",
  "conflict"
]);
const RECONCILIATION_STATES = new Set(["withheld", "provider_accepted"]);
const PRIVATE_IPV4_PATTERN = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u;
const PRIVATE_IPV6_PATTERN = /^(?:::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/u;
const DEFINITIVE_ERROR_CODES = new Set([
  "already-exists",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "unauthenticated"
]);
const pendingAttempts = new Map();

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clientError(code, message, definitive = true) {
  const error = new Error(message);
  error.code = code;
  error.revenueAutopilotDefinitive = definitive === true;
  return error;
}

function requireRecord(value, label) {
  if (!isRecord(value)) {
    throw clientError("invalid-argument", `${label} is required.`);
  }
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  const record = requireRecord(value, label);
  const allowedSet = new Set(allowed);
  const unsupported = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unsupported.length) {
    throw clientError(
      "invalid-argument",
      `${label} includes unsupported fields: ${unsupported.sort().join(", ")}.`
    );
  }
  return record;
}

function opaqueId(value, label) {
  const normalized = text(value);
  if (
    !IDENTIFIER_PATTERN.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/u.test(normalized)
  ) {
    throw clientError("invalid-argument", `${label} must be an opaque non-email identifier.`);
  }
  return normalized;
}

function optionalOpaqueId(value, label) {
  return text(value) ? opaqueId(value, label) : "";
}

function isOpaqueId(value) {
  const normalized = text(value);
  return Boolean(
    IDENTIFIER_PATTERN.test(normalized)
    && normalized !== "."
    && normalized !== ".."
    && !/^[^@\s]+@[^@\s]+$/u.test(normalized)
  );
}

function publicToken(value) {
  const normalized = text(value);
  if (!PUBLIC_TOKEN_PATTERN.test(normalized)) {
    throw clientError("invalid-argument", "token must be an opaque public token identifier.");
  }
  return normalized;
}

function requestId(value) {
  const normalized = text(value).toLowerCase();
  if (!REVENUE_AUTOPILOT_REQUEST_ID_PATTERN.test(normalized)) {
    throw clientError("invalid-argument", "requestId is invalid.");
  }
  return normalized;
}

function boundedInteger(value, label, minimum, maximum, fallback) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw clientError(
      "invalid-argument",
      `${label} must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return candidate;
}

function normalizeTimeZone(value) {
  const requested = text(value);
  if (!requested || requested.length > 100) {
    throw clientError("invalid-argument", "policy.timeZone must be a valid IANA time zone.");
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: requested })
      .resolvedOptions()
      .timeZone;
  } catch {
    throw clientError("invalid-argument", "policy.timeZone must be a valid IANA time zone.");
  }
}

export function normalizeRevenueAutopilotReviewRequestUrl(value, { required = false } = {}) {
  const candidate = text(value);
  if (!candidate && !required) return "";
  if (!candidate || candidate.length > 2048) {
    throw clientError(
      "invalid-argument",
      "Post-event review requests require a valid public HTTPS review URL."
    );
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw clientError(
      "invalid-argument",
      "Post-event review requests require a valid public HTTPS review URL."
    );
  }
  const hostname = text(parsed.hostname).toLowerCase().replace(/^\[|\]$/gu, "");
  const unsafeHost = (
    !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || PRIVATE_IPV4_PATTERN.test(hostname)
    || PRIVATE_IPV6_PATTERN.test(hostname)
  );
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || (parsed.port && parsed.port !== "443")
    || unsafeHost
  ) {
    throw clientError(
      "invalid-argument",
      "Post-event review requests require a public HTTPS review URL without credentials, fragments, a nonstandard port, or a private host."
    );
  }
  return parsed.toString();
}

function normalizeDayOffsets(value, label, { finalBalance = false } = {}) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw clientError("invalid-argument", `${label} must contain one to twelve day offsets.`);
  }
  const offsets = value.map(Number);
  if (offsets.some((item) => !Number.isSafeInteger(item) || item < 0 || item > 365)) {
    throw clientError("invalid-argument", `${label} contains an invalid day offset.`);
  }
  if (new Set(offsets).size !== offsets.length) {
    throw clientError("invalid-argument", `${label} cannot contain duplicate day offsets.`);
  }
  if (finalBalance) {
    const sorted = [...offsets].sort((left, right) => right - left);
    if (JSON.stringify(sorted) !== JSON.stringify(FINAL_BALANCE_DAY_OFFSETS)) {
      throw clientError(
        "invalid-argument",
        `${label} must contain the fixed 14, 7, and 3 day windows.`
      );
    }
    return [...FINAL_BALANCE_DAY_OFFSETS];
  }
  return [...offsets].sort((left, right) => left - right);
}

function normalizeQuietHours(value) {
  const quietHours = assertAllowedKeys(
    value,
    ["enabled", "start", "end"],
    "policy.quietHours"
  );
  if (typeof quietHours.enabled !== "boolean") {
    throw clientError("invalid-argument", "policy.quietHours.enabled must be boolean.");
  }
  if (!quietHours.enabled) {
    if (text(quietHours.start) || text(quietHours.end)) {
      throw clientError(
        "invalid-argument",
        "Disabled quiet hours cannot retain a start or end time."
      );
    }
    return { enabled: false, start: "", end: "" };
  }
  const start = text(quietHours.start);
  const end = text(quietHours.end);
  if (!LOCAL_TIME_PATTERN.test(start) || !LOCAL_TIME_PATTERN.test(end) || start === end) {
    throw clientError(
      "invalid-argument",
      "Enabled quiet hours require distinct HH:mm start and end times."
    );
  }
  return { enabled: true, start, end };
}

function normalizeKinds(value) {
  const kinds = assertAllowedKeys(value, REVENUE_AUTOPILOT_KINDS, "policy.kinds");
  return Object.fromEntries(REVENUE_AUTOPILOT_KINDS.map((kind) => {
    if (typeof kinds[kind] !== "boolean") {
      throw clientError("invalid-argument", `policy.kinds.${kind} must be boolean.`);
    }
    return [kind, kinds[kind]];
  }));
}

function normalizePolicy(value) {
  const policy = assertAllowedKeys(value, [
    "enabled",
    "timeZone",
    "reviewRequestUrl",
    "quietHours",
    "kinds",
    "maxAttempts",
    "quoteFollowUpDayOffsets",
    "depositReminderDayOffsets",
    "finalBalanceReminderDayOffsets"
  ], "policy");
  if (typeof policy.enabled !== "boolean") {
    throw clientError("invalid-argument", "policy.enabled must be boolean.");
  }
  const kinds = normalizeKinds(policy.kinds);
  return {
    enabled: policy.enabled,
    timeZone: normalizeTimeZone(policy.timeZone),
    reviewRequestUrl: normalizeRevenueAutopilotReviewRequestUrl(
      policy.reviewRequestUrl,
      { required: kinds.post_event_review_request }
    ),
    quietHours: normalizeQuietHours(policy.quietHours),
    kinds,
    maxAttempts: boundedInteger(policy.maxAttempts, "policy.maxAttempts", 1, 5),
    quoteFollowUpDayOffsets: normalizeDayOffsets(
      policy.quoteFollowUpDayOffsets,
      "policy.quoteFollowUpDayOffsets"
    ),
    depositReminderDayOffsets: normalizeDayOffsets(
      policy.depositReminderDayOffsets,
      "policy.depositReminderDayOffsets"
    ),
    finalBalanceReminderDayOffsets: normalizeDayOffsets(
      policy.finalBalanceReminderDayOffsets,
      "policy.finalBalanceReminderDayOffsets",
      { finalBalance: true }
    )
  };
}

function normalizeOperationsPolicyProjection(value) {
  const policy = requireRecord(value, "Revenue Autopilot policy projection");
  const rawPostEventKind = isRecord(policy.kinds)
    ? policy.kinds.post_event_review_request
    : undefined;
  const postEventEnabled = isRecord(rawPostEventKind)
    ? rawPostEventKind.enabled === true
    : rawPostEventKind === true;
  let reviewRequestUrl;
  try {
    reviewRequestUrl = normalizeRevenueAutopilotReviewRequestUrl(
      policy.reviewRequestUrl,
      { required: postEventEnabled }
    );
  } catch {
    throw clientError(
      "unknown",
      "Revenue Autopilot operations returned an invalid review-request policy projection.",
      false
    );
  }
  return Object.freeze({ ...policy, reviewRequestUrl });
}

function normalizeOperationsRead(input = {}) {
  const value = assertAllowedKeys(
    input,
    ["organizationId", "quoteId", "jobLimit", "attentionLimit"],
    "Revenue Autopilot operations read"
  );
  const quoteId = optionalOpaqueId(value.quoteId, "quoteId");
  return {
    organizationId: opaqueId(value.organizationId, "organizationId"),
    ...(quoteId ? { quoteId } : {}),
    jobLimit: boundedInteger(
      value.jobLimit,
      "jobLimit",
      1,
      MAX_REVENUE_AUTOPILOT_JOB_READS,
      MAX_REVENUE_AUTOPILOT_JOB_READS
    ),
    attentionLimit: boundedInteger(
      value.attentionLimit,
      "attentionLimit",
      1,
      MAX_REVENUE_AUTOPILOT_ATTENTION_READS,
      MAX_REVENUE_AUTOPILOT_ATTENTION_READS
    )
  };
}

function normalizeCustomerControlsRead(input = {}) {
  const value = assertAllowedKeys(
    input,
    ["organizationId", "customerId"],
    "Revenue Autopilot customer-controls read"
  );
  return {
    organizationId: opaqueId(value.organizationId, "organizationId"),
    customerId: opaqueId(value.customerId, "customerId")
  };
}

function normalizeUnsubscribeRead(input = {}) {
  const value = assertAllowedKeys(input, ["token"], "Revenue Autopilot unsubscribe read");
  return { token: publicToken(value.token) };
}

function configurePolicyPayload(input = {}) {
  const value = assertAllowedKeys(
    input,
    ["organizationId", "expectedPolicyVersion", "policy", "requestId"],
    "Revenue Autopilot policy mutation"
  );
  const expectedPolicyVersion = optionalOpaqueId(
    value.expectedPolicyVersion,
    "expectedPolicyVersion"
  );
  return {
    organizationId: opaqueId(value.organizationId, "organizationId"),
    ...(expectedPolicyVersion ? { expectedPolicyVersion } : {}),
    policy: normalizePolicy(value.policy)
  };
}

function configureCustomerControlsPayload(input = {}) {
  const value = assertAllowedKeys(
    input,
    [
      "organizationId",
      "customerId",
      "expectedRevision",
      "consentState",
      "subscriptionState",
      "requestId"
    ],
    "Revenue Autopilot customer controls mutation"
  );
  const consentState = text(value.consentState).toLowerCase();
  const subscriptionState = text(value.subscriptionState).toLowerCase();
  if (!new Set(["granted", "revoked"]).has(consentState)) {
    throw clientError(
      "invalid-argument",
      "consentState must be granted or revoked."
    );
  }
  if (!new Set(["subscribed", "unsubscribed"]).has(subscriptionState)) {
    throw clientError(
      "invalid-argument",
      "subscriptionState must be subscribed or unsubscribed."
    );
  }
  return {
    organizationId: opaqueId(value.organizationId, "organizationId"),
    customerId: opaqueId(value.customerId, "customerId"),
    expectedRevision: boundedInteger(
      value.expectedRevision,
      "expectedRevision",
      0,
      Number.MAX_SAFE_INTEGER
    ),
    consentState,
    subscriptionState
  };
}

function materializeJobsPayload(input = {}) {
  const value = assertAllowedKeys(
    input,
    ["organizationId", "quoteId", "requestId"],
    "Revenue Autopilot materialization"
  );
  return {
    organizationId: opaqueId(value.organizationId, "organizationId"),
    quoteId: opaqueId(value.quoteId, "quoteId")
  };
}

function reconcileJobPayload(input = {}) {
  const value = assertAllowedKeys(
    input,
    ["organizationId", "quoteId", "jobId", "requestId"],
    "Revenue Autopilot job reconciliation"
  );
  return {
    organizationId: opaqueId(value.organizationId, "organizationId"),
    quoteId: opaqueId(value.quoteId, "quoteId"),
    jobId: opaqueId(value.jobId, "jobId")
  };
}

function acknowledgeReplyPayload(input = {}) {
  const value = assertAllowedKeys(
    input,
    ["organizationId", "quoteId", "attentionId", "messageId", "requestId"],
    "Revenue Autopilot reply acknowledgement"
  );
  return {
    organizationId: opaqueId(value.organizationId, "organizationId"),
    quoteId: opaqueId(value.quoteId, "quoteId"),
    attentionId: opaqueId(value.attentionId, "attentionId"),
    messageId: opaqueId(value.messageId, "messageId")
  };
}

function unsubscribeEmailPayload(input = {}) {
  const value = assertAllowedKeys(
    input,
    ["token", "requestId"],
    "Revenue Autopilot unsubscribe mutation"
  );
  return { token: publicToken(value.token) };
}

const MUTATION_DEFINITIONS = Object.freeze({
  [REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configurePolicy]: Object.freeze({
    callable: REVENUE_AUTOPILOT_CALLABLES.configurePolicy,
    normalize: configurePolicyPayload,
    scopeFields: Object.freeze(["organizationId"]),
    returnFields: Object.freeze(["organizationId"]),
    requiresPolicyVersion: true
  }),
  [REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configureCustomerControls]: Object.freeze({
    callable: REVENUE_AUTOPILOT_CALLABLES.configureCustomerControls,
    normalize: configureCustomerControlsPayload,
    scopeFields: Object.freeze(["organizationId", "customerId"]),
    returnFields: Object.freeze(["organizationId", "customerId"])
  }),
  [REVENUE_AUTOPILOT_MUTATION_OPERATIONS.materializeJobs]: Object.freeze({
    callable: REVENUE_AUTOPILOT_CALLABLES.materializeJobs,
    normalize: materializeJobsPayload,
    scopeFields: Object.freeze(["organizationId", "quoteId"]),
    returnFields: Object.freeze(["organizationId", "quoteId"])
  }),
  [REVENUE_AUTOPILOT_MUTATION_OPERATIONS.reconcileJob]: Object.freeze({
    callable: REVENUE_AUTOPILOT_CALLABLES.reconcileJob,
    normalize: reconcileJobPayload,
    scopeFields: Object.freeze(["organizationId", "quoteId", "jobId"]),
    returnFields: Object.freeze(["organizationId", "quoteId", "jobId"])
  }),
  [REVENUE_AUTOPILOT_MUTATION_OPERATIONS.acknowledgeReply]: Object.freeze({
    callable: REVENUE_AUTOPILOT_CALLABLES.acknowledgeReply,
    normalize: acknowledgeReplyPayload,
    scopeFields: Object.freeze(["organizationId", "quoteId", "attentionId", "messageId"]),
    returnFields: Object.freeze(["organizationId", "quoteId", "attentionId", "messageId"])
  }),
  [REVENUE_AUTOPILOT_MUTATION_OPERATIONS.unsubscribeEmail]: Object.freeze({
    callable: REVENUE_AUTOPILOT_CALLABLES.unsubscribeEmail,
    normalize: unsubscribeEmailPayload,
    scopeFields: Object.freeze(["token"]),
    returnFields: Object.freeze([])
  })
});

function mutationDefinition(operation) {
  const normalized = text(operation).toLowerCase();
  const definition = MUTATION_DEFINITIONS[normalized];
  if (!definition) {
    throw clientError("invalid-argument", "Revenue Autopilot mutation operation is invalid.");
  }
  return { operation: normalized, definition };
}

function scopeFor(definition, input = {}) {
  const scope = {};
  for (const field of definition.scopeFields) {
    scope[field] = field === "token"
      ? publicToken(input[field])
      : opaqueId(input[field], field);
  }
  return scope;
}

function attemptKey(operation, scope) {
  return [operation, ...Object.values(scope)].join(":");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactPayload(value) {
  return JSON.stringify(value);
}

export function buildRevenueAutopilotRequestId() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `ra_request_${[...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function readPendingRevenueAutopilotAttempt(operation, input = {}) {
  const resolved = mutationDefinition(operation);
  const scope = scopeFor(resolved.definition, input);
  const current = pendingAttempts.get(attemptKey(resolved.operation, scope));
  return current ? clone(current.publicAttempt) : null;
}

function beginRevenueAutopilotAttempt(operation, input = {}) {
  const resolved = mutationDefinition(operation);
  const payload = resolved.definition.normalize(input);
  const scope = scopeFor(resolved.definition, payload);
  const key = attemptKey(resolved.operation, scope);
  const current = pendingAttempts.get(key) || null;
  if (!current && pendingAttempts.size >= MAX_PENDING_REVENUE_AUTOPILOT_ATTEMPTS) {
    throw clientError(
      "failed-precondition",
      "Reconcile or safely reset an unresolved Revenue Autopilot action before starting another one."
    );
  }
  if (current?.definitive) {
    throw clientError(
      "failed-precondition",
      "Reset the definitively rejected Revenue Autopilot action before starting a new request."
    );
  }
  const exactRequestId = requestId(
    input.requestId || current?.requestId || buildRevenueAutopilotRequestId()
  );
  const callablePayload = { ...payload, requestId: exactRequestId };
  const fingerprint = exactPayload(callablePayload);
  if (current && current.fingerprint !== fingerprint) {
    throw clientError(
      "failed-precondition",
      "The unresolved Revenue Autopilot action must be reconciled with unchanged input."
    );
  }
  const mode = current ? "reconciliation" : "submitting";
  const publicAttempt = {
    operation: resolved.operation,
    ...callablePayload,
    mode,
    state: mode,
    error: "",
    definitive: false
  };
  const stored = {
    operation: resolved.operation,
    key,
    scope,
    requestId: exactRequestId,
    callablePayload,
    fingerprint,
    definitive: false,
    publicAttempt
  };
  pendingAttempts.delete(key);
  pendingAttempts.set(key, stored);
  return stored;
}

function markAttemptError(attempt, error) {
  const current = pendingAttempts.get(attempt.key);
  if (!current || current.requestId !== attempt.requestId) return false;
  const definitive = isDefinitiveRevenueAutopilotError(error);
  const message = text(error?.message) || "The Revenue Autopilot action did not return a receipt.";
  const next = {
    ...current,
    definitive,
    publicAttempt: {
      ...current.publicAttempt,
      state: definitive ? "error" : "uncertain",
      error: message,
      definitive
    }
  };
  pendingAttempts.set(attempt.key, next);
  return true;
}

function clearAttempt(attempt) {
  const current = pendingAttempts.get(attempt.key);
  if (!current || current.requestId !== attempt.requestId) return false;
  pendingAttempts.delete(attempt.key);
  return true;
}

function normalizedErrorCode(error) {
  const code = text(error?.code).toLowerCase();
  return code.includes("/") ? code.slice(code.lastIndexOf("/") + 1) : code;
}

export function isDefinitiveRevenueAutopilotError(error) {
  return error?.revenueAutopilotDefinitive === true
    || DEFINITIVE_ERROR_CODES.has(normalizedErrorCode(error));
}

export function resetDefinitiveRevenueAutopilotAttempt(operation, input = {}) {
  const resolved = mutationDefinition(operation);
  const scope = scopeFor(resolved.definition, input);
  const key = attemptKey(resolved.operation, scope);
  const current = pendingAttempts.get(key);
  if (!current?.definitive) return false;
  if (text(input.requestId) && requestId(input.requestId) !== current.requestId) return false;
  pendingAttempts.delete(key);
  return true;
}

function validISO(value) {
  const candidate = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(candidate)) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function exactMutationResult(result, attempt, definition) {
  if (!isRecord(result) || result.ok !== true || result.storage !== "firebase") {
    throw clientError(
      "unknown",
      "The Revenue Autopilot action did not return an exact server receipt.",
      false
    );
  }
  for (const [field, expected] of Object.entries(attempt.scope)) {
    if (text(result[field]) !== expected) {
      throw clientError(
        "unknown",
        "The Revenue Autopilot action did not return an exact server receipt.",
        false
      );
    }
  }
  const receipt = result.receipt;
  if (
    !isRecord(receipt)
    || text(receipt.requestId).toLowerCase() !== attempt.requestId
    || text(receipt.operation).toLowerCase() !== attempt.operation
    || !validISO(receipt.recordedAtISO)
  ) {
    throw clientError(
      "unknown",
      "The Revenue Autopilot action did not return an exact server receipt.",
      false
    );
  }
  for (const [field, expected] of Object.entries(attempt.scope)) {
    if (text(receipt[field]) !== expected) {
      throw clientError(
        "unknown",
        "The Revenue Autopilot action did not return an exact server receipt.",
        false
      );
    }
  }
  const safeReceipt = {
    requestId: attempt.requestId,
    operation: attempt.operation,
    ...Object.fromEntries(definition.returnFields.map((field) => [field, attempt.scope[field]])),
    recordedAtISO: validISO(receipt.recordedAtISO)
  };
  if (definition.requiresPolicyVersion) {
    const policyVersion = text(receipt.policyVersion);
    if (!isOpaqueId(policyVersion) || text(result.policyVersion) !== policyVersion) {
      throw clientError(
        "unknown",
        "The Revenue Autopilot policy action did not return an exact policy receipt.",
        false
      );
    }
    safeReceipt.policyVersion = policyVersion;
  }
  const materializationSummary = attempt.operation
    === REVENUE_AUTOPILOT_MUTATION_OPERATIONS.materializeJobs
    ? normalizeMaterializationSummary(result)
    : null;
  const reconciliationOutcome = attempt.operation
    === REVENUE_AUTOPILOT_MUTATION_OPERATIONS.reconcileJob
    ? normalizeReconciliationOutcome(result)
    : null;
  return Object.freeze({
    ok: true,
    storage: "firebase",
    ...Object.fromEntries(definition.returnFields.map((field) => [field, attempt.scope[field]])),
    receipt: Object.freeze(safeReceipt),
    idempotent: result.idempotent === true,
    mutationMode: attempt.publicAttempt.mode,
    ...(materializationSummary
      ? { materializationSummary }
      : {}),
    ...(reconciliationOutcome || {})
  });
}

function normalizeReconciliationOutcome(result) {
  const reconciliationState = text(result.reconciliationState).toLowerCase();
  if (!RECONCILIATION_STATES.has(reconciliationState)) {
    throw clientError(
      "unknown",
      "The Revenue Autopilot reconciliation receipt omitted its exact outcome.",
      false
    );
  }
  const reason = text(result.reason).toLowerCase();
  if (
    (reason && !/^[a-z][a-z0-9_]{0,79}$/u.test(reason))
    || (reconciliationState === "provider_accepted" && reason)
  ) {
    throw clientError(
      "unknown",
      "The Revenue Autopilot reconciliation receipt included an invalid outcome reason.",
      false
    );
  }
  return Object.freeze({
    reconciliationState,
    ...(reason ? { reason } : {})
  });
}

function normalizeMaterializationSummary(result) {
  const createdCount = safeResultCount(result.createdCount, "createdCount");
  const updatedCount = safeResultCount(result.updatedCount, "updatedCount");
  const rawLanes = isRecord(result.laneResults) ? result.laneResults : null;
  if (!rawLanes) {
    throw clientError(
      "unknown",
      "The Revenue Autopilot materialization receipt omitted its bounded lane results.",
      false
    );
  }
  const unsupported = Object.keys(rawLanes).filter((kind) => !MATERIALIZATION_KINDS.includes(kind));
  if (unsupported.length) {
    throw clientError(
      "unknown",
      "The Revenue Autopilot materialization receipt included an unknown lane.",
      false
    );
  }
  const lanes = Object.fromEntries(MATERIALIZATION_KINDS.map((kind) => {
    const lane = isRecord(rawLanes[kind]) ? rawLanes[kind] : null;
    const state = text(lane?.state).toLowerCase();
    if (!lane || !MATERIALIZATION_STATES.has(state)) {
      throw clientError(
        "unknown",
        "The Revenue Autopilot materialization receipt included an invalid lane state.",
        false
      );
    }
    const rawReasonCodes = Array.isArray(lane.reasonCodes) ? lane.reasonCodes : [];
    if (
      rawReasonCodes.length > 10
      || rawReasonCodes.some((code) => !/^[a-z][a-z0-9_]{0,79}$/u.test(text(code)))
    ) {
      throw clientError(
        "unknown",
        "The Revenue Autopilot materialization receipt included invalid lane reasons.",
        false
      );
    }
    return [kind, Object.freeze({
      state,
      createCount: safeResultCount(lane.createCount, `${kind}.createCount`),
      updateCount: safeResultCount(lane.updateCount, `${kind}.updateCount`),
      conflictCount: safeResultCount(lane.conflictCount, `${kind}.conflictCount`),
      reasonCodes: Object.freeze(rawReasonCodes.map((code) => text(code)))
    })];
  }));
  return Object.freeze({
    createdCount,
    updatedCount,
    lanes: Object.freeze(lanes)
  });
}

function safeResultCount(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_REVENUE_AUTOPILOT_JOB_READS) {
    throw clientError(
      "unknown",
      `The Revenue Autopilot materialization receipt included an invalid ${label}.`,
      false
    );
  }
  return number;
}

function requireConnectedWorkspace(label) {
  if (!firebaseReady || !cloudFunctions) {
    throw clientError(
      "failed-precondition",
      `${label} requires a connected QuotePilot workspace.`
    );
  }
}

async function invokeMutation(operation, input) {
  const resolved = mutationDefinition(operation);
  requireConnectedWorkspace("Revenue Autopilot mutation");
  const attempt = beginRevenueAutopilotAttempt(resolved.operation, input);
  try {
    const call = httpsCallable(cloudFunctions, resolved.definition.callable);
    const response = await call(clone(attempt.callablePayload));
    const result = exactMutationResult(response?.data, attempt, resolved.definition);
    clearAttempt(attempt);
    return result;
  } catch (error) {
    markAttemptError(attempt, error);
    throw error;
  }
}

function exactOperationsRead(result, payload) {
  if (
    !isRecord(result)
    || result.ok !== true
    || result.storage !== "firebase"
    || text(result.organizationId) !== payload.organizationId
    || (payload.quoteId && text(result.quoteId) !== payload.quoteId)
    || !isRecord(result.policy)
    || !Array.isArray(result.jobs)
    || !Array.isArray(result.attention)
    || !isRecord(result.bounds)
    || !validISO(result.observedAtISO)
  ) {
    throw clientError("unknown", "Revenue Autopilot operations returned an invalid scoped read.", false);
  }
  const bounds = result.bounds;
  const totalJobs = Number(bounds.totalJobs);
  const totalAttention = Number(bounds.totalAttention);
  const attentionScopeInvalid = result.attention.some((item) => (
    !isRecord(item)
    || !isOpaqueId(item.attentionId)
    || !isOpaqueId(item.quoteId)
    || !isOpaqueId(item.messageId)
    || text(item.kind).toLowerCase() !== "unread_customer_reply"
    || text(item.state).toLowerCase() !== "open"
    || (payload.quoteId && text(item.quoteId) !== payload.quoteId)
  ));
  if (
    result.jobs.length > payload.jobLimit
    || result.attention.length > payload.attentionLimit
    || !Number.isSafeInteger(totalJobs)
    || totalJobs < result.jobs.length
    || !Number.isSafeInteger(totalAttention)
    || totalAttention < result.attention.length
    || Number(bounds.maximumJobs) !== payload.jobLimit
    || Number(bounds.maximumAttention) !== payload.attentionLimit
    || typeof bounds.complete !== "boolean"
    || typeof bounds.truncated !== "boolean"
    || (bounds.complete && bounds.truncated)
    || attentionScopeInvalid
  ) {
    throw clientError(
      "unknown",
      "Revenue Autopilot operations returned invalid scoped attention; only open unread customer replies are permitted, and read bounds must match.",
      false
    );
  }
  return Object.freeze({
    ok: true,
    storage: "firebase",
    organizationId: payload.organizationId,
    ...(payload.quoteId ? { quoteId: payload.quoteId } : {}),
    policy: normalizeOperationsPolicyProjection(result.policy),
    jobs: Object.freeze([...result.jobs]),
    attention: Object.freeze([...result.attention]),
    bounds: Object.freeze({
      totalJobs,
      maximumJobs: payload.jobLimit,
      totalAttention,
      maximumAttention: payload.attentionLimit,
      complete: bounds.complete,
      truncated: bounds.truncated
    }),
    providerOutcomes: isRecord(result.providerOutcomes) ? result.providerOutcomes : {},
    source: result.source || "firebase",
    observedAtISO: validISO(result.observedAtISO),
    readState: text(result.readState) || (result.jobs.length || result.attention.length ? "success" : "empty")
  });
}

export async function getRevenueAutopilotOperations(input = {}) {
  requireConnectedWorkspace("Revenue Autopilot operations read");
  const payload = normalizeOperationsRead(input);
  const call = httpsCallable(cloudFunctions, REVENUE_AUTOPILOT_CALLABLES.getOperations);
  const response = await call(payload);
  return exactOperationsRead(response?.data, payload);
}

function exactCustomerControlsRead(result, payload) {
  const controls = result?.controls;
  const authorityState = text(controls?.authorityState).toLowerCase();
  const revision = Number(controls?.revision);
  const consentState = text(controls?.consent?.state).toLowerCase();
  const subscriptionState = text(controls?.subscription?.state).toLowerCase();
  const consentAtISO = text(controls?.consent?.recordedAtISO);
  const subscriptionAtISO = text(controls?.subscription?.recordedAtISO);
  const normalizedConsentAtISO = validISO(consentAtISO);
  const normalizedSubscriptionAtISO = validISO(subscriptionAtISO);
  const observedAtISO = validISO(controls?.observedAtISO);
  const dormant = authorityState === "dormant";
  const configured = authorityState === "configured";
  if (
    !isRecord(result)
    || result.ok !== true
    || result.storage !== "firebase"
    || text(result.organizationId) !== payload.organizationId
    || text(result.customerId) !== payload.customerId
    || !isRecord(controls)
    || controls.schemaVersion !== 1
    || controls.authority !== "server_projection"
    || controls.source !== "firebase_server_projection"
    || text(controls.organizationId) !== payload.organizationId
    || text(controls.customerId) !== payload.customerId
    || !observedAtISO
    || (!dormant && !configured)
    || !Number.isSafeInteger(revision)
    || revision < 0
    || (dormant && (
      revision !== 0
      || consentState !== "unknown"
      || subscriptionState !== "unknown"
      || consentAtISO
      || subscriptionAtISO
    ))
    || (configured && (
      revision < 1
      || !new Set(["granted", "revoked"]).has(consentState)
      || !new Set(["subscribed", "unsubscribed"]).has(subscriptionState)
      || !normalizedConsentAtISO
      || !normalizedSubscriptionAtISO
      || (consentState === "revoked" && subscriptionState === "subscribed")
    ))
  ) {
    throw clientError(
      "unknown",
      "Revenue Autopilot customer controls returned an invalid scoped projection.",
      false
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    authority: "server_projection",
    source: "firebase_server_projection",
    organizationId: payload.organizationId,
    customerId: payload.customerId,
    observedAtISO,
    authorityState,
    revision,
    consent: Object.freeze({ state: consentState, recordedAtISO: normalizedConsentAtISO }),
    subscription: Object.freeze({
      state: subscriptionState,
      recordedAtISO: normalizedSubscriptionAtISO
    })
  });
}

export async function getRevenueAutopilotCustomerControls(input = {}) {
  requireConnectedWorkspace("Revenue Autopilot customer-controls read");
  const payload = normalizeCustomerControlsRead(input);
  const call = httpsCallable(
    cloudFunctions,
    REVENUE_AUTOPILOT_CALLABLES.getCustomerControls
  );
  const response = await call(payload);
  return exactCustomerControlsRead(response?.data, payload);
}

export async function configureRevenueAutopilotPolicy(input = {}) {
  return invokeMutation(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configurePolicy, input);
}

export async function configureRevenueAutopilotCustomerControls(input = {}) {
  return invokeMutation(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configureCustomerControls,
    input
  );
}

export async function materializeRevenueAutopilotJobs(input = {}) {
  return invokeMutation(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.materializeJobs, input);
}

export async function reconcileRevenueAutopilotJob(input = {}) {
  return invokeMutation(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.reconcileJob, input);
}

export async function acknowledgeRevenueAutopilotReply(input = {}) {
  return invokeMutation(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.acknowledgeReply, input);
}

export async function getRevenueAutopilotUnsubscribeContext(input = {}) {
  requireConnectedWorkspace("Revenue Autopilot unsubscribe read");
  const payload = normalizeUnsubscribeRead(input);
  const call = httpsCallable(
    cloudFunctions,
    REVENUE_AUTOPILOT_CALLABLES.getUnsubscribeContext
  );
  const response = await call(payload);
  const result = response?.data;
  if (
    !isRecord(result)
    || result.ok !== true
    || result.storage !== "firebase"
    || text(result.token) !== payload.token
    || !isRecord(result.context)
  ) {
    throw clientError("unknown", "Revenue Autopilot unsubscribe context is invalid.", false);
  }
  return Object.freeze({
    ok: true,
    storage: "firebase",
    context: Object.freeze({ ...result.context })
  });
}

export async function unsubscribeRevenueAutopilotEmail(input = {}) {
  return invokeMutation(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.unsubscribeEmail, input);
}

export function readPendingRevenueAutopilotPolicyAttempt(input = {}) {
  return readPendingRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configurePolicy,
    input
  );
}

export function readPendingRevenueAutopilotCustomerControlsAttempt(input = {}) {
  return readPendingRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configureCustomerControls,
    input
  );
}

export function readPendingRevenueAutopilotMaterializationAttempt(input = {}) {
  return readPendingRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.materializeJobs,
    input
  );
}

export function readPendingRevenueAutopilotJobAttempt(input = {}) {
  return readPendingRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.reconcileJob,
    input
  );
}

export function readPendingRevenueAutopilotReplyAttempt(input = {}) {
  return readPendingRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.acknowledgeReply,
    input
  );
}

export function readPendingRevenueAutopilotUnsubscribeAttempt(input = {}) {
  return readPendingRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.unsubscribeEmail,
    input
  );
}

export function resetDefinitiveRevenueAutopilotPolicyAttempt(input = {}) {
  return resetDefinitiveRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configurePolicy,
    input
  );
}

export function resetDefinitiveRevenueAutopilotCustomerControlsAttempt(input = {}) {
  return resetDefinitiveRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configureCustomerControls,
    input
  );
}

export function resetDefinitiveRevenueAutopilotMaterializationAttempt(input = {}) {
  return resetDefinitiveRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.materializeJobs,
    input
  );
}

export function resetDefinitiveRevenueAutopilotJobAttempt(input = {}) {
  return resetDefinitiveRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.reconcileJob,
    input
  );
}

export function resetDefinitiveRevenueAutopilotReplyAttempt(input = {}) {
  return resetDefinitiveRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.acknowledgeReply,
    input
  );
}

export function resetDefinitiveRevenueAutopilotUnsubscribeAttempt(input = {}) {
  return resetDefinitiveRevenueAutopilotAttempt(
    REVENUE_AUTOPILOT_MUTATION_OPERATIONS.unsubscribeEmail,
    input
  );
}
