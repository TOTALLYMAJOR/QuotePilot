import { describe, expect, test } from "vitest";
import {
  buildLivingCommercialTwinInventoryFingerprint,
  buildLivingCommercialTwinProjection,
  buildLivingCommercialTwinScenarioContextFingerprint,
  getSavedInventoryComparisonRead,
  isGuestCountOnlyProposal
} from "../livingCommercialTwinProjection";

const SCENARIO_ID = "scenario-175";
const BEFORE_REQUIREMENT_DIGEST = "a".repeat(64);
const BEFORE_PROJECTION_DIGEST = "b".repeat(64);
const PROPOSED_REQUIREMENT_DIGEST = "c".repeat(64);
const PROPOSED_PROJECTION_DIGEST = "d".repeat(64);
const BEFORE_SOURCE_FINGERPRINT = '{"requirementRevision":4,"stockRevision":20}';
const PROPOSED_SOURCE_FINGERPRINT = '{"scenario":"proposed","stockRevision":20}';

function commitment(guests = 125) {
  return {
    revisionId: "version-14",
    event: { guests },
    protocol: { state: "renewed_delivery_required" }
  };
}

function commercialModel(proposedGuestCount = 175) {
  const total = 12_480 + ((proposedGuestCount - 125) * 88.8);
  const deposit = 3_120 + ((proposedGuestCount - 125) * 22.2);
  return {
    sources: {
      before: { label: "canonical_quote_revision", authority: "server_authoritative" },
      proposedAfter: { label: "authoritative_pricing_preview", authority: "server_authoritative" }
    },
    graph: { graphId: "commercial-dependency-graph-v1", graphVersion: "1" },
    commercialValues: {
      currency: "USD",
      authoritativeTotal: {
        before: 12_480,
        proposedAfter: total,
        changed: total !== 12_480,
        authority: "server_authoritative"
      },
      depositRequirement: {
        before: 3_120,
        proposedAfter: deposit,
        changed: deposit !== 3_120,
        authority: "server_authoritative"
      }
    },
    impact: {
      dependentNodes: proposedGuestCount === 125 ? [] : [{
        id: "output.plan.staffing_requirement",
        advisoryClass: "REVIEW",
        triggeredBy: ["fact.event.guest_count"]
      }, {
        id: "artifact.kitchen_beo",
        advisoryClass: "STALE",
        triggeredBy: ["fact.event.guest_count"]
      }]
    },
    boundary: "Server-authoritative commercial preview; authorization and apply remain separate."
  };
}

function inventoryConsequences() {
  return {
    schemaVersion: "commercial-inventory-consequences-v1",
    state: "current",
    authority: "read_only_advisory",
    expected: {
      organizationId: "org-1",
      quoteId: "quote-1",
      savedQuoteRevisionId: "version-14",
      scenarioFingerprint: SCENARIO_ID
    },
    provenance: {
      before: {
        organizationId: "org-1",
        quoteId: "quote-1",
        quoteRevisionId: "version-14",
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
        quoteRevisionId: "version-14",
        eventRequirementRevisionId: "event-requirement-preview-5",
        requirementDigest: PROPOSED_REQUIREMENT_DIGEST,
        projectionDigest: PROPOSED_PROJECTION_DIGEST,
        projectionVersion: "event-requirement-projection-v1",
        sourceFingerprint: PROPOSED_SOURCE_FINGERPRINT,
        scenarioFingerprint: SCENARIO_ID
      }
    },
    cost: {
      state: "changed",
      currency: "USD",
      before: { projectedCostMinor: 80_000 },
      proposedAfter: { projectedCostMinor: 112_000 },
      deltaMinor: 32_000
    },
    availability: {
      state: "changed",
      beforeState: "available",
      proposedAfterState: "shortage",
      ingredients: [{
        ingredientId: "chicken-breast",
        baseUnitId: "lb",
        before: {
          ingredientName: "Chicken breast",
          requiredQuantityMicros: 25_000_000,
          shortageQuantityMicros: 0,
          availabilityState: "available"
        },
        proposedAfter: {
          ingredientName: "Chicken breast",
          requiredQuantityMicros: 35_000_000,
          shortageQuantityMicros: 5_000_000,
          availabilityState: "shortage"
        },
        requiredDeltaMicros: 10_000_000,
        shortageDeltaMicros: 5_000_000,
        changed: true
      }]
    }
  };
}

function inventoryHeadroomEvidence(safeThroughGuestCount = 137) {
  return {
    state: "current",
    freshness: "current",
    sourceRevisionId: "inventory-headroom-2",
    scope: {
      organizationId: "org-1",
      quoteId: "quote-1",
      quoteRevisionId: "version-14",
      scenarioId: SCENARIO_ID
    },
    basis: {
      before: {
        projectionDigest: BEFORE_PROJECTION_DIGEST,
        sourceFingerprint: BEFORE_SOURCE_FINGERPRINT
      },
      proposedAfter: {
        projectionDigest: PROPOSED_PROJECTION_DIGEST,
        sourceFingerprint: PROPOSED_SOURCE_FINGERPRINT,
        scenarioFingerprint: SCENARIO_ID
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

function coveredStaffingAt175() {
  const assignments = Array.from({ length: 6 }, (_, index) => ({
    staffId: `staff-${index + 1}`,
    role: "server",
    state: "operator_confirmed"
  }));
  return {
    staffingRead: {
      state: "current",
      observedAtISO: "2026-10-01T15:00:00.000Z",
      envelope: {
        state: "current",
        organizationId: "org-1",
        quoteId: "quote-1",
        activeQuoteRevisionId: "version-14",
        authorityVersion: "operational-staffing-authority-v1",
        canonicalEventWindow: {
          startAtISO: "2026-10-10T22:00:00.000Z",
          endAtISO: "2026-10-11T02:00:00.000Z"
        },
        canonicalRequirements: { lead: 0, server: 6, chef: 0, bartender: 0 },
        profiles: [],
        profilesTruncated: false,
        scheduleConflictEvidence: {
          state: "current",
          freshness: "current",
          completeness: "complete",
          organizationId: "org-1",
          quoteId: "quote-1",
          quoteRevisionId: "version-14",
          eventWindow: {
            startAtISO: "2026-10-10T22:00:00.000Z",
            endAtISO: "2026-10-11T02:00:00.000Z"
          },
          sourceRevisionId: "schedule-conflicts-4",
          entries: []
        },
        snapshot: { quoteRevisionId: "version-14", planRevision: 4, assignments }
      }
    },
    proposedStaffingRequirements: { lead: 0, server: 6, chef: 0, bartender: 0 },
    staffingRequirementPolicy: {
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
        lead: { kind: "thresholds", thresholds: [{ atGuestCount: 1, requiredCount: 0 }] },
        server: {
          kind: "thresholds",
          thresholds: [
            { atGuestCount: 1, requiredCount: 6 },
            { atGuestCount: 200, requiredCount: 7 }
          ]
        },
        chef: { kind: "thresholds", thresholds: [{ atGuestCount: 1, requiredCount: 0 }] },
        bartender: { kind: "thresholds", thresholds: [{ atGuestCount: 1, requiredCount: 0 }] }
      }
    }
  };
}

function sourcingPreview({
  eventRequirementRevisionId = "event-requirement-preview-5",
  projectionDigest = PROPOSED_PROJECTION_DIGEST,
  scenarioFingerprint = SCENARIO_ID,
  shortageQuantityMicros = 6_000_000
} = {}) {
  return {
    schemaVersion: "inventory-sourcing-preview-v1",
    authority: "inventory_sourcing_read_model",
    state: "current",
    freshness: "current",
    organizationId: "org-1",
    quoteId: "quote-1",
    quoteRevisionId: "version-14",
    scenarioId: SCENARIO_ID,
    basis: {
      eventRequirementRevisionId,
      projectionDigest,
      scenarioFingerprint,
      shortageQuantityMicros
    },
    selectionState: "unique_policy_match",
    policyRevisionId: "sourcing-policy-7",
    offerRevisionId: "supplier-b-offer-12",
    recommendation: {
      supplierId: "supplier-b",
      supplierLabel: "Supplier B",
      ingredientId: "chicken-breast",
      unitId: "lb",
      coverageQuantityMicros: 6_000_000,
      purchaseQuantityMicros: 6_000_000,
      addedCostMinor: 1_800,
      currency: "USD",
      conditions: ["Receive and refresh Inventory evidence before treating supply as covered."]
    }
  };
}

function readyInput(overrides = {}) {
  return {
    organizationId: "org-1",
    quoteId: "quote-1",
    quoteRevisionId: "version-14",
    scenarioId: SCENARIO_ID,
    commitment: commitment(),
    proposedGuestCount: 175,
    selectedMenuItemNames: ["Chicken Alfredo"],
    previewAvailable: true,
    previewRequested: true,
    previewScopeCurrent: true,
    commercialModel: commercialModel(),
    authorityState: "enforced",
    authorizationRequired: true,
    inventoryEnabled: true,
    inventoryScenarioEligible: true,
    inventoryPreviewAvailable: true,
    inventoryInputReady: true,
    inventoryConsequences: inventoryConsequences(),
    inventoryPreview: { state: "current" },
    ...overrides
  };
}

describe("buildLivingCommercialTwinProjection", () => {
  test("carries only explicit recorded-cost margin comparison evidence", () => {
    const available = buildLivingCommercialTwinProjection(readyInput({
      marginComparison: {
        evidenceState: "available",
        before: 0.31,
        proposedAfter: 0.27
      }
    }));
    expect(available.consequences.margin).toMatchObject({
      evidenceState: "available",
      before: 0.31,
      proposedAfter: 0.27
    });
    expect(available.consequences.margin.delta).toBeCloseTo(-0.04, 8);

    const stale = buildLivingCommercialTwinProjection(readyInput({
      marginComparison: {
        evidenceState: "stale",
        before: 0.31,
        proposedAfter: 0.27
      }
    }));
    expect(stale.consequences.margin).toMatchObject({
      evidenceState: "stale",
      before: null,
      proposedAfter: null,
      delta: null
    });
  });

  test("keeps guest-only edits inside one scenario context and invalidates other draft inputs", () => {
    const base = {
      form: {
        guests: 125,
        eventName: "Henderson Dinner",
        venue: "Atrium",
        attendancePlanning: { estimate: 125 }
      },
      selections: [{ menuItemId: "chicken-alfredo", requiredOutputQuantity: "10" }]
    };
    const fingerprint = buildLivingCommercialTwinScenarioContextFingerprint(base);
    expect(buildLivingCommercialTwinScenarioContextFingerprint({
      ...base,
      form: { ...base.form, guests: 175, attendancePlanning: { estimate: 175 } }
    })).toBe(fingerprint);
    expect(buildLivingCommercialTwinScenarioContextFingerprint({
      ...base,
      form: { ...base.form, venue: "Garden" }
    })).not.toBe(fingerprint);
    expect(buildLivingCommercialTwinScenarioContextFingerprint({
      ...base,
      selections: [{ menuItemId: "chicken-alfredo", requiredOutputQuantity: "12" }]
    })).not.toBe(fingerprint);
  });

  test("uses a server-current saved projection for dirty-draft comparison without widening mutation eligibility", () => {
    const read = {
      state: "draft_not_evaluated",
      sourceState: "current",
      savedProjectionState: "recorded",
      projection: { freshness: "as_recorded", quoteRevisionId: "version-14" }
    };

    const comparisonRead = getSavedInventoryComparisonRead(read);
    expect(comparisonRead).toEqual({ ...read, state: "recorded" });
    expect(comparisonRead).not.toBe(read);
    expect(read.state).toBe("draft_not_evaluated");

    const unavailable = { ...read, sourceState: "unavailable" };
    expect(getSavedInventoryComparisonRead(unavailable)).toBe(unavailable);
  });

  test("invalidates inventory evidence when an explicit output quantity changes", () => {
    const common = {
      commercialFormFingerprint: '{"guests":175}'
    };
    const quantityTen = buildLivingCommercialTwinInventoryFingerprint({
      ...common,
      selections: [{ menuItemId: "chicken-alfredo", requiredOutputQuantity: "10" }]
    });
    const quantityTwelve = buildLivingCommercialTwinInventoryFingerprint({
      ...common,
      selections: [{ menuItemId: "chicken-alfredo", requiredOutputQuantity: "12" }]
    });

    expect(quantityTen).not.toBe(quantityTwelve);
    expect(buildLivingCommercialTwinInventoryFingerprint({
      ...common,
      selections: [{ menuItemId: "chicken-alfredo", requiredOutputQuantity: "12" }]
    })).toBe(quantityTwelve);

    const invalidatedProjection = buildLivingCommercialTwinProjection(readyInput({
      commercialModel: commercialModel(),
      inventoryConsequences: { state: "not_evaluated" },
      inventoryPreview: { state: "not_evaluated" }
    }));
    expect(invalidatedProjection).toMatchObject({
      state: "partial",
      consequences: {
        commercial: { evidenceState: "available" },
        inventory: { evidenceState: "not_yet_available" }
      },
      nextAction: {
        kind: "preview_consequences",
        label: "Preview consequences",
        disabled: false
      }
    });
  });

  test("allows inventory composition only for a guest-count-only proposal", () => {
    const currentForm = {
      guests: 125,
      menuItems: ["chicken-alfredo"],
      pkg: "dinner",
      date: "2026-10-11"
    };
    expect(isGuestCountOnlyProposal({
      currentForm,
      proposedForm: { ...currentForm, guests: 175 }
    })).toBe(true);
    expect(isGuestCountOnlyProposal({
      currentForm,
      proposedForm: { ...currentForm, guests: 175, menuItems: ["salmon"] }
    })).toBe(false);

    const mixed = buildLivingCommercialTwinProjection(readyInput({
      inventoryScenarioEligible: false
    }));
    expect(mixed).toMatchObject({
      state: "partial",
      consequences: {
        commercial: { evidenceState: "available" },
        inventory: {
          evidenceState: "not_applicable",
          applicability: "mixed_proposal_outside_slice",
          ingredients: [],
          shortages: []
        }
      }
    });
  });

  test("does not carry saved-window assignment coverage into changed proposed timing", () => {
    const projection = buildLivingCommercialTwinProjection(readyInput({
      ...coveredStaffingAt175(),
      proposedStaffingEventWindowState: "changed_unchecked"
    }));

    expect(projection.fulfillment.people).toMatchObject({
      evidenceState: "available",
      completeness: "partial",
      current: { coverageState: "coverage_confirmed", totalGap: 0 },
      proposed: {
        coverageState: "unknown",
        totalGap: null,
        assignmentBasis: "proposed_event_window_not_evaluated"
      }
    });
    expect(projection.decisionAnswer).toMatchObject({
      state: "unverifiable",
      staffing: { effect: "unverified", assignmentGap: null }
    });
  });

  test("composes the 125 to 175 Chicken Alfredo scenario from exact commercial and inventory evidence", () => {
    const input = readyInput();
    const projection = buildLivingCommercialTwinProjection(input);

    expect(projection).toMatchObject({
      schemaVersion: "living-commercial-twin-v1",
      authority: "presentation_only_projection",
      state: "partial",
      scenario: {
        currentGuestCount: 125,
        proposedGuestCount: 175,
        guestDelta: 50,
        changed: true,
        selectedMenuItemNames: ["Chicken Alfredo"]
      },
      consequences: {
        commercial: {
          evidenceState: "available",
          currency: "USD",
          total: { before: 12_480, proposedAfter: 16_920, delta: 4_440 },
          depositRequirement: { before: 3_120, proposedAfter: 4_230, delta: 1_110 }
        },
        inventory: {
          evidenceState: "available",
          cost: { beforeMinor: 80_000, proposedAfterMinor: 112_000, deltaMinor: 32_000 },
          availability: { proposedAfterState: "shortage" }
        },
        staffing: {
          evidenceState: "available",
          effect: "review_required",
          inferredQuantity: null
        },
        beo: { evidenceState: "available", effect: "stale", inferredQuantity: null }
      },
      operationalConstraint: {
        evidenceState: "available",
        kind: "inventory_shortage",
        commercialApplyBlocked: false,
        affectedIds: ["chicken-breast"]
      },
      guestCountHeadroom: {
        evidenceState: "not_yet_available",
        verificationState: "unverified",
        safeThroughGuestCount: null
      },
      reversibility: { state: "before_apply", canDiscardProposal: true },
      nextAction: { kind: "review_authorization", disabled: false }
    });
    expect(projection.consequences.inventory.shortages[0]).toMatchObject({
      ingredientId: "chicken-breast",
      shortageQuantityMicros: { proposedAfter: 5_000_000, delta: 5_000_000 }
    });
    expect(projection.boundary).toContain("does not price a quote");
    expect(projection.provenance.inventory).toEqual({
      authority: "read_only_advisory",
      quoteRevisionId: "version-14",
      scenarioFingerprint: SCENARIO_ID,
      before: inventoryConsequences().provenance.before,
      proposedAfter: inventoryConsequences().provenance.proposedAfter
    });
    expect(projection.fulfillment.supply.sourceRevisions).toEqual({
      quoteRevisionId: "version-14",
      scenarioFingerprint: SCENARIO_ID,
      before: inventoryConsequences().provenance.before,
      proposedAfter: inventoryConsequences().provenance.proposedAfter,
      inventoryHeadroomSourceRevisionId: null,
      observedAtISO: null
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.consequences.inventory.shortages[0])).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.commercialModel)).toBe(false);
  });

  test("builds one conditional decision answer from exact Commercial, Staffing, Inventory, BEO, and sourcing evidence", () => {
    const commercial = commercialModel();
    commercial.commercialValues.authoritativeTotal.proposedAfter = 17_472;
    const inventory = inventoryConsequences();
    const causalContribution = {
      selectionId: "chicken-alfredo",
      menuItemId: "chicken-alfredo",
      recipeRevisionId: "recipe-chicken-alfredo-9",
      recipeDigest: "e".repeat(64),
      exactRequiredQuantityMicros: { numerator: "36000000", denominator: "1" },
      commercialProvenance: { kind: "direct", sourceId: "chicken-alfredo" }
    };
    inventory.availability.ingredients[0].before.contributions = [{
      ...causalContribution,
      exactRequiredQuantityMicros: { numerator: "25000000", denominator: "1" }
    }];
    inventory.availability.ingredients[0].proposedAfter = {
      ...inventory.availability.ingredients[0].proposedAfter,
      requiredQuantityMicros: 36_000_000,
      shortageQuantityMicros: 6_000_000,
      contributions: [causalContribution]
    };
    inventory.availability.ingredients[0].requiredDeltaMicros = 11_000_000;
    inventory.availability.ingredients[0].shortageDeltaMicros = 6_000_000;

    const projection = buildLivingCommercialTwinProjection(readyInput({
      ...coveredStaffingAt175(),
      commercialModel: commercial,
      inventoryConsequences: inventory,
      inventoryHeadroomEvidence: inventoryHeadroomEvidence(),
      inventorySourcingPreview: sourcingPreview(),
      selectedMenuItems: [{ menuItemId: "chicken-alfredo", label: "Chicken Alfredo" }]
    }));

    expect(projection.decisionAnswer).toMatchObject({
      schemaVersion: "fulfillment-decision-answer-v1",
      authority: "presentation_only_projection",
      state: "conditional",
      guestCount: 175,
      commercialReview: { state: "authoritative_preview_available" },
      supplyConstraint: {
        ingredientId: "chicken-breast",
        ingredientLabel: "Chicken breast",
        shortageQuantityMicros: 6_000_000,
        unitId: "lb",
        causalityState: "available",
        contributingMenuItems: [{
          menuItemId: "chicken-alfredo",
          label: "Chicken Alfredo",
          recipeRevisionId: "recipe-chicken-alfredo-9"
        }]
      },
      sourcingResolution: {
        evidenceState: "available",
        selectionState: "unique_policy_match",
        supplierId: "supplier-b",
        supplierLabel: "Supplier B",
        coverageQuantityMicros: 6_000_000,
        purchaseQuantityMicros: 6_000_000,
        addedCostMinor: 1_800,
        policyRevisionId: "sourcing-policy-7",
        offerRevisionId: "supplier-b-offer-12",
        basis: {
          eventRequirementRevisionId: "event-requirement-preview-5",
          projectionDigest: PROPOSED_PROJECTION_DIGEST,
          scenarioFingerprint: SCENARIO_ID,
          shortageQuantityMicros: 6_000_000
        }
      },
      commercialValue: {
        kind: "proposed_quote_total",
        amount: 17_472,
        currency: "USD",
        authority: "server_authoritative"
      },
      staffing: {
        evidenceState: "available",
        effect: "current_assignments_cover_proposed_requirement",
        assignmentGap: 0
      },
      beo: { evidenceState: "available", effect: "stale" }
    });
    expect(projection.decisionAnswer.commercialReview.boundary).toContain("not customer acceptance");
    expect(projection.decisionAnswer.commercialValue.boundary).toContain("not earned revenue");
    expect(projection.decisionAnswer.sourcingResolution.boundary).toContain("not stock");
    expect(Object.isFrozen(projection.decisionAnswer)).toBe(true);
  });

  test("keeps the integrated answer partial when supplier selection or menu causality is not evidenced", () => {
    const projection = buildLivingCommercialTwinProjection(readyInput());

    expect(projection.decisionAnswer).toMatchObject({
      state: "unverifiable",
      supplyConstraint: {
        causalityState: "not_yet_available",
        contributingMenuItems: []
      },
      sourcingResolution: {
        evidenceState: "not_yet_available",
        selectionState: "none",
        supplierId: null
      },
      staffing: { effect: "unverified", assignmentGap: null },
      commercialValue: { amount: 16_920, kind: "proposed_quote_total" }
    });
    expect(projection.decisionAnswer.reasonCodes).toContain("sourcing_resolution_not_established");
    expect(projection.decisionAnswer.reasonCodes).toContain("people_evidence_not_current");
  });

  test("withholds a supplier selected against an older Inventory projection in the same scenario", () => {
    const projection = buildLivingCommercialTwinProjection(readyInput({
      ...coveredStaffingAt175(),
      inventorySourcingPreview: sourcingPreview({
        projectionDigest: "f".repeat(64),
        shortageQuantityMicros: 5_000_000
      })
    }));

    expect(projection.decisionAnswer.sourcingResolution).toMatchObject({
      evidenceState: "stale",
      selectionState: "none",
      supplierId: null,
      supplierLabel: null,
      basis: null,
      reasonCodes: ["sourcing_inventory_basis_mismatch"]
    });
  });

  test("validates exact inventory scope and preserves contradictory and schema-drift semantics", () => {
    const foreign = inventoryConsequences();
    foreign.expected.organizationId = "org-other";
    foreign.provenance.before.organizationId = "org-other";
    foreign.provenance.proposedAfter.organizationId = "org-other";
    const stale = buildLivingCommercialTwinProjection(readyInput({
      inventoryConsequences: foreign
    }));
    expect(stale.consequences.inventory).toMatchObject({
      evidenceState: "stale",
      ingredients: [],
      shortages: []
    });
    expect(stale.provenance.inventory).toBeNull();

    const internallyContradictory = inventoryConsequences();
    internallyContradictory.provenance.proposedAfter.quoteId = "quote-other";
    const contradictory = buildLivingCommercialTwinProjection(readyInput({
      inventoryConsequences: internallyContradictory
    }));
    expect(contradictory.consequences.inventory.evidenceState).toBe("contradictory");
    expect(contradictory.fulfillment.supply.evidenceState).toBe("contradictory");

    const malformed = inventoryConsequences();
    delete malformed.provenance.before.projectionDigest;
    const schemaDrift = buildLivingCommercialTwinProjection(readyInput({
      inventoryConsequences: malformed
    }));
    expect(schemaDrift.consequences.inventory.evidenceState).toBe("schema_drift");
    expect(schemaDrift.fulfillment.supply.evidenceState).toBe("schema_drift");

    const explicit = buildLivingCommercialTwinProjection(readyInput({
      inventoryConsequences: { state: "contradictory" }
    }));
    expect(explicit.consequences.inventory.evidenceState).toBe("contradictory");
    expect(explicit.state).toBe("partial");
  });

  test("composes Staffing and Inventory only inside the Fulfillment read projection", () => {
    const fixed = (requiredCount) => ({
      kind: "thresholds",
      thresholds: [{ atGuestCount: 1, requiredCount }]
    });
    const assignments = Array.from({ length: 6 }, (_, index) => ({
      staffId: `staff-${index + 1}`,
      role: "server",
      state: "operator_confirmed"
    }));
    const projection = buildLivingCommercialTwinProjection(readyInput({
      organizationId: "org-1",
      quoteId: "quote-1",
      quoteRevisionId: "version-14",
      scenarioId: "scenario-175",
      proposedStaffingRequirements: { lead: 0, server: 7, chef: 0, bartender: 0 },
      proposedStaffingRequirementsSource: "proposed_commercial_and_canonical_counts",
      staffingRead: {
        state: "current",
        observedAtISO: "2026-10-01T15:00:00.000Z",
        envelope: {
          state: "current",
          organizationId: "org-1",
          quoteId: "quote-1",
          activeQuoteRevisionId: "version-14",
          authorityVersion: "operational-staffing-authority-v1",
          observedAtISO: "2026-10-01T15:00:00.000Z",
          canonicalEventWindow: {
            startAtISO: "2026-10-10T22:00:00.000Z",
            endAtISO: "2026-10-11T02:00:00.000Z"
          },
          canonicalRequirements: { lead: 0, server: 6, chef: 0, bartender: 0 },
          profiles: [],
          profilesTruncated: false,
          snapshot: { quoteRevisionId: "version-14", planRevision: 4, assignments }
        }
      },
      staffingRequirementPolicy: {
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
              { atGuestCount: 168, requiredCount: 7 }
            ]
          },
          chef: fixed(0),
          bartender: fixed(0)
        }
      },
      inventoryHeadroomEvidence: inventoryHeadroomEvidence()
    }));

    expect(projection.fulfillment).toMatchObject({
      authority: "presentation_only_projection",
      identity: {
        organizationId: "org-1",
        quoteId: "quote-1",
        quoteRevisionId: "version-14",
        scenarioId: "scenario-175"
      },
      state: "partial",
      people: {
        evidenceState: "available",
        current: { totalAssigned: 6, totalRequired: 6, totalGap: 0 },
        proposed: { totalAssigned: 6, totalRequired: 7, totalGap: 1 },
        staffingHeadroom: {
          safeThroughGuestCount: 167,
          safeGuestIncrease: 42,
          guestsUntilBoundary: 43
        },
        resilience: { evidenceState: "missing", eligibleProfileCount: null }
      },
      supply: {
        evidenceState: "available",
        current: { coverageState: "covered" },
        proposed: {
          coverageState: "shortage",
          shortages: [{ resourceId: "chicken-breast", resourceLabel: "Chicken breast" }]
        },
        inventoryHeadroom: { safeGuestIncrease: 12, guestsUntilBoundary: 13 }
      },
      fulfillmentHeadroom: {
        state: "available",
        safeGuestIncrease: 12,
        limitingDomain: "supply",
        limitingResource: { resourceId: "chicken-breast", resourceLabel: "Chicken" }
      }
    });
    expect(projection.fulfillment.supply.inventoryHeadroom.sourceBinding).toEqual({
      scope: inventoryHeadroomEvidence().scope,
      basis: inventoryHeadroomEvidence().basis
    });
    expect(projection.fulfillment).not.toHaveProperty("event");
    expect(projection.fulfillment.boundary).toContain("presentation-only composition");
  });

  test("treats an exact empty staffing plan as current zero-assignment evidence", () => {
    const emptyStaffing = (canonicalRequirements) => ({
      state: "empty",
      observedAtISO: "2026-10-01T15:00:00.000Z",
      envelope: {
        state: "empty",
        organizationId: "org-1",
        quoteId: "quote-1",
        activeQuoteRevisionId: "version-14",
        authorityVersion: "operational-staffing-authority-v1",
        observedAtISO: "2026-10-01T15:00:00.000Z",
        canonicalEventWindow: {
          startAtISO: "2026-10-10T22:00:00.000Z",
          endAtISO: "2026-10-11T02:00:00.000Z"
        },
        canonicalRequirements,
        profiles: [],
        profilesTruncated: false,
        snapshot: null
      }
    });
    const gap = buildLivingCommercialTwinProjection(readyInput({
      staffingRead: emptyStaffing({ lead: 0, server: 6, chef: 0, bartender: 0 })
    }));
    expect(gap.fulfillment.people).toMatchObject({
      evidenceState: "available",
      freshness: "current",
      current: {
        coverageState: "attention",
        totalAssigned: 0,
        totalRequired: 6,
        totalGap: 6
      },
      resilience: { evidenceState: "missing" },
      staffingHeadroom: { evidenceState: "missing" }
    });
    expect(gap.fulfillment.sourceRevisions.people.planRevision).toBeNull();

    const notRequired = buildLivingCommercialTwinProjection(readyInput({
      staffingRead: emptyStaffing({ lead: 0, server: 0, chef: 0, bartender: 0 })
    }));
    expect(notRequired.fulfillment.people.current).toMatchObject({
      coverageState: "not_required",
      totalAssigned: 0,
      totalRequired: 0,
      totalGap: 0
    });

    const stale = buildLivingCommercialTwinProjection(readyInput({
      staffingRead: {
        ...emptyStaffing({ lead: 0, server: 6, chef: 0, bartender: 0 }),
        state: "stale"
      }
    }));
    expect(stale.fulfillment.people).toMatchObject({
      evidenceState: "stale",
      current: { coverageState: "unknown", totalAssigned: null, totalGap: null }
    });
  });

  test("keeps an inventory integration failure independent from current commercial evidence", () => {
    const projection = buildLivingCommercialTwinProjection(readyInput({
      inventoryConsequences: { state: "unavailable" },
      inventoryPreview: { state: "unavailable" }
    }));

    expect(projection.state).toBe("partial");
    expect(projection.consequences.commercial.evidenceState).toBe("available");
    expect(projection.consequences.commercial.total.delta).toBe(4_440);
    expect(projection.consequences.inventory).toMatchObject({
      evidenceState: "blocked_by_integration",
      cost: { deltaMinor: null },
      shortages: []
    });
    expect(projection.consequences.staffing.effect).toBe("review_required");
    expect(projection.consequences.beo.effect).toBe("stale");
    expect(projection.nextAction.kind).toBe("retry_preview");
  });

  test("does not bridge incomplete inventory availability into covered Fulfillment supply", () => {
    const partialInventory = inventoryConsequences();
    partialInventory.availability = {
      state: "partial",
      beforeState: null,
      proposedAfterState: null,
      ingredients: []
    };
    const projection = buildLivingCommercialTwinProjection(readyInput({
      organizationId: "org-1",
      quoteId: "quote-1",
      quoteRevisionId: "version-14",
      scenarioId: "scenario-175",
      inventoryConsequences: partialInventory
    }));

    expect(projection.fulfillment.supply).toMatchObject({
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
    });
  });

  test("marks inventory evidence missing instead of inferring portions from guests", () => {
    const projection = buildLivingCommercialTwinProjection(readyInput({
      inventoryInputReady: false,
      inventoryConsequences: null,
      inventoryPreview: { state: "not_evaluated" }
    }));

    expect(projection.consequences.inventory).toMatchObject({
      evidenceState: "missing",
      ingredients: [],
      shortages: []
    });
    expect(projection.consequences.inventory.boundary).toContain("guest count is never used to infer portions");
    expect(projection.consequences.staffing.inferredQuantity).toBeNull();
    expect(projection.guestCountHeadroom).toMatchObject({
      verificationState: "unverified",
      remainingGuests: null,
      limitingRail: null
    });
    expect(projection.nextAction).toMatchObject({
      kind: "complete_inventory_inputs",
      disabled: false
    });
  });

  test("disables the action when authoritative commercial preview is unavailable", () => {
    const projection = buildLivingCommercialTwinProjection(readyInput({
      previewAvailable: false,
      previewRequested: false,
      commercialModel: null,
      inventoryEnabled: false,
      inventoryInputReady: false,
      inventoryConsequences: null,
      inventoryPreview: null
    }));

    expect(projection.consequences.commercial.evidenceState).toBe("blocked_by_integration");
    expect(projection.consequences.inventory.evidenceState).toBe("blocked_by_integration");
    expect(projection.nextAction).toEqual({
      kind: "preview_unavailable",
      label: "Authoritative preview unavailable",
      disabled: true
    });
  });

  test("does not offer a callable inventory recovery when no evidence target exists", () => {
    const projection = buildLivingCommercialTwinProjection(readyInput({
      inventoryEnabled: false,
      inventoryPreviewAvailable: false,
      inventoryInputReady: false,
      inventoryConsequences: null,
      inventoryPreview: null
    }));

    expect(projection.consequences.commercial.evidenceState).toBe("available");
    expect(projection.consequences.inventory.evidenceState).toBe("blocked_by_integration");
    expect(projection.nextAction).toEqual({
      kind: "inventory_unavailable",
      label: "Inventory evidence unavailable",
      disabled: true
    });
  });

  test("keeps non-guest draft edits eligible for the governed commercial preview", () => {
    const projection = buildLivingCommercialTwinProjection(readyInput({
      proposedGuestCount: 125,
      draftDirty: true,
      previewRequested: false,
      commercialModel: null,
      inventoryConsequences: null,
      inventoryPreview: { state: "not_evaluated" }
    }));

    expect(projection).toMatchObject({
      state: "awaiting_preview",
      scenario: {
        guestDelta: 0,
        changed: false,
        proposalChanged: true
      },
      consequences: {
        commercial: { evidenceState: "not_yet_available" },
        inventory: {
          evidenceState: "not_applicable",
          applicability: "outside_guest_count_slice"
        }
      },
      reversibility: {
        changePending: true,
        canDiscardProposal: false,
        undoMode: "discard_unapplied_proposal"
      },
      nextAction: { kind: "preview_consequences", disabled: false }
    });
    expect(projection.state).toBe("awaiting_preview");

    const commerciallyCurrent = buildLivingCommercialTwinProjection(readyInput({
      proposedGuestCount: 125,
      draftDirty: true,
      commercialModel: commercialModel(125),
      inventoryConsequences: null,
      inventoryPreview: { state: "not_evaluated" }
    }));
    expect(commerciallyCurrent).toMatchObject({
      state: "partial",
      consequences: {
        commercial: { evidenceState: "available" },
        inventory: {
          evidenceState: "not_applicable",
          applicability: "outside_guest_count_slice"
        }
      }
    });
  });

  test("reports pending or incomplete inventory evidence as partial rather than current", () => {
    const pending = buildLivingCommercialTwinProjection(readyInput({
      inventoryConsequences: { state: "pending" },
      inventoryPreview: { state: "pending" }
    }));
    expect(pending.state).toBe("partial");
    expect(pending.consequences.inventory).toMatchObject({
      evidenceState: "not_yet_available",
      completenessState: "unavailable"
    });

    const incomplete = buildLivingCommercialTwinProjection(readyInput({
      inventoryConsequences: {
        ...inventoryConsequences(),
        cost: {
          state: "incomplete",
          before: { projectedCostMinor: null },
          proposedAfter: { projectedCostMinor: null },
          deltaMinor: null
        }
      }
    }));
    expect(incomplete.state).toBe("partial");
    expect(incomplete.consequences.inventory).toMatchObject({
      evidenceState: "available",
      completenessState: "partial",
      cost: { state: "incomplete", deltaMinor: null }
    });
  });

  test("represents an unchanged proposal and a versioned applied result without inventing consequences", () => {
    const unchanged = buildLivingCommercialTwinProjection(readyInput({
      proposedGuestCount: 125,
      commercialModel: commercialModel(125),
      inventoryConsequences: null
    }));
    expect(unchanged).toMatchObject({
      state: "unchanged",
      scenario: { guestDelta: 0, changed: false },
      consequences: {
        commercial: { evidenceState: "not_applicable" },
        inventory: { evidenceState: "not_applicable" },
        staffing: { evidenceState: "not_applicable" },
        beo: { evidenceState: "not_applicable" }
      },
      operationalConstraint: { evidenceState: "not_applicable" },
      reversibility: { state: "before_apply", canDiscardProposal: false, undoMode: "none" },
      nextAction: { kind: "no_change", disabled: true }
    });

    const applied = buildLivingCommercialTwinProjection(readyInput({
      appliedQuote: { id: "quote-1", activeVersionId: "version-15" },
      authorizationReceiptId: "authorization-1"
    }));
    expect(applied).toMatchObject({
      state: "applied",
      reversibility: {
        state: "versioned_after_apply",
        canDiscardProposal: false,
        currentRevisionPreserved: true,
        undoMode: "new_governed_version",
        appliedRevisionId: "version-15"
      },
      nextAction: { kind: "review_applied_revision", disabled: false }
    });
  });

  test("is stateless across rapid 175 to 150 to 160 scenario projections", () => {
    const scenarios = [175, 150, 160].map((guests) => buildLivingCommercialTwinProjection(readyInput({
      proposedGuestCount: guests,
      commercialModel: commercialModel(guests),
      inventoryEnabled: false,
      inventoryInputReady: false,
      inventoryConsequences: null,
      inventoryPreview: null
    })));

    expect(scenarios.map((projection) => projection.scenario.proposedGuestCount)).toEqual([175, 150, 160]);
    expect(scenarios.map((projection) => projection.scenario.guestDelta)).toEqual([50, 25, 35]);
    expect(scenarios.map((projection) => projection.consequences.commercial.total.proposedAfter))
      .toEqual([16_920, 14_700, 15_588]);
    expect(scenarios[2].consequences.commercial.total.proposedAfter).not.toBe(
      scenarios[0].consequences.commercial.total.proposedAfter
    );
    expect(scenarios.every((projection) => Object.isFrozen(projection))).toBe(true);
  });
});
