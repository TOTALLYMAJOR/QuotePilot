// @vitest-environment jsdom
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AmbientNowView from "../AmbientNowView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOW_DATE = new Date("2026-08-12T15:00:00.000Z");
const LOADED_AT = Date.parse("2026-08-12T14:59:00.000Z");

function attentionItem(index, overrides = {}) {
  return {
    id: `follow-up:quote-${index}`,
    type: "follow_up",
    state: "overdue",
    quoteId: `quote-${index}`,
    dateISO: "2026-08-11",
    daysOverdue: 1,
    ...overrides
  };
}

function quote(index, overrides = {}) {
  return {
    id: `quote-${index}`,
    quoteNumber: `QP-${index}`,
    status: "draft",
    customer: { name: `Customer ${index}` },
    event: { name: `Event ${index}`, date: "2026-08-14", guests: 60 + index },
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    loading: false,
    error: "",
    source: "firebase",
    reads: {
      attention: { status: "success" },
      history: { status: "success" },
      unreadReplies: { status: "success" }
    },
    partial: false,
    stale: false,
    attentionSummary: { itemCount: 0, items: [] },
    quotes: [],
    truncated: false,
    truncationKnown: true,
    loadedAt: LOADED_AT,
    ...overrides
  };
}

const baseProps = {
  organizationName: "Toni Catering",
  organizationId: "org-ambient-now",
  currentUserRole: "admin",
  tenantTimeZone: "America/Chicago",
  nowDate: NOW_DATE,
  onRefresh: () => {},
  onOpenWorkflow: () => ({ status: "pending" }),
  onNewQuote: () => {}
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
  act(() => {
    root.render(<AmbientNowView {...baseProps} snapshot={snapshot()} {...props} />);
  });
}

describe("AmbientNowView", () => {
  test("shows at most three interpreted priorities with one exact resolution each", () => {
    const items = [0, 1, 2, 3].map((index) => attentionItem(index));
    const markup = renderToStaticMarkup(
      <AmbientNowView
        {...baseProps}
        snapshot={snapshot({
          attentionSummary: { itemCount: items.length, items },
          quotes: items.map((_, index) => quote(index))
        })}
      />
    );

    expect(markup).toContain("What matters now");
    expect(markup).toContain("What needs attention next");
    expect(markup).toContain("1 more item remains in Workflow");
    expect(markup.match(/class="ambient-now-priority"/gu)).toHaveLength(3);
    expect(markup.match(/data-ambient-action-id="review-now-priority:/gu)).toHaveLength(3);
    expect(markup).toContain("Customer 0");
    expect(markup).not.toContain("Customer 3");
    expect(markup.indexOf("What needs attention next")).toBeLessThan(markup.indexOf("About this view"));
    expect(markup).not.toMatch(/bounded workspace snapshot|current workspace snapshot/iu);
  });

  test("acknowledges a priority immediately and carries its exact Workflow focus", () => {
    const onOpenWorkflow = vi.fn(() => ({ status: "pending" }));
    const item = attentionItem(1, { sourceRequestId: "request-1" });
    mount({
      onOpenWorkflow,
      snapshot: snapshot({
        attentionSummary: { itemCount: 1, items: [item] },
        quotes: [quote(1)]
      })
    });

    const action = container.querySelector('[data-ambient-action-id^="review-now-priority:"]');
    act(() => action.click());

    expect(onOpenWorkflow).toHaveBeenCalledWith({
      quoteId: "quote-1",
      attentionType: "follow_up",
      requestId: "request-1"
    });
    expect(container.querySelector(".ambient-now__acknowledgement").textContent).toContain("Opening follow up");
  });

  test("shows a healthy caught-up state only when Workflow and payment steps are both clear", () => {
    const healthy = renderToStaticMarkup(
      <AmbientNowView {...baseProps} snapshot={snapshot()} />
    );
    const paymentPending = renderToStaticMarkup(
      <AmbientNowView
        {...baseProps}
        snapshot={snapshot({
          quotes: [quote(1, {
            status: "accepted",
            customer: { name: "Avery Bennett" },
            payment: { depositStatus: "unpaid" },
            totals: { deposit: 1200 }
          })]
        })}
      />
    );

    expect(healthy).toContain('data-caught-up="true"');
    expect(healthy).toContain("You are caught up on the work tracked here.");
    expect(paymentPending).toContain('data-caught-up="false"');
    expect(paymentPending).toContain("recorded payment steps remain below");
  });

  test("shows only internal receipt-backed quiet progress", () => {
    const markup = renderToStaticMarkup(
      <AmbientNowView
        {...baseProps}
        snapshot={snapshot({
          quotes: [quote(1, {
            workflow: {
              followUp: {
                completed: true,
                completedAtISO: "2026-08-11T14:00:00.000Z"
              }
            },
            delivery: { state: "delivered" },
            payment: { depositStatus: "paid" }
          })]
        })}
      />
    );

    expect(markup).toContain("Recently completed");
    expect(markup).toContain("Follow-up marked complete internally");
    expect(markup).toContain("do not imply customer contact or provider delivery");
  });

  test("registers its surface, uses compact evidence context, and keeps layout in flow", () => {
    const markup = renderToStaticMarkup(
      <AmbientNowView {...baseProps} snapshot={snapshot({ stale: true })} />
    );
    const css = readFileSync(join(process.cwd(), "src/components/ambientNowView.css"), "utf8");

    expect(markup).toContain('data-surface-contract-id="ambient-now-briefing"');
    expect(markup).toContain('data-surface-purpose="clarify advance resolve reveal_context"');
    expect(markup).toContain('data-staff-evidence-presentation="compact"');
    expect(markup).toContain("Earlier view retained");
    expect(markup).toContain("latest refresh did not finish");
    expect(css).not.toMatch(/position:\s*(?:fixed|absolute|sticky)/u);
    expect(css).not.toMatch(/\bz-index\s*:/u);
    expect(css).toMatch(/min-height:\s*44px/u);
  });

  test("replaces an unavailable read with one safe productive recovery", () => {
    const markup = renderToStaticMarkup(
      <AmbientNowView
        {...baseProps}
        snapshot={snapshot({
          error: "Missing or insufficient permissions.",
          loadedAt: 0,
          reads: {
            attention: { status: "error" },
            history: { status: "error" },
            unreadReplies: { status: "error" }
          },
          truncationKnown: false
        })}
      />
    );

    expect(markup).toContain('data-now-state="unavailable"');
    expect(markup).toContain("We couldn’t load today’s priorities");
    expect(markup).toContain("No quote, customer, or workflow record changed");
    expect(markup).toContain("Try again");
    expect(markup).toContain("Start a quote");
    expect(markup).not.toContain("Missing or insufficient permissions");
    expect(markup).not.toContain("This view cannot call you caught up yet");
    expect(markup).not.toContain("About this view");
  });
});
