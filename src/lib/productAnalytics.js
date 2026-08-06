import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

const QUEUE_KEY = "quoteWizard.productAnalyticsQueue.v1";
const SESSION_KEY = "quoteWizard.productAnalyticsSession.v1";
const MAX_QUEUE_SIZE = 100;
let flushing = null;

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readQueue() {
  if (typeof window === "undefined") return [];
  try {
    const queue = safeParse(window.localStorage.getItem(QUEUE_KEY), []);
    return Array.isArray(queue) ? queue.slice(-MAX_QUEUE_SIZE) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)));
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
    return safeParse(window.sessionStorage.getItem(SESSION_KEY), null);
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
  const normalizedOrg = String(organizationId || "").trim();
  if (!normalizedOrg) return null;
  const current = readSession();
  if (!force && current?.organizationId === normalizedOrg && current?.mode === mode) return current;
  const session = { organizationId: normalizedOrg, mode, sessionId: newSessionId(), sequence: 0 };
  writeSession(session);
  recordProductAnalyticsEvent("wizard_started");
  return readSession();
}

export function recordProductAnalyticsEvent(eventName, dimensions = {}) {
  const session = readSession();
  if (!session?.organizationId || !session?.sessionId) return;
  const nextSession = { ...session, sequence: Number(session.sequence || 0) + 1 };
  writeSession(nextSession);
  writeQueue([...readQueue(), {
    organizationId: nextSession.organizationId,
    eventName,
    sessionId: nextSession.sessionId,
    sequence: nextSession.sequence,
    mode: nextSession.mode,
    occurredAtISO: new Date().toISOString(),
    ...dimensions
  }]);
  void flushProductAnalyticsEvents();
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
    return { source: "local", days, sessionsStarted: 0, quotesSaved: 0, completionRate: 0, funnel: [], addons: [] };
  }
  await flushProductAnalyticsEvents();
  const call = httpsCallable(cloudFunctions, "getProductAnalyticsSummary");
  const result = await call({ organizationId, days });
  return result.data || {};
}

export const PRODUCT_ANALYTICS_STORAGE_KEYS = { QUEUE_KEY, SESSION_KEY };
