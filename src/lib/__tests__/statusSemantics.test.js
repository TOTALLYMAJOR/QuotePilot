import { describe, expect, test } from "vitest";
import {
  classifyAttentionItem,
  classifyBookingConfirmation,
  classifyDepositStatus,
  classifyFinalBalanceDisplayStatus,
  classifyQuoteStatus,
  getFinalBalanceDisplayStatus,
  STATUS_FAMILY
} from "../statusSemantics";

describe("classifyQuoteStatus", () => {
  test("maps every quote status to a family and a non-empty label", () => {
    const statuses = ["draft", "sent", "viewed", "accepted", "booked", "declined", "expired", "deleted"];
    for (const status of statuses) {
      const result = classifyQuoteStatus(status);
      expect(Object.values(STATUS_FAMILY)).toContain(result.family);
      expect(result.label).not.toBe("");
    }
  });

  test("accepted and booked both read as confirmed", () => {
    expect(classifyQuoteStatus("accepted").family).toBe(STATUS_FAMILY.CONFIRMED);
    expect(classifyQuoteStatus("booked").family).toBe(STATUS_FAMILY.CONFIRMED);
  });

  test("unknown status falls back to info rather than throwing", () => {
    expect(classifyQuoteStatus("not-a-real-status").family).toBe(STATUS_FAMILY.INFO);
    expect(classifyQuoteStatus(undefined).family).toBe(STATUS_FAMILY.INFO);
  });

  test("is case-insensitive", () => {
    expect(classifyQuoteStatus("BOOKED").family).toBe(STATUS_FAMILY.CONFIRMED);
  });
});

describe("classifyDepositStatus", () => {
  test("unpaid is a staff action, paid is confirmed, refunded is archived", () => {
    expect(classifyDepositStatus("unpaid").family).toBe(STATUS_FAMILY.ACTION);
    expect(classifyDepositStatus("sent").family).toBe(STATUS_FAMILY.PENDING);
    expect(classifyDepositStatus("paid").family).toBe(STATUS_FAMILY.CONFIRMED);
    expect(classifyDepositStatus("refunded").family).toBe(STATUS_FAMILY.ARCHIVED);
  });

  test("blank/unknown deposit status defaults to unpaid semantics", () => {
    expect(classifyDepositStatus("").family).toBe(STATUS_FAMILY.ACTION);
    expect(classifyDepositStatus("bogus").family).toBe(STATUS_FAMILY.ACTION);
  });
});

describe("getFinalBalanceDisplayStatus", () => {
  test("mirrors QuoteHistoryModal's helper for the shared vocabulary", () => {
    expect(getFinalBalanceDisplayStatus({ status: "paid" })).toBe("paid");
    expect(getFinalBalanceDisplayStatus({ status: "unpaid" })).toBe("unpaid");
    expect(getFinalBalanceDisplayStatus({ status: "sent" })).toBe("sent");
    expect(getFinalBalanceDisplayStatus({ status: "unpaid", stripeCheckoutState: "prepared" })).toBe("prepared");
    expect(getFinalBalanceDisplayStatus({ status: "sent", stripeCheckoutState: "processing" })).toBe("processing");
    expect(getFinalBalanceDisplayStatus({ status: "sent", stripeCheckoutState: "failed" })).toBe("failed");
    expect(getFinalBalanceDisplayStatus({ status: "sent", stripeCheckoutState: "expired" })).toBe("expired");
    // A checkout state cannot override an already-paid status.
    expect(getFinalBalanceDisplayStatus({ status: "paid", stripeCheckoutState: "failed" })).toBe("paid");
    expect(getFinalBalanceDisplayStatus()).toBe("unpaid");
  });
});

describe("classifyFinalBalanceDisplayStatus", () => {
  test("covers the full getFinalBalanceDisplayStatus vocabulary without falling back to unknown", () => {
    const displayStatuses = ["unpaid", "sent", "prepared", "processing", "paid", "failed", "expired"];
    for (const displayStatus of displayStatuses) {
      const result = classifyFinalBalanceDisplayStatus(displayStatus);
      expect(result.label).not.toBe("Unknown");
    }
    expect(classifyFinalBalanceDisplayStatus("processing").family).toBe(STATUS_FAMILY.PROVIDER);
    expect(classifyFinalBalanceDisplayStatus("paid").family).toBe(STATUS_FAMILY.CONFIRMED);
    expect(classifyFinalBalanceDisplayStatus("failed").family).toBe(STATUS_FAMILY.FAILED);
    expect(classifyFinalBalanceDisplayStatus("expired").family).toBe(STATUS_FAMILY.EXPIRED);
  });
});

describe("classifyBookingConfirmation", () => {
  test("maps all four booking confirmation statuses", () => {
    expect(classifyBookingConfirmation("pending").family).toBe(STATUS_FAMILY.ACTION);
    expect(classifyBookingConfirmation("sent").family).toBe(STATUS_FAMILY.PENDING);
    expect(classifyBookingConfirmation("confirmed").family).toBe(STATUS_FAMILY.CONFIRMED);
    expect(classifyBookingConfirmation("cancelled").family).toBe(STATUS_FAMILY.ARCHIVED);
  });
});

describe("classifyAttentionItem", () => {
  test("matches every type/state pair produced by buildWorkflowAttentionSummary", () => {
    const pairs = [
      ["change_request", "new"],
      ["change_request", "acknowledged"],
      ["change_request", "invalid"],
      ["follow_up", "overdue"],
      ["follow_up", "due_today"],
      ["approval", "pending"],
      ["unread_customer_reply", "open"],
      ["anniversary_rebooking", "verification_required"],
      ["post_event_closeout", "overdue"],
      ["post_event_closeout", "due_today"],
      ["post_event_closeout", "blocked_configuration"],
      ["post_event_closeout", "blocked_source"]
    ];
    for (const [type, state] of pairs) {
      const result = classifyAttentionItem(type, state);
      expect(result.label).not.toBe("Unknown");
    }
  });

  test("a new change request and an overdue follow-up both read as staff action items", () => {
    expect(classifyAttentionItem("change_request", "new").family).toBe(STATUS_FAMILY.ACTION);
    expect(classifyAttentionItem("follow_up", "overdue").family).toBe(STATUS_FAMILY.ACTION);
    expect(classifyAttentionItem("unread_customer_reply", "open").family).toBe(STATUS_FAMILY.ACTION);
    expect(classifyAttentionItem("anniversary_rebooking", "verification_required").family)
      .toBe(STATUS_FAMILY.ACTION);
  });

  test("an invalid change request reads as blocked, not actionable", () => {
    expect(classifyAttentionItem("change_request", "invalid").family).toBe(STATUS_FAMILY.BLOCKED);
  });
});
