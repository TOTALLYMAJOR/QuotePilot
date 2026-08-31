// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEventTypes: vi.fn(),
  getQuoteHistory: vi.fn()
}));

vi.mock("../../lib/quoteStore", async () => ({
  ...(await vi.importActual("../../lib/quoteStore")),
  getQuoteHistory: mocks.getQuoteHistory
}));

vi.mock("../../lib/menuService", async () => ({
  ...(await vi.importActual("../../lib/menuService")),
  getEventTypes: mocks.getEventTypes
}));

import {
  isExactQuoteAdministrationArrival,
  QuoteHistoryView
} from "../QuoteHistoryModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUOTE = Object.freeze({
  id: "quote-event-route",
  quoteNumber: "Q-1616",
  customerId: "customer-event-route",
  status: "draft",
  customer: Object.freeze({ name: "Maya Bennett", email: "maya@example.test" }),
  event: Object.freeze({
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    guests: 120,
    venue: "The Foundry Hall"
  }),
  selection: Object.freeze({ packageName: "Classic", menuItemNames: Object.freeze(["Herb chicken"]) }),
  totals: Object.freeze({ total: 2803.68 }),
  createdAtISO: "2026-08-09T12:00:00.000Z",
  updatedAtISO: "2026-08-09T12:00:00.000Z"
});

let container;
let root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    await Promise.resolve();
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function byText(label) {
  return [...container.querySelectorAll("button")]
    .find((item) => item.textContent.replace(/\s+/g, " ").trim().includes(label));
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn()
  });
  mocks.getEventTypes.mockReset().mockResolvedValue([]);
  mocks.getQuoteHistory.mockReset().mockResolvedValue({ source: "local", quotes: [QUOTE] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete Element.prototype.scrollIntoView;
});

describe("QuoteHistoryView event workspace integration", () => {
  test("uses the quote detail route as an event record while preserving administration elsewhere", async () => {
    const onBackToQuotes = vi.fn();
    const onOpenSchedule = vi.fn();
    const onOpenCustomer = vi.fn();
    const onEditQuote = vi.fn();

    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          focusQuoteId={QUOTE.id}
          currentUserRole="sales"
          onClose={() => {}}
          onBackToQuotes={onBackToQuotes}
          onOpenSchedule={onOpenSchedule}
          scheduleAvailable
          onOpenCustomer={onOpenCustomer}
          onEditQuote={onEditQuote}
        />
      );
    });
    await settle();

    const workspace = container.querySelector(`.event-workspace[data-quote-id="${QUOTE.id}"]`);
    expect(workspace).not.toBeNull();
    expect(workspace.getAttribute("tabindex")).toBe("-1");
    expect(container.querySelector("h1")?.textContent).toBe("Autumn Benefit Dinner");
    expect(container.querySelector("table")).toBeNull();

    act(() => byText("Edit quote").click());
    act(() => byText("Schedule").click());
    act(() => byText("Customer").click());
    act(() => byText("Back to Quotes").click());

    expect(onEditQuote).toHaveBeenCalledWith(QUOTE);
    expect(onOpenSchedule).toHaveBeenCalledOnce();
    expect(onOpenCustomer).toHaveBeenCalledWith(QUOTE.customerId);
    expect(onBackToQuotes).toHaveBeenCalledOnce();
  });

  test("opens administration on only the exact focused quote instead of returning to an ambiguous list", async () => {
    const otherQuote = {
      ...QUOTE,
      id: "quote-other",
      quoteNumber: "Q-OTHER"
    };
    mocks.getQuoteHistory.mockResolvedValue({
      source: "local",
      quotes: [otherQuote, QUOTE]
    });

    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          focusQuoteId={QUOTE.id}
          currentUserRole="sales"
          onClose={() => {}}
          onBackToQuotes={() => {}}
          onEditQuote={() => {}}
        />
      );
    });
    await settle();

    expect(container.querySelector(".event-workspace")).not.toBeNull();

    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          focusQuoteId={QUOTE.id}
          focusAction="administration"
          currentUserRole="sales"
          onClose={() => {}}
          onBackToQuotes={() => {}}
          onEditQuote={() => {}}
        />
      );
    });
    await settle();

    expect(container.querySelector(".event-workspace")).toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector(`tr[data-quote-id="${QUOTE.id}"]`)).not.toBeNull();
    expect(container.querySelector('tr[data-quote-id="quote-other"]')).toBeNull();
    expect(container.textContent).toContain("Showing 1 of 2 quotes");
  });

  test("accepts only an exact semantic Payment administration arrival", () => {
    const arrivalContext = {
      destination: "administration",
      surfaceId: "quote-administration",
      focusConsumerState: "supported",
      object: { id: QUOTE.id, type: "payment-evidence", label: "Payment" },
      intentId: "review_payment_controls",
      focus: { quoteId: QUOTE.id }
    };

    expect(isExactQuoteAdministrationArrival({
      arrivalContext,
      focusQuoteId: QUOTE.id
    })).toBe(true);
    expect(isExactQuoteAdministrationArrival({
      arrivalContext: {
        ...arrivalContext,
        object: { ...arrivalContext.object, id: "quote-other" }
      },
      focusQuoteId: QUOTE.id
    })).toBe(false);
    expect(isExactQuoteAdministrationArrival({
      arrivalContext: {
        ...arrivalContext,
        intentId: "review_proposal_controls"
      },
      focusQuoteId: QUOTE.id
    })).toBe(false);
  });

  test("keeps same-organization index rows mounted while Back refreshes authoritative history", async () => {
    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          organizationId="org-a"
          focusQuoteId={QUOTE.id}
          currentUserRole="sales"
          onClose={() => {}}
        />
      );
    });
    await settle();
    expect(container.querySelector(`.event-workspace[data-quote-id="${QUOTE.id}"]`)).not.toBeNull();

    const pendingRefresh = deferred();
    mocks.getQuoteHistory.mockReturnValueOnce(pendingRefresh.promise);
    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          organizationId="org-a"
          focusQuoteId=""
          currentUserRole="sales"
          onClose={() => {}}
        />
      );
    });
    await settle();

    expect(container.querySelector(`tr[data-quote-id="${QUOTE.id}"]`)).not.toBeNull();
    pendingRefresh.resolve({
      source: "local",
      quotes: [{ ...QUOTE, quoteNumber: "Q-1616-REFRESHED" }]
    });
    await settle();
    expect(container.querySelector(`tr[data-quote-id="${QUOTE.id}"]`)?.textContent)
      .toContain("Q-1616-REFRESHED");
  });

  test("preserves same-organization index filters across opportunity detail and Back", async () => {
    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          organizationId="org-a"
          focusQuoteId=""
          currentUserRole="sales"
          onClose={() => {}}
        />
      );
    });
    await settle();

    const search = container.querySelector('input[placeholder="Search customer, quote #, or event"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, "Maya");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(search.value).toBe("Maya");

    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          organizationId="org-a"
          focusQuoteId={QUOTE.id}
          currentUserRole="sales"
          onClose={() => {}}
        />
      );
    });
    await settle();
    expect(container.querySelector(`.event-workspace[data-quote-id="${QUOTE.id}"]`)).not.toBeNull();

    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          organizationId="org-a"
          focusQuoteId=""
          currentUserRole="sales"
          onClose={() => {}}
        />
      );
    });
    await settle();

    expect(container.querySelector('input[placeholder="Search customer, quote #, or event"]')?.value)
      .toBe("Maya");
    expect(container.querySelector(`tr[data-quote-id="${QUOTE.id}"]`)).not.toBeNull();
  });

  test("clears prior-organization rows immediately when the tenant changes", async () => {
    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          organizationId="org-a"
          currentUserRole="sales"
          onClose={() => {}}
        />
      );
    });
    await settle();
    expect(container.querySelector(`tr[data-quote-id="${QUOTE.id}"]`)).not.toBeNull();

    const pendingTenantRead = deferred();
    mocks.getQuoteHistory.mockReturnValueOnce(pendingTenantRead.promise);
    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          organizationId="org-b"
          currentUserRole="sales"
          onClose={() => {}}
        />
      );
    });
    await settle();

    expect(container.querySelector(`tr[data-quote-id="${QUOTE.id}"]`)).toBeNull();
    pendingTenantRead.resolve({
      source: "local",
      quotes: [{
        ...QUOTE,
        id: "quote-other-tenant",
        quoteNumber: "Q-OTHER-TENANT",
        customerId: "customer-other-tenant",
        event: { ...QUOTE.event, name: "Other Tenant Event" }
      }]
    });
    await settle();
    expect(container.querySelector('tr[data-quote-id="quote-other-tenant"]')?.textContent)
      .toContain("Q-OTHER-TENANT");
  });
});
