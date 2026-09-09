// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import FulfillmentIntelligence from "../FulfillmentIntelligence";
import { buildFulfillmentProjection } from "../../lib/fulfillmentProjection";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const EVENT_WINDOW = Object.freeze({
  startAtISO: "2026-10-10T22:00:00.000Z",
  endAtISO: "2026-10-11T02:00:00.000Z"
});
const BEFORE_REQUIREMENT_DIGEST = "a".repeat(64);
const BEFORE_PROJECTION_DIGEST = "b".repeat(64);
const PROPOSED_REQUIREMENT_DIGEST = "c".repeat(64);
const PROPOSED_PROJECTION_DIGEST = "d".repeat(64);

function staffingPolicy() {
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
          { atGuestCount: 168, requiredCount: 7 }
        ]
      },
      chef: fixed(0),
      bartender: fixed(0)
    }
  };
}

function peopleEvidence() {
  const assignments = Array.from({ length: 6 }, (_, index) => ({
    staffId: `assigned-${index + 1}`,
    role: "server",
    state: "operator_confirmed"
  }));
  const availabilityWindows = [{
    source: "operator_recorded",
    state: "available",
    startAtISO: "2026-10-10T21:00:00.000Z",
    endAtISO: "2026-10-11T03:00:00.000Z"
  }];
  const profile = (staffId) => ({
    organizationId: "org-1",
    staffId,
    active: true,
    capabilities: ["server"],
    availabilityWindows,
    privateEmail: `${staffId}@private.example`,
    payrollRate: 9_999
  });
  return {
    state: "current",
    freshness: "current",
    organizationId: "org-1",
    quoteId: "quote-1",
    activeQuoteRevisionId: "quote-version-14",
    authorityVersion: "operational-staffing-authority-v1",
    observedAtISO: "2026-10-01T15:00:00.000Z",
    canonicalEventWindow: EVENT_WINDOW,
    canonicalRequirements: { lead: 0, server: 6, chef: 0, bartender: 0 },
    snapshot: { quoteRevisionId: "quote-version-14", planRevision: 4, assignments },
    profiles: [...assignments.map(({ staffId }) => profile(staffId)), profile("backup-1")],
    profilesTruncated: false,
    scheduleConflictEvidence: {
      state: "current",
      freshness: "current",
      completeness: "complete",
      organizationId: "org-1",
      quoteId: "quote-1",
      quoteRevisionId: "quote-version-14",
      eventWindow: EVENT_WINDOW,
      sourceRevisionId: "schedule-fences-9",
      entries: [{ staffId: "backup-1", state: "clear" }]
    }
  };
}

function supplyEvidence() {
  return {
    state: "current",
    freshness: "current",
    completeness: "complete",
    organizationId: "org-1",
    quoteId: "quote-1",
    quoteRevisionId: "quote-version-14",
    scenarioId: "scenario-175",
    sourceRevisions: {
      quoteRevisionId: "quote-version-14",
      scenarioFingerprint: "scenario-175",
      before: {
        organizationId: "org-1",
        quoteId: "quote-1",
        quoteRevisionId: "quote-version-14",
        eventRequirementRevisionId: "requirement-before-5",
        requirementRevision: 5,
        requirementDigest: BEFORE_REQUIREMENT_DIGEST,
        projectionDigest: BEFORE_PROJECTION_DIGEST,
        projectionVersion: "inventory-event-projection-v1",
        sourceFingerprint: "inventory-before-source-5"
      },
      proposedAfter: {
        organizationId: "org-1",
        quoteId: "quote-1",
        quoteRevisionId: "quote-version-14",
        eventRequirementRevisionId: "requirement-proposed-6",
        requirementDigest: PROPOSED_REQUIREMENT_DIGEST,
        projectionDigest: PROPOSED_PROJECTION_DIGEST,
        projectionVersion: "inventory-event-projection-v1",
        sourceFingerprint: "inventory-proposed-source-6",
        scenarioFingerprint: "scenario-175"
      }
    },
    current: {
      guestCount: 125,
      coverageState: "covered",
      shortages: [],
      projectedCost: { currency: "USD", amountMinor: 80_000 }
    },
    proposed: {
      guestCount: 175,
      coverageState: "shortage",
      shortages: [
        {
          resourceId: "chicken-breast",
          resourceLabel: "Chicken",
          shortageQuantityMicros: 5_000_000,
          unitId: "lb"
        },
        {
          resourceId: "tomatoes",
          resourceLabel: "Tomatoes",
          shortageQuantityMicros: 1_250_001,
          unitId: "kg"
        }
      ],
      projectedCost: { currency: "USD", amountMinor: 112_000 }
    },
    inventoryHeadroom: {
      state: "current",
      freshness: "current",
      sourceRevisionId: "inventory-headroom-2",
      scope: {
        organizationId: "org-1",
        quoteId: "quote-1",
        quoteRevisionId: "quote-version-14",
        scenarioId: "scenario-175"
      },
      basis: {
        before: {
          projectionDigest: BEFORE_PROJECTION_DIGEST,
          sourceFingerprint: "inventory-before-source-5"
        },
        proposedAfter: {
          projectionDigest: PROPOSED_PROJECTION_DIGEST,
          sourceFingerprint: "inventory-proposed-source-6",
          scenarioFingerprint: "scenario-175"
        }
      },
      currentGuestCount: 125,
      safeThroughGuestCount: 137,
      nextBoundary: {
        atGuestCount: 138,
        kind: "inventory_shortage",
        resourceId: "chicken-breast",
        resourceLabel: "Chicken"
      }
    }
  };
}

function fulfillmentProjection(overrides = {}) {
  return buildFulfillmentProjection({
    organizationId: "org-1",
    quoteId: "quote-1",
    quoteRevisionId: "quote-version-14",
    scenarioId: "scenario-175",
    currentGuestCount: 125,
    proposedGuestCount: 175,
    proposedRequirementsByRole: { lead: 0, server: 7, chef: 0, bartender: 0 },
    proposedRequirementsSource: "proposed_commercial_and_canonical_counts",
    people: peopleEvidence(),
    staffingPolicy: staffingPolicy(),
    supply: supplyEvidence(),
    ...overrides
  });
}

function livingProjection(fulfillment = fulfillmentProjection()) {
  return {
    schemaVersion: "living-commercial-twin-v1",
    authority: "presentation_only_projection",
    scenario: {
      currentGuestCount: 125,
      proposedGuestCount: 175
    },
    consequences: {
      inventory: {
        ingredients: [
          {
            ingredientId: "chicken-breast",
            requiredQuantityMicros: { proposedAfter: 35_000_000 },
            shortageQuantityMicros: { proposedAfter: 5_000_000 }
          },
          {
            ingredientId: "tomatoes",
            requiredQuantityMicros: { proposedAfter: 8_250_001 },
            shortageQuantityMicros: { proposedAfter: 1_250_001 }
          }
        ]
      }
    },
    fulfillment,
    privateCustomerNote: "do-not-render-customer-note",
    providerSecret: "sk_live_do_not_render"
  };
}

function decisionAnswer(overrides = {}) {
  return {
    schemaVersion: "fulfillment-decision-answer-v1",
    authority: "presentation_only_projection",
    state: "conditional",
    guestCount: 175,
    commercialReview: {
      evidenceState: "available",
      state: "authoritative_preview_available"
    },
    supplyConstraint: {
      evidenceState: "available",
      ingredientId: "chicken-breast",
      ingredientLabel: "Chicken breast",
      shortageQuantityMicros: 6_000_000,
      unitId: "lb",
      causalityState: "available",
      contributingMenuItems: [{
        menuItemId: "chicken-alfredo",
        label: "Chicken Alfredo",
        selectionId: "chicken-alfredo"
      }]
    },
    sourcingResolution: {
      evidenceState: "available",
      selectionState: "unique_policy_match",
      supplierId: "supplier-b",
      supplierLabel: "Supplier B",
      ingredientId: "chicken-breast",
      unitId: "lb",
      coverageQuantityMicros: 6_000_000,
      purchaseQuantityMicros: 6_000_000,
      addedCostMinor: 1_800,
      currency: "USD",
      policyRevisionId: "sourcing-policy-7",
      offerRevisionId: "supplier-b-offer-12",
      conditions: ["Confirm delivery before the prep window"]
    },
    commercialValue: {
      evidenceState: "available",
      kind: "proposed_quote_total",
      amount: 17_472,
      currency: "USD",
      authority: "server_authoritative"
    },
    staffing: {
      evidenceState: "available",
      effect: "current_assignments_cover_proposed_requirement",
      assignmentGap: 0,
      requirementDeltaByRole: [],
      reviewEffect: "no_declared_dependency"
    },
    beo: {
      evidenceState: "available",
      effect: "stale",
      dependentNodeIds: ["beo-1"]
    },
    ...overrides
  };
}

function decisionProjection(answer = decisionAnswer()) {
  const source = livingProjection();
  return { ...source, decisionAnswer: answer };
}

const ACTIVE_SCENARIO = Object.freeze({
  scenarioId: "scenario-175",
  generation: 2,
  guestCount: 175
});

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function renderPresenter(props = {}) {
  act(() => root.render(
    <FulfillmentIntelligence
      projection={livingProjection()}
      activeScenario={ACTIVE_SCENARIO}
      {...props}
    />
  ));
}

function button(label) {
  return [...container.querySelectorAll("button")]
    .find((entry) => entry.textContent.trim() === label);
}

describe("FulfillmentIntelligence", () => {
  test("renders an evidence-bounded 175 guest decision answer across Supply, Staffing, Commercial, and BEO", () => {
    act(() => root.render(
      <FulfillmentIntelligence
        projection={decisionProjection()}
        activeScenario={ACTIVE_SCENARIO}
      />
    ));

    const surface = container.querySelector('[data-capability-id="living-commercial-twin-fulfillment"]');
    const answer = surface.querySelector('[data-decision-state="conditional"]');
    expect(answer.getAttribute("data-sourcing-state")).toBe("unique_policy_match");
    expect(answer.textContent).toContain("175 guests is conditionally supportable");
    expect(answer.textContent).toContain("Chicken Alfredo leaves Chicken breast 6 lb short.");
    expect(answer.textContent).toContain("Policy-selected current option: purchase 6 lb from Supplier B.");
    expect(answer.textContent).toContain("Proposed quote total: $17,472.00");
    expect(answer.textContent).toContain("Quoted value, not earned revenue or a guaranteed amount preserved.");
    expect(answer.textContent).toContain("BEO review is required.");
    expect(answer.textContent).toContain("Current assignments cover the proposed staffing requirement.");
    expect(answer.textContent).toContain("Inventory remains short until received stock is recorded");
    expect(answer.textContent).not.toContain("You can accept");
    expect(answer.textContent).not.toContain("Revenue preserved");
    expect(surface.querySelector('[data-domain="supply"]').textContent).toContain("Working coverageShortage");
  });

  test("keeps sourcing and menu attribution visibly unavailable instead of inventing a resolution", () => {
    const partial = decisionAnswer({
      state: "unverifiable",
      supplyConstraint: {
        evidenceState: "available",
        ingredientId: "chicken-breast",
        ingredientLabel: "Chicken breast",
        shortageQuantityMicros: 6_000_000,
        unitId: "lb",
        causalityState: "not_yet_available",
        contributingMenuItems: []
      },
      sourcingResolution: {
        evidenceState: "not_yet_available",
        selectionState: "none",
        supplierId: null,
        supplierLabel: null,
        conditions: []
      },
      staffing: {
        evidenceState: "partial",
        effect: "unverified",
        assignmentGap: null,
        requirementDeltaByRole: [],
        reviewEffect: null
      }
    });
    act(() => root.render(
      <FulfillmentIntelligence
        projection={decisionProjection(partial)}
        activeScenario={ACTIVE_SCENARIO}
      />
    ));

    const answer = container.querySelector('[data-decision-state="unverifiable"]');
    expect(answer.getAttribute("data-sourcing-state")).toBe("none");
    expect(answer.textContent).toContain("175 guests is not yet verifiable");
    expect(answer.textContent).toContain("At 175 guests, Chicken breast is 6 lb short. Exact menu attribution is not available.");
    expect(answer.textContent).toContain("A preferred resolution is not yet evidenced. Review Inventory.");
    expect(answer.textContent).toContain("The staffing effect is not yet verified.");
    expect(answer.textContent).not.toContain("Supplier B");
    expect(answer.textContent).not.toContain("Chicken Alfredo");
  });

  test("separates purchasable quantity from the amount that covers the shortfall", () => {
    const exact = decisionAnswer();
    const packaged = decisionAnswer({
      sourcingResolution: {
        ...exact.sourcingResolution,
        purchaseQuantityMicros: 10_000_000
      }
    });
    act(() => root.render(
      <FulfillmentIntelligence
        projection={decisionProjection(packaged)}
        activeScenario={ACTIVE_SCENARIO}
      />
    ));

    const answer = container.querySelector('[data-decision-state="conditional"]');
    expect(answer.textContent).toContain(
      "Policy-selected current option: purchase 10 lb from Supplier B; 6 lb covers this shortfall."
    );
    expect(answer.textContent).not.toContain("purchase 6 lb from Supplier B");
  });

  test("withholds retained decision claims and actions until the exact active scenario returns", () => {
    const onOpenInventory = vi.fn();
    const onOpenStaffing = vi.fn();
    act(() => root.render(
      <FulfillmentIntelligence
        projection={decisionProjection()}
        activeScenario={{ ...ACTIVE_SCENARIO, guestCount: 180 }}
        retained
        onOpenInventory={onOpenInventory}
        onOpenStaffing={onOpenStaffing}
      />
    ));

    const answer = container.querySelector('[data-decision-state="stale"]');
    expect(answer.getAttribute("data-sourcing-state")).toBe("withheld");
    expect(answer.textContent).toContain("Current answer withheld");
    expect(answer.textContent).toContain("do not apply to the active scenario");
    expect(answer.textContent).not.toContain("Supplier B");
    expect(answer.textContent).not.toContain("$17,472.00");
    expect(answer.textContent).not.toContain("Current assignments cover");
    expect(answer.querySelectorAll("button")).toHaveLength(0);
  });

  test("presents exact synthesis, domain detail, every shortage, ordered constraints, and source revisions", () => {
    const onToggleConstraint = vi.fn();
    const onUseSafeThrough = vi.fn();
    const onOpenStaffing = vi.fn();
    const onOpenInventory = vi.fn();
    const source = livingProjection();

    act(() => root.render(
      <FulfillmentIntelligence
        projection={source}
        activeScenario={ACTIVE_SCENARIO}
        constraintOpen={false}
        onToggleConstraint={onToggleConstraint}
        onUseSafeThrough={onUseSafeThrough}
        onOpenStaffing={onOpenStaffing}
        onOpenInventory={onOpenInventory}
      />
    ));

    const markers = container.querySelectorAll('[data-capability-id="living-commercial-twin-fulfillment"]');
    expect(markers).toHaveLength(1);
    const surface = markers[0];
    expect(surface.matches(".csw-consequence-rail.fulfillment-intelligence")).toBe(true);
    expect(surface.getAttribute("data-authority")).toBe("presentation-only");
    expect(surface.getAttribute("data-capability-state")).toBe("success");
    expect(surface.getAttribute("data-projection-state")).toBe("complete");
    expect(surface.textContent).toContain("Overall guest-count headroomCurrent+12 guestsChicken is the limiting constraint");
    expect(surface.textContent).toContain("People boundary+42 guestsCurrent");
    expect(surface.textContent).toContain("Supply boundary+12 guestsCurrent");
    expect(surface.textContent).toContain("Current coverage6 / 6Required roles assigned");
    expect(surface.textContent).toContain("Working need6 current / 7 required");
    expect(surface.textContent).toContain("Servers6 / 66 current / 7 required1");
    expect(surface.textContent).toContain("2 proposed shortages");
    expect(surface.textContent).toContain("Chicken5 lb");
    expect(surface.textContent).toContain("Tomatoes1.250001 kg");
    expect(surface.textContent).not.toContain("5000000 lb");
    expect(surface.textContent).toContain("$1,120.00");

    const constraints = [...surface.querySelectorAll(".fulfillment-intelligence__constraints > li")];
    expect(constraints.map((entry) => entry.getAttribute("data-rank"))).toEqual(["1", "2", "3"]);
    expect(constraints.map((entry) => entry.textContent)).toEqual([
      expect.stringContaining("Chicken"),
      expect.stringContaining("Servers"),
      expect.stringContaining("Tomatoes")
    ]);
    expect(surface.textContent).toContain("quote-version-14");
    expect(surface.textContent).toContain("staffing-policy-3 · revision 3");
    expect(surface.textContent).toContain("requirement-before-5");
    expect(surface.textContent).toContain("requirement-proposed-6");
    expect(surface.textContent).toContain("inventory-headroom-2");
    expect(surface.textContent).not.toContain("private.example");
    expect(surface.textContent).not.toContain("payrollRate");
    expect(surface.textContent).not.toContain("do-not-render-customer-note");
    expect(surface.textContent).not.toContain("sk_live_do_not_render");

    act(() => button("Review staffing in event").click());
    act(() => button("Review inventory evidence").click());
    act(() => surface.querySelector(".csw-constraint-trigger").click());
    expect(onOpenStaffing).toHaveBeenCalledOnce();
    expect(onOpenInventory).toHaveBeenCalledOnce();
    expect(onToggleConstraint).toHaveBeenCalledOnce();
    expect(onUseSafeThrough).not.toHaveBeenCalled();

    act(() => root.render(
      <FulfillmentIntelligence
        projection={source}
        activeScenario={ACTIVE_SCENARIO}
        constraintOpen
        onToggleConstraint={onToggleConstraint}
        onUseSafeThrough={onUseSafeThrough}
        onOpenStaffing={onOpenStaffing}
        onOpenInventory={onOpenInventory}
      />
    ));
    expect(container.querySelector(".csw-constraint-explanation").textContent)
      .toContain("Declared demand is 35 lb. The recorded shortfall is 5 lb.");
    expect(container.querySelector(".csw-constraint-explanation").textContent)
      .toContain("safe through 137 guests; the first failing boundary is 138");
    act(() => button("Try 137 guests").click());
    expect(onUseSafeThrough).toHaveBeenCalledExactlyOnceWith(137);
    expect(source.fulfillment.scenario.proposedGuestCount).toBe(175);
  });

  test("keeps missing boundary evidence unknown instead of converting it to zero", () => {
    const fulfillment = fulfillmentProjection({
      staffingPolicy: null,
      proposedRequirementsByRole: { lead: 0, server: 6, chef: 0, bartender: 0 }
    });
    act(() => root.render(
      <FulfillmentIntelligence
        projection={livingProjection(fulfillment)}
        activeScenario={ACTIVE_SCENARIO}
      />
    ));

    const surface = container.querySelector('[data-capability-id="living-commercial-twin-fulfillment"]');
    expect(surface.getAttribute("data-capability-state")).toBe("partial");
    expect(surface.textContent).toContain("Overall guest-count headroomMissingNot verified");
    expect(surface.textContent).toContain("People boundaryNot verifiedMissing");
    expect(surface.textContent).toContain("Missing or partial evidence is not a zero-capacity conclusion.");
    expect(surface.textContent).not.toContain("+0 guests");
    expect(surface.textContent).not.toContain("0 guests");
  });

  test("names contradictory, schema-drift, not-yet-available, and not-applicable evidence literally", () => {
    const exact = fulfillmentProjection();
    const stateful = {
      ...exact,
      state: "partial",
      fulfillmentHeadroom: { state: "not_yet_available", evidenceState: "not_yet_available" },
      people: {
        ...exact.people,
        evidenceState: "contradictory",
        completeness: "partial",
        staffingHeadroom: { state: "schema_drift", evidenceState: "schema_drift" },
        resilience: { evidenceState: "not_yet_available" }
      },
      supply: {
        ...exact.supply,
        evidenceState: "not_applicable",
        completeness: "partial",
        inventoryHeadroom: { state: "not_applicable", evidenceState: "not_applicable" },
        proposed: {
          ...exact.supply.proposed,
          projectedCost: { state: "not_yet_available", currency: null, amountMinor: null }
        }
      }
    };
    act(() => root.render(
      <FulfillmentIntelligence
        projection={livingProjection(stateful)}
        activeScenario={ACTIVE_SCENARIO}
      />
    ));

    const surface = container.querySelector('[data-capability-id="living-commercial-twin-fulfillment"]');
    expect(surface.textContent).toContain("Not yet available");
    expect(surface.textContent).toContain("Contradictory");
    expect(surface.textContent).toContain("People boundaryNot verifiedSchema drift");
    expect(surface.textContent).toContain("Not yet available · backup capacity not verified");
    expect(surface.textContent).toContain("Not applicable");
    expect(surface.textContent).toContain("Not yet available · cost evidence is not usable");
  });

  test("exposes loading, retained, and refresh behavior through caller-owned state and callbacks", () => {
    const exact = fulfillmentProjection();
    const stalePeople = {
      ...exact,
      people: { ...exact.people, freshness: "stale" }
    };
    const onRefreshStaffing = vi.fn();

    act(() => root.render(
      <FulfillmentIntelligence
        projection={livingProjection(stalePeople)}
        activeScenario={ACTIVE_SCENARIO}
        updating
        onRefreshStaffing={onRefreshStaffing}
      />
    ));
    let surface = container.querySelector('[data-capability-id="living-commercial-twin-fulfillment"]');
    expect(surface.getAttribute("data-capability-state")).toBe("loading");
    expect(surface.getAttribute("aria-busy")).toBe("true");
    expect(surface.textContent).toContain("Updating");
    act(() => button("Refresh People evidence").click());
    expect(onRefreshStaffing).toHaveBeenCalledOnce();

    act(() => root.render(
      <FulfillmentIntelligence
        projection={livingProjection(stalePeople)}
        activeScenario={ACTIVE_SCENARIO}
        updating
        retained
        onRefreshStaffing={onRefreshStaffing}
      />
    ));
    surface = container.querySelector('[data-capability-id="living-commercial-twin-fulfillment"]');
    expect(surface.getAttribute("data-capability-state")).toBe("stale");
    expect(surface.getAttribute("aria-busy")).toBe("true");
    expect(surface.textContent).toContain("Retained · not current");
  });
});
