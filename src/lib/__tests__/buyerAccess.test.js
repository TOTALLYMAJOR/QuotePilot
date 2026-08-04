import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const buyerMocks = vi.hoisted(() => ({
  cloudFunctions: { name: "test-functions" },
  callableResponses: new Map(),
  httpsCallable: vi.fn()
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: buyerMocks.httpsCallable
}));

vi.mock("../firebase", () => ({
  cloudFunctions: buyerMocks.cloudFunctions
}));

import {
  buildBuyerAccessInvoicePayload,
  createBuyerAccessInvoice,
  createBuyerAccessRequestId,
  getBuyerAccessInvoiceStatus,
  isBuyerAccessOrderId,
  isBuyerAccessRequestId,
  normalizeStripeHostedInvoiceUrl,
  readBuyerAccessRequestContext,
  readBuyerAccessStatusContext,
  redirectToBuyerAccessInvoice,
  storeBuyerAccessRequestContext
} from "../buyerAccess";

const REQUEST_ID = "90e1f410-92e0-4e1d-8f62-4e9c6f30eb9c";
const ORDER_ID = "ba-0123456789abcdef0123456789abcdef01234567";
const HOSTED_INVOICE_URL = "https://invoice.stripe.com/i/acct_test/test_invoice?s=em";
const TURNSTILE_TOKEN = "turnstile.test.response-token";

function setCallableResponse(name, value) {
  buyerMocks.callableResponses.set(name, value);
}

function validCreateResponse(overrides = {}) {
  return {
    orderId: ORDER_ID,
    statusToken: REQUEST_ID,
    hostedInvoiceUrl: HOSTED_INVOICE_URL,
    status: "invoice_open",
    ...overrides
  };
}

function validStatusResponse(status = "invoice_open", overrides = {}) {
  const activationReady = status === "activation_sent" || status === "active";
  return {
    orderId: ORDER_ID,
    status,
    activationEmailSent: activationReady,
    workspaceReady: activationReady,
    appUrl: status === "active" ? "/app" : null,
    hostedInvoiceUrl: ["invoice_open", "payment_failed"].includes(status)
      ? HOSTED_INVOICE_URL
      : null,
    ...overrides
  };
}

describe("buyer access invoice client", () => {
  beforeEach(() => {
    buyerMocks.callableResponses.clear();
    buyerMocks.httpsCallable.mockReset();
    buyerMocks.httpsCallable.mockImplementation((_functions, name) => async (payload) => {
      const response = buyerMocks.callableResponses.get(name);
      return {
        data: typeof response === "function" ? response(payload) : response
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("creates a UUIDv4 request identity without browser payment authority", () => {
    expect(createBuyerAccessRequestId({ randomUUID: () => REQUEST_ID })).toBe(REQUEST_ID);
    expect(isBuyerAccessRequestId(REQUEST_ID)).toBe(true);
    expect(isBuyerAccessRequestId("not-a-uuid")).toBe(false);
    expect(isBuyerAccessOrderId(ORDER_ID)).toBe(true);
    expect(isBuyerAccessOrderId("browser-buyer-order")).toBe(false);
  });

  test("normalizes only public owner identity, idempotency, and Turnstile fields", () => {
    expect(buildBuyerAccessInvoicePayload({
      organizationName: "  Acme   Events  ",
      ownerName: "  Avery   Owner  ",
      ownerEmail: "  OWNER@Example.COM ",
      requestId: REQUEST_ID.toUpperCase(),
      turnstileToken: TURNSTILE_TOKEN,
      amountCents: 5000,
      plan: "enterprise",
      invoiceId: "in_browser_controlled"
    })).toEqual({
      organizationName: "Acme Events",
      ownerName: "Avery Owner",
      ownerEmail: "owner@example.com",
      requestId: REQUEST_ID,
      turnstileToken: TURNSTILE_TOKEN
    });
  });

  test.each([
    [{ organizationName: "", ownerName: "Avery", ownerEmail: "owner@example.com", requestId: REQUEST_ID, turnstileToken: TURNSTILE_TOKEN }, "business name"],
    [{ organizationName: "Acme", ownerName: "", ownerEmail: "owner@example.com", requestId: REQUEST_ID, turnstileToken: TURNSTILE_TOKEN }, "owner name"],
    [{ organizationName: "Acme", ownerName: "Avery", ownerEmail: "invalid", requestId: REQUEST_ID, turnstileToken: TURNSTILE_TOKEN }, "valid email"],
    [{ organizationName: "Acme", ownerName: "Avery", ownerEmail: "owner@example.com", requestId: "forged", turnstileToken: TURNSTILE_TOKEN }, "request identity"],
    [{ organizationName: "Acme", ownerName: "Avery", ownerEmail: "owner@example.com", requestId: REQUEST_ID, turnstileToken: "" }, "security verification"]
  ])("rejects incomplete or forged public invoice input %#", (input, message) => {
    expect(() => buildBuyerAccessInvoicePayload(input)).toThrow(message);
  });

  test("creates a public invoice without requiring a Firebase sign-in", async () => {
    setCallableResponse("createBuyerAccessInvoice", (payload) => ({
      ...validCreateResponse(),
      echoedPayload: payload
    }));

    await expect(createBuyerAccessInvoice({
      organizationName: "Acme Events",
      ownerName: "Avery Owner",
      ownerEmail: "owner@example.com",
      requestId: REQUEST_ID,
      turnstileToken: TURNSTILE_TOKEN
    })).resolves.toEqual(validCreateResponse());

    expect(buyerMocks.httpsCallable).toHaveBeenCalledWith(
      buyerMocks.cloudFunctions,
      "createBuyerAccessInvoice"
    );
  });

  test.each([
    "http://invoice.stripe.com/i/acct_test/test_invoice",
    "https://invoice.stripe.com.evil.test/i/acct_test/test_invoice",
    "https://invoice.stripe.com:444/i/acct_test/test_invoice",
    "https://buyer:secret@invoice.stripe.com/i/acct_test/test_invoice",
    "https://invoice.stripe.com/not-an-invoice",
    "https://invoice.stripe.com/i/acct_test/test_invoice#fragment",
    "https://checkout.stripe.com/c/pay/cs_test_old_flow",
    "javascript:alert(1)",
    "data:text/html,not-stripe"
  ])("rejects a hosted invoice destination outside the exact allowlist: %s", (hostedInvoiceUrl) => {
    expect(() => normalizeStripeHostedInvoiceUrl(hostedInvoiceUrl)).toThrow("invalid Stripe URL");
  });

  test("requires the returned status token to match the UUIDv4 request", async () => {
    setCallableResponse("createBuyerAccessInvoice", validCreateResponse({
      statusToken: "5d96e5b3-0368-4b9e-a42a-9e758046103e"
    }));

    await expect(createBuyerAccessInvoice({
      organizationName: "Acme Events",
      ownerName: "Avery Owner",
      ownerEmail: "owner@example.com",
      requestId: REQUEST_ID,
      turnstileToken: TURNSTILE_TOKEN
    })).rejects.toThrow("did not match this request");
  });

  test.each([
    "invoice_open",
    "payment_processing",
    "provisioning",
    "activation_sent",
    "active",
    "payment_failed",
    "void",
    "expired"
  ])("accepts the privacy-minimal mapped %s status", async (status) => {
    setCallableResponse("getBuyerAccessInvoiceStatus", {
      ...validStatusResponse(status),
      customerId: "cus_private",
      invoiceId: "in_private",
      ownerEmail: "private@example.com"
    });

    const result = await getBuyerAccessInvoiceStatus({
      orderId: ORDER_ID,
      statusToken: REQUEST_ID
    });

    expect(result).toEqual(validStatusResponse(status));
    expect(result).not.toHaveProperty("customerId");
    expect(result).not.toHaveProperty("invoiceId");
    expect(result).not.toHaveProperty("ownerEmail");
    expect(buyerMocks.httpsCallable).toHaveBeenCalledWith(
      buyerMocks.cloudFunctions,
      "getBuyerAccessInvoiceStatus"
    );
  });

  test("allows active access to remain independent from activation-email delivery state", async () => {
    setCallableResponse("getBuyerAccessInvoiceStatus", validStatusResponse("active", {
      activationEmailSent: false
    }));
    await expect(getBuyerAccessInvoiceStatus({
      orderId: ORDER_ID,
      statusToken: REQUEST_ID
    })).resolves.toMatchObject({
      status: "active",
      activationEmailSent: false,
      workspaceReady: true,
      appUrl: "/app"
    });
  });

  test.each([false, true])(
    "allows provisioning to represent workspaceReady=%s without claiming activation email delivery",
    async (workspaceReady) => {
      setCallableResponse("getBuyerAccessInvoiceStatus", validStatusResponse("provisioning", {
        workspaceReady,
        activationEmailSent: false
      }));
      await expect(getBuyerAccessInvoiceStatus({
        orderId: ORDER_ID,
        statusToken: REQUEST_ID
      })).resolves.toMatchObject({
        status: "provisioning",
        workspaceReady,
        activationEmailSent: false
      });
    }
  );

  test.each([
    validStatusResponse("active", { workspaceReady: false }),
    validStatusResponse("activation_sent", { activationEmailSent: false }),
    validStatusResponse("provisioning", { activationEmailSent: true }),
    validStatusResponse("invoice_open", { appUrl: "/app" }),
    validStatusResponse("provisioning", { hostedInvoiceUrl: HOSTED_INVOICE_URL })
  ])("rejects conflicting public status evidence %#", async (response) => {
    setCallableResponse("getBuyerAccessInvoiceStatus", response);
    await expect(getBuyerAccessInvoiceStatus({
      orderId: ORDER_ID,
      statusToken: REQUEST_ID
    })).rejects.toThrow(/conflicting|incomplete/i);
  });

  test("persists an idempotent request before the callable and binds it to normalized identity", () => {
    const values = new Map();
    const sessionStorage = {
      getItem: vi.fn((key) => values.get(key) || null),
      setItem: vi.fn((key, value) => values.set(key, value)),
      removeItem: vi.fn((key) => values.delete(key))
    };
    const localStorage = { setItem: vi.fn() };
    const replaceState = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("window", {
      sessionStorage,
      localStorage,
      history: { replaceState },
      location: { assign }
    });

    expect(storeBuyerAccessRequestContext({
      organizationName: "  Acme   Events ",
      ownerName: " Avery Owner ",
      ownerEmail: " OWNER@Example.com ",
      requestId: REQUEST_ID
    })).toBe(true);
    expect(readBuyerAccessRequestContext()).toEqual({
      organizationName: "Acme Events",
      ownerName: "Avery Owner",
      ownerEmail: "owner@example.com",
      requestId: REQUEST_ID
    });
    expect(localStorage.setItem).not.toHaveBeenCalled();
    const serializedSession = Array.from(values.values()).join(" ");
    expect(serializedSession).not.toContain("invoice.stripe.com");
  });

  test("stores only the order and read-only token before redirecting to Stripe", () => {
    const values = new Map();
    const sessionStorage = {
      getItem: vi.fn((key) => values.get(key) || null),
      setItem: vi.fn((key, value) => values.set(key, value)),
      removeItem: vi.fn((key) => values.delete(key))
    };
    const localStorage = { setItem: vi.fn() };
    const replaceState = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("window", {
      sessionStorage,
      localStorage,
      history: { replaceState },
      location: { assign }
    });

    redirectToBuyerAccessInvoice(validCreateResponse());

    expect(replaceState).toHaveBeenCalledWith(null, "", "/start");
    expect(assign).toHaveBeenCalledWith(HOSTED_INVOICE_URL);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).toHaveBeenCalledOnce();
    const stored = JSON.parse(sessionStorage.setItem.mock.calls[0][1]);
    expect(stored).toEqual({ orderId: ORDER_ID, statusToken: REQUEST_ID });
    expect(JSON.stringify(stored)).not.toContain("invoice.stripe.com");
    expect(readBuyerAccessStatusContext()).toEqual({
      orderId: ORDER_ID,
      statusToken: REQUEST_ID
    });
  });

  test("does not leave for Stripe when session status recovery cannot be persisted", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      sessionStorage: {
        setItem: vi.fn(() => {
          throw new Error("storage disabled");
        })
      },
      history: { replaceState: vi.fn() },
      location: { assign }
    });

    expect(() => redirectToBuyerAccessInvoice(validCreateResponse()))
      .toThrow("Secure invoice status recovery is unavailable");
    expect(assign).not.toHaveBeenCalled();
  });
});
