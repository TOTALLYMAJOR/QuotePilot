import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import WorkflowTimingPanel, {
  buildWorkflowTimingPanelState,
  WORKFLOW_TIMING_PANEL_ITEM_LIMIT
} from "../WorkflowTimingPanel";
import {
  WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY,
  WORKFLOW_TIMING_CUE_EVIDENCE_BOUNDARY
} from "../../lib/workflowTimingCues";

function timingModel(overrides = {}) {
  return {
    status: "success",
    asOf: {
      nowISO: "2026-08-09T18:00:00.000Z",
      timeZone: "America/Chicago",
      todayISO: "2026-08-09"
    },
    cueEvidenceBoundary: WORKFLOW_TIMING_CUE_EVIDENCE_BOUNDARY,
    receiptEvidenceBoundary: WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY,
    cues: [],
    receipts: [],
    cuePageInfo: {
      limit: 100,
      returned: 0,
      candidateCount: 0,
      sourceScanTruncated: false,
      truncated: false
    },
    receiptPageInfo: {
      limit: 10,
      returned: 0,
      candidateCount: 0,
      sourceScanTruncated: false,
      truncated: false
    },
    ...overrides
  };
}

function cue(index = 1) {
  return {
    id: `follow-up:quote-${index}`,
    type: "follow_up",
    workflowState: "contacted",
    quoteId: `quote-${index}`,
    quoteNumber: `QP-${1000 + index}`,
    dueDate: "2026-08-08",
    timingState: "overdue",
    ageBand: "overdue",
    daysOverdue: 1,
    daysUntilDue: -1,
    label: "Follow-up overdue by 1 calendar day",
    source: "quote.workflow.follow_up",
    sourceLabel: "Recorded quote follow-up",
    evidenceBoundary: WORKFLOW_TIMING_CUE_EVIDENCE_BOUNDARY
  };
}

function receipt(index = 1) {
  return {
    id: `quote-${index}:follow_up_completed:2026-08-08T12:00:00.000Z`,
    kind: "follow_up_completed",
    label: "Follow-up marked complete internally",
    completedAtISO: "2026-08-08T12:00:00.000Z",
    daysAgo: 1,
    quoteId: `quote-${index}`,
    quoteNumber: `QP-${1000 + index}`,
    source: "quote.workflow.follow_up",
    sourceLabel: "Recorded quote follow-up",
    evidenceBoundary: WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY
  };
}

function renderPanel(props = {}) {
  return renderToStaticMarkup(
    <WorkflowTimingPanel {...props} />
  );
}

function collectElements(node, predicate, matches = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, predicate, matches));
    return matches;
  }
  if (!React.isValidElement(node)) return matches;
  if (predicate(node)) matches.push(node);
  collectElements(node.props.children, predicate, matches);
  return matches;
}

describe("WorkflowTimingPanel", () => {
  test("distinguishes initial loading from an empty successful snapshot", () => {
    const loading = renderPanel({ loading: true });
    const empty = renderPanel({
      model: timingModel({ status: "empty" }),
      loadedAtISO: "2026-08-09T18:00:00.000Z",
      source: "firebase"
    });

    expect(loading).toContain('data-capability-state="loading"');
    expect(loading).toContain("Reading tenant-scoped workflow timestamps.");
    expect(loading).not.toContain("No timestamp-backed cues");
    expect(empty).toContain('data-capability-state="empty"');
    expect(empty).toContain("No timestamp-backed cues or internal completion receipts");
    expect(empty).toContain("Firestore staff records");
  });

  test("provides explicit unavailable recovery without inventing snapshot evidence", () => {
    const markup = renderPanel({
      error: "Firestore read unavailable.",
      onRetry: () => {}
    });

    expect(markup).toContain('data-capability-state="error"');
    expect(markup).toContain("staff-evidence-unavailable");
    expect(markup).toContain('data-read-truncation="unknown"');
    expect(markup).toContain("Retry to request a new tenant-scoped snapshot.");
    expect(markup).not.toContain("Firestore read unavailable.");
    expect(markup).toContain('data-capability-state="recovery"');
    expect(markup).toContain("Retry read");
    expect(markup).not.toContain("Calendar cues are derived");
  });

  test("retains a prior snapshot during refresh or read failure", () => {
    const model = timingModel({
      cues: [cue()],
      cuePageInfo: {
        limit: 100,
        returned: 1,
        candidateCount: 1,
        sourceScanTruncated: false,
        truncated: false
      }
    });
    const refreshing = buildWorkflowTimingPanelState({
      loading: true,
      loadedAtISO: "2026-08-09T18:00:00.000Z",
      model
    });
    const staleMarkup = renderPanel({
      model,
      loadedAtISO: "2026-08-09T18:00:00.000Z",
      source: "firebase",
      error: "Refresh failed.",
      onRetry: () => {}
    });

    expect(refreshing.state).toBe("loading");
    expect(refreshing.displayState).toBe("refreshing");
    expect(staleMarkup).toContain('data-capability-state="stale"');
    expect(staleMarkup).toContain("the last successful timing snapshot remains visible");
    expect(staleMarkup).toContain("Follow-up overdue by 1 calendar day");
    expect(staleMarkup).toContain("Retry read");
  });

  test("shows explicit source, bounds, evidence limits, and compact overflow counts", () => {
    const cues = Array.from({ length: WORKFLOW_TIMING_PANEL_ITEM_LIMIT + 2 }, (_, index) => cue(index + 1));
    const receipts = Array.from(
      { length: WORKFLOW_TIMING_PANEL_ITEM_LIMIT + 1 },
      (_, index) => receipt(index + 1)
    );
    const markup = renderPanel({
      model: timingModel({
        status: "partial",
        cues,
        receipts,
        cuePageInfo: {
          limit: 100,
          returned: cues.length,
          candidateCount: cues.length,
          sourceScanTruncated: true,
          truncated: true
        },
        receiptPageInfo: {
          limit: 10,
          returned: receipts.length,
          candidateCount: receipts.length,
          sourceScanTruncated: false,
          truncated: false
        }
      }),
      loadedAtISO: "2026-08-09T18:00:00.000Z",
      source: "firebase",
      sourceTruncated: true
    });

    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain('data-read-truncation="truncated"');
    expect(markup).toContain(`This panel shows at most ${WORKFLOW_TIMING_PANEL_ITEM_LIMIT} of each.`);
    expect(markup).toContain("At least one source scan was bounded, so this is not a complete history.");
    expect(markup).toContain("2 more cues remain in this snapshot.");
    expect(markup).toContain("1 more receipt remains in this snapshot.");
    expect(markup).toContain(WORKFLOW_TIMING_CUE_EVIDENCE_BOUNDARY);
    expect(markup).toContain(WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY);
  });

  test("marks a complete non-empty timing snapshot as success", () => {
    const markup = renderPanel({
      model: timingModel({
        cues: [cue()],
        cuePageInfo: {
          limit: 100,
          returned: 1,
          candidateCount: 1,
          sourceScanTruncated: false,
          truncated: false
        }
      }),
      loadedAtISO: "2026-08-09T18:00:00.000Z",
      source: "firebase"
    });

    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain('data-read-state="success"');
    expect(markup).toContain("Current snapshot");
  });

  test("wires real cue and quote destinations and omits buttons without handlers", () => {
    const model = timingModel({
      cues: [cue()],
      receipts: [receipt()],
      cuePageInfo: {
        limit: 100,
        returned: 1,
        candidateCount: 1,
        sourceScanTruncated: false,
        truncated: false
      },
      receiptPageInfo: {
        limit: 10,
        returned: 1,
        candidateCount: 1,
        sourceScanTruncated: false,
        truncated: false
      }
    });
    const onReviewCue = vi.fn();
    const onOpenReceipt = vi.fn();
    const tree = WorkflowTimingPanel({
      model,
      loadedAtISO: "2026-08-09T18:00:00.000Z",
      source: "firebase",
      onReviewCue,
      onOpenReceipt
    });
    const actionButtons = collectElements(tree, (element) => element.type === "button");

    expect(actionButtons).toHaveLength(2);
    actionButtons.find((button) => textLabel(button).startsWith("Review authoritative"))
      .props.onClick();
    actionButtons.find((button) => textLabel(button).startsWith("Review authoritative workflow record"))
      .props.onClick();
    expect(onReviewCue).toHaveBeenCalledWith(model.cues[0]);
    expect(onOpenReceipt).toHaveBeenCalledWith(model.receipts[0]);

    const noActions = renderPanel({
      model,
      loadedAtISO: "2026-08-09T18:00:00.000Z",
      source: "firebase"
    });
    expect(noActions).not.toContain("<button");
    expect(noActions).not.toContain("Review</button>");
  });
});

function textLabel(element) {
  return String(element.props["aria-label"] || "");
}
