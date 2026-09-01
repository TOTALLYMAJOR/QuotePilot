// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  GuardedWorkspaceNavigationProvider as WorkspaceNavigationProvider,
  useWorkspaceNavigation,
} from "../WorkspaceNavigationContext";

function Probe() {
  const navigation = useWorkspaceNavigation();
  return (
    <output
      data-route={navigation.route.routeId}
      data-customer={navigation.route.params?.customerId || ""}
      data-href={navigation.createHref("/app/quotes")}
    />
  );
}

function InteractiveProbe({ onNavigation }) {
  const navigation = useWorkspaceNavigation();
  onNavigation(navigation);
  return <output data-route={navigation.route.routeId}>{navigation.location.pathname}</output>;
}

function createStackWindow(initialPath = "/app") {
  const origin = "https://quotepilot.test";
  const listeners = new Map();
  const location = { origin, pathname: "/", search: "", hash: "" };
  const entries = [];
  let index = 0;

  const applyPath = (path) => {
    const url = new URL(path, origin);
    location.pathname = url.pathname;
    location.search = url.search;
    location.hash = url.hash;
  };
  const dispatch = (type) => {
    const event = new windowObject.Event(type);
    for (const listener of listeners.get(type) || []) listener(event);
  };
  const initialUrl = new URL(initialPath, origin);
  entries.push({
    path: `${initialUrl.pathname}${initialUrl.search}${initialUrl.hash}`,
    state: null
  });
  applyPath(entries[0].path);

  const history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState: vi.fn((state, _title, path) => {
      entries.splice(index + 1);
      entries.push({ path, state });
      index = entries.length - 1;
      applyPath(path);
    }),
    replaceState: vi.fn((state, _title, path) => {
      entries[index] = { path, state };
      applyPath(path);
    }),
    go: vi.fn((delta) => {
      const target = index + Number(delta || 0);
      if (target < 0 || target >= entries.length || target === index) return;
      index = target;
      applyPath(entries[index].path);
      dispatch("popstate");
    }),
    back() { history.go(-1); },
    forward() { history.go(1); }
  };
  const windowObject = {
    Event: class FakeEvent {
      constructor(type) { this.type = type; }
    },
    location,
    history,
    addEventListener(type, listener) {
      const callbacks = listeners.get(type) || new Set();
      callbacks.add(listener);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      dispatch(event.type);
      return true;
    }
  };
  return windowObject;
}

describe("WorkspaceNavigationProvider", () => {
  test("provides the parsed route and query-preserving href without an auth or organization key", () => {
    const windowObject = {
      location: {
        origin: "https://quotepilot.test",
        pathname: "/app/customers/customer-1",
        search: "?view=compact",
        hash: ""
      },
      history: { state: null }
    };

    const html = renderToStaticMarkup(
      <WorkspaceNavigationProvider windowObject={windowObject}>
        <Probe />
      </WorkspaceNavigationProvider>
    );

    expect(html).toContain('data-route="customer-detail"');
    expect(html).toContain('data-customer="customer-1"');
    expect(html).toContain('data-href="/app/quotes?view=compact"');
  });

  test("restores a dirty Back attempt and replays the exact history entry only after discard", async () => {
    const windowObject = createStackWindow();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let navigation;
    let continuation = null;
    const guard = {
      open: true,
      requestDismiss: vi.fn((_reason, proceed) => {
        continuation = proceed;
        return { status: "guarded" };
      })
    };

    await act(async () => {
      root.render(<WorkspaceNavigationProvider windowObject={windowObject} preserveSearch={false}>
        <InteractiveProbe onNavigation={(value) => { navigation = value; }} />
      </WorkspaceNavigationProvider>);
    });
    await act(async () => navigation.navigate("/app/quotes", {
      preserveSearch: false,
      state: { screen: "index", scrollTop: 320 }
    }));
    await act(async () => navigation.navigate("/app/quotes/rivera", {
      preserveSearch: false,
      state: { ambientArrival: { surfaceId: "living-opportunity", quoteId: "rivera" } }
    }));
    const historyLength = windowObject.history.length;
    act(() => navigation.setHistoryTraversalGuard(guard));

    await act(async () => windowObject.history.back());
    expect(windowObject.location.pathname).toBe("/app/quotes/rivera");
    expect(navigation.location.pathname).toBe("/app/quotes/rivera");
    expect(guard.requestDismiss).toHaveBeenCalledWith("browser_back", expect.any(Function));
    expect(windowObject.history.length).toBe(historyLength);

    // Keep editing does not invoke the one-shot continuation.
    continuation = null;
    await act(async () => windowObject.history.back());
    expect(windowObject.location.pathname).toBe("/app/quotes/rivera");
    expect(guard.requestDismiss).toHaveBeenCalledTimes(2);
    expect(continuation).toEqual(expect.any(Function));

    await act(async () => continuation());
    expect(windowObject.location.pathname).toBe("/app/quotes");
    expect(navigation.location.pathname).toBe("/app/quotes");
    expect(navigation.location.state).toMatchObject({ screen: "index", scrollTop: 320 });
    expect(windowObject.history.length).toBe(historyLength);

    act(() => navigation.setHistoryTraversalGuard(null));
    await act(async () => windowObject.history.forward());
    expect(navigation.location.pathname).toBe("/app/quotes/rivera");
    expect(navigation.location.state.ambientArrival).toEqual({
      surfaceId: "living-opportunity",
      quoteId: "rivera"
    });

    await act(async () => root.unmount());
    container.remove();
  });

  test("replays clean traversal immediately and blocks traversal while a save is busy", async () => {
    const windowObject = createStackWindow();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let navigation;

    await act(async () => {
      root.render(<WorkspaceNavigationProvider windowObject={windowObject} preserveSearch={false}>
        <InteractiveProbe onNavigation={(value) => { navigation = value; }} />
      </WorkspaceNavigationProvider>);
    });
    await act(async () => navigation.navigate("/app/quotes", { preserveSearch: false }));
    await act(async () => navigation.navigate("/app/quotes/rivera", { preserveSearch: false }));

    const cleanGuard = {
      open: true,
      requestDismiss: vi.fn((_reason, proceed) => {
        proceed();
        return { status: "dismissed" };
      })
    };
    act(() => navigation.setHistoryTraversalGuard(cleanGuard));
    await act(async () => windowObject.history.back());
    expect(navigation.location.pathname).toBe("/app/quotes");
    expect(cleanGuard.requestDismiss).toHaveBeenCalledOnce();

    await act(async () => windowObject.history.forward());
    const busyGuard = {
      open: true,
      requestDismiss: vi.fn(() => ({ status: "blocked", reason: "busy" }))
    };
    act(() => navigation.setHistoryTraversalGuard(busyGuard));
    await act(async () => windowObject.history.back());
    expect(windowObject.location.pathname).toBe("/app/quotes/rivera");
    expect(navigation.location.pathname).toBe("/app/quotes/rivera");
    expect(busyGuard.requestDismiss).toHaveBeenCalledWith("browser_back", expect.any(Function));

    await act(async () => root.unmount());
    container.remove();
  });
});
