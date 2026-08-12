// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildAmbientProposalObject } from "../../lib/ambientProposalObject";
import AmbientProposalContext from "../AmbientProposalContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function quote(overrides = {}) {
  return {
    id: "proposal-ui-proof",
    organizationId: "org-proposal-ui",
    quoteNumber: "Q-UI-1042",
    activeVersionId: "v0002",
    status: "draft",
    createdAtISO: "2026-08-12T10:00:00.000Z",
    updatedAtISO: "2026-08-12T10:42:00.000Z",
    portalKey: "proposal-ui-portal-key-000000002",
    portalIssuedAtISO: "2026-08-12T10:42:00.000Z",
    portalExpiresAtISO: "2026-09-11T10:42:00.000Z",
    customer: { name: "Maya Thompson", email: "maya@example.test", phone: "205-555-0142" },
    event: {
      name: "Thompson Wedding",
      date: "2026-10-03",
      time: "17:30",
      venue: "Juniper Hall",
      guests: 120,
      hours: 6
    },
    selection: {
      packageId: "plated-dinner",
      packageName: "Plated Dinner",
      menuItems: ["salmon"],
      menuItemNames: ["Cedar Salmon"]
    },
    totals: { subtotal: 9000, tax: 750, total: 9750, deposit: 2925 },
    pricing: {
      authority: "server_authoritative",
      calculatedAt: "2026-08-12T10:41:30.000Z",
      grandTotal: 9750
    },
    quoteMeta: { brandName: "Juniper & Pine" },
    workflow: { quoteDelivery: {} },
    ...overrides
  };
}

function model(input = quote(), options = {}) {
  return buildAmbientProposalObject(input, {
    sourceMode: "firebase",
    role: "admin",
    nowISO: "2026-08-12T12:00:00.000Z",
    ...options
  });
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(value) {
  act(() => root.render(<AmbientProposalContext model={value} />));
}

describe("AmbientProposalContext", () => {
  test("renders a populated content-first proposal context with exact evidence boundaries", () => {
    render(model());
    expect(container.querySelector('[data-ambient-intelligent-object="proposal"]')).not.toBeNull();
    expect(container.querySelector('[data-proposal-state="current"]')).not.toBeNull();
    expect(container.textContent).toContain("Thompson Wedding");
    expect(container.textContent).toContain("$9,750.00");
    expect(container.textContent).toContain("What the customer sees");
    expect(container.textContent).toContain("Complete customer view");
    expect(container.textContent).not.toMatch(/\bprojection\b/iu);
    expect(container.textContent).toContain("Proposal completeness");
    expect(container.textContent).toContain("No gaps");
    expect(container.textContent).toContain("What each status is based on");
    expect(container.textContent).toContain("What you can do next");
    expect(container.textContent).toContain("Why this is shown");
    expect(container.textContent).not.toContain("Why QuotePilot is showing this");
    expect(container.textContent).toContain("If you do nothing");
    expect(container.textContent).toContain("Confidence and source");
    expect(container.textContent).toContain("What this connects to");
    expect(container.querySelectorAll("[data-proposal-evidence]")).toHaveLength(4);
    expect(container.querySelectorAll("[data-proposal-action]")).toHaveLength(4);
    expect(container.querySelector('[data-proposal-action="send-proposal"]')?.dataset.actionAvailability)
      .toBe("governed_resolution");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  test("renders every completeness gap rather than an empty or generic context", () => {
    render(model(quote({
      customer: { name: "", email: "bad", phone: "" },
      event: { name: "", date: "", time: "", venue: "", guests: 0, hours: 0 },
      selection: { packageId: "", menuItems: [] },
      totals: { total: 0, deposit: 0 },
      pricing: { authority: "client_preview", grandTotal: 0 }
    })));
    const gaps = container.querySelectorAll("[data-proposal-gap]");
    expect(gaps.length).toBeGreaterThan(5);
    expect(container.textContent).toContain("Valid customer email");
    expect(container.textContent).toContain("Package selected");
    expect(container.querySelector('[data-proposal-action="prepare-proposal"]')?.dataset.actionAvailability)
      .toBe("blocked");
  });

  test("shows stale and local evidence visibly", () => {
    render(model(quote(), { sourceFreshness: "stale" }));
    expect(container.querySelector('[data-proposal-state="stale"]')).not.toBeNull();
    expect(container.textContent).toContain("Needs refresh");

    render(model(quote(), { sourceMode: "local", role: "sales" }));
    expect(container.querySelector('[data-proposal-state="local_preview"]')).not.toBeNull();
    expect(container.textContent).toContain("Unsaved preview");
    expect(container.textContent).toContain("Recorded in QuotePilot; not independently confirmed");
    expect(container.textContent).not.toContain("Local preview only");
    expect(container.textContent).not.toContain("Local record only");
  });

  test("renders a visible contextual recovery when the model is absent", () => {
    render(null);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("Proposal details are unavailable");
    expect(alert.textContent).toContain("Refresh this opportunity");
  });
});
