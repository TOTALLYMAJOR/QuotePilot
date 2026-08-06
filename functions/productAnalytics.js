const { createHash } = require("node:crypto");

const ANALYTICS_EVENT_NAMES = new Set([
  "wizard_started",
  "wizard_step_completed",
  "addon_selected",
  "addon_removed",
  "quote_saved"
]);

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
  const normalized = text(value, max);
  if (!normalized || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    throw new ProductAnalyticsError("invalid-argument", `${label} is invalid.`);
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
  if (eventName === "addon_selected" || eventName === "addon_removed") {
    event.addonId = requireIdentifier(raw?.addonId, "Add-on ID", 120);
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
  });

  const sessionRows = [...sessions.values()].filter((session) => session.started);
  const funnel = [1, 2, 3, 4, 5].map((step) => ({
    step,
    sessions: sessionRows.filter((session) => (
      step === 1 || session.maxCompletedStep >= step - 1 || session.saved
    )).length
  }));
  const saved = sessionRows.filter((session) => session.saved).length;
  return {
    sessionsStarted: sessionRows.length,
    quotesSaved: saved,
    completionRate: sessionRows.length ? (saved / sessionRows.length) * 100 : 0,
    funnel,
    addons: [...addons.values()]
      .sort((left, right) => right.selected - left.selected || left.addonId.localeCompare(right.addonId))
      .slice(0, 10)
  };
}

module.exports = {
  ANALYTICS_EVENT_NAMES,
  ProductAnalyticsError,
  sanitizeAnalyticsBatch,
  sanitizeAnalyticsEvent,
  summarizeAnalyticsEvents
};
