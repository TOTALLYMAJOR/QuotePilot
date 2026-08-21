"use strict";

const {
  STEWARD_MAX_PACKET_AGE_MS,
  STEWARD_PACKET_STATUSES,
  STEWARD_SCHEMA_VERSION,
  StewardContractError,
  assertExactKeys,
  exactISO,
  isRecord,
  normalizeStewardRequest,
  normalizeStewardSources,
  opaqueId,
  stableValue,
  stewardPacketDigest,
  text
} = require("./contracts.cjs");
const { evaluateStewardRequestPolicy, inspectStewardContent } = require("./policy.cjs");

const MAX_LIST_ITEMS = 24;
const TRUSTED_COMMERCIAL_SOURCE_TYPES = new Set([
  "pricing_authority",
  "commercial_change_receipt",
  "margin_authority"
]);
const TASK_CHANGE_FIELDS = Object.freeze({
  setup_menu: new Set(["name", "description", "category", "unit", "priceCandidate", "taxClass"]),
  configure_workflow: new Set(["workflow.reminderDelayHours", "workflow.approvalRequired", "workflow.followUpEnabled"]),
  prepare_quote: new Set(["catalogItemId", "quantity", "serviceStyle", "guestCount"])
});
const SAFE_TEXT_PATTERN = /(?:<\/?[A-Za-z][^>]*>|javascript:|data:text\/html|[\u202A-\u202E\u2066-\u2069]|^[=+@])/iu;
const COMMERCIAL_NUMBER_PATTERN = /(?:[$€£]\s*\d|\b\d+(?:\.\d+)?\s*%|\b(?:price|total|margin|discount|tax|fee|cost|deposit)\b.{0,24}\d)/iu;

function boundedPlainText(value, label, maxLength = 1200) {
  const normalized = text(value, maxLength);
  if (SAFE_TEXT_PATTERN.test(normalized) || /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) {
    throw new StewardContractError("failed-precondition", `${label} contains unsafe rendering content.`);
  }
  return normalized;
}

function sourceIds(value, sourceById, label) {
  if (!Array.isArray(value) || value.length > 16) {
    throw new StewardContractError("invalid-argument", `${label} source list is invalid.`);
  }
  const normalized = [...new Set(value.map((id) => opaqueId(id, `${label} source`)))];
  normalized.forEach((id) => {
    if (!sourceById.has(id)) {
      throw new StewardContractError("failed-precondition", `${label} cites an unauthorized source.`);
    }
  });
  return normalized;
}

function assertCommercialNumbersAreTrusted(value, ids, sourceById, label) {
  if (!COMMERCIAL_NUMBER_PATTERN.test(value)) return;
  if (!ids.some((id) => TRUSTED_COMMERCIAL_SOURCE_TYPES.has(sourceById.get(id)?.type))) {
    throw new StewardContractError(
      "failed-precondition",
      `${label} contains a commercial number without deterministic authority.`
    );
  }
}

function boundedList(value, label, normalizer) {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new StewardContractError("resource-exhausted", `${label} exceeds its bounded contract.`);
  }
  return value.map((entry, index) => normalizer(entry, `${label} ${index + 1}`));
}

function normalizeCandidate(candidate, sourceById, task) {
  assertExactKeys(
    candidate,
    [
      "status", "facts", "assumptions", "questions", "options", "proposedChanges",
      "responseDraft", "risks"
    ],
    "Steward candidate"
  );
  const status = text(candidate.status, 40).toLowerCase();
  if (!STEWARD_PACKET_STATUSES.includes(status)) {
    throw new StewardContractError("invalid-argument", "Steward candidate status is unsupported.");
  }
  const facts = boundedList(candidate.facts, "Steward facts", (entry, label) => {
    assertExactKeys(entry, ["id", "text", "sourceIds"], label);
    const ids = sourceIds(entry.sourceIds, sourceById, label);
    const value = boundedPlainText(entry.text, label);
    if (!value || !ids.length) {
      throw new StewardContractError("failed-precondition", `${label} requires text and evidence.`);
    }
    assertCommercialNumbersAreTrusted(value, ids, sourceById, label);
    return { id: opaqueId(entry.id, `${label} ID`), text: value, sourceIds: ids };
  });
  const assumptions = boundedList(candidate.assumptions, "Steward assumptions", (entry, label) => {
    assertExactKeys(entry, ["id", "text"], label);
    const value = boundedPlainText(entry.text, label);
    if (!value || COMMERCIAL_NUMBER_PATTERN.test(value)) {
      throw new StewardContractError("failed-precondition", `${label} cannot manufacture commercial truth.`);
    }
    return { id: opaqueId(entry.id, `${label} ID`), text: value };
  });
  const questions = boundedList(candidate.questions, "Steward questions", (entry, label) => {
    assertExactKeys(entry, ["id", "text"], label);
    const value = boundedPlainText(entry.text, label);
    if (!value) throw new StewardContractError("invalid-argument", `${label} is empty.`);
    return { id: opaqueId(entry.id, `${label} ID`), text: value };
  });
  const options = boundedList(candidate.options, "Steward options", (entry, label) => {
    assertExactKeys(entry, ["id", "title", "summary", "sourceIds"], label);
    const ids = sourceIds(entry.sourceIds, sourceById, label);
    const title = boundedPlainText(entry.title, `${label} title`, 160);
    const summary = boundedPlainText(entry.summary, `${label} summary`);
    if (!title || !summary) throw new StewardContractError("invalid-argument", `${label} is incomplete.`);
    assertCommercialNumbersAreTrusted(`${title} ${summary}`, ids, sourceById, label);
    return { id: opaqueId(entry.id, `${label} ID`), title, summary, sourceIds: ids };
  });
  const allowedChangeFields = TASK_CHANGE_FIELDS[task] || new Set();
  const proposedChanges = boundedList(candidate.proposedChanges, "Steward proposed changes", (entry, label) => {
    assertExactKeys(entry, ["field", "operation", "value", "sourceIds", "requiresAdminReview"], label);
    const field = text(entry.field, 120);
    const operation = text(entry.operation, 24).toLowerCase();
    const ids = sourceIds(entry.sourceIds, sourceById, label);
    if (!allowedChangeFields.has(field) || !["set", "add", "remove"].includes(operation)) {
      throw new StewardContractError("failed-precondition", `${label} is outside the fixed task plan.`);
    }
    if (["setup_menu", "configure_workflow"].includes(task) && entry.requiresAdminReview !== true) {
      throw new StewardContractError("failed-precondition", `${label} must retain its administrator checkpoint.`);
    }
    const value = stableValue(entry.value);
    const serializedValue = JSON.stringify(value);
    if (serializedValue.length > 1000 || SAFE_TEXT_PATTERN.test(serializedValue)) {
      throw new StewardContractError("failed-precondition", `${label} contains unsafe or oversized content.`);
    }
    assertCommercialNumbersAreTrusted(serializedValue, ids, sourceById, label);
    return { field, operation, value, sourceIds: ids, requiresAdminReview: entry.requiresAdminReview === true };
  });
  const responseDraft = candidate.responseDraft === null
    ? null
    : boundedPlainText(candidate.responseDraft, "Steward response draft", 4000);
  if (responseDraft && COMMERCIAL_NUMBER_PATTERN.test(responseDraft)) {
    throw new StewardContractError(
      "failed-precondition",
      "Steward response draft cannot carry unbound commercial numbers."
    );
  }
  const risks = boundedList(candidate.risks, "Steward risks", (entry, label) => {
    assertExactKeys(entry, ["code", "message", "sourceIds"], label);
    const ids = sourceIds(entry.sourceIds, sourceById, label);
    const message = boundedPlainText(entry.message, label);
    return { code: opaqueId(entry.code, `${label} code`), message, sourceIds: ids };
  });
  if (task !== "draft_response" && responseDraft !== null) {
    throw new StewardContractError("failed-precondition", "Only the fixed response task may return response text.");
  }
  if (status === "refused" && (options.length || proposedChanges.length || responseDraft)) {
    throw new StewardContractError("failed-precondition", "A refused Steward candidate cannot carry actionable output.");
  }
  if (status === "needs_information" && (proposedChanges.length || responseDraft)) {
    throw new StewardContractError("failed-precondition", "An incomplete Steward candidate cannot carry actionable output.");
  }
  return {
    status,
    facts,
    assumptions,
    questions,
    options,
    proposedChanges,
    responseDraft,
    risks
  };
}

function candidateContent(candidate) {
  return JSON.stringify(candidate);
}

function validateCandidatePolicy(candidate) {
  const findings = inspectStewardContent(candidateContent(candidate));
  const blocked = [
    ...findings.secrets,
    ...findings.sensitivePersonalData,
    ...findings.prohibitedTactics,
    ...findings.providerMutations
  ];
  if (blocked.length) {
    throw new StewardContractError(
      "failed-precondition",
      `Steward candidate violates policy: ${[...new Set(blocked)].join(", ")}.`
    );
  }
}

function buildStewardDecisionPacket({ request, sources, candidate, packetId, nowISO }) {
  const normalizedRequest = normalizeStewardRequest(request);
  const policy = evaluateStewardRequestPolicy(normalizedRequest);
  if (policy.decision === "block") {
    throw new StewardContractError("failed-precondition", `Steward request is blocked: ${policy.reasons.join(", ")}.`);
  }
  const createdAt = exactISO(nowISO, "Steward packet creation time");
  const normalizedSources = normalizeStewardSources(sources, {
    request: normalizedRequest,
    nowISO: createdAt
  });
  const sourceById = new Map(normalizedSources.map((source) => [source.id, source]));
  const normalizedCandidate = normalizeCandidate(candidate, sourceById, normalizedRequest.task);
  validateCandidatePolicy(normalizedCandidate);
  const deterministicPolicyGates = [
    {
      code: "source-contract",
      status: "passed",
      reason: "Every cited handle belongs to the authorized source set and passed tenant, freshness, and revision validation."
    },
    {
      code: "content-policy",
      status: "passed",
      reason: "The validated output contains no detected secret, excluded sensitive category, prohibited tactic, provider action, or unsafe rendering value."
    },
    {
      code: "commercial-provenance",
      status: "passed",
      reason: "Every commercial number in validated output is bound to an authorized deterministic pricing, margin, or Commercial Change source."
    },
    ...(policy.decision === "admin_review"
      ? policy.adminReviewReasons.map((reason) => ({
      code: `admin-review-${reason}`,
      status: "admin_review",
      reason: "This request requires an administrator checkpoint before any existing action path is used."
      }))
      : [])
  ];
  const usedSourceIds = [...new Set([
    ...normalizedCandidate.facts.flatMap((item) => item.sourceIds),
    ...normalizedCandidate.options.flatMap((item) => item.sourceIds),
    ...normalizedCandidate.proposedChanges.flatMap((item) => item.sourceIds),
    ...normalizedCandidate.risks.flatMap((item) => item.sourceIds)
  ])].sort();
  const authorizedSourceIds = normalizedSources.map((source) => source.id).sort();
  const packet = {
    schemaVersion: STEWARD_SCHEMA_VERSION,
    packetId: opaqueId(packetId, "Steward packet ID"),
    requestId: normalizedRequest.requestId,
    task: normalizedRequest.task,
    status: policy.decision === "admin_review" ? "needs_information" : normalizedCandidate.status,
    actor: normalizedRequest.actor,
    scope: {
      organizationId: normalizedRequest.organizationId,
      ...normalizedRequest.scope
    },
    facts: normalizedCandidate.facts,
    assumptions: normalizedCandidate.assumptions,
    questions: normalizedCandidate.questions,
    options: normalizedCandidate.options,
    proposedChanges: normalizedCandidate.proposedChanges,
    responseDraft: normalizedCandidate.responseDraft,
    risks: normalizedCandidate.risks,
    policyGates: deterministicPolicyGates,
    sourceCoverage: {
      authorizedSourceIds,
      usedSourceIds,
      unusedSourceIds: authorizedSourceIds.filter((id) => !usedSourceIds.includes(id))
    },
    createdAt,
    expiresAt: new Date(new Date(createdAt).getTime() + STEWARD_MAX_PACKET_AGE_MS).toISOString()
  };
  return { ...packet, packetDigest: stewardPacketDigest(packet) };
}

function assertStewardDecisionPacketCurrent({ packet, request, expectedPacketDigest, nowISO }) {
  if (!isRecord(packet) || packet.schemaVersion !== STEWARD_SCHEMA_VERSION) {
    throw new StewardContractError("failed-precondition", "Steward packet schema is invalid.");
  }
  const normalizedRequest = normalizeStewardRequest(request);
  const now = new Date(exactISO(nowISO, "Steward packet validation time")).getTime();
  if (
    !/^[a-f0-9]{64}$/u.test(String(expectedPacketDigest || ""))
    || !/^[a-f0-9]{64}$/u.test(String(packet.packetDigest || ""))
    || packet.packetDigest !== expectedPacketDigest
    || packet.packetDigest !== stewardPacketDigest(packet)
  ) {
    throw new StewardContractError("failed-precondition", "Steward packet integrity check failed.");
  }
  if (new Date(packet.expiresAt).getTime() <= now || new Date(packet.createdAt).getTime() > now) {
    throw new StewardContractError("failed-precondition", "Steward packet is expired or not yet valid.");
  }
  if (
    packet.requestId !== normalizedRequest.requestId
    || packet.task !== normalizedRequest.task
    || packet.actor?.uid !== normalizedRequest.actor.uid
    || packet.actor?.role !== normalizedRequest.actor.role
    || packet.scope?.organizationId !== normalizedRequest.organizationId
    || packet.scope?.resourceId !== normalizedRequest.scope.resourceId
    || packet.scope?.baseRevision !== normalizedRequest.scope.baseRevision
    || packet.scope?.catalogRevision !== normalizedRequest.scope.catalogRevision
    || packet.scope?.policyRevision !== normalizedRequest.scope.policyRevision
  ) {
    throw new StewardContractError("failed-precondition", "Steward packet no longer matches current authority.");
  }
  return packet;
}

module.exports = {
  TASK_CHANGE_FIELDS,
  assertStewardDecisionPacketCurrent,
  buildStewardDecisionPacket,
  boundedPlainText,
  normalizeCandidate,
  validateCandidatePolicy
};
