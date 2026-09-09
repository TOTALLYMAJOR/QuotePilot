import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const inventory = require("../../../functions/inventoryIngredientCore.cjs");

const ORG = "org-smith";
const NOW = "2026-09-09T04:00:00.000Z";
const ACTOR = { uid: "admin-1", email: "admin@example.test", role: "admin", organizationId: ORG };

function location() {
  return inventory.planLocation({
    organizationId: ORG,
    request: { kind: "upsert_location", locationId: "main", name: "Main kitchen", active: true, expectedRevision: 0 },
    actor: ACTOR,
    nowISO: NOW
  }).location;
}

function ingredient(ingredientId = "chicken", baseUnitId = "lb") {
  return inventory.planIngredient({
    organizationId: ORG,
    request: { kind: "upsert_ingredient", ingredientId, name: ingredientId === "chicken" ? "Chicken" : "Pasta", category: "Food", baseUnitId, active: true, expectedRevision: 0 },
    actor: ACTOR,
    nowISO: NOW
  }).ingredient;
}

function openingRequest(ingredientId, quantity) {
  return {
    kind: "opening_balance",
    ingredientId,
    locationId: "main",
    quantity,
    baseUnitId: "lb",
    occurredAtISO: "2026-09-08T12:00:00.000Z",
    note: "Owner opening count",
    expectedStockRevision: 0
  };
}

function costRequest(ingredientId, basisQuantity, totalCostMinor) {
  return {
    kind: "record_ingredient_cost",
    ingredientId,
    baseUnitId: "lb",
    availability: "available",
    sourceLabel: "Opening cost observation",
    observedAtISO: "2026-09-08T12:00:00.000Z",
    note: "Recorded total purchase cost",
    expectedCostRevision: 0,
    basisQuantity,
    totalCostMinor,
    currency: "USD"
  };
}

describe("ingredient quantity contract", () => {
  test.each([
    ["40", 40_000_000, "40"],
    ["0.125", 125_000, "0.125"],
    ["1.000001", 1_000_001, "1.000001"]
  ])("round trips canonical decimal %s", (value, micros, formatted) => {
    expect(inventory.parseQuantityMicros(value)).toBe(micros);
    expect(inventory.formatQuantityMicros(micros)).toBe(formatted);
  });

  test.each([1, " 1", "+1", "01", "1.", ".5", "1e2", "0", "1.0000001"])("rejects malformed quantity %j", (value) => {
    expect(() => inventory.parseQuantityMicros(value)).toThrow(/canonical decimal|range/i);
  });
});

describe("ingredient stock evidence", () => {
  test("records and exactly replays the chicken and pasta opening balances", () => {
    for (const [ingredientId, quantity] of [["chicken", "40"], ["pasta", "30"]]) {
      const item = ingredient(ingredientId);
      const plan = inventory.planOpeningBalance({
        organizationId: ORG,
        requestId: `opening-${ingredientId}`,
        request: openingRequest(ingredientId, quantity),
        ingredient: item,
        location: location(),
        actor: ACTOR,
        nowISO: NOW
      });
      expect(plan.nextStockState.onHandMicros).toBe(Number(quantity) * inventory.QUANTITY_SCALE);
      expect(inventory.replayMovements({
        organizationId: ORG,
        ingredientId,
        locationId: "main",
        baseUnitId: "lb",
        movements: [plan.movement]
      })).toEqual(plan.nextStockState);
      expect(inventory.verifyMovement(plan.movement)).toBe(plan.movement);
    }
  });

  test("fails closed on duplicate genesis, unit mutation, and tampering", () => {
    const item = ingredient();
    const plan = inventory.planOpeningBalance({
      organizationId: ORG,
      requestId: "opening-chicken",
      request: openingRequest("chicken", "40"),
      ingredient: item,
      location: location(),
      actor: ACTOR,
      nowISO: NOW
    });
    expect(() => inventory.planOpeningBalance({
      organizationId: ORG,
      requestId: "opening-chicken-again",
      request: openingRequest("chicken", "1"),
      ingredient: item,
      location: location(),
      stockState: plan.nextStockState,
      actor: ACTOR,
      nowISO: NOW
    })).toThrow(/only once/i);
    expect(() => inventory.planIngredient({
      organizationId: ORG,
      request: { kind: "upsert_ingredient", ingredientId: "chicken", name: "Chicken", category: "Food", baseUnitId: "kg", active: true, expectedRevision: 1 },
      current: { ...item, firstMovementId: plan.movement.movementId },
      actor: ACTOR,
      nowISO: NOW
    })).toThrow(/immutable/i);
    expect(() => inventory.verifyMovement({ ...plan.movement, quantityMicros: 1 })).toThrow(/digest/i);

    const { movementDigest: _digest, ...movementBody } = plan.movement;
    const internallyContradictory = { ...movementBody, resultOnHandMicros: 39_000_000 };
    expect(() => inventory.verifyMovement({
      ...internallyContradictory,
      movementDigest: inventory.digest(internallyContradictory, "ingredient movement")
    })).toThrow(/internally inconsistent/i);
  });
});

describe("independent recorded cost evidence", () => {
  test("retains exact 40 lb/$120 and 30 lb/$60 ratios without rounded unit prices", () => {
    for (const [ingredientId, quantity, totalCostMinor] of [["chicken", "40", 12_000], ["pasta", "30", 6_000]]) {
      const plan = inventory.planIngredientCostEvidence({
        organizationId: ORG,
        requestId: `cost-${ingredientId}`,
        request: costRequest(ingredientId, quantity, totalCostMinor),
        ingredient: ingredient(ingredientId),
        actor: ACTOR,
        nowISO: NOW
      });
      expect(plan.nextCostState).toMatchObject({
        basisQuantityMicros: Number(quantity) * inventory.QUANTITY_SCALE,
        totalCostMinor,
        currency: "USD",
        availability: "available"
      });
      expect(plan.nextCostState).not.toHaveProperty("unitCostMinor");
      expect(inventory.verifyCostEvidence(plan.costEvidence)).toBe(plan.costEvidence);
    }
  });

  test("keeps unknown cost explicit and independent of physical stock", () => {
    const request = {
      kind: "record_ingredient_cost",
      ingredientId: "chicken",
      baseUnitId: "lb",
      availability: "not_yet_available",
      sourceLabel: "Opening count",
      observedAtISO: "2026-09-08T12:00:00.000Z",
      note: "Cost not recorded",
      expectedCostRevision: 0
    };
    const plan = inventory.planIngredientCostEvidence({
      organizationId: ORG,
      requestId: "cost-unknown",
      request,
      ingredient: ingredient(),
      actor: ACTOR,
      nowISO: NOW
    });
    expect(plan.nextCostState.availability).toBe("not_yet_available");
    expect(plan.nextCostState).not.toHaveProperty("totalCostMinor");
    expect(plan.nextCostState).not.toHaveProperty("basisQuantityMicros");
    expect(() => inventory.verifyCostEvidence({
      ...plan.costEvidence,
      totalCostMinor: 0
    })).toThrow(/digest|invented money|unsupported fields/i);

    const stock = inventory.planOpeningBalance({
      organizationId: ORG,
      requestId: "opening-independent",
      request: openingRequest("chicken", "40"),
      ingredient: ingredient(),
      location: location(),
      actor: ACTOR,
      nowISO: NOW
    }).nextStockState;
    expect(stock.onHandMicros).toBe(40_000_000);
    expect(stock).not.toHaveProperty("costRevision");
    expect(plan.nextCostState).not.toHaveProperty("onHandMicros");
  });

  test("rejects stale cost revision without affecting stock semantics", () => {
    expect(() => inventory.planIngredientCostEvidence({
      organizationId: ORG,
      requestId: "stale-cost",
      request: { ...costRequest("chicken", "40", 12_000), expectedCostRevision: 1 },
      ingredient: ingredient(),
      actor: ACTOR,
      nowISO: NOW
    })).toThrow(/stale/i);
  });

  test("rejects new cost evidence for an inactive ingredient", () => {
    expect(() => inventory.planIngredientCostEvidence({
      organizationId: ORG,
      requestId: "inactive-cost",
      request: costRequest("chicken", "40", 12_000),
      ingredient: { ...ingredient(), active: false },
      actor: ACTOR,
      nowISO: NOW
    })).toThrow(/active exact same-tenant ingredient/i);
  });

  test("locks the ingredient base unit after cost evidence even before stock exists", () => {
    const item = ingredient();
    const cost = inventory.planIngredientCostEvidence({
      organizationId: ORG,
      requestId: "cost-before-stock",
      request: costRequest("chicken", "40", 12_000),
      ingredient: item,
      actor: ACTOR,
      nowISO: NOW
    }).nextCostState;
    expect(() => inventory.planIngredient({
      organizationId: ORG,
      request: {
        kind: "upsert_ingredient",
        ingredientId: "chicken",
        name: "Chicken",
        category: "Food",
        baseUnitId: "kg",
        active: true,
        expectedRevision: 1
      },
      current: item,
      currentCostState: cost,
      actor: ACTOR,
      nowISO: NOW
    })).toThrow(/first stock or cost evidence/i);
  });

  test("rejects recomputed-digest cost evidence with invalid money or result state", () => {
    const plan = inventory.planIngredientCostEvidence({
      organizationId: ORG,
      requestId: "cost-integrity",
      request: costRequest("chicken", "40", 12_000),
      ingredient: ingredient(),
      actor: ACTOR,
      nowISO: NOW
    });
    const { costEvidenceDigest: _digest, ...body } = plan.costEvidence;
    const tamperedBody = {
      ...body,
      totalCostMinor: -1,
      resultCostState: { ...body.resultCostState, totalCostMinor: -1 }
    };
    expect(() => inventory.verifyCostEvidence({
      ...tamperedBody,
      costEvidenceDigest: inventory.digest(tamperedBody, "ingredient cost evidence")
    })).toThrow(/non-negative|inconsistent/i);
  });
});
