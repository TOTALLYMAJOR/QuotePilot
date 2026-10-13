"use strict";

const execution = require("./workflowExecution");
const definitions = require("./workflowDefinitions");
const phase = require("./eventOperations");
const work = require("./eventOperatingWork");
const attendance = require("./quoteAttendance");
const closeout = require("./postEventCloseout");
const clone = (value) => structuredClone(value);
const digest = execution.digest;
const fail = (code, message) => { throw new phase.EventOperationsError(code, message); };
const equal = (left, right) => digest(left) === digest(right);

function acceptedSource(source, workflowKind) {
  phase.ledgerIdFor(source);
  return execution.normalizeSource({ schemaVersion: 2, organizationId: source.organizationId,
    workflowKind, subjectId: source.quoteId, sourceVersionId: source.sourceVersionId,
    sourceReceiptId: source.acceptanceReceiptId });
}
function checkedDefinition(value, source) {
  const definition = definitions.validatePublishedVersion(value, { workflowKind: source.workflowKind, allowSeed: false });
  if (definition.schemaVersion !== 2 || definition.organizationId !== source.organizationId) fail("permission-denied", "The exact tenant version two definition is required.");
  return definition;
}
function observation(source, { observationKind = "immutable_receipt", evidenceId, evidenceDigest, domainPolicyDigest, stateCode, recordedAtISO }) {
  return execution.validateDomainRef({ schemaVersion: 2, adapterId: execution.ADAPTER_IDS[source.workflowKind],
    sourceDigest: digest(source), observationKind, evidenceId, evidenceDigest, domainPolicyDigest, stateCode, recordedAtISO }, source);
}
function quotePolicy(definition) {
  const value = definitions.validatePublishedVersion(definition, { workflowKind: "quote_review", allowSeed: false });
  if (value.schemaVersion !== 2) fail("failed-precondition", "A published version two quote policy is required.");
  return { organizationId: value.organizationId, definitionPin: definitions.definitionPin(value),
    approvalPolicy: clone(value.config.packPolicy.approval), declaredBy: value.publishedBy.uid, declaredAtISO: value.publishedAtISO };
}
function quoteObservation({ authority, simulationReceipt, authorizationReceipt = null, applyReceipt = null, definition }) {
  const simulation = authority.validateSimulationReceipt(simulationReceipt);
  const source = execution.normalizeSource({ schemaVersion: 2, organizationId: simulation.organizationId,
    workflowKind: "quote_review", subjectId: simulation.quoteId, sourceVersionId: simulation.baseRevisionId,
    sourceReceiptId: simulation.receiptId });
  checkedDefinition(definition, source);
  if (!equal(simulation.workflowPolicy, quotePolicy(definition))) fail("data-loss", "The simulation does not bind the exact published quote policy.");
  let evidence = simulation;
  let stateCode = simulation.authorizationRequired ? "authorization_required" : "simulated";
  let recordedAtISO = simulation.simulatedAtISO;
  const validateLink = (receipt) => {
    if (receipt.organizationId !== source.organizationId || receipt.quoteId !== source.subjectId
      || receipt.simulationReceiptId !== simulation.receiptId || receipt.simulationDigest !== simulation.receiptDigest
      || receipt.baseRevisionId !== simulation.baseRevisionId || receipt.proposalDigest !== simulation.proposalDigest
      || !equal(receipt.workflowPolicy, simulation.workflowPolicy) || !equal(receipt.attendanceBinding, simulation.attendanceBinding)
      || !equal(receipt.approvalEvaluation, simulation.approvalEvaluation)) fail("data-loss", "Commercial workflow receipts do not form the same exact proposal chain.");
  };
  let authorization = null;
  if (authorizationReceipt) {
    authorization = authority.validateAuthorizationReceipt(authorizationReceipt);
    validateLink(authorization);
    if (!simulation.authorizationRequired || authorization.proposedRevisionId !== simulation.proposedRevisionId
      || authorization.catalogAuthorityDigest !== simulation.catalogAuthorityDigest || authorization.policyVersion !== simulation.policyVersion
      || authorization.authorizedAtISO < simulation.simulatedAtISO) fail("data-loss", "Authorization is not valid for this simulated proposal.");
    evidence = authorization; stateCode = "authorized"; recordedAtISO = authorization.authorizedAtISO;
  }
  if (applyReceipt) {
    const applied = authority.validateApplyReceipt(applyReceipt);
    validateLink(applied);
    if (applied.authorizationConsumed !== Boolean(authorization) || Boolean(authorization) !== simulation.authorizationRequired
      || applied.authorizationReceiptId !== (authorization?.receiptId || "") || applied.authorizationReceiptDigest !== (authorization?.receiptDigest || "")
      || applied.appliedAtISO < recordedAtISO) fail("data-loss", "Apply evidence does not consume the exact required authorization.");
    evidence = applied; stateCode = "applied"; recordedAtISO = applied.appliedAtISO;
  }
  return { source, domainRef: observation(source, { evidenceId: evidence.receiptId, evidenceDigest: evidence.receiptDigest,
    domainPolicyDigest: digest({ policyVersion: simulation.policyVersion, workflowPolicy: simulation.workflowPolicy }), stateCode, recordedAtISO }),
    scheduleAnchor: { kind: "instant", atISO: simulation.simulatedAtISO } };
}
function eventObservation({ source: domainSource, ledger, receipt }) {
  const source = acceptedSource(domainSource, "event_execution");
  const snapshot = phase.projectSnapshot(domainSource, ledger, receipt);
  if (snapshot.availability !== "available") fail("failed-precondition", "A verified event phase is required.");
  return { source, domainRef: observation(source, { evidenceId: receipt.receiptId, evidenceDigest: receipt.receiptDigest,
    domainPolicyDigest: snapshot.policyDigest, stateCode: snapshot.phase, recordedAtISO: receipt.recordedAtISO }),
    scheduleAnchor: { kind: "instant", atISO: ledger.createdAtISO } };
}
function attendanceObservation({ source: domainSource, state, receipt, portalIdentity = null }) {
  attendance.verifyReceipt(receipt);
  attendance.projectSnapshot({ source: domainSource, state, receipt });
  const source = acceptedSource(domainSource, "final_guest_count");
  if (receipt.actor.role === "customer" && (!portalIdentity || portalIdentity.portalKeySha256 !== receipt.actor.portalKeySha256
    || portalIdentity.portalIssuedAtISO !== receipt.actor.portalIssuedAtISO || portalIdentity.organizationId !== source.organizationId)) fail("permission-denied", "The observation requires the exact currently authorized portal issuance.");
  const timing = state.currentRequest?.timing;
  if (!timing) fail("failed-precondition", "The attendance request has no domain-owned calendar timing.");
  return { source, domainRef: observation(source, { evidenceId: receipt.receiptId, evidenceDigest: receipt.receiptDigest,
    domainPolicyDigest: attendance.POLICY_DIGEST, stateCode: receipt.request.command === "request_confirmation" ? "requested" : "response_recorded", recordedAtISO: receipt.recordedAtISO }),
    scheduleAnchor: execution.validateScheduleAnchor({ kind: "tenant_calendar_date", date: timing.dueDate, timeZone: timing.timezone }) };
}
function assertEventConstraints({ source: domainSource, definition, ledger, phaseReceipt, workState = null, workReceipt = null, command }) {
  const source = acceptedSource(domainSource, "event_execution");
  const value = checkedDefinition(definition, source);
  const snapshot = phase.projectSnapshot(domainSource, ledger, phaseReceipt);
  if (snapshot.availability !== "available") fail("failed-precondition", "Constraints require the initialized event phase.");
  if (!workState && workReceipt) fail("data-loss", "Work evidence exists without its current journal.");
  const journal = work.projectSnapshot({ source: domainSource, workState, receipt: workReceipt });
  let required = [];
  if (command.command === "transition") {
    const constraint = value.config.packPolicy.phaseConstraints[command.targetPhase];
    if (!constraint) fail("invalid-argument", "The tenant cannot introduce a new event phase.");
    required = constraint.requiredCheckpoints;
    if (constraint.blockOpenUrgentIssues && journal.issues.some((issue) => issue.state === "open" && issue.severity === "urgent")) fail("failed-precondition", "Resolve open urgent issues before this configured phase transition.");
  } else if (command.command === "checkpoint_record") {
    required = value.config.packPolicy.checkpointPrerequisites[command.checkpointCode];
    if (!required) fail("invalid-argument", "The configured checkpoint is unsupported.");
  } else if (!['checkpoint_reopen', 'issue_open', 'issue_resolve', 'issue_reopen'].includes(command.command)) {
    fail("invalid-argument", "This command is outside event constraint authority.");
  }
  if (required.some((code) => journal.checkpoints.find((checkpoint) => checkpoint.code === code)?.state !== "recorded")) fail("failed-precondition", "Record the configured prerequisite checkpoints before this action.");
  const body = { schemaVersion: 2, source, definitionPin: definitions.definitionPin(value),
    phaseReceiptId: phaseReceipt.receiptId, phaseReceiptDigest: phaseReceipt.receiptDigest,
    workReceiptId: workReceipt?.receiptId || "", workReceiptDigest: workReceipt?.receiptDigest || "", command: clone(command), decision: "allowed" };
  return { ...body, evidenceDigest: digest(body) };
}
function buildEventConstraintProof({ source, definition, ledger, phaseReceipt, workState = null, workReceipt = null, resultReceipt }) {
  const command = resultReceipt?.request;
  const constraint = assertEventConstraints({ source, definition, ledger, phaseReceipt, workState, workReceipt, command });
  const reproduced = resultReceipt.resultLedger
    ? phase.planCommand({ request: command, actor: resultReceipt.recordedBy, source, ledger, nowISO: resultReceipt.recordedAtISO })
    : work.planCommand({ request: command, actor: resultReceipt.recordedBy, source, phaseSnapshot: phase.projectSnapshot(source, ledger, phaseReceipt), workState, currentReceipt: workReceipt, nowISO: resultReceipt.recordedAtISO });
  if (!equal(reproduced.receipt, resultReceipt)) fail("data-loss", "The constrained native outcome does not reproduce its exact prior evidence.");
  const body = { schemaVersion: 2, evidenceKind: "event_constraint", sourceChannel: resultReceipt.resultLedger ? "phase" : "work", source: { organizationId: source.organizationId, quoteId: source.quoteId, sourceVersionId: source.sourceVersionId, acceptanceReceiptId: source.acceptanceReceiptId },
    evidenceId: resultReceipt.receiptId, definition: clone(definition), ledger: clone(ledger), phaseReceipt: clone(phaseReceipt), workState: clone(workState), workReceipt: clone(workReceipt), resultReceipt: clone(resultReceipt), constraint };
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > 196_608) fail("resource-exhausted", "The event constraint proof exceeds its bounded size.");
  return { ...body, proofDigest: digest(body) };
}
function verifyEventConstraintProof(proof) {
  const expected = buildEventConstraintProof(proof || {});
  if (!equal(expected, proof)) fail("data-loss", "The event constraint proof failed immutable validation.");
  return proof;
}
const CLOSEOUT_RECORD_KEYS = ["schemaVersion", "closeoutId", "organizationId", "quoteId", "customerId", "sourceVersionId", "acceptanceReceiptId", "sourceAcceptedAtISO", "sourcePortalIssuedAtISO", "sourceBookedAtISO", "eventDate", "dueDate", "policy", "state", "reviewItems", "completedAtISO", "completedBy", "createdAtISO", "createdBy", "updatedAtISO"];
const CLOSEOUT_SOURCE_KEYS = ["organizationId", "quoteId", "customerId", "sourceVersionId", "acceptanceReceiptId", "acceptedAtISO", "portalIssuedAtISO", "bookedAtISO", "eventDate"];
const CLOSEOUT_RECEIPT_KEYS = ["schemaVersion", "receiptId", "requestId", "organizationId", "quoteId", "closeoutId", "itemCode", "action", "targetState", "priorItemState", "resultItemState", "priorCloseoutState", "resultCloseoutState", "applied", "note", "recordedAtISO", "recordedBy"];
const CLOSEOUT_REFRESH_RECEIPT_KEYS = ["schemaVersion", "receiptId", "requestId", "organizationId", "quoteId", "closeoutId", "action", "priorPolicyState", "resultPolicyState", "priorTimeZone", "resultTimeZone", "resultCloseoutState", "applied", "recordedAtISO", "recordedBy"];
const MAX_OBSERVATION_BYTES = 65_536;
function picked(value, keys) {
  if (!value || keys.some((key) => !Object.hasOwn(value, key))) fail("data-loss", "The domain evidence is incomplete.");
  return Object.fromEntries(keys.map((key) => [key, clone(value[key])]));
}
function closeoutRecord(value, source) {
  const record = picked(value, CLOSEOUT_RECORD_KEYS);
  const timestamp = (input) => {
    if (typeof input !== "string" || !Number.isFinite(Date.parse(input)) || new Date(input).toISOString() !== input) fail("data-loss", "The closeout snapshot timestamp is not canonical.");
    return input;
  };
  const actor = (input) => {
    const result = picked(input, ["uid", "email", "role"]);
    if (!equal(input, result) || typeof result.uid !== "string" || !/^[^\s/?#\\\u0000]{1,180}$/u.test(result.uid)
      || !["admin", "sales"].includes(result.role) || typeof result.email !== "string" || result.email !== result.email.trim().toLowerCase()
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) fail("data-loss", "The recorded closeout actor is malformed.");
    return result;
  };
  closeout.assertPostEventCloseoutMatchesSource(record, source);
  if (record.schemaVersion !== 1 || record.dueDate !== closeout.addCalendarDaysDateOnly(source.eventDate) || ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId", "customerId", "eventDate"].some((key) => record[key] !== source[key])
    || record.closeoutId !== closeout.buildPostEventCloseoutId(source) || record.sourceAcceptedAtISO !== source.acceptedAtISO
    || record.sourcePortalIssuedAtISO !== source.portalIssuedAtISO || record.sourceBookedAtISO !== source.bookedAtISO) fail("data-loss", "Closeout snapshot identity is not canonical.");
  for (const key of ["sourceAcceptedAtISO", "sourcePortalIssuedAtISO", "sourceBookedAtISO", "createdAtISO", "updatedAtISO"]) timestamp(record[key]);
  if (record.createdAtISO > record.updatedAtISO || record.createdAtISO < record.sourceBookedAtISO) fail("data-loss", "Closeout snapshot recording chronology is inconsistent.");
  if (closeout.derivePostEventCloseoutState(record) !== record.state) fail("data-loss", "Closeout items and aggregate state disagree.");
  const policy = closeout.buildPostEventCloseoutPolicySnapshot({ businessTimeZone: record.policy.timeZone });
  if (!equal(record.policy, policy)) fail("data-loss", "The recorded closeout policy is not the fixed owner policy.");
  let latestReview = record.createdAtISO;
  const reviewItems = {};
  for (const code of closeout.POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES) {
    const item = picked(record.reviewItems[code], ["state", "reviewedAtISO", "reviewedBy", "lastActionReceiptId"]);
    if (!equal(item, record.reviewItems[code]) || !["pending", "reviewed"].includes(item.state)
      || (item.lastActionReceiptId !== "" && !/^closeout_action_[a-f0-9]{48}$/.test(item.lastActionReceiptId))) fail("data-loss", "Closeout item metadata is malformed.");
    if (item.state === "reviewed") {
      timestamp(item.reviewedAtISO); item.reviewedBy = actor(item.reviewedBy);
      if (!item.lastActionReceiptId || item.reviewedAtISO < record.createdAtISO || item.reviewedAtISO > record.updatedAtISO) fail("data-loss", "Closeout review chronology is inconsistent.");
      if (item.reviewedAtISO > latestReview) latestReview = item.reviewedAtISO;
    } else if (item.reviewedAtISO !== "" || item.reviewedBy !== null) fail("data-loss", "Pending closeout items cannot contain review evidence.");
    reviewItems[code] = item;
  }
  if (!equal(record.reviewItems, reviewItems)) fail("data-loss", "The closeout review item set is not exact.");
  record.reviewItems = reviewItems;
  record.createdBy = actor(record.createdBy);
  if (record.state === "completed") {
    timestamp(record.completedAtISO); record.completedBy = actor(record.completedBy);
    if (record.completedAtISO < latestReview || record.completedAtISO > record.updatedAtISO) fail("data-loss", "Closeout completion chronology is inconsistent.");
  } else if (record.completedAtISO !== "" || record.completedBy !== null) fail("data-loss", "An incomplete closeout cannot claim completion evidence.");
  return record;
}
function buildCloseoutObservationProof({ source: inputSource, record, priorRecord = null, actionReceipt = null }) {
  const domainSource = picked(inputSource, CLOSEOUT_SOURCE_KEYS);
  const source = acceptedSource(domainSource, "closeout_follow_up");
  const resultRecord = closeoutRecord(record, domainSource);
  const prior = priorRecord === null ? null : closeoutRecord(priorRecord, domainSource);
  let receipt = null;
  if (actionReceipt) {
    if (!prior) fail("data-loss", "Historical closeout action verification requires its exact prior snapshot.");
    const refresh = actionReceipt.action === "refresh_configuration";
    receipt = picked(actionReceipt, refresh ? CLOSEOUT_REFRESH_RECEIPT_KEYS : CLOSEOUT_RECEIPT_KEYS);
    receipt.recordedBy = picked(receipt.recordedBy, ["uid", "email", "role"]);
    const request = picked(receipt, refresh
      ? ["organizationId", "quoteId", "closeoutId", "requestId"]
      : ["organizationId", "quoteId", "closeoutId", "itemCode", "action", "requestId", "note"]);
    const planned = refresh
      ? closeout.planPostEventCloseoutPolicyRefresh({ request, record: prior, source: domainSource,
        settings: { businessTimeZone: receipt.resultTimeZone }, actor: receipt.recordedBy, nowISO: receipt.recordedAtISO })
      : closeout.planPostEventCloseoutAction({ request, record: prior, source: domainSource,
        actor: receipt.recordedBy, nowISO: receipt.recordedAtISO });
    if (!equal(planned.receipt, receipt) || !equal(closeoutRecord(planned.nextRecord || prior, domainSource), resultRecord)) fail("data-loss", "The closeout observation does not reproduce its original domain command.");
  } else if (prior) fail("invalid-argument", "A record snapshot cannot claim an unreceipted transition.");
  const body = { schemaVersion: 2, source, domainSource, observationKind: receipt ? "immutable_receipt" : "record_snapshot",
    evidenceId: receipt?.receiptId || resultRecord.closeoutId, priorRecord: prior, resultRecord, actionReceipt: receipt,
    recordDigest: digest(resultRecord), receiptDigest: receipt ? digest(receipt) : "" };
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_OBSERVATION_BYTES) fail("resource-exhausted", "The bounded adapter observation limit was exceeded.");
  return { ...body, proofDigest: digest(body) };
}
function verifyCloseoutObservationProof(proof) {
  const expected = buildCloseoutObservationProof({ source: proof?.domainSource, record: proof?.resultRecord,
    priorRecord: proof?.priorRecord, actionReceipt: proof?.actionReceipt });
  if (!equal(proof, expected)) fail("data-loss", "The immutable adapter observation failed exact integrity validation.");
  return proof;
}
function closeoutObservation({ proof, definition }) {
  verifyCloseoutObservationProof(proof);
  const value = checkedDefinition(definition, proof.source);
  const record = proof.resultRecord;
  if (record.policy.state !== "configured") fail("failed-precondition", "Closeout coordination requires the domain-owned tenant timezone.");
  return { source: clone(proof.source), domainRef: observation(proof.source, { observationKind: proof.observationKind,
    evidenceId: proof.evidenceId, evidenceDigest: proof.proofDigest, domainPolicyDigest: digest(record.policy),
    stateCode: record.state, recordedAtISO: proof.actionReceipt?.recordedAtISO || record.updatedAtISO }),
    scheduleAnchor: execution.validateScheduleAnchor({ kind: "tenant_calendar_date",
      date: closeout.addCalendarDaysDateOnly(record.dueDate, value.config.packPolicy.followUpOffsetDays), timeZone: record.policy.timeZone }) };
}
function planObservation({ source, domainRef, scheduleAnchor, definition = null, actor, requestId,
  instance = null, currentReceipt = null, existingReceipt = null, nowISO }) {
  const command = existingReceipt?.request.command || (instance ? "observe_domain" : "initialize");
  const result = execution.planCommand({ source, request: { requestId, command,
    expectedRevision: existingReceipt?.request.expectedRevision ?? instance?.revision ?? 0 }, actor,
    instance, currentReceipt, existingReceipt, definition: command === "initialize" ? definition : null,
    domainRef, scheduleAnchor: command === "initialize" ? scheduleAnchor : null, nowISO, internal: true });
  if (!equal(result.receipt.domainRef, domainRef)) fail("data-loss", "The coordinator receipt is not paired with this exact domain observation.");
  return result;
}

module.exports = { buildEventConstraintProof, verifyEventConstraintProof, MAX_OBSERVATION_BYTES, buildCloseoutObservationProof, verifyCloseoutObservationProof, closeoutObservation, acceptedSource, quotePolicy, quoteObservation, eventObservation, attendanceObservation, assertEventConstraints, planObservation };
