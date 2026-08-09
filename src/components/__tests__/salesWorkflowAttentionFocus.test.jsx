// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQuoteHistory: vi.fn(),
  getRevenueAutopilotOperations: vi.fn(),
  acknowledgeRevenueAutopilotReply: vi.fn(),
  getDecisionDebtSnapshot: vi.fn()
}));

vi.mock("../../lib/quoteStore", () => ({
  getQuoteHistory: mocks.getQuoteHistory,
  requestQuoteApproval: vi.fn(),
  resolveQuoteApprovalRequest: vi.fn(),
  updateQuoteChangeRequestHandling: vi.fn(),
  updateQuoteFollowUp: vi.fn()
}));

vi.mock("../../lib/revenueAutopilotClient", async () => {
  const actual = await vi.importActual("../../lib/revenueAutopilotClient");
  return {
    ...actual,
    getRevenueAutopilotOperations: mocks.getRevenueAutopilotOperations,
    acknowledgeRevenueAutopilotReply: mocks.acknowledgeRevenueAutopilotReply
  };
});

vi.mock("../../lib/decisionDebtClient", async () => {
  const actual = await vi.importActual("../../lib/decisionDebtClient");
  return {
    ...actual,
    getDecisionDebtSnapshot: mocks.getDecisionDebtSnapshot
  };
});

import { SalesWorkflowView } from "../SalesWorkflowModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function quote() {
  return {
    id: "quote-reply",
    organizationId: "org-one",
    customerId: "customer-henderson",
    quoteNumber: "QP-2088",
    status: "sent",
    activeVersionId: "version-one",
    portalIssuedAtISO: "2026-08-09T15:00:00.000Z",
    lifecycle: { sentAtISO: "2026-08-09T15:00:00.000Z" },
    workflow: {
      quoteDelivery: {
        state: "provider_accepted",
        revisionId: "version-one",
        portalIssuedAtISO: "2026-08-09T15:00:00.000Z"
      }
    },
    customer: { name: "Henderson Industries", email: "ops@example.test" },
    event: { date: "2026-09-01" },
    payment: { depositStatus: "unpaid" },
    totals: { total: 5000, deposit: 1250 },
    conversationSummary: { messageCount: 1 }
  };
}

function operations() {
  return {
    organizationId: "org-one",
    policy: { version: "policy-one", enabled: false, kinds: {} },
    jobs: [],
    attention: [{
      attentionId: "attention-one",
      quoteId: "quote-reply",
      customerId: "customer-henderson",
      messageId: "message-one",
      kind: "unread_customer_reply",
      state: "open",
      quoteLabel: "QP-2088",
      customerLabel: "Henderson Industries",
      receivedAtISO: "2026-08-09T15:30:00.000Z",
      openedAtISO: "2026-08-09T15:30:00.000Z"
    }],
    bounds: {
      totalJobs: 0,
      maximumJobs: 100,
      totalAttention: 1,
      maximumAttention: 50,
      complete: true,
      truncated: false
    },
    providerOutcomes: {},
    source: "firebase_server_projection",
    observedAtISO: "2026-08-09T16:00:00.000Z",
    readState: "success"
  };
}

function emptyDebt() {
  return {
    policyVersion: "policy-one",
    snapshot: {
      schemaVersion: "decision-debt-snapshot-v1",
      formulaVersion: "decision-debt-score-v1",
      authority: "server_derived",
      predictive: false,
      observedAtISO: "2026-08-09T16:00:00.000Z",
      graph: { graphId: "commercial", graphVersion: "v1" },
      policy: { schemaVersion: 1, maxEventHorizonDays: 365, decisionTypes: {} },
      bounds: { returnedCount: 0, eligibleCount: 0, truncated: false },
      items: []
    }
  };
}

function previousTenantCalendarYear(timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const targetYear = Number(values.year) - 1;
  const month = Number(values.month);
  const day = Number(values.day);
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

let container;
let root;
let originalScrollIntoView;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  mocks.getQuoteHistory.mockResolvedValue({
    source: "firebase",
    quotes: [quote()],
    truncated: false
  });
  mocks.getRevenueAutopilotOperations.mockResolvedValue(operations());
  mocks.getDecisionDebtSnapshot.mockResolvedValue(emptyDebt());
  mocks.acknowledgeRevenueAutopilotReply.mockResolvedValue({
    receipt: { requestId: "ra-request-one", operation: "acknowledge_reply" }
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 30));
  });
}

describe("Sales Workflow central Attention focus", () => {
  test("focuses the exact unread reply in primary Attention and keeps conversation and acknowledgement actions distinct", async () => {
    const onOpenQuoteHistory = vi.fn();
    await act(async () => {
      root.render(
        <SalesWorkflowView
          open
          presentation="embedded"
          organizationId="org-one"
          currentUserRole="sales"
          currentUserEmail="sales@example.test"
          tenantTimeZone="America/Chicago"
          focusQuoteId="quote-reply"
          focusAttentionType="unread_customer_reply"
          focusRequestId="attention-one"
          onOpenQuoteHistory={onOpenQuoteHistory}
          onClose={() => {}}
        />
      );
    });
    await settle();

    expect(container.querySelector("#workflow-tab-attention")?.getAttribute("aria-selected")).toBe("true");
    const row = container.querySelector('[data-attention-id="unread-reply:attention-one"]');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain("Unread customer reply");
    expect(row.textContent).toContain("Message content remains quote-scoped");
    expect(row.scrollIntoView).toHaveBeenCalled();

    act(() => container.querySelector('[data-capability-action="open-central-unread-reply"]').click());
    expect(onOpenQuoteHistory).toHaveBeenCalledWith({
      quoteId: "quote-reply",
      action: "conversation"
    });

    await act(async () => {
      container.querySelector('[data-capability-action="acknowledge-central-unread-reply"]').click();
      await Promise.resolve();
    });
    expect(mocks.acknowledgeRevenueAutopilotReply).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-reply",
      attentionId: "attention-one",
      messageId: "message-one"
    });
  });

  test("labels the primary customer-reply queue incomplete when attention exceeds its read bound", async () => {
    mocks.getRevenueAutopilotOperations.mockResolvedValue({
      ...operations(),
      bounds: {
        ...operations().bounds,
        totalAttention: 2,
        complete: false,
        truncated: true
      }
    });

    await act(async () => {
      root.render(
        <SalesWorkflowView
          open
          presentation="embedded"
          organizationId="org-one"
          currentUserRole="sales"
          currentUserEmail="sales@example.test"
          tenantTimeZone="America/Chicago"
          onOpenQuoteHistory={() => {}}
          onClose={() => {}}
        />
      );
    });
    await settle();

    const warning = container.querySelector('[data-unread-attention-bound="truncated"]');
    expect(warning).toBeTruthy();
    expect(warning.textContent).toContain("This queue is incomplete");
    expect(warning.textContent).toContain("Revenue autopilot tab");
  });

  test("selects and focuses the exact Decision Debt item instead of searching primary Attention", async () => {
    mocks.getDecisionDebtSnapshot.mockResolvedValue({
      policyVersion: "policy-one",
      snapshot: {
        ...emptyDebt().snapshot,
        bounds: { returnedCount: 1, eligibleCount: 1, truncated: false },
        items: [{
          id: "debt-guest-count",
          quoteId: "quote-reply",
          decisionType: "guest_count",
          label: "Final guest count",
          urgency: "high",
          eventDate: "2026-09-01",
          lockDate: "2026-08-25",
          daysUntilLock: 16,
          score: 72,
          rawScore: 72,
          commercialExposureCents: 110000,
          affectedNodeIds: ["artifact.kitchen_beo"],
          factors: {},
          explanation: [],
          sourceRevisionId: "version-one"
        }]
      }
    });
    await act(async () => {
      root.render(
        <SalesWorkflowView
          open
          presentation="embedded"
          organizationId="org-one"
          currentUserRole="sales"
          currentUserEmail="sales@example.test"
          tenantTimeZone="America/Chicago"
          focusQuoteId="quote-reply"
          focusAttentionType="decision_debt"
          focusRequestId="debt-guest-count"
          onOpenQuoteHistory={() => {}}
          onClose={() => {}}
        />
      );
    });
    await settle();

    expect(container.querySelector("#workflow-tab-debt")?.getAttribute("aria-selected")).toBe("true");
    const row = container.querySelector('[data-decision-debt-id="debt-guest-count"]');
    expect(row).toBeTruthy();
    expect(row.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(row);
  });

  test("surfaces a bounded repeat-event cue and opens Customer 360 for exact-version verification", async () => {
    const sourceQuote = {
      ...quote(),
      id: "quote-anniversary",
      quoteNumber: "QP-PICNIC",
      status: "booked",
      customerId: "customer-henderson",
      event: {
        name: "Henderson corporate picnic",
        date: previousTenantCalendarYear()
      }
    };
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [sourceQuote],
      truncated: true
    });
    mocks.getRevenueAutopilotOperations.mockResolvedValue({
      ...operations(),
      attention: [],
      bounds: { ...operations().bounds, totalAttention: 0 }
    });
    const onOpenCustomer = vi.fn();

    await act(async () => {
      root.render(
        <SalesWorkflowView
          open
          presentation="embedded"
          organizationId="org-one"
          currentUserRole="sales"
          currentUserEmail="sales@example.test"
          tenantTimeZone="America/Chicago"
          focusQuoteId="quote-anniversary"
          focusAttentionType="anniversary_rebooking"
          focusRequestId={`anniversary-rebooking:quote-anniversary:${sourceQuote.event.date}`}
          onOpenCustomer={onOpenCustomer}
          onOpenQuoteHistory={() => {}}
          onClose={() => {}}
        />
      );
    });
    await settle();

    const cue = container.querySelector('[data-capability-id="cwf-11-central-anniversary-attention"]');
    expect(cue).toBeTruthy();
    expect(cue.getAttribute("data-capability-state")).toBe("verification_required");
    expect(cue.textContent).toContain("Henderson corporate picnic was recorded as booked for this week last year");
    const review = container.querySelector('[data-capability-action="open-exact-version-rebook-review"]');
    expect(review.disabled).toBe(false);
    act(() => review.click());
    expect(onOpenCustomer).toHaveBeenCalledWith("customer-henderson");
  });
});
