// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({
  inbox: null,
  panelProps: null
}));

vi.mock("../../hooks/useConversationInbox", () => ({
  useConversationInbox: () => harness.inbox
}));

vi.mock("../../hooks/useWorkspaceRouteHeadingFocus", () => ({
  useWorkspaceRouteHeadingFocus: () => ({ current: null })
}));

vi.mock("../QuoteConversationPanel", () => ({
  default: (props) => {
    harness.panelProps = props;
    return <button type="button" data-testid="exact-message-target">Exact message target</button>;
  }
}));

import MessagingStation from "../MessagingStation";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUOTE_ID = "quote-arrival";
const THREAD = Object.freeze({
  quoteId: QUOTE_ID,
  quoteNumber: "QP-1042",
  eventName: "River Garden Dinner",
  customerName: "Jordan Customer",
  eventDate: "2026-09-14",
  eventTime: "18:00",
  venue: "River Garden",
  status: "draft",
  total: 12800,
  messageCount: 2,
  conversationAvailable: true,
  needsReply: true,
  latestMessageAtISO: "2026-08-12T12:00:00.000Z"
});

let container;
let root;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  });
}

async function renderStation({
  focus = { quoteId: QUOTE_ID },
  arrivalContext = { surfaceId: "conversation", focus },
  onArrivalResolution = vi.fn()
} = {}) {
  act(() => {
    root.render(
      <MessagingStation
        organizationId="org-arrival"
        initialQuoteId={QUOTE_ID}
        arrivalContext={arrivalContext}
        arrivalAttempted
        onArrivalResolution={onArrivalResolution}
      />
    );
  });
  await settle();
  return onArrivalResolution;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.panelProps = null;
  harness.inbox = {
    status: "ready",
    stale: false,
    error: "",
    bounded: true,
    source: "firebase-live",
    threads: [THREAD],
    retry: vi.fn()
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MessagingStation exact arrival consumption", () => {
  test("does not open even an existing query thread when its Ambient arrival state was rejected", async () => {
    await renderStation({ arrivalContext: null });

    expect(container.querySelector('.messaging-thread-row[aria-current="page"]')).toBeNull();
    expect(harness.panelProps).toBeNull();
    expect(container.textContent).toContain("Select an event conversation");
  });

  test("keeps a general conversation pending until the panel proves body load, then focuses and resolves the exact heading", async () => {
    const onArrivalResolution = await renderStation();
    const heading = [...container.querySelectorAll("h2")]
      .find((node) => node.textContent === THREAD.eventName);

    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "pending",
      focus: { quoteId: QUOTE_ID }
    }));
    expect(document.activeElement).not.toBe(heading);
    expect(harness.panelProps.onLoadResolution).toBeTypeOf("function");

    act(() => {
      harness.panelProps.onLoadResolution({ status: "ready", quoteId: QUOTE_ID });
    });
    await settle();

    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "resolved",
      itemId: QUOTE_ID,
      focus: { quoteId: QUOTE_ID }
    }));
    expect(document.activeElement).toBe(heading);
  });

  test("propagates body-load recovery without focusing or substituting another thread", async () => {
    const onArrivalResolution = await renderStation();
    const heading = [...container.querySelectorAll("h2")]
      .find((node) => node.textContent === THREAD.eventName);

    act(() => {
      harness.panelProps.onLoadResolution({
        status: "recovery",
        code: "exact_thread_unavailable",
        quoteId: QUOTE_ID,
        reason: "The exact quote-scoped conversation could not be loaded.",
        consequence: "No other conversation was substituted; nothing was sent and no read state changed.",
        nextResolution: "Retry the exact conversation before reviewing or replying."
      });
    });
    await settle();

    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "recovery",
      code: "exact_thread_unavailable",
      focus: { quoteId: QUOTE_ID }
    }));
    expect(document.activeElement).not.toBe(heading);
  });

  test("gives exact-message focus and resolution exclusively to QuoteConversationPanel", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const onArrivalResolution = await renderStation({
      focus: { quoteId: QUOTE_ID, messageId: "message-customer-exact" }
    });
    const heading = [...container.querySelectorAll("h2")]
      .find((node) => node.textContent === THREAD.eventName);

    expect(harness.panelProps.onLoadResolution).toBeNull();
    expect(harness.panelProps.focusMessageId).toBe("message-customer-exact");
    expect(harness.panelProps.onFocusResolution).toBeTypeOf("function");
    expect(focusSpy.mock.instances).not.toContain(heading);
    expect(document.activeElement).not.toBe(heading);

    const messageTarget = container.querySelector('[data-testid="exact-message-target"]');
    act(() => {
      messageTarget.focus();
      harness.panelProps.onFocusResolution({
        status: "resolved",
        code: "customer_message_focused",
        quoteId: QUOTE_ID,
        messageId: "message-customer-exact"
      });
    });
    await settle();

    expect(document.activeElement).toBe(messageTarget);
    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "resolved",
      messageId: "message-customer-exact",
      focus: { quoteId: QUOTE_ID, messageId: "message-customer-exact" }
    }));
    expect(focusSpy.mock.instances).not.toContain(heading);
    focusSpy.mockRestore();
  });
});
