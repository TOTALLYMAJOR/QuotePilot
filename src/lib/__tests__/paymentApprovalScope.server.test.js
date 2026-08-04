import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  PaymentApprovalScopeError,
  assertPaymentApprovalRequestScope,
  buildFinalBalanceApprovalScope,
  buildPaymentApprovalScope,
  paymentApprovalScopeDigest
} = require("../../../functions/paymentApprovalScope.js");

function buildExpected(overrides = {}) {
  const quote = {
    customer: { email: "Customer@Example.com" },
    totals: { deposit: 123.45 },
    ...overrides.quote
  };
  return buildPaymentApprovalScope({
    quote,
    quoteId: "quote-a",
    organizationId: "ORG-A",
    quoteRevisionId: "v0003@2026-08-03T18:00:00.000Z",
    portalKey: "portal-key-abcdefghijklmnopqrstuvwxyz",
    portalIssuedAtISO: "2026-08-03T18:00:00Z",
    portalExpiresAtISO: "2026-09-03T18:00:00Z",
    currency: "USD",
    ...overrides
  });
}

function buildFinalBalanceExpected(overrides = {}) {
  const { quote: quoteOverrides = {}, ...optionOverrides } = overrides;
  const quote = {
    status: "booked",
    customer: { email: "Customer@Example.com" },
    totals: { total: 500, deposit: 125 },
    payment: {
      depositStatus: "paid",
      stripeSessionId: "cs_test_deposit_123",
      depositConfirmedAtISO: "2026-08-04T14:00:00.000Z",
      finalBalance: {}
    },
    booking: {
      contractNumber: "C-260804-12345",
      contractConvertedAtISO: "2026-08-04T14:30:00.000Z"
    },
    ...quoteOverrides
  };
  return buildFinalBalanceApprovalScope({
    quote,
    quoteId: "quote-a",
    organizationId: "ORG-A",
    quoteRevisionId: "v0003@2026-08-03T18:00:00.000Z",
    portalKey: "portal-key-abcdefghijklmnopqrstuvwxyz",
    portalIssuedAtISO: "2026-08-03T18:00:00Z",
    portalExpiresAtISO: "2026-09-03T18:00:00Z",
    currency: "USD",
    ...optionOverrides
  });
}

describe("payment approval scope", () => {
  test("builds a deterministic normalized commercial scope", () => {
    const first = buildExpected();
    const second = buildExpected();
    expect(first).toEqual(second);
    expect(first.actionScope).toEqual({
      version: 1,
      kind: "stripe_checkout_deposit_request",
      organizationId: "org-a",
      quoteId: "quote-a",
      quoteRevisionId: "v0003@2026-08-03T18:00:00.000Z",
      portalKey: "portal-key-abcdefghijklmnopqrstuvwxyz",
      portalIssuedAtISO: "2026-08-03T18:00:00.000Z",
      portalExpiresAtISO: "2026-09-03T18:00:00.000Z",
      customerEmail: "customer@example.com",
      paymentKind: "deposit",
      currency: "usd",
      amountCents: 12345
    });
    expect(first.actionScopeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(paymentApprovalScopeDigest(first.actionScope)).toBe(first.actionScopeDigest);
  });

  test.each([
    ["organization", { organizationId: "org-b" }],
    ["quote", { quoteId: "quote-b" }],
    ["revision", { quoteRevisionId: "v0004@2026-08-03T18:00:00.000Z" }],
    ["portal", { portalKey: "different-portal-key-abcdefghijklmnop" }],
    ["issuance", { portalIssuedAtISO: "2026-08-04T18:00:00Z" }],
    ["expiry", { portalExpiresAtISO: "2026-09-04T18:00:00Z" }],
    ["recipient", { quote: { customer: { email: "other@example.com" }, totals: { deposit: 123.45 } } }],
    ["amount", { quote: { customer: { email: "customer@example.com" }, totals: { deposit: 124.45 } } }],
    ["currency", { currency: "cad" }]
  ])("changes the digest when %s authority changes", (_label, overrides) => {
    expect(buildExpected(overrides).actionScopeDigest).not.toBe(buildExpected().actionScopeDigest);
  });

  test("accepts accepted-to-booked lifecycle changes because status is not authority scope", () => {
    const accepted = buildExpected({ quote: {
      status: "accepted",
      customer: { email: "customer@example.com" },
      totals: { deposit: 123.45 }
    } });
    const booked = buildExpected({ quote: {
      status: "booked",
      customer: { email: "customer@example.com" },
      totals: { deposit: 123.45 }
    } });
    expect(booked).toEqual(accepted);
  });

  test("binds final balance authority to settled deposit, contract, and checkout generation", () => {
    const expected = buildFinalBalanceExpected();
    expect(expected.actionScope).toEqual({
      version: 1,
      kind: "stripe_checkout_final_balance_request",
      organizationId: "org-a",
      quoteId: "quote-a",
      quoteRevisionId: "v0003@2026-08-03T18:00:00.000Z",
      portalKey: "portal-key-abcdefghijklmnopqrstuvwxyz",
      portalIssuedAtISO: "2026-08-03T18:00:00.000Z",
      portalExpiresAtISO: "2026-09-03T18:00:00.000Z",
      customerEmail: "customer@example.com",
      paymentKind: "final_balance",
      currency: "usd",
      amountCents: 37500,
      depositStatus: "paid",
      depositAmountCents: 12500,
      depositStripeSessionId: "cs_test_deposit_123",
      depositConfirmedAtISO: "2026-08-04T14:00:00.000Z",
      contractNumber: "C-260804-12345",
      contractConvertedAtISO: "2026-08-04T14:30:00.000Z",
      checkoutGeneration: 1
    });
    expect(assertPaymentApprovalRequestScope({
      approvalRequest: {
        action: "send_final_balance_request",
        ...expected
      },
      expected
    }).actionScopeDigest).toBe(expected.actionScopeDigest);
  });

  test.each([
    ["total", { quote: { totals: { total: 510, deposit: 125 } } }],
    ["deposit settlement", { quote: { payment: {
      depositStatus: "paid",
      stripeSessionId: "cs_test_other_deposit",
      depositConfirmedAtISO: "2026-08-04T14:00:00.000Z",
      finalBalance: {}
    } } }],
    ["contract", { quote: { booking: {
      contractNumber: "C-260804-99999",
      contractConvertedAtISO: "2026-08-04T14:30:00.000Z"
    } } }],
    ["generation", { quote: { payment: {
      depositStatus: "paid",
      stripeSessionId: "cs_test_deposit_123",
      depositConfirmedAtISO: "2026-08-04T14:00:00.000Z",
      finalBalance: { checkoutGeneration: 2 }
    } } }]
  ])("changes final-balance digest when %s authority changes", (_label, overrides) => {
    expect(buildFinalBalanceExpected(overrides).actionScopeDigest)
      .not.toBe(buildFinalBalanceExpected().actionScopeDigest);
  });

  test("reuses a failed checkout generation only after that execution registered its Session", () => {
    const payment = {
      depositStatus: "paid",
      stripeSessionId: "cs_test_deposit_123",
      depositConfirmedAtISO: "2026-08-04T14:00:00.000Z",
      finalBalance: {
        checkoutGeneration: 1,
        stripeSessionId: "cs_test_final_123",
        stripeCheckoutState: "failed"
      }
    };
    expect(buildFinalBalanceExpected({
      quote: { payment },
      reuseCurrentCheckoutGeneration: true
    }).actionScope.checkoutGeneration).toBe(1);
    expect(buildFinalBalanceExpected({ quote: { payment } }).actionScope.checkoutGeneration).toBe(2);
  });

  test("keeps a persisted processing Session on its approved checkout generation", () => {
    const payment = {
      depositStatus: "paid",
      stripeSessionId: "cs_test_deposit_123",
      depositConfirmedAtISO: "2026-08-04T14:00:00.000Z",
      finalBalance: {
        status: "sent",
        paymentLink: "",
        checkoutGeneration: 3,
        stripeSessionId: "cs_test_final_processing",
        stripeCheckoutState: "processing"
      }
    };
    expect(buildFinalBalanceExpected({
      quote: { payment },
      reuseCurrentCheckoutGeneration: true
    }).actionScope.checkoutGeneration).toBe(3);
  });

  test("fails closed when final-balance prerequisites are not provider-settled", () => {
    expect(() => buildFinalBalanceExpected({ quote: {
      payment: {
        depositStatus: "sent",
        stripeSessionId: "cs_test_deposit_123",
        depositConfirmedAtISO: "",
        finalBalance: {}
      }
    } })).toThrow(PaymentApprovalScopeError);
  });

  test("fails closed on legacy, altered, or extra-field scopes", () => {
    const expected = buildExpected();
    expect(() => assertPaymentApprovalRequestScope({
      approvalRequest: { action: "send_payment_request" },
      expected
    })).toThrow(PaymentApprovalScopeError);

    expect(() => assertPaymentApprovalRequestScope({
      approvalRequest: {
        action: "send_payment_request",
        actionScope: { ...expected.actionScope, amountCents: 1 },
        actionScopeDigest: expected.actionScopeDigest
      },
      expected
    })).toThrow(/changed after approval/i);

    expect(() => assertPaymentApprovalRequestScope({
      approvalRequest: {
        action: "send_payment_request",
        actionScope: { ...expected.actionScope, unexpected: true },
        actionScopeDigest: expected.actionScopeDigest
      },
      expected
    })).toThrow(/missing or unexpected/i);
  });
});
