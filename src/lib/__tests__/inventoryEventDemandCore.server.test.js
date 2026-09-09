import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const ingredientCore = require("../../../functions/inventoryIngredientCore.cjs");
const recipeCore = require("../../../functions/inventoryRecipeCore.cjs");
const demandCore = require("../../../functions/inventoryEventDemandCore.cjs");

const ORG = "org-smith";
const NOW = "2026-09-09T08:30:00.000Z";
const REQUIRED_BY = "2026-09-20T16:00:00.000Z";
const ACTOR = { uid: "admin-1", email: "admin@example.test", role: "admin", organizationId: ORG };

function ingredient(ingredientId, baseUnitId = "lb") {
  return ingredientCore.planIngredient({
    organizationId: ORG,
    request: {
      kind: "upsert_ingredient",
      ingredientId,
      name: ingredientId,
      category: "Food",
      baseUnitId,
      active: true,
      expectedRevision: 0
    },
    actor: ACTOR,
    nowISO: NOW
  }).ingredient;
}

function costState(item, basisQuantity, totalCostMinor) {
  return ingredientCore.planIngredientCostEvidence({
    organizationId: ORG,
    requestId: `cost-${item.ingredientId}`,
    request: {
      kind: "record_ingredient_cost",
      ingredientId: item.ingredientId,
      baseUnitId: item.baseUnitId,
      availability: "available",
      basisQuantity,
      totalCostMinor,
      currency: "USD",
      sourceLabel: "Recorded purchase",
      observedAtISO: NOW,
      note: "Exact fixture",
      expectedCostRevision: 0
    },
    ingredient: item,
    actor: ACTOR,
    nowISO: NOW
  }).nextCostState;
}

function stockState(item, quantity, locationId = "main-kitchen") {
  const location = ingredientCore.planLocation({
    organizationId: ORG,
    request: { kind: "upsert_location", locationId, name: "Main kitchen", active: true, expectedRevision: 0 },
    actor: ACTOR,
    nowISO: NOW
  }).location;
  return ingredientCore.planOpeningBalance({
    organizationId: ORG,
    requestId: `opening-${item.ingredientId}-${locationId}`,
    request: {
      kind: "opening_balance",
      ingredientId: item.ingredientId,
      locationId,
      quantity,
      baseUnitId: item.baseUnitId,
      occurredAtISO: NOW,
      note: "Fixture opening balance",
      expectedStockRevision: 0
    },
    ingredient: item,
    location,
    stockState: null,
    actor: ACTOR,
    nowISO: NOW
  }).nextStockState;
}

function recipe(menuItemId, lines, revision = 1) {
  return recipeCore.createRecipeRevision({
    organizationId: ORG,
    menuItemId,
    revision,
    priorRecipeRevisionId: "",
    outputYield: "10",
    outputUnitId: "portion",
    lines: lines.map(({ lineId, ingredientId, quantity, unitId = "lb" }) => ({
      lineId,
      ingredientId,
      quantity,
      unitKind: "standard",
      quantityBasis: "as_purchased",
      usableYield: null,
      unitId
    })),
    publishedAtISO: NOW
  });
}

function recipeCost(recipeRevision, ingredients, costStates) {
  return recipeCore.calculateRecipeCost({ recipeRevision, ingredients, costStates });
}

function selection(menuItemId, recipeRevisionId, quantity = "100", overrides = {}) {
  return {
    selectionId: `selection-${menuItemId}`,
    menuItemId,
    recipeRevisionId,
    requiredOutputQuantity: quantity,
    outputUnitId: "portion",
    portionBasis: { kind: "explicit_output_quantity", evidenceId: menuItemId },
    commercialProvenance: { kind: "direct", sourceId: menuItemId },
    ...overrides
  };
}

function allocation(item, quantity = "25", overrides = {}) {
  return {
    allocationId: `allocation-${item.ingredientId}`,
    organizationId: ORG,
    eventPlanId: "event-on-another-day",
    ingredientId: item.ingredientId,
    locationId: "main-kitchen",
    baseUnitId: item.baseUnitId,
    quantityMicros: ingredientCore.parseQuantityMicros(quantity),
    revision: 1,
    sourceRequirementRevisionId: "eir-other-event",
    ...overrides
  };
}

function ownerFixture(overrides = {}) {
  const chicken = ingredient("chicken");
  const pasta = ingredient("pasta");
  const entree = recipe("menu-chicken-pasta", [
    { lineId: "chicken-line", ingredientId: "chicken", quantity: "2" },
    { lineId: "pasta-line", ingredientId: "pasta", quantity: "1" }
  ]);
  const costs = [costState(chicken, "40", 12_000), costState(pasta, "30", 6_000)];
  const input = {
    organizationId: ORG,
    quoteId: "quote-smith-wedding",
    quoteRevisionId: "v0017",
    requiredByISO: REQUIRED_BY,
    selections: [selection(entree.menuItemId, entree.recipeRevisionId)],
    recipeRevisions: [entree],
    recipeCostResults: [recipeCost(entree, [chicken, pasta], costs)],
    stockStates: [stockState(chicken, "40"), stockState(pasta, "30")],
    activeAllocations: [],
    excludedPlanId: "",
    ...overrides
  };
  return { chicken, pasta, entree, costs, input };
}

describe("pure ingredient event demand and costing", () => {
  test("fails before Firestore writes when a bounded document exceeds its byte budget", () => {
    expect(() => demandCore.assertFirestoreDocumentSize({
      payload: "x".repeat(demandCore.MAX_EVENT_DOCUMENT_BYTES)
    }, "oversized event evidence")).toThrow(/bounded Firestore document size/i);
  });

  test("compiles the 100-portion owner fixture to 20 lb chicken, 10 lb pasta, and $80", () => {
    const { input } = ownerFixture();
    const result = demandCore.compileEventIngredientDemand(input);

    expect(result.requirementRevision).toMatchObject({
      organizationId: ORG,
      quoteId: "quote-smith-wedding",
      quoteRevisionId: "v0017",
      demandState: "complete",
      costState: "complete",
      currency: "USD",
      projectedCostMinor: 8_000,
      coverage: {
        selectedMenuItemCount: 1,
        compiledMenuItemCount: 1,
        ingredientCount: 2,
        costedIngredientCount: 2
      }
    });
    expect(result.requirementRevision.ingredients).toEqual([
      expect.objectContaining({
        ingredientId: "chicken",
        baseUnitId: "lb",
        requiredQuantityMicros: 20_000_000,
        projectedCostMinor: 6_000
      }),
      expect.objectContaining({
        ingredientId: "pasta",
        baseUnitId: "lb",
        requiredQuantityMicros: 10_000_000,
        projectedCostMinor: 2_000
      })
    ]);
    expect(result.projection).toMatchObject({
      demandState: "complete",
      costState: "complete",
      availabilityState: "available",
      projectedCostMinor: 8_000
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.projection.ingredients[0].contributions[0])).toBe(true);
    expect(demandCore.verifyEventIngredientRequirement(result.requirementRevision)).toBe(result.requirementRevision);
    expect(demandCore.verifyEventIngredientProjection(result.projection)).toBe(result.projection);
  });

  test("counts active consumable allocations across dates without reducing physical on-hand", () => {
    const fixture = ownerFixture();
    const result = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      activeAllocations: [allocation(fixture.chicken, "25")]
    });
    const chicken = result.projection.ingredients.find(({ ingredientId }) => ingredientId === "chicken");
    expect(chicken).toMatchObject({
      onHandQuantityMicros: 40_000_000,
      committedQuantityMicros: 25_000_000,
      availableToAllocateQuantityMicros: 15_000_000,
      shortageQuantityMicros: 5_000_000,
      availabilityState: "shortage"
    });
    expect(result.projection.availabilityState).toBe("shortage");
    expect(result.requirementRevision).not.toHaveProperty("activeAllocations");
  });

  test("excludes the target plan hold only when explicitly requested", () => {
    const fixture = ownerFixture();
    const held = allocation(fixture.chicken, "25", { eventPlanId: fixture.input.quoteId });
    const included = demandCore.compileEventIngredientDemand({ ...fixture.input, activeAllocations: [held] });
    const excluded = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      activeAllocations: [held],
      excludedPlanId: fixture.input.quoteId
    });
    expect(included.projection.availabilityState).toBe("shortage");
    expect(excluded.projection.availabilityState).toBe("available");
  });

  test("aggregates a shared ingredient while retaining deterministic per-menu provenance", () => {
    const fixture = ownerFixture();
    const side = recipe("menu-chicken-side", [
      { lineId: "side-chicken", ingredientId: "chicken", quantity: "1" }
    ]);
    const sideCost = recipeCost(side, [fixture.chicken], [fixture.costs[0]]);
    const result = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      selections: [
        selection(side.menuItemId, side.recipeRevisionId, "20"),
        ...fixture.input.selections
      ],
      recipeRevisions: [side, fixture.entree],
      recipeCostResults: [sideCost, ...fixture.input.recipeCostResults]
    });
    const chicken = result.requirementRevision.ingredients.find(({ ingredientId }) => ingredientId === "chicken");
    expect(chicken.requiredQuantityMicros).toBe(22_000_000);
    expect(chicken.projectedCostMinor).toBe(6_600);
    expect(chicken.contributions.map(({ menuItemId }) => menuItemId)).toEqual([
      "menu-chicken-pasta",
      "menu-chicken-side"
    ]);
  });

  test("portion changes produce exact deltas without mutating the earlier requirement", () => {
    const fixture = ownerFixture();
    const before = demandCore.compileEventIngredientDemand(fixture.input);
    const after = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      quoteRevisionId: "v0018",
      selections: [selection(fixture.entree.menuItemId, fixture.entree.recipeRevisionId, "175")]
    });
    expect(before.requirementRevision.ingredients[0].requiredQuantityMicros).toBe(20_000_000);
    expect(after.requirementRevision.ingredients[0].requiredQuantityMicros).toBe(35_000_000);
    expect(after.requirementRevision.projectedCostMinor - before.requirementRevision.projectedCostMinor).toBe(6_000);
    expect(before.requirementRevision.quoteRevisionId).toBe("v0017");
    expect(before.requirementRevision.eventRequirementRevisionId).not.toBe(after.requirementRevision.eventRequirementRevisionId);
  });

  test("is deterministic for historical inputs and independent of unrelated stock", () => {
    const fixture = ownerFixture();
    const first = demandCore.compileEventIngredientDemand(fixture.input);
    const second = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      selections: [...fixture.input.selections].reverse(),
      recipeRevisions: [...fixture.input.recipeRevisions].reverse(),
      recipeCostResults: [...fixture.input.recipeCostResults].reverse(),
      stockStates: [...fixture.input.stockStates].reverse()
    });
    expect(second).toEqual(first);

    const salt = ingredient("salt", "each");
    const withUnrelatedStock = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      stockStates: [...fixture.input.stockStates, stockState(salt, "50")]
    });
    expect(withUnrelatedStock).toEqual(first);
  });
});

describe("independent cost and availability rails", () => {
  test("unknown pasta cost preserves valid physical shortage evidence", () => {
    const fixture = ownerFixture();
    const incompleteCost = recipeCost(fixture.entree, [fixture.chicken, fixture.pasta], [fixture.costs[0]]);
    const result = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      recipeCostResults: [incompleteCost],
      activeAllocations: [allocation(fixture.chicken)]
    });
    expect(result.requirementRevision.costState).toBe("partial");
    expect(result.requirementRevision).not.toHaveProperty("projectedCostMinor");
    expect(result.requirementRevision.knownCostMinor).toBe(6_000);
    expect(result.projection.availabilityState).toBe("shortage");
    expect(result.projection.ingredients.find(({ ingredientId }) => ingredientId === "chicken").shortageQuantityMicros).toBe(5_000_000);
    expect(result.projection.issues).toContainEqual(expect.objectContaining({ code: "missing_cost", ingredientId: "pasta" }));
  });

  test("missing stock preserves a complete projected ingredient cost", () => {
    const fixture = ownerFixture();
    const result = demandCore.compileEventIngredientDemand({ ...fixture.input, stockStates: [] });
    expect(result.requirementRevision.costState).toBe("complete");
    expect(result.projection.costState).toBe("complete");
    expect(result.projection.projectedCostMinor).toBe(8_000);
    expect(result.projection.availabilityState).toBe("unavailable");
    expect(result.projection.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_stock_state", ingredientId: "chicken" }),
      expect.objectContaining({ code: "missing_stock_state", ingredientId: "pasta" })
    ]));
  });

  test("missing recipe and normalization evidence remain explicit rather than inventing demand", () => {
    const fixture = ownerFixture();
    const missingRecipe = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      selections: [selection(fixture.entree.menuItemId, null, "100", { outputUnitId: null })],
      recipeRevisions: [],
      recipeCostResults: []
    });
    expect(missingRecipe.requirementRevision.demandState).toBe("incomplete");
    expect(missingRecipe.projection.availabilityState).toBe("unavailable");
    expect(missingRecipe.requirementRevision.issues).toContainEqual(expect.objectContaining({ code: "missing_recipe_revision" }));

    const missingNormalization = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      recipeCostResults: []
    });
    expect(missingNormalization.requirementRevision.demandState).toBe("incomplete");
    expect(missingNormalization.requirementRevision.issues).toContainEqual(expect.objectContaining({ code: "missing_recipe_normalization" }));
  });
});

describe("canonical selection and evidence boundaries", () => {
  test("rejects duplicate menu selections so package provenance cannot double-count a dish", () => {
    const fixture = ownerFixture();
    expect(() => demandCore.compileEventIngredientDemand({
      ...fixture.input,
      selections: [
        ...fixture.input.selections,
        selection(fixture.entree.menuItemId, fixture.entree.recipeRevisionId, "100", {
          selectionId: "package-copy",
          commercialProvenance: {
            kind: "package_inclusion",
            sourceId: "quote-package-line",
            packageId: "buffet-package",
            inclusionId: "included-entree"
          }
        })
      ]
    })).toThrow(/exactly once/i);
  });

  test("requires explicit portion evidence and rejects unsupported provenance", () => {
    const fixture = ownerFixture();
    const withoutBasis = { ...fixture.input.selections[0] };
    delete withoutBasis.portionBasis;
    expect(() => demandCore.compileEventIngredientDemand({ ...fixture.input, selections: [withoutBasis] })).toThrow(/missing or unsupported fields/i);
    expect(() => demandCore.compileEventIngredientDemand({
      ...fixture.input,
      selections: [selection(fixture.entree.menuItemId, fixture.entree.recipeRevisionId, "100", {
        commercialProvenance: { kind: "guessed", sourceId: "no-evidence" }
      })]
    })).toThrow(/unsupported/i);
  });

  test("marks recipe/output-unit mismatches invalid and never derives portions from guest count", () => {
    const fixture = ownerFixture();
    const result = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      selections: [selection(fixture.entree.menuItemId, fixture.entree.recipeRevisionId, "100", { outputUnitId: "guest" })]
    });
    expect(result.requirementRevision.demandState).toBe("invalid");
    expect(result.projection.availabilityState).toBe("invalid");
    expect(result.requirementRevision.ingredients).toEqual([]);
    expect(result.requirementRevision.issues).toContainEqual(expect.objectContaining({ code: "recipe_selection_mismatch" }));
    expect(result.requirementRevision).not.toHaveProperty("guestCount");
  });

  test("fails closed when recipe normalization needs an unsupported cross-dimension conversion", () => {
    const fixture = ownerFixture();
    const incompatible = recipe("menu-volume-chicken", [
      { lineId: "volume-chicken", ingredientId: "chicken", quantity: "1", unitId: "l" }
    ]);
    const incompatibleCost = recipeCost(incompatible, [fixture.chicken], [fixture.costs[0]]);
    const result = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      selections: [selection(incompatible.menuItemId, incompatible.recipeRevisionId)],
      recipeRevisions: [incompatible],
      recipeCostResults: [incompatibleCost]
    });
    expect(result.requirementRevision.demandState).toBe("incomplete");
    expect(result.requirementRevision.costState).toBe("invalid");
    expect(result.projection.availabilityState).toBe("unavailable");
    expect(result.requirementRevision.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_conversion", ingredientId: "chicken" }),
      expect.objectContaining({ code: "incomplete_recipe_normalization" })
    ]));
  });

  test("fails closed on tampered recipe-cost evidence and cross-tenant allocation evidence", () => {
    const fixture = ownerFixture();
    const tampered = { ...fixture.input.recipeCostResults[0], projectedCostMinor: 1 };
    expect(() => demandCore.compileEventIngredientDemand({ ...fixture.input, recipeCostResults: [tampered] })).toThrow(/digest/i);

    const crossTenant = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      activeAllocations: [allocation(fixture.chicken, "1", { organizationId: "org-other" })]
    });
    expect(crossTenant.projection.availabilityState).toBe("invalid");
    expect(crossTenant.projection.issues).toContainEqual(expect.objectContaining({ code: "invalid_allocation_tenant" }));
  });

  test("rejects tampered persisted requirements and projections", () => {
    const result = demandCore.compileEventIngredientDemand(ownerFixture().input);
    expect(() => demandCore.verifyEventIngredientRequirement({
      ...result.requirementRevision,
      quoteRevisionId: "v0099"
    })).toThrow(/digest/i);
    expect(() => demandCore.verifyEventIngredientProjection({
      ...result.projection,
      availabilityState: "shortage"
    })).toThrow(/digest/i);

    const { requirementDigest: _digest, ...withId } = result.requirementRevision;
    const changedIdentity = { ...withId, eventRequirementRevisionId: "eir_wrong" };
    expect(() => demandCore.verifyEventIngredientRequirement({
      ...changedIdentity,
      requirementDigest: ingredientCore.digest(changedIdentity, "event ingredient requirement")
    })).toThrow(/identity/i);
  });

  test("preserves package inclusion as single-selection provenance", () => {
    const fixture = ownerFixture();
    const result = demandCore.compileEventIngredientDemand({
      ...fixture.input,
      selections: [selection(fixture.entree.menuItemId, fixture.entree.recipeRevisionId, "100", {
        commercialProvenance: {
          kind: "package_inclusion",
          sourceId: "quote-package-line",
          packageId: "premium-buffet",
          inclusionId: "entree-1"
        }
      })]
    });
    expect(result.requirementRevision.coverage.selectedMenuItemCount).toBe(1);
    expect(result.requirementRevision.selections[0].commercialProvenance).toEqual({
      kind: "package_inclusion",
      sourceId: "quote-package-line",
      packageId: "premium-buffet",
      inclusionId: "entree-1"
    });
  });
});
