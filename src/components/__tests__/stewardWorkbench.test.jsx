// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import StewardWorkbench, { STEWARD_WORKBENCH_STATES } from "../StewardWorkbench";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props = {}) {
  act(() => {
    root.render(
      <StewardWorkbench
        state="provider_unavailable"
        quoteNumber="QP-101"
        onOpenManualComposer={vi.fn()}
        {...props}
      />
    );
  });
}

describe("StewardWorkbench", () => {
  test.each(Object.entries(STEWARD_WORKBENCH_STATES))(
    "renders the bounded %s state without enabling Steward handoff",
    (state, copy) => {
      render({ state });
      const workbench = container.querySelector('[data-capability-id="steward-difficult-question-workbench"]');
      expect(workbench).not.toBeNull();
      expect(workbench.dataset.stewardState).toBe(state);
      expect(workbench.textContent).toContain(copy.headline);
      expect(workbench.textContent).toContain("No changes made");
      expect(workbench.querySelector("button[disabled]").textContent).toContain("Steward handoff unavailable");
      expect(workbench.textContent).not.toContain("Send with Steward");
    }
  );

  test("keeps the ordinary manual composer available during provider outage", () => {
    const onOpenManualComposer = vi.fn();
    render({ onOpenManualComposer });
    const manualButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Open manual message"));

    act(() => manualButton.click());

    expect(onOpenManualComposer).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Steward is unavailable; quoting is not");
    expect(container.textContent).toContain("not connected to a reviewed private runtime");
  });

  test("shows named preparation stages instead of simulated token streaming", () => {
    render({ state: "preparing" });
    const stages = container.querySelector('[aria-label="Steward preparation stages"]');
    expect(stages.textContent).toContain("Source check");
    expect(stages.textContent).toContain("Policy check");
    expect(stages.textContent).toContain("Packet validation");
    expect(container.textContent).not.toContain("token");
  });

  test("renders an untrusted scope label as text", () => {
    render({ quoteNumber: '<img src=x onerror="alert(1)">' });
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector("img")).toBeNull();
  });

  test("maps the loading state to named preparation work", () => {
    render({ state: "preparing" });
    expect(container.innerHTML).toContain('data-capability-state="loading"');
  });

  test("maps the empty state to no available Steward output", () => {
    render({ state: "provider_unavailable" });
    expect(container.innerHTML).toContain('data-capability-state="empty"');
  });

  test("maps the success state to a hidden review packet", () => {
    render({ state: "ready_for_review" });
    expect(container.innerHTML).toContain('data-capability-state="success"');
  });

  test("maps the stale state to exact revision drift", () => {
    render({ state: "stale" });
    expect(container.innerHTML).toContain('data-capability-state="stale"');
  });

  test("maps the partial state to structurally visible evidence gaps", () => {
    render({ state: "partially_verified" });
    expect(container.innerHTML).toContain('data-capability-state="partial"');
  });

  test("maps the error state to a held policy boundary", () => {
    render({ state: "refused" });
    expect(container.innerHTML).toContain('data-capability-state="error"');
  });

  test("maps recovery to the ordinary manual workflow", () => {
    render({ state: "expired" });
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
  });
});
