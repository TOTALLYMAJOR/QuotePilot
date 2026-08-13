import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const OPERATIONAL_STAFFING_CALLABLES = Object.freeze({
  snapshot: "getOperationalStaffingSnapshot",
  configureProfile: "configureOperationalStaffProfile",
  applyPlan: "applyOperationalStaffingPlan"
});

export const OPERATIONAL_STAFFING_CONTRACT = Object.freeze({
  schemaVersion: 1,
  authority: "server_authoritative",
  authorityVersion: "operational-staffing-authority-v1",
  profileReceiptSchemaVersion: "operational-staff-profile-command-receipt-v1",
  receiptSchemaVersion: "operational-staffing-command-receipt-v1",
  localDraftSchemaVersion: "operational-staffing-local-draft-v1",
  maxProfiles: 128,
  maxAvailabilityWindows: 128,
  maxAssignments: 100,
  maxExistingAssignments: 256,
  maxScheduleFences: 320,
  maxReasonCodes: 16,
  maxRevision: 1_000_000_000
});

export const OPERATIONAL_STAFFING_OPERATIONS = Object.freeze({
  CONFIGURE_PROFILE: "configure_profile",
  APPLY_PLAN: "apply_plan"
});

const ROLES = Object.freeze(["lead", "server", "chef", "bartender"]);
const ROLE_SET = new Set(ROLES);
const PLAN_STATES = new Set(["not_required", "coverage_confirmed", "attention"]);
const AVAILABILITY_STATES = new Set(["available", "unavailable"]);
const ACTOR_ROLES = new Set(["admin", "sales"]);
const ASSIGNMENT_STATE = "operator_confirmed";
const ASSIGNMENT_EVIDENCE_BOUNDARY =
  "operator_confirmed records only an authorized operational assignment. It is not member acknowledgement, attendance, payroll, payment, booking, or event readiness.";
const AVAILABILITY_EVIDENCE_BOUNDARY =
  "Availability windows are recorded by an authorized operator. They are not member acknowledgement, attendance, payroll, or readiness evidence.";
const COVERAGE_EVIDENCE_BOUNDARY =
  "coverage_confirmed means only that every quoted role count is matched by an operator-confirmed assignment for this exact quote revision and event window. It is not event readiness.";
const COMMERCIAL_REQUIREMENT_BOUNDARY =
  "Quoted staffing counts are copied from the exact commercial quote revision for comparison only. This operational record does not edit or replace commercial quote authority.";
const OPAQUE_ID_PATTERN = /^[^\s/?#\\\u0000]{1,256}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{15,159}$/u;
const PROFILE_RECEIPT_ID_PATTERN = /^ospr_[a-f0-9]{48}$/u;
const RECEIPT_ID_PATTERN = /^osr_[a-f0-9]{48}$/u;
const FENCE_ID_PATTERN = /^osf_[a-f0-9]{48}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const UTC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9_:-]{0,79}$/u;
const MAX_EVENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_AVAILABILITY_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;
const MAX_PENDING_ATTEMPTS = 25;
const pendingAttempts = new Map();

const DEFINITIVE_CODES = new Set([
  "aborted",
  "already-exists",
  "data-loss",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "resource-exhausted",
  "unauthenticated"
]);

export class OperationalStaffingClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OperationalStaffingClientError";
    this.code = code;
  }
}

function fail(message, code = "invalid-argument") {
  throw new OperationalStaffingClientError(code, message);
}

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedKeys(value, allowedKeys, label) {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    fail(`${label} contains unsupported fields.`);
  }
  return value;
}

function assertExactKeys(value, expectedKeys, label) {
  assertAllowedKeys(value, expectedKeys, label);
  if (expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    fail(`${label} is missing required fields.`);
  }
  return value;
}

function opaqueId(value, label, maximum = 256) {
  const normalized = text(value);
  if (
    !OPAQUE_ID_PATTERN.test(normalized)
    || normalized.length > maximum
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/u.test(normalized)
  ) {
    fail(`${label} is invalid.`);
  }
  return normalized;
}

function boundedInteger(value, label, { minimum = 0, maximum = OPERATIONAL_STAFFING_CONTRACT.maxRevision } = {}) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    fail(`${label} is invalid.`);
  }
  return normalized;
}

function exactBoolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} is invalid.`);
  return value;
}

function exactISO(value, label) {
  const normalized = text(value);
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail(`${label} must be an exact ISO timestamp.`);
  }
  return normalized;
}

function normalizeTimeWindow(value, label, maximumDurationMs) {
  assertExactKeys(value, ["startAtISO", "endAtISO"], label);
  const startAtISO = exactISO(value.startAtISO, `${label}.startAtISO`);
  const endAtISO = exactISO(value.endAtISO, `${label}.endAtISO`);
  const durationMs = Date.parse(endAtISO) - Date.parse(startAtISO);
  if (durationMs <= 0 || durationMs > maximumDurationMs) {
    fail(`${label} must be a bounded non-empty interval.`);
  }
  return { startAtISO, endAtISO };
}

function normalizeDisplayName(value) {
  const normalized = text(value).replace(/\s+/gu, " ");
  if (
    !normalized
    || normalized.length > 80
    || /[\u0000-\u001f\u007f<>]/u.test(normalized)
    || /^[^@\s]+@[^@\s]+$/u.test(normalized)
  ) {
    fail("displayName is invalid.");
  }
  return normalized;
}

function normalizeRole(value, label) {
  const normalized = text(value).toLowerCase();
  if (!ROLE_SET.has(normalized)) fail(`${label} is invalid.`);
  return normalized;
}

function normalizeCapabilities(value, label = "capabilities") {
  if (!Array.isArray(value) || !value.length || value.length > ROLES.length) {
    fail(`${label} must be a non-empty bounded role list.`);
  }
  const normalized = value.map((item) => normalizeRole(item, label)).sort();
  if (new Set(normalized).size !== normalized.length) fail(`${label} cannot contain duplicates.`);
  return normalized;
}

function normalizeAvailabilityWindows(value, label = "availabilityWindows") {
  if (!Array.isArray(value) || value.length > OPERATIONAL_STAFFING_CONTRACT.maxAvailabilityWindows) {
    fail(`${label} must be a bounded array.`);
  }
  const windows = value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(
      item,
      ["availabilityId", "source", "state", "startAtISO", "endAtISO"],
      itemLabel
    );
    if (text(item.source).toLowerCase() !== "operator_recorded") {
      fail(`${itemLabel}.source is invalid.`);
    }
    const state = text(item.state).toLowerCase();
    if (!AVAILABILITY_STATES.has(state)) fail(`${itemLabel}.state is invalid.`);
    return {
      availabilityId: opaqueId(item.availabilityId, `${itemLabel}.availabilityId`, 160),
      source: "operator_recorded",
      state,
      ...normalizeTimeWindow(
        { startAtISO: item.startAtISO, endAtISO: item.endAtISO },
        itemLabel,
        MAX_AVAILABILITY_WINDOW_MS
      )
    };
  }).sort((left, right) => (
    left.startAtISO.localeCompare(right.startAtISO)
    || left.endAtISO.localeCompare(right.endAtISO)
    || left.availabilityId.localeCompare(right.availabilityId)
  ));
  if (new Set(windows.map((item) => item.availabilityId)).size !== windows.length) {
    fail(`${label} contains duplicate availability IDs.`);
  }
  for (let index = 1; index < windows.length; index += 1) {
    if (Date.parse(windows[index].startAtISO) < Date.parse(windows[index - 1].endAtISO)) {
      fail(`${label} cannot contain overlapping windows.`, "failed-precondition");
    }
  }
  return windows;
}

function normalizeRoleCounts(value, label) {
  assertExactKeys(value, ROLES, label);
  const byRole = Object.fromEntries(ROLES.map((role) => [
    role,
    boundedInteger(value[role], `${label}.${role}`, {
      maximum: OPERATIONAL_STAFFING_CONTRACT.maxAssignments
    })
  ]));
  if (Object.values(byRole).reduce((total, count) => total + count, 0) > OPERATIONAL_STAFFING_CONTRACT.maxAssignments) {
    fail(`${label} exceeds the bounded staffing total.`, "resource-exhausted");
  }
  return byRole;
}

function normalizeCandidateAssignments(value, label = "assignments") {
  if (!Array.isArray(value) || value.length > OPERATIONAL_STAFFING_CONTRACT.maxAssignments) {
    fail(`${label} must be a bounded array.`);
  }
  const assignments = value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(
      item,
      ["assignmentId", "staffId", "role", "expectedStaffRevision", "state"],
      itemLabel
    );
    if (text(item.state).toLowerCase() !== ASSIGNMENT_STATE) {
      fail(`${itemLabel}.state must be operator_confirmed.`);
    }
    return {
      assignmentId: opaqueId(item.assignmentId, `${itemLabel}.assignmentId`, 160),
      staffId: opaqueId(item.staffId, `${itemLabel}.staffId`, 160),
      role: normalizeRole(item.role, `${itemLabel}.role`),
      expectedStaffRevision: boundedInteger(
        item.expectedStaffRevision,
        `${itemLabel}.expectedStaffRevision`,
        { minimum: 1 }
      ),
      state: ASSIGNMENT_STATE
    };
  }).sort((left, right) => (
    left.role.localeCompare(right.role)
    || left.staffId.localeCompare(right.staffId)
    || left.assignmentId.localeCompare(right.assignmentId)
  ));
  if (new Set(assignments.map((item) => item.assignmentId)).size !== assignments.length) {
    fail(`${label} contains duplicate assignment IDs.`, "failed-precondition");
  }
  if (new Set(assignments.map((item) => item.staffId)).size !== assignments.length) {
    fail(`${label} assigns one staff profile more than once.`, "failed-precondition");
  }
  return assignments;
}

function normalizeExpectedScheduleFences(value, label = "expectedScheduleFences") {
  if (!Array.isArray(value) || value.length > OPERATIONAL_STAFFING_CONTRACT.maxScheduleFences) {
    fail(`${label} must be a bounded array.`);
  }
  const fences = value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(item, ["fenceId", "revision"], itemLabel);
    const fenceId = text(item.fenceId);
    if (!FENCE_ID_PATTERN.test(fenceId)) fail(`${itemLabel}.fenceId is invalid.`);
    return {
      fenceId,
      revision: boundedInteger(item.revision, `${itemLabel}.revision`)
    };
  }).sort((left, right) => left.fenceId.localeCompare(right.fenceId));
  if (new Set(fences.map((item) => item.fenceId)).size !== fences.length) {
    fail(`${label} contains duplicate fence IDs.`);
  }
  return fences;
}

function normalizeReadScheduleFenceRefs(value, label = "expectedScheduleFences") {
  if (!Array.isArray(value) || value.length > OPERATIONAL_STAFFING_CONTRACT.maxScheduleFences) {
    fail(`${label} must be a bounded array.`);
  }
  const fences = value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(item, ["fenceId", "staffId", "utcDate", "revision"], itemLabel);
    const fenceId = text(item.fenceId);
    if (!FENCE_ID_PATTERN.test(fenceId)) fail(`${itemLabel}.fenceId is invalid.`);
    return {
      fenceId,
      staffId: opaqueId(item.staffId, `${itemLabel}.staffId`, 160),
      utcDate: normalizeUtcDate(item.utcDate, `${itemLabel}.utcDate`),
      revision: boundedInteger(item.revision, `${itemLabel}.revision`)
    };
  }).sort((left, right) => left.fenceId.localeCompare(right.fenceId));
  if (new Set(fences.map((item) => item.fenceId)).size !== fences.length) {
    fail(`${label} contains duplicate fence IDs.`);
  }
  return fences;
}

function normalizeProfileDraft(value) {
  assertExactKeys(value, ["displayName", "active", "capabilities", "availabilityWindows"], "profile");
  return {
    displayName: normalizeDisplayName(value.displayName),
    active: exactBoolean(value.active, "profile.active"),
    capabilities: normalizeCapabilities(value.capabilities),
    availabilityWindows: normalizeAvailabilityWindows(value.availabilityWindows)
  };
}

function normalizeProfileMutation(input = {}) {
  assertAllowedKeys(
    input,
    ["requestId", "organizationId", "staffId", "expectedRevision", "profile"],
    "operational staff profile command"
  );
  ["organizationId", "staffId", "expectedRevision", "profile"].forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) fail(`Operational staff profile command is missing ${key}.`);
  });
  return {
    organizationId: opaqueId(input.organizationId, "organizationId"),
    staffId: opaqueId(input.staffId, "staffId", 160),
    expectedRevision: boundedInteger(input.expectedRevision, "expectedRevision"),
    profile: normalizeProfileDraft(input.profile)
  };
}

function normalizePlanMutation(input = {}) {
  assertAllowedKeys(
    input,
    [
      "requestId",
      "organizationId",
      "quoteId",
      "expectedQuoteRevisionId",
      "expectedPlanRevision",
      "eventWindow",
      "requirements",
      "assignments",
      "expectedScheduleFences"
    ],
    "operational staffing command"
  );
  [
    "organizationId",
    "quoteId",
    "expectedQuoteRevisionId",
    "expectedPlanRevision",
    "eventWindow",
    "requirements",
    "assignments",
    "expectedScheduleFences"
  ].forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) fail(`Operational staffing command is missing ${key}.`);
  });
  return {
    organizationId: opaqueId(input.organizationId, "organizationId"),
    quoteId: opaqueId(input.quoteId, "quoteId"),
    expectedQuoteRevisionId: opaqueId(input.expectedQuoteRevisionId, "expectedQuoteRevisionId", 180),
    expectedPlanRevision: boundedInteger(input.expectedPlanRevision, "expectedPlanRevision"),
    eventWindow: normalizeTimeWindow(input.eventWindow, "eventWindow", MAX_EVENT_WINDOW_MS),
    requirements: normalizeRoleCounts(input.requirements, "requirements"),
    assignments: normalizeCandidateAssignments(input.assignments),
    expectedScheduleFences: normalizeExpectedScheduleFences(input.expectedScheduleFences)
  };
}

function normalizeScope(input = {}) {
  assertExactKeys(input, ["organizationId", "quoteId"], "operational staffing scope");
  return {
    organizationId: opaqueId(input.organizationId, "organizationId"),
    quoteId: opaqueId(input.quoteId, "quoteId")
  };
}

function normalizeProfileProjection(value, expectedScope = {}) {
  assertExactKeys(value, [
    "schemaVersion",
    "authority",
    "organizationId",
    "staffId",
    "displayName",
    "active",
    "capabilities",
    "revision",
    "availabilityWindows",
    "availabilityBoundary"
  ], "operational staff profile projection");
  const profile = {
    schemaVersion: boundedInteger(value.schemaVersion, "profile.schemaVersion", { minimum: 1, maximum: 1 }),
    authority: text(value.authority),
    organizationId: opaqueId(value.organizationId, "profile.organizationId"),
    staffId: opaqueId(value.staffId, "profile.staffId", 160),
    displayName: normalizeDisplayName(value.displayName),
    active: exactBoolean(value.active, "profile.active"),
    capabilities: normalizeCapabilities(value.capabilities),
    revision: boundedInteger(value.revision, "profile.revision", { minimum: 1 }),
    availabilityWindows: normalizeAvailabilityWindows(value.availabilityWindows, "profile.availabilityWindows"),
    availabilityBoundary: text(value.availabilityBoundary)
  };
  if (
    profile.authority !== OPERATIONAL_STAFFING_CONTRACT.authority
    || profile.availabilityBoundary !== AVAILABILITY_EVIDENCE_BOUNDARY
    || (expectedScope.organizationId && profile.organizationId !== expectedScope.organizationId)
    || (expectedScope.staffId && profile.staffId !== expectedScope.staffId)
  ) {
    fail("Operational staff profile projection is outside its exact authority scope.");
  }
  return profile;
}

function normalizeProjectedAssignments(value, label = "snapshot.assignments") {
  if (!Array.isArray(value) || value.length > OPERATIONAL_STAFFING_CONTRACT.maxAssignments) {
    fail(`${label} must be a bounded array.`);
  }
  const assignments = value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(
      item,
      ["assignmentId", "staffId", "displayName", "role", "staffRevision", "state"],
      itemLabel
    );
    if (text(item.state).toLowerCase() !== ASSIGNMENT_STATE) fail(`${itemLabel}.state is invalid.`);
    return {
      assignmentId: opaqueId(item.assignmentId, `${itemLabel}.assignmentId`, 160),
      staffId: opaqueId(item.staffId, `${itemLabel}.staffId`, 160),
      displayName: normalizeDisplayName(item.displayName),
      role: normalizeRole(item.role, `${itemLabel}.role`),
      staffRevision: boundedInteger(item.staffRevision, `${itemLabel}.staffRevision`, { minimum: 1 }),
      state: ASSIGNMENT_STATE
    };
  }).sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
  if (new Set(assignments.map((item) => item.assignmentId)).size !== assignments.length) {
    fail(`${label} contains duplicate assignment IDs.`);
  }
  if (new Set(assignments.map((item) => item.staffId)).size !== assignments.length) {
    fail(`${label} assigns one staff profile more than once.`);
  }
  return assignments;
}

function normalizeCoverage(value, requirements, assignments) {
  assertExactKeys(value, [
    "state",
    "byRole",
    "totalQuotedCount",
    "totalOperatorConfirmedCount",
    "totalGap",
    "boundary"
  ], "snapshot.coverage");
  assertExactKeys(value.byRole, ROLES, "snapshot.coverage.byRole");
  const confirmedByRole = Object.fromEntries(ROLES.map((role) => [
    role,
    assignments.filter((assignment) => assignment.role === role).length
  ]));
  const byRole = {};
  ROLES.forEach((role) => {
    const item = value.byRole[role];
    assertExactKeys(item, ["quotedCount", "operatorConfirmedCount", "gap"], `snapshot.coverage.byRole.${role}`);
    byRole[role] = {
      quotedCount: boundedInteger(item.quotedCount, `snapshot.coverage.byRole.${role}.quotedCount`, {
        maximum: OPERATIONAL_STAFFING_CONTRACT.maxAssignments
      }),
      operatorConfirmedCount: boundedInteger(
        item.operatorConfirmedCount,
        `snapshot.coverage.byRole.${role}.operatorConfirmedCount`,
        { maximum: OPERATIONAL_STAFFING_CONTRACT.maxAssignments }
      ),
      gap: boundedInteger(item.gap, `snapshot.coverage.byRole.${role}.gap`, {
        maximum: OPERATIONAL_STAFFING_CONTRACT.maxAssignments
      })
    };
    if (
      byRole[role].quotedCount !== requirements[role]
      || byRole[role].operatorConfirmedCount !== confirmedByRole[role]
      || byRole[role].gap !== Math.max(0, requirements[role] - confirmedByRole[role])
    ) {
      fail(`snapshot.coverage.byRole.${role} is inconsistent.`);
    }
  });
  const totalQuotedCount = Object.values(requirements).reduce((total, count) => total + count, 0);
  const totalGap = Object.values(byRole).reduce((total, item) => total + item.gap, 0);
  const state = text(value.state);
  const expectedState = totalQuotedCount === 0
    ? "not_required"
    : totalGap === 0
      ? "coverage_confirmed"
      : "attention";
  if (
    !PLAN_STATES.has(state)
    || state !== expectedState
    || value.totalQuotedCount !== totalQuotedCount
    || value.totalOperatorConfirmedCount !== assignments.length
    || value.totalGap !== totalGap
    || text(value.boundary) !== COVERAGE_EVIDENCE_BOUNDARY
  ) {
    fail("Operational staffing coverage projection is inconsistent.");
  }
  return {
    state,
    byRole,
    totalQuotedCount,
    totalOperatorConfirmedCount: assignments.length,
    totalGap,
    boundary: COVERAGE_EVIDENCE_BOUNDARY
  };
}

function normalizePlanProjection(value, expectedScope = {}) {
  assertExactKeys(value, [
    "schemaVersion",
    "authority",
    "organizationId",
    "quoteId",
    "quoteRevisionId",
    "planRevision",
    "eventWindow",
    "state",
    "requirements",
    "coverage",
    "assignments",
    "assignmentState",
    "assignmentBoundary"
  ], "operational staffing snapshot");
  assertExactKeys(value.requirements, ["source", "byRole", "boundary"], "snapshot.requirements");
  const requirements = normalizeRoleCounts(value.requirements.byRole, "snapshot.requirements.byRole");
  const assignments = normalizeProjectedAssignments(value.assignments);
  const coverage = normalizeCoverage(value.coverage, requirements, assignments);
  const snapshot = {
    schemaVersion: boundedInteger(value.schemaVersion, "snapshot.schemaVersion", { minimum: 1, maximum: 1 }),
    authority: text(value.authority),
    organizationId: opaqueId(value.organizationId, "snapshot.organizationId"),
    quoteId: opaqueId(value.quoteId, "snapshot.quoteId"),
    quoteRevisionId: opaqueId(value.quoteRevisionId, "snapshot.quoteRevisionId", 180),
    planRevision: boundedInteger(value.planRevision, "snapshot.planRevision", { minimum: 1 }),
    eventWindow: normalizeTimeWindow(value.eventWindow, "snapshot.eventWindow", MAX_EVENT_WINDOW_MS),
    state: text(value.state),
    requirements: {
      source: text(value.requirements.source),
      byRole: requirements,
      boundary: text(value.requirements.boundary)
    },
    coverage,
    assignments,
    assignmentState: text(value.assignmentState),
    assignmentBoundary: text(value.assignmentBoundary)
  };
  if (
    snapshot.authority !== OPERATIONAL_STAFFING_CONTRACT.authority
    || snapshot.state !== coverage.state
    || snapshot.requirements.source !== "commercial_quote_copy"
    || snapshot.requirements.boundary !== COMMERCIAL_REQUIREMENT_BOUNDARY
    || snapshot.assignmentState !== ASSIGNMENT_STATE
    || snapshot.assignmentBoundary !== ASSIGNMENT_EVIDENCE_BOUNDARY
    || (expectedScope.organizationId && snapshot.organizationId !== expectedScope.organizationId)
    || (expectedScope.quoteId && snapshot.quoteId !== expectedScope.quoteId)
    || (expectedScope.quoteRevisionId && snapshot.quoteRevisionId !== expectedScope.quoteRevisionId)
  ) {
    fail("Operational staffing snapshot is outside its exact authority scope.");
  }
  return snapshot;
}

function normalizeActor(value, expectedOrganizationId, { adminOnly = false } = {}) {
  assertExactKeys(value, ["organizationId", "uid", "role"], "receipt.recordedBy");
  const actor = {
    organizationId: opaqueId(value.organizationId, "receipt.recordedBy.organizationId"),
    uid: opaqueId(value.uid, "receipt.recordedBy.uid", 160),
    role: text(value.role).toLowerCase()
  };
  if (
    actor.organizationId !== expectedOrganizationId
    || !ACTOR_ROLES.has(actor.role)
    || (adminOnly && actor.role !== "admin")
  ) {
    fail("Receipt actor evidence is invalid.");
  }
  return actor;
}

function digest(value, label) {
  const normalized = text(value).toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) fail(`${label} is invalid.`);
  return normalized;
}

function normalizeProfileReceipt(value, expected, snapshot) {
  assertExactKeys(value, [
    "schemaVersion",
    "authority",
    "receiptType",
    "receiptId",
    "requestId",
    "organizationId",
    "staffId",
    "priorRevision",
    "resultRevision",
    "requestDigest",
    "commandDigest",
    "evidenceDigest",
    "resultProfileDigest",
    "snapshot",
    "recordedAtISO",
    "recordedBy",
    "availabilityBoundary",
    "receiptDigest"
  ], "operational staff profile receipt");
  const receiptId = text(value.receiptId).toLowerCase();
  const receiptSnapshot = normalizeProfileProjection(value.snapshot, expected);
  const receipt = {
    schemaVersion: text(value.schemaVersion),
    authority: text(value.authority),
    receiptType: text(value.receiptType),
    receiptId,
    requestId: text(value.requestId),
    organizationId: opaqueId(value.organizationId, "profile receipt.organizationId"),
    staffId: opaqueId(value.staffId, "profile receipt.staffId", 160),
    priorRevision: boundedInteger(value.priorRevision, "profile receipt.priorRevision"),
    resultRevision: boundedInteger(value.resultRevision, "profile receipt.resultRevision", { minimum: 1 }),
    requestDigest: digest(value.requestDigest, "profile receipt.requestDigest"),
    commandDigest: digest(value.commandDigest, "profile receipt.commandDigest"),
    evidenceDigest: digest(value.evidenceDigest, "profile receipt.evidenceDigest"),
    resultProfileDigest: digest(value.resultProfileDigest, "profile receipt.resultProfileDigest"),
    snapshot: receiptSnapshot,
    recordedAtISO: exactISO(value.recordedAtISO, "profile receipt.recordedAtISO"),
    recordedBy: normalizeActor(value.recordedBy, expected.organizationId, { adminOnly: true }),
    availabilityBoundary: text(value.availabilityBoundary),
    receiptDigest: digest(value.receiptDigest, "profile receipt.receiptDigest")
  };
  if (
    receipt.schemaVersion !== OPERATIONAL_STAFFING_CONTRACT.profileReceiptSchemaVersion
    || receipt.authority !== OPERATIONAL_STAFFING_CONTRACT.authority
    || receipt.receiptType !== "operational_staff_profile_command"
    || !PROFILE_RECEIPT_ID_PATTERN.test(receipt.receiptId)
    || receipt.requestId !== expected.requestId
    || receipt.organizationId !== expected.organizationId
    || receipt.staffId !== expected.staffId
    || receipt.priorRevision !== expected.expectedRevision
    || receipt.resultRevision !== expected.expectedRevision + 1
    || receipt.resultRevision !== snapshot.revision
    || receipt.availabilityBoundary !== AVAILABILITY_EVIDENCE_BOUNDARY
    || canonical(receipt.snapshot) !== canonical(snapshot)
  ) {
    fail("Operational staff profile receipt is inconsistent.");
  }
  return receipt;
}

function normalizeUtcDate(value, label) {
  const normalized = text(value);
  if (!UTC_DATE_PATTERN.test(normalized) || new Date(`${normalized}T00:00:00.000Z`).toISOString().slice(0, 10) !== normalized) {
    fail(`${label} is invalid.`);
  }
  return normalized;
}

function normalizeScheduleFenceInputs(value, expected) {
  if (!Array.isArray(value) || value.length > OPERATIONAL_STAFFING_CONTRACT.maxScheduleFences) {
    fail("receipt.scheduleFenceInputs must be a bounded array.");
  }
  const inputs = value.map((item, index) => {
    const label = `receipt.scheduleFenceInputs[${index}]`;
    assertExactKeys(item, [
      "schemaVersion",
      "organizationId",
      "fenceId",
      "staffId",
      "utcDate",
      "revision",
      "assignments",
      "assignmentsTruncated"
    ], label);
    const fenceId = text(item.fenceId);
    if (!FENCE_ID_PATTERN.test(fenceId)) fail(`${label}.fenceId is invalid.`);
    return {
      schemaVersion: boundedInteger(item.schemaVersion, `${label}.schemaVersion`, { minimum: 1, maximum: 1 }),
      organizationId: opaqueId(item.organizationId, `${label}.organizationId`),
      fenceId,
      staffId: opaqueId(item.staffId, `${label}.staffId`, 160),
      utcDate: normalizeUtcDate(item.utcDate, `${label}.utcDate`),
      revision: boundedInteger(item.revision, `${label}.revision`),
      assignments: normalizeFenceAssignments(
        item.assignments,
        `${label}.assignments`,
        item.organizationId,
        item.staffId,
        item.utcDate
      ),
      assignmentsTruncated: exactBoolean(item.assignmentsTruncated, `${label}.assignmentsTruncated`)
    };
  }).sort((left, right) => left.fenceId.localeCompare(right.fenceId));
  if (
    new Set(inputs.map((item) => item.fenceId)).size !== inputs.length
    || inputs.some((item) => item.organizationId !== expected.organizationId)
    || inputs.some((item) => item.assignmentsTruncated !== false)
    || canonical(inputs.map(({ fenceId, revision }) => ({ fenceId, revision })))
      !== canonical(expected.expectedScheduleFences)
  ) {
    fail("Receipt schedule fence inputs are inconsistent.");
  }
  return inputs;
}

function utcDatesForWindow(value) {
  const start = new Date(value.startAtISO);
  const last = new Date(Date.parse(value.endAtISO) - 1);
  const dates = [];
  let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const lastDay = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  for (; cursor <= lastDay; cursor += 24 * 60 * 60 * 1_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

function normalizeFenceAssignments(value, label, expectedOrganizationId, expectedStaffId, expectedUtcDate) {
  if (!Array.isArray(value) || value.length > OPERATIONAL_STAFFING_CONTRACT.maxExistingAssignments) {
    fail(`${label} must be a bounded array.`);
  }
  const assignments = value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(item, [
      "organizationId",
      "assignmentId",
      "quoteId",
      "quoteRevisionId",
      "planRevision",
      "staffId",
      "role",
      "state",
      "eventWindow"
    ], itemLabel);
    const assignment = {
      organizationId: opaqueId(item.organizationId, `${itemLabel}.organizationId`),
      assignmentId: opaqueId(item.assignmentId, `${itemLabel}.assignmentId`, 160),
      quoteId: opaqueId(item.quoteId, `${itemLabel}.quoteId`, 160),
      quoteRevisionId: opaqueId(item.quoteRevisionId, `${itemLabel}.quoteRevisionId`, 180),
      planRevision: boundedInteger(item.planRevision, `${itemLabel}.planRevision`, { minimum: 1 }),
      staffId: opaqueId(item.staffId, `${itemLabel}.staffId`, 160),
      role: normalizeRole(item.role, `${itemLabel}.role`),
      state: text(item.state).toLowerCase(),
      eventWindow: normalizeTimeWindow(item.eventWindow, `${itemLabel}.eventWindow`, MAX_EVENT_WINDOW_MS)
    };
    if (
      assignment.organizationId !== text(expectedOrganizationId)
      || assignment.staffId !== text(expectedStaffId)
      || assignment.state !== ASSIGNMENT_STATE
      || !utcDatesForWindow(assignment.eventWindow).includes(text(expectedUtcDate))
    ) {
      fail(`${itemLabel} is outside its exact fence scope.`);
    }
    return assignment;
  }).sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
  if (new Set(assignments.map((item) => item.assignmentId)).size !== assignments.length) {
    fail(`${label} contains duplicate assignment IDs.`);
  }
  return assignments;
}

function normalizeScheduleFenceOutputs(value, inputs, expectedReceiptId, recordedAtISO) {
  if (!Array.isArray(value) || value.length !== inputs.length) {
    fail("receipt.scheduleFenceOutputs are inconsistent.");
  }
  const inputById = new Map(inputs.map((item) => [item.fenceId, item]));
  const outputs = value.map((item, index) => {
    const label = `receipt.scheduleFenceOutputs[${index}]`;
    assertExactKeys(
      item,
      ["fenceId", "organizationId", "staffId", "utcDate", "expectedRevision", "nextRevision", "nextProjection"],
      label
    );
    assertExactKeys(item.nextProjection, [
      "schemaVersion",
      "authority",
      "organizationId",
      "fenceId",
      "staffId",
      "utcDate",
      "revision",
      "assignments",
      "assignmentsTruncated",
      "updatedAtISO",
      "lastCommandReceiptId"
    ], `${label}.nextProjection`);
    const fenceId = text(item.fenceId);
    const input = inputById.get(fenceId);
    const output = {
      fenceId,
      organizationId: opaqueId(item.organizationId, `${label}.organizationId`),
      staffId: opaqueId(item.staffId, `${label}.staffId`, 160),
      utcDate: normalizeUtcDate(item.utcDate, `${label}.utcDate`),
      expectedRevision: boundedInteger(item.expectedRevision, `${label}.expectedRevision`),
      nextRevision: boundedInteger(item.nextRevision, `${label}.nextRevision`, { minimum: 1 }),
      nextProjection: {
        schemaVersion: boundedInteger(item.nextProjection.schemaVersion, `${label}.nextProjection.schemaVersion`, {
          minimum: 1,
          maximum: 1
        }),
        authority: text(item.nextProjection.authority),
        organizationId: opaqueId(item.nextProjection.organizationId, `${label}.nextProjection.organizationId`),
        fenceId: text(item.nextProjection.fenceId),
        staffId: opaqueId(item.nextProjection.staffId, `${label}.nextProjection.staffId`, 160),
        utcDate: normalizeUtcDate(item.nextProjection.utcDate, `${label}.nextProjection.utcDate`),
        revision: boundedInteger(item.nextProjection.revision, `${label}.nextProjection.revision`, { minimum: 1 }),
        assignments: normalizeFenceAssignments(
          item.nextProjection.assignments,
          `${label}.nextProjection.assignments`,
          item.nextProjection.organizationId,
          item.nextProjection.staffId,
          item.nextProjection.utcDate
        ),
        assignmentsTruncated: exactBoolean(
          item.nextProjection.assignmentsTruncated,
          `${label}.nextProjection.assignmentsTruncated`
        ),
        updatedAtISO: exactISO(item.nextProjection.updatedAtISO, `${label}.nextProjection.updatedAtISO`),
        lastCommandReceiptId: text(item.nextProjection.lastCommandReceiptId).toLowerCase()
      }
    };
    if (
      !input
      || output.organizationId !== input.organizationId
      || output.staffId !== input.staffId
      || output.utcDate !== input.utcDate
      || output.expectedRevision !== input.revision
      || output.nextRevision !== input.revision + 1
      || output.nextProjection.authority !== "operational_staffing_schedule_fence"
      || output.nextProjection.organizationId !== output.organizationId
      || output.nextProjection.fenceId !== output.fenceId
      || output.nextProjection.staffId !== output.staffId
      || output.nextProjection.utcDate !== output.utcDate
      || output.nextProjection.revision !== output.nextRevision
      || output.nextProjection.assignmentsTruncated !== false
      || output.nextProjection.updatedAtISO !== recordedAtISO
      || output.nextProjection.lastCommandReceiptId !== expectedReceiptId
    ) {
      fail(`${label} is inconsistent.`);
    }
    return output;
  }).sort((left, right) => left.fenceId.localeCompare(right.fenceId));
  if (new Set(outputs.map((item) => item.fenceId)).size !== outputs.length) {
    fail("Receipt schedule fence outputs contain duplicate IDs.");
  }
  return outputs;
}

function normalizePlanReceipt(value, expected, snapshot) {
  assertExactKeys(value, [
    "schemaVersion",
    "authority",
    "receiptType",
    "receiptId",
    "requestId",
    "organizationId",
    "quoteId",
    "quoteRevisionId",
    "priorPlanRevision",
    "resultPlanRevision",
    "requestDigest",
    "commandDigest",
    "evidenceDigest",
    "resultPlanDigest",
    "assignmentState",
    "planState",
    "scheduleFenceInputs",
    "scheduleFenceOutputs",
    "snapshot",
    "recordedAtISO",
    "recordedBy",
    "assignmentBoundary",
    "coverageBoundary",
    "commercialRequirementBoundary",
    "receiptDigest"
  ], "operational staffing receipt");
  const receiptId = text(value.receiptId).toLowerCase();
  const recordedAtISO = exactISO(value.recordedAtISO, "receipt.recordedAtISO");
  const scheduleFenceInputs = normalizeScheduleFenceInputs(value.scheduleFenceInputs, expected);
  const scheduleFenceOutputs = normalizeScheduleFenceOutputs(
    value.scheduleFenceOutputs,
    scheduleFenceInputs,
    receiptId,
    recordedAtISO
  );
  const receiptSnapshot = normalizePlanProjection(value.snapshot, {
    organizationId: expected.organizationId,
    quoteId: expected.quoteId,
    quoteRevisionId: expected.expectedQuoteRevisionId
  });
  const receipt = {
    schemaVersion: text(value.schemaVersion),
    authority: text(value.authority),
    receiptType: text(value.receiptType),
    receiptId,
    requestId: text(value.requestId),
    organizationId: opaqueId(value.organizationId, "receipt.organizationId"),
    quoteId: opaqueId(value.quoteId, "receipt.quoteId"),
    quoteRevisionId: opaqueId(value.quoteRevisionId, "receipt.quoteRevisionId", 180),
    priorPlanRevision: boundedInteger(value.priorPlanRevision, "receipt.priorPlanRevision"),
    resultPlanRevision: boundedInteger(value.resultPlanRevision, "receipt.resultPlanRevision", { minimum: 1 }),
    requestDigest: digest(value.requestDigest, "receipt.requestDigest"),
    commandDigest: digest(value.commandDigest, "receipt.commandDigest"),
    evidenceDigest: digest(value.evidenceDigest, "receipt.evidenceDigest"),
    resultPlanDigest: digest(value.resultPlanDigest, "receipt.resultPlanDigest"),
    assignmentState: text(value.assignmentState),
    planState: text(value.planState),
    scheduleFenceInputs,
    scheduleFenceOutputs,
    snapshot: receiptSnapshot,
    recordedAtISO,
    recordedBy: normalizeActor(value.recordedBy, expected.organizationId),
    assignmentBoundary: text(value.assignmentBoundary),
    coverageBoundary: text(value.coverageBoundary),
    commercialRequirementBoundary: text(value.commercialRequirementBoundary),
    receiptDigest: digest(value.receiptDigest, "receipt.receiptDigest")
  };
  if (
    receipt.schemaVersion !== OPERATIONAL_STAFFING_CONTRACT.receiptSchemaVersion
    || receipt.authority !== OPERATIONAL_STAFFING_CONTRACT.authority
    || receipt.receiptType !== "operational_staffing_command"
    || !RECEIPT_ID_PATTERN.test(receipt.receiptId)
    || receipt.requestId !== expected.requestId
    || receipt.organizationId !== expected.organizationId
    || receipt.quoteId !== expected.quoteId
    || receipt.quoteRevisionId !== expected.expectedQuoteRevisionId
    || receipt.priorPlanRevision !== expected.expectedPlanRevision
    || receipt.resultPlanRevision !== expected.expectedPlanRevision + 1
    || receipt.resultPlanRevision !== snapshot.planRevision
    || receipt.assignmentState !== ASSIGNMENT_STATE
    || receipt.planState !== snapshot.state
    || receipt.assignmentBoundary !== ASSIGNMENT_EVIDENCE_BOUNDARY
    || receipt.coverageBoundary !== COVERAGE_EVIDENCE_BOUNDARY
    || receipt.commercialRequirementBoundary !== COMMERCIAL_REQUIREMENT_BOUNDARY
    || canonical(receipt.snapshot) !== canonical(snapshot)
  ) {
    fail("Operational staffing receipt is inconsistent.");
  }
  return receipt;
}

function randomHex32() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replaceAll("-", "").toLowerCase();
  }
  return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
    .replace(/[^a-f0-9]/gu, "")
    .padEnd(32, "0")
    .slice(0, 32);
}

function normalizeOperation(value) {
  const operation = text(value).toLowerCase();
  if (!Object.values(OPERATIONAL_STAFFING_OPERATIONS).includes(operation)) {
    fail("Operational staffing operation is invalid.");
  }
  return operation;
}

export function buildOperationalStaffingRequestId(operation = OPERATIONAL_STAFFING_OPERATIONS.APPLY_PLAN) {
  const normalizedOperation = normalizeOperation(operation);
  const prefix = normalizedOperation === OPERATIONAL_STAFFING_OPERATIONS.CONFIGURE_PROFILE
    ? "op_staff_profile"
    : "op_staff_plan";
  return `${prefix}_${randomHex32()}`;
}

function normalizeRequestId(value) {
  const normalized = text(value);
  if (!REQUEST_ID_PATTERN.test(normalized)) fail("requestId is invalid.");
  return normalized;
}

function canonical(value) {
  return JSON.stringify(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function attemptKey(operation, payload) {
  const targetId = operation === OPERATIONAL_STAFFING_OPERATIONS.CONFIGURE_PROFILE
    ? payload.staffId
    : payload.quoteId;
  return `${operation}:${payload.organizationId}:${targetId}`;
}

function beginAttempt(operation, payload, requestedId = "") {
  const key = attemptKey(operation, payload);
  const current = pendingAttempts.get(key) || null;
  if (!current && pendingAttempts.size >= MAX_PENDING_ATTEMPTS) {
    fail("Check the status of the previous staffing request before starting another one.", "resource-exhausted");
  }
  const requestId = normalizeRequestId(
    requestedId || current?.requestId || buildOperationalStaffingRequestId(operation)
  );
  if (current && (current.requestId !== requestId || canonical(current.payload) !== canonical(payload))) {
    fail("Retry the previous staffing request without changing its details.", "failed-precondition");
  }
  const attempt = {
    operation,
    requestId,
    payload: clone(payload),
    error: current?.error || "",
    definitive: current?.definitive === true
  };
  pendingAttempts.delete(key);
  pendingAttempts.set(key, attempt);
  return { ...attempt, key, mode: current ? "reconciliation" : "submitting" };
}

function firebaseCode(error) {
  return text(error?.code).replace(/^functions\//u, "") || "unknown";
}

export function isDefinitiveOperationalStaffingError(error) {
  return DEFINITIVE_CODES.has(firebaseCode(error));
}

function contextualError(error, operation) {
  if (error instanceof OperationalStaffingClientError) return error;
  const code = firebaseCode(error);
  const target = operation === "read"
    ? "load operational staffing"
    : operation === OPERATIONAL_STAFFING_OPERATIONS.CONFIGURE_PROFILE
      ? "update this staff profile"
      : "apply this staffing plan";
  const messages = {
    unauthenticated: `Sign in again to ${target}.`,
    "permission-denied": `Your current role cannot ${target} for this organization.`,
    "not-found": `The operational staffing record is no longer available. Refresh before trying to ${target}.`,
    "invalid-argument": "QuotePilot could not use this staffing request. Refresh the current record and try again.",
    "failed-precondition": "Staffing details are incomplete or have changed. Refresh the latest quote, staff profile, plan, and schedule before trying again.",
    aborted: "Operational staffing changed while the request was running. Refresh before retrying.",
    "already-exists": "This staffing request ID is already linked to different details. Retry the original request without changing it.",
    "resource-exhausted": "This staffing plan is too large for the current workspace limits.",
    "data-loss": "Staffing details could not be verified. Refresh and try again.",
    unavailable: "QuotePilot could not confirm whether this staffing request finished. Retry the same request so its status can be checked safely.",
    "deadline-exceeded": "QuotePilot did not confirm the staffing request in time. Retry the same request so its status can be checked safely.",
    internal: "QuotePilot could not confirm the result of this staffing request. Retry the same request so its status can be checked safely."
  };
  return new OperationalStaffingClientError(
    code,
    messages[code] || "QuotePilot could not confirm the result of this staffing request. Retry the same request so its status can be checked safely."
  );
}

function contextualResponseError(error, operation) {
  if (error instanceof OperationalStaffingClientError && [
    "invalid-argument",
    "failed-precondition",
    "resource-exhausted"
  ].includes(error.code)) {
    return new OperationalStaffingClientError(
      "invalid-server-response",
      "QuotePilot received staffing details it could not safely verify. Refresh and try again."
    );
  }
  return contextualError(error, operation);
}

function ensureConnected(operation) {
  if (!firebaseReady || !cloudFunctions) {
    throw new OperationalStaffingClientError(
      "unavailable",
      `Operational staffing ${operation} needs a connected QuotePilot workspace.`
    );
  }
}

function normalizeSnapshotResponse(value, scope) {
  assertExactKeys(value, [
    "ok",
    "storage",
    "authorityVersion",
    "organizationId",
    "quoteId",
    "activeQuoteRevisionId",
    "canonicalEventWindow",
    "canonicalRequirements",
    "observedAtISO",
    "state",
    "reasonCodes",
    "profiles",
    "profilesTruncated",
    "expectedScheduleFences",
    "scheduleFencesTruncated",
    "snapshot"
  ], "operational staffing read response");
  if (!Array.isArray(value.profiles) || value.profiles.length > OPERATIONAL_STAFFING_CONTRACT.maxProfiles) {
    fail("Operational staffing profiles exceed their bounded response.");
  }
  const profiles = value.profiles
    .map((profile) => normalizeProfileProjection(profile, { organizationId: scope.organizationId }))
    .sort((left, right) => left.staffId.localeCompare(right.staffId));
  if (new Set(profiles.map((profile) => profile.staffId)).size !== profiles.length) {
    fail("Operational staffing profiles contain duplicate staff IDs.");
  }
  const snapshot = value.snapshot === null
    ? null
    : normalizePlanProjection(value.snapshot, scope);
  const activeQuoteRevisionId = opaqueId(
    value.activeQuoteRevisionId,
    "operational staffing activeQuoteRevisionId",
    180
  );
  const canonicalEventWindow = normalizeTimeWindow(
    value.canonicalEventWindow,
    "operational staffing canonicalEventWindow",
    MAX_EVENT_WINDOW_MS
  );
  const canonicalRequirements = normalizeRoleCounts(
    value.canonicalRequirements,
    "operational staffing canonicalRequirements"
  );
  if (!Array.isArray(value.reasonCodes) || value.reasonCodes.length > OPERATIONAL_STAFFING_CONTRACT.maxReasonCodes) {
    fail("Operational staffing reasonCodes must be a bounded array.");
  }
  const reasonCodes = value.reasonCodes.map((reasonCode) => text(reasonCode).toLowerCase()).sort();
  if (
    reasonCodes.some((reasonCode) => !REASON_CODE_PATTERN.test(reasonCode))
    || new Set(reasonCodes).size !== reasonCodes.length
  ) {
    fail("Operational staffing reasonCodes are invalid.");
  }
  const profilesTruncated = exactBoolean(value.profilesTruncated, "operational staffing profilesTruncated");
  const scheduleFencesTruncated = exactBoolean(
    value.scheduleFencesTruncated,
    "operational staffing scheduleFencesTruncated"
  );
  const expectedState = snapshot && snapshot.quoteRevisionId !== activeQuoteRevisionId
    ? "stale"
    : profilesTruncated || scheduleFencesTruncated
      ? "partial"
      : snapshot
        ? "current"
        : "empty";
  if (
    value.ok !== true
    || value.storage !== "firebase"
    || value.authorityVersion !== OPERATIONAL_STAFFING_CONTRACT.authorityVersion
    || text(value.organizationId) !== scope.organizationId
    || text(value.quoteId) !== scope.quoteId
    || text(value.state).toLowerCase() !== expectedState
  ) {
    fail("Operational staffing read response is outside its exact authority scope.");
  }
  return deepFreeze({
    ok: true,
    storage: "firebase",
    authorityVersion: OPERATIONAL_STAFFING_CONTRACT.authorityVersion,
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    activeQuoteRevisionId,
    canonicalEventWindow,
    canonicalRequirements,
    observedAtISO: exactISO(value.observedAtISO, "operational staffing observedAtISO"),
    state: expectedState,
    reasonCodes,
    profiles,
    profilesTruncated,
    expectedScheduleFences: normalizeReadScheduleFenceRefs(value.expectedScheduleFences),
    scheduleFencesTruncated,
    snapshot
  });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

export async function getOperationalStaffingSnapshot(input = {}) {
  ensureConnected("reads");
  const scope = normalizeScope(input);
  try {
    const call = httpsCallable(cloudFunctions, OPERATIONAL_STAFFING_CALLABLES.snapshot);
    const response = await call(scope);
    return normalizeSnapshotResponse(response?.data, scope);
  } catch (error) {
    throw contextualResponseError(error, "read");
  }
}

export async function configureOperationalStaffProfile(input = {}) {
  ensureConnected("profile updates");
  const payload = normalizeProfileMutation(input);
  const attempt = beginAttempt(
    OPERATIONAL_STAFFING_OPERATIONS.CONFIGURE_PROFILE,
    payload,
    input.requestId
  );
  const request = { requestId: attempt.requestId, ...payload };
  try {
    const call = httpsCallable(cloudFunctions, OPERATIONAL_STAFFING_CALLABLES.configureProfile);
    const response = await call(request);
    const result = response?.data;
    assertExactKeys(result, [
      "ok",
      "storage",
      "organizationId",
      "staffId",
      "idempotent",
      "snapshot",
      "receipt"
    ], "operational staff profile mutation response");
    if (
      result.ok !== true
      || result.storage !== "firebase"
      || text(result.organizationId) !== payload.organizationId
      || text(result.staffId) !== payload.staffId
    ) {
      fail("Operational staff profile mutation returned the wrong scope.");
    }
    const snapshot = normalizeProfileProjection(result.snapshot, payload);
    const receipt = normalizeProfileReceipt(result.receipt, request, snapshot);
    const idempotent = exactBoolean(result.idempotent, "profile mutation idempotent");
    if (
      snapshot.displayName !== payload.profile.displayName
      || snapshot.active !== payload.profile.active
      || canonical(snapshot.capabilities) !== canonical(payload.profile.capabilities)
      || canonical(snapshot.availabilityWindows) !== canonical(payload.profile.availabilityWindows)
    ) {
      fail("Operational staff profile mutation returned different command details.");
    }
    pendingAttempts.delete(attempt.key);
    return deepFreeze({
      ok: true,
      storage: "firebase",
      organizationId: payload.organizationId,
      staffId: payload.staffId,
      idempotent,
      mutationMode: attempt.mode,
      snapshot,
      receipt
    });
  } catch (error) {
    const publicError = contextualResponseError(error, OPERATIONAL_STAFFING_OPERATIONS.CONFIGURE_PROFILE);
    pendingAttempts.set(attempt.key, {
      ...attempt,
      error: publicError.message,
      definitive: isDefinitiveOperationalStaffingError(publicError)
    });
    throw publicError;
  }
}

export async function applyOperationalStaffingPlan(input = {}) {
  ensureConnected("plan updates");
  const payload = normalizePlanMutation(input);
  const attempt = beginAttempt(OPERATIONAL_STAFFING_OPERATIONS.APPLY_PLAN, payload, input.requestId);
  const request = { requestId: attempt.requestId, ...payload };
  try {
    const call = httpsCallable(cloudFunctions, OPERATIONAL_STAFFING_CALLABLES.applyPlan);
    const response = await call(request);
    const result = response?.data;
    assertExactKeys(result, [
      "ok",
      "storage",
      "organizationId",
      "quoteId",
      "idempotent",
      "snapshot",
      "receipt"
    ], "operational staffing mutation response");
    if (
      result.ok !== true
      || result.storage !== "firebase"
      || text(result.organizationId) !== payload.organizationId
      || text(result.quoteId) !== payload.quoteId
    ) {
      fail("Operational staffing mutation returned the wrong scope.");
    }
    const snapshot = normalizePlanProjection(result.snapshot, {
      organizationId: payload.organizationId,
      quoteId: payload.quoteId,
      quoteRevisionId: payload.expectedQuoteRevisionId
    });
    const receipt = normalizePlanReceipt(result.receipt, request, snapshot);
    const idempotent = exactBoolean(result.idempotent, "staffing mutation idempotent");
    const projectedIntent = payload.assignments.map((assignment) => ({
      assignmentId: assignment.assignmentId,
      staffId: assignment.staffId,
      role: assignment.role,
      staffRevision: assignment.expectedStaffRevision,
      state: ASSIGNMENT_STATE
    })).sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
    if (
      canonical(snapshot.eventWindow) !== canonical(payload.eventWindow)
      || canonical(snapshot.requirements.byRole) !== canonical(payload.requirements)
      || canonical(snapshot.assignments.map((assignment) => ({
        assignmentId: assignment.assignmentId,
        staffId: assignment.staffId,
        role: assignment.role,
        staffRevision: assignment.staffRevision,
        state: assignment.state
      }))) !== canonical(projectedIntent)
    ) {
      fail("Operational staffing mutation returned different command details.");
    }
    pendingAttempts.delete(attempt.key);
    return deepFreeze({
      ok: true,
      storage: "firebase",
      organizationId: payload.organizationId,
      quoteId: payload.quoteId,
      idempotent,
      mutationMode: attempt.mode,
      snapshot,
      receipt
    });
  } catch (error) {
    const publicError = contextualResponseError(error, OPERATIONAL_STAFFING_OPERATIONS.APPLY_PLAN);
    pendingAttempts.set(attempt.key, {
      ...attempt,
      error: publicError.message,
      definitive: isDefinitiveOperationalStaffingError(publicError)
    });
    throw publicError;
  }
}

function normalizeAttemptDescriptor(input = {}) {
  assertAllowedKeys(input, ["operation", "organizationId", "staffId", "quoteId", "requestId"], "staffing attempt descriptor");
  const inferredOperation = input.operation || (input.staffId
    ? OPERATIONAL_STAFFING_OPERATIONS.CONFIGURE_PROFILE
    : OPERATIONAL_STAFFING_OPERATIONS.APPLY_PLAN);
  const operation = normalizeOperation(inferredOperation);
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const payload = operation === OPERATIONAL_STAFFING_OPERATIONS.CONFIGURE_PROFILE
    ? { organizationId, staffId: opaqueId(input.staffId, "staffId", 160) }
    : { organizationId, quoteId: opaqueId(input.quoteId, "quoteId") };
  return { operation, key: attemptKey(operation, payload) };
}

export function readPendingOperationalStaffingAttempt(input = {}) {
  const { key } = normalizeAttemptDescriptor(input);
  const attempt = pendingAttempts.get(key);
  return attempt ? deepFreeze(clone({
    operation: attempt.operation,
    requestId: attempt.requestId,
    payload: attempt.payload,
    error: attempt.error,
    definitive: attempt.definitive
  })) : null;
}

export function resetDefinitiveOperationalStaffingAttempt(input = {}) {
  const { key } = normalizeAttemptDescriptor(input);
  const attempt = pendingAttempts.get(key);
  if (!attempt?.definitive || (input.requestId && text(input.requestId) !== attempt.requestId)) {
    return false;
  }
  pendingAttempts.delete(key);
  return true;
}

export function buildLocalOperationalStaffingDraft(input = {}) {
  const payload = normalizePlanMutation(input);
  return deepFreeze({
    schemaVersion: OPERATIONAL_STAFFING_CONTRACT.localDraftSchemaVersion,
    authority: "local_draft",
    organizationId: payload.organizationId,
    quoteId: payload.quoteId,
    expectedQuoteRevisionId: payload.expectedQuoteRevisionId,
    expectedPlanRevision: payload.expectedPlanRevision,
    eventWindow: payload.eventWindow,
    requirements: payload.requirements,
    assignments: payload.assignments,
    expectedScheduleFences: payload.expectedScheduleFences
  });
}
