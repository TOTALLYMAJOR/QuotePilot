import { describe, expect, test } from "vitest";
import {
  buildWorkflowTimingCues,
  WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY,
  WORKFLOW_COMPLETION_RECEIPT_MAX_LIMIT,
  WORKFLOW_TIMING_CUE_EVIDENCE_BOUNDARY,
  WORKFLOW_TIMING_INPUT_SCAN_LIMIT
} from "../workflowTimingCues";

function quote(overrides = {}) {
  return {
    id: "quote-1",
    quoteNumber: "QP-1001",
    status: "sent",
    workflow: {},
    ...overrides
  };
}

describe("workflow timing cues", () => {
  test("uses the requested timezone for date-only due state at an instant boundary", () => {
    const input = {
      quotes: [quote({
        workflow: { followUp: { stage: "contacted", dueDate: "2026-08-09" } }
      })],
      nowISO: "2026-08-10T01:30:00.000Z"
    };

    const chicago = buildWorkflowTimingCues({ ...input, timeZone: "America/Chicago" });
    const utc = buildWorkflowTimingCues({ ...input, timeZone: "UTC" });

    expect(chicago.asOf).toEqual({
      nowISO: "2026-08-10T01:30:00.000Z",
      timeZone: "America/Chicago",
      todayISO: "2026-08-09"
    });
    expect(chicago.cues[0]).toMatchObject({
      timingState: "due_today",
      daysOverdue: 0,
      daysUntilDue: 0,
      dueDate: "2026-08-09"
    });
    expect(utc.cues[0]).toMatchObject({
      timingState: "overdue",
      daysOverdue: 1,
      daysUntilDue: -1
    });
  });

  test("uses calendar-day math across daylight-saving transitions", () => {
    const result = buildWorkflowTimingCues({
      attentionSummary: {
        items: [{
          id: "change-request:quote-1",
          type: "change_request",
          state: "new",
          dateISO: "2026-03-07T18:00:00.000Z",
          quoteId: "quote-1",
          quote: { quoteNumber: "QP-1001" }
        }]
      },
      nowISO: "2026-03-09T05:30:00.000Z",
      timeZone: "America/Chicago"
    });

    expect(result.asOf.todayISO).toBe("2026-03-09");
    expect(result.cues[0]).toMatchObject({
      type: "change_request",
      ageDays: 2,
      ageBand: "recent",
      timingState: "waiting",
      label: "Change request waiting 2 calendar days"
    });
  });

  test("safe-projects attention items without raw quote, request, or message data", () => {
    const input = {
      attentionSummary: {
        items: [
          {
            id: "change-request:quote-1",
            type: "change_request",
            state: "acknowledged",
            dateISO: "2026-08-01T12:00:00.000Z",
            quoteId: "quote-1",
            sourceMessage: "private customer request",
            quote: {
              quoteNumber: "QP-1001",
              portalKey: "private-token",
              customer: { email: "private@example.test" }
            }
          },
          {
            id: "approval:quote-2",
            type: "approval",
            state: "pending",
            dateISO: "2026-08-08T12:00:00.000Z",
            quoteId: "quote-2",
            pendingRequests: [{ note: "private approval note" }],
            quote: { quoteNumber: "QP-1002" }
          }
        ]
      },
      nowISO: "2026-08-09T18:00:00.000Z",
      timeZone: "UTC"
    };
    const original = structuredClone(input);
    const result = buildWorkflowTimingCues(input);
    const serialized = JSON.stringify(result);

    expect(result.cues).toHaveLength(2);
    expect(result.cues[0]).toMatchObject({
      type: "change_request",
      workflowState: "acknowledged",
      ageDays: 8,
      ageBand: "long_waiting",
      evidenceBoundary: WORKFLOW_TIMING_CUE_EVIDENCE_BOUNDARY
    });
    expect(serialized).not.toContain("private customer request");
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("private approval note");
    expect(input).toEqual(original);
  });

  test("adds upcoming follow-ups from active quote records and ignores closed work", () => {
    const result = buildWorkflowTimingCues({
      quotes: [
        quote({
          id: "upcoming",
          workflow: { followUp: { stage: "proposal_sent", dueDate: "2026-08-12" } }
        }),
        quote({
          id: "complete",
          workflow: {
            followUp: {
              stage: "contacted",
              dueDate: "2026-08-08",
              completed: true,
              completedAtISO: "2026-08-08T12:00:00.000Z"
            }
          }
        }),
        quote({
          id: "won",
          workflow: { followUp: { stage: "won", dueDate: "2026-08-08" } }
        }),
        quote({
          id: "deleted",
          status: "deleted",
          workflow: { followUp: { stage: "contacted", dueDate: "2026-08-08" } }
        })
      ],
      nowISO: "2026-08-09T12:00:00.000Z",
      timeZone: "UTC"
    });

    expect(result.cues).toEqual([
      expect.objectContaining({
        quoteId: "upcoming",
        timingState: "upcoming",
        daysUntilDue: 3,
        source: "quote.workflow.follow_up"
      })
    ]);
  });

  test("emits only timestamp-backed internal receipts and keeps evidence claims narrow", () => {
    const result = buildWorkflowTimingCues({
      quotes: [quote({
        portalDecision: {
          decision: "changes_requested",
          requestId: "request-1",
          submittedAtISO: "2026-08-05T10:00:00.000Z",
          message: "private current request"
        },
        workflow: {
          followUp: {
            completed: true,
            completedAtISO: "2026-08-06T10:00:00.000Z",
            updatedByEmail: "private-staff@example.test",
            note: "private follow-up note"
          },
          changeRequestHandling: {
            state: "handled",
            sourceRequestId: "request-1",
            sourceSubmittedAtISO: "2026-08-05T10:00:00.000Z",
            sourceMessage: "private current request",
            acknowledgedAtISO: "2026-08-07T10:00:00.000Z",
            handledAtISO: "2026-08-08T10:00:00.000Z",
            handledByEmail: "private-handler@example.test",
            note: "private handling note"
          },
          approvalRequests: [{
            id: "approval-1",
            state: "approved",
            action: "send_payment_request",
            resolvedAtISO: "2026-08-09T10:00:00.000Z",
            executionState: "succeeded",
            executionReference: "private-provider-reference"
          }]
        },
        payment: { depositStatus: "paid", browserReturn: "success" },
        booking: { confirmationStatus: "confirmed" }
      })],
      nowISO: "2026-08-09T12:00:00.000Z",
      timeZone: "UTC"
    });
    const serialized = JSON.stringify(result);

    expect(result.receipts.map((receipt) => receipt.kind)).toEqual([
      "approval_decision_recorded",
      "change_request_handled",
      "change_request_acknowledged",
      "follow_up_completed"
    ]);
    expect(result.receipts[0].requestId).toBe("approval-1");
    expect(result.receipts.every((receipt) => (
      receipt.evidenceBoundary === WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY
    ))).toBe(true);
    expect(result.receiptEvidenceBoundary).toContain("do not prove customer contact");
    expect(result.receiptEvidenceBoundary).toContain("provider delivery");
    expect(result.receiptEvidenceBoundary).toContain("proposal resolution");
    expect(result.receiptEvidenceBoundary).toContain("payment");
    expect(result.receiptEvidenceBoundary).toContain("booking");
    expect(serialized).not.toContain("private current request");
    expect(serialized).not.toContain("private-staff@example.test");
    expect(serialized).not.toContain("private-handler@example.test");
    expect(serialized).not.toContain("private follow-up note");
    expect(serialized).not.toContain("private handling note");
    expect(serialized).not.toContain("private-provider-reference");
    expect(serialized).not.toContain("send_payment_request");
    expect(serialized).not.toContain("browserReturn");
    expect(serialized).not.toContain("confirmationStatus");
  });

  test("does not let stale handling create receipts for a later change request", () => {
    const result = buildWorkflowTimingCues({
      quotes: [quote({
        portalDecision: {
          decision: "changes_requested",
          requestId: "request-later",
          submittedAtISO: "2026-08-08T10:00:00.000Z",
          message: "later request"
        },
        workflow: {
          changeRequestHandling: {
            state: "handled",
            sourceRequestId: "request-earlier",
            sourceSubmittedAtISO: "2026-08-01T10:00:00.000Z",
            sourceMessage: "earlier request",
            acknowledgedAtISO: "2026-08-02T10:00:00.000Z",
            handledAtISO: "2026-08-03T10:00:00.000Z"
          }
        }
      })],
      nowISO: "2026-08-09T12:00:00.000Z",
      timeZone: "UTC"
    });

    expect(result.receipts).toEqual([]);
  });

  test("requires the stored completion flag and a valid past completion timestamp", () => {
    const result = buildWorkflowTimingCues({
      quotes: [
        quote({
          id: "missing-time",
          workflow: { followUp: { completed: true } }
        }),
        quote({
          id: "not-complete",
          workflow: {
            followUp: {
              completed: false,
              completedAtISO: "2026-08-08T10:00:00.000Z"
            }
          }
        }),
        quote({
          id: "future-completion",
          workflow: {
            followUp: {
              completed: true,
              completedAtISO: "2026-08-10T10:00:00.000Z"
            }
          }
        })
      ],
      nowISO: "2026-08-09T12:00:00.000Z",
      timeZone: "UTC"
    });

    expect(result.status).toBe("empty");
    expect(result.receipts).toEqual([]);
  });

  test("sorts receipts newest first and mechanically clamps their result window", () => {
    const quotes = Array.from({ length: WORKFLOW_COMPLETION_RECEIPT_MAX_LIMIT + 5 }, (_, index) => (
      quote({
        id: `quote-${index + 1}`,
        workflow: {
          followUp: {
            completed: true,
            completedAtISO: new Date(Date.UTC(2026, 6, index + 1, 12)).toISOString()
          }
        }
      })
    ));
    const result = buildWorkflowTimingCues({
      quotes,
      nowISO: "2026-08-09T12:00:00.000Z",
      timeZone: "UTC",
      receiptLimit: 999
    });

    expect(result.status).toBe("partial");
    expect(result.receipts).toHaveLength(WORKFLOW_COMPLETION_RECEIPT_MAX_LIMIT);
    expect(result.receiptPageInfo).toMatchObject({
      limit: WORKFLOW_COMPLETION_RECEIPT_MAX_LIMIT,
      returned: WORKFLOW_COMPLETION_RECEIPT_MAX_LIMIT,
      candidateCount: WORKFLOW_COMPLETION_RECEIPT_MAX_LIMIT + 5,
      truncated: true
    });
    expect(result.receipts[0].quoteId).toBe("quote-30");
    expect(result.receipts.at(-1).quoteId).toBe("quote-6");
  });

  test("reports bounded source scanning without claiming complete pagination", () => {
    const quotes = Array.from({ length: WORKFLOW_TIMING_INPUT_SCAN_LIMIT + 1 }, (_, index) => (
      quote({
        id: `quote-${index + 1}`,
        workflow: {
          followUp: { stage: "contacted", dueDate: "2026-08-10" }
        }
      })
    ));
    const result = buildWorkflowTimingCues({
      quotes,
      nowISO: "2026-08-09T12:00:00.000Z",
      timeZone: "UTC"
    });

    expect(result.status).toBe("partial");
    expect(result.cuePageInfo).toMatchObject({
      sourceScanTruncated: true,
      truncated: true
    });
    expect(result.receiptPageInfo.sourceScanTruncated).toBe(true);
  });

  test("reports a bounded nested approval scan", () => {
    const approvalRequests = Array.from(
      { length: WORKFLOW_TIMING_INPUT_SCAN_LIMIT + 1 },
      (_, index) => ({
        id: `approval-${index + 1}`,
        state: "approved",
        resolvedAtISO: "2026-08-08T12:00:00.000Z"
      })
    );
    const result = buildWorkflowTimingCues({
      quotes: [quote({ workflow: { approvalRequests } })],
      nowISO: "2026-08-09T12:00:00.000Z",
      timeZone: "UTC"
    });

    expect(result.status).toBe("partial");
    expect(result.receiptPageInfo).toMatchObject({
      sourceScanTruncated: true,
      truncated: true
    });
  });

  test("fails closed without an explicit timezone-bearing clock or a valid timezone", () => {
    expect(() => buildWorkflowTimingCues()).toThrow(/timezone-bearing nowISO/i);
    expect(() => buildWorkflowTimingCues({ nowISO: "2026-08-09T12:00:00" }))
      .toThrow(/timezone-bearing nowISO/i);
    expect(() => buildWorkflowTimingCues({
      nowISO: "2026-08-09T12:00:00.000Z",
      timeZone: "Mars/Olympus_Mons"
    })).toThrow(/IANA timeZone/i);
  });
});
