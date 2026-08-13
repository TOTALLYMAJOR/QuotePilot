/**
 * Pure, fail-closed contracts for the Ambient Intelligence presentation layer.
 *
 * These builders intentionally perform no I/O and grant no authority. They
 * normalize caller-owned values into deeply frozen snapshots so UI code can
 * reason about context without silently strengthening incomplete evidence.
 */

export const AMBIENT_INTERACTION_PURPOSES = Object.freeze([
  "clarify",
  "advance",
  "resolve",
  "simulate",
  "reveal_context"
]);

export const AMBIENT_SIGNAL_AVAILABILITY_STATES = Object.freeze([
  "available",
  "partial",
  "unavailable",
  "stale",
  "truncated"
]);

export const AMBIENT_SIGNAL_SEVERITIES = Object.freeze([
  "info",
  "attention",
  "warning",
  "blocking"
]);

export const AMBIENT_ACTION_RESULT_KINDS = Object.freeze([
  "context",
  "preview",
  "pending",
  "receipt",
  "resolved",
  "recovery"
]);

export const AMBIENT_ACTION_AUTHORITY_LEVELS = Object.freeze([
  "presentation",
  "draft",
  "trusted",
  "provider",
  "destructive"
]);

export const AMBIENT_ACTION_TARGET_KINDS = Object.freeze([
  "context",
  "route",
  "command",
  "query",
  "draft_mutation",
  "simulation"
]);

export const AMBIENT_CONFIDENCE_LEVELS = Object.freeze([
  "high",
  "medium",
  "low",
  "unavailable"
]);

export const IMPACT_PREVIEW_KINDS = Object.freeze([
  "generic_advisory",
  "client_calculation",
  "server_simulation"
]);

export const IMPACT_PREVIEW_EVIDENCE_AUTHORITIES = Object.freeze([
  "advisory",
  "client_calculated",
  "server_authoritative"
]);

export const OPPORTUNITY_MOMENTUM_DOMAINS = Object.freeze([
  "proposal",
  "commercial",
  "customer",
  "operational"
]);

export const OPPORTUNITY_MOMENTUM_DOMAIN_KINDS = Object.freeze({
  proposal: "proposal_completeness",
  commercial: "commercial_health",
  customer: "customer_state",
  operational: "operational_evidence"
});

export const AMBIENT_NEXT_ACTION_CATEGORIES = Object.freeze([
  "authority_or_safety_blocker",
  "customer_reply_or_approval",
  "deadline",
  "proposal_gap",
  "recommendation"
]);

const MOMENTUM_STATES = Object.freeze([
  "healthy",
  "attention",
  "blocked",
  "unavailable"
]);

const FRESHNESS_STATES = Object.freeze(["fresh", "stale", "unknown"]);
const PROVENANCE_STATES = Object.freeze(["available", "stale", "unavailable"]);
const PREVIEW_STATES = Object.freeze(["available", "partial", "unavailable"]);
const EMPTY_STATE_KINDS = Object.freeze(["caught_up", "starting_action"]);
const PREVIEW_POLICIES = Object.freeze(["none", "optional", "required"]);
const RECEIPT_TYPES = Object.freeze(["none", ...AMBIENT_ACTION_RESULT_KINDS]);
const REVERSIBILITY_KINDS = Object.freeze(["none", "undo", "manual_recovery"]);
const CAPABILITY_MODES = Object.freeze(["ambient", "dual", "legacy"]);

const NEXT_ACTION_CATEGORY_PRIORITY = Object.freeze(
  Object.fromEntries(AMBIENT_NEXT_ACTION_CATEGORIES.map((category, index) => [category, index]))
);

const NEXT_ACTION_SEVERITY_PRIORITY = Object.freeze({
  blocking: 0,
  warning: 1,
  attention: 2,
  info: 3
});

const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class AmbientContractError extends TypeError {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = "AmbientContractError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new AmbientContractError(code, path, message);
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value, path) {
  if (!isPlainRecord(value)) fail("invalid_record", path, "must be a plain object");
  return value;
}

function requiredText(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("required_text", path, "must be a non-empty string");
  }
  return value.trim();
}

function optionalText(value, path) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, path);
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") fail("invalid_boolean", path, "must be a boolean");
  return value;
}

function optionalBoolean(value, fallback, path) {
  return value === undefined ? fallback : requireBoolean(value, path);
}

function requireFiniteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("invalid_number", path, "must be a finite number");
  }
  return value;
}

function requireNonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    fail("invalid_integer", path, "must be a non-negative integer");
  }
  return value;
}

function enumValue(value, allowed, path) {
  const normalized = requiredText(value, path);
  if (!allowed.includes(normalized)) {
    fail("invalid_enum", path, `must be one of: ${allowed.join(", ")}`);
  }
  return normalized;
}

function optionalIsoTimestamp(value, path) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = requiredText(value, path);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) fail("invalid_timestamp", path, "must be an ISO timestamp");
  return new Date(parsed).toISOString();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function cloneJsonValue(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return requireFiniteNumber(value, path);
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneJsonValue(entry, `${path}[${index}]`));
  }
  if (!isPlainRecord(value)) {
    fail("invalid_json_value", path, "must contain only JSON-safe plain values");
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (FORBIDDEN_RECORD_KEYS.has(key)) {
        fail("unsafe_key", `${path}.${key}`, "is not an allowed record key");
      }
      if (entry === undefined) {
        fail("invalid_json_value", `${path}.${key}`, "must not be undefined");
      }
      return [key, cloneJsonValue(entry, `${path}.${key}`)];
    })
  );
}

function stringList(value, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) fail("invalid_list", path, "must be an array");
  const normalized = value.map((entry, index) => requiredText(entry, `${path}[${index}]`));
  if (!allowEmpty && normalized.length === 0) fail("empty_list", path, "must not be empty");
  if (new Set(normalized).size !== normalized.length) {
    fail("duplicate_value", path, "must not contain duplicate values");
  }
  return normalized;
}

function enumList(value, allowed, path, options) {
  const normalized = stringList(value, path, options);
  normalized.forEach((entry, index) => enumValue(entry, allowed, `${path}[${index}]`));
  return normalized;
}

function normalizeObjectRef(value, path) {
  const input = requireRecord(value, path);
  return {
    id: requiredText(input.id, `${path}.id`),
    type: requiredText(input.type, `${path}.type`),
    label: requiredText(input.label, `${path}.label`)
  };
}

function normalizeFreshness(value, path) {
  const input = requireRecord(value, path);
  const state = enumValue(input.state, FRESHNESS_STATES, `${path}.state`);
  const observedAt = optionalIsoTimestamp(input.observedAt, `${path}.observedAt`);
  const reason = optionalText(input.reason, `${path}.reason`);

  if (state === "fresh" && !observedAt) {
    fail("freshness_evidence_missing", `${path}.observedAt`, "is required for fresh evidence");
  }
  if (state === "stale" && (!observedAt || !reason)) {
    fail("freshness_evidence_missing", path, "stale evidence requires observedAt and reason");
  }
  if (state === "unknown" && !reason) {
    fail("freshness_reason_missing", `${path}.reason`, "is required when freshness is unknown");
  }

  return { state, observedAt, reason };
}

function normalizeAvailability(value, path) {
  const input = typeof value === "string" ? { state: value } : requireRecord(value, path);
  const state = enumValue(input.state, AMBIENT_SIGNAL_AVAILABILITY_STATES, `${path}.state`);
  const reason = optionalText(input.reason, `${path}.reason`);
  if (state !== "available" && !reason) {
    fail("availability_reason_missing", `${path}.reason`, `is required when availability is ${state}`);
  }
  return { state, reason };
}

function normalizeProvenance(value, path) {
  const input = requireRecord(value, path);
  const state = enumValue(input.state ?? "available", PROVENANCE_STATES, `${path}.state`);
  const reason = optionalText(input.reason, `${path}.reason`);
  if (state !== "available" && !reason) {
    fail("provenance_reason_missing", `${path}.reason`, `is required when provenance is ${state}`);
  }
  return {
    sourceId: requiredText(input.sourceId, `${path}.sourceId`),
    label: requiredText(input.label, `${path}.label`),
    type: requiredText(input.type, `${path}.type`),
    state,
    observedAt: optionalIsoTimestamp(input.observedAt, `${path}.observedAt`),
    reason
  };
}

function normalizeProvenanceList(value, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) fail("invalid_list", path, "must be an array");
  if (!allowEmpty && value.length === 0) fail("empty_list", path, "must not be empty");
  const entries = value.map((entry, index) => normalizeProvenance(entry, `${path}[${index}]`));
  const ids = entries.map((entry) => entry.sourceId);
  if (new Set(ids).size !== ids.length) fail("duplicate_value", path, "sourceId values must be unique");
  return entries;
}

function normalizeDependency(value, path) {
  const input = requireRecord(value, path);
  return {
    object: normalizeObjectRef(input.object, `${path}.object`),
    relationship: requiredText(input.relationship, `${path}.relationship`),
    consequence: requiredText(input.consequence, `${path}.consequence`)
  };
}

function normalizeDependencies(value, path) {
  if (!Array.isArray(value)) fail("invalid_list", path, "must be an array");
  const dependencies = value.map((entry, index) => normalizeDependency(entry, `${path}[${index}]`));
  const identities = dependencies.map((entry) => `${entry.object.type}:${entry.object.id}`);
  if (new Set(identities).size !== identities.length) {
    fail("duplicate_value", path, "must not contain duplicate object dependencies");
  }
  return dependencies;
}

function normalizeNextResolutions(value, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) fail("invalid_list", path, "must be an array");
  if (!allowEmpty && value.length === 0) fail("empty_list", path, "must not be empty");
  const normalized = value.map((entry, index) => {
    if (typeof entry === "string") {
      const actionId = requiredText(entry, `${path}[${index}]`);
      return { actionId, label: actionId };
    }
    const resolution = requireRecord(entry, `${path}[${index}]`);
    return {
      actionId: requiredText(resolution.actionId, `${path}[${index}].actionId`),
      label: requiredText(resolution.label, `${path}[${index}].label`)
    };
  });
  const ids = normalized.map((entry) => entry.actionId);
  if (new Set(ids).size !== ids.length) fail("duplicate_value", path, "actionId values must be unique");
  return normalized;
}

export function createSurfacePurposeContract(value) {
  const input = requireRecord(value, "SurfacePurposeContract");
  const allowedEmptyState = input.allowedEmptyState == null
    ? null
    : (() => {
        const empty = requireRecord(input.allowedEmptyState, "SurfacePurposeContract.allowedEmptyState");
        const kind = enumValue(
          empty.kind,
          EMPTY_STATE_KINDS,
          "SurfacePurposeContract.allowedEmptyState.kind"
        );
        const actionId = optionalText(
          empty.actionId,
          "SurfacePurposeContract.allowedEmptyState.actionId"
        );
        if (kind === "starting_action" && !actionId) {
          fail(
            "empty_state_action_missing",
            "SurfacePurposeContract.allowedEmptyState.actionId",
            "is required for a starting_action empty state"
          );
        }
        return {
          kind,
          message: requiredText(
            empty.message,
            "SurfacePurposeContract.allowedEmptyState.message"
          ),
          actionId
        };
      })();

  const recovery = requireRecord(
    input.recoveryBehavior,
    "SurfacePurposeContract.recoveryBehavior"
  );

  return deepFreeze({
    id: requiredText(input.id, "SurfacePurposeContract.id"),
    objectScopes: stringList(input.objectScopes, "SurfacePurposeContract.objectScopes"),
    purposes: enumList(
      input.purposes,
      AMBIENT_INTERACTION_PURPOSES,
      "SurfacePurposeContract.purposes"
    ),
    entryReason: requiredText(input.entryReason, "SurfacePurposeContract.entryReason"),
    allowedEmptyState,
    recoveryBehavior: {
      message: requiredText(
        recovery.message,
        "SurfacePurposeContract.recoveryBehavior.message"
      ),
      nextActionIds: stringList(
        recovery.nextActionIds,
        "SurfacePurposeContract.recoveryBehavior.nextActionIds"
      )
    }
  });
}

export function createAmbientContextSnapshot(value) {
  const input = requireRecord(value, "AmbientContextSnapshot");
  let revision = input.revision ?? null;
  if (revision !== null) {
    if (typeof revision === "number") revision = requireNonNegativeInteger(revision, "AmbientContextSnapshot.revision");
    else revision = requiredText(revision, "AmbientContextSnapshot.revision");
  }

  let pendingPreview = null;
  if (input.pendingPreview != null) {
    const pending = requireRecord(input.pendingPreview, "AmbientContextSnapshot.pendingPreview");
    pendingPreview = {
      id: requiredText(pending.id, "AmbientContextSnapshot.pendingPreview.id"),
      object: normalizeObjectRef(pending.object, "AmbientContextSnapshot.pendingPreview.object")
    };
  }

  return deepFreeze({
    organizationId: requiredText(input.organizationId, "AmbientContextSnapshot.organizationId"),
    role: requiredText(input.role, "AmbientContextSnapshot.role"),
    route: requiredText(input.route, "AmbientContextSnapshot.route"),
    activeOpportunityId: optionalText(
      input.activeOpportunityId,
      "AmbientContextSnapshot.activeOpportunityId"
    ),
    selectedObject: input.selectedObject == null
      ? null
      : normalizeObjectRef(input.selectedObject, "AmbientContextSnapshot.selectedObject"),
    revision,
    sourceFreshness: normalizeFreshness(
      input.sourceFreshness,
      "AmbientContextSnapshot.sourceFreshness"
    ),
    pendingPreview
  });
}

export function createAmbientSignal(value) {
  const input = requireRecord(value, "AmbientSignal");
  const availability = normalizeAvailability(input.availability, "AmbientSignal.availability");
  if (!Array.isArray(input.evidence)) {
    fail("invalid_list", "AmbientSignal.evidence", "must be an array");
  }
  const evidence = input.evidence.map((entry, index) => {
    requireRecord(entry, `AmbientSignal.evidence[${index}]`);
    return cloneJsonValue(entry, `AmbientSignal.evidence[${index}]`);
  });
  if (availability.state !== "unavailable" && evidence.length === 0) {
    fail("evidence_missing", "AmbientSignal.evidence", "must not be empty when evidence is usable");
  }

  return deepFreeze({
    id: requiredText(input.id, "AmbientSignal.id"),
    claim: requiredText(input.claim, "AmbientSignal.claim"),
    evidence,
    availability,
    severity: enumValue(input.severity, AMBIENT_SIGNAL_SEVERITIES, "AmbientSignal.severity"),
    consequence: requiredText(input.consequence, "AmbientSignal.consequence"),
    freshness: normalizeFreshness(input.freshness, "AmbientSignal.freshness"),
    resolutionActionIds: stringList(
      input.resolutionActionIds,
      "AmbientSignal.resolutionActionIds"
    )
  });
}

function normalizeArrivalContract(value, path) {
  const input = requireRecord(value, path);
  return {
    object: normalizeObjectRef(input.object, `${path}.object`),
    reason: requiredText(input.reason, `${path}.reason`),
    consequence: requiredText(input.consequence, `${path}.consequence`),
    nextResolutionIds: stringList(input.nextResolutionIds, `${path}.nextResolutionIds`)
  };
}

function normalizeExecutionTarget(value, path) {
  const input = requireRecord(value, path);
  return {
    kind: enumValue(input.kind, AMBIENT_ACTION_TARGET_KINDS, `${path}.kind`),
    targetId: requiredText(input.targetId, `${path}.targetId`),
    surfaceId: requiredText(input.surfaceId, `${path}.surfaceId`)
  };
}

function normalizeReversibility(value, path) {
  const input = requireRecord(value, path);
  const kind = enumValue(input.kind, REVERSIBILITY_KINDS, `${path}.kind`);
  const actionId = optionalText(input.actionId, `${path}.actionId`);
  let windowMs = null;
  if (input.windowMs !== undefined && input.windowMs !== null) {
    windowMs = requireNonNegativeInteger(input.windowMs, `${path}.windowMs`);
    if (windowMs === 0) fail("invalid_undo_window", `${path}.windowMs`, "must be greater than zero");
  }
  if (kind !== "none" && !actionId) {
    fail("recovery_action_missing", `${path}.actionId`, `is required for ${kind}`);
  }
  if (kind === "undo" && windowMs === null) {
    fail("undo_window_missing", `${path}.windowMs`, "is required for undo");
  }
  if (kind === "none" && (actionId || windowMs !== null)) {
    fail("unexpected_recovery", path, "none must not declare an action or window");
  }
  return { kind, actionId, windowMs };
}

export function createAmbientAction(value) {
  const input = requireRecord(value, "AmbientAction");
  const authorityLevel = enumValue(
    input.authorityLevel,
    AMBIENT_ACTION_AUTHORITY_LEVELS,
    "AmbientAction.authorityLevel"
  );
  const receiptType = enumValue(input.receiptType, RECEIPT_TYPES, "AmbientAction.receiptType");
  if (["trusted", "provider", "destructive"].includes(authorityLevel) && receiptType === "none") {
    fail(
      "receipt_required",
      "AmbientAction.receiptType",
      `${authorityLevel} actions must declare a receipt type`
    );
  }
  const enabled = optionalBoolean(input.enabled, true, "AmbientAction.enabled");
  const disabledReason = optionalText(input.disabledReason, "AmbientAction.disabledReason");
  if (!enabled && !disabledReason) {
    fail("disabled_reason_missing", "AmbientAction.disabledReason", "is required when disabled");
  }

  return deepFreeze({
    id: requiredText(input.id, "AmbientAction.id"),
    outcomeLabel: requiredText(input.outcomeLabel, "AmbientAction.outcomeLabel"),
    purpose: enumValue(input.purpose, AMBIENT_INTERACTION_PURPOSES, "AmbientAction.purpose"),
    roles: stringList(input.roles, "AmbientAction.roles"),
    authorityLevel,
    previewPolicy: enumValue(input.previewPolicy, PREVIEW_POLICIES, "AmbientAction.previewPolicy"),
    executionTarget: normalizeExecutionTarget(input.executionTarget, "AmbientAction.executionTarget"),
    receiptType,
    reversibility: normalizeReversibility(input.reversibility, "AmbientAction.reversibility"),
    arrivalContract: normalizeArrivalContract(input.arrivalContract, "AmbientAction.arrivalContract"),
    primary: optionalBoolean(input.primary, false, "AmbientAction.primary"),
    enabled,
    disabledReason
  });
}

export function createAmbientActionResult(value) {
  const input = requireRecord(value, "AmbientActionResult");
  const kind = enumValue(input.kind, AMBIENT_ACTION_RESULT_KINDS, "AmbientActionResult.kind");
  const caughtUp = optionalBoolean(input.caughtUp, false, "AmbientActionResult.caughtUp");
  if (caughtUp && !["context", "resolved"].includes(kind)) {
    fail("invalid_caught_up_result", "AmbientActionResult.caughtUp", "is only valid for context or resolved results");
  }
  const nextResolutions = normalizeNextResolutions(
    input.nextResolutions,
    "AmbientActionResult.nextResolutions",
    { allowEmpty: caughtUp }
  );
  if (!caughtUp && nextResolutions.length === 0) {
    fail(
      "next_resolution_missing",
      "AmbientActionResult.nextResolutions",
      "must contain a recovery or next resolution"
    );
  }
  const payload = input.payload == null
    ? {}
    : cloneJsonValue(requireRecord(input.payload, "AmbientActionResult.payload"), "AmbientActionResult.payload");

  return deepFreeze({
    kind,
    actionId: requiredText(input.actionId, "AmbientActionResult.actionId"),
    object: normalizeObjectRef(input.object, "AmbientActionResult.object"),
    reason: requiredText(input.reason, "AmbientActionResult.reason"),
    consequence: requiredText(input.consequence, "AmbientActionResult.consequence"),
    nextResolutions,
    caughtUp,
    payload
  });
}

export function createSecurityDenialResult(value) {
  const input = requireRecord(value, "SecurityDenialResult");
  return createAmbientActionResult({
    kind: "recovery",
    actionId: input.actionId,
    object: input.object,
    reason: input.reason,
    consequence: input.consequence,
    nextResolutions: input.nextResolutions,
    caughtUp: false,
    payload: {
      recoveryType: "security_denial",
      requiredAuthority: requiredText(
        input.requiredAuthority,
        "SecurityDenialResult.requiredAuthority"
      )
    }
  });
}

function normalizeConfidence(value, path) {
  const input = requireRecord(value, path);
  const level = enumValue(input.level, AMBIENT_CONFIDENCE_LEVELS, `${path}.level`);
  let score = null;
  if (input.score !== undefined && input.score !== null) {
    score = requireFiniteNumber(input.score, `${path}.score`);
    if (score < 0 || score > 1) fail("invalid_confidence", `${path}.score`, "must be between 0 and 1");
  }
  if (level === "unavailable" && score !== null) {
    fail("unavailable_confidence_score", `${path}.score`, "must be omitted when confidence is unavailable");
  }
  return {
    level,
    score,
    basis: requiredText(input.basis, `${path}.basis`)
  };
}

function normalizePermissions(value, path) {
  const input = requireRecord(value, path);
  const permissions = {
    view: requireBoolean(input.view, `${path}.view`),
    simulate: requireBoolean(input.simulate, `${path}.simulate`),
    stage: requireBoolean(input.stage, `${path}.stage`),
    commit: requireBoolean(input.commit, `${path}.commit`),
    reason: optionalText(input.reason, `${path}.reason`)
  };
  if ((!permissions.view || !permissions.simulate || !permissions.stage || !permissions.commit) && !permissions.reason) {
    fail("permission_reason_missing", `${path}.reason`, "is required when an operation is unavailable");
  }
  return permissions;
}

export function createIntelligentObjectDescriptor(value) {
  const input = requireRecord(value, "IntelligentObjectDescriptor");
  let recommendation = null;
  if (input.recommendation != null) {
    const candidate = requireRecord(
      input.recommendation,
      "IntelligentObjectDescriptor.recommendation"
    );
    recommendation = {
      summary: requiredText(
        candidate.summary,
        "IntelligentObjectDescriptor.recommendation.summary"
      ),
      actionId: requiredText(
        candidate.actionId,
        "IntelligentObjectDescriptor.recommendation.actionId"
      )
    };
  }

  return deepFreeze({
    id: requiredText(input.id, "IntelligentObjectDescriptor.id"),
    type: requiredText(input.type, "IntelligentObjectDescriptor.type"),
    label: requiredText(input.label, "IntelligentObjectDescriptor.label"),
    summary: requiredText(input.summary, "IntelligentObjectDescriptor.summary"),
    inspectorSurfaceId: requiredText(
      input.inspectorSurfaceId,
      "IntelligentObjectDescriptor.inspectorSurfaceId"
    ),
    dependencies: normalizeDependencies(
      input.dependencies,
      "IntelligentObjectDescriptor.dependencies"
    ),
    why: requiredText(input.why, "IntelligentObjectDescriptor.why"),
    consequence: requiredText(input.consequence, "IntelligentObjectDescriptor.consequence"),
    doNothing: requiredText(input.doNothing, "IntelligentObjectDescriptor.doNothing"),
    confidence: normalizeConfidence(input.confidence, "IntelligentObjectDescriptor.confidence"),
    provenance: normalizeProvenanceList(
      input.provenance,
      "IntelligentObjectDescriptor.provenance"
    ),
    recommendation,
    permissions: normalizePermissions(
      input.permissions,
      "IntelligentObjectDescriptor.permissions"
    ),
    actionIds: stringList(input.actionIds, "IntelligentObjectDescriptor.actionIds", {
      allowEmpty: true
    })
  });
}

export function createImpactPreview(value) {
  const input = requireRecord(value, "ImpactPreview");
  const previewKind = enumValue(
    input.previewKind ?? "generic_advisory",
    IMPACT_PREVIEW_KINDS,
    "ImpactPreview.previewKind"
  );
  const evidenceAuthority = enumValue(
    input.evidenceAuthority ?? "advisory",
    IMPACT_PREVIEW_EVIDENCE_AUTHORITIES,
    "ImpactPreview.evidenceAuthority"
  );
  const status = enumValue(input.status, PREVIEW_STATES, "ImpactPreview.status");
  const unavailableReasons = stringList(
    input.unavailableReasons ?? [],
    "ImpactPreview.unavailableReasons",
    { allowEmpty: true }
  );
  const warnings = stringList(input.warnings ?? [], "ImpactPreview.warnings", { allowEmpty: true });
  const before = input.before == null
    ? null
    : cloneJsonValue(requireRecord(input.before, "ImpactPreview.before"), "ImpactPreview.before");
  const after = input.after == null
    ? null
    : cloneJsonValue(requireRecord(input.after, "ImpactPreview.after"), "ImpactPreview.after");
  const commercialDeltas = input.commercialDeltas == null
    ? null
    : cloneJsonValue(
        requireRecord(input.commercialDeltas, "ImpactPreview.commercialDeltas"),
        "ImpactPreview.commercialDeltas"
      );
  if (!Array.isArray(input.deltas)) fail("invalid_list", "ImpactPreview.deltas", "must be an array");
  const deltas = input.deltas.map((entry, index) => {
    requireRecord(entry, `ImpactPreview.deltas[${index}]`);
    return cloneJsonValue(entry, `ImpactPreview.deltas[${index}]`);
  });
  const source = normalizeProvenance(input.source, "ImpactPreview.source");
  const provenance = input.provenance == null
    ? [source]
    : normalizeProvenanceList(input.provenance, "ImpactPreview.provenance");
  if (!provenance.some((entry) => entry.sourceId === source.sourceId)) {
    fail(
      "preview_source_not_in_provenance",
      "ImpactPreview.provenance",
      "must include the primary preview source"
    );
  }
  const strictEvidenceContract = previewKind !== "generic_advisory";
  const why = strictEvidenceContract
    ? requiredText(input.why, "ImpactPreview.why")
    : optionalText(input.why, "ImpactPreview.why");
  const consequence = strictEvidenceContract
    ? requiredText(input.consequence, "ImpactPreview.consequence")
    : optionalText(input.consequence, "ImpactPreview.consequence");
  const doNothing = strictEvidenceContract
    ? requiredText(input.doNothing, "ImpactPreview.doNothing")
    : optionalText(input.doNothing, "ImpactPreview.doNothing");
  const confidence = input.confidence == null
    ? null
    : normalizeConfidence(input.confidence, "ImpactPreview.confidence");
  const freshness = input.freshness == null
    ? null
    : normalizeFreshness(input.freshness, "ImpactPreview.freshness");
  const receipt = input.receipt == null
    ? null
    : cloneJsonValue(requireRecord(input.receipt, "ImpactPreview.receipt"), "ImpactPreview.receipt");

  if (strictEvidenceContract && (!confidence || !freshness)) {
    fail(
      "preview_evidence_metadata_missing",
      "ImpactPreview",
      "client and server previews require confidence and freshness"
    );
  }
  if (
    strictEvidenceContract
    && status === "unavailable"
    && (confidence?.level !== "unavailable" || freshness?.state === "fresh")
  ) {
    fail(
      "invalid_unavailable_preview_evidence",
      "ImpactPreview",
      "unavailable previews require unavailable confidence and cannot claim fresh evidence"
    );
  }
  if (
    strictEvidenceContract
    && status === "available"
    && confidence?.level === "unavailable"
  ) {
    fail(
      "invalid_available_preview_confidence",
      "ImpactPreview.confidence",
      "available previews cannot use unavailable confidence"
    );
  }
  if (
    previewKind === "client_calculation"
    && (evidenceAuthority !== "client_calculated" || receipt !== null || status === "available")
  ) {
    fail(
      "invalid_client_preview_authority",
      "ImpactPreview",
      "client calculations must remain partial or unavailable client-calculated evidence without a receipt"
    );
  }
  if (
    previewKind === "server_simulation"
    && (
      evidenceAuthority !== "server_authoritative"
      || (status !== "unavailable" && receipt === null)
    )
  ) {
    fail(
      "invalid_server_preview_authority",
      "ImpactPreview",
      "available or partial server simulations require server-authoritative receipt evidence"
    );
  }
  if (
    previewKind === "generic_advisory"
    && evidenceAuthority !== "advisory"
  ) {
    fail(
      "invalid_generic_preview_authority",
      "ImpactPreview.evidenceAuthority",
      "generic previews cannot claim calculated or server authority"
    );
  }

  if (status === "available" && (!before || !after || unavailableReasons.length > 0)) {
    fail(
      "invalid_available_preview",
      "ImpactPreview",
      "available previews require before and after and no unavailable reasons"
    );
  }
  if (status === "partial" && unavailableReasons.length === 0) {
    fail("partial_reason_missing", "ImpactPreview.unavailableReasons", "must explain partial evidence");
  }
  if (
    status === "unavailable" &&
    (unavailableReasons.length === 0 || after !== null || commercialDeltas !== null || deltas.length > 0)
  ) {
    fail(
      "invalid_unavailable_preview",
      "ImpactPreview",
      "unavailable previews require reasons and must not present after values or deltas"
    );
  }

  let baseRevision = input.baseRevision;
  if (typeof baseRevision === "number") {
    baseRevision = requireNonNegativeInteger(baseRevision, "ImpactPreview.baseRevision");
  } else {
    baseRevision = requiredText(baseRevision, "ImpactPreview.baseRevision");
  }

  return deepFreeze({
    schemaVersion: "ambient-impact-preview-v1",
    id: requiredText(input.id, "ImpactPreview.id"),
    object: normalizeObjectRef(input.object, "ImpactPreview.object"),
    previewKind,
    evidenceAuthority,
    status,
    baseRevision,
    source,
    provenance,
    freshness,
    confidence,
    why,
    consequence,
    doNothing,
    before,
    after,
    deltas,
    commercialDeltas,
    affectedDependencies: normalizeDependencies(
      input.affectedDependencies,
      "ImpactPreview.affectedDependencies"
    ),
    warnings,
    unavailableReasons,
    receipt,
    authority: "advisory",
    requiresAuthoritativeCommit: true
  });
}

function scoreLikeKeys(value) {
  return Object.keys(value).filter((key) => /(score|percent(?:age)?|readiness)/i.test(key));
}

function normalizeMomentumDomain(value, domain, path) {
  const input = requireRecord(value, path);
  const forbiddenMetrics = scoreLikeKeys(input).filter(
    (key) => domain !== "proposal" || key !== "completenessPercent"
  );
  if (forbiddenMetrics.length > 0) {
    fail(
      "fabricated_momentum_score",
      path,
      `only proposal may expose completenessPercent; unsupported metric fields: ${forbiddenMetrics.join(", ")}`
    );
  }
  const state = enumValue(input.state, MOMENTUM_STATES, `${path}.state`);
  const reason = optionalText(input.reason, `${path}.reason`);
  if (state === "unavailable" && !reason) {
    fail("momentum_reason_missing", `${path}.reason`, "is required when momentum is unavailable");
  }
  if (!Array.isArray(input.evidence)) fail("invalid_list", `${path}.evidence`, "must be an array");
  const evidence = input.evidence.map((entry, index) => {
    requireRecord(entry, `${path}.evidence[${index}]`);
    return cloneJsonValue(entry, `${path}.evidence[${index}]`);
  });
  if (state !== "unavailable" && evidence.length === 0) {
    fail("evidence_missing", `${path}.evidence`, "must support an available momentum claim");
  }

  let completenessPercent = null;
  if (domain === "proposal" && input.completenessPercent !== undefined && input.completenessPercent !== null) {
    completenessPercent = requireFiniteNumber(
      input.completenessPercent,
      `${path}.completenessPercent`
    );
    if (completenessPercent < 0 || completenessPercent > 100) {
      fail("invalid_percentage", `${path}.completenessPercent`, "must be between 0 and 100");
    }
  }
  if (domain === "proposal" && state !== "unavailable" && completenessPercent === null) {
    fail(
      "proposal_completeness_missing",
      `${path}.completenessPercent`,
      "is required when proposal evidence is available"
    );
  }
  if (domain === "proposal" && state === "unavailable" && completenessPercent !== null) {
    fail(
      "unavailable_percentage",
      `${path}.completenessPercent`,
      "must be omitted when proposal evidence is unavailable"
    );
  }

  return {
    domain,
    kind: OPPORTUNITY_MOMENTUM_DOMAIN_KINDS[domain],
    state,
    summary: requiredText(input.summary, `${path}.summary`),
    reason,
    evidence,
    ...(domain === "proposal" ? { completenessPercent } : {})
  };
}

function normalizeNextActionCandidate(value, path) {
  const input = requireRecord(value, path);
  const availability = normalizeAvailability(input.availability ?? "available", `${path}.availability`);
  let dueAt = optionalIsoTimestamp(input.dueAt, `${path}.dueAt`);
  const resolutionActionId = optionalText(input.resolutionActionId, `${path}.resolutionActionId`);
  if (availability.state === "available" && !resolutionActionId) {
    fail(
      "resolution_action_missing",
      `${path}.resolutionActionId`,
      "is required for an available next-action candidate"
    );
  }
  return {
    id: requiredText(input.id, `${path}.id`),
    label: requiredText(input.label, `${path}.label`),
    category: enumValue(input.category, AMBIENT_NEXT_ACTION_CATEGORIES, `${path}.category`),
    severity: enumValue(input.severity, AMBIENT_SIGNAL_SEVERITIES, `${path}.severity`),
    object: normalizeObjectRef(input.object, `${path}.object`),
    reason: requiredText(input.reason, `${path}.reason`),
    consequence: requiredText(input.consequence, `${path}.consequence`),
    resolutionActionId,
    dueAt,
    availability
  };
}

function compareNextActions(left, right) {
  const categoryDelta = NEXT_ACTION_CATEGORY_PRIORITY[left.category]
    - NEXT_ACTION_CATEGORY_PRIORITY[right.category];
  if (categoryDelta !== 0) return categoryDelta;
  const severityDelta = NEXT_ACTION_SEVERITY_PRIORITY[left.severity]
    - NEXT_ACTION_SEVERITY_PRIORITY[right.severity];
  if (severityDelta !== 0) return severityDelta;
  const leftDue = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY;
  const rightDue = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY;
  if (leftDue !== rightDue) return leftDue - rightDue;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function normalizeCandidateList(value, path) {
  if (!Array.isArray(value)) fail("invalid_list", path, "must be an array");
  const candidates = value.map((entry, index) => normalizeNextActionCandidate(entry, `${path}[${index}]`));
  const ids = candidates.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length) fail("duplicate_value", path, "candidate ids must be unique");
  return candidates;
}

export function rankAmbientNextActions(value) {
  const candidates = normalizeCandidateList(value, "AmbientNextActionCandidates");
  const ranked = candidates
    .filter((candidate) => candidate.availability.state === "available")
    .sort(compareNextActions)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  return deepFreeze(ranked);
}

export function createOpportunityMomentum(value) {
  const input = requireRecord(value, "OpportunityMomentum");
  const blendedMetrics = scoreLikeKeys(input);
  if (blendedMetrics.length > 0) {
    fail(
      "blended_momentum_forbidden",
      "OpportunityMomentum",
      `must not expose blended score, percentage, or readiness fields: ${blendedMetrics.join(", ")}`
    );
  }
  const domainsInput = requireRecord(input.domains, "OpportunityMomentum.domains");
  const unknownDomains = Object.keys(domainsInput).filter(
    (domain) => !OPPORTUNITY_MOMENTUM_DOMAINS.includes(domain)
  );
  if (unknownDomains.length > 0) {
    fail(
      "unknown_momentum_domain",
      "OpportunityMomentum.domains",
      `contains unsupported domains: ${unknownDomains.join(", ")}`
    );
  }
  const domains = Object.fromEntries(
    OPPORTUNITY_MOMENTUM_DOMAINS.map((domain) => [
      domain,
      normalizeMomentumDomain(
        domainsInput[domain],
        domain,
        `OpportunityMomentum.domains.${domain}`
      )
    ])
  );
  const candidates = normalizeCandidateList(input.candidates, "OpportunityMomentum.candidates");
  const rankedActions = candidates
    .filter((candidate) => candidate.availability.state === "available")
    .sort(compareNextActions)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const unavailableActions = candidates.filter(
    (candidate) => candidate.availability.state !== "available"
  );

  return deepFreeze({
    domains,
    nextAction: rankedActions[0] ?? null,
    moreActions: rankedActions.slice(1),
    unavailableActions,
    nextActionState: rankedActions.length > 0 ? "available" : "unavailable",
    nextActionUnavailableReason: rankedActions.length > 0
      ? null
      : requiredText(
          input.nextActionUnavailableReason,
          "OpportunityMomentum.nextActionUnavailableReason"
        )
  });
}

function normalizeGateMap(value, path) {
  const input = requireRecord(value, path);
  return Object.fromEntries(
    Object.keys(input)
      .sort()
      .map((gateId) => {
        const id = requiredText(gateId, `${path} key`);
        return [id, requireBoolean(input[gateId], `${path}.${id}`)];
      })
  );
}

export function createAmbientCapabilityManifest(value) {
  const input = requireRecord(value, "AmbientCapabilityManifest");
  const schemaVersion = requireNonNegativeInteger(
    input.schemaVersion,
    "AmbientCapabilityManifest.schemaVersion"
  );
  if (schemaVersion === 0) {
    fail("invalid_schema_version", "AmbientCapabilityManifest.schemaVersion", "must be greater than zero");
  }
  const presentationGates = normalizeGateMap(
    input.presentationGates,
    "AmbientCapabilityManifest.presentationGates"
  );
  const authorityGates = normalizeGateMap(
    input.authorityGates,
    "AmbientCapabilityManifest.authorityGates"
  );
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    fail("empty_list", "AmbientCapabilityManifest.capabilities", "must not be empty");
  }
  const capabilities = input.capabilities.map((entry, index) => {
    const path = `AmbientCapabilityManifest.capabilities[${index}]`;
    const capability = requireRecord(entry, path);
    const presentationGateIds = stringList(
      capability.presentationGateIds,
      `${path}.presentationGateIds`,
      { allowEmpty: true }
    );
    const authorityGateIds = stringList(
      capability.authorityGateIds,
      `${path}.authorityGateIds`,
      { allowEmpty: true }
    );
    presentationGateIds.forEach((gateId) => {
      if (!(gateId in presentationGates)) {
        fail("unknown_gate", `${path}.presentationGateIds`, `references undeclared gate ${gateId}`);
      }
    });
    authorityGateIds.forEach((gateId) => {
      if (!(gateId in authorityGates)) {
        fail("unknown_gate", `${path}.authorityGateIds`, `references undeclared gate ${gateId}`);
      }
    });
    return {
      id: requiredText(capability.id, `${path}.id`),
      enabled: requireBoolean(capability.enabled, `${path}.enabled`),
      mode: enumValue(capability.mode, CAPABILITY_MODES, `${path}.mode`),
      presentationGateIds,
      authorityGateIds
    };
  });
  const capabilityIds = capabilities.map((capability) => capability.id);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    fail("duplicate_value", "AmbientCapabilityManifest.capabilities", "capability ids must be unique");
  }

  return deepFreeze({
    schemaVersion,
    ambientShellEnabled: requireBoolean(
      input.ambientShellEnabled,
      "AmbientCapabilityManifest.ambientShellEnabled"
    ),
    presentationGates,
    authorityGates,
    capabilities
  });
}

export function evaluateAmbientCapability(manifestValue, capabilityIdValue) {
  const manifest = createAmbientCapabilityManifest(manifestValue);
  const capabilityId = requiredText(capabilityIdValue, "capabilityId");
  const capability = manifest.capabilities.find((entry) => entry.id === capabilityId);
  if (!capability) {
    return deepFreeze({
      capabilityId,
      available: false,
      reasonCodes: ["capability_not_declared"]
    });
  }

  const reasonCodes = [];
  if (!manifest.ambientShellEnabled) reasonCodes.push("ambient_shell_disabled");
  if (!capability.enabled) reasonCodes.push("capability_disabled");
  capability.presentationGateIds.forEach((gateId) => {
    if (!manifest.presentationGates[gateId]) reasonCodes.push(`presentation_gate_disabled:${gateId}`);
  });
  capability.authorityGateIds.forEach((gateId) => {
    if (!manifest.authorityGates[gateId]) reasonCodes.push(`authority_gate_disabled:${gateId}`);
  });

  return deepFreeze({
    capabilityId,
    available: reasonCodes.length === 0,
    reasonCodes
  });
}
