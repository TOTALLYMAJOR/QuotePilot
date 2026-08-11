// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const lib = vi.hoisted(() => ({ loadEventShapeMemory: vi.fn() }));
vi.mock("../../lib/eventShapeMemory", () => ({ loadEventShapeMemory: lib.loadEventShapeMemory }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const EVENT_TYPES = [{ id: "wedding", name: "Wedding" }];
const SUCCESS_SHAPE = {
  eventTypeId: "wedding",
  band: "50-99",
  sampleSize: 5,
  sufficient: true,
  staffing: { servers: 6, chefs: 2, bartenders: 1 },
  hours: 5,
  rentals: [{ id: "linens", name: "Linens", count: 4 }]
};

let CreateIntake;
let applyDraft;
let container;
let root;

beforeAll(async () => {
  vi.stubEnv("VITE_PILOT_MEMORY_ENABLED", "true");
  ({ default: CreateIntake } = await import("../CreateIntake"));
});

beforeEach(() => {
  vi.clearAllMocks();
  applyDraft = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function renderAndStructure(initialText) {
  act(() => {
    root.render(
      <CreateIntake
        eventTypes={EVENT_TYPES}
        styles={["Plated"]}
        onApplyDraft={applyDraft}
        organizationId="org-memory"
        initialText={initialText}
      />
    );
  });
  await settle();
  const button = [...container.querySelectorAll("button")]
    .find((b) => b.textContent.trim() === "Structure it");
  act(() => { button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  await settle();
}

describe("CreateIntake event-shape memory read states (flag on)", () => {
  test("fires automatically once structuring yields both event type and guests, with no separate button", async () => {
    lib.loadEventShapeMemory.mockResolvedValue(SUCCESS_SHAPE);
    await renderAndStructure("Wedding for 80 guests.");
    expect(lib.loadEventShapeMemory).toHaveBeenCalledWith({
      organizationId: "org-memory", eventTypeId: "wedding", guests: 80
    });
    expect(container.textContent).not.toContain("Memory assist");
  });

  test("shows loading while the history read is in flight", async () => {
    const gate = deferred();
    lib.loadEventShapeMemory.mockReturnValue(gate.promise);
    act(() => {
      root.render(
        <CreateIntake
          eventTypes={EVENT_TYPES}
          styles={["Plated"]}
          onApplyDraft={applyDraft}
          organizationId="org-memory"
          initialText="Wedding for 80 guests."
        />
      );
    });
    await settle();
    const button = [...container.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Structure it");
    act(() => { button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="loading"');
    act(() => gate.resolve(SUCCESS_SHAPE));
    await settle();
  });

  test("never fires when only one of event type or guests was read", async () => {
    lib.loadEventShapeMemory.mockResolvedValue(SUCCESS_SHAPE);
    await renderAndStructure("Something for 80 guests, not sure what kind.");
    expect(lib.loadEventShapeMemory).not.toHaveBeenCalled();
    expect(container.querySelector(".create-intake-memory")).toBeNull();
  });

  test("reports success with the median staffing/hours and majority rentals as informational text", async () => {
    lib.loadEventShapeMemory.mockResolvedValue(SUCCESS_SHAPE);
    await renderAndStructure("Wedding for 80 guests.");
    expect(container.innerHTML).toContain('data-capability-state="success"');
    expect(container.textContent).toContain("6 servers, 2 chefs, 1 bartenders over 5 hours");
    expect(container.textContent).toContain("Based on 5 of your booked events (50-99 guests)");
    expect(container.textContent).toContain("Also commonly included: Linens.");
  });

  test("applying sets only staffing and hours, never rentals, prices, or anything else", async () => {
    lib.loadEventShapeMemory.mockResolvedValue(SUCCESS_SHAPE);
    await renderAndStructure("Wedding for 80 guests.");
    const apply = [...container.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Apply to draft");
    act(() => { apply.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    await settle();
    expect(applyDraft).toHaveBeenCalledWith({ servers: 6, chefs: 2, bartenders: 1, hours: 5 });
    expect(container.textContent).toContain("Applied to this draft.");
    expect(container.querySelector("button")?.textContent).not.toBe("Apply to draft");
  });

  test("reports the honest empty and partial cold-start states with no apply action", async () => {
    lib.loadEventShapeMemory.mockResolvedValueOnce({ ...SUCCESS_SHAPE, sampleSize: 0, sufficient: false, staffing: null, hours: null, rentals: [] });
    await renderAndStructure("Wedding for 80 guests.");
    expect(container.innerHTML).toContain('data-capability-state="empty"');
    expect(container.textContent).toContain("nothing to suggest from history");

    lib.loadEventShapeMemory.mockResolvedValueOnce({ ...SUCCESS_SHAPE, sampleSize: 2, sufficient: false, staffing: null, hours: null, rentals: [] });
    await renderAndStructure("Wedding for 80 guests.");
    expect(container.innerHTML).toContain('data-capability-state="partial"');
    expect(container.textContent).toContain("Only 2 similar past events on file");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent.trim() === "Apply to draft"))
      .toBe(false);
  });

  test("a failed read offers retry; a second failure escalates from error to recovery, both retryable", async () => {
    lib.loadEventShapeMemory.mockRejectedValue(new Error("Similar-event history is unreachable."));
    await renderAndStructure("Wedding for 80 guests.");
    expect(container.innerHTML).toContain('data-capability-state="error"');

    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Retry");
    act(() => { retry.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    expect(container.textContent).toContain("Still unreachable");
    expect(container.textContent).toContain("Safe to try again");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent.trim() === "Try again")).toBe(true);
  });

  test("re-structuring resets a prior memory result and applied state", async () => {
    lib.loadEventShapeMemory.mockResolvedValue(SUCCESS_SHAPE);
    await renderAndStructure("Wedding for 80 guests.");
    const apply = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Apply to draft");
    act(() => { apply.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    await settle();
    expect(container.textContent).toContain("Applied to this draft.");

    lib.loadEventShapeMemory.mockResolvedValue({ ...SUCCESS_SHAPE, sampleSize: 0, sufficient: false, staffing: null, hours: null, rentals: [] });
    const structureAgain = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Structure it");
    act(() => { structureAgain.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    await settle();
    expect(container.textContent).not.toContain("Applied to this draft.");
  });
});
