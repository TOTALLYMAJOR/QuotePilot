// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ClearDeckView, EventPlanningView } from "../LiveOperationsPlanningViews";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const authorityMocks = vi.hoisted(() => ({
  getKitchenBeoArtifactStatus: vi.fn(),
  getOperationalStaffingSnapshot: vi.fn(),
  ingredientExecution: vi.fn()
}));

vi.mock("../../lib/kitchenBeoClient", () => ({
  getKitchenBeoArtifactStatus: authorityMocks.getKitchenBeoArtifactStatus
}));
vi.mock("../../lib/operationalStaffingClient", () => ({
  getOperationalStaffingSnapshot: authorityMocks.getOperationalStaffingSnapshot
}));
vi.mock("../../hooks/useEventIngredientExecutionProjection", () => ({
  useEventIngredientExecutionProjection: authorityMocks.ingredientExecution
}));

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
  authorityMocks.ingredientExecution.mockReset().mockReturnValue({
    access: { readEnabled: false, mutationEnabled: false, reason: "Disabled" },
    planRead: { state: "not_evaluated", sourceState: "not_evaluated", projection: null },
    read: { state: "not_recorded", sourceState: "not_recorded", projection: null },
    operation: { state: "idle" },
    controlsLocked: true,
    blockedReason: "Disabled"
  });
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
  test("offers Operations only when the Calendar capability supplies a continuation", () => {
    const withoutOperations = renderToStaticMarkup(
      <EventPlanningView snapshot={snapshot()} />
    );
    const withOperations = renderToStaticMarkup(
      <EventPlanningView snapshot={snapshot()} onOpenOperations={() => {}} />
    );

    expect(withoutOperations).not.toContain(">Operations</button>");
    expect(withOperations).toContain(">Operations</button>");
  });

  test("withholds stale staffing coverage and retries authority reads after snapshot refresh", async () => {
    authorityMocks.getKitchenBeoArtifactStatus.mockReset().mockResolvedValue({ state: "UNKNOWN" });
    authorityMocks.getOperationalStaffingSnapshot.mockReset()
      .mockResolvedValueOnce({ state: "stale", snapshot: { coverage: { state: "coverage_confirmed" } } })
      .mockResolvedValueOnce({
        state: "current",
        organizationId: "org-a",
        quoteId: "event-a",
        activeQuoteRevisionId: "revision-a",
        snapshot: { coverage: { state: "coverage_confirmed" } }
      });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const quote = { id: "event-a", organizationId: "org-a", status: "accepted", activeVersionId: "revision-a", event: { date: "2027-09-12" } };

    await act(async () => {
      root.render(<EventPlanningView snapshot={snapshot({ quotes: [quote], loadedAt: 1 })} organizationId="org-a" routeMode="live" quoteId="event-a" />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Authoritative read is stale; coverage is withheld");
    expect(container.textContent).not.toContain("Operational staffing coverage is confirmed");

    await act(async () => {
      root.render(<EventPlanningView snapshot={snapshot({ quotes: [quote], loadedAt: 2 })} organizationId="org-a" routeMode="live" quoteId="event-a" />);
      await Promise.resolve();
    });
    expect(authorityMocks.getOperationalStaffingSnapshot).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Operational staffing coverage is confirmed");
    await act(async () => root.unmount());
    container.remove();
  });

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

  test("turns Event Focus into a commitment briefing with one primary operational continuation", () => {
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
              hours: 5,
              venue: "Magnolia House",
              venueAddress: "12 Garden Lane",
              style: "Buffet",
              guests: 96
            },
            selection: { packageName: "Garden Classic" },
            activeVersionId: "revision-4",
            latestVersionNumber: 4,
            acceptanceReceipt: { receiptId: "acceptance-4", quoteRevisionId: "revision-4" }
          }]
        })}
        routeMode="detail"
        quoteId="event-a"
      />
    );

    expect(markup).toContain('data-execution-surface="event-focus"');
    expect(markup).toContain('aria-label="Current commitment"');
    expect(markup).toContain("Event plan");
    expect(markup).toContain("Saved total");
    expect(markup).toContain("Payment context");
    expect(markup).toContain("Version 4");
    expect(markup).toContain("12 Garden Lane");
    expect(markup).toContain("Garden Classic");
    expect(markup).toContain("Final balance status not recorded");
    expect(markup).toContain("Acceptance receipt for revision revision-4");
    expect(markup.match(/>Enter Control Room</g)).toHaveLength(1);
    expect(markup).toContain("Open commercial truth");
    expect(markup).not.toContain("Operationally ready");
    expect(markup).not.toContain(">Replay</button>");
    expect(markup).not.toContain("<h3");
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

  test("uses Control Room as a bounded coordination board and keeps live actuals unavailable", () => {
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

    expect(markup).toContain('data-execution-surface="control-room"');
    expect(markup).toContain("Planning view only");
    expect(markup).toContain("Event Preflight");
    expect(markup).toContain("Unknown / unavailable");
    expect(markup).toContain("Planned sequence");
    expect(markup).toContain("Recorded checklist");
    expect(markup).toContain("Live actuals are not recorded");
    expect(markup).toContain('aria-label="Next valid action"');
    expect(markup).toContain("Back to Event Focus");
    expect(markup).toContain("Open quote record");
    expect(markup).not.toContain("Ingredient demand is not planned");
    expect(markup).not.toContain("Review ingredient plan");
    expect(markup).not.toContain(">Replay</button>");
  });

  test("mounts ingredient usage from its independent inventory gate without requiring Event Operating Spine", () => {
    authorityMocks.ingredientExecution.mockReturnValue({
      access: { readEnabled: true, mutationEnabled: false, role: "sales" },
      planRead: { state: "current", sourceState: "current", projection: null },
      read: { state: "not_recorded", sourceState: "current", projection: null },
      operation: { state: "idle" },
      controlsLocked: true,
      blockedReason: "Administrator required"
    });
    const markup = renderToStaticMarkup(
      <EventPlanningView
        snapshot={snapshot({ quotes: [{ id: "event-a", status: "accepted", event: { date: "2027-09-12" } }] })}
        organizationId="org-a"
        role="sales"
        routeMode="live"
        quoteId="event-a"
        eventOperationsEnabled={false}
        inventoryAuthorityEnabled
        inventoryTenantEnabled
      />
    );
    expect(authorityMocks.ingredientExecution).toHaveBeenCalledWith(expect.objectContaining({
      active: true,
      browserEnabled: true,
      tenantEnabled: true,
      quoteId: "event-a"
    }));
    expect(markup).toContain("Ingredient actuals");
    expect(markup).toContain("administrator must record or correct");
    expect(markup).toContain("Ingredient demand is not planned");
    expect(markup).toContain("Projected ingredient cost is not available");
    expect(markup).not.toContain("data-event-operations-entry=\"control-room\"");
  });

  test("keeps Replay unavailable while disclosing current-record support without relabeling it", () => {
    const markup = renderToStaticMarkup(
      <EventPlanningView
        snapshot={snapshot({
          quotes: [{
            id: "event-a",
            status: "booked",
            quoteNumber: "QP-1001",
            lifecycle: { bookedAtISO: "2026-09-01T14:00:00.000Z" },
            booking: {
              contractNumber: "C-1001",
              productionChecklist: [{
                id: "event-brief",
                completed: true,
                completedAtISO: "2026-09-02T15:00:00.000Z",
                completedByEmail: "ops@example.test"
              }]
            },
            event: { name: "Available event", date: "2027-09-12" }
          }]
        })}
        routeMode="replay"
        quoteId="event-a"
      />
    );

    expect(markup).toContain('data-execution-surface="replay"');
    expect(markup).toContain("Execution replay is not established");
    expect(markup).toContain("Supporting record evidence");
    expect(markup).toContain("not a complete or immutable execution chronology");
    expect(markup).toContain("Back to Event Focus");
  });

});

describe("ClearDeckView bounded decision review", () => {
  test("limits the review queue and exposes no invented decision authority", () => {
    const items = [
      { id: "approval-a", type: "approval", quoteId: "quote-a", quote: { quoteNumber: "QP-1001" }, pendingRequests: [{ id: "approval-a", action: "rotate_portal_link", state: "pending" }] },
      { id: "decision-b", type: "decision_debt", quoteId: "quote-b", quote: { quoteNumber: "QP-1002" } },
      { id: "approval-c", type: "approval", quoteId: "quote-c", quote: { quoteNumber: "QP-1003" }, pendingRequests: [{ id: "approval-c", action: "rotate_portal_link", state: "pending" }] },
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
    expect(decisions).toHaveLength(4);
    expect(decisions.map((item) => item.querySelector("h3").textContent))
      .toEqual([
        "Decide rotate portal link",
        "Review unresolved commercial decision",
        "Decide rotate portal link",
        "Review unresolved commercial decision"
      ]);
    expect(container.textContent).toContain("Workflow owns");
    expect(container.textContent).toContain("does not acknowledge or resolve");
    expect(Array.from(container.querySelectorAll("button")).map((button) => button.textContent.trim()))
      .toEqual(["Refresh", "Review in Workflow", "Review in Workflow", "Review in Workflow", "Review in Workflow"]);
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
              quote: { quoteNumber: "QP-1001" },
              pendingRequests: [{ id: "approval-request-a", action: "rotate_portal_link", state: "pending" }]
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
      requestId: "approval-request-a",
      actionId: "review-workflow:approval-request-a"
    }, expect.objectContaining({
      actionId: "review-workflow:approval-request-a",
      preserveReturnContext: true,
      returnContextSurfaceId: "decision-resolution"
    }));
    expect(onOpenWorkflow).toHaveBeenNthCalledWith(2, {
      quoteId: "quote-b",
      attentionType: "decision_debt",
      requestId: "decision:quote-b",
      actionId: "review-workflow:decision:quote-b"
    }, expect.objectContaining({
      actionId: "review-workflow:decision:quote-b",
      preserveReturnContext: true,
      returnContextSurfaceId: "decision-resolution"
    }));
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

    expect(emptyMarkup).toContain("No pending approval decisions appear in this complete bounded snapshot.");
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
