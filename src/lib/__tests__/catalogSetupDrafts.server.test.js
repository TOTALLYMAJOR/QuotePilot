import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  CatalogSetupDraftError,
  MAX_CHANGED_RECORDS,
  getCatalogSetupDraft,
  normalizeChanges,
  publishCatalogSetupDraft,
  reviewCatalogSetupDraft,
  saveCatalogSetupDraft
} = require("../../../functions/catalogSetupDrafts.js");
const { buildStarterCatalogPackDocuments } = require("../../../functions/starterCatalogPacks.js");

const DELETE_FIELD = "__DELETE_FIELD__";

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

  async get() {
    return documentSnapshot(this);
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

  async get() {
    return collectionSnapshot(this);
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

function applyWrite(store, ref, data, { merge = false, create = false } = {}) {
  if (create && store.has(ref.path)) throw new Error(`Already exists: ${ref.path}`);
  const next = merge ? { ...(store.get(ref.path) || {}) } : {};
  Object.entries(clone(data)).forEach(([key, value]) => {
    if (value === DELETE_FIELD) delete next[key];
    else next[key] = value;
  });
  store.set(ref.path, next);
}

function fakeDb(initial = new Map()) {
  const store = initial;
  return {
    store,
    collection(name) {
      return new FakeCollectionRef(store, name);
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        get: async (ref) => ref instanceof FakeCollectionRef
          ? collectionSnapshot(ref)
          : documentSnapshot(ref),
        set(ref, data, options = {}) {
          writes.push(() => applyWrite(store, ref, data, { merge: options.merge === true }));
        },
        create(ref, data) {
          writes.push(() => applyWrite(store, ref, data, { create: true }));
        }
      };
      const result = await callback(transaction);
      writes.forEach((write) => write());
      return result;
    }
  };
}

function starterDb() {
  const plan = buildStarterCatalogPackDocuments("wedding-events", {
    packVersion: 2,
    nowISO: "2026-08-31T18:00:00.000Z",
    actorUid: "owner-1"
  });
  const store = new Map([
    ["organizations/acme/settings/config", {
      ...clone(plan.settings),
      catalogRevision: 1,
      pricingSettingsVersion: 0,
      pricingSetupConfirmed: false,
      pricingConfirmation: null,
      serverRate: 24,
      chefRate: 32
    }]
  ]);
  Object.entries(plan.collections).forEach(([collection, records]) => {
    records.forEach((record) => {
      store.set(`organizations/acme/${collection}/${record.id}`, clone(record.data));
    });
  });
  return { db: fakeDb(store), plan };
}

function actor() {
  return {
    actorUid: "owner-1",
    actorEmail: "owner@example.com"
  };
}

describe("catalog setup draft authority", () => {
  test("coalesces durable intent without activating it, then publishes one confirmed revision and receipt", async () => {
    const { db, plan } = starterDb();
    const packageRecord = plan.collections.catalogPackages[0];

    const first = await saveCatalogSetupDraft({
      db,
      organizationId: "acme",
      requestId: "draft_request_0001",
      expectedGeneration: 0,
      baseCatalogRevision: 1,
      patches: [
        {
          collection: "settings",
          recordId: "config",
          intent: "update",
          payload: {
            perMileRate: 0.95,
            longDistancePerMileRate: 1.45,
            serverRate: 48,
            chefRate: 62,
            bartenderRate: 52,
            staffingRateTypes: [{
              id: "standard",
              name: "Standard staffing",
              serverRate: 48,
              chefRate: 62
            }]
          }
        },
        {
          collection: "catalogPackages",
          recordId: packageRecord.id,
          intent: "update",
          payload: {
            ...packageRecord.data,
            pppMinor: packageRecord.data.pppMinor + 500
          }
        }
      ],
      ...actor(),
      nowISO: "2026-08-31T18:01:00.000Z"
    });

    expect(first.draft).toMatchObject({
      state: "open",
      baseCatalogRevision: 1,
      generation: 1,
      changedRecordCount: 2
    });
    expect(db.store.get("organizations/acme/settings/config")).toMatchObject({
      catalogRevision: 1,
      serverRate: 24,
      chefRate: 32,
      pricingSetupConfirmed: false
    });
    expect(db.store.get(`organizations/acme/catalogPackages/${packageRecord.id}`).pppMinor)
      .toBe(packageRecord.data.pppMinor);

    const second = await saveCatalogSetupDraft({
      db,
      organizationId: "acme",
      requestId: "draft_request_0002",
      expectedGeneration: 1,
      baseCatalogRevision: 1,
      patches: [{
        collection: "catalogPackages",
        recordId: packageRecord.id,
        intent: "update",
        payload: {
          ...packageRecord.data,
          pppMinor: packageRecord.data.pppMinor + 700
        }
      }],
      ...actor(),
      nowISO: "2026-08-31T18:02:00.000Z"
    });
    expect(second.draft).toMatchObject({ generation: 2, changedRecordCount: 2 });

    const review = await reviewCatalogSetupDraft({
      db,
      organizationId: "acme",
      expectedGeneration: 2,
      baseCatalogRevision: 1
    });
    expect(review).toMatchObject({ readyToPublish: true, changedRecordCount: 2 });
    expect(db.store.get("organizations/acme/settings/config").catalogRevision).toBe(1);

    const published = await publishCatalogSetupDraft({
      db,
      organizationId: "acme",
      requestId: "publish_request_0001",
      expectedGeneration: 2,
      baseCatalogRevision: 1,
      ...actor(),
      deleteField: () => DELETE_FIELD,
      nowISO: "2026-08-31T18:03:00.000Z"
    });
    expect(published).toMatchObject({
      catalogRevisionBefore: 1,
      catalogRevisionAfter: 2,
      changedRecordCount: 2,
      receiptId: "publish_request_0001"
    });
    expect(db.store.get("organizations/acme/settings/config")).toMatchObject({
      catalogRevision: 2,
      perMileRateMinor: 95,
      longDistancePerMileRateMinor: 145,
      serverRateMinor: 4800,
      chefRateMinor: 6200,
      bartenderRateMinor: 5200,
      pricingSetupConfirmed: true,
      pricingConfirmation: {
        actorUid: "owner-1",
        actorEmail: "owner@example.com",
        confirmedCatalogRevision: 2
      }
    });
    expect(db.store.get("organizations/acme/settings/config")).not.toHaveProperty("serverRate");
    expect(db.store.get(`organizations/acme/catalogPackages/${packageRecord.id}`).pppMinor)
      .toBe(packageRecord.data.pppMinor + 700);
    expect(db.store.get("organizations/acme/catalogSetupDrafts/current").state).toBe("published");
    expect(db.store.get("organizations/acme/catalogPublicationReceipts/publish_request_0001"))
      .toMatchObject({ catalogRevisionAfter: 2, changedRecordCount: 2 });

    const replay = await publishCatalogSetupDraft({
      db,
      organizationId: "acme",
      requestId: "publish_request_0001",
      expectedGeneration: 2,
      baseCatalogRevision: 1,
      ...actor()
    });
    expect(replay).toMatchObject({ idempotentReplay: true, catalogRevisionAfter: 2 });
    expect(db.store.get("organizations/acme/settings/config").catalogRevision).toBe(2);
  });

  test("fails atomically on stale generation, catalog revision, and baseline conflicts", async () => {
    const { db, plan } = starterDb();
    const packageRecord = plan.collections.catalogPackages[0];
    await saveCatalogSetupDraft({
      db,
      organizationId: "acme",
      requestId: "draft_conflict_001",
      expectedGeneration: 0,
      baseCatalogRevision: 1,
      patches: [{
        collection: "catalogPackages",
        recordId: packageRecord.id,
        intent: "update",
        payload: { ...packageRecord.data, pppMinor: packageRecord.data.pppMinor + 100 }
      }],
      ...actor()
    });

    await expect(saveCatalogSetupDraft({
      db,
      organizationId: "acme",
      requestId: "draft_conflict_002",
      expectedGeneration: 0,
      baseCatalogRevision: 1,
      patches: [{
        collection: "catalogPackages",
        recordId: packageRecord.id,
        intent: "update",
        payload: { ...packageRecord.data, pppMinor: packageRecord.data.pppMinor + 200 }
      }],
      ...actor()
    })).rejects.toMatchObject({ code: "aborted" });

    const path = `organizations/acme/catalogPackages/${packageRecord.id}`;
    db.store.set(path, { ...db.store.get(path), name: "Edited elsewhere" });
    const before = clone(db.store.get("organizations/acme/settings/config"));
    await expect(publishCatalogSetupDraft({
      db,
      organizationId: "acme",
      requestId: "publish_conflict_001",
      expectedGeneration: 1,
      baseCatalogRevision: 1,
      ...actor()
    })).rejects.toMatchObject({ code: "aborted" });
    expect(db.store.get("organizations/acme/settings/config")).toEqual(before);
    expect(db.store.has("organizations/acme/catalogPublicationReceipts/publish_conflict_001")).toBe(false);
  });

  test("bounds and sanitizes draft records", async () => {
    expect(() => normalizeChanges(Array.from({ length: MAX_CHANGED_RECORDS + 1 }, (_, index) => ({
      collection: "eventTypes",
      recordId: `event-${index}`,
      intent: "create",
      payload: { name: `Event ${index}` }
    })))).toThrow(expect.objectContaining({
      name: CatalogSetupDraftError.name,
      code: "resource-exhausted"
    }));
    expect(() => normalizeChanges([{
      collection: "settings",
      payload: { catalogRevision: 99 }
    }])).toThrow(/cannot change catalogRevision/i);
    expect(() => normalizeChanges([{
      collection: "menuItems",
      recordId: "menu-a",
      intent: "create",
      payload: {
        name: "Menu A",
        eventTypeId: "event-a",
        categoryId: "section-a",
        priceMinor: -1
      }
    }])).toThrow(/non-negative integer minor-unit/i);
  });

  test("returns an empty bounded projection instead of exposing the private draft document shape", async () => {
    const { db } = starterDb();
    await expect(getCatalogSetupDraft({ db, organizationId: "acme" })).resolves.toMatchObject({
      currentCatalogRevision: 1,
      draft: {
        state: "empty",
        generation: 0,
        changedRecordCount: 0,
        changes: []
      }
    });
  });
});
