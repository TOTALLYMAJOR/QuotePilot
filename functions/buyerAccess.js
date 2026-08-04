"use strict";

const { createHash } = require("node:crypto");

const BUYER_ACCESS_FLOW = "buyer_access";
const BUYER_ACCESS_PLAN = "starter";
const BUYER_ACCESS_AMOUNT_CENTS = 100;
const BUYER_ACCESS_CURRENCY = "usd";
const BUYER_ACCESS_STATUSES = Object.freeze([
  "checkout_pending",
  "payment_processing",
  "active",
  "payment_failed",
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

function normalizeStripeMode(value) {
  return text(value).toLowerCase();
}

function assertBuyerAccessRuntime({ enabled, stripeMode } = {}) {
  if (text(enabled).toLowerCase() !== "true") {
    throw new BuyerAccessError("Buyer access checkout is not enabled.");
  }
  if (normalizeStripeMode(stripeMode) !== "test") {
    throw new BuyerAccessError("Buyer access checkout is restricted to Stripe test mode.");
  }
  return { enabled: true, stripeMode: "test" };
}

function normalizeHumanName(value, fieldName, { min = 2, max = 120 } = {}) {
  const normalized = text(value).replace(/\s+/g, " ");
  if (normalized.length < min || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new BuyerAccessError(
      `${fieldName} must be between ${min} and ${max} characters.`,
      "invalid-argument"
    );
  }
  return normalized;
}

function normalizeBuyerAccessRequest(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new BuyerAccessError("Buyer access request is invalid.", "invalid-argument");
  }
  const allowedKeys = new Set(["organizationName", "ownerName"]);
  const unknownKeys = Object.keys(data).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    throw new BuyerAccessError(
      "Buyer access amount, plan, identity, and return URLs are server-owned.",
      "invalid-argument"
    );
  }
  return {
    organizationName: normalizeHumanName(data.organizationName, "organizationName"),
    ownerName: normalizeHumanName(data.ownerName, "ownerName")
  };
}

function slug(value, fallback = "workspace") {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42)
    .replace(/-$/g, "");
  return normalized || fallback;
}

function compactUuid(value) {
  const normalized = text(value).toLowerCase().replace(/[^a-f0-9]/g, "");
  if (!/^[a-f0-9]{32}$/.test(normalized)) {
    throw new BuyerAccessError("A collision-resistant server identity could not be generated.", "internal");
  }
  return normalized;
}

function buyerAccessOrderIdForUid(uid) {
  const normalizedUid = text(uid);
  if (!normalizedUid) {
    throw new BuyerAccessError("Authenticated owner identity is required.", "unauthenticated");
  }
  const digest = createHash("sha256")
    .update(`quotepilot:buyer-access:${normalizedUid}`, "utf8")
    .digest("hex");
  return `ba-${digest.slice(0, 40)}`;
}

function buildBuyerAccessIdentifiers({ uid, organizationName, randomUUID } = {}) {
  if (typeof randomUUID !== "function") {
    throw new BuyerAccessError("Server identity generator is unavailable.", "internal");
  }
  const suffix = compactUuid(randomUUID());
  return {
    orderId: buyerAccessOrderIdForUid(uid),
    organizationId: `${slug(organizationName)}-${suffix}`
  };
}

function buildBuyerAccessReturnUrls(appBaseUrl) {
  let parsed;
  try {
    parsed = new URL(text(appBaseUrl));
  } catch (error) {
    throw new BuyerAccessError("The server application URL is invalid.", "failed-precondition");
  }
  const localHttp = parsed.protocol === "http:"
    && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !localHttp)
    || parsed.username
    || parsed.password
  ) {
    throw new BuyerAccessError("Buyer access checkout requires an HTTPS application URL.");
  }
  const startUrl = new URL("/start", parsed.origin);
  startUrl.searchParams.set("purchase", "success");
  startUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  const cancelUrl = new URL("/start", parsed.origin);
  cancelUrl.searchParams.set("purchase", "cancelled");
  return {
    successUrl: startUrl.toString().replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}"),
    cancelUrl: cancelUrl.toString()
  };
}

function normalizeGeneration(value) {
  const generation = Number(value);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new BuyerAccessError("Buyer access checkout generation is invalid.");
  }
  return generation;
}

function buildBuyerAccessCheckout({
  appBaseUrl,
  generation,
  orderId,
  organizationName,
  ownerEmail,
  ownerUid
} = {}) {
  const normalizedOrderId = text(orderId);
  const normalizedOwnerUid = text(ownerUid);
  const normalizedOwnerEmail = normalizedEmail(ownerEmail);
  const normalizedOrganizationName = normalizeHumanName(
    organizationName,
    "organizationName"
  );
  const normalizedGeneration = normalizeGeneration(generation);
  if (!/^ba-[a-f0-9]{40}$/.test(normalizedOrderId)) {
    throw new BuyerAccessError("Buyer access order identity is invalid.");
  }
  if (!normalizedOwnerUid || !normalizedOwnerEmail) {
    throw new BuyerAccessError("Verified owner identity is required.", "unauthenticated");
  }
  const { successUrl, cancelUrl } = buildBuyerAccessReturnUrls(appBaseUrl);
  const metadata = {
    flow: BUYER_ACCESS_FLOW,
    buyerAccessOrderId: normalizedOrderId,
    ownerUid: normalizedOwnerUid,
    checkoutGeneration: String(normalizedGeneration),
    plan: BUYER_ACCESS_PLAN
  };
  return {
    idempotencyKey: `buyer-access-${normalizedOrderId}-g${normalizedGeneration}`,
    params: {
      mode: "payment",
      client_reference_id: normalizedOrderId,
      customer_email: normalizedOwnerEmail,
      invoice_creation: { enabled: true },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: BUYER_ACCESS_CURRENCY,
            unit_amount: BUYER_ACCESS_AMOUNT_CENTS,
            product_data: {
              name: "QuotePilot Starter Access",
              description: `Starter workspace access for ${normalizedOrganizationName}`
            }
          }
        }
      ],
      metadata,
      payment_intent_data: { metadata },
      success_url: successUrl,
      cancel_url: cancelUrl
    }
  };
}

function isBuyerAccessSession(session = {}) {
  return text(session?.metadata?.flow).toLowerCase() === BUYER_ACCESS_FLOW;
}

function assertBuyerAccessSessionBinding({
  eventLivemode,
  order,
  session,
  stripeMode
} = {}) {
  assertBuyerAccessRuntime({ enabled: "true", stripeMode });
  const expectedSessionId = text(order?.stripeSessionId);
  const observedSessionId = text(session?.id);
  const orderId = text(order?.orderId);
  const ownerUid = text(order?.ownerUid);
  const ownerEmail = normalizedEmail(order?.ownerEmail);
  const generation = normalizeGeneration(order?.checkoutGeneration);
  if (text(order?.flow).toLowerCase() !== BUYER_ACCESS_FLOW) {
    throw new BuyerAccessError("Stored order is not a buyer access purchase.");
  }
  if (!expectedSessionId || observedSessionId !== expectedSessionId) {
    throw new BuyerAccessError("Stripe Checkout Session does not match the buyer order.");
  }
  if (
    session?.livemode !== false
    || (eventLivemode !== undefined && eventLivemode !== false)
  ) {
    throw new BuyerAccessError("Buyer access Checkout Session must be in Stripe test mode.");
  }
  if (!isBuyerAccessSession(session)) {
    throw new BuyerAccessError("Stripe Checkout Session is not a buyer access purchase.");
  }
  if (
    text(session?.metadata?.buyerAccessOrderId) !== orderId
    || text(session?.client_reference_id) !== orderId
  ) {
    throw new BuyerAccessError("Stripe Checkout Session order binding is invalid.");
  }
  if (
    text(session?.metadata?.ownerUid) !== ownerUid
    || text(session?.metadata?.checkoutGeneration) !== String(generation)
    || text(session?.metadata?.plan).toLowerCase() !== BUYER_ACCESS_PLAN
  ) {
    throw new BuyerAccessError("Stripe Checkout Session owner or plan binding is invalid.");
  }
  if (
    text(session?.mode).toLowerCase() !== "payment"
    || Number(session?.amount_total) !== BUYER_ACCESS_AMOUNT_CENTS
    || text(session?.currency).toLowerCase() !== BUYER_ACCESS_CURRENCY
    || session?.invoice_creation?.enabled !== true
  ) {
    throw new BuyerAccessError("Stripe Checkout Session amount, currency, or invoice configuration is invalid.");
  }
  const sessionEmails = [session?.customer_email, session?.customer_details?.email]
    .map(normalizedEmail)
    .filter(Boolean);
  if (!ownerEmail || sessionEmails.length === 0 || sessionEmails.some((email) => email !== ownerEmail)) {
    throw new BuyerAccessError("Stripe Checkout Session owner email is invalid.");
  }
  return {
    amountCents: BUYER_ACCESS_AMOUNT_CENTS,
    currency: BUYER_ACCESS_CURRENCY,
    generation,
    orderId,
    ownerEmail,
    ownerUid,
    sessionId: observedSessionId
  };
}

function planBuyerAccessTransition({ currentStatus, providerState } = {}) {
  const current = text(currentStatus).toLowerCase() || "checkout_pending";
  const observed = text(providerState).toLowerCase();
  if (current === "active") {
    return { apply: false, status: "active", accessGranted: true, reason: "already_active" };
  }
  const statusByProviderState = {
    open: "checkout_pending",
    processing: "payment_processing",
    paid: "active",
    failed: "payment_failed",
    expired: "expired"
  };
  const status = statusByProviderState[observed];
  if (!status) {
    throw new BuyerAccessError("Stripe buyer access state is invalid.");
  }
  if (["payment_failed", "expired"].includes(current) && observed !== "paid") {
    return { apply: false, status: current, accessGranted: false, reason: "terminal_unpaid_state" };
  }
  return {
    apply: current !== status,
    status,
    accessGranted: status === "active",
    reason: current === status ? "already_observed" : "provider_transition"
  };
}

function buyerAccessStatusResponse(order = {}) {
  const status = text(order.status).toLowerCase();
  if (!BUYER_ACCESS_STATUSES.includes(status)) {
    throw new BuyerAccessError("Buyer access order status is invalid.", "internal");
  }
  const active = status === "active" && order.accessGranted === true;
  return {
    orderId: text(order.orderId),
    sessionId: text(order.stripeSessionId),
    status,
    accessGranted: active,
    organizationId: active ? text(order.organizationId) : null,
    appUrl: active ? "/app" : null
  };
}

async function neutralizeBuyerAccessCheckoutSession({ expireSession, session } = {}) {
  const sessionId = text(session?.id);
  if (!sessionId || typeof expireSession !== "function") {
    return {
      outcome: "review_required",
      reason: "expiration_unavailable",
      sessionId
    };
  }
  let observed = session;
  const status = text(observed?.status).toLowerCase();
  const paymentStatus = text(observed?.payment_status).toLowerCase();
  if (status === "open" && paymentStatus === "unpaid") {
    try {
      observed = await expireSession(sessionId);
    } catch (error) {
      return {
        outcome: "review_required",
        reason: "expiration_unconfirmed",
        sessionId
      };
    }
  }
  const observedSessionId = text(observed?.id);
  const observedStatus = text(observed?.status).toLowerCase();
  const observedPaymentStatus = text(observed?.payment_status).toLowerCase();
  if (
    observedSessionId === sessionId
    && observedStatus === "expired"
    && observedPaymentStatus === "unpaid"
  ) {
    return {
      outcome: "neutralized",
      reason: "expiration_confirmed",
      sessionId
    };
  }
  return {
    outcome: "review_required",
    reason: observedPaymentStatus === "paid"
      ? "provider_reports_paid"
      : "expiration_unconfirmed",
    sessionId
  };
}

module.exports = {
  BUYER_ACCESS_AMOUNT_CENTS,
  BUYER_ACCESS_CURRENCY,
  BUYER_ACCESS_FLOW,
  BUYER_ACCESS_PLAN,
  BUYER_ACCESS_STATUSES,
  BuyerAccessError,
  assertBuyerAccessRuntime,
  assertBuyerAccessSessionBinding,
  buildBuyerAccessCheckout,
  buildBuyerAccessIdentifiers,
  buildBuyerAccessReturnUrls,
  buyerAccessOrderIdForUid,
  buyerAccessStatusResponse,
  isBuyerAccessSession,
  neutralizeBuyerAccessCheckoutSession,
  normalizeBuyerAccessRequest,
  planBuyerAccessTransition
};
