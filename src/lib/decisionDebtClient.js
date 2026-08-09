import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const DECISION_DEBT_CALLABLES = Object.freeze({
  getSnapshot: "getDecisionDebtSnapshot",
  configurePolicy: "configureDecisionDebtPolicy"
});

export const DECISION_DEBT_REQUEST_ID_PATTERN = /^decision_debt_request_[a-f0-9]{32}$/u;
export const DECISION_DEBT_SNAPSHOT_SCHEMA_VERSION = "decision-debt-snapshot-v1";
export const DECISION_DEBT_FORMULA_VERSION = "decision-debt-score-v1";
export const MAX_DECISION_DEBT_RESULTS = 100;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const DEBT_ID_PATTERN = /^debt_[a-f0-9]{40}$/u;
const DEFINITIVE_ERROR_CODES = new Set([
  "already-exists",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "unauthenticated"
]);
const REVERSIBILITY = new Set(["reversible", "constrained", "irreversible"]);
const URGENCY = new Set(["low", "medium", "high", "critical"]);
const pendingPolicyAttempts = new Map();
const MAX_PENDING_POLICY_ATTEMPTS = 25;

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clientError(code, message, definitive = true) {
  const error = new Error(message);
  error.code = code;
  error.decisionDebtDefinitive = definitive === true;
  return error;
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw clientError("invalid-argument", `${label} is required.`);
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

function assertExactKeys(value, expected, label) {
  const record = requireRecord(value, label);
  const actual = Object.keys(record).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw clientError(
      "invalid-argument",
      `${label} must contain exactly: ${keys.join(", ")}.`
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

function exactDate(value, label) {
  const normalized = text(value);
  const parsed = new Date(`${normalized}T12:00:00.000Z`);
  if (
    !DATE_PATTERN.test(normalized)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw clientError("unknown", `${label} is invalid.`, false);
  }
  return normalized;
}

function exactISO(value, label) {
  const normalized = text(value);
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw clientError("unknown", `${label} is invalid.`, false);
  }
  return normalized;
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw clientError("unknown", `${label} is invalid.`, false);
  }
  return normalized;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw clientError("unknown", `${label} is invalid.`, false);
  return value;
}

function normalizeTimeZone(value, label = "policy.timeZone") {
  const normalized = text(value);
  if (!normalized || normalized.length > 100) {
    throw clientError("invalid-argument", `${label} must be a valid IANA time zone.`);
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: normalized })
      .resolvedOptions()
      .timeZone;
  } catch {
    throw clientError("invalid-argument", `${label} must be a valid IANA time zone.`);
  }
}

function normalizeDecisionType(typeId, value) {
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(typeId)) {
    throw clientError("invalid-argument", `policy.decisionTypes includes invalid key ${typeId}.`);
  }
  const definition = assertExactKeys(
    value,
    ["label", "lockWindowDays", "dependencyWeight", "reversibility"],
    `policy.decisionTypes.${typeId}`
  );
  const label = text(definition.label);
  const reversibility = text(definition.reversibility).toLowerCase();
  if (!label || label.length > 80) {
    throw clientError("invalid-argument", `policy.decisionTypes.${typeId}.label is invalid.`);
  }
  if (!REVERSIBILITY.has(reversibility)) {
    throw clientError("invalid-argument", `policy.decisionTypes.${typeId}.reversibility is invalid.`);
  }
  return {
    label,
    lockWindowDays: boundedInteger(
      definition.lockWindowDays,
      `policy.decisionTypes.${typeId}.lockWindowDays`,
      0,
      365
    ),
    dependencyWeight: boundedInteger(
      definition.dependencyWeight,
      `policy.decisionTypes.${typeId}.dependencyWeight`,
      1,
      5
    ),
    reversibility
  };
}

export function normalizeDecisionDebtPolicy(value) {
  const policy = assertExactKeys(
    value,
    ["schemaVersion", "maxEventHorizonDays", "decisionTypes"],
    "policy"
  );
  if (policy.schemaVersion !== 1) {
    throw clientError("failed-precondition", "policy.schemaVersion is unsupported.");
  }
  const decisionTypes = requireRecord(policy.decisionTypes, "policy.decisionTypes");
  const typeIds = Object.keys(decisionTypes).sort();
  if (typeIds.length < 1 || typeIds.length > 32) {
    throw clientError("invalid-argument", "policy.decisionTypes must contain one to 32 types.");
  }
  return {
    schemaVersion: 1,
    maxEventHorizonDays: boundedInteger(
      policy.maxEventHorizonDays,
      "policy.maxEventHorizonDays",
      1,
      730
    ),
    decisionTypes: Object.fromEntries(
      typeIds.map((typeId) => [typeId, normalizeDecisionType(typeId, decisionTypes[typeId])])
    )
  };
}

function normalizeSnapshotRead(input = {}) {
  const value = assertAllowedKeys(
    input,
    ["organizationId", "quoteId", "limit"],
    "Decision Debt snapshot read"
  );
  const quoteId = optionalOpaqueId(value.quoteId, "quoteId");
  return {
    organizationId: opaqueId(value.organizationId, "organizationId"),
    ...(quoteId ? { quoteId } : {}),
    limit: boundedInteger(value.limit, "limit", 1, MAX_DECISION_DEBT_RESULTS, 50)
  };
}

function normalizePolicyMutation(input = {}) {
  const value = assertAllowedKeys(
    input,
    ["organizationId", "expectedPolicyVersion", "policy", "requestId"],
    "Decision Debt policy mutation"
  );
  const expectedPolicyVersion = optionalOpaqueId(
    value.expectedPolicyVersion,
    "expectedPolicyVersion"
  );
  return {
    organizationId: opaqueId(value.organizationId, "organizationId"),
    ...(expectedPolicyVersion ? { expectedPolicyVersion } : {}),
    policy: normalizeDecisionDebtPolicy(value.policy)
  };
}

function requireConnectedWorkspace(label) {
  if (!firebaseReady || !cloudFunctions) {
    throw clientError("failed-precondition", `${label} requires a connected QuotePilot workspace.`);
  }
}

function exactFactor(value, label) {
  const factor = requireRecord(value, label);
  return {
    ...factor,
    value: integer(factor.value, `${label}.value`, 1, 5),
    source: text(factor.source)
  };
}

function exactExposureFactor(value, label) {
  const factor = requireRecord(value, label);
  const known = boolean(factor.known, `${label}.known`);
  const cents = factor.cents;
  if (known) {
    if (!Number.isSafeInteger(cents) || cents < 0) {
      throw clientError("unknown", "Decision Debt commercial exposure is invalid.", false);
    }
    return {
      ...factor,
      value: integer(factor.value, `${label}.value`, 1, 5),
      known,
      cents,
      source: text(factor.source)
    };
  }
  if (factor.value !== null || cents !== null) {
    throw clientError(
      "unknown",
      "Decision Debt unknown exposure must not carry a guessed factor or amount.",
      false
    );
  }
  return {
    ...factor,
    value: null,
    known: false,
    cents: null,
    source: text(factor.source)
  };
}

function exactDebtItem(value) {
  const item = requireRecord(value, "Decision Debt item");
  const id = text(item.id);
  const affectedNodeIds = Array.isArray(item.affectedNodeIds)
    ? item.affectedNodeIds.map((nodeId) => text(nodeId))
    : [];
  if (
    !DEBT_ID_PATTERN.test(id)
    || !affectedNodeIds.length
    || affectedNodeIds.some((nodeId) => !nodeId || nodeId.length > 160)
    || new Set(affectedNodeIds).size !== affectedNodeIds.length
  ) {
    throw clientError("unknown", "Decision Debt returned an invalid item identity.", false);
  }
  const factors = requireRecord(item.factors, "Decision Debt item factors");
  const dependency = exactFactor(factors.dependency, "Decision Debt dependency factor");
  const proximity = exactFactor(factors.proximity, "Decision Debt proximity factor");
  const exposure = exactExposureFactor(factors.exposure, "Decision Debt exposure factor");
  const reversibility = exactFactor(factors.reversibility, "Decision Debt reversibility factor");
  const cents = exposure.cents;
  const scoreState = text(item.scoreState).toUpperCase();
  if (!new Set(["KNOWN", "UNKNOWN"]).has(scoreState)) {
    throw clientError("unknown", "Decision Debt score state is invalid.", false);
  }
  const scoreKnown = scoreState === "KNOWN";
  if (scoreKnown !== exposure.known) {
    throw clientError("unknown", "Decision Debt score state conflicts with exposure evidence.", false);
  }
  let urgency = null;
  let score = null;
  let rawScore = null;
  if (scoreKnown) {
    urgency = text(item.urgency).toLowerCase();
    if (!URGENCY.has(urgency)) {
      throw clientError("unknown", "Decision Debt urgency is invalid.", false);
    }
    score = integer(item.score, "Decision Debt score", 0, 100);
    rawScore = integer(item.rawScore, "Decision Debt raw score", 0, 625);
  } else if (item.urgency !== null || item.score !== null || item.rawScore !== null) {
    throw clientError(
      "unknown",
      "Decision Debt unknown priority must not carry a guessed score or urgency.",
      false
    );
  }
  const affectedDependencyCount = integer(
    item.affectedDependencyCount,
    "Decision Debt affected dependency count",
    1,
    64
  );
  if (affectedDependencyCount !== affectedNodeIds.length) {
    throw clientError("unknown", "Decision Debt affected dependency count is inconsistent.", false);
  }
  if (
    integer(
      factors.dependency.affectedDependencyCount,
      "Decision Debt dependency factor count",
      1,
      64
    ) !== affectedDependencyCount
    || integer(factors.proximity.lockWindowDays, "Decision Debt lock window", 0, 365) < 0
    || integer(factors.proximity.daysUntilLock, "Decision Debt proximity days", -365, 730)
      !== integer(item.daysUntilLock, "Decision Debt lock days", -365, 730)
    || exactDate(factors.proximity.lockDate, "Decision Debt proximity lockDate")
      !== exactDate(item.lockDate, "Decision Debt lockDate")
    || !REVERSIBILITY.has(text(factors.reversibility.classification).toLowerCase())
  ) {
    throw clientError("unknown", "Decision Debt factor evidence is inconsistent.", false);
  }
  if (item.commercialExposureCents !== cents) {
    throw clientError("unknown", "Decision Debt commercial exposure evidence is inconsistent.", false);
  }
  if (scoreKnown) {
    const expectedRawScore = dependency.value
      * proximity.value
      * exposure.value
      * reversibility.value;
    const expectedScore = Math.min(100, Math.max(0, Math.round((expectedRawScore / 625) * 100)));
    const expectedUrgency = expectedScore >= 80
      ? "critical"
      : expectedScore >= 50
        ? "high"
        : expectedScore >= 25
          ? "medium"
          : "low";
    if (rawScore !== expectedRawScore || score !== expectedScore || urgency !== expectedUrgency) {
      throw clientError("unknown", "Decision Debt deterministic score is inconsistent.", false);
    }
  }
  return Object.freeze({
    ...item,
    id,
    quoteId: opaqueId(item.quoteId, "Decision Debt quoteId"),
    customerId: optionalOpaqueId(item.customerId, "Decision Debt customerId"),
    sourceRevisionId: opaqueId(item.sourceRevisionId, "Decision Debt sourceRevisionId"),
    decisionId: opaqueId(item.decisionId, "Decision Debt decisionId"),
    decisionType: text(item.decisionType).toLowerCase(),
    label: text(item.label),
    eventDate: exactDate(item.eventDate, "Decision Debt eventDate"),
    lockDate: exactDate(item.lockDate, "Decision Debt lockDate"),
    eventDaysAway: integer(item.eventDaysAway, "Decision Debt event days", 0, 730),
    daysUntilLock: integer(item.daysUntilLock, "Decision Debt lock days", -365, 730),
    affectedNodeIds: Object.freeze(affectedNodeIds),
    affectedDependencyCount,
    commercialExposureCents: cents,
    rawScore,
    score,
    scoreState,
    urgency,
    factors: Object.freeze({
      dependency: Object.freeze(dependency),
      proximity: Object.freeze(proximity),
      exposure: Object.freeze(exposure),
      reversibility: Object.freeze(reversibility)
    }),
    explanation: Object.freeze(
      Array.isArray(item.explanation) ? item.explanation.map((line) => text(line)).filter(Boolean) : []
    )
  });
}

function exactSnapshotResult(result, payload) {
  if (
    !isRecord(result)
    || result.ok !== true
    || result.storage !== "firebase"
    || text(result.organizationId) !== payload.organizationId
    || (payload.quoteId && text(result.quoteId) !== payload.quoteId)
    || !isRecord(result.snapshot)
  ) {
    throw clientError("unknown", "Decision Debt returned an invalid scoped snapshot.", false);
  }
  const snapshot = result.snapshot;
  if (
    snapshot.schemaVersion !== DECISION_DEBT_SNAPSHOT_SCHEMA_VERSION
    || snapshot.formulaVersion !== DECISION_DEBT_FORMULA_VERSION
    || snapshot.authority !== "server_derived"
    || snapshot.predictive !== false
    || !DIGEST_PATTERN.test(text(snapshot.snapshotDigest))
    || !Array.isArray(snapshot.items)
    || !isRecord(snapshot.bounds)
    || !isRecord(snapshot.graph)
  ) {
    throw clientError("unknown", "Decision Debt returned an unsupported authority snapshot.", false);
  }
  const bounds = snapshot.bounds;
  const resultLimit = integer(bounds.resultLimit, "Decision Debt result limit", 1, 100);
  const returnedCount = integer(bounds.returnedCount, "Decision Debt returned count", 0, resultLimit);
  const eligibleCount = integer(bounds.eligibleCount, "Decision Debt eligible count", returnedCount, 500);
  const candidateCount = integer(bounds.candidateCount, "Decision Debt candidate count", eligibleCount, 500);
  boolean(bounds.truncated, "Decision Debt truncation marker");
  if (
    resultLimit !== payload.limit
    || returnedCount !== snapshot.items.length
    || (bounds.truncated !== (eligibleCount > returnedCount))
  ) {
    throw clientError("unknown", "Decision Debt returned inconsistent read bounds.", false);
  }
  const items = snapshot.items.map(exactDebtItem);
  const policy = normalizeDecisionDebtPolicy(snapshot.policy);
  const policyVersion = optionalOpaqueId(result.policyVersion, "policyVersion");
  return Object.freeze({
    ok: true,
    storage: "firebase",
    organizationId: payload.organizationId,
    ...(payload.quoteId ? { quoteId: payload.quoteId } : {}),
    policyVersion,
    snapshot: Object.freeze({
      ...snapshot,
      observedAtISO: exactISO(snapshot.observedAtISO, "Decision Debt observation time"),
      tenantTimeZone: normalizeTimeZone(snapshot.tenantTimeZone, "Decision Debt tenant time zone"),
      tenantLocalDate: exactDate(snapshot.tenantLocalDate, "Decision Debt tenant-local date"),
      graph: Object.freeze({
        graphId: opaqueId(snapshot.graph.graphId, "Decision Debt graphId"),
        graphVersion: opaqueId(snapshot.graph.graphVersion, "Decision Debt graphVersion")
      }),
      policy: Object.freeze(policy),
      bounds: Object.freeze({ ...bounds, resultLimit, returnedCount, eligibleCount, candidateCount }),
      items: Object.freeze(items),
      snapshotDigest: text(snapshot.snapshotDigest)
    })
  });
}

export async function getDecisionDebtSnapshot(input = {}) {
  requireConnectedWorkspace("Decision Debt read");
  const payload = normalizeSnapshotRead(input);
  const call = httpsCallable(cloudFunctions, DECISION_DEBT_CALLABLES.getSnapshot);
  const response = await call(payload);
  return exactSnapshotResult(response?.data, payload);
}

export function buildDecisionDebtRequestId() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `decision_debt_request_${[...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function requestId(value) {
  const normalized = text(value).toLowerCase();
  if (!DECISION_DEBT_REQUEST_ID_PATTERN.test(normalized)) {
    throw clientError("invalid-argument", "requestId is invalid.");
  }
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function attemptKey(organizationId) {
  return `configure_policy:${organizationId}`;
}

export function readPendingDecisionDebtPolicyAttempt(input = {}) {
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const current = pendingPolicyAttempts.get(attemptKey(organizationId));
  return current ? clone(current.publicAttempt) : null;
}

function beginPolicyAttempt(input = {}) {
  const payload = normalizePolicyMutation(input);
  const key = attemptKey(payload.organizationId);
  const current = pendingPolicyAttempts.get(key) || null;
  if (!current && pendingPolicyAttempts.size >= MAX_PENDING_POLICY_ATTEMPTS) {
    throw clientError(
      "failed-precondition",
      "Reconcile or safely reset an unresolved Decision Debt policy action before starting another one."
    );
  }
  if (current?.definitive) {
    throw clientError(
      "failed-precondition",
      "Reset the definitively rejected Decision Debt policy action before starting a new request."
    );
  }
  const exactRequestId = requestId(
    input.requestId || current?.requestId || buildDecisionDebtRequestId()
  );
  const callablePayload = { ...payload, requestId: exactRequestId };
  const fingerprint = JSON.stringify(callablePayload);
  if (current && current.fingerprint !== fingerprint) {
    throw clientError(
      "failed-precondition",
      "The unresolved Decision Debt policy action must be reconciled with unchanged input."
    );
  }
  const mode = current ? "reconciliation" : "submitting";
  const publicAttempt = {
    ...callablePayload,
    mode,
    state: mode,
    error: "",
    definitive: false
  };
  const attempt = {
    key,
    requestId: exactRequestId,
    organizationId: payload.organizationId,
    callablePayload,
    fingerprint,
    definitive: false,
    publicAttempt
  };
  pendingPolicyAttempts.delete(key);
  pendingPolicyAttempts.set(key, attempt);
  return attempt;
}

function normalizedErrorCode(error) {
  const code = text(error?.code).toLowerCase();
  return code.includes("/") ? code.slice(code.lastIndexOf("/") + 1) : code;
}

export function isDefinitiveDecisionDebtError(error) {
  return error?.decisionDebtDefinitive === true
    || DEFINITIVE_ERROR_CODES.has(normalizedErrorCode(error));
}

function markPolicyAttemptError(attempt, error) {
  const current = pendingPolicyAttempts.get(attempt.key);
  if (!current || current.requestId !== attempt.requestId) return false;
  const definitive = isDefinitiveDecisionDebtError(error);
  pendingPolicyAttempts.set(attempt.key, {
    ...current,
    definitive,
    publicAttempt: {
      ...current.publicAttempt,
      state: definitive ? "error" : "uncertain",
      error: text(error?.message) || "The Decision Debt policy action did not return a receipt.",
      definitive
    }
  });
  return true;
}

function exactPolicyReceipt(result, attempt) {
  const receipt = result?.receipt;
  if (
    !isRecord(result)
    || result.ok !== true
    || result.storage !== "firebase"
    || text(result.organizationId) !== attempt.organizationId
    || !isRecord(receipt)
    || text(receipt.requestId).toLowerCase() !== attempt.requestId
    || text(receipt.operation).toLowerCase() !== "configure_policy"
    || text(receipt.organizationId) !== attempt.organizationId
  ) {
    throw clientError("unknown", "Decision Debt policy did not return an exact server receipt.", false);
  }
  let policyVersion;
  let policy;
  try {
    policyVersion = opaqueId(receipt.policyVersion, "receipt.policyVersion");
    policy = normalizeDecisionDebtPolicy(result.policy);
  } catch {
    throw clientError("unknown", "Decision Debt policy receipt is malformed.", false);
  }
  if (text(result.policyVersion) !== policyVersion) {
    throw clientError("unknown", "Decision Debt policy version receipt is inconsistent.", false);
  }
  if (JSON.stringify(policy) !== JSON.stringify(attempt.callablePayload.policy)) {
    throw clientError("unknown", "Decision Debt policy receipt does not match the submitted policy.", false);
  }
  return Object.freeze({
    ok: true,
    storage: "firebase",
    organizationId: attempt.organizationId,
    policyVersion,
    policy: Object.freeze(policy),
    receipt: Object.freeze({
      requestId: attempt.requestId,
      operation: "configure_policy",
      organizationId: attempt.organizationId,
      policyVersion,
      recordedAtISO: exactISO(receipt.recordedAtISO, "Decision Debt policy receipt time")
    }),
    idempotent: result.idempotent === true,
    mutationMode: attempt.publicAttempt.mode
  });
}

export async function configureDecisionDebtPolicy(input = {}) {
  requireConnectedWorkspace("Decision Debt policy mutation");
  const attempt = beginPolicyAttempt(input);
  try {
    const call = httpsCallable(cloudFunctions, DECISION_DEBT_CALLABLES.configurePolicy);
    const response = await call(clone(attempt.callablePayload));
    const result = exactPolicyReceipt(response?.data, attempt);
    pendingPolicyAttempts.delete(attempt.key);
    return result;
  } catch (error) {
    markPolicyAttemptError(attempt, error);
    throw error;
  }
}

export async function reconcileDecisionDebtPolicy(input = {}) {
  const value = assertAllowedKeys(
    input,
    ["organizationId", "requestId"],
    "Decision Debt policy reconciliation"
  );
  const organizationId = opaqueId(value.organizationId, "organizationId");
  const current = pendingPolicyAttempts.get(attemptKey(organizationId));
  if (!current) {
    throw clientError("failed-precondition", "There is no unresolved Decision Debt policy request to reconcile.");
  }
  if (current.definitive) {
    throw clientError(
      "failed-precondition",
      "The definitively rejected Decision Debt policy request must be reset, not reconciled."
    );
  }
  if (text(value.requestId) && requestId(value.requestId) !== current.requestId) {
    throw clientError("invalid-argument", "The Decision Debt reconciliation requestId does not match.");
  }
  return configureDecisionDebtPolicy(current.callablePayload);
}

export function resetDefinitiveDecisionDebtPolicyAttempt(input = {}) {
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const key = attemptKey(organizationId);
  const current = pendingPolicyAttempts.get(key);
  if (!current?.definitive) return false;
  if (text(input.requestId) && requestId(input.requestId) !== current.requestId) return false;
  pendingPolicyAttempts.delete(key);
  return true;
}
