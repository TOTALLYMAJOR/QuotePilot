import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const KITCHEN_BEO_CALLABLES = Object.freeze({
  status: "getKitchenBeoArtifactStatus",
  download: "downloadKitchenBeoReceipt",
  generate: "generateKitchenBeo"
});

const pendingAttempts = new Map();
const MAX_PENDING_ATTEMPTS = 25;
const REQUEST_ID_PATTERN = /^beo_request_[a-f0-9]{32}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const RECEIPT_ID_PATTERN = /^beo_[a-f0-9]{48}$/u;
const APPLY_RECEIPT_ID_PATTERN = /^ccp_[a-f0-9]{48}$/u;
const RECONCILIATION_RECEIPT_ID_PATTERN = /^ccr_[a-f0-9]{48}$/u;
const INVALIDATION_ID_PATTERN = /^cci_[a-f0-9]{48}$/u;
const STATUS_SCHEMA_VERSION = "kitchen-beo-artifact-status-v1";
const RECEIPT_HISTORY_SCHEMA_VERSION = 1;
const RECEIPT_HISTORY_LIMIT = 10;
const FRESHNESS_STATES = new Set(["CURRENT", "STALE", "REVIEW", "NOT_GENERATED", "UNKNOWN"]);
const RECEIPT_HISTORY_STATES = new Set(["COMPLETE", "PARTIAL", "UNKNOWN"]);

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function opaqueId(value, label) {
  const normalized = text(value);
  if (
    !IDENTIFIER_PATTERN.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/u.test(normalized)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function ensureConnected() {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Authoritative Kitchen BEO generation requires a connected QuotePilot workspace.");
  }
}

function normalizeScope(input = {}) {
  return {
    organizationId: opaqueId(input.organizationId, "organizationId"),
    quoteId: opaqueId(input.quoteId, "quoteId")
  };
}

function attemptKey(input = {}) {
  const scope = normalizeScope(input);
  return `${scope.organizationId}:${scope.quoteId}`;
}

export function buildKitchenBeoRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `beo_request_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  const random = `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
    .replace(/[^a-f0-9]/gu, "")
    .padEnd(32, "0")
    .slice(0, 32);
  return `beo_request_${random}`;
}

export function readPendingKitchenBeoAttempt(input = {}) {
  const current = pendingAttempts.get(attemptKey(input));
  return current ? { ...current } : null;
}

function beginAttempt(input = {}) {
  const scope = normalizeScope(input);
  const key = attemptKey(scope);
  const current = pendingAttempts.get(key) || null;
  if (!current && pendingAttempts.size >= MAX_PENDING_ATTEMPTS) {
    throw new Error("Reconcile an unresolved Kitchen BEO request before starting another one.");
  }
  const requestId = text(input.requestId || current?.requestId || buildKitchenBeoRequestId()).toLowerCase();
  if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error("requestId is invalid.");
  if (current && current.requestId !== requestId) {
    throw new Error("The unresolved Kitchen BEO request must be reconciled unchanged.");
  }
  const attempt = {
    ...scope,
    requestId,
    error: current?.error || "",
    definitive: current?.definitive === true
  };
  pendingAttempts.set(key, attempt);
  return { ...attempt, mode: current ? "reconciliation" : "submitting" };
}

export function isDefinitiveKitchenBeoError(error) {
  const code = text(error?.code).toLowerCase().replace(/^functions\//u, "");
  return new Set([
    "already-exists",
    "failed-precondition",
    "invalid-argument",
    "not-found",
    "permission-denied",
    "unauthenticated"
  ]).has(code);
}

function exactISO(value, label) {
  const normalized = text(value);
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function normalizeReceiptMetadata(value, { current, scope }) {
  const receipt = record(value) ? value : {};
  const receiptId = text(receipt.receiptId).toLowerCase();
  const requestId = text(receipt.requestId);
  const commercialSourceRevisionId = text(receipt.commercialSourceRevisionId);
  const dependencyFingerprint = text(receipt.dependencyFingerprint).toLowerCase();
  const filename = text(receipt.filename);
  const artifactByteLength = Number(receipt.artifactByteLength);
  const email = text(receipt.generatedBy?.email).toLowerCase();
  const role = text(receipt.generatedBy?.role).toLowerCase();
  if (
    !RECEIPT_ID_PATTERN.test(receiptId)
    || !/^[A-Za-z0-9_-]{1,160}$/u.test(requestId)
    || !IDENTIFIER_PATTERN.test(commercialSourceRevisionId)
    || !DIGEST_PATTERN.test(dependencyFingerprint)
    || !/^[A-Za-z0-9_.-]+\.pdf$/iu.test(filename)
    || filename.includes("..")
    || !Number.isSafeInteger(artifactByteLength)
    || artifactByteLength < 1
    || artifactByteLength > 700_000
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
    || !new Set(["admin", "sales"]).has(role)
    || receipt.current !== current
  ) {
    throw new Error(`Kitchen BEO receipt history returned invalid ${scope} evidence.`);
  }
  return Object.freeze({
    receiptId,
    requestId,
    commercialSourceRevisionId,
    dependencyFingerprint,
    generatedAtISO: exactISO(receipt.generatedAtISO, "Kitchen BEO receipt generation time"),
    filename,
    artifactByteLength,
    generatedBy: Object.freeze({ email, role }),
    current
  });
}

function normalizeReceiptHistory(value, statusReceiptId) {
  const history = record(value) ? value : {};
  const state = text(history.state).toUpperCase();
  const bounds = record(history.bounds) ? history.bounds : {};
  const reasonCodes = Array.isArray(history.reasonCodes)
    ? history.reasonCodes.map((reason) => text(reason)).filter(Boolean)
    : null;
  const receipts = Array.isArray(history.receipts) ? history.receipts : null;
  const limit = Number(bounds.limit);
  const returnedCount = Number(bounds.returnedCount);
  const truncated = bounds.truncated;
  if (
    history.schemaVersion !== RECEIPT_HISTORY_SCHEMA_VERSION
    || history.authority !== "server_projection"
    || !RECEIPT_HISTORY_STATES.has(state)
    || limit !== RECEIPT_HISTORY_LIMIT
    || !Number.isSafeInteger(returnedCount)
    || returnedCount < 0
    || returnedCount > limit
    || typeof truncated !== "boolean"
    || !reasonCodes
    || reasonCodes.length > 8
    || !receipts
    || receipts.length !== returnedCount
    || (state === "UNKNOWN" && (returnedCount !== 0 || truncated !== true))
    || (state === "COMPLETE" && truncated !== false)
    || (state === "PARTIAL" && truncated !== true)
  ) {
    throw new Error("Kitchen BEO receipt history did not return an exact bounded projection.");
  }
  const normalizedReceipts = receipts.map((receipt, index) => normalizeReceiptMetadata(
    receipt,
    { current: index === 0, scope: `position ${index + 1}` }
  ));
  const receiptIds = normalizedReceipts.map((receipt) => receipt.receiptId);
  if (
    new Set(receiptIds).size !== receiptIds.length
    || Boolean(statusReceiptId) !== Boolean(normalizedReceipts.length)
    || (statusReceiptId && normalizedReceipts[0]?.receiptId !== statusReceiptId)
  ) {
    throw new Error("Kitchen BEO receipt history does not match the current artifact pointer.");
  }
  return Object.freeze({
    schemaVersion: RECEIPT_HISTORY_SCHEMA_VERSION,
    authority: "server_projection",
    state,
    bounds: Object.freeze({ limit, returnedCount, truncated }),
    reasonCodes: Object.freeze(reasonCodes),
    receipts: Object.freeze(normalizedReceipts)
  });
}

function normalizeStatus(result, scope) {
  const status = result?.status;
  const state = text(status?.state).toUpperCase();
  const observedAtISO = text(status?.observedAtISO);
  const observedAt = new Date(observedAtISO);
  const reasonCodes = Array.isArray(status?.reasonCodes)
    ? status.reasonCodes.map((value) => text(value)).filter(Boolean)
    : null;
  const unresolvedInvalidationIds = Array.isArray(status?.unresolvedInvalidationIds)
    ? status.unresolvedInvalidationIds.map((value) => opaqueId(value, "invalidationId"))
    : null;
  const currentDependencyFingerprint = text(status?.currentDependencyFingerprint).toLowerCase();
  const receiptDependencyFingerprint = text(status?.receiptDependencyFingerprint).toLowerCase();
  const receiptId = text(status?.receiptId);
  const commercialSourceRevisionId = text(status?.commercialSourceRevisionId);
  if (
    result?.ok !== true
    || result?.storage !== "firebase"
    || text(result.organizationId) !== scope.organizationId
    || text(result.quoteId) !== scope.quoteId
    || !record(status)
    || status.schemaVersion !== STATUS_SCHEMA_VERSION
    || status.authority !== "server_derived"
    || !FRESHNESS_STATES.has(state)
    || !observedAtISO
    || Number.isNaN(observedAt.getTime())
    || observedAt.toISOString() !== observedAtISO
    || !reasonCodes
    || reasonCodes.length > 12
    || !unresolvedInvalidationIds
    || unresolvedInvalidationIds.length > 100
    || (currentDependencyFingerprint && !DIGEST_PATTERN.test(currentDependencyFingerprint))
    || (receiptDependencyFingerprint && !DIGEST_PATTERN.test(receiptDependencyFingerprint))
    || Boolean(receiptId) !== Boolean(receiptDependencyFingerprint)
    || Boolean(receiptId) !== Boolean(commercialSourceRevisionId)
  ) {
    throw new Error("Kitchen BEO status did not return an exact server projection.");
  }
  const receiptHistory = normalizeReceiptHistory(result?.receiptHistory, receiptId);
  return Object.freeze({
    schemaVersion: STATUS_SCHEMA_VERSION,
    authority: "server_derived",
    state,
    observedAtISO,
    reasonCodes: Object.freeze(reasonCodes),
    currentDependencyFingerprint,
    receiptId,
    receiptDependencyFingerprint,
    commercialSourceRevisionId,
    unresolvedInvalidationIds: Object.freeze(unresolvedInvalidationIds),
    receiptHistory
  });
}

function normalizeDependencyReconciliation(value) {
  if (value === null || value === undefined) return null;
  const reconciliation = record(value) ? value : {};
  const receiptId = text(reconciliation.receiptId).toLowerCase();
  const applyReceiptId = text(reconciliation.applyReceiptId).toLowerCase();
  const invalidationIds = Array.isArray(reconciliation.resolvedInvalidationIds)
    ? reconciliation.resolvedInvalidationIds.map((item) => text(item).toLowerCase())
    : null;
  const resolvedCount = Number(reconciliation.resolvedCount);
  if (
    !RECONCILIATION_RECEIPT_ID_PATTERN.test(receiptId)
    || !APPLY_RECEIPT_ID_PATTERN.test(applyReceiptId)
    || !invalidationIds
    || !invalidationIds.length
    || invalidationIds.length > 64
    || invalidationIds.some((item) => !INVALIDATION_ID_PATTERN.test(item))
    || new Set(invalidationIds).size !== invalidationIds.length
    || resolvedCount !== invalidationIds.length
  ) {
    throw new Error("Kitchen BEO generation returned invalid dependency reconciliation evidence.");
  }
  return Object.freeze({
    receiptId,
    applyReceiptId,
    resolvedInvalidationIds: Object.freeze(invalidationIds),
    resolvedCount
  });
}

export async function getKitchenBeoArtifactStatus(input = {}) {
  ensureConnected();
  const scope = normalizeScope(input);
  const call = httpsCallable(cloudFunctions, KITCHEN_BEO_CALLABLES.status);
  const response = await call(scope);
  return normalizeStatus(response?.data, scope);
}

function validArtifact(artifact) {
  return record(artifact)
    && artifact.mimeType === "application/pdf"
    && /^[A-Za-z0-9_.-]+\.pdf$/iu.test(text(artifact.filename))
    && !text(artifact.filename).includes("..")
    && text(artifact.base64).length <= 1_000_000
    && /^[A-Za-z0-9+/]+={0,2}$/u.test(text(artifact.base64));
}

export async function getKitchenBeoReceiptArtifact(input = {}) {
  ensureConnected();
  const scope = normalizeScope(input);
  const receiptId = text(input.receiptId).toLowerCase();
  if (!RECEIPT_ID_PATTERN.test(receiptId)) throw new Error("receiptId is invalid.");
  const call = httpsCallable(cloudFunctions, KITCHEN_BEO_CALLABLES.download);
  const response = await call({ ...scope, receiptId });
  const result = response?.data;
  if (
    result?.ok !== true
    || result?.storage !== "firebase"
    || text(result.organizationId) !== scope.organizationId
    || text(result.quoteId) !== scope.quoteId
    || !record(result.receipt)
    || text(result.receipt.receiptId) !== receiptId
    || !validArtifact(result.artifact)
    || text(result.receipt.filename) !== text(result.artifact.filename)
  ) {
    throw new Error("Kitchen BEO receipt download did not return exact immutable evidence.");
  }
  return Object.freeze({
    ok: true,
    storage: "firebase",
    ...scope,
    receipt: Object.freeze({ ...result.receipt }),
    artifact: Object.freeze({ ...result.artifact })
  });
}

export async function generateKitchenBeo(input = {}) {
  ensureConnected();
  const attempt = beginAttempt(input);
  const key = attemptKey(attempt);
  try {
    const call = httpsCallable(cloudFunctions, KITCHEN_BEO_CALLABLES.generate);
    const response = await call({
      organizationId: attempt.organizationId,
      quoteId: attempt.quoteId,
      requestId: attempt.requestId
    });
    const result = response?.data;
    const status = normalizeStatus(result, attempt);
    const dependencyReconciliation = normalizeDependencyReconciliation(
      result?.dependencyReconciliation
    );
    if (
      text(result?.receipt?.requestId) !== attempt.requestId
      || !text(result?.receipt?.receiptId)
      || !validArtifact(result?.artifact)
    ) {
      throw new Error("Kitchen BEO generation did not return an exact artifact receipt.");
    }
    pendingAttempts.delete(key);
    return Object.freeze({
      ok: true,
      storage: "firebase",
      organizationId: attempt.organizationId,
      quoteId: attempt.quoteId,
      idempotent: result.idempotent === true,
      mutationMode: attempt.mode,
      receipt: Object.freeze({ ...result.receipt }),
      status,
      dependencyReconciliation,
      artifact: Object.freeze({ ...result.artifact })
    });
  } catch (error) {
    pendingAttempts.set(key, {
      ...attempt,
      error: error?.message || "Kitchen BEO generation outcome is uncertain.",
      definitive: isDefinitiveKitchenBeoError(error)
    });
    throw error;
  }
}

export function resetDefinitiveKitchenBeoAttempt(input = {}) {
  const key = attemptKey(input);
  const current = pendingAttempts.get(key);
  if (!current?.definitive) return false;
  pendingAttempts.delete(key);
  return true;
}

export function downloadKitchenBeoArtifact(artifact = {}) {
  if (!validArtifact(artifact)) throw new Error("Kitchen BEO artifact is invalid.");
  const binary = atob(artifact.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
