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

vi.mock("quotepilot-active-conversation-panel", () => ({
  default: (props) => {
    stores.panelProps.current = props;
    return <div data-testid="conversation-panel" />;
  }
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PORTAL_KEY = "portal_key_askabout_flag_off_0001";

function portalQuote() {
  return {
    portalKey: PORTAL_KEY,
    status: "viewed",
    quoteNumber: "Q-1001",
    customerName: "Jordan Customer",
    eventType: "wedding",
    guests: 90,
    total: 5000,
    deposit: 1500,
    portalIssuedAtISO: "2026-08-11T09:00:00.000Z",
    deliveryEvidence: { revisionId: "v0004" },
    decidableOptions: [
      { itemType: "addon", name: "Premium Bar", price: 15, pricingType: "per_person" }
    ]
  };
}

let container;
let root;
let CustomerPortalView;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

beforeAll(async () => {
  vi.stubEnv("VITE_PILOT_DECISION_ROOM_ENABLED", "true");
  vi.stubEnv("VITE_AMBIENT_UI_ENABLED", "false");
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

describe("customer portal with Ambient off and the v0.7 decision-room gate on", () => {
  test("preserves the legacy v0.7 questions and option request without mounting AIUI-46", async () => {
    act(() => {
      root.render(
        <CustomerPortalView initialPortalKey={PORTAL_KEY} onBackToStaff={() => {}} />
      );
    });
    await settle();

    expect(container.textContent).toContain("Event details");
    expect(container.textContent).toContain("Your decision");
    expect(container.textContent).toContain("Request Changes");
    expect(container.querySelector(".portal-decision-room")).toBeNull();
    expect(container.querySelector(".portal-decision-room-cover")).toBeNull();
    expect(container.textContent).not.toContain("Your proposal total");
    expect(container.textContent).not.toContain("Your response");
    expect(container.textContent).not.toContain("Possible additions");
    expect(container.querySelectorAll(".portal-ask-about")).toHaveLength(4);
    expect(container.textContent).toContain("Ask about this");
    expect(container.querySelector(".portal-decidable-options")).toBeTruthy();
    expect(container.textContent).toContain("Options you can ask to add");
    expect(container.textContent).toContain("Premium Bar");
    expect(container.querySelector('[data-portal-block="assumptions"]')).toBeTruthy();
    expect(container.querySelector('[data-portal-block="terms"]')).toBeNull();
    expect(container.querySelector('[data-testid="conversation-panel"]')).toBeTruthy();
    expect(stores.panelProps.current?.prefill ?? null).toBeNull();
    expect(stores.panelProps.current?.onPrefillResolution ?? null).toBeNull();

    const option = container.querySelector(".portal-decidable-card");
    act(() => option.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    expect(container.querySelector(".portal-decision-panel textarea").value)
      .toBe("Please add Premium Bar.");
    expect(option.hasAttribute("aria-pressed")).toBe(false);
    expect(container.querySelector("[data-option-draft-outcome]")).toBeNull();

    const ask = container.querySelector(".portal-ask-about");
    act(() => ask.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    expect(stores.panelProps.current.prefill).toMatchObject({
      text: "Question about the event details: "
    });
    expect(container.querySelector("[data-question-prefill-outcome]")).toBeNull();
  });
});
