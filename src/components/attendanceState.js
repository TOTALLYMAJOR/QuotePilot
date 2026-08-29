// Pure attendance-state compatibility model.
//
// This module intentionally performs no I/O and owns no persistence or
// commercial mutation. `event.guests` remains the exact current pricing basis;
// the optional `event.attendance` envelope contributes evidence only.

export const ATTENDANCE_STATE_MODEL = "attendance-state-v1";
export const ATTENDANCE_SCHEMA_VERSION = 1;
export const MAX_ATTENDANCE_COUNT = 400;

const PLANNING_KINDS = new Set(["exact", "approximate", "range", "unknown"]);
const PLANNING_SOURCE_TYPES = new Set([
  "staff_intake",
  "customer_inquiry",
  "import",
  "legacy"
]);
const CONFIRMATION_STATES = new Set([
  "unknown",
  "not_requested",
  "requested",
  "received",
  "applied",
  "superseded"
]);
const CONFIRMATION_SOURCE_TYPES = new Set([
  "",
  "customer_portal",
  "staff_recorded",
  "import"
]);
const SUBMITTED_BY_ROLES = new Set(["", "customer", "sales", "admin"]);
const COMMERCIAL_BASIS_SOURCES = new Set(["none", "planning", "confirmation", "legacy"]);

export class AttendanceStateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AttendanceStateError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new AttendanceStateError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function assertExactKeys(value, keys, label) {
  if (!isRecord(value)) fail("invalid-argument", `${label} must be a plain object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-argument", `${label} contains unsupported or missing fields.`, {
      actual,
      expected
    });
  }
}

function nullableCount(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_ATTENDANCE_COUNT) {
    fail(
      "invalid-argument",
      `${label} must be an integer from 1 to ${MAX_ATTENDANCE_COUNT}.`
    );
  }
  return count;
}

function requiredCount(value, label) {
  const count = nullableCount(value, label);
  if (count === null) fail("invalid-argument", `${label} is required.`);
  return count;
}

function nullableISO(value, label) {
  const text = cleanText(value);
  if (!text) return "";
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== text) {
    fail("invalid-argument", `${label} must be an exact ISO-8601 UTC timestamp.`);
  }
  return text;
}

function nullableDate(value, label) {
  const text = cleanText(value);
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    fail("invalid-argument", `${label} must use YYYY-MM-DD.`);
  }
  const [year, month, day] = text.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    fail("invalid-argument", `${label} must be a real calendar date.`);
  }
  return text;
}

function enumValue(value, allowed, label) {
  const normalized = cleanText(value).toLowerCase();
  if (!allowed.has(normalized)) {
    fail("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function normalizePlanning(raw) {
  assertExactKeys(
    raw,
    [
      "kind",
      "value",
      "min",
      "max",
      "sourceType",
      "sourceReferenceId",
      "observedAtISO",
      "recordedByUid"
    ],
    "event.attendance.planning"
  );
  const kind = enumValue(raw.kind, PLANNING_KINDS, "event.attendance.planning.kind");
  const value = nullableCount(raw.value, "event.attendance.planning.value");
  const min = nullableCount(raw.min, "event.attendance.planning.min");
  const max = nullableCount(raw.max, "event.attendance.planning.max");
  const sourceType = enumValue(
    raw.sourceType,
    PLANNING_SOURCE_TYPES,
    "event.attendance.planning.sourceType"
  );
  const sourceReferenceId = cleanText(raw.sourceReferenceId);
  const observedAtISO = nullableISO(
    raw.observedAtISO,
    "event.attendance.planning.observedAtISO"
  );
  const recordedByUid = cleanText(raw.recordedByUid);

  if (kind === "unknown") {
    if (value !== null || min !== null || max !== null) {
      fail("failed-precondition", "Unknown planning attendance cannot carry a count.");
    }
  } else {
    if (value === null) {
      fail("failed-precondition", `${kind} planning attendance requires a reviewed value.`);
    }
    if (kind === "range") {
      if (min === null || max === null || min > value || value > max || min === max) {
        fail(
          "failed-precondition",
          "Ranged planning attendance requires distinct bounds containing the reviewed value."
        );
      }
    } else if (kind === "approximate") {
      if (min === null || max === null || min > value || value > max || min === max) {
        fail(
          "failed-precondition",
          "Approximate planning attendance requires distinct bounds containing the reviewed value."
        );
      }
    } else if (min !== null || max !== null) {
      fail("failed-precondition", "Exact planning attendance cannot carry range bounds.");
    }
  }

  if (sourceType !== "legacy" && kind !== "unknown" && !observedAtISO) {
    fail("failed-precondition", "Non-legacy planning attendance requires observation time evidence.");
  }

  return {
    kind,
    value,
    min,
    max,
    sourceType,
    sourceReferenceId,
    observedAtISO,
    recordedByUid
  };
}

function normalizeConfirmation(raw) {
  assertExactKeys(
    raw,
    [
      "state",
      "requestedAtISO",
      "dueDate",
      "submittedCount",
      "sourceType",
      "sourceReferenceId",
      "submittedAtISO",
      "submittedByRole",
      "appliedRevisionId",
      "commercialChangeReceiptId"
    ],
    "event.attendance.confirmation"
  );
  const state = enumValue(
    raw.state,
    CONFIRMATION_STATES,
    "event.attendance.confirmation.state"
  );
  const requestedAtISO = nullableISO(
    raw.requestedAtISO,
    "event.attendance.confirmation.requestedAtISO"
  );
  const dueDate = nullableDate(raw.dueDate, "event.attendance.confirmation.dueDate");
  const submittedCount = nullableCount(
    raw.submittedCount,
    "event.attendance.confirmation.submittedCount"
  );
  const sourceType = enumValue(
    raw.sourceType,
    CONFIRMATION_SOURCE_TYPES,
    "event.attendance.confirmation.sourceType"
  );
  const sourceReferenceId = cleanText(raw.sourceReferenceId);
  const submittedAtISO = nullableISO(
    raw.submittedAtISO,
    "event.attendance.confirmation.submittedAtISO"
  );
  const submittedByRole = enumValue(
    raw.submittedByRole,
    SUBMITTED_BY_ROLES,
    "event.attendance.confirmation.submittedByRole"
  );
  const appliedRevisionId = cleanText(raw.appliedRevisionId);
  const commercialChangeReceiptId = cleanText(raw.commercialChangeReceiptId);

  const hasSubmission = submittedCount !== null
    || sourceType !== ""
    || sourceReferenceId
    || submittedAtISO
    || submittedByRole;
  const hasApplyEvidence = Boolean(appliedRevisionId || commercialChangeReceiptId);

  if (["unknown", "not_requested", "requested"].includes(state) && hasSubmission) {
    fail("failed-precondition", `${state} confirmation cannot carry submission evidence.`);
  }
  if (["unknown", "not_requested", "requested", "received", "superseded"].includes(state) && hasApplyEvidence) {
    fail("failed-precondition", `${state} confirmation cannot carry applied commercial evidence.`);
  }
  if (state === "requested" && !requestedAtISO) {
    fail("failed-precondition", "Requested confirmation requires request time evidence.");
  }
  if (["received", "applied", "superseded"].includes(state)) {
    if (
      submittedCount === null
      || sourceType === ""
      || !sourceReferenceId
      || !submittedAtISO
      || submittedByRole === ""
    ) {
      fail(
        "failed-precondition",
        `${state} confirmation requires complete source-backed submission evidence.`
      );
    }
  }
  if (state === "applied" && (!appliedRevisionId || !commercialChangeReceiptId)) {
    fail(
      "failed-precondition",
      "Applied confirmation requires an exact revision and commercial-change receipt."
    );
  }

  return {
    state,
    requestedAtISO,
    dueDate,
    submittedCount,
    sourceType,
    sourceReferenceId,
    submittedAtISO,
    submittedByRole,
    appliedRevisionId,
    commercialChangeReceiptId
  };
}

function normalizeCommercialBasis(raw) {
  assertExactKeys(
    raw,
    ["source", "sourceReferenceId", "appliedRevisionId"],
    "event.attendance.commercialBasis"
  );
  return {
    source: enumValue(
      raw.source,
      COMMERCIAL_BASIS_SOURCES,
      "event.attendance.commercialBasis.source"
    ),
    sourceReferenceId: cleanText(raw.sourceReferenceId),
    appliedRevisionId: cleanText(raw.appliedRevisionId)
  };
}

function legacyEnvelope(commercialCount) {
  return {
    schemaVersion: ATTENDANCE_SCHEMA_VERSION,
    planning: {
      kind: commercialCount === null ? "unknown" : "exact",
      value: commercialCount,
      min: null,
      max: null,
      sourceType: "legacy",
      sourceReferenceId: "",
      observedAtISO: "",
      recordedByUid: ""
    },
    confirmation: {
      state: "unknown",
      requestedAtISO: "",
      dueDate: "",
      submittedCount: null,
      sourceType: "",
      sourceReferenceId: "",
      submittedAtISO: "",
      submittedByRole: "",
      appliedRevisionId: "",
      commercialChangeReceiptId: ""
    },
    commercialBasis: {
      source: "legacy",
      sourceReferenceId: "",
      appliedRevisionId: ""
    }
  };
}

function normalizeEnvelope(raw, commercialCount, currentRevisionId) {
  if (raw === null || raw === undefined) return legacyEnvelope(commercialCount);
  assertExactKeys(
    raw,
    ["schemaVersion", "planning", "confirmation", "commercialBasis"],
    "event.attendance"
  );
  if (raw.schemaVersion !== ATTENDANCE_SCHEMA_VERSION) {
    fail("failed-precondition", "Unsupported attendance schema version.", {
      expected: ATTENDANCE_SCHEMA_VERSION,
      actual: raw.schemaVersion
    });
  }
  const envelope = {
    schemaVersion: ATTENDANCE_SCHEMA_VERSION,
    planning: normalizePlanning(raw.planning),
    confirmation: normalizeConfirmation(raw.confirmation),
    commercialBasis: normalizeCommercialBasis(raw.commercialBasis)
  };

  if (envelope.confirmation.state === "applied") {
    if (commercialCount === null || envelope.confirmation.submittedCount !== commercialCount) {
      fail(
        "failed-precondition",
        "Applied confirmation must match the exact current commercial pricing basis."
      );
    }
    if (
      envelope.commercialBasis.source !== "confirmation"
      || envelope.commercialBasis.appliedRevisionId !== envelope.confirmation.appliedRevisionId
      || envelope.commercialBasis.sourceReferenceId !== envelope.confirmation.sourceReferenceId
    ) {
      fail(
        "failed-precondition",
        "Applied confirmation and commercial-basis evidence must identify the same revision and source."
      );
    }
    if (
      !currentRevisionId
      || envelope.confirmation.appliedRevisionId !== currentRevisionId
    ) {
      fail(
        "failed-precondition",
        "Applied confirmation must identify the quote's exact current revision."
      );
    }
  }
  if (envelope.commercialBasis.source === "planning" && envelope.planning.value !== commercialCount) {
    fail(
      "failed-precondition",
      "Planning-based commercial evidence must match event.guests."
    );
  }
  if (envelope.commercialBasis.source === "confirmation" && envelope.confirmation.state !== "applied") {
    fail(
      "failed-precondition",
      "Confirmation-based commercial evidence requires an applied confirmation."
    );
  }
  if (envelope.commercialBasis.source === "none") {
    if (
      commercialCount !== null
      || envelope.commercialBasis.sourceReferenceId
      || envelope.commercialBasis.appliedRevisionId
    ) {
      fail(
        "failed-precondition",
        "An absent commercial basis cannot carry a saved count, source, or revision."
      );
    }
  } else if (commercialCount === null) {
    fail(
      "failed-precondition",
      "A named commercial basis requires an exact event.guests value."
    );
  }
  if (envelope.commercialBasis.source === "legacy" && raw !== undefined) {
    if (envelope.planning.sourceType !== "legacy") {
      fail(
        "failed-precondition",
        "Legacy commercial basis requires legacy planning evidence."
      );
    }
  }
  return envelope;
}

function normalizeActualAttendance(raw) {
  if (raw === null || raw === undefined) return null;
  assertExactKeys(
    raw,
    ["count", "recordedAtISO", "sourceReferenceId"],
    "actualAttendance"
  );
  const count = requiredCount(raw.count, "actualAttendance.count");
  const recordedAtISO = nullableISO(raw.recordedAtISO, "actualAttendance.recordedAtISO");
  const sourceReferenceId = cleanText(raw.sourceReferenceId);
  if (!recordedAtISO || !sourceReferenceId) {
    fail(
      "failed-precondition",
      "Actual attendance requires closeout time and source evidence."
    );
  }
  return { count, recordedAtISO, sourceReferenceId };
}

function decisionDebtItems(input) {
  if (!input) return [];
  if (Array.isArray(input?.snapshot?.items)) return input.snapshot.items;
  if (Array.isArray(input?.items)) return input.items;
  return [];
}

function normalizeGuestDecisionDebt(input) {
  const item = decisionDebtItems(input).find((candidate) => (
    cleanText(candidate?.decisionType).toLowerCase() === "guest_count"
    && cleanText(candidate?.resolutionState).toLowerCase() !== "resolved"
  ));
  if (!item) return null;
  const id = cleanText(item.id);
  const lockDate = nullableDate(item.lockDate, "guest-count Decision Debt lockDate");
  const daysUntilLock = Number(item.daysUntilLock);
  if (!id || !lockDate || !Number.isInteger(daysUntilLock)) {
    return {
      state: "unknown",
      id,
      lockDate,
      daysUntilLock: Number.isInteger(daysUntilLock) ? daysUntilLock : null,
      reason: "Guest-count decision timing evidence is incomplete."
    };
  }
  return {
    state: daysUntilLock <= 0 ? "due_or_overdue" : "scheduled",
    id,
    lockDate,
    daysUntilLock,
    reason: daysUntilLock <= 0
      ? "The final guest-count decision is due or overdue."
      : `${daysUntilLock} day${daysUntilLock === 1 ? "" : "s"} remain until the final guest-count lock date.`
  };
}

function primaryState({ commercialCount, envelope, decisionDebt, actualAttendance }) {
  if (actualAttendance) {
    return {
      id: "ACTUAL_RECORDED",
      label: "Actual attendance recorded",
      nextActionId: "review_closeout"
    };
  }
  if (envelope.confirmation.state === "applied") {
    return {
      id: "FINAL_APPLIED",
      label: "Final count applied",
      nextActionId: "review_dependencies"
    };
  }
  if (envelope.confirmation.state === "received") {
    const changed = envelope.confirmation.submittedCount !== commercialCount;
    return changed
      ? {
          id: "CHANGE_REVIEW_REQUIRED",
          label: "Guest-count change needs review",
          nextActionId: "review_count_change"
        }
      : {
          id: "CONFIRMATION_RECEIVED",
          label: "Matching count received",
          nextActionId: "review_confirmation"
        };
  }
  if (decisionDebt && decisionDebt.state !== "unknown") {
    return {
      id: "CONFIRMATION_DUE",
      label: decisionDebt.state === "due_or_overdue"
        ? "Final count is due"
        : "Final count is scheduled",
      nextActionId: "review_final_count_decision"
    };
  }
  if (commercialCount !== null) {
    return {
      id: "PRICED_ASSUMPTION",
      label: "Commercial count recorded",
      nextActionId: "review_priced_assumption"
    };
  }
  if (["approximate", "range"].includes(envelope.planning.kind)) {
    return {
      id: "PLANNING_ESTIMATE",
      label: "Planning estimate recorded",
      nextActionId: "choose_commercial_count"
    };
  }
  return {
    id: "UNKNOWN",
    label: "Guest count is not recorded",
    nextActionId: "record_guest_count"
  };
}

export function deriveAttendanceState({
  quote = {},
  decisionDebtSnapshot = null,
  actualAttendance = null
} = {}) {
  if (!isRecord(quote)) fail("invalid-argument", "quote must be a plain object.");
  const event = quote.event === undefined ? {} : quote.event;
  if (!isRecord(event)) fail("invalid-argument", "quote.event must be a plain object.");
  const commercialCount = nullableCount(event.guests, "quote.event.guests");
  const currentRevisionId = cleanText(
    quote.activeVersionId || quote.versionMeta?.versionId
  );
  const envelope = normalizeEnvelope(event.attendance, commercialCount, currentRevisionId);
  const debt = normalizeGuestDecisionDebt(decisionDebtSnapshot);
  const actual = normalizeActualAttendance(actualAttendance);
  const derived = primaryState({
    commercialCount,
    envelope,
    decisionDebt: debt,
    actualAttendance: actual
  });

  return deepFreeze({
    modelId: ATTENDANCE_STATE_MODEL,
    schemaVersion: ATTENDANCE_SCHEMA_VERSION,
    commercialBasis: {
      count: commercialCount,
      currentRevisionId,
      source: envelope.commercialBasis.source,
      sourceReferenceId: envelope.commercialBasis.sourceReferenceId,
      appliedRevisionId: envelope.commercialBasis.appliedRevisionId
    },
    planning: envelope.planning,
    confirmation: envelope.confirmation,
    decisionDebt: debt,
    actual,
    derived,
    boundaries: {
      commercialCountSource: "quote.event.guests",
      mutatesQuote: false,
      provesSourceBackedSubmission: ["received", "applied", "superseded"]
        .includes(envelope.confirmation.state),
      provesCustomerSubmittedCount: ["received", "applied", "superseded"]
        .includes(envelope.confirmation.state)
        && envelope.confirmation.sourceType === "customer_portal"
        && envelope.confirmation.submittedByRole === "customer",
      provesAppliedFinalCount: envelope.confirmation.state === "applied",
      provesPricingChangeApplied: envelope.confirmation.state === "applied",
      provesOperationalReadiness: false,
      provesPaymentOrProviderOutcome: false
    }
  });
}
