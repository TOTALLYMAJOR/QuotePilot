import { describe, expect, test } from "vitest";
import { buildEventIngredientOperationalPresentation } from "../eventIngredientOperationalPresentation";

const REQUIREMENT_ID = `eir_${"e".repeat(48)}`;
const EXECUTION_ID = `eix_${"a".repeat(48)}`;

function allocation(overrides = {}) {
  return {
    state: "reserved",
    eventPlanId: "event_plan_1",
    allocationRevision: 2,
    eventRequirementRevisionId: REQUIREMENT_ID,
    ingredientCount: 1,
    fullyAllocatedIngredientCount: 1,
    shortageIngredientCount: 0,
    ingredients: [],
    ...overrides
  };
}

function plan(overrides = {}) {
  return {
    quoteId: "quote-1",
    quoteRevisionId: "quote-revision-4",
    freshness: "as_recorded",
    freshnessState: {
      demand: { state: "current", reason: "" },
      cost: { state: "current", reason: "" },
      availability: { state: "current", reason: "" },
      allocation: { state: "current", reason: "" }
    },
    demandState: "complete",
    costState: "complete",
    availabilityState: "available",
    currency: "USD",
    projectedCostMinor: 8000,
    allocation: allocation(),
    ...overrides
  };
}

function executionRow(overrides = {}) {
  return {
    ingredientId: "chicken",
    baseUnitId: "lb",
    plannedQuantityMicros: 20_000_000,
    allocatedQuantityMicros: 20_000_000,
    consumedQuantityMicros: 18_000_000,
    wasteQuantityMicros: 2_000_000,
    depletedQuantityMicros: 20_000_000,
    plannedBasisCostState: "complete",
    currency: "USD",
    ...overrides
  };
}

function execution(overrides = {}) {
  return {
    quoteId: "quote-1",
    eventPlanId: "event_plan_1",
    eventRequirementRevisionId: REQUIREMENT_ID,
    allocationRevision: 2,
    state: "settled",
    executionRevision: 3,
    eventExecutionRevisionId: EXECUTION_ID,
    settlementExecutionRevisionId: EXECUTION_ID,
    lastReceiptId: "receipt_execution_1",
    ingredients: [executionRow()],
    costSummary: {
      actualCogsState: "unavailable",
      actualCogsReason: "valuation_policy_unresolved",
      plannedBasisState: "complete",
      currency: "USD",
      knownUsageCostMinor: 7600,
      plannedProjectedCostMinor: 8000,
      plannedBasisVarianceMinor: -400
    },
    ...overrides
  };
}

function planRead(projection = plan(), overrides = {}) {
  return { state: "current", sourceState: "current", exists: Boolean(projection), projection, ...overrides };
}

function executionRead(projection = null, overrides = {}) {
  return {
    state: projection ? "current" : "not_recorded",
    sourceState: "current",
    exists: Boolean(projection),
    projection,
    ...overrides
  };
}

function build(overrides = {}) {
  return buildEventIngredientOperationalPresentation({
    planRead: planRead(),
    executionRead: executionRead(),
    activeQuoteRevisionId: "quote-revision-4",
    ...overrides
  });
}

describe("buildEventIngredientOperationalPresentation", () => {
  test("keeps a current reservation physically satisfied when cost is unknown and usage is not recorded", () => {
    const model = build({ planRead: planRead(plan({ costState: "unavailable" })) });
    expect(model.physical.state).toBe("satisfied");
    expect(model.cost.state).toBe("unknown");
    expect(model.execution.state).toBe("attention");
    expect(model.cost.detail).toMatch(/never converted to zero/i);
  });

  test("does not treat saved availability without an allocation as a stock commitment", () => {
    const model = build({
      planRead: planRead(plan({
        allocation: null,
        freshnessState: { ...plan().freshnessState, allocation: { state: "not_allocated", reason: "" } }
      }))
    });
    expect(model.physical).toMatchObject({ state: "attention", actionKind: "inventory_plan" });
    expect(model.physical.detail).toMatch(/informational and does not commit stock/i);
  });

  test("keeps a current allocation authoritative when only its earlier availability observation is stale", () => {
    const model = build({
      planRead: planRead(plan({
        freshnessState: {
          ...plan().freshnessState,
          availability: { state: "stale", reason: "stock_state_changed" }
        }
      }))
    });

    expect(model.physical.state).toBe("satisfied");
    expect(model.cost.state).toBe("satisfied");
  });

  test.each([
    ["shortage", "Ingredient allocation has a shortage"],
    ["released", "Ingredient allocation was released"]
  ])("classifies a current %s allocation as attention", (state, title) => {
    const summary = allocation({
      state,
      fullyAllocatedIngredientCount: state === "shortage" ? 0 : 1,
      shortageIngredientCount: state === "shortage" ? 1 : 0
    });
    const freshnessState = {
      ...plan().freshnessState,
      allocation: { state: state === "released" ? "released" : "current", reason: "" }
    };
    expect(build({ planRead: planRead(plan({ allocation: summary, freshnessState })) }).physical)
      .toMatchObject({ state: "attention", title });
  });

  test("classifies stale and incomplete plans as attention without discarding historical holds", () => {
    const stale = build({
      planRead: planRead(plan({
        freshness: "stale",
        freshnessState: {
          ...plan().freshnessState,
          demand: { state: "stale", reason: "commercial_revision_changed" }
        }
      }))
    });
    expect(stale.physical.state).toBe("attention");
    expect(stale.physical.detail).toMatch(/historical hold is preserved/i);

    const incomplete = build({ planRead: planRead(plan({ demandState: "incomplete" })) });
    expect(incomplete.physical).toMatchObject({ state: "attention", title: "Ingredient demand is incomplete" });
  });

  test.each(["cached", "pending", "unavailable", "loading"])("fails a %s plan read to unknown", (state) => {
    const model = build({ planRead: planRead(plan(), { state, sourceState: state }) });
    expect(model.physical.state).toBe("unknown");
    expect(model.cost.state).toBe("unknown");
    expect(model.execution.state).toBe("unknown");
  });

  test("fails a commercial revision identity mismatch to unknown", () => {
    const model = build({ activeQuoteRevisionId: "quote-revision-5" });
    expect(model.physical.state).toBe("unknown");
    expect(model.cost.state).toBe("unknown");
    expect(model.execution.state).toBe("unknown");
    expect(model.physical.evidence).toMatch(/revision mismatch/i);
  });

  test("requires exact current execution evidence before a settled plan passes", () => {
    const settledPlan = plan({
      allocation: allocation({ state: "settled" }),
      freshnessState: { ...plan().freshnessState, allocation: { state: "settled", reason: "" } }
    });
    const missing = build({ planRead: planRead(settledPlan) });
    expect(missing.physical.state).toBe("attention");

    const current = build({
      planRead: planRead(settledPlan),
      executionRead: executionRead(execution())
    });
    expect(current.physical.state).toBe("satisfied");
    expect(current.execution.state).toBe("satisfied");
  });

  test.each(["cached", "pending", "unavailable"])("fails %s settlement evidence to unknown", (state) => {
    const settledPlan = plan({
      allocation: allocation({ state: "settled" }),
      freshnessState: { ...plan().freshnessState, allocation: { state: "settled", reason: "" } }
    });
    const model = build({
      planRead: planRead(settledPlan),
      executionRead: executionRead(execution(), { state, sourceState: state })
    });
    expect(model.physical.state).toBe("unknown");
    expect(model.execution.state).toBe("unknown");
  });

  test("fails mismatched execution identity to unknown", () => {
    const settledPlan = plan({
      allocation: allocation({ state: "settled" }),
      freshnessState: { ...plan().freshnessState, allocation: { state: "settled", reason: "" } }
    });
    const model = build({
      planRead: planRead(settledPlan),
      executionRead: executionRead(execution({ allocationRevision: 9 }))
    });
    expect(model.physical).toMatchObject({ state: "unknown", title: "Settlement identity does not match" });
    expect(model.execution).toMatchObject({ state: "unknown", title: "Ingredient usage identity does not match" });
  });

  test("keeps partial menu cost as attention without changing a valid physical reservation", () => {
    const model = build({ planRead: planRead(plan({ costState: "partial", knownCostMinor: 6000 })) });
    expect(model.physical.state).toBe("satisfied");
    expect(model.cost).toMatchObject({ state: "attention", actionKind: "menu_costing" });
  });

  test("fails a falsely complete menu-cost projection closed", () => {
    const model = build({
      planRead: planRead(plan({ costState: "complete", projectedCostMinor: undefined }))
    });
    expect(model.physical.state).toBe("satisfied");
    expect(model.cost).toMatchObject({
      state: "unknown",
      title: "Projected ingredient cost evidence is invalid"
    });
  });

  test("groups execution quantities only within matching base units and sorts groups", () => {
    const settledPlan = plan({
      allocation: allocation({ state: "settled" }),
      freshnessState: { ...plan().freshnessState, allocation: { state: "settled", reason: "" } }
    });
    const rows = [
      executionRow({ ingredientId: "salt", baseUnitId: "oz", plannedQuantityMicros: 1_000_000, allocatedQuantityMicros: 1_000_000, consumedQuantityMicros: 500_000, wasteQuantityMicros: 0, depletedQuantityMicros: 500_000 }),
      executionRow(),
      executionRow({ ingredientId: "pasta", plannedQuantityMicros: 10_000_000, allocatedQuantityMicros: 10_000_000, consumedQuantityMicros: 9_000_000, wasteQuantityMicros: 1_000_000, depletedQuantityMicros: 10_000_000 })
    ];
    const model = build({
      planRead: planRead(settledPlan),
      executionRead: executionRead(execution({ ingredients: rows }))
    });
    expect(model.execution.metrics).not.toHaveProperty("plannedQuantityMicros");
    expect(model.execution.metrics.baseUnits).toEqual([
      expect.objectContaining({ baseUnitId: "lb", ingredientCount: 2, plannedQuantityMicros: 30_000_000, consumedQuantityMicros: 27_000_000, wasteQuantityMicros: 3_000_000 }),
      expect.objectContaining({ baseUnitId: "oz", ingredientCount: 1, plannedQuantityMicros: 1_000_000, consumedQuantityMicros: 500_000, wasteQuantityMicros: 0 })
    ]);
  });

  test("exposes complete planned-basis variance while keeping actual COGS unavailable", () => {
    const settledPlan = plan({
      allocation: allocation({ state: "settled" }),
      freshnessState: { ...plan().freshnessState, allocation: { state: "settled", reason: "" } }
    });
    const model = build({ planRead: planRead(settledPlan), executionRead: executionRead(execution()) });
    expect(model.execution.metrics.plannedBasisCost).toEqual({
      state: "complete",
      currency: "USD",
      knownUsageCostMinor: 7600,
      plannedProjectedCostMinor: 8000,
      varianceMinor: -400
    });
    expect(model.execution.metrics.actualCogs).toEqual({
      state: "unavailable",
      reason: "valuation_policy_unresolved"
    });
  });

  test("does not aggregate planned-basis money across conflicting currencies", () => {
    const settledPlan = plan({
      allocation: allocation({ state: "settled" }),
      freshnessState: { ...plan().freshnessState, allocation: { state: "settled", reason: "" } }
    });
    const mixed = execution({ ingredients: [executionRow(), executionRow({ ingredientId: "pasta", currency: "CAD" })] });
    const model = build({ planRead: planRead(settledPlan), executionRead: executionRead(mixed) });
    expect(model.execution.state).toBe("satisfied");
    expect(model.execution.metrics.plannedBasisCost).toEqual({
      state: "invalid",
      currency: null,
      knownUsageCostMinor: null,
      plannedProjectedCostMinor: null,
      varianceMinor: null
    });
  });

  test("fails execution metrics closed when actual COGS evidence crosses the unresolved-policy boundary", () => {
    const settledPlan = plan({
      allocation: allocation({ state: "settled" }),
      freshnessState: { ...plan().freshnessState, allocation: { state: "settled", reason: "" } }
    });
    const invalid = execution({
      costSummary: {
        ...execution().costSummary,
        actualCogsState: "complete",
        actualCogsReason: ""
      }
    });
    const model = build({ planRead: planRead(settledPlan), executionRead: executionRead(invalid) });
    expect(model.execution).toMatchObject({
      state: "unknown",
      title: "Ingredient usage evidence is invalid",
      metrics: null
    });
  });

  test("returns a deeply frozen presentation contract", () => {
    const settledPlan = plan({
      allocation: allocation({ state: "settled" }),
      freshnessState: { ...plan().freshnessState, allocation: { state: "settled", reason: "" } }
    });
    const model = build({ planRead: planRead(settledPlan), executionRead: executionRead(execution()) });
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.physical)).toBe(true);
    expect(Object.isFrozen(model.execution.metrics)).toBe(true);
    expect(Object.isFrozen(model.execution.metrics.baseUnits)).toBe(true);
    expect(Object.isFrozen(model.execution.metrics.baseUnits[0])).toBe(true);
    expect(Object.isFrozen(model.execution.metrics.plannedBasisCost)).toBe(true);
    expect(Object.isFrozen(model.execution.metrics.actualCogs)).toBe(true);
  });
});
