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

import {
  reconcileFinalBalanceCheckout,
  sendFinalBalanceRequestToCustomerEmail,
  sendPaymentRequestToCustomerEmail
} from "../commerceOps";

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

function validFinalBalanceResponse(overrides = {}) {
  return {
    ...validResponse({
      quoteId: "quote-final-balance-1",
      approvalRequest: {
        id: "approval-final-balance-1",
        executionState: "succeeded"
      },
      stripeSessionId: "cs_test_final_balance_1"
    }),
    paymentKind: "final_balance",
    amountCents: 37500,
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

  test("binds final-balance sends to the dedicated callable and authoritative rail", async () => {
    const response = validFinalBalanceResponse();
    mockState.callable.mockResolvedValue({ data: response });

    await expect(sendFinalBalanceRequestToCustomerEmail({
      quoteId: "quote-final-balance-1",
      approvalRequestId: "approval-final-balance-1"
    })).resolves.toEqual(response);
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "sendFinalBalanceRequestEmail"
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      quoteId: "quote-final-balance-1",
      approvalRequestId: "approval-final-balance-1"
    });
  });

  test.each([
    ["deposit rail", { paymentKind: "deposit" }],
    ["missing cents", { amountCents: undefined }],
    ["non-integer cents", { amountCents: 375.5 }],
    ["payment-link leakage", { paymentLink: "https://checkout.stripe.com/c/pay/private" }]
  ])("rejects a final-balance send with %s", async (_label, overrides) => {
    mockState.callable.mockResolvedValue({
      data: validFinalBalanceResponse(overrides)
    });

    await expect(sendFinalBalanceRequestToCustomerEmail({
      quoteId: "quote-final-balance-1",
      approvalRequestId: "approval-final-balance-1"
    })).rejects.toThrow(/invalid authoritative response/i);
  });

  test("uses a separate final-balance reconciliation callable without exposing its URL", async () => {
    const response = {
      ok: true,
      quoteId: "quote-final-balance-1",
      paymentKind: "final_balance",
      amountCents: 37500,
      stripeSessionId: "cs_test_final_balance_1",
      providerState: "processing",
      auditEventId: "audit-final-balance-1",
      reviewRequired: false
    };
    mockState.callable.mockResolvedValue({ data: response });

    await expect(reconcileFinalBalanceCheckout({
      quoteId: "quote-final-balance-1"
    })).resolves.toEqual(response);
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "reconcileFinalBalanceCheckout"
    );
    expect(mockState.callable).toHaveBeenCalledWith({ quoteId: "quote-final-balance-1" });
  });

  test.each([
    ["wrong rail", { paymentKind: "deposit" }],
    ["unsafe URL", { url: "https://checkout.stripe.com/c/pay/private" }]
  ])("rejects final-balance reconciliation with %s", async (_label, overrides) => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        quoteId: "quote-final-balance-1",
        paymentKind: "final_balance",
        amountCents: 37500,
        stripeSessionId: "cs_test_final_balance_1",
        providerState: "paid",
        auditEventId: "audit-final-balance-1",
        ...overrides
      }
    });

    await expect(reconcileFinalBalanceCheckout({
      quoteId: "quote-final-balance-1"
    })).rejects.toThrow(/invalid authoritative response/i);
  });
});
