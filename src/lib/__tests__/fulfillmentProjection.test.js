import { describe, expect, test } from "vitest";
import { buildFulfillmentProjection } from "../fulfillmentProjection";

const EVENT_WINDOW = Object.freeze({
  startAtISO: "2026-10-10T22:00:00.000Z",
  endAtISO: "2026-10-11T02:00:00.000Z"
});
const BEFORE_REQUIREMENT_DIGEST = "a".repeat(64);
const BEFORE_PROJECTION_DIGEST = "b".repeat(64);
const PROPOSED_REQUIREMENT_DIGEST = "c".repeat(64);
const PROPOSED_PROJECTION_DIGEST = "d".repeat(64);
const BEFORE_SOURCE_FINGERPRINT = '{"requirementRevision":4,"stockRevision":20}';
const PROPOSED_SOURCE_FINGERPRINT = '{"scenario":"proposed","stockRevision":20}';

function assignments(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    assignmentId: `assignment-${index + 1}`,
    staffId: `assigned-${index + 1}`,
    role: "server",
    state: "operator_confirmed"
  }));
}

function profile(staffId, overrides = {}) {
  return {
    organizationId: "org-1",
    staffId,
    active: true,
    capabilities: ["server"],
    revision: 1,
    availabilityWindows: [{
      availabilityId: `availability-${staffId}`,
      source: "operator_recorded",
      state: "available",
      startAtISO: "2026-10-10T21:00:00.000Z",
      endAtISO: "2026-10-11T03:00:00.000Z"
    }],
    ...overrides
  };
}

function peopleEvidence(overrides = {}) {
  const assigned = assignments();
  const profiles = [
    ...assigned.map((entry) => profile(entry.staffId)),
    profile("backup-1"),
    profile("backup-2"),
    profile("backup-3")
  ];
  return {
    state: "current",
    freshness: "current",
    organizationId: "org-1",
    quoteId: "quote-1",
    quoteRevisionId: "quote-version-14",
    authorityVersion: "operational-staffing-v1",
    observedAtISO: "2026-10-01T15:00:00.000Z",
    canonicalEventWindow: EVENT_WINDOW,
    canonicalRequirements: { lead: 0, server: 6, chef: 0, bartender: 0 },
    snapshot: {
      quoteRevisionId: "quote-version-14",
      planRevision: 4,
      eventWindow: EVENT_WINDOW,
      assignments: assigned
    },
    profiles,
    profilesTruncated: false,
    scheduleConflictEvidence: {
      state: "current",
      freshness: "current",
      completeness: "complete",
      truncated: false,
      organizationId: "org-1",
      quoteId: "quote-1",
      quoteRevisionId: "quote-version-14",
      eventWindow: EVENT_WINDOW,
      sourceRevisionId: "schedule-fences-9",
      entries: [
        { staffId: "backup-1", state: "clear" },
        { staffId: "backup-2", state: "clear" },
        { staffId: "backup-3", state: "clear" }
      ]
    },
    sourceRevisions: {
      quoteRevisionId: "quote-version-14",
      planRevision: 4,
      profilesRevisionId: "profile-set-7",
      observedAtISO: "2026-10-01T15:00:00.000Z"
    },
    ...overrides
  };
}

function thresholdPolicy(overrides = {}) {
  const fixed = (requiredCount) => ({
    kind: "thresholds",
    thresholds: [{ atGuestCount: 1, requiredCount }]
  });
  return {
    schemaVersion: "staffing-requirement-policy-v1",
    authority: "operator_declared",
    validationState: "validated",
    freshness: "current",
    organizationId: "org-1",
    sourceId: "staffing-policy-3",
    revision: 3,
    declaredBy: "operator-42",
    declaredAtISO: "2026-09-30T14:00:00.000Z",
    maximumGuestCount: 300,
    roles: {
      lead: fixed(0),
      server: {
        kind: "thresholds",
        thresholds: [
          { atGuestCount: 1, requiredCount: 6 },
          { atGuestCount: 168, requiredCount: 7 },
          { atGuestCount: 225, requiredCount: 8 }
        ]
      },
      chef: fixed(0),
      bartender: fixed(0)
    },
    ...overrides
  };
}

function supplySourceRevisions(scenarioId = "scenario-175") {
  return {
    quoteRevisionId: "quote-version-14",
    scenarioFingerprint: scenarioId,
    before: {
      organizationId: "org-1",
      quoteId: "quote-1",
      quoteRevisionId: "quote-version-14",
      eventRequirementRevisionId: "event-requirement-4",
      requirementRevision: 4,
      requirementDigest: BEFORE_REQUIREMENT_DIGEST,
      projectionDigest: BEFORE_PROJECTION_DIGEST,
      projectionVersion: "event-requirement-projection-v1",
      sourceFingerprint: BEFORE_SOURCE_FINGERPRINT
    },
    proposedAfter: {
      organizationId: "org-1",
      quoteId: "quote-1",
      quoteRevisionId: "quote-version-14",
      eventRequirementRevisionId: "event-requirement-preview-5",
      requirementDigest: PROPOSED_REQUIREMENT_DIGEST,
      projectionDigest: PROPOSED_PROJECTION_DIGEST,
      projectionVersion: "event-requirement-projection-v1",
      sourceFingerprint: PROPOSED_SOURCE_FINGERPRINT,
      scenarioFingerprint: scenarioId
    },
    observedAtISO: "2026-10-01T15:01:00.000Z"
  };
}

function inventoryHeadroomEvidence(scenarioId = "scenario-175", safeThroughGuestCount = 137) {
  return {
    state: "current",
    freshness: "current",
    sourceRevisionId: "inventory-headroom-2",
    scope: {
      organizationId: "org-1",
      quoteId: "quote-1",
      quoteRevisionId: "quote-version-14",
      scenarioId
    },
    basis: {
      before: {
        projectionDigest: BEFORE_PROJECTION_DIGEST,
        sourceFingerprint: BEFORE_SOURCE_FINGERPRINT
      },
      proposedAfter: {
        projectionDigest: PROPOSED_PROJECTION_DIGEST,
        sourceFingerprint: PROPOSED_SOURCE_FINGERPRINT,
        scenarioFingerprint: scenarioId
      }
    },
    currentGuestCount: 125,
    safeThroughGuestCount,
    nextBoundary: {
      atGuestCount: safeThroughGuestCount + 1,
      kind: "inventory_shortage",
      resourceId: "chicken-breast",
      resourceLabel: "Chicken"
    }
  };
}

function supplyEvidence(overrides = {}) {
  const scenarioId = overrides.scenarioId ?? "scenario-175";
  const sourceRevisions = Object.hasOwn(overrides, "sourceRevisions")
    ? overrides.sourceRevisions
    : supplySourceRevisions(scenarioId);
  const inventoryHeadroom = Object.hasOwn(overrides, "inventoryHeadroom")
    ? overrides.inventoryHeadroom
    : inventoryHeadroomEvidence(scenarioId);
  return {
    state: "current",
    freshness: "current",
    completeness: "complete",
    organizationId: "org-1",
    quoteId: "quote-1",
    quoteRevisionId: "quote-version-14",
    scenarioId,
    observedAtISO: "2026-10-01T15:01:00.000Z",
    sourceRevisions,
    current: {
      guestCount: 125,
      coverageState: "covered",
      shortages: [],
      projectedCost: { currency: "USD", amountMinor: 80_000 }
    },
    proposed: {
      guestCount: 175,
      coverageState: "shortage",
      shortages: [{
        resourceId: "chicken-breast",
        resourceLabel: "Chicken",
        shortageQuantityMicros: 5_000_000,
        unitId: "lb"
      }],
      projectedCost: { currency: "USD", amountMinor: 112_000 }
    },
    inventoryHeadroom,
    ...overrides
  };
}

function readyInput(overrides = {}) {
  return {
    organizationId: "org-1",
    quoteId: "quote-1",
    quoteRevisionId: "quote-version-14",
    scenarioId: "scenario-175",
    currentGuestCount: 125,
    proposedGuestCount: 175,
    proposedRequirementsByRole: { lead: 0, server: 7, chef: 0, bartender: 0 },
    proposedRequirementsSource: "proposed_commercial_and_canonical_counts",
    people: peopleEvidence(),
    staffingPolicy: thresholdPolicy(),
    supply: supplyEvidence(),
    ...overrides
  };
}

function expectDeepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  Reflect.ownKeys(value).forEach((key) => expectDeepFrozen(value[key], seen));
}

describe("buildFulfillmentProjection", () => {
  test("preserves current coverage but withholds proposed coverage when event timing changed", () => {
    const projection = buildFulfillmentProjection(readyInput({
      proposedEventWindowState: "changed_unchecked"
    }));

    expect(projection.people).toMatchObject({
      evidenceState: "available",
      completeness: "partial",
      current: {
        coverageState: "coverage_confirmed",
        totalRequired: 6,
        totalAssigned: 6,
        totalGap: 0
      },
      proposed: {
        coverageState: "unknown",
        totalRequired: 7,
        totalAssigned: null,
        totalGap: null,
        assignmentBasis: "proposed_event_window_not_evaluated",
        byRole: { server: { required: 7, assigned: null, gap: null } }
      },
      reasonCodes: expect.arrayContaining(["proposed_event_window_not_evaluated"])
    });
    expect(projection.people.boundary).toContain("proposed timing changed");
    expect(projection.state).toBe("partial");
  });

  test("composes exact 125 to 175 People and Supply evidence with the first valid boundary", () => {
    const projection = buildFulfillmentProjection(readyInput());

    expect(projection).toMatchObject({
      schemaVersion: "fulfillmentProjection-v1",
      authority: "presentation_only_projection",
      state: "complete",
      constraintState: "attention",
      scenario: {
        currentGuestCount: 125,
        proposedGuestCount: 175,
        deltaGuestCount: 50
      },
      people: {
        evidenceState: "available",
        completeness: "complete",
        current: {
          coverageState: "coverage_confirmed",
          totalRequired: 6,
          totalAssigned: 6,
          totalGap: 0,
          byRole: { server: { required: 6, assigned: 6, gap: 0, eligibleBackupCount: 3 } }
        },
        proposed: {
          requirementSource: "proposed_commercial_and_canonical_counts",
          assignmentBasis: "current_revision_operator_confirmed_comparison",
          coverageState: "attention",
          totalRequired: 7,
          totalAssigned: 6,
          totalGap: 1,
          byRole: { server: { required: 7, assigned: 6, gap: 1, eligibleBackupCount: 3 } }
        },
        staffingHeadroom: {
          state: "available",
          safeThroughGuestCount: 167,
          safeGuestIncrease: 42,
          guestsUntilBoundary: 43,
          nextBoundary: {
            atGuestCount: 168,
            affectedRoles: [{ role: "server", from: 6, to: 7 }]
          }
        },
        resilience: {
          evidenceState: "available",
          eligibleBackupCountByRole: { server: 3 },
          eligibleProfileCount: 3,
          zeroBackupCriticalRoles: []
        }
      },
      supply: {
        evidenceState: "available",
        current: { coverageState: "covered", shortageCount: 0 },
        proposed: {
          coverageState: "shortage",
          shortageCount: 1,
          shortages: [{
            resourceId: "chicken-breast",
            resourceLabel: "Chicken",
            shortageQuantityMicros: 5_000_000,
            unitId: "lb"
          }]
        },
        inventoryHeadroom: {
          safeThroughGuestCount: 137,
          safeGuestIncrease: 12,
          guestsUntilBoundary: 13,
          nextBoundary: { atGuestCount: 138 }
        }
      },
      fulfillmentHeadroom: {
        state: "available",
        safeThroughGuestCount: 137,
        safeGuestIncrease: 12,
        guestsUntilBoundary: 13,
        limitingDomain: "supply",
        limitingResource: { resourceId: "chicken-breast", resourceLabel: "Chicken" }
      },
      limitingDomain: "supply",
      limitingResource: { resourceId: "chicken-breast", resourceLabel: "Chicken" }
    });
    expect(projection.constraints.slice(0, 2)).toEqual([
      expect.objectContaining({ rank: 1, domain: "supply", kind: "inventory_shortage", atGuestCount: 138 }),
      expect.objectContaining({ rank: 2, domain: "people", kind: "coverage_gap", role: "server", atGuestCount: 168 })
    ]);
    expect(projection.limitingConstraint).toEqual(projection.constraints[0]);
    expect(projection.supply.sourceRevisions).toEqual({
      ...supplySourceRevisions(),
      inventoryHeadroomSourceRevisionId: "inventory-headroom-2"
    });
    expect(projection.supply.inventoryHeadroom.sourceBinding).toEqual({
      scope: inventoryHeadroomEvidence().scope,
      basis: inventoryHeadroomEvidence().basis
    });
  });

  test("preserves exact Supply provenance and distinguishes stale, contradictory, and schema-drift evidence", () => {
    const foreignSource = supplySourceRevisions();
    foreignSource.before.organizationId = "org-other";
    foreignSource.proposedAfter.organizationId = "org-other";
    const stale = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({ sourceRevisions: foreignSource })
    }));
    expect(stale.supply).toMatchObject({
      evidenceState: "stale",
      reasonCodes: expect.arrayContaining(["supply_source_revision_scope_mismatch"]),
      current: { coverageState: "unknown" },
      proposed: { coverageState: "unknown" }
    });

    const contradictorySource = supplySourceRevisions();
    contradictorySource.proposedAfter.quoteId = "quote-other";
    const contradictory = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({ sourceRevisions: contradictorySource })
    }));
    expect(contradictory.supply).toMatchObject({
      evidenceState: "contradictory",
      reasonCodes: expect.arrayContaining(["supply_source_revisions_contradictory"])
    });

    const malformedSource = supplySourceRevisions();
    delete malformedSource.before.projectionDigest;
    const schemaDrift = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({ sourceRevisions: malformedSource })
    }));
    expect(schemaDrift.supply).toMatchObject({
      evidenceState: "schema_drift",
      reasonCodes: expect.arrayContaining(["supply_source_revisions_invalid"])
    });

    const explicit = buildFulfillmentProjection(readyInput({
      people: { evidenceState: "contradictory" },
      supply: { evidenceState: "schema_drift" }
    }));
    expect(explicit.people.evidenceState).toBe("contradictory");
    expect(explicit.supply.evidenceState).toBe("schema_drift");
    expect(explicit.fulfillmentHeadroom.evidenceState).toBe("contradictory");
  });

  test("binds inventory headroom to exact Supply scope and both comparator projections", () => {
    const foreignScope = inventoryHeadroomEvidence();
    foreignScope.scope.quoteRevisionId = "quote-version-13";
    const stale = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({ inventoryHeadroom: foreignScope })
    }));
    expect(stale.supply).toMatchObject({
      evidenceState: "available",
      completeness: "partial",
      inventoryHeadroom: {
        state: "unverified",
        evidenceState: "stale",
        reasonCodes: ["inventory_headroom_scope_mismatch"]
      }
    });

    const wrongBasis = inventoryHeadroomEvidence();
    wrongBasis.basis.before.projectionDigest = "e".repeat(64);
    const contradictory = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({ inventoryHeadroom: wrongBasis })
    }));
    expect(contradictory.supply.inventoryHeadroom).toMatchObject({
      state: "unverified",
      evidenceState: "contradictory",
      reasonCodes: ["inventory_headroom_supply_binding_contradictory"]
    });

    const malformed = inventoryHeadroomEvidence();
    delete malformed.basis.proposedAfter.sourceFingerprint;
    const schemaDrift = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({ inventoryHeadroom: malformed })
    }));
    expect(schemaDrift.supply.inventoryHeadroom).toMatchObject({
      state: "unverified",
      evidenceState: "schema_drift",
      reasonCodes: ["inventory_headroom_binding_schema_invalid"]
    });
  });

  test("reports a named People limiting resource and preserves exact tied boundaries", () => {
    const peopleFirst = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({
        inventoryHeadroom: inventoryHeadroomEvidence("scenario-175", 200)
      })
    }));
    const serverResource = {
      kind: "staffing_role",
      resourceId: "staffing-role:server",
      resourceLabel: "Server",
      role: "server"
    };
    expect(peopleFirst.fulfillmentHeadroom).toMatchObject({
      limitingDomain: "people",
      limitingResource: serverResource,
      limitingResources: [{ domain: "people", resource: serverResource }],
      nextBoundaries: [{
        domain: "people",
        boundary: { atGuestCount: 168, kind: "staffing_requirement_increase" }
      }]
    });

    const tied = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({
        inventoryHeadroom: inventoryHeadroomEvidence("scenario-175", 167)
      })
    }));
    expect(tied.fulfillmentHeadroom).toMatchObject({
      limitingDomain: "multiple",
      limitingResource: null,
      nextBoundary: null,
      nextBoundaries: [
        { domain: "people", boundary: { atGuestCount: 168, kind: "staffing_requirement_increase" } },
        { domain: "supply", boundary: { atGuestCount: 168, kind: "inventory_shortage" } }
      ],
      limitingResources: [
        { domain: "people", resource: serverResource },
        {
          domain: "supply",
          resource: { resourceId: "chicken-breast", resourceLabel: "Chicken" }
        }
      ]
    });
    expect(tied.nextBoundaries).toEqual(tied.fulfillmentHeadroom.nextBoundaries);
    expect(tied.limitingResources).toEqual(tied.fulfillmentHeadroom.limitingResources);
  });

  test.each([
    ["coverage contradiction", { coverageState: "covered" }, "contradictory"],
    ["unknown coverage enum", { coverageState: "assumed" }, "schema_drift"],
    ["guest-count mismatch", { guestCount: 174 }, "stale"]
  ])("classifies %s without collapsing it to missing", (_label, proposedOverride, evidenceState) => {
    const base = supplyEvidence();
    const projection = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({
        proposed: { ...base.proposed, ...proposedOverride }
      })
    }));
    expect(projection.supply.evidenceState).toBe(evidenceState);
    expect(projection.supply.proposed.coverageState).toBe("unknown");
  });

  test("uses explicit proposed commercial role counts without pretending a policy or assignment confirmation exists", () => {
    const projection = buildFulfillmentProjection(readyInput({
      staffingPolicy: null,
      proposedRequirementsSource: undefined
    }));

    expect(projection.people.proposed).toMatchObject({
      requirementSource: "proposed_commercial_and_canonical_counts",
      assignmentBasis: "current_revision_operator_confirmed_comparison",
      totalRequired: 7,
      totalAssigned: 6,
      totalGap: 1
    });
    expect(projection.people.staffingHeadroom).toMatchObject({
      state: "unverified",
      evidenceState: "missing",
      safeGuestIncrease: null,
      reasonCodes: ["staffing_policy_missing"]
    });
    expect(projection.fulfillmentHeadroom).toMatchObject({
      state: "partial",
      safeGuestIncrease: null,
      limitingDomain: null
    });
    expect(projection.state).toBe("partial");
    expect(projection.people.boundary).toContain("current-revision operator-confirmed assignments only");
  });

  test("fails closed for an incomplete or mismatched operator-declared staffing policy", () => {
    const noActor = buildFulfillmentProjection(readyInput({
      staffingPolicy: thresholdPolicy({ declaredBy: "" })
    }));
    expect(noActor.people.staffingHeadroom.reasonCodes).toContain("staffing_policy_provenance_incomplete");

    const mismatched = buildFulfillmentProjection(readyInput({
      staffingPolicy: thresholdPolicy({
        roles: {
          ...thresholdPolicy().roles,
          server: {
            kind: "thresholds",
            thresholds: [{ atGuestCount: 1, requiredCount: 5 }, { atGuestCount: 168, requiredCount: 6 }]
          }
        }
      })
    }));
    expect(mismatched.people.staffingHeadroom).toMatchObject({
      state: "unverified",
      reasonCodes: ["staffing_policy_current_requirement_mismatch"]
    });
    expect(mismatched.fulfillmentHeadroom.state).toBe("partial");
  });

  test("supports bounded ratio/minimum rules without AI or historical inference", () => {
    const policy = thresholdPolicy({
      roles: {
        ...thresholdPolicy().roles,
        server: { kind: "ratio", guestsPerStaff: 25, minimum: 2 }
      }
    });
    const projection = buildFulfillmentProjection(readyInput({
      people: peopleEvidence({ canonicalRequirements: { lead: 0, server: 5, chef: 0, bartender: 0 } }),
      proposedRequirementsByRole: { lead: 0, server: 7, chef: 0, bartender: 0 },
      staffingPolicy: policy
    }));
    expect(projection.people.staffingHeadroom).toMatchObject({
      state: "available",
      safeThroughGuestCount: 125,
      safeGuestIncrease: 0,
      guestsUntilBoundary: 1,
      nextBoundary: {
        atGuestCount: 126,
        affectedRoles: [{ role: "server", from: 5, to: 6 }]
      }
    });
  });

  test("preserves independent Supply evidence when People is unavailable", () => {
    const projection = buildFulfillmentProjection(readyInput({
      people: { state: "error" },
      staffingPolicy: null
    }));

    expect(projection).toMatchObject({
      state: "partial",
      people: {
        evidenceState: "blocked_by_integration",
        current: { coverageState: "unknown" },
        proposed: { coverageState: "unknown" }
      },
      supply: {
        evidenceState: "available",
        proposed: { coverageState: "shortage", shortageCount: 1 }
      },
      fulfillmentHeadroom: {
        state: "partial",
        safeGuestIncrease: null
      }
    });
  });

  test("preserves exact cost while incomplete availability remains unknown rather than covered", () => {
    const projection = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({
        completeness: "partial",
        current: {
          guestCount: 125,
          coverageState: "unknown",
          shortages: [],
          projectedCost: { currency: "USD", amountMinor: 80_000 }
        },
        proposed: {
          guestCount: 175,
          coverageState: "unknown",
          shortages: [],
          projectedCost: { currency: "USD", amountMinor: 112_000 }
        }
      })
    }));

    expect(projection).toMatchObject({
      state: "partial",
      supply: {
        evidenceState: "available",
        completeness: "partial",
        current: {
          coverageState: "unknown",
          projectedCost: { state: "available", amountMinor: 80_000 }
        },
        proposed: {
          coverageState: "unknown",
          projectedCost: { state: "available", amountMinor: 112_000 }
        }
      }
    });
    expect(projection.constraints.some((constraint) => constraint.kind === "inventory_shortage"))
      .toBe(false);
  });

  test("marks stale and truncated evidence without converting unknown backup capacity into zero", () => {
    const stale = buildFulfillmentProjection(readyInput({
      people: peopleEvidence({ freshness: "stale" })
    }));
    expect(stale.people).toMatchObject({
      evidenceState: "stale",
      freshness: "stale",
      current: { coverageState: "unknown" },
      staffingHeadroom: { evidenceState: "stale", state: "unverified" }
    });

    const truncated = buildFulfillmentProjection(readyInput({
      people: peopleEvidence({ profilesTruncated: true })
    }));
    expect(truncated).toMatchObject({
      state: "partial",
      people: {
        evidenceState: "available",
        completeness: "partial",
        resilience: {
          evidenceState: "missing",
          completeness: "partial",
          eligibleBackupCountByRole: { server: null },
          zeroBackupCriticalRoles: []
        },
        staffingHeadroom: { state: "available", safeThroughGuestCount: 167 }
      }
    });

    const supplyTruncated = buildFulfillmentProjection(readyInput({
      supply: supplyEvidence({ truncated: true })
    }));
    expect(supplyTruncated).toMatchObject({
      state: "partial",
      supply: {
        evidenceState: "available",
        completeness: "partial",
        reasonCodes: expect.arrayContaining(["supply_evidence_truncated"])
      }
    });
  });

  test("identifies required roles with no conflict-clear eligible backup", () => {
    const base = peopleEvidence();
    const projection = buildFulfillmentProjection(readyInput({
      people: {
        ...base,
        profiles: base.profiles.filter((entry) => entry.staffId.startsWith("assigned-")),
        scheduleConflictEvidence: {
          ...base.scheduleConflictEvidence,
          entries: []
        }
      }
    }));

    expect(projection.people.resilience).toMatchObject({
      evidenceState: "available",
      eligibleBackupCountByRole: { server: 0 },
      eligibleProfileCount: 0,
      zeroBackupCriticalRoles: ["server"]
    });
    expect(projection.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        domain: "people",
        kind: "zero_eligible_backup",
        role: "server",
        quantity: 0
      })
    ]));
  });

  test("does not project private people fields or the declaring actor", () => {
    const privateValues = [
      "private@example.test",
      "+15555550123",
      "31.75",
      "Keep this private",
      "operator-sensitive-uid"
    ];
    const basePeople = peopleEvidence();
    const projection = buildFulfillmentProjection(readyInput({
      people: {
        ...basePeople,
        profiles: basePeople.profiles.map((entry, index) => index === 0 ? {
          ...entry,
          displayName: "Private Person",
          email: privateValues[0],
          phone: privateValues[1],
          hourlyRate: 31.75,
          privateNotes: privateValues[3]
        } : entry),
        privateDirectoryRecord: { legalName: "Private Legal Name" }
      },
      staffingPolicy: thresholdPolicy({ declaredBy: privateValues[4] })
    }));
    const serialized = JSON.stringify(projection);

    [...privateValues, "Private Person", "Private Legal Name"].forEach((privateValue) => {
      expect(serialized).not.toContain(privateValue);
    });
    expect(projection.people.staffingHeadroom.policy.actorRecorded).toBe(true);
    expect(Object.keys(projection.people.current.byRole)).toEqual(["lead", "server", "chef", "bartender"]);
  });

  test("is deterministic, deeply frozen, and retains no state between rapid scenarios", () => {
    const at175 = buildFulfillmentProjection(readyInput());
    const at150 = buildFulfillmentProjection(readyInput({
      scenarioId: "scenario-150",
      proposedGuestCount: 150,
      proposedRequirementsByRole: { lead: 0, server: 6, chef: 0, bartender: 0 },
      supply: supplyEvidence({
        scenarioId: "scenario-150",
        proposed: {
          guestCount: 150,
          coverageState: "shortage",
          shortages: [{
            resourceId: "chicken-breast",
            resourceLabel: "Chicken",
            shortageQuantityMicros: 1_000_000,
            unitId: "lb"
          }],
          projectedCost: { currency: "USD", amountMinor: 95_000 }
        }
      })
    }));
    const at160 = buildFulfillmentProjection(readyInput({
      scenarioId: "scenario-160",
      proposedGuestCount: 160,
      proposedRequirementsByRole: { lead: 0, server: 6, chef: 0, bartender: 0 },
      supply: supplyEvidence({
        scenarioId: "scenario-160",
        proposed: {
          guestCount: 160,
          coverageState: "shortage",
          shortages: [{
            resourceId: "chicken-breast",
            resourceLabel: "Chicken",
            shortageQuantityMicros: 2_000_000,
            unitId: "lb"
          }],
          projectedCost: { currency: "USD", amountMinor: 101_000 }
        }
      })
    }));
    const repeated160 = buildFulfillmentProjection(readyInput({
      scenarioId: "scenario-160",
      proposedGuestCount: 160,
      proposedRequirementsByRole: { lead: 0, server: 6, chef: 0, bartender: 0 },
      supply: supplyEvidence({
        scenarioId: "scenario-160",
        proposed: {
          guestCount: 160,
          coverageState: "shortage",
          shortages: [{
            resourceId: "chicken-breast",
            resourceLabel: "Chicken",
            shortageQuantityMicros: 2_000_000,
            unitId: "lb"
          }],
          projectedCost: { currency: "USD", amountMinor: 101_000 }
        }
      })
    }));

    expect(at175.scenario.proposedGuestCount).toBe(175);
    expect(at150.scenario.proposedGuestCount).toBe(150);
    expect(at160.scenario.proposedGuestCount).toBe(160);
    expect(at160.supply.proposed.projectedCost.amountMinor).toBe(101_000);
    expect(at160).toEqual(repeated160);
    expectDeepFrozen(at160);
    expect(() => {
      at160.people.proposed.byRole.server.required = 999;
    }).toThrow(TypeError);
    expect(at175.people.proposed.byRole.server.required).toBe(7);
  });
});
