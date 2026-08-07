#!/usr/bin/env node

import process from "node:process";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

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
  if (!emulatorHost || !projectId.startsWith("demo-") || !organizationId) {
    throw new Error(
      "Blank E2E catalog seeding is restricted to an active Firestore emulator and an explicit demo project."
    );
  }

  const admin = loadFirebaseAdmin();
  if (!admin.getApps().length) admin.initializeApp({ projectId });
  const db = admin.getFirestore();
  const nowISO = new Date().toISOString();
  await db.doc(`organizations/${organizationId}/settings/config`).set({
    brandName: "E2E Blank Owner",
    catalogRevision: 0,
    pricingSetupConfirmed: false,
    pricingConfirmation: null,
    source: "e2e-blank-owner",
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    updatedAt: admin.FieldValue.serverTimestamp()
  });
  console.log(`Seeded blank emulator catalog for ${organizationId}.`);
}

main().catch((error) => {
  console.error("Blank E2E catalog seed failed:", error?.message || error);
  process.exitCode = 1;
});
