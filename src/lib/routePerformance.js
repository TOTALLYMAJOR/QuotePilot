const ROUTE_IDS = Object.freeze({
  home: "now",
  now: "now",
  clients: "clients",
  customers: "clients",
  "customer-list": "clients",
  "customer-detail": "clients",
  inventory: "inventory",
  "quote-detail": "quote-review",
  "quote-review": "quote-review"
});

const STAGES = new Set(["route-start", "usable-core", "supplemental-complete"]);
const OUTCOMES = new Set(["ready", "partial", "error", "unavailable"]);
const MAX_BROWSER_ENTRIES = 100;
let navigationSequence = 0;
const activeNavigations = new Map();

function boundedNavigationId(value = "") {
  const source = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `n${(hash >>> 0).toString(36)}`;
}

function nextNavigationId(routeId) {
  navigationSequence += 1;
  const clock = typeof performance !== "undefined" && typeof performance.now === "function"
    ? Math.round(performance.now() * 1000)
    : Date.now();
  return boundedNavigationId(`${routeId}:${clock}:${navigationSequence}`);
}

function normalizedRouteId(routeId) {
  return ROUTE_IDS[String(routeId || "").trim()] || "";
}

function recordForBrowser(entry) {
  if (typeof window === "undefined") return;
  const current = Array.isArray(window.__QUOTE_PILOT_ROUTE_PERFORMANCE__)
    ? window.__QUOTE_PILOT_ROUTE_PERFORMANCE__
    : [];
  window.__QUOTE_PILOT_ROUTE_PERFORMANCE__ = [...current.slice(-(MAX_BROWSER_ENTRIES - 1)), entry];
}

export function routePerformanceSnapshot() {
  if (typeof window === "undefined" || !Array.isArray(window.__QUOTE_PILOT_ROUTE_PERFORMANCE__)) return [];
  return window.__QUOTE_PILOT_ROUTE_PERFORMANCE__.map((entry) => ({ ...entry }));
}

export function markRouteStage({ routeId, navigationId = "", stage, outcome = "ready" } = {}) {
  const route = normalizedRouteId(routeId);
  const normalizedStage = String(stage || "").trim();
  const normalizedOutcome = String(outcome || "").trim();
  if (!route || !STAGES.has(normalizedStage) || !OUTCOMES.has(normalizedOutcome)) return null;

  const activeNavigationId = activeNavigations.get(route) || "";
  const opaqueNavigationId = navigationId
    ? (/^n[0-9a-z]+$/.test(String(navigationId)) ? String(navigationId) : boundedNavigationId(navigationId))
    : activeNavigationId || nextNavigationId(route);
  const markName = `quotepilot:${route}:${normalizedStage}:${normalizedOutcome}`;
  const navigationMarkName = `quotepilot:navigation:${opaqueNavigationId}:${normalizedStage}`;
  const detail = Object.freeze({
    routeId: route,
    navigationId: opaqueNavigationId,
    stage: normalizedStage,
    outcome: normalizedOutcome
  });

  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    performance.mark(markName, { detail });
    performance.mark(navigationMarkName, { detail });
    if (normalizedStage !== "route-start" && typeof performance.measure === "function") {
      try {
        performance.measure(
          `quotepilot:${route}:route-start-to-${normalizedStage}:${normalizedOutcome}`,
          {
            start: `quotepilot:navigation:${opaqueNavigationId}:route-start`,
            end: navigationMarkName,
            detail
          }
        );
      } catch {
        // A stage can settle after a superseded navigation. Keep the stage mark,
        // but never invent a duration without its matching route start.
      }
    }
  }

  const entry = { ...detail, recordedAt: Date.now() };
  recordForBrowser(entry);
  return entry;
}

export function beginRouteMeasurement(routeId) {
  const route = normalizedRouteId(routeId);
  if (!route) return null;
  const navigationId = nextNavigationId(route);
  activeNavigations.set(route, navigationId);
  return markRouteStage({ routeId: route, navigationId, stage: "route-start", outcome: "ready" });
}

export function routePerformanceId(routeId) {
  return normalizedRouteId(routeId);
}
