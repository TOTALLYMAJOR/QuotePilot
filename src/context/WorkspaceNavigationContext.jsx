import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  buildBrowserNavigationTarget,
  ensureBrowserHistoryEntry,
  navigateBasicBrowser,
  navigateBrowser,
  readBrowserHistoryEntry,
  readBrowserLocation,
  traverseBrowserHistory,
  useBasicBrowserLocation,
  useBrowserLocation
} from "../hooks/useBrowserLocation";
import {
  getWorkspaceReturnContextStore,
  readWorkspaceReturnContextToken,
  withWorkspaceReturnContextState
} from "../lib/workspaceReturnContext";
import { parseWorkspaceLocation } from "../lib/workspaceRoutes";

const WorkspaceNavigationContext = createContext(null);

const CUSTOMER_CENTERED_FLAG = import.meta.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED;
const AMBIENT_UI_FLAG = import.meta.env.VITE_AMBIENT_UI_ENABLED;
const CUSTOMER_CENTERED_ENABLED = CUSTOMER_CENTERED_FLAG === "true"
  || CUSTOMER_CENTERED_FLAG === "1"
  || CUSTOMER_CENTERED_FLAG === "yes"
  || CUSTOMER_CENTERED_FLAG === "on";
const AMBIENT_UI_ENABLED = AMBIENT_UI_FLAG === "true"
  || AMBIENT_UI_FLAG === "1"
  || AMBIENT_UI_FLAG === "yes"
  || AMBIENT_UI_FLAG === "on";
const HISTORY_TRAVERSAL_GUARD_ENABLED = (
  CUSTOMER_CENTERED_ENABLED && AMBIENT_UI_ENABLED
);

function defaultWindow() {
  return typeof window === "undefined" ? null : window;
}

function routeLocation(route, location) {
  return {
    routeId: String(route?.routeId || ""),
    pathname: String(location?.pathname || route?.pathname || "/"),
    search: String(location?.search || "")
  };
}

function targetRouteLocation(target, windowObject) {
  const url = new URL(target, windowObject?.location?.origin || "http://quotepilot.local");
  const parsed = parseWorkspaceLocation({
    pathname: url.pathname,
    search: url.search,
    hash: url.hash
  });
  return routeLocation(parsed, url);
}

function createWorkspaceNavigationProvider(useLocation, navigateLocation) {
  return function WorkspaceNavigationProvider({
    children,
    windowObject = defaultWindow(),
    preserveSearch = true,
    canonicalizeLegacyHome = true
  }) {
    const historyTraversalGuardRef = useRef(null);
    const historyTraversalAuthorizationRef = useRef(null);
    const historyTraversalCaptureRef = useRef(null);
    const historyTraversalGuardsRef = useRef(new Map());
    const historyTraversalGuardOrderRef = useRef(new Map());
    const historyTraversalGuardGenerationRef = useRef(new Map());
    const nextHistoryTraversalGuardOrderRef = useRef(0);
    const returnContextAdaptersRef = useRef(new Map());
    const restoredReturnEntryRef = useRef("");
    const completedReturnEntryRef = useRef("");
    const pendingRecoveryFocusRef = useRef(null);
    const returnContextStoreRef = useRef(getWorkspaceReturnContextStore(windowObject));
    const scrollRestorationRef = useRef({ active: false, previous: null });
    const [returnContextEpoch, setReturnContextEpoch] = useState(0);
    const [returnContextStatus, setReturnContextStatus] = useState(null);
    const location = useLocation(windowObject, {
      historyTraversalGuardRef,
      historyTraversalAuthorizationRef,
      historyTraversalCaptureRef
    });
    const route = useMemo(
      () => parseWorkspaceLocation(location),
      [location.hash, location.pathname, location.search]
    );

    const enableManualScrollRestoration = useCallback(() => {
      const browserHistory = windowObject?.history;
      if (!browserHistory || !("scrollRestoration" in browserHistory)) return;
      if (!scrollRestorationRef.current.active) {
        scrollRestorationRef.current = {
          active: true,
          previous: browserHistory.scrollRestoration
        };
      }
      browserHistory.scrollRestoration = "manual";
    }, [windowObject]);

    const restoreBrowserScrollRestoration = useCallback(() => {
      const browserHistory = windowObject?.history;
      const state = scrollRestorationRef.current;
      if (!state.active || !browserHistory || !("scrollRestoration" in browserHistory)) return;
      browserHistory.scrollRestoration = state.previous || "auto";
      scrollRestorationRef.current = { active: false, previous: null };
    }, [windowObject]);

    const createHref = useCallback((destination, options = {}) => (
      buildBrowserNavigationTarget(destination, location, {
        preserveSearch: options.preserveSearch ?? preserveSearch,
        preserveHash: options.preserveHash ?? false,
        origin: windowObject?.location?.origin || "http://quotepilot.local"
      })
    ), [location, preserveSearch, windowObject]);

    const navigate = useCallback((destination, options = {}) => {
      const {
        preserveReturnContext = false,
        returnContextSurfaceId = "",
        returnContextHint = null,
        returnContextDestination = null,
        beforeNavigationCommit = null,
        historyGuardReason = "navigation",
        skipHistoryGuard = false,
        ...browserOptions
      } = options;
      const target = buildBrowserNavigationTarget(destination, location, {
        preserveSearch: browserOptions.preserveSearch ?? preserveSearch,
        preserveHash: browserOptions.preserveHash ?? false,
        origin: windowObject?.location?.origin || "http://quotepilot.local"
      });
      const commitNavigation = () => {
        const preparation = typeof beforeNavigationCommit === "function"
          ? beforeNavigationCommit()
          : null;
        if (preparation?.ok === false) return preparation;
        let prepared = null;
        if (preserveReturnContext && !browserOptions.replace) {
          const liveLocation = readBrowserLocation(windowObject);
          const liveRoute = parseWorkspaceLocation(liveLocation);
          const adapter = returnContextAdaptersRef.current.get(liveRoute.routeId);
          const entry = ensureBrowserHistoryEntry(windowObject);
          const view = typeof adapter?.capture === "function"
            ? adapter.capture(returnContextHint)
            : null;
          prepared = returnContextStoreRef.current.prepare({
            entry,
            origin: routeLocation(liveRoute, liveLocation),
            destination: targetRouteLocation(target, windowObject),
            surfaceId: returnContextSurfaceId,
            view,
            destinationView: returnContextDestination
          });
        }
        const state = prepared?.ok
          ? withWorkspaceReturnContextState(browserOptions.state, prepared.token)
          : browserOptions.state ?? null;
        if (prepared?.ok) enableManualScrollRestoration();
        const navigatedTarget = navigateLocation(destination, {
          windowObject,
          replace: Boolean(browserOptions.replace),
          state,
          preserveSearch: browserOptions.preserveSearch ?? preserveSearch,
          preserveHash: browserOptions.preserveHash ?? false
        });
        if (prepared?.ok) {
          const committed = returnContextStoreRef.current.commit({
            token: prepared.token,
            destinationEntry: readBrowserHistoryEntry(windowObject)
          });
          if (committed.ok) setReturnContextEpoch((value) => value + 1);
        }
        return navigatedTarget;
      };
      const guard = historyTraversalGuardRef.current;
      if (
        !browserOptions.replace
        && !skipHistoryGuard
        && guard?.open
        && typeof guard.requestDismiss === "function"
      ) {
        return guard.requestDismiss(historyGuardReason, commitNavigation);
      }
      return commitNavigation();
    }, [
      enableManualScrollRestoration,
      location,
      navigateLocation,
      preserveSearch,
      route,
      windowObject
    ]);

    const replace = useCallback((destination, options = {}) => (
      navigate(destination, { ...options, replace: true })
    ), [navigate]);

    const setHistoryTraversalGuard = useCallback((guard = null, ownerId = "default") => {
      const owner = String(ownerId || "default").trim() || "default";
      const generation = (historyTraversalGuardGenerationRef.current.get(owner) || 0) + 1;
      historyTraversalGuardGenerationRef.current.set(owner, generation);
      if (!historyTraversalGuardOrderRef.current.has(owner)) {
        nextHistoryTraversalGuardOrderRef.current += 1;
        historyTraversalGuardOrderRef.current.set(owner, nextHistoryTraversalGuardOrderRef.current);
      }
      if (guard?.open === true && typeof guard.requestDismiss === "function") {
        historyTraversalGuardsRef.current.set(owner, {
          guard,
          order: historyTraversalGuardOrderRef.current.get(owner)
        });
      } else {
        historyTraversalGuardsRef.current.delete(owner);
        Promise.resolve().then(() => {
          if (
            historyTraversalGuardGenerationRef.current.get(owner) === generation
            && !historyTraversalGuardsRef.current.has(owner)
          ) {
            historyTraversalGuardOrderRef.current.delete(owner);
          }
        });
      }
      const activeGuards = Array.from(historyTraversalGuardsRef.current.values())
        .sort((left, right) => left.order - right.order)
        .reverse()
        .map((entry) => entry.guard);
      historyTraversalGuardRef.current = activeGuards.length
        ? {
            open: true,
            requestDismiss(reason, continuation) {
              const requestAt = (index) => {
                const candidate = activeGuards[index];
                if (!candidate) return continuation?.();
                if (!candidate.open || typeof candidate.requestDismiss !== "function") {
                  return requestAt(index + 1);
                }
                let continued = false;
                let continuationResult;
                const proceed = () => {
                  continued = true;
                  continuationResult = requestAt(index + 1);
                  return continuationResult;
                };
                const result = candidate.requestDismiss(reason, proceed);
                return continued && continuationResult !== undefined
                  ? continuationResult
                  : result;
              };
              return requestAt(0);
            }
          }
        : null;
    }, []);

    const setReturnContextScope = useCallback((scope = null) => {
      const result = returnContextStoreRef.current.setScope(scope);
      if (result.changed) {
        restoredReturnEntryRef.current = "";
        completedReturnEntryRef.current = "";
        historyTraversalCaptureRef.current = null;
        pendingRecoveryFocusRef.current = null;
        restoreBrowserScrollRestoration();
        setReturnContextStatus(null);
        setReturnContextEpoch((value) => value + 1);
      }
      return result;
    }, [restoreBrowserScrollRestoration]);

    const installHistoryTraversalCapture = useCallback((restorationKey, routeId, adapter) => {
      if (
        completedReturnEntryRef.current !== restorationKey
        || typeof adapter?.capture !== "function"
      ) return;
      const captureCurrentView = () => {
        const entry = readBrowserHistoryEntry(windowObject);
        const currentAdapter = returnContextAdaptersRef.current.get(routeId);
        if (!entry || currentAdapter !== adapter) return { ok: false, reason: "unavailable" };
        return returnContextStoreRef.current.updateOriginView({
          entry,
          routeId,
          view: adapter.capture({ reason: "history-traversal" })
        });
      };
      captureCurrentView.adapter = adapter;
      historyTraversalCaptureRef.current = captureCurrentView;
    }, [windowObject]);

    const restoreCurrentReturnContext = useCallback(() => {
      const entry = location.historyEntry || readBrowserHistoryEntry(windowObject);
      if (!entry) return { status: "unavailable" };
      const restorationKey = `${entry.sessionId}:${entry.entryId}:${route.routeId}`;
      if (restoredReturnEntryRef.current === restorationKey) return { status: "already-restored" };
      const restored = returnContextStoreRef.current.readOriginView({
        entry,
        routeId: route.routeId
      });
      const adapter = returnContextAdaptersRef.current.get(route.routeId);
      if (!restored.ok || typeof adapter?.restore !== "function") return { status: "unavailable" };
      restoredReturnEntryRef.current = restorationKey;
      setReturnContextStatus({
        state: "restoring",
        key: restorationKey,
        entryId: entry.entryId,
        message: ""
      });
      const complete = (outcome = null) => {
        if (restoredReturnEntryRef.current !== restorationKey) {
          return { status: "cancelled" };
        }
        if (outcome?.status === "cancelled") return { status: "cancelled" };
        const exact = !outcome || outcome.status === "restored";
        if (exact) {
          completedReturnEntryRef.current = restorationKey;
          const currentAdapter = returnContextAdaptersRef.current.get(route.routeId);
          installHistoryTraversalCapture(restorationKey, route.routeId, currentAdapter);
        }
        setReturnContextStatus({
          state: exact ? "restored" : "recovery",
          key: restorationKey,
          entryId: entry.entryId,
          message: exact
            ? "Returned to your previous place."
            : "Your exact previous control is no longer available. This view is open instead."
        });
        return { status: exact ? "restored" : "recovery", view: restored.view };
      };
      try {
        const outcome = adapter.restore(restored.view);
        if (outcome && typeof outcome.then === "function") {
          void outcome.then(complete, () => complete({ status: "recovery" }));
          return { status: "restoring", view: restored.view };
        }
        return complete(outcome);
      } catch {
        return complete({ status: "recovery" });
      }
    }, [installHistoryTraversalCapture, location.historyEntry, route.routeId, windowObject]);

    const registerReturnContextAdapter = useCallback((routeId, adapter) => {
      const normalizedRouteId = String(routeId || "").trim();
      if (!normalizedRouteId || typeof adapter?.capture !== "function" || typeof adapter?.restore !== "function") {
        return () => {};
      }
      let scheduledFrame;
      returnContextAdaptersRef.current.set(normalizedRouteId, adapter);
      const currentEntry = location.historyEntry || readBrowserHistoryEntry(windowObject);
      const restorationKey = currentEntry
        ? `${currentEntry.sessionId}:${currentEntry.entryId}:${normalizedRouteId}`
        : "";
      installHistoryTraversalCapture(restorationKey, normalizedRouteId, adapter);
      if (normalizedRouteId === route.routeId) {
        const restoreRegisteredRoute = () => {
          const pendingRecovery = pendingRecoveryFocusRef.current;
          if (pendingRecovery?.routeId === normalizedRouteId) {
            pendingRecoveryFocusRef.current = null;
            try {
              adapter.restore({
                routeId: normalizedRouteId,
                structured: {},
                transient: {},
                disclosureIds: [],
                scrollY: 0,
                focus: { kind: "route-heading" }
              });
            } catch {
              // The visible recovery notice remains authoritative if the
              // canonical heading disappears during the route transition.
            }
            return;
          }
          restoreCurrentReturnContext();
        };
        if (typeof windowObject?.requestAnimationFrame === "function") {
          scheduledFrame = windowObject.requestAnimationFrame(() => {
            scheduledFrame = undefined;
            restoreRegisteredRoute();
          });
        } else {
          restoreRegisteredRoute();
        }
      }
      return () => {
        if (scheduledFrame !== undefined) {
          windowObject?.cancelAnimationFrame?.(scheduledFrame);
        }
        if (returnContextAdaptersRef.current.get(normalizedRouteId) === adapter) {
          returnContextAdaptersRef.current.delete(normalizedRouteId);
        }
        if (historyTraversalCaptureRef.current?.adapter === adapter) {
          historyTraversalCaptureRef.current = null;
        }
      };
    }, [
      installHistoryTraversalCapture,
      location.historyEntry,
      restoreCurrentReturnContext,
      route.routeId,
      windowObject
    ]);

    const returnToOrigin = useCallback(({
      fallback = "/app",
      fallbackState = null,
      targetRouteId = "",
      skipHistoryGuard = false
    } = {}) => {
      const entry = location.historyEntry || readBrowserHistoryEntry(windowObject);
      const resolved = returnContextStoreRef.current.resolveOrigin({
        entry,
        state: location.state,
        route: routeLocation(route, location),
        targetRouteId
      });
      if (resolved.ok) {
        const commitTraversal = () => {
          historyTraversalAuthorizationRef.current = {
            sourceEntryId: entry.entryId,
            sessionId: entry.sessionId,
            targetPosition: entry.position + resolved.delta
          };
          if (traverseBrowserHistory(resolved.delta, { windowObject })) {
            return { status: "traversing", routeId: resolved.routeId };
          }
          historyTraversalAuthorizationRef.current = null;
          return { status: "unavailable", reason: "history_unavailable" };
        };
        const guard = historyTraversalGuardRef.current;
        if (!skipHistoryGuard && guard?.open && typeof guard.requestDismiss === "function") {
          return guard.requestDismiss("navigation", commitTraversal);
        }
        const traversal = commitTraversal();
        if (traversal.status === "traversing") return traversal;
      }

      const commitFallback = () => {
        const fallbackRoute = targetRouteLocation(fallback, windowObject);
        pendingRecoveryFocusRef.current = { routeId: fallbackRoute.routeId };
        navigateLocation(fallback, {
          windowObject,
          replace: true,
          state: fallbackState,
          preserveSearch: false,
          preserveHash: false
        });
        const fallbackEntry = readBrowserHistoryEntry(windowObject);
        const fallbackAdapter = returnContextAdaptersRef.current.get(fallbackRoute.routeId);
        if (typeof fallbackAdapter?.restore === "function") {
          const restoreFallback = () => {
            if (pendingRecoveryFocusRef.current?.routeId !== fallbackRoute.routeId) return;
            pendingRecoveryFocusRef.current = null;
            try {
              fallbackAdapter.restore({
                routeId: fallbackRoute.routeId,
                structured: {},
                transient: {},
                disclosureIds: [],
                scrollY: 0,
                focus: { kind: "route-heading" }
              });
            } catch {
              // Recovery remains visible even if the canonical focus target
              // leaves before this frame.
            }
          };
          if (typeof windowObject?.requestAnimationFrame === "function") {
            windowObject.requestAnimationFrame(restoreFallback);
          } else {
            restoreFallback();
          }
        }
        setReturnContextStatus({
          state: "recovery",
          key: `${Date.now()}:${String(fallback)}`,
          entryId: fallbackEntry?.entryId || "",
          message: "Your previous place is no longer available. The current list is open instead."
        });
        return { status: "fallback", reason: resolved.reason || "origin_unavailable" };
      };
      const guard = historyTraversalGuardRef.current;
      if (!skipHistoryGuard && guard?.open && typeof guard.requestDismiss === "function") {
        return guard.requestDismiss("navigation", commitFallback);
      }
      return commitFallback();
    }, [location, navigateLocation, route, windowObject]);

    useEffect(() => {
      if (
        canonicalizeLegacyHome
        && route.surface === "workspace"
        && route.redirectTo
        && route.redirectTo !== route.pathname
      ) {
        replace(route.redirectTo, { preserveSearch: true, preserveHash: true });
      }
    }, [canonicalizeLegacyHome, replace, route.pathname, route.redirectTo, route.surface]);

    useLayoutEffect(() => {
      restoredReturnEntryRef.current = "";
      completedReturnEntryRef.current = "";
      historyTraversalCaptureRef.current = null;
      setReturnContextStatus((current) => (
        current?.entryId === location.historyEntry?.entryId ? current : null
      ));
      const frame = typeof windowObject?.requestAnimationFrame === "function"
        ? windowObject.requestAnimationFrame(() => restoreCurrentReturnContext())
        : undefined;
      if (frame === undefined) restoreCurrentReturnContext();
      return () => {
        if (frame !== undefined) windowObject?.cancelAnimationFrame?.(frame);
      };
    }, [location.historyEntry?.entryId, restoreCurrentReturnContext, route.routeId, windowObject]);

    useEffect(() => {
      if (
        returnContextStatus?.state !== "recovery"
        && returnContextStoreRef.current.hasTrackedEntry(location.historyEntry)
      ) {
        enableManualScrollRestoration();
      } else {
        restoreBrowserScrollRestoration();
      }
    }, [
      enableManualScrollRestoration,
      location.historyEntry,
      restoreBrowserScrollRestoration,
      returnContextStatus?.state
    ]);

    useEffect(() => () => {
      restoreBrowserScrollRestoration();
    }, [restoreBrowserScrollRestoration]);

    const returnContextDestination = useMemo(() => {
      void returnContextEpoch;
      const token = readWorkspaceReturnContextToken(location.state);
      if (!token) return null;
      const result = returnContextStoreRef.current.readDestination({
        entry: location.historyEntry || readBrowserHistoryEntry(windowObject),
        state: location.state,
        route: routeLocation(route, location)
      });
      return result.ok ? result.destination : null;
    }, [location, returnContextEpoch, route, windowObject]);

    const value = useMemo(() => ({
      location,
      route,
      createHref,
      navigate,
      replace,
      setHistoryTraversalGuard,
      setReturnContextScope,
      registerReturnContextAdapter,
      returnToOrigin,
      returnContextDestination,
      returnContextStatus
    }), [
      createHref,
      location,
      navigate,
      registerReturnContextAdapter,
      replace,
      returnContextDestination,
      returnContextStatus,
      returnToOrigin,
      route,
      setHistoryTraversalGuard,
      setReturnContextScope
    ]);

    return (
      <WorkspaceNavigationContext.Provider value={value}>
        {children}
      </WorkspaceNavigationContext.Provider>
    );
  };
}

export const WorkspaceNavigationProvider = createWorkspaceNavigationProvider(
  HISTORY_TRAVERSAL_GUARD_ENABLED ? useBrowserLocation : useBasicBrowserLocation,
  HISTORY_TRAVERSAL_GUARD_ENABLED ? navigateBrowser : navigateBasicBrowser
);

export const GuardedWorkspaceNavigationProvider = createWorkspaceNavigationProvider(
  useBrowserLocation,
  navigateBrowser
);

export function useWorkspaceNavigation() {
  const context = useContext(WorkspaceNavigationContext);
  if (!context) {
    throw new Error("useWorkspaceNavigation must be used within WorkspaceNavigationProvider.");
  }
  return context;
}

export function useOptionalWorkspaceNavigation() {
  return useContext(WorkspaceNavigationContext);
}

export function useWorkspaceReturnContextAdapter({
  routeId,
  active = true,
  capture,
  restore
}) {
  const context = useContext(WorkspaceNavigationContext);
  const registerReturnContextAdapter = context?.registerReturnContextAdapter;
  useEffect(() => {
    if (!active || typeof registerReturnContextAdapter !== "function") return undefined;
    return registerReturnContextAdapter(routeId, { capture, restore });
  }, [active, capture, registerReturnContextAdapter, restore, routeId]);
  return {
    destination: context?.returnContextDestination || null,
    status: context?.returnContextStatus || null
  };
}
