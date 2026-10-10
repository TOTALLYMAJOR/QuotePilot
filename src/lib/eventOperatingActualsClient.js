import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";
import { beginEventOperatingMutation, failEventOperatingMutation, releaseEventOperatingMutation } from "./eventOperatingMutationGuard";

export const EVENT_ACTUALS_CATEGORIES = Object.freeze(["labor", "purchasing", "other"]);
export const EVENT_ACTUALS_CALLABLES = Object.freeze({ read: "getEventOperatingActualsSnapshot", command: "applyEventOperatingActualsCommand" });
const ROLES = ["lead", "server", "chef", "bartender", "other"];
const COMMANDS = ["record", "correct", "void", "declare_category"];
const DEFINITIVE = new Set(["unauthenticated", "permission-denied", "invalid-argument", "failed-precondition", "not-found", "already-exists", "aborted", "resource-exhausted"]);
const attempts = new Map(), activeRequests = new Map();
const key = ({ principalId, organizationId, quoteId }) => JSON.stringify([principalId, organizationId, quoteId]);
const id = (value) => typeof value === "string" && /^[^\s/?#\\\u0000]{1,256}$/u.test(value) && ![".", ".."].includes(value);
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const plainText = (value, required = false) => typeof value === "string" && value.length <= 240 && (!required || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
function fail(message, code = "invalid-server-response", evidenceState = code === "invalid-server-response" ? "schema_drift" : undefined) { throw Object.assign(new Error(message), { code, ...(evidenceState ? { evidenceState } : {}) }); }
function contradiction(message) { fail(message, "invalid-server-response", "contradictory"); }
function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((field) => !fields.includes(field)) || fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) fail("The actuals evidence shape could not be verified.");
}
function scope(input) {
  if (!id(input.organizationId) || !id(input.quoteId)) fail("An exact workspace and event are required.", "invalid-argument");
  return { organizationId: input.organizationId, quoteId: input.quoteId };
}
function connected() { if (!firebaseReady || !cloudFunctions) fail("Recording actuals needs a connected workspace.", "unavailable"); }
export function isDefinitiveEventActualsError(error) { return error?.uncertain !== true && DEFINITIVE.has(String(error?.code || "").replace(/^functions\//u, "")); }
function safeError(error) {
  const code = String(error?.code || "unknown").replace(/^functions\//u, "");
  const message = {
    "permission-denied": "Your current role cannot record event actuals.",
    unauthenticated: "Sign in again to review event actuals.",
    "failed-precondition": "The accepted source or actuals journal changed. Refresh and review before continuing.",
    aborted: "Another operator changed these actuals. Refresh before trying again.",
    "not-found": "This exact event actuals source is unavailable.",
    "invalid-argument": "Review the actuals fields before submitting this request.",
    "resource-exhausted": "This event has reached its retained actuals limit. Existing active entries can still be corrected or voided."
  }[code] || "The actuals result could not be confirmed. Check the original request before making another event change.";
  return Object.assign(new Error(message), { code, ...(["schema_drift", "contradictory"].includes(error?.evidenceState) ? { evidenceState: error.evidenceState } : {}) });
}
function receipt(value) {
  exact(value, ["receiptId", "requestId", "command", "entryId", "category", "priorRevision", "resultRevision", "recordedAtISO"]);
  if (!id(value.receiptId) || !id(value.requestId) || !COMMANDS.includes(value.command) || !EVENT_ACTUALS_CATEGORIES.includes(value.category) || !integer(value.priorRevision) || value.resultRevision !== value.priorRevision + 1 || !iso(value.recordedAtISO) || (value.command === "declare_category" ? value.entryId !== "" : !id(value.entryId))) fail("The actuals receipt could not be verified.");
  return Object.freeze({ ...value });
}
function normalizeSnapshot(value, requested) {
  exact(value, ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId", "ledgerId", "workflowKind", "journalKind", "schemaVersion", "actualsPolicyVersion", "actualsPolicyDigest", "phasePolicyVersion", "phasePolicyDigest", "currency", "revision", "entries", "categories", "totals", "captureComplete", "latestReceipt", "lastReceiptId", "updatedAtISO", "historyCoverage", "evidenceBoundary", "availability", "reasonCode"]);
  if (value.organizationId !== requested.organizationId || value.quoteId !== requested.quoteId) contradiction("Actuals evidence belongs to another event.");
  if (value.organizationId !== requested.organizationId || value.quoteId !== requested.quoteId || !id(value.sourceVersionId) || !id(value.acceptanceReceiptId) || !id(value.ledgerId) || value.workflowKind !== "event_execution" || value.journalKind !== "event_actuals" || value.schemaVersion !== 1 || value.actualsPolicyVersion !== 1 || value.phasePolicyVersion !== 1 || !/^[a-f0-9]{64}$/u.test(value.actualsPolicyDigest) || !/^[a-f0-9]{64}$/u.test(value.phasePolicyDigest) || value.currency !== "USD" || !integer(value.revision) || value.historyCoverage !== "latest_receipt_only" || typeof value.evidenceBoundary !== "string" || value.evidenceBoundary.length > 2000) fail("Actuals evidence belongs to an unsupported source, currency, or policy.");
  if (!Array.isArray(value.entries) || value.entries.length > 50) fail("Actuals exceed the retained entry bound.");
  const entries = value.entries.map((entry) => {
    exact(entry, ["entryId", "category", "state", "description", "costCents", "laborRole", "durationMinutes", "createdAtISO", "updatedAtISO", "lastReceiptId"]);
    if (!id(entry.entryId) || !EVENT_ACTUALS_CATEGORIES.includes(entry.category) || !["active", "voided"].includes(entry.state) || !plainText(entry.description, true) || !integer(entry.costCents, 1_000_000_000) || !iso(entry.createdAtISO) || !iso(entry.updatedAtISO) || Date.parse(entry.createdAtISO) > Date.parse(entry.updatedAtISO) || !id(entry.lastReceiptId)) fail("An actuals entry could not be verified.");
    if (entry.category === "labor" ? (!ROLES.includes(entry.laborRole) || !integer(entry.durationMinutes, 10_080) || entry.durationMinutes < 1) : (entry.laborRole !== "" || entry.durationMinutes !== null)) fail("Actual labor fields do not match the entry category.");
    return Object.freeze({ ...entry });
  });
  if (new Set(entries.map((entry) => entry.entryId)).size !== entries.length) contradiction("Actuals contain duplicate entries.");
  exact(value.categories, EVENT_ACTUALS_CATEGORIES);
  const categories = Object.fromEntries(EVENT_ACTUALS_CATEGORIES.map((category) => {
    const item = value.categories[category]; exact(item, ["state", "note", "declaredAtISO", "lastDeclarationReceiptId"]);
    if (!["not_declared", "partial", "complete", "not_applicable"].includes(item.state) || !plainText(item.note)) fail("An actuals declaration is invalid.");
    const undeclared = item.note === "" && item.declaredAtISO === "" && item.lastDeclarationReceiptId === "";
    if (item.state === "not_declared" ? !undeclared : (undeclared ? item.state !== "partial" : (!plainText(item.note, true) || !iso(item.declaredAtISO) || !id(item.lastDeclarationReceiptId)))) fail("Actuals completeness lacks an explicit declaration.");
    if (item.state === "not_declared" && entries.some((entry) => entry.category === category)) contradiction("Retained actuals cannot have an undeclared category.");
    if (["complete", "not_applicable"].includes(item.state) && entries.some((entry) => entry.category === category && Date.parse(entry.updatedAtISO) > Date.parse(item.declaredAtISO))) contradiction("Actuals completeness predates its retained entries.");
    if (item.state === "not_applicable" && entries.some((entry) => entry.category === category && entry.state === "active")) contradiction("Not-applicable actuals contradict active entries.");
    return [category, Object.freeze({ ...item })];
  }));
  const captureComplete = EVENT_ACTUALS_CATEGORIES.every((category) => ["complete", "not_applicable"].includes(categories[category].state));
  if (typeof value.captureComplete !== "boolean") fail("Actuals completeness has an unsupported shape.");
  if (value.captureComplete !== captureComplete) contradiction("Actuals completeness does not match its declarations.");
  exact(value.totals, ["laborCostCents", "purchasingCostCents", "otherCostCents", "totalCostCents", "durationMinutes"]);
  const expected = { laborCostCents: 0, purchasingCostCents: 0, otherCostCents: 0, totalCostCents: 0, durationMinutes: 0 };
  for (const entry of entries.filter((item) => item.state === "active")) { expected[`${entry.category}CostCents`] += entry.costCents; expected.totalCostCents += entry.costCents; expected.durationMinutes += entry.durationMinutes || 0; }
  if (Object.keys(expected).some((field) => !integer(value.totals[field]))) fail("Captured actuals totals have an unsupported shape.");
  if (Object.keys(expected).some((field) => value.totals[field] !== expected[field])) contradiction("Captured actuals totals contradict their recorded entries.");
  let latestReceipt = null;
  if (value.availability === "not_yet_available") {
    if (!["phase_ledger_missing", "actuals_empty"].includes(value.reasonCode) || value.revision !== 0 || entries.length || captureComplete || EVENT_ACTUALS_CATEGORIES.some((category) => categories[category].state !== "not_declared") || value.latestReceipt !== null || value.lastReceiptId !== "" || value.updatedAtISO !== "") contradiction("Absent actuals contain contradictory recorded evidence.");
  } else if (value.availability === "available") {
    latestReceipt = receipt(value.latestReceipt);
    if (value.reasonCode !== "" || value.revision < 1 || value.lastReceiptId !== latestReceipt.receiptId || value.updatedAtISO !== latestReceipt.recordedAtISO || value.revision !== latestReceipt.resultRevision) contradiction("The latest actuals receipt does not establish this journal.");
    if (entries.some((entry) => Date.parse(entry.updatedAtISO) > Date.parse(value.updatedAtISO)) || Object.values(categories).some((item) => item.declaredAtISO && Date.parse(item.declaredAtISO) > Date.parse(value.updatedAtISO))) contradiction("Actuals evidence is newer than its journal snapshot.");
    if (latestReceipt.command === "declare_category") { const item = categories[latestReceipt.category]; if (item.lastDeclarationReceiptId !== latestReceipt.receiptId || item.declaredAtISO !== latestReceipt.recordedAtISO) contradiction("The latest actuals declaration is contradictory."); }
    else { const entry = entries.find((item) => item.entryId === latestReceipt.entryId); if (!entry || entry.category !== latestReceipt.category || entry.state !== (latestReceipt.command === "void" ? "voided" : "active") || entry.lastReceiptId !== latestReceipt.receiptId || entry.updatedAtISO !== latestReceipt.recordedAtISO || categories[entry.category].state !== "partial") contradiction("The latest actuals entry is contradictory."); }
  } else fail("Actuals availability is unsupported.");
  return Object.freeze({ ...value, entries: Object.freeze(entries), categories: Object.freeze(categories), totals: Object.freeze({ ...value.totals }), latestReceipt });
}
function envelope(value, requested, mutation = false) {
  exact(value, mutation ? ["ok", "storage", "organizationId", "quoteId", "snapshot", "receipt", "idempotent"] : ["ok", "storage", "organizationId", "quoteId", "snapshot"]);
  if (value.ok !== true || value.storage !== "firebase") fail("The actuals response could not be verified.");
  if (value.organizationId !== requested.organizationId || value.quoteId !== requested.quoteId) contradiction("The actuals response belongs to another event.");
  return { ...value, snapshot: normalizeSnapshot(value.snapshot, requested) };
}
export async function getEventOperatingActualsSnapshot(input) {
  connected(); const requested = scope(input);
  try { return Object.freeze(envelope((await httpsCallable(cloudFunctions, EVENT_ACTUALS_CALLABLES.read)(requested)).data, requested)); } catch (error) { throw safeError(error); }
}
export function createEventActualsRequestId() { return `ea_${crypto.randomUUID()}`; }
export function readPendingEventActualsCommand(input) { const found = attempts.get(key(input)); return found ? structuredClone(found) : null; }
export function resetDefinitiveEventActualsCommand(input) { const found = attempts.get(key(input)); if (!found?.definitive || !releaseEventOperatingMutation(input, "actuals", found.command.requestId, { reviewedReset: true })) return false; attempts.delete(key(input)); return true; }
async function performCommand(input) {
  connected(); const requested = scope(input);
  if (!id(input.principalId) || !id(input.sourceVersionId) || !id(input.acceptanceReceiptId) || !id(input.requestId) || input.actualsPolicyVersion !== 1 || !integer(input.expectedActualsRevision) || !COMMANDS.includes(input.command)) fail("An exact actuals request is required.", "invalid-argument");
  const command = { ...requested, sourceVersionId: input.sourceVersionId, acceptanceReceiptId: input.acceptanceReceiptId, requestId: input.requestId, actualsPolicyVersion: 1, expectedActualsRevision: input.expectedActualsRevision, command: input.command };
  const trim = (field) => typeof input[field] === "string" ? input[field].trim() : input[field];
  const typed = input.command === "void" ? ["entryId", "reason"] : input.command === "declare_category" ? ["category", "state", "note"] : ["category", "description", "costCents", ...(input.category === "labor" ? ["laborRole", "durationMinutes"] : []), ...(input.command === "correct" ? ["entryId", "reason"] : [])];
  if (Object.keys(input).some((field) => ![...Object.keys(command), "principalId", ...typed].includes(field)) || typed.some((field) => !Object.prototype.hasOwnProperty.call(input, field))) fail("This actuals request contains unsupported or missing fields.", "invalid-argument");
  for (const field of typed) command[field] = ["description", "reason", "note"].includes(field) ? trim(field) : input[field];
  if (command.command !== "void" && !EVENT_ACTUALS_CATEGORIES.includes(command.category)) fail("Choose a supported actuals category.", "invalid-argument");
  if (["record", "correct"].includes(command.command) && (!plainText(command.description, true) || !integer(command.costCents, 1_000_000_000) || (command.category === "labor" && (!ROLES.includes(command.laborRole) || !integer(command.durationMinutes, 10_080) || command.durationMinutes < 1)))) fail("Enter explicit recorded cost and valid labor details.", "invalid-argument");
  if (["correct", "void"].includes(command.command) && (!id(command.entryId) || !plainText(command.reason, true))) fail("An exact entry and correction reason are required.", "invalid-argument");
  if (command.command === "declare_category" && (!["partial", "complete", "not_applicable"].includes(command.state) || !plainText(command.note, true))) fail("An explicit completeness declaration and note are required.", "invalid-argument");
  const pendingKey = key(input), retained = attempts.get(pendingKey);
  if (retained && JSON.stringify(retained.command) !== JSON.stringify(command)) fail("Check the original actuals request without changing it.", "event-mutation-blocked");
  beginEventOperatingMutation(input, "actuals", command); attempts.set(pendingKey, { command, definitive: false });
  try {
    const value = envelope((await httpsCallable(cloudFunctions, EVENT_ACTUALS_CALLABLES.command)(command)).data, requested, true), commandReceipt = receipt(value.receipt);
    if (typeof value.idempotent !== "boolean" || value.snapshot.availability !== "available" || value.snapshot.sourceVersionId !== command.sourceVersionId || value.snapshot.acceptanceReceiptId !== command.acceptanceReceiptId || value.snapshot.revision !== command.expectedActualsRevision + 1 || commandReceipt.requestId !== command.requestId || commandReceipt.command !== command.command || commandReceipt.priorRevision !== command.expectedActualsRevision || commandReceipt.resultRevision !== value.snapshot.revision || JSON.stringify(commandReceipt) !== JSON.stringify(value.snapshot.latestReceipt) || (command.category && commandReceipt.category !== command.category) || (command.entryId && commandReceipt.entryId !== command.entryId)) fail("The actuals receipt does not match the submitted request.");
    if (command.command === "declare_category") { const item = value.snapshot.categories[command.category]; if (item.state !== command.state || item.note !== command.note) fail("The declared actuals state differs from the request."); }
    else if (command.command !== "void") { const entry = value.snapshot.entries.find((item) => item.entryId === commandReceipt.entryId); if (!entry || entry.category !== command.category || entry.description !== command.description || entry.costCents !== command.costCents || (entry.category === "labor" && (entry.laborRole !== command.laborRole || entry.durationMinutes !== command.durationMinutes))) fail("The recorded actuals differ from the request."); }
    releaseEventOperatingMutation(input, "actuals", command.requestId); attempts.delete(pendingKey);
    return Object.freeze({ ...value, receipt: commandReceipt });
  } catch (error) {
    const safe = safeError(error), definitive = retained && !retained.definitive ? false : isDefinitiveEventActualsError(safe);
    const held = failEventOperatingMutation(input, "actuals", command.requestId, definitive), isFinal = held?.status === "rejected";
    attempts.set(pendingKey, { command, definitive: isFinal }); if (!isFinal) safe.uncertain = true; throw safe;
  }
}
export function applyEventOperatingActualsCommand(input) {
  const scopeKey = key(input), fingerprint = JSON.stringify(Object.fromEntries(Object.keys(input).sort().map((field) => [field, ["description", "reason", "note"].includes(field) && typeof input[field] === "string" ? input[field].trim() : input[field]])));
  const current = activeRequests.get(scopeKey);
  if (current) return current.fingerprint === fingerprint ? current.promise : Promise.reject(Object.assign(new Error("The original actuals request is still running."), { code: "event-mutation-blocked" }));
  const promise = performCommand(input); activeRequests.set(scopeKey, { fingerprint, promise });
  const clear = () => { if (activeRequests.get(scopeKey)?.promise === promise) activeRequests.delete(scopeKey); }; void promise.then(clear, clear); return promise;
}
