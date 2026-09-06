import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  cloudFunctions: { id: "mock-functions" },
  getDraft: vi.fn(),
  saveDraft: vi.fn(),
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
  buildCatalogImportDraftChanges,
  preflightCatalogImportDraft,
  stageCatalogImportDraft
} from "../catalogSetupDraftService";

function row(record, rowNumber = 2) {
  return { rowNumber, record };
}

const DRAFT_SESSION_ID = "a".repeat(64);

function mutationReceiptChange(patch) {
  return {
    id: `${patch.collection}:${patch.recordId}`,
    collection: patch.collection,
    recordId: patch.recordId,
    requestedIntent: patch.intent,
    intent: patch.intent,
    payload: patch.payload
  };
}

function stagedDraftChange(patch) {
  return {
    id: `${patch.collection}:${patch.recordId}`,
    ...patch,
    baselineHash: "0".repeat(64)
  };
}

function durableSaveResponse(request, overrides = {}) {
  const mutationStatus = overrides.mutationStatus || "staged";
  const receiptOverrides = overrides.mutationReceipt || {};
  const receiptChanges = Object.prototype.hasOwnProperty.call(receiptOverrides, "changes")
    ? receiptOverrides.changes
    : request.patches.map(mutationReceiptChange);
  const mutationReceipt = {
    schemaVersion: 1,
    requestId: request.requestId,
    status: mutationStatus,
    organizationId: request.organizationId,
    actor: { uid: "admin-alpha", email: "admin@northstar.test" },
    draftSessionId: DRAFT_SESSION_ID,
    baseCatalogRevision: request.baseCatalogRevision,
    expectedGeneration: request.expectedGeneration,
    draftGeneration: request.expectedGeneration + 1,
    resultingDraftChangedRecordCount: request.patches.length,
    requestedChangeCount: receiptChanges.length,
    stagedAtISO: "2026-09-05T18:00:00.000Z",
    changes: receiptChanges,
    ...(mutationStatus === "published"
      ? {
          publicationReceiptId: "publish_catalog_import_0001",
          catalogRevisionAfter: request.baseCatalogRevision + 1,
          publishedAtISO: "2026-09-05T18:05:00.000Z"
        }
      : {}),
    ...receiptOverrides
  };
  const draft = Object.prototype.hasOwnProperty.call(overrides, "draft")
    ? overrides.draft
    : {
        state: "open",
        generation: request.expectedGeneration + 1,
        baseCatalogRevision: request.baseCatalogRevision,
        changedRecordCount: receiptOverrides.resultingDraftChangedRecordCount ?? request.patches.length,
        changes: request.patches.map(stagedDraftChange)
      };
  return {
    data: {
      ok: true,
      idempotentReplay: false,
      mutationStatus,
      organizationId: request.organizationId,
      currentCatalogRevision: request.baseCatalogRevision,
      ...overrides,
      draft,
      mutationReceipt
    }
  };
}

describe("catalog import draft shapes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getDraft.mockResolvedValue({
      data: { currentCatalogRevision: 12, draft: { state: "none", changes: [] } }
    });
    mockState.saveDraft.mockImplementation(async (request) => durableSaveResponse(request));
    mockState.httpsCallable.mockImplementation((_functions, name) => {
      if (name === "getCatalogSetupDraft") return mockState.getDraft;
      if (name === "saveCatalogSetupDraft") return mockState.saveDraft;
      throw new Error(`Unexpected callable: ${name}`);
    });
  });

  test("builds event-type and menu-section creates with stable imported identities", () => {
    expect(buildCatalogImportDraftChanges({
      importType: "eventTypes",
      importBatchId: "catalog_seed_001",
      rows: [row({ name: "Wedding", active: true }, 7)]
    })).toEqual([{
      collection: "eventTypes",
      recordId: "imp_catalog_seed_001_7_0",
      intent: "create",
      payload: { name: "Wedding", active: true }
    }]);

    expect(buildCatalogImportDraftChanges({
      importType: "menuCategories",
      importBatchId: "catalog_seed_001",
      rows: [row({ name: "Entrees", eventTypeId: "evt_wedding", active: false }, 8)]
    })).toEqual([{
      collection: "menuCategories",
      recordId: "imp_catalog_seed_001_8_0",
      intent: "create",
      payload: { name: "Entrees", eventTypeId: "evt_wedding", active: false }
    }]);
  });

  test("preserves package inclusion relationships and exact minor-unit amounts in draft payloads", () => {
    const changes = buildCatalogImportDraftChanges({
      importType: "packages",
      importBatchId: "catalog_packages_001",
      rows: [row({
        name: "Wedding dinner",
        ppp: 58.25,
        costPpp: 21.4,
        includedMenuItemIds: ["menu_roast", "menu_salad"],
        includedAddonIds: ["addon_station"],
        includedRentalIds: ["rental_linen"],
        active: true
      }, 11)]
    });

    expect(changes).toEqual([{
      collection: "catalogPackages",
      recordId: "imp_catalog_packages_001_11_0",
      intent: "create",
      payload: {
        name: "Wedding dinner",
        pppMinor: 5825,
        costPppMinor: 2140,
        active: true,
        includedMenuItemIds: ["menu_roast", "menu_salad"],
        includedAddonIds: ["addon_station"],
        includedRentalIds: ["rental_linen"]
      }
    }]);
  });

  test("includes the server-canonical defaults in add-on and rental preflight patches", () => {
    expect(buildCatalogImportDraftChanges({
      importType: "addons",
      importBatchId: "catalog_defaults",
      rows: [row({ name: "Late-night station", price: 250, pricingType: "per_event" })]
    })[0].payload).toEqual({
      name: "Late-night station",
      priceMinor: 25_000,
      costMinor: null,
      pricingType: "per_event",
      type: "per_event",
      staffRole: "",
      active: true,
      portalDecidable: false
    });

    expect(buildCatalogImportDraftChanges({
      importType: "rentals",
      importBatchId: "catalog_defaults",
      rows: [row({ name: "Table linen", price: 12, qtyPerGuests: 8 })]
    })[0].payload).toEqual({
      name: "Table linen",
      priceMinor: 1_200,
      costMinor: null,
      qtyPerGuests: 8,
      pricingType: "per_item",
      type: "per_item",
      active: true,
      portalDecidable: false
    });
  });

  test("fails before draft authority when required commercial fields are invalid", () => {
    expect(() => buildCatalogImportDraftChanges({
      importType: "rentals",
      importBatchId: "catalog_rentals_001",
      rows: [row({ name: "Table linen", price: 12, qtyPerGuests: 0 })]
    })).toThrow(/whole-number guests-per-unit ratio from 1 to 100000/i);

    expect(() => buildCatalogImportDraftChanges({
      importType: "menuItems",
      importBatchId: "catalog_menu_001",
      rows: [row({ name: "Roast chicken", price: 24, eventTypeId: "", categoryId: "" })]
    })).toThrow(/both an event type and menu section/i);
  });

  test("preflight binds an open shared draft generation and base catalog revision", async () => {
    mockState.getDraft.mockResolvedValueOnce({
      data: {
        currentCatalogRevision: 14,
        draft: {
          state: "open",
          generation: 5,
          baseCatalogRevision: 14,
          changes: [{ id: "existing-change", collection: "eventTypes", recordId: "existing", intent: "create", payload: { name: "Existing" } }]
        }
      }
    });

    const result = await preflightCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_event_types_001",
      rows: [row({ name: "Wedding", active: true })]
    });

    expect(mockState.httpsCallable).toHaveBeenCalledWith(mockState.cloudFunctions, "getCatalogSetupDraft");
    expect(mockState.getDraft).toHaveBeenCalledWith({ organizationId: "org-alpha" });
    expect(result).toMatchObject({
      ok: true,
      status: "ready",
      authority: "catalog_draft_server_read",
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_event_types_001",
      stagedCount: 1,
      projectedDraftChangeCount: 2,
      expectedGeneration: 5,
      baseCatalogRevision: 14,
      currentCatalogRevision: 14
    });
    expect(result.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("refuses to bless an already-open draft based on an older active revision", async () => {
    mockState.getDraft.mockResolvedValueOnce({
      data: {
        currentCatalogRevision: 14,
        draft: { state: "open", generation: 5, baseCatalogRevision: 12, changes: [] }
      }
    });

    await expect(preflightCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_stale_draft",
      rows: [row({ name: "Wedding" })]
    })).rejects.toThrow(/revision 12.*revision 14.*review, discard, or reconcile/i);
    expect(mockState.saveDraft).not.toHaveBeenCalled();
  });

  test("refuses an import that would exceed shared-draft change capacity", async () => {
    const changes = Array.from({ length: 400 }, (_, index) => ({
      id: `existing-${index}`,
      collection: "eventTypes",
      recordId: `event-${index}`,
      intent: "create",
      payload: { name: `Event ${index}` }
    }));
    mockState.getDraft.mockResolvedValueOnce({
      data: {
        currentCatalogRevision: 12,
        draft: { state: "open", generation: 4, baseCatalogRevision: 12, changes }
      }
    });

    await expect(preflightCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_over_capacity",
      rows: [row({ name: "One more event" })]
    })).rejects.toThrow(/401 changes.*400-change limit/i);
    expect(mockState.saveDraft).not.toHaveBeenCalled();
  });

  test("refuses an import that would exceed the shared-draft byte capacity", async () => {
    mockState.getDraft.mockResolvedValueOnce({
      data: {
        currentCatalogRevision: 12,
        draft: {
          state: "open",
          generation: 4,
          baseCatalogRevision: 12,
          changes: Array.from({ length: 95 }, (_, index) => ({
            id: `existing-${index}`,
            collection: "eventTypes",
            recordId: `event-${index}`,
            intent: "create",
            payload: { name: `Event ${index}`, retainedSourceDetail: "x".repeat(10_000) }
          }))
        }
      }
    });
    await expect(preflightCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_byte_capacity",
      rows: [row({ name: "One more event" })]
    })).rejects.toThrow(/shared catalog draft too large|split the source/i);
    expect(mockState.saveDraft).not.toHaveBeenCalled();
  });

  test("stages only a matching preflight and forwards both revision fences", async () => {
    const rows = [row({ name: "Wedding" })];
    const existingChange = {
      id: "eventTypes:existing",
      collection: "eventTypes",
      recordId: "existing",
      intent: "create",
      payload: { name: "Existing", active: true },
      baselineHash: "0".repeat(64)
    };
    mockState.getDraft.mockResolvedValueOnce({
      data: {
        currentCatalogRevision: 20,
        draft: { state: "open", generation: 7, baseCatalogRevision: 20, changes: [existingChange] }
      }
    });
    const preflight = await preflightCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_event_types_001",
      rows
    });
    mockState.saveDraft.mockImplementationOnce(async (request) => durableSaveResponse(request, {
      mutationReceipt: { resultingDraftChangedRecordCount: 2 },
      draft: {
        state: "open",
        generation: request.expectedGeneration + 1,
        baseCatalogRevision: request.baseCatalogRevision,
        changedRecordCount: 2,
        changes: [existingChange, ...request.patches.map(stagedDraftChange)]
      }
    }));

    const result = await stageCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_event_types_001",
      rows,
      preflight
    });

    expect(mockState.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-alpha",
      expectedGeneration: 7,
      baseCatalogRevision: 20,
      patches: preflight.patches
    }));
    expect(result).toMatchObject({
      ok: true,
      status: "staged",
      importBatchId: "catalog_event_types_001",
      importType: "eventTypes",
      stagedCount: 1,
      createdCount: 0,
      catalogRevision: 20,
      mutationReceipt: {
        requestId: preflight.requestId,
        status: "staged",
        organizationId: "org-alpha",
        expectedGeneration: 7,
        draftGeneration: 8,
        resultingDraftChangedRecordCount: 2,
        requestedChangeCount: 1
      },
      draft: {
        state: "open",
        generation: 8,
        baseCatalogRevision: 20,
        changedRecordCount: 2,
        changes: expect.arrayContaining([expect.objectContaining({
          id: "eventTypes:imp_catalog_event_types_001_2_0",
          collection: "eventTypes",
          recordId: "imp_catalog_event_types_001_2_0",
          intent: "create",
          payload: { name: "Wedding", active: true }
        })])
      }
    });

    await expect(stageCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_different_batch",
      rows: [row({ name: "Wedding" })],
      preflight
    })).rejects.toThrow(/preflight no longer matches/i);

    await expect(stageCatalogImportDraft({
      organizationId: "org-beta",
      importType: "eventTypes",
      importBatchId: "catalog_event_types_001",
      rows: [row({ name: "Wedding" })],
      preflight
    })).rejects.toThrow(/preflight no longer matches/i);
    expect(mockState.saveDraft).toHaveBeenCalledTimes(1);
  });

  test("accepts a published replay from its bound mutation receipt while ignoring a later open draft", async () => {
    const rows = [row({ name: "Wedding" })];
    const preflight = await preflightCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_published_replay",
      rows
    });
    mockState.saveDraft.mockImplementationOnce(async (request) => durableSaveResponse(request, {
      mutationStatus: "published",
      idempotentReplay: true,
      currentCatalogRevision: 13,
      draft: {
        state: "open",
        baseCatalogRevision: 13,
        generation: 4,
        changedRecordCount: 1,
        changes: [{
          id: "eventTypes:unrelated-later-change",
          collection: "eventTypes",
          recordId: "unrelated-later-change",
          intent: "update",
          payload: { name: "Later work", active: true }
        }]
      }
    }));

    const result = await stageCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_published_replay",
      rows,
      preflight
    });

    expect(result).toMatchObject({
      ok: true,
      status: "published",
      idempotentReplay: true,
      catalogRevision: 13,
      catalogRevisionAfter: 13,
      publicationReceiptId: "publish_catalog_import_0001",
      publishedAtISO: "2026-09-05T18:05:00.000Z",
      mutationReceipt: {
        requestId: preflight.requestId,
        status: "published",
        baseCatalogRevision: 12,
        draftGeneration: 1
      }
    });
    expect(result).not.toHaveProperty("draft");
  });

  test.each([
    ["unsupported mutation status", () => ({ mutationStatus: "accepted", mutationReceipt: { status: "accepted" } })],
    ["schema version mismatch", () => ({ mutationReceipt: { schemaVersion: 2 } })],
    ["actor identity missing", () => ({ mutationReceipt: { actor: null } })],
    ["organization mismatch", (request) => ({ mutationReceipt: { organizationId: `${request.organizationId}-other` } })],
    ["request identity mismatch", (request) => ({ mutationReceipt: { requestId: `${request.requestId}_other` } })],
    ["base catalog revision mismatch", (request) => ({ mutationReceipt: { baseCatalogRevision: request.baseCatalogRevision + 1 } })],
    ["expected generation mismatch", (request) => ({ mutationReceipt: { expectedGeneration: request.expectedGeneration + 1 } })],
    ["resulting draft generation mismatch", (request) => ({ mutationReceipt: { draftGeneration: request.expectedGeneration + 2 } })],
    ["resulting draft change projection mismatch", (request) => ({ mutationReceipt: { resultingDraftChangedRecordCount: request.patches.length + 1 } })],
    ["mutation status mismatch", () => ({ mutationReceipt: { status: "published" } })]
  ])("rejects an otherwise successful save receipt with %s", async (reason, drift) => {
    const rows = [row({ name: "Wedding" })];
    const preflight = await preflightCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_authority_drift",
      rows
    });
    mockState.saveDraft.mockImplementationOnce(async (request) => (
      durableSaveResponse(request, drift(request))
    ));

    await expect(stageCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_authority_drift",
      rows,
      preflight
    })).rejects.toMatchObject({
      code: "failed-precondition",
      message: expect.stringMatching(new RegExp(reason, "i"))
    });
  });

  test.each([
    ["omits the reviewed patch", (request) => ({
      mutationReceipt: { changes: [], requestedChangeCount: request.patches.length }
    })],
    ["substitutes the reviewed patch identity", (request) => ({
      mutationReceipt: {
        changes: request.patches.map((patch) => mutationReceiptChange({
          ...patch,
          recordId: `${patch.recordId}_substituted`
        }))
      }
    })],
    ["changes the reviewed patch payload", (request) => ({
      mutationReceipt: {
        changes: request.patches.map((patch) => mutationReceiptChange({
          ...patch,
          payload: { ...patch.payload, name: "Substituted event" }
        }))
      }
    })],
    ["changes the requested intent", (request) => ({
      mutationReceipt: {
        changes: request.patches.map((patch) => ({
          ...mutationReceiptChange(patch),
          requestedIntent: "update"
        }))
      }
    })],
    ["uses an incompatible authoritative intent", (request) => ({
      mutationReceipt: {
        changes: request.patches.map((patch) => ({
          ...mutationReceiptChange(patch),
          intent: "update"
        }))
      }
    })]
  ])("rejects a save receipt that %s", async (_scenario, drift) => {
    const rows = [row({ name: "Wedding" })];
    const preflight = await preflightCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_patch_drift",
      rows
    });
    mockState.saveDraft.mockImplementationOnce(async (request) => (
      durableSaveResponse(request, drift(request))
    ));

    await expect(stageCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_patch_drift",
      rows,
      preflight
    })).rejects.toMatchObject({
      code: "failed-precondition",
      message: expect.stringMatching(/save receipt did not match the reviewed import plan/i)
    });
  });

  test.each([
    ["missing publication receipt", { publicationReceiptId: "" }],
    ["wrong published revision", { catalogRevisionAfter: 14 }],
    ["missing publication timestamp", { publishedAtISO: "" }]
  ])("rejects a forged published mutation receipt with %s", async (_scenario, mutationReceipt) => {
    const rows = [row({ name: "Wedding" })];
    const preflight = await preflightCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_forged_publication",
      rows
    });
    mockState.saveDraft.mockImplementationOnce(async (request) => durableSaveResponse(request, {
      mutationStatus: "published",
      mutationReceipt
    }));

    await expect(stageCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_forged_publication",
      rows,
      preflight
    })).rejects.toMatchObject({
      code: "failed-precondition",
      message: expect.stringMatching(/published receipt projection mismatch/i)
    });
  });

  test("cryptographically rejects same-count catalog rows changed after preflight", async () => {
    const originalRows = [row({ name: "Wedding" })];
    const preflight = await preflightCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_exact_rows",
      rows: originalRows
    });

    await expect(stageCatalogImportDraft({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_exact_rows",
      rows: [row({ name: "Corporate" })],
      preflight
    })).rejects.toThrow(/records changed after preflight/i);
    expect(mockState.saveDraft).not.toHaveBeenCalled();
  });

  test("matches authoritative money, rental, and relationship limits before saving", () => {
    expect(() => buildCatalogImportDraftChanges({
      importType: "packages",
      importBatchId: "catalog_constraints",
      rows: [row({ name: "Free package", ppp: 0 })]
    })).toThrow(/invalid price per person/i);

    for (const qtyPerGuests of [1.5, 100_001]) {
      expect(() => buildCatalogImportDraftChanges({
        importType: "rentals",
        importBatchId: "catalog_constraints",
        rows: [row({ name: "Linen", price: 12, qtyPerGuests })]
      })).toThrow(/whole-number guests-per-unit ratio from 1 to 100000/i);
    }

    expect(() => buildCatalogImportDraftChanges({
      importType: "addons",
      importBatchId: "catalog_constraints",
      rows: [row({ name: "Large fee", price: 1_000_000.01 })]
    })).toThrow(/invalid price/i);

    expect(() => buildCatalogImportDraftChanges({
      importType: "packages",
      importBatchId: "catalog_constraints",
      rows: [row({
        name: "Too many inclusions",
        ppp: 20,
        includedMenuItemIds: Array.from({ length: 101 }, (_, index) => `item-${index}`)
      })]
    })).toThrow(/more than 100 included menu item/i);
  });
});
