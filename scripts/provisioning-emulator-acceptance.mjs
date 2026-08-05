#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
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
  terminate,
  updateDoc,
  writeBatch
} from "firebase/firestore";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

const admin = loadFirebaseAdmin();

const projectId = String(process.env.GCLOUD_PROJECT || process.env.E2E_FIREBASE_PROJECT_ID || "").trim();
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || "").trim();
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const functionsHost = String(process.env.FUNCTIONS_EMULATOR_HOST || "").trim();

if (!projectId.startsWith("demo-") || !authHost || !firestoreHost || !functionsHost) {
  throw new Error(
    "Provisioning acceptance is emulator-only. Use a demo-* project with Auth, Firestore, and Functions emulator hosts."
  );
}

if (!admin.getApps().length) {
  admin.initializeApp({ projectId });
}

const db = admin.getFirestore();
const auth = admin.getAuth();
const region = "us-central1";
const acceptanceCredential = `Provisioning-E2E-${randomUUID()}!`;
const canonicalAppUrl = "https://quotepilot.mbmapps.com/app";
let clientAppSequence = 0;

function parseEmulatorAddress(value = "") {
  const normalized = String(value || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const separatorIndex = normalized.lastIndexOf(":");
  const host = separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : normalized;
  const port = separatorIndex >= 0 ? Number(normalized.slice(separatorIndex + 1)) : NaN;
  assert.ok(host, `Invalid emulator host: ${value}`);
  assert.ok(Number.isInteger(port) && port > 0, `Invalid emulator port: ${value}`);
  return { host, port };
}

function createClientSession(label, { withAuth = true } = {}) {
  clientAppSequence += 1;
  const app = initializeApp({
    apiKey: "demo-key",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId
  }, `provisioning-${label}-${clientAppSequence}`);
  const firestore = getFirestore(app);
  const firestoreAddress = parseEmulatorAddress(firestoreHost);
  connectFirestoreEmulator(firestore, firestoreAddress.host, firestoreAddress.port);

  let clientAuth = null;
  if (withAuth) {
    clientAuth = getAuth(app);
    connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
  }

  return {
    app,
    auth: clientAuth,
    db: firestore
  };
}

async function closeClientSession(session) {
  if (!session) return;
  if (session.auth?.currentUser) {
    await signOut(session.auth);
  }
  await terminate(session.db);
  await deleteApp(session.app);
}

function inviteIdFromEmail(email = "") {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");
}

async function createPrincipal({ email, role, organizationId, platformAdmin = false }) {
  const user = await auth.createUser({
    email,
    password: acceptanceCredential,
    emailVerified: true
  });
  await db.collection("userRoles").doc(user.uid).create({
    role,
    email,
    organizationId,
    createdAt: admin.FieldValue.serverTimestamp(),
    updatedAt: admin.FieldValue.serverTimestamp()
  });
  await auth.setCustomUserClaims(user.uid, {
    role,
    organizationId,
    platformAdmin,
    claimsVersion: 1
  });
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: acceptanceCredential,
        returnSecureToken: true
      })
    }
  );
  assert.equal(response.ok, true, `Auth emulator sign-in failed for ${email}`);
  const payload = await response.json();
  assert.ok(payload.idToken, `Auth emulator did not return an ID token for ${email}`);
  return {
    uid: user.uid,
    idToken: payload.idToken
  };
}

async function callFunction(name, idToken, data = {}) {
  const response = await fetch(
    `http://${functionsHost}/${projectId}/${region}/${name}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
        Origin: "http://localhost:4174"
      },
      body: JSON.stringify({ data })
    }
  );
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(
      `${name} returned a non-JSON response (${response.status}): ${responseText.slice(0, 180)}`
    );
  }
  if (payload?.error) {
    const error = new Error(payload.error.message || `${name} failed`);
    error.status = payload.error.status || "";
    throw error;
  }
  return payload?.result || payload?.data || {};
}

async function expectCallableError(action, expectedStatus) {
  let caught = null;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected callable error ${expectedStatus}`);
  assert.equal(caught.status, expectedStatus);
}

async function callStripeWebhook(event) {
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  assert.ok(webhookSecret, "STRIPE_WEBHOOK_SECRET is required for webhook acceptance.");
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const response = await fetch(
    `http://${functionsHost}/${projectId}/${region}/stripeWebhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${signature}`
      },
      body
    }
  );
  const responseText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = null;
  }
  return {
    status: response.status,
    ok: response.ok,
    payload,
    responseText
  };
}

const organizationId = "provisioning-e2e-org";
const ownerEmail = "owner.provisioning@example.test";
const adminPrincipal = await createPrincipal({
  email: "admin.provisioning@example.test",
  role: "admin",
  organizationId: "",
  platformAdmin: true
});
const salesPrincipal = await createPrincipal({
  email: "sales.provisioning@example.test",
  role: "sales",
  organizationId: "sales-home"
});
const tenantAdminPrincipal = await createPrincipal({
  email: "tenant-admin.provisioning@example.test",
  role: "admin",
  organizationId: "tenant-admin-home",
  platformAdmin: false
});
const unscopedCustomerPrincipal = await createPrincipal({
  email: "unscoped.customer.provisioning@example.test",
  role: "customer",
  organizationId: "",
  platformAdmin: false
});
await db.collection("organizations").doc("sales-home").create({
  name: "Sales Home",
  active: true,
  archived: false,
  status: "active"
});
await db.collection("organizations").doc("tenant-admin-home").create({
  name: "Tenant Admin Home",
  active: true,
  archived: false,
  status: "active"
});

const createPayload = {
  organizationName: "Provisioning Acceptance Events",
  organizationId,
  ownerEmail,
  ownerName: "Acceptance Owner",
  plan: "growth",
  orderId: "provisioning-e2e-create-001",
  appUrl: canonicalAppUrl
};

await db.collection("userRoles").doc(adminPrincipal.uid).update({
  role: "sales"
});
await expectCallableError(
  () => callFunction("preflightCustomerOrder", adminPrincipal.idToken, createPayload),
  "PERMISSION_DENIED"
);
await db.collection("userRoles").doc(adminPrincipal.uid).update({
  role: "admin"
});

await expectCallableError(
  () => callFunction("preflightCustomerOrder", salesPrincipal.idToken, createPayload),
  "PERMISSION_DENIED"
);

await expectCallableError(
  () => callFunction("preflightCustomerOrder", tenantAdminPrincipal.idToken, createPayload),
  "PERMISSION_DENIED"
);

await db.collection("organizations").doc("tenant-admin-home").update({
  active: false
});
await expectCallableError(
  () => callFunction("ensureOrganizationBootstrap", tenantAdminPrincipal.idToken, {}),
  "FAILED_PRECONDITION"
);
await expectCallableError(
  () => callFunction("preflightCustomerOrder", tenantAdminPrincipal.idToken, {
    organizationId: "tenant-admin-home",
    plan: "starter",
    orderId: "inactive-tenant-update",
    updateExistingOrganization: true
  }),
  "FAILED_PRECONDITION"
);
await db.collection("organizations").doc("tenant-admin-home").update({
  active: true,
  status: "suspended"
});
await expectCallableError(
  () => callFunction("ensureOrganizationBootstrap", tenantAdminPrincipal.idToken, {}),
  "FAILED_PRECONDITION"
);
await db.collection("organizations").doc("tenant-admin-home").update({
  active: true,
  status: "active"
});

await expectCallableError(
  () => callFunction("preflightCustomerOrder", adminPrincipal.idToken, {
    ...createPayload,
    appUrl: "https://untrusted.example.test/app"
  }),
  "INVALID_ARGUMENT"
);

const platformCrossOrgPreflight = await callFunction(
  "preflightCustomerOrder",
  adminPrincipal.idToken,
  {
    ...createPayload,
    organizationId: "another-organization",
    orderId: "provisioning-e2e-cross-org-001"
  }
);
assert.equal(platformCrossOrgPreflight.canCreate, true);

const preflight = await callFunction(
  "preflightCustomerOrder",
  adminPrincipal.idToken,
  createPayload
);
assert.equal(preflight.ok, true);
assert.equal(preflight.canCreate, true);
assert.equal(preflight.exists, false);

const unverifiedDirectOwner = await auth.createUser({
  email: "unverified.direct.owner@example.test",
  password: acceptanceCredential,
  emailVerified: false
});
await expectCallableError(
  () => callFunction("syncUserClaimsFromRole", tenantAdminPrincipal.idToken, {
    uid: unverifiedDirectOwner.uid
  }),
  "NOT_FOUND"
);
await expectCallableError(
  () => callFunction("syncUserClaimsFromRole", tenantAdminPrincipal.idToken, {
    uid: unscopedCustomerPrincipal.uid
  }),
  "PERMISSION_DENIED"
);
await expectCallableError(
  () => callFunction("preflightCustomerOrder", adminPrincipal.idToken, {
    ...createPayload,
    organizationName: "Unverified Direct Owner",
    organizationId: "unverified-direct-owner",
    ownerEmail: "unverified.direct.owner@example.test",
    ownerUid: unverifiedDirectOwner.uid,
    orderId: "unverified-direct-owner-order"
  }),
  "FAILED_PRECONDITION"
);

const provisioned = await callFunction(
  "provisionCustomerOrder",
  adminPrincipal.idToken,
  createPayload
);
assert.equal(provisioned.ok, true);
assert.equal(provisioned.organizationId, organizationId);
assert.equal(provisioned.email?.sent, false);
assert.equal(provisioned.email?.reason, "send_email_disabled");

const orgRef = db.collection("organizations").doc(organizationId);
const settingsRef = orgRef.collection("settings").doc("config");
const orderRef = db.collection("provisioningOrders").doc(createPayload.orderId);
const inviteRef = db.collection("organizationInvites").doc(inviteIdFromEmail(ownerEmail));
const [orgSnap, settingsSnap, orderSnap, inviteSnap] = await Promise.all([
  orgRef.get(),
  settingsRef.get(),
  orderRef.get(),
  inviteRef.get()
]);
assert.equal(orgSnap.exists, true);
assert.equal(settingsSnap.exists, true);
assert.equal(orderSnap.exists, true);
assert.equal(inviteSnap.exists, true);
assert.equal(orgSnap.data()?.active, true);
assert.equal(orgSnap.data()?.archived, false);
assert.equal(orgSnap.data()?.status, "active");
assert.equal(settingsSnap.data()?.brandTagline, "");
assert.equal(settingsSnap.data()?.pricingSetupConfirmed, false);
assert.equal(settingsSnap.data()?.serviceFeePct, 0);
assert.equal(settingsSnap.data()?.taxRate, 0);
assert.equal(settingsSnap.data()?.depositPct, 0);
assert.equal(settingsSnap.data()?.perMileRate, 0);
assert.equal(settingsSnap.data()?.longDistancePerMileRate, 0);
assert.equal(settingsSnap.data()?.bartenderRate, 0);
assert.equal(settingsSnap.data()?.serverRate, 0);
assert.equal(settingsSnap.data()?.chefRate, 0);
assert.equal(settingsSnap.data()?.staffingLaborEnabled, false);
assert.deepEqual(settingsSnap.data()?.eventTemplates, []);
assert.deepEqual(settingsSnap.data()?.upsellRules, []);
assert.equal(settingsSnap.data()?.businessEmail, ownerEmail);
assert.equal((await orgRef.collection("catalogPackages").get()).empty, true);
assert.equal((await orgRef.collection("catalogAddons").get()).empty, true);
assert.equal((await orgRef.collection("catalogRentals").get()).empty, true);
assert.equal((await orgRef.collection("eventTypes").get()).empty, true);
assert.equal(orderSnap.data()?.email?.reason, "send_email_disabled");
const inviteExpiresAtMs = Date.parse(inviteSnap.data()?.expiresAtISO || "");
assert.equal(Number.isFinite(inviteExpiresAtMs), true);
assert.ok(inviteExpiresAtMs > Date.now());
assert.ok(inviteExpiresAtMs <= Date.now() + (8 * 24 * 60 * 60 * 1000));

const resumePreflight = await callFunction(
  "preflightCustomerOrder",
  adminPrincipal.idToken,
  createPayload
);
assert.equal(resumePreflight.orderExists, true);
assert.equal(resumePreflight.canResume, true);
const resumed = await callFunction(
  "provisionCustomerOrder",
  adminPrincipal.idToken,
  createPayload
);
assert.equal(resumed.ok, true);
assert.equal(resumed.resumed, true);
assert.equal(resumed.email?.reason, "send_email_disabled");
const completedOrderEmail = (await orderRef.get()).data()?.email;
await orderRef.update({
  sendEmail: true,
  email: {
    sent: false,
    reason: "send_pending",
    auditPersisted: true,
    dispatchState: "sending",
    dispatchAttemptId: "concurrent-dispatch-attempt",
    dispatchLeaseExpiresAtISO: new Date(Date.now() + 60_000).toISOString()
  }
});
await expectCallableError(
  () => callFunction("provisionCustomerOrder", adminPrincipal.idToken, {
    ...createPayload,
    sendEmail: true
  }),
  "ABORTED"
);
await orderRef.update({
  sendEmail: false,
  email: completedOrderEmail,
  status: "completed"
});
await expectCallableError(
  () => callFunction("provisionCustomerOrder", adminPrincipal.idToken, {
    ...createPayload,
    plan: "enterprise"
  }),
  "ALREADY_EXISTS"
);

const orphanOrderId = "provisioning-e2e-orphan-order";
const orphanOrganizationId = "provisioning-e2e-orphan-org";
const orphanOwnerEmail = "orphan.owner@example.test";
await db.collection("provisioningOrders").doc(orphanOrderId).create({
  ...orderSnap.data(),
  orderId: orphanOrderId,
  organizationId: orphanOrganizationId,
  organizationName: "Orphan Provisioning",
  ownerEmail: orphanOwnerEmail,
  ownerName: "Orphan Owner",
  ownerUid: "",
  appUrl: canonicalAppUrl,
  supportEmail: "",
  sendEmail: false
});
const orphanPayload = {
  ...createPayload,
  organizationName: "Orphan Provisioning",
  organizationId: orphanOrganizationId,
  ownerEmail: orphanOwnerEmail,
  ownerName: "Orphan Owner",
  orderId: orphanOrderId
};
const orphanPreflight = await callFunction(
  "preflightCustomerOrder",
  adminPrincipal.idToken,
  orphanPayload
);
assert.equal(orphanPreflight.orderExists, true);
assert.equal(orphanPreflight.canResume, false);
assert.ok(orphanPreflight.resumeBlockedReasons.includes("organization_missing"));
await expectCallableError(
  () => callFunction("provisionCustomerOrder", adminPrincipal.idToken, orphanPayload),
  "FAILED_PRECONDITION"
);

let acceptanceQuoteId = "";
let acceptancePortalKey = "";
const acceptancePackageId = "customer-owned-package";
const acceptanceEventTypeId = "customer-owned-event-type";
const customerEmail = "portal.customer@example.test";
const catalogConfiguredAtISO = new Date().toISOString();
let invitedOwner = null;
let ownerSession = null;
let reopenedOwnerSession = null;
let publicSession = null;
let bootstrapToken = "";

try {
  ownerSession = createClientSession("invited-owner");
  const ownerCredential = await createUserWithEmailAndPassword(
    ownerSession.auth,
    ownerEmail,
    acceptanceCredential
  );
  invitedOwner = ownerCredential.user;
  assert.equal((await db.collection("userRoles").doc(invitedOwner.uid).get()).exists, false);
  const unverifiedBootstrapToken = await ownerCredential.user.getIdToken();
  await expectCallableError(
    () => callFunction("ensureOrganizationBootstrap", unverifiedBootstrapToken, {}),
    "FAILED_PRECONDITION"
  );
  assert.equal((await db.collection("userRoles").doc(invitedOwner.uid).get()).exists, false);
  assert.equal((await inviteRef.get()).data()?.status, "pending");

  await auth.updateUser(invitedOwner.uid, {
    emailVerified: true
  });
  await ownerCredential.user.reload();
  bootstrapToken = await ownerCredential.user.getIdToken(true);
  const bootstrap = await callFunction("ensureOrganizationBootstrap", bootstrapToken, {});
  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.role, "admin");
  assert.equal(bootstrap.organizationId, organizationId);

  const refreshedToken = await ownerCredential.user.getIdTokenResult(true);
  assert.equal(refreshedToken.claims.role, "admin");
  assert.equal(refreshedToken.claims.organizationId, organizationId);

  const [consumedInviteSnap, ownerRoleSnap] = await Promise.all([
    inviteRef.get(),
    db.collection("userRoles").doc(invitedOwner.uid).get()
  ]);
  assert.equal(consumedInviteSnap.data()?.status, "consumed");
  assert.equal(consumedInviteSnap.data()?.consumedByUid, invitedOwner.uid);
  assert.equal(ownerRoleSnap.data()?.role, "admin");
  assert.equal(ownerRoleSnap.data()?.organizationId, organizationId);

  const ownerSettingsRef = doc(
    ownerSession.db,
    "organizations",
    organizationId,
    "settings",
    "config"
  );
  const ownerPackageRef = doc(
    ownerSession.db,
    "organizations",
    organizationId,
    "catalogPackages",
    acceptancePackageId
  );
  const ownerEventTypeRef = doc(
    ownerSession.db,
    "organizations",
    organizationId,
    "eventTypes",
    acceptanceEventTypeId
  );
  await updateDoc(ownerSettingsRef, {
    brandName: "Customer-Owned Brand",
    brandTagline: "Acceptance events, clearly quoted.",
    businessEmail: "customer-owned@example.test",
    acceptanceEmail: "customer-owned@example.test",
    serviceFeePct: 0.15,
    serviceFeeTiers: [
      {
        id: "owner-standard",
        minGuests: 0,
        maxGuests: 9999,
        pct: 0.15
      }
    ],
    taxRate: 0.08,
    taxRegions: [
      {
        id: "owner-local",
        name: "Owner Local",
        rate: 0.08
      }
    ],
    defaultTaxRegion: "owner-local",
    depositPct: 0.25,
    pricingSetupConfirmed: true
  });
  await setDoc(ownerPackageRef, {
    name: "Customer-Owned Package",
    description: "Acceptance package configured by the invited tenant owner.",
    ppp: 42,
    active: true,
    updatedAtISO: catalogConfiguredAtISO
  });
  await setDoc(ownerEventTypeRef, {
    name: "Customer-Owned Event Type",
    active: true,
    createdAtISO: catalogConfiguredAtISO
  });

  const trustedCreation = await callFunction(
    "createQuoteDraft",
    bootstrapToken,
    {
      organizationId,
      form: {
        name: "Portal Acceptance Customer",
        email: customerEmail,
        phone: "205-555-0177",
        clientOrg: "Acceptance Client",
        eventName: "Acceptance Event",
        date: "2026-08-15",
        time: "18:00",
        hours: 4,
        guests: 100,
        servers: 0,
        chefs: 0,
        bartenders: 0,
        style: "buffet",
        venue: "Acceptance Hall",
        venueAddress: "100 Test Lane",
        dietaryRestrictions: "",
        eventTypeId: acceptanceEventTypeId,
        pkg: acceptancePackageId,
        addons: [],
        rentals: [],
        menuItems: [],
        addonQuantities: {},
        rentalQuantities: {},
        menuItemQuantities: {},
        milesRT: 0,
        payMethod: "card",
        eventTemplateId: "custom",
        taxRegion: "owner-local",
        seasonProfileId: "standard",
        includeDisposables: true
      }
    }
  );
  assert.equal(trustedCreation.ok, true);
  assert.equal(trustedCreation.organizationId, organizationId);
  assert.equal(trustedCreation.activeVersionId, "v0001");
  assert.equal(trustedCreation.latestVersionNumber, 1);
  acceptanceQuoteId = String(trustedCreation.id || "");
  acceptancePortalKey = String(trustedCreation.portalKey || "");
  assert.ok(acceptanceQuoteId);
  assert.match(acceptancePortalKey, /^[a-f0-9]{32}$/);

  const ownerQuoteRef = doc(
    ownerSession.db,
    "organizations",
    organizationId,
    "quotes",
    acceptanceQuoteId
  );
  const ownerPortalRef = doc(
    ownerSession.db,
    "customerPortalQuotes",
    acceptancePortalKey
  );
  const [configuredSettings, configuredPackage, configuredEventType, createdQuote] = await Promise.all([
    getDoc(ownerSettingsRef),
    getDoc(ownerPackageRef),
    getDoc(ownerEventTypeRef),
    getDoc(ownerQuoteRef)
  ]);
  const createdPortalSnap = await db.collection("customerPortalQuotes").doc(acceptancePortalKey).get();
  const initialVersionSnap = await db
    .collection("organizations")
    .doc(organizationId)
    .collection("quotes")
    .doc(acceptanceQuoteId)
    .collection("versions")
    .doc("v0001")
    .get();
  assert.equal(configuredSettings.data()?.brandName, "Customer-Owned Brand");
  assert.equal(configuredSettings.data()?.pricingSetupConfirmed, true);
  assert.equal(configuredSettings.data()?.serviceFeePct, 0.15);
  assert.equal(configuredSettings.data()?.taxRate, 0.08);
  assert.equal(configuredSettings.data()?.depositPct, 0.25);
  assert.equal(configuredPackage.data()?.ppp, 42);
  assert.ok(Number(configuredPackage.data()?.ppp) > 0);
  assert.equal(configuredEventType.data()?.name, "Customer-Owned Event Type");
  assert.equal(createdQuote.data()?.status, "draft");
  assert.equal(createdQuote.data()?.ownerUid, invitedOwner.uid);
  assert.equal(createdQuote.data()?.selection?.packageId, acceptancePackageId);
  assert.equal(createdQuote.data()?.event?.eventTypeId, acceptanceEventTypeId);
  assert.equal(createdQuote.data()?.pricing?.authority, "server_authoritative");
  assert.equal(createdQuote.data()?.totals?.base, 4200);
  assert.equal(createdQuote.data()?.totals?.serviceFee, 630);
  assert.ok(Number(createdQuote.data()?.totals?.tax) > 0);
  assert.equal(
    createdQuote.data()?.totals?.total,
    createdQuote.data()?.pricing?.grandTotal
  );
  assert.equal(createdPortalSnap.data()?.quoteId, acceptanceQuoteId);
  assert.equal(createdPortalSnap.data()?.status, "draft");
  assert.equal(initialVersionSnap.exists, true);
  assert.equal(initialVersionSnap.data()?.snapshot?.pricing?.grandTotal, createdQuote.data()?.pricing?.grandTotal);

  publicSession = createClientSession("public-portal", { withAuth: false });
  const publicDraftPortalRef = doc(
    publicSession.db,
    "customerPortalQuotes",
    acceptancePortalKey
  );
  await assert.rejects(
    () => getDoc(publicDraftPortalRef),
    /permission|denied/i
  );

  const sentAtISO = new Date().toISOString();
  const sentLifecycle = {
    draftAtISO: createdQuote.data()?.lifecycle?.draftAtISO,
    sentAtISO
  };
  const portalIssuedAtISO = String(createdQuote.data()?.portalIssuedAtISO || "");
  const deliveryRevisionId = `v0001@${portalIssuedAtISO}`;
  const deliveryEvidence = {
    revisionId: deliveryRevisionId,
    state: "provider_accepted",
    portalActivationState: "active",
    portalKey: acceptancePortalKey,
    portalIssuedAtISO,
    providerAcceptedAtISO: sentAtISO
  };
  // This emulator-only fixture stands in for an externally accepted provider
  // response. Browser staff writes must never manufacture sent/portal evidence.
  await db.runTransaction(async (transaction) => {
    const quoteRef = db
      .collection("organizations")
      .doc(organizationId)
      .collection("quotes")
      .doc(acceptanceQuoteId);
    const portalRef = db.collection("customerPortalQuotes").doc(acceptancePortalKey);
    const quoteSnapshot = await transaction.get(quoteRef);
    transaction.update(quoteRef, {
      status: "sent",
      updatedAtISO: sentAtISO,
      lifecycle: sentLifecycle,
      workflow: {
        ...(quoteSnapshot.data()?.workflow || {}),
        quoteDelivery: {
          ...deliveryEvidence,
          provider: "resend",
          providerMessageId: "provisioning-emulator-provider-message"
        }
      }
    });
    transaction.update(portalRef, {
      status: "sent",
      updatedAtISO: sentAtISO,
      lifecycle: sentLifecycle,
      deliveryEvidence
    });
  });

  await closeClientSession(ownerSession);
  ownerSession = null;

  reopenedOwnerSession = createClientSession("reopened-owner");
  const reopenedOwnerCredential = await signInWithEmailAndPassword(
    reopenedOwnerSession.auth,
    ownerEmail,
    acceptanceCredential
  );
  await reopenedOwnerCredential.user.getIdToken(true);
  const reopenedQuoteRef = doc(
    reopenedOwnerSession.db,
    "organizations",
    organizationId,
    "quotes",
    acceptanceQuoteId
  );
  const reopenedQuote = await getDoc(reopenedQuoteRef);
  assert.equal(reopenedQuote.exists(), true);
  assert.equal(
    reopenedQuote.data()?.pricing?.grandTotal,
    createdQuote.data()?.pricing?.grandTotal
  );
  assert.equal(reopenedQuote.data()?.pricing?.authority, "server_authoritative");
  assert.equal(reopenedQuote.data()?.selection?.packageId, acceptancePackageId);
  assert.equal(reopenedQuote.data()?.event?.eventTypeId, acceptanceEventTypeId);
  assert.equal(reopenedQuote.data()?.status, "sent");

  const publicPortalRef = doc(
    publicSession.db,
    "customerPortalQuotes",
    acceptancePortalKey
  );
  const publicQuoteRef = doc(
    publicSession.db,
    "organizations",
    organizationId,
    "quotes",
    acceptanceQuoteId
  );
  const acceptedAtISO = new Date().toISOString();
  const acceptedDecision = {
    decision: "accepted",
    message: "",
    requestId: "portal-decision-provisioning-acceptance-0001",
    submittedAtISO: acceptedAtISO
  };
  const acceptedPatch = {
    status: "accepted",
    updatedAtISO: acceptedAtISO,
    lifecycle: {
      ...sentLifecycle,
      acceptedAtISO
    },
    portalDecision: acceptedDecision
  };
  const activePublicPortal = await getDoc(publicPortalRef);
  assert.equal(activePublicPortal.exists(), true);
  assert.equal(activePublicPortal.data()?.status, "sent");
  assert.equal(
    activePublicPortal.data()?.portalExpiresAtISO,
    trustedCreation.portalExpiresAtISO
  );
  const acceptanceBatch = writeBatch(publicSession.db);
  acceptanceBatch.update(publicPortalRef, acceptedPatch);
  acceptanceBatch.update(publicQuoteRef, acceptedPatch);
  await acceptanceBatch.commit();

  const [acceptedPortal, acceptedQuote] = await Promise.all([
    getDoc(publicPortalRef),
    getDoc(reopenedQuoteRef)
  ]);
  assert.equal(acceptedPortal.data()?.status, "accepted");
  assert.deepEqual(acceptedPortal.data()?.portalDecision, acceptedDecision);
  assert.equal(acceptedQuote.data()?.status, "accepted");
  assert.deepEqual(acceptedQuote.data()?.portalDecision, acceptedDecision);
} finally {
  await Promise.allSettled([
    closeClientSession(ownerSession),
    closeClientSession(reopenedOwnerSession),
    closeClientSession(publicSession)
  ]);
}

const updatePayload = {
  organizationId,
  plan: "starter",
  orderId: "provisioning-e2e-update-001",
  updateExistingOrganization: true
};
const updatePreflight = await callFunction(
  "preflightCustomerOrder",
  adminPrincipal.idToken,
  updatePayload
);
assert.equal(updatePreflight.canUpdate, true);
assert.equal(updatePreflight.currentPlan, "growth");

const updated = await callFunction(
  "provisionCustomerOrder",
  adminPrincipal.idToken,
  updatePayload
);
assert.equal(updated.operation, "updated_entitlements");
assert.equal(updated.email?.reason, "existing_org_update");

const [settingsAfter, packageAfter, inviteAfter] = await Promise.all([
  settingsRef.get(),
  orgRef.collection("catalogPackages").doc("customer-owned-package").get(),
  inviteRef.get()
]);
assert.equal(settingsAfter.data()?.brandName, "Customer-Owned Brand");
assert.equal(settingsAfter.data()?.businessEmail, "customer-owned@example.test");
assert.equal(packageAfter.exists, true);
assert.equal(inviteAfter.data()?.orderId, createPayload.orderId);
assert.equal(settingsAfter.data()?.plan, "starter");

const tenantMember = await createPrincipal({
  email: "member.provisioning@example.test",
  role: "sales",
  organizationId
});
await db.collection("userRoles").doc(tenantMember.uid).update({
  email: "forged-audit-actor@example.test"
});
await expectCallableError(
  () => callFunction("notifyOwnerNewQuote", tenantMember.idToken, {
    quoteId: acceptanceQuoteId
  }),
  "PERMISSION_DENIED"
);
await db.collection("userRoles").doc(tenantMember.uid).update({
  email: "member.provisioning@example.test"
});
await expectCallableError(
  () => callFunction("requestQuoteApproval", tenantMember.idToken, {
    organizationId,
    quoteId: acceptanceQuoteId,
    action: "forged_action"
  }),
  "INVALID_ARGUMENT"
);
const approvalRequested = await callFunction(
  "requestQuoteApproval",
  tenantMember.idToken,
  {
    organizationId,
    quoteId: acceptanceQuoteId,
    action: "delete_quote",
    note: "Duplicate quote requires admin cleanup."
  }
);
assert.equal(approvalRequested.ok, true);
assert.equal(approvalRequested.request?.state, "pending");
assert.equal(
  approvalRequested.request?.requestedByEmail,
  "member.provisioning@example.test"
);
await expectCallableError(
  () => callFunction("requestQuoteApproval", tenantMember.idToken, {
    organizationId,
    quoteId: acceptanceQuoteId,
    action: "delete_quote"
  }),
  "ALREADY_EXISTS"
);
await expectCallableError(
  () => callFunction("resolveQuoteApprovalRequest", tenantMember.idToken, {
    organizationId,
    quoteId: acceptanceQuoteId,
    requestId: approvalRequested.request.id,
    state: "approved"
  }),
  "PERMISSION_DENIED"
);
const approvalResolved = await callFunction(
  "resolveQuoteApprovalRequest",
  bootstrapToken,
  {
    organizationId,
    quoteId: acceptanceQuoteId,
    requestId: approvalRequested.request.id,
    state: "approved",
    resolutionNote: "Approved for a separate audited admin action."
  }
);
assert.equal(approvalResolved.ok, true);
assert.equal(approvalResolved.request?.state, "approved");
assert.equal(approvalResolved.request?.resolvedByEmail, ownerEmail);
assert.equal(
  (await orgRef.collection("quotes").doc(acceptanceQuoteId).get())
    .data()?.workflow?.approvalRequests?.[0]?.id,
  approvalRequested.request.id
);
await expectCallableError(
  () => callFunction("resolveQuoteApprovalRequest", bootstrapToken, {
    organizationId,
    quoteId: acceptanceQuoteId,
    requestId: approvalRequested.request.id,
    state: "rejected"
  }),
  "FAILED_PRECONDITION"
);
async function requestAndApproveQuoteAction(quoteId, action, note = "Approved emulator action.") {
  const requested = await callFunction("requestQuoteApproval", tenantMember.idToken, {
    organizationId,
    quoteId,
    action,
    note
  });
  assert.equal(requested.ok, true);
  const resolved = await callFunction("resolveQuoteApprovalRequest", bootstrapToken, {
    organizationId,
    quoteId,
    requestId: requested.request.id,
    state: "approved",
    resolutionNote: "Approved for exact server execution."
  });
  assert.equal(resolved.request?.executionState, "awaiting_execution");
  return resolved.request;
}

const contractApproval = await requestAndApproveQuoteAction(
  acceptanceQuoteId,
  "convert_to_contract",
  "Customer acceptance is ready for contract conversion."
);
const contractConverted = await callFunction("convertQuoteToContract", bootstrapToken, {
  organizationId,
  quoteId: acceptanceQuoteId,
  approvalRequestId: contractApproval.id
});
assert.equal(contractConverted.ok, true);
assert.equal(contractConverted.status, "booked");
assert.equal(contractConverted.approvalRequest?.executionState, "succeeded");
assert.equal(
  (await orgRef.collection("quotes").doc(acceptanceQuoteId).get())
    .data()?.workflow?.approvalRequests
    ?.find((item) => item.id === contractApproval.id)
    ?.executionState,
  "succeeded"
);
const repeatedContractConversion = await callFunction(
  "convertQuoteToContract",
  bootstrapToken,
  {
    organizationId,
    quoteId: acceptanceQuoteId,
    approvalRequestId: contractApproval.id
  }
);
assert.equal(repeatedContractConversion.idempotent, true);

const rotationFixture = await callFunction("duplicateQuoteDraft", bootstrapToken, {
  organizationId,
  sourceQuoteId: acceptanceQuoteId
});
assert.equal(rotationFixture.ok, true);
const successfulRotateApproval = await requestAndApproveQuoteAction(
  rotationFixture.id,
  "rotate_portal_link",
  "Rotate the duplicate quote portal before customer delivery."
);
const successfulRotation = await callFunction("rotateQuotePortalKey", bootstrapToken, {
  organizationId,
  quoteId: rotationFixture.id,
  approvalRequestId: successfulRotateApproval.id
});
assert.equal(successfulRotation.ok, true);
assert.equal(successfulRotation.approvalRequest?.executionState, "succeeded");
const repeatedRotation = await callFunction("rotateQuotePortalKey", bootstrapToken, {
  organizationId,
  quoteId: rotationFixture.id,
  approvalRequestId: successfulRotateApproval.id
});
assert.equal(repeatedRotation.idempotent, true);

const paymentRequestApproval = await requestAndApproveQuoteAction(
  acceptanceQuoteId,
  "send_payment_request",
  "Send the accepted deposit request."
);
await expectCallableError(
  () => callFunction("notifyOwnerNewQuote", tenantMember.idToken, {
    quoteId: acceptanceQuoteId
  }),
  "PERMISSION_DENIED"
);
await expectCallableError(
  () => callFunction("sendQuoteToCustomer", tenantMember.idToken, {
    quoteId: acceptanceQuoteId
  }),
  "PERMISSION_DENIED"
);
await expectCallableError(
  () => callFunction("getIntegrationSetupStatus", tenantMember.idToken, {}),
  "PERMISSION_DENIED"
);
await expectCallableError(
  () => callFunction("sendIntegrationTestSms", tenantMember.idToken, {}),
  "PERMISSION_DENIED"
);
await expectCallableError(
  () => callFunction("createDepositCheckout", tenantMember.idToken, {
    organizationId,
    quoteId: acceptanceQuoteId
  }),
  "PERMISSION_DENIED"
);
await expectCallableError(
  () => callFunction("sendPaymentRequestEmail", tenantMember.idToken, {
    organizationId,
    quoteId: acceptanceQuoteId
  }),
  "PERMISSION_DENIED"
);
await expectCallableError(
  () => callFunction("notifyOwnerNewQuote", bootstrapToken, {
    quoteId: acceptanceQuoteId,
    portalLink: "https://attacker.example.test/quote"
  }),
  "INVALID_ARGUMENT"
);
await expectCallableError(
  () => callFunction("sendQuoteToCustomer", bootstrapToken, {
    quoteId: acceptanceQuoteId,
    portalLink: "https://attacker.example.test/quote"
  }),
  "INVALID_ARGUMENT"
);
await expectCallableError(
  () => callFunction("sendPaymentRequestEmail", bootstrapToken, {
    quoteId: acceptanceQuoteId,
    paymentLink: "https://attacker.example.test/pay"
  }),
  "INVALID_ARGUMENT"
);
await expectCallableError(
  () => callFunction("createDepositCheckout", bootstrapToken, {
    quoteId: acceptanceQuoteId,
    successUrl: "https://attacker.example.test/success",
    cancelUrl: "https://attacker.example.test/cancel"
  }),
  "INVALID_ARGUMENT"
);

const acceptanceQuoteRef = orgRef.collection("quotes").doc(acceptanceQuoteId);
const acceptancePortalRef = db.collection("customerPortalQuotes").doc(acceptancePortalKey);
const [paymentQuoteBefore, paymentPortalBefore] = await Promise.all([
  acceptanceQuoteRef.get(),
  acceptancePortalRef.get()
]);
assert.equal(paymentQuoteBefore.exists, true);
assert.equal(paymentPortalBefore.exists, true);
await acceptanceQuoteRef.set({
  payment: {
    ...(paymentQuoteBefore.data()?.payment || {}),
    depositLink: "https://label@checkout.stripe.com/c/pay/rejected",
    depositStatus: "sent"
  }
}, { merge: true });
await expectCallableError(
  () => callFunction("sendPaymentRequestEmail", bootstrapToken, {
    organizationId,
    quoteId: acceptanceQuoteId,
    approvalRequestId: paymentRequestApproval.id
  }),
  "FAILED_PRECONDITION"
);
await acceptanceQuoteRef.set({
  payment: paymentQuoteBefore.data()?.payment || {}
}, { merge: true });
const paymentSessionId = "cs_test_quotepilot_acceptance";
const paymentEventId = "evt_quotepilot_acceptance";
const paymentLink = "https://checkout.stripe.com/c/pay/quotepilot-acceptance";
const expectedDepositCents = Math.round(
  Number(paymentQuoteBefore.data()?.totals?.deposit || 0) * 100
);
assert.ok(expectedDepositCents > 0);
const paymentStateSent = {
  ...(paymentQuoteBefore.data()?.payment || {}),
  depositLink: paymentLink,
  depositStatus: "sent",
  depositConfirmedAtISO: "",
  stripeSessionId: paymentSessionId
};
await acceptanceQuoteRef.set({
  payment: paymentStateSent
}, { merge: true });
await expectCallableError(
  () => callFunction("sendPaymentRequestEmail", bootstrapToken, {
    organizationId,
    quoteId: acceptanceQuoteId,
    approvalRequestId: paymentRequestApproval.id
  }),
  "FAILED_PRECONDITION"
);
assert.equal(
  (await acceptanceQuoteRef.get())
    .data()?.workflow?.approvalRequests
    ?.find((item) => item.id === paymentRequestApproval.id)
    ?.executionState,
  "failed"
);
const rotateApproval = await requestAndApproveQuoteAction(
  acceptanceQuoteId,
  "rotate_portal_link",
  "Rotate the customer portal after review."
);
await expectCallableError(
  () => callFunction("rotateQuotePortalKey", bootstrapToken, {
    organizationId,
    quoteId: acceptanceQuoteId,
    approvalRequestId: rotateApproval.id
  }),
  "FAILED_PRECONDITION"
);
await acceptancePortalRef.set({
  ...paymentPortalBefore.data(),
  payment: paymentStateSent,
  quoteId: "foreign-quote",
  organizationId: "foreign-organization",
  portalKey: acceptancePortalKey
}, { merge: false });

const paymentEvent = {
  id: paymentEventId,
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: paymentSessionId,
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      currency: "usd",
      amount_total: expectedDepositCents,
      metadata: {
        quoteId: acceptanceQuoteId,
        organizationId,
        portalKey: acceptancePortalKey
      }
    }
  }
};
const corruptPortalPaymentAttempt = await callStripeWebhook(paymentEvent);
assert.equal(
  corruptPortalPaymentAttempt.status,
  500,
  corruptPortalPaymentAttempt.responseText
);
assert.equal(
  (await db.collection("webhookEvents").doc(`stripe-${paymentEventId}`).get()).exists,
  false
);
assert.equal((await acceptanceQuoteRef.get()).data()?.payment?.depositStatus, "sent");
assert.equal((await acceptancePortalRef.get()).data()?.quoteId, "foreign-quote");

await acceptancePortalRef.set({
  ...paymentPortalBefore.data(),
  payment: paymentStateSent
}, { merge: false });
const underpaidAttempt = await callStripeWebhook({
  ...paymentEvent,
  data: {
    object: {
      ...paymentEvent.data.object,
      amount_total: expectedDepositCents - 1
    }
  }
});
assert.equal(underpaidAttempt.status, 500, underpaidAttempt.responseText);
assert.equal(
  (await db.collection("webhookEvents").doc(`stripe-${paymentEventId}`).get()).exists,
  false
);
assert.equal((await acceptanceQuoteRef.get()).data()?.payment?.depositStatus, "sent");

const paidAttempt = await callStripeWebhook(paymentEvent);
assert.equal(paidAttempt.status, 200, paidAttempt.responseText);
assert.equal(paidAttempt.payload?.received, true);
const [paidQuote, paidPortal, processedPaymentEvent] = await Promise.all([
  acceptanceQuoteRef.get(),
  acceptancePortalRef.get(),
  db.collection("webhookEvents").doc(`stripe-${paymentEventId}`).get()
]);
assert.equal(paidQuote.data()?.payment?.depositStatus, "paid");
assert.equal(paidPortal.data()?.payment?.depositStatus, "paid");
assert.equal(processedPaymentEvent.data()?.status, "processed");
await expectCallableError(
  () => callFunction("createDepositCheckout", bootstrapToken, {
    organizationId,
    quoteId: acceptanceQuoteId
  }),
  "FAILED_PRECONDITION"
);
const duplicatePaidAttempt = await callStripeWebhook(paymentEvent);
assert.equal(duplicatePaidAttempt.status, 200);
assert.equal(duplicatePaidAttempt.payload?.duplicate, true);

const isolatedCleanupQuoteId = "isolated-cleanup-quote";
const isolatedCleanupPortalKey = "isolated-cleanup-own-portal-key";
const foreignCleanupPortalKey = "isolated-cleanup-foreign-portal-key";
const legacyCollisionPortalKey = "isolated-cleanup-legacy-collision-key";
const provenLegacyFallbackPortalKey = "isolated-cleanup-proven-legacy-key";
const mismatchedFallbackPortalKey = "isolated-cleanup-mismatched-fallback";
await orgRef.collection("quotes").doc(isolatedCleanupQuoteId).create({
  organizationId,
  ownerUid: tenantMember.uid,
  portalKey: provenLegacyFallbackPortalKey,
  status: "sent"
});
await db.collection("customerPortalQuotes").doc(isolatedCleanupPortalKey).create({
  portalKey: isolatedCleanupPortalKey,
  quoteId: isolatedCleanupQuoteId,
  organizationId,
  status: "sent"
});
await db.collection("customerPortalQuotes").doc(foreignCleanupPortalKey).create({
  portalKey: foreignCleanupPortalKey,
  quoteId: isolatedCleanupQuoteId,
  organizationId: "another-organization",
  status: "sent"
});
await db.collection("customerPortalQuotes").doc(legacyCollisionPortalKey).create({
  portalKey: legacyCollisionPortalKey,
  quoteId: isolatedCleanupQuoteId,
  status: "sent"
});
await db.collection("customerPortalQuotes").doc(provenLegacyFallbackPortalKey).create({
  portalKey: provenLegacyFallbackPortalKey,
  quoteId: isolatedCleanupQuoteId,
  status: "sent"
});
const mismatchedFallbackQuoteId = "mismatched-fallback-cleanup-quote";
await orgRef.collection("quotes").doc(mismatchedFallbackQuoteId).create({
  organizationId,
  ownerUid: tenantMember.uid,
  portalKey: mismatchedFallbackPortalKey,
  status: "sent"
});
await db.collection("customerPortalQuotes").doc(mismatchedFallbackPortalKey).create({
  portalKey: mismatchedFallbackPortalKey,
  quoteId: "another-quote",
  organizationId,
  status: "sent"
});
const isolatedDeleteApproval = await requestAndApproveQuoteAction(
  isolatedCleanupQuoteId,
  "delete_quote",
  "Remove the isolated cleanup fixture."
);
const isolatedCleanup = await callFunction(
  "hardDeleteQuote",
  bootstrapToken,
  {
    organizationId,
    quoteId: isolatedCleanupQuoteId,
    approvalRequestId: isolatedDeleteApproval.id
  }
);
assert.equal(isolatedCleanup.ok, true);
assert.equal(isolatedCleanup.portalSnapshotsDeleted, 2);
const repeatedIsolatedCleanup = await callFunction(
  "hardDeleteQuote",
  bootstrapToken,
  {
    organizationId,
    quoteId: isolatedCleanupQuoteId,
    approvalRequestId: isolatedDeleteApproval.id
  }
);
assert.equal(repeatedIsolatedCleanup.idempotent, true);
assert.equal(
  (await orgRef.collection("quotes").doc(isolatedCleanupQuoteId).get()).exists,
  false
);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(isolatedCleanupPortalKey).get()).exists,
  false
);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(foreignCleanupPortalKey).get()).exists,
  true
);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(legacyCollisionPortalKey).get()).exists,
  true
);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(provenLegacyFallbackPortalKey).get()).exists,
  false
);
const mismatchedDeleteApproval = await requestAndApproveQuoteAction(
  mismatchedFallbackQuoteId,
  "delete_quote",
  "Remove the mismatched fallback cleanup fixture."
);
const mismatchedFallbackCleanup = await callFunction(
  "hardDeleteQuote",
  bootstrapToken,
  {
    organizationId,
    quoteId: mismatchedFallbackQuoteId,
    approvalRequestId: mismatchedDeleteApproval.id
  }
);
assert.equal(mismatchedFallbackCleanup.ok, true);
assert.equal(mismatchedFallbackCleanup.portalSnapshotsDeleted, 0);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(mismatchedFallbackPortalKey).get()).exists,
  true
);
const portalKey = "provisioning-e2e-portal-key-abcdefghijklmnopqrstuvwxyz";
await orgRef.collection("quotes").doc("cleanup-quote").create({
  organizationId,
  ownerUid: tenantMember.uid,
  portalKey,
  status: "sent"
});
await db.collection("customerPortalQuotes").doc(portalKey).create({
  portalKey,
  quoteId: "cleanup-quote",
  organizationId,
  status: "sent",
  portalExpiresAtMs: Date.now() + 86_400_000
});
const organizationLegacyPortalKey = "organization-cleanup-proven-legacy-key";
await orgRef.collection("quotes").doc("organization-legacy-quote").create({
  organizationId,
  ownerUid: tenantMember.uid,
  portalKey: organizationLegacyPortalKey,
  status: "sent"
});
await db.collection("customerPortalQuotes").doc(organizationLegacyPortalKey).create({
  portalKey: organizationLegacyPortalKey,
  quoteId: "organization-legacy-quote",
  status: "sent"
});
const foreignOrganizationPortalKey = "organization-cleanup-foreign-token";
await orgRef.collection("quotes").doc("corrupt-foreign-reference").create({
  organizationId,
  ownerUid: tenantMember.uid,
  portalKey: foreignOrganizationPortalKey,
  status: "sent"
});
await db.collection("customerPortalQuotes").doc(foreignOrganizationPortalKey).create({
  portalKey: foreignOrganizationPortalKey,
  quoteId: "foreign-quote",
  organizationId: "another-organization",
  status: "sent"
});

await callFunction("archiveOrganizationWorkspace", adminPrincipal.idToken, {
  organizationId,
  confirmationToken: `ARCHIVE ${organizationId}`
});
const archivedPreflight = await callFunction(
  "preflightCustomerOrder",
  adminPrincipal.idToken,
  {
    organizationId,
    plan: "enterprise",
    orderId: "provisioning-e2e-archived-update",
    updateExistingOrganization: true
  }
);
assert.equal(archivedPreflight.unsafeResidue, true);
assert.equal(archivedPreflight.canUpdate, false);
await expectCallableError(
  () => callFunction("provisionCustomerOrder", adminPrincipal.idToken, {
    organizationId,
    plan: "enterprise",
    orderId: "provisioning-e2e-archived-update",
    updateExistingOrganization: true
  }),
  "FAILED_PRECONDITION"
);
const deleted = await callFunction("deleteOrganizationWorkspace", adminPrincipal.idToken, {
  organizationId,
  confirmationToken: `DELETE ${organizationId}`
});
assert.equal(deleted.ok, true);
assert.equal((await orgRef.get()).exists, false);
assert.equal((await inviteRef.get()).exists, false);
assert.equal((await db.collection("userRoles").doc(tenantMember.uid).get()).exists, false);
assert.equal((await db.collection("userRoles").doc(invitedOwner.uid).get()).exists, false);
assert.equal((await db.collection("userRoles").doc(adminPrincipal.uid).get()).exists, true);
assert.equal((await db.collection("customerPortalQuotes").doc(portalKey).get()).exists, false);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(organizationLegacyPortalKey).get()).exists,
  false
);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(foreignOrganizationPortalKey).get()).exists,
  true
);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(legacyCollisionPortalKey).get()).exists,
  true
);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(acceptancePortalKey).get()).exists,
  false
);
assert.equal((await db.collection("organizationTombstones").doc(organizationId).get()).data()?.state, "deleted");

await db.collection("userRoles").doc(tenantMember.uid).create({
  role: "admin",
  email: "member.provisioning@example.test",
  organizationId
});
await expectCallableError(
  () => callFunction("ensureOrganizationBootstrap", tenantMember.idToken, {}),
  "FAILED_PRECONDITION"
);
assert.equal((await orgRef.get()).exists, false);

console.log("Provisioning emulator acceptance passed.");
console.log("- sales denied");
console.log("- tenant admin denied commercial provisioning authority");
console.log("- inactive and suspended organizations were denied bootstrap and callable authority");
console.log("- server rejected a non-canonical onboarding application URL");
console.log("- direct owner UID assignment rejected an unverified Auth email");
console.log("- stale admin/platform token claims could not outrank a downgraded role document");
console.log("- tenant admin could not synchronize claims for an unscoped principal");
console.log("- explicit allowlisted platform admin authorized");
console.log("- new organization created with a blank catalog and without default email send");
console.log("- matching order resumed idempotently; concurrent dispatch, conflicting, and artifact-incomplete replays rejected");
console.log("- invited owner claimed the tenant, configured branding and a non-zero package, and reopened a saved quote");
console.log("- unverified owner could not consume the admin invite; verified email was required");
console.log("- pending owner invite received a bounded server-authored expiry");
console.log("- unauthenticated portal client accepted the quote and persisted the decision to both quote copies");
console.log("- entitlement-only update preserved branding, catalog, and invite");
console.log("- approval requests, resolutions, and exact admin executions used server-owned identity, outcomes, idempotency, and replay protection");
console.log("- archived tenant resume/update was blocked");
console.log("- quote cleanup preserved cross-tenant, unscoped, and mismatched portal rows");
console.log("- provider/payment operations denied sales and rejected caller-supplied links");
console.log("- Stripe webhook rejected corrupt portals and underpayment, then atomically accepted and deduplicated the exact paid session");
console.log("- hard delete retired roles/invites/portal snapshots and tombstone blocked tenant resurrection");
