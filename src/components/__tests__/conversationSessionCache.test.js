import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: "staff-1" } },
  loadQuotePortalConversation: vi.fn()
}));

vi.mock("../../lib/firebase", () => ({ auth: mocks.auth }));
vi.mock("../../lib/portalConversationClient", () => ({
  loadQuotePortalConversation: mocks.loadQuotePortalConversation
}));

import {
  clearAllConversationSessions,
  conversationSessionPolicy,
  loadConversationAuthoritatively,
  readConversationSession,
  warmConversationSession,
  writeConversationSession
} from "../conversationSessionCache";

const ACCESS = {
  accessMode: "staff",
  organizationId: "org-a",
  quoteId: "quote-a"
};
const RESULT = {
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

describe("conversation presentation session cache", () => {
  beforeEach(() => {
    clearAllConversationSessions();
    mocks.loadQuotePortalConversation.mockReset();
    mocks.auth.currentUser = { uid: "staff-1" };
  });

  test("retains a bounded recent conversation snapshot in memory only", () => {
    expect(writeConversationSession(ACCESS, RESULT, { nowMs: 1000 })).toBe(true);
    expect(readConversationSession(ACCESS, { nowMs: 1001 })).toMatchObject({
      quoteId: "quote-a",
      messages: [{ body: "Hello" }]
    });
    expect(conversationSessionPolicy).toMatchObject({
      maxEntries: 12,
      persistence: "memory-only"
    });
  });

  test("does not expose a cached staff conversation after the authenticated principal changes", () => {
    writeConversationSession(ACCESS, RESULT, { nowMs: 1000 });
    mocks.auth.currentUser = { uid: "staff-2" };
    expect(readConversationSession(ACCESS, { nowMs: 1001 })).toBeNull();
  });

  test("expires retained bodies without extending ttl on reads", () => {
    writeConversationSession(ACCESS, RESULT, { nowMs: 1000 });
    expect(readConversationSession(ACCESS, { nowMs: 1001 })).not.toBeNull();
    expect(readConversationSession(ACCESS, {
      nowMs: 1000 + conversationSessionPolicy.ttlMs + 1
    })).toBeNull();
  });

  test("returns defensive copies instead of shared cached message arrays", () => {
    writeConversationSession(ACCESS, RESULT, { nowMs: 1000 });
    const first = readConversationSession(ACCESS, { nowMs: 1001 });
    first.messages[0].body = "Changed locally";
    first.messages.push({ messageId: "fake" });
    const second = readConversationSession(ACCESS, { nowMs: 1002 });
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].body).toBe("Hello");
  });

  test("coalesces concurrent authoritative loads for the same authenticated conversation", async () => {
    let release;
    mocks.loadQuotePortalConversation.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve(RESULT);
    }));

    const first = loadConversationAuthoritatively(ACCESS);
    const second = loadConversationAuthoritatively({ ...ACCESS });
    expect(mocks.loadQuotePortalConversation).toHaveBeenCalledTimes(1);

    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(readConversationSession(ACCESS)).toMatchObject({ quoteId: "quote-a" });
  });

  test("does not coalesce staff loads across authenticated principals", async () => {
    let resolveFirst;
    mocks.loadQuotePortalConversation.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    mocks.loadQuotePortalConversation.mockResolvedValueOnce(RESULT);

    const first = loadConversationAuthoritatively(ACCESS);
    mocks.auth.currentUser = { uid: "staff-2" };
    const second = loadConversationAuthoritatively(ACCESS);
    await second;
    expect(mocks.loadQuotePortalConversation).toHaveBeenCalledTimes(2);

    resolveFirst(RESULT);
    await first;
  });

  test("warms a missing conversation once and reuses the session snapshot", async () => {
    mocks.loadQuotePortalConversation.mockResolvedValue(RESULT);
    await expect(warmConversationSession(ACCESS)).resolves.toMatchObject({ quoteId: "quote-a" });
    await expect(warmConversationSession(ACCESS)).resolves.toMatchObject({ quoteId: "quote-a" });
    expect(mocks.loadQuotePortalConversation).toHaveBeenCalledTimes(1);
  });
});
