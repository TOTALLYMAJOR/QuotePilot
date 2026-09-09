// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  preview: vi.fn(),
  reconcile: vi.fn(),
  reset: vi.fn(),
  subscribe: vi.fn(),
  definitive: vi.fn((error) => error?.inventoryDefinitive === true)
}));

vi.mock("../../lib/inventoryAuthorityClient", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    applyInventoryCommand: mocks.apply,
    buildInventoryRequestId: () => `inventory_request_${"a".repeat(32)}`,
    isDefinitiveInventoryError: mocks.definitive,
    previewEventInventory: mocks.preview,
    reconcileInventoryCommand: mocks.reconcile,
    resetDefinitiveInventoryCommand: mocks.reset,
    subscribeToEventIngredientProjection: mocks.subscribe
  };
});

import {
  buildEventIngredientSelectionInputs,
  useEventIngredientProjection
} from "../useEventIngredientProjection";

const BASE = {
  active: true,
  organizationId: "org-event-hook",
  role: "admin",
  browserEnabled: true,
  tenantEnabled: true,
  quoteId: "quote-1",
  quoteStatus: "accepted",
  savedQuoteRevisionId: "quote-revision-2",
  selections: [{
    selectionId: "selection-1",
    menuItemId: "menu-1",
    recipeRevisionId: null,
    requiredOutputQuantity: "100",
    outputUnitId: null,
    portionBasis: { kind: "explicit_output_quantity", evidenceId: "menu-1" },
    commercialProvenance: { kind: "direct", sourceId: "menu-1" }
  }],
  draftDirty: false
};

let container;
let root;
let latest;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness(props) {
  latest = useEventIngredientProjection(props);
  return <div data-state={latest.read.state} data-operation={latest.operation.state} />;
}

function render(props = BASE) {
  act(() => root.render(<Harness {...props} />));
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.subscribe.mockReturnValue(vi.fn());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("subscribes only for enabled same-tenant staff and tears down on quote, role, organization, gate, and unmount", () => {
  const registrations = [];
  mocks.subscribe.mockImplementation((input) => {
    const unsubscribe = vi.fn();
    registrations.push({ input, unsubscribe });
    return unsubscribe;
  });

  render();
  expect(registrations[0].input).toMatchObject({ organizationId: "org-event-hook", quoteId: "quote-1", role: "admin" });
  render({ ...BASE, quoteId: "quote-2" });
  expect(registrations[0].unsubscribe).toHaveBeenCalledOnce();
  render({ ...BASE, quoteId: "quote-2", role: "sales" });
  expect(registrations[1].unsubscribe).toHaveBeenCalledOnce();
  render({ ...BASE, quoteId: "quote-2", role: "customer" });
  expect(registrations).toHaveLength(3);
  expect(registrations[2].unsubscribe).toHaveBeenCalledOnce();
  render({ ...BASE, organizationId: "org-other", browserEnabled: false });
  expect(mocks.subscribe).toHaveBeenCalledTimes(3);
  expect(latest.read.state).toBe("not_evaluated");
});

test("builds exact saved menu evidence without inferring portions from guests or billing quantities", () => {
  const selections = buildEventIngredientSelectionInputs({
    quote: {
      event: { guests: 175 },
      selection: {
        packageId: "package-dinner",
        menuItems: ["menu-1", "menu-2"],
        menuItemQuantities: { "menu-1": 175 },
        menuItemsSnapshot: [
          { id: "menu-1", name: "Chicken" },
          { id: "menu-2", name: "Pasta" }
        ],
        packageInclusions: { menuItems: [{ id: "menu-1" }] }
      }
    },
    recipeProjectionsByMenuItemId: {
      "menu-1": {
        recipeRevisionId: `irr_${"a".repeat(48)}`,
        recipeDefinition: { outputUnitId: "portion" }
      }
    }
  });
  expect(selections).toEqual([
    expect.objectContaining({
      menuItemId: "menu-1",
      requiredOutputQuantity: "",
      outputUnitId: "portion",
      commercialProvenance: {
        kind: "package_inclusion",
        sourceId: "menu-1",
        packageId: "package-dinner",
        inclusionId: "menu-1"
      }
    }),
    expect.objectContaining({
      menuItemId: "menu-2",
      recipeRevisionId: null,
      requiredOutputQuantity: "",
      outputUnitId: null,
      commercialProvenance: { kind: "direct", sourceId: "menu-2" }
    })
  ]);
});

test("maps metadata, revision staleness, dirty drafts, and retained listener failures without claiming current truth", () => {
  const registrations = [];
  mocks.subscribe.mockImplementation((input) => {
    registrations.push(input);
    return vi.fn();
  });
  render();
  const projection = { quoteId: "quote-1", quoteRevisionId: "quote-revision-1", demandState: "complete" };

  act(() => registrations[0].onData({
    quoteId: "quote-1", exists: true, projection, freshness: "cached", source: { state: "cached" }
  }));
  expect(latest.read).toMatchObject({ state: "cached", projection, retained: false });
  act(() => registrations[0].onData({
    quoteId: "quote-1", exists: true, projection, freshness: "pending", source: { state: "pending" }
  }));
  expect(latest.read.state).toBe("pending");
  act(() => registrations[0].onData({
    quoteId: "quote-1", exists: true, projection, freshness: "current", source: { state: "current" }
  }));
  expect(latest.read).toMatchObject({ state: "stale", savedProjectionState: "stale" });

  render({ ...BASE, draftDirty: true });
  act(() => registrations.at(-1).onData({
    quoteId: "quote-1", exists: true, projection: { ...projection, quoteRevisionId: "quote-revision-2" },
    freshness: "current", source: { state: "current" }
  }));
  expect(latest.read).toMatchObject({ state: "draft_not_evaluated", savedProjectionState: "current" });
  expect(latest.canPreview).toBe(false);

  act(() => registrations.at(-1).onError({ message: "disconnected" }));
  expect(latest.read).toMatchObject({ state: "draft_not_evaluated", sourceState: "unavailable", retained: true });
  expect(latest.read.error).toMatch(/disconnected/i);
});

test("ignores late snapshot callbacks after its exact listener is replaced", () => {
  const registrations = [];
  mocks.subscribe.mockImplementation((input) => {
    registrations.push(input);
    return vi.fn();
  });
  render();
  render({ ...BASE, quoteId: "quote-2", savedQuoteRevisionId: "quote-revision-3" });
  act(() => registrations[0].onData({
    quoteId: "quote-1",
    exists: true,
    projection: { quoteId: "quote-1", quoteRevisionId: "quote-revision-2" },
    freshness: "current",
    source: { state: "current" }
  }));
  expect(latest.read.quoteId).toBe("quote-2");
  expect(latest.read.projection).toBeNull();
});

test("keeps preview read-only for sales and allows admin recording only from a current unchanged preview", async () => {
  const registrations = [];
  mocks.subscribe.mockImplementation((input) => {
    registrations.push(input);
    return vi.fn();
  });
  const projection = {
    quoteId: "quote-1",
    quoteRevisionId: "quote-revision-2",
    requiredByISO: "2026-10-11T16:00:00.000Z",
    selections: BASE.selections,
    projectionDigest: "a".repeat(64),
    eventRequirementRevisionId: `eir_${"b".repeat(48)}`,
    requirementDigest: "c".repeat(64)
  };
  mocks.preview.mockResolvedValue({ projection });
  const confirmation = {
    quoteId: "quote-1",
    quoteRevisionId: "quote-revision-2",
    requirementRevision: 1,
    eventRequirementRevisionId: projection.eventRequirementRevisionId,
    requirementDigest: projection.requirementDigest,
    projectionDigest: projection.projectionDigest
  };
  mocks.apply.mockResolvedValue({ receipt: { receiptId: "receipt-1" }, confirmation });
  render({ ...BASE, role: "sales" });

  await act(async () => latest.previewCurrent());
  expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ role: "sales", selections: BASE.selections }));
  expect(latest.preview).toMatchObject({ state: "current", projection });
  expect(latest.canRecord).toBe(false);
  await expect(latest.recordCurrentPreview()).rejects.toThrow(/administrator/i);

  render(BASE);
  await act(async () => latest.previewCurrent());
  expect(latest.canRecord).toBe(true);
  await expect(latest.recordCurrentPreview({
    selections: [{ ...BASE.selections[0], requiredOutputQuantity: "120" }]
  })).rejects.toThrow(/changed after preview/i);
  await act(async () => latest.recordCurrentPreview());
  expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
    requestId: `inventory_request_${"a".repeat(32)}`,
    command: expect.objectContaining({
      kind: "compile_event_ingredient_demand",
      quoteRevisionId: "quote-revision-2",
      selections: BASE.selections,
      expectedPreviewProjectionDigest: "a".repeat(64)
    })
  }));
  expect(latest.operation).toMatchObject({ state: "receipt", receipt: { receiptId: "receipt-1" } });
  act(() => registrations.at(-1).onData({
    quoteId: "quote-1",
    exists: true,
    projection: { ...projection, ...confirmation, freshness: "as_recorded" },
    freshness: "current",
    source: { state: "current" }
  }));
  expect(latest.operation).toMatchObject({ state: "committed", receipt: { receiptId: "receipt-1" } });
});

test("locks a transport-uncertain target through reconciliation and requires reset after definitive rejection", async () => {
  const registrations = [];
  mocks.subscribe.mockImplementation((input) => {
    registrations.push(input);
    return vi.fn();
  });
  const projection = {
    quoteId: "quote-1", quoteRevisionId: "quote-revision-2", requiredByISO: "2026-10-11T16:00:00.000Z",
    selections: BASE.selections, projectionDigest: "a".repeat(64),
    eventRequirementRevisionId: `eir_${"b".repeat(48)}`, requirementDigest: "c".repeat(64)
  };
  mocks.preview.mockResolvedValue({ projection });
  mocks.apply.mockRejectedValue(Object.assign(new Error("connection ended"), { inventoryDefinitive: false }));
  render();
  await act(async () => latest.previewCurrent());
  await act(async () => {
    await expect(latest.recordCurrentPreview()).rejects.toThrow(/connection ended/i);
  });
  expect(latest).toMatchObject({ controlsLocked: true, canPreview: false, operation: { state: "uncertain" } });

  let finishReconcile;
  mocks.reconcile.mockReturnValue(new Promise((resolve) => { finishReconcile = resolve; }));
  let reconcilePromise;
  act(() => { reconcilePromise = latest.reconcile(); });
  expect(latest.operation.state).toBe("reconciliation");
  await act(async () => {
    finishReconcile({
      receipt: { receiptId: "receipt-1" },
      confirmation: {
        quoteId: "quote-1", quoteRevisionId: "quote-revision-2", requirementRevision: 1,
        eventRequirementRevisionId: projection.eventRequirementRevisionId,
        requirementDigest: projection.requirementDigest,
        projectionDigest: projection.projectionDigest
      }
    });
    await reconcilePromise;
  });
  expect(latest.operation.state).toBe("receipt");
  act(() => registrations[0].onData({
    quoteId: "quote-1", exists: true,
    projection: { ...projection, requirementRevision: 1, freshness: "as_recorded" },
    freshness: "current", source: { state: "current" }
  }));
  expect(latest.operation.state).toBe("committed");

  mocks.apply.mockRejectedValue(Object.assign(new Error("revision stale"), { inventoryDefinitive: true }));
  await act(async () => {
    await expect(latest.recordCurrentPreview()).rejects.toThrow(/revision stale/i);
  });
  expect(latest.operation.state).toBe("rejected");
  expect(latest.controlsLocked).toBe(true);
  mocks.reset.mockReturnValue(true);
  act(() => latest.reset());
  expect(latest.operation.state).toBe("idle");
});

test("keeps allocation and release pending until the exact current projection confirms their receipts", async () => {
  const registrations = [];
  mocks.subscribe.mockImplementation((input) => {
    registrations.push(input);
    return vi.fn();
  });
  const requirement = {
    quoteId: "quote-1",
    quoteRevisionId: "quote-revision-2",
    requirementRevision: 1,
    eventRequirementRevisionId: `eir_${"b".repeat(48)}`,
    freshness: "as_recorded",
    demandState: "complete",
    sourceRevisions: {
      stockRevisions: [{ ingredientId: "chicken", locationId: "main-kitchen", revision: 1 }]
    }
  };
  const allocationConfirmation = {
    quoteId: "quote-1",
    eventPlanId: `eip_${"d".repeat(48)}`,
    allocationRevision: 1,
    state: "shortage",
    eventRequirementRevisionId: requirement.eventRequirementRevisionId,
    ingredientCount: 2,
    fullyAllocatedIngredientCount: 1,
    shortageIngredientCount: 1
  };
  mocks.apply.mockResolvedValueOnce({ receipt: { receiptId: "allocation-receipt" }, confirmation: allocationConfirmation });
  render();
  act(() => registrations[0].onData({
    quoteId: "quote-1", exists: true, projection: requirement,
    freshness: "current", source: { state: "current" }
  }));
  expect(latest.canAllocate).toBe(true);

  await act(async () => latest.allocate({ locationId: "main-kitchen" }));
  expect(mocks.apply).toHaveBeenLastCalledWith(expect.objectContaining({
    command: {
      kind: "allocate_event_ingredients",
      quoteId: "quote-1",
      eventRequirementRevisionId: requirement.eventRequirementRevisionId,
      locationId: "main-kitchen",
      expectedRequirementRevision: 1,
      expectedAllocationRevision: 0
    }
  }));
  expect(latest.allocationOperation.state).toBe("receipt");
  expect(latest.allocationControlsLocked).toBe(true);

  const allocation = { ...allocationConfirmation, ingredients: [] };
  act(() => registrations[0].onData({
    quoteId: "quote-1", exists: true, projection: { ...requirement, allocation },
    freshness: "current", source: { state: "current" }
  }));
  expect(latest.allocationOperation.state).toBe("committed");
  expect(latest.canAllocate).toBe(true);
  expect(latest.canRelease).toBe(true);

  const topUpConfirmation = {
    ...allocationConfirmation,
    allocationRevision: 2,
    state: "reserved",
    fullyAllocatedIngredientCount: 2,
    shortageIngredientCount: 0
  };
  mocks.apply.mockResolvedValueOnce({ receipt: { receiptId: "top-up-receipt" }, confirmation: topUpConfirmation });
  await act(async () => latest.allocate({ locationId: "main-kitchen" }));
  expect(mocks.apply).toHaveBeenLastCalledWith(expect.objectContaining({
    command: expect.objectContaining({
      kind: "allocate_event_ingredients",
      expectedAllocationRevision: 1,
      locationId: "main-kitchen"
    })
  }));
  expect(latest.allocationOperation.state).toBe("receipt");
  act(() => registrations[0].onData({
    quoteId: "quote-1", exists: true,
    projection: {
      ...requirement,
      allocation: {
        ...allocation,
        state: "reserved",
        allocationRevision: 2,
        fullyAllocatedIngredientCount: 2,
        shortageIngredientCount: 0
      }
    },
    freshness: "current", source: { state: "current" }
  }));
  expect(latest.allocationOperation.state).toBe("committed");
  expect(latest.canAllocate).toBe(false);
  expect(latest.canRelease).toBe(true);

  const releaseConfirmation = {
    ...topUpConfirmation,
    allocationRevision: 3,
    state: "released",
    releasedIngredientCount: 2
  };
  mocks.apply.mockResolvedValueOnce({ receipt: { receiptId: "release-receipt" }, confirmation: releaseConfirmation });
  await act(async () => latest.release({ reason: "Event cancelled" }));
  expect(mocks.apply).toHaveBeenLastCalledWith(expect.objectContaining({
    command: {
      kind: "release_event_ingredients",
      quoteId: "quote-1",
      expectedAllocationRevision: 2,
      reason: "Event cancelled"
    }
  }));
  expect(latest.allocationOperation.state).toBe("receipt");
  act(() => registrations[0].onData({
    quoteId: "quote-1", exists: true,
    projection: {
      ...requirement,
      allocation: {
        ...allocation,
        state: "released",
        allocationRevision: 3,
        fullyAllocatedIngredientCount: 2,
        shortageIngredientCount: 0
      }
    },
    freshness: "current", source: { state: "current" }
  }));
  expect(latest.allocationOperation.state).toBe("committed");
});

test.each(["draft", "sent", "declined", "cancelled"])("withholds allocation changes for %s quotes while preserving preview intelligence", async (quoteStatus) => {
  render({ ...BASE, quoteStatus });
  expect(latest.canPreview).toBe(true);
  expect(latest.canAllocate).toBe(false);
  expect(latest.canRelease).toBe(false);
  expect(latest.allocationBlockedReason).toMatch(/accepted or booked/i);
  await expect(latest.allocate({ locationId: "main-kitchen" })).rejects.toThrow(/accepted or booked/i);
  expect(mocks.apply).not.toHaveBeenCalled();
});

test("keeps sales read-only and ignores late allocation callbacks after teardown", async () => {
  render({ ...BASE, role: "sales" });
  await expect(latest.allocate({ locationId: "main-kitchen" })).rejects.toThrow(/administrator/i);
  expect(latest.canManageAllocation).toBe(false);
  expect(latest.canAllocate).toBe(false);

  let finish;
  mocks.apply.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const registrations = [];
  mocks.subscribe.mockImplementation((input) => { registrations.push(input); return vi.fn(); });
  render(BASE);
  act(() => registrations[0].onData({
    quoteId: "quote-1", exists: true,
    projection: {
      quoteId: "quote-1", quoteRevisionId: "quote-revision-2", requirementRevision: 1,
      eventRequirementRevisionId: `eir_${"b".repeat(48)}`, freshness: "as_recorded", demandState: "complete"
    },
    freshness: "current", source: { state: "current" }
  }));
  let commandPromise;
  act(() => { commandPromise = latest.allocate({ locationId: "main-kitchen" }); });
  render({ ...BASE, active: false });
  await act(async () => {
    finish({
      receipt: { receiptId: "late" },
      confirmation: {
        quoteId: "quote-1", eventPlanId: `eip_${"d".repeat(48)}`, allocationRevision: 1,
        state: "reserved", eventRequirementRevisionId: `eir_${"b".repeat(48)}`,
        ingredientCount: 1, fullyAllocatedIngredientCount: 1, shortageIngredientCount: 0
      }
    });
    await commandPromise;
  });
  expect(latest.allocationOperation.state).toBe("idle");
});
