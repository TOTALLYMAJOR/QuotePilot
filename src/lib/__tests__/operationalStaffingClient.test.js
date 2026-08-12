import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  cloudFunctions: { id: "staffing-functions" }
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockState.httpsCallable
}));

vi.mock("../firebase", () => ({
  cloudFunctions: mockState.cloudFunctions,
  firebaseReady: true
}));

import {
  OPERATIONAL_STAFFING_CALLABLES,
  OPERATIONAL_STAFFING_CONTRACT,
  OPERATIONAL_STAFFING_OPERATIONS,
  applyOperationalStaffingPlan,
  buildLocalOperationalStaffingDraft,
  buildOperationalStaffingRequestId,
  configureOperationalStaffProfile,
  getOperationalStaffingSnapshot,
  isDefinitiveOperationalStaffingError,
  readPendingOperationalStaffingAttempt,
  resetDefinitiveOperationalStaffingAttempt
} from "../operationalStaffingClient";

const NOW = "2026-08-11T15:00:00.000Z";
const START = "2026-08-18T18:00:00.000Z";
const END = "2026-08-18T22:00:00.000Z";
const AVAILABILITY_START = "2026-08-18T00:00:00.000Z";
const AVAILABILITY_END = "2026-08-19T00:00:00.000Z";
const UTC_DATE = "2026-08-18";
const DIGEST = "a".repeat(64);
const PROFILE_RECEIPT_ID = `ospr_${"b".repeat(48)}`;
const PLAN_RECEIPT_ID = `osr_${"c".repeat(48)}`;
const FENCE_ID = `osf_${"d".repeat(48)}`;
const AVAILABILITY_BOUNDARY =
  "Availability windows are recorded by an authorized operator. They are not member acknowledgement, attendance, payroll, or readiness evidence.";
const ASSIGNMENT_BOUNDARY =
  "operator_confirmed records only an authorized operational assignment. It is not member acknowledgement, attendance, payroll, payment, booking, or event readiness.";
const COVERAGE_BOUNDARY =
  "coverage_confirmed means only that every quoted role count is matched by an operator-confirmed assignment for this exact quote revision and event window. It is not event readiness.";
const COMMERCIAL_BOUNDARY =
  "Quoted staffing counts are copied from the exact commercial quote revision for comparison only. This operational record does not edit or replace commercial quote authority.";

function scope(suffix = "one") {
  return {
    organizationId: `org-${suffix}`,
    quoteId: `quote-${suffix}`
  };
}

function availability(overrides = {}) {
  return {
    availabilityId: "availability-one",
    source: "operator_recorded",
    state: "available",
    startAtISO: AVAILABILITY_START,
    endAtISO: AVAILABILITY_END,
    ...overrides
  };
}

function profileProjection({
  organizationId = "org-one",
  staffId = "staff-one",
  revision = 1,
  ...overrides
} = {}) {
  return {
    schemaVersion: 1,
    authority: "server_authoritative",
    organizationId,
    staffId,
    displayName: "Avery Cook",
    active: true,
    capabilities: ["lead", "server"],
    revision,
    availabilityWindows: [availability()],
    availabilityBoundary: AVAILABILITY_BOUNDARY,
    ...overrides
  };
}

function candidateAssignment(overrides = {}) {
  return {
    assignmentId: "assignment-one",
    staffId: "staff-one",
    role: "lead",
    expectedStaffRevision: 1,
    state: "operator_confirmed",
    ...overrides
  };
}

function roleCounts(overrides = {}) {
  return {
    lead: 1,
    server: 0,
    chef: 0,
    bartender: 0,
    ...overrides
  };
}

function projectedAssignment(input = candidateAssignment(), overrides = {}) {
  return {
    assignmentId: input.assignmentId,
    staffId: input.staffId,
    displayName: "Avery Cook",
    role: input.role,
    staffRevision: input.expectedStaffRevision,
    state: "operator_confirmed",
    ...overrides
  };
}

function coverage(requirements, assignments, overrides = {}) {
  const byRole = Object.fromEntries(Object.keys(roleCounts()).map((role) => {
    const confirmed = assignments.filter((item) => item.role === role).length;
    return [role, {
      quotedCount: requirements[role],
      operatorConfirmedCount: confirmed,
      gap: Math.max(0, requirements[role] - confirmed)
    }];
  }));
  const totalQuotedCount = Object.values(requirements).reduce((sum, count) => sum + count, 0);
  const totalGap = Object.values(byRole).reduce((sum, item) => sum + item.gap, 0);
  return {
    state: totalQuotedCount === 0 ? "not_required" : totalGap === 0 ? "coverage_confirmed" : "attention",
    byRole,
    totalQuotedCount,
    totalOperatorConfirmedCount: assignments.length,
    totalGap,
    boundary: COVERAGE_BOUNDARY,
    ...overrides
  };
}

function planProjection({
  organizationId = "org-one",
  quoteId = "quote-one",
  quoteRevisionId = "version-14",
  planRevision = 1,
  requirements = roleCounts(),
  assignments = [projectedAssignment()],
  ...overrides
} = {}) {
  const planCoverage = coverage(requirements, assignments);
  return {
    schemaVersion: 1,
    authority: "server_authoritative",
    organizationId,
    quoteId,
    quoteRevisionId,
    planRevision,
    eventWindow: { startAtISO: START, endAtISO: END },
    state: planCoverage.state,
    requirements: {
      source: "commercial_quote_copy",
      byRole: requirements,
      boundary: COMMERCIAL_BOUNDARY
    },
    coverage: planCoverage,
    assignments,
    assignmentState: "operator_confirmed",
    assignmentBoundary: ASSIGNMENT_BOUNDARY,
    ...overrides
  };
}

function readFenceRef(overrides = {}) {
  return {
    fenceId: FENCE_ID,
    staffId: "staff-one",
    utcDate: UTC_DATE,
    revision: 0,
    ...overrides
  };
}

function snapshotResponse(input, overrides = {}) {
  const activeQuoteRevisionId = overrides.activeQuoteRevisionId || "version-14";
  const staffingSnapshot = Object.prototype.hasOwnProperty.call(overrides, "snapshot")
    ? overrides.snapshot
    : planProjection({
      organizationId: input.organizationId,
      quoteId: input.quoteId,
      quoteRevisionId: activeQuoteRevisionId
    });
  const profiles = overrides.profiles || [profileProjection({ organizationId: input.organizationId })];
  return {
    ok: true,
    storage: "firebase",
    authorityVersion: OPERATIONAL_STAFFING_CONTRACT.authorityVersion,
    organizationId: input.organizationId,
    quoteId: input.quoteId,
    activeQuoteRevisionId,
    canonicalEventWindow: { startAtISO: START, endAtISO: END },
    canonicalRequirements: roleCounts(),
    observedAtISO: NOW,
    state: "current",
    reasonCodes: ["current_quote_revision"],
    profiles,
    profilesTruncated: false,
    expectedScheduleFences: [readFenceRef()],
    scheduleFencesTruncated: false,
    snapshot: staffingSnapshot,
    ...overrides
  };
}

function profileRequest(suffix = "one", overrides = {}) {
  return {
    organizationId: `org-${suffix}`,
    staffId: `staff-${suffix}`,
    expectedRevision: 0,
    profile: {
      displayName: "  Avery   Cook ",
      active: true,
      capabilities: ["server", "lead"],
      availabilityWindows: [availability()]
    },
    requestId: `op_staff_profile_${suffix.padEnd(32, "a").slice(0, 32)}`,
    ...overrides
  };
}

function profileMutationResponse(input, overrides = {}) {
  const snapshot = profileProjection({
    organizationId: input.organizationId,
    staffId: input.staffId,
    revision: input.expectedRevision + 1,
    displayName: input.profile.displayName,
    active: input.profile.active,
    capabilities: input.profile.capabilities,
    availabilityWindows: input.profile.availabilityWindows
  });
  return {
    ok: true,
    storage: "firebase",
    organizationId: input.organizationId,
    staffId: input.staffId,
    idempotent: false,
    snapshot,
    receipt: {
      schemaVersion: OPERATIONAL_STAFFING_CONTRACT.profileReceiptSchemaVersion,
      authority: "server_authoritative",
      receiptType: "operational_staff_profile_command",
      receiptId: PROFILE_RECEIPT_ID,
      requestId: input.requestId,
      organizationId: input.organizationId,
      staffId: input.staffId,
      priorRevision: input.expectedRevision,
      resultRevision: input.expectedRevision + 1,
      requestDigest: DIGEST,
      commandDigest: DIGEST,
      evidenceDigest: DIGEST,
      resultProfileDigest: DIGEST,
      snapshot,
      recordedAtISO: NOW,
      recordedBy: {
        organizationId: input.organizationId,
        uid: "admin-one",
        role: "admin"
      },
      availabilityBoundary: AVAILABILITY_BOUNDARY,
      receiptDigest: DIGEST
    },
    ...overrides
  };
}

function planRequest(suffix = "one", overrides = {}) {
  return {
    ...scope(suffix),
    expectedQuoteRevisionId: "version-14",
    expectedPlanRevision: 0,
    eventWindow: { startAtISO: START, endAtISO: END },
    requirements: roleCounts(),
    assignments: [candidateAssignment({ staffId: `staff-${suffix}` })],
    expectedScheduleFences: [{ fenceId: FENCE_ID, revision: 0 }],
    requestId: `op_staff_plan_${suffix.padEnd(32, "e").slice(0, 32)}`,
    ...overrides
  };
}

function fenceAssignment(input, overrides = {}) {
  return {
    organizationId: input.organizationId,
    assignmentId: input.assignments[0].assignmentId,
    quoteId: input.quoteId,
    quoteRevisionId: input.expectedQuoteRevisionId,
    planRevision: input.expectedPlanRevision + 1,
    staffId: input.assignments[0].staffId,
    role: input.assignments[0].role,
    state: "operator_confirmed",
    eventWindow: input.eventWindow,
    ...overrides
  };
}

function planMutationResponse(input, overrides = {}) {
  const assignments = input.assignments.map((item) => projectedAssignment(item));
  const snapshot = planProjection({
    organizationId: input.organizationId,
    quoteId: input.quoteId,
    quoteRevisionId: input.expectedQuoteRevisionId,
    planRevision: input.expectedPlanRevision + 1,
    requirements: input.requirements,
    assignments
  });
  const fenceInput = {
    schemaVersion: 1,
    organizationId: input.organizationId,
    fenceId: FENCE_ID,
    staffId: input.assignments[0].staffId,
    utcDate: UTC_DATE,
    revision: 0,
    assignments: [],
    assignmentsTruncated: false
  };
  const nextFenceAssignment = fenceAssignment(input);
  return {
    ok: true,
    storage: "firebase",
    organizationId: input.organizationId,
    quoteId: input.quoteId,
    idempotent: false,
    snapshot,
    receipt: {
      schemaVersion: OPERATIONAL_STAFFING_CONTRACT.receiptSchemaVersion,
      authority: "server_authoritative",
      receiptType: "operational_staffing_command",
      receiptId: PLAN_RECEIPT_ID,
      requestId: input.requestId,
      organizationId: input.organizationId,
      quoteId: input.quoteId,
      quoteRevisionId: input.expectedQuoteRevisionId,
      priorPlanRevision: input.expectedPlanRevision,
      resultPlanRevision: input.expectedPlanRevision + 1,
      requestDigest: DIGEST,
      commandDigest: DIGEST,
      evidenceDigest: DIGEST,
      resultPlanDigest: DIGEST,
      assignmentState: "operator_confirmed",
      planState: snapshot.state,
      scheduleFenceInputs: [fenceInput],
      scheduleFenceOutputs: [{
        fenceId: FENCE_ID,
        organizationId: input.organizationId,
        staffId: input.assignments[0].staffId,
        utcDate: UTC_DATE,
        expectedRevision: 0,
        nextRevision: 1,
        nextProjection: {
          schemaVersion: 1,
          authority: "operational_staffing_schedule_fence",
          organizationId: input.organizationId,
          fenceId: FENCE_ID,
          staffId: input.assignments[0].staffId,
          utcDate: UTC_DATE,
          revision: 1,
          assignments: [nextFenceAssignment],
          assignmentsTruncated: false,
          updatedAtISO: NOW,
          lastCommandReceiptId: PLAN_RECEIPT_ID
        }
      }],
      snapshot,
      recordedAtISO: NOW,
      recordedBy: {
        organizationId: input.organizationId,
        uid: "sales-one",
        role: "sales"
      },
      assignmentBoundary: ASSIGNMENT_BOUNDARY,
      coverageBoundary: COVERAGE_BOUNDARY,
      commercialRequirementBoundary: COMMERCIAL_BOUNDARY,
      receiptDigest: DIGEST
    },
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.httpsCallable.mockReturnValue(mockState.callable);
});

describe("operational staffing callable boundary", () => {
  test("keeps the callable names and generated mutation IDs stable and bounded", () => {
    expect(OPERATIONAL_STAFFING_CALLABLES).toEqual({
      snapshot: "getOperationalStaffingSnapshot",
      configureProfile: "configureOperationalStaffProfile",
      applyPlan: "applyOperationalStaffingPlan"
    });
    expect(buildOperationalStaffingRequestId(OPERATIONAL_STAFFING_OPERATIONS.CONFIGURE_PROFILE))
      .toMatch(/^op_staff_profile_[a-f0-9]{32}$/u);
    expect(buildOperationalStaffingRequestId(OPERATIONAL_STAFFING_OPERATIONS.APPLY_PLAN))
      .toMatch(/^op_staff_plan_[a-f0-9]{32}$/u);
  });

  test("reads a strict current projection with canonical command inputs and fence metadata", async () => {
    const input = scope("read-current");
    mockState.callable.mockResolvedValue({ data: snapshotResponse(input) });

    const result = await getOperationalStaffingSnapshot(input);

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      OPERATIONAL_STAFFING_CALLABLES.snapshot
    );
    expect(mockState.callable).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({
      state: "current",
      activeQuoteRevisionId: "version-14",
      canonicalEventWindow: { startAtISO: START, endAtISO: END },
      canonicalRequirements: roleCounts(),
      profilesTruncated: false,
      scheduleFencesTruncated: false,
      expectedScheduleFences: [{
        fenceId: FENCE_ID,
        staffId: "staff-one",
        utcDate: UTC_DATE,
        revision: 0
      }],
      snapshot: { authority: "server_authoritative", assignmentState: "operator_confirmed" }
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.snapshot.assignments[0])).toBe(true);
  });

  test("enforces stale-over-partial freshness instead of trusting a server state label", async () => {
    const input = scope("stale");
    const stalePlan = planProjection({
      organizationId: input.organizationId,
      quoteId: input.quoteId,
      quoteRevisionId: "version-13"
    });
    mockState.callable.mockResolvedValue({
      data: snapshotResponse(input, {
        activeQuoteRevisionId: "version-14",
        snapshot: stalePlan,
        state: "current",
        profilesTruncated: true
      })
    });

    await expect(getOperationalStaffingSnapshot(input)).rejects.toMatchObject({
      code: "invalid-server-response"
    });

    mockState.callable.mockResolvedValue({
      data: snapshotResponse(input, {
        activeQuoteRevisionId: "version-14",
        snapshot: stalePlan,
        state: "stale",
        profilesTruncated: true
      })
    });
    await expect(getOperationalStaffingSnapshot(input)).resolves.toMatchObject({
      state: "stale",
      profilesTruncated: true
    });
  });

  test("classifies truncated empty evidence as partial and rejects extra read fields", async () => {
    const input = scope("partial");
    mockState.callable.mockResolvedValue({
      data: snapshotResponse(input, {
        state: "partial",
        snapshot: null,
        scheduleFencesTruncated: true,
        expectedScheduleFences: [],
        reasonCodes: ["schedule_fences_truncated"]
      })
    });
    await expect(getOperationalStaffingSnapshot(input)).resolves.toMatchObject({
      state: "partial",
      snapshot: null,
      scheduleFencesTruncated: true
    });

    mockState.callable.mockResolvedValue({
      data: { ...snapshotResponse(input), forgedCurrent: true }
    });
    await expect(getOperationalStaffingSnapshot(input)).rejects.toMatchObject({
      code: "invalid-server-response"
    });
  });

  test("configures a profile through the canonical nested command and profile receipt", async () => {
    const input = profileRequest("profile-ok");
    mockState.callable.mockImplementation(async (request) => ({
      data: profileMutationResponse(request)
    }));

    const result = await configureOperationalStaffProfile(input);
    const sent = mockState.callable.mock.calls[0][0];

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      OPERATIONAL_STAFFING_CALLABLES.configureProfile
    );
    expect(sent).toEqual({
      requestId: input.requestId,
      organizationId: input.organizationId,
      staffId: input.staffId,
      expectedRevision: 0,
      profile: {
        displayName: "Avery Cook",
        active: true,
        capabilities: ["lead", "server"],
        availabilityWindows: [availability()]
      }
    });
    expect(result).toMatchObject({
      idempotent: false,
      mutationMode: "submitting",
      staffId: input.staffId,
      snapshot: {
        authority: "server_authoritative",
        revision: 1,
        availabilityBoundary: AVAILABILITY_BOUNDARY
      },
      receipt: {
        schemaVersion: OPERATIONAL_STAFFING_CONTRACT.profileReceiptSchemaVersion,
        receiptType: "operational_staff_profile_command",
        resultRevision: 1
      }
    });
  });

  test("rejects obsolete and browser-forged profile command fields", async () => {
    await expect(configureOperationalStaffProfile({
      ...profileRequest("profile-old"),
      profileId: "legacy-profile"
    })).rejects.toMatchObject({ code: "invalid-argument" });

    await expect(configureOperationalStaffProfile(profileRequest("profile-window", {
      profile: {
        displayName: "Avery Cook",
        active: true,
        capabilities: ["lead"],
        availabilityWindows: [{ startISO: START, endISO: END, state: "available" }]
      }
    }))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mockState.callable).not.toHaveBeenCalled();
  });

  test("reconciles an ambiguous profile timeout using the identical request ID and payload", async () => {
    const input = profileRequest("profile-retry");
    mockState.callable
      .mockRejectedValueOnce({ code: "functions/deadline-exceeded", message: "private backend detail" })
      .mockImplementationOnce(async (request) => ({
        data: profileMutationResponse(request, { idempotent: true })
      }));

    await expect(configureOperationalStaffProfile(input)).rejects.toMatchObject({
      code: "deadline-exceeded",
      message: expect.not.stringContaining("private backend detail")
    });
    expect(readPendingOperationalStaffingAttempt({
      organizationId: input.organizationId,
      staffId: input.staffId
    })).toMatchObject({ requestId: input.requestId, definitive: false });

    await expect(configureOperationalStaffProfile(input)).resolves.toMatchObject({
      idempotent: true,
      mutationMode: "reconciliation"
    });
    expect(mockState.callable.mock.calls[1][0]).toEqual(mockState.callable.mock.calls[0][0]);
    expect(readPendingOperationalStaffingAttempt({
      organizationId: input.organizationId,
      staffId: input.staffId
    })).toBeNull();
  });

  test("blocks a changed command behind an unresolved attempt and permits explicit definitive reset", async () => {
    const input = profileRequest("profile-reset");
    mockState.callable.mockRejectedValueOnce({
      code: "functions/permission-denied",
      message: "sensitive policy detail"
    });
    await expect(configureOperationalStaffProfile(input)).rejects.toMatchObject({
      code: "permission-denied",
      message: expect.not.stringContaining("sensitive policy detail")
    });

    await expect(configureOperationalStaffProfile({
      ...input,
      profile: { ...input.profile, displayName: "Changed Name" }
    })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(resetDefinitiveOperationalStaffingAttempt({
      organizationId: input.organizationId,
      staffId: input.staffId,
      requestId: "wrong-request-id-value"
    })).toBe(false);
    expect(resetDefinitiveOperationalStaffingAttempt({
      organizationId: input.organizationId,
      staffId: input.staffId,
      requestId: input.requestId
    })).toBe(true);
  });

  test("applies the exact canonical plan and validates operator-confirmed fence receipts", async () => {
    const input = planRequest("apply-ok");
    mockState.callable.mockImplementation(async (request) => ({
      data: planMutationResponse(request)
    }));

    const result = await applyOperationalStaffingPlan(input);
    const sent = mockState.callable.mock.calls[0][0];

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      OPERATIONAL_STAFFING_CALLABLES.applyPlan
    );
    expect(sent).toEqual(input);
    expect(result).toMatchObject({
      mutationMode: "submitting",
      snapshot: {
        quoteRevisionId: input.expectedQuoteRevisionId,
        planRevision: 1,
        state: "coverage_confirmed",
        assignmentState: "operator_confirmed"
      },
      receipt: {
        receiptType: "operational_staffing_command",
        priorPlanRevision: 0,
        resultPlanRevision: 1,
        scheduleFenceInputs: [{
          assignmentsTruncated: false,
          assignments: []
        }],
        scheduleFenceOutputs: [{
          nextProjection: {
            assignmentsTruncated: false,
            assignments: [{ state: "operator_confirmed" }]
          }
        }]
      }
    });
  });

  test("rejects plural commercial roles, planned assignments, and incomplete fence inputs", async () => {
    await expect(applyOperationalStaffingPlan(planRequest("plural", {
      requirements: { servers: 1, chefs: 0, bartenders: 0 }
    }))).rejects.toMatchObject({ code: "invalid-argument" });

    await expect(applyOperationalStaffingPlan(planRequest("planned", {
      assignments: [candidateAssignment({ staffId: "staff-planned", state: "planned" })]
    }))).rejects.toMatchObject({ code: "invalid-argument" });

    await expect(applyOperationalStaffingPlan(planRequest("fence-meta", {
      expectedScheduleFences: [{
        fenceId: FENCE_ID,
        staffId: "browser-forged-extra",
        revision: 0
      }]
    }))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mockState.callable).not.toHaveBeenCalled();
  });

  test("fails closed on inconsistent coverage and incomplete next-fence projections", async () => {
    const coverageInput = planRequest("bad-coverage");
    mockState.callable.mockImplementationOnce(async (request) => {
      const response = planMutationResponse(request);
      response.snapshot.coverage.totalGap = 9;
      response.receipt.snapshot.coverage.totalGap = 9;
      return { data: response };
    });
    await expect(applyOperationalStaffingPlan(coverageInput)).rejects.toMatchObject({
      code: "invalid-server-response"
    });

    const fenceInput = planRequest("bad-fence");
    mockState.callable.mockImplementationOnce(async (request) => {
      const response = planMutationResponse(request);
      response.receipt.scheduleFenceOutputs[0].nextProjection.assignmentsTruncated = true;
      return { data: response };
    });
    await expect(applyOperationalStaffingPlan(fenceInput)).rejects.toMatchObject({
      code: "invalid-server-response"
    });
  });

  test("replays an ambiguous plan request identically and clears it only after a valid receipt", async () => {
    const input = planRequest("apply-retry");
    mockState.callable
      .mockRejectedValueOnce({ code: "functions/unavailable", message: "provider internals" })
      .mockImplementationOnce(async (request) => ({
        data: planMutationResponse(request, { idempotent: true })
      }));

    await expect(applyOperationalStaffingPlan(input)).rejects.toMatchObject({
      code: "unavailable",
      message: expect.not.stringContaining("provider internals")
    });
    await expect(applyOperationalStaffingPlan({
      ...input,
      requirements: roleCounts({ server: 1 })
    })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(applyOperationalStaffingPlan(input)).resolves.toMatchObject({
      idempotent: true,
      mutationMode: "reconciliation"
    });
    expect(mockState.callable.mock.calls[1][0]).toEqual(mockState.callable.mock.calls[0][0]);
  });

  test("keeps local fallback explicitly non-authoritative", () => {
    const input = planRequest("local");
    const result = buildLocalOperationalStaffingDraft(input);

    expect(result).toEqual({
      schemaVersion: OPERATIONAL_STAFFING_CONTRACT.localDraftSchemaVersion,
      authority: "local_draft",
      organizationId: input.organizationId,
      quoteId: input.quoteId,
      expectedQuoteRevisionId: input.expectedQuoteRevisionId,
      expectedPlanRevision: input.expectedPlanRevision,
      eventWindow: input.eventWindow,
      requirements: input.requirements,
      assignments: input.assignments,
      expectedScheduleFences: input.expectedScheduleFences
    });
    expect(result).not.toHaveProperty("receipt");
    expect(result).not.toHaveProperty("coverage");
    expect(Object.isFrozen(result.assignments[0])).toBe(true);
  });

  test("classifies only safe final failures as definitive", () => {
    expect(isDefinitiveOperationalStaffingError({ code: "functions/permission-denied" })).toBe(true);
    expect(isDefinitiveOperationalStaffingError({ code: "functions/aborted" })).toBe(true);
    expect(isDefinitiveOperationalStaffingError({ code: "functions/unavailable" })).toBe(false);
    expect(isDefinitiveOperationalStaffingError({ code: "functions/deadline-exceeded" })).toBe(false);
  });
});
