import { httpsCallable } from "firebase/functions";
import { auth, cloudFunctions, firebaseReady } from "./firebase";

export const EVENT_SUPPLY_ACTION_PLAN_SCHEMA_VERSION = 1;
export const EVENT_SUPPLY_ACTION_PLAN_CALLABLES = Object.freeze({
  get: "getEventSupplyActionPlan",
  apply: "applyEventSupplyActionPlanCommand"
});

const ROLES = new Set(["admin", "sales"]);
const COMMANDS = new Set(["save_draft", "approve", "rebase", "cancel"]);
const ID = /^[^\s/?#\\\u0000]{1,180}$/u;
const REQUEST_ID = /^supply_plan_request_[a-f0-9]{32}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REVISION_ID = /^esapr_[a-f0-9]{48}$/u;
const RECEIPT_ID = /^esaprc_[a-f0-9]{48}$/u;

function error(code, message) { const value = new Error(message); value.code = code; return value; }
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function exact(value, keys, label, code = "invalid-argument") {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw error(code, `${label} contains missing or unsupported fields.`);
  }
}
function id(value, label, code = "invalid-argument") {
  if (typeof value !== "string" || value !== value.trim() || !ID.test(value) || [".", "..", "__proto__", "prototype", "constructor"].includes(value.toLowerCase())) {
    throw error(code, `${label} must be an exact opaque identifier.`);
  }
  return value;
}
function text(value, label, maximum, { allowEmpty = false, code = "invalid-argument" } = {}) {
  if (typeof value !== "string" || value !== value.trim()) throw error(code, `${label} must be exact text.`);
  const normalized = value.replace(/\s+/gu, " ");
  if ((!allowEmpty && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f<>]/u.test(normalized)) throw error(code, `${label} must be bounded safe text.`);
  return normalized;
}
function revision(value, label, { allowZero = true, code = "invalid-argument" } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1_000_000_000) throw error(code, `${label} must be a bounded revision.`);
  return value;
}
function sha(value, label, code = "invalid-argument") {
  if (typeof value !== "string" || !SHA256.test(value)) throw error(code, `${label} must be an exact SHA-256 fingerprint.`);
  return value;
}
function iso(value, label, code = "data-loss") {
  const parsed = new Date(value);
  if (typeof value !== "string" || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw error(code, `${label} must be an exact ISO timestamp.`);
  return value;
}
function quantity(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value) || value === "0") throw error("invalid-argument", `${label} must be a positive canonical quantity.`);
  return value;
}
function access(input, mutation) {
  if (!firebaseReady || !auth?.currentUser || !cloudFunctions) throw error("failed-precondition", "Supply plan authority is unavailable.");
  const organizationId = id(input.organizationId, "organizationId");
  const role = typeof input.role === "string" ? input.role.trim().toLowerCase() : "";
  if (!ROLES.has(role) || (mutation && role !== "admin")) throw error("permission-denied", mutation ? "Supply plan changes require administrator access." : "Supply plan reads require staff access.");
  return { organizationId, quoteId: id(input.quoteId, "quoteId") };
}

export function buildEventSupplyActionPlanRequestId(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider?.getRandomValues !== "function") throw error("failed-precondition", "Secure supply-plan request identity generation is unavailable.");
  const bytes = new Uint8Array(16);
  cryptoProvider.getRandomValues(bytes);
  return `supply_plan_request_${[...bytes].map((entry) => entry.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeEdit(value, index) {
  exact(value, [
    "ingredientId", "locationId", "baseUnitId", "shortageQuantity", "supplierId", "supplierLabel",
    "purchaseQuantity", "estimatedCostMinor", "currency", "note", "conditions",
    "policyFingerprint", "offerFingerprint"
  ], `Supply plan edit ${index + 1}`);
  if ((value.estimatedCostMinor === null) !== (value.currency === null)
    || (value.estimatedCostMinor !== null && (!Number.isSafeInteger(value.estimatedCostMinor) || value.estimatedCostMinor < 0))
    || (value.currency !== null && !/^[A-Z]{3}$/u.test(value.currency))) throw error("invalid-argument", `Supply plan edit ${index + 1} cost is invalid.`);
  if (!Array.isArray(value.conditions) || value.conditions.length > 10) throw error("invalid-argument", `Supply plan edit ${index + 1} conditions are invalid.`);
  return {
    ingredientId: id(value.ingredientId, "ingredientId"),
    locationId: id(value.locationId, "locationId"),
    baseUnitId: id(value.baseUnitId, "baseUnitId"),
    shortageQuantity: quantity(value.shortageQuantity, "shortageQuantity"),
    supplierId: id(value.supplierId, "supplierId"),
    supplierLabel: text(value.supplierLabel, "supplierLabel", 120),
    purchaseQuantity: quantity(value.purchaseQuantity, "purchaseQuantity"),
    estimatedCostMinor: value.estimatedCostMinor,
    currency: value.currency,
    note: text(value.note, "note", 500, { allowEmpty: true }),
    conditions: value.conditions.map((entry) => text(entry, "condition", 180)),
    policyFingerprint: sha(value.policyFingerprint, "policyFingerprint"),
    offerFingerprint: sha(value.offerFingerprint, "offerFingerprint")
  };
}
function normalizeCommand(value, quoteId) {
  if (!isRecord(value) || !COMMANDS.has(value.kind)) throw error("invalid-argument", "Supply plan command is unsupported.");
  if (value.quoteId !== quoteId) throw error("invalid-argument", "Supply plan command quote scope differs from the requested quote.");
  if (value.kind === "cancel") {
    exact(value, ["kind", "quoteId", "expectedPlanRevision", "reason"], "Supply plan cancel command");
    return { kind: value.kind, quoteId, expectedPlanRevision: revision(value.expectedPlanRevision, "expectedPlanRevision"), reason: text(value.reason, "reason", 240) };
  }
  const common = ["kind", "quoteId", "expectedPlanRevision", "expectedAllocationFingerprint", "expectedShortageFingerprint", "expectedSourceFingerprint"];
  exact(value, value.kind === "approve" ? [...common, "confirmation"] : [...common, "edits"], "Supply plan command");
  const result = {
    kind: value.kind,
    quoteId,
    expectedPlanRevision: revision(value.expectedPlanRevision, "expectedPlanRevision"),
    expectedAllocationFingerprint: sha(value.expectedAllocationFingerprint, "expectedAllocationFingerprint"),
    expectedShortageFingerprint: sha(value.expectedShortageFingerprint, "expectedShortageFingerprint"),
    expectedSourceFingerprint: sha(value.expectedSourceFingerprint, "expectedSourceFingerprint")
  };
  if (value.kind === "approve") {
    if (value.confirmation !== "approve_internal_supply_plan") throw error("invalid-argument", "Supply plan approval requires explicit confirmation.");
    result.confirmation = value.confirmation;
  } else {
    if (!Array.isArray(value.edits) || value.edits.length > 100) throw error("invalid-argument", "Supply plan edits exceed the bounded contract.");
    result.edits = value.edits.map(normalizeEdit);
  }
  return result;
}

function normalizeSource(value, organizationId, quoteId) {
  exact(value, [
    "eventPlanId", "planRevisionId", "allocationRevision", "eventRequirementRevisionId",
    "allocationFingerprint", "shortageFingerprint", "requirementFingerprint",
    "eventProjectionFingerprint", "quoteRevisionFingerprint", "recipeFingerprint",
    "stockFingerprint", "fenceFingerprint", "supportingEvidenceFingerprint", "eligible",
    "ineligibilityReasons", "sourceFingerprint", "shortages"
  ], "Supply plan source", "data-loss");
  if (!Array.isArray(value.shortages) || !Array.isArray(value.ineligibilityReasons)
    || value.ineligibilityReasons.some((entry) => typeof entry !== "string" || !entry)
    || typeof value.eligible !== "boolean"
    || value.eligible !== (value.ineligibilityReasons.length === 0)) {
    throw error("data-loss", "Supply plan source eligibility evidence is invalid.");
  }
  return Object.freeze({
    ...value,
    eventPlanId: id(value.eventPlanId, "eventPlanId", "data-loss"),
    planRevisionId: id(value.planRevisionId, "planRevisionId", "data-loss"),
    allocationRevision: revision(value.allocationRevision, "allocationRevision", { allowZero: false, code: "data-loss" }),
    eventRequirementRevisionId: id(value.eventRequirementRevisionId, "eventRequirementRevisionId", "data-loss"),
    allocationFingerprint: sha(value.allocationFingerprint, "allocationFingerprint", "data-loss"),
    shortageFingerprint: sha(value.shortageFingerprint, "shortageFingerprint", "data-loss"),
    requirementFingerprint: sha(value.requirementFingerprint, "requirementFingerprint", "data-loss"),
    eventProjectionFingerprint: sha(value.eventProjectionFingerprint, "eventProjectionFingerprint", "data-loss"),
    quoteRevisionFingerprint: sha(value.quoteRevisionFingerprint, "quoteRevisionFingerprint", "data-loss"),
    recipeFingerprint: sha(value.recipeFingerprint, "recipeFingerprint", "data-loss"),
    stockFingerprint: sha(value.stockFingerprint, "stockFingerprint", "data-loss"),
    fenceFingerprint: sha(value.fenceFingerprint, "fenceFingerprint", "data-loss"),
    supportingEvidenceFingerprint: sha(value.supportingEvidenceFingerprint, "supportingEvidenceFingerprint", "data-loss"),
    sourceFingerprint: sha(value.sourceFingerprint, "sourceFingerprint", "data-loss"),
    shortages: value.shortages.map((row) => {
      exact(row, ["ingredientId", "locationId", "baseUnitId", "shortageQuantity", "shortageQuantityMicros"], "Supply shortage", "data-loss");
      return { ...row };
    }),
    organizationId,
    quoteId
  });
}

function normalizePlan(value, organizationId, quoteId, source) {
  if (value === null) return null;
  exact(value, [
    "authorityVersion", "schemaVersion", "organizationId", "quoteId", "planId", "revisionId",
    "planRevision", "status", "resolution", "source", "edits", "approvalEvidence", "cancelEvidence",
    "boundary", "createdAtISO", "updatedAtISO", "updatedBy", "revisionDigest"
  ], "Supply plan", "data-loss");
  if (value.authorityVersion !== "event-supply-action-plan-v1" || value.schemaVersion !== 1
    || value.organizationId !== organizationId || value.quoteId !== quoteId
    || !REVISION_ID.test(value.revisionId) || !["draft", "approved", "cancelled"].includes(value.status)
    || !["unresolved", "resolved"].includes(value.resolution) || !Array.isArray(value.edits)
    || typeof value.boundary !== "string" || !value.boundary.includes("does not contact a vendor")
    || !SHA256.test(value.revisionDigest)) throw error("data-loss", "Supply plan evidence is invalid.");
  revision(value.planRevision, "planRevision", { allowZero: false, code: "data-loss" });
  iso(value.createdAtISO, "createdAtISO");
  iso(value.updatedAtISO, "updatedAtISO");
  const normalizedSource = normalizeSource(value.source, organizationId, quoteId);
  value.edits.forEach((entry, index) => normalizeEdit(entry, index));
  return Object.freeze({ ...value, source: normalizedSource });
}

export async function getEventSupplyActionPlan(input = {}) {
  const scope = access(input, false);
  const call = httpsCallable(cloudFunctions, EVENT_SUPPLY_ACTION_PLAN_CALLABLES.get);
  const response = await call({ schemaVersion: 1, organizationId: scope.organizationId, quoteId: scope.quoteId });
  const value = response?.data;
  exact(value, ["ok", "schemaVersion", "appCheck", "organizationId", "quoteId", "source", "plan", "stale", "resolution"], "Supply plan response", "data-loss");
  if (value.ok !== true || value.schemaVersion !== 1 || value.organizationId !== scope.organizationId || value.quoteId !== scope.quoteId
    || !["verified", "monitoring"].includes(value.appCheck) || typeof value.stale !== "boolean"
    || !["not_started", "unresolved", "resolved", "stale"].includes(value.resolution)) throw error("data-loss", "Supply plan response crossed its authority boundary.");
  const source = normalizeSource(value.source, scope.organizationId, scope.quoteId);
  return Object.freeze({
    ...value,
    source,
    plan: normalizePlan(value.plan, scope.organizationId, scope.quoteId, source)
  });
}

export async function applyEventSupplyActionPlanCommand(input = {}) {
  const scope = access(input, true);
  const requestId = input.requestId || buildEventSupplyActionPlanRequestId();
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) throw error("invalid-argument", "requestId must be an exact cryptographic supply-plan request identifier.");
  const command = normalizeCommand(input.command, scope.quoteId);
  const call = httpsCallable(cloudFunctions, EVENT_SUPPLY_ACTION_PLAN_CALLABLES.apply);
  const response = await call({ schemaVersion: 1, organizationId: scope.organizationId, requestId, command });
  const value = response?.data;
  exact(value, ["ok", "schemaVersion", "appCheck", "organizationId", "quoteId", "commandKind", "planRevision", "revisionId", "status", "resolution", "sourceFingerprint", "idempotent", "receipt"], "Supply plan command response", "data-loss");
  exact(value.receipt, ["schemaVersion", "organizationId", "receiptId", "requestId", "commandKind", "recordedAtISO"], "Supply plan receipt", "data-loss");
  if (value.ok !== true || value.schemaVersion !== 1 || value.organizationId !== scope.organizationId || value.quoteId !== scope.quoteId
    || !["verified", "monitoring"].includes(value.appCheck) || value.commandKind !== command.kind
    || value.planRevision !== command.expectedPlanRevision + 1
    || !REVISION_ID.test(value.revisionId) || !["draft", "approved", "cancelled"].includes(value.status)
    || !["unresolved", "resolved"].includes(value.resolution) || !SHA256.test(value.sourceFingerprint)
    || typeof value.idempotent !== "boolean" || value.receipt.organizationId !== scope.organizationId
    || value.receipt.requestId !== requestId || value.receipt.commandKind !== command.kind
    || !RECEIPT_ID.test(value.receipt.receiptId)) throw error("data-loss", "Supply plan command result differs from the exact request.");
  iso(value.receipt.recordedAtISO, "receipt recordedAtISO");
  return Object.freeze(value);
}
