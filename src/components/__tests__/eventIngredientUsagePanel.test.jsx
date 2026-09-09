// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import EventIngredientUsagePanel from "../EventIngredientUsagePanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PLAN = {
  allocation: {
    state: "reserved",
    allocationRevision: 1,
    eventRequirementRevisionId: `eir_${"e".repeat(48)}`,
    ingredients: [{
      ingredientId: "chicken",
      ingredientName: "Chicken",
      locationId: "main-kitchen",
      baseUnitId: "lb",
      stockRevision: 1,
      fenceRevision: 1,
      requiredQuantityMicros: 20_000_000,
      allocatedQuantityMicros: 15_000_000,
      shortageQuantityMicros: 5_000_000
    }]
  }
};

function execution(overrides = {}) {
  return {
    state: "settled",
    executionRevision: 1,
    ingredients: [{
      ingredientId: "chicken",
      name: "Chicken",
      locationId: "main-kitchen",
      baseUnitId: "lb",
      plannedQuantityMicros: 20_000_000,
      allocatedQuantityMicros: 15_000_000,
      consumedQuantity: "18.5",
      consumedQuantityMicros: 18_500_000,
      wasteQuantity: "1.5",
      wasteQuantityMicros: 1_500_000,
      resultStockRevision: 2
    }],
    costSummary: {
      actualCogsState: "unavailable",
      actualCogsReason: "valuation_policy_unresolved",
      plannedBasisState: "complete",
      currency: "USD",
      knownUsageCostMinor: 6000,
      plannedProjectedCostMinor: 6000,
      plannedBasisVarianceMinor: 0
    },
    ...overrides
  };
}

const BASE = {
  planRead: { state: "current", sourceState: "current", projection: PLAN },
  read: { state: "not_recorded", sourceState: "current", projection: null },
  operation: { state: "idle" },
  access: { readEnabled: true, mutationEnabled: true, role: "admin" },
  controlsLocked: false,
  onRecord: vi.fn(),
  onCorrect: vi.fn(),
  onReconcile: vi.fn(),
  onReset: vi.fn()
};

let container;
let root;

function render(props = {}) {
  act(() => root.render(<EventIngredientUsagePanel {...BASE} {...props} />));
}

function setValue(input, value) {
  const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label) {
  return [...container.querySelectorAll("button")].find((entry) => entry.textContent.includes(label));
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("requires explicit consumed and waste totals, time, reason, and final acknowledgement", () => {
  render();
  const quantityInputs = container.querySelectorAll('input[inputmode="decimal"]');
  const submit = button("Finish usage capture");
  expect(quantityInputs[0].value).toBe("");
  expect(quantityInputs[1].value).toBe("");
  expect(container.textContent).toContain("Blank values never mean zero");
  expect(submit.disabled).toBe(true);

  act(() => {
    setValue(quantityInputs[0], "18.5");
    setValue(quantityInputs[1], "0");
    setValue(container.querySelector('input[type="datetime-local"]'), "2026-09-09T12:30");
    setValue(container.querySelector('input[placeholder="Event closeout count"]'), "Event closeout count");
    container.querySelector('input[type="checkbox"]').click();
  });
  expect(submit.disabled).toBe(false);
  act(() => submit.click());
  expect(BASE.onRecord).toHaveBeenCalledWith({
    occurredAtISO: expect.stringMatching(/^2026-09-09T/),
    reason: "Event closeout count",
    ingredients: [{
      ingredientId: "chicken",
      locationId: "main-kitchen",
      baseUnitId: "lb",
      expectedStockRevision: 1,
      consumedQuantity: "18.5",
      wasteQuantity: "0"
    }]
  });
});

test("uses full replacement totals and the latest stock revision for correction", () => {
  render({
    planRead: {
      state: "current",
      sourceState: "current",
      projection: { ...PLAN, allocation: { ...PLAN.allocation, state: "settled", allocationRevision: 2 } }
    },
    read: { state: "current", sourceState: "current", projection: execution() }
  });
  const quantityInputs = container.querySelectorAll('input[inputmode="decimal"]');
  expect(quantityInputs[0].value).toBe("18.5");
  expect(quantityInputs[1].value).toBe("1.5");
  act(() => {
    setValue(quantityInputs[0], "18");
    setValue(quantityInputs[1], "1");
    setValue(container.querySelector('input[type="datetime-local"]'), "2026-09-09T13:30");
    setValue(container.querySelector('input[placeholder="Why these totals changed"]'), "Corrected kitchen count");
    container.querySelector('input[type="checkbox"]').click();
  });
  act(() => button("Record corrected totals").click());
  expect(BASE.onCorrect).toHaveBeenCalledWith(expect.objectContaining({
    reason: "Corrected kitchen count",
    ingredients: [expect.objectContaining({
      expectedStockRevision: 2,
      consumedQuantity: "18",
      wasteQuantity: "1"
    })]
  }));
});

test("keeps sales read-only and cached or pending evidence non-editable", () => {
  render({ access: { readEnabled: true, mutationEnabled: false, role: "sales" } });
  expect(container.textContent).toContain("administrator must record or correct");
  expect(container.querySelector('input[inputmode="decimal"]').disabled).toBe(true);

  render({
    access: BASE.access,
    read: { state: "cached", sourceState: "cached", projection: execution() },
    controlsLocked: true
  });
  expect(container.getAttribute("data-nothing")).toBeNull();
  expect(container.querySelector("[data-event-ingredient-usage]").dataset.capabilityState).toBe("pending");
  expect(container.querySelector('input[inputmode="decimal"]').disabled).toBe(true);
});

test("labels saved planned-basis comparison without claiming authoritative actual COGS", () => {
  render({
    planRead: {
      state: "current",
      sourceState: "current",
      projection: { ...PLAN, allocation: { ...PLAN.allocation, state: "settled" } }
    },
    read: { state: "current", sourceState: "current", projection: execution() }
  });
  expect(container.textContent).toContain("Planned-basis comparison");
  expect(container.textContent).toContain("Saved projected ingredient cost");
  expect(container.textContent).toContain("$60.00");
  expect(container.textContent).toContain("not authoritative actual COGS");
  expect(container.textContent).not.toContain("Actual COGS: $60.00");
});

test("surfaces receipt wait and exact-request recovery states", () => {
  render({ operation: { state: "receipt", requestId: "inventory_request_receipt" } });
  expect(container.textContent).toContain("waiting for the exact execution projection");
  render({ operation: { state: "uncertain", requestId: "inventory_request_uncertain", message: "Connection ended." } });
  expect(button("Reconcile exact request")).toBeTruthy();
  act(() => button("Reconcile exact request").click());
  expect(BASE.onReconcile).toHaveBeenCalledWith({ requestId: "inventory_request_uncertain" });
  render({ operation: { state: "error", requestId: "inventory_request_rejected" } });
  act(() => button("Reset rejected request").click());
  expect(BASE.onReset).toHaveBeenCalledWith({ requestId: "inventory_request_rejected" });
});
