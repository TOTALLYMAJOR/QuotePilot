#!/usr/bin/env node

import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

function readArg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return String(process.argv[idx + 1] || "").trim() || fallback;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function slugify(value, fallback = "e2e-org") {
  const raw = String(value || fallback).trim().toLowerCase();
  const slug = raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

async function ensureUser({ auth, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  try {
    const existing = await auth.getUserByEmail(normalizedEmail);
    await auth.updateUser(existing.uid, { password, email: normalizedEmail, emailVerified: true });
    return existing.uid;
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }

  const created = await auth.createUser({
    email: normalizedEmail,
    password,
    emailVerified: true
  });
  return created.uid;
}

async function main() {
  const projectId = readArg("--project", process.env.E2E_FIREBASE_PROJECT_ID || "demo-e2e");
  const organizationId = slugify(readArg("--organization", process.env.E2E_FIREBASE_ORG_ID || "e2e-org"));
  const email = normalizeEmail(readArg("--email", process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test"));
  const password = readArg("--password", process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!");

  if (!email || !password) {
    throw new Error("email and password are required.");
  }

  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }

  const auth = admin.auth();
  const db = admin.firestore();
  const uid = await ensureUser({ auth, email, password });
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.doc(`organizations/${organizationId}`).set({
    name: "E2E Organization",
    slug: organizationId,
    ownerUid: uid,
    ownerEmail: email,
    active: true,
    archived: false,
    status: "active",
    updatedAt: now,
    updatedAtISO: new Date().toISOString(),
    createdAt: now
  }, { merge: true });

  await db.doc(`userRoles/${uid}`).set({
    role: "admin",
    organizationId,
    email,
    updatedAt: now,
    createdAt: now
  }, { merge: true });

  console.log(`Seeded e2e auth user: ${email} (${uid}) in org ${organizationId}`);
}

main().catch((error) => {
  console.error("E2E auth seed failed:", error?.message || error);
  process.exitCode = 1;
});
