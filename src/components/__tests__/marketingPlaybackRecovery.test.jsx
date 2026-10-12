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
let intersectionObservers;

function matchMediaFor({ reducedMotion = false, phone = false } = {}) {
  return vi.fn((query) => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : phone,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }));
}

async function renderMarketingPage() {
  await act(async () => {
    root.render(<MarketingPage />);
  });
  return container.querySelector("video");
}

function filmButton(label) {
  return [...container.querySelectorAll("button")]
    .find((button) => button.textContent.trim() === label);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("media unavailable"));
  loadSpy = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  intersectionObservers = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      intersectionObservers.push(this);
    }
    observe(node) { this.observed.push(node); }
    unobserve() {}
    disconnect() {}
  });
  window.matchMedia = matchMediaFor();
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: { saveData: false }
  });
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
  test("keeps the cold homepage media-free until the visitor explicitly loads the film", async () => {
    const video = await renderMarketingPage();

    expect(video.getAttribute("preload")).toBe("none");
    expect(video.querySelector("source")).toBeNull();
    expect(playSpy).not.toHaveBeenCalled();
    expect(filmButton("Load and play full film")).toBeTruthy();
  });

  test("attaches the phone rendition only after an explicit phone-screen play request", async () => {
    window.matchMedia = matchMediaFor({ phone: true });
    playSpy.mockResolvedValue(undefined);
    const video = await renderMarketingPage();

    await act(async () => {
      filmButton("Load and play full film").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(video.querySelector("source")?.getAttribute("src"))
      .toBe("/videos/quote-pilot-commercial-phone.mp4");
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  test("evaluates reduced-motion and data-saving preferences before source attachment but permits an explicit override", async () => {
    window.matchMedia = matchMediaFor({ reducedMotion: true });
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true }
    });
    playSpy.mockResolvedValue(undefined);
    const video = await renderMarketingPage();

    expect(video.querySelector("source")).toBeNull();
    expect(container.querySelector('[data-media-preference="restricted"]')?.textContent)
      .toContain("loads only when you ask");

    await act(async () => {
      filmButton("Load and play full film").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(video.querySelector("source")?.getAttribute("src"))
      .toBe("/videos/quote-pilot-commercial.mp4");
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  test("pauses hidden and offscreen playback without changing the current position or auto-resuming", async () => {
    playSpy.mockResolvedValue(undefined);
    const video = await renderMarketingPage();

    await act(async () => {
      filmButton("Load and play full film").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      video.dispatchEvent(new Event("play"));
    });
    video.currentTime = 12.5;

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(12.5);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(playSpy).toHaveBeenCalledTimes(1);

    const videoObserver = intersectionObservers.find((observer) => observer.observed.includes(video));
    expect(videoObserver).toBeTruthy();
    video.currentTime = 18.25;
    videoObserver.callback([{ target: video, isIntersecting: false, intersectionRatio: 0 }]);
    expect(pauseSpy).toHaveBeenCalledTimes(2);
    expect(video.currentTime).toBe(18.25);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  test("responds when reduced-motion preference changes during playback", async () => {
    let prefersReducedMotion = false;
    const listeners = new Set();
    const reducedMotionQuery = {
      get matches() { return prefersReducedMotion; },
      media: "(prefers-reduced-motion: reduce)",
      addEventListener(type, listener) {
        if (type === "change") listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === "change") listeners.delete(listener);
      },
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); }
    };
    window.matchMedia = vi.fn((query) => (
      query.includes("prefers-reduced-motion")
        ? reducedMotionQuery
        : matchMediaFor()(query)
    ));
    playSpy.mockResolvedValue(undefined);
    const video = await renderMarketingPage();

    await act(async () => {
      filmButton("Load and play full film").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      video.dispatchEvent(new Event("play"));
    });

    prefersReducedMotion = true;
    await act(async () => {
      listeners.forEach((listener) => listener({ matches: true }));
    });

    expect(pauseSpy).toHaveBeenCalled();
    expect(container.querySelector('[data-media-preference="restricted"]')?.textContent)
      .toContain("loads only when you ask");
    expect(container.querySelector(".qp-landing")?.getAttribute("data-motion-override")).toBe("true");
  });

  test("turns a rejected play attempt into a visible retry path", async () => {
    await renderMarketingPage();
    const playButton = filmButton("Load and play full film");

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

    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.qp-landing-film-recovery[role="alert"]')?.textContent)
      .toContain("still unavailable");
  });
});
