import { useEffect, useRef, useState } from "react";
import { getCustomerDirectoryPage } from "../lib/customerWorkspace";

const INITIAL_STATE = {
  loading: true,
  error: "",
  source: "",
  items: [],
  nextCursor: ""
};

export default function CustomerDirectoryView({ organizationId = "", onOpenCustomer, onNewQuote }) {
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
    <main className="container workspace-route-main" aria-labelledby="customer-directory-title">
      <section className="panel customer-directory">
        <div className="workspace-route-head">
          <div>
            <p className="eyebrow">Customers</p>
            <h1 id="customer-directory-title">Customer directory</h1>
            <p className="muted">Stable customer records connected to their canonical quotes and events.</p>
          </div>
          <button type="button" className="cta" onClick={onNewQuote}>New quote</button>
        </div>

        <form className="customer-directory-search" role="search" onSubmit={applySearch}>
          <label className="field">
            <span>Search by name or exact email prefix</span>
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="ghost">Search</button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setSearchDraft("");
              setSearch("");
              setCursor("");
              setCursorHistory([]);
            }}
          >
            Clear
          </button>
          <button type="button" className="ghost" onClick={() => setRefreshToken((value) => value + 1)}>
            Refresh
          </button>
        </form>

        <p className="source-note">Source: {state.source || (state.loading ? "loading" : "-")}</p>
        {state.loading && <p role="status" className="source-note">Loading customers...</p>}
        {state.error && <p role="alert" className="error-note">{state.error}</p>}
        {!state.loading && !state.error && state.items.length === 0 && (
          <p className="source-note">No customers match this directory view.</p>
        )}

        {state.items.length > 0 && (
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
                {state.items.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <button type="button" className="workspace-text-link" onClick={() => onOpenCustomer?.(customer.id)}>
                        {customer.name || customer.email || "Unnamed customer"}
                      </button>
                      {customer.company && <small>{customer.company}</small>}
                    </td>
                    <td>
                      <span>{customer.email || "No email"}</span>
                      {customer.phone && <small>{customer.phone}</small>}
                    </td>
                    <td>{customer.lastQuoteNumber || "-"}</td>
                    <td>{[customer.lastEventName, customer.lastEventDate].filter(Boolean).join(" · ") || "-"}</td>
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
          <button type="button" className="ghost" disabled={!cursorHistory.length || state.loading} onClick={openPreviousPage}>
            Previous
          </button>
          <button type="button" className="ghost" disabled={!state.nextCursor || state.loading} onClick={openNextPage}>
            Next
          </button>
        </div>
      </section>
    </main>
  );
}
