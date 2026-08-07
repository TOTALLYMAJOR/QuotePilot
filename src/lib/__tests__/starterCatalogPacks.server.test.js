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
  mutateManagedMenuItemAvailability,
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

function catalogCollections(db) {
  const collections = {};
  ["catalogPackages", "catalogAddons", "catalogRentals", "eventTypes", "menuCategories", "menuItems"]
    .forEach((name) => {
      collections[name] = collectionSnapshot(
        new FakeCollectionRef(db.store, `organizations/acme/${name}`)
      ).docs.map((snap) => ({ id: snap.id, data: snap.data(), ref: snap.ref }));
    });
  return collections;
}

function fullyReferencedCatalog() {
  const { db } = stagedCatalog();
  const collections = catalogCollections(db);
  const settings = clone(db.store.get("organizations/acme/settings/config"));
  const packageId = collections.catalogPackages[0].id;
  const addonId = collections.catalogAddons[0].id;
  const rentalId = collections.catalogRentals[0].id;
  const menuItem = collections.menuItems[0];
  const eventTypeId = menuItem.data.eventTypeId;
  settings.upsellRules = [
    { id: "addon-rule", kind: "addon", targetId: addonId },
    { id: "rental-rule", kind: "rental", targetId: rentalId },
    { id: "package-rule", kind: "package", targetId: packageId }
  ];
  settings.eventTemplates = [{
    id: "fully-referenced-template",
    name: "Fully referenced template",
    eventTypeId,
    pkg: packageId,
    addons: [addonId],
    rentals: [rentalId],
    menuItems: [menuItem.id],
    taxRegion: settings.defaultTaxRegion,
    seasonProfileId: settings.defaultSeasonProfile,
    bartenderRateTypeId: settings.defaultBartenderRateType,
    staffingRateTypeId: settings.defaultStaffingRateType
  }];
  return { db, collections, settings };
}

describe("starter catalog pack manifests", () => {
  test("keeps the historically staged v1 manifest hashes immutable", () => {
    expect(buildStarterCatalogPackDocuments("wedding-events", { packVersion: 1 }).pack.manifestHash)
      .toBe("2241d1f15cf2069796e171382d45fd78bcf29e94b4246b9b2796a1f8855d954b");
    expect(buildStarterCatalogPackDocuments("corporate-drop-off", { packVersion: 1 }).pack.manifestHash)
      .toBe("d9f4c2774c2b615b918077666db2b4914790c65a5f173a840367c9f707267b5c");
    expect(buildStarterCatalogPackDocuments("bbq-southern", { packVersion: 1 }).pack.manifestHash)
      .toBe("f30196093c9edd4deed9c511cf6ea8372e27e53f5dc09f5ba87e5905f13a65e2");
    expect(buildStarterCatalogPackDocuments("church-community", { packVersion: 1 }).pack.manifestHash)
      .toBe("b8b0bd079274e2785e92394c9018a40dded05a22b31195dde834a47bdec4b720");
  });

  test("keeps exact versioned manifests addressable while exposing one latest summary per pack", () => {
    const keys = manifests.packs.map((pack) => manifestKey(pack.id, pack.version));
    expect(new Set(keys).size).toBe(keys.length);
    expect(getStarterCatalogPackSummaries()).toHaveLength(4);
    expect(getStarterCatalogPackSummaries().every((pack) => pack.version === 2)).toBe(true);
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
    const plan = buildStarterCatalogPackDocuments("wedding-events", { packVersion: 2 });
    const generated = plan.collections.catalogPackages[0].data;
    expect(classifyPackRecord("catalogPackages", generated, "wedding-events", 2)).toBe("generated");
    expect(classifyPackRecord(
      "catalogPackages",
      { ...generated, pppMinor: generated.pppMinor + 100 },
      "wedding-events",
      2
    )).toBe("modified");
    expect(classifyPackRecord(
      "catalogPackages",
      {
        ...generated,
        includedMenuItemIds: [...generated.includedMenuItemIds, "owner-added-menu-item"]
      },
      "wedding-events",
      2
    )).toBe("modified");
    expect(classifyPackRecord(
      "catalogPackages",
      { ...generated, active: false },
      "wedding-events",
      2
    )).toBe("modified");
    expect(classifyPackRecord(
      "catalogPackages",
      { name: "Owner special", pppMinor: 2500 },
      "wedding-events",
      2
    )).toBe("custom");
  });

  test("rejects a package inclusion that is not in the complete authoritative catalog", () => {
    const plan = buildStarterCatalogPackDocuments("wedding-events", { packVersion: 2 });
    plan.collections.catalogPackages[0].data.includedMenuItemIds = ["missing-menu-item"];
    expect(() => validateCatalogForConfirmation({
      settings: plan.settings,
      collections: plan.collections
    })).toThrow(/includes unavailable menu item missing-menu-item/i);
  });
});

describe("starter catalog pack safety", () => {
  test("repairs a confirmed catalog with no menu additively and reopens pricing review", async () => {
    const store = new Map([
      ["organizations/acme/settings/config", {
        catalogRevision: 7,
        pricingSetupConfirmed: true,
        pricingConfirmation: {
          actorUid: "owner-1",
          actorEmail: "owner@example.com",
          confirmedAtISO: "2026-08-05T13:00:00.000Z",
          confirmedCatalogRevision: 7
        },
        serviceFeePct: 0.23,
        depositPct: 0.42
      }],
      ["organizations/acme/catalogPackages/owner-package", {
        name: "Owner package",
        pppMinor: 3500
      }],
      ["organizations/acme/eventTypes/owner-event", {
        name: "Owner event"
      }]
    ]);
    const db = fakeDb(store);

    const result = await applyStarterCatalogPack({
      db,
      organizationId: "acme",
      packId: "wedding-events",
      replaceStagedPack: true,
      expectedCatalogRevision: 7,
      actorUid: "owner-1",
      nowISO: "2026-08-06T15:00:00.000Z"
    });

    expect(result).toMatchObject({
      ok: true,
      recoveredMissingMenu: true,
      preservedExistingRecords: 2,
      catalogRevision: 8
    });
    expect(db.store.get("organizations/acme/catalogPackages/owner-package")).toEqual({
      name: "Owner package",
      pppMinor: 3500
    });
    expect(db.store.get("organizations/acme/settings/config")).toMatchObject({
      catalogRevision: 8,
      pricingSetupConfirmed: false,
      pricingConfirmation: null,
      serviceFeePct: 0.23,
      depositPct: 0.42,
      starterCatalogPack: {
        id: "wedding-events",
        recoveryMode: "additive_missing_menu",
        replacementBlocked: true,
        appliedCatalogRevision: 8
      }
    });
    expect(result.counts.menuCategories).toBeGreaterThan(0);
    expect(result.counts.menuItems).toBeGreaterThan(0);
  });

  test("confirmed-catalog recovery refuses to run when any menu content exists", async () => {
    const store = new Map([
      ["organizations/acme/settings/config", {
        catalogRevision: 3,
        pricingSetupConfirmed: true
      }],
      ["organizations/acme/menuCategories/existing", {
        name: "Existing",
        eventTypeId: "owner-event"
      }]
    ]);
    const db = fakeDb(store);

    await expect(applyStarterCatalogPack({
      db,
      organizationId: "acme",
      packId: "wedding-events",
      replaceStagedPack: true,
      expectedCatalogRevision: 3
    })).rejects.toThrow(/no menu categories or menu items/i);
    expect(db.store.get("organizations/acme/settings/config")).toMatchObject({
      catalogRevision: 3,
      pricingSetupConfirmed: true
    });
  });

  test("confirmed-catalog recovery fails safely on a stale revision", async () => {
    const store = new Map([
      ["organizations/acme/settings/config", {
        catalogRevision: 5,
        pricingSetupConfirmed: true,
        serviceFeePct: 0.2
      }]
    ]);
    const db = fakeDb(store);

    await expect(applyStarterCatalogPack({
      db,
      organizationId: "acme",
      packId: "wedding-events",
      replaceStagedPack: true,
      expectedCatalogRevision: 4
    })).rejects.toMatchObject({ code: "aborted" });
    expect(db.store.size).toBe(1);
    expect(db.store.get("organizations/acme/settings/config")).toEqual({
      catalogRevision: 5,
      pricingSetupConfirmed: true,
      serviceFeePct: 0.2
    });
  });

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

  test.each([
    ["package", "catalogPackages"],
    ["menu item", "menuItems"]
  ])("blocks replacement after an owner removes a generated %s", async (_label, collectionName) => {
    const { db, plan } = stagedCatalog();
    const removedId = plan.collections[collectionName][0].id;
    db.store.delete(`organizations/acme/${collectionName}/${removedId}`);

    await expect(applyStarterCatalogPack({
      db,
      organizationId: "acme",
      packId: "corporate-drop-off",
      replaceStagedPack: true,
      expectedCatalogRevision: 1
    })).rejects.toMatchObject({
      code: "failed-precondition",
      details: {
        missingGeneratedCount: 1,
        missingGeneratedKeys: [`${collectionName}/${removedId}`]
      }
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

  test("server confirmation requires an attributed exact-timestamp receipt", async () => {
    const { db } = stagedCatalog();
    await expect(confirmCatalogPricing({
      db,
      organizationId: "acme",
      expectedCatalogRevision: 1,
      actorUid: "",
      actorEmail: "owner@example.com",
      nowISO: "2026-08-05T13:00:00.000Z"
    })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(confirmCatalogPricing({
      db,
      organizationId: "acme",
      expectedCatalogRevision: 1,
      actorUid: "owner-1",
      actorEmail: "owner@example.com",
      nowISO: "August 5, 2026"
    })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(db.store.get("organizations/acme/settings/config").pricingSetupConfirmed).toBe(false);
  });

  test("server confirmation validates every guided-selling and event-template reference", () => {
    const { settings, collections } = fullyReferencedCatalog();
    expect(() => validateCatalogForConfirmation({ settings, collections })).not.toThrow();

    const automaticSeasonSettings = clone(settings);
    automaticSeasonSettings.defaultSeasonProfile = "auto";
    automaticSeasonSettings.eventTemplates[0].seasonProfileId = "auto";
    expect(() => validateCatalogForConfirmation({
      settings: automaticSeasonSettings,
      collections
    })).not.toThrow();

    const invalidReferences = [
      ["upsell add-on", (draft) => { draft.upsellRules[0].targetId = "missing-addon"; }],
      ["upsell rental", (draft) => { draft.upsellRules[1].targetId = "missing-rental"; }],
      ["upsell package", (draft) => { draft.upsellRules[2].targetId = "missing-package"; }],
      ["template package", (draft) => { draft.eventTemplates[0].pkg = "missing-package"; }],
      ["template add-on", (draft) => { draft.eventTemplates[0].addons = ["missing-addon"]; }],
      ["template rental", (draft) => { draft.eventTemplates[0].rentals = ["missing-rental"]; }],
      ["template menu item", (draft) => { draft.eventTemplates[0].menuItems = ["missing-menu"]; }],
      ["template event type", (draft) => { draft.eventTemplates[0].eventTypeId = "missing-event"; }],
      ["template tax region", (draft) => { draft.eventTemplates[0].taxRegion = "missing-tax"; }],
      ["template season", (draft) => { draft.eventTemplates[0].seasonProfileId = "missing-season"; }],
      ["template bartender rate", (draft) => { draft.eventTemplates[0].bartenderRateTypeId = "missing-bar"; }],
      ["template staffing rate", (draft) => { draft.eventTemplates[0].staffingRateTypeId = "missing-staff"; }]
    ];
    invalidReferences.forEach(([label, mutate]) => {
      const invalidSettings = clone(settings);
      mutate(invalidSettings);
      expect(
        () => validateCatalogForConfirmation({ settings: invalidSettings, collections }),
        label
      ).toThrow(/unavailable/i);
    });
  });

  test("server confirmation rejects inactive records referenced by templates", () => {
    const inactiveReferences = [
      ["package", ({ settings, collections }) => {
        const id = settings.eventTemplates[0].pkg;
        collections.catalogPackages.find((entry) => entry.id === id).data.active = false;
      }],
      ["add-on", ({ settings, collections }) => {
        const id = settings.eventTemplates[0].addons[0];
        collections.catalogAddons.find((entry) => entry.id === id).data.active = false;
      }],
      ["rental", ({ settings, collections }) => {
        const id = settings.eventTemplates[0].rentals[0];
        collections.catalogRentals.find((entry) => entry.id === id).data.active = false;
      }],
      ["menu item", ({ settings, collections }) => {
        const id = settings.eventTemplates[0].menuItems[0];
        collections.menuItems.find((entry) => entry.id === id).data.active = false;
      }],
      ["event type", ({ settings, collections }) => {
        const id = settings.eventTemplates[0].eventTypeId;
        collections.eventTypes.find((entry) => entry.id === id).data.active = false;
      }],
      ["tax region", ({ settings }) => {
        const id = settings.eventTemplates[0].taxRegion;
        settings.taxRegions.find((entry) => entry.id === id).active = false;
      }],
      ["seasonal profile", ({ settings }) => {
        const id = settings.eventTemplates[0].seasonProfileId;
        settings.seasonalProfiles.find((entry) => entry.id === id).active = false;
      }],
      ["bartender rate", ({ settings }) => {
        const id = settings.eventTemplates[0].bartenderRateTypeId;
        settings.bartenderRateTypes.find((entry) => entry.id === id).active = false;
      }],
      ["staffing rate", ({ settings }) => {
        const id = settings.eventTemplates[0].staffingRateTypeId;
        settings.staffingRateTypes.find((entry) => entry.id === id).active = false;
      }]
    ];
    inactiveReferences.forEach(([label, mutate]) => {
      const fixture = fullyReferencedCatalog();
      mutate(fixture);
      expect(
        () => validateCatalogForConfirmation(fixture),
        label
      ).toThrow(/unavailable/i);
    });
  });

  test("malformed pricing collection settings fail with a controlled precondition", () => {
    [
      "serviceFeeTiers",
      "taxRegions",
      "bartenderRateTypes",
      "staffingRateTypes",
      "seasonalProfiles"
    ].forEach((key) => {
      const { settings, collections } = fullyReferencedCatalog();
      settings[key] = { malformed: true };
      let thrown;
      try {
        validateCatalogForConfirmation({ settings, collections });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, key).toMatchObject({
        name: "StarterCatalogPackError",
        code: "failed-precondition"
      });
      expect(thrown?.message).toMatch(/must be configured as an array/i);
    });
  });

  test("managed menu deactivation is revisioned and refuses referenced records transactionally", async () => {
    const { db, plan } = stagedCatalog();
    const referencedItemId = plan.collections.catalogPackages[0].data.includedMenuItemIds[0];
    const settingsPath = "organizations/acme/settings/config";
    const itemPath = `organizations/acme/menuItems/${referencedItemId}`;

    await expect(mutateManagedMenuItemAvailability({
      db,
      organizationId: "acme",
      itemId: referencedItemId,
      action: "deactivate",
      expectedCatalogRevision: 1,
      actorUid: "owner-1",
      nowISO: "2026-08-06T15:00:00.000Z"
    })).rejects.toMatchObject({
      code: "failed-precondition",
      details: { itemId: referencedItemId }
    });
    expect(db.store.get(itemPath).active).toBe(true);
    expect(db.store.get(settingsPath).catalogRevision).toBe(1);
  });

  test("managed menu deactivation fails on stale revision then reopens pricing review", async () => {
    const { db, plan } = stagedCatalog();
    const includedIds = new Set(
      plan.collections.catalogPackages.flatMap((entry) => entry.data.includedMenuItemIds)
    );
    const itemEntry = plan.collections.menuItems.find((entry) => !includedIds.has(entry.id));
    expect(itemEntry).toBeTruthy();
    const settingsPath = "organizations/acme/settings/config";
    const itemPath = `organizations/acme/menuItems/${itemEntry.id}`;

    await expect(mutateManagedMenuItemAvailability({
      db,
      organizationId: "acme",
      itemId: itemEntry.id,
      action: "deactivate",
      expectedCatalogRevision: 0,
      actorUid: "owner-1"
    })).rejects.toMatchObject({ code: "aborted" });
    expect(db.store.get(itemPath).active).toBe(true);

    const result = await mutateManagedMenuItemAvailability({
      db,
      organizationId: "acme",
      itemId: itemEntry.id,
      action: "deactivate",
      item: {
        name: itemEntry.data.name,
        priceMinor: itemEntry.data.priceMinor,
        pricingType: itemEntry.data.pricingType
      },
      expectedCatalogRevision: 1,
      actorUid: "owner-1",
      nowISO: "2026-08-06T15:00:00.000Z"
    });

    expect(result).toMatchObject({ ok: true, action: "deactivate", catalogRevision: 2 });
    expect(db.store.get(itemPath)).toMatchObject({
      active: false,
      priceMinor: itemEntry.data.priceMinor,
      updatedByUid: "owner-1"
    });
    expect(db.store.get(settingsPath)).toMatchObject({
      catalogRevision: 2,
      pricingSetupConfirmed: false,
      pricingConfirmation: null
    });
  });

  test("managed menu deletion uses the same revision precondition", async () => {
    const { db, plan } = stagedCatalog();
    const includedIds = new Set(
      plan.collections.catalogPackages.flatMap((entry) => entry.data.includedMenuItemIds)
    );
    const itemEntry = [...plan.collections.menuItems]
      .reverse()
      .find((entry) => !includedIds.has(entry.id));
    const itemPath = `organizations/acme/menuItems/${itemEntry.id}`;

    const result = await mutateManagedMenuItemAvailability({
      db,
      organizationId: "acme",
      itemId: itemEntry.id,
      action: "delete",
      expectedCatalogRevision: 1,
      actorUid: "owner-1",
      nowISO: "2026-08-06T15:00:00.000Z"
    });
    expect(result).toMatchObject({ ok: true, action: "delete", catalogRevision: 2 });
    expect(db.store.has(itemPath)).toBe(false);
  });

  test.each([
    ["package dependencies", ({ db, plan }) => {
      const packageId = plan.collections.catalogPackages[0].id;
      db.store.get(`organizations/acme/catalogPackages/${packageId}`).includedMenuItemIds = {
        malformed: true
      };
    }, { malformedPackageId: expect.any(String) }],
    ["event template collection", ({ db }) => {
      db.store.get("organizations/acme/settings/config").eventTemplates = { malformed: true };
    }, { malformedSetting: "eventTemplates" }],
    ["event template dependencies", ({ db }) => {
      db.store.get("organizations/acme/settings/config").eventTemplates = [{
        id: "malformed-template",
        menuItems: { malformed: true }
      }];
    }, { malformedTemplateIndex: 0 }]
  ])("managed menu deletion rejects malformed %s without mutating state", async (_label, corrupt, details) => {
    const fixture = stagedCatalog();
    const { db, plan } = fixture;
    const includedIds = new Set(
      plan.collections.catalogPackages.flatMap((entry) => entry.data.includedMenuItemIds)
    );
    const itemEntry = [...plan.collections.menuItems]
      .reverse()
      .find((entry) => !includedIds.has(entry.id));
    const settingsPath = "organizations/acme/settings/config";
    const itemPath = `organizations/acme/menuItems/${itemEntry.id}`;
    corrupt(fixture);

    await expect(mutateManagedMenuItemAvailability({
      db,
      organizationId: "acme",
      itemId: itemEntry.id,
      action: "delete",
      expectedCatalogRevision: 1,
      actorUid: "owner-1"
    })).rejects.toMatchObject({ code: "failed-precondition", details });
    expect(db.store.has(itemPath)).toBe(true);
    expect(db.store.get(settingsPath).catalogRevision).toBe(1);
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

  test("server confirmation rejects catalogs with an event type but no menu", () => {
    expect(() => validateCatalogForConfirmation({
      settings: {},
      collections: {
        catalogPackages: [{
          id: "owner-package",
          data: { name: "Owner package", pppMinor: 2500 }
        }],
        eventTypes: [{ id: "owner-event", data: { name: "Owner event" } }],
        menuCategories: [],
        menuItems: []
      }
    })).toThrow(/menu category/i);
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
        eventTypes: [{ id: "event", data: { name: "Event" } }],
        menuCategories: [{
          id: "mains",
          data: { name: "Mains", eventTypeId: "event" }
        }],
        menuItems: [{
          id: "chicken",
          data: {
            name: "Chicken",
            eventTypeId: "event",
            categoryId: "mains",
            priceMinor: 0,
            pricingType: "per_event"
          }
        }]
      }
    })).toThrow(/pack-owned.*integer minor units/i);
  });
});
