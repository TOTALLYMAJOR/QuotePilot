import {
  boundedProductAnalyticsInteger,
  enqueueProductAnalyticsEvent,
  readProductAnalyticsSession,
  registerProductAnalyticsExtension,
  writeProductAnalyticsSession
} from "./productAnalyticsCore";

const AMBIENT_EVENT_NAMES = new Set([
  "first_intent_observed",
  "priced_draft_receipt_observed",
  "ambient_primary_action_assessed",
  "ambient_issue_surfaced",
  "ambient_issue_resolved"
]);
const AMBIENT_RESULT_KINDS = new Set([
  "context",
  "preview",
  "pending",
  "receipt",
  "resolved",
  "recovery"
]);

export const PRODUCT_ANALYTICS_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
export const PRODUCT_ANALYTICS_MAX_ACKNOWLEDGEMENT_MS = 60 * 1000;
export const PRODUCT_ANALYTICS_DEAD_CLICK_DEADLINE_MS = 250;
export const PRODUCT_ANALYTICS_ISSUE_CATEGORIES = Object.freeze([
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

function normalizeIssueCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ISSUE_CATEGORIES.has(normalized) ? normalized : "";
}

function sanitizeAmbientDimensions(eventName, dimensions = {}) {
  if (!AMBIENT_EVENT_NAMES.has(eventName)) return null;
  if (eventName === "first_intent_observed") return {};
  if (eventName === "priced_draft_receipt_observed") {
    const durationMs = boundedProductAnalyticsInteger(dimensions.durationMs, {
      max: PRODUCT_ANALYTICS_MAX_DURATION_MS
    });
    if (
      durationMs === null
      || dimensions.pricingAuthority !== "server_authoritative"
      || dimensions.storage !== "firebase"
    ) {
      return null;
    }
    return {
      durationMs,
      pricingAuthority: "server_authoritative",
      storage: "firebase"
    };
  }
  if (eventName === "ambient_primary_action_assessed") {
    if (
      dimensions.primary !== true
      || dimensions.deadlineMs !== PRODUCT_ANALYTICS_DEAD_CLICK_DEADLINE_MS
      || typeof dimensions.deadClick !== "boolean"
    ) {
      return null;
    }
    const acknowledgementMs = dimensions.acknowledgementMs == null
      ? null
      : boundedProductAnalyticsInteger(dimensions.acknowledgementMs, {
          max: PRODUCT_ANALYTICS_MAX_ACKNOWLEDGEMENT_MS
        });
    if (dimensions.acknowledgementMs != null && acknowledgementMs === null) return null;
    const resultKind = dimensions.resultKind == null
      ? null
      : String(dimensions.resultKind || "").trim().toLowerCase();
    if (resultKind !== null && !AMBIENT_RESULT_KINDS.has(resultKind)) return null;
    return {
      primary: true,
      deadlineMs: PRODUCT_ANALYTICS_DEAD_CLICK_DEADLINE_MS,
      deadClick: dimensions.deadClick,
      ...(acknowledgementMs === null ? {} : { acknowledgementMs }),
      ...(resultKind === null ? {} : { resultKind })
    };
  }
  const issueCategory = normalizeIssueCategory(dimensions.issueCategory);
  if (!issueCategory) return null;
  if (eventName === "ambient_issue_surfaced") return { issueCategory };
  const durationMs = boundedProductAnalyticsInteger(dimensions.durationMs, {
    max: PRODUCT_ANALYTICS_MAX_DURATION_MS
  });
  return durationMs === null ? null : { issueCategory, durationMs };
}

function sanitizeAmbientSession(raw) {
  const firstIntentAtMs = boundedProductAnalyticsInteger(raw?.firstIntentAtMs, {
    max: Number.MAX_SAFE_INTEGER
  });
  const ambientIssueStartedAtMs = {};
  PRODUCT_ANALYTICS_ISSUE_CATEGORIES.forEach((issueCategory) => {
    const startedAtMs = boundedProductAnalyticsInteger(
      raw?.ambientIssueStartedAtMs?.[issueCategory],
      { max: Number.MAX_SAFE_INTEGER }
    );
    if (startedAtMs !== null) ambientIssueStartedAtMs[issueCategory] = startedAtMs;
  });
  return {
    firstIntentAtMs,
    pricedDraftReceiptObserved: raw?.pricedDraftReceiptObserved === true,
    ambientIssueStartedAtMs
  };
}

function initializeAmbientSession() {
  return {
    firstIntentAtMs: null,
    pricedDraftReceiptObserved: false,
    ambientIssueStartedAtMs: {}
  };
}

function localAmbientSummary() {
  return {
    ambientInteractions: {
      observationSource: "client",
      deadlineMs: PRODUCT_ANALYTICS_DEAD_CLICK_DEADLINE_MS,
      primaryActionsAssessed: 0,
      deadClicks: 0,
      deadClickRate: 0
    },
    intentToPricedDraft: {
      observationSource: "client",
      receiptAuthority: "server_authoritative",
      storage: "firebase",
      samples: 0,
      medianMs: null,
      p75Ms: null
    },
    issueResolution: {
      observationSource: "client",
      pairing: "same_session_exact_category",
      samples: 0,
      medianMs: null,
      p75Ms: null,
      byCategory: []
    }
  };
}

registerProductAnalyticsExtension({
  sanitizeDimensions: sanitizeAmbientDimensions,
  sanitizeSession: sanitizeAmbientSession,
  initializeSession: initializeAmbientSession,
  extendLocalSummary: localAmbientSummary
});

export function recordProductAnalyticsFirstIntent({ observedAtMs = Date.now() } = {}) {
  const session = readProductAnalyticsSession();
  const normalizedObservedAtMs = boundedProductAnalyticsInteger(observedAtMs, {
    max: Number.MAX_SAFE_INTEGER
  });
  if (!session || normalizedObservedAtMs === null || session.firstIntentAtMs !== null) return false;
  writeProductAnalyticsSession({ ...session, firstIntentAtMs: normalizedObservedAtMs });
  return enqueueProductAnalyticsEvent("first_intent_observed");
}

export function recordProductAnalyticsPricedDraftReceipt({
  pricingAuthority,
  storage,
  observedAtMs = Date.now()
} = {}) {
  if (pricingAuthority !== "server_authoritative" || storage !== "firebase") return false;
  const session = readProductAnalyticsSession();
  const normalizedObservedAtMs = boundedProductAnalyticsInteger(observedAtMs, {
    max: Number.MAX_SAFE_INTEGER
  });
  if (
    !session
    || session.firstIntentAtMs === null
    || session.pricedDraftReceiptObserved
    || normalizedObservedAtMs === null
  ) {
    return false;
  }
  const durationMs = normalizedObservedAtMs - session.firstIntentAtMs;
  if (durationMs < 0 || durationMs > PRODUCT_ANALYTICS_MAX_DURATION_MS) return false;
  writeProductAnalyticsSession({ ...session, pricedDraftReceiptObserved: true });
  return enqueueProductAnalyticsEvent("priced_draft_receipt_observed", {
    durationMs,
    pricingAuthority,
    storage
  });
}

export function recordProductAnalyticsAmbientAssessment({
  primary,
  deadlineMs,
  deadClick,
  acknowledgementMs = null,
  resultKind = null
} = {}) {
  return enqueueProductAnalyticsEvent("ambient_primary_action_assessed", {
    primary,
    deadlineMs,
    deadClick,
    acknowledgementMs,
    resultKind
  });
}

export function recordProductAnalyticsIssueSurfaced({
  issueCategory,
  observedAtMs = Date.now()
} = {}) {
  const session = readProductAnalyticsSession();
  const normalizedIssueCategory = normalizeIssueCategory(issueCategory);
  const normalizedObservedAtMs = boundedProductAnalyticsInteger(observedAtMs, {
    max: Number.MAX_SAFE_INTEGER
  });
  if (
    !session
    || !normalizedIssueCategory
    || normalizedObservedAtMs === null
    || session.ambientIssueStartedAtMs[normalizedIssueCategory] != null
  ) {
    return false;
  }
  writeProductAnalyticsSession({
    ...session,
    ambientIssueStartedAtMs: {
      ...session.ambientIssueStartedAtMs,
      [normalizedIssueCategory]: normalizedObservedAtMs
    }
  });
  return enqueueProductAnalyticsEvent("ambient_issue_surfaced", {
    issueCategory: normalizedIssueCategory
  });
}

export function recordProductAnalyticsIssueResolved({
  issueCategory,
  observedAtMs = Date.now()
} = {}) {
  const session = readProductAnalyticsSession();
  const normalizedIssueCategory = normalizeIssueCategory(issueCategory);
  const normalizedObservedAtMs = boundedProductAnalyticsInteger(observedAtMs, {
    max: Number.MAX_SAFE_INTEGER
  });
  const surfacedAtMs = session?.ambientIssueStartedAtMs?.[normalizedIssueCategory];
  if (
    !session
    || !normalizedIssueCategory
    || normalizedObservedAtMs === null
    || surfacedAtMs == null
  ) {
    return false;
  }
  const durationMs = normalizedObservedAtMs - surfacedAtMs;
  if (durationMs < 0 || durationMs > PRODUCT_ANALYTICS_MAX_DURATION_MS) return false;
  const ambientIssueStartedAtMs = { ...session.ambientIssueStartedAtMs };
  delete ambientIssueStartedAtMs[normalizedIssueCategory];
  writeProductAnalyticsSession({ ...session, ambientIssueStartedAtMs });
  return enqueueProductAnalyticsEvent("ambient_issue_resolved", {
    issueCategory: normalizedIssueCategory,
    durationMs
  });
}

export function resetProductAnalyticsIssueObservationState() {
  const session = readProductAnalyticsSession();
  if (!session || Object.keys(session.ambientIssueStartedAtMs).length === 0) return false;
  writeProductAnalyticsSession({ ...session, ambientIssueStartedAtMs: {} });
  return true;
}

export { getProductAnalyticsSummary } from "./productAnalyticsCore";
