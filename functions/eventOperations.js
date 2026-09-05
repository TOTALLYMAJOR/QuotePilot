"use strict";

const { createHash } = require("node:crypto");
const { resolvePostEventCloseoutSource } = require("./postEventCloseout");

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
const POLICY = deepFreeze({
  workflowKind: "event_execution",
  schemaVersion: 1,
  policyVersion: 1,
  templateVersion: 1,
  phases: ["prepared", "in_progress", "completed"],
  transitions: { prepared: "in_progress", in_progress: "completed" },
  evidenceBoundary: "Operator-recorded phase only; not readiness, actuals, payment, delivery, or closeout evidence."
});
class EventOperationsError extends Error {
  constructor(code, message) { super(message); this.name = "EventOperationsError"; this.code = code; }
}
function fail(code, message) { throw new EventOperationsError(code, message); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
const POLICY_DIGEST = digest(POLICY);
function id(value, label) {
  if (typeof value !== "string" || !/^[^\s/?#\\\u0000]{1,180}$/u.test(value) || [".", ".."].includes(value)) fail("invalid-argument", `${label} must be an exact identifier.`);
  return value;
}
function normalizeScope(value = {}) { return { organizationId: id(value.organizationId, "organizationId"), quoteId: id(value.quoteId, "quoteId") }; }
function normalizeRequest(value = {}) {
  const scope = normalizeScope(value);
  const request = { ...scope, sourceVersionId: id(value.sourceVersionId, "sourceVersionId"), acceptanceReceiptId: id(value.acceptanceReceiptId, "acceptanceReceiptId"), requestId: id(value.requestId, "requestId"), command: value.command, expectedLedgerRevision: value.expectedLedgerRevision, targetPhase: value.targetPhase };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/.test(request.requestId)) fail("invalid-argument", "requestId must be an opaque retry identity of 20 to 160 characters.");
  if (!["initialize", "transition"].includes(request.command) || !POLICY.phases.includes(request.targetPhase) || !Number.isSafeInteger(request.expectedLedgerRevision) || request.expectedLedgerRevision < 0 || request.expectedLedgerRevision >= Number.MAX_SAFE_INTEGER) fail("invalid-argument", "A supported command, target phase, and bounded expected revision are required.");
  if (request.command === "initialize" && (request.expectedLedgerRevision !== 0 || request.targetPhase !== "prepared")) fail("invalid-argument", "Initialization requires revision zero and prepared phase.");
  if (request.command === "transition" && request.expectedLedgerRevision === 0) fail("invalid-argument", "Transitions require an initialized ledger revision.");
  return request;
}
function normalizeActor(value, organizationId, mutation = false) {
  if (!value || value.organizationId !== organizationId || (value.principalOrganizationId && value.principalOrganizationId !== organizationId) || !(mutation ? ["admin"] : ["admin", "sales"]).includes(value.role)) fail("permission-denied", mutation ? "Same-organization administrator authority is required." : "Same-organization staff authority is required.");
  return { organizationId, uid: id(value.uid, "actor uid"), role: value.role };
}
function assertEnabled(globalEnabled, settings) {
  if (globalEnabled !== true || settings?.eventOperatingSpineEnabled !== true) fail("failed-precondition", "Event operations is not enabled for this environment and organization.");
}
function identity(value) { return { ...normalizeScope(value), sourceVersionId: id(value.sourceVersionId, "sourceVersionId"), acceptanceReceiptId: id(value.acceptanceReceiptId, "acceptanceReceiptId") }; }
function ledgerIdFor(value) { return `event_ops_${digest(identity(value)).slice(0, 48)}`; }
function receiptIdFor(value) { return `event_ops_command_${digest({ ledgerId: ledgerIdFor(value), requestId: id(value.requestId, "requestId") }).slice(0, 48)}`; }
function pinValid(value) { return value?.workflowKind === "event_execution" && value?.schemaVersion === 1 && value?.policyVersion === 1 && value?.templateVersion === 1 && value?.policyDigest === POLICY_DIGEST; }
function publicReceipt(value) {
  return { receiptId: value.receiptId, requestId: value.requestId, priorRevision: value.priorRevision, resultRevision: value.resultRevision, priorPhase: value.priorPhase, resultPhase: value.resultPhase, recordedAtISO: value.recordedAtISO };
}
function verifyReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") fail("data-loss", "The phase receipt is unavailable.");
  const { receiptDigest, ...body } = receipt;
  if (!pinValid(body) || receiptDigest !== digest(body) || !POLICY.phases.includes(body.resultPhase) || !Number.isSafeInteger(body.resultRevision) || body.resultRevision < 1) fail("data-loss", "The phase receipt failed integrity validation.");
  try {
    const request = normalizeRequest(body.request);
    const actor = normalizeActor(body.recordedBy, request.organizationId, true);
    const expectedPriorPhase = request.command === "initialize" ? null : Object.keys(POLICY.transitions).find((phase) => POLICY.transitions[phase] === request.targetPhase);
    if (body.commandDigest !== digest({ request, actor }) || body.receiptId !== receiptIdFor(request) || body.ledgerId !== ledgerIdFor(request) || body.requestId !== request.requestId || digest(identity(body)) !== digest(identity(request)) || body.priorRevision !== request.expectedLedgerRevision || body.resultRevision !== body.priorRevision + 1 || body.priorPhase !== expectedPriorPhase || body.resultPhase !== request.targetPhase || !Number.isFinite(Date.parse(body.recordedAtISO)) || new Date(body.recordedAtISO).toISOString() !== body.recordedAtISO) fail("data-loss", "The phase receipt command evidence is inconsistent.");
    const result = body.resultLedger;
    if (!pinValid(result) || digest(identity(result)) !== digest(identity(request)) || result.ledgerId !== body.ledgerId || result.lastReceiptId !== body.receiptId || result.revision !== body.resultRevision || result.phase !== body.resultPhase || result.updatedAtISO !== body.recordedAtISO || !Number.isFinite(Date.parse(result.createdAtISO)) || (request.command === "initialize" && result.createdAtISO !== body.recordedAtISO)) fail("data-loss", "The phase receipt result evidence is inconsistent.");
  } catch (error) {
    if (error instanceof EventOperationsError && error.code === "data-loss") throw error;
    fail("data-loss", "The phase receipt command evidence is invalid.");
  }
  return receipt;
}
function projectSnapshot(source, ledger = null, receipt = null) {
  const refs = identity(source);
  const base = { ...refs, ledgerId: ledgerIdFor(source), workflowKind: "event_execution", schemaVersion: 1, policyVersion: 1, templateVersion: 1, policyDigest: POLICY_DIGEST, evidenceBoundary: POLICY.evidenceBoundary, historyCoverage: "latest_receipt_only" };
  if (!ledger) return { ...base, availability: "not_yet_available", revision: 0, phase: null, lastReceiptId: "", updatedAtISO: "", latestReceipt: null };
  if (!pinValid(ledger) || ledger.ledgerId !== base.ledgerId || digest(identity(ledger)) !== digest(refs) || !POLICY.phases.includes(ledger.phase) || !Number.isSafeInteger(ledger.revision) || ledger.revision < 1) fail("data-loss", "The phase ledger failed identity or policy validation.");
  const verified = verifyReceipt(receipt);
  if (verified.ledgerId !== ledger.ledgerId || verified.receiptId !== ledger.lastReceiptId || verified.resultRevision !== ledger.revision || verified.resultPhase !== ledger.phase || digest(verified.resultLedger) !== digest(ledger)) fail("data-loss", "The latest phase receipt does not match the ledger.");
  return { ...base, availability: "available", revision: ledger.revision, phase: ledger.phase, lastReceiptId: ledger.lastReceiptId, updatedAtISO: ledger.updatedAtISO, latestReceipt: publicReceipt(verified) };
}
function planCommand({ request: input, actor, source, ledger = null, existingReceipt = null, nowISO }) {
  const request = normalizeRequest(input);
  const trustedActor = normalizeActor(actor, request.organizationId, true);
  const commandDigest = digest({ request, actor: trustedActor });
  const receiptId = receiptIdFor(request);
  if (existingReceipt) {
    const receipt = verifyReceipt(existingReceipt);
    if (receipt.receiptId !== receiptId || receipt.commandDigest !== commandDigest || receipt.ledgerId !== ledgerIdFor(request)) fail("already-exists", "This request identity belongs to a different immutable command.");
    return { idempotent: true, nextLedger: null, receipt, snapshot: projectSnapshot(request, receipt.resultLedger, receipt) };
  }
  if (!source || digest(identity(source)) !== digest(identity(request))) fail("aborted", "The accepted source changed. Reload the event before trying again.");
  if (ledger && (!pinValid(ledger) || ledger.ledgerId !== ledgerIdFor(request) || digest(identity(ledger)) !== digest(identity(request)) || !Number.isSafeInteger(ledger.revision) || !POLICY.phases.includes(ledger.phase))) fail("data-loss", "The existing phase ledger is invalid.");
  const priorRevision = ledger?.revision || 0;
  const priorPhase = ledger?.phase || null;
  if (priorRevision !== request.expectedLedgerRevision) fail("aborted", "The event phase changed. Reload before trying again.");
  if (request.command === "initialize" ? Boolean(ledger) : (!ledger || POLICY.transitions[priorPhase] !== request.targetPhase)) fail("failed-precondition", "This event phase transition is not allowed.");
  if (typeof nowISO !== "string" || !/^\d{4}-\d\d-\d\dT/.test(nowISO) || !Number.isFinite(Date.parse(nowISO))) fail("failed-precondition", "Trusted server time is required.");
  const recordedAtISO = new Date(nowISO).toISOString();
  const nextLedger = { ...identity(request), ledgerId: ledgerIdFor(request), workflowKind: "event_execution", schemaVersion: 1, policyVersion: 1, templateVersion: 1, policyDigest: POLICY_DIGEST, revision: priorRevision + 1, phase: request.targetPhase, lastReceiptId: receiptId, createdAtISO: ledger?.createdAtISO || recordedAtISO, updatedAtISO: recordedAtISO };
  const body = { workflowKind: "event_execution", schemaVersion: 1, policyVersion: 1, templateVersion: 1, policyDigest: POLICY_DIGEST, ...identity(request), ledgerId: nextLedger.ledgerId, receiptId, requestId: request.requestId, commandDigest, request, recordedBy: trustedActor, recordedAtISO, priorRevision, resultRevision: nextLedger.revision, priorPhase, resultPhase: nextLedger.phase, resultLedger: nextLedger };
  const receipt = { ...body, receiptDigest: digest(body) };
  return { idempotent: false, nextLedger, receipt, snapshot: projectSnapshot(source, nextLedger, receipt) };
}
module.exports = { EventOperationsError, POLICY, POLICY_DIGEST, assertEnabled, normalizeScope, normalizeRequest, normalizeActor, ledgerIdFor, receiptIdFor, projectSnapshot, publicReceipt, planCommand, resolveSource: resolvePostEventCloseoutSource };
