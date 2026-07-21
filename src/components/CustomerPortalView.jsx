import { useEffect, useState } from "react";
import { currency } from "../lib/quoteCalculator";
import { getPortalQuote, updatePortalDecision } from "../lib/quoteStore";

const DECISION_OPTIONS = [
  ["accepted", "Accept"],
  ["changes_requested", "Request Changes"],
  ["declined", "Decline"]
];

function fmtDate(iso) {
  if (!iso) return "-";
  const raw = String(iso).trim();
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function fmtTime(value) {
  if (!value) return "-";
  const dt = new Date(`2000-01-01T${value}`);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatError(err) {
  const message = String(err?.message || "Unable to load quote.");
  if (message.includes("not found") || message.toLowerCase().includes("expired")) {
    return "Quote link is invalid or expired.";
  }
  return message;
}

function decisionReceipt(quote) {
  const decision = quote?.portalDecision?.decision;
  if (quote?.status === "booked") {
    return {
      tone: "booked",
      title: "Event booked",
      body: quote.booking?.confirmationStatus === "confirmed"
        ? "Your booking is confirmed."
        : "Your contract is booked; staff confirmation is still pending."
    };
  }
  if (decision === "accepted" || quote?.status === "accepted") {
    return {
      tone: "accepted",
      title: "Proposal accepted",
      body: "Acceptance is recorded. Payment and booking confirmation remain separate steps."
    };
  }
  if (decision === "declined" || quote?.status === "declined") {
    return {
      tone: "declined",
      title: "Proposal declined",
      body: "Your decision is recorded."
    };
  }
  if (decision === "changes_requested") {
    return {
      tone: "changes",
      title: "Changes requested",
      body: "Your current proposal remains unaccepted while staff reviews your note."
    };
  }
  return {
    tone: "pending",
    title: "Decision pending",
    body: "Review the event scope and pricing before submitting your decision."
  };
}

export default function CustomerPortalView({ initialPortalKey = "", onBackToStaff }) {
  const [portalKey, setPortalKey] = useState(initialPortalKey);
  const [decisionDraft, setDecisionDraft] = useState("accepted");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [acceptanceConfirmed, setAcceptanceConfirmed] = useState(false);
  const [state, setState] = useState({
    loading: false,
    busy: false,
    error: "",
    status: "",
    quote: null
  });

  const quote = state.quote;
  const eventLabel = `${quote?.eventName || "Event"} on ${fmtDate(quote?.eventDate)}`;
  const receipt = decisionReceipt(quote);
  const decisionLocked = ["accepted", "declined", "booked"].includes(quote?.status);
  const scope = quote?.selection || {};
  const totals = quote?.totals || {};
  const payment = quote?.payment || {};

  const load = async (nextPortalKey = portalKey) => {
    const key = String(nextPortalKey || "").trim();
    if (!key) {
      setState((prev) => ({ ...prev, error: "Enter your quote link key." }));
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: "", status: "" }));
    try {
      const quote = await getPortalQuote(key);
      setPortalKey(key);
      setDecisionDraft(quote.portalDecision?.decision || "accepted");
      setDecisionMessage(quote.portalDecision?.message || "");
      setAcceptanceConfirmed(false);
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

  const submitDecision = async () => {
    if (!quote?.portalKey || decisionLocked) return;
    if (decisionDraft === "accepted" && !acceptanceConfirmed) {
      setState((prev) => ({ ...prev, error: "Confirm that you reviewed the event details and total." }));
      return;
    }
    if (decisionDraft === "changes_requested" && !decisionMessage.trim()) {
      setState((prev) => ({ ...prev, error: "Describe the changes you would like staff to review." }));
      return;
    }

    setState((prev) => ({ ...prev, busy: true, error: "", status: "" }));
    try {
      await updatePortalDecision({
        portalKey: quote.portalKey,
        decision: decisionDraft,
        message: decisionMessage
      });
      const refreshed = await getPortalQuote(quote.portalKey);
      setState((prev) => ({
        ...prev,
        busy: false,
        quote: refreshed,
        status: decisionDraft === "changes_requested"
          ? "Your change request was submitted."
          : `Your ${decisionDraft} decision was submitted.`
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
    if (initialPortalKey) load(initialPortalKey);
  }, [initialPortalKey]);

  const pricingRows = [
    ["Package", totals.base],
    ["Menu selections", totals.menu],
    ["Add-ons", totals.addons],
    ["Rentals", totals.rentals],
    ["Labor", totals.labor],
    ["Travel", totals.travel],
    ["Service fee", totals.serviceFee],
    ["Tax", totals.tax]
  ].filter(([, amount]) => Number(amount || 0) !== 0);
  const eventRows = [
    ["Date", fmtDate(quote?.eventDate)],
    ["Time", fmtTime(quote?.eventTime)],
    ["Guests", quote?.eventGuests || "-"],
    ["Duration", quote?.eventHours ? `${quote.eventHours} hours` : "-"],
    ["Venue", quote?.venue || "-"],
    ["Service", quote?.eventStyle || "-"]
  ];
  const scopeRows = [
    ["Menu", scope.menuItems],
    ["Add-ons", scope.addons],
    ["Rentals", scope.rentals]
  ].filter(([, items]) => items?.length > 0);

  return (
    <main className="portal-shell container">
      <section className="panel portal-card">
        <div className="portal-head">
          <div>
            <p className="eyebrow">{quote?.quoteMeta?.brandName || "Customer Portal"}</p>
            <h1>Proposal Decision Center</h1>
          </div>
          <button type="button" className="ghost" onClick={onBackToStaff}>Staff Sign In</button>
        </div>

        <div className="portal-entry">
          <input
            type="text"
            value={portalKey}
            onChange={(event) => setPortalKey(event.target.value)}
            placeholder="Paste your quote key"
          />
          <button type="button" className="cta" onClick={() => load()} disabled={state.loading}>
            {state.loading ? "Loading..." : "Open Proposal"}
          </button>
        </div>

        {state.error && <p className="error-note">{state.error}</p>}
        {state.status && <p className="source-note">{state.status}</p>}

        {quote && (
          <div className="portal-decision-layout">
            <header className="portal-proposal-header">
              <div>
                <span>{quote.quoteNumber || "Proposal"}</span>
                <h2>{eventLabel}</h2>
                <p>{quote.customerName || "Customer"}</p>
              </div>
              <div className={`portal-decision-receipt receipt-${receipt.tone}`}>
                <strong>{receipt.title}</strong>
                <span>{receipt.body}</span>
              </div>
            </header>

            <div className="portal-content-grid">
              <section className="portal-detail-section">
                <h3>Event details</h3>
                <dl className="portal-detail-grid">
                  {eventRows.map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                  ))}
                </dl>
                {quote.venueAddress && <p className="portal-address">{quote.venueAddress}</p>}
                <div className="portal-scope-block">
                  <h4>{scope.packageName || "Catering package"}</h4>
                  {scopeRows.map(([label, items]) => (
                    <div key={label}><span>{label}</span><p>{items.join(", ")}</p></div>
                  ))}
                  <div>
                    <span>Dietary notes</span>
                    <p>{quote.dietaryRestrictions || "None provided"}</p>
                  </div>
                </div>
              </section>

              <section className="portal-detail-section portal-pricing-section">
                <h3>Pricing</h3>
                <dl className="portal-price-list">
                  {pricingRows.map(([label, amount]) => (
                    <div key={label}><dt>{label}</dt><dd>{currency(amount || 0)}</dd></div>
                  ))}
                  <div className="portal-price-total"><dt>Total</dt><dd>{currency(quote.total || 0)}</dd></div>
                  <div className="portal-price-deposit"><dt>Deposit</dt><dd>{currency(quote.deposit || 0)}</dd></div>
                </dl>
                <div className="portal-payment-state">
                  <span>Payment status</span>
                  <strong>{payment.depositStatus || "unpaid"}</strong>
                  {payment.depositConfirmedAtISO && <small>Confirmed {fmtDate(payment.depositConfirmedAtISO)}</small>}
                </div>
                {payment.depositLink && ["accepted", "booked"].includes(quote.status) && payment.depositStatus !== "paid" && (
                  <a className="cta portal-pay-link" href={payment.depositLink} target="_blank" rel="noreferrer">
                    Pay Deposit
                  </a>
                )}
                <p className="portal-expiry">Proposal expires {fmtDate(quote.expiresAtISO)}</p>
              </section>
            </div>

            {!decisionLocked && (
              <section className="portal-decision-panel">
                <h3>Your decision</h3>
                <div className="portal-decision-options" role="group" aria-label="Proposal decision">
                  {DECISION_OPTIONS.map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={decisionDraft === value ? "active" : ""}
                      aria-pressed={decisionDraft === value}
                      onClick={() => setDecisionDraft(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="field portal-decision-note">
                  <span>{decisionDraft === "changes_requested" ? "Requested changes" : "Note to staff (optional)"}</span>
                  <textarea
                    rows="4"
                    maxLength="1200"
                    value={decisionMessage}
                    onChange={(event) => setDecisionMessage(event.target.value)}
                    placeholder={decisionDraft === "changes_requested" ? "Describe what should be revised" : "Add any context for the catering team"}
                  />
                </label>
                {decisionDraft === "accepted" && (
                  <label className="portal-accept-confirmation">
                    <input
                      type="checkbox"
                      checked={acceptanceConfirmed}
                      onChange={(event) => setAcceptanceConfirmed(event.target.checked)}
                    />
                    <span>I reviewed the event details and proposal total.</span>
                  </label>
                )}
                <div className="portal-decision-submit">
                  <button type="button" className="cta" onClick={submitDecision} disabled={state.busy}>
                    {state.busy ? "Submitting..." : "Submit Decision"}
                  </button>
                </div>
              </section>
            )}

            {quote.portalDecision?.message && decisionLocked && (
              <section className="portal-decision-note-receipt">
                <span>Your note</span>
                <p>{quote.portalDecision.message}</p>
              </section>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
