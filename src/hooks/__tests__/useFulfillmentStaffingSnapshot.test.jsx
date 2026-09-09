// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSnapshot: vi.fn() }));

vi.mock("../../lib/operationalStaffingClient", () => ({
  getOperationalStaffingSnapshot: mocks.getSnapshot
}));

import {
  FULFILLMENT_STAFFING_MAX_AGE_MS,
  deriveFulfillmentStaffingRead,
  expireFulfillmentStaffingRead,
  useFulfillmentStaffingSnapshot
} from "../useFulfillmentStaffingSnapshot";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE = {
  active: true,
  organizationId: "org-alpha",
  quoteId: "quote-1",
  savedQuoteRevisionId: "version-2"
};

function envelope(overrides = {}) {
  return {
    organizationId: "org-alpha",
    quoteId: "quote-1",
    activeQuoteRevisionId: "version-2",
    state: "current",
    observedAtISO: "2026-09-09T16:00:00.000Z",
    profiles: [],
    canonicalRequirements: { lead: 0, server: 6, chef: 1, bartender: 0 },
    canonicalEventWindow: {
      startAtISO: "2026-10-11T16:00:00.000Z",
      endAtISO: "2026-10-12T00:00:00.000Z"
    },
    snapshot: null,
    ...overrides
  };
}

let container;
let root;
let latest;

function Harness(props) {
  latest = useFulfillmentStaffingSnapshot(props);
  return <div data-state={latest.read.state} />;
}

function render(props = BASE) {
  act(() => root.render(<Harness {...props} />));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("loads one bounded snapshot for the exact saved quote revision", async () => {
  mocks.getSnapshot.mockResolvedValue(envelope());
  await act(async () => {
    render();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(mocks.getSnapshot).toHaveBeenCalledOnce();
  expect(mocks.getSnapshot).toHaveBeenCalledWith({ organizationId: "org-alpha", quoteId: "quote-1" });
  expect(latest).toMatchObject({
    current: true,
    read: { state: "current", retained: false, observedAtISO: "2026-09-09T16:00:00.000Z" }
  });
});

test("does not include an unsaved guest scenario in its fetch identity", async () => {
  mocks.getSnapshot.mockResolvedValue(envelope());
  await act(async () => {
    render({ ...BASE, proposedGuestCount: 125 });
    await Promise.resolve();
    await Promise.resolve();
  });
  render({ ...BASE, proposedGuestCount: 175 });
  expect(mocks.getSnapshot).toHaveBeenCalledOnce();
});

test("rejects a mismatched organization, quote, or active revision as stale", () => {
  expect(deriveFulfillmentStaffingRead({
    envelope: envelope({ activeQuoteRevisionId: "version-1" }),
    ...BASE
  }).state).toBe("stale");
  expect(deriveFulfillmentStaffingRead({
    envelope: envelope({ organizationId: "org-other" }),
    ...BASE
  }).state).toBe("stale");
});

test("keeps only the newest quote response across rapid scope changes", async () => {
  const pending = [];
  mocks.getSnapshot.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  render();
  render({ ...BASE, quoteId: "quote-2", savedQuoteRevisionId: "version-3" });
  await act(async () => {
    pending[1](envelope({ quoteId: "quote-2", activeQuoteRevisionId: "version-3" }));
    await Promise.resolve();
  });
  expect(latest.read).toMatchObject({ state: "current", envelope: { quoteId: "quote-2" } });
  await act(async () => {
    pending[0](envelope());
    await Promise.resolve();
  });
  expect(latest.read).toMatchObject({ state: "current", envelope: { quoteId: "quote-2" } });
});

test("retains same-scope evidence as explicitly unavailable during a failed refresh", async () => {
  mocks.getSnapshot.mockResolvedValueOnce(envelope());
  await act(async () => {
    render();
    await Promise.resolve();
    await Promise.resolve();
  });
  mocks.getSnapshot.mockRejectedValueOnce(new Error("staffing disconnected"));
  await act(async () => {
    await expect(latest.refresh()).rejects.toThrow(/disconnected/i);
  });
  expect(latest.read).toMatchObject({
    state: "unavailable",
    retained: true,
    envelope: { quoteId: "quote-1" },
    error: "staffing disconnected"
  });
  expect(latest.current).toBe(false);
});

test("expires an unchanged revision after a bounded freshness window instead of labeling it current forever", () => {
  const read = deriveFulfillmentStaffingRead({
    envelope: envelope(),
    ...BASE,
    refreshedAtMs: 1_000
  });
  expect(expireFulfillmentStaffingRead(read, {
    nowMs: 1_000 + FULFILLMENT_STAFFING_MAX_AGE_MS - 1
  })).toBe(read);
  expect(expireFulfillmentStaffingRead(read, {
    nowMs: 1_000 + FULFILLMENT_STAFFING_MAX_AGE_MS
  })).toMatchObject({
    state: "stale",
    retained: true,
    envelope: { quoteId: "quote-1" }
  });
});

test("refreshes the exact saved-revision read when the operator returns to the window", async () => {
  mocks.getSnapshot.mockResolvedValue(envelope());
  await act(async () => {
    render();
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(mocks.getSnapshot).toHaveBeenCalledTimes(2);
  expect(mocks.getSnapshot).toHaveBeenLastCalledWith({
    organizationId: "org-alpha",
    quoteId: "quote-1"
  });
});
