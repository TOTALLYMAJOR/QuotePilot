import { buildBeoPayload } from "./beoPayload";
import {
  buildKitchenCheckpoints,
  defaultKitchenCheckpointOffsets,
  formatMinutesToTimeInput,
  parseTimeToMinutes
} from "./quoteWorkflow";

export const EVENT_RUN_OF_SHOW_SCHEMA_VERSION = 1;
export const EVENT_RUN_OF_SHOW_MODEL_VERSION = "event-run-of-show-v1";
export const EVENT_RUN_OF_SHOW_DEFAULT_LIMIT = 25;
export const EVENT_RUN_OF_SHOW_MAX_LIMIT = 100;

export const EVENT_RUN_OF_SHOW_PROOF_BOUNDARY =
  "This read-only projection reports proposal acceptance and booking as separate canonical quote states. Checklist entries do not establish payment, staffing attendance, inventory availability, or operational readiness.";

const ELIGIBLE_STATUSES = new Set(["accepted", "booked"]);
const DURATION_DEPENDENT_CHECKPOINT_IDS = new Set(["service-end", "reset"]);

const SOURCE_DESCRIPTORS = Object.freeze({
  firebase: Object.freeze({
    id: "firebase",
    label: "Firestore staff records",
    authority: "canonical_staff_records"
  }),
  local: Object.freeze({
    id: "local",
    label: "Browser-local workspace",
    authority: "browser_local_records"
  }),
  mixed: Object.freeze({
    id: "mixed",
    label: "Mixed staff record sources",
    authority: "mixed_staff_records"
  }),
  unknown: Object.freeze({
    id: "unknown",
    label: "Source not confirmed",
    authority: "unconfirmed"
  })
});

function cleanText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function nonNegativeNumberOrNull(value) {
  const normalized = finiteNumberOrNull(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

function positiveNumberOrNull(value) {
  const normalized = finiteNumberOrNull(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

function normalizedIsoOrNull(value) {
  const normalized = cleanText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizedCalendarDateOrNull(value) {
  const normalized = cleanText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized || "");
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, monthIndex, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== monthIndex
    || parsed.getUTCDate() !== day
  ) return null;
  return normalized;
}

function normalizedTimeOrNull(value) {
  const minutes = parseTimeToMinutes(value);
  return minutes === null ? null : formatMinutesToTimeInput(minutes);
}

function addCalendarDays(calendarDate, dayOffset) {
  const normalized = normalizedCalendarDateOrNull(calendarDate);
  if (!normalized || !Number.isInteger(dayOffset)) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return [
    String(result.getUTCFullYear()).padStart(4, "0"),
    String(result.getUTCMonth() + 1).padStart(2, "0"),
    String(result.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function compareText(left, right) {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

function normalizeLimit(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    return EVENT_RUN_OF_SHOW_DEFAULT_LIMIT;
  }
  return Math.min(normalized, EVENT_RUN_OF_SHOW_MAX_LIMIT);
}

function normalizeSource(source) {
  const sourceId = cleanText(typeof source === "object" ? source?.id : source)?.toLowerCase();
  const descriptor = SOURCE_DESCRIPTORS[sourceId] || SOURCE_DESCRIPTORS.unknown;
  return { ...descriptor };
}

function validCheckpointOverrides(quote) {
  const rawOverrides = Array.isArray(quote?.booking?.kitchenCheckpoints)
    ? quote.booking.kitchenCheckpoints
    : [];
  const overridesById = new Map();

  rawOverrides.forEach((item) => {
    const id = cleanText(item?.id);
    const minuteOffset = finiteNumberOrNull(item?.minuteOffset);
    if (!id || minuteOffset === null) return;
    overridesById.set(id, {
      id,
      label: cleanText(item?.label),
      minuteOffset: Math.round(minuteOffset)
    });
  });

  return overridesById;
}

function buildTimeline(quote, event) {
  const durationMinutes = event.hours === null
    ? null
    : Math.max(60, Math.round(event.hours * 60));
  const definitions = defaultKitchenCheckpointOffsets(durationMinutes ?? 0);
  const overrideById = validCheckpointOverrides(quote);
  const sanitizedOverrides = [...overrideById.values()].map((item) => ({
    id: item.id,
    label: item.label || "",
    minuteOffset: item.minuteOffset
  }));
  const generated = buildKitchenCheckpoints({
    time: event.time,
    hours: event.hours,
    kitchenCheckpointOverrides: sanitizedOverrides
  });
  const generatedById = new Map(generated.map((item) => [item.id, item]));

  return definitions.map((definition, definitionIndex) => {
    const generatedCheckpoint = generatedById.get(definition.id);
    const override = overrideById.get(definition.id);
    const durationUnknown = event.hours === null
      && DURATION_DEPENDENT_CHECKPOINT_IDS.has(definition.id)
      && !override;
    const timingKnown = Boolean(generatedCheckpoint) && !durationUnknown;
    const minute = timingKnown ? generatedCheckpoint.minute : null;
    const dayOffset = minute === null ? null : Math.floor(minute / 1440);
    const uncertaintyReason = event.time === null
      ? "event_time_unknown"
      : durationUnknown
        ? "event_duration_unknown"
        : null;

    return {
      id: definition.id,
      label: generatedCheckpoint?.label || override?.label || definition.label,
      timingState: timingKnown ? "known" : "unknown",
      timingBasis: override ? "booking_override" : "generated_default",
      minuteOffset: timingKnown || override ? (override?.minuteOffset ?? definition.minuteOffset) : null,
      minute,
      date: minute === null ? null : addCalendarDays(event.date, dayOffset),
      time: timingKnown ? generatedCheckpoint.timeValue : null,
      timeLabel: timingKnown ? generatedCheckpoint.timeLabel : null,
      dayOffset,
      uncertaintyReason,
      definitionIndex
    };
  }).sort((left, right) => {
    if (left.minute !== null && right.minute !== null && left.minute !== right.minute) {
      return left.minute - right.minute;
    }
    if (left.minute !== null && right.minute === null) return -1;
    if (left.minute === null && right.minute !== null) return 1;
    if (left.definitionIndex !== right.definitionIndex) {
      return left.definitionIndex - right.definitionIndex;
    }
    return compareText(left.id, right.id);
  }).map(({ definitionIndex, ...checkpoint }) => checkpoint);
}

function buildChecklist(quote, beoPayload) {
  const persistedItems = Array.isArray(quote?.booking?.productionChecklist)
    ? quote.booking.productionChecklist
    : [];
  const persistedById = new Map();
  persistedItems.forEach((item) => {
    const id = cleanText(item?.id);
    if (id) persistedById.set(id, item);
  });

  const groups = beoPayload.productionChecklist.map((group) => ({
    group: group.group,
    items: group.items.map((item) => {
      const persisted = persistedById.get(item.id);
      const state = !persisted
        ? "unknown"
        : persisted.completed === true
          ? "completed"
          : "not_completed";
      return {
        id: item.id,
        label: item.label,
        state,
        completedAtISO: state === "completed"
          ? normalizedIsoOrNull(persisted?.completedAtISO)
          : null,
        completedByEmail: state === "completed"
          ? cleanText(persisted?.completedByEmail)
          : null
      };
    })
  }));
  const items = groups.flatMap((group) => group.items);
  const completedCount = items.filter((item) => item.state === "completed").length;
  const notCompletedCount = items.filter((item) => item.state === "not_completed").length;
  const unknownCount = items.filter((item) => item.state === "unknown").length;
  const state = unknownCount === items.length
    ? "unknown"
    : completedCount === items.length
      ? "complete"
      : "incomplete";

  return {
    state,
    completedCount,
    notCompletedCount,
    unknownCount,
    totalCount: items.length,
    groups
  };
}

function buildMilestones(quote, status) {
  const acceptedAtISO = normalizedIsoOrNull(quote?.lifecycle?.acceptedAtISO);
  const bookedAtISO = normalizedIsoOrNull(quote?.lifecycle?.bookedAtISO)
    || normalizedIsoOrNull(quote?.booking?.bookedAtISO);
  const acceptanceEstablished = status === "accepted" || Boolean(acceptedAtISO);
  const bookingEstablished = status === "booked";

  return {
    proposalAcceptance: {
      state: acceptanceEstablished ? "accepted" : "unknown",
      atISO: acceptedAtISO,
      evidence: acceptedAtISO ? "lifecycle.acceptedAtISO" : status === "accepted" ? "quote.status" : null
    },
    booking: {
      state: bookingEstablished ? "booked" : "not_booked",
      atISO: bookingEstablished ? bookedAtISO : null,
      contractNumber: bookingEstablished ? cleanText(quote?.booking?.contractNumber) : null,
      evidence: bookingEstablished ? "quote.status" : null
    }
  };
}

function buildUnknownFields(item) {
  const fields = [];
  const inspect = (prefix, record, names) => {
    names.forEach((name) => {
      if (record[name] === null) fields.push(`${prefix}.${name}`);
    });
  };

  inspect("quote", item, ["quoteId", "quoteNumber"]);
  inspect("event", item.event, [
    "name",
    "date",
    "time",
    "hours",
    "venue",
    "venueAddress",
    "guests",
    "style",
    "dietaryRestrictions"
  ]);
  inspect("staffing", item.staffing, ["staffLead", "servers", "chefs", "bartenders"]);
  return fields.sort(compareText);
}

function normalizedBeoReference(beoPayload) {
  const revisionNumber = positiveNumberOrNull(beoPayload.version?.number);
  const createdAtISO = normalizedIsoOrNull(beoPayload.version?.createdAtISO);
  return {
    state: "derivable",
    sourceRevision: {
      id: cleanText(beoPayload.version?.id) || "legacy-unversioned",
      number: revisionNumber,
      createdAtISO,
      createdOn: createdAtISO ? createdAtISO.slice(0, 10) : null
    },
    retainedArtifactEvidence: false,
    artifactState: "not_read",
    freshness: "not_assessed"
  };
}

export function buildEventRunOfShowItem(quote = {}) {
  const status = (cleanText(quote?.status) || "").toLowerCase();
  if (!ELIGIBLE_STATUSES.has(status)) return null;

  const event = {
    name: cleanText(quote?.event?.name),
    date: normalizedCalendarDateOrNull(quote?.event?.date),
    time: normalizedTimeOrNull(quote?.event?.time),
    hours: positiveNumberOrNull(quote?.event?.hours),
    venue: cleanText(quote?.event?.venue),
    venueAddress: cleanText(quote?.event?.venueAddress),
    guests: nonNegativeNumberOrNull(quote?.event?.guests),
    style: cleanText(quote?.event?.style),
    dietaryRestrictions: cleanText(quote?.event?.dietaryRestrictions)
  };
  const staffing = {
    staffLead: cleanText(quote?.booking?.staffLead),
    servers: nonNegativeNumberOrNull(quote?.event?.servers),
    chefs: nonNegativeNumberOrNull(quote?.event?.chefs),
    bartenders: nonNegativeNumberOrNull(quote?.event?.bartenders)
  };
  const validOverrides = [...validCheckpointOverrides(quote).values()];
  const beoPayload = buildBeoPayload({
    ...quote,
    booking: {
      ...(quote?.booking || {}),
      kitchenCheckpoints: validOverrides
    }
  });
  const checklist = buildChecklist(quote, beoPayload);
  const item = {
    quoteId: cleanText(quote?.id || quote?.quoteId),
    quoteNumber: cleanText(quote?.quoteNumber),
    quoteStatus: status,
    milestones: buildMilestones(quote, status),
    operationalReadiness: {
      state: "not_established",
      reason: "Booking and checklist state do not establish operational readiness."
    },
    event,
    staffing,
    timeline: buildTimeline(quote, event),
    productionChecklist: checklist,
    beoReference: normalizedBeoReference(beoPayload)
  };

  return {
    ...item,
    unknownFields: buildUnknownFields(item)
  };
}

function compareRunOfShowItems(left, right) {
  const leftDate = left.event.date;
  const rightDate = right.event.date;
  if (leftDate && rightDate && leftDate !== rightDate) return compareText(leftDate, rightDate);
  if (leftDate && !rightDate) return -1;
  if (!leftDate && rightDate) return 1;

  const leftTime = parseTimeToMinutes(left.event.time);
  const rightTime = parseTimeToMinutes(right.event.time);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime - rightTime;
  if (leftTime !== null && rightTime === null) return -1;
  if (leftTime === null && rightTime !== null) return 1;

  return compareText(left.quoteNumber, right.quoteNumber)
    || compareText(left.quoteId, right.quoteId)
    || compareText(left.event.name, right.event.name);
}

export function buildEventRunOfShowReadModel({
  quotes = [],
  source = "unknown",
  limit = EVENT_RUN_OF_SHOW_DEFAULT_LIMIT,
  upstreamTruncated = false,
  upstreamLimit = null
} = {}) {
  const inputQuotes = Array.isArray(quotes) ? quotes : [];
  const normalizedLimit = normalizeLimit(limit);
  const eligibleQuotes = inputQuotes.filter((quote) => (
    ELIGIBLE_STATUSES.has((cleanText(quote?.status) || "").toLowerCase())
  ));
  const derivedEvents = [];
  let derivationFailedCount = 0;
  eligibleQuotes.forEach((quote) => {
    try {
      const event = buildEventRunOfShowItem(quote);
      if (event) derivedEvents.push(event);
    } catch {
      derivationFailedCount += 1;
    }
  });
  derivedEvents.sort(compareRunOfShowItems);
  const projectionTruncated = derivedEvents.length > normalizedLimit;
  const displayedEvents = derivedEvents.slice(0, normalizedLimit);
  const normalizedUpstreamLimit = positiveNumberOrNull(upstreamLimit);

  return {
    schemaVersion: EVENT_RUN_OF_SHOW_SCHEMA_VERSION,
    modelVersion: EVENT_RUN_OF_SHOW_MODEL_VERSION,
    status: derivationFailedCount > 0 || projectionTruncated || upstreamTruncated === true
      ? "partial"
      : displayedEvents.length
        ? "success"
        : "empty",
    generatedFrom: {
      source: normalizeSource(source),
      projection: "derived_read_only"
    },
    bounds: {
      inputCount: inputQuotes.length,
      eligibleCount: eligibleQuotes.length,
      derivedCount: derivedEvents.length,
      derivationFailedCount,
      excludedCount: inputQuotes.length - eligibleQuotes.length,
      displayedCount: displayedEvents.length,
      limit: normalizedLimit,
      upstreamLimit: normalizedUpstreamLimit,
      projectionTruncated,
      upstreamTruncated: upstreamTruncated === true,
      truncated: projectionTruncated || upstreamTruncated === true
    },
    proofBoundary: EVENT_RUN_OF_SHOW_PROOF_BOUNDARY,
    events: displayedEvents
  };
}

export function buildCustomerWorkspaceEventRunOfShow(customerWorkspace = {}, options = {}) {
  return buildEventRunOfShowReadModel({
    quotes: customerWorkspace?.quotes,
    source: customerWorkspace?.source,
    limit: options.limit,
    upstreamTruncated: customerWorkspace?.quotePageInfo?.truncated === true,
    upstreamLimit: customerWorkspace?.quotePageInfo?.limit
  });
}
