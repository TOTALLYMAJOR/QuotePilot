import { httpsCallable } from "firebase/functions";
import {
  COMMERCIAL_DEPENDENCY_GRAPH_ID,
  COMMERCIAL_DEPENDENCY_GRAPH_VERSION
} from "./commercialDependencyGraph";
import { cloudFunctions, firebaseReady } from "./firebase";
import normalizeActivePersistedEffects, {
  COMMERCIAL_CHANGE_PERSISTED_EFFECTS_ENABLED
} from "quotepilot-active-commercial-persisted-effects";
import { normalizeEventInventoryPreviewResult } from "./inventoryAuthorityClient";

export const COMMERCIAL_CHANGE_AUTHORITY_CALLABLES = Object.freeze({
  simulate: "simulateCommercialQuoteChange",
  requestApproval: "requestCommercialQuoteChangeAuthorization",
  getApprovalState: "getCommercialQuoteChangeAuthorizationState",
  authorize: "authorizeCommercialQuoteChange",
  reconcileApplyOutcome: "reconcileCommercialQuoteChangeApplyOutcome",
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
  outcome: /^ccor_[a-f0-9]{48}$/u,
  invalidation: /^cci_[a-f0-9]{48}$/u,
  reconciliation: /^ccr_[a-f0-9]{48}$/u,
  approval: /^ccar_[a-f0-9]{48}$/u,
  operation: /^cco_[a-f0-9]{48}$/u
});
const RECEIPT_SCHEMA_VERSIONS = Object.freeze({
  simulation: "commercial-change-simulation-receipt-v1",
  authorization: "commercial-change-authorization-receipt-v1",
  outcome: "commercial-change-apply-outcome-receipt-v1",
  reconciliation: "commercial-change-reconciliation-receipt-v1"
});
const MAX_INVALIDATIONS = 64;
const MAX_EVENT_INGREDIENT_OUTPUTS = 100;
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

function exactKeys(value, expectedKeys, label, code = "invalid-server-response") {
  if (!record(value)) fail(`${label} must be an exact server object.`, code);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} did not match the exact server contract.`, code);
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

function exactOutputQuantity(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value)) {
    fail(`${label} must be a canonical decimal with at most six places.`, "invalid-argument");
  }
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
  if (micros <= 0n || micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(`${label} is outside the supported quantity range.`, "invalid-argument");
  }
  return value;
}

function normalizeEventIngredientOutputs(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVENT_INGREDIENT_OUTPUTS) {
    fail(
      `eventIngredientOutputs must contain 1 to ${MAX_EVENT_INGREDIENT_OUTPUTS} exact output rows.`,
      "invalid-argument"
    );
  }
  const rows = value.map((entry, index) => {
    exactKeys(
      entry,
      ["menuItemId", "requiredOutputQuantity"],
      `Event ingredient output ${index + 1}`,
      "invalid-argument"
    );
    return {
      menuItemId: exactOpaqueId(
        entry.menuItemId,
        `Event ingredient output ${index + 1} menuItemId`
      ),
      requiredOutputQuantity: exactOutputQuantity(
        entry.requiredOutputQuantity,
        `Event ingredient output ${index + 1} requiredOutputQuantity`
      )
    };
  });
  if (new Set(rows.map(({ menuItemId }) => menuItemId)).size !== rows.length) {
    fail("eventIngredientOutputs contains duplicate menu items.", "invalid-argument");
  }
  return rows;
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

const WORKFLOW_SEAL_FIELDS = ["workflowPolicy", "attendanceBinding", "approvalEvaluation"];
function isBoundReceipt(value, kind) {
  return value?.schemaVersion === `commercial-change-${kind}-receipt-v2`;
}

// Validate server-declared policy/evidence. These values do not price the browser form.
function normalizeWorkflowSeal(value, scope, { impact = null, commercialValues = null } = {}) {
  if (!isBoundReceipt(value, value.receiptType)) return {};
  const policy = value.workflowPolicy;
  const attendance = value.attendanceBinding;
  if (policy === null && attendance === null) fail("Bound receipt has no workflow or attendance evidence.");
  if (policy !== null) {
    exactKeys(policy, ["organizationId", "definitionPin", "approvalPolicy", "declaredBy", "declaredAtISO"], "Workflow policy");
    const pin = policy.definitionPin;
    exactKeys(pin, ["workflowKind", "schemaVersion", "definitionId", "versionId", "version", "definitionDigest"], "Workflow pin");
    if (policy.organizationId !== scope.organizationId || pin.workflowKind !== "quote_review" || pin.definitionId !== "quote_review"
      || pin.schemaVersion !== 2 || !Number.isInteger(pin.version) || pin.version < 1 || pin.version > 50 || pin.versionId !== `quote_review_v${pin.version}`) fail("Workflow pin is outside the quote review scope.");
    digest(pin.definitionDigest, "Workflow definition digest");
    const rule = policy.approvalPolicy;
    exactKeys(rule, ["basis", "thresholdCents", "allowedRoles"], "Approval policy");
    if (rule.basis !== "absolute_total_delta_cents") fail("Unsupported workflow approval basis.");
    if (rule.thresholdCents !== null) boundedInteger(rule.thresholdCents, "Approval threshold", 1e9);
    if (!Array.isArray(rule.allowedRoles) || !rule.allowedRoles.includes("admin") || rule.allowedRoles.length > 2
      || new Set(rule.allowedRoles).size !== rule.allowedRoles.length || rule.allowedRoles.some(role => !["admin", "sales"].includes(role))
      || !sameJson(rule.allowedRoles, [...rule.allowedRoles].sort())) fail("Invalid workflow participant roles.");
    if (!rule.allowedRoles.includes((value.simulatedBy || value.authorizedFor)?.role)) fail("Workflow policy excludes the receipt participant.");
    exactOpaqueId(policy.declaredBy, "Policy declaring actor", 256, "invalid-server-response");
    if (exactISO(policy.declaredAtISO, "Policy publication time") > (value.simulatedAtISO || value.authorizedAtISO)) fail("Workflow policy was published after the receipt.");
  }
  if (attendance !== null) {
    exactKeys(attendance, ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId", "submissionReceiptId", "submissionReceiptDigest", "count"], "Attendance binding");
    if (attendance.organizationId !== scope.organizationId || attendance.quoteId !== scope.quoteId || attendance.sourceVersionId !== value.baseRevisionId) fail("Attendance binding does not match this exact commercial source.");
    for (const key of ["sourceVersionId", "acceptanceReceiptId", "submissionReceiptId"]) exactOpaqueId(attendance[key], `Attendance ${key}`, 256, "invalid-server-response");
    digest(attendance.submissionReceiptDigest, "Attendance receipt digest");
    if (boundedInteger(attendance.count, "Submitted attendance", 400) < 1) fail("Submitted attendance must be positive.");
  }
  const evaluation = value.approvalEvaluation;
  exactKeys(evaluation, ["currency", "beforeTotalCents", "proposedTotalCents", "absoluteTotalDeltaCents", "impactApprovalRequired", "thresholdApprovalRequired"], "Approval evaluation");
  const before = boundedInteger(evaluation.beforeTotalCents, "Prior total cents", 1e14);
  const after = boundedInteger(evaluation.proposedTotalCents, "Proposed total cents", 1e14);
  const threshold = policy?.approvalPolicy.thresholdCents ?? null;
  if (evaluation.currency !== "USD" || evaluation.absoluteTotalDeltaCents !== Math.abs(after - before)
    || evaluation.thresholdApprovalRequired !== (threshold !== null && Math.abs(after - before) >= threshold)) fail("Workflow threshold evaluation is inconsistent.");
  exactBoolean(evaluation.impactApprovalRequired, "Dependency approval requirement");
  if (impact && evaluation.impactApprovalRequired !== (impact.counts.total > 0)) fail("Workflow dependency approval evaluation is inconsistent.");
  if (commercialValues) {
    // Decimal-string half-up matches the owning server's dollar evidence conversion.
    const cents = (number) => {
      const [mantissa, exponent = "0"] = String(number).toLowerCase().split("e");
      const [whole, fraction = ""] = mantissa.split(".");
      const digits = BigInt(whole + fraction);
      const shift = 2 + Number(exponent) - fraction.length;
      if (shift >= 0) return Number(digits * 10n ** BigInt(shift));
      const divisor = 10n ** BigInt(-shift);
      return Number((digits + divisor / 2n) / divisor);
    };
    if (before !== cents(commercialValues.authoritativeTotal.before) || after !== cents(commercialValues.authoritativeTotal.proposedAfter)) fail("Workflow evaluation differs from authoritative commercial values.");
  }
  return jsonClone({ workflowPolicy: policy, attendanceBinding: attendance, approvalEvaluation: evaluation }, "Bound commercial evidence");
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
    "receiptDigest",
    ...(isBoundReceipt(value, "simulation") ? WORKFLOW_SEAL_FIELDS : [])
  ], "Simulation receipt");
  if (
    (!isBoundReceipt(value, "simulation") && value.schemaVersion !== RECEIPT_SCHEMA_VERSIONS.simulation)
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
  const seal = normalizeWorkflowSeal(value, scope, { impact, commercialValues: normalizeCommercialValues(value.commercialValues) });
  if (authorizationRequired !== (impact.counts.total > 0 || seal.approvalEvaluation?.thresholdApprovalRequired === true)) {
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
    receiptDigest: digest(value.receiptDigest, "Simulation receipt digest"),
    ...seal
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
    ...(isBoundReceipt(receipt, "simulation") ? Object.fromEntries(WORKFLOW_SEAL_FIELDS.map(key => [key, receipt[key]])) : {}),
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
    "receiptDigest",
    ...(isBoundReceipt(value, "authorization") ? WORKFLOW_SEAL_FIELDS : [])
  ], "Commercial change authorization receipt");
  if (
    (!isBoundReceipt(value, "authorization") && value.schemaVersion !== RECEIPT_SCHEMA_VERSIONS.authorization)
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
    receiptDigest: digest(value.receiptDigest, "Authorization receipt digest"),
    ...normalizeWorkflowSeal(value, scope)
  };
}

function normalizeCommercialChangeCommit(value) {
  if (value === null) return null;
  exactKeys(value, [
    "authorityState",
    "applyReceiptId",
    "state",
    "safeToPublish",
    "openInvalidationCount",
    "totalInvalidationCount"
  ], "Commercial change apply commit");
  const authorityState = text(value.authorityState).toLowerCase();
  const state = text(value.state).toUpperCase();
  const safeToPublish = exactBoolean(value.safeToPublish, "Apply publish eligibility");
  const openInvalidationCount = boundedInteger(
    value.openInvalidationCount,
    "Apply open invalidation count",
    MAX_INVALIDATIONS
  );
  const totalInvalidationCount = boundedInteger(
    value.totalInvalidationCount,
    "Apply total invalidation count",
    MAX_INVALIDATIONS
  );
  if (
    authorityState !== "enforced"
    || !["READY", "BLOCKED"].includes(state)
    || totalInvalidationCount < openInvalidationCount
    || safeToPublish !== (state === "READY" && openInvalidationCount === 0)
  ) {
    fail("Commercial change apply commit is inconsistent.");
  }
  return {
    authorityState,
    applyReceiptId: receiptId(value.applyReceiptId, "apply"),
    state,
    safeToPublish,
    openInvalidationCount,
    totalInvalidationCount
  };
}

function normalizeApplyOutcomeReceipt(value, scope, request) {
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "receiptType",
    "receiptId",
    "outcomeReceiptId",
    "requestId",
    "operationId",
    "organizationId",
    "quoteId",
    "simulationReceiptId",
    "simulationDigest",
    "authorizationReceiptId",
    "authorizationReceiptDigest",
    "baseRevisionId",
    "expectedApplyReceiptId",
    "state",
    "activeRevisionId",
    "sourceChanged",
    "applyReceiptId",
    "applyReceiptDigest",
    "newRevisionId",
    "appliedRevisionIsActive",
    "reconciledAtISO",
    "reconciledBy",
    "boundary",
    "receiptDigest"
  ], "Commercial change apply outcome receipt");
  const outcomeReceiptId = receiptId(value.outcomeReceiptId, "outcome");
  const state = text(value.state).toLowerCase();
  const activeRevisionId = exactOpaqueId(
    value.activeRevisionId,
    "Apply outcome activeRevisionId",
    256,
    "invalid-server-response"
  );
  const baseRevisionId = exactOpaqueId(
    value.baseRevisionId,
    "Apply outcome baseRevisionId",
    256,
    "invalid-server-response"
  );
  const sourceChanged = exactBoolean(value.sourceChanged, "Apply outcome source state");
  const appliedRevisionIsActive = exactBoolean(
    value.appliedRevisionIsActive,
    "Apply outcome active applied revision state"
  );
  const authorizationReceiptId = receiptId(value.authorizationReceiptId, "authorization", {
    optional: true
  });
  const authorizationReceiptDigest = text(value.authorizationReceiptDigest)
    ? digest(value.authorizationReceiptDigest, "Apply outcome authorization digest")
    : "";
  if (
    value.schemaVersion !== RECEIPT_SCHEMA_VERSIONS.outcome
    || value.authority !== "server_authoritative"
    || value.receiptType !== "outcome"
    || value.organizationId !== scope.organizationId
    || value.quoteId !== scope.quoteId
    || value.requestId !== request.applyRequestId
    || value.simulationReceiptId !== request.simulationReceiptId
    || authorizationReceiptId !== request.authorizationReceiptId
    || baseRevisionId !== request.expectedBaseRevisionId
    || value.receiptId !== outcomeReceiptId
    || !["committed", "not_committed"].includes(state)
    || sourceChanged !== (activeRevisionId !== baseRevisionId)
    || Boolean(authorizationReceiptId) !== Boolean(authorizationReceiptDigest)
  ) {
    fail("Commercial change apply outcome is outside the exact request scope.");
  }
  const expectedApplyReceiptId = receiptId(value.expectedApplyReceiptId, "apply");
  const applyReceiptId = receiptId(value.applyReceiptId, "apply", { optional: true });
  const applyReceiptDigest = text(value.applyReceiptDigest)
    ? digest(value.applyReceiptDigest, "Apply outcome apply digest")
    : "";
  const newRevisionId = optionalOpaqueId(
    value.newRevisionId,
    "Apply outcome newRevisionId",
    256
  );
  if (state === "committed") {
    if (
      applyReceiptId !== expectedApplyReceiptId
      || !applyReceiptDigest
      || !newRevisionId
      || appliedRevisionIsActive !== (activeRevisionId === newRevisionId)
    ) {
      fail("Committed commercial change apply outcome is incomplete.");
    }
  } else if (applyReceiptId || applyReceiptDigest || newRevisionId || appliedRevisionIsActive) {
    fail("Not-committed commercial change outcome claims apply evidence.");
  }
  return {
    schemaVersion: value.schemaVersion,
    authority: value.authority,
    receiptType: value.receiptType,
    receiptId: outcomeReceiptId,
    outcomeReceiptId,
    requestId: exactRequestId(value.requestId, "apply"),
    operationId: receiptId(value.operationId, "operation"),
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    simulationReceiptId: receiptId(value.simulationReceiptId, "simulation"),
    simulationDigest: digest(value.simulationDigest, "Apply outcome simulation digest"),
    authorizationReceiptId,
    authorizationReceiptDigest,
    baseRevisionId,
    expectedApplyReceiptId,
    state,
    activeRevisionId,
    sourceChanged,
    applyReceiptId,
    applyReceiptDigest,
    newRevisionId,
    appliedRevisionIsActive,
    reconciledAtISO: exactISO(value.reconciledAtISO, "Apply outcome reconciliation time"),
    reconciledBy: exactActor(value.reconciledBy, "Apply outcome reconciliation actor"),
    boundary: exactText(value.boundary, "Apply outcome boundary", 2_000),
    receiptDigest: digest(value.receiptDigest, "Apply outcome receipt digest")
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

function inventoryReasonCode(value) {
  const normalized = text(value).toLowerCase();
  if (!/^[a-z0-9]+(?:_[a-z0-9]+){0,7}$/u.test(normalized) || normalized.length > 96) {
    fail("Inventory observation reasonCode is invalid.");
  }
  return normalized;
}

function normalizeCommercialInventoryObservation(
  value,
  scope,
  simulationReceipt,
  proposedQuoteRevisionId,
  observationRequested
) {
  const commonKeys = [
    "schemaVersion",
    "authority",
    "state",
    "organizationId",
    "quoteId",
    "baseQuoteRevisionId",
    "proposedQuoteRevisionId",
    "commercialSimulationReceiptId",
    "commercialSimulationReceiptDigest",
    "commercialPreviewRevisionId",
    "observedAtISO",
    "boundary"
  ];
  if (!record(value)) fail("Inventory observation must be an exact server object.");
  const state = text(value.state).toLowerCase();
  if (!new Set(["available", "not_requested", "unavailable"]).has(state)) {
    fail("Inventory observation state is invalid.");
  }
  exactKeys(
    value,
    state === "available" ? [...commonKeys, "inputDigest", "preview"] : [...commonKeys, "reasonCode"],
    "Inventory observation"
  );
  const proposedRevisionId = exactOpaqueId(
    proposedQuoteRevisionId,
    "projected quote revision",
    256,
    "invalid-server-response"
  );
  if (
    value.schemaVersion !== "commercial-change-inventory-observation-v1"
    || value.authority !== "inventory_read_only_observation"
    || value.organizationId !== scope.organizationId
    || value.quoteId !== scope.quoteId
    || value.baseQuoteRevisionId !== simulationReceipt.baseRevisionId
    || value.proposedQuoteRevisionId !== proposedRevisionId
    || value.commercialSimulationReceiptId !== simulationReceipt.receiptId
    || value.commercialSimulationReceiptDigest !== simulationReceipt.receiptDigest
    || value.commercialPreviewRevisionId !== simulationReceipt.proposedRevisionId
  ) {
    fail("Inventory observation crossed its Commercial and Inventory authority boundary.");
  }
  if ((!observationRequested && state !== "not_requested")
    || (observationRequested && state === "not_requested")) {
    fail("Inventory observation does not match the requested evaluation scope.");
  }
  const observation = {
    schemaVersion: value.schemaVersion,
    authority: value.authority,
    state,
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    baseQuoteRevisionId: simulationReceipt.baseRevisionId,
    proposedQuoteRevisionId: proposedRevisionId,
    commercialSimulationReceiptId: simulationReceipt.receiptId,
    commercialSimulationReceiptDigest: simulationReceipt.receiptDigest,
    commercialPreviewRevisionId: simulationReceipt.proposedRevisionId,
    observedAtISO: exactISO(value.observedAtISO, "Inventory observation time"),
    boundary: exactText(value.boundary, "Inventory observation boundary", 2_000)
  };
  if (state === "available") {
    observation.inputDigest = digest(value.inputDigest, "Inventory observation input digest");
    try {
      observation.preview = normalizeEventInventoryPreviewResult(
        value.preview,
        scope.organizationId,
        scope.quoteId,
        proposedRevisionId
      );
    } catch (error) {
      fail(error?.message || "Inventory observation preview is invalid.");
    }
  } else {
    observation.reasonCode = inventoryReasonCode(value.reasonCode);
  }
  return deepFreeze(observation);
}

function normalizeStaffingRoleCounts(value, label) {
  exactKeys(value, ["lead", "server", "chef", "bartender"], label);
  return Object.freeze({
    lead: boundedInteger(value.lead, `${label} lead`, 128),
    server: boundedInteger(value.server, `${label} server`, 128),
    chef: boundedInteger(value.chef, `${label} chef`, 128),
    bartender: boundedInteger(value.bartender, `${label} bartender`, 128)
  });
}

function normalizeStaffingWindow(value, label) {
  exactKeys(value, ["startAtISO", "endAtISO"], label);
  const startAtISO = exactISO(value.startAtISO, `${label} start`);
  const endAtISO = exactISO(value.endAtISO, `${label} end`);
  if (Date.parse(endAtISO) <= Date.parse(startAtISO)) {
    fail(`${label} is not a valid event window.`);
  }
  return Object.freeze({ startAtISO, endAtISO });
}

function normalizeCommercialStaffingObservation(
  value,
  scope,
  simulationReceipt,
  proposedQuoteRevisionId
) {
  const commonKeys = [
    "schemaVersion",
    "authority",
    "state",
    "organizationId",
    "quoteId",
    "baseQuoteRevisionId",
    "proposedQuoteRevisionId",
    "commercialSimulationReceiptId",
    "commercialSimulationReceiptDigest",
    "commercialPreviewRevisionId",
    "observedAtISO",
    "boundary"
  ];
  if (!record(value)) fail("Staffing observation must be an exact server object.");
  const state = text(value.state).toLowerCase();
  if (!new Set(["available", "unavailable"]).has(state)) {
    fail("Staffing observation state is invalid.");
  }
  exactKeys(
    value,
    state === "available" ? [...commonKeys, "inputDigest", "preview"] : [...commonKeys, "reasonCode"],
    "Staffing observation"
  );
  const proposedRevisionId = exactOpaqueId(
    proposedQuoteRevisionId,
    "projected quote revision",
    256,
    "invalid-server-response"
  );
  if (
    value.schemaVersion !== "commercial-change-staffing-observation-v1"
    || value.authority !== "operational_staffing_read_only_observation"
    || value.organizationId !== scope.organizationId
    || value.quoteId !== scope.quoteId
    || value.baseQuoteRevisionId !== simulationReceipt.baseRevisionId
    || value.proposedQuoteRevisionId !== proposedRevisionId
    || value.commercialSimulationReceiptId !== simulationReceipt.receiptId
    || value.commercialSimulationReceiptDigest !== simulationReceipt.receiptDigest
    || value.commercialPreviewRevisionId !== simulationReceipt.proposedRevisionId
  ) {
    fail("Staffing observation crossed its Commercial and Staffing authority boundary.");
  }
  const observation = {
    schemaVersion: value.schemaVersion,
    authority: value.authority,
    state,
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    baseQuoteRevisionId: simulationReceipt.baseRevisionId,
    proposedQuoteRevisionId: proposedRevisionId,
    commercialSimulationReceiptId: simulationReceipt.receiptId,
    commercialSimulationReceiptDigest: simulationReceipt.receiptDigest,
    commercialPreviewRevisionId: simulationReceipt.proposedRevisionId,
    observedAtISO: exactISO(value.observedAtISO, "Staffing observation time"),
    boundary: exactText(value.boundary, "Staffing observation boundary", 2_000)
  };
  if (state === "unavailable") {
    observation.reasonCode = inventoryReasonCode(value.reasonCode);
    return deepFreeze(observation);
  }

  exactKeys(value.preview, ["proposed", "currentPlanState", "comparison", "boundary"], "Staffing observation preview");
  exactKeys(
    value.preview.proposed,
    ["quoteRevisionId", "eventWindow", "requirementsByRole", "totalRequired"],
    "Staffing proposed requirement"
  );
  if (value.preview.proposed.quoteRevisionId !== proposedRevisionId) {
    fail("Staffing proposed requirement crossed its quote revision boundary.");
  }
  const requirementsByRole = normalizeStaffingRoleCounts(
    value.preview.proposed.requirementsByRole,
    "Staffing proposed role counts"
  );
  const totalRequired = boundedInteger(
    value.preview.proposed.totalRequired,
    "Staffing proposed total",
    128
  );
  if (Object.values(requirementsByRole).reduce((sum, count) => sum + count, 0) !== totalRequired) {
    fail("Staffing proposed total does not match its bounded role counts.");
  }
  const currentPlanState = text(value.preview.currentPlanState).toLowerCase();
  if (!["absent", "current", "stale"].includes(currentPlanState)) {
    fail("Staffing current plan state is invalid.");
  }
  exactKeys(value.preview.comparison, ["windowState", "coverage"], "Staffing comparison");
  const windowState = text(value.preview.comparison.windowState).toLowerCase();
  if (!["same", "changed", "not_applicable"].includes(windowState)) {
    fail("Staffing proposed window state is invalid.");
  }
  const coverageValue = value.preview.comparison.coverage;
  exactKeys(coverageValue, [
    "state",
    "byRole",
    "totalRequired",
    "totalOperatorConfirmedCount",
    "totalGap",
    "reasonCode"
  ], "Staffing proposed coverage");
  const coverageState = text(coverageValue.state).toLowerCase();
  if (!["unverified", "not_required", "coverage_confirmed", "attention"].includes(coverageState)) {
    fail("Staffing proposed coverage state is invalid.");
  }
  exactKeys(coverageValue.byRole, ["lead", "server", "chef", "bartender"], "Staffing coverage roles");
  const byRole = {};
  let summedConfirmed = 0;
  let summedGap = 0;
  for (const role of ["lead", "server", "chef", "bartender"]) {
    const roleValue = coverageValue.byRole[role];
    exactKeys(roleValue, ["requiredCount", "operatorConfirmedCount", "gap"], `Staffing ${role} coverage`);
    const requiredCount = boundedInteger(roleValue.requiredCount, `Staffing ${role} required`, 128);
    const operatorConfirmedCount = roleValue.operatorConfirmedCount === null
      ? null
      : boundedInteger(roleValue.operatorConfirmedCount, `Staffing ${role} confirmed`, 128);
    const gap = roleValue.gap === null
      ? null
      : boundedInteger(roleValue.gap, `Staffing ${role} gap`, 128);
    if (requiredCount !== requirementsByRole[role]) {
      fail(`Staffing ${role} coverage does not match the proposed requirement.`);
    }
    const roleUnverified = operatorConfirmedCount === null && gap === null;
    const rolePartiallyMissing = (operatorConfirmedCount === null) !== (gap === null);
    if (rolePartiallyMissing || (coverageState === "unverified") !== roleUnverified) {
      fail(`Staffing ${role} coverage does not match the proposed evidence state.`);
    }
    if (!roleUnverified) {
      if (gap !== Math.max(0, requiredCount - operatorConfirmedCount)) {
        fail(`Staffing ${role} gap does not match its aggregate counts.`);
      }
      summedConfirmed += operatorConfirmedCount;
      summedGap += gap;
    }
    byRole[role] = Object.freeze({ requiredCount, operatorConfirmedCount, gap });
  }
  const totalOperatorConfirmedCount = coverageValue.totalOperatorConfirmedCount === null
    ? null
    : boundedInteger(coverageValue.totalOperatorConfirmedCount, "Staffing confirmed total", 128);
  const totalGap = coverageValue.totalGap === null
    ? null
    : boundedInteger(coverageValue.totalGap, "Staffing gap total", 128);
  const totalsUnverified = totalOperatorConfirmedCount === null && totalGap === null;
  const totalsPartiallyMissing = (totalOperatorConfirmedCount === null) !== (totalGap === null);
  if (totalsPartiallyMissing || (coverageState === "unverified") !== totalsUnverified) {
    fail("Staffing aggregate coverage does not match the proposed evidence state.");
  }
  const coverageTotalRequired = boundedInteger(
    coverageValue.totalRequired,
    "Staffing coverage total",
    128
  );
  if (coverageTotalRequired !== totalRequired) {
    fail("Staffing coverage total does not match the proposed requirement total.");
  }
  if (!totalsUnverified && (
    totalOperatorConfirmedCount !== summedConfirmed
    || totalGap !== summedGap
  )) {
    fail("Staffing coverage totals do not match their bounded role evidence.");
  }
  const expectedCoverageState = totalsUnverified
    ? "unverified"
    : totalRequired === 0
      ? "not_required"
      : totalGap === 0
        ? "coverage_confirmed"
        : "attention";
  if (coverageState !== expectedCoverageState) {
    fail("Staffing coverage state does not match its aggregate role evidence.");
  }
  observation.inputDigest = digest(value.inputDigest, "Staffing observation input digest");
  observation.preview = {
    proposed: {
      quoteRevisionId: proposedRevisionId,
      eventWindow: normalizeStaffingWindow(value.preview.proposed.eventWindow, "Staffing proposed event window"),
      requirementsByRole,
      totalRequired
    },
    currentPlanState,
    comparison: {
      windowState,
      coverage: {
        state: coverageState,
        byRole,
        totalRequired: coverageTotalRequired,
        totalOperatorConfirmedCount,
        totalGap,
        reasonCode: inventoryReasonCode(coverageValue.reasonCode)
      }
    },
    boundary: exactText(value.preview.boundary, "Staffing preview boundary", 2_000)
  };
  return deepFreeze(observation);
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
  const eventIngredientOutputs = input.eventIngredientOutputs === undefined
    ? null
    : normalizeEventIngredientOutputs(input.eventIngredientOutputs);
  const response = await callable(COMMERCIAL_CHANGE_AUTHORITY_CALLABLES.simulate)({
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    expectedActiveVersionId,
    requestId,
    form,
    staffingObservationVersion: "v1",
    ...(eventIngredientOutputs ? { eventIngredientOutputs } : {}),
    ...(input.attendanceSubmissionReceiptId ? { attendanceSubmissionReceiptId: exactOpaqueId(input.attendanceSubmissionReceiptId, "attendanceSubmissionReceiptId") } : {})
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
    "simulation",
    "inventoryObservation",
    "staffingObservation",
    "persistedEffects"
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
  if ((input.attendanceSubmissionReceiptId || "") !== (simulationReceipt.attendanceBinding?.submissionReceiptId || "")) fail("Simulation does not bind the reviewed attendance response.");
  const simulation = normalizeSimulationProjection(result.simulation, scope, simulationReceipt);
  const persistedEffects = COMMERCIAL_CHANGE_PERSISTED_EFFECTS_ENABLED
    ? normalizeActivePersistedEffects(
        result.persistedEffects,
        scope,
        simulationReceipt,
        {
          boundedInteger,
          exactBoolean,
          exactKeys,
          exactOpaqueId,
          exactText,
          fail,
          jsonClone,
          normalizeCommercialValues,
          normalizeReceiptImpact,
          sameJson
        }
      )
    : null;
  const proposedQuoteRevisionId = persistedEffects?.identity?.projectedRevisionId
    || exactOpaqueId(
      result.inventoryObservation?.proposedQuoteRevisionId,
      "Inventory observation projected quote revision",
      256,
      "invalid-server-response"
    );
  const inventoryObservation = normalizeCommercialInventoryObservation(
    result.inventoryObservation,
    scope,
    simulationReceipt,
    proposedQuoteRevisionId,
    eventIngredientOutputs !== null
  );
  const staffingObservation = normalizeCommercialStaffingObservation(
    result.staffingObservation,
    scope,
    simulationReceipt,
    proposedQuoteRevisionId
  );
  return deepFreeze({
    ok: true,
    storage: "firebase",
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    idempotent,
    authorityState,
    simulationReceipt,
    simulation,
    inventoryObservation,
    staffingObservation,
    ...(persistedEffects ? { persistedEffects } : {})
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

export async function reconcileCommercialQuoteChangeApplyOutcome(input = {}) {
  const scope = normalizeScope(input);
  const request = {
    simulationReceiptId: inputReceiptId(input.simulationReceiptId, "simulation"),
    authorizationReceiptId: text(input.authorizationReceiptId)
      ? inputReceiptId(input.authorizationReceiptId, "authorization")
      : "",
    applyRequestId: exactRequestId(input.applyRequestId, "apply"),
    expectedBaseRevisionId: exactOpaqueId(
      input.expectedBaseRevisionId,
      "expectedBaseRevisionId"
    )
  };
  const response = await callable(
    COMMERCIAL_CHANGE_AUTHORITY_CALLABLES.reconcileApplyOutcome
  )({
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    ...request
  });
  const result = response?.data;
  exactEnvelope(result, scope, [
    "ok",
    "storage",
    "organizationId",
    "quoteId",
    "idempotent",
    "outcomeReceipt",
    "commercialChange"
  ], "Commercial change apply outcome response");
  const outcomeReceipt = normalizeApplyOutcomeReceipt(
    result.outcomeReceipt,
    scope,
    request
  );
  const commercialChange = normalizeCommercialChangeCommit(result.commercialChange);
  if (
    (outcomeReceipt.state === "committed") !== Boolean(commercialChange)
    || (
      commercialChange
      && commercialChange.applyReceiptId !== outcomeReceipt.applyReceiptId
    )
  ) {
    fail("Commercial change apply outcome and commit projection do not agree.");
  }
  return deepFreeze({
    ok: true,
    storage: "firebase",
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    idempotent: exactBoolean(result.idempotent, "Apply outcome idempotency state"),
    outcomeReceipt,
    commercialChange
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
