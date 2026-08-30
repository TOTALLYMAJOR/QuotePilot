// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const snapshot = {
  loading: false,
  error: "",
  source: "firebase",
  stale: false,
  loadedAt: Date.parse("2026-08-19T12:00:00.000Z"),
  quotes: [],
  refresh: vi.fn()
};

vi.mock("../../hooks/useCommercialWorkspaceSnapshot", () => ({
  useCommercialWorkspaceSnapshot: () => snapshot
}));

vi.mock("../ambientLivingOpportunityPresentation", () => ({
  buildAmbientLivingOpportunityPresentation: (quote) => ({
    identity: {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      eventName: quote.eventName,
      customerName: quote.customerName,
      venue: quote.venue,
      date: quote.eventDate,
      time: quote.eventTime,
      total: quote.total,
      status: { label: quote.status }
    },
    guestObject: { currentGuestCount: quote.guestCount }
  })
}));

import QuoteWorkspaceConceptPage from "../QuoteWorkspaceConceptPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AUTH_SESSION = {
  organizationId: "org-quote-workspace",
  role: "admin",
  user: { email: "owner@example.test" }
};

const QUOTE = {
  id: "quote-101",
  quoteNumber: "QP-101",
  eventName: "Morgan wedding",
  customerName: "Morgan Lee",
  venue: "Pine Hall",
  eventDate: "2026-09-12",
  eventTime: "5:00 PM",
  guestCount: 175,
  status: "Draft",
  total: 19475,
  updatedAtISO: "2026-08-19T11:30:00.000Z",
  menuItems: [{ id: "salad", name: "Garden salad", quantity: 175, unitPrice: 5 }],
  activity: [{ id: "saved", label: "Quote saved", actor: "Owner", at: "2026-08-19T11:30:00.000Z" }]
};

let container;
let root;

beforeEach(() => {
  snapshot.loading = false;
  snapshot.error = "";
  snapshot.source = "firebase";
  snapshot.stale = false;
  snapshot.quotes = [];
  snapshot.refresh.mockReset();
  window.history.replaceState({}, "", "/app/quote-workspace");
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function mount(props = {}) {
  act(() => {
    root.render(
      <QuoteWorkspaceConceptPage
        authSession={AUTH_SESSION}
        tenantContext={{ organizationId: AUTH_SESSION.organizationId }}
        onExit={vi.fn()}
        {...props}
      />
    );
  });
}

describe("QuoteWorkspaceConceptPage", () => {
  test("keeps the empty state tenant-scoped and hands navigation back to Opportunities", () => {
    const onExit = vi.fn();
    mount({ onExit });

    expect(container.textContent).toContain("No saved quote");
    expect(container.textContent).toContain("Save a quote, then open its workspace");
    act(() => container.querySelector("button").click());
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("retries a failed saved-history read without implying a mutation", () => {
    snapshot.error = "Read failed";
    mount();

    expect(container.textContent).toContain("Quote unavailable");
    expect(container.textContent).toContain("No data changed");
    act(() => container.querySelector("button").click());
    expect(snapshot.refresh).toHaveBeenCalledWith({ force: true });
  });

  test("does not substitute another quote when an exact requested quote is unavailable", () => {
    snapshot.quotes = [QUOTE];
    window.history.replaceState({}, "", "/app/quote-workspace?quoteId=missing-quote");
    mount();

    expect(container.textContent).toContain("Quote unavailable");
    expect(container.textContent).toContain("No alternate quote opened");
    expect(container.textContent).not.toContain("Morgan wedding");
  });

  test("uses the canonical route quote identity instead of substituting the first saved quote", () => {
    snapshot.quotes = [QUOTE, { ...QUOTE, id: "quote-202", quoteNumber: "QP-202", eventName: "Lee gala" }];
    mount({ quoteId: "quote-202" });

    expect(container.textContent).toContain("QP-202");
    expect(container.textContent).toContain("Lee gala");
    expect(container.textContent).not.toContain("Morgan wedding");
  });

  test("renders saved quote evidence and opens a read-only activity and save-health dialog", async () => {
    snapshot.quotes = [QUOTE];
    mount();

    expect(container.textContent).toContain("QP-101");
    expect(container.textContent).toContain("Morgan wedding");
    expect(container.textContent).toContain("$19,475.00");
    expect(container.textContent).toContain("Saved workspace");
    expect(container.textContent).toContain("Completeness does not grant approval");
    expect(Array.from(container.querySelectorAll('.qwc-primary-nav a')).map((link) => link.textContent.trim()))
      .toEqual(["Now", "Opportunities", "Clients", "Library"]);
    expect(Array.from(container.querySelectorAll('.qwc-operations-nav a')).map((link) => link.textContent.trim()))
      .toEqual(["New quote", "Operations"]);
    expect(container.querySelector('[data-testid="quote-workspace"]')).not.toBeNull();
    expect(container.querySelector(".qwc-title-quote").textContent).toBe("QP-101");
    expect(container.textContent).toContain("Difficult Question Desk");
    expect(container.textContent).toContain("Steward is unavailable; quoting is not");
    expect(container.textContent).toContain("Steward handoff unavailable");
    expect(container.querySelector('[data-steward-state="provider_unavailable"]')).not.toBeNull();

    const openDrawer = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Activity & save health"));
    act(() => openDrawer.click());
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));

    const drawer = document.body.querySelector('[data-testid="quote-workspace-activity-drawer"]');
    expect(drawer).not.toBeNull();
    expect(drawer.textContent).toContain("Saved version loaded");
    expect(drawer.textContent).toContain("This panel never saves, sends, or approves a quote");
    expect(drawer.textContent).toContain("Quote saved");

    act(() => drawer.querySelector('[aria-label="Close activity and save health"]').click());
    expect(document.body.querySelector('[data-testid="quote-workspace-activity-drawer"]')).toBeNull();
  });

  test("keeps Library role-safe for sales staff", () => {
    snapshot.quotes = [QUOTE];
    mount({ authSession: { ...AUTH_SESSION, role: "sales" } });

    expect(Array.from(container.querySelectorAll('.qwc-primary-nav a')).map((link) => link.textContent.trim()))
      .toEqual(["Now", "Opportunities", "Clients"]);
  });
});
