import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import EventScheduleModal, {
  EventScheduleView,
  getScheduleCalendarCountLabels,
  getScheduleStatusPresentation
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
});

describe("reporting commercial-state totals", () => {
  test("separates accepted/booked quote value from verified paid-deposit totals", () => {
    const metrics = buildReportingMetrics([
      {
        status: "accepted",
        createdAtISO: "2026-08-02T12:00:00.000Z",
        totals: { total: 4000, deposit: 1000 },
        payment: { depositStatus: "paid" }
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
    ], { nowDate: new Date("2026-08-08T12:00:00.000Z") });

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
