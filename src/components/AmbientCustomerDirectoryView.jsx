import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getCustomerDirectoryPage } from "../lib/customerWorkspace";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import {
  useOptionalWorkspaceNavigation,
  useWorkspaceReturnContextAdapter
} from "../context/WorkspaceNavigationContext";
import {
  restoreWorkspaceReturnViewport,
  WORKSPACE_RETURN_CONTEXT_LIMITS
} from "../lib/workspaceReturnContext";
import { WORKSPACE_PATHS } from "../lib/workspaceRoutes";

const AmbientClientsDirectoryHost = lazy(() => import("./AmbientClientsView").then((module) => ({
  default: module.AmbientClientsDirectoryHost
})));

const INITIAL_STATE = Object.freeze({
  loading: true,
  error: "",
  source: "",
  items: [],
  nextCursor: "",
  loadedAt: 0,
  stale: false,
  readKey: ""
});

const DIRECTORY_FILTERS = new Set(WORKSPACE_RETURN_CONTEXT_LIMITS.clientDirectoryFilters);

function directoryLocationFromSearch(search = "") {
  const rawSearch = String(search || "");
  const query = rawSearch.replace(/^\?/u, "");
  const params = new URLSearchParams(query);
  const requestedViews = params.getAll("view");
  const directoryFilter = requestedViews.length === 1 && DIRECTORY_FILTERS.has(requestedViews[0])
    ? requestedViews[0]
    : "all";
  const canonicalSearch = directoryFilter === "all"
    ? ""
    : `?view=${encodeURIComponent(directoryFilter)}`;
  const currentSearch = query ? `?${query}` : "";
  return {
    directoryFilter,
    canonicalSearch,
    needsCanonicalization: currentSearch !== canonicalSearch
  };
}

function ScopedAmbientCustomerDirectoryView({
  organizationId = "",
  onOpenClientAmbient,
  onNewQuote,
  currentUserRole = "staff"
}) {
  const navigation = useOptionalWorkspaceNavigation();
  const headingRef = useWorkspaceRouteHeadingFocus(true);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState([]);
  const returnRestoreCancelRef = useRef(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [directoryFilter, setDirectoryFilter] = useState(() => (
    directoryLocationFromSearch(navigation?.location?.search).directoryFilter
  ));
  const [aboutOpen, setAboutOpen] = useState(false);
  const [state, setState] = useState(INITIAL_STATE);
  const stateRef = useRef(INITIAL_STATE);
  const generationRef = useRef(0);
  const readKey = `${String(organizationId || "").trim()}\u0000${search}\u0000${cursor}`;
  stateRef.current = state;

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setState((current) => current.readKey === readKey
      ? { ...current, loading: true, error: "", stale: false }
      : { ...INITIAL_STATE, readKey });
    getCustomerDirectoryPage({ organizationId, search, cursor })
      .then((result) => {
        if (generation !== generationRef.current) return;
        setState({
          loading: false,
          error: "",
          stale: false,
          loadedAt: Date.now(),
          readKey,
          ...result
        });
      })
      .catch((error) => {
        if (generation !== generationRef.current) return;
        setState((current) => ({
          ...(current.readKey === readKey ? current : { ...INITIAL_STATE, readKey }),
          loading: false,
          stale: current.readKey === readKey && Number(current.loadedAt) > 0,
          error: error?.message || "Failed to load clients."
        }));
      });
    return () => {
      generationRef.current += 1;
    };
  }, [cursor, organizationId, readKey, refreshToken, search]);

  const navigationSearch = navigation?.location?.search || "";
  const navigationReplace = navigation?.replace;
  useEffect(() => {
    const nextLocation = directoryLocationFromSearch(navigationSearch);
    setDirectoryFilter(nextLocation.directoryFilter);
    if (!nextLocation.needsCanonicalization || typeof navigationReplace !== "function") return;
    navigationReplace(`${WORKSPACE_PATHS.customers}${nextLocation.canonicalSearch}`, {
      state: navigation?.location?.state ?? null,
      preserveSearch: false,
      preserveHash: false
    });
  }, [navigation?.location?.state, navigationReplace, navigationSearch]);

  const changeDirectoryFilter = useCallback((nextFilter) => {
    const normalized = DIRECTORY_FILTERS.has(nextFilter) ? nextFilter : "all";
    setDirectoryFilter(normalized);
    if (typeof navigation?.replace !== "function") return;
    const destination = normalized === "all"
      ? WORKSPACE_PATHS.customers
      : `${WORKSPACE_PATHS.customers}?view=${encodeURIComponent(normalized)}`;
    navigation.replace(destination, {
      state: navigation.location?.state ?? null,
      preserveSearch: false,
      preserveHash: false
    });
  }, [navigation]);

  const captureClientReturnView = useCallback((hint = {}) => {
    const root = headingRef.current?.closest(".ambient-clients");
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    let focus = hint?.focus && typeof hint.focus === "object" ? hint.focus : null;
    if (!focus && activeElement && root?.contains(activeElement)) {
      const row = activeElement.closest?.("[data-client-id]");
      const actionId = activeElement.dataset?.ambientActionId || "";
      if (row?.dataset.clientId && actionId) {
        focus = { kind: "client-action", objectId: row.dataset.clientId, actionId };
      } else if (activeElement.matches?.('[data-view-filter="client-relationship"]')) {
        focus = { kind: "client-filter", controlId: "client-relationship" };
      } else if (activeElement.matches?.('input[type="search"]')) {
        focus = { kind: "client-search", controlId: "client-search" };
      }
    }
    return {
      routeId: "customer-list",
      structured: { directoryFilter, order: "recorded-event" },
      transient: { searchDraft, search, cursor, cursorHistory },
      disclosureIds: aboutOpen ? ["about"] : [],
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      focus: focus || { kind: "route-heading" }
    };
  }, [aboutOpen, cursor, cursorHistory, directoryFilter, headingRef, search, searchDraft]);

  const restoreClientReturnView = useCallback((view) => {
    returnRestoreCancelRef.current?.();
    setDirectoryFilter(DIRECTORY_FILTERS.has(view?.structured?.directoryFilter)
      ? view.structured.directoryFilter
      : "all");
    const restoredSearchDraft = String(view?.transient?.searchDraft || "");
    const restoredSearch = String(view?.transient?.search || "");
    const restoredCursor = String(view?.transient?.cursor || "");
    const expectedReadKey = `${String(organizationId || "").trim()}\u0000${restoredSearch}\u0000${restoredCursor}`;
    setSearchDraft(restoredSearchDraft);
    setSearch(restoredSearch);
    setCursor(restoredCursor);
    setCursorHistory(Array.isArray(view?.transient?.cursorHistory)
      ? [...view.transient.cursorHistory]
      : []);
    setAboutOpen(view?.disclosureIds?.includes("about") || false);
    return new Promise((resolve) => {
      let attempt = 0;
      let active = true;
      let settled = false;
      let frameId = null;
      let cancelViewport = null;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        resolve({ status });
      };
      const cancel = () => {
        active = false;
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        cancelViewport?.();
        finish("cancelled");
      };
      returnRestoreCancelRef.current = cancel;
      const restoreRenderedView = () => {
        if (!active) return;
        const root = headingRef.current?.closest(".ambient-clients");
        const readSettled = stateRef.current.readKey === expectedReadKey
          && stateRef.current.loading === false;
        const focus = view?.focus || {};
        let target = null;
        if (focus.kind === "client-action") {
          target = Array.from(root?.querySelectorAll("[data-ambient-action-id]") || []).find((element) => (
            element.dataset.ambientActionId === focus.actionId
            && element.closest("[data-client-id]")?.dataset.clientId === focus.objectId
          ));
        } else if (focus.kind === "client-filter") {
          target = root?.querySelector('[data-view-filter="client-relationship"]');
        } else if (focus.kind === "client-search") {
          target = root?.querySelector('input[type="search"]');
        } else {
          target = headingRef.current;
        }
        if (!readSettled) {
          frameId = window.requestAnimationFrame(restoreRenderedView);
          return;
        }
        if (!target && attempt < 30) {
          attempt += 1;
          frameId = window.requestAnimationFrame(restoreRenderedView);
          return;
        }
        frameId = null;
        const exactTarget = Boolean(target && readSettled);
        cancelViewport = restoreWorkspaceReturnViewport({
          focusTarget: target || headingRef.current,
          scrollY: view?.scrollY
        });
        finish(exactTarget ? "restored" : "recovery");
      };
      if (typeof window !== "undefined") {
        frameId = window.requestAnimationFrame(restoreRenderedView);
      } else {
        finish("recovery");
      }
    });
  }, [headingRef, organizationId]);

  useEffect(() => () => {
    returnRestoreCancelRef.current?.();
  }, []);

  useWorkspaceReturnContextAdapter({
    routeId: "customer-list",
    active: true,
    capture: captureClientReturnView,
    restore: restoreClientReturnView
  });

  const clear = () => {
    setSearchDraft("");
    setSearch("");
    setCursor("");
    setCursorHistory([]);
  };
  const visibleState = state.readKey === readKey
    ? state
    : { ...INITIAL_STATE, readKey };

  return (
    <Suspense fallback={<main className="container workspace-route-main" role="status">Loading Clients…</main>}>
      <AmbientClientsDirectoryHost
        state={visibleState}
        organizationId={organizationId}
        searchDraft={searchDraft}
        directoryFilter={directoryFilter}
        aboutOpen={aboutOpen}
        cursorHistoryLength={cursorHistory.length}
        currentUserRole={currentUserRole}
        onSearchDraftChange={setSearchDraft}
        onDirectoryFilterChange={changeDirectoryFilter}
        onAboutOpenChange={setAboutOpen}
        onApplySearch={(event) => {
          event.preventDefault();
          setCursor("");
          setCursorHistory([]);
          setSearch(searchDraft.trim());
        }}
        onClear={clear}
        onRefresh={() => setRefreshToken((value) => value + 1)}
        onOpenClient={onOpenClientAmbient}
        onStartOpportunity={onNewQuote}
        onPreviousPage={() => setCursorHistory((current) => {
          if (!current.length) return current;
          setCursor(current.at(-1) || "");
          return current.slice(0, -1);
        })}
        onNextPage={() => {
          if (!state.nextCursor) return;
          setCursorHistory((current) => [...current, cursor]);
          setCursor(state.nextCursor);
        }}
        headingRef={headingRef}
      />
    </Suspense>
  );
}

export default function AmbientCustomerDirectoryView(props) {
  const organizationId = String(props.organizationId || "").trim();
  return (
    <ScopedAmbientCustomerDirectoryView
      key={organizationId || "organization-unavailable"}
      {...props}
      organizationId={organizationId}
    />
  );
}
