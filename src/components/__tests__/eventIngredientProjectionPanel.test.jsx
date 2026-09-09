// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import EventIngredientProjectionPanel from "../EventIngredientProjectionPanel";

let container;
let root;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SELECTION = {
  selectionId: "selection-alfredo",
  menuItemId: "chicken-alfredo",
  menuItemName: "Chicken Alfredo",
  recipeRevisionId: `irr_${"a".repeat(48)}`,
  portionBasis: { kind: "explicit_output_quantity", evidenceId: "chicken-alfredo" },
  commercialProvenance: { kind: "direct", sourceId: "chicken-alfredo" }
};

function projection(overrides = {}) {
  return {
    quoteId: "quote-1",
    quoteRevisionId: "quote-revision-2",
    demandState: "complete",
    costState: "complete",
    availabilityState: "shortage",
    currency: "USD",
    projectedCostMinor: 8000,
    knownCostMinor: 8000,
    coverage: {
      selectedMenuItemCount: 1,
      compiledMenuItemCount: 1,
      ingredientCount: 2,
      costedIngredientCount: 2,
      stockKnownIngredientCount: 2,
      availableIngredientCount: 1,
      shortageIngredientCount: 1
    },
    ingredients: [{
      ingredientId: "chicken",
      baseUnitId: "lb",
      requiredQuantityMicros: 20_000_000,
      onHandQuantityMicros: 40_000_000,
      committedQuantityMicros: 25_000_000,
      availableToAllocateQuantityMicros: 15_000_000,
      shortageQuantityMicros: 5_000_000,
      availabilityState: "shortage"
    }],
    ...overrides
  };
}

function render(props = {}) {
  act(() => root.render(<EventIngredientProjectionPanel {...props} />));
}

function button(label) {
  return [...container.querySelectorAll("button")].find((entry) => entry.textContent.includes(label));
}

function changeInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("requires explicit per-menu recipe output quantity and unit without guessing from guests or billing", () => {
  const onPreview = vi.fn();
  render({
    selectedMenuItems: [{ ...SELECTION, guestCount: 100, billingQuantity: 100 }],
    read: { state: "not_evaluated", projection: null },
    canPreview: true,
    onPreview
  });

  const inputs = container.querySelectorAll("input");
  expect(inputs[0].value).toBe("");
  expect(inputs[1].value).toBe("");
  expect(container.textContent).toMatch(/does not infer this from guests or billing quantity/i);
  expect(container.textContent).toMatch(/needs an explicit required recipe output quantity/i);
  expect(container.querySelector("[data-event-ingredient-panel]").getAttribute("data-capability-state")).toBe("empty");
  expect(container.querySelector(".event-ingredient-panel__issues").getAttribute("data-capability-state")).toBe("partial");
  expect(container.innerHTML).toContain('data-capability-state="empty"');
  expect(container.innerHTML).toContain('data-capability-state="partial"');
  expect(button("Preview ingredient impact").disabled).toBe(true);

  act(() => {
    changeInput(inputs[0], "100");
    changeInput(inputs[1], "portion");
  });
  expect(button("Preview ingredient impact").disabled).toBe(false);
  expect(container.innerHTML).toContain('data-capability-state="ready"');
  act(() => button("Preview ingredient impact").click());
  expect(onPreview).toHaveBeenCalledWith({
    selections: [expect.objectContaining({
      menuItemId: "chicken-alfredo",
      requiredOutputQuantity: "100",
      outputUnitId: "portion",
      portionBasis: { kind: "explicit_output_quantity", evidenceId: "chicken-alfredo" }
    })]
  });
  expect(onPreview.mock.calls[0][0].selections[0]).not.toHaveProperty("guestCount");
});

test("previews a missing recipe as explicit incomplete evidence without inventing an output unit", async () => {
  const onPreview = vi.fn().mockResolvedValue({});
  render({
    selectedMenuItems: [{
      ...SELECTION,
      recipeRevisionId: null,
      outputUnitId: null,
      requiredOutputQuantity: "100"
    }],
    read: { state: "not_evaluated", projection: null },
    canPreview: true,
    onPreview
  });

  const inputs = container.querySelectorAll("input");
  expect(inputs[1].disabled).toBe(true);
  expect(container.textContent).toMatch(/recipe missing/i);
  expect(button("Preview ingredient impact").disabled).toBe(false);
  await act(async () => button("Preview ingredient impact").click());
  expect(onPreview).toHaveBeenCalledWith({
    selections: [expect.objectContaining({ recipeRevisionId: null, outputUnitId: null })]
  });
});

test("invalidates recording when displayed quantities change after preview", async () => {
  const onPreview = vi.fn().mockResolvedValue({});
  const onRecord = vi.fn().mockResolvedValue({});
  render({
    selectedMenuItems: [{ ...SELECTION, requiredOutputQuantity: "100", outputUnitId: "portion" }],
    read: { state: "recorded", projection: projection() },
    preview: { state: "current", projection: projection() },
    canPreview: true,
    canRecord: true,
    onPreview,
    onRecord
  });

  await act(async () => button("Preview ingredient impact").click());
  expect(button("Record requirement").disabled).toBe(false);
  act(() => changeInput(container.querySelectorAll("input")[0], "120"));
  expect(button("Record requirement").disabled).toBe(true);
  expect(button("Record requirement").title).toMatch(/preview the currently displayed quantities/i);
  expect(onRecord).not.toHaveBeenCalled();
});

test.each([
  ["complete", "unavailable", "shortage", "Calculated", "Cost evidence unavailable", "Shortage"],
  ["incomplete", "complete", "available", "Needs portion or recipe evidence", "$80.00", "Available to allocate"],
  ["complete", "partial", "unavailable", "Calculated", "Known contribution only", "Stock not evaluated"]
])("keeps demand %s, cost %s, and availability %s as independent result rails", (
  demandState, costState, availabilityState, demandLabel, costLabel, availabilityLabel
) => {
  const value = projection({
    demandState,
    costState,
    availabilityState,
    ...(costState === "unavailable" ? { currency: undefined, projectedCostMinor: undefined, knownCostMinor: undefined } : {}),
    ...(costState === "partial" ? { projectedCostMinor: undefined, knownCostMinor: 6000 } : {})
  });
  render({
    selectedMenuItems: [{ ...SELECTION, requiredOutputQuantity: "100", outputUnitId: "portion" }],
    read: { state: "current", projection: value },
    preview: { state: "not_evaluated", projection: null }
  });

  expect(container.querySelector("[data-ingredient-demand-state]").textContent).toContain(demandLabel);
  expect(container.querySelector("[data-ingredient-cost-state]").textContent).toContain(costLabel);
  expect(container.querySelector("[data-ingredient-availability-state]").textContent).toContain(availabilityLabel);
});

test("labels a dirty quote as draft-not-evaluated while retaining the saved projection separately", () => {
  render({
    selectedMenuItems: [{ ...SELECTION, requiredOutputQuantity: "120", outputUnitId: "portion" }],
    quoteDirty: true,
    read: { state: "current", projection: projection() },
    canPreview: true,
    canRecord: false,
    recordBlockedReason: "Save the quote revision before recording ingredient requirements.",
    onPreview: vi.fn(),
    onRecord: vi.fn()
  });

  expect(container.querySelector("[data-event-ingredient-read-state]").dataset.eventIngredientReadState)
    .toBe("draft_not_evaluated");
  expect(container.textContent).toMatch(/belongs to the saved quote revision/i);
  expect(container.querySelector("[data-projection-kind]").textContent).toMatch(/saved requirement/i);
  expect(button("Record requirement").disabled).toBe(true);
  expect(container.textContent).toContain("Save the quote revision");
  expect(container.querySelector("[data-event-ingredient-panel]").getAttribute("data-capability-state")).toBe("stale");
  expect(container.innerHTML).toContain('data-capability-state="stale"');
});

test("shows a read-only preview without treating it as a recorded requirement", () => {
  render({
    selectedMenuItems: [{ ...SELECTION, requiredOutputQuantity: "100", outputUnitId: "portion" }],
    read: { state: "current", projection: projection() },
    preview: { state: "current", projection: projection() },
    canPreview: true,
    canRecord: false,
    onPreview: vi.fn()
  });
  expect(container.querySelector("[data-projection-kind]").textContent).toMatch(/read-only preview/i);
  expect(container.textContent).toContain("$80.00");
  expect(button("Record requirement")).toBeUndefined();
  expect(container.querySelector("[data-event-ingredient-panel]").getAttribute("data-capability-state")).toBe("success");
  expect(container.innerHTML).toContain('data-capability-state="success"');
});

test("locks target inputs in uncertain recovery and exposes one reconcile action", () => {
  const onReconcile = vi.fn();
  render({
    selectedMenuItems: [{ ...SELECTION, requiredOutputQuantity: "100", outputUnitId: "portion" }],
    read: { state: "unavailable", retained: true, projection: projection() },
    operation: { state: "uncertain", message: "No verified receipt returned." },
    controlsLocked: true,
    canPreview: false,
    canRecord: false,
    onPreview: vi.fn(),
    onRecord: vi.fn(),
    onReconcile
  });

  expect(container.querySelector("fieldset").disabled).toBe(true);
  expect(container.querySelector("[data-ingredient-operation-state='uncertain']").getAttribute("role")).toBe("alert");
  expect(button("Preview ingredient impact").disabled).toBe(true);
  expect(container.querySelector("[data-event-ingredient-panel]").getAttribute("data-capability-state")).toBe("error");
  expect(button("Reconcile request").getAttribute("data-capability-state")).toBe("recovery");
  expect(container.querySelector("[data-ingredient-operation-state]").getAttribute("data-capability-state")).toBe("uncertain");
  expect(container.innerHTML).toContain('data-capability-state="error"');
  expect(container.innerHTML).toContain('data-capability-state="recovery"');
  expect(container.innerHTML).toContain('data-capability-state="uncertain"');
  act(() => button("Reconcile request").click());
  expect(onReconcile).toHaveBeenCalledOnce();
});

test("exposes loading and committed receipt states without promoting either to current evidence", () => {
  render({
    selectedMenuItems: [{ ...SELECTION, requiredOutputQuantity: "100", outputUnitId: "portion" }],
    read: { state: "loading", projection: null }
  });
  expect(container.querySelector("[data-event-ingredient-panel]").getAttribute("data-capability-state")).toBe("loading");
  expect(container.innerHTML).toContain('data-capability-state="loading"');

  render({
    selectedMenuItems: [{ ...SELECTION, requiredOutputQuantity: "100", outputUnitId: "portion" }],
    read: { state: "recorded", projection: projection() },
    operation: { state: "pending", message: "Recording requirement…" },
    controlsLocked: true
  });
  expect(container.innerHTML).toContain('data-capability-state="submitting"');

  render({
    selectedMenuItems: [{ ...SELECTION, requiredOutputQuantity: "100", outputUnitId: "portion" }],
    read: { state: "recorded", projection: projection() },
    operation: { state: "reconciliation", message: "Checking exact request…" },
    controlsLocked: true
  });
  expect(container.innerHTML).toContain('data-capability-state="reconciliation"');

  render({
    selectedMenuItems: [{ ...SELECTION, requiredOutputQuantity: "100", outputUnitId: "portion" }],
    read: { state: "recorded", projection: projection() },
    operation: { state: "committed", message: "Requirement recorded." }
  });
  expect(container.querySelector("[data-ingredient-operation-state]").getAttribute("data-capability-state")).toBe("receipt");
  expect(container.innerHTML).toContain('data-capability-state="receipt"');
});

test("keeps the ingredient table keyboard-scrollable and reports consumable availability quantities", () => {
  render({
    selectedMenuItems: [{ ...SELECTION, requiredOutputQuantity: "100", outputUnitId: "portion" }],
    read: { state: "current", projection: projection() }
  });
  const region = container.querySelector("[role='region'][aria-label='Event ingredient requirements']");
  expect(region.tabIndex).toBe(0);
  expect(region.textContent).toContain("20 lb");
  expect(region.textContent).toContain("40 lb");
  expect(region.textContent).toContain("25 lb");
  expect(region.textContent).toContain("15 lb");
  expect(region.textContent).toContain("5 lb");
});
