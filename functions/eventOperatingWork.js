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

const WORK_POLICY = deepFreeze({
  workflowKind: "event_execution",
  journalKind: "event_work",
  schemaVersion: 1,
  workPolicyVersion: 1,
  phasePolicyVersion: 1,
  phasePolicyDigest: phaseAuthority.POLICY_DIGEST,
  checkpointCodes: ["venue_access", "team_briefing", "service_handoff", "pack_down"],
  checkpointStates: ["not_recorded", "recorded", "reopened"],
  issueStates: ["open", "resolved"],
  severities: ["normal", "urgent"],
  maximumRetainedIssues: 25,
  maximumNoteCharacters: 240,
  evidenceBoundary: "Operator-recorded work and issues at server recording time only; not readiness, original occurrence time, actuals, delivery, payment, or closeout evidence."
});
const COMMANDS = Object.freeze([
  "checkpoint_record", "checkpoint_reopen", "issue_open", "issue_resolve", "issue_reopen"
]);
const BASE_REQUEST_KEYS = Object.freeze([
  "organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId", "requestId",
  "workPolicyVersion", "expectedWorkRevision", "command", "note"
]);
const IDENTITY_KEYS = Object.freeze([
  "organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"
]);
const PIN_KEYS = Object.freeze([
  "workflowKind", "journalKind", "schemaVersion", "workPolicyVersion", "workPolicyDigest",
  "phasePolicyVersion", "phasePolicyDigest"
]);
const STATE_KEYS = Object.freeze([
  ...IDENTITY_KEYS, ...PIN_KEYS, "ledgerId", "revision", "checkpoints", "issues",
  "createdAtISO", "updatedAtISO", "lastReceiptId"
]);
const RECEIPT_ID = /^event_work_command_[a-f0-9]{48}$/;
const ISSUE_ID = /^event_issue_[a-f0-9]{32}$/;
const PHASE_RECEIPT_ID = /^event_ops_command_[a-f0-9]{48}$/;

function fail(code, message) {
  throw new phaseAuthority.EventOperationsError(code, message);
}
function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function keys(value, allowed, label, required = allowed) {
  if (!record(value)
    || Object.keys(value).some((key) => !allowed.includes(key))
    || required.some((key) => !Object.hasOwn(value, key))) {
    fail("invalid-argument", `${label} contains missing or unsupported fields.`);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
const WORK_POLICY_DIGEST = digest(WORK_POLICY);
function pin() {
  return {
    workflowKind: "event_execution",
    journalKind: "event_work",
    schemaVersion: 1,
    workPolicyVersion: 1,
    workPolicyDigest: WORK_POLICY_DIGEST,
    phasePolicyVersion: 1,
    phasePolicyDigest: phaseAuthority.POLICY_DIGEST
  };
}
function assertPin(value) {
  if (PIN_KEYS.some((key) => value?.[key] !== pin()[key])) {
    fail("data-loss", "The event work journal policy pin is invalid.");
  }
}
function identity(value) {
  // The original authority validates the exact tuple without altering its policy.
  phaseAuthority.ledgerIdFor(value);
  return Object.fromEntries(IDENTITY_KEYS.map((key) => [key, value[key]]));
}
function exactISO(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail("invalid-argument", "An exact server ISO recording timestamp is required.");
  }
  return value;
}
function note(value, required = false) {
  if (typeof value !== "string" || value.length > WORK_POLICY.maximumNoteCharacters
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) {
    fail("invalid-argument", "Work notes must be plain text of 240 characters or fewer.");
  }
  const normalized = value.trim();
  if (required && !normalized) fail("invalid-argument", "A nonblank reason or issue description is required.");
  return normalized;
}
function normalizeReadRequest(input) {
  keys(input, ["organizationId", "quoteId"], "Work snapshot request");
  return phaseAuthority.normalizeScope(input);
}
function normalizeRequest(input) {
  if (!record(input) || !COMMANDS.includes(input.command)) {
    fail("invalid-argument", "A supported event work command is required.");
  }
  const extra = input.command.startsWith("checkpoint_")
    ? "checkpointCode" : input.command === "issue_open" ? "severity" : "issueId";
  const required = [...BASE_REQUEST_KEYS.filter((key) => key !== "note"), extra];
  keys(input, [...BASE_REQUEST_KEYS, extra], "Event work request", required);
  const refs = identity(input);
  if (input.workPolicyVersion !== 1
    || !Number.isSafeInteger(input.expectedWorkRevision)
    || input.expectedWorkRevision < 0
    || input.expectedWorkRevision >= Number.MAX_SAFE_INTEGER
    || typeof input.requestId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/.test(input.requestId)) {
    fail("invalid-argument", "Exact policy, bounded work revision, and opaque request identity are required.");
  }
  const request = {
    ...refs,
    requestId: input.requestId,
    workPolicyVersion: 1,
    expectedWorkRevision: input.expectedWorkRevision,
    command: input.command,
    note: note(input.note === undefined ? "" : input.note, input.command !== "checkpoint_record")
  };
  if (extra === "checkpointCode") {
    if (!WORK_POLICY.checkpointCodes.includes(input.checkpointCode)) {
      fail("invalid-argument", "The checkpoint code is unsupported.");
    }
  } else if (extra === "severity") {
    if (!WORK_POLICY.severities.includes(input.severity)) fail("invalid-argument", "The issue severity is unsupported.");
  } else if (typeof input.issueId !== "string" || !ISSUE_ID.test(input.issueId)) {
    fail("invalid-argument", "An exact recorded issue identifier is required.");
  }
  request[extra] = input[extra];
  return request;
}
function receiptIdFor(request) {
  return `event_work_command_${digest({ ledgerId: phaseAuthority.ledgerIdFor(request), requestId: request.requestId }).slice(0, 48)}`;
}
function issueIdFor(request) {
  return `event_issue_${digest({ ledgerId: phaseAuthority.ledgerIdFor(request), requestId: request.requestId }).slice(0, 32)}`;
}
function emptyState(source) {
  return {
    ...identity(source),
    ...pin(),
    ledgerId: phaseAuthority.ledgerIdFor(source),
    revision: 0,
    checkpoints: WORK_POLICY.checkpointCodes.map((code) => ({
      code, state: "not_recorded", note: "", updatedAtISO: "", lastReceiptId: ""
    })),
    issues: [],
    createdAtISO: "",
    updatedAtISO: "",
    lastReceiptId: ""
  };
}
function validateState(value, source) {
  keys(value, STATE_KEYS, "Work state");
  assertPin(value);
  if (digest(identity(value)) !== digest(identity(source))
    || value.ledgerId !== phaseAuthority.ledgerIdFor(source)
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !RECEIPT_ID.test(value.lastReceiptId)
    || !Array.isArray(value.checkpoints)
    || value.checkpoints.length !== WORK_POLICY.checkpointCodes.length
    || !Array.isArray(value.issues)
    || value.issues.length > WORK_POLICY.maximumRetainedIssues) {
    fail("data-loss", "The event work state identity, revision, or bounds are invalid.");
  }
  exactISO(value.createdAtISO);
  exactISO(value.updatedAtISO);
  if (value.createdAtISO > value.updatedAtISO) fail("data-loss", "Work state recording timestamps are inconsistent.");
  value.checkpoints.forEach((checkpoint, index) => {
    keys(checkpoint, ["code", "state", "note", "updatedAtISO", "lastReceiptId"], "Checkpoint");
    if (checkpoint.code !== WORK_POLICY.checkpointCodes[index]
      || !WORK_POLICY.checkpointStates.includes(checkpoint.state)
      || note(checkpoint.note) !== checkpoint.note) {
      fail("data-loss", "The recorded checkpoint is invalid.");
    }
    if (checkpoint.state === "not_recorded") {
      if (checkpoint.note || checkpoint.updatedAtISO || checkpoint.lastReceiptId) {
        fail("data-loss", "An unrecorded checkpoint cannot claim recording evidence.");
      }
    } else {
      exactISO(checkpoint.updatedAtISO);
      if (!RECEIPT_ID.test(checkpoint.lastReceiptId)
        || checkpoint.updatedAtISO > value.updatedAtISO
        || checkpoint.updatedAtISO < value.createdAtISO
        || (checkpoint.state === "reopened" && !checkpoint.note)) {
        fail("data-loss", "The checkpoint recording evidence is invalid.");
      }
    }
  });
  const issueIds = new Set();
  value.issues.forEach((issue) => {
    keys(issue, ["issueId", "state", "severity", "description", "latestNote", "createdAtISO", "updatedAtISO", "lastReceiptId"], "Issue");
    if (!ISSUE_ID.test(issue.issueId) || issueIds.has(issue.issueId)
      || !WORK_POLICY.issueStates.includes(issue.state)
      || !WORK_POLICY.severities.includes(issue.severity)
      || note(issue.description, true) !== issue.description
      || note(issue.latestNote, true) !== issue.latestNote
      || !RECEIPT_ID.test(issue.lastReceiptId)) {
      fail("data-loss", "The recorded issue is invalid.");
    }
    issueIds.add(issue.issueId);
    exactISO(issue.createdAtISO);
    exactISO(issue.updatedAtISO);
    if (issue.createdAtISO < value.createdAtISO
      || issue.createdAtISO > issue.updatedAtISO || issue.updatedAtISO > value.updatedAtISO) {
      fail("data-loss", "The issue recording timestamps are inconsistent.");
    }
  });
  return value;
}
function safeValidation(action) {
  try { return action(); } catch (error) {
    if (error.code === "data-loss") throw error;
    fail("data-loss", "Stored event work evidence is malformed.");
  }
}
function publicReceipt(receipt) {
  return {
    receiptId: receipt.receiptId,
    requestId: receipt.requestId,
    command: receipt.request.command,
    checkpointCode: receipt.request.checkpointCode || "",
    issueId: receipt.issueId || "",
    priorRevision: receipt.priorRevision,
    resultRevision: receipt.resultRevision,
    priorState: receipt.priorState,
    resultState: receipt.resultState,
    recordedAtISO: receipt.recordedAtISO
  };
}
function verifyReceipt(value) {
  return safeValidation(() => {
    keys(value, [
      ...IDENTITY_KEYS, ...PIN_KEYS, "ledgerId", "receiptId", "requestId", "request",
      "recordedBy", "recordedAtISO", "commandDigest", "receiptDigest", "priorRevision",
      "resultRevision", "priorState", "resultState", "issueId", "observedPhaseRevision",
      "observedPhaseReceiptId", "priorWorkDigest", "resultWorkState"
    ], "Work receipt");
    const { receiptDigest, ...body } = value;
    assertPin(body);
    const request = normalizeRequest(body.request);
    keys(body.recordedBy, ["organizationId", "uid", "role"], "Work actor");
    const actor = phaseAuthority.normalizeActor(body.recordedBy, request.organizationId, true);
    const expectedIssueId = request.command === "issue_open" ? issueIdFor(request) : request.issueId || "";
    if (receiptDigest !== digest(body)
      || body.commandDigest !== digest({ request, actor })
      || body.receiptId !== receiptIdFor(request)
      || body.requestId !== request.requestId
      || body.ledgerId !== phaseAuthority.ledgerIdFor(request)
      || digest(identity(body)) !== digest(identity(request))
      || body.priorRevision !== request.expectedWorkRevision
      || body.resultRevision !== body.priorRevision + 1
      || body.issueId !== expectedIssueId
      || !Number.isSafeInteger(body.observedPhaseRevision) || body.observedPhaseRevision < 1
      || !PHASE_RECEIPT_ID.test(body.observedPhaseReceiptId)
      || !/^[a-f0-9]{64}$/.test(body.priorWorkDigest)
      || (body.priorRevision === 0 && body.priorWorkDigest !== digest(emptyState(request)))) {
      fail("data-loss", "The event work receipt failed command or integrity validation.");
    }
    exactISO(body.recordedAtISO);
    const result = validateState(body.resultWorkState, request);
    if (result.revision !== body.resultRevision || result.lastReceiptId !== body.receiptId
      || result.updatedAtISO !== body.recordedAtISO
      || (body.priorRevision === 0 && result.createdAtISO !== body.recordedAtISO)) {
      fail("data-loss", "The work receipt result does not match its recording evidence.");
    }
    const checkpoint = result.checkpoints.find((item) => item.code === request.checkpointCode);
    const issue = result.issues.find((item) => item.issueId === expectedIssueId);
    const allowedPrior = {
      checkpoint_record: ["not_recorded", "reopened"], checkpoint_reopen: ["recorded"],
      issue_open: [null], issue_resolve: ["open"], issue_reopen: ["resolved"]
    }[request.command];
    const resultState = {
      checkpoint_record: "recorded", checkpoint_reopen: "reopened",
      issue_open: "open", issue_resolve: "resolved", issue_reopen: "open"
    }[request.command];
    const target = checkpoint || issue;
    if (!allowedPrior.includes(body.priorState) || body.resultState !== resultState
      || !target || target.state !== resultState || target.updatedAtISO !== body.recordedAtISO
      || target.lastReceiptId !== body.receiptId
      || (checkpoint ? checkpoint.note : issue.latestNote) !== request.note
      || (request.command === "issue_open"
        && (issue.description !== request.note || issue.severity !== request.severity
          || issue.createdAtISO !== body.recordedAtISO))) {
      fail("data-loss", "The work receipt transition evidence is inconsistent.");
    }
    return value;
  });
}
function projectSnapshot({ source, phaseInitialized = true, workState = null, receipt = null }) {
  let state = emptyState(source);
  let latestReceipt = null;
  if (workState) {
    if (!phaseInitialized) fail("data-loss", "Recorded event work has no initialized phase ledger.");
    safeValidation(() => validateState(workState, source));
    const verified = verifyReceipt(receipt);
    if (digest(workState) !== digest(verified.resultWorkState)) {
      fail("data-loss", "The work journal does not match its latest immutable receipt.");
    }
    state = workState;
    latestReceipt = publicReceipt(verified);
  }
  return deepFreeze({
    ...identity(source), ...pin(), ledgerId: state.ledgerId,
    availability: workState ? "available" : "not_yet_available",
    reasonCode: workState ? "" : phaseInitialized ? "journal_empty" : "phase_ledger_missing",
    revision: state.revision,
    checkpoints: structuredClone(state.checkpoints),
    issues: structuredClone(state.issues),
    lastReceiptId: state.lastReceiptId,
    updatedAtISO: state.updatedAtISO,
    latestReceipt,
    historyCoverage: "latest_receipt_only",
    evidenceBoundary: WORK_POLICY.evidenceBoundary
  });
}
function planCommand({ request: input, actor, source, phaseSnapshot, workState = null, currentReceipt = null, existingReceipt = null, nowISO }) {
  const request = normalizeRequest(input);
  const trustedActor = phaseAuthority.normalizeActor(actor, request.organizationId, true);
  const commandDigest = digest({ request, actor: trustedActor });
  if (existingReceipt) {
    const receipt = verifyReceipt(existingReceipt);
    if (receipt.commandDigest !== commandDigest || receipt.receiptId !== receiptIdFor(request)) {
      fail("already-exists", "This work request identity belongs to a different immutable command.");
    }
    return {
      idempotent: true, nextWorkState: null, receipt,
      snapshot: projectSnapshot({ source: request, workState: receipt.resultWorkState, receipt })
    };
  }
  if (!source || digest(identity(source)) !== digest(identity(request))) {
    fail("aborted", "The accepted event source changed. Reload before recording work.");
  }
  if (!phaseSnapshot || phaseSnapshot.availability !== "available"
    || phaseSnapshot.ledgerId !== phaseAuthority.ledgerIdFor(request)
    || phaseSnapshot.workflowKind !== "event_execution"
    || phaseSnapshot.schemaVersion !== 1 || phaseSnapshot.policyVersion !== 1
    || phaseSnapshot.templateVersion !== 1
    || phaseSnapshot.policyDigest !== phaseAuthority.POLICY_DIGEST
    || !phaseAuthority.POLICY.phases.includes(phaseSnapshot.phase)
    || digest(identity(phaseSnapshot)) !== digest(identity(request))
    || !Number.isSafeInteger(phaseSnapshot.revision) || phaseSnapshot.revision < 1
    || !PHASE_RECEIPT_ID.test(phaseSnapshot.lastReceiptId)) {
    fail("failed-precondition", "Initialize a valid event phase ledger before recording work.");
  }
  if (workState) projectSnapshot({ source, workState, receipt: currentReceipt });
  const current = workState || emptyState(source);
  if (current.revision !== request.expectedWorkRevision) {
    fail("aborted", "The event work journal changed. Reload before trying again.");
  }
  const recordedAtISO = exactISO(nowISO);
  if (current.updatedAtISO && recordedAtISO < current.updatedAtISO) {
    fail("failed-precondition", "Server recording time precedes existing work evidence.");
  }
  const next = structuredClone(current);
  const receiptId = receiptIdFor(request);
  let priorState = null;
  let resultState;
  let issueId = "";
  if (request.command.startsWith("checkpoint_")) {
    const checkpoint = next.checkpoints.find((item) => item.code === request.checkpointCode);
    priorState = checkpoint.state;
    resultState = request.command === "checkpoint_record" ? "recorded" : "reopened";
    const allowed = request.command === "checkpoint_record"
      ? ["not_recorded", "reopened"].includes(priorState) : priorState === "recorded";
    if (!allowed) fail("failed-precondition", "The requested checkpoint transition is not allowed.");
    Object.assign(checkpoint, { state: resultState, note: request.note, updatedAtISO: recordedAtISO, lastReceiptId: receiptId });
  } else if (request.command === "issue_open") {
    if (next.issues.length >= WORK_POLICY.maximumRetainedIssues) {
      fail("resource-exhausted", "This event has reached its limit of 25 retained issues.");
    }
    issueId = issueIdFor(request);
    if (next.issues.some((issue) => issue.issueId === issueId)) {
      fail("already-exists", "This issue identity is already recorded.");
    }
    resultState = "open";
    next.issues.push({
      issueId, state: "open", severity: request.severity, description: request.note,
      latestNote: request.note, createdAtISO: recordedAtISO, updatedAtISO: recordedAtISO,
      lastReceiptId: receiptId
    });
  } else {
    issueId = request.issueId;
    const issue = next.issues.find((item) => item.issueId === issueId);
    if (!issue) fail("not-found", "The exact recorded issue is unavailable.");
    priorState = issue.state;
    resultState = request.command === "issue_resolve" ? "resolved" : "open";
    if (request.command === "issue_resolve" ? priorState !== "open" : priorState !== "resolved") {
      fail("failed-precondition", "The requested issue transition is not allowed.");
    }
    Object.assign(issue, { state: resultState, latestNote: request.note, updatedAtISO: recordedAtISO, lastReceiptId: receiptId });
  }
  Object.assign(next, {
    revision: current.revision + 1, createdAtISO: current.createdAtISO || recordedAtISO,
    updatedAtISO: recordedAtISO, lastReceiptId: receiptId
  });
  const body = {
    ...identity(request), ...pin(), ledgerId: next.ledgerId,
    receiptId, requestId: request.requestId, request, recordedBy: trustedActor,
    recordedAtISO, commandDigest, priorRevision: current.revision, resultRevision: next.revision,
    priorState, resultState, issueId, observedPhaseRevision: phaseSnapshot.revision,
    observedPhaseReceiptId: phaseSnapshot.lastReceiptId, priorWorkDigest: digest(current),
    resultWorkState: next
  };
  const receipt = { ...body, receiptDigest: digest(body) };
  return {
    idempotent: false, nextWorkState: next, receipt,
    snapshot: projectSnapshot({ source, workState: next, receipt })
  };
}

module.exports = {
  WORK_POLICY, WORK_POLICY_DIGEST, normalizeReadRequest, normalizeRequest,
  receiptIdFor, issueIdFor, publicReceipt, projectSnapshot, planCommand
};
