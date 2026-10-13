import { describe, expect, test, vi } from "vitest";
import {
  messagingNow,
  recordMessagingPerformanceMilestone
} from "../messagingPerformance";

describe("messaging performance observations", () => {
  test("emits only aggregate bounded timing and count evidence", () => {
    const dispatchEvent = vi.fn();
    const measure = vi.fn();
    class TestCustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    }
    const runtime = {
      performance: { now: () => 42.5, measure },
      dispatchEvent,
      CustomEvent: TestCustomEvent
    };

    expect(messagingNow(runtime)).toBe(42.5);
    const detail = recordMessagingPerformanceMilestone({
      milestone: "thread_interactive",
      durationMs: 312.345,
      threadCount: 12,
      messageCount: 50,
      quoteId: "must-not-escape"
    }, runtime);

    expect(detail).toEqual({
      schemaVersion: 1,
      milestone: "thread_interactive",
      durationMs: 312.3,
      threadCount: 12,
      messageCount: 50
    });
    expect(JSON.stringify(detail)).not.toContain("must-not-escape");
    expect(measure).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({
      type: "quotepilot:messaging-performance",
      detail
    });
  });

  test("rejects unknown milestones and bounds untrusted numeric dimensions", () => {
    expect(recordMessagingPerformanceMilestone({ milestone: "quote-opened" }, {})).toBeNull();
    expect(recordMessagingPerformanceMilestone({
      milestone: "inbox_visible",
      durationMs: Infinity,
      threadCount: 99_999,
      messageCount: -1
    }, {})).toMatchObject({ durationMs: 0, threadCount: 10_000, messageCount: 0 });
  });

  test("records bounded delta catch-up duration without thread identity", () => {
    const detail = recordMessagingPerformanceMilestone({
      milestone: "thread_caught_up",
      durationMs: 84.26,
      messageCount: 2,
      portalKey: "must-not-escape"
    }, {});
    expect(detail).toEqual({
      schemaVersion: 1,
      milestone: "thread_caught_up",
      durationMs: 84.3,
      threadCount: 0,
      messageCount: 2
    });
    expect(JSON.stringify(detail)).not.toContain("must-not-escape");
  });
});
