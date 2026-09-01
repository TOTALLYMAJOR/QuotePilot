import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const QUOTE_CATALOG_REVIEW_STATES = Object.freeze([
  "current",
  "newer_catalog_no_selected_impact",
  "review_required",
  "legacy_unknown",
  "unavailable"
]);

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function createQuoteCatalogReviewRequestId(prefix = "quote_catalog_review") {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "")
    || `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `${text(prefix, 40)}_${random}`.slice(0, 128);
}

function requireScope(organizationId, quoteId) {
  const scope = { organizationId: text(organizationId, 160), quoteId: text(quoteId, 256) };
  if (!scope.organizationId || !scope.quoteId) throw new Error("Organization and quote are required for catalog revision review.");
  if (!firebaseReady || !cloudFunctions) throw new Error("Authoritative catalog revision review requires Firebase.");
  return scope;
}

function normalizeResult(response, operation) {
  const result = response?.data && typeof response.data === "object" ? response.data : {};
  if (result.ok !== true || !result.review || !QUOTE_CATALOG_REVIEW_STATES.includes(result.review.state)) {
    throw new Error(`${operation} returned an invalid response.`);
  }
  return result;
}

export async function getQuoteCatalogRevisionReview({ organizationId, quoteId } = {}) {
  const scope = requireScope(organizationId, quoteId);
  const call = httpsCallable(cloudFunctions, "getQuoteCatalogRevisionReview");
  return normalizeResult(await call(scope), "Quote catalog revision review");
}

export async function recordQuoteCatalogReviewOutcome({
  organizationId,
  quoteId,
  expectedQuoteVersionId,
  expectedCatalogRevision,
  outcome,
  requestId = createQuoteCatalogReviewRequestId()
} = {}) {
  const scope = requireScope(organizationId, quoteId);
  if (!["keep_quoted_values", "review_and_update"].includes(outcome)) {
    throw new Error("Choose Keep quoted values or Review and update.");
  }
  const call = httpsCallable(cloudFunctions, "recordQuoteCatalogReviewOutcome");
  const response = await call({
    ...scope,
    requestId: text(requestId, 128),
    expectedQuoteVersionId: text(expectedQuoteVersionId, 256),
    expectedCatalogRevision: Number(expectedCatalogRevision),
    outcome
  });
  const result = response?.data && typeof response.data === "object" ? response.data : {};
  if (result.ok !== true || !result.receipt?.receiptId) {
    throw new Error("Quote catalog review outcome returned an invalid response.");
  }
  return result;
}

export function quoteCatalogReviewCapabilityState({ loading = false, error = "", review = null, submitting = false, receipt = null } = {}) {
  if (submitting || loading) return "submitting";
  if (error) return "error";
  if (receipt?.receiptId) return "receipt";
  if (!review) return "recovery";
  if (review.state === "review_required" || review.state === "legacy_unknown") return "reconciliation";
  if (review.state === "unavailable") return "uncertain";
  return "ready";
}
