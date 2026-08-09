import {
  COMMERCIAL_DEPENDENCY_GRAPH_ID,
  COMMERCIAL_DEPENDENCY_GRAPH_V1,
  COMMERCIAL_DEPENDENCY_GRAPH_VERSION,
  canonicalSerialize,
  evaluateCommercialDependencyImpact
} from "./commercialDependencyGraph";

export const COMMERCIAL_CHANGE_IMPACT_SCHEMA_VERSION = "commercial-change-impact-v1";
export const COMMERCIAL_CHANGE_IMPACT_SNAPSHOT_SCHEMA_VERSION =
  "commercial-change-impact-snapshot-v1";
export const COMMERCIAL_CHANGE_IMPACT_AUTHORITY = "server_authoritative";
export const COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS = Object.freeze({
  before: "canonical_quote_revision",
  proposedAfter: "authoritative_proposed_revision",
  beforePricing: "canonical_pricing_snapshot",
  proposedAfterPricing: "authoritative_pricing_preview"
});
export const COMMERCIAL_CHANGE_IMPACT_MAX_SNAPSHOT_BYTES = 131_072;
export const COMMERCIAL_CHANGE_IMPACT_MAX_FACT_BYTES = 16_384;
export const COMMERCIAL_CHANGE_IMPACT_MAX_CHANGED_FACTS = 32;
export const COMMERCIAL_CHANGE_IMPACT_MAX_DEPENDENT_NODES = 64;
export const COMMERCIAL_CHANGE_IMPACT_MAX_OUTPUT_BYTES = 262_144;

export const COMMERCIAL_CHANGE_IMPACT_BOUNDARY =
  "Read-only advisory simulation; it performs no mutation, persistence, authorization, invalidation, regeneration, or publication. REVIEW and STALE classify deterministic dependency exposure only and do not establish actual freshness or any contract, payment, provider, portal, booking, customer-decision, or artifact change. Authorization and reconciliation are required before invalidation, regeneration, publication, or operational use.";

export const COMMERCIAL_CHANGE_IMPACT_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  INVALID_IDENTITY: "invalid_identity",
  SCOPE_MISMATCH: "scope_mismatch",
  REVISION_MISMATCH: "revision_mismatch",
  UNTRUSTED_SOURCE: "untrusted_source",
  UNTRUSTED_PRICING_SOURCE: "untrusted_pricing_source",
  INVALID_SNAPSHOT: "invalid_snapshot",
  INVALID_FACT_SET: "invalid_fact_set",
  PROTECTED_EVIDENCE_CHANGE: "protected_evidence_change",
  BOUNDS_EXCEEDED: "bounds_exceeded"
});

const PROTECTED_EVIDENCE_KEYS = Object.freeze([
  "booking",
  "lifecycle",
  "payment",
  "portal",
  "provider"
]);
const SNAPSHOT_KEYS = Object.freeze([
  "facts",
  "pricing",
  "protectedEvidence",
  "schemaVersion",
  "source"
]);
const SOURCE_KEYS = Object.freeze([
  "authority",
  "label",
  "organizationId",
  "quoteId",
  "revisionId"
]);
const PRICING_KEYS = Object.freeze([
  "authority",
  "authoritativeTotal",
  "currency",
  "depositRequirement",
  "sourceLabel"
]);
const IDENTITY_KEYS = Object.freeze([
  "beforeRevisionId",
  "organizationId",
  "proposedRevisionId",
  "quoteId"
]);

const FACT_NODE_IDS = Object.freeze(
  COMMERCIAL_DEPENDENCY_GRAPH_V1.nodes
    .filter((node) => node.kind === "fact")
    .map((node) => node.id)
    .sort()
);

export class CommercialChangeImpactError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CommercialChangeImpactError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CommercialChangeImpactError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertExactKeys(value, expectedKeys, label, code = COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_SNAPSHOT) {
  if (!isRecord(value)) fail(code, `${label} must be a plain object.`);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code, `${label} must contain exactly: ${expected.join(", ")}.`, {
      actualKeys: actual,
      expectedKeys: expected
    });
  }
}

function exactOpaqueId(value, label) {
  if (typeof value !== "string" || value !== value.trim()) {
    fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_IDENTITY, `${label} must be an exact opaque identifier.`);
  }
  if (
    !value
    || value.length > 256
    || /[\s/?#\\\u0000]/u.test(value)
    || value === "."
    || value === ".."
    || /^[^@\s]+@[^@\s]+$/.test(value)
  ) {
    fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_IDENTITY, `${label} must be an exact opaque identifier.`);
  }
  return value;
}

function canonicalBytes(
  value,
  label,
  maximum,
  invalidCode = COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_SNAPSHOT
) {
  let serialized;
  try {
    serialized = canonicalSerialize(value);
  } catch {
    fail(invalidCode, `${label} is not a canonical JSON value.`);
  }
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > maximum) {
    fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.BOUNDS_EXCEEDED, `${label} exceeds the simulation byte bound.`, {
      byteLength,
      maximum
    });
  }
  return { serialized, byteLength };
}

function canonicalClone(serialized) {
  return JSON.parse(serialized);
}

function normalizeIdentity(identity) {
  canonicalBytes(
    identity,
    "Change-impact identity",
    4096,
    COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_IDENTITY
  );
  assertExactKeys(
    identity,
    IDENTITY_KEYS,
    "Change-impact identity",
    COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_IDENTITY
  );
  return {
    organizationId: exactOpaqueId(identity.organizationId, "organizationId"),
    quoteId: exactOpaqueId(identity.quoteId, "quoteId"),
    beforeRevisionId: exactOpaqueId(identity.beforeRevisionId, "beforeRevisionId"),
    proposedRevisionId: exactOpaqueId(identity.proposedRevisionId, "proposedRevisionId")
  };
}

function validateSource(source, role, identity) {
  assertExactKeys(source, SOURCE_KEYS, `${role} snapshot source`);
  const organizationId = exactOpaqueId(source.organizationId, `${role} source organizationId`);
  const quoteId = exactOpaqueId(source.quoteId, `${role} source quoteId`);
  const revisionId = exactOpaqueId(source.revisionId, `${role} source revisionId`);
  if (organizationId !== identity.organizationId || quoteId !== identity.quoteId) {
    fail(
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.SCOPE_MISMATCH,
      `${role} snapshot does not match the requested organization and quote scope.`
    );
  }
  const expectedRevision = role === "before"
    ? identity.beforeRevisionId
    : identity.proposedRevisionId;
  if (revisionId !== expectedRevision) {
    fail(
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.REVISION_MISMATCH,
      `${role} snapshot does not match the requested revision identity.`
    );
  }
  const expectedLabel = COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS[role];
  if (
    source.authority !== COMMERCIAL_CHANGE_IMPACT_AUTHORITY
    || source.label !== expectedLabel
  ) {
    fail(
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.UNTRUSTED_SOURCE,
      `${role} snapshot must use the declared authoritative source label.`
    );
  }
  return { ...source };
}

function validatePricing(pricing, role) {
  assertExactKeys(pricing, PRICING_KEYS, `${role} pricing snapshot`);
  const expectedLabel = role === "before"
    ? COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.beforePricing
    : COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.proposedAfterPricing;
  if (
    pricing.authority !== COMMERCIAL_CHANGE_IMPACT_AUTHORITY
    || pricing.sourceLabel !== expectedLabel
  ) {
    fail(
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.UNTRUSTED_PRICING_SOURCE,
      `${role} pricing values must come from the declared server-authoritative pricing source.`
    );
  }
  if (typeof pricing.currency !== "string" || !/^[A-Z]{3}$/.test(pricing.currency)) {
    fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_SNAPSHOT, `${role} pricing currency is invalid.`);
  }
  for (const field of ["authoritativeTotal", "depositRequirement"]) {
    const value = pricing[field];
    if (
      typeof value !== "number"
      || !Number.isFinite(value)
      || value < 0
      || Object.is(value, -0)
      || value > 1_000_000_000_000
    ) {
      fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_SNAPSHOT, `${role} pricing ${field} is invalid.`);
    }
  }
  return { ...pricing };
}

function validateFacts(facts, role, identity) {
  assertExactKeys(
    facts,
    FACT_NODE_IDS,
    `${role} declared fact set`,
    COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_FACT_SET
  );
  assertExactKeys(
    facts["fact.quote.identity"],
    ["organizationId", "quoteId"],
    `${role} quote identity fact`,
    COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_IDENTITY
  );
  if (
    facts["fact.quote.identity"].organizationId !== identity.organizationId
    || facts["fact.quote.identity"].quoteId !== identity.quoteId
  ) {
    fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.SCOPE_MISMATCH, `${role} quote identity fact is cross-scope.`);
  }
  if (facts["fact.quote.active_revision"] !== identity.beforeRevisionId) {
    fail(
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.REVISION_MISMATCH,
      `${role} active-revision fact must retain the canonical revision during read-only simulation.`
    );
  }

  const normalized = {};
  const serialized = {};
  let totalBytes = 0;
  FACT_NODE_IDS.forEach((nodeId) => {
    const canonical = canonicalBytes(
      facts[nodeId],
      `${role} fact ${nodeId}`,
      COMMERCIAL_CHANGE_IMPACT_MAX_FACT_BYTES
    );
    totalBytes += canonical.byteLength;
    serialized[nodeId] = canonical.serialized;
    normalized[nodeId] = canonicalClone(canonical.serialized);
  });
  if (totalBytes > COMMERCIAL_CHANGE_IMPACT_MAX_SNAPSHOT_BYTES) {
    fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.BOUNDS_EXCEEDED, `${role} declared facts exceed the snapshot byte bound.`);
  }
  return { normalized, serialized };
}

function validateProtectedEvidence(value, role) {
  assertExactKeys(value, PROTECTED_EVIDENCE_KEYS, `${role} protected evidence`);
  return Object.fromEntries(PROTECTED_EVIDENCE_KEYS.map((key) => {
    const canonical = canonicalBytes(
      value[key],
      `${role} protected evidence ${key}`,
      COMMERCIAL_CHANGE_IMPACT_MAX_FACT_BYTES
    );
    return [key, canonical.serialized];
  }));
}

function validateSnapshot(snapshot, role, identity) {
  assertExactKeys(snapshot, SNAPSHOT_KEYS, `${role} change-impact snapshot`);
  if (snapshot.schemaVersion !== COMMERCIAL_CHANGE_IMPACT_SNAPSHOT_SCHEMA_VERSION) {
    fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_SNAPSHOT, `${role} snapshot schema is unsupported.`);
  }
  canonicalBytes(snapshot, `${role} change-impact snapshot`, COMMERCIAL_CHANGE_IMPACT_MAX_SNAPSHOT_BYTES);
  const source = validateSource(snapshot.source, role, identity);
  const pricing = validatePricing(snapshot.pricing, role);
  const facts = validateFacts(snapshot.facts, role, identity);
  const protectedEvidence = validateProtectedEvidence(snapshot.protectedEvidence, role);
  return { source, pricing, facts, protectedEvidence };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function advisoryClass(kind) {
  return ["artifact", "projection"].includes(kind) ? "STALE" : "REVIEW";
}

function protectedChanges(before, proposedAfter) {
  return PROTECTED_EVIDENCE_KEYS.filter((key) => (
    before.protectedEvidence[key] !== proposedAfter.protectedEvidence[key]
  ));
}

/**
 * Compares two already-authoritative, explicitly source-labeled snapshots.
 * This function performs no I/O, pricing calculation, or state transition.
 */
export function simulateCommercialChangeImpact({
  identity,
  beforeSnapshot,
  proposedAfterSnapshot
} = {}) {
  if (!identity || !beforeSnapshot || !proposedAfterSnapshot) {
    fail(
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_INPUT,
      "Identity plus before and proposed-after snapshots are required."
    );
  }
  const normalizedIdentity = normalizeIdentity(identity);
  const before = validateSnapshot(beforeSnapshot, "before", normalizedIdentity);
  const proposedAfter = validateSnapshot(
    proposedAfterSnapshot,
    "proposedAfter",
    normalizedIdentity
  );
  if (before.pricing.currency !== proposedAfter.pricing.currency) {
    fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_SNAPSHOT, "Pricing currency cannot change in this simulation.");
  }
  const changedProtectedEvidence = protectedChanges(before, proposedAfter);
  if (changedProtectedEvidence.length) {
    fail(
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.PROTECTED_EVIDENCE_CHANGE,
      "Lifecycle, provider, payment, portal, and booking evidence must remain unchanged during simulation.",
      { categories: changedProtectedEvidence }
    );
  }

  const factDiffs = FACT_NODE_IDS
    .filter((nodeId) => before.facts.serialized[nodeId] !== proposedAfter.facts.serialized[nodeId])
    .map((nodeId) => ({
      nodeId,
      before: before.facts.normalized[nodeId],
      proposedAfter: proposedAfter.facts.normalized[nodeId]
    }));
  if (factDiffs.length > COMMERCIAL_CHANGE_IMPACT_MAX_CHANGED_FACTS) {
    fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.BOUNDS_EXCEEDED, "Changed fact count exceeds the simulation bound.");
  }

  const totalChanged = before.pricing.authoritativeTotal
    !== proposedAfter.pricing.authoritativeTotal;
  const depositChanged = before.pricing.depositRequirement
    !== proposedAfter.pricing.depositRequirement;
  const rootNodeIds = [
    ...factDiffs.map((diff) => diff.nodeId),
    ...(totalChanged ? ["output.pricing.authoritative_total"] : []),
    ...(depositChanged ? ["output.payment.deposit_requirement"] : [])
  ];
  const graphImpact = evaluateCommercialDependencyImpact({
    registry: COMMERCIAL_DEPENDENCY_GRAPH_V1,
    changedNodeIds: rootNodeIds
  });
  if (graphImpact.affectedNodes.length > COMMERCIAL_CHANGE_IMPACT_MAX_DEPENDENT_NODES) {
    fail(COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.BOUNDS_EXCEEDED, "Dependent node count exceeds the simulation bound.");
  }
  const dependentNodes = graphImpact.affectedNodes.map((node) => ({
    ...node,
    advisoryClass: advisoryClass(node.kind)
  }));
  const reviewCount = dependentNodes.filter((node) => node.advisoryClass === "REVIEW").length;
  const staleCount = dependentNodes.filter((node) => node.advisoryClass === "STALE").length;

  const result = {
    schemaVersion: COMMERCIAL_CHANGE_IMPACT_SCHEMA_VERSION,
    advisory: true,
    identity: { ...normalizedIdentity },
    sources: {
      before: {
        label: before.source.label,
        authority: before.source.authority
      },
      proposedAfter: {
        label: proposedAfter.source.label,
        authority: proposedAfter.source.authority
      }
    },
    graph: {
      graphId: COMMERCIAL_DEPENDENCY_GRAPH_ID,
      graphVersion: COMMERCIAL_DEPENDENCY_GRAPH_VERSION
    },
    factDiffs,
    commercialValues: {
      currency: before.pricing.currency,
      authoritativeTotal: {
        before: before.pricing.authoritativeTotal,
        proposedAfter: proposedAfter.pricing.authoritativeTotal,
        changed: totalChanged,
        beforeSourceLabel: before.pricing.sourceLabel,
        proposedAfterSourceLabel: proposedAfter.pricing.sourceLabel,
        authority: COMMERCIAL_CHANGE_IMPACT_AUTHORITY
      },
      depositRequirement: {
        before: before.pricing.depositRequirement,
        proposedAfter: proposedAfter.pricing.depositRequirement,
        changed: depositChanged,
        beforeSourceLabel: before.pricing.sourceLabel,
        proposedAfterSourceLabel: proposedAfter.pricing.sourceLabel,
        authority: COMMERCIAL_CHANGE_IMPACT_AUTHORITY
      }
    },
    impact: {
      rootNodeIds: graphImpact.changedNodeIds,
      dependentNodes,
      counts: {
        total: dependentNodes.length,
        review: reviewCount,
        stale: staleCount
      }
    },
    bounds: {
      declaredFactCount: FACT_NODE_IDS.length,
      changedFactLimit: COMMERCIAL_CHANGE_IMPACT_MAX_CHANGED_FACTS,
      dependentNodeLimit: COMMERCIAL_CHANGE_IMPACT_MAX_DEPENDENT_NODES,
      outputByteLimit: COMMERCIAL_CHANGE_IMPACT_MAX_OUTPUT_BYTES
    },
    boundary: COMMERCIAL_CHANGE_IMPACT_BOUNDARY
  };
  canonicalBytes(result, "Change-impact result", COMMERCIAL_CHANGE_IMPACT_MAX_OUTPUT_BYTES);
  return deepFreeze(result);
}

export const COMMERCIAL_CHANGE_IMPACT_FACT_NODE_IDS = FACT_NODE_IDS;
