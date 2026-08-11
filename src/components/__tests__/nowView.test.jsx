import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import NowView from "../NowView";

const NOW_DATE = new Date("2026-08-10T09:00:00");

function snapshotFixture(overrides = {}) {
  return {
    loading: false,
    error: "",
    attentionSummary: { items: [] },
    quotes: [],
    truncated: false,
    truncationKnown: true,
    source: "firebase",
    ...overrides
  };
}

const changeRequestItem = {
  id: "att-1",
  type: "change_request",
  state: "new_change_request",
  quoteId: "q-1",
  sourceMessage: "Please add a vegan station.",
  sourceRequestId: "req-1"
};

const quoteFixture = {
  id: "q-1",
  quoteNumber: "Q-260810-0900-00001",
  status: "accepted",
  customerId: "cust-1",
  customer: { name: "Marisa Henderson" },
  event: { name: "Henderson Retreat", date: "2026-08-12", guests: 80 },
  payment: { depositStatus: "unpaid" },
  totals: { deposit: 1350 }
};

describe("NowView", () => {
  test("shows the loading state before any attention summary exists", () => {
    const markup = renderToStaticMarkup(
      <NowView snapshot={snapshotFixture({ loading: true, attentionSummary: null })} nowDate={NOW_DATE} />
    );
    expect(markup).toContain("Loading attention items...");
    expect(markup).toContain("What deserves your attention");
  });

  test("renders the truthful quiet state when nothing needs the operator", () => {
    const markup = renderToStaticMarkup(
      <NowView snapshot={snapshotFixture()} nowDate={NOW_DATE} />
    );
    expect(markup).toContain("Nothing needs you right now.");
    expect(markup).toContain("No accepted or booked events in the next 7 days.");
    expect(markup).toContain("No payments awaiting action.");
  });

  test("keeps the bounded-snapshot honesty copy when reads were truncated", () => {
    const markup = renderToStaticMarkup(
      <NowView snapshot={snapshotFixture({ truncated: true })} nowDate={NOW_DATE} />
    );
    expect(markup).toContain("No attention appears in this bounded snapshot.");
  });

  test("renders interpreted decision cards plus upcoming and money evidence", () => {
    const markup = renderToStaticMarkup(
      <NowView
        snapshot={snapshotFixture({
          attentionSummary: { items: [changeRequestItem] },
          quotes: [quoteFixture]
        })}
        nowDate={NOW_DATE}
      />
    );
    expect(markup).toContain("Marisa Henderson");
    expect(markup).toContain("Please add a vegan station.");
    expect(markup).toContain("Review request");
    expect(markup).toContain("Henderson Retreat");
    expect(markup).toContain("80 guests");
    expect(markup).toContain("Deposit ·");
    expect(markup).toContain("Requested, awaiting customer");
  });

  test("surfaces the exact overflow count beyond the bounded card stream", () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `att-${index}`,
      type: "follow_up",
      quoteId: "q-1",
      daysOverdue: 0
    }));
    const markup = renderToStaticMarkup(
      <NowView
        snapshot={snapshotFixture({ attentionSummary: { items }, quotes: [quoteFixture] })}
        nowDate={NOW_DATE}
      />
    );
    expect(markup).toContain("View 2 more in Workflow");
  });

  test("announces a snapshot error as an alert", () => {
    const markup = renderToStaticMarkup(
      <NowView snapshot={snapshotFixture({ error: "Snapshot failed." })} nowDate={NOW_DATE} />
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Snapshot failed.");
  });
});
