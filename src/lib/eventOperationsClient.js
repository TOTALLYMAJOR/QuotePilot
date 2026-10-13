import { beginEventOperatingMutation, failEventOperatingMutation, releaseEventOperatingMutation } from "./eventOperatingMutationGuard";
import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const EVENT_OPERATING_CALLABLES = Object.freeze({ read: "getEventOperatingSnapshot", command: "applyEventOperatingCommand" });
const PHASES = ["prepared", "in_progress", "completed"];
const DEFINITIVE = new Set(["unauthenticated", "permission-denied", "invalid-argument", "failed-precondition", "not-found", "already-exists", "aborted", "resource-exhausted"]);
const pending = new Map();
const text = (value) => String(value ?? "").trim();
function fail(message, code = "invalid-server-response") { throw Object.assign(new Error(message), { code }); }
function id(value) { return typeof value === "string" && /^[^\s/?#\\\u0000]{1,256}$/u.test(value) && ![".", ".."].includes(value); }
function scope(input) {
  if (!id(input.organizationId) || !id(input.quoteId)) fail("An exact workspace and event are required.", "invalid-argument");
  return { organizationId: input.organizationId, quoteId: input.quoteId };
}
function connected() { if (!firebaseReady || !cloudFunctions) fail("Event operations need a connected workspace.", "unavailable"); }
function key(input) { return JSON.stringify([input.principalId, input.organizationId, input.quoteId]); }
function publicError(error) {
  const code = text(error?.code).replace(/^functions\//u, "") || "unknown";
  const message = {
    "permission-denied": "Your current role cannot perform this event action.",
    unauthenticated: "Sign in again to continue event work.",
    "failed-precondition": "The event source or recorded phase changed. Refresh and review before continuing.",
    aborted: "The event changed during this request. Refresh and review before continuing.",
    "not-found": "This exact event source is unavailable. Return to Event Focus.",
    "invalid-argument": "This event request needs review before it can be submitted."
  }[code] || "The event result could not be confirmed. Check the same request before making another change.";
  return Object.assign(new Error(message), { code });
}
export function isDefinitiveEventOperatingError(error) { return error?.uncertain !== true && DEFINITIVE.has(text(error?.code).replace(/^functions\//u, "")); }
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((name) => !keys.includes(name))) fail("Unexpected event evidence fields.");
}
function normalizeReceipt(value) {
  exactKeys(value, ["receiptId", "requestId", "priorRevision", "resultRevision", "priorPhase", "resultPhase", "recordedAtISO"]);
  if (!id(value.receiptId) || !id(value.requestId) || !Number.isSafeInteger(value.priorRevision) || value.priorRevision < 0 || value.resultRevision !== value.priorRevision + 1 || !PHASES.includes(value.resultPhase) || value.priorPhase !== (value.resultPhase === "prepared" ? null : PHASES[PHASES.indexOf(value.resultPhase) - 1]) || !Number.isFinite(Date.parse(value.recordedAtISO))) fail("The event receipt could not be verified.");
  return Object.freeze({ ...value });
}
function snapshot(value, requested) {
  exactKeys(value, ["workflowKind", "organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId", "ledgerId", "schemaVersion", "policyVersion", "templateVersion", "policyDigest", "evidenceBoundary", "historyCoverage", "availability", "revision", "phase", "lastReceiptId", "updatedAtISO", "latestReceipt"]);
  if (value.organizationId !== requested.organizationId || value.quoteId !== requested.quoteId || !["available", "not_yet_available"].includes(value.availability) || !id(value.sourceVersionId) || !id(value.acceptanceReceiptId) || !id(value.ledgerId)) fail("The exact accepted event source could not be verified.");
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || value.workflowKind !== "event_execution" || value.schemaVersion !== 1 || value.policyVersion !== 1 || value.templateVersion !== 1 || !/^[a-f0-9]{64}$/u.test(value.policyDigest) || value.historyCoverage !== "latest_receipt_only" || typeof value.evidenceBoundary !== "string" || value.evidenceBoundary.length > 2000) fail("The event revision could not be verified.");
  if (value.availability === "not_yet_available") {
    if (value.revision !== 0 || value.phase !== null || value.lastReceiptId !== "" || value.updatedAtISO !== "" || value.latestReceipt !== null) fail("The absent event state could not be verified.");
    return Object.freeze({ ...value });
  }
  if (!id(value.lastReceiptId) || !PHASES.includes(value.phase) || value.revision < 1 || !Number.isFinite(Date.parse(value.updatedAtISO))) fail("The recorded event phase could not be verified.");
  const latestReceipt = normalizeReceipt(value.latestReceipt);
  if (latestReceipt.receiptId !== value.lastReceiptId || latestReceipt.resultPhase !== value.phase || latestReceipt.resultRevision !== value.revision || latestReceipt.recordedAtISO !== value.updatedAtISO) fail("The latest receipt does not establish this event snapshot.");
  return Object.freeze({ ...value, latestReceipt });
}
function envelope(value, requested, mutation = false) {
  exactKeys(value, mutation ? ["ok", "storage", "organizationId", "quoteId", "snapshot", "receipt", "idempotent"] : ["ok", "storage", "organizationId", "quoteId", "snapshot"]);
  if (value?.ok !== true || value.storage !== "firebase" || value.organizationId !== requested.organizationId || value.quoteId !== requested.quoteId) fail("Event evidence belongs to a different workspace or event.");
  return { ...value, snapshot: snapshot(value.snapshot, requested) };
}
export async function getEventOperatingSnapshot(input) {
  connected();
  const requested = scope(input);
  try { return Object.freeze(envelope((await httpsCallable(cloudFunctions, EVENT_OPERATING_CALLABLES.read)(requested)).data, requested)); }
  catch (error) { throw publicError(error); }
}
export function readPendingEventOperatingCommand(input) { const value = pending.get(key(input)); return value ? structuredClone(value) : null; }
export function resetDefinitiveEventOperatingCommand(input) {
  const found = pending.get(key(input));
  if (!found?.definitive) return false;
  if (!releaseEventOperatingMutation(input, "phase", found.command.requestId, { reviewedReset: true })) return false;
  pending.delete(key(input));
  return true;
}
export function createEventOperatingRequestId() { return `eo_${globalThis.crypto.randomUUID()}`; }
async function performEventOperatingCommand(input) {
  connected();
  const requested = scope(input);
  if (!id(input.principalId)) fail("An exact signed-in operator is required.", "invalid-argument");
  const command = { ...requested, sourceVersionId: input.sourceVersionId, acceptanceReceiptId: input.acceptanceReceiptId, requestId: input.requestId, command: input.command, expectedLedgerRevision: input.expectedLedgerRevision, targetPhase: input.targetPhase };
  if (!id(command.sourceVersionId) || !id(command.acceptanceReceiptId) || !id(command.requestId) || !["initialize", "transition"].includes(command.command) || !Number.isSafeInteger(command.expectedLedgerRevision) || command.expectedLedgerRevision < 0 || !PHASES.includes(command.targetPhase) || (command.command === "initialize" && (command.expectedLedgerRevision !== 0 || command.targetPhase !== "prepared"))) fail("This event command is incomplete.", "invalid-argument");
  const pendingKey = key(input);
  const retained = pending.get(pendingKey);
  if (retained && JSON.stringify(retained.command) !== JSON.stringify(command)) fail("Check the original event request before changing its details.", "failed-precondition");
  if (!retained && pending.size >= 25) fail("Check an unresolved event request before starting another.", "resource-exhausted");
  beginEventOperatingMutation(input, "phase", command);
  pending.set(pendingKey, { command, definitive: false });
  try {
    const value = envelope((await httpsCallable(cloudFunctions, EVENT_OPERATING_CALLABLES.command)(command)).data, requested, true);
    const commandReceipt = normalizeReceipt(value.receipt);
    const receiptMatchesSnapshot = JSON.stringify(commandReceipt) === JSON.stringify(value.snapshot.latestReceipt);
    const receipt = commandReceipt;
    if (!receiptMatchesSnapshot || value.snapshot.sourceVersionId !== command.sourceVersionId || value.snapshot.acceptanceReceiptId !== command.acceptanceReceiptId || value.snapshot.availability !== "available" || value.snapshot.phase !== command.targetPhase || value.snapshot.revision !== command.expectedLedgerRevision + 1 || typeof value.idempotent !== "boolean" || !receipt || !id(receipt.receiptId) || receipt.receiptId !== value.snapshot.lastReceiptId || receipt.requestId !== command.requestId || receipt.priorRevision !== command.expectedLedgerRevision || receipt.resultRevision !== value.snapshot.revision || receipt.resultPhase !== command.targetPhase || receipt.priorPhase !== (command.command === "initialize" ? null : PHASES[PHASES.indexOf(command.targetPhase) - 1]) || !Number.isFinite(Date.parse(receipt.recordedAtISO))) fail("The event receipt does not match the submitted request.");
    releaseEventOperatingMutation(input, "phase", command.requestId);
    pending.delete(pendingKey);
    return Object.freeze({ ...value, receipt: Object.freeze({ ...receipt }) });
  } catch (error) {
    const safe = publicError(error);
    pending.set(pendingKey, { command, definitive: retained && !retained.definitive ? false : isDefinitiveEventOperatingError(safe) });
    const guard = failEventOperatingMutation(input, "phase", command.requestId, pending.get(pendingKey).definitive);
    if (guard?.status === "uncertain") { safe.uncertain = true; pending.get(pendingKey).definitive = false; }
    throw safe;
  }
}

const activePhaseRequests = new Map();
export function applyEventOperatingCommand(input) {
  const scopeKey = key(input);
  const canonical = Object.fromEntries(Object.keys(input).sort().map((field) => [field, field === "note" && typeof input[field] === "string" ? input[field].trim() : input[field]]));
  const fingerprint = JSON.stringify(canonical);
  const active = activePhaseRequests.get(scopeKey);
  if (active) {
    if (active.fingerprint === fingerprint) return active.promise;
    return Promise.reject(Object.assign(new Error("The original event request is still running. Keep its details unchanged."), { code: "event-mutation-blocked" }));
  }
  const promise = performEventOperatingCommand(input);
  activePhaseRequests.set(scopeKey, { fingerprint, promise });
  const clear = () => { if (activePhaseRequests.get(scopeKey)?.promise === promise) activePhaseRequests.delete(scopeKey); };
  void promise.then(clear, clear);
  return promise;
}
