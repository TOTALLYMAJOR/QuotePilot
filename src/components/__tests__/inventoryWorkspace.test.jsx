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
  test("keeps physical stock and purchase-cost evidence as separate axes", () => {
    const html = viewMarkup();
    expect(html).toContain("40 lb");
    expect(html).toContain("25 lb");
    expect(html).toContain("15 lb");
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
  test("generates a stable optional reference and resets only after confirmation", async () => {
    const onSubmit = vi.fn();
    const renderView = async (state = "ready") => act(async () => root.render(
      <InventoryWorkspaceView access={ADMIN_ACCESS}
        read={{ state: "current", model: projectionModel(), error: "" }}
        attempts={attempts({ ingredient: attempt(state) })}
        onRetry={() => {}} onSubmit={onSubmit} onReconcile={() => {}} onReset={() => {}} />
    ));
    await renderView();
    const form = container.querySelector('form[aria-label="Add ingredient"]');
    expect(form.querySelector('[data-inventory-reference="ingredient"]')).not.toBeNull();
    const [reference, name, category] = form.querySelectorAll("input");
    expect(reference.required).toBe(false);
    await act(async () => {
      setInput(name, "Pasta");
      setInput(category, "Dry goods");
    });
    const submit = () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await act(async () => submit());
    const generated = onSubmit.mock.calls[0][1].ingredientId;
    expect(generated).toMatch(/^ingredient_[a-f0-9]{32}$/);
    await renderView("error");
    await act(async () => submit());
    expect(onSubmit.mock.calls[1][1].ingredientId).toBe(generated);
    await renderView("receipt");
    expect(name.value).toBe("Pasta");
    expect(form.querySelector('button[type="submit"]').disabled).toBe(true);
    await renderView("committed");
    expect(name.value).toBe("");
    expect(category.value).toBe("Dry goods");
    await act(async () => setInput(name, "Rice"));
    await act(async () => submit());
    expect(onSubmit.mock.calls[2][1].ingredientId).not.toBe(generated);
  });

  test("explains capacity without disabling existing receiving actions", async () => {
    const ingredients = Array.from({ length: 200 }, (_, index) => ({
      ...projectionModel().ingredients[0], ingredientId: `ingredient-${index}`,
      name: `Ingredient ${index}`, nameSortKey: `ingredient-${index}`
    }));
    await act(async () => root.render(
      <InventoryWorkspaceView access={ADMIN_ACCESS}
        read={{ state: "current", model: projectionModel({ ingredients }), error: "" }}
        attempts={attempts()} onRetry={() => {}} onSubmit={() => {}}
        onReconcile={() => {}} onReset={() => {}} />
    ));
    expect(container.querySelector('[data-inventory-capacity="reached"]').textContent).toContain("200");
    expect(container.querySelector('form[aria-label="Add ingredient"] input').disabled).toBe(true);
    expect(container.querySelector('form[aria-label="Receive ingredient stock"] select').disabled).toBe(false);
    expect(container.querySelector('details[aria-labelledby="inventory-source-state-title"]').open).toBe(false);
  });

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
    expect(stockForm.querySelector("select").disabled).toBe(false);
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
  test.each(["receipt-first", "projection-first"])("confirms the exact pack command in %s order", async (arrivalOrder) => {
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
    if (arrivalOrder === "receipt-first") {
      await act(async () => resolveCommand({ receipt, confirmation }));
      expect(container.textContent).toContain("Waiting for the server-confirmed purchase-pack projection");
    }

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
    const confirmedModel = projectionModel({ ingredients: [ingredient] });
    // Cached, locally pending, and mismatched projections never substitute for
    // the current server projection that confirms this exact receipt.
    for (const unconfirmedModel of [
      {
        ...confirmedModel,
        freshness: "cached",
        sources: {
          workspace: { state: "cached", fromCache: true, hasPendingWrites: false },
          ingredients: { state: "cached", fromCache: true, hasPendingWrites: false }
        }
      },
      {
        ...confirmedModel,
        freshness: "pending",
        sources: {
          workspace: { state: "pending", fromCache: false, hasPendingWrites: true },
          ingredients: { state: "pending", fromCache: false, hasPendingWrites: true }
        }
      },
      projectionModel({
        ingredients: [{
          ...ingredient,
          packConversions: [{
            ...ingredient.packConversions[0],
            packConversionRevisionId: `ipc_${"f".repeat(48)}`
          }]
        }]
      })
    ]) {
      await act(async () => subscription.onData(unconfirmedModel));
      expect(container.textContent).not.toContain("Purchase pack is confirmed in the current projection");
    }
    await act(async () => subscription.onData(confirmedModel));
    if (arrivalOrder === "projection-first") {
      expect(container.textContent).toContain("Publishing purchase pack…");
      await act(async () => resolveCommand({ receipt, confirmation }));
    }
    // No second snapshot, timer, refresh, or new request is needed.
    expect(container.textContent).toContain("Purchase pack is confirmed in the current projection");
    expect(container.querySelector('[data-inventory-axis="conversion"]').getAttribute("data-capability-state")).toBe("committed");
    expect(submitCommand).toHaveBeenCalledTimes(1);
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
