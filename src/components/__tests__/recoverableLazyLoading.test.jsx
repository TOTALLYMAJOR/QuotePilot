// @vitest-environment jsdom
import React, { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { createRecoverableLazy, RecoverableErrorBoundary } from "../RecoverableErrorBoundary";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("recovers a failed named-export import without replacing a sibling component", async () => {
  let fail = true;
  const Step = createRecoverableLazy(async () => {
    if (fail) throw new Error("Loading chunk failed");
    return { StepMenu: () => <p>Menu ready</p> };
  }, "StepMenu", (module) => ({ default: module.StepMenu }));
  const Sibling = createRecoverableLazy(async () => ({ default: () => <p>Draft retained</p> }), "Sibling");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => root.render(<RecoverableErrorBoundary surfaceKind="route" surfaceName="Quote builder" onRetry={() => { Step.retry(); Sibling.retry(); }}>
      <Suspense fallback={<p>Loading</p>}><Step /><Sibling /></Suspense>
    </RecoverableErrorBoundary>));
    expect(host.textContent).toContain("Quote builder did not load");
    fail = false;
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again").click());
    expect(host.textContent).toContain("Menu ready");
    expect(host.textContent).toContain("Draft retained");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    log.mockRestore();
  }
});
