#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";
import { planLegacyCustomerIdBackfill } from "./customer-id-backfill-plan.mjs";

function requiredValue(args, index, flag) {
  const value = String(args[index + 1] || "").trim();
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function assertSafeId(value, flag) {
  if (!value || value.length > 128 || value.includes("/") || /[\s\x00-\x1f\x7f]/u.test(value)) {
    throw new Error(`${flag} must be a single Firestore-safe identifier.`);
  }
}

export function parseCustomerIdBackfillArgs(argv = []) {
  let projectId = "";
  let organizationId = "";
  let requestedMode = "";
  let confirmation = "";
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    if (!token) continue;
    if (token === "--apply" || token === "--dry-run") {
      const mode = token.slice(2);
      if (requestedMode && requestedMode !== mode) {
        throw new Error("Choose exactly one mode: --dry-run or --apply.");
      }
      requestedMode = mode;
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
    throw new Error(`Unknown argument: ${token}`);
  }
  assertSafeId(projectId, "--project");
  assertSafeId(organizationId, "--organization");
  const dryRun = requestedMode !== "apply";
  if (!dryRun) {
    const expected = `BACKFILL CUSTOMER IDS ${projectId} ${organizationId}`;
    if (confirmation !== expected) {
      throw new Error(`Apply requires --confirm "${expected}".`);
    }
  }
  return { projectId, organizationId, dryRun, confirmation };
}

export function assertEmulatorCustomerIdApply({
  projectId,
  organizationId,
  dryRun,
  confirmation = "",
  env = process.env
}) {
  if (dryRun) return;
  const emulatorHost = String(env.FIRESTORE_EMULATOR_HOST || "").trim();
  const hostname = emulatorHost.startsWith("[")
    ? emulatorHost.slice(1, emulatorHost.indexOf("]"))
    : emulatorHost.split(":")[0];
  if (!emulatorHost || !["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("Customer ID apply is emulator-only and requires a loopback FIRESTORE_EMULATOR_HOST.");
  }
  if (!String(projectId).startsWith("demo-")) {
    throw new Error("Customer ID emulator apply requires a demo-* Firebase project id.");
  }
  const expected = `BACKFILL CUSTOMER IDS ${projectId} ${organizationId}`;
  if (confirmation !== expected) {
    throw new Error(`Customer ID emulator apply requires exact confirmation: ${expected}`);
  }
}

async function collectScope(db, organizationId) {
  const [quoteSnapshot, customerSnapshot] = await Promise.all([
    db.collection(`organizations/${organizationId}/quotes`).get(),
    db.collection(`organizations/${organizationId}/customers`).get()
  ]);
  const quotes = quoteSnapshot.docs.map((snapshot) => ({ id: snapshot.id, data: snapshot.data() || {} }));
  const versionSnapshots = await Promise.all(quotes.map((quote) => (
    db.collection(`organizations/${organizationId}/quotes/${quote.id}/versions`).get()
  )));
  return {
    quotes,
    customers: customerSnapshot.docs.map((snapshot) => ({ id: snapshot.id, data: snapshot.data() || {} })),
    versions: versionSnapshots.flatMap((snapshot, quoteIndex) => (
      snapshot.docs.map((versionSnapshot) => ({
        id: versionSnapshot.id,
        quoteId: quotes[quoteIndex].id,
        data: versionSnapshot.data() || {}
      }))
    ))
  };
}

async function applyEntry({ db, organizationId, entry, nowISO }) {
  const quoteRef = db.doc(`organizations/${organizationId}/quotes/${entry.quoteId}`);
  const customersRef = db.collection(`organizations/${organizationId}/customers`);
  const versionsRef = quoteRef.collection("versions");
  return db.runTransaction(async (transaction) => {
    const [quoteSnapshot, customerSnapshot, versionSnapshot] = await Promise.all([
      transaction.get(quoteRef),
      transaction.get(customersRef),
      transaction.get(versionsRef)
    ]);
    if (!quoteSnapshot.exists) return "concurrent_change";
    const replanned = planLegacyCustomerIdBackfill({
      organizationId,
      nowISO,
      quotes: [{ id: quoteSnapshot.id, data: quoteSnapshot.data() || {} }],
      customers: customerSnapshot.docs.map((snapshot) => ({
        id: snapshot.id,
        data: snapshot.data() || {}
      })),
      versions: versionSnapshot.docs.map((snapshot) => ({
        id: snapshot.id,
        quoteId: quoteSnapshot.id,
        data: snapshot.data() || {}
      }))
    });
    if (replanned.summary.alreadyBound === 1) return "already_bound";
    const current = replanned.entries[0];
    if (!current || current.customerId !== entry.customerId) return "conflict";

    if (Object.keys(current.quotePatch).length) transaction.update(quoteRef, current.quotePatch);
    transaction.set(customersRef.doc(current.customerId), current.customerPatch, { merge: true });
    for (const versionPatch of current.versionPatches) {
      transaction.update(versionsRef.doc(versionPatch.versionId), versionPatch.patch);
    }
    return "bound";
  });
}

export async function runCustomerIdBackfill(options, { env = process.env } = {}) {
  const { projectId, organizationId, dryRun = true, confirmation = "" } = options;
  assertEmulatorCustomerIdApply({ projectId, organizationId, dryRun, confirmation, env });
  const admin = loadFirebaseAdmin();
  if (!admin.getApps().length) admin.initializeApp({ projectId });
  const db = admin.getFirestore();
  const nowISO = new Date().toISOString();
  const source = await collectScope(db, organizationId);
  const plan = planLegacyCustomerIdBackfill({ ...source, organizationId, nowISO });
  const applySummary = { bound: 0, alreadyBound: 0, conflicts: 0, concurrentChanges: 0 };
  if (!dryRun) {
    for (const entry of plan.entries) {
      const outcome = await applyEntry({ db, organizationId, entry, nowISO });
      if (outcome === "bound") applySummary.bound += 1;
      else if (outcome === "already_bound") applySummary.alreadyBound += 1;
      else if (outcome === "concurrent_change") applySummary.concurrentChanges += 1;
      else applySummary.conflicts += 1;
    }
  }
  return { dryRun, plan, applySummary };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCustomerIdBackfillArgs(argv);
  const result = await runCustomerIdBackfill(options);
  console.log(options.dryRun
    ? "Customer ID dry run completed; no writes were made."
    : "Customer ID emulator backfill completed.");
  console.log(`Project: ${options.projectId}`);
  console.log(`Organization: ${options.organizationId}`);
  console.log(`Plan summary: ${JSON.stringify(result.plan.summary)}`);
  if (result.plan.conflicts.length) {
    console.log(`Conflicts: ${JSON.stringify(result.plan.conflicts)}`);
  }
  if (!options.dryRun) console.log(`Apply summary: ${JSON.stringify(result.applySummary)}`);
}

const isEntrypoint = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntrypoint) {
  main().catch((error) => {
    console.error("Customer ID backfill failed:", error?.message || error);
    process.exitCode = 1;
  });
}
