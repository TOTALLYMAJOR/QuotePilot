import { useEffect, useState } from "react";

export const BROWSER_LOCATION_CHANGE_EVENT = "quotepilot:locationchange";

function defaultWindow() {
  return typeof window === "undefined" ? null : window;
}

function normalizeSearch(search) {
  if (!search) return "";
  const value = String(search);
  return value.startsWith("?") ? value : `?${value}`;
}

function normalizeHash(hash) {
  if (!hash) return "";
  const value = String(hash);
  return value.startsWith("#") ? value : `#${value}`;
}

export function readBrowserLocation(windowObject = defaultWindow()) {
  const browserLocation = windowObject?.location;
  return Object.freeze({
    pathname: String(browserLocation?.pathname || "/"),
    search: normalizeSearch(browserLocation?.search),
    hash: normalizeHash(browserLocation?.hash),
    state: windowObject?.history?.state ?? null
  });
}

export function subscribeToBrowserLocation(windowObject = defaultWindow(), listener) {
  if (!windowObject?.addEventListener || typeof listener !== "function") return () => {};
  windowObject.addEventListener("popstate", listener);
  windowObject.addEventListener(BROWSER_LOCATION_CHANGE_EVENT, listener);
  return () => {
    windowObject.removeEventListener("popstate", listener);
    windowObject.removeEventListener(BROWSER_LOCATION_CHANGE_EVENT, listener);
  };
}

export function notifyBrowserLocationChange(windowObject = defaultWindow()) {
  if (!windowObject?.dispatchEvent) return;
  const EventConstructor = windowObject.Event || globalThis.Event;
  const event = typeof EventConstructor === "function"
    ? new EventConstructor(BROWSER_LOCATION_CHANGE_EVENT)
    : { type: BROWSER_LOCATION_CHANGE_EVENT };
  windowObject.dispatchEvent(event);
}

function destinationHasExplicitSearch(destination) {
  return String(destination).split("#", 1)[0].includes("?");
}

function destinationHasExplicitHash(destination) {
  return String(destination).includes("#");
}

function mergeSearch(currentSearch, targetSearch) {
  const merged = new URLSearchParams(normalizeSearch(currentSearch).replace(/^\?/, ""));
  const target = new URLSearchParams(normalizeSearch(targetSearch).replace(/^\?/, ""));
  const replacedKeys = new Set(target.keys());
  replacedKeys.forEach((key) => merged.delete(key));
  target.forEach((value, key) => merged.append(key, value));
  const serialized = merged.toString();
  return serialized ? `?${serialized}` : "";
}

export function buildBrowserNavigationTarget(destination, currentLocation = {}, {
  preserveSearch = true,
  preserveHash = false,
  origin = "http://quotepilot.local"
} = {}) {
  if (typeof destination !== "string" || !destination.trim()) {
    throw new TypeError("Navigation destination must be a non-empty string.");
  }

  const currentPathname = String(currentLocation.pathname || "/");
  const currentSearch = normalizeSearch(currentLocation.search);
  const currentHash = normalizeHash(currentLocation.hash);
  const baseUrl = new URL(`${currentPathname}${currentSearch}${currentHash}`, origin);
  const targetUrl = new URL(destination, baseUrl);

  if (targetUrl.origin !== baseUrl.origin) {
    throw new TypeError("Workspace navigation must stay on the current origin.");
  }

  const hasExplicitSearch = destinationHasExplicitSearch(destination);
  if (preserveSearch) {
    targetUrl.search = hasExplicitSearch
      ? mergeSearch(currentSearch, targetUrl.search)
      : currentSearch;
  }
  if (hasExplicitSearch && String(destination).split("#", 1)[0].endsWith("?")) {
    targetUrl.search = "";
  }

  if (preserveHash && !destinationHasExplicitHash(destination)) {
    targetUrl.hash = currentHash;
  }

  return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}

export function navigateBrowser(destination, {
  windowObject = defaultWindow(),
  replace = false,
  state = null,
  preserveSearch = true,
  preserveHash = false
} = {}) {
  if (!windowObject?.history || !windowObject?.location) {
    throw new Error("Browser navigation is unavailable.");
  }

  const target = buildBrowserNavigationTarget(destination, readBrowserLocation(windowObject), {
    preserveSearch,
    preserveHash,
    origin: windowObject.location.origin || "http://quotepilot.local"
  });
  const method = replace ? "replaceState" : "pushState";
  if (typeof windowObject.history[method] !== "function") {
    throw new Error("Browser History API navigation is unavailable.");
  }
  windowObject.history[method](state, "", target);
  notifyBrowserLocationChange(windowObject);
  return target;
}

function locationsMatch(left, right) {
  return left.pathname === right.pathname
    && left.search === right.search
    && left.hash === right.hash
    && left.state === right.state;
}

export function useBrowserLocation(windowObject = defaultWindow()) {
  const [location, setLocation] = useState(() => readBrowserLocation(windowObject));

  useEffect(() => {
    const updateLocation = () => {
      const nextLocation = readBrowserLocation(windowObject);
      setLocation((currentLocation) => (
        locationsMatch(currentLocation, nextLocation) ? currentLocation : nextLocation
      ));
    };
    updateLocation();
    return subscribeToBrowserLocation(windowObject, updateLocation);
  }, [windowObject]);

  return location;
}
