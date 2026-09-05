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
import {
  decisionRoomOptionSelected,
  discardGeneratedDecisionRoomOptions,
  normalizeDecisionRoomOptions,
  toggleDecisionRoomOption
} from "../lib/customerDecisionRoom";
import ProductBrandLockup from "./ProductBrandLockup";
import QuoteConversationPanel from "quotepilot-active-conversation-panel";
import ShimmerReveal from "./ShimmerReveal";
import { playCue } from "./soundKit";
import {
  Armchair,
  CalendarBlank,
  ChatCircleDots,
  CheckCircle,
  ForkKnife,
  MapPin,
  NotePencil,
  Package,
  Plus,
  StarFour,
  UsersThree,
  XCircle
} from "./ProductIcons";
import "./portalCeremony.css";
import "./customerPortalView.css";

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
const DECISION_ROOM_OPTIONS = [
  ["accepted", "Accept proposal"],
  ["changes_requested", "Ask for changes"],
  ["declined", "Decline proposal"]
];
const PAYMENT_STATUS_LABELS = {
  unpaid: "Awaiting deposit",
  sent: "Deposit requested",
  paid: "Paid",
  refunded: "Refunded"
};
const ACCEPTED_PORTAL_STATUSES = new Set(["accepted", "booked"]);
// The flag-gated decision room composes only customer-safe proposal facts.
// Contextual questions reuse the existing conversation authority, and optional
// additions prepare ordinary customer notes for staff review. Neither path
// changes the proposal, price, revision, payment, booking, or authority model.
// Generic and local builds remain default-off until a governed release enables
// the presentation explicitly.
const PILOT_DECISION_ROOM_ENABLED = import.meta.env.VITE_PILOT_DECISION_ROOM_ENABLED === "1"
  || import.meta.env.VITE_PILOT_DECISION_ROOM_ENABLED === "true"
  || import.meta.env.VITE_PILOT_DECISION_ROOM_ENABLED === "yes"
  || import.meta.env.VITE_PILOT_DECISION_ROOM_ENABLED === "on";
const AMBIENT_UI_ENABLED = import.meta.env.VITE_AMBIENT_UI_ENABLED === "1"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "true"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "yes"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "on";
// The production v0.7 decision-room subset remains available under its
// existing gate. AIUI-46's replacement layout, acknowledgement model, and
// reversible option controls require both gates so an Ambient-off production
// build keeps the exact legacy portal interaction.
const AMBIENT_DECISION_ROOM_ENABLED = PILOT_DECISION_ROOM_ENABLED && AMBIENT_UI_ENABLED;
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

function formatPortalCurrency(amount) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(amount || 0));
  } catch {
    return currency(amount);
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

export function getPortalDecisionDraft(quote) {
  const decision = normalizedDecisionText(quote?.portalDecision?.decision).toLowerCase();
  return DECISION_OPTIONS.some(([value]) => value === decision) ? decision : "";
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
    detail = "Keep this page open while we confirm your response.";
  } else if (phase === "uncertain") {
    title = "Decision outcome needs confirmation";
    detail = "Your response may have been received, but this page could not confirm it yet. Check the same response before trying again.";
  } else if (phase === "reconciliation") {
    title = "Checking the recorded decision";
    detail = "We are checking the current proposal using the same request. This does not submit another response.";
  } else if (phase === "receipt") {
    title = mutation.receiptKind === "electronic_acceptance"
      ? "Electronic acceptance recorded"
      : "Decision recorded";
    detail = mutation.receiptKind === "electronic_acceptance"
      ? "This acceptance is tied to your name, consent, link, and the proposal you reviewed. Payment and booking remain separate."
      : "Your response is recorded for this proposal. It does not confirm a sent message, payment, or booking.";
  } else if (phase === "stale") {
    title = "Review the latest proposal before deciding";
    detail = "The proposal revision or link issuance changed. Your prior signature input was not applied to the newer proposal.";
  } else if (phase === "error") {
    title = mutation.validation ? "Complete the decision details" : "Decision not recorded";
    detail = mutation.message || "This proposal does not show that response yet.";
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
          <small>Confirmation reference: {mutation.receiptId}</small>
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
  const [decisionDraft, setDecisionDraft] = useState("");
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
  const [conversationPrefill, setConversationPrefill] = useState(null);
  const [questionFeedback, setQuestionFeedback] = useState(null);
  const [optionDraftFeedback, setOptionDraftFeedback] = useState(null);
  const [stagedOptionKeys, setStagedOptionKeys] = useState([]);
  const conversationAnchorRef = useRef(null);
  const conversationPrefillCounterRef = useRef(0);

  const askAboutBlock = (blockLabel) => {
    conversationPrefillCounterRef.current += 1;
    const id = conversationPrefillCounterRef.current;
    setConversationPrefill({
      id,
      text: `Question about ${blockLabel}: `
    });
    if (AMBIENT_DECISION_ROOM_ENABLED) {
      setQuestionFeedback({
        id,
        status: "pending",
        message: "Opening your conversation with this part of the proposal in context."
      });
    }
    conversationAnchorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  const handleQuestionPrefillResolution = (resolution) => {
    if (!resolution?.id) return;
    setQuestionFeedback((current) => (
      current?.id === resolution.id ? resolution : current
    ));
  };

  // A decidable-option tap only DRAFTS a change request through the
  // existing Request Changes path — the identical sentence the customer
  // could type, staged staff-side by the same deterministic parser, with
  // staff approval remaining the only authority. Never overwrites their
  // own words: the sentence appends on its own line, is skipped when
  // already present, and is skipped when it would exceed the message cap.
  const requestDecidableOption = (option) => {
    if (!AMBIENT_DECISION_ROOM_ENABLED) {
      const sentence = `Please add ${String(option?.name || "").trim()}.`;
      if (sentence.length < 14) return;
      setDecisionDraft("changes_requested");
      decisionAttemptRef.current = null;
      setDecisionMutation({ phase: "ready" });
      setDecisionMessage((current) => {
        const trimmed = String(current || "").trim();
        if (trimmed.includes(sentence)) return current;
        const next = trimmed ? `${trimmed}\n${sentence}` : sentence;
        return next.length > 1200 ? current : next;
      });
      decisionPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      decisionPanelRef.current?.focus?.({ preventScroll: true });
      return;
    }
    const selected = stagedOptionKeys.includes(option.key);
    const result = toggleDecisionRoomOption({
      message: decisionMessage,
      option,
      selected
    });
    if (result.outcome === "unavailable") return;
    if (result.outcome !== "limit") {
      setDecisionDraft("changes_requested");
      setDecisionMessage(result.message);
      decisionAttemptRef.current = null;
      setDecisionMutation({ phase: "ready" });
    }
    if (result.outcome === "added") {
      setStagedOptionKeys((current) => [...new Set([...current, option.key])]);
    } else if (["removed", "missing"].includes(result.outcome)) {
      setStagedOptionKeys((current) => current.filter((key) => key !== option.key));
    }
    setOptionDraftFeedback({
      key: option.key,
      outcome: result.outcome,
      name: option.name
    });
  };

  const reviewOptionRequest = () => {
    decisionPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    decisionPanelRef.current?.focus?.({ preventScroll: true });
  };

  const decidableOptionPriceLabel = (option) => {
    const price = currency(Number(option?.price) || 0);
    if (option?.pricingType === "per_person") return `${price} per guest`;
    if (option?.pricingType === "per_item") return `${price} per item`;
    return `${price} for the event`;
  };

  const askAboutButton = (blockLabel) => (
    PILOT_DECISION_ROOM_ENABLED && portalConversationAvailable() ? (
      <button
        type="button"
        className="ghost compact portal-ask-about"
        onClick={() => askAboutBlock(blockLabel)}
        aria-label={AMBIENT_DECISION_ROOM_ENABLED ? `Ask about ${blockLabel}` : undefined}
      >
        {AMBIENT_DECISION_ROOM_ENABLED ? "Ask a question" : "Ask about this"}
      </button>
    ) : null
  );

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
  const decidableOptions = normalizeDecisionRoomOptions(quote?.decidableOptions);
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
      setDecisionDraft(getPortalDecisionDraft(quote));
      setDecisionMessage(quote.portalDecision?.message || "");
      setStagedOptionKeys([]);
      setOptionDraftFeedback(null);
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
    if (!decisionDraft) {
      setDecisionMutation({
        phase: "error",
        validation: true,
        message: "Choose Accept, Ask for changes, or Decline before submitting."
      });
      focusDecisionControl("panel");
      return;
    }
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

  const selectDecision = (value) => {
    if (
      AMBIENT_DECISION_ROOM_ENABLED
      && value !== "changes_requested"
      && stagedOptionKeys.length > 0
    ) {
      const discarded = discardGeneratedDecisionRoomOptions({
        message: decisionMessage,
        options: decidableOptions,
        selectedKeys: stagedOptionKeys
      });
      setDecisionMessage(discarded.message);
      setStagedOptionKeys([]);
      if (discarded.removedCount > 0) {
        setOptionDraftFeedback({
          outcome: "discarded",
          count: discarded.removedCount
        });
      }
    }
    setDecisionDraft(value);
    setAcceptanceConfirmed(false);
    decisionAttemptRef.current = null;
    setDecisionMutation({ phase: "ready" });
  };

  const decisionOptions = AMBIENT_DECISION_ROOM_ENABLED
    ? DECISION_ROOM_OPTIONS
    : DECISION_OPTIONS;

  return (
    <main
      className={`portal-shell${AMBIENT_DECISION_ROOM_ENABLED ? " portal-decision-room-shell" : ""}`}
      data-portal-presentation={AMBIENT_DECISION_ROOM_ENABLED ? "event-story" : "legacy"}
      style={portalTheme}
    >
      <section className={`panel portal-card${AMBIENT_DECISION_ROOM_ENABLED ? " portal-decision-room" : ""}`}>
        <div className="portal-head">
          <div className="portal-brand-heading">
            {brandLogoUrl && <img src={brandLogoUrl} alt={`${brandName || "Caterer"} logo`} />}
            {AMBIENT_DECISION_ROOM_ENABLED && !brandLogoUrl && (
              <StarFour className="portal-brand-fallback-mark" size={28} aria-hidden="true" />
            )}
            <div>
            <p className="eyebrow">Catering proposal</p>
            <h1 aria-label={AMBIENT_DECISION_ROOM_ENABLED ? portalTitle : undefined}>
              {AMBIENT_DECISION_ROOM_ENABLED
                ? brandName || organizationName || "Your proposal"
                : portalTitle}
            </h1>
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
            <header
              className={`portal-proposal-header${AMBIENT_DECISION_ROOM_ENABLED ? " portal-decision-room-cover" : ""}`}
              data-portal-region="proposal-header"
            >
              <div>
                <span>
                  {AMBIENT_DECISION_ROOM_ENABLED
                    ? "Your event proposal"
                    : quote.quoteNumber || "Proposal"}
                </span>
                <h2>
                  {AMBIENT_DECISION_ROOM_ENABLED ? (
                    <>
                      <span className="portal-event-title">{quote.eventName || "Your event"}</span>
                      <span className="portal-event-date">{fmtDate(quote.eventDate)}</span>
                    </>
                  ) : eventLabel}
                </h2>
                {AMBIENT_DECISION_ROOM_ENABLED ? (
                  <p>Prepared for <strong>{quote.customerName || "you"}</strong></p>
                ) : (
                  <p>{quote.customerName || "Customer"}</p>
                )}
              </div>
              <div className={`portal-decision-receipt receipt-${receipt.tone}`}>
                {AMBIENT_DECISION_ROOM_ENABLED && <small className="portal-rail-eyebrow">Your decision</small>}
                <strong>{receipt.title}</strong>
                <span>{receipt.body}</span>
              </div>
            </header>

            <div className="portal-content-grid">
              <section
                className={`portal-detail-section${AMBIENT_DECISION_ROOM_ENABLED ? " portal-experience-section" : ""}`}
                data-portal-block="event-details"
                data-portal-region="proposal-story"
              >
                {AMBIENT_DECISION_ROOM_ENABLED ? (
                  <>
                    <h3 className="portal-event-summary-heading">Your event</h3>
                    <div className="portal-event-facts" aria-label="Event summary">
                      <div className="portal-event-fact">
                        <span className="portal-event-fact-icon" aria-hidden="true"><CalendarBlank size={22} /></span>
                        <span><small>Date &amp; time</small><strong>{fmtDate(quote.eventDate)}</strong><em>{fmtTime(quote.eventTime)}</em></span>
                      </div>
                      <div className="portal-event-fact">
                        <span className="portal-event-fact-icon" aria-hidden="true"><UsersThree size={22} /></span>
                        <span><small>Guests</small><strong>{quote.eventGuests || "-"} guests</strong></span>
                      </div>
                      <div className="portal-event-fact">
                        <span className="portal-event-fact-icon" aria-hidden="true"><MapPin size={22} /></span>
                        <span><small>Venue</small><strong>{quote.venue || "-"}</strong>{quote.venueAddress && <em>{quote.venueAddress}</em>}</span>
                      </div>
                      <div className="portal-event-fact">
                        <span className="portal-event-fact-icon" aria-hidden="true"><ForkKnife size={22} /></span>
                        <span><small>Service</small><strong>{humanizeValue(quote.eventStyle)}</strong>{quote.eventHours ? <em>{quote.eventHours} hours</em> : null}</span>
                      </div>
                    </div>
                    <div className="portal-context-question">{askAboutButton("your event details")}</div>
                  </>
                ) : (
                  <h3>Event details {askAboutButton("the event details")}</h3>
                )}
                {!AMBIENT_DECISION_ROOM_ENABLED && (
                  <>
                    <dl className="portal-detail-grid">
                      {eventRows.map(([label, value]) => (
                        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                      ))}
                    </dl>
                    {quote.venueAddress && <p className="portal-address">{quote.venueAddress}</p>}
                  </>
                )}
                <div className="portal-scope-block" data-portal-block="package-and-menu">
                  {AMBIENT_DECISION_ROOM_ENABLED ? (
                    <div className="portal-section-heading portal-section-heading-small">
                    <div>
                      <span>Package &amp; menu</span>
                      <h4>{scope.packageName || "Catering package"}</h4>
                    </div>
                    {askAboutButton("your menu and service")}
                    </div>
                  ) : (
                    <h4>{scope.packageName || "Catering package"} {askAboutButton("the package and menu")}</h4>
                  )}
                  {scopeRows.map(([label, items]) => (
                    <div key={label}><span>{label}</span><p>{items.join(", ")}</p></div>
                  ))}
                  <div>
                    <span>Dietary notes</span>
                    <p>{quote.dietaryRestrictions || "None provided"}</p>
                  </div>
                </div>
              </section>

              <section
                className="portal-detail-section portal-pricing-section"
                data-portal-block="pricing"
                data-portal-region="commercial-summary"
              >
                {AMBIENT_DECISION_ROOM_ENABLED ? (
                  <>
                    <div className="portal-section-heading">
                      <div>
                        <span>Your proposal total</span>
                        <h3 aria-label="Your proposal total">{formatPortalCurrency(quote.total || 0)}</h3>
                      </div>
                      {askAboutButton("your proposal total")}
                    </div>
                    <div className="portal-deposit-summary">
                      <span>Required deposit</span>
                      <strong>{formatPortalCurrency(quote.deposit || 0)}</strong>
                    </div>
                  </>
                ) : (
                  <h3>Pricing {askAboutButton("the pricing")}</h3>
                )}
                {AMBIENT_DECISION_ROOM_ENABLED ? (
                  <details className="portal-price-breakdown">
                    <summary>View price details</summary>
                    <dl className="portal-price-list">
                      {pricingRows.map(([label, amount]) => (
                        <div key={label}><dt>{label}</dt><dd>{formatPortalCurrency(amount || 0)}</dd></div>
                      ))}
                    </dl>
                  </details>
                ) : (
                  <dl className="portal-price-list">
                    {pricingRows.map(([label, amount]) => (
                      <div key={label}><dt>{label}</dt><dd>{currency(amount || 0)}</dd></div>
                    ))}
                    <div className="portal-price-total"><dt>Total</dt><dd>{currency(quote.total || 0)}</dd></div>
                    <div className="portal-price-deposit"><dt>Deposit</dt><dd>{currency(quote.deposit || 0)}</dd></div>
                  </dl>
                )}
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

            {PILOT_DECISION_ROOM_ENABLED && (
              <section className="portal-detail-section portal-assumptions" data-portal-block="assumptions">
                {AMBIENT_DECISION_ROOM_ENABLED ? (
                  <details className="portal-secondary-disclosure">
                    <summary><h3>Planning assumptions</h3></summary>
                    <p className="portal-decidable-sub">
                      {[
                        Number(quote.eventGuests ?? quote.guests) > 0
                          ? `${quote.eventGuests ?? quote.guests} guests` : "",
                        quote.eventDate ? `on ${fmtDate(quote.eventDate)}` : "",
                        Number(quote.eventHours) > 0 ? `${quote.eventHours} hours of service` : "",
                        quote.eventStyle ? `${String(quote.eventStyle).toLowerCase()} service` : ""
                      ].filter(Boolean).join(" · ") || "The event details shown above."}
                      {" If anything changes, let your catering team know below. They will review the details and share an updated proposal before anything changes here."}
                    </p>
                    {askAboutButton("the planning assumptions")}
                  </details>
                ) : (
                  <h3>What this price assumes {askAboutButton("the assumptions")}</h3>
                )}
                {!AMBIENT_DECISION_ROOM_ENABLED && <p className="portal-decidable-sub">
                  {[
                    Number(quote.eventGuests ?? quote.guests) > 0
                      ? `${quote.eventGuests ?? quote.guests} guests` : "",
                    quote.eventDate ? `on ${fmtDate(quote.eventDate)}` : "",
                    Number(quote.eventHours) > 0 ? `${quote.eventHours} hours of service` : "",
                    quote.eventStyle ? `${String(quote.eventStyle).toLowerCase()} service` : ""
                  ].filter(Boolean).join(" · ") || (AMBIENT_DECISION_ROOM_ENABLED
                    ? "The event details shown above."
                    : "The recorded event details above.")}
                  {AMBIENT_DECISION_ROOM_ENABLED
                    ? " If anything changes, let your catering team know below. They will review the details and share an updated proposal before anything changes here."
                    : " If any of these change, ask below — your caterer re-prices from the updated details before anything is promised."}
                </p>}
              </section>
            )}

            {PILOT_DECISION_ROOM_ENABLED && String(quoteMeta.portalTermsText || "").trim() && (
              <section className="portal-detail-section portal-terms" data-portal-block="terms">
                {AMBIENT_DECISION_ROOM_ENABLED ? (
                  <details className="portal-secondary-disclosure">
                    <summary><h3>Terms from your catering team</h3></summary>
                    <p className="portal-terms-text">{quoteMeta.portalTermsText}</p>
                    {askAboutButton("the terms")}
                  </details>
                ) : (
                  <h3>Terms {askAboutButton("the terms")}</h3>
                )}
                {!AMBIENT_DECISION_ROOM_ENABLED && <p className="portal-terms-text">{quoteMeta.portalTermsText}</p>}
              </section>
            )}

            {PILOT_DECISION_ROOM_ENABLED && !decisionLocked
              && decidableOptions.length > 0 && (
              <section className="portal-decidable-options" data-portal-block="options" aria-labelledby="portal-decidable-title">
                {AMBIENT_DECISION_ROOM_ENABLED ? (
                  <div className="portal-section-heading">
                    <h3 id="portal-decidable-title">Optional additions</h3>
                  </div>
                ) : (
                  <h3 id="portal-decidable-title">Options you can ask to add</h3>
                )}
                {!AMBIENT_DECISION_ROOM_ENABLED && (
                  <p className="portal-decidable-sub">
                    Choosing one drafts a change request below — your caterer reviews and confirms it before anything about this proposal changes.
                  </p>
                )}
                <div className="portal-decidable-grid">
                  {decidableOptions.map((option) => {
                    const selected = stagedOptionKeys.includes(option.key);
                    if (!AMBIENT_DECISION_ROOM_ENABLED) {
                      return (
                        <button
                          type="button"
                          key={option.key}
                          className="ghost portal-decidable-card"
                          onClick={() => requestDecidableOption(option)}
                          disabled={state.busy}
                        >
                          <strong>{option.name}</strong>
                          <span>{decidableOptionPriceLabel(option)}</span>
                        </button>
                      );
                    }
                    return (
                    <button
                      type="button"
                      key={option.key}
                      className={`ghost portal-decidable-card${selected ? " is-selected" : ""}`}
                      onClick={() => requestDecidableOption(option)}
                      disabled={state.busy}
                      aria-pressed={selected}
                      aria-label={`${selected ? "Remove" : "Add"} ${option.name} ${selected ? "from" : "to"} request`}
                    >
                      <span className="portal-option-icon" aria-hidden="true">
                        {option.itemType === "rental"
                          ? <Armchair size={18} />
                          : option.itemType === "addon"
                            ? <Package size={18} />
                            : <ForkKnife size={18} />}
                      </span>
                      <span className="portal-decidable-card-copy">
                        <strong>{option.name}</strong>
                        <small>{decidableOptionPriceLabel(option)}</small>
                      </span>
                      <span className="portal-option-action" aria-hidden="true">
                        {selected ? "Selected" : "Add to request"}
                        {!selected && <Plus size={15} />}
                      </span>
                    </button>
                    );
                  })}
                </div>
                {AMBIENT_DECISION_ROOM_ENABLED && optionDraftFeedback && (
                  <div
                    className={`portal-inline-result portal-inline-result-${optionDraftFeedback.outcome}`}
                    role={optionDraftFeedback.outcome === "limit" ? "alert" : "status"}
                    data-option-draft-outcome={optionDraftFeedback.outcome}
                  >
                    <p>
                      {optionDraftFeedback.outcome === "added"
                        ? `${optionDraftFeedback.name} is in your request. Review the note below before sending it.`
                        : optionDraftFeedback.outcome === "removed"
                          ? `${optionDraftFeedback.name} was removed from your request. No proposal details changed.`
                          : optionDraftFeedback.outcome === "already_present"
                            ? `${optionDraftFeedback.name} is already written in your note. Your words were kept unchanged.`
                            : optionDraftFeedback.outcome === "missing"
                              ? `${optionDraftFeedback.name} is no longer in your note. No proposal details changed.`
                              : optionDraftFeedback.outcome === "discarded"
                                ? `${optionDraftFeedback.count === 1 ? "The optional addition was" : "The optional additions were"} removed when you changed your response. Your other words were kept.`
                                : "Your note is at its length limit. Review it below before adding another option."}
                    </p>
                    <button type="button" className="ghost compact" onClick={reviewOptionRequest}>
                      {optionDraftFeedback.outcome === "discarded" ? "Review response" : "Review request"}
                    </button>
                  </div>
                )}
              </section>
            )}

            {!decisionLocked && (
              <section
                className="portal-decision-panel"
                data-portal-region="decision-workspace"
                ref={decisionPanelRef}
                tabIndex={-1}
                aria-labelledby="portal-decision-title"
                aria-busy={state.busy || undefined}
              >
                {AMBIENT_DECISION_ROOM_ENABLED && <p className="portal-section-label">When you are ready</p>}
                <h3 id="portal-decision-title">
                  {AMBIENT_DECISION_ROOM_ENABLED ? "Your response" : "Your decision"}
                </h3>
                {AMBIENT_DECISION_ROOM_ENABLED && !decisionDraft && (
                  <p className="source-note portal-decision-intro">
                    Choose the response that matches what you want to do.
                  </p>
                )}
                <div className="portal-decision-options" role="group" aria-label="Proposal decision">
                  {decisionOptions.map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={decisionDraft === value ? "active" : ""}
                      aria-pressed={decisionDraft === value}
                      disabled={state.busy}
                      onClick={() => selectDecision(value)}
                    >
                      {AMBIENT_DECISION_ROOM_ENABLED && (
                        <span className="portal-decision-option-icon" aria-hidden="true">
                          {value === "accepted"
                            ? <CheckCircle size={19} />
                            : value === "changes_requested"
                              ? <NotePencil size={19} />
                              : <XCircle size={19} />}
                        </span>
                      )}
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                {!AMBIENT_DECISION_ROOM_ENABLED && !decisionDraft && (
                  <p className="source-note portal-decision-guidance">
                    Choose the response that matches what you want to do. Nothing is selected or submitted for you.
                  </p>
                )}
                {decisionDraft && <label className="field portal-decision-note">
                  <span>{decisionDraft === "changes_requested"
                    ? "Requested changes"
                    : AMBIENT_DECISION_ROOM_ENABLED
                      ? "Note for your catering team (optional)"
                      : "Note to staff (optional)"}</span>
                  <textarea
                    rows="4"
                    maxLength="1200"
                    value={decisionMessage}
                    onChange={(event) => {
                      const nextMessage = event.target.value;
                      setDecisionMessage(nextMessage);
                      setStagedOptionKeys((current) => current.filter((key) => {
                        const option = decidableOptions.find((candidate) => candidate.key === key);
                        return option && decisionRoomOptionSelected(nextMessage, option);
                      }));
                    }}
                    disabled={state.busy}
                    placeholder={decisionDraft === "changes_requested" ? "Describe what should be revised" : "Add any context for the catering team"}
                  />
                </label>}
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
                {decisionDraft && <div className="portal-decision-submit">
                  <button
                    type="button"
                    className="cta"
                    onClick={submitDecision}
                    disabled={state.busy}
                    aria-describedby="portal-decision-feedback"
                  >
                    {state.busy
                      ? "Submitting..."
                      : AMBIENT_DECISION_ROOM_ENABLED
                        ? decisionDraft === "accepted"
                          ? "Sign and accept proposal"
                          : decisionDraft === "changes_requested"
                            ? "Send change request"
                            : "Decline proposal"
                        : decisionDraft === "accepted"
                          ? "Sign and Accept Proposal"
                          : "Submit Decision"}
                  </button>
                </div>}
                <PortalDecisionMutationState
                  mutation={decisionMutation}
                  feedbackRef={decisionFeedbackRef}
                  onReconcile={() => reconcileDecisionAttempt(decisionAttemptRef.current)}
                  onRetryAcceptance={retryAcceptance}
                  onReviewLatest={reviewLatestProposal}
                  onReturnToDecision={returnToDecision}
                />
                {AMBIENT_DECISION_ROOM_ENABLED && portalConversationAvailable() && (
                  <section className="portal-question-shortcut" aria-label="Proposal question">
                    <span className="portal-question-shortcut-icon" aria-hidden="true"><ChatCircleDots size={20} /></span>
                    <div>
                      <strong>Ask a question</strong>
                      <span>Send a message to your catering team.</span>
                    </div>
                    <button
                      type="button"
                      className="ghost compact portal-question-action"
                      onClick={() => askAboutBlock("this proposal")}
                    >
                      Ask a question
                    </button>
                  </section>
                )}
              </section>
            )}

            {AMBIENT_DECISION_ROOM_ENABLED && decisionLocked && portalConversationAvailable() && (
              <section className="portal-question-shortcut" aria-label="Proposal question">
                <span className="portal-question-shortcut-icon" aria-hidden="true"><ChatCircleDots size={20} /></span>
                <div>
                  <strong>Ask a question</strong>
                  <span>Send a message to your catering team.</span>
                </div>
                <button
                  type="button"
                  className="ghost compact portal-question-action"
                  onClick={() => askAboutBlock("this proposal")}
                >
                  Ask a question
                </button>
              </section>
            )}

            {decisionLocked && decisionMutation.phase !== "ready" && (
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
              <div ref={conversationAnchorRef}>
                {AMBIENT_DECISION_ROOM_ENABLED && questionFeedback && (
                  <div
                    className={`portal-question-result portal-question-result-${questionFeedback.status}`}
                    role={["pending_attempt", "read_only", "unavailable"].includes(questionFeedback.status) ? "alert" : "status"}
                    data-question-prefill-outcome={questionFeedback.status}
                  >
                    <strong>
                      {questionFeedback.status === "pending"
                        ? "Opening your question"
                        : questionFeedback.status === "staged"
                          ? "Question ready"
                          : questionFeedback.status === "preserved_draft"
                            ? "Your draft is still here"
                            : "Your conversation needs attention"}
                    </strong>
                    <p>{questionFeedback.message}</p>
                  </div>
                )}
                <QuoteConversationPanel
                  title={AMBIENT_DECISION_ROOM_ENABLED
                    ? "Questions for your catering team"
                    : "Conversation with your catering team"}
                  access={{ accessMode: "portal", portalKey: quote.portalKey }}
                  prefill={PILOT_DECISION_ROOM_ENABLED ? conversationPrefill : null}
                  onPrefillResolution={AMBIENT_DECISION_ROOM_ENABLED ? handleQuestionPrefillResolution : null}
                />
              </div>
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
