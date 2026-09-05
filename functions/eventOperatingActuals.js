"use strict";

const { createHash } = require("node:crypto");
const phaseAuthority = require("./eventOperations");

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
const ACTUALS_POLICY = deepFreeze({
  workflowKind: "event_execution",
  journalKind: "event_actuals",
  schemaVersion: 1,
  actualsPolicyVersion: 1,
  phasePolicyVersion: 1,
  phasePolicyDigest: phaseAuthority.POLICY_DIGEST,
  currency: "USD",
  categories: ["labor", "purchasing", "other"],
  laborRoles: ["lead", "server", "chef", "bartender", "other"],
  maximumRetainedEntries: 50,
  maximumCostCents: 1_000_000_000,
  maximumDurationMinutes: 10_080,
  maximumTextCharacters: 240,
  evidenceBoundary: "Operator-declared costs and labor minutes recorded at server time; captured subtotals remain provisional until all categories are explicitly complete or not applicable. Not staffing attendance, payroll, payment, quantity consumption, or commercial pricing authority."
});
const IDENTITY_KEYS = ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"];
const PIN_KEYS = [
  "workflowKind", "journalKind", "schemaVersion", "actualsPolicyVersion", "actualsPolicyDigest",
  "phasePolicyVersion", "phasePolicyDigest", "currency"
];
const BASE_REQUEST_KEYS = [
  ...IDENTITY_KEYS, "requestId", "actualsPolicyVersion", "expectedActualsRevision", "command"
];
const STATE_KEYS = [
  ...IDENTITY_KEYS, ...PIN_KEYS, "ledgerId", "revision", "entries", "categories",
  "createdAtISO", "updatedAtISO", "lastReceiptId"
];
const ENTRY_KEYS = [
  "entryId", "category", "state", "description", "costCents", "laborRole", "durationMinutes",
  "createdAtISO", "updatedAtISO", "lastReceiptId"
];
const ENTRY_ID = /^event_actual_[a-f0-9]{32}$/;
const RECEIPT_ID = /^event_actuals_command_[a-f0-9]{48}$/;
const PHASE_RECEIPT_ID = /^event_ops_command_[a-f0-9]{48}$/;

function fail(code, message) {
  throw new phaseAuthority.EventOperationsError(code, message);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, expected, label) {
  if (!isRecord(value) || Object.keys(value).length !== expected.length
    || expected.some((key) => !Object.hasOwn(value, key))) {
    fail("invalid-argument", `${label} contains missing or unsupported fields.`);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
const ACTUALS_POLICY_DIGEST = digest(ACTUALS_POLICY);
function pin() {
  return {
    workflowKind: "event_execution", journalKind: "event_actuals", schemaVersion: 1,
    actualsPolicyVersion: 1, actualsPolicyDigest: ACTUALS_POLICY_DIGEST,
    phasePolicyVersion: 1, phasePolicyDigest: phaseAuthority.POLICY_DIGEST, currency: "USD"
  };
}
function assertPin(value) {
  const expected = pin();
  if (PIN_KEYS.some((key) => value?.[key] !== expected[key])) {
    fail("data-loss", "The operational actuals policy pin is invalid.");
  }
}
function identity(value) {
  phaseAuthority.ledgerIdFor(value);
  return Object.fromEntries(IDENTITY_KEYS.map((key) => [key, value[key]]));
}
function exactISO(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail("invalid-argument", "An exact server recording timestamp is required.");
  }
  return value;
}
function text(value) {
  if (typeof value !== "string" || value.length > ACTUALS_POLICY.maximumTextCharacters
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value) || !value.trim()) {
    fail("invalid-argument", "A nonblank plain-text description or reason of at most 240 characters is required.");
  }
  return value.trim();
}
function category(value) {
  if (!ACTUALS_POLICY.categories.includes(value)) fail("invalid-argument", "The actual cost category is unsupported.");
  return value;
}
function normalizeReadRequest(value) {
  exactKeys(value, ["organizationId", "quoteId"], "Actuals snapshot request");
  return phaseAuthority.normalizeScope(value);
}
function normalizeRequest(value) {
  if (!isRecord(value) || !["record", "correct", "void", "declare_category"].includes(value.command)) {
    fail("invalid-argument", "A supported operational actuals command is required.");
  }
  let commandKeys;
  if (["record", "correct"].includes(value.command)) {
    category(value.category);
    commandKeys = ["category", "description", "costCents"];
    if (value.category === "labor") commandKeys.push("durationMinutes", "laborRole");
    if (value.command === "correct") commandKeys.push("entryId", "reason");
  } else {
    commandKeys = value.command === "void" ? ["entryId", "reason"] : ["category", "state", "note"];
  }
  exactKeys(value, [...BASE_REQUEST_KEYS, ...commandKeys], "Actuals command");
  const refs = identity(value);
  if (value.actualsPolicyVersion !== 1
    || typeof value.requestId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/.test(value.requestId)
    || !Number.isSafeInteger(value.expectedActualsRevision)
    || value.expectedActualsRevision < 0 || value.expectedActualsRevision >= Number.MAX_SAFE_INTEGER) {
    fail("invalid-argument", "Exact actuals policy, opaque request identity, and bounded revision are required.");
  }
  const request = {
    ...refs, requestId: value.requestId, actualsPolicyVersion: 1,
    expectedActualsRevision: value.expectedActualsRevision, command: value.command
  };
  for (const key of commandKeys) request[key] = value[key];
  if (request.category) request.category = category(request.category);
  for (const key of ["description", "reason", "note"]) {
    if (Object.hasOwn(request, key)) request[key] = text(request[key]);
  }
  if (Object.hasOwn(request, "entryId")
    && (typeof request.entryId !== "string" || !ENTRY_ID.test(request.entryId))) {
    fail("invalid-argument", "An exact recorded actuals entry identifier is required.");
  }
  if (["record", "correct"].includes(request.command)) {
    if (!Number.isSafeInteger(request.costCents) || request.costCents < 0
      || request.costCents > ACTUALS_POLICY.maximumCostCents) {
      fail("invalid-argument", "Actual cost must be explicit integer USD cents within the supported bound.");
    }
    if (request.category === "labor"
      && (!Number.isSafeInteger(request.durationMinutes) || request.durationMinutes < 1
        || request.durationMinutes > ACTUALS_POLICY.maximumDurationMinutes
        || !ACTUALS_POLICY.laborRoles.includes(request.laborRole))) {
      fail("invalid-argument", "Labor requires bounded integer duration minutes and an operator-declared role.");
    }
  }
  if (request.command === "declare_category"
    && !["partial", "complete", "not_applicable"].includes(request.state)) {
    fail("invalid-argument", "The explicit category declaration is unsupported.");
  }
  return request;
}
function receiptIdFor(request) {
  return `event_actuals_command_${digest({ ledgerId: phaseAuthority.ledgerIdFor(request), requestId: request.requestId }).slice(0, 48)}`;
}
function entryIdFor(request) {
  return `event_actual_${digest({ ledgerId: phaseAuthority.ledgerIdFor(request), requestId: request.requestId }).slice(0, 32)}`;
}
function emptyDeclaration(state = "not_declared") {
  return { state, note: "", declaredAtISO: "", lastDeclarationReceiptId: "" };
}
function emptyState(source) {
  return {
    ...identity(source), ...pin(), ledgerId: phaseAuthority.ledgerIdFor(source), revision: 0,
    entries: [], categories: Object.fromEntries(ACTUALS_POLICY.categories.map((key) => [key, emptyDeclaration()])),
    createdAtISO: "", updatedAtISO: "", lastReceiptId: ""
  };
}
function validateState(value, source, allowEmpty = false) {
  exactKeys(value, STATE_KEYS, "Actuals state");
  assertPin(value);
  if (digest(identity(value)) !== digest(identity(source))
    || value.ledgerId !== phaseAuthority.ledgerIdFor(source)
    || !Number.isSafeInteger(value.revision) || value.revision < (allowEmpty ? 0 : 1)
    || !Array.isArray(value.entries) || value.entries.length > ACTUALS_POLICY.maximumRetainedEntries) {
    fail("data-loss", "The actuals identity, revision, or retained-entry bound is invalid.");
  }
  if (value.revision === 0) {
    if (digest(value) !== digest(emptyState(source))) fail("data-loss", "An empty actuals state contains fabricated evidence.");
    return value;
  }
  exactISO(value.createdAtISO);
  exactISO(value.updatedAtISO);
  if (value.createdAtISO > value.updatedAtISO || !RECEIPT_ID.test(value.lastReceiptId)) {
    fail("data-loss", "The actuals recording evidence is invalid.");
  }
  const ids = new Set();
  value.entries.forEach((entry) => {
    exactKeys(entry, ENTRY_KEYS, "Actuals entry");
    category(entry.category);
    if (typeof entry.entryId !== "string" || !ENTRY_ID.test(entry.entryId) || ids.has(entry.entryId)
      || !["active", "voided"].includes(entry.state)
      || entry.description !== text(entry.description)
      || !Number.isSafeInteger(entry.costCents) || entry.costCents < 0
      || entry.costCents > ACTUALS_POLICY.maximumCostCents
      || !RECEIPT_ID.test(entry.lastReceiptId)) {
      fail("data-loss", "A retained actuals entry is invalid.");
    }
    ids.add(entry.entryId);
    if (entry.category === "labor") {
      if (!ACTUALS_POLICY.laborRoles.includes(entry.laborRole)
        || !Number.isSafeInteger(entry.durationMinutes) || entry.durationMinutes < 1
        || entry.durationMinutes > ACTUALS_POLICY.maximumDurationMinutes) {
        fail("data-loss", "The declared labor units are invalid.");
      }
    } else if (entry.laborRole !== "" || entry.durationMinutes !== null) {
      fail("data-loss", "A nonlabor cost cannot claim labor units.");
    }
    exactISO(entry.createdAtISO);
    exactISO(entry.updatedAtISO);
    if (entry.createdAtISO < value.createdAtISO || entry.createdAtISO > entry.updatedAtISO
      || entry.updatedAtISO > value.updatedAtISO) {
      fail("data-loss", "Entry recording timestamps are inconsistent.");
    }
  });
  exactKeys(value.categories, ACTUALS_POLICY.categories, "Actuals categories");
  ACTUALS_POLICY.categories.forEach((key) => {
    const declaration = value.categories[key];
    exactKeys(declaration, ["state", "note", "declaredAtISO", "lastDeclarationReceiptId"], "Category declaration");
    if (!["not_declared", "partial", "complete", "not_applicable"].includes(declaration.state)) {
      fail("data-loss", "The category capture state is unsupported.");
    }
    const retainedEntries = value.entries.filter((entry) => entry.category === key);
    const activeEntries = retainedEntries.some((entry) => entry.state === "active");
    if ((declaration.state === "not_declared" && retainedEntries.length > 0)
      || (declaration.state === "not_applicable" && activeEntries)) {
      fail("data-loss", "Category capture evidence contradicts retained costs.");
    }
    if (declaration.state === "not_declared"
      || (declaration.state === "partial" && !declaration.declaredAtISO)) {
      if (declaration.note || declaration.declaredAtISO || declaration.lastDeclarationReceiptId) {
        fail("data-loss", "Undeclared capture cannot claim a completeness declaration.");
      }
    } else {
      if (text(declaration.note) !== declaration.note || !RECEIPT_ID.test(declaration.lastDeclarationReceiptId)) {
        fail("data-loss", "Category declaration note or receipt is invalid.");
      }
      exactISO(declaration.declaredAtISO);
      if (declaration.declaredAtISO < value.createdAtISO || declaration.declaredAtISO > value.updatedAtISO
        || (["complete", "not_applicable"].includes(declaration.state)
          && retainedEntries.some((entry) => entry.updatedAtISO > declaration.declaredAtISO))) {
        fail("data-loss", "Category declaration time is inconsistent with its retained entry evidence.");
      }
    }
  });
  return value;
}
function safeValidation(action) {
  try { return action(); } catch (error) {
    if (error.code === "data-loss") throw error;
    fail("data-loss", "Stored operational actuals evidence is malformed.");
  }
}
function capturedTotals(state) {
  const totals = { laborCostCents: 0, purchasingCostCents: 0, otherCostCents: 0, totalCostCents: 0, durationMinutes: 0 };
  state.entries.filter((entry) => entry.state === "active").forEach((entry) => {
    totals[`${entry.category}CostCents`] += entry.costCents;
    totals.totalCostCents += entry.costCents;
    if (entry.category === "labor") totals.durationMinutes += entry.durationMinutes;
  });
  if (Object.values(totals).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    fail("data-loss", "Captured actuals totals exceed exact integer bounds.");
  }
  return totals;
}
function reduceCommand(current, request, recordedAtISO) {
  const next = structuredClone(current);
  const receiptId = receiptIdFor(request);
  let affectedCategory = request.category || "";
  let entryId = "";
  if (request.command === "declare_category") {
    if (request.state === "not_applicable"
      && next.entries.some((entry) => entry.category === request.category && entry.state === "active")) {
      fail("failed-precondition", "A category with active entries cannot be declared not applicable.");
    }
    next.categories[request.category] = {
      state: request.state, note: request.note, declaredAtISO: recordedAtISO,
      lastDeclarationReceiptId: receiptId
    };
  } else {
    if (request.command === "record") {
      if (next.entries.length >= ACTUALS_POLICY.maximumRetainedEntries) {
        fail("resource-exhausted", "This event has reached its limit of 50 retained actuals entries.");
      }
      entryId = entryIdFor(request);
      if (next.entries.some((entry) => entry.entryId === entryId)) fail("already-exists", "The actuals entry identity is already retained.");
      next.entries.push({
        entryId, category: request.category, state: "active", description: request.description,
        costCents: request.costCents, laborRole: request.laborRole || "",
        durationMinutes: request.durationMinutes ?? null,
        createdAtISO: recordedAtISO, updatedAtISO: recordedAtISO, lastReceiptId: receiptId
      });
    } else {
      entryId = request.entryId;
      const entry = next.entries.find((item) => item.entryId === entryId);
      if (!entry) fail("not-found", "The exact actuals entry is unavailable.");
      if (entry.state !== "active") fail("failed-precondition", "A voided entry is terminal; record a new entry to replace it.");
      affectedCategory = entry.category;
      if (request.command === "correct") {
        if (request.category !== entry.category) fail("failed-precondition", "Correction cannot change the original cost category.");
        Object.assign(entry, {
          description: request.description, costCents: request.costCents,
          laborRole: request.laborRole || "", durationMinutes: request.durationMinutes ?? null
        });
      } else {
        entry.state = "voided";
      }
      Object.assign(entry, { updatedAtISO: recordedAtISO, lastReceiptId: receiptId });
    }
    next.categories[affectedCategory] = emptyDeclaration("partial");
  }
  Object.assign(next, {
    revision: current.revision + 1, createdAtISO: current.createdAtISO || recordedAtISO,
    updatedAtISO: recordedAtISO, lastReceiptId: receiptId
  });
  return { next, affectedCategory, entryId };
}
function publicReceipt(receipt) {
  return {
    receiptId: receipt.receiptId, requestId: receipt.requestId, command: receipt.request.command,
    entryId: receipt.entryId, category: receipt.category, priorRevision: receipt.priorRevision,
    resultRevision: receipt.resultRevision, recordedAtISO: receipt.recordedAtISO
  };
}
function verifyReceipt(value) {
  return safeValidation(() => {
    exactKeys(value, [
      ...IDENTITY_KEYS, ...PIN_KEYS, "ledgerId", "receiptId", "requestId", "request",
      "recordedBy", "recordedAtISO", "commandDigest", "receiptDigest", "priorRevision",
      "resultRevision", "entryId", "category", "observedPhaseRevision", "observedPhaseReceiptId",
      "priorActualsState", "resultActualsState"
    ], "Actuals receipt");
    const { receiptDigest, ...body } = value;
    assertPin(body);
    const request = normalizeRequest(body.request);
    exactKeys(body.recordedBy, ["organizationId", "uid", "role"], "Actuals actor");
    const actor = phaseAuthority.normalizeActor(body.recordedBy, request.organizationId, true);
    if (receiptDigest !== digest(body) || body.commandDigest !== digest({ request, actor })
      || body.receiptId !== receiptIdFor(request) || body.requestId !== request.requestId
      || body.ledgerId !== phaseAuthority.ledgerIdFor(request)
      || digest(identity(body)) !== digest(identity(request))
      || body.priorRevision !== request.expectedActualsRevision
      || body.resultRevision !== body.priorRevision + 1
      || !Number.isSafeInteger(body.observedPhaseRevision) || body.observedPhaseRevision < 1
      || !PHASE_RECEIPT_ID.test(body.observedPhaseReceiptId)) {
      fail("data-loss", "The actuals receipt failed command or integrity validation.");
    }
    exactISO(body.recordedAtISO);
    const previous = validateState(body.priorActualsState, request, true);
    const result = validateState(body.resultActualsState, request);
    if (previous.revision !== body.priorRevision || result.revision !== body.resultRevision
      || (previous.updatedAtISO && body.recordedAtISO < previous.updatedAtISO)) {
      fail("data-loss", "The actuals receipt revision or timestamp evidence is inconsistent.");
    }
    const planned = reduceCommand(previous, request, body.recordedAtISO);
    if (planned.affectedCategory !== body.category || planned.entryId !== body.entryId
      || digest(planned.next) !== digest(result)) {
      fail("data-loss", "The actuals receipt result does not match its exact recorded transition.");
    }
    return value;
  });
}
function projectSnapshot({ source, phaseInitialized = true, actualsState = null, receipt = null }) {
  let state = emptyState(source);
  let latestReceipt = null;
  if (actualsState) {
    if (!phaseInitialized) fail("data-loss", "Recorded actuals have no initialized phase ledger.");
    safeValidation(() => validateState(actualsState, source));
    const verified = verifyReceipt(receipt);
    if (digest(actualsState) !== digest(verified.resultActualsState)) {
      fail("data-loss", "The current actuals state does not match its latest immutable receipt.");
    }
    state = actualsState;
    latestReceipt = publicReceipt(verified);
  }
  return deepFreeze({
    ...identity(source), ...pin(), ledgerId: state.ledgerId,
    availability: actualsState ? "available" : "not_yet_available",
    reasonCode: actualsState ? "" : phaseInitialized ? "actuals_empty" : "phase_ledger_missing",
    revision: state.revision, entries: structuredClone(state.entries),
    categories: structuredClone(state.categories), totals: capturedTotals(state),
    captureComplete: ACTUALS_POLICY.categories.every((key) => ["complete", "not_applicable"].includes(state.categories[key].state)),
    latestReceipt, lastReceiptId: state.lastReceiptId, updatedAtISO: state.updatedAtISO,
    historyCoverage: "latest_receipt_only", evidenceBoundary: ACTUALS_POLICY.evidenceBoundary
  });
}
function planCommand({ request: input, actor, source, phaseSnapshot, actualsState = null, currentReceipt = null, existingReceipt = null, nowISO }) {
  const request = normalizeRequest(input);
  const trustedActor = phaseAuthority.normalizeActor(actor, request.organizationId, true);
  const commandDigest = digest({ request, actor: trustedActor });
  if (existingReceipt) {
    const receipt = verifyReceipt(existingReceipt);
    if (receipt.commandDigest !== commandDigest || receipt.receiptId !== receiptIdFor(request)) {
      fail("already-exists", "This actuals request identity belongs to a different immutable command.");
    }
    return {
      idempotent: true, nextActualsState: null, receipt,
      snapshot: projectSnapshot({ source: request, actualsState: receipt.resultActualsState, receipt })
    };
  }
  if (!source || digest(identity(source)) !== digest(identity(request))) {
    fail("aborted", "The accepted event source changed. Reload before recording actuals.");
  }
  if (!phaseSnapshot || phaseSnapshot.availability !== "available"
    || phaseSnapshot.ledgerId !== phaseAuthority.ledgerIdFor(request)
    || phaseSnapshot.workflowKind !== "event_execution" || phaseSnapshot.schemaVersion !== 1
    || phaseSnapshot.policyVersion !== 1 || phaseSnapshot.templateVersion !== 1
    || phaseSnapshot.policyDigest !== phaseAuthority.POLICY_DIGEST
    || !phaseAuthority.POLICY.phases.includes(phaseSnapshot.phase)
    || digest(identity(phaseSnapshot)) !== digest(identity(request))
    || !Number.isSafeInteger(phaseSnapshot.revision) || phaseSnapshot.revision < 1
    || !PHASE_RECEIPT_ID.test(phaseSnapshot.lastReceiptId)) {
    fail("failed-precondition", "Initialize a valid event phase ledger before recording actuals.");
  }
  if (actualsState) projectSnapshot({ source, actualsState, receipt: currentReceipt });
  const current = actualsState || emptyState(source);
  if (current.revision !== request.expectedActualsRevision) {
    fail("aborted", "The actuals journal changed. Reload before trying again.");
  }
  const recordedAtISO = exactISO(nowISO);
  if (current.updatedAtISO && recordedAtISO < current.updatedAtISO) {
    fail("failed-precondition", "Server recording time precedes existing actuals evidence.");
  }
  const planned = reduceCommand(current, request, recordedAtISO);
  const body = {
    ...identity(request), ...pin(), ledgerId: planned.next.ledgerId,
    receiptId: receiptIdFor(request), requestId: request.requestId, request,
    recordedBy: trustedActor, recordedAtISO, commandDigest,
    priorRevision: current.revision, resultRevision: planned.next.revision,
    entryId: planned.entryId, category: planned.affectedCategory,
    observedPhaseRevision: phaseSnapshot.revision, observedPhaseReceiptId: phaseSnapshot.lastReceiptId,
    priorActualsState: structuredClone(current), resultActualsState: planned.next
  };
  const receipt = { ...body, receiptDigest: digest(body) };
  return {
    idempotent: false, nextActualsState: planned.next, receipt,
    snapshot: projectSnapshot({ source, actualsState: planned.next, receipt })
  };
}
module.exports = {
  ACTUALS_POLICY, ACTUALS_POLICY_DIGEST, normalizeReadRequest, normalizeRequest,
  receiptIdFor, entryIdFor, publicReceipt, projectSnapshot, planCommand
};
