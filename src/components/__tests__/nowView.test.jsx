// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import NowView from "../NowView";
import LegacyNowView from "../LegacyNowView";
import { routePerformanceSnapshot } from "../../lib/routePerformance";

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
    expect(markup).toContain("What to review today");
  });

  test("renders the truthful quiet state when nothing needs the operator", () => {
    const markup = renderToStaticMarkup(
      <NowView snapshot={snapshotFixture()} nowDate={NOW_DATE} />
    );
    expect(markup).toContain("Nothing needs you right now.");
    expect(markup.match(/Nothing needs you right now\./g)).toHaveLength(1);
    expect(markup).not.toContain("Your deck is clear");
    expect(markup).not.toContain("Nothing needs an immediate decision");
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


test("does not call a pending attention read clear while history is already available", () => {
  const html = renderToStaticMarkup(<NowView snapshot={snapshotFixture({ loading: true, reads: {
    attention: { status: "loading" }, history: { status: "success" }, unreadReplies: { status: "loading" }
  } })} nowDate={NOW_DATE} />);
  expect(html).toContain("Checking attention");
  expect(html).not.toContain("Your deck is clear");
  expect(html).toContain("No accepted or booked events in the next 7 days");
});

describe.each([["NowView", NowView], ["LegacyNowView", LegacyNowView]])("%s route outcomes", (_name, View) => {
  let container;
  let root;
  let previousActEnvironment;
  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.__QUOTE_PILOT_ROUTE_PERFORMANCE__ = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.__QUOTE_PILOT_ROUTE_PERFORMANCE__ = undefined;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  const outcomes = () => routePerformanceSnapshot().map(({ stage, outcome }) => ({ stage, outcome }));
  const mount = (overrides) => act(() => root.render(
    <View snapshot={snapshotFixture(overrides)} nowDate={NOW_DATE} />
  ));

  test("records ready primary content before pending supplements and preserves a later partial result", () => {
    mount({ loading: true, partial: true, reads: {
      attention: { status: "success" }, history: { status: "loading" }, unreadReplies: { status: "loading" }
    } });
    expect(outcomes()).toEqual([{ stage: "usable-core", outcome: "ready" }]);
    mount({ error: "Replies failed", partial: true, reads: {
      attention: { status: "success" }, history: { status: "success" }, unreadReplies: { status: "error" }
    } });
    expect(outcomes()).toEqual([
      { stage: "usable-core", outcome: "ready" }, { stage: "supplemental-complete", outcome: "partial" }
    ]);
  });

  test("waits past a failed first read and records terminal failure without inventing usable content", () => {
    mount({ loading: true, error: "Read failed", reads: {
      attention: { status: "error" }, history: { status: "loading" }, unreadReplies: { status: "loading" }
    } });
    expect(outcomes()).toEqual([]);
    mount({ error: "Read failed", reads: {
      attention: { status: "error" }, history: { status: "error" }, unreadReplies: { status: "error" }
    } });
    expect(outcomes()).toEqual([
      { stage: "usable-core", outcome: "error" }, { stage: "supplemental-complete", outcome: "error" }
    ]);
  });

  test("labels retained stale content partial in both stages", () => {
    mount({ stale: true, reads: {
      attention: { status: "success" }, history: { status: "success" }, unreadReplies: { status: "success" }
    } });
    expect(outcomes()).toEqual([
      { stage: "usable-core", outcome: "partial" }, { stage: "supplemental-complete", outcome: "partial" }
    ]);
  });

  test.each([["history", "attention"], ["attention", "history"]])(
    "keeps core ready when %s fails before %s succeeds", (failedRead, successfulRead) => {
      mount({ loading: true, error: "Primary read failed", reads: {
        [failedRead]: { status: "error" }, [successfulRead]: { status: "loading" },
        unreadReplies: { status: "loading" }
      } });
      expect(outcomes()).toEqual([]);
      mount({ error: "Primary read failed", partial: true, reads: {
        [failedRead]: { status: "error" }, [successfulRead]: { status: "success" },
        unreadReplies: { status: "success" }
      } });
      expect(outcomes()).toEqual([
        { stage: "usable-core", outcome: "ready" }, { stage: "supplemental-complete", outcome: "partial" }
      ]);
    }
  );
});
