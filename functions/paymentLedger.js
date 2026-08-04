const PAYMENT_LEDGER_VERSION = 1;
const PAYMENT_KINDS = Object.freeze(["deposit", "final_balance"]);
const PAYMENT_STATES = Object.freeze([
  "prepared",
  "sent",
  "processing",
  "paid",
  "failed",
  "expired"
]);

const PAYMENT_KIND_SET = new Set(PAYMENT_KINDS);
const PAYMENT_STATE_SET = new Set(PAYMENT_STATES);
const ACTIVE_PAYMENT_STATES = new Set(["prepared", "sent", "processing"]);
const TERMINAL_PAYMENT_STATES = new Set(["paid"]);
const LEGACY_DEPOSIT_STATUSES = new Set(["unpaid", "sent", "paid"]);
const PAYMENT_STATE_TRANSITIONS = Object.freeze({
  prepared: new Set(["sent", "processing", "paid", "failed", "expired"]),
  sent: new Set(["processing", "paid", "failed", "expired"]),
  processing: new Set(["paid", "failed", "expired"]),
  paid: new Set(),
  failed: new Set(["paid"]),
  expired: new Set(["paid"])
});

class PaymentLedgerError extends Error {
  constructor(message, code = "failed-precondition") {
    super(message);
    this.name = "PaymentLedgerError";
    this.code = code;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function hasOwn(value, key) {
  return Boolean(value)
    && typeof value === "object"
    && Object.prototype.hasOwnProperty.call(value, key);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function normalizeIdentifier(value, label) {
  const normalized = text(value);
  if (
    normalized.length > 200
    || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]*$/.test(normalized)
  ) {
    throw new PaymentLedgerError(`${label} is invalid.`);
  }
  return normalized;
}

function normalizeOptionalProviderReference(value) {
  const normalized = text(value);
  return normalized ? normalizeIdentifier(normalized, "Payment provider reference") : "";
}

function normalizeISO(value, label, { required = false } = {}) {
  const normalized = text(value);
  if (!normalized) {
    if (required) throw new PaymentLedgerError(`${label} is required.`);
    return "";
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new PaymentLedgerError(`${label} is invalid.`);
  }
  return parsed.toISOString();
}

function assertSafeCents(value, label, { allowZero = true } = {}) {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || (!allowZero && value === 0)
  ) {
    throw new PaymentLedgerError(
      `${label} must be ${allowZero ? "a non-negative" : "a positive"} safe integer in cents.`
    );
  }
  return value;
}

function decimalAmountToCents(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new PaymentLedgerError(`${label} must be a non-negative finite number.`);
  }
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (
    !Number.isSafeInteger(cents)
  ) {
    throw new PaymentLedgerError(`${label} cannot be represented safely in cents.`);
  }
  return cents;
}

function normalizeQuotePaymentAmounts(quoteTotals = {}) {
  if (!quoteTotals || typeof quoteTotals !== "object" || Array.isArray(quoteTotals)) {
    throw new PaymentLedgerError("Quote totals are required.");
  }

  const hasExplicitCents = hasOwn(quoteTotals, "totalCents")
    || hasOwn(quoteTotals, "depositCents");
  let totalCents;
  let depositCents;

  if (hasExplicitCents) {
    if (!hasOwn(quoteTotals, "totalCents") || !hasOwn(quoteTotals, "depositCents")) {
      throw new PaymentLedgerError(
        "Quote totalCents and depositCents must be supplied together."
      );
    }
    totalCents = assertSafeCents(quoteTotals.totalCents, "Quote total");
    depositCents = assertSafeCents(quoteTotals.depositCents, "Quote deposit");

    if (
      hasOwn(quoteTotals, "total")
      && decimalAmountToCents(quoteTotals.total, "Quote total") !== totalCents
    ) {
      throw new PaymentLedgerError("Quote total dollars and cents are inconsistent.");
    }
    if (
      hasOwn(quoteTotals, "deposit")
      && decimalAmountToCents(quoteTotals.deposit, "Quote deposit") !== depositCents
    ) {
      throw new PaymentLedgerError("Quote deposit dollars and cents are inconsistent.");
    }
  } else {
    if (!hasOwn(quoteTotals, "total") || !hasOwn(quoteTotals, "deposit")) {
      throw new PaymentLedgerError("Quote total and deposit are required.");
    }
    totalCents = decimalAmountToCents(quoteTotals.total, "Quote total");
    depositCents = decimalAmountToCents(quoteTotals.deposit, "Quote deposit");
  }

  if (depositCents > totalCents) {
    throw new PaymentLedgerError("Quote deposit cannot exceed the quote total.");
  }

  return {
    totalCents,
    depositCents,
    finalBalanceCents: totalCents - depositCents
  };
}

function normalizePaymentKind(value) {
  const normalized = text(value).toLowerCase();
  if (!PAYMENT_KIND_SET.has(normalized)) {
    throw new PaymentLedgerError("Payment kind must be deposit or final_balance.");
  }
  return normalized;
}

function normalizePaymentState(value) {
  const normalized = text(value).toLowerCase();
  if (!PAYMENT_STATE_SET.has(normalized)) {
    throw new PaymentLedgerError("Payment state is invalid.");
  }
  return normalized;
}

function normalizePaymentLedgerEntry(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PaymentLedgerError("Payment ledger entry is invalid.");
  }
  const state = normalizePaymentState(input.state);
  const providerReference = normalizeOptionalProviderReference(input.providerReference);
  const providerSettledAtISO = normalizeISO(
    input.providerSettledAtISO,
    "Provider settlement timestamp",
    { required: state === "paid" }
  );
  if (state === "paid" && !providerReference) {
    throw new PaymentLedgerError("Paid payment evidence requires a provider reference.");
  }
  if (state !== "paid" && providerSettledAtISO) {
    throw new PaymentLedgerError(
      "Only paid provider evidence may include a settlement timestamp."
    );
  }
  if (["sent", "processing"].includes(state) && !providerReference) {
    throw new PaymentLedgerError(`${state} payment evidence requires a provider reference.`);
  }

  return deepFreeze({
    operationId: normalizeIdentifier(input.operationId, "Payment operation id"),
    paymentKind: normalizePaymentKind(input.paymentKind),
    amountCents: assertSafeCents(input.amountCents, "Payment amount", { allowZero: false }),
    state,
    providerReference,
    providerSettledAtISO
  });
}

function normalizePaymentLedgerEntries(entries = []) {
  if (!Array.isArray(entries)) {
    throw new PaymentLedgerError("Payment ledger entries must be an array.");
  }
  const operationIds = new Set();
  const providerReferences = new Set();
  return entries.map((entry) => {
    const normalized = normalizePaymentLedgerEntry(entry);
    if (operationIds.has(normalized.operationId)) {
      throw new PaymentLedgerError("Payment operation ids must be unique.");
    }
    operationIds.add(normalized.operationId);
    if (normalized.providerReference) {
      if (providerReferences.has(normalized.providerReference)) {
        throw new PaymentLedgerError("Payment provider references must be unique.");
      }
      providerReferences.add(normalized.providerReference);
    }
    return normalized;
  });
}

function checkedAddCents(current, amount, label) {
  if (current > Number.MAX_SAFE_INTEGER - amount) {
    throw new PaymentLedgerError(`${label} exceeds the safe integer range.`);
  }
  return current + amount;
}

function projectKind(entries, paymentKind, expectedAmountCents) {
  const kindEntries = entries.filter((entry) => entry.paymentKind === paymentKind);
  for (const entry of kindEntries) {
    if (expectedAmountCents <= 0 || entry.amountCents !== expectedAmountCents) {
      throw new PaymentLedgerError(
        `${paymentKind} payment amount does not match the authoritative quote amount.`
      );
    }
  }

  const activeEntries = kindEntries.filter((entry) => ACTIVE_PAYMENT_STATES.has(entry.state));
  const paidEntries = kindEntries.filter((entry) => entry.state === "paid");
  if (activeEntries.length > 1) {
    throw new PaymentLedgerError(`Only one active ${paymentKind} payment is allowed.`);
  }
  if (paidEntries.length > 1) {
    throw new PaymentLedgerError(`Only one settled ${paymentKind} payment is allowed.`);
  }
  if (paidEntries.length && activeEntries.length) {
    throw new PaymentLedgerError(
      `A settled ${paymentKind} payment cannot have another active operation.`
    );
  }

  const latestEntry = kindEntries.at(-1) || null;
  const activeEntry = activeEntries[0] || null;
  const paidEntry = paidEntries[0] || null;
  if (activeEntry && latestEntry?.operationId !== activeEntry.operationId) {
    throw new PaymentLedgerError(
      `The active ${paymentKind} payment must be the latest operation for that kind.`
    );
  }
  if (paidEntry && kindEntries.indexOf(paidEntry) !== kindEntries.length - 1) {
    throw new PaymentLedgerError(
      `A settled ${paymentKind} payment cannot be followed by another operation.`
    );
  }

  return {
    paymentKind,
    expectedAmountCents,
    state: paidEntry?.state || activeEntry?.state || latestEntry?.state || "not_started",
    paidCents: paidEntry?.amountCents || 0,
    latestOperationId: latestEntry?.operationId || "",
    activeOperationId: activeEntry?.operationId || "",
    settledOperationId: paidEntry?.operationId || "",
    providerReference: paidEntry?.providerReference
      || activeEntry?.providerReference
      || latestEntry?.providerReference
      || "",
    providerSettledAtISO: paidEntry?.providerSettledAtISO || ""
  };
}

function legacyDepositStatusForState(state) {
  if (state === "paid") return "paid";
  if (["sent", "processing"].includes(state)) return "sent";
  return "unpaid";
}

function legacyCheckoutStateForState(state) {
  if (state === "not_started") return "";
  if (state === "sent") return "open";
  return state;
}

function assertLegacyPaymentConsistent(legacyPayment, derivedLegacyPayment) {
  if (legacyPayment === undefined || legacyPayment === null) return;
  if (typeof legacyPayment !== "object" || Array.isArray(legacyPayment)) {
    throw new PaymentLedgerError("Legacy payment data is invalid.");
  }

  const depositStatus = text(legacyPayment.depositStatus).toLowerCase() || "unpaid";
  if (!LEGACY_DEPOSIT_STATUSES.has(depositStatus)) {
    throw new PaymentLedgerError(
      "Legacy deposit status cannot be represented by this payment ledger."
    );
  }
  if (depositStatus !== derivedLegacyPayment.depositStatus) {
    throw new PaymentLedgerError("Legacy deposit status contradicts the payment ledger.");
  }

  const confirmedAtISO = normalizeISO(
    legacyPayment.depositConfirmedAtISO,
    "Legacy deposit confirmation timestamp"
  );
  if (depositStatus === "paid") {
    if (!confirmedAtISO || confirmedAtISO !== derivedLegacyPayment.depositConfirmedAtISO) {
      throw new PaymentLedgerError(
        "Legacy paid deposit confirmation contradicts the payment ledger."
      );
    }
  } else if (confirmedAtISO) {
    throw new PaymentLedgerError(
      "Legacy unpaid deposit data cannot include a confirmation timestamp."
    );
  }

  const stripeSessionId = text(legacyPayment.stripeSessionId);
  if (stripeSessionId && stripeSessionId !== derivedLegacyPayment.stripeSessionId) {
    throw new PaymentLedgerError("Legacy Stripe session contradicts the payment ledger.");
  }

  const stripeCheckoutState = text(legacyPayment.stripeCheckoutState).toLowerCase();
  if (
    stripeCheckoutState
    && stripeCheckoutState !== derivedLegacyPayment.stripeCheckoutState
  ) {
    throw new PaymentLedgerError("Legacy Stripe checkout state contradicts the payment ledger.");
  }
}

function projectPaymentLedger({ quoteTotals, entries = [], legacyPayment } = {}) {
  const amounts = normalizeQuotePaymentAmounts(quoteTotals);
  const normalizedEntries = normalizePaymentLedgerEntries(entries);
  let netPaidCents = 0;
  for (const entry of normalizedEntries) {
    if (entry.state !== "paid") continue;
    netPaidCents = checkedAddCents(netPaidCents, entry.amountCents, "Net paid amount");
  }
  if (netPaidCents > amounts.totalCents) {
    throw new PaymentLedgerError("Payment ledger records an overpayment.");
  }

  const deposit = projectKind(normalizedEntries, "deposit", amounts.depositCents);
  const finalBalance = projectKind(
    normalizedEntries,
    "final_balance",
    amounts.finalBalanceCents
  );

  if (
    finalBalance.state !== "not_started"
    && amounts.depositCents > 0
    && deposit.state !== "paid"
  ) {
    throw new PaymentLedgerError(
      "Final-balance operations require provider-settled deposit evidence."
    );
  }

  const finalDueCents = amounts.totalCents - netPaidCents;
  const derivedLegacyPayment = {
    depositStatus: legacyDepositStatusForState(deposit.state),
    depositConfirmedAtISO: deposit.providerSettledAtISO,
    stripeSessionId: deposit.providerReference,
    stripeCheckoutState: legacyCheckoutStateForState(deposit.state)
  };
  assertLegacyPaymentConsistent(legacyPayment, derivedLegacyPayment);

  return deepFreeze({
    version: PAYMENT_LEDGER_VERSION,
    entries: normalizedEntries,
    totalCents: amounts.totalCents,
    depositCents: amounts.depositCents,
    finalBalanceCents: amounts.finalBalanceCents,
    finalDueCents,
    netPaidCents,
    byKind: {
      deposit,
      finalBalance
    },
    depositStatus: derivedLegacyPayment.depositStatus,
    legacyPayment: derivedLegacyPayment
  });
}

function assertTransitionAllowed(currentState, nextState) {
  if (currentState === nextState) return;
  if (
    TERMINAL_PAYMENT_STATES.has(currentState)
    || !PAYMENT_STATE_TRANSITIONS[currentState]?.has(nextState)
  ) {
    throw new PaymentLedgerError(
      `Payment state cannot move from ${currentState} to ${nextState}.`
    );
  }
}

function planPaymentLedgerTransition({
  quoteTotals,
  entries = [],
  legacyPayment,
  operationId,
  paymentKind,
  amountCents,
  nextState,
  providerReference = "",
  providerSettledAtISO = ""
} = {}) {
  const current = projectPaymentLedger({ quoteTotals, entries, legacyPayment });
  const normalizedOperationId = normalizeIdentifier(operationId, "Payment operation id");
  const normalizedPaymentKind = normalizePaymentKind(paymentKind);
  const normalizedNextState = normalizePaymentState(nextState);
  const normalizedAmountCents = assertSafeCents(
    amountCents,
    "Payment amount",
    { allowZero: false }
  );
  const existingIndex = current.entries.findIndex(
    (entry) => entry.operationId === normalizedOperationId
  );
  const existing = existingIndex >= 0 ? current.entries[existingIndex] : null;

  if (!existing && normalizedNextState !== "prepared") {
    throw new PaymentLedgerError("A new payment operation must start in prepared state.");
  }
  if (existing) {
    if (
      existing.paymentKind !== normalizedPaymentKind
      || existing.amountCents !== normalizedAmountCents
    ) {
      throw new PaymentLedgerError("Payment operation identity or amount cannot change.");
    }
    assertTransitionAllowed(existing.state, normalizedNextState);
  } else {
    const kindProjection = normalizedPaymentKind === "deposit"
      ? current.byKind.deposit
      : current.byKind.finalBalance;
    if (kindProjection.activeOperationId || kindProjection.settledOperationId) {
      throw new PaymentLedgerError(
        `Another ${normalizedPaymentKind} payment is already active or settled.`
      );
    }
  }

  const requestedProviderReference = normalizeOptionalProviderReference(providerReference);
  const resolvedProviderReference = existing?.providerReference || requestedProviderReference;
  if (
    existing?.providerReference
    && requestedProviderReference
    && requestedProviderReference !== existing.providerReference
  ) {
    throw new PaymentLedgerError("Payment provider reference cannot change.");
  }

  const candidate = normalizePaymentLedgerEntry({
    operationId: normalizedOperationId,
    paymentKind: normalizedPaymentKind,
    amountCents: normalizedAmountCents,
    state: normalizedNextState,
    providerReference: resolvedProviderReference,
    providerSettledAtISO
  });

  if (existing && JSON.stringify(existing) === JSON.stringify(candidate)) {
    return deepFreeze({
      apply: false,
      reason: "already_applied",
      entry: existing,
      projection: current
    });
  }

  const nextEntries = existing
    ? current.entries.map((entry, index) => (index === existingIndex ? candidate : entry))
    : [...current.entries, candidate];
  const projection = projectPaymentLedger({ quoteTotals, entries: nextEntries });

  return deepFreeze({
    apply: true,
    reason: existing ? "state_transition" : "new_operation",
    entry: candidate,
    projection
  });
}

module.exports = {
  PAYMENT_KINDS,
  PAYMENT_LEDGER_VERSION,
  PAYMENT_STATES,
  PaymentLedgerError,
  planPaymentLedgerTransition,
  projectPaymentLedger
};
