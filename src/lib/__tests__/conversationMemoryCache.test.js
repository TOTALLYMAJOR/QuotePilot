import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: "staff-1" } },
  loadQuotePortalConversation: vi.fn()
}));

vi.mock("../firebase", () => ({ auth: mocks.auth }));
vi.mock("../portalConversationClient", () => ({
  loadQuotePortalConversation: mocks.loadQuotePortalConversation
}));

import {
  clearAllConversationMemory,
  conversationMemoryPolicy,
  readConversationMemory,
  warmConversationMemory,
  writeConversationMemory
} from "../conversationMemoryCache";

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

describe("conversation memory cache", () => {
  beforeEach(() => {
    clearAllConversationMemory();
    mocks.loadQuotePortalConversation.mockReset();
    mocks.auth.currentUser = { uid: "staff-1" };
  });

  test("keeps a bounded conversation snapshot in memory for the same staff principal", () => {
    expect(writeConversationMemory(ACCESS, RESULT, { nowMs: 1000 })).toBe(true);
    expect(readConversationMemory(ACCESS, { nowMs: 1001 })).toMatchObject({
      quoteId: "quote-a",
      messages: [{ body: "Hello" }]
    });
  });

  test("does not expose a cached staff conversation after the authenticated principal changes", () => {
    writeConversationMemory(ACCESS, RESULT, { nowMs: 1000 });
    mocks.auth.currentUser = { uid: "staff-2" };
    expect(readConversationMemory(ACCESS, { nowMs: 1001 })).toBeNull();
  });

  test("expires retained message bodies after the memory ttl", () => {
    writeConversationMemory(ACCESS, RESULT, { nowMs: 1000 });
    expect(readConversationMemory(ACCESS, {
      nowMs: 1000 + conversationMemoryPolicy.ttlMs + 1
    })).toBeNull();
  });

  test("warms a missing conversation once and reuses the memory snapshot", async () => {
    mocks.loadQuotePortalConversation.mockResolvedValue(RESULT);
    await expect(warmConversationMemory(ACCESS)).resolves.toMatchObject({ quoteId: "quote-a" });
    await expect(warmConversationMemory(ACCESS)).resolves.toMatchObject({ quoteId: "quote-a" });
    expect(mocks.loadQuotePortalConversation).toHaveBeenCalledTimes(1);
  });

  test("returns defensive message copies instead of sharing mutable cached arrays", () => {
    writeConversationMemory(ACCESS, RESULT, { nowMs: 1000 });
    const first = readConversationMemory(ACCESS, { nowMs: 1001 });
    first.messages[0].body = "Changed locally";
    first.messages.push({ messageId: "fake" });
    const second = readConversationMemory(ACCESS, { nowMs: 1002 });
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].body).toBe("Hello");
  });
});
