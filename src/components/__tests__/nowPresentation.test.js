import { describe, expect, test } from "vitest";
import {
  NOW_CARD_LIMIT,
  NOW_HORIZON_DAYS,
  NOW_PRESENTATION_MODEL,
  buildNowCard,
  buildNowCards,
  buildNowDecisionSummary,
  buildNowHorizon,
  formatNowReceiptAge,
  describeNowEmptyState
} from "../nowPresentation";

const quoteFixture = {
  id: "q-1",
  quoteNumber: "Q-260810-0900-00001",
  customerId: "cust-1",
  customer: { name: "Elena Rivera", email: "elena@example.test" }
};

describe("buildNowCard", () => {
  test("quotes the customer's own change-request message and routes to the exact Workflow focus", () => {
    const card = buildNowCard(
      {
        id: "a-1",
        type: "change_request",
        state: "new_change_request",
        quoteId: "q-1",
        sourceMessage: "Please swap salmon for chicken.",
        sourceRequestId: "req-9"
      },
      [quoteFixture]
    );
    expect(card.title).toBe("Elena Rivera");
    expect(card.meta).toBe("Q-260810-0900-00001");
    expect(card.sentence).toContain("Please swap salmon for chicken.");
    expect(card.typeLabel).toBe("Customer request");
    expect(card.consequence).toBe("No resolution is recorded for this customer request.");
    expect(card.urgent).toBe(false);
    expect(card.action.label).toBe("Review request");
    expect(card.action.target).toEqual({
      surface: "workflow",
      quoteId: "q-1",
      attentionType: "change_request",
      requestId: "req-9"
    });
  });

  test("keeps the truthful fallback when a change request has no readable message", () => {
    const card = buildNowCard({ id: "a-2", type: "change_request", quoteId: "q-x" }, []);
    expect(card.sentence).toBe("The customer request has no readable message.");
  });

  test("interprets overdue and due-today follow-ups with correct pluralization", () => {
    const overdue = buildNowCard(
      { id: "a-3", type: "follow_up", quoteId: "q-1", daysOverdue: 3 },
      [quoteFixture]
    );
    expect(overdue.sentence).toBe("This proposal has waited 3 days past its follow-up date.");
    expect(overdue.typeLabel).toBe("Overdue follow-up");
    expect(overdue.urgent).toBe(true);
    expect(overdue.consequence).toBe("No follow-up outcome is recorded yet.");
    const single = buildNowCard(
      { id: "a-4", type: "follow_up", quoteId: "q-1", daysOverdue: 1 },
      [quoteFixture]
    );
    expect(single.sentence).toBe("This proposal has waited 1 day past its follow-up date.");
    const due = buildNowCard(
      { id: "a-5", type: "follow_up", quoteId: "q-1", daysOverdue: 0 },
      [quoteFixture]
    );
    expect(due.sentence).toBe("This proposal's follow-up is due today.");
    expect(due.action.label).toBe("Follow up");
    expect(due.action.target.requestId).toBe("a-5");
  });

  test("counts pending approvals and falls back to the first pending request id", () => {
    const card = buildNowCard(
      {
        id: "a-6",
        type: "approval",
        quoteId: "q-1",
        pendingRequests: [{ id: "req-1" }, { id: "req-2" }]
      },
      [quoteFixture]
    );
    expect(card.sentence).toBe("2 pending approvals are waiting on an admin decision.");
    expect(card.action.target.requestId).toBe("req-1");
    const one = buildNowCard(
      { id: "a-7", type: "approval", quoteId: "q-1", pendingRequests: [{ id: "req-1" }] },
      [quoteFixture]
    );
    expect(one.sentence).toBe("1 pending approval is waiting on an admin decision.");
  });

  test("preserves the exact blocked-closeout evidence language and marks it as risk", () => {
    const blockedSource = buildNowCard(
      { id: "a-8", type: "post_event_closeout", state: "blocked_source", quoteId: "q-1" },
      [quoteFixture]
    );
    expect(blockedSource.sentence).toBe(
      "This booked legacy record needs accepted-source review before authoritative closeout actions are available."
    );
    expect(blockedSource.signal).toBe("risk");
    expect(blockedSource.action.target.requestId).toBe("a-8");
    const blockedConfig = buildNowCard(
      { id: "a-9", type: "post_event_closeout", state: "blocked_configuration", quoteId: "q-1" },
      [quoteFixture]
    );
    expect(blockedConfig.sentence).toBe(
      "Set a valid business time zone before internal closeout review can be recorded."
    );
    expect(blockedConfig.signal).toBe("risk");
    const overdue = buildNowCard(
      { id: "a-10", type: "post_event_closeout", state: "overdue", quoteId: "q-1", daysOverdue: 2 },
      [quoteFixture]
    );
    expect(overdue.sentence).toBe("The post-event review is 2 days overdue.");
  });

  test("routes an anniversary card to Customer 360 only when the quote carries a customerId", () => {
    const withCustomer = buildNowCard(
      {
        id: "a-11",
        type: "anniversary_rebooking",
        quoteId: "q-1",
        eventName: "Rivera Wedding",
        sourceBound: { truncated: true },
        calendarContext: { source: "tenant" }
      },
      [quoteFixture]
    );
    expect(withCustomer.action.label).toBe("Review rebook");
    expect(withCustomer.action.target).toEqual({ surface: "customer", customerId: "cust-1" });
    expect(withCustomer.sentence).toContain("Rivera Wedding was booked this week last year.");
    expect(withCustomer.sentence).toContain("The latest quote-history scan is incomplete");

    const withoutCustomer = buildNowCard(
      {
        id: "a-12",
        type: "anniversary_rebooking",
        quoteId: "q-none",
        eventName: "Prior gala",
        calendarContext: { source: "fallback", label: "Fallback anniversary calendar" }
      },
      []
    );
    expect(withoutCustomer.action.target.surface).toBe("workflow");
    expect(withoutCustomer.sentence).toContain("Fallback anniversary calendar.");
  });

  test("gives an unread customer reply its own resolution verb", () => {
    const card = buildNowCard(
      { id: "a-13", type: "unread_customer_reply", quoteId: "q-1" },
      [quoteFixture]
    );
    expect(card.sentence).toBe("A customer reply is waiting in this event's conversation.");
    expect(card.action.label).toBe("Read reply");
  });

  test("degrades an unknown attention type to an honest generic card", () => {
    const card = buildNowCard({ id: "a-14", type: "mystery", quoteId: "q-1" }, [quoteFixture]);
    expect(card.sentence).toBe("This needs a look in Workflow.");
    expect(card.action.label).toBe("Open in Workflow");
  });

  test("prefers the canonical quote record over the item's embedded copy", () => {
    const card = buildNowCard(
      {
        id: "a-15",
        type: "follow_up",
        quoteId: "q-1",
        daysOverdue: 0,
        quote: { quoteNumber: "STALE", customer: { name: "Stale Name" } }
      },
      [quoteFixture]
    );
    expect(card.title).toBe("Elena Rivera");
    expect(card.meta).toBe("Q-260810-0900-00001");
  });
});

describe("Now decision presentation", () => {
  test("separates true urgency from general waiting in the headline", () => {
    const result = buildNowDecisionSummary({
      cards: [
        { urgent: true, typeLabel: "Overdue follow-up" },
        { urgent: false, typeLabel: "Customer request" },
        { urgent: false, typeLabel: "Admin decision" }
      ]
    });
    expect(result).toMatchObject({
      headline: "One overdue follow-up needs you today.",
      urgentCount: 1,
      waitingCount: 2
    });
    expect(result.supporting).toBe("Two other items are waiting for review.");
    expect(buildNowDecisionSummary({
      cards: [{ urgent: true, typeLabel: "Follow-up due today" }]
    }).headline).toBe("One follow-up needs you today.");
  });

  test("projects seven days from the supplied tenant-local date without a second calendar model", () => {
    const result = buildNowHorizon({
      nowISO: "2026-08-12T03:00:00.000Z",
      timeZone: "America/Chicago",
      urgentCount: 1,
      upcomingEvents: [{
        quoteNumber: "QP-1",
        event: { name: "Rivera Dinner", date: "2026-08-13", time: "17:00" }
      }]
    });
    expect(result).toHaveLength(NOW_HORIZON_DAYS);
    expect(result[0]).toMatchObject({ dateISO: "2026-08-11", urgentCount: 1, state: "urgent" });
    expect(result[2]).toMatchObject({ dateISO: "2026-08-13", eventCount: 1, state: "event" });
    expect(result[2].eventLabel).toBe("Rivera Dinner · 17:00");
  });

  test("formats only the elapsed age supported by the completion receipt", () => {
    expect(formatNowReceiptAge(
      { completedAtISO: "2026-08-12T14:20:00.000Z" },
      "2026-08-12T15:00:00.000Z"
    )).toBe("40m ago");
    expect(formatNowReceiptAge(
      { completedAtISO: "2026-08-11T14:00:00.000Z" },
      "2026-08-12T15:00:00.000Z"
    )).toBe("Yesterday");
  });
});

describe("buildNowCards", () => {
  test("bounds the stream and reports the exact overflow", () => {
    const items = Array.from({ length: NOW_CARD_LIMIT + 3 }, (_, index) => ({
      id: `a-${index}`,
      type: "follow_up",
      quoteId: "q-1",
      daysOverdue: 0
    }));
    const result = buildNowCards({ items, quotes: [quoteFixture] });
    expect(result.modelId).toBe(NOW_PRESENTATION_MODEL);
    expect(result.cards).toHaveLength(NOW_CARD_LIMIT);
    expect(result.overflowCount).toBe(3);
  });

  test("returns an empty bounded result for empty or malformed input", () => {
    expect(buildNowCards({}).cards).toEqual([]);
    expect(buildNowCards({ items: null }).overflowCount).toBe(0);
    expect(buildNowCards().cards).toEqual([]);
  });
});

describe("describeNowEmptyState", () => {
  test("keeps the bounded-snapshot honesty language when reads were truncated", () => {
    expect(describeNowEmptyState({ truncated: true })).toContain("bounded snapshot");
    expect(describeNowEmptyState({ truncated: false })).toContain("Nothing needs you right now.");
    expect(describeNowEmptyState()).toContain("Nothing needs you right now.");
  });
});
