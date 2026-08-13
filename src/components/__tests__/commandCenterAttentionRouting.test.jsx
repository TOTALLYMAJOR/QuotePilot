// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CommandCenterHome from "../CommandCenterHome";
import NowView from "../NowView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Command Center central Attention routing", () => {
  function attentionItems(count) {
    return Array.from({ length: count }, (_, index) => ({
      id: `follow-up:quote-${index}`,
      type: "follow_up",
      state: "due_today",
      quoteId: `quote-${index}`,
      daysOverdue: 0
    }));
  }

  function quoteItems(count) {
    return Array.from({ length: count }, (_, index) => ({
      id: `quote-${index}`,
      quoteNumber: `QP-${index}`,
      status: "sent",
      customer: { name: `Customer ${index}` },
      event: {}
    }));
  }

  test("routes an unread customer reply with its exact quote and Attention identity", () => {
    const onOpenWorkflow = vi.fn();
    act(() => {
      root.render(
        <CommandCenterHome
          snapshot={{
            loading: false,
            error: "",
            source: "firebase",
            loadedAt: 1,
            partial: false,
            stale: false,
            truncated: false,
            truncationKnown: true,
            reads: {
              attention: { status: "success" },
              history: { status: "success" },
              unreadReplies: { status: "success" }
            },
            attentionSummary: {
              quoteCount: 1,
              itemCount: 1,
              counts: { unreadCustomerReplies: 1 },
              items: [{
                id: "unread-reply:attention-reply-1",
                type: "unread_customer_reply",
                state: "open",
                quoteId: "quote-reply-1",
                attentionId: "attention-reply-1",
                messageId: "message-reply-1",
                sourceRequestId: "attention-reply-1"
              }]
            },
            quotes: [{
              id: "quote-reply-1",
              customerId: "customer-reply-1",
              quoteNumber: "QP-REPLY-1",
              customer: { name: "Henderson Industries" },
              status: "sent",
              event: {}
            }]
          }}
          organizationId="org-one"
          onRefresh={() => {}}
          onOpenWorkflow={onOpenWorkflow}
          onOpenQuote={() => {}}
          onOpenCustomer={() => {}}
          onNewQuote={() => {}}
        />
      );
    });

    expect(container.querySelector('[data-capability-id="cwf-12-central-attention"]')).toBeTruthy();
    expect(container.textContent).toContain("Unread customer reply");
    expect(container.textContent).toContain("waiting in the quote conversation");
    const workflowButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Open in Workflow");
    act(() => workflowButton.click());

    expect(onOpenWorkflow).toHaveBeenCalledWith({
      quoteId: "quote-reply-1",
      attentionType: "unread_customer_reply",
      requestId: "attention-reply-1"
    });
  });

  test("opens the stable customer record for an anniversary cue without creating a draft", () => {
    const onOpenCustomer = vi.fn();
    const onOpenWorkflow = vi.fn();
    act(() => {
      root.render(
        <CommandCenterHome
          snapshot={{
            loading: false,
            error: "",
            source: "firebase",
            loadedAt: 1,
            partial: false,
            stale: false,
            truncated: true,
            truncationKnown: true,
            reads: {
              attention: { status: "success" },
              history: { status: "success" },
              unreadReplies: { status: "success" }
            },
            attentionSummary: {
              quoteCount: 1,
              itemCount: 1,
              counts: { anniversaryRebookings: 1 },
              items: [{
                id: "anniversary-rebooking:quote-picnic:2025-08-05",
                type: "anniversary_rebooking",
                state: "verification_required",
                quoteId: "quote-picnic",
                customerId: "customer-henderson",
                sourceRequestId: "anniversary-rebooking:quote-picnic:2025-08-05",
                eventName: "Henderson corporate picnic",
                sourceBound: { quoteLimit: 200, truncated: true }
              }]
            },
            quotes: [{
              id: "quote-picnic",
              customerId: "customer-henderson",
              quoteNumber: "QP-PICNIC",
              customer: { name: "Henderson Industries" },
              status: "booked",
              event: { name: "Henderson corporate picnic", date: "2025-08-05" }
            }]
          }}
          organizationId="org-one"
          onRefresh={() => {}}
          onOpenWorkflow={onOpenWorkflow}
          onOpenQuote={() => {}}
          onOpenCustomer={onOpenCustomer}
          onNewQuote={() => {}}
        />
      );
    });

    const cue = container.querySelector('[data-capability-id="cwf-11-central-anniversary-attention"]');
    expect(cue).toBeTruthy();
    expect(cue.getAttribute("data-capability-state")).toBe("verification_required");
    expect(cue.textContent).toContain("Henderson corporate picnic was booked this week last year");
    expect(cue.textContent).toContain("history scan is incomplete");
    const reviewButton = container.querySelector('[data-capability-action="open-exact-version-rebook-review"]');
    expect(reviewButton.textContent).toBe("Review rebook");
    act(() => reviewButton.click());

    expect(onOpenCustomer).toHaveBeenCalledWith("customer-henderson");
    expect(onOpenWorkflow).not.toHaveBeenCalled();
  });

  test("reveals Command Center overflow in place under Ambient without a generic Workflow jump", () => {
    const onOpenWorkflow = vi.fn();
    const items = attentionItems(10);
    act(() => {
      root.render(
        <CommandCenterHome
          ambientMode
          snapshot={{
            loading: false,
            error: "",
            attentionSummary: { items },
            quotes: quoteItems(10),
            truncated: false
          }}
          onOpenWorkflow={onOpenWorkflow}
          onOpenQuote={() => {}}
          onNewQuote={() => {}}
        />
      );
    });

    expect(container.querySelectorAll(".command-center-inbox .command-center-row")).toHaveLength(8);
    const disclosure = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Show 2 more here");
    expect(disclosure?.getAttribute("aria-expanded")).toBe("false");
    act(() => disclosure.click());
    expect(container.querySelectorAll(".command-center-inbox .command-center-row")).toHaveLength(10);
    expect(disclosure.textContent).toBe("Show fewer attention items");
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(onOpenWorkflow).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <CommandCenterHome
          snapshot={{
            loading: false,
            error: "",
            attentionSummary: { items },
            quotes: quoteItems(10),
            truncated: false
          }}
          onOpenWorkflow={onOpenWorkflow}
          onOpenQuote={() => {}}
          onNewQuote={() => {}}
        />
      );
    });
    const legacyAction = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "View 2 more in Workflow");
    act(() => legacyAction.click());
    expect(onOpenWorkflow).toHaveBeenCalledWith({});
  });

  test("reveals NOW overflow in place under Ambient while retaining the legacy route behavior", () => {
    const items = attentionItems(8);
    const quotes = quoteItems(8);
    const onOpenWorkflow = vi.fn();
    act(() => {
      root.render(
        <NowView
          ambientMode
          snapshot={{
            loading: false,
            error: "",
            attentionSummary: { items },
            quotes,
            truncated: false
          }}
          onOpenWorkflow={onOpenWorkflow}
          onNewQuote={() => {}}
          nowDate={new Date("2026-08-12T12:00:00.000Z")}
        />
      );
    });

    expect(container.querySelectorAll(".now-card")).toHaveLength(6);
    const disclosure = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Show 2 more here");
    act(() => disclosure.click());
    expect(container.querySelectorAll(".now-card")).toHaveLength(8);
    expect(onOpenWorkflow).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <NowView
          snapshot={{
            loading: false,
            error: "",
            attentionSummary: { items },
            quotes,
            truncated: false
          }}
          onOpenWorkflow={onOpenWorkflow}
          onNewQuote={() => {}}
          nowDate={new Date("2026-08-12T12:00:00.000Z")}
        />
      );
    });
    const legacyAction = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "View 2 more in Workflow");
    act(() => legacyAction.click());
    expect(onOpenWorkflow).toHaveBeenCalledWith({});
  });
});
