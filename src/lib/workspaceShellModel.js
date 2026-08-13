import { WORKSPACE_ROUTE_IDS } from "./workspaceRoutes";

// id, route id, tenant feature, admin-only. An empty tenant feature implies
// admin-only for the legacy catalog/import tools.
const TOOLS = Object.freeze([
  ["staff", WORKSPACE_ROUTE_IDS.STAFF, "staffDirectory", true],
  ["schedule", WORKSPACE_ROUTE_IDS.SCHEDULE, "eventSchedule"],
  ["reporting", WORKSPACE_ROUTE_IDS.REPORTING, "reportingDashboard"],
  ["catalog", WORKSPACE_ROUTE_IDS.CATALOG, ""],
  ["imports", WORKSPACE_ROUTE_IDS.IMPORTS, ""],
  ["integrations", WORKSPACE_ROUTE_IDS.INTEGRATIONS, "integrationsOps"],
  ["diagnostics", WORKSPACE_ROUTE_IDS.DIAGNOSTICS, "diagnostics"]
]);

export const WORKSPACE_SHELL_TOOL_IDS = Object.freeze(TOOLS.map(([id]) => id));

function toolAuthorized(feature, adminOnly, features, admin) {
  const featureAllowed = feature ? features[feature] === true : true;
  const roleAllowed = adminOnly === true || !feature ? admin : true;
  return featureAllowed && roleAllowed;
}

const HISTORY = [WORKSPACE_ROUTE_IDS.QUOTE_LIST, WORKSPACE_ROUTE_IDS.QUOTE_DETAIL];
const BUILDERS = [WORKSPACE_ROUTE_IDS.QUOTE_NEW, WORKSPACE_ROUTE_IDS.QUOTE_EDIT];
const LEGACY_GAPS = [
  WORKSPACE_ROUTE_IDS.STAFF,
  WORKSPACE_ROUTE_IDS.CUSTOMER_LIST,
  WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL,
  WORKSPACE_ROUTE_IDS.MESSAGING
];
const SURFACES = Object.freeze({
  [WORKSPACE_ROUTE_IDS.CUSTOMER_LIST]: "customer-directory",
  [WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL]: "customer-360",
  [WORKSPACE_ROUTE_IDS.QUOTE_LIST]: "quotes",
  [WORKSPACE_ROUTE_IDS.QUOTE_DETAIL]: "quotes",
  [WORKSPACE_ROUTE_IDS.QUOTE_NEW]: "quote-builder",
  [WORKSPACE_ROUTE_IDS.QUOTE_EDIT]: "quote-builder",
  [WORKSPACE_ROUTE_IDS.MESSAGING]: "messages"
});

function deepFreeze(value) {
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === "object" && !Object.isFrozen(entry)) deepFreeze(entry);
  });
  return Object.freeze(value);
}

function sectionFor(routeId) {
  if (routeId.startsWith("customer-")) return "customers";
  if (routeId.startsWith("quote-")) return "quotes";
  return routeId;
}

/**
 * Immutable, presentation-only projection of App.jsx's staff-shell routes.
 * Authentication, Firebase, providers, persistence, and mutations stay with
 * the caller; this function receives only already-resolved role and UI gates.
 */
export function buildWorkspaceShellModel({
  route = {},
  customerCenteredWorkspaceEnabled = false,
  pilotNowEnabled = false,
  isAdmin = false,
  featureFlags = {},
  transientTools = {}
} = {}) {
  const requestedRouteId = route?.routeId;
  const browserRouteId = Object.values(WORKSPACE_ROUTE_IDS).includes(requestedRouteId)
    ? requestedRouteId
    : WORKSPACE_ROUTE_IDS.NOT_FOUND;
  const workspace = customerCenteredWorkspaceEnabled === true;
  const admin = isAdmin === true;
  const portal = browserRouteId === WORKSPACE_ROUTE_IDS.PORTAL;
  const resolvedRouteId = !portal && !workspace && browserRouteId === WORKSPACE_ROUTE_IDS.HOME
    ? WORKSPACE_ROUTE_IDS.QUOTE_NEW
    : browserRouteId;
  const features = Object.fromEntries(
    TOOLS.filter(([, , feature]) => feature)
      .map(([, , feature]) => [feature, featureFlags?.[feature] !== false])
  );
  const selectedTool = TOOLS.find(([, routeId]) => routeId === resolvedRouteId);
  const routedTool = selectedTool?.[0] || "";
  const routedToolAuthorized = Boolean(selectedTool)
    && toolAuthorized(selectedTool[2], selectedTool[3], features, admin);

  let notFoundReason = "";
  if (!portal) {
    if (browserRouteId === WORKSPACE_ROUTE_IDS.OUTSIDE) notFoundReason = "outside-workspace";
    else if (browserRouteId === WORKSPACE_ROUTE_IDS.NOT_FOUND) notFoundReason = "unknown-route";
    else if (!workspace && LEGACY_GAPS.includes(resolvedRouteId)) notFoundReason = "legacy-unavailable";
    else if (selectedTool && !routedToolAuthorized) {
      notFoundReason = selectedTool[2] && features[selectedTool[2]] !== true
        ? "feature-disabled"
        : "role-denied";
    }
  }
  const showNotFound = Boolean(notFoundReason);
  const routedTools = {};
  const modalTools = {};
  TOOLS.forEach(([id, routeId, feature, adminOnly]) => {
    const authorized = toolAuthorized(feature, adminOnly, features, admin);
    const selected = !portal && routeId === resolvedRouteId;
    const routeOpen = workspace && selected;
    const modalOpen = transientTools?.[id] === true || (!workspace && selected);
    routedTools[id] = {
      open: routeOpen,
      authorized,
      visible: routeOpen && authorized,
      presentation: "embedded"
    };
    modalTools[id] = {
      open: modalOpen,
      authorized,
      visible: !portal && modalOpen && authorized,
      presentation: "modal"
    };
  });

  const history = !portal && HISTORY.includes(resolvedRouteId);
  const workflow = !portal && resolvedRouteId === WORKSPACE_ROUTE_IDS.WORKFLOW;
  const quoteBuilder = !portal && BUILDERS.includes(resolvedRouteId);
  const presentation = workspace ? "embedded" : "modal";
  let primary;
  if (portal) primary = { id: "customer-portal", presentation: "portal" };
  else if (showNotFound) primary = { id: "workspace-not-found", presentation: "not-found" };
  else if (resolvedRouteId === WORKSPACE_ROUTE_IDS.HOME) {
    primary = { id: pilotNowEnabled === true ? "now" : "command-center", presentation: "embedded" };
  } else {
    primary = {
      id: routedTool || SURFACES[resolvedRouteId] || resolvedRouteId || "workspace-not-found",
      presentation: routedTool || history || workflow ? presentation : "embedded"
    };
  }

  return deepFreeze({
    mode: portal ? "portal" : workspace ? "workspace" : "legacy",
    browserRouteId,
    resolvedRouteId,
    activeSection: quoteBuilder ? "quotes" : sectionFor(resolvedRouteId),
    portal,
    routeAuthorized: portal || !showNotFound,
    routedTool,
    routedToolAuthorized,
    showNotFound,
    notFoundReason,
    primary: { ...primary, routeId: resolvedRouteId },
    featureFlags: features,
    active: {
      home: !portal && workspace && resolvedRouteId === WORKSPACE_ROUTE_IDS.HOME,
      history,
      messaging: !portal && workspace && resolvedRouteId === WORKSPACE_ROUTE_IDS.MESSAGING,
      workflow,
      quoteBuilder,
      routedTools,
      modalTools
    },
    presentation: { history: presentation, workflow: presentation }
  });
}
