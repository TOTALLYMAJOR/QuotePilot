// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import InventoryRecipeEditor, { InventoryMenuCostSummary } from "../InventoryRecipeEditor";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INGREDIENTS = [
  { ingredientId: "chicken", name: "Chicken", baseUnitId: "lb", supportedRecipeUnits: ["oz"] },
  { ingredientId: "pasta", name: "Pasta", baseUnitId: "lb" }
];

const RECIPE = {
  menuItemId: "menu-alfredo",
  recipeRevision: 4,
  outputYield: "10",
  outputUnitId: "portion",
  lines: [
    { lineId: "line-chicken", ingredientId: "chicken", quantity: "2", unitKind: "standard", unitId: "lb", quantityBasis: "as_purchased", usableYield: null },
    { lineId: "line-pasta", ingredientId: "pasta", quantity: "1", unitKind: "standard", unitId: "lb", quantityBasis: "as_purchased", usableYield: null }
  ]
};

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
});

function editorElement(props = {}) {
  return (
    <InventoryRecipeEditor
      menuItem={{ id: "menu-alfredo", name: "Chicken Alfredo" }}
      ingredients={INGREDIENTS}
      recipe={RECIPE}
      ingredientSourceState="current"
      publishEligibility={{ allowed: true }}
      onPublish={async () => ({ state: "committed" })}
      {...props}
    />
  );
}

function mount(props = {}) {
  act(() => root.render(editorElement(props)));
}

function rerender(props = {}) {
  act(() => root.render(editorElement(props)));
}

function change(element, value) {
  act(() => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

describe("InventoryRecipeEditor", () => {
  test("publishes an exact menu-item recipe payload without deriving cost in React", async () => {
    const onPublish = vi.fn(async () => ({
      state: "committed",
      message: "Recipe v5 committed.",
      attempt: { receipt: { receiptId: "receipt-5" } }
    }));
    const onInteractionStateChange = vi.fn();
    mount({
      onPublish,
      onInteractionStateChange,
      expectedCatalogRevision: 9,
      projection: {
        menuItemId: "menu-alfredo",
        state: "complete",
        projectedIngredientCostDisplay: "$8.00",
        costPerYieldUnitDisplay: "$0.80",
        recipeDefinition: { outputUnitId: "portion" },
        coverage: { costedIngredients: 2, totalIngredients: 2 }
      }
    });
    expect(container.querySelector(".inventory-recipe-editor__actions").outerHTML)
      .toContain('data-capability-state="ready"');

    const yieldInput = container.querySelector('fieldset input[inputmode="decimal"]');
    change(yieldInput, "12.5");
    expect(container.querySelector('button[type="submit"]').disabled).toBe(false);

    await act(async () => {
      container.querySelector('button[type="submit"]').click();
    });

    expect(onPublish).toHaveBeenCalledWith({
      kind: "publish_menu_recipe",
      menuItemId: "menu-alfredo",
      expectedCatalogRevision: 9,
      expectedRecipeRevision: 4,
      outputYield: "12.5",
      outputUnitId: "portion",
      lines: [
        { lineId: "line-chicken", ingredientId: "chicken", quantity: "2", unitKind: "standard", unitId: "lb", quantityBasis: "as_purchased", usableYield: null },
        { lineId: "line-pasta", ingredientId: "pasta", quantity: "1", unitKind: "standard", unitId: "lb", quantityBasis: "as_purchased", usableYield: null }
      ]
    });
    const committed = container.querySelector("[data-recipe-operation-state='committed'][data-capability-state='success']");
    expect(committed.outerHTML).toContain('data-capability-state="success"');
    expect(committed.textContent).toContain("Recipe v5 committed");
    expect(container.querySelector(".inventory-recipe-editor__receipt").outerHTML)
      .toContain('data-capability-state="receipt"');
    expect(container.textContent).toContain("Recipe ingredient cost · $8.00");
    expect(container.textContent).toContain("$0.80 per portion");
    expect(container.textContent).toContain("Selling price and manual catalog cost remain unchanged");
    expect(onInteractionStateChange).toHaveBeenCalledWith({ dirty: true, busy: false, locked: true });
  });

  test("keeps partial, stale, unavailable, and invalid evidence explicit", () => {
    for (const state of ["partial", "stale", "unavailable", "invalid"]) {
      mount({
        projection: {
          menuItemId: "menu-alfredo",
          state,
          ...(state === "partial" ? { projectedIngredientCostDisplay: "$6.00" } : {}),
          issues: [{ message: state === "partial" ? "Missing cost: Parmesan" : `Projection ${state}` }]
        }
      });
      const evidence = container.querySelector(".inventory-recipe-editor__cost");
      expect(evidence.dataset.menuCostState).toBe(state);
      expect(evidence.dataset.capabilityState).toBe(
        state === "partial" ? "partial" : state === "stale" ? "stale" : "error"
      );
      expect(evidence.textContent).toContain(state === "partial" ? "Partial recipe ingredient cost" : "unavailable");
      if (state === "partial") expect(evidence.outerHTML).toContain('data-capability-state="partial"');
      if (state === "stale") expect(evidence.outerHTML).toContain('data-capability-state="stale"');
      if (state === "unavailable") expect(evidence.outerHTML).toContain('data-capability-state="error"');
    }
  });

  test("disables publication for retained ingredient data and explains recovery", () => {
    mount({ ingredientSourceState: "cached" });
    expect(container.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(container.querySelector("[data-recipe-publish-disabled]").textContent)
      .toContain("Reconnect current ingredient projections");
    expect(container.querySelector("[data-recipe-publish-disabled]").outerHTML)
      .toContain('data-capability-state="recovery"');
  });

  test("renders loading while the exact active-menu projection is unresolved", () => {
    mount({ recipeSourceState: "loading", recipe: null });
    expect(container.querySelector(".inventory-recipe-editor__cost").outerHTML)
      .toContain('data-capability-state="loading"');
    expect(container.querySelector("fieldset").disabled).toBe(true);
    expect(container.querySelector(".inventory-recipe-editor__lines input")).toBeNull();
  });

  test("locks the recipe while a publication is submitting", async () => {
    let resolvePublish;
    const onPublish = vi.fn(() => new Promise((resolve) => { resolvePublish = resolve; }));
    mount({ onPublish });
    change(container.querySelector('fieldset input[inputmode="decimal"]'), "11");

    await act(async () => {
      container.querySelector('button[type="submit"]').click();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-recipe-operation-state='pending']").outerHTML)
      .toContain('data-capability-state="submitting"');

    await act(async () => resolvePublish({ state: "committed" }));
  });

  test("locks an uncertain request to its reconciliation action", async () => {
    const error = Object.assign(new Error("network ended"), {
      inventoryDefinitive: false,
      inventoryAttempt: { requestId: "inventory_request_123" }
    });
    const onPublish = vi.fn(async () => { throw error; });
    let resolveReconcile;
    const onReconcile = vi.fn(() => new Promise((resolve) => { resolveReconcile = resolve; }));
    mount({ onPublish, onReconcile });
    change(container.querySelector('fieldset input[inputmode="decimal"]'), "11");

    await act(async () => container.querySelector('button[type="submit"]').click());
    const uncertain = container.querySelector("[data-recipe-operation-state='uncertain'][data-capability-state='uncertain']");
    expect(uncertain.outerHTML).toContain('data-capability-state="uncertain"');
    expect(uncertain.textContent).toContain("Reconcile");
    expect(container.querySelector("button[type='submit']").disabled).toBe(true);
    expect(container.querySelector(".inventory-recipe-editor__lines input[inputmode='decimal']").disabled).toBe(true);
    expect(container.querySelector(".inventory-recipe-editor__lines select").disabled).toBe(true);

    rerender({
      onPublish,
      onReconcile,
      recipe: { ...RECIPE, recipeRevision: 5, outputYield: "12" }
    });
    expect(container.querySelector('fieldset input[inputmode="decimal"]').value).toBe("11");
    expect(container.querySelector("[data-recipe-operation-state='uncertain']")).not.toBeNull();
    expect(container.textContent).toContain("A newer recipe revision arrived");

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Reconcile exact"))?.click();
      await Promise.resolve();
    });
    expect(onReconcile).toHaveBeenCalledWith({ requestId: "inventory_request_123" });
    expect(container.querySelector("[data-recipe-operation-state='reconciliation']").outerHTML)
      .toContain('data-capability-state="reconciliation"');
    await act(async () => resolveReconcile({ state: "committed", message: "Exact request found." }));
    expect(container.querySelector("[data-recipe-operation-state='committed']").textContent).toContain("Exact request found");
  });

  test("clears a definitive rejected request before allowing a corrected retry", async () => {
    const onPublish = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Catalog revision changed."), {
        inventoryDefinitive: true,
        inventoryAttempt: { requestId: "inventory_request_rejected" }
      }))
      .mockResolvedValueOnce({ state: "committed", message: "Corrected recipe committed." });
    const onReset = vi.fn(async () => ({ state: "idle" }));
    const onInteractionStateChange = vi.fn();
    mount({ onPublish, onReset, onInteractionStateChange });
    const yieldInput = container.querySelector('fieldset input[inputmode="decimal"]');
    change(yieldInput, "11");

    await act(async () => container.querySelector('button[type="submit"]').click());
    const rejected = container.querySelector("[data-recipe-operation-state='rejected']");
    expect(rejected.outerHTML).toContain('data-capability-state="error"');
    expect(yieldInput.closest("fieldset").disabled).toBe(true);
    expect(onInteractionStateChange).toHaveBeenLastCalledWith({ dirty: true, busy: false, locked: true });

    rerender({
      onPublish,
      onReset,
      onInteractionStateChange,
      recipe: { ...RECIPE, recipeRevision: 5, outputYield: "12" }
    });
    act(() => Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Use current recipe"))?.click());
    expect(container.querySelector('fieldset input[inputmode="decimal"]').value).toBe("12");
    expect(onInteractionStateChange).toHaveBeenLastCalledWith({ dirty: false, busy: false, locked: true });

    await act(async () => Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Review and retry"))?.click());
    expect(onReset).toHaveBeenCalledWith({ requestId: "inventory_request_rejected" });
    expect(yieldInput.closest("fieldset").disabled).toBe(false);
    expect(onInteractionStateChange).toHaveBeenLastCalledWith({ dirty: false, busy: false, locked: false });

    change(yieldInput, "13");
    await act(async () => container.querySelector('button[type="submit"]').click());
    expect(onPublish).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Corrected recipe committed");
  });

  test("does not authorize publication from a cached exact recipe projection", () => {
    mount({ recipeSourceState: "cached" });
    change(container.querySelector('fieldset input[inputmode="decimal"]'), "11");
    expect(container.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(container.querySelector("[data-recipe-publish-disabled]").textContent)
      .toContain("current exact menu recipe projection");
  });

  test("preserves a dirty local draft when a realtime recipe revision arrives", () => {
    mount();
    change(container.querySelector('fieldset input[inputmode="decimal"]'), "11");

    rerender({ recipe: { ...RECIPE, recipeRevision: 5, outputYield: "12" } });
    expect(container.querySelector('fieldset input[inputmode="decimal"]').value).toBe("11");
    expect(container.querySelector("fieldset").disabled).toBe(true);
    expect(container.textContent).toContain("A newer recipe revision arrived");

    act(() => Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Use current recipe"))?.click());
    expect(container.querySelector('fieldset input[inputmode="decimal"]').value).toBe("12");
    expect(container.querySelector("fieldset").disabled).toBe(false);
  });

  test("shows no-recipe state and only units supplied by ingredient authority", () => {
    mount({ recipe: null });
    const empty = container.querySelector("[data-recipe-definition-state='no_recipe'] [data-capability-state='empty']");
    expect(empty.outerHTML).toContain('data-capability-state="empty"');
    expect(container.textContent).toContain("No current cost projection");
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Add ingredient"))?.click());
    const unitSelect = container.querySelectorAll(".inventory-recipe-editor__lines select")[1];
    expect(Array.from(unitSelect.options).map((option) => option.value)).toEqual(["", "standard:lb", "standard:oz"]);
  });
});

test("InventoryMenuCostSummary gives sales bounded read-only cost intelligence", () => {
  act(() => root.render(<InventoryMenuCostSummary projections={[
    { menuItemId: "menu-alfredo", menuItemName: "Chicken Alfredo", state: "complete", costPerYieldUnitDisplay: "$1.84", recipeDefinition: { outputUnitId: "portion" } },
    { menuItemId: "menu-salad", menuItemName: "Garden Salad", state: "partial", costPerYieldUnitDisplay: "$0.82", recipeDefinition: { outputUnitId: "portion" } }
  ]} />));

  expect(container.querySelectorAll("[data-menu-cost-summary] li")).toHaveLength(2);
  expect(container.textContent).toContain("Chicken Alfredo");
  expect(container.textContent).toContain("Partial · $0.82 / portion");
  expect(container.textContent).toContain("separate from selling price and stock availability");
  expect(container.querySelector("button")).toBeNull();
});
