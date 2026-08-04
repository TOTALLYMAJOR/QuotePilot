const { createHash } = require("node:crypto");

const MAX_KNOWN_STRIPE_SESSION_IDS = 12;
const APPROVED_STRIPE_CHECKOUT_HOSTS = new Set([
  "checkout.stripe.com",
  "buy.stripe.com"
]);

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
  const stripeCheckoutState = text(payment?.stripeCheckoutState).toLowerCase();
  const checkoutGeneration = Number(payment?.checkoutGeneration || 0);
  if (!Number.isSafeInteger(checkoutGeneration) || checkoutGeneration < 0) {
    throw new PaymentSafetyError("The stored checkout generation is invalid.");
  }

  if (["paid", "refunded"].includes(status) || confirmedAtISO) {
    throw new PaymentSafetyError(
      "A new deposit checkout cannot replace paid or refunded payment evidence."
    );
  }
  if (
    !depositLink
    && stripeSessionId
    && status === "unpaid"
    && stripeCheckoutState === "prepared"
  ) {
    assertStripeSessionId(stripeSessionId);
    if (checkoutGeneration < 1) {
      throw new PaymentSafetyError("The prepared checkout generation is invalid.");
    }
    return {
      action: "inspect_prepared",
      status,
      depositLink: "",
      stripeSessionId,
      stripeCheckoutState,
      checkoutGeneration
    };
  }
  if (depositLink && stripeSessionId) {
    return {
      action: "inspect_existing",
      status,
      depositLink,
      stripeSessionId,
      stripeCheckoutState: stripeCheckoutState || "open",
      checkoutGeneration,
      nextCheckoutGeneration: checkoutGeneration + 1
    };
  }
  if (
    !depositLink
    && stripeSessionId
    && status === "unpaid"
    && ["failed", "expired"].includes(stripeCheckoutState)
  ) {
    return {
      action: "create",
      status,
      depositLink: "",
      stripeSessionId,
      stripeCheckoutState,
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
    stripeCheckoutState: stripeCheckoutState || "",
    checkoutGeneration,
    nextCheckoutGeneration: checkoutGeneration + 1
  };
}

function buildStripeCheckoutIdempotencyKey({
  quoteId,
  organizationId: expectedOrganizationId,
  portalKey,
  amountTotal,
  checkoutGeneration,
  paymentKind = "deposit"
} = {}) {
  const generation = Number(checkoutGeneration);
  const normalizedPaymentKind = text(paymentKind).toLowerCase();
  if (!new Set(["deposit", "final_balance"]).has(normalizedPaymentKind)) {
    throw new PaymentSafetyError("Stripe checkout payment kind is invalid.");
  }
  const legacyDepositScope = [
    organizationId(expectedOrganizationId),
    text(quoteId),
    text(portalKey),
    String(Number(amountTotal)),
    String(generation)
  ];
  const scope = (normalizedPaymentKind === "deposit"
    ? legacyDepositScope
    : [normalizedPaymentKind, ...legacyDepositScope]
  ).join("|");
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
  const prefix = normalizedPaymentKind === "deposit"
    ? "quotepilot-deposit-v1"
    : "quotepilot-final-balance-v1";
  return `${prefix}-${digest}`;
}

function text(value) {
  return String(value ?? "").trim();
}

function assertStripeSessionId(value) {
  const sessionId = text(value);
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    throw new PaymentSafetyError("Stripe checkout session identity is invalid.");
  }
  return sessionId;
}

function normalizeKnownStripeSessionIds(value, { includeSessionId = "" } = {}) {
  const source = value === undefined || value === null ? [] : value;
  if (!Array.isArray(source)) {
    throw new PaymentSafetyError("Known Stripe checkout session history is invalid.");
  }
  const normalized = [];
  const append = (entry) => {
    const sessionId = assertStripeSessionId(entry);
    const previousIndex = normalized.indexOf(sessionId);
    if (previousIndex >= 0) normalized.splice(previousIndex, 1);
    normalized.push(sessionId);
  };
  source.forEach(append);
  if (text(includeSessionId)) append(includeSessionId);
  return normalized.slice(-MAX_KNOWN_STRIPE_SESSION_IDS);
}

function isKnownStripeSessionId(payment = {}, sessionId = "") {
  const candidate = text(sessionId);
  if (!/^cs_[A-Za-z0-9_]+$/.test(candidate)) return false;
  const knownSessionIds = normalizeKnownStripeSessionIds(
    payment?.knownStripeSessionIds,
    { includeSessionId: payment?.stripeSessionId }
  );
  return knownSessionIds.includes(candidate);
}

function normalizeStripeCheckoutUrl(value) {
  const candidate = text(value);
  if (!candidate || candidate.length > 2_000) {
    throw new PaymentSafetyError("Stripe checkout URL is invalid.");
  }
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || !APPROVED_STRIPE_CHECKOUT_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      throw new Error("unapproved Stripe checkout URL");
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof PaymentSafetyError) throw error;
    throw new PaymentSafetyError("Stripe checkout URL is invalid.");
  }
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
  const stripeSessionId = text(payment?.stripeSessionId);
  return {
    depositStatus: text(payment?.depositStatus).toLowerCase() || "unpaid",
    depositLink: text(payment?.depositLink),
    stripeSessionId,
    stripeCheckoutState: text(payment?.stripeCheckoutState).toLowerCase(),
    depositConfirmedAtISO: text(payment?.depositConfirmedAtISO),
    checkoutGeneration: Number(payment?.checkoutGeneration || 0),
    knownStripeSessionIds: normalizeKnownStripeSessionIds(
      payment?.knownStripeSessionIds,
      { includeSessionId: stripeSessionId }
    )
  };
}

function sameCheckoutTransitionState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertPreparedCheckoutSource(expected) {
  if (
    expected.depositStatus !== "unpaid"
    || expected.depositLink
    || expected.depositConfirmedAtISO
    || !Number.isSafeInteger(expected.checkoutGeneration)
    || expected.checkoutGeneration < 0
  ) {
    throw new PaymentSafetyError(
      "Prepared checkout registration requires an unpaid quote with no exposed checkout link."
    );
  }
  if (!expected.stripeSessionId) {
    if (!["", "failed", "expired"].includes(expected.stripeCheckoutState)) {
      throw new PaymentSafetyError(
        "Prepared checkout registration requires a clean or terminal provider state."
      );
    }
    return expected;
  }
  assertStripeSessionId(expected.stripeSessionId);
  if (!["failed", "expired"].includes(expected.stripeCheckoutState)) {
    throw new PaymentSafetyError(
      "Only a failed or expired Stripe checkout can be replaced."
    );
  }
  return expected;
}

function buildPreparedCheckoutState({
  expectedPayment,
  stripeSessionId,
  checkoutGeneration
} = {}) {
  const expected = assertPreparedCheckoutSource(
    normalizeCheckoutTransitionState(expectedPayment)
  );
  const sessionId = assertStripeSessionId(stripeSessionId);
  const generation = Number(checkoutGeneration);
  if (
    sessionId === expected.stripeSessionId
    || !Number.isSafeInteger(generation)
    || generation !== expected.checkoutGeneration + 1
  ) {
    throw new PaymentSafetyError(
      "Prepared checkout must register one new Stripe session and generation."
    );
  }
  return {
    depositStatus: "unpaid",
    depositLink: "",
    stripeSessionId: sessionId,
    stripeCheckoutState: "prepared",
    depositConfirmedAtISO: "",
    checkoutGeneration: generation,
    knownStripeSessionIds: normalizeKnownStripeSessionIds(
      expected.knownStripeSessionIds,
      { includeSessionId: sessionId }
    )
  };
}

function assertPreparedCheckoutState(payment) {
  const prepared = normalizeCheckoutTransitionState(payment);
  if (
    prepared.depositStatus !== "unpaid"
    || prepared.depositLink
    || !prepared.stripeSessionId
    || prepared.stripeCheckoutState !== "prepared"
    || prepared.depositConfirmedAtISO
    || !Number.isSafeInteger(prepared.checkoutGeneration)
    || prepared.checkoutGeneration < 1
    || prepared.knownStripeSessionIds.at(-1) !== prepared.stripeSessionId
  ) {
    throw new PaymentSafetyError("Prepared Stripe checkout evidence is invalid.");
  }
  assertStripeSessionId(prepared.stripeSessionId);
  return prepared;
}

function assertPreparedCheckoutRegistrationTransition({
  currentPayment,
  expectedPayment,
  preparedPayment
} = {}) {
  const current = normalizeCheckoutTransitionState(currentPayment);
  const expected = normalizeCheckoutTransitionState(expectedPayment);
  const candidate = normalizeCheckoutTransitionState(preparedPayment);
  const planned = buildPreparedCheckoutState({
    expectedPayment: expected,
    stripeSessionId: candidate.stripeSessionId,
    checkoutGeneration: candidate.checkoutGeneration
  });
  if (!sameCheckoutTransitionState(candidate, planned)) {
    throw new PaymentSafetyError("Prepared Stripe checkout state is not canonical.");
  }
  if (sameCheckoutTransitionState(current, planned)) {
    return { alreadyApplied: true };
  }
  if (!sameCheckoutTransitionState(current, expected)) {
    throw new PaymentSafetyError(
      "Quote payment state changed before Stripe checkout registration."
    );
  }
  return { alreadyApplied: false };
}

function buildPublishedCheckoutState({ preparedPayment, depositLink } = {}) {
  const prepared = assertPreparedCheckoutState(preparedPayment);
  return {
    ...prepared,
    depositStatus: "sent",
    depositLink: normalizeStripeCheckoutUrl(depositLink),
    stripeCheckoutState: "open"
  };
}

function assertPreparedCheckoutPublicationTransition({
  currentPayment,
  expectedPreparedPayment,
  publishedPayment
} = {}) {
  const current = normalizeCheckoutTransitionState(currentPayment);
  const expectedPrepared = assertPreparedCheckoutState(expectedPreparedPayment);
  const candidate = normalizeCheckoutTransitionState(publishedPayment);
  const planned = buildPublishedCheckoutState({
    preparedPayment: expectedPrepared,
    depositLink: candidate.depositLink
  });
  if (!sameCheckoutTransitionState(candidate, planned)) {
    throw new PaymentSafetyError("Published Stripe checkout state is not canonical.");
  }
  if (sameCheckoutTransitionState(current, planned)) {
    return { alreadyApplied: true };
  }
  if (!sameCheckoutTransitionState(current, expectedPrepared)) {
    throw new PaymentSafetyError(
      "Quote payment state changed before Stripe checkout publication."
    );
  }
  return { alreadyApplied: false };
}

function assertCheckoutPaymentTransition({
  currentPayment,
  expectedPayment,
  nextPayment
} = {}) {
  const current = normalizeCheckoutTransitionState(currentPayment);
  const expected = normalizeCheckoutTransitionState(expectedPayment);
  const next = normalizeCheckoutTransitionState(nextPayment);
  if (sameCheckoutTransitionState(current, next)) {
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
  if (!sameCheckoutTransitionState(current, expected)) {
    throw new PaymentSafetyError(
      "Quote payment state changed while checkout creation was in progress."
    );
  }
  if (
    next.depositStatus !== "sent"
    || !next.depositLink
    || !next.stripeSessionId
    || next.stripeCheckoutState !== "open"
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
  MAX_KNOWN_STRIPE_SESSION_IDS,
  PaymentSafetyError,
  assertCheckoutPaymentTransition,
  assertPaymentPortalIdentity,
  assertPreparedCheckoutPublicationTransition,
  assertPreparedCheckoutRegistrationTransition,
  buildPreparedCheckoutState,
  buildPublishedCheckoutState,
  buildStripeCheckoutIdempotencyKey,
  isKnownStripeSessionId,
  normalizeKnownStripeSessionIds,
  normalizeCheckoutTransitionState,
  planDepositCheckout,
  validateStripeCheckoutScope,
  validateStripeCheckoutCompletion
};
