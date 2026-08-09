"use strict";

const MAX_CHANGED_FACTS = 32;
const MAX_DEPENDENT_NODES = 64;
const MAX_OUTPUT_BYTES = 262_144;
const SNAPSHOT_SCHEMA_VERSION = "commercial-change-impact-snapshot-v1";
const RESULT_SCHEMA_VERSION = "commercial-change-impact-v1";
const AUTHORITY = "server_authoritative";
const BOUNDARY =
  "Read-only advisory simulation; it performs no mutation, persistence, authorization, invalidation, regeneration, or publication. REVIEW and STALE classify deterministic dependency exposure only and do not establish actual freshness or any contract, payment, provider, portal, booking, customer-decision, or artifact change. Authorization and reconciliation are required before invalidation, regeneration, publication, or operational use.";

class CommercialChangeImpactEvaluatorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CommercialChangeImpactEvaluatorError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CommercialChangeImpactEvaluatorError(code, message);
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function frozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => frozen(value[key], seen));
  return Object.freeze(value);
}

function createCommercialChangeImpactEvaluator({ graphCore } = {}) {
  if (
    !record(graphCore)
    || typeof graphCore.canonicalSerialize !== "function"
    || typeof graphCore.evaluateCommercialDependencyImpact !== "function"
    || !record(graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1)
  ) {
    fail("failed-precondition", "The canonical Commercial Dependency Graph is required.");
  }
  graphCore.validateCommercialDependencyGraph(graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1);
  const factNodeIds = graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1.nodes
    .filter((node) => node.kind === "fact")
    .map((node) => node.id)
    .sort();

  return function evaluateCommercialChangeImpact(preview = {}) {
    const identity = preview.identity;
    const before = preview.beforeSnapshot;
    const proposed = preview.proposedAfterSnapshot;
    if (!record(identity) || !record(before) || !record(proposed)) {
      fail("invalid-argument", "Commercial change preview snapshots are required.");
    }
    if (
      before.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
      || proposed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
      || before.source?.authority !== AUTHORITY
      || proposed.source?.authority !== AUTHORITY
      || before.source?.organizationId !== identity.organizationId
      || proposed.source?.organizationId !== identity.organizationId
      || before.source?.quoteId !== identity.quoteId
      || proposed.source?.quoteId !== identity.quoteId
      || before.source?.revisionId !== identity.beforeRevisionId
      || proposed.source?.revisionId !== identity.proposedRevisionId
      || before.pricing?.authority !== AUTHORITY
      || proposed.pricing?.authority !== AUTHORITY
      || before.pricing?.currency !== proposed.pricing?.currency
    ) {
      fail("failed-precondition", "Commercial change preview authority is invalid.");
    }
    const beforeFacts = record(before.facts) ? before.facts : {};
    const proposedFacts = record(proposed.facts) ? proposed.facts : {};
    if (
      Object.keys(beforeFacts).length !== factNodeIds.length
      || Object.keys(proposedFacts).length !== factNodeIds.length
      || factNodeIds.some((nodeId) => !Object.hasOwn(beforeFacts, nodeId)
        || !Object.hasOwn(proposedFacts, nodeId))
    ) {
      fail("failed-precondition", "Commercial change preview facts are incomplete.");
    }
    if (
      graphCore.canonicalSerialize(before.protectedEvidence)
      !== graphCore.canonicalSerialize(proposed.protectedEvidence)
    ) {
      fail("failed-precondition", "Protected commercial evidence changed during simulation.");
    }
    const factDiffs = factNodeIds
      .filter((nodeId) => (
        graphCore.canonicalSerialize(beforeFacts[nodeId])
        !== graphCore.canonicalSerialize(proposedFacts[nodeId])
      ))
      .map((nodeId) => ({
        nodeId,
        before: beforeFacts[nodeId],
        proposedAfter: proposedFacts[nodeId]
      }));
    if (factDiffs.length > MAX_CHANGED_FACTS) {
      fail("resource-exhausted", "Commercial change fact differences exceed the bound.");
    }
    const totalChanged = before.pricing.authoritativeTotal
      !== proposed.pricing.authoritativeTotal;
    const depositChanged = before.pricing.depositRequirement
      !== proposed.pricing.depositRequirement;
    const graphImpact = graphCore.evaluateCommercialDependencyImpact({
      registry: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1,
      changedNodeIds: [
        ...factDiffs.map((item) => item.nodeId),
        ...(totalChanged ? ["output.pricing.authoritative_total"] : []),
        ...(depositChanged ? ["output.payment.deposit_requirement"] : [])
      ]
    });
    if (graphImpact.affectedNodes.length > MAX_DEPENDENT_NODES) {
      fail("resource-exhausted", "Commercial change dependencies exceed the bound.");
    }
    const dependentNodes = graphImpact.affectedNodes.map((node) => ({
      ...node,
      advisoryClass: ["artifact", "projection"].includes(node.kind) ? "STALE" : "REVIEW"
    }));
    const result = {
      schemaVersion: RESULT_SCHEMA_VERSION,
      advisory: true,
      identity: { ...identity },
      sources: {
        before: { label: before.source.label, authority: before.source.authority },
        proposedAfter: { label: proposed.source.label, authority: proposed.source.authority }
      },
      graph: {
        graphId: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_ID,
        graphVersion: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_VERSION
      },
      factDiffs,
      commercialValues: {
        currency: before.pricing.currency,
        authoritativeTotal: {
          before: before.pricing.authoritativeTotal,
          proposedAfter: proposed.pricing.authoritativeTotal,
          changed: totalChanged,
          beforeSourceLabel: before.pricing.sourceLabel,
          proposedAfterSourceLabel: proposed.pricing.sourceLabel,
          authority: AUTHORITY
        },
        depositRequirement: {
          before: before.pricing.depositRequirement,
          proposedAfter: proposed.pricing.depositRequirement,
          changed: depositChanged,
          beforeSourceLabel: before.pricing.sourceLabel,
          proposedAfterSourceLabel: proposed.pricing.sourceLabel,
          authority: AUTHORITY
        }
      },
      impact: {
        rootNodeIds: graphImpact.changedNodeIds,
        dependentNodes,
        counts: {
          total: dependentNodes.length,
          review: dependentNodes.filter((node) => node.advisoryClass === "REVIEW").length,
          stale: dependentNodes.filter((node) => node.advisoryClass === "STALE").length
        }
      },
      bounds: {
        declaredFactCount: factNodeIds.length,
        changedFactLimit: MAX_CHANGED_FACTS,
        dependentNodeLimit: MAX_DEPENDENT_NODES,
        outputByteLimit: MAX_OUTPUT_BYTES
      },
      boundary: BOUNDARY
    };
    if (Buffer.byteLength(graphCore.canonicalSerialize(result), "utf8") > MAX_OUTPUT_BYTES) {
      fail("resource-exhausted", "Commercial change result exceeds the output bound.");
    }
    return frozen(result);
  };
}

module.exports = {
  AUTHORITY,
  BOUNDARY,
  CommercialChangeImpactEvaluatorError,
  MAX_CHANGED_FACTS,
  MAX_DEPENDENT_NODES,
  MAX_OUTPUT_BYTES,
  RESULT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  createCommercialChangeImpactEvaluator
};
