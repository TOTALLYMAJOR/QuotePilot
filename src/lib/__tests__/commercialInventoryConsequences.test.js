import { describe, expect, test } from "vitest";
import { buildCommercialInventoryConsequences } from "../commercialInventoryConsequences";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function projection(overrides = {}) {
  return {
    organizationId: "org-1",
    quoteId: "quote-1",
    quoteRevisionId: "version-4",
    eventRequirementRevisionId: "requirement-1",
    requirementRevision: 2,
    requirementDigest: DIGEST_A,
    projectionDigest: DIGEST_B,
    projectionVersion: "ingredient-event-projection-v1",
    freshness: "as_recorded",
    demandState: "complete",
    costState: "complete",
    availabilityState: "available",
    currency: "USD",
    projectedCostMinor: 8000,
    sourceRevisions: { recipeRevisionIds: ["recipe-1"], stockRevisions: [] },
    ingredients: [{
      ingredientId: "chicken",
      baseUnitId: "lb",
      requiredQuantityMicros: 20_000_000,
      availabilityState: "available",
      onHandQuantityMicros: 40_000_000,
      committedQuantityMicros: 0,
      availableToAllocateQuantityMicros: 40_000_000,
      shortageQuantityMicros: 0
    }],
    ...overrides
  };
}

function input(before = projection(), proposedAfter = projection(), overrides = {}) {
  return {
    organizationId: "org-1",
    quoteId: "quote-1",
    savedQuoteRevisionId: "version-4",
    scenarioFingerprint: '{"guests":100}',
    savedRead: { state: "recorded", sourceState: "current", projection: before },
    scenarioPreview: {
      state: "current",
      scenarioFingerprint: '{"guests":100}',
      projection: (() => {
        const { requirementRevision: _requirementRevision, ...previewProjection } = proposedAfter;
        return { ...previewProjection, freshness: "preview" };
      })()
    },
    ...overrides
  };
}

describe("buildCommercialInventoryConsequences", () => {
  test("returns immutable cost and per-unit availability deltas with exact provenance", () => {
    const result = buildCommercialInventoryConsequences(input(
      projection(),
      projection({
        eventRequirementRevisionId: "requirement-preview",
        requirementDigest: "c".repeat(64),
        projectionDigest: "d".repeat(64),
        projectedCostMinor: 11_000,
        availabilityState: "shortage",
        ingredients: [{
          ingredientId: "chicken",
          baseUnitId: "lb",
          requiredQuantityMicros: 45_000_000,
          availabilityState: "shortage",
          onHandQuantityMicros: 40_000_000,
          committedQuantityMicros: 0,
          availableToAllocateQuantityMicros: 40_000_000,
          shortageQuantityMicros: 5_000_000
        }, {
          ingredientId: "sauce",
          baseUnitId: "gal",
          requiredQuantityMicros: 2_000_000,
          availabilityState: "available",
          onHandQuantityMicros: 3_000_000,
          committedQuantityMicros: 0,
          availableToAllocateQuantityMicros: 3_000_000,
          shortageQuantityMicros: 0
        }]
      })
    ));
    expect(result).toMatchObject({
      state: "current",
      authority: "read_only_advisory",
      cost: { state: "changed", currency: "USD", deltaMinor: 3000 },
      availability: { state: "changed", beforeState: "available", proposedAfterState: "shortage" },
      provenance: {
        before: { quoteRevisionId: "version-4", requirementRevision: 2, requirementDigest: DIGEST_A },
        proposedAfter: { scenarioFingerprint: '{"guests":100}' }
      }
    });
    expect(result.availability.ingredients).toEqual([
      expect.objectContaining({ ingredientId: "chicken", baseUnitId: "lb", requiredDeltaMicros: 25_000_000, shortageDeltaMicros: 5_000_000 }),
      expect.objectContaining({ ingredientId: "sauce", baseUnitId: "gal", requiredDeltaMicros: 2_000_000, shortageDeltaMicros: null })
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.availability.ingredients[0])).toBe(true);
  });

  test("keeps cost unknown without blocking known availability", () => {
    const result = buildCommercialInventoryConsequences(input(
      projection({ costState: "partial", currency: undefined, projectedCostMinor: undefined }),
      projection({ costState: "unavailable", currency: undefined, projectedCostMinor: undefined })
    ));
    expect(result.cost).toMatchObject({ state: "incomplete", deltaMinor: null });
    expect(result.cost.before.projectedCostMinor).toBeNull();
    expect(result.availability.state).toBe("unchanged");
  });

  test("does not calculate a cost delta across unlike currencies", () => {
    const result = buildCommercialInventoryConsequences(input(
      projection({ currency: "USD" }),
      projection({ currency: "CAD", projectedCostMinor: 9000 })
    ));
    expect(result.cost).toMatchObject({ state: "currency_mismatch", deltaMinor: null });
    expect(result.availability.state).toBe("unchanged");
  });

  test.each([
    ["cached saved evidence", { savedRead: { state: "cached", sourceState: "cached", projection: projection() } }, "stale"],
    ["pending saved evidence", { savedRead: { state: "pending", sourceState: "pending", projection: projection() } }, "stale"],
    ["stale scenario fingerprint", { scenarioFingerprint: '{"guests":120}' }, "stale"],
    ["unavailable preview", { scenarioPreview: { state: "unavailable", projection: projection(), scenarioFingerprint: '{"guests":100}' } }, "unavailable"],
    ["cross-quote preview", { scenarioPreview: { state: "current", projection: projection({ quoteId: "quote-2" }), scenarioFingerprint: '{"guests":100}' } }, "mismatched"]
  ])("never treats %s as current", (_label, override, state) => {
    expect(buildCommercialInventoryConsequences(input(projection(), projection(), override))).toMatchObject({
      state,
      cost: { state: "unavailable", deltaMinor: null },
      availability: { state: "unavailable", ingredients: [] }
    });
  });
});
