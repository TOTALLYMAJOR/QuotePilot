import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

const RECORD_POST_EVENT_CLOSEOUT_REVIEW_CALLABLE = "recordPostEventCloseoutReview";
const RECORD_POST_EVENT_ACTUAL_ATTENDANCE_CALLABLE = "recordPostEventActualAttendance";
const REFRESH_POST_EVENT_CLOSEOUT_CONFIGURATION_CALLABLE = "refreshPostEventCloseoutConfiguration";
const pendingAttempts = new Map();
const pendingAttendanceAttempts = new Map();
const MAX_PENDING_ATTEMPTS = 25;
const ACTUAL_ATTENDANCE_SOURCE_TYPES = new Set([
  "staff_observed",
  "customer_reported",
  "venue_reported",
  "imported_record"
]);

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

export function buildPostEventActualAttendanceRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `attendance_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  const random = Math.random().toString(36).slice(2);
  return `attendance_${Date.now().toString(36)}${random}`.slice(0, 80);
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
    "aborted",
    "failed-precondition",
    "invalid-argument",
    "not-found",
    "permission-denied",
    "unauthenticated"
  ]).has(code);
}

function attendanceAttemptKey({ organizationId, quoteId, closeoutId }) {
  return [organizationId, quoteId, closeoutId, "actual_attendance"].map(text).join(":");
}

function normalizeActualAttendanceAttempt(input = {}) {
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const quoteId = opaqueId(input.quoteId, "quoteId");
  const closeoutId = opaqueId(input.closeoutId, "closeoutId");
  const action = text(input.action).toLowerCase();
  const sourceType = text(input.sourceType).toLowerCase();
  const expectedRevision = Number(input.expectedRevision);
  const count = Number(input.count);
  const note = text(input.note);
  if (!new Set(["record", "correct"]).has(action)) {
    throw new Error("Actual attendance action must be record or correct.");
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("Actual attendance requires the current nonnegative revision.");
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 400) {
    throw new Error("Actual attendance must be a whole number from 1 to 400.");
  }
  if (!ACTUAL_ATTENDANCE_SOURCE_TYPES.has(sourceType)) {
    throw new Error("Choose an actual-attendance source.");
  }
  if (
    !note
    || note.length > 240
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(note)
  ) {
    throw new Error("Add a plain-text source note of 240 characters or fewer.");
  }
  return {
    organizationId,
    quoteId,
    closeoutId,
    action,
    requestId: opaqueId(
      input.requestId || buildPostEventActualAttendanceRequestId(),
      "requestId"
    ),
    expectedRevision,
    count,
    sourceType,
    note
  };
}

export function readPendingPostEventActualAttendanceAttempt(input = {}) {
  const stored = pendingAttendanceAttempts.get(attendanceAttemptKey(input));
  return stored ? { ...stored } : null;
}

export function beginPostEventActualAttendanceAttempt(input = {}) {
  const key = attendanceAttemptKey(input);
  const current = pendingAttendanceAttempts.get(key) || null;
  const attempt = normalizeActualAttendanceAttempt({
    ...input,
    requestId: input.requestId || current?.requestId
  });
  if (!current && pendingAttendanceAttempts.size >= MAX_PENDING_ATTEMPTS) {
    throw new Error("Reconcile an unresolved actual-attendance action before starting another one.");
  }
  const comparable = ({ definitive: _definitive, error: _error, ...value }) => value;
  if (
    current
    && JSON.stringify(comparable(current)) !== JSON.stringify(attempt)
  ) {
    throw new Error("The unresolved actual-attendance request must be reconciled unchanged.");
  }
  const retained = {
    ...attempt,
    error: current?.error || "",
    definitive: current?.definitive === true
  };
  pendingAttendanceAttempts.set(key, retained);
  return { ...retained, mode: current ? "reconciliation" : "submitting" };
}

function markPostEventActualAttendanceAttemptError(input, error, definitive) {
  const key = attendanceAttemptKey(input);
  const current = pendingAttendanceAttempts.get(key);
  if (!current || current.requestId !== input.requestId) return false;
  pendingAttendanceAttempts.set(key, {
    ...current,
    error: text(error),
    definitive: definitive === true
  });
  return true;
}

function clearPostEventActualAttendanceAttempt(input) {
  const key = attendanceAttemptKey(input);
  const current = pendingAttendanceAttempts.get(key);
  if (!current || current.requestId !== input.requestId) return false;
  pendingAttendanceAttempts.delete(key);
  return true;
}

export function resetDefinitivePostEventActualAttendanceAttempt(input = {}) {
  const current = readPendingPostEventActualAttendanceAttempt(input);
  if (!current?.definitive) return false;
  return clearPostEventActualAttendanceAttempt(current);
}

export async function recordPostEventActualAttendance(input = {}) {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Authoritative actual attendance requires a connected QuotePilot workspace.");
  }
  const attempt = beginPostEventActualAttendanceAttempt(input);
  try {
    const call = httpsCallable(
      cloudFunctions,
      RECORD_POST_EVENT_ACTUAL_ATTENDANCE_CALLABLE
    );
    const response = await call({
      organizationId: attempt.organizationId,
      quoteId: attempt.quoteId,
      closeoutId: attempt.closeoutId,
      action: attempt.action,
      requestId: attempt.requestId,
      expectedRevision: attempt.expectedRevision,
      count: attempt.count,
      sourceType: attempt.sourceType,
      note: attempt.note
    });
    const result = response?.data;
    if (
      result?.ok !== true
      || text(result.storage) !== "firebase"
      || text(result.organizationId) !== attempt.organizationId
      || text(result.quoteId) !== attempt.quoteId
      || text(result.closeoutId) !== attempt.closeoutId
      || text(result.receipt?.requestId) !== attempt.requestId
      || text(result.receipt?.action) !== attempt.action
      || Number(result.receipt?.priorRevision) !== attempt.expectedRevision
      || Number(result.receipt?.resultRevision) !== attempt.expectedRevision + 1
      || Number(result.receipt?.count) !== attempt.count
      || text(result.receipt?.sourceType) !== attempt.sourceType
      || Number(result.postEventCloseout?.actualAttendance?.revision)
        !== attempt.expectedRevision + 1
      || Number(result.postEventCloseout?.actualAttendance?.count) !== attempt.count
      || text(result.postEventCloseout?.actualAttendance?.sourceType) !== attempt.sourceType
    ) {
      throw new Error("The actual-attendance action did not return an exact server receipt.");
    }
    clearPostEventActualAttendanceAttempt(attempt);
    return { ...result, mutationMode: attempt.mode };
  } catch (error) {
    markPostEventActualAttendanceAttemptError(
      attempt,
      error?.message || "The actual-attendance action did not return a server receipt.",
      isDefinitivePostEventCloseoutError(error)
    );
    throw error;
  }
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
