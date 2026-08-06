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
    mocks.callable.mockReset();
    mocks.httpsCallable.mockReset();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
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
