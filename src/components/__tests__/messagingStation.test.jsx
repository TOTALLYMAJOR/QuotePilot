import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildMessagingSyncPresentation,
  MessagingStationCapabilitySurface,
  resolveMessagingArrivalConsumption,
  resolveMessagingStationState
} from "../MessagingStation";

describe("messaging station capability states", () => {
  test.each([
    [{ inboxStatus: "connecting", threads: [] }, "loading"],
    [{ inboxStatus: "error", threads: [] }, "error"],
    [{ inboxStatus: "ready", threads: [] }, "empty"],
    [{ inboxStatus: "ready", threads: [{ quoteId: "q-1" }] }, "success"],
    [{ inboxStatus: "connecting", threads: [{ quoteId: "q-1" }] }, "stale"],
    [{ inboxStatus: "ready", inboxStale: true, threads: [{ quoteId: "q-1" }] }, "stale"],
    [{ inboxStatus: "stale", inboxError: "Listener stopped", threads: [{ quoteId: "q-1" }] }, "partial"],
    [{ inboxStatus: "recovering", threads: [{ quoteId: "q-1" }] }, "recovery"]
  ])("maps source state to an explicit capability state", (input, expected) => {
    expect(resolveMessagingStationState(input)).toBe(expected);
  });

  test("labels the hook's retained-data listener failure as paused", () => {
    expect(buildMessagingSyncPresentation({ status: "stale", stale: true, error: "Listener stopped" }))
      .toEqual({ label: "Updates paused", tone: "paused" });
  });

  test("renders all canonical messaging read states through the station surface", () => {
    const renderState = (state) => renderToStaticMarkup(
      <MessagingStationCapabilitySurface state={state}>State</MessagingStationCapabilitySurface>
    );

    expect(renderState("loading")).toContain('data-capability-state="loading"');
    expect(renderState("empty")).toContain('data-capability-state="empty"');
    expect(renderState("success")).toContain('data-capability-state="success"');
    expect(renderState("stale")).toContain('data-capability-state="stale"');
    expect(renderState("partial")).toContain('data-capability-state="partial"');
    expect(renderState("error")).toContain('data-capability-state="error"');
    expect(renderState("recovery")).toContain('data-capability-state="recovery"');
  });

  test("requires the exact requested thread and never substitutes the first conversation", () => {
    const threads = [{
      quoteId: "quote-first",
      conversationAvailable: true
    }];
    expect(resolveMessagingArrivalConsumption({
      active: true,
      quoteId: "quote-stale",
      inboxStatus: "ready",
      inboxBounded: false,
      threads,
      selectedQuoteId: "quote-first"
    })).toMatchObject({
      status: "recovery",
      consequence: expect.stringMatching(/No first-listed or similar conversation was substituted/i)
    });
  });

  test("distinguishes pending, unavailable, and exactly selected conversation arrivals", () => {
    expect(resolveMessagingArrivalConsumption({
      active: true,
      quoteId: "quote-42",
      inboxStatus: "connecting"
    })).toEqual({ status: "pending" });

    expect(resolveMessagingArrivalConsumption({
      active: true,
      quoteId: "quote-42",
      inboxStatus: "stale",
      inboxStale: true,
      threads: [{ quoteId: "quote-42", conversationAvailable: true }],
      selectedQuoteId: "quote-42"
    })).toMatchObject({
      status: "recovery",
      consequence: expect.stringMatching(/No retained conversation was treated as current/i)
    });

    expect(resolveMessagingArrivalConsumption({
      active: true,
      quoteId: "quote-42",
      inboxStatus: "ready",
      threads: [{
        quoteId: "quote-42",
        conversationAvailable: false,
        unavailableReason: "Deliver the current proposal before messaging."
      }],
      selectedQuoteId: "quote-42"
    })).toMatchObject({
      status: "recovery",
      reason: "Deliver the current proposal before messaging."
    });

    const thread = { quoteId: "quote-42", conversationAvailable: true };
    expect(resolveMessagingArrivalConsumption({
      active: true,
      quoteId: "quote-42",
      inboxStatus: "ready",
      threads: [thread],
      selectedQuoteId: "quote-42"
    })).toEqual({ status: "ready", thread });
  });
});
