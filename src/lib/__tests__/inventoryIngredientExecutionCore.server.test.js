import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const inventory = require("../../../functions/inventoryIngredientCore.cjs");
const allocation = require("../../../functions/inventoryIngredientAllocationCore.cjs");
const demand = require("../../../functions/inventoryEventDemandCore.cjs");
const execution = require("../../../functions/inventoryIngredientExecutionCore.cjs");

const ORG = "org-execution";
const NOW = "2026-09-09T12:00:00.000Z";
const actor = { uid: "admin-1", email: "admin@example.test", role: "admin", organizationId: ORG };

function authorities(quantity = "40") {
  const location = inventory.planLocation({
    organizationId: ORG,
    request: { kind: "upsert_location", locationId: "kitchen", name: "Main kitchen", active: true, expectedRevision: 0 },
    actor,
    nowISO: NOW
  }).location;
  const ingredient = inventory.planIngredient({
    organizationId: ORG,
    request: {
      kind: "upsert_ingredient", ingredientId: "chicken", name: "Chicken", category: "Protein",
      baseUnitId: "lb", active: true, expectedRevision: 0
    },
    actor,
    nowISO: NOW
  }).ingredient;
  const opened = inventory.planOpeningBalance({
    organizationId: ORG,
    requestId: "opening-execution-chicken",
    request: {
      kind: "opening_balance", ingredientId: "chicken", locationId: "kitchen", quantity,
      baseUnitId: "lb", occurredAtISO: NOW, note: "Opening count", expectedStockRevision: 0
    },
    ingredient,
    location,
    actor,
    nowISO: NOW
  });
  return { location, ingredient, opened };
}

function requirement(quoteId, requiredMicros, { completeCost = true, projectedCostMinor = 6000 } = {}) {
  const ingredientRow = {
    ingredientId: "chicken",
    baseUnitId: "lb",
    exactRequiredQuantityMicros: { numerator: String(requiredMicros), denominator: "1" },
    requiredQuantityMicros: requiredMicros,
    contributions: [],
    costState: completeCost ? "complete" : "unavailable"
  };
  if (completeCost) Object.assign(ingredientRow, {
    exactKnownCostMinor: { numerator: String(projectedCostMinor), denominator: "1" },
    knownCostMinor: projectedCostMinor,
    currency: "USD",
    projectedCostMinor
  });
  const body = {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: demand.EVENT_DEMAND_SCHEMA_VERSION,
    requirementVersion: demand.EVENT_REQUIREMENT_VERSION,
    organizationId: ORG,
    quoteId,
    quoteRevisionId: `quote-revision-${quoteId}`,
    requiredByISO: "2026-09-12T18:00:00.000Z",
    demandState: "complete",
    costState: completeCost ? "complete" : "unavailable",
    selections: [],
    ingredients: [ingredientRow],
    coverage: {
      selectedMenuItemCount: 1,
      compiledMenuItemCount: 1,
      ingredientCount: 1,
      costedIngredientCount: completeCost ? 1 : 0,
      knownCostIngredientCount: completeCost ? 1 : 0
    },
    issues: []
  };
  if (completeCost) Object.assign(body, {
    currency: "USD",
    exactKnownCostMinor: { numerator: String(projectedCostMinor), denominator: "1" },
    knownCostMinor: projectedCostMinor,
    projectedCostMinor
  });
  const eventRequirementRevisionId = `eir_${inventory.digest(
    body,
    "event ingredient requirement identity"
  ).slice(0, 48)}`;
  const withId = { ...body, eventRequirementRevisionId };
  return Object.freeze({
    ...withId,
    requirementDigest: inventory.digest(withId, "event ingredient requirement")
  });
}

function allocate(requirementRevision, stockState, fences = []) {
  return allocation.planEventAllocation({
    request: {
      kind: "allocate_event_ingredients",
      quoteId: requirementRevision.quoteId,
      eventRequirementRevisionId: requirementRevision.eventRequirementRevisionId,
      locationId: "kitchen",
      expectedRequirementRevision: 1,
      expectedAllocationRevision: 0
    },
    organizationId: ORG,
    requirementHead: {
      organizationId: ORG,
      quoteId: requirementRevision.quoteId,
      revision: 1,
      eventRequirementRevisionId: requirementRevision.eventRequirementRevisionId,
      requirementDigest: requirementRevision.requirementDigest
    },
    requirement: requirementRevision,
    stockStates: [stockState],
    fences,
    nowISO: NOW
  });
}

function executionRequest({ requirementRevision, plan, stockState, kind = "record_event_ingredient_execution", expectedExecutionRevision = 0, consumed = "18", waste = "2", reason = "Event closeout count" }) {
  return {
    kind,
    quoteId: requirementRevision.quoteId,
    eventRequirementRevisionId: requirementRevision.eventRequirementRevisionId,
    expectedExecutionRevision,
    expectedAllocationRevision: plan.allocationRevision,
    occurredAtISO: NOW,
    reason,
    ingredients: [{
      ingredientId: "chicken",
      locationId: "kitchen",
      baseUnitId: "lb",
      consumedQuantity: consumed,
      wasteQuantity: waste,
      expectedStockRevision: stockState.revision
    }]
  };
}

function execute({ requestId = "execute-event-1", requirementRevision, plan, stockState, fences, currentExecution = null, request }) {
  return execution.planEventIngredientExecution({
    organizationId: ORG,
    requestId,
    request,
    pinnedRequirement: requirementRevision,
    currentPlan: plan,
    currentExecution,
    stockStates: [stockState],
    fences,
    actor,
    nowISO: NOW
  });
}

describe("event ingredient execution core", () => {
  test("derives stable per-ingredient movement identities for a multi-line command", () => {
    const chicken = inventory.eventMovementIdFor(ORG, "multi-line-closeout", "chicken", "kitchen");
    const pasta = inventory.eventMovementIdFor(ORG, "multi-line-closeout", "pasta", "kitchen");
    expect(chicken).toMatch(/^imv_[a-f0-9]{48}$/u);
    expect(inventory.eventMovementIdFor(ORG, "multi-line-closeout", "chicken", "kitchen")).toBe(chicken);
    expect(pasta).not.toBe(chicken);
  });

  test("settles an allocation, decrements physical stock once, and reports exact planned-basis usage cost", () => {
    const { opened } = authorities();
    const pinned = requirement("event-closeout", 20_000_000);
    const reserved = allocate(pinned, opened.nextStockState);
    const result = execute({
      requirementRevision: pinned,
      plan: reserved.plan,
      stockState: opened.nextStockState,
      fences: reserved.fences,
      request: executionRequest({ requirementRevision: pinned, plan: reserved.plan, stockState: opened.nextStockState })
    });

    expect(result.plan).toMatchObject({
      state: "settled",
      allocationRevision: 2,
      releaseReason: "",
      settlementExecutionRevisionId: result.execution.eventExecutionRevisionId
    });
    expect(result.fences[0]).toMatchObject({ committedMicros: 0, allocations: [] });
    expect(result.stockStates[0]).toMatchObject({ revision: 2, onHandMicros: 20_000_000 });
    expect(result.execution.ingredients[0]).toMatchObject({
      consumedQuantityMicros: 18_000_000,
      wasteQuantityMicros: 2_000_000,
      depletedQuantityMicros: 20_000_000,
      allocationReleasedQuantityMicros: 20_000_000,
      stockEffectDirection: "decrease",
      plannedBasisUsageCostMinor: 6000,
      plannedBasisVarianceMinor: 0
    });
    expect(result.execution.costSummary).toEqual({
      actualCogsState: "unavailable",
      actualCogsReason: "valuation_policy_unresolved",
      plannedBasisState: "complete",
      expectedIngredientCount: 1,
      costedIngredientCount: 1,
      currency: "USD",
      exactKnownUsageCostMinor: { numerator: "6000", denominator: "1" },
      knownUsageCostMinor: 6000,
      plannedProjectedCostMinor: 6000,
      plannedBasisVarianceMinor: 0
    });
    expect(result.movements).toHaveLength(1);
    expect(inventory.verifyMovement(result.movements[0])).toBe(result.movements[0]);
    expect(execution.verifyEventIngredientExecution(result.execution, {
      organizationId: ORG,
      quoteId: pinned.quoteId,
      documentId: result.execution.eventExecutionRevisionId
    })).toBe(result.execution);
    expect(inventory.replayMovements({
      organizationId: ORG,
      ingredientId: "chicken",
      locationId: "kitchen",
      baseUnitId: "lb",
      movements: [opened.movement, result.movements[0]]
    })).toEqual(result.stockStates[0]);
  });

  test("can exceed its own hold only while preserving all other active commitments", () => {
    const { opened } = authorities();
    const otherRequirement = requirement("other-event", 25_000_000, { projectedCostMinor: 7500 });
    const other = allocate(otherRequirement, opened.nextStockState);
    const targetRequirement = requirement("target-event", 10_000_000, { projectedCostMinor: 3000 });
    const target = allocate(targetRequirement, opened.nextStockState, other.fences);

    const allowed = execute({
      requestId: "execute-over-hold-allowed",
      requirementRevision: targetRequirement,
      plan: target.plan,
      stockState: opened.nextStockState,
      fences: target.fences,
      request: executionRequest({
        requirementRevision: targetRequirement,
        plan: target.plan,
        stockState: opened.nextStockState,
        consumed: "15",
        waste: "0"
      })
    });
    expect(allowed.stockStates[0].onHandMicros).toBe(25_000_000);
    expect(allowed.fences[0].committedMicros).toBe(25_000_000);

    expect(() => execute({
      requestId: "execute-over-hold-denied",
      requirementRevision: targetRequirement,
      plan: target.plan,
      stockState: opened.nextStockState,
      fences: target.fences,
      request: executionRequest({
        requirementRevision: targetRequirement,
        plan: target.plan,
        stockState: opened.nextStockState,
        consumed: "15.000001",
        waste: "0"
      })
    })).toThrow(/preserve stock committed/i);
  });

  test("corrections use replacement totals and physical deltas without touching settled fences", () => {
    const { opened } = authorities();
    const pinned = requirement("event-correction", 20_000_000);
    const reserved = allocate(pinned, opened.nextStockState);
    const initial = execute({
      requestId: "execute-correction-initial",
      requirementRevision: pinned,
      plan: reserved.plan,
      stockState: opened.nextStockState,
      fences: reserved.fences,
      request: executionRequest({
        requirementRevision: pinned,
        plan: reserved.plan,
        stockState: opened.nextStockState,
        consumed: "17",
        waste: "1"
      })
    });
    const corrected = execute({
      requestId: "execute-correction-reduce",
      requirementRevision: pinned,
      plan: initial.plan,
      stockState: initial.stockStates[0],
      fences: initial.fences,
      currentExecution: initial.execution,
      request: executionRequest({
        requirementRevision: pinned,
        plan: initial.plan,
        stockState: initial.stockStates[0],
        kind: "correct_event_ingredient_execution",
        expectedExecutionRevision: 1,
        consumed: "16",
        waste: "0",
        reason: "Corrected closeout count"
      })
    });
    expect(corrected.execution).toMatchObject({
      executionRevision: 2,
      priorEventExecutionRevisionId: initial.execution.eventExecutionRevisionId,
      settlementExecutionRevisionId: initial.execution.eventExecutionRevisionId,
      allocationRevision: initial.plan.allocationRevision
    });
    expect(corrected.execution.ingredients[0]).toMatchObject({
      priorDepletedQuantityMicros: 18_000_000,
      depletedQuantityMicros: 16_000_000,
      stockEffectDirection: "increase",
      stockEffectQuantityMicros: 2_000_000,
      allocationReleasedQuantityMicros: 0
    });
    expect(corrected.stockStates[0]).toMatchObject({ revision: 3, onHandMicros: 24_000_000 });
    expect(corrected.fences).toEqual(initial.fences);
    expect(corrected.movements[0]).toMatchObject({
      kind: "event_depletion_correction",
      direction: "increase",
      quantityMicros: 2_000_000
    });
    expect(inventory.replayMovements({
      organizationId: ORG,
      ingredientId: "chicken",
      locationId: "kitchen",
      baseUnitId: "lb",
      movements: [opened.movement, initial.movements[0], corrected.movements[0]]
    })).toEqual(corrected.stockStates[0]);

    const reclassified = execute({
      requestId: "execute-correction-reclassify",
      requirementRevision: pinned,
      plan: corrected.plan,
      stockState: corrected.stockStates[0],
      fences: corrected.fences,
      currentExecution: corrected.execution,
      request: executionRequest({
        requirementRevision: pinned,
        plan: corrected.plan,
        stockState: corrected.stockStates[0],
        kind: "correct_event_ingredient_execution",
        expectedExecutionRevision: 2,
        consumed: "15",
        waste: "1",
        reason: "Reclassified one pound as waste"
      })
    });
    expect(reclassified.execution).toMatchObject({ executionRevision: 3 });
    expect(reclassified.execution.ingredients[0]).toMatchObject({
      stockEffectDirection: "unchanged",
      stockEffectQuantityMicros: 0,
      priorStockRevision: 3,
      resultStockRevision: 3
    });
    expect(reclassified.movements).toEqual([]);
    expect(reclassified.stockStates[0]).toBe(corrected.stockStates[0]);

    const increased = execute({
      requestId: "execute-correction-increase",
      requirementRevision: pinned,
      plan: reclassified.plan,
      stockState: reclassified.stockStates[0],
      fences: reclassified.fences,
      currentExecution: reclassified.execution,
      request: executionRequest({
        requirementRevision: pinned,
        plan: reclassified.plan,
        stockState: reclassified.stockStates[0],
        kind: "correct_event_ingredient_execution",
        expectedExecutionRevision: 3,
        consumed: "16",
        waste: "1",
        reason: "Added one pound found on final count"
      })
    });
    expect(increased.execution.ingredients[0]).toMatchObject({
      priorDepletedQuantityMicros: 16_000_000,
      depletedQuantityMicros: 17_000_000,
      stockEffectDirection: "decrease",
      stockEffectQuantityMicros: 1_000_000
    });
    expect(increased.stockStates[0]).toMatchObject({ revision: 4, onHandMicros: 23_000_000 });
    expect(increased.movements[0]).toMatchObject({
      kind: "event_depletion_correction",
      direction: "decrease",
      quantityMicros: 1_000_000
    });
  });

  test("preserves missing planned cost and never claims authoritative actual COGS", () => {
    const { opened } = authorities();
    const pinned = requirement("event-unknown-cost", 20_000_000, { completeCost: false });
    const reserved = allocate(pinned, opened.nextStockState);
    const result = execute({
      requirementRevision: pinned,
      plan: reserved.plan,
      stockState: opened.nextStockState,
      fences: reserved.fences,
      request: executionRequest({ requirementRevision: pinned, plan: reserved.plan, stockState: opened.nextStockState })
    });
    expect(result.execution.ingredients[0]).toMatchObject({ plannedBasisCostState: "unavailable" });
    expect(result.execution.ingredients[0]).not.toHaveProperty("plannedBasisUsageCostMinor");
    expect(result.execution.costSummary).toEqual({
      actualCogsState: "unavailable",
      actualCogsReason: "valuation_policy_unresolved",
      plannedBasisState: "unavailable",
      expectedIngredientCount: 1,
      costedIngredientCount: 0
    });
  });

  test("scales exact pinned cost before rounding planned-basis usage money", () => {
    const { opened } = authorities();
    const pinned = requirement("event-fractional-cost", 3_000_000, { projectedCostMinor: 100 });
    const reserved = allocate(pinned, opened.nextStockState);
    const result = execute({
      requestId: "execute-fractional-cost",
      requirementRevision: pinned,
      plan: reserved.plan,
      stockState: opened.nextStockState,
      fences: reserved.fences,
      request: executionRequest({
        requirementRevision: pinned,
        plan: reserved.plan,
        stockState: opened.nextStockState,
        consumed: "2",
        waste: "0"
      })
    });
    expect(result.execution.ingredients[0]).toMatchObject({
      exactPlannedBasisUsageCostMinor: { numerator: "200", denominator: "3" },
      plannedBasisUsageCostMinor: 67,
      plannedProjectedCostMinor: 100,
      plannedBasisVarianceMinor: -33
    });
    expect(result.execution.costSummary).toMatchObject({
      exactKnownUsageCostMinor: { numerator: "200", denominator: "3" },
      knownUsageCostMinor: 67,
      plannedBasisVarianceMinor: -33
    });
  });

  test("fails closed on stale revisions, incomplete coverage, excessive depletion, and kind substitution", () => {
    const { opened } = authorities();
    const pinned = requirement("event-fail-closed", 20_000_000);
    const reserved = allocate(pinned, opened.nextStockState);
    const baseRequest = executionRequest({ requirementRevision: pinned, plan: reserved.plan, stockState: opened.nextStockState });
    expect(() => execute({
      requirementRevision: pinned,
      plan: reserved.plan,
      stockState: opened.nextStockState,
      fences: reserved.fences,
      request: { ...baseRequest, ingredients: [] }
    })).toThrow(/requires 1-75/i);
    expect(() => execute({
      requirementRevision: pinned,
      plan: reserved.plan,
      stockState: opened.nextStockState,
      fences: reserved.fences,
      request: {
        ...baseRequest,
        ingredients: [{ ...baseRequest.ingredients[0], expectedStockRevision: 2 }]
      }
    })).toThrow(/stock changed/i);
    expect(() => execute({
      requirementRevision: pinned,
      plan: reserved.plan,
      stockState: opened.nextStockState,
      fences: reserved.fences,
      request: {
        ...baseRequest,
        ingredients: [{ ...baseRequest.ingredients[0], consumedQuantity: "41", wasteQuantity: "0" }]
      }
    })).toThrow(/physically on hand/i);
    expect(() => execution.normalizeExecutionRequest({
      ...baseRequest,
      kind: "correct_event_ingredient_execution"
    })).toThrow(/matching expected execution revision/i);
  });
});
