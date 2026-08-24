// @vitest-environment jsdom

import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AmbientGlobalPilotSurface from "../AmbientGlobalPilotSurface";

const MODEL = Object.freeze({
  target: "choose_opportunity",
  routeId: "home",
  routeLabel: "Now",
  object: Object.freeze({
    id: "workspace-selection",
    type: "opportunity-selection",
    label: "Opportunity context"
  }),
  reason: "Pilot was opened from Now without a selected opportunity.",
  consequence: "Pilot will not infer which customer or quote the request belongs to.",
  nextResolution: Object.freeze({
    id: "choose-opportunity",
    label: "Choose the exact opportunity you want Pilot to help with."
  })
});

function FocusHarness({ onChooseOpportunity }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>Open Pilot</button>
      <AmbientGlobalPilotSurface
        open={open}
        model={MODEL}
        anchorRef={triggerRef}
        returnFocusRef={triggerRef}
        onClose={() => setOpen(false)}
        onChooseOpportunity={onChooseOpportunity}
      />
    </>
  );
}

describe("Ambient global Pilot recovery surface", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };
    window.cancelAnimationFrame = () => {};
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("turns missing model data into a populated recovery instead of an empty dialog", () => {
    act(() => root.render(
      <AmbientGlobalPilotSurface open model={null} onClose={() => {}} />
    ));

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.closest(".ambient-context-surface").classList.contains("ambient-context-surface--align-start")).toBe(true);
    expect(dialog.textContent).toContain("No opportunity selected");
    expect(dialog.textContent).toContain("Current workspace");
    expect(dialog.textContent).toContain("Choose an opportunity to see guidance based on its saved details");
    expect(dialog.textContent).toContain("Choose an opportunity to continue");
    expect(dialog.textContent).toContain("Nothing in this quote, client, or connected service was changed.");
    expect(dialog.querySelector('[data-ambient-global-pilot-target="recovery"]')).not.toBeNull();
    expect(dialog.querySelector('button[data-ambient-action-id="open-opportunities"]')).not.toBeNull();
    expect(dialog.querySelector('button[data-ambient-action-id="open-opportunities"]').disabled).toBe(true);
    expect(dialog.querySelector('button[data-ambient-action-id="dismiss-global-pilot-context"]')).not.toBeNull();
  });

  test("renders the exact object, route, why, consequence, and next resolution", () => {
    act(() => root.render(
      <AmbientGlobalPilotSurface
        open
        model={MODEL}
        onClose={() => {}}
        onChooseOpportunity={() => {}}
      />
    ));

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain("Opportunity context · Now");
    expect(dialog.textContent).toContain(MODEL.reason);
    expect(dialog.textContent).toContain(MODEL.consequence);
    expect(dialog.textContent).toContain(MODEL.nextResolution.label);
    expect(dialog.textContent).toContain("Nothing in this quote, client, or connected service was changed.");
  });

  test.each(["choose_opportunity", "recovery"])(
    "offers one acknowledged opportunity choice for %s",
    (target) => {
      const onChooseOpportunity = vi.fn();
      act(() => root.render(
        <AmbientGlobalPilotSurface
          open
          model={{ ...MODEL, target }}
          onClose={() => {}}
          onChooseOpportunity={onChooseOpportunity}
        />
      ));

      const action = Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Choose an opportunity");
      expect(action).not.toBeNull();
      expect(action.dataset.ambientActionId).toBe("choose-opportunity");
      expect(action.disabled).toBe(false);
      act(() => action.click());
      expect(onChooseOpportunity).toHaveBeenCalledOnce();
    }
  );

  test("does not expose a dead enabled action when the chooser is unavailable", () => {
    act(() => root.render(
      <AmbientGlobalPilotSurface open model={MODEL} onClose={() => {}} />
    ));

    const action = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Choose an opportunity");
    expect(action).not.toBeNull();
    expect(action.disabled).toBe(true);
    expect(action.title).toContain("unavailable");
  });

  test("restores focus to the Pilot trigger after ContextSurface closes", () => {
    const onChooseOpportunity = vi.fn();
    act(() => root.render(<FocusHarness onChooseOpportunity={onChooseOpportunity} />));
    const trigger = container.querySelector("button");
    trigger.focus();
    act(() => trigger.click());

    const choose = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Choose an opportunity");
    expect(choose).toBe(document.activeElement);

    const close = container.querySelector('[aria-label="Close Pilot"]');
    act(() => close.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
