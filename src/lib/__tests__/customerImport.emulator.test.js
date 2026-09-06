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
  let preflightCustomerImport;
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
    preflightCustomerImport = httpsCallable(clientFunctions, "preflightCustomerImportBatch");
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
    const preflight = (await preflightCustomerImport(request)).data;
    expect(preflight).toMatchObject({
      ok: true,
      status: "ready",
      authority: "server_preflight",
      sourceCount: 3,
      projectedCreateCount: 2,
      projectedSkipCount: 1
    });
    expect(preflight.preflightId).toMatch(/^customer_preflight_[a-f0-9]{32}$/);
    expect(preflight.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(preflight.expiresAtISO)).toBeGreaterThan(Date.now());
    expect(preflight.chunks).toEqual([
      expect.objectContaining({ recordCount: 3, maximumWrites: 6, sourceIndexes: [0, 1, 2] })
    ]);
    await expect(setDoc(
      doc(clientDb, "organizations", organizationId, "customerImportPreflights", preflight.preflightId),
      { expiresAtISO: "2099-01-01T00:00:00.000Z" },
      { merge: true }
    )).rejects.toBeTruthy();
    await expectCallableCode(() => createCustomerImport(request), "invalid-argument");
    await expectCallableCode(() => createCustomerImport({
      ...request,
      importBatchId: "customer_emulator_unissued_0001",
      preflightId: `customer_preflight_${"f".repeat(32)}`,
      preflightPlanHash: preflight.planHash,
      preflightRecords: request.records,
      preflightChunkIndex: 0,
      preflightSessionId: "customer_emulator_unissued_0001"
    }), "failed-precondition");
    const result = (await createCustomerImport({
      ...request,
      preflightId: preflight.preflightId,
      preflightPlanHash: preflight.planHash,
      preflightRecords: request.records,
      preflightChunkIndex: 0,
      preflightSessionId: request.importBatchId
    })).data;
    expect(result).toMatchObject({
      createdCount: 2,
      skippedCount: 1,
      status: "completed",
      preflightPlanHash: preflight.planHash,
      preflightChunkIndex: 0,
      idempotentReplay: false
    });

    const emailCustomerId = customerIdForEmail("rowan@example.com");
    const nameCustomerId = customerIdForName("Name Only Customer");
    expect(new Set(result.createdRecords.map((record) => record.id)))
      .toEqual(new Set([emailCustomerId, nameCustomerId]));
    const [emailCustomer, nameCustomer, emailClaim, receipt, preflightReceipt] = await Promise.all([
      adminDb.collection("organizations").doc(organizationId)
        .collection("customers").doc(emailCustomerId).get(),
      adminDb.collection("organizations").doc(organizationId)
        .collection("customers").doc(nameCustomerId).get(),
      adminDb.collection("organizations").doc(organizationId)
        .collection("customerEmailClaims").doc(customerIdForEmail("rowan@example.com")).get(),
      adminDb.collection("organizations").doc(organizationId)
        .collection("importBatches").doc(request.importBatchId).get(),
      adminDb.collection("organizations").doc(organizationId)
        .collection("customerImportPreflights").doc(preflight.preflightId).get()
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
    expect(receipt.data()?.preflightPlanHash).toBe(preflight.planHash);
    expect(receipt.data()?.preflightId).toBe(preflight.preflightId);
    expect(receipt.data()?.preflightChunkIndex).toBe(0);
    expect(receipt.data()?.preflightSessionId).toBe(request.importBatchId);
    expect(receipt.data()?.schemaVersion).toBe(3);
    expect(receipt.data()?.createdRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: emailCustomerId,
        emailClaimId: customerIdForEmail("rowan@example.com"),
        emailKey: "rowan@example.com"
      })
    ]));
    expect(preflightReceipt.data()).toMatchObject({
      schemaVersion: 1,
      kind: "customer_import_preflight",
      preflightId: preflight.preflightId,
      organizationId,
      planHash: preflight.planHash,
      sourceCount: 3,
      chunkCount: 1,
      status: "completed",
      sessionImportBatchId: request.importBatchId,
      actor: { uid: user.uid, email }
    });
    expect(preflightReceipt.data()?.completedChunks?.["0"]).toMatchObject({
      importBatchId: request.importBatchId,
      requestHash: receipt.data()?.requestHash
    });

    const boundRequest = {
      ...request,
      preflightId: preflight.preflightId,
      preflightPlanHash: preflight.planHash,
      preflightRecords: request.records,
      preflightChunkIndex: 0,
      preflightSessionId: request.importBatchId
    };
    const replay = (await createCustomerImport(boundRequest)).data;
    expect(replay).toMatchObject({ idempotentReplay: true, createdCount: 2, skippedCount: 1 });
    const differentRequest = {
      ...request,
      fileName: "different.csv"
    };
    const differentPreflight = (await preflightCustomerImport(differentRequest)).data;
    await expectCallableCode(() => createCustomerImport({
      ...differentRequest,
      preflightId: differentPreflight.preflightId,
      preflightPlanHash: differentPreflight.planHash,
      preflightRecords: differentRequest.records,
      preflightChunkIndex: 0,
      preflightSessionId: differentRequest.importBatchId
    }), "already-exists");
    await expectCallableCode(() => createCustomerImport({
      ...request,
      organizationId: otherOrganizationId,
      importBatchId: "customer_emulator_cross_org_0001"
    }), "permission-denied");
    await expectCallableCode(() => createCustomerImport({
      ...request,
      importBatchId: "customer_emulator_tampered_0001",
      records: request.records.map((row, index) => index === 0
        ? { ...row, record: { ...row.record, name: "Changed after preflight" } }
        : row),
      preflightId: preflight.preflightId,
      preflightPlanHash: preflight.planHash,
      preflightRecords: request.records,
      preflightChunkIndex: 0,
      preflightSessionId: "customer_emulator_tampered_0001"
    }), "failed-precondition");

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

  test("preflight divides unique-email rows before Firestore's transaction write ceiling", async () => {
    const records = Array.from({ length: 250 }, (_, index) => ({
      rowNumber: index + 2,
      record: { name: `Preflight ${index + 1}`, email: `preflight-${index + 1}@example.com` }
    }));
    const result = (await preflightCustomerImport({
      organizationId,
      fileName: "large-customers.csv",
      records
    })).data;
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks.map((chunk) => chunk.recordCount)).toEqual([249, 1]);
    expect(result.chunks.every((chunk) => chunk.maximumWrites <= 500)).toBe(true);
  }, 120_000);

  test("an activated multi-chunk session resumes after preflight expiry and replays idempotently", async () => {
    const records = Array.from({ length: 250 }, (_, index) => ({
      rowNumber: index + 2,
      record: {
        name: `Resume ${index + 1}`,
        email: `resume-${index + 1}@example.com`
      }
    }));
    const fileName = "resume-customers.csv";
    const sessionId = "customer_resume_session_0001";
    const preflight = (await preflightCustomerImport({
      organizationId,
      fileName,
      records
    })).data;
    expect(preflight.chunks.map((chunk) => chunk.recordCount)).toEqual([249, 1]);

    const createChunk = (index) => createCustomerImport({
      organizationId,
      fileName,
      importBatchId: `${sessionId}_part_${String(index + 1).padStart(3, "0")}`,
      records: preflight.chunks[index].sourceIndexes.map((sourceIndex) => records[sourceIndex]),
      preflightId: preflight.preflightId,
      preflightPlanHash: preflight.planHash,
      preflightRecords: records,
      preflightChunkIndex: index,
      preflightSessionId: sessionId
    });

    const first = (await createChunk(0)).data;
    expect(first).toMatchObject({
      ok: true,
      createdCount: 249,
      preflightChunkIndex: 0,
      idempotentReplay: false
    });

    const simulatedNow = Date.now();
    const issuedAt = new Date(simulatedNow - (20 * 60 * 1000));
    const expiresAt = new Date(simulatedNow - (5 * 60 * 1000));
    const activatedAt = new Date(simulatedNow - (10 * 60 * 1000));
    const sessionExpiresAt = new Date(activatedAt.getTime() + (24 * 60 * 60 * 1000));
    const preflightRef = adminDb.collection("organizations").doc(organizationId)
      .collection("customerImportPreflights").doc(preflight.preflightId);
    await preflightRef.set({
      issuedAtISO: issuedAt.toISOString(),
      expiresAtISO: expiresAt.toISOString(),
      expiresAt,
      sessionActivatedAtISO: activatedAt.toISOString(),
      sessionExpiresAtISO: sessionExpiresAt.toISOString(),
      sessionExpiresAt
    }, { merge: true });

    const second = (await createChunk(1)).data;
    expect(second).toMatchObject({
      ok: true,
      createdCount: 1,
      preflightChunkIndex: 1,
      idempotentReplay: false
    });
    const replay = (await createChunk(0)).data;
    expect(replay).toMatchObject({
      ok: true,
      createdCount: 249,
      preflightChunkIndex: 0,
      idempotentReplay: true
    });
    expect((await preflightRef.get()).data()).toMatchObject({
      status: "completed",
      sessionImportBatchId: sessionId,
      completedChunks: {
        0: { importBatchId: `${sessionId}_part_001` },
        1: { importBatchId: `${sessionId}_part_002` }
      }
    });

    await rollbackCustomerImport({
      organizationId,
      importBatchId: `${sessionId}_part_002`
    });
    await rollbackCustomerImport({
      organizationId,
      importBatchId: `${sessionId}_part_001`
    });
  }, 180_000);

  test("preflight rejects oversize customer text instead of silently truncating it", async () => {
    const oversizeNotes = "n".repeat(2_001);
    await expectCallableCode(() => preflightCustomerImport({
      organizationId,
      fileName: "oversize-customers.csv",
      records: [{
        rowNumber: 27,
        record: { name: "Oversize Customer", notes: oversizeNotes }
      }]
    }), "invalid-argument");

    const oversizeCustomerId = customerIdForName("Oversize Customer");
    expect((await adminDb.collection("organizations").doc(organizationId)
      .collection("customers").doc(oversizeCustomerId).get()).exists).toBe(false);
  }, 120_000);

  test("create rejects expired or differently actor-bound issued preflight receipts", async () => {
    const records = [{
      rowNumber: 12,
      record: { name: "Authority Bound Customer", email: "authority-bound@example.com" }
    }];
    const baseRequest = {
      organizationId,
      fileName: "authority-bound.csv",
      records
    };
    const expiredPreflight = (await preflightCustomerImport(baseRequest)).data;
    await adminDb.collection("organizations").doc(organizationId)
      .collection("customerImportPreflights").doc(expiredPreflight.preflightId)
      .set({ expiresAtISO: "2000-01-01T00:00:00.000Z" }, { merge: true });
    await expectCallableCode(() => createCustomerImport({
      ...baseRequest,
      importBatchId: "customer_expired_preflight_0001",
      preflightId: expiredPreflight.preflightId,
      preflightPlanHash: expiredPreflight.planHash,
      preflightRecords: records,
      preflightChunkIndex: 0,
      preflightSessionId: "customer_expired_preflight_0001"
    }), "failed-precondition");

    const actorPreflight = (await preflightCustomerImport(baseRequest)).data;
    await adminDb.collection("organizations").doc(organizationId)
      .collection("customerImportPreflights").doc(actorPreflight.preflightId)
      .set({ actor: { uid: "different-admin", email } }, { merge: true });
    await expectCallableCode(() => createCustomerImport({
      ...baseRequest,
      importBatchId: "customer_actor_preflight_0001",
      preflightId: actorPreflight.preflightId,
      preflightPlanHash: actorPreflight.planHash,
      preflightRecords: records,
      preflightChunkIndex: 0,
      preflightSessionId: "customer_actor_preflight_0001"
    }), "failed-precondition");
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
    await expectCallableCode(() => preflightCustomerImport({
      organizationId,
      fileName: "collision.csv",
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
    await expectCallableCode(() => preflightCustomerImport({
      organizationId,
      fileName: "orphan-claim.csv",
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
