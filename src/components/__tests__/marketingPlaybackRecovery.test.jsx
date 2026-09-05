// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import MarketingPage from "../MarketingPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let playSpy;
let loadSpy;
let pauseSpy;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("media unavailable"));
  loadSpy = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  window.matchMedia = vi.fn(() => ({ matches: true, addListener() {}, removeListener() {} }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  playSpy.mockRestore();
  loadSpy.mockRestore();
  pauseSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("marketing film recovery", () => {
  test("turns a rejected play attempt into a visible retry path", async () => {
    await act(async () => {
      root.render(<MarketingPage />);
    });
    const playButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Play film");

    await act(async () => {
      playButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const recovery = container.querySelector('.qp-landing-film-recovery[role="alert"]');
    expect(recovery?.textContent).toContain("could not start");
    expect(recovery?.textContent).toContain("Retry film");

    await act(async () => {
      recovery.querySelector("button").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.qp-landing-film-recovery[role="alert"]')?.textContent)
      .toContain("still unavailable");
  });
});
