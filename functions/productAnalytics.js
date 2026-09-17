const { createHash } = require("node:crypto");

const ANALYTICS_EVENT_NAMES = new Set([
  "wizard_started",
  "wizard_step_completed",
  "addon_selected",
  "addon_removed",
  "quote_saved",
  "first_intent_observed",
  "priced_draft_receipt_observed",
  "ambient_primary_action_assessed",
  "ambient_issue_surfaced",
  "ambient_issue_resolved",
  "quote_completion_action_shown",
  "quote_completion_action_resolved",
  "quote_completion_sendable_reached",
  "post_event_learning_proposed",
  "post_event_learning_applied"
]);
const AMBIENT_RESULT_KINDS = new Set([
  "context",
  "preview",
  "pending",
  "receipt",
  "resolved",
  "recovery"
]);
const PRODUCT_ANALYTICS_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const PRODUCT_ANALYTICS_MAX_ACKNOWLEDGEMENT_MS = 60 * 1000;
const PRODUCT_ANALYTICS_DEAD_CLICK_DEADLINE_MS = 250;
const PRODUCT_ANALYTICS_ISSUE_CATEGORIES = Object.freeze([
  "workflow-attention",
  "proposal-gap-customer-name",
  "proposal-gap-customer-email",
  "proposal-gap-customer-phone",
  "proposal-gap-event-name",
  "proposal-gap-event-date",
  "proposal-gap-event-time",
  "proposal-gap-venue",
  "proposal-gap-guest-count",
  "proposal-gap-duration",
  "proposal-gap-package",
  "proposal-gap-menu",
  "proposal-gap-total",
  "staffing-guidance"
]);
const ISSUE_CATEGORIES = new Set(PRODUCT_ANALYTICS_ISSUE_CATEGORIES);
const QUOTE_COMPLETION_STATES = new Set([
  "blocked",
  "review_required",
  "sendable",
  "sent",
  "accepted"
]);
const QUOTE_COMPLETION_ACTION_KINDS = new Set([
  "resolve_field",
  "recover_evidence",
  "save_revision",
  "send_proposal",
  "recover_delivery",
  "configured_action",
  "review_proposal"
]);
const QUOTE_COMPLETION_SURFACES = new Set([
  "proposal_composer",
  "review",
  "living_opportunity"
]);
const QUOTE_COMPLETION_RESULTS = new Set(["success", "failure", "stale", "recovery"]);

class ProductAnalyticsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProductAnalyticsError";
    this.code = code;
  }
}

function text(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function requireIdentifier(value, label, max = 80) {
  const normalized = String(value || "").trim();
  if (
    !normalized
    || normalized.length > max
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    throw new ProductAnalyticsError("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function requireInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === "") {
    throw new ProductAnalyticsError("invalid-argument", `${label} is invalid.`);
  }
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < min || normalized > max) {
    throw new ProductAnalyticsError("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function requireIssueCategory(value) {
  const normalized = text(value, 64).toLowerCase();
  if (!ISSUE_CATEGORIES.has(normalized)) {
    throw new ProductAnalyticsError("invalid-argument", "Analytics issue category is invalid.");
  }
  return normalized;
}

function requireQuoteCompletionCategory(value, allowed, label) {
  const normalized = text(value, 40).toLowerCase();
  if (!allowed.has(normalized)) {
    throw new ProductAnalyticsError("invalid-argument", `Quote completion ${label} category is invalid.`);
  }
  return normalized;
}

function normalizeOccurredAt(value, receivedAtISO) {
  const parsed = new Date(String(value || ""));
  const received = new Date(receivedAtISO);
  if (Number.isNaN(parsed.getTime()) || Number.isNaN(received.getTime())) return received.toISOString();
  const driftMs = Math.abs(received.getTime() - parsed.getTime());
  return driftMs <= 24 * 60 * 60 * 1000 ? parsed.toISOString() : received.toISOString();
}

function sanitizeAnalyticsEvent(raw, { organizationId, receivedAtISO }) {
  const eventName = text(raw?.eventName, 40).toLowerCase();
  if (!ANALYTICS_EVENT_NAMES.has(eventName)) {
    throw new ProductAnalyticsError("invalid-argument", "Analytics event name is not allowed.");
  }
  const sessionId = requireIdentifier(raw?.sessionId, "Analytics session ID");
  const sequence = Number(raw?.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 100000) {
    throw new ProductAnalyticsError("invalid-argument", "Analytics event sequence is invalid.");
  }
  const mode = text(raw?.mode, 12).toLowerCase();
  if (!new Set(["create", "edit"]).has(mode)) {
    throw new ProductAnalyticsError("invalid-argument", "Analytics wizard mode is invalid.");
  }

  const event = {
    schemaVersion: 1,
    organizationId: requireIdentifier(organizationId, "Organization ID", 100),
    eventName,
    sessionId,
    sequence,
    mode,
    occurredAtISO: normalizeOccurredAt(raw?.occurredAtISO, receivedAtISO),
    receivedAtISO
  };
  if (eventName === "wizard_step_completed") {
    const step = Number(raw?.step);
    if (!Number.isSafeInteger(step) || step < 1 || step > 5) {
      throw new ProductAnalyticsError("invalid-argument", "Completed wizard step is invalid.");
    }
    event.step = step;
  }
  if (eventName.startsWith("post_event_learning_")) {
    if (!["recipe", "template", "pack_conversion", "workflow"].includes(raw?.category)
      || (eventName === "post_event_learning_applied" && raw?.authority !== "existing_authority_receipt")) {
      throw new ProductAnalyticsError("invalid-argument", "Learning observations require an allowed category and application receipt boundary.");
    }
    event.category = raw.category;
    if (eventName === "post_event_learning_applied") event.authority = "existing_authority_receipt";
  }
  if (eventName === "addon_selected" || eventName === "addon_removed") {
    event.addonId = requireIdentifier(raw?.addonId, "Add-on ID", 120);
  }
  if (eventName === "priced_draft_receipt_observed") {
    if (raw?.pricingAuthority !== "server_authoritative" || raw?.storage !== "firebase") {
      throw new ProductAnalyticsError(
        "invalid-argument",
        "Priced draft receipt evidence is invalid."
      );
    }
    event.durationMs = requireInteger(raw?.durationMs, "Priced draft duration", {
      max: PRODUCT_ANALYTICS_MAX_DURATION_MS
    });
    event.pricingAuthority = "server_authoritative";
    event.storage = "firebase";
  }
  if (eventName === "ambient_primary_action_assessed") {
    if (
      raw?.primary !== true
      || raw?.deadlineMs !== PRODUCT_ANALYTICS_DEAD_CLICK_DEADLINE_MS
      || typeof raw?.deadClick !== "boolean"
    ) {
      throw new ProductAnalyticsError(
        "invalid-argument",
        "Ambient primary-action assessment is invalid."
      );
    }
    event.primary = true;
    event.deadlineMs = PRODUCT_ANALYTICS_DEAD_CLICK_DEADLINE_MS;
    event.deadClick = raw.deadClick;
    if (raw?.acknowledgementMs != null) {
      event.acknowledgementMs = requireInteger(
        raw.acknowledgementMs,
        "Ambient acknowledgement duration",
        { max: PRODUCT_ANALYTICS_MAX_ACKNOWLEDGEMENT_MS }
      );
    }
    if (raw?.resultKind != null) {
      const resultKind = text(raw.resultKind, 16).toLowerCase();
      if (!AMBIENT_RESULT_KINDS.has(resultKind)) {
        throw new ProductAnalyticsError(
          "invalid-argument",
          "Ambient acknowledgement result kind is invalid."
        );
      }
      event.resultKind = resultKind;
    }
  }
  if (eventName === "ambient_issue_surfaced" || eventName === "ambient_issue_resolved") {
    event.issueCategory = requireIssueCategory(raw?.issueCategory);
    if (eventName === "ambient_issue_resolved") {
      event.durationMs = requireInteger(raw?.durationMs, "Ambient issue duration", {
        max: PRODUCT_ANALYTICS_MAX_DURATION_MS
      });
    }
  }
  if (eventName.startsWith("quote_completion_")) {
    event.completionState = requireQuoteCompletionCategory(
      raw?.completionState,
      QUOTE_COMPLETION_STATES,
      "state"
    );
    event.surface = requireQuoteCompletionCategory(
      raw?.surface,
      QUOTE_COMPLETION_SURFACES,
      "surface"
    );
    if (eventName === "quote_completion_sendable_reached") {
      if (event.completionState !== "sendable") {
        throw new ProductAnalyticsError(
          "invalid-argument",
          "Quote completion sendable category is invalid."
        );
      }
    } else {
      event.actionKind = requireQuoteCompletionCategory(
        raw?.actionKind,
        QUOTE_COMPLETION_ACTION_KINDS,
        "action"
      );
      if (eventName === "quote_completion_action_resolved") {
        event.result = requireQuoteCompletionCategory(
          raw?.result,
          QUOTE_COMPLETION_RESULTS,
          "result"
        );
      }
    }
  }
  event.eventId = createHash("sha256")
    .update(`${event.organizationId}\n${sessionId}\n${sequence}`)
    .digest("hex");
  return event;
}

function sanitizeAnalyticsBatch(rawEvents, context) {
  if (!Array.isArray(rawEvents) || rawEvents.length < 1 || rawEvents.length > 25) {
    throw new ProductAnalyticsError("invalid-argument", "Submit between 1 and 25 analytics events.");
  }
  const events = rawEvents.map((event) => sanitizeAnalyticsEvent(event, context));
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new ProductAnalyticsError("invalid-argument", "Analytics batch contains duplicate events.");
  }
  return events;
}

function summarizeAnalyticsEvents(rawEvents = []) {
  const sessions = new Map();
  const addons = new Map();
  const metricEventsBySession = new Map();
  rawEvents.forEach((event) => {
    const sessionId = text(event?.sessionId, 80);
    if (!sessionId) return;
    const session = sessions.get(sessionId) || {
      started: false,
      maxCompletedStep: 0,
      saved: false
    };
    if (event.eventName === "wizard_started") session.started = true;
    if (event.eventName === "wizard_step_completed") {
      session.maxCompletedStep = Math.max(session.maxCompletedStep, Number(event.step || 0));
    }
    if (event.eventName === "quote_saved") session.saved = true;
    sessions.set(sessionId, session);

    if (["addon_selected", "addon_removed"].includes(event.eventName) && event.addonId) {
      const row = addons.get(event.addonId) || { addonId: event.addonId, selected: 0, removed: 0 };
      if (event.eventName === "addon_selected") row.selected += 1;
      if (event.eventName === "addon_removed") row.removed += 1;
      addons.set(event.addonId, row);
    }

    const metricEvents = metricEventsBySession.get(sessionId) || [];
    metricEvents.push(event);
    metricEventsBySession.set(sessionId, metricEvents);
  });

  const sessionRows = [...sessions.values()].filter((session) => session.started);
  const funnel = [1, 2, 3, 4, 5].map((step) => ({
    step,
    sessions: sessionRows.filter((session) => (
      step === 1 || session.maxCompletedStep >= step - 1 || session.saved
    )).length
  }));
  const saved = sessionRows.filter((session) => session.saved).length;
  let primaryActionsAssessed = 0;
  let deadClicks = 0;
  let quoteCompletionActionsShown = 0;
  let quoteCompletionActionsResolved = 0;
  let quoteCompletionSendableReached = 0;
  let learningProposed = 0;
  let learningApplied = 0;
  const intentToPricedDraftDurations = [];
  const issueResolutionDurations = [];
  const issueResolutionDurationsByCategory = new Map();

  metricEventsBySession.forEach((events) => {
    const ordered = [...events].sort((left, right) => (
      Number(left?.sequence || 0) - Number(right?.sequence || 0)
    ));
    let started = false;
    let mode = "";
    let firstIntentObserved = false;
    let pricedDraftObserved = false;
    const activeIssueCategories = new Set();

    ordered.forEach((event) => {
      if (event?.eventName === "wizard_started" && !started) {
        started = true;
        mode = text(event?.mode, 12).toLowerCase();
        return;
      }
      if (!started || text(event?.mode, 12).toLowerCase() !== mode) return;

      if (event?.eventName === "first_intent_observed") {
        firstIntentObserved = true;
        return;
      }
      if (
        event?.eventName === "priced_draft_receipt_observed"
        && firstIntentObserved
        && !pricedDraftObserved
      ) {
        const durationMs = boundedMetricDuration(event?.durationMs);
        if (
          durationMs !== null
          && event?.pricingAuthority === "server_authoritative"
          && event?.storage === "firebase"
        ) {
          intentToPricedDraftDurations.push(durationMs);
          pricedDraftObserved = true;
        }
        return;
      }
      if (
        event?.eventName === "ambient_primary_action_assessed"
        && event?.primary === true
        && event?.deadlineMs === PRODUCT_ANALYTICS_DEAD_CLICK_DEADLINE_MS
      ) {
        if (typeof event?.deadClick !== "boolean") return;
        primaryActionsAssessed += 1;
        if (event.deadClick) deadClicks += 1;
        return;
      }
      if (event?.eventName === "quote_completion_action_shown") {
        quoteCompletionActionsShown += 1;
        return;
      }
      if (event?.eventName === "post_event_learning_proposed") { learningProposed += 1; return; }
      if (event?.eventName === "post_event_learning_applied" && event.authority === "existing_authority_receipt") { learningApplied += 1; return; }
      if (
        event?.eventName === "quote_completion_action_resolved"
        && event?.result === "success"
      ) {
        quoteCompletionActionsResolved += 1;
        return;
      }
      if (event?.eventName === "quote_completion_sendable_reached") {
        quoteCompletionSendableReached += 1;
        return;
      }
      if (event?.eventName === "ambient_issue_surfaced") {
        if (ISSUE_CATEGORIES.has(event?.issueCategory)) {
          activeIssueCategories.add(event.issueCategory);
        }
        return;
      }
      if (
        event?.eventName === "ambient_issue_resolved"
        && ISSUE_CATEGORIES.has(event?.issueCategory)
        && activeIssueCategories.has(event.issueCategory)
      ) {
        const durationMs = boundedMetricDuration(event?.durationMs);
        if (durationMs === null) return;
        activeIssueCategories.delete(event.issueCategory);
        issueResolutionDurations.push(durationMs);
        const categoryDurations = issueResolutionDurationsByCategory.get(event.issueCategory) || [];
        categoryDurations.push(durationMs);
        issueResolutionDurationsByCategory.set(event.issueCategory, categoryDurations);
      }
    });
  });

  return {
    sessionsStarted: sessionRows.length,
    quotesSaved: saved,
    completionRate: sessionRows.length ? (saved / sessionRows.length) * 100 : 0,
    funnel,
    addons: [...addons.values()]
      .sort((left, right) => right.selected - left.selected || left.addonId.localeCompare(right.addonId))
      .slice(0, 10),
    ambientInteractions: {
      observationSource: "client",
      deadlineMs: PRODUCT_ANALYTICS_DEAD_CLICK_DEADLINE_MS,
      primaryActionsAssessed,
      deadClicks,
      deadClickRate: primaryActionsAssessed ? deadClicks / primaryActionsAssessed : 0
    },
    intentToPricedDraft: {
      observationSource: "client",
      receiptAuthority: "server_authoritative",
      storage: "firebase",
      ...summarizeDurations(intentToPricedDraftDurations)
    },
    issueResolution: {
      observationSource: "client",
      pairing: "same_session_exact_category",
      ...summarizeDurations(issueResolutionDurations),
      byCategory: PRODUCT_ANALYTICS_ISSUE_CATEGORIES
        .filter((issueCategory) => issueResolutionDurationsByCategory.has(issueCategory))
        .map((issueCategory) => ({
          issueCategory,
          ...summarizeDurations(issueResolutionDurationsByCategory.get(issueCategory))
        }))
    },
    postEventLearning: { observationSource: "client", proposed: learningProposed, applied: learningApplied },
    quoteCompletion: {
      observationSource: "client",
      actionsShown: quoteCompletionActionsShown,
      actionsResolved: quoteCompletionActionsResolved,
      actionResolutionRate: quoteCompletionActionsShown
        ? quoteCompletionActionsResolved / quoteCompletionActionsShown
        : 0,
      sendableReached: quoteCompletionSendableReached
    }
  };
}

function boundedMetricDuration(value) {
  if (value == null || value === "") return null;
  const normalized = Number(value);
  return Number.isSafeInteger(normalized)
    && normalized >= 0
    && normalized <= PRODUCT_ANALYTICS_MAX_DURATION_MS
    ? normalized
    : null;
}

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  return Math.round(lower + (upper - lower) * (position - lowerIndex));
}

function summarizeDurations(values) {
  const sorted = values.map(boundedMetricDuration).filter((value) => value !== null)
    .sort((left, right) => left - right);
  return {
    samples: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p75Ms: percentile(sorted, 0.75)
  };
}

module.exports = {
  ANALYTICS_EVENT_NAMES,
  PRODUCT_ANALYTICS_ISSUE_CATEGORIES,
  ProductAnalyticsError,
  sanitizeAnalyticsBatch,
  sanitizeAnalyticsEvent,
  summarizeAnalyticsEvents
};
