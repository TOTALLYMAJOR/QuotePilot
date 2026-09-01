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

function AnchoredSurfaceHarness() {
  const anchorRef = useRef(null);
  return (
    <>
      <button ref={anchorRef} type="button">Inspect impact</button>
      <ContextSurface
        open
        title="Guest count impact"
        anchorRef={anchorRef}
        onClose={() => {}}
      >
        <p>Dependency evidence</p>
      </ContextSurface>
    </>
  );
}

function ArrivalDisclosureHarness() {
  return (
    <ContextSurface
      open
      title="Proposal details"
      description="Thompson Wedding, Q-1042"
      reason="Proposal evidence stays separate."
      consequence="Trusted controls recheck authority."
      collapseArrivalDetails
      onClose={() => {}}
    >
      <p data-context-arrival-duplicate="reason">Proposal evidence stays separate.</p>
      <p>Current proposal state</p>
    </ContextSurface>
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
    const detailsRegion = container.querySelector('[role="region"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(detailsRegion?.getAttribute("aria-label")).toBe("Staffing impact details");
    expect(detailsRegion?.tabIndex).toBe(0);
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

  test("does not duplicate details in the named scroll region", () => {
    act(() => root.render(
      <ContextSurface open title="Proposal details" onClose={() => {}}>
        <p>Proposal evidence</p>
      </ContextSurface>
    ));

    expect(container.querySelector('[role="region"]')?.getAttribute("aria-label"))
      .toBe("Proposal details");
  });

  test("can demote repeated arrival explanation behind a native disclosure", () => {
    act(() => root.render(<ArrivalDisclosureHarness />));

    const surface = container.querySelector(".ambient-context-surface");
    const details = container.querySelector(".ambient-context-surface__arrival-details");
    expect(surface?.classList.contains("ambient-context-surface--arrival-disclosure")).toBe(true);
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Why this view");
    expect(details.textContent).toContain("Proposal evidence stays separate.");
    const dialog = container.querySelector('[role="dialog"]');
    const description = document.getElementById(dialog.getAttribute("aria-describedby"));
    expect(description?.querySelector(".ambient-context-surface__description")?.textContent)
      .toBe("Thompson Wedding, Q-1042");
    expect(container.querySelector('[data-context-arrival-duplicate="reason"]')).not.toBeNull();
  });

  test("keeps an anchored desktop inspector inside the visible viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(document.documentElement, "clientWidth");
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1265 });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.matches?.("button")) {
        return { top: 650, right: 300, bottom: 694, left: 150, width: 150, height: 44 };
      }
      if (this.matches?.(".ambient-context-surface__dialog")) {
        return { top: 0, right: 0, bottom: 620, left: 0, width: 432, height: 620 };
      }
      return originalRect.call(this);
    };

    try {
      act(() => root.render(<AnchoredSurfaceHarness />));
      expect(container.querySelector('[role="dialog"]').style.getPropertyValue("--ambient-context-anchor-top"))
        .toBe("164px");
      expect(container.querySelector('[role="dialog"]').style.getPropertyValue("--ambient-context-anchor-right"))
        .toBe("817px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      if (clientWidthDescriptor) {
        Object.defineProperty(document.documentElement, "clientWidth", clientWidthDescriptor);
      } else {
        delete document.documentElement.clientWidth;
      }
    }
  });
});
