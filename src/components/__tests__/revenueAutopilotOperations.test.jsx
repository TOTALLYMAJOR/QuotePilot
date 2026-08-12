// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import RevenueAutopilotOperations, {
  REVENUE_AUTOPILOT_OPERATION_KINDS,
  REVENUE_AUTOPILOT_PROVIDER_OUTCOMES,
  buildRevenueAutopilotOperationsPresentation
} from "../RevenueAutopilotOperations";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POLICY = Object.freeze({
  version: "policy-v7",
  tenantTimeZone: "America/Chicago",
  globalEnabled: true,
  sendsEnabled: true,
  tenantEnabled: true,
  provider: Object.freeze({ state: "configured" }),
  reviewRequestUrl: "https://reviews.example.test/collect",
  kinds: Object.freeze({
    quote_follow_up: Object.freeze({ enabled: true }),
    deposit_reminder: Object.freeze({ enabled: true }),
    final_balance_reminder: Object.freeze({ enabled: true }),
    post_event_review_request: Object.freeze({ enabled: true }),
    unread_reply: Object.freeze({ enabled: true })
  })
});

function job(state, kind, suffix, overrides = {}) {
  return {
    jobId: `raj_${suffix}`,
    quoteId: `quote-${suffix}`,
    quoteLabel: `Henderson event ${suffix}`,
    kind,
    state,
    dueTenantDate: "2026-08-10",
    occurrenceKey: kind === "final_balance_reminder" ? "event_minus_14" : "first_due",
    attemptCount: state === "scheduled" ? 0 : 1,
    maxAttempts: 3,
    ...overrides
  };
}

function operationsSnapshot(overrides = {}) {
  const jobs = [
    job("provider_accepted", "quote_follow_up", "accepted"),
    job("delivered", "deposit_reminder", "delivered"),
    job("bounced", "final_balance_reminder", "bounced"),
    job("complained", "quote_follow_up", "complained"),
    job("scheduled", "post_event_review_request", "review"),
    job("outcome_ambiguous", "deposit_reminder", "ambiguous")
  ];
  const attention = [{
    attentionId: "raa_reply_1",
    quoteId: "quote-reply",
    messageId: "message-reply-1",
    quoteLabel: "Henderson picnic",
    kind: "unread_customer_reply",
    state: "open",
    receivedAtISO: "2026-08-09T15:30:00.000Z"
  }];
  return {
    readState: "success",
    mutation: { state: "ready" },
    policy: POLICY,
    jobs,
    attention,
    source: "firebase",
    observedAtISO: "2026-08-09T16:00:00.000Z",
    bounds: {
      totalJobs: jobs.length,
      maximumJobs: 100,
      totalAttention: attention.length,
      maximumAttention: 50,
      complete: true,
      truncated: false
    },
    ...overrides
  };
}

let container;
let root;

function mount(element) {
  act(() => {
    root.render(element);
  });
}

function action(name) {
  return container.querySelector(`[data-capability-action="${name}"]`);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("buildRevenueAutopilotOperationsPresentation", () => {
  test("resolves every required read state without conflating it with mutation state", () => {
    expect(buildRevenueAutopilotOperationsPresentation().state).toBe("loading");
    expect(buildRevenueAutopilotOperationsPresentation({ available: false }).state).toBe("error");
    expect(buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({ readState: "empty", jobs: [], attention: [] })
    }).state).toBe("empty");
    expect(buildRevenueAutopilotOperationsPresentation({ snapshot: operationsSnapshot() }).state).toBe("success");
    expect(buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({ readState: "stale" })
    }).state).toBe("stale");
    expect(buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({ readState: "partial" })
    }).state).toBe("partial");
    expect(buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({ readState: "error" })
    }).state).toBe("error");
    expect(buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({ readState: "recovery" })
    }).state).toBe("recovery");
  });

  test("upgrades a claimed complete read to partial when its bounds are truncated", () => {
    const view = buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({
        bounds: {
          totalJobs: 12,
          maximumJobs: 100,
          totalAttention: 1,
          maximumAttention: 50,
          truncated: true
        }
      })
    });

    expect(view.state).toBe("partial");
    expect(view.bounds).toMatchObject({
      displayedJobs: 6,
      totalJobs: 12,
      completeness: "truncated"
    });
  });

  test("fails closed when policy values are absent", () => {
    const view = buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({ policy: {}, jobs: [], attention: [], readState: "empty" })
    });

    expect(view.policy.global.enabled).toBe(false);
    expect(view.policy.tenant.enabled).toBe(false);
    expect(view.policy.sends.enabled).toBe(false);
    expect(view.policy.provider.enabled).toBe(false);
    expect(view.lanes.map((lane) => lane.state)).toEqual([
      "dormant",
      "dormant",
      "dormant",
      "dormant",
      "dormant"
    ]);
    expect(view.materializeAllowed).toBe(false);
  });

  test("fails the enabled post-event lane closed until its public HTTPS review destination is configured", () => {
    const view = buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({
        policy: {
          ...POLICY,
          reviewRequestUrl: "",
          kinds: {
            quote_follow_up: { enabled: false },
            deposit_reminder: { enabled: false },
            final_balance_reminder: { enabled: false },
            post_event_review_request: { enabled: true },
            unread_customer_reply: { enabled: false }
          }
        },
        jobs: [],
        attention: [],
        readState: "empty",
        bounds: { totalJobs: 0, totalAttention: 0, complete: true }
      })
    });

    const postEvent = view.lanes.find((lane) => lane.id === "post_event_review_request");
    expect(postEvent).toMatchObject({
      state: "configuration_required",
      presentation: { label: "Review URL needed" }
    });
    expect(view.policy.reviewRequestConfigured).toBe(false);
    expect(view.materializeAllowed).toBe(false);
  });

  test("keeps preparation available while the separate send and provider gates are dormant", () => {
    const view = buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({
        policy: {
          ...POLICY,
          sendsEnabled: false,
          provider: { state: "unconfigured" }
        },
        jobs: [],
        attention: [],
        readState: "empty",
        bounds: { totalJobs: 0, totalAttention: 0, complete: true }
      })
    });

    expect(view.policy.sends.enabled).toBe(false);
    expect(view.policy.provider.enabled).toBe(false);
    expect(view.lanes.find((lane) => lane.id === "quote_follow_up")).toMatchObject({
      state: "preparation_only",
      preparable: true,
      presentation: { label: "Preparation only" }
    });
    expect(view.lanes.find((lane) => lane.id === "unread_reply")).toMatchObject({
      state: "enabled",
      preparable: true
    });
    expect(view.materializeAllowed).toBe(true);
  });

  test.each([
    "ready",
    "submitting",
    "uncertain",
    "reconciliation",
    "receipt",
    "error",
    "recovery"
  ])("preserves the governed %s mutation state", (state) => {
    const view = buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({ mutation: { state } })
    });
    expect(view.mutationState).toBe(state);
    expect(view.mutationDetail).toBeTruthy();
  });

  test("keeps withheld and provider-accepted reconciliation receipts semantically distinct", () => {
    const withheld = buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({
        mutation: {
          state: "receipt",
          operation: "reconcile_job",
          reconciliationState: "withheld",
          reconciliationReason: "portal_viewed_recorded"
        }
      })
    });
    const providerAccepted = buildRevenueAutopilotOperationsPresentation({
      snapshot: operationsSnapshot({
        mutation: {
          state: "receipt",
          operation: "reconcile_job",
          reconciliationState: "provider_accepted"
        }
      })
    });

    expect(withheld).toMatchObject({
      mutationPresentation: { family: "blocked", label: "Dispatch withheld" },
      reconciliationOutcome: { state: "withheld", reason: "portal_viewed_recorded" }
    });
    expect(withheld.mutationDetail).toMatch(/before any provider call/i);
    expect(providerAccepted).toMatchObject({
      mutationPresentation: { family: "provider", label: "Provider accepted" },
      reconciliationOutcome: { state: "provider_accepted", reason: "" }
    });
    expect(providerAccepted.mutationDetail).toMatch(/delivery.*remain.*separate evidence/i);
  });
});

describe("RevenueAutopilotOperations", () => {
  test.each([
    ["loading", null, true, "Reading tenant-scoped policy"],
    ["empty", operationsSnapshot({ readState: "empty", jobs: [], attention: [] }), true, "No materialized jobs"],
    ["success", operationsSnapshot(), true, "operations snapshot is current"],
    ["stale", operationsSnapshot({ readState: "stale" }), true, "Retained records remain visible"],
    ["partial", operationsSnapshot({ readState: "partial" }), true, "Missing records and outcomes remain unknown"],
    ["error", null, false, "no previous results are available"],
    ["recovery", operationsSnapshot({ readState: "recovery" }), true, "operations read is recovering"]
  ])("renders the complete %s read state", (state, snapshot, available, expectedCopy) => {
    const markup = renderToStaticMarkup(
      <RevenueAutopilotOperations snapshot={snapshot} available={available} />
    );

    expect(markup).toContain(`data-capability-id="cwf-12-revenue-autopilot-operations"`);
    expect(markup).toContain(`data-capability-state="${state}"`);
    expect(markup).toContain(expectedCopy);
    expect(markup).toContain("What these records do not prove");
  });

  test("renders every literal canonical Revenue Autopilot operations read marker", () => {
    const renderRead = (snapshot, available = true) => renderToStaticMarkup(
      <RevenueAutopilotOperations snapshot={snapshot} available={available} />
    );

    expect(renderRead(null)).toContain('data-capability-state="loading"');
    expect(renderRead(operationsSnapshot({ readState: "empty", jobs: [], attention: [] })))
      .toContain('data-capability-state="empty"');
    expect(renderRead(operationsSnapshot())).toContain('data-capability-state="success"');
    expect(renderRead(operationsSnapshot({ readState: "stale" })))
      .toContain('data-capability-state="stale"');
    expect(renderRead(operationsSnapshot({ readState: "partial" })))
      .toContain('data-capability-state="partial"');
    expect(renderRead(null, false)).toContain('data-capability-state="error"');
    expect(renderRead(operationsSnapshot({ readState: "recovery" })))
      .toContain('data-capability-state="recovery"');
  });

  test("keeps activation gates and each operation kind discoverable while defaulting to dormant", () => {
    const model = operationsSnapshot({
      readState: "empty",
      policy: {},
      jobs: [],
      attention: [],
      bounds: { totalJobs: 0, totalAttention: 0, complete: true }
    });
    const markup = renderToStaticMarkup(
      <RevenueAutopilotOperations snapshot={model} onConfigure={() => {}} onMaterialize={() => {}} />
    );

    expect(markup).toContain("Dormant by default. No automated email can run");
    expect(markup).toContain('data-automation-gate="global"');
    expect(markup).toContain('data-automation-gate="tenant"');
    expect(markup).toContain('data-automation-gate="sends"');
    expect(markup).toContain('data-automation-gate="provider"');
    for (const kind of REVENUE_AUTOPILOT_OPERATION_KINDS) {
      expect(markup).toContain(`data-automation-kind="${kind.id}"`);
      expect(markup).toContain(kind.label);
    }
    expect(markup).toContain('data-automation-state="dormant"');
    expect(markup).toContain('data-capability-action="configure-revenue-autopilot"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('data-capability-action="materialize-revenue-autopilot-jobs"');
  });

  test("renders exact source, bounds, four distinct provider outcomes, and bounded queue evidence", () => {
    const markup = renderToStaticMarkup(
      <RevenueAutopilotOperations snapshot={operationsSnapshot()} />
    );

    expect(markup).toContain("Firestore staff records");
    expect(markup).toContain("6 of 6");
    expect(markup).toContain("1 of 1");
    expect(markup).toContain("Hard maximum 100");
    expect(markup).toContain("America/Chicago");
    expect(markup).toContain("Five independently governed lanes");
    expect(markup).toContain("Post-event review request");
    expect(markup).toContain('data-review-request-configuration="configured"');
    expect(markup).toContain("Tenant review destination: reviews.example.test");
    expect(markup).toContain("A review ask does not prove an external review");
    for (const outcome of REVENUE_AUTOPILOT_PROVIDER_OUTCOMES) {
      expect(markup).toContain(`data-provider-outcome="${outcome.id}"`);
      expect(markup).toContain(outcome.label);
    }
    expect(markup).toContain("Provider accepted is not delivered");
    expect(markup).toContain("Delivered is not customer viewed");
    expect(markup).toContain('data-job-state="outcome_ambiguous"');
    expect(markup).toContain('data-attention-state="open"');
    expect(markup).not.toContain("providerMessageId");
    expect(markup).not.toContain("message body");
  });

  test("shows dispatch suppression without rewriting the recorded provider state", () => {
    const suppressed = job("outcome_ambiguous", "quote_follow_up", "suppressed", {
      dispatchSuppressedAtISO: "2026-08-09T16:10:00.000Z",
      dispatchSuppressionReason: "portal_viewed_recorded"
    });
    const markup = renderToStaticMarkup(
      <RevenueAutopilotOperations snapshot={operationsSnapshot({
        jobs: [suppressed],
        attention: [],
        bounds: { totalJobs: 1, totalAttention: 0, complete: true }
      })} />
    );

    expect(markup).toContain('data-job-state="outcome_ambiguous"');
    expect(markup).toContain('data-dispatch-suppressed="true"');
    expect(markup).toContain("Future dispatch suppressed");
    expect(markup).toContain("recorded provider outcome remains unchanged");
  });

  test.each([
    ["ready", "No staff operation is currently in flight."],
    ["submitting", "Do not repeat the action."],
    ["uncertain", "not assumed complete"],
    ["reconciliation", "does not create a second job"],
    ["receipt", "does not prove provider acceptance"],
    ["error", "No successful record or outbound outcome is assumed"],
    ["recovery", "explicit recovery"]
  ])("renders the complete %s mutation state with proof-safe copy", (state, expectedCopy) => {
    const markup = renderToStaticMarkup(
      <RevenueAutopilotOperations snapshot={operationsSnapshot({ mutation: { state } })} />
    );

    expect(markup).toContain('data-capability-id="cwf-12-revenue-autopilot-mutation"');
    expect(markup).toContain(`data-capability-state="${state}"`);
    expect(markup).toContain(expectedCopy);
  });

  test("renders a withheld reconciliation as a visible non-provider outcome", () => {
    const markup = renderToStaticMarkup(
      <RevenueAutopilotOperations snapshot={operationsSnapshot({
        mutation: {
          state: "receipt",
          operation: "reconcile_job",
          reconciliationState: "withheld",
          reconciliationReason: "portal_viewed_recorded"
        }
      })} />
    );

    expect(markup).toContain('data-reconciliation-state="withheld"');
    expect(markup).toContain('data-reconciliation-reason="portal_viewed_recorded"');
    expect(markup).toContain("Dispatch withheld");
    expect(markup).toContain("before any provider call");
    expect(markup).toContain("No provider acceptance or delivery is established");
  });

  test("renders every literal canonical Revenue Autopilot operation mutation marker", () => {
    const renderMutation = (state) => renderToStaticMarkup(
      <RevenueAutopilotOperations snapshot={operationsSnapshot({ mutation: { state } })} />
    );

    expect(renderMutation("ready")).toContain('data-capability-state="ready"');
    expect(renderMutation("submitting")).toContain('data-capability-state="submitting"');
    expect(renderMutation("uncertain")).toContain('data-capability-state="uncertain"');
    expect(renderMutation("reconciliation")).toContain('data-capability-state="reconciliation"');
    expect(renderMutation("receipt")).toContain('data-capability-state="receipt"');
    expect(renderMutation("error")).toContain('data-capability-state="error"');
    expect(renderMutation("recovery")).toContain('data-capability-state="recovery"');
  });

  test("renders the bounded per-lane preparation receipt without private lane detail", () => {
    const summary = {
      createdCount: 2,
      updatedCount: 1,
      lanes: Object.fromEntries(REVENUE_AUTOPILOT_OPERATION_KINDS
        .filter((kind) => kind.outbound)
        .map((kind) => [kind.id, {
          state: kind.id === "quote_follow_up" ? "ready" : "blocked",
          createCount: kind.id === "quote_follow_up" ? 2 : 0,
          updateCount: kind.id === "deposit_reminder" ? 1 : 0,
          conflictCount: 0,
          reasonCodes: []
        }]))
    };
    const markup = renderToStaticMarkup(
      <RevenueAutopilotOperations snapshot={operationsSnapshot({
        mutation: {
          state: "receipt",
          operation: "materialize_jobs",
          materializationSummary: summary
        }
      })} />
    );

    expect(markup).toContain('data-materialization-summary="bounded"');
    expect(markup).toContain('data-materialization-lane="quote_follow_up"');
    expect(markup).toContain("Prepared 2 new records");
    expect(markup).toContain("Quote follow-up");
  });

  test("routes exact conversation opening separately from truthful manual acknowledgement", () => {
    const snapshot = operationsSnapshot();
    const onConfigure = vi.fn();
    const onMaterialize = vi.fn();
    const onReconcile = vi.fn();
    const onOpenConversation = vi.fn();
    const onAcknowledgeReply = vi.fn();
    mount(
      <RevenueAutopilotOperations
        snapshot={snapshot}
        onConfigure={onConfigure}
        onMaterialize={onMaterialize}
        onReconcile={onReconcile}
        onOpenConversation={onOpenConversation}
        onAcknowledgeReply={onAcknowledgeReply}
      />
    );

    act(() => action("configure-revenue-autopilot").click());
    act(() => action("materialize-revenue-autopilot-jobs").click());
    act(() => action("reconcile-revenue-autopilot-job").click());
    act(() => action("open-unread-reply-conversation").click());
    act(() => action("manual-acknowledge-unread-reply").click());

    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onConfigure).toHaveBeenCalledWith();
    expect(onMaterialize).toHaveBeenCalledWith(snapshot);
    expect(onReconcile).toHaveBeenCalledWith(snapshot.jobs[5]);
    expect(onOpenConversation).toHaveBeenCalledWith(snapshot.attention[0]);
    expect(onAcknowledgeReply).toHaveBeenCalledWith(snapshot.attention[0]);
    expect(container.textContent).toContain("does not claim the message was rendered or read");
    expect(container.querySelector('[data-capability-action="send-email"]')).toBeNull();
  });

  test("closes every record mutation control when the capability is unavailable", () => {
    const onConfigure = vi.fn();
    const onMaterialize = vi.fn();
    const onReconcile = vi.fn();
    const onOpenConversation = vi.fn();
    const onAcknowledgeReply = vi.fn();
    mount(
      <RevenueAutopilotOperations
        snapshot={operationsSnapshot()}
        available={false}
        onConfigure={onConfigure}
        onMaterialize={onMaterialize}
        onReconcile={onReconcile}
        onOpenConversation={onOpenConversation}
        onAcknowledgeReply={onAcknowledgeReply}
      />
    );

    expect(action("materialize-revenue-autopilot-jobs").disabled).toBe(true);
    expect(action("reconcile-revenue-autopilot-job").disabled).toBe(true);
    expect(action("open-unread-reply-conversation").disabled).toBe(true);
    expect(action("manual-acknowledge-unread-reply").disabled).toBe(true);
    expect(action("configure-revenue-autopilot").disabled).toBe(false);

    act(() => action("materialize-revenue-autopilot-jobs").click());
    act(() => action("reconcile-revenue-autopilot-job").click());
    act(() => action("open-unread-reply-conversation").click());
    act(() => action("manual-acknowledge-unread-reply").click());
    expect(onMaterialize).not.toHaveBeenCalled();
    expect(onReconcile).not.toHaveBeenCalled();
    expect(onOpenConversation).not.toHaveBeenCalled();
    expect(onAcknowledgeReply).not.toHaveBeenCalled();
  });

  test("does not render arbitrary read errors, provider secrets, message content, or commercial recovery claims", () => {
    const markup = renderToStaticMarkup(
      <RevenueAutopilotOperations
        snapshot={operationsSnapshot({
          readState: "stale",
          read: { state: "stale", error: "provider-secret-abc" },
          jobs: [{
            ...job("delivered", "quote_follow_up", "safe"),
            providerMessageId: "provider-private-123",
            messageBody: "private customer reply"
          }]
        })}
      />
    );

    expect(markup).not.toContain("provider-secret-abc");
    expect(markup).not.toContain("provider-private-123");
    expect(markup).not.toContain("private customer reply");
    expect(markup).not.toMatch(/recovered \$|recovered [0-9]/i);
    expect(markup).toContain("Payment reminders do not prove money received or recovered revenue");
  });
});
