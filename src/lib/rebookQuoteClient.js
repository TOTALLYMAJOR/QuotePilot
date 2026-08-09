import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";
import { normalizeOrganizationId } from "./organizationService";

const OPAQUE_ID_PATTERN = /^[^\s/?#\\\u0000]{1,256}$/u;
const REQUEST_ID_PATTERN = /^rebook_[a-f0-9]{48}$/;
const DEFINITIVE_CODES = new Set([
  "aborted",
  "already-exists",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "unauthenticated"
]);

function text(value) {
  return String(value ?? "").trim();
}

function opaqueId(value, label) {
  const id = text(value);
  if (
    !OPAQUE_ID_PATTERN.test(id)
    || id === "."
    || id === ".."
    || /^[^@\s]+@[^@\s]+$/.test(id)
  ) {
    const error = new Error(`${label} is invalid.`);
    error.code = "invalid-argument";
    error.rebookDefinitive = true;
    throw error;
  }
  return id;
}

function isOpaqueId(value) {
  const id = text(value);
  return Boolean(
    OPAQUE_ID_PATTERN.test(id)
    && id !== "."
    && id !== ".."
    && !/^[^@\s]+@[^@\s]+$/.test(id)
  );
}

function validDateOnly(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? normalized
    : "";
}

function validISO(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(normalized)) return "";
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeTimeZone(value) {
  const requested = text(value);
  if (!requested) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: requested })
      .resolvedOptions()
      .timeZone;
  } catch {
    return "";
  }
}

function calendarDateAt(value, timeZone) {
  const instant = validISO(value);
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  if (!instant || !normalizedTimeZone) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: normalizedTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return validDateOnly(`${values.year}-${values.month}-${values.day}`);
}

export function getRebookDeliveryGate(quote = {}, {
  tenantTimeZone = "",
  nowISO = new Date().toISOString()
} = {}) {
  const rebooking = quote?.rebooking;
  if (!rebooking || typeof rebooking !== "object" || Array.isArray(rebooking)) {
    return Object.freeze({
      applies: false,
      ready: true,
      state: "not_applicable",
      message: "",
      deliveryReady: true,
      deliveryState: "not_applicable",
      deliveryMessage: ""
    });
  }

  const eventDate = validDateOnly(quote?.event?.date);
  const sourceEventDate = validDateOnly(rebooking.sourceEventDate);
  const reviewedEventDate = validDateOnly(rebooking.reviewedEventDate);
  const reviewedAtISO = validISO(rebooking.reviewedAtISO);
  const reviewedBy = rebooking.reviewedBy && typeof rebooking.reviewedBy === "object"
    ? rebooking.reviewedBy
    : {};
  const reviewCalendar = rebooking.reviewCalendar
    && typeof rebooking.reviewCalendar === "object"
    && !Array.isArray(rebooking.reviewCalendar)
    ? rebooking.reviewCalendar
    : {};
  const reviewTimeZone = normalizeTimeZone(reviewCalendar.timeZone);
  const reviewCalendarDate = validDateOnly(reviewCalendar.date);
  const currentTimeZone = normalizeTimeZone(tenantTimeZone);
  const currentCalendarDate = calendarDateAt(nowISO, currentTimeZone);
  const exactScopePresent = Number(rebooking.schemaVersion) === 1
    && isOpaqueId(rebooking.sourceOrganizationId)
    && isOpaqueId(rebooking.sourceQuoteId)
    && isOpaqueId(rebooking.sourceVersionId)
    && isOpaqueId(rebooking.sourceCustomerId)
    && isOpaqueId(rebooking.acceptanceReceiptId)
    && REQUEST_ID_PATTERN.test(text(rebooking.rebookingRequestId).toLowerCase())
    && Boolean(validISO(rebooking.sourceAcceptedAtISO))
    && Boolean(validISO(rebooking.draftCreatedAtISO))
    && sourceEventDate
    && text(rebooking.sourceOrganizationId) === text(quote.organizationId)
    && text(rebooking.sourceCustomerId) === text(quote.customerId);
  const reviewEvidencePresent = text(rebooking.state) === "staff_review_completed"
    && eventDate
    && reviewedEventDate === eventDate
    && reviewedEventDate > sourceEventDate
    && reviewedAtISO
    && reviewTimeZone
    && reviewCalendarDate
    && calendarDateAt(reviewedAtISO, reviewTimeZone) === reviewCalendarDate
    && isOpaqueId(reviewedBy.uid)
    && Boolean(text(reviewedBy.email))
    && ["admin", "sales"].includes(text(reviewedBy.role).toLowerCase());

  if (exactScopePresent && reviewEvidencePresent) {
    const deliveryReady = Boolean(
      currentTimeZone
      && currentCalendarDate
      && eventDate >= currentCalendarDate
    );
    const deliveryState = !currentTimeZone || !currentCalendarDate
      ? "calendar_authority_required"
      : deliveryReady ? "ready" : "event_date_elapsed";
    const deliveryMessage = deliveryState === "calendar_authority_required"
      ? "Set a valid Business time zone in Catalog Administration before starting a new delivery."
      : deliveryState === "event_date_elapsed"
        ? `A new delivery is blocked because the event date is earlier than today in ${currentTimeZone}. The recorded review and historical artifacts remain available.`
        : "The reviewed rebook is eligible for a new delivery attempt.";
    return Object.freeze({
      applies: true,
      ready: true,
      state: "staff_review_completed",
      message: `Rebook review completed for ${eventDate}.`,
      deliveryReady,
      deliveryState,
      deliveryMessage
    });
  }

  const pending = text(rebooking.state) === "draft_created_for_staff_review";
  const calendarAuthorityMissing = !currentTimeZone || !currentCalendarDate;
  return Object.freeze({
    applies: true,
    ready: false,
    state: calendarAuthorityMissing
      ? "calendar_authority_required"
      : pending ? "review_required" : "invalid_evidence",
    message: calendarAuthorityMissing
      ? "Set a valid Business time zone in Catalog Administration before reviewing or delivering this rebook draft."
      : pending
        ? "Open edit, choose a current-or-future event date later than the accepted source event, review the copied scope, and save before delivery."
      : "Rebook review evidence is incomplete or no longer matches this quote. Open edit and save a reviewed future event before delivery.",
    deliveryReady: false,
    deliveryState: calendarAuthorityMissing
      ? "calendar_authority_required"
      : pending ? "review_required" : "invalid_evidence",
    deliveryMessage: calendarAuthorityMissing
      ? "Set a valid Business time zone in Catalog Administration before starting a new delivery."
      : pending
        ? "Complete staff review before starting a new delivery."
        : "Valid staff review evidence is required before starting a new delivery."
  });
}

export function normalizeReviewedRebookAction(action = {}, {
  organizationId
} = {}) {
  const orgId = normalizeOrganizationId(organizationId);
  if (!orgId || orgId !== text(organizationId).toLowerCase()) {
    const error = new Error("An exact active organization scope is required.");
    error.code = "invalid-argument";
    error.rebookDefinitive = true;
    throw error;
  }
  if (text(action.kind) !== "review_rebook_draft" || text(action.state) !== "ready_for_staff_review") {
    const error = new Error("This rebook opportunity is not ready for trusted draft creation.");
    error.code = "failed-precondition";
    error.rebookDefinitive = true;
    throw error;
  }
  return Object.freeze({
    organizationId: orgId,
    sourceQuoteId: opaqueId(action.sourceQuoteId, "sourceQuoteId"),
    sourceVersionId: opaqueId(action.sourceVersionId, "sourceVersionId"),
    acceptanceReceiptId: opaqueId(action.acceptanceReceiptId, "acceptanceReceiptId")
  });
}

function normalizeErrorCode(error) {
  const code = text(error?.code).toLowerCase();
  return code.includes("/") ? code.slice(code.lastIndexOf("/") + 1) : code;
}

export function isDefinitiveRebookQuoteDraftError(error) {
  return error?.rebookDefinitive === true || DEFINITIVE_CODES.has(normalizeErrorCode(error));
}

export async function createRebookQuoteDraft({
  organizationId,
  reviewedAction
} = {}) {
  const payload = normalizeReviewedRebookAction(reviewedAction, {
    organizationId
  });
  if (!firebaseReady || !cloudFunctions) {
    const error = new Error(
      "Trusted exact-version rebooking requires an authenticated Firebase workspace. No local draft was created."
    );
    error.code = "failed-precondition";
    error.rebookDefinitive = true;
    throw error;
  }

  const call = httpsCallable(cloudFunctions, "createRebookQuoteDraft");
  const response = await call(payload);
  const result = response?.data && typeof response.data === "object" ? response.data : {};
  const resultRebooking = result.rebooking && typeof result.rebooking === "object"
    ? result.rebooking
    : {};
  if (
    result.ok !== true
    || result.storage !== "firebase"
    || normalizeOrganizationId(result.organizationId) !== payload.organizationId
    || !isOpaqueId(result.id)
    || !text(result.quoteNumber)
    || !text(result.activeVersionId)
    || !isOpaqueId(result.customerId)
    || text(resultRebooking.sourceQuoteId) !== payload.sourceQuoteId
    || text(resultRebooking.sourceVersionId) !== payload.sourceVersionId
    || !/^\d{4}-\d{2}-\d{2}$/.test(text(resultRebooking.sourceEventDate))
    || text(resultRebooking.acceptanceReceiptId) !== payload.acceptanceReceiptId
    || !REQUEST_ID_PATTERN.test(text(resultRebooking.rebookingRequestId).toLowerCase())
    || !["draft_created_for_staff_review", "staff_review_completed"].includes(
      text(resultRebooking.state)
    )
  ) {
    const error = new Error(
      "Trusted rebook creation returned an incomplete receipt. Reconcile the same request before trying again."
    );
    error.code = "unknown";
    error.rebookDefinitive = false;
    throw error;
  }
  return Object.freeze({
    id: text(result.id),
    quoteNumber: text(result.quoteNumber),
    customerId: text(result.customerId),
    activeVersionId: text(result.activeVersionId),
    status: text(result.status).toLowerCase() || "draft",
    storage: "firebase",
    idempotent: result.idempotent === true,
    rebooking: Object.freeze({
      sourceQuoteId: payload.sourceQuoteId,
      sourceVersionId: payload.sourceVersionId,
      sourceEventDate: text(resultRebooking.sourceEventDate),
      acceptanceReceiptId: payload.acceptanceReceiptId,
      rebookingRequestId: text(resultRebooking.rebookingRequestId).toLowerCase(),
      state: text(resultRebooking.state)
    })
  });
}
