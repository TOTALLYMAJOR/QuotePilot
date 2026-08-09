import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  cloudFunctions: { id: "functions" }
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockState.httpsCallable
}));

vi.mock("../firebase", () => ({
  cloudFunctions: mockState.cloudFunctions,
  firebaseReady: true
}));

import {
  beginPostEventCloseoutAttempt,
  clearPendingPostEventCloseoutAttempt,
  isDefinitivePostEventCloseoutError,
  readPendingPostEventCloseoutAttempt,
  readPendingPostEventCloseoutConfigurationAttempt,
  recordPostEventCloseoutReview,
  refreshPostEventCloseoutConfiguration,
  resetDefinitivePostEventCloseoutConfigurationAttempt
} from "../postEventCloseoutClient";

function input(overrides = {}) {
  return {
    organizationId: "org-one",
    quoteId: "quote-one",
    closeoutId: `closeout_${"a".repeat(48)}`,
    itemCode: "internal_closeout",
    action: "review",
    note: "Reviewed internal notes.",
    requestId: `closeout_${"b".repeat(32)}`,
    ...overrides
  };
}

function response(request = input(), overrides = {}) {
  return {
    ok: true,
    storage: "firebase",
    organizationId: request.organizationId,
    quoteId: request.quoteId,
    closeoutId: request.closeoutId,
    state: "pending",
    receipt: {
      receiptId: `closeout_action_${"c".repeat(48)}`,
      requestId: request.requestId,
      itemCode: request.itemCode,
      action: request.action,
      applied: true,
      recordedAtISO: "2026-08-13T15:00:00.000Z"
    },
    ...overrides
  };
}

describe("post-event closeout client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.httpsCallable.mockReturnValue(mockState.callable);
  });

  test("sends only opaque scope and review fields and requires the exact receipt", async () => {
    const request = input();
    mockState.callable.mockResolvedValue({ data: response(request) });

    await expect(recordPostEventCloseoutReview(request)).resolves.toMatchObject({
      state: "pending",
      mutationMode: "submitting",
      receipt: { requestId: request.requestId }
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "recordPostEventCloseoutReview"
    );
    expect(mockState.callable).toHaveBeenCalledWith(request);
    expect(readPendingPostEventCloseoutAttempt(request)).toBeNull();
  });

  test("retains an ambiguous attempt and reconciles the exact request identity", async () => {
    const request = input({ itemCode: "thank_you", requestId: `closeout_${"d".repeat(32)}` });
    const unavailable = Object.assign(new Error("network unavailable"), {
      code: "functions/unavailable"
    });
    mockState.callable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ data: response(request) });

    await expect(recordPostEventCloseoutReview(request)).rejects.toThrow("network unavailable");
    expect(readPendingPostEventCloseoutAttempt(request)).toMatchObject({
      requestId: request.requestId,
      definitive: false
    });
    await expect(recordPostEventCloseoutReview(request)).resolves.toMatchObject({
      mutationMode: "reconciliation"
    });
    expect(mockState.callable).toHaveBeenNthCalledWith(1, request);
    expect(mockState.callable).toHaveBeenNthCalledWith(2, request);
  });

  test("rejects changed input while an exact request remains unresolved", () => {
    const request = input({ itemCode: "review_request", requestId: `closeout_${"e".repeat(32)}` });
    const attempt = beginPostEventCloseoutAttempt(request);
    expect(() => beginPostEventCloseoutAttempt({ ...request, note: "Changed note" }))
      .toThrow(/reconciled unchanged/i);
    expect(clearPendingPostEventCloseoutAttempt(attempt, "safe_reset")).toBe(true);
  });

  test.each([
    ["functions/failed-precondition", true],
    ["functions/permission-denied", true],
    ["functions/unavailable", false],
    ["deadline-exceeded", false]
  ])("classifies %s without inventing an action outcome", (code, expected) => {
    expect(isDefinitivePostEventCloseoutError({ code })).toBe(expected);
  });

  test("refreshes blocked configuration through a separate exact receipt without reviewing an item", async () => {
    const request = input({ requestId: `closeout_${"f".repeat(32)}` });
    mockState.callable.mockResolvedValue({
      data: {
        ...response(request),
        receipt: {
          ...response(request).receipt,
          action: "refresh_configuration"
        }
      }
    });

    await expect(refreshPostEventCloseoutConfiguration({
      organizationId: request.organizationId,
      quoteId: request.quoteId,
      closeoutId: request.closeoutId,
      requestId: request.requestId
    })).resolves.toMatchObject({
      mutationMode: "submitting",
      receipt: { action: "refresh_configuration", requestId: request.requestId }
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "refreshPostEventCloseoutConfiguration"
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      organizationId: request.organizationId,
      quoteId: request.quoteId,
      closeoutId: request.closeoutId,
      requestId: request.requestId
    });
    expect(readPendingPostEventCloseoutConfigurationAttempt(request)).toBeNull();
    expect(resetDefinitivePostEventCloseoutConfigurationAttempt(request)).toBe(false);
  });
});
