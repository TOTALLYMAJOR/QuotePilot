const ROLES = Object.freeze(["lead", "server", "chef", "bartender"]);
const ROLE_SET = new Set(ROLES);
const MAX_GUEST_COUNT = 2_000;
const MAX_PROFILES = 128;
const MAX_THRESHOLDS_PER_ROLE = 64;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PROPOSED_REQUIREMENT_SOURCES = new Set([
  "proposed_commercial_and_canonical_counts",
  "server_authoritative_commercial_preview",
  "commercial_quote_revision"
]);

const EVIDENCE_STATES = new Set([
  "available",
  "not_yet_available",
  "missing",
  "stale",
  "blocked_by_integration",
  "contradictory",
  "schema_drift",
  "not_applicable"
]);

const PRESENTATION_BOUNDARY = [
  "This fulfillment projection is a privacy-safe, presentation-only composition of revision-bound People and Supply evidence.",
  "It does not price a quote, create staffing policy, assign or contact staff, reserve inventory, apply a commercial change, or establish event readiness."
].join(" ");

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return String(value ?? "").trim();
}

function exactInteger(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function exactISO(value) {
  const normalized = text(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}T/u.test(normalized)) return "";
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString() === normalized ? normalized : "";
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function uniqueSorted(values = []) {
  return [...new Set(values.map(text).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function evidenceState(value, fallback = "missing") {
  const explicit = text(value?.evidenceState);
  if (EVIDENCE_STATES.has(explicit)) return explicit;
  const state = text(value?.state);
  if (["current", "recorded", "complete", "partial"].includes(state)) return "available";
  if (["pending", "loading", "empty", "not_evaluated"].includes(state)) {
    return "not_yet_available";
  }
  if (["stale", "mismatched"].includes(state)) return "stale";
  if (["blocked", "error", "unavailable"].includes(state)) return "blocked_by_integration";
  if (["contradictory", "schema_drift"].includes(state)) return state;
  return fallback;
}

function unavailableHeadroom(reasonCode, state = "missing", currentGuestCount = null) {
  return {
    state: "unverified",
    evidenceState: EVIDENCE_STATES.has(state) ? state : "missing",
    variable: "guest_count",
    currentGuestCount,
    safeThroughGuestCount: null,
    safeGuestIncrease: null,
    guestsUntilBoundary: null,
    nextBoundary: null,
    reasonCodes: uniqueSorted([reasonCode || "headroom_evidence_missing"])
  };
}

function roleCounts(value) {
  if (!isRecord(value)) return null;
  const normalized = {};
  for (const role of ROLES) {
    const count = exactInteger(value[role], { maximum: MAX_PROFILES });
    if (count === null) return null;
    normalized[role] = count;
  }
  if (Object.keys(value).some((role) => !ROLE_SET.has(role))) return null;
  return normalized;
}

function requirementsFromPeople(value) {
  return roleCounts(
    value?.requirementsByRole
      || value?.canonicalRequirements?.byRole
      || value?.canonicalRequirements
      || value?.snapshot?.requirements?.byRole
      || value?.current?.requirementsByRole
  );
}

function assignmentsFromPeople(value) {
  const assignments = value?.assignments || value?.snapshot?.assignments;
  if (!Array.isArray(assignments) || assignments.length > MAX_PROFILES) return null;
  const normalized = [];
  const identities = new Set();
  for (const assignment of assignments) {
    const staffId = text(assignment?.staffId);
    const role = text(assignment?.role).toLowerCase();
    const state = text(assignment?.state || "operator_confirmed").toLowerCase();
    if (!staffId || !ROLE_SET.has(role) || state !== "operator_confirmed" || identities.has(staffId)) {
      return null;
    }
    identities.add(staffId);
    normalized.push({ staffId, role });
  }
  return normalized.sort((left, right) => (
    left.staffId.localeCompare(right.staffId) || left.role.localeCompare(right.role)
  ));
}

function assignmentCounts(assignments) {
  const counts = Object.fromEntries(ROLES.map((role) => [role, 0]));
  assignments.forEach((assignment) => {
    counts[assignment.role] += 1;
  });
  return counts;
}

function eventWindowFromPeople(value) {
  const source = value?.eventWindow || value?.canonicalEventWindow || value?.snapshot?.eventWindow;
  const startAtISO = exactISO(source?.startAtISO);
  const endAtISO = exactISO(source?.endAtISO);
  if (!startAtISO || !endAtISO || Date.parse(endAtISO) <= Date.parse(startAtISO)) return null;
  return { startAtISO, endAtISO };
}

function windowsMatch(left, right) {
  return Boolean(left) && Boolean(right)
    && left.startAtISO === right.startAtISO
    && left.endAtISO === right.endAtISO;
}

function intervalsOverlap(left, right) {
  return Date.parse(left.startAtISO) < Date.parse(right.endAtISO)
    && Date.parse(right.startAtISO) < Date.parse(left.endAtISO);
}

function availabilityCovers(profile, eventWindow) {
  if (!Array.isArray(profile?.availabilityWindows) || profile.availabilityTruncated === true) {
    return { eligible: false, complete: false };
  }
  const windows = [];
  for (const entry of profile.availabilityWindows) {
    const startAtISO = exactISO(entry?.startAtISO);
    const endAtISO = exactISO(entry?.endAtISO);
    const state = text(entry?.state).toLowerCase();
    const source = text(entry?.source).toLowerCase();
    if (!startAtISO || !endAtISO || Date.parse(endAtISO) <= Date.parse(startAtISO)
      || !["available", "unavailable"].includes(state) || source !== "operator_recorded") {
      return { eligible: false, complete: false };
    }
    windows.push({ startAtISO, endAtISO, state });
  }
  if (windows.some((entry) => entry.state === "unavailable" && intervalsOverlap(entry, eventWindow))) {
    return { eligible: false, complete: true };
  }
  const available = windows
    .filter((entry) => entry.state === "available" && intervalsOverlap(entry, eventWindow))
    .map((entry) => ({
      startMs: Math.max(Date.parse(entry.startAtISO), Date.parse(eventWindow.startAtISO)),
      endMs: Math.min(Date.parse(entry.endAtISO), Date.parse(eventWindow.endAtISO))
    }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  let coveredUntil = Date.parse(eventWindow.startAtISO);
  for (const interval of available) {
    if (interval.startMs > coveredUntil) break;
    coveredUntil = Math.max(coveredUntil, interval.endMs);
    if (coveredUntil >= Date.parse(eventWindow.endAtISO)) {
      return { eligible: true, complete: true };
    }
  }
  return { eligible: false, complete: true };
}

function normalizedConflictEvidence(
  value,
  { organizationId, quoteId, quoteRevisionId, eventWindow } = {}
) {
  if (!isRecord(value)) return { valid: false, state: "missing", reasonCode: "schedule_conflict_evidence_missing" };
  const state = evidenceState(value);
  if (state !== "available") {
    return { valid: false, state, reasonCode: `schedule_conflict_evidence_${state}` };
  }
  if (text(value.freshness || "current") !== "current") {
    return { valid: false, state: "stale", reasonCode: "schedule_conflict_evidence_stale" };
  }
  if (value.truncated === true || value.scheduleFencesTruncated === true
    || text(value.completeness || "complete") !== "complete") {
    return { valid: false, state: "missing", reasonCode: "schedule_conflict_evidence_truncated" };
  }
  if (text(value.quoteRevisionId) !== quoteRevisionId) {
    return { valid: false, state: "stale", reasonCode: "schedule_conflict_quote_revision_mismatch" };
  }
  if (text(value.organizationId) !== organizationId || text(value.quoteId) !== quoteId) {
    return { valid: false, state: "stale", reasonCode: "schedule_conflict_scope_mismatch" };
  }
  const conflictWindow = eventWindowFromPeople({ eventWindow: value.eventWindow });
  if (!windowsMatch(conflictWindow, eventWindow)) {
    return { valid: false, state: "stale", reasonCode: "schedule_conflict_event_window_mismatch" };
  }
  const sourceRevisionId = text(value.sourceRevisionId);
  if (!sourceRevisionId) {
    return { valid: false, state: "missing", reasonCode: "schedule_conflict_revision_missing" };
  }
  const source = isRecord(value.byStaffId)
    ? Object.entries(value.byStaffId).map(([staffId, entry]) => ({ staffId, ...entry }))
    : Array.isArray(value.entries) ? value.entries : null;
  if (!source || source.length > MAX_PROFILES) {
    return { valid: false, state: "missing", reasonCode: "schedule_conflict_entries_missing" };
  }
  const byStaffId = new Map();
  for (const entry of source) {
    const staffId = text(entry?.staffId);
    const conflictState = text(entry?.state).toLowerCase();
    if (!staffId || !["clear", "conflict"].includes(conflictState) || byStaffId.has(staffId)) {
      return { valid: false, state: "missing", reasonCode: "schedule_conflict_entries_invalid" };
    }
    byStaffId.set(staffId, conflictState);
  }
  return { valid: true, state: "available", sourceRevisionId, byStaffId };
}

function buildResilience({
  people,
  requirements,
  assignments,
  organizationId,
  quoteId,
  quoteRevisionId,
  eventWindow
}) {
  const unavailable = (reasonCode, state = "missing") => ({
    evidenceState: state,
    completeness: "partial",
    eligibleBackupCountByRole: Object.fromEntries(ROLES.map((role) => [role, null])),
    eligibleProfileCount: null,
    zeroBackupCriticalRoles: [],
    reasonCodes: [reasonCode],
    boundary: "Backup counts require complete bounded safe profiles, event availability, and conflict-clear schedule evidence."
  });

  if (!eventWindow) return unavailable("canonical_event_window_missing");
  if (!Array.isArray(people?.profiles)) return unavailable("staff_profiles_missing");
  if (people.profilesTruncated === true || people.profiles.length > MAX_PROFILES) {
    return unavailable("staff_profiles_truncated");
  }
  const conflicts = normalizedConflictEvidence(people.scheduleConflictEvidence, {
    organizationId,
    quoteId,
    quoteRevisionId,
    eventWindow
  });
  if (!conflicts.valid) return unavailable(conflicts.reasonCode, conflicts.state);

  const assignedIds = new Set(assignments.map((assignment) => assignment.staffId));
  const counts = Object.fromEntries(ROLES.map((role) => [role, 0]));
  const eligibleIds = new Set();
  const observedProfileIds = new Set();
  for (const profile of people.profiles) {
    const staffId = text(profile?.staffId);
    const capabilities = Array.isArray(profile?.capabilities)
      ? uniqueSorted(profile.capabilities.map((role) => text(role).toLowerCase()))
      : [];
    if (!staffId || text(profile?.organizationId) !== organizationId
      || observedProfileIds.has(staffId) || typeof profile?.active !== "boolean"
      || capabilities.some((role) => !ROLE_SET.has(role))) {
      return unavailable("staff_profile_evidence_invalid");
    }
    observedProfileIds.add(staffId);
    if (!profile.active || assignedIds.has(staffId) || capabilities.length === 0) continue;
    const availability = availabilityCovers(profile, eventWindow);
    if (!availability.complete) return unavailable("staff_availability_evidence_invalid");
    if (!availability.eligible) continue;
    if (!conflicts.byStaffId.has(staffId)) return unavailable("schedule_conflict_candidate_missing");
    if (conflicts.byStaffId.get(staffId) !== "clear") continue;
    eligibleIds.add(staffId);
    capabilities.forEach((role) => {
      counts[role] += 1;
    });
  }
  const zeroBackupCriticalRoles = ROLES.filter((role) => requirements[role] > 0 && counts[role] === 0);
  return {
    evidenceState: "available",
    completeness: "complete",
    eligibleBackupCountByRole: counts,
    eligibleProfileCount: eligibleIds.size,
    zeroBackupCriticalRoles,
    reasonCodes: ["bounded_availability_and_conflict_evidence_current"],
    sourceRevisionId: conflicts.sourceRevisionId,
    boundary: "Counts include only active, unassigned, role-capable profiles with complete operator-recorded availability and current conflict-clear evidence."
  };
}

function normalizeThresholdRule(value) {
  if (!isRecord(value) || text(value.kind) !== "thresholds" || !Array.isArray(value.thresholds)
    || value.thresholds.length < 1 || value.thresholds.length > MAX_THRESHOLDS_PER_ROLE) return null;
  if (Object.keys(value).some((key) => !["kind", "thresholds"].includes(key))) return null;
  const thresholds = [];
  let previousAt = 0;
  let previousRequired = -1;
  for (const threshold of value.thresholds) {
    if (!isRecord(threshold)
      || Object.keys(threshold).some((key) => !["atGuestCount", "requiredCount"].includes(key))) return null;
    const atGuestCount = exactInteger(threshold.atGuestCount, { minimum: 1, maximum: MAX_GUEST_COUNT });
    const requiredCount = exactInteger(threshold.requiredCount, { maximum: MAX_PROFILES });
    if (atGuestCount === null || requiredCount === null
      || atGuestCount <= previousAt || requiredCount < previousRequired) return null;
    thresholds.push({ atGuestCount, requiredCount });
    previousAt = atGuestCount;
    previousRequired = requiredCount;
  }
  if (thresholds[0].atGuestCount !== 1) return null;
  return { kind: "thresholds", thresholds };
}

function normalizeRatioRule(value) {
  if (!isRecord(value) || text(value.kind) !== "ratio"
    || Object.keys(value).some((key) => !["kind", "guestsPerStaff", "minimum"].includes(key))) return null;
  const guestsPerStaff = exactInteger(value.guestsPerStaff, { minimum: 1, maximum: MAX_GUEST_COUNT });
  const minimum = exactInteger(value.minimum, { maximum: MAX_PROFILES });
  if (guestsPerStaff === null || minimum === null) return null;
  return { kind: "ratio", guestsPerStaff, minimum };
}

function normalizeStaffingPolicy(value, organizationId) {
  const invalid = (reasonCode, state = "missing") => ({ valid: false, reasonCode, state });
  if (!isRecord(value)) return invalid("staffing_policy_missing");
  if (value.schemaVersion !== "staffing-requirement-policy-v1"
    || value.authority !== "operator_declared"
    || value.validationState !== "validated") return invalid("staffing_policy_not_validated");
  if (text(value.freshness) !== "current") return invalid("staffing_policy_stale", "stale");
  if (text(value.organizationId) !== organizationId) return invalid("staffing_policy_tenant_mismatch", "stale");
  const sourceId = text(value.sourceId);
  const revision = exactInteger(value.revision, { minimum: 1 });
  const declaredBy = text(value.declaredBy);
  const declaredAtISO = exactISO(value.declaredAtISO);
  const maximumGuestCount = value.maximumGuestCount === undefined
    ? MAX_GUEST_COUNT
    : exactInteger(value.maximumGuestCount, { minimum: 1, maximum: MAX_GUEST_COUNT });
  if (!sourceId || revision === null || !declaredBy || !declaredAtISO || maximumGuestCount === null) {
    return invalid("staffing_policy_provenance_incomplete");
  }
  if (!isRecord(value.roles)
    || Object.keys(value.roles).length !== ROLES.length
    || Object.keys(value.roles).some((role) => !ROLE_SET.has(role))) {
    return invalid("staffing_policy_roles_incomplete");
  }
  const roles = {};
  for (const role of ROLES) {
    roles[role] = normalizeRatioRule(value.roles[role]) || normalizeThresholdRule(value.roles[role]);
    if (!roles[role]) return invalid("staffing_policy_rule_invalid");
  }
  return {
    valid: true,
    sourceId,
    revision,
    declaredAtISO,
    maximumGuestCount,
    roles
  };
}

function evaluatePolicyRule(rule, guestCount) {
  if (rule.kind === "ratio") {
    return Math.max(rule.minimum, Math.ceil(guestCount / rule.guestsPerStaff));
  }
  let required = rule.thresholds[0].requiredCount;
  for (const threshold of rule.thresholds) {
    if (threshold.atGuestCount > guestCount) break;
    required = threshold.requiredCount;
  }
  return required;
}

function evaluatePolicy(policy, guestCount) {
  if (!policy.valid || guestCount > policy.maximumGuestCount) return null;
  const result = Object.fromEntries(
    ROLES.map((role) => [role, evaluatePolicyRule(policy.roles[role], guestCount)])
  );
  return Object.values(result).every((count) => Number.isSafeInteger(count) && count <= MAX_PROFILES)
    && Object.values(result).reduce((sum, count) => sum + count, 0) <= MAX_PROFILES
    ? result
    : null;
}

function sameRoleCounts(left, right) {
  return Boolean(left) && Boolean(right) && ROLES.every((role) => left[role] === right[role]);
}

function buildStaffingHeadroom({ currentGuestCount, currentRequirements, policy, peopleState }) {
  if (peopleState !== "available") {
    return unavailableHeadroom(
      "staffing_requirement_evidence_not_current",
      peopleState,
      currentGuestCount
    );
  }
  if (!policy.valid) return unavailableHeadroom(policy.reasonCode, policy.state, currentGuestCount);
  if (currentGuestCount > policy.maximumGuestCount) {
    return unavailableHeadroom("current_guest_count_outside_staffing_policy", "missing", currentGuestCount);
  }
  const policyCurrent = evaluatePolicy(policy, currentGuestCount);
  if (!policyCurrent) {
    return unavailableHeadroom("staffing_policy_result_out_of_bounds", "missing", currentGuestCount);
  }
  if (!sameRoleCounts(policyCurrent, currentRequirements)) {
    return unavailableHeadroom(
      "staffing_policy_current_requirement_mismatch",
      "missing",
      currentGuestCount
    );
  }
  for (let guestCount = currentGuestCount + 1; guestCount <= policy.maximumGuestCount; guestCount += 1) {
    const requirements = evaluatePolicy(policy, guestCount);
    if (!requirements) {
      return unavailableHeadroom("staffing_policy_result_out_of_bounds", "missing", currentGuestCount);
    }
    const affectedRoles = ROLES.flatMap((role) => (
      requirements[role] > policyCurrent[role]
        ? [{ role, from: policyCurrent[role], to: requirements[role] }]
        : []
    ));
    if (affectedRoles.length) {
      return {
        state: "available",
        evidenceState: "available",
        variable: "guest_count",
        currentGuestCount,
        safeThroughGuestCount: guestCount - 1,
        safeGuestIncrease: guestCount - 1 - currentGuestCount,
        guestsUntilBoundary: guestCount - currentGuestCount,
        nextBoundary: {
          atGuestCount: guestCount,
          kind: "staffing_requirement_increase",
          affectedRoles
        },
        reasonCodes: ["operator_declared_policy_boundary_found"],
        policy: {
          sourceId: policy.sourceId,
          revision: policy.revision,
          declaredAtISO: policy.declaredAtISO,
          actorRecorded: true
        }
      };
    }
  }
  return unavailableHeadroom(
    "no_staffing_boundary_within_bounded_policy",
    "missing",
    currentGuestCount
  );
}

function coverageProjection({
  guestCount,
  requirements,
  assigned,
  resilience,
  requirementSource,
  assignmentBasis
}) {
  if (!requirements || !assigned) {
    return {
      guestCount,
      requirementSource: requirementSource || null,
      assignmentBasis: assignmentBasis || null,
      coverageState: "unknown",
      byRole: Object.fromEntries(ROLES.map((role) => [role, {
        required: null,
        assigned: assigned?.[role] ?? null,
        gap: null,
        eligibleBackupCount: resilience?.eligibleBackupCountByRole?.[role] ?? null
      }])),
      totalRequired: null,
      totalAssigned: assigned ? Object.values(assigned).reduce((sum, count) => sum + count, 0) : null,
      totalGap: null
    };
  }
  const byRole = {};
  let totalRequired = 0;
  let totalAssigned = 0;
  let totalGap = 0;
  ROLES.forEach((role) => {
    const required = requirements[role];
    const assignedCount = assigned[role];
    const gap = Math.max(0, required - assignedCount);
    totalRequired += required;
    totalAssigned += assignedCount;
    totalGap += gap;
    byRole[role] = {
      required,
      assigned: assignedCount,
      gap,
      eligibleBackupCount: resilience?.eligibleBackupCountByRole?.[role] ?? null
    };
  });
  return {
    guestCount,
    requirementSource,
    assignmentBasis,
    coverageState: totalRequired === 0 ? "not_required" : totalGap === 0 ? "coverage_confirmed" : "attention",
    byRole,
    totalRequired,
    totalAssigned,
    totalGap
  };
}

function safePeopleSourceRevisions(people, policy, resilience, quoteRevisionId) {
  const source = people?.sourceRevisions || {};
  return {
    quoteRevisionId,
    authorityVersion: text(source.authorityVersion || people?.authorityVersion) || null,
    planRevision: exactInteger(source.planRevision ?? people?.snapshot?.planRevision, { minimum: 1 }),
    profilesRevisionId: text(source.profilesRevisionId) || null,
    scheduleConflictRevisionId: resilience?.sourceRevisionId || null,
    staffingPolicySourceId: policy.valid ? policy.sourceId : null,
    staffingPolicyRevision: policy.valid ? policy.revision : null,
    observedAtISO: exactISO(source.observedAtISO || people?.observedAtISO) || null
  };
}

function buildPeopleProjection({ input, identity, scenario }) {
  const people = isRecord(input.people) ? input.people : {};
  const reasonCodes = [];
  let state = evidenceState(people);
  const peopleQuoteRevisionId = text(
    people.quoteRevisionId
      || people.activeQuoteRevisionId
      || people.snapshot?.quoteRevisionId
      || people.sourceRevisions?.quoteRevisionId
  );
  const peopleOrganizationId = text(people.organizationId);
  const peopleQuoteId = text(people.quoteId);
  if (state === "available"
    && (peopleOrganizationId !== identity.organizationId || peopleQuoteId !== identity.quoteId)) {
    state = "stale";
    reasonCodes.push("people_scope_mismatch");
  }
  if (state === "available" && peopleQuoteRevisionId !== identity.quoteRevisionId) {
    state = "stale";
    reasonCodes.push("people_quote_revision_mismatch");
  }
  if (state === "available" && text(people.freshness || "current") !== "current") {
    state = "stale";
    reasonCodes.push("people_evidence_stale");
  }
  const requirements = requirementsFromPeople(people);
  const assignments = assignmentsFromPeople(people);
  if (state === "available" && (!requirements || !assignments)) {
    state = "missing";
    reasonCodes.push(!requirements ? "current_role_requirements_missing" : "current_assignments_missing");
  }
  const eventWindow = eventWindowFromPeople(people);
  const policy = normalizeStaffingPolicy(input.staffingPolicy, identity.organizationId);
  const assigned = assignments ? assignmentCounts(assignments) : null;
  const resilience = state === "available" && requirements && assignments
    ? buildResilience({
        people,
        requirements,
        assignments,
        organizationId: identity.organizationId,
        quoteId: identity.quoteId,
        quoteRevisionId: identity.quoteRevisionId,
        eventWindow
      })
    : {
        evidenceState: state,
        completeness: "partial",
        eligibleBackupCountByRole: Object.fromEntries(ROLES.map((role) => [role, null])),
        eligibleProfileCount: null,
        zeroBackupCriticalRoles: [],
        reasonCodes: ["current_people_evidence_unavailable"],
        boundary: "Backup evidence is unavailable until current People evidence is complete."
      };
  const staffingHeadroom = buildStaffingHeadroom({
    currentGuestCount: scenario.currentGuestCount,
    currentRequirements: requirements,
    policy,
    peopleState: state
  });
  const proposedRequirementsInput = input.proposedRequirementsByRole
    ?? people.proposedRequirementsByRole
    ?? people.proposed?.requirementsByRole;
  const suppliedRequirementSource = text(
    input.proposedRequirementsSource ?? people.proposedRequirementsSource
  );
  const explicitRequirementSource = suppliedRequirementSource
    || "proposed_commercial_and_canonical_counts";
  const explicitSourceValid = PROPOSED_REQUIREMENT_SOURCES.has(explicitRequirementSource);
  const explicitProposedRequirements = proposedRequirementsInput === undefined || !explicitSourceValid
    ? null
    : roleCounts(proposedRequirementsInput);
  const proposedRequirements = proposedRequirementsInput !== undefined
    ? explicitProposedRequirements
    : state === "available" && policy.valid
      ? evaluatePolicy(policy, scenario.proposedGuestCount)
      : scenario.proposedGuestCount === scenario.currentGuestCount ? requirements : null;
  const proposedRequirementSource = explicitProposedRequirements
    ? explicitRequirementSource
    : proposedRequirements && scenario.proposedGuestCount === scenario.currentGuestCount
      ? "commercial_quote_revision"
      : proposedRequirements ? "operator_declared_policy_projection" : null;
  if (proposedRequirementsInput !== undefined && !explicitSourceValid) {
    reasonCodes.push("proposed_role_requirement_source_invalid");
  } else if (proposedRequirementsInput !== undefined && !explicitProposedRequirements) {
    reasonCodes.push("proposed_role_requirements_invalid");
  } else if (state === "available" && policy.valid && !proposedRequirements) {
    reasonCodes.push("proposed_guest_count_outside_staffing_policy");
  }
  if (people.profilesTruncated === true) reasonCodes.push("staff_profiles_truncated");
  if (resilience.evidenceState !== "available") reasonCodes.push(...resilience.reasonCodes);
  if (staffingHeadroom.evidenceState !== "available") reasonCodes.push(...staffingHeadroom.reasonCodes);
  if (!reasonCodes.length) reasonCodes.push("people_evidence_current");
  const completeness = state === "available"
    && resilience.evidenceState === "available"
    && staffingHeadroom.evidenceState === "available"
    && proposedRequirements
    && people.profilesTruncated !== true
      ? "complete"
      : "partial";
  return {
    evidenceState: state,
    completeness,
    freshness: state === "available" ? "current" : state === "stale" ? "stale" : "unavailable",
    reasonCodes: uniqueSorted(reasonCodes),
    sourceRevisions: safePeopleSourceRevisions(
      people,
      policy,
      resilience,
      peopleQuoteRevisionId
    ),
    current: coverageProjection({
      guestCount: scenario.currentGuestCount,
      requirements: state === "available" ? requirements : null,
      assigned: state === "available" ? assigned : null,
      resilience,
      requirementSource: "commercial_quote_revision",
      assignmentBasis: "current_revision_operator_confirmed"
    }),
    proposed: coverageProjection({
      guestCount: scenario.proposedGuestCount,
      requirements: proposedRequirements,
      assigned: state === "available" ? assigned : null,
      resilience,
      requirementSource: proposedRequirementSource,
      assignmentBasis: "current_revision_operator_confirmed_comparison"
    }),
    staffingHeadroom,
    resilience,
    boundary: "Proposed requirements compare against current-revision operator-confirmed assignments only; neither explicit commercial-form counts nor policy-derived counts confirm proposed assignments or change the quote."
  };
}

function sanitizedShortages(value) {
  if (!Array.isArray(value) || value.length > 128) return null;
  const shortages = [];
  for (const entry of value) {
    const resourceId = text(entry?.resourceId || entry?.ingredientId);
    const resourceLabel = text(entry?.resourceLabel || entry?.ingredientName || entry?.name);
    const shortageQuantityMicros = exactInteger(
      entry?.shortageQuantityMicros ?? entry?.quantityMicros,
      { maximum: Number.MAX_SAFE_INTEGER }
    );
    if (!resourceId || !resourceLabel || shortageQuantityMicros === null) return null;
    shortages.push({
      resourceId,
      resourceLabel,
      shortageQuantityMicros,
      unitId: text(entry?.unitId || entry?.baseUnitId) || null
    });
  }
  return shortages.sort((left, right) => left.resourceId.localeCompare(right.resourceId));
}

function projectedCost(value) {
  if (!isRecord(value)) return { state: "unavailable", currency: null, amountMinor: null };
  const amountMinor = exactInteger(value.amountMinor ?? value.projectedCostMinor);
  const currency = text(value.currency).toUpperCase();
  return amountMinor === null || !/^[A-Z]{3}$/u.test(currency)
    ? { state: "unavailable", currency: null, amountMinor: null }
    : { state: "available", currency, amountMinor };
}

function invalidSupplyScenario(evidenceState, reasonCode) {
  return { valid: false, evidenceState, reasonCode, value: null };
}

function supplyScenarioProjection(value, fallbackGuestCount) {
  if (!isRecord(value)) {
    return invalidSupplyScenario("schema_drift", "supply_scenario_missing");
  }
  const guestCount = exactInteger(value?.guestCount, { minimum: 1, maximum: MAX_GUEST_COUNT });
  const shortages = sanitizedShortages(value?.shortages);
  const coverageState = text(value?.coverageState);
  if (guestCount === null || shortages === null
    || !["covered", "shortage", "unknown"].includes(coverageState)) {
    return invalidSupplyScenario("schema_drift", "supply_scenario_schema_invalid");
  }
  if (guestCount !== fallbackGuestCount) {
    return invalidSupplyScenario("stale", "supply_scenario_guest_count_mismatch");
  }
  const hasShortage = shortages.some((entry) => entry.shortageQuantityMicros > 0);
  if ((coverageState === "covered" && hasShortage)
    || (coverageState === "shortage" && !hasShortage)
    || (coverageState === "unknown" && hasShortage)) {
    return invalidSupplyScenario("contradictory", "supply_scenario_coverage_contradictory");
  }
  return {
    valid: true,
    evidenceState: "available",
    reasonCode: "",
    value: {
      guestCount,
      coverageState,
      shortageCount: shortages.filter((entry) => entry.shortageQuantityMicros > 0).length,
      shortages,
      projectedCost: projectedCost(value?.projectedCost)
    }
  };
}

function normalizeSupplyRevisionIdentity(value, { persisted = false, proposed = false } = {}) {
  if (!isRecord(value)) return null;
  const organizationId = text(value.organizationId);
  const quoteId = text(value.quoteId);
  const quoteRevisionId = text(value.quoteRevisionId);
  const eventRequirementRevisionId = text(value.eventRequirementRevisionId);
  const requirementRevision = persisted
    ? exactInteger(value.requirementRevision, { minimum: 1 })
    : null;
  const requirementDigest = text(value.requirementDigest);
  const projectionDigest = text(value.projectionDigest);
  const projectionVersion = text(value.projectionVersion);
  const sourceFingerprint = text(value.sourceFingerprint);
  const scenarioFingerprint = proposed ? text(value.scenarioFingerprint) : null;
  if (!organizationId || !quoteId || !quoteRevisionId || !eventRequirementRevisionId
    || (persisted && requirementRevision === null)
    || !SHA256_PATTERN.test(requirementDigest) || !SHA256_PATTERN.test(projectionDigest)
    || !projectionVersion || !sourceFingerprint || (proposed && !scenarioFingerprint)) {
    return null;
  }
  return {
    organizationId,
    quoteId,
    quoteRevisionId,
    eventRequirementRevisionId,
    ...(persisted ? { requirementRevision } : {}),
    requirementDigest,
    projectionDigest,
    projectionVersion,
    sourceFingerprint,
    ...(proposed ? { scenarioFingerprint } : {})
  };
}

function normalizeSupplySourceRevisions(supply, identity) {
  const source = isRecord(supply?.sourceRevisions) ? supply.sourceRevisions : null;
  if (!source) {
    return { valid: false, state: "schema_drift", reasonCode: "supply_source_revisions_missing", value: null };
  }
  const before = normalizeSupplyRevisionIdentity(source.before, { persisted: true });
  const proposedAfter = normalizeSupplyRevisionIdentity(source.proposedAfter, { proposed: true });
  const quoteRevisionId = text(source.quoteRevisionId);
  const scenarioFingerprint = text(source.scenarioFingerprint);
  if (!before || !proposedAfter || !quoteRevisionId || !scenarioFingerprint) {
    return { valid: false, state: "schema_drift", reasonCode: "supply_source_revisions_invalid", value: null };
  }
  if (before.organizationId !== proposedAfter.organizationId
    || before.quoteId !== proposedAfter.quoteId
    || before.quoteRevisionId !== proposedAfter.quoteRevisionId
    || before.quoteRevisionId !== quoteRevisionId
    || proposedAfter.scenarioFingerprint !== scenarioFingerprint) {
    return { valid: false, state: "contradictory", reasonCode: "supply_source_revisions_contradictory", value: null };
  }
  if (before.organizationId !== identity.organizationId
    || before.quoteId !== identity.quoteId
    || quoteRevisionId !== identity.quoteRevisionId
    || scenarioFingerprint !== identity.scenarioId) {
    return { valid: false, state: "stale", reasonCode: "supply_source_revision_scope_mismatch", value: null };
  }
  return {
    valid: true,
    state: "available",
    reasonCode: "",
    value: {
      quoteRevisionId,
      scenarioFingerprint,
      before,
      proposedAfter,
      observedAtISO: exactISO(source.observedAtISO || supply?.observedAtISO) || null
    }
  };
}

function normalizeInventoryHeadroom(
  value,
  { currentGuestCount, identity, supplySourceRevisions } = {}
) {
  if (!isRecord(value)) return unavailableHeadroom(
    "inventory_headroom_missing",
    "missing",
    currentGuestCount
  );
  const state = evidenceState(value);
  if (state !== "available") {
    return unavailableHeadroom(`inventory_headroom_${state}`, state, currentGuestCount);
  }
  if (text(value.freshness || "current") !== "current") {
    return unavailableHeadroom("inventory_headroom_stale", "stale", currentGuestCount);
  }
  const current = exactInteger(value.currentGuestCount, { minimum: 1, maximum: MAX_GUEST_COUNT });
  const safeThrough = exactInteger(value.safeThroughGuestCount, { minimum: 1, maximum: MAX_GUEST_COUNT });
  const atGuestCount = exactInteger(value.nextBoundary?.atGuestCount, { minimum: 1, maximum: MAX_GUEST_COUNT });
  const boundaryKind = text(value.nextBoundary?.kind);
  const resourceId = text(value.nextBoundary?.resourceId || value.nextBoundary?.ingredientId);
  const resourceLabel = text(value.nextBoundary?.resourceLabel || value.nextBoundary?.ingredientName);
  const sourceRevisionId = text(value.sourceRevisionId);
  const scopedOrganizationId = text(value.scope?.organizationId);
  const scopedQuoteId = text(value.scope?.quoteId);
  const scopedQuoteRevisionId = text(value.scope?.quoteRevisionId);
  const scopedScenarioId = text(value.scope?.scenarioId);
  const beforeProjectionDigest = text(value.basis?.before?.projectionDigest);
  const beforeSourceFingerprint = text(value.basis?.before?.sourceFingerprint);
  const proposedProjectionDigest = text(value.basis?.proposedAfter?.projectionDigest);
  const proposedSourceFingerprint = text(value.basis?.proposedAfter?.sourceFingerprint);
  const proposedScenarioFingerprint = text(value.basis?.proposedAfter?.scenarioFingerprint);
  if (!scopedOrganizationId || !scopedQuoteId || !scopedQuoteRevisionId || !scopedScenarioId
    || !sourceRevisionId || !SHA256_PATTERN.test(beforeProjectionDigest)
    || !beforeSourceFingerprint || !SHA256_PATTERN.test(proposedProjectionDigest)
    || !proposedSourceFingerprint || !proposedScenarioFingerprint
    || !supplySourceRevisions?.before || !supplySourceRevisions?.proposedAfter) {
    return unavailableHeadroom(
      "inventory_headroom_binding_schema_invalid",
      "schema_drift",
      currentGuestCount
    );
  }
  if (scopedOrganizationId !== identity.organizationId || scopedQuoteId !== identity.quoteId
    || scopedQuoteRevisionId !== identity.quoteRevisionId || scopedScenarioId !== identity.scenarioId) {
    return unavailableHeadroom("inventory_headroom_scope_mismatch", "stale", currentGuestCount);
  }
  if (beforeSourceFingerprint !== supplySourceRevisions.before.sourceFingerprint
    || beforeProjectionDigest !== supplySourceRevisions.before.projectionDigest
    || proposedSourceFingerprint !== supplySourceRevisions.proposedAfter.sourceFingerprint
    || proposedProjectionDigest !== supplySourceRevisions.proposedAfter.projectionDigest
    || proposedScenarioFingerprint !== supplySourceRevisions.proposedAfter.scenarioFingerprint
    || proposedScenarioFingerprint !== scopedScenarioId) {
    return unavailableHeadroom(
      "inventory_headroom_supply_binding_contradictory",
      "contradictory",
      currentGuestCount
    );
  }
  if (current !== currentGuestCount) {
    return unavailableHeadroom("inventory_headroom_guest_count_mismatch", "stale", currentGuestCount);
  }
  if (safeThrough === null || atGuestCount === null || !resourceId || !resourceLabel
    || boundaryKind !== "inventory_shortage") {
    return unavailableHeadroom("inventory_headroom_schema_invalid", "schema_drift", currentGuestCount);
  }
  if (safeThrough < currentGuestCount || atGuestCount !== safeThrough + 1) {
    return unavailableHeadroom("inventory_headroom_boundary_contradictory", "contradictory", currentGuestCount);
  }
  return {
    state: "available",
    evidenceState: "available",
    variable: "guest_count",
    currentGuestCount: current,
    safeThroughGuestCount: safeThrough,
    safeGuestIncrease: safeThrough - current,
    guestsUntilBoundary: atGuestCount - current,
    nextBoundary: {
      atGuestCount,
      kind: "inventory_shortage",
      resource: { resourceId, resourceLabel }
    },
    reasonCodes: ["revision_bound_inventory_boundary_available"],
    sourceRevisionId,
    sourceBinding: {
      scope: {
        organizationId: scopedOrganizationId,
        quoteId: scopedQuoteId,
        quoteRevisionId: scopedQuoteRevisionId,
        scenarioId: scopedScenarioId
      },
      basis: {
        before: {
          projectionDigest: beforeProjectionDigest,
          sourceFingerprint: beforeSourceFingerprint
        },
        proposedAfter: {
          projectionDigest: proposedProjectionDigest,
          sourceFingerprint: proposedSourceFingerprint,
          scenarioFingerprint: proposedScenarioFingerprint
        }
      }
    }
  };
}

function safeSupplySourceRevisions(sourceRevisions, inventoryHeadroom) {
  return {
    quoteRevisionId: sourceRevisions?.quoteRevisionId || null,
    scenarioFingerprint: sourceRevisions?.scenarioFingerprint || null,
    before: sourceRevisions?.before || null,
    proposedAfter: sourceRevisions?.proposedAfter || null,
    inventoryHeadroomSourceRevisionId: inventoryHeadroom?.sourceRevisionId || null,
    observedAtISO: sourceRevisions?.observedAtISO || null
  };
}

function buildSupplyProjection({ input, identity, scenario }) {
  const supply = isRecord(input.supply) ? input.supply : {};
  const reasonCodes = [];
  let state = evidenceState(supply);
  const quoteRevisionId = text(supply.quoteRevisionId || supply.sourceRevisions?.quoteRevisionId);
  const supplyOrganizationId = text(supply.organizationId);
  const supplyQuoteId = text(supply.quoteId);
  const sourceRevisionResult = normalizeSupplySourceRevisions(supply, identity);
  if (state === "available"
    && (supplyOrganizationId !== identity.organizationId || supplyQuoteId !== identity.quoteId)) {
    state = "stale";
    reasonCodes.push("supply_scope_mismatch");
  }
  if (state === "available" && quoteRevisionId !== identity.quoteRevisionId) {
    state = "stale";
    reasonCodes.push("supply_quote_revision_mismatch");
  }
  if (state === "available" && text(supply.scenarioId) !== identity.scenarioId) {
    state = "stale";
    reasonCodes.push("supply_scenario_mismatch");
  }
  if (state === "available" && text(supply.freshness || "current") !== "current") {
    state = "stale";
    reasonCodes.push("supply_evidence_stale");
  }
  if (state === "available" && !sourceRevisionResult.valid) {
    state = sourceRevisionResult.state;
    reasonCodes.push(sourceRevisionResult.reasonCode);
  }
  if (supply.truncated === true || text(supply.completeness || "complete") !== "complete") {
    if (state === "available") reasonCodes.push("supply_evidence_truncated");
  }
  const currentResult = state === "available"
    ? supplyScenarioProjection(supply.current, scenario.currentGuestCount)
    : null;
  const proposedResult = state === "available"
    ? supplyScenarioProjection(supply.proposed, scenario.proposedGuestCount)
    : null;
  if (state === "available" && (!currentResult.valid || !proposedResult.valid)) {
    const invalidResults = [currentResult, proposedResult].filter((result) => !result.valid);
    state = dominantEvidenceState(invalidResults.map((result) => result.evidenceState));
    reasonCodes.push(...invalidResults.map((result) => result.reasonCode));
  }
  const inventoryHeadroom = state === "available"
    ? normalizeInventoryHeadroom(supply.inventoryHeadroom, {
        currentGuestCount: scenario.currentGuestCount,
        identity,
        supplySourceRevisions: sourceRevisionResult.value
      })
    : unavailableHeadroom("supply_evidence_not_current", state, scenario.currentGuestCount);
  if (inventoryHeadroom.evidenceState !== "available") reasonCodes.push(...inventoryHeadroom.reasonCodes);
  if (!reasonCodes.length) reasonCodes.push("supply_evidence_current");
  const completeness = state === "available"
    && supply.truncated !== true
    && text(supply.completeness || "complete") === "complete"
    && inventoryHeadroom.evidenceState === "available"
      ? "complete"
      : "partial";
  const unavailableScenario = (guestCount) => ({
    guestCount,
    coverageState: "unknown",
    shortageCount: null,
    shortages: [],
    projectedCost: { state: "unavailable", currency: null, amountMinor: null }
  });
  const current = state === "available" ? currentResult.value : null;
  const proposed = state === "available" ? proposedResult.value : null;
  return {
    evidenceState: state,
    completeness,
    freshness: state === "available" ? "current" : state === "stale" ? "stale" : "unavailable",
    reasonCodes: uniqueSorted(reasonCodes),
    sourceRevisions: safeSupplySourceRevisions(sourceRevisionResult.value, inventoryHeadroom),
    current: current || unavailableScenario(scenario.currentGuestCount),
    proposed: proposed || unavailableScenario(scenario.proposedGuestCount),
    inventoryHeadroom,
    boundary: "Supply values are copied from an exact revision-bound read model; this projection never infers portions, demand, stock, allocation, or purchasing policy."
  };
}

const EVIDENCE_STATE_PRIORITY = Object.freeze([
  "contradictory",
  "schema_drift",
  "stale",
  "blocked_by_integration",
  "missing",
  "not_yet_available",
  "not_applicable"
]);

function dominantEvidenceState(states) {
  return EVIDENCE_STATE_PRIORITY.find((state) => states.includes(state)) || "missing";
}

function staffingLimitingResources(boundary) {
  return uniqueSorted((boundary?.affectedRoles || []).map((entry) => entry?.role)).map((role) => ({
    kind: "staffing_role",
    resourceId: `staffing-role:${role}`,
    resourceLabel: role.charAt(0).toUpperCase() + role.slice(1),
    role
  }));
}

function boundaryEntry(domain, boundary) {
  return { domain, boundary };
}

function buildFulfillmentHeadroom(people, supply) {
  const peopleHeadroom = people.staffingHeadroom;
  const supplyHeadroom = supply.inventoryHeadroom;
  if (peopleHeadroom.evidenceState !== "available" || supplyHeadroom.evidenceState !== "available") {
    return {
      state: "partial",
      evidenceState: dominantEvidenceState([
        peopleHeadroom.evidenceState,
        supplyHeadroom.evidenceState
      ].filter((state) => state !== "available")),
      variable: "guest_count",
      currentGuestCount: peopleHeadroom.currentGuestCount || supplyHeadroom.currentGuestCount,
      safeThroughGuestCount: null,
      safeGuestIncrease: null,
      guestsUntilBoundary: null,
      nextBoundary: null,
      nextBoundaries: [],
      limitingDomain: null,
      limitingResource: null,
      limitingResources: [],
      reasonCodes: uniqueSorted([
        peopleHeadroom.evidenceState !== "available" ? "people_headroom_unverified" : "",
        supplyHeadroom.evidenceState !== "available" ? "supply_headroom_unverified" : ""
      ])
    };
  }
  const peopleSafe = peopleHeadroom.safeGuestIncrease;
  const supplySafe = supplyHeadroom.safeGuestIncrease;
  const peopleResources = staffingLimitingResources(peopleHeadroom.nextBoundary);
  const peopleResource = peopleResources.length === 1 ? peopleResources[0] : null;
  const supplyResource = supplyHeadroom.nextBoundary.resource;
  if (peopleSafe === supplySafe) {
    return {
      state: "available",
      evidenceState: "available",
      variable: "guest_count",
      currentGuestCount: peopleHeadroom.currentGuestCount,
      safeThroughGuestCount: peopleHeadroom.safeThroughGuestCount,
      safeGuestIncrease: peopleSafe,
      guestsUntilBoundary: Math.min(
        peopleHeadroom.guestsUntilBoundary,
        supplyHeadroom.guestsUntilBoundary
      ),
      nextBoundary: null,
      nextBoundaries: [
        boundaryEntry("people", peopleHeadroom.nextBoundary),
        boundaryEntry("supply", supplyHeadroom.nextBoundary)
      ],
      limitingDomain: "multiple",
      limitingResource: null,
      limitingResources: [
        ...peopleResources.map((resource) => ({ domain: "people", resource })),
        { domain: "supply", resource: supplyResource }
      ].filter((entry) => entry.resource),
      reasonCodes: ["people_and_supply_boundaries_tied"]
    };
  }
  const limitingDomain = supplySafe < peopleSafe ? "supply" : "people";
  const headroom = limitingDomain === "supply" ? supplyHeadroom : peopleHeadroom;
  const limitingResource = limitingDomain === "supply" ? supplyResource : peopleResource;
  const limitingResources = limitingDomain === "supply"
    ? supplyResource ? [{ domain: "supply", resource: supplyResource }] : []
    : peopleResources.map((resource) => ({ domain: "people", resource }));
  return {
    state: "available",
    evidenceState: "available",
    variable: "guest_count",
    currentGuestCount: headroom.currentGuestCount,
    safeThroughGuestCount: headroom.safeThroughGuestCount,
    safeGuestIncrease: headroom.safeGuestIncrease,
    guestsUntilBoundary: headroom.guestsUntilBoundary,
    nextBoundary: headroom.nextBoundary,
    nextBoundaries: [boundaryEntry(limitingDomain, headroom.nextBoundary)],
    limitingDomain,
    limitingResource,
    limitingResources,
    reasonCodes: [`${limitingDomain}_is_first_valid_boundary`]
  };
}

const SEVERITY_ORDER = Object.freeze({ critical: 0, warning: 1, informational: 2 });

function buildConstraints(people, supply) {
  const constraints = [];
  const staffingBoundary = people.staffingHeadroom.nextBoundary;
  ROLES.forEach((role) => {
    const row = people.proposed.byRole[role];
    if ((row?.gap ?? 0) > 0) {
      const roleBoundary = staffingBoundary?.affectedRoles?.some((entry) => entry.role === role)
        ? staffingBoundary.atGuestCount
        : null;
      constraints.push({
        severity: "critical",
        domain: "people",
        kind: "coverage_gap",
        role,
        resource: null,
        quantity: row.gap,
        atGuestCount: roleBoundary
      });
    }
  });
  supply.proposed.shortages
    .filter((entry) => entry.shortageQuantityMicros > 0)
    .forEach((entry) => {
      const boundaryResource = supply.inventoryHeadroom.nextBoundary?.resource;
      constraints.push({
        severity: "critical",
        domain: "supply",
        kind: "inventory_shortage",
        role: null,
        resource: {
          resourceId: entry.resourceId,
          resourceLabel: entry.resourceLabel,
          unitId: entry.unitId
        },
        quantity: entry.shortageQuantityMicros,
        atGuestCount: boundaryResource?.resourceId === entry.resourceId
          ? supply.inventoryHeadroom.nextBoundary.atGuestCount
          : null
      });
    });
  if (people.resilience.evidenceState === "available") {
    people.resilience.zeroBackupCriticalRoles.forEach((role) => {
      constraints.push({
        severity: "warning",
        domain: "people",
        kind: "zero_eligible_backup",
        role,
        resource: null,
        quantity: 0,
        atGuestCount: null
      });
    });
  }
  if (!constraints.length) {
    if (people.staffingHeadroom.evidenceState === "available") {
      constraints.push({
        severity: "informational",
        domain: "people",
        kind: "next_staffing_boundary",
        role: people.staffingHeadroom.nextBoundary.affectedRoles[0]?.role || null,
        resource: null,
        quantity: null,
        atGuestCount: people.staffingHeadroom.nextBoundary.atGuestCount
      });
    }
    if (supply.inventoryHeadroom.evidenceState === "available") {
      constraints.push({
        severity: "informational",
        domain: "supply",
        kind: "next_inventory_boundary",
        role: null,
        resource: supply.inventoryHeadroom.nextBoundary.resource,
        quantity: null,
        atGuestCount: supply.inventoryHeadroom.nextBoundary.atGuestCount
      });
    }
  }
  return constraints
    .sort((left, right) => (
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || (left.atGuestCount ?? Number.MAX_SAFE_INTEGER) - (right.atGuestCount ?? Number.MAX_SAFE_INTEGER)
      || left.domain.localeCompare(right.domain)
      || left.kind.localeCompare(right.kind)
      || text(left.role || left.resource?.resourceId).localeCompare(text(right.role || right.resource?.resourceId))
    ))
    .map((constraint, index) => ({ rank: index + 1, ...constraint }));
}

/**
 * Composes bounded People and Supply evidence without adding authority or I/O.
 * Private staff fields may be present in input objects but are never projected.
 */
export function buildFulfillmentProjection(input = {}) {
  const identity = {
    organizationId: text(input.organizationId) || null,
    quoteId: text(input.quoteId) || null,
    quoteRevisionId: text(input.quoteRevisionId) || null,
    scenarioId: text(input.scenarioId) || null
  };
  const currentGuestCount = exactInteger(input.currentGuestCount, {
    minimum: 1,
    maximum: MAX_GUEST_COUNT
  });
  const proposedGuestCount = exactInteger(input.proposedGuestCount, {
    minimum: 1,
    maximum: MAX_GUEST_COUNT
  });
  const scenario = {
    currentGuestCount,
    proposedGuestCount,
    deltaGuestCount: currentGuestCount !== null && proposedGuestCount !== null
      ? proposedGuestCount - currentGuestCount
      : null
  };
  const identityComplete = Object.values(identity).every(Boolean);
  const scenarioComplete = currentGuestCount !== null && proposedGuestCount !== null;
  const safeInput = identityComplete && scenarioComplete ? input : { ...input, people: {}, supply: {} };
  const people = buildPeopleProjection({ input: safeInput, identity, scenario });
  const supply = buildSupplyProjection({ input: safeInput, identity, scenario });
  const fulfillmentHeadroom = buildFulfillmentHeadroom(people, supply);
  const constraints = buildConstraints(people, supply);
  const anyAvailable = people.evidenceState === "available" || supply.evidenceState === "available";
  const complete = identityComplete && scenarioComplete
    && people.evidenceState === "available"
    && supply.evidenceState === "available"
    && people.completeness === "complete"
    && supply.completeness === "complete";
  const projection = {
    schemaVersion: "fulfillmentProjection-v1",
    authority: "presentation_only_projection",
    identity,
    scenario,
    state: complete ? "complete" : anyAvailable ? "partial" : "unavailable",
    constraintState: constraints.some((constraint) => constraint.severity === "critical")
      ? "attention"
      : complete ? "clear" : "unknown",
    people,
    supply,
    fulfillmentHeadroom,
    limitingDomain: fulfillmentHeadroom.limitingDomain,
    limitingResource: fulfillmentHeadroom.limitingResource,
    limitingResources: fulfillmentHeadroom.limitingResources,
    nextBoundaries: fulfillmentHeadroom.nextBoundaries,
    limitingConstraint: constraints[0] || null,
    constraints,
    sourceRevisions: {
      people: people.sourceRevisions,
      supply: supply.sourceRevisions
    },
    provenance: {
      people: "operational_staffing_read_model",
      supply: "inventory_read_model",
      composition: "deterministic_client_projection"
    },
    boundary: PRESENTATION_BOUNDARY
  };
  return deepFreeze(projection);
}

export { ROLES as FULFILLMENT_STAFFING_ROLES };
