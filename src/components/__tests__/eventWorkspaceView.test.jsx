// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import EventWorkspaceView from "../EventWorkspaceView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_QUOTE = Object.freeze({
  id: "quote-cwf-16",
  quoteNumber: "Q-1600",
  customerId: "customer-cwf-16",
  status: "draft",
  customer: Object.freeze({ name: "Maya Bennett", organization: "Bennett Foundation" }),
  event: Object.freeze({
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    guests: 120,
    venue: "The Foundry Hall",
    servers: 4,
    chefs: 2
  }),
  selection: Object.freeze({
    eventTypeId: "benefit-dinner",
    packageName: "Classic",
    menuItemNames: Object.freeze(["Herb chicken", "Seasonal vegetables"]),
    rentals: Object.freeze(["chairs"]),
    rentalQuantities: Object.freeze({ chairs: 120 })
  }),
  totals: Object.freeze({ total: 2803.68 })
});

let container;
let root;

function mount(props = {}) {
  act(() => {
    root.render(
      <EventWorkspaceView
        quote={BASE_QUOTE}
        source="local"
        ordinaryEditAllowed
        scheduleAvailable
        beoAvailable
        conversationAvailable
        onBackToQuotes={() => {}}
        onEditQuote={() => {}}
        onMoreQuoteActions={() => {}}
        onOpenWorkflow={() => {}}
        onOpenSchedule={() => {}}
        onOpenCustomer={() => {}}
        onOpenBeo={() => {}}
        onExportPdf={() => {}}
        onOpenConversation={() => {}}
        {...props}
      />
    );
  });
}

function button(label) {
  return [...container.querySelectorAll("button")]
    .find((item) => item.textContent.replace(/\s+/g, " ").trim().includes(label));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("EventWorkspaceView", () => {
  test("renders the event-first hierarchy and routes its working shortcuts", () => {
    const onBackToQuotes = vi.fn();
    const onEditQuote = vi.fn();
    const onMoreQuoteActions = vi.fn();
    const onOpenSchedule = vi.fn();
    const onOpenCustomer = vi.fn();
    const onOpenBeo = vi.fn();
    const onExportPdf = vi.fn();
    const onOpenConversation = vi.fn();

    mount({
      onBackToQuotes,
      onEditQuote,
      onMoreQuoteActions,
      onOpenSchedule,
      onOpenCustomer,
      onOpenBeo,
      onExportPdf,
      onOpenConversation
    });

    expect(container.querySelector("h1")?.textContent).toBe("Autumn Benefit Dinner");
    expect(container.textContent).toContain("No tracked quote attention");
    expect(container.textContent).toContain("not an event-readiness or completion claim");
    expect(container.textContent).toContain("What this quote records");
    expect(container.textContent).toContain("120 quoted units");
    expect(container.querySelector('[data-event-intelligence="deterministic-presentation-v1"]')).not.toBeNull();
    expect(container.querySelector('[data-intelligence-dimension="readiness"]')?.textContent)
      .toContain("Proposal completeness only");
    expect(container.querySelector('[data-intelligence-dimension="flexibility"]'))
      .toHaveProperty("dataset.intelligenceState", "unavailable");
    expect(container.querySelector('[data-intelligence-dimension="alignment"]'))
      .toHaveProperty("dataset.intelligenceState", "unavailable");
    expect(container.textContent).toContain("Why?");
    expect(container.textContent).not.toMatch(/Optionality score|Operational Slack|Execution Fragility/);

    act(() => button("Back to Quotes").click());
    act(() => button("Edit quote").click());
    act(() => button("Quote administration").click());
    act(() => button("Schedule").click());
    act(() => button("Production / BEO").click());
    act(() => button("Customer").click());
    act(() => button("Download PDF").click());
    act(() => button("Conversation").click());

    expect(onBackToQuotes).toHaveBeenCalledOnce();
    expect(onEditQuote).toHaveBeenCalledWith(BASE_QUOTE);
    expect(onMoreQuoteActions).toHaveBeenCalledOnce();
    expect(onOpenSchedule).toHaveBeenCalledOnce();
    expect(onOpenCustomer).toHaveBeenCalledOnce();
    expect(onOpenBeo).toHaveBeenCalledOnce();
    expect(onExportPdf).toHaveBeenCalledOnce();
    expect(onOpenConversation).toHaveBeenCalledOnce();
  });

  test("does not offer ordinary edit for an accepted event", () => {
    mount({
      quote: { ...BASE_QUOTE, status: "accepted" },
      ordinaryEditAllowed: false
    });

    expect(button("Edit quote")).toBeUndefined();
    expect(container.textContent).toContain("governed change path");
    expect(button("Quote administration")).toBeDefined();
  });

  test("routes an exact attention item to Workflow", () => {
    const onOpenWorkflow = vi.fn();
    mount({
      quote: {
        ...BASE_QUOTE,
        workflow: { followUp: { dueDate: "2026-01-01", stage: "open", completed: false } }
      },
      onOpenWorkflow
    });

    expect(container.textContent).toContain("Follow-up overdue");
    act(() => button("Open in Workflow").click());
    expect(onOpenWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      quoteId: BASE_QUOTE.id,
      attentionType: "follow_up"
    }));
  });
});
