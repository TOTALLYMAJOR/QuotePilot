// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ClearDeckView, EventPlanningView } from "../LiveOperationsPlanningViews";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function snapshot(overrides = {}) {
  return {
    loading: false,
    error: "",
    quotes: [],
    source: "firebase",
    partial: false,
    stale: false,
    truncated: false,
    truncationKnown: true,
    ...overrides
  };
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mountClearDeck(props = {}) {
  act(() => {
    root.render(<ClearDeckView snapshot={snapshot()} {...props} />);
  });
}

describe("EventPlanningView recovery journeys", () => {
  test("replaces raw provider errors with one safe productive recovery", () => {
    const markup = renderToStaticMarkup(
      <EventPlanningView snapshot={snapshot({ error: "Missing or insufficient permissions." })} />
    );

    expect(markup).toContain('data-events-state="unavailable"');
    expect(markup).toContain("We couldn’t load event records.");
    expect(markup).toContain("No event status changed");
    expect(markup).toContain("Try again");
    expect(markup).toContain("Review opportunities");
    expect(markup).toContain('data-events-evidence="collapsed"');
    expect(markup).toContain("About this view");
    expect(markup).toContain("Source not confirmed");
    expect(markup.indexOf('data-events-state="unavailable"')).toBeLessThan(
      markup.indexOf('data-events-evidence="collapsed"')
    );
    expect(markup.match(/>Try again</g)).toHaveLength(1);
    expect(markup).not.toContain(">Refresh</button>");
    expect(markup).not.toContain("Missing or insufficient permissions");
    expect(markup).not.toContain("Live operations evidence not established");
  });

  test("turns a truthful empty Events view into the next commercial step", () => {
    const markup = renderToStaticMarkup(<EventPlanningView snapshot={snapshot()} />);

    expect(markup).toContain('data-events-state="empty"');
    expect(markup).toContain("Nothing is ready for event planning yet.");
    expect(markup).toContain("Review opportunities");
    expect(markup).toContain("Start a quote");
    expect(markup).not.toContain("Live operations evidence not established");
  });

  test("does not substitute the event list for a missing exact event", () => {
    const markup = renderToStaticMarkup(
      <EventPlanningView
        snapshot={snapshot({
          quotes: [{
            id: "event-a",
            status: "accepted",
            quoteNumber: "QP-1001",
            event: { name: "Available event", date: "2026-09-12" }
          }]
        })}
        routeMode="detail"
        quoteId="missing-event"
      />
    );

    expect(markup).toContain('data-events-state="not_found"');
    expect(markup).toContain("QuotePilot did not open another event in its place.");
    expect(markup).not.toContain('aria-label="Accepted and booked events"');
    expect(markup).not.toContain("Available event");
  });

  test("leads Event Focus with event facts and states the live boundary once", () => {
    const markup = renderToStaticMarkup(
      <EventPlanningView
        snapshot={snapshot({
          quotes: [{
            id: "event-a",
            status: "accepted",
            quoteNumber: "QP-1001",
            customer: { name: "Avery Bennett" },
            event: {
              name: "Bennett Garden Wedding",
              date: "2027-09-12",
              venue: "Magnolia House",
              guests: 96
            }
          }]
        })}
        routeMode="detail"
        quoteId="event-a"
      />
    );

    expect(markup.indexOf('aria-label="Event basics"')).toBeLessThan(
      markup.indexOf('aria-label="Planning status"')
    );
    expect(markup).toContain("Accepted is the recorded opportunity state");
    expect(markup.match(/Planning view only/g)).toHaveLength(1);
    expect(markup).not.toContain("server-owned event authority gate");
    expect(markup).not.toContain("Planning signal");
    expect(markup).not.toContain(">Control Room</button>");
    expect(markup).not.toContain(">Replay</button>");
  });

  test("keeps partial-read diagnostics collapsed after available event records", () => {
    const markup = renderToStaticMarkup(
      <EventPlanningView
        snapshot={snapshot({
          partial: true,
          error: "Unread reply query did not complete.",
          quotes: [{
            id: "event-a",
            status: "booked",
            quoteNumber: "QP-1001",
            event: { name: "Available event", date: "2027-09-12" }
          }]
        })}
      />
    );

    expect(markup).toContain('data-events-evidence="collapsed"');
    expect(markup).toContain("Some data may be out of date");
    expect(markup).toContain("Event records available");
    expect(markup).toContain('aria-label="Accepted and booked events"');
    expect(markup).not.toContain("The latest refresh did not complete");
    expect(markup).not.toContain("Unread reply query did not complete");
  });

  test("keeps unavailable live routes recoverable without offering another unavailable destination", () => {
    const markup = renderToStaticMarkup(
      <EventPlanningView
        snapshot={snapshot({
          quotes: [{
            id: "event-a",
            status: "accepted",
            quoteNumber: "QP-1001",
            event: { name: "Available event", date: "2027-09-12" }
          }]
        })}
        routeMode="live"
        quoteId="event-a"
      />
    );

    expect(markup).toContain("Control Room is unavailable");
    expect(markup).toContain("Back to Event Focus");
    expect(markup).toContain("Open quote record");
    expect(markup).not.toContain(">Replay</button>");
  });

});

describe("ClearDeckView bounded decision review", () => {
  test("limits the review queue and exposes no invented decision authority", () => {
    const items = [
      { id: "approval-a", type: "approval", quoteId: "quote-a", quote: { quoteNumber: "QP-1001" } },
      { id: "decision-b", type: "decision_debt", quoteId: "quote-b", quote: { quoteNumber: "QP-1002" } },
      { id: "approval-c", type: "approval", quoteId: "quote-c", quote: { quoteNumber: "QP-1003" } },
      { id: "decision-d", type: "decision_debt", quoteId: "quote-d", quote: { quoteNumber: "QP-1004" } },
      { id: "follow-up-e", type: "follow_up", quoteId: "quote-e", quote: { quoteNumber: "QP-1005" } }
    ];

    mountClearDeck({
      snapshot: snapshot({
        loadedAt: Date.parse("2026-09-04T18:00:00.000Z"),
        reads: {
          attention: { status: "success" },
          history: { status: "success" }
        },
        attentionSummary: { itemCount: items.length, items }
      })
    });

    const decisions = Array.from(container.querySelectorAll(".live-ops-decision"));
    expect(decisions).toHaveLength(3);
    expect(decisions.map((item) => item.querySelector("h3").textContent))
      .toEqual(["QP-1001", "QP-1002", "QP-1003"]);
    expect(container.textContent).toContain("Review the current source evidence in Workflow.");
    expect(container.textContent).toContain("Skip/defer does not resolve this item in this slice.");
    expect(container.textContent).toContain("Planning view only");
    expect(Array.from(container.querySelectorAll("button")).map((button) => button.textContent.trim()))
      .toEqual(["Refresh", "Review in Workflow", "Review in Workflow", "Review in Workflow"]);
    expect(container.textContent).not.toContain("QP-1004");
    expect(container.textContent).not.toContain("QP-1005");
  });

  test("continues to Workflow with the exact decision focus identity", () => {
    const onOpenWorkflow = vi.fn();
    mountClearDeck({
      onOpenWorkflow,
      snapshot: snapshot({
        attentionSummary: {
          itemCount: 2,
          items: [
            {
              id: "approval:quote-a",
              type: "approval",
              quoteId: "quote-a",
              sourceRequestId: "approval-request-a",
              quote: { quoteNumber: "QP-1001" }
            },
            {
              id: "decision:quote-b",
              type: "decision_debt",
              quoteId: "quote-b",
              quote: { quoteNumber: "QP-1002" }
            }
          ]
        }
      })
    });

    const actions = container.querySelectorAll(".live-ops-decision button");
    act(() => actions[0].click());
    act(() => actions[1].click());

    expect(onOpenWorkflow).toHaveBeenNthCalledWith(1, {
      quoteId: "quote-a",
      attentionType: "approval",
      requestId: "approval-request-a"
    });
    expect(onOpenWorkflow).toHaveBeenNthCalledWith(2, {
      quoteId: "quote-b",
      attentionType: "decision_debt",
      requestId: "decision:quote-b"
    });
  });

  test("keeps refresh on the existing force-refresh callback", () => {
    const onRefresh = vi.fn();
    mountClearDeck({ onRefresh });

    act(() => container.querySelector("button").click());

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledWith({ force: true });
  });

  test("describes an empty or unavailable bounded read without claiming all clear", () => {
    const emptyMarkup = renderToStaticMarkup(
      <ClearDeckView snapshot={snapshot()} organizationName="Toni Catering" organizationId="org-a" />
    );
    const unavailableMarkup = renderToStaticMarkup(
      <ClearDeckView
        snapshot={snapshot({ error: "Missing or insufficient permissions." })}
        organizationName="Toni Catering"
        organizationId="org-a"
      />
    );

    expect(emptyMarkup).toContain("No decision items appear in this bounded snapshot.");
    expect(emptyMarkup).toContain("stay review-only until durable decision receipts ship");
    expect(emptyMarkup).toContain('data-capability-state="unavailable"');
    expect(emptyMarkup).toContain("No complete staff snapshot is available yet.");
    expect(emptyMarkup).toContain("does not prove provider delivery, customer acceptance, booking, payment, or operational completion");
    expect(emptyMarkup).not.toContain('class="live-ops-decision"');
    expect(emptyMarkup).not.toContain("All clear");

    expect(unavailableMarkup).toContain('data-capability-state="unavailable"');
    expect(unavailableMarkup).not.toContain("No decision items appear in this bounded snapshot.");
    expect(unavailableMarkup).not.toContain("Missing or insufficient permissions");
  });
});
