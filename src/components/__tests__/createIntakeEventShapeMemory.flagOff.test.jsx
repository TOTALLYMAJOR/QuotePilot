// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const lib = vi.hoisted(() => ({ loadEventShapeMemory: vi.fn() }));
vi.mock("../../lib/eventShapeMemory", () => ({ loadEventShapeMemory: lib.loadEventShapeMemory }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  vi.clearAllMocks();
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

describe("CreateIntake event-shape memory with the flag off (default)", () => {
  test("never fetches and never renders the memory section, even for a fully structured event", async () => {
    const { default: CreateIntake } = await import("../CreateIntake");
    const applyDraft = vi.fn();
    act(() => {
      root.render(
        <CreateIntake
          eventTypes={[{ id: "wedding", name: "Wedding" }]}
          styles={["Plated"]}
          onApplyDraft={applyDraft}
          organizationId="org-flag-off"
          initialText="Wedding for 80 guests."
          autoStructure
        />
      );
    });
    await settle();
    expect(lib.loadEventShapeMemory).not.toHaveBeenCalled();
    expect(container.querySelector(".create-intake-memory")).toBeNull();
    expect(container.textContent).not.toContain("your own history");
  });
});
