#!/usr/bin/env node

import process from "node:process";
import { createRequire } from "node:module";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

const require = createRequire(import.meta.url);
const { confirmCatalogPricing } = require("../functions/starterCatalogPacks.js");

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return String(process.argv[index + 1] || "").trim() || fallback;
}

function slugify(value, fallback = "") {
  const raw = String(value || fallback).trim().toLowerCase();
  return raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const emulatorHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
  const projectId = readArg("--project", process.env.E2E_FIREBASE_PROJECT_ID || "demo-e2e");
  const organizationId = slugify(
    readArg("--organization", process.env.E2E_FIREBASE_ORG_ID || "e2e-org")
  );
  const actorEmail = String(
    readArg("--email", process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test")
  ).trim().toLowerCase();
  if (!emulatorHost || !projectId.startsWith("demo-") || !organizationId || !actorEmail) {
    throw new Error(
      "E2E catalog confirmation is restricted to an active Firestore emulator and an explicit demo project."
    );
  }

  const admin = loadFirebaseAdmin();
  if (!admin.getApps().length) admin.initializeApp({ projectId });
  const db = admin.getFirestore();
  const settingsRef = db.doc(`organizations/${organizationId}/settings/config`);
  const settingsSnapshot = await settingsRef.get();
  if (!settingsSnapshot.exists) {
    throw new Error(`E2E organization ${organizationId} has no catalog settings.`);
  }
  const expectedCatalogRevision = Math.max(
    0,
    Number(settingsSnapshot.data()?.catalogRevision || 0)
  );
  const result = await confirmCatalogPricing({
    db,
    organizationId,
    expectedCatalogRevision,
    actorUid: "e2e-catalog-confirmation",
    actorEmail,
    serverTimestamp: admin.FieldValue.serverTimestamp,
    deleteField: admin.FieldValue.delete,
    nowISO: new Date().toISOString()
  });
  console.log(
    `Confirmed emulator catalog revision ${result.confirmedCatalogRevision} for ${organizationId}.`
  );
}

main().catch((error) => {
  console.error("E2E catalog confirmation failed:", error?.message || error);
  process.exitCode = 1;
});
