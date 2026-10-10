// @vitest-environment jsdom
import React, { act } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomerWorkspace: vi.fn()
}));

vi.mock("../../lib/customerWorkspace", () => ({
  getCustomerWorkspace: mocks.getCustomerWorkspace,
  buildStaffProposalPreview: vi.fn()
}));

vi.mock("../../hooks/useWorkspaceRouteHeadingFocus", () => ({
  useWorkspaceRouteHeadingFocus: () => ({ current: null })
}));

vi.mock("../CustomerRevenueOpportunities", () => ({
  default: () => <div data-test-customer-revenue-opportunities />,
  buildCustomerRevenueOpportunityRead: () => ({ state: "empty", opportunities: [] })
}));

vi.mock("../CustomerCommercialMeasures", () => ({
  default: () => <div data-test-customer-commercial-measures />
}));

vi.mock("../CustomerCommercialTimeline", () => ({
  default: () => <div data-test-customer-commercial-timeline />
}));

vi.mock("../QuoteVersionComparison", () => ({
  default: () => null
}));

vi.mock("../RevenueAutopilotCustomerControls", () => ({
  default: ({
    organizationId,
    customerId,
    controls,
    isAdmin,
    projectionStale,
    projectionError,
    onRefresh
  }) => (
    <div
      data-test-customer-email-controls
      data-organization-id={organizationId}
      data-customer-id={customerId}
      data-is-admin={String(isAdmin)}
      data-controls-revision={controls?.revision ?? ""}
      data-projection-stale={String(projectionStale)}
      data-projection-error={projectionError || ""}
      data-has-refresh={String(typeof onRefresh === "function")}
    />
  )
}));

import CustomerWorkspaceView from "../CustomerWorkspaceView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function workspace() {
  return {
    source: "firebase",
    customer: {
      id: "customer-one",
      customerId: "customer-one",
      name: "Henderson Events",
      email: "events@henderson.example",
      revenueAutopilotEmailControls: {
        schemaVersion: 1,
        authority: "server_projection",
        source: "firebase_server_projection",
        organizationId: "org-one",
        customerId: "customer-one",
        observedAtISO: "2026-08-09T18:55:00.000Z",
        authorityState: "dormant",
        revision: 0,
        consent: { state: "unknown", recordedAtISO: "" },
        subscription: { state: "unknown", recordedAtISO: "" }
      },
      revenueAutopilotEmailControlsError: ""
    },
    quotes: [],
    activeQuotes: [],
    proposalVersions: [],
    events: [],
    money: [],
    conversations: [],
    recentActivity: [],
    attention: { itemCount: 0, items: [] },
    nextAction: { kind: "none", label: "No immediate staff action" },
    briefing: {
      activeQuoteCount: 0,
      displayedQuoteCount: 0,
      attentionCount: 0,
      nextEvent: null,
      latestActivity: null,
      nextAction: { kind: "none", label: "No immediate staff action" },
      scope: { limit: 25, truncated: false }
    },
    quotePageInfo: { limit: 25, truncated: false },
    versionPageInfo: { perQuoteLimit: 10, truncatedQuoteIds: [] }
  };
}

let container;
let root;

async function mount(element) {
  await act(async () => {
    root.render(element);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCustomerWorkspace.mockResolvedValue(workspace());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Customer 360 Revenue Autopilot controls integration", () => {
  test("binds the authenticated admin authority at the routed App boundary", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "App.jsx"),
      "utf8"
    );
    expect(source).toMatch(/<CustomerWorkspaceView[\s\S]*?isAdmin=\{authSession\.isAdmin\}[\s\S]*?\/>/u);
  });

  test("binds the stable tenant/customer identity and authenticated admin role into Overview", async () => {
    await mount(
      <CustomerWorkspaceView
        organizationId="org-one"
        organizationName="Northstar Catering"
        customerId="customer-one"
        isAdmin
      />
    );

    const controls = container.querySelector("[data-test-customer-email-controls]");
    expect(controls).toBeTruthy();
    expect(controls.getAttribute("data-organization-id")).toBe("org-one");
    expect(controls.getAttribute("data-customer-id")).toBe("customer-one");
    expect(controls.getAttribute("data-is-admin")).toBe("true");
    expect(controls.getAttribute("data-controls-revision")).toBe("0");
    expect(controls.getAttribute("data-projection-stale")).toBe("false");
    expect(controls.getAttribute("data-projection-error")).toBe("");
    expect(controls.getAttribute("data-has-refresh")).toBe("true");
    expect(container.querySelector("#customer-panel-overview")?.contains(controls)).toBe(true);
    expect(mocks.getCustomerWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-one",
      customerId: "customer-one",
      onCoreWorkspace: expect.any(Function)
    }));
  });

  test("passes a non-admin role through to the same discoverable role-safe surface", async () => {
    await mount(
      <CustomerWorkspaceView
        organizationId="org-one"
        customerId="customer-one"
        isAdmin={false}
      />
    );

    const controls = container.querySelector("[data-test-customer-email-controls]");
    expect(controls).toBeTruthy();
    expect(controls.getAttribute("data-is-admin")).toBe("false");
  });

  test("passes a failed customer-control read through as unavailable instead of inventing defaults", async () => {
    const readFailure = workspace();
    readFailure.customer.revenueAutopilotEmailControls = null;
    readFailure.customer.revenueAutopilotEmailControlsError =
      "Current customer email controls could not be loaded.";
    mocks.getCustomerWorkspace.mockResolvedValueOnce(readFailure);

    await mount(
      <CustomerWorkspaceView
        organizationId="org-one"
        customerId="customer-one"
        isAdmin
      />
    );

    const controls = container.querySelector("[data-test-customer-email-controls]");
    expect(controls.getAttribute("data-controls-revision")).toBe("");
    expect(controls.getAttribute("data-projection-error")).toMatch(/could not be loaded/i);
  });
});
