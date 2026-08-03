import { describe, expect, test } from "vitest";
import { sanitizeStripePaymentLink } from "../paymentLink";

describe("Stripe payment-link safety", () => {
  test("allows only exact HTTPS Stripe checkout hosts", () => {
    expect(sanitizeStripePaymentLink("https://checkout.stripe.com/c/pay/cs_test_123")).toBe(
      "https://checkout.stripe.com/c/pay/cs_test_123"
    );
    expect(sanitizeStripePaymentLink("https://buy.stripe.com/test_123")).toBe(
      "https://buy.stripe.com/test_123"
    );
    expect(sanitizeStripePaymentLink("http://checkout.stripe.com/c/pay/cs_test_123")).toBe("");
    expect(sanitizeStripePaymentLink("https://checkout.stripe.com.evil.test/pay")).toBe("");
    expect(sanitizeStripePaymentLink("https://user@checkout.stripe.com/pay")).toBe("");
    expect(sanitizeStripePaymentLink("javascript:alert(1)")).toBe("");
  });
});
