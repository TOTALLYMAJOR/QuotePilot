// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQuoteById: vi.fn(),
  getQuoteHistory: vi.fn(),
  updateQuoteFollowUp: vi.fn(),
  getRevenueAutopilotOperations: vi.fn(),
  acknowledgeRevenueAutopilotReply: vi.fn(),
  getDecisionDebtSnapshot: vi.fn()
}));

vi.mock("../../lib/quoteStore", () => ({
  getQuoteById: mocks.getQuoteById,
  getQuoteHistory: mocks.getQuoteHistory,
  requestQuoteApproval: vi.fn(),
  resolveQuoteApprovalRequest: vi.fn(),
  updateQuoteChangeRequestHandling: vi.fn(),
  updateQuoteFollowUp: mocks.updateQuoteFollowUp
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

import {
  SalesWorkflowView,
  verifyFollowUpCompletionReadback
} from "../SalesWorkflowModal";

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

function followUpQuote({ completed = false, followUp = {} } = {}) {
  const completedAtISO = completed
    ? new Date(Date.now() - 60_000).toISOString()
    : "";
  const updatedAtISO = new Date(Date.now() - 30_000).toISOString();
  return {
    ...quote(),
    updatedAtISO,
    workflow: {
      ...quote().workflow,
      followUp: {
        stage: "proposal_sent",
        dueDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        note: "Confirm the final guest count.",
        completed,
        completedAtISO,
        updatedAtISO,
        updatedByEmail: "sales@example.test",
        ...followUp
      }
    }
  };
}

const FOLLOW_UP_TASK_STARTED_AT_ISO = "2026-09-03T02:30:00.000Z";

function followUpTaskJourney(
  phase = "in_progress",
  startedAtISO = FOLLOW_UP_TASK_STARTED_AT_ISO
) {
  return {
    organizationId: "org-one",
    startedAtISO,
    taskId: "review-now-priority:follow-up:quote-reply",
    phase,
    destination: "workflow",
    object: { id: "follow-up:quote-reply", type: "workflow-item" },
    focus: {
      quoteId: "quote-reply",
      attentionType: "follow_up",
      requestId: "follow-up:quote-reply"
    },
    intentId: "review_follow_up"
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
  mocks.getQuoteById.mockRejectedValue(new Error("No server readback configured."));
  mocks.updateQuoteFollowUp.mockRejectedValue(new Error("No follow-up write configured."));
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

  test("reports resolved only after the exact Ambient Workflow item is focused", async () => {
    const onArrivalResolution = vi.fn();
    const arrivalContext = {
      surfaceId: "workflow",
      focus: {
        quoteId: "quote-reply",
        attentionType: "unread_customer_reply",
        requestId: "attention-one"
      }
    };
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
          arrivalContext={arrivalContext}
          onArrivalResolution={onArrivalResolution}
          onOpenQuoteHistory={() => {}}
          onClose={() => {}}
        />
      );
    });
    await settle();

    const exactRow = container.querySelector('[data-attention-id="unread-reply:attention-one"]');
    expect(document.activeElement).toBe(exactRow);
    expect(onArrivalResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved",
      itemId: "unread-reply:attention-one",
      focus: arrivalContext.focus
    }));
  });

  test("does not substitute another Workflow item when an Ambient target is stale", async () => {
    const onArrivalResolution = vi.fn();
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
          focusRequestId="attention-stale"
          arrivalContext={{
            surfaceId: "workflow",
            focus: {
              quoteId: "quote-reply",
              attentionType: "unread_customer_reply",
              requestId: "attention-stale"
            }
          }}
          onArrivalResolution={onArrivalResolution}
          onOpenQuoteHistory={() => {}}
          onClose={() => {}}
        />
      );
    });
    await settle();

    expect(onArrivalResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "recovery",
      consequence: expect.stringMatching(/No similar or first-listed item was substituted/i)
    }));
    expect(onArrivalResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved"
    }));
    expect(document.activeElement).not.toBe(
      container.querySelector('[data-attention-id="unread-reply:attention-one"]')
    );
  });

  test("recovers when an approval stops being pending before exact arrival consumption", async () => {
    const resolvedQuote = {
      ...quote(),
      workflow: {
        ...quote().workflow,
        approvalRequests: [{
          id: "approval-resolved",
          state: "approved",
          requestedAtISO: "2026-08-09T15:10:00.000Z",
          resolvedAtISO: "2026-08-09T15:20:00.000Z"
        }]
      }
    };
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [resolvedQuote],
      truncated: false
    });
    const onArrivalResolution = vi.fn();
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
          focusAttentionType="approval"
          focusRequestId="approval-resolved"
          arrivalContext={{
            surfaceId: "workflow",
            focus: {
              quoteId: "quote-reply",
              attentionType: "approval",
              requestId: "approval-resolved"
            }
          }}
          onArrivalResolution={onArrivalResolution}
          onOpenQuoteHistory={() => {}}
          onClose={() => {}}
        />
      );
    });
    await settle();

    expect(onArrivalResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "recovery",
      reason: expect.stringMatching(/now approved/i),
      consequence: expect.stringMatching(/No approval was focused as pending/i)
    }));
    expect(onArrivalResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved"
    }));
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
    expect(warning.textContent).toContain("Follow-up automation tab");
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

  test("confirms the exact follow-up only after a matching server-only readback", async () => {
    const pendingReadback = deferred();
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    const completedFollowUp = completedQuote.workflow.followUp;
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockResolvedValue({
      ok: true,
      storage: "firebase",
      followUp: completedFollowUp
    });
    mocks.getQuoteById.mockReturnValue(pendingReadback.promise);
    const onTaskOutcome = vi.fn(() => ({ status: "resolved" }));
    const onAttentionSummaryChange = vi.fn();
    const journey = followUpTaskJourney();

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
          focusAttentionType="follow_up"
          focusRequestId="follow-up:quote-reply"
          arrivalContext={{ surfaceId: "workflow", focus: journey.focus }}
          activeTaskJourney={journey}
          onTaskOutcome={onTaskOutcome}
          onAttentionSummaryChange={onAttentionSummaryChange}
          onOpenQuoteHistory={() => {}}
          onClose={() => {}}
        />
      );
    });
    await settle();

    act(() => container.querySelector("#workflow-tab-followups").click());
    const completeToggle = container.querySelector(".workflow-complete-toggle input");
    act(() => completeToggle.click());
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    await act(async () => {
      save.click();
      await Promise.resolve();
    });

    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(mocks.getQuoteById).toHaveBeenCalledWith("quote-reply", { serverOnly: true });
    expect(onTaskOutcome).not.toHaveBeenCalled();
    expect(container.querySelector('[data-follow-up-confirmation-state="pending"]')).toBeTruthy();

    await act(async () => {
      pendingReadback.resolve(completedQuote);
      await pendingReadback.promise;
    });
    await settle();

    expect(onTaskOutcome).toHaveBeenCalledTimes(1);
    expect(onTaskOutcome).toHaveBeenCalledWith({
      organizationId: "org-one",
      phase: "resolved",
      startedAtISO: journey.startedAtISO,
      taskId: journey.taskId,
      focus: journey.focus,
      proof: {
        verifierId: "quote-follow-up-server-readback",
        proofId: `follow-up-completed:${completedFollowUp.completedAtISO}`,
        proofType: "follow-up-completion-confirmation"
      }
    });
    expect(container.querySelector('[data-follow-up-confirmation-state="confirmed"]')).toBeTruthy();
    expect(container.textContent).toContain("Completion confirmed from the exact same-workspace server record");
    expect(onAttentionSummaryChange.mock.calls.at(-1)?.[0]?.counts?.followUps).toBe(0);
    const outcomePayload = JSON.stringify(onTaskOutcome.mock.calls[0][0]);
    expect(outcomePayload).not.toContain(completedFollowUp.note);
    expect(outcomePayload).not.toContain(completedFollowUp.updatedByEmail);
  });

  test("retains the exact Firebase write expectation across a mismatched readback retry", async () => {
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    const completedFollowUp = completedQuote.workflow.followUp;
    const mismatchedQuote = {
      ...completedQuote,
      workflow: {
        ...completedQuote.workflow,
        followUp: {
          ...completedFollowUp,
          note: "A different completion reached the server."
        }
      }
    };
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockResolvedValue({
      ok: true,
      storage: "firebase",
      followUp: completedFollowUp
    });
    mocks.getQuoteById
      .mockResolvedValueOnce(mismatchedQuote)
      .mockResolvedValueOnce(completedQuote);
    const onTaskOutcome = vi.fn((outcome) => ({ status: outcome.phase }));
    const renderJourney = async (journey) => {
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
            focusAttentionType="follow_up"
            focusRequestId="follow-up:quote-reply"
            arrivalContext={{ surfaceId: "workflow", focus: journey.focus }}
            activeTaskJourney={journey}
            onTaskOutcome={onTaskOutcome}
            onOpenQuoteHistory={() => {}}
            onClose={() => {}}
          />
        );
      });
      await settle();
    };
    const journey = followUpTaskJourney();
    await renderJourney(journey);

    act(() => container.querySelector("#workflow-tab-followups").click());
    act(() => container.querySelector(".workflow-complete-toggle input").click());
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    await settle();

    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(mocks.getQuoteById).toHaveBeenCalledTimes(1);
    expect(onTaskOutcome).toHaveBeenCalledTimes(1);
    expect(onTaskOutcome).toHaveBeenLastCalledWith({
      organizationId: "org-one",
      phase: "uncertain",
      startedAtISO: journey.startedAtISO,
      taskId: journey.taskId,
      focus: journey.focus,
      proof: null
    });
    expect(container.querySelector('[data-follow-up-confirmation-state="uncertain"]')).toBeTruthy();
    expect(container.querySelector('[data-follow-up-confirmation-state="confirmed"]')).toBeNull();

    await renderJourney(followUpTaskJourney("uncertain"));
    const retry = Array.from(
      container.querySelectorAll('[data-follow-up-confirmation-state="uncertain"] button')
    ).find((button) => button.textContent === "Retry confirmation");
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });
    await settle();

    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(mocks.getQuoteById).toHaveBeenCalledTimes(2);
    expect(mocks.getQuoteById).toHaveBeenNthCalledWith(1, "quote-reply", { serverOnly: true });
    expect(mocks.getQuoteById).toHaveBeenNthCalledWith(2, "quote-reply", { serverOnly: true });
    expect(onTaskOutcome).toHaveBeenCalledTimes(2);
    expect(onTaskOutcome).toHaveBeenLastCalledWith({
      organizationId: "org-one",
      phase: "resolved",
      startedAtISO: journey.startedAtISO,
      taskId: journey.taskId,
      focus: journey.focus,
      proof: {
        verifierId: "quote-follow-up-server-readback",
        proofId: `follow-up-completed:${completedFollowUp.completedAtISO}`,
        proofType: "follow-up-completion-confirmation"
      }
    });
    expect(container.querySelector('[data-follow-up-confirmation-state="confirmed"]')).toBeTruthy();
  });

  test("drops a pending readback when the same task identity restarts with a new generation", async () => {
    const pendingReadback = deferred();
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockResolvedValue({
      ok: true,
      storage: "firebase",
      followUp: completedQuote.workflow.followUp
    });
    mocks.getQuoteById.mockReturnValue(pendingReadback.promise);
    const onTaskOutcome = vi.fn((outcome) => ({ status: outcome.phase }));
    const renderJourney = async (journey) => {
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
            focusAttentionType="follow_up"
            focusRequestId="follow-up:quote-reply"
            arrivalContext={{ surfaceId: "workflow", focus: journey.focus }}
            activeTaskJourney={journey}
            onTaskOutcome={onTaskOutcome}
            onOpenQuoteHistory={() => {}}
            onClose={() => {}}
          />
        );
      });
      await settle();
    };
    const firstJourney = followUpTaskJourney();
    const restartedJourney = followUpTaskJourney(
      "in_progress",
      "2026-09-03T02:31:00.000Z"
    );
    await renderJourney(firstJourney);

    act(() => container.querySelector("#workflow-tab-followups").click());
    act(() => container.querySelector(".workflow-complete-toggle input").click());
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-follow-up-confirmation-state="pending"]')).toBeTruthy();

    await renderJourney(restartedJourney);
    expect(container.querySelector('[data-follow-up-confirmation-state="pending"]')).toBeNull();
    expect(container.querySelector('[data-follow-up-confirmation-state="confirmed"]')).toBeNull();

    await act(async () => {
      pendingReadback.resolve(completedQuote);
      await pendingReadback.promise;
    });
    await settle();

    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(mocks.getQuoteById).toHaveBeenCalledTimes(1);
    expect(onTaskOutcome).not.toHaveBeenCalled();
    expect(container.querySelector('[data-follow-up-confirmation-state="confirmed"]')).toBeNull();
  });

  test("keeps a connected completion uncertain after remount loses its exact write expectation", async () => {
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    const mismatchedQuote = {
      ...completedQuote,
      workflow: {
        ...completedQuote.workflow,
        followUp: {
          ...completedQuote.workflow.followUp,
          note: "A different completion reached the server."
        }
      }
    };
    mocks.getQuoteHistory
      .mockResolvedValueOnce({
        source: "firebase",
        quotes: [initialQuote],
        truncated: false
      })
      .mockResolvedValueOnce({
        source: "firebase",
        quotes: [completedQuote],
        truncated: false
      });
    mocks.updateQuoteFollowUp.mockResolvedValue({
      ok: true,
      storage: "firebase",
      followUp: completedQuote.workflow.followUp
    });
    mocks.getQuoteById
      .mockResolvedValueOnce(mismatchedQuote)
      .mockResolvedValueOnce(completedQuote);
    const onTaskOutcome = vi.fn((outcome) => ({ status: outcome.phase }));
    const journey = followUpTaskJourney();
    const renderJourney = async (taskJourney) => {
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
            focusAttentionType="follow_up"
            focusRequestId="follow-up:quote-reply"
            arrivalContext={{ surfaceId: "workflow", focus: taskJourney.focus }}
            activeTaskJourney={taskJourney}
            onTaskOutcome={onTaskOutcome}
            onOpenQuoteHistory={() => {}}
            onClose={() => {}}
          />
        );
      });
      await settle();
    };

    await renderJourney(journey);
    act(() => container.querySelector("#workflow-tab-followups").click());
    act(() => container.querySelector(".workflow-complete-toggle input").click());
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    await settle();

    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(mocks.getQuoteById).toHaveBeenCalledTimes(1);
    expect(onTaskOutcome).toHaveBeenLastCalledWith({
      organizationId: "org-one",
      phase: "uncertain",
      startedAtISO: journey.startedAtISO,
      taskId: journey.taskId,
      focus: journey.focus,
      proof: null
    });

    act(() => root.unmount());
    root = createRoot(container);
    await renderJourney(followUpTaskJourney("uncertain", journey.startedAtISO));

    const recovery = container.querySelector('[data-follow-up-confirmation-state="uncertain"]');
    const retry = Array.from(recovery.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry confirmation"
    );
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });
    await settle();

    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(mocks.getQuoteById).toHaveBeenCalledTimes(2);
    expect(mocks.getQuoteById).toHaveBeenNthCalledWith(2, "quote-reply", { serverOnly: true });
    expect(onTaskOutcome).toHaveBeenCalledTimes(2);
    expect(onTaskOutcome).not.toHaveBeenCalledWith(expect.objectContaining({ phase: "resolved" }));
    const retryRecovery = container.querySelector('[data-follow-up-confirmation-state="uncertain"]');
    expect(retryRecovery.textContent).toContain(
      "The exact prior connected-write details are no longer available, so this server read alone cannot close the task."
    );
    expect(retryRecovery.textContent).not.toContain("saved only in this browser");
    expect(retryRecovery.textContent).not.toContain("browser-local");
    expect(container.querySelector('[data-follow-up-confirmation-state="confirmed"]')).toBeNull();
  });

  test("keeps browser-local completion uncertain when read-only retry finds a completed server record", async () => {
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    mocks.getQuoteHistory.mockResolvedValue({
      source: "local",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockResolvedValue({
      ok: true,
      storage: "local",
      followUp: completedQuote.workflow.followUp
    });
    mocks.getQuoteById.mockResolvedValue(completedQuote);
    const onTaskOutcome = vi.fn(() => ({ status: "uncertain" }));
    const journey = followUpTaskJourney();

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
          focusAttentionType="follow_up"
          focusRequestId="follow-up:quote-reply"
          arrivalContext={{ surfaceId: "workflow", focus: journey.focus }}
          activeTaskJourney={journey}
          onTaskOutcome={onTaskOutcome}
          onOpenQuoteHistory={() => {}}
          onClose={() => {}}
        />
      );
    });
    await settle();

    act(() => container.querySelector("#workflow-tab-followups").click());
    act(() => container.querySelector(".workflow-complete-toggle input").click());
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    await settle();

    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(mocks.getQuoteById).not.toHaveBeenCalled();
    expect(onTaskOutcome).toHaveBeenCalledWith({
      organizationId: "org-one",
      phase: "uncertain",
      startedAtISO: journey.startedAtISO,
      taskId: journey.taskId,
      focus: journey.focus,
      proof: null
    });
    const recovery = container.querySelector('[data-follow-up-confirmation-state="uncertain"]');
    expect(recovery).toBeTruthy();
    expect(recovery.textContent).toContain("saved in browser-local data");
    expect(recovery.textContent).toContain("The task remains open");
    expect(container.querySelector('[data-follow-up-confirmation-state="confirmed"]')).toBeNull();

    const retry = Array.from(recovery.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry confirmation"
    );
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });
    await settle();

    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(mocks.getQuoteById).toHaveBeenCalledTimes(1);
    expect(onTaskOutcome).toHaveBeenCalledTimes(2);
    expect(onTaskOutcome).not.toHaveBeenCalledWith(expect.objectContaining({ phase: "resolved" }));
    expect(container.querySelector('[data-follow-up-confirmation-state="uncertain"]')?.textContent)
      .toContain("The exact prior connected-write details are no longer available, so this server read alone cannot close the task.");
  });

  test("rejects foreign, stale, open, and invalid completion readbacks", () => {
    const completedQuote = followUpQuote({ completed: true });
    const expectedFollowUp = completedQuote.workflow.followUp;
    const nowISO = new Date().toISOString();
    const verify = (overrides = {}) => verifyFollowUpCompletionReadback({
      organizationId: "org-one",
      quoteId: "quote-reply",
      quote: completedQuote,
      expectedFollowUp,
      nowISO,
      timeZone: "America/Chicago",
      ...overrides
    });

    expect(verify()).toEqual({
      ok: true,
      proof: {
        verifierId: "quote-follow-up-server-readback",
        proofId: `follow-up-completed:${expectedFollowUp.completedAtISO}`,
        proofType: "follow-up-completion-confirmation"
      }
    });
    expect(verify({ quote: { ...completedQuote, organizationId: "org-foreign" } })).toEqual({
      ok: false,
      code: "scope_mismatch"
    });
    expect(verify({ quote: followUpQuote() })).toEqual({
      ok: false,
      code: "completion_missing"
    });
    expect(verify({ expectedFollowUp: null })).toEqual({
      ok: false,
      code: "firebase_write_expectation_missing"
    });
    expect(verify({
      quote: followUpQuote({
        completed: true,
        followUp: { updatedAtISO: new Date(Date.now() - 10_000).toISOString() }
      })
    })).toEqual({
      ok: false,
      code: "write_readback_mismatch"
    });
    const futureQuote = followUpQuote({
      completed: true,
      followUp: { completedAtISO: new Date(Date.now() + 86_400_000).toISOString() }
    });
    expect(verify({ quote: futureQuote, expectedFollowUp: futureQuote.workflow.followUp })).toEqual({
      ok: false,
      code: "invalid_completion_evidence"
    });
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
