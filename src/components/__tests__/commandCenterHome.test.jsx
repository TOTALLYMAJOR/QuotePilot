import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import CommandCenterHome, {
  attentionRowCopy,
  buildMoneyRows,
  selectUpcomingEvents,
  summarizeMoneyRows
} from "../CommandCenterHome";

describe("attentionRowCopy", () => {
  test("echoes the customer's own change-request message and identity", () => {
    const { detail, meta } = attentionRowCopy({
      type: "change_request",
      sourceMessage: "Please add a vegan station.",
      quote: { quoteNumber: "Q-2041", customer: { name: "Marisa Henderson" } },
      quoteId: "q-1"
    });
    expect(detail).toBe("Please add a vegan station.");
    expect(meta).toBe("Marisa Henderson · Q-2041");
  });

  test("falls back to a readable message when the customer note is blank", () => {
    const { detail } = attentionRowCopy({ type: "change_request", quote: {}, quoteId: "q-2" });
    expect(detail).toBe("The customer request has no readable message.");
  });

  test("labels overdue vs due-today follow-ups distinctly", () => {
    expect(attentionRowCopy({ type: "follow_up", daysOverdue: 3, quote: {}, quoteId: "q-3" }).detail)
      .toBe("3 days overdue");
    expect(attentionRowCopy({ type: "follow_up", daysOverdue: 1, quote: {}, quoteId: "q-4" }).detail)
      .toBe("1 day overdue");
    expect(attentionRowCopy({ type: "follow_up", daysOverdue: 0, quote: {}, quoteId: "q-5" }).detail)
      .toBe("Due today");
  });

  test("pluralizes pending approval count", () => {
    expect(attentionRowCopy({ type: "approval", pendingRequests: [{}], quote: {}, quoteId: "q-6" }).detail)
      .toBe("1 pending approval");
    expect(attentionRowCopy({ type: "approval", pendingRequests: [{}, {}], quote: {}, quoteId: "q-7" }).detail)
      .toBe("2 pending approvals");
  });

  test("falls back to email, then a generic label, when no customer name is set", () => {
    expect(attentionRowCopy({ type: "approval", pendingRequests: [], quote: { customer: { email: "a@b.com" } }, quoteId: "q-8" }).meta)
      .toContain("a@b.com");
    expect(attentionRowCopy({ type: "approval", pendingRequests: [], quote: {}, quoteId: "q-9" }).meta)
      .toContain("Customer");
  });
});

describe("selectUpcomingEvents", () => {
  const nowDate = new Date("2026-08-08T12:00:00.000Z");

  test("keeps only accepted/booked quotes with a parseable date inside the window", () => {
    const quotes = [
      { id: "in-window", status: "accepted", event: { date: "2026-08-10" } },
      { id: "too-far", status: "booked", event: { date: "2026-09-01" } },
      { id: "past", status: "booked", event: { date: "2026-08-01" } },
      { id: "no-date", status: "accepted", event: {} },
      { id: "wrong-status", status: "sent", event: { date: "2026-08-09" } }
    ];
    const result = selectUpcomingEvents(quotes, { nowDate });
    expect(result.map((q) => q.id)).toEqual(["in-window"]);
  });

  test("sorts by event date ascending", () => {
    const quotes = [
      { id: "later", status: "booked", event: { date: "2026-08-14" } },
      { id: "sooner", status: "accepted", event: { date: "2026-08-09" } }
    ];
    const result = selectUpcomingEvents(quotes, { nowDate });
    expect(result.map((q) => q.id)).toEqual(["sooner", "later"]);
  });

  test("today's date is included in the window", () => {
    const quotes = [{ id: "today", status: "booked", event: { date: "2026-08-08" } }];
    expect(selectUpcomingEvents(quotes, { nowDate }).map((q) => q.id)).toEqual(["today"]);
  });
});

describe("buildMoneyRows", () => {
  test("surfaces an unpaid deposit on an accepted quote as an action row", () => {
    const rows = buildMoneyRows([
      {
        id: "q-1",
        quoteNumber: "Q-1",
        status: "accepted",
        customer: { name: "Jordan" },
        totals: { deposit: 500 },
        payment: { depositStatus: "unpaid" }
      }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "Deposit", amount: 500, family: "action" });
  });

  test("does not surface a paid deposit", () => {
    const rows = buildMoneyRows([
      {
        id: "q-2",
        status: "accepted",
        totals: { deposit: 500 },
        payment: { depositStatus: "paid" }
      }
    ]);
    expect(rows).toHaveLength(0);
  });

  test("converts the final-balance amountCents to a dollar amount, unlike the deposit's dollar-float total", () => {
    const rows = buildMoneyRows([
      {
        id: "q-3",
        status: "booked",
        totals: { deposit: 0 },
        booking: { contractNumber: "CT-1" },
        payment: {
          depositStatus: "paid",
          finalBalance: { status: "sent", amountCents: 496000 }
        }
      }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "Final balance", amount: 4960, family: "pending" });
  });

  test("a booked quote without a contract number is not treated as final-balance eligible", () => {
    const rows = buildMoneyRows([
      {
        id: "q-4",
        status: "booked",
        totals: { deposit: 0 },
        booking: {},
        payment: { depositStatus: "paid", finalBalance: { status: "sent", amountCents: 10000 } }
      }
    ]);
    expect(rows).toHaveLength(0);
  });

  test("a booked quote with an unpaid deposit surfaces only the deposit row, not a premature final balance row", () => {
    // The backend's send_final_balance_request gate requires a Stripe-paid
    // deposit before a balance request is eligible. Even though this fixture
    // carries a positive final-balance amountCents (as a real record would
    // once a contract exists), the final-balance row must stay hidden until
    // the deposit is actually paid or a request has genuinely been sent.
    const rows = buildMoneyRows([
      {
        id: "q-5",
        status: "booked",
        totals: { total: 5000, deposit: 1000 },
        booking: { contractNumber: "CT-2" },
        payment: { depositStatus: "unpaid", finalBalance: { amountCents: 400000 } }
      }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "Deposit", family: "action" });
  });

  test("a booked quote with a paid deposit does show the not-yet-requested final balance", () => {
    const rows = buildMoneyRows([
      {
        id: "q-6",
        status: "booked",
        totals: { total: 5000, deposit: 1000 },
        booking: { contractNumber: "CT-3" },
        payment: { depositStatus: "paid", finalBalance: { amountCents: 400000 } }
      }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "Final balance", family: "action" });
  });
});

describe("summarizeMoneyRows", () => {
  test("splits pending (awaiting customer) from action (not yet requested) totals", () => {
    const totals = summarizeMoneyRows([
      { family: "pending", amount: 100 },
      { family: "pending", amount: 50 },
      { family: "action", amount: 25 },
      { family: "provider", amount: 999 }
    ]);
    expect(totals).toEqual({ requested: 150, outstanding: 25 });
  });
});

describe("CommandCenterHome static shell", () => {
  test("renders the attention heading and empty-state copy before data loads", () => {
    const html = renderToStaticMarkup(
      <CommandCenterHome organizationId="" onOpenWorkflow={() => {}} onOpenQuote={() => {}} onNewQuote={() => {}} />
    );
    expect(html).toContain("What needs your attention");
    expect(html).toContain("Nothing needs you right now");
    expect(html).toContain("New quote");
  });
});
