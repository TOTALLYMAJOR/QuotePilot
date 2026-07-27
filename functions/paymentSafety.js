const { createHash } = require("node:crypto");

class PaymentSafetyError extends Error {
  constructor(message, code = "failed-precondition") {
    super(message);
    this.name = "PaymentSafetyError";
    this.code = code;
  }
}

function planDepositCheckout(payment = {}) {
  const status = text(payment?.depositStatus).toLowerCase() || "unpaid";
  const depositLink = text(payment?.depositLink);
  const stripeSessionId = text(payment?.stripeSessionId);
  const confirmedAtISO = text(payment?.depositConfirmedAtISO);
  const checkoutGeneration = Number(payment?.checkoutGeneration || 0);
  if (!Number.isSafeInteger(checkoutGeneration) || checkoutGeneration < 0) {
    throw new PaymentSafetyError("The stored checkout generation is invalid.");
  }

  if (["paid", "refunded"].includes(status) || confirmedAtISO) {
    throw new PaymentSafetyError(
      "A new deposit checkout cannot replace paid or refunded payment evidence."
    );
  }
  if (depositLink && stripeSessionId) {
    return {
      action: "inspect_existing",
      status,
      depositLink,
      stripeSessionId,
      checkoutGeneration,
      nextCheckoutGeneration: checkoutGeneration + 1
    };
  }
  if (depositLink || stripeSessionId) {
    throw new PaymentSafetyError(
      "The stored deposit checkout reference is incomplete and requires administrator repair."
    );
  }
  if (status !== "unpaid") {
    throw new PaymentSafetyError(
      "A new deposit checkout requires an unpaid quote with no existing checkout session."
    );
  }
  return {
    action: "create",
    status,
    depositLink: "",
    stripeSessionId: "",
    checkoutGeneration,
    nextCheckoutGeneration: checkoutGeneration + 1
  };
}

function buildStripeCheckoutIdempotencyKey({
  quoteId,
  organizationId: expectedOrganizationId,
  portalKey,
  amountTotal,
  checkoutGeneration
} = {}) {
  const generation = Number(checkoutGeneration);
  const scope = [
    organizationId(expectedOrganizationId),
    text(quoteId),
    text(portalKey),
    String(Number(amountTotal)),
    String(generation)
  ].join("|");
  if (
    !organizationId(expectedOrganizationId)
    || !text(quoteId)
    || !text(portalKey)
    || !Number.isSafeInteger(Number(amountTotal))
    || Number(amountTotal) <= 0
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) {
    throw new PaymentSafetyError(
      "Quote, organization, portal, deposit amount, and checkout generation are required for Stripe idempotency."
    );
  }
  const digest = createHash("sha256").update(scope).digest("hex");
  return `quotepilot-deposit-v1-${digest}`;
}

function text(value) {
  return String(value ?? "").trim();
}

function organizationId(value) {
  return text(value).toLowerCase();
}

function assertPaymentPortalIdentity({
  quoteId,
  organizationId: expectedOrganizationId,
  portalKey,
  quote,
  portal
} = {}) {
  const expectedQuoteId = text(quoteId);
  const expectedOrgId = organizationId(expectedOrganizationId);
  const expectedPortalKey = text(portalKey);
  if (!expectedQuoteId || !expectedOrgId || !expectedPortalKey) {
    throw new PaymentSafetyError(
      "Quote, organization, and portal identity are required for a portal payment update."
    );
  }
  if (
    text(quote?.quoteId) !== expectedQuoteId
    || organizationId(quote?.organizationId) !== expectedOrgId
    || text(quote?.portalKey) !== expectedPortalKey
  ) {
    throw new PaymentSafetyError(
      "Quote payment state does not match the requested quote, organization, and portal."
    );
  }
  if (
    text(portal?.quoteId) !== expectedQuoteId
    || organizationId(portal?.organizationId) !== expectedOrgId
    || text(portal?.portalKey) !== expectedPortalKey
  ) {
    throw new PaymentSafetyError(
      "Portal payment state does not match the requested quote and organization."
    );
  }
  return true;
}

function validateStripeCheckoutScope({
  session,
  quote,
  quoteId,
  organizationId: expectedOrganizationId,
  currency = "usd"
} = {}) {
  const expectedQuoteId = text(quoteId);
  const expectedOrgId = organizationId(expectedOrganizationId);
  const expectedPortalKey = text(quote?.portalKey);
  const sessionId = text(session?.id);
  const expectedSessionId = text(quote?.payment?.stripeSessionId);
  if (!sessionId || !expectedSessionId || sessionId !== expectedSessionId) {
    throw new PaymentSafetyError(
      "Stripe checkout session does not match the active quote payment session."
    );
  }
  if (text(session?.mode).toLowerCase() !== "payment") {
    throw new PaymentSafetyError("Stripe checkout session must be a one-time payment.");
  }

  const expectedCurrency = text(currency).toLowerCase();
  if (!expectedCurrency || text(session?.currency).toLowerCase() !== expectedCurrency) {
    throw new PaymentSafetyError("Stripe checkout currency does not match the quote.");
  }

  const deposit = Number(quote?.totals?.deposit);
  const expectedAmountTotal = Math.round(deposit * 100);
  const amountTotal = Number(session?.amount_total);
  if (
    !Number.isFinite(deposit)
    || expectedAmountTotal <= 0
    || !Number.isSafeInteger(amountTotal)
    || amountTotal !== expectedAmountTotal
  ) {
    throw new PaymentSafetyError("Stripe checkout amount does not match the quote deposit.");
  }

  if (
    text(session?.metadata?.quoteId) !== expectedQuoteId
    || organizationId(session?.metadata?.organizationId) !== expectedOrgId
    || text(session?.metadata?.portalKey) !== expectedPortalKey
  ) {
    throw new PaymentSafetyError(
      "Stripe checkout metadata does not match the quote payment scope."
    );
  }

  return {
    sessionId,
    amountTotal,
    currency: expectedCurrency
  };
}

function validateStripeCheckoutCompletion(options = {}) {
  const validated = validateStripeCheckoutScope(options);
  if (text(options?.session?.payment_status).toLowerCase() !== "paid") {
    throw new PaymentSafetyError("Stripe checkout session is not paid.");
  }
  return validated;
}

function normalizeCheckoutTransitionState(payment = {}) {
  return {
    depositStatus: text(payment?.depositStatus).toLowerCase() || "unpaid",
    depositLink: text(payment?.depositLink),
    stripeSessionId: text(payment?.stripeSessionId),
    depositConfirmedAtISO: text(payment?.depositConfirmedAtISO),
    checkoutGeneration: Number(payment?.checkoutGeneration || 0)
  };
}

function assertCheckoutPaymentTransition({
  currentPayment,
  expectedPayment,
  nextPayment
} = {}) {
  const current = normalizeCheckoutTransitionState(currentPayment);
  const expected = normalizeCheckoutTransitionState(expectedPayment);
  const next = normalizeCheckoutTransitionState(nextPayment);
  if (
    current.depositStatus === "sent"
    && !current.depositConfirmedAtISO
    && current.depositLink === next.depositLink
    && current.stripeSessionId === next.stripeSessionId
    && current.checkoutGeneration === next.checkoutGeneration
  ) {
    return {
      alreadyApplied: true
    };
  }
  if (
    ["paid", "refunded"].includes(current.depositStatus)
    || current.depositConfirmedAtISO
  ) {
    throw new PaymentSafetyError(
      "Checkout creation cannot overwrite paid or refunded payment evidence."
    );
  }
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new PaymentSafetyError(
      "Quote payment state changed while checkout creation was in progress."
    );
  }
  if (
    next.depositStatus !== "sent"
    || !next.depositLink
    || !next.stripeSessionId
    || next.depositConfirmedAtISO
    || !Number.isSafeInteger(next.checkoutGeneration)
    || next.checkoutGeneration !== expected.checkoutGeneration + 1
  ) {
    throw new PaymentSafetyError("The next checkout payment state is invalid.");
  }
  return {
    alreadyApplied: false
  };
}

module.exports = {
  PaymentSafetyError,
  assertCheckoutPaymentTransition,
  assertPaymentPortalIdentity,
  buildStripeCheckoutIdempotencyKey,
  normalizeCheckoutTransitionState,
  planDepositCheckout,
  validateStripeCheckoutScope,
  validateStripeCheckoutCompletion
};
