"use strict";

const { createHmac } = require("node:crypto");
const {
  STEWARD_TASKS,
  StewardContractError,
  assertExactKeys,
  exactISO,
  opaqueId,
  text
} = require("./contracts.cjs");

const STEWARD_CONTROLS_VERSION = "steward-controls-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const STEWARD_RETENTION_DAYS = Object.freeze({
  run_metadata: 30,
  decision_packet: 30,
  audit_receipt: 395,
  usage_bucket: 395,
  entitlement_receipt: 2555,
  client_memory_fact: 180,
  deletion_receipt: 395,
  policy_version: 2555,
  incident_directive: 395
});
const STEWARD_PRIVATE_COLLECTIONS = Object.freeze([
  "stewardRuns",
  "stewardPackets",
  "stewardAuditReceipts",
  "stewardUsageBuckets",
  "stewardEntitlementReceipts",
  "stewardClientMemory",
  "stewardPolicies",
  "stewardDeletionReceipts",
  "stewardIncidentDirectives"
]);
const AUDIT_OUTCOMES = new Set([
  "completed",
  "blocked",
  "refused",
  "failed",
  "discarded",
  "staged",
  "corrected"
]);
const AUDIT_PROVIDERS = new Set(["none", "openai", "anthropic"]);
const INCIDENT_SCOPES = new Set(["global", "provider", "organization", "task", "model"]);
const INCIDENT_ACTIONS = new Set(["hold", "release"]);
const DELETION_SCOPES = new Set(["organization", "client", "packet", "run"]);

function strictBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new StewardContractError("invalid-argument", `${label} must be explicit.`);
  }
  return value;
}

function boundedInteger(value, label, max = 10_000_000) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > max) {
    throw new StewardContractError("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function exactDigest(value, label) {
  const normalized = text(value, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new StewardContractError("invalid-argument", `${label} must be a SHA-256 digest.`);
  }
  return normalized;
}

function retentionDeadline(input = {}) {
  assertExactKeys(
    input,
    ["kind", "createdAt", "reviewedAt", "explicitExpiresAt"],
    "Steward retention request"
  );
  const kind = text(input.kind, 80).toLowerCase();
  const maxDays = STEWARD_RETENTION_DAYS[kind];
  if (!maxDays) {
    throw new StewardContractError("invalid-argument", "Steward retention kind is unsupported.");
  }
  const createdAt = exactISO(input.createdAt, "Steward record creation time");
  const reviewedAt = input.reviewedAt
    ? exactISO(input.reviewedAt, "Steward record review time")
    : null;
  if (kind === "client_memory_fact" && !reviewedAt) {
    throw new StewardContractError("failed-precondition", "Client memory requires an explicit review time.");
  }
  const retentionAnchor = reviewedAt || createdAt;
  const maximumDeleteAt = new Date(new Date(retentionAnchor).getTime() + maxDays * DAY_MS).toISOString();
  const explicitExpiresAt = input.explicitExpiresAt
    ? exactISO(input.explicitExpiresAt, "Steward explicit expiry")
    : null;
  if (explicitExpiresAt && new Date(explicitExpiresAt).getTime() <= new Date(createdAt).getTime()) {
    throw new StewardContractError("invalid-argument", "Steward expiry must follow record creation.");
  }
  const deleteAt = explicitExpiresAt && explicitExpiresAt < maximumDeleteAt
    ? explicitExpiresAt
    : maximumDeleteAt;
  return Object.freeze({
    policyVersion: STEWARD_CONTROLS_VERSION,
    kind,
    createdAt,
    reviewedAt,
    maxDays,
    deleteAt
  });
}

function digestOpaque(value, auditKey, label) {
  const normalized = text(value, 256);
  if (!normalized) {
    throw new StewardContractError("invalid-argument", `${label} is required.`);
  }
  return createHmac("sha256", auditKey).update(normalized).digest("hex");
}

function buildStewardAuditMetadata({ record = {}, auditKey = "", nowISO = "" } = {}) {
  assertExactKeys(
    record,
    [
      "organizationId", "actorUid", "requestId", "task", "outcome", "packetDigest",
      "modelProvider", "modelSnapshot", "inputTokens", "outputTokens", "blockedReasonCodes"
    ],
    "Steward audit input"
  );
  if (typeof auditKey !== "string" || auditKey.length < 32) {
    throw new StewardContractError("failed-precondition", "Steward audit pseudonymization key is unavailable.");
  }
  const task = text(record.task, 80).toLowerCase();
  const outcome = text(record.outcome, 40).toLowerCase();
  const modelProvider = text(record.modelProvider, 40).toLowerCase();
  if (!STEWARD_TASKS.includes(task) || !AUDIT_OUTCOMES.has(outcome) || !AUDIT_PROVIDERS.has(modelProvider)) {
    throw new StewardContractError("invalid-argument", "Steward audit classification is unsupported.");
  }
  const modelSnapshot = text(record.modelSnapshot, 160);
  if ((modelProvider === "none" && modelSnapshot) || (modelProvider !== "none" && !modelSnapshot)) {
    throw new StewardContractError("invalid-argument", "Steward model evidence is inconsistent.");
  }
  if (!Array.isArray(record.blockedReasonCodes) || record.blockedReasonCodes.length > 16) {
    throw new StewardContractError("invalid-argument", "Steward blocked-reason metadata is invalid.");
  }
  const createdAt = exactISO(nowISO, "Steward audit time");
  const retention = retentionDeadline({
    kind: "audit_receipt",
    createdAt,
    reviewedAt: null,
    explicitExpiresAt: null
  });
  return Object.freeze({
    schemaVersion: STEWARD_CONTROLS_VERSION,
    organizationDigest: digestOpaque(record.organizationId, auditKey, "Steward organization"),
    actorDigest: digestOpaque(record.actorUid, auditKey, "Steward actor"),
    requestDigest: digestOpaque(record.requestId, auditKey, "Steward request"),
    task,
    outcome,
    packetDigest: record.packetDigest ? exactDigest(record.packetDigest, "Steward packet digest") : null,
    modelProvider,
    modelSnapshot: modelSnapshot || null,
    inputTokens: boundedInteger(record.inputTokens, "Steward input tokens"),
    outputTokens: boundedInteger(record.outputTokens, "Steward output tokens"),
    blockedReasonCodes: [...new Set(record.blockedReasonCodes.map((code) => opaqueId(code, "Steward block reason")))].sort(),
    createdAt,
    deleteAt: retention.deleteAt
  });
}

function normalizeStewardControlState(input = {}) {
  assertExactKeys(
    input,
    [
      "policyRevision", "organizationId", "globalEnabled", "providerEnabled",
      "organizationEnabled", "incidentHold", "enabledTasks", "allowedModelSnapshots", "updatedAt"
    ],
    "Steward control state"
  );
  if (!Array.isArray(input.enabledTasks) || input.enabledTasks.length > STEWARD_TASKS.length) {
    throw new StewardContractError("invalid-argument", "Steward enabled-task policy is invalid.");
  }
  const enabledTasks = [...new Set(input.enabledTasks.map((task) => text(task, 80).toLowerCase()))].sort();
  if (enabledTasks.some((task) => !STEWARD_TASKS.includes(task))) {
    throw new StewardContractError("invalid-argument", "Steward enabled-task policy contains an unsupported task.");
  }
  if (!Array.isArray(input.allowedModelSnapshots) || input.allowedModelSnapshots.length > 8) {
    throw new StewardContractError("invalid-argument", "Steward model rollback policy is invalid.");
  }
  return Object.freeze({
    schemaVersion: STEWARD_CONTROLS_VERSION,
    policyRevision: opaqueId(input.policyRevision, "Steward policy revision"),
    organizationId: opaqueId(input.organizationId, "Steward control organization"),
    globalEnabled: strictBoolean(input.globalEnabled, "Steward global gate"),
    providerEnabled: strictBoolean(input.providerEnabled, "Steward provider gate"),
    organizationEnabled: strictBoolean(input.organizationEnabled, "Steward organization gate"),
    incidentHold: strictBoolean(input.incidentHold, "Steward incident hold"),
    enabledTasks,
    allowedModelSnapshots: [...new Set(input.allowedModelSnapshots.map((snapshot) => opaqueId(snapshot, "Steward model snapshot")))].sort(),
    updatedAt: exactISO(input.updatedAt, "Steward control update time")
  });
}

function evaluateStewardExecutionGate({ task = "", organizationId = "", modelSnapshot = "", controls = {} } = {}) {
  const normalized = normalizeStewardControlState(controls);
  const requestedTask = text(task, 80).toLowerCase();
  const requestedOrganization = opaqueId(organizationId, "Steward request organization");
  const requestedModel = text(modelSnapshot, 160);
  const reasons = [];
  if (!normalized.globalEnabled) reasons.push("global_kill");
  if (normalized.incidentHold) reasons.push("incident_hold");
  if (!normalized.providerEnabled) reasons.push("provider_kill");
  if (normalized.organizationId !== requestedOrganization || !normalized.organizationEnabled) {
    reasons.push("organization_kill");
  }
  if (!STEWARD_TASKS.includes(requestedTask) || !normalized.enabledTasks.includes(requestedTask)) {
    reasons.push("task_kill");
  }
  if (!requestedModel || !normalized.allowedModelSnapshots.includes(requestedModel)) {
    reasons.push("model_snapshot_blocked");
  }
  return Object.freeze({
    policyVersion: STEWARD_CONTROLS_VERSION,
    allowed: reasons.length === 0,
    reasons,
    policyRevision: normalized.policyRevision
  });
}

function buildStewardIncidentDirective(input = {}) {
  assertExactKeys(
    input,
    [
      "incidentId", "action", "scope", "target", "reasonCode", "actorRole",
      "recoveryEvidenceDigest", "createdAt"
    ],
    "Steward incident directive"
  );
  const actorRole = text(input.actorRole, 40).toLowerCase();
  const action = text(input.action, 24).toLowerCase();
  const scope = text(input.scope, 40).toLowerCase();
  if (!["admin", "owner"].includes(actorRole) || !INCIDENT_ACTIONS.has(action) || !INCIDENT_SCOPES.has(scope)) {
    throw new StewardContractError("permission-denied", "Steward incident directive is unauthorized or unsupported.");
  }
  const recoveryEvidenceDigest = input.recoveryEvidenceDigest
    ? exactDigest(input.recoveryEvidenceDigest, "Steward recovery evidence")
    : null;
  if (action === "release" && !recoveryEvidenceDigest) {
    throw new StewardContractError("failed-precondition", "Releasing a Steward hold requires recovery evidence.");
  }
  const createdAt = exactISO(input.createdAt, "Steward incident directive time");
  return Object.freeze({
    schemaVersion: STEWARD_CONTROLS_VERSION,
    incidentId: opaqueId(input.incidentId, "Steward incident"),
    action,
    scope,
    target: scope === "global" ? "all" : opaqueId(input.target, "Steward incident target"),
    reasonCode: opaqueId(input.reasonCode, "Steward incident reason"),
    actorRole,
    recoveryEvidenceDigest,
    createdAt,
    deleteAt: retentionDeadline({
      kind: "incident_directive",
      createdAt,
      reviewedAt: null,
      explicitExpiresAt: null
    }).deleteAt
  });
}

function buildStewardDeletionPlan(input = {}) {
  assertExactKeys(
    input,
    ["requestId", "organizationId", "actorDigest", "actorRole", "scope", "targetId", "requestedAt"],
    "Steward deletion request"
  );
  const actorRole = text(input.actorRole, 40).toLowerCase();
  const scope = text(input.scope, 40).toLowerCase();
  if (!["admin", "owner"].includes(actorRole) || !DELETION_SCOPES.has(scope)) {
    throw new StewardContractError("permission-denied", "Steward deletion request is unauthorized or unsupported.");
  }
  if (scope === "organization" && actorRole !== "owner") {
    throw new StewardContractError("permission-denied", "Organization-wide Steward deletion requires owner authority.");
  }
  const targetFieldByScope = {
    organization: "organizationId",
    client: "clientId",
    packet: "packetId",
    run: "runId"
  };
  return Object.freeze({
    schemaVersion: STEWARD_CONTROLS_VERSION,
    requestId: opaqueId(input.requestId, "Steward deletion request"),
    organizationId: opaqueId(input.organizationId, "Steward deletion organization"),
    actorDigest: exactDigest(input.actorDigest, "Steward deletion actor"),
    actorRole,
    scope,
    targetField: targetFieldByScope[scope],
    targetId: opaqueId(input.targetId, "Steward deletion target"),
    collections: scope === "client"
      ? ["stewardClientMemory", "stewardPackets", "stewardAuditReceipts"]
      : [...STEWARD_PRIVATE_COLLECTIONS],
    requestedAt: exactISO(input.requestedAt, "Steward deletion request time"),
    executionAuthority: "trusted_server_only",
    providerDeletionRequired: true
  });
}

module.exports = {
  STEWARD_CONTROLS_VERSION,
  STEWARD_PRIVATE_COLLECTIONS,
  STEWARD_RETENTION_DAYS,
  buildStewardAuditMetadata,
  buildStewardDeletionPlan,
  buildStewardIncidentDirective,
  evaluateStewardExecutionGate,
  normalizeStewardControlState,
  retentionDeadline
};
