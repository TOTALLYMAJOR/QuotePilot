import { httpsCallable } from "firebase/functions";
import { auth, cloudFunctions } from "./firebase";

const CREATE_BUYER_ACCESS_CHECKOUT = "createBuyerAccessCheckout";
const GET_BUYER_ACCESS_CHECKOUT_STATUS = "getBuyerAccessCheckoutStatus";
const BUYER_ACCESS_STATUSES = new Set([
  "checkout_pending",
  "payment_processing",
  "active",
  "payment_failed",
  "expired"
]);
const E2E_FUNCTION_ADAPTER_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
);

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function requireVerifiedBuyer() {
  if (!auth?.currentUser) {
    throw new Error("Sign in before starting the $1 access purchase.");
  }
  if (auth.currentUser.emailVerified !== true) {
    throw new Error("Verify your email before starting the $1 access purchase.");
  }
}

function requireFunctions() {
  if (!cloudFunctions) {
    throw new Error("Buyer checkout is unavailable in this environment.");
  }
}

function e2eAdapter(name) {
  if (!E2E_FUNCTION_ADAPTER_ENABLED) return null;
  const adapter = globalThis.__quotePilotE2eFunctions;
  return typeof adapter?.[name] === "function" ? adapter[name] : null;
}

async function callBuyerFunction(name, payload) {
  const adapter = e2eAdapter(name);
  if (adapter) return adapter(payload);
  requireVerifiedBuyer();
  requireFunctions();
  const call = httpsCallable(cloudFunctions, name);
  const result = await call(payload);
  return result?.data;
}

export function isBuyerAccessSessionId(value) {
  return /^cs_test_[A-Za-z0-9_]+$/.test(String(value || "").trim());
}

export function buildBuyerAccessCheckoutPayload({ organizationName, ownerName } = {}) {
  const payload = {
    organizationName: cleanText(organizationName, 120),
    ownerName: cleanText(ownerName, 100)
  };
  if (payload.organizationName.length < 2) {
    throw new Error("Enter your business name.");
  }
  if (payload.ownerName.length < 2) {
    throw new Error("Enter the owner name.");
  }
  return payload;
}

function normalizeBuyerOrderIdentity(response = {}) {
  const orderId = cleanText(response.orderId, 160);
  const sessionId = cleanText(response.sessionId, 180);
  if (!orderId || !isBuyerAccessSessionId(sessionId)) {
    throw new Error("Buyer checkout returned an invalid order identity.");
  }
  return { orderId, sessionId };
}

function normalizeStripeCheckoutUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("Buyer checkout returned an invalid Stripe URL.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "checkout.stripe.com"
    || parsed.port
    || parsed.username
    || parsed.password
  ) {
    throw new Error("Buyer checkout returned an invalid Stripe URL.");
  }
  return parsed.toString();
}

function normalizeAppDestination(value) {
  const candidate = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(candidate, "https://quotepilot.mbmapps.com");
  } catch {
    throw new Error("Buyer access returned an invalid workspace location.");
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
  if (
    normalizedPath !== "/app"
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password
  ) {
    throw new Error("Buyer access returned an invalid workspace location.");
  }
  return "/app";
}

export async function createBuyerAccessCheckout(input = {}) {
  const payload = buildBuyerAccessCheckoutPayload(input);
  const response = await callBuyerFunction(CREATE_BUYER_ACCESS_CHECKOUT, payload);
  const identity = normalizeBuyerOrderIdentity(response);
  if (String(response?.status || "").trim().toLowerCase() !== "checkout_pending") {
    throw new Error("Buyer checkout returned an invalid initial status.");
  }
  return {
    ...identity,
    checkoutUrl: normalizeStripeCheckoutUrl(response?.checkoutUrl),
    status: "checkout_pending"
  };
}

export async function getBuyerAccessCheckoutStatus({ sessionId } = {}) {
  const normalizedSessionId = cleanText(sessionId, 180);
  if (!isBuyerAccessSessionId(normalizedSessionId)) {
    throw new Error("A valid Stripe Checkout Session is required to verify access.");
  }
  const response = await callBuyerFunction(GET_BUYER_ACCESS_CHECKOUT_STATUS, {
    sessionId: normalizedSessionId
  });
  const identity = normalizeBuyerOrderIdentity(response);
  if (identity.sessionId !== normalizedSessionId) {
    throw new Error("Buyer access status did not match this Checkout Session.");
  }
  const status = String(response?.status || "").trim().toLowerCase();
  if (!BUYER_ACCESS_STATUSES.has(status) || typeof response?.accessGranted !== "boolean") {
    throw new Error("Buyer access returned an invalid authoritative status.");
  }

  const organizationId = response?.organizationId == null
    ? null
    : cleanText(response.organizationId, 120) || null;
  const active = status === "active";
  if (active && (response.accessGranted !== true || !organizationId || !response?.appUrl)) {
    throw new Error("Buyer access activation is incomplete.");
  }
  if (!active && response.accessGranted !== false) {
    throw new Error("Buyer access returned a conflicting authoritative status.");
  }

  return {
    ...identity,
    status,
    accessGranted: response.accessGranted,
    organizationId,
    appUrl: active ? normalizeAppDestination(response.appUrl) : null
  };
}

export function redirectToBuyerAccessCheckout(checkoutUrl) {
  const safeUrl = normalizeStripeCheckoutUrl(checkoutUrl);
  const testRedirect = E2E_FUNCTION_ADAPTER_ENABLED
    ? globalThis.__quotePilotE2eCheckoutRedirect
    : null;
  if (typeof testRedirect === "function") {
    testRedirect(safeUrl);
    return;
  }
  window.location.assign(safeUrl);
}
