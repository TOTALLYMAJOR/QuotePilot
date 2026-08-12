import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn()
}));

vi.mock("../firebase", () => ({
  cloudFunctions: null,
  firebaseReady: false
}));

import {
  PRODUCT_ANALYTICS_STORAGE_KEYS,
  beginWizardAnalyticsSession,
  flushProductAnalyticsEvents,
  getProductAnalyticsSummary,
  recordProductAnalyticsAmbientAssessment,
  recordProductAnalyticsEvent,
  recordProductAnalyticsFirstIntent,
  recordProductAnalyticsIssueResolved,
  recordProductAnalyticsIssueSurfaced,
  recordProductAnalyticsPricedDraftReceipt,
  resetProductAnalyticsIssueObservationState
} from "../productAnalytics";

function createStorageMock() {
  const values = new Map();
  return {
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function readQueue(localStorage) {
  return JSON.parse(localStorage.getItem(PRODUCT_ANALYTICS_STORAGE_KEYS.QUEUE_KEY) || "[]");
}

function readSession(sessionStorage) {
  return JSON.parse(sessionStorage.getItem(PRODUCT_ANALYTICS_STORAGE_KEYS.SESSION_KEY) || "null");
}

describe("product analytics client metric foundation", () => {
  let localStorage;
  let sessionStorage;

  beforeEach(() => {
    localStorage = createStorageMock();
    sessionStorage = createStorageMock();
    vi.stubGlobal("window", { localStorage, sessionStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("records first intent once and only accepts a server-authoritatively priced Firebase receipt", () => {
    expect(beginWizardAnalyticsSession({ organizationId: "org-one", mode: "create" }))
      .toMatchObject({ organizationId: "org-one", mode: "create", sequence: 1 });

    expect(recordProductAnalyticsPricedDraftReceipt({
      pricingAuthority: "server_authoritative",
      storage: "firebase",
      observedAtMs: 1200
    })).toBe(false);
    expect(recordProductAnalyticsFirstIntent({ observedAtMs: 1000 })).toBe(true);
    expect(recordProductAnalyticsFirstIntent({ observedAtMs: 1050 })).toBe(false);
    expect(recordProductAnalyticsPricedDraftReceipt({
      pricingAuthority: "client_preview",
      storage: "firebase",
      observedAtMs: 1500
    })).toBe(false);
    expect(recordProductAnalyticsPricedDraftReceipt({
      pricingAuthority: "server_authoritative",
      storage: "local",
      observedAtMs: 1500
    })).toBe(false);
    expect(recordProductAnalyticsPricedDraftReceipt({
      pricingAuthority: "server_authoritative",
      storage: "firebase",
      observedAtMs: 1600
    })).toBe(true);
    expect(recordProductAnalyticsPricedDraftReceipt({
      pricingAuthority: "server_authoritative",
      storage: "firebase",
      observedAtMs: 1700
    })).toBe(false);

    expect(readQueue(localStorage).map((entry) => entry.eventName)).toEqual([
      "wizard_started",
      "first_intent_observed",
      "priced_draft_receipt_observed"
    ]);
    expect(readQueue(localStorage)[2]).toMatchObject({
      durationMs: 600,
      pricingAuthority: "server_authoritative",
      storage: "firebase"
    });
    expect(readSession(sessionStorage)).toMatchObject({
      firstIntentAtMs: 1000,
      pricedDraftReceiptObserved: true,
      sequence: 3
    });
  });

  test("pairs issue timing by the exact closed category and can discard route-local observations", () => {
    beginWizardAnalyticsSession({ organizationId: "org-one", mode: "edit" });

    expect(recordProductAnalyticsIssueSurfaced({
      issueCategory: "workflow-attention",
      observedAtMs: 2000
    })).toBe(true);
    expect(recordProductAnalyticsIssueSurfaced({
      issueCategory: "workflow-attention",
      observedAtMs: 2200
    })).toBe(false);
    expect(recordProductAnalyticsIssueResolved({
      issueCategory: "staffing-guidance",
      observedAtMs: 2500
    })).toBe(false);
    expect(recordProductAnalyticsIssueResolved({
      issueCategory: "workflow-attention",
      observedAtMs: 2600
    })).toBe(true);
    expect(recordProductAnalyticsIssueResolved({
      issueCategory: "workflow-attention",
      observedAtMs: 2700
    })).toBe(false);
    expect(recordProductAnalyticsIssueSurfaced({
      issueCategory: "customer-entered-free-text",
      observedAtMs: 2800
    })).toBe(false);

    expect(recordProductAnalyticsIssueSurfaced({
      issueCategory: "proposal-gap-menu",
      observedAtMs: 3000
    })).toBe(true);
    expect(resetProductAnalyticsIssueObservationState()).toBe(true);
    expect(recordProductAnalyticsIssueResolved({
      issueCategory: "proposal-gap-menu",
      observedAtMs: 3500
    })).toBe(false);

    const issueEvents = readQueue(localStorage).filter((entry) => (
      entry.eventName.startsWith("ambient_issue_")
    ));
    expect(issueEvents).toEqual([
      expect.objectContaining({
        eventName: "ambient_issue_surfaced",
        issueCategory: "workflow-attention"
      }),
      expect.objectContaining({
        eventName: "ambient_issue_resolved",
        issueCategory: "workflow-attention",
        durationMs: 600
      }),
      expect.objectContaining({
        eventName: "ambient_issue_surfaced",
        issueCategory: "proposal-gap-menu"
      })
    ]);
  });

  test("records only primary bounded assessments and strips all caller-owned context", () => {
    beginWizardAnalyticsSession({ organizationId: "org-one", mode: "edit" });

    expect(recordProductAnalyticsAmbientAssessment({
      primary: false,
      deadlineMs: 250,
      deadClick: true,
      acknowledgementMs: 251,
      resultKind: "recovery"
    })).toBe(false);
    expect(recordProductAnalyticsAmbientAssessment({
      primary: true,
      deadlineMs: 250,
      deadClick: false,
      acknowledgementMs: 60100,
      resultKind: "receipt"
    })).toBe(false);
    expect(recordProductAnalyticsAmbientAssessment({
      primary: true,
      deadlineMs: 500,
      deadClick: true,
      resultKind: "recovery"
    })).toBe(false);
    expect(recordProductAnalyticsAmbientAssessment({
      primary: true,
      deadlineMs: 250,
      deadClick: false,
      acknowledgementMs: 117,
      resultKind: "context",
      quoteId: "quote-private",
      customerName: "Private Person",
      reason: "caller-owned explanation"
    })).toBe(true);
    expect(recordProductAnalyticsAmbientAssessment({
      primary: true,
      deadlineMs: 250,
      deadClick: true,
      resultKind: "recovery"
    })).toBe(true);

    const assessments = readQueue(localStorage).filter((entry) => (
      entry.eventName === "ambient_primary_action_assessed"
    ));
    expect(assessments).toHaveLength(2);
    expect(assessments[0]).toMatchObject({
      primary: true,
      deadlineMs: 250,
      deadClick: false,
      acknowledgementMs: 117,
      resultKind: "context"
    });
    expect(assessments[0]).not.toHaveProperty("quoteId");
    expect(assessments[0]).not.toHaveProperty("customerName");
    expect(assessments[0]).not.toHaveProperty("reason");
  });

  test("keeps the legacy event API compatible while dropping unsupported events and dimensions", async () => {
    beginWizardAnalyticsSession({ organizationId: "org-one", mode: "create" });
    expect(recordProductAnalyticsEvent("quote_saved", {
      quoteId: "quote-private",
      customerEmail: "private@example.test",
      note: "free text"
    })).toBe(true);
    expect(recordProductAnalyticsEvent("first_intent_observed")).toBe(false);
    expect(recordProductAnalyticsEvent("customer_named", {
      customerName: "Private Person"
    })).toBe(false);

    const saved = readQueue(localStorage).find((entry) => entry.eventName === "quote_saved");
    expect(saved).toBeTruthy();
    expect(saved).not.toHaveProperty("quoteId");
    expect(saved).not.toHaveProperty("customerEmail");
    expect(saved).not.toHaveProperty("note");

    const unsafeLegacy = {
      ...saved,
      sequence: saved.sequence + 1,
      customerEmail: "legacy-private@example.test",
      quoteId: "legacy-quote"
    };
    localStorage.setItem(
      PRODUCT_ANALYTICS_STORAGE_KEYS.QUEUE_KEY,
      JSON.stringify([unsafeLegacy])
    );
    expect(await flushProductAnalyticsEvents()).toEqual({ sent: 0, queued: 1 });
    expect(readQueue(localStorage)[0]).not.toHaveProperty("customerEmail");
    expect(readQueue(localStorage)[0]).not.toHaveProperty("quoteId");
  });

  test("returns explicit unavailable samples from local fallback", async () => {
    await expect(getProductAnalyticsSummary({ organizationId: "org-one", days: 30 }))
      .resolves.toMatchObject({
        source: "local",
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
