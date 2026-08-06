import { describe, expect, test } from "vitest";
import {
  APPROVAL_ACTIONS,
  buildKitchenCheckpoints,
  buildProductionChecklist,
  buildProposalReadiness,
  buildQuoteLifecycleTimeline,
  buildQuoteScenarios,
  buildWorkflowAttentionSummary
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
  test("registers final-balance approval without changing the legacy default payment action", () => {
    expect(APPROVAL_ACTIONS[0]).toEqual({
      id: "send_payment_request",
      label: "Send payment request"
    });
    expect(APPROVAL_ACTIONS).toContainEqual({
      id: "send_final_balance_request",
      label: "Send final balance request"
    });

    const timeline = buildQuoteLifecycleTimeline({
      workflow: {
        approvalRequests: [{
          id: "final-balance-approval",
          action: "send_final_balance_request",
          state: "pending",
          requestedAtISO: "2026-08-04T15:00:00.000Z"
        }]
      }
    });
    expect(timeline.find((item) => item.id === "approval-requested-final-balance-approval"))
      .toMatchObject({ detail: "Send final balance request" });
  });

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

  test("adds exact-request internal handling to the lifecycle without replacing customer evidence", () => {
    const timeline = buildQuoteLifecycleTimeline({
      portalDecision: {
        decision: "changes_requested",
        message: "Update the menu.",
        requestId: "request-current",
        submittedAtISO: "2026-05-02T10:00:00.000Z"
      },
      workflow: {
        changeRequestHandling: {
          sourceRequestId: "request-current",
          sourceSubmittedAtISO: "2026-05-02T10:00:00.000Z",
          sourceMessage: "Update the menu.",
          state: "handled",
          acknowledgedAtISO: "2026-05-02T11:00:00.000Z",
          acknowledgedByEmail: "sales@example.com",
          handledAtISO: "2026-05-02T12:00:00.000Z",
          handledByEmail: "sales@example.com",
          note: "Updated the menu and prepared the revision."
        }
      }
    });

    expect(timeline.map((item) => item.label)).toEqual([
      "Customer requested changes",
      "Change request acknowledged internally",
      "Change request marked handled internally"
    ]);
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

  test("builds one attention count per quote while retaining each actionable reason", () => {
    const quotes = [{
      id: "quote-attention",
      quoteNumber: "Q-ATTENTION",
      status: "viewed",
      portalDecision: {
        decision: "changes_requested",
        message: "Please remove the coffee service.",
        requestId: "request-attention",
        submittedAtISO: "2026-08-02T15:00:00.000Z"
      },
      workflow: {
        followUp: {
          stage: "awaiting_response",
          dueDate: "2026-08-01",
          completed: false
        },
        approvalRequests: [{
          id: "approval-1",
          action: "rotate_portal_link",
          state: "pending",
          requestedAtISO: "2026-08-02T16:00:00.000Z"
        }]
      }
    }];
    const original = structuredClone(quotes);
    const summary = buildWorkflowAttentionSummary(quotes, { todayISO: "2026-08-03" });

    expect(summary).toMatchObject({
      quoteCount: 1,
      itemCount: 3,
      counts: { changeRequests: 1, followUps: 1, approvals: 1 }
    });
    expect(summary.items.map((item) => item.type)).toEqual([
      "change_request",
      "follow_up",
      "approval"
    ]);
    expect(summary.items[1]).toMatchObject({ state: "overdue", daysOverdue: 2 });
    expect(summary.items[0]).toMatchObject({
      sourceRequestId: "request-attention",
      sourceMessage: "Please remove the coffee service."
    });
    expect(quotes).toEqual(original);
  });

  test("keeps due-today distinct and sorts same-priority work by date then quote number", () => {
    const summary = buildWorkflowAttentionSummary([
      {
        id: "quote-z",
        quoteNumber: "Q-Z",
        status: "sent",
        workflow: { followUp: { dueDate: "2026-08-02", completed: false } }
      },
      {
        id: "quote-b",
        quoteNumber: "Q-B",
        status: "sent",
        workflow: { followUp: { dueDate: "2026-08-01", completed: false } }
      },
      {
        id: "quote-a",
        quoteNumber: "Q-A",
        status: "sent",
        workflow: { followUp: { dueDate: "2026-08-01", completed: false } }
      },
      {
        id: "quote-today",
        quoteNumber: "Q-TODAY",
        status: "sent",
        workflow: { followUp: { dueDate: "2026-08-03", completed: false } }
      }
    ], { todayISO: "2026-08-03" });

    expect(summary.items.map((item) => item.quoteId)).toEqual([
      "quote-a",
      "quote-b",
      "quote-z",
      "quote-today"
    ]);
    expect(summary.items.at(-1)).toMatchObject({ state: "due_today", daysOverdue: 0 });
  });

  test("keeps acknowledged change requests visible and reopens attention for a later request", () => {
    const quote = {
      id: "quote-change-request",
      status: "sent",
      portalDecision: {
        decision: "changes_requested",
        message: "Change the menu.",
        requestId: "request-current",
        submittedAtISO: "2026-08-03T10:00:00.000Z"
      },
      workflow: {
        changeRequestHandling: {
          sourceRequestId: "request-current",
          sourceSubmittedAtISO: "2026-08-03T10:00:00.000Z",
          sourceMessage: "Change the menu.",
          state: "acknowledged"
        }
      }
    };

    const acknowledged = buildWorkflowAttentionSummary([quote], { todayISO: "2026-08-03" });
    expect(acknowledged.items[0]).toMatchObject({ type: "change_request", state: "acknowledged" });

    const handled = buildWorkflowAttentionSummary([{
      ...quote,
      workflow: {
        changeRequestHandling: {
          sourceRequestId: "request-current",
          sourceSubmittedAtISO: "2026-08-03T10:00:00.000Z",
          sourceMessage: "Change the menu.",
          state: "handled"
        }
      }
    }], { todayISO: "2026-08-03" });
    expect(handled.quoteCount).toBe(0);

    const laterRequest = buildWorkflowAttentionSummary([{
      ...quote,
      portalDecision: {
        decision: "changes_requested",
        message: "Change the menu again.",
        requestId: "request-later",
        submittedAtISO: "2026-08-03T11:00:00.000Z"
      },
      workflow: {
        changeRequestHandling: {
          sourceRequestId: "request-current",
          sourceSubmittedAtISO: "2026-08-03T10:00:00.000Z",
          sourceMessage: "Change the menu.",
          state: "handled"
        }
      }
    }], { todayISO: "2026-08-03" });
    expect(laterRequest.items[0]).toMatchObject({ type: "change_request", state: "new" });
  });

  test("suppresses non-active, future, completed, and won follow-up work", () => {
    const summary = buildWorkflowAttentionSummary([
      {
        id: "terminal",
        status: "booked",
        workflow: { followUp: { dueDate: "2026-08-01", completed: false } }
      },
      {
        id: "future",
        status: "sent",
        workflow: { followUp: { dueDate: "2026-08-04", completed: false } }
      },
      {
        id: "complete",
        status: "sent",
        workflow: { followUp: { dueDate: "2026-08-01", completed: true } }
      },
      {
        id: "won",
        status: "accepted",
        workflow: { followUp: { stage: "won", dueDate: "2026-08-01", completed: false } }
      }
    ], { todayISO: "2026-08-03" });

    expect(summary).toMatchObject({ quoteCount: 0, itemCount: 0 });
  });

  test("computes default kitchen checkpoint offsets and clock times from an event start time", () => {
    const checkpoints = buildKitchenCheckpoints({ time: "18:00", hours: 5 });

    expect(checkpoints.map((item) => [item.id, item.minuteOffset, item.timeValue])).toEqual([
      ["prep-start", -180, "15:00"],
      ["line-check", -120, "16:00"],
      ["pack-out", -60, "17:00"],
      ["onsite-setup", -30, "17:30"],
      ["service-start", 0, "18:00"],
      ["service-end", 300, "23:00"],
      ["reset", 345, "23:45"]
    ]);
  });

  test("returns no checkpoints when the event has no valid start time", () => {
    expect(buildKitchenCheckpoints({ time: "", hours: 5 })).toEqual([]);
    expect(buildKitchenCheckpoints({ time: "not-a-time", hours: 5 })).toEqual([]);
  });

  test("applies checkpoint overrides by id while leaving unlisted checkpoints at defaults", () => {
    const checkpoints = buildKitchenCheckpoints({
      time: "18:00",
      hours: 5,
      kitchenCheckpointOverrides: [
        { id: "prep-start", label: "Custom prep", minuteOffset: -200 },
        { id: "unknown-id", label: "Ignored", minuteOffset: 15 }
      ]
    });

    expect(checkpoints).toHaveLength(7);
    expect(checkpoints.find((item) => item.id === "prep-start")).toMatchObject({
      label: "Custom prep",
      minuteOffset: -200,
      timeValue: "14:40"
    });
    expect(checkpoints.find((item) => item.id === "line-check")).toMatchObject({
      label: "Line check",
      minuteOffset: -120
    });
  });

  test("scales service-end and reset offsets with event duration, with a 60-minute floor", () => {
    const threeHourEvent = buildKitchenCheckpoints({ time: "12:00", hours: 3 });
    expect(threeHourEvent.find((item) => item.id === "service-end")).toMatchObject({ minuteOffset: 180 });
    expect(threeHourEvent.find((item) => item.id === "reset")).toMatchObject({ minuteOffset: 225 });

    const shortEvent = buildKitchenCheckpoints({ time: "12:00", hours: 0.25 });
    expect(shortEvent.find((item) => item.id === "service-end")).toMatchObject({ minuteOffset: 60 });
    expect(shortEvent.find((item) => item.id === "reset")).toMatchObject({ minuteOffset: 105 });
  });

  test("surfaces malformed current change-request evidence as unhandleable attention", () => {
    const summary = buildWorkflowAttentionSummary([{
      id: "malformed-change-request",
      status: "viewed",
      updatedAtISO: "2026-08-03T12:00:00.000Z",
      portalDecision: {
        decision: "changes_requested",
        submittedAtISO: "not-a-date"
      }
    }], { todayISO: "2026-08-03" });

    expect(summary).toMatchObject({
      quoteCount: 1,
      itemCount: 1,
      counts: { changeRequests: 1 }
    });
    expect(summary.items[0]).toMatchObject({
      type: "change_request",
      state: "invalid",
      unhandleable: true
    });
  });
});
