// @vitest-environment jsdom

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({ adapter: null }));

vi.mock("../../context/WorkspaceNavigationContext", async () => {
  const actual = await vi.importActual("../../context/WorkspaceNavigationContext");
  return {
    ...actual,
    useWorkspaceReturnContextAdapter: (adapter) => {
      navigationMocks.adapter = adapter;
    }
  };
});

import { ClearDeckView } from "../LiveOperationsPlanningViews";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function snapshotWithRequests(requests) {
  return {
    source: "firebase",
    loadedAt: "2026-09-08T18:00:00.000Z",
    attentionSummary: {
      items: [{
        id: "approval:quote-17",
        type: "approval",
        quoteId: "quote-17",
        quote: {
          id: "quote-17",
          organizationId: "org-one",
          quoteNumber: "QP-0017",
          status: "sent",
          activeVersionId: "v0004",
          event: { name: "Bennett wedding", date: "2026-10-17", startTime: "5:30 PM" },
          customer: { name: "Avery Bennett", email: "avery@example.test" },
          portalKey: "portal-key-current",
          totals: { total: 1500, deposit: 375 }
        },
        pendingRequests: requests
      }]
    }
  };
}

function request(id, note = "Please review this customer-facing access change.") {
  return {
    id,
    action: "rotate_portal_link",
    state: "pending",
    note,
    requestedAtISO: "2026-09-06T16:00:00.000Z",
    requestedByEmail: "sales@example.test"
  };
}

describe("ClearDeckView", () => {
  let container;
  let root;
  let originalScrollTo;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;

  beforeEach(() => {
    navigationMocks.adapter = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalScrollTo = window.scrollTo;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0);
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.scrollTo = originalScrollTo;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test("renders every exact approval as decision-complete business context", () => {
    const requests = Array.from({ length: 4 }, (_, index) => request(`approval-${index + 1}`));
    act(() => {
      root.render(
        <ClearDeckView
          snapshot={snapshotWithRequests(requests)}
          organizationName="Toni Catering"
          organizationId="org-one"
          onOpenWorkflow={vi.fn()}
        />
      );
    });

    const decisions = container.querySelectorAll("[data-decision-request-id]");
    expect(container.querySelector('[data-capability-id="qp-uxr-002-decision-resolution"]')
      ?.getAttribute("data-capability-state")).toBe("success");
    expect(decisions).toHaveLength(4);
    expect(decisions[0].textContent).toContain("Bennett wedding");
    expect(decisions[0].textContent).toContain("Avery Bennett");
    expect(decisions[0].textContent).toContain("Customer access at stake");
    expect(decisions[0].textContent).toContain("execution remains separate");
    expect(decisions[0].textContent).toContain("Connected tenant-scoped quote and approval records");
  });

  test("hands off the exact second request with governed task and return identity", () => {
    const onOpenWorkflow = vi.fn();
    act(() => {
      root.render(
        <ClearDeckView
          snapshot={snapshotWithRequests([request("approval-one"), request("approval-two")])}
          organizationName="Toni Catering"
          organizationId="org-one"
          onOpenWorkflow={onOpenWorkflow}
        />
      );
    });
    const second = container.querySelector('[data-decision-request-id="approval-two"] button');
    act(() => second.click());

    expect(onOpenWorkflow).toHaveBeenCalledWith({
      quoteId: "quote-17",
      attentionType: "approval",
      requestId: "approval-two",
      actionId: "review-workflow:approval-two"
    }, {
      actionId: "review-workflow:approval-two",
      preserveReturnContext: true,
      returnContextSurfaceId: "decision-resolution",
      returnContextHint: {
        focus: {
          kind: "decision-action",
          objectId: "approval-two",
          actionId: "review-workflow:approval-two"
        }
      }
    });
  });

  test("does not call an incomplete read clear", () => {
    act(() => {
      root.render(
        <ClearDeckView
          snapshot={{ source: "firebase", partial: true, attentionSummary: { items: [] } }}
          organizationId="org-one"
        />
      );
    });

    expect(container.textContent).toContain("evidence is incomplete");
    expect(container.textContent).not.toContain("No pending approval decisions appear");
  });

  test("retains exact Decision Debt as a Workflow-owned decision without claiming resolution", () => {
    const onOpenWorkflow = vi.fn();
    act(() => {
      root.render(
        <ClearDeckView
          snapshot={{
            source: "firebase",
            loadedAt: "2026-09-08T18:00:00.000Z",
            attentionSummary: { items: [] },
            quotes: [{
              id: "quote-17",
              quoteNumber: "QP-0017",
              status: "accepted",
              event: { name: "Bennett wedding", date: "2026-10-17" },
              customer: { name: "Avery Bennett" }
            }],
            decisionDebtItems: [{
                id: "decision-debt-42",
                quoteId: "quote-17",
                label: "Confirm final guest count",
                urgency: "high",
                commercialExposureCents: 150000,
                sourceRevisionId: "v0004",
                affectedNodeIds: ["staffing-plan", "kitchen-beo"],
                explanation: ["Final count is still unresolved."]
              }]
          }}
          organizationId="org-one"
          onOpenWorkflow={onOpenWorkflow}
        />
      );
    });

    const decision = container.querySelector('[data-decision-request-id="decision-debt-42"]');
    expect(decision?.textContent).toContain("Confirm final guest count");
    expect(decision?.textContent).toContain("Workflow owns Decision Debt evidence");
    act(() => decision.querySelector("button").click());
    expect(onOpenWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: "quote-17",
        attentionType: "decision_debt",
        requestId: "decision-debt-42"
      }),
      expect.objectContaining({ preserveReturnContext: true })
    );
  });

  test("restores the Clear Deck heading when the resolved decision correctly disappears", async () => {
    act(() => {
      root.render(
        <ClearDeckView
          snapshot={snapshotWithRequests([request("approval-one")])}
          organizationId="org-one"
        />
      );
    });
    const view = navigationMocks.adapter.capture({
      focus: {
        kind: "decision-action",
        objectId: "approval-one",
        actionId: "review-workflow:approval-one"
      }
    });

    act(() => {
      root.render(
        <ClearDeckView
          snapshot={{
            source: "firebase",
            loadedAt: "2026-09-08T18:05:00.000Z",
            attentionSummary: { items: [] }
          }}
          organizationId="org-one"
        />
      );
    });

    let restoration;
    await act(async () => {
      restoration = await navigationMocks.adapter.restore(view);
    });

    expect(restoration).toEqual({ status: "restored" });
    expect(document.activeElement).toBe(container.querySelector("#clear-deck-heading"));
  });

  test("waits through a retained loading card before restoring the reconciled heading", async () => {
    const currentSnapshot = snapshotWithRequests([request("approval-one")]);
    act(() => {
      root.render(<ClearDeckView snapshot={currentSnapshot} organizationId="org-one" />);
    });
    const view = navigationMocks.adapter.capture({
      focus: {
        kind: "decision-action",
        objectId: "approval-one",
        actionId: "review-workflow:approval-one"
      }
    });

    act(() => {
      root.render(
        <ClearDeckView
          snapshot={{ ...currentSnapshot, loading: true }}
          organizationId="org-one"
        />
      );
    });
    const restorationPromise = navigationMocks.adapter.restore(view);
    act(() => {
      root.render(
        <ClearDeckView
          snapshot={{
            source: "firebase",
            loadedAt: "2026-09-08T18:05:00.000Z",
            attentionSummary: { items: [] }
          }}
          organizationId="org-one"
        />
      );
    });

    let restoration;
    await act(async () => {
      restoration = await restorationPromise;
    });
    expect(restoration).toEqual({ status: "restored" });
    expect(document.activeElement).toBe(container.querySelector("#clear-deck-heading"));
  });
});
