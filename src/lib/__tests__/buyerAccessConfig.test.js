import { describe, expect, test } from "vitest";
import {
  getBuyerAccessTurnstileSiteKey,
  isBuyerAccessEnabled,
  isBuyerAccessPublicCtaEnabled,
  isBuyerAccessTurnstileConfigured
} from "../buyerAccessConfig";

describe("buyer access public rollout flag", () => {
  test.each(["1", "true", "YES", "on"])("enables the buyer route for %s", (value) => {
    expect(isBuyerAccessEnabled({ VITE_BUYER_ACCESS_ENABLED: value })).toBe(true);
  });

  test("fails closed for production-like environments without explicit enablement", () => {
    expect(isBuyerAccessEnabled({})).toBe(false);
    expect(isBuyerAccessEnabled({ VITE_BUYER_ACCESS_ENABLED: "false" })).toBe(false);
  });

  test("allows the isolated browser adapter only in an explicit E2E build", () => {
    expect(isBuyerAccessEnabled({ VITE_E2E_BYPASS_AUTH: "true" })).toBe(true);
  });

  test("requires both public flags and a valid Turnstile site key for the CTA", () => {
    expect(isBuyerAccessPublicCtaEnabled({
      VITE_BUYER_ACCESS_ENABLED: "true"
    })).toBe(false);
    expect(isBuyerAccessPublicCtaEnabled({
      VITE_BUYER_ACCESS_ENABLED: "true",
      VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "true"
    })).toBe(false);
    expect(isBuyerAccessPublicCtaEnabled({
      VITE_BUYER_ACCESS_ENABLED: "true",
      VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "true",
      VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
    })).toBe(true);
    expect(isBuyerAccessPublicCtaEnabled({
      VITE_BUYER_ACCESS_ENABLED: "false",
      VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "true",
      VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
    })).toBe(false);
  });

  test("normalizes and validates only public Turnstile site-key syntax", () => {
    const env = {
      VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: " 1x00000000000000000000AA "
    };
    expect(getBuyerAccessTurnstileSiteKey(env)).toBe("1x00000000000000000000AA");
    expect(isBuyerAccessTurnstileConfigured(env)).toBe(true);
    expect(isBuyerAccessTurnstileConfigured({
      VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: "replace_me"
    })).toBe(false);
  });
});
