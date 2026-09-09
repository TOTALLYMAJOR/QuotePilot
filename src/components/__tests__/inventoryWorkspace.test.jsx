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
    cost: attempt(),
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
});

describe("InventoryWorkspace subscription lifecycle", () => {
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
