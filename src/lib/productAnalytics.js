import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

const QUEUE_KEY = "quoteWizard.productAnalyticsQueue.v1";
const SESSION_KEY = "quoteWizard.productAnalyticsSession.v1";
const MAX_QUEUE_SIZE = 100;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const DIRECT_EVENT_NAMES = new Set([
  "wizard_started",
  "wizard_step_completed",
  "addon_selected",
  "addon_removed",
  "quote_saved"
]);
const GUARDED_EVENT_NAMES = new Set([
  "first_intent_observed",
  "priced_draft_receipt_observed",
  "ambient_primary_action_assessed",
  "ambient_issue_surfaced",
  "ambient_issue_resolved"
]);
const EVENT_NAMES = new Set([...DIRECT_EVENT_NAMES, ...GUARDED_EVENT_NAMES]);
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
let flushing = null;

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizedIdentifier(value, max = 120) {
  const normalized = String(value || "").trim();
  if (normalized.length > max) return "";
  return normalized && IDENTIFIER_PATTERN.test(normalized) ? normalized : "";
}

function boundedInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function normalizeIssueCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ISSUE_CATEGORIES.has(normalized) ? normalized : "";
}

function sanitizeClientDimensions(eventName, dimensions = {}) {
  if (!EVENT_NAMES.has(eventName)) return null;
  if (eventName === "wizard_step_completed") {
    const step = boundedInteger(dimensions.step, { min: 1, max: 5 });
    return step === null ? null : { step };
  }
  if (eventName === "addon_selected" || eventName === "addon_removed") {
    const addonId = normalizedIdentifier(dimensions.addonId, 120);
    return addonId ? { addonId } : null;
  }
  if (eventName === "priced_draft_receipt_observed") {
    const durationMs = boundedInteger(dimensions.durationMs, {
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
      : boundedInteger(dimensions.acknowledgementMs, {
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
  if (eventName === "ambient_issue_surfaced" || eventName === "ambient_issue_resolved") {
    const issueCategory = normalizeIssueCategory(dimensions.issueCategory);
    if (!issueCategory) return null;
    if (eventName === "ambient_issue_surfaced") return { issueCategory };
    const durationMs = boundedInteger(dimensions.durationMs, {
      max: PRODUCT_ANALYTICS_MAX_DURATION_MS
    });
    return durationMs === null ? null : { issueCategory, durationMs };
  }
  return {};
}

function normalizeQueuedEvent(raw) {
  const eventName = String(raw?.eventName || "").trim().toLowerCase();
  const organizationId = normalizedIdentifier(raw?.organizationId, 100);
  const sessionId = normalizedIdentifier(raw?.sessionId, 80);
  const sequence = boundedInteger(raw?.sequence, { min: 1, max: 100000 });
  const mode = String(raw?.mode || "").trim().toLowerCase();
  const dimensions = sanitizeClientDimensions(eventName, raw);
  const occurredAt = new Date(String(raw?.occurredAtISO || ""));
  if (
    !organizationId
    || !sessionId
    || sequence === null
    || !["create", "edit"].includes(mode)
    || !dimensions
    || Number.isNaN(occurredAt.getTime())
  ) {
    return null;
  }
  return {
    organizationId,
    eventName,
    sessionId,
    sequence,
    mode,
    occurredAtISO: occurredAt.toISOString(),
    ...dimensions
  };
}

function readQueue() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = safeParse(window.localStorage.getItem(QUEUE_KEY), []);
    const limited = Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE_SIZE) : [];
    const queue = limited.map(normalizeQueuedEvent).filter(Boolean);
    if (JSON.stringify(queue) !== JSON.stringify(limited)) {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    }
    return queue;
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  if (typeof window === "undefined") return;
  try {
    const safeQueue = (Array.isArray(queue) ? queue : [])
      .map(normalizeQueuedEvent)
      .filter(Boolean)
      .slice(-MAX_QUEUE_SIZE);
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(safeQueue));
  } catch {
    // Analytics must never block quote work when browser storage is unavailable.
  }
}

function newSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function readSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = safeParse(window.sessionStorage.getItem(SESSION_KEY), null);
    const organizationId = normalizedIdentifier(raw?.organizationId, 100);
    const sessionId = normalizedIdentifier(raw?.sessionId, 80);
    const mode = String(raw?.mode || "").trim().toLowerCase();
    const sequence = boundedInteger(raw?.sequence, { max: 100000 });
    if (!organizationId || !sessionId || !["create", "edit"].includes(mode) || sequence === null) {
      return null;
    }
    const firstIntentAtMs = boundedInteger(raw?.firstIntentAtMs, {
      max: Number.MAX_SAFE_INTEGER
    });
    const ambientIssueStartedAtMs = {};
    PRODUCT_ANALYTICS_ISSUE_CATEGORIES.forEach((issueCategory) => {
      const startedAtMs = boundedInteger(raw?.ambientIssueStartedAtMs?.[issueCategory], {
        max: Number.MAX_SAFE_INTEGER
      });
      if (startedAtMs !== null) ambientIssueStartedAtMs[issueCategory] = startedAtMs;
    });
    return {
      organizationId,
      mode,
      sessionId,
      sequence,
      firstIntentAtMs,
      pricedDraftReceiptObserved: raw?.pricedDraftReceiptObserved === true,
      ambientIssueStartedAtMs
    };
  } catch {
    return null;
  }
}

function writeSession(session) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Analytics must never block quote work when browser storage is unavailable.
  }
}

export function beginWizardAnalyticsSession({ organizationId, mode = "create", force = false } = {}) {
  const normalizedOrg = normalizedIdentifier(organizationId, 100);
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (!normalizedOrg || !["create", "edit"].includes(normalizedMode)) return null;
  const current = readSession();
  if (
    !force
    && current?.organizationId === normalizedOrg
    && current?.mode === normalizedMode
  ) {
    return current;
  }
  const session = {
    organizationId: normalizedOrg,
    mode: normalizedMode,
    sessionId: newSessionId(),
    sequence: 0,
    firstIntentAtMs: null,
    pricedDraftReceiptObserved: false,
    ambientIssueStartedAtMs: {}
  };
  writeSession(session);
  recordProductAnalyticsEvent("wizard_started");
  return readSession();
}

function enqueueProductAnalyticsEvent(eventName, dimensions = {}) {
  const session = readSession();
  const normalizedEventName = String(eventName || "").trim().toLowerCase();
  const safeDimensions = sanitizeClientDimensions(normalizedEventName, dimensions);
  if (!session?.organizationId || !session?.sessionId || !safeDimensions) return false;
  const nextSession = { ...session, sequence: Number(session.sequence || 0) + 1 };
  writeSession(nextSession);
  writeQueue([...readQueue(), {
    organizationId: nextSession.organizationId,
    eventName: normalizedEventName,
    sessionId: nextSession.sessionId,
    sequence: nextSession.sequence,
    mode: nextSession.mode,
    occurredAtISO: new Date().toISOString(),
    ...safeDimensions
  }]);
  void flushProductAnalyticsEvents();
  return true;
}

export function recordProductAnalyticsEvent(eventName, dimensions = {}) {
  const normalizedEventName = String(eventName || "").trim().toLowerCase();
  if (!DIRECT_EVENT_NAMES.has(normalizedEventName)) return false;
  return enqueueProductAnalyticsEvent(normalizedEventName, dimensions);
}

export function recordProductAnalyticsFirstIntent({ observedAtMs = Date.now() } = {}) {
  const session = readSession();
  const normalizedObservedAtMs = boundedInteger(observedAtMs, {
    max: Number.MAX_SAFE_INTEGER
  });
  if (!session || normalizedObservedAtMs === null || session.firstIntentAtMs !== null) return false;
  writeSession({ ...session, firstIntentAtMs: normalizedObservedAtMs });
  return enqueueProductAnalyticsEvent("first_intent_observed");
}

export function recordProductAnalyticsPricedDraftReceipt({
  pricingAuthority,
  storage,
  observedAtMs = Date.now()
} = {}) {
  if (pricingAuthority !== "server_authoritative" || storage !== "firebase") return false;
  const session = readSession();
  const normalizedObservedAtMs = boundedInteger(observedAtMs, {
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
  writeSession({ ...session, pricedDraftReceiptObserved: true });
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
  const session = readSession();
  const normalizedIssueCategory = normalizeIssueCategory(issueCategory);
  const normalizedObservedAtMs = boundedInteger(observedAtMs, {
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
  writeSession({
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
  const session = readSession();
  const normalizedIssueCategory = normalizeIssueCategory(issueCategory);
  const normalizedObservedAtMs = boundedInteger(observedAtMs, {
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
  writeSession({ ...session, ambientIssueStartedAtMs });
  return enqueueProductAnalyticsEvent("ambient_issue_resolved", {
    issueCategory: normalizedIssueCategory,
    durationMs
  });
}

export function resetProductAnalyticsIssueObservationState() {
  const session = readSession();
  if (!session || Object.keys(session.ambientIssueStartedAtMs).length === 0) return false;
  writeSession({ ...session, ambientIssueStartedAtMs: {} });
  return true;
}

export async function flushProductAnalyticsEvents() {
  if (flushing) return flushing;
  if (!firebaseReady || !cloudFunctions) return { sent: 0, queued: readQueue().length };
  const queue = readQueue();
  if (!queue.length) return { sent: 0, queued: 0 };
  const organizationId = String(queue[0]?.organizationId || "").trim();
  const batch = queue.filter((event) => event.organizationId === organizationId).slice(0, 25);
  flushing = (async () => {
    const call = httpsCallable(cloudFunctions, "recordProductAnalyticsEvents");
    await call({ organizationId, events: batch.map(({ organizationId: _organizationId, ...event }) => event) });
    const sentKeys = new Set(batch.map((event) => `${event.organizationId}:${event.sessionId}:${event.sequence}`));
    writeQueue(readQueue().filter((event) => !sentKeys.has(`${event.organizationId}:${event.sessionId}:${event.sequence}`)));
    return { sent: batch.length, queued: readQueue().length };
  })().finally(() => {
    flushing = null;
  });
  try {
    return await flushing;
  } catch {
    return { sent: 0, queued: readQueue().length };
  }
}

export async function getProductAnalyticsSummary({ organizationId, days = 30 } = {}) {
  if (!firebaseReady || !cloudFunctions) {
    return {
      source: "local",
      days,
      sessionsStarted: 0,
      quotesSaved: 0,
      completionRate: 0,
      funnel: [],
      addons: [],
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
  await flushProductAnalyticsEvents();
  const call = httpsCallable(cloudFunctions, "getProductAnalyticsSummary");
  const result = await call({ organizationId, days });
  return result.data || {};
}

export const PRODUCT_ANALYTICS_STORAGE_KEYS = { QUEUE_KEY, SESSION_KEY };
