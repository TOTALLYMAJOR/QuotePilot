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
  createCustomerImportBatchId,
  createImportBatch,
  rollbackImportBatch
} from "../importBatchService";

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

  test("customer import uses the authoritative callable with stable batch identity", async () => {
    mockState.callable.mockResolvedValueOnce({
      data: {
        ok: true,
        importBatchId: "customer_import_batch_0001",
        organizationId: "mbmapps-001",
        importType: "customers",
        createdCount: 1,
        skippedCount: 0,
        status: "completed"
      }
    });
    const result = await createImportBatch({
      organizationId: "MBMapps-001",
      organizationName: "MBMapps",
      importType: "customers",
      fileName: "customers.csv",
      records: [{
        rowNumber: 2,
        record: {
          name: "Michael Major",
          email: "flightcontrol@quietpilot.us",
          organizationId: "attacker-org"
        }
      }],
      actor: { uid: "browser-spoof", email: "spoof@example.com" },
      importBatchId: "customer_import_batch_0001"
    });

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "createCustomerImportBatch"
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      organizationId: "mbmapps-001",
      organizationName: "MBMapps",
      fileName: "customers.csv",
      records: [{
        rowNumber: 2,
        record: {
          name: "Michael Major",
          email: "flightcontrol@quietpilot.us",
          organizationId: "attacker-org"
        }
      }],
      importBatchId: "customer_import_batch_0001"
    });
    expect(mockState.callable.mock.calls[0][0]).not.toHaveProperty("actor");
    expect(result).toMatchObject({ ok: true, organizationId: "mbmapps-001", createdCount: 1 });
  });

  test("generates an opaque stable-format batch id when the caller does not supply one", async () => {
    mockState.callable.mockResolvedValueOnce({
      data: { ok: true, importBatchId: "customer_server_receipt", status: "completed" }
    });
    await createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records: [{ rowNumber: 2, record: { name: "Michael Major", email: "flightcontrol@quietpilot.us" } }]
    });
    expect(mockState.callable.mock.calls[0][0].importBatchId).toMatch(/^customer_[a-f0-9]{32}$/);
    expect(createCustomerImportBatchId({ randomUUID: () => "12345678-1234-1234-1234-123456789abc" }))
      .toBe("customer_12345678123412341234123456789abc");
  });

  test("reuses an auto-generated customer batch id after an ambiguous client failure", async () => {
    const records = [{ rowNumber: 2, record: { name: "Retry Customer", email: "retry@example.com" } }];
    mockState.callable
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({ data: { ok: true, status: "completed" } });

    await expect(createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records
    })).rejects.toThrow(/connection reset/i);
    const firstBatchId = mockState.callable.mock.calls[0][0].importBatchId;
    await createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records
    });
    expect(mockState.callable.mock.calls[1][0].importBatchId).toBe(firstBatchId);
  });

  test("returns server-owned duplicate decisions without browser collection scans", async () => {
    mockState.callable.mockResolvedValueOnce({
      data: {
        ok: true,
        importBatchId: "customer_import_batch_0002",
        createdCount: 0,
        skippedCount: 1,
        skippedRows: [{ rowNumber: 2, reason: "duplicate" }]
      }
    });
    const result = await createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records: [{ rowNumber: 2, record: { email: "existing@example.com" } }],
      importBatchId: "customer_import_batch_0002"
    });
    expect(result).toMatchObject({ createdCount: 0, skippedCount: 1 });
    expect(mockState.httpsCallable).toHaveBeenCalledTimes(1);
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
        importType: "customers",
        deletedCount: 1,
        protectedCount: 1,
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
