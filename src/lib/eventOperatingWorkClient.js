import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";
import { beginEventOperatingMutation, failEventOperatingMutation, releaseEventOperatingMutation } from "./eventOperatingMutationGuard";

export const EVENT_WORK_CHECKPOINTS = Object.freeze(["venue_access", "team_briefing", "service_handoff", "pack_down"]);
export const EVENT_WORK_CALLABLES = Object.freeze({ read: "getEventOperatingWorkSnapshot", command: "applyEventOperatingWorkCommand" });
const COMMANDS = ["checkpoint_record", "checkpoint_reopen", "issue_open", "issue_resolve", "issue_reopen"];
const DEFINITIVE = new Set(["unauthenticated", "permission-denied", "invalid-argument", "failed-precondition", "not-found", "already-exists", "aborted", "resource-exhausted"]);
const attempts = new Map();
const key = (scope) => JSON.stringify([scope.principalId, scope.organizationId, scope.quoteId]);
const id = (value) => typeof value === "string" && /^[^\s/?#\\\u0000]{1,256}$/u.test(value) && ![".", ".."].includes(value);
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
function fail(message, code = "invalid-server-response") { throw Object.assign(new Error(message), { code }); }
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((name) => !keys.includes(name)) || keys.some((name) => !Object.prototype.hasOwnProperty.call(value, name))) fail("The event work evidence shape could not be verified.");
}
function note(value, required = false) { return typeof value === "string" && value.length <= 240 && (!required || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value); }
function scope(input) {
  if (!id(input.organizationId) || !id(input.quoteId)) fail("An exact workspace and event are required.", "invalid-argument");
  return { organizationId: input.organizationId, quoteId: input.quoteId };
}
function connected() { if (!firebaseReady || !cloudFunctions) fail("Event work needs a connected workspace.", "unavailable"); }
export function isDefinitiveEventWorkError(error) { return error?.uncertain !== true && DEFINITIVE.has(String(error?.code || "").replace(/^functions\//u, "")); }
function safeError(error) {
  const code = String(error?.code || "unknown").replace(/^functions\//u, "");
  const message = {
    "permission-denied": "Your current role cannot change event checkpoints or issues.",
    unauthenticated: "Sign in again to continue event work.",
    "failed-precondition": "The event source or work journal changed. Refresh and review before continuing.",
    aborted: "Another operator changed the event work. Refresh and review before continuing.",
    "not-found": "This exact event work source is unavailable.",
    "invalid-argument": "Review this checkpoint or issue request before submitting it.",
    "resource-exhausted": "This event has reached the bounded journal limit. Existing issues can still be reviewed."
  }[code] || "The result could not be confirmed. Check the original request before changing event work.";
  return Object.assign(new Error(message), { code });
}
function normalizeReceipt(value) {
  exact(value, ["receiptId", "requestId", "command", "checkpointCode", "issueId", "priorRevision", "resultRevision", "priorState", "resultState", "recordedAtISO"]);
  if (!id(value.receiptId) || !id(value.requestId) || !COMMANDS.includes(value.command) || !integer(value.priorRevision) || value.resultRevision !== value.priorRevision + 1 || !iso(value.recordedAtISO)) fail("The event work receipt could not be verified.");
  const checkpoint = value.command.startsWith("checkpoint_");
  if (checkpoint ? (!EVENT_WORK_CHECKPOINTS.includes(value.checkpointCode) || value.issueId !== "") : (value.checkpointCode !== "" || !id(value.issueId))) fail("The work receipt target is invalid.");
  const allowedPrior = { checkpoint_record: ["not_recorded", "reopened"], checkpoint_reopen: ["recorded"], issue_open: [null], issue_resolve: ["open"], issue_reopen: ["resolved"] }[value.command];
  const next = { checkpoint_record: "recorded", checkpoint_reopen: "reopened", issue_open: "open", issue_resolve: "resolved", issue_reopen: "open" }[value.command];
  if (!allowedPrior.includes(value.priorState) || value.resultState !== next) fail("The work receipt transition is invalid.");
  return Object.freeze({ ...value });
}
function normalizeSnapshot(value, requested) {
  exact(value, ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId", "ledgerId", "workflowKind", "journalKind", "schemaVersion", "workPolicyVersion", "workPolicyDigest", "phasePolicyVersion", "phasePolicyDigest", "revision", "checkpoints", "issues", "lastReceiptId", "updatedAtISO", "latestReceipt", "historyCoverage", "evidenceBoundary", "availability", "reasonCode"]);
  if (value.organizationId !== requested.organizationId || value.quoteId !== requested.quoteId || !id(value.sourceVersionId) || !id(value.acceptanceReceiptId) || !id(value.ledgerId) || value.workflowKind !== "event_execution" || value.journalKind !== "event_work" || value.schemaVersion !== 1 || value.workPolicyVersion !== 1 || value.phasePolicyVersion !== 1 || !/^[a-f0-9]{64}$/u.test(value.workPolicyDigest) || !/^[a-f0-9]{64}$/u.test(value.phasePolicyDigest) || !integer(value.revision) || value.historyCoverage !== "latest_receipt_only" || typeof value.evidenceBoundary !== "string" || value.evidenceBoundary.length > 2000) fail("Event work belongs to an unsupported source or policy.");
  if (!Array.isArray(value.checkpoints) || value.checkpoints.length !== 4 || !Array.isArray(value.issues) || value.issues.length > 25) fail("The event work journal exceeds its bounded shape.");
  const checkpoints = value.checkpoints.map((item) => {
    exact(item, ["code", "state", "note", "updatedAtISO", "lastReceiptId"]);
    if (!EVENT_WORK_CHECKPOINTS.includes(item.code) || !["not_recorded", "recorded", "reopened"].includes(item.state) || !note(item.note, item.state === "reopened")) fail("Checkpoint evidence is invalid.");
    if (item.state === "not_recorded" ? (item.note !== "" || item.updatedAtISO !== "" || item.lastReceiptId !== "") : (!iso(item.updatedAtISO) || !id(item.lastReceiptId))) fail("Checkpoint provenance is invalid.");
    return Object.freeze({ ...item });
  });
  if (new Set(checkpoints.map((item) => item.code)).size !== 4) fail("Checkpoint evidence contains duplicates.");
  const issues = value.issues.map((item) => {
    exact(item, ["issueId", "state", "severity", "description", "latestNote", "createdAtISO", "updatedAtISO", "lastReceiptId"]);
    if (!id(item.issueId) || !["open", "resolved"].includes(item.state) || !["normal", "urgent"].includes(item.severity) || !note(item.description, true) || !note(item.latestNote, true) || !iso(item.createdAtISO) || !iso(item.updatedAtISO) || Date.parse(item.createdAtISO) > Date.parse(item.updatedAtISO) || !id(item.lastReceiptId)) fail("Issue evidence is invalid.");
    return Object.freeze({ ...item });
  });
  if (new Set(issues.map((item) => item.issueId)).size !== issues.length) fail("Issue evidence contains duplicates.");
  let latestReceipt = null;
  if (value.availability === "not_yet_available") {
    if (!["phase_ledger_missing", "journal_empty"].includes(value.reasonCode) || value.revision !== 0 || value.lastReceiptId !== "" || value.updatedAtISO !== "" || value.latestReceipt !== null || issues.length || checkpoints.some((item) => item.state !== "not_recorded")) fail("The absent journal has contradictory evidence.");
  } else if (value.availability === "available") {
    latestReceipt = normalizeReceipt(value.latestReceipt);
    if (value.reasonCode !== "" || value.revision < 1 || latestReceipt.receiptId !== value.lastReceiptId || latestReceipt.resultRevision !== value.revision || latestReceipt.recordedAtISO !== value.updatedAtISO) fail("The latest work receipt does not establish this journal.");
    if (checkpoints.some((item) => item.updatedAtISO && Date.parse(item.updatedAtISO) > Date.parse(value.updatedAtISO)) || issues.some((item) => Date.parse(item.updatedAtISO) > Date.parse(value.updatedAtISO))) fail("Work child evidence is newer than its journal snapshot.");
    const target = latestReceipt.checkpointCode ? checkpoints.find((item) => item.code === latestReceipt.checkpointCode) : issues.find((item) => item.issueId === latestReceipt.issueId);
    if (!target || target.state !== latestReceipt.resultState || target.lastReceiptId !== latestReceipt.receiptId || target.updatedAtISO !== latestReceipt.recordedAtISO) fail("The latest receipt contradicts its recorded target.");
  } else fail("Work journal availability is unsupported.");
  return Object.freeze({ ...value, checkpoints: Object.freeze(checkpoints), issues: Object.freeze(issues), latestReceipt });
}
function envelope(value, requested, mutation = false) {
  exact(value, mutation ? ["ok", "storage", "organizationId", "quoteId", "snapshot", "receipt", "idempotent"] : ["ok", "storage", "organizationId", "quoteId", "snapshot"]);
  if (value.ok !== true || value.storage !== "firebase" || value.organizationId !== requested.organizationId || value.quoteId !== requested.quoteId) fail("The work response belongs to a different event.");
  return { ...value, snapshot: normalizeSnapshot(value.snapshot, requested) };
}
export async function getEventOperatingWorkSnapshot(input) {
  connected(); const requested = scope(input);
  try { return Object.freeze(envelope((await httpsCallable(cloudFunctions, EVENT_WORK_CALLABLES.read)(requested)).data, requested)); }
  catch (error) { throw safeError(error); }
}
export function createEventWorkRequestId() { return `ew_${crypto.randomUUID()}`; }
export function readPendingEventWorkCommand(input) { const found = attempts.get(key(input)); return found ? structuredClone(found) : null; }
export function resetDefinitiveEventWorkCommand(input) {
  const found = attempts.get(key(input));
  if (!found?.definitive || !releaseEventOperatingMutation(input, "work", found.command.requestId, { reviewedReset: true })) return false;
  attempts.delete(key(input)); return true;
}
async function performEventOperatingWorkCommand(input) {
  connected(); const requested = scope(input);
  if (!id(input.principalId) || !id(input.sourceVersionId) || !id(input.acceptanceReceiptId) || !id(input.requestId) || input.workPolicyVersion !== 1 || !integer(input.expectedWorkRevision) || !COMMANDS.includes(input.command)) fail("An exact work request is required.", "invalid-argument");
  const checkpoint = input.command.startsWith("checkpoint_");
  const command = { ...requested, sourceVersionId: input.sourceVersionId, acceptanceReceiptId: input.acceptanceReceiptId, requestId: input.requestId, workPolicyVersion: 1, expectedWorkRevision: input.expectedWorkRevision, command: input.command, note: typeof input.note === "string" ? input.note.trim() : input.note ?? "" };
  const typedKeys = checkpoint ? ["checkpointCode"] : input.command === "issue_open" ? ["severity"] : ["issueId"];
  const allowed = [...Object.keys(command), "principalId", ...typedKeys];
  if (Object.keys(input).some((name) => !allowed.includes(name)) || !note(command.note, input.command !== "checkpoint_record")) fail("This work request contains invalid details.", "invalid-argument");
  if (checkpoint) { if (!EVENT_WORK_CHECKPOINTS.includes(input.checkpointCode)) fail("Choose a supported checkpoint.", "invalid-argument"); command.checkpointCode = input.checkpointCode; }
  else if (input.command === "issue_open") { if (!["normal", "urgent"].includes(input.severity)) fail("Choose an issue severity.", "invalid-argument"); command.severity = input.severity; }
  else { if (!id(input.issueId)) fail("An exact issue is required.", "invalid-argument"); command.issueId = input.issueId; }
  const pendingKey = key(input), retained = attempts.get(pendingKey);
  if (retained && JSON.stringify(retained.command) !== JSON.stringify(command)) fail("Check the original work request before changing its details.", "event-mutation-blocked");
  beginEventOperatingMutation(input, "work", command);
  attempts.set(pendingKey, { command, definitive: false });
  try {
    const value = envelope((await httpsCallable(cloudFunctions, EVENT_WORK_CALLABLES.command)(command)).data, requested, true);
    const receipt = normalizeReceipt(value.receipt);
    if (typeof value.idempotent !== "boolean" || value.snapshot.availability !== "available" || value.snapshot.sourceVersionId !== command.sourceVersionId || value.snapshot.acceptanceReceiptId !== command.acceptanceReceiptId || value.snapshot.revision !== command.expectedWorkRevision + 1 || receipt.requestId !== command.requestId || receipt.command !== command.command || receipt.priorRevision !== command.expectedWorkRevision || receipt.resultRevision !== value.snapshot.revision || JSON.stringify(receipt) !== JSON.stringify(value.snapshot.latestReceipt) || (checkpoint && receipt.checkpointCode !== command.checkpointCode) || (command.issueId && receipt.issueId !== command.issueId)) fail("The work receipt does not match the original request.");
    const target = checkpoint ? value.snapshot.checkpoints.find((item) => item.code === command.checkpointCode) : value.snapshot.issues.find((item) => item.issueId === receipt.issueId);
    if (!target || (checkpoint ? target.note !== command.note : target.latestNote !== command.note) || (command.command === "issue_open" && (target.description !== command.note || target.severity !== command.severity))) fail("The returned work record differs from the submitted details.");
    releaseEventOperatingMutation(input, "work", command.requestId); attempts.delete(pendingKey);
    return Object.freeze({ ...value, receipt });
  } catch (error) {
    const safe = safeError(error);
    const definitive = retained && !retained.definitive ? false : isDefinitiveEventWorkError(safe);
    const guard = failEventOperatingMutation(input, "work", command.requestId, definitive);
    const isFinal = guard?.status === "rejected";
    attempts.set(pendingKey, { command, definitive: isFinal });
    if (!isFinal) safe.uncertain = true;
    throw safe;
  }
}

const activeWorkRequests = new Map();
export function applyEventOperatingWorkCommand(input) {
  const scopeKey = key(input);
  const canonical = Object.fromEntries(Object.keys(input).sort().map((field) => [field, field === "note" && typeof input[field] === "string" ? input[field].trim() : input[field]]));
  const fingerprint = JSON.stringify(canonical);
  const active = activeWorkRequests.get(scopeKey);
  if (active) {
    if (active.fingerprint === fingerprint) return active.promise;
    return Promise.reject(Object.assign(new Error("The original event request is still running. Keep its details unchanged."), { code: "event-mutation-blocked" }));
  }
  const promise = performEventOperatingWorkCommand(input);
  activeWorkRequests.set(scopeKey, { fingerprint, promise });
  const clear = () => { if (activeWorkRequests.get(scopeKey)?.promise === promise) activeWorkRequests.delete(scopeKey); };
  void promise.then(clear, clear);
  return promise;
}
