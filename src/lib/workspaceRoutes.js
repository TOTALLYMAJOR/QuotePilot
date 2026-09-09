const WORKSPACE_ROOT = "/app";
const CLIENTS_ALIAS_PATH = `${WORKSPACE_ROOT}/clients`;

export const WORKSPACE_ROUTE_IDS = Object.freeze({
  HOME: "home",
  CLEAR_DECK: "clear-deck",
  CUSTOMER_LIST: "customer-list",
  CUSTOMER_DETAIL: "customer-detail",
  STAFF: "staff",
  QUOTE_LIST: "quote-list",
  QUOTE_NEW: "quote-new",
  QUOTE_DETAIL: "quote-detail",
  QUOTE_EDIT: "quote-edit",
  EVENT_LIST: "event-list",
  EVENT_DETAIL: "event-detail",
  EVENT_LIVE: "event-live",
  EVENT_REPLAY: "event-replay",
  MESSAGING: "messaging",
  WORKFLOW: "workflow",
  OPERATIONS: "operations",
  INVENTORY: "inventory",
  SCHEDULE: "schedule",
  REPORTING: "reporting",
  CATALOG: "catalog",
  IMPORTS: "imports",
  INTEGRATIONS: "integrations",
  DIAGNOSTICS: "diagnostics",
  NOT_FOUND: "not-found",
  OUTSIDE: "outside",
  PORTAL: "portal"
});

export const WORKSPACE_PATHS = Object.freeze({
  home: WORKSPACE_ROOT,
  clearDeck: `${WORKSPACE_ROOT}/clear-the-deck`,
  customers: `${WORKSPACE_ROOT}/customers`,
  staff: `${WORKSPACE_ROOT}/staff`,
  quotes: `${WORKSPACE_ROOT}/quotes`,
  quoteNew: `${WORKSPACE_ROOT}/quotes/new`,
  events: `${WORKSPACE_ROOT}/events`,
  messaging: `${WORKSPACE_ROOT}/messages`,
  workflow: `${WORKSPACE_ROOT}/workflow`,
  operations: `${WORKSPACE_ROOT}/operations`,
  inventory: `${WORKSPACE_ROOT}/inventory`,
  schedule: `${WORKSPACE_ROOT}/schedule`,
  reporting: `${WORKSPACE_ROOT}/reporting`,
  catalog: `${WORKSPACE_ROOT}/catalog`,
  imports: `${WORKSPACE_ROOT}/imports`,
  integrations: `${WORKSPACE_ROOT}/integrations`,
  diagnostics: `${WORKSPACE_ROOT}/diagnostics`
});

const ROUTE_META = Object.freeze({
  [WORKSPACE_ROUTE_IDS.HOME]: Object.freeze({ section: "home", delivery: "first-release" }),
  [WORKSPACE_ROUTE_IDS.CLEAR_DECK]: Object.freeze({ section: "clear-deck", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.CUSTOMER_LIST]: Object.freeze({ section: "customers", delivery: "first-release" }),
  [WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL]: Object.freeze({ section: "customers", delivery: "first-release" }),
  [WORKSPACE_ROUTE_IDS.STAFF]: Object.freeze({ section: "staff", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.QUOTE_LIST]: Object.freeze({ section: "quotes", delivery: "first-release" }),
  [WORKSPACE_ROUTE_IDS.QUOTE_NEW]: Object.freeze({ section: "quotes", delivery: "first-release" }),
  [WORKSPACE_ROUTE_IDS.QUOTE_DETAIL]: Object.freeze({ section: "quotes", delivery: "first-release" }),
  [WORKSPACE_ROUTE_IDS.QUOTE_EDIT]: Object.freeze({ section: "quotes", delivery: "first-release" }),
  [WORKSPACE_ROUTE_IDS.EVENT_LIST]: Object.freeze({ section: "events", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.EVENT_DETAIL]: Object.freeze({ section: "events", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.EVENT_LIVE]: Object.freeze({ section: "events", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.EVENT_REPLAY]: Object.freeze({ section: "events", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.MESSAGING]: Object.freeze({ section: "messaging", delivery: "first-release" }),
  [WORKSPACE_ROUTE_IDS.WORKFLOW]: Object.freeze({ section: "workflow", delivery: "first-release" }),
  [WORKSPACE_ROUTE_IDS.OPERATIONS]: Object.freeze({ section: "operations", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.INVENTORY]: Object.freeze({ section: "operations", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.SCHEDULE]: Object.freeze({ section: "schedule", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.REPORTING]: Object.freeze({ section: "reporting", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.CATALOG]: Object.freeze({ section: "catalog", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.IMPORTS]: Object.freeze({ section: "imports", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.INTEGRATIONS]: Object.freeze({ section: "integrations", delivery: "follow-on" }),
  [WORKSPACE_ROUTE_IDS.DIAGNOSTICS]: Object.freeze({ section: "diagnostics", delivery: "follow-on" })
});

export const PRIMARY_WORKSPACE_NAVIGATION = Object.freeze([
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.HOME, label: "Now", path: WORKSPACE_PATHS.home }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.CLEAR_DECK, label: "Clear the Deck", path: WORKSPACE_PATHS.clearDeck }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.CUSTOMER_LIST, label: "Customers", path: WORKSPACE_PATHS.customers }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.STAFF, label: "Staff", path: WORKSPACE_PATHS.staff }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.QUOTE_LIST, label: "Quotes", path: WORKSPACE_PATHS.quotes }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.EVENT_LIST, label: "Events", path: WORKSPACE_PATHS.events }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.MESSAGING, label: "Messages", path: WORKSPACE_PATHS.messaging }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.WORKFLOW, label: "Workflow", path: WORKSPACE_PATHS.workflow }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.OPERATIONS, label: "Operations", path: WORKSPACE_PATHS.operations }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.SCHEDULE, label: "Schedule", path: WORKSPACE_PATHS.schedule })
]);

export const ADMIN_WORKSPACE_NAVIGATION = Object.freeze([
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.REPORTING, label: "Reporting", path: WORKSPACE_PATHS.reporting }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.CATALOG, label: "Catalog", path: WORKSPACE_PATHS.catalog }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.IMPORTS, label: "Imports", path: WORKSPACE_PATHS.imports }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.INTEGRATIONS, label: "Integrations", path: WORKSPACE_PATHS.integrations }),
  Object.freeze({ routeId: WORKSPACE_ROUTE_IDS.DIAGNOSTICS, label: "Diagnostics", path: WORKSPACE_PATHS.diagnostics })
]);

export const AMBIENT_PRIMARY_WORKSPACE_NAVIGATION = Object.freeze([
  Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.HOME,
    label: "Now",
    path: WORKSPACE_PATHS.home,
    section: "home",
    action: "onHome",
    orientation: "now"
  }),
  Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.QUOTE_LIST,
    label: "Opportunities",
    path: WORKSPACE_PATHS.quotes,
    section: "quotes",
    action: "onQuotes",
    orientation: "opportunities",
    triggerRef: "quotes"
  }),
  Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.OPERATIONS,
    label: "Operations",
    path: WORKSPACE_PATHS.operations,
    section: "operations",
    action: "onOperations",
    capability: "eventSchedule",
    orientation: "operations",
    triggerRef: "operations"
  }),
  Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.CUSTOMER_LIST,
    label: "Clients",
    path: WORKSPACE_PATHS.customers,
    section: "customers",
    action: "onCustomers",
    orientation: "clients"
  }),
  Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.CATALOG,
    label: "Library",
    path: WORKSPACE_PATHS.catalog,
    section: "catalog",
    action: "onCatalog",
    orientation: "library"
  })
]);

const STATIC_ROUTES = new Map([
  [WORKSPACE_PATHS.home, WORKSPACE_ROUTE_IDS.HOME],
  [WORKSPACE_PATHS.clearDeck, WORKSPACE_ROUTE_IDS.CLEAR_DECK],
  [WORKSPACE_PATHS.customers, WORKSPACE_ROUTE_IDS.CUSTOMER_LIST],
  [WORKSPACE_PATHS.staff, WORKSPACE_ROUTE_IDS.STAFF],
  [WORKSPACE_PATHS.quotes, WORKSPACE_ROUTE_IDS.QUOTE_LIST],
  [WORKSPACE_PATHS.quoteNew, WORKSPACE_ROUTE_IDS.QUOTE_NEW],
  [WORKSPACE_PATHS.events, WORKSPACE_ROUTE_IDS.EVENT_LIST],
  [WORKSPACE_PATHS.messaging, WORKSPACE_ROUTE_IDS.MESSAGING],
  [WORKSPACE_PATHS.workflow, WORKSPACE_ROUTE_IDS.WORKFLOW],
  [WORKSPACE_PATHS.operations, WORKSPACE_ROUTE_IDS.OPERATIONS],
  [WORKSPACE_PATHS.inventory, WORKSPACE_ROUTE_IDS.INVENTORY],
  [WORKSPACE_PATHS.schedule, WORKSPACE_ROUTE_IDS.SCHEDULE],
  [WORKSPACE_PATHS.reporting, WORKSPACE_ROUTE_IDS.REPORTING],
  [WORKSPACE_PATHS.catalog, WORKSPACE_ROUTE_IDS.CATALOG],
  [WORKSPACE_PATHS.imports, WORKSPACE_ROUTE_IDS.IMPORTS],
  [WORKSPACE_PATHS.integrations, WORKSPACE_ROUTE_IDS.INTEGRATIONS],
  [WORKSPACE_PATHS.diagnostics, WORKSPACE_ROUTE_IDS.DIAGNOSTICS]
]);

const WORKFLOW_ATTENTION_TYPES = new Set([
  "change_request",
  "follow_up",
  "approval",
  "post_event_closeout",
  "decision_debt",
  "unread_customer_reply",
  "anniversary_rebooking"
]);
const OPAQUE_ID_LIMIT = 256;

function normalizePathname(pathname) {
  const value = typeof pathname === "string" ? pathname : "";
  const withoutQuery = value.split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withLeadingSlash.replace(/\/{2,}$/g, "/").replace(/\/$/, "") || "/";
}

function looksLikeEmail(value) {
  return /^[^@\s]+@[^@\s]+$/.test(value);
}

function normalizeOpaqueId(value, fieldName, { rejectEmail = false } = {}) {
  if (typeof value !== "string" || !value || value.length > OPAQUE_ID_LIMIT) {
    throw new TypeError(`${fieldName} must be a non-empty opaque identifier.`);
  }
  if (value !== value.trim() || /[\s/?#\\\u0000]/u.test(value) || value === "." || value === "..") {
    throw new TypeError(`${fieldName} must be a URL-safe opaque identifier.`);
  }
  if (rejectEmail && looksLikeEmail(value)) {
    throw new TypeError(`${fieldName} must not be an email address.`);
  }
  return value;
}

function encodeOpaqueId(value, fieldName, options) {
  return encodeURIComponent(normalizeOpaqueId(value, fieldName, options))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function decodeOpaqueId(segment, fieldName, options) {
  try {
    return normalizeOpaqueId(decodeURIComponent(segment), fieldName, options);
  } catch {
    return "";
  }
}

function createKnownRoute(routeId, pathname, {
  canonicalPath = pathname,
  params = {},
  redirectTo = ""
} = {}) {
  const meta = ROUTE_META[routeId];
  return Object.freeze({
    surface: "workspace",
    routeId,
    section: meta.section,
    delivery: meta.delivery,
    pathname,
    canonicalPath,
    redirectTo,
    params: Object.freeze({ ...params }),
    isKnown: true,
    isWorkspace: true
  });
}

function createUnknownRoute(pathname, isWorkspace) {
  return Object.freeze({
    surface: isWorkspace ? "workspace" : "outside",
    routeId: isWorkspace ? WORKSPACE_ROUTE_IDS.NOT_FOUND : WORKSPACE_ROUTE_IDS.OUTSIDE,
    section: isWorkspace ? "not-found" : "outside",
    delivery: "none",
    pathname,
    canonicalPath: pathname,
    redirectTo: "",
    params: Object.freeze({}),
    isKnown: false,
    isWorkspace
  });
}

export function buildCustomerPath(customerId) {
  return `${WORKSPACE_PATHS.customers}/${encodeOpaqueId(customerId, "customerId", { rejectEmail: true })}`;
}

export function buildQuotePath(quoteId) {
  return `${WORKSPACE_PATHS.quotes}/${encodeOpaqueId(quoteId, "quoteId")}`;
}

export function buildQuoteEditPath(quoteId) {
  return `${buildQuotePath(quoteId)}/edit`;
}

export function buildEventPath(quoteId) {
  return `${WORKSPACE_PATHS.events}/${encodeOpaqueId(quoteId, "quoteId")}`;
}

export function buildEventLivePath(quoteId) {
  return `${buildEventPath(quoteId)}/live`;
}

export function buildEventReplayPath(quoteId) {
  return `${buildEventPath(quoteId)}/replay`;
}

export function buildWorkflowPath({ quoteId = "", attentionType = "", requestId = "" } = {}) {
  const search = new URLSearchParams();
  if (quoteId) search.set("quoteId", normalizeOpaqueId(quoteId, "quoteId"));
  if (attentionType) {
    if (!WORKFLOW_ATTENTION_TYPES.has(attentionType)) {
      throw new TypeError("attentionType is not a supported workflow attention type.");
    }
    search.set("attentionType", attentionType);
  }
  if (requestId) search.set("requestId", normalizeOpaqueId(requestId, "requestId"));
  const query = search.toString();
  return query ? `${WORKSPACE_PATHS.workflow}?${query}` : WORKSPACE_PATHS.workflow;
}

export function buildMessagingPath({ quoteId = "" } = {}) {
  if (!quoteId) return WORKSPACE_PATHS.messaging;
  const search = new URLSearchParams({ quoteId: normalizeOpaqueId(quoteId, "quoteId") });
  return `${WORKSPACE_PATHS.messaging}?${search.toString()}`;
}

export function buildWorkspacePath(routeId, params = {}) {
  switch (routeId) {
    case WORKSPACE_ROUTE_IDS.HOME:
      return WORKSPACE_PATHS.home;
    case WORKSPACE_ROUTE_IDS.CLEAR_DECK:
      return WORKSPACE_PATHS.clearDeck;
    case WORKSPACE_ROUTE_IDS.CUSTOMER_LIST:
      return WORKSPACE_PATHS.customers;
    case WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL:
      return buildCustomerPath(params.customerId);
    case WORKSPACE_ROUTE_IDS.STAFF:
      return WORKSPACE_PATHS.staff;
    case WORKSPACE_ROUTE_IDS.QUOTE_LIST:
      return WORKSPACE_PATHS.quotes;
    case WORKSPACE_ROUTE_IDS.QUOTE_NEW:
      return WORKSPACE_PATHS.quoteNew;
    case WORKSPACE_ROUTE_IDS.QUOTE_DETAIL:
      return buildQuotePath(params.quoteId);
    case WORKSPACE_ROUTE_IDS.QUOTE_EDIT:
      return buildQuoteEditPath(params.quoteId);
    case WORKSPACE_ROUTE_IDS.EVENT_LIST:
      return WORKSPACE_PATHS.events;
    case WORKSPACE_ROUTE_IDS.EVENT_DETAIL:
      return buildEventPath(params.quoteId);
    case WORKSPACE_ROUTE_IDS.EVENT_LIVE:
      return buildEventLivePath(params.quoteId);
    case WORKSPACE_ROUTE_IDS.EVENT_REPLAY:
      return buildEventReplayPath(params.quoteId);
    case WORKSPACE_ROUTE_IDS.MESSAGING:
      return buildMessagingPath(params);
    case WORKSPACE_ROUTE_IDS.WORKFLOW:
      return buildWorkflowPath(params);
    case WORKSPACE_ROUTE_IDS.OPERATIONS:
      return WORKSPACE_PATHS.operations;
    case WORKSPACE_ROUTE_IDS.INVENTORY:
      return WORKSPACE_PATHS.inventory;
    case WORKSPACE_ROUTE_IDS.SCHEDULE:
      return WORKSPACE_PATHS.schedule;
    case WORKSPACE_ROUTE_IDS.REPORTING:
      return WORKSPACE_PATHS.reporting;
    case WORKSPACE_ROUTE_IDS.CATALOG:
      return WORKSPACE_PATHS.catalog;
    case WORKSPACE_ROUTE_IDS.IMPORTS:
      return WORKSPACE_PATHS.imports;
    case WORKSPACE_ROUTE_IDS.INTEGRATIONS:
      return WORKSPACE_PATHS.integrations;
    case WORKSPACE_ROUTE_IDS.DIAGNOSTICS:
      return WORKSPACE_PATHS.diagnostics;
    default:
      throw new TypeError(`Unsupported workspace route: ${String(routeId || "")}`);
  }
}

export function parseWorkspacePath(pathname) {
  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath === `${WORKSPACE_ROOT}/home`) {
    return createKnownRoute(WORKSPACE_ROUTE_IDS.HOME, normalizedPath, {
      canonicalPath: WORKSPACE_PATHS.home,
      redirectTo: WORKSPACE_PATHS.home
    });
  }

  if (normalizedPath === CLIENTS_ALIAS_PATH) {
    return createKnownRoute(WORKSPACE_ROUTE_IDS.CUSTOMER_LIST, normalizedPath, {
      canonicalPath: WORKSPACE_PATHS.customers,
      redirectTo: WORKSPACE_PATHS.customers
    });
  }

  const staticRouteId = STATIC_ROUTES.get(normalizedPath);
  if (staticRouteId) {
    return createKnownRoute(staticRouteId, normalizedPath);
  }

  const segments = normalizedPath.split("/");
  if (segments.length === 4 && segments[1] === "app" && segments[2] === "clients") {
    const customerId = decodeOpaqueId(segments[3], "customerId", { rejectEmail: true });
    if (customerId) {
      const canonicalPath = buildCustomerPath(customerId);
      return createKnownRoute(WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL, normalizedPath, {
        canonicalPath,
        redirectTo: canonicalPath,
        params: { customerId }
      });
    }
  }

  if (segments.length === 4 && segments[1] === "app" && segments[2] === "customers") {
    const customerId = decodeOpaqueId(segments[3], "customerId", { rejectEmail: true });
    if (customerId) {
      return createKnownRoute(WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL, normalizedPath, {
        canonicalPath: buildCustomerPath(customerId),
        params: { customerId }
      });
    }
  }

  if (segments.length === 4 && segments[1] === "app" && segments[2] === "quotes") {
    const quoteId = decodeOpaqueId(segments[3], "quoteId");
    if (quoteId && quoteId !== "new") {
      return createKnownRoute(WORKSPACE_ROUTE_IDS.QUOTE_DETAIL, normalizedPath, {
        canonicalPath: buildQuotePath(quoteId),
        params: { quoteId }
      });
    }
  }

  if (segments.length === 5 && segments[1] === "app" && segments[2] === "quotes" && segments[4] === "edit") {
    const quoteId = decodeOpaqueId(segments[3], "quoteId");
    if (quoteId && quoteId !== "new") {
      return createKnownRoute(WORKSPACE_ROUTE_IDS.QUOTE_EDIT, normalizedPath, {
        canonicalPath: buildQuoteEditPath(quoteId),
        params: { quoteId }
      });
    }
  }

  if (segments.length >= 4 && segments.length <= 5 && segments[1] === "app" && segments[2] === "events") {
    const quoteId = decodeOpaqueId(segments[3], "quoteId");
    if (quoteId) {
      if (segments.length === 4) {
        return createKnownRoute(WORKSPACE_ROUTE_IDS.EVENT_DETAIL, normalizedPath, {
          canonicalPath: buildEventPath(quoteId),
          params: { quoteId }
        });
      }
      if (segments[4] === "live") {
        return createKnownRoute(WORKSPACE_ROUTE_IDS.EVENT_LIVE, normalizedPath, {
          canonicalPath: buildEventLivePath(quoteId),
          params: { quoteId }
        });
      }
      if (segments[4] === "replay") {
        return createKnownRoute(WORKSPACE_ROUTE_IDS.EVENT_REPLAY, normalizedPath, {
          canonicalPath: buildEventReplayPath(quoteId),
          params: { quoteId }
        });
      }
    }
  }

  const isWorkspace = normalizedPath === WORKSPACE_ROOT || normalizedPath.startsWith(`${WORKSPACE_ROOT}/`);
  return createUnknownRoute(normalizedPath, isWorkspace);
}

export function getPortalToken(search = "") {
  const query = typeof search === "string" ? search : "";
  const token = String(new URLSearchParams(query.startsWith("?") ? query.slice(1) : query).get("portal") || "").trim();
  return token;
}

export function hasPortalQuery(search = "") {
  return Boolean(getPortalToken(search));
}

export function buildPortalPath(portalToken) {
  const token = typeof portalToken === "string" ? portalToken.trim() : "";
  if (!token) throw new TypeError("portalToken must be a non-empty string.");
  return `${WORKSPACE_PATHS.home}?portal=${encodeURIComponent(token)}`;
}

export function parseWorkflowFocus(search = "") {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const rawQuoteId = params.get("quoteId") || "";
  const rawRequestId = params.get("requestId") || "";
  const attentionType = params.get("attentionType") || "";
  return Object.freeze({
    quoteId: rawQuoteId ? decodeOpaqueId(encodeURIComponent(rawQuoteId), "quoteId") : "",
    attentionType: WORKFLOW_ATTENTION_TYPES.has(attentionType) ? attentionType : "",
    requestId: rawRequestId ? decodeOpaqueId(encodeURIComponent(rawRequestId), "requestId") : ""
  });
}

export function parseMessagingFocus(search = "") {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const rawQuoteId = params.get("quoteId") || "";
  return Object.freeze({
    quoteId: rawQuoteId ? decodeOpaqueId(encodeURIComponent(rawQuoteId), "quoteId") : ""
  });
}

export function parseWorkspaceLocation({ pathname = "/", search = "", hash = "" } = {}) {
  const normalizedSearch = search && !String(search).startsWith("?") ? `?${search}` : String(search || "");
  const portalToken = getPortalToken(normalizedSearch);
  if (portalToken) {
    return Object.freeze({
      surface: "portal",
      routeId: WORKSPACE_ROUTE_IDS.PORTAL,
      portalToken,
      pathname: normalizePathname(pathname),
      search: normalizedSearch,
      hash: String(hash || ""),
      canonicalPath: buildPortalPath(portalToken),
      workspaceRoute: parseWorkspacePath(pathname)
    });
  }

  const route = parseWorkspacePath(pathname);
  const workflowFocus = route.routeId === WORKSPACE_ROUTE_IDS.WORKFLOW
    ? parseWorkflowFocus(normalizedSearch)
    : Object.freeze({ quoteId: "", attentionType: "", requestId: "" });
  const messagingFocus = route.routeId === WORKSPACE_ROUTE_IDS.MESSAGING
    ? parseMessagingFocus(normalizedSearch)
    : Object.freeze({ quoteId: "" });
  return Object.freeze({
    ...route,
    search: normalizedSearch,
    hash: String(hash || ""),
    workflowFocus,
    messagingFocus
  });
}
