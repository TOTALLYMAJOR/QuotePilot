import { httpsCallable } from "firebase/functions";
import { cloudFunctions } from "./firebase";

const CREATE_BUYER_ACCESS_INVOICE = "createBuyerAccessInvoice";
const GET_BUYER_ACCESS_INVOICE_STATUS = "getBuyerAccessInvoiceStatus";
const BUYER_ACCESS_STATUS_STORAGE_KEY = "quotepilot:buyer-access-status:v1";
const BUYER_ACCESS_REQUEST_STORAGE_KEY = "quotepilot:buyer-access-request:v1";
const BUYER_ACCESS_STATUSES = new Set([
  "invoice_open",
  "payment_processing",
  "provisioning",
  "activation_sent",
  "active",
  "payment_failed",
  "void",
  "expired"
]);
const REOPENABLE_INVOICE_STATUSES = new Set(["invoice_open", "payment_failed"]);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUYER_ORDER_ID_PATTERN = /^ba-[a-f0-9]{40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E2E_FUNCTION_ADAPTER_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
);

export const BUYER_ACCESS_E2E_TURNSTILE_TOKEN = "quotepilot-e2e-turnstile-token";

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanOwnerEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function cleanTurnstileToken(value) {
  const token = String(value || "").trim();
  return token.length <= 2048 && !/\s/.test(token) ? token : "";
}

function requireFunctions() {
  if (!cloudFunctions) {
    throw new Error("Buyer invoice creation is unavailable in this environment.");
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
  requireFunctions();
  const call = httpsCallable(cloudFunctions, name);
  const result = await call(payload);
  return result?.data;
}

export function isBuyerAccessRequestId(value) {
  return UUID_V4_PATTERN.test(String(value || "").trim());
}

export function isBuyerAccessOrderId(value) {
  return BUYER_ORDER_ID_PATTERN.test(String(value || "").trim());
}

export function createBuyerAccessRequestId(cryptoSource = globalThis.crypto) {
  const requestId = String(cryptoSource?.randomUUID?.() || "").trim().toLowerCase();
  if (!isBuyerAccessRequestId(requestId)) {
    throw new Error("QuotePilot could not create a secure invoice request identity.");
  }
  return requestId;
}

export function buildBuyerAccessInvoicePayload({
  organizationName,
  ownerName,
  ownerEmail,
  requestId,
  turnstileToken
} = {}) {
  const payload = {
    organizationName: cleanText(organizationName, 120),
    ownerName: cleanText(ownerName, 100),
    ownerEmail: cleanOwnerEmail(ownerEmail),
    requestId: String(requestId || "").trim().toLowerCase(),
    turnstileToken: cleanTurnstileToken(turnstileToken)
  };
  if (payload.organizationName.length < 2) {
    throw new Error("Enter your business name.");
  }
  if (payload.ownerName.length < 2) {
    throw new Error("Enter the owner name.");
  }
  if (!EMAIL_PATTERN.test(payload.ownerEmail)) {
    throw new Error("Enter a valid email address.");
  }
  if (!isBuyerAccessRequestId(payload.requestId)) {
    throw new Error("QuotePilot could not create a secure invoice request identity.");
  }
  if (!payload.turnstileToken) {
    throw new Error("Complete the security verification before creating your invoice.");
  }
  return payload;
}

function normalizeBuyerRequestIdentity({ organizationName, ownerName, ownerEmail } = {}) {
  const normalized = {
    organizationName: cleanText(organizationName, 120),
    ownerName: cleanText(ownerName, 100),
    ownerEmail: cleanOwnerEmail(ownerEmail)
  };
  if (
    normalized.organizationName.length < 2
    || normalized.ownerName.length < 2
    || !EMAIL_PATTERN.test(normalized.ownerEmail)
  ) {
    throw new Error("Buyer invoice request identity is incomplete.");
  }
  return normalized;
}

function normalizeBuyerOrderId(value) {
  const orderId = cleanText(value, 160);
  if (!isBuyerAccessOrderId(orderId)) {
    throw new Error("Buyer invoice returned an invalid order identity.");
  }
  return orderId;
}

function normalizeStatusToken(value) {
  const statusToken = String(value || "").trim().toLowerCase();
  if (!isBuyerAccessRequestId(statusToken)) {
    throw new Error("Buyer invoice returned an invalid status identity.");
  }
  return statusToken;
}

function normalizeBuyerStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!BUYER_ACCESS_STATUSES.has(status)) {
    throw new Error("Buyer invoice returned an invalid authoritative status.");
  }
  return status;
}

export function normalizeStripeHostedInvoiceUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("Buyer invoice returned an invalid Stripe URL.");
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
    throw new Error("Buyer invoice returned an invalid Stripe URL.");
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

export async function createBuyerAccessInvoice(input = {}) {
  const payload = buildBuyerAccessInvoicePayload(input);
  const response = await callBuyerFunction(CREATE_BUYER_ACCESS_INVOICE, payload);
  const orderId = normalizeBuyerOrderId(response?.orderId);
  const statusToken = normalizeStatusToken(response?.statusToken);
  const status = normalizeBuyerStatus(response?.status);
  if (statusToken !== payload.requestId) {
    throw new Error("Buyer invoice status did not match this request.");
  }
  if (!REOPENABLE_INVOICE_STATUSES.has(status)) {
    throw new Error("Buyer invoice returned an invalid initial status.");
  }
  return {
    orderId,
    statusToken,
    hostedInvoiceUrl: normalizeStripeHostedInvoiceUrl(response?.hostedInvoiceUrl),
    status
  };
}

export async function getBuyerAccessInvoiceStatus({ orderId, statusToken } = {}) {
  const normalizedOrderId = normalizeBuyerOrderId(orderId);
  const normalizedStatusToken = normalizeStatusToken(statusToken);
  const response = await callBuyerFunction(GET_BUYER_ACCESS_INVOICE_STATUS, {
    orderId: normalizedOrderId,
    statusToken: normalizedStatusToken
  });
  const responseOrderId = normalizeBuyerOrderId(response?.orderId);
  if (responseOrderId !== normalizedOrderId) {
    throw new Error("Buyer invoice status did not match this order.");
  }

  const status = normalizeBuyerStatus(response?.status);
  if (
    typeof response?.activationEmailSent !== "boolean"
    || typeof response?.workspaceReady !== "boolean"
  ) {
    throw new Error("Buyer invoice returned an invalid authoritative status.");
  }

  const workspaceExpected = status === "activation_sent" || status === "active";
  const provisioningEvidenceValid = status === "provisioning"
    && response.activationEmailSent === false;
  const otherEvidenceValid = status !== "provisioning"
    && response.workspaceReady === workspaceExpected
    && (status !== "activation_sent" || response.activationEmailSent === true)
    && (workspaceExpected || response.activationEmailSent === false);
  if (!provisioningEvidenceValid && !otherEvidenceValid) {
    throw new Error("Buyer invoice returned conflicting activation evidence.");
  }

  const appUrl = response?.appUrl == null ? null : normalizeAppDestination(response.appUrl);
  if ((status === "active") !== Boolean(appUrl)) {
    throw new Error("Buyer access activation is incomplete.");
  }

  const rawHostedInvoiceUrl = response?.hostedInvoiceUrl;
  const hostedInvoiceUrl = rawHostedInvoiceUrl == null || rawHostedInvoiceUrl === ""
    ? null
    : normalizeStripeHostedInvoiceUrl(rawHostedInvoiceUrl);
  if (hostedInvoiceUrl && !REOPENABLE_INVOICE_STATUSES.has(status)) {
    throw new Error("Buyer invoice returned conflicting payment-link evidence.");
  }

  return {
    orderId: responseOrderId,
    status,
    activationEmailSent: response.activationEmailSent,
    workspaceReady: response.workspaceReady,
    appUrl,
    hostedInvoiceUrl
  };
}

export function storeBuyerAccessStatusContext({ orderId, statusToken } = {}) {
  const normalizedOrderId = normalizeBuyerOrderId(orderId);
  const normalizedStatusToken = normalizeStatusToken(statusToken);
  if (typeof window === "undefined" || !window.sessionStorage) return false;
  try {
    window.sessionStorage.setItem(BUYER_ACCESS_STATUS_STORAGE_KEY, JSON.stringify({
      orderId: normalizedOrderId,
      statusToken: normalizedStatusToken
    }));
    return true;
  } catch {
    return false;
  }
}

export function readBuyerAccessStatusContext(expectedOrderId = "") {
  const normalizedExpectedOrderId = String(expectedOrderId || "").trim();
  if (normalizedExpectedOrderId && !isBuyerAccessOrderId(normalizedExpectedOrderId)) return null;
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(BUYER_ACCESS_STATUS_STORAGE_KEY) || "null");
    const orderId = normalizeBuyerOrderId(parsed?.orderId);
    const statusToken = normalizeStatusToken(parsed?.statusToken);
    return !normalizedExpectedOrderId || orderId === normalizedExpectedOrderId
      ? { orderId, statusToken }
      : null;
  } catch {
    return null;
  }
}

export function storeBuyerAccessRequestContext({
  organizationName,
  ownerName,
  ownerEmail,
  requestId
} = {}) {
  const identity = normalizeBuyerRequestIdentity({ organizationName, ownerName, ownerEmail });
  const normalizedRequestId = normalizeStatusToken(requestId);
  if (typeof window === "undefined" || !window.sessionStorage) return false;
  try {
    window.sessionStorage.setItem(BUYER_ACCESS_REQUEST_STORAGE_KEY, JSON.stringify({
      ...identity,
      requestId: normalizedRequestId
    }));
    return true;
  } catch {
    return false;
  }
}

export function readBuyerAccessRequestContext() {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(BUYER_ACCESS_REQUEST_STORAGE_KEY) || "null");
    const identity = normalizeBuyerRequestIdentity(parsed);
    const requestId = normalizeStatusToken(parsed?.requestId);
    return { ...identity, requestId };
  } catch {
    return null;
  }
}

export function clearBuyerAccessRequestContext() {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(BUYER_ACCESS_REQUEST_STORAGE_KEY);
  } catch {
    // A failed cleanup cannot change the server-owned idempotent request.
  }
}

export function clearBuyerAccessStatusContext() {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(BUYER_ACCESS_STATUS_STORAGE_KEY);
  } catch {
    // A failed cleanup cannot grant access or change the server-owned order.
  }
}

export function redirectToBuyerAccessInvoice({ orderId, statusToken, hostedInvoiceUrl } = {}) {
  const normalizedOrderId = normalizeBuyerOrderId(orderId);
  const normalizedStatusToken = normalizeStatusToken(statusToken);
  const safeUrl = normalizeStripeHostedInvoiceUrl(hostedInvoiceUrl);
  const statusStored = storeBuyerAccessStatusContext({
    orderId: normalizedOrderId,
    statusToken: normalizedStatusToken
  });
  if (!statusStored) {
    throw new Error("Secure invoice status recovery is unavailable in this browser.");
  }
  clearBuyerAccessRequestContext();
  if (typeof window !== "undefined" && window.history?.replaceState) {
    window.history.replaceState(null, "", "/start");
  }
  const testRedirect = E2E_FUNCTION_ADAPTER_ENABLED
    ? globalThis.__quotePilotE2eInvoiceRedirect
    : null;
  if (typeof testRedirect === "function") {
    testRedirect(safeUrl);
    return;
  }
  window.location.assign(safeUrl);
}
