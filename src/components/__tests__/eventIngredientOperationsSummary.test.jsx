// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import EventIngredientOperationsSummary from "../EventIngredientOperationsSummary";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const REQUIREMENT_ID = `eir_${"e".repeat(48)}`;
const EXECUTION_ID = `eix_${"a".repeat(48)}`;

function plan(overrides = {}) {
  return {
    quoteId: "quote-1",
    quoteRevisionId: "revision-4",
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
    allocation: {
      state: "reserved",
      eventPlanId: "event_plan_1",
      allocationRevision: 2,
      eventRequirementRevisionId: REQUIREMENT_ID,
      shortageIngredientCount: 0
    },
    ...overrides
  };
}

function execution() {
  return {
    quoteId: "quote-1",
    eventPlanId: "event_plan_1",
    eventRequirementRevisionId: REQUIREMENT_ID,
    allocationRevision: 2,
    state: "settled",
    executionRevision: 1,
    eventExecutionRevisionId: EXECUTION_ID,
    settlementExecutionRevisionId: EXECUTION_ID,
    lastReceiptId: "receipt-1",
    ingredients: [
      { ingredientId: "chicken", baseUnitId: "lb", plannedQuantityMicros: 20_000_000, allocatedQuantityMicros: 20_000_000, consumedQuantityMicros: 18_000_000, wasteQuantityMicros: 2_000_000, depletedQuantityMicros: 20_000_000, plannedBasisCostState: "complete", currency: "USD" },
      { ingredientId: "tray", baseUnitId: "each", plannedQuantityMicros: 5_000_000, allocatedQuantityMicros: 5_000_000, consumedQuantityMicros: 4_000_000, wasteQuantityMicros: 1_000_000, depletedQuantityMicros: 5_000_000, plannedBasisCostState: "complete", currency: "USD" }
    ],
    costSummary: {
      actualCogsState: "unavailable",
      actualCogsReason: "valuation_policy_unresolved",
      plannedBasisState: "complete",
      currency: "USD",
      knownUsageCostMinor: 7600,
      plannedProjectedCostMinor: 8000,
      plannedBasisVarianceMinor: -400
    }
  };
}

const BASE = {
  planRead: { state: "current", sourceState: "current", projection: plan() },
  executionRead: { state: "not_recorded", sourceState: "current", projection: null },
  activeQuoteRevisionId: "revision-4",
  onOpenPlan: vi.fn()
};

let container;
let root;

function render(props = {}) {
  act(() => root.render(<EventIngredientOperationsSummary {...BASE} {...props} />));
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("renders physical, costing, and execution as independent accessible checks", () => {
  render({ planRead: { ...BASE.planRead, projection: plan({ costState: "unavailable" }) } });
  expect(container.querySelector('[data-ingredient-operations-axis="physical"]').dataset.axisState).toBe("satisfied");
  expect(container.querySelector('[data-ingredient-operations-axis="cost"]').dataset.axisState).toBe("unknown");
  expect(container.querySelector('[data-ingredient-operations-axis="execution"]').dataset.axisState).toBe("attention");
  expect(container.textContent).toContain("Missing recorded cost remains unknown");
  expect(container.textContent).not.toContain("$0.00");
  expect(container.querySelector('[role="status"]').getAttribute("aria-live")).toBe("polite");
  expect(container.querySelector('[role="status"]').textContent).toContain("Menu cost: Projected ingredient cost is unknown");
});

test("announces realtime axis changes and supports the caller heading hierarchy", () => {
  render({ headingLevel: 5 });
  const before = container.querySelector('[role="status"]').textContent;
  expect(container.querySelector("h5").textContent).toBe("Stock, cost, and usage");

  render({
    headingLevel: 5,
    planRead: { ...BASE.planRead, projection: plan({ costState: "unavailable" }) }
  });

  const after = container.querySelector('[role="status"]').textContent;
  expect(after).not.toBe(before);
  expect(after).toContain("Menu cost: Projected ingredient cost is unknown");
});

test("offers one parent-owned role-safe action for the highest-priority axis", () => {
  render();
  const buttons = container.querySelectorAll("button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0].textContent).toContain("Review ingredient usage");
  act(() => buttons[0].click());
  expect(BASE.onOpenPlan).toHaveBeenCalledWith({ actionKind: "ingredient_execution" });
});

test("renders current settled quantities by base unit without a cross-unit total", () => {
  const settled = plan({
    allocation: { ...plan().allocation, state: "settled" },
    freshnessState: { ...plan().freshnessState, allocation: { state: "settled", reason: "" } }
  });
  render({
    planRead: { state: "current", sourceState: "current", projection: settled },
    executionRead: { state: "current", sourceState: "current", projection: execution() }
  });
  const unitGroups = container.querySelectorAll('.event-ingredient-operations__metrics > section[aria-label^="Ingredient usage in"]');
  expect(unitGroups).toHaveLength(2);
  expect(unitGroups[0].getAttribute("aria-label")).toBe("Ingredient usage in each");
  expect(unitGroups[1].getAttribute("aria-label")).toBe("Ingredient usage in lb");
  expect(container.textContent).toContain("18");
  expect(container.textContent).toContain("$76.00");
  expect(container.textContent).toContain("-$4.00");
  expect(container.textContent).toMatch(/Actual COGS is unavailable/i);
  expect(container.textContent).not.toContain("Total planned quantity");
  expect(container.querySelector("[data-event-ingredient-operations-summary]").dataset.capabilityState).toBe("success");
});

test("fails cached evidence to an unavailable summary and keeps the callback bounded", () => {
  render({ planRead: { state: "cached", sourceState: "cached", projection: plan() } });
  expect(container.querySelector("[data-event-ingredient-operations-summary]").dataset.capabilityState).toBe("unavailable");
  expect(container.querySelectorAll('[data-axis-state="unknown"]')).toHaveLength(3);
  act(() => container.querySelector("button").click());
  expect(BASE.onOpenPlan).toHaveBeenCalledWith({ actionKind: "inventory_plan" });
});

test("renders no action when the parent does not authorize a callback", () => {
  render({ onOpenPlan: undefined });
  expect(container.querySelector("button")).toBeNull();
});
