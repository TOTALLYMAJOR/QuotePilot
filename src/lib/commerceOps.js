import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

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

export async function getIntegrationSetupStatus() {
  ensureFunctionsReady();
  const call = httpsCallable(cloudFunctions, "getIntegrationSetupStatus");
  const result = await call({});
  return result.data || {};
}

export function buildBuyerAccessRepairConfirmationToken(orderId = "") {
  const normalizedOrderId = String(orderId || "").trim().toLowerCase();
  return /^ba-[a-f0-9]{40}$/.test(normalizedOrderId)
    ? `VOID BUYER INVOICE ${normalizedOrderId}`
    : "";
}

export async function repairBuyerAccessInvoice({ orderId, confirmationToken } = {}) {
  ensureFunctionsReady();
  const normalizedOrderId = String(orderId || "").trim().toLowerCase();
  const expectedConfirmationToken = buildBuyerAccessRepairConfirmationToken(normalizedOrderId);
  if (!expectedConfirmationToken) {
    throw new Error("A valid buyer access order id is required for repair.");
  }
  if (String(confirmationToken || "").trim() !== expectedConfirmationToken) {
    throw new Error(`Buyer invoice repair token mismatch. Use exactly: ${expectedConfirmationToken}`);
  }
  const call = httpsCallable(cloudFunctions, "repairBuyerAccessInvoice");
  const result = await call({
    orderId: normalizedOrderId,
    confirmationToken: expectedConfirmationToken
  });
  const response = result.data && typeof result.data === "object" ? result.data : {};
  if (
    response.ok !== true
    || String(response.orderId || "").trim().toLowerCase() !== normalizedOrderId
    || String(response.status || "").trim().toLowerCase() !== "void"
    || String(response.providerState || "").trim().toLowerCase() !== "void"
    || response.providerVoidVerified !== true
    || response.emailWindowStillApplies !== true
    || !["voided", "already_void"].includes(
      String(response.providerMutation || "").trim().toLowerCase()
    )
    || !/^stripe-buyer-repair-[a-f0-9-]{36}$/.test(
      String(response.auditEventId || "").trim().toLowerCase()
    )
    || Object.keys(response).some((key) => /url|secret|token/i.test(key))
  ) {
    throw new Error("Buyer invoice repair returned an invalid authoritative response.");
  }
  return response;
}

export async function reconcileDepositCheckout({ quoteId } = {}) {
  ensureFunctionsReady();
  const normalizedQuoteId = String(quoteId || "").trim();
  if (!normalizedQuoteId) {
    throw new Error("Quote id is required for payment reconciliation.");
  }
  const call = httpsCallable(cloudFunctions, "reconcileDepositCheckout");
  const result = await call({ quoteId: normalizedQuoteId });
  const response = result.data && typeof result.data === "object" ? result.data : {};
  if (
    response.ok !== true
    || String(response.quoteId || "").trim() !== normalizedQuoteId
    || !/^cs_[A-Za-z0-9_]+$/.test(String(response.stripeSessionId || "").trim())
    || !["open", "processing", "paid", "failed", "expired", "unknown"].includes(
      String(response.providerState || "").trim().toLowerCase()
    )
    || !String(response.auditEventId || "").trim()
    || Object.prototype.hasOwnProperty.call(response, "paymentLink")
    || Object.prototype.hasOwnProperty.call(response, "url")
  ) {
    throw new Error("Payment reconciliation returned an invalid authoritative response.");
  }
  return response;
}

export async function reconcileFinalBalanceCheckout({ quoteId } = {}) {
  ensureFunctionsReady();
  const normalizedQuoteId = String(quoteId || "").trim();
  if (!normalizedQuoteId) {
    throw new Error("Quote id is required for final-balance reconciliation.");
  }
  const call = httpsCallable(cloudFunctions, "reconcileFinalBalanceCheckout");
  const result = await call({ quoteId: normalizedQuoteId });
  const response = result.data && typeof result.data === "object" ? result.data : {};
  if (
    response.ok !== true
    || String(response.quoteId || "").trim() !== normalizedQuoteId
    || String(response.paymentKind || "").trim().toLowerCase() !== "final_balance"
    || !Number.isSafeInteger(response.amountCents)
    || response.amountCents <= 0
    || !/^cs_[A-Za-z0-9_]+$/.test(String(response.stripeSessionId || "").trim())
    || !["open", "processing", "paid", "failed", "expired", "unknown"].includes(
      String(response.providerState || "").trim().toLowerCase()
    )
    || !String(response.auditEventId || "").trim()
    || Object.prototype.hasOwnProperty.call(response, "paymentLink")
    || Object.prototype.hasOwnProperty.call(response, "url")
  ) {
    throw new Error("Final-balance reconciliation returned an invalid authoritative response.");
  }
  return response;
}

export async function getOperationsAuditSnapshot({ organizationId = "" } = {}) {
  ensureFunctionsReady();
  const call = httpsCallable(cloudFunctions, "getOperationsAuditSnapshot");
  const result = await call({ organizationId });
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

export async function calculateQuotePricing({
  organizationId = "",
  pricingInput = {},
  form = null,
  includeChangeImpactPreview = false,
  expectedActiveVersionId = ""
} = {}) {
  ensureFunctionsReady();
  const call = httpsCallable(cloudFunctions, "calculateQuotePricing");
  const payload = {
    organizationId,
    pricingInput
  };
  if (form && typeof form === "object") {
    payload.form = form;
  }
  if (includeChangeImpactPreview === true) {
    payload.includeChangeImpactPreview = true;
    payload.expectedActiveVersionId = String(expectedActiveVersionId || "").trim();
  }
  const result = await withTimeout(
    call(payload),
    SAVE_CALLABLE_TIMEOUT_MS,
    "calculateQuotePricing"
  );
  return result.data || {};
}

export function resolveQuoteDeliveryRevisionId(quote = {}) {
  const explicit = String(quote.activeVersionId || quote.versionMeta?.versionId || "")
    .trim()
    .slice(0, 80);
  const versionNumber = Number(quote.latestVersionNumber || quote.versionMeta?.versionNumber);
  const contentRevisionId = explicit || (
    Number.isSafeInteger(versionNumber) && versionNumber > 0
      ? `v${String(versionNumber).padStart(4, "0")}`
      : ""
  );
  if (!contentRevisionId) {
    throw new Error("Save this quote as a versioned draft before sending customer email.");
  }
  const portalIssuedAt = String(quote.portalIssuedAtISO || "").trim();
  const parsedPortalIssuedAt = portalIssuedAt ? new Date(portalIssuedAt) : null;
  const portalIdentity = parsedPortalIssuedAt && !Number.isNaN(parsedPortalIssuedAt.getTime())
    ? parsedPortalIssuedAt.toISOString()
    : String(quote.portalKey || "").trim().slice(0, 64);
  return portalIdentity
    ? `${contentRevisionId}@${portalIdentity}`
    : contentRevisionId;
}

export async function sendQuoteToCustomerEmail({
  quoteId,
  quoteRevisionId
} = {}) {
  ensureFunctionsReady();
  const normalizedQuoteId = String(quoteId || "").trim();
  const normalizedRevisionId = String(quoteRevisionId || "").trim();
  if (!normalizedQuoteId || !normalizedRevisionId) {
    throw new Error("A saved quote revision is required before sending customer email.");
  }
  const call = httpsCallable(cloudFunctions, "sendQuoteToCustomer");
  const result = await call({
    quoteId: normalizedQuoteId,
    quoteRevisionId: normalizedRevisionId
  });
  const response = result.data && typeof result.data === "object" ? result.data : {};
  const responseStatus = String(response.status || "").trim().toLowerCase();
  if (
    response.ok !== true
    || String(response.quoteId || "").trim() !== normalizedQuoteId
    || String(response.quoteRevisionId || "").trim() !== normalizedRevisionId
    || !["sent", "viewed", "accepted", "declined", "booked"].includes(responseStatus)
    || response.email?.sent !== true
    || !String(response.email?.provider || "").trim()
    || !String(response.email?.messageId || "").trim()
    || String(response.delivery?.revisionId || "").trim() !== normalizedRevisionId
    || String(response.delivery?.state || "").trim().toLowerCase() !== "provider_accepted"
  ) {
    throw new Error("Quote delivery returned an invalid authoritative response.");
  }
  return response;
}

export async function resolveQuoteDeliveryOutcome({
  quoteId,
  quoteRevisionId,
  resolution,
  note,
  providerMessageId = ""
} = {}) {
  ensureFunctionsReady();
  const normalizedQuoteId = String(quoteId || "").trim();
  const normalizedRevisionId = String(quoteRevisionId || "").trim();
  const normalizedResolution = String(resolution || "").trim().toLowerCase();
  const normalizedNote = String(note || "").trim();
  const normalizedProviderMessageId = String(providerMessageId || "").trim();
  if (!normalizedQuoteId || !normalizedRevisionId) {
    throw new Error("A saved quote revision is required for delivery review.");
  }
  if (!["confirmed_not_sent", "provider_accepted"].includes(normalizedResolution)) {
    throw new Error("Choose a valid delivery review outcome.");
  }
  if (normalizedNote.length < 8) {
    throw new Error("Add a short audit note describing the provider check.");
  }
  if (normalizedResolution === "provider_accepted" && !normalizedProviderMessageId) {
    throw new Error("Provider message ID is required to record provider acceptance.");
  }
  const call = httpsCallable(cloudFunctions, "resolveQuoteDeliveryOutcome");
  const result = await call({
    quoteId: normalizedQuoteId,
    quoteRevisionId: normalizedRevisionId,
    resolution: normalizedResolution,
    note: normalizedNote,
    providerMessageId: normalizedProviderMessageId
  });
  const response = result.data && typeof result.data === "object" ? result.data : {};
  const expectedState = normalizedResolution === "provider_accepted"
    ? "provider_accepted"
    : "reconciled_not_sent";
  if (
    response.ok !== true
    || String(response.quoteId || "").trim() !== normalizedQuoteId
    || String(response.quoteRevisionId || "").trim() !== normalizedRevisionId
    || String(response.resolution || "").trim().toLowerCase() !== normalizedResolution
    || String(response.delivery?.revisionId || "").trim() !== normalizedRevisionId
    || String(response.delivery?.state || "").trim().toLowerCase() !== expectedState
  ) {
    throw new Error("Delivery review returned an invalid authoritative response.");
  }
  return response;
}

export async function sendPaymentRequestToCustomerEmail({
  quoteId,
  approvalRequestId
} = {}) {
  ensureFunctionsReady();
  const call = httpsCallable(cloudFunctions, "sendPaymentRequestEmail");
  const result = await call({
    quoteId,
    approvalRequestId
  });
  const response = result.data && typeof result.data === "object" ? result.data : {};
  if (
    response.ok !== true
    || String(response.quoteId || "").trim() !== String(quoteId || "").trim()
    || String(response.approvalRequest?.id || "").trim() !== String(approvalRequestId || "").trim()
    || String(response.approvalRequest?.executionState || "").trim().toLowerCase() !== "succeeded"
    || response.email?.sent !== true
    || !String(response.email?.provider || "").trim()
    || !String(response.email?.messageId || "").trim()
    || !/^cs_[A-Za-z0-9_]+$/.test(String(response.stripeSessionId || "").trim())
    || !Number.isSafeInteger(Number(response.checkoutGeneration))
    || typeof response.published !== "boolean"
    || Object.prototype.hasOwnProperty.call(response, "paymentLink")
    || Object.prototype.hasOwnProperty.call(response, "url")
  ) {
    throw new Error("Payment request returned an invalid authoritative response.");
  }
  return response;
}

export async function sendFinalBalanceRequestToCustomerEmail({
  quoteId,
  approvalRequestId
} = {}) {
  ensureFunctionsReady();
  const call = httpsCallable(cloudFunctions, "sendFinalBalanceRequestEmail");
  const result = await call({
    quoteId,
    approvalRequestId
  });
  const response = result.data && typeof result.data === "object" ? result.data : {};
  if (
    response.ok !== true
    || String(response.quoteId || "").trim() !== String(quoteId || "").trim()
    || String(response.paymentKind || "").trim().toLowerCase() !== "final_balance"
    || !Number.isSafeInteger(response.amountCents)
    || response.amountCents <= 0
    || String(response.approvalRequest?.id || "").trim() !== String(approvalRequestId || "").trim()
    || String(response.approvalRequest?.executionState || "").trim().toLowerCase() !== "succeeded"
    || response.email?.sent !== true
    || !String(response.email?.provider || "").trim()
    || !String(response.email?.messageId || "").trim()
    || !/^cs_[A-Za-z0-9_]+$/.test(String(response.stripeSessionId || "").trim())
    || !Number.isSafeInteger(Number(response.checkoutGeneration))
    || typeof response.published !== "boolean"
    || Object.prototype.hasOwnProperty.call(response, "paymentLink")
    || Object.prototype.hasOwnProperty.call(response, "url")
  ) {
    throw new Error("Final-balance request returned an invalid authoritative response.");
  }
  return response;
}
