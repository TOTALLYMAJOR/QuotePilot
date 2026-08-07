import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  createCatalogImportBatch,
  rollbackCatalogImportBatch,
  sanitizeCatalogImportRecord
} = require("../../../functions/catalogImportBatches.js");

function clone(value) {
  return structuredClone(value);
}

class FakeDocumentRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new FakeCollectionRef(this.store, `${this.path}/${name}`);
  }
}

class FakeCollectionRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
  }

  doc(id) {
    return new FakeDocumentRef(this.store, `${this.path}/${id}`);
  }
}

function documentSnapshot(ref) {
  const data = ref.store.get(ref.path);
  return {
    id: ref.id,
    ref,
    exists: data !== undefined,
    data: () => clone(data || {})
  };
}

function collectionSnapshot(ref) {
  const prefix = `${ref.path}/`;
  const docs = [];
  ref.store.forEach((_value, path) => {
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) return;
    docs.push(documentSnapshot(new FakeDocumentRef(ref.store, path)));
  });
  return { docs };
}

function fakeDb(entries = []) {
  const store = new Map(entries);
  return {
    store,
    collection(name) {
      return new FakeCollectionRef(store, name);
    },
    async runTransaction(callback) {
      const transaction = {
        get: async (ref) => ref instanceof FakeCollectionRef
          ? collectionSnapshot(ref)
          : documentSnapshot(ref),
        set(ref, data, options = {}) {
          const current = options.merge ? store.get(ref.path) || {} : {};
          store.set(ref.path, { ...current, ...clone(data) });
        },
        delete(ref) {
          store.delete(ref.path);
        }
      };
      return callback(transaction);
    }
  };
}

function settings(revision = 1) {
  return ["organizations/acme/settings/config", {
    catalogRevision: revision,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "owner-before",
      confirmedCatalogRevision: revision
    },
    serviceFeePct: 0.2
  }];
}

function importRequest(overrides = {}) {
  return {
    organizationId: "acme",
    organizationName: "Acme Catering",
    importType: "packages",
    fileName: "packages.csv",
    records: [{ rowNumber: 2, record: { name: "Celebration", ppp: 23.45 } }],
    importBatchId: "catalog_import_batch_0001",
    expectedCatalogRevision: 1,
    actorUid: "owner-1",
    actorEmail: "Owner@Example.com",
    nowISO: "2026-08-06T14:00:00.000Z",
    ...overrides
  };
}

describe("authoritative catalog import batches", () => {
  test("stores integer minor units, advances one revision, invalidates confirmation, and replays idempotently", async () => {
    const db = fakeDb([settings(4)]);
    const request = importRequest({ db, expectedCatalogRevision: 4 });

    const result = await createCatalogImportBatch(request);
    const record = db.store.get(`organizations/acme/catalogPackages/${result.createdRecords[0].id}`);
    const receipt = db.store.get("organizations/acme/importBatches/catalog_import_batch_0001");

    expect(result).toMatchObject({
      createdCount: 1,
      catalogRevisionBefore: 4,
      catalogRevisionAfter: 5,
      idempotentReplay: false
    });
    expect(record).toMatchObject({
      name: "Celebration",
      pppMinor: 2345,
      importSource: "import_studio",
      importBatchId: "catalog_import_batch_0001",
      importCatalogRevision: 5
    });
    expect(record).not.toHaveProperty("ppp");
    expect(receipt.actor).toEqual({ uid: "owner-1", email: "owner@example.com" });
    expect(db.store.get("organizations/acme/settings/config")).toMatchObject({
      catalogRevision: 5,
      pricingSetupConfirmed: false,
      pricingConfirmation: null,
      serviceFeePct: 0.2
    });

    const replay = await createCatalogImportBatch(request);
    expect(replay).toMatchObject({ idempotentReplay: true, catalogRevision: 5 });
    expect(db.store.get("organizations/acme/settings/config").catalogRevision).toBe(5);
  });

  test("normalizes every supported catalog amount to an integer minor-unit field", () => {
    expect(sanitizeCatalogImportRecord("packages", { name: "P", ppp: 12.34 }))
      .toMatchObject({ pppMinor: 1234 });
    expect(sanitizeCatalogImportRecord("addons", { name: "A", price: 4.56 }))
      .toMatchObject({ priceMinor: 456 });
    expect(sanitizeCatalogImportRecord("rentals", { name: "R", price: 7.89 }))
      .toMatchObject({ priceMinor: 789 });
    expect(sanitizeCatalogImportRecord("menuItems", {
      name: "M",
      price: 1.23,
      eventTypeId: "event-a",
      categoryId: "category-a"
    })).toMatchObject({ priceMinor: 123 });
    expect(() => sanitizeCatalogImportRecord("packages", {
      name: "Invalid",
      pppMinor: 12.5
    })).toThrow(/integer minor-unit/i);
  });

  test("fails stale imports before writing and binds a batch id to one exact request", async () => {
    const db = fakeDb([settings(3)]);
    await expect(createCatalogImportBatch(importRequest({
      db,
      expectedCatalogRevision: 2
    }))).rejects.toMatchObject({ code: "aborted" });
    expect(db.store.size).toBe(1);

    await createCatalogImportBatch(importRequest({ db, expectedCatalogRevision: 3 }));
    await expect(createCatalogImportBatch(importRequest({
      db,
      expectedCatalogRevision: 4,
      fileName: "different.csv"
    }))).rejects.toMatchObject({ code: "already-exists" });
  });

  test("records an all-duplicate import without changing revision or pricing confirmation", async () => {
    const confirmation = {
      actorUid: "owner-before",
      confirmedAtISO: "2026-08-06T12:00:00.000Z",
      confirmedCatalogRevision: 5
    };
    const db = fakeDb([
      ["organizations/acme/settings/config", {
        catalogRevision: 5,
        pricingSetupConfirmed: true,
        pricingConfirmation: confirmation
      }],
      ["organizations/acme/catalogPackages/existing", {
        name: "Celebration",
        pppMinor: 2200
      }]
    ]);

    const result = await createCatalogImportBatch(importRequest({
      db,
      expectedCatalogRevision: 5
    }));
    expect(result).toMatchObject({
      createdCount: 0,
      skippedCount: 1,
      catalogRevisionBefore: 5,
      catalogRevisionAfter: 5
    });
    expect(db.store.get("organizations/acme/settings/config")).toEqual({
      catalogRevision: 5,
      pricingSetupConfirmed: true,
      pricingConfirmation: confirmation
    });
    expect(db.store.get("organizations/acme/importBatches/catalog_import_batch_0001"))
      .toMatchObject({ status: "completed", createdCount: 0, skippedCount: 1 });
  });

  test("validates menu references on the server, even when the UI marks a row ready", async () => {
    const db = fakeDb([
      settings(1),
      ["organizations/acme/eventTypes/wedding", { name: "Wedding" }],
      ["organizations/acme/menuCategories/wedding-entrees", {
        name: "Entrees",
        eventTypeId: "wedding"
      }]
    ]);

    await expect(createCatalogImportBatch(importRequest({
      db,
      importType: "menuItems",
      records: [{
        rowNumber: 2,
        record: {
          name: "Salmon",
          price: 18.25,
          eventTypeId: "corporate",
          categoryId: "wedding-entrees"
        }
      }]
    }))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(db.store.get("organizations/acme/settings/config").catalogRevision).toBe(1);
  });

  test("deletes only unchanged imported records and makes rollback replay-safe", async () => {
    const db = fakeDb([settings(2)]);
    const imported = await createCatalogImportBatch(importRequest({
      db,
      importType: "rentals",
      records: [{ rowNumber: 2, record: { name: "Chair", price: 3.5 } }],
      expectedCatalogRevision: 2
    }));
    const recordPath = `organizations/acme/catalogRentals/${imported.createdRecords[0].id}`;

    const rolledBack = await rollbackCatalogImportBatch({
      db,
      organizationId: "acme",
      importBatchId: imported.importBatchId,
      expectedCatalogRevision: 3,
      actorUid: "owner-2",
      actorEmail: "owner2@example.com",
      nowISO: "2026-08-06T15:00:00.000Z"
    });
    expect(rolledBack).toMatchObject({
      deletedCount: 1,
      protectedCount: 0,
      catalogRevisionBefore: 3,
      catalogRevisionAfter: 4,
      idempotentReplay: false
    });
    expect(db.store.has(recordPath)).toBe(false);
    expect(db.store.get("organizations/acme/settings/config")).toMatchObject({
      catalogRevision: 4,
      pricingSetupConfirmed: false,
      pricingConfirmation: null
    });

    const replay = await rollbackCatalogImportBatch({
      db,
      organizationId: "acme",
      importBatchId: imported.importBatchId,
      expectedCatalogRevision: 3
    });
    expect(replay).toMatchObject({ idempotentReplay: true, catalogRevision: 4, deletedCount: 1 });
    expect(db.store.get("organizations/acme/settings/config").catalogRevision).toBe(4);
  });

  test("protects a user-modified imported record during rollback", async () => {
    const db = fakeDb([settings(1)]);
    const imported = await createCatalogImportBatch(importRequest({
      db,
      importType: "addons",
      records: [{ rowNumber: 2, record: { name: "Late-night snack", price: 6 } }]
    }));
    const recordPath = `organizations/acme/catalogAddons/${imported.createdRecords[0].id}`;
    db.store.set(recordPath, { ...db.store.get(recordPath), priceMinor: 725 });
    db.store.set("organizations/acme/settings/config", {
      ...db.store.get("organizations/acme/settings/config"),
      catalogRevision: 3,
      pricingSetupConfirmed: true,
      pricingConfirmation: {
        actorUid: "owner-after-edit",
        confirmedCatalogRevision: 3
      }
    });

    const result = await rollbackCatalogImportBatch({
      db,
      organizationId: "acme",
      importBatchId: imported.importBatchId,
      expectedCatalogRevision: 3
    });
    expect(result).toMatchObject({ deletedCount: 0, protectedCount: 1, catalogRevision: 3 });
    expect(result.protectedRecords[0]).toMatchObject({ reason: "record_modified" });
    expect(db.store.get(recordPath).priceMinor).toBe(725);
    expect(db.store.get("organizations/acme/settings/config")).toMatchObject({
      catalogRevision: 3,
      pricingSetupConfirmed: true,
      pricingConfirmation: {
        actorUid: "owner-after-edit",
        confirmedCatalogRevision: 3
      }
    });
  });

  test("protects imported records referenced by persistent templates and package inclusions", async () => {
    const db = fakeDb([settings(1)]);
    const imported = await createCatalogImportBatch(importRequest({
      db,
      importType: "addons",
      records: [
        { rowNumber: 2, record: { name: "Template add-on", price: 5 } },
        { rowNumber: 3, record: { name: "Package add-on", price: 8 } },
        { rowNumber: 4, record: { name: "Upsell add-on", price: 9 } }
      ]
    }));
    const [templateAddon, packageAddon, upsellAddon] = imported.createdRecords;
    db.store.set("organizations/acme/catalogPackages/owner-package", {
      name: "Owner package",
      pppMinor: 2500,
      includedAddonIds: [packageAddon.id]
    });
    db.store.set("organizations/acme/settings/config", {
      ...db.store.get("organizations/acme/settings/config"),
      catalogRevision: 3,
      eventTemplates: [{ id: "template-1", addons: [templateAddon.id] }],
      upsellRules: [{ id: "upsell-1", kind: "addon", targetId: upsellAddon.id }]
    });

    const result = await rollbackCatalogImportBatch({
      db,
      organizationId: "acme",
      importBatchId: imported.importBatchId,
      expectedCatalogRevision: 3
    });
    expect(result).toMatchObject({ deletedCount: 0, protectedCount: 3, catalogRevision: 3 });
    expect(new Set(result.protectedRecords.map((entry) => entry.reason)))
      .toEqual(new Set(["event_template", "package_inclusion", "upsell_rule"]));
    expect(db.store.has(`organizations/acme/catalogAddons/${templateAddon.id}`)).toBe(true);
    expect(db.store.has(`organizations/acme/catalogAddons/${packageAddon.id}`)).toBe(true);
    expect(db.store.has(`organizations/acme/catalogAddons/${upsellAddon.id}`)).toBe(true);
  });

  test("protects an imported package that a persistent quote template still selects", async () => {
    const db = fakeDb([settings(1)]);
    const imported = await createCatalogImportBatch(importRequest({ db }));
    const packageId = imported.createdRecords[0].id;
    db.store.set("organizations/acme/settings/config", {
      ...db.store.get("organizations/acme/settings/config"),
      catalogRevision: 3,
      eventTemplates: [{ id: "template-1", pkg: packageId }]
    });

    const result = await rollbackCatalogImportBatch({
      db,
      organizationId: "acme",
      importBatchId: imported.importBatchId,
      expectedCatalogRevision: 3
    });
    expect(result).toMatchObject({ deletedCount: 0, protectedCount: 1 });
    expect(result.protectedRecords[0]).toMatchObject({
      collection: "catalogPackages",
      id: packageId,
      reason: "event_template"
    });
  });
});
