import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import EventScheduleModal, {
  buildScheduledEvents,
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

const AMBIENT_UI_ENABLED = import.meta.env.VITE_AMBIENT_UI_ENABLED === "1"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "true"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "yes"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "on";

describe("operational workspace presentations", () => {
  test.each([
    ["schedule", EventScheduleView, EventScheduleModal, "event-schedule-title"],
    ["reporting", ReportingDashboardView, ReportingDashboardModal, "reporting-dashboard-title"]
  ])("renders %s as an embedded region while preserving its modal wrapper", (_name, View, Modal, titleId) => {
    const embedded = renderToStaticMarkup(<View open onClose={() => {}} organizationId="org-a" />);
    expect(embedded).toContain('role="region"');
    expect(embedded).toContain("embedded-workspace-route");
    expect(embedded).toContain("workspace-route-card");
    expect(embedded).toContain(`aria-labelledby="${titleId}"`);
    expect(embedded).not.toContain('aria-modal="true"');
    expect(embedded).toContain(">Back to Home</button>");
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
    expect(markup).toContain("Time not set");
    expect(markup).toContain("Venue not set");
    expect(markup).toContain("Customer not recorded");
    expect(markup).toContain("Guest count not set");
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
    expect(markup).toContain("Total: $0.00");
  });

  test("does not append a guest suffix to an invalid legacy value", () => {
    const markup = renderToStaticMarkup(<ScheduleEventFacts item={{ guests: "unknown" }} />);
    expect(markup).toContain("Guest count not set");
    expect(markup).not.toContain("Guest count not set guests");
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
    if (AMBIENT_UI_ENABLED) {
      expect(markup).toContain("Ambient interaction health");
      expect(markup).toContain("Primary dead-click rate");
    } else {
      expect(markup).not.toContain("Ambient interaction health");
      expect(markup).not.toContain("Primary dead-click rate");
    }
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
