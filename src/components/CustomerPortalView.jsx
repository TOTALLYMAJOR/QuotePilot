import { useEffect, useRef, useState } from "react";
import { currency, serviceChargeLabel } from "../lib/quoteCalculator";
import {
  getPortalQuote,
  PROPOSAL_ACCEPTANCE_CONSENT_VERSION,
  updatePortalDecision,
  updatePortalQuoteStatus
} from "../lib/quoteStore";
import { sanitizeStripePaymentLink } from "../lib/paymentLink";
import { getPortalRecoveryContact } from "../lib/portalRecoveryClient";
import { buildPortalThemeStyle } from "../data/portalThemePresets";
import { portalConversationAvailable } from "../lib/portalConversationClient";
import ProductBrandLockup from "./ProductBrandLockup";
import QuoteConversationPanel from "./QuoteConversationPanel";
import ShimmerReveal from "./ShimmerReveal";
import { playCue } from "./soundKit";
import "./portalCeremony.css";

const PAYMENT_CONFIRMATION_POLL_INTERVAL_MS = 1500;
const PAYMENT_CONFIRMATION_MAX_ATTEMPTS = 10;
const PORTAL_DECISION_PHASES = new Set([
  "ready",
  "submitting",
  "uncertain",
  "reconciliation",
  "receipt",
  "stale",
  "error"
]);
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
const ACCEPTED_PORTAL_STATUSES = new Set(["accepted", "booked"]);
// Longest ceremony run: ShimmerReveal self-cleans at ~1520ms; ceremony classes
// are removed just after so every one-shot effect leaves no residue.
const PORTAL_CEREMONY_SETTLE_MS = 1600;

function paymentStatusLabel(depositStatus) {
  const normalized = String(depositStatus || "unpaid").trim().toLowerCase();
  return PAYMENT_STATUS_LABELS[normalized] || depositStatus;
}

function humanizeValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "-";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeLogoUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

function safePhone(value) {
  const normalized = String(value || "").trim().slice(0, 40);
  return /^[+\d().\s-]{7,40}$/.test(normalized) ? normalized : "";
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

function fmtDateTime(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
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
        ? "You're all set—your caterer has confirmed the booking."
        : "Your caterer has your approval and will confirm the final booking details with you."
    };
  }
  if (decision === "accepted" || quote?.status === "accepted") {
    return {
      tone: "accepted",
      title: "Thank you—we have your approval",
      body: "Your caterer will follow up with booking details. A deposit payment does not by itself confirm the event."
    };
  }
  if (decision === "declined" || quote?.status === "declined") {
    return {
      tone: "declined",
      title: "Thanks for letting us know",
      body: "Your caterer has received your decision."
    };
  }
  if (decision === "changes_requested") {
    return {
      tone: "changes",
      title: "Changes requested",
      body: "Your caterer has your note and will follow up with a revised proposal."
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
  const safeQuote = quote && typeof quote === "object" ? quote : {};
  const payment = safeQuote.payment || {};
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
  const bookedContract = String(safeQuote.status || "").trim().toLowerCase() === "booked"
    && Boolean(String(safeQuote.booking?.contractNumber || "").trim());
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

function normalizedDecisionText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function portalDecisionSourceChanged(snapshot, attempt) {
  const revisionId = normalizedDecisionText(snapshot?.deliveryEvidence?.revisionId);
  const portalIssuedAtISO = normalizedDecisionText(snapshot?.portalIssuedAtISO);
  return (
    revisionId !== attempt.expectedRevisionId
    || portalIssuedAtISO !== attempt.expectedPortalIssuedAtISO
  );
}

export function buildPortalDecisionAttempt({
  quote,
  decision,
  message = "",
  signerName = ""
} = {}) {
  const normalizedDecision = normalizedDecisionText(decision).toLowerCase();
  if (!quote?.portalKey || !["accepted", "changes_requested", "declined"].includes(normalizedDecision)) {
    throw new TypeError("A current proposal and supported decision are required.");
  }
  return Object.freeze({
    portalKey: normalizedDecisionText(quote.portalKey),
    decision: normalizedDecision,
    message: String(message || "").trim().slice(0, 1200),
    signerName: normalizedDecision === "accepted"
      ? normalizedDecisionText(signerName).slice(0, 160)
      : "",
    consentVersion: normalizedDecision === "accepted"
      ? PROPOSAL_ACCEPTANCE_CONSENT_VERSION
      : "",
    expectedRevisionId: normalizedDecisionText(quote?.deliveryEvidence?.revisionId),
    expectedPortalIssuedAtISO: normalizedDecisionText(quote?.portalIssuedAtISO)
  });
}

export function reconcilePortalDecisionSnapshot(attempt, snapshot) {
  if (!attempt?.portalKey || snapshot?.portalKey !== attempt.portalKey) {
    return Object.freeze({ phase: "error", reason: "portal_identity_changed" });
  }
  const status = normalizedDecisionText(snapshot?.status).toLowerCase();
  const recordedDecision = normalizedDecisionText(snapshot?.portalDecision?.decision).toLowerCase();
  const recordedMessage = String(snapshot?.portalDecision?.message || "").trim();

  if (attempt.decision === "accepted") {
    const receipt = snapshot?.acceptanceReceipt || {};
    if (
      ["accepted", "booked"].includes(status)
      && recordedDecision === "accepted"
      && normalizedDecisionText(receipt.receiptId)
      && normalizedDecisionText(receipt.signerName) === attempt.signerName
      && normalizedDecisionText(receipt.consentVersion) === attempt.consentVersion
      && normalizedDecisionText(receipt.quoteRevisionId) === attempt.expectedRevisionId
      && normalizedDecisionText(receipt.portalIssuedAtISO) === attempt.expectedPortalIssuedAtISO
    ) {
      return Object.freeze({
        phase: "receipt",
        receiptKind: "electronic_acceptance",
        receiptId: normalizedDecisionText(receipt.receiptId)
      });
    }
  } else if (
    recordedDecision === attempt.decision
    && recordedMessage === attempt.message
    && normalizedDecisionText(snapshot?.portalDecision?.requestId)
    && normalizedDecisionText(snapshot?.portalDecision?.submittedAtISO)
  ) {
    return Object.freeze({
      phase: "receipt",
      receiptKind: "portal_decision",
      receiptId: normalizedDecisionText(snapshot.portalDecision.requestId)
    });
  }

  if (["accepted", "declined", "booked"].includes(status)) {
    return Object.freeze({ phase: "error", reason: "different_terminal_decision" });
  }
  if (portalDecisionSourceChanged(snapshot, attempt)) {
    return Object.freeze({ phase: "stale", reason: "proposal_source_changed" });
  }
  return Object.freeze({ phase: "error", reason: "decision_not_recorded" });
}

function safeDecisionErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (/full legal name|electronic-signature|describe the changes|invalid or expired|reload|changed|no longer available/i.test(message)) {
    return message;
  }
  return "The decision was not confirmed. Review the current proposal before trying again.";
}

function decisionCapabilityState(phase) {
  const normalized = PORTAL_DECISION_PHASES.has(phase) ? phase : "ready";
  return normalized === "stale" ? "error" : normalized;
}

export function PortalDecisionMutationState({
  mutation = {},
  feedbackRef,
  onReconcile,
  onRetryAcceptance,
  onReviewLatest,
  onReturnToDecision
}) {
  const phase = PORTAL_DECISION_PHASES.has(mutation.phase) ? mutation.phase : "ready";
  const capabilityState = decisionCapabilityState(phase);
  const busy = phase === "submitting" || phase === "reconciliation";
  let title = "Ready for your decision";
  let detail = "Nothing is submitted until you choose the final decision button.";
  if (phase === "submitting") {
    title = "Recording your decision";
    detail = "Keep this page open while QuotePilot waits for the authoritative result.";
  } else if (phase === "uncertain") {
    title = "Decision outcome needs confirmation";
    detail = "The request may have reached QuotePilot, but this page could not read the result. Check the same decision before trying anything again.";
  } else if (phase === "reconciliation") {
    title = "Checking the recorded decision";
    detail = "QuotePilot is reading the current proposal with the same request details; it is not submitting a second decision.";
  } else if (phase === "receipt") {
    title = mutation.receiptKind === "electronic_acceptance"
      ? "Electronic acceptance recorded"
      : "Decision recorded";
    detail = mutation.receiptKind === "electronic_acceptance"
      ? "The receipt is bound to the signer, consent statement, portal issuance, and exact delivered revision. Payment and booking remain separate."
      : "The current portal projection contains this decision. This does not prove a provider message, payment, or booking.";
  } else if (phase === "stale") {
    title = "Review the latest proposal before deciding";
    detail = "The proposal revision or link issuance changed. Your prior signature input was not applied to the newer proposal.";
  } else if (phase === "error") {
    title = mutation.validation ? "Complete the decision details" : "Decision not recorded";
    detail = mutation.message || "The current portal projection does not contain this decision.";
  }

  return (
    <div
      id="portal-decision-feedback"
      className={`portal-decision-state portal-decision-state-${phase}`}
      data-decision-state={phase}
      data-capability-state={capabilityState}
      role={["error", "stale"].includes(phase) ? "alert" : "status"}
      aria-live={busy ? "polite" : undefined}
      aria-busy={busy || undefined}
      ref={feedbackRef}
      tabIndex={phase === "ready" ? undefined : -1}
    >
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        {phase === "receipt" && mutation.receiptId && (
          <small>Recorded receipt reference: {mutation.receiptId}</small>
        )}
      </div>
      {phase === "uncertain" && (
        <button type="button" className="ghost" onClick={onReconcile} data-capability-state="recovery">
          Check decision status
        </button>
      )}
      {phase === "stale" && (
        <button type="button" className="ghost" onClick={onReviewLatest} data-capability-state="recovery">
          Review latest proposal
        </button>
      )}
      {phase === "error" && !mutation.validation && mutation.retrySafe && (
        <button type="button" className="ghost" onClick={onRetryAcceptance} data-capability-state="recovery">
          Retry same acceptance
        </button>
      )}
      {phase === "error" && (mutation.validation || !mutation.retrySafe) && (
        <button type="button" className="ghost" onClick={onReturnToDecision} data-capability-state="recovery">
          Return to decision
        </button>
      )}
    </div>
  );
}

// --- Portal ceremony (one-shot, live-session only) -------------------------
// The acceptance and payment ceremonies fire only on the transition INTO
// accepted/confirmed observed during this session — never on page load of an
// already-accepted quote. Transition tracking uses refs, mirroring
// CommercialImpactShimmer in CommercialChangeImpactPanel.jsx.

// True when ceremony motion must be skipped: no browser window (SSR) or the
// visitor prefers reduced motion. On skip, the UI jumps straight to the
// final state with no ceremony classes, shimmer, or cue.
export function ceremonyMotionDisabled() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Fresh acceptance = the SAME portal quote, already observed live in a
// non-accepted status, moves into the accepted family. A null/blank previous
// observation (first render of an already-accepted quote) never fires, and
// neither does accepted -> booked or a jump between different portal keys.
export function isFreshAcceptanceTransition(previous, next) {
  const previousKey = normalizedDecisionText(previous?.portalKey);
  const nextKey = normalizedDecisionText(next?.portalKey);
  const previousStatus = normalizedDecisionText(previous?.status).toLowerCase();
  const nextStatus = normalizedDecisionText(next?.status).toLowerCase();
  return Boolean(previousKey)
    && previousKey === nextKey
    && Boolean(previousStatus)
    && !ACCEPTED_PORTAL_STATUSES.has(previousStatus)
    && ACCEPTED_PORTAL_STATUSES.has(nextStatus);
}

// Fresh payment confirmation = the payment-return flow was observed live in a
// non-confirmed state and now reads confirmed. A first observation that is
// already confirmed (no live previous state) never fires.
export function isFreshPaymentConfirmationTransition(previousState, nextState) {
  const previous = String(previousState || "").trim().toLowerCase();
  const next = String(nextState || "").trim().toLowerCase();
  return Boolean(previous) && previous !== "confirmed" && next === "confirmed";
}

// Electronic-acceptance receipt block plus its one-shot acceptance ceremony:
// ink-drawn signer name, seal-stamp settle, positive shimmer, and a single
// "seal" cue. Hook state lives in this child (not in a seam that tests invoke
// as a plain function). Mounted whenever a quote is shown so it observes the
// pre-acceptance status; it renders nothing until a receipt exists.
export function AcceptanceCeremonyReceipt({ quote }) {
  const observedRef = useRef(null);
  const settleTimerRef = useRef(0);
  const [ceremony, setCeremony] = useState({ active: false, run: 0 });
  const portalKey = quote?.portalKey || "";
  const status = quote?.status || "";

  useEffect(() => () => {
    if (typeof window !== "undefined") window.clearTimeout(settleTimerRef.current);
  }, []);

  useEffect(() => {
    const previous = observedRef.current;
    const next = { portalKey, status };
    observedRef.current = next;
    if (!isFreshAcceptanceTransition(previous, next)) return;
    if (ceremonyMotionDisabled()) return;
    // One sound, once: the shimmer below is muted so "seal" stands alone.
    playCue("seal");
    setCeremony((prev) => ({ active: true, run: prev.run + 1 }));
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      setCeremony((prev) => ({ ...prev, active: false }));
    }, PORTAL_CEREMONY_SETTLE_MS);
  }, [portalKey, status]);

  const receipt = quote?.acceptanceReceipt;
  if (!receipt || !ACCEPTED_PORTAL_STATUSES.has(String(status).trim().toLowerCase())) {
    return null;
  }
  return (
    <section
      className={`portal-decision-note-receipt portal-signature-receipt${
        ceremony.active ? " portal-ceremony-host portal-ceremony-stamp" : ""
      }`}
    >
      <span>Electronic acceptance receipt</span>
      <p>
        Signed by <strong className={ceremony.active ? "portal-ceremony-ink" : undefined}>{receipt.signerName}</strong> on{" "}
        {fmtDateTime(receipt.acceptedAtISO)}.
      </p>
      <small>
        Receipt {receipt.receiptId} · Revision {receipt.quoteRevisionId}
      </small>
      <ShimmerReveal trigger={ceremony.run} tone="positive" sound={false} />
    </section>
  );
}

// Deposit payment-status block plus its one-shot payment-confirmed ceremony:
// positive shimmer over the block, a self-drawing checkmark beside the
// confirmation message, and a single positive chime. The fully drawn
// checkmark remains part of the confirmed presentation; only the draw
// animation class is one-shot.
export function PaymentStatusCeremonyBlock({
  payment = {},
  confirmationState = "idle",
  confirmationMessage = ""
}) {
  const observedRef = useRef(null);
  const settleTimerRef = useRef(0);
  const [ceremony, setCeremony] = useState({ active: false, run: 0 });

  useEffect(() => () => {
    if (typeof window !== "undefined") window.clearTimeout(settleTimerRef.current);
  }, []);

  useEffect(() => {
    const previous = observedRef.current;
    observedRef.current = confirmationState;
    if (!isFreshPaymentConfirmationTransition(previous, confirmationState)) return;
    if (ceremonyMotionDisabled()) return;
    // One sound, once: the shimmer below is muted so this chime stands alone.
    playCue("chime", "positive");
    setCeremony((prev) => ({ active: true, run: prev.run + 1 }));
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      setCeremony((prev) => ({ ...prev, active: false }));
    }, PORTAL_CEREMONY_SETTLE_MS);
  }, [confirmationState]);

  const confirmed = String(confirmationState || "").trim().toLowerCase() === "confirmed";
  return (
    <>
      <div className={`portal-payment-state${ceremony.active ? " portal-ceremony-host" : ""}`}>
        <span>Payment status</span>
        <strong>{paymentStatusLabel(payment.depositStatus)}</strong>
        {payment.depositConfirmedAtISO && <small>Confirmed {fmtDate(payment.depositConfirmedAtISO)}</small>}
        <ShimmerReveal trigger={ceremony.run} tone="positive" sound={false} particleCount={120} />
      </div>
      {confirmationMessage && (
        <p className="source-note" role="status" aria-live="polite">
          {confirmed && (
            <svg
              className={`portal-ceremony-check${ceremony.active ? " portal-ceremony-check-drawing" : ""}`}
              viewBox="0 0 18 18"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M3.5 9.5l4 4 7-8" />
            </svg>
          )}
          {confirmationMessage}
        </p>
      )}
    </>
  );
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
  const [signerName, setSignerName] = useState("");
  const [acceptanceConfirmed, setAcceptanceConfirmed] = useState(false);
  const [decisionMutation, setDecisionMutation] = useState({ phase: "ready" });
  const [paymentConfirmation, setPaymentConfirmation] = useState({
    state: initialPaymentReturn === "success"
      ? "checking"
      : initialPaymentReturn === "cancelled"
        ? "cancelled"
        : "idle",
    attempt: 0
  });
  const [recovery, setRecovery] = useState({ loading: false, contact: null });
  const [manualEntry, setManualEntry] = useState(!initialPortalKey);
  const portalKeyInputRef = useRef(null);
  const portalLoadRequestRef = useRef(0);
  const recoveryRequestRef = useRef(0);
  const decisionRequestRef = useRef(0);
  const decisionAttemptRef = useRef(null);
  const decisionPanelRef = useRef(null);
  const decisionFeedbackRef = useRef(null);
  const signerNameRef = useRef(null);
  const acceptanceConfirmationRef = useRef(null);
  const [state, setState] = useState({
    loading: false,
    busy: false,
    error: "",
    status: "",
    quote: null
  });

  const quote = state.quote;
  const quoteMeta = quote?.quoteMeta || {};
  const recoveryContact = recovery.contact || {};
  const organizationName = String(
    quoteMeta.organizationName || recoveryContact.organizationName || ""
  ).trim();
  const brandName = String(
    quoteMeta.brandName || recoveryContact.brandName || organizationName || ""
  ).trim();
  const businessEmail = safeEmail(quoteMeta.businessEmail || recoveryContact.email);
  const businessPhone = safePhone(quoteMeta.businessPhone || recoveryContact.phone);
  const brandLogoUrl = safeLogoUrl(quoteMeta.brandLogoUrl || recoveryContact.logoUrl);
  const portalTheme = buildPortalThemeStyle({
    brandPrimaryColor: quoteMeta.brandPrimaryColor || recoveryContact.brandPrimaryColor,
    brandAccentColor: quoteMeta.brandAccentColor || recoveryContact.brandAccentColor,
    brandDarkAccentColor: quoteMeta.brandDarkAccentColor || recoveryContact.brandDarkAccentColor,
    brandBackgroundStart: quoteMeta.brandBackgroundStart || recoveryContact.brandBackgroundStart,
    brandBackgroundMid: quoteMeta.brandBackgroundMid || recoveryContact.brandBackgroundMid,
    brandBackgroundEnd: quoteMeta.brandBackgroundEnd || recoveryContact.brandBackgroundEnd
  });
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

  const loadRecoveryContact = async (key) => {
    const requestId = recoveryRequestRef.current + 1;
    recoveryRequestRef.current = requestId;
    setRecovery({ loading: true, contact: null });
    try {
      const contact = await getPortalRecoveryContact(key);
      if (recoveryRequestRef.current === requestId) {
        setRecovery({ loading: false, contact });
      }
    } catch {
      if (recoveryRequestRef.current === requestId) {
        setRecovery({ loading: false, contact: null });
      }
    }
  };

  const load = async (nextPortalKey = portalKey) => {
    const key = String(nextPortalKey || "").trim();
    if (!key) {
      setState((prev) => ({ ...prev, error: "Enter your quote link key." }));
      window.requestAnimationFrame(() => portalKeyInputRef.current?.focus());
      return;
    }
    const requestId = portalLoadRequestRef.current + 1;
    portalLoadRequestRef.current = requestId;
    recoveryRequestRef.current += 1;
    setRecovery({ loading: false, contact: null });
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
      if (portalLoadRequestRef.current !== requestId) return;
      setPortalKey(key);
      setDecisionDraft(quote.portalDecision?.decision || "accepted");
      setDecisionMessage(quote.portalDecision?.message || "");
      setSignerName(quote.acceptanceReceipt?.signerName || "");
      setAcceptanceConfirmed(false);
      decisionRequestRef.current += 1;
      decisionAttemptRef.current = null;
      setDecisionMutation({ phase: "ready" });
      setState((prev) => ({
        ...prev,
        loading: false,
        quote,
        status: ""
      }));
      if (key === String(initialPortalKey || "").trim()) {
        void loadRecoveryContact(key);
      }
    } catch (err) {
      if (portalLoadRequestRef.current !== requestId) return;
      setManualEntry(true);
      setState((prev) => ({
        ...prev,
        loading: false,
        quote: null,
        error: key === String(initialPortalKey || "").trim()
          ? "This proposal link is no longer available."
          : formatError(err)
      }));
      void loadRecoveryContact(key);
    }
  };

  const tryAnotherPortalKey = () => {
    setManualEntry(true);
    setPortalKey("");
    portalLoadRequestRef.current += 1;
    recoveryRequestRef.current += 1;
    decisionRequestRef.current += 1;
    decisionAttemptRef.current = null;
    setDecisionMutation({ phase: "ready" });
    setRecovery({ loading: false, contact: null });
    setState((prev) => ({
      ...prev,
      loading: false,
      error: "",
      status: "Paste the current quote key to try again."
    }));
    window.requestAnimationFrame(() => portalKeyInputRef.current?.focus());
  };

  const focusDecisionControl = (target = "feedback") => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const element = target === "signer"
        ? signerNameRef.current
        : target === "consent"
          ? acceptanceConfirmationRef.current
          : target === "panel"
            ? decisionPanelRef.current
            : decisionFeedbackRef.current;
      element?.focus({ preventScroll: true });
    });
  };

  const reconcileDecisionAttempt = async (attempt, { cause = null, operationId = 0 } = {}) => {
    if (!attempt?.portalKey) return;
    const requestId = operationId || decisionRequestRef.current + 1;
    decisionRequestRef.current = requestId;
    setDecisionMutation({ phase: "reconciliation" });
    setState((prev) => ({ ...prev, busy: true, error: "", status: "" }));
    try {
      const refreshed = await getPortalQuote(attempt.portalKey);
      if (decisionRequestRef.current !== requestId) return;
      const resolution = reconcilePortalDecisionSnapshot(attempt, refreshed);
      let nextMutation = resolution;
      if (
        resolution.phase === "error"
        && resolution.reason === "decision_not_recorded"
        && /reload|changed|terms|no longer available/i.test(String(cause?.message || ""))
      ) {
        nextMutation = { phase: "stale", reason: "proposal_source_changed" };
      } else if (resolution.phase === "error") {
        nextMutation = {
          ...resolution,
          message: safeDecisionErrorMessage(cause),
          retrySafe: attempt.decision === "accepted"
            && resolution.reason === "decision_not_recorded"
        };
      }
      setState((prev) => ({
        ...prev,
        busy: false,
        quote: refreshed,
        status: nextMutation.phase === "receipt"
          ? "Your recorded decision is current."
          : ""
      }));
      setDecisionMutation(nextMutation);
      focusDecisionControl("feedback");
    } catch {
      if (decisionRequestRef.current !== requestId) return;
      setState((prev) => ({ ...prev, busy: false }));
      setDecisionMutation({
        phase: "uncertain",
        retrySafe: attempt.decision === "accepted"
      });
      focusDecisionControl("feedback");
    }
  };

  const performDecisionAttempt = async (attempt) => {
    const operationId = decisionRequestRef.current + 1;
    decisionRequestRef.current = operationId;
    decisionAttemptRef.current = attempt;
    setDecisionMutation({ phase: "submitting" });
    setState((prev) => ({ ...prev, busy: true, error: "", status: "" }));
    try {
      const result = await updatePortalDecision(attempt);
      if (decisionRequestRef.current !== operationId) return;
      const acknowledgedQuote = {
        ...quote,
        status: result.status || quote.status,
        ...(result.portalDecision ? { portalDecision: result.portalDecision } : {}),
        ...(result.acceptanceReceipt ? { acceptanceReceipt: result.acceptanceReceipt } : {})
      };
      const receiptKind = attempt.decision === "accepted"
        ? "electronic_acceptance"
        : "portal_decision";
      const receiptId = normalizedDecisionText(
        result.acceptanceReceipt?.receiptId || result.portalDecision?.requestId
      );
      setState((prev) => ({
        ...prev,
        busy: false,
        quote: acknowledgedQuote,
        status: attempt.decision === "changes_requested"
          ? "Your change request was recorded for staff review."
          : attempt.decision === "accepted"
            ? "Thank you—your electronic acceptance was recorded."
            : "Thank you—your decision was recorded."
      }));
      setDecisionMutation({ phase: "receipt", receiptKind, receiptId });
      setAcceptanceConfirmed(false);
      focusDecisionControl("feedback");

      try {
        const refreshed = await getPortalQuote(attempt.portalKey);
        if (decisionRequestRef.current !== operationId) return;
        const resolution = reconcilePortalDecisionSnapshot(attempt, refreshed);
        if (resolution.phase === "receipt") {
          setState((prev) => ({ ...prev, quote: refreshed }));
          setDecisionMutation(resolution);
        }
      } catch {
        if (decisionRequestRef.current !== operationId) return;
        setState((prev) => ({
          ...prev,
          status: `${prev.status} The latest proposal refresh is temporarily unavailable.`
        }));
      }
    } catch (err) {
      if (decisionRequestRef.current !== operationId) return;
      await reconcileDecisionAttempt(attempt, { cause: err, operationId });
    }
  };

  const submitDecision = async () => {
    if (!quote?.portalKey || decisionLocked || state.busy) return;
    if (decisionDraft === "accepted" && signerName.trim().length < 2) {
      setDecisionMutation({
        phase: "error",
        validation: true,
        message: "Enter the signer’s full legal name."
      });
      focusDecisionControl("signer");
      return;
    }
    if (decisionDraft === "accepted" && !acceptanceConfirmed) {
      setDecisionMutation({
        phase: "error",
        validation: true,
        message: "Confirm the electronic-signature statement before accepting."
      });
      focusDecisionControl("consent");
      return;
    }
    if (decisionDraft === "changes_requested" && !decisionMessage.trim()) {
      setDecisionMutation({
        phase: "error",
        validation: true,
        message: "Describe the changes you would like staff to review."
      });
      focusDecisionControl("panel");
      return;
    }
    if (
      decisionDraft === "accepted"
      && (!quote.deliveryEvidence?.revisionId || !quote.portalIssuedAtISO)
    ) {
      setDecisionMutation({ phase: "stale", reason: "proposal_source_missing" });
      focusDecisionControl("feedback");
      return;
    }

    let attempt;
    try {
      attempt = buildPortalDecisionAttempt({
        quote,
        decision: decisionDraft,
        message: decisionMessage,
        signerName
      });
    } catch (error) {
      setDecisionMutation({
        phase: "error",
        validation: true,
        message: safeDecisionErrorMessage(error)
      });
      focusDecisionControl("feedback");
      return;
    }
    await performDecisionAttempt(attempt);
  };

  const retryAcceptance = async () => {
    const attempt = decisionAttemptRef.current;
    if (attempt?.decision !== "accepted" || state.busy) return;
    await performDecisionAttempt(attempt);
  };

  const reviewLatestProposal = async () => {
    const key = decisionAttemptRef.current?.portalKey || quote?.portalKey;
    if (!key || state.busy) return;
    await load(key);
    focusDecisionControl("panel");
  };

  const returnToDecision = () => {
    setDecisionMutation({ phase: "ready" });
    focusDecisionControl(decisionDraft === "accepted" ? "signer" : "panel");
  };

  useEffect(() => {
    setManualEntry(!initialPortalKey);
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
    if (!["success", "cancelled"].includes(initialPaymentReturn) || typeof window === "undefined") return;
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
    paymentConfirmationMessage = "Confirming your payment securely with the payment provider...";
  } else if (paymentConfirmation.state === "confirmed") {
    paymentConfirmationMessage = paymentReturnKind === "final_balance"
      ? "Payment confirmed. Your final balance is recorded as paid."
      : "Payment confirmed—your deposit has been received. Your caterer will confirm the booking separately.";
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

  const serviceFeeLabel = serviceChargeLabel(totals.serviceFeePctApplied);

  const pricingRows = [
    ["Package", totals.base],
    ["Menu selections", totals.menu],
    ["Add-ons", totals.addons],
    ["Rentals", totals.rentals],
    ["Labor", totals.labor],
    ["Travel", totals.travel],
    [serviceFeeLabel, totals.serviceFee],
    ["Tax", totals.tax]
  ].filter(([, amount]) => Number(amount || 0) !== 0);
  const eventRows = [
    ["Date", fmtDate(quote?.eventDate)],
    ["Time", fmtTime(quote?.eventTime)],
    ["Guests", quote?.eventGuests || "-"],
    ["Duration", quote?.eventHours ? `${quote.eventHours} hours` : "-"],
    ["Venue", quote?.venue || "-"],
    ["Service", humanizeValue(quote?.eventStyle)]
  ];
  const scopeRows = [
    ["Package includes", [
      ...(scope.packageInclusions?.menuItems || []),
      ...(scope.packageInclusions?.addons || []),
      ...(scope.packageInclusions?.rentals || [])
    ]],
    ["Menu", scope.menuItems],
    ["Add-ons", scope.addons],
    ["Rentals", scope.rentals]
  ].filter(([, items]) => items?.length > 0);

  return (
    <main className="portal-shell" style={portalTheme}>
      <section className="panel portal-card">
        <div className="portal-head">
          <div className="portal-brand-heading">
            {brandLogoUrl && <img src={brandLogoUrl} alt={`${brandName || "Caterer"} logo`} />}
            <div>
            <p className="eyebrow">Catering proposal</p>
            <h1>{portalTitle}</h1>
            </div>
          </div>
          {(businessEmail || businessPhone) && (
            <div className="portal-brand-contact" aria-label="Caterer contact">
              {businessEmail && <a href={`mailto:${businessEmail}`}>{businessEmail}</a>}
              {businessPhone && <a href={`tel:${businessPhone.replace(/[^+\d]/g, "")}`}>{businessPhone}</a>}
            </div>
          )}
        </div>

        {!quote && manualEntry && (
          <div className="portal-entry">
            <input
              ref={portalKeyInputRef}
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

        {state.error && <p className="error-note" role="alert">{state.error}</p>}
        {state.error && !quote && (
          <section className="portal-recovery" aria-busy={recovery.loading}>
            <h2>Request a new link</h2>
            {recovery.loading ? (
              <p className="source-note" role="status">Finding the right catering contact...</p>
            ) : (
              <>
                <p>
                  Contact {brandName || "your caterer"} and ask for a fresh proposal link.
                </p>
                <div className="portal-recovery-actions">
                  {businessEmail && (
                    <a
                      className="cta"
                      href={`mailto:${businessEmail}?subject=${encodeURIComponent("Request for a new proposal link")}`}
                    >
                      Email {brandName || "your caterer"}
                    </a>
                  )}
                  {businessPhone && (
                    <a className="ghost" href={`tel:${businessPhone.replace(/[^+\d]/g, "")}`}>
                      Call {businessPhone}
                    </a>
                  )}
                  <button type="button" className="ghost" onClick={tryAnotherPortalKey}>
                    Try another key
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        {state.status && <p className="source-note" role="status" aria-live="polite">{state.status}</p>}
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
                <PaymentStatusCeremonyBlock
                  payment={payment}
                  confirmationState={paymentConfirmation.state}
                  confirmationMessage={paymentConfirmationMessage}
                />
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
              <section
                className="portal-decision-panel"
                ref={decisionPanelRef}
                tabIndex={-1}
                aria-labelledby="portal-decision-title"
                aria-busy={state.busy || undefined}
              >
                <h3 id="portal-decision-title">Your decision</h3>
                <div className="portal-decision-options" role="group" aria-label="Proposal decision">
                  {DECISION_OPTIONS.map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={decisionDraft === value ? "active" : ""}
                      aria-pressed={decisionDraft === value}
                      disabled={state.busy}
                      onClick={() => {
                        setDecisionDraft(value);
                        decisionAttemptRef.current = null;
                        setDecisionMutation({ phase: "ready" });
                      }}
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
                    disabled={state.busy}
                    placeholder={decisionDraft === "changes_requested" ? "Describe what should be revised" : "Add any context for the catering team"}
                  />
                </label>
                {decisionDraft === "accepted" && (
                  <div className="portal-signature-fields">
                    <label className="field">
                      <span>Full legal name</span>
                      <input
                        ref={signerNameRef}
                        type="text"
                        autoComplete="name"
                        maxLength="160"
                        value={signerName}
                        onChange={(event) => setSignerName(event.target.value)}
                        placeholder="Type your name to sign"
                        aria-describedby="portal-signature-boundary portal-decision-feedback"
                        aria-invalid={decisionMutation.validation && signerName.trim().length < 2}
                        disabled={state.busy}
                        required
                      />
                    </label>
                    <label className="portal-accept-confirmation">
                      <input
                        ref={acceptanceConfirmationRef}
                        type="checkbox"
                        checked={acceptanceConfirmed}
                        onChange={(event) => setAcceptanceConfirmed(event.target.checked)}
                        aria-describedby="portal-signature-boundary portal-decision-feedback"
                        aria-invalid={decisionMutation.validation && !acceptanceConfirmed}
                        disabled={state.busy}
                      />
                      <span>
                        I agree to this proposal and consent to use my typed name as my electronic signature.
                      </span>
                    </label>
                    <div className="portal-signature-summary" aria-label="Proposal being signed">
                      <span>Signing</span>
                      <strong>{quote.quoteNumber || "Current proposal"}</strong>
                      <small>{eventLabel} · {currency(quote.total || 0)}</small>
                    </div>
                    <p className="source-note" id="portal-signature-boundary">
                      Acceptance records this proposal revision. Payment and booking confirmation remain separate.
                    </p>
                  </div>
                )}
                <div className="portal-decision-submit">
                  <button
                    type="button"
                    className="cta"
                    onClick={submitDecision}
                    disabled={state.busy}
                    aria-describedby="portal-decision-feedback"
                  >
                    {state.busy
                      ? "Submitting..."
                      : decisionDraft === "accepted"
                        ? "Sign and Accept Proposal"
                        : "Submit Decision"}
                  </button>
                </div>
              </section>
            )}

            {(!decisionLocked || decisionMutation.phase !== "ready") && (
              <PortalDecisionMutationState
                mutation={decisionMutation}
                feedbackRef={decisionFeedbackRef}
                onReconcile={() => reconcileDecisionAttempt(decisionAttemptRef.current)}
                onRetryAcceptance={retryAcceptance}
                onReviewLatest={reviewLatestProposal}
                onReturnToDecision={returnToDecision}
              />
            )}

            {["accepted", "booked"].includes(quote.status) && (
              <section className="portal-next-steps">
                <div>
                  <p className="eyebrow">Next steps</p>
                  <h3>{payment.depositStatus === "paid" ? "Your deposit is received" : "Deposit and booking"}</h3>
                  <p>
                    {payment.depositStatus === "paid"
                      ? `${currency(quote.deposit || 0)} has been received. `
                      : `${currency(quote.deposit || 0)} is due as the deposit. `}
                    Your caterer will confirm the booking and final event details separately.
                  </p>
                  {(businessEmail || businessPhone) && (
                    <p className="portal-next-contact">
                      Questions? {businessEmail && <a href={`mailto:${businessEmail}`}>{businessEmail}</a>}
                      {businessEmail && businessPhone ? " · " : ""}
                      {businessPhone && <a href={`tel:${businessPhone.replace(/[^+\d]/g, "")}`}>{businessPhone}</a>}
                    </p>
                  )}
                </div>
                {approvedPaymentLink && payment.depositStatus !== "paid" && (
                  <a className="cta portal-pay-link" href={approvedPaymentLink} target="_blank" rel="noreferrer">
                    Pay deposit
                  </a>
                )}
              </section>
            )}

            <AcceptanceCeremonyReceipt quote={quote} />

            {quote.portalDecision?.message && decisionLocked && (
              <section className="portal-decision-note-receipt">
                <span>Your note</span>
                <p>{quote.portalDecision.message}</p>
              </section>
            )}

            {portalConversationAvailable() && (
              <QuoteConversationPanel
                title="Conversation with your catering team"
                access={{ accessMode: "portal", portalKey: quote.portalKey }}
              />
            )}
          </div>
        )}
      </section>
      <ProductBrandLockup compact className="portal-product-brand" />
      <p className="portal-staff-entry">
        <button type="button" className="ghost" onClick={onBackToStaff}>Staff sign in</button>
      </p>
    </main>
  );
}
