// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const clients = vi.hoisted(() => ({
  load: vi.fn(),
  send: vi.fn(),
  subscribe: vi.fn(() => vi.fn())
}));

vi.mock("../../lib/firebase", () => ({
  auth: { currentUser: { uid: "staff-focus" } },
  db: { id: "firestore" },
  firebaseReady: true
}));

vi.mock("../../lib/portalConversationClient", () => ({
  PORTAL_CONVERSATION_BODY_MAX_LENGTH: 1200,
  buildPortalConversationClientRequestId: vi.fn(() => "conversation:focus-test"),
  loadQuotePortalConversation: clients.load,
  sendQuotePortalConversationMessage: clients.send
}));

vi.mock("../../lib/conversationSignalClient", async () => {
  const actual = await vi.importActual("../../lib/conversationSignalClient");
  return { ...actual, subscribeToConversationSignal: clients.subscribe };
});

import QuoteConversationPanel, {
  buildConversationMessageFocusResolution
} from "../QuoteConversationPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACCESS = Object.freeze({
  accessMode: "staff",
  organizationId: "org-focus",
  quoteId: "quote-focus"
});

function message(messageId, actorType, body) {
  return {
    messageId,
    actorType,
    actorName: actorType === "customer" ? "Jordan Customer" : "Alex Staff",
    body,
    createdAtISO: "2026-08-12T12:00:00.000Z"
  };
}

function result(messages, quoteId = ACCESS.quoteId) {
  return {
    organizationId: ACCESS.organizationId,
    quoteId,
    portalIssuedAtISO: "2026-08-12T11:00:00.000Z",
    readOnly: false,
    readOnlyReason: "",
    messages,
    limits: {}
  };
}

let container;
let root;
let originalScrollIntoView;
let scrollIntoViewMock;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  });
}

async function renderPanel(props = {}) {
  act(() => {
    root.render(
      <QuoteConversationPanel
        access={ACCESS}
        defaultOpen
        presentation="station"
        showCloseAction={false}
        {...props}
      />
    );
  });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  clients.subscribe.mockReturnValue(vi.fn());
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  scrollIntoViewMock = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

describe("QuoteConversationPanel exact customer-message focus", () => {
  test("resolves only after the exact customer reply is loaded, scrolled, and focused", async () => {
    const customerReply = message(
      "message-customer-focus",
      "customer",
      "Could we move dinner service to 7:30?"
    );
    clients.load.mockResolvedValue(result([
      message("message-staff-first", "staff", "I will check the run of show."),
      customerReply
    ]));
    const onFocusResolution = vi.fn();

    await renderPanel({
      focusMessageId: customerReply.messageId,
      onFocusResolution
    });

    const messageBody = [...container.querySelectorAll(".quote-conversation-message p")]
      .find((node) => node.textContent === customerReply.body);
    const target = messageBody.closest("article");
    expect(target.tabIndex).toBe(-1);
    await settle();
    expect(onFocusResolution).toHaveBeenCalledTimes(1);
    expect(onFocusResolution).toHaveBeenCalledWith({
      status: "resolved",
      kind: "resolved",
      code: "customer_message_focused",
      quoteId: ACCESS.quoteId,
      messageId: customerReply.messageId,
      actorType: "customer",
      reason: "The exact customer reply is present in the loaded quote-scoped thread.",
      consequence: "The message is focused for review; nothing was sent and no read state changed.",
      nextResolution: "Review the focused reply and choose an available communication action."
    });
    expect(document.activeElement).toBe(target);
    expect(target.dataset.arrivalFocus).toBe("resolved");
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest"
    });
    expect(clients.send).not.toHaveBeenCalled();
  });

  test("truthfully recovers when the exact message is absent without focusing a substitute", async () => {
    clients.load.mockResolvedValue(result([
      message("message-different", "customer", "A different customer reply.")
    ]));
    const onFocusResolution = vi.fn();

    await renderPanel({
      focusMessageId: "message-customer-missing",
      onFocusResolution
    });

    expect(onFocusResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "recovery",
      code: "customer_message_not_found",
      quoteId: ACCESS.quoteId,
      messageId: "message-customer-missing",
      consequence: expect.stringMatching(/nothing was sent and no read state changed/i)
    }));
    expect(container.querySelector('[data-message-focus-state="recovery"]')).toBeTruthy();
    expect(container.textContent).toContain("No other message was substituted");
    expect(container.querySelector('[data-arrival-focus]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(clients.send).not.toHaveBeenCalled();
  });

  test("rejects a staff-authored identity and a mismatched loaded thread", () => {
    const staffMessage = message("message-staff", "staff", "Staff update.");
    expect(buildConversationMessageFocusResolution({
      expectedQuoteId: ACCESS.quoteId,
      loadedQuoteId: ACCESS.quoteId,
      focusMessageId: staffMessage.messageId,
      messages: [staffMessage]
    })).toMatchObject({
      status: "recovery",
      code: "message_is_not_customer_reply"
    });
    expect(buildConversationMessageFocusResolution({
      expectedQuoteId: ACCESS.quoteId,
      loadedQuoteId: "quote-other",
      focusMessageId: "message-customer-focus",
      messages: [message("message-customer-focus", "customer", "Private body")]
    })).toMatchObject({
      status: "recovery",
      code: "thread_identity_mismatch"
    });
  });
});

describe("QuoteConversationPanel exact thread body-load receipt", () => {
  test("keeps a general thread arrival pending until canonical bodies load, then reports ready", async () => {
    let resolveLoad;
    clients.load.mockReturnValue(new Promise((resolve) => {
      resolveLoad = resolve;
    }));
    const onLoadResolution = vi.fn();

    await renderPanel({ onLoadResolution });

    expect(onLoadResolution).toHaveBeenCalledWith({
      status: "pending",
      quoteId: ACCESS.quoteId
    });
    expect(onLoadResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "ready"
    }));

    await act(async () => {
      resolveLoad(result([
        message("message-customer-loaded", "customer", "The canonical body is loaded.")
      ]));
      await Promise.resolve();
    });
    await settle();

    expect(onLoadResolution).toHaveBeenLastCalledWith({
      status: "ready",
      quoteId: ACCESS.quoteId
    });
    expect(clients.send).not.toHaveBeenCalled();
  });

  test("reports recovery when canonical conversation bodies fail to load", async () => {
    clients.load.mockRejectedValue(new Error("Conversation body service is unavailable."));
    const onLoadResolution = vi.fn();

    await renderPanel({ onLoadResolution });

    expect(onLoadResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "recovery",
      code: "exact_thread_unavailable",
      quoteId: ACCESS.quoteId,
      consequence: expect.stringMatching(/nothing was sent and no read state changed/i)
    }));
    expect(onLoadResolution).not.toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
    expect(clients.send).not.toHaveBeenCalled();
  });

  test("reports recovery instead of accepting bodies returned for another quote", async () => {
    clients.load.mockResolvedValue(result([
      message("message-customer-other", "customer", "A body from another quote.")
    ], "quote-other"));
    const onLoadResolution = vi.fn();

    await renderPanel({ onLoadResolution });

    expect(onLoadResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "recovery",
      code: "thread_identity_mismatch",
      quoteId: ACCESS.quoteId,
      consequence: expect.stringMatching(/No other conversation was substituted/i)
    }));
    expect(container.textContent).not.toContain("A body from another quote.");
    expect(clients.send).not.toHaveBeenCalled();
  });
});
