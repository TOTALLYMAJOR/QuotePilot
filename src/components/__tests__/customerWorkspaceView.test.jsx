// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getWorkspace: vi.fn(), radar: null }));
vi.stubEnv("VITE_AMBIENT_UI_ENABLED", "true");
vi.mock("../../lib/customerWorkspace", async () => ({
  ...(await vi.importActual("../../lib/customerWorkspace")),
  getCustomerWorkspace: mocks.getWorkspace
}));
vi.mock("../CustomerRevenueOpportunities", async () => ({
  ...(await vi.importActual("../CustomerRevenueOpportunities")),
  buildCustomerRevenueOpportunityRead: () => mocks.radar
}));
vi.mock("../CustomerCommercialMeasures", () => ({ default: () => null }));
vi.mock("../CustomerCommercialTimeline", () => ({ default: () => null }));
vi.mock("../RevenueAutopilotCustomerControls", () => ({ default: () => null }));
vi.mock("../AmbientClientsView", () => ({
  AmbientClientRelationshipHost: ({ headingRef, onOpenWorkflow }) => <div>
    <h1 id="ambient-client-overview-title" ref={headingRef} tabIndex={-1}>Exact client</h1>
    <button onClick={() => onOpenWorkflow({ attentionType: "post_event_closeout", quoteId: "quote-one" })}>Review event follow-up</button>
    <button onClick={() => onOpenWorkflow({ attentionType: "follow_up", quoteId: "quote-one" })}>Ordinary task</button>
  </div>
}));
const { default: CustomerWorkspaceView, StaffProposalPreview, resolveCustomerCloseoutTarget } = await import("../CustomerWorkspaceView");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("StaffProposalPreview", () => {
  test("keeps tenant presentation branding inside a customer-presentation boundary", () => {
    const markup = renderToStaticMarkup(
      <StaffProposalPreview
        quote={{
          id: "quote-1",
          quoteNumber: "Q-1001",
          customer: { name: "Ada Lovelace" },
          event: { name: "Launch dinner", date: "2026-09-01", guests: 80 },
          totals: { subtotal: 9000, tax: 720, total: 9720, deposit: 2500 },
          quoteMeta: {
            organizationName: "Northstar Events LLC",
            brandName: "Northstar Catering",
            brandTagline: "Gather beautifully",
            brandLogoUrl: "https://cdn.example.test/logo.png",
            brandPrimaryColor: "#436b55",
            brandAccentColor: "#a7c4a0",
            brandDarkAccentColor: "#294536",
            brandBackgroundStart: "#f4f7f1",
            brandBackgroundMid: "#e1eadc",
            brandBackgroundEnd: "#d5e1cf",
            businessEmail: "hello@northstar.example",
            businessPhone: "205-555-0101"
          }
        }}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain('data-customer-presentation="true"');
    expect(markup).toContain('--portal-brand:#436b55');
    expect(markup).toContain('--portal-surface:#f4f7f1');
    expect(markup).toContain('src="https://cdn.example.test/logo.png"');
    expect(markup).toContain("Northstar Catering");
    expect(markup).toContain("Gather beautifully");
    expect(markup).toContain("Sep 1, 2026");
    expect(markup).not.toContain(">2026-09-01<");
    expect(markup).toContain("$9,720.00");
    expect(markup.indexOf("Close preview"))
      .toBeLessThan(markup.indexOf('data-customer-presentation="true"'));
  });

  test("keeps unsafe logo schemes out of the rendered preview", () => {
    const markup = renderToStaticMarkup(
      <StaffProposalPreview
        quote={{
          quoteNumber: "Q-1002",
          quoteMeta: {
            brandName: "Northstar Catering",
            brandLogoUrl: "javascript:alert(1)"
          }
        }}
        onClose={vi.fn()}
      />
    );

    expect(markup).not.toContain("javascript:");
    expect(markup).toContain("Close preview");
  });
});

const closeout = {
  id: "closeout-one", organizationId: "org-one", quoteId: "quote-one", type: "post_event_closeout",
  event: { name: "Exact dinner", date: "2026-08-29" }, reviewItems: [],
  reviewedAction: { closeoutId: "closeout-one", state: "due" }
};
function closeoutWorkspace() {
  return {
    organizationId: "org-one", source: "firebase", customer: { id: "customer-one", name: "Exact client" },
    quotes: [{ id: "quote-one", organizationId: "org-one", customerId: "customer-one", event: { name: "Exact dinner" } }],
    activeQuotes: [], events: [], money: [], conversations: [], proposalVersions: [], recentActivity: [],
    attention: { itemCount: 1, items: [] }, nextAction: { kind: "none" },
    quotePageInfo: { limit: 25, truncated: false }, versionPageInfo: { perQuoteLimit: 10, truncatedQuoteIds: [] }
  };
}

test("closeout navigation matches the exact loaded tenant and quote without substituting another event", () => {
  const base = { organizationId: "org-one", workspace: closeoutWorkspace(), radar: { opportunities: [closeout] }, target: { quoteId: "quote-one", attentionType: "post_event_closeout" } };
  expect(resolveCustomerCloseoutTarget(base)).toBe(closeout);
  expect(resolveCustomerCloseoutTarget({ ...base, organizationId: "org-other" })).toBeNull();
  expect(resolveCustomerCloseoutTarget({ ...base, target: { ...base.target, quoteId: "missing" } })).toBeNull();
  expect(resolveCustomerCloseoutTarget({ ...base, radar: { opportunities: [closeout, closeout] } })).toBeNull();
  expect(resolveCustomerCloseoutTarget({ ...base, target: { ...base.target, attentionType: "follow_up" } })).toBeNull();
});

test("client follow-up reveals one exact native review and restores its trigger without a Workflow round trip", async () => {
  mocks.getWorkspace.mockResolvedValue(closeoutWorkspace());
  mocks.radar = { status: "available", opportunities: [closeout] };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const openWorkflow = vi.fn();
  try {
    await act(async () => {
      root.render(<CustomerWorkspaceView organizationId="org-one" customerId="customer-one" ambientMode onOpenWorkflow={openWorkflow} />);
    });
    const trigger = [...container.querySelectorAll("button")].find((node) => node.textContent === "Review event follow-up");
    expect(trigger).toBeTruthy();
    trigger.focus();
    act(() => trigger.click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 65)); });
    expect(openWorkflow).not.toHaveBeenCalled();
    expect(container.querySelector(".ambient-client-overview__record").open).toBe(true);
    expect(document.activeElement.dataset.closeoutReviewHeading).toBe("quote-one");
    expect(container.querySelectorAll('[data-capability-id="cwf-11-authoritative-post-event-closeout"]')).toHaveLength(1);
    act(() => [...container.querySelectorAll("button")].find((node) => node.textContent === "Return to client summary").click());
    expect(document.activeElement).toBe(trigger);
    act(() => [...container.querySelectorAll("button")].find((node) => node.textContent === "Ordinary task").click());
    expect(openWorkflow).toHaveBeenCalledWith({ attentionType: "follow_up", quoteId: "quote-one" });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
