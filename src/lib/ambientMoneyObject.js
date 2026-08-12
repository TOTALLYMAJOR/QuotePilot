import { createIntelligentObjectDescriptor } from "./ambientContracts";
import {
  classifyDepositStatus,
  classifyFinalBalanceDisplayStatus,
  getFinalBalanceDisplayStatus
} from "./statusSemantics";

export const AMBIENT_MONEY_OBJECT_MODEL = "ambient-money-object-v1";

const DEPOSIT_STATUSES = new Set(["unpaid", "sent", "paid", "refunded"]);
const FINAL_BALANCE_STATUSES = new Set(["unpaid", "sent", "paid"]);
const CHECKOUT_STATES = new Set(["", "prepared", "open", "processing", "paid", "failed", "expired"]);

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function finiteMoneyCents(value) {
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(cents)
    ? cents
    : null;
}

function safeStoredCents(value) {
  const cents = Number(value);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function iso(value) {
  const candidate = text(value);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function checkoutSession(value) {
  const candidate = text(value);
  return /^cs_[A-Za-z0-9_]+$/u.test(candidate) ? candidate : "";
}

function checkoutLink(value) {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && parsed.hostname === "checkout.stripe.com"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
}

function sourceIsConnected(sourceMode) {
  return sourceMode === "firebase";
}

function quotedCurrency(quote) {
  const currency = lower(quote?.payment?.finalBalance?.currency || quote?.pricing?.currency || "usd");
  return /^[a-z]{3}$/u.test(currency) ? currency : "usd";
}

function buildPolicy(quote) {
  const totalCents = finiteMoneyCents(quote?.totals?.total);
  const storedDepositCents = finiteMoneyCents(quote?.totals?.deposit);
  const pricingDepositCents = finiteMoneyCents(quote?.pricing?.deposit?.amount);
  const pricingTotalCents = finiteMoneyCents(quote?.pricing?.grandTotal);
  const pricingAuthority = lower(quote?.pricing?.authority);
  const authoritative = pricingAuthority === "server_authoritative"
    && pricingDepositCents !== null
    && pricingTotalCents !== null
    && storedDepositCents === pricingDepositCents
    && totalCents === pricingTotalCents;
  const amountCents = authoritative ? pricingDepositCents : storedDepositCents;
  const pct = amountCents !== null && totalCents > 0
    ? amountCents / totalCents
    : null;
  const invalid = amountCents === null
    || totalCents === null
    || amountCents > totalCents
    || (pricingAuthority === "server_authoritative" && !authoritative);

  return {
    id: "deposit-policy",
    label: "Deposit policy",
    state: invalid ? "unavailable" : "recorded",
    evidenceAuthority: authoritative ? "server_authoritative_pricing" : "stored_quote_record",
    amountCents: invalid ? null : amountCents,
    percentage: invalid ? null : pct,
    observedAtISO: authoritative ? iso(quote?.pricing?.calculatedAt) : iso(quote?.updatedAtISO),
    reason: invalid
      ? "The deposit requirement does not reconcile with the recorded quote total and pricing evidence."
      : authoritative
        ? "The stored deposit requirement matches the server-authoritative pricing snapshot."
        : "This is the deposit requirement recorded on the quote; it is not a payment request or settlement receipt.",
    consequence: "Changing price or deposit policy can change both the deposit requirement and remaining balance."
  };
}

function buildDepositRequest(quote, connected) {
  const payment = quote?.payment || {};
  const status = lower(payment.depositStatus || "unpaid");
  const validStatus = DEPOSIT_STATUSES.has(status);
  const link = checkoutLink(payment.depositLink);
  const sessionId = checkoutSession(payment.stripeSessionId);
  const checkoutState = lower(payment.stripeCheckoutState);
  const validCheckoutState = CHECKOUT_STATES.has(checkoutState);
  const currentlyRequested = status === "sent";
  const requestEvidenceComplete = currentlyRequested
    && Boolean(link)
    && Boolean(sessionId)
    && checkoutState === "open";
  const malformedRequest = currentlyRequested && !requestEvidenceComplete;

  let state = "not_requested";
  if (!validStatus || !validCheckoutState || malformedRequest) state = "unavailable";
  else if (requestEvidenceComplete && connected) state = "provider_request_recorded";
  else if (requestEvidenceComplete) state = "recorded_unverified";
  else if (["paid", "refunded"].includes(status)) state = "superseded_by_settlement";

  return {
    id: "deposit-request",
    label: "Deposit request",
    state,
    displayStatus: classifyDepositStatus(status),
    evidenceAuthority: state === "provider_request_recorded"
      ? "firebase_backed_provider_checkout"
      : state === "recorded_unverified"
        ? "local_record_only"
        : "none",
    amountCents: finiteMoneyCents(quote?.totals?.deposit),
    providerReferencePresent: Boolean(sessionId),
    reason: state === "provider_request_recorded"
      ? "A published Stripe Checkout request is recorded on the connected quote. This is not payment evidence."
      : state === "recorded_unverified"
        ? "A checkout request is recorded locally, but the connected provider-backed quote was not read."
        : state === "superseded_by_settlement"
          ? "The current record is settled; the request rail remains a separate historical evidence domain."
          : state === "unavailable"
            ? "The stored deposit request fields are incomplete or contradictory."
            : "No current deposit request is recorded.",
    consequence: "Requesting a deposit creates a payment rail; it does not establish payment, acceptance, or booking."
  };
}

function buildDepositSettlement(quote, connected) {
  const payment = quote?.payment || {};
  const status = lower(payment.depositStatus || "unpaid");
  const validStatus = DEPOSIT_STATUSES.has(status);
  const providerReference = checkoutSession(payment.stripeSessionId);
  const paidAtISO = iso(payment.depositConfirmedAtISO);
  const refundedAtISO = iso(payment.depositRefundedAtISO || payment.refundedAtISO);
  const isPaid = status === "paid";
  const isRefunded = status === "refunded";
  const evidenceAtISO = isPaid ? paidAtISO : isRefunded ? refundedAtISO : "";
  const evidenceComplete = (isPaid || isRefunded) && Boolean(providerReference) && Boolean(evidenceAtISO);
  const contradictory = !validStatus
    || ((isPaid || isRefunded) && !evidenceComplete)
    || (!["paid", "refunded"].includes(status) && Boolean(paidAtISO || refundedAtISO));

  let state = "not_settled";
  if (contradictory) state = "unavailable";
  else if (evidenceComplete && connected) state = isRefunded ? "provider_confirmed_refund" : "provider_confirmed_paid";
  else if (evidenceComplete) state = "recorded_unverified";

  return {
    id: "deposit-settlement",
    label: "Provider-confirmed deposit",
    state,
    amountCents: finiteMoneyCents(quote?.totals?.deposit),
    evidenceAtISO,
    providerReferencePresent: Boolean(providerReference),
    evidenceAuthority: state.startsWith("provider_confirmed")
      ? "firebase_backed_verified_provider_event"
      : state === "recorded_unverified"
        ? "local_record_only"
        : "none",
    reason: state === "provider_confirmed_paid"
      ? "The connected quote records a paid deposit with a Stripe session and provider confirmation timestamp."
      : state === "provider_confirmed_refund"
        ? "The connected quote records a refunded deposit with a Stripe session and provider timestamp."
        : state === "recorded_unverified"
          ? "Settlement-shaped fields are present locally, but local browser state cannot prove provider payment."
          : state === "unavailable"
            ? "The stored deposit status conflicts with its provider reference or timestamp evidence."
            : "No provider-confirmed deposit settlement is recorded.",
    consequence: "Only verified provider evidence may establish paid or refunded deposit state. A browser return never does."
  };
}

function finalBalanceAmount(quote, policy) {
  const totalCents = finiteMoneyCents(quote?.totals?.total);
  const expected = totalCents !== null && policy.amountCents !== null
    ? totalCents - policy.amountCents
    : null;
  const stored = safeStoredCents(quote?.payment?.finalBalance?.amountCents);
  if (expected === null || expected < 0) return { amountCents: null, reconciled: false };
  if (stored !== null && stored !== expected) return { amountCents: null, reconciled: false };
  return { amountCents: stored ?? expected, reconciled: true };
}

function buildBalanceRequest(quote, connected, balanceAmount) {
  const balance = quote?.payment?.finalBalance || {};
  const status = lower(balance.status || "unpaid");
  const checkoutState = lower(balance.stripeCheckoutState);
  const validStatus = FINAL_BALANCE_STATUSES.has(status);
  const validCheckoutState = CHECKOUT_STATES.has(checkoutState);
  const link = checkoutLink(balance.paymentLink);
  const sessionId = checkoutSession(balance.stripeSessionId);
  const requestEvidenceComplete = status === "sent"
    && Boolean(link)
    && Boolean(sessionId)
    && ["open", "processing"].includes(checkoutState);
  const malformed = status === "sent" && !requestEvidenceComplete;

  let state = "not_requested";
  if (!balanceAmount.reconciled || !validStatus || !validCheckoutState || malformed) state = "unavailable";
  else if (requestEvidenceComplete && connected) state = "provider_request_recorded";
  else if (requestEvidenceComplete) state = "recorded_unverified";
  else if (status === "paid") state = "superseded_by_settlement";

  return {
    id: "balance-request",
    label: "Balance request",
    state,
    displayStatus: classifyFinalBalanceDisplayStatus(getFinalBalanceDisplayStatus(balance)),
    amountCents: balanceAmount.amountCents,
    providerReferencePresent: Boolean(sessionId),
    evidenceAuthority: state === "provider_request_recorded"
      ? "firebase_backed_provider_checkout"
      : state === "recorded_unverified"
        ? "local_record_only"
        : "none",
    reason: state === "provider_request_recorded"
      ? "A final-balance Stripe Checkout request is recorded on the connected quote. This is not settlement evidence."
      : state === "recorded_unverified"
        ? "A balance request is recorded locally, but the connected provider-backed quote was not read."
        : state === "superseded_by_settlement"
          ? "The final balance is settled; the request remains a separate historical evidence domain."
          : state === "unavailable"
            ? "The stored balance amount or request fields do not reconcile with the quote."
            : "No current final-balance request is recorded.",
    consequence: "A balance request opens a separate payment rail and cannot establish final settlement."
  };
}

function buildFinalSettlement(quote, connected, balanceAmount) {
  const balance = quote?.payment?.finalBalance || {};
  const status = lower(balance.status || "unpaid");
  const providerReference = checkoutSession(balance.stripeSessionId);
  const confirmedAtISO = iso(balance.confirmedAtISO);
  const evidenceComplete = status === "paid"
    && balanceAmount.reconciled
    && Boolean(providerReference)
    && Boolean(confirmedAtISO);
  const contradictory = !FINAL_BALANCE_STATUSES.has(status)
    || (status === "paid" && !evidenceComplete)
    || (status !== "paid" && Boolean(confirmedAtISO));

  let state = "not_settled";
  if (contradictory || !balanceAmount.reconciled) state = "unavailable";
  else if (evidenceComplete && connected) state = "provider_confirmed_paid";
  else if (evidenceComplete) state = "recorded_unverified";

  return {
    id: "final-settlement",
    label: "Final settlement",
    state,
    amountCents: balanceAmount.amountCents,
    evidenceAtISO: confirmedAtISO,
    providerReferencePresent: Boolean(providerReference),
    evidenceAuthority: state === "provider_confirmed_paid"
      ? "firebase_backed_verified_provider_event"
      : state === "recorded_unverified"
        ? "local_record_only"
        : "none",
    reason: state === "provider_confirmed_paid"
      ? "The connected quote records a paid final balance with a Stripe session and provider confirmation timestamp."
      : state === "recorded_unverified"
        ? "Settlement-shaped fields are present locally, but local browser state cannot prove provider payment."
        : state === "unavailable"
          ? "The final-balance amount, status, provider reference, or timestamp evidence is incomplete or contradictory."
          : "No provider-confirmed final settlement is recorded.",
    consequence: "Only verified final-balance provider evidence may establish settlement; deposit payment remains a separate rail."
  };
}

function nextResolution(stages) {
  const [policy, request, deposit, balanceRequest, settlement] = stages;
  if (policy.state === "unavailable") return "Reconcile the quote pricing and deposit requirement.";
  if (request.state === "unavailable" || deposit.state === "unavailable") {
    return "Reconcile the exact deposit request and provider evidence.";
  }
  if (deposit.state === "not_settled" && request.state === "provider_request_recorded") {
    return "Wait for or reconcile the verified deposit provider result.";
  }
  if (deposit.state === "not_settled") return "Review deposit-request eligibility in the governed workflow.";
  if (balanceRequest.state === "unavailable" || settlement.state === "unavailable") {
    return "Reconcile the exact final-balance amount and provider evidence.";
  }
  if (settlement.state === "not_settled" && balanceRequest.state === "provider_request_recorded") {
    return "Wait for or reconcile the verified final-balance provider result.";
  }
  if (settlement.state === "not_settled") return "Review final-balance eligibility after contract conversion.";
  return "Payment evidence is caught up; continue with the next unresolved operational action.";
}

function doNothingOutcome(stages) {
  const states = stages
    .map((stage) => `${stage.label.toLowerCase()}: ${stage.state.replaceAll("_", " ")}`)
    .join("; ");
  return `Nothing is requested, collected, reconciled, or repriced by inspecting this object. The recorded evidence remains unchanged (${states}).`;
}

export function buildAmbientMoneyObject(quote = {}, { sourceMode = "local" } = {}) {
  const connected = sourceIsConnected(sourceMode);
  const policy = buildPolicy(quote);
  const balanceAmount = finalBalanceAmount(quote, policy);
  const stages = [
    policy,
    buildDepositRequest(quote, connected),
    buildDepositSettlement(quote, connected),
    buildBalanceRequest(quote, connected, balanceAmount),
    buildFinalSettlement(quote, connected, balanceAmount)
  ];
  const unavailable = stages.some((stage) => stage.state === "unavailable");
  const descriptor = createIntelligentObjectDescriptor({
    id: "money",
    type: "commercial-evidence",
    label: "Money",
    summary: `${stages[0].label}, ${stages[1].label}, ${stages[2].label}, ${stages[3].label}, and ${stages[4].label} remain separate evidence domains.`,
    inspectorSurfaceId: "money-context",
    dependencies: [
      {
        object: { id: "pricing", type: "intelligent-object", label: "Pricing" },
        relationship: "defines the total and deposit requirement",
        consequence: "A new trusted price can change the required deposit and remaining balance."
      },
      {
        object: { id: "proposal", type: "intelligent-object", label: "Proposal" },
        relationship: "establishes the customer-decision scope",
        consequence: "Payment-request eligibility depends on the exact current proposal and lifecycle evidence."
      },
      {
        object: { id: "provider-payment", type: "evidence-domain", label: "Provider payment" },
        relationship: "establishes settlement only through verified provider events",
        consequence: "Browser returns and local records cannot upgrade a request into payment."
      },
      {
        object: { id: "contract", type: "evidence-domain", label: "Contract" },
        relationship: "governs final-balance eligibility",
        consequence: "The final-balance rail remains unavailable until the required contract evidence exists."
      }
    ],
    why: "QuotePilot separates policy, request, and settlement so one money state never fabricates another.",
    consequence: "Pricing changes can alter requirements; request actions can open provider rails; only verified provider receipts can establish settlement.",
    doNothing: doNothingOutcome(stages),
    confidence: {
      level: unavailable ? "unavailable" : connected ? "high" : "medium",
      basis: unavailable
        ? "One or more stored money evidence domains are incomplete or contradictory."
        : connected
          ? "The object was built from a Firebase-backed quote while retaining provider and pricing evidence boundaries."
          : "The object was built from local quote data; provider confirmation remains explicitly unverified."
    },
    provenance: [{
      sourceId: `quote-money:${text(quote?.activeVersionId || quote?.id || "unknown")}`,
      label: connected ? "Connected quote money evidence" : "Local quote money record",
      type: connected ? "firebase_quote_snapshot" : "local_quote_snapshot",
      state: "available",
      observedAt: iso(quote?.updatedAtISO) || null,
      reason: null
    }],
    recommendation: null,
    permissions: {
      view: true,
      simulate: false,
      stage: false,
      commit: false,
      reason: "The Money object is read-only; governed payment and pricing workflows retain all mutation authority."
    },
    actionIds: ["inspect-money"]
  });

  return deepFreeze({
    modelId: AMBIENT_MONEY_OBJECT_MODEL,
    currency: quotedCurrency(quote),
    sourceMode: connected ? "firebase" : "local",
    descriptor,
    stages,
    nextResolution: nextResolution(stages),
    boundary: "Deposit policy, deposit request, provider-confirmed deposit, balance request, and final settlement are never collapsed. Browser returns, local state, proposal acceptance, booking, and provider payment remain distinct."
  });
}
