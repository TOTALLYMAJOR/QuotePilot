import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { WORKFLOW_TIMING_INPUT_SCAN_LIMIT } from "../../lib/workflowTimingCues";
import {
  RevenueAutopilotReviewRequestPolicyFields,
  SalesWorkflowView,
  buildRevenueAutopilotReviewRequestConfiguration,
  buildWorkflowRevenueAutopilotInput,
  buildWorkflowRevenueAutopilotRead,
  isRevenueAutopilotPolicySaveBlocked,
  resolveWorkflowFocusTarget
} from "../SalesWorkflowModal";

function quote(overrides = {}) {
  return {
    id: "quote-1",
    organizationId: "org-1",
    quoteNumber: "QP-1001",
    status: "sent",
    activeVersionId: "version-1",
    portalIssuedAtISO: "2026-08-08T18:00:00.000Z",
    lifecycle: { sentAtISO: "2026-08-08T18:05:00.000Z" },
    workflow: {
      quoteDelivery: {
        state: "provider_accepted",
        revisionId: "version-1",
        portalIssuedAtISO: "2026-08-08T18:00:00.000Z"
      }
    },
    customer: { name: "Henderson Industries", email: "ops@example.test" },
    event: { date: "2026-09-01" },
    payment: { depositStatus: "unpaid" },
    conversationSummary: { messageCount: 0 },
    ...overrides
  };
}

describe("Sales Workflow revenue autopilot integration", () => {
  test("resolves post-event, unread-reply, and Decision Debt route focus to their exact tabs and rows", () => {
    const attentionItems = [
      {
        id: "post-event-closeout:quote-closeout:closeout-one",
        quoteId: "quote-closeout",
        type: "post_event_closeout"
      },
      {
        id: "unread-reply:attention-one",
        quoteId: "quote-reply",
        type: "unread_customer_reply",
        sourceRequestId: "attention-one",
        attentionId: "attention-one",
        messageId: "message-one"
      }
    ];
    expect(resolveWorkflowFocusTarget({
      focusQuoteId: "quote-closeout",
      focusAttentionType: "post_event_closeout",
      attentionItems
    })).toEqual({
      tab: "attention",
      itemId: "post-event-closeout:quote-closeout:closeout-one"
    });
    expect(resolveWorkflowFocusTarget({
      focusQuoteId: "quote-reply",
      focusAttentionType: "unread_customer_reply",
      focusRequestId: "attention-one",
      attentionItems
    })).toEqual({
      tab: "attention",
      itemId: "unread-reply:attention-one"
    });
    expect(resolveWorkflowFocusTarget({
      focusQuoteId: "quote-debt",
      focusAttentionType: "decision_debt",
      focusRequestId: "debt-one",
      decisionDebtItems: [{ id: "debt-one", quoteId: "quote-debt" }]
    })).toEqual({ tab: "debt", itemId: "debt-one" });
    expect(resolveWorkflowFocusTarget({
      focusQuoteId: "quote-reply",
      focusAttentionType: "unread_customer_reply",
      focusRequestId: "different-attention",
      attentionItems
    })).toBeNull();
  });

  test("binds the post-event lane toggle to a strict tenant review-destination state", () => {
    expect(buildRevenueAutopilotReviewRequestConfiguration({
      enabled: false,
      reviewRequestUrl: ""
    })).toMatchObject({ state: "dormant", valid: true });
    expect(buildRevenueAutopilotReviewRequestConfiguration({
      enabled: true,
      reviewRequestUrl: ""
    })).toMatchObject({ state: "missing", valid: false });
    expect(buildRevenueAutopilotReviewRequestConfiguration({
      enabled: true,
      reviewRequestUrl: "http://localhost/reviews"
    })).toMatchObject({ state: "invalid", valid: false });
    expect(buildRevenueAutopilotReviewRequestConfiguration({
      enabled: true,
      reviewRequestUrl: "https://reviews.example.test/collect"
    })).toMatchObject({
      state: "configured",
      valid: true,
      host: "reviews.example.test"
    });
  });

  test("renders the admin post-event toggle, required URL field, and proof-safe configuration copy", () => {
    const markup = renderToStaticMarkup(
      <RevenueAutopilotReviewRequestPolicyFields
        draft={{
          kinds: { post_event_review_request: true },
          reviewRequestUrl: "https://reviews.example.test/collect"
        }}
        onDraftChange={() => {}}
      />
    );

    expect(markup).toContain('data-capability-id="cwf-12-post-event-review-policy"');
    expect(markup).toContain('data-capability-state="configured"');
    expect(markup).toContain('data-capability-action="toggle-post-event-review-request"');
    expect(markup).toContain('data-capability-action="set-post-event-review-url"');
    expect(markup).toContain('type="url"');
    expect(markup).toContain("Runtime, provider, closeout, consent, and suppression gates remain separate");
    expect(markup).toContain("not evidence of an external review or recovered revenue");
  });

  test("blocks a new invalid policy while preserving exact pending-attempt reconciliation", () => {
    const invalidReviewConfiguration = { valid: false };
    expect(isRevenueAutopilotPolicySaveBlocked({
      mutationState: "ready",
      reviewConfiguration: invalidReviewConfiguration
    })).toBe(true);
    expect(isRevenueAutopilotPolicySaveBlocked({
      mutationState: "uncertain",
      pendingAttempt: { requestId: "ra_request_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      reviewConfiguration: invalidReviewConfiguration
    })).toBe(false);
    expect(isRevenueAutopilotPolicySaveBlocked({
      mutationState: "reconciliation",
      pendingAttempt: { requestId: "ra_request_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      reviewConfiguration: { valid: true }
    })).toBe(true);
  });

  test("derives the date from an explicit tenant time zone instead of device calendar state", () => {
    const input = buildWorkflowRevenueAutopilotInput({
      organizationId: "org-1",
      quote: quote(),
      source: "firebase",
      snapshotAtISO: "2026-08-10T01:00:00.000Z",
      tenantTimeZone: "America/Chicago"
    });

    expect(input.calendarContext).toEqual({
      date: "2026-08-09",
      source: "tenant",
      timeZone: "America/Chicago"
    });
  });

  test("passes only an actually embedded canonical payment ledger and invents no other evidence or controls", () => {
    const ledger = {
      version: 1,
      entries: [{
        operationId: "deposit-op-1",
        paymentKind: "deposit",
        amountCents: 25000,
        state: "prepared",
        providerReference: "",
        providerSettledAtISO: ""
      }]
    };
    const input = buildWorkflowRevenueAutopilotInput({
      organizationId: "org-1",
      quote: quote({
        payment: { depositStatus: "unpaid", ledger },
        revenueAutopilotEvidence: {
          portalProjections: [{ state: "viewed" }],
          paymentWebhookSnapshot: { signatureVerified: true }
        }
      }),
      source: "firebase",
      snapshotAtISO: "2026-08-10T18:00:00.000Z",
      tenantTimeZone: "America/Chicago"
    });

    expect(input.controls).toEqual({});
    expect(input.evidence).toEqual({
      paymentLedgers: [{
        source: "canonical_payment_ledger",
        organizationId: "org-1",
        quoteId: "quote-1",
        observedForDate: "2026-08-10",
        version: 1,
        entries: ledger.entries
      }]
    });
    expect(input.evidence).not.toHaveProperty("portalProjections");
    expect(input.evidence).not.toHaveProperty("paymentWebhookSnapshot");
    expect(input.evidence).not.toHaveProperty("conversationSnapshots");
  });

  test("fails closed for browser-local quotes or missing tenant calendar authority", () => {
    expect(buildWorkflowRevenueAutopilotRead({
      organizationId: "org-1",
      quote: quote(),
      source: "local",
      snapshotAtISO: "2026-08-10T18:00:00.000Z",
      tenantTimeZone: "America/Chicago"
    })).toMatchObject({
      preview: null,
      error: "authoritative_quote_read_required"
    });

    expect(buildWorkflowRevenueAutopilotRead({
      organizationId: "org-1",
      quote: quote(),
      source: "firebase",
      snapshotAtISO: "2026-08-10T18:00:00.000Z"
    })).toMatchObject({
      preview: null,
      error: "tenant_calendar_authority_required"
    });
  });

  test("returns a safe bounded preview whose missing independent evidence remains blocked", () => {
    const result = buildWorkflowRevenueAutopilotRead({
      organizationId: "org-1",
      quote: quote(),
      source: "firebase",
      snapshotAtISO: "2026-08-10T18:00:00.000Z",
      tenantTimeZone: "America/Chicago"
    });

    expect(result.error).toBe("");
    expect(result.preview).toMatchObject({
      mode: "read_only_preview",
      organizationId: "org-1",
      quoteId: "quote-1",
      sideEffects: {
        sends: false,
        writes: false,
        schedules: false,
        idempotencyClaims: false
      },
      bounds: {
        quoteCount: 1,
        evaluationCount: 4,
        maximumEvaluationCount: 4
      },
      counts: { blocked: 4 }
    });
    expect(result.preview.evaluations.map((item) => item.reasons[0].code)).toEqual([
      "portal_evidence_missing",
      "portal_evidence_missing",
      "booking_evidence_missing",
      "conversation_evidence_missing"
    ]);
  });

  test("renders a keyboard-addressable, non-sending Revenue autopilot tab in the real Workflow surface", () => {
    const markup = renderToStaticMarkup(
      <SalesWorkflowView
        open
        presentation="embedded"
        organizationId="org-1"
        currentUserRole="admin"
        tenantTimeZone="America/Chicago"
        onClose={() => {}}
      />
    );

    expect(markup).toContain('id="workflow-tab-autopilot"');
    expect(markup).toContain('aria-controls="workflow-panel-autopilot"');
    expect(markup).toContain('id="workflow-panel-autopilot"');
    expect(markup).toContain('aria-labelledby="workflow-tab-autopilot"');
    expect(markup).toContain('data-automation-surface="read-only-preview"');
    expect(markup).toContain('data-capability-id="cwf-12-revenue-autopilot-preview"');
    expect(markup).toContain('data-capability-state="loading"');
    expect(markup).toContain("0 messages scheduled · 0 messages sent");
    expect(markup).toContain('data-quote-snapshot-bound="unknown"');
    expect(markup).toContain(`reads at most ${WORKFLOW_TIMING_INPUT_SCAN_LIMIT} quotes`);
    expect(markup).not.toContain("Schedule message");
    expect(markup).not.toContain("Send message");
  });
});
