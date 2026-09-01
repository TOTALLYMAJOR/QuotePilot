// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildAmbientMoneyObject } from "../../lib/ambientMoneyObject";
import AmbientMoneyContext from "../AmbientMoneyContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function quote(payment = {}) {
  return {
    id: "money-ui-proof",
    activeVersionId: "v0002",
    updatedAtISO: "2026-08-11T12:00:00.000Z",
    totals: { total: 10000, deposit: 3000 },
    pricing: {
      authority: "server_authoritative",
      calculatedAt: "2026-08-11T11:55:00.000Z",
      currency: "usd",
      grandTotal: 10000,
      deposit: { amount: 3000 }
    },
    payment: {
      depositStatus: "unpaid",
      finalBalance: {
        amountCents: 700000,
        currency: "usd",
        status: "unpaid"
      },
      ...payment
    }
  };
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(model) {
  act(() => root.render(<AmbientMoneyContext model={model} />));
}

describe("Ambient Money context", () => {
  test("renders the five evidence domains with explicit judgment and next resolution", () => {
    render(buildAmbientMoneyObject(quote(), { sourceMode: "firebase" }));
    expect([...container.querySelectorAll("[data-money-stage]")].map((node) => node.dataset.moneyStage))
      .toEqual([
        "deposit-policy",
        "deposit-request",
        "deposit-settlement",
        "balance-request",
        "final-settlement"
      ]);
    expect(container.textContent).toContain("$3,000.00 · 30% of quote total");
    expect(container.textContent).toContain("Payment stages");
    expect(container.querySelector('[aria-label="Payment stages"]')).not.toBeNull();
    expect(container.textContent).toContain("Why this is shown");
    expect(container.querySelector('[data-context-arrival-duplicate="reason"]')?.textContent)
      .toContain("Why this is shown");
    expect(container.textContent).toContain("If nothing changes");
    expect(container.textContent).toContain("Confidence and source");
    expect(container.textContent).toContain("What you can do next");
  });

  test("shows a request receipt and a separate not-settled deposit state", () => {
    render(buildAmbientMoneyObject(quote({
      depositStatus: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/cs_test_money_ui",
      stripeSessionId: "cs_test_money_ui",
      stripeCheckoutState: "open"
    }), { sourceMode: "firebase" }));
    expect(container.querySelector('[data-money-stage="deposit-request"]')).toHaveProperty(
      "dataset.moneyStageState",
      "provider_request_recorded"
    );
    expect(container.querySelector('[data-money-stage="deposit-settlement"]')).toHaveProperty(
      "dataset.moneyStageState",
      "not_settled"
    );
    expect(container.textContent).toContain("This is not payment evidence");
  });

  test("labels local settlement-shaped evidence as unverified", () => {
    render(buildAmbientMoneyObject(quote({
      depositStatus: "paid",
      stripeSessionId: "cs_test_money_paid",
      stripeCheckoutState: "paid",
      depositConfirmedAtISO: "2026-08-11T12:30:00.000Z"
    }), { sourceMode: "local" }));
    expect(container.querySelector('[data-money-stage="deposit-settlement"]')).toHaveProperty(
      "dataset.moneyStageState",
      "recorded_unverified"
    );
    expect(container.textContent).toContain("Recorded in QuotePilot; not independently confirmed");
    expect(container.textContent).not.toContain("Local record only");
    expect(container.textContent).not.toContain("Provider-confirmed paid");
  });

  test("fails visibly when the model is unavailable", () => {
    render(null);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Payment details are unavailable");
  });
});
