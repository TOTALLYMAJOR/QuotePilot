import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../firebase", () => ({
  db: null,
  firebaseReady: false
}));

import {
  buildCustomerWorkspaceDto,
  buildStaffProposalPreview,
  decodeCustomerPathId,
  encodeCustomerPathId,
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
});
