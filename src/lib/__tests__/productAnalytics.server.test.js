import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  ProductAnalyticsError,
  sanitizeAnalyticsBatch,
  sanitizeAnalyticsEvent,
  summarizeAnalyticsEvents
} = require("../../../functions/productAnalytics.js");

const context = { organizationId: "org-one", receivedAtISO: "2026-08-06T18:00:00.000Z" };

function event(eventName, sequence, extra = {}) {
  return {
    eventName,
    sessionId: "session-1234567890",
    sequence,
    mode: "create",
    occurredAtISO: "2026-08-06T17:59:00.000Z",
    ...extra
  };
}

describe("product analytics server contract", () => {
  test("keeps only allow-listed, non-PII dimensions and derives a stable retry ID", () => {
    const sanitized = sanitizeAnalyticsEvent({
      ...event("addon_selected", 2, { addonId: "dessert-bar" }),
      customerEmail: "private@example.com",
      total: 123.45
    }, context);
    expect(sanitized).toMatchObject({
      organizationId: "org-one",
      eventName: "addon_selected",
      addonId: "dessert-bar",
      sequence: 2
    });
    expect(sanitized.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(sanitized).not.toHaveProperty("customerEmail");
    expect(sanitized).not.toHaveProperty("total");
    expect(sanitizeAnalyticsEvent(event("addon_selected", 2, { addonId: "dessert-bar" }), context).eventId)
      .toBe(sanitized.eventId);
  });

  test("rejects unknown events, invalid dimensions, and duplicate retry keys", () => {
    expect(() => sanitizeAnalyticsEvent(event("customer_named", 1), context)).toThrow(ProductAnalyticsError);
    expect(() => sanitizeAnalyticsEvent(event("wizard_step_completed", 1, { step: 9 }), context)).toThrow("step");
    expect(() => sanitizeAnalyticsBatch([event("wizard_started", 1), event("quote_saved", 1)], context))
      .toThrow("duplicate");
  });

  test("summarizes funnel reach, saved conversion, and add-on trends", () => {
    const events = [
      event("wizard_started", 1),
      event("wizard_step_completed", 2, { step: 1 }),
      event("wizard_step_completed", 3, { step: 2 }),
      event("addon_selected", 4, { addonId: "dessert" }),
      event("addon_removed", 5, { addonId: "dessert" }),
      event("addon_selected", 6, { addonId: "staffing" }),
      event("quote_saved", 7),
      { ...event("wizard_started", 1), sessionId: "session-other-1234" }
    ];
    expect(summarizeAnalyticsEvents(events)).toEqual({
      sessionsStarted: 2,
      quotesSaved: 1,
      completionRate: 50,
      funnel: [
        { step: 1, sessions: 2 },
        { step: 2, sessions: 1 },
        { step: 3, sessions: 1 },
        { step: 4, sessions: 1 },
        { step: 5, sessions: 1 }
      ],
      addons: [
        { addonId: "dessert", selected: 1, removed: 1 },
        { addonId: "staffing", selected: 1, removed: 0 }
      ]
    });
  });
});
