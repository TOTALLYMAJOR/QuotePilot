import { useEffect, useMemo, useState } from "react";
import { currency } from "../lib/quoteCalculator";
import { getPortalQuote, updatePortalQuoteStatus } from "../lib/quoteStore";

function fmtDate(iso) {
  if (!iso) return "-";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString();
}

function formatError(err) {
  const message = String(err?.message || "Unable to load quote.");
  if (message.includes("not found") || message.toLowerCase().includes("expired")) {
    return "Quote link is invalid or expired.";
  }
  return message;
}

export default function CustomerPortalView({ initialPortalKey = "", onBackToStaff }) {
  const [portalKey, setPortalKey] = useState(initialPortalKey);
  const [state, setState] = useState({
    loading: false,
    busy: false,
    error: "",
    status: "",
    quote: null
  });

  const hasQuote = Boolean(state.quote);
  const eventLabel = useMemo(() => {
    const dateLabel = fmtDate(state.quote?.eventDate);
    const name = state.quote?.eventName || "Event";
    return `${name} on ${dateLabel}`;
  }, [state.quote]);

  const load = async (nextPortalKey = portalKey) => {
    const key = String(nextPortalKey || "").trim();
    if (!key) {
      setState((prev) => ({ ...prev, error: "Enter your quote link key." }));
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: "", status: "" }));
    try {
      const quote = await getPortalQuote(key);
      setState((prev) => ({
        ...prev,
        loading: false,
        quote,
        status: ""
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        quote: null,
        error: formatError(err)
      }));
    }
  };

  const applyStatus = async (status) => {
    if (!state.quote?.portalKey) return;
    setState((prev) => ({ ...prev, busy: true, error: "", status: "" }));
    try {
      await updatePortalQuoteStatus(state.quote.portalKey, status);
      const refreshed = await getPortalQuote(state.quote.portalKey);
      setState((prev) => ({
        ...prev,
        busy: false,
        quote: refreshed,
        status: `Quote marked ${status}.`
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        busy: false,
        error: formatError(err)
      }));
    }
  };

  useEffect(() => {
    if (initialPortalKey) {
      load(initialPortalKey);
    }
  }, [initialPortalKey]);

  return (
    <main className="portal-shell container">
      <section className="panel portal-card">
        <div className="portal-head">
          <h1>Customer Quote Portal</h1>
          <button type="button" className="ghost" onClick={onBackToStaff}>
            Staff Sign In
          </button>
        </div>
        <p className="muted">Review your quote, then accept or decline online.</p>

        <div className="portal-entry">
          <input
            type="text"
            value={portalKey}
            onChange={(e) => setPortalKey(e.target.value)}
            placeholder="Paste your quote key"
          />
          <button type="button" className="cta" onClick={() => load()} disabled={state.loading}>
            {state.loading ? "Loading..." : "Open Quote"}
          </button>
        </div>

        {state.error && <p className="error-note">{state.error}</p>}
        {state.status && <p className="source-note">{state.status}</p>}

        {hasQuote && (
          <article className="portal-quote">
            <h2>{state.quote.quoteNumber || "Quote"}</h2>
            <p>{eventLabel}</p>

            <dl className="kv-list totals">
              <div><dt>Customer</dt><dd>{state.quote.customerName || "-"}</dd></div>
              <div><dt>Status</dt><dd>{state.quote.status || "draft"}</dd></div>
              <div><dt>Total</dt><dd>{currency(state.quote.total || 0)}</dd></div>
              <div><dt>Deposit</dt><dd>{currency(state.quote.deposit || 0)}</dd></div>
              <div><dt>Expires</dt><dd>{fmtDate(state.quote.expiresAtISO)}</dd></div>
            </dl>

            <div className="portal-actions">
              <button
                type="button"
                className="cta"
                onClick={() => applyStatus("accepted")}
                disabled={state.busy || ["accepted", "declined", "booked"].includes(state.quote.status)}
              >
                Accept Quote
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => applyStatus("declined")}
                disabled={state.busy || ["accepted", "declined", "booked"].includes(state.quote.status)}
              >
                Decline Quote
              </button>
            </div>
          </article>
        )}
      </section>
    </main>
  );
}
