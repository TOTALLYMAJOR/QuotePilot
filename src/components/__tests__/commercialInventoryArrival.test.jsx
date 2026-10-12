// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import InventoryWorkspace from "../InventoryWorkspace";
import { createCommercialConsequenceHandoff } from "../../lib/commercialConsequenceNavigation";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ORGANIZATION_ID = "org-commercial-inventory";
const TARGET_ID = "ingredient-rice";

function ingredient(ingredientId, baseUnitId = "lb") {
  return {
    organizationId: ORGANIZATION_ID,
    ingredientId,
    name: ingredientId === TARGET_ID ? "Rice" : "Chicken",
    nameSortKey: ingredientId,
    category: "Food",
    baseUnitId,
    dimension: "mass",
    active: true,
    ingredientRevision: 1,
    stock: {
      state: "recorded",
      availability: "current",
      revision: 1,
      allocationRevision: 1,
      quantity: "10",
      committedQuantity: "0",
      availableToAllocateQuantity: "10",
      unit: baseUnitId,
      locationId: "main"
    },
    cost: { state: "not_recorded", availability: "not_yet_available", revision: 0 },
    packConversions: [],
    locationId: "main",
    locationName: "Main kitchen"
  };
}

function model(ingredients, page) {
  return {
    schemaVersion: 2,
    organizationId: ORGANIZATION_ID,
    workspace: {
      organizationId: ORGANIZATION_ID,
      locations: [{ locationId: "main", name: "Main kitchen", active: true, revision: 1 }]
    },
    ingredients,
    sources: {
      workspace: { state: "current", fromCache: false, hasPendingWrites: false },
      ingredients: { state: "current", fromCache: false, hasPendingWrites: false }
    },
    freshness: "current",
    bounded: true,
    page
  };
}

function arrival(baseUnitId = "lb") {
  const handoff = createCommercialConsequenceHandoff({
    kind: "inventory_ingredient",
    quoteId: "quote-91",
    beforeRevisionId: "revision-before",
    proposedRevisionId: "revision-proposed",
    targetId: TARGET_ID,
    baseUnitId,
    returnFocusId: "commercial-change-artifact-inventory-rice"
  }, { expectedQuoteId: "quote-91" });
  if (!handoff.ok) throw new Error(handoff.recovery.code);
  return handoff.contract;
}

let container;
let root;
let originalMatchMedia;
let originalScrollIntoView;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  originalMatchMedia = window.matchMedia;
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  window.matchMedia = vi.fn(() => ({ matches: false }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.matchMedia = originalMatchMedia;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  vi.restoreAllMocks();
});

async function renderArrival({ requestedBaseUnit = "lb", recordedBaseUnit = "lb" } = {}) {
  const subscribeProjections = vi.fn(({ cursor, onData }) => {
    onData(cursor
      ? model([ingredient(TARGET_ID, recordedBaseUnit)], {
          size: 1,
          cursor,
          nextCursor: null,
          hasPrevious: true,
          hasNext: false
        })
      : model([ingredient("ingredient-chicken")], {
          size: 1,
          cursor: null,
          nextCursor: "cursor-page-2",
          hasPrevious: false,
          hasNext: true
        }));
    return () => {};
  });
  const onArrivalResolution = vi.fn();
  await act(async () => {
    root.render(
      <InventoryWorkspace
        organizationId={ORGANIZATION_ID}
        role="admin"
        browserEnabled
        tenantEnabled
        subscribeProjections={subscribeProjections}
        pendingCommands={() => []}
        arrivalContext={arrival(requestedBaseUnit)}
        onArrivalResolution={onArrivalResolution}
      />
    );
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  });
  return { onArrivalResolution, subscribeProjections };
}

describe("commercial Inventory consequence arrival", () => {
  test("pages sequentially and focuses only the exact ingredient and base unit", async () => {
    const { onArrivalResolution, subscribeProjections } = await renderArrival();
    const target = container.querySelector(`[data-inventory-ingredient-row="${TARGET_ID}"]`);

    expect(subscribeProjections).toHaveBeenCalledWith(expect.objectContaining({ cursor: null }));
    expect(subscribeProjections).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cursor-page-2" }));
    expect(target?.dataset.inventoryBaseUnit).toBe("lb");
    expect(target?.tabIndex).toBe(-1);
    expect(onArrivalResolution).toHaveBeenLastCalledWith({
      status: "resolved",
      ingredientId: TARGET_ID,
      baseUnitId: "lb"
    });
  });

  test("recovers instead of converting or substituting a different base unit", async () => {
    const { onArrivalResolution } = await renderArrival({
      requestedBaseUnit: "lb",
      recordedBaseUnit: "kg"
    });

    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "recovery",
      reason: expect.stringMatching(/different base unit/i),
      consequence: expect.stringMatching(/No converted or similarly named ingredient was substituted/i)
    }));
    expect(onArrivalResolution).not.toHaveBeenCalledWith(expect.objectContaining({ status: "resolved" }));
  });
});
