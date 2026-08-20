import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  callable: vi.fn(),
  cloudFunctions: { id: "mock-functions" },
  httpsCallable: vi.fn()
}));

vi.mock("../firebase", () => ({
  cloudFunctions: mockState.cloudFunctions,
  firebaseReady: true
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockState.httpsCallable
}));

import {
  buildBuyerAccessRepairConfirmationToken,
  repairBuyerAccessInvoice
} from "../commerceOps";

const ORDER_ID = `ba-${"a".repeat(40)}`;
const CONFIRMATION_TOKEN = `VOID BUYER INVOICE ${ORDER_ID}`;

function validResponse(overrides = {}) {
  return {
    ok: true,
    orderId: ORDER_ID,
    status: "void",
    providerState: "void",
    providerVoidVerified: true,
    emailWindowStillApplies: true,
    providerMutation: "voided",
    auditEventId: "stripe-buyer-repair-123e4567-e89b-42d3-a456-426614174000",
    ...overrides
  };
}

describe("buyer access repair callable client contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.httpsCallable.mockReturnValue(mockState.callable);
  });

  test("builds exact confirmation and accepts a privacy-minimal authoritative response", async () => {
    mockState.callable.mockResolvedValue({ data: validResponse() });

    expect(buildBuyerAccessRepairConfirmationToken(ORDER_ID.toUpperCase()))
      .toBe(CONFIRMATION_TOKEN);
    await expect(repairBuyerAccessInvoice({
      orderId: ORDER_ID,
      confirmationToken: CONFIRMATION_TOKEN
    })).resolves.toEqual(validResponse());
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "repairBuyerAccessInvoice"
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      confirmationToken: CONFIRMATION_TOKEN
    });
  });

  test.each([
    ["invalid order", { orderId: "ba-invalid", confirmationToken: "" }],
    ["wrong confirmation", { orderId: ORDER_ID, confirmationToken: `VOID ${ORDER_ID}` }]
  ])("rejects %s before calling the provider", async (_label, payload) => {
    await expect(repairBuyerAccessInvoice(payload)).rejects.toThrow();
    expect(mockState.callable).not.toHaveBeenCalled();
  });

  test.each([
    ["paid provider state", { providerState: "paid" }],
    ["unverified provider void", { providerVoidVerified: false }],
    ["missing email-window guard", { emailWindowStillApplies: false }],
    ["unsafe URL", { hostedInvoiceUrl: "https://invoice.stripe.com/i/private" }],
    ["missing audit", { auditEventId: "" }]
  ])("rejects a response with %s", async (_label, overrides) => {
    mockState.callable.mockResolvedValue({ data: validResponse(overrides) });
    await expect(repairBuyerAccessInvoice({
      orderId: ORDER_ID,
      confirmationToken: CONFIRMATION_TOKEN
    })).rejects.toThrow(/invalid authoritative response/i);
  });
});
