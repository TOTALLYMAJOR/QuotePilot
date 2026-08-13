import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

const QUEUE_KEY = "quoteWizard.productAnalyticsQueue.v1";
const SESSION_KEY = "quoteWizard.productAnalyticsSession.v1";
const MAX_QUEUE_SIZE = 100;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const EVENTS = Object.freeze({
  wizard_started: "",
  wizard_step_completed: "step",
  addon_selected: "addonId",
  addon_removed: "addonId",
  quote_saved: ""
});
let flushing = null;

function parse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function id(value, limit = 120) {
  const result = String(value || "").trim();
  return result.length <= limit && ID.test(result) ? result : "";
}

function eventDimensions(eventName, input = {}) {
  if (!Object.hasOwn(EVENTS, eventName)) return null;
  const field = EVENTS[eventName];
  if (!field) return {};
  if (field === "step") {
    const step = Number(input.step);
    return Number.isSafeInteger(step) && step > 0 && step < 6 ? { step } : null;
  }
  const addonId = id(input.addonId);
  return addonId ? { addonId } : null;
}

function cleanSession(raw, minimumSequence = 0) {
  const organizationId = id(raw?.organizationId, 100);
  const sessionId = id(raw?.sessionId, 80);
  const mode = String(raw?.mode || "").trim().toLowerCase();
  const sequence = Number(raw?.sequence);
  return organizationId && sessionId && ["create", "edit"].includes(mode)
    && Number.isSafeInteger(sequence) && sequence >= minimumSequence && sequence <= 100000
    ? { organizationId, sessionId, mode, sequence }
    : null;
}

function cleanEvent(raw) {
  const session = cleanSession(raw, 1);
  const eventName = String(raw?.eventName || "").trim().toLowerCase();
  const dimensions = eventDimensions(eventName, raw);
  const occurredAt = new Date(String(raw?.occurredAtISO || ""));
  return session && dimensions && !Number.isNaN(occurredAt.getTime())
    ? { ...session, eventName, occurredAtISO: occurredAt.toISOString(), ...dimensions }
    : null;
}

function readStorage(name, key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    return parse(window[name].getItem(key), fallback);
  } catch {
    return fallback;
  }
}

function writeStorage(name, key, value) {
  if (typeof window === "undefined") return;
  try {
    window[name].setItem(key, JSON.stringify(value));
  } catch {
    // Analytics never blocks quote work when browser storage is unavailable.
  }
}

function readQueue() {
  const raw = readStorage("localStorage", QUEUE_KEY, []);
  const limited = Array.isArray(raw) ? raw.slice(-MAX_QUEUE_SIZE) : [];
  const cleaned = limited.map(cleanEvent).filter(Boolean);
  if (JSON.stringify(cleaned) !== JSON.stringify(raw)) {
    writeStorage("localStorage", QUEUE_KEY, cleaned);
  }
  return cleaned;
}

function writeQueue(queue) {
  writeStorage(
    "localStorage",
    QUEUE_KEY,
    queue.map(cleanEvent).filter(Boolean).slice(-MAX_QUEUE_SIZE)
  );
}

function readSession() {
  return cleanSession(readStorage("sessionStorage", SESSION_KEY, null));
}

function writeSession(session) {
  writeStorage("sessionStorage", SESSION_KEY, session);
}

export function beginWizardAnalyticsSession({ organizationId, mode = "create", force = false } = {}) {
  const nextMode = String(mode || "").trim().toLowerCase();
  const nextOrganizationId = id(organizationId, 100);
  if (!nextOrganizationId || !["create", "edit"].includes(nextMode)) return null;
  const current = readSession();
  if (!force && current?.organizationId === nextOrganizationId && current.mode === nextMode) return current;
  writeSession({
    organizationId: nextOrganizationId,
    mode: nextMode,
    sessionId: globalThis.crypto?.randomUUID?.()
      || `session-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`,
    sequence: 0
  });
  recordProductAnalyticsEvent("wizard_started");
  return readSession();
}

export function recordProductAnalyticsEvent(name, input = {}) {
  const session = readSession();
  const eventName = String(name || "").trim().toLowerCase();
  const dimensions = eventDimensions(eventName, input);
  if (!session || !dimensions) return false;
  const next = { ...session, sequence: session.sequence + 1 };
  writeSession(next);
  writeQueue([...readQueue(), {
    ...next,
    eventName,
    occurredAtISO: new Date().toISOString(),
    ...dimensions
  }]);
  void flushProductAnalyticsEvents();
  return true;
}

export async function flushProductAnalyticsEvents() {
  if (flushing) return flushing;
  const queue = readQueue();
  if (!firebaseReady || !cloudFunctions || !queue.length) {
    return { sent: 0, queued: queue.length };
  }
  const organizationId = queue[0].organizationId;
  const batch = queue.filter((event) => event.organizationId === organizationId).slice(0, 25);
  flushing = (async () => {
    const call = httpsCallable(cloudFunctions, "recordProductAnalyticsEvents");
    await call({
      organizationId,
      events: batch.map(({ organizationId: _organizationId, ...event }) => event)
    });
    const sent = new Set(batch.map((event) => (
      `${event.organizationId}:${event.sessionId}:${event.sequence}`
    )));
    writeQueue(readQueue().filter((event) => !sent.has(
      `${event.organizationId}:${event.sessionId}:${event.sequence}`
    )));
    return { sent: batch.length, queued: readQueue().length };
  })().finally(() => { flushing = null; });
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
      addons: []
    };
  }
  await flushProductAnalyticsEvents();
  const call = httpsCallable(cloudFunctions, "getProductAnalyticsSummary");
  return (await call({ organizationId, days })).data || {};
}

export const PRODUCT_ANALYTICS_STORAGE_KEYS = { QUEUE_KEY, SESSION_KEY };
