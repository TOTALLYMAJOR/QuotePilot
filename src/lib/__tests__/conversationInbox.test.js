import { describe, expect, test } from "vitest";
import {
  filterConversationThreads,
  groupConversationThreads,
  mergeConversationThreads,
  normalizeConversationThread,
  resolveConversationThreadAvailability
} from "../conversationInbox";

function quote(id, overrides = {}) {
  const portalKey = `portal-${id}-12345678901234567890`;
  const portalIssuedAtISO = "2026-08-08T10:00:00.000Z";
  const revisionId = `v0001@${portalIssuedAtISO}`;
  return {
    id,
    quoteNumber: `Q-${id}`,
    customer: { name: `Customer ${id}` },
    event: { name: `Event ${id}`, date: "2026-08-12" },
    status: "sent",
    activeVersionId: "v0001",
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO: "2099-08-08T10:00:00.000Z",
    workflow: {
      quoteDelivery: {
        revisionId,
        state: "provider_accepted",
        portalActivationState: "active",
        providerMessageId: `provider-${id}`,
        providerAcceptedAtISO: "2026-08-08T10:05:00.000Z",
        portalKey,
        portalIssuedAtISO
      }
    },
    ...overrides
  };
}

describe("event-segregated conversation inbox", () => {
  test("normalizes only body-free event and conversation summary fields", () => {
    const thread = normalizeConversationThread(quote("one", {
      conversationSummary: {
        messageCount: 2,
        latestActorType: "customer",
        latestMessageId: "message-2",
        latestMessageAtISO: "2026-08-09T18:00:00.000Z",
        body: "must not leak"
      }
    }));
    expect(thread).toMatchObject({ quoteId: "one", needsReply: true, messageCount: 2 });
    expect(thread).not.toHaveProperty("body");
  });

  test("fails closed for draft, expired, or unaccepted portal records", () => {
    expect(resolveConversationThreadAvailability(quote("draft", { status: "draft" })).available).toBe(false);
    expect(normalizeConversationThread(quote("draft-override", {
      status: "draft",
      conversationAvailable: true
    })).conversationAvailable).toBe(false);
    expect(resolveConversationThreadAvailability(quote("expired", {
      portalExpiresAtISO: "2026-08-08T10:00:00.000Z"
    }), Date.parse("2026-08-09T10:00:00.000Z"))).toMatchObject({
      available: false,
      reason: expect.stringMatching(/expired/i)
    });
    expect(resolveConversationThreadAvailability(quote("unaccepted", {
      workflow: { quoteDelivery: { state: "failed" } }
    })).available).toBe(false);
  });

  test("keeps duplicate customers segregated by quote and prioritizes customer replies", () => {
    const sharedCustomer = { name: "Jordan Customer" };
    const threads = mergeConversationThreads([
      quote("event-a", { customer: sharedCustomer }),
      quote("event-b", {
        customer: sharedCustomer,
        conversationSummary: {
          messageCount: 1,
          latestActorType: "customer",
          latestMessageAtISO: "2026-08-09T18:00:00.000Z"
        }
      })
    ]);
    expect(threads.map((thread) => thread.quoteId)).toEqual(["event-b", "event-a"]);
  });

  test("merges live summaries over seed context and supports proof-safe filtering and grouping", () => {
    const threads = mergeConversationThreads(
      [quote("one"), quote("two", { event: { name: "Past Gala", date: "2026-07-01" } })],
      [quote("one", {
        conversationSummary: {
          messageCount: 3,
          latestActorType: "customer",
          latestMessageAtISO: "2026-08-09T18:00:00.000Z"
        }
      })]
    );
    expect(filterConversationThreads(threads, { filter: "needs-reply" }).map((thread) => thread.quoteId))
      .toEqual(["one"]);
    expect(filterConversationThreads(threads, { search: "past gala" }).map((thread) => thread.quoteId))
      .toEqual(["two"]);
    expect(groupConversationThreads(threads, new Date("2026-08-09T12:00:00"))
      .map((group) => group.label)).toEqual(["Needs reply", "Past or read-only"]);
  });

  test("groups zero-message terminal and past events as read-only before not-started threads", () => {
    const groups = groupConversationThreads([
      normalizeConversationThread(quote("declined", { status: "declined" })),
      normalizeConversationThread(quote("past", { event: { name: "Past Event", date: "2026-07-01" } })),
      normalizeConversationThread(quote("upcoming", { event: { name: "Upcoming Event", date: "2026-09-01" } }))
    ], new Date("2026-08-09T12:00:00"));

    expect(groups.map((group) => [group.label, group.threads.map((thread) => thread.quoteId)]))
      .toEqual([
        ["Past or read-only", ["declined", "past"]],
        ["No messages yet", ["upcoming"]]
      ]);
  });
});
