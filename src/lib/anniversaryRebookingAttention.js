export const ANNIVERSARY_REBOOKING_ATTENTION_LIMIT = 25;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(value) {
  return String(value ?? "").trim();
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
  ) return null;
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

function calendarWeekBounds(value) {
  const date = parseDateOnly(value);
  if (!date) return null;
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const startDate = addCalendarDays(value, -mondayOffset);
  return { startDate, endDate: addCalendarDays(startDate, 6) };
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

function dateInTimeZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function deviceTimeZone() {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "";
  }
}

export function resolveAnniversaryAttentionCalendar({
  instant = new Date(),
  tenantTimeZone = ""
} = {}) {
  const parsed = instant instanceof Date ? new Date(instant.getTime()) : new Date(instant);
  const safeInstant = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  const requestedTenantTimeZone = text(tenantTimeZone);
  const normalizedTenantTimeZone = normalizeTimeZone(requestedTenantTimeZone);
  const fallbackTimeZone = deviceTimeZone() || "UTC";
  const timeZone = normalizedTenantTimeZone || fallbackTimeZone;
  const source = normalizedTenantTimeZone
    ? "tenant"
    : requestedTenantTimeZone
      ? "device_fallback_invalid_tenant"
      : fallbackTimeZone === "UTC"
        ? "utc_fallback"
        : "device";
  return Object.freeze({
    date: dateInTimeZone(safeInstant, timeZone),
    instantISO: safeInstant.toISOString(),
    timeZone,
    source,
    label: source === "tenant"
      ? "Tenant-local anniversary week"
      : source === "device"
        ? "Device-local anniversary week"
        : source === "device_fallback_invalid_tenant"
          ? "Device-local fallback because the tenant time zone is invalid"
          : "UTC fallback anniversary week"
  });
}

function safeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return ANNIVERSARY_REBOOKING_ATTENTION_LIMIT;
  return Math.min(
    ANNIVERSARY_REBOOKING_ATTENTION_LIMIT,
    Math.max(1, Math.floor(parsed))
  );
}

function validQuoteId(value) {
  const id = text(value);
  return id && id.length <= 256 && !/[\s/?#\\\u0000]/u.test(id) ? id : "";
}

function validCustomerId(value) {
  const id = validQuoteId(value);
  return id && !/^[^@\s]+@[^@\s]+$/.test(id) ? id : "";
}

function customerLabel(quote) {
  return text(quote?.customer?.name || quote?.customer?.email) || "Customer";
}

function eventLabel(quote) {
  return text(quote?.event?.name || quote?.event?.eventName || quote?.quoteNumber)
    || "Prior event";
}

export function buildAnniversaryRebookingAttention(quotes = [], {
  calendarContext = resolveAnniversaryAttentionCalendar(),
  sourceTruncated = false,
  sourceLimit = 0,
  limit = ANNIVERSARY_REBOOKING_ATTENTION_LIMIT
} = {}) {
  const todayISO = text(calendarContext?.date);
  const week = calendarWeekBounds(todayISO);
  if (!week) {
    throw new TypeError("A valid anniversary calendar date is required.");
  }
  const resolvedLimit = safeLimit(limit);
  const excludedReasonCounts = {};
  const exclude = (reason) => {
    excludedReasonCounts[reason] = (excludedReasonCounts[reason] || 0) + 1;
  };
  const candidates = [];
  const seenQuoteIds = new Set();

  (Array.isArray(quotes) ? quotes : []).forEach((quote) => {
    const quoteId = validQuoteId(quote?.id || quote?.quoteId);
    if (!quoteId || seenQuoteIds.has(quoteId)) {
      exclude(quoteId ? "duplicate_quote_identity" : "quote_identity_invalid");
      return;
    }
    seenQuoteIds.add(quoteId);
    if (text(quote?.status).toLowerCase() !== "booked") {
      exclude("quote_not_booked");
      return;
    }
    const customerId = validCustomerId(quote?.customerId);
    if (!customerId) {
      exclude("stable_customer_missing");
      return;
    }
    const sourceEventDate = text(quote?.event?.date);
    if (!parseDateOnly(sourceEventDate)) {
      exclude("event_date_invalid");
      return;
    }
    const anniversaryDate = addCalendarYear(sourceEventDate);
    if (anniversaryDate < week.startDate || anniversaryDate > week.endDate) {
      exclude("outside_anniversary_week");
      return;
    }
    const itemId = `anniversary-rebooking:${quoteId}:${sourceEventDate}`;
    candidates.push({
      id: itemId,
      type: "anniversary_rebooking",
      state: "verification_required",
      priority: 8,
      dateISO: anniversaryDate,
      quote,
      quoteId,
      customerId,
      sourceRequestId: itemId,
      sourceQuoteId: quoteId,
      sourceEventDate,
      anniversaryDate,
      eventName: eventLabel(quote),
      customerLabel: customerLabel(quote),
      calendarContext: {
        date: todayISO,
        timeZone: text(calendarContext?.timeZone),
        source: text(calendarContext?.source),
        label: text(calendarContext?.label)
      },
      sourceBound: {
        quoteLimit: Number.isSafeInteger(Number(sourceLimit)) && Number(sourceLimit) > 0
          ? Math.floor(Number(sourceLimit))
          : null,
        truncated: sourceTruncated === true
      },
      routeIntent: "verify_exact_version_in_customer_360",
      evidenceBoundary:
        "This bounded booked-quote cue is not a lead, customer contact, accepted source verification, rebook draft, booking, payment, or revenue result. Customer 360 must verify the retained accepted immutable version before the trusted rebook action is available."
    });
  });

  candidates.sort((left, right) => (
    left.anniversaryDate.localeCompare(right.anniversaryDate)
    || left.customerLabel.localeCompare(right.customerLabel)
    || left.quoteId.localeCompare(right.quoteId)
  ));
  const items = candidates.slice(0, resolvedLimit);
  return Object.freeze({
    calendarContext: Object.freeze({ ...calendarContext }),
    items: Object.freeze(items.map((item) => Object.freeze(item))),
    excludedReasonCounts: Object.freeze(
      Object.fromEntries(Object.entries(excludedReasonCounts).sort(([left], [right]) => left.localeCompare(right)))
    ),
    bounds: Object.freeze({
      limit: resolvedLimit,
      candidateCount: candidates.length,
      returnedCount: items.length,
      quoteSourceLimit: Number.isSafeInteger(Number(sourceLimit)) && Number(sourceLimit) > 0
        ? Math.floor(Number(sourceLimit))
        : null,
      quoteSourceTruncated: sourceTruncated === true,
      attentionTruncated: candidates.length > resolvedLimit,
      complete: sourceTruncated !== true && candidates.length <= resolvedLimit
    })
  });
}

function numericCount(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function mergeAnniversaryRebookingAttention(attentionSummary = {}, options = {}) {
  const anniversary = buildAnniversaryRebookingAttention(options.quotes, options);
  const baseItems = Array.isArray(attentionSummary?.items) ? attentionSummary.items : [];
  const existingIds = new Set(baseItems.map((item) => text(item?.id)).filter(Boolean));
  const anniversaryItems = anniversary.items.filter((item) => !existingIds.has(item.id));
  const items = [...baseItems, ...anniversaryItems].sort((left, right) => (
    Number(left?.priority || 0) - Number(right?.priority || 0)
    || text(left?.dateISO).localeCompare(text(right?.dateISO))
    || text(left?.quote?.quoteNumber || left?.quoteId)
      .localeCompare(text(right?.quote?.quoteNumber || right?.quoteId))
    || text(left?.type).localeCompare(text(right?.type))
  ));
  return {
    ...attentionSummary,
    quoteCount: new Set(items.map((item) => text(item?.quoteId)).filter(Boolean)).size,
    itemCount: items.length,
    counts: {
      ...(attentionSummary?.counts || {}),
      anniversaryRebookings: numericCount(anniversaryItems.length)
    },
    items,
    anniversaryCalendarContext: anniversary.calendarContext,
    anniversaryBounds: anniversary.bounds,
    anniversaryExcludedReasonCounts: anniversary.excludedReasonCounts
  };
}
