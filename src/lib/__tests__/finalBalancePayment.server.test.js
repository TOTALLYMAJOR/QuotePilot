import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildFinalBalanceStripeScopeQuote,
  finalBalanceStoredState,
  normalizeFinalBalanceCheckoutPayment,
  planFinalBalanceLedgerTransition,
  projectQuotePaymentLedger,
  quotePaymentAmounts
} = require("../../../functions/finalBalancePayment.js");

function quote(overrides = {}) {
  return {
    totals: { total: 500, deposit: 125 },
    payment: {
      depositStatus: "paid",
      stripeSessionId: "cs_test_deposit_123",
      stripeCheckoutState: "paid",
      depositConfirmedAtISO: "2026-08-04T14:00:00.000Z"
    },
    ...overrides
  };
}

describe("final-balance payment projection", () => {
  test("bootstraps existing provider-paid deposits without replacing legacy evidence", () => {
    const source = quote();
    const projection = projectQuotePaymentLedger(source);
    expect(projection).toMatchObject({
      totalCents: 50000,
      depositCents: 12500,
      finalBalanceCents: 37500,
      finalDueCents: 37500,
      byKind: {
        deposit: { state: "paid", providerReference: "cs_test_deposit_123" },
        finalBalance: { state: "not_started" }
      }
    });
    expect(source.payment.ledger).toBeUndefined();
  });

  test("rounds existing quote totals to Stripe cents before subtracting", () => {
    expect(quotePaymentAmounts(quote({ totals: { total: 500.005, deposit: 125.004 } })))
      .toEqual({ totalCents: 50001, depositCents: 12500, finalBalanceCents: 37501 });
  });

  test("plans prepared, sent, and paid final-balance evidence monotonically", () => {
    const prepared = planFinalBalanceLedgerTransition({
      quote: quote(),
      operationId: "approval-final-1",
      amountCents: 37500,
      nextState: "prepared",
      providerReference: "cs_test_final_123"
    });
    const preparedQuote = quote({
      payment: {
        ...quote().payment,
        ledger: prepared.ledger
      }
    });
    const sent = planFinalBalanceLedgerTransition({
      quote: preparedQuote,
      operationId: "approval-final-1",
      amountCents: 37500,
      nextState: "sent",
      providerReference: "cs_test_final_123"
    });
    const paid = planFinalBalanceLedgerTransition({
      quote: quote({
        payment: { ...quote().payment, ledger: sent.ledger }
      }),
      operationId: "approval-final-1",
      amountCents: 37500,
      nextState: "paid",
      providerReference: "cs_test_final_123",
      providerSettledAtISO: "2026-08-04T18:00:00.000Z"
    });
    expect(paid.projection).toMatchObject({
      finalDueCents: 0,
      netPaidCents: 50000,
      byKind: { finalBalance: { state: "paid", paidCents: 37500 } }
    });
    expect(() => planFinalBalanceLedgerTransition({
      quote: quote({ payment: { ...quote().payment, ledger: paid.ledger } }),
      operationId: "approval-final-1",
      amountCents: 37500,
      nextState: "sent",
      providerReference: "cs_test_final_123"
    })).toThrow(/cannot move/i);
  });

  test("keeps final-balance checkout fields separate from deposit fields", () => {
    const stored = finalBalanceStoredState({
      depositStatus: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/cs_test_final",
      stripeSessionId: "cs_test_final_123",
      stripeCheckoutState: "open",
      checkoutGeneration: 1,
      knownStripeSessionIds: ["cs_test_final_123"]
    }, {
      amountCents: 37500,
      currency: "usd"
    });
    expect(stored).toMatchObject({
      status: "sent",
      paymentLink: "https://checkout.stripe.com/c/pay/cs_test_final",
      stripeSessionId: "cs_test_final_123"
    });
    expect(stored).not.toHaveProperty("operationId");
    expect(normalizeFinalBalanceCheckoutPayment({ finalBalance: stored }))
      .toMatchObject({ depositStatus: "sent", stripeSessionId: "cs_test_final_123" });
  });

  test("creates a Stripe validation view using only the final-balance amount and session", () => {
    const scoped = buildFinalBalanceStripeScopeQuote(quote({
      payment: {
        ...quote().payment,
        finalBalance: {
          status: "sent",
          paymentLink: "https://checkout.stripe.com/c/pay/cs_test_final",
          stripeSessionId: "cs_test_final_123",
          stripeCheckoutState: "open",
          checkoutGeneration: 1,
          knownStripeSessionIds: ["cs_test_final_123"]
        }
      }
    }));
    expect(scoped.totals.deposit).toBe(375);
    expect(scoped.payment.stripeSessionId).toBe("cs_test_final_123");
    expect(scoped.payment.depositStatus).toBe("sent");
  });

  test("fails closed without exact paid deposit evidence", () => {
    expect(() => projectQuotePaymentLedger(quote({
      payment: { depositStatus: "sent", stripeSessionId: "cs_test_deposit_123" }
    }))).toThrow(/provider-settled deposit/i);
    expect(() => projectQuotePaymentLedger(quote({
      payment: {
        depositStatus: "paid",
        stripeSessionId: "cs_test_deposit_123",
        depositConfirmedAtISO: "2026-08-04T14:00:00.000Z",
        ledger: { version: 99, entries: [] }
      }
    }))).toThrow(/ledger is invalid/i);
  });
});
