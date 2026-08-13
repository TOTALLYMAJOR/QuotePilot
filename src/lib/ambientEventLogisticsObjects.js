import { createIntelligentObjectDescriptor } from "./ambientContracts";
import { MAX_EVENT_HOURS, MIN_EVENT_HOURS } from "./wizardUi";

export const AMBIENT_EVENT_LOGISTICS_OBJECT_KINDS = Object.freeze([
  "date",
  "time",
  "duration",
  "venue"
]);

export const AMBIENT_EVENT_LOGISTICS_EVIDENCE_STATES = Object.freeze([
  "available",
  "missing",
  "partial",
  "stale",
  "unavailable"
]);

export const AMBIENT_EVENT_LOGISTICS_EVIDENCE_SLOTS = Object.freeze([
  Object.freeze({ key: "availability", id: "availability", label: "Availability" }),
  Object.freeze({ key: "seasonalPricing", id: "seasonal-pricing", label: "Seasonal pricing" }),
  Object.freeze({ key: "travel", id: "travel", label: "Travel" }),
  Object.freeze({ key: "quoteValidity", id: "quote-validity", label: "Quote validity" }),
  Object.freeze({ key: "scheduling", id: "scheduling", label: "Scheduling" })
]);

export const AMBIENT_EVENT_LOGISTICS_INPUT_BOUNDS = Object.freeze({
  date: Object.freeze({ type: "date", format: "YYYY-MM-DD", maxLength: 10 }),
  time: Object.freeze({ type: "time", format: "HH:MM", maxLength: 5 }),
  duration: Object.freeze({
    type: "number",
    minimum: MIN_EVENT_HOURS,
    maximum: MAX_EVENT_HOURS,
    step: 1,
    unit: "hours"
  }),
  venue: Object.freeze({
    type: "text-group",
    fields: Object.freeze([
      Object.freeze({ path: "event.venue", label: "Venue", maxLength: 160 }),
      Object.freeze({ path: "event.venueAddress", label: "Venue address", maxLength: 240 })
    ])
  })
});

const STAFF_ROLES = new Set(["admin", "sales"]);
const SLOT_INPUT_MAX_LENGTH = 400;
const SOURCE_LABEL_MAX_LENGTH = 120;

const OBJECT_DEFINITIONS = Object.freeze({
  date: Object.freeze({
    id: "event-date",
    label: "Event date",
    inspectorSurfaceId: "event-date-context",
    fieldPaths: Object.freeze(["event.date"]),
    stageActionId: "stage-event-date"
  }),
  time: Object.freeze({
    id: "event-time",
    label: "Event time",
    inspectorSurfaceId: "event-time-context",
    fieldPaths: Object.freeze(["event.time"]),
    stageActionId: "stage-event-time"
  }),
  duration: Object.freeze({
    id: "event-duration",
    label: "Event duration",
    inspectorSurfaceId: "event-duration-context",
    fieldPaths: Object.freeze(["event.hours"]),
    stageActionId: "stage-event-duration"
  }),
  venue: Object.freeze({
    id: "event-venue",
    label: "Event venue",
    inspectorSurfaceId: "event-venue-context",
    fieldPaths: Object.freeze(["event.venue", "event.venueAddress"]),
    stageActionId: "stage-event-venue"
  })
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function boundedText(value, maximum) {
  if (typeof value !== "string") return { value: null, issue: "not_text" };
  if (value.length > maximum) return { value: null, issue: "over_limit", length: value.length };
  if (!value.trim()) return { value: "", issue: "empty" };
  return { value, issue: null };
}

function optionalIso(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = value.trim();
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validTime(value) {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function savedTextValue(value, { label, maximum, validate, requiredPattern = "bounded text" }) {
  if (value === null || value === undefined || value === "") {
    return deepFreeze({
      state: "missing",
      raw: null,
      displayValue: `${label} not recorded`,
      reason: `The saved quote does not record ${label.toLowerCase()}.`
    });
  }
  const bounded = boundedText(value, maximum);
  if (bounded.issue === "over_limit") {
    return deepFreeze({
      state: "partial",
      raw: null,
      displayValue: `${label} exceeds the safe display bound`,
      reason: `The saved ${label.toLowerCase()} contains ${bounded.length} characters; the presentation bound is ${maximum}. No truncated value is presented.`
    });
  }
  if (bounded.issue) {
    return deepFreeze({
      state: "partial",
      raw: bounded.value,
      displayValue: `${label} is not usable`,
      reason: `The saved ${label.toLowerCase()} is not a bounded non-empty text value.`
    });
  }
  if (!validate(bounded.value)) {
    return deepFreeze({
      state: "partial",
      raw: bounded.value,
      displayValue: bounded.value,
      reason: `The exact saved ${label.toLowerCase()} does not match the required ${requiredPattern} format or range.`
    });
  }
  return deepFreeze({
    state: "available",
    raw: bounded.value,
    displayValue: bounded.value,
    reason: null
  });
}

function savedDurationValue(value) {
  if (value === null || value === undefined || value === "") {
    return deepFreeze({
      state: "missing",
      raw: null,
      displayValue: "Event duration not recorded",
      reason: "The saved quote does not record event duration."
    });
  }
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < MIN_EVENT_HOURS
    || value > MAX_EVENT_HOURS
  ) {
    return deepFreeze({
      state: "partial",
      raw: typeof value === "number" && Number.isFinite(value) ? value : null,
      displayValue: "Event duration is outside the supported presentation bound",
      reason: `The exact saved duration must be a finite number from ${MIN_EVENT_HOURS} to ${MAX_EVENT_HOURS} hours. No clamped or inferred duration is presented.`
    });
  }
  return deepFreeze({
    state: "available",
    raw: value,
    displayValue: `${value} ${value === 1 ? "hour" : "hours"}`,
    reason: null
  });
}

function savedVenueValue(event) {
  const name = savedTextValue(event?.venue, {
    label: "Event venue",
    maximum: 160,
    validate: (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    requiredPattern: "bounded printable text"
  });
  const address = event?.venueAddress === null
    || event?.venueAddress === undefined
    || event?.venueAddress === ""
    ? deepFreeze({
        state: "missing",
        raw: null,
        displayValue: "Venue address not recorded",
        reason: "The saved quote does not record a venue address."
      })
    : savedTextValue(event.venueAddress, {
        label: "Venue address",
        maximum: 240,
        validate: (value) => !/[\u0000-\u001f\u007f]/u.test(value),
        requiredPattern: "bounded printable text"
      });
  const state = name.state === "available" && ["available", "missing"].includes(address.state)
    ? "available"
    : name.state === "missing"
      ? "missing"
      : "partial";
  const reason = state === "available"
    ? null
    : [name.reason, address.state === "partial" ? address.reason : ""].filter(Boolean).join(" ");
  return deepFreeze({
    state,
    raw: name.raw === null && address.raw === null
      ? null
      : { name: name.raw, address: address.raw },
    displayValue: name.state === "available"
      ? `${name.displayValue}${address.state === "available" ? ` · ${address.displayValue}` : ""}`
      : name.displayValue,
    reason,
    name,
    address
  });
}

function savedValueFor(kind, event) {
  if (kind === "date") {
    return savedTextValue(event?.date, {
      label: "Event date",
      maximum: AMBIENT_EVENT_LOGISTICS_INPUT_BOUNDS.date.maxLength,
      validate: validDate,
      requiredPattern: "YYYY-MM-DD"
    });
  }
  if (kind === "time") {
    return savedTextValue(event?.time, {
      label: "Event time",
      maximum: AMBIENT_EVENT_LOGISTICS_INPUT_BOUNDS.time.maxLength,
      validate: validTime,
      requiredPattern: "HH:MM"
    });
  }
  if (kind === "duration") return savedDurationValue(event?.hours);
  return savedVenueValue(event || {});
}

function missingSlot(definition) {
  return deepFreeze({
    id: definition.id,
    label: definition.label,
    state: "missing",
    claim: null,
    sourceLabel: null,
    observedAt: null,
    reason: `${definition.label} evidence was not supplied to this presentation snapshot.`
  });
}

function partialSlot(definition, reason, { claim = null, sourceLabel = null, observedAt = null } = {}) {
  return deepFreeze({
    id: definition.id,
    label: definition.label,
    state: "partial",
    claim,
    sourceLabel,
    observedAt,
    reason
  });
}

function normalizeEvidenceSlot(definition, input, { staffRole }) {
  if (!staffRole) {
    return deepFreeze({
      id: definition.id,
      label: definition.label,
      state: "unavailable",
      claim: null,
      sourceLabel: null,
      observedAt: null,
      reason: "Staff role is required to inspect internal event-logistics evidence."
    });
  }
  if (input === null || input === undefined) return missingSlot(definition);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return partialSlot(definition, `${definition.label} evidence is partial because its input is not a structured evidence record.`);
  }
  const requestedState = typeof input.state === "string" ? input.state.trim().toLowerCase() : "";
  if (!AMBIENT_EVENT_LOGISTICS_EVIDENCE_STATES.includes(requestedState)) {
    return partialSlot(definition, `${definition.label} evidence is partial because its state is missing or unsupported.`);
  }
  if (requestedState === "missing") return missingSlot(definition);

  const claim = boundedText(input.claim, SLOT_INPUT_MAX_LENGTH);
  const sourceLabel = boundedText(input.sourceLabel, SOURCE_LABEL_MAX_LENGTH);
  const reason = boundedText(input.reason, SLOT_INPUT_MAX_LENGTH);
  const observedAt = optionalIso(input.observedAt);
  const boundedIssue = [claim, sourceLabel, reason].some((item) => item.issue === "over_limit");
  if (boundedIssue) {
    return partialSlot(
      definition,
      `${definition.label} evidence is partial because at least one field exceeds its safe presentation bound. No truncated claim is presented.`
    );
  }

  if (requestedState === "available") {
    if (claim.issue || sourceLabel.issue) {
      return partialSlot(
        definition,
        `${definition.label} evidence is partial because an available claim requires both a bounded claim and named source.`
      );
    }
    if (input.observedAt && !observedAt) {
      return partialSlot(
        definition,
        `${definition.label} evidence is partial because its observation time is invalid.`,
        { claim: claim.value, sourceLabel: sourceLabel.value }
      );
    }
    return deepFreeze({
      id: definition.id,
      label: definition.label,
      state: "available",
      claim: claim.value,
      sourceLabel: sourceLabel.value,
      observedAt,
      reason: null
    });
  }

  if (requestedState === "stale") {
    if (claim.issue || sourceLabel.issue || reason.issue || !observedAt) {
      return partialSlot(
        definition,
        `${definition.label} evidence is partial because stale evidence requires a bounded claim, named source, valid observation time, and reason.`,
        {
          claim: claim.issue ? null : claim.value,
          sourceLabel: sourceLabel.issue ? null : sourceLabel.value,
          observedAt
        }
      );
    }
    return deepFreeze({
      id: definition.id,
      label: definition.label,
      state: "stale",
      claim: claim.value,
      sourceLabel: sourceLabel.value,
      observedAt,
      reason: reason.value
    });
  }

  if (reason.issue) {
    return partialSlot(
      definition,
      `${definition.label} evidence is partial because ${requestedState} evidence requires a bounded reason.`,
      {
        claim: claim.issue ? null : claim.value,
        sourceLabel: sourceLabel.issue ? null : sourceLabel.value,
        observedAt
      }
    );
  }
  return deepFreeze({
    id: definition.id,
    label: definition.label,
    state: requestedState,
    claim: claim.issue ? null : claim.value,
    sourceLabel: sourceLabel.issue ? null : sourceLabel.value,
    observedAt,
    reason: reason.value
  });
}

function evidenceSlots(input, role) {
  const staffRole = STAFF_ROLES.has(role);
  return deepFreeze(Object.fromEntries(AMBIENT_EVENT_LOGISTICS_EVIDENCE_SLOTS.map((definition) => [
    definition.key,
    normalizeEvidenceSlot(definition, input?.[definition.key], { staffRole })
  ])));
}

function slotStatement(slot) {
  const stateLabel = slot.state.charAt(0).toUpperCase() + slot.state.slice(1);
  const detail = slot.claim || slot.reason;
  return `${slot.label}: ${stateLabel}.${detail ? ` ${detail}` : ""}`;
}

function dependenciesFor(kind, slots) {
  const definition = OBJECT_DEFINITIONS[kind];
  return Object.values(slots).map((slot) => ({
    object: {
      id: `${definition.id}-${slot.id}`,
      type: "event-logistics-evidence-slot",
      label: slot.label
    },
    relationship: `${definition.id}_requires_${slot.id}`,
    consequence: slotStatement(slot)
  }));
}

function provenanceFor(kind, quote, savedValue, slots) {
  const definition = OBJECT_DEFINITIONS[kind];
  const quoteId = typeof quote?.id === "string" && quote.id.trim()
    ? quote.id.trim().slice(0, 120)
    : "selected";
  const updatedAt = optionalIso(quote?.updatedAtISO);
  const savedState = savedValue.state === "available" ? "available" : "unavailable";
  const entries = [{
    sourceId: `quote:${quoteId}:${definition.id}`,
    label: `Selected saved quote ${definition.label.toLowerCase()}`,
    type: "saved-quote-field",
    state: savedState,
    observedAt: updatedAt,
    ...(savedState === "available" ? {} : { reason: savedValue.reason })
  }];
  Object.values(slots).forEach((slot) => {
    const state = slot.state === "available"
      ? "available"
      : slot.state === "stale"
        ? "stale"
        : "unavailable";
    entries.push({
      sourceId: `${definition.id}:evidence:${slot.id}`,
      label: slot.sourceLabel || `${slot.label} evidence slot`,
      type: "event-logistics-evidence",
      state,
      observedAt: slot.observedAt,
      ...(state === "available" ? {} : { reason: slot.reason || `${slot.label} evidence is ${slot.state}.` })
    });
  });
  return entries;
}

function confidenceFor(savedValue, slots, { staffRole }) {
  if (!staffRole) {
    return {
      level: "unavailable",
      basis: "Staff role is required; internal event-logistics evidence is withheld."
    };
  }
  if (savedValue.state !== "available") {
    return {
      level: "unavailable",
      basis: `The saved value is ${savedValue.state}. ${savedValue.reason}`
    };
  }
  const values = Object.values(slots);
  const stateSummary = values.map((slot) => `${slot.label}: ${slot.state}`).join("; ");
  const availableCount = values.filter((slot) => slot.state === "available").length;
  return {
    level: availableCount === values.length
      ? "high"
      : availableCount > 0
        ? "medium"
        : "low",
    basis: `Confidence applies only to the exact saved value and named evidence coverage. ${stateSummary}. No availability, seasonal-price, travel, validity, or scheduling conclusion is inferred.`
  };
}

function objectCopy(kind, savedValue) {
  const label = OBJECT_DEFINITIONS[kind].label.toLowerCase();
  const exactValue = savedValue.displayValue;
  return {
    why: `The selected saved quote records ${label} as ${exactValue}. This detail can affect availability, seasonal pricing, travel, quote validity, and scheduling, but none of those outcomes is inferred without named evidence.`,
    consequence: `Changing ${label} can affect timing, availability, staffing, and pricing. This presentation object can only describe or stage a draft candidate; it does not reserve capacity, reprice, schedule work, extend validity, or save a quote.`,
    doNothing: `The saved ${label} remains ${exactValue}. Missing, partial, stale, or unavailable evidence remains unresolved, and no downstream outcome is assumed.`
  };
}

function stagingFor(kind, allowed) {
  if (!allowed) return null;
  const definition = OBJECT_DEFINITIONS[kind];
  return deepFreeze({
    actionId: definition.stageActionId,
    mode: "direct_manipulation",
    target: {
      objectId: definition.id,
      fieldPaths: [...definition.fieldPaths]
    },
    input: AMBIENT_EVENT_LOGISTICS_INPUT_BOUNDS[kind],
    authority: "draft_only",
    commit: false,
    requiresOutcomeNamedSave: true,
    consequencePreviewRequired: true
  });
}

export function buildAmbientEventLogisticsObject(kind, quote = {}, options = {}) {
  if (!AMBIENT_EVENT_LOGISTICS_OBJECT_KINDS.includes(kind)) {
    throw new TypeError(`Unsupported ambient event-logistics object kind: ${String(kind)}`);
  }
  const role = typeof options.role === "string" ? options.role.trim().toLowerCase() : "non_staff";
  const staffRole = STAFF_ROLES.has(role);
  const definition = OBJECT_DEFINITIONS[kind];
  const savedValue = savedValueFor(kind, quote?.event || {});
  const savedValueAvailable = savedValue.state === "available";
  const stageAllowed = staffRole
    && options.ordinaryEditAllowed === true
    && savedValueAvailable;
  const slots = evidenceSlots(options.evidence || {}, role);
  const copy = objectCopy(kind, savedValue);
  const confidence = confidenceFor(savedValue, slots, { staffRole });
  const permissions = {
    view: staffRole,
    simulate: false,
    stage: stageAllowed,
    commit: false,
    reason: !staffRole
      ? "Staff role is required to inspect or stage event logistics."
      : !savedValueAvailable
        ? `Draft staging requires an exact available saved ${definition.label.toLowerCase()}. The saved value is ${savedValue.state}. ${savedValue.reason}`
        : stageAllowed
          ? "Direct manipulation stages draft metadata only; simulation and commit authority remain unavailable."
          : "This role or lifecycle is view-only; draft staging and commit authority remain unavailable."
  };
  const descriptor = createIntelligentObjectDescriptor({
    id: definition.id,
    type: "intelligent-object",
    label: definition.label,
    summary: savedValue.state === "available"
      ? `${savedValue.displayValue} is recorded on the selected saved quote.`
      : `${definition.label} is ${savedValue.state}: ${savedValue.reason}`,
    inspectorSurfaceId: definition.inspectorSurfaceId,
    dependencies: dependenciesFor(kind, slots),
    why: copy.why,
    consequence: copy.consequence,
    doNothing: copy.doNothing,
    confidence,
    provenance: provenanceFor(kind, quote, savedValue, slots),
    recommendation: null,
    permissions,
    actionIds: stageAllowed
      ? [`inspect-${definition.id}`, definition.stageActionId]
      : [`inspect-${definition.id}`]
  });
  return deepFreeze({
    ...descriptor,
    savedValue,
    evidenceSlots: slots,
    staging: stagingFor(kind, stageAllowed),
    presentationAuthority: "advisory",
    roleBoundary: {
      role: staffRole ? role : "non_staff",
      staffRole,
      ordinaryEditAllowed: stageAllowed
    }
  });
}

export function buildAmbientEventLogisticsObjects(quote = {}, options = {}) {
  return deepFreeze(Object.fromEntries(AMBIENT_EVENT_LOGISTICS_OBJECT_KINDS.map((kind) => [
    kind,
    buildAmbientEventLogisticsObject(kind, quote, options)
  ])));
}
