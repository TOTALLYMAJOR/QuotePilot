import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn((value) => ({ type: "limit", value })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((field, direction) => ({ type: "orderBy", field, direction })),
  query: vi.fn((...parts) => ({ parts })),
  collectionRef: { id: "quotes" },
  unsubscribe: vi.fn()
}));

vi.mock("firebase/firestore", () => ({
  limit: mocks.limit,
  onSnapshot: mocks.onSnapshot,
  orderBy: mocks.orderBy,
  query: mocks.query
}));

vi.mock("../firebase", () => ({ firebaseReady: true }));

vi.mock("../organizationService", () => ({
  getOrganizationCollectionRef: vi.fn(() => mocks.collectionRef)
}));

import { subscribeConversationInbox } from "../conversationInbox";

describe("conversation inbox subscription metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSnapshot.mockReturnValue(mocks.unsubscribe);
  });

  test("treats local pending writes as stale instead of claiming live updates", () => {
    const onData = vi.fn();
    const unsubscribe = subscribeConversationInbox({ organizationId: "org-one", onData });

    mocks.onSnapshot.mock.calls[0][2]({
      docs: [],
      size: 0,
      metadata: { fromCache: false, hasPendingWrites: true }
    });

    expect(onData).toHaveBeenCalledWith(expect.objectContaining({
      source: "firebase-pending",
      stale: true
    }));
    expect(unsubscribe).toBe(mocks.unsubscribe);
  });
});
