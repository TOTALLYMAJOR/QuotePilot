// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  reconcile: vi.fn(),
  reset: vi.fn(),
  planSubscribe: vi.fn(),
  executionSubscribe: vi.fn(),
  definitive: vi.fn((error) => error?.inventoryDefinitive === true)
}));

vi.mock("../../lib/inventoryAuthorityClient", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    applyInventoryCommand: mocks.apply,
    buildInventoryRequestId: () => `inventory_request_${"a".repeat(32)}`,
    isDefinitiveInventoryError: mocks.definitive,
    reconcileInventoryCommand: mocks.reconcile,
    resetDefinitiveInventoryCommand: mocks.reset,
    subscribeToEventIngredientProjection: mocks.planSubscribe,
    subscribeToEventIngredientExecutionProjection: mocks.executionSubscribe
  };
});

import { useEventIngredientExecutionProjection } from "../useEventIngredientExecutionProjection";

const BASE = {
  active: true,
  organizationId: "org-execution-hook",
  role: "admin",
  browserEnabled: true,
  tenantEnabled: true,
  quoteId: "quote-1",
  quoteStatus: "accepted"
};
const REQUIREMENT_ID = `eir_${"e".repeat(48)}`;
const EXECUTION_ID = `eiex_${"6".repeat(48)}`;
const PLAN = {
  quoteId: "quote-1",
  allocation: {
    state: "reserved",
    eventRequirementRevisionId: REQUIREMENT_ID,
    allocationRevision: 1,
    ingredients: [{
      ingredientId: "chicken", locationId: "main-kitchen", baseUnitId: "lb",
      stockRevision: 1, requiredQuantityMicros: 20_000_000, allocatedQuantityMicros: 20_000_000
    }]
  }
};

let container;
let root;
let latest;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness(props) {
  latest = useEventIngredientExecutionProjection(props);
  return <div data-plan={latest.planRead.state} data-execution={latest.read.state} />;
}

function render(props = BASE) {
  act(() => root.render(<Harness {...props} />));
}

function current(projection, exists = true) {
  return { quoteId: "quote-1", exists, projection: exists ? projection : null, freshness: "current", source: { state: "current" } };
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.planSubscribe.mockReturnValue(vi.fn());
  mocks.executionSubscribe.mockReturnValue(vi.fn());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("uses separate exact plan and execution listeners and disables customer access", () => {
  const planUnsubscribe = vi.fn();
  const executionUnsubscribe = vi.fn();
  mocks.planSubscribe.mockReturnValue(planUnsubscribe);
  mocks.executionSubscribe.mockReturnValue(executionUnsubscribe);
  render();
  expect(mocks.planSubscribe).toHaveBeenCalledWith(expect.objectContaining({ quoteId: "quote-1" }));
  expect(mocks.executionSubscribe).toHaveBeenCalledWith(expect.objectContaining({ quoteId: "quote-1" }));
  render({ ...BASE, quoteId: "quote-2" });
  expect(planUnsubscribe).toHaveBeenCalledOnce();
  expect(executionUnsubscribe).toHaveBeenCalledOnce();
  render({ ...BASE, quoteId: "quote-2", role: "customer" });
  expect(latest.access.readEnabled).toBe(false);
  expect(mocks.planSubscribe).toHaveBeenCalledTimes(2);
  expect(mocks.executionSubscribe).toHaveBeenCalledTimes(2);
});

test("keeps cached and pending snapshots non-authoritative and recognizes confirmed absence as not recorded", () => {
  render();
  const planListener = mocks.planSubscribe.mock.calls[0][0];
  const executionListener = mocks.executionSubscribe.mock.calls[0][0];
  act(() => planListener.onData(current(PLAN)));
  act(() => executionListener.onData({ ...current(null, false), freshness: "cached", source: { state: "cached" } }));
  expect(latest.read.state).toBe("cached");
  expect(latest.canRecord).toBe(false);
  act(() => executionListener.onData({ ...current(null, false), freshness: "pending", source: { state: "pending" } }));
  expect(latest.read.state).toBe("pending");
  expect(latest.canRecord).toBe(false);
  act(() => executionListener.onData(current(null, false)));
  expect(latest.read.state).toBe("not_recorded");
  expect(latest.canRecord).toBe(true);
});

test("submits a complete sorted closeout and commits only after exact projection readback", async () => {
  render();
  const planListener = mocks.planSubscribe.mock.calls[0][0];
  const executionListener = mocks.executionSubscribe.mock.calls[0][0];
  act(() => planListener.onData(current(PLAN)));
  act(() => executionListener.onData(current(null, false)));
  mocks.apply.mockResolvedValue({
    receipt: { receiptId: `iar_${"b".repeat(48)}` },
    confirmation: {
      executionRevision: 1,
      eventExecutionRevisionId: EXECUTION_ID,
      eventRequirementRevisionId: REQUIREMENT_ID,
      movementIds: [`imv_${"7".repeat(48)}`]
    }
  });
  await act(async () => latest.record({
    occurredAtISO: "2026-09-09T05:00:00.000Z",
    reason: "Event closeout count",
    ingredients: [{
      ingredientId: "chicken", locationId: "main-kitchen", baseUnitId: "lb",
      expectedStockRevision: 1, consumedQuantity: "18.5", wasteQuantity: "1.5"
    }]
  }));
  expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
    command: {
      kind: "record_event_ingredient_execution",
      quoteId: "quote-1",
      eventRequirementRevisionId: REQUIREMENT_ID,
      expectedExecutionRevision: 0,
      expectedAllocationRevision: 1,
      occurredAtISO: "2026-09-09T05:00:00.000Z",
      reason: "Event closeout count",
      ingredients: [expect.objectContaining({ consumedQuantity: "18.5", wasteQuantity: "1.5" })]
    }
  }));
  expect(latest.operation.state).toBe("receipt");
  act(() => executionListener.onData(current({
    state: "settled",
    executionRevision: 1,
    eventExecutionRevisionId: EXECUTION_ID,
    eventRequirementRevisionId: REQUIREMENT_ID,
    lastReceiptId: `iar_${"b".repeat(48)}`,
    movementIds: [`imv_${"7".repeat(48)}`]
  })));
  expect(latest.operation.state).toBe("committed");
});

test("sales can read but cannot mutate and uncertain outcomes preserve exact recovery identity", async () => {
  render({ ...BASE, role: "sales" });
  const planListener = mocks.planSubscribe.mock.calls[0][0];
  const executionListener = mocks.executionSubscribe.mock.calls[0][0];
  act(() => planListener.onData(current(PLAN)));
  act(() => executionListener.onData(current(null, false)));
  expect(latest.access.readEnabled).toBe(true);
  expect(latest.access.mutationEnabled).toBe(false);
  expect(latest.canRecord).toBe(false);

  render();
  act(() => mocks.planSubscribe.mock.calls.at(-1)[0].onData(current(PLAN)));
  act(() => mocks.executionSubscribe.mock.calls.at(-1)[0].onData(current(null, false)));
  mocks.apply.mockRejectedValue(Object.assign(new Error("connection ended"), { inventoryDefinitive: false }));
  await act(async () => {
    await expect(latest.record({
      occurredAtISO: "2026-09-09T05:00:00.000Z",
      reason: "Event closeout count",
      ingredients: [{ ingredientId: "chicken", locationId: "main-kitchen", baseUnitId: "lb", expectedStockRevision: 1, consumedQuantity: "18", wasteQuantity: "2" }]
    })).rejects.toThrow("connection ended");
  });
  expect(latest.operation).toMatchObject({
    state: "uncertain",
    requestId: `inventory_request_${"a".repeat(32)}`
  });
});
