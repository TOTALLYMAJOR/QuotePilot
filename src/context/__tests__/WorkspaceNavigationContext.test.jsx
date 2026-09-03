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

  test("keeps a dirty draft guarded across a same-document stale-session Back entry", async () => {
    const windowObject = createStackWindow("/app/quotes");
    windowObject.history.replaceState({
      __quotepilotHistory: { sessionId: "qphs_stale_runtime", entryId: "qpe_stale_list", position: 4 }
    }, "", "/app/quotes");
    windowObject.history.pushState({
      __quotepilotHistory: { sessionId: "qphs_stale_runtime", entryId: "qpe_stale_detail", position: 5 }
    }, "", "/app/quotes/rivera");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let navigation;
    let continueTraversal;
    const guard = {
      open: true,
      requestDismiss: vi.fn((_reason, proceed) => {
        continueTraversal = proceed;
        return { status: "guarded" };
      })
    };

    await act(async () => {
      root.render(<WorkspaceNavigationProvider windowObject={windowObject} preserveSearch={false}>
        <InteractiveProbe onNavigation={(value) => { navigation = value; }} />
      </WorkspaceNavigationProvider>);
    });
    expect(windowObject.history.state.__quotepilotHistory).toMatchObject({ position: 5 });
    expect(windowObject.history.state.__quotepilotHistory.sessionId).not.toBe("qphs_stale_runtime");
    act(() => navigation.setHistoryTraversalGuard(guard, "quick-updates"));

    await act(async () => windowObject.history.back());
    expect(windowObject.location.pathname).toBe("/app/quotes/rivera");
    expect(guard.requestDismiss).toHaveBeenCalledWith("browser_back", expect.any(Function));

    await act(async () => continueTraversal());
    expect(windowObject.location.pathname).toBe("/app/quotes");

    await act(async () => root.unmount());
    container.remove();
  });

  test("guards ordinary workspace navigation before committing its preparation", async () => {
    const windowObject = createStackWindow("/app/catalog");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let navigation;
    let continueNavigation;
    const beforeNavigationCommit = vi.fn(() => ({ ok: true }));
    const guard = {
      open: true,
      requestDismiss: vi.fn((_reason, proceed) => {
        continueNavigation = proceed;
        return { status: "guarded" };
      })
    };

    await act(async () => {
      root.render(<WorkspaceNavigationProvider windowObject={windowObject} preserveSearch={false}>
        <InteractiveProbe onNavigation={(value) => { navigation = value; }} />
      </WorkspaceNavigationProvider>);
    });
    act(() => navigation.setHistoryTraversalGuard(guard, "library"));
    let result;
    act(() => {
      result = navigation.navigate("/app/customers", {
        preserveSearch: false,
        beforeNavigationCommit
      });
    });

    expect(result).toEqual({ status: "guarded" });
    expect(navigation.location.pathname).toBe("/app/catalog");
    expect(beforeNavigationCommit).not.toHaveBeenCalled();
    expect(guard.requestDismiss).toHaveBeenCalledWith("navigation", expect.any(Function));

    await act(async () => continueNavigation());
    expect(beforeNavigationCommit).toHaveBeenCalledOnce();
    expect(navigation.location.pathname).toBe("/app/customers");

    await act(async () => root.unmount());
    container.remove();
  });

  test("restores the prior owner guard after a temporary overlay guard closes", async () => {
    const windowObject = createStackWindow();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let navigation;
    const libraryGuard = {
      open: true,
      requestDismiss: vi.fn(() => ({ status: "guarded" }))
    };
    const overlayGuard = {
      open: true,
      requestDismiss: vi.fn(() => ({ status: "guarded" }))
    };
    const updatedLibraryGuard = {
      open: true,
      requestDismiss: vi.fn(() => ({ status: "guarded" }))
    };

    await act(async () => {
      root.render(<WorkspaceNavigationProvider windowObject={windowObject} preserveSearch={false}>
        <InteractiveProbe onNavigation={(value) => { navigation = value; }} />
      </WorkspaceNavigationProvider>);
    });
    await act(async () => navigation.navigate("/app/catalog", { preserveSearch: false }));
    await act(async () => navigation.navigate("/app/catalog", { preserveSearch: false }));
    act(() => navigation.setHistoryTraversalGuard(libraryGuard, "library"));
    act(() => navigation.setHistoryTraversalGuard(overlayGuard, "overlay"));

    await act(async () => windowObject.history.back());
    expect(overlayGuard.requestDismiss).toHaveBeenCalledOnce();
    expect(libraryGuard.requestDismiss).not.toHaveBeenCalled();

    act(() => navigation.setHistoryTraversalGuard(updatedLibraryGuard, "library"));
    await act(async () => windowObject.history.back());
    expect(overlayGuard.requestDismiss).toHaveBeenCalledTimes(2);
    expect(updatedLibraryGuard.requestDismiss).not.toHaveBeenCalled();

    act(() => navigation.setHistoryTraversalGuard(null, "overlay"));
    await act(async () => windowObject.history.back());
    expect(updatedLibraryGuard.requestDismiss).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  test("treats a guard that genuinely reopens as the newest active surface", async () => {
    const windowObject = createStackWindow("/app/catalog");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let navigation;
    const overlayGuard = {
      open: true,
      requestDismiss: vi.fn(() => ({ status: "guarded" }))
    };
    const libraryGuard = {
      open: true,
      requestDismiss: vi.fn(() => ({ status: "guarded" }))
    };

    await act(async () => {
      root.render(<WorkspaceNavigationProvider windowObject={windowObject} preserveSearch={false}>
        <InteractiveProbe onNavigation={(value) => { navigation = value; }} />
      </WorkspaceNavigationProvider>);
    });
    act(() => navigation.setHistoryTraversalGuard(overlayGuard, "overlay"));
    act(() => navigation.setHistoryTraversalGuard(libraryGuard, "library"));

    act(() => navigation.navigate("/app/customers", { preserveSearch: false }));
    expect(libraryGuard.requestDismiss).toHaveBeenCalledOnce();
    expect(overlayGuard.requestDismiss).not.toHaveBeenCalled();

    act(() => navigation.setHistoryTraversalGuard(null, "overlay"));
    await act(async () => Promise.resolve());
    act(() => navigation.setHistoryTraversalGuard(overlayGuard, "overlay"));
    act(() => navigation.navigate("/app/customers", { preserveSearch: false }));

    expect(overlayGuard.requestDismiss).toHaveBeenCalledOnce();
    expect(libraryGuard.requestDismiss).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  test("captures runtime-only view state and returns through the exact native history entry", async () => {
    const windowObject = createStackWindow("/app/quotes?status=draft");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let navigation;
    const restore = vi.fn();
    const capture = vi.fn(() => ({
      routeId: "quote-list",
      structured: { eventTypeFilter: "all", statusFilter: "draft" },
      transient: { query: "rivera@example.test" },
      disclosureIds: ["rivera-wedding"],
      scrollY: 640,
      focus: {
        kind: "opportunity-action",
        objectId: "rivera-wedding",
        actionId: "review-staffing:rivera-wedding"
      }
    }));

    await act(async () => {
      root.render(<WorkspaceNavigationProvider windowObject={windowObject} preserveSearch={false}>
        <InteractiveProbe onNavigation={(value) => { navigation = value; }} />
      </WorkspaceNavigationProvider>);
    });
    act(() => navigation.setReturnContextScope({
      organizationId: "org-rivera",
      principalId: "admin-1",
      role: "admin"
    }));
    let unregister;
    act(() => {
      unregister = navigation.registerReturnContextAdapter("quote-list", { capture, restore });
    });
    const originState = windowObject.history.state;

    await act(async () => navigation.navigate("/app/quotes/rivera-wedding", {
      preserveSearch: false,
      preserveReturnContext: true,
      returnContextSurfaceId: "living-opportunity",
      returnContextHint: { focus: { kind: "opportunity-action", objectId: "rivera-wedding" } },
      state: { ambientArrival: { exact: "rivera-wedding" } }
    }));

    expect(capture).toHaveBeenCalledWith({
      focus: { kind: "opportunity-action", objectId: "rivera-wedding" }
    });
    expect(windowObject.history.state.ambientArrival).toEqual({ exact: "rivera-wedding" });
    expect(windowObject.history.state.workspaceReturnContext).toMatchObject({
      modelId: "workspace-return-context-v1",
      organizationId: "org-rivera",
      origin: {
        entryId: originState.__quotepilotHistory.entryId,
        routeId: "quote-list",
        pathname: "/app/quotes",
        search: "?status=draft"
      },
      destination: {
        routeId: "quote-detail",
        pathname: "/app/quotes/rivera-wedding"
      }
    });
    expect(JSON.stringify(windowObject.history.state)).not.toContain("rivera@example.test");
    const historyLength = windowObject.history.length;
    const guardedReturn = {
      open: true,
      requestDismiss: vi.fn((_reason, proceed) => proceed())
    };
    act(() => navigation.setHistoryTraversalGuard(guardedReturn, "library-editor"));

    await act(async () => navigation.returnToOrigin({ fallback: "/app/quotes" }));
    expect(guardedReturn.requestDismiss).toHaveBeenCalledTimes(1);
    expect(guardedReturn.requestDismiss).toHaveBeenCalledWith("navigation", expect.any(Function));
    expect(windowObject.location.pathname).toBe("/app/quotes");
    expect(windowObject.history.length).toBe(historyLength);
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({
      transient: { query: "rivera@example.test" },
      scrollY: 640
    }));
    expect(navigation.returnContextStatus).toMatchObject({ state: "restored" });
    act(() => navigation.setHistoryTraversalGuard(null, "library-editor"));

    capture.mockReturnValue({
      routeId: "quote-list",
      structured: { eventTypeFilter: "all", statusFilter: "submitted" },
      transient: { query: "latest private search" },
      disclosureIds: ["updated-opportunity"],
      scrollY: 910,
      focus: {
        kind: "opportunity-action",
        objectId: "updated-opportunity",
        actionId: "review-pricing:updated-opportunity"
      }
    });

    await act(async () => windowObject.history.forward());
    expect(windowObject.location.pathname).toBe("/app/quotes/rivera-wedding");
    expect(windowObject.history.length).toBe(historyLength);
    await act(async () => windowObject.history.back());
    expect(restore).toHaveBeenLastCalledWith(expect.objectContaining({
      structured: expect.objectContaining({ statusFilter: "submitted" }),
      transient: { query: "latest private search" },
      scrollY: 910
    }));

    unregister();
    await act(async () => root.unmount());
    container.remove();
  });

  test("does not forge a second return origin when eligible navigations race before render", async () => {
    const windowObject = createStackWindow("/app/quotes");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let navigation;

    await act(async () => {
      root.render(<WorkspaceNavigationProvider windowObject={windowObject} preserveSearch={false}>
        <InteractiveProbe onNavigation={(value) => { navigation = value; }} />
      </WorkspaceNavigationProvider>);
    });
    act(() => navigation.setReturnContextScope({
      organizationId: "org-rivera",
      principalId: "admin-1",
      role: "admin"
    }));
    act(() => navigation.registerReturnContextAdapter("quote-list", {
      capture: () => ({
        routeId: "quote-list",
        focus: {
          kind: "opportunity-action",
          objectId: "quote-a",
          actionId: "review-quote:quote-a"
        }
      }),
      restore: vi.fn()
    }));

    act(() => {
      navigation.navigate("/app/quotes/quote-a", {
        preserveSearch: false,
        preserveReturnContext: true,
        returnContextSurfaceId: "living-opportunity"
      });
      navigation.navigate("/app/quotes/quote-b", {
        preserveSearch: false,
        preserveReturnContext: true,
        returnContextSurfaceId: "living-opportunity"
      });
    });

    expect(windowObject.location.pathname).toBe("/app/quotes/quote-b");
    expect(windowObject.history.state.workspaceReturnContext).toBeUndefined();
    await act(async () => windowObject.history.back());
    expect(windowObject.location.pathname).toBe("/app/quotes/quote-a");

    await act(async () => root.unmount());
    container.remove();
  });

  test("replaces with the canonical fallback when a return token is forged", async () => {
    const windowObject = createStackWindow("/app/customers?view=upcoming");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let navigation;

    await act(async () => {
      root.render(<WorkspaceNavigationProvider windowObject={windowObject} preserveSearch={false}>
        <InteractiveProbe onNavigation={(value) => { navigation = value; }} />
      </WorkspaceNavigationProvider>);
    });
    act(() => navigation.setReturnContextScope({
      organizationId: "org-rivera",
      principalId: "admin-1",
      role: "admin"
    }));
    const restoreFallback = vi.fn();
    act(() => navigation.registerReturnContextAdapter("customer-list", {
      capture: () => ({
        routeId: "customer-list",
        structured: { directoryFilter: "upcoming" },
        focus: { kind: "client-action", objectId: "client-rivera", actionId: "review-client:client-rivera" }
      }),
      restore: restoreFallback
    }));
    await act(async () => navigation.navigate("/app/customers/client-rivera", {
      preserveSearch: false,
      preserveReturnContext: true,
      returnContextSurfaceId: "client-overview"
    }));
    expect(windowObject.history.state.workspaceReturnContext).toBeDefined();
    const forged = {
      ...windowObject.history.state,
      workspaceReturnContext: {
        ...windowObject.history.state.workspaceReturnContext,
        organizationId: "foreign-org"
      }
    };
    await act(async () => navigation.replace("/app/customers/client-rivera", {
      preserveSearch: false,
      state: forged
    }));
    const historyLength = windowObject.history.length;
    const staleGuard = {
      open: true,
      requestDismiss: vi.fn(() => ({ status: "guarded" }))
    };
    act(() => navigation.setHistoryTraversalGuard(staleGuard, "library"));

    await act(async () => navigation.returnToOrigin({
      fallback: "/app/customers",
      skipHistoryGuard: true
    }));
    expect(windowObject.location.pathname).toBe("/app/customers");
    expect(windowObject.history.length).toBe(historyLength);
    expect(navigation.returnContextStatus).toMatchObject({
      state: "recovery",
      message: expect.stringContaining("previous place")
    });
    expect(staleGuard.requestDismiss).not.toHaveBeenCalled();
    expect(restoreFallback).toHaveBeenCalledWith(expect.objectContaining({
      routeId: "customer-list",
      focus: { kind: "route-heading" },
      scrollY: 0
    }));

    await act(async () => root.unmount());
    container.remove();
  });
});
