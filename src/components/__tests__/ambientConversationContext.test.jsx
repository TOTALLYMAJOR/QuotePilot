// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildAmbientConversationObject } from "../../lib/ambientConversationObject";
import AmbientConversationContext from "../AmbientConversationContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function quote(overrides = {}) {
  return {
    id: "conversation-ui-proof",
    organizationId: "org-conversation-ui",
    quoteNumber: "Q-UI-2084",
    activeVersionId: "v0004",
    status: "viewed",
    createdAtISO: "2026-08-12T09:00:00.000Z",
    updatedAtISO: "2026-08-12T14:00:00.000Z",
    customer: { name: "Amara Fields" },
    event: { name: "Fields Anniversary Dinner" },
    lifecycle: {
      sentAtISO: "2026-08-12T12:00:00.000Z",
      viewedAtISO: "2026-08-12T12:10:00.000Z"
    },
    workflow: {
      quoteDelivery: {
        state: "provider_accepted",
        revisionId: "v0004@2026-08-12T11:55:00.000Z",
        providerMessageId: "resend_ui_2084",
        providerAcceptedAtISO: "2026-08-12T12:00:01.000Z"
      },
      followUp: {
        stage: "awaiting_response",
        dueDate: "2026-08-12",
        completed: false
      }
    },
    conversationSummary: {
      messageCount: 2,
      latestMessageId: "message_customer_ui",
      latestMessageAtISO: "2026-08-12T12:18:00.000Z",
      latestActorType: "customer"
    },
    portalDecision: {
      decision: "changes_requested",
      requestId: "request-ui-2084",
      submittedAtISO: "2026-08-12T12:20:00.000Z",
      message: "Please move dinner to 7 PM and show the vegetarian alternative."
    },
    ...overrides
  };
}

function model(input = quote(), options = {}) {
  return buildAmbientConversationObject(input, {
    sourceMode: "firebase",
    sourceFreshness: "fresh",
    role: "sales",
    todayISO: "2026-08-12",
    conversationAccess: { available: true, readOnly: false },
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
  act(() => root.render(<AmbientConversationContext model={value} />));
}

describe("AmbientConversationContext", () => {
  test("keeps every internal region in normal flow with no overlay layer declarations", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/components/ambientConversationContext.css"),
      "utf8"
    );
    expect(css).not.toMatch(/position\s*:\s*(?:fixed|absolute)/iu);
    expect(css).not.toMatch(/z-index\s*:/iu);
    expect(css).not.toMatch(/overflow\s*:\s*visible/iu);
  });

  test("renders a populated content-first context with five visibly separate evidence rails", () => {
    render(model());
    expect(container.querySelector('[data-ambient-intelligent-object="conversation"]')).not.toBeNull();
    expect(container.querySelector('[data-conversation-state="attention"]')).not.toBeNull();
    expect(container.textContent).toContain("Fields Anniversary Dinner");
    expect(container.textContent).toContain("Amara Fields, Q-UI-2084");
    expect(container.textContent).toContain("Recorded conversation activity");
    expect([...container.querySelectorAll("[data-conversation-evidence]")].map((node) => node.dataset.conversationEvidence))
      .toEqual(["sent", "provider-delivered", "portal-viewed", "replied", "inferred-engagement"]);
    expect(container.querySelector('[data-conversation-evidence="provider-delivered"]')?.dataset.conversationEvidenceState)
      .toBe("provider_accepted_only");
    expect(container.querySelector('[data-conversation-evidence="portal-viewed"]')?.dataset.conversationEvidenceState)
      .toBe("recorded_view");
    expect(container.querySelector('[data-conversation-evidence="replied"]')?.dataset.conversationEvidenceState)
      .toBe("latest_customer_reply");
    expect(container.querySelector('[data-conversation-evidence="inferred-engagement"]')?.dataset.conversationEvidenceState)
      .toBe("unsupported");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  test("shows exact change-request, follow-up, judgment, freshness, dependencies, and resolutions", () => {
    render(model());
    expect(container.querySelector('[data-conversation-work="change-request"]')?.dataset.conversationWorkState)
      .toBe("open");
    expect(container.querySelector('[data-conversation-work="follow-up"]')?.dataset.conversationWorkState)
      .toBe("due_today");
    expect(container.textContent).toContain("Please move dinner to 7 PM");
    expect(container.textContent).toContain("What you can do next");
    expect(container.textContent).toContain("Review latest customer reply");
    expect(container.textContent).toContain("Why this is shown");
    expect(container.textContent).not.toContain("Why QuotePilot shows this");
    expect(container.textContent).toContain("If you do nothing");
    expect(container.textContent).toContain("Confidence and source");
    expect(container.textContent).toContain("How current this is");
    expect(container.textContent).toContain("What this connects to");
    expect(container.querySelectorAll("[data-conversation-resolution]")).toHaveLength(4);
    expect(container.querySelector('[data-conversation-resolution="review-latest-customer-reply"]')?.dataset.resolutionAvailability)
      .toBe("available");
  });

  test("uses plain labels for unsaved and source-check states without changing their evidence states", () => {
    render(model(quote(), { sourceMode: "local" }));
    expect(container.querySelector('[data-conversation-state="local_preview"]')).not.toBeNull();
    expect(container.textContent).toContain("Unsaved preview");
    expect(container.textContent).toContain("Recorded in QuotePilot; not independently confirmed");
    expect(container.textContent).not.toContain("Local record only");

    const needsCheck = model(quote(), {
      providerDeliveryEvidence: {
        sourceId: "provider-ui-mismatch",
        sourceLabel: "Mismatched provider event",
        source: "verified_provider_webhook",
        signatureVerified: true,
        provider: "resend",
        state: "delivered",
        organizationId: "different-org",
        quoteId: "conversation-ui-proof",
        revisionId: "v0004",
        providerMessageId: "resend_ui_mismatch",
        occurredAtISO: "2026-08-12T12:00:03.000Z"
      }
    });
    render(needsCheck);
    expect(container.querySelector('[data-conversation-state="needs_reconciliation"]')).not.toBeNull();
    expect(container.textContent).toContain("Needs a source check");
  });

  test("renders verified provider delivery without promoting portal or reply evidence", () => {
    render(model(quote({
      lifecycle: { sentAtISO: "2026-08-12T12:00:00.000Z" },
      conversationSummary: {
        messageCount: 1,
        latestMessageId: "message_staff_ui",
        latestMessageAtISO: "2026-08-12T12:18:00.000Z",
        latestActorType: "staff"
      },
      portalDecision: {}
    }), {
      providerDeliveryEvidence: {
        sourceId: "provider-ui-delivered",
        sourceLabel: "Verified delivery webhook",
        source: "verified_provider_webhook",
        signatureVerified: true,
        provider: "resend",
        state: "delivered",
        organizationId: "org-conversation-ui",
        quoteId: "conversation-ui-proof",
        revisionId: "v0004@2026-08-12T11:55:00.000Z",
        providerMessageId: "resend_ui_2084",
        occurredAtISO: "2026-08-12T12:00:03.000Z"
      }
    }));
    expect(container.querySelector('[data-conversation-evidence="provider-delivered"]')?.dataset.conversationEvidenceState)
      .toBe("verified_delivered");
    expect(container.querySelector('[data-conversation-evidence="portal-viewed"]')?.dataset.conversationEvidenceState)
      .toBe("not_recorded");
    expect(container.querySelector('[data-conversation-evidence="replied"]')?.dataset.conversationEvidenceState)
      .toBe("latest_staff_message");
    expect(container.textContent).toContain("This provider rail never establishes portal viewing");
  });

  test("renders a contextual recovery instead of an empty surface", () => {
    render(null);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("Conversation details are unavailable");
    expect(alert.textContent).toContain("Refresh this opportunity");
  });
});
