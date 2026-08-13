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

let flushing = null;
let analyticsExtension = null;

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizedProductAnalyticsIdentifier(value, max = 120) {
  const normalized = String(value || "").trim();
  if (normalized.length > max) return "";
  return normalized && IDENTIFIER_PATTERN.test(normalized) ? normalized : "";
}

export function boundedProductAnalyticsInteger(
  value,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {}
) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function sanitizeCoreDimensions(eventName, dimensions = {}) {
  if (!DIRECT_EVENT_NAMES.has(eventName)) return null;
  if (eventName === "wizard_step_completed") {
    const step = boundedProductAnalyticsInteger(dimensions.step, { min: 1, max: 5 });
    return step === null ? null : { step };
  }
  if (eventName === "addon_selected" || eventName === "addon_removed") {
    const addonId = normalizedProductAnalyticsIdentifier(dimensions.addonId, 120);
    return addonId ? { addonId } : null;
  }
  return {};
}

function safeExtensionObject(method, ...args) {
  if (typeof analyticsExtension?.[method] !== "function") return null;
  try {
    const value = analyticsExtension[method](...args);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function sanitizeClientDimensions(eventName, dimensions = {}) {
  return sanitizeCoreDimensions(eventName, dimensions)
    ?? safeExtensionObject("sanitizeDimensions", eventName, dimensions);
}

function normalizeQueuedEvent(raw) {
  const eventName = String(raw?.eventName || "").trim().toLowerCase();
  const organizationId = normalizedProductAnalyticsIdentifier(raw?.organizationId, 100);
  const sessionId = normalizedProductAnalyticsIdentifier(raw?.sessionId, 80);
  const sequence = boundedProductAnalyticsInteger(raw?.sequence, { min: 1, max: 100000 });
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

function normalizeSession(raw) {
  const organizationId = normalizedProductAnalyticsIdentifier(raw?.organizationId, 100);
  const sessionId = normalizedProductAnalyticsIdentifier(raw?.sessionId, 80);
  const mode = String(raw?.mode || "").trim().toLowerCase();
  const sequence = boundedProductAnalyticsInteger(raw?.sequence, { max: 100000 });
  if (!organizationId || !sessionId || !["create", "edit"].includes(mode) || sequence === null) {
    return null;
  }
  const extensionSession = safeExtensionObject("sanitizeSession", raw) || {};
  return {
    ...extensionSession,
    organizationId,
    mode,
    sessionId,
    sequence
  };
}

export function readProductAnalyticsSession() {
  if (typeof window === "undefined") return null;
  try {
    return normalizeSession(safeParse(window.sessionStorage.getItem(SESSION_KEY), null));
  } catch {
    return null;
  }
}

export function writeProductAnalyticsSession(session) {
  if (typeof window === "undefined") return false;
  try {
    const normalized = normalizeSession(session);
    if (!normalized) return false;
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    // Analytics must never block quote work when browser storage is unavailable.
    return false;
  }
}

export function registerProductAnalyticsExtension(extension) {
  if (
    !extension
    || typeof extension !== "object"
    || typeof extension.sanitizeDimensions !== "function"
    || typeof extension.sanitizeSession !== "function"
  ) {
    throw new TypeError("Product analytics extensions require dimension and session sanitizers.");
  }
  analyticsExtension = extension;
}

export function beginWizardAnalyticsSession({ organizationId, mode = "create", force = false } = {}) {
  const normalizedOrg = normalizedProductAnalyticsIdentifier(organizationId, 100);
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (!normalizedOrg || !["create", "edit"].includes(normalizedMode)) return null;
  const current = readProductAnalyticsSession();
  if (
    !force
    && current?.organizationId === normalizedOrg
    && current?.mode === normalizedMode
  ) {
    return current;
  }
  const extensionSession = safeExtensionObject("initializeSession") || {};
  const session = {
    ...extensionSession,
    organizationId: normalizedOrg,
    mode: normalizedMode,
    sessionId: newSessionId(),
    sequence: 0
  };
  writeProductAnalyticsSession(session);
  recordProductAnalyticsEvent("wizard_started");
  return readProductAnalyticsSession();
}

export function enqueueProductAnalyticsEvent(eventName, dimensions = {}) {
  const session = readProductAnalyticsSession();
  const normalizedEventName = String(eventName || "").trim().toLowerCase();
  const safeDimensions = sanitizeClientDimensions(normalizedEventName, dimensions);
  if (!session?.organizationId || !session?.sessionId || !safeDimensions) return false;
  const nextSession = { ...session, sequence: Number(session.sequence || 0) + 1 };
  writeProductAnalyticsSession(nextSession);
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

function localProductAnalyticsSummary(days) {
  const extensionSummary = safeExtensionObject("extendLocalSummary", { days }) || {};
  return {
    ...extensionSummary,
    source: "local",
    days,
    sessionsStarted: 0,
    quotesSaved: 0,
    completionRate: 0,
    funnel: [],
    addons: []
  };
}

export async function getProductAnalyticsSummary({ organizationId, days = 30 } = {}) {
  if (!firebaseReady || !cloudFunctions) return localProductAnalyticsSummary(days);
  await flushProductAnalyticsEvents();
  const call = httpsCallable(cloudFunctions, "getProductAnalyticsSummary");
  const result = await call({ organizationId, days });
  return result.data || {};
}

export const PRODUCT_ANALYTICS_STORAGE_KEYS = { QUEUE_KEY, SESSION_KEY };
