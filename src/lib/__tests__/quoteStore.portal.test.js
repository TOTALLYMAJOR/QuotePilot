import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../firebase", () => ({
  db: null,
  firebaseReady: false
}));

import {
  getPortalQuote,
  rotateQuotePortalKey,
  updatePortalDecision,
  updatePortalQuoteStatus
} from "../quoteStore";

const LOCAL_QUOTES_KEY = "quoteWizard.quotes";

function createStorageMock() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      Object.keys(store).forEach((key) => delete store[key]);
    }
  };
}

function makeQuote(overrides = {}) {
  const nowISO = "2026-03-10T12:00:00.000Z";
  const base = {
    id: "quote-portal-1",
    quoteNumber: "Q-260310-1200-22222",
    status: "sent",
    portalKey: "portal-key-12345678901234567890",
    portalIssuedAtISO: "2026-03-10T12:00:00.000Z",
    portalExpiresAtISO: "2026-04-09T12:00:00.000Z",
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    expiresAtISO: "2026-04-09T12:00:00.000Z",
    customer: {
      name: "Portal Client",
      email: "portal-client@example.com",
      phone: "205-555-0199"
    },
    event: {
      name: "Portal Event",
      date: "2026-04-20",
      venue: "Portal Venue",
      guests: 90
    },
    totals: {
      total: 7200,
      deposit: 2160
    },
    payment: {
      depositLink: "",
      depositStatus: "unpaid",
      depositConfirmedAtISO: ""
    },
    booking: {
      bookedAtISO: "",
      bookedByEmail: "",
      staffLead: "",
      staffAssignedAtISO: "",
      contractNumber: "",
      contractConvertedAtISO: "",
      contractConvertedByEmail: "",
      confirmationStatus: "pending",
      confirmationSentAtISO: "",
      confirmedAtISO: "",
      confirmationUpdatedByEmail: "",
      availabilityCheckedAtISO: "",
      availabilitySummary: {}
    },
    quoteMeta: {},
    lifecycle: {
      sentAtISO: nowISO
    }
  };

  return {
    ...base,
    ...overrides,
    customer: {
      ...base.customer,
      ...(overrides.customer || {})
    },
    event: {
      ...base.event,
      ...(overrides.event || {})
    },
    totals: {
      ...base.totals,
      ...(overrides.totals || {})
    },
    payment: {
      ...base.payment,
      ...(overrides.payment || {})
    },
    booking: {
      ...base.booking,
      ...(overrides.booking || {})
    },
    quoteMeta: {
      ...base.quoteMeta,
      ...(overrides.quoteMeta || {})
    },
    lifecycle: {
      ...base.lifecycle,
      ...(overrides.lifecycle || {})
    }
  };
}

function seedQuotes(quotes) {
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(quotes));
}

describe("quoteStore portal token policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));
    vi.stubGlobal("localStorage", createStorageMock());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("loads active portal quote link", async () => {
    seedQuotes([makeQuote()]);
    const quote = await getPortalQuote("portal-key-12345678901234567890");
    expect(quote.portalKey).toBe("portal-key-12345678901234567890");
    expect(quote.portalExpiresAtISO).toBeTruthy();
    expect(Number(quote.portalExpiresAtMs)).toBeGreaterThan(0);
  });

  test("projects enriched branding and service-charge context while legacy quotes still load", async () => {
    seedQuotes([makeQuote({
      totals: { serviceFee: 612, serviceFeePctApplied: 0.18 },
      quoteMeta: {
        organizationName: "Northstar Events",
        brandName: "Northstar Catering",
        brandLogoUrl: "https://cdn.example.test/logo.png",
        businessEmail: "events@northstar.test",
        businessPhone: "205-555-0100",
        brandPrimaryColor: "#8d611a"
      }
    })]);
    const enriched = await getPortalQuote("portal-key-12345678901234567890");
    expect(enriched.totals.serviceFeePctApplied).toBe(0.18);
    expect(enriched.quoteMeta).toMatchObject({
      organizationName: "Northstar Events",
      brandName: "Northstar Catering",
      businessEmail: "events@northstar.test"
    });

    seedQuotes([makeQuote({ quoteMeta: {}, totals: { serviceFee: 612 } })]);
    const legacy = await getPortalQuote("portal-key-12345678901234567890");
    expect(legacy.quoteMeta.organizationName).toBe("");
    expect(legacy.quoteMeta.brandName).toBe("");
    expect(legacy.totals).not.toHaveProperty("serviceFeePctApplied");
  });

  test("records the first portal view once and preserves its timestamp on reload", async () => {
    seedQuotes([makeQuote()]);

    const firstResult = await updatePortalQuoteStatus(
      "portal-key-12345678901234567890",
      "viewed"
    );
    const firstView = await getPortalQuote("portal-key-12345678901234567890");
    expect(firstResult).toMatchObject({ status: "viewed", storage: "local" });
    expect(firstView.status).toBe("viewed");
    expect(firstView.lifecycle.viewedAtISO).toBe("2026-03-20T12:00:00.000Z");

    vi.setSystemTime(new Date("2026-03-20T12:05:00.000Z"));
    const repeatedResult = await updatePortalQuoteStatus(
      "portal-key-12345678901234567890",
      "viewed"
    );
    const repeatedView = await getPortalQuote("portal-key-12345678901234567890");
    expect(repeatedResult.storage).toBe("unchanged");
    expect(repeatedView.lifecycle.viewedAtISO).toBe(firstView.lifecycle.viewedAtISO);
  });

  test("stores a customer change request without accepting or booking the quote", async () => {
    seedQuotes([makeQuote()]);

    const result = await updatePortalDecision({
      portalKey: "portal-key-12345678901234567890",
      decision: "changes_requested",
      message: "Please replace the salmon entree."
    });

    expect(result.status).toBe("viewed");
    expect(result.portalDecision).toMatchObject({
      decision: "changes_requested",
      message: "Please replace the salmon entree."
    });
    expect(result.portalDecision.requestId).toMatch(/^[a-zA-Z0-9-]{20,80}$/);
    const refreshed = await getPortalQuote("portal-key-12345678901234567890");
    expect(refreshed.status).toBe("viewed");
    expect(refreshed.portalDecision.decision).toBe("changes_requested");
    expect(refreshed.portalDecision.requestId).toBe(result.portalDecision.requestId);
  });

  test("keeps fallback request IDs compatible with the Firestore rule contract", async () => {
    vi.stubGlobal("crypto", {});
    vi.spyOn(Math, "random").mockReturnValue(0);
    seedQuotes([makeQuote()]);

    const result = await updatePortalDecision({
      portalKey: "portal-key-12345678901234567890",
      decision: "changes_requested",
      message: "Please replace the salmon entree."
    });

    expect(result.portalDecision.requestId).toMatch(/^[a-zA-Z0-9-]{20,80}$/);
    expect(result.portalDecision.requestId).toHaveLength(21);
  });

  test("rejects decisions for drafts and prevents terminal decision rewrites", async () => {
    seedQuotes([makeQuote({ status: "draft" })]);
    await expect(updatePortalDecision({
      portalKey: "portal-key-12345678901234567890",
      decision: "accepted"
    })).rejects.toThrow(/has not been sent/i);

    seedQuotes([
      makeQuote({
        status: "accepted",
        portalDecision: {
          decision: "accepted",
          message: "",
          submittedAtISO: "2026-03-20T10:00:00.000Z"
        },
        lifecycle: {
          acceptedAtISO: "2026-03-20T10:00:00.000Z"
        }
      })
    ]);
    await expect(updatePortalDecision({
      portalKey: "portal-key-12345678901234567890",
      decision: "declined"
    })).rejects.toThrow(/decision is final/i);
  });

  test("blocks expired portal tokens", async () => {
    seedQuotes([
      makeQuote({
        portalExpiresAtISO: "2020-01-01T00:00:00.000Z"
      })
    ]);

    await expect(getPortalQuote("portal-key-12345678901234567890")).rejects.toThrow(/invalid or expired/i);
    await expect(updatePortalQuoteStatus("portal-key-12345678901234567890", "viewed")).rejects.toThrow(/invalid or expired/i);
  });

  test("rotates portal token and invalidates old key", async () => {
    seedQuotes([
      makeQuote({
        portalExpiresAtISO: "2020-01-01T00:00:00.000Z",
        expiresAtISO: "2026-12-01T00:00:00.000Z"
      })
    ]);

    const result = await rotateQuotePortalKey({
      quoteId: "quote-portal-1",
      actorEmail: "ops@acme.test"
    });
    expect(result.portalKey).not.toBe("portal-key-12345678901234567890");
    expect(result.portalExpiresAtISO).toBeTruthy();

    await expect(getPortalQuote("portal-key-12345678901234567890")).rejects.toThrow(/not found/i);

    const refreshed = await getPortalQuote(result.portalKey);
    expect(refreshed.portalKey).toBe(result.portalKey);
    expect(refreshed.portalExpiresAtISO).toBe(result.portalExpiresAtISO);
  });
});
