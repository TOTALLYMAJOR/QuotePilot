import { httpsCallable } from "firebase/functions";
import {
  COMMERCIAL_DEPENDENCY_GRAPH_ID,
  COMMERCIAL_DEPENDENCY_GRAPH_VERSION
} from "./commercialDependencyGraph";
import { cloudFunctions, firebaseReady } from "./firebase";

export const COMMERCIAL_CHANGE_AUTHORITY_CALLABLES = Object.freeze({
  simulate: "simulateCommercialQuoteChange",
  requestApproval: "requestCommercialQuoteChangeAuthorization",
  getApprovalState: "getCommercialQuoteChangeAuthorizationState",
  authorize: "authorizeCommercialQuoteChange",
  getDependencyState: "getCommercialDependencyState",
  reconcile: "reconcileCommercialDependencyState"
});

const REQUEST_ID_PREFIXES = Object.freeze({
  simulation: "change_sim",
  approval: "change_auth_request",
  authorization: "change_auth",
  apply: "change_apply",
  reconciliation: "change_reconcile"
});
const REQUEST_ID_PATTERNS = Object.freeze(Object.fromEntries(
  Object.entries(REQUEST_ID_PREFIXES).map(([kind, prefix]) => [
    kind,
    new RegExp(`^${prefix}_[a-f0-9]{32}$`, "u")
  ])
));
const RECEIPT_ID_PATTERNS = Object.freeze({
  simulation: /^ccs_[a-f0-9]{48}$/u,
  authorization: /^cca_[a-f0-9]{48}$/u,
  apply: /^ccp_[a-f0-9]{48}$/u,
  invalidation: /^cci_[a-f0-9]{48}$/u,
  reconciliation: /^ccr_[a-f0-9]{48}$/u,
  approval: /^ccar_[a-f0-9]{48}$/u,
  operation: /^cco_[a-f0-9]{48}$/u
});
const RECEIPT_SCHEMA_VERSIONS = Object.freeze({
  simulation: "commercial-change-simulation-receipt-v1",
  authorization: "commercial-change-authorization-receipt-v1",
  reconciliation: "commercial-change-reconciliation-receipt-v1"
});
const MAX_INVALIDATIONS = 64;
const MAX_JSON_BYTES = 262_144;
const DEFINITIVE_ERROR_CODES = new Set([
  "aborted",
  "already-exists",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "resource-exhausted",
  "unauthenticated"
]);

export class CommercialChangeAuthorityClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CommercialChangeAuthorityClientError";
    this.code = code;
  }
}

function fail(message, code = "invalid-server-response") {
  throw new CommercialChangeAuthorityClientError(code, message);
}

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value, expectedKeys, label) {
  if (!record(value)) fail(`${label} must be an exact server object.`);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} did not match the exact server contract.`);
  }
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function jsonClone(value, label, {
  maximum = MAX_JSON_BYTES,
  code = "invalid-server-response"
} = {}) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail(`${label} must be bounded JSON data.`, code);
  }
  if (serialized === undefined) fail(`${label} must be bounded JSON data.`, code);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > maximum) fail(`${label} exceeds the bounded client contract.`, code);
  return JSON.parse(serialized);
}

function exactOpaqueId(value, label, maximum = 256, code = "invalid-argument") {
  const normalized = text(value);
  if (
    !normalized
    || normalized.length > maximum
    || /[\s/?#\\\u0000]/u.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/u.test(normalized)
  ) {
    fail(`${label} must be an exact opaque identifier.`, code);
  }
  return normalized;
}

function optionalOpaqueId(value, label, maximum = 256) {
  const normalized = text(value);
  return normalized ? exactOpaqueId(normalized, label, maximum, "invalid-server-response") : "";
}

function exactRequestId(value, kind) {
  const normalized = text(value).toLowerCase();
  if (!REQUEST_ID_PATTERNS[kind]?.test(normalized)) {
    fail(`${kind} requestId is invalid.`, "invalid-argument");
  }
  return normalized;
}

function receiptId(value, kind, { optional = false } = {}) {
  const normalized = text(value).toLowerCase();
  if (optional && !normalized) return "";
  if (!RECEIPT_ID_PATTERNS[kind]?.test(normalized)) {
    fail(`The ${kind} receipt identity is invalid.`);
  }
  return normalized;
}

function inputReceiptId(value, kind) {
  try {
    return receiptId(value, kind);
  } catch (error) {
    if (error instanceof CommercialChangeAuthorityClientError) {
      throw new CommercialChangeAuthorityClientError("invalid-argument", error.message);
    }
    throw error;
  }
}

function digest(value, label) {
  const normalized = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) fail(`${label} is invalid.`);
  return normalized;
}

function exactISO(value, label, { optional = false } = {}) {
  const normalized = text(value);
  if (optional && !normalized) return "";
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail(`${label} is not an exact server timestamp.`);
  }
  return normalized;
}

function exactBoolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be a server boolean.`);
  return value;
}

function boundedInteger(value, label, maximum = 1_000_000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail(`${label} is outside the server bound.`);
  }
  return value;
}

function boundedNumber(value, label) {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || Object.is(value, -0)
    || value > 1_000_000_000_000
  ) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function exactEmail(value, label, { optional = false } = {}) {
  const normalized = text(value).toLowerCase();
  if (optional && !normalized) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) || normalized.length > 320) {
    fail(`${label} is invalid.`);
  }
  return normalized;
}

function exactRole(value, label, { optional = false, adminOnly = false } = {}) {
  const normalized = text(value).toLowerCase();
  if (optional && !normalized) return "";
  if (!["admin", "sales"].includes(normalized) || (adminOnly && normalized !== "admin")) {
    fail(`${label} is invalid.`);
  }
  return normalized;
}

function exactActor(value, label, { adminOnly = false } = {}) {
  exactKeys(value, ["uid", "email", "role"], label);
  const uid = text(value.uid);
  if (!uid || uid.length > 128) fail(`${label} uid is invalid.`);
  return {
    uid,
    email: exactEmail(value.email, `${label} email`),
    role: exactRole(value.role, `${label} role`, { adminOnly })
  };
}

function projectedActor(value, label, { optional = false, adminOnly = false } = {}) {
  exactKeys(value, ["email", "role"], label);
  const email = exactEmail(value.email, `${label} email`, { optional });
  const role = exactRole(value.role, `${label} role`, { optional, adminOnly });
  if (Boolean(email) !== Boolean(role)) fail(`${label} is incomplete.`);
  return { email, role };
}

function exactGraph(value, label) {
  exactKeys(value, ["graphId", "graphVersion"], label);
  if (
    value.graphId !== COMMERCIAL_DEPENDENCY_GRAPH_ID
    || value.graphVersion !== COMMERCIAL_DEPENDENCY_GRAPH_VERSION
  ) {
    fail(`${label} does not match the current Commercial Dependency Graph.`);
  }
  return {
    graphId: value.graphId,
    graphVersion: value.graphVersion
  };
}

function exactText(value, label, maximum = 4_096, { optional = false } = {}) {
  const normalized = text(value);
  if (optional && !normalized) return "";
  if (!normalized || normalized.length > maximum) fail(`${label} is invalid.`);
  return normalized;
}

function uniqueOpaqueList(value, label, maximum = MAX_INVALIDATIONS) {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} is invalid.`);
  const normalized = value.map((item, index) => (
    exactOpaqueId(item, `${label}[${index}]`, 256, "invalid-server-response")
  ));
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicates.`);
  return normalized;
}

function normalizeFactDiffs(value) {
  if (!Array.isArray(value) || value.length > 32) fail("Commercial fact differences are invalid.");
  const diffs = value.map((item, index) => {
    exactKeys(item, ["nodeId", "before", "proposedAfter"], `Fact difference ${index}`);
    return {
      nodeId: exactOpaqueId(
        item.nodeId,
        `Fact difference ${index} nodeId`,
        256,
        "invalid-server-response"
      ),
      before: jsonClone(item.before, `Fact difference ${index} before`, { maximum: 16_384 }),
      proposedAfter: jsonClone(
        item.proposedAfter,
        `Fact difference ${index} proposed value`,
        { maximum: 16_384 }
      )
    };
  });
  if (new Set(diffs.map((item) => item.nodeId)).size !== diffs.length) {
    fail("Commercial fact differences contain duplicate nodes.");
  }
  return diffs;
}

function normalizeCommercialValue(value, label) {
  exactKeys(value, [
    "before",
    "proposedAfter",
    "changed",
    "beforeSourceLabel",
    "proposedAfterSourceLabel",
    "authority"
  ], label);
  const before = boundedNumber(value.before, `${label} before`);
  const proposedAfter = boundedNumber(value.proposedAfter, `${label} proposed value`);
  const changed = exactBoolean(value.changed, `${label} changed`);
  if (changed !== (before !== proposedAfter) || value.authority !== "server_authoritative") {
    fail(`${label} authority or change flag is invalid.`);
  }
  return {
    before,
    proposedAfter,
    changed,
    beforeSourceLabel: exactText(value.beforeSourceLabel, `${label} before source`, 128),
    proposedAfterSourceLabel: exactText(
      value.proposedAfterSourceLabel,
      `${label} proposed source`,
      128
    ),
    authority: "server_authoritative"
  };
}

function normalizeCommercialValues(value) {
  exactKeys(
    value,
    ["currency", "authoritativeTotal", "depositRequirement"],
    "Commercial values"
  );
  if (!/^[A-Z]{3}$/u.test(text(value.currency))) fail("Commercial currency is invalid.");
  return {
    currency: value.currency,
    authoritativeTotal: normalizeCommercialValue(
      value.authoritativeTotal,
      "Authoritative total"
    ),
    depositRequirement: normalizeCommercialValue(
      value.depositRequirement,
      "Deposit requirement"
    )
  };
}

function normalizeImpactCounts(value, dependentNodes) {
  exactKeys(value, ["total", "review", "stale"], "Commercial impact counts");
  const total = boundedInteger(value.total, "Commercial impact total", MAX_INVALIDATIONS);
  const review = boundedInteger(value.review, "Commercial impact review count", MAX_INVALIDATIONS);
  const stale = boundedInteger(value.stale, "Commercial impact stale count", MAX_INVALIDATIONS);
  if (
    total !== dependentNodes.length
    || review !== dependentNodes.filter((item) => item.classification === "REVIEW").length
    || stale !== dependentNodes.filter((item) => item.classification === "STALE").length
    || review + stale !== total
  ) {
    fail("Commercial impact counts do not match the named dependencies.");
  }
  return { total, review, stale };
}

function normalizeReceiptImpact(value) {
  exactKeys(value, ["rootNodeIds", "dependentNodes", "counts"], "Receipt impact");
  const rootNodeIds = uniqueOpaqueList(value.rootNodeIds, "Receipt impact roots", 40);
  if (!Array.isArray(value.dependentNodes) || value.dependentNodes.length > MAX_INVALIDATIONS) {
    fail("Receipt dependent nodes are invalid.");
  }
  const dependentNodes = value.dependentNodes.map((item, index) => {
    exactKeys(
      item,
      ["nodeId", "nodeKind", "distance", "triggeredBy", "classification"],
      `Receipt dependency ${index}`
    );
    const nodeKind = text(item.nodeKind);
    const classification = text(item.classification).toUpperCase();
    if (!["fact", "output", "artifact", "projection"].includes(nodeKind)) {
      fail(`Receipt dependency ${index} kind is invalid.`);
    }
    const expectedClassification = ["artifact", "projection"].includes(nodeKind)
      ? "STALE"
      : "REVIEW";
    if (classification !== expectedClassification) {
      fail(`Receipt dependency ${index} classification is invalid.`);
    }
    return {
      nodeId: exactOpaqueId(
        item.nodeId,
        `Receipt dependency ${index} nodeId`,
        256,
        "invalid-server-response"
      ),
      nodeKind,
      distance: boundedInteger(item.distance, `Receipt dependency ${index} distance`, 128),
      triggeredBy: uniqueOpaqueList(
        item.triggeredBy,
        `Receipt dependency ${index} triggers`,
        40
      ),
      classification
    };
  });
  if (new Set(dependentNodes.map((item) => item.nodeId)).size !== dependentNodes.length) {
    fail("Receipt dependencies contain duplicate nodes.");
  }
  return {
    rootNodeIds,
    dependentNodes,
    counts: normalizeImpactCounts(value.counts, dependentNodes)
  };
}

function normalizeProjectedImpact(value) {
  exactKeys(value, ["rootNodeIds", "dependentNodes", "counts"], "Projected impact");
  const rootNodeIds = uniqueOpaqueList(value.rootNodeIds, "Projected impact roots", 40);
  if (!Array.isArray(value.dependentNodes) || value.dependentNodes.length > MAX_INVALIDATIONS) {
    fail("Projected dependent nodes are invalid.");
  }
  const dependentNodes = value.dependentNodes.map((item, index) => {
    exactKeys(
      item,
      ["id", "kind", "distance", "triggeredBy", "advisoryClass"],
      `Projected dependency ${index}`
    );
    const kind = text(item.kind);
    const advisoryClass = text(item.advisoryClass).toUpperCase();
    if (!["fact", "output", "artifact", "projection"].includes(kind)) {
      fail(`Projected dependency ${index} kind is invalid.`);
    }
    const expectedClass = ["artifact", "projection"].includes(kind) ? "STALE" : "REVIEW";
    if (advisoryClass !== expectedClass) {
      fail(`Projected dependency ${index} classification is invalid.`);
    }
    return {
      nodeId: exactOpaqueId(
        item.id,
        `Projected dependency ${index} nodeId`,
        256,
        "invalid-server-response"
      ),
      nodeKind: kind,
      distance: boundedInteger(item.distance, `Projected dependency ${index} distance`, 128),
      triggeredBy: uniqueOpaqueList(
        item.triggeredBy,
        `Projected dependency ${index} triggers`,
        40
      ),
      classification: advisoryClass
    };
  });
  if (new Set(dependentNodes.map((item) => item.nodeId)).size !== dependentNodes.length) {
    fail("Projected dependencies contain duplicate nodes.");
  }
  return {
    rootNodeIds,
    dependentNodes,
    counts: normalizeImpactCounts(value.counts, dependentNodes)
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeSimulationReceipt(value, scope, requestId, expectedActiveVersionId) {
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "receiptType",
    "receiptId",
    "requestId",
    "organizationId",
    "quoteId",
    "baseRevisionId",
    "proposedRevisionId",
    "proposalDigest",
    "impactDigest",
    "catalogAuthorityDigest",
    "policyVersion",
    "graph",
    "factDiffs",
    "commercialValues",
    "impact",
    "authorizationRequired",
    "simulatedAtISO",
    "expiresAtISO",
    "simulatedBy",
    "boundary",
    "receiptDigest"
  ], "Simulation receipt");
  if (
    value.schemaVersion !== RECEIPT_SCHEMA_VERSIONS.simulation
    || value.authority !== "server_authoritative"
    || value.receiptType !== "simulation"
    || value.organizationId !== scope.organizationId
    || value.quoteId !== scope.quoteId
    || value.requestId !== requestId
    || value.baseRevisionId !== expectedActiveVersionId
  ) {
    fail("Simulation receipt is outside the exact request scope.");
  }
  const impact = normalizeReceiptImpact(value.impact);
  const simulatedAtISO = exactISO(value.simulatedAtISO, "Simulation time");
  const expiresAtISO = exactISO(value.expiresAtISO, "Simulation expiry");
  if (Date.parse(expiresAtISO) < Date.parse(simulatedAtISO)) {
    fail("Simulation expiry precedes its server timestamp.");
  }
  const authorizationRequired = exactBoolean(
    value.authorizationRequired,
    "Simulation authorization requirement"
  );
  if (authorizationRequired !== (impact.counts.total > 0)) {
    fail("Simulation authorization requirement does not match its dependency impact.");
  }
  return {
    schemaVersion: value.schemaVersion,
    authority: value.authority,
    receiptType: value.receiptType,
    receiptId: receiptId(value.receiptId, "simulation"),
    requestId: exactRequestId(value.requestId, "simulation"),
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    baseRevisionId: expectedActiveVersionId,
    proposedRevisionId: exactOpaqueId(
      value.proposedRevisionId,
      "proposedRevisionId",
      256,
      "invalid-server-response"
    ),
    proposalDigest: digest(value.proposalDigest, "Simulation proposal digest"),
    impactDigest: digest(value.impactDigest, "Simulation impact digest"),
    catalogAuthorityDigest: digest(
      value.catalogAuthorityDigest,
      "Simulation catalog digest"
    ),
    policyVersion: exactOpaqueId(
      value.policyVersion,
      "policyVersion",
      128,
      "invalid-server-response"
    ),
    graph: exactGraph(value.graph, "Simulation graph"),
    factDiffs: normalizeFactDiffs(value.factDiffs),
    commercialValues: normalizeCommercialValues(value.commercialValues),
    impact,
    authorizationRequired,
    simulatedAtISO,
    expiresAtISO,
    simulatedBy: exactActor(value.simulatedBy, "Simulation actor"),
    boundary: exactText(value.boundary, "Simulation boundary", 2_000),
    receiptDigest: digest(value.receiptDigest, "Simulation receipt digest")
  };
}

function normalizeSimulationProjection(value, scope, receipt) {
  exactKeys(value, [
    "schemaVersion",
    "advisory",
    "receiptId",
    "receiptDigest",
    "authorizationRequired",
    "expiresAtISO",
    "identity",
    "sources",
    "graph",
    "factDiffs",
    "commercialValues",
    "impact",
    "bounds",
    "boundary"
  ], "Commercial change simulation");
  exactKeys(
    value.identity,
    ["organizationId", "quoteId", "beforeRevisionId", "proposedRevisionId"],
    "Simulation identity"
  );
  if (
    value.schemaVersion !== "commercial-change-impact-v1"
    || value.advisory !== true
    || value.receiptId !== receipt.receiptId
    || value.receiptDigest !== receipt.receiptDigest
    || value.authorizationRequired !== receipt.authorizationRequired
    || value.expiresAtISO !== receipt.expiresAtISO
    || value.identity.organizationId !== scope.organizationId
    || value.identity.quoteId !== scope.quoteId
    || value.identity.beforeRevisionId !== receipt.baseRevisionId
    || value.identity.proposedRevisionId !== receipt.proposedRevisionId
  ) {
    fail("Commercial change simulation is outside its immutable receipt scope.");
  }
  exactKeys(value.sources, ["before", "proposedAfter"], "Simulation sources");
  for (const [key, source] of Object.entries(value.sources)) {
    exactKeys(source, ["label", "authority"], `Simulation ${key} source`);
    if (source.authority !== "server_authoritative") {
      fail(`Simulation ${key} source is not server authoritative.`);
    }
    exactText(source.label, `Simulation ${key} source label`, 128);
  }
  exactKeys(value.bounds, [
    "declaredFactCount",
    "changedFactLimit",
    "dependentNodeLimit",
    "outputByteLimit"
  ], "Simulation bounds");
  const factDiffs = normalizeFactDiffs(value.factDiffs);
  const commercialValues = normalizeCommercialValues(value.commercialValues);
  const impact = normalizeProjectedImpact(value.impact);
  if (
    !sameJson(factDiffs, receipt.factDiffs)
    || !sameJson(commercialValues, receipt.commercialValues)
    || !sameJson(impact, receipt.impact)
    || !sameJson(exactGraph(value.graph, "Simulation graph"), receipt.graph)
  ) {
    fail("Commercial change simulation does not match its immutable receipt.");
  }
  return {
    schemaVersion: value.schemaVersion,
    advisory: true,
    receiptId: receipt.receiptId,
    receiptDigest: receipt.receiptDigest,
    authorizationRequired: receipt.authorizationRequired,
    expiresAtISO: receipt.expiresAtISO,
    identity: {
      organizationId: scope.organizationId,
      quoteId: scope.quoteId,
      beforeRevisionId: receipt.baseRevisionId,
      proposedRevisionId: receipt.proposedRevisionId
    },
    sources: jsonClone(value.sources, "Simulation sources", { maximum: 4_096 }),
    graph: receipt.graph,
    factDiffs,
    commercialValues,
    impact,
    bounds: {
      declaredFactCount: boundedInteger(
        value.bounds.declaredFactCount,
        "Declared fact count",
        512
      ),
      changedFactLimit: boundedInteger(value.bounds.changedFactLimit, "Changed fact limit", 512),
      dependentNodeLimit: boundedInteger(
        value.bounds.dependentNodeLimit,
        "Dependent node limit",
        512
      ),
      outputByteLimit: boundedInteger(value.bounds.outputByteLimit, "Output byte limit", 2_000_000)
    },
    boundary: exactText(value.boundary, "Simulation boundary", 2_000)
  };
}

function normalizeApproval(value, scope, simulationReceiptId, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "approvalRequestId",
    "simulationReceiptId",
    "state",
    "requestedAtISO",
    "requestedBy",
    "resolvedAtISO",
    "resolvedBy",
    "authorizationReceiptId",
    "expiresAtISO"
  ], "Commercial change approval");
  const state = text(value.state).toLowerCase();
  if (
    value.schemaVersion !== 1
    || value.authority !== "server_projection"
    || value.simulationReceiptId !== simulationReceiptId
    || !["pending", "authorized", "rejected", "expired"].includes(state)
  ) {
    fail("Commercial change approval is outside the exact simulation scope.");
  }
  const requestedAtISO = exactISO(value.requestedAtISO, "Approval request time");
  const expiresAtISO = exactISO(value.expiresAtISO, "Approval expiry");
  const requestedBy = projectedActor(value.requestedBy, "Approval requester");
  const resolvedAtISO = exactISO(value.resolvedAtISO, "Approval resolution time", {
    optional: true
  });
  const resolvedBy = projectedActor(value.resolvedBy, "Approval resolver", {
    optional: true,
    adminOnly: Boolean(text(value.resolvedBy?.role))
  });
  const authorizationReceiptId = receiptId(value.authorizationReceiptId, "authorization", {
    optional: true
  });
  if (
    (state === "pending" && (resolvedAtISO || resolvedBy.email || authorizationReceiptId))
    || (state === "authorized" && (!resolvedAtISO || !resolvedBy.email || !authorizationReceiptId))
    || (state !== "authorized" && authorizationReceiptId)
    || Date.parse(expiresAtISO) < Date.parse(requestedAtISO)
  ) {
    fail("Commercial change approval state evidence is inconsistent.");
  }
  return {
    schemaVersion: 1,
    authority: "server_projection",
    approvalRequestId: receiptId(value.approvalRequestId, "approval"),
    simulationReceiptId,
    state,
    requestedAtISO,
    requestedBy,
    resolvedAtISO,
    resolvedBy,
    authorizationReceiptId,
    expiresAtISO,
    organizationId: scope.organizationId,
    quoteId: scope.quoteId
  };
}

function normalizeAuthorizationReceipt(value, scope, simulationReceiptId, requestId) {
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "receiptType",
    "receiptId",
    "requestId",
    "organizationId",
    "quoteId",
    "simulationReceiptId",
    "simulationDigest",
    "baseRevisionId",
    "proposedRevisionId",
    "proposalDigest",
    "catalogAuthorityDigest",
    "policyVersion",
    "state",
    "authorizedAtISO",
    "expiresAtISO",
    "authorizedBy",
    "authorizedFor",
    "boundary",
    "receiptDigest"
  ], "Commercial change authorization receipt");
  if (
    value.schemaVersion !== RECEIPT_SCHEMA_VERSIONS.authorization
    || value.authority !== "server_authoritative"
    || value.receiptType !== "authorization"
    || value.organizationId !== scope.organizationId
    || value.quoteId !== scope.quoteId
    || value.simulationReceiptId !== simulationReceiptId
    || value.requestId !== requestId
    || value.state !== "authorized"
  ) {
    fail("Commercial change authorization receipt is outside the exact request scope.");
  }
  const authorizedAtISO = exactISO(value.authorizedAtISO, "Authorization time");
  const expiresAtISO = exactISO(value.expiresAtISO, "Authorization expiry");
  if (Date.parse(expiresAtISO) < Date.parse(authorizedAtISO)) {
    fail("Authorization expiry precedes its server timestamp.");
  }
  return {
    schemaVersion: value.schemaVersion,
    authority: value.authority,
    receiptType: value.receiptType,
    receiptId: receiptId(value.receiptId, "authorization"),
    requestId: exactRequestId(value.requestId, "authorization"),
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    simulationReceiptId,
    simulationDigest: digest(value.simulationDigest, "Authorization simulation digest"),
    baseRevisionId: exactOpaqueId(
      value.baseRevisionId,
      "Authorization baseRevisionId",
      256,
      "invalid-server-response"
    ),
    proposedRevisionId: exactOpaqueId(
      value.proposedRevisionId,
      "Authorization proposedRevisionId",
      256,
      "invalid-server-response"
    ),
    proposalDigest: digest(value.proposalDigest, "Authorization proposal digest"),
    catalogAuthorityDigest: digest(value.catalogAuthorityDigest, "Authorization catalog digest"),
    policyVersion: exactOpaqueId(
      value.policyVersion,
      "Authorization policyVersion",
      128,
      "invalid-server-response"
    ),
    state: "authorized",
    authorizedAtISO,
    expiresAtISO,
    authorizedBy: exactActor(value.authorizedBy, "Authorizing actor", { adminOnly: true }),
    authorizedFor: exactActor(value.authorizedFor, "Authorized requester"),
    boundary: exactText(value.boundary, "Authorization boundary", 2_000),
    receiptDigest: digest(value.receiptDigest, "Authorization receipt digest")
  };
}

function normalizeInvalidation(value, index) {
  exactKeys(value, [
    "invalidationId",
    "operationId",
    "applyReceiptId",
    "sourceRevisionId",
    "targetRevisionId",
    "nodeId",
    "nodeKind",
    "classification",
    "triggeredBy",
    "decisionId",
    "decisionType",
    "state",
    "createdAtISO",
    "resolvedAtISO",
    "resolution",
    "resolutionReceiptId",
    "evidenceId"
  ], `Dependency invalidation ${index}`);
  const state = text(value.state).toLowerCase();
  const nodeKind = text(value.nodeKind);
  const classification = text(value.classification).toUpperCase();
  if (
    !["open", "resolved"].includes(state)
    || !["fact", "output", "artifact", "projection"].includes(nodeKind)
    || !["STALE", "REVIEW"].includes(classification)
  ) {
    fail(`Dependency invalidation ${index} state is invalid.`);
  }
  const resolvedAtISO = exactISO(
    value.resolvedAtISO,
    `Dependency invalidation ${index} resolution time`,
    { optional: true }
  );
  const resolutionReceiptId = receiptId(value.resolutionReceiptId, "reconciliation", {
    optional: true
  });
  const resolution = exactText(
    value.resolution,
    `Dependency invalidation ${index} resolution`,
    80,
    { optional: true }
  );
  const evidenceId = optionalOpaqueId(
    value.evidenceId,
    `Dependency invalidation ${index} evidenceId`,
    180
  );
  if (
    (state === "open" && (resolvedAtISO || resolutionReceiptId || resolution || evidenceId))
    || (state === "resolved" && (!resolvedAtISO || !resolutionReceiptId || !resolution || !evidenceId))
  ) {
    fail(`Dependency invalidation ${index} resolution evidence is inconsistent.`);
  }
  return {
    invalidationId: receiptId(value.invalidationId, "invalidation"),
    operationId: receiptId(value.operationId, "operation"),
    applyReceiptId: receiptId(value.applyReceiptId, "apply"),
    sourceRevisionId: exactOpaqueId(
      value.sourceRevisionId,
      `Dependency invalidation ${index} sourceRevisionId`,
      256,
      "invalid-server-response"
    ),
    targetRevisionId: exactOpaqueId(
      value.targetRevisionId,
      `Dependency invalidation ${index} targetRevisionId`,
      256,
      "invalid-server-response"
    ),
    nodeId: exactOpaqueId(
      value.nodeId,
      `Dependency invalidation ${index} nodeId`,
      256,
      "invalid-server-response"
    ),
    nodeKind,
    classification,
    triggeredBy: uniqueOpaqueList(
      value.triggeredBy,
      `Dependency invalidation ${index} triggers`,
      32
    ),
    decisionId: optionalOpaqueId(
      value.decisionId,
      `Dependency invalidation ${index} decisionId`,
      180
    ),
    decisionType: exactText(
      value.decisionType,
      `Dependency invalidation ${index} decisionType`,
      80,
      { optional: true }
    ),
    state,
    createdAtISO: exactISO(value.createdAtISO, `Dependency invalidation ${index} creation time`),
    resolvedAtISO,
    resolution,
    resolutionReceiptId,
    evidenceId
  };
}

function normalizeDependencyState(value, scope) {
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "source",
    "organizationId",
    "quoteId",
    "customerId",
    "eventDate",
    "activeRevisionId",
    "observedAtISO",
    "bounds",
    "state",
    "safeToPublish",
    "latestApplyReceiptId",
    "totalInvalidationCount",
    "openInvalidationCount",
    "resolvedInvalidationCount",
    "invalidations",
    "reasonCodes"
  ], "Commercial dependency state");
  if (
    value.schemaVersion !== 1
    || value.authority !== "server_projection"
    || value.source !== "firebase_server_projection"
    || value.organizationId !== scope.organizationId
    || value.quoteId !== scope.quoteId
  ) {
    fail("Commercial dependency state is outside the exact request scope.");
  }
  exactKeys(value.bounds, [
    "invalidationLimit",
    "invalidationSetComplete",
    "returnedCount",
    "truncated"
  ], "Commercial dependency bounds");
  const state = text(value.state).toUpperCase();
  const safeToPublish = exactBoolean(value.safeToPublish, "Commercial publish eligibility");
  if (!["UNKNOWN", "NOT_GENERATED", "BLOCKED", "READY"].includes(state)) {
    fail("Commercial dependency state is invalid.");
  }
  const invalidationLimit = boundedInteger(
    value.bounds.invalidationLimit,
    "Dependency invalidation limit",
    MAX_INVALIDATIONS
  );
  if (invalidationLimit !== MAX_INVALIDATIONS) fail("Dependency invalidation limit is unsupported.");
  const invalidationSetComplete = exactBoolean(
    value.bounds.invalidationSetComplete,
    "Dependency evidence completeness"
  );
  const truncated = exactBoolean(value.bounds.truncated, "Dependency truncation state");
  const returnedCount = boundedInteger(
    value.bounds.returnedCount,
    "Dependency returned count",
    MAX_INVALIDATIONS
  );
  if (!Array.isArray(value.invalidations) || value.invalidations.length > MAX_INVALIDATIONS) {
    fail("Commercial dependency invalidations are invalid.");
  }
  const invalidations = value.invalidations.map(normalizeInvalidation);
  if (new Set(invalidations.map((item) => item.invalidationId)).size !== invalidations.length) {
    fail("Commercial dependency invalidations contain duplicates.");
  }
  const totalInvalidationCount = boundedInteger(
    value.totalInvalidationCount,
    "Dependency total count"
  );
  const openInvalidationCount = boundedInteger(
    value.openInvalidationCount,
    "Dependency open count"
  );
  const resolvedInvalidationCount = boundedInteger(
    value.resolvedInvalidationCount,
    "Dependency resolved count"
  );
  if (
    openInvalidationCount + resolvedInvalidationCount !== totalInvalidationCount
    || (!truncated && state !== "UNKNOWN" && returnedCount !== invalidations.length)
    || (invalidationSetComplete && state !== "UNKNOWN"
      && totalInvalidationCount !== invalidations.length)
    || (truncated && (invalidationSetComplete || invalidations.length || returnedCount))
    || (state === "READY" && (!safeToPublish || openInvalidationCount !== 0))
    || (state === "BLOCKED" && (safeToPublish || openInvalidationCount === 0))
    || (state === "UNKNOWN" && safeToPublish)
    || (state === "NOT_GENERATED" && (safeToPublish || totalInvalidationCount !== 0))
  ) {
    fail("Commercial dependency state counts or publication gate are inconsistent.");
  }
  const latestApplyReceiptId = receiptId(value.latestApplyReceiptId, "apply", { optional: true });
  if (
    ["READY", "BLOCKED"].includes(state) && !latestApplyReceiptId
    || state === "NOT_GENERATED" && latestApplyReceiptId
    || invalidations.some((item) => latestApplyReceiptId && item.applyReceiptId !== latestApplyReceiptId)
  ) {
    fail("Commercial dependency state apply scope is inconsistent.");
  }
  if (!Array.isArray(value.reasonCodes) || !value.reasonCodes.length || value.reasonCodes.length > 12) {
    fail("Commercial dependency reason codes are invalid.");
  }
  const reasonCodes = value.reasonCodes.map((item, index) => (
    exactOpaqueId(item, `Dependency reason code ${index}`, 128, "invalid-server-response")
  ));
  const eventDate = text(value.eventDate);
  if (eventDate && !/^\d{4}-\d{2}-\d{2}$/u.test(eventDate)) {
    fail("Commercial dependency event date is invalid.");
  }
  return {
    schemaVersion: 1,
    authority: "server_projection",
    source: "firebase_server_projection",
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    customerId: optionalOpaqueId(value.customerId, "Dependency customerId"),
    eventDate,
    activeRevisionId: exactOpaqueId(
      value.activeRevisionId,
      "Dependency activeRevisionId",
      256,
      "invalid-server-response"
    ),
    observedAtISO: exactISO(value.observedAtISO, "Dependency observation time"),
    bounds: {
      invalidationLimit,
      invalidationSetComplete,
      returnedCount,
      truncated
    },
    state,
    safeToPublish,
    latestApplyReceiptId,
    totalInvalidationCount,
    openInvalidationCount,
    resolvedInvalidationCount,
    invalidations,
    reasonCodes
  };
}

function normalizeReconciliationReceipt(value, scope, applyReceiptId, requestId, invalidationIds) {
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "receiptType",
    "receiptId",
    "requestId",
    "organizationId",
    "quoteId",
    "applyReceiptId",
    "applyReceiptDigest",
    "activeRevisionId",
    "resolutions",
    "reconciledAtISO",
    "reconciledBy",
    "boundary",
    "receiptDigest"
  ], "Commercial reconciliation receipt");
  if (
    value.schemaVersion !== RECEIPT_SCHEMA_VERSIONS.reconciliation
    || value.authority !== "server_authoritative"
    || value.receiptType !== "reconciliation"
    || value.organizationId !== scope.organizationId
    || value.quoteId !== scope.quoteId
    || value.applyReceiptId !== applyReceiptId
    || value.requestId !== requestId
  ) {
    fail("Commercial reconciliation receipt is outside the exact request scope.");
  }
  if (!Array.isArray(value.resolutions) || value.resolutions.length !== invalidationIds.length) {
    fail("Commercial reconciliation resolutions do not match the requested invalidations.");
  }
  const resolutions = value.resolutions.map((item, index) => {
    exactKeys(item, [
      "invalidationId",
      "invalidationReceiptId",
      "nodeId",
      "evidenceId",
      "evidenceDigest",
      "resolution"
    ], `Commercial reconciliation resolution ${index}`);
    const invalidationId = receiptId(item.invalidationId, "invalidation");
    if (item.invalidationReceiptId !== invalidationId) {
      fail(`Commercial reconciliation resolution ${index} receipt is inconsistent.`);
    }
    return {
      invalidationId,
      invalidationReceiptId: invalidationId,
      nodeId: exactOpaqueId(
        item.nodeId,
        `Commercial reconciliation resolution ${index} nodeId`,
        256,
        "invalid-server-response"
      ),
      evidenceId: exactOpaqueId(
        item.evidenceId,
        `Commercial reconciliation resolution ${index} evidenceId`,
        180,
        "invalid-server-response"
      ),
      evidenceDigest: digest(
        item.evidenceDigest,
        `Commercial reconciliation resolution ${index} evidence digest`
      ),
      resolution: exactText(
        item.resolution,
        `Commercial reconciliation resolution ${index} resolution`,
        80
      )
    };
  });
  const requested = [...invalidationIds].sort(compareText);
  const returned = resolutions.map((item) => item.invalidationId).sort(compareText);
  if (!sameJson(requested, returned)) {
    fail("Commercial reconciliation receipt resolved a different invalidation set.");
  }
  return {
    schemaVersion: value.schemaVersion,
    authority: value.authority,
    receiptType: value.receiptType,
    receiptId: receiptId(value.receiptId, "reconciliation"),
    requestId: exactRequestId(value.requestId, "reconciliation"),
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    applyReceiptId,
    applyReceiptDigest: digest(value.applyReceiptDigest, "Reconciliation apply digest"),
    activeRevisionId: exactOpaqueId(
      value.activeRevisionId,
      "Reconciliation activeRevisionId",
      256,
      "invalid-server-response"
    ),
    resolutions,
    reconciledAtISO: exactISO(value.reconciledAtISO, "Reconciliation time"),
    reconciledBy: exactActor(value.reconciledBy, "Reconciliation actor"),
    boundary: exactText(value.boundary, "Reconciliation boundary", 2_000),
    receiptDigest: digest(value.receiptDigest, "Reconciliation receipt digest")
  };
}

function normalizeScope(input = {}) {
  return {
    organizationId: exactOpaqueId(input.organizationId, "organizationId"),
    quoteId: exactOpaqueId(input.quoteId, "quoteId")
  };
}

function ensureConnected() {
  if (!firebaseReady || !cloudFunctions) {
    fail(
      "Commercial Change Authority requires a connected QuotePilot workspace.",
      "failed-precondition"
    );
  }
}

function callable(name) {
  ensureConnected();
  return httpsCallable(cloudFunctions, name);
}

function exactEnvelope(result, scope, expectedKeys, label) {
  exactKeys(result, expectedKeys, label);
  if (
    result.ok !== true
    || result.storage !== "firebase"
    || result.organizationId !== scope.organizationId
    || result.quoteId !== scope.quoteId
  ) {
    fail(`${label} is outside the exact Firebase quote scope.`);
  }
}

function randomHex32() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "").toLowerCase();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}${Math.random()
    .toString(16)
    .slice(2)}`.replace(/[^a-f0-9]/gu, "").padEnd(32, "0").slice(0, 32);
}

export function buildCommercialChangeRequestId(kind) {
  const normalizedKind = text(kind).toLowerCase();
  const prefix = REQUEST_ID_PREFIXES[normalizedKind];
  if (!prefix) fail("Commercial change request kind is invalid.", "invalid-argument");
  return `${prefix}_${randomHex32()}`;
}

export function isDefinitiveCommercialChangeError(error) {
  const code = text(error?.code).toLowerCase().replace(/^functions\//u, "");
  return DEFINITIVE_ERROR_CODES.has(code);
}

export async function simulateCommercialQuoteChange(input = {}) {
  const scope = normalizeScope(input);
  const expectedActiveVersionId = exactOpaqueId(
    input.expectedActiveVersionId,
    "expectedActiveVersionId"
  );
  const requestId = exactRequestId(
    input.requestId || buildCommercialChangeRequestId("simulation"),
    "simulation"
  );
  if (!record(input.form)) fail("Commercial change form is required.", "invalid-argument");
  const form = jsonClone(input.form, "Commercial change form", {
    maximum: MAX_JSON_BYTES,
    code: "invalid-argument"
  });
  const response = await callable(COMMERCIAL_CHANGE_AUTHORITY_CALLABLES.simulate)({
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    expectedActiveVersionId,
    requestId,
    form
  });
  const result = response?.data;
  exactEnvelope(result, scope, [
    "ok",
    "storage",
    "organizationId",
    "quoteId",
    "idempotent",
    "authorityState",
    "simulationReceipt",
    "simulation"
  ], "Commercial change simulation response");
  const idempotent = exactBoolean(result.idempotent, "Simulation idempotency state");
  const authorityState = text(result.authorityState).toLowerCase();
  if (!["dormant", "enforced"].includes(authorityState)) {
    fail("Commercial change enforcement state is invalid.");
  }
  const simulationReceipt = normalizeSimulationReceipt(
    result.simulationReceipt,
    scope,
    requestId,
    expectedActiveVersionId
  );
  const simulation = normalizeSimulationProjection(result.simulation, scope, simulationReceipt);
  return deepFreeze({
    ok: true,
    storage: "firebase",
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    idempotent,
    authorityState,
    simulationReceipt,
    simulation
  });
}

export async function requestCommercialQuoteChangeAuthorization(input = {}) {
  const scope = normalizeScope(input);
  const simulationReceiptId = inputReceiptId(input.simulationReceiptId, "simulation");
  const requestId = exactRequestId(
    input.requestId || buildCommercialChangeRequestId("approval"),
    "approval"
  );
  const response = await callable(COMMERCIAL_CHANGE_AUTHORITY_CALLABLES.requestApproval)({
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    simulationReceiptId,
    requestId
  });
  const result = response?.data;
  exactEnvelope(result, scope, [
    "ok",
    "storage",
    "organizationId",
    "quoteId",
    "idempotent",
    "approval"
  ], "Commercial change approval request response");
  const approval = normalizeApproval(result.approval, scope, simulationReceiptId);
  return deepFreeze({
    ok: true,
    storage: "firebase",
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    idempotent: exactBoolean(result.idempotent, "Approval request idempotency state"),
    approval
  });
}

export async function getCommercialQuoteChangeAuthorizationState(input = {}) {
  const scope = normalizeScope(input);
  const simulationReceiptId = inputReceiptId(input.simulationReceiptId, "simulation");
  const response = await callable(COMMERCIAL_CHANGE_AUTHORITY_CALLABLES.getApprovalState)({
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    simulationReceiptId
  });
  const result = response?.data;
  exactEnvelope(result, scope, [
    "ok",
    "storage",
    "organizationId",
    "quoteId",
    "approval"
  ], "Commercial change approval state response");
  return deepFreeze({
    ok: true,
    storage: "firebase",
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    approval: normalizeApproval(result.approval, scope, simulationReceiptId, { nullable: true })
  });
}

export async function authorizeCommercialQuoteChange(input = {}) {
  const scope = normalizeScope(input);
  const simulationReceiptId = inputReceiptId(input.simulationReceiptId, "simulation");
  const requestId = exactRequestId(
    input.requestId || buildCommercialChangeRequestId("authorization"),
    "authorization"
  );
  const response = await callable(COMMERCIAL_CHANGE_AUTHORITY_CALLABLES.authorize)({
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    simulationReceiptId,
    requestId
  });
  const result = response?.data;
  exactEnvelope(result, scope, [
    "ok",
    "storage",
    "organizationId",
    "quoteId",
    "idempotent",
    "authorizationReceipt",
    "approval"
  ], "Commercial change authorization response");
  const authorizationReceipt = normalizeAuthorizationReceipt(
    result.authorizationReceipt,
    scope,
    simulationReceiptId,
    requestId
  );
  const approval = normalizeApproval(result.approval, scope, simulationReceiptId, {
    nullable: true
  });
  if (approval && approval.authorizationReceiptId !== authorizationReceipt.receiptId) {
    fail("Commercial change approval does not match the authorization receipt.");
  }
  return deepFreeze({
    ok: true,
    storage: "firebase",
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    idempotent: exactBoolean(result.idempotent, "Authorization idempotency state"),
    authorizationReceipt,
    approval
  });
}

export async function getCommercialDependencyState(input = {}) {
  const scope = normalizeScope(input);
  const response = await callable(COMMERCIAL_CHANGE_AUTHORITY_CALLABLES.getDependencyState)(scope);
  const result = response?.data;
  exactEnvelope(result, scope, [
    "ok",
    "storage",
    "organizationId",
    "quoteId",
    "dependencyState"
  ], "Commercial dependency state response");
  return normalizeDependencyState(result.dependencyState, scope);
}

export async function reconcileCommercialDependencyState(input = {}) {
  const scope = normalizeScope(input);
  const applyReceiptId = inputReceiptId(input.applyReceiptId, "apply");
  const requestId = exactRequestId(
    input.requestId || buildCommercialChangeRequestId("reconciliation"),
    "reconciliation"
  );
  if (!Array.isArray(input.invalidationIds) || !input.invalidationIds.length) {
    fail("Reconciliation requires a non-empty invalidation set.", "invalid-argument");
  }
  const invalidationIds = input.invalidationIds.map((value) => (
    inputReceiptId(value, "invalidation")
  ));
  if (
    invalidationIds.length > MAX_INVALIDATIONS
    || new Set(invalidationIds).size !== invalidationIds.length
  ) {
    fail("Reconciliation invalidation identities must be unique and bounded.", "invalid-argument");
  }
  const resolutionNote = text(input.resolutionNote);
  if (resolutionNote.length > 800) {
    fail("Reconciliation note must be no longer than 800 characters.", "invalid-argument");
  }
  const response = await callable(COMMERCIAL_CHANGE_AUTHORITY_CALLABLES.reconcile)({
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    applyReceiptId,
    requestId,
    invalidationIds,
    resolutionNote
  });
  const result = response?.data;
  exactEnvelope(result, scope, [
    "ok",
    "storage",
    "organizationId",
    "quoteId",
    "idempotent",
    "reconciliationReceipt",
    "dependencyState"
  ], "Commercial dependency reconciliation response");
  const reconciliationReceipt = normalizeReconciliationReceipt(
    result.reconciliationReceipt,
    scope,
    applyReceiptId,
    requestId,
    invalidationIds
  );
  const dependencyState = normalizeDependencyState(result.dependencyState, scope);
  if (dependencyState.latestApplyReceiptId !== applyReceiptId) {
    fail("Reconciled dependency state does not match the exact apply receipt.");
  }
  return deepFreeze({
    ok: true,
    storage: "firebase",
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    idempotent: exactBoolean(result.idempotent, "Reconciliation idempotency state"),
    reconciliationReceipt,
    dependencyState
  });
}
