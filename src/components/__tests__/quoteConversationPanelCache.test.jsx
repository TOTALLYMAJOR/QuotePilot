// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const clients = vi.hoisted(() => ({
  load: vi.fn(),
  send: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  memory: new Map()
}));

vi.mock("../../lib/firebase", () => ({
  auth: { currentUser: { uid: "staff-cache" } },
  db: { id: "firestore" },
  firebaseReady: true
}));

vi.mock("../../lib/portalConversationClient", () => ({
  PORTAL_CONVERSATION_BODY_MAX_LENGTH: 1200,
  buildPortalConversationClientRequestId: vi.fn(() => "conversation:cache-test"),
  sendQuotePortalConversationMessage: clients.send
}));

vi.mock("../conversationSessionCache", () => ({
  loadConversationAuthoritatively: clients.load,
  readConversationSession: vi.fn((access) => clients.memory.get(access?.quoteId) || null),
  writeConversationSession: vi.fn((access, value) => {
    clients.memory.set(access?.quoteId, structuredClone(value));
    return true;
  }),
  clearAllConversationSessions: vi.fn(() => clients.memory.clear())
}));

vi.mock("../../lib/conversationSignalClient", async () => {
  const actual = await vi.importActual("../../lib/conversationSignalClient");
  return { ...actual, subscribeToConversationSignal: clients.subscribe };
});

import {
  clearAllConversationSessions,
  writeConversationSession
} from "../conversationSessionCache";
import QuoteConversationPanel from "../QuoteConversationPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACCESS = Object.freeze({
  accessMode: "staff",
  organizationId: "org-cache",
  quoteId: "quote-cache"
});

function message(messageId, body, createdAtISO) {
  return {
    messageId,
    actorType: "customer",
    actorName: "Jordan Customer",
    body,
    createdAtISO
  };
}

function result(messages) {
  return {
    organizationId: ACCESS.organizationId,
    quoteId: ACCESS.quoteId,
    portalIssuedAtISO: "2026-09-12T04:00:00.000Z",
    readOnly: false,
    readOnlyReason: "",
    messages,
    limits: {}
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let container;
let root;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAllConversationSessions();
  clients.subscribe.mockReturnValue(vi.fn());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearAllConversationSessions();
});

describe("QuoteConversationPanel memory-backed revisit", () => {
  test("renders a recent cached thread immediately while authoritative refresh is still pending", async () => {
    const cached = message(
      "message-cached",
      "This message should be visible immediately.",
      "2026-09-12T04:05:00.000Z"
    );
    writeConversationSession(ACCESS, result([cached]));

    const authoritative = deferred();
    clients.load.mockReturnValue(authoritative.promise);

    act(() => {
      root.render(
        <QuoteConversationPanel
          access={ACCESS}
          defaultOpen
          presentation="station"
          showCloseAction={false}
        />
      );
    });
    await settle();

    expect(container.textContent).toContain(cached.body);
    expect(container.textContent).not.toContain("Loading conversation...");
    expect(container.textContent).toContain("Refreshing...");
    expect(clients.load).toHaveBeenCalledTimes(1);

    const current = message(
      "message-current",
      "Authoritative refresh added this message.",
      "2026-09-12T04:06:00.000Z"
    );
    await act(async () => {
      authoritative.resolve(result([cached, current]));
      await authoritative.promise;
    });
    await settle();

    expect(container.textContent).toContain(cached.body);
    expect(container.textContent).toContain(current.body);
    expect(container.textContent).not.toContain("Refreshing...");
  });
});
