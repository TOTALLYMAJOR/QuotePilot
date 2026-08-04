const { createHash } = require("node:crypto");

const PAYMENT_APPROVAL_SCOPE_VERSION = 1;
const PAYMENT_APPROVAL_SCOPE_KIND = "stripe_checkout_deposit_request";
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
  return {
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
}

function assertCanonicalScopeShape(input, normalized) {
  const keys = input && typeof input === "object" && !Array.isArray(input)
    ? Object.keys(input).sort()
    : [];
  const expectedKeys = [...PAYMENT_APPROVAL_SCOPE_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new PaymentApprovalScopeError(
      "Payment approval scope fields are missing or unexpected. Request a new approval."
    );
  }
  if (
    normalized.version !== PAYMENT_APPROVAL_SCOPE_VERSION
    || normalized.kind !== PAYMENT_APPROVAL_SCOPE_KIND
    || !normalized.organizationId
    || !normalized.quoteId
    || !normalized.quoteRevisionId
    || normalized.portalKey.length < 20
    || !normalized.portalIssuedAtISO
    || !normalized.portalExpiresAtISO
    || !normalized.customerEmail
    || normalized.paymentKind !== "deposit"
    || !/^[a-z]{3}$/.test(normalized.currency)
    || normalized.amountCents <= 0
  ) {
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
  const ordered = PAYMENT_APPROVAL_SCOPE_KEYS.map((key) => String(normalized[key]));
  return createHash("sha256").update(ordered.join("\n")).digest("hex");
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

function assertPaymentApprovalRequestScope({ approvalRequest, expected } = {}) {
  const request = approvalRequest && typeof approvalRequest === "object"
    ? approvalRequest
    : {};
  if (text(request.action, 80) !== "send_payment_request") {
    throw new PaymentApprovalScopeError(
      "Approval request does not authorize a payment request.",
      "permission-denied"
    );
  }
  const expectedScope = expected?.actionScope;
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
  PAYMENT_APPROVAL_SCOPE_KIND,
  PAYMENT_APPROVAL_SCOPE_KEYS,
  PAYMENT_APPROVAL_SCOPE_VERSION,
  PaymentApprovalScopeError,
  assertPaymentApprovalRequestScope,
  buildPaymentApprovalScope,
  normalizePaymentApprovalScope,
  paymentApprovalScopeDigest
};
