// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import QuoteWorkspaceActivityDrawer from "../QuoteWorkspaceActivityDrawer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = Object.freeze({
  open: true,
  quoteNumber: "Q-1042",
  quoteStatus: "Draft",
  lastSavedLabel: "Aug 16, 10:30 AM",
  source: "Tenant quote history",
  activityItems: [
    { id: "saved", label: "Saved quote loaded", actor: "QuotePilot", time: "Aug 16, 10:30 AM" }
  ],
  checks: [
    { complete: true, message: "Customer needs attention" },
    { complete: false, message: "Menu needs attention" }
  ]
});

function buttonNamed(name) {
  return Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent.trim() === name || button.getAttribute("aria-label") === name);
}

describe("QuoteWorkspaceActivityDrawer", () => {
  let container;
  let root;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
    window.cancelAnimationFrame = (frameId) => window.clearTimeout(frameId);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container.remove();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    document.body.style.overflow = "";
  });

  test("separates saved evidence, visible gaps, and authoritative save checks", () => {
    const onOpenEditor = vi.fn();
    const onRefresh = vi.fn();

    act(() => root.render(
      <QuoteWorkspaceActivityDrawer
        {...baseProps}
        onClose={vi.fn()}
        onOpenEditor={onOpenEditor}
        onRefresh={onRefresh}
      />
    ));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBe("qwad-title");
    expect(dialog.textContent).toContain("Saved version loaded");
    expect(dialog.textContent).toContain("Menu needs attention");
    expect(dialog.textContent).toContain("Final save checks still include server validation");
    expect(dialog.textContent).toContain("never saves, sends, or approves a quote");
    expect(dialog.textContent).toContain("Saved quote loaded");

    act(() => buttonNamed("Open quote editor").click());
    act(() => buttonNamed("Refresh saved data").click());
    expect(onOpenEditor).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  test("closes with Escape and restores the page scroll contract", () => {
    const onClose = vi.fn();
    act(() => root.render(
      <QuoteWorkspaceActivityDrawer
        {...baseProps}
        onClose={onClose}
        onOpenEditor={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));

    expect(document.body.style.overflow).toBe("hidden");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();

    act(() => root.unmount());
    root = null;
    expect(document.body.style.overflow).toBe("");
  });

  test("renders nothing when closed", () => {
    act(() => root.render(
      <QuoteWorkspaceActivityDrawer
        {...baseProps}
        open={false}
        onClose={vi.fn()}
        onOpenEditor={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
