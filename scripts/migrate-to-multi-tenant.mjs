#!/usr/bin/env node

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fsSync from "node:fs";
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

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || String(fallback || "").trim();
}

function truncateErrorBody(text, max = 220) {
  const raw = String(text || "").trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}...`;
}

function readFirebaseCliAccessToken() {
  try {
    execFileSync(
      "npx",
      ["--yes", "firebase-tools", "projects:list", "--json"],
      { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] }
    );
  } catch {
    // Ignore refresh errors and fall back to the cached configstore token.
  }

  try {
    const configPath = path.join(process.env.HOME || "", ".config", "configstore", "firebase-tools.json");
    const raw = fsSync.readFileSync(configPath, "utf8");
    const json = JSON.parse(raw);
    return normalizeText(json?.tokens?.access_token);
  } catch {
    return "";
  }
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toFirestoreValue(item))
      }
    };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { doubleValue: 0 };
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (isPlainObject(value)) {
    return {
      mapValue: {
        fields: toFirestoreFields(value)
      }
    };
  }
  return { stringValue: String(value ?? "") };
}

function toFirestoreFields(obj) {
  return Object.entries(obj || {}).reduce((acc, [key, value]) => {
    if (value === undefined) return acc;
    acc[key] = toFirestoreValue(value);
    return acc;
  }, {});
}

function collectFieldPaths(value, prefix = "", out = []) {
  if (value === undefined) return out;
  if (!isPlainObject(value)) {
    if (prefix) out.push(prefix);
    return out;
  }
  const keys = Object.keys(value);
  if (!keys.length) {
    if (prefix) out.push(prefix);
    return out;
  }
  keys.forEach((key) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const nextValue = value[key];
    if (isPlainObject(nextValue)) {
      collectFieldPaths(nextValue, nextPrefix, out);
      return;
    }
    out.push(nextPrefix);
  });
  return out;
}

function fromFirestoreFields(fields = {}) {
  return Object.entries(fields).reduce((acc, [key, value]) => {
    acc[key] = fromFirestoreValue(value);
    return acc;
  }, {});
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return String(value.stringValue || "");
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue || 0);
  if ("doubleValue" in value) return Number(value.doubleValue || 0);
  if ("timestampValue" in value) return String(value.timestampValue || "");
  if ("mapValue" in value) return fromFirestoreFields(value.mapValue?.fields || {});
  if ("arrayValue" in value) {
    const values = Array.isArray(value.arrayValue?.values) ? value.arrayValue.values : [];
    return values.map((entry) => fromFirestoreValue(entry));
  }
  return null;
}

async function firestoreRestGetDocument({
  projectId = "",
  documentPath = "",
  accessToken = ""
} = {}) {
  const normalizedProjectId = normalizeText(projectId);
  const normalizedDocPath = normalizeText(documentPath).replace(/^\/+/, "");
  if (!normalizedProjectId || !normalizedDocPath || !accessToken) {
    throw new Error("projectId, documentPath, and accessToken are required for Firestore REST reads.");
  }

  const url = `https://firestore.googleapis.com/v1/projects/${normalizedProjectId}/databases/(default)/documents/${normalizedDocPath}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const errorText = truncateErrorBody(await response.text());
    throw new Error(`Firestore REST read failed (${response.status}) for ${normalizedDocPath}: ${errorText}`);
  }

  const payload = await response.json();
  return {
    id: String(payload?.name || "").split("/").pop() || "",
    data: fromFirestoreFields(payload?.fields || {})
  };
}

async function firestoreRestListDocuments({
  projectId = "",
  collectionPath = "",
  accessToken = ""
} = {}) {
  const normalizedProjectId = normalizeText(projectId);
  const normalizedCollectionPath = normalizeText(collectionPath).replace(/^\/+/, "");
  if (!normalizedProjectId || !normalizedCollectionPath || !accessToken) {
    throw new Error("projectId, collectionPath, and accessToken are required for Firestore REST reads.");
  }

  const output = [];
  let nextPageToken = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "200");
    if (nextPageToken) {
      params.set("pageToken", nextPageToken);
    }

    const url = `https://firestore.googleapis.com/v1/projects/${normalizedProjectId}/databases/(default)/documents/${normalizedCollectionPath}?${params.toString()}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (response.status === 404) {
      return [];
    }
    if (!response.ok) {
      const errorText = truncateErrorBody(await response.text());
      throw new Error(`Firestore REST read failed (${response.status}) for ${normalizedCollectionPath}: ${errorText}`);
    }

    const payload = await response.json();
    const docs = Array.isArray(payload?.documents) ? payload.documents : [];
    docs.forEach((doc) => {
      output.push({
        id: String(doc?.name || "").split("/").pop() || "",
        data: fromFirestoreFields(doc?.fields || {})
      });
    });

    nextPageToken = String(payload?.nextPageToken || "").trim();
  } while (nextPageToken);

  return output;
}

async function firestoreRestPatchDocument({
  projectId = "",
  documentPath = "",
  data = {},
  accessToken = ""
} = {}) {
  const normalizedProjectId = normalizeText(projectId);
  const normalizedDocPath = normalizeText(documentPath).replace(/^\/+/, "");
  if (!normalizedProjectId || !normalizedDocPath || !accessToken) {
    throw new Error("projectId, documentPath, and accessToken are required for Firestore REST writes.");
  }

  const documentName = `projects/${normalizedProjectId}/databases/(default)/documents/${normalizedDocPath}`;
  const updateMask = collectFieldPaths(data);
  const params = new URLSearchParams();
  updateMask.forEach((fieldPath) => {
    params.append("updateMask.fieldPaths", fieldPath);
  });
  const url = `https://firestore.googleapis.com/v1/${documentName}?${params.toString()}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: documentName,
      fields: toFirestoreFields(data)
    })
  });

  if (!response.ok) {
    const errorText = truncateErrorBody(await response.text());
    throw new Error(`Firestore REST write failed (${response.status}) for ${normalizedDocPath}: ${errorText}`);
  }
}

async function commitPatchEntriesViaRest({
  projectId,
  accessToken,
  entries = [],
  dryRun = false
} = {}) {
  if (!entries.length || dryRun) return 0;
  let count = 0;
  const groups = chunk(entries, 25);
  for (const group of groups) {
    await Promise.all(
      group.map((entry) =>
        firestoreRestPatchDocument({
          projectId,
          accessToken,
          documentPath: entry.documentPath,
          data: entry.data
        })
      )
    );
    count += group.length;
  }
  return count;
}

async function ensureOrgDocViaRest({
  projectId,
  organizationId,
  accessToken,
  dryRun = false
}) {
  const existing = await firestoreRestGetDocument({
    projectId,
    documentPath: `organizations/${organizationId}`,
    accessToken
  });
  if (existing) {
    return { created: 0, wouldCreate: 0 };
  }

  if (!dryRun) {
    await firestoreRestPatchDocument({
      projectId,
      documentPath: `organizations/${organizationId}`,
      accessToken,
      data: {
        name: "Default Organization",
        slug: organizationId,
        createdAtISO: new Date().toISOString(),
        updatedAtISO: new Date().toISOString(),
        source: "legacy-global-migration"
      }
    });
  }

  return {
    created: dryRun ? 0 : 1,
    wouldCreate: dryRun ? 1 : 0
  };
}

async function migrateCollectionToOrgViaRest({
  projectId,
  sourcePath,
  targetPath,
  accessToken,
  dryRun = false,
  transform = (data) => data,
  patchExisting = () => ({})
}) {
  const [sourceDocs, targetDocs] = await Promise.all([
    firestoreRestListDocuments({ projectId, collectionPath: sourcePath, accessToken }),
    firestoreRestListDocuments({ projectId, collectionPath: targetPath, accessToken })
  ]);

  const targetMap = targetDocs.reduce((acc, entry) => {
    acc.set(entry.id, entry.data || {});
    return acc;
  }, new Map());

  const createEntries = [];
  const patchEntries = [];
  sourceDocs.forEach((entry) => {
    const sourceData = transform(entry.data || {}, entry.id);
    const current = targetMap.get(entry.id);
    if (!current) {
      createEntries.push({
        documentPath: `${targetPath}/${entry.id}`,
        data: sourceData
      });
      return;
    }
    const patch = patchExisting(current, sourceData, entry.id);
    if (!patch || !Object.keys(patch).length) return;
    patchEntries.push({
      documentPath: `${targetPath}/${entry.id}`,
      data: patch
    });
  });

  const created = await commitPatchEntriesViaRest({
    projectId,
    accessToken,
    entries: createEntries,
    dryRun
  });
  const patched = await commitPatchEntriesViaRest({
    projectId,
    accessToken,
    entries: patchEntries,
    dryRun
  });

  return {
    source: sourceDocs.length,
    created,
    patched,
    wouldCreate: dryRun ? createEntries.length : 0,
    wouldPatch: dryRun ? patchEntries.length : 0
  };
}

async function migrateSettingsDocViaRest({
  projectId,
  organizationId,
  accessToken,
  dryRun = false
}) {
  const [sourceDoc, targetDoc] = await Promise.all([
    firestoreRestGetDocument({
      projectId,
      documentPath: "pricing/settings",
      accessToken
    }),
    firestoreRestGetDocument({
      projectId,
      documentPath: `organizations/${organizationId}/settings/config`,
      accessToken
    })
  ]);

  if (!sourceDoc) {
    return { source: 0, created: 0, patched: 0, wouldCreate: 0, wouldPatch: 0 };
  }
  if (targetDoc) {
    return { source: 1, created: 0, patched: 0, wouldCreate: 0, wouldPatch: 0 };
  }

  const payload = {
    ...(sourceDoc.data || {}),
    migratedAtISO: new Date().toISOString(),
    source: "legacy-global-migration"
  };
  if (!dryRun) {
    await firestoreRestPatchDocument({
      projectId,
      documentPath: `organizations/${organizationId}/settings/config`,
      accessToken,
      data: payload
    });
  }

  return {
    source: 1,
    created: dryRun ? 0 : 1,
    patched: 0,
    wouldCreate: dryRun ? 1 : 0,
    wouldPatch: 0
  };
}

async function migrateQuoteHistoryToNestedVersionsViaRest({
  projectId,
  organizationId,
  accessToken,
  dryRun = false
}) {
  const sourceDocs = await firestoreRestListDocuments({
    projectId,
    collectionPath: "quoteHistory",
    accessToken
  });

  if (!sourceDocs.length) {
    return { source: 0, skipped: 0, created: 0, wouldCreate: 0 };
  }

  const createEntries = [];
  let skipped = 0;
  for (const entry of sourceDocs) {
    const quoteId = String(entry?.data?.quoteId || "").trim();
    if (!quoteId) {
      skipped += 1;
      continue;
    }

    const targetPath = `organizations/${organizationId}/quotes/${quoteId}/versions/${entry.id}`;
    const target = await firestoreRestGetDocument({
      projectId,
      documentPath: targetPath,
      accessToken
    });
    if (!target) {
      createEntries.push({
        documentPath: targetPath,
        data: {
          ...(entry.data || {}),
          quoteId,
          organizationId
        }
      });
    }
  }

  const created = await commitPatchEntriesViaRest({
    projectId,
    accessToken,
    entries: createEntries,
    dryRun
  });
  return {
    source: sourceDocs.length,
    skipped,
    created,
    wouldCreate: dryRun ? createEntries.length : 0
  };
}

async function backfillPortalOrgIdsViaRest({
  projectId,
  organizationId,
  accessToken,
  dryRun = false
}) {
  const sourceDocs = await firestoreRestListDocuments({
    projectId,
    collectionPath: "customerPortalQuotes",
    accessToken
  });

  if (!sourceDocs.length) {
    return { source: 0, patched: 0, wouldPatch: 0 };
  }

  const nowISO = new Date().toISOString();
  const patchEntries = sourceDocs.reduce((acc, entry) => {
    const currentOrg = String(entry?.data?.organizationId || "").trim();
    const rawExpiresMs = Number(entry?.data?.portalExpiresAtMs || 0);
    const hasExpiresMs = Number.isFinite(rawExpiresMs) && rawExpiresMs > 0;
    const computedExpiresMs = hasExpiresMs ? Math.round(rawExpiresMs) : parsePortalExpiresAtMs(entry?.data?.portalExpiresAtISO);
    const patch = {};
    if (!currentOrg) {
      patch.organizationId = organizationId;
    }
    if (!hasExpiresMs && computedExpiresMs > 0) {
      patch.portalExpiresAtMs = computedExpiresMs;
    }
    if (!Object.keys(patch).length) return acc;
    acc.push({
      documentPath: `customerPortalQuotes/${entry.id}`,
      data: {
        ...patch,
        updatedAtISO: nowISO
      }
    });
    return acc;
  }, []);

  const patched = await commitPatchEntriesViaRest({
    projectId,
    accessToken,
    entries: patchEntries,
    dryRun
  });
  return {
    source: sourceDocs.length,
    patched,
    wouldPatch: dryRun ? patchEntries.length : 0
  };
}

function isAdcMissingError(error) {
  return String(error?.message || "").toLowerCase().includes("could not load the default credentials");
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
    const rawExpiresMs = Number(data.portalExpiresAtMs || 0);
    const hasExpiresMs = Number.isFinite(rawExpiresMs) && rawExpiresMs > 0;
    const computedExpiresMs = hasExpiresMs ? Math.round(rawExpiresMs) : parsePortalExpiresAtMs(data.portalExpiresAtISO);
    const patch = {};
    if (!currentOrg) {
      patch.organizationId = organizationId;
    }
    if (!hasExpiresMs && computedExpiresMs > 0) {
      patch.portalExpiresAtMs = computedExpiresMs;
    }
    if (!Object.keys(patch).length) return;
    patchEntries.push({
      ref: docSnap.ref,
      data: {
        ...patch,
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

function normalizeCatalogEntry(data, fallbackType) {
  const pricingType = normalizePricingType(data.pricingType || data.type || fallbackType, fallbackType);
  return {
    ...data,
    pricingType,
    type: pricingType,
    active: data.active !== false
  };
}

function patchPricingTypeAndActive(targetData, sourceData) {
  const patch = {};
  if (targetData.pricingType !== sourceData.pricingType) patch.pricingType = sourceData.pricingType;
  if (targetData.type !== sourceData.type) patch.type = sourceData.type;
  if (typeof targetData.active !== "boolean") patch.active = sourceData.active;
  return patch;
}

function parsePortalExpiresAtMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

async function runMigrationWithAdmin({ db, organizationId, dryRun }) {
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
      transform: (data) => normalizeCatalogEntry(data, "per_event"),
      patchExisting: patchPricingTypeAndActive
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
      transform: (data) => normalizeCatalogEntry(data, "per_person"),
      patchExisting: patchPricingTypeAndActive
    }),
    migrateCollectionToOrg({
      db,
      sourcePath: "catalogRentals",
      targetPath: `${basePath}/catalogRentals`,
      dryRun,
      transform: (data) => normalizeCatalogEntry(data, "per_item"),
      patchExisting: patchPricingTypeAndActive
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

  return {
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
  };
}

async function runMigrationViaRest({ projectId, organizationId, dryRun = false }) {
  const accessToken = readFirebaseCliAccessToken();
  if (!accessToken) {
    throw new Error("Firebase CLI access token not found. Run `npx firebase-tools login` and retry.");
  }

  const basePath = `organizations/${organizationId}`;
  const [orgSummary, eventTypes, menuCategories, menuItems, catalogPackages, catalogAddons, catalogRentals, quotes, settings, versions, portal] = await Promise.all([
    ensureOrgDocViaRest({ projectId, organizationId, accessToken, dryRun }),
    migrateCollectionToOrgViaRest({
      projectId,
      sourcePath: "eventTypes",
      targetPath: `${basePath}/eventTypes`,
      accessToken,
      dryRun
    }),
    migrateCollectionToOrgViaRest({
      projectId,
      sourcePath: "menuCategories",
      targetPath: `${basePath}/menuCategories`,
      accessToken,
      dryRun
    }),
    migrateCollectionToOrgViaRest({
      projectId,
      sourcePath: "menuItems",
      targetPath: `${basePath}/menuItems`,
      accessToken,
      dryRun,
      transform: (data) => normalizeCatalogEntry(data, "per_event"),
      patchExisting: patchPricingTypeAndActive
    }),
    migrateCollectionToOrgViaRest({
      projectId,
      sourcePath: "catalogPackages",
      targetPath: `${basePath}/catalogPackages`,
      accessToken,
      dryRun
    }),
    migrateCollectionToOrgViaRest({
      projectId,
      sourcePath: "catalogAddons",
      targetPath: `${basePath}/catalogAddons`,
      accessToken,
      dryRun,
      transform: (data) => normalizeCatalogEntry(data, "per_person"),
      patchExisting: patchPricingTypeAndActive
    }),
    migrateCollectionToOrgViaRest({
      projectId,
      sourcePath: "catalogRentals",
      targetPath: `${basePath}/catalogRentals`,
      accessToken,
      dryRun,
      transform: (data) => normalizeCatalogEntry(data, "per_item"),
      patchExisting: patchPricingTypeAndActive
    }),
    migrateCollectionToOrgViaRest({
      projectId,
      sourcePath: "quotes",
      targetPath: `${basePath}/quotes`,
      accessToken,
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
    migrateSettingsDocViaRest({ projectId, organizationId, accessToken, dryRun }),
    migrateQuoteHistoryToNestedVersionsViaRest({ projectId, organizationId, accessToken, dryRun }),
    backfillPortalOrgIdsViaRest({ projectId, organizationId, accessToken, dryRun })
  ]);

  return {
    mode: dryRun ? "firestore-rest-dry-run" : "firestore-rest-apply",
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
  };
}

async function main() {
  const { projectId, organizationId, dryRun, evidenceOut } = parseArgs(process.argv.slice(2));

  let summary;
  let mode = "firebase-admin";
  try {
    if (!admin.apps.length) {
      admin.initializeApp(projectId ? { projectId } : {});
    }
    const db = admin.firestore();
    summary = await runMigrationWithAdmin({ db, organizationId, dryRun });
  } catch (error) {
    if (!isAdcMissingError(error)) {
      throw error;
    }
    if (!projectId) {
      throw new Error("Firestore REST fallback requires --project when ADC is unavailable.");
    }
    summary = await runMigrationViaRest({ projectId, organizationId, dryRun });
    mode = summary.mode || (dryRun ? "firestore-rest-dry-run" : "firestore-rest-apply");
  }

  const evidence = buildEvidencePayload({
    projectId,
    organizationId,
    dryRun,
    timestamp: new Date().toISOString(),
    orgSummary: summary.orgSummary,
    eventTypes: summary.eventTypes,
    menuCategories: summary.menuCategories,
    menuItems: summary.menuItems,
    catalogPackages: summary.catalogPackages,
    catalogAddons: summary.catalogAddons,
    catalogRentals: summary.catalogRentals,
    quotes: summary.quotes,
    settings: summary.settings,
    versions: summary.versions,
    portal: summary.portal
  });

  let evidencePath = "";
  if (evidenceOut) {
    evidencePath = await writeEvidenceFile(evidenceOut, evidence);
  }

  const label = dryRun ? "Dry run completed." : "Migration completed.";
  console.log(label);
  console.log(`Mode: ${mode}`);
  console.log(`Project: ${projectId || "(auto-detected)"}`);
  console.log(`Organization: ${organizationId}`);
  console.log(`organizations/{orgId} -> created:${summary.orgSummary.created}${dryRun ? ` wouldCreate:${summary.orgSummary.wouldCreate}` : ""}`);
  console.log(
    `eventTypes -> source:${summary.eventTypes.source} created:${summary.eventTypes.created} patched:${summary.eventTypes.patched}`
    + (dryRun ? ` wouldCreate:${summary.eventTypes.wouldCreate} wouldPatch:${summary.eventTypes.wouldPatch}` : "")
  );
  console.log(
    `menuCategories -> source:${summary.menuCategories.source} created:${summary.menuCategories.created} patched:${summary.menuCategories.patched}`
    + (dryRun ? ` wouldCreate:${summary.menuCategories.wouldCreate} wouldPatch:${summary.menuCategories.wouldPatch}` : "")
  );
  console.log(
    `menuItems -> source:${summary.menuItems.source} created:${summary.menuItems.created} patched:${summary.menuItems.patched}`
    + (dryRun ? ` wouldCreate:${summary.menuItems.wouldCreate} wouldPatch:${summary.menuItems.wouldPatch}` : "")
  );
  console.log(
    `catalogPackages -> source:${summary.catalogPackages.source} created:${summary.catalogPackages.created} patched:${summary.catalogPackages.patched}`
    + (dryRun ? ` wouldCreate:${summary.catalogPackages.wouldCreate} wouldPatch:${summary.catalogPackages.wouldPatch}` : "")
  );
  console.log(
    `catalogAddons -> source:${summary.catalogAddons.source} created:${summary.catalogAddons.created} patched:${summary.catalogAddons.patched}`
    + (dryRun ? ` wouldCreate:${summary.catalogAddons.wouldCreate} wouldPatch:${summary.catalogAddons.wouldPatch}` : "")
  );
  console.log(
    `catalogRentals -> source:${summary.catalogRentals.source} created:${summary.catalogRentals.created} patched:${summary.catalogRentals.patched}`
    + (dryRun ? ` wouldCreate:${summary.catalogRentals.wouldCreate} wouldPatch:${summary.catalogRentals.wouldPatch}` : "")
  );
  console.log(
    `quotes -> source:${summary.quotes.source} created:${summary.quotes.created} patched:${summary.quotes.patched}`
    + (dryRun ? ` wouldCreate:${summary.quotes.wouldCreate} wouldPatch:${summary.quotes.wouldPatch}` : "")
  );
  console.log(
    `settings/config -> source:${summary.settings.source} created:${summary.settings.created} patched:${summary.settings.patched}`
    + (dryRun ? ` wouldCreate:${summary.settings.wouldCreate} wouldPatch:${summary.settings.wouldPatch}` : "")
  );
  console.log(
    `quote versions -> source:${summary.versions.source} created:${summary.versions.created} skipped:${summary.versions.skipped}`
    + (dryRun ? ` wouldCreate:${summary.versions.wouldCreate}` : "")
  );
  console.log(
    `customerPortalQuotes org backfill -> source:${summary.portal.source} patched:${summary.portal.patched}`
    + (dryRun ? ` wouldPatch:${summary.portal.wouldPatch}` : "")
  );
  if (evidencePath) {
    console.log(`Evidence JSON written to: ${evidencePath}`);
  }
}

main().catch((error) => {
  console.error("Multi-tenant migration failed:", error?.message || error);
  if (error?.cause) {
    console.error("Cause:", error.cause?.message || error.cause);
  }
  if (error?.stack) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
