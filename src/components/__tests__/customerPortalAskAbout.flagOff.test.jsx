// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
    deliveryEvidence: { revisionId: "v0004" }
  };
}

let container;
let root;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

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

describe("customer portal ask-about with the decision-room flag off (default)", () => {
  test("renders no Ask about this affordance and passes no prefill, even with the conversation available", async () => {
    const { default: CustomerPortalView } = await import("../CustomerPortalView");
    act(() => {
      root.render(
        <CustomerPortalView initialPortalKey={PORTAL_KEY} onBackToStaff={() => {}} />
      );
    });
    await settle();

    expect(container.textContent).toContain("Event details");
    expect(container.querySelector(".portal-ask-about")).toBeNull();
    expect(container.textContent).not.toContain("Ask about this");
    expect(container.querySelector('[data-testid="conversation-panel"]')).toBeTruthy();
    expect(stores.panelProps.current?.prefill ?? null).toBeNull();
  });
});
