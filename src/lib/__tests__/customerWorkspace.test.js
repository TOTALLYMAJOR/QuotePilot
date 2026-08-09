import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../firebase", () => ({
  db: null,
  firebaseReady: false
}));

import {
  buildCustomerBriefing,
  buildCustomerWorkspaceDto,
  buildStaffProposalPreview,
  decodeCustomerPathId,
  encodeCustomerPathId,
  getCustomerDirectoryPage,
  getCustomerWorkspace,
  normalizeCustomerSearchKey
} from "../customerWorkspace";

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

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorageMock());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("customer workspace identity helpers", () => {
  test("normalizes server search keys without using email as route identity", () => {
    expect(normalizeCustomerSearchKey("  Ada   LOVELACE ")).toBe("ada lovelace");
    expect(encodeCustomerPathId("cust_01ABC xyz")).toBe("cust_01ABC%20xyz");
    expect(decodeCustomerPathId("cust_01ABC%20xyz")).toBe("cust_01ABC xyz");
    expect(decodeCustomerPathId("customer%2Fescape")).toBe("");
  });
});

describe("buildCustomerWorkspaceDto", () => {
  const quote = {
    id: "quote-1",
    organizationId: "org-1",
    customerId: "customer-1",
    quoteNumber: "Q-1001",
    status: "accepted",
    customer: { name: "Ada Lovelace", email: "ada@example.test" },
    event: { name: "Launch dinner", date: "2026-09-01", venue: "Museum", guests: 80 },
    totals: { subtotal: 9000, tax: 720, total: 9720, deposit: 2500 },
    payment: { depositStatus: "unpaid" },
    lifecycle: { acceptedAtISO: "2026-08-08T10:00:00.000Z" },
    updatedAtISO: "2026-08-08T10:00:00.000Z"
  };

  test("keeps proposal acceptance, booking, and payment as distinct facts", () => {
    const dto = buildCustomerWorkspaceDto({
      customer: { id: "customer-1", name: "Ada Lovelace", email: "ada@example.test" },
      quotes: [quote],
      versionsByQuote: { "quote-1": [{ id: "v1", createdAtISO: "2026-08-08T09:00:00.000Z" }] }
    });

    expect(dto.activeQuotes).toHaveLength(1);
    expect(dto.events[0]).toMatchObject({ status: "accepted", contractNumber: "", beoAvailable: false });
    expect(dto.money).toContainEqual(expect.objectContaining({ kind: "deposit", status: "unpaid", amount: 2500 }));
    expect(dto.proposalVersions[0]).toMatchObject({ quoteId: "quote-1", id: "v1" });
    expect(dto.nextAction).toMatchObject({ kind: "quote", quoteId: "quote-1" });
  });

  test("aggregates conversation entry points without merging quote histories", () => {
    const dto = buildCustomerWorkspaceDto({ customer: { id: "customer-1" }, quotes: [quote] });
    expect(dto.conversations).toEqual([
      expect.objectContaining({
        quoteId: "quote-1",
        quoteNumber: "Q-1001",
        summaryAvailable: false,
        messageCount: null
      })
    ]);
  });

  test("projects server-owned per-quote conversation summaries without merging messages", () => {
    const dto = buildCustomerWorkspaceDto({
      customer: { id: "customer-1" },
      quotes: [{
        ...quote,
        conversationSummary: {
          messageCount: 3,
          latestMessageAtISO: "2026-08-08T11:30:00.000Z",
          latestActorType: "customer"
        }
      }]
    });

    expect(dto.conversations).toEqual([{
      quoteId: "quote-1",
      quoteNumber: "Q-1001",
      status: "accepted",
      summaryAvailable: true,
      messageCount: 3,
      latestMessageAtISO: "2026-08-08T11:30:00.000Z",
      latestActorType: "customer"
    }]);
    expect(dto.recentActivity[0]).toMatchObject({
      quoteId: "quote-1",
      label: "Customer sent a conversation message"
    });
  });

  test("reports version truncation only from explicit read evidence", () => {
    const versions = Array.from({ length: 10 }, (_, index) => ({ id: `v${index + 1}` }));
    const complete = buildCustomerWorkspaceDto({
      customer: { id: "customer-1" },
      quotes: [quote],
      versionsByQuote: { "quote-1": versions }
    });
    const truncated = buildCustomerWorkspaceDto({
      customer: { id: "customer-1" },
      quotes: [quote],
      versionsByQuote: { "quote-1": versions },
      versionTruncatedQuoteIds: ["quote-1"]
    });

    expect(complete.versionPageInfo.truncatedQuoteIds).toEqual([]);
    expect(truncated.versionPageInfo.truncatedQuoteIds).toEqual(["quote-1"]);
  });

  test("applies canonical expiry semantics before active and attention derivation", () => {
    const dto = buildCustomerWorkspaceDto({
      customer: { id: "customer-1" },
      nowISO: "2026-08-08T12:00:00.000Z",
      quotes: [
        {
          ...quote,
          id: "expired-sent",
          status: "sent",
          expiresAtISO: "2026-08-08T11:59:59.000Z",
          portalDecision: {
            decision: "changes_requested",
            requestId: "request-1",
            message: "Please update the menu.",
            submittedAtISO: "2026-08-08T10:00:00.000Z"
          }
        },
        {
          ...quote,
          id: "accepted-stays-active",
          status: "accepted",
          expiresAtISO: "2026-08-01T00:00:00.000Z",
          payment: { depositStatus: "paid" }
        }
      ]
    });

    expect(dto.quotes.find((item) => item.id === "expired-sent")).toMatchObject({
      status: "expired",
      lifecycle: { expiredAtISO: "2026-08-08T12:00:00.000Z" }
    });
    expect(dto.activeQuotes.map((item) => item.id)).toEqual(["accepted-stays-active"]);
    expect(dto.attention.itemCount).toBe(0);
    expect(dto.nextAction).toEqual({ kind: "none", label: "No immediate staff action" });
  });

  test("uses only the server-owned deposit confirmation timestamp as payment evidence", () => {
    const dto = buildCustomerWorkspaceDto({
      customer: { id: "customer-1" },
      quotes: [{
        ...quote,
        payment: {
          depositStatus: "paid",
          paidAtISO: "2026-08-08T08:00:00.000Z",
          depositConfirmedAtISO: "2026-08-08T09:00:00.000Z"
        }
      }]
    });

    expect(dto.money.find((row) => row.kind === "deposit")?.evidenceAtISO)
      .toBe("2026-08-08T09:00:00.000Z");
  });

  test("preserves unknown commercial numbers as null and genuine zeroes as zero", () => {
    const dto = buildCustomerWorkspaceDto({
      customer: { id: "customer-1" },
      quotes: [
        {
          ...quote,
          id: "unknown-values",
          quoteNumber: "Q-UNKNOWN",
          event: { ...quote.event, guests: undefined },
          totals: {
            subtotal: undefined,
            tax: Number.NaN,
            total: Number.POSITIVE_INFINITY,
            deposit: ""
          },
          payment: {
            depositStatus: "unpaid",
            finalBalance: { status: "sent", amountCents: "not-a-number" }
          }
        },
        {
          ...quote,
          id: "zero-values",
          quoteNumber: "Q-ZERO",
          event: { ...quote.event, guests: 0 },
          totals: { subtotal: 0, tax: 0, total: 0, deposit: 0 },
          payment: {
            depositStatus: "unpaid",
            finalBalance: { status: "unpaid", amountCents: 0 }
          }
        }
      ]
    });

    expect(dto.events.find((event) => event.quoteId === "unknown-values")?.guests).toBeNull();
    expect(dto.events.find((event) => event.quoteId === "zero-values")?.guests).toBe(0);
    expect(dto.money.find((row) => (
      row.quoteId === "unknown-values" && row.kind === "deposit"
    ))?.amount).toBeNull();
    expect(dto.money.find((row) => (
      row.quoteId === "unknown-values" && row.kind === "final_balance"
    ))?.amount).toBeNull();
    expect(dto.money.find((row) => (
      row.quoteId === "zero-values" && row.kind === "deposit"
    ))?.amount).toBe(0);
    expect(dto.money.find((row) => (
      row.quoteId === "zero-values" && row.kind === "final_balance"
    ))?.amount).toBe(0);
  });

  test("loads retained local proposal versions for Customer 360", async () => {
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
    localStorage.setItem("quoteWizard.quoteHistory", JSON.stringify([
      {
        id: "history-2",
        versionId: "v0002",
        versionNumber: 2,
        quoteId: "quote-1",
        organizationId: "org-1",
        timestamp: "2026-08-08T11:00:00.000Z",
        snapshot: quote
      },
      {
        id: "history-1",
        versionId: "v0001",
        versionNumber: 1,
        quoteId: "quote-1",
        organizationId: "org-1",
        timestamp: "2026-08-08T10:00:00.000Z",
        snapshot: quote
      }
    ]));

    const workspace = await getCustomerWorkspace({ organizationId: "org-1", customerId: "customer-1" });

    expect(workspace?.source).toBe("local");
    expect(workspace?.proposalVersions.map((version) => version.versionId))
      .toEqual(["v0002", "v0001"]);
    expect(workspace?.proposalVersions[0]).toMatchObject({
      quoteId: "quote-1",
      createdAtISO: "2026-08-08T11:00:00.000Z"
    });
  });

  test("fails closed across local tenant, customer, quote, and version collisions", async () => {
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([
      {
        ...quote,
        id: "colliding-quote",
        organizationId: "org-1",
        customerId: "colliding-customer",
        customer: { name: "Org One Customer", email: "one@example.test" }
      },
      {
        ...quote,
        id: "colliding-quote",
        organizationId: "org-2",
        customerId: "colliding-customer",
        customer: { name: "Org Two Customer", email: "two@example.test" }
      },
      {
        ...quote,
        id: "unscoped-quote",
        organizationId: "",
        customerId: "unscoped-customer",
        customer: { name: "Unscoped Customer", email: "legacy@example.test" }
      }
    ]));
    localStorage.setItem("quoteWizard.quoteHistory", JSON.stringify([
      {
        id: "org-2-version",
        versionId: "org-2-version",
        quoteId: "colliding-quote",
        organizationId: "org-2",
        timestamp: "2026-08-08T12:00:00.000Z"
      },
      {
        id: "unscoped-version",
        versionId: "unscoped-version",
        quoteId: "colliding-quote",
        timestamp: "2026-08-08T11:30:00.000Z"
      },
      {
        id: "org-1-version",
        versionId: "org-1-version",
        quoteId: "colliding-quote",
        organizationId: "org-1",
        timestamp: "2026-08-08T11:00:00.000Z"
      }
    ]));

    const directory = await getCustomerDirectoryPage({ organizationId: "org-1" });
    expect(directory.items).toHaveLength(1);
    expect(directory.items[0]).toMatchObject({
      id: "colliding-customer",
      name: "Org One Customer",
      email: "one@example.test"
    });

    const workspace = await getCustomerWorkspace({
      organizationId: "org-1",
      customerId: "colliding-customer"
    });
    expect(workspace?.quotes).toHaveLength(1);
    expect(workspace?.quotes[0]).toMatchObject({
      id: "colliding-quote",
      organizationId: "org-1"
    });
    expect(workspace?.proposalVersions.map((version) => version.versionId))
      .toEqual(["org-1-version"]);
    await expect(getCustomerWorkspace({
      organizationId: "org-1",
      customerId: "unscoped-customer"
    })).resolves.toBeNull();
  });
});

describe("buildCustomerBriefing", () => {
  test("selects bounded relationship context without manufacturing future activity", () => {
    const briefing = buildCustomerBriefing({
      quotes: [{ id: "q1" }, { id: "q2" }],
      activeQuotes: [{ id: "q2" }],
      events: [
        { quoteId: "past", eventName: "Past dinner", date: "2026-08-01", time: "18:00" },
        { quoteId: "later", eventName: "Holiday party", date: "2026-12-10", time: "19:00" },
        { quoteId: "next", eventName: "Board dinner", date: "2026-09-01", time: "17:00" }
      ],
      attention: { itemCount: 2 },
      recentActivity: [{ quoteId: "q2", label: "Proposal accepted", atISO: "2026-08-08T10:00:00.000Z" }],
      nextAction: { kind: "workflow", label: "Review the customer change request", quoteId: "q2" },
      quotePageInfo: { limit: 25, truncated: true },
      nowISO: "2026-08-09T12:00:00.000Z",
      todayDate: "2026-08-09"
    });

    expect(briefing).toEqual({
      activeQuoteCount: 1,
      displayedQuoteCount: 2,
      attentionCount: 2,
      nextEvent: expect.objectContaining({ quoteId: "next", eventName: "Board dinner" }),
      latestActivity: expect.objectContaining({ quoteId: "q2", label: "Proposal accepted" }),
      nextAction: expect.objectContaining({ kind: "workflow", quoteId: "q2" }),
      scope: { limit: 25, truncated: true }
    });
  });

  test("uses an explicit workspace calendar date across UTC date boundaries", () => {
    const briefing = buildCustomerBriefing({
      events: [
        { quoteId: "same-day", date: "2026-08-09", time: "19:00" },
        { quoteId: "tomorrow", date: "2026-08-10", time: "09:00" }
      ],
      nowISO: "2026-08-10T04:30:00.000Z",
      todayDate: "2026-08-09"
    });

    expect(briefing.nextEvent?.quoteId).toBe("same-day");
  });
});

describe("buildStaffProposalPreview", () => {
  test("adapts canonical data without creating portal evidence", () => {
    const preview = buildStaffProposalPreview({
      id: "quote-1",
      quoteNumber: "Q-1001",
      status: "sent",
      customer: { name: "Ada" },
      event: { name: "Dinner", guests: 10 },
      totals: { total: 500, deposit: 100 },
      quoteMeta: {
        organizationName: "Northstar Events LLC",
        brandName: "Northstar Catering",
        brandTagline: "Gather beautifully",
        brandLogoUrl: "https://cdn.example.test/logo.png",
        brandPrimaryColor: "#436b55",
        brandAccentColor: "#a7c4a0",
        brandDarkAccentColor: "#294536",
        brandBackgroundStart: "#f4f7f1",
        brandBackgroundMid: "#e1eadc",
        brandBackgroundEnd: "#d5e1cf",
        businessEmail: "hello@northstar.example",
        businessPhone: "205-555-0101",
        businessAddress: "100 Main Street",
        brandCrew: [{ label: "Culinary lead", imageUrl: "https://cdn.example.test/chef.png" }]
      }
    });
    expect(preview).toMatchObject({ quoteId: "quote-1", total: 500, portalEvidenceChanged: false });
    expect(preview.branding).toMatchObject({
      organizationName: "Northstar Events LLC",
      brandName: "Northstar Catering",
      brandTagline: "Gather beautifully",
      brandLogoUrl: "https://cdn.example.test/logo.png",
      brandPrimaryColor: "#436b55",
      brandBackgroundEnd: "#d5e1cf",
      businessEmail: "hello@northstar.example"
    });
    expect(preview.branding.brandCrew).toEqual([
      { label: "Culinary lead", imageUrl: "https://cdn.example.test/chef.png" }
    ]);
    expect(preview).not.toHaveProperty("portalKey");
  });

  test("distinguishes absent and non-finite values from genuine zeroes", () => {
    const unknown = buildStaffProposalPreview({
      event: { guests: undefined },
      totals: {
        subtotal: undefined,
        tax: Number.NaN,
        total: Number.POSITIVE_INFINITY,
        deposit: ""
      }
    });
    const zero = buildStaffProposalPreview({
      event: { guests: 0 },
      totals: { subtotal: 0, tax: 0, total: 0, deposit: 0 }
    });

    expect(unknown).toMatchObject({
      guests: null,
      subtotal: null,
      tax: null,
      total: null,
      deposit: null
    });
    expect(zero).toMatchObject({
      guests: 0,
      subtotal: 0,
      tax: 0,
      total: 0,
      deposit: 0
    });
  });
});
