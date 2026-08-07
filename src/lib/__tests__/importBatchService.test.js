import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  cloudFunctions: { id: "mock-functions" },
  db: { id: "mock-db" },
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  query: vi.fn(),
  writeBatch: vi.fn(),
  httpsCallable: vi.fn(),
  callable: vi.fn(),
  normalizeOrganizationId: vi.fn()
}));

vi.mock("../firebase", () => ({
  cloudFunctions: mockState.cloudFunctions,
  db: mockState.db,
  firebaseReady: true
}));
vi.mock("../organizationService", () => ({
  normalizeOrganizationId: mockState.normalizeOrganizationId
}));
vi.mock("firebase/firestore", () => ({
  collection: mockState.collection,
  deleteField: vi.fn(() => "delete-field"),
  doc: mockState.doc,
  getDoc: mockState.getDoc,
  getDocs: mockState.getDocs,
  limit: mockState.limit,
  query: mockState.query,
  serverTimestamp: vi.fn(() => "server-time"),
  writeBatch: mockState.writeBatch
}));
vi.mock("firebase/functions", () => ({
  httpsCallable: mockState.httpsCallable
}));

import { createImportBatch, rollbackImportBatch } from "../importBatchService";

describe("tenant-locked import persistence", () => {
  let batch;
  let generatedId;

  beforeEach(() => {
    vi.clearAllMocks();
    generatedId = 0;
    mockState.normalizeOrganizationId.mockImplementation((value) => String(value || "").trim().toLowerCase());
    mockState.collection.mockImplementation((...segments) => ({ kind: "collection", segments }));
    mockState.doc.mockImplementation((...segments) => {
      if (segments.length === 1) {
        generatedId += 1;
        return { kind: "doc", id: `generated-${generatedId}`, parent: segments[0] };
      }
      return { kind: "doc", id: String(segments.at(-1)), segments };
    });
    mockState.limit.mockImplementation((value) => ({ limit: value }));
    mockState.query.mockImplementation((...parts) => ({ parts }));
    mockState.getDocs.mockResolvedValue({ docs: [] });
    mockState.callable.mockResolvedValue({ data: { ok: true } });
    mockState.httpsCallable.mockReturnValue(mockState.callable);
    batch = {
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined)
    };
    mockState.writeBatch.mockReturnValue(batch);
  });

  test("fails closed when the authenticated organization is missing", async () => {
    await expect(createImportBatch({
      importType: "customers",
      records: [{ record: { name: "Michael Major", email: "flightcontrol@quietpilot.us" } }]
    })).rejects.toThrow(/destination organization is required/i);
    expect(mockState.writeBatch).not.toHaveBeenCalled();
  });

  test("writes records and receipt only under the supplied organization path", async () => {
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
      actor: { uid: "admin-1", email: "admin@example.com" }
    });

    expect(mockState.collection).toHaveBeenCalledWith(
      mockState.db,
      "organizations",
      "mbmapps-001",
      "customers"
    );
    expect(mockState.collection).toHaveBeenCalledWith(
      mockState.db,
      "organizations",
      "mbmapps-001",
      "importBatches"
    );
    expect(batch.set).toHaveBeenCalledTimes(2);
    const recordPayload = batch.set.mock.calls[0][1];
    expect(recordPayload.organizationId).toBe("mbmapps-001");
    expect(recordPayload.organizationId).not.toBe("attacker-org");
    expect(result).toMatchObject({ ok: true, organizationId: "mbmapps-001", createdCount: 1 });
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  test("skips existing duplicate customer email without overwriting it", async () => {
    mockState.getDocs.mockResolvedValue({
      docs: [{ data: () => ({ email: "flightcontrol@quietpilot.us" }) }]
    });

    const result = await createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records: [{ rowNumber: 2, record: { name: "Michael Major", email: "flightcontrol@quietpilot.us" } }]
    });

    expect(result).toMatchObject({ createdCount: 0, skippedCount: 1 });
    expect(batch.set).toHaveBeenCalledTimes(1);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  test("fails closed when a complete duplicate scan would exceed the supported collection size", async () => {
    mockState.getDocs.mockResolvedValue({
      docs: Array.from({ length: 2001 }, (_, index) => ({
        data: () => ({ email: `customer-${index}@example.com` })
      }))
    });

    await expect(createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records: [{ rowNumber: 2, record: { email: "new@example.com" } }]
    })).rejects.toThrow(/managed migration/i);
    expect(mockState.writeBatch).not.toHaveBeenCalled();
  });

  test("rejects unsupported record types and records without an identity field", async () => {
    await expect(createImportBatch({
      organizationId: "mbmapps-001",
      importType: "quotes",
      records: [{ rowNumber: 2, record: { name: "Not supported" } }]
    })).rejects.toThrow(/supported import record type/i);

    await expect(createImportBatch({
      organizationId: "mbmapps-001",
      importType: "customers",
      records: [{ rowNumber: 2, record: {} }]
    })).rejects.toThrow(/required identity field/i);
  });

  test("rollback removes unchanged batch records and protects records edited later", async () => {
    mockState.getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          organizationId: "mbmapps-001",
          importBatchId: "batch-1",
          importType: "customers",
          status: "completed",
          createdRecords: [
            { collection: "customers", id: "customer-1" },
            { collection: "customers", id: "customer-2" }
          ]
        })
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          importBatchId: "batch-1",
          createdAtISO: "2026-07-21T00:00:00.000Z",
          updatedAtISO: "2026-07-21T00:00:00.000Z"
        })
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          importBatchId: "batch-1",
          createdAtISO: "2026-07-21T00:00:00.000Z",
          updatedAtISO: "2026-07-21T01:00:00.000Z"
        })
      });

    const result = await rollbackImportBatch({
      organizationId: "mbmapps-001",
      importBatchId: "batch-1"
    });

    expect(batch.delete).toHaveBeenCalledTimes(1);
    expect(batch.update).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ deletedCount: 1, protectedCount: 1, status: "rolled_back" });
  });

  test("customer rollback rejects a receipt that crosses into a catalog collection", async () => {
    mockState.getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          organizationId: "mbmapps-001",
          importBatchId: "batch-1",
          importType: "customers",
          status: "completed",
          createdRecords: [{ collection: "catalogPackages", id: "package-1" }]
        })
      });

    await expect(rollbackImportBatch({
      organizationId: "mbmapps-001",
      importBatchId: "batch-1"
    })).rejects.toThrow(/invalid record target/i);

    expect(batch.delete).not.toHaveBeenCalled();
    expect(batch.update).not.toHaveBeenCalled();
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
    expect(mockState.getDocs).not.toHaveBeenCalled();
    expect(mockState.writeBatch).not.toHaveBeenCalled();
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
    expect(mockState.getDoc).not.toHaveBeenCalled();
    expect(mockState.writeBatch).not.toHaveBeenCalled();
  });
});
