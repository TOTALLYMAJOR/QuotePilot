// @vitest-environment jsdom
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AmbientOpportunitiesStream from "../AmbientOpportunitiesStream";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const READ_BOUNDARY = {
  complete: true,
  loading: false,
  partial: false,
  stale: false,
  truncated: false,
  truncationKnown: true,
  loadedAtISO: "2026-08-12T14:59:00.000Z"
};

function quote(index, overrides = {}) {
  return {
    id: `quote-${index}`,
    quoteNumber: `QP-${index}`,
    status: "accepted",
    customer: {
      name: `Customer ${index}`,
      email: `customer-${index}@example.com`,
      phone: "512-555-0101"
    },
    event: {
      name: `Event ${index}`,
      date: "2026-09-20",
      time: "18:00",
      venue: "The Glass House",
      guests: 100 + index,
      hours: 5
    },
    selection: { packageId: "plated", menuItemNames: ["Dinner"] },
    totals: { total: 9000 + index },
    booking: { confirmationStatus: "pending" },
    payment: { depositStatus: "sent", finalBalance: { status: "unpaid" } },
    workflow: {},
    ...overrides
  };
}

const baseProps = {
  quotes: [quote(1)],
  source: "firebase",
  readBoundary: READ_BOUNDARY,
  currentUserRole: "sales",
  nowISO: "2026-08-12T15:00:00.000Z",
  canOpenOpportunity: true,
  canOpenWorkflow: true,
  canStartOpportunity: true,
  canRefresh: true,
  onOpenOpportunity: () => ({ status: "pending" }),
  onOpenWorkflow: () => ({ status: "pending" }),
  onStartOpportunity: () => {},
  onRefresh: () => {}
};

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(props = {}) {
  act(() => root.render(<AmbientOpportunitiesStream {...baseProps} {...props} />));
}

describe("AmbientOpportunitiesStream", () => {
  test("renders an editorial stream with one contextual primary action per row", () => {
    const markup = renderToStaticMarkup(
      <AmbientOpportunitiesStream {...baseProps} quotes={[quote(1), quote(2)]} />
    );
    const parsed = document.createElement("div");
    parsed.innerHTML = markup;
    const rows = Array.from(parsed.querySelectorAll(".ambient-opportunity"));

    expect(markup).toContain('data-surface-contract-id="ambient-opportunities-stream"');
    expect(markup).toContain('data-surface-purpose="clarify advance resolve reveal_context"');
    expect(markup).toContain("Every event, with its next move.");
    expect(markup).toContain("Active &amp; recent");
    expect(markup).toContain("Event 1");
    expect(markup).toContain("Customer 2");
    expect(markup.match(/class="ambient-opportunity"/gu)).toHaveLength(2);
    expect(markup.match(/class="ambient-opportunity__primary-action"/gu)).toHaveLength(2);
    expect(rows.every((row) => (
      row.querySelectorAll(".ambient-opportunity__primary-action").length === 1
      && row.querySelector(".ambient-opportunity__next-reason")?.textContent === "No tracked follow-up due"
      && row.querySelector(".ambient-opportunity__details summary span")?.textContent === "Details"
    ))).toBe(true);
    expect(markup).not.toContain("Opportunity details");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("Quote readiness");
  });

  test("renders canonical attention groups in model order instead of caller order", () => {
    const markup = renderToStaticMarkup(
      <AmbientOpportunitiesStream
        {...baseProps}
        quotes={[
          quote(1),
          quote(2, {
            workflow: {
              approvalRequests: [{
                id: "approval-2",
                state: "pending",
                requestedAtISO: "2026-08-10T12:00:00.000Z"
              }]
            }
          }),
          quote(3, {
            portalDecision: {
              decision: "changes_requested",
              requestId: "change-3",
              message: "Please revise the service plan.",
              submittedAtISO: "2026-08-11T12:00:00.000Z"
            }
          })
        ]}
      />
    );
    const parsed = document.createElement("div");
    parsed.innerHTML = markup;

    expect(Array.from(parsed.querySelectorAll(".ambient-opportunities__group-heading h3"))
      .map((heading) => heading.textContent)).toEqual(["Needs attention", "Active & recent"]);
    expect(Array.from(parsed.querySelectorAll("[data-opportunity-id]"))
      .map((row) => row.dataset.opportunityId)).toEqual(["quote-3", "quote-2", "quote-1"]);
    expect(parsed.querySelector('[data-opportunity-id="quote-3"] .ambient-opportunity__primary-action')
      .textContent).toContain("Review requested changes");
    expect(parsed.querySelector('[data-opportunity-id="quote-1"] .ambient-opportunity__index')
      .textContent.trim()).toBe("03");
  });

  test("labels all four dimensions while using a percentage only for proposal completeness", () => {
    const markup = renderToStaticMarkup(<AmbientOpportunitiesStream {...baseProps} />);

    for (const label of [
      "Proposal completeness",
      "Pricing and margin",
      "Customer state",
      "Event planning"
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup.match(/%/gu)).toHaveLength(1);
    expect(markup).toContain("has not been checked against current pricing");
    expect(markup).toContain("staffing, schedule, BEO, and event readiness are not confirmed here");
    const parsed = document.createElement("div");
    parsed.innerHTML = markup;
    for (const domain of ["commercial", "customer", "operational"]) {
      expect(parsed.querySelector(`[data-momentum-domain="${domain}"]`).textContent)
        .not.toContain("%");
    }
  });

  test("keeps quote lifecycle visually separate from recorded booking and payment facts", () => {
    const markup = renderToStaticMarkup(
      <AmbientOpportunitiesStream
        {...baseProps}
        quotes={[quote(1, {
          status: "booked",
          booking: { confirmationStatus: "confirmed" },
          payment: {
            depositStatus: "paid",
            finalBalance: { status: "paid" }
          }
        })]}
      />
    );

    expect(markup).toContain("Booked");
    expect(markup).toContain("Booking and payment details");
    expect(markup).toContain("Booking confirmation");
    expect(markup).toContain("Deposit paid");
    expect(markup).toContain("Balance paid");
    expect(markup).toContain("do not confirm that the event is ready or every payment is complete");
  });

  test("acknowledges immediately and sends only the exact Workflow focus to its role-safe callback", () => {
    const onOpenWorkflow = vi.fn(() => ({ status: "pending" }));
    mount({
      onOpenWorkflow,
      quotes: [quote(1, {
        workflow: {
          approvalRequests: [{
            id: "approval-42",
            state: "pending",
            requestedAtISO: "2026-08-10T12:00:00.000Z"
          }]
        }
      })]
    });

    const row = container.querySelector('[data-opportunity-id="quote-1"]');
    const actions = row.querySelectorAll(".ambient-opportunity__primary-action");
    expect(actions).toHaveLength(1);
    expect(actions[0].textContent).toContain("Review pending approval");

    act(() => actions[0].click());

    expect(onOpenWorkflow).toHaveBeenCalledWith({
      quoteId: "quote-1",
      attentionType: "approval",
      requestId: "approval-42",
      actionId: "review-opportunity-workflow:quote-1:approval-42",
      object: { id: "quote-1", type: "opportunity", label: "Event 1" },
      reason: "A role-gated approval request is waiting on this exact opportunity.",
      consequence: "The exact Workflow item opens for role-gated review; navigation changes no quote, customer, payment, or provider state.",
      nextResolutionId: "review-focused-workflow-outcome"
    });
    expect(container.querySelector(".ambient-opportunities__acknowledgement").textContent)
      .toContain("Opening review pending approval with its opportunity and reason");
  });

  test("does not expose a Workflow action unless both capability and callback exist", () => {
    const onOpenOpportunity = vi.fn(() => ({ status: "pending" }));
    mount({
      canOpenWorkflow: true,
      onOpenWorkflow: undefined,
      onOpenOpportunity,
      quotes: [quote(1, {
        workflow: {
          approvalRequests: [{
            id: "approval-42",
            state: "pending",
            requestedAtISO: "2026-08-10T12:00:00.000Z"
          }]
        }
      })]
    });

    const action = container.querySelector(".ambient-opportunity__primary-action");
    expect(action.textContent).toContain("Review opportunity context");
    act(() => action.click());
    expect(onOpenOpportunity).toHaveBeenCalledWith(expect.objectContaining({
      quoteId: "quote-1",
      object: { id: "quote-1", type: "opportunity", label: "Event 1" },
      consequence: expect.stringContaining("changing any record")
    }));
  });

  test("renders a contextual completed-empty state without calling it caught up", () => {
    const markup = renderToStaticMarkup(
      <AmbientOpportunitiesStream {...baseProps} quotes={[]} />
    );

    expect(markup).toContain('data-opportunity-stream-state="empty"');
    expect(markup).toContain("No opportunities appear in the current records");
    expect(markup).toContain("Start an opportunity");
    expect(markup).not.toContain('data-caught-up="true"');
  });

  test("passes the empty-state arrival contract to the host before any draft exists", () => {
    const onStartOpportunity = vi.fn();
    mount({ quotes: [], onStartOpportunity });

    const action = container.querySelector('[data-ambient-action-id="start-opportunity"]');
    act(() => action.click());

    expect(onStartOpportunity).toHaveBeenCalledWith({
      actionId: "start-opportunity",
      object: { id: "new-opportunity", type: "opportunity", label: "New opportunity" },
      reason: "The completed opportunity read returned no records and the user chose the meaningful starting action.",
      consequence: "The host opens a new editable quote flow; no proposal is sent or provider action performed.",
      nextResolutionId: "complete-new-opportunity-draft"
    });
    expect(container.querySelector(".ambient-opportunities__acknowledgement").textContent)
      .toContain("Nothing has been sent");
  });

  test("withholds empty and caught-up claims for an incomplete read", () => {
    const markup = renderToStaticMarkup(
      <AmbientOpportunitiesStream
        {...baseProps}
        quotes={[]}
        readBoundary={{ complete: false, loading: false, truncationKnown: false }}
      />
    );

    expect(markup).toContain('data-opportunity-stream-state="incomplete"');
    expect(markup).toContain('data-opportunities-state="unavailable"');
    expect(markup).toContain("We couldn’t load opportunities");
    expect(markup).toContain("No quote or customer record changed");
    expect(markup).toContain("Try again");
    expect(markup).toContain("Start a quote");
    expect(markup).toContain("About this view");
    expect(markup).not.toContain("No opportunities are recorded");
    expect(markup).not.toContain('data-caught-up="true"');
  });

  test("shows caught up only for a current bounded read and preserves local fallback truth", () => {
    const current = renderToStaticMarkup(<AmbientOpportunitiesStream {...baseProps} />);
    const local = renderToStaticMarkup(
      <AmbientOpportunitiesStream {...baseProps} source="local" />
    );

    expect(current).toContain('data-caught-up="true"');
    expect(current).toContain("No tracked follow-ups or proposal gaps are due here");
    expect(local).toContain("Browser-local workspace");
    expect(local).toContain("do not confirm payment or outside-service completion");
  });

  test("uses flow layout, responsive reflow, accessible targets, and no overlay primitives", () => {
    const css = readFileSync(
      join(process.cwd(), "src/components/ambientOpportunitiesStream.css"),
      "utf8"
    );

    expect(css).toMatch(/min-height:\s*44px/u);
    expect(css).toMatch(/@media \(max-width:\s*620px\)/u);
    expect(css).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*?\.ambient-opportunity__next\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/u
    );
    expect(css).toMatch(/\.ambient-opportunity__details-icon/u);
    expect(css).not.toMatch(/content:\s*["'](?:Details|Close)/u);
    expect(css).not.toMatch(/position:\s*(?:fixed|absolute|sticky)/u);
    expect(css).not.toMatch(/\bz-index\s*:/u);
    expect(css).not.toMatch(/transform:\s*translate/u);
  });
});
