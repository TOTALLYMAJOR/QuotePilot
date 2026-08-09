import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo
} from "react";
import {
  buildBrowserNavigationTarget,
  navigateBrowser,
  useBrowserLocation
} from "../hooks/useBrowserLocation";
import { parseWorkspaceLocation } from "../lib/workspaceRoutes";

const WorkspaceNavigationContext = createContext(null);

function defaultWindow() {
  return typeof window === "undefined" ? null : window;
}

export function WorkspaceNavigationProvider({
  children,
  windowObject = defaultWindow(),
  preserveSearch = true,
  canonicalizeLegacyHome = true
}) {
  const location = useBrowserLocation(windowObject);
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
    navigateBrowser(destination, {
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
    replace
  }), [createHref, location, navigate, replace, route]);

  return (
    <WorkspaceNavigationContext.Provider value={value}>
      {children}
    </WorkspaceNavigationContext.Provider>
  );
}

export function useWorkspaceNavigation() {
  const context = useContext(WorkspaceNavigationContext);
  if (!context) {
    throw new Error("useWorkspaceNavigation must be used within WorkspaceNavigationProvider.");
  }
  return context;
}
