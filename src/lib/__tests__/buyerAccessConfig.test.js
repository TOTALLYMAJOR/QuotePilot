import { describe, expect, test } from "vitest";
import { isBuyerAccessEnabled } from "../buyerAccessConfig";

describe("buyer access public rollout flag", () => {
  test.each(["1", "true", "YES", "on"])("enables the public route and CTA for %s", (value) => {
    expect(isBuyerAccessEnabled({ VITE_BUYER_ACCESS_ENABLED: value })).toBe(true);
  });

  test("fails closed for production-like environments without explicit enablement", () => {
    expect(isBuyerAccessEnabled({})).toBe(false);
    expect(isBuyerAccessEnabled({ VITE_BUYER_ACCESS_ENABLED: "false" })).toBe(false);
  });

  test("allows the isolated browser adapter only in an explicit E2E build", () => {
    expect(isBuyerAccessEnabled({ VITE_E2E_BYPASS_AUTH: "true" })).toBe(true);
  });
});
