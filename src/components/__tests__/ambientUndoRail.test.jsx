// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AmbientUndoRail, createAmbientUndoModel } from "../ambient";

describe("Ambient undo model", () => {
  test("keeps a bounded newest-first history and reverses exact entries", async () => {
    const undo = vi.fn(async () => true);
    let id = 0;
    const model = createAmbientUndoModel({ limit: 2, now: () => 100, createId: () => `entry-${++id}` });
    model.push({ label: "Changed package", undo });
    model.push({ label: "Changed staffing", undo });
    model.push({ label: "Changed guest count", undo });

    expect(model.getSnapshot().map((entry) => entry.label)).toEqual([
      "Changed guest count",
      "Changed staffing"
    ]);
    await expect(model.undo("entry-3")).resolves.toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(model.getSnapshot().map((entry) => entry.label)).toEqual(["Changed staffing"]);
  });

  test("retains a failed undo with a truthful retry state", async () => {
    const undo = vi.fn(async () => false);
    const model = createAmbientUndoModel({ createId: () => "guest-count" });
    model.push({
      label: "Changed guest count",
      undo,
      failureMessage: "Guest count changed again. Review the latest value before retrying."
    });

    await expect(model.undo("guest-count")).resolves.toBe(false);
    expect(model.getSnapshot()[0]).toMatchObject({
      status: "failed",
      error: "Guest count changed again. Review the latest value before retrying."
    });
  });
});

describe("AmbientUndoRail", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("earns its surface only when a reversible action exists", async () => {
    const undo = vi.fn(async () => true);
    const model = createAmbientUndoModel({ createId: () => "staffing" });
    act(() => root.render(<AmbientUndoRail model={model} />));
    expect(container.querySelector(".ambient-undo-rail")).toBeNull();

    act(() => model.push({
      label: "Used staffing recommendation",
      detail: "Added one server",
      undo
    }));
    const rail = container.querySelector(".ambient-undo-rail");
    expect(rail.textContent).toContain("Used staffing recommendation");
    expect(rail.textContent).toContain("Added one server");

    await act(async () => {
      container.querySelector('[aria-label="Undo Used staffing recommendation"]').click();
      await Promise.resolve();
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".ambient-undo-rail")).toBeNull();
  });

  test("shows contextual recovery when undo fails", async () => {
    const model = createAmbientUndoModel({ createId: () => "menu" });
    act(() => root.render(<AmbientUndoRail model={model} />));
    act(() => model.push({
      label: "Removed salad",
      undo: async () => false,
      failureMessage: "The menu changed again. Review it before retrying."
    }));

    await act(async () => {
      container.querySelector('[aria-label="Undo Removed salad"]').click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]').textContent).toBe(
      "The menu changed again. Review it before retrying."
    );
    expect(container.querySelector('[aria-label="Try undo again for Removed salad"]')).not.toBeNull();
  });

  test("reports exact undo and clear lifecycles with registered action IDs", async () => {
    const onUndoStart = vi.fn(() => ({ token: "undo-token" }));
    const onUndoResult = vi.fn();
    const onClearStart = vi.fn(() => ({ token: "clear-token" }));
    const onClear = vi.fn();
    const model = createAmbientUndoModel({ createId: () => "guest" });
    act(() => root.render(
      <AmbientUndoRail
        model={model}
        onUndoStart={onUndoStart}
        onUndoResult={onUndoResult}
        onClearStart={onClearStart}
        onClear={onClear}
        undoActionId="undo-guest-scenario"
        clearActionId="clear-guest-scenario-history"
      />
    ));
    act(() => model.push({ label: "Changed guest count", undo: async () => true }));

    const undoButton = container.querySelector('[aria-label="Undo Changed guest count"]');
    expect(undoButton.dataset.ambientActionId).toBe("undo-guest-scenario");
    await act(async () => {
      undoButton.click();
      await Promise.resolve();
    });
    expect(onUndoResult).toHaveBeenCalledWith(expect.objectContaining({
      resolved: true,
      undoContext: { token: "undo-token" }
    }));

    act(() => model.push({ label: "Changed guest count again", undo: async () => true }));
    const clearButton = [...container.querySelectorAll("button")]
      .find((item) => item.textContent === "Clear history");
    expect(clearButton.dataset.ambientActionId).toBe("clear-guest-scenario-history");
    act(() => clearButton.click());
    expect(onClear).toHaveBeenCalledWith({
      cleared: true,
      count: 1,
      clearContext: { token: "clear-token" }
    });
  });

  test("carries the exact registered undo action on mixed scenario entries", () => {
    let id = 0;
    const model = createAmbientUndoModel({ createId: () => `mixed-${++id}` });
    act(() => root.render(
      <AmbientUndoRail
        model={model}
        undoActionId={(entry) => entry.actionId}
        clearActionId="clear-scenario-history"
      />
    ));
    act(() => {
      model.push({
        label: "Used staffing recommendation",
        actionId: "undo-staffing-scenario",
        undo: async () => true
      });
      model.push({
        label: "Changed guest count",
        actionId: "undo-guest-scenario",
        undo: async () => true
      });
    });

    expect(container.querySelector('[aria-label="Undo Changed guest count"]')
      .dataset.ambientActionId).toBe("undo-guest-scenario");
    const olderStaffingUndo = container.querySelector('[aria-label="Undo Used staffing recommendation"]');
    expect(olderStaffingUndo.dataset.ambientActionId).toBe("undo-staffing-scenario");
    expect(olderStaffingUndo.disabled).toBe(true);
    expect(olderStaffingUndo.title).toContain("newer");
  });
});
