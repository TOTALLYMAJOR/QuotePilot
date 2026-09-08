import { describe, expect, test } from "vitest";
import {
  buildCommercialSnapshotResult,
  createSnapshotRequestGeneration
} from "../useCommercialWorkspaceSnapshot";

describe("createSnapshotRequestGeneration", () => {
  test("invalidates an older request when a newer generation begins", () => {
    const guard = createSnapshotRequestGeneration();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  test("can invalidate an in-flight request during cleanup", () => {
    const guard = createSnapshotRequestGeneration();
    const request = guard.begin();
    guard.begin();

    expect(guard.isCurrent(request)).toBe(false);
  });
});

describe("buildCommercialSnapshotResult", () => {
  const attentionResult = {
    status: "fulfilled",
    value: { source: "firebase", quotes: [] }
  };
  const historyResult = {
    status: "fulfilled",
    value: { source: "firebase", quotes: [{ id: "quote-1" }], truncated: true }
  };

  test("records a last-success timestamp only after both staff reads complete", () => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult,
      historyResult,
      nowMs: 1234
    });

    expect(result).toMatchObject({
      loadedAt: 1234,
      source: "firebase",
      partial: false,
      stale: false,
      truncated: true,
      truncationKnown: true,
      reads: {
        attention: { status: "success", source: "firebase" },
        history: { status: "success", source: "firebase" }
      }
    });
  });

  test("marks a first incomplete read as partial without inventing a complete refresh", () => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult,
      historyResult: { status: "rejected", reason: new Error("Quote history unavailable.") },
      nowMs: 1234
    });

    expect(result.loadedAt).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.error).toBe("Quote history unavailable.");
    expect(result.reads.history.status).toBe("error");
    expect(result.truncationKnown).toBe(false);
  });

  test("retains prior data and marks it stale after a later incomplete refresh", () => {
    const current = {
      loadedAt: 900,
      source: "firebase",
      attentionSummary: { itemCount: 1 },
      quotes: [{ id: "retained" }],
      truncated: false,
      truncationKnown: true
    };
    const result = buildCommercialSnapshotResult({
      current,
      attentionResult: { status: "rejected", reason: new Error("Attention unavailable.") },
      historyResult,
      nowMs: 1234
    });

    expect(result.loadedAt).toBe(900);
    expect(result.stale).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.attentionSummary).toEqual(current.attentionSummary);
    expect(result.quotes).toEqual(current.quotes);
    expect(result.source).toBe(current.source);
    expect(result.truncated).toBe(current.truncated);
    expect(result.truncationKnown).toBe(true);
  });

  test("does not mislabel retained Firebase data when the only fresh result is local", () => {
    const current = {
      loadedAt: 900,
      source: "firebase",
      attentionSummary: { itemCount: 2 },
      quotes: [{ id: "firebase-retained" }],
      truncated: true,
      truncationKnown: true
    };
    const result = buildCommercialSnapshotResult({
      current,
      attentionResult: {
        status: "fulfilled",
        value: { source: "local", quotes: [{ id: "local-not-applied" }] }
      },
      historyResult: { status: "rejected", reason: new Error("History unavailable.") },
      nowMs: 1234
    });

    expect(result).toMatchObject({
      source: "firebase",
      attentionSummary: current.attentionSummary,
      quotes: current.quotes,
      truncated: true,
      truncationKnown: true,
      stale: true,
      partial: true
    });
  });

  test("does not mislabel retained local data when the only fresh result is Firebase", () => {
    const current = {
      loadedAt: 900,
      source: "local",
      attentionSummary: { itemCount: 1 },
      quotes: [{ id: "local-retained" }],
      truncated: false,
      truncationKnown: true
    };
    const result = buildCommercialSnapshotResult({
      current,
      attentionResult: { status: "rejected", reason: new Error("Attention unavailable.") },
      historyResult,
      nowMs: 1234
    });

    expect(result).toMatchObject({
      source: "local",
      attentionSummary: current.attentionSummary,
      quotes: current.quotes,
      truncated: false,
      truncationKnown: true,
      stale: true,
      partial: true
    });
  });

  test("records known truncation from the first successful history half-read", () => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult: { status: "rejected", reason: new Error("Attention unavailable.") },
      historyResult,
      nowMs: 1234
    });

    expect(result.loadedAt).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.truncationKnown).toBe(true);
    expect(result.truncated).toBe(true);
  });

  test("merges the bounded unread-reply read into the same complete Command Center snapshot", () => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult: {
        status: "fulfilled",
        value: { source: "firebase", quotes: [] }
      },
      historyResult: {
        status: "fulfilled",
        value: {
          source: "firebase",
          quotes: [{
            id: "quote-reply",
            customerId: "customer-reply",
            quoteNumber: "QP-REPLY",
            customer: { name: "Henderson Industries" }
          }],
          truncated: false
        }
      },
      unreadReplyResult: {
        status: "fulfilled",
        value: {
          source: "firebase_server_projection",
          attention: [{
            attentionId: "attention-reply",
            quoteId: "quote-reply",
            customerId: "customer-reply",
            messageId: "message-reply",
            kind: "unread_customer_reply",
            state: "open",
            receivedAtISO: "2026-08-09T15:30:00.000Z"
          }],
          bounds: { complete: true, truncated: false }
        }
      },
      nowMs: 2345
    });

    expect(result).toMatchObject({
      loadedAt: 2345,
      source: "firebase",
      partial: false,
      stale: false,
      reads: { unreadReplies: { status: "success", source: "firebase_server_projection" } },
      attentionSummary: {
        quoteCount: 1,
        itemCount: 1,
        counts: { unreadCustomerReplies: 1 }
      }
    });
    expect(result.attentionSummary.items[0]).toMatchObject({
      type: "unread_customer_reply",
      quoteId: "quote-reply",
      sourceRequestId: "attention-reply"
    });
  });

  test("retains the existing bounded Decision Debt projection for Clear the Deck composition", () => {
    const debtItem = {
      id: "decision-debt-42",
      quoteId: "quote-1",
      sourceRevisionId: "v0004",
      decisionType: "final_guest_count",
      label: "Confirm final guest count"
    };
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult,
      historyResult: {
        status: "fulfilled",
        value: { source: "firebase", quotes: [{ id: "quote-1" }], truncated: false }
      },
      decisionDebtResult: {
        status: "fulfilled",
        value: {
          source: "firebase_server_projection",
          items: [debtItem],
          bounds: { truncated: true, known: true }
        }
      },
      includeDecisionDebt: true,
      nowMs: 3456
    });

    expect(result).toMatchObject({
      loadedAt: 3456,
      source: "firebase",
      partial: false,
      stale: false,
      truncated: true,
      truncationKnown: true,
      decisionDebtItems: [debtItem],
      decisionDebtBounds: { truncated: true, known: true },
      reads: {
        decisionDebt: { status: "success", source: "firebase_server_projection" }
      }
    });
  });

  test("fails the Clear the Deck snapshot closed when Decision Debt cannot be read", () => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult,
      historyResult,
      decisionDebtResult: {
        status: "rejected",
        reason: new Error("Decision Debt unavailable.")
      },
      includeDecisionDebt: true,
      nowMs: 3456
    });

    expect(result).toMatchObject({
      loadedAt: 0,
      partial: true,
      stale: false,
      error: "Decision Debt unavailable.",
      reads: { decisionDebt: { status: "error" } }
    });
  });

  test("derives a tenant-week anniversary cue from the same bounded quote-history read", () => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult: {
        status: "fulfilled",
        value: { source: "firebase", quotes: [] }
      },
      historyResult: {
        status: "fulfilled",
        value: {
          source: "firebase",
          quotes: [{
            id: "quote-anniversary",
            organizationId: "org-one",
            customerId: "customer-henderson",
            quoteNumber: "QP-ANNIVERSARY",
            status: "booked",
            customer: { name: "Henderson Industries" },
            event: { name: "Corporate picnic", date: "2025-08-05" }
          }],
          truncated: true
        }
      },
      unreadReplyResult: {
        status: "fulfilled",
        value: {
          source: "firebase_server_projection",
          attention: [],
          bounds: { totalAttention: 0, complete: true, truncated: false }
        }
      },
      tenantTimeZone: "America/Chicago",
      nowMs: Date.parse("2026-08-09T12:00:00.000Z")
    });

    expect(result.attentionSummary).toMatchObject({
      quoteCount: 1,
      itemCount: 1,
      counts: { anniversaryRebookings: 1 },
      anniversaryCalendarContext: {
        date: "2026-08-09",
        source: "tenant",
        timeZone: "America/Chicago"
      },
      anniversaryBounds: {
        quoteSourceLimit: 200,
        quoteSourceTruncated: true,
        complete: false
      }
    });
    expect(result.attentionSummary.items[0]).toMatchObject({
      type: "anniversary_rebooking",
      state: "verification_required",
      customerId: "customer-henderson",
      routeIntent: "verify_exact_version_in_customer_360"
    });
  });

  test.each([
    {
      label: "does not treat job-only operations truncation as unread-reply truncation",
      totalAttention: 1,
      expectedTruncated: false
    },
    {
      label: "does expose an unread-reply result beyond the attention read bound",
      totalAttention: 2,
      expectedTruncated: true
    }
  ])("$label", ({ totalAttention, expectedTruncated }) => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult,
      historyResult: {
        status: "fulfilled",
        value: { source: "firebase", quotes: [{ id: "quote-1" }], truncated: false }
      },
      unreadReplyResult: {
        status: "fulfilled",
        value: {
          source: "firebase_server_projection",
          attention: [{
            attentionId: "attention-one",
            quoteId: "quote-1",
            messageId: "message-one",
            kind: "unread_customer_reply",
            state: "open"
          }],
          bounds: {
            totalAttention,
            complete: false,
            truncated: true
          }
        }
      },
      nowMs: 3000
    });

    expect(result.truncated).toBe(expectedTruncated);
    expect(result.truncationKnown).toBe(true);
  });

  test("keeps an unread-reply failure explicit instead of calling the shared snapshot complete", () => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult,
      historyResult,
      unreadReplyResult: {
        status: "rejected",
        reason: new Error("Unread reply Attention unavailable.")
      },
      nowMs: 3456
    });

    expect(result).toMatchObject({
      loadedAt: 0,
      partial: true,
      stale: false,
      error: "Unread reply Attention unavailable.",
      reads: { unreadReplies: { status: "error" } }
    });
  });
});
