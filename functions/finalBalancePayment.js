const {
  PAYMENT_LEDGER_VERSION,
  PaymentLedgerError,
  planPaymentLedgerTransition,
  projectPaymentLedger
} = require("./paymentLedger");
const {
  PaymentSafetyError,
  normalizeCheckoutTransitionState
} = require("./paymentSafety");

const FINAL_BALANCE_CURRENCY = "usd";
const FINAL_BALANCE_STATUSES = new Set(["unpaid", "sent", "paid"]);

function text(value) {
  return String(value ?? "").trim();
}

function amountToCents(value, label) {
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents)) {
    throw new PaymentLedgerError(`${label} cannot be represented safely in cents.`);
  }
  return cents;
}

function quotePaymentAmounts(quote = {}) {
  const totalCents = amountToCents(quote?.totals?.total, "Quote total");
  const depositCents = amountToCents(quote?.totals?.deposit, "Quote deposit");
  if (depositCents <= 0 || depositCents >= totalCents) {
    throw new PaymentLedgerError(
      "Final balance requires a positive deposit below the authoritative quote total."
    );
  }
  return {
    totalCents,
    depositCents,
    finalBalanceCents: totalCents - depositCents
  };
}

function normalizeFinalBalanceCheckoutPayment(payment = {}) {
  const source = payment?.finalBalance && typeof payment.finalBalance === "object"
    ? payment.finalBalance
    : {};
  const status = text(source.status).toLowerCase() || "unpaid";
  if (!FINAL_BALANCE_STATUSES.has(status)) {
    throw new PaymentSafetyError("The stored final-balance status is invalid.");
  }
  return normalizeCheckoutTransitionState({
    depositStatus: status,
    depositLink: source.paymentLink,
    depositConfirmedAtISO: source.confirmedAtISO,
    stripeSessionId: source.stripeSessionId,
    stripeCheckoutState: source.stripeCheckoutState,
    checkoutGeneration: source.checkoutGeneration,
    knownStripeSessionIds: source.knownStripeSessionIds
  });
}

function finalBalanceStoredState(checkoutPayment, {
  amountCents,
  currency = FINAL_BALANCE_CURRENCY
} = {}) {
  const normalized = normalizeCheckoutTransitionState(checkoutPayment);
  const normalizedAmount = Number(amountCents);
  const normalizedCurrency = text(currency).toLowerCase();
  if (!Number.isSafeInteger(normalizedAmount) || normalizedAmount <= 0) {
    throw new PaymentLedgerError("Final-balance amount must be a positive safe integer in cents.");
  }
  if (!/^[a-z]{3}$/.test(normalizedCurrency)) {
    throw new PaymentLedgerError("Final-balance currency is invalid.");
  }
  return {
    amountCents: normalizedAmount,
    currency: normalizedCurrency,
    status: normalized.depositStatus,
    paymentLink: normalized.depositLink,
    confirmedAtISO: normalized.depositConfirmedAtISO,
    stripeSessionId: normalized.stripeSessionId,
    stripeCheckoutState: normalized.stripeCheckoutState,
    checkoutGeneration: normalized.checkoutGeneration,
    knownStripeSessionIds: [...normalized.knownStripeSessionIds]
  };
}

function bootstrapPaidDepositEntry(quote = {}) {
  const amounts = quotePaymentAmounts(quote);
  const payment = quote?.payment || {};
  const depositStatus = text(payment.depositStatus).toLowerCase();
  const stripeSessionId = text(payment.stripeSessionId);
  const confirmedAtISO = text(payment.depositConfirmedAtISO);
  if (
    depositStatus !== "paid"
    || !/^cs_[A-Za-z0-9_]+$/.test(stripeSessionId)
    || !confirmedAtISO
    || Number.isNaN(new Date(confirmedAtISO).getTime())
  ) {
    throw new PaymentLedgerError(
      "Final balance requires provider-settled deposit evidence with a Stripe session and timestamp."
    );
  }
  return {
    operationId: `legacy-deposit:${stripeSessionId}`,
    paymentKind: "deposit",
    amountCents: amounts.depositCents,
    state: "paid",
    providerReference: stripeSessionId,
    providerSettledAtISO: new Date(confirmedAtISO).toISOString()
  };
}

function paymentLedgerEntriesForQuote(quote = {}) {
  const ledger = quote?.payment?.ledger;
  if (ledger == null) return [bootstrapPaidDepositEntry(quote)];
  if (
    !ledger
    || typeof ledger !== "object"
    || Array.isArray(ledger)
    || Number(ledger.version) !== PAYMENT_LEDGER_VERSION
    || !Array.isArray(ledger.entries)
  ) {
    throw new PaymentLedgerError("Stored payment ledger is invalid.");
  }
  return ledger.entries;
}

function projectQuotePaymentLedger(quote = {}) {
  const entries = paymentLedgerEntriesForQuote(quote);
  return projectPaymentLedger({
    quoteTotals: quote?.totals,
    entries,
    legacyPayment: quote?.payment
  });
}

function planFinalBalanceLedgerTransition({
  quote = {},
  operationId,
  amountCents,
  nextState,
  providerReference = "",
  providerSettledAtISO = ""
} = {}) {
  const current = projectQuotePaymentLedger(quote);
  if (Number(amountCents) !== current.finalBalanceCents) {
    throw new PaymentLedgerError(
      "Final-balance amount does not match the authoritative quote balance."
    );
  }
  const planned = planPaymentLedgerTransition({
    quoteTotals: quote?.totals,
    entries: current.entries,
    legacyPayment: quote?.payment,
    operationId,
    paymentKind: "final_balance",
    amountCents: current.finalBalanceCents,
    nextState,
    providerReference,
    providerSettledAtISO
  });
  return {
    ...planned,
    ledger: {
      version: PAYMENT_LEDGER_VERSION,
      entries: planned.projection.entries.map((entry) => ({ ...entry }))
    }
  };
}

function buildFinalBalanceStripeScopeQuote(quote = {}, checkoutPayment = null) {
  const amounts = quotePaymentAmounts(quote);
  const scopedPayment = checkoutPayment
    ? normalizeCheckoutTransitionState(checkoutPayment)
    : normalizeFinalBalanceCheckoutPayment(quote?.payment);
  return {
    ...quote,
    totals: {
      ...(quote?.totals || {}),
      deposit: amounts.finalBalanceCents / 100
    },
    payment: {
      ...(quote?.payment || {}),
      ...scopedPayment
    }
  };
}

function ledgerStateForProviderState(providerState) {
  const normalized = text(providerState).toLowerCase();
  if (!new Set(["processing", "paid", "failed", "expired"]).has(normalized)) {
    throw new PaymentLedgerError("Stripe provider state cannot be projected to final balance.");
  }
  return normalized;
}

module.exports = {
  FINAL_BALANCE_CURRENCY,
  buildFinalBalanceStripeScopeQuote,
  finalBalanceStoredState,
  ledgerStateForProviderState,
  normalizeFinalBalanceCheckoutPayment,
  paymentLedgerEntriesForQuote,
  planFinalBalanceLedgerTransition,
  projectQuotePaymentLedger,
  quotePaymentAmounts
};
