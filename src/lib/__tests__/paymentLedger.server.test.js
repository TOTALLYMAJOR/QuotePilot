import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  PAYMENT_KINDS,
  PAYMENT_LEDGER_VERSION,
  PAYMENT_STATES,
  PaymentLedgerError,
  planPaymentLedgerTransition,
  projectPaymentLedger
} = require("../../../functions/paymentLedger.js");

const QUOTE_TOTALS = Object.freeze({ total: 1000, deposit: 300 });
const DEPOSIT_CENTS = 30_000;
const FINAL_BALANCE_CENTS = 70_000;
const SETTLED_AT = "2026-08-04T12:00:00.000Z";

function plan(entries, overrides = {}) {
  return planPaymentLedgerTransition({
    quoteTotals: QUOTE_TOTALS,
    entries,
    operationId: "deposit-1",
    paymentKind: "deposit",
    amountCents: DEPOSIT_CENTS,
    nextState: "prepared",
    providerReference: "cs_test_deposit_1",
    ...overrides
  });
}

function paidDepositEntries() {
  const prepared = plan([]).projection.entries;
  return plan(prepared, {
    nextState: "paid",
    providerSettledAtISO: SETTLED_AT
  }).projection.entries;
}

describe("server-owned payment ledger", () => {
  test("exports the bounded payment kinds, states, and schema version", () => {
    expect(PAYMENT_LEDGER_VERSION).toBe(1);
    expect(PAYMENT_KINDS).toEqual(["deposit", "final_balance"]);
    expect(PAYMENT_STATES).toEqual([
      "prepared",
      "sent",
      "processing",
      "paid",
      "failed",
      "expired"
    ]);
    expect(Object.isFrozen(PAYMENT_KINDS)).toBe(true);
    expect(Object.isFrozen(PAYMENT_STATES)).toBe(true);
  });

  test("derives authoritative cents from quote totals before any payment settles", () => {
    const projection = projectPaymentLedger({
      quoteTotals: QUOTE_TOTALS,
      entries: []
    });

    expect(projection).toMatchObject({
      version: 1,
      totalCents: 100_000,
      depositCents: DEPOSIT_CENTS,
      finalBalanceCents: FINAL_BALANCE_CENTS,
      finalDueCents: 100_000,
      netPaidCents: 0,
      depositStatus: "unpaid",
      byKind: {
        deposit: {
          state: "not_started",
          expectedAmountCents: DEPOSIT_CENTS,
          paidCents: 0
        },
        finalBalance: {
          state: "not_started",
          expectedAmountCents: FINAL_BALANCE_CENTS,
          paidCents: 0
        }
      },
      legacyPayment: {
        depositStatus: "unpaid",
        depositConfirmedAtISO: "",
        stripeSessionId: "",
        stripeCheckoutState: ""
      }
    });
  });

  test("accepts explicit cents only when any supplied decimal totals agree", () => {
    expect(projectPaymentLedger({
      quoteTotals: {
        total: 1000,
        deposit: 300,
        totalCents: 100_000,
        depositCents: 30_000
      }
    })).toMatchObject({
      totalCents: 100_000,
      depositCents: 30_000,
      finalBalanceCents: 70_000
    });

    expect(() => projectPaymentLedger({
      quoteTotals: {
        total: 999,
        deposit: 300,
        totalCents: 100_000,
        depositCents: 30_000
      }
    })).toThrow(/inconsistent/i);
  });

  test("rounds legacy fractional-cent quote totals using the existing Stripe cent policy", () => {
    expect(projectPaymentLedger({
      quoteTotals: { total: 10.001, deposit: 1.005 }
    })).toMatchObject({
      totalCents: 1000,
      depositCents: 100,
      finalBalanceCents: 900
    });
  });

  test("returns deep-frozen copies without mutating or freezing caller data", () => {
    const callerEntry = {
      operationId: "deposit-immutable",
      paymentKind: "deposit",
      amountCents: DEPOSIT_CENTS,
      state: "prepared",
      providerReference: "cs_test_immutable",
      providerSettledAtISO: ""
    };
    const callerEntries = [callerEntry];
    const projection = projectPaymentLedger({
      quoteTotals: QUOTE_TOTALS,
      entries: callerEntries
    });

    expect(projection.entries[0]).not.toBe(callerEntry);
    expect(callerEntries).toEqual([callerEntry]);
    expect(Object.isFrozen(callerEntry)).toBe(false);
    expect(Object.isFrozen(callerEntries)).toBe(false);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.entries)).toBe(true);
    expect(Object.isFrozen(projection.entries[0])).toBe(true);
    expect(Object.isFrozen(projection.byKind.deposit)).toBe(true);
    expect(Object.isFrozen(projection.legacyPayment)).toBe(true);
  });

  test("moves one deposit monotonically through prepared, sent, processing, and paid", () => {
    const prepared = plan([]);
    const sent = plan(prepared.projection.entries, { nextState: "sent" });
    const processing = plan(sent.projection.entries, { nextState: "processing" });
    const paid = plan(processing.projection.entries, {
      nextState: "paid",
      providerSettledAtISO: SETTLED_AT
    });

    expect(prepared).toMatchObject({
      apply: true,
      reason: "new_operation",
      projection: {
        depositStatus: "unpaid",
        byKind: { deposit: { state: "prepared" } }
      }
    });
    expect(sent.projection).toMatchObject({
      depositStatus: "sent",
      byKind: { deposit: { state: "sent" } }
    });
    expect(processing.projection).toMatchObject({
      depositStatus: "sent",
      byKind: { deposit: { state: "processing" } }
    });
    expect(paid.projection).toMatchObject({
      depositStatus: "paid",
      netPaidCents: DEPOSIT_CENTS,
      finalDueCents: FINAL_BALANCE_CENTS,
      byKind: {
        deposit: {
          state: "paid",
          paidCents: DEPOSIT_CENTS,
          providerSettledAtISO: SETTLED_AT
        },
        finalBalance: { state: "not_started" }
      },
      legacyPayment: {
        depositStatus: "paid",
        depositConfirmedAtISO: SETTLED_AT,
        stripeSessionId: "cs_test_deposit_1",
        stripeCheckoutState: "paid"
      }
    });
  });

  test("recognizes an exact provider transition replay without changing the ledger", () => {
    const paidEntries = paidDepositEntries();
    const replay = plan(paidEntries, {
      nextState: "paid",
      providerSettledAtISO: SETTLED_AT
    });

    expect(replay).toMatchObject({
      apply: false,
      reason: "already_applied",
      projection: { netPaidCents: DEPOSIT_CENTS, depositStatus: "paid" }
    });
    expect(replay.projection.entries).toEqual(paidEntries);
  });

  test("keeps final balance independent and reaches zero due only after both payments settle", () => {
    const depositEntries = paidDepositEntries();
    const finalPrepared = plan(depositEntries, {
      operationId: "final-1",
      paymentKind: "final_balance",
      amountCents: FINAL_BALANCE_CENTS,
      providerReference: "cs_test_final_1"
    });
    const finalPaid = plan(finalPrepared.projection.entries, {
      operationId: "final-1",
      paymentKind: "final_balance",
      amountCents: FINAL_BALANCE_CENTS,
      nextState: "paid",
      providerReference: "cs_test_final_1",
      providerSettledAtISO: "2026-08-04T12:30:00.000Z"
    });

    expect(finalPrepared.projection).toMatchObject({
      netPaidCents: DEPOSIT_CENTS,
      finalDueCents: FINAL_BALANCE_CENTS,
      depositStatus: "paid",
      byKind: {
        deposit: { state: "paid" },
        finalBalance: { state: "prepared" }
      }
    });
    expect(finalPaid.projection).toMatchObject({
      totalCents: 100_000,
      netPaidCents: 100_000,
      finalDueCents: 0,
      depositStatus: "paid",
      byKind: {
        deposit: { state: "paid", paidCents: DEPOSIT_CENTS },
        finalBalance: { state: "paid", paidCents: FINAL_BALANCE_CENTS }
      }
    });
  });

  test.each([
    ["deposit", [], "deposit-generic", DEPOSIT_CENTS, "cs_test_generic_deposit"],
    [
      "final_balance",
      paidDepositEntries(),
      "final-generic",
      FINAL_BALANCE_CENTS,
      "cs_test_generic_final"
    ]
  ])(
    "applies the same monotonic processing path to %s operations",
    (paymentKind, initialEntries, operationId, amountCents, providerReference) => {
      const prepared = plan(initialEntries, {
        operationId,
        paymentKind,
        amountCents,
        providerReference
      });
      const processing = plan(prepared.projection.entries, {
        operationId,
        paymentKind,
        amountCents,
        nextState: "processing",
        providerReference
      });
      const paid = plan(processing.projection.entries, {
        operationId,
        paymentKind,
        amountCents,
        nextState: "paid",
        providerReference,
        providerSettledAtISO: SETTLED_AT
      });
      const kindProjection = paymentKind === "deposit"
        ? paid.projection.byKind.deposit
        : paid.projection.byKind.finalBalance;

      expect(processing.entry.state).toBe("processing");
      expect(kindProjection).toMatchObject({
        state: "paid",
        paidCents: amountCents,
        settledOperationId: operationId
      });
    }
  );

  test.each(["failed", "expired"])(
    "accepts %s as a terminal final-balance observation",
    (nextState) => {
      const depositEntries = paidDepositEntries();
      const prepared = plan(depositEntries, {
        operationId: `final-${nextState}`,
        paymentKind: "final_balance",
        amountCents: FINAL_BALANCE_CENTS,
        providerReference: `cs_test_final_${nextState}`
      });
      const terminal = plan(prepared.projection.entries, {
        operationId: `final-${nextState}`,
        paymentKind: "final_balance",
        amountCents: FINAL_BALANCE_CENTS,
        nextState,
        providerReference: `cs_test_final_${nextState}`
      });

      expect(terminal.projection.byKind).toMatchObject({
        deposit: { state: "paid" },
        finalBalance: { state: nextState }
      });
      expect(terminal.projection.finalDueCents).toBe(FINAL_BALANCE_CENTS);
    }
  );

  test.each(["failed", "expired"])(
    "allows a new operation after a %s attempt while retaining the terminal attempt",
    (terminalState) => {
      const prepared = plan([]);
      const terminal = plan(prepared.projection.entries, { nextState: terminalState });
      const replacement = plan(terminal.projection.entries, {
        operationId: `deposit-after-${terminalState}`,
        providerReference: `cs_test_after_${terminalState}`
      });

      expect(terminal.projection.byKind.deposit.state).toBe(terminalState);
      expect(replacement.projection.entries).toHaveLength(2);
      expect(replacement.projection.entries[0].state).toBe(terminalState);
      expect(replacement.projection.byKind.deposit).toMatchObject({
        state: "prepared",
        activeOperationId: `deposit-after-${terminalState}`
      });
    }
  );

  test.each(["failed", "expired"])(
    "records a late provider settlement after %s for the same operation",
    (observedState) => {
      const prepared = plan(paidDepositEntries(), {
        operationId: `final-late-${observedState}`,
        paymentKind: "final_balance",
        amountCents: FINAL_BALANCE_CENTS,
        providerReference: `cs_test_final_late_${observedState}`
      });
      const observed = plan(prepared.projection.entries, {
        operationId: `final-late-${observedState}`,
        paymentKind: "final_balance",
        amountCents: FINAL_BALANCE_CENTS,
        nextState: observedState,
        providerReference: `cs_test_final_late_${observedState}`
      });
      const paid = plan(observed.projection.entries, {
        operationId: `final-late-${observedState}`,
        paymentKind: "final_balance",
        amountCents: FINAL_BALANCE_CENTS,
        nextState: "paid",
        providerReference: `cs_test_final_late_${observedState}`,
        providerSettledAtISO: SETTLED_AT
      });

      expect(paid.projection).toMatchObject({
        finalDueCents: 0,
        byKind: {
          finalBalance: {
            state: "paid",
            settledOperationId: `final-late-${observedState}`
          }
        }
      });
    }
  );

  test("allows a zero-deposit quote to collect its entire total as final balance", () => {
    const finalPrepared = planPaymentLedgerTransition({
      quoteTotals: { total: 250, deposit: 0 },
      entries: [],
      operationId: "zero-deposit-final",
      paymentKind: "final_balance",
      amountCents: 25_000,
      nextState: "prepared",
      providerReference: "cs_test_zero_deposit_final"
    });

    expect(finalPrepared.projection).toMatchObject({
      totalCents: 25_000,
      depositCents: 0,
      finalBalanceCents: 25_000,
      finalDueCents: 25_000,
      depositStatus: "unpaid",
      byKind: { finalBalance: { state: "prepared" } }
    });
  });

  test("rejects final-balance activity before a nonzero deposit is provider-settled", () => {
    expect(() => plan([], {
      operationId: "final-too-soon",
      paymentKind: "final_balance",
      amountCents: FINAL_BALANCE_CENTS,
      providerReference: "cs_test_final_too_soon"
    })).toThrow(/provider-settled deposit/i);
  });

  test("rejects a final-balance amount that differs from the authoritative remainder", () => {
    expect(() => plan(paidDepositEntries(), {
      operationId: "final-wrong-amount",
      paymentKind: "final_balance",
      amountCents: FINAL_BALANCE_CENTS - 1,
      providerReference: "cs_test_final_wrong_amount"
    })).toThrow(/authoritative quote amount/i);
  });

  test.each([
    ["prepared after sent", "sent", "prepared"],
    ["sent after processing", "processing", "sent"],
    ["failed after paid", "paid", "failed"],
    ["prepared after expired", "expired", "prepared"]
  ])("rejects the state regression %s", (_label, currentState, nextState) => {
    let entries = plan([]).projection.entries;
    if (currentState === "processing") {
      entries = plan(entries, { nextState: "processing" }).projection.entries;
    } else if (currentState !== "prepared") {
      entries = plan(entries, {
        nextState: currentState,
        ...(currentState === "paid" ? { providerSettledAtISO: SETTLED_AT } : {})
      }).projection.entries;
    }

    expect(() => plan(entries, {
      nextState,
      ...(nextState === "paid" ? { providerSettledAtISO: SETTLED_AT } : {})
    })).toThrow(/cannot move/i);
  });

  test("rejects changing an operation's kind, amount, or provider identity", () => {
    const prepared = plan([]).projection.entries;

    expect(() => plan(prepared, {
      paymentKind: "final_balance",
      amountCents: FINAL_BALANCE_CENTS,
      nextState: "sent"
    })).toThrow(/identity or amount/i);
    expect(() => plan(prepared, {
      amountCents: DEPOSIT_CENTS + 1,
      nextState: "sent"
    })).toThrow(/identity or amount/i);
    expect(() => plan(prepared, {
      nextState: "sent",
      providerReference: "cs_test_replacement_identity"
    })).toThrow(/cannot change/i);
  });

  test("rejects a non-prepared initial state and a second active operation", () => {
    expect(() => plan([], { nextState: "sent" })).toThrow(/must start in prepared/i);

    const prepared = plan([]).projection.entries;
    expect(() => plan(prepared, {
      operationId: "deposit-concurrent",
      providerReference: "cs_test_deposit_concurrent"
    })).toThrow(/already active or settled/i);
  });

  test.each([
    ["negative total", { total: -1, deposit: 0 }],
    ["negative deposit", { total: 10, deposit: -1 }],
    ["deposit above total", { total: 10, deposit: 11 }],
    ["unsafe cents", {
      totalCents: Number.MAX_SAFE_INTEGER + 1,
      depositCents: 0
    }],
    ["incomplete cents", { totalCents: 1000 }],
    ["missing deposit", { total: 10 }]
  ])("rejects %s quote totals", (_label, quoteTotals) => {
    expect(() => projectPaymentLedger({ quoteTotals })).toThrow(PaymentLedgerError);
  });

  test.each([
    ["negative", -1],
    ["zero", 0],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["wrong deposit", DEPOSIT_CENTS + 1]
  ])("rejects a %s ledger amount", (_label, amountCents) => {
    expect(() => projectPaymentLedger({
      quoteTotals: QUOTE_TOTALS,
      entries: [{
        operationId: `invalid-${_label}`,
        paymentKind: "deposit",
        amountCents,
        state: "prepared",
        providerReference: "",
        providerSettledAtISO: ""
      }]
    })).toThrow(PaymentLedgerError);
  });

  test("rejects duplicate settled operations that overpay the quote", () => {
    const paidEntry = (operationId, providerReference) => ({
      operationId,
      paymentKind: "deposit",
      amountCents: 60_000,
      state: "paid",
      providerReference,
      providerSettledAtISO: SETTLED_AT
    });
    expect(() => projectPaymentLedger({
      quoteTotals: { totalCents: 100_000, depositCents: 60_000 },
      entries: [
        paidEntry("deposit-overpay-1", "cs_test_overpay_1"),
        paidEntry("deposit-overpay-2", "cs_test_overpay_2")
      ]
    })).toThrow(/overpayment/i);
  });

  test.each([
    ["paid without provider reference", {
      state: "paid",
      providerReference: "",
      providerSettledAtISO: SETTLED_AT
    }],
    ["paid without settlement time", {
      state: "paid",
      providerReference: "cs_test_paid_missing_time",
      providerSettledAtISO: ""
    }],
    ["sent without provider reference", {
      state: "sent",
      providerReference: "",
      providerSettledAtISO: ""
    }],
    ["unpaid with settlement time", {
      state: "prepared",
      providerReference: "cs_test_prepared_with_time",
      providerSettledAtISO: SETTLED_AT
    }]
  ])("rejects %s", (_label, evidence) => {
    expect(() => projectPaymentLedger({
      quoteTotals: QUOTE_TOTALS,
      entries: [{
        operationId: `evidence-${_label.replaceAll(" ", "-")}`,
        paymentKind: "deposit",
        amountCents: DEPOSIT_CENTS,
        ...evidence
      }]
    })).toThrow(PaymentLedgerError);
  });

  test("rejects duplicate operation and provider identities", () => {
    const base = {
      paymentKind: "deposit",
      amountCents: DEPOSIT_CENTS,
      state: "failed",
      providerSettledAtISO: ""
    };
    expect(() => projectPaymentLedger({
      quoteTotals: QUOTE_TOTALS,
      entries: [
        { ...base, operationId: "duplicate-op", providerReference: "cs_test_unique_1" },
        { ...base, operationId: "duplicate-op", providerReference: "cs_test_unique_2" }
      ]
    })).toThrow(/operation ids must be unique/i);
    expect(() => projectPaymentLedger({
      quoteTotals: QUOTE_TOTALS,
      entries: [
        { ...base, operationId: "unique-op-1", providerReference: "cs_test_duplicate" },
        { ...base, operationId: "unique-op-2", providerReference: "cs_test_duplicate" }
      ]
    })).toThrow(/provider references must be unique/i);
  });

  test("accepts an exact legacy deposit projection for compatibility", () => {
    const paidEntries = paidDepositEntries();
    const first = projectPaymentLedger({ quoteTotals: QUOTE_TOTALS, entries: paidEntries });
    const verified = projectPaymentLedger({
      quoteTotals: QUOTE_TOTALS,
      entries: paidEntries,
      legacyPayment: first.legacyPayment
    });

    expect(verified.legacyPayment).toEqual(first.legacyPayment);
    expect(verified.depositStatus).toBe("paid");
  });

  test.each([
    ["status", { depositStatus: "sent", depositConfirmedAtISO: SETTLED_AT }],
    ["confirmation", {
      depositStatus: "paid",
      depositConfirmedAtISO: "2026-08-04T12:01:00.000Z"
    }],
    ["session", {
      depositStatus: "paid",
      depositConfirmedAtISO: SETTLED_AT,
      stripeSessionId: "cs_test_wrong"
    }],
    ["checkout state", {
      depositStatus: "paid",
      depositConfirmedAtISO: SETTLED_AT,
      stripeCheckoutState: "processing"
    }],
    ["unsupported refunded state", {
      depositStatus: "refunded",
      depositConfirmedAtISO: SETTLED_AT
    }]
  ])("rejects inconsistent legacy %s", (_label, legacyPayment) => {
    expect(() => projectPaymentLedger({
      quoteTotals: QUOTE_TOTALS,
      entries: paidDepositEntries(),
      legacyPayment
    })).toThrow(PaymentLedgerError);
  });
});
