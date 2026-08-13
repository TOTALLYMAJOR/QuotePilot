"use strict";

const { createHash } = require("node:crypto");

const REBOOK_REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{19,159}$/;
const OPAQUE_ID_PATTERN = /^[^\s/?#\\\u0000]{1,256}$/u;

class RebookQuoteDraftError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RebookQuoteDraftError";
    this.code = code;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function opaqueId(value, label) {
  const normalized = text(value);
  if (
    !OPAQUE_ID_PATTERN.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/.test(normalized)
  ) {
    throw new RebookQuoteDraftError("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function validISO(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(normalized)) return "";
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function dateOnly(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return "";
  return normalized;
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

function calendarDateAtISO(value, timeZone) {
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
  return dateOnly(`${values.year}-${values.month}-${values.day}`);
}

function versionIdOf(version) {
  return text(version?.versionId || version?.id || version?.revisionId);
}

function acceptedRevisionMatches(receipt, sourceVersionId) {
  const receiptRevisionId = text(receipt?.quoteRevisionId);
  if (receiptRevisionId === sourceVersionId) return true;
  const portalIssuedAtISO = validISO(receipt?.portalIssuedAtISO);
  return Boolean(
    portalIssuedAtISO
    && receiptRevisionId === `${sourceVersionId}@${portalIssuedAtISO}`
  );
}

function buildRebookingRequestId(input = {}) {
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const sourceQuoteId = opaqueId(input.sourceQuoteId, "sourceQuoteId");
  const sourceVersionId = opaqueId(input.sourceVersionId, "sourceVersionId");
  const acceptanceReceiptId = opaqueId(
    input.acceptanceReceiptId,
    "acceptanceReceiptId"
  );
  const digest = createHash("sha256")
    .update([
      organizationId,
      sourceQuoteId,
      sourceVersionId,
      acceptanceReceiptId
    ].join("\u0000"))
    .digest("hex");
  return `rebook_${digest.slice(0, 48)}`;
}

function normalizeRebookQuoteDraftRequest(input = {}) {
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const sourceQuoteId = opaqueId(input.sourceQuoteId, "sourceQuoteId");
  const sourceVersionId = opaqueId(input.sourceVersionId, "sourceVersionId");
  const acceptanceReceiptId = opaqueId(
    input.acceptanceReceiptId,
    "acceptanceReceiptId"
  );
  const rebookingRequestId = buildRebookingRequestId({
    organizationId,
    sourceQuoteId,
    sourceVersionId,
    acceptanceReceiptId
  });
  const suppliedRequestId = text(input.rebookingRequestId).toLowerCase();
  if (suppliedRequestId && suppliedRequestId !== rebookingRequestId) {
    throw new RebookQuoteDraftError(
      "invalid-argument",
      "rebookingRequestId does not match the server-derived source identity."
    );
  }
  return Object.freeze({
    organizationId,
    sourceQuoteId,
    sourceVersionId,
    acceptanceReceiptId,
    rebookingRequestId
  });
}

function resolveAcceptedRebookSource({ request, sourceQuote, sourceVersion } = {}) {
  const normalized = normalizeRebookQuoteDraftRequest(request);
  const quote = isRecord(sourceQuote) ? sourceQuote : {};
  const version = isRecord(sourceVersion) ? sourceVersion : {};
  const snapshot = isRecord(version.snapshot) ? version.snapshot : null;
  const receipt = isRecord(quote.acceptanceReceipt) ? quote.acceptanceReceipt : null;

  if (text(quote.organizationId) !== normalized.organizationId) {
    throw new RebookQuoteDraftError("permission-denied", "The source quote is outside this organization.");
  }
  if (text(quote.status).toLowerCase() !== "booked") {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "Only a booked quote with retained acceptance evidence can seed a rebook draft."
    );
  }
  const customerId = opaqueId(quote.customerId, "source customerId");
  if (!receipt || text(receipt.receiptId) !== normalized.acceptanceReceiptId) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "The acceptance receipt no longer matches the reviewed rebook source."
    );
  }
  if (!validISO(receipt.acceptedAtISO) || !validISO(receipt.portalIssuedAtISO)) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "The acceptance receipt does not contain complete timestamp evidence."
    );
  }
  if (text(quote.activeVersionId || quote.versionMeta?.versionId) !== normalized.sourceVersionId) {
    throw new RebookQuoteDraftError(
      "aborted",
      "The accepted source version changed. Refresh the client overview before rebooking."
    );
  }
  if (!acceptedRevisionMatches(receipt, normalized.sourceVersionId)) {
    throw new RebookQuoteDraftError(
      "aborted",
      "The acceptance receipt is not bound to the reviewed proposal version."
    );
  }
  if (
    version.legacySynthetic === true
    || !snapshot
    || versionIdOf(version) !== normalized.sourceVersionId
    || text(version.quoteId) !== normalized.sourceQuoteId
    || text(version.organizationId) !== normalized.organizationId
    || text(snapshot.id) !== normalized.sourceQuoteId
    || text(snapshot.organizationId) !== normalized.organizationId
    || text(version.customerId || snapshot.customerId) !== customerId
    || (text(snapshot.customerId) && text(snapshot.customerId) !== customerId)
    || !dateOnly(snapshot.event?.date)
  ) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "The immutable accepted source version failed quote, customer, or organization scope checks."
    );
  }

  return Object.freeze({
    request: normalized,
    customerId,
    sourceEventDate: dateOnly(snapshot.event?.date),
    acceptedAtISO: validISO(receipt.acceptedAtISO),
    portalIssuedAtISO: validISO(receipt.portalIssuedAtISO),
    sourceSnapshot: snapshot
  });
}

function overlayCurrentCustomerContact({
  sourceForm,
  currentCustomer,
  organizationId,
  customerId
} = {}) {
  const form = isRecord(sourceForm) ? sourceForm : {};
  const customer = isRecord(currentCustomer) ? currentCustomer : {};
  const orgId = opaqueId(organizationId, "organizationId");
  const expectedCustomerId = opaqueId(customerId, "customerId");
  const storedCustomerId = opaqueId(
    customer.customerId || expectedCustomerId,
    "stored customerId"
  );
  const name = text(customer.name);
  const email = text(customer.emailKey || customer.email).toLowerCase();
  const storedOrganizationId = opaqueId(customer.organizationId, "customer organizationId");
  if (
    storedCustomerId !== expectedCustomerId
    || storedOrganizationId !== orgId
    || !name
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "The current stable customer contact is incomplete or outside the reviewed scope."
    );
  }
  return Object.freeze({
    ...form,
    name,
    email,
    phone: text(customer.phone),
    clientOrg: text(customer.company || customer.organization)
  });
}

function buildRebookDraftId(request = {}) {
  const normalized = normalizeRebookQuoteDraftRequest(request);
  const digest = createHash("sha256")
    .update([
      normalized.organizationId,
      normalized.sourceQuoteId,
      normalized.sourceVersionId,
      normalized.acceptanceReceiptId,
      normalized.rebookingRequestId
    ].join("\u0000"))
    .digest("hex");
  return `rebook_${digest.slice(0, 48)}`;
}

function buildRebookProvenance({
  request,
  customerId,
  sourceEventDate: requestedSourceEventDate,
  acceptedAtISO,
  createdAtISO
} = {}) {
  const normalized = normalizeRebookQuoteDraftRequest(request);
  const normalizedCustomerId = opaqueId(customerId, "source customerId");
  const sourceEventDate = dateOnly(requestedSourceEventDate);
  const normalizedAcceptedAtISO = validISO(acceptedAtISO);
  const normalizedCreatedAtISO = validISO(createdAtISO);
  if (!sourceEventDate || !normalizedAcceptedAtISO || !normalizedCreatedAtISO) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "Source event date plus accepted and draft creation timestamps are required for rebook provenance."
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    sourceOrganizationId: normalized.organizationId,
    sourceQuoteId: normalized.sourceQuoteId,
    sourceVersionId: normalized.sourceVersionId,
    sourceCustomerId: normalizedCustomerId,
    sourceEventDate,
    acceptanceReceiptId: normalized.acceptanceReceiptId,
    sourceAcceptedAtISO: normalizedAcceptedAtISO,
    rebookingRequestId: normalized.rebookingRequestId,
    draftCreatedAtISO: normalizedCreatedAtISO,
    state: "draft_created_for_staff_review"
  });
}

function normalizeStoredRebookingProvenance(value) {
  const provenance = isRecord(value) ? value : {};
  const request = normalizeRebookQuoteDraftRequest({
    organizationId: provenance.sourceOrganizationId,
    sourceQuoteId: provenance.sourceQuoteId,
    sourceVersionId: provenance.sourceVersionId,
    acceptanceReceiptId: provenance.acceptanceReceiptId,
    rebookingRequestId: provenance.rebookingRequestId
  });
  const sourceCustomerId = opaqueId(provenance.sourceCustomerId, "source customerId");
  const sourceEventDate = dateOnly(provenance.sourceEventDate);
  const sourceAcceptedAtISO = validISO(provenance.sourceAcceptedAtISO);
  const draftCreatedAtISO = validISO(provenance.draftCreatedAtISO);
  const state = text(provenance.state);
  if (
    Number(provenance.schemaVersion) !== 1
    || !sourceEventDate
    || !sourceAcceptedAtISO
    || !draftCreatedAtISO
    || !["draft_created_for_staff_review", "staff_review_completed"].includes(state)
  ) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "Stored rebook provenance is incomplete or invalid."
    );
  }
  const normalized = {
    schemaVersion: 1,
    sourceOrganizationId: request.organizationId,
    sourceQuoteId: request.sourceQuoteId,
    sourceVersionId: request.sourceVersionId,
    sourceCustomerId,
    sourceEventDate,
    acceptanceReceiptId: request.acceptanceReceiptId,
    sourceAcceptedAtISO,
    rebookingRequestId: request.rebookingRequestId,
    draftCreatedAtISO,
    state
  };
  if (state === "staff_review_completed") {
    const reviewedEventDate = dateOnly(provenance.reviewedEventDate);
    const reviewedAtISO = validISO(provenance.reviewedAtISO);
    const reviewedBy = isRecord(provenance.reviewedBy) ? provenance.reviewedBy : {};
    const reviewerUid = opaqueId(reviewedBy.uid, "reviewer uid");
    const reviewerEmail = text(reviewedBy.email).toLowerCase();
    const reviewerRole = text(reviewedBy.role).toLowerCase();
    const reviewCalendar = isRecord(provenance.reviewCalendar)
      ? provenance.reviewCalendar
      : {};
    const reviewTimeZone = normalizeTimeZone(reviewCalendar.timeZone);
    const reviewCalendarDate = dateOnly(reviewCalendar.date);
    if (
      !reviewedEventDate
      || reviewedEventDate <= sourceEventDate
      || !reviewedAtISO
      || !reviewerEmail
      || !["admin", "sales"].includes(reviewerRole)
      || !reviewTimeZone
      || !reviewCalendarDate
      || calendarDateAtISO(reviewedAtISO, reviewTimeZone) !== reviewCalendarDate
    ) {
      throw new RebookQuoteDraftError(
        "failed-precondition",
        "Stored rebook review evidence is incomplete or conflicts with the accepted source event."
      );
    }
    normalized.reviewedEventDate = reviewedEventDate;
    normalized.reviewedAtISO = reviewedAtISO;
    normalized.reviewedBy = {
      uid: reviewerUid,
      email: reviewerEmail,
      role: reviewerRole
    };
    normalized.reviewCalendar = {
      date: reviewCalendarDate,
      timeZone: reviewTimeZone
    };
  }
  return normalized;
}

function completeRebookStaffReview({
  rebooking,
  eventDate,
  reviewedAtISO,
  reviewedBy,
  tenantTimeZone
} = {}) {
  const provenance = normalizeStoredRebookingProvenance(rebooking);
  if (![
    "draft_created_for_staff_review",
    "staff_review_completed"
  ].includes(text(provenance.state))) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "This rebook draft is not awaiting its required staff review."
    );
  }
  const sourceEventDate = dateOnly(provenance.sourceEventDate);
  const reviewedEventDate = dateOnly(eventDate);
  const reviewTimestamp = validISO(reviewedAtISO);
  const reviewer = isRecord(reviewedBy) ? reviewedBy : {};
  const reviewerUid = opaqueId(reviewer.uid, "reviewer uid");
  const reviewerEmail = text(reviewer.email).toLowerCase();
  const reviewerRole = text(reviewer.role).toLowerCase();
  const reviewTimeZone = normalizeTimeZone(tenantTimeZone);
  const reviewCalendarDate = calendarDateAtISO(reviewTimestamp, reviewTimeZone);
  if (
    !sourceEventDate
    || !reviewedEventDate
    || !reviewTimestamp
    || !reviewerEmail
    || !["admin", "sales"].includes(reviewerRole)
    || !reviewTimeZone
    || !reviewCalendarDate
  ) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "Rebook staff review evidence is incomplete."
    );
  }
  if (reviewedEventDate <= sourceEventDate || reviewedEventDate < reviewCalendarDate) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "Choose a current-or-future event date later than the accepted source event before completing rebook review."
    );
  }
  return Object.freeze({
    ...provenance,
    state: "staff_review_completed",
    reviewedEventDate,
    reviewedAtISO: reviewTimestamp,
    reviewedBy: Object.freeze({
      uid: reviewerUid,
      email: reviewerEmail,
      role: reviewerRole
    }),
    reviewCalendar: Object.freeze({
      date: reviewCalendarDate,
      timeZone: reviewTimeZone
    })
  });
}

function assertRebookReviewComplete(quote = {}) {
  if (!isRecord(quote.rebooking)) return true;
  const rebooking = normalizeStoredRebookingProvenance(quote.rebooking);
  const eventDate = dateOnly(quote.event?.date);
  if (
    text(rebooking.state) !== "staff_review_completed"
    || !dateOnly(rebooking.sourceEventDate)
    || !eventDate
    || dateOnly(rebooking.reviewedEventDate) !== eventDate
    || !validISO(rebooking.reviewedAtISO)
  ) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "Complete the required rebook review before using customer or operational artifacts."
    );
  }
  return true;
}

function assertRebookCurrentEventDate(quote = {}, {
  nowISO = "",
  tenantTimeZone = ""
} = {}) {
  if (!isRecord(quote.rebooking)) return true;
  assertRebookReviewComplete(quote);
  const eventDate = dateOnly(quote.event?.date);
  const currentTimeZone = normalizeTimeZone(tenantTimeZone);
  const currentCalendarDate = calendarDateAtISO(nowISO, currentTimeZone);
  if (
    !currentTimeZone
    || !currentCalendarDate
    || eventDate < currentCalendarDate
  ) {
    throw new RebookQuoteDraftError(
      "failed-precondition",
      "A new delivery requires a valid tenant time zone and a current-or-future event date."
    );
  }
  return true;
}

function assertRebookReadyForDelivery(quote = {}, options = {}) {
  assertRebookReviewComplete(quote);
  assertRebookCurrentEventDate(quote, options);
  return true;
}

function matchesRebookDraft(quote = {}, { request, expectedDraftId } = {}) {
  const normalized = normalizeRebookQuoteDraftRequest(request);
  const draftId = opaqueId(expectedDraftId, "expected draft id");
  let provenance;
  try {
    provenance = normalizeStoredRebookingProvenance(quote.rebooking);
  } catch {
    return false;
  }
  const status = text(quote.status).toLowerCase();
  const provenanceState = text(provenance.state);
  return (
    text(quote.id) === draftId
    && text(quote.organizationId) === normalized.organizationId
    && ["draft", "sent", "viewed", "accepted", "declined", "expired", "booked"].includes(status)
    && text(quote.duplicatedFromQuoteId) === normalized.sourceQuoteId
    && text(provenance.sourceQuoteId) === normalized.sourceQuoteId
    && text(provenance.sourceOrganizationId) === normalized.organizationId
    && text(provenance.sourceVersionId) === normalized.sourceVersionId
    && text(provenance.acceptanceReceiptId) === normalized.acceptanceReceiptId
    && text(provenance.rebookingRequestId).toLowerCase() === normalized.rebookingRequestId
    && ["draft_created_for_staff_review", "staff_review_completed"].includes(provenanceState)
    && text(quote.pricing?.authority) === "server_authoritative"
  );
}

module.exports = {
  REBOOK_REQUEST_ID_PATTERN,
  RebookQuoteDraftError,
  assertRebookCurrentEventDate,
  assertRebookReadyForDelivery,
  assertRebookReviewComplete,
  calendarDateAtISO,
  buildRebookDraftId,
  buildRebookProvenance,
  buildRebookingRequestId,
  completeRebookStaffReview,
  matchesRebookDraft,
  normalizeStoredRebookingProvenance,
  normalizeRebookQuoteDraftRequest,
  normalizeTimeZone,
  overlayCurrentCustomerContact,
  resolveAcceptedRebookSource
};
