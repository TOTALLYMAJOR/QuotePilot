#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";
import { planOrganizationOwnerBackfill } from "./organization-owner-backfill-plan.mjs";

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

export function parseOrganizationOwnerBackfillArgs(argv = []) {
  let projectId = "";
  let organizationId = "";
  let expectedOwnerUid = "";
  let confirmation = "";
  let mode = "dry-run";
  let explicitMode = "";
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    if (token === "--dry-run" || token === "--apply") {
      const requestedMode = token.slice(2);
      if (explicitMode && explicitMode !== requestedMode) {
        throw new Error("Choose exactly one mode: --dry-run or --apply.");
      }
      explicitMode = requestedMode;
      mode = requestedMode;
      continue;
    }
    if (["--project", "--organization", "--expected-owner-uid", "--confirm"].includes(token)) {
      const value = requiredValue(argv, index, token);
      if (token === "--project") projectId = value;
      if (token === "--organization") organizationId = value;
      if (token === "--expected-owner-uid") expectedOwnerUid = value;
      if (token === "--confirm") confirmation = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  assertSafeId(projectId, "--project");
  assertSafeId(organizationId, "--organization");
  if (mode === "apply") {
    assertSafeId(expectedOwnerUid, "--expected-owner-uid");
    const expected = `BIND ORGANIZATION OWNER ${projectId} ${organizationId} ${expectedOwnerUid}`;
    if (confirmation !== expected) throw new Error(`Apply requires --confirm "${expected}".`);
  }
  return { projectId, organizationId, expectedOwnerUid, dryRun: mode !== "apply", confirmation };
}

function assertProjectBoundary({ projectId, env = process.env }) {
  const configuredProject = String(env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || "").trim();
  if (configuredProject && configuredProject !== projectId) {
    throw new Error(`Credential project ${configuredProject} does not match requested project ${projectId}.`);
  }
  const emulatorHost = String(env.FIRESTORE_EMULATOR_HOST || "").trim();
  if (emulatorHost && !projectId.startsWith("demo-")) {
    throw new Error("Firestore emulator use requires a demo-* project id.");
  }
}

async function collectEvidence({ db, auth, organizationId, transaction = null }) {
  const read = (reference) => transaction ? transaction.get(reference) : reference.get();
  const organizationRef = db.collection("organizations").doc(organizationId);
  const receiptRef = db.collection("organizationOwnerBindingReceipts").doc(organizationId);
  const inviteQuery = db.collection("organizationInvites").where("organizationId", "==", organizationId);
  const [organizationSnapshot, receiptSnapshot, inviteSnapshot] = await Promise.all([
    read(organizationRef),
    read(receiptRef),
    read(inviteQuery)
  ]);
  const invites = inviteSnapshot.docs.map((snapshot) => ({ id: snapshot.id, data: snapshot.data() || {} }));
  const consumedAdminInvites = invites.filter((entry) => (
    String(entry.data.status || "").trim().toLowerCase() === "consumed"
    && String(entry.data.role || "").trim().toLowerCase() === "admin"
  ));
  const orderIds = [...new Set(consumedAdminInvites.map((entry) => String(entry.data.orderId || "").trim()).filter(Boolean))];
  const ownerUids = [...new Set(consumedAdminInvites.map((entry) => String(entry.data.consumedByUid || "").trim()).filter(Boolean))];
  const orderRefs = orderIds.map((id) => db.collection("provisioningOrders").doc(id));
  const roleRefs = ownerUids.map((uid) => db.collection("userRoles").doc(uid));
  const firestoreSnapshots = await Promise.all([...orderRefs, ...roleRefs].map(read));
  const orders = firestoreSnapshots.slice(0, orderRefs.length)
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ id: snapshot.id, data: snapshot.data() || {} }));
  const roles = firestoreSnapshots.slice(orderRefs.length)
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ id: snapshot.id, data: snapshot.data() || {} }));
  const authUsers = [];
  for (const uid of ownerUids) {
    try {
      const user = await auth.getUser(uid);
      authUsers.push({ uid: user.uid, email: user.email || "", emailVerified: user.emailVerified === true });
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  return {
    refs: { organizationRef, receiptRef },
    organization: organizationSnapshot.exists ? organizationSnapshot.data() || {} : null,
    invites,
    orders,
    roles,
    authUsers,
    receipt: receiptSnapshot.exists ? receiptSnapshot.data() || {} : null
  };
}

export async function runOrganizationOwnerBackfill(options, { env = process.env } = {}) {
  const { projectId, organizationId, expectedOwnerUid = "", dryRun = true } = options;
  assertProjectBoundary({ projectId, env });
  const admin = loadFirebaseAdmin();
  if (!admin.getApps().length) admin.initializeApp({ projectId });
  const db = admin.getFirestore();
  const auth = admin.getAuth();
  const nowISO = new Date().toISOString();
  const evidence = await collectEvidence({ db, auth, organizationId });
  const plan = planOrganizationOwnerBackfill({ ...evidence, organizationId, nowISO });
  if (dryRun || plan.state !== "bind") return { dryRun, plan, applied: false };
  if (plan.ownerUid !== expectedOwnerUid) {
    throw new Error("Planned owner UID does not match --expected-owner-uid. No writes were made.");
  }

  const appliedPlan = await db.runTransaction(async (transaction) => {
    const currentEvidence = await collectEvidence({ db, auth, organizationId, transaction });
    const currentPlan = planOrganizationOwnerBackfill({ ...currentEvidence, organizationId, nowISO });
    if (currentPlan.state !== "bind" || currentPlan.ownerUid !== expectedOwnerUid) {
      throw new Error("Ownership evidence changed after dry-run planning. No writes were made.");
    }
    transaction.set(currentEvidence.refs.organizationRef, {
      ...currentPlan.organizationPatch,
      ownerBoundAt: admin.FieldValue.serverTimestamp(),
      updatedAt: admin.FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(db.collection("provisioningOrders").doc(currentPlan.orderId), {
      ...currentPlan.orderPatch,
      updatedAt: admin.FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.create(currentEvidence.refs.receiptRef, {
      ...currentPlan.receipt,
      createdAt: admin.FieldValue.serverTimestamp()
    });
    return currentPlan;
  });
  return { dryRun: false, plan: appliedPlan, applied: true };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOrganizationOwnerBackfillArgs(argv);
  const result = await runOrganizationOwnerBackfill(options);
  console.log(options.dryRun
    ? "Organization owner dry run completed; no writes were made."
    : "Organization owner binding completed.");
  console.log(`Project: ${options.projectId}`);
  console.log(`Organization: ${options.organizationId}`);
  console.log(`State: ${result.plan.state}`);
  console.log(`Candidate count: ${result.plan.candidateCount}`);
  if (result.plan.ownerUid) console.log(`Owner UID: ${result.plan.ownerUid}`);
  if (result.plan.reasons?.length) console.log(`Reasons: ${result.plan.reasons.join(", ")}`);
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntrypoint) {
  main().catch((error) => {
    console.error("Organization owner backfill failed:", error?.message || error);
    process.exitCode = 1;
  });
}
