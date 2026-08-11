// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const stores = vi.hoisted(() => ({
  getPortalQuote: vi.fn(),
  panelProps: { current: null }
}));

vi.mock("../../lib/quoteStore", () => ({
  PROPOSAL_ACCEPTANCE_CONSENT_VERSION: "proposal-acceptance-v1",
  getPortalQuote: stores.getPortalQuote,
  updatePortalDecision: vi.fn(),
  updatePortalQuoteStatus: vi.fn()
}));

vi.mock("../../lib/portalConversationClient", () => ({
  portalConversationAvailable: () => true
}));

vi.mock("../../lib/portalRecoveryClient", () => ({
  getPortalRecoveryContact: vi.fn().mockResolvedValue({})
}));

vi.mock("../QuoteConversationPanel", () => ({
  default: (props) => {
    stores.panelProps.current = props;
    return <div data-testid="conversation-panel" />;
  }
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PORTAL_KEY = "portal_key_askabout_flag_on_00001";

function portalQuote() {
  return {
    portalKey: PORTAL_KEY,
    status: "viewed",
    quoteNumber: "Q-1002",
    customerName: "Jordan Customer",
    eventType: "wedding",
    guests: 90,
    total: 5000,
    deposit: 1500,
    portalIssuedAtISO: "2026-08-11T09:00:00.000Z",
    deliveryEvidence: { revisionId: "v0004" },
    eventGuests: 90,
    eventDate: "2027-09-12",
    eventHours: 4,
    eventStyle: "Plated",
    quoteMeta: { portalTermsText: "Deposit is non-refundable within 14 days.\nMenu locks 7 days out." },
    decidableOptions: [
      { itemType: "addon", name: "Premium Bar", price: 15, pricingType: "per_person" },
      { itemType: "rental", name: "Linens", price: 9, pricingType: "per_item" }
    ]
  };
}

let CustomerPortalView;
let container;
let root;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

beforeAll(async () => {
  vi.stubEnv("VITE_PILOT_DECISION_ROOM_ENABLED", "true");
  ({ default: CustomerPortalView } = await import("../CustomerPortalView"));
});

beforeEach(() => {
  vi.clearAllMocks();
  stores.panelProps.current = null;
  stores.getPortalQuote.mockResolvedValue(portalQuote());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderPortal() {
  act(() => {
    root.render(
      <CustomerPortalView initialPortalKey={PORTAL_KEY} onBackToStaff={() => {}} />
    );
  });
  await settle();
}

describe("customer portal ask-about with the decision-room flag on", () => {
  test("each existing block gets its own Ask about this button", async () => {
    await renderPortal();

    const buttons = [...container.querySelectorAll(".portal-ask-about")];
    expect(buttons).toHaveLength(5);
    const blocks = [...container.querySelectorAll("[data-portal-block]")]
      .map((element) => element.dataset.portalBlock);
    expect(blocks).toEqual([
      "event-details", "package-and-menu", "pricing", "assumptions", "terms", "options"
    ]);
  });

  test("assumptions restate recorded facts and terms render the tenant's own text verbatim", async () => {
    await renderPortal();
    const assumptions = container.querySelector('[data-portal-block="assumptions"]');
    expect(assumptions.textContent).toContain("90 guests");
    expect(assumptions.textContent).toContain("4 hours of service");
    expect(assumptions.textContent).toContain("plated service");
    const terms = container.querySelector('[data-portal-block="terms"]');
    expect(terms.textContent).toContain("Deposit is non-refundable within 14 days.");
    expect(terms.textContent).toContain("Menu locks 7 days out.");
  });

  test("asking about a block seeds the conversation prefill with that block's name", async () => {
    await renderPortal();

    const pricingBlock = container.querySelector('[data-portal-block="pricing"]');
    const button = pricingBlock.querySelector(".portal-ask-about");
    act(() => {
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(stores.panelProps.current.prefill).toMatchObject({
      text: "Question about the pricing: "
    });
    expect(stores.panelProps.current.prefill.id).toBeGreaterThan(0);
  });

  test("a decidable option drafts the canonical change request without overwriting typed words", async () => {
    await renderPortal();

    const cards = [...container.querySelectorAll(".portal-decidable-card")];
    expect(cards.map((card) => card.textContent)).toEqual([
      "Premium Bar$15.00 per guest",
      "Linens$9.00 per item"
    ]);

    act(() => {
      cards[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    const message = container.querySelector(".portal-decision-panel textarea");
    expect(message.value).toBe("Please add Premium Bar.");
    const changesButton = [...container.querySelectorAll(".portal-decision-options button")]
      .find((button) => button.textContent === "Request Changes");
    expect(changesButton.getAttribute("aria-pressed")).toBe("true");

    // Same card again: no duplicate sentence. Second card: appends a line.
    act(() => {
      cards[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".portal-decision-panel textarea").value)
      .toBe("Please add Premium Bar.");
    act(() => {
      cards[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".portal-decision-panel textarea").value)
      .toBe("Please add Premium Bar.\nPlease add Linens.");
  });

  test("asking about a second block issues a new prefill request id", async () => {
    await renderPortal();

    const click = (blockName) => {
      const block = container.querySelector(`[data-portal-block="${blockName}"]`);
      act(() => {
        block.querySelector(".portal-ask-about")
          .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });
      return stores.panelProps.current.prefill;
    };

    const first = click("event-details");
    const second = click("package-and-menu");
    expect(first.text).toBe("Question about the event details: ");
    expect(second.text).toBe("Question about the package and menu: ");
    expect(second.id).toBeGreaterThan(first.id);
  });
});
