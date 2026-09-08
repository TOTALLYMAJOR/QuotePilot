import { buildWorkflowPath } from "./workspaceRoutes";

export const WORKSPACE_RETURN_CONTEXT_MODEL_ID = "workspace-return-context-v1";
export const WORKSPACE_RETURN_CONTEXT_STATE_KEY = "workspaceReturnContext";

const DEFAULT_CONTEXT_LIMIT = 24;
const RETURNABLE_ROUTE_IDS = new Set([
  "home",
  "quote-list",
  "quote-detail",
  "customer-list",
  "customer-detail",
  "catalog",
  "clear-deck"
]);
const DESTINATION_ROUTE_IDS = new Set(["quote-detail", "customer-detail", "catalog", "workflow"]);
const WORKFLOW_ATTENTION_TYPES = new Set([
  "approval",
  "change_request",
  "decision_debt",
  "follow_up",
  "post_event_closeout",
  "unread_customer_reply",
  "anniversary_rebooking"
]);
const CLIENT_DIRECTORY_FILTERS = new Set(["all", "linked", "upcoming", "contact_gap"]);
const CLIENT_OVERVIEW_TABS = new Set(["overview", "quotes", "events", "money", "conversations"]);
const QUOTE_STATUS_FILTERS = new Set(["all", "draft", "submitted", "archived"]);
const FOCUS_KINDS = new Set([
  "route-heading",
  "priority-action",
  "opportunity-action",
  "opportunity-disclosure",
  "client-action",
  "client-filter",
  "client-search",
  "client-overview-action",
  "client-overview-tab",
  "library-action",
  "library-disclosure",
  "quick-updates",
  "decision-action"
]);
const SURFACE_IDS = new Set([
  "living-opportunity",
  "client-overview",
  "ambient-library",
  "library-editor",
  "decision-resolution",
  "commercial-priority"
]);
const ALLOWED_ROUTE_PAIRS = new Set([
  "home:workflow",
  "quote-list:workflow",
  "quote-list:quote-detail",
  "customer-list:customer-detail",
  "customer-detail:quote-detail",
  "quote-detail:catalog",
  "catalog:catalog",
  "clear-deck:workflow"
]);
const SURFACE_ROUTE_PAIRS = Object.freeze({
  "living-opportunity": new Set(["quote-list:quote-detail", "customer-detail:quote-detail"]),
  "client-overview": new Set(["customer-list:customer-detail"]),
  "ambient-library": new Set(["quote-detail:catalog"]),
  "library-editor": new Set(["catalog:catalog"]),
  "decision-resolution": new Set(["clear-deck:workflow"]),
  "commercial-priority": new Set(["home:workflow", "quote-list:workflow"])
});
const runtimeStoreByWindow = new WeakMap();

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value, allowedKeys) {
  return record(value)
    && Object.keys(value).length === allowedKeys.length
    && Object.keys(value).every((key) => allowedKeys.includes(key));
}

function boundedText(value, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return "";
  }
  return normalized;
}

function randomContextId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `qprc_${uuid.replaceAll("-", "").toLowerCase()}`;
  return `qprc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function normalizeEntry(value) {
  if (!record(value)) return null;
  const sessionId = boundedText(value.sessionId, 160);
  const entryId = boundedText(value.entryId, 160);
  const position = Number(value.position);
  if (!sessionId || !entryId || !Number.isSafeInteger(position)) return null;
  return Object.freeze({ sessionId, entryId, position });
}

function normalizeScope(value) {
  if (!record(value)) return null;
  const organizationId = boundedText(value.organizationId, 240);
  const principalId = boundedText(value.principalId, 240);
  const role = boundedText(value.role, 80).toLowerCase();
  if (!organizationId || !principalId || !role) return null;
  return Object.freeze({ organizationId, principalId, role });
}

function scopeKey(value) {
  const scope = normalizeScope(value);
  return scope
    ? JSON.stringify([scope.organizationId, scope.principalId, scope.role])
    : "";
}

function normalizeScrollY(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(10_000_000, Math.max(0, Math.round(numeric)));
}

function normalizeFocus(value) {
  if (!record(value)) return null;
  const kind = boundedText(value.kind, 80);
  if (!FOCUS_KINDS.has(kind)) return null;
  const objectId = boundedText(value.objectId, 240);
  const actionId = boundedText(value.actionId, 240);
  const controlId = boundedText(value.controlId, 160);
  const requestedAttentionType = boundedText(value.attentionType, 80).toLowerCase();
  const attentionType = WORKFLOW_ATTENTION_TYPES.has(requestedAttentionType)
    ? requestedAttentionType
    : "";
  if (kind !== "route-heading" && !objectId && !actionId && !controlId) return null;
  return Object.freeze({
    kind,
    ...(objectId ? { objectId } : {}),
    ...(actionId ? { actionId } : {}),
    ...(controlId ? { controlId } : {}),
    ...(attentionType ? { attentionType } : {})
  });
}

function normalizeDisclosureIds(values) {
  if (!Array.isArray(values)) return Object.freeze([]);
  return Object.freeze(Array.from(new Set(values
    .slice(0, 32)
    .map((value) => boundedText(value, 240))
    .filter(Boolean))));
}

function normalizeStructured(routeId, value) {
  const structured = record(value) ? value : {};
  if (routeId === "quote-list") {
    const eventTypeFilter = boundedText(structured.eventTypeFilter, 160) || "all";
    const requestedStatus = boundedText(structured.statusFilter, 40).toLowerCase();
    return Object.freeze({
      eventTypeFilter,
      statusFilter: QUOTE_STATUS_FILTERS.has(requestedStatus) ? requestedStatus : "all",
      order: "priority"
    });
  }
  if (routeId === "customer-list") {
    const requestedFilter = boundedText(structured.directoryFilter, 40).toLowerCase();
    return Object.freeze({
      directoryFilter: CLIENT_DIRECTORY_FILTERS.has(requestedFilter) ? requestedFilter : "all",
      order: "recorded-event"
    });
  }
  if (routeId === "customer-detail") {
    const requestedTab = boundedText(structured.activeTab, 40).toLowerCase();
    return Object.freeze({
      activeTab: CLIENT_OVERVIEW_TABS.has(requestedTab) ? requestedTab : "overview"
    });
  }
  if (routeId === "catalog") return Object.freeze({ order: "library-section" });
  return Object.freeze({});
}

function normalizeTransient(routeId, value) {
  const transient = record(value) ? value : {};
  if (routeId === "quote-list") {
    const loadedAtISO = boundedText(transient.sourceLoadedAtISO, 80);
    return Object.freeze({
      query: boundedText(transient.query, 240),
      ...(loadedAtISO && Number.isFinite(Date.parse(loadedAtISO))
        ? { sourceLoadedAtISO: new Date(Date.parse(loadedAtISO)).toISOString() }
        : {})
    });
  }
  if (routeId === "home") {
    const sourceLoadedAt = Number(transient.sourceLoadedAt);
    return Object.freeze({
      ...(Number.isSafeInteger(sourceLoadedAt) && sourceLoadedAt > 0
        ? { sourceLoadedAt }
        : {})
    });
  }
  if (routeId === "customer-list") {
    const cursorHistory = Array.isArray(transient.cursorHistory)
      ? transient.cursorHistory
        .slice(-12)
        .map((cursor) => {
          const normalized = String(cursor ?? "").trim();
          return normalized.length <= 1_024 && !/[\u0000-\u001f\u007f]/u.test(normalized)
            ? normalized
            : null;
        })
        .filter((cursor) => cursor !== null)
      : [];
    return Object.freeze({
      searchDraft: boundedText(transient.searchDraft, 240),
      search: boundedText(transient.search, 240),
      cursor: boundedText(transient.cursor, 1_024),
      cursorHistory: Object.freeze(cursorHistory)
    });
  }
  return Object.freeze({});
}

export function sanitizeWorkspaceReturnView(value = {}) {
  if (!record(value)) return null;
  const routeId = boundedText(value.routeId, 80);
  if (!RETURNABLE_ROUTE_IDS.has(routeId)) return null;
  return Object.freeze({
    routeId,
    structured: normalizeStructured(routeId, value.structured),
    transient: normalizeTransient(routeId, value.transient),
    disclosureIds: normalizeDisclosureIds(value.disclosureIds),
    scrollY: normalizeScrollY(value.scrollY),
    focus: normalizeFocus(value.focus)
  });
}

function normalizePathname(routeId, value) {
  const pathname = boundedText(value, 1_024);
  if (
    !pathname.startsWith("/app")
    || pathname.includes("?")
    || pathname.includes("#")
    || /(?:@|%40)/iu.test(pathname)
  ) return "";
  if (routeId === "quote-list") return pathname === "/app/quotes" ? pathname : "";
  if (routeId === "home") return pathname === "/app" ? pathname : "";
  if (routeId === "customer-list") return pathname === "/app/customers" ? pathname : "";
  if (routeId === "catalog") return pathname === "/app/catalog" ? pathname : "";
  if (routeId === "clear-deck") return pathname === "/app/clear-the-deck" ? pathname : "";
  if (routeId === "workflow") return pathname === "/app/workflow" ? pathname : "";
  if (routeId === "quote-detail") {
    return /^\/app\/quotes\/(?!new(?:\/|$))[^/]+$/u.test(pathname) ? pathname : "";
  }
  if (routeId === "customer-detail") {
    return /^\/app\/customers\/[^/]+$/u.test(pathname) ? pathname : "";
  }
  return "";
}

function normalizeSearch(routeId, value) {
  const raw = String(value || "");
  if (!raw) return routeId === "workflow" ? null : "";
  if (!raw.startsWith("?") || raw.length > 1_024) return null;
  if (routeId === "workflow" && /%(?![0-9a-f]{2})/iu.test(raw)) return null;
  const params = new URLSearchParams(raw.slice(1));
  const allowed = routeId === "quote-list"
    ? new Set(["eventType", "status"])
    : routeId === "customer-list"
      ? new Set(["view"])
      : routeId === "workflow"
        ? new Set(["quoteId", "attentionType", "requestId"])
      : new Set();
  if ([...params.keys()].some((key) => !allowed.has(key))) return null;
  if (routeId === "quote-list") {
    if (params.getAll("status").length > 1 || params.getAll("eventType").length > 1) return null;
    const status = params.get("status");
    if (status && !QUOTE_STATUS_FILTERS.has(status)) return null;
    const eventType = params.get("eventType");
    if (eventType && !boundedText(eventType, 160)) return null;
  }
  if (routeId === "customer-list") {
    if (params.getAll("view").length > 1) return null;
    const view = params.get("view");
    if (view && !CLIENT_DIRECTORY_FILTERS.has(view)) return null;
  }
  if (routeId === "workflow") {
    if (["quoteId", "attentionType", "requestId"].some((key) => params.getAll(key).length !== 1)) {
      return null;
    }
    const quoteId = params.get("quoteId");
    const attentionType = params.get("attentionType");
    const requestId = params.get("requestId");
    if (!quoteId || !requestId || !WORKFLOW_ATTENTION_TYPES.has(attentionType)) return null;
    try {
      buildWorkflowPath({ quoteId, attentionType, requestId });
    } catch {
      return null;
    }
  }
  params.sort();
  const normalized = params.toString();
  return normalized ? `?${normalized}` : "";
}

function normalizeRouteLocation(value, allowedRouteIds) {
  if (!record(value)) return null;
  const routeId = boundedText(value.routeId, 80);
  if (!allowedRouteIds.has(routeId)) return null;
  const pathname = normalizePathname(routeId, value.pathname);
  const search = normalizeSearch(routeId, value.search);
  if (!pathname || search === null) return null;
  return Object.freeze({ routeId, pathname, search });
}

function normalizeDestinationView(value) {
  if (!record(value) || value.kind !== "library-editor") return null;
  const sectionId = boundedText(value.sectionId, 160);
  const recordId = boundedText(value.recordId, 240);
  const actionId = boundedText(value.actionId, 240);
  if (!sectionId || !actionId) return null;
  return Object.freeze({
    kind: "library-editor",
    sectionId,
    ...(recordId ? { recordId } : {}),
    actionId
  });
}

function routeObjectId(pathname) {
  const segment = String(pathname || "").split("/").filter(Boolean).at(-1) || "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

function viewMatchesOriginQuery(origin, view) {
  const params = new URLSearchParams(String(origin.search || "").replace(/^\?/u, ""));
  if (origin.routeId === "quote-list") {
    return (params.get("eventType") || "all") === view.structured.eventTypeFilter
      && (params.get("status") || "all") === view.structured.statusFilter;
  }
  if (origin.routeId === "customer-list") {
    return (params.get("view") || "all") === view.structured.directoryFilter;
  }
  return true;
}

function transitionMatchesView({ origin, destination, surfaceId, view, destinationView }) {
  const pair = `${origin.routeId}:${destination.routeId}`;
  if (!SURFACE_ROUTE_PAIRS[surfaceId]?.has(pair) || !viewMatchesOriginQuery(origin, view)) {
    return false;
  }
  const focus = view.focus;
  if (!focus) return false;
  if (surfaceId === "living-opportunity") {
    const expectedId = routeObjectId(destination.pathname);
    const expectedKind = origin.routeId === "customer-detail"
      ? "client-overview-action"
      : "opportunity-action";
    return Boolean(expectedId && focus.kind === expectedKind && focus.objectId === expectedId && focus.actionId);
  }
  if (surfaceId === "client-overview") {
    const expectedId = routeObjectId(destination.pathname);
    return Boolean(expectedId && focus.kind === "client-action" && focus.objectId === expectedId && focus.actionId);
  }
  if (surfaceId === "ambient-library") {
    const expectedId = routeObjectId(origin.pathname);
    return Boolean(expectedId && focus.kind === "quick-updates" && focus.objectId === expectedId && focus.actionId);
  }
  if (surfaceId === "library-editor") {
    const expectedId = destinationView?.recordId || destinationView?.sectionId || "";
    return Boolean(
      destinationView
      && expectedId
      && focus.kind === "library-action"
      && focus.objectId === expectedId
      && focus.actionId === destinationView.actionId
    );
  }
  if (surfaceId === "decision-resolution") {
    const params = new URLSearchParams(String(destination.search || "").replace(/^\?/u, ""));
    const requestId = params.get("requestId") || "";
    const attentionType = params.get("attentionType") || "";
    return Boolean(
      requestId
      && ["approval", "decision_debt"].includes(attentionType)
      && focus.kind === "decision-action"
      && focus.objectId === requestId
      && focus.actionId === `review-workflow:${requestId}`
    );
  }
  if (surfaceId === "commercial-priority") {
    const params = new URLSearchParams(String(destination.search || "").replace(/^\?/u, ""));
    const quoteId = params.get("quoteId") || "";
    const requestId = params.get("requestId") || "";
    const attentionType = params.get("attentionType") || "";
    if (
      !quoteId
      || !requestId
      || !WORKFLOW_ATTENTION_TYPES.has(attentionType)
      || focus.objectId !== quoteId
      || focus.controlId !== requestId
      || focus.attentionType !== attentionType
      || !focus.actionId
    ) return false;
    if (origin.routeId === "home") {
      return focus.kind === "priority-action" && focus.actionId.startsWith("review-now-priority:");
    }
    return focus.kind === "opportunity-action"
      && focus.actionId === `review-opportunity-workflow:${quoteId}:${requestId}`;
  }
  return false;
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function normalizeToken(value) {
  if (!exactKeys(value, [
    "contextId",
    "destination",
    "modelId",
    "organizationId",
    "origin",
    "principal",
    "runtimeId",
    "surfaceId"
  ])) return null;
  if (!exactKeys(value.principal, ["id", "role"])) return null;
  if (!exactKeys(value.origin, ["entryId", "position", "routeId", "pathname", "search"])) return null;
  if (!exactKeys(value.destination, ["routeId", "pathname", "search"])) return null;
  if (value.modelId !== WORKSPACE_RETURN_CONTEXT_MODEL_ID) return null;
  const contextId = boundedText(value.contextId, 160);
  const runtimeId = boundedText(value.runtimeId, 160);
  const organizationId = boundedText(value.organizationId, 240);
  const principal = normalizeScope({
    organizationId,
    principalId: value.principal?.id,
    role: value.principal?.role
  });
  const originLocation = normalizeRouteLocation(value.origin, RETURNABLE_ROUTE_IDS);
  const destination = normalizeRouteLocation(value.destination, DESTINATION_ROUTE_IDS);
  const originEntryId = boundedText(value.origin?.entryId, 160);
  const originPosition = Number(value.origin?.position);
  const surfaceId = boundedText(value.surfaceId, 80);
  if (
    !contextId
    || !runtimeId
    || !principal
    || !originLocation
    || !destination
    || !originEntryId
    || !Number.isSafeInteger(originPosition)
    || !SURFACE_IDS.has(surfaceId)
    || !ALLOWED_ROUTE_PAIRS.has(`${originLocation.routeId}:${destination.routeId}`)
    || !SURFACE_ROUTE_PAIRS[surfaceId]?.has(`${originLocation.routeId}:${destination.routeId}`)
  ) return null;
  return Object.freeze({
    modelId: WORKSPACE_RETURN_CONTEXT_MODEL_ID,
    contextId,
    runtimeId,
    organizationId,
    principal: Object.freeze({ id: principal.principalId, role: principal.role }),
    origin: Object.freeze({
      entryId: originEntryId,
      position: originPosition,
      ...originLocation
    }),
    destination,
    surfaceId
  });
}

function touch(map, key, value, limit) {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

export function withWorkspaceReturnContextState(state, token) {
  const applicationState = record(state) ? { ...state } : {};
  delete applicationState[WORKSPACE_RETURN_CONTEXT_STATE_KEY];
  const normalized = normalizeToken(token);
  return normalized
    ? Object.freeze({ ...applicationState, [WORKSPACE_RETURN_CONTEXT_STATE_KEY]: normalized })
    : Object.keys(applicationState).length ? applicationState : null;
}

export function readWorkspaceReturnContextToken(state) {
  return normalizeToken(state?.[WORKSPACE_RETURN_CONTEXT_STATE_KEY]);
}

export function createWorkspaceReturnContextStore({ limit = DEFAULT_CONTEXT_LIMIT } = {}) {
  const capacity = Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_CONTEXT_LIMIT;
  const views = new Map();
  const contexts = new Map();
  let activeScope = null;
  let activeScopeKey = "";

  const clear = () => {
    views.clear();
    contexts.clear();
  };

  const setScope = (nextScope) => {
    const normalized = normalizeScope(nextScope);
    const nextScopeKey = scopeKey(nextScope);
    const changed = nextScopeKey !== activeScopeKey;
    if (changed) clear();
    activeScope = normalized;
    activeScopeKey = nextScopeKey;
    return Object.freeze({ ok: Boolean(nextScopeKey), changed });
  };

  const prepare = ({ entry, origin, destination, surfaceId, view, destinationView = null } = {}) => {
    const normalizedEntry = normalizeEntry(entry);
    const normalizedOrigin = normalizeRouteLocation(origin, RETURNABLE_ROUTE_IDS);
    const normalizedDestination = normalizeRouteLocation(destination, DESTINATION_ROUTE_IDS);
    const normalizedView = sanitizeWorkspaceReturnView(view);
    const normalizedSurfaceId = boundedText(surfaceId, 80);
    const normalizedDestinationView = destinationView
      ? normalizeDestinationView(destinationView)
      : null;
    if (
      !activeScope
      || !normalizedEntry
      || !normalizedOrigin
      || normalizedOrigin.routeId !== normalizedView?.routeId
      || !normalizedDestination
      || !SURFACE_IDS.has(normalizedSurfaceId)
      || !ALLOWED_ROUTE_PAIRS.has(`${normalizedOrigin.routeId}:${normalizedDestination.routeId}`)
      || (destinationView && !normalizedDestinationView)
      || !transitionMatchesView({
        origin: normalizedOrigin,
        destination: normalizedDestination,
        surfaceId: normalizedSurfaceId,
        view: normalizedView,
        destinationView: normalizedDestinationView
      })
    ) {
      return Object.freeze({ ok: false, reason: "invalid_context" });
    }
    const baseContextId = randomContextId();
    let contextId = baseContextId;
    let collision = 1;
    while (contexts.has(contextId)) {
      collision += 1;
      contextId = `${baseContextId}_${collision}`;
    }
    const token = Object.freeze({
      modelId: WORKSPACE_RETURN_CONTEXT_MODEL_ID,
      contextId,
      runtimeId: normalizedEntry.sessionId,
      organizationId: activeScope.organizationId,
      principal: Object.freeze({ id: activeScope.principalId, role: activeScope.role }),
      origin: Object.freeze({
        entryId: normalizedEntry.entryId,
        position: normalizedEntry.position,
        ...normalizedOrigin
      }),
      destination: normalizedDestination,
      surfaceId: normalizedSurfaceId
    });
    const captured = Object.freeze({
      scopeKey: activeScopeKey,
      sessionId: normalizedEntry.sessionId,
      entryId: normalizedEntry.entryId,
      position: normalizedEntry.position,
      view: normalizedView
    });
    touch(views, normalizedEntry.entryId, captured, capacity);
    touch(contexts, contextId, {
      token,
      scopeKey: activeScopeKey,
      originEntry: normalizedEntry,
      destinationEntry: null,
      destinationView: normalizedDestinationView
    }, capacity);
    return Object.freeze({ ok: true, token });
  };

  const commit = ({ token, destinationEntry } = {}) => {
    const normalizedToken = normalizeToken(token);
    const destination = normalizeEntry(destinationEntry);
    const context = normalizedToken ? contexts.get(normalizedToken.contextId) : null;
    if (
      !activeScopeKey
      || !normalizedToken
      || !destination
      || !context
      || context.scopeKey !== activeScopeKey
      || !sameJson(context.token, normalizedToken)
      || destination.sessionId !== context.originEntry.sessionId
      || destination.position !== context.originEntry.position + 1
    ) return Object.freeze({ ok: false, reason: "invalid_destination" });
    context.destinationEntry = destination;
    return Object.freeze({ ok: true });
  };

  const readOriginView = ({ entry, routeId } = {}) => {
    const normalizedEntry = normalizeEntry(entry);
    const expectedRouteId = boundedText(routeId, 80);
    const captured = normalizedEntry ? views.get(normalizedEntry.entryId) : null;
    if (
      !activeScopeKey
      || !normalizedEntry
      || !captured
      || captured.scopeKey !== activeScopeKey
      || captured.sessionId !== normalizedEntry.sessionId
      || captured.position !== normalizedEntry.position
      || captured.view.routeId !== expectedRouteId
    ) return Object.freeze({ ok: false, reason: "unavailable" });
    return Object.freeze({ ok: true, view: captured.view });
  };

  const updateOriginView = ({ entry, routeId, view } = {}) => {
    const normalizedEntry = normalizeEntry(entry);
    const expectedRouteId = boundedText(routeId, 80);
    const normalizedView = sanitizeWorkspaceReturnView(view);
    const captured = normalizedEntry ? views.get(normalizedEntry.entryId) : null;
    if (
      !activeScopeKey
      || !normalizedEntry
      || !normalizedView
      || normalizedView.routeId !== expectedRouteId
      || !captured
      || captured.scopeKey !== activeScopeKey
      || captured.sessionId !== normalizedEntry.sessionId
      || captured.position !== normalizedEntry.position
      || captured.view.routeId !== expectedRouteId
    ) return Object.freeze({ ok: false, reason: "unavailable" });
    touch(views, normalizedEntry.entryId, Object.freeze({
      ...captured,
      view: normalizedView
    }), capacity);
    return Object.freeze({ ok: true, view: normalizedView });
  };

  const hasTrackedEntry = (entry) => {
    const normalizedEntry = normalizeEntry(entry);
    if (!activeScopeKey || !normalizedEntry) return false;
    const captured = views.get(normalizedEntry.entryId);
    if (
      captured?.scopeKey === activeScopeKey
      && captured.sessionId === normalizedEntry.sessionId
      && captured.position === normalizedEntry.position
    ) return true;
    return Array.from(contexts.values()).some((context) => (
      context.scopeKey === activeScopeKey
      && context.destinationEntry?.sessionId === normalizedEntry.sessionId
      && context.destinationEntry?.entryId === normalizedEntry.entryId
      && context.destinationEntry?.position === normalizedEntry.position
    ));
  };

  const parseDestination = ({ entry, state, route } = {}) => {
    const normalizedEntry = normalizeEntry(entry);
    const token = readWorkspaceReturnContextToken(state);
    const currentRoute = normalizeRouteLocation(route, DESTINATION_ROUTE_IDS);
    const context = token ? contexts.get(token.contextId) : null;
    if (
      !activeScopeKey
      || !normalizedEntry
      || !token
      || !currentRoute
      || !context
      || context.scopeKey !== activeScopeKey
      || !sameJson(context.token, token)
      || !sameJson(token.destination, currentRoute)
      || token.runtimeId !== normalizedEntry.sessionId
      || token.organizationId !== activeScope?.organizationId
      || token.principal.id !== activeScope?.principalId
      || token.principal.role !== activeScope?.role
      || context.destinationEntry?.entryId !== normalizedEntry.entryId
      || context.destinationEntry?.position !== normalizedEntry.position
    ) return Object.freeze({ ok: false, reason: "origin_unavailable" });
    return Object.freeze({ ok: true, token, context });
  };

  const resolveOrigin = (input = {}) => {
    const parsed = parseDestination(input);
    if (!parsed.ok) return parsed;
    const targetRouteId = boundedText(input.targetRouteId, 80);
    if (targetRouteId && !RETURNABLE_ROUTE_IDS.has(targetRouteId)) {
      return Object.freeze({ ok: false, reason: "origin_unavailable" });
    }
    let { token, context } = parsed;
    let delta = -1;
    for (let depth = 0; depth < 8; depth += 1) {
      if (
        token.origin.position !== context.destinationEntry.position - 1
        || token.origin.entryId !== context.originEntry.entryId
      ) return Object.freeze({ ok: false, reason: "origin_unavailable" });
      if (!targetRouteId || token.origin.routeId === targetRouteId) {
        return Object.freeze({
          ok: true,
          delta,
          routeId: token.origin.routeId,
          view: views.get(context.originEntry.entryId)?.view || null
        });
      }
      const originLocation = {
        routeId: token.origin.routeId,
        pathname: token.origin.pathname,
        search: token.origin.search
      };
      const parent = Array.from(contexts.values()).find((candidate) => (
        candidate.scopeKey === activeScopeKey
        && candidate.destinationEntry?.sessionId === context.originEntry.sessionId
        && candidate.destinationEntry?.entryId === context.originEntry.entryId
        && candidate.destinationEntry?.position === context.originEntry.position
        && sameJson(candidate.token.destination, originLocation)
        && candidate.token.runtimeId === context.originEntry.sessionId
        && candidate.token.organizationId === activeScope?.organizationId
        && candidate.token.principal.id === activeScope?.principalId
        && candidate.token.principal.role === activeScope?.role
      ));
      if (!parent) return Object.freeze({ ok: false, reason: "origin_unavailable" });
      token = parent.token;
      context = parent;
      delta -= 1;
    }
    return Object.freeze({ ok: false, reason: "origin_unavailable" });
  };

  const readDestination = (input = {}) => {
    const parsed = parseDestination(input);
    if (!parsed.ok || !parsed.context.destinationView) {
      return Object.freeze({ ok: false, reason: parsed.reason || "destination_unavailable" });
    }
    return Object.freeze({ ok: true, destination: parsed.context.destinationView });
  };

  return Object.freeze({
    clear,
    setScope,
    prepare,
    commit,
    readOriginView,
    updateOriginView,
    hasTrackedEntry,
    resolveOrigin,
    readDestination
  });
}

export function getWorkspaceReturnContextStore(windowObject) {
  if (!windowObject || (typeof windowObject !== "object" && typeof windowObject !== "function")) {
    return createWorkspaceReturnContextStore();
  }
  let store = runtimeStoreByWindow.get(windowObject);
  if (!store) {
    store = createWorkspaceReturnContextStore();
    runtimeStoreByWindow.set(windowObject, store);
  }
  return store;
}

export function restoreWorkspaceReturnViewport({
  focusTarget,
  scrollY = 0,
  settleFrames = 4,
  windowObject = typeof window !== "undefined" ? window : null
} = {}) {
  focusTarget?.focus?.({ preventScroll: true });
  if (!windowObject?.scrollTo) return () => {};
  const targetScrollY = Math.max(0, Number.isFinite(Number(scrollY)) ? Number(scrollY) : 0);
  const frameBudget = Math.min(8, Math.max(1, Math.trunc(Number(settleFrames) || 1)));
  let active = true;
  let frameId = null;
  let remaining = frameBudget;
  const align = () => {
    if (!active) return;
    windowObject.scrollTo({ top: targetScrollY, behavior: "auto" });
    remaining -= 1;
    if (remaining > 0 && typeof windowObject.requestAnimationFrame === "function") {
      frameId = windowObject.requestAnimationFrame(align);
    }
  };
  if (typeof windowObject.requestAnimationFrame === "function") {
    frameId = windowObject.requestAnimationFrame(align);
  } else {
    align();
  }
  return () => {
    active = false;
    if (frameId !== null) windowObject.cancelAnimationFrame?.(frameId);
  };
}

export const WORKSPACE_RETURN_CONTEXT_LIMITS = Object.freeze({
  clientDirectoryFilters: Object.freeze([...CLIENT_DIRECTORY_FILTERS]),
  quoteStatusFilters: Object.freeze([...QUOTE_STATUS_FILTERS])
});
