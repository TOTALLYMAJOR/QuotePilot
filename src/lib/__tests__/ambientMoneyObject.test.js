import { describe, expect, test } from "vitest";
import { buildAmbientMoneyObject } from "../ambientMoneyObject";

function quote(overrides = {}) {
  return {
    id: "quote-money-proof",
    activeVersionId: "v0004",
    status: "accepted",
    updatedAtISO: "2026-08-11T12:00:00.000Z",
    totals: { total: 10000, deposit: 3000 },
    pricing: {
      authority: "server_authoritative",
      calculatedAt: "2026-08-11T11:59:00.000Z",
      currency: "usd",
      grandTotal: 10000,
      deposit: { amount: 3000, pct: 0.3 }
    },
    payment: {
      depositStatus: "unpaid",
      depositLink: "",
      finalBalance: {
        amountCents: 700000,
        currency: "usd",
        status: "unpaid",
        paymentLink: "",
        confirmedAtISO: "",
        stripeSessionId: "",
        stripeCheckoutState: "",
        checkoutGeneration: 0
      }
    },
    ...overrides
  };
}

function stage(model, id) {
  return model.stages.find((entry) => entry.id === id);
}

describe("Ambient Money intelligent object", () => {
  test("keeps policy, requests, and settlement in five distinct evidence domains", () => {
    const model = buildAmbientMoneyObject(quote(), { sourceMode: "firebase" });
    expect(model.stages.map((entry) => entry.id)).toEqual([
      "deposit-policy",
      "deposit-request",
      "deposit-settlement",
      "balance-request",
      "final-settlement"
    ]);
    expect(stage(model, "deposit-policy")).toMatchObject({
      state: "recorded",
      evidenceAuthority: "server_authoritative_pricing",
      amountCents: 300000,
      percentage: 0.3
    });
    expect(stage(model, "deposit-request").state).toBe("not_requested");
    expect(stage(model, "deposit-settlement").state).toBe("not_settled");
    expect(stage(model, "balance-request").amountCents).toBe(700000);
    expect(model.descriptor.dependencies).toHaveLength(4);
    expect(model.descriptor.doNothing).toMatch(/Nothing is requested, collected, reconciled, or repriced/iu);
    expect(model.descriptor.doNothing).toMatch(/deposit policy: recorded/iu);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.stages)).toBe(true);
  });

  test("records a connected deposit request without claiming payment", () => {
    const model = buildAmbientMoneyObject(quote({
      payment: {
        depositStatus: "sent",
        depositLink: "https://checkout.stripe.com/c/pay/cs_test_deposit_request",
        stripeSessionId: "cs_test_deposit_request",
        stripeCheckoutState: "open",
        finalBalance: quote().payment.finalBalance
      }
    }), { sourceMode: "firebase" });
    expect(stage(model, "deposit-request")).toMatchObject({
      state: "provider_request_recorded",
      evidenceAuthority: "firebase_backed_provider_checkout"
    });
    expect(stage(model, "deposit-settlement")).toMatchObject({
      state: "not_settled",
      evidenceAuthority: "none"
    });
    expect(model.nextResolution).toMatch(/verified deposit provider result/iu);
  });

  test("requires connected provider reference and timestamp evidence before confirming a deposit", () => {
    const paid = quote({
      payment: {
        depositStatus: "paid",
        depositLink: "",
        stripeSessionId: "cs_test_deposit_paid",
        stripeCheckoutState: "paid",
        depositConfirmedAtISO: "2026-08-11T12:30:00.000Z",
        finalBalance: quote().payment.finalBalance
      }
    });
    expect(stage(buildAmbientMoneyObject(paid, { sourceMode: "firebase" }), "deposit-settlement"))
      .toMatchObject({ state: "provider_confirmed_paid", providerReferencePresent: true });
    expect(stage(buildAmbientMoneyObject(paid), "deposit-settlement"))
      .toMatchObject({ state: "recorded_unverified", evidenceAuthority: "local_record_only" });
  });

  test("keeps final-balance request separate from final settlement", () => {
    const basePayment = {
      depositStatus: "paid",
      depositLink: "",
      stripeSessionId: "cs_test_deposit_paid",
      stripeCheckoutState: "paid",
      depositConfirmedAtISO: "2026-08-11T12:30:00.000Z"
    };
    const requested = buildAmbientMoneyObject(quote({
      status: "booked",
      payment: {
        ...basePayment,
        finalBalance: {
          amountCents: 700000,
          currency: "usd",
          status: "sent",
          paymentLink: "https://checkout.stripe.com/c/pay/cs_test_balance_request",
          confirmedAtISO: "",
          stripeSessionId: "cs_test_balance_request",
          stripeCheckoutState: "open",
          checkoutGeneration: 1
        }
      }
    }), { sourceMode: "firebase" });
    expect(stage(requested, "balance-request").state).toBe("provider_request_recorded");
    expect(stage(requested, "final-settlement").state).toBe("not_settled");

    const settled = buildAmbientMoneyObject(quote({
      status: "booked",
      payment: {
        ...basePayment,
        finalBalance: {
          amountCents: 700000,
          currency: "usd",
          status: "paid",
          paymentLink: "",
          confirmedAtISO: "2026-08-12T09:00:00.000Z",
          stripeSessionId: "cs_test_balance_paid",
          stripeCheckoutState: "paid",
          checkoutGeneration: 1
        }
      }
    }), { sourceMode: "firebase" });
    expect(stage(settled, "balance-request").state).toBe("superseded_by_settlement");
    expect(stage(settled, "final-settlement")).toMatchObject({
      state: "provider_confirmed_paid",
      amountCents: 700000
    });
  });

  test("fails closed on contradictory pricing, request, and settlement evidence", () => {
    const model = buildAmbientMoneyObject(quote({
      pricing: {
        authority: "server_authoritative",
        calculatedAt: "2026-08-11T11:59:00.000Z",
        grandTotal: 10000,
        deposit: { amount: 2500 }
      },
      payment: {
        depositStatus: "paid",
        depositConfirmedAtISO: "browser-return-success",
        finalBalance: {
          amountCents: 123,
          status: "paid",
          confirmedAtISO: "2026-08-12T09:00:00.000Z"
        }
      }
    }), { sourceMode: "firebase" });
    expect(stage(model, "deposit-policy").state).toBe("unavailable");
    expect(stage(model, "deposit-settlement").state).toBe("unavailable");
    expect(stage(model, "balance-request").state).toBe("unavailable");
    expect(stage(model, "final-settlement").state).toBe("unavailable");
    expect(model.descriptor.confidence.level).toBe("unavailable");
  });

  test("ignores browser-return-shaped fields as payment evidence and never mutates the quote", () => {
    const input = quote({
      payment: {
        ...quote().payment,
        browserReturn: "success"
      }
    });
    const before = JSON.stringify(input);
    const model = buildAmbientMoneyObject(input, { sourceMode: "firebase" });
    expect(stage(model, "deposit-settlement").state).toBe("not_settled");
    expect(model.boundary).toMatch(/Browser returns/iu);
    expect(JSON.stringify(input)).toBe(before);
  });
});
