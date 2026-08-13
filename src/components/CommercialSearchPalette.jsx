import { useCallback, useEffect, useRef, useState } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import {
  COMMERCIAL_SEARCH_CUSTOMER_LIMIT,
  COMMERCIAL_SEARCH_MIN_QUERY_LENGTH,
  COMMERCIAL_SEARCH_QUOTE_READ_LIMIT,
  COMMERCIAL_SEARCH_QUOTE_RESULT_LIMIT,
  createCommercialSearchGenerationGuard,
  normalizeCommercialSearchQuery,
  searchCommercialWorkspace
} from "../lib/commercialSearch";
import { formatWorkspaceSource } from "../lib/workspacePresentation";

const SEARCH_DEBOUNCE_MS = 180;

function initialSearchState() {
  return {
    status: "empty",
    source: "",
    results: [],
    reads: {
      customers: { status: "not-requested", source: "", truncated: false },
      quotes: { status: "not-requested", source: "", truncated: false }
    },
    partialReasons: [],
    truncated: false
  };
}

function readSourceLabel(read = {}, { loading = false } = {}) {
  if (loading) return "Loading";
  if (read.status === "error") return "Unavailable";
  if (read.status === "not-requested") return "Waiting for a search";
  return formatWorkspaceSource(read.source);
}

function partialDescription(state = {}) {
  const reasons = Array.isArray(state.partialReasons) ? state.partialReasons : [];
  const unavailable = reasons.some((reason) => reason.endsWith("-unavailable"));
  const capped = reasons.some((reason) => reason.endsWith("-capped"));
  if (unavailable && capped) {
    return "One search source is unavailable and at least one bounded result window was reached.";
  }
  if (unavailable) return "One search source is unavailable; available matches remain actionable.";
  return "At least one bounded result window was reached; older or additional matches may exist.";
}

export function CommercialSearchPaletteContent({
  query = "",
  state = initialSearchState(),
  onQueryChange = () => {},
  onSubmit = () => {},
  onRetry = () => {},
  onClose = () => {},
  onSelectResult = () => {},
  dialogRef = null,
  inputRef = null
}) {
  const normalizedQuery = normalizeCommercialSearchQuery(query);
  const status = ["loading", "empty", "success", "partial", "error"].includes(state.status)
    ? state.status
    : "error";
  const results = Array.isArray(state.results) ? state.results : [];
  const searchStarted = normalizedQuery.length >= COMMERCIAL_SEARCH_MIN_QUERY_LENGTH;
  const canRetry = status === "partial" || status === "error";

  return (
    <div
      className="modal-overlay commercial-search-overlay"
      data-layout-overlap-allowed="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-card commercial-search-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commercial-search-title"
        aria-describedby="commercial-search-bounds"
        tabIndex={-1}
        data-capability-state={status}
      >
        <header className="commercial-search-head">
          <div>
            <p className="eyebrow">Workspace search</p>
            <h2 id="commercial-search-title">Find a customer or quote</h2>
            <p className="muted">Jump to an existing staff record without leaving a draft behind.</p>
          </div>
          <button type="button" className="ghost compact" onClick={onClose}>Close</button>
        </header>

        <form className="commercial-search-form" role="search" onSubmit={onSubmit}>
          <label className="field" htmlFor="commercial-search-query">
            <span>Customer name, email prefix, quote number, or event</span>
            <input
              ref={inputRef}
              id="commercial-search-query"
              type="search"
              value={query}
              maxLength={120}
              autoComplete="off"
              spellCheck="false"
              aria-controls="commercial-search-results"
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </label>
          <button type="submit" className="ghost">Search</button>
        </form>

        <p
          className="commercial-search-source source-note"
          data-capability-state="source"
        >
          Sources: customer directory — {readSourceLabel(state.reads?.customers, { loading: status === "loading" })}; recent quotes — {readSourceLabel(state.reads?.quotes, { loading: status === "loading" })}.
        </p>
        <p id="commercial-search-bounds" className="commercial-search-bounds source-note">
          Bounded search: first {COMMERCIAL_SEARCH_CUSTOMER_LIMIT} customer-prefix matches and up to {COMMERCIAL_SEARCH_QUOTE_RESULT_LIMIT} matches from the latest {COMMERCIAL_SEARCH_QUOTE_READ_LIMIT} quote records.
        </p>

        <div
          id="commercial-search-results"
          className="commercial-search-outcome"
          aria-live="polite"
          data-capability-state={status}
        >
          {status === "loading" && (
            <p role="status" className="commercial-search-message">Searching bounded staff records...</p>
          )}

          {status === "empty" && (
            <p className="commercial-search-message">
              {searchStarted
                ? "No customer or recent quote matches were found in the bounded search."
                : `Type at least ${COMMERCIAL_SEARCH_MIN_QUERY_LENGTH} characters to search.`}
            </p>
          )}

          {status === "partial" && (
            <p role="status" className="commercial-search-message commercial-search-partial">
              {partialDescription(state)}
            </p>
          )}

          {status === "error" && (
            <p role="alert" className="commercial-search-message error-note">
              Workspace search could not read either bounded source. Try again.
            </p>
          )}

          {results.length > 0 && (
            <ul className="commercial-search-results" aria-label="Workspace search results">
              {results.map((result) => (
                <li key={`${result.kind}:${result.id}`}>
                  <button
                    type="button"
                    className="commercial-search-result"
                    onClick={() => onSelectResult(result)}
                    aria-label={`Open ${result.kind} ${result.title}`}
                  >
                    <span className="commercial-search-result-kind">{result.kind}</span>
                    <strong>{result.title}</strong>
                    {result.detail && <small>{result.detail}</small>}
                    <span className="commercial-search-result-action" aria-hidden="true">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {canRetry && (
            <button
              type="button"
              className="ghost commercial-search-retry"
              data-capability-state="recovery"
              onClick={onRetry}
            >
              Retry search
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export default function CommercialSearchPalette({
  open = false,
  organizationId = "",
  onClose = () => {},
  onOpenCustomer = () => {},
  onOpenQuote = () => {},
  returnFocusRef = null,
  search = searchCommercialWorkspace
}) {
  const inputRef = useRef(null);
  const generationGuardRef = useRef(null);
  if (!generationGuardRef.current) {
    generationGuardRef.current = createCommercialSearchGenerationGuard();
  }
  const [query, setQuery] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState(initialSearchState);
  const requestClose = useCallback(() => {
    generationGuardRef.current.invalidate();
    onClose();
  }, [onClose]);
  const { dialogRef } = useModalDialog({
    open,
    onRequestClose: requestClose,
    initialFocusRef: inputRef,
    returnFocusRef
  });

  useEffect(() => {
    if (open) return;
    generationGuardRef.current.invalidate();
    setQuery("");
    setRetryToken(0);
    setState(initialSearchState());
  }, [open, organizationId]);

  useEffect(() => {
    if (!open) return undefined;
    const normalizedQuery = normalizeCommercialSearchQuery(query);
    const generation = generationGuardRef.current.next();

    if (normalizedQuery.length < COMMERCIAL_SEARCH_MIN_QUERY_LENGTH) {
      setState(initialSearchState());
      return undefined;
    }

    setState({
      ...initialSearchState(),
      status: "loading"
    });
    const timer = window.setTimeout(() => {
      search({ organizationId, query: normalizedQuery })
        .then((result) => {
          generationGuardRef.current.commit(generation, () => setState(result));
        })
        .catch(() => {
          generationGuardRef.current.commit(generation, () => {
            setState({
              ...initialSearchState(),
              status: "error",
              reads: {
                customers: { status: "error", source: "", truncated: false },
                quotes: { status: "error", source: "", truncated: false }
              }
            });
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [open, organizationId, query, retryToken, search]);

  if (!open) return null;

  const handleSelectResult = (result) => {
    requestClose();
    if (result.kind === "customer") onOpenCustomer(result.id);
    if (result.kind === "quote") onOpenQuote(result.id);
  };

  return (
    <CommercialSearchPaletteContent
      query={query}
      state={state}
      dialogRef={dialogRef}
      inputRef={inputRef}
      onQueryChange={setQuery}
      onSubmit={(event) => {
        event.preventDefault();
        if (normalizeCommercialSearchQuery(query).length >= COMMERCIAL_SEARCH_MIN_QUERY_LENGTH) {
          setRetryToken((token) => token + 1);
        }
      }}
      onRetry={() => setRetryToken((token) => token + 1)}
      onClose={requestClose}
      onSelectResult={handleSelectResult}
    />
  );
}
