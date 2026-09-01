export const QUICK_UPDATES_MODEL_ID = "quick-updates-state-v1";

export const QUICK_UPDATES_PHASE = Object.freeze({
  CLOSED: "closed",
  CLEAN: "clean",
  DIRTY: "dirty",
  REVIEW: "review",
  SAVING: "saving",
  REFRESHING: "refreshing",
  SAVED: "saved",
  FAILURE: "failure",
  CONFLICT: "conflict",
  UNCERTAIN: "uncertain"
});

const DISMISS_REASONS = new Set([
  "close",
  "cancel",
  "escape",
  "backdrop",
  "navigation",
  "library",
  "staffing",
  "pricing",
  "editor",
  "workspace_switch",
  "browser_back",
  "browser_forward"
]);

function cleanText(value, maximum = 160) {
  return String(value == null ? "" : value).trim().slice(0, maximum);
}

export function normalizeQuickUpdateStyle(value) {
  return cleanText(value, 64);
}

export function quickUpdateStyleLabel(value) {
  const style = normalizeQuickUpdateStyle(value);
  if (style.toLowerCase() === "plated") return "Plated dinner";
  return style || "Not recorded";
}

export function createQuickUpdatesState({ savedStyle = "" } = {}) {
  const style = normalizeQuickUpdateStyle(savedStyle);
  return {
    modelId: QUICK_UPDATES_MODEL_ID,
    phase: QUICK_UPDATES_PHASE.CLOSED,
    savedStyle: style,
    draftStyle: style,
    previewPending: false,
    preview: null,
    reviewDelta: null,
    error: "",
    recoveryPhase: QUICK_UPDATES_PHASE.DIRTY,
    recoveryAction: "",
    recoveryLabel: "",
    retryable: true,
    dismissal: null,
    receipt: null
  };
}

export function buildQuickUpdatesDelta({ savedStyle = "", draftStyle = "" } = {}) {
  const before = normalizeQuickUpdateStyle(savedStyle);
  const after = normalizeQuickUpdateStyle(draftStyle);
  if (!before || !after || before === after) return [];
  return [{
    fieldPath: "event.style",
    label: "Service style",
    before,
    after,
    beforeLabel: quickUpdateStyleLabel(before),
    afterLabel: quickUpdateStyleLabel(after)
  }];
}

export function normalizeQuickUpdatesReviewDelta(delta, expectedDelta) {
  const expected = Array.isArray(expectedDelta) ? expectedDelta[0] : null;
  const received = Array.isArray(delta) ? delta : [];
  if (!expected || received.length !== 1) return null;
  const candidate = received[0] || {};
  const fieldPath = cleanText(candidate.fieldPath || candidate.path, 80);
  const before = normalizeQuickUpdateStyle(candidate.before);
  const after = normalizeQuickUpdateStyle(candidate.after);
  if (
    fieldPath !== "event.style"
    || before !== expected.before
    || after !== expected.after
  ) {
    return null;
  }
  return [{
    ...expected,
    beforeLabel: cleanText(candidate.beforeLabel, 80) || expected.beforeLabel,
    afterLabel: cleanText(candidate.afterLabel, 80) || expected.afterLabel
  }];
}

export function normalizeQuickUpdatesPersistedEffects(effects, request) {
  if (!effects || typeof effects !== "object" || Array.isArray(effects)) return null;
  const expectedDelta = Array.isArray(request?.delta) ? request.delta[0] : null;
  const delta = Array.isArray(effects.requestedDelta) ? effects.requestedDelta : [];
  const pricing = effects.pricing || {};
  const total = pricing.authoritativeTotal || {};
  const deposit = pricing.depositRequirement || {};
  const version = effects.version || {};
  const status = effects.status || {};
  const identity = effects.identity || {};
  const portal = effects.portal || {};
  const proposal = effects.proposal || {};
  const lifecycle = effects.lifecycle || {};
  const dependencies = effects.dependencies || {};
  const staffingBefore = effects.staffing?.before || {};
  const staffingAfter = effects.staffing?.after || {};
  const staffingFields = ["servers", "chefs", "bartenders"];
  const validStaffingCount = (value) => (
    value === null
    || (Number.isSafeInteger(value) && value >= 0 && value <= 10_000)
  );
  const moneyValues = [
    total.before,
    total.proposedAfter,
    deposit.before,
    deposit.proposedAfter
  ];
  if (
    effects.schemaVersion !== "commercial-change-persisted-effects-v1"
    || effects.authority !== "server_authoritative"
    || effects.source !== "trusted_quote_edit_material_projection"
    || identity.organizationId !== request?.organizationId
    || identity.quoteId !== request?.quoteId
    || identity.baseRevisionId !== request?.baseRevisionId
    || !cleanText(identity.projectedRevisionId, 256)
    || delta.length !== 1
    || delta[0]?.fieldPath !== "event.style"
    || cleanText(delta[0]?.before, 64) !== cleanText(expectedDelta?.before, 64)
    || cleanText(delta[0]?.after, 64) !== cleanText(expectedDelta?.after, 64)
    || cleanText(pricing.currency, 8) !== "USD"
    || moneyValues.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)
    || total.changed !== (Number(total.before) !== Number(total.proposedAfter))
    || deposit.changed !== (Number(deposit.before) !== Number(deposit.proposedAfter))
    || staffingFields.some((field) => !validStaffingCount(staffingBefore[field]))
    || staffingFields.some((field) => !validStaffingCount(staffingAfter[field]))
    || effects.staffing?.changed !== staffingFields.some(
      (field) => staffingBefore[field] !== staffingAfter[field]
    )
    || status.before !== "draft"
    || status.after !== "draft"
    || status.changed !== false
    || version.beforeRevisionId !== request?.baseRevisionId
    || version.afterRevisionId !== identity.projectedRevisionId
    || !Number.isSafeInteger(Number(version.beforeVersionNumber))
    || !Number.isSafeInteger(Number(version.afterVersionNumber))
    || Number(version.afterVersionNumber) !== Number(version.beforeVersionNumber) + 1
    || version.createsImmutableVersion !== true
    || proposal.statusBefore !== status.before
    || proposal.statusAfter !== status.after
    || proposal.workflowEvidencePreserved !== true
    || proposal.customerDeliveryTriggered !== false
    || proposal.publicationTriggered !== false
    || portal.activeRevisionIdBefore !== version.beforeRevisionId
    || portal.activeRevisionIdAfter !== version.afterRevisionId
    || portal.projectionRefreshed !== true
    || portal.accessIdentityRetained !== true
    || portal.issuanceRecordedAtSave !== true
    || portal.expiryRecalculatedAtSave !== true
    || portal.customerDeliveryTriggered !== false
    || lifecycle.editedAtRecordedAtSave !== true
    || lifecycle.terminalDecisionEvidencePreserved !== true
    || lifecycle.draftAtPreserved === lifecycle.draftAtAssignedIfMissing
    || typeof dependencies.authorizationRequired !== "boolean"
    || !dependencies.impact
    || typeof dependencies.impact !== "object"
  ) {
    return null;
  }
  return {
    ...effects,
    identity: { ...identity },
    requestedDelta: delta.map((item) => ({ ...item })),
    pricing: {
      ...pricing,
      authoritativeTotal: { ...total },
      depositRequirement: { ...deposit }
    },
    staffing: {
      ...effects.staffing,
      before: { ...staffingBefore },
      after: { ...staffingAfter }
    },
    status: { ...status },
    version: {
      ...version,
      beforeVersionNumber: Number(version.beforeVersionNumber),
      afterVersionNumber: Number(version.afterVersionNumber)
    },
    proposal: { ...proposal },
    portal: { ...portal },
    lifecycle: { ...lifecycle },
    dependencies: {
      ...dependencies,
      impact: { ...dependencies.impact }
    }
  };
}

export function buildQuickUpdatesRequest({ quote = {}, savedStyle = "", draftStyle = "" } = {}) {
  const quoteId = cleanText(quote.id || quote.quoteId, 180);
  const organizationId = cleanText(quote.organizationId, 180);
  const baseRevisionId = cleanText(
    quote.activeVersionId || quote.versionMeta?.versionId,
    240
  );
  const delta = buildQuickUpdatesDelta({ savedStyle, draftStyle });
  if (!quoteId || !organizationId || !baseRevisionId || delta.length !== 1) return null;
  return {
    modelId: "quick-updates-request-v1",
    source: "quick_updates",
    scope: "event.service_style",
    quoteId,
    organizationId,
    baseRevisionId,
    patch: {
      event: {
        style: delta[0].after
      }
    },
    delta
  };
}

export function isQuickUpdatesBusy(state) {
  return [QUICK_UPDATES_PHASE.SAVING, QUICK_UPDATES_PHASE.REFRESHING]
    .includes(state?.phase);
}

export function hasQuickUpdatesDraft(state) {
  return buildQuickUpdatesDelta(state).length === 1;
}

export function shouldGuardQuickUpdatesDismissal(state) {
  return Boolean(
    state
    && !isQuickUpdatesBusy(state)
    && hasQuickUpdatesDraft(state)
    && state.phase !== QUICK_UPDATES_PHASE.SAVED
    && state.phase !== QUICK_UPDATES_PHASE.CLOSED
  );
}

function withFailure(state, event, fallbackPhase) {
  return {
    ...state,
    phase: event.phase,
    previewPending: false,
    error: cleanText(event.error, 500) || "The Quick Updates request did not complete.",
    recoveryPhase: event.recoveryPhase || fallbackPhase,
    recoveryAction: cleanText(event.recoveryAction, 80),
    recoveryLabel: cleanText(event.recoveryLabel, 120),
    retryable: event.retryable !== false,
    dismissal: null
  };
}

export function quickUpdatesReducer(state, event = {}) {
  const current = state || createQuickUpdatesState();
  switch (event.type) {
    case "OPEN": {
      const savedStyle = normalizeQuickUpdateStyle(event.savedStyle);
      return {
        ...createQuickUpdatesState({ savedStyle }),
        phase: QUICK_UPDATES_PHASE.CLEAN
      };
    }
    case "EDIT_STYLE": {
      if (isQuickUpdatesBusy(current)) return current;
      const draftStyle = normalizeQuickUpdateStyle(event.value);
      return {
        ...current,
        phase: draftStyle && draftStyle !== current.savedStyle
          ? QUICK_UPDATES_PHASE.DIRTY
          : QUICK_UPDATES_PHASE.CLEAN,
        draftStyle,
        previewPending: false,
        preview: null,
        reviewDelta: null,
        error: "",
        recoveryAction: "",
        recoveryLabel: "",
        retryable: true,
        dismissal: null,
        receipt: null
      };
    }
    case "REVIEW_REQUEST":
      if (current.phase !== QUICK_UPDATES_PHASE.DIRTY || !hasQuickUpdatesDraft(current)) return current;
      return {
        ...current,
        previewPending: true,
        error: "",
        recoveryAction: "",
        recoveryLabel: "",
        retryable: true,
        dismissal: null
      };
    case "REVIEW_READY":
      if (!current.previewPending || !Array.isArray(event.delta) || event.delta.length !== 1) return current;
      return {
        ...current,
        phase: QUICK_UPDATES_PHASE.REVIEW,
        previewPending: false,
        preview: event.preview || null,
        reviewDelta: event.delta,
        error: "",
        recoveryAction: "",
        recoveryLabel: "",
        retryable: true,
        dismissal: null
      };
    case "BACK_TO_EDIT":
      if (isQuickUpdatesBusy(current)) return current;
      return {
        ...current,
        phase: hasQuickUpdatesDraft(current)
          ? QUICK_UPDATES_PHASE.DIRTY
          : QUICK_UPDATES_PHASE.CLEAN,
        previewPending: false,
        error: "",
        recoveryAction: "",
        recoveryLabel: "",
        retryable: true,
        dismissal: null
      };
    case "SAVE_REQUEST":
      if (current.phase !== QUICK_UPDATES_PHASE.REVIEW || !current.reviewDelta) return current;
      return {
        ...current,
        phase: QUICK_UPDATES_PHASE.SAVING,
        error: "",
        dismissal: null
      };
    case "PERSISTED":
      if (current.phase !== QUICK_UPDATES_PHASE.SAVING) return current;
      return {
        ...current,
        phase: QUICK_UPDATES_PHASE.REFRESHING,
        receipt: event.receipt || null,
        error: ""
      };
    case "SAVED":
      if (![QUICK_UPDATES_PHASE.SAVING, QUICK_UPDATES_PHASE.REFRESHING].includes(current.phase)) return current;
      return {
        ...current,
        phase: QUICK_UPDATES_PHASE.SAVED,
        savedStyle: current.draftStyle,
        previewPending: false,
        error: "",
        dismissal: null,
        receipt: event.receipt || current.receipt || null
      };
    case "FAILURE":
      return withFailure(current, {
        ...event,
        phase: QUICK_UPDATES_PHASE.FAILURE
      }, current.reviewDelta ? QUICK_UPDATES_PHASE.REVIEW : QUICK_UPDATES_PHASE.DIRTY);
    case "CONFLICT":
      return withFailure(current, {
        ...event,
        phase: QUICK_UPDATES_PHASE.CONFLICT
      }, QUICK_UPDATES_PHASE.REVIEW);
    case "UNCERTAIN":
      return withFailure(current, {
        ...event,
        phase: QUICK_UPDATES_PHASE.UNCERTAIN
      }, QUICK_UPDATES_PHASE.REVIEW);
    case "REQUEST_DISMISS": {
      if (isQuickUpdatesBusy(current)) return current;
      const reason = DISMISS_REASONS.has(event.reason) ? event.reason : "close";
      if (!shouldGuardQuickUpdatesDismissal(current)) {
        return { ...current, phase: QUICK_UPDATES_PHASE.CLOSED, dismissal: null };
      }
      return {
        ...current,
        dismissal: { reason }
      };
    }
    case "KEEP_EDITING":
      if (
        current.recoveryAction === "open_editor"
        && current.recoveryPhase === QUICK_UPDATES_PHASE.DIRTY
        && hasQuickUpdatesDraft(current)
      ) {
        return {
          ...current,
          phase: QUICK_UPDATES_PHASE.DIRTY,
          previewPending: false,
          error: "",
          recoveryAction: "",
          recoveryLabel: "",
          retryable: true,
          dismissal: null
        };
      }
      return { ...current, dismissal: null };
    case "DISCARD":
      return {
        ...createQuickUpdatesState({ savedStyle: current.savedStyle }),
        phase: QUICK_UPDATES_PHASE.CLOSED
      };
    case "CLOSE":
      if (isQuickUpdatesBusy(current)) return current;
      return { ...current, phase: QUICK_UPDATES_PHASE.CLOSED, dismissal: null };
    default:
      return current;
  }
}
