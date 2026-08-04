import fs from "node:fs";
import { describe, expect, test } from "vitest";
import {
  friendlyBuyerAccessError,
  getBuyerAccessStatusMessage,
  isBuyerAccessVerificationConfigured,
  readBuyerAccessReturn,
  shouldContinueBuyerAccessPolling
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

  test("keeps every browser state non-authoritative while exposing safe paid setup", () => {
    expect(getBuyerAccessStatusMessage("").text).toMatch(/cannot grant access/i);
    expect(getBuyerAccessStatusMessage("invoice_open").text).toMatch(/cannot mark.*paid|cannot.*grant access/i);
    expect(getBuyerAccessStatusMessage("payment_processing").text).toMatch(/access remains locked/i);
    expect(getBuyerAccessStatusMessage("provisioning").text).toMatch(/no payment has been claimed/i);
    expect(getBuyerAccessStatusMessage("provisioning", { workspaceReady: true }).text)
      .toMatch(/exact email on the Stripe invoice/i);
    expect(getBuyerAccessStatusMessage("provisioning", { workspaceReady: true }).text)
      .toMatch(/does not grant access or claim.*email was sent/i);
    expect(getBuyerAccessStatusMessage("activation_sent").text)
      .toMatch(/exact email on the Stripe invoice/i);
    expect(getBuyerAccessStatusMessage("activation_sent").text)
      .toMatch(/provider accepted.*inbox delivery is not proven/i);
    expect(getBuyerAccessStatusMessage("activation_sent").text)
      .toMatch(/does not grant access/i);
    expect(getBuyerAccessStatusMessage("void").text).toMatch(/fresh test request/i);
    expect(getBuyerAccessStatusMessage("void").text).toMatch(/24-hour email window/i);
    expect(getBuyerAccessStatusMessage("active").title).toBe("Your workspace is ready");
  });

  test("stops automatic status reads once workspace preparation can hand off to Firebase", () => {
    expect(shouldContinueBuyerAccessPolling({
      status: "provisioning",
      workspaceReady: false
    })).toBe(true);
    expect(shouldContinueBuyerAccessPolling({
      status: "provisioning",
      workspaceReady: true
    })).toBe(false);
    expect(shouldContinueBuyerAccessPolling({
      status: "activation_sent",
      workspaceReady: true
    })).toBe(false);
    expect(shouldContinueBuyerAccessPolling({
      status: "payment_failed",
      workspaceReady: false
    })).toBe(false);
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
    expect(BUYER_PAGE_SOURCE).toContain("Create my $1 test invoice");
    expect(BUYER_PAGE_SOURCE).toContain("Stripe test mode — no live charge");
    expect(BUYER_PAGE_SOURCE).toContain("4242 4242 4242 4242");
    expect(BUYER_PAGE_SOURCE).toContain("never enter a real card");
    expect(BUYER_PAGE_SOURCE).not.toContain("one-time purchase");
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
    expect(BUYER_PAGE_SOURCE).toContain("Register or sign in with my invoice email");
    expect(BUYER_PAGE_SOURCE).toContain("Start a new test request");
    expect(BUYER_PAGE_SOURCE).toContain("clearBuyerAccessStatusContext()");
    expect(BUYER_PAGE_SOURCE).not.toContain("activation link");
    expect(BUYER_PAGE_SOURCE).not.toContain("already has a workspace");
  });
});
