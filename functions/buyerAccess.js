"use strict";

const { createHash, createHmac, timingSafeEqual } = require("node:crypto");

const BUYER_ACCESS_FLOW = "buyer_access";
const BUYER_ACCESS_PLAN = "starter";
const BUYER_ACCESS_MODE = "controlled_test";
const BUYER_ACCESS_AMOUNT_CENTS = 100;
const BUYER_ACCESS_CURRENCY = "usd";
const BUYER_ACCESS_STRIPE_API_VERSION = "2024-06-20";
const BUYER_ACCESS_TURNSTILE_ACTION = "buyer_access_invoice";
const BUYER_ACCESS_STATUS_RATE_LIMIT = 60;
const BUYER_ACCESS_STATUS_RATE_WINDOW_MS = 5 * 60 * 1000;
const BUYER_ACCESS_REPAIR_ACTION = "VOID BUYER INVOICE";
const BUYER_ACCESS_INTERNAL_STATUSES = Object.freeze([
  "invoice_preparing",
  "invoice_open",
  "payment_processing",
  "activation_pending",
  "activation_sent",
  "active",
  "payment_failed",
  "void",
  "expired"
]);

class BuyerAccessError extends Error {
  constructor(message, code = "failed-precondition") {
    super(message);
    this.name = "BuyerAccessError";
    this.code = code;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizedEmail(value) {
  return text(value).toLowerCase();
}

function hashBuyerAccessSecret(value) {
  const normalized = text(value);
  if (!normalized) {
    throw new BuyerAccessError("Buyer access request identity is required.", "invalid-argument");
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function buyerAccessRateLimitDocumentId({ rateLimitSecret, scope, value } = {}) {
  const secret = text(rateLimitSecret);
  const normalizedScope = text(scope).toLowerCase();
  const normalizedValue = text(value).toLowerCase();
  if (
    secret.length < 32
    || secret.length > 512
    || /[\u0000-\u001f\u007f]/.test(secret)
  ) {
    throw new BuyerAccessError("Buyer access rate limiting is not configured.");
  }
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(normalizedScope) || !normalizedValue) {
    throw new BuyerAccessError("Buyer access rate-limit identity is invalid.", "internal");
  }
  const digest = createHmac("sha256", secret)
    .update(`quotepilot:buyer-access-rate-limit:v1:${normalizedScope}:${normalizedValue}`, "utf8")
    .digest("hex");
  return `${normalizedScope}-${digest.slice(0, 40)}`;
}

function planBuyerAccessRateLimit({ current = null, limit, nowMs, windowMs } = {}) {
  const normalizedLimit = Number(limit);
  const normalizedNowMs = Number(nowMs);
  const normalizedWindowMs = Number(windowMs);
  if (
    !Number.isSafeInteger(normalizedLimit)
    || normalizedLimit < 1
    || !Number.isSafeInteger(normalizedNowMs)
    || normalizedNowMs < 0
    || !Number.isSafeInteger(normalizedWindowMs)
    || normalizedWindowMs < 1_000
  ) {
    throw new BuyerAccessError("Buyer access rate-limit policy is invalid.", "internal");
  }

  const hasCurrentState = Boolean(
    current
    && typeof current === "object"
    && !Array.isArray(current)
    && Object.keys(current).length
  );
  let currentCount = 0;
  let currentWindowStartedAtMs = NaN;
  if (hasCurrentState) {
    currentCount = Number(current.count);
    currentWindowStartedAtMs = Date.parse(text(current.windowStartedAtISO));
    if (
      !Number.isSafeInteger(currentCount)
      || currentCount < 0
      || !Number.isFinite(currentWindowStartedAtMs)
      || currentWindowStartedAtMs > normalizedNowMs
    ) {
      throw new BuyerAccessError("Buyer access rate-limit state is invalid.", "internal");
    }
  }

  const inWindow = hasCurrentState
    && normalizedNowMs - currentWindowStartedAtMs < normalizedWindowMs;
  const count = inWindow ? currentCount : 0;
  const windowStartedAtMs = inWindow ? currentWindowStartedAtMs : normalizedNowMs;
  const windowExpiresAtMs = windowStartedAtMs + normalizedWindowMs;
  return {
    blocked: count >= normalizedLimit,
    expiresAtMs: windowExpiresAtMs,
    patch: {
      count: count + 1,
      windowStartedAtISO: new Date(windowStartedAtMs).toISOString(),
      windowExpiresAtISO: new Date(windowExpiresAtMs).toISOString()
    }
  };
}

function planBuyerAccessCreationReservation({
  currentEmailRate = null,
  currentIpRate = null,
  currentReservation = null,
  nowMs,
  orderId
} = {}) {
  const normalizedOrderId = text(orderId).toLowerCase();
  const normalizedNowMs = Number(nowMs);
  if (
    !/^ba-[a-f0-9]{40}$/.test(normalizedOrderId)
    || !Number.isSafeInteger(normalizedNowMs)
    || normalizedNowMs < 0
  ) {
    throw new BuyerAccessError("Buyer access creation reservation is invalid.", "internal");
  }
  const hasReservation = Boolean(
    currentReservation
    && typeof currentReservation === "object"
    && !Array.isArray(currentReservation)
    && Object.keys(currentReservation).length
  );
  let reservationActive = false;
  if (hasReservation) {
    const reservationExpiresAtMs = Date.parse(text(currentReservation.expiresAtISO));
    if (
      text(currentReservation.scope) !== "invoice_reservation"
      || text(currentReservation.orderId).toLowerCase() !== normalizedOrderId
      || !Number.isFinite(reservationExpiresAtMs)
    ) {
      throw new BuyerAccessError("Buyer access creation reservation is invalid.", "internal");
    }
    reservationActive = reservationExpiresAtMs > normalizedNowMs;
  }

  const ipRate = planBuyerAccessRateLimit({
    current: currentIpRate,
    limit: 3,
    nowMs: normalizedNowMs,
    windowMs: 60 * 60 * 1000
  });
  const emailRate = reservationActive ? null : planBuyerAccessRateLimit({
    current: currentEmailRate,
    limit: 1,
    nowMs: normalizedNowMs,
    windowMs: 24 * 60 * 60 * 1000
  });
  const reservationExpiresAtMs = normalizedNowMs + 24 * 60 * 60 * 1000;
  return {
    blocked: ipRate.blocked || emailRate?.blocked === true,
    emailRate,
    ipRate,
    reservationPatch: reservationActive ? null : {
      scope: "invoice_reservation",
      orderId: normalizedOrderId,
      expiresAtISO: new Date(reservationExpiresAtMs).toISOString()
    },
    reused: reservationActive
  };
}

async function authorizeBuyerAccessStatusRequest({
  input,
  consumeRateLimit,
  readOrder
} = {}) {
  const normalizedInput = normalizeBuyerAccessStatusRequest(input);
  if (typeof consumeRateLimit !== "function" || typeof readOrder !== "function") {
    throw new BuyerAccessError("Buyer access status authority is unavailable.", "internal");
  }
  await consumeRateLimit();
  const order = await readOrder(normalizedInput.orderId);
  if (
    !order
    || typeof order !== "object"
    || Array.isArray(order)
    || !buyerAccessStatusTokenMatches({
      expectedHash: order.statusTokenHash,
      statusToken: normalizedInput.statusToken
    })
  ) {
    throw new BuyerAccessError("Buyer access status is unavailable.", "permission-denied");
  }
  return order;
}

function buyerAccessStatusTokenMatches({ expectedHash, statusToken } = {}) {
  const stored = text(expectedHash).toLowerCase();
  const observed = hashBuyerAccessSecret(statusToken);
  if (!/^[a-f0-9]{64}$/.test(stored)) return false;
  return timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(observed, "hex"));
}

function normalizeStripeMode(value) {
  return text(value).toLowerCase();
}

function assertBuyerAccessRuntime({ enabled, stripeMode } = {}) {
  if (text(enabled).toLowerCase() !== "true") {
    throw new BuyerAccessError("Buyer access invoicing is not enabled.");
  }
  if (normalizeStripeMode(stripeMode) !== "test") {
    throw new BuyerAccessError("Buyer access invoicing is restricted to Stripe test mode.");
  }
  return { enabled: true, stripeMode: "test" };
}

function normalizeHumanName(value, fieldName, { min = 2, max = 120 } = {}) {
  const normalized = text(value).replace(/\s+/g, " ");
  if (
    normalized.length < min
    || normalized.length > max
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new BuyerAccessError(
      `${fieldName} must be between ${min} and ${max} characters.`,
      "invalid-argument"
    );
  }
  return normalized;
}

function normalizeBuyerAccessEmail(value) {
  const email = normalizedEmail(value);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BuyerAccessError("ownerEmail must be a valid email address.", "invalid-argument");
  }
  return email;
}

function normalizeBuyerAccessRequestId(value) {
  const requestId = text(value).toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId)) {
    throw new BuyerAccessError("A valid buyer requestId is required.", "invalid-argument");
  }
  return requestId;
}

function normalizeBuyerAccessTurnstileToken(value) {
  const token = text(value);
  if (token.length < 20 || token.length > 2_048 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new BuyerAccessError("Complete the buyer access verification challenge.", "invalid-argument");
  }
  return token;
}

function normalizeBuyerAccessRequest(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new BuyerAccessError("Buyer access request is invalid.", "invalid-argument");
  }
  const allowedKeys = new Set([
    "organizationName",
    "ownerName",
    "ownerEmail",
    "requestId",
    "turnstileToken"
  ]);
  const unknownKeys = Object.keys(data).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    throw new BuyerAccessError(
      "Buyer access amount, plan, and provider identities are server-owned.",
      "invalid-argument"
    );
  }
  return {
    organizationName: normalizeHumanName(data.organizationName, "organizationName"),
    ownerName: normalizeHumanName(data.ownerName, "ownerName"),
    ownerEmail: normalizeBuyerAccessEmail(data.ownerEmail),
    requestId: normalizeBuyerAccessRequestId(data.requestId),
    turnstileToken: normalizeBuyerAccessTurnstileToken(data.turnstileToken)
  };
}

function normalizeBuyerAccessStatusRequest(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new BuyerAccessError("Buyer access status request is invalid.", "invalid-argument");
  }
  const allowedKeys = new Set(["orderId", "statusToken"]);
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) {
    throw new BuyerAccessError("Buyer access status request is invalid.", "invalid-argument");
  }
  const orderId = text(data.orderId).toLowerCase();
  if (!/^ba-[a-f0-9]{40}$/.test(orderId)) {
    throw new BuyerAccessError("A valid buyer access orderId is required.", "invalid-argument");
  }
  return {
    orderId,
    statusToken: normalizeBuyerAccessRequestId(data.statusToken)
  };
}

function normalizeBuyerAccessRepairRequest(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new BuyerAccessError("Buyer access repair request is invalid.", "invalid-argument");
  }
  const allowedKeys = new Set(["orderId", "confirmationToken"]);
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) {
    throw new BuyerAccessError(
      "Buyer access repair provider identities are server-owned.",
      "invalid-argument"
    );
  }
  const orderId = text(data.orderId).toLowerCase();
  if (!/^ba-[a-f0-9]{40}$/.test(orderId)) {
    throw new BuyerAccessError("A valid buyer access orderId is required.", "invalid-argument");
  }
  const expectedConfirmationToken = `${BUYER_ACCESS_REPAIR_ACTION} ${orderId}`;
  if (text(data.confirmationToken) !== expectedConfirmationToken) {
    throw new BuyerAccessError(
      `confirmationToken mismatch. Expected: ${expectedConfirmationToken}`,
      "invalid-argument"
    );
  }
  return { confirmationToken: expectedConfirmationToken, orderId };
}

function slug(value, fallback = "workspace") {
  const normalized = text(value)
    .toLowerCase()
    .replace(/^[^a-z0-9]+/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/[^a-z0-9]+$/g, "")
    .slice(0, 42)
    .replace(/[^a-z0-9]+$/g, "");
  const normalizedFallback = text(fallback).toLowerCase();
  return normalized || (/^[a-z0-9]/.test(normalizedFallback) ? normalizedFallback : "workspace");
}

function compactUuid(value) {
  const normalized = text(value).toLowerCase().replace(/[^a-f0-9]/g, "");
  if (!/^[a-f0-9]{32}$/.test(normalized)) {
    throw new BuyerAccessError("A collision-resistant server identity could not be generated.", "internal");
  }
  return normalized;
}

function buyerAccessOrderIdForRequest({ ownerEmail, requestId } = {}) {
  const email = normalizeBuyerAccessEmail(ownerEmail);
  const normalizedRequestId = normalizeBuyerAccessRequestId(requestId);
  const digest = createHash("sha256")
    .update(
      `quotepilot:buyer-access-order:v2:${email}:${normalizedRequestId}`,
      "utf8"
    )
    .digest("hex");
  return `ba-${digest.slice(0, 40)}`;
}

function buildBuyerAccessIdentifiers({
  ownerEmail,
  organizationName,
  randomUUID,
  requestId
} = {}) {
  if (typeof randomUUID !== "function") {
    throw new BuyerAccessError("Server identity generator is unavailable.", "internal");
  }
  const suffix = compactUuid(randomUUID());
  return {
    orderId: buyerAccessOrderIdForRequest({ ownerEmail, requestId }),
    organizationId: `${slug(organizationName)}-${suffix}`
  };
}

function normalizeGeneration(value) {
  const generation = Number(value);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new BuyerAccessError("Buyer access invoice generation is invalid.");
  }
  return generation;
}

function buildBuyerAccessMetadata({ generation, orderId } = {}) {
  const normalizedOrderId = text(orderId).toLowerCase();
  if (!/^ba-[a-f0-9]{40}$/.test(normalizedOrderId)) {
    throw new BuyerAccessError("Buyer access order identity is invalid.");
  }
  return {
    flow: BUYER_ACCESS_FLOW,
    buyerAccessOrderId: normalizedOrderId,
    invoiceGeneration: String(normalizeGeneration(generation)),
    plan: BUYER_ACCESS_PLAN
  };
}

function buyerAccessStripeIdempotencyKey({ generation, orderId, step } = {}) {
  const metadata = buildBuyerAccessMetadata({ generation, orderId });
  const normalizedStep = text(step).toLowerCase();
  if (!/^[a-z_]{3,32}$/.test(normalizedStep)) {
    throw new BuyerAccessError("Buyer access provider step is invalid.", "internal");
  }
  return `buyer-access-${metadata.buyerAccessOrderId}-g${metadata.invoiceGeneration}-${normalizedStep}`;
}

function hasBuyerAccessReissuableVoidEvidence(order = {}) {
  const signedWebhookVoid = order.signedVoidObserved === true
    && text(order.lastStripeEventType) === "invoice.voided"
    && /^[a-zA-Z0-9_:-]+$/.test(text(order.lastStripeEventId));
  const operatorProviderVoid = order.operatorVoidObserved === true
    && text(order.lastProviderObservationSource) === "admin_reconciliation"
    && /^stripe-buyer-repair-[a-f0-9-]{36}$/.test(text(order.operatorVoidAuditEventId));
  return text(order.status).toLowerCase() === "void"
    && text(order.lastProviderState).toLowerCase() === "void"
    && (signedWebhookVoid || operatorProviderVoid);
}

function buildBuyerAccessStripePlan({ generation, orderId, organizationName, ownerEmail, ownerName } = {}) {
  const email = normalizeBuyerAccessEmail(ownerEmail);
  const normalizedOwnerName = normalizeHumanName(ownerName, "ownerName");
  const normalizedOrganizationName = normalizeHumanName(organizationName, "organizationName");
  const metadata = buildBuyerAccessMetadata({ generation, orderId });
  const idempotencyKey = (step) => buyerAccessStripeIdempotencyKey({
    generation,
    orderId,
    step
  });
  return {
    customer: {
      idempotencyKey: idempotencyKey("customer"),
      params: {
        email,
        name: normalizedOwnerName,
        description: `QuotePilot Starter access for ${normalizedOrganizationName}`,
        metadata
      }
    },
    invoice: {
      idempotencyKey: idempotencyKey("invoice"),
      params: {
        auto_advance: false,
        collection_method: "send_invoice",
        currency: BUYER_ACCESS_CURRENCY,
        days_until_due: 1,
        description: `QuotePilot Starter access for ${normalizedOrganizationName}`,
        discounts: [],
        metadata
      }
    },
    invoiceItem: {
      idempotencyKey: idempotencyKey("invoice_item"),
      params: {
        amount: BUYER_ACCESS_AMOUNT_CENTS,
        currency: BUYER_ACCESS_CURRENCY,
        description: "QuotePilot Starter Access",
        discountable: false,
        metadata
      }
    },
    finalize: {
      idempotencyKey: idempotencyKey("finalize"),
      params: { auto_advance: false }
    },
    send: {
      idempotencyKey: idempotencyKey("send"),
      params: {}
    }
  };
}

function normalizeStripeId(value, prefix, fieldName) {
  const id = text(typeof value === "string" ? value : value?.id);
  const pattern = new RegExp(`^${prefix}_[A-Za-z0-9]+$`);
  if (!pattern.test(id)) {
    throw new BuyerAccessError(`Stripe ${fieldName} identity is invalid.`);
  }
  return id;
}

function normalizeBuyerAccessHostedInvoiceUrl(value, { required = true } = {}) {
  const raw = text(value);
  if (!raw && !required) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BuyerAccessError("Stripe Hosted Invoice Page URL is invalid.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "invoice.stripe.com"
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.hash
    || !parsed.pathname.startsWith("/i/")
    || parsed.pathname.length <= 3
  ) {
    throw new BuyerAccessError("Stripe Hosted Invoice Page URL is invalid.");
  }
  return parsed.toString();
}

function isBuyerAccessInvoice(invoice = {}) {
  return text(invoice?.object).toLowerCase() === "invoice"
    && text(invoice?.metadata?.flow).toLowerCase() === BUYER_ACCESS_FLOW;
}

function buyerAccessProviderStateForEvent(eventType) {
  const states = {
    "invoice.paid": "paid",
    "invoice.payment_failed": "failed",
    "invoice.voided": "void",
    "invoice.marked_uncollectible": "expired"
  };
  return states[text(eventType).toLowerCase()] || "";
}

function buyerAccessProviderStateForInvoice(invoice = {}) {
  return {
    open: "open",
    paid: "paid",
    uncollectible: "expired",
    void: "void"
  }[text(invoice?.status).toLowerCase()] || "";
}

function assertBuyerAccessInvoiceBinding({ eventLivemode, invoice, order, providerState, stripeMode } = {}) {
  assertBuyerAccessRuntime({ enabled: "true", stripeMode });
  const expectedInvoiceId = normalizeStripeId(order?.stripeInvoiceId, "in", "invoice");
  const expectedCustomerId = normalizeStripeId(order?.stripeCustomerId, "cus", "customer");
  const observedInvoiceId = normalizeStripeId(invoice?.id, "in", "invoice");
  const observedCustomerId = normalizeStripeId(invoice?.customer, "cus", "customer");
  const orderId = text(order?.orderId).toLowerCase();
  const ownerEmail = normalizeBuyerAccessEmail(order?.ownerEmail);
  const generation = normalizeGeneration(order?.invoiceGeneration);
  const observedState = text(providerState).toLowerCase();
  if (!isBuyerAccessInvoice(invoice)) {
    throw new BuyerAccessError("Stripe Invoice is not a buyer access invoice.");
  }
  if (invoice?.livemode !== false || (eventLivemode !== undefined && eventLivemode !== false)) {
    throw new BuyerAccessError("Buyer access Invoice must be in Stripe test mode.");
  }
  if (observedInvoiceId !== expectedInvoiceId || observedCustomerId !== expectedCustomerId) {
    throw new BuyerAccessError("Stripe customer or Invoice does not match the buyer order.");
  }
  if (
    text(invoice?.metadata?.buyerAccessOrderId).toLowerCase() !== orderId
    || text(invoice?.metadata?.invoiceGeneration) !== String(generation)
    || text(invoice?.metadata?.plan).toLowerCase() !== BUYER_ACCESS_PLAN
  ) {
    throw new BuyerAccessError("Stripe Invoice order, generation, or plan binding is invalid.");
  }
  if (
    text(order?.flow).toLowerCase() !== BUYER_ACCESS_FLOW
    || text(order?.plan).toLowerCase() !== BUYER_ACCESS_PLAN
    || Number(order?.amountCents) !== BUYER_ACCESS_AMOUNT_CENTS
    || text(order?.currency).toLowerCase() !== BUYER_ACCESS_CURRENCY
  ) {
    throw new BuyerAccessError("Stored buyer access order scope is invalid.");
  }
  if (
    text(invoice?.collection_method).toLowerCase() !== "send_invoice"
    || text(invoice?.currency).toLowerCase() !== BUYER_ACCESS_CURRENCY
    || text(invoice?.customer_email).toLowerCase() !== ownerEmail
    || invoice?.subscription
  ) {
    throw new BuyerAccessError("Stripe Invoice currency, customer, or collection method is invalid.");
  }
  if (
    ["open", "paid", "failed"].includes(observedState)
    && (
      Number(invoice?.amount_due) !== BUYER_ACCESS_AMOUNT_CENTS
      || Number(invoice?.total) !== BUYER_ACCESS_AMOUNT_CENTS
    )
  ) {
    throw new BuyerAccessError("Stripe Invoice amount or total is invalid.");
  }
  if (
    ["void", "expired"].includes(observedState)
    && (
      Number(invoice?.total) !== BUYER_ACCESS_AMOUNT_CENTS
      || Number(invoice?.amount_paid) !== 0
    )
  ) {
    throw new BuyerAccessError("Stripe terminal Invoice amount or payment state is invalid.");
  }
  if (observedState === "open") {
    if (text(invoice?.status).toLowerCase() !== "open") {
      throw new BuyerAccessError("Stripe Invoice is not open for payment.");
    }
    return {
      customerId: observedCustomerId,
      generation,
      hostedInvoiceUrl: normalizeBuyerAccessHostedInvoiceUrl(invoice?.hosted_invoice_url),
      invoiceId: observedInvoiceId,
      orderId,
      ownerEmail,
      providerState: observedState
    };
  }
  const expectedStatus = {
    paid: "paid",
    failed: "open",
    void: "void",
    expired: "uncollectible"
  }[observedState];
  if (!expectedStatus || text(invoice?.status).toLowerCase() !== expectedStatus) {
    throw new BuyerAccessError("Stripe buyer access Invoice state is invalid.");
  }
  if (observedState === "paid") {
    const paymentIntentId = normalizeStripeId(invoice?.payment_intent, "pi", "payment intent");
    if (
      Number(invoice?.amount_paid) !== BUYER_ACCESS_AMOUNT_CENTS
      || Number(invoice?.amount_remaining) !== 0
      || invoice?.paid_out_of_band !== false
    ) {
      throw new BuyerAccessError("Paid buyer access Invoice settlement is invalid.");
    }
    return {
      customerId: observedCustomerId,
      generation,
      hostedInvoiceUrl: normalizeBuyerAccessHostedInvoiceUrl(invoice?.hosted_invoice_url, { required: false }),
      invoiceId: observedInvoiceId,
      orderId,
      ownerEmail,
      paymentIntentId,
      providerState: observedState
    };
  }
  return {
    customerId: observedCustomerId,
    generation,
    hostedInvoiceUrl: normalizeBuyerAccessHostedInvoiceUrl(invoice?.hosted_invoice_url, {
      required: observedState === "failed"
    }),
    invoiceId: observedInvoiceId,
    orderId,
    ownerEmail,
    providerState: observedState
  };
}

function planBuyerAccessTransition({ currentStatus, providerState } = {}) {
  const current = text(currentStatus).toLowerCase() || "invoice_preparing";
  const observed = text(providerState).toLowerCase();
  if (!BUYER_ACCESS_INTERNAL_STATUSES.includes(current)) {
    throw new BuyerAccessError("Buyer access order status is invalid.");
  }
  if (["active", "activation_sent", "activation_pending"].includes(current)) {
    return {
      apply: false,
      status: current,
      accessGranted: current === "active",
      reason: current === "active" ? "already_active" : "already_provisioned"
    };
  }
  const statusByProviderState = {
    open: "invoice_open",
    processing: "payment_processing",
    paid: "activation_pending",
    failed: "payment_failed",
    void: "void",
    expired: "expired"
  };
  const status = statusByProviderState[observed];
  if (!status) throw new BuyerAccessError("Stripe buyer access state is invalid.");
  if (["void", "expired"].includes(current) && observed !== "paid") {
    return { apply: false, status: current, accessGranted: false, reason: "terminal_unpaid_state" };
  }
  return {
    apply: current !== status,
    status,
    accessGranted: status === "active",
    reason: current === status ? "already_observed" : "provider_transition"
  };
}

function resolveBuyerAccessBootstrapRecovery({
  authenticatedClaims = {},
  buyerAccessOrder = {},
  email,
  roleRecord = {},
  uid
} = {}) {
  const ownerEmail = normalizeBuyerAccessEmail(email);
  const ownerUid = text(uid);
  const orderId = text(roleRecord.buyerAccessOrderId).toLowerCase();
  const organizationId = text(roleRecord.organizationId).toLowerCase();
  const role = text(roleRecord.role).toLowerCase();
  const roleEmail = normalizeBuyerAccessEmail(roleRecord.email);
  const claimsRole = text(authenticatedClaims.role).toLowerCase();
  const claimsOrganizationId = text(authenticatedClaims.organizationId).toLowerCase();
  if (
    !ownerUid
    || !/^ba-[a-f0-9]{40}$/.test(orderId)
    || !/^[a-z0-9][a-z0-9_-]*-[a-f0-9]{32}$/.test(organizationId)
    || role !== "admin"
    || roleEmail !== ownerEmail
    || text(roleRecord.buyerAccessMode) !== BUYER_ACCESS_MODE
    || text(roleRecord.source) !== BUYER_ACCESS_FLOW
  ) {
    throw new BuyerAccessError("Buyer access role recovery scope is invalid.");
  }
  if (
    !["", "customer", "admin"].includes(claimsRole)
    || (claimsOrganizationId && claimsOrganizationId !== organizationId)
    || (claimsRole === "admin" && claimsOrganizationId !== organizationId)
    || (claimsRole === "customer" && claimsOrganizationId)
  ) {
    throw new BuyerAccessError("Buyer access claims cannot be reassigned during recovery.");
  }
  if (
    text(buyerAccessOrder.orderId).toLowerCase() !== orderId
    || text(buyerAccessOrder.flow) !== BUYER_ACCESS_FLOW
    || text(buyerAccessOrder.buyerAccessMode) !== BUYER_ACCESS_MODE
    || normalizeBuyerAccessEmail(buyerAccessOrder.ownerEmail) !== ownerEmail
    || text(buyerAccessOrder.ownerUid) !== ownerUid
    || text(buyerAccessOrder.organizationId).toLowerCase() !== organizationId
    || text(buyerAccessOrder.plan).toLowerCase() !== BUYER_ACCESS_PLAN
    || Number(buyerAccessOrder.amountCents) !== BUYER_ACCESS_AMOUNT_CENTS
    || text(buyerAccessOrder.currency).toLowerCase() !== BUYER_ACCESS_CURRENCY
    || text(buyerAccessOrder.status).toLowerCase() !== "active"
    || buyerAccessOrder.accessGranted !== true
    || buyerAccessOrder.workspaceReady !== true
    || !["pending", "failed", "succeeded"].includes(
      text(buyerAccessOrder.claimsSyncStatus).toLowerCase()
    )
  ) {
    throw new BuyerAccessError("Buyer access order recovery scope is invalid.");
  }
  return { buyerAccessOrderId: orderId, organizationId };
}

function buyerAccessStatusResponse(order = {}) {
  const internalStatus = text(order.status).toLowerCase();
  if (!BUYER_ACCESS_INTERNAL_STATUSES.includes(internalStatus)) {
    throw new BuyerAccessError("Buyer access order status is invalid.", "internal");
  }
  const status = {
    invoice_preparing: "provisioning",
    activation_pending: "provisioning"
  }[internalStatus] || internalStatus;
  const isPreActivation = [
    "invoice_preparing",
    "invoice_open",
    "payment_processing",
    "payment_failed",
    "void",
    "expired"
  ].includes(internalStatus);
  const active = internalStatus === "active";
  const activationSent = internalStatus === "activation_sent";
  const activationPending = internalStatus === "activation_pending";
  if (
    (isPreActivation && (
      order.accessGranted === true
      || order.workspaceReady === true
      || order.activationEmailSent === true
    ))
    || (activationPending && (
      order.accessGranted === true
      || order.workspaceReady !== true
      || order.activationEmailSent === true
    ))
    || (activationSent && (
      order.accessGranted === true
      || order.workspaceReady !== true
      || order.activationEmailSent !== true
    ))
    || (active && (
      order.accessGranted !== true
      || order.workspaceReady !== true
      || typeof order.activationEmailSent !== "boolean"
    ))
  ) {
    throw new BuyerAccessError("Buyer access fulfillment state is inconsistent.", "internal");
  }
  const workspaceReady = activationPending || activationSent || active;
  const response = {
    orderId: text(order.orderId),
    status,
    activationEmailSent: activationSent || (active && order.activationEmailSent === true),
    workspaceReady,
    appUrl: active ? "/app" : null
  };
  if (["invoice_open", "payment_failed"].includes(status)) {
    response.hostedInvoiceUrl = normalizeBuyerAccessHostedInvoiceUrl(order.hostedInvoiceUrl);
  }
  return response;
}

function normalizeBuyerAccessTurnstileHostnames(value) {
  const hostnames = text(value)
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase().replace(/\.+$/, ""))
    .filter(Boolean);
  if (
    !hostnames.length
    || hostnames.some((hostname) => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname))
  ) {
    throw new BuyerAccessError("Buyer access Turnstile hostname allowlist is invalid.");
  }
  return [...new Set(hostnames)];
}

function assertBuyerAccessTurnstileResult({ allowedHostnames, result } = {}) {
  const hostnames = Array.isArray(allowedHostnames)
    ? normalizeBuyerAccessTurnstileHostnames(allowedHostnames.join(","))
    : normalizeBuyerAccessTurnstileHostnames(allowedHostnames);
  const hostname = text(result?.hostname).toLowerCase().replace(/\.+$/, "");
  if (
    result?.success !== true
    || text(result?.action) !== BUYER_ACCESS_TURNSTILE_ACTION
    || !hostnames.includes(hostname)
  ) {
    throw new BuyerAccessError(
      "Buyer access verification failed. Refresh and try again.",
      "permission-denied"
    );
  }
  return {
    action: BUYER_ACCESS_TURNSTILE_ACTION,
    hostname,
    challengeTimestamp: text(result?.challenge_ts)
  };
}

module.exports = {
  BUYER_ACCESS_AMOUNT_CENTS,
  BUYER_ACCESS_CURRENCY,
  BUYER_ACCESS_FLOW,
  BUYER_ACCESS_INTERNAL_STATUSES,
  BUYER_ACCESS_MODE,
  BUYER_ACCESS_PLAN,
  BUYER_ACCESS_REPAIR_ACTION,
  BUYER_ACCESS_STATUS_RATE_LIMIT,
  BUYER_ACCESS_STATUS_RATE_WINDOW_MS,
  BUYER_ACCESS_STRIPE_API_VERSION,
  BUYER_ACCESS_TURNSTILE_ACTION,
  BuyerAccessError,
  assertBuyerAccessInvoiceBinding,
  assertBuyerAccessRuntime,
  assertBuyerAccessTurnstileResult,
  authorizeBuyerAccessStatusRequest,
  buildBuyerAccessIdentifiers,
  buildBuyerAccessMetadata,
  buildBuyerAccessStripePlan,
  buyerAccessStripeIdempotencyKey,
  buyerAccessOrderIdForRequest,
  buyerAccessProviderStateForEvent,
  buyerAccessProviderStateForInvoice,
  buyerAccessRateLimitDocumentId,
  buyerAccessStatusResponse,
  buyerAccessStatusTokenMatches,
  hashBuyerAccessSecret,
  hasBuyerAccessReissuableVoidEvidence,
  isBuyerAccessInvoice,
  normalizeBuyerAccessHostedInvoiceUrl,
  normalizeBuyerAccessRequest,
  normalizeBuyerAccessRepairRequest,
  normalizeBuyerAccessRequestId,
  normalizeBuyerAccessStatusRequest,
  normalizeBuyerAccessTurnstileHostnames,
  planBuyerAccessCreationReservation,
  planBuyerAccessRateLimit,
  planBuyerAccessTransition,
  resolveBuyerAccessBootstrapRecovery
};
