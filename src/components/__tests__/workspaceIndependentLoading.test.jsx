// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import NowView from "../NowView";
import LegacyNowView from "../LegacyNowView";
import CommandCenterHome from "../CommandCenterHome";
import LegacyCommandCenterHome from "../LegacyCommandCenterHome";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe.each([["Now", NowView], ["legacy Now", LegacyNowView], ["Command Center", CommandCenterHome], ["legacy Command Center", LegacyCommandCenterHome]])("%s independent loading", (_name, Surface) => {
  let root, container;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  test("offers history recovery without claiming empty payments while attention is pending", () => {
    const refresh = vi.fn();
    act(() => root.render(<Surface onRefresh={refresh} snapshot={{
      loading: true, error: "History failed", quotes: [], attentionSummary: { items: [] },
      reads: { history: { status: "error", error: "History failed" }, attention: { status: "loading" } }
    }} />));
    expect(container.textContent).not.toContain("No accepted or booked events");
    expect(container.textContent).not.toContain("No payments awaiting action");
    expect(container.textContent).toContain("Events and payment steps are unavailable");
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry events and payments");
    expect(retry.disabled).toBe(false);
    act(() => retry.click());
    expect(refresh).toHaveBeenCalledWith({ force: true, read: "history" });
  });

  test("keeps the pending money section explicitly loading", () => {
    act(() => root.render(<Surface snapshot={{
      loading: true, quotes: [], attentionSummary: { items: [] },
      reads: { history: { status: "loading" }, attention: { status: "success" } }
    }} />));
    expect(container.textContent).toContain("Loading payment steps");
    expect(container.textContent).not.toContain("No payments awaiting action");
  });
});
