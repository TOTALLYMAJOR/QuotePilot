import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

const RECORD_POST_EVENT_CLOSEOUT_REVIEW_CALLABLE = "recordPostEventCloseoutReview";
const REFRESH_POST_EVENT_CLOSEOUT_CONFIGURATION_CALLABLE = "refreshPostEventCloseoutConfiguration";
const pendingAttempts = new Map();
const MAX_PENDING_ATTEMPTS = 25;

function text(value) {
  return String(value ?? "").trim();
}

function opaqueId(value, label) {
  const normalized = text(value);
  if (
    !normalized
    || normalized.length > 256
    || /[\s/?#\\\u0000]/u.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/.test(normalized)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function attemptKey({ organizationId, quoteId, closeoutId, itemCode, action }) {
  return [organizationId, quoteId, closeoutId, itemCode, action].map(text).join(":");
}

export function buildPostEventCloseoutRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `closeout_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  const random = Math.random().toString(36).slice(2);
  return `closeout_${Date.now().toString(36)}${random}`.slice(0, 80);
}

export function readPendingPostEventCloseoutAttempt(input = {}) {
  const stored = pendingAttempts.get(attemptKey(input));
  return stored ? { ...stored } : null;
}

export function beginPostEventCloseoutAttempt(input = {}) {
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const quoteId = opaqueId(input.quoteId, "quoteId");
  const closeoutId = opaqueId(input.closeoutId, "closeoutId");
  const itemCode = opaqueId(input.itemCode, "itemCode");
  const action = text(input.action).toLowerCase();
  if (!new Set(["review", "reopen", "refresh_configuration"]).has(action)) {
    throw new Error("Closeout action must be review, reopen, or refresh_configuration.");
  }
  const note = text(input.note).slice(0, 800);
  const key = attemptKey({ organizationId, quoteId, closeoutId, itemCode, action });
  const current = pendingAttempts.get(key) || null;
  if (!current && pendingAttempts.size >= MAX_PENDING_ATTEMPTS) {
    throw new Error("Reconcile an unresolved closeout action before starting another one.");
  }
  const requestId = opaqueId(
    input.requestId || current?.requestId || buildPostEventCloseoutRequestId(),
    "requestId"
  );
  if (current && (current.note !== note || current.requestId !== requestId)) {
    throw new Error("The unresolved closeout action must be reconciled unchanged.");
  }
  const attempt = {
    organizationId,
    quoteId,
    closeoutId,
    itemCode,
    action,
    requestId,
    note,
    error: current?.error || "",
    definitive: current?.definitive === true
  };
  pendingAttempts.delete(key);
  pendingAttempts.set(key, attempt);
  return { ...attempt, mode: current ? "reconciliation" : "submitting" };
}

export function markPendingPostEventCloseoutAttemptError(input = {}, error = "", definitive = false) {
  const key = attemptKey(input);
  const current = pendingAttempts.get(key);
  if (!current || text(current.requestId) !== text(input.requestId)) return false;
  pendingAttempts.set(key, {
    ...current,
    error: text(error),
    definitive: definitive === true
  });
  return true;
}

export function clearPendingPostEventCloseoutAttempt(input = {}, resolution = "receipt") {
  if (!new Set(["receipt", "safe_reset"]).has(text(resolution))) return false;
  const key = attemptKey(input);
  const current = pendingAttempts.get(key);
  if (!current || text(current.requestId) !== text(input.requestId)) return false;
  pendingAttempts.delete(key);
  return true;
}

export function isDefinitivePostEventCloseoutError(error) {
  const code = text(error?.code).toLowerCase().replace(/^functions\//, "");
  return new Set([
    "already-exists",
    "failed-precondition",
    "invalid-argument",
    "not-found",
    "permission-denied",
    "unauthenticated"
  ]).has(code);
}

export async function recordPostEventCloseoutReview(input = {}) {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Authoritative closeout review requires a connected QuotePilot workspace.");
  }
  const attempt = beginPostEventCloseoutAttempt(input);
  try {
    const call = httpsCallable(cloudFunctions, RECORD_POST_EVENT_CLOSEOUT_REVIEW_CALLABLE);
    const response = await call({
      organizationId: attempt.organizationId,
      quoteId: attempt.quoteId,
      closeoutId: attempt.closeoutId,
      itemCode: attempt.itemCode,
      action: attempt.action,
      requestId: attempt.requestId,
      note: attempt.note
    });
    const result = response?.data;
    if (
      result?.ok !== true
      || text(result.organizationId) !== attempt.organizationId
      || text(result.quoteId) !== attempt.quoteId
      || text(result.closeoutId) !== attempt.closeoutId
      || text(result.receipt?.requestId) !== attempt.requestId
    ) {
      throw new Error("The closeout action did not return an exact server receipt.");
    }
    clearPendingPostEventCloseoutAttempt(attempt, "receipt");
    return { ...result, mutationMode: attempt.mode };
  } catch (error) {
    markPendingPostEventCloseoutAttemptError(
      attempt,
      error?.message || "The closeout action did not return a server receipt.",
      isDefinitivePostEventCloseoutError(error)
    );
    throw error;
  }
}

function configurationAttemptInput(input = {}) {
  return {
    organizationId: input.organizationId,
    quoteId: input.quoteId,
    closeoutId: input.closeoutId,
    itemCode: "configuration",
    action: "refresh_configuration",
    requestId: input.requestId,
    note: ""
  };
}

export function readPendingPostEventCloseoutConfigurationAttempt(input = {}) {
  return readPendingPostEventCloseoutAttempt(configurationAttemptInput(input));
}

export async function refreshPostEventCloseoutConfiguration(input = {}) {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Authoritative closeout configuration refresh requires a connected QuotePilot workspace.");
  }
  const attempt = beginPostEventCloseoutAttempt(configurationAttemptInput(input));
  try {
    const call = httpsCallable(
      cloudFunctions,
      REFRESH_POST_EVENT_CLOSEOUT_CONFIGURATION_CALLABLE
    );
    const response = await call({
      organizationId: attempt.organizationId,
      quoteId: attempt.quoteId,
      closeoutId: attempt.closeoutId,
      requestId: attempt.requestId
    });
    const result = response?.data;
    if (
      result?.ok !== true
      || text(result.organizationId) !== attempt.organizationId
      || text(result.quoteId) !== attempt.quoteId
      || text(result.closeoutId) !== attempt.closeoutId
      || text(result.receipt?.requestId) !== attempt.requestId
      || text(result.receipt?.action) !== "refresh_configuration"
    ) {
      throw new Error("The closeout configuration refresh did not return an exact server receipt.");
    }
    clearPendingPostEventCloseoutAttempt(attempt, "receipt");
    return { ...result, mutationMode: attempt.mode };
  } catch (error) {
    markPendingPostEventCloseoutAttemptError(
      attempt,
      error?.message || "The closeout configuration refresh did not return a server receipt.",
      isDefinitivePostEventCloseoutError(error)
    );
    throw error;
  }
}

export function resetDefinitivePostEventCloseoutAttempt(input = {}) {
  const current = readPendingPostEventCloseoutAttempt(input);
  if (!current?.definitive) return false;
  return clearPendingPostEventCloseoutAttempt(current, "safe_reset");
}

export function resetDefinitivePostEventCloseoutConfigurationAttempt(input = {}) {
  return resetDefinitivePostEventCloseoutAttempt(configurationAttemptInput(input));
}
