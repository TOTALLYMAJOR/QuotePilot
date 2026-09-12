// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const clients = vi.hoisted(() => ({
  buildRequestId: vi.fn(() => "conversation:request-signal-test"),
  load: vi.fn(),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn()
}));

vi.mock("../../lib/firebase", () => ({
  auth: { currentUser: { uid: "staff-one" } },
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
  shouldReloadConversationForSignal
} from "../QuoteConversationPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACCESS = Object.freeze({
  accessMode: "staff",
  organizationId: "org-one",
  quoteId: "quote-one"
});

function message(messageId, createdAtISO, body, actorType = "customer") {
  return {
    messageId,
    createdAtISO,
    body,
    actorType,
    actorName: actorType === "staff" ? "Alex Staff" : "Jordan Customer"
  };
}

function result(messages) {
  return {
    organizationId: ACCESS.organizationId,
    quoteId: ACCESS.quoteId,
    portalIssuedAtISO: "2026-08-09T17:00:00.000Z",
    readOnly: false,
    readOnlyReason: "",
    messages,
    limits: {}
  };
}

function signal(latest, messageCount, metadata = {}) {
  return {
    accessMode: "staff",
    documentExists: true,
    hasConversationSummary: true,
    messageCount,
    latestMessageId: latest.messageId,
    latestMessageAtISO: latest.createdAtISO,
    latestActorType: latest.actorType,
    metadata: {
      fromCache: false,
      hasPendingWrites: false,
      source: "server",
      ...metadata
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function enterTextareaValue(textarea, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  ).set;
  valueSetter.call(textarea, value);
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
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
  clearAllConversationSessions();
  clients.subscribe.mockReturnValue(clients.unsubscribe);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("QuoteConversationPanel selected-thread signal", () => {
  test("moves through honest sync states and reloads the callable only for a newer signal", async () => {
    const first = message(
      "message-one",
      "2026-08-09T18:00:00.000Z",
      "Can we confirm the event entrance?"
    );
    const second = message(
      "message-two",
      "2026-08-09T18:05:00.000Z",
      "The west entrance is confirmed.",
      "staff"
    );
    clients.load
      .mockResolvedValueOnce(result([first]))
      .mockResolvedValueOnce(result([first, second]));

    await renderPanel();

    expect(clients.load).toHaveBeenCalledTimes(1);
    expect(clients.subscribe).toHaveBeenCalledWith(
      ACCESS,
      expect.objectContaining({
        onSignal: expect.any(Function),
        onError: expect.any(Function)
      })
    );
    expect(container.querySelector(".quote-conversation").dataset.conversationPresentation)
      .toBe("station");
    expect(container.textContent).toContain("Catching up");
    expect(container.textContent).not.toContain("Close conversation");

    const { onSignal } = clients.subscribe.mock.calls[0][1];
    act(() => onSignal(signal(first, 1, { fromCache: true, source: "cache" })));
    expect(container.textContent).toContain("May be stale");
    expect(clients.load).toHaveBeenCalledTimes(1);

    act(() => onSignal(signal(second, 2, { fromCache: true, source: "cache" })));
    await settle();
    expect(container.textContent).toContain("May be stale");
    expect(clients.load).toHaveBeenCalledTimes(1);

    act(() => onSignal(signal(first, 1)));
    expect(container.textContent).toContain("Live updates");
    expect(clients.load).toHaveBeenCalledTimes(1);

    act(() => onSignal(signal(second, 2)));
    await settle();

    expect(clients.load).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("The west entrance is confirmed.");
    expect(container.textContent).toContain("Conversation updated.");
  });

  test("keeps loaded messages visible and labels listener failure as paused", async () => {
    const first = message(
      "message-one",
      "2026-08-09T18:00:00.000Z",
      "Keep this authoritative message visible."
    );
    clients.load.mockResolvedValue(result([first]));
    await renderPanel();

    act(() => clients.subscribe.mock.calls[0][1].onError({ code: "permission-denied" }));

    expect(container.textContent).toContain("Updates paused");
    expect(container.textContent).toContain("Keep this authoritative message visible.");
    expect(clients.load).toHaveBeenCalledTimes(1);
  });

  test("does not allow a signal reload to supersede an unresolved send request", () => {
    const loadedSignal = {
      messageCount: 1,
      latestMessageId: "message-one",
      latestMessageAtISO: "2026-08-09T18:00:00.000Z"
    };
    const newerSignal = {
      messageCount: 2,
      latestMessageId: "message-two",
      latestMessageAtISO: "2026-08-09T18:05:00.000Z"
    };
    expect(shouldReloadConversationForSignal({
      open: true,
      phase: "send_error",
      pendingRequestId: "conversation:request-unresolved",
      signal: newerSignal,
      loadedSignal
    })).toBe(false);
    expect(shouldReloadConversationForSignal({
      open: true,
      phase: "ready",
      signal: newerSignal,
      loadedSignal
    })).toBe(true);
  });

  test("reloads an intervening concurrent message when the final signal matches the local receipt id", async () => {
    const first = message(
      "message-one",
      "2026-08-09T18:00:00.000Z",
      "Initial customer question."
    );
    const intervening = message(
      "message-two",
      "2026-08-09T18:04:00.000Z",
      "Concurrent customer detail."
    );
    const localReceipt = message(
      "message-three",
      "2026-08-09T18:05:00.000Z",
      "Staff response recorded after the concurrent detail.",
      "staff"
    );
    const sendAttempt = deferred();
    clients.load
      .mockResolvedValueOnce(result([first]))
      .mockResolvedValueOnce(result([first, intervening, localReceipt]));
    clients.send.mockReturnValue(sendAttempt.promise);

    await renderPanel();
    const textarea = container.querySelector("textarea");
    act(() => enterTextareaValue(textarea, localReceipt.body));
    const sendButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Send message");
    act(() => sendButton.click());
    await settle();

    const { onSignal } = clients.subscribe.mock.calls[0][1];
    act(() => onSignal(signal(localReceipt, 3)));
    expect(clients.load).toHaveBeenCalledTimes(1);

    await act(async () => {
      sendAttempt.resolve({
        message: localReceipt,
        readOnly: false,
        readOnlyReason: "",
        idempotent: false
      });
      await sendAttempt.promise;
    });
    await settle();

    expect(clients.load).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Concurrent customer detail.");
    expect(container.textContent).toContain("Staff response recorded after the concurrent detail.");
  });

  test("remounts before rendering when the tenant, quote, or portal access identity changes", async () => {
    const priorMessage = message(
      "message-private-org-one",
      "2026-08-09T18:00:00.000Z",
      "Prior tenant conversation body."
    );
    clients.load.mockResolvedValueOnce(result([priorMessage]));
    await renderPanel();

    act(() => enterTextareaValue(container.querySelector("textarea"), "Prior tenant unsent draft."));
    expect(container.textContent).toContain("Prior tenant conversation body.");

    clients.load.mockReturnValueOnce(new Promise(() => {}));
    act(() => {
      root.render(
        <QuoteConversationPanel
          access={{ ...ACCESS, organizationId: "org-two" }}
          defaultOpen
          presentation="station"
          showCloseAction={false}
        />
      );
    });

    expect(container.textContent).not.toContain("Prior tenant conversation body.");
    expect(container.querySelector("textarea")?.value || "").not.toContain("Prior tenant unsent draft.");
    expect(container.textContent).toContain("Loading conversation...");
  });
});
