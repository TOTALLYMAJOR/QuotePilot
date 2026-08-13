"use strict";

const { createHash } = require("node:crypto");

const OPERATIONAL_STAFFING_SCHEMA_VERSION = 1;
const OPERATIONAL_STAFFING_AUTHORITY_VERSION =
  "operational-staffing-authority-v1";
const OPERATIONAL_STAFFING_RECEIPT_VERSION =
  "operational-staffing-command-receipt-v1";
const OPERATIONAL_STAFF_PROFILE_RECEIPT_VERSION =
  "operational-staff-profile-command-receipt-v1";
const OPERATIONAL_STAFFING_AUTHORITY = "server_authoritative";
const OPERATIONAL_ASSIGNMENT_STATE = "operator_confirmed";

const OPERATIONAL_STAFFING_ROLES = Object.freeze([
  "lead",
  "server",
  "chef",
  "bartender"
]);
const ROLE_SET = new Set(OPERATIONAL_STAFFING_ROLES);
const STAFF_ACTOR_ROLE_SET = new Set(["admin", "sales"]);
const AVAILABILITY_STATE_SET = new Set(["available", "unavailable"]);

const MAX_STAFF_PROFILES = 128;
const MAX_ASSIGNMENTS = 100;
const MAX_EXISTING_ASSIGNMENTS = 256;
const MAX_AVAILABILITY_WINDOWS_PER_STAFF = 128;
const MAX_SCHEDULE_FENCES = 320;
const MAX_EVENT_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AVAILABILITY_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_CANONICAL_BYTES = 262_144;

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
const RECEIPT_ID_PATTERN = /^osr_[a-f0-9]{48}$/u;
const PROFILE_RECEIPT_ID_PATTERN = /^ospr_[a-f0-9]{48}$/u;
const FENCE_ID_PATTERN = /^osf_[a-f0-9]{48}$/u;

class OperationalStaffingAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "OperationalStaffingAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new OperationalStaffingAuthorityError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value) {
  return String(value ?? "").trim();
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("failed-precondition", "Canonical staffing evidence contains a non-finite number.");
    }
    return value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    fail("failed-precondition", "Canonical staffing evidence must be an acyclic JSON value.");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const normalized = value.map((item) => canonicalize(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (!isRecord(value)) {
    fail("failed-precondition", "Canonical staffing evidence must use plain JSON records.");
  }
  const normalized = {};
  Object.keys(value).sort(compareText).forEach((key) => {
    if (typeof value[key] === "undefined") {
      fail("failed-precondition", "Canonical staffing evidence cannot contain undefined values.");
    }
    normalized[key] = canonicalize(value[key], seen);
  });
  seen.delete(value);
  return normalized;
}

function canonicalSerialize(value, label = "Operational staffing evidence") {
  const serialized = JSON.stringify(canonicalize(value));
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > MAX_CANONICAL_BYTES) {
    fail("resource-exhausted", `${label} exceeds the bounded authority size.`, {
      byteLength,
      maximum: MAX_CANONICAL_BYTES
    });
  }
  return serialized;
}

function canonicalClone(value, label) {
  return JSON.parse(canonicalSerialize(value, label));
}

function canonicalDigest(value, label) {
  return createHash("sha256")
    .update(canonicalSerialize(value, label))
    .digest("hex");
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
    fail("invalid-argument", `${label} must be a stable opaque identifier.`);
  }
  return normalized;
}

function requestId(value) {
  const normalized = text(value);
  if (!REQUEST_ID_PATTERN.test(normalized)) {
    fail("invalid-argument", "requestId must be a stable bounded command identifier.");
  }
  return normalized;
}

function exactISO(value, label, code = "invalid-argument") {
  const normalized = text(value);
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail(code, `${label} must be an exact ISO timestamp.`);
  }
  return normalized;
}

function boundedRevision(value, label, { allowZero = true } = {}) {
  const revision = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(revision) || revision < minimum || revision > 1_000_000_000) {
    fail("invalid-argument", `${label} must be a bounded integer revision.`);
  }
  return revision;
}

function safeDisplayName(value) {
  const normalized = text(value).replace(/\s+/gu, " ");
  if (
    !normalized
    || normalized.length > 80
    || /[\u0000-\u001f\u007f<>]/u.test(normalized)
    || /^[^@\s]+@[^@\s]+$/u.test(normalized)
  ) {
    fail("invalid-argument", "displayName must be safe bounded display text.");
  }
  return normalized;
}

function normalizeRole(value, label = "role") {
  const normalized = text(value).toLowerCase();
  if (!ROLE_SET.has(normalized)) {
    fail("invalid-argument", `${label} must be lead, server, chef, or bartender.`);
  }
  return normalized;
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value) || !value.length || value.length > OPERATIONAL_STAFFING_ROLES.length) {
    fail("invalid-argument", "Staff capabilities must be a non-empty bounded role list.");
  }
  const capabilities = value.map((item) => normalizeRole(item, "Staff capability"));
  if (new Set(capabilities).size !== capabilities.length) {
    fail("invalid-argument", "Staff capabilities must be unique.");
  }
  return capabilities.sort(compareText);
}

function assertAllowedKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    fail("invalid-argument", `${label} contains unsupported fields.`, {
      fields: unknown.sort(compareText)
    });
  }
}

function normalizeTimeWindow(value, label, maximumDurationMs) {
  if (!isRecord(value)) {
    fail("invalid-argument", `${label} must contain exact startAtISO and endAtISO values.`);
  }
  const startAtISO = exactISO(value.startAtISO, `${label} startAtISO`);
  const endAtISO = exactISO(value.endAtISO, `${label} endAtISO`);
  const startMs = Date.parse(startAtISO);
  const endMs = Date.parse(endAtISO);
  const durationMs = endMs - startMs;
  if (durationMs <= 0) {
    fail("invalid-argument", `${label} must be a non-empty half-open interval.`);
  }
  if (durationMs > maximumDurationMs) {
    fail("resource-exhausted", `${label} exceeds the bounded duration.`, {
      maximumDurationMs
    });
  }
  return Object.freeze({ startAtISO, endAtISO, startMs, endMs });
}

function publicWindow(window) {
  return Object.freeze({
    startAtISO: window.startAtISO,
    endAtISO: window.endAtISO
  });
}

function intervalsOverlap(left, right) {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function normalizeAvailabilityWindow(value, index) {
  if (!isRecord(value)) {
    fail("invalid-argument", `Availability window ${index + 1} is invalid.`);
  }
  const source = text(value.source || "operator_recorded").toLowerCase();
  const state = text(value.state).toLowerCase();
  if (source !== "operator_recorded" || !AVAILABILITY_STATE_SET.has(state)) {
    fail(
      "invalid-argument",
      "Availability evidence must be operator-recorded as available or unavailable."
    );
  }
  const window = normalizeTimeWindow(
    value,
    `Availability window ${index + 1}`,
    MAX_AVAILABILITY_WINDOW_MS
  );
  return Object.freeze({
    availabilityId: opaqueId(value.availabilityId, "availabilityId", 160),
    source,
    state,
    startAtISO: window.startAtISO,
    endAtISO: window.endAtISO,
    startMs: window.startMs,
    endMs: window.endMs
  });
}

function normalizeProfileCommandAvailabilityWindow(value, index) {
  if (!isRecord(value)) {
    fail("invalid-argument", `Availability window ${index + 1} is invalid.`);
  }
  assertAllowedKeys(
    value,
    new Set(["availabilityId", "source", "state", "startAtISO", "endAtISO"]),
    `Availability window ${index + 1}`
  );
  return normalizeAvailabilityWindow(value, index);
}

function assertNonOverlappingAvailability(windows) {
  for (let index = 1; index < windows.length; index += 1) {
    if (intervalsOverlap(windows[index - 1], windows[index])) {
      fail(
        "failed-precondition",
        "Operator-recorded availability windows must not overlap."
      );
    }
  }
}

function normalizeProfileCommandDraft(value) {
  if (!isRecord(value)) {
    fail("invalid-argument", "Operational staff profile configuration is required.");
  }
  assertAllowedKeys(
    value,
    new Set(["displayName", "active", "capabilities", "availabilityWindows"]),
    "Operational staff profile configuration"
  );
  if (typeof value.active !== "boolean") {
    fail("invalid-argument", "Operational staff profile active state must be explicit.");
  }
  if (
    !Array.isArray(value.availabilityWindows)
    || value.availabilityWindows.length > MAX_AVAILABILITY_WINDOWS_PER_STAFF
  ) {
    fail("resource-exhausted", "Operational staff availability exceeds its bounded size.");
  }
  const availabilityWindows = value.availabilityWindows
    .map(normalizeProfileCommandAvailabilityWindow)
    .sort((left, right) => (
      left.startMs - right.startMs
      || left.endMs - right.endMs
      || compareText(left.availabilityId, right.availabilityId)
    ));
  if (new Set(availabilityWindows.map((item) => item.availabilityId)).size !== availabilityWindows.length) {
    fail("invalid-argument", "Operational availability identifiers must be unique.");
  }
  assertNonOverlappingAvailability(availabilityWindows);
  return deepFreeze({
    displayName: safeDisplayName(value.displayName),
    active: value.active,
    capabilities: normalizeCapabilities(value.capabilities),
    availabilityWindows: availabilityWindows.map((item) => ({
      availabilityId: item.availabilityId,
      source: item.source,
      state: item.state,
      startAtISO: item.startAtISO,
      endAtISO: item.endAtISO
    }))
  });
}

function normalizeStaffProfile(value, organizationId) {
  if (!isRecord(value)) {
    fail("invalid-argument", "Staff profile evidence is invalid.");
  }
  const profileOrganizationId = opaqueId(value.organizationId, "Staff profile organizationId");
  if (profileOrganizationId !== organizationId) {
    fail("permission-denied", "Staff profile evidence is outside the command organization.");
  }
  if (!Array.isArray(value.availabilityWindows)) {
    fail("failed-precondition", "Staff availability evidence is required.");
  }
  if (
    value.availabilityTruncated === true
    || value.availabilityWindows.length > MAX_AVAILABILITY_WINDOWS_PER_STAFF
  ) {
    fail("resource-exhausted", "Staff availability evidence is truncated or exceeds its bound.");
  }
  const availabilityWindows = value.availabilityWindows
    .map(normalizeAvailabilityWindow)
    .sort((left, right) => (
      left.startMs - right.startMs
      || left.endMs - right.endMs
      || compareText(left.availabilityId, right.availabilityId)
    ));
  if (new Set(availabilityWindows.map((item) => item.availabilityId)).size !== availabilityWindows.length) {
    fail("failed-precondition", "Availability identifiers must be unique within a staff profile.");
  }
  if (typeof value.active !== "boolean") {
    fail("invalid-argument", "Staff active state must be explicit.");
  }
  return deepFreeze({
    organizationId,
    staffId: opaqueId(value.staffId, "staffId", 160),
    displayName: safeDisplayName(value.displayName),
    active: value.active,
    capabilities: normalizeCapabilities(value.capabilities),
    revision: boundedRevision(value.revision, "Staff profile revision", { allowZero: false }),
    availabilityWindows,
    availabilityTruncated: false
  });
}

function normalizeStaffProfiles(values, organizationId) {
  if (!Array.isArray(values)) {
    fail("failed-precondition", "A bounded staff profile evidence set is required.");
  }
  if (values.length > MAX_STAFF_PROFILES) {
    fail("resource-exhausted", "Staff profile evidence exceeds its bound.");
  }
  const profiles = values
    .map((value) => normalizeStaffProfile(value, organizationId))
    .sort((left, right) => compareText(left.staffId, right.staffId));
  if (new Set(profiles.map((item) => item.staffId)).size !== profiles.length) {
    fail("failed-precondition", "Staff profile identifiers must be unique.");
  }
  return profiles;
}

function normalizeRequirements(value, quoteRevisionId) {
  if (!isRecord(value)) {
    fail("invalid-argument", "Quoted staffing requirements are required.");
  }
  const unknownRoles = Object.keys(value).filter((role) => !ROLE_SET.has(role));
  if (unknownRoles.length) {
    fail("invalid-argument", "Quoted staffing requirements contain an unsupported role.", {
      roles: unknownRoles.sort(compareText)
    });
  }
  const byRole = {};
  let totalQuotedCount = 0;
  OPERATIONAL_STAFFING_ROLES.forEach((role) => {
    const count = Number(value[role] ?? 0);
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_ASSIGNMENTS) {
      fail("invalid-argument", `Quoted ${role} count must be a bounded non-negative integer.`);
    }
    byRole[role] = count;
    totalQuotedCount += count;
  });
  if (totalQuotedCount > MAX_ASSIGNMENTS) {
    fail("resource-exhausted", "Total quoted staffing requirements exceed the plan bound.");
  }
  return deepFreeze({
    source: "commercial_quote_copy",
    quoteRevisionId,
    byRole,
    totalQuotedCount,
    boundary: COMMERCIAL_REQUIREMENT_BOUNDARY
  });
}

function normalizeCandidateAssignment(value, index) {
  if (!isRecord(value)) {
    fail("invalid-argument", `Assignment ${index + 1} is invalid.`);
  }
  const suppliedState = text(value.state).toLowerCase();
  if (suppliedState && suppliedState !== OPERATIONAL_ASSIGNMENT_STATE) {
    fail(
      "invalid-argument",
      "Operational assignments may only be recorded as operator_confirmed."
    );
  }
  return Object.freeze({
    assignmentId: opaqueId(value.assignmentId, "assignmentId", 160),
    staffId: opaqueId(value.staffId, "assignment staffId", 160),
    role: normalizeRole(value.role, "Assignment role"),
    expectedStaffRevision: boundedRevision(
      value.expectedStaffRevision ?? value.staffRevision,
      "Assignment expectedStaffRevision",
      { allowZero: false }
    ),
    state: OPERATIONAL_ASSIGNMENT_STATE
  });
}

function normalizeCandidateAssignments(values) {
  if (!Array.isArray(values) || values.length > MAX_ASSIGNMENTS) {
    fail("resource-exhausted", "Operational assignments exceed the bounded plan size.");
  }
  const assignments = values
    .map(normalizeCandidateAssignment)
    .sort((left, right) => (
      compareText(left.role, right.role)
      || compareText(left.staffId, right.staffId)
      || compareText(left.assignmentId, right.assignmentId)
    ));
  if (new Set(assignments.map((item) => item.assignmentId)).size !== assignments.length) {
    fail("failed-precondition", "Assignment identifiers must be unique.");
  }
  if (new Set(assignments.map((item) => item.staffId)).size !== assignments.length) {
    fail(
      "failed-precondition",
      "One staff profile may fill only one quoted role in an operational staffing plan."
    );
  }
  return assignments;
}

function normalizeActor(value, organizationId) {
  if (!isRecord(value)) {
    fail("permission-denied", "A trusted same-tenant staff actor is required.");
  }
  const actorOrganizationId = opaqueId(value.organizationId, "Actor organizationId");
  const role = text(value.role).toLowerCase();
  if (actorOrganizationId !== organizationId) {
    fail("permission-denied", "The staff actor is outside the command organization.");
  }
  if (!STAFF_ACTOR_ROLE_SET.has(role)) {
    fail("permission-denied", "A trusted admin or sales actor is required.");
  }
  return Object.freeze({
    organizationId,
    uid: opaqueId(value.uid, "Actor uid", 160),
    role
  });
}

function normalizeExpectedScheduleFences(values) {
  if (!Array.isArray(values) || values.length > MAX_SCHEDULE_FENCES) {
    fail("resource-exhausted", "Expected schedule fences exceed the bounded plan size.");
  }
  const normalized = values
    .map((value, index) => {
      if (!isRecord(value) || !FENCE_ID_PATTERN.test(text(value.fenceId))) {
        fail("invalid-argument", `Expected schedule fence ${index + 1} is invalid.`);
      }
      return Object.freeze({
        fenceId: text(value.fenceId),
        revision: boundedRevision(value.revision, "Expected schedule fence revision")
      });
    })
    .sort((left, right) => compareText(left.fenceId, right.fenceId));
  if (new Set(normalized.map((item) => item.fenceId)).size !== normalized.length) {
    fail("invalid-argument", "Expected schedule fence identifiers must be unique.");
  }
  return normalized;
}

function normalizeRequest(value) {
  if (!isRecord(value)) {
    fail("invalid-argument", "Operational staffing command request is required.");
  }
  const organizationId = opaqueId(value.organizationId, "organizationId");
  const quoteId = opaqueId(value.quoteId, "quoteId");
  const quoteRevisionId = opaqueId(
    value.expectedQuoteRevisionId,
    "expectedQuoteRevisionId",
    180
  );
  const eventWindow = normalizeTimeWindow(
    value.eventWindow,
    "Operational staffing event window",
    MAX_EVENT_DURATION_MS
  );
  return deepFreeze({
    requestId: requestId(value.requestId),
    organizationId,
    quoteId,
    expectedQuoteRevisionId: quoteRevisionId,
    expectedPlanRevision: boundedRevision(
      value.expectedPlanRevision,
      "expectedPlanRevision"
    ),
    eventWindow: publicWindow(eventWindow),
    requirements: normalizeRequirements(value.requirements, quoteRevisionId),
    assignments: normalizeCandidateAssignments(value.assignments),
    expectedScheduleFences: normalizeExpectedScheduleFences(
      value.expectedScheduleFences
    )
  });
}

function normalizeExistingPlanAssignment(value, index) {
  if (!isRecord(value)) {
    fail("failed-precondition", `Current plan assignment ${index + 1} is invalid.`);
  }
  if (text(value.state).toLowerCase() !== OPERATIONAL_ASSIGNMENT_STATE) {
    fail("failed-precondition", "Current plan contains a non-authoritative assignment state.");
  }
  return Object.freeze({
    assignmentId: opaqueId(value.assignmentId, "Current assignmentId", 160),
    staffId: opaqueId(value.staffId, "Current assignment staffId", 160),
    role: normalizeRole(value.role, "Current assignment role"),
    staffRevision: boundedRevision(value.staffRevision, "Current assignment staffRevision", {
      allowZero: false
    }),
    state: OPERATIONAL_ASSIGNMENT_STATE
  });
}

function normalizeCurrentPlan(value, organizationId, quoteId) {
  if (value === null || typeof value === "undefined") return null;
  if (!isRecord(value)) {
    fail("failed-precondition", "Current operational staffing plan is invalid.");
  }
  if (
    text(value.organizationId) !== organizationId
    || text(value.quoteId) !== quoteId
  ) {
    fail("permission-denied", "Current staffing plan is outside the command scope.");
  }
  const eventWindow = normalizeTimeWindow(
    value.eventWindow,
    "Current staffing plan event window",
    MAX_EVENT_DURATION_MS
  );
  const assignments = Array.isArray(value.assignments)
    ? value.assignments.map(normalizeExistingPlanAssignment)
    : fail("failed-precondition", "Current staffing plan assignments are invalid.");
  if (assignments.length > MAX_ASSIGNMENTS) {
    fail("resource-exhausted", "Current staffing plan exceeds the assignment bound.");
  }
  if (
    new Set(assignments.map((item) => item.assignmentId)).size !== assignments.length
    || new Set(assignments.map((item) => item.staffId)).size !== assignments.length
  ) {
    fail("failed-precondition", "Current staffing plan assignment identities are invalid.");
  }
  return deepFreeze({
    organizationId,
    quoteId,
    quoteRevisionId: opaqueId(value.quoteRevisionId, "Current plan quoteRevisionId", 180),
    revision: boundedRevision(value.revision, "Current staffing plan revision", {
      allowZero: false
    }),
    eventWindow: publicWindow(eventWindow),
    assignments: assignments.sort((left, right) => compareText(left.assignmentId, right.assignmentId))
  });
}

function normalizeExistingAssignment(value, index, organizationId) {
  if (!isRecord(value)) {
    fail("failed-precondition", `Overlap assignment evidence ${index + 1} is invalid.`);
  }
  const assignmentOrganizationId = opaqueId(
    value.organizationId,
    "Overlap assignment organizationId"
  );
  if (assignmentOrganizationId !== organizationId) {
    fail("permission-denied", "Overlap assignment evidence is outside the command organization.");
  }
  if (text(value.state).toLowerCase() !== OPERATIONAL_ASSIGNMENT_STATE) {
    fail("failed-precondition", "Overlap evidence must contain operator-confirmed assignments only.");
  }
  const eventWindow = normalizeTimeWindow(
    value.eventWindow,
    `Overlap assignment ${index + 1} event window`,
    MAX_EVENT_DURATION_MS
  );
  return deepFreeze({
    organizationId,
    assignmentId: opaqueId(value.assignmentId, "Overlap assignmentId", 160),
    quoteId: opaqueId(value.quoteId, "Overlap quoteId", 160),
    quoteRevisionId: opaqueId(value.quoteRevisionId, "Overlap quoteRevisionId", 180),
    planRevision: boundedRevision(value.planRevision, "Overlap planRevision", {
      allowZero: false
    }),
    staffId: opaqueId(value.staffId, "Overlap assignment staffId", 160),
    role: normalizeRole(value.role, "Overlap assignment role"),
    state: OPERATIONAL_ASSIGNMENT_STATE,
    eventWindow: publicWindow(eventWindow),
    startMs: eventWindow.startMs,
    endMs: eventWindow.endMs
  });
}

function projectOperationalStaffingFenceAssignment(value) {
  return Object.freeze({
    organizationId: value.organizationId,
    assignmentId: value.assignmentId,
    quoteId: value.quoteId,
    quoteRevisionId: value.quoteRevisionId,
    planRevision: value.planRevision,
    staffId: value.staffId,
    role: value.role,
    state: value.state,
    eventWindow: {
      startAtISO: value.eventWindow.startAtISO,
      endAtISO: value.eventWindow.endAtISO
    }
  });
}

function normalizeExistingAssignments(values, organizationId) {
  if (!Array.isArray(values)) {
    fail("failed-precondition", "Bounded overlap assignment evidence is required.");
  }
  if (values.length > MAX_EXISTING_ASSIGNMENTS) {
    fail("resource-exhausted", "Overlap assignment evidence exceeds its bound.");
  }
  const assignments = values
    .map((value, index) => normalizeExistingAssignment(value, index, organizationId))
    .sort((left, right) => compareText(left.assignmentId, right.assignmentId));
  if (new Set(assignments.map((item) => item.assignmentId)).size !== assignments.length) {
    fail("failed-precondition", "Overlap assignment evidence contains duplicate identities.");
  }
  return assignments;
}

function utcDatesForWindow(value) {
  const window = normalizeTimeWindow(value, "Schedule fence event window", MAX_EVENT_DURATION_MS);
  const first = new Date(window.startMs);
  const last = new Date(window.endMs - 1);
  const cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  const lastDay = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  const dates = [];
  for (let day = cursor; day <= lastDay; day += 24 * 60 * 60 * 1000) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}

function buildOperationalStaffingScheduleFenceId({ organizationId, staffId, utcDate } = {}) {
  const normalized = {
    schemaVersion: OPERATIONAL_STAFFING_SCHEMA_VERSION,
    organizationId: opaqueId(organizationId, "Schedule fence organizationId"),
    staffId: opaqueId(staffId, "Schedule fence staffId", 160),
    utcDate: text(utcDate)
  };
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized.utcDate)) {
    fail("invalid-argument", "Schedule fence utcDate must use YYYY-MM-DD.");
  }
  return `osf_${canonicalDigest(normalized, "Schedule fence identity").slice(0, 48)}`;
}

function deriveOperationalStaffingScheduleFenceRefs({
  organizationId,
  eventWindow,
  assignments,
  currentPlan = null
} = {}) {
  const orgId = opaqueId(organizationId, "organizationId");
  const candidateWindow = normalizeTimeWindow(
    eventWindow,
    "Operational staffing event window",
    MAX_EVENT_DURATION_MS
  );
  const candidateAssignments = normalizeCandidateAssignments(assignments);
  const rawRefs = [];
  const addRefs = (staffAssignments, window) => {
    const utcDates = utcDatesForWindow(window);
    staffAssignments.forEach((assignment) => {
      utcDates.forEach((utcDate) => {
        rawRefs.push({
          organizationId: orgId,
          staffId: assignment.staffId,
          utcDate,
          fenceId: buildOperationalStaffingScheduleFenceId({
            organizationId: orgId,
            staffId: assignment.staffId,
            utcDate
          })
        });
      });
    });
  };
  addRefs(candidateAssignments, publicWindow(candidateWindow));
  if (currentPlan) {
    if (text(currentPlan.organizationId) !== orgId) {
      fail("permission-denied", "Current staffing plan is outside the schedule fence scope.");
    }
    const currentWindow = normalizeTimeWindow(
      currentPlan.eventWindow,
      "Current staffing plan event window",
      MAX_EVENT_DURATION_MS
    );
    const currentAssignments = Array.isArray(currentPlan.assignments)
      ? currentPlan.assignments.map((assignment, index) => ({
          staffId: opaqueId(assignment?.staffId, `Current assignment ${index + 1} staffId`, 160)
        }))
      : fail("failed-precondition", "Current plan assignments are required for schedule fencing.");
    addRefs(currentAssignments, publicWindow(currentWindow));
  }
  const unique = new Map(rawRefs.map((item) => [item.fenceId, item]));
  const refs = [...unique.values()].sort((left, right) => compareText(left.fenceId, right.fenceId));
  if (refs.length > MAX_SCHEDULE_FENCES) {
    fail("resource-exhausted", "Required schedule fences exceed the atomic caller bound.");
  }
  return deepFreeze(refs);
}

function normalizeScheduleFenceAssignment(value, index, organizationId, staffId, utcDate) {
  const assignment = normalizeExistingAssignment(value, index, organizationId);
  if (assignment.staffId !== staffId) {
    fail("failed-precondition", "Schedule fence assignment has the wrong staff scope.");
  }
  if (!utcDatesForWindow(assignment.eventWindow).includes(utcDate)) {
    fail("failed-precondition", "Schedule fence assignment does not intersect its UTC day.");
  }
  return assignment;
}

function normalizeScheduleFence(value, index, organizationId) {
  if (!isRecord(value)) {
    fail("failed-precondition", `Schedule fence evidence ${index + 1} is invalid.`);
  }
  const fenceOrganizationId = opaqueId(value.organizationId, "Schedule fence organizationId");
  const staffId = opaqueId(value.staffId, "Schedule fence staffId", 160);
  const utcDate = text(value.utcDate);
  if (fenceOrganizationId !== organizationId) {
    fail("permission-denied", "Schedule fence evidence is outside the command organization.");
  }
  const fenceId = text(value.fenceId);
  const expectedFenceId = buildOperationalStaffingScheduleFenceId({
    organizationId,
    staffId,
    utcDate
  });
  if (!FENCE_ID_PATTERN.test(fenceId) || fenceId !== expectedFenceId) {
    fail("failed-precondition", "Schedule fence identity does not match its exact scope.");
  }
  if (!Array.isArray(value.assignments) || value.assignments.length > MAX_EXISTING_ASSIGNMENTS) {
    fail("resource-exhausted", "Schedule fence assignment evidence is missing or exceeds its bound.");
  }
  if (value.assignmentsTruncated === true) {
    fail("resource-exhausted", "Schedule fence assignment evidence is truncated.");
  }
  const assignments = value.assignments
    .map((assignment, assignmentIndex) => normalizeScheduleFenceAssignment(
      assignment,
      assignmentIndex,
      organizationId,
      staffId,
      utcDate
    ))
    .sort((left, right) => compareText(left.assignmentId, right.assignmentId));
  if (new Set(assignments.map((item) => item.assignmentId)).size !== assignments.length) {
    fail("failed-precondition", "Schedule fence contains duplicate assignment identities.");
  }
  return Object.freeze({
    schemaVersion: OPERATIONAL_STAFFING_SCHEMA_VERSION,
    organizationId,
    fenceId,
    staffId,
    utcDate,
    revision: boundedRevision(value.revision, "Schedule fence revision"),
    assignments,
    assignmentsTruncated: false
  });
}

function normalizeScheduleFences(values, organizationId) {
  if (!Array.isArray(values) || values.length > MAX_SCHEDULE_FENCES) {
    fail("resource-exhausted", "Schedule fence evidence exceeds the atomic caller bound.");
  }
  const fences = values
    .map((value, index) => normalizeScheduleFence(value, index, organizationId))
    .sort((left, right) => compareText(left.fenceId, right.fenceId));
  if (new Set(fences.map((item) => item.fenceId)).size !== fences.length) {
    fail("failed-precondition", "Schedule fence evidence contains duplicate identities.");
  }
  return fences;
}

function dedupeFenceAssignments(fences) {
  const assignments = new Map();
  fences.forEach((fence) => {
    fence.assignments.forEach((assignment) => {
      const existing = assignments.get(assignment.assignmentId);
      if (
        existing
        && canonicalSerialize(existing, "Schedule fence assignment")
          !== canonicalSerialize(assignment, "Schedule fence assignment")
      ) {
        fail("failed-precondition", "Schedule fences disagree about an assignment projection.");
      }
      assignments.set(assignment.assignmentId, assignment);
    });
  });
  const normalized = [...assignments.values()]
    .sort((left, right) => compareText(left.assignmentId, right.assignmentId));
  if (normalized.length > MAX_EXISTING_ASSIGNMENTS) {
    fail("resource-exhausted", "Deduplicated schedule fence assignments exceed their bound.");
  }
  return normalized;
}

function assertCompleteEvidence(value = {}) {
  const bounds = isRecord(value) ? value : {};
  const truncated = [
    "staffProfilesTruncated",
    "overlapAssignmentsTruncated",
    "scheduleFencesTruncated"
  ].filter((key) => bounds[key] === true);
  if (truncated.length) {
    fail("resource-exhausted", "Operational staffing evidence is truncated.", {
      truncated
    });
  }
  return Object.freeze({
    staffProfilesTruncated: false,
    overlapAssignmentsTruncated: false,
    scheduleFencesTruncated: false
  });
}

function evaluateAvailability(profile, eventWindow) {
  const window = normalizeTimeWindow(
    eventWindow,
    "Operational staffing event window",
    MAX_EVENT_DURATION_MS
  );
  const relevant = profile.availabilityWindows.filter((item) => intervalsOverlap(item, window));
  const available = relevant.filter((item) => item.state === "available");
  const unavailable = relevant.filter((item) => item.state === "unavailable");
  const contradictory = available.some((left) => (
    unavailable.some((right) => intervalsOverlap(left, right))
  ));
  if (contradictory) {
    return Object.freeze({ state: "blocked", reasonCode: "availability_conflict" });
  }
  if (unavailable.length) {
    return Object.freeze({ state: "blocked", reasonCode: "availability_unavailable" });
  }
  const clipped = available
    .map((item) => ({
      startMs: Math.max(item.startMs, window.startMs),
      endMs: Math.min(item.endMs, window.endMs)
    }))
    .filter((item) => item.startMs < item.endMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  let coveredUntil = window.startMs;
  for (const interval of clipped) {
    if (interval.startMs > coveredUntil) break;
    coveredUntil = Math.max(coveredUntil, interval.endMs);
    if (coveredUntil >= window.endMs) {
      return Object.freeze({ state: "clear", reasonCode: "availability_covers_event" });
    }
  }
  return Object.freeze({ state: "unknown", reasonCode: "availability_unknown" });
}

function deriveCoverage(requirements, assignments) {
  const operatorConfirmedByRole = Object.fromEntries(
    OPERATIONAL_STAFFING_ROLES.map((role) => [role, 0])
  );
  assignments.forEach((assignment) => {
    operatorConfirmedByRole[assignment.role] += 1;
  });
  const byRole = {};
  let totalGap = 0;
  OPERATIONAL_STAFFING_ROLES.forEach((role) => {
    const quotedCount = requirements.byRole[role];
    const operatorConfirmedCount = operatorConfirmedByRole[role];
    const gap = Math.max(0, quotedCount - operatorConfirmedCount);
    totalGap += gap;
    byRole[role] = Object.freeze({
      quotedCount,
      operatorConfirmedCount,
      gap
    });
  });
  const state = requirements.totalQuotedCount === 0
    ? "not_required"
    : totalGap === 0
      ? "coverage_confirmed"
      : "attention";
  return deepFreeze({
    state,
    byRole,
    totalQuotedCount: requirements.totalQuotedCount,
    totalOperatorConfirmedCount: assignments.length,
    totalGap,
    boundary: COVERAGE_EVIDENCE_BOUNDARY
  });
}

function projectOperationalStaffingSnapshot(plan) {
  if (!isRecord(plan)) {
    fail("failed-precondition", "An authoritative operational staffing plan is required.");
  }
  const organizationId = opaqueId(plan.organizationId, "Plan organizationId");
  const quoteId = opaqueId(plan.quoteId, "Plan quoteId");
  const quoteRevisionId = opaqueId(plan.quoteRevisionId, "Plan quoteRevisionId", 180);
  const eventWindow = normalizeTimeWindow(
    plan.eventWindow,
    "Plan event window",
    MAX_EVENT_DURATION_MS
  );
  if (!isRecord(plan.requirements) || !isRecord(plan.requirements.byRole)) {
    fail("failed-precondition", "Plan quoted requirements are invalid.");
  }
  const requirements = normalizeRequirements(plan.requirements.byRole, quoteRevisionId);
  if (!Array.isArray(plan.assignments) || plan.assignments.length > MAX_ASSIGNMENTS) {
    fail("failed-precondition", "Plan assignments are invalid.");
  }
  const assignments = plan.assignments.map((assignment, index) => {
    if (!isRecord(assignment) || text(assignment.state) !== OPERATIONAL_ASSIGNMENT_STATE) {
      fail("failed-precondition", `Plan assignment ${index + 1} is not operator-confirmed.`);
    }
    return Object.freeze({
      assignmentId: opaqueId(assignment.assignmentId, "Plan assignmentId", 160),
      staffId: opaqueId(assignment.staffId, "Plan staffId", 160),
      displayName: safeDisplayName(assignment.displayName),
      role: normalizeRole(assignment.role, "Plan assignment role"),
      staffRevision: boundedRevision(assignment.staffRevision, "Plan staffRevision", {
        allowZero: false
      }),
      state: OPERATIONAL_ASSIGNMENT_STATE
    });
  }).sort((left, right) => compareText(left.assignmentId, right.assignmentId));
  const coverage = deriveCoverage(requirements, assignments);
  if (text(plan.state) !== coverage.state) {
    fail("failed-precondition", "Plan coverage state does not match its bounded role evidence.");
  }
  return deepFreeze({
    schemaVersion: OPERATIONAL_STAFFING_SCHEMA_VERSION,
    authority: OPERATIONAL_STAFFING_AUTHORITY,
    organizationId,
    quoteId,
    quoteRevisionId,
    planRevision: boundedRevision(plan.revision, "Plan revision", { allowZero: false }),
    eventWindow: publicWindow(eventWindow),
    state: coverage.state,
    requirements: {
      source: "commercial_quote_copy",
      byRole: { ...requirements.byRole },
      boundary: COMMERCIAL_REQUIREMENT_BOUNDARY
    },
    coverage,
    assignments,
    assignmentState: OPERATIONAL_ASSIGNMENT_STATE,
    assignmentBoundary: ASSIGNMENT_EVIDENCE_BOUNDARY
  });
}

function receiptIdForNormalizedRequest(normalizedRequest) {
  return `osr_${canonicalDigest({
    schemaVersion: OPERATIONAL_STAFFING_RECEIPT_VERSION,
    organizationId: normalizedRequest.organizationId,
    quoteId: normalizedRequest.quoteId,
    requestId: normalizedRequest.requestId
  }, "Operational staffing receipt identity").slice(0, 48)}`;
}

function buildOperationalStaffingReceiptId(request) {
  return receiptIdForNormalizedRequest(normalizeRequest(request));
}

function withReceiptDigest(payload) {
  const normalized = canonicalClone(payload, "Operational staffing receipt");
  return deepFreeze({
    ...normalized,
    receiptDigest: canonicalDigest(normalized, "Operational staffing receipt digest")
  });
}

function normalizeProfileCommandRequest(value) {
  if (!isRecord(value)) {
    fail("invalid-argument", "Operational staff profile command request is required.");
  }
  assertAllowedKeys(
    value,
    new Set([
      "requestId",
      "organizationId",
      "staffId",
      "expectedRevision",
      "profile"
    ]),
    "Operational staff profile command request"
  );
  return deepFreeze({
    requestId: requestId(value.requestId),
    organizationId: opaqueId(value.organizationId, "organizationId"),
    staffId: opaqueId(value.staffId, "staffId", 160),
    expectedRevision: boundedRevision(value.expectedRevision, "expectedRevision"),
    profile: normalizeProfileCommandDraft(value.profile)
  });
}

function projectOperationalStaffProfile(profile) {
  if (!isRecord(profile)) {
    fail("failed-precondition", "An authoritative operational staff profile is required.");
  }
  const organizationId = opaqueId(profile.organizationId, "Staff profile organizationId");
  const normalized = normalizeStaffProfile({
    ...profile,
    availabilityTruncated: false
  }, organizationId);
  assertNonOverlappingAvailability(normalized.availabilityWindows);
  return deepFreeze({
    schemaVersion: OPERATIONAL_STAFFING_SCHEMA_VERSION,
    authority: OPERATIONAL_STAFFING_AUTHORITY,
    organizationId,
    staffId: normalized.staffId,
    displayName: normalized.displayName,
    active: normalized.active,
    capabilities: [...normalized.capabilities],
    revision: normalized.revision,
    availabilityWindows: normalized.availabilityWindows.map((item) => ({
      availabilityId: item.availabilityId,
      source: item.source,
      state: item.state,
      startAtISO: item.startAtISO,
      endAtISO: item.endAtISO
    })),
    availabilityBoundary: AVAILABILITY_EVIDENCE_BOUNDARY
  });
}

function profileReceiptIdForNormalizedRequest(normalizedRequest) {
  return `ospr_${canonicalDigest({
    schemaVersion: OPERATIONAL_STAFF_PROFILE_RECEIPT_VERSION,
    organizationId: normalizedRequest.organizationId,
    staffId: normalizedRequest.staffId,
    requestId: normalizedRequest.requestId
  }, "Operational staff profile receipt identity").slice(0, 48)}`;
}


function buildOperationalStaffProfileReceiptId(request) {
  return profileReceiptIdForNormalizedRequest(normalizeProfileCommandRequest(request));
}

function normalizeExistingProfileReceipt(value) {
  if (!isRecord(value)) {
    fail("data-loss", "Existing operational staff profile receipt is invalid.");
  }
  const suppliedDigest = text(value.receiptDigest).toLowerCase();
  const detached = { ...value };
  delete detached.receiptDigest;
  if (
    value.schemaVersion !== OPERATIONAL_STAFF_PROFILE_RECEIPT_VERSION
    || value.authority !== OPERATIONAL_STAFFING_AUTHORITY
    || value.receiptType !== "operational_staff_profile_command"
    || !PROFILE_RECEIPT_ID_PATTERN.test(text(value.receiptId))
    || !/^[a-f0-9]{64}$/u.test(suppliedDigest)
    || canonicalDigest(detached, "Existing operational staff profile receipt digest")
      !== suppliedDigest
  ) {
    fail("data-loss", "Existing operational staff profile receipt failed integrity validation.");
  }
  return deepFreeze(canonicalClone(value, "Existing operational staff profile receipt"));
}

function planOperationalStaffProfileCommand({
  request,
  currentProfile = null,
  actor,
  serverTimeISO,
  existingReceipt = null
} = {}) {
  const normalizedRequest = normalizeProfileCommandRequest(request);
  const normalizedActor = normalizeActor(actor, normalizedRequest.organizationId);
  if (normalizedActor.role !== "admin") {
    fail("permission-denied", "Admin authority is required to configure staff profiles.");
  }
  const requestDigest = canonicalDigest(
    normalizedRequest,
    "Operational staff profile request payload"
  );
  const commandDigest = canonicalDigest({
    request: normalizedRequest,
    actor: normalizedActor
  }, "Operational staff profile command payload");
  const receiptId = profileReceiptIdForNormalizedRequest(normalizedRequest);
  if (existingReceipt) {
    const receipt = normalizeExistingProfileReceipt(existingReceipt);
    if (
      receipt.receiptId !== receiptId
      || receipt.requestId !== normalizedRequest.requestId
      || receipt.organizationId !== normalizedRequest.organizationId
      || receipt.staffId !== normalizedRequest.staffId
      || receipt.requestDigest !== requestDigest
      || receipt.commandDigest !== commandDigest
    ) {
      fail(
        "already-exists",
        "The staff profile request identity is already bound to different immutable command evidence."
      );
    }
    return deepFreeze({
      kind: "reconcile",
      idempotent: true,
      request: normalizedRequest,
      nextProfile: null,
      snapshot: receipt.snapshot,
      receipt
    });
  }
  const recordedAtISO = exactISO(
    serverTimeISO,
    "Operational staff profile server time",
    "failed-precondition"
  );
  let currentSnapshot = null;
  if (currentProfile !== null && typeof currentProfile !== "undefined") {
    currentSnapshot = projectOperationalStaffProfile(currentProfile);
    if (
      currentSnapshot.organizationId !== normalizedRequest.organizationId
      || currentSnapshot.staffId !== normalizedRequest.staffId
    ) {
      fail("permission-denied", "Current staff profile is outside the command scope.");
    }
  }
  const observedRevision = currentSnapshot?.revision || 0;
  if (observedRevision !== normalizedRequest.expectedRevision) {
    fail("aborted", "The operational staff profile revision changed.", {
      expectedRevision: normalizedRequest.expectedRevision,
      observedRevision
    });
  }

  const nextProfile = deepFreeze({
    schemaVersion: OPERATIONAL_STAFFING_SCHEMA_VERSION,
    authority: OPERATIONAL_STAFFING_AUTHORITY,
    organizationId: normalizedRequest.organizationId,
    staffId: normalizedRequest.staffId,
    displayName: normalizedRequest.profile.displayName,
    active: normalizedRequest.profile.active,
    capabilities: [...normalizedRequest.profile.capabilities],
    revision: observedRevision + 1,
    availabilityWindows: normalizedRequest.profile.availabilityWindows.map((item) => ({ ...item })),
    updatedAtISO: recordedAtISO,
    updatedBy: normalizedActor,
    availabilityBoundary: AVAILABILITY_EVIDENCE_BOUNDARY
  });
  const snapshot = projectOperationalStaffProfile(nextProfile);
  const evidenceDigest = canonicalDigest({
    currentProfile: currentSnapshot
  }, "Operational staff profile command evidence");

  const receipt = withReceiptDigest({
    schemaVersion: OPERATIONAL_STAFF_PROFILE_RECEIPT_VERSION,
    authority: OPERATIONAL_STAFFING_AUTHORITY,
    receiptType: "operational_staff_profile_command",
    receiptId,
    requestId: normalizedRequest.requestId,
    organizationId: normalizedRequest.organizationId,
    staffId: normalizedRequest.staffId,
    priorRevision: observedRevision,
    resultRevision: observedRevision + 1,
    requestDigest,
    commandDigest,
    evidenceDigest,
    resultProfileDigest: canonicalDigest(nextProfile, "Operational staff profile result"),
    snapshot,
    recordedAtISO,
    recordedBy: normalizedActor,
    availabilityBoundary: AVAILABILITY_EVIDENCE_BOUNDARY
  });

  return deepFreeze({
    kind: "apply",
    idempotent: false,
    request: normalizedRequest,
    nextProfile,
    snapshot,
    receipt
  });
}

function normalizeExistingReceipt(value) {
  if (!isRecord(value)) {
    fail("data-loss", "Existing operational staffing receipt is invalid.");
  }
  const suppliedDigest = text(value.receiptDigest).toLowerCase();
  const detached = { ...value };
  delete detached.receiptDigest;
  if (
    value.schemaVersion !== OPERATIONAL_STAFFING_RECEIPT_VERSION
    || value.authority !== OPERATIONAL_STAFFING_AUTHORITY
    || value.receiptType !== "operational_staffing_command"
    || !RECEIPT_ID_PATTERN.test(text(value.receiptId))
    || !/^[a-f0-9]{64}$/u.test(suppliedDigest)
    || canonicalDigest(detached, "Existing staffing receipt digest") !== suppliedDigest
  ) {
    fail("data-loss", "Existing operational staffing receipt failed integrity validation.");
  }
  return deepFreeze(canonicalClone(value, "Existing operational staffing receipt"));
}

function planOperationalStaffingCommand({
  request,
  activeQuoteRevisionId,
  canonicalEventWindow,
  canonicalRequirements,
  currentPlan = null,
  staffProfiles = [],
  overlappingAssignments = [],
  scheduleFences = [],
  evidenceBounds = {},
  actor,
  serverTimeISO,
  existingReceipt = null
} = {}) {
  const normalizedRequest = normalizeRequest(request);
  const normalizedActor = normalizeActor(actor, normalizedRequest.organizationId);
  const requestDigest = canonicalDigest(
    normalizedRequest,
    "Operational staffing request payload"
  );
  const commandDigest = canonicalDigest({
    request: normalizedRequest,
    actor: normalizedActor
  }, "Operational staffing command payload");
  const receiptId = receiptIdForNormalizedRequest(normalizedRequest);
  if (existingReceipt) {
    const receipt = normalizeExistingReceipt(existingReceipt);
    if (
      receipt.receiptId !== receiptId
      || receipt.requestId !== normalizedRequest.requestId
      || receipt.organizationId !== normalizedRequest.organizationId
      || receipt.quoteId !== normalizedRequest.quoteId
      || receipt.requestDigest !== requestDigest
      || receipt.commandDigest !== commandDigest
    ) {
      fail(
        "already-exists",
        "The staffing request identity is already bound to different immutable command evidence."
      );
    }
    return deepFreeze({
      kind: "reconcile",
      idempotent: true,
      request: normalizedRequest,
      nextPlan: null,
      snapshot: receipt.snapshot,
      scheduleFenceInputs: [],
      scheduleFenceOutputs: [],
      receipt
    });
  }
  const recordedAtISO = exactISO(
    serverTimeISO,
    "Operational staffing server time",
    "failed-precondition"
  );
  const bounds = assertCompleteEvidence(evidenceBounds);
  const observedQuoteRevisionId = opaqueId(
    activeQuoteRevisionId,
    "Active quote revisionId",
    180
  );
  if (observedQuoteRevisionId !== normalizedRequest.expectedQuoteRevisionId) {
    fail("aborted", "The active commercial quote revision changed before staffing confirmation.", {
      expectedQuoteRevisionId: normalizedRequest.expectedQuoteRevisionId,
      observedQuoteRevisionId
    });
  }
  const normalizedCanonicalEventWindow = normalizeTimeWindow(
    canonicalEventWindow,
    "Canonical quote event window",
    MAX_EVENT_DURATION_MS
  );
  if (
    normalizedRequest.eventWindow.startAtISO !== normalizedCanonicalEventWindow.startAtISO
    || normalizedRequest.eventWindow.endAtISO !== normalizedCanonicalEventWindow.endAtISO
  ) {
    fail("aborted", "The requested staffing window does not match the canonical quote event window.", {
      requestedEventWindow: normalizedRequest.eventWindow,
      canonicalEventWindow: publicWindow(normalizedCanonicalEventWindow)
    });
  }
  const normalizedCanonicalRequirements = normalizeRequirements(
    canonicalRequirements,
    normalizedRequest.expectedQuoteRevisionId
  );
  if (
    canonicalSerialize(normalizedRequest.requirements.byRole, "Requested quoted requirements")
    !== canonicalSerialize(normalizedCanonicalRequirements.byRole, "Canonical quoted requirements")
  ) {
    fail(
      "aborted",
      "The requested staffing requirements do not match the canonical commercial quote revision.",
      {
        requestedRequirements: normalizedRequest.requirements.byRole,
        canonicalRequirements: normalizedCanonicalRequirements.byRole
      }
    );
  }

  const normalizedCurrentPlan = normalizeCurrentPlan(
    currentPlan,
    normalizedRequest.organizationId,
    normalizedRequest.quoteId
  );
  const observedPlanRevision = normalizedCurrentPlan?.revision || 0;
  if (observedPlanRevision !== normalizedRequest.expectedPlanRevision) {
    fail("aborted", "The operational staffing plan revision changed.", {
      expectedPlanRevision: normalizedRequest.expectedPlanRevision,
      observedPlanRevision
    });
  }

  const profiles = normalizeStaffProfiles(
    staffProfiles,
    normalizedRequest.organizationId
  );
  const profileById = new Map(profiles.map((profile) => [profile.staffId, profile]));
  const eventWindow = normalizeTimeWindow(
    normalizedRequest.eventWindow,
    "Operational staffing event window",
    MAX_EVENT_DURATION_MS
  );
  const planAssignments = normalizedRequest.assignments.map((assignment) => {
    const profile = profileById.get(assignment.staffId);
    if (!profile) {
      fail("failed-precondition", "An assigned staff profile is unavailable.", {
        staffId: assignment.staffId,
        reasonCode: "staff_profile_missing"
      });
    }
    if (profile.revision !== assignment.expectedStaffRevision) {
      fail("aborted", "A staff profile revision changed before staffing confirmation.", {
        staffId: assignment.staffId,
        expectedStaffRevision: assignment.expectedStaffRevision,
        observedStaffRevision: profile.revision
      });
    }
    if (!profile.active) {
      fail("failed-precondition", "An inactive staff profile cannot be assigned.", {
        staffId: assignment.staffId,
        reasonCode: "staff_inactive"
      });
    }
    if (!profile.capabilities.includes(assignment.role)) {
      fail("failed-precondition", "A staff profile lacks the assigned role capability.", {
        staffId: assignment.staffId,
        role: assignment.role,
        reasonCode: "capability_mismatch"
      });
    }
    const availability = evaluateAvailability(profile, normalizedRequest.eventWindow);
    if (availability.state !== "clear") {
      fail("failed-precondition", "Staff availability does not safely cover the event window.", {
        staffId: assignment.staffId,
        reasonCode: availability.reasonCode
      });
    }
    return deepFreeze({
      assignmentId: assignment.assignmentId,
      staffId: assignment.staffId,
      displayName: profile.displayName,
      role: assignment.role,
      staffRevision: profile.revision,
      state: OPERATIONAL_ASSIGNMENT_STATE
    });
  });

  const requiredFenceRefs = deriveOperationalStaffingScheduleFenceRefs({
    organizationId: normalizedRequest.organizationId,
    eventWindow: normalizedRequest.eventWindow,
    assignments: normalizedRequest.assignments,
    currentPlan: normalizedCurrentPlan
  });
  const expectedFences = normalizedRequest.expectedScheduleFences;
  const requiredFenceIds = requiredFenceRefs.map((item) => item.fenceId);
  if (
    canonicalSerialize(expectedFences.map((item) => item.fenceId))
    !== canonicalSerialize(requiredFenceIds)
  ) {
    fail("failed-precondition", "Expected schedule fences do not match the exact staffing plan scope.");
  }
  const observedFences = normalizeScheduleFences(
    scheduleFences,
    normalizedRequest.organizationId
  );
  if (
    canonicalSerialize(observedFences.map((item) => item.fenceId))
    !== canonicalSerialize(requiredFenceIds)
  ) {
    fail("failed-precondition", "Schedule fence evidence is incomplete or outside the exact plan scope.");
  }
  const expectedFenceById = new Map(expectedFences.map((item) => [item.fenceId, item]));
  observedFences.forEach((fence) => {
    const expected = expectedFenceById.get(fence.fenceId);
    if (!expected || expected.revision !== fence.revision) {
      fail("aborted", "A staffing schedule fence revision changed.", {
        fenceId: fence.fenceId,
        expectedRevision: expected?.revision,
        observedRevision: fence.revision
      });
    }
  });
  const fenceAssignments = dedupeFenceAssignments(observedFences);
  const suppliedExistingAssignments = normalizeExistingAssignments(
    overlappingAssignments,
    normalizedRequest.organizationId
  );
  if (
    canonicalSerialize(suppliedExistingAssignments, "Supplied overlap evidence")
    !== canonicalSerialize(fenceAssignments, "Schedule fence overlap evidence")
  ) {
    fail(
      "failed-precondition",
      "Overlap assignment evidence does not match the complete schedule fence projection."
    );
  }
  const existingAssignments = fenceAssignments;
  const replacedCurrentAssignmentIds = new Set(
    normalizedCurrentPlan?.assignments.map((item) => item.assignmentId) || []
  );
  for (const assignment of planAssignments) {
    const overlap = existingAssignments.find((existing) => (
      existing.staffId === assignment.staffId
      && intervalsOverlap(existing, eventWindow)
      && !(
        existing.quoteId === normalizedRequest.quoteId
        && replacedCurrentAssignmentIds.has(existing.assignmentId)
      )
    ));
    if (overlap) {
      fail("failed-precondition", "A staff member has an overlapping operator-confirmed assignment.", {
        staffId: assignment.staffId,
        conflictingAssignmentId: overlap.assignmentId,
        reasonCode: "assignment_overlap"
      });
    }
  }

  const nextPlanRevision = observedPlanRevision + 1;
  const coverage = deriveCoverage(normalizedRequest.requirements, planAssignments);
  const nextPlan = deepFreeze({
    schemaVersion: OPERATIONAL_STAFFING_SCHEMA_VERSION,
    authority: OPERATIONAL_STAFFING_AUTHORITY,
    organizationId: normalizedRequest.organizationId,
    quoteId: normalizedRequest.quoteId,
    quoteRevisionId: normalizedRequest.expectedQuoteRevisionId,
    revision: nextPlanRevision,
    eventWindow: normalizedRequest.eventWindow,
    requirements: normalizedRequest.requirements,
    assignments: planAssignments,
    coverage,
    state: coverage.state,
    updatedAtISO: recordedAtISO,
    updatedBy: normalizedActor,
    assignmentBoundary: ASSIGNMENT_EVIDENCE_BOUNDARY
  });
  const safeSnapshot = projectOperationalStaffingSnapshot(nextPlan);
  const scheduleFenceInputs = observedFences.map((fence) => deepFreeze({
    schemaVersion: fence.schemaVersion,
    organizationId: fence.organizationId,
    fenceId: fence.fenceId,
    staffId: fence.staffId,
    utcDate: fence.utcDate,
    revision: fence.revision,
    assignments: fence.assignments.map(projectOperationalStaffingFenceAssignment),
    assignmentsTruncated: false
  }));
  const scheduleFenceOutputs = observedFences.map((fence) => {
    const nextFenceRevision = fence.revision + 1;
    if (nextFenceRevision > 1_000_000_000) {
      fail("resource-exhausted", "A staffing schedule fence exhausted its bounded revision range.", {
        fenceId: fence.fenceId
      });
    }
    const retained = fence.assignments
      .filter((assignment) => !(
        assignment.quoteId === normalizedRequest.quoteId
        && replacedCurrentAssignmentIds.has(assignment.assignmentId)
      ))
      .map(projectOperationalStaffingFenceAssignment);
    const additions = planAssignments
      .filter((assignment) => (
        assignment.staffId === fence.staffId
        && utcDatesForWindow(normalizedRequest.eventWindow).includes(fence.utcDate)
      ))
      .map((assignment) => ({
        organizationId: normalizedRequest.organizationId,
        assignmentId: assignment.assignmentId,
        quoteId: normalizedRequest.quoteId,
        quoteRevisionId: normalizedRequest.expectedQuoteRevisionId,
        planRevision: nextPlanRevision,
        staffId: assignment.staffId,
        role: assignment.role,
        state: OPERATIONAL_ASSIGNMENT_STATE,
        eventWindow: normalizedRequest.eventWindow
      }));
    const nextAssignmentsById = new Map(
      [...retained, ...additions].map((assignment) => [assignment.assignmentId, assignment])
    );
    const nextAssignments = [...nextAssignmentsById.values()]
      .sort((left, right) => compareText(left.assignmentId, right.assignmentId));
    if (nextAssignments.length > MAX_EXISTING_ASSIGNMENTS) {
      fail("resource-exhausted", "Next schedule fence assignment projection exceeds its bound.");
    }
    return deepFreeze({
    fenceId: fence.fenceId,
    organizationId: fence.organizationId,
    staffId: fence.staffId,
    utcDate: fence.utcDate,
    expectedRevision: fence.revision,
    nextRevision: nextFenceRevision,
    nextProjection: {
      schemaVersion: OPERATIONAL_STAFFING_SCHEMA_VERSION,
      authority: "operational_staffing_schedule_fence",
      organizationId: fence.organizationId,
      fenceId: fence.fenceId,
      staffId: fence.staffId,
      utcDate: fence.utcDate,
      revision: nextFenceRevision,
      assignments: nextAssignments,
      assignmentsTruncated: false,
      updatedAtISO: recordedAtISO,
      lastCommandReceiptId: receiptId
    }
  });
  });

  const evidenceDigest = canonicalDigest({
    activeQuoteRevisionId: observedQuoteRevisionId,
    canonicalEventWindow: publicWindow(normalizedCanonicalEventWindow),
    canonicalRequirements: normalizedCanonicalRequirements,
    currentPlan: normalizedCurrentPlan,
    staffProfiles: profiles,
    overlappingAssignments: existingAssignments,
    scheduleFences: scheduleFenceInputs,
    evidenceBounds: bounds
  }, "Operational staffing command evidence");

  const receipt = withReceiptDigest({
    schemaVersion: OPERATIONAL_STAFFING_RECEIPT_VERSION,
    authority: OPERATIONAL_STAFFING_AUTHORITY,
    receiptType: "operational_staffing_command",
    receiptId,
    requestId: normalizedRequest.requestId,
    organizationId: normalizedRequest.organizationId,
    quoteId: normalizedRequest.quoteId,
    quoteRevisionId: normalizedRequest.expectedQuoteRevisionId,
    priorPlanRevision: observedPlanRevision,
    resultPlanRevision: nextPlanRevision,
    requestDigest,
    commandDigest,
    evidenceDigest,
    resultPlanDigest: canonicalDigest(nextPlan, "Operational staffing result plan"),
    assignmentState: OPERATIONAL_ASSIGNMENT_STATE,
    planState: coverage.state,
    scheduleFenceInputs,
    scheduleFenceOutputs,
    snapshot: safeSnapshot,
    recordedAtISO,
    recordedBy: normalizedActor,
    assignmentBoundary: ASSIGNMENT_EVIDENCE_BOUNDARY,
    coverageBoundary: COVERAGE_EVIDENCE_BOUNDARY,
    commercialRequirementBoundary: COMMERCIAL_REQUIREMENT_BOUNDARY
  });

  return deepFreeze({
    kind: "apply",
    idempotent: false,
    request: normalizedRequest,
    nextPlan,
    snapshot: safeSnapshot,
    scheduleFenceInputs: deepFreeze(scheduleFenceInputs),
    scheduleFenceOutputs: deepFreeze(scheduleFenceOutputs),
    receipt
  });
}

module.exports = {
  ASSIGNMENT_EVIDENCE_BOUNDARY,
  AVAILABILITY_EVIDENCE_BOUNDARY,
  COMMERCIAL_REQUIREMENT_BOUNDARY,
  COVERAGE_EVIDENCE_BOUNDARY,
  MAX_ASSIGNMENTS,
  MAX_AVAILABILITY_WINDOWS_PER_STAFF,
  MAX_EXISTING_ASSIGNMENTS,
  MAX_SCHEDULE_FENCES,
  MAX_STAFF_PROFILES,
  OPERATIONAL_ASSIGNMENT_STATE,
  OPERATIONAL_STAFFING_AUTHORITY,
  OPERATIONAL_STAFFING_AUTHORITY_VERSION,
  OPERATIONAL_STAFF_PROFILE_RECEIPT_VERSION,
  OPERATIONAL_STAFFING_RECEIPT_VERSION,
  OPERATIONAL_STAFFING_ROLES,
  OPERATIONAL_STAFFING_SCHEMA_VERSION,
  OperationalStaffingAuthorityError,
  buildOperationalStaffProfileReceiptId,
  buildOperationalStaffingReceiptId,
  buildOperationalStaffingScheduleFenceId,
  deriveOperationalStaffingScheduleFenceRefs,
  planOperationalStaffProfileCommand,
  planOperationalStaffingCommand,
  projectOperationalStaffProfile,
  projectOperationalStaffingSnapshot
};
