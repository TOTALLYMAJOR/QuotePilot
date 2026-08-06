#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";
import {
  DEFAULT_ADDONS,
  DEFAULT_EVENT_TEMPLATES,
  DEFAULT_MENU_SECTIONS,
  DEFAULT_PACKAGES,
  DEFAULT_RENTALS,
  DEFAULT_SETTINGS
} from "../src/data/mockCatalog.js";

const require = createRequire(import.meta.url);
const {
  applyStarterCatalogPack,
  buildStarterCatalogPackDocuments
} = require("../functions/starterCatalogPacks.js");

const MAX_BATCH_WRITES = 450;
const VALUE_FLAGS = new Set([
  "--project",
  "--organization",
  "--org",
  "--pack",
  "--pack-version",
  "--confirm"
]);
const BOOLEAN_FLAGS = new Set(["--dry-run", "--apply", "--replace-staged-pack"]);

function slugify(value, fallback = "item") {
  const raw = String(value || fallback).trim().toLowerCase();
  const slug = raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

function uniqueEventTypes() {
  const seen = new Set();
  return DEFAULT_EVENT_TEMPLATES
    .map((template) => ({
      id: slugify(template.id || template.name, "event"),
      name: String(template.name || template.id || "Event").trim()
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

function normalizeSectionItems(section) {
  const source = Array.isArray(section?.items) ? section.items : [];
  const seen = new Set();
  const normalizePricingType = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "per_person" || raw === "per_item" || raw === "per_event") return raw;
    return "per_event";
  };
  return source
    .map((item, index) => {
      if (typeof item === "string") {
        const name = item.trim();
        return {
          id: slugify(name, `item-${index + 1}`),
          name: name || `Item ${index + 1}`,
          pricingType: "per_event",
          type: "per_event",
          priceMinor: 0,
          active: true
        };
      }
      const name = String(item?.name || "").trim();
      const pricingType = normalizePricingType(item?.pricingType || item?.type);
      return {
        id: slugify(item?.id || name, `item-${index + 1}`),
        name: name || `Item ${index + 1}`,
        pricingType,
        type: pricingType,
        priceMinor: Math.round(Number(item?.price || 0) * 100),
        active: item?.active !== false
      };
    })
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

function buildSeedDocs(nowISO) {
  const eventTypeDocs = [];
  const categoryDocs = [];
  const itemDocs = [];
  const eventTypes = uniqueEventTypes();

  eventTypes.forEach((eventType) => {
    eventTypeDocs.push({
      id: eventType.id,
      data: {
        name: eventType.name,
        source: "seed-script",
        createdAtISO: nowISO
      }
    });

    DEFAULT_MENU_SECTIONS.forEach((section, sectionIndex) => {
      const sectionIdBase = slugify(section?.id || section?.name, `category-${sectionIndex + 1}`);
      const categoryId = `${eventType.id}__${sectionIdBase}`;

      categoryDocs.push({
        id: categoryId,
        data: {
          eventTypeId: eventType.id,
          name: String(section?.name || `Category ${sectionIndex + 1}`).trim(),
          source: "seed-script",
          createdAtISO: nowISO
        }
      });

      const sectionItems = normalizeSectionItems(section);
      sectionItems.forEach((item, itemIndex) => {
        const itemId = `${categoryId}__${slugify(item.id, `item-${itemIndex + 1}`)}`;
        itemDocs.push({
          id: itemId,
          data: {
            eventTypeId: eventType.id,
            categoryId,
            name: item.name,
            pricingType: item.pricingType,
            type: item.type,
            priceMinor: Number(item.priceMinor || 0),
            active: item.active !== false,
            source: "seed-script",
            createdAtISO: nowISO
          }
        });
      });
    });
  });

  return { eventTypeDocs, categoryDocs, itemDocs };
}

function buildCatalogDocs(nowISO) {
  const packageDocs = DEFAULT_PACKAGES.map((item) => ({
    id: slugify(item?.id || item?.name, "package"),
    data: {
      name: String(item?.name || "").trim() || "Package",
      pppMinor: Math.round(Number(item?.ppp || 0) * 100),
      source: "seed-script",
      createdAtISO: nowISO
    }
  }));

  const addonDocs = DEFAULT_ADDONS.map((item) => {
    const pricingType = normalizePricingType(item?.pricingType || item?.type || "per_person", "per_person");
    return {
      id: slugify(item?.id || item?.name, "addon"),
      data: {
        name: String(item?.name || "").trim() || "Addon",
        pricingType,
        type: pricingType,
        priceMinor: Math.round(Number(item?.price || 0) * 100),
        active: item?.active !== false,
        source: "seed-script",
        createdAtISO: nowISO
      }
    };
  });

  const rentalDocs = DEFAULT_RENTALS.map((item) => {
    const pricingType = normalizePricingType(item?.pricingType || item?.type || "per_item", "per_item");
    return {
      id: slugify(item?.id || item?.name, "rental"),
      data: {
        name: String(item?.name || "").trim() || "Rental",
        priceMinor: Math.round(Number(item?.price || 0) * 100),
        qtyPerGuests: Number(item?.qtyPerGuests || 1),
        pricingType,
        type: pricingType,
        active: item?.active !== false,
        source: "seed-script",
        createdAtISO: nowISO
      }
    };
  });

  const {
    perMileRate,
    longDistancePerMileRate,
    bartenderRate,
    serverRate,
    chefRate,
    bartenderRateTypes,
    staffingRateTypes,
    ...settingsWithoutLegacyMoney
  } = DEFAULT_SETTINGS;
  const settingsData = {
    ...settingsWithoutLegacyMoney,
    perMileRateMinor: Math.round(Number(perMileRate || 0) * 100),
    longDistancePerMileRateMinor: Math.round(Number(longDistancePerMileRate || 0) * 100),
    bartenderRateMinor: Math.round(Number(bartenderRate || 0) * 100),
    serverRateMinor: Math.round(Number(serverRate || 0) * 100),
    chefRateMinor: Math.round(Number(chefRate || 0) * 100),
    bartenderRateTypes: (bartenderRateTypes || []).map(({ rate, ...entry }) => ({
      ...entry,
      rateMinor: Math.round(Number(rate || 0) * 100)
    })),
    staffingRateTypes: (staffingRateTypes || []).map(({ serverRate: rowServerRate, chefRate: rowChefRate, ...entry }) => ({
      ...entry,
      serverRateMinor: Math.round(Number(rowServerRate || 0) * 100),
      chefRateMinor: Math.round(Number(rowChefRate || 0) * 100)
    })),
    source: "seed-script",
    createdAtISO: nowISO,
    updatedAtISO: nowISO
  };

  return { packageDocs, addonDocs, rentalDocs, settingsData };
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  const normalized = String(value || "").trim();
  if (!normalized || normalized.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return normalized;
}

export function parseSeedArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const values = new Map();
  const modes = new Set();
  const flags = new Set();
  const seen = new Set();

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    const canonicalToken = token === "--org" ? "--organization" : token;
    if (BOOLEAN_FLAGS.has(token)) {
      if (seen.has(token)) {
        throw new Error(`Duplicate argument: ${token}`);
      }
      seen.add(token);
      if (token === "--dry-run" || token === "--apply") modes.add(token);
      else flags.add(token);
      continue;
    }
    if (VALUE_FLAGS.has(token)) {
      if (seen.has(canonicalToken)) {
        throw new Error(`Duplicate argument: ${canonicalToken}`);
      }
      seen.add(canonicalToken);
      values.set(canonicalToken, takeValue(args, i, token));
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token || "(empty)"}`);
  }

  if (modes.has("--dry-run") && modes.has("--apply")) {
    throw new Error("Choose exactly one seed mode: --dry-run or --apply.");
  }

  const projectId = String(values.get("--project") || "").trim();
  const organizationId = slugify(values.get("--organization"), "");
  if (!projectId) {
    throw new Error("Missing project id. Run with --project <firebase-project-id>.");
  }
  if (!/^[a-z0-9][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error("--project must be an explicit valid Firebase project id.");
  }
  if (!organizationId) {
    throw new Error("Missing organization id. Run with --organization <organization-id>.");
  }

  const apply = modes.has("--apply");
  const packId = slugify(values.get("--pack"), "");
  const rawPackVersion = String(values.get("--pack-version") || "").trim();
  const packVersion = rawPackVersion ? Number(rawPackVersion) : null;
  const replaceStagedPack = flags.has("--replace-staged-pack");
  if (rawPackVersion && (!Number.isSafeInteger(packVersion) || packVersion <= 0)) {
    throw new Error("--pack-version must be a positive integer.");
  }
  if (packVersion && !packId) {
    throw new Error("--pack-version requires --pack.");
  }
  if (replaceStagedPack && !packId) {
    throw new Error("--replace-staged-pack requires --pack.");
  }
  const confirmation = String(values.get("--confirm") || "").trim();
  const expectedConfirmation = `SEED ${projectId} ${organizationId}`;
  if (!apply && confirmation) {
    throw new Error("--confirm is valid only with --apply.");
  }
  if (apply && confirmation !== expectedConfirmation) {
    throw new Error(`Apply requires --confirm "${expectedConfirmation}". The default mode is read-only.`);
  }

  return {
    projectId,
    organizationId,
    dryRun: !apply,
    apply,
    packId,
    packVersion,
    replaceStagedPack,
    expectedConfirmation
  };
}

async function fetchMissingDocs(db, collectionPath, docs) {
  if (!docs.length) {
    return { missing: [], existingCount: 0 };
  }
  const refs = docs.map((entry) => db.collection(collectionPath).doc(entry.id));
  const snapshots = await db.getAll(...refs);
  const missing = [];
  let existingCount = 0;

  snapshots.forEach((snapshot, index) => {
    if (snapshot.exists) {
      existingCount += 1;
      return;
    }
    missing.push(docs[index]);
  });

  return { missing, existingCount };
}

async function createDocsInBatches(db, collectionPath, docs, { merge = false } = {}) {
  let created = 0;
  for (let i = 0; i < docs.length; i += MAX_BATCH_WRITES) {
    const chunk = docs.slice(i, i + MAX_BATCH_WRITES);
    const batch = db.batch();
    chunk.forEach((entry) => {
      const ref = db.collection(collectionPath).doc(entry.id);
      if (merge) {
        batch.set(ref, entry.data, { merge: true });
      } else {
        batch.create(ref, entry.data);
      }
    });
    await batch.commit();
    created += chunk.length;
  }
  return created;
}

async function seedCollection({ db, collectionPath, docs, dryRun }) {
  const { missing, existingCount } = await fetchMissingDocs(db, collectionPath, docs);
  if (dryRun || missing.length === 0) {
    return {
      total: docs.length,
      existing: existingCount,
      created: dryRun ? 0 : 0,
      wouldCreate: dryRun ? missing.length : 0,
      backfilled: 0,
      wouldBackfill: 0
    };
  }

  const created = await createDocsInBatches(db, collectionPath, missing);
  return {
    total: docs.length,
    existing: existingCount,
    created,
    wouldCreate: 0,
    backfilled: 0,
    wouldBackfill: 0
  };
}

function normalizePricingType(value, fallback = "per_event") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === "per_person" || raw === "per_item" || raw === "per_event") return raw;
  return fallback;
}

async function seedMenuItemsCollection({ db, collectionPath, docs, dryRun }) {
  if (!docs.length) {
    return {
      total: 0,
      existing: 0,
      created: 0,
      backfilled: 0,
      wouldCreate: 0,
      wouldBackfill: 0
    };
  }

  const refs = docs.map((entry) => db.collection(collectionPath).doc(entry.id));
  const snapshots = await db.getAll(...refs);
  const missing = [];
  const backfill = [];
  let existing = 0;

  snapshots.forEach((snapshot, index) => {
    const entry = docs[index];
    if (!snapshot.exists) {
      missing.push(entry);
      return;
    }
    existing += 1;
    const current = snapshot.data() || {};
    const resolvedPricingType = normalizePricingType(current.pricingType || current.type || entry.data.pricingType, "per_event");
    const patch = {};
    if (!String(current.pricingType || "").trim()) patch.pricingType = resolvedPricingType;
    if (!String(current.type || "").trim()) patch.type = resolvedPricingType;
    if (typeof current.active !== "boolean") patch.active = true;
    if (!Object.keys(patch).length) return;
    backfill.push({
      id: entry.id,
      data: {
        ...patch,
        updatedAtISO: new Date().toISOString()
      }
    });
  });

  if (dryRun) {
    return {
      total: docs.length,
      existing,
      created: 0,
      backfilled: 0,
      wouldCreate: missing.length,
      wouldBackfill: backfill.length
    };
  }

  const created = missing.length ? await createDocsInBatches(db, collectionPath, missing) : 0;
  const backfilled = backfill.length ? await createDocsInBatches(db, collectionPath, backfill, { merge: true }) : 0;

  return {
    total: docs.length,
    existing,
    created,
    backfilled,
    wouldCreate: 0,
    wouldBackfill: 0
  };
}

async function seedSettingsDoc({ db, docPath, data, dryRun }) {
  const ref = db.doc(docPath);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    return {
      total: 1,
      existing: 1,
      created: 0,
      wouldCreate: 0
    };
  }
  if (dryRun) {
    return {
      total: 1,
      existing: 0,
      created: 0,
      wouldCreate: 1
    };
  }
  await ref.create(data);
  return {
    total: 1,
    existing: 0,
    created: 1,
    wouldCreate: 0
  };
}

async function main() {
  const {
    projectId,
    organizationId,
    dryRun,
    packId,
    packVersion,
    replaceStagedPack
  } = parseSeedArgs(process.argv.slice(2));
  const admin = loadFirebaseAdmin();

  if (!admin.getApps().length) {
    admin.initializeApp({ projectId });
  }

  const db = admin.getFirestore();
  const nowISO = new Date().toISOString();
  const basePath = `organizations/${organizationId}`;
  const organizationRef = db.doc(basePath);
  const organizationSnapshot = await organizationRef.get();
  if (!organizationSnapshot.exists) {
    throw new Error(
      `Organization ${organizationId} does not exist in project ${projectId}. Provision the tenant before seeding it.`
    );
  }
  const organization = organizationSnapshot.data() || {};
  const organizationStatus = String(organization.status || "").trim().toLowerCase();
  if (
    organization.active === false
    || organization.archived === true
    || (organizationStatus && organizationStatus !== "active")
  ) {
    throw new Error(`Organization ${organizationId} is inactive or archived; refusing to seed it.`);
  }
  if (packId) {
    const plan = buildStarterCatalogPackDocuments(packId, { packVersion, nowISO });
    const settingsRef = db.doc(`organizations/${organizationId}/settings/config`);
    const settingsSnapshot = await settingsRef.get();
    if (!settingsSnapshot.exists) {
      throw new Error(`Organization ${organizationId} has no settings/config document; refusing pack application.`);
    }
    const expectedCatalogRevision = Math.max(
      0,
      Number(settingsSnapshot.data()?.catalogRevision || 0)
    );
    if (dryRun) {
      console.log("Dry run completed. No writes were attempted.");
      console.log(`Project: ${projectId}`);
      console.log(`Organization: ${organizationId}`);
      console.log(`Starter pack: ${plan.pack.manifestKey} (${plan.pack.name})`);
      console.log(`Expected catalog revision: ${expectedCatalogRevision}`);
      console.log(`Planned records: ${plan.totalRecords}`);
      console.log("Apply will recheck blank/staged state, divergence, pricing settings, and revision in one transaction.");
      return;
    }
    const result = await applyStarterCatalogPack({
      db,
      organizationId,
      packId,
      packVersion,
      replaceStagedPack,
      expectedCatalogRevision,
      actorUid: "seed-firestore-menu",
      serverTimestamp: admin.FieldValue.serverTimestamp,
      deleteField: admin.FieldValue.delete,
      nowISO
    });
    console.log("Starter pack apply completed.");
    console.log(`Project: ${projectId}`);
    console.log(`Organization: ${organizationId}`);
    console.log(`Starter pack: ${result.pack.manifestKey} (${result.pack.name})`);
    console.log(`Catalog revision: ${result.catalogRevision}`);
    return;
  }
  const paths = {
    eventTypes: `${basePath}/eventTypes`,
    menuCategories: `${basePath}/menuCategories`,
    menuItems: `${basePath}/menuItems`,
    catalogPackages: `${basePath}/catalogPackages`,
    catalogAddons: `${basePath}/catalogAddons`,
    catalogRentals: `${basePath}/catalogRentals`,
    settingsConfigDoc: `${basePath}/settings/config`
  };
  const { eventTypeDocs, categoryDocs, itemDocs } = buildSeedDocs(nowISO);
  const { packageDocs, addonDocs, rentalDocs, settingsData } = buildCatalogDocs(nowISO);

  const [eventTypeSummary, categorySummary, itemSummary, packageSummary, addonSummary, rentalSummary, settingsSummary] = await Promise.all([
    seedCollection({ db, collectionPath: paths.eventTypes, docs: eventTypeDocs, dryRun }),
    seedCollection({ db, collectionPath: paths.menuCategories, docs: categoryDocs, dryRun }),
    seedMenuItemsCollection({ db, collectionPath: paths.menuItems, docs: itemDocs, dryRun }),
    seedCollection({ db, collectionPath: paths.catalogPackages, docs: packageDocs, dryRun }),
    seedCollection({ db, collectionPath: paths.catalogAddons, docs: addonDocs, dryRun }),
    seedCollection({ db, collectionPath: paths.catalogRentals, docs: rentalDocs, dryRun }),
    seedSettingsDoc({ db, docPath: paths.settingsConfigDoc, data: settingsData, dryRun })
  ]);

  const label = dryRun ? "Dry run completed. No writes were attempted." : "Seed apply completed.";
  console.log(label);
  console.log(`Project: ${projectId}`);
  console.log(`Organization: ${organizationId}`);
  console.log(
    `eventTypes -> total:${eventTypeSummary.total} existing:${eventTypeSummary.existing} created:${eventTypeSummary.created}`
    + (dryRun ? ` wouldCreate:${eventTypeSummary.wouldCreate}` : "")
  );
  console.log(
    `menuCategories -> total:${categorySummary.total} existing:${categorySummary.existing} created:${categorySummary.created}`
    + (dryRun ? ` wouldCreate:${categorySummary.wouldCreate}` : "")
  );
  console.log(
    `menuItems -> total:${itemSummary.total} existing:${itemSummary.existing} created:${itemSummary.created}`
    + `${dryRun ? ` wouldCreate:${itemSummary.wouldCreate}` : ""}`
    + ` backfilled:${itemSummary.backfilled}`
    + `${dryRun ? ` wouldBackfill:${itemSummary.wouldBackfill}` : ""}`
  );
  console.log(
    `catalogPackages -> total:${packageSummary.total} existing:${packageSummary.existing} created:${packageSummary.created}`
    + (dryRun ? ` wouldCreate:${packageSummary.wouldCreate}` : "")
  );
  console.log(
    `catalogAddons -> total:${addonSummary.total} existing:${addonSummary.existing} created:${addonSummary.created}`
    + (dryRun ? ` wouldCreate:${addonSummary.wouldCreate}` : "")
  );
  console.log(
    `catalogRentals -> total:${rentalSummary.total} existing:${rentalSummary.existing} created:${rentalSummary.created}`
    + (dryRun ? ` wouldCreate:${rentalSummary.wouldCreate}` : "")
  );
  console.log(
    `settings/config -> total:${settingsSummary.total} existing:${settingsSummary.existing} created:${settingsSummary.created}`
    + (dryRun ? ` wouldCreate:${settingsSummary.wouldCreate}` : "")
  );
}

const isDirectExecution = Boolean(
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (isDirectExecution) {
  main().catch((error) => {
    console.error("Menu seed failed:", error?.message || error);
    process.exitCode = 1;
  });
}
