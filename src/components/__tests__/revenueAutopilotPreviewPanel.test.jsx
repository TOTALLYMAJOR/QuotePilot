import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import RevenueAutopilotPreviewPanel, {
  REVENUE_AUTOPILOT_SAFETY_GATES,
  buildRevenueAutopilotPanelState
} from "../RevenueAutopilotPreviewPanel";

const PROOF_BOUNDARIES = [
  "This is a deterministic, read-only eligibility preview. It sends, writes, and schedules nothing.",
  "Provider configuration does not prove dispatch, provider acceptance, delivery, inbox placement, or customer action.",
  "Payment stops require matching verified-webhook or settled-ledger evidence. They do not establish accounting revenue or recovered revenue.",
  "Message bodies, portal tokens, payment links, and provider credentials are excluded from this projection."
];

function evaluation(kind, label, state, code, message, overrides = {}) {
  return {
    kind,
    label,
    state,
    eligible: state === "eligible",
    reasons: [{ code, message, category: "evidence" }],
    summary: message,
    job: {
      identity: `revenue-autopilot-preview-v1:org-1:quote-1:${kind}:scope:template:v1`,
      executable: false,
      executionState: "preview_only",
      idempotency: {
        claimState: "not_claimed",
        persisted: false
      }
    },
    ...overrides
  };
}

function preview(overrides = {}) {
  const evaluations = [
    evaluation(
      "quote_follow_up",
      "Quote follow-up",
      "stopped",
      "portal_view_recorded",
      "Quote follow-up stops because an exact portal view is recorded."
    ),
    evaluation(
      "deposit_reminder",
      "Deposit reminder",
      "blocked",
      "quiet_hours_active",
      "The tenant quiet-hours policy currently blocks outbound contact."
    ),
    evaluation(
      "final_balance_reminder",
      "Final-balance reminder",
      "eligible",
      "eligible_for_review",
      "All required source and control evidence is present for a reviewed, non-sending preview.",
      { window: "event_minus_14", daysUntilEvent: 14 }
    ),
    evaluation(
      "unread_customer_reply",
      "Unread customer reply escalation",
      "not_due",
      "conversation_empty",
      "No customer conversation message is recorded for escalation."
    )
  ];
  return {
    version: 1,
    mode: "read_only_preview",
    organizationId: "org-1",
    quoteId: "quote-1",
    calendarContext: {
      date: "2026-08-10",
      source: "tenant",
      timeZone: "America/Chicago",
      label: "Tenant-local calendar date"
    },
    proofBoundaries: PROOF_BOUNDARIES,
    sideEffects: {
      sends: false,
      writes: false,
      schedules: false,
      idempotencyClaims: false
    },
    bounds: {
      quoteCount: 1,
      evaluationCount: evaluations.length,
      maximumEvaluationCount: 4
    },
    counts: { eligible: 1, blocked: 1, stopped: 1, not_due: 1 },
    evaluations,
    ...overrides
  };
}

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  const children = React.Children.toArray(node.props?.children);
  for (const child of children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

describe("buildRevenueAutopilotPanelState", () => {
  test("distinguishes loading, empty, success, partial, error, and retained-stale states", () => {
    expect(buildRevenueAutopilotPanelState({ loading: true }).state).toBe("loading");
    expect(buildRevenueAutopilotPanelState().state).toBe("empty");
    expect(buildRevenueAutopilotPanelState({ preview: preview() }).state).toBe("success");
    expect(buildRevenueAutopilotPanelState({ preview: preview(), partial: true }).state).toBe("partial");
    expect(buildRevenueAutopilotPanelState({ error: "read failed" }).state).toBe("error");
    expect(buildRevenueAutopilotPanelState({ preview: preview(), error: "refresh failed" }).state).toBe("stale");
  });

  test("rejects any snapshot that is not explicitly non-sending", () => {
    const unsafe = preview({ sideEffects: { sends: true, writes: false, schedules: false, idempotencyClaims: false } });
    expect(buildRevenueAutopilotPanelState({ preview: unsafe })).toMatchObject({
      state: "error",
      snapshotAvailable: false
    });
  });
});

describe("RevenueAutopilotPreviewPanel", () => {
  test.each([
    ["loading", { loading: true }, "No messages are scheduled or sent while this preview loads."],
    ["empty", {}, "Open an authoritative quote"],
    ["error", { error: "provider secret must not be rendered" }, "A safe read-only preview is unavailable."]
  ])("renders the %s state without implying outbound work", (state, props, copy) => {
    const markup = renderToStaticMarkup(<RevenueAutopilotPreviewPanel {...props} />);

    expect(markup).toContain(`data-capability-state="${state}"`);
    expect(markup).toContain(copy);
    expect(markup).toContain("0 messages scheduled · 0 messages sent");
    expect(markup).not.toContain("provider secret must not be rendered");
  });

  test("renders every safety gate, reason, bound, timezone, proof boundary, and non-sending descriptor", () => {
    const model = preview();
    const markup = renderToStaticMarkup(<RevenueAutopilotPreviewPanel preview={model} />);

    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain("America/Chicago");
    expect(markup).toContain("1 quote · 4 evaluations · hard maximum 4");
    expect(markup).toContain("1 eligible · 1 blocked · 1 stopped · 1 not due");
    expect(markup).toContain("event_minus_14 · 14 tenant-calendar days until event");
    for (const gate of REVENUE_AUTOPILOT_SAFETY_GATES) {
      expect(markup).toContain(`data-safety-gate="${gate.id}"`);
      expect(markup).toContain(gate.label);
      expect(markup).toContain(gate.detail);
    }
    for (const item of model.evaluations) {
      for (const reason of item.reasons) {
        expect(markup).toContain(`data-reason-code="${reason.code}"`);
        expect(markup).toContain(reason.message);
      }
      expect(markup).toContain(item.job.identity);
    }
    for (const boundary of PROOF_BOUNDARIES) expect(markup).toContain(boundary);
    expect(markup).toContain("Idempotency claim: not_claimed; not persisted.");
    expect(markup).toContain("It cannot write records, claim idempotency, schedule work, or contact a customer.");
  });

  test("keeps partial and stale snapshots visible with explicit reliability boundaries", () => {
    const partialMarkup = renderToStaticMarkup(
      <RevenueAutopilotPreviewPanel preview={preview()} partial />
    );
    const staleMarkup = renderToStaticMarkup(
      <RevenueAutopilotPreviewPanel preview={preview()} stale error="refresh failed" />
    );

    expect(partialMarkup).toContain('data-capability-state="partial"');
    expect(partialMarkup).toContain("This is not a complete eligibility set.");
    expect(partialMarkup).toContain("portal_view_recorded");
    expect(staleMarkup).toContain('data-capability-state="stale"');
    expect(staleMarkup).toContain("The retained preview may be stale");
    expect(staleMarkup).toContain("portal_view_recorded");
  });

  test("exposes only authoritative quote navigation and never a send or schedule action", () => {
    const onOpenQuote = vi.fn();
    const tree = RevenueAutopilotPreviewPanel({ preview: preview(), onOpenQuote });
    const button = findElement(tree, (node) => node.type === "button");
    const markup = renderToStaticMarkup(tree);

    expect(button?.props?.["data-capability-action"]).toBe("open-authoritative-quote");
    button.props.onClick();
    expect(onOpenQuote).toHaveBeenCalledTimes(1);
    expect(onOpenQuote).toHaveBeenCalledWith("quote-1");
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).not.toContain("Schedule message");
    expect(markup).not.toContain("Send message");
  });
});
