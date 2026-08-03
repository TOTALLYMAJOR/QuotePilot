import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

const MAX_EMAIL_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const DEFAULT_SAVE_CALLABLE_TIMEOUT_MS = 45_000;

function toPositiveTimeout(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1_000, Math.round(parsed));
}

const SAVE_CALLABLE_TIMEOUT_MS = toPositiveTimeout(
  import.meta.env?.VITE_SAVE_CALLABLE_TIMEOUT_MS
    ?? import.meta.env?.VITE_CALLABLE_TIMEOUT_MS,
  DEFAULT_SAVE_CALLABLE_TIMEOUT_MS
);

function ensureFunctionsReady() {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Cloud Functions unavailable. Check Firebase env configuration.");
  }
}

async function withTimeout(promise, timeoutMs, operation) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function estimateBase64SizeBytes(base64Value = "") {
  const normalized = String(base64Value || "")
    .replace(/^data:application\/pdf;base64,/i, "")
    .replace(/\s+/g, "");
  if (!normalized) return 0;
  return Math.floor((normalized.length * 3) / 4);
}

function assertAttachmentWithinEmailLimit(attachment) {
  if (!attachment || typeof attachment !== "object") return;
  const approxBytes = estimateBase64SizeBytes(attachment.base64);
  if (approxBytes <= MAX_EMAIL_ATTACHMENT_BYTES) return;
  throw new Error("Attachment is too large (max 7 MB). Reduce PDF size before sending.");
}

export async function notifyOwnerNewQuote({ quoteId }) {
  ensureFunctionsReady();
  const call = httpsCallable(cloudFunctions, "notifyOwnerNewQuote");
  const result = await withTimeout(
    call({ quoteId }),
    SAVE_CALLABLE_TIMEOUT_MS,
    "notifyOwnerNewQuote"
  );
  return result.data || {};
}

export async function createDepositCheckout({ quoteId }) {
  ensureFunctionsReady();
  const call = httpsCallable(cloudFunctions, "createDepositCheckout");
  const result = await call({ quoteId });
  return result.data || {};
}

export async function getIntegrationSetupStatus() {
  ensureFunctionsReady();
  const call = httpsCallable(cloudFunctions, "getIntegrationSetupStatus");
  const result = await call({});
  return result.data || {};
}

export async function sendIntegrationTestSms({ message = "" } = {}) {
  ensureFunctionsReady();
  const call = httpsCallable(cloudFunctions, "sendIntegrationTestSms");
  const result = await call({
    message
  });
  return result.data || {};
}

export async function calculateQuotePricing({ organizationId = "", pricingInput = {}, form = null } = {}) {
  ensureFunctionsReady();
  const call = httpsCallable(cloudFunctions, "calculateQuotePricing");
  const payload = {
    organizationId,
    pricingInput
  };
  if (form && typeof form === "object") {
    payload.form = form;
  }
  const result = await withTimeout(
    call(payload),
    SAVE_CALLABLE_TIMEOUT_MS,
    "calculateQuotePricing"
  );
  return result.data || {};
}

export async function sendQuoteToCustomerEmail({ quoteId, attachment = null } = {}) {
  ensureFunctionsReady();
  assertAttachmentWithinEmailLimit(attachment);
  const call = httpsCallable(cloudFunctions, "sendQuoteToCustomer");
  const result = await call({
    quoteId,
    attachment
  });
  return result.data || {};
}

export async function sendPaymentRequestToCustomerEmail({
  quoteId,
  approvalRequestId,
  attachment = null
} = {}) {
  ensureFunctionsReady();
  assertAttachmentWithinEmailLimit(attachment);
  const call = httpsCallable(cloudFunctions, "sendPaymentRequestEmail");
  const result = await call({
    quoteId,
    approvalRequestId,
    attachment
  });
  return result.data || {};
}
