import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  callable: vi.fn(),
  cloudFunctions: { id: "mock-functions" },
  httpsCallable: vi.fn()
}));

vi.mock("../firebase", () => ({
  cloudFunctions: mockState.cloudFunctions,
  firebaseReady: true
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockState.httpsCallable
}));

import { sendPaymentRequestToCustomerEmail } from "../commerceOps";

function validResponse(overrides = {}) {
  return {
    ok: true,
    quoteId: "quote-payment-1",
    approvalRequest: {
      id: "approval-payment-1",
      executionState: "succeeded"
    },
    email: {
      sent: true,
      provider: "resend",
      messageId: "email-payment-1"
    },
    stripeSessionId: "cs_test_payment_1",
    checkoutGeneration: 1,
    published: true,
    ...overrides
  };
}

describe("payment request callable client contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.httpsCallable.mockReturnValue(mockState.callable);
  });

  test("accepts a successful provider send when settlement made publication unnecessary", async () => {
    const response = validResponse({ published: false });
    mockState.callable.mockResolvedValue({ data: response });

    await expect(sendPaymentRequestToCustomerEmail({
      quoteId: "quote-payment-1",
      approvalRequestId: "approval-payment-1"
    })).resolves.toEqual(response);
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "sendPaymentRequestEmail"
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      quoteId: "quote-payment-1",
      approvalRequestId: "approval-payment-1"
    });
  });

  test.each([
    ["missing", undefined],
    ["string", "false"]
  ])("rejects a %s published result instead of guessing publication state", async (_label, published) => {
    mockState.callable.mockResolvedValue({
      data: validResponse({ published })
    });

    await expect(sendPaymentRequestToCustomerEmail({
      quoteId: "quote-payment-1",
      approvalRequestId: "approval-payment-1"
    })).rejects.toThrow(/invalid authoritative response/i);
  });
});
