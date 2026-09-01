// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const service = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  review: vi.fn(),
  publish: vi.fn()
}));

vi.mock("../../lib/catalogSetupDraftService", () => ({
  createCatalogSetupRequestId: () => "draft_request_1234567890",
  getCatalogSetupDraft: service.get,
  saveCatalogSetupDraft: service.save,
  reviewCatalogSetupDraft: service.review,
  publishCatalogSetupDraft: service.publish
}));

import {
  catalogSetupDeviceBufferKey,
  useCatalogSetupDraft
} from "../useCatalogSetupDraft";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("catalog setup draft autosave", () => {
  let container;
  let root;
  let current;

  function Harness() {
    current = useCatalogSetupDraft({
      organizationId: "acme",
      baseCatalogRevision: 7
    });
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    service.get.mockResolvedValue({
      currentCatalogRevision: 7,
      draft: { state: "empty", generation: 0, changedRecordCount: 0, changes: [] }
    });
    service.save.mockResolvedValue({
      draft: { state: "open", generation: 1, changedRecordCount: 2, changes: [] }
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
    current = null;
  });

  test("coalesces rapid local edits into one non-blocking sync after 800 ms", async () => {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      current.queueChanges([{
        collection: "menuItems",
        recordId: "menu-a",
        intent: "update",
        payload: { name: "First" }
      }]);
      current.queueChanges([{
        collection: "menuItems",
        recordId: "menu-a",
        intent: "update",
        payload: { name: "Latest" }
      }]);
      current.queueChanges([{
        collection: "settings",
        recordId: "config",
        intent: "update",
        payload: { serverRateMinor: 4800 }
      }]);
    });
    expect(current.label).toBe("Saving draft");
    expect(current.deviceOnly).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(799); });
    expect(service.save).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(service.save).toHaveBeenCalledTimes(1);
    expect(service.save.mock.calls[0][0]).toMatchObject({
      expectedGeneration: 0,
      baseCatalogRevision: 7,
      patches: [
        expect.objectContaining({ collection: "menuItems", payload: { name: "Latest" } }),
        expect.objectContaining({ collection: "settings", payload: { serverRateMinor: 4800 } })
      ]
    });
    expect(current.label).toBe("Ready to review");
    expect(current.deviceOnly).toBe(false);
  });

  test("retains an unsent device-only buffer and exposes retry when synchronization fails", async () => {
    service.save.mockRejectedValueOnce(new Error("network unavailable"));
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      current.queueChanges([{
        collection: "settings",
        recordId: "config",
        intent: "update",
        payload: { serverRateMinor: 4800 }
      }]);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });

    expect(current.label).toMatch(/Sync failed/);
    expect(current.deviceOnly).toBe(true);
    expect(current.deviceChanges).toHaveLength(1);
    expect(service.save).toHaveBeenCalledTimes(1);

    service.save.mockResolvedValueOnce({
      draft: { state: "open", generation: 1, changedRecordCount: 1, changes: [] }
    });
    await act(async () => { await current.retry(); });
    expect(service.save).toHaveBeenCalledTimes(2);
    expect(current.deviceOnly).toBe(false);
  });

  test("rehydrates an unsent device-only buffer after the editor unmounts", async () => {
    service.save.mockRejectedValue(new Error("network unavailable"));
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      current.queueChanges([{
        collection: "menuItems",
        recordId: "menu-a",
        intent: "update",
        payload: { name: "Roasted chicken", priceMinor: 1234, categoryId: "section-b" }
      }]);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(localStorage.getItem(catalogSetupDeviceBufferKey("acme"))).toContain('"priceMinor":1234');

    act(() => root.unmount());
    root = createRoot(container);
    service.get.mockRejectedValueOnce(new Error("Cloud Functions unavailable"));
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await Promise.resolve(); });

    expect(current.deviceOnly).toBe(true);
    expect(current.label).toMatch(/Sync failed/);
    expect(current.changes).toEqual([
      expect.objectContaining({ collection: "menuItems", recordId: "menu-a" })
    ]);
  });

  test("fails a rehydrated buffer closed when the active catalog revision changed", async () => {
    localStorage.setItem(catalogSetupDeviceBufferKey("acme"), JSON.stringify({
      version: "quotepilot.catalog-setup-device-buffer.v1",
      organizationId: "acme",
      baseCatalogRevision: 6,
      changes: [{
        collection: "menuItems",
        recordId: "menu-a",
        intent: "update",
        payload: { priceMinor: 1234 }
      }]
    }));
    service.get.mockResolvedValueOnce({
      currentCatalogRevision: 7,
      draft: { state: "empty", generation: 0, changedRecordCount: 0, changes: [] }
    });

    await act(async () => { root.render(<Harness />); });
    await act(async () => { await Promise.resolve(); });

    expect(current.status).toBe("conflict");
    expect(current.deviceOnly).toBe(true);
    expect(current.changes).toHaveLength(1);
    expect(service.save).not.toHaveBeenCalled();
  });

  test("discards an exact unsent record when the editor reverts it before synchronization", async () => {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      current.queueChanges([{
        collection: "catalogPackages",
        recordId: "package-a",
        intent: "update",
        payload: { name: "Changed" }
      }]);
    });
    expect(current.deviceOnly).toBe(true);

    act(() => {
      expect(current.discardDeviceChanges([{
        collection: "catalogPackages",
        recordId: "package-a"
      }])).toBe(true);
    });

    expect(current.deviceOnly).toBe(false);
    expect(current.changes).toEqual([]);
    expect(localStorage.getItem(catalogSetupDeviceBufferKey("acme"))).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(service.save).not.toHaveBeenCalled();
  });
});
