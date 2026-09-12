import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  cloudFunctions: { id: "functions" },
  auth: { currentUser: { uid: "staff-1" } }
}));

vi.mock("firebase/functions", () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock("../firebase", () => ({
  auth: mocks.auth,
  cloudFunctions: mocks.cloudFunctions,
  firebaseReady: true
}));

import {
  clearAllConversationMemory,
  conversationMemoryPolicy,
  loadQuotePortalConversation,
  readConversationMemory,
  sendQuotePortalConversationMessage,
  warmConversationMemory,
  writeConversationMemory
} from "../portalConversationClient";

const PORTAL_KEY = "portal-conversation-token-1234567890";
const STAFF_ACCESS = {
  accessMode: "staff",
  organizationId: "org-a",
  quoteId: "quote-a"
};
const RESPONSE = {
  ok: true,
  organizationId: "org-a",
  quoteId: "quote-a",
  portalIssuedAtISO: "2026-08-06T17:00:00.000Z",
  readOnly: false,
  messages: [],
  limits: {}
};
const CACHED_RESULT = {
  organizationId: "org-a",
  quoteId: "quote-a",
  portalIssuedAtISO: "2026-08-06T17:00:00.000Z",
  readOnly: false,
  readOnlyReason: "",
  messages: [{
    messageId: "message-1",
    actorType: "customer",
    actorName: "Jordan Customer",
    body: "Hello",
    createdAtISO: "2026-08-06T18:00:00.000Z"
  }],
  limits: {}
};

describe("portal conversation callable client", () => {
  beforeEach(() => {
    clearAllConversationMemory();
    mocks.callable.mockReset();
    mocks.httpsCallable.mockReset();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.auth.currentUser = { uid: "staff-1" };
  });

  test("loads customer history using only the bearer portal token", async () => {
    mocks.callable.mockResolvedValue({ data: RESPONSE });
    await expect(loadQuotePortalConversation({
      accessMode: "portal",
      portalKey: PORTAL_KEY
    })).resolves.toMatchObject({ organizationId: "org-a", messages: [] });
    expect(mocks.httpsCallable).toHaveBeenCalledWith(
      mocks.cloudFunctions,
      "getQuotePortalConversation"
    );
    expect(mocks.callable).toHaveBeenCalledWith({
      accessMode: "portal",
      portalKey: PORTAL_KEY
    });
  });

  test("loads staff history with exact tenant and quote scope", async () => {
    mocks.callable.mockResolvedValue({ data: RESPONSE });
    await loadQuotePortalConversation(STAFF_ACCESS);
    expect(mocks.callable).toHaveBeenCalledWith(STAFF_ACCESS);
  });

  test("coalesces concurrent reads for the same authenticated conversation", async () => {
    let release;
    mocks.callable.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ data: RESPONSE });
    }));

    const first = loadQuotePortalConversation(STAFF_ACCESS);
    const second = loadQuotePortalConversation({ ...STAFF_ACCESS });
    expect(mocks.callable).toHaveBeenCalledTimes(1);

    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    mocks.callable.mockResolvedValue({ data: RESPONSE });
    await loadQuotePortalConversation(STAFF_ACCESS);
    expect(mocks.callable).toHaveBeenCalledTimes(2);
  });

  test("does not coalesce staff reads across authenticated principals", async () => {
    let resolveFirst;
    mocks.callable.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    mocks.callable.mockResolvedValueOnce({ data: RESPONSE });

    const first = loadQuotePortalConversation(STAFF_ACCESS);
    mocks.auth.currentUser = { uid: "staff-2" };
    const second = loadQuotePortalConversation(STAFF_ACCESS);
    await second;
    expect(mocks.callable).toHaveBeenCalledTimes(2);

    resolveFirst({ data: RESPONSE });
    await first;
  });

  test("keeps recent staff conversation bodies in bounded memory only", () => {
    expect(writeConversationMemory(STAFF_ACCESS, CACHED_RESULT, { nowMs: 1000 })).toBe(true);
    expect(readConversationMemory(STAFF_ACCESS, { nowMs: 1001 })).toMatchObject({
      quoteId: "quote-a",
      messages: [{ body: "Hello" }]
    });
    expect(conversationMemoryPolicy).toMatchObject({
      maxEntries: 12,
      persistence: "memory-only"
    });
  });

  test("does not expose cached staff bodies after authenticated principal changes", () => {
    writeConversationMemory(STAFF_ACCESS, CACHED_RESULT, { nowMs: 1000 });
    mocks.auth.currentUser = { uid: "staff-2" };
    expect(readConversationMemory(STAFF_ACCESS, { nowMs: 1001 })).toBeNull();
  });

  test("expires retained bodies without extending ttl on reads", () => {
    writeConversationMemory(STAFF_ACCESS, CACHED_RESULT, { nowMs: 1000 });
    expect(readConversationMemory(STAFF_ACCESS, { nowMs: 1001 })).not.toBeNull();
    expect(readConversationMemory(STAFF_ACCESS, {
      nowMs: 1000 + conversationMemoryPolicy.ttlMs + 1
    })).toBeNull();
  });

  test("returns defensive message copies from memory", () => {
    writeConversationMemory(STAFF_ACCESS, CACHED_RESULT, { nowMs: 1000 });
    const first = readConversationMemory(STAFF_ACCESS, { nowMs: 1001 });
    first.messages[0].body = "Changed locally";
    first.messages.push({ messageId: "fake" });
    const second = readConversationMemory(STAFF_ACCESS, { nowMs: 1002 });
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].body).toBe("Hello");
  });

  test("warms a missing conversation once and reuses the session snapshot", async () => {
    mocks.callable.mockResolvedValue({ data: { ...RESPONSE, messages: CACHED_RESULT.messages } });
    await expect(warmConversationMemory(STAFF_ACCESS)).resolves.toMatchObject({ quoteId: "quote-a" });
    await expect(warmConversationMemory(STAFF_ACCESS)).resolves.toMatchObject({ quoteId: "quote-a" });
    expect(mocks.callable).toHaveBeenCalledTimes(1);
  });

  test("sends body and retry id without client-owned actor, timestamp, or message identity", async () => {
    const message = {
      messageId: "message_1234567890abcdef",
      actorType: "customer",
      actorName: "Jordan Customer",
      body: "Can we move service to 6 PM?",
      createdAtISO: "2026-08-06T18:00:00.000Z"
    };
    mocks.callable.mockResolvedValue({
      data: { ...RESPONSE, messages: [message], message }
    });
    await expect(sendQuotePortalConversationMessage({
      access: { accessMode: "portal", portalKey: PORTAL_KEY },
      body: message.body,
      clientRequestId: "conversation:request-0001"
    })).resolves.toMatchObject({ message });
    const payload = mocks.callable.mock.calls[0][0];
    expect(payload).toEqual({
      accessMode: "portal",
      portalKey: PORTAL_KEY,
      body: message.body,
      clientRequestId: "conversation:request-0001"
    });
    for (const key of ["actorType", "actorName", "messageId", "createdAtISO"]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  test("rejects blank, oversized, and malformed retry inputs before calling the server", async () => {
    await expect(loadQuotePortalConversation({
      accessMode: "portal",
      portalKey: `${"p".repeat(128)}extra`
    })).rejects.toThrow(/current customer portal link/i);
    await expect(sendQuotePortalConversationMessage({
      access: { accessMode: "portal", portalKey: PORTAL_KEY },
      body: " ",
      clientRequestId: "conversation:request-0002"
    })).rejects.toThrow(/enter a message/i);
    await expect(sendQuotePortalConversationMessage({
      access: { accessMode: "portal", portalKey: PORTAL_KEY },
      body: "x".repeat(1201),
      clientRequestId: "conversation:request-0002"
    })).rejects.toThrow(/1200 characters/i);
    await expect(sendQuotePortalConversationMessage({
      access: { accessMode: "portal", portalKey: PORTAL_KEY },
      body: "Hello",
      clientRequestId: "short"
    })).rejects.toThrow(/retry id/i);
    await expect(sendQuotePortalConversationMessage({
      access: { accessMode: "portal", portalKey: PORTAL_KEY },
      body: "Hello",
      clientRequestId: `${"r".repeat(96)}extra`
    })).rejects.toThrow(/retry id/i);
    expect(mocks.callable).not.toHaveBeenCalled();
  });
});
