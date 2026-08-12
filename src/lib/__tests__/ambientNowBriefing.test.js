import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  AMBIENT_NOW_BRIEFING_MODEL,
  AMBIENT_NOW_PRIORITY_LIMIT,
  AMBIENT_NOW_QUIET_PROGRESS_LIMIT,
  buildAmbientNowBriefing
} from "../ambientNowBriefing";
import { WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY } from "../workflowTimingCues";

const NOW_ISO = "2026-08-12T15:00:00.000Z";
const LOADED_AT = Date.parse("2026-08-12T14:59:00.000Z");

function attentionItem(index, overrides = {}) {
  return {
    id: `follow-up:quote-${index}`,
    type: "follow_up",
    state: "overdue",
    quoteId: `quote-${index}`,
    dateISO: "2026-08-11",
    daysOverdue: 1,
    priority: index,
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    loading: false,
    error: "",
    source: "firebase",
    reads: {
      attention: { status: "success" },
      history: { status: "success" },
      unreadReplies: { status: "success" }
    },
    partial: false,
    stale: false,
    attentionSummary: { itemCount: 0, items: [] },
    quotes: [],
    truncated: false,
    truncationKnown: true,
    loadedAt: LOADED_AT,
    ...overrides
  };
}

describe("buildAmbientNowBriefing", () => {
  test("preserves the existing Workflow order, returns at most three priorities, and counts overflow", () => {
    const items = [
      attentionItem(4, { type: "approval", state: "pending", pendingRequests: [{ id: "approval-4" }] }),
      attentionItem(2, { type: "change_request", state: "new" }),
      attentionItem(9),
      attentionItem(1),
      attentionItem(7)
    ];
    const result = buildAmbientNowBriefing({
      snapshot: snapshot({ attentionSummary: { itemCount: items.length, items } }),
      nowISO: NOW_ISO,
      timeZone: "America/Chicago"
    });

    expect(result.modelId).toBe(AMBIENT_NOW_BRIEFING_MODEL);
    expect(result.state).toBe("priorities");
    expect(result.priorities).toHaveLength(AMBIENT_NOW_PRIORITY_LIMIT);
    expect(result.priorities.map(({ item }) => item.id)).toEqual(items.slice(0, 3).map((item) => item.id));
    expect(result.priorities.map(({ signal }) => signal.evidence[0].quoteId)).toEqual([
      "quote-4",
      "quote-2",
      "quote-9"
    ]);
    expect(result.overflowCount).toBe(2);
    expect(result.caughtUp.eligible).toBe(false);
    expect(result.bounds).toMatchObject({
      priorityLimit: 3,
      returnedPriorityCount: 3,
      attentionItemCount: 5
    });
  });

  test("allows caught up only for a complete current snapshot with known bounds", () => {
    const result = buildAmbientNowBriefing({
      snapshot: snapshot(),
      nowISO: NOW_ISO
    });

    expect(result.state).toBe("caught_up");
    expect(result.priorities).toEqual([]);
    expect(result.overflowCount).toBe(0);
    expect(result.caughtUp).toEqual({
      eligible: true,
      reason: "No tracked Workflow attention is present in this complete bounded snapshot; other evidence domains remain separate."
    });
    expect(result.freshness).toMatchObject({
      state: "current",
      source: "firebase",
      loadedAtISO: "2026-08-12T14:59:00.000Z",
      loadedAtMeaning: "device_read_completion",
      complete: true,
      boundsKnown: true
    });
    expect(result.freshness.caveat).toContain("not provider, customer, payment, booking, or operational-completion evidence");
  });

  test.each([
    ["stale", { stale: true }, "stale"],
    ["partial", { partial: true }, "partial"],
    ["unknown bounds", { truncationKnown: false }, "unknown"],
    ["truncated", { truncated: true }, "truncated"],
    ["refreshing", { loading: true }, "refreshing"]
  ])("withholds caught up for a %s snapshot", (_label, override, expectedFreshness) => {
    const result = buildAmbientNowBriefing({
      snapshot: snapshot(override),
      nowISO: NOW_ISO
    });

    expect(result.state).toBe("incomplete");
    expect(result.caughtUp.eligible).toBe(false);
    expect(result.freshness.state).toBe(expectedFreshness);
  });

  test("treats missing or failed read evidence as unknown or stale rather than caught up", () => {
    const unknown = buildAmbientNowBriefing({
      snapshot: snapshot({
        reads: {
          attention: { status: "success" },
          history: { status: "idle" },
          unreadReplies: { status: "success" }
        }
      }),
      nowISO: NOW_ISO
    });
    const failed = buildAmbientNowBriefing({
      snapshot: snapshot({
        error: "Quote history did not complete.",
        reads: {
          attention: { status: "success" },
          history: { status: "error" },
          unreadReplies: { status: "success" }
        }
      }),
      nowISO: NOW_ISO
    });

    expect(unknown.freshness.state).toBe("unknown");
    expect(unknown.caughtUp.eligible).toBe(false);
    expect(failed.freshness.state).toBe("stale");
    expect(failed.caughtUp.eligible).toBe(false);
  });

  test("withholds caught up when a declared attention count exceeds returned evidence", () => {
    const result = buildAmbientNowBriefing({
      snapshot: snapshot({
        attentionSummary: { itemCount: 2, items: [] }
      }),
      nowISO: NOW_ISO
    });

    expect(result.freshness.state).toBe("truncated");
    expect(result.caughtUp.eligible).toBe(false);
    expect(result.overflowCount).toBe(2);
  });

  test("fails closed when supplied attention cannot be normalized", () => {
    const result = buildAmbientNowBriefing({
      snapshot: snapshot({
        attentionSummary: {
          itemCount: 1,
          items: [attentionItem(1, { type: "unsupported_attention_type" })]
        }
      }),
      nowISO: NOW_ISO
    });

    expect(result.state).toBe("incomplete");
    expect(result.priorities).toEqual([]);
    expect(result.overflowCount).toBe(1);
    expect(result.caughtUp).toEqual({
      eligible: false,
      reason: "Tracked Workflow attention was supplied but could not be normalized safely."
    });
  });

  test("does not infer caught up when the attention summary is absent or its count is inconsistent", () => {
    const absent = buildAmbientNowBriefing({
      snapshot: snapshot({ attentionSummary: null }),
      nowISO: NOW_ISO
    });
    const inconsistent = buildAmbientNowBriefing({
      snapshot: snapshot({
        attentionSummary: { itemCount: 0, items: [attentionItem(1)] }
      }),
      nowISO: NOW_ISO
    });

    expect(absent.state).toBe("incomplete");
    expect(absent.caughtUp).toEqual({
      eligible: false,
      reason: "The empty Workflow attention source could not be normalized safely."
    });
    expect(inconsistent.state).toBe("incomplete");
    expect(inconsistent.bounds.attentionItemCount).toBe(1);
    expect(inconsistent.caughtUp.eligible).toBe(false);
  });

  test("projects only receipt-backed internal quiet progress and ignores customer/provider/payment state", () => {
    const result = buildAmbientNowBriefing({
      snapshot: snapshot({
        quotes: [{
          id: "quote-quiet",
          quoteNumber: "QP-QUIET",
          status: "viewed",
          workflow: {
            followUp: {
              completed: true,
              completedAtISO: "2026-08-10T12:00:00.000Z"
            },
            quoteDelivery: {
              state: "delivered",
              sentAtISO: "2026-08-11T12:00:00.000Z"
            },
            approvalRequests: [{
              id: "approval-quiet",
              state: "approved",
              resolvedAtISO: "2026-08-12T12:00:00.000Z",
              executionState: "succeeded"
            }]
          },
          payment: { depositStatus: "paid" },
          lifecycle: { viewedAtISO: "2026-08-11T13:00:00.000Z" }
        }]
      }),
      nowISO: NOW_ISO
    });

    expect(result.quietProgress.items.map((item) => item.kind)).toEqual([
      "approval_decision_recorded",
      "follow_up_completed"
    ]);
    expect(result.quietProgress.items).toHaveLength(2);
    expect(result.quietProgress.items.every((item) => (
      item.evidenceBoundary === WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY
    ))).toBe(true);
    expect(result.quietProgress.evidenceBoundary).toBe(WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY);
    expect(result.bounds.returnedQuietProgressCount).toBe(2);
    expect(result.bounds.quietProgressLimit).toBe(AMBIENT_NOW_QUIET_PROGRESS_LIMIT);
    expect(result.quietProgress.items.map((item) => item.kind)).not.toEqual(expect.arrayContaining([
      "sent",
      "delivered",
      "viewed",
      "paid"
    ]));
  });

  test("bounds quiet progress and reports receipt overflow without changing caught-up truth", () => {
    const quotes = Array.from({ length: 5 }, (_, index) => ({
      id: `quote-receipt-${index}`,
      quoteNumber: `QP-${index}`,
      status: "sent",
      workflow: {
        followUp: {
          completed: true,
          completedAtISO: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`
        }
      }
    }));
    const result = buildAmbientNowBriefing({
      snapshot: snapshot({ quotes }),
      nowISO: NOW_ISO
    });

    expect(result.quietProgress.items).toHaveLength(AMBIENT_NOW_QUIET_PROGRESS_LIMIT);
    expect(result.quietProgress.truncated).toBe(true);
    expect(result.bounds.quietProgressCandidateCount).toBe(5);
    expect(result.caughtUp.eligible).toBe(true);
  });

  test("does not mutate the source snapshot and imports no I/O or authority client", () => {
    const source = snapshot({
      attentionSummary: { itemCount: 1, items: [attentionItem(1)] },
      quotes: [{ id: "quote-1", status: "sent", workflow: {} }]
    });
    const original = structuredClone(source);
    const result = buildAmbientNowBriefing({ snapshot: source, nowISO: NOW_ISO });
    const moduleSource = readFileSync(new URL("../ambientNowBriefing.js", import.meta.url), "utf8");

    expect(source).toEqual(original);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.priorities)).toBe(true);
    expect(Object.isFrozen(result.quietProgress.items)).toBe(true);
    expect(moduleSource).not.toMatch(/firebase|httpsCallable|fetch\s*\(|XMLHttpRequest|WebSocket|openai|anthropic/iu);
  });

  test("requires an explicit timezone-bearing clock and valid IANA timezone", () => {
    expect(() => buildAmbientNowBriefing({ snapshot: snapshot() }))
      .toThrow(/timezone-bearing nowISO/i);
    expect(() => buildAmbientNowBriefing({
      snapshot: snapshot(),
      nowISO: "2026-08-12T15:00:00"
    })).toThrow(/timezone-bearing nowISO/i);
    expect(() => buildAmbientNowBriefing({
      snapshot: snapshot(),
      nowISO: NOW_ISO,
      timeZone: "Mars/Olympus_Mons"
    })).toThrow(/IANA timeZone/i);
  });
});
