import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  cloudFunctions: { id: "functions" }
}));

vi.mock("firebase/functions", () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock("../firebase", () => ({
  cloudFunctions: mocks.cloudFunctions,
  firebaseReady: true
}));

import {
  clearConversationLoadMemory,
  loadQuotePortalConversation,
  sendQuotePortalConversationMessage
} from "../portalConversationClient";

const PORTAL_KEY = "portal-conversation-token-1234567890";
const RESPONSE = {
  ok: true,
  organizationId: "org-a",
  quoteId: "quote-a",
  portalIssuedAtISO: "2026-08-06T17:00:00.000Z",
  readOnly: false,
  messages: [],
  limits: {}
};

describe("portal conversation callable client", () => {
  beforeEach(() => {
    clearConversationLoadMemory();
    mocks.callable.mockReset();
    mocks.httpsCallable.mockReset();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
  });

  test("shares one exact in-flight body load and briefly reuses its normalized result", async () => {
    let resolveCall;
    mocks.callable.mockReturnValue(new Promise((resolve) => {
      resolveCall = resolve;
    }));
    const access = {
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-a"
    };

    const first = loadQuotePortalConversation(access, { cacheScope: "staff-a" });
    const duplicate = loadQuotePortalConversation(access, { cacheScope: "staff-a" });
    expect(mocks.callable).toHaveBeenCalledTimes(1);

    resolveCall({ data: RESPONSE });
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      expect.objectContaining({ quoteId: "quote-a" }),
      expect.objectContaining({ quoteId: "quote-a" })
    ]);

    await loadQuotePortalConversation(access, { cacheScope: "staff-a" });
    expect(mocks.callable).toHaveBeenCalledTimes(1);
  });

  test("bypasses retained memory for an explicit authoritative refresh", async () => {
    mocks.callable.mockResolvedValue({ data: RESPONSE });
    const access = {
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-a"
    };

    await loadQuotePortalConversation(access, { cacheScope: "staff-a" });
    await loadQuotePortalConversation(access, {
      cacheScope: "staff-a",
      forceRefresh: true
    });

    expect(mocks.callable).toHaveBeenCalledTimes(2);
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
    await loadQuotePortalConversation({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-a"
    });
    expect(mocks.callable).toHaveBeenCalledWith({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-a"
    });
  });

  test("loads an older page with only the validated opaque cursor", async () => {
    mocks.callable.mockResolvedValue({
      data: {
        ...RESPONSE,
        page: {
          pageSize: 50,
          returned: 1,
          hasOlder: false,
          oldestCursor: { createdAtMs: 1_786_035_599_000, messageId: "message_older" },
          newestCursor: { createdAtMs: 1_786_035_599_000, messageId: "message_older" }
        }
      }
    });
    const before = { createdAtMs: 1_786_035_600_000, messageId: "message_newer" };
    const result = await loadQuotePortalConversation({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-a"
    }, { cacheScope: "staff-a", before });

    expect(mocks.callable).toHaveBeenCalledWith({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-a",
      before
    });
    expect(result.page).toMatchObject({ pageSize: 50, returned: 1, hasOlder: false });
  });

  test("loads only messages after a validated catch-up cursor", async () => {
    mocks.callable.mockResolvedValue({
      data: {
        ...RESPONSE,
        page: {
          pageSize: 50,
          returned: 1,
          hasOlder: false,
          hasNewer: false,
          oldestCursor: { createdAtMs: 1_786_035_601_000, messageId: "message_new" },
          newestCursor: { createdAtMs: 1_786_035_601_000, messageId: "message_new" }
        }
      }
    });
    const after = { createdAtMs: 1_786_035_600_000, messageId: "message_current" };
    const result = await loadQuotePortalConversation({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-a"
    }, { cacheScope: "staff-a", after });

    expect(mocks.callable).toHaveBeenCalledWith({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-a",
      after
    });
    expect(result.page).toMatchObject({ returned: 1, hasNewer: false });
  });

  test("rejects combined history directions before calling the server", async () => {
    const cursor = { createdAtMs: 1_786_035_600_000, messageId: "message_current" };
    await expect(loadQuotePortalConversation({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-a"
    }, { before: cursor, after: cursor })).rejects.toThrow(/cannot be combined/i);
    expect(mocks.callable).not.toHaveBeenCalled();
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

  test("invalidates retained body loads after an authoritative send receipt", async () => {
    const access = { accessMode: "staff", organizationId: "org-a", quoteId: "quote-a" };
    const message = {
      messageId: "message_1234567890abcdef",
      actorType: "staff",
      actorName: "Taylor Staff",
      body: "The loading dock is confirmed.",
      createdAtISO: "2026-08-06T18:00:00.000Z"
    };
    mocks.callable
      .mockResolvedValueOnce({ data: RESPONSE })
      .mockResolvedValueOnce({ data: { ...RESPONSE, messages: [message], message } })
      .mockResolvedValueOnce({ data: { ...RESPONSE, messages: [message] } });

    await loadQuotePortalConversation(access, { cacheScope: "staff-a" });
    await sendQuotePortalConversationMessage({
      access,
      body: message.body,
      clientRequestId: "conversation:request-cache-invalidation"
    });
    await loadQuotePortalConversation(access, { cacheScope: "staff-a" });

    expect(mocks.callable).toHaveBeenCalledTimes(3);
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
