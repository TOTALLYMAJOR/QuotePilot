import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getCustomerDirectoryPage } from "../lib/customerWorkspace";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";

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

export default function AmbientCustomerDirectoryView({
  organizationId = "",
  onOpenClientAmbient,
  onNewQuote,
  currentUserRole = "staff"
}) {
  const headingRef = useWorkspaceRouteHeadingFocus(true);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState(INITIAL_STATE);
  const generationRef = useRef(0);
  const readKey = `${String(organizationId || "").trim()}\u0000${search}\u0000${cursor}`;

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
        cursorHistoryLength={cursorHistory.length}
        currentUserRole={currentUserRole}
        onSearchDraftChange={setSearchDraft}
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
