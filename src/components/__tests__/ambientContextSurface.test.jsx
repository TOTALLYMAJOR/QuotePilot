// @vitest-environment jsdom

import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ContextSurface } from "../ambient";

function SurfaceHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>Review staffing</button>
      <ContextSurface
        open={open}
        title="Staffing impact"
        reason="Guest count increased to 135."
        consequence="One additional server protects the service ratio."
        returnFocusRef={triggerRef}
        onClose={() => setOpen(false)}
        closeActionId="dismiss-staffing-context"
        footer={<button type="button">Use recommendation</button>}
      >
        <button type="button" data-context-initial-focus>Keep current staffing</button>
      </ContextSurface>
    </>
  );
}

function AnchoredSurfaceHarness({ align = "end" }) {
  const anchorRef = useRef(null);
  return (
    <>
      <button ref={anchorRef} type="button">Inspect impact</button>
      <ContextSurface
        open
        title="Guest count impact"
        anchorRef={anchorRef}
        align={align}
        onClose={() => {}}
      >
        <p>Dependency evidence</p>
      </ContextSurface>
    </>
  );
}

describe("Ambient ContextSurface", () => {
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

  test("refuses to render an empty or untitled dialog", () => {
    act(() => root.render(<ContextSurface open title="Empty" onClose={() => {}} />));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    act(() => root.render(
      <ContextSurface open title="" onClose={() => {}}><p>Unscoped content</p></ContextSurface>
    ));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test("opens with arrival context and closes on Escape with focus restored", () => {
    act(() => root.render(<SurfaceHarness />));
    const trigger = container.querySelector("button");
    trigger.focus();
    act(() => trigger.click());

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Guest count increased to 135.");
    expect(dialog.textContent).toContain("One additional server protects the service ratio.");
    expect(container.querySelector('[aria-label="Close context"]').dataset.ambientActionId)
      .toBe("dismiss-staffing-context");
    expect(document.activeElement.textContent).toBe("Keep current staffing");

    act(() => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("contains keyboard focus and exposes desktop and mobile class hooks", () => {
    act(() => root.render(<SurfaceHarness />));
    act(() => container.querySelector("button").click());
    const surface = container.querySelector(".ambient-context-surface");
    expect(surface.classList.contains("ambient-context-surface--desktop-anchored")).toBe(true);
    expect(surface.classList.contains("ambient-context-surface--mobile-sheet")).toBe(true);

    const dialogButtons = Array.from(surface.querySelectorAll("button"));
    const first = dialogButtons[0];
    const last = dialogButtons[dialogButtons.length - 1];
    last.focus();
    act(() => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(first);

    first.focus();
    act(() => document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true
    })));
    expect(document.activeElement).toBe(last);
  });

  test("keeps an anchored desktop inspector inside the visible viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 768 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    let anchorRect = { top: 650, right: 744, bottom: 694, left: 700, width: 44, height: 44 };
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.matches?.("button")) {
        return anchorRect;
      }
      if (this.matches?.(".ambient-context-surface__dialog")) {
        return { top: 0, right: 0, bottom: 620, left: 0, width: 432, height: 620 };
      }
      return originalRect.call(this);
    };

    try {
      act(() => root.render(<AnchoredSurfaceHarness align="start" />));
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog.style.getPropertyValue("--ambient-context-anchor-top")).toBe("164px");
      expect(dialog.style.getPropertyValue("--ambient-context-anchor-left")).toBe("320px");

      anchorRect = { top: 650, right: 60, bottom: 694, left: 16, width: 44, height: 44 };
      act(() => root.render(<AnchoredSurfaceHarness align="end" />));
      expect(dialog.style.getPropertyValue("--ambient-context-anchor-right")).toBe("320px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});
