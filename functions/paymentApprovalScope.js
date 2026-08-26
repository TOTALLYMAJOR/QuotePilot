const { createHash } = require("node:crypto");

const PAYMENT_APPROVAL_SCOPE_VERSION = 1;
const PAYMENT_APPROVAL_SCOPE_KIND = "stripe_checkout_deposit_request";
const FINAL_BALANCE_APPROVAL_SCOPE_KIND = "stripe_checkout_final_balance_request";
const PAYMENT_APPROVAL_SCOPE_KEYS = Object.freeze([
  "version",
  "kind",
  "organizationId",
  "quoteId",
  "quoteRevisionId",
  "portalKey",
  "portalIssuedAtISO",
  "portalExpiresAtISO",
  "customerEmail",
  "paymentKind",
  "currency",
  "amountCents"
]);
const FINAL_BALANCE_APPROVAL_SCOPE_KEYS = Object.freeze([
  ...PAYMENT_APPROVAL_SCOPE_KEYS,
  "depositStatus",
  "depositAmountCents",
  "depositStripeSessionId",
  "depositConfirmedAtISO",
  "contractNumber",
  "contractConvertedAtISO",
  "checkoutGeneration"
]);

class PaymentApprovalScopeError extends Error {
  constructor(message, code = "failed-precondition") {
    super(message);
    this.name = "PaymentApprovalScopeError";
    this.code = code;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeISO(value) {
  const candidate = text(value, 64);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizePaymentApprovalScope(input = {}) {
  const scope = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  const amountCents = Number(scope.amountCents);
  const normalized = {
    version: Number(scope.version),
    kind: text(scope.kind, 80),
    organizationId: text(scope.organizationId, 160).toLowerCase(),
    quoteId: text(scope.quoteId, 160),
    quoteRevisionId: text(scope.quoteRevisionId, 200),
    portalKey: text(scope.portalKey, 160),
    portalIssuedAtISO: normalizeISO(scope.portalIssuedAtISO),
    portalExpiresAtISO: normalizeISO(scope.portalExpiresAtISO),
    customerEmail: text(scope.customerEmail, 254).toLowerCase(),
    paymentKind: text(scope.paymentKind, 32).toLowerCase(),
    currency: text(scope.currency, 3).toLowerCase(),
    amountCents: Number.isSafeInteger(amountCents) ? amountCents : 0
  };
  if (normalized.kind !== FINAL_BALANCE_APPROVAL_SCOPE_KIND) return normalized;
  const depositAmountCents = Number(scope.depositAmountCents);
  const checkoutGeneration = Number(scope.checkoutGeneration);
  return {
    ...normalized,
    depositStatus: text(scope.depositStatus, 32).toLowerCase(),
    depositAmountCents: Number.isSafeInteger(depositAmountCents) ? depositAmountCents : 0,
    depositStripeSessionId: text(scope.depositStripeSessionId, 200),
    depositConfirmedAtISO: normalizeISO(scope.depositConfirmedAtISO),
    contractNumber: text(scope.contractNumber, 120),
    contractConvertedAtISO: normalizeISO(scope.contractConvertedAtISO),
    checkoutGeneration: Number.isSafeInteger(checkoutGeneration) ? checkoutGeneration : 0
  };
}

function assertCanonicalScopeShape(input, normalized) {
  const keys = input && typeof input === "object" && !Array.isArray(input)
    ? Object.keys(input).sort()
    : [];
  const finalBalanceScope = normalized.kind === FINAL_BALANCE_APPROVAL_SCOPE_KIND;
  const expectedKeys = [
    ...(finalBalanceScope
      ? FINAL_BALANCE_APPROVAL_SCOPE_KEYS
      : PAYMENT_APPROVAL_SCOPE_KEYS)
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new PaymentApprovalScopeError(
      "Payment approval scope fields are missing or unexpected. Request a new approval."
    );
  }
  const commonInvalid = (
    normalized.version !== PAYMENT_APPROVAL_SCOPE_VERSION
    || !new Set([
      PAYMENT_APPROVAL_SCOPE_KIND,
      FINAL_BALANCE_APPROVAL_SCOPE_KIND
    ]).has(normalized.kind)
    || !normalized.organizationId
    || !normalized.quoteId
    || !normalized.quoteRevisionId
    || normalized.portalKey.length < 20
    || !normalized.portalIssuedAtISO
    || !normalized.portalExpiresAtISO
    || !normalized.customerEmail
    || !/^[a-z]{3}$/.test(normalized.currency)
    || normalized.amountCents <= 0
  );
  const depositInvalid = !finalBalanceScope && normalized.paymentKind !== "deposit";
  const finalBalanceInvalid = finalBalanceScope && (
    normalized.paymentKind !== "final_balance"
    || normalized.depositStatus !== "paid"
    || normalized.depositAmountCents <= 0
    || !/^cs_[A-Za-z0-9_]+$/.test(normalized.depositStripeSessionId)
    || !normalized.depositConfirmedAtISO
    || !normalized.contractNumber
    || !normalized.contractConvertedAtISO
    || !Number.isSafeInteger(normalized.checkoutGeneration)
    || normalized.checkoutGeneration <= 0
  );
  if (commonInvalid || depositInvalid || finalBalanceInvalid) {
    throw new PaymentApprovalScopeError(
      "Payment approval scope is incomplete or invalid. Request a new approval."
    );
  }
  return normalized;
}

function paymentApprovalScopeDigest(scope) {
  const normalized = assertCanonicalScopeShape(
    scope,
    normalizePaymentApprovalScope(scope)
  );
  const scopeKeys = normalized.kind === FINAL_BALANCE_APPROVAL_SCOPE_KIND
    ? FINAL_BALANCE_APPROVAL_SCOPE_KEYS
    : PAYMENT_APPROVAL_SCOPE_KEYS;
  const ordered = scopeKeys.map((key) => String(normalized[key]));
  return createHash("sha256").update(ordered.join("\n")).digest("hex");
}

function moneyToCents(value, label) {
  const amount = Number(value);
  const scaled = amount * 100;
  const cents = Math.round(scaled);
  if (
    !Number.isFinite(amount)
    || amount < 0
    || !Number.isSafeInteger(cents)
  ) {
    throw new PaymentApprovalScopeError(`${label} cannot be represented safely in cents.`);
  }
  return cents;
}

function buildPaymentApprovalScope({
  quote = {},
  quoteId = "",
  organizationId = "",
  quoteRevisionId = "",
  portalKey = "",
  portalIssuedAtISO = "",
  portalExpiresAtISO = "",
  currency = "usd"
} = {}) {
  const deposit = Number(quote?.totals?.deposit);
  const amountCents = Math.round(deposit * 100);
  const actionScope = normalizePaymentApprovalScope({
    version: PAYMENT_APPROVAL_SCOPE_VERSION,
    kind: PAYMENT_APPROVAL_SCOPE_KIND,
    organizationId,
    quoteId,
    quoteRevisionId,
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    customerEmail: quote?.customer?.email,
    paymentKind: "deposit",
    currency,
    amountCents
  });
  assertCanonicalScopeShape(actionScope, actionScope);
  return {
    actionScope,
    actionScopeDigest: paymentApprovalScopeDigest(actionScope)
  };
}

function buildFinalBalanceApprovalScope({
  quote = {},
  quoteId = "",
  organizationId = "",
  quoteRevisionId = "",
  portalKey = "",
  portalIssuedAtISO = "",
  portalExpiresAtISO = "",
  currency = "usd",
  reuseCurrentCheckoutGeneration = false
} = {}) {
  const totalCents = moneyToCents(quote?.totals?.total, "Quote total");
  const depositAmountCents = moneyToCents(quote?.totals?.deposit, "Quote deposit");
  const amountCents = totalCents - depositAmountCents;
  const finalBalance = quote?.payment?.finalBalance || {};
  const currentGeneration = Number(finalBalance.checkoutGeneration || 0);
  const currentSessionId = text(finalBalance.stripeSessionId, 200);
  const currentProviderState = text(finalBalance.stripeCheckoutState, 32).toLowerCase();
  const currentSessionGeneration = currentSessionId
    && (
      reuseCurrentCheckoutGeneration
      || !["failed", "expired"].includes(currentProviderState)
    );
  const checkoutGeneration = currentSessionGeneration
    ? currentGeneration
    : currentGeneration + 1;
  const actionScope = normalizePaymentApprovalScope({
    version: PAYMENT_APPROVAL_SCOPE_VERSION,
    kind: FINAL_BALANCE_APPROVAL_SCOPE_KIND,
    organizationId,
    quoteId,
    quoteRevisionId,
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    customerEmail: quote?.customer?.email,
    paymentKind: "final_balance",
    currency,
    amountCents,
    depositStatus: quote?.payment?.depositStatus,
    depositAmountCents,
    depositStripeSessionId: quote?.payment?.stripeSessionId,
    depositConfirmedAtISO: quote?.payment?.depositConfirmedAtISO,
    contractNumber: quote?.booking?.contractNumber,
    contractConvertedAtISO: quote?.booking?.contractConvertedAtISO,
    checkoutGeneration
  });
  assertCanonicalScopeShape(actionScope, actionScope);
  return {
    actionScope,
    actionScopeDigest: paymentApprovalScopeDigest(actionScope)
  };
}

function assertPaymentApprovalRequestScope({ approvalRequest, expected } = {}) {
  const request = approvalRequest && typeof approvalRequest === "object"
    ? approvalRequest
    : {};
  const expectedScope = expected?.actionScope;
  const expectedAction = expectedScope?.kind === FINAL_BALANCE_APPROVAL_SCOPE_KIND
    ? "send_final_balance_request"
    : "send_payment_request";
  if (text(request.action, 80) !== expectedAction) {
    throw new PaymentApprovalScopeError(
      "Approval request does not authorize a payment request.",
      "permission-denied"
    );
  }
  const expectedDigest = text(expected?.actionScopeDigest, 64).toLowerCase();
  const storedScope = request.actionScope;
  const storedDigest = text(request.actionScopeDigest, 64).toLowerCase();
  if (!expectedScope || !/^[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new PaymentApprovalScopeError("Current payment approval scope is invalid.");
  }
  const normalizedStored = assertCanonicalScopeShape(
    storedScope,
    normalizePaymentApprovalScope(storedScope)
  );
  const recomputedStoredDigest = paymentApprovalScopeDigest(normalizedStored);
  if (
    storedDigest !== recomputedStoredDigest
    || storedDigest !== expectedDigest
    || JSON.stringify(normalizedStored) !== JSON.stringify(expectedScope)
  ) {
    throw new PaymentApprovalScopeError(
      "The quote, deposit, recipient, or portal changed after approval was requested. Request a new approval."
    );
  }
  return {
    actionScope: normalizedStored,
    actionScopeDigest: storedDigest
  };
}

module.exports = {
  FINAL_BALANCE_APPROVAL_SCOPE_KEYS,
  FINAL_BALANCE_APPROVAL_SCOPE_KIND,
  PAYMENT_APPROVAL_SCOPE_KIND,
  PAYMENT_APPROVAL_SCOPE_KEYS,
  PAYMENT_APPROVAL_SCOPE_VERSION,
  PaymentApprovalScopeError,
  assertPaymentApprovalRequestScope,
  buildFinalBalanceApprovalScope,
  buildPaymentApprovalScope,
  normalizePaymentApprovalScope,
  paymentApprovalScopeDigest
};
