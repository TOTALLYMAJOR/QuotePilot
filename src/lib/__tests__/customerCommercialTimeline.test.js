import { describe, expect, test } from "vitest";
import {
  buildCustomerCommercialTimeline,
  CUSTOMER_COMMERCIAL_TIMELINE_MAX_LIMIT
} from "../customerCommercialTimeline";

function workspace(overrides = {}) {
  return {
    source: "firebase",
    customer: { customerId: "customer-1", id: "customer-1" },
    quotes: [],
    proposalVersions: [],
    money: [],
    conversations: [],
    quotePageInfo: { limit: 25, truncated: false },
    versionPageInfo: { perQuoteLimit: 10, truncatedQuoteIds: [] },
    ...overrides
  };
}

describe("customer commercial timeline adapter", () => {
  test("builds a descending, source-labeled timeline from recorded DTO milestones", () => {
    const timeline = buildCustomerCommercialTimeline(workspace({
      quotes: [{
        id: "quote-1",
        customerId: "customer-1",
        quoteNumber: "QP-1001",
        status: "booked",
        createdAtISO: "2026-08-09T08:00:00.000Z",
        lifecycle: {
          draftAtISO: "2026-08-09T08:00:00.000Z",
          sentAtISO: "2026-08-09T09:00:00.000Z",
          viewedAtISO: "2026-08-09T10:00:00.000Z",
          acceptedAtISO: "2026-08-09T11:00:00.000Z",
          bookedAtISO: "2026-08-09T14:00:00.000Z"
        },
        workflow: {
          quoteDelivery: {
            state: "provider_accepted",
            revisionId: "revision-2",
            providerAcceptedAtISO: "2026-08-09T09:01:00.000Z"
          }
        },
        portalDecision: {
          decision: "accepted",
          submittedAtISO: "2026-08-09T11:00:00.000Z"
        },
        acceptanceReceipt: {
          quoteRevisionId: "revision-2",
          acceptedAtISO: "2026-08-09T11:01:00.000Z"
        },
        booking: {
          bookedAtISO: "2026-08-09T14:00:00.000Z",
          contractConvertedAtISO: "2026-08-09T13:00:00.000Z"
        }
      }],
      proposalVersions: [
        {
          id: "revision-1",
          quoteId: "quote-1",
          quoteNumber: "QP-1001",
          versionNumber: 1,
          createdAtISO: "2026-08-09T08:30:00.000Z"
        },
        {
          id: "revision-2",
          quoteId: "quote-1",
          quoteNumber: "QP-1001",
          versionNumber: 2,
          createdAtISO: "2026-08-09T10:30:00.000Z"
        }
      ],
      money: [
        {
          quoteId: "quote-1",
          quoteNumber: "QP-1001",
          kind: "deposit",
          status: "paid",
          evidenceAtISO: "2026-08-09T12:00:00.000Z"
        },
        {
          quoteId: "quote-1",
          quoteNumber: "QP-1001",
          kind: "final_balance",
          status: "paid",
          evidenceAtISO: "2026-08-09T15:00:00.000Z"
        }
      ],
      conversations: [{
        quoteId: "quote-1",
        quoteNumber: "QP-1001",
        summaryAvailable: true,
        messageCount: 4,
        latestActorType: "customer",
        latestMessageAtISO: "2026-08-09T16:00:00.000Z"
      }]
    }));

    expect(timeline).toMatchObject({
      status: "success",
      source: "firebase",
      sourceLabel: "Firestore customer workspace",
      evidenceBoundary: "Recorded milestones only; provider acceptance, delivery, recipient view, booking, and payment remain distinct.",
      customerId: "customer-1"
    });
    expect(timeline.items.map((item) => item.code)).toEqual([
      "conversation_latest_activity",
      "final_balance_confirmed",
      "event_booked",
      "contract_created",
      "deposit_confirmed",
      "acceptance_receipt_recorded",
      "decision_accepted",
      "proposal_version_saved",
      "proposal_viewed",
      "provider_accepted",
      "proposal_sent",
      "proposal_version_saved",
      "quote_created"
    ]);
    expect(timeline.items.find((item) => item.code === "provider_accepted"))
      .toMatchObject({
        category: "delivery",
        revisionId: "revision-2",
        source: "quote.delivery",
        sourceLabel: "Recorded provider-acceptance audit"
      });
    expect(timeline.items.filter((item) => (
      ["decision_accepted", "proposal_accepted"].includes(item.code)
    ))).toHaveLength(1);
    expect(timeline.items.every((item, index, items) => (
      index === 0 || items[index - 1].atISO >= item.atISO
    ))).toBe(true);
  });

  test("does not infer delivery, view, decisions, booking, or payment from status-like fields", () => {
    const timeline = buildCustomerCommercialTimeline(workspace({
      quotes: [{
        id: "quote-1",
        customerId: "customer-1",
        quoteNumber: "QP-1001",
        status: "booked",
        lifecycle: {
          expiredAtISO: "2026-08-09T17:00:00.000Z"
        },
        workflow: {
          quoteDelivery: {
            state: "provider_accepted",
            providerDeliveryStatus: "delivered",
            bouncedAtISO: "2026-08-09T18:00:00.000Z"
          }
        },
        deliveryEvidence: {
          state: "provider_accepted",
          providerAcceptedAtISO: "2026-08-09T09:00:00.000Z"
        },
        portalDecision: { decision: "accepted" },
        booking: { confirmationStatus: "confirmed" },
        payment: {
          depositStatus: "paid",
          stripeCheckoutState: "paid",
          browserReturn: "success"
        }
      }],
      proposalVersions: [{
        id: "revision-1",
        quoteId: "quote-1",
        createdAtISO: "2026-08-09"
      }],
      money: [
        { quoteId: "quote-1", kind: "deposit", status: "paid", evidenceAtISO: "" },
        { quoteId: "quote-1", kind: "final_balance", status: "paid", evidenceAtISO: "2026-08-09" }
      ],
      conversations: [{
        quoteId: "quote-1",
        summaryAvailable: true,
        messageCount: 0,
        latestMessageAtISO: "2026-08-09T16:00:00.000Z"
      }]
    }));

    expect(timeline.status).toBe("empty");
    expect(timeline.items).toEqual([]);
    expect(timeline.items.map((item) => item.code)).not.toEqual(expect.arrayContaining([
      "provider_accepted",
      "proposal_viewed",
      "decision_accepted",
      "event_booked",
      "deposit_confirmed",
      "final_balance_confirmed"
    ]));
  });

  test("projects no portal tokens, provider IDs, message bodies, signatures, amounts, or raw records", () => {
    const timeline = buildCustomerCommercialTimeline(workspace({
      quotes: [{
        id: "quote-1",
        customerId: "customer-1",
        quoteNumber: "QP-1001",
        lifecycle: { viewedAtISO: "2026-08-09T10:00:00.000Z" },
        portalKey: "private-portal-token",
        portalDecision: {
          decision: "changes_requested",
          message: "private customer request body",
          submittedAtISO: "2026-08-09T11:00:00.000Z"
        },
        workflow: {
          quoteDelivery: {
            state: "provider_accepted",
            revisionId: "revision-1",
            providerAcceptedAtISO: "2026-08-09T09:00:00.000Z",
            providerMessageId: "private-provider-message-id",
            actorEmail: "private-staff@example.test"
          }
        },
        acceptanceReceipt: {
          quoteRevisionId: "revision-1",
          acceptedAtISO: "2026-08-09T12:00:00.000Z",
          signerName: "Private Signer",
          snapshotSha256: "private-snapshot-digest"
        }
      }],
      proposalVersions: [{
        id: "revision-1",
        quoteId: "quote-1",
        createdAtISO: "2026-08-09T08:00:00.000Z",
        reason: "private revision note",
        portalKey: "private-version-token"
      }],
      money: [{
        quoteId: "quote-1",
        kind: "deposit",
        status: "paid",
        amount: 12999,
        providerSessionId: "private-payment-session",
        evidenceAtISO: "2026-08-09T13:00:00.000Z"
      }],
      conversations: [{
        quoteId: "quote-1",
        summaryAvailable: true,
        messageCount: 2,
        latestActorType: "customer",
        latestMessageAtISO: "2026-08-09T14:00:00.000Z",
        latestMessageBody: "private message body"
      }]
    }));
    const serialized = JSON.stringify(timeline);

    for (const privateValue of [
      "private-portal-token",
      "private customer request body",
      "private-provider-message-id",
      "private-staff@example.test",
      "Private Signer",
      "private-snapshot-digest",
      "private revision note",
      "private-version-token",
      "private-payment-session",
      "private message body",
      "12999"
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(Object.keys(timeline.items[0]).sort()).toEqual([
      "atISO",
      "category",
      "code",
      "id",
      "label",
      "quoteId",
      "quoteNumber",
      "revisionId",
      "source",
      "sourceLabel"
    ]);
  });

  test("fails closed across customer scope and requires an opaque customer identity", () => {
    const timeline = buildCustomerCommercialTimeline(workspace({
      quotes: [
        {
          id: "quote-in-scope",
          customerId: "customer-1",
          createdAtISO: "2026-08-09T08:00:00.000Z"
        },
        {
          id: "quote-cross-customer",
          customerId: "customer-2",
          createdAtISO: "2026-08-09T09:00:00.000Z"
        }
      ],
      proposalVersions: [{
        id: "cross-version",
        quoteId: "quote-cross-customer",
        createdAtISO: "2026-08-09T10:00:00.000Z"
      }],
      money: [{
        quoteId: "quote-cross-customer",
        kind: "deposit",
        status: "paid",
        evidenceAtISO: "2026-08-09T11:00:00.000Z"
      }],
      conversations: [{
        quoteId: "quote-cross-customer",
        summaryAvailable: true,
        messageCount: 2,
        latestMessageAtISO: "2026-08-09T12:00:00.000Z"
      }],
      versionPageInfo: {
        perQuoteLimit: 10,
        truncatedQuoteIds: ["quote-cross-customer"]
      }
    }));

    expect(timeline.status).toBe("success");
    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0].quoteId).toBe("quote-in-scope");
    expect(timeline.pageInfo.versionReadTruncated).toBe(false);
    expect(JSON.stringify(timeline)).not.toContain("quote-cross-customer");
    expect(() => buildCustomerCommercialTimeline(workspace({
      customer: { customerId: "customer/unsafe" }
    }))).toThrow(/opaque customerId/);
    expect(() => buildCustomerCommercialTimeline(workspace({
      customer: { customerId: "customer@example.test" }
    }))).toThrow(/opaque customerId/);
  });

  test("caps output and carries upstream quote/version truncation evidence", () => {
    const proposalVersions = Array.from({ length: 60 }, (_, index) => ({
      id: `revision-${index}`,
      quoteId: "quote-1",
      versionNumber: index + 1,
      createdAtISO: new Date(Date.UTC(2026, 7, 9, 0, index)).toISOString()
    }));
    const timeline = buildCustomerCommercialTimeline(workspace({
      quotes: [{
        id: "quote-1",
        customerId: "customer-1",
        createdAtISO: "2026-08-08T00:00:00.000Z"
      }],
      proposalVersions,
      quotePageInfo: { limit: 25, truncated: true },
      versionPageInfo: {
        perQuoteLimit: 10,
        truncatedQuoteIds: ["quote-1", "quote-1"]
      }
    }), { limit: 500 });

    expect(timeline.status).toBe("partial");
    expect(timeline.items).toHaveLength(CUSTOMER_COMMERCIAL_TIMELINE_MAX_LIMIT);
    expect(timeline.pageInfo).toEqual({
      limit: CUSTOMER_COMMERCIAL_TIMELINE_MAX_LIMIT,
      returned: CUSTOMER_COMMERCIAL_TIMELINE_MAX_LIMIT,
      candidateCount: 61,
      truncated: true,
      timelineTruncated: true,
      quoteReadTruncated: true,
      quoteReadLimit: 25,
      versionReadTruncated: true,
      versionReadTruncatedQuoteCount: 1,
      versionPerQuoteLimit: 10
    });
  });

  test("keeps upstream partial evidence visible even when no milestone is present", () => {
    const timeline = buildCustomerCommercialTimeline(workspace({
      quotePageInfo: { limit: 25, truncated: true }
    }));

    expect(timeline.status).toBe("partial");
    expect(timeline.items).toEqual([]);
    expect(timeline.pageInfo).toMatchObject({
      returned: 0,
      candidateCount: 0,
      truncated: true,
      quoteReadTruncated: true
    });
  });
});
