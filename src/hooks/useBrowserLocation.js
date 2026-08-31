import { useEffect, useRef, useState } from "react";

export const BROWSER_LOCATION_CHANGE_EVENT = "quotepilot:locationchange";
export const BROWSER_HISTORY_STATE_KEY = "__quotepilotHistory";

const historyRuntimeByWindow = new WeakMap();

function defaultWindow() {
  return typeof window === "undefined" ? null : window;
}

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function randomHistoryId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid.replaceAll("-", "").toLowerCase()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function historyRuntime(windowObject) {
  if (!windowObject || (typeof windowObject !== "object" && typeof windowObject !== "function")) {
    return null;
  }
  let runtime = historyRuntimeByWindow.get(windowObject);
  if (!runtime) {
    runtime = { sessionId: randomHistoryId("qphs") };
    historyRuntimeByWindow.set(windowObject, runtime);
  }
  return runtime;
}

function normalizeHistoryEntry(value) {
  if (!record(value)) return null;
  const sessionId = String(value.sessionId || "").trim();
  const entryId = String(value.entryId || "").trim();
  const position = Number(value.position);
  if (!sessionId || !entryId || !Number.isSafeInteger(position)) return null;
  return Object.freeze({ sessionId, position, entryId });
}

export function readBrowserHistoryEntry(windowObject = defaultWindow()) {
  return normalizeHistoryEntry(windowObject?.history?.state?.[BROWSER_HISTORY_STATE_KEY]);
}

function stateWithHistoryEntry(state, entry) {
  const applicationState = record(state) ? { ...state } : {};
  delete applicationState[BROWSER_HISTORY_STATE_KEY];
  return {
    ...applicationState,
    [BROWSER_HISTORY_STATE_KEY]: entry
  };
}

function currentBrowserTarget(windowObject) {
  const location = windowObject?.location;
  return `${String(location?.pathname || "/")}${normalizeSearch(location?.search)}${normalizeHash(location?.hash)}`;
}

export function ensureBrowserHistoryEntry(windowObject = defaultWindow()) {
  if (!windowObject?.history || typeof windowObject.history.replaceState !== "function") return null;
  const runtime = historyRuntime(windowObject);
  const current = readBrowserHistoryEntry(windowObject);
  if (current?.sessionId === runtime.sessionId) return current;
  const entry = Object.freeze({
    sessionId: runtime.sessionId,
    position: 0,
    entryId: randomHistoryId("qpe")
  });
  windowObject.history.replaceState(
    stateWithHistoryEntry(windowObject.history.state, entry),
    "",
    currentBrowserTarget(windowObject)
  );
  return entry;
}

function stateWithoutHistoryEntry(state) {
  if (!record(state)) return state ?? null;
  const applicationState = { ...state };
  delete applicationState[BROWSER_HISTORY_STATE_KEY];
  return Object.keys(applicationState).length ? applicationState : null;
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
  const rawState = windowObject?.history?.state ?? null;
  return Object.freeze({
    pathname: String(browserLocation?.pathname || "/"),
    search: normalizeSearch(browserLocation?.search),
    hash: normalizeHash(browserLocation?.hash),
    state: stateWithoutHistoryEntry(rawState),
    historyEntry: normalizeHistoryEntry(rawState?.[BROWSER_HISTORY_STATE_KEY]),
    historyStateToken: rawState
  });
}

export function readBasicBrowserLocation(windowObject = defaultWindow()) {
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
  const currentEntry = ensureBrowserHistoryEntry(windowObject);
  const runtime = historyRuntime(windowObject);
  const entry = replace
    ? Object.freeze({
        sessionId: runtime.sessionId,
        position: currentEntry?.position ?? 0,
        entryId: currentEntry?.entryId || randomHistoryId("qpe")
      })
    : Object.freeze({
        sessionId: runtime.sessionId,
        position: (currentEntry?.position ?? 0) + 1,
        entryId: randomHistoryId("qpe")
      });
  windowObject.history[method](stateWithHistoryEntry(state, entry), "", target);
  notifyBrowserLocationChange(windowObject);
  return target;
}

export function navigateBasicBrowser(destination, {
  windowObject = defaultWindow(),
  replace = false,
  state = null,
  preserveSearch = true,
  preserveHash = false
} = {}) {
  if (!windowObject?.history || !windowObject?.location) {
    throw new Error("Browser navigation is unavailable.");
  }

  const target = buildBrowserNavigationTarget(destination, readBasicBrowserLocation(windowObject), {
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
    && left.historyStateToken === right.historyStateToken;
}

export function useBasicBrowserLocation(windowObject = defaultWindow()) {
  const [location, setLocation] = useState(() => readBasicBrowserLocation(windowObject));

  useEffect(() => {
    const updateLocation = () => {
      const nextLocation = readBasicBrowserLocation(windowObject);
      setLocation((currentLocation) => (
        currentLocation.pathname === nextLocation.pathname
          && currentLocation.search === nextLocation.search
          && currentLocation.hash === nextLocation.hash
          && currentLocation.state === nextLocation.state
          ? currentLocation
          : nextLocation
      ));
    };
    updateLocation();
    return subscribeToBrowserLocation(windowObject, updateLocation);
  }, [windowObject]);

  return location;
}

export function useBrowserLocation(windowObject = defaultWindow(), {
  historyTraversalGuardRef = null
} = {}) {
  const [location, setLocation] = useState(() => readBrowserLocation(windowObject));
  const acceptedLocationRef = useRef(location);
  const traversalRef = useRef({ phase: "idle" });

  useEffect(() => {
    let active = true;
    const acceptLocation = (nextLocation) => {
      acceptedLocationRef.current = nextLocation;
      traversalRef.current = { phase: "idle" };
      setLocation((currentLocation) => (
        locationsMatch(currentLocation, nextLocation) ? currentLocation : nextLocation
      ));
    };
    const replayTraversal = (attempt) => {
      if (!active || attempt.replayed) return;
      attempt.replayed = true;
      traversalRef.current = { phase: "replaying", attempt };
      windowObject.history.go(attempt.delta);
    };
    const completeRestoration = (attempt) => {
      traversalRef.current = { phase: "idle" };
      const guard = historyTraversalGuardRef?.current;
      if (!guard?.open || typeof guard.requestDismiss !== "function") {
        replayTraversal(attempt);
        return;
      }
      const reason = attempt.delta < 0 ? "browser_back" : "browser_forward";
      const result = guard.requestDismiss(reason, () => replayTraversal(attempt));
      if (result?.status === "dismissed" && !attempt.replayed) replayTraversal(attempt);
    };
    const updateLocation = (event = null) => {
      const nextLocation = readBrowserLocation(windowObject);
      if (event?.type !== "popstate") {
        acceptLocation(nextLocation);
        return;
      }

      const traversal = traversalRef.current;
      const acceptedEntry = acceptedLocationRef.current?.historyEntry || null;
      const nextEntry = nextLocation.historyEntry || null;

      if (traversal.phase === "replaying") {
        acceptLocation(nextLocation);
        return;
      }
      if (traversal.phase === "restoring") {
        if (
          acceptedEntry
          && nextEntry
          && acceptedEntry.sessionId === nextEntry.sessionId
          && acceptedEntry.position === nextEntry.position
        ) {
          completeRestoration(traversal.attempt);
          return;
        }
        if (
          acceptedEntry
          && nextEntry
          && acceptedEntry.sessionId === nextEntry.sessionId
          && typeof windowObject.history.go === "function"
        ) {
          windowObject.history.go(acceptedEntry.position - nextEntry.position);
          return;
        }
        acceptLocation(nextLocation);
        return;
      }

      const guard = historyTraversalGuardRef?.current;
      const canRestore = Boolean(
        guard?.open
        && typeof guard.requestDismiss === "function"
        && acceptedEntry
        && nextEntry
        && acceptedEntry.sessionId === nextEntry.sessionId
        && acceptedEntry.position !== nextEntry.position
        && typeof windowObject.history.go === "function"
      );
      if (!canRestore) {
        acceptLocation(nextLocation);
        return;
      }
      const attempt = {
        delta: nextEntry.position - acceptedEntry.position,
        replayed: false,
        targetEntryId: nextEntry.entryId
      };
      traversalRef.current = { phase: "restoring", attempt };
      windowObject.history.go(-attempt.delta);
    };
    ensureBrowserHistoryEntry(windowObject);
    acceptLocation(readBrowserLocation(windowObject));
    const unsubscribe = subscribeToBrowserLocation(windowObject, updateLocation);
    return () => {
      active = false;
      traversalRef.current = { phase: "idle" };
      unsubscribe();
    };
  }, [historyTraversalGuardRef, windowObject]);

  return location;
}
