"use strict";

const { createHash } = require("node:crypto");

const {
  MAX_ASSIGNMENTS,
  MAX_EXISTING_ASSIGNMENTS,
  MAX_SCHEDULE_FENCES,
  OPERATIONAL_STAFFING_AUTHORITY_VERSION,
  OPERATIONAL_STAFFING_ROLES,
  buildOperationalStaffingScheduleFenceId,
  projectOperationalStaffProfile,
  projectOperationalStaffingSnapshot
} = require("./operationalStaffingAuthority");

const MAX_EVENT_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/u;

class OperationalStaffingRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "OperationalStaffingRuntimeError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new OperationalStaffingRuntimeError(code, message, details);
}

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactId(value, label) {
  const normalized = text(value);
  if (
    !normalized
    || normalized.length > 256
    || /[\s/?#\\\u0000]/u.test(normalized)
    || normalized === "."
    || normalized === ".."
  ) {
    fail("invalid-argument", `${label} must be an exact opaque identifier.`);
  }
  return normalized;
}

function exactISO(value, label) {
  const normalized = text(value);
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail("failed-precondition", `${label} must be an exact ISO timestamp.`);
  }
  return normalized;
}

function authorityState(globalValue, settings = {}) {
  const globalEnabled = text(globalValue).toLowerCase() === "true";
  const tenantEnabled = settings?.operationalStaffingAuthorityEnabled === true;
  return Object.freeze({
    enabled: globalEnabled && tenantEnabled,
    globalEnabled,
    tenantEnabled
  });
}

function assertOperationalStaffingAuthorityEnabled(globalValue, settings = {}) {
  const state = authorityState(globalValue, settings);
  if (!state.enabled) {
    fail(
      "failed-precondition",
      "Authoritative operational staffing is disabled for this environment or organization."
    );
  }
  return state;
}

function exactDateParts(value) {
  const match = DATE_PATTERN.exec(text(value));
  if (!match) {
    fail("failed-precondition", "The active quote revision requires an exact YYYY-MM-DD event date.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) {
    fail("failed-precondition", "The active quote revision event date is not a real calendar date.");
  }
  return { year, month, day };
}

function exactTimeParts(value) {
  const match = TIME_PATTERN.exec(text(value));
  if (!match) {
    fail("failed-precondition", "The active quote revision requires an exact 24-hour HH:mm event time.");
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    fail("failed-precondition", "The active quote revision event time is invalid.");
  }
  return { hour, minute };
}

function formatterForTimeZone(timeZone) {
  const normalized = text(timeZone);
  if (!normalized) {
    fail("failed-precondition", "Configure settings.businessTimeZone before using operational staffing.");
  }
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: normalized,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    formatter.formatToParts(new Date(0));
    return { formatter, timeZone: formatter.resolvedOptions().timeZone };
  } catch {
    fail("failed-precondition", "settings.businessTimeZone must be a valid IANA time zone.");
  }
}

function zonedParts(formatter, instantMs) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instantMs))
      .filter((item) => item.type !== "literal")
      .map((item) => [item.type, Number(item.value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function sameWallTime(left, right) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && right.second === 0;
}

function wallTimeToExactISO({ date, time, timeZone } = {}) {
  const dateParts = exactDateParts(date);
  const timeParts = exactTimeParts(time);
  const target = { ...dateParts, ...timeParts };
  const { formatter } = formatterForTimeZone(timeZone);
  const wallAsUTC = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    0,
    0
  );
  const offsets = new Set();
  [-48, -24, -12, -6, 0, 6, 12, 24, 48].forEach((hours) => {
    const sample = wallAsUTC + hours * 60 * 60 * 1000;
    const parts = zonedParts(formatter, sample);
    const representedAsUTC = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0
    );
    offsets.add(representedAsUTC - sample);
  });
  const candidates = [...offsets]
    .map((offset) => wallAsUTC - offset)
    .filter((instantMs) => sameWallTime(target, zonedParts(formatter, instantMs)))
    .filter((instantMs, index, values) => values.indexOf(instantMs) === index)
    .sort((left, right) => left - right);
  if (candidates.length === 0) {
    fail(
      "failed-precondition",
      "The active quote revision event time does not exist in the tenant time zone because of a daylight-saving transition."
    );
  }
  if (candidates.length !== 1) {
    fail(
      "failed-precondition",
      "The active quote revision event time is ambiguous in the tenant time zone because of a daylight-saving transition."
    );
  }
  return new Date(candidates[0]).toISOString();
}

function boundedRoleCount(value, role) {
  const count = Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_ASSIGNMENTS) {
    fail("failed-precondition", `The active quote revision ${role} count is invalid.`);
  }
  return count;
}

function deriveCanonicalOperationalStaffingEvidence({
  organizationId,
  quoteId,
  activeQuoteRevisionId,
  version,
  settings
} = {}) {
  const scopedOrganizationId = exactId(organizationId, "organizationId");
  const scopedQuoteId = exactId(quoteId, "quoteId");
  const revisionId = exactId(activeQuoteRevisionId, "activeQuoteRevisionId");
  if (!isRecord(version) || !isRecord(version.snapshot)) {
    fail("failed-precondition", "The exact active immutable quote revision is unavailable.");
  }
  if (
    exactId(version.versionId, "Quote versionId") !== revisionId
    || exactId(version.organizationId, "Quote version organizationId") !== scopedOrganizationId
    || exactId(version.quoteId, "Quote version quoteId") !== scopedQuoteId
  ) {
    fail("failed-precondition", "The immutable quote revision does not match the staffing scope.");
  }
  const snapshot = version.snapshot;
  if (
    (text(snapshot.organizationId) && text(snapshot.organizationId) !== scopedOrganizationId)
    || (text(snapshot.id) && text(snapshot.id) !== scopedQuoteId)
    || (text(snapshot.activeVersionId) && text(snapshot.activeVersionId) !== revisionId)
  ) {
    fail("failed-precondition", "The immutable quote snapshot identity is inconsistent.");
  }
  if (!isRecord(snapshot.event)) {
    fail("failed-precondition", "The active quote revision event evidence is unavailable.");
  }
  const startAtISO = wallTimeToExactISO({
    date: snapshot.event.date,
    time: snapshot.event.time,
    timeZone: settings?.businessTimeZone
  });
  const hours = Number(snapshot.event.hours);
  const durationMs = hours * 60 * 60 * 1000;
  if (
    !Number.isFinite(hours)
    || hours <= 0
    || !Number.isSafeInteger(durationMs)
    || durationMs > MAX_EVENT_DURATION_MS
  ) {
    fail("failed-precondition", "The active quote revision event duration is invalid.");
  }
  const startMs = Date.parse(startAtISO);
  const endAtISO = new Date(startMs + durationMs).toISOString();
  const requirements = {
    lead: 0,
    server: boundedRoleCount(snapshot.event.servers, "server"),
    chef: boundedRoleCount(snapshot.event.chefs, "chef"),
    bartender: boundedRoleCount(snapshot.event.bartenders, "bartender")
  };
  if (Object.values(requirements).reduce((sum, count) => sum + count, 0) > MAX_ASSIGNMENTS) {
    fail("resource-exhausted", "The active quote revision staffing counts exceed the plan bound.");
  }
  return Object.freeze({
    activeQuoteRevisionId: revisionId,
    canonicalEventWindow: Object.freeze({ startAtISO, endAtISO }),
    canonicalRequirements: Object.freeze(requirements)
  });
}

function projectedCoverage(requirementsByRole, assignmentCountsByRole = null, reasonCode = "") {
  const byRole = {};
  let totalRequired = 0;
  let totalOperatorConfirmedCount = assignmentCountsByRole ? 0 : null;
  let totalGap = assignmentCountsByRole ? 0 : null;
  OPERATIONAL_STAFFING_ROLES.forEach((role) => {
    const requiredCount = boundedRoleCount(requirementsByRole[role], role);
    const operatorConfirmedCount = assignmentCountsByRole
      ? boundedRoleCount(assignmentCountsByRole[role], role)
      : null;
    const gap = operatorConfirmedCount === null
      ? null
      : Math.max(0, requiredCount - operatorConfirmedCount);
    totalRequired += requiredCount;
    if (operatorConfirmedCount !== null) {
      totalOperatorConfirmedCount += operatorConfirmedCount;
      totalGap += gap;
    }
    byRole[role] = Object.freeze({ requiredCount, operatorConfirmedCount, gap });
  });
  const state = totalGap === null
    ? "unverified"
    : totalRequired === 0
      ? "not_required"
      : totalGap === 0
        ? "coverage_confirmed"
        : "attention";
  return Object.freeze({
    state,
    byRole: Object.freeze(byRole),
    totalRequired,
    totalOperatorConfirmedCount,
    totalGap,
    reasonCode: text(reasonCode) || (totalGap === null
      ? "staffing_coverage_not_evaluated"
      : "staffing_coverage_compared")
  });
}

function buildProjectedOperationalStaffingObservation({
  organizationId,
  quoteId,
  expectedBaseQuoteRevisionId,
  projectedVersion,
  currentPlan = null,
  settings
} = {}) {
  const scopedOrganizationId = exactId(organizationId, "organizationId");
  const scopedQuoteId = exactId(quoteId, "quoteId");
  const baseQuoteRevisionId = exactId(
    expectedBaseQuoteRevisionId,
    "expectedBaseQuoteRevisionId"
  );
  const proposedQuoteRevisionId = exactId(
    projectedVersion?.versionId,
    "Projected quote versionId"
  );
  const proposed = deriveCanonicalOperationalStaffingEvidence({
    organizationId: scopedOrganizationId,
    quoteId: scopedQuoteId,
    activeQuoteRevisionId: proposedQuoteRevisionId,
    version: projectedVersion,
    settings
  });
  const noAssignments = Object.fromEntries(
    OPERATIONAL_STAFFING_ROLES.map((role) => [role, 0])
  );
  let currentPlanState = "absent";
  let windowState = "not_applicable";
  let coverage = projectedCoverage(
    proposed.canonicalRequirements,
    noAssignments,
    "staffing_plan_not_recorded"
  );

  if (currentPlan !== null && typeof currentPlan !== "undefined") {
    const snapshot = projectOperationalStaffingSnapshot(currentPlan);
    if (
      snapshot.organizationId !== scopedOrganizationId
      || snapshot.quoteId !== scopedQuoteId
    ) {
      fail("permission-denied", "The staffing plan is outside the projected quote scope.");
    }
    currentPlanState = snapshot.quoteRevisionId === baseQuoteRevisionId ? "current" : "stale";
    windowState = snapshot.eventWindow.startAtISO === proposed.canonicalEventWindow.startAtISO
      && snapshot.eventWindow.endAtISO === proposed.canonicalEventWindow.endAtISO
      ? "same"
      : "changed";
    if (currentPlanState === "stale") {
      coverage = projectedCoverage(
        proposed.canonicalRequirements,
        null,
        "staffing_plan_quote_revision_stale"
      );
    } else if (windowState === "changed") {
      coverage = projectedCoverage(
        proposed.canonicalRequirements,
        null,
        "schedule_revalidation_required"
      );
    } else {
      const counts = Object.fromEntries(
        OPERATIONAL_STAFFING_ROLES.map((role) => [role, 0])
      );
      snapshot.assignments.forEach((assignment) => {
        counts[assignment.role] += 1;
      });
      coverage = projectedCoverage(
        proposed.canonicalRequirements,
        counts,
        "current_assignments_compared_with_proposed_requirements"
      );
    }
  }

  const preview = Object.freeze({
    proposed: Object.freeze({
      quoteRevisionId: proposedQuoteRevisionId,
      eventWindow: proposed.canonicalEventWindow,
      requirementsByRole: proposed.canonicalRequirements,
      totalRequired: Object.values(proposed.canonicalRequirements)
        .reduce((sum, count) => sum + count, 0)
    }),
    currentPlanState,
    comparison: Object.freeze({ windowState, coverage }),
    boundary: "Read-only aggregate Staffing evidence only. No person, assignment, invitation, availability response, schedule fence, payroll, pricing, or quote state was written or disclosed."
  });
  const inputDigest = createHash("sha256").update(JSON.stringify({
    schemaVersion: "commercial-change-staffing-observation-v1",
    organizationId: scopedOrganizationId,
    quoteId: scopedQuoteId,
    baseQuoteRevisionId,
    proposedQuoteRevisionId,
    proposed: preview.proposed,
    currentPlanState,
    comparison: preview.comparison
  })).digest("hex");
  return Object.freeze({ inputDigest, preview });
}

function utcDatesForWindow(eventWindow = {}) {
  const startAtISO = exactISO(eventWindow.startAtISO, "eventWindow.startAtISO");
  const endAtISO = exactISO(eventWindow.endAtISO, "eventWindow.endAtISO");
  const startMs = Date.parse(startAtISO);
  const endMs = Date.parse(endAtISO);
  if (endMs <= startMs || endMs - startMs > MAX_EVENT_DURATION_MS) {
    fail("failed-precondition", "The canonical staffing event window is invalid.");
  }
  const first = new Date(startMs);
  const last = new Date(endMs - 1);
  const firstDay = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  const lastDay = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  const dates = [];
  for (let day = firstDay; day <= lastDay; day += 24 * 60 * 60 * 1000) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}

function buildSnapshotScheduleFenceRefs({
  organizationId,
  eventWindow,
  profiles = [],
  currentPlan = null,
  maximum = MAX_SCHEDULE_FENCES
} = {}) {
  const scopedOrganizationId = exactId(organizationId, "organizationId");
  if (!Array.isArray(profiles)) {
    fail("failed-precondition", "Staff profile evidence must be bounded.");
  }
  const rawRefs = [];
  const addRefs = (staffIds, window) => {
    const utcDates = utcDatesForWindow(window);
    [...staffIds].sort().forEach((staffId) => {
      utcDates.forEach((utcDate) => {
        rawRefs.push({
          organizationId: scopedOrganizationId,
          staffId,
          utcDate,
          fenceId: buildOperationalStaffingScheduleFenceId({
            organizationId: scopedOrganizationId,
            staffId,
            utcDate
          })
        });
      });
    });
  };
  const candidateStaffIds = new Set();
  profiles.forEach((profile) => candidateStaffIds.add(exactId(profile?.staffId, "staffId")));
  addRefs(candidateStaffIds, eventWindow);
  if (currentPlan !== null && typeof currentPlan !== "undefined") {
    if (!Array.isArray(currentPlan.assignments)) {
      fail("failed-precondition", "Current plan assignments are unavailable.");
    }
    const currentStaffIds = new Set();
    currentPlan.assignments.forEach((assignment) => {
      currentStaffIds.add(exactId(assignment?.staffId, "Current plan staffId"));
    });
    addRefs(currentStaffIds, currentPlan.eventWindow);
  }
  const refs = [...new Map(rawRefs.map((ref) => [ref.fenceId, ref])).values()];
  refs.sort((left, right) => left.fenceId.localeCompare(right.fenceId));
  return Object.freeze({
    refs: Object.freeze(refs.slice(0, maximum).map((item) => Object.freeze(item))),
    truncated: refs.length > maximum,
    totalCount: refs.length
  });
}

function emptyScheduleFence(ref = {}) {
  return Object.freeze({
    schemaVersion: 1,
    authority: "operational_staffing_schedule_fence",
    organizationId: exactId(ref.organizationId, "Schedule fence organizationId"),
    fenceId: exactId(ref.fenceId, "Schedule fence fenceId"),
    staffId: exactId(ref.staffId, "Schedule fence staffId"),
    utcDate: text(ref.utcDate),
    revision: 0,
    assignments: Object.freeze([]),
    assignmentsTruncated: false
  });
}

function scheduleFenceMetadata(fence = {}) {
  if (
    !isRecord(fence)
    || fence.assignmentsTruncated === true
    || !Array.isArray(fence.assignments)
    || fence.assignments.length > MAX_EXISTING_ASSIGNMENTS
  ) {
    fail("resource-exhausted", "Schedule fence evidence is missing or truncated.");
  }
  const organizationId = exactId(fence.organizationId, "Schedule fence organizationId");
  const fenceId = exactId(fence.fenceId, "Schedule fence fenceId");
  const staffId = exactId(fence.staffId, "Schedule fence staffId");
  const utcDate = text(fence.utcDate);
  const revision = Number(fence.revision);
  if (
    !DATE_PATTERN.test(utcDate)
    || !Number.isSafeInteger(revision)
    || revision < 0
    || buildOperationalStaffingScheduleFenceId({ organizationId, staffId, utcDate }) !== fenceId
  ) {
    fail("data-loss", "Schedule fence identity or revision is invalid.");
  }
  return Object.freeze({ fenceId, staffId, utcDate, revision });
}

function dedupeScheduleFenceAssignments(fences = []) {
  const byIdentity = new Map();
  fences.forEach((fence) => {
    scheduleFenceMetadata(fence);
    const fenceOrganizationId = exactId(
      fence.organizationId,
      "Schedule fence organizationId"
    );
    const fenceStaffId = exactId(fence.staffId, "Schedule fence staffId");
    const fenceUtcDate = text(fence.utcDate);
    fence.assignments.forEach((assignment) => {
      const assignmentId = exactId(assignment?.assignmentId, "Schedule fence assignmentId");
      const publicAssignment = {
        organizationId: exactId(assignment.organizationId, "Schedule fence assignment organizationId"),
        assignmentId,
        quoteId: exactId(assignment.quoteId, "Schedule fence assignment quoteId"),
        quoteRevisionId: exactId(
          assignment.quoteRevisionId,
          "Schedule fence assignment quoteRevisionId"
        ),
        planRevision: Number(assignment.planRevision),
        staffId: exactId(assignment.staffId, "Schedule fence assignment staffId"),
        role: text(assignment.role),
        state: text(assignment.state),
        eventWindow: {
          startAtISO: exactISO(
            assignment.eventWindow?.startAtISO,
            "Schedule fence assignment startAtISO"
          ),
          endAtISO: exactISO(
            assignment.eventWindow?.endAtISO,
            "Schedule fence assignment endAtISO"
          )
        }
      };
      if (
        publicAssignment.organizationId !== fenceOrganizationId
        || publicAssignment.staffId !== fenceStaffId
        || !utcDatesForWindow(publicAssignment.eventWindow).includes(fenceUtcDate)
        || !["lead", "server", "chef", "bartender"].includes(publicAssignment.role)
        || publicAssignment.state !== "operator_confirmed"
        || !Number.isSafeInteger(publicAssignment.planRevision)
        || publicAssignment.planRevision < 1
      ) {
        fail("data-loss", "A schedule fence assignment is outside its exact authority scope.");
      }
      const serialized = JSON.stringify(publicAssignment);
      if (byIdentity.has(assignmentId) && byIdentity.get(assignmentId).serialized !== serialized) {
        fail("data-loss", "Schedule fences disagree about an assignment projection.");
      }
      byIdentity.set(assignmentId, { serialized, assignment: publicAssignment });
    });
  });
  if (byIdentity.size > MAX_EXISTING_ASSIGNMENTS) {
    fail("resource-exhausted", "Schedule fence overlap evidence exceeds its bounded size.");
  }
  return [...byIdentity.values()]
    .map((item) => item.assignment)
    .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
}

function buildOperationalStaffingSnapshotEnvelope({
  organizationId,
  quoteId,
  observedAtISO,
  canonicalEvidence,
  profiles,
  profilesTruncated,
  fences,
  scheduleFencesTruncated,
  currentPlan
} = {}) {
  const safeProfiles = profiles.map((profile) => projectOperationalStaffProfile(profile));
  const snapshot = currentPlan ? projectOperationalStaffingSnapshot(currentPlan) : null;
  let state = snapshot ? "current" : "empty";
  const reasonCodes = [];
  if (!snapshot) reasonCodes.push("staffing_plan_not_recorded");
  if (snapshot && snapshot.quoteRevisionId !== canonicalEvidence.activeQuoteRevisionId) {
    state = "stale";
    reasonCodes.push("staffing_plan_quote_revision_stale");
  }
  if (profilesTruncated || scheduleFencesTruncated) {
    if (state !== "stale") state = "partial";
    if (profilesTruncated) reasonCodes.push("staff_profiles_truncated");
    if (scheduleFencesTruncated) reasonCodes.push("schedule_fences_truncated");
  }
  if (!reasonCodes.length) reasonCodes.push("staffing_evidence_current");
  return Object.freeze({
    ok: true,
    storage: "firebase",
    authorityVersion: OPERATIONAL_STAFFING_AUTHORITY_VERSION,
    organizationId: exactId(organizationId, "organizationId"),
    quoteId: exactId(quoteId, "quoteId"),
    activeQuoteRevisionId: canonicalEvidence.activeQuoteRevisionId,
    canonicalEventWindow: canonicalEvidence.canonicalEventWindow,
    canonicalRequirements: canonicalEvidence.canonicalRequirements,
    observedAtISO: exactISO(observedAtISO, "observedAtISO"),
    state,
    reasonCodes: Object.freeze(reasonCodes),
    profiles: Object.freeze(safeProfiles),
    profilesTruncated: profilesTruncated === true,
    expectedScheduleFences: Object.freeze(fences.map(scheduleFenceMetadata)),
    scheduleFencesTruncated: scheduleFencesTruncated === true,
    snapshot
  });
}

module.exports = {
  OperationalStaffingRuntimeError,
  assertOperationalStaffingAuthorityEnabled,
  authorityState,
  buildOperationalStaffingSnapshotEnvelope,
  buildProjectedOperationalStaffingObservation,
  buildSnapshotScheduleFenceRefs,
  dedupeScheduleFenceAssignments,
  deriveCanonicalOperationalStaffingEvidence,
  emptyScheduleFence,
  scheduleFenceMetadata,
  utcDatesForWindow,
  wallTimeToExactISO
};
