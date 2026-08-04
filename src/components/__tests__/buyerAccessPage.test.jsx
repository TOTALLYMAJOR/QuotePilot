import fs from "node:fs";
import { describe, expect, test } from "vitest";
import {
  friendlyBuyerAccessError,
  getBuyerAccessStatusMessage,
  isAlreadyScopedBuyerError,
  readBuyerAccessReturn
} from "../BuyerAccessPage";

const BUYER_PAGE_SOURCE = fs.readFileSync(
  new URL("../BuyerAccessPage.jsx", import.meta.url),
  "utf8"
);

describe("buyer access page authority boundaries", () => {
  test("reads a success return only when it includes a valid Checkout Session", () => {
    expect(readBuyerAccessReturn("?purchase=success&session_id=cs_test_buyer_1"))
      .toEqual({
        purchase: "success",
        sessionId: "cs_test_buyer_1",
        hasInvalidSessionId: false
      });
    expect(readBuyerAccessReturn("?purchase=success&session_id=forged"))
      .toEqual({
        purchase: "success",
        sessionId: "",
        hasInvalidSessionId: true
      });
  });

  test("never presents a successful return as access-ready without active server status", () => {
    expect(getBuyerAccessStatusMessage("").title).toBe("Verifying your purchase");
    expect(getBuyerAccessStatusMessage("checkout_pending").text)
      .toMatch(/has not granted access yet/i);
    expect(getBuyerAccessStatusMessage("payment_processing").text)
      .toMatch(/access remains locked/i);
    expect(getBuyerAccessStatusMessage("active").title)
      .toBe("Your workspace is ready");
  });

  test("recognizes only the backend's exact already-scoped failure", () => {
    const alreadyScoped = Object.assign(
      new Error("This account already has QuotePilot organization access."),
      { code: "functions/failed-precondition" }
    );
    expect(isAlreadyScopedBuyerError(alreadyScoped)).toBe(true);
    expect(friendlyBuyerAccessError(alreadyScoped)).toMatch(/already has/i);
    expect(isAlreadyScopedBuyerError(Object.assign(
      new Error("Unrelated precondition"),
      { code: "functions/failed-precondition" }
    ))).toBe(false);
  });

  test("does not expose unknown provider or internal error text", () => {
    expect(friendlyBuyerAccessError(new Error("provider secret detail")))
      .toBe("QuotePilot could not complete the request. Try again or contact support.");
  });

  test("keeps the controlled pilot sign-in-only before server allowlist checks", () => {
    expect(BUYER_PAGE_SOURCE).toContain("Sign in with your approved account");
    expect(BUYER_PAGE_SOURCE).toContain("does not create public accounts");
    expect(BUYER_PAGE_SOURCE).not.toContain("registerWithEmail");
    expect(BUYER_PAGE_SOURCE).not.toContain("Create account");
  });
});
