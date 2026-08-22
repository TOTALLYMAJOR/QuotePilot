import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

const GET_CALLABLE = "getPostEventProfitReview";
const RECORD_CALLABLE = "recordPostEventProfitReview";
const pendingAttempts = new Map();
const MAX_PENDING_ATTEMPTS = 10;

const text = (value) => String(value ?? "").trim();

function opaqueId(value, label) {
  const normalized = text(value);
  if (!normalized || normalized.length > 256 || /[\s/?#\\\u0000]/u.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function scope(input = {}) {
  return {
    organizationId: opaqueId(input.organizationId, "organizationId"),
    quoteId: opaqueId(input.quoteId, "quoteId"),
    closeoutId: opaqueId(input.closeoutId, "closeoutId")
  };
}

const attemptKey = (input) => [input.organizationId, input.quoteId, input.closeoutId].map(text).join(":");

function mutationPayload(input = {}) {
  return {
    organizationId: input.organizationId,
    quoteId: input.quoteId,
    closeoutId: input.closeoutId,
    action: input.action,
    expectedReviewRevision: input.expectedReviewRevision,
    actuals: input.actuals,
    lossSignals: input.lossSignals,
    confirmedZeroFields: input.confirmedZeroFields,
    comparisonBasisConfirmed: input.comparisonBasisConfirmed,
    targetMarginBps: input.targetMarginBps,
    notes: input.notes
  };
}

export function buildEventProfitReviewRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `profit_review_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `profit_review_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, 80);
}

export function isDefinitiveEventProfitReviewError(error) {
  const code = text(error?.code).toLowerCase().replace(/^functions\//, "");
  return new Set([
    "aborted", "already-exists", "failed-precondition", "invalid-argument",
    "not-found", "permission-denied", "unauthenticated"
  ]).has(code);
}

export function readPendingEventProfitReviewAttempt(input = {}) {
  const stored = pendingAttempts.get(attemptKey(input));
  if (!stored) return null;
  const { payload, definitive, error, ...publicAttempt } = structuredClone(stored);
  return { ...publicAttempt, definitive: definitive === true, error: text(error) };
}

export function beginEventProfitReviewAttempt(input = {}) {
  const ids = scope(input);
  const key = attemptKey(ids);
  const current = pendingAttempts.get(key) || null;
  if (!current && pendingAttempts.size >= MAX_PENDING_ATTEMPTS) {
    throw new Error("Reconcile an unresolved profit review before starting another one.");
  }
  const attempt = {
    ...structuredClone(input),
    ...ids,
    requestId: opaqueId(input.requestId || current?.requestId || buildEventProfitReviewRequestId(), "requestId")
  };
  if (current && JSON.stringify(current.payload) !== JSON.stringify(mutationPayload(attempt))) {
    throw new Error("The unresolved profit review request must be reconciled unchanged.");
  }
  attempt.payload = mutationPayload(attempt);
  attempt.definitive = current?.definitive === true;
  pendingAttempts.set(key, attempt);
  return { ...structuredClone(attempt), mode: current ? "reconciliation" : "submitting" };
}

export function resetDefinitiveEventProfitReviewAttempt(input = {}) {
  const key = attemptKey(input);
  const current = pendingAttempts.get(key);
  if (!current?.definitive) return false;
  pendingAttempts.delete(key);
  return true;
}

export async function getPostEventProfitReview(input = {}) {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Event Profit Review requires a connected QuotePilot workspace.");
  }
  const ids = scope(input);
  const response = await httpsCallable(cloudFunctions, GET_CALLABLE)(ids);
  const result = response?.data;
  if (
    result?.ok !== true
    || text(result.organizationId) !== ids.organizationId
    || text(result.quoteId) !== ids.quoteId
    || text(result.closeoutId) !== ids.closeoutId
    || !result.profitReview
  ) {
    throw new Error("The profit review read did not return the exact authoritative scope.");
  }
  return result;
}

export async function recordPostEventProfitReview(input = {}) {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Event Profit Review requires a connected QuotePilot workspace.");
  }
  const attempt = beginEventProfitReviewAttempt(input);
  const key = attemptKey(attempt);
  try {
    const payload = { ...attempt };
    delete payload.mode;
    delete payload.payload;
    delete payload.definitive;
    const response = await httpsCallable(cloudFunctions, RECORD_CALLABLE)(payload);
    const result = response?.data;
    if (
      result?.ok !== true
      || text(result.organizationId) !== attempt.organizationId
      || text(result.quoteId) !== attempt.quoteId
      || text(result.closeoutId) !== attempt.closeoutId
      || text(result.receipt?.requestId) !== attempt.requestId
    ) {
      throw new Error("The profit review mutation did not return the exact server receipt.");
    }
    pendingAttempts.delete(key);
    return { ...result, mutationMode: attempt.mode };
  } catch (error) {
    const current = pendingAttempts.get(key);
    if (current) pendingAttempts.set(key, {
      ...current,
      definitive: isDefinitiveEventProfitReviewError(error),
      error: text(error?.message)
    });
    throw error;
  }
}
