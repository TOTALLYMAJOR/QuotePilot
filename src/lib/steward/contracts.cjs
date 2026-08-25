"use strict";

const { createHash } = require("node:crypto");

const STEWARD_SCHEMA_VERSION = "steward-decision-packet-v1";
const STEWARD_POLICY_VERSION = "steward-policy-v1";
const STEWARD_TASKS = Object.freeze([
  "setup_menu",
  "configure_workflow",
  "guide_provider_setup",
  "prepare_quote",
  "review_margin",
  "advise_client",
  "draft_response",
  "plan_strategy"
]);
const STEWARD_ROLES = Object.freeze(["sales", "admin", "owner"]);
const STEWARD_SOURCE_TYPES = Object.freeze([
  "quote_record",
  "catalog_record",
  "tenant_policy",
  "customer_or_operator_excerpt",
  "pricing_authority",
  "commercial_change_receipt",
  "margin_authority",
  "workflow_policy",
  "integration_readiness",
  "recorded_client_activity",
  "client_memory_fact",
  "deterministic_rule",
  "model_suggestion_unverified"
]);
const STEWARD_EVIDENCE_CLASSES = Object.freeze([
  "canonical_record",
  "deterministic_result",
  "operator_confirmed",
  "unverified_model"
]);
const STEWARD_PACKET_STATUSES = Object.freeze([
  "ready_for_review",
  "needs_information",
  "refused"
]);
const STEWARD_MAX_SOURCES = 64;
const STEWARD_MAX_PACKET_AGE_MS = 15 * 60 * 1000;

class StewardContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StewardContractError";
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, maxLength = 500) {
  const normalized = String(value ?? "").trim();
  if (normalized.length > maxLength || /[\u0000]/u.test(normalized)) {
    throw new StewardContractError("invalid-argument", "Steward text exceeds its bounded contract.");
  }
  return normalized;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    throw new StewardContractError("invalid-argument", `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new StewardContractError("invalid-argument", `${label} fields are missing or unexpected.`);
  }
}

function opaqueId(value, label) {
  const normalized = text(value, 200);
  if (
    !normalized
    || normalized === "."
    || normalized === ".."
    || /[\s/?#\\@]/u.test(normalized)
  ) {
    throw new StewardContractError("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function exactISO(value, label, { nullable = false } = {}) {
  if (nullable && (value === null || value === "")) return null;
  const normalized = text(value, 64);
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime())) {
    throw new StewardContractError("invalid-argument", `${label} must be an exact timestamp.`);
  }
  return parsed.toISOString();
}

function nullableOpaqueId(value, label) {
  return value === null || value === "" ? null : opaqueId(value, label);
}

function normalizeStewardRequest(input = {}) {
  assertExactKeys(
    input,
    ["requestId", "task", "organizationId", "countryCode", "actor", "brief", "scope"],
    "Steward request"
  );
  assertExactKeys(input.actor, ["uid", "role"], "Steward actor");
  assertExactKeys(
    input.scope,
    ["resourceType", "resourceId", "baseRevision", "catalogRevision", "policyRevision"],
    "Steward scope"
  );
  const task = text(input.task, 80).toLowerCase();
  const role = text(input.actor.role, 40).toLowerCase();
  if (!STEWARD_TASKS.includes(task)) {
    throw new StewardContractError("invalid-argument", "Steward task is unsupported.");
  }
  if (!STEWARD_ROLES.includes(role)) {
    throw new StewardContractError("permission-denied", "Steward actor role is unsupported.");
  }
  const countryCode = text(input.countryCode, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new StewardContractError("invalid-argument", "Steward country code is invalid.");
  }
  const brief = text(input.brief, 4000);
  if (brief.length < 8) {
    throw new StewardContractError("invalid-argument", "Steward request needs a bounded operator brief.");
  }
  return {
    requestId: opaqueId(input.requestId, "Steward request ID"),
    task,
    organizationId: opaqueId(input.organizationId, "Steward organization"),
    countryCode,
    actor: {
      uid: opaqueId(input.actor.uid, "Steward actor"),
      role
    },
    brief,
    scope: {
      resourceType: text(input.scope.resourceType, 80).toLowerCase(),
      resourceId: nullableOpaqueId(input.scope.resourceId, "Steward resource"),
      baseRevision: nullableOpaqueId(input.scope.baseRevision, "Steward base revision"),
      catalogRevision: nullableOpaqueId(input.scope.catalogRevision, "Steward catalog revision"),
      policyRevision: nullableOpaqueId(input.scope.policyRevision, "Steward policy revision")
    }
  };
}

function expectedRevisionForSource(sourceType, scope) {
  if (["catalog_record", "margin_authority"].includes(sourceType)) return scope.catalogRevision;
  if (["tenant_policy", "workflow_policy"].includes(sourceType)) return scope.policyRevision;
  if ([
    "quote_record",
    "pricing_authority",
    "commercial_change_receipt",
    "recorded_client_activity"
  ].includes(sourceType)) return scope.baseRevision;
  return null;
}

function normalizeStewardSources(input, { request, nowISO }) {
  if (!Array.isArray(input) || input.length > STEWARD_MAX_SOURCES) {
    throw new StewardContractError("resource-exhausted", "Steward source count exceeds its bounded contract.");
  }
  const normalizedRequest = normalizeStewardRequest(request);
  const now = new Date(exactISO(nowISO, "Steward source validation time")).getTime();
  const seen = new Set();
  return input.map((source) => {
    assertExactKeys(
      source,
      [
        "id", "type", "organizationId", "resourceId", "field", "revision",
        "observedAt", "expiresAt", "evidenceClass"
      ],
      "Steward source"
    );
    const id = opaqueId(source.id, "Steward source ID");
    if (seen.has(id)) {
      throw new StewardContractError("invalid-argument", "Steward source IDs must be unique.");
    }
    seen.add(id);
    const type = text(source.type, 80).toLowerCase();
    const evidenceClass = text(source.evidenceClass, 80).toLowerCase();
    if (!STEWARD_SOURCE_TYPES.includes(type) || !STEWARD_EVIDENCE_CLASSES.includes(evidenceClass)) {
      throw new StewardContractError("invalid-argument", "Steward source type or evidence class is unsupported.");
    }
    const organizationId = opaqueId(source.organizationId, "Steward source organization");
    if (organizationId !== normalizedRequest.organizationId) {
      throw new StewardContractError("permission-denied", "Steward source is outside the authorized organization.");
    }
    const observedAt = exactISO(source.observedAt, "Steward source observation");
    const expiresAt = exactISO(source.expiresAt, "Steward source expiry", { nullable: true });
    if (new Date(observedAt).getTime() > now || (expiresAt && new Date(expiresAt).getTime() <= now)) {
      throw new StewardContractError("failed-precondition", "Steward source is stale or not yet valid.");
    }
    const revision = nullableOpaqueId(source.revision, "Steward source revision");
    const expectedRevision = expectedRevisionForSource(type, normalizedRequest.scope);
    if (expectedRevision && revision !== expectedRevision) {
      throw new StewardContractError("failed-precondition", "Steward source revision does not match the request fence.");
    }
    if (type === "model_suggestion_unverified" && evidenceClass !== "unverified_model") {
      throw new StewardContractError("failed-precondition", "Model suggestions cannot be upgraded to trusted evidence.");
    }
    return {
      id,
      type,
      organizationId,
      resourceId: nullableOpaqueId(source.resourceId, "Steward source resource"),
      field: text(source.field, 160) || null,
      revision,
      observedAt,
      expiresAt,
      evidenceClass
    };
  });
}

function stableValue(value, depth = 0) {
  if (depth > 12) {
    throw new StewardContractError("resource-exhausted", "Steward value is too deeply nested.");
  }
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new StewardContractError("invalid-argument", "Steward value contains an invalid number.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => stableValue(item, depth + 1));
  if (!isRecord(value)) {
    throw new StewardContractError("invalid-argument", "Steward value must be canonical JSON.");
  }
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key], depth + 1)])
  );
}

function stableSerialize(value) {
  return JSON.stringify(stableValue(value));
}

function stewardPacketDigest(packet) {
  if (!isRecord(packet)) {
    throw new StewardContractError("invalid-argument", "Steward packet is invalid.");
  }
  const { packetDigest: _ignored, ...unsigned } = packet;
  return createHash("sha256").update(stableSerialize(unsigned)).digest("hex");
}

module.exports = {
  STEWARD_SCHEMA_VERSION,
  STEWARD_POLICY_VERSION,
  STEWARD_TASKS,
  STEWARD_ROLES,
  STEWARD_SOURCE_TYPES,
  STEWARD_PACKET_STATUSES,
  STEWARD_MAX_PACKET_AGE_MS,
  StewardContractError,
  assertExactKeys,
  exactISO,
  isRecord,
  normalizeStewardRequest,
  normalizeStewardSources,
  opaqueId,
  stableSerialize,
  stableValue,
  stewardPacketDigest,
  text
};
