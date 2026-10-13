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
  beginPostEventActualAttendanceAttempt,
  clearPendingPostEventCloseoutAttempt,
  isDefinitivePostEventCloseoutError,
  readPendingPostEventCloseoutAttempt,
  readPendingPostEventActualAttendanceAttempt,
  readPendingPostEventCloseoutConfigurationAttempt,
  recordPostEventActualAttendance,
  recordPostEventCloseoutReview,
  refreshPostEventCloseoutConfiguration,
  resetDefinitivePostEventActualAttendanceAttempt,
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

function attendanceInput(overrides = {}) {
  return {
    organizationId: "org-one",
    quoteId: "quote-one",
    closeoutId: `closeout_${"a".repeat(48)}`,
    action: "record",
    requestId: `attendance_${"d".repeat(32)}`,
    expectedRevision: 0,
    count: 118,
    sourceType: "staff_observed",
    note: "Lead server confirmed the final served headcount.",
    ...overrides
  };
}

function attendanceResponse(request = attendanceInput(), overrides = {}) {
  const actualAttendance = {
    schemaVersion: 1,
    revision: request.expectedRevision + 1,
    count: request.count,
    sourceType: request.sourceType,
    note: request.note,
    sourceReferenceId: `closeout_attendance_${"e".repeat(48)}`,
    recordedAtISO: "2026-08-15T15:30:00.000Z",
    recordedBy: { email: "owner@example.test", role: "admin" },
    lastReceiptId: `closeout_attendance_${"e".repeat(48)}`
  };
  return {
    ok: true,
    storage: "firebase",
    organizationId: request.organizationId,
    quoteId: request.quoteId,
    closeoutId: request.closeoutId,
    postEventCloseout: { actualAttendance },
    receipt: {
      receiptId: actualAttendance.lastReceiptId,
      requestId: request.requestId,
      action: request.action,
      priorRevision: request.expectedRevision,
      resultRevision: request.expectedRevision + 1,
      count: request.count,
      sourceType: request.sourceType,
      recordedAtISO: actualAttendance.recordedAtISO
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

  test("records actual attendance through the exact closeout callable and verifies the receipt projection", async () => {
    const request = attendanceInput();
    mockState.callable.mockResolvedValue({ data: attendanceResponse(request) });

    await expect(recordPostEventActualAttendance(request)).resolves.toMatchObject({
      mutationMode: "submitting",
      receipt: {
        requestId: request.requestId,
        count: request.count,
        resultRevision: 1
      },
      postEventCloseout: {
        actualAttendance: {
          count: request.count,
          sourceType: request.sourceType,
          revision: 1
        }
      }
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "recordPostEventActualAttendance"
    );
    expect(mockState.callable).toHaveBeenCalledWith(request);
    expect(readPendingPostEventActualAttendanceAttempt(request)).toBeNull();
  });

  test("retains an uncertain attendance command and reconciles only the unchanged request", async () => {
    const request = attendanceInput({
      quoteId: "quote-uncertain",
      closeoutId: `closeout_${"f".repeat(48)}`
    });
    mockState.callable
      .mockRejectedValueOnce(Object.assign(new Error("network unavailable"), {
        code: "functions/unavailable"
      }))
      .mockResolvedValueOnce({ data: attendanceResponse(request) });

    await expect(recordPostEventActualAttendance(request))
      .rejects.toThrow("network unavailable");
    expect(readPendingPostEventActualAttendanceAttempt(request)).toMatchObject({
      requestId: request.requestId,
      definitive: false
    });
    expect(() => beginPostEventActualAttendanceAttempt({
      ...request,
      count: request.count + 1
    })).toThrow(/reconciled unchanged/i);
    await expect(recordPostEventActualAttendance(request)).resolves.toMatchObject({
      mutationMode: "reconciliation"
    });
  });

  test("rejects a mismatched attendance response and requires reset after a definitive rejection", async () => {
    const request = attendanceInput({
      quoteId: "quote-rejected",
      closeoutId: `closeout_${"9".repeat(48)}`
    });
    mockState.callable.mockResolvedValueOnce({
      data: attendanceResponse(request, {
        postEventCloseout: {
          actualAttendance: {
            ...attendanceResponse(request).postEventCloseout.actualAttendance,
            count: 119
          }
        }
      })
    });
    await expect(recordPostEventActualAttendance(request))
      .rejects.toThrow(/exact server receipt/i);
    expect(readPendingPostEventActualAttendanceAttempt(request)?.definitive).toBe(false);
    mockState.callable.mockResolvedValueOnce({ data: attendanceResponse(request) });
    await recordPostEventActualAttendance(request);

    const rejected = { ...request, requestId: `attendance_${"8".repeat(32)}` };
    mockState.callable.mockRejectedValueOnce(Object.assign(new Error("stale revision"), {
      code: "functions/aborted"
    }));
    await expect(recordPostEventActualAttendance(rejected))
      .rejects.toThrow("stale revision");
    expect(readPendingPostEventActualAttendanceAttempt(rejected)?.definitive).toBe(true);
    expect(resetDefinitivePostEventActualAttendanceAttempt(rejected)).toBe(true);
    expect(readPendingPostEventActualAttendanceAttempt(rejected)).toBeNull();
  });
});
