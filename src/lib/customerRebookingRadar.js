export const CUSTOMER_REBOOKING_RADAR_DEFAULT_LIMIT = 12;
export const CUSTOMER_REBOOKING_RADAR_MAX_LIMIT = 25;
export const POST_EVENT_CLOSEOUT_START_DAYS = 7;
export const POST_EVENT_CLOSEOUT_WINDOW_DAYS = 7;

export const CUSTOMER_REBOOKING_RADAR_EVIDENCE_COPY = Object.freeze({
  opportunity:
    "This is a read-only opportunity, not a lead, booking, delivery, payment, or revenue fact.",
  closeout:
    "No thank-you or review request was sent. Consent, suppression, idempotency, tenant calendar policy, and provider evidence remain required before outbound contact.",
  rebook:
    "A rebook review identifies only the exact accepted immutable source version. Trusted duplication and current server-authoritative repricing remain required before a new draft or customer decision cycle."
});

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_SOURCES = new Set(["tenant", "device"]);
const CLOSEOUT_REVIEW_ITEMS = Object.freeze([
  Object.freeze({ code: "internal_closeout", label: "Review the internal event closeout" }),
  Object.freeze({ code: "thank_you", label: "Review a tenant-branded thank-you opportunity" }),
  Object.freeze({ code: "review_request", label: "Review a consent- and suppression-gated review request" }),
  Object.freeze({ code: "operational_follow_up", label: "Review unresolved operational follow-up" })
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
  if (!parseDateOnly(date)) {
    throw new TypeError("calendarContext.date must be a valid YYYY-MM-DD calendar date.");
  }
  if (!CALENDAR_SOURCES.has(source)) {
    throw new TypeError("calendarContext.source must be tenant or device.");
  }
  if (!validTimeZone(timeZone)) {
    throw new TypeError("calendarContext.timeZone must be a valid IANA time zone.");
  }
  return {
    date,
    source,
    timeZone,
    label: source === "tenant" ? "Tenant-local calendar date" : "Device-local calendar date"
  };
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

function versionId(version) {
  return safeOpaqueId(version?.versionId || version?.id || version?.revisionId);
}

function versionHistoryTruncated(workspace, quoteId) {
  return (Array.isArray(workspace?.versionPageInfo?.truncatedQuoteIds)
    ? workspace.versionPageInfo.truncatedQuoteIds
    : []).some((id) => safeOpaqueId(id) === quoteId);
}

function unavailableRebookAction(quoteId, reason) {
  return {
    kind: "review_rebook_draft",
    state: "unavailable",
    label: "Review rebook from accepted proposal",
    sourceQuoteId: quoteId,
    reason,
    performed: false
  };
}

function buildReviewedRebookAction({ quote, versions, organizationId, historyTruncated }) {
  const quoteId = safeOpaqueId(quote?.id || quote?.quoteId);
  const receipt = isRecord(quote?.acceptanceReceipt) ? quote.acceptanceReceipt : null;
  if (!receipt) return unavailableRebookAction(quoteId, "acceptance_receipt_missing");

  const receiptId = safeOpaqueId(receipt.receiptId);
  const acceptedAtISO = validISO(receipt.acceptedAtISO);
  const receiptRevisionId = text(receipt.quoteRevisionId);
  if (!receiptId || !acceptedAtISO || !receiptRevisionId) {
    return unavailableRebookAction(quoteId, "acceptance_receipt_incomplete");
  }

  const acceptedVersionId = safeOpaqueId(quote?.activeVersionId || quote?.versionMeta?.versionId);
  if (!acceptedVersionId) {
    return unavailableRebookAction(quoteId, "accepted_version_identity_missing");
  }
  const receiptPortalIssuedAtISO = validISO(receipt.portalIssuedAtISO);
  if (
    receiptRevisionId !== acceptedVersionId
    && (
      !receiptPortalIssuedAtISO
      || receiptRevisionId !== `${acceptedVersionId}@${receiptPortalIssuedAtISO}`
    )
  ) {
    return unavailableRebookAction(quoteId, "accepted_revision_mismatch");
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
  if (
    acceptedVersion?.legacySynthetic === true
    || !snapshot
    || safeOpaqueId(acceptedVersion?.quoteId) !== quoteId
    || safeOpaqueId(acceptedVersion?.organizationId) !== organizationId
    || safeOpaqueId(snapshot.id) !== quoteId
    || safeOpaqueId(snapshot.organizationId) !== organizationId
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

function buildCloseoutOpportunity({ quote, event, calendarContext, eventDate, quoteId }) {
  const eligibleFromDate = addCalendarDays(eventDate, POST_EVENT_CLOSEOUT_START_DAYS);
  const eligibleThroughDate = addCalendarDays(
    eligibleFromDate,
    POST_EVENT_CLOSEOUT_WINDOW_DAYS - 1
  );
  return {
    id: `post_event_closeout:${quoteId}:${eventDate}`,
    type: "post_event_closeout",
    title: `${eventName(quote, event)} reached its one-week closeout window`,
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
    reviewItems: CLOSEOUT_REVIEW_ITEMS.map((item) => ({ ...item })),
    reviewedAction: null,
    evidenceCopy: CUSTOMER_REBOOKING_RADAR_EVIDENCE_COPY.closeout
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

    const closeoutAgeDays = daysBetween(quoteEventDate, calendar.date);
    const closeoutEligible = closeoutAgeDays >= POST_EVENT_CLOSEOUT_START_DAYS
      && closeoutAgeDays < POST_EVENT_CLOSEOUT_START_DAYS + POST_EVENT_CLOSEOUT_WINDOW_DAYS;
    const anniversaryDate = addCalendarYear(quoteEventDate);
    const anniversaryEligible = anniversaryDate >= week.startDate && anniversaryDate <= week.endDate;
    if (closeoutEligible) {
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
          versions: quoteVersions,
          organizationId: orgId,
          historyTruncated: versionHistoryTruncated(customerWorkspace, quoteId)
        })
      }));
    }
    if (!closeoutEligible && !anniversaryEligible) {
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
