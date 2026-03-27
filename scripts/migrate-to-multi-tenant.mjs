#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const MAX_BATCH_WRITES = 450;

function slugify(value, fallback = "default-org") {
  const raw = String(value || "").trim().toLowerCase();
  const normalized = raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function normalizePricingType(value, fallback = "per_event") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === "per_item" || raw === "per_person" || raw === "per_event") {
    return raw;
  }
  return fallback;
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let projectId = "";
  let organizationId = "";
  let dryRun = false;
  let evidenceOut = "";

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    if (!token) continue;
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--project") {
      projectId = String(args[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--evidence-out") {
      evidenceOut = String(args[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token.startsWith("--evidence-out=")) {
      evidenceOut = String(token.slice("--evidence-out=".length) || "").trim();
      continue;
    }
    if (token === "--organization" || token === "--org") {
      organizationId = slugify(args[i + 1], "default-org");
      i += 1;
    }
  }

  return {
    projectId:
      projectId ||
      String(process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "").trim(),
    organizationId: organizationId || slugify(process.env.FIREBASE_ORGANIZATION_ID || "default-org", "default-org"),
    dryRun,
    evidenceOut
  };
}

function toInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildEvidencePayload({
  projectId,
  organizationId,
  dryRun,
  timestamp,
  orgSummary,
  eventTypes,
  menuCategories,
  menuItems,
  catalogPackages,
  catalogAddons,
  catalogRentals,
  quotes,
  settings,
  versions,
  portal
}) {
  const collections = {
    organizations: {
      source: 0,
      created: toInt(orgSummary.created),
      patched: 0,
      skipped: 0,
      wouldCreate: toInt(orgSummary.wouldCreate),
      wouldPatch: 0
    },
    eventTypes: {
      source: toInt(eventTypes.source),
      created: toInt(eventTypes.created),
      patched: toInt(eventTypes.patched),
      skipped: 0,
      wouldCreate: toInt(eventTypes.wouldCreate),
      wouldPatch: toInt(eventTypes.wouldPatch)
    },
    menuCategories: {
      source: toInt(menuCategories.source),
      created: toInt(menuCategories.created),
      patched: toInt(menuCategories.patched),
      skipped: 0,
      wouldCreate: toInt(menuCategories.wouldCreate),
      wouldPatch: toInt(menuCategories.wouldPatch)
    },
    menuItems: {
      source: toInt(menuItems.source),
      created: toInt(menuItems.created),
      patched: toInt(menuItems.patched),
      skipped: 0,
      wouldCreate: toInt(menuItems.wouldCreate),
      wouldPatch: toInt(menuItems.wouldPatch)
    },
    catalogPackages: {
      source: toInt(catalogPackages.source),
      created: toInt(catalogPackages.created),
      patched: toInt(catalogPackages.patched),
      skipped: 0,
      wouldCreate: toInt(catalogPackages.wouldCreate),
      wouldPatch: toInt(catalogPackages.wouldPatch)
    },
    catalogAddons: {
      source: toInt(catalogAddons.source),
      created: toInt(catalogAddons.created),
      patched: toInt(catalogAddons.patched),
      skipped: 0,
      wouldCreate: toInt(catalogAddons.wouldCreate),
      wouldPatch: toInt(catalogAddons.wouldPatch)
    },
    catalogRentals: {
      source: toInt(catalogRentals.source),
      created: toInt(catalogRentals.created),
      patched: toInt(catalogRentals.patched),
      skipped: 0,
      wouldCreate: toInt(catalogRentals.wouldCreate),
      wouldPatch: toInt(catalogRentals.wouldPatch)
    },
    quotes: {
      source: toInt(quotes.source),
      created: toInt(quotes.created),
      patched: toInt(quotes.patched),
      skipped: 0,
      wouldCreate: toInt(quotes.wouldCreate),
      wouldPatch: toInt(quotes.wouldPatch)
    },
    settingsConfig: {
      source: toInt(settings.source),
      created: toInt(settings.created),
      patched: toInt(settings.patched),
      skipped: 0,
      wouldCreate: toInt(settings.wouldCreate),
      wouldPatch: toInt(settings.wouldPatch)
    },
    quoteVersions: {
      source: toInt(versions.source),
      created: toInt(versions.created),
      patched: 0,
      skipped: toInt(versions.skipped),
      wouldCreate: toInt(versions.wouldCreate),
      wouldPatch: 0
    },
    customerPortalQuotes: {
      source: toInt(portal.source),
      created: 0,
      patched: toInt(portal.patched),
      skipped: 0,
      wouldCreate: 0,
      wouldPatch: toInt(portal.wouldPatch)
    }
  };

  const totals = Object.values(collections).reduce(
    (acc, entry) => ({
      source: acc.source + toInt(entry.source),
      created: acc.created + toInt(entry.created),
      patched: acc.patched + toInt(entry.patched),
      skipped: acc.skipped + toInt(entry.skipped),
      wouldCreate: acc.wouldCreate + toInt(entry.wouldCreate),
      wouldPatch: acc.wouldPatch + toInt(entry.wouldPatch)
    }),
    { source: 0, created: 0, patched: 0, skipped: 0, wouldCreate: 0, wouldPatch: 0 }
  );

  return {
    projectId: projectId || "",
    organizationId,
    dryRun,
    timestamp,
    collections,
    totals
  };
}

async function writeEvidenceFile(outputPath, payload) {
  if (!outputPath) return "";
  const resolvedPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return resolvedPath;
}

function chunk(values, size = MAX_BATCH_WRITES) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

async function getSnapshotsByRefs(db, refs = []) {
  if (!refs.length) return [];
  const snapshots = [];
  const chunks = chunk(refs, MAX_BATCH_WRITES);
  for (const nextRefs of chunks) {
    const docs = await db.getAll(...nextRefs);
    snapshots.push(...docs);
  }
  return snapshots;
}

async function commitSetEntries(db, entries = [], { merge = false, dryRun = false } = {}) {
  if (!entries.length || dryRun) return 0;
  let count = 0;
  const chunks = chunk(entries, MAX_BATCH_WRITES);
  for (const nextEntries of chunks) {
    const batch = db.batch();
    nextEntries.forEach((entry) => {
      batch.set(entry.ref, entry.data, { merge });
    });
    await batch.commit();
    count += nextEntries.length;
  }
  return count;
}

async function migrateCollectionToOrg({
  db,
  sourcePath,
  targetPath,
  dryRun = false,
  transform = (data) => data,
  patchExisting = () => ({})
}) {
  const sourceSnap = await db.collection(sourcePath).get();
  const sourceDocs = sourceSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: transform(docSnap.data() || {}, docSnap.id)
  }));

  if (!sourceDocs.length) {
    return { source: 0, created: 0, patched: 0, wouldCreate: 0, wouldPatch: 0 };
  }

  const targetRefs = sourceDocs.map((entry) => db.collection(targetPath).doc(entry.id));
  const targetSnaps = await getSnapshotsByRefs(db, targetRefs);

  const createEntries = [];
  const patchEntries = [];

  targetSnaps.forEach((targetSnap, index) => {
    const sourceEntry = sourceDocs[index];
    if (!targetSnap.exists) {
      createEntries.push({
        ref: targetRefs[index],
        data: sourceEntry.data
      });
      return;
    }

    const patch = patchExisting(targetSnap.data() || {}, sourceEntry.data, sourceEntry.id);
    if (!patch || !Object.keys(patch).length) return;
    patchEntries.push({
      ref: targetRefs[index],
      data: patch
    });
  });

  const created = await commitSetEntries(db, createEntries, { merge: false, dryRun });
  const patched = await commitSetEntries(db, patchEntries, { merge: true, dryRun });

  return {
    source: sourceDocs.length,
    created,
    patched,
    wouldCreate: dryRun ? createEntries.length : 0,
    wouldPatch: dryRun ? patchEntries.length : 0
  };
}

async function migrateSettingsDoc({ db, organizationId, dryRun = false }) {
  const sourceRef = db.doc("pricing/settings");
  const targetRef = db.doc(`organizations/${organizationId}/settings/config`);
  const [sourceSnap, targetSnap] = await Promise.all([sourceRef.get(), targetRef.get()]);

  if (!sourceSnap.exists) {
    return { source: 0, created: 0, patched: 0, wouldCreate: 0, wouldPatch: 0 };
  }

  if (!targetSnap.exists) {
    const payload = {
      ...sourceSnap.data(),
      migratedAtISO: new Date().toISOString(),
      source: "legacy-global-migration"
    };
    if (!dryRun) {
      await targetRef.set(payload);
    }
    return { source: 1, created: dryRun ? 0 : 1, patched: 0, wouldCreate: dryRun ? 1 : 0, wouldPatch: 0 };
  }

  return { source: 1, created: 0, patched: 0, wouldCreate: 0, wouldPatch: 0 };
}

async function migrateQuoteHistoryToNestedVersions({ db, organizationId, dryRun = false }) {
  const sourceSnap = await db.collection("quoteHistory").get();
  if (!sourceSnap.docs.length) {
    return { source: 0, skipped: 0, created: 0, wouldCreate: 0 };
  }

  const entries = [];
  let skipped = 0;
  sourceSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const quoteId = String(data.quoteId || "").trim();
    if (!quoteId) {
      skipped += 1;
      return;
    }
    entries.push({
      ref: db.doc(`organizations/${organizationId}/quotes/${quoteId}/versions/${docSnap.id}`),
      data: {
        ...data,
        quoteId,
        organizationId
      }
    });
  });

  const existingSnaps = await getSnapshotsByRefs(
    db,
    entries.map((entry) => entry.ref)
  );
  const createEntries = [];
  existingSnaps.forEach((snapshot, index) => {
    if (!snapshot.exists) {
      createEntries.push(entries[index]);
    }
  });

  const created = await commitSetEntries(db, createEntries, { merge: false, dryRun });
  return {
    source: sourceSnap.docs.length,
    skipped,
    created,
    wouldCreate: dryRun ? createEntries.length : 0
  };
}

async function backfillPortalOrgIds({ db, organizationId, dryRun = false }) {
  const snap = await db.collection("customerPortalQuotes").get();
  if (!snap.docs.length) {
    return { source: 0, patched: 0, wouldPatch: 0 };
  }

  const nowISO = new Date().toISOString();
  const patchEntries = [];
  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const currentOrg = String(data.organizationId || "").trim();
    if (currentOrg) return;
    patchEntries.push({
      ref: docSnap.ref,
      data: {
        organizationId,
        updatedAtISO: nowISO
      }
    });
  });

  const patched = await commitSetEntries(db, patchEntries, { merge: true, dryRun });
  return {
    source: snap.docs.length,
    patched,
    wouldPatch: dryRun ? patchEntries.length : 0
  };
}

async function ensureOrgDoc({ db, organizationId, dryRun = false }) {
  const orgRef = db.doc(`organizations/${organizationId}`);
  const orgSnap = await orgRef.get();
  if (orgSnap.exists) {
    return { created: 0, wouldCreate: 0 };
  }
  if (dryRun) {
    return { created: 0, wouldCreate: 1 };
  }
  await orgRef.set({
    name: "Default Organization",
    slug: organizationId,
    createdAtISO: new Date().toISOString(),
    updatedAtISO: new Date().toISOString(),
    source: "legacy-global-migration"
  }, { merge: true });
  return { created: 1, wouldCreate: 0 };
}

async function main() {
  const { projectId, organizationId, dryRun, evidenceOut } = parseArgs(process.argv.slice(2));

  if (!admin.apps.length) {
    admin.initializeApp(projectId ? { projectId } : {});
  }

  const db = admin.firestore();
  const basePath = `organizations/${organizationId}`;

  const orgSummary = await ensureOrgDoc({ db, organizationId, dryRun });

  const [eventTypes, menuCategories, menuItems, catalogPackages, catalogAddons, catalogRentals, quotes, settings, versions, portal] = await Promise.all([
    migrateCollectionToOrg({
      db,
      sourcePath: "eventTypes",
      targetPath: `${basePath}/eventTypes`,
      dryRun
    }),
    migrateCollectionToOrg({
      db,
      sourcePath: "menuCategories",
      targetPath: `${basePath}/menuCategories`,
      dryRun
    }),
    migrateCollectionToOrg({
      db,
      sourcePath: "menuItems",
      targetPath: `${basePath}/menuItems`,
      dryRun,
      transform: (data) => {
        const pricingType = normalizePricingType(data.pricingType || data.type || "per_event", "per_event");
        return {
          ...data,
          pricingType,
          type: pricingType,
          active: data.active !== false
        };
      },
      patchExisting: (targetData, sourceData) => {
        const patch = {};
        if (targetData.pricingType !== sourceData.pricingType) patch.pricingType = sourceData.pricingType;
        if (targetData.type !== sourceData.type) patch.type = sourceData.type;
        if (typeof targetData.active !== "boolean") patch.active = sourceData.active;
        return patch;
      }
    }),
    migrateCollectionToOrg({
      db,
      sourcePath: "catalogPackages",
      targetPath: `${basePath}/catalogPackages`,
      dryRun
    }),
    migrateCollectionToOrg({
      db,
      sourcePath: "catalogAddons",
      targetPath: `${basePath}/catalogAddons`,
      dryRun,
      transform: (data) => {
        const pricingType = normalizePricingType(data.pricingType || data.type || "per_person", "per_person");
        return {
          ...data,
          pricingType,
          type: pricingType,
          active: data.active !== false
        };
      },
      patchExisting: (targetData, sourceData) => {
        const patch = {};
        if (targetData.pricingType !== sourceData.pricingType) patch.pricingType = sourceData.pricingType;
        if (targetData.type !== sourceData.type) patch.type = sourceData.type;
        if (typeof targetData.active !== "boolean") patch.active = sourceData.active;
        return patch;
      }
    }),
    migrateCollectionToOrg({
      db,
      sourcePath: "catalogRentals",
      targetPath: `${basePath}/catalogRentals`,
      dryRun,
      transform: (data) => {
        const pricingType = normalizePricingType(data.pricingType || data.type || "per_item", "per_item");
        return {
          ...data,
          pricingType,
          type: pricingType,
          active: data.active !== false
        };
      },
      patchExisting: (targetData, sourceData) => {
        const patch = {};
        if (targetData.pricingType !== sourceData.pricingType) patch.pricingType = sourceData.pricingType;
        if (targetData.type !== sourceData.type) patch.type = sourceData.type;
        if (typeof targetData.active !== "boolean") patch.active = sourceData.active;
        return patch;
      }
    }),
    migrateCollectionToOrg({
      db,
      sourcePath: "quotes",
      targetPath: `${basePath}/quotes`,
      dryRun,
      transform: (data) => ({
        ...data,
        organizationId: String(data.organizationId || "").trim() || organizationId
      }),
      patchExisting: (targetData) => {
        if (String(targetData.organizationId || "").trim()) return {};
        return { organizationId };
      }
    }),
    migrateSettingsDoc({ db, organizationId, dryRun }),
    migrateQuoteHistoryToNestedVersions({ db, organizationId, dryRun }),
    backfillPortalOrgIds({ db, organizationId, dryRun })
  ]);

  const evidence = buildEvidencePayload({
    projectId,
    organizationId,
    dryRun,
    timestamp: new Date().toISOString(),
    orgSummary,
    eventTypes,
    menuCategories,
    menuItems,
    catalogPackages,
    catalogAddons,
    catalogRentals,
    quotes,
    settings,
    versions,
    portal
  });

  let evidencePath = "";
  if (evidenceOut) {
    evidencePath = await writeEvidenceFile(evidenceOut, evidence);
  }

  const label = dryRun ? "Dry run completed." : "Migration completed.";
  console.log(label);
  console.log(`Project: ${projectId || "(auto-detected)"}`);
  console.log(`Organization: ${organizationId}`);
  console.log(`organizations/{orgId} -> created:${orgSummary.created}${dryRun ? ` wouldCreate:${orgSummary.wouldCreate}` : ""}`);
  console.log(
    `eventTypes -> source:${eventTypes.source} created:${eventTypes.created} patched:${eventTypes.patched}`
    + (dryRun ? ` wouldCreate:${eventTypes.wouldCreate} wouldPatch:${eventTypes.wouldPatch}` : "")
  );
  console.log(
    `menuCategories -> source:${menuCategories.source} created:${menuCategories.created} patched:${menuCategories.patched}`
    + (dryRun ? ` wouldCreate:${menuCategories.wouldCreate} wouldPatch:${menuCategories.wouldPatch}` : "")
  );
  console.log(
    `menuItems -> source:${menuItems.source} created:${menuItems.created} patched:${menuItems.patched}`
    + (dryRun ? ` wouldCreate:${menuItems.wouldCreate} wouldPatch:${menuItems.wouldPatch}` : "")
  );
  console.log(
    `catalogPackages -> source:${catalogPackages.source} created:${catalogPackages.created} patched:${catalogPackages.patched}`
    + (dryRun ? ` wouldCreate:${catalogPackages.wouldCreate} wouldPatch:${catalogPackages.wouldPatch}` : "")
  );
  console.log(
    `catalogAddons -> source:${catalogAddons.source} created:${catalogAddons.created} patched:${catalogAddons.patched}`
    + (dryRun ? ` wouldCreate:${catalogAddons.wouldCreate} wouldPatch:${catalogAddons.wouldPatch}` : "")
  );
  console.log(
    `catalogRentals -> source:${catalogRentals.source} created:${catalogRentals.created} patched:${catalogRentals.patched}`
    + (dryRun ? ` wouldCreate:${catalogRentals.wouldCreate} wouldPatch:${catalogRentals.wouldPatch}` : "")
  );
  console.log(
    `quotes -> source:${quotes.source} created:${quotes.created} patched:${quotes.patched}`
    + (dryRun ? ` wouldCreate:${quotes.wouldCreate} wouldPatch:${quotes.wouldPatch}` : "")
  );
  console.log(
    `settings/config -> source:${settings.source} created:${settings.created} patched:${settings.patched}`
    + (dryRun ? ` wouldCreate:${settings.wouldCreate} wouldPatch:${settings.wouldPatch}` : "")
  );
  console.log(
    `quote versions -> source:${versions.source} created:${versions.created} skipped:${versions.skipped}`
    + (dryRun ? ` wouldCreate:${versions.wouldCreate}` : "")
  );
  console.log(
    `customerPortalQuotes org backfill -> source:${portal.source} patched:${portal.patched}`
    + (dryRun ? ` wouldPatch:${portal.wouldPatch}` : "")
  );
  if (evidencePath) {
    console.log(`Evidence JSON written to: ${evidencePath}`);
  }
}

main().catch((error) => {
  console.error("Multi-tenant migration failed:", error?.message || error);
  process.exitCode = 1;
});
