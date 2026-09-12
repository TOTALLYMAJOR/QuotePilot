// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const clients = vi.hoisted(() => ({
  buildRequestId: vi.fn(() => "conversation:request-prefill-test"),
  load: vi.fn(),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn()
}));

vi.mock("../../lib/firebase", () => ({
  auth: { currentUser: { uid: "staff-prefill" } },
  db: { id: "firestore" },
  firebaseReady: true
}));

vi.mock("../../lib/portalConversationClient", () => ({
  PORTAL_CONVERSATION_BODY_MAX_LENGTH: 1200,
  buildPortalConversationClientRequestId: clients.buildRequestId,
  sendQuotePortalConversationMessage: clients.send
}));

vi.mock("../conversationSessionCache", () => ({
  loadConversationAuthoritatively: clients.load,
  readConversationSession: vi.fn(() => null),
  writeConversationSession: vi.fn(() => true),
  clearAllConversationSessions: vi.fn()
}));

vi.mock("../../lib/conversationSignalClient", async () => {
  const actual = await vi.importActual("../../lib/conversationSignalClient");
  return {
    ...actual,
    subscribeToConversationSignal: clients.subscribe
  };
});

import { clearAllConversationSessions } from "../conversationSessionCache";
import QuoteConversationPanel, {
  beginConversationPendingAttempt,
  clearConversationPendingAttempt,
  markConversationPendingAttemptError
} from "../QuoteConversationPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACCESS = Object.freeze({
  accessMode: "staff",
  organizationId: "org-prefill",
  quoteId: "quote-prefill"
});
const IDENTITY = "staff:org-prefill:quote-prefill::staff-prefill";

function emptyResult() {
  return {
    organizationId: ACCESS.organizationId,
    quoteId: ACCESS.quoteId,
    portalIssuedAtISO: "2026-08-11T09:00:00.000Z",
    readOnly: false,
    readOnlyReason: "",
    messages: [],
    limits: {}
  };
}

let container;
let root;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function renderPanel(props = {}) {
  act(() => {
    root.render(<QuoteConversationPanel access={ACCESS} {...props} />);
  });
  await settle();
}

function enterTextareaValue(textarea, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  ).set;
  valueSetter.call(textarea, value);
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAllConversationSessions();
  clients.subscribe.mockReturnValue(clients.unsubscribe);
  clients.load.mockResolvedValue(emptyResult());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("QuoteConversationPanel prefill", () => {
  test("a prefill request opens the closed panel and seeds the empty composer", async () => {
    const onPrefillResolution = vi.fn();
    await renderPanel();
    expect(container.querySelector(".quote-conversation-launch")).toBeTruthy();
    expect(container.querySelector("textarea")).toBeNull();

    await renderPanel({
      prefill: { id: 1, text: "Question about the pricing: " },
      onPrefillResolution
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe("Question about the pricing: ");
    expect(textarea).toBe(document.activeElement);
    expect(onPrefillResolution).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      status: "staged"
    }));
    expect(clients.load).toHaveBeenCalledTimes(1);
  });

  test("a prefill request never overwrites a draft the user already typed", async () => {
    const onPrefillResolution = vi.fn();
    await renderPanel({ defaultOpen: true });
    const textarea = container.querySelector("textarea");
    act(() => enterTextareaValue(textarea, "My own carefully typed question."));

    await renderPanel({
      defaultOpen: true,
      prefill: { id: 2, text: "Question about the event details: " },
      onPrefillResolution
    });

    expect(container.querySelector("textarea").value)
      .toBe("My own carefully typed question.");
    expect(onPrefillResolution).toHaveBeenCalledWith(expect.objectContaining({
      id: 2,
      status: "preserved_draft"
    }));
  });

  test("a prefill request never disturbs an unresolved send attempt", async () => {
    const onPrefillResolution = vi.fn();
    const attempt = beginConversationPendingAttempt({
      identity: IDENTITY,
      body: "Unresolved message awaiting exact reconciliation.",
      createRequestId: () => "conversation:request-unresolved"
    });
    markConversationPendingAttemptError({
      identity: IDENTITY,
      clientRequestId: attempt.clientRequestId,
      error: "Connection closed before a receipt returned."
    });

    try {
      await renderPanel({
        defaultOpen: true,
        prefill: { id: 3, text: "Question about the pricing: " },
        onPrefillResolution
      });

      const textarea = container.querySelector("textarea");
      expect(textarea.value).toBe("Unresolved message awaiting exact reconciliation.");
      expect(textarea.disabled).toBe(true);
      expect(container.textContent).toContain("Reconcile message");
      expect(onPrefillResolution).toHaveBeenCalledWith(expect.objectContaining({
        id: 3,
        status: "pending_attempt"
      }));
    } finally {
      clearConversationPendingAttempt({
        identity: IDENTITY,
        clientRequestId: attempt.clientRequestId,
        resolution: "safe_reset"
      });
    }
  });

  test("waits for conversation evidence and reports a read-only boundary instead of staging text", async () => {
    const onPrefillResolution = vi.fn();
    clients.load.mockResolvedValue({
      ...emptyResult(),
      readOnly: true,
      readOnlyReason: "This proposal conversation is closed."
    });

    await renderPanel({
      defaultOpen: true,
      prefill: { id: 4, text: "Question about the terms: " },
      onPrefillResolution
    });

    expect(container.querySelector("textarea")).toBeNull();
    expect(onPrefillResolution).toHaveBeenCalledWith({
      id: 4,
      status: "read_only",
      message: "This proposal conversation is closed."
    });
  });
});
