import { useEffect, useRef, useState } from "react";
import { getCustomerDirectoryPage } from "../lib/customerWorkspace";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import {
  formatWorkspaceDate,
  formatWorkspaceSource,
  formatWorkspaceText
} from "../lib/workspacePresentation";

const INITIAL_STATE = {
  loading: true,
  error: "",
  source: "",
  items: [],
  nextCursor: ""
};

export function CustomerDirectoryPresentation({
  state = INITIAL_STATE,
  searchDraft = "",
  cursorHistoryLength = 0,
  onSearchDraftChange,
  onApplySearch,
  onClear,
  onRefresh,
  onOpenCustomer,
  onNewQuote,
  onPreviousPage,
  onNextPage,
  headingRef = null
}) {
  const items = Array.isArray(state.items) ? state.items : [];
  const readState = state.loading
    ? "loading"
    : state.error
      ? "error"
      : items.length
        ? "success"
        : "empty";

  return (
    <main
      className="container workspace-route-main"
      aria-labelledby="customer-directory-title"
      data-capability-state={readState}
    >
      <section className="panel customer-directory">
        <div className="workspace-route-head">
          <div>
            <p className="eyebrow">Customers</p>
            <h1
              ref={headingRef}
              className="workspace-route-heading"
              tabIndex={-1}
              id="customer-directory-title">Customer directory</h1>
            <p className="muted">Stable customer records connected to their canonical quotes and events.</p>
          </div>
          <button type="button" className="cta" onClick={onNewQuote}>New quote</button>
        </div>

        <form className="customer-directory-search" role="search" onSubmit={onApplySearch}>
          <label className="field">
            <span>Search by name or exact email prefix</span>
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => onSearchDraftChange?.(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="ghost">Search</button>
          <button type="button" className="ghost" onClick={onClear}>Clear</button>
          <button
            type="button"
            className="ghost"
            data-capability-state={state.error ? "recovery" : undefined}
            onClick={onRefresh}
          >
            Refresh
          </button>
        </form>

        <p className="source-note">
          Source: {state.loading && !state.source ? "Loading tenant records" : formatWorkspaceSource(state.source)}
        </p>
        {state.loading && <p role="status" className="source-note">Loading customers...</p>}
        {state.error && <p role="alert" className="error-note">{state.error}</p>}
        {!state.loading && !state.error && items.length === 0 && (
          <p className="source-note">No customers match this directory view.</p>
        )}

        {items.length > 0 && (
          <div className="table-wrap">
            <table className="customer-directory-table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Last quote</th>
                  <th scope="col">Last event</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <button type="button" className="workspace-text-link" onClick={() => onOpenCustomer?.(customer.id)}>
                        {formatWorkspaceText(customer.name || customer.email, { emptyLabel: "Unnamed customer" })}
                      </button>
                      {customer.company && <small>{customer.company}</small>}
                    </td>
                    <td>
                      <span>{formatWorkspaceText(customer.email, { emptyLabel: "Email not recorded" })}</span>
                      {customer.phone && <small>{customer.phone}</small>}
                    </td>
                    <td>{formatWorkspaceText(customer.lastQuoteNumber, { emptyLabel: "No linked quote" })}</td>
                    <td>
                      {customer.lastEventName || customer.lastEventDate
                        ? [
                            formatWorkspaceText(customer.lastEventName, { emptyLabel: "Untitled event" }),
                            formatWorkspaceDate(customer.lastEventDate)
                          ].join(" · ")
                        : "No linked event"}
                    </td>
                    <td>
                      <button type="button" className="ghost compact" onClick={() => onOpenCustomer?.(customer.id)}>
                        Open 360
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="customer-directory-pagination" aria-label="Customer directory pages">
          <button type="button" className="ghost" disabled={!cursorHistoryLength || state.loading} onClick={onPreviousPage}>
            Previous
          </button>
          <button type="button" className="ghost" disabled={!state.nextCursor || state.loading} onClick={onNextPage}>
            Next
          </button>
        </div>
      </section>
    </main>
  );
}

export default function CustomerDirectoryView({ organizationId = "", onOpenCustomer, onNewQuote }) {
  const headingRef = useWorkspaceRouteHeadingFocus(true);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState(INITIAL_STATE);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setState((current) => ({ ...current, loading: true, error: "" }));
    getCustomerDirectoryPage({ organizationId, search, cursor })
      .then((result) => {
        if (generation !== generationRef.current) return;
        setState({ loading: false, error: "", ...result });
      })
      .catch((error) => {
        if (generation !== generationRef.current) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: error?.message || "Failed to load customers."
        }));
      });
    return () => {
      generationRef.current += 1;
    };
  }, [cursor, organizationId, refreshToken, search]);

  const applySearch = (event) => {
    event.preventDefault();
    setCursor("");
    setCursorHistory([]);
    setSearch(searchDraft.trim());
  };

  const openNextPage = () => {
    if (!state.nextCursor) return;
    setCursorHistory((current) => [...current, cursor]);
    setCursor(state.nextCursor);
  };

  const openPreviousPage = () => {
    setCursorHistory((current) => {
      if (!current.length) return current;
      setCursor(current.at(-1) || "");
      return current.slice(0, -1);
    });
  };

  return (
    <CustomerDirectoryPresentation
      state={state}
      searchDraft={searchDraft}
      cursorHistoryLength={cursorHistory.length}
      onSearchDraftChange={setSearchDraft}
      onApplySearch={applySearch}
      onClear={() => {
        setSearchDraft("");
        setSearch("");
        setCursor("");
        setCursorHistory([]);
      }}
      onRefresh={() => setRefreshToken((value) => value + 1)}
      onOpenCustomer={onOpenCustomer}
      onNewQuote={onNewQuote}
      onPreviousPage={openPreviousPage}
      onNextPage={openNextPage}
      headingRef={headingRef}
    />
  );
}
