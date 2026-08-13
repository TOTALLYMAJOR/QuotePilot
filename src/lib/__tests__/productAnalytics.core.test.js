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
  getProductAnalyticsSummary,
  recordProductAnalyticsEvent
} from "../productAnalyticsCore";

function createStorageMock() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

describe("product analytics legacy core entry", () => {
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

  test("keeps legacy queue and session behavior without initializing Ambient state", async () => {
    expect(beginWizardAnalyticsSession({ organizationId: "org-one", mode: "create" }))
      .toEqual(expect.objectContaining({
        organizationId: "org-one",
        mode: "create",
        sequence: 1
      }));
    expect(recordProductAnalyticsEvent("quote_saved", {
      quoteId: "quote-private",
      note: "must not persist"
    })).toBe(true);

    const session = JSON.parse(sessionStorage.getItem(PRODUCT_ANALYTICS_STORAGE_KEYS.SESSION_KEY));
    const queue = JSON.parse(localStorage.getItem(PRODUCT_ANALYTICS_STORAGE_KEYS.QUEUE_KEY));
    expect(session).not.toHaveProperty("firstIntentAtMs");
    expect(session).not.toHaveProperty("ambientIssueStartedAtMs");
    expect(queue.map((entry) => entry.eventName)).toEqual(["wizard_started", "quote_saved"]);
    expect(queue[1]).not.toHaveProperty("quoteId");
    expect(queue[1]).not.toHaveProperty("note");

    await expect(getProductAnalyticsSummary({ organizationId: "org-one", days: 30 }))
      .resolves.toEqual({
        source: "local",
        days: 30,
        sessionsStarted: 0,
        quotesSaved: 0,
        completionRate: 0,
        funnel: [],
        addons: []
      });
  });

  test("refuses guarded Ambient names through the public legacy recorder", () => {
    beginWizardAnalyticsSession({ organizationId: "org-one", mode: "edit" });
    expect(recordProductAnalyticsEvent("first_intent_observed")).toBe(false);
    expect(recordProductAnalyticsEvent("ambient_primary_action_assessed", {
      primary: true,
      deadlineMs: 250,
      deadClick: false
    })).toBe(false);
  });
});
