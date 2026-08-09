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
  KITCHEN_BEO_CALLABLES,
  generateKitchenBeo,
  getKitchenBeoArtifactStatus,
  getKitchenBeoReceiptArtifact,
  isDefinitiveKitchenBeoError,
  readPendingKitchenBeoAttempt,
  resetDefinitiveKitchenBeoAttempt
} from "../kitchenBeoClient";

function scope(suffix = "one") {
  return {
    organizationId: `org-${suffix}`,
    quoteId: `quote-${suffix}`
  };
}

function status(state = "CURRENT", overrides = {}) {
  return {
    state,
    authority: "server_derived",
    schemaVersion: "kitchen-beo-artifact-status-v1",
    commercialSourceRevisionId: "v0014",
    currentDependencyFingerprint: "a".repeat(64),
    receiptId: `beo_${"f".repeat(48)}`,
    receiptDependencyFingerprint: "b".repeat(64),
    reasonCodes: ["trusted_receipt_matches_canonical_source"],
    unresolvedInvalidationIds: [],
    observedAtISO: "2026-08-09T19:00:00.000Z",
    ...overrides
  };
}

function request(suffix = "a", scopeSuffix = suffix) {
  return {
    ...scope(scopeSuffix),
    requestId: `beo_request_${suffix.repeat(32)}`
  };
}

function generationResponse(input, overrides = {}) {
  return {
    ok: true,
    storage: "firebase",
    organizationId: input.organizationId,
    quoteId: input.quoteId,
    idempotent: false,
    receipt: {
      receiptId: `beo_${"f".repeat(48)}`,
      requestId: input.requestId,
      commercialSourceRevisionId: "v0014",
      dependencyFingerprint: "8a29b9f6f892483a5a9f86b3694a425a2e31cd585edaae881c0102726c012345",
      generatedAtISO: "2026-08-09T18:42:00.000Z"
    },
    status: status(),
    artifact: {
      mimeType: "application/pdf",
      filename: "QP-2042-2026-08-16-rev14-kitchen-beo.pdf",
      base64: Buffer.from("%PDF-1.4\ntrusted kitchen beo\n", "utf8").toString("base64")
    },
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.httpsCallable.mockReturnValue(mockState.callable);
});

describe("Kitchen BEO client read contract", () => {
  test("sends only opaque scope and accepts only an exact server status projection", async () => {
    const input = scope("read");
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...input,
        status: status("STALE", {
          reasonCodes: ["declared_inputs_changed"],
          unresolvedInvalidationIds: ["invalidation-beo"]
        })
      }
    });

    await expect(getKitchenBeoArtifactStatus({
      ...input,
      payload: { guests: 9_999 },
      dependencyFingerprint: "client-forged"
    })).resolves.toMatchObject({
      state: "STALE",
      reasonCodes: ["declared_inputs_changed"]
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      KITCHEN_BEO_CALLABLES.status
    );
    expect(mockState.callable).toHaveBeenCalledWith(input);
  });

  test("rejects wrong-tenant and unknown freshness projections", async () => {
    const input = scope("wrong-read");
    mockState.callable.mockResolvedValueOnce({
      data: {
        ok: true,
        storage: "firebase",
        organizationId: "org-other",
        quoteId: input.quoteId,
        status: status()
      }
    });
    await expect(getKitchenBeoArtifactStatus(input)).rejects.toThrow(/exact server projection/i);

    mockState.callable.mockResolvedValueOnce({
      data: {
        ok: true,
        storage: "firebase",
        ...input,
        status: status("CLIENT_CURRENT")
      }
    });
    await expect(getKitchenBeoArtifactStatus(input)).rejects.toThrow(/exact server projection/i);
  });

  test("downloads an exact prior receipt without creating a new generation request", async () => {
    const input = {
      ...scope("download"),
      receiptId: `beo_${"d".repeat(48)}`
    };
    const artifact = {
      mimeType: "application/pdf",
      filename: "QP-2042-prior-kitchen-beo.pdf",
      base64: Buffer.from("%PDF-1.4\nprior immutable kitchen beo\n", "utf8").toString("base64")
    };
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        organizationId: input.organizationId,
        quoteId: input.quoteId,
        receipt: {
          receiptId: input.receiptId,
          filename: artifact.filename
        },
        artifact
      }
    });

    await expect(getKitchenBeoReceiptArtifact({
      ...input,
      artifact: { base64: "browser-forged" }
    })).resolves.toMatchObject({
      receipt: { receiptId: input.receiptId },
      artifact: { filename: artifact.filename }
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      KITCHEN_BEO_CALLABLES.download
    );
    expect(mockState.callable).toHaveBeenCalledWith(input);
    expect(readPendingKitchenBeoAttempt(input)).toBeNull();
  });
});

describe("Kitchen BEO client mutation receipts", () => {
  test("accepts the exact request receipt and immutable PDF artifact then clears the attempt", async () => {
    const input = request("a", "generate");
    mockState.callable.mockResolvedValue({ data: generationResponse(input) });

    await expect(generateKitchenBeo({
      ...input,
      payload: { customer: "must not cross the boundary" },
      provenance: { generatedBy: "browser" }
    })).resolves.toMatchObject({
      ok: true,
      storage: "firebase",
      organizationId: input.organizationId,
      quoteId: input.quoteId,
      mutationMode: "submitting",
      receipt: { requestId: input.requestId },
      status: { state: "CURRENT" },
      artifact: { mimeType: "application/pdf" }
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      KITCHEN_BEO_CALLABLES.generate
    );
    expect(mockState.callable).toHaveBeenCalledWith(input);
    expect(readPendingKitchenBeoAttempt(input)).toBeNull();
  });

  test("retains an uncertain outcome and reconciles the unchanged request identity", async () => {
    const input = request("b", "uncertain");
    const unavailable = Object.assign(new Error("network unavailable"), {
      code: "functions/unavailable"
    });
    mockState.callable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ data: generationResponse(input, { idempotent: true }) });

    await expect(generateKitchenBeo(input)).rejects.toThrow("network unavailable");
    expect(readPendingKitchenBeoAttempt(input)).toMatchObject({
      requestId: input.requestId,
      definitive: false,
      error: "network unavailable"
    });

    await expect(generateKitchenBeo(scope("uncertain"))).resolves.toMatchObject({
      idempotent: true,
      mutationMode: "reconciliation",
      receipt: { requestId: input.requestId }
    });
    expect(mockState.callable).toHaveBeenNthCalledWith(1, input);
    expect(mockState.callable).toHaveBeenNthCalledWith(2, input);
    expect(readPendingKitchenBeoAttempt(input)).toBeNull();
  });

  test("rejects a mismatched receipt or unsafe artifact without inventing success", async () => {
    const mismatched = request("c", "mismatch");
    mockState.callable.mockResolvedValueOnce({
      data: generationResponse(mismatched, {
        receipt: {
          ...generationResponse(mismatched).receipt,
          requestId: `beo_request_${"d".repeat(32)}`
        }
      })
    });
    await expect(generateKitchenBeo(mismatched)).rejects.toThrow(/exact artifact receipt/i);
    expect(readPendingKitchenBeoAttempt(mismatched)).toMatchObject({
      requestId: mismatched.requestId,
      definitive: false
    });

    const unsafe = request("e", "unsafe-artifact");
    mockState.callable.mockResolvedValueOnce({
      data: generationResponse(unsafe, {
        artifact: {
          ...generationResponse(unsafe).artifact,
          filename: "../kitchen-beo.pdf"
        }
      })
    });
    await expect(generateKitchenBeo(unsafe)).rejects.toThrow(/exact artifact receipt/i);
  });

  test("keeps a definitive failure until an explicit exact-scope reset", async () => {
    const input = request("f", "definitive");
    const denied = Object.assign(new Error("generation not permitted"), {
      code: "functions/failed-precondition"
    });
    mockState.callable.mockRejectedValueOnce(denied);

    await expect(generateKitchenBeo(input)).rejects.toThrow("generation not permitted");
    expect(isDefinitiveKitchenBeoError(denied)).toBe(true);
    expect(readPendingKitchenBeoAttempt(input)).toMatchObject({
      requestId: input.requestId,
      definitive: true
    });
    expect(resetDefinitiveKitchenBeoAttempt(scope("other"))).toBe(false);
    expect(resetDefinitiveKitchenBeoAttempt(input)).toBe(true);
    expect(readPendingKitchenBeoAttempt(input)).toBeNull();
  });
});
