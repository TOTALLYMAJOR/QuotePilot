import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef
} from "react";
import {
  buildBrowserNavigationTarget,
  navigateBasicBrowser,
  navigateBrowser,
  useBasicBrowserLocation,
  useBrowserLocation
} from "../hooks/useBrowserLocation";
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

function createWorkspaceNavigationProvider(useLocation, navigateLocation) {
  return function WorkspaceNavigationProvider({
    children,
    windowObject = defaultWindow(),
    preserveSearch = true,
    canonicalizeLegacyHome = true
  }) {
    const historyTraversalGuardRef = useRef(null);
    const location = useLocation(windowObject, { historyTraversalGuardRef });
    const route = useMemo(
      () => parseWorkspaceLocation(location),
      [location.hash, location.pathname, location.search]
    );

    const createHref = useCallback((destination, options = {}) => (
      buildBrowserNavigationTarget(destination, location, {
        preserveSearch: options.preserveSearch ?? preserveSearch,
        preserveHash: options.preserveHash ?? false,
        origin: windowObject?.location?.origin || "http://quotepilot.local"
      })
    ), [location, preserveSearch, windowObject]);

    const navigate = useCallback((destination, options = {}) => (
      navigateLocation(destination, {
        windowObject,
        replace: Boolean(options.replace),
        state: options.state ?? null,
        preserveSearch: options.preserveSearch ?? preserveSearch,
        preserveHash: options.preserveHash ?? false
      })
    ), [preserveSearch, windowObject]);

    const replace = useCallback((destination, options = {}) => (
      navigate(destination, { ...options, replace: true })
    ), [navigate]);

    const setHistoryTraversalGuard = useCallback((guard = null) => {
      historyTraversalGuardRef.current = guard?.open === true
        && typeof guard.requestDismiss === "function"
        ? guard
        : null;
    }, []);

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

    const value = useMemo(() => ({
      location,
      route,
      createHref,
      navigate,
      replace,
      setHistoryTraversalGuard
    }), [createHref, location, navigate, replace, route, setHistoryTraversalGuard]);

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
