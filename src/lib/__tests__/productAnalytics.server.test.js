import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  PRODUCT_ANALYTICS_ISSUE_CATEGORIES,
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

  test("accepts only bounded identifier-free Ambient metric dimensions", () => {
    const assessed = sanitizeAnalyticsEvent(event("ambient_primary_action_assessed", 8, {
      primary: true,
      deadlineMs: 250,
      deadClick: false,
      acknowledgementMs: 187,
      resultKind: "receipt",
      quoteId: "quote-private",
      customerName: "Private Person",
      reason: "free text must not persist"
    }), context);
    expect(assessed).toMatchObject({
      eventName: "ambient_primary_action_assessed",
      primary: true,
      deadlineMs: 250,
      deadClick: false,
      acknowledgementMs: 187,
      resultKind: "receipt"
    });
    expect(assessed).not.toHaveProperty("quoteId");
    expect(assessed).not.toHaveProperty("customerName");
    expect(assessed).not.toHaveProperty("reason");

    expect(sanitizeAnalyticsEvent(event("priced_draft_receipt_observed", 9, {
      durationMs: 4200,
      pricingAuthority: "server_authoritative",
      storage: "firebase"
    }), context)).toMatchObject({
      eventName: "priced_draft_receipt_observed",
      durationMs: 4200,
      pricingAuthority: "server_authoritative",
      storage: "firebase"
    });

    expect(PRODUCT_ANALYTICS_ISSUE_CATEGORIES).toContain("proposal-gap-menu");
    expect(sanitizeAnalyticsEvent(event("ambient_issue_resolved", 10, {
      issueCategory: "proposal-gap-menu",
      durationMs: 3100
    }), context)).toMatchObject({
      eventName: "ambient_issue_resolved",
      issueCategory: "proposal-gap-menu",
      durationMs: 3100
    });
  });

  test("accepts only aggregate quote completion categories", () => {
    const shown = sanitizeAnalyticsEvent(event("quote_completion_action_shown", 11, {
      completionState: "blocked",
      actionKind: "resolve_field",
      surface: "proposal_composer",
      quoteId: "quote-private",
      customerEmail: "private@example.test"
    }), context);
    expect(shown).toMatchObject({
      eventName: "quote_completion_action_shown",
      completionState: "blocked",
      actionKind: "resolve_field",
      surface: "proposal_composer"
    });
    expect(shown).not.toHaveProperty("quoteId");
    expect(shown).not.toHaveProperty("customerEmail");

    expect(sanitizeAnalyticsEvent(event("quote_completion_action_resolved", 12, {
      completionState: "sendable",
      actionKind: "send_proposal",
      surface: "living_opportunity",
      result: "success"
    }), context)).toMatchObject({
      result: "success"
    });
    expect(sanitizeAnalyticsEvent(event("quote_completion_sendable_reached", 13, {
      completionState: "sendable",
      surface: "review"
    }), context)).toMatchObject({
      completionState: "sendable",
      surface: "review"
    });
    expect(() => sanitizeAnalyticsEvent(event("quote_completion_action_shown", 14, {
      completionState: "blocked",
      actionKind: "free_form_private_action",
      surface: "proposal_composer"
    }), context)).toThrow("category");
  });

  test("rejects fabricated authority, unbounded timing, free-form issue categories, and non-primary assessments", () => {
    expect(() => sanitizeAnalyticsEvent(event("priced_draft_receipt_observed", 8, {
      durationMs: 100,
      pricingAuthority: "client_preview",
      storage: "firebase"
    }), context)).toThrow("evidence");
    expect(() => sanitizeAnalyticsEvent(event("priced_draft_receipt_observed", 8, {
      durationMs: 24 * 60 * 60 * 1000 + 1,
      pricingAuthority: "server_authoritative",
      storage: "firebase"
    }), context)).toThrow("duration");
    expect(() => sanitizeAnalyticsEvent(event("ambient_primary_action_assessed", 8, {
      primary: false,
      deadlineMs: 250,
      deadClick: true
    }), context)).toThrow("primary-action");
    expect(() => sanitizeAnalyticsEvent(event("ambient_primary_action_assessed", 8, {
      primary: true,
      deadlineMs: 500,
      deadClick: true
    }), context)).toThrow("primary-action");
    expect(() => sanitizeAnalyticsEvent(event("ambient_primary_action_assessed", 8, {
      primary: true,
      deadlineMs: 250,
      deadClick: false,
      acknowledgementMs: 60001
    }), context)).toThrow("acknowledgement");
    expect(() => sanitizeAnalyticsEvent(event("ambient_issue_surfaced", 8, {
      issueCategory: "customer-private-free-text"
    }), context)).toThrow("category");
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
      ],
      ambientInteractions: {
        observationSource: "client",
        deadlineMs: 250,
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
      },
      quoteCompletion: {
        observationSource: "client",
        actionsShown: 0,
        actionsResolved: 0,
        actionResolutionRate: 0,
        sendableReached: 0
      }
    });
  });

  test("summarizes paired client-observed intent, dead-click, and exact-category resolution metrics", () => {
    const sessionOne = [
      event("wizard_started", 1),
      event("first_intent_observed", 2),
      event("priced_draft_receipt_observed", 3, {
        durationMs: 1000,
        pricingAuthority: "server_authoritative",
        storage: "firebase"
      }),
      event("ambient_primary_action_assessed", 4, {
        primary: true,
        deadlineMs: 250,
        deadClick: false,
        acknowledgementMs: 120,
        resultKind: "receipt"
      }),
      event("ambient_primary_action_assessed", 5, {
        primary: true,
        deadlineMs: 250,
        deadClick: true,
        resultKind: "recovery"
      }),
      event("ambient_issue_surfaced", 6, { issueCategory: "workflow-attention" }),
      event("ambient_issue_resolved", 7, {
        issueCategory: "staffing-guidance",
        durationMs: 999
      }),
      event("ambient_issue_resolved", 8, {
        issueCategory: "workflow-attention",
        durationMs: 3000
      }),
      event("ambient_issue_surfaced", 9, { issueCategory: "proposal-gap-menu" }),
      event("ambient_issue_resolved", 10, {
        issueCategory: "proposal-gap-menu",
        durationMs: 1000
      })
    ];
    const sessionTwo = [
      { ...event("wizard_started", 1), sessionId: "session-other-1234" },
      { ...event("first_intent_observed", 2), sessionId: "session-other-1234" },
      {
        ...event("priced_draft_receipt_observed", 3, {
          durationMs: 3000,
          pricingAuthority: "server_authoritative",
          storage: "firebase"
        }),
        sessionId: "session-other-1234"
      },
      {
        ...event("ambient_primary_action_assessed", 4, {
          primary: true,
          deadlineMs: 250,
          deadClick: false,
          acknowledgementMs: 80,
          resultKind: "context"
        }),
        sessionId: "session-other-1234"
      },
      {
        ...event("ambient_issue_surfaced", 5, { issueCategory: "staffing-guidance" }),
        sessionId: "session-other-1234"
      },
      {
        ...event("ambient_issue_resolved", 6, {
          issueCategory: "staffing-guidance",
          durationMs: 5000
        }),
        sessionId: "session-other-1234"
      }
    ];

    const summary = summarizeAnalyticsEvents([...sessionOne, ...sessionTwo]);
    expect(summary.ambientInteractions).toEqual({
      observationSource: "client",
      deadlineMs: 250,
      primaryActionsAssessed: 3,
      deadClicks: 1,
      deadClickRate: 1 / 3
    });
    expect(summary.intentToPricedDraft).toEqual({
      observationSource: "client",
      receiptAuthority: "server_authoritative",
      storage: "firebase",
      samples: 2,
      medianMs: 2000,
      p75Ms: 2500
    });
    expect(summary.issueResolution).toEqual({
      observationSource: "client",
      pairing: "same_session_exact_category",
      samples: 3,
      medianMs: 3000,
      p75Ms: 4000,
      byCategory: [
        { issueCategory: "workflow-attention", samples: 1, medianMs: 3000, p75Ms: 3000 },
        { issueCategory: "proposal-gap-menu", samples: 1, medianMs: 1000, p75Ms: 1000 },
        { issueCategory: "staffing-guidance", samples: 1, medianMs: 5000, p75Ms: 5000 }
      ]
    });
  });

  test("summarizes quote completion events as aggregate counts only", () => {
    const summary = summarizeAnalyticsEvents([
      event("wizard_started", 1),
      event("quote_completion_action_shown", 2, {
        completionState: "blocked",
        actionKind: "resolve_field",
        surface: "proposal_composer"
      }),
      event("quote_completion_action_resolved", 3, {
        completionState: "review_required",
        actionKind: "resolve_field",
        surface: "proposal_composer",
        result: "recovery"
      }),
      event("quote_completion_action_resolved", 5, {
        completionState: "sendable",
        actionKind: "send_proposal",
        surface: "proposal_composer",
        result: "success"
      }),
      event("quote_completion_sendable_reached", 4, {
        completionState: "sendable",
        surface: "review"
      }),
      {
        ...event("quote_completion_action_shown", 1, {
          completionState: "blocked",
          actionKind: "resolve_field",
          surface: "proposal_composer"
        }),
        sessionId: "session-without-start"
      }
    ]);

    expect(summary.quoteCompletion).toEqual({
      observationSource: "client",
      actionsShown: 1,
      actionsResolved: 1,
      actionResolutionRate: 1,
      sendableReached: 1
    });
    expect(JSON.stringify(summary.quoteCompletion)).not.toContain("quote");
    expect(JSON.stringify(summary.quoteCompletion)).not.toContain("customer");
  });

  test("omits orphan receipts, mismatched issue resolutions, and events outside a started session", () => {
    expect(summarizeAnalyticsEvents([
      event("wizard_started", 1),
      event("priced_draft_receipt_observed", 2, {
        durationMs: 900,
        pricingAuthority: "server_authoritative",
        storage: "firebase"
      }),
      event("ambient_issue_resolved", 3, {
        issueCategory: "workflow-attention",
        durationMs: 600
      }),
      {
        ...event("ambient_primary_action_assessed", 1, {
          primary: true,
          deadlineMs: 250,
          deadClick: true
        }),
        sessionId: "session-without-start"
      }
    ])).toMatchObject({
      ambientInteractions: {
        observationSource: "client",
        deadlineMs: 250,
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
    });
  });
});
