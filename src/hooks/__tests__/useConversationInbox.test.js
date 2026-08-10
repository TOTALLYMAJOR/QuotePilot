import { describe, expect, test } from "vitest";
import {
  filterConversationInboxSeedQuotes,
  resolveScopedConversationInboxState
} from "../useConversationInbox";

describe("conversation inbox tenant scope", () => {
  test("drops prior-tenant live and seed rows synchronously during an organization change", () => {
    const priorState = {
      scopeKey: "org-a",
      status: "ready",
      liveQuotes: [{ id: "quote-a", organizationId: "org-a" }],
      source: "firebase-live",
      error: "",
      stale: false,
      bounded: false
    };

    expect(resolveScopedConversationInboxState(priorState, "org-b")).toMatchObject({
      scopeKey: "org-b",
      status: "idle",
      liveQuotes: []
    });
    expect(filterConversationInboxSeedQuotes([
      { id: "quote-a", organizationId: "org-a" },
      { id: "quote-b", organizationId: "org-b" },
      { id: "unscoped-legacy" }
    ], "org-b")).toEqual([{ id: "quote-b", organizationId: "org-b" }]);
  });
});
