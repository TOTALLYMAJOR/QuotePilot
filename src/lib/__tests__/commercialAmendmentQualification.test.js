import { describe, expect, test } from "vitest";
import {
  COMMERCIAL_CHANGE_IMPACT_AUTHORITY,
  COMMERCIAL_CHANGE_IMPACT_FACT_NODE_IDS,
  COMMERCIAL_CHANGE_IMPACT_SNAPSHOT_SCHEMA_VERSION,
  COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS,
  simulateCommercialChangeImpact
} from "../commercialChangeImpact";
import { buildCommercialInventoryConsequences } from "../commercialInventoryConsequences";
import {
  buildUnifiedCommercialConsequenceReview,
  unifiedConsequenceFenceCurrent
} from "../unifiedCommercialConsequenceReview";

const identity = Object.freeze({
  organizationId: "org-qualification",
  quoteId: "quote-amendment",
  beforeRevisionId: "revision-7",
  proposedRevisionId: "revision-8-preview"
});

function facts(revisionId, overrides = {}) {
  return {
    ...Object.fromEntries(COMMERCIAL_CHANGE_IMPACT_FACT_NODE_IDS.map((nodeId) => [nodeId, null])),
    "fact.quote.identity": { organizationId: identity.organizationId, quoteId: identity.quoteId },
    "fact.quote.active_revision": revisionId,
    "fact.quote.accepted_revision": "revision-7",
    "fact.event.guest_count": 100,
    "fact.selection.menu": ["menu-pasta"],
    ...overrides
  };
}

function snapshot(role, factOverrides = {}) {
  const before = role === "before";
  const revisionId = before ? identity.beforeRevisionId : identity.proposedRevisionId;
  return {
    schemaVersion: COMMERCIAL_CHANGE_IMPACT_SNAPSHOT_SCHEMA_VERSION,
    source: {
      label: before
        ? COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.before
        : COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.proposedAfter,
      authority: COMMERCIAL_CHANGE_IMPACT_AUTHORITY,
      organizationId: identity.organizationId,
      quoteId: identity.quoteId,
      revisionId
    },
    facts: facts(identity.beforeRevisionId, factOverrides),
    pricing: {
      sourceLabel: before
        ? COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.beforePricing
        : COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.proposedAfterPricing,
      authority: COMMERCIAL_CHANGE_IMPACT_AUTHORITY,
      currency: "USD",
      authoritativeTotal: before ? 10_000 : 12_500,
      depositRequirement: before ? 2_500 : 3_125
    },
    protectedEvidence: {
      lifecycle: { state: "accepted" },
      provider: null,
      payment: null,
      portal: null,
      booking: null
    }
  };
}

function contribution(menuItemId, recipeRevisionId, quantityMicros) {
  return {
    selectionId: `selection-${menuItemId}`,
    menuItemId,
    recipeRevisionId,
    recipeDigest: "e".repeat(64),
    exactRequiredQuantityMicros: { numerator: String(quantityMicros), denominator: "1" },
    commercialProvenance: { kind: "direct", sourceId: menuItemId }
  };
}

function inventoryProjection({
  quoteRevisionId = identity.beforeRevisionId,
  freshness = "as_recorded",
  persisted = true,
  requirementRevision = 4,
  requirementDigest = "a".repeat(64),
  projectionDigest = "b".repeat(64),
  projectedCostMinor = 4_000,
  costState = "complete",
  ingredient = {}
} = {}) {
  const quantity = ingredient.requiredQuantityMicros ?? 20_000_000;
  return {
    organizationId: identity.organizationId,
    quoteId: identity.quoteId,
    quoteRevisionId,
    eventRequirementRevisionId: `requirement-${requirementRevision}`,
    ...(persisted ? { requirementRevision } : {}),
    requirementDigest,
    projectionDigest,
    projectionVersion: "ingredient-event-projection-v1",
    freshness,
    demandState: "complete",
    costState,
    availabilityState: ingredient.availabilityState || "available",
    currency: costState === "complete" ? "USD" : undefined,
    projectedCostMinor: costState === "complete" ? projectedCostMinor : undefined,
    sourceRevisions: {
      recipeRevisionIds: [ingredient.recipeRevisionId || "recipe-pasta-7"],
      stockRevisions: []
    },
    ingredients: [{
      ingredientId: "ingredient-chicken",
      baseUnitId: "lb",
      requiredQuantityMicros: quantity,
      availabilityState: ingredient.availabilityState || "available",
      onHandQuantityMicros: 40_000_000,
      committedQuantityMicros: 0,
      availableToAllocateQuantityMicros: 40_000_000,
      shortageQuantityMicros: ingredient.shortageQuantityMicros ?? 0,
      contributions: [contribution(
        ingredient.menuItemId || "menu-pasta",
        ingredient.recipeRevisionId || "recipe-pasta-7",
        quantity
      )]
    }]
  };
}

function inventoryInput(before, proposedAfter, overrides = {}) {
  return {
    organizationId: identity.organizationId,
    quoteId: identity.quoteId,
    savedQuoteRevisionId: identity.beforeRevisionId,
    proposedQuoteRevisionId: identity.proposedRevisionId,
    scenarioFingerprint: "scenario-guest-150",
    savedRead: { state: "recorded", sourceState: "current", projection: before },
    scenarioPreview: {
      state: "current",
      scenarioFingerprint: "scenario-guest-150",
      projection: proposedAfter
    },
    ...overrides
  };
}

describe("commercial amendment cross-domain qualification", () => {
  test("guest-count growth exposes exact staffing, BEO, ingredient, and shortage consequences without applying them", () => {
    const commercial = simulateCommercialChangeImpact({
      identity,
      beforeSnapshot: snapshot("before"),
      proposedAfterSnapshot: snapshot("proposed", { "fact.event.guest_count": 150 })
    });
    const inventory = buildCommercialInventoryConsequences(inventoryInput(
      inventoryProjection(),
      inventoryProjection({
        quoteRevisionId: identity.proposedRevisionId,
        freshness: "preview",
        persisted: false,
        requirementDigest: "c".repeat(64),
        projectionDigest: "d".repeat(64),
        projectedCostMinor: 5_500,
        ingredient: {
          requiredQuantityMicros: 50_000_000,
          availabilityState: "shortage",
          shortageQuantityMicros: 10_000_000
        }
      })
    ));

    expect(commercial.impact.dependentNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "artifact.kitchen_beo", advisoryClass: "STALE" }),
      expect.objectContaining({ id: "output.plan.staffing_requirement", advisoryClass: "REVIEW" })
    ]));
    expect(inventory).toMatchObject({
      authority: "read_only_advisory",
      state: "current",
      availability: { proposedAfterState: "shortage" }
    });
    expect(inventory.availability.ingredients[0]).toMatchObject({
      ingredientId: "ingredient-chicken",
      requiredDeltaMicros: 30_000_000,
      shortageDeltaMicros: 10_000_000
    });
  });

  test("a menu swap retains exact selection and recipe identities instead of collapsing demand into a total", () => {
    const commercial = simulateCommercialChangeImpact({
      identity,
      beforeSnapshot: snapshot("before"),
      proposedAfterSnapshot: snapshot("proposed", { "fact.selection.menu": ["menu-chicken"] })
    });
    const inventory = buildCommercialInventoryConsequences(inventoryInput(
      inventoryProjection(),
      inventoryProjection({
        quoteRevisionId: identity.proposedRevisionId,
        freshness: "preview",
        persisted: false,
        requirementDigest: "c".repeat(64),
        projectionDigest: "d".repeat(64),
        ingredient: {
          menuItemId: "menu-chicken",
          recipeRevisionId: "recipe-chicken-9",
          requiredQuantityMicros: 24_000_000
        }
      })
    ));

    expect(commercial.factDiffs).toContainEqual(expect.objectContaining({ nodeId: "fact.selection.menu" }));
    expect(inventory.availability.ingredients[0].proposedAfter.contributions[0]).toMatchObject({
      selectionId: "selection-menu-chicken",
      menuItemId: "menu-chicken",
      recipeRevisionId: "recipe-chicken-9"
    });
  });

  test("stale recipe evidence and partial cost remain explicit while known stock stays independently usable", () => {
    const stale = buildCommercialInventoryConsequences(inventoryInput(
      inventoryProjection({ ingredient: { recipeRevisionId: "recipe-old" } }),
      inventoryProjection({
        quoteRevisionId: identity.proposedRevisionId,
        freshness: "preview",
        persisted: false,
        requirementDigest: "c".repeat(64),
        projectionDigest: "d".repeat(64)
      }),
      { savedRead: { state: "recorded", sourceState: "stale", projection: inventoryProjection({ ingredient: { recipeRevisionId: "recipe-old" } }) } }
    ));
    expect(stale).toMatchObject({
      state: "stale",
      cost: { state: "unavailable" },
      availability: { state: "unavailable" },
      issues: ["saved_projection_not_server_current"]
    });

    const partialCost = buildCommercialInventoryConsequences(inventoryInput(
      inventoryProjection({ costState: "partial" }),
      inventoryProjection({
        quoteRevisionId: identity.proposedRevisionId,
        freshness: "preview",
        persisted: false,
        requirementDigest: "c".repeat(64),
        projectionDigest: "d".repeat(64),
        costState: "unavailable"
      })
    ));
    expect(partialCost.cost).toMatchObject({ state: "incomplete", deltaMinor: null });
    expect(partialCost.availability.state).toBe("unchanged");
  });

  test("concurrent quote, catalog, or scenario changes invalidate the exact reviewed fence", () => {
    const commercial = simulateCommercialChangeImpact({
      identity,
      beforeSnapshot: snapshot("before"),
      proposedAfterSnapshot: snapshot("proposed", { "fact.event.guest_count": 150 })
    });
    const review = buildUnifiedCommercialConsequenceReview({ model: commercial, catalogRevision: 12 });
    expect(unifiedConsequenceFenceCurrent(review, {
      quoteRevisionId: "revision-8-other",
      proposedRevisionId: identity.proposedRevisionId,
      catalogRevision: 12
    })).toBe(false);
    expect(unifiedConsequenceFenceCurrent(review, {
      quoteRevisionId: identity.beforeRevisionId,
      proposedRevisionId: identity.proposedRevisionId,
      catalogRevision: 13
    })).toBe(false);

    const staleScenario = buildCommercialInventoryConsequences(inventoryInput(
      inventoryProjection(),
      inventoryProjection({
        quoteRevisionId: identity.proposedRevisionId,
        freshness: "preview",
        persisted: false,
        requirementDigest: "c".repeat(64),
        projectionDigest: "d".repeat(64)
      }),
      { scenarioFingerprint: "scenario-changed" }
    ));
    expect(staleScenario).toMatchObject({
      state: "stale",
      issues: ["scenario_fingerprint_changed"]
    });
  });
});
