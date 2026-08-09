export const CUSTOMER_COMMERCIAL_MEASURES_SCHEMA_VERSION = 1;

const WORKSPACE_SOURCE_LABELS = Object.freeze({
  firebase: "Firestore customer workspace",
  local: "Browser-local customer workspace",
  mixed: "Mixed customer workspace sources"
});

function text(value) {
  return String(value ?? "").trim();
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

function normalizeSource(value) {
  const source = text(value).toLowerCase();
  return Object.hasOwn(WORKSPACE_SOURCE_LABELS, source) ? source : "unknown";
}

function positiveIntegerOrZero(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizedEvidenceISO(value) {
  let candidate = value;
  if (typeof value?.toDate === "function") candidate = value.toDate();
  if (candidate instanceof Date) {
    return Number.isNaN(candidate.getTime()) ? "" : candidate.toISOString();
  }
  const raw = text(candidate);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizedCalendarDate(value) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10) === raw ? raw : "";
}

function majorAmountToCents(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function storedCents(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const cents = Number(value);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function sumCents(values) {
  let total = 0;
  for (const value of values) {
    const next = total + value;
    if (!Number.isSafeInteger(next) || next < 0) return null;
    total = next;
  }
  return total;
}

function measureStatus({ eligibleRecordCount, unknownAmountRecordCount, anomalyCount = 0, totalCents }) {
  if (eligibleRecordCount === 0 && anomalyCount === 0) return "empty";
  if (anomalyCount > 0 || unknownAmountRecordCount > 0 || totalCents === null) return "partial";
  return "success";
}

function amountMeasure({
  id,
  label,
  basis,
  records,
  centsForRecord,
  evidenceForRecord = () => true,
  stateMismatchRecordCount = 0
}) {
  const evidenceQualified = records.filter(evidenceForRecord);
  const knownCents = evidenceQualified.map(centsForRecord).filter((value) => value !== null);
  const totalCents = knownCents.length > 0 ? sumCents(knownCents) : null;
  const evidenceMissingRecordCount = records.length - evidenceQualified.length;
  const knownAmountRecordCount = totalCents === null ? 0 : knownCents.length;
  const unknownAmountRecordCount = records.length - knownAmountRecordCount;

  return {
    id,
    label,
    basis,
    status: measureStatus({
      eligibleRecordCount: records.length,
      unknownAmountRecordCount,
      anomalyCount: stateMismatchRecordCount,
      totalCents
    }),
    amount: totalCents === null ? null : totalCents / 100,
    amountCents: totalCents,
    currency: "USD",
    denominator: {
      eligibleRecordCount: records.length,
      evidenceQualifiedRecordCount: evidenceQualified.length,
      knownAmountRecordCount,
      unknownAmountRecordCount,
      evidenceMissingRecordCount,
      stateMismatchRecordCount
    }
  };
}

function quotedMeasure(quotes) {
  const records = quotes.filter((quote) => text(quote?.status).toLowerCase() !== "deleted");
  return amountMeasure({
    id: "quoted",
    label: "Quoted amount",
    basis: "all_displayed_non_deleted_quote_records",
    records,
    centsForRecord: (quote) => majorAmountToCents(quote?.totals?.total)
  });
}

function exactStateMeasure(quotes, status, label) {
  return amountMeasure({
    id: status,
    label,
    basis: `displayed_quote_records_in_exact_${status}_state`,
    records: quotes.filter((quote) => text(quote?.status).toLowerCase() === status),
    centsForRecord: (quote) => majorAmountToCents(quote?.totals?.total)
  });
}

function verifiedDepositMeasure(quotes, evidenceSourceTrusted = false) {
  const records = quotes.filter((quote) => (
    text(quote?.payment?.depositStatus).toLowerCase() === "paid"
  ));
  return amountMeasure({
    id: "webhook_confirmed_deposit",
    label: "Webhook-confirmed deposit amount",
    basis: "paid_deposit_state_with_provider_confirmation_timestamp",
    records,
    centsForRecord: (quote) => majorAmountToCents(quote?.totals?.deposit),
    evidenceForRecord: (quote) => evidenceSourceTrusted && Boolean(
      normalizedEvidenceISO(quote?.payment?.depositConfirmedAtISO)
    ),
    stateMismatchRecordCount: evidenceSourceTrusted
      ? quotes.filter((quote) => (
        !["paid", "refunded"].includes(text(quote?.payment?.depositStatus).toLowerCase())
        && Boolean(normalizedEvidenceISO(quote?.payment?.depositConfirmedAtISO))
      )).length
      : 0
  });
}

function verifiedFinalBalanceMeasure(quotes, evidenceSourceTrusted = false) {
  const records = quotes.filter((quote) => (
    text(quote?.payment?.finalBalance?.status).toLowerCase() === "paid"
  ));
  const measure = amountMeasure({
    id: "webhook_confirmed_final_balance",
    label: "Webhook-confirmed final-balance amount",
    basis: "paid_final_balance_state_with_provider_confirmation_timestamp",
    records,
    centsForRecord: (quote) => {
      const currency = text(quote?.payment?.finalBalance?.currency || "usd").toLowerCase();
      return currency === "usd" ? storedCents(quote?.payment?.finalBalance?.amountCents) : null;
    },
    evidenceForRecord: (quote) => evidenceSourceTrusted && Boolean(
      normalizedEvidenceISO(quote?.payment?.finalBalance?.confirmedAtISO)
    ),
    stateMismatchRecordCount: evidenceSourceTrusted
      ? quotes.filter((quote) => (
        text(quote?.payment?.finalBalance?.status).toLowerCase() !== "paid"
        && Boolean(normalizedEvidenceISO(quote?.payment?.finalBalance?.confirmedAtISO))
      )).length
      : 0
  });
  const currencyMismatchRecordCount = records.filter((quote) => {
    const currency = text(quote?.payment?.finalBalance?.currency || "usd").toLowerCase();
    return currency !== "usd";
  }).length;
  return {
    ...measure,
    denominator: {
      ...measure.denominator,
      currencyMismatchRecordCount
    }
  };
}

function repeatEventSignal(quotes) {
  const booked = quotes.filter((quote) => text(quote?.status).toLowerCase() === "booked");
  const dates = booked.map((quote) => normalizedCalendarDate(quote?.event?.date)).filter(Boolean);
  dates.sort();
  const unknownEventDateCount = booked.length - dates.length;
  const dateSpanDays = booked.length > 0 && unknownEventDateCount === 0
    ? Math.round((
      Date.parse(`${dates.at(-1)}T00:00:00.000Z`)
      - Date.parse(`${dates[0]}T00:00:00.000Z`)
    ) / 86_400_000)
    : null;

  return {
    status: unknownEventDateCount > 0
      ? "partial"
      : booked.length > 0
        ? "success"
        : "empty",
    basis: "displayed_quote_records_in_exact_booked_state",
    bookedEventCount: booked.length,
    knownEventDateCount: dates.length,
    unknownEventDateCount,
    repeatBookingCount: Math.max(0, booked.length - 1),
    hasRepeatBookingEvidence: booked.length >= 2,
    firstEventDate: dates[0] || null,
    lastEventDate: dates.at(-1) || null,
    dateSpanDays
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function buildCustomerCommercialMeasures(customerWorkspace = {}) {
  const source = normalizeSource(customerWorkspace?.source);
  const providerPaymentEvidenceTrusted = source === "firebase";
  const customerId = safeOpaqueId(
    customerWorkspace?.customer?.customerId || customerWorkspace?.customer?.id
  );
  if (!customerId) {
    throw new TypeError("A Customer 360 DTO with an opaque customerId is required.");
  }

  const inputQuotes = Array.isArray(customerWorkspace?.quotes) ? customerWorkspace.quotes : [];
  const quotes = inputQuotes.filter((quote) => (
    safeOpaqueId(quote?.id || quote?.quoteId)
    && text(quote?.customerId) === customerId
  ));
  const quoteReadTruncationKnown = typeof customerWorkspace?.quotePageInfo?.truncated === "boolean";
  const quoteReadTruncated = customerWorkspace?.quotePageInfo?.truncated === true;
  const completeQuoteRead = quoteReadTruncationKnown && !quoteReadTruncated;
  const measures = {
    quoted: quotedMeasure(quotes),
    accepted: exactStateMeasure(quotes, "accepted", "Accepted amount"),
    booked: exactStateMeasure(quotes, "booked", "Booked amount"),
    webhookConfirmedDeposit: verifiedDepositMeasure(quotes, providerPaymentEvidenceTrusted),
    webhookConfirmedFinalBalance: verifiedFinalBalanceMeasure(quotes, providerPaymentEvidenceTrusted)
  };
  const repeat = repeatEventSignal(quotes);
  const excludedQuoteCount = inputQuotes.length - quotes.length;
  const deletedQuoteCount = quotes.filter((quote) => (
    text(quote?.status).toLowerCase() === "deleted"
  )).length;
  const hasPartialEvidence = Object.values(measures).some((measure) => (
    measure.status === "partial"
  )) || repeat.status === "partial";
  const eligibleCommercialRecordCount = measures.quoted.denominator.eligibleRecordCount;
  const status = (
    quoteReadTruncated
    || !quoteReadTruncationKnown
    || excludedQuoteCount > 0
    || source === "unknown"
    || hasPartialEvidence
  )
    ? "partial"
    : eligibleCommercialRecordCount > 0
      ? "success"
      : "empty";

  return deepFreeze({
    schemaVersion: CUSTOMER_COMMERCIAL_MEASURES_SCHEMA_VERSION,
    status,
    source,
    sourceLabel: WORKSPACE_SOURCE_LABELS[source] || "Customer workspace source not confirmed",
    customerId,
    scope: !completeQuoteRead
      ? {
        kind: "displayed_records",
        label: "Displayed-record commercial measures",
        complete: false
      }
      : {
        kind: "complete_customer_quote_read",
        label: "Lifetime commercial measures",
        complete: true
      },
    bounds: {
      inputQuoteCount: inputQuotes.length,
      displayedRecordCount: quotes.length,
      excludedQuoteCount,
      deletedQuoteCount,
      quoteReadLimit: positiveIntegerOrZero(customerWorkspace?.quotePageInfo?.limit),
      quoteReadTruncationKnown,
      quoteReadTruncated
    },
    evidenceBoundary: "Displayed customer quote records only. Accepted and booked use exact states. Provider-confirmed payment requires a Firebase-backed read, matching paid state, and valid provider timestamp; other sources fail closed. Not accounting revenue, cash reconciliation, forecasts, or persisted rollups.",
    measures,
    repeatEventSignal: repeat,
    projection: {
      mode: "derived_read_only",
      persistedRollup: false,
      writesPerformed: false
    }
  });
}
