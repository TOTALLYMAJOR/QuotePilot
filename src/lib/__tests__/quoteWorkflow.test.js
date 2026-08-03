import { describe, expect, test } from "vitest";
import {
  buildProductionChecklist,
  buildProposalReadiness,
  buildQuoteLifecycleTimeline,
  buildQuoteScenarios
} from "../quoteWorkflow";

function completeForm() {
  return {
    name: "Avery Client",
    email: "avery@example.com",
    phone: "205-555-0100",
    eventName: "Spring Gala",
    date: "2026-05-10",
    time: "18:00",
    venue: "Grand Hall",
    guests: 120,
    hours: 5,
    pkg: "classic",
    menuItems: ["salmon"],
    addons: ["coffee"],
    rentals: ["linen"],
    addonQuantities: { coffee: 1 },
    rentalQuantities: { linen: 12 },
    menuItemQuantities: { salmon: 120 }
  };
}

describe("quote workflow helpers", () => {
  test("scores proposal readiness and identifies actionable gaps", () => {
    const ready = buildProposalReadiness(completeForm(), { total: 9200 });
    expect(ready.score).toBe(100);
    expect(ready.status.id).toBe("ready");
    expect(ready.gaps).toEqual([]);

    const incomplete = buildProposalReadiness({
      ...completeForm(),
      email: "not-an-email",
      venue: "",
      menuItems: []
    }, { total: 9200 });
    expect(incomplete.score).toBe(70);
    expect(incomplete.gaps.map((item) => item.id)).toEqual([
      "customer-email",
      "venue",
      "menu"
    ]);
  });

  test("builds good, better, and best scenarios without mutating the source form", () => {
    const form = completeForm();
    const scenarios = buildQuoteScenarios(form, {
      packages: [
        { id: "signature", name: "Signature", ppp: 70 },
        { id: "essential", name: "Essential", ppp: 40 },
        { id: "classic", name: "Classic", ppp: 55 }
      ]
    });

    expect(scenarios.map((item) => item.id)).toEqual(["good", "better", "best"]);
    expect(scenarios.map((item) => item.packageId)).toEqual(["essential", "classic", "signature"]);
    expect(scenarios[0].form.addons).toEqual([]);
    expect(scenarios[1].form.addons).toEqual(["coffee"]);
    expect(form.addons).toEqual(["coffee"]);
  });

  test("orders lifecycle, customer decision, payment, and booking events by timestamp", () => {
    const timeline = buildQuoteLifecycleTimeline({
      quoteNumber: "Q-100",
      createdAtISO: "2026-05-01T10:00:00.000Z",
      lifecycle: {
        sentAtISO: "2026-05-01T11:00:00.000Z",
        acceptedAtISO: "2026-05-02T10:00:00.000Z"
      },
      portalDecision: {
        decision: "accepted",
        submittedAtISO: "2026-05-02T10:00:00.000Z"
      },
      payment: {
        depositConfirmedAtISO: "2026-05-03T10:00:00.000Z"
      },
      booking: {
        contractNumber: "C-100",
        contractConvertedAtISO: "2026-05-04T10:00:00.000Z"
      },
      workflow: {
        approvalRequests: [{
          id: "approval-1",
          action: "convert_to_contract",
          state: "approved",
          requestedAtISO: "2026-05-03T08:00:00.000Z",
          resolvedAtISO: "2026-05-03T09:00:00.000Z",
          executionState: "succeeded",
          executionCompletedAtISO: "2026-05-04T09:59:00.000Z",
          executionReference: "C-100"
        }]
      }
    });

    expect(timeline[0].label).toBe("Quote created");
    expect(timeline.at(-1).label).toBe("Contract created");
    expect(timeline.some((item) => item.label === "Customer accepted proposal")).toBe(true);
    expect(timeline.some((item) => item.label === "Approved action completed")).toBe(true);
  });

  test("merges persisted production completion into the fixed checklist", () => {
    const checklist = buildProductionChecklist({
      booking: {
        productionChecklist: [
          {
            id: "event-brief",
            completed: true,
            completedAtISO: "2026-05-01T10:00:00.000Z",
            completedByEmail: "ops@example.com"
          },
          { id: "unknown-item", completed: true }
        ]
      }
    });

    expect(checklist.total).toBe(10);
    expect(checklist.completed).toBe(1);
    expect(checklist.percent).toBe(10);
    expect(checklist.items[0]).toMatchObject({ id: "event-brief", completed: true });
  });
});
