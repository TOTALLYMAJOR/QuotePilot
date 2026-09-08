import { describe, expect, test } from "vitest";
import {
  buildCommitmentExecutionPresentation,
  buildEventWorkspacePresentation,
  deriveEventIntelligence
} from "../../components/eventWorkspacePresentation";

const quote = {
  id: "quote-event-workspace",
  quoteNumber: "Q-EVENT-1001",
  customerId: "customer-event-workspace",
  status: "accepted",
  customer: {
    name: "Maya Bennett",
    organization: "Bennett Foundation"
  },
  event: {
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    guests: 120,
    venue: "The Foundry Hall",
    style: "Plated",
    servers: 4,
    chefs: 2,
    bartenders: 0
  },
  selection: {
    eventTypeId: "benefit-dinner",
    packageName: "Classic",
    menuItemNames: ["Herb chicken", "Seasonal vegetables", "Dinner rolls"],
    addons: ["standard-bar"],
    addonQuantities: { "standard-bar": 1 },
    rentals: ["linen", "chairs"],
    rentalQuantities: { linen: 2, chairs: 2 }
  },
  totals: { total: 2803.68 },
  lifecycle: {
    draftAtISO: "2026-08-20T14:00:00.000Z",
    sentAtISO: "2026-08-22T14:00:00.000Z",
    acceptedAtISO: "2026-08-25T14:00:00.000Z"
  },
  workflow: {
    followUp: {
      dueDate: "2026-09-05",
      stage: "open",
      completed: false
    }
  }
};

describe("event workspace presentation", () => {
  test("composes a committed event into planning, consequence, evidence, and one next action", () => {
    const model = buildCommitmentExecutionPresentation({
      ...quote,
      payment: { depositStatus: "paid" },
      booking: {
        staffLead: "Jordan Lee",
        productionChecklist: [{
          id: "event-brief",
          completed: true,
          completedAtISO: "2026-09-01T15:00:00.000Z",
          completedByEmail: "ops@example.test"
        }]
      }
    }, {
      source: "firebase",
      now: new Date("2026-09-08T12:00:00.000Z"),
      tenantTimeZone: "UTC"
    });

    expect(model.timingLabel).toBe("11 days away");
    expect(model.commercialEvidence.deposit).toBe("Deposit paid");
    expect(model.runOfShow.operationalReadiness.state).toBe("not_established");
    expect(model.runOfShow.timeline).toHaveLength(7);
    expect(model.attention[0]).toMatchObject({
      id: "workflow",
      action: { kind: "workflow", label: "Open in Workflow" }
    });
    expect(model.evidence.find((item) => item.id === "checklist-event-brief")).toMatchObject({
      actor: "ops@example.test",
      transition: "Checklist item → Completed"
    });
    expect(model.actuals.state).toBe("unavailable");
    expect(model.replay).toMatchObject({
      state: "unavailable",
      title: "Execution replay is not established"
    });
  });

  test("fails closed when execution facts, provider evidence, and replay authority are absent", () => {
    const model = buildCommitmentExecutionPresentation({
      id: "bounded-event",
      quoteNumber: "QP-BOUNDARY",
      status: "accepted",
      event: { name: "Bounded event", date: "2026-09-08" }
    }, {
      source: "local",
      now: new Date("2026-09-08T12:00:00.000Z"),
      tenantTimeZone: "UTC"
    });

    expect(model.timingLabel).toBe("Today");
    expect(model.commercialEvidence.deposit).toBe("Deposit status not recorded");
    expect(model.missingFacts.map((item) => item.label)).toEqual(expect.arrayContaining([
      "Event start time",
      "Event duration",
      "Venue",
      "Staff lead"
    ]));
    expect(model.nextAction).toEqual({ kind: "quote", label: "Open quote record" });
    expect(model.actuals.detail).toContain("does not infer");
    expect(model.replay.detail).toContain("not an immutable event-session ledger");
    expect(JSON.stringify(model)).not.toMatch(/operationally ready|live issue resolved|staff checked in/i);
  });

  test("uses allowlisted payment semantics and gives paid status precedence over failed checkout state", () => {
    const model = buildCommitmentExecutionPresentation({
      ...quote,
      payment: {
        depositStatus: "mystery",
        finalBalance: { status: "paid", stripeCheckoutState: "failed" }
      }
    }, { todayISO: "2026-09-08" });

    expect(model.commercialEvidence.deposit).toBe("Deposit status not recorded");
    expect(model.commercialEvidence.finalBalance).toBe("Final balance paid");
  });

  test("binds acceptance history only to its exact receipt revision", () => {
    const model = buildCommitmentExecutionPresentation({
      ...quote,
      activeVersionId: "revision-v5",
      latestVersionNumber: 5,
      acceptanceReceipt: {
        receiptId: "acceptance-1",
        quoteRevisionId: "revision-v4",
        acceptedAtISO: quote.lifecycle.acceptedAtISO
      }
    }, { todayISO: "2026-09-08" });

    expect(model.commitment.revision).toBe("Version 5");
    expect(model.commitment.acceptance).toBe("Acceptance receipt for revision revision-v4");
    expect(model.evidence.find((item) => item.id === "proposal-accepted")?.revision)
      .toBe("Accepted revision revision-v4");
  });

  test("preserves missing, partial, and explicit-zero staffing as distinct states", () => {
    const missing = buildCommitmentExecutionPresentation({
      id: "missing-staff", status: "accepted", event: { date: "2026-09-08" }
    }, { todayISO: "2026-09-08" });
    const partial = buildCommitmentExecutionPresentation({
      id: "partial-staff", status: "accepted", event: { date: "2026-09-08", servers: 2 }
    }, { todayISO: "2026-09-08" });
    const zero = buildCommitmentExecutionPresentation({
      id: "zero-staff", status: "accepted", event: { date: "2026-09-08", servers: 0, chefs: 0, bartenders: 0 }
    }, { todayISO: "2026-09-08" });

    expect(missing.staffingSummary).toBe("Quoted staff counts not recorded");
    expect(partial.staffingSummary).toContain("2 quoted staff across 1 of 3 recorded roles");
    expect(zero.staffingSummary).toBe("0 quoted staff");
  });

  test("uses tenant-local calendar boundaries and never offers unavailable Schedule", () => {
    const model = buildCommitmentExecutionPresentation({
      ...quote,
      workflow: {},
      event: { ...quote.event, date: "2026-09-08" },
      booking: { productionChecklist: [] }
    }, {
      now: new Date("2026-09-09T04:30:00.000Z"),
      tenantTimeZone: "America/Chicago",
      scheduleAvailable: false
    });

    expect(model.timingLabel).toBe("Today");
    expect(model.nextAction).toEqual({ kind: "quote", label: "Open quote record" });
  });

  test("repurposes existing deterministic intelligence without inventing unsupported scores", () => {
    const first = deriveEventIntelligence(quote, {
      source: "firebase",
      todayISO: "2026-09-06"
    });
    const second = deriveEventIntelligence(quote, {
      source: "firebase",
      todayISO: "2026-09-06"
    });

    expect(second).toEqual(first);
    expect(first.condition).toMatchObject({
      state: "attention",
      title: "Follow-up overdue",
      reasonCodes: ["follow_up_overdue"]
    });
    expect(first.readiness).toMatchObject({
      label: "Proposal readiness",
      scopeLabel: "Proposal completeness only",
      score: 84,
      state: "review"
    });
    expect(first.readiness.gaps.map((gap) => gap.id)).toEqual([
      "customer-email",
      "duration"
    ]);
    expect(first.readiness.evidence).toMatchObject({
      criteriaCount: 11,
      recordedCriteriaCount: 9,
      recommendedGapCount: 1
    });
    expect(first.flexibility).toMatchObject({
      state: "unavailable",
      score: null,
      reasonCodes: ["event_change_window_contract_absent"]
    });
    expect(first.alignment).toMatchObject({
      state: "unavailable",
      score: null,
      reasonCodes: ["combined_transaction_integrity_projection_absent"]
    });
    expect(first.needsYou.target).toMatchObject({
      quoteId: quote.id,
      attentionType: "follow_up"
    });
  });

  test("builds event identity, truthful selected scope, and lifecycle", () => {
    const model = buildEventWorkspacePresentation(quote, {
      source: "firebase",
      ordinaryEditAllowed: false,
      todayISO: "2026-09-05"
    });

    expect(model.eventName).toBe("Autumn Benefit Dinner");
    expect(model.customerName).toBe("Maya Bennett");
    expect(model.eventDate).toBe("Sep 19, 2026");
    expect(model.eventTime).toBe("6:00 PM");
    expect(model.guests).toBe("120");
    expect(model.total).toBe("$2,803.68");
    expect(model.context.staffing.detail).toBe("6 quoted staff");
    expect(model.context.rentals.detail).toBe("2 line items · 4 quoted units");
    expect(model.soldScope.find((item) => item.id === "rentals")?.value).toBe("4 quoted units");
    expect(model.lifecycle.map((item) => item.state)).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming"
    ]);
    expect(model.lifecycle[1].dateLabel).toBe("Aug 22, 2026");
    expect(model.editBoundary).toContain("governed change path");
  });

  test("uses an exact existing Workflow item for current condition and next action", () => {
    const model = buildEventWorkspacePresentation(quote, {
      source: "local",
      todayISO: "2026-09-06"
    });

    expect(model.attention).toMatchObject({
      state: "attention",
      label: "Needs attention",
      title: "Follow-up overdue"
    });
    expect(model.nextAction).toMatchObject({
      kind: "workflow",
      label: "Open in Workflow",
      target: {
        quoteId: quote.id,
        attentionType: "follow_up",
        requestId: `follow-up:${quote.id}`
      }
    });
    expect(model.evidenceNote).toContain("Browser-local workspace");
  });

  test("carries the canonical blocked-closeout queue identity as exact focus context", () => {
    const bookedQuote = {
      ...quote,
      status: "booked",
      workflow: {
        postEventCloseout: {
          closeoutId: "",
          quoteId: quote.id,
          state: "blocked_source",
          eventDate: "2026-09-19",
          dueDate: "2026-09-22",
          policy: { state: "blocked_source" }
        }
      }
    };
    const model = buildEventWorkspacePresentation(bookedQuote, {
      source: "firebase",
      todayISO: "2026-09-23"
    });

    expect(model.nextAction.target).toEqual({
      quoteId: quote.id,
      attentionType: "post_event_closeout",
      requestId: `post-event-closeout:${quote.id}:blocked-source`
    });
  });

  test("does not turn an empty bounded queue into readiness or completion", () => {
    const model = buildEventWorkspacePresentation({
      ...quote,
      status: "draft",
      workflow: {}
    }, {
      source: "local",
      ordinaryEditAllowed: true,
      todayISO: "2026-08-09"
    });

    expect(model.attention.title).toBe("No tracked quote attention");
    expect(model.attention.detail).toContain("not an event-readiness or completion claim");
    expect(model.nextAction).toMatchObject({ kind: "edit", label: "Edit quote" });
    expect(model.context.production.detail).toContain("browser-local BEO");
    expect(JSON.stringify(model)).not.toMatch(/inventory availability|payment received|staffing capacity/i);
  });

  test("does not label an implied lifecycle milestone as pending", () => {
    const model = buildEventWorkspacePresentation({
      ...quote,
      lifecycle: {
        draftAtISO: quote.lifecycle.draftAtISO,
        acceptedAtISO: quote.lifecycle.acceptedAtISO
      }
    }, { source: "firebase" });

    expect(model.lifecycle[1]).toMatchObject({
      id: "sent",
      state: "complete",
      dateLabel: "Date not recorded"
    });
  });

  test.each([
    ["draft", ["current", "upcoming", "upcoming", "upcoming"]],
    ["sent", ["complete", "current", "upcoming", "upcoming"]],
    ["viewed", ["complete", "current", "upcoming", "upcoming"]],
    ["accepted", ["complete", "complete", "current", "upcoming"]],
    ["booked", ["complete", "complete", "complete", "current"]]
  ])("maps the %s quote lifecycle without inventing milestone dates", (status, expectedStates) => {
    const model = buildEventWorkspacePresentation({
      ...quote,
      status,
      lifecycle: {},
      createdAtISO: "2026-08-20T14:00:00.000Z"
    }, { source: "firebase" });

    expect(model.lifecycle.map((item) => item.state)).toEqual(expectedStates);
    for (const item of model.lifecycle.filter((entry) => entry.state === "complete")) {
      if (item.id !== "draft") expect(item.dateLabel).toBe("Date not recorded");
    }
  });
});
