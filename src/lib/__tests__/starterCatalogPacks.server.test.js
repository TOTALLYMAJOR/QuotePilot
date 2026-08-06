import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  PACK_SOURCE,
  applyStarterCatalogPack,
  buildCatalogMoneyMigrations,
  buildStarterCatalogPackDocuments,
  classifyPackRecord,
  confirmCatalogPricing,
  findStarterCatalogPack,
  getStarterCatalogPackSummaries,
  manifestKey,
  validateCatalogForConfirmation
} = require("../../../functions/starterCatalogPacks.js");
const manifests = require("../../../functions/data/starterCatalogPacks.json");

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

function fakeDb(initial = new Map()) {
  const store = initial;
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

function stagedCatalog(packId = "wedding-events", revision = 1) {
  const plan = buildStarterCatalogPackDocuments(packId, {
    nowISO: "2026-08-05T12:00:00.000Z",
    actorUid: "owner-1"
  });
  const store = new Map([
    ["organizations/acme/settings/config", {
      ...clone(plan.settings),
      catalogRevision: revision,
      pricingSettingsVersion: 0
    }]
  ]);
  Object.entries(plan.collections).forEach(([collectionName, entries]) => {
    entries.forEach((entry) => {
      store.set(`organizations/acme/${collectionName}/${entry.id}`, clone(entry.data));
    });
  });
  return { db: fakeDb(store), plan };
}

describe("starter catalog pack manifests", () => {
  test("keeps exact versioned manifests addressable while exposing one latest summary per pack", () => {
    const keys = manifests.packs.map((pack) => manifestKey(pack.id, pack.version));
    expect(new Set(keys).size).toBe(keys.length);
    expect(getStarterCatalogPackSummaries()).toHaveLength(4);
    manifests.packs.forEach((pack) => {
      expect(findStarterCatalogPack(pack.id, pack.version)).toMatchObject({
        id: pack.id,
        version: pack.version
      });
      expect(buildStarterCatalogPackDocuments(pack.id, { packVersion: pack.version }).pack)
        .toMatchObject({ manifestKey: `${pack.id}@${pack.version}` });
      expect(buildStarterCatalogPackDocuments(pack.id, { packVersion: pack.version }).pack.manifestHash)
        .toMatch(/^[a-f0-9]{64}$/);
    });
  });

  test("stores every pack monetary value in integer minor units", () => {
    manifests.packs.forEach((pack) => {
      pack.packages.forEach((entry) => expect(Number.isSafeInteger(entry.pppMinor)).toBe(true));
      [...pack.addons, ...pack.rentals].forEach((entry) =>
        expect(Number.isSafeInteger(entry.priceMinor)).toBe(true)
      );
      ["bartenderRateMinor", "serverRateMinor", "chefRateMinor"].forEach((key) =>
        expect(Number.isSafeInteger(pack.settings[key])).toBe(true)
      );
    });
  });

  test("distinguishes generated, modified, and custom records by immutable baseline hash", () => {
    const plan = buildStarterCatalogPackDocuments("wedding-events");
    const generated = plan.collections.catalogPackages[0].data;
    expect(classifyPackRecord("catalogPackages", generated, "wedding-events", 1)).toBe("generated");
    expect(classifyPackRecord(
      "catalogPackages",
      { ...generated, pppMinor: generated.pppMinor + 100 },
      "wedding-events",
      1
    )).toBe("modified");
    expect(classifyPackRecord(
      "catalogPackages",
      { name: "Owner special", pppMinor: 2500 },
      "wedding-events",
      1
    )).toBe("custom");
  });
});

describe("starter catalog pack safety", () => {
  test("rejects stale apply revisions before replacing content", async () => {
    const { db } = stagedCatalog();
    await expect(applyStarterCatalogPack({
      db,
      organizationId: "acme",
      packId: "corporate-drop-off",
      replaceStagedPack: true,
      expectedCatalogRevision: 0
    })).rejects.toMatchObject({ code: "aborted" });
  });

  test("blocks replacement after any pack-owned record diverges", async () => {
    const { db, plan } = stagedCatalog();
    const packageId = plan.collections.catalogPackages[0].id;
    const path = `organizations/acme/catalogPackages/${packageId}`;
    db.store.set(path, { ...db.store.get(path), name: "Owner-edited celebration" });

    await expect(applyStarterCatalogPack({
      db,
      organizationId: "acme",
      packId: "corporate-drop-off",
      replaceStagedPack: true,
      expectedCatalogRevision: 1
    })).rejects.toMatchObject({
      code: "failed-precondition",
      details: { modifiedCount: 1 }
    });
  });

  test("blocks replacement after a pack pricing setting diverges", async () => {
    const { db } = stagedCatalog();
    const settingsPath = "organizations/acme/settings/config";
    db.store.set(settingsPath, { ...db.store.get(settingsPath), serviceFeePct: 0.25 });

    await expect(applyStarterCatalogPack({
      db,
      organizationId: "acme",
      packId: "corporate-drop-off",
      replaceStagedPack: true,
      expectedCatalogRevision: 1
    })).rejects.toMatchObject({ code: "failed-precondition" });
  });

  test("server confirmation validates the complete catalog and records actor plus revision", async () => {
    const { db } = stagedCatalog();
    await confirmCatalogPricing({
      db,
      organizationId: "acme",
      expectedCatalogRevision: 1,
      actorUid: "owner-1",
      actorEmail: "Owner@Example.com",
      nowISO: "2026-08-05T13:00:00.000Z"
    });
    expect(db.store.get("organizations/acme/settings/config")).toMatchObject({
      pricingSetupConfirmed: true,
      pricingConfirmation: {
        actorUid: "owner-1",
        actorEmail: "owner@example.com",
        confirmedAtISO: "2026-08-05T13:00:00.000Z",
        confirmedCatalogRevision: 1
      }
    });
  });

  test("server confirmation rejects invalid cross-collection menu references", () => {
    const { db } = stagedCatalog();
    const collections = {};
    ["catalogPackages", "catalogAddons", "catalogRentals", "eventTypes", "menuCategories", "menuItems"]
      .forEach((name) => {
        collections[name] = collectionSnapshot(
          new FakeCollectionRef(db.store, `organizations/acme/${name}`)
        ).docs.map((snap) => ({ id: snap.id, data: snap.data(), ref: snap.ref }));
      });
    collections.eventTypes = [];
    expect(() => validateCatalogForConfirmation({
      settings: db.store.get("organizations/acme/settings/config"),
      collections
    })).toThrow(/event type/i);
  });

  test("server confirmation rejects a menu item assigned across event-type boundaries", () => {
    const { db } = stagedCatalog();
    const collections = {};
    ["catalogPackages", "catalogAddons", "catalogRentals", "eventTypes", "menuCategories", "menuItems"]
      .forEach((name) => {
        collections[name] = collectionSnapshot(
          new FakeCollectionRef(db.store, `organizations/acme/${name}`)
        ).docs.map((snap) => ({ id: snap.id, data: snap.data(), ref: snap.ref }));
      });
    collections.eventTypes.push({ id: "other-event", data: { name: "Other Event" } });
    collections.menuItems[0].data.eventTypeId = "other-event";
    expect(() => validateCatalogForConfirmation({
      settings: db.store.get("organizations/acme/settings/config"),
      collections
    })).toThrow(/invalid menu reference/i);
  });

  test("legacy custom amounts receive a lossless minor-unit migration plan", () => {
    const ref = { path: "organizations/acme/catalogPackages/legacy" };
    const migrations = buildCatalogMoneyMigrations({
      settings: {
        perMileRate: 0.7,
        longDistancePerMileRate: 1.1,
        bartenderRate: 30,
        serverRate: 22,
        chefRate: 30,
        bartenderRateTypes: [{ id: "standard", name: "Standard", rate: 30 }],
        staffingRateTypes: [{ id: "standard", name: "Standard", serverRate: 22, chefRate: 30 }]
      },
      collections: {
        catalogPackages: [{ id: "legacy", ref, data: { name: "Legacy", ppp: 24.5 } }]
      }
    });
    expect(migrations.documentMigrations).toEqual([{
      ref,
      data: { pppMinor: 2450 }
    }]);
    expect(migrations.settingsPatch).toMatchObject({
      perMileRateMinor: 70,
      bartenderRateMinor: 3000,
      bartenderRateTypes: [{ id: "standard", name: "Standard", rateMinor: 3000 }]
    });
  });

  test("pack-owned records cannot fall back to decimal money", () => {
    expect(() => validateCatalogForConfirmation({
      settings: {},
      collections: {
        catalogPackages: [{
          id: "bad-pack-record",
          data: { source: PACK_SOURCE, name: "Bad", ppp: 20 }
        }],
        eventTypes: [{ id: "event", data: { name: "Event" } }]
      }
    })).toThrow(/pack-owned.*integer minor units/i);
  });
});
