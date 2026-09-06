export const FIELD_STATE_AXES = Object.freeze({
  availability: Object.freeze([
    "unknown",
    "not_provided",
    "not_applicable",
    "unavailable"
  ]),
  origin: Object.freeze([
    "defaulted",
    "suggested",
    "prepopulated",
    "historical_imported"
  ]),
  editability: Object.freeze([
    "draft",
    "blocked",
    "read_only",
    "protected"
  ]),
  persistence: Object.freeze([
    "saving",
    "saved",
    "published"
  ]),
  evidence: Object.freeze([
    "pending",
    "confirmed",
    "failed",
    "stale"
  ])
});

const DEFINITIONS = {
  unknown: {
    axis: "availability",
    label: "Unknown",
    meaning: "We do not know.",
    priority: 140,
    tone: "neutral",
    announce: "off"
  },
  not_provided: {
    axis: "availability",
    label: "Not provided",
    meaning: "The user or source supplied nothing.",
    priority: 130,
    tone: "neutral",
    announce: "off"
  },
  not_applicable: {
    axis: "availability",
    label: "Not applicable",
    meaning: "This field does not apply.",
    priority: 150,
    tone: "quiet",
    announce: "off"
  },
  unavailable: {
    axis: "availability",
    label: "Unavailable",
    meaning: "The capability or evidence cannot currently be obtained.",
    priority: 30,
    tone: "warning",
    announce: "assertive",
    requiresReason: true,
    requiresRecovery: true
  },
  defaulted: {
    axis: "origin",
    label: "Defaulted",
    meaning: "This value came from a default.",
    priority: 120,
    tone: "neutral",
    announce: "off",
    requiresProvenance: true
  },
  suggested: {
    axis: "origin",
    label: "Suggested",
    meaning: "This value is a recommendation only.",
    priority: 100,
    tone: "suggestion",
    announce: "off",
    requiresProvenance: true
  },
  prepopulated: {
    axis: "origin",
    label: "Prepopulated",
    meaning: "This value was staged from another source but is not yet confirmed.",
    priority: 110,
    tone: "information",
    announce: "off",
    requiresProvenance: true
  },
  historical_imported: {
    axis: "origin",
    label: "Historical/imported",
    meaning: "Source truth is preserved but was not established by QuotePilot.",
    priority: 190,
    tone: "historical",
    announce: "off",
    requiresProvenance: true
  },
  draft: {
    axis: "editability",
    label: "Draft",
    meaning: "The user edited this value, but it has not been persisted.",
    priority: 90,
    tone: "information",
    announce: "polite"
  },
  blocked: {
    axis: "editability",
    label: "Blocked",
    meaning: "This action cannot proceed until another condition is resolved.",
    priority: 20,
    tone: "warning",
    announce: "assertive",
    requiresReason: true,
    requiresRecovery: true
  },
  read_only: {
    axis: "editability",
    label: "Read-only",
    meaning: "The user may inspect this value but not modify it.",
    priority: 170,
    tone: "quiet",
    announce: "off"
  },
  protected: {
    axis: "editability",
    label: "Protected",
    meaning: "This state exists but must not be changed through this surface.",
    priority: 160,
    tone: "quiet",
    announce: "off"
  },
  saving: {
    axis: "persistence",
    label: "Saving",
    meaning: "An authoritative write is in progress.",
    priority: 40,
    tone: "progress",
    announce: "polite"
  },
  saved: {
    axis: "persistence",
    label: "Saved",
    meaning: "The server confirmed persistence.",
    priority: 180,
    tone: "confirmed",
    announce: "polite"
  },
  published: {
    axis: "persistence",
    label: "Published",
    meaning: "This configuration is now active.",
    priority: 70,
    tone: "confirmed",
    announce: "polite"
  },
  pending: {
    axis: "evidence",
    label: "Pending",
    meaning: "The external or server outcome is not established yet.",
    priority: 50,
    tone: "progress",
    announce: "polite"
  },
  confirmed: {
    axis: "evidence",
    label: "Confirmed",
    meaning: "Authoritative evidence exists.",
    priority: 80,
    tone: "confirmed",
    announce: "polite"
  },
  failed: {
    axis: "evidence",
    label: "Failed",
    meaning: "The attempted action failed.",
    priority: 10,
    tone: "failure",
    announce: "assertive",
    requiresReason: true,
    requiresRecovery: true
  },
  stale: {
    axis: "evidence",
    label: "Stale",
    meaning: "This value or evidence was valid against an older revision.",
    priority: 60,
    tone: "warning",
    announce: "polite",
    requiresReason: true,
    requiresRecovery: true
  }
};

export const FIELD_STATE_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFINITIONS).map(([id, definition]) => [
      id,
      Object.freeze({ id, ...definition })
    ])
  )
);

export const FIELD_STATE_PRIMARY_ORDER = Object.freeze(
  Object.values(FIELD_STATE_DEFINITIONS)
    .sort((left, right) => left.priority - right.priority)
    .map((definition) => definition.id)
);

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRecoveryAction(recoveryAction) {
  return Boolean(
    recoveryAction
      && isNonEmptyText(recoveryAction.label)
      && (
        typeof recoveryAction.onClick === "function"
        || isNonEmptyText(recoveryAction.href)
      )
  );
}

export function normalizeFieldState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("Field state must be an object with named state axes.");
  }

  const source = state.axes && typeof state.axes === "object" ? state.axes : state;
  const unexpectedAxes = Object.keys(source).filter((axis) => !(axis in FIELD_STATE_AXES));
  if (unexpectedAxes.length > 0) {
    throw new RangeError(`Unknown field-state axes: ${unexpectedAxes.join(", ")}.`);
  }
  const normalized = {};

  for (const [axis, allowedStates] of Object.entries(FIELD_STATE_AXES)) {
    const value = source[axis];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !allowedStates.includes(value)) {
      throw new RangeError(
        `Invalid ${axis} field state "${String(value)}". Expected one of: ${allowedStates.join(", ")}.`
      );
    }
    normalized[axis] = value;
  }

  return Object.freeze(normalized);
}

export function getFieldStateEntries(state) {
  const normalized = normalizeFieldState(state);
  return Object.entries(normalized).map(([axis, id]) => ({
    axis,
    ...FIELD_STATE_DEFINITIONS[id]
  }));
}

export function getPrimaryFieldState(state, { primaryState } = {}) {
  const entries = getFieldStateEntries(state);
  if (entries.length === 0) return null;

  if (primaryState !== undefined) {
    const selected = entries.find((entry) => entry.id === primaryState);
    if (!selected) {
      throw new RangeError(`Primary field state "${primaryState}" is not active on this field.`);
    }
    return selected;
  }

  return [...entries].sort((left, right) => left.priority - right.priority)[0];
}

export function validateFieldState(state, details = {}) {
  const issues = [];
  let entries = [];

  try {
    entries = getFieldStateEntries(state);
  } catch (error) {
    return [{
      code: "invalid_state",
      message: error instanceof Error ? error.message : "Field state is invalid."
    }];
  }

  if (entries.length === 0) {
    issues.push({
      code: "state_required",
      message: "At least one non-baseline field state is required."
    });
    return issues;
  }

  if (details.primaryState !== undefined && !entries.some((entry) => entry.id === details.primaryState)) {
    issues.push({
      code: "inactive_primary_state",
      state: details.primaryState,
      message: `Primary field state "${details.primaryState}" is not active on this field.`
    });
  }

  for (const entry of entries) {
    const reason = details.reasons?.[entry.id] || details.reason;
    if (entry.requiresReason && !isNonEmptyText(reason)) {
      issues.push({
        axis: entry.axis,
        code: "reason_required",
        state: entry.id,
        message: `${entry.label} requires a visible reason.`
      });
    }
    if (entry.requiresProvenance && !isNonEmptyText(details.provenance)) {
      issues.push({
        axis: entry.axis,
        code: "provenance_required",
        state: entry.id,
        message: `${entry.label} requires visible source provenance.`
      });
    }
    if (entry.requiresRecovery && !hasRecoveryAction(details.recoveryAction)) {
      issues.push({
        axis: entry.axis,
        code: "recovery_required",
        state: entry.id,
        message: `${entry.label} requires one nearby recovery action.`
      });
    }
  }

  return issues;
}

export function assertFieldState(state, details = {}) {
  const issues = validateFieldState(state, details);
  if (issues.length > 0) {
    const error = new Error(issues.map((issue) => issue.message).join(" "));
    error.name = "FieldStateContractError";
    error.issues = issues;
    throw error;
  }
  return normalizeFieldState(state);
}

export function buildFieldStatePresentation(state, details = {}) {
  const normalized = assertFieldState(state, details);
  const entries = getFieldStateEntries(normalized);
  const primary = getPrimaryFieldState(normalized, details);
  const supporting = entries
    .filter((entry) => entry.id !== primary.id)
    .sort((left, right) => left.priority - right.priority);

  return Object.freeze({
    axes: normalized,
    primary,
    supporting: Object.freeze(supporting)
  });
}
