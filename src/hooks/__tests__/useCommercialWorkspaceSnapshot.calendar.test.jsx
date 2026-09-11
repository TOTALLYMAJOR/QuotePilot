// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const reads = vi.hoisted(() => ({
  attention: vi.fn(),
  history: vi.fn()
}));

vi.mock("../../lib/quoteStore", () => ({
  getWorkflowAttentionSnapshot: reads.attention,
  getQuoteHistory: reads.history
}));

import { useCommercialWorkspaceSnapshot } from "../useCommercialWorkspaceSnapshot";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;

function Probe({ tenantTimeZone, onValue }) {
  const value = useCommercialWorkspaceSnapshot({
    organizationId: "org-calendar",
    tenantTimeZone,
    includeRevenueAttention: false
  });
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reads.attention.mockReset();
  reads.history.mockReset();
  reads.attention.mockResolvedValue({ source: "local", quotes: [] });
  reads.history.mockResolvedValue({ source: "local", quotes: [], truncated: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mounted commercial snapshot tenant-day refresh", () => {
  test.each([
    ["2026-03-08T06:00:00.000Z", 23 * 60 * 60 * 1000 + 100],
    ["2026-11-01T05:00:00.000Z", 25 * 60 * 60 * 1000 + 100]
  ])("uses the tenant calendar across the business day beginning %s", async (nowISO, expectedDelay) => {
    vi.setSystemTime(nowISO);
    const timeout = vi.spyOn(window, "setTimeout");
    await act(async () => root.render(
      <Probe tenantTimeZone="America/Chicago" onValue={() => {}} />
    ));
    await settle();
    expect(reads.attention).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), expectedDelay);

    await act(async () => vi.advanceTimersByTime(expectedDelay));
    await settle();
    expect(reads.attention).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  test("reschedules on tenant settings change and cleans up before a delayed browser wake", async () => {
    vi.setSystemTime("2026-09-10T12:00:00.000Z");
    const values = [];
    await act(async () => root.render(
      <Probe tenantTimeZone="Asia/Kathmandu" onValue={(value) => values.push(value)} />
    ));
    await settle();
    expect(reads.history).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => root.render(
      <Probe tenantTimeZone="America/Chicago" onValue={(value) => values.push(value)} />
    ));
    await settle();
    expect(reads.history).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => root.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(30 * 60 * 60 * 1000));
    expect(reads.history).toHaveBeenCalledTimes(2);
    expect(values.some((value) => value.partial || value.stale)).toBe(false);
  });
});
