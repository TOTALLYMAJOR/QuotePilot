// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import InventoryWorkspace, { InventoryWorkspaceView } from "../InventoryWorkspace";

const ORGANIZATION_ID = "org-inventory-workspace";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;

function attempt(state = "ready", overrides = {}) {
  return { state, error: "", requestId: "", receipt: null, confirmation: null, ...overrides };
}

function attempts(overrides = {}) {
  return {
    location: attempt(),
    ingredient: attempt(),
    stock: attempt(),
    receiving: attempt(),
    cost: attempt(),
    conversion: attempt(),
    ...overrides
  };
}

function projectionModel(overrides = {}) {
  return {
    schemaVersion: 2,
    organizationId: ORGANIZATION_ID,
    workspace: {
      organizationId: ORGANIZATION_ID,
      locations: [{ locationId: "main-kitchen", name: "Main kitchen", active: true, revision: 1 }]
    },
    ingredients: [{
      organizationId: ORGANIZATION_ID,
      ingredientId: "chicken",
      name: "Chicken",
      nameSortKey: "chicken",
      category: "Protein",
      baseUnitId: "lb",
      dimension: "mass",
      active: true,
      ingredientRevision: 1,
      stock: {
        state: "recorded",
        availability: "current",
        revision: 1,
        onHandMicros: 40_000_000,
        quantity: "40",
        allocationRevision: 1,
        committedMicros: 25_000_000,
        committedQuantity: "25",
        availableToAllocateMicros: 15_000_000,
        availableToAllocateQuantity: "15",
        unit: "lb",
        locationId: "main-kitchen",
        lastMovementId: `imv_${"a".repeat(48)}`
      },
      cost: {
        state: "not_recorded",
        availability: "not_yet_available",
        revision: 0,
        sourceLabel: "",
        observedAtISO: "",
        lastCostEvidenceId: ""
      },
      packConversions: [],
      locationId: "main-kitchen",
      locationName: "Main kitchen"
    }],
    sources: {
      workspace: { state: "current", fromCache: false, hasPendingWrites: false },
      ingredients: { state: "current", fromCache: false, hasPendingWrites: false }
    },
    freshness: "current",
    bounded: false,
    ...overrides
  };
}

function ingredientTraceResult(ingredientId = "chicken", overrides = {}) {
  return {
    schemaVersion: 2,
    organizationId: ORGANIZATION_ID,
    ingredientId,
    ingredientRevision: 1,
    stockRevision: 1,
    allocationRevision: 1,
    baseUnitId: "lb",
    movements: [{
      movementId: `imv_${"a".repeat(48)}`,
      receiptId: `iar_${"b".repeat(48)}`,
      commandKind: "receive_stock",
      kind: "receive_stock",
      quantityMicros: 10_000_000,
      quantity: "10",
      baseUnitId: "lb",
      occurredAtISO: "2026-09-09T04:00:00.000Z",
      recordedAtISO: "2026-09-09T05:00:00.000Z",
      sourceLabel: "Vendor receipt 1842"
    }],
    movementPage: {
      limit: 25,
      size: 1,
      bounded: true,
      complete: true,
      hasNext: false,
      cursor: null,
      nextCursor: null
    },
    commitments: {
      complete: true,
      fenceRevision: 1,
      totalQuantityMicros: 25_000_000,
      totalQuantity: "25",
      rows: [{
        quoteId: "quote-event-1",
        eventPlanId: `eip_${"c".repeat(48)}`,
        eventRequirementRevisionId: `eir_${"d".repeat(48)}`,
        allocationRevision: 1,
        planState: "reserved",
        requiredByISO: "2026-10-04T22:00:00.000Z",
        allocatedQuantityMicros: 25_000_000,
        allocatedQuantity: "25"
      }]
    },
    ...overrides
  };
}

const ADMIN_ACCESS = Object.freeze({
  organizationId: ORGANIZATION_ID,
  role: "admin",
  readEnabled: true,
  mutationEnabled: true,
  reason: ""
});

function viewMarkup({ model = projectionModel(), readState = "current", attemptOverrides = {}, access = ADMIN_ACCESS } = {}) {
  return renderToStaticMarkup(
    <InventoryWorkspaceView
      access={access}
      read={{ state: readState, model, error: "" }}
      attempts={attempts(attemptOverrides)}
      onRetry={() => {}}
      onSubmit={() => {}}
      onReconcile={() => {}}
      onReset={() => {}}
    />
  );
}

function setInput(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
    "value"
  );
  descriptor.set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function openPackEditor() {
  const trigger = [...container.querySelectorAll("button")]
    .find((button) => button.textContent === "Declare or revise pack");
  await act(async () => trigger.click());
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("InventoryWorkspace ingredient evidence presentation", () => {
  test("distinguishes short codes, measured quantities, dates, and long notes without changing input contracts", () => {
    const document = new DOMParser().parseFromString(viewMarkup(), "text/html");
    const cost = document.querySelector('[data-inventory-command="record_ingredient_cost"]');
    const currency = cost.querySelector('input[maxlength="3"]');
    const quantity = cost.querySelector('input[placeholder="40"]');
    expect(currency.closest("label").dataset.fieldWidth).toBe("code");
    expect(quantity.closest("label").dataset.fieldWidth).toBe("numeric");
    expect(cost.querySelector('input[type="datetime-local"]').closest("label").dataset.fieldWidth).toBe("datetime");
    expect(cost.querySelector("textarea").closest("label").dataset.fieldWidth).toBe("note");
    expect(currency.required).toBe(true);
    expect(currency.maxLength).toBe(3);
    expect(currency.value).toBe("USD");
    expect(quantity.inputMode).toBe("decimal");
    expect(cost.querySelector("textarea").maxLength).toBe(240);
    expect(cost.querySelector(".workspace-field-row")).not.toBeNull();
  });

  test("exposes the seven-column evidence table as an instructed keyboard-scroll region", () => {
    const html = viewMarkup();
    expect(html).toContain("Scroll horizontally to review all seven evidence columns.");
    expect(html).toContain('class="history-table-wrap inventory-evidence-table-wrap"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Ingredient evidence table"');
    expect(html).toContain('aria-describedby="inventory-list-description inventory-table-instruction"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Ingredient on-hand, committed, available-to-allocate, and independent purchase-cost evidence");
    expect(html.match(/scope="col"/g)).toHaveLength(7);
  });

  test("keeps physical stock and purchase-cost evidence as separate axes", () => {
    const html = viewMarkup();
    expect(html).toContain("40 lb");
    expect(html).toContain("25 lb");
    expect(html).toContain("15 lb");
    expect(html).toContain("40 − 25 = 15 lb");
    expect(html).toContain("Cost not recorded");
    expect(html).toContain('data-inventory-axis="stock"');
    expect(html).toContain('data-inventory-axis="cost"');
    expect(html).toContain("A valid stock record does not wait for cost");
    expect(html).not.toContain("Inventory ready");
    expect(html).not.toContain("recipe");
    expect(html).not.toContain("equipment");
    expect(html).not.toContain("reservation");
  });

  test("shows cached and pending snapshots as unconfirmed and disables mutations", () => {
    for (const freshness of ["cached", "pending"]) {
      const model = projectionModel({
        freshness,
        sources: {
          workspace: { state: freshness, fromCache: freshness === "cached", hasPendingWrites: freshness === "pending" },
          ingredients: { state: "current", fromCache: false, hasPendingWrites: false }
        }
      });
      const html = viewMarkup({ model, readState: freshness });
      expect(html).toContain('data-capability-state="stale"');
      expect(html).toContain(`data-inventory-freshness="${freshness}"`);
      expect(html).toContain("not confirmed current");
      expect(html).not.toContain("Server-confirmed projections.");
    }
  });

  test("uses an authorized empty workspace as a recoverable location setup step", () => {
    const model = projectionModel({ workspace: null, ingredients: [] });
    const html = viewMarkup({ model });
    expect(html).toContain("No ingredients recorded");
    expect(html).toContain("Create a stock location");
    expect(html).not.toContain("Add ingredient</button>");
  });

  test("denies the entire route surface when App-owned authority props are closed", () => {
    const html = viewMarkup({ access: { readEnabled: false, mutationEnabled: false, reason: "Inventory is not enabled for this organization." }, readState: "unavailable" });
    expect(html).toContain('data-capability-state="recovery"');
    expect(html).toContain("Authority gates are closed");
    expect(html).not.toContain('aria-label="Add ingredient"');
    expect(html.match(/<main/g)).toHaveLength(1);
  });

  test("renders stock and cost mutation attempts independently", () => {
    const html = viewMarkup({
      attemptOverrides: {
        stock: attempt("uncertain", { requestId: `inventory_request_${"b".repeat(32)}`, error: "Stock outcome unknown." }),
        cost: attempt("committed", { receipt: { recordedAtISO: "2026-09-09T05:00:00.000Z" } })
      }
    });
    expect(html).toContain('data-inventory-axis="stock"');
    expect(html).toContain("Stock outcome unknown.");
    expect(html).toContain('data-inventory-axis="cost"');
    expect(html).toContain("Cost evidence is confirmed in the current projection");
    expect(html).toContain("Resolve original inventory requests");
    expect(html).toContain("Exact request identity");
  });

  test("shows stock receipt age and cost observation age as separate evidence", () => {
    const ingredient = {
      ...projectionModel().ingredients[0],
      updatedAtISO: "2026-09-09T05:30:00.000Z",
      cost: {
        state: "recorded",
        availability: "available",
        revision: 2,
        totalMinorUnits: 7500,
        currency: "USD",
        basisQuantity: "10",
        basisUnit: "lb",
        sourceLabel: "Vendor receipt 1842",
        observedAtISO: "2026-09-08T05:30:00.000Z"
      }
    };
    const html = viewMarkup({ model: projectionModel({ ingredients: [ingredient] }) });
    expect(html).toContain("Stock checked");
    expect(html).toContain("Cost observed");
    expect(html).toContain("Vendor receipt 1842");
  });

  test("keeps receiving at receipt until the current stock projection confirms it", () => {
    const receipt = viewMarkup({
      attemptOverrides: {
        receiving: attempt("receipt", { receipt: { receiptId: `iar_${"7".repeat(48)}` } })
      }
    });
    expect(receipt).toContain('data-inventory-axis="receiving" data-capability-state="receipt"');
    expect(receipt).toContain("Waiting for the server-confirmed receiving projection");

    const confirmed = viewMarkup({
      attemptOverrides: {
        receiving: attempt("committed", { receipt: { recordedAtISO: "2026-09-09T05:00:00.000Z" } })
      }
    });
    expect(confirmed).toContain("Receiving evidence is confirmed in the current projection");
  });

  test("shows declared purchase packs with their exact conversion provenance", () => {
    const ingredient = {
      ...projectionModel().ingredients[0],
      packConversions: [{
        packUnitId: "case-40lb",
        packLabel: "40 lb case",
        baseUnitId: "lb",
        baseQuantity: "40",
        sourceLabel: "Supplier specification",
        revision: 2,
        packConversionRevisionId: `ipc_${"a".repeat(48)}`
      }]
    };
    const html = viewMarkup({ model: projectionModel({ ingredients: [ingredient] }) });
    expect(html).toContain("40 lb case");
    expect(html).toContain("1 case-40lb = 40 lb");
    expect(html).toContain("Supplier specification · revision 2");
    expect(html).toContain("Show 1 purchase pack");
  });

  test("supports scoped ingredient search and keeps ingredient identity anchored to the table", async () => {
    const chicken = projectionModel().ingredients[0];
    const pasta = {
      ...chicken,
      ingredientId: "pasta",
      name: "Pasta",
      nameSortKey: "pasta",
      category: "Dry goods"
    };
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel({ ingredients: [chicken, pasta] }), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={() => {}}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });

    const search = container.querySelector('input[aria-label="Search ingredients"]');
    expect(search).not.toBeNull();
    expect(container.querySelectorAll("[data-inventory-ingredient-row]")).toHaveLength(2);
    await act(async () => setInput(search, "dry goods"));
    expect(container.querySelectorAll("[data-inventory-ingredient-row]")).toHaveLength(1);
    expect(container.textContent).toContain("Showing 1 of 2 loaded ingredients");
    expect(container.querySelector(".inventory-ingredient-identity").textContent).toContain("Ingredient");
  });

  test("keeps every evidence axis in an expandable phone ingredient row", () => {
    const html = viewMarkup();
    expect(html).toContain('data-inventory-phone-row="chicken"');
    [
      "Physical on hand",
      "Committed",
      "Available to allocate",
      "Cost evidence",
      "Location",
      "Purchase packs"
    ].forEach((label) => expect(html).toContain(label));
  });

  test("filters with explicit loaded-page scope and sorts quantities only within matching units", async () => {
    const chicken = projectionModel().ingredients[0];
    const pasta = {
      ...chicken,
      ingredientId: "pasta",
      name: "Pasta",
      nameSortKey: "pasta",
      category: "Dry goods",
      locationId: "pantry",
      locationName: "Pantry",
      stock: { ...chicken.stock, quantity: "10", onHandMicros: 10_000_000 }
    };
    const rice = {
      ...chicken,
      ingredientId: "rice",
      name: "Rice cups",
      nameSortKey: "rice cups",
      category: "Prepared",
      baseUnitId: "each",
      locationId: "pantry",
      locationName: "Pantry",
      stock: { ...chicken.stock, unit: "each", quantity: "5", onHandMicros: 5_000_000 }
    };
    const model = projectionModel({
      workspace: {
        ...projectionModel().workspace,
        locations: [
          ...projectionModel().workspace.locations,
          { locationId: "pantry", name: "Pantry", active: true, revision: 1 }
        ]
      },
      ingredients: [chicken, pasta, rice]
    });
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model, error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={() => {}}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });

    await act(async () => setInput(container.querySelector('[aria-label="Filter ingredients by category"]'), "Dry goods"));
    await act(async () => setInput(container.querySelector('[aria-label="Filter ingredients by location"]'), "pantry"));
    expect(container.querySelectorAll("[data-inventory-ingredient-row]")).toHaveLength(1);
    expect(container.textContent).toContain("Scope: category Dry goods, location Pantry");

    await act(async () => setInput(container.querySelector('[aria-label="Filter ingredients by category"]'), ""));
    await act(async () => setInput(container.querySelector('[aria-label="Filter ingredients by location"]'), ""));
    await act(async () => setInput(container.querySelector('[aria-label="Sort ingredients"]'), "on-hand-asc"));
    const rowIds = [...container.querySelectorAll("[data-inventory-ingredient-row]")]
      .map((row) => row.getAttribute("data-inventory-ingredient-row"));
    expect(rowIds).toEqual(["rice", "pasta", "chicken"]);
    expect(container.textContent).toContain("compared only within the same unit");
  });

  test("routes a missing-cost exception to the selected ingredient's existing recovery task", async () => {
    const chicken = projectionModel().ingredients[0];
    const pasta = {
      ...chicken,
      ingredientId: "pasta",
      name: "Pasta",
      nameSortKey: "pasta",
      cost: {
        state: "recorded",
        availability: "available",
        revision: 1,
        sourceLabel: "Supplier invoice",
        observedAtISO: "2026-09-09T04:00:00.000Z",
        basisQuantity: "20",
        basisUnit: "lb",
        totalMinorUnits: 4000,
        currency: "USD"
      }
    };
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel({ ingredients: [chicken, pasta] }), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={() => {}}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });

    await act(async () => setInput(container.querySelector('[aria-label="Filter ingredient exceptions"]'), "missing-cost"));
    expect(container.querySelectorAll("[data-inventory-ingredient-row]")).toHaveLength(1);
    expect(container.textContent).toContain("exception missing cost");
    const recover = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Record cost evidence");
    await act(async () => recover.click());
    const form = container.querySelector('form[aria-label="Record purchase cost"]');
    expect(form.closest("[data-inventory-task-panel]").hidden).toBe(false);
    const ingredientChoice = form.querySelector('[aria-label="Cost evidence ingredient"]');
    expect(ingredientChoice.value).toBe("chicken");
    expect(document.activeElement).toBe(ingredientChoice);
  });

  test("starts receiving from the exact selected ingredient row", async () => {
    const chicken = projectionModel().ingredients[0];
    const pasta = {
      ...chicken,
      ingredientId: "pasta",
      name: "Pasta",
      nameSortKey: "pasta",
      category: "Dry goods"
    };
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel({ ingredients: [chicken, pasta] }), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={() => {}}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });

    const receivePasta = [...container.querySelectorAll("button")]
      .find((button) => button.getAttribute("aria-label") === "Receive Pasta");
    await act(async () => receivePasta.click());
    const form = container.querySelector('form[aria-label="Receive ingredient stock"]');
    expect(form.closest("[data-inventory-task-panel]").hidden).toBe(false);
    expect(form.querySelector("select").value).toBe("pasta");
    expect(document.activeElement).toBe(form.querySelector('input[inputmode="decimal"]'));
  });

  test("renders purchase-pack receipt, confirmation, uncertainty, and recovery states", () => {
    const receipt = viewMarkup({
      attemptOverrides: {
        conversion: attempt("receipt", {
          targetId: "chicken",
          receipt: { receiptId: `iar_${"b".repeat(48)}` }
        })
      }
    });
    expect(receipt).toContain("Receipt recorded. Waiting for the server-confirmed purchase-pack projection");

    const confirmed = viewMarkup({
      attemptOverrides: {
        conversion: attempt("committed", {
          targetId: "chicken",
          receipt: { recordedAtISO: "2026-09-09T05:00:00.000Z" }
        })
      }
    });
    expect(confirmed).toContain("Purchase pack is confirmed in the current projection");

    const uncertain = viewMarkup({
      attemptOverrides: {
        conversion: attempt("uncertain", {
          targetId: "chicken",
          requestId: `inventory_request_${"c".repeat(32)}`,
          error: "Purchase-pack outcome is not verified."
        })
      }
    });
    expect(uncertain).toContain('data-capability-state="uncertain"');
    expect(uncertain).toContain("Purchase-pack outcome is not verified.");
    expect(uncertain).toContain("Check exact request");
  });

  test("exposes canonical read-state locators without promoting cached or pending evidence", () => {
    expect(viewMarkup({ readState: "loading" }))
      .toContain('data-capability-state="loading"');
    expect(viewMarkup({ model: projectionModel({ ingredients: [] }) }))
      .toContain('data-capability-state="empty"');
    expect(viewMarkup())
      .toContain('data-capability-state="success"');
    expect(viewMarkup({ readState: "stale" }))
      .toContain('data-capability-state="stale"');
    expect(viewMarkup({ model: projectionModel({ bounded: true }) }))
      .toContain('data-capability-state="partial"');
    expect(viewMarkup({ model: null, readState: "unavailable" }))
      .toContain('data-capability-state="error"');
    expect(viewMarkup({ access: { readEnabled: false, mutationEnabled: false, reason: "Closed." } }))
      .toContain('data-capability-state="recovery"');
  });

  test("exposes canonical mutation and recovery locators on each independent axis", () => {
    expect(viewMarkup({ attemptOverrides: { stock: attempt("ready") } }))
      .toContain('data-capability-state="ready"');
    expect(viewMarkup({ attemptOverrides: { stock: attempt("submitting") } }))
      .toContain('data-capability-state="submitting"');
    expect(viewMarkup({ attemptOverrides: { stock: attempt("uncertain", { requestId: `inventory_request_${"e".repeat(32)}`, error: "Review required." }) } }))
      .toContain('data-capability-state="uncertain"');
    expect(viewMarkup({ attemptOverrides: { stock: attempt("reconciliation") } }))
      .toContain('data-capability-state="reconciliation"');
    expect(viewMarkup({ attemptOverrides: { stock: attempt("receipt") } }))
      .toContain('data-capability-state="receipt"');
    expect(viewMarkup({ attemptOverrides: { stock: attempt("committed") } }))
      .toContain('data-inventory-axis="stock" data-capability-state="committed"');
    const rejected = viewMarkup({ attemptOverrides: { stock: attempt("error", { requestId: `inventory_request_${"f".repeat(32)}`, error: "Review required." }) } });
    expect(rejected).toContain('data-capability-state="error"');
    expect(rejected).toContain('class="ghost" type="button" data-capability-state="recovery"');
  });
});

describe("InventoryWorkspace operator commands", () => {
  test("emits the exact flat ingredient command", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={onSubmit}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    const form = container.querySelector('form[aria-label="Add ingredient"]');
    const [id, name, category] = form.querySelectorAll("input");
    await act(async () => {
      setInput(id, "pasta");
      setInput(name, "Pasta");
      setInput(category, "Dry goods");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith("ingredient", {
      kind: "upsert_ingredient",
      ingredientId: "pasta",
      name: "Pasta",
      category: "Dry goods",
      baseUnitId: "lb",
      active: true,
      expectedRevision: 0
    });
  });

  test("reviews exact affected menu identities before submitting cost evidence", async () => {
    const onSubmit = vi.fn();
    const onPreviewCostDependencies = vi.fn(async () => ({
      reviewedIngredientRevision: 1,
      reviewedCostRevision: 0,
      affectedMenuItems: [
        { menuItemId: "chicken-alfredo", name: "Chicken Alfredo" },
        { menuItemId: "chicken-pasta", name: "Chicken Pasta" }
      ],
      dependencyPreflightDigest: "d".repeat(64)
    }));
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onPreviewCostDependencies={onPreviewCostDependencies}
          onSubmit={onSubmit}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    const form = container.querySelector('form[aria-label="Record purchase cost"]');
    const decimals = form.querySelectorAll('input[inputmode="decimal"]');
    await act(async () => {
      setInput(decimals[0], "120.00");
      setInput(decimals[1], "40");
      setInput(form.querySelector('input[type="datetime-local"]'), "2026-09-09T04:00");
      setInput(form.querySelector('input[placeholder="Opening invoice"]'), "Invoice 1842");
    });

    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onPreviewCostDependencies).toHaveBeenCalledWith(expect.objectContaining({
      expectedIngredientRevision: 1,
      command: expect.objectContaining({
        kind: "record_ingredient_cost",
        ingredientId: "chicken",
        expectedCostRevision: 0,
        basisQuantity: "40",
        totalCostMinor: 12000
      })
    }));
    const review = container.querySelector('[data-inventory-cost-dependency-review="ready"]');
    expect(review.textContent).toContain("Chicken Alfredo");
    expect(review.textContent).toContain("Chicken Pasta");
    expect(review.textContent).toContain("Ingredient revision 1");
    expect(document.activeElement).toBe(review);

    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSubmit).toHaveBeenCalledWith("cost", expect.objectContaining({
      dependencyPreflightDigest: "d".repeat(64)
    }));
  });

  test("does not let a cost submission lock the independent stock form", async () => {
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts({ cost: attempt("submitting") })}
          onRetry={() => {}}
          onSubmit={() => {}}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    const stockForm = container.querySelector('form[aria-label="Record opening stock"]');
    const costForm = container.querySelector('form[aria-label="Record purchase cost"]');
    expect([...costForm.elements].every((entry) => !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(entry.tagName) || entry.disabled)).toBe(true);
    expect(stockForm.querySelectorAll('[data-inventory-choice-state="one"]')).toHaveLength(2);
    expect(stockForm.querySelector('input[inputmode="decimal"]').disabled).toBe(false);
  });

  test("emits exact receiving evidence without changing allocation authority", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={onSubmit}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    const form = container.querySelector('form[aria-label="Receive ingredient stock"]');
    const quantity = form.querySelector('input[inputmode="decimal"]');
    const occurredAt = form.querySelector('input[type="datetime-local"]');
    const source = [...form.querySelectorAll("input")].find((entry) => entry.placeholder === "Vendor receipt 1842");
    const [totalCost, currency] = [...form.querySelectorAll('input[inputmode="decimal"], input[maxlength="3"]')]
      .filter((entry) => entry !== quantity);
    await act(async () => {
      setInput(quantity, "10");
      setInput(occurredAt, "2026-09-09T05:00");
      setInput(source, "Vendor receipt 1842");
      setInput(totalCost, "30.00");
      setInput(currency, "USD");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith("receiving", {
      kind: "receive_stock",
      ingredientId: "chicken",
      locationId: "main-kitchen",
      quantity: "10",
      baseUnitId: "lb",
      occurredAtISO: new Date("2026-09-09T05:00").toISOString(),
      sourceLabel: "Vendor receipt 1842",
      note: "",
      expectedStockRevision: 1,
      expectedCostRevision: 0,
      cost: { availability: "available", totalCostMinor: 3000, currency: "USD" }
    });
    expect(form.textContent).toContain("does not create or release an event allocation");
    expect(form.querySelector('input[readonly]').value).toBe("Main kitchen");
  });

  test("shows and submits an exact purchase-pack to base-unit conversion", async () => {
    const onSubmit = vi.fn();
    const ingredient = {
      ...projectionModel().ingredients[0],
      packConversions: [{
        packUnitId: "case-40lb",
        packLabel: "40 lb case",
        baseUnitId: "lb",
        baseQuantity: "40",
        sourceLabel: "Supplier specification",
        revision: 1,
        packConversionRevisionId: `ipc_${"9".repeat(48)}`
      }]
    };
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel({ ingredients: [ingredient] }), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={onSubmit}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    await act(async () => container.querySelector('button[aria-label="Receive Chicken"]').click());
    const form = container.querySelector('form[aria-label="Receive ingredient stock"]');
    const ingredientChoice = form.querySelector('[data-inventory-choice-value="chicken"]');
    const unitSelect = form.querySelector('select[aria-label="Receiving unit"]');
    const quantity = form.querySelector('input[inputmode="decimal"]');
    const occurredAt = form.querySelector('input[type="datetime-local"]');
    const source = [...form.querySelectorAll("input")].find((entry) => entry.placeholder === "Vendor receipt 1842");
    const totalCost = [...form.querySelectorAll('input[inputmode="decimal"]')].find((entry) => entry !== quantity);
    expect(ingredientChoice).not.toBeNull();
    await act(async () => {
      setInput(unitSelect, "case-40lb");
      setInput(quantity, "2");
      setInput(occurredAt, "2026-09-09T05:00");
      setInput(source, "Vendor receipt 1842");
      setInput(totalCost, "75.00");
    });
    expect(form.querySelector("[data-receiving-conversion]").textContent).toContain("2 40 lb case = 80 lb");
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSubmit).toHaveBeenCalledWith("receiving", expect.objectContaining({
      ingredientId: "chicken",
      quantity: "80",
      baseUnitId: "lb"
    }));
  });

  test("publishes an exact purchase-pack conversion with projection-derived revision", async () => {
    const onSubmit = vi.fn();
    const ingredient = {
      ...projectionModel().ingredients[0],
      packConversions: [{
        packUnitId: "case-40lb",
        packLabel: "Old case label",
        baseUnitId: "lb",
        baseQuantity: "38",
        sourceLabel: "Prior supplier sheet",
        revision: 2,
        packConversionRevisionId: `ipc_${"a".repeat(48)}`
      }]
    };
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel({ ingredients: [ingredient] }), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={onSubmit}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    await openPackEditor();
    expect(container.querySelector('button[aria-controls="inventory-pack-editor-0"]').getAttribute("aria-expanded")).toBe("true");
    const form = container.querySelector('form[data-inventory-command="publish_pack_conversion"]');
    const [reference, label, quantity, source] = form.querySelectorAll("input");
    await act(async () => {
      setInput(reference, "case-40lb");
      setInput(label, "40 lb case");
      setInput(quantity, "40.000001");
      setInput(source, "Current supplier specification");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith("conversion", {
      kind: "publish_pack_conversion",
      ingredientId: "chicken",
      packUnitId: "case-40lb",
      packLabel: "40 lb case",
      baseUnitId: "lb",
      baseQuantity: "40.000001",
      sourceLabel: "Current supplier specification",
      expectedRevision: 2
    });
    expect(form.textContent).toContain("Publishing creates revision 3");
  });

  test("rejects ambiguous or non-canonical purchase-pack quantities before mutation", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={onSubmit}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    await openPackEditor();
    const form = container.querySelector('form[data-inventory-command="publish_pack_conversion"]');
    const [reference, label, quantity, source] = form.querySelectorAll("input");
    await act(async () => {
      setInput(reference, "case-40lb");
      setInput(label, "40 lb case");
      setInput(source, "Supplier specification");
      setInput(quantity, "1e3");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("no more than six decimal places");

    await act(async () => {
      setInput(quantity, "0.000000");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain("positive quantity");
  });

  test("keeps stock and cost controls available while a pack declaration is pending", async () => {
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts({ conversion: attempt("submitting", { targetId: "chicken" }) })}
          onRetry={() => {}}
          onSubmit={() => {}}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    expect(container.querySelector('form[aria-label="Record opening stock"] input[inputmode="decimal"]').disabled).toBe(false);
    expect(container.querySelector('form[aria-label="Record purchase cost"] select').disabled).toBe(false);
    expect(container.querySelector('form[data-inventory-command="publish_pack_conversion"] input').disabled).toBe(true);
  });

  test("routes uncertain purchase-pack recovery to the exact conversion attempt", async () => {
    const onReconcile = vi.fn();
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts({
            conversion: attempt("uncertain", {
              targetId: "chicken",
              requestId: `inventory_request_${"d".repeat(32)}`,
              error: "Outcome unknown."
            })
          })}
          onRetry={() => {}}
          onSubmit={() => {}}
          onReconcile={onReconcile}
          onReset={() => {}}
        />
      );
    });
    await act(async () => {
      [...container.querySelectorAll('[data-inventory-axis="conversion"] button')]
        .find((button) => button.textContent === "Check exact request")
        .click();
    });
    expect(onReconcile).toHaveBeenCalledWith("conversion");
  });
});

describe("InventoryWorkspace subscription lifecycle", () => {
  test("loads bounded movement history and exact commitments only when the ingredient disclosure opens", async () => {
    let subscription;
    let resolveTrace;
    const subscribeProjections = vi.fn((input) => {
      subscription = input;
      return vi.fn();
    });
    const readIngredientTrace = vi.fn(() => new Promise((resolve) => { resolveTrace = resolve; }));
    await act(async () => {
      root.render(
        <InventoryWorkspace
          organizationId={ORGANIZATION_ID}
          role="admin"
          browserEnabled
          tenantEnabled
          subscribeProjections={subscribeProjections}
          readIngredientTrace={readIngredientTrace}
          pendingCommands={() => []}
        />
      );
    });
    await act(async () => subscription.onData(projectionModel()));
    expect(readIngredientTrace).not.toHaveBeenCalled();

    const disclosure = container.querySelector('[data-inventory-ingredient-row="chicken"] details[data-inventory-trace]');
    await act(async () => {
      disclosure.open = true;
      disclosure.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    expect(readIngredientTrace).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      ingredientId: "chicken",
      expectedIngredientRevision: 1,
      expectedStockRevision: 1,
      expectedAllocationRevision: 1,
      cursor: null
    }));
    expect(disclosure.textContent).toContain("Loading movement history and event commitments");

    await act(async () => resolveTrace(ingredientTraceResult()));
    expect(disclosure.textContent).toContain("Received 10 lb");
    expect(disclosure.textContent).toContain("Exact receipt");
    expect(disclosure.textContent).toContain(`iar_${"b".repeat(48)}`);
    expect(disclosure.textContent).toContain("25 lb committed across 1 event");
    expect(disclosure.textContent).toContain("quote-event-1");
    expect(disclosure.textContent).toContain(`eip_${"c".repeat(48)}`);
  });

  test("keeps trace failures local and retries from the same keyboard focus without clearing inventory", async () => {
    let subscription;
    let resolveRetry;
    const subscribeProjections = vi.fn((input) => {
      subscription = input;
      return vi.fn();
    });
    const readIngredientTrace = vi.fn()
      .mockRejectedValueOnce(new Error("Trace read stopped."))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    await act(async () => root.render(
      <InventoryWorkspace
        organizationId={ORGANIZATION_ID}
        role="admin"
        browserEnabled
        tenantEnabled
        subscribeProjections={subscribeProjections}
        readIngredientTrace={readIngredientTrace}
        pendingCommands={() => []}
      />
    ));
    await act(async () => subscription.onData(projectionModel()));
    const disclosure = container.querySelector('[data-inventory-ingredient-row="chicken"] details[data-inventory-trace]');
    await act(async () => {
      disclosure.open = true;
      disclosure.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    expect(disclosure.textContent).toContain("Trace read stopped.");
    expect(container.textContent).toContain("40 lb");
    expect(container.querySelector("main").dataset.capabilityState).toBe("success");

    const retry = disclosure.querySelector('button[aria-label="Retry Chicken movement history and commitments"]');
    retry.focus();
    await act(async () => retry.click());
    expect(document.activeElement).toBe(retry);
    expect(retry.getAttribute("aria-disabled")).toBe("true");
    expect(disclosure.textContent).toContain("Retrying movement history and event commitments");

    await act(async () => resolveRetry(ingredientTraceResult()));
    expect(disclosure.textContent).toContain("Received 10 lb");
    expect(container.textContent).toContain("40 lb");
  });

  test("retains a successful movement page when loading an earlier page fails", async () => {
    let subscription;
    const nextCursor = {
      recordedAtISO: "2026-09-09T05:00:00.000Z",
      movementId: `imv_${"a".repeat(48)}`
    };
    const subscribeProjections = vi.fn((input) => {
      subscription = input;
      return vi.fn();
    });
    const readIngredientTrace = vi.fn()
      .mockResolvedValueOnce(ingredientTraceResult("chicken", {
        movementPage: {
          ...ingredientTraceResult().movementPage,
          complete: false,
          hasNext: true,
          nextCursor
        }
      }))
      .mockRejectedValueOnce(new Error("Earlier movement page stopped."));
    await act(async () => root.render(
      <InventoryWorkspace
        organizationId={ORGANIZATION_ID}
        role="admin"
        browserEnabled
        tenantEnabled
        subscribeProjections={subscribeProjections}
        readIngredientTrace={readIngredientTrace}
        pendingCommands={() => []}
      />
    ));
    await act(async () => subscription.onData(projectionModel()));
    const disclosure = container.querySelector('[data-inventory-ingredient-row="chicken"] details[data-inventory-trace]');
    await act(async () => {
      disclosure.open = true;
      disclosure.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    expect(disclosure.textContent).toContain("Received 10 lb");

    await act(async () => [...disclosure.querySelectorAll("button")]
      .find((button) => button.textContent === "Load earlier movements").click());
    expect(disclosure.textContent).toContain("Earlier movement page stopped.");
    expect(disclosure.textContent).toContain("Received 10 lb");
    expect(disclosure.querySelector("[data-inventory-trace-state]").dataset.inventoryTraceState).toBe("partial");
    expect(readIngredientTrace.mock.calls[1][0].cursor).toEqual(nextCursor);
  });

  test("keeps late ingredient trace responses isolated to their exact entities", async () => {
    let subscription;
    const pending = new Map();
    const subscribeProjections = vi.fn((input) => {
      subscription = input;
      return vi.fn();
    });
    const readIngredientTrace = vi.fn(({ ingredientId }) => new Promise((resolve) => {
      pending.set(ingredientId, resolve);
    }));
    const pasta = {
      ...projectionModel().ingredients[0],
      ingredientId: "pasta",
      name: "Pasta",
      nameSortKey: "pasta",
      category: "Pantry"
    };
    await act(async () => root.render(
      <InventoryWorkspace
        organizationId={ORGANIZATION_ID}
        role="admin"
        browserEnabled
        tenantEnabled
        subscribeProjections={subscribeProjections}
        readIngredientTrace={readIngredientTrace}
        pendingCommands={() => []}
      />
    ));
    await act(async () => subscription.onData(projectionModel({
      ingredients: [projectionModel().ingredients[0], pasta]
    })));
    const chickenDisclosure = container.querySelector('[data-inventory-ingredient-row="chicken"] details[data-inventory-trace]');
    const pastaDisclosure = container.querySelector('[data-inventory-ingredient-row="pasta"] details[data-inventory-trace]');
    await act(async () => {
      chickenDisclosure.open = true;
      chickenDisclosure.dispatchEvent(new Event("toggle", { bubbles: true }));
      pastaDisclosure.open = true;
      pastaDisclosure.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    await act(async () => pending.get("pasta")(ingredientTraceResult("pasta", {
      movements: [{ ...ingredientTraceResult().movements[0], sourceLabel: "Pasta delivery" }]
    })));
    await act(async () => pending.get("chicken")(ingredientTraceResult("chicken", {
      movements: [{ ...ingredientTraceResult().movements[0], sourceLabel: "Chicken delivery" }]
    })));
    expect(pastaDisclosure.textContent).toContain("Pasta delivery");
    expect(pastaDisclosure.textContent).not.toContain("Chicken delivery");
    expect(chickenDisclosure.textContent).toContain("Chicken delivery");
    expect(chickenDisclosure.textContent).not.toContain("Pasta delivery");
  });

  test("navigates ingredient pages with the exact server cursor and can return to the first page", async () => {
    const subscriptions = [];
    const unsubscribes = [];
    const subscribeProjections = vi.fn((input) => {
      const unsubscribe = vi.fn();
      subscriptions.push(input);
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    });
    const cursor = { nameSortKey: "chicken", ingredientId: "chicken" };
    await act(async () => {
      root.render(
        <InventoryWorkspace
          organizationId={ORGANIZATION_ID}
          role="admin"
          browserEnabled
          tenantEnabled
          subscribeProjections={subscribeProjections}
          pendingCommands={() => []}
        />
      );
    });
    await act(async () => subscriptions[0].onData(projectionModel({
      bounded: true,
      page: { size: 1, cursor: null, nextCursor: cursor, hasPrevious: false, hasNext: true }
    })));

    await act(async () => [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Next ingredients").click());
    expect(unsubscribes[0]).toHaveBeenCalledOnce();
    expect(subscriptions[1].cursor).toEqual(cursor);

    await act(async () => subscriptions[1].onData(projectionModel({
      bounded: true,
      page: { size: 1, cursor, nextCursor: null, hasPrevious: true, hasNext: false }
    })));
    await act(async () => [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Previous ingredients").click());
    expect(unsubscribes[1]).toHaveBeenCalledOnce();
    expect(subscriptions[2].cursor).toBeNull();
  });

  test("holds a pack command pending until its exact projection confirms the receipt", async () => {
    let subscription;
    let resolveCommand;
    const submitCommand = vi.fn(() => new Promise((resolve) => { resolveCommand = resolve; }));
    const subscribeProjections = vi.fn((input) => {
      subscription = input;
      return vi.fn();
    });
    await act(async () => {
      root.render(
        <InventoryWorkspace
          organizationId={ORGANIZATION_ID}
          role="admin"
          browserEnabled
          tenantEnabled
          subscribeProjections={subscribeProjections}
          submitCommand={submitCommand}
          pendingCommands={() => []}
        />
      );
    });
    await act(async () => subscription.onData(projectionModel()));
    await openPackEditor();

    const form = container.querySelector('form[data-inventory-command="publish_pack_conversion"]');
    const [reference, label, quantity, source] = form.querySelectorAll("input");
    await act(async () => {
      setInput(reference, "case-40lb");
      setInput(label, "40 lb case");
      setInput(quantity, "40");
      setInput(source, "Supplier specification");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("Publishing purchase pack…");

    const receipt = {
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      receiptId: `iar_${"e".repeat(48)}`,
      requestId: submitCommand.mock.calls[0][0].requestId,
      commandKind: "publish_pack_conversion",
      recordedAtISO: "2026-09-09T06:00:00.000Z"
    };
    const confirmation = {
      ingredientId: "chicken",
      packUnitId: "case-40lb",
      packConversionRevisionId: `ipc_${"a".repeat(48)}`,
      revision: 1
    };
    await act(async () => resolveCommand({ receipt, confirmation }));
    expect(container.textContent).toContain("Waiting for the server-confirmed purchase-pack projection");

    const ingredient = {
      ...projectionModel().ingredients[0],
      packConversions: [{
        packUnitId: "case-40lb",
        packLabel: "40 lb case",
        baseUnitId: "lb",
        baseQuantity: "40",
        sourceLabel: "Supplier specification",
        revision: 1,
        packConversionRevisionId: confirmation.packConversionRevisionId
      }]
    };
    await act(async () => subscription.onData(projectionModel({ ingredients: [ingredient] })));
    expect(container.textContent).toContain("Purchase pack is confirmed in the current projection");
  });

  test("restores and reconciles the exact unresolved pack request", async () => {
    let subscription;
    let resolveReconcile;
    const reconcileCommand = vi.fn(() => new Promise((resolve) => { resolveReconcile = resolve; }));
    const requestId = `inventory_request_${"1".repeat(32)}`;
    const subscribeProjections = vi.fn((input) => {
      subscription = input;
      return vi.fn();
    });
    await act(async () => {
      root.render(
        <InventoryWorkspace
          organizationId={ORGANIZATION_ID}
          role="admin"
          browserEnabled
          tenantEnabled
          subscribeProjections={subscribeProjections}
          reconcileCommand={reconcileCommand}
          pendingCommands={() => [{
            requestId,
            commandKind: "publish_pack_conversion",
            targetId: "chicken",
            definitive: false,
            state: "uncertain",
            error: "The original outcome is not verified."
          }]}
        />
      );
    });
    await act(async () => subscription.onData(projectionModel()));
    expect(container.textContent).toContain("The original outcome is not verified.");

    const recovery = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Check exact request");
    await act(async () => recovery.click());
    expect(reconcileCommand).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      requestId
    }));
    expect(container.textContent).toContain("Checking the exact original purchase pack request");

    await act(async () => resolveReconcile({
      receipt: {
        organizationId: ORGANIZATION_ID,
        commandKind: "publish_pack_conversion",
        recordedAtISO: "2026-09-09T06:00:00.000Z"
      },
      confirmation: {
        ingredientId: "chicken",
        packConversionRevisionId: `ipc_${"b".repeat(48)}`,
        revision: 1
      }
    }));
    expect(container.textContent).toContain("Waiting for the server-confirmed purchase-pack projection");
  });

  test("invalidates late callbacks when the active organization changes", async () => {
    const subscriptions = [];
    const subscribeProjections = vi.fn((input) => {
      subscriptions.push(input);
      return vi.fn();
    });
    const common = {
      role: "admin",
      browserEnabled: true,
      tenantEnabled: true,
      subscribeProjections,
      pendingCommands: () => [],
      submitCommand: vi.fn(),
      reconcileCommand: vi.fn(),
      resetCommand: vi.fn()
    };
    await act(async () => {
      root.render(<InventoryWorkspace organizationId="org-a" {...common} />);
    });
    await act(async () => {
      root.render(<InventoryWorkspace organizationId="org-b" {...common} />);
    });
    expect(subscriptions).toHaveLength(2);

    await act(async () => {
      subscriptions[0].onData({ ...projectionModel(), organizationId: "org-a", ingredients: [{ ...projectionModel().ingredients[0], name: "Late chicken" }] });
    });
    expect(container.textContent).not.toContain("Late chicken");

    await act(async () => {
      subscriptions[1].onData({ ...projectionModel(), organizationId: "org-b", ingredients: [{ ...projectionModel().ingredients[0], ingredientId: "pasta", name: "Pasta" }] });
    });
    expect(container.textContent).toContain("Pasta");
  });

  test("ignores a late receiving response after the organization changes", async () => {
    const subscriptions = [];
    let resolveReceive;
    const submitCommand = vi.fn(() => new Promise((resolve) => { resolveReceive = resolve; }));
    const subscribeProjections = vi.fn((input) => {
      subscriptions.push(input);
      return vi.fn();
    });
    const common = {
      role: "admin",
      browserEnabled: true,
      tenantEnabled: true,
      subscribeProjections,
      submitCommand,
      pendingCommands: () => []
    };
    await act(async () => root.render(<InventoryWorkspace organizationId="org-a" {...common} />));
    await act(async () => subscriptions[0].onData({ ...projectionModel(), organizationId: "org-a" }));
    const form = container.querySelector('form[aria-label="Receive ingredient stock"]');
    const quantity = form.querySelector('input[inputmode="decimal"]');
    const occurredAt = form.querySelector('input[type="datetime-local"]');
    const source = [...form.querySelectorAll("input")].find((entry) => entry.placeholder === "Vendor receipt 1842");
    const totalCost = [...form.querySelectorAll('input[inputmode="decimal"]')].find((entry) => entry !== quantity);
    await act(async () => {
      setInput(quantity, "10");
      setInput(occurredAt, "2026-09-09T05:00");
      setInput(source, "Vendor receipt 1842");
      setInput(totalCost, "30.00");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("Recording receiving evidence");

    await act(async () => root.render(<InventoryWorkspace organizationId="org-b" {...common} />));
    await act(async () => resolveReceive({
      receipt: { receiptId: `iar_${"8".repeat(48)}` },
      confirmation: { ingredientId: "chicken", stockRevision: 2 }
    }));
    expect(container.textContent).not.toContain("Waiting for the server-confirmed receiving projection");
  });

  test("connects multi-line receiving to one sequential inventory request per line", async () => {
    let subscription;
    const submitCommand = vi.fn(async ({ requestId, command }) => ({
      receipt: {
        organizationId: ORGANIZATION_ID,
        requestId,
        receiptId: `iar_${"9".repeat(48)}`,
        commandKind: "receive_stock",
        recordedAtISO: "2026-10-11T01:01:00.000Z"
      },
      confirmation: {
        ingredientId: command.ingredientId,
        movementId: `imv_${"8".repeat(48)}`,
        stockRevision: 2,
        costRevision: 0
      }
    }));
    await act(async () => {
      root.render(
        <InventoryWorkspace
          organizationId={ORGANIZATION_ID}
          role="admin"
          browserEnabled
          tenantEnabled
          subscribeProjections={(input) => { subscription = input; return vi.fn(); }}
          submitCommand={submitCommand}
          pendingCommands={() => []}
          createRequestId={() => "inventory_request_99999999999999999999999999999999"}
        />
      );
    });
    await act(async () => subscription.onData(projectionModel()));
    const form = container.querySelector('form[aria-label="Receive multiple ingredient lines"]');
    expect(form).not.toBeNull();
    const line = form.querySelector("[data-receiving-batch-line]");
    await act(async () => {
      setInput(line.querySelector('[aria-label="Line 1 quantity received"]'), "6");
      setInput(line.querySelector('[aria-label="Line 1 received at"]'), "2026-10-11T01:00");
      setInput(line.querySelector('[aria-label="Line 1 receipt or delivery source"]'), "Vendor receipt 70");
      setInput(line.querySelector('[aria-label="Line 1 cost evidence"]'), "not_yet_available");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(submitCommand).toHaveBeenCalledTimes(1);
    expect(submitCommand).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      requestId: "inventory_request_99999999999999999999999999999999",
      command: expect.objectContaining({
        kind: "receive_stock",
        ingredientId: "chicken",
        quantity: "6",
        cost: { availability: "not_yet_available" }
      })
    }));
    expect(form.textContent).toContain("Receipt confirmed for this line");
  });

  test("never attaches a listener for sales or closed feature gates", async () => {
    const subscribeProjections = vi.fn();
    await act(async () => {
      root.render(
        <InventoryWorkspace
          organizationId={ORGANIZATION_ID}
          role="sales"
          browserEnabled
          tenantEnabled
          subscribeProjections={subscribeProjections}
          pendingCommands={() => []}
        />
      );
    });
    expect(subscribeProjections).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Authority gates are closed");
  });
});
