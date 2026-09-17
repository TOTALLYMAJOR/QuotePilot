// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ambientQuoteAdministrationArrivalInput } from "../../App";
import {
  createWorkspaceArrivalHandoff,
  parseWorkspaceArrivalHandoff
} from "../../lib/workspaceArrivalContract";

const mocks = vi.hoisted(() => ({
  deleteQuote: vi.fn(),
  getEventTypes: vi.fn(),
  getQuoteHistory: vi.fn()
}));

vi.mock("../../lib/quoteStore", async () => ({
  ...(await vi.importActual("../../lib/quoteStore")),
  deleteQuote: mocks.deleteQuote,
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

const ACCEPTED_QUOTE = Object.freeze({
  ...QUOTE,
  status: "accepted",
  activeVersionId: "v0017",
  portalKey: "portal-key",
  portalIssuedAtISO: "2026-09-17T10:00:00.000Z",
  portalDecision: Object.freeze({
    decision: "accepted",
    requestId: "acceptance-17",
    submittedAtISO: "2026-09-17T10:30:00.000Z"
  }),
  acceptanceReceipt: Object.freeze({
    receiptId: "acceptance-17",
    quoteRevisionId: "v0017",
    portalIssuedAtISO: "2026-09-17T10:00:00.000Z",
    acceptedAtISO: "2026-09-17T10:30:00.000Z"
  }),
  payment: Object.freeze({
    depositStatus: "paid",
    finalBalance: Object.freeze({ status: "unpaid" })
  })
});

function acceptedRevisionArrival() {
  const handoff = createWorkspaceArrivalHandoff(
    ambientQuoteAdministrationArrivalInput(ACCEPTED_QUOTE.id, {
      acceptedRevisionId: "v0017",
      acceptanceReceiptId: "acceptance-17"
    })
  );
  const url = new URL(handoff.navigation?.path || "/app/quotes", "https://quotepilot.local");
  return {
    handoff,
    parsed: parseWorkspaceArrivalHandoff({
      pathname: url.pathname,
      search: url.search,
      hash: "",
      state: handoff.navigation?.state
    })
  };
}

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
  mocks.deleteQuote.mockReset().mockResolvedValue({ ok: true });
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
  test("carries the decision packet pins through the actual App arrival and resolves the exact accepted quote", async () => {
    const { handoff, parsed } = acceptedRevisionArrival();
    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        object: { type: "customer-decision-artifact" },
        focus: {
          quoteId: ACCEPTED_QUOTE.id,
          acceptedRevisionId: "v0017",
          acceptanceReceiptId: "acceptance-17"
        }
      }
    });
    expect(parsed).toEqual(handoff);

    mocks.getQuoteHistory.mockResolvedValue({ source: "firebase", quotes: [ACCEPTED_QUOTE] });
    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          focusQuoteId={ACCEPTED_QUOTE.id}
          focusAction="administration"
          currentUserRole="sales"
          arrivalContext={parsed.contract}
          onClose={() => {}}
        />
      );
    });
    await settle();
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 50)));

    expect(container.querySelector('[data-accepted-revision-arrival="recovery"]')).toBeNull();
    expect(container.querySelector(`tr[data-quote-id="${ACCEPTED_QUOTE.id}"]`)).not.toBeNull();
  });

  test.each([
    ["revision changed", { activeVersionId: "v0018" }, "accepted revision changed"],
    ["receipt mismatched", {
      acceptanceReceipt: { ...ACCEPTED_QUOTE.acceptanceReceipt, receiptId: "acceptance-18" }
    }, "acceptance receipt no longer matches"]
  ])("renders recovery instead of generic administration when the %s", async (_label, patch, reason) => {
    const { handoff } = acceptedRevisionArrival();
    expect(handoff.ok).toBe(true);
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [{ ...ACCEPTED_QUOTE, ...patch }]
    });
    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          focusQuoteId={ACCEPTED_QUOTE.id}
          focusAction="administration"
          currentUserRole="sales"
          arrivalContext={handoff.contract}
          onClose={() => {}}
        />
      );
    });
    await settle();

    const recovery = container.querySelector('[data-accepted-revision-arrival="recovery"]');
    expect(recovery).not.toBeNull();
    expect(recovery.textContent.toLowerCase()).toContain(reason);
    expect(container.querySelector("table")).toBeNull();
  });

  test("keeps failed permanent-delete confirmation open with the exact failure", async () => {
    mocks.deleteQuote.mockRejectedValueOnce(new Error("The approved delete could not be confirmed."));
    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          currentUserRole="admin"
          canDeleteQuotes
          onClose={() => {}}
        />
      );
    });
    await settle();

    act(() => container.querySelector('[data-quote-action-id="delete"]').click());
    expect(container.querySelector(".confirm-modal")).not.toBeNull();
    await act(async () => {
      byText("Confirm Delete").click();
      await Promise.resolve();
    });

    expect(mocks.deleteQuote).toHaveBeenCalledWith(QUOTE.id, {
      organizationId: "",
      approvalRequestId: ""
    });
    expect(container.querySelector(".confirm-modal")).not.toBeNull();
    expect(container.querySelector(".error-note")?.textContent)
      .toContain("approved delete could not be confirmed");
    expect(byText("Confirm Delete").disabled).toBe(false);
  });

  test("explains an unavailable event-type filter and retries it in place", async () => {
    mocks.getEventTypes
      .mockRejectedValueOnce(new Error("catalog unavailable"))
      .mockResolvedValueOnce([{ id: "wedding", name: "Wedding" }]);
    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          currentUserRole="admin"
          onClose={() => {}}
        />
      );
    });
    await settle();

    const eventType = container.querySelector('[data-view-filter="event-type"]');
    const eventTypeChoice = eventType.querySelector('[data-adaptive-choice-mode="empty"]');
    const recovery = container.querySelector("#quote-event-type-filter-error");
    expect(recovery).not.toBeNull();
    expect(recovery.textContent).toContain("current selection is preserved");
    expect(eventTypeChoice.getAttribute("aria-describedby")).toBe(recovery.id);

    await act(async () => {
      byText("Retry event types").click();
      await Promise.resolve();
    });
    await settle();

    expect(mocks.getEventTypes).toHaveBeenCalledTimes(2);
    expect(container.querySelector("#quote-event-type-filter-error")).toBeNull();
    expect(eventType.querySelector('option[value="wedding"]')?.textContent).toBe("Wedding");
  });

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

  test("focuses the exact configured action received with an administration handoff", async () => {
    act(() => {
      root.render(
        <QuoteHistoryView
          open
          presentation="embedded"
          focusQuoteId={QUOTE.id}
          focusAction="administration"
          focusDestinationAction="edit"
          currentUserRole="sales"
          onClose={() => {}}
          onBackToQuotes={() => {}}
          onEditQuote={() => {}}
        />
      );
    });
    await settle();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const exactAction = container.querySelector('[data-quote-action-id="edit"]');
    expect(exactAction).not.toBeNull();
    expect(document.activeElement).toBe(exactAction);
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
