import { describe, expect, test, vi } from "vitest";
import {
  BROWSER_LOCATION_CHANGE_EVENT,
  buildBrowserNavigationTarget,
  navigateBrowser,
  readBrowserLocation,
  subscribeToBrowserLocation
} from "../useBrowserLocation";

function createFakeWindow(initialPath = "/app?filter=open#today") {
  const origin = "https://quotepilot.test";
  const listeners = new Map();
  const location = { origin, pathname: "/", search: "", hash: "" };
  const applyPath = (path) => {
    const url = new URL(path, origin);
    location.pathname = url.pathname;
    location.search = url.search;
    location.hash = url.hash;
  };
  applyPath(initialPath);

  const windowObject = {
    Event: class FakeEvent {
      constructor(type) { this.type = type; }
    },
    location,
    history: {
      state: null,
      pushState: vi.fn((state, _title, path) => {
        windowObject.history.state = state;
        applyPath(path);
      }),
      replaceState: vi.fn((state, _title, path) => {
        windowObject.history.state = state;
        applyPath(path);
      })
    },
    addEventListener(type, listener) {
      const callbacks = listeners.get(type) || new Set();
      callbacks.add(listener);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    }
  };
  return windowObject;
}

describe("History API workspace navigation", () => {
  test("preserves the current query on path navigation and can intentionally clear it", () => {
    const current = { pathname: "/app", search: "?portal=token-1&filter=open", hash: "#today" };
    expect(buildBrowserNavigationTarget("/app/quotes", current))
      .toBe("/app/quotes?portal=token-1&filter=open");
    expect(buildBrowserNavigationTarget("/app/quotes", current, { preserveSearch: false }))
      .toBe("/app/quotes");
    expect(buildBrowserNavigationTarget("/app/quotes?", current))
      .toBe("/app/quotes");
  });

  test("merges explicit query values while retaining unrelated current values", () => {
    const current = { pathname: "/app", search: "?portal=token-1&quoteId=old" };
    expect(buildBrowserNavigationTarget("/app/workflow?quoteId=q-2&requestId=r-1", current))
      .toBe("/app/workflow?portal=token-1&quoteId=q-2&requestId=r-1");
  });

  test("rejects cross-origin destinations before invoking browser history", () => {
    expect(() => buildBrowserNavigationTarget(
      "https://example.test/private",
      { pathname: "/app" },
      { origin: "https://quotepilot.test" }
    )).toThrow(/current origin/i);
  });

  test("publishes pushState and replaceState changes to subscribers", () => {
    const windowObject = createFakeWindow();
    const listener = vi.fn();
    const unsubscribe = subscribeToBrowserLocation(windowObject, listener);

    expect(navigateBrowser("/app/quotes", { windowObject, state: { source: "nav" } }))
      .toBe("/app/quotes?filter=open");
    expect(windowObject.history.pushState).toHaveBeenCalledWith(
      { source: "nav" },
      "",
      "/app/quotes?filter=open"
    );
    expect(listener).toHaveBeenCalledOnce();
    expect(readBrowserLocation(windowObject)).toMatchObject({
      pathname: "/app/quotes",
      search: "?filter=open",
      hash: "",
      state: { source: "nav" }
    });

    navigateBrowser("/app", { windowObject, replace: true, preserveSearch: false });
    expect(windowObject.history.replaceState).toHaveBeenCalledWith(null, "", "/app");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    windowObject.dispatchEvent(new windowObject.Event(BROWSER_LOCATION_CHANGE_EVENT));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("subscribers receive Back/Forward popstate location changes", () => {
    const windowObject = createFakeWindow("/app/quotes");
    const listener = vi.fn();
    subscribeToBrowserLocation(windowObject, listener);

    windowObject.location.pathname = "/app/customers";
    windowObject.dispatchEvent(new windowObject.Event("popstate"));

    expect(listener).toHaveBeenCalledOnce();
    expect(readBrowserLocation(windowObject).pathname).toBe("/app/customers");
  });
});
