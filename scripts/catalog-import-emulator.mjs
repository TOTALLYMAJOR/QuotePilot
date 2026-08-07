#!/usr/bin/env node

import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
  terminate
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable
} from "firebase/functions";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || "").trim();
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const functionsHost = String(process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5601").trim();

if (!projectId.startsWith("demo-") || !authHost || !firestoreHost || !functionsHost) {
  throw new Error("Catalog import verification is emulator-only.");
}

function parseAddress(value) {
  const normalized = String(value || "").replace(/^https?:\/\//, "");
  const separator = normalized.lastIndexOf(":");
  const host = normalized.slice(0, separator);
  const port = Number(normalized.slice(separator + 1));
  assert.ok(host && Number.isInteger(port) && port > 0, `Invalid emulator address: ${value}`);
  return { host, port };
}

function settingsRefFor(db, organizationId) {
  return db.collection("organizations").doc(organizationId)
    .collection("settings").doc("config");
}

async function expectCallableCode(action, expectedCode) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.code, `functions/${expectedCode}`);
    return true;
  });
}

const admin = loadFirebaseAdmin();
if (!admin.getApps().length) admin.initializeApp({ projectId });
const adminAuth = admin.getAuth();
const adminDb = admin.getFirestore();
const organizationId = "catalog-import-org";
const otherOrganizationId = "catalog-import-other-org";
const email = "catalog-import-owner@local.test";
const password = "Passw0rd!";

const user = await adminAuth.createUser({ email, password, emailVerified: true });
await Promise.all([
  adminDb.collection("organizations").doc(organizationId).set({
    name: "Catalog Import Organization",
    active: true,
    archived: false,
    status: "active"
  }),
  adminDb.collection("organizations").doc(otherOrganizationId).set({
    name: "Other Catalog Organization",
    active: true,
    archived: false,
    status: "active"
  }),
  adminDb.collection("userRoles").doc(user.uid).set({
    role: "admin",
    organizationId,
    email
  }),
  adminDb.collection("organizations").doc(organizationId)
    .collection("settings").doc("config").set({
      catalogRevision: 7,
      pricingSetupConfirmed: true,
      pricingConfirmation: {
        actorUid: user.uid,
        actorEmail: email,
        confirmedAtISO: "2026-08-06T12:00:00.000Z",
        confirmedCatalogRevision: 7
      }
    })
]);

const app = initializeApp({
  apiKey: "demo-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId
}, "catalog-import-emulator");
const clientAuth = getAuth(app);
const clientDb = getFirestore(app);
const clientFunctions = getFunctions(app, "us-central1");
const authAddress = parseAddress(authHost);
const firestoreAddress = parseAddress(firestoreHost);
const functionsAddress = parseAddress(functionsHost);
connectAuthEmulator(clientAuth, `http://${authAddress.host}:${authAddress.port}`, { disableWarnings: true });
connectFirestoreEmulator(clientDb, firestoreAddress.host, firestoreAddress.port);
connectFunctionsEmulator(clientFunctions, functionsAddress.host, functionsAddress.port);

const createCatalogImport = httpsCallable(clientFunctions, "createCatalogImportBatch");
const rollbackCatalogImport = httpsCallable(clientFunctions, "rollbackCatalogImportBatch");

try {
  await signInWithEmailAndPassword(clientAuth, email, password);

  await assert.rejects(() => setDoc(
    doc(clientDb, "organizations", organizationId, "importBatches", "browser_catalog_receipt_0001"),
    {
      organizationId,
      importBatchId: "browser_catalog_receipt_0001",
      importType: "packages",
      status: "completed"
    }
  ));

  const packageRequest = {
    organizationId,
    organizationName: "Catalog Import Organization",
    importType: "packages",
    fileName: "packages.csv",
    records: [{ rowNumber: 2, record: { name: "Emulator Celebration", ppp: 23.45 } }],
    importBatchId: "catalog_emulator_package_0001",
    expectedCatalogRevision: 7
  };
  const firstImport = (await createCatalogImport(packageRequest)).data;
  assert.equal(firstImport.catalogRevision, 8);
  assert.equal(firstImport.createdCount, 1);

  const importedPackageRef = adminDb.collection("organizations").doc(organizationId)
    .collection("catalogPackages").doc(firstImport.createdRecords[0].id);
  const [importedPackage, firstReceipt, settingsAfterImport] = await Promise.all([
    importedPackageRef.get(),
    adminDb.collection("organizations").doc(organizationId)
      .collection("importBatches").doc(packageRequest.importBatchId).get(),
    adminDb.collection("organizations").doc(organizationId)
      .collection("settings").doc("config").get()
  ]);
  assert.equal(importedPackage.data()?.pppMinor, 2345);
  assert.equal(Object.hasOwn(importedPackage.data() || {}, "ppp"), false);
  assert.equal(firstReceipt.data()?.actor?.uid, user.uid);
  assert.equal(firstReceipt.data()?.actor?.email, email);
  assert.equal(settingsAfterImport.data()?.catalogRevision, 8);
  assert.equal(settingsAfterImport.data()?.pricingSetupConfirmed, false);
  assert.equal(settingsAfterImport.data()?.pricingConfirmation, null);

  const replay = (await createCatalogImport(packageRequest)).data;
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.catalogRevision, 8);

  await settingsRefFor(adminDb, organizationId).set({
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: user.uid,
      actorEmail: email,
      confirmedAtISO: "2026-08-06T13:00:00.000Z",
      confirmedCatalogRevision: 8
    }
  }, { merge: true });
  const duplicateOnlyImport = (await createCatalogImport({
    ...packageRequest,
    importBatchId: "catalog_emulator_duplicate_0001",
    expectedCatalogRevision: 8
  })).data;
  assert.equal(duplicateOnlyImport.createdCount, 0);
  assert.equal(duplicateOnlyImport.catalogRevision, 8);
  const settingsAfterDuplicate = await settingsRefFor(adminDb, organizationId).get();
  assert.equal(settingsAfterDuplicate.data()?.pricingSetupConfirmed, true);
  assert.equal(settingsAfterDuplicate.data()?.pricingConfirmation?.confirmedCatalogRevision, 8);

  const concurrentRequests = [
    {
      organizationId,
      importType: "addons",
      fileName: "addons-a.csv",
      records: [{ rowNumber: 2, record: { name: "Concurrent add-on A", price: 5.25 } }],
      importBatchId: "catalog_emulator_addon_a_0001",
      expectedCatalogRevision: 8
    },
    {
      organizationId,
      importType: "addons",
      fileName: "addons-b.csv",
      records: [{ rowNumber: 2, record: { name: "Concurrent add-on B", price: 6.75 } }],
      importBatchId: "catalog_emulator_addon_b_0001",
      expectedCatalogRevision: 8
    }
  ];
  const concurrent = await Promise.allSettled(concurrentRequests.map((request) => createCatalogImport(request)));
  const fulfilled = concurrent.filter((entry) => entry.status === "fulfilled");
  const rejected = concurrent.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.code, "functions/aborted");
  const winningImport = fulfilled[0].value.data;
  const winningAddonId = winningImport.createdRecords[0].id;
  const winningAddonRef = adminDb.collection("organizations").doc(organizationId)
    .collection("catalogAddons").doc(winningAddonId);
  assert.equal(Number.isSafeInteger((await winningAddonRef.get()).data()?.priceMinor), true);
  assert.equal(
    (await adminDb.collection("organizations").doc(organizationId)
      .collection("settings").doc("config").get()).data()?.catalogRevision,
    9
  );

  const settingsRef = settingsRefFor(adminDb, organizationId);
  await adminDb.runTransaction(async (transaction) => {
    const [packageSnapshot, settingsSnapshot] = await Promise.all([
      transaction.get(importedPackageRef),
      transaction.get(settingsRef)
    ]);
    transaction.set(importedPackageRef, {
      ...packageSnapshot.data(),
      includedAddonIds: [winningAddonId]
    });
    transaction.set(settingsRef, {
      catalogRevision: Number(settingsSnapshot.data()?.catalogRevision || 0) + 1,
      pricingSetupConfirmed: false,
      pricingConfirmation: null
    }, { merge: true });
  });

  const protectedRollback = (await rollbackCatalogImport({
    organizationId,
    importBatchId: winningImport.importBatchId,
    expectedCatalogRevision: 10
  })).data;
  assert.equal(protectedRollback.deletedCount, 0);
  assert.equal(protectedRollback.protectedCount, 1);
  assert.equal(protectedRollback.protectedRecords[0]?.reason, "package_inclusion");
  assert.equal((await winningAddonRef.get()).exists, true);
  assert.equal(protectedRollback.catalogRevision, 10);

  const rentalRequest = {
    organizationId,
    importType: "rentals",
    fileName: "rentals.csv",
    records: [{ rowNumber: 2, record: { name: "Emulator chair", price: 3.5 } }],
    importBatchId: "catalog_emulator_rental_0001",
    expectedCatalogRevision: 10
  };
  const rentalImport = (await createCatalogImport(rentalRequest)).data;
  assert.equal(rentalImport.catalogRevision, 11);
  const rentalRef = adminDb.collection("organizations").doc(organizationId)
    .collection("catalogRentals").doc(rentalImport.createdRecords[0].id);
  assert.equal((await rentalRef.get()).data()?.priceMinor, 350);

  const rentalRollbackRequest = {
    organizationId,
    importBatchId: rentalImport.importBatchId,
    expectedCatalogRevision: 11
  };
  const rentalRollback = (await rollbackCatalogImport(rentalRollbackRequest)).data;
  assert.equal(rentalRollback.deletedCount, 1);
  assert.equal(rentalRollback.catalogRevision, 12);
  assert.equal((await rentalRef.get()).exists, false);
  const rollbackReplay = (await rollbackCatalogImport(rentalRollbackRequest)).data;
  assert.equal(rollbackReplay.idempotentReplay, true);
  assert.equal(rollbackReplay.catalogRevision, 12);

  await expectCallableCode(() => createCatalogImport({
    organizationId,
    importType: "rentals",
    fileName: "stale.csv",
    records: [{ rowNumber: 2, record: { name: "Stale chair", price: 1 } }],
    importBatchId: "catalog_emulator_stale_0001",
    expectedCatalogRevision: 11
  }), "aborted");
  await expectCallableCode(() => createCatalogImport({
    organizationId: otherOrganizationId,
    importType: "rentals",
    fileName: "cross-org.csv",
    records: [{ rowNumber: 2, record: { name: "Cross-org chair", price: 1 } }],
    importBatchId: "catalog_emulator_cross_org_0001",
    expectedCatalogRevision: 0
  }), "permission-denied");
} finally {
  await signOut(clientAuth).catch(() => undefined);
  await terminate(clientDb);
  await deleteApp(app);
}

console.log("Catalog import emulator passed.");
console.log("- browser catalog receipts denied; same-org admin callable authority enforced");
console.log("- integer minor units, one revision advance, and pricing invalidation persisted");
console.log("- concurrent stale writer aborted and stable batch retries remained idempotent");
console.log("- rollback deleted unchanged records and protected package dependencies");
