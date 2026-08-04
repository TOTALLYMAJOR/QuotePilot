import fs from "node:fs";
import { describe, expect, test } from "vitest";
import {
  friendlyBuyerAccessError,
  getBuyerAccessStatusMessage,
  isBuyerAccessVerificationConfigured,
  readBuyerAccessReturn
} from "../BuyerAccessPage";

const BUYER_PAGE_SOURCE = fs.readFileSync(
  new URL("../BuyerAccessPage.jsx", import.meta.url),
  "utf8"
);

describe("buyer invoice page authority boundaries", () => {
  test("ignores every payment or status identity supplied through the URL", () => {
    expect(readBuyerAccessReturn("?order=ba-forged")).toEqual({
      hasIgnoredStatusQuery: true
    });
    expect(readBuyerAccessReturn("?statusToken=never-read-from-query")).toEqual({
      hasIgnoredStatusQuery: true
    });
    expect(readBuyerAccessReturn("?campaign=starter")).toEqual({
      hasIgnoredStatusQuery: false
    });
  });

  test("fails closed when the public flow lacks its Turnstile site key", () => {
    expect(isBuyerAccessVerificationConfigured()).toBe(false);
    expect(isBuyerAccessVerificationConfigured({ siteKey: "1x00000000000000000000AA" })).toBe(true);
    expect(isBuyerAccessVerificationConfigured({ siteKey: "replace_me" })).toBe(false);
    expect(isBuyerAccessVerificationConfigured({ e2eBypass: true })).toBe(true);
  });

  test("keeps every browser state non-authoritative until activation is observed", () => {
    expect(getBuyerAccessStatusMessage("").text).toMatch(/cannot grant access/i);
    expect(getBuyerAccessStatusMessage("invoice_open").text).toMatch(/cannot mark.*paid|cannot.*grant access/i);
    expect(getBuyerAccessStatusMessage("payment_processing").text).toMatch(/access remains locked/i);
    expect(getBuyerAccessStatusMessage("provisioning").text).toMatch(/no payment has been claimed/i);
    expect(getBuyerAccessStatusMessage("provisioning", { workspaceReady: true }).text)
      .toMatch(/verified the paid invoice/i);
    expect(getBuyerAccessStatusMessage("activation_sent").text).toMatch(/verified-email activation instructions/i);
    expect(getBuyerAccessStatusMessage("active").title).toBe("Your workspace is ready");
  });

  test("keeps account-existence failures generic on the public surface", () => {
    const accountSpecific = Object.assign(
      new Error("This account already has QuotePilot organization access."),
      { code: "functions/failed-precondition" }
    );
    expect(friendlyBuyerAccessError(accountSpecific))
      .toBe("QuotePilot could not complete the invoice request. Try again or contact support.");
  });

  test("does not expose unknown provider or internal error text", () => {
    expect(friendlyBuyerAccessError(new Error("provider secret detail")))
      .toBe("QuotePilot could not complete the request. Try again or contact support.");
  });

  test("renders public invoice intake without a pre-payment login", () => {
    expect(BUYER_PAGE_SOURCE).toContain("Create my $1 invoice");
    expect(BUYER_PAGE_SOURCE).toContain("name=\"organizationName\"");
    expect(BUYER_PAGE_SOURCE).toContain("name=\"ownerName\"");
    expect(BUYER_PAGE_SOURCE).toContain("name=\"ownerEmail\"");
    expect(BUYER_PAGE_SOURCE).toContain("VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY");
    expect(BUYER_PAGE_SOURCE).toContain("window.turnstile.reset");
    expect(BUYER_PAGE_SOURCE).toContain("setTurnstileResetNonce");
    expect(BUYER_PAGE_SOURCE).not.toContain("onAuthStateChanged");
    expect(BUYER_PAGE_SOURCE).not.toContain("signInWithEmail");
    expect(BUYER_PAGE_SOURCE).not.toContain("type=\"password\"");
    expect(BUYER_PAGE_SOURCE).not.toContain("localStorage");
    expect(BUYER_PAGE_SOURCE).toContain("hasIgnoredStatusQuery");
    expect(BUYER_PAGE_SOURCE).not.toContain("activation link");
    expect(BUYER_PAGE_SOURCE).not.toContain("already has a workspace");
  });
});
