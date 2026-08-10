import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { id: "firestore" },
  doc: vi.fn(),
  onSnapshot: vi.fn()
}));

vi.mock("firebase/firestore", () => ({
  doc: mocks.doc,
  onSnapshot: mocks.onSnapshot
}));

vi.mock("../firebase", () => ({
  db: mocks.db,
  firebaseReady: true
}));

import {
  isConversationSignalNewer,
  normalizeConversationSignalSnapshot,
  subscribeToConversationSignal
} from "../conversationSignalClient";

const PORTAL_KEY = "portal-conversation-token-1234567890";

function snapshot(data, metadata = {}) {
  return {
    exists: () => true,
    data: () => data,
    metadata: {
      fromCache: false,
      hasPendingWrites: false,
      ...metadata
    }
  };
}

describe("conversation signal client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.doc.mockImplementation((...segments) => ({ segments }));
    mocks.onSnapshot.mockReturnValue(vi.fn());
  });

  test("subscribes staff to the exact tenant quote and emits only normalized signal fields", () => {
    const onSignal = vi.fn();
    const onError = vi.fn();
    subscribeToConversationSignal({
      accessMode: "staff",
      organizationId: "org-one",
      quoteId: "quote-one"
    }, { onSignal, onError });

    expect(mocks.doc).toHaveBeenCalledWith(
      mocks.db,
      "organizations",
      "org-one",
      "quotes",
      "quote-one"
    );
    expect(mocks.onSnapshot.mock.calls[0][1]).toEqual({ includeMetadataChanges: true });

    mocks.onSnapshot.mock.calls[0][2](snapshot({
      organizationId: "org-one",
      quoteId: "quote-one",
      body: "must never leave the canonical message store",
      conversationSummary: {
        schemaVersion: 1,
        messageCount: 3,
        latestMessageId: "message-three",
        latestMessageAtISO: "2026-08-09T18:30:00.000Z",
        latestActorType: "customer",
        latestMessageBody: "also private"
      }
    }));

    expect(onSignal).toHaveBeenCalledWith(expect.objectContaining({
      source: "organization_quote",
      accessMode: "staff",
      organizationId: "org-one",
      quoteId: "quote-one",
      messageCount: 3,
      latestMessageId: "message-three",
      latestMessageAtISO: "2026-08-09T18:30:00.000Z",
      latestActorType: "customer",
      metadata: {
        fromCache: false,
        hasPendingWrites: false,
        source: "server"
      }
    }));
    expect(JSON.stringify(onSignal.mock.calls[0][0])).not.toContain("private");

    mocks.onSnapshot.mock.calls[0][3](new Error("sensitive provider detail"));
    expect(onError).toHaveBeenCalledWith({
      code: "conversation-signal-unavailable",
      message: "Conversation updates are paused."
    });
  });

  test("subscribes portal access only to its exact bearer-key document and reports cache metadata", () => {
    const onSignal = vi.fn();
    subscribeToConversationSignal({
      accessMode: "portal",
      portalKey: PORTAL_KEY
    }, { onSignal });

    expect(mocks.doc).toHaveBeenCalledWith(
      mocks.db,
      "customerPortalQuotes",
      PORTAL_KEY
    );
    mocks.onSnapshot.mock.calls[0][2](snapshot({
      organizationId: "org-one",
      quoteId: "quote-one",
      conversationSummary: {
        messageCount: 1,
        latestMessageId: "message-one",
        latestMessageAtISO: "2026-08-09T18:00:00.000Z",
        latestActorType: "staff"
      }
    }, { fromCache: true, hasPendingWrites: true }));

    expect(onSignal.mock.calls[0][0]).toMatchObject({
      source: "customer_portal_quote",
      accessMode: "portal",
      organizationId: "org-one",
      quoteId: "quote-one",
      metadata: {
        fromCache: true,
        hasPendingWrites: true,
        source: "cache"
      }
    });
    expect(onSignal.mock.calls[0][0]).not.toHaveProperty("portalKey");
  });

  test("reload comparison accepts only a distinct signal that is not older", () => {
    const current = {
      messageCount: 2,
      latestMessageId: "message-two",
      latestMessageAtISO: "2026-08-09T18:20:00.000Z"
    };
    expect(isConversationSignalNewer({ ...current }, current)).toBe(false);
    expect(isConversationSignalNewer({
      messageCount: 1,
      latestMessageId: "message-one",
      latestMessageAtISO: "2026-08-09T18:10:00.000Z"
    }, current)).toBe(false);
    expect(isConversationSignalNewer({
      messageCount: 3,
      latestMessageId: "message-three",
      latestMessageAtISO: "2026-08-09T18:30:00.000Z"
    }, current)).toBe(true);
    expect(isConversationSignalNewer({
      messageCount: 3,
      latestMessageId: "message-two",
      latestMessageAtISO: "2026-08-09T18:20:00.000Z"
    }, current)).toBe(true);
  });

  test("rejects malformed scope before opening a listener", () => {
    expect(() => subscribeToConversationSignal({
      accessMode: "staff",
      organizationId: "",
      quoteId: "quote-one"
    }, { onSignal: vi.fn() })).toThrow(/organization/i);
    expect(() => normalizeConversationSignalSnapshot(snapshot({}), {
      accessMode: "portal",
      portalKey: "short"
    })).toThrow(/current customer portal link/i);
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
  });
});
