"use strict";

const { createHash } = require("node:crypto");

const DECISION_DEBT_POLICY_SCHEMA_VERSION = 1;
const DECISION_DEBT_SCHEMA_VERSION = "decision-debt-snapshot-v1";
const DECISION_DEBT_FORMULA_VERSION = "decision-debt-score-v1";
const DECISION_DEBT_MAX_CANDIDATES = 500;
const DECISION_DEBT_MAX_RESULTS = 100;
const DECISION_DEBT_MAX_ROOT_NODES = 8;
const DECISION_DEBT_MAX_AFFECTED_NODES = 64;
const DECISION_DEBT_MAX_EXPOSURE_CENTS = 1_000_000_000;

const REVERSIBILITY_FACTORS = Object.freeze({
  reversible: 1,
  constrained: 3,
  irreversible: 5
});

const DEFAULT_DECISION_DEBT_POLICY = deepFreeze({
  schemaVersion: DECISION_DEBT_POLICY_SCHEMA_VERSION,
  maxEventHorizonDays: 365,
  decisionTypes: {
    guest_count: {
      label: "Final guest count",
      lockWindowDays: 7,
      dependencyWeight: 5,
      reversibility: "constrained"
    },
    menu: {
      label: "Final menu",
      lockWindowDays: 10,
      dependencyWeight: 4,
      reversibility: "constrained"
    },
    rentals: {
      label: "Rental quantities",
      lockWindowDays: 7,
      dependencyWeight: 4,
      reversibility: "constrained"
    },
    staffing: {
      label: "Staffing plan",
      lockWindowDays: 5,
      dependencyWeight: 4,
      reversibility: "constrained"
    },
    beo_finalization: {
      label: "Kitchen BEO finalization",
      lockWindowDays: 3,
      dependencyWeight: 5,
      reversibility: "irreversible"
    }
  }
});

const DECISION_DEBT_ROOTS_BY_TYPE = deepFreeze({
  guest_count: ["fact.event.guest_count"],
  menu: [
    "fact.event.dietary_constraints",
    "fact.selection.addons",
    "fact.selection.menu",
    "fact.selection.package"
  ],
  rentals: ["fact.selection.rentals"],
  staffing: ["fact.staffing.counts"]
});
const DECISION_DEBT_BEO_NODE_ID = "artifact.kitchen_beo";

class DecisionDebtError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DecisionDebtError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new DecisionDebtError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertExactKeys(value, keys, label) {
  if (!isRecord(value)) fail("invalid-argument", `${label} must be a plain object.`);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(
      "invalid-argument",
      `${label} must contain exactly: ${expected.join(", ")}.`,
      { actualKeys: actual, expectedKeys: expected }
    );
  }
}

function assertRequiredAllowedKeys(value, requiredKeys, optionalKeys, label) {
  if (!isRecord(value)) fail("invalid-argument", `${label} must be a plain object.`);
  const required = new Set(requiredKeys);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const actual = Object.keys(value);
  const missing = [...required].filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  const unexpected = actual.filter((key) => !allowed.has(key));
  if (missing.length || unexpected.length) {
    fail(
      "invalid-argument",
      `${label} has an invalid shape.`,
      { missingKeys: missing.sort(compareText), unexpectedKeys: unexpected.sort(compareText) }
    );
  }
}

function integerInRange(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("invalid-argument", `${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function exactOpaqueId(value, label, maximum = 256) {
  const normalized = cleanText(value);
  if (
    !normalized
    || normalized.length > maximum
    || /[\s/?#\\\u0000]/u.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/.test(normalized)
  ) {
    fail("invalid-argument", `${label} must be an exact opaque identifier.`);
  }
  return normalized;
}

function exactISO(value, label) {
  const normalized = cleanText(value);
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail("invalid-argument", `${label} must be an exact ISO timestamp.`);
  }
  return normalized;
}

function assertGraphCore(graphCore) {
  if (
    !isRecord(graphCore)
    || !isRecord(graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1)
    || typeof graphCore.canonicalSerialize !== "function"
    || typeof graphCore.evaluateCommercialDependencyImpact !== "function"
    || typeof graphCore.validateCommercialDependencyGraph !== "function"
  ) {
    fail(
      "failed-precondition",
      "The canonical Commercial Dependency Graph core must be injected."
    );
  }
  graphCore.validateCommercialDependencyGraph(
    graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1
  );
  return graphCore;
}

function validateTimeZone(value) {
  const timeZone = cleanText(value);
  if (!timeZone || timeZone.length > 100) {
    fail("invalid-argument", "Decision Debt requires a tenant IANA time zone.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    fail("invalid-argument", "Decision Debt tenant time zone is invalid.");
  }
  return timeZone;
}

function dateParts(value, label) {
  const normalized = cleanText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) fail("invalid-argument", `${label} must use YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    fail("invalid-argument", `${label} is not a real calendar date.`);
  }
  return { normalized, year, month, day };
}

function dateOrdinal(value, label) {
  const parsed = dateParts(value, label);
  return Math.floor(Date.UTC(parsed.year, parsed.month - 1, parsed.day) / 86_400_000);
}

function dateFromOrdinal(ordinal) {
  return new Date(ordinal * 86_400_000).toISOString().slice(0, 10);
}

function localDateForInstant(nowISO, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(nowISO));
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return dateParts(
    `${values.year}-${values.month}-${values.day}`,
    "Decision Debt tenant-local date"
  ).normalized;
}

function validateDecisionDebtPolicy(policy) {
  assertExactKeys(
    policy,
    ["schemaVersion", "maxEventHorizonDays", "decisionTypes"],
    "Decision Debt policy"
  );
  if (policy.schemaVersion !== DECISION_DEBT_POLICY_SCHEMA_VERSION) {
    fail("failed-precondition", "Decision Debt policy schema is unsupported.");
  }
  const maxEventHorizonDays = integerInRange(
    policy.maxEventHorizonDays,
    1,
    730,
    "Decision Debt event horizon"
  );
  if (!isRecord(policy.decisionTypes)) {
    fail("invalid-argument", "Decision Debt policy decisionTypes are required.");
  }
  const typeIds = Object.keys(policy.decisionTypes).sort(compareText);
  if (!typeIds.length || typeIds.length > 32) {
    fail("resource-exhausted", "Decision Debt policy must define from 1 to 32 decision types.");
  }
  const decisionTypes = {};
  typeIds.forEach((typeId) => {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(typeId)) {
      fail("invalid-argument", `Decision Debt policy type is invalid: ${typeId}.`);
    }
    const definition = policy.decisionTypes[typeId];
    assertExactKeys(
      definition,
      ["label", "lockWindowDays", "dependencyWeight", "reversibility"],
      `Decision Debt policy type ${typeId}`
    );
    const label = cleanText(definition.label);
    if (!label || label.length > 80) {
      fail("invalid-argument", `Decision Debt policy label is invalid for ${typeId}.`);
    }
    const reversibility = cleanText(definition.reversibility).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(REVERSIBILITY_FACTORS, reversibility)) {
      fail("invalid-argument", `Decision Debt reversibility is invalid for ${typeId}.`);
    }
    decisionTypes[typeId] = {
      label,
      lockWindowDays: integerInRange(
        definition.lockWindowDays,
        0,
        365,
        `Decision Debt lock window for ${typeId}`
      ),
      dependencyWeight: integerInRange(
        definition.dependencyWeight,
        1,
        5,
        `Decision Debt dependency weight for ${typeId}`
      ),
      reversibility
    };
  });
  return deepFreeze({
    schemaVersion: DECISION_DEBT_POLICY_SCHEMA_VERSION,
    maxEventHorizonDays,
    decisionTypes
  });
}

function normalizeExposure(value) {
  if (value === null || value === undefined) return null;
  return integerInRange(
    value,
    0,
    DECISION_DEBT_MAX_EXPOSURE_CENTS,
    "Decision Debt commercial exposure cents"
  );
}

function proximityFactor(daysUntilLock) {
  if (daysUntilLock <= 0) return { value: 5, bucket: "due_or_overdue" };
  if (daysUntilLock <= 3) return { value: 4, bucket: "within_3_days" };
  if (daysUntilLock <= 7) return { value: 3, bucket: "within_7_days" };
  if (daysUntilLock <= 14) return { value: 2, bucket: "within_14_days" };
  return { value: 1, bucket: "beyond_14_days" };
}

function exposureFactor(cents) {
  if (cents === null) return { value: 1, bucket: "unavailable", known: false };
  if (cents === 0) return { value: 1, bucket: "none_recorded", known: true };
  if (cents <= 100_000) return { value: 2, bucket: "up_to_1000", known: true };
  if (cents <= 500_000) return { value: 3, bucket: "up_to_5000", known: true };
  if (cents <= 2_000_000) return { value: 4, bucket: "up_to_20000", known: true };
  return { value: 5, bucket: "over_20000", known: true };
}

function urgencyForScore(score) {
  if (score >= 80) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function normalizeCandidate(candidate, policy, graphCore) {
  assertRequiredAllowedKeys(
    candidate,
    [
      "quoteId",
      "customerId",
      "sourceRevisionId",
      "eventDate",
      "decisionId",
      "decisionType",
      "resolutionState",
      "rootNodeIds",
      "commercialExposureCents"
    ],
    ["affectedNodeIds"],
    "Decision Debt candidate"
  );
  const quoteId = exactOpaqueId(candidate.quoteId, "quoteId");
  const customerId = cleanText(candidate.customerId)
    ? exactOpaqueId(candidate.customerId, "customerId")
    : "";
  const sourceRevisionId = exactOpaqueId(
    candidate.sourceRevisionId,
    "sourceRevisionId"
  );
  const eventDate = dateParts(candidate.eventDate, "Decision Debt eventDate").normalized;
  const decisionId = exactOpaqueId(candidate.decisionId, "decisionId", 160);
  const decisionType = cleanText(candidate.decisionType).toLowerCase();
  const definition = policy.decisionTypes[decisionType];
  if (!definition) {
    fail("failed-precondition", `Decision Debt policy does not define ${decisionType || "the candidate type"}.`);
  }
  const resolutionState = cleanText(candidate.resolutionState).toLowerCase();
  if (!["unresolved", "reopened", "resolved"].includes(resolutionState)) {
    fail("invalid-argument", "Decision Debt resolutionState is invalid.");
  }
  if (
    !Array.isArray(candidate.rootNodeIds)
    || !candidate.rootNodeIds.length
    || candidate.rootNodeIds.length > DECISION_DEBT_MAX_ROOT_NODES
    || candidate.rootNodeIds.some((nodeId) => typeof nodeId !== "string")
  ) {
    fail(
      "invalid-argument",
      `Decision Debt rootNodeIds must contain 1 to ${DECISION_DEBT_MAX_ROOT_NODES} graph nodes.`
    );
  }
  const rootNodeIds = [...new Set(candidate.rootNodeIds)].sort(compareText);
  if (rootNodeIds.length !== candidate.rootNodeIds.length) {
    fail("invalid-argument", "Decision Debt rootNodeIds cannot contain duplicates.");
  }
  let graphImpact;
  try {
    graphImpact = graphCore.evaluateCommercialDependencyImpact({
      registry: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1,
      changedNodeIds: rootNodeIds
    });
  } catch (error) {
    fail("failed-precondition", "Decision Debt candidate contains an unknown graph node.", {
      causeCode: cleanText(error?.code)
    });
  }
  const graphAffectedById = new Map(
    graphImpact.affectedNodes.map((node) => [node.id, node])
  );
  let affectedNodes = graphImpact.affectedNodes;
  if (candidate.affectedNodeIds !== undefined) {
    if (
      !Array.isArray(candidate.affectedNodeIds)
      || !candidate.affectedNodeIds.length
      || candidate.affectedNodeIds.length > DECISION_DEBT_MAX_AFFECTED_NODES
      || candidate.affectedNodeIds.some((nodeId) => typeof nodeId !== "string")
    ) {
      fail(
        "invalid-argument",
        `Decision Debt affectedNodeIds must contain 1 to ${DECISION_DEBT_MAX_AFFECTED_NODES} graph nodes.`
      );
    }
    const requestedAffectedIds = [...new Set(candidate.affectedNodeIds)].sort(compareText);
    if (requestedAffectedIds.length !== candidate.affectedNodeIds.length) {
      fail("invalid-argument", "Decision Debt affectedNodeIds cannot contain duplicates.");
    }
    const outsideImpact = requestedAffectedIds.filter((nodeId) => !graphAffectedById.has(nodeId));
    if (outsideImpact.length) {
      fail(
        "failed-precondition",
        "Decision Debt affectedNodeIds must be unresolved nodes inside the declared graph impact.",
        { outsideImpact }
      );
    }
    affectedNodes = requestedAffectedIds.map((nodeId) => graphAffectedById.get(nodeId));
  }
  if (affectedNodes.length > DECISION_DEBT_MAX_AFFECTED_NODES) {
    fail("resource-exhausted", "Decision Debt dependency impact exceeds its bounded node count.");
  }
  return {
    quoteId,
    customerId,
    sourceRevisionId,
    eventDate,
    decisionId,
    decisionType,
    definition,
    resolutionState,
    rootNodeIds,
    affectedNodes,
    affectedNodesBoundToPersistedState: candidate.affectedNodeIds !== undefined,
    commercialExposureCents: normalizeExposure(candidate.commercialExposureCents)
  };
}

function invalidationState(value) {
  const state = cleanText(value).toLowerCase();
  if (!["open", "reopened", "resolved"].includes(state)) {
    fail(
      "failed-precondition",
      "Decision Debt requires an explicit open, reopened, or resolved invalidation state."
    );
  }
  return state;
}

function normalizePersistedInvalidation(raw, graphCore) {
  if (!isRecord(raw)) {
    fail("failed-precondition", "Decision Debt invalidation evidence must be a server record.");
  }
  const invalidationId = exactOpaqueId(
    raw.invalidationId || raw.id,
    "Decision Debt invalidationId",
    180
  );
  const operationId = exactOpaqueId(raw.operationId, "Decision Debt operationId", 180);
  const sourceRevisionId = exactOpaqueId(
    raw.targetRevisionId,
    "Decision Debt targetRevisionId"
  );
  const nodeId = exactOpaqueId(raw.nodeId, "Decision Debt invalidation nodeId");
  const graphNode = graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1.nodes.find(
    (node) => node.id === nodeId
  );
  if (!graphNode || graphNode.kind !== cleanText(raw.nodeKind).toLowerCase()) {
    fail(
      "failed-precondition",
      "Decision Debt invalidation node is outside the versioned graph contract."
    );
  }
  if (!Array.isArray(raw.triggeredBy) || !raw.triggeredBy.length) {
    fail("failed-precondition", "Decision Debt invalidation must name its triggering graph roots.");
  }
  const triggeredBy = [...new Set(raw.triggeredBy.map((nodeIdValue) => cleanText(nodeIdValue)))]
    .sort(compareText);
  if (
    triggeredBy.length !== raw.triggeredBy.length
    || triggeredBy.some((rootNodeId) => !graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1.nodes.some(
      (candidate) => candidate.id === rootNodeId
    ))
  ) {
    fail(
      "failed-precondition",
      "Decision Debt invalidation triggering graph roots are outside the versioned graph contract."
    );
  }
  return {
    invalidationId,
    operationId,
    sourceRevisionId,
    nodeId,
    nodeKind: graphNode.kind,
    state: invalidationState(raw.state),
    triggeredBy
  };
}

function buildDecisionDebtCandidatesFromInvalidations(input = {}, graphCore) {
  const quoteId = exactOpaqueId(input.quoteId, "quoteId");
  const customerId = cleanText(input.customerId)
    ? exactOpaqueId(input.customerId, "customerId")
    : "";
  const eventDate = dateParts(input.eventDate, "Decision Debt eventDate").normalized;
  const policy = validateDecisionDebtPolicy(input.policy || DEFAULT_DECISION_DEBT_POLICY);
  if (!Array.isArray(input.invalidations)) {
    fail("invalid-argument", "Decision Debt invalidations must be an array.");
  }
  if (input.invalidations.length > DECISION_DEBT_MAX_CANDIDATES) {
    fail(
      "resource-exhausted",
      `Decision Debt accepts at most ${DECISION_DEBT_MAX_CANDIDATES} invalidation records.`
    );
  }
  const openInvalidations = input.invalidations
    .map((raw) => normalizePersistedInvalidation(raw, graphCore))
    .filter((invalidation) => invalidation.state !== "resolved");
  const grouped = new Map();

  const addToGroup = (decisionType, invalidation, matchingRoots) => {
    if (!policy.decisionTypes[decisionType] || !matchingRoots.length) return;
    const key = `${invalidation.operationId}\u0000${invalidation.sourceRevisionId}\u0000${decisionType}`;
    const current = grouped.get(key) || {
      operationId: invalidation.operationId,
      sourceRevisionId: invalidation.sourceRevisionId,
      decisionType,
      resolutionState: "unresolved",
      rootNodeIds: new Set(),
      affectedNodeIds: new Set()
    };
    matchingRoots.forEach((rootNodeId) => current.rootNodeIds.add(rootNodeId));
    current.affectedNodeIds.add(invalidation.nodeId);
    if (invalidation.state === "reopened") current.resolutionState = "reopened";
    grouped.set(key, current);
  };

  openInvalidations.forEach((invalidation) => {
    Object.entries(DECISION_DEBT_ROOTS_BY_TYPE).forEach(([decisionType, configuredRoots]) => {
      const configured = new Set(configuredRoots);
      addToGroup(
        decisionType,
        invalidation,
        invalidation.triggeredBy.filter((rootNodeId) => configured.has(rootNodeId))
      );
    });
    if (invalidation.nodeId === DECISION_DEBT_BEO_NODE_ID) {
      addToGroup("beo_finalization", invalidation, invalidation.triggeredBy);
    }
  });

  return [...grouped.values()]
    .sort((left, right) => (
      compareText(left.sourceRevisionId, right.sourceRevisionId)
      || compareText(left.operationId, right.operationId)
      || compareText(left.decisionType, right.decisionType)
    ))
    .map((group) => {
      const rootNodeIds = [...group.rootNodeIds].sort(compareText);
      const affectedNodeIds = [...group.affectedNodeIds].sort(compareText);
      if (rootNodeIds.length > DECISION_DEBT_MAX_ROOT_NODES) {
        fail(
          "resource-exhausted",
          "Decision Debt triggering facts exceed the bounded root-node count."
        );
      }
      return {
        quoteId,
        customerId,
        sourceRevisionId: group.sourceRevisionId,
        eventDate,
        decisionId: `dependency-${group.operationId}-${group.decisionType}`,
        decisionType: group.decisionType,
        resolutionState: group.resolutionState,
        rootNodeIds,
        affectedNodeIds,
        commercialExposureCents: input.commercialExposureCents ?? null
      };
    });
}

function debtIdentity(candidate, graphCore) {
  const canonical = graphCore.canonicalSerialize({
    schemaVersion: DECISION_DEBT_SCHEMA_VERSION,
    quoteId: candidate.quoteId,
    decisionId: candidate.decisionId,
    sourceRevisionId: candidate.sourceRevisionId
  });
  return `debt_${createHash("sha256").update(canonical).digest("hex").slice(0, 40)}`;
}

function buildDebtItem(candidate, { today, graphCore }) {
  const todayOrdinal = dateOrdinal(today, "Decision Debt tenant-local date");
  const eventOrdinal = dateOrdinal(candidate.eventDate, "Decision Debt eventDate");
  const eventDaysAway = eventOrdinal - todayOrdinal;
  const lockOrdinal = eventOrdinal - candidate.definition.lockWindowDays;
  const lockDate = dateFromOrdinal(lockOrdinal);
  const daysUntilLock = lockOrdinal - todayOrdinal;
  const proximity = proximityFactor(daysUntilLock);
  const exposure = exposureFactor(candidate.commercialExposureCents);
  const reversibilityValue = REVERSIBILITY_FACTORS[candidate.definition.reversibility];
  const rawScore = candidate.definition.dependencyWeight
    * proximity.value
    * exposure.value
    * reversibilityValue;
  const score = Math.min(100, Math.max(0, Math.round((rawScore / 625) * 100)));
  const affectedNodeIds = candidate.affectedNodes.map((node) => node.id);
  return {
    id: debtIdentity(candidate, graphCore),
    quoteId: candidate.quoteId,
    customerId: candidate.customerId,
    sourceRevisionId: candidate.sourceRevisionId,
    decisionId: candidate.decisionId,
    decisionType: candidate.decisionType,
    label: candidate.definition.label,
    resolutionState: candidate.resolutionState,
    eventDate: candidate.eventDate,
    eventDaysAway,
    lockDate,
    daysUntilLock,
    rootNodeIds: candidate.rootNodeIds,
    affectedNodeIds,
    affectedDependencyCount: affectedNodeIds.length,
    commercialExposureCents: candidate.commercialExposureCents,
    factors: {
      dependency: {
        value: candidate.definition.dependencyWeight,
        affectedDependencyCount: affectedNodeIds.length,
        source: candidate.affectedNodesBoundToPersistedState
          ? "persisted_unresolved_invalidations_and_versioned_graph"
          : "validated_tenant_policy_and_versioned_graph"
      },
      proximity: {
        value: proximity.value,
        bucket: proximity.bucket,
        lockWindowDays: candidate.definition.lockWindowDays,
        lockDate,
        daysUntilLock,
        source: "tenant_local_calendar"
      },
      exposure: {
        value: exposure.value,
        bucket: exposure.bucket,
        known: exposure.known,
        cents: candidate.commercialExposureCents,
        source: "bounded_authoritative_commercial_delta"
      },
      reversibility: {
        value: reversibilityValue,
        classification: candidate.definition.reversibility,
        source: "validated_tenant_policy"
      }
    },
    rawScore,
    score,
    urgency: urgencyForScore(score),
    explanation: [
      `${affectedNodeIds.length} graph dependenc${affectedNodeIds.length === 1 ? "y" : "ies"} remain exposed.`,
      daysUntilLock <= 0
        ? `The ${candidate.definition.lockWindowDays}-day lock window is due or overdue.`
        : `${daysUntilLock} tenant-local day${daysUntilLock === 1 ? "" : "s"} remain until the lock window.`,
      exposure.known
        ? `Recorded commercial exposure is ${candidate.commercialExposureCents} cents.`
        : "Commercial exposure is unavailable and is not coerced to zero.",
      `Score ${score}/100 uses ${DECISION_DEBT_FORMULA_VERSION}; it is deterministic, not predictive AI.`
    ]
  };
}

function compareDebtItems(left, right) {
  return right.score - left.score
    || left.daysUntilLock - right.daysUntilLock
    || compareText(left.eventDate, right.eventDate)
    || compareText(left.quoteId, right.quoteId)
    || compareText(left.decisionId, right.decisionId);
}

function deriveDecisionDebtSnapshot({
  candidates = [],
  policy = DEFAULT_DECISION_DEBT_POLICY,
  nowISO,
  tenantTimeZone,
  limit = 50
}, graphCore) {
  if (!Array.isArray(candidates)) {
    fail("invalid-argument", "Decision Debt candidates must be an array.");
  }
  if (candidates.length > DECISION_DEBT_MAX_CANDIDATES) {
    fail(
      "resource-exhausted",
      `Decision Debt accepts at most ${DECISION_DEBT_MAX_CANDIDATES} candidates.`
    );
  }
  const normalizedPolicy = validateDecisionDebtPolicy(policy);
  const observedAtISO = exactISO(nowISO, "Decision Debt observation time");
  const timeZone = validateTimeZone(tenantTimeZone);
  const resultLimit = integerInRange(limit, 1, DECISION_DEBT_MAX_RESULTS, "Decision Debt result limit");
  const today = localDateForInstant(observedAtISO, timeZone);
  const todayOrdinal = dateOrdinal(today, "Decision Debt tenant-local date");
  const skippedCounts = {
    resolved: 0,
    pastEvent: 0,
    beyondHorizon: 0,
    noAffectedDependencies: 0
  };
  const identities = new Set();
  const eligibleItems = [];
  candidates.forEach((candidate) => {
    const normalized = normalizeCandidate(candidate, normalizedPolicy, graphCore);
    const identity = `${normalized.quoteId}\u0000${normalized.decisionId}\u0000${normalized.sourceRevisionId}`;
    if (identities.has(identity)) {
      fail("already-exists", "Decision Debt candidate identity is duplicated.");
    }
    identities.add(identity);
    if (normalized.resolutionState === "resolved") {
      skippedCounts.resolved += 1;
      return;
    }
    const eventDaysAway = dateOrdinal(normalized.eventDate, "Decision Debt eventDate") - todayOrdinal;
    if (eventDaysAway < 0) {
      skippedCounts.pastEvent += 1;
      return;
    }
    if (eventDaysAway > normalizedPolicy.maxEventHorizonDays) {
      skippedCounts.beyondHorizon += 1;
      return;
    }
    if (!normalized.affectedNodes.length) {
      skippedCounts.noAffectedDependencies += 1;
      return;
    }
    eligibleItems.push(buildDebtItem(normalized, { today, graphCore }));
  });
  eligibleItems.sort(compareDebtItems);
  const items = eligibleItems.slice(0, resultLimit);
  const snapshot = {
    schemaVersion: DECISION_DEBT_SCHEMA_VERSION,
    formulaVersion: DECISION_DEBT_FORMULA_VERSION,
    authority: "server_derived",
    predictive: false,
    observedAtISO,
    tenantTimeZone: timeZone,
    tenantLocalDate: today,
    graph: {
      graphId: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1.graphId,
      graphVersion: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1.graphVersion
    },
    policy: normalizedPolicy,
    bounds: {
      candidateLimit: DECISION_DEBT_MAX_CANDIDATES,
      candidateCount: candidates.length,
      eligibleCount: eligibleItems.length,
      resultLimit,
      returnedCount: items.length,
      truncated: eligibleItems.length > items.length,
      maxAffectedNodesPerDecision: DECISION_DEBT_MAX_AFFECTED_NODES,
      maxCommercialExposureCents: DECISION_DEBT_MAX_EXPOSURE_CENTS,
      skippedCounts
    },
    items
  };
  const digest = createHash("sha256")
    .update(graphCore.canonicalSerialize(snapshot))
    .digest("hex");
  return deepFreeze({ ...snapshot, snapshotDigest: digest });
}

function createDecisionDebtAuthority({ graphCore } = {}) {
  const core = assertGraphCore(graphCore);
  return Object.freeze({
    deriveSnapshot: (input) => deriveDecisionDebtSnapshot(input, core),
    buildCandidatesFromInvalidations: (input) => (
      buildDecisionDebtCandidatesFromInvalidations(input, core)
    ),
    validatePolicy: validateDecisionDebtPolicy
  });
}

module.exports = {
  DECISION_DEBT_FORMULA_VERSION,
  DECISION_DEBT_MAX_AFFECTED_NODES,
  DECISION_DEBT_MAX_CANDIDATES,
  DECISION_DEBT_MAX_EXPOSURE_CENTS,
  DECISION_DEBT_MAX_RESULTS,
  DECISION_DEBT_POLICY_SCHEMA_VERSION,
  DECISION_DEBT_SCHEMA_VERSION,
  DEFAULT_DECISION_DEBT_POLICY,
  DECISION_DEBT_ROOTS_BY_TYPE,
  DecisionDebtError,
  REVERSIBILITY_FACTORS,
  createDecisionDebtAuthority
};
