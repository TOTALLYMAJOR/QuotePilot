#!/usr/bin/env node

import assert from "node:assert/strict";
import process from "node:process";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";
import { runOrganizationOwnerBackfill } from "./backfill-organization-owner.mjs";

const projectId = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "").trim();
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || "").trim();
assert.match(projectId, /^demo-/u);
assert.match(firestoreHost, /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/u);
assert.match(authHost, /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/u);

const admin = loadFirebaseAdmin();
if (!admin.getApps().length) admin.initializeApp({ projectId });
const db = admin.getFirestore();
const auth = admin.getAuth();

async function seedOwner({ organizationId, orderId, inviteId, uid, email, ownerUid = "" }) {
  await auth.createUser({ uid, email, emailVerified: true });
  await Promise.all([
    db.collection("organizations").doc(organizationId).set({
      ownerEmail: email,
      ownerUid,
      status: "active",
      archived: false
    }),
    db.collection("provisioningOrders").doc(orderId).set({
      organizationId,
      ownerEmail: email,
      ownerUid
    }),
    db.collection("organizationInvites").doc(inviteId).set({
      organizationId,
      orderId,
      email,
      role: "admin",
      status: "consumed",
      consumedByUid: uid,
      consumedByEmail: email
    }),
    db.collection("userRoles").doc(uid).set({
      organizationId,
      email,
      role: "admin"
    })
  ]);
}

const exact = {
  organizationId: "org-owner-exact",
  orderId: "order-owner-exact",
  inviteId: "invite-owner-exact",
  uid: "uid-owner-exact",
  email: "owner-exact@example.test"
};
await seedOwner(exact);

const dryRun = await runOrganizationOwnerBackfill({
  projectId,
  organizationId: exact.organizationId,
  dryRun: true
});
assert.equal(dryRun.plan.state, "bind");
assert.equal(dryRun.plan.ownerUid, exact.uid);
assert.equal((await db.collection("organizations").doc(exact.organizationId).get()).data()?.ownerUid, "");
assert.equal((await db.collection("organizationOwnerBindingReceipts").doc(exact.organizationId).get()).exists, false);

const applied = await runOrganizationOwnerBackfill({
  projectId,
  organizationId: exact.organizationId,
  expectedOwnerUid: exact.uid,
  dryRun: false
});
assert.equal(applied.applied, true);
const [organizationAfter, orderAfter, receiptAfter] = await Promise.all([
  db.collection("organizations").doc(exact.organizationId).get(),
  db.collection("provisioningOrders").doc(exact.orderId).get(),
  db.collection("organizationOwnerBindingReceipts").doc(exact.organizationId).get()
]);
assert.equal(organizationAfter.data()?.ownerUid, exact.uid);
assert.equal(orderAfter.data()?.ownerUid, exact.uid);
assert.equal(receiptAfter.data()?.ownerUid, exact.uid);
assert.equal(receiptAfter.data()?.inviteId, exact.inviteId);
assert.equal(receiptAfter.data()?.bindingSource, "consumed_owner_invite_backfill");

const replay = await runOrganizationOwnerBackfill({
  projectId,
  organizationId: exact.organizationId,
  expectedOwnerUid: exact.uid,
  dryRun: false
});
assert.equal(replay.applied, false);
assert.equal(replay.plan.state, "already_current");

await seedOwner({
  organizationId: "org-owner-ambiguous",
  orderId: "order-owner-ambiguous-a",
  inviteId: "invite-owner-ambiguous-a",
  uid: "uid-owner-ambiguous-a",
  email: "owner-ambiguous@example.test"
});
await auth.createUser({
  uid: "uid-owner-ambiguous-b",
  email: "second-owner@example.test",
  emailVerified: true
});
await Promise.all([
  db.collection("provisioningOrders").doc("order-owner-ambiguous-b").set({
    organizationId: "org-owner-ambiguous",
    ownerEmail: "second-owner@example.test",
    ownerUid: ""
  }),
  db.collection("organizationInvites").doc("invite-owner-ambiguous-b").set({
    organizationId: "org-owner-ambiguous",
    orderId: "order-owner-ambiguous-b",
    email: "second-owner@example.test",
    role: "admin",
    status: "consumed",
    consumedByUid: "uid-owner-ambiguous-b",
    consumedByEmail: "second-owner@example.test"
  }),
  db.collection("userRoles").doc("uid-owner-ambiguous-b").set({
    organizationId: "org-owner-ambiguous",
    email: "second-owner@example.test",
    role: "admin"
  })
]);
const ambiguous = await runOrganizationOwnerBackfill({
  projectId,
  organizationId: "org-owner-ambiguous",
  dryRun: true
});
assert.equal(ambiguous.plan.state, "ownership_required");
assert.deepEqual(ambiguous.plan.reasons, ["multiple_consumed_owner_invites"]);
assert.equal((await db.collection("organizationOwnerBindingReceipts").doc("org-owner-ambiguous").get()).exists, false);

console.log("Organization-owner backfill emulator acceptance passed:");
console.log("- dry-run made no writes");
console.log("- exact apply transactionally bound organization, order, and immutable receipt");
console.log("- replay was idempotent and multiple consumed candidates failed closed");
