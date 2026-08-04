import { describe, expect, test } from "vitest";
import {
  isBuyerAccessEnabled,
  isBuyerAccessPublicCtaEnabled
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

  test("keeps the public CTA separate from an allowlisted pilot route", () => {
    expect(isBuyerAccessPublicCtaEnabled({
      VITE_BUYER_ACCESS_ENABLED: "true"
    })).toBe(false);
    expect(isBuyerAccessPublicCtaEnabled({
      VITE_BUYER_ACCESS_ENABLED: "true",
      VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "true"
    })).toBe(true);
    expect(isBuyerAccessPublicCtaEnabled({
      VITE_BUYER_ACCESS_ENABLED: "false",
      VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "true"
    })).toBe(false);
  });
});
