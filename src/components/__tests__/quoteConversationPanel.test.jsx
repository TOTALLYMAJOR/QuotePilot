import fs from "node:fs";
import { describe, expect, test } from "vitest";
import {
  formatConversationTimestamp,
  mergeConversationMessages
} from "../QuoteConversationPanel";

const PANEL_SOURCE = fs.readFileSync(
  new URL("../QuoteConversationPanel.jsx", import.meta.url),
  "utf8"
);

describe("quote conversation panel states", () => {
  test("deduplicates replayed message receipts and keeps canonical time order", () => {
    const first = {
      messageId: "message-a",
      createdAtISO: "2026-08-06T18:00:00.000Z"
    };
    const second = {
      messageId: "message-b",
      createdAtISO: "2026-08-06T18:01:00.000Z"
    };
    expect(mergeConversationMessages([second], [first, second])).toEqual([first, second]);
    expect(formatConversationTimestamp(first.createdAtISO)).not.toBe("Time unavailable");
    expect(formatConversationTimestamp("invalid")).toBe("Time unavailable");
  });

  test("exposes open, load, empty, send, success, error, and retry execution states", () => {
    for (const copy of [
      "Open conversation",
      "Loading conversation...",
      "No messages yet.",
      "Sending message...",
      "Message sent.",
      "Retry conversation",
      "Retry message",
      "Refresh conversation",
      "Conversation refreshed.",
      "Close conversation"
    ]) {
      expect(PANEL_SOURCE).toContain(copy);
    }
    expect(PANEL_SOURCE).toContain("readOnlyReason");
    expect(PANEL_SOURCE).toContain("maxLength={PORTAL_CONVERSATION_BODY_MAX_LENGTH}");
  });
});
