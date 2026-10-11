// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getWorkspace: vi.fn(), getVersions: vi.fn(), radar: null }));
vi.stubEnv("VITE_AMBIENT_UI_ENABLED", "true");
vi.mock("../../lib/customerWorkspace", async () => ({
  ...(await vi.importActual("../../lib/customerWorkspace")),
  getCustomerWorkspace: mocks.getWorkspace,
  getCustomerQuoteVersions: mocks.getVersions
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

test("renders the client and allows proposal history while private controls continue loading", async () => {
  const coreWorkspace = closeoutWorkspace();
  const completeWorkspace = {
    ...coreWorkspace,
    proposalVersions: [{ id: "version-one", quoteId: "quote-one" }]
  };
  let resolveComplete;
  const completeRead = new Promise((resolve) => { resolveComplete = resolve; });
  mocks.radar = null;
  let resolveHistory;
  mocks.getVersions.mockImplementation(() => new Promise((resolve) => { resolveHistory = resolve; }));
  mocks.getWorkspace.mockImplementation(({ onCoreWorkspace }) => {
    onCoreWorkspace(coreWorkspace);
    return completeRead;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <CustomerWorkspaceView
          organizationId="org-one"
          customerId="customer-one"
          ambientMode
        />
      );
      await Promise.resolve();
    });

    expect(container.querySelector("main")?.dataset.clientProfilePhase).toBe("core");
    expect(container.querySelector("#ambient-client-overview-title")?.textContent).toBe("Exact client");
    expect(container.textContent).toContain("The client overview above is ready to use.");
    expect(container.querySelector(".customer-workspace-tabs")).not.toBeNull();
    expect(mocks.getVersions).not.toHaveBeenCalled();
    const history = container.querySelector(".customer-version-history");
    await act(async () => {
      history.open = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(history.textContent).toContain("Loading proposal history");
    expect(history.textContent).not.toContain("No retained proposal versions");
    expect(mocks.getWorkspace).toHaveBeenCalledWith(expect.objectContaining({ includeVersions: false }));

    await act(async () => {
      resolveComplete(completeWorkspace);
      await completeRead;
    });

    expect(container.querySelector("main")?.dataset.clientProfilePhase).toBe("complete");
    expect(container.querySelector(".customer-workspace-tabs")).not.toBeNull();
    expect(container.textContent).not.toContain("The client overview above is ready to use.");
    expect(history.textContent).toContain("Loading proposal history");
    await act(async () => { resolveHistory({ items: [{ id: "history-one", reason: "Fresh proposal history" }], truncated: false }); });
    expect(history.textContent).toContain("Fresh proposal history");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test("keeps the core client overview recoverable when supplemental reads fail", async () => {
  const coreWorkspace = closeoutWorkspace();
  mocks.radar = null;
  mocks.getWorkspace.mockImplementation(({ onCoreWorkspace }) => {
    onCoreWorkspace(coreWorkspace);
    return Promise.reject(new Error("Retained history read failed."));
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <CustomerWorkspaceView
          organizationId="org-one"
          customerId="customer-one"
          ambientMode
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("main")?.dataset.clientProfilePhase).toBe("core-error");
    expect(container.querySelector("#ambient-client-overview-title")?.textContent).toBe("Exact client");
    expect(container.querySelector('[data-capability-state="partial"] [role="alert"]')?.textContent)
      .toContain("The client record and linked opportunities remain available above.");
    expect([...container.querySelectorAll("button")].some((button) => (
      button.textContent.trim() === "Retry client details"
    ))).toBe(true);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test.each([
  ["customer change", "org-one", "customer-two"],
  ["organization change", "org-two", "customer-one"]
])("discards old core, private controls, and history responses after a %s", async (_label, organizationId, customerId) => {
  const first = closeoutWorkspace();
  const next = {
    ...closeoutWorkspace(), organizationId,
    customer: { id: customerId, name: "Next client" },
    quotes: [{ id: "quote-next", customerId, organizationId }]
  };
  let resolveOld;
  let resolveHistory;
  let publishOldCore;
  mocks.radar = null;
  mocks.getVersions.mockReset().mockImplementation(() => new Promise((resolve) => { resolveHistory = resolve; }));
  mocks.getWorkspace.mockImplementationOnce(({ onCoreWorkspace }) => {
    publishOldCore = onCoreWorkspace;
    onCoreWorkspace(first);
    return new Promise((resolve) => { resolveOld = resolve; });
  }).mockResolvedValue(next);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<CustomerWorkspaceView organizationId="org-one" customerId="customer-one" />); });
    const history = container.querySelector(".customer-version-history");
    await act(async () => {
      history.open = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => { root.render(<CustomerWorkspaceView organizationId={organizationId} customerId={customerId} />); });
    expect(container.querySelector("h1")?.textContent).toBe("Next client");
    await act(async () => {
      publishOldCore(first);
      resolveOld(first);
      resolveHistory({ items: [{ id: "old-version", reason: "Old tenant snapshot" }], truncated: false });
    });
    expect(container.querySelector("h1")?.textContent).toBe("Next client");
    expect(container.textContent).not.toContain("Old tenant snapshot");
    expect(container.querySelectorAll(".customer-version-history")).toHaveLength(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test("keeps failed histories local and retries without reloading the customer", async () => {
  const workspace = closeoutWorkspace();
  workspace.quotes.push({ ...workspace.quotes[0], id: "quote-two", quoteNumber: "Second quote" });
  mocks.radar = null;
  mocks.getWorkspace.mockReset().mockResolvedValue(workspace);
  mocks.getVersions.mockReset().mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce({ items: [{ id: "v2", reason: "Second saved proposal" }], truncated: false })
    .mockResolvedValueOnce({ items: [], truncated: false });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<CustomerWorkspaceView organizationId="org-one" customerId="customer-one" />); });
    const histories = container.querySelectorAll(".customer-version-history");
    await act(async () => {
      histories.forEach((history) => { history.open = true; });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(histories[0].querySelector('[role="alert"]')).not.toBeNull();
    expect(histories[0].textContent).not.toContain("No retained proposal versions");
    expect(histories[1].textContent).toContain("Second saved proposal");
    await act(async () => { histories[0].querySelector("button").click(); });
    expect(histories[0].textContent).toContain("No retained proposal versions");
    expect(mocks.getWorkspace).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test("refreshes an already open proposal history and preserves its disclosure", async () => {
  mocks.radar = null;
  mocks.getWorkspace.mockReset().mockResolvedValue(closeoutWorkspace());
  mocks.getVersions.mockReset()
    .mockResolvedValueOnce({ items: [{ id: "v1", reason: "Original version" }], truncated: false })
    .mockResolvedValueOnce({ items: [{ id: "v2", reason: "Refreshed version" }], truncated: false });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<CustomerWorkspaceView organizationId="org-one" customerId="customer-one" />); });
    const history = container.querySelector(".customer-version-history");
    await act(async () => { history.open = true; await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(history.textContent).toContain("Original version");
    const summary = history.querySelector("summary");
    summary.focus();
    let historyTop = 180;
    history.getBoundingClientRect = () => ({ top: historyTop });
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const originalAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      historyTop = 216;
      callback();
      return 1;
    };
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Refresh").click(); });
    expect(history.open).toBe(true);
    expect(history.textContent).toContain("Refreshed version");
    expect(document.activeElement).toBe(summary);
    expect(scrollBy).toHaveBeenCalledWith({ top: 36, left: 0, behavior: "auto" });
    window.requestAnimationFrame = originalAnimationFrame;
    scrollBy.mockRestore();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test.each(["complete", "failed"])("locks writes during private controls loading and handles a %s read without blocking history", async (outcome) => {
  let finish;
  let fail;
  const workspace = closeoutWorkspace();
  mocks.radar = { status: "available", opportunities: [closeout, {
    id: "rebook-one", type: "anniversary_rebooking", quoteId: "quote-one",
    event: { name: "Repeat dinner" },
    reviewedAction: { state: "ready_for_staff_review", sourceQuoteId: "quote-one", sourceVersionId: "version-one", acceptanceReceiptId: "receipt-one" }
  }] };
  mocks.getWorkspace.mockReset().mockImplementation(({ onCoreWorkspace }) => {
    onCoreWorkspace(workspace);
    return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<CustomerWorkspaceView organizationId="org-one" customerId="customer-one" onCreateRebook={vi.fn()} />); });
    const rebook = () => container.querySelector('[data-opportunity-type="anniversary_rebooking"] button');
    const attendance = () => container.querySelector('.post-event-actual-attendance__form input[type="number"]');
    expect(container.querySelector(".customer-version-history")).not.toBeNull();
    expect(rebook()?.disabled).toBe(true);
    expect(attendance()?.disabled).toBe(true);
    await act(async () => {
      if (outcome === "complete") finish(workspace);
      else fail(new Error("Private controls unavailable"));
    });
    expect(rebook()?.disabled).toBe(outcome !== "complete");
    expect(attendance()?.disabled).toBe(outcome !== "complete");
    expect(container.querySelector(".customer-version-history")).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
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
