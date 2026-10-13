import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  cloudFunctions: { id: "mock-functions" },
  httpsCallable: vi.fn(),
  callable: vi.fn(),
  normalizeOrganizationId: vi.fn()
}));

vi.mock("../firebase", () => ({
  cloudFunctions: mockState.cloudFunctions,
  firebaseReady: true
}));
vi.mock("../organizationService", () => ({
  normalizeOrganizationId: mockState.normalizeOrganizationId
}));
vi.mock("firebase/functions", () => ({
  httpsCallable: mockState.httpsCallable
}));

import {
  buildCustomerImportInputFingerprint,
  buildCustomerImportChunkPlan,
  createCustomerImportSession,
  createCustomerImportBatchId,
  createImportBatch,
  preflightCustomerImport,
  rollbackImportBatch
} from "../importBatchService";

const PREFLIGHT_PLAN_HASH = "a".repeat(64);
const PREFLIGHT_ID = `customer_preflight_${"b".repeat(32)}`;
const PREFLIGHT_EXPIRES_AT = "2099-01-01T00:00:00.000Z";

function customerRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    rowNumber: index + 2,
    record: {
      name: `Customer ${index + 1}`,
      email: `customer-${index + 1}@example.com`
    }
  }));
}

function serverPreflightResult(records, overrides = {}) {
  const distinctEmailCount = new Set(records
    .map((entry) => String(entry?.record?.email || "").trim().toLowerCase())
    .filter(Boolean)).size;
  return {
    ok: true,
    status: "ready",
    authority: "server_preflight",
    organizationId: "mbmapps-001",
    importType: "customers",
    sourceCount: records.length,
    preflightId: PREFLIGHT_ID,
    planHash: PREFLIGHT_PLAN_HASH,
    expiresAtISO: PREFLIGHT_EXPIRES_AT,
    chunks: [{
      sourceIndexes: records.map((_, index) => index),
      maximumWrites: records.length + distinctEmailCount + 2
    }],
    ...overrides
  };
}

async function acceptedPreflight(records, { fileName = "", ...overrides } = {}) {
  return {
    ...serverPreflightResult(records, overrides),
    inputFingerprint: await buildCustomerImportInputFingerprint({
      organizationId: "mbmapps-001",
      fileName,
      records
    })
  };
}

function acceptedChildReceipt(importBatchId, preflightChunkIndex, overrides = {}) {
  return {
    ok: true,
    status: "completed",
    importBatchId,
    organizationId: "mbmapps-001",
    importType: "customers",
    preflightId: PREFLIGHT_ID,
    preflightPlanHash: PREFLIGHT_PLAN_HASH,
    preflightChunkIndex,
    preflightSessionId: importBatchId.includes("_part_")
      ? importBatchId.replace(/_part_\d+$/, "")
      : importBatchId,
    ...overrides
  };
}

describe("tenant-locked import persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.normalizeOrganizationId.mockImplementation((value) => String(value || "").trim().toLowerCase());
    mockState.callable.mockResolvedValue({ data: { ok: true } });
    mockState.httpsCallable.mockReturnValue(mockState.callable);
  });

  test("fails closed when the authenticated organization is missing", async () => {
    await expect(createImportBatch({
      importType: "customers",
      records: [{ record: { name: "Michael Major", email: "flightcontrol@quietpilot.us" } }]
    })).rejects.toThrow(/destination organization is required/i);
    expect(mockState.httpsCallable).not.toHaveBeenCalled();
  });

  test("customer import always preflights and binds the exact source before create", async () => {
    const records = [{
      rowNumber: 2,
      record: {
        name: "Michael Major",
        email: "flightcontrol@quietpilot.us",
        organizationId: "attacker-org"
      }
    }];
    mockState.callable
      .mockResolvedValueOnce({ data: serverPreflightResult(records) })
      .mockResolvedValueOnce({
        data: acceptedChildReceipt("customer_import_batch_0001", 0, {
          createdCount: 1,
          skippedCount: 0
        })
      });
    const result = await createImportBatch({
      organizationId: "MBMapps-001",
      organizationName: "MBMapps",
      importType: "customers",
      fileName: "customers.csv",
      records,
      actor: { uid: "browser-spoof", email: "spoof@example.com" },
      importBatchId: "customer_import_batch_0001"
    });

    expect(mockState.httpsCallable.mock.calls.map(([, name]) => name)).toEqual([
      "preflightCustomerImportBatch",
      "createCustomerImportBatch"
    ]);
    expect(mockState.callable).toHaveBeenNthCalledWith(1, {
      organizationId: "mbmapps-001",
      fileName: "customers.csv",
      records
    });
    expect(mockState.callable).toHaveBeenNthCalledWith(2, {
      organizationId: "mbmapps-001",
      organizationName: "MBMapps",
      fileName: "customers.csv",
      records,
      importBatchId: "customer_import_batch_0001",
      preflightId: PREFLIGHT_ID,
      preflightPlanHash: PREFLIGHT_PLAN_HASH,
      preflightRecords: records,
      preflightChunkIndex: 0,
      preflightSessionId: "customer_import_batch_0001"
    });
    expect(mockState.callable.mock.calls[1][0]).not.toHaveProperty("actor");
    expect(result).toMatchObject({ ok: true, createdCount: 1 });
  });

  test("generates an opaque stable-format batch id when the caller does not supply one", async () => {
    const records = [{ rowNumber: 2, record: { name: "Michael Major", email: "flightcontrol@quietpilot.us" } }];
    mockState.callable
      .mockResolvedValueOnce({ data: serverPreflightResult(records) })
      .mockImplementationOnce(async (payload) => ({
        data: acceptedChildReceipt(payload.importBatchId, 0)
      }));
    await createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records
    });
    expect(mockState.callable.mock.calls[1][0].importBatchId).toMatch(/^customer_[a-f0-9]{32}$/);
    expect(createCustomerImportBatchId({ randomUUID: () => "12345678-1234-1234-1234-123456789abc" }))
      .toBe("customer_12345678123412341234123456789abc");
  });

  test("reuses an auto-generated customer batch id after an ambiguous client failure", async () => {
    const records = [{ rowNumber: 2, record: { name: "Retry Customer", email: "retry@example.com" } }];
    const preflight = await acceptedPreflight(records);
    mockState.callable
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockImplementationOnce(async (payload) => ({
        data: acceptedChildReceipt(payload.importBatchId, 0)
      }));

    await expect(createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records,
      preflight
    })).rejects.toThrow(/connection reset/i);
    const firstBatchId = mockState.callable.mock.calls[0][0].importBatchId;
    await createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records,
      preflight
    });
    expect(mockState.callable.mock.calls[1][0].importBatchId).toBe(firstBatchId);
  });

  test("returns server-owned duplicate decisions without browser collection scans", async () => {
    const records = [{ rowNumber: 2, record: { email: "existing@example.com" } }];
    mockState.callable
      .mockResolvedValueOnce({
        data: serverPreflightResult(records, {
          projectedCreateCount: 0,
          projectedSkipCount: 1,
          decisions: [{ rowNumber: 2, status: "skip", reason: "duplicate" }]
        })
      })
      .mockResolvedValueOnce({
        data: acceptedChildReceipt("customer_import_batch_0002", 0, {
          createdCount: 0,
          skippedCount: 1,
          skippedRows: [{ rowNumber: 2, reason: "duplicate" }]
        })
      });
    const result = await createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records,
      importBatchId: "customer_import_batch_0002"
    });
    expect(result).toMatchObject({ createdCount: 0, skippedCount: 1 });
    expect(mockState.httpsCallable).toHaveBeenCalledTimes(2);
  });

  test("preflights the exact tenant and rows through the server-owned planning callable", async () => {
    const records = customerRows(2);
    mockState.callable.mockResolvedValueOnce({
      data: serverPreflightResult(records, {
        importBatchId: "customer_preflight_0001",
        projectedCreateCount: 1,
        projectedSkipCount: 1,
        chunks: [{ sourceIndexes: [0, 1], projectedWriteCount: 6 }]
      })
    });

    const result = await preflightCustomerImport({
      organizationId: "MBMapps-001",
      fileName: "customers.csv",
      records
    });

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "preflightCustomerImportBatch"
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      organizationId: "mbmapps-001",
      fileName: "customers.csv",
      records
    });
    expect(result).toMatchObject({
      importBatchId: "customer_preflight_0001",
      projectedCreateCount: 1,
      projectedSkipCount: 1
    });
    expect(result.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test.each([
    {
      label: "duplicates a source row",
      chunks: [{ sourceIndexes: [0] }, { sourceIndexes: [0, 1] }],
      message: /invalid customer chunk plan/i
    },
    {
      label: "omits a source row",
      chunks: [{ sourceIndexes: [0] }],
      message: /did not account for every customer row/i
    },
    {
      label: "misstates its transaction write cost",
      chunks: [{ sourceIndexes: [0, 1], projectedWriteCount: 4 }],
      message: /does not match the server-declared write budget/i
    }
  ])("rejects a server chunk plan that $label", async ({ chunks, message }) => {
    const records = customerRows(2);
    mockState.callable.mockResolvedValueOnce({ data: serverPreflightResult(records, { chunks }) });

    await expect(preflightCustomerImport({
      organizationId: "mbmapps-001",
      records
    })).rejects.toThrow(message);
  });

  test("rejects a server chunk that exceeds the transaction-aware write budget", async () => {
    const records = customerRows(250);
    mockState.callable.mockResolvedValueOnce({
      data: serverPreflightResult(records, {
        chunks: [{ sourceIndexes: records.map((_, index) => index), projectedWriteCount: 501 }]
      })
    });

    await expect(preflightCustomerImport({
      organizationId: "mbmapps-001",
      records
    })).rejects.toThrow(/500-write transaction budget|safe import plan/i);
  });

  test("keeps 249 unique-email rows together and splits before a 250th would exceed 500 writes", () => {
    const safeRows = customerRows(249);
    const safePlan = buildCustomerImportChunkPlan(safeRows);
    expect(safePlan).toHaveLength(1);
    expect(safePlan[0]).toHaveLength(249);
    expect(safePlan[0].length + new Set(safePlan[0].map(({ record }) => record.email)).size + 2).toBe(500);

    expect(buildCustomerImportChunkPlan(customerRows(250)).map((chunk) => chunk.length)).toEqual([249, 1]);
  });

  test("uses stable child identities across replay and aggregates every child receipt", async () => {
    const records = customerRows(3);
    const preflight = await acceptedPreflight(records, {
      fileName: "customers.csv",
      chunks: [{ sourceIndexes: [0, 1] }, { sourceIndexes: [2] }]
    });
    const firstReceipts = [
      acceptedChildReceipt("customer_session_001_part_001", 0, {
        createdCount: 2,
        skippedCount: 0,
        createdRecords: [{ id: "customer-a" }, { id: "customer-b" }]
      }),
      acceptedChildReceipt("customer_session_001_part_002", 1, {
        createdCount: 0,
        skippedCount: 1,
        skippedRows: [{ rowNumber: 4, reason: "duplicate" }]
      })
    ];
    const replayReceipts = firstReceipts.map((receipt) => ({ ...receipt, replayed: true }));
    [...firstReceipts, ...replayReceipts].forEach((receipt) => {
      mockState.callable.mockResolvedValueOnce({ data: receipt });
    });

    const input = {
      organizationId: "mbmapps-001",
      organizationName: "MBMapps",
      fileName: "customers.csv",
      records,
      importBatchId: "customer_session_001",
      preflight
    };
    const first = await createCustomerImportSession(input);
    const replay = await createCustomerImportSession(input);

    expect(mockState.callable.mock.calls.map(([payload]) => payload.importBatchId)).toEqual([
      "customer_session_001_part_001",
      "customer_session_001_part_002",
      "customer_session_001_part_001",
      "customer_session_001_part_002"
    ]);
    expect(mockState.callable.mock.calls.every(([payload]) => (
      payload.preflightPlanHash === PREFLIGHT_PLAN_HASH
      && payload.preflightId === PREFLIGHT_ID
      && payload.preflightRecords === records
      && Number.isSafeInteger(payload.preflightChunkIndex)
      && payload.preflightSessionId === "customer_session_001"
    ))).toBe(true);
    expect(first).toMatchObject({
      ok: true,
      status: "completed",
      importType: "customers",
      importBatchId: "customer_session_001",
      childBatchIds: ["customer_session_001_part_001", "customer_session_001_part_002"],
      createdCount: 2,
      skippedCount: 1
    });
    expect(first.createdRecords).toHaveLength(2);
    expect(first.skippedRows).toEqual([{ rowNumber: 4, reason: "duplicate" }]);
    expect(replay.childReceipts.every(({ replayed }) => replayed)).toBe(true);
  });

  test("returns exact partial-result metadata when a later child fails", async () => {
    const records = customerRows(3);
    const preflight = await acceptedPreflight(records, {
      chunks: [{ sourceIndexes: [0, 1] }, { sourceIndexes: [2] }]
    });
    mockState.callable
      .mockResolvedValueOnce({
        data: acceptedChildReceipt("customer_session_partial_part_001", 0, {
          createdCount: 2,
          skippedCount: 0,
          createdRecords: [{ id: "customer-a" }, { id: "customer-b" }]
        })
      })
      .mockRejectedValueOnce(Object.assign(new Error("connection reset"), { code: "unavailable" }));

    let failure;
    try {
      await createCustomerImportSession({
        organizationId: "mbmapps-001",
        records,
        importBatchId: "customer_session_partial",
        preflight
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: "CustomerImportSessionError",
      code: "unavailable",
      message: "connection reset",
      failedPart: 2,
      partialResult: {
        ok: true,
        status: "partial",
        importType: "customers",
        importBatchId: "customer_session_partial",
        childBatchIds: ["customer_session_partial_part_001"],
        createdCount: 2,
        skippedCount: 0
      }
    });
    expect(failure.cause).toBeInstanceOf(Error);
    expect(mockState.callable).toHaveBeenCalledTimes(2);
  });

  test("rejects changed rows and resolved failed child results instead of manufacturing completion", async () => {
    const records = customerRows(2);
    const preflight = await acceptedPreflight(records, {
      fileName: "customers.csv",
      chunks: [{ sourceIndexes: [0, 1] }]
    });

    await expect(createCustomerImportSession({
      organizationId: "mbmapps-001",
      fileName: "customers.csv",
      records: [{ ...records[0], record: { ...records[0].record, name: "Changed" } }, records[1]],
      importBatchId: "customer_session_changed",
      preflight
    })).rejects.toThrow(/changed after preflight/i);
    expect(mockState.callable).not.toHaveBeenCalled();

    mockState.callable.mockResolvedValueOnce({
      data: {
        ok: false,
        status: "failed",
        error: "A child batch did not return an accepted receipt."
      }
    });
    await expect(createCustomerImportSession({
      organizationId: "mbmapps-001",
      fileName: "customers.csv",
      records,
      importBatchId: "customer_session_failed",
      preflight
    })).rejects.toMatchObject({
      name: "CustomerImportSessionError",
      failedPart: 1,
      message: "A child batch did not return an accepted receipt."
    });
  });

  test("does not expose a customer create path without an accepted server preflight receipt", async () => {
    const records = customerRows(1);

    await expect(createCustomerImportSession({
      organizationId: "mbmapps-001",
      records,
      importBatchId: "customer_session_unbound"
    })).rejects.toThrow(/run server preflight again/i);

    expect(mockState.httpsCallable).not.toHaveBeenCalled();
  });

  test("rejects unsupported record types and invalid batch sizes before calling the server", async () => {
    await expect(createImportBatch({
      organizationId: "mbmapps-001",
      importType: "quotes",
      records: [{ rowNumber: 2, record: { name: "Not supported" } }]
    })).rejects.toThrow(/supported import record type/i);

    await expect(createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records: []
    })).rejects.toThrow(/no valid records/i);
    expect(mockState.httpsCallable).not.toHaveBeenCalled();
  });

  test("customer rollback uses the authoritative callable", async () => {
    mockState.callable.mockResolvedValueOnce({
      data: {
        ok: true,
        importBatchId: "customer_import_batch_0001",
        organizationId: "mbmapps-001",
        importType: "customers",
        deletedCount: 1,
        protectedCount: 1,
        missingCount: 0,
        protectedRecords: [{ id: "customer-protected" }],
        status: "rolled_back"
      }
    });
    const result = await rollbackImportBatch({
      organizationId: "mbmapps-001",
      importBatchId: "customer_import_batch_0001"
    });

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "rollbackCustomerImportBatch"
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      organizationId: "mbmapps-001",
      importBatchId: "customer_import_batch_0001"
    });
    expect(result).toMatchObject({ deletedCount: 1, protectedCount: 1, status: "rolled_back" });
  });

  test("rolls back every child in reverse creation order and aggregates the receipts", async () => {
    mockState.callable
      .mockResolvedValueOnce({
        data: {
          ok: true,
          status: "rolled_back",
          importBatchId: "customer_session_001_part_002",
          organizationId: "mbmapps-001",
          importType: "customers",
          deletedCount: 1,
          protectedCount: 0,
          missingCount: 0,
          protectedRecords: []
        }
      })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          status: "rolled_back",
          importBatchId: "customer_session_001_part_001",
          organizationId: "mbmapps-001",
          importType: "customers",
          deletedCount: 2,
          protectedCount: 1,
          missingCount: 1,
          protectedRecords: [{ id: "customer-protected" }]
        }
      });

    const result = await rollbackImportBatch({
      organizationId: "mbmapps-001",
      importBatchId: "customer_session_001",
      childBatchIds: ["customer_session_001_part_001", "customer_session_001_part_002"],
      importType: "customers"
    });

    expect(mockState.callable.mock.calls.map(([payload]) => payload.importBatchId)).toEqual([
      "customer_session_001_part_002",
      "customer_session_001_part_001"
    ]);
    expect(result).toMatchObject({
      ok: true,
      status: "rolled_back",
      importType: "customers",
      importBatchId: "customer_session_001",
      childBatchIds: ["customer_session_001_part_001", "customer_session_001_part_002"],
      deletedCount: 3,
      protectedCount: 1,
      missingCount: 1,
      protectedRecords: [{ id: "customer-protected" }]
    });
    expect(result.childReceipts.map(({ importBatchId }) => importBatchId)).toEqual([
      "customer_session_001_part_002",
      "customer_session_001_part_001"
    ]);
  });

  test.each([
    {
      label: "reports failure",
      receipt: {
        ok: false,
        status: "failed",
        importBatchId: "customer_session_bad_part_001",
        organizationId: "mbmapps-001",
        importType: "customers"
      }
    },
    {
      label: "reports the wrong status",
      receipt: {
        ok: true,
        status: "completed",
        importBatchId: "customer_session_bad_part_001",
        organizationId: "mbmapps-001",
        importType: "customers"
      }
    },
    {
      label: "reports a different batch identity",
      receipt: {
        ok: true,
        status: "rolled_back",
        importBatchId: "customer_session_other_part_001",
        organizationId: "mbmapps-001",
        importType: "customers",
        deletedCount: 0,
        protectedCount: 0,
        missingCount: 0,
        protectedRecords: []
      }
    }
  ])("preserves rollback failure when a resolved child $label", async ({ receipt }) => {
    mockState.callable.mockResolvedValueOnce({ data: receipt });

    await expect(rollbackImportBatch({
      organizationId: "mbmapps-001",
      importBatchId: "customer_session_bad",
      childBatchIds: ["customer_session_bad_part_001"],
      importType: "customers"
    })).rejects.toMatchObject({
      name: "CustomerImportSessionError",
      failedBatchId: "customer_session_bad_part_001",
      partialResult: {
        ok: false,
        status: "partial",
        importBatchId: "customer_session_bad",
        childReceipts: [],
        deletedCount: 0,
        protectedCount: 0,
        missingCount: 0
      }
    });
  });

  test("preserves successful rollback evidence when a later reverse-order child resolves as failed", async () => {
    mockState.callable
      .mockResolvedValueOnce({
        data: {
          ok: true,
          status: "rolled_back",
          importBatchId: "customer_session_partial_part_002",
          organizationId: "mbmapps-001",
          importType: "customers",
          deletedCount: 2,
          protectedCount: 0,
          missingCount: 0,
          protectedRecords: []
        }
      })
      .mockResolvedValueOnce({
        data: {
          ok: false,
          status: "failed",
          importBatchId: "customer_session_partial_part_001",
          error: "Rollback was rejected."
        }
      });

    await expect(rollbackImportBatch({
      organizationId: "mbmapps-001",
      importBatchId: "customer_session_partial",
      childBatchIds: [
        "customer_session_partial_part_001",
        "customer_session_partial_part_002"
      ],
      importType: "customers"
    })).rejects.toMatchObject({
      name: "CustomerImportSessionError",
      message: "Rollback was rejected.",
      failedBatchId: "customer_session_partial_part_001",
      partialResult: {
        ok: false,
        status: "partial",
        childReceipts: [expect.objectContaining({
          importBatchId: "customer_session_partial_part_002"
        })],
        deletedCount: 2
      }
    });
  });

  test("catalog import uses the authoritative callable with stable identity and revision", async () => {
    mockState.callable.mockResolvedValueOnce({
      data: {
        ok: true,
        importBatchId: "catalog_abcdefghijklmnopqrst",
        importType: "packages",
        createdCount: 1,
        catalogRevision: 8
      }
    });

    const result = await createImportBatch({
      organizationId: "MBMapps-001",
      organizationName: "MBMapps",
      importType: "packages",
      fileName: "packages.csv",
      records: [{ rowNumber: 2, record: { name: "Celebration", ppp: 23.45 } }],
      importBatchId: "catalog_abcdefghijklmnopqrst",
      expectedCatalogRevision: 7,
      actor: { uid: "browser-spoof", email: "spoof@example.com" }
    });

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "createCatalogImportBatch"
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      organizationId: "mbmapps-001",
      organizationName: "MBMapps",
      importType: "packages",
      fileName: "packages.csv",
      records: [{ rowNumber: 2, record: { name: "Celebration", ppp: 23.45 } }],
      importBatchId: "catalog_abcdefghijklmnopqrst",
      expectedCatalogRevision: 7
    });
    expect(result).toMatchObject({ ok: true, catalogRevision: 8 });
  });

  test("catalog rollback uses the authoritative callable and revision precondition", async () => {
    mockState.callable.mockResolvedValueOnce({
      data: { ok: true, importBatchId: "catalog_abcdefghijklmnopqrst", status: "rolled_back" }
    });

    const result = await rollbackImportBatch({
      organizationId: "MBMapps-001",
      importBatchId: "catalog_abcdefghijklmnopqrst",
      importType: "addons",
      expectedCatalogRevision: 11
    });

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "rollbackCatalogImportBatch"
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      organizationId: "mbmapps-001",
      importBatchId: "catalog_abcdefghijklmnopqrst",
      expectedCatalogRevision: 11
    });
    expect(result).toMatchObject({ ok: true, status: "rolled_back" });
  });
});
