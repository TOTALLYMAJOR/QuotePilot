import { useEffect, useState } from "react";
import { currency } from "../lib/quoteCalculator";
import {
  getPortalQuote,
  updatePortalDecision,
  updatePortalQuoteStatus
} from "../lib/quoteStore";
import { sanitizeStripePaymentLink } from "../lib/paymentLink";

const PAYMENT_CONFIRMATION_POLL_INTERVAL_MS = 1500;
const PAYMENT_CONFIRMATION_MAX_ATTEMPTS = 10;
const DECISION_OPTIONS = [
  ["accepted", "Accept"],
  ["changes_requested", "Request Changes"],
  ["declined", "Decline"]
];
const PAYMENT_STATUS_LABELS = {
  unpaid: "Awaiting deposit",
  sent: "Deposit requested",
  paid: "Paid",
  refunded: "Refunded"
};

function paymentStatusLabel(depositStatus) {
  const normalized = String(depositStatus || "unpaid").trim().toLowerCase();
  return PAYMENT_STATUS_LABELS[normalized] || depositStatus;
}
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

export function getPaymentReturnMessage(
  paymentReturn,
  payment = {},
  paymentKindInput = "deposit"
) {
  const returnState = String(paymentReturn || "").trim().toLowerCase();
  const paymentKind = normalizePaymentReturnKind(paymentKindInput);
  const finalBalance = payment.finalBalance || {};
  const isFinalBalance = paymentKind === "final_balance";
  const depositStatus = String(payment.depositStatus || "").trim().toLowerCase();
  const paymentStatus = isFinalBalance
    ? String(finalBalance.status || "").trim().toLowerCase()
    : depositStatus;
  const checkoutState = String(
    isFinalBalance ? finalBalance.stripeCheckoutState : payment.stripeCheckoutState
  ).trim().toLowerCase();
  if (!new Set(["success", "cancelled"]).has(returnState)) return null;
  if (paymentStatus === "paid") {
    return {
      tone: "confirmed",
      text: isFinalBalance
        ? "Final balance confirmed. This status comes from Stripe's verified server notification."
        : "Deposit confirmed. This status comes from Stripe's verified server notification."
    };
  }
  if (!isFinalBalance && depositStatus === "refunded") {
    return {
      tone: "refunded",
      text: "The deposit is recorded as refunded in the verified payment record."
    };
  }
  if (checkoutState === "processing") {
    return {
      tone: "processing",
      text: isFinalBalance
        ? "Stripe reports that the final-balance payment is processing. Confirmation is not final yet; this page will refresh briefly."
        : "Stripe reports that this payment is processing. Deposit confirmation is not final yet; this page will refresh briefly."
    };
  }
  if (["failed", "expired"].includes(checkoutState)) {
    return {
      tone: "failed",
      text: isFinalBalance
        ? "Stripe did not confirm this final-balance payment. Contact the quote owner for a fresh request."
        : "Stripe did not confirm this payment. Contact the quote owner for a fresh payment request."
    };
  }
  if (returnState === "cancelled") {
    return {
      tone: "cancelled",
      text: isFinalBalance
        ? "You returned from final-balance checkout without verified confirmation. The current balance status appears below; you can return when you are ready."
        : "You returned without a verified payment confirmation. Your current payment status appears below; you can return when you are ready."
    };
  }
  return {
    tone: "processing",
    text: isFinalBalance
      ? "You returned from final-balance checkout, but no verified confirmation has been received. This page will refresh briefly."
      : "You returned from checkout, but no verified payment confirmation has been received. This page will refresh briefly."
  };
}
export function normalizePaymentReturnKind(value) {
  return String(value || "").trim().toLowerCase() === "final_balance"
    ? "final_balance"
    : "deposit";
}

export function readPaymentReturnKind(search = undefined) {
  const query = search === undefined && typeof window !== "undefined"
    ? window.location.search
    : String(search || "");
  return normalizePaymentReturnKind(new URLSearchParams(query).get("payment_kind"));
}

function finalBalanceStatusLabel(status) {
  const normalized = String(status || "unpaid").trim().toLowerCase();
  if (["unpaid", "not_started"].includes(normalized)) return "unpaid";
  if (normalized === "prepared") return "preparing checkout";
  if (normalized === "sent") return "awaiting payment";
  if (normalized === "processing") return "processing";
  if (normalized === "paid") return "paid";
  if (normalized === "failed") return "payment failed";
  if (normalized === "expired") return "payment link expired";
  return "unpaid";
}

export function getCustomerFinalBalanceUi(quote = {}) {
  const payment = quote.payment || {};
  const finalBalance = payment.finalBalance || {};
  const amountCents = Number(finalBalance.amountCents);
  const status = String(finalBalance.status || "unpaid").trim().toLowerCase();
  const checkoutState = String(finalBalance.stripeCheckoutState || "")
    .trim()
    .toLowerCase();
  const displayStatus = status === "paid"
    ? "paid"
    : ["prepared", "processing", "failed", "expired"].includes(checkoutState)
      ? checkoutState
      : status;
  const bookedContract = String(quote.status || "").trim().toLowerCase() === "booked"
    && Boolean(String(quote.booking?.contractNumber || "").trim());
  const visible = bookedContract && Number.isSafeInteger(amountCents) && amountCents > 0;
  const canPay = visible
    && String(payment.depositStatus || "").trim().toLowerCase() === "paid"
    && status === "sent"
    && ["", "open"].includes(checkoutState);
  return {
    visible,
    amountCents: visible ? amountCents : 0,
    currency: /^[a-z]{3}$/.test(String(finalBalance.currency || "").trim().toLowerCase())
      ? String(finalBalance.currency).trim().toLowerCase()
      : "usd",
    status,
    statusLabel: finalBalanceStatusLabel(displayStatus),
    confirmedAtISO: String(finalBalance.confirmedAtISO || "").trim(),
    paymentLink: canPay ? sanitizeStripePaymentLink(finalBalance.paymentLink) : ""
  };
}

function formatPaymentCents(amountCents, currencyCode) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currencyCode || "usd").toUpperCase()
    }).format(Number(amountCents || 0) / 100);
  } catch {
    return currency(Number(amountCents || 0) / 100);
  }
}

export default function CustomerPortalView({
  initialPortalKey = "",
  initialPaymentReturn = "",
  initialPaymentKind = "",
  onBackToStaff
}) {
  const [portalKey, setPortalKey] = useState(initialPortalKey);
  const [decisionDraft, setDecisionDraft] = useState("accepted");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [acceptanceConfirmed, setAcceptanceConfirmed] = useState(false);
  const [paymentConfirmation, setPaymentConfirmation] = useState({
    state: initialPaymentReturn === "success" ? "checking" : "idle",
    attempt: 0
  });
  const [state, setState] = useState({
    loading: false,
    busy: false,
    error: "",
    status: "",
    quote: null
  });

  const quote = state.quote;
  const brandName = String(quote?.quoteMeta?.brandName || "").trim();
  const portalTitle = brandName ? `Your proposal from ${brandName}` : "Your proposal";
  const eventLabel = `${quote?.eventName || "Event"} on ${fmtDate(quote?.eventDate)}`;
  const receipt = decisionReceipt(quote);
  const decisionLocked = ["accepted", "declined", "booked"].includes(quote?.status);
  const scope = quote?.selection || {};
  const totals = quote?.totals || {};
  const payment = quote?.payment || {};
  const approvedPaymentLink = sanitizeStripePaymentLink(payment.depositLink);
  const paymentReturnKind = initialPaymentKind
    ? normalizePaymentReturnKind(initialPaymentKind)
    : readPaymentReturnKind();
  const finalBalanceUi = getCustomerFinalBalanceUi(quote);

  const load = async (nextPortalKey = portalKey) => {
    const key = String(nextPortalKey || "").trim();
    if (!key) {
      setState((prev) => ({ ...prev, error: "Enter your quote link key." }));
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: "", status: "" }));
    try {
      let quote = await getPortalQuote(key);
      if (quote.status === "sent") {
        try {
          await updatePortalQuoteStatus(key, "viewed");
          quote = await getPortalQuote(key);
        } catch {
          // Staff sessions are intentionally not customer-view evidence. The
          // proposal remains readable even when rules reject that transition.
        }
      }
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
          : decisionDraft === "accepted"
            ? "Thanks — your acceptance is recorded."
            : "Your decline was recorded."
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

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previousTitle = document.title;
    document.title = portalTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [portalTitle]);

  useEffect(() => {
    if (!initialPaymentReturn || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("payment");
    url.searchParams.delete("payment_kind");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [initialPaymentReturn]);

  useEffect(() => {
    const returnedPayment = paymentReturnKind === "final_balance"
      ? payment.finalBalance || {}
      : payment;
    const paymentStatus = String(
      paymentReturnKind === "final_balance"
        ? returnedPayment.status
        : returnedPayment.depositStatus
    ).trim().toLowerCase();
    const checkoutState = String(returnedPayment.stripeCheckoutState || "")
      .trim()
      .toLowerCase();
    const shouldConfirm = initialPaymentReturn === "success"
      && quote?.portalKey
      && (!initialPortalKey || quote.portalKey === initialPortalKey);
    if (!shouldConfirm) return undefined;

    if (paymentStatus === "paid") {
      setPaymentConfirmation((previous) => (
        previous.state === "confirmed"
          ? previous
          : { ...previous, state: "confirmed" }
      ));
      return undefined;
    }

    if (["failed", "expired"].includes(checkoutState)) {
      setPaymentConfirmation((previous) => ({ ...previous, state: "failed" }));
      return undefined;
    }

    if (paymentConfirmation.attempt >= PAYMENT_CONFIRMATION_MAX_ATTEMPTS) {
      setPaymentConfirmation((previous) => (
        previous.state === "pending"
          ? previous
          : { ...previous, state: "pending" }
      ));
      return undefined;
    }

    setPaymentConfirmation((previous) => (
      previous.state === "checking"
        ? previous
        : { ...previous, state: "checking" }
    ));
    const key = quote.portalKey;
    const timer = window.setTimeout(async () => {
      try {
        const refreshed = await getPortalQuote(key);
        setState((previous) => (
          previous.quote?.portalKey === key
            ? { ...previous, quote: refreshed }
            : previous
        ));
      } catch {
        // Keep the last verified snapshot visible and retry within the bounded
        // confirmation window.
      } finally {
        setPaymentConfirmation((previous) => ({
          ...previous,
          attempt: previous.attempt + 1
        }));
      }
    }, PAYMENT_CONFIRMATION_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [
    initialPaymentReturn,
    initialPortalKey,
    paymentReturnKind,
    paymentConfirmation.attempt,
    payment.depositStatus,
    payment.stripeCheckoutState,
    payment.finalBalance?.status,
    payment.finalBalance?.stripeCheckoutState,
    quote?.portalKey
  ]);

  let paymentConfirmationMessage = "";
  if (paymentConfirmation.state === "checking") {
    paymentConfirmationMessage = "Stripe returned you after checkout. Confirming payment securely...";
  } else if (paymentConfirmation.state === "confirmed") {
    paymentConfirmationMessage = paymentReturnKind === "final_balance"
      ? "Payment confirmed. Your final balance is recorded as paid."
      : "Payment confirmed. Your deposit is recorded as paid.";
  } else if (paymentConfirmation.state === "pending") {
    paymentConfirmationMessage = "Payment confirmation is still processing. Refresh this page in a moment to see the recorded status.";
  } else if (paymentConfirmation.state === "failed") {
    paymentConfirmationMessage = "Stripe did not confirm this payment. Contact the quote owner for a fresh payment request.";
  }
  const paymentReturnMessage = getPaymentReturnMessage(
    initialPaymentReturn,
    payment,
    paymentReturnKind
  );

  const pricingRows = [
    ["Package", totals.base],
    ["Menu selections", totals.menu],
    ["Add-ons", totals.addons],
    ["Rentals", totals.rentals],
    ["Labor", totals.labor],
    ["Travel", totals.travel],
    ["Service charge", totals.serviceFee],
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
            <p className="eyebrow">Catering proposal</p>
            <h1>{portalTitle}</h1>
          </div>
        </div>

        {!quote && (!initialPortalKey || state.error || !state.loading) && (
          <div className="portal-entry">
            <input
              type="text"
              value={portalKey}
              onChange={(event) => setPortalKey(event.target.value)}
              placeholder="Paste your quote key"
              aria-label="Quote link key"
            />
            <button type="button" className="cta" onClick={() => load()} disabled={state.loading}>
              {state.loading ? "Loading..." : "Open Proposal"}
            </button>
          </div>
        )}
        {!quote && initialPortalKey && state.loading && (
          <p className="source-note" role="status">Loading your proposal...</p>
        )}

        {state.error && <p className="error-note">{state.error}</p>}
        {state.error && !quote && (
          <p className="source-note">
            If this link stopped working, contact {brandName || "your caterer"} to request a fresh proposal link.
          </p>
        )}
        {state.status && <p className="source-note">{state.status}</p>}
        {quote && paymentReturnMessage && (
          <p className={`portal-payment-return return-${paymentReturnMessage.tone}`} role="status">
            {paymentReturnMessage.text}
          </p>
        )}

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
                  <strong>{paymentStatusLabel(payment.depositStatus)}</strong>
                  {payment.depositConfirmedAtISO && <small>Confirmed {fmtDate(payment.depositConfirmedAtISO)}</small>}
                </div>
                {paymentConfirmationMessage && (
                  <p className="source-note" role="status" aria-live="polite">
                    {paymentConfirmationMessage}
                  </p>
                )}
                {approvedPaymentLink && ["accepted", "booked"].includes(quote.status) && payment.depositStatus !== "paid" && (
                  <a className="cta portal-pay-link" href={approvedPaymentLink} target="_blank" rel="noreferrer">
                    Pay Deposit
                  </a>
                )}
                {finalBalanceUi.visible && (
                  <div className="portal-payment-state">
                    <span>Final balance</span>
                    <strong>{formatPaymentCents(
                      finalBalanceUi.amountCents,
                      finalBalanceUi.currency
                    )}</strong>
                    <small>Status: {finalBalanceUi.statusLabel}</small>
                    {finalBalanceUi.confirmedAtISO && (
                      <small>Confirmed {fmtDate(finalBalanceUi.confirmedAtISO)}</small>
                    )}
                  </div>
                )}
                {finalBalanceUi.paymentLink && (
                  <a
                    className="cta portal-pay-link"
                    href={finalBalanceUi.paymentLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Pay Final Balance
                  </a>
                )}
                <p className="portal-expiry">
                  Proposal expires {fmtDate(
                    [quote.expiresAtISO, quote.portalExpiresAtISO]
                      .map((value) => String(value || "").trim())
                      .filter(Boolean)
                      .sort()[0] || ""
                  )}
                </p>
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
      <p className="portal-staff-entry">
        <button type="button" className="ghost" onClick={onBackToStaff}>Staff sign in</button>
      </p>
    </main>
  );
}
