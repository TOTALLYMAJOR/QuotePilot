import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const GOOGLE_CALENDAR_CALLABLES = Object.freeze({
  status: "getGoogleCalendarStatus",
  start: "startGoogleCalendarConnection",
  eventCommand: "applyGoogleCalendarEventCommand",
  disconnect: "disconnectGoogleCalendar"
});

export const GOOGLE_CALENDAR_STATUS_SCHEMA_VERSION = "google-calendar-public-status-v1";
export const GOOGLE_CALENDAR_EVIDENCE_BOUNDARY =
  "One-way, operator-requested projection of one accepted or booked QuotePilot event into an explicitly connected Google Calendar. Provider acceptance is not customer acceptance, event readiness, staffing, inventory, BEO, checklist, payment, or delivery evidence.";

const CONNECTION_STATES = new Set([
  "unconfigured",
  "authorizing",
  "active",
  "reconnect_required",
  "revoked",
  "disabled"
]);
const SYNC_STATES = new Set([
  "not_synced",
  "queued",
  "dispatching",
  "outcome_uncertain",
  "synced",
  "update_required",
  "cancel_queued",
  "canceled",
  "provider_drift",
  "blocked_connection",
  "definite_failure"
]);
const EVENT_COMMANDS = new Set(["sync", "cancel", "reconcile"]);
const DEFINITIVE_CODES = new Set([
  "aborted",
  "already-exists",
  "data-loss",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "resource-exhausted",
  "unauthenticated"
]);
const ID_PATTERN = /^[^\s/?#\\\p{Cc}\p{Cf}]{1,256}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/u;
const OPERATION_ID_PATTERN = /^calendar_operation_[a-f0-9]{48}$/u;
const SAFE_TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,79}$/u;
const pendingAttempts = new Map();
const activeRequests = new Map();

export class GoogleCalendarClientError extends Error {
  constructor(code, message, { uncertain = false } = {}) {
    super(message);
    this.name = "GoogleCalendarClientError";
    this.code = code;
    if (uncertain) this.uncertain = true;
  }
}

function fail(message, code = "invalid-server-response") {
  throw new GoogleCalendarClientError(code, message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exact(value, fields, message) {
  if (!isRecord(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) {
    fail(message);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value) || value === "." || value === "..") {
    fail(`${label} must be an exact opaque identifier.`, "invalid-argument");
  }
  return value;
}

function boundedRevision(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value >= Number.MAX_SAFE_INTEGER) {
    fail(`${label} must be a bounded revision.`, "invalid-argument");
  }
  return value;
}

function exactISO(value, label, { empty = false } = {}) {
  if (empty && value === "") return "";
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail(`${label} must be an exact timestamp.`);
  }
  return value;
}

function plainText(value, label, maximum, { empty = false } = {}) {
  if (typeof value !== "string" || value.length > maximum
    || /[\p{Cc}\p{Cf}]/u.test(value)
    || (!empty && !value.trim()) || value !== value.trim()) {
    fail(`${label} could not be verified.`);
  }
  return value;
}

function optionalIdentifier(value, label) {
  return value === "" ? "" : identifier(value, label);
}

function optionalToken(value, label) {
  if (value === "") return "";
  if (typeof value !== "string" || !SAFE_TOKEN_PATTERN.test(value)) {
    fail(`${label} could not be verified.`);
  }
  return value;
}

function requestId(value) {
  if (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value)) {
    fail("A stable Google Calendar request identity is required.", "invalid-argument");
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function ensureConnected() {
  if (!firebaseReady || !cloudFunctions) {
    fail("Google Calendar requires a connected QuotePilot workspace.", "unavailable");
  }
}

function normalizeCode(error) {
  return String(error?.code || "unknown").trim().toLowerCase().replace(/^functions\//u, "");
}

function safeError(error, { mutation = false } = {}) {
  if (error instanceof GoogleCalendarClientError) {
    if (mutation && error.code === "invalid-server-response") error.uncertain = true;
    return error;
  }
  const code = normalizeCode(error);
  const message = {
    unauthenticated: "Sign in again to use Google Calendar.",
    "permission-denied": "Your current role cannot change this Google Calendar connection.",
    "invalid-argument": "The Google Calendar request is incomplete or unsupported.",
    "failed-precondition": "Review the current connection, event revision, date, time, duration, and venue before continuing.",
    "not-found": "This exact Google Calendar record is no longer available.",
    "already-exists": "This request identity already belongs to another Google Calendar action.",
    aborted: "The connection or event changed. Refresh and review before continuing.",
    "resource-exhausted": "Google Calendar is temporarily limiting this action.",
    "data-loss": "The retained Calendar evidence could not be verified. Do not rely on this result."
  }[code] || (mutation
    ? "The Google Calendar outcome could not be confirmed. Check the original request before trying again."
    : "Google Calendar status could not be loaded. QuotePilot event details remain unchanged.");
  return new GoogleCalendarClientError(code, message, {
    uncertain: mutation && !DEFINITIVE_CODES.has(code)
  });
}

export function isDefinitiveGoogleCalendarError(error) {
  return error?.uncertain !== true && DEFINITIVE_CODES.has(normalizeCode(error));
}

function normalizeAuthorizationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("The Google authorization link could not be verified.");
  }
  if (url.protocol !== "https:" || url.hostname !== "accounts.google.com"
    || url.username || url.password || url.hash
    || url.pathname !== "/o/oauth2/v2/auth") {
    fail("The Google authorization link could not be verified.");
  }
  return url.toString();
}

function normalizeProviderEventUrl(value) {
  if (value === "") return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("The Google Calendar event link could not be verified.");
  }
  const keys = [...url.searchParams.keys()];
  const eid = url.searchParams.get("eid") || "";
  const approvedHostAndPath = (
    url.hostname === "calendar.google.com" && url.pathname === "/calendar/event"
  ) || (
    url.hostname === "www.google.com" && url.pathname === "/calendar/event"
  );
  if (url.protocol !== "https:" || !approvedHostAndPath
    || url.username || url.password || url.hash
    || keys.length !== 1 || keys[0] !== "eid"
    || !/^[A-Za-z0-9_-]{1,2048}$/u.test(eid)) {
    fail("The Google Calendar event link could not be verified.");
  }
  return url.toString();
}

function normalizeConfiguration(value) {
  exact(value, ["enabled", "configured", "cleanupAvailable"], "The Calendar configuration status could not be verified.");
  if (typeof value.enabled !== "boolean" || typeof value.configured !== "boolean"
    || typeof value.cleanupAvailable !== "boolean"
    || (!value.enabled && value.configured)) {
    fail("The Calendar configuration status is contradictory.");
  }
  return deepFreeze({ ...value });
}

function normalizeConnection(value) {
  exact(value, [
    "state", "connectionRevision", "configurationGeneration", "calendarLabel",
    "reasonCode", "canDisconnect", "authorizationExpiresAtISO"
  ], "The Calendar connection status could not be verified.");
  if (!CONNECTION_STATES.has(value.state)) {
    fail("The Calendar connection state is unsupported.");
  }
  const connection = {
    state: value.state,
    connectionRevision: boundedRevision(value.connectionRevision, "connectionRevision"),
    configurationGeneration: boundedRevision(value.configurationGeneration, "configurationGeneration"),
    calendarLabel: plainText(value.calendarLabel, "Calendar label", 120, { empty: true }),
    reasonCode: optionalToken(value.reasonCode, "connection reasonCode"),
    canDisconnect: value.canDisconnect,
    authorizationExpiresAtISO: exactISO(
      value.authorizationExpiresAtISO,
      "authorizationExpiresAtISO",
      { empty: true }
    )
  };
  if (typeof connection.canDisconnect !== "boolean") {
    fail("The Calendar disconnect availability could not be verified.");
  }
  if (connection.state === "active" && connection.configurationGeneration < 1) {
    fail("The active Calendar connection is missing its configuration generation.");
  }
  return deepFreeze(connection);
}

function normalizeSync(value, { quoteRequested }) {
  if (value === null) {
    if (quoteRequested) fail("The event Calendar status is missing.");
    return null;
  }
  exact(value, [
    "state", "syncRevision", "connectionGeneration", "sourceVersionId", "activeSourceVersionId",
    "reasonCode", "recoveryAction", "lastVerifiedAtISO", "operationId",
    "providerEventUrl"
  ], "The event Calendar status could not be verified.");
  if (!quoteRequested || !SYNC_STATES.has(value.state)) {
    fail("The event Calendar state is unsupported.");
  }
  const sync = {
    state: value.state,
    syncRevision: boundedRevision(value.syncRevision, "syncRevision"),
    connectionGeneration: boundedRevision(value.connectionGeneration, "connectionGeneration"),
    sourceVersionId: optionalIdentifier(value.sourceVersionId, "sourceVersionId"),
    activeSourceVersionId: optionalIdentifier(value.activeSourceVersionId, "activeSourceVersionId"),
    reasonCode: optionalToken(value.reasonCode, "reasonCode"),
    recoveryAction: optionalToken(value.recoveryAction, "recoveryAction"),
    lastVerifiedAtISO: exactISO(value.lastVerifiedAtISO, "lastVerifiedAtISO", { empty: true }),
    operationId: value.operationId === "" ? "" : value.operationId,
    providerEventUrl: normalizeProviderEventUrl(value.providerEventUrl)
  };
  if (sync.operationId && !OPERATION_ID_PATTERN.test(sync.operationId)) {
    fail("The Calendar operation identity could not be verified.");
  }
  if (sync.state === "synced"
    && (!sync.sourceVersionId || sync.sourceVersionId !== sync.activeSourceVersionId
      || !sync.lastVerifiedAtISO)) {
    fail("The current Calendar projection is missing exact revision evidence.");
  }
  if (["queued", "dispatching", "outcome_uncertain", "cancel_queued", "provider_drift"]
    .includes(sync.state) && !sync.operationId) {
    fail("The unresolved Calendar projection is missing its operation identity.");
  }
  return deepFreeze(sync);
}

function normalizeExternalCopy(value) {
  exact(value, [
    "quoteId", "label", "state", "syncRevision", "sourceVersionId",
    "operationId", "recoveryAction", "providerEventUrl"
  ], "The retained Google Calendar copy could not be verified.");
  if (!SYNC_STATES.has(value.state) || ["not_synced", "canceled"].includes(value.state)) {
    fail("The retained Google Calendar copy state is unsupported.");
  }
  const copy = {
    quoteId: identifier(value.quoteId, "external copy quoteId"),
    label: plainText(value.label, "external copy label", 200),
    state: value.state,
    syncRevision: boundedRevision(value.syncRevision, "external copy syncRevision"),
    sourceVersionId: identifier(value.sourceVersionId, "external copy sourceVersionId"),
    operationId: value.operationId === "" ? "" : value.operationId,
    recoveryAction: optionalToken(value.recoveryAction, "external copy recoveryAction"),
    providerEventUrl: normalizeProviderEventUrl(value.providerEventUrl)
  };
  if (copy.operationId && !OPERATION_ID_PATTERN.test(copy.operationId)) {
    fail("The retained Calendar operation identity could not be verified.");
  }
  if (["queued", "dispatching", "outcome_uncertain", "cancel_queued", "provider_drift"]
    .includes(copy.state) && !copy.operationId) {
    fail("The retained Google Calendar copy is missing its recovery identity.");
  }
  return deepFreeze(copy);
}

function normalizeStatus(value, requested) {
  exact(value, [
    "schemaVersion", "configuration", "connection", "sync", "externalCopies",
    "externalCopiesTruncated", "evidenceBoundary"
  ], "The Google Calendar status shape could not be verified.");
  if (value.schemaVersion !== GOOGLE_CALENDAR_STATUS_SCHEMA_VERSION
    || value.evidenceBoundary !== GOOGLE_CALENDAR_EVIDENCE_BOUNDARY) {
    fail("The Google Calendar status policy could not be verified.");
  }
  if (!Array.isArray(value.externalCopies) || value.externalCopies.length > 50
    || typeof value.externalCopiesTruncated !== "boolean") {
    fail("The retained Google Calendar copy boundary could not be verified.");
  }
  const externalCopies = value.externalCopies.map(normalizeExternalCopy);
  if (new Set(externalCopies.map((copy) => copy.quoteId)).size !== externalCopies.length) {
    fail("The retained Google Calendar copy list contains duplicate identities.");
  }
  if (requested.quoteId && (externalCopies.length || value.externalCopiesTruncated)) {
    fail("Event Calendar status exposed unrelated external copies.");
  }
  const status = {
    schemaVersion: value.schemaVersion,
    configuration: normalizeConfiguration(value.configuration),
    connection: normalizeConnection(value.connection),
    sync: normalizeSync(value.sync, { quoteRequested: Boolean(requested.quoteId) }),
    externalCopies,
    externalCopiesTruncated: value.externalCopiesTruncated,
    evidenceBoundary: value.evidenceBoundary
  };
  if (status.connection.state === "active"
    && (!status.configuration.enabled || !status.configuration.configured)) {
    fail("The Google Calendar connection and configuration status conflict.");
  }
  if (status.configuration.cleanupAvailable !== status.connection.canDisconnect) {
    fail("The Google Calendar cleanup availability is contradictory.");
  }
  return deepFreeze(status);
}

function normalizeStatusEnvelope(value, requested) {
  exact(value, ["ok", "status"], "The Google Calendar response shape could not be verified.");
  if (value.ok !== true) fail("The Google Calendar response was not accepted.");
  return deepFreeze({ ok: true, status: normalizeStatus(value.status, requested) });
}

function normalizeStatusRequest(input) {
  const keys = input?.quoteId === undefined
    ? ["organizationId"]
    : ["organizationId", "quoteId"];
  exact(input, keys, "The Calendar status request contains unsupported fields.");
  const request = { organizationId: identifier(input.organizationId, "organizationId") };
  if (input.quoteId !== undefined) request.quoteId = identifier(input.quoteId, "quoteId");
  return deepFreeze(request);
}

export async function getGoogleCalendarStatus(input = {}) {
  ensureConnected();
  const requested = normalizeStatusRequest(input);
  try {
    const callable = httpsCallable(cloudFunctions, GOOGLE_CALENDAR_CALLABLES.status);
    return normalizeStatusEnvelope((await callable(requested)).data, requested);
  } catch (error) {
    throw safeError(error);
  }
}

function normalizeConnectionCommand(input, label, { allowExchangeAcknowledgement = false } = {}) {
  const hasAcknowledgement = Object.hasOwn(
    isRecord(input) ? input : {},
    "acknowledgeUnknownExchange"
  );
  exact(input, [
    "organizationId", "requestId", "expectedConnectionRevision",
    ...(hasAcknowledgement ? ["acknowledgeUnknownExchange"] : [])
  ], `${label} contains unsupported fields.`);
  if (hasAcknowledgement
    && (!allowExchangeAcknowledgement || input.acknowledgeUnknownExchange !== true)) {
    fail("The Google authorization uncertainty acknowledgement is invalid.", "invalid-argument");
  }
  return deepFreeze({
    organizationId: identifier(input.organizationId, "organizationId"),
    requestId: requestId(input.requestId),
    expectedConnectionRevision: boundedRevision(
      input.expectedConnectionRevision,
      "expectedConnectionRevision"
    ),
    ...(hasAcknowledgement ? { acknowledgeUnknownExchange: true } : {})
  });
}

function normalizeEventCommand(input) {
  if (!isRecord(input) || !EVENT_COMMANDS.has(input.command)) {
    fail("Choose a supported Google Calendar event action.", "invalid-argument");
  }
  const extra = input.command === "sync"
    ? ["expectedSourceVersionId"]
    : input.command === "cancel"
      ? ["expectedBoundSourceVersionId"]
      : ["expectedOperationId"];
  exact(input, [
    "organizationId", "quoteId", "requestId", "expectedSyncRevision",
    "expectedConnectionGeneration", "command", ...extra
  ], "The Calendar event request contains unsupported fields.");
  const command = {
    organizationId: identifier(input.organizationId, "organizationId"),
    quoteId: identifier(input.quoteId, "quoteId"),
    requestId: requestId(input.requestId),
    expectedSyncRevision: boundedRevision(input.expectedSyncRevision, "expectedSyncRevision"),
    expectedConnectionGeneration: boundedRevision(
      input.expectedConnectionGeneration,
      "expectedConnectionGeneration",
      1
    ),
    command: input.command
  };
  if (input.command === "sync") {
    command.expectedSourceVersionId = identifier(
      input.expectedSourceVersionId,
      "expectedSourceVersionId"
    );
  } else if (input.command === "cancel") {
    command.expectedBoundSourceVersionId = identifier(
      input.expectedBoundSourceVersionId,
      "expectedBoundSourceVersionId"
    );
  } else {
    if (typeof input.expectedOperationId !== "string"
      || !OPERATION_ID_PATTERN.test(input.expectedOperationId)) {
      fail("An exact Calendar operation identity is required.", "invalid-argument");
    }
    command.expectedOperationId = input.expectedOperationId;
  }
  return deepFreeze(command);
}

function pendingKey(kind, request) {
  return JSON.stringify([
    kind === "event" ? "event" : "connection",
    request.organizationId,
    kind === "event" ? request.quoteId : ""
  ]);
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function readPendingGoogleCalendarMutation(input = {}) {
  if (!input || typeof input !== "object") return null;
  const kind = input.quoteId ? "event" : "connection";
  const value = pendingAttempts.get(pendingKey(kind, input));
  return value ? clone(value) : null;
}

export function resetDefinitiveGoogleCalendarMutation(input = {}) {
  const kind = input.quoteId ? "event" : "connection";
  const key = pendingKey(kind, input);
  const value = pendingAttempts.get(key);
  if (!value?.definitive) return false;
  pendingAttempts.delete(key);
  return true;
}

export function clearResolvedGoogleCalendarMutation(input = {}) {
  const kind = input.quoteId ? "event" : "connection";
  return pendingAttempts.delete(pendingKey(kind, input));
}

export function createGoogleCalendarRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `google_calendar_request_${crypto.randomUUID()}`;
  }
  return `google_calendar_request_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

async function performMutation({ kind, operation, request, callableName, normalizeResult }) {
  ensureConnected();
  const key = pendingKey(kind, request);
  const fingerprint = JSON.stringify(request);
  const retained = pendingAttempts.get(key);
  const isReconciliation = kind === "event" && request.command === "reconcile";
  if (retained && retained.fingerprint !== fingerprint && !isReconciliation) {
    fail("The original Google Calendar request must be reviewed before another change.", "calendar-mutation-blocked");
  }
  const active = activeRequests.get(key);
  if (active) {
    if (active.fingerprint === fingerprint) return active.promise;
    fail("The original Google Calendar request is still running.", "calendar-mutation-blocked");
  }
  pendingAttempts.set(key, { operation, request, fingerprint, definitive: false });
  const promise = (async () => {
    try {
      const callable = httpsCallable(cloudFunctions, callableName);
      const value = normalizeResult((await callable(request)).data, request);
      pendingAttempts.delete(key);
      return value;
    } catch (error) {
      const safe = safeError(error, { mutation: true });
      pendingAttempts.set(key, {
        operation,
        request,
        fingerprint,
        definitive: isDefinitiveGoogleCalendarError(safe)
      });
      throw safe;
    } finally {
      if (activeRequests.get(key)?.promise === promise) activeRequests.delete(key);
    }
  })();
  activeRequests.set(key, { fingerprint, promise });
  return promise;
}

function normalizeStartEnvelope(value, request) {
  if (isRecord(value) && Object.hasOwn(value, "recovered")) {
    exact(value, ["ok", "recovered", "status"], "The Google authorization recovery response shape could not be verified.");
    if (value.ok !== true || value.recovered !== true) {
      fail("Google authorization recovery was not accepted.");
    }
    const recovered = normalizeStatusEnvelope(
      { ok: true, status: value.status },
      { organizationId: request.organizationId }
    );
    return deepFreeze({ ok: true, recovered: true, status: recovered.status });
  }
  exact(value, [
    "ok", "authorizationUrl", "expiresAtISO", "connectionRevision"
  ], "The Google authorization response shape could not be verified.");
  if (value.ok !== true) fail("Google authorization did not start.");
  const connectionRevision = boundedRevision(value.connectionRevision, "connectionRevision");
  if (connectionRevision < request.expectedConnectionRevision) {
    fail("The Google authorization response is older than the connection request.");
  }
  return deepFreeze({
    ok: true,
    recovered: false,
    authorizationUrl: normalizeAuthorizationUrl(value.authorizationUrl),
    expiresAtISO: exactISO(value.expiresAtISO, "authorization expiry"),
    connectionRevision
  });
}

function normalizeDisconnectEnvelope(value, request) {
  const result = normalizeStatusEnvelope(value, request);
  const connection = result.status.connection;
  if (["revocation_outcome_uncertain", "unactivated_grant_revocation_uncertain"]
    .includes(connection.reasonCode)) {
    const error = new GoogleCalendarClientError(
      "calendar-disconnect-uncertain",
      "Google did not confirm whether authorization was revoked. New Calendar updates are blocked; retry only this original disconnect request.",
      { uncertain: true }
    );
    error.status = result.status;
    throw error;
  }
  const retainedCopiesAllowed = [
    "unactivated_grant_revoked_external_copies_retained",
    "rejected_grant_revoked_external_copies_retained",
    "disabled_grant_revoked_external_copies_retained"
  ].includes(connection.reasonCode);
  const disconnectedStateEstablished = connection.state === "revoked"
    || (connection.state === "disabled"
      && connection.reasonCode === "disabled_grant_revoked_external_copies_retained");
  if (connection.connectionRevision <= request.expectedConnectionRevision
    || !disconnectedStateEstablished
    || connection.canDisconnect !== false
    || (!retainedCopiesAllowed && result.status.externalCopies.length > 0)
    || (!retainedCopiesAllowed && result.status.externalCopiesTruncated)) {
    fail("The disconnect response does not establish that future Calendar updates stopped.");
  }
  return result;
}

function normalizeEventEnvelope(value, request) {
  const result = normalizeStatusEnvelope(value, request);
  const sync = result.status.sync;
  if (request.command === "sync"
    && ["synced", "update_required"].includes(sync.state)
    && sync.sourceVersionId !== request.expectedSourceVersionId) {
    fail("The Calendar event response belongs to another quote revision.");
  }
  if (request.command === "cancel"
    && sync.sourceVersionId
    && sync.sourceVersionId !== request.expectedBoundSourceVersionId) {
    fail("The Calendar removal response belongs to another quote revision.");
  }
  return result;
}

export function startGoogleCalendarConnection(input = {}) {
  const request = normalizeConnectionCommand(
    input,
    "The Google Calendar connection request",
    { allowExchangeAcknowledgement: true }
  );
  return performMutation({
    kind: "connection",
    operation: "connect",
    request,
    callableName: GOOGLE_CALENDAR_CALLABLES.start,
    normalizeResult: normalizeStartEnvelope
  });
}

export function disconnectGoogleCalendar(input = {}) {
  const request = normalizeConnectionCommand(input, "The Google Calendar disconnect request");
  return performMutation({
    kind: "connection",
    operation: "disconnect",
    request,
    callableName: GOOGLE_CALENDAR_CALLABLES.disconnect,
    normalizeResult: normalizeDisconnectEnvelope
  });
}

export function applyGoogleCalendarEventCommand(input = {}) {
  const request = normalizeEventCommand(input);
  return performMutation({
    kind: "event",
    operation: request.command,
    request,
    callableName: GOOGLE_CALENDAR_CALLABLES.eventCommand,
    normalizeResult: normalizeEventEnvelope
  });
}

export function syncGoogleCalendarEvent(input = {}) {
  return applyGoogleCalendarEventCommand({ ...input, command: "sync" });
}

export function cancelGoogleCalendarEvent(input = {}) {
  return applyGoogleCalendarEventCommand({ ...input, command: "cancel" });
}

export function reconcileGoogleCalendarEvent(input = {}) {
  return applyGoogleCalendarEventCommand({ ...input, command: "reconcile" });
}
