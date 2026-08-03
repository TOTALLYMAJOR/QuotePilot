#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";
import {
  PORTAL_PROJECTION_VERSION,
  planPortalSnapshotBackfill,
  planPortalSnapshotBackfillBatch
} from "./portal-snapshot-backfill-plan.mjs";

function requiredValue(args, index, flag) {
  const value = String(args[index + 1] || "").trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function assertSafeScopeId(value, flag, maxLength) {
  if (
    value.length > maxLength
    || value.includes("/")
    || /[\s\x00-\x1f\x7f]/u.test(value)
    || value === "."
    || value === ".."
  ) {
    throw new Error(`${flag} must be a single Firestore-safe identifier without slashes or whitespace.`);
  }
}

export function parsePortalBackfillArgs(argv = []) {
  let projectId = "";
  let organizationId = "";
  let requestedMode = "";
  let confirmation = "";
  let evidenceOut = "";

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    if (!token) continue;
    if (token === "--dry-run" || token === "--apply") {
      const nextMode = token.slice(2);
      if (requestedMode && requestedMode !== nextMode) {
        throw new Error("Choose exactly one mode: --dry-run or --apply.");
      }
      requestedMode = nextMode;
      continue;
    }
    if (token === "--project") {
      projectId = requiredValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--organization") {
      organizationId = requiredValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--confirm") {
      confirmation = requiredValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--evidence-out") {
      evidenceOut = requiredValue(argv, index, token);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!projectId) throw new Error("Missing --project <projectId>.");
  if (!organizationId) throw new Error("Missing --organization <organizationId>.");
  assertSafeScopeId(projectId, "--project", 128);
  assertSafeScopeId(organizationId, "--organization", 128);

  const dryRun = requestedMode !== "apply";
  if (!dryRun) {
    const expected = `BACKFILL PORTALS ${projectId} ${organizationId}`;
    if (confirmation !== expected) {
      throw new Error(`Apply requires --confirm "${expected}".`);
    }
    if (!evidenceOut) {
      throw new Error("Apply requires --evidence-out <new-file> for an immutable result record.");
    }
  }

  return { projectId, organizationId, dryRun, confirmation, evidenceOut };
}

function isAdcMissingError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("default credentials")
    || message.includes("could not load the default credentials")
    || message.includes("metadata lookup warning")
    || message.includes("unauthenticated")
    || message.includes("credential")
  );
}

function readFirebaseCliAccessToken() {
  try {
    execFileSync("npx", ["--yes", "firebase-tools", "projects:list", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"]
    });
  } catch {
    // A cached CLI token can still be usable when refreshing the project list fails.
  }
  try {
    const configPath = path.join(process.env.HOME || "", ".config", "configstore", "firebase-tools.json");
    const payload = JSON.parse(fsSync.readFileSync(configPath, "utf8"));
    return String(payload?.tokens?.access_token || "").trim();
  } catch {
    return "";
  }
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

function fromFirestoreFields(fields = {}) {
  return Object.entries(fields).reduce((result, [key, value]) => {
    result[key] = fromFirestoreValue(value);
    return result;
  }, {});
}

async function listDocumentsViaRest({ projectId, collectionPath, accessToken }) {
  const output = [];
  let nextPageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: "200" });
    if (nextPageToken) params.set("pageToken", nextPageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionPath}?${params}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 404) return [];
    if (!response.ok) {
      const detail = String(await response.text()).trim().slice(0, 220);
      throw new Error(`Firestore REST read failed (${response.status}) for ${collectionPath}: ${detail}`);
    }
    const payload = await response.json();
    (Array.isArray(payload?.documents) ? payload.documents : []).forEach((document) => {
      output.push({
        id: String(document?.name || "").split("/").pop() || "",
        data: fromFirestoreFields(document?.fields || {})
      });
    });
    nextPageToken = String(payload?.nextPageToken || "").trim();
  } while (nextPageToken);
  return output;
}

async function collectWithAdmin({ db, organizationId }) {
  const [quotesSnapshot, portalsSnapshot] = await Promise.all([
    db.collection(`organizations/${organizationId}/quotes`).get(),
    db.collection("customerPortalQuotes").get()
  ]);
  return {
    quotes: quotesSnapshot.docs.map((snapshot) => ({ id: snapshot.id, data: snapshot.data() || {} })),
    portals: portalsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, data: snapshot.data() || {} }))
  };
}

async function collectViaRest({ projectId, organizationId }) {
  const accessToken = readFirebaseCliAccessToken();
  if (!accessToken) {
    throw new Error("Dry-run REST fallback requires an authenticated Firebase CLI session.");
  }
  const [quotes, portals] = await Promise.all([
    listDocumentsViaRest({
      projectId,
      collectionPath: `organizations/${organizationId}/quotes`,
      accessToken
    }),
    listDocumentsViaRest({ projectId, collectionPath: "customerPortalQuotes", accessToken })
  ]);
  return { quotes, portals };
}

async function applyWithTransactions({ db, entries, organizationId, nowISO }) {
  const counts = { patched: 0, alreadyCurrent: 0, conflicts: 0, concurrentChanges: 0 };
  for (const entry of entries) {
    const result = await db.runTransaction(async (transaction) => {
      const portalRef = db.doc(`customerPortalQuotes/${entry.portalId}`);
      const quoteRef = db.doc(`organizations/${organizationId}/quotes/${entry.quoteId}`);
      const [portalSnapshot, quoteSnapshot] = await Promise.all([
        transaction.get(portalRef),
        transaction.get(quoteRef)
      ]);
      if (!portalSnapshot.exists || !quoteSnapshot.exists) return "concurrent";
      const replanned = planPortalSnapshotBackfill({
        portalId: entry.portalId,
        portal: portalSnapshot.data() || {},
        quoteId: entry.quoteId,
        quote: quoteSnapshot.data() || {},
        organizationId,
        nowISO
      });
      if (replanned.state === "patch") {
        transaction.set(portalRef, replanned.patch, { merge: true });
        return "patched";
      }
      if (replanned.state === "already_current") return "already";
      if (replanned.state.startsWith("conflict_")) return "conflict";
      return "concurrent";
    });
    if (result === "patched") counts.patched += 1;
    else if (result === "already") counts.alreadyCurrent += 1;
    else if (result === "conflict") counts.conflicts += 1;
    else counts.concurrentChanges += 1;
  }
  return counts;
}

function publicSummary(summary, dryRun) {
  return {
    source: Number(summary.source || 0),
    matched: Number(summary.matched || 0),
    wouldPatch: dryRun ? Number(summary.wouldPatch || 0) : 0,
    patched: dryRun ? 0 : Number(summary.patched || 0),
    alreadyCurrent: Number(summary.alreadyCurrent || 0),
    skippedForeignOrganization: Number(summary.skippedForeignOrganization || 0),
    skippedNoQuote: Number(summary.skippedNoQuote || 0),
    skippedInactive: Number(summary.skippedInactive || 0),
    skippedInvalidIdentity: Number(summary.skippedInvalidIdentity || 0),
    skippedInvalidExpiry: Number(summary.skippedInvalidExpiry || 0),
    conflicts: Number(summary.conflicts || 0),
    concurrentChanges: Number(summary.concurrentChanges || 0)
  };
}

async function reserveEvidence(outputPath, initialPayload) {
  if (!outputPath) return null;
  const resolved = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  let handle;
  try {
    handle = await fs.open(resolved, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(initialPayload, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    return { path: resolved };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") {
      throw new Error(`Evidence output already exists: ${resolved}. Refusing to overwrite it.`);
    }
    throw error;
  }
}

async function completeEvidence(reservation, payload) {
  if (!reservation) return "";
  const temporaryPath = `${reservation.path}.complete-${process.pid}-${Date.now()}`;
  let handle;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, reservation.path);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return reservation.path;
}

export async function runPortalSnapshotBackfill(options) {
  const { projectId, organizationId, dryRun, evidenceOut } = options;
  const nowISO = new Date().toISOString();
  const reservation = await reserveEvidence(evidenceOut, {
    operation: "customer-portal-projection-backfill",
    projectionVersion: PORTAL_PROJECTION_VERSION,
    projectId,
    organizationId,
    dryRun,
    timestamp: nowISO,
    state: "started"
  });
  try {
    let admin;
    let db;
    let source;
    let mode = "firebase-admin";
    try {
      admin = loadFirebaseAdmin();
      if (!admin.getApps().length) admin.initializeApp({ projectId });
      db = admin.getFirestore();
      source = await collectWithAdmin({ db, organizationId });
    } catch (error) {
      if (!isAdcMissingError(error)) throw error;
      if (!dryRun) {
        throw new Error("Apply requires Firebase Application Default Credentials so every write can be transactionally revalidated.", { cause: error });
      }
      source = await collectViaRest({ projectId, organizationId });
      mode = "firestore-rest-dry-run";
    }

    const planned = planPortalSnapshotBackfillBatch({
      portals: source.portals,
      quotes: source.quotes,
      organizationId,
      nowISO
    });
    const summary = { ...planned.summary };
    if (!dryRun) {
      const applied = await applyWithTransactions({
        db,
        entries: planned.entries,
        organizationId,
        nowISO
      });
      summary.patched = applied.patched;
      summary.alreadyCurrent += applied.alreadyCurrent;
      summary.conflicts += applied.conflicts;
      summary.concurrentChanges += applied.concurrentChanges;
    }

    const safeSummary = publicSummary(summary, dryRun);
    const evidence = {
      operation: "customer-portal-projection-backfill",
      projectionVersion: PORTAL_PROJECTION_VERSION,
      projectId,
      organizationId,
      mode,
      dryRun,
      timestamp: nowISO,
      state: "completed",
      summary: safeSummary
    };
    const evidencePath = await completeEvidence(reservation, evidence);
    return { evidence, evidencePath };
  } catch (error) {
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parsePortalBackfillArgs(argv);
  const result = await runPortalSnapshotBackfill(options);
  console.log(options.dryRun ? "Portal snapshot dry run completed." : "Portal snapshot backfill completed.");
  console.log(`Mode: ${result.evidence.mode}`);
  console.log(`Project: ${result.evidence.projectId}`);
  console.log(`Organization: ${result.evidence.organizationId}`);
  console.log(`Summary: ${JSON.stringify(result.evidence.summary)}`);
  if (result.evidencePath) console.log(`Evidence JSON written to: ${result.evidencePath}`);
}

const isEntrypoint = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntrypoint) {
  main().catch((error) => {
    console.error("Portal snapshot backfill failed:", error?.message || error);
    process.exitCode = 1;
  });
}
