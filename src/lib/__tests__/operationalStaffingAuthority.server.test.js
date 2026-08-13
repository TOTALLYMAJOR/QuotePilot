import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  ASSIGNMENT_EVIDENCE_BOUNDARY,
  AVAILABILITY_EVIDENCE_BOUNDARY,
  COMMERCIAL_REQUIREMENT_BOUNDARY,
  COVERAGE_EVIDENCE_BOUNDARY,
  OPERATIONAL_ASSIGNMENT_STATE,
  OPERATIONAL_STAFFING_AUTHORITY,
  OPERATIONAL_STAFF_PROFILE_RECEIPT_VERSION,
  OPERATIONAL_STAFFING_RECEIPT_VERSION,
  OperationalStaffingAuthorityError,
  buildOperationalStaffProfileReceiptId,
  buildOperationalStaffingReceiptId,
  buildOperationalStaffingScheduleFenceId,
  deriveOperationalStaffingScheduleFenceRefs,
  planOperationalStaffProfileCommand,
  planOperationalStaffingCommand,
  projectOperationalStaffProfile,
  projectOperationalStaffingSnapshot
} = require("../../../functions/operationalStaffingAuthority.js");

const ORGANIZATION_ID = "org-staffing-one";
const QUOTE_ID = "quote-staffing-one";
const QUOTE_REVISION_ID = "v0007";
const EVENT_WINDOW = Object.freeze({
  startAtISO: "2026-09-12T20:00:00.000Z",
  endAtISO: "2026-09-13T03:00:00.000Z"
});
const SERVER_TIME_ISO = "2026-08-11T18:30:00.000Z";
const ACTOR = Object.freeze({
  organizationId: ORGANIZATION_ID,
  uid: "staff-admin-one",
  role: "admin"
});

function availability({
  availabilityId = "availability-full-event",
  state = "available",
  startAtISO = "2026-09-12T19:00:00.000Z",
  endAtISO = "2026-09-13T04:00:00.000Z"
} = {}) {
  return {
    availabilityId,
    source: "operator_recorded",
    state,
    startAtISO,
    endAtISO
  };
}

function staffProfile({
  organizationId = ORGANIZATION_ID,
  staffId = "staff-alex-one",
  displayName = "Alex R.",
  active = true,
  capabilities = ["server"],
  revision = 4,
  availabilityWindows = [availability()],
  availabilityTruncated = false,
  ...extra
} = {}) {
  return {
    organizationId,
    staffId,
    displayName,
    active,
    capabilities,
    revision,
    availabilityWindows,
    availabilityTruncated,
    ...extra
  };
}

function assignment({
  assignmentId = "assignment-server-one",
  staffId = "staff-alex-one",
  role = "server",
  expectedStaffRevision = 4,
  state = OPERATIONAL_ASSIGNMENT_STATE
} = {}) {
  return {
    assignmentId,
    staffId,
    role,
    expectedStaffRevision,
    state
  };
}

function baseRequest(overrides = {}) {
  return {
    requestId: "staffing-command-request-0001",
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    expectedQuoteRevisionId: QUOTE_REVISION_ID,
    expectedPlanRevision: 0,
    eventWindow: { ...EVENT_WINDOW },
    requirements: {
      lead: 0,
      server: 1,
      chef: 0,
      bartender: 0
    },
    assignments: [assignment()],
    expectedScheduleFences: [],
    ...overrides
  };
}

function buildFenceEvidence(request, currentPlan = null, revision = 0) {
  const refs = deriveOperationalStaffingScheduleFenceRefs({
    organizationId: request.organizationId,
    eventWindow: request.eventWindow,
    assignments: request.assignments,
    currentPlan
  });
  return {
    expectedScheduleFences: refs.map(({ fenceId }) => ({ fenceId, revision })),
    scheduleFences: refs.map((ref) => ({
      ...ref,
      revision,
      assignments: [],
      assignmentsTruncated: false
    }))
  };
}

function commandFixture({
  request: requestOverrides = {},
  currentPlan = null,
  staffProfiles = [staffProfile()],
  overlappingAssignments = [],
  actor = ACTOR,
  activeQuoteRevisionId = QUOTE_REVISION_ID,
  fenceRevision = 0,
  evidenceBounds = {},
  serverTimeISO = SERVER_TIME_ISO,
  existingReceipt = null
} = {}) {
  const request = baseRequest(requestOverrides);
  const fences = buildFenceEvidence(request, currentPlan, fenceRevision);
  for (const existing of overlappingAssignments) {
    for (const fence of fences.scheduleFences) {
      const sameStaff = fence.staffId === existing.staffId;
      const fenceDate = fence.utcDate;
      const existingDates = [];
      const start = new Date(existing.eventWindow.startAtISO);
      const end = new Date(Date.parse(existing.eventWindow.endAtISO) - 1);
      for (
        let day = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
        day <= Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
        day += 86_400_000
      ) {
        existingDates.push(new Date(day).toISOString().slice(0, 10));
      }
      if (sameStaff && existingDates.includes(fenceDate)) {
        fence.assignments.push(clone(existing));
      }
    }
  }
  request.expectedScheduleFences = fences.expectedScheduleFences;
  return {
    request,
    activeQuoteRevisionId,
    canonicalEventWindow: { ...EVENT_WINDOW },
    canonicalRequirements: clone(request.requirements),
    currentPlan,
    staffProfiles,
    overlappingAssignments,
    scheduleFences: fences.scheduleFences,
    evidenceBounds,
    actor,
    serverTimeISO,
    existingReceipt
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function profileCommandRequest(overrides = {}) {
  return {
    requestId: "profile-command-request-0001",
    organizationId: ORGANIZATION_ID,
    staffId: "staff-alex-one",
    expectedRevision: 0,
    profile: {
      displayName: "Alex R.",
      active: true,
      capabilities: ["server", "lead"],
      availabilityWindows: [availability()]
    },
    ...overrides
  };
}

function currentProfile(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    staffId: "staff-alex-one",
    displayName: "Alex R.",
    active: true,
    capabilities: ["lead", "server"],
    revision: 1,
    availabilityWindows: [availability()],
    ...overrides
  };
}

function profileCommandFixture({
  request = profileCommandRequest(),
  currentProfile: existingProfile = null,
  actor = ACTOR,
  serverTimeISO = SERVER_TIME_ISO,
  existingReceipt = null
} = {}) {
  return {
    request,
    currentProfile: existingProfile,
    actor,
    serverTimeISO,
    existingReceipt
  };
}

function expectAuthorityError(run, code, message) {
  try {
    run();
    throw new Error("Expected OperationalStaffingAuthorityError.");
  } catch (error) {
    expect(error).toBeInstanceOf(OperationalStaffingAuthorityError);
    expect(error.code).toBe(code);
    if (message) expect(error.message).toMatch(message);
  }
}

describe("operational staffing scope and bounded profile contracts", () => {
  test("rejects cross-organization actor, staff, plan, assignment, and schedule-fence evidence", () => {
    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({
        actor: { ...ACTOR, organizationId: "org-other" }
      })),
      "permission-denied",
      /actor.*outside/i
    );

    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({
        staffProfiles: [staffProfile({ organizationId: "org-other" })]
      })),
      "permission-denied",
      /profile.*outside/i
    );

    const foreignCurrentPlan = {
      organizationId: "org-other",
      quoteId: QUOTE_ID,
      quoteRevisionId: QUOTE_REVISION_ID,
      revision: 1,
      eventWindow: EVENT_WINDOW,
      assignments: []
    };
    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({
        request: { expectedPlanRevision: 1 },
        currentPlan: foreignCurrentPlan
      })),
      "permission-denied",
      /plan.*outside/i
    );

    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({
        overlappingAssignments: [{
          organizationId: "org-other",
          assignmentId: "foreign-assignment-one",
          quoteId: "foreign-quote-one",
          quoteRevisionId: "v0001",
          planRevision: 1,
          staffId: "staff-alex-one",
          role: "server",
          state: OPERATIONAL_ASSIGNMENT_STATE,
          eventWindow: EVENT_WINDOW
        }]
      })),
      "permission-denied",
      /overlap.*outside/i
    );

    const fixture = commandFixture();
    fixture.scheduleFences[0].organizationId = "org-other";
    expectAuthorityError(
      () => planOperationalStaffingCommand(fixture),
      "permission-denied",
      /fence.*outside/i
    );
  });

  test("accepts stable opaque profile identity and rejects unsafe display or hidden availability source", () => {
    const result = planOperationalStaffingCommand(commandFixture({
      staffProfiles: [staffProfile({
        staffId: "stf_83eB1a8pQ",
        displayName: "  Alex   Rivera  ",
        capabilities: ["server", "lead"]
      })],
      request: {
        assignments: [assignment({ staffId: "stf_83eB1a8pQ" })]
      }
    }));
    expect(result.snapshot.assignments[0]).toMatchObject({
      staffId: "stf_83eB1a8pQ",
      displayName: "Alex Rivera",
      role: "server"
    });

    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({
        staffProfiles: [staffProfile({ displayName: "alex@example.test" })]
      })),
      "invalid-argument",
      /displayName/i
    );
    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({
        staffProfiles: [staffProfile({
          availabilityWindows: [{ ...availability(), source: "member_confirmed" }]
        })]
      })),
      "invalid-argument",
      /operator-recorded/i
    );
  });

  test.each([
    ["inactive staff", staffProfile({ active: false }), /inactive/i],
    ["wrong capability", staffProfile({ capabilities: ["chef"] }), /capability/i]
  ])("fails closed for %s", (_label, profile, message) => {
    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({ staffProfiles: [profile] })),
      "failed-precondition",
      message
    );
  });

  test("rejects unsupported assignment states and never turns recommendation text into authority", () => {
    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({
        request: {
          assignments: [{
            ...assignment(),
            state: "recommended",
            recommendation: "Suggested by Pilot"
          }]
        }
      })),
      "invalid-argument",
      /only.*operator_confirmed/i
    );
  });
});

describe("operational staffing exact revisions and complete evidence", () => {
  test.each([
    [
      "active quote revision",
      () => commandFixture({ activeQuoteRevisionId: "v0008" }),
      "aborted",
      /quote revision changed/i
    ],
    [
      "plan revision",
      () => commandFixture({
        request: { expectedPlanRevision: 2 },
        currentPlan: {
          organizationId: ORGANIZATION_ID,
          quoteId: QUOTE_ID,
          quoteRevisionId: QUOTE_REVISION_ID,
          revision: 3,
          eventWindow: EVENT_WINDOW,
          assignments: []
        }
      }),
      "aborted",
      /plan revision changed/i
    ],
    [
      "staff profile revision",
      () => commandFixture({
        staffProfiles: [staffProfile({ revision: 5 })]
      }),
      "aborted",
      /profile revision changed/i
    ],
    [
      "schedule fence revision",
      () => {
        const fixture = commandFixture({ fenceRevision: 2 });
        fixture.request.expectedScheduleFences[0].revision = 1;
        return fixture;
      },
      "aborted",
      /fence revision changed/i
    ]
  ])("rejects a stale %s", (_label, makeFixture, code, message) => {
    expectAuthorityError(
      () => planOperationalStaffingCommand(makeFixture()),
      code,
      message
    );
  });

  test("binds the requested staffing window to the trusted canonical quote window", () => {
    const fixture = commandFixture();
    fixture.canonicalEventWindow = {
      startAtISO: "2026-09-12T21:00:00.000Z",
      endAtISO: EVENT_WINDOW.endAtISO
    };
    expectAuthorityError(
      () => planOperationalStaffingCommand(fixture),
      "aborted",
      /does not match.*canonical/i
    );
  });

  test.each([
    ["understated", { lead: 0, server: 0, chef: 0, bartender: 0 }],
    ["overstated", { lead: 0, server: 2, chef: 0, bartender: 0 }]
  ])("rejects %s client staffing requirements against canonical quote counts", (_label, requested) => {
    const fixture = commandFixture({ request: { requirements: requested } });
    fixture.canonicalRequirements = { lead: 0, server: 1, chef: 0, bartender: 0 };
    expectAuthorityError(
      () => planOperationalStaffingCommand(fixture),
      "aborted",
      /requirements do not match.*commercial/i
    );
  });

  test.each([
    ["staff profile set", { staffProfilesTruncated: true }],
    ["overlap set", { overlapAssignmentsTruncated: true }],
    ["schedule fence set", { scheduleFencesTruncated: true }]
  ])("fails closed when the %s is truncated", (_label, evidenceBounds) => {
    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({ evidenceBounds })),
      "resource-exhausted",
      /truncated/i
    );
  });

  test("requires the exact deterministic fence set and emits compare-and-set outputs", () => {
    const fixture = commandFixture({ fenceRevision: 7 });
    const expectedFenceIds = fixture.scheduleFences.map((item) => item.fenceId);
    const result = planOperationalStaffingCommand(fixture);

    expect(result.scheduleFenceInputs.map((item) => item.fenceId)).toEqual(expectedFenceIds);
    expect(result.scheduleFenceOutputs).toHaveLength(expectedFenceIds.length);
    expect(result.scheduleFenceOutputs[0]).toMatchObject({
      expectedRevision: 7,
      nextRevision: 8,
      nextProjection: {
        authority: "operational_staffing_schedule_fence",
        revision: 8,
        lastCommandReceiptId: result.receipt.receiptId
      }
    });

    const missing = commandFixture();
    missing.scheduleFences.pop();
    expectAuthorityError(
      () => planOperationalStaffingCommand(missing),
      "failed-precondition",
      /fence evidence is incomplete/i
    );
  });

  test("fails closed before a schedule fence revision exceeds the public bound", () => {
    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({ fenceRevision: 1_000_000_000 })),
      "resource-exhausted",
      /fence exhausted its bounded revision range/i
    );
  });

  test("uses half-open intervals so an assignment ending exactly at event start does not overlap", () => {
    const touching = {
      organizationId: ORGANIZATION_ID,
      assignmentId: "prior-assignment-one",
      quoteId: "quote-prior-one",
      quoteRevisionId: "v0002",
      planRevision: 2,
      staffId: "staff-alex-one",
      role: "server",
      state: OPERATIONAL_ASSIGNMENT_STATE,
      eventWindow: {
        startAtISO: "2026-09-12T16:00:00.000Z",
        endAtISO: EVENT_WINDOW.startAtISO
      }
    };
    const touchingResult = planOperationalStaffingCommand(commandFixture({
      overlappingAssignments: [touching]
    }));
    expect(touchingResult.kind).toBe("apply");
    expect(JSON.stringify({
      inputs: touchingResult.receipt.scheduleFenceInputs,
      outputs: touchingResult.receipt.scheduleFenceOutputs
    })).not.toMatch(/startMs|endMs/);
    expect(touchingResult.receipt.scheduleFenceInputs.some((fence) => (
      fence.assignments.some((item) => item.assignmentId === touching.assignmentId)
    ))).toBe(true);

    const overlapping = clone(touching);
    overlapping.eventWindow.endAtISO = "2026-09-12T20:00:00.001Z";
    expectAuthorityError(
      () => planOperationalStaffingCommand(commandFixture({
        overlappingAssignments: [overlapping]
      })),
      "failed-precondition",
      /overlapping/i
    );
  });

  test("derives overlap truth from complete cross-date fence assignment projections", () => {
    const conflict = {
      organizationId: ORGANIZATION_ID,
      assignmentId: "overnight-conflict-one",
      quoteId: "quote-other-overnight",
      quoteRevisionId: "v0004",
      planRevision: 4,
      staffId: "staff-alex-one",
      role: "server",
      state: OPERATIONAL_ASSIGNMENT_STATE,
      eventWindow: {
        startAtISO: "2026-09-13T02:30:00.000Z",
        endAtISO: "2026-09-13T05:00:00.000Z"
      }
    };
    const fixture = commandFixture({ overlappingAssignments: [conflict] });
    expect(fixture.scheduleFences.map((fence) => fence.utcDate).sort()).toEqual([
      "2026-09-12",
      "2026-09-13"
    ]);
    expect(fixture.scheduleFences.find((fence) => fence.utcDate === "2026-09-12")
      .assignments).toHaveLength(0);
    expect(fixture.scheduleFences.find((fence) => fence.utcDate === "2026-09-13")
      .assignments).toHaveLength(1);
    expectAuthorityError(
      () => planOperationalStaffingCommand(fixture),
      "failed-precondition",
      /overlapping/i
    );
  });

  test("fails closed when caller overlap evidence differs from fence-derived truth", () => {
    const conflict = {
      organizationId: ORGANIZATION_ID,
      assignmentId: "hidden-conflict-one",
      quoteId: "quote-other-hidden",
      quoteRevisionId: "v0001",
      planRevision: 1,
      staffId: "staff-alex-one",
      role: "server",
      state: OPERATIONAL_ASSIGNMENT_STATE,
      eventWindow: EVENT_WINDOW
    };
    const fixture = commandFixture();
    fixture.scheduleFences.forEach((fence) => {
      fence.assignments = [clone(conflict)];
    });
    expectAuthorityError(
      () => planOperationalStaffingCommand(fixture),
      "failed-precondition",
      /does not match.*fence/i
    );
  });
});

describe("operational staffing availability and coverage semantics", () => {
  test("requires complete available coverage, including adjacent windows", () => {
    const profile = staffProfile({
      availabilityWindows: [
        availability({
          availabilityId: "availability-first-half",
          startAtISO: EVENT_WINDOW.startAtISO,
          endAtISO: "2026-09-12T23:00:00.000Z"
        }),
        availability({
          availabilityId: "availability-second-half",
          startAtISO: "2026-09-12T23:00:00.000Z",
          endAtISO: EVENT_WINDOW.endAtISO
        })
      ]
    });
    expect(planOperationalStaffingCommand(commandFixture({
      staffProfiles: [profile]
    })).kind).toBe("apply");
  });

  test.each([
    [
      "unknown gap",
      [availability({
        endAtISO: "2026-09-13T02:59:59.999Z"
      })],
      "availability_unknown"
    ],
    [
      "unavailable evidence",
      [availability({ state: "unavailable" })],
      "availability_unavailable"
    ],
    [
      "conflicting evidence",
      [
        availability(),
        availability({
          availabilityId: "availability-conflict",
          state: "unavailable",
          startAtISO: "2026-09-12T22:00:00.000Z",
          endAtISO: "2026-09-12T23:00:00.000Z"
        })
      ],
      "availability_conflict"
    ]
  ])("fails closed on %s", (_label, availabilityWindows, reasonCode) => {
    try {
      planOperationalStaffingCommand(commandFixture({
        staffProfiles: [staffProfile({ availabilityWindows })]
      }));
      throw new Error("Expected availability failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(OperationalStaffingAuthorityError);
      expect(error.code).toBe("failed-precondition");
      expect(error.details.reasonCode).toBe(reasonCode);
    }
  });

  test("derives role gaps without blending commercial requirements into operational assignments", () => {
    const result = planOperationalStaffingCommand(commandFixture({
      request: {
        requirements: {
          lead: 0,
          server: 2,
          chef: 1,
          bartender: 0
        }
      }
    }));

    expect(result.nextPlan.state).toBe("attention");
    expect(result.nextPlan.requirements).toMatchObject({
      source: "commercial_quote_copy",
      quoteRevisionId: QUOTE_REVISION_ID,
      byRole: { server: 2, chef: 1 }
    });
    expect(result.nextPlan.coverage).toMatchObject({
      state: "attention",
      totalQuotedCount: 3,
      totalOperatorConfirmedCount: 1,
      totalGap: 2,
      byRole: {
        server: { quotedCount: 2, operatorConfirmedCount: 1, gap: 1 },
        chef: { quotedCount: 1, operatorConfirmedCount: 0, gap: 1 }
      }
    });
    expect(result.nextPlan.assignments).toHaveLength(1);
  });

  test("uses coverage_confirmed only when every quoted role count is covered", () => {
    const serverOne = staffProfile();
    const serverTwo = staffProfile({
      staffId: "staff-jordan-two",
      displayName: "Jordan P.",
      revision: 2,
      availabilityWindows: [availability({ availabilityId: "availability-jordan" })]
    });
    const chef = staffProfile({
      staffId: "staff-sam-chef",
      displayName: "Sam K.",
      revision: 8,
      capabilities: ["chef"],
      availabilityWindows: [availability({ availabilityId: "availability-sam" })]
    });
    const result = planOperationalStaffingCommand(commandFixture({
      request: {
        requirements: { lead: 0, server: 2, chef: 1, bartender: 0 },
        assignments: [
          assignment(),
          assignment({
            assignmentId: "assignment-server-two",
            staffId: "staff-jordan-two",
            expectedStaffRevision: 2
          }),
          assignment({
            assignmentId: "assignment-chef-one",
            staffId: "staff-sam-chef",
            role: "chef",
            expectedStaffRevision: 8
          })
        ]
      },
      staffProfiles: [serverOne, serverTwo, chef]
    }));

    expect(result.nextPlan.state).toBe("coverage_confirmed");
    expect(result.snapshot.state).toBe("coverage_confirmed");
    expect(result.snapshot.coverage.totalGap).toBe(0);
    expect(result.receipt.planState).toBe("coverage_confirmed");
    expect(result.receipt.coverageBoundary).toBe(COVERAGE_EVIDENCE_BOUNDARY);
    expect(result.receipt.coverageBoundary).toMatch(/not event readiness/i);
  });

  test("zero quoted roles is not mislabeled coverage_confirmed", () => {
    const result = planOperationalStaffingCommand(commandFixture({
      request: {
        requirements: { lead: 0, server: 0, chef: 0, bartender: 0 },
        assignments: []
      },
      staffProfiles: []
    }));
    expect(result.nextPlan.state).toBe("not_required");
  });
});

describe("operational staffing immutable receipt and safe projection", () => {
  test("exports deterministic receipt identities for exact pre-transaction reads", () => {
    const planRequest = baseRequest();
    const profileRequest = profileCommandRequest();

    expect(buildOperationalStaffingReceiptId(planRequest)).toBe(
      buildOperationalStaffingReceiptId({ ...planRequest })
    );
    expect(buildOperationalStaffingReceiptId(planRequest)).toMatch(/^osr_[a-f0-9]{48}$/u);
    expect(buildOperationalStaffProfileReceiptId(profileRequest)).toBe(
      buildOperationalStaffProfileReceiptId({ ...profileRequest })
    );
    expect(buildOperationalStaffProfileReceiptId(profileRequest)).toMatch(/^ospr_[a-f0-9]{48}$/u);
  });

  test("builds one deterministic immutable command receipt and reconciles an exact replay", () => {
    const fixture = commandFixture();
    const first = planOperationalStaffingCommand(fixture);
    const repeated = planOperationalStaffingCommand({
      ...commandFixture(),
      existingReceipt: first.receipt
    });

    expect(first.receipt).toMatchObject({
      schemaVersion: OPERATIONAL_STAFFING_RECEIPT_VERSION,
      authority: OPERATIONAL_STAFFING_AUTHORITY,
      receiptType: "operational_staffing_command",
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      quoteRevisionId: QUOTE_REVISION_ID,
      priorPlanRevision: 0,
      resultPlanRevision: 1,
      assignmentState: OPERATIONAL_ASSIGNMENT_STATE,
      recordedAtISO: SERVER_TIME_ISO,
      recordedBy: ACTOR
    });
    expect(first.receipt.receiptId).toMatch(/^osr_[a-f0-9]{48}$/u);
    expect(first.receipt.receiptDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(first.receipt)).toBe(true);
    expect(repeated).toMatchObject({
      kind: "reconcile",
      idempotent: true,
      nextPlan: null,
      receipt: first.receipt
    });
    expect(repeated.receipt).toEqual(first.receipt);
  });

  test("reconciles a lost-response retry after the plan, quote, staff, and fences advanced", () => {
    const firstFixture = commandFixture();
    const first = planOperationalStaffingCommand(firstFixture);
    const advancedPlan = {
      ...clone(first.nextPlan),
      revision: 1
    };
    const advancedFixture = commandFixture({ existingReceipt: first.receipt });
    advancedFixture.activeQuoteRevisionId = "v0008";
    advancedFixture.currentPlan = advancedPlan;
    advancedFixture.staffProfiles = [staffProfile({ revision: 5 })];
    advancedFixture.scheduleFences.forEach((fence) => {
      fence.revision = 1;
      fence.assignments = first.receipt.scheduleFenceOutputs
        .find((output) => output.fenceId === fence.fenceId)?.nextProjection.assignments || [];
    });

    expect(planOperationalStaffingCommand(advancedFixture)).toMatchObject({
      kind: "reconcile",
      idempotent: true,
      nextPlan: null,
      scheduleFenceInputs: [],
      scheduleFenceOutputs: [],
      receipt: first.receipt
    });
  });

  test.each([
    [
      "canonical request payload",
      (fixture) => { fixture.request.requirements.server = 2; }
    ],
    [
      "actor",
      (fixture) => { fixture.actor = { ...ACTOR, uid: "staff-sales-two", role: "sales" }; }
    ],
    [
      "staff evidence",
      (fixture) => { fixture.staffProfiles[0].availabilityWindows[0].startAtISO = "2026-09-12T18:00:00.000Z"; }
    ]
  ])("rejects request-ID reuse with different %s", (_label, mutate) => {
    const first = planOperationalStaffingCommand(commandFixture());
    const replayFixture = commandFixture({ existingReceipt: first.receipt });
    mutate(replayFixture);
    if (_label === "staff evidence") {
      expect(planOperationalStaffingCommand(replayFixture)).toMatchObject({
        kind: "reconcile",
        idempotent: true
      });
    } else {
      expectAuthorityError(
        () => planOperationalStaffingCommand(replayFixture),
        "already-exists",
        /already bound.*different/i
      );
    }
  });

  test("rejects a tampered immutable receipt before replay", () => {
    const first = planOperationalStaffingCommand(commandFixture());
    const tampered = clone(first.receipt);
    tampered.planState = "attention";
    expectAuthorityError(
      () => planOperationalStaffingCommand({
        ...commandFixture(),
        existingReceipt: tampered
      }),
      "data-loss",
      /integrity/i
    );
  });

  test("exports a bounded safe snapshot with no PII, availability detail, or readiness claim", () => {
    const result = planOperationalStaffingCommand(commandFixture({
      staffProfiles: [staffProfile({
        phone: "+1-555-0100",
        email: "alex@example.test",
        hourlyRateMinor: 4500,
        privateNotes: "Sensitive note"
      })]
    }));
    const snapshot = projectOperationalStaffingSnapshot(result.nextPlan);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot).toEqual(result.snapshot);
    expect(snapshot).toMatchObject({
      authority: OPERATIONAL_STAFFING_AUTHORITY,
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      quoteRevisionId: QUOTE_REVISION_ID,
      planRevision: 1,
      assignmentState: OPERATIONAL_ASSIGNMENT_STATE,
      requirements: {
        source: "commercial_quote_copy",
        boundary: COMMERCIAL_REQUIREMENT_BOUNDARY
      },
      assignmentBoundary: ASSIGNMENT_EVIDENCE_BOUNDARY
    });
    expect(snapshot.assignments[0]).toEqual({
      assignmentId: "assignment-server-one",
      staffId: "staff-alex-one",
      displayName: "Alex R.",
      role: "server",
      staffRevision: 4,
      state: OPERATIONAL_ASSIGNMENT_STATE
    });
    expect(serialized).not.toContain("alex@example.test");
    expect(serialized).not.toContain("555-0100");
    expect(serialized).not.toContain("4500");
    expect(serialized).not.toContain("Sensitive note");
    expect(serialized).not.toContain("availabilityId");
    expect(Object.keys(snapshot.assignments[0])).not.toContain("payroll");
    expect(snapshot.assignmentBoundary).toMatch(
      /not member acknowledgement, attendance, payroll, payment, booking, or event readiness/i
    );
  });

  test("derives stable per-staff UTC-day schedule fence identities", () => {
    const fenceId = buildOperationalStaffingScheduleFenceId({
      organizationId: ORGANIZATION_ID,
      staffId: "staff-alex-one",
      utcDate: "2026-09-12"
    });
    expect(fenceId).toMatch(/^osf_[a-f0-9]{48}$/u);
    expect(buildOperationalStaffingScheduleFenceId({
      organizationId: ORGANIZATION_ID,
      staffId: "staff-alex-one",
      utcDate: "2026-09-12"
    })).toBe(fenceId);
    expect(buildOperationalStaffingScheduleFenceId({
      organizationId: ORGANIZATION_ID,
      staffId: "staff-alex-one",
      utcDate: "2026-09-13"
    })).not.toBe(fenceId);
  });
});

describe("authoritative operational staff profile configuration", () => {
  test("creates a bounded safe profile only under same-tenant admin authority", () => {
    const result = planOperationalStaffProfileCommand(profileCommandFixture());

    expect(result).toMatchObject({
      kind: "apply",
      idempotent: false,
      nextProfile: {
        organizationId: ORGANIZATION_ID,
        staffId: "staff-alex-one",
        displayName: "Alex R.",
        active: true,
        capabilities: ["lead", "server"],
        revision: 1,
        updatedAtISO: SERVER_TIME_ISO,
        updatedBy: ACTOR
      },
      snapshot: {
        authority: OPERATIONAL_STAFFING_AUTHORITY,
        organizationId: ORGANIZATION_ID,
        staffId: "staff-alex-one",
        revision: 1,
        availabilityBoundary: AVAILABILITY_EVIDENCE_BOUNDARY
      },
      receipt: {
        schemaVersion: OPERATIONAL_STAFF_PROFILE_RECEIPT_VERSION,
        receiptType: "operational_staff_profile_command",
        priorRevision: 0,
        resultRevision: 1,
        recordedBy: ACTOR
      }
    });
    expect(result.receipt.receiptId).toMatch(/^ospr_[a-f0-9]{48}$/u);
    expect(result.receipt.receiptDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.snapshot.availabilityWindows).toEqual([availability()]);
    expect(result.snapshot.availabilityBoundary).toMatch(/authorized operator/i);
  });

  test("rejects sales actors and cross-tenant actor or current-profile scope", () => {
    expectAuthorityError(
      () => planOperationalStaffProfileCommand(profileCommandFixture({
        actor: { ...ACTOR, role: "sales" }
      })),
      "permission-denied",
      /admin authority/i
    );
    expectAuthorityError(
      () => planOperationalStaffProfileCommand(profileCommandFixture({
        actor: { ...ACTOR, organizationId: "org-other" }
      })),
      "permission-denied",
      /actor.*outside/i
    );
    expectAuthorityError(
      () => planOperationalStaffProfileCommand(profileCommandFixture({
        request: profileCommandRequest({ expectedRevision: 1 }),
        currentProfile: currentProfile({ organizationId: "org-other" })
      })),
      "permission-denied",
      /profile.*outside/i
    );
  });

  test("requires the exact current profile revision", () => {
    expectAuthorityError(
      () => planOperationalStaffProfileCommand(profileCommandFixture({
        request: profileCommandRequest({ expectedRevision: 1 }),
        currentProfile: currentProfile({ revision: 2 })
      })),
      "aborted",
      /profile revision changed/i
    );

    const updated = planOperationalStaffProfileCommand(profileCommandFixture({
      request: profileCommandRequest({
        expectedRevision: 1,
        profile: {
          displayName: "Alex Rivera",
          active: false,
          capabilities: ["lead", "server"],
          availabilityWindows: []
        }
      }),
      currentProfile: currentProfile()
    }));
    expect(updated.nextProfile).toMatchObject({
      displayName: "Alex Rivera",
      active: false,
      revision: 2
    });
  });

  test("rejects overlapping availability windows while accepting adjacent half-open windows", () => {
    const overlapping = profileCommandRequest();
    overlapping.profile.availabilityWindows = [
      availability({
        availabilityId: "availability-one",
        startAtISO: "2026-09-12T18:00:00.000Z",
        endAtISO: "2026-09-12T22:00:00.000Z"
      }),
      availability({
        availabilityId: "availability-two",
        state: "unavailable",
        startAtISO: "2026-09-12T21:59:59.999Z",
        endAtISO: "2026-09-13T04:00:00.000Z"
      })
    ];
    expectAuthorityError(
      () => planOperationalStaffProfileCommand(profileCommandFixture({ request: overlapping })),
      "failed-precondition",
      /must not overlap/i
    );

    const adjacent = clone(overlapping);
    adjacent.profile.availabilityWindows[1].startAtISO =
      adjacent.profile.availabilityWindows[0].endAtISO;
    expect(planOperationalStaffProfileCommand(profileCommandFixture({
      request: adjacent
    })).kind).toBe("apply");
  });

  test("rejects HR, contact, payroll, and arbitrary fields rather than silently persisting them", () => {
    for (const field of ["email", "phone", "hourlyRateMinor", "privateNotes"]) {
      const request = profileCommandRequest();
      request.profile[field] = field === "hourlyRateMinor" ? 4500 : "private";
      try {
        planOperationalStaffProfileCommand(profileCommandFixture({ request }));
        throw new Error("Expected unsupported profile field failure.");
      } catch (error) {
        expect(error).toBeInstanceOf(OperationalStaffingAuthorityError);
        expect(error.code).toBe("invalid-argument");
        expect(error.details.fields).toContain(field);
      }
    }

    const availabilityField = profileCommandRequest();
    availabilityField.profile.availabilityWindows[0].memberAcknowledged = true;
    expectAuthorityError(
      () => planOperationalStaffProfileCommand(profileCommandFixture({
        request: availabilityField
      })),
      "invalid-argument",
      /unsupported fields/i
    );
  });

  test("returns a data-minimized profile projection", () => {
    const snapshot = projectOperationalStaffProfile(currentProfile({
      email: "alex@example.test",
      phone: "+1-555-0100",
      hourlyRateMinor: 4500,
      privateNotes: "Sensitive"
    }));
    const serialized = JSON.stringify(snapshot);

    expect(snapshot).toEqual({
      schemaVersion: 1,
      authority: OPERATIONAL_STAFFING_AUTHORITY,
      organizationId: ORGANIZATION_ID,
      staffId: "staff-alex-one",
      displayName: "Alex R.",
      active: true,
      capabilities: ["lead", "server"],
      revision: 1,
      availabilityWindows: [availability()],
      availabilityBoundary: AVAILABILITY_EVIDENCE_BOUNDARY
    });
    expect(serialized).not.toContain("alex@example.test");
    expect(serialized).not.toContain("555-0100");
    expect(serialized).not.toContain("4500");
    expect(serialized).not.toContain("Sensitive");
  });

  test("reconciles an exact replay and rejects request-id payload, actor, or evidence collision", () => {
    const firstFixture = profileCommandFixture();
    const first = planOperationalStaffProfileCommand(firstFixture);
    const replay = planOperationalStaffProfileCommand(profileCommandFixture({
      existingReceipt: first.receipt
    }));
    expect(replay).toMatchObject({
      kind: "reconcile",
      idempotent: true,
      nextProfile: null,
      receipt: first.receipt
    });

    const changedPayload = profileCommandRequest();
    changedPayload.profile.active = false;
    expectAuthorityError(
      () => planOperationalStaffProfileCommand(profileCommandFixture({
        request: changedPayload,
        existingReceipt: first.receipt
      })),
      "already-exists",
      /already bound.*different/i
    );

    expectAuthorityError(
      () => planOperationalStaffProfileCommand(profileCommandFixture({
        actor: { ...ACTOR, uid: "staff-admin-two" },
        existingReceipt: first.receipt
      })),
      "already-exists",
      /already bound.*different/i
    );

    const advancedAfterCommit = currentProfile({ revision: 1 });
    expect(planOperationalStaffProfileCommand(profileCommandFixture({
      currentProfile: advancedAfterCommit,
      existingReceipt: first.receipt
    }))).toMatchObject({ kind: "reconcile", idempotent: true });
  });
});
