import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { EventPlanningView } from "../LiveOperationsPlanningViews";

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

test("event operating entry requires enabled connected booked scope and authorized staff", () => {
  const props = { snapshot: snapshot({ quotes: [{ id: "booked-a", status: "booked", event: { name: "Booked event" } }] }), quoteId: "booked-a", routeMode: "detail", principalId: "admin-a", role: "admin", eventOperationsEnabled: true };
  expect(renderToStaticMarkup(<EventPlanningView {...props} />)).toContain('data-event-operations-entry="control-room"');
  expect(renderToStaticMarkup(<EventPlanningView {...props} role="sales" />)).toContain("Open Control Room");
  for (const denied of [{ role: "customer" }, { eventOperationsEnabled: false }, { principalId: "" }, { snapshot: snapshot({ source: "local", quotes: props.snapshot.quotes }) }, { snapshot: snapshot({ quotes: [{ ...props.snapshot.quotes[0], status: "accepted" }] }) }]) {
    expect(renderToStaticMarkup(<EventPlanningView {...props} {...denied} />)).not.toContain("Open Control Room");
  }
});

test("operational Replay is discoverable only for the connected booked staff scope", () => {
  const props = { snapshot: snapshot({ quotes: [{ id: "event-a", status: "booked", activeVersionId: "version-a", acceptanceReceipt: { receiptId: "accept-a" }, event: { name: "Booked event" } }] }), routeMode: "detail", quoteId: "event-a", principalId: "staff-a", eventOperationsEnabled: true, role: "sales" };
  expect(renderToStaticMarkup(<EventPlanningView {...props} />)).toContain('data-event-operations-entry="replay"');
  for (const denied of [{ role: "customer" }, { eventOperationsEnabled: false }, { snapshot: snapshot({ source: "local", quotes: props.snapshot.quotes }) }]) expect(renderToStaticMarkup(<EventPlanningView {...props} {...denied} />)).not.toContain('data-event-operations-entry="replay"');
  expect(renderToStaticMarkup(<EventPlanningView {...props} routeMode="replay" />)).not.toContain("Replay is unavailable");
});
