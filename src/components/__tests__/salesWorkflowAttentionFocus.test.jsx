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
  buildFollowUpCompletionChangedFacts,
  isCanonicalWorkflowDateOnly,
  SalesWorkflowView,
  verifyFollowUpCompletionReadback
} from "../SalesWorkflowModal";
import {
  useWorkspaceActionFeedback,
  WorkspaceActionFeedbackProvider
} from "../../context/WorkspaceActionFeedbackContext";

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

test("claims task completion only when App reports persisted task closure", () => {
  expect(buildFollowUpCompletionChangedFacts({
    status: "resolved",
    taskState: "persisted"
  })).toEqual(["Internal follow-up marked complete", "Current task marked completed"]);
  expect(buildFollowUpCompletionChangedFacts({
    status: "resolved",
    taskState: "independent"
  })).toEqual(["Internal follow-up marked complete"]);
  expect(buildFollowUpCompletionChangedFacts({ status: "resolved" })).toEqual([
    "Internal follow-up marked complete"
  ]);
});

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

function WorkspaceActionFeedbackProbe() {
  const { currentFeedback, announcement } = useWorkspaceActionFeedback();
  return (
    <output
      data-testid="workspace-action-feedback-probe"
      data-feedback-phase={currentFeedback?.phase || ""}
      data-feedback-announcement-id={announcement?.id || ""}
    >
      {JSON.stringify({ currentFeedback, announcement })}
    </output>
  );
}

function FeedbackHarness({ children, idFactory = () => "attempt-follow-up-one", scope }) {
  return (
    <WorkspaceActionFeedbackProvider
      scope={scope || { organizationId: "org-one", principalId: "sales-one", role: "sales" }}
      clock={() => "2026-09-03T05:50:00.000Z"}
      idFactory={idFactory}
    >
      <WorkspaceActionFeedbackProbe />
      {children}
    </WorkspaceActionFeedbackProvider>
  );
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

  test("returns an uncertain completed follow-up to its exact record without substituting Attention", async () => {
    const completedQuote = followUpQuote({ completed: true });
    const journey = followUpTaskJourney("uncertain");
    const onArrivalResolution = vi.fn();
    mocks.getQuoteHistory.mockResolvedValue({
      source: "local",
      quotes: [completedQuote],
      truncated: false
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
          focusAttentionType="follow_up"
          focusRequestId="follow-up:quote-reply"
          arrivalContext={{ surfaceId: "workflow", focus: journey.focus }}
          activeTaskJourney={journey}
          onArrivalResolution={onArrivalResolution}
          onOpenQuoteHistory={() => {}}
          onClose={() => {}}
        />
      );
    });
    await settle();

    const exactRecord = container.querySelector(
      '[data-follow-up-record-id="follow-up:quote-reply"]'
    );
    expect(exactRecord).toBeTruthy();
    expect(document.activeElement).toBe(exactRecord);
    expect(container.querySelector("#workflow-tab-followups")?.getAttribute("aria-selected"))
      .toBe("true");
    expect(container.querySelector('[data-attention-id="follow-up:quote-reply"]')).toBeNull();
    expect(onArrivalResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved",
      itemId: "follow-up:quote-reply",
      focus: journey.focus
    }));
    expect(onArrivalResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "recovery"
    }));
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
    const onTaskOutcome = vi.fn(() => ({ status: "resolved", taskState: "persisted" }));
    const onAttentionSummaryChange = vi.fn();
    const journey = followUpTaskJourney();

    await act(async () => {
      root.render(
        <FeedbackHarness>
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
        </FeedbackHarness>
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

  test("publishes one shared pending-to-succeeded contract only after App accepts exact task closure", async () => {
    const pendingReadback = deferred();
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    const completedFollowUp = completedQuote.workflow.followUp;
    const onTaskOutcome = vi.fn(() => ({ status: "resolved", taskState: "persisted" }));
    const onToast = vi.fn();
    const journey = followUpTaskJourney();
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

    await act(async () => {
      root.render(
        <FeedbackHarness>
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
            onToast={onToast}
          />
        </FeedbackHarness>
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

    const pendingProbe = container.querySelector('[data-testid="workspace-action-feedback-probe"]');
    const pendingFeedback = JSON.parse(pendingProbe.textContent);
    expect(pendingProbe.getAttribute("data-feedback-phase")).toBe("pending");
    expect(pendingFeedback.currentFeedback).toMatchObject({
      phase: "pending",
      actionId: "complete-follow-up",
      attemptId: "attempt-follow-up-one",
      object: {
        kind: "workflow-item",
        id: "follow-up:quote-reply",
        label: "QP-2088 follow-up"
      }
    });
    const localPending = container.querySelector('[data-follow-up-confirmation-state="pending"]');
    expect(localPending?.getAttribute("role")).toBeNull();
    expect(localPending?.getAttribute("aria-live")).toBeNull();
    expect(onTaskOutcome).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();

    await act(async () => {
      pendingReadback.resolve(completedQuote);
      await pendingReadback.promise;
    });
    await settle();

    const succeededProbe = container.querySelector('[data-testid="workspace-action-feedback-probe"]');
    const succeededFeedback = JSON.parse(succeededProbe.textContent);
    expect(succeededProbe.getAttribute("data-feedback-phase")).toBe("succeeded");
    expect(succeededFeedback.currentFeedback).toMatchObject({
      phase: "succeeded",
      changed: ["Internal follow-up marked complete", "Current task marked completed"],
      evidence: {
        kind: "authoritative_readback",
        id: `follow-up-completed:${completedFollowUp.completedAtISO}`,
        source: "quote.workflow.followUp"
      },
      nextAction: null
    });
    expect(succeededFeedback.announcement.text).toContain(
      "Complete follow-up succeeded for QP-2088 follow-up."
    );
    expect(onTaskOutcome).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-follow-up-confirmation-state="confirmed"]')).toBeTruthy();
    expect(onToast).not.toHaveBeenCalled();
  });

  test("does not render confirmed when App rejects closure of the exact current task", async () => {
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    const onTaskOutcome = vi.fn(() => ({ status: "recovery" }));
    const journey = followUpTaskJourney();
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
    mocks.getQuoteById.mockResolvedValue(completedQuote);

    await act(async () => {
      root.render(
        <FeedbackHarness>
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
        </FeedbackHarness>
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

    const probe = container.querySelector('[data-testid="workspace-action-feedback-probe"]');
    const feedback = JSON.parse(probe.textContent).currentFeedback;
    expect(feedback).toMatchObject({
      phase: "recovery",
      changed: ["Internal follow-up marked complete"],
      nextAction: { id: "reconcile", label: "Review exact follow-up" }
    });
    expect(feedback.unchanged).toContain("Current task tracking remains open");
    expect(container.querySelector('[data-follow-up-confirmation-state="confirmed"]')).toBeNull();
    expect(container.querySelector('[data-follow-up-confirmation-state="uncertain"]')).toBeTruthy();
    expect(container.textContent).toContain(
      "this device could not close the attached task"
    );
  });

  test("treats a rejected tracked write as uncertain, preserves the draft, and blocks duplicate submission", async () => {
    const initialQuote = followUpQuote();
    const onTaskOutcome = vi.fn(() => ({ status: "uncertain" }));
    const journey = followUpTaskJourney();
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockRejectedValue(new Error("Connection closed after dispatch."));

    await act(async () => {
      root.render(
        <FeedbackHarness>
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
        </FeedbackHarness>
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

    const probe = container.querySelector('[data-testid="workspace-action-feedback-probe"]');
    const serializedFeedback = probe.textContent;
    const feedback = JSON.parse(serializedFeedback).currentFeedback;
    expect(feedback).toMatchObject({
      phase: "uncertain",
      changed: ["Follow-up completion remains unconfirmed"],
      nextAction: { id: "reconcile", label: "Review exact follow-up" }
    });
    expect(feedback.unchanged).toContain("Current task remains open");
    expect(onTaskOutcome).toHaveBeenCalledWith(expect.objectContaining({
      phase: "uncertain",
      proof: null
    }));
    expect(mocks.getQuoteById).not.toHaveBeenCalled();
    expect(container.querySelector(".workflow-note-field textarea").value)
      .toBe(initialQuote.workflow.followUp.note);
    expect(save.disabled).toBe(true);
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-follow-up-confirmation-state="confirmed"]')).toBeNull();
    expect(serializedFeedback).not.toContain(initialQuote.workflow.followUp.note);
    expect(serializedFeedback).not.toContain(initialQuote.customer.email);
    expect(serializedFeedback).not.toContain("Connection closed after dispatch.");
    expect(serializedFeedback).not.toMatch(/(?:bearer|token|secret|api[_-]?key)/iu);
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
          <FeedbackHarness>
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
          </FeedbackHarness>
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
          <FeedbackHarness>
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
          </FeedbackHarness>
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

  test("keeps a deferred write bound to its immutable feedback attempt across task restart", async () => {
    const pendingWrite = deferred();
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockReturnValue(pendingWrite.promise);
    mocks.getQuoteById.mockResolvedValue(completedQuote);
    const onTaskOutcome = vi.fn((outcome) => ({ status: outcome.phase }));
    const renderJourney = async (journey) => {
      await act(async () => {
        root.render(
          <FeedbackHarness>
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
          </FeedbackHarness>
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
    const firstSave = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    await act(async () => {
      firstSave.click();
      await Promise.resolve();
    });

    const pendingFeedback = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    ).currentFeedback;
    expect(pendingFeedback).toMatchObject({
      phase: "pending",
      generation: `${firstJourney.taskId}:${firstJourney.startedAtISO}`
    });

    await renderJourney(restartedJourney);
    act(() => container.querySelector("#workflow-tab-followups").click());
    const blockedSave = Array.from(container.querySelectorAll("button")).find(
      (button) => ["Save Follow-up", "Saving..."].includes(button.textContent)
    );
    expect(blockedSave.disabled).toBe(true);
    act(() => blockedSave.click());
    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingWrite.resolve({
        ok: true,
        storage: "firebase",
        followUp: completedQuote.workflow.followUp
      });
      await pendingWrite.promise;
    });
    await settle();

    const settledFeedback = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    ).currentFeedback;
    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(mocks.getQuoteById).toHaveBeenCalledTimes(1);
    expect(onTaskOutcome).not.toHaveBeenCalled();
    expect(settledFeedback).toMatchObject({
      phase: "recovery",
      attemptId: pendingFeedback.attemptId,
      generation: pendingFeedback.generation,
      changed: ["Internal follow-up marked complete"]
    });
    expect(settledFeedback.generation).not.toBe(
      `${restartedJourney.taskId}:${restartedJourney.startedAtISO}`
    );
  });

  test("does not continue a deferred write after unmount or leak it into a new scope", async () => {
    const pendingWrite = deferred();
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    const onTaskOutcome = vi.fn();
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockReturnValue(pendingWrite.promise);
    mocks.getQuoteById.mockResolvedValue(completedQuote);

    await act(async () => {
      root.render(
        <FeedbackHarness>
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
            arrivalContext={{ surfaceId: "workflow", focus: followUpTaskJourney().focus }}
            activeTaskJourney={followUpTaskJourney()}
            onTaskOutcome={onTaskOutcome}
            onOpenQuoteHistory={() => {}}
            onClose={() => {}}
          />
        </FeedbackHarness>
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
    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      pendingWrite.resolve({
        ok: true,
        storage: "firebase",
        followUp: completedQuote.workflow.followUp
      });
      await pendingWrite.promise;
    });
    await settle();

    expect(mocks.getQuoteById).not.toHaveBeenCalled();
    expect(onTaskOutcome).not.toHaveBeenCalled();
    await act(async () => {
      root.render(
        <FeedbackHarness
          scope={{ organizationId: "org-two", principalId: "sales-two", role: "admin" }}
        >
          <div>New scope</div>
        </FeedbackHarness>
      );
    });
    const newScopeFeedback = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    );
    expect(newScopeFeedback.currentFeedback).toBeNull();
    expect(newScopeFeedback.announcement).toBeNull();
  });

  test("marks a dispatched attempt uncertain when Workflow unmounts inside the same provider", async () => {
    const pendingWrite = deferred();
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    const onTaskOutcome = vi.fn();
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockReturnValue(pendingWrite.promise);
    mocks.getQuoteById.mockResolvedValue(completedQuote);
    const workflow = (
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
        arrivalContext={{ surfaceId: "workflow", focus: followUpTaskJourney().focus }}
        activeTaskJourney={followUpTaskJourney()}
        onTaskOutcome={onTaskOutcome}
        onOpenQuoteHistory={() => {}}
        onClose={() => {}}
      />
    );

    await act(async () => {
      root.render(<FeedbackHarness>{workflow}</FeedbackHarness>);
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

    await act(async () => {
      root.render(<FeedbackHarness><div>Compatibility workspace</div></FeedbackHarness>);
    });
    const abandonedFeedback = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    ).currentFeedback;
    expect(abandonedFeedback).toMatchObject({
      phase: "uncertain",
      changed: ["Follow-up completion remains unconfirmed"],
      nextAction: { id: "reconcile", label: "Review exact follow-up" }
    });

    await act(async () => {
      pendingWrite.resolve({
        ok: true,
        storage: "firebase",
        followUp: completedQuote.workflow.followUp
      });
      await pendingWrite.promise;
    });
    await settle();
    const retainedFeedback = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    ).currentFeedback;
    expect(mocks.getQuoteById).not.toHaveBeenCalled();
    expect(onTaskOutcome).not.toHaveBeenCalled();
    expect(retainedFeedback).toEqual(abandonedFeedback);
  });

  test("retains an uncertain duplicate fence and clears the exact busy action when staff identity changes", async () => {
    const pendingWrite = deferred();
    const initialQuote = followUpQuote();
    const completedQuote = followUpQuote({ completed: true });
    const onTaskOutcome = vi.fn();
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockReturnValue(pendingWrite.promise);
    mocks.getQuoteById.mockResolvedValue(completedQuote);
    const renderWorkflow = async (currentUserEmail) => {
      await act(async () => {
        root.render(
          <FeedbackHarness>
            <SalesWorkflowView
              open
              presentation="embedded"
              organizationId="org-one"
              currentUserRole="sales"
              currentUserEmail={currentUserEmail}
              tenantTimeZone="America/Chicago"
              focusQuoteId="quote-reply"
              focusAttentionType="follow_up"
              focusRequestId="follow-up:quote-reply"
              arrivalContext={{ surfaceId: "workflow", focus: followUpTaskJourney().focus }}
              activeTaskJourney={followUpTaskJourney()}
              onTaskOutcome={onTaskOutcome}
              onOpenQuoteHistory={() => {}}
              onClose={() => {}}
            />
          </FeedbackHarness>
        );
      });
      await settle();
    };

    await renderWorkflow("sales@example.test");
    act(() => container.querySelector("#workflow-tab-followups").click());
    act(() => container.querySelector(".workflow-complete-toggle input").click());
    let save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    expect(save.textContent).toBe("Saving...");

    await renderWorkflow("replacement@example.test");
    const abandonedFeedback = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    ).currentFeedback;
    expect(abandonedFeedback).toMatchObject({
      phase: "uncertain",
      message: "The request was sent, but staff identity changed before exact confirmation completed.",
      nextAction: { id: "reconcile", label: "Review exact follow-up" }
    });
    save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    expect(save.disabled).toBe(false);

    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-follow-up-confirmation-state="uncertain"]')?.textContent)
      .toContain("no second write was sent");

    await act(async () => {
      pendingWrite.resolve({
        ok: true,
        storage: "firebase",
        followUp: completedQuote.workflow.followUp
      });
      await pendingWrite.promise;
    });
    await settle();
    const retainedFeedback = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    ).currentFeedback;
    expect(mocks.getQuoteById).not.toHaveBeenCalled();
    expect(onTaskOutcome).not.toHaveBeenCalled();
    expect(retainedFeedback).toEqual(abandonedFeedback);
  });

  test("uses one accessible local fallback when shared feedback cannot begin", async () => {
    const initialQuote = followUpQuote();
    const onTaskOutcome = vi.fn(() => ({ status: "uncertain" }));
    const idFactory = vi.fn(() => "");
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockRejectedValue(
      new Error("Connection closed after dispatch with provider-token-secret@example.test")
    );

    await act(async () => {
      root.render(
        <FeedbackHarness idFactory={idFactory}>
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
            arrivalContext={{ surfaceId: "workflow", focus: followUpTaskJourney().focus }}
            activeTaskJourney={followUpTaskJourney()}
            onTaskOutcome={onTaskOutcome}
            onOpenQuoteHistory={() => {}}
            onClose={() => {}}
          />
        </FeedbackHarness>
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

    const probe = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    );
    const localRecovery = container.querySelector(
      '[data-follow-up-confirmation-state="uncertain"]'
    );
    expect(mocks.updateQuoteFollowUp).not.toHaveBeenCalled();
    expect(probe.currentFeedback).toBeNull();
    expect(probe.announcement).toBeNull();
    expect(localRecovery, container.innerHTML).toBeTruthy();
    expect(localRecovery?.getAttribute("role")).toBe("alert");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(localRecovery?.textContent).toContain(
      "Action feedback could not start, so the follow-up write was not sent."
    );
    expect(localRecovery?.querySelector("button")?.textContent).toBe("Return to save");
    expect(container.textContent).not.toContain("provider-token-secret@example.test");

    act(() => localRecovery.querySelector("button").click());
    const secondSave = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    await act(async () => {
      secondSave.click();
      await Promise.resolve();
    });
    await settle();

    expect(idFactory).toHaveBeenCalledTimes(2);
    expect(mocks.updateQuoteFollowUp).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[data-follow-up-confirmation-state="uncertain"]')?.textContent)
      .toContain("the follow-up write was not sent");
  });

  test("blocks a second write while an earlier exact-object outcome remains unresolved", async () => {
    const initialQuote = followUpQuote();
    const onTaskOutcome = vi.fn(() => ({ status: "uncertain" }));
    const idFactory = vi.fn()
      .mockReturnValueOnce("attempt-follow-up-one")
      .mockReturnValueOnce("attempt-follow-up-two");
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });
    mocks.updateQuoteFollowUp.mockRejectedValue(new Error("Connection closed after dispatch."));
    const renderJourney = async (journey) => {
      await act(async () => {
        root.render(
          <FeedbackHarness idFactory={idFactory}>
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
          </FeedbackHarness>
        );
      });
      await settle();
      act(() => container.querySelector("#workflow-tab-followups").click());
    };

    await renderJourney(followUpTaskJourney());
    act(() => container.querySelector(".workflow-complete-toggle input").click());
    let save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    await settle();
    const firstFeedback = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    ).currentFeedback;
    expect(firstFeedback).toMatchObject({
      phase: "uncertain",
      attemptId: "attempt-follow-up-one"
    });

    await renderJourney(followUpTaskJourney(
      "in_progress",
      "2026-09-03T02:31:00.000Z"
    ));
    const secondCompletionToggle = container.querySelector(".workflow-complete-toggle input");
    if (secondCompletionToggle.checked) {
      act(() => secondCompletionToggle.click());
    }
    expect(secondCompletionToggle.checked).toBe(false);
    save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    await act(async () => {
      save.click();
      await Promise.resolve();
    });

    const retainedFeedback = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    ).currentFeedback;
    expect(mocks.updateQuoteFollowUp).toHaveBeenCalledTimes(1);
    expect(idFactory).toHaveBeenCalledTimes(1);
    expect(retainedFeedback).toEqual(firstFeedback);
    const localRecovery = container.querySelector(
      '[data-follow-up-confirmation-state="uncertain"]'
    );
    expect(localRecovery?.getAttribute("role")).toBe("alert");
    expect(localRecovery?.textContent).toContain(
      "An earlier follow-up attempt for this exact quote still needs confirmation, so no second write was sent."
    );
  });

  test("rejects an invalid follow-up preflight before feedback or write dispatch", async () => {
    const initialQuote = followUpQuote();
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });

    await act(async () => {
      root.render(
        <FeedbackHarness>
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
            arrivalContext={{ surfaceId: "workflow", focus: followUpTaskJourney().focus }}
            activeTaskJourney={followUpTaskJourney()}
            onTaskOutcome={() => ({ status: "in_progress" })}
            onOpenQuoteHistory={() => {}}
            onClose={() => {}}
          />
        </FeedbackHarness>
      );
    });
    await settle();
    act(() => container.querySelector("#workflow-tab-followups").click());
    const stage = container.querySelector('.workflow-form-section select');
    act(() => {
      stage.value = "";
      stage.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    act(() => save.click());

    const probe = JSON.parse(
      container.querySelector('[data-testid="workspace-action-feedback-probe"]').textContent
    );
    expect(mocks.updateQuoteFollowUp).not.toHaveBeenCalled();
    expect(probe.currentFeedback).toBeNull();
    expect(probe.announcement).toBeNull();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(
      "Choose a valid follow-up stage before saving."
    );
    expect(stage).toBe(document.activeElement);
    expect(stage.getAttribute("aria-invalid")).toBe("true");
    expect(stage.getAttribute("aria-describedby")).toBe(alert.id);
  });

  test("rejects an impossible calendar date and identifies its exact field", async () => {
    expect(isCanonicalWorkflowDateOnly("2026-02-28")).toBe(true);
    expect(isCanonicalWorkflowDateOnly("2026-02-29")).toBe(false);
    expect(isCanonicalWorkflowDateOnly("2026-02-31")).toBe(false);
    expect(isCanonicalWorkflowDateOnly("09/03/2026")).toBe(false);
    const initialQuote = followUpQuote({ followUp: { dueDate: "2026-02-31" } });
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [initialQuote],
      truncated: false
    });

    await act(async () => {
      root.render(
        <FeedbackHarness>
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
            arrivalContext={{ surfaceId: "workflow", focus: followUpTaskJourney().focus }}
            activeTaskJourney={followUpTaskJourney()}
            onTaskOutcome={() => ({ status: "in_progress" })}
            onOpenQuoteHistory={() => {}}
            onClose={() => {}}
          />
        </FeedbackHarness>
      );
    });
    await settle();
    act(() => container.querySelector("#workflow-tab-followups").click());
    const dueDate = container.querySelector('.workflow-form-section input[type="date"]');
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Follow-up"
    );
    act(() => save.click());

    const alert = container.querySelector('[role="alert"]');
    expect(mocks.updateQuoteFollowUp).not.toHaveBeenCalled();
    expect(alert?.textContent).toBe(
      "Enter a real calendar date in YYYY-MM-DD format before saving."
    );
    expect(dueDate).toBe(document.activeElement);
    expect(dueDate.getAttribute("aria-invalid")).toBe("true");
    expect(dueDate.getAttribute("aria-describedby")).toBe(alert.id);
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
          <FeedbackHarness>
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
          </FeedbackHarness>
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
        <FeedbackHarness>
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
        </FeedbackHarness>
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
