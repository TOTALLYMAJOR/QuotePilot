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
    expect(markup).toContain("not accounting revenue");
    expect(markup).not.toContain("Won Revenue");
  });
});
