export const QUOTE_COMPLETION_CONTRACT_VERSION = "quote-completion-contract-v1";

const COMPLETION_STATES = new Set([
  "blocked",
  "review_required",
  "sendable",
  "sent",
  "accepted"
]);
const COMMAND_STATES = new Set([
  "idle",
  "loading",
  "success",
  "failure",
  "stale",
  "recovery"
]);

const BLOCKER_ALIASES = Object.freeze({
  "customer-name": "client-name",
  "customer-email": "client-email",
  "event-time": "event-time",
  duration: "duration",
  package: "package",
  menu: "menu-selection",
  total: "calculated-total"
});

const DESTINATIONS = Object.freeze({
  "client-name": Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "customer",
    selector: '[data-ambient-action-id="pc-edit-client-name"]',
    activate: true
  }),
  "client-email": Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "customer",
    selector: '[data-ambient-action-id="pc-edit-client-email"]',
    activate: true
  }),
  "client-email-format": Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "customer",
    selector: '[data-ambient-action-id="pc-edit-client-email"]',
    activate: true
  }),
  "event-name": Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "event",
    selector: '[data-ambient-action-id="pc-edit-event-name"]',
    activate: true
  }),
  "event-type": Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "event",
    selector: "#proposal-event-type"
  }),
  "event-date": Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "event",
    selector: '[data-ambient-action-id="pc-edit-date"]',
    activate: true
  }),
  "event-time": Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "event",
    selector: '[data-ambient-action-id="pc-edit-time"]',
    activate: true
  }),
  venue: Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "event",
    selector: '[data-ambient-action-id="pc-edit-venue"]',
    activate: true
  }),
  "guest-count": Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "event",
    selector: '[data-ambient-action-id="pc-edit-guests"]',
    activate: true
  }),
  duration: Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "event",
    selector: '[data-ambient-action-id="pc-edit-hours"]',
    activate: true
  }),
  package: Object.freeze({
    surfaceId: "proposal-composer",
    step: 1,
    domainId: "experience",
    selector: '[data-testid="pc-edit-experience"]',
    activate: true
  }),
  "menu-selection": Object.freeze({
    surfaceId: "proposal-composer",
    step: 2,
    domainId: "experience",
    selector: '[data-testid="pc-edit-menu"]',
    focusSelector: "#pc-menu-search",
    activate: true
  }),
  "calculated-total": Object.freeze({
    surfaceId: "proposal-composer",
    step: 4,
    domainId: "commercials",
    selector: '[data-testid="pc-save-readiness"]'
  }),
  "catalog-loading": Object.freeze({
    surfaceId: "proposal-composer",
    domainId: "experience",
    selector: '[data-testid="pc-save-readiness"]'
  }),
  "quote-edit-loading": Object.freeze({
    surfaceId: "proposal-composer",
    domainId: "commercials",
    selector: '[data-testid="pc-save-readiness"]'
  }),
  "pilot-scenario-review": Object.freeze({
    surfaceId: "proposal-composer",
    domainId: "commercials",
    selector: '[data-ambient-pilot-scenario-review="available"]'
  }),
  "draft-intent-review": Object.freeze({
    surfaceId: "proposal-composer",
    domainId: "experience",
    selector: '[data-ambient-draft-intent-review="package_menu"]'
  }),
  "change-impact-review": Object.freeze({
    surfaceId: "proposal-composer",
    domainId: "commercials",
    selector: '[data-capability-id="commercial-scenario-workbench"] .csw-review-button'
  }),
  "change-impact-authorization": Object.freeze({
    surfaceId: "proposal-composer",
    domainId: "commercials",
    selector: '[data-capability-id="cwf-15c-commercial-change-authority"]'
  })
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clonePresentationValue(value) {
  if (Array.isArray(value)) return value.map(clonePresentationValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, clonePresentationValue(nested)])
  );
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalBlockerId(value) {
  const id = text(value).toLowerCase();
  return BLOCKER_ALIASES[id] || id || "unknown";
}

function objectContext(quote = {}) {
  return {
    quoteId: text(quote?.id || quote?.quoteId) || null,
    revisionId: text(
      quote?.activeVersionId
      || quote?.versionMeta?.versionId
      || quote?.updatedAtISO
    ) || null
  };
}

function actionLabelForBlocker(blocker) {
  const message = text(blocker?.message || blocker?.label).replace(/[.!?]+$/u, "");
  if (!message) return "Review requirement";
  return message.replace(/^Add the /u, "Add ").replace(/^Correct the /u, "Correct ");
}

function normalizeBlocker(raw, source) {
  const id = canonicalBlockerId(raw?.id);
  const destination = clonePresentationValue(raw?.destination || DESTINATIONS[id] || {
    surfaceId: source === "proposal" ? "quote-review" : "proposal-composer",
    step: source === "proposal" ? 4 : undefined,
    selector: '[data-testid="pc-save-readiness"]'
  });
  return {
    id,
    label: text(raw?.message || raw?.label) || "Review this requirement.",
    source,
    evidenceState: text(raw?.evidenceState) || "missing",
    destination
  };
}

function normalizeConfiguredActions(input) {
  if (!input || typeof input !== "object") return null;
  if (input.actionState && typeof input.actionState === "object") return input.actionState;
  return input;
}

function normalizeLivingOpportunity(input) {
  const source = input?.projection || input?.proposalObject || input;
  const rawState = text(source?.state).toLowerCase();
  const explicitBlockingStates = new Set([
    "missing",
    "stale",
    "contradictory",
    "unavailable",
    "not_yet_available",
    "schema_drift",
    "blocked_by_integration"
  ]);
  const state = explicitBlockingStates.has(rawState)
    ? rawState
    : ["loading", "awaiting_preview"].includes(rawState)
      ? "not_yet_available"
      : ["partial", "needs_resolution"].includes(rawState)
        ? "partial"
        : ["failed", "failure", "error", "unavailable", "local_preview"].includes(rawState)
          ? "unavailable"
          : ["unchanged"].includes(rawState)
            ? "not_applicable"
            : ["ready", "applied", "current", "available"].includes(rawState)
              ? "available"
              : "not_provided";
  const blocking = [
    ...explicitBlockingStates,
    "partial"
  ].includes(state);
  const reason = text(
    source?.reason
    || source?.provenance?.previewError
    || source?.descriptor?.confidence?.basis
    || source?.boundary
  ) || (blocking
    ? "The current Living Opportunity evidence must be reviewed before this projection can pass."
    : "No additional Living Opportunity evidence is required for this state.");
  return {
    state,
    sourceState: rawState || "not_provided",
    blocking,
    reason,
    recoveryLabel: text(source?.nextAction?.label) || "Review current evidence"
  };
}

function normalizeCommand(command) {
  const raw = typeof command === "string" ? { state: command } : command || {};
  const state = COMMAND_STATES.has(text(raw.state).toLowerCase())
    ? text(raw.state).toLowerCase()
    : "idle";
  return {
    state,
    message: text(raw.message),
    recovery: raw.recovery && typeof raw.recovery === "object"
      ? {
          label: text(raw.recovery.label) || "Try again",
          actionId: text(raw.recovery.actionId) || null
        }
      : null
  };
}

function configuredNextAction(action, context) {
  const id = text(action?.id) || "review_quote";
  return {
    id,
    kind: id === "send_quote"
      ? "send_proposal"
      : id === "review_delivery"
        ? "recover_delivery"
        : "configured_action",
    label: text(action?.label || action?.outcomeLabel) || "Review quote",
    enabled: action?.enabled !== false,
    reason: text(action?.disabledReason || action?.consequence),
    objectContext: context,
    destination: {
      surfaceId: "quote-administration",
      actionId: id,
      quoteId: context.quoteId
    }
  };
}

function selectNextAction({
  state,
  blockerGroups,
  actionState,
  context,
  draftDirty,
  saveRevisionDestination,
  saveRevisionLabel
}) {
  if (["accepted", "sent"].includes(state)) {
    if (actionState?.primaryAction && actionState.primaryAction.visible !== false) {
      return configuredNextAction(actionState.primaryAction, context);
    }
    const accepted = state === "accepted";
    return {
      id: accepted ? "review_acceptance" : "review_delivery",
      kind: "review_proposal",
      label: accepted ? "Review accepted quote" : "Review delivery",
      enabled: true,
      reason: accepted
        ? "The accepted revision remains immutable; review its existing record."
        : "Review the provider-accepted delivery record.",
      objectContext: context,
      destination: {
        surfaceId: "quote-administration",
        actionId: accepted ? "review_acceptance" : "review_delivery",
        quoteId: context.quoteId
      }
    };
  }
  const firstBlocker = blockerGroups[0]?.blockers?.[0];
  if (firstBlocker) {
    const isLivingEvidence = firstBlocker.source === "living_opportunity";
    const isDeliveryEvidence = firstBlocker.source === "configured_actions";
    return {
      id: isLivingEvidence
        ? "recover:living-opportunity"
        : isDeliveryEvidence
          ? "recover:delivery"
          : `resolve:${firstBlocker.id}`,
      kind: isLivingEvidence
        ? "recover_evidence"
        : isDeliveryEvidence
          ? "recover_delivery"
          : "resolve_field",
      label: firstBlocker.actionLabel || actionLabelForBlocker(firstBlocker),
      enabled: true,
      reason: firstBlocker.label,
      objectContext: context,
      destination: firstBlocker.destination
    };
  }
  if (draftDirty || actionState?.state?.versionSaved !== true) {
    return {
      id: "save_exact_revision",
      kind: "save_revision",
      label: text(saveRevisionLabel) || "Save exact revision",
      enabled: true,
      reason: "Sending requires an exact saved proposal revision.",
      objectContext: context,
      destination: clonePresentationValue(saveRevisionDestination || {
        surfaceId: "proposal-composer",
        actionId: "save_quote",
        quoteId: context.quoteId
      })
    };
  }
  if (state === "sendable") {
    return configuredNextAction(actionState.actions.send_quote, context);
  }
  if (actionState?.primaryAction) return configuredNextAction(actionState.primaryAction, context);
  return {
    id: "review_proposal",
    kind: "review_proposal",
    label: "Review proposal",
    enabled: true,
    reason: "Review the exact proposal and its current evidence before continuing.",
    objectContext: context,
    destination: {
      surfaceId: "quote-review",
      step: 4,
      quoteId: context.quoteId
    }
  };
}

export function buildQuoteCompletionProjection({
  quote = {},
  readiness = null,
  saveBlockers = [],
  configuredActions = null,
  livingOpportunity = null,
  draftDirty = false,
  command = null,
  saveRevisionDestination = null,
  saveRevisionLabel = ""
} = {}) {
  const context = objectContext(quote);
  const actionState = normalizeConfiguredActions(configuredActions);
  const livingEvidence = normalizeLivingOpportunity(livingOpportunity);
  const seen = new Set();
  const draftBlockers = [];
  const proposalBlockers = [];

  (Array.isArray(saveBlockers) ? saveBlockers : []).forEach((raw) => {
    const blocker = normalizeBlocker(raw, "draft");
    if (seen.has(blocker.id)) return;
    seen.add(blocker.id);
    draftBlockers.push(blocker);
  });
  (Array.isArray(readiness?.gaps) ? readiness.gaps : []).forEach((raw) => {
    const blocker = normalizeBlocker(raw, "proposal");
    if (seen.has(blocker.id)) return;
    seen.add(blocker.id);
    proposalBlockers.push(blocker);
  });

  const blockerGroups = [];
  if (draftBlockers.length) {
    blockerGroups.push({ id: "draft", label: "Draft requirements", blockers: draftBlockers });
  }
  if (proposalBlockers.length) {
    blockerGroups.push({ id: "proposal", label: "Proposal requirements", blockers: proposalBlockers });
  }
  if (livingEvidence.blocking) {
    blockerGroups.push({
      id: "evidence",
      label: "Current evidence",
      blockers: [{
        id: "living-opportunity-evidence",
        label: livingEvidence.reason,
        actionLabel: livingEvidence.recoveryLabel,
        source: "living_opportunity",
        evidenceState: livingEvidence.state,
        destination: {
          surfaceId: "living-opportunity",
          objectId: "proposal",
          actionId: "inspect-proposal",
          quoteId: context.quoteId
        }
      }]
    });
  }

  const sendAction = actionState?.actions?.send_quote;
  if (
    blockerGroups.length === 0
    && readiness?.complete === true
    && sendAction?.visible === true
    && sendAction?.enabled === false
  ) {
    blockerGroups.push({
      id: "delivery",
      label: "Delivery path",
      blockers: [{
        id: "send-proposal-unavailable",
        label: text(sendAction.disabledReason) || "The configured proposal delivery action is unavailable.",
        actionLabel: "Review proposal controls",
        source: "configured_actions",
        evidenceState: "blocked",
        destination: {
          surfaceId: "quote-administration",
          actionId: sendAction.id || "send_quote",
          quoteId: context.quoteId
        }
      }]
    });
  }

  const lifecycleStatus = text(quote?.status).toLowerCase();
  const providerAccepted = actionState?.state?.providerAccepted === true;
  const exactRevisionSaved = draftDirty !== true && actionState?.state?.versionSaved === true;
  const state = ["accepted", "booked"].includes(lifecycleStatus)
    ? "accepted"
    : blockerGroups.length > 0
      ? "blocked"
      : !exactRevisionSaved
        ? "review_required"
        : providerAccepted
          ? "sent"
          : readiness?.complete === true
            && sendAction?.visible === true
            && sendAction?.enabled === true
            ? "sendable"
            : "review_required";
  const boundedState = COMPLETION_STATES.has(state) ? state : "review_required";
  const projection = {
    schemaVersion: QUOTE_COMPLETION_CONTRACT_VERSION,
    authority: "presentation_only_projection",
    state: boundedState,
    objectContext: context,
    compatibility: {
      percentage: Number.isFinite(Number(readiness?.score))
        ? Math.max(0, Math.min(100, Math.round(Number(readiness.score))))
        : null,
      authority: "compatibility_only"
    },
    blockerGroups,
    nextAction: selectNextAction({
      state: boundedState,
      blockerGroups,
      actionState,
      context,
      draftDirty,
      saveRevisionDestination,
      saveRevisionLabel
    }),
    command: normalizeCommand(command),
    evidence: {
      readiness: {
        state: readiness?.complete === true
          ? "available"
          : Array.isArray(readiness?.gaps)
            ? "missing"
            : "not_yet_available",
        requiredGapCount: Array.isArray(readiness?.gaps) ? readiness.gaps.length : null,
        recommendedGapCount: Array.isArray(readiness?.recommendedGaps)
          ? readiness.recommendedGaps.length
          : null
      },
      save: {
        state: draftBlockers.length ? "blocked" : draftDirty ? "draft" : "unchanged",
        blockerCount: draftBlockers.length
      },
      configuredActions: {
        state: actionState ? "available" : "not_yet_available",
        modelId: text(actionState?.modelId) || null,
        providerAccepted
      },
      livingOpportunity: livingEvidence
    },
    boundary: "This contract selects presentation state and one next action only. Existing quote, pricing, save, delivery, portal, acceptance, payment, and operational authorities remain unchanged."
  };
  return deepFreeze(projection);
}

export default buildQuoteCompletionProjection;
