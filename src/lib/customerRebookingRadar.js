export const CUSTOMER_REBOOKING_RADAR_DEFAULT_LIMIT = 12;
export const CUSTOMER_REBOOKING_RADAR_MAX_LIMIT = 25;
export const POST_EVENT_CLOSEOUT_START_DAYS = 7;
export const POST_EVENT_CLOSEOUT_WINDOW_DAYS = 7;

export const CUSTOMER_REBOOKING_RADAR_EVIDENCE_COPY = Object.freeze({
  opportunity:
    "This suggestion is read-only. It does not create a lead, booking, delivery, payment, or revenue record.",
  closeout:
    "No thank-you or review request was sent. Consent, suppression, idempotency, tenant calendar policy, and provider evidence remain required before outbound contact.",
  rebook:
    "A rebook review identifies only the exact accepted immutable source version. Trusted duplication and current server-authoritative repricing remain required before a new draft or customer decision cycle."
});

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REBOOK_REQUEST_ID_PATTERN = /^rebook_[a-f0-9]{48}$/;
const CALENDAR_SOURCES = new Set(["tenant", "device"]);
const REBOOK_QUOTE_STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "booked"
]);
const REBOOK_REVIEW_STATES = new Set([
  "draft_created_for_staff_review",
  "staff_review_completed"
]);
const CLOSEOUT_REVIEW_ITEMS = Object.freeze([
  Object.freeze({ code: "internal_closeout", label: "Review the internal event closeout" }),
  Object.freeze({ code: "thank_you", label: "Review a branded thank-you message" }),
  Object.freeze({ code: "review_request", label: "Review a customer-feedback request" }),
  Object.freeze({ code: "operational_follow_up", label: "Review unresolved operational follow-up" })
]);
const ACTUAL_ATTENDANCE_SOURCE_TYPES = new Set([
  "staff_observed",
  "customer_reported",
  "venue_reported",
  "imported_record"
]);

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeOpaqueId(value) {
  const id = text(value);
  if (
    !id
    || id.length > 256
    || /[\s/?#\\\u0000]/u.test(id)
    || id === "."
    || id === ".."
    || /^[^@\s]+@[^@\s]+$/.test(id)
  ) {
    return "";
  }
  return id;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function parseDateOnly(value) {
  const raw = text(value);
  if (!DATE_ONLY_PATTERN.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatDateOnly(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function addCalendarDays(value, days) {
  const date = parseDateOnly(value);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

function addCalendarYear(value) {
  const date = parseDateOnly(value);
  if (!date) return "";
  const targetYear = date.getUTCFullYear() + 1;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  return formatDateOnly(new Date(Date.UTC(targetYear, month, Math.min(day, lastDay))));
}

function daysBetween(earlier, later) {
  const earlierDate = parseDateOnly(earlier);
  const laterDate = parseDateOnly(later);
  if (!earlierDate || !laterDate) return null;
  return Math.round((laterDate.getTime() - earlierDate.getTime()) / DAY_MS);
}

function calendarWeekBounds(value) {
  const date = parseDateOnly(value);
  if (!date) return null;
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const startDate = addCalendarDays(value, -mondayOffset);
  return {
    startDate,
    endDate: addCalendarDays(startDate, 6)
  };
}

function validTimeZone(value) {
  const timeZone = text(value);
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function normalizeCalendarContext(calendarContext) {
  if (!isRecord(calendarContext)) {
    throw new TypeError("calendarContext is required for rebooking radar evaluation.");
  }
  const date = text(calendarContext.date);
  const source = text(calendarContext.source).toLowerCase();
  const timeZone = text(calendarContext.timeZone);
  const requestedInstantISO = text(calendarContext.instantISO);
  if (!parseDateOnly(date)) {
    throw new TypeError("calendarContext.date must be a valid YYYY-MM-DD calendar date.");
  }
  if (!CALENDAR_SOURCES.has(source)) {
    throw new TypeError("calendarContext.source must be tenant or device.");
  }
  if (!validTimeZone(timeZone)) {
    throw new TypeError("calendarContext.timeZone must be a valid IANA time zone.");
  }
  const instant = requestedInstantISO
    ? new Date(requestedInstantISO)
    : new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError("calendarContext.instantISO must be a valid ISO timestamp when supplied.");
  }
  return {
    date,
    source,
    timeZone,
    instantISO: instant.toISOString(),
    label: source === "tenant" ? "Tenant-local calendar date" : "Device-local calendar date"
  };
}

function calendarDateForTimeZone(instantISO, timeZone) {
  if (!validTimeZone(timeZone)) return "";
  const instant = new Date(instantISO);
  if (Number.isNaN(instant.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return parseDateOnly(date) ? date : "";
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === "") {
    return CUSTOMER_REBOOKING_RADAR_DEFAULT_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return CUSTOMER_REBOOKING_RADAR_DEFAULT_LIMIT;
  return Math.min(CUSTOMER_REBOOKING_RADAR_MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

function validISO(value) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function calendarDateAtISO(value, timeZone) {
  const instant = validISO(value);
  const zone = text(timeZone);
  if (!instant || !validTimeZone(zone)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return parseDateOnly(date) ? date : "";
}

function versionId(version) {
  return safeOpaqueId(version?.versionId || version?.id || version?.revisionId);
}

function versionHistoryTruncated(workspace, quoteId) {
  return (Array.isArray(workspace?.versionPageInfo?.truncatedQuoteIds)
    ? workspace.versionPageInfo.truncatedQuoteIds
    : []).some((id) => safeOpaqueId(id) === quoteId);
}

function unavailableRebookAction(quoteId, reason, sourceEvidence = {}) {
  return {
    kind: "review_rebook_draft",
    state: "unavailable",
    label: "Review rebook from accepted proposal",
    sourceQuoteId: quoteId,
    ...sourceEvidence,
    reason,
    performed: false
  };
}

function validCompletedReviewEvidence(rebooking, quote, sourceEventDate) {
  if (text(rebooking?.state) !== "staff_review_completed") return true;
  const reviewedBy = isRecord(rebooking?.reviewedBy) ? rebooking.reviewedBy : {};
  const reviewCalendar = isRecord(rebooking?.reviewCalendar) ? rebooking.reviewCalendar : {};
  const reviewedAtISO = validISO(rebooking?.reviewedAtISO);
  const reviewedEventDate = text(rebooking?.reviewedEventDate);
  const reviewCalendarDate = text(reviewCalendar.date);
  const reviewTimeZone = text(reviewCalendar.timeZone);
  return Boolean(
    parseDateOnly(reviewedEventDate)
    && reviewedEventDate === text(quote?.event?.date)
    && reviewedEventDate > sourceEventDate
    && reviewedAtISO
    && parseDateOnly(reviewCalendarDate)
    && validTimeZone(reviewTimeZone)
    && calendarDateAtISO(reviewedAtISO, reviewTimeZone) === reviewCalendarDate
    && reviewedEventDate >= reviewCalendarDate
    && safeOpaqueId(reviewedBy.uid)
    && text(reviewedBy.email)
    && ["admin", "sales"].includes(text(reviewedBy.role).toLowerCase())
  );
}

function sameScopeRebookDescendantClaim(quote, {
  organizationId,
  customerId,
  sourceQuoteId
}) {
  const quoteId = safeOpaqueId(quote?.id || quote?.quoteId);
  const rebooking = isRecord(quote?.rebooking) ? quote.rebooking : null;
  return Boolean(
    quoteId !== sourceQuoteId
    && rebooking
    && safeOpaqueId(quote?.organizationId) === organizationId
    && safeOpaqueId(quote?.customerId) === customerId
    && (
      safeOpaqueId(quote?.duplicatedFromQuoteId) === sourceQuoteId
      || safeOpaqueId(rebooking.sourceQuoteId) === sourceQuoteId
    )
  );
}

function exactRebookDescendant(quote, {
  organizationId,
  customerId,
  sourceQuoteId,
  sourceVersionId,
  sourceEventDate,
  acceptanceReceiptId,
  acceptedAtISO
}) {
  const quoteId = safeOpaqueId(quote?.id || quote?.quoteId);
  const rebooking = isRecord(quote?.rebooking) ? quote.rebooking : null;
  const reviewState = text(rebooking?.state);
  const sourceAcceptedAtISO = validISO(rebooking?.sourceAcceptedAtISO);
  const draftCreatedAtISO = validISO(rebooking?.draftCreatedAtISO);
  const status = text(quote?.status).toLowerCase();
  const eventDate = text(quote?.event?.date);
  const rebookingRequestId = text(rebooking?.rebookingRequestId).toLowerCase();

  if (
    !quoteId
    || quoteId === sourceQuoteId
    || !rebooking
    || Number(rebooking.schemaVersion) !== 1
    || safeOpaqueId(quote?.organizationId) !== organizationId
    || safeOpaqueId(quote?.customerId) !== customerId
    || safeOpaqueId(quote?.duplicatedFromQuoteId) !== sourceQuoteId
    || text(quote?.pricing?.authority) !== "server_authoritative"
    || !REBOOK_QUOTE_STATUSES.has(status)
    || safeOpaqueId(rebooking.sourceOrganizationId) !== organizationId
    || safeOpaqueId(rebooking.sourceCustomerId) !== customerId
    || safeOpaqueId(rebooking.sourceQuoteId) !== sourceQuoteId
    || safeOpaqueId(rebooking.sourceVersionId) !== sourceVersionId
    || safeOpaqueId(rebooking.acceptanceReceiptId) !== acceptanceReceiptId
    || text(rebooking.sourceEventDate) !== sourceEventDate
    || sourceAcceptedAtISO !== acceptedAtISO
    || !draftCreatedAtISO
    || !REBOOK_REQUEST_ID_PATTERN.test(rebookingRequestId)
    || !REBOOK_REVIEW_STATES.has(reviewState)
    || !parseDateOnly(eventDate)
    || (
      reviewState === "draft_created_for_staff_review"
      && eventDate !== sourceEventDate
    )
    || !validCompletedReviewEvidence(rebooking, quote, sourceEventDate)
  ) {
    return null;
  }

  return {
    quoteId,
    quoteNumber: text(quote?.quoteNumber),
    status,
    reviewState,
    eventDate,
    rebookingRequestId
  };
}

function existingRebookAction({
  quoteId,
  sourceVersionId,
  acceptanceReceiptId,
  acceptedAtISO,
  descendant
}) {
  const openIntent = descendant.status === "draft"
    && descendant.reviewState === "draft_created_for_staff_review"
    ? "edit"
    : "view";
  return {
    kind: "review_rebook_draft",
    state: "existing_rebook",
    label: openIntent === "edit" ? "Open rebook draft for staff review" : "Open existing rebook",
    sourceQuoteId: quoteId,
    sourceVersionId,
    acceptanceReceiptId,
    acceptedAtISO,
    performed: true,
    existingQuoteId: descendant.quoteId,
    existingQuoteNumber: descendant.quoteNumber,
    existingQuoteStatus: descendant.status,
    existingReviewState: descendant.reviewState,
    existingEventDate: descendant.eventDate,
    rebookingRequestId: descendant.rebookingRequestId,
    openIntent
  };
}

function buildReviewedRebookAction({
  quote,
  quotes,
  versions,
  organizationId,
  customerId,
  historyTruncated,
  quoteReadTruncated
}) {
  const quoteId = safeOpaqueId(quote?.id || quote?.quoteId);
  const receipt = isRecord(quote?.acceptanceReceipt) ? quote.acceptanceReceipt : null;
  if (!receipt) return unavailableRebookAction(quoteId, "acceptance_receipt_missing");

  const receiptId = safeOpaqueId(receipt.receiptId);
  const acceptedAtISO = validISO(receipt.acceptedAtISO);
  const receiptRevisionId = text(receipt.quoteRevisionId);
  const receiptPortalIssuedAtISO = validISO(receipt.portalIssuedAtISO);
  if (!receiptId || !acceptedAtISO || !receiptRevisionId || !receiptPortalIssuedAtISO) {
    return unavailableRebookAction(quoteId, "acceptance_receipt_incomplete");
  }

  const acceptedVersionId = safeOpaqueId(quote?.activeVersionId || quote?.versionMeta?.versionId);
  if (!acceptedVersionId) {
    return unavailableRebookAction(quoteId, "accepted_version_identity_missing");
  }
  if (
    receiptRevisionId !== acceptedVersionId
    && (
      !receiptPortalIssuedAtISO
      || receiptRevisionId !== `${acceptedVersionId}@${receiptPortalIssuedAtISO}`
    )
  ) {
    return unavailableRebookAction(quoteId, "accepted_revision_mismatch");
  }

  const sourceEvidence = {
    sourceVersionId: acceptedVersionId,
    acceptanceReceiptId: receiptId,
    acceptedAtISO
  };
  const sourceEventDate = text(quote?.event?.date);
  const descendantClaims = quotes.filter((candidate) => sameScopeRebookDescendantClaim(
    candidate,
    {
      organizationId,
      customerId,
      sourceQuoteId: quoteId
    }
  ));
  const descendants = descendantClaims.map((candidate) => exactRebookDescendant(candidate, {
    organizationId,
    customerId,
    sourceQuoteId: quoteId,
    sourceVersionId: acceptedVersionId,
    sourceEventDate,
    acceptanceReceiptId: receiptId,
    acceptedAtISO
  })).filter(Boolean);
  if (descendantClaims.length > 1) {
    return unavailableRebookAction(
      quoteId,
      "existing_rebook_ambiguous",
      sourceEvidence
    );
  }
  if (descendants.length === 1) {
    return existingRebookAction({
      quoteId,
      ...sourceEvidence,
      descendant: descendants[0]
    });
  }
  if (descendantClaims.length === 1) {
    return unavailableRebookAction(
      quoteId,
      "existing_rebook_invalid",
      sourceEvidence
    );
  }
  if (quoteReadTruncated) {
    return unavailableRebookAction(
      quoteId,
      "existing_rebook_not_found_quote_history_truncated",
      sourceEvidence
    );
  }

  const matchingVersions = versions.filter((version) => versionId(version) === acceptedVersionId);
  if (!matchingVersions.length) {
    return unavailableRebookAction(
      quoteId,
      historyTruncated
        ? "accepted_source_version_not_loaded_history_truncated"
        : "accepted_source_version_not_loaded"
    );
  }
  if (matchingVersions.length > 1) {
    return unavailableRebookAction(quoteId, "accepted_source_version_ambiguous");
  }

  const acceptedVersion = matchingVersions[0];
  const snapshot = isRecord(acceptedVersion?.snapshot) ? acceptedVersion.snapshot : null;
  const expectedCustomerId = safeOpaqueId(quote?.customerId);
  if (
    acceptedVersion?.legacySynthetic === true
    || !snapshot
    || safeOpaqueId(acceptedVersion?.quoteId) !== quoteId
    || safeOpaqueId(acceptedVersion?.organizationId) !== organizationId
    || safeOpaqueId(snapshot.id) !== quoteId
    || safeOpaqueId(snapshot.organizationId) !== organizationId
    || safeOpaqueId(acceptedVersion?.customerId || snapshot.customerId) !== expectedCustomerId
    || (safeOpaqueId(snapshot.customerId) && safeOpaqueId(snapshot.customerId) !== expectedCustomerId)
    || !parseDateOnly(snapshot?.event?.date)
    || text(snapshot.event.date) !== text(quote?.event?.date)
  ) {
    return unavailableRebookAction(quoteId, "accepted_source_version_invalid");
  }

  return {
    kind: "review_rebook_draft",
    state: "ready_for_staff_review",
    label: "Review rebook from accepted proposal",
    sourceQuoteId: quoteId,
    sourceVersionId: acceptedVersionId,
    acceptanceReceiptId: receiptId,
    acceptedAtISO,
    performed: false,
    requiredExecution: {
      trustedDuplication: true,
      serverAuthoritativeRepricing: true,
      explicitStaffReview: true,
      newCustomerDecisionCycle: true
    }
  };
}

function eventName(quote, event) {
  return text(event?.eventName || quote?.event?.name || quote?.quoteNumber) || "Prior event";
}

function authoritativeCloseoutProjection(quote, { organizationId, customerId, quoteId, eventDate } = {}) {
  const closeout = isRecord(quote?.workflow?.postEventCloseout)
    ? quote.workflow.postEventCloseout
    : null;
  if (!closeout) return null;
  const closeoutId = safeOpaqueId(closeout.closeoutId);
  if (
    !closeoutId
    || safeOpaqueId(closeout.organizationId) !== organizationId
    || safeOpaqueId(closeout.customerId) !== customerId
    || safeOpaqueId(closeout.quoteId) !== quoteId
    || text(closeout.eventDate) !== eventDate
  ) return null;
  const reviewItems = isRecord(closeout.reviewItems) ? closeout.reviewItems : {};
  return {
    ...closeout,
    closeoutId,
    reviewItems: CLOSEOUT_REVIEW_ITEMS.map((definition) => {
      const stored = isRecord(reviewItems[definition.code]) ? reviewItems[definition.code] : {};
      return {
        ...definition,
        state: text(stored.state).toLowerCase() === "reviewed" ? "reviewed" : "pending",
        reviewedAtISO: text(stored.reviewedAtISO),
        reviewedBy: text(stored.reviewedBy?.email || stored.reviewedBy),
        lastActionReceiptId: safeOpaqueId(stored.lastActionReceiptId)
      };
    })
  };
}

function authoritativeActualAttendance(closeout) {
  const actual = isRecord(closeout?.actualAttendance)
    ? closeout.actualAttendance
    : null;
  const count = Number(actual?.count);
  const revision = Number(actual?.revision);
  const sourceType = text(actual?.sourceType).toLowerCase();
  const sourceReferenceId = safeOpaqueId(actual?.sourceReferenceId);
  const lastReceiptId = safeOpaqueId(actual?.lastReceiptId);
  const recordedAtISO = validISO(actual?.recordedAtISO);
  const note = text(actual?.note);
  if (
    Number(actual?.schemaVersion) !== 1
    || !Number.isSafeInteger(count)
    || count < 1
    || count > 400
    || !Number.isSafeInteger(revision)
    || revision < 1
    || !ACTUAL_ATTENDANCE_SOURCE_TYPES.has(sourceType)
    || !sourceReferenceId
    || !/^closeout_attendance_[a-f0-9]{48}$/u.test(sourceReferenceId)
    || sourceReferenceId !== lastReceiptId
    || !recordedAtISO
    || !note
    || note.length > 240
  ) return null;
  return {
    schemaVersion: 1,
    revision,
    count,
    sourceType,
    note,
    sourceReferenceId,
    recordedAtISO,
    recordedBy: isRecord(actual.recordedBy)
      ? {
          email: text(actual.recordedBy.email).toLowerCase(),
          role: text(actual.recordedBy.role).toLowerCase()
        }
      : null,
    lastReceiptId
  };
}

function authoritativeCloseoutCalendarDate(closeout, calendarContext) {
  const policyState = text(closeout?.policy?.state).toLowerCase();
  if (policyState !== "configured") return calendarContext.date;
  return calendarDateForTimeZone(
    calendarContext.instantISO,
    text(closeout?.policy?.timeZone)
  );
}

function closeoutDisplayState(closeout, calendarContext) {
  if (!closeout) return "read_only_cue";
  if (text(closeout?.policy?.state).toLowerCase() === "blocked_configuration") {
    return "blocked_configuration";
  }
  const calendarDate = authoritativeCloseoutCalendarDate(closeout, calendarContext);
  if (!calendarDate) return "blocked_configuration";
  if (text(closeout.state).toLowerCase() === "completed") return "completed";
  const dueDate = text(closeout.dueDate);
  if (!parseDateOnly(dueDate)) return "blocked_configuration";
  if (calendarDate < dueDate) return "scheduled";
  if (calendarDate === dueDate) return "due";
  return "overdue";
}

function buildCloseoutOpportunity({ quote, event, calendarContext, eventDate, quoteId }) {
  const eligibleFromDate = addCalendarDays(eventDate, POST_EVENT_CLOSEOUT_START_DAYS);
  const eligibleThroughDate = addCalendarDays(
    eligibleFromDate,
    POST_EVENT_CLOSEOUT_WINDOW_DAYS - 1
  );
  const closeout = authoritativeCloseoutProjection(quote, {
    organizationId: safeOpaqueId(quote.organizationId),
    customerId: safeOpaqueId(quote.customerId),
    quoteId,
    eventDate
  });
  const displayState = closeoutDisplayState(closeout, calendarContext);
  return {
    id: closeout?.closeoutId || `post_event_closeout:${quoteId}:${eventDate}`,
    type: "post_event_closeout",
    title: `${eventName(quote, event)} reached its one-week closeout window`,
    organizationId: safeOpaqueId(quote.organizationId),
    quoteId,
    quoteNumber: text(quote.quoteNumber),
    event: {
      name: eventName(quote, event),
      date: eventDate,
      venue: text(event?.venue || quote?.event?.venue)
    },
    timing: {
      calendarDate: calendarContext.date,
      daysSinceEvent: daysBetween(eventDate, calendarContext.date),
      eligibleFromDate,
      eligibleThroughDate
    },
    reviewItems: closeout?.reviewItems || CLOSEOUT_REVIEW_ITEMS.map((item) => ({
      ...item,
      state: "unavailable",
      reviewedAtISO: "",
      reviewedBy: "",
      lastActionReceiptId: ""
    })),
    reviewedAction: closeout ? {
      kind: "review_post_event_closeout",
      state: displayState,
      closeoutId: closeout.closeoutId,
      sourceVersionId: safeOpaqueId(closeout.sourceVersionId),
      acceptanceReceiptId: safeOpaqueId(closeout.acceptanceReceiptId),
      dueDate: text(closeout.dueDate),
      policy: isRecord(closeout.policy) ? { ...closeout.policy } : {},
      actualAttendance: authoritativeActualAttendance(closeout),
      completedAtISO: text(closeout.completedAtISO),
      completedBy: text(closeout.completedBy?.email || closeout.completedBy),
      performed: displayState === "completed"
    } : null,
    evidenceCopy: closeout
      ? "This server-owned closeout record captures internal review receipts only. It does not claim that a thank-you or review request was sent, accepted, delivered, opened, or acted on."
      : CUSTOMER_REBOOKING_RADAR_EVIDENCE_COPY.closeout
  };
}

function buildAnniversaryOpportunity({
  quote,
  event,
  calendarContext,
  eventDate,
  quoteId,
  reviewedAction
}) {
  return {
    id: `anniversary_rebooking:${quoteId}:${eventDate}`,
    type: "anniversary_rebooking",
    title: `${eventName(quote, event)} was scheduled for this week last year`,
    quoteId,
    quoteNumber: text(quote.quoteNumber),
    event: {
      name: eventName(quote, event),
      date: eventDate,
      venue: text(event?.venue || quote?.event?.venue)
    },
    timing: {
      calendarDate: calendarContext.date,
      anniversaryDate: addCalendarYear(eventDate)
    },
    reviewItems: [],
    reviewedAction,
    evidenceCopy: CUSTOMER_REBOOKING_RADAR_EVIDENCE_COPY.rebook
  };
}

function incrementReason(counts, reason) {
  counts[reason] = (counts[reason] || 0) + 1;
}

export function buildCustomerRebookingRadar(customerWorkspace = {}, {
  organizationId,
  calendarContext,
  limit
} = {}) {
  const orgId = safeOpaqueId(organizationId);
  if (!orgId) throw new TypeError("A valid organizationId is required for rebooking radar evaluation.");
  const calendar = normalizeCalendarContext(calendarContext);
  const week = calendarWeekBounds(calendar.date);
  const customerId = safeOpaqueId(
    customerWorkspace?.customer?.customerId || customerWorkspace?.customer?.id
  );
  if (!customerId) {
    throw new TypeError("A Customer 360 DTO with an opaque customerId is required.");
  }

  const resolvedLimit = normalizeLimit(limit);
  const quotes = Array.isArray(customerWorkspace?.quotes) ? customerWorkspace.quotes : [];
  const events = Array.isArray(customerWorkspace?.events) ? customerWorkspace.events : [];
  const versions = Array.isArray(customerWorkspace?.proposalVersions)
    ? customerWorkspace.proposalVersions
    : [];
  const eventsByQuote = new Map();
  events.forEach((event) => {
    const quoteId = safeOpaqueId(event?.quoteId);
    if (!quoteId) return;
    const current = eventsByQuote.get(quoteId) || [];
    current.push(event);
    eventsByQuote.set(quoteId, current);
  });

  const opportunities = [];
  const excludedReasonCounts = {};
  quotes.forEach((quote) => {
    const quoteId = safeOpaqueId(quote?.id || quote?.quoteId);
    if (!quoteId) {
      incrementReason(excludedReasonCounts, "quote_identity_invalid");
      return;
    }
    if (safeOpaqueId(quote?.customerId) !== customerId) {
      incrementReason(excludedReasonCounts, "customer_scope_mismatch");
      return;
    }
    if (safeOpaqueId(quote?.organizationId) !== orgId) {
      incrementReason(excludedReasonCounts, "organization_scope_mismatch");
      return;
    }
    if (text(quote?.status).toLowerCase() !== "booked") {
      incrementReason(excludedReasonCounts, "quote_not_booked");
      return;
    }

    const matchingEvents = eventsByQuote.get(quoteId) || [];
    if (matchingEvents.length !== 1) {
      incrementReason(
        excludedReasonCounts,
        matchingEvents.length ? "event_record_ambiguous" : "event_record_missing"
      );
      return;
    }
    const event = matchingEvents[0];
    if (text(event?.status).toLowerCase() !== "booked") {
      incrementReason(excludedReasonCounts, "event_not_booked");
      return;
    }
    const quoteEventDate = text(quote?.event?.date);
    const workspaceEventDate = text(event?.date);
    if (!parseDateOnly(quoteEventDate) || !parseDateOnly(workspaceEventDate)) {
      incrementReason(excludedReasonCounts, "event_date_invalid");
      return;
    }
    if (quoteEventDate !== workspaceEventDate) {
      incrementReason(excludedReasonCounts, "event_date_mismatch");
      return;
    }

    const authoritativeCloseout = authoritativeCloseoutProjection(quote, {
      organizationId: orgId,
      customerId,
      quoteId,
      eventDate: quoteEventDate
    });
    const closeoutCalendarDate = authoritativeCloseout
      ? authoritativeCloseoutCalendarDate(authoritativeCloseout, calendar) || calendar.date
      : calendar.date;
    const closeoutAgeDays = daysBetween(quoteEventDate, closeoutCalendarDate);
    const closeoutEligible = closeoutAgeDays >= POST_EVENT_CLOSEOUT_START_DAYS
      && closeoutAgeDays < POST_EVENT_CLOSEOUT_START_DAYS + POST_EVENT_CLOSEOUT_WINDOW_DAYS;
    const authoritativeCloseoutVisible = Boolean(
      authoritativeCloseout
      && closeoutAgeDays >= 0
      && (
        text(authoritativeCloseout.state).toLowerCase() !== "completed"
        || closeoutAgeDays < POST_EVENT_CLOSEOUT_START_DAYS + 30
      )
    );
    const anniversaryDate = addCalendarYear(quoteEventDate);
    const anniversaryEligible = anniversaryDate >= week.startDate && anniversaryDate <= week.endDate;
    if (closeoutEligible || authoritativeCloseoutVisible) {
      opportunities.push(buildCloseoutOpportunity({
        quote,
        event,
        calendarContext: calendar,
        eventDate: quoteEventDate,
        quoteId
      }));
    }
    if (anniversaryEligible) {
      const quoteVersions = versions.filter((version) => (
        safeOpaqueId(version?.quoteId) === quoteId
        && safeOpaqueId(version?.organizationId) === orgId
      ));
      opportunities.push(buildAnniversaryOpportunity({
        quote,
        event,
        calendarContext: calendar,
        eventDate: quoteEventDate,
        quoteId,
        reviewedAction: buildReviewedRebookAction({
          quote,
          quotes,
          versions: quoteVersions,
          organizationId: orgId,
          customerId,
          historyTruncated: versionHistoryTruncated(customerWorkspace, quoteId),
          quoteReadTruncated: customerWorkspace?.quotePageInfo?.truncated === true
        })
      }));
    }
    if (!closeoutEligible && !authoritativeCloseoutVisible && !anniversaryEligible) {
      incrementReason(excludedReasonCounts, "outside_opportunity_window");
    }
  });

  opportunities.sort((left, right) => (
    left.timing.calendarDate.localeCompare(right.timing.calendarDate)
    || left.type.localeCompare(right.type)
    || left.quoteId.localeCompare(right.quoteId)
    || left.id.localeCompare(right.id)
  ));
  const returned = opportunities.slice(0, resolvedLimit);
  const sourceTruncated = customerWorkspace?.quotePageInfo?.truncated === true
    || (Array.isArray(customerWorkspace?.versionPageInfo?.truncatedQuoteIds)
      && customerWorkspace.versionPageInfo.truncatedQuoteIds.length > 0);
  const pageInfo = {
    limit: resolvedLimit,
    returned: returned.length,
    candidateCount: opportunities.length,
    radarTruncated: opportunities.length > resolvedLimit,
    quoteReadTruncated: customerWorkspace?.quotePageInfo?.truncated === true,
    versionReadTruncated: Array.isArray(customerWorkspace?.versionPageInfo?.truncatedQuoteIds)
      && customerWorkspace.versionPageInfo.truncatedQuoteIds.length > 0
  };
  pageInfo.truncated = pageInfo.radarTruncated || sourceTruncated;

  return deepFreeze({
    status: pageInfo.truncated
      ? "partial"
      : returned.length
        ? "success"
        : "empty",
    source: text(customerWorkspace?.source).toLowerCase() || "unknown",
    customerId,
    organizationId: orgId,
    calendarContext: calendar,
    evidenceCopy: CUSTOMER_REBOOKING_RADAR_EVIDENCE_COPY,
    opportunities: returned,
    excludedReasonCounts: Object.fromEntries(
      Object.entries(excludedReasonCounts).sort(([left], [right]) => left.localeCompare(right))
    ),
    pageInfo
  });
}
