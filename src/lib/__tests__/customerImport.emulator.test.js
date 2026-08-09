import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
  getDoc,
  getFirestore,
  setDoc,
  terminate
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable
} from "firebase/functions";
import { loadFirebaseAdmin } from "../../../scripts/firebase-admin-modular.mjs";

const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || "").trim();
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const functionsHost = String(process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5601").trim();
const HAS_CUSTOMER_IMPORT_EMULATORS = projectId.startsWith("demo-") && Boolean(authHost && firestoreHost);

function parseAddress(value) {
  const normalized = String(value || "").replace(/^https?:\/\//, "");
  const separator = normalized.lastIndexOf(":");
  return {
    host: normalized.slice(0, separator),
    port: Number(normalized.slice(separator + 1))
  };
}

function customerIdForEmail(email) {
  return `email_${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
}

function customerIdForName(name) {
  const nameKey = name.trim().toLowerCase().replace(/\s+/g, " ");
  return `name_${createHash("sha256").update(JSON.stringify(nameKey)).digest("hex")}`;
}

async function expectCallableCode(action, expectedCode) {
  await expect(action()).rejects.toMatchObject({ code: `functions/${expectedCode}` });
}

const emulatorDescribe = HAS_CUSTOMER_IMPORT_EMULATORS ? describe : describe.skip;

emulatorDescribe("authoritative customer imports", () => {
  const organizationId = "customer-import-org";
  const otherOrganizationId = "customer-import-other-org";
  const email = "customer-import-owner@local.test";
  const password = "Passw0rd!";
  let admin;
  let adminDb;
  let app;
  let clientAuth;
  let clientDb;
  let createCustomerImport;
  let rollbackCustomerImport;
  let user;

  beforeAll(async () => {
    admin = loadFirebaseAdmin();
    if (!admin.getApps().length) admin.initializeApp({ projectId });
    adminDb = admin.getFirestore();
    const adminAuth = admin.getAuth();
    user = await adminAuth.createUser({ email, password, emailVerified: true });
    await Promise.all([
      adminDb.collection("organizations").doc(organizationId).set({
        name: "Customer Import Organization",
        active: true,
        archived: false,
        status: "active"
      }),
      adminDb.collection("organizations").doc(otherOrganizationId).set({
        name: "Other Customer Organization",
        active: true,
        archived: false,
        status: "active"
      }),
      adminDb.collection("userRoles").doc(user.uid).set({
        role: "admin",
        organizationId,
        email
      })
    ]);

    app = initializeApp({
      apiKey: "demo-key",
      authDomain: `${projectId}.firebaseapp.com`,
      projectId
    }, "customer-import-emulator");
    clientAuth = getAuth(app);
    clientDb = getFirestore(app);
    const clientFunctions = getFunctions(app, "us-central1");
    const authAddress = parseAddress(authHost);
    const firestoreAddress = parseAddress(firestoreHost);
    const functionsAddress = parseAddress(functionsHost);
    connectAuthEmulator(clientAuth, `http://${authAddress.host}:${authAddress.port}`, {
      disableWarnings: true
    });
    connectFirestoreEmulator(clientDb, firestoreAddress.host, firestoreAddress.port);
    connectFunctionsEmulator(clientFunctions, functionsAddress.host, functionsAddress.port);
    createCustomerImport = httpsCallable(clientFunctions, "createCustomerImportBatch");
    rollbackCustomerImport = httpsCallable(clientFunctions, "rollbackCustomerImportBatch");
    await signInWithEmailAndPassword(clientAuth, email, password);
  }, 120_000);

  afterAll(async () => {
    await signOut(clientAuth).catch(() => undefined);
    if (clientDb) await terminate(clientDb);
    if (app) await deleteApp(app);
  });

  test("server owns customer ids, normalized search fields, duplicate decisions, and receipts", async () => {
    await expect(setDoc(
      doc(clientDb, "organizations", organizationId, "customers", "browser-forged"),
      {
        customerId: "browser-forged",
        organizationId,
        name: "Browser Forged",
        nameKey: "browser forged",
        email: "browser@example.com",
        emailKey: "browser@example.com"
      }
    )).rejects.toBeTruthy();
    await expect(setDoc(
      doc(clientDb, "organizations", organizationId, "importBatches", "browser_customer_receipt_0001"),
      {
        organizationId,
        importBatchId: "browser_customer_receipt_0001",
        importType: "customers",
        status: "completed"
      }
    )).rejects.toBeTruthy();
    await expect(setDoc(
      doc(clientDb, "organizations", organizationId, "customerEmailClaims", "browser-forged"),
      {
        organizationId,
        customerId: "browser-forged",
        emailKey: "browser@example.com"
      }
    )).rejects.toBeTruthy();

    const request = {
      organizationId,
      organizationName: "Customer Import Organization",
      fileName: "customers.csv",
      importBatchId: "customer_emulator_batch_0001",
      records: [
        {
          rowNumber: 2,
          record: {
            name: "  Rowan   Client ",
            email: "ROWAN@EXAMPLE.COM",
            phone: "555-0101",
            customerId: "browser-forged",
            nameKey: "browser-forged",
            organizationId: otherOrganizationId
          }
        },
        { rowNumber: 3, record: { name: "Name Only Customer", notes: "Imported lead" } },
        { rowNumber: 4, record: { name: "Duplicate", email: "rowan@example.com" } }
      ]
    };
    const result = (await createCustomerImport(request)).data;
    expect(result).toMatchObject({
      createdCount: 2,
      skippedCount: 1,
      status: "completed",
      idempotentReplay: false
    });

    const emailCustomerId = customerIdForEmail("rowan@example.com");
    const nameCustomerId = customerIdForName("Name Only Customer");
    expect(new Set(result.createdRecords.map((record) => record.id)))
      .toEqual(new Set([emailCustomerId, nameCustomerId]));
    const [emailCustomer, nameCustomer, emailClaim, receipt] = await Promise.all([
      adminDb.collection("organizations").doc(organizationId)
        .collection("customers").doc(emailCustomerId).get(),
      adminDb.collection("organizations").doc(organizationId)
        .collection("customers").doc(nameCustomerId).get(),
      adminDb.collection("organizations").doc(organizationId)
        .collection("customerEmailClaims").doc(customerIdForEmail("rowan@example.com")).get(),
      adminDb.collection("organizations").doc(organizationId)
        .collection("importBatches").doc(request.importBatchId).get()
    ]);
    expect(emailCustomer.data()).toMatchObject({
      customerId: emailCustomerId,
      organizationId,
      name: "Rowan   Client",
      nameKey: "rowan client",
      email: "rowan@example.com",
      emailKey: "rowan@example.com",
      recordSource: "import_studio",
      importSource: "import_studio",
      importBatchId: request.importBatchId
    });
    expect(emailCustomer.data()).not.toHaveProperty("customerId", "browser-forged");
    expect(nameCustomer.data()).toMatchObject({
      customerId: nameCustomerId,
      nameKey: "name only customer",
      emailKey: ""
    });
    expect(emailClaim.data()).toMatchObject({
      schemaVersion: 1,
      organizationId,
      customerId: emailCustomerId,
      emailKey: "rowan@example.com",
      recordSource: "trusted_customer_email_claim",
      createdBySource: "import_studio",
      importBatchId: request.importBatchId
    });
    expect(receipt.data()?.actor).toEqual({ uid: user.uid, email });
    expect(receipt.data()?.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.data()?.schemaVersion).toBe(3);
    expect(receipt.data()?.createdRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: emailCustomerId,
        emailClaimId: customerIdForEmail("rowan@example.com"),
        emailKey: "rowan@example.com"
      })
    ]));

    const replay = (await createCustomerImport(request)).data;
    expect(replay).toMatchObject({ idempotentReplay: true, createdCount: 2, skippedCount: 1 });
    await expectCallableCode(() => createCustomerImport({
      ...request,
      fileName: "different.csv"
    }), "already-exists");
    await expectCallableCode(() => createCustomerImport({
      ...request,
      organizationId: otherOrganizationId,
      importBatchId: "customer_emulator_cross_org_0001"
    }), "permission-denied");

    await adminDb.collection("organizations").doc(organizationId)
      .collection("customers").doc(nameCustomerId).set({ notes: "Edited after import" }, { merge: true });
    const rollback = (await rollbackCustomerImport({
      organizationId,
      importBatchId: request.importBatchId
    })).data;
    expect(rollback).toMatchObject({
      deletedCount: 1,
      protectedCount: 1,
      missingCount: 0,
      idempotentReplay: false
    });
    expect((await adminDb.collection("organizations").doc(organizationId)
      .collection("customers").doc(emailCustomerId).get()).exists).toBe(false);
    expect((await adminDb.collection("organizations").doc(organizationId)
      .collection("customerEmailClaims").doc(customerIdForEmail("rowan@example.com")).get()).exists).toBe(false);
    expect((await adminDb.collection("organizations").doc(organizationId)
      .collection("customers").doc(nameCustomerId).get()).exists).toBe(true);
    const rollbackReplay = (await rollbackCustomerImport({
      organizationId,
      importBatchId: request.importBatchId
    })).data;
    expect(rollbackReplay).toMatchObject({ idempotentReplay: true, deletedCount: 1, protectedCount: 1 });
  }, 120_000);

  test("duplicate identity collisions fail closed and legacy receipts remain safely reversible", async () => {
    const customersRef = adminDb.collection("organizations").doc(organizationId).collection("customers");
    await Promise.all([
      customersRef.doc("legacy-collision-a").set({
        organizationId,
        name: "Collision A",
        email: "collision@example.com",
        importSource: "import_studio"
      }),
      customersRef.doc("legacy-collision-b").set({
        organizationId,
        name: "Collision B",
        emailKey: "collision@example.com",
        importSource: "import_studio"
      })
    ]);
    await expectCallableCode(() => createCustomerImport({
      organizationId,
      fileName: "collision.csv",
      importBatchId: "customer_emulator_collision_0001",
      records: [{ rowNumber: 2, record: { name: "New", email: "new@example.com" } }]
    }), "failed-precondition");
    await Promise.all([
      customersRef.doc("legacy-collision-a").delete(),
      customersRef.doc("legacy-collision-b").delete()
    ]);

    const orphanClaimEmail = "orphan-claim@example.com";
    const orphanClaimId = customerIdForEmail(orphanClaimEmail);
    const orphanClaimRef = adminDb.collection("organizations").doc(organizationId)
      .collection("customerEmailClaims").doc(orphanClaimId);
    await orphanClaimRef.set({
      schemaVersion: 1,
      organizationId,
      customerId: "missing-customer",
      emailKey: orphanClaimEmail,
      recordSource: "trusted_customer_email_claim",
      createdBySource: "legacy_repair"
    });
    await expectCallableCode(() => createCustomerImport({
      organizationId,
      fileName: "orphan-claim.csv",
      importBatchId: "customer_emulator_orphan_claim_0001",
      records: [{ rowNumber: 2, record: { name: "Orphan", email: orphanClaimEmail } }]
    }), "failed-precondition");
    await orphanClaimRef.delete();

    const legacyBatchId = "legacy_customer_batch_0001";
    const legacyCustomerId = "legacy-imported-customer";
    const legacyTimestamp = "2026-08-08T12:00:00.000Z";
    await Promise.all([
      customersRef.doc(legacyCustomerId).set({
        organizationId,
        name: "Legacy Imported Customer",
        email: "legacy@example.com",
        importSource: "import_studio",
        importBatchId: legacyBatchId,
        createdAtISO: legacyTimestamp,
        updatedAtISO: legacyTimestamp
      }),
      adminDb.collection("organizations").doc(organizationId)
        .collection("importBatches").doc(legacyBatchId).set({
          organizationId,
          importBatchId: legacyBatchId,
          importType: "customers",
          status: "completed",
          createdRecords: [{ collection: "customers", id: legacyCustomerId }]
        })
    ]);
    const rollback = (await rollbackCustomerImport({ organizationId, importBatchId: legacyBatchId })).data;
    expect(rollback).toMatchObject({ deletedCount: 1, protectedCount: 0, status: "rolled_back" });
    expect((await customersRef.doc(legacyCustomerId).get()).exists).toBe(false);
  }, 120_000);
});
