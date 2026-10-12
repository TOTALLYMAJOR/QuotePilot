// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import InventoryReceivingBatch from "../InventoryReceivingBatch";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;

function ingredient(ingredientId, name, revisions = {}) {
  return {
    ingredientId,
    name,
    active: true,
    baseUnitId: "lb",
    ingredientRevision: 1,
    stock: {
      state: "recorded",
      locationId: "main-kitchen",
      revision: revisions.stock ?? 2
    },
    cost: { revision: revisions.cost ?? 1 },
    packConversions: []
  };
}

const INGREDIENTS = [
  ingredient("chicken", "Chicken"),
  ingredient("flour", "Flour", { stock: 5, cost: 4 })
];
const LOCATIONS = [{ locationId: "main-kitchen", name: "Main kitchen" }];

function setInput(input, value) {
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function completeLine(line, index) {
  const quantity = line.querySelector(`[aria-label="Line ${index} quantity received"]`);
  const occurredAt = line.querySelector(`[aria-label="Line ${index} received at"]`);
  const source = line.querySelector(`[aria-label="Line ${index} receipt or delivery source"]`);
  const cost = line.querySelector(`[aria-label="Line ${index} cost evidence"]`);
  await act(async () => {
    setInput(quantity, String(index * 5));
    setInput(occurredAt, `2026-10-1${index}T0${index}:00`);
    setInput(source, `Vendor receipt ${index}`);
    setInput(cost, "not_yet_available");
  });
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

describe("InventoryReceivingBatch", () => {
  test("keeps stable line identities and emits exact commands for multiple ingredients", async () => {
    const ids = ["line-one", "line-two"];
    const onSubmitBatch = vi.fn(async ({ lines, onLineState }) => {
      lines.forEach((line) => onLineState({ ...line, state: "receipt", requestId: `request-${line.lineId}`, receipt: { receiptId: `receipt-${line.lineId}` } }));
    });
    await act(async () => {
      root.render(
        <InventoryReceivingBatch
          ingredients={INGREDIENTS}
          locations={LOCATIONS}
          current
          scopeKey="org-one:admin"
          projectionModel={{ freshness: "current", ingredients: [] }}
          createLineId={() => ids.shift()}
          onSubmitBatch={onSubmitBatch}
          onReconcileLine={() => {}}
          onRetryLine={() => {}}
          confirmsReceipt={() => false}
        />
      );
    });

    await act(async () => container.querySelector("[data-add-receiving-line]").click());
    const lines = [...container.querySelectorAll("[data-receiving-batch-line]")];
    expect(lines.map((line) => line.dataset.receivingBatchLine)).toEqual(["line-one", "line-two"]);
    expect(lines[0].querySelector('[aria-label="Line 1 ingredient"]').value).toBe("chicken");
    expect(lines[1].querySelector('[aria-label="Line 2 ingredient"]').value).toBe("flour");
    await completeLine(lines[0], 1);
    await completeLine(lines[1], 2);

    await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    const submitted = onSubmitBatch.mock.calls[0][0].lines;
    expect(submitted.map((line) => [line.lineId, line.command.ingredientId])).toEqual([
      ["line-one", "chicken"],
      ["line-two", "flour"]
    ]);
    expect(submitted[1].command).toMatchObject({
      locationId: "main-kitchen",
      quantity: "10",
      expectedStockRevision: 5,
      expectedCostRevision: 4,
      cost: { availability: "not_yet_available" }
    });
    expect(container.textContent).toContain("Receipt confirmed for this line");
    expect([...container.querySelectorAll("[data-receiving-batch-line] input")].every((input) => input.disabled || input.readOnly)).toBe(true);
  });

  test("keeps line failures local and exposes only the safe recovery for each outcome", async () => {
    const ids = ["line-one", "line-two"];
    const onSubmitBatch = vi.fn(async ({ lines, onLineState }) => {
      onLineState({ ...lines[0], state: "uncertain", requestId: "request-one", error: "Outcome needs confirmation." });
      onLineState({ ...lines[1], state: "definitive_failure", requestId: "request-two", error: "Revision changed." });
    });
    const onReconcileLine = vi.fn(async ({ line, onLineState }) => {
      onLineState({ ...line, state: "receipt", error: "", receipt: { receiptId: "receipt-one" } });
    });
    const onRetryLine = vi.fn(async ({ line, onLineState }) => {
      onLineState({ ...line, state: "receipt", error: "", receipt: { receiptId: "receipt-two" } });
    });
    await act(async () => {
      root.render(
        <InventoryReceivingBatch
          ingredients={INGREDIENTS}
          locations={LOCATIONS}
          current
          scopeKey="org-one:admin"
          projectionModel={{ freshness: "current", ingredients: [] }}
          createLineId={() => ids.shift()}
          onSubmitBatch={onSubmitBatch}
          onReconcileLine={onReconcileLine}
          onRetryLine={onRetryLine}
          confirmsReceipt={() => false}
        />
      );
    });
    await act(async () => container.querySelector("[data-add-receiving-line]").click());
    const lines = [...container.querySelectorAll("[data-receiving-batch-line]")];
    await completeLine(lines[0], 1);
    await completeLine(lines[1], 2);
    await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(container.textContent).toContain("Outcome needs confirmation.");
    expect(container.textContent).toContain("Revision changed.");
    expect(container.querySelector("[data-reconcile-receiving-line=\"line-one\"]")).not.toBeNull();
    expect(container.querySelector("[data-retry-receiving-line=\"line-two\"]")).not.toBeNull();
    expect(container.querySelector("[data-retry-receiving-line=\"line-one\"]")).toBeNull();

    await act(async () => container.querySelector("[data-reconcile-receiving-line=\"line-one\"]").click());
    await act(async () => container.querySelector("[data-retry-receiving-line=\"line-two\"]").click());
    expect(onReconcileLine.mock.calls[0][0].line.requestId).toBe("request-one");
    expect(onRetryLine.mock.calls[0][0].line.requestId).toBe("request-two");
    expect(container.querySelectorAll("[data-receiving-line-state=\"receipt\"]")).toHaveLength(2);
  });

  test("promotes receipt lines only after the exact current projection confirms them", async () => {
    const onSubmitBatch = vi.fn(async ({ lines, onLineState }) => {
      onLineState({
        ...lines[0],
        state: "receipt",
        requestId: "request-one",
        receipt: { receiptId: "receipt-one" },
        confirmation: { ingredientId: "chicken", stockRevision: 3 }
      });
    });
    const confirmsReceipt = vi.fn((model, line) => model.confirmedRevision === line.confirmation.stockRevision);
    const render = async (confirmedRevision) => {
      await act(async () => {
        root.render(
          <InventoryReceivingBatch
            ingredients={INGREDIENTS}
            locations={LOCATIONS}
            current
            scopeKey="org-one:admin"
            projectionModel={{ freshness: "current", confirmedRevision }}
            createLineId={() => "line-one"}
            onSubmitBatch={onSubmitBatch}
            onReconcileLine={() => {}}
            onRetryLine={() => {}}
            confirmsReceipt={confirmsReceipt}
          />
        );
      });
    };
    await render(2);
    const line = container.querySelector("[data-receiving-batch-line]");
    await completeLine(line, 1);
    await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector('[data-receiving-line-state="receipt"]')).not.toBeNull();

    await render(3);
    expect(container.querySelector('[data-receiving-line-state="committed"]')).not.toBeNull();
    expect(container.textContent).toContain("Current stock and cost projections confirm this line");
  });
});
