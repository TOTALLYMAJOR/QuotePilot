import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import EventScheduleModal, {
  buildConflictInsights,
  buildScheduledEvents,
  buildWeekTimelineModel,
  EventScheduleView,
  formatScheduleDayLabel,
  getScheduleCalendarCountLabels,
  getScheduleSourceLabel,
  getScheduleStatusPresentation,
  ScheduleEventFacts
} from "../EventScheduleModal";
import ReportingDashboardModal, {
  buildReportingMetrics,
  ReportingDashboardView
} from "../ReportingDashboardModal";
import ReportingAmbientMetrics, {
  formatReportingDuration
} from "../AmbientReportingMetrics";

describe("operational workspace presentations", () => {
  test.each([
    ["schedule", EventScheduleView, EventScheduleModal, "event-schedule-title"],
    ["reporting", ReportingDashboardView, ReportingDashboardModal, "reporting-dashboard-title"]
  ])("renders %s as an embedded region while preserving its modal wrapper", (name, View, Modal, titleId) => {
    const embedded = renderToStaticMarkup(<View open onClose={() => {}} organizationId="org-a" />);
    expect(embedded).toContain('role="region"');
    expect(embedded).toContain("embedded-workspace-route");
    expect(embedded).toContain("workspace-route-card");
    expect(embedded).toContain(`aria-labelledby="${titleId}"`);
    expect(embedded).not.toContain('aria-modal="true"');
    if (name === "schedule") expect(embedded).not.toContain(">Back to Home</button>");
    else expect(embedded).toContain(">Back to Home</button>");
    expect(embedded).not.toContain(">Close</button>");

    const modal = renderToStaticMarkup(<Modal open onClose={() => {}} organizationId="org-a" />);
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("modal-overlay");
    expect(modal).not.toContain("embedded-workspace-route");
    expect(modal).toContain(">Close</button>");
    expect(modal).not.toContain(">Back to Home</button>");
  });
});

describe("schedule status semantics", () => {
  test("derives symmetric conflict comparisons without manual resolution state", () => {
    const events = buildScheduledEvents([
      {
        id: "quote-a",
        quoteNumber: "Q-A",
        status: "booked",
        event: { date: "2026-09-06", time: "17:00", hours: 4, venue: "Hall", guests: 260 }
      },
      {
        id: "quote-b",
        quoteNumber: "Q-B",
        status: "accepted",
        event: { date: "2026-09-06", time: "18:00", hours: 4, venue: "Hall", guests: 220 }
      }
    ]);
    const insights = buildConflictInsights(events, 400);

    expect(Array.from(insights.reasonsById.get("quote-a"))).toEqual(["time_overlap", "capacity"]);
    expect(Array.from(insights.reasonsById.get("quote-b"))).toEqual(["time_overlap", "capacity"]);
    expect(insights.comparisonsById.get("quote-a")).toEqual([
      { peerId: "quote-b", reasons: ["time_overlap", "capacity"] }
    ]);
    expect(insights.comparisonsById.get("quote-b")).toEqual([
      { peerId: "quote-a", reasons: ["time_overlap", "capacity"] }
    ]);
    expect(JSON.stringify(Array.from(insights.comparisonsById.entries())))
      .not.toMatch(/resolved|dismissed|acknowledged/i);
  });

  test("keeps quote lifecycle and booking confirmation separately labeled", () => {
    const status = getScheduleStatusPresentation({
      status: "accepted",
      confirmationStatus: "pending"
    });

    expect(status.quote).toMatchObject({ label: "Accepted", family: "confirmed" });
    expect(status.bookingConfirmation).toMatchObject({
      label: "Confirmation pending",
      family: "action"
    });
    expect(status.quote.label).not.toBe(status.bookingConfirmation.label);
  });

  test("labels accepted calendar counts as accepted rather than a booking hold", () => {
    expect(getScheduleCalendarCountLabels({ booked: 1, accepted: 2 })).toEqual({
      booked: "1 booked",
      accepted: "2 accepted"
    });
    expect(getScheduleCalendarCountLabels({ accepted: 2 }).accepted).not.toContain("hold");
  });

  test("preserves missing schedule facts and renders semantic staff copy instead of zero values", () => {
    const [event] = buildScheduledEvents([{
      id: "quote-missing-facts",
      status: "accepted",
      event: { date: "2026-08-20" },
      customer: {},
      totals: {}
    }]);
    const markup = renderToStaticMarkup(<ScheduleEventFacts item={event} />);

    expect(event).toMatchObject({
      quoteNumber: "",
      eventName: "",
      venue: "",
      customer: "",
      guests: null,
      total: null
    });
    expect(markup).toContain("Untitled event");
    expect(markup).toContain("<dt>Time</dt><dd>Not set</dd>");
    expect(markup).toContain("<dt>Venue</dt><dd>Not set</dd>");
    expect(markup).toContain("<dt>Client</dt><dd>Not recorded</dd>");
    expect(markup).toContain("<dt>Guests</dt><dd>Not set</dd>");
    expect(markup).toContain("Amount not recorded");
    expect(markup).not.toContain("$0.00");
    expect(markup).not.toContain("0 guests");
  });

  test("binds valid and zero schedule facts to human-readable date, source, and money copy", () => {
    const [event] = buildScheduledEvents([{
      id: "quote-valid-facts",
      quoteNumber: "Q-2001",
      status: "booked",
      event: {
        date: "2026-08-20",
        time: "18:00",
        venue: "Foundry Hall",
        guests: 0,
        name: "Launch dinner"
      },
      customer: { name: "Northstar Labs" },
      totals: { total: 0 }
    }]);
    const markup = renderToStaticMarkup(<ScheduleEventFacts item={event} />);

    expect(formatScheduleDayLabel(event.date)).toMatch(/August|Aug/);
    expect(formatScheduleDayLabel(event.date)).not.toContain("2026-08-20");
    expect(getScheduleSourceLabel({ source: "firebase" })).toBe("Firestore staff records");
    expect(getScheduleSourceLabel({ loading: true })).toBe("Loading tenant records");
    expect(markup).toContain("0 guests");
    expect(markup).toContain("<dt>Quote total</dt><dd>$0.00</dd>");
  });

  test("does not append a guest suffix to an invalid legacy value", () => {
    const markup = renderToStaticMarkup(<ScheduleEventFacts item={{ guests: "unknown" }} />);
    expect(markup).toContain("<dt>Guests</dt><dd>Not set</dd>");
    expect(markup).not.toContain("Not set guests");
  });
});

describe("Week timeline presentation model", () => {
  const day = (iso, events = []) => ({
    iso,
    date: new Date(`${iso}T12:00:00`),
    events,
    conflicts: { total: 0, overlap: 0, unknown: 0, capacity: 0 }
  });
  const event = ({ id, time, hours }) => ({
    id,
    quoteNumber: id.toUpperCase(),
    eventName: `${id} dinner`,
    status: "booked",
    time,
    hours,
    conflictReasons: []
  });

  test("derives start, height, and stable collision lanes without changing Calendar authority", () => {
    const eventA = event({ id: "event-a", time: "17:00", hours: 4 });
    const eventB = event({ id: "event-b", time: "18:00", hours: 2 });
    const model = buildWeekTimelineModel([day("2026-09-06", [eventB, eventA])]);
    const reordered = buildWeekTimelineModel([day("2026-09-06", [eventA, eventB])]);
    const byId = Object.fromEntries(model.days[0].timedEvents.map((item) => [item.event.id, item]));
    const reorderedById = Object.fromEntries(
      reordered.days[0].timedEvents.map((item) => [item.event.id, item])
    );

    expect(byId["event-a"]).toMatchObject({
      startMinute: 1020,
      endMinute: 1260,
      durationMinutes: 240,
      topPx: 364,
      heightPx: 208,
      laneIndex: 0,
      laneCount: 2
    });
    expect(byId["event-b"]).toMatchObject({
      startMinute: 1080,
      endMinute: 1200,
      durationMinutes: 120,
      topPx: 416,
      heightPx: 104,
      laneIndex: 1,
      laneCount: 2
    });
    expect(reorderedById["event-a"].laneIndex).toBe(byId["event-a"].laneIndex);
    expect(reorderedById["event-b"].laneIndex).toBe(byId["event-b"].laneIndex);
    expect(model.days[0].events).toEqual([eventB, eventA]);
  });

  test("reuses the first lane when event windows only abut", () => {
    const model = buildWeekTimelineModel([day("2026-09-06", [
      event({ id: "event-a", time: "10:00", hours: 1 }),
      event({ id: "event-b", time: "11:00", hours: 1 })
    ])]);

    expect(model.days[0].timedEvents.map((item) => ({
      id: item.event.id,
      laneIndex: item.laneIndex,
      laneCount: item.laneCount
    }))).toEqual([
      { id: "event-a", laneIndex: 0, laneCount: 1 },
      { id: "event-b", laneIndex: 0, laneCount: 1 }
    ]);
  });

  test("keeps missing time and duration visible as unplaced presentation records", () => {
    const missingTime = event({ id: "missing-time", time: "", hours: 4 });
    const missingDuration = event({ id: "missing-duration", time: "19:00", hours: 0 });
    const model = buildWeekTimelineModel([day("2026-09-06", [missingTime, missingDuration])]);

    expect(model.days[0].timedEvents).toEqual([]);
    expect(model.days[0].unplacedEvents).toEqual([
      { event: missingTime, reason: "time_unavailable" },
      { event: missingDuration, reason: "duration_unavailable" }
    ]);
  });

  test("expands for early events and marks overnight continuation at the day boundary", () => {
    const model = buildWeekTimelineModel([day("2026-09-06", [
      event({ id: "early", time: "08:30", hours: 1 }),
      event({ id: "overnight", time: "21:30", hours: 4 })
    ])]);
    const byId = Object.fromEntries(model.days[0].timedEvents.map((item) => [item.event.id, item]));

    expect(model).toMatchObject({
      startMinute: 480,
      endMinute: 1440,
      rangeMinutes: 960,
      heightPx: 832
    });
    expect(model.ticks.at(0).minute).toBe(480);
    expect(model.ticks.at(-1).minute).toBe(1440);
    expect(byId.early).toMatchObject({ topPx: 26, heightPx: 52 });
    expect(byId.overnight).toMatchObject({
      endMinute: 1530,
      visualEndMinute: 1440,
      continuesNextDay: true,
      topPx: 702,
      heightPx: 130
    });
    expect(byId.overnight.topPx + byId.overnight.heightPx).toBeLessThanOrEqual(model.heightPx);
  });
});

describe("reporting commercial-state totals", () => {
  test("separates accepted/booked quote value from verified paid-deposit totals", () => {
    const metrics = buildReportingMetrics([
      {
        status: "accepted",
        createdAtISO: "2026-08-02T12:00:00.000Z",
        totals: { total: 4000, deposit: 1000 },
        payment: {
          depositStatus: "paid",
          depositConfirmedAtISO: "2026-08-02T12:05:00.000Z"
        }
      },
      {
        status: "booked",
        createdAtISO: "2026-08-03T12:00:00.000Z",
        totals: { total: 6000, deposit: 1500 },
        payment: { depositStatus: "sent" }
      },
      {
        status: "draft",
        createdAtISO: "2026-08-04T12:00:00.000Z",
        totals: { total: 2000, deposit: 500 },
        payment: { depositStatus: "unpaid" }
      }
    ], {
      nowDate: new Date("2026-08-08T12:00:00.000Z"),
      source: "firebase"
    });

    expect(metrics.wonValue).toBe(10_000);
    expect(metrics.paidDepositValue).toBe(1_000);
    expect(metrics.pipelineValue).toBe(2_000);
    expect(metrics.paymentPaid).toBe(1);
  });

  test("renders proof-safe commercial labels instead of accounting revenue claims", () => {
    const markup = renderToStaticMarkup(
      <ReportingDashboardView open onClose={() => {}} organizationId="org-a" />
    );
    expect(markup).toContain("Accepted / Booked Quote Value");
    expect(markup).toContain("Verified Paid-Deposit Total");
    expect(markup).toContain("Ambient interaction health");
    expect(markup).toContain("Primary dead-click rate");
    expect(markup).toContain("not accounting revenue");
    expect(markup).not.toContain("Won Revenue");
  });
});

describe("reporting Ambient interaction evidence", () => {
  test("formats bounded durations without turning missing evidence into zero", () => {
    expect(formatReportingDuration(null)).toBe("Not available");
    expect(formatReportingDuration("bad")).toBe("Not available");
    expect(formatReportingDuration(0)).toBe("0 ms");
    expect(formatReportingDuration(850)).toBe("850 ms");
    expect(formatReportingDuration(1500)).toBe("1.5 s");
    expect(formatReportingDuration(60_000)).toBe("1 min");
    expect(formatReportingDuration(90_000)).toBe("1 min 30 s");
    expect(formatReportingDuration(3_599_999)).toBe("1 hr");
  });

  test("renders dead-click, priced-draft, and exact-category resolution samples with proof boundaries", () => {
    const markup = renderToStaticMarkup(<ReportingAmbientMetrics analytics={{
      source: "firebase",
      days: 30,
      sampledEvents: 64,
      ambientInteractions: {
        observationSource: "client",
        deadlineMs: 250,
        primaryActionsAssessed: 40,
        deadClicks: 1,
        deadClickRate: 0.025
      },
      intentToPricedDraft: {
        observationSource: "client",
        receiptAuthority: "server_authoritative",
        storage: "firebase",
        samples: 4,
        medianMs: 1500,
        p75Ms: 2400
      },
      issueResolution: {
        observationSource: "client",
        pairing: "same_session_exact_category",
        samples: 3,
        medianMs: 60_000,
        p75Ms: 90_000,
        byCategory: [{
          issueCategory: "proposal-gap-guest-count",
          samples: 2,
          medianMs: 45_000,
          p75Ms: 60_000
        }]
      }
    }} />);

    expect(markup).toContain('data-reporting-state="available"');
    expect(markup).toContain("Primary dead-click rate");
    expect(markup).toContain("2.5%");
    expect(markup).toContain("1 dead click across 40 assessed primary actions");
    expect(markup).toContain("250 ms acknowledgement contract");
    expect(markup).toContain("First intent → priced draft");
    expect(markup).toContain("1.5 s");
    expect(markup).toContain("p75 2.4 s");
    expect(markup).toContain("4 exact receipt samples");
    expect(markup).toContain("Issue surfaced → resolved");
    expect(markup).toContain("p75 1 min 30 s");
    expect(markup).toContain("3 same-session exact-category pairs");
    expect(markup).toContain("Proposal · guest count: 2 · median 45 s · p75 1 min");
    expect(markup).toContain("64 bounded server-stored events");
    expect(markup).toContain("not server timing telemetry");
    expect(markup).toContain("Event payloads omit quote IDs, customer details,");
    expect(markup).toContain("exact server-authoritative Firebase save receipt");
  });

  test("keeps local fallback and zero-sample summaries explicitly unavailable", () => {
    const localMarkup = renderToStaticMarkup(<ReportingAmbientMetrics analytics={{
      source: "local",
      days: 30,
      ambientInteractions: {
        observationSource: "client",
        deadlineMs: 250,
        primaryActionsAssessed: 0,
        deadClicks: 0,
        deadClickRate: 0
      },
      intentToPricedDraft: { samples: 0, medianMs: null, p75Ms: null },
      issueResolution: { samples: 0, medianMs: null, p75Ms: null, byCategory: [] }
    }} />);
    expect(localMarkup).toContain('data-reporting-state="unavailable"');
    expect(localMarkup).toContain("server summary is unavailable in local fallback");
    expect(localMarkup).toContain("No rate or duration is inferred");
    expect(localMarkup).not.toContain("0.0%");

    const emptyFirebaseMarkup = renderToStaticMarkup(<ReportingAmbientMetrics analytics={{
      source: "firebase",
      days: 30,
      ambientInteractions: {
        observationSource: "client",
        deadlineMs: 250,
        primaryActionsAssessed: 0,
        deadClicks: 0,
        deadClickRate: 0
      },
      intentToPricedDraft: {
        observationSource: "client",
        receiptAuthority: "server_authoritative",
        storage: "firebase",
        samples: 0,
        medianMs: null,
        p75Ms: null
      },
      issueResolution: {
        observationSource: "client",
        pairing: "same_session_exact_category",
        samples: 0,
        medianMs: null,
        p75Ms: null,
        byCategory: []
      }
    }} />);
    expect(emptyFirebaseMarkup).toContain('data-reporting-state="available"');
    expect(emptyFirebaseMarkup).toContain("No qualifying 250 ms primary-action assessments");
    expect(emptyFirebaseMarkup).toContain("No client-observed exact server-authoritative Firebase priced-draft receipts");
    expect(emptyFirebaseMarkup).toContain("No same-session exact-category issue-resolution pairs");
    expect(emptyFirebaseMarkup).not.toContain("0.0%");
  });
});
