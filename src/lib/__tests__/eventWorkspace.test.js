import { describe, expect, test } from "vitest";
import {
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
      score: 80,
      state: "review"
    });
    expect(first.readiness.gaps.map((gap) => gap.id)).toEqual([
      "customer-email",
      "customer-phone",
      "duration"
    ]);
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
        requestId: ""
      }
    });
    expect(model.evidenceNote).toContain("Browser-local workspace");
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
