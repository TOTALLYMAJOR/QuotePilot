#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
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

async function signInEmulatorUser(email) {
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
  return payload.idToken;
}

async function createBuyerWithoutRole(email, { emailVerified = false } = {}) {
  const user = await auth.createUser({
    email,
    password: acceptanceCredential,
    emailVerified
  });
  assert.equal((await db.collection("userRoles").doc(user.uid).get()).exists, false);
  return {
    email,
    idToken: await signInEmulatorUser(email),
    uid: user.uid
  };
}

async function callFunction(name, idToken, data = {}) {
  const headers = {
    "Content-Type": "application/json",
    Origin: "http://localhost:4174"
  };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const response = await fetch(
    `http://${functionsHost}/${projectId}/${region}/${name}`,
    {
      method: "POST",
      headers,
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

async function callStripeWebhook(event, { signingSecret = "" } = {}) {
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  assert.ok(webhookSecret, "STRIPE_WEBHOOK_SECRET is required for webhook acceptance.");
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", signingSecret || webhookSecret)
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

async function callBuyerAccessStripeWebhook(event, { signingSecret = "" } = {}) {
  const webhookSecret = String(
    process.env.BUYER_ACCESS_STRIPE_WEBHOOK_SECRET || ""
  ).trim();
  assert.ok(
    webhookSecret,
    "BUYER_ACCESS_STRIPE_WEBHOOK_SECRET is required for buyer webhook acceptance."
  );
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", signingSecret || webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const response = await fetch(
    `http://${functionsHost}/${projectId}/${region}/buyerAccessStripeWebhook`,
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
const acceptanceCategoryId = "customer-owned-category";
const acceptanceMenuItemId = "customer-owned-menu-item";
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
  const ownerCategoryRef = doc(
    ownerSession.db,
    "organizations",
    organizationId,
    "menuCategories",
    acceptanceCategoryId
  );
  const ownerMenuItemRef = doc(
    ownerSession.db,
    "organizations",
    organizationId,
    "menuItems",
    acceptanceMenuItemId
  );
  const writeOwnerCatalogRecord = async (targetRef, record, settingsPatch = {}) => {
    const settingsSnapshot = await getDoc(ownerSettingsRef);
    assert.equal(settingsSnapshot.exists(), true);
    const currentCatalogRevision = Number(settingsSnapshot.data()?.catalogRevision || 0);
    assert.ok(Number.isInteger(currentCatalogRevision) && currentCatalogRevision >= 0);
    const batch = writeBatch(ownerSession.db);
    batch.update(ownerSettingsRef, {
      ...settingsPatch,
      catalogRevision: currentCatalogRevision + 1,
      pricingSetupConfirmed: false,
      pricingConfirmation: null
    });
    batch.set(targetRef, record);
    await batch.commit();
  };
  await writeOwnerCatalogRecord(ownerPackageRef, {
    name: "Customer-Owned Package",
    description: "Acceptance package configured by the invited tenant owner.",
    ppp: 42,
    active: true,
    updatedAtISO: catalogConfiguredAtISO
  }, {
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
    depositPct: 0.25
  });
  await writeOwnerCatalogRecord(ownerEventTypeRef, {
    name: "Customer-Owned Event Type",
    active: true,
    createdAtISO: catalogConfiguredAtISO
  });
  await writeOwnerCatalogRecord(ownerCategoryRef, {
    name: "Customer-Owned Entrées",
    eventTypeId: acceptanceEventTypeId,
    createdAtISO: catalogConfiguredAtISO
  });
  await writeOwnerCatalogRecord(ownerMenuItemRef, {
    name: "Customer-Owned Entrée",
    eventTypeId: acceptanceEventTypeId,
    categoryId: acceptanceCategoryId,
    priceMinor: 0,
    pricingType: "per_event",
    type: "per_event",
    active: true,
    createdAtISO: catalogConfiguredAtISO
  });
  const configuredSettingsSnapshot = await getDoc(ownerSettingsRef);
  const configuredCatalogRevision = Number(
    configuredSettingsSnapshot.data()?.catalogRevision || 0
  );
  assert.ok(Number.isInteger(configuredCatalogRevision) && configuredCatalogRevision > 0);
  const confirmedPricing = await callFunction(
    "confirmCatalogPricing",
    bootstrapToken,
    {
      organizationId,
      expectedCatalogRevision: configuredCatalogRevision
    }
  );
  assert.equal(confirmedPricing.ok, true);
  assert.equal(confirmedPricing.confirmedCatalogRevision, configuredCatalogRevision);

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
        menuItems: [acceptanceMenuItemId],
        addonQuantities: {},
        rentalQuantities: {},
        menuItemQuantities: {
          [acceptanceMenuItemId]: 1
        },
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
  assert.equal(configuredSettings.data()?.pricingConfirmation?.actorUid, invitedOwner.uid);
  assert.equal(
    configuredSettings.data()?.pricingConfirmation?.confirmedCatalogRevision,
    configuredCatalogRevision
  );
  assert.equal(configuredSettings.data()?.serviceFeePct, 0.15);
  assert.equal(configuredSettings.data()?.taxRate, 0.08);
  assert.equal(configuredSettings.data()?.depositPct, 0.25);
  assert.equal(configuredPackage.data()?.pppMinor, 4200);
  assert.equal(configuredPackage.data()?.ppp, undefined);
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
  const forgedAcceptedAtISO = new Date().toISOString();
  const forgedAcceptedPatch = {
    status: "accepted",
    updatedAtISO: forgedAcceptedAtISO,
    lifecycle: {
      ...sentLifecycle,
      acceptedAtISO: forgedAcceptedAtISO
    },
    portalDecision: {
      decision: "accepted",
      message: "",
      requestId: "portal-decision-provisioning-acceptance-0001",
      submittedAtISO: forgedAcceptedAtISO
    }
  };
  const activePublicPortal = await getDoc(publicPortalRef);
  assert.equal(activePublicPortal.exists(), true);
  assert.equal(activePublicPortal.data()?.status, "sent");
  assert.equal(
    activePublicPortal.data()?.portalExpiresAtISO,
    trustedCreation.portalExpiresAtISO
  );
  const acceptanceBatch = writeBatch(publicSession.db);
  acceptanceBatch.update(publicPortalRef, forgedAcceptedPatch);
  acceptanceBatch.update(publicQuoteRef, forgedAcceptedPatch);
  await assert.rejects(() => acceptanceBatch.commit(), /permission|denied/i);

  const acceptanceResult = await callFunction("acceptQuoteProposal", "", {
    portalKey: acceptancePortalKey,
    signerName: "Provisioning Customer",
    consentVersion: "proposal-acceptance-v1",
    expectedRevisionId: deliveryRevisionId,
    expectedPortalIssuedAtISO: portalIssuedAtISO,
    message: "Approved in emulator acceptance."
  });
  assert.equal(acceptanceResult.ok, true);
  assert.equal(acceptanceResult.status, "accepted");
  assert.equal(acceptanceResult.acceptanceReceipt?.signerName, "Provisioning Customer");
  assert.equal(acceptanceResult.acceptanceReceipt?.quoteRevisionId, deliveryRevisionId);
  assert.equal(Number.isInteger(acceptanceResult.acceptanceReceipt?.totalMinor), true);
  assert.match(acceptanceResult.acceptanceReceipt?.snapshotSha256 || "", /^[a-f0-9]{64}$/);

  const [acceptedPortal, acceptedQuote] = await Promise.all([
    getDoc(publicPortalRef),
    getDoc(reopenedQuoteRef)
  ]);
  assert.equal(acceptedPortal.data()?.status, "accepted");
  assert.deepEqual(acceptedPortal.data()?.portalDecision, acceptanceResult.portalDecision);
  assert.deepEqual(acceptedPortal.data()?.acceptanceReceipt, acceptanceResult.acceptanceReceipt);
  assert.equal(acceptedQuote.data()?.status, "accepted");
  assert.deepEqual(acceptedQuote.data()?.portalDecision, acceptanceResult.portalDecision);
  assert.deepEqual(acceptedQuote.data()?.acceptanceReceipt, acceptanceResult.acceptanceReceipt);
  const acceptanceReceipt = await db
    .collection("organizations")
    .doc(organizationId)
    .collection("proposalAcceptanceReceipts")
    .doc(acceptanceResult.acceptanceReceipt.receiptId)
    .get();
  assert.equal(acceptanceReceipt.exists, true);
  assert.equal(acceptanceReceipt.data()?.totalMinor, acceptanceResult.acceptanceReceipt.totalMinor);
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
const convertedCanonicalQuoteSnap = await orgRef
  .collection("quotes")
  .doc(acceptanceQuoteId)
  .get();
const convertedCanonicalQuote = convertedCanonicalQuoteSnap.data();
const convertedVersionSnap = await orgRef
  .collection("quotes")
  .doc(acceptanceQuoteId)
  .collection("versions")
  .doc(contractConverted.versionId)
  .get();
assert.equal(convertedVersionSnap.exists, true);
assert.ok(convertedCanonicalQuote?.customerId);
assert.equal(
  convertedVersionSnap.data()?.customerId,
  convertedCanonicalQuote.customerId
);
assert.equal(
  convertedVersionSnap.data()?.snapshot?.customerId,
  convertedCanonicalQuote.customerId
);
assert.equal(
  convertedCanonicalQuote?.workflow?.approvalRequests
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
  stripeSessionId: paymentSessionId,
  stripeCheckoutState: "open",
  checkoutGeneration: 1,
  knownStripeSessionIds: [paymentSessionId]
};
const orphanedPreparedPayment = {
  ...paymentStateSent,
  depositLink: "",
  depositStatus: "unpaid",
  stripeCheckoutState: "prepared"
};
await acceptanceQuoteRef.set({
  payment: orphanedPreparedPayment
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
await acceptanceQuoteRef.set({
  payment: paymentStateSent
}, { merge: true });
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
  livemode: false,
  data: {
    object: {
      id: paymentSessionId,
      object: "checkout.session",
      livemode: false,
      mode: "payment",
      status: "complete",
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
const invalidSignatureEvent = {
  ...paymentEvent,
  id: "evt_quotepilot_invalid_signature"
};
const invalidSignatureAttempt = await callStripeWebhook(invalidSignatureEvent, {
  signingSecret: "whsec_intentionally_invalid_fixture"
});
assert.equal(invalidSignatureAttempt.status, 400, invalidSignatureAttempt.responseText);
assert.equal(
  (await db.collection("webhookEvents").doc(`stripe-${invalidSignatureEvent.id}`).get()).exists,
  false
);
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

const stalePaidSessionId = "cs_test_quotepilot_stale_paid";
await Promise.all([
  acceptanceQuoteRef.update({
    "payment.knownStripeSessionIds": [stalePaidSessionId, paymentSessionId]
  }),
  acceptancePortalRef.update({
    "payment.knownStripeSessionIds": [stalePaidSessionId, paymentSessionId]
  })
]);
const stalePaidEvent = {
  ...paymentEvent,
  id: "evt_quotepilot_stale_paid",
  data: {
    object: {
      ...paymentEvent.data.object,
      id: stalePaidSessionId,
      amount_total: expectedDepositCents + 123,
      metadata: {
        ...paymentEvent.data.object.metadata,
        portalKey: "retired-portal-key"
      }
    }
  }
};
const stalePaidAttempt = await callStripeWebhook(stalePaidEvent);
assert.equal(stalePaidAttempt.status, 200, stalePaidAttempt.responseText);
assert.equal(stalePaidAttempt.payload?.ignored, "stale_paid_requires_review");
const [quoteAfterStalePaid, portalAfterStalePaid, stalePaidAudit] = await Promise.all([
  acceptanceQuoteRef.get(),
  acceptancePortalRef.get(),
  db.collection("webhookEvents").doc(`stripe-${stalePaidEvent.id}`).get()
]);
assert.equal(quoteAfterStalePaid.data()?.payment?.depositStatus, "paid");
assert.equal(quoteAfterStalePaid.data()?.payment?.stripeSessionId, paymentSessionId);
assert.equal(portalAfterStalePaid.data()?.payment?.depositStatus, "paid");
assert.equal(portalAfterStalePaid.data()?.payment?.stripeSessionId, paymentSessionId);
assert.equal(stalePaidAudit.data()?.status, "review_required");
assert.equal(
  stalePaidAudit.data()?.result,
  "stale_known_session_scope_mismatch_paid_review"
);
assert.equal(stalePaidAudit.data()?.knownSession, true);
assert.equal(stalePaidAudit.data()?.commercialScopeValid, false);
assert.match(
  stalePaidAudit.data()?.commercialScopeError || "",
  /amount does not match the quote deposit/i
);
const duplicateStalePaidAttempt = await callStripeWebhook(stalePaidEvent);
assert.equal(duplicateStalePaidAttempt.status, 200, duplicateStalePaidAttempt.responseText);
assert.equal(duplicateStalePaidAttempt.payload?.duplicate, true);

const paidDowngradeEvent = {
  ...paymentEvent,
  id: "evt_quotepilot_paid_downgrade",
  type: "checkout.session.expired",
  data: {
    object: {
      ...paymentEvent.data.object,
      status: "expired",
      payment_status: "unpaid"
    }
  }
};
const paidDowngradeAttempt = await callStripeWebhook(paidDowngradeEvent);
assert.equal(paidDowngradeAttempt.status, 200, paidDowngradeAttempt.responseText);
assert.equal(paidDowngradeAttempt.payload?.ignored, "settlement_is_monotonic");
assert.equal((await acceptanceQuoteRef.get()).data()?.payment?.depositStatus, "paid");

for (const [providerState, eventType] of [
  ["failed", "checkout.session.async_payment_failed"],
  ["expired", "checkout.session.expired"]
]) {
  const terminalQuoteId = `stripe-${providerState}-quote`;
  const terminalPortalKey = `stripe-${providerState}-portal-key-abcdefghijklmnopqrstuvwxyz`;
  const terminalSessionId = `cs_test_quotepilot_${providerState}`;
  const terminalLink = `https://checkout.stripe.com/c/pay/quotepilot-${providerState}`;
  const terminalPayment = {
    ...(paymentQuoteBefore.data()?.payment || {}),
    depositLink: terminalLink,
    depositStatus: "sent",
    depositConfirmedAtISO: "",
    stripeSessionId: terminalSessionId,
    stripeCheckoutState: "open",
    checkoutGeneration: 1
  };
  await orgRef.collection("quotes").doc(terminalQuoteId).set({
    ...paymentQuoteBefore.data(),
    quoteId: terminalQuoteId,
    portalKey: terminalPortalKey,
    payment: terminalPayment
  }, { merge: false });
  await db.collection("customerPortalQuotes").doc(terminalPortalKey).set({
    ...paymentPortalBefore.data(),
    quoteId: terminalQuoteId,
    portalKey: terminalPortalKey,
    organizationId,
    payment: terminalPayment
  }, { merge: false });
  const terminalEvent = {
    ...paymentEvent,
    id: `evt_quotepilot_${providerState}`,
    type: eventType,
    data: {
      object: {
        ...paymentEvent.data.object,
        id: terminalSessionId,
        status: providerState === "expired" ? "expired" : "complete",
        payment_status: "unpaid",
        metadata: {
          quoteId: terminalQuoteId,
          organizationId,
          portalKey: terminalPortalKey
        }
      }
    }
  };
  const terminalAttempt = await callStripeWebhook(terminalEvent);
  assert.equal(terminalAttempt.status, 200, terminalAttempt.responseText);
  const [terminalQuote, terminalPortal] = await Promise.all([
    orgRef.collection("quotes").doc(terminalQuoteId).get(),
    db.collection("customerPortalQuotes").doc(terminalPortalKey).get()
  ]);
  assert.equal(terminalQuote.data()?.payment?.depositStatus, "unpaid");
  assert.equal(terminalQuote.data()?.payment?.depositLink, "");
  assert.equal(terminalQuote.data()?.payment?.stripeCheckoutState, providerState);
  assert.equal(terminalPortal.data()?.payment?.stripeCheckoutState, providerState);
}

const expectedQuoteTotalCents = Math.round(
  Number(paymentQuoteBefore.data()?.totals?.total || 0) * 100
);
const expectedFinalBalanceCents = expectedQuoteTotalCents - expectedDepositCents;
assert.ok(expectedFinalBalanceCents > 0);

async function seedFinalBalanceApprovalFixture({ suffix, quoteId, portalKey }) {
  const sourceQuote = paymentQuoteBefore.data() || {};
  const sourcePortal = paymentPortalBefore.data() || {};
  const paidDepositSessionId = `cs_test_quotepilot_final_approval_deposit_${suffix}`;
  const paidDepositAtISO = new Date(Date.now() - 60_000).toISOString();
  const providerAcceptedAtISO = new Date(Date.now() - 30_000).toISOString();
  const portalIssuedAtISO = String(sourceQuote.portalIssuedAtISO || "");
  const portalExpiresAtISO = String(sourceQuote.portalExpiresAtISO || "");
  const revisionId = String(sourceQuote.workflow?.quoteDelivery?.revisionId || "");
  assert.ok(portalIssuedAtISO);
  assert.ok(portalExpiresAtISO);
  assert.ok(revisionId);

  const quoteDelivery = {
    ...(sourceQuote.workflow?.quoteDelivery || {}),
    state: "provider_accepted",
    portalActivationState: "active",
    portalKey,
    portalIssuedAtISO,
    providerAcceptedAtISO,
    providerMessageId: `provisioning-emulator-final-approval-${suffix}`,
    revisionId
  };
  const deliveryEvidence = {
    revisionId,
    state: "provider_accepted",
    portalActivationState: "active",
    portalKey,
    portalIssuedAtISO,
    providerAcceptedAtISO
  };
  const depositLedgerEntry = {
    operationId: `legacy-deposit:${paidDepositSessionId}`,
    paymentKind: "deposit",
    amountCents: expectedDepositCents,
    state: "paid",
    providerReference: paidDepositSessionId,
    providerSettledAtISO: paidDepositAtISO
  };
  const quotePayment = {
    depositStatus: "paid",
    depositLink: "",
    depositConfirmedAtISO: paidDepositAtISO,
    stripeSessionId: paidDepositSessionId,
    stripeCheckoutState: "paid",
    checkoutGeneration: 1,
    knownStripeSessionIds: [paidDepositSessionId],
    ledger: {
      version: 1,
      entries: [depositLedgerEntry]
    }
  };
  const quoteRef = orgRef.collection("quotes").doc(quoteId);
  const portalRef = db.collection("customerPortalQuotes").doc(portalKey);
  await Promise.all([
    quoteRef.set({
      ...sourceQuote,
      quoteId,
      portalKey,
      status: "booked",
      workflow: {
        ...(sourceQuote.workflow || {}),
        approvalRequests: [],
        quoteDelivery
      },
      payment: quotePayment
    }, { merge: false }),
    portalRef.set({
      ...sourcePortal,
      quoteId,
      portalKey,
      organizationId,
      status: "booked",
      portalIssuedAtISO,
      portalExpiresAtISO,
      deliveryEvidence,
      payment: {
        depositStatus: "paid",
        depositLink: "",
        depositConfirmedAtISO: paidDepositAtISO,
        stripeCheckoutState: "paid"
      }
    }, { merge: false })
  ]);

  return {
    paidDepositSessionId,
    portalRef,
    quoteRef
  };
}

const staleFinalApprovalQuoteId = "final-balance-stale-approval-quote";
const staleFinalApprovalPortalKey = "final-balance-stale-approval-portal-abcdefghijklmnop";
const staleFinalApprovalFixture = await seedFinalBalanceApprovalFixture({
  suffix: "stale_scope",
  quoteId: staleFinalApprovalQuoteId,
  portalKey: staleFinalApprovalPortalKey
});
const staleFinalApproval = await requestAndApproveQuoteAction(
  staleFinalApprovalQuoteId,
  "send_final_balance_request",
  "Collect the booked contract final balance."
);
assert.equal(staleFinalApproval.actionScope?.customerEmail, customerEmail);
const changedFinalBalanceEmail = "changed-final-balance@example.test";
await staleFinalApprovalFixture.quoteRef.update({
  "customer.email": changedFinalBalanceEmail
});
await expectCallableError(
  () => callFunction("sendFinalBalanceRequestEmail", bootstrapToken, {
    organizationId,
    quoteId: staleFinalApprovalQuoteId,
    approvalRequestId: staleFinalApproval.id
  }),
  "FAILED_PRECONDITION"
);
const [staleFinalApprovalQuote, staleFinalApprovalExecution, staleFinalPrivateDispatch] = await Promise.all([
  staleFinalApprovalFixture.quoteRef.get(),
  orgRef.collection("quoteApprovalExecutions").doc(staleFinalApproval.id).get(),
  orgRef.collection("privatePaymentDispatches").doc(staleFinalApproval.id).get()
]);
const closedStaleFinalApproval = staleFinalApprovalQuote.data()?.workflow?.approvalRequests
  ?.find((request) => request.id === staleFinalApproval.id);
assert.equal(closedStaleFinalApproval?.executionState, "failed");
assert.equal(staleFinalApprovalExecution.data()?.state, "failed");
assert.equal(staleFinalApprovalExecution.data()?.action, "send_final_balance_request");
assert.equal(staleFinalApprovalExecution.data()?.result?.paymentKind, "final_balance");
assert.equal(staleFinalApprovalExecution.data()?.result?.checkoutPreparationRecorded, false);
assert.equal(staleFinalApprovalExecution.data()?.result?.stripeCheckoutOutcome, "unverified");
assert.equal(staleFinalApprovalExecution.data()?.result?.emailProviderContacted, false);
assert.equal(staleFinalApprovalExecution.data()?.checkoutPreparation, undefined);
assert.equal(staleFinalApprovalExecution.data()?.paymentDispatch, undefined);
assert.equal(staleFinalPrivateDispatch.exists, false);
assert.equal(staleFinalApprovalQuote.data()?.payment?.finalBalance, undefined);
assert.equal(staleFinalApprovalQuote.data()?.payment?.stripeSessionId, staleFinalApprovalFixture.paidDepositSessionId);
assert.equal(staleFinalApprovalQuote.data()?.payment?.ledger?.entries?.length, 1);
const freshFinalApprovalRequest = await callFunction(
  "requestQuoteApproval",
  tenantMember.idToken,
  {
    organizationId,
    quoteId: staleFinalApprovalQuoteId,
    action: "send_final_balance_request",
    note: "Request a new final-balance approval for the changed customer scope."
  }
);
assert.equal(freshFinalApprovalRequest.ok, true);
assert.equal(freshFinalApprovalRequest.request?.state, "pending");
assert.equal(freshFinalApprovalRequest.request?.action, "send_final_balance_request");
assert.equal(freshFinalApprovalRequest.request?.actionScope?.customerEmail, changedFinalBalanceEmail);
assert.notEqual(freshFinalApprovalRequest.request?.id, staleFinalApproval.id);

async function seedFinalBalanceWebhookFixture({
  suffix,
  quoteId,
  portalKey,
  stripeSessionId,
  operationId
}) {
  const sourceQuote = paymentQuoteBefore.data() || {};
  const sourcePortal = paymentPortalBefore.data() || {};
  const paidDepositSessionId = `cs_test_quotepilot_final_deposit_${suffix}`;
  const paidDepositAtISO = new Date(Date.now() - 60_000).toISOString();
  const providerAcceptedAtISO = new Date(Date.now() - 30_000).toISOString();
  const paymentLink = `https://checkout.stripe.com/c/pay/quotepilot-final-${suffix}`;
  const portalIssuedAtISO = String(sourceQuote.portalIssuedAtISO || "");
  const portalExpiresAtISO = String(sourceQuote.portalExpiresAtISO || "");
  const revisionId = String(sourceQuote.workflow?.quoteDelivery?.revisionId || "");
  assert.ok(portalIssuedAtISO);
  assert.ok(portalExpiresAtISO);
  assert.ok(revisionId);

  const quoteDelivery = {
    ...(sourceQuote.workflow?.quoteDelivery || {}),
    state: "provider_accepted",
    portalActivationState: "active",
    portalKey,
    portalIssuedAtISO,
    providerAcceptedAtISO,
    providerMessageId: `provisioning-emulator-final-${suffix}`,
    revisionId
  };
  const deliveryEvidence = {
    revisionId,
    state: "provider_accepted",
    portalActivationState: "active",
    portalKey,
    portalIssuedAtISO,
    providerAcceptedAtISO
  };
  const finalBalance = {
    amountCents: expectedFinalBalanceCents,
    currency: "usd",
    status: "sent",
    paymentLink,
    confirmedAtISO: "",
    stripeSessionId,
    stripeCheckoutState: "open",
    checkoutGeneration: 1,
    knownStripeSessionIds: [stripeSessionId]
  };
  const paymentLedger = {
    version: 1,
    entries: [
      {
        operationId: `legacy-deposit:${paidDepositSessionId}`,
        paymentKind: "deposit",
        amountCents: expectedDepositCents,
        state: "paid",
        providerReference: paidDepositSessionId,
        providerSettledAtISO: paidDepositAtISO
      },
      {
        operationId,
        paymentKind: "final_balance",
        amountCents: expectedFinalBalanceCents,
        state: "sent",
        providerReference: stripeSessionId,
        providerSettledAtISO: ""
      }
    ]
  };
  const quotePayment = {
    depositStatus: "paid",
    depositLink: "",
    depositConfirmedAtISO: paidDepositAtISO,
    stripeSessionId: paidDepositSessionId,
    stripeCheckoutState: "paid",
    checkoutGeneration: 1,
    knownStripeSessionIds: [paidDepositSessionId],
    finalBalance,
    ledger: paymentLedger
  };
  const portalPayment = {
    depositStatus: "paid",
    depositLink: "",
    depositConfirmedAtISO: paidDepositAtISO,
    stripeCheckoutState: "paid",
    finalBalance: {
      amountCents: finalBalance.amountCents,
      currency: finalBalance.currency,
      status: finalBalance.status,
      paymentLink: finalBalance.paymentLink,
      confirmedAtISO: finalBalance.confirmedAtISO,
      stripeCheckoutState: finalBalance.stripeCheckoutState,
      checkoutGeneration: finalBalance.checkoutGeneration
    }
  };
  const quoteRef = orgRef.collection("quotes").doc(quoteId);
  const portalRef = db.collection("customerPortalQuotes").doc(portalKey);
  await Promise.all([
    quoteRef.set({
      ...sourceQuote,
      quoteId,
      portalKey,
      status: "booked",
      workflow: {
        ...(sourceQuote.workflow || {}),
        approvalRequests: [],
        quoteDelivery
      },
      payment: quotePayment
    }, { merge: false }),
    portalRef.set({
      ...sourcePortal,
      quoteId,
      portalKey,
      organizationId,
      status: "booked",
      portalIssuedAtISO,
      portalExpiresAtISO,
      deliveryEvidence,
      payment: portalPayment
    }, { merge: false })
  ]);

  const [seededQuote, seededPortal] = await Promise.all([
    quoteRef.get(),
    portalRef.get()
  ]);
  assert.equal(seededQuote.data()?.status, "booked");
  assert.ok(seededQuote.data()?.booking?.contractNumber);
  assert.ok(seededQuote.data()?.booking?.contractConvertedAtISO);
  assert.equal(seededQuote.data()?.workflow?.quoteDelivery?.state, "provider_accepted");
  assert.equal(seededQuote.data()?.workflow?.quoteDelivery?.portalActivationState, "active");
  assert.equal(seededPortal.data()?.deliveryEvidence?.state, "provider_accepted");
  assert.equal(seededPortal.data()?.deliveryEvidence?.portalActivationState, "active");
  assert.equal(seededQuote.data()?.payment?.finalBalance?.status, "sent");
  assert.equal(
    seededQuote.data()?.payment?.ledger?.entries
      ?.find((entry) => entry.operationId === operationId)
      ?.state,
    "sent"
  );

  return {
    operationId,
    paidDepositSessionId,
    portalRef,
    quoteRef,
    stripeSessionId
  };
}

function buildFinalBalanceWebhookEvent({
  eventId,
  quoteId,
  portalKey,
  stripeSessionId,
  operationId,
  eventType = "checkout.session.completed",
  sessionStatus = "complete",
  paymentStatus = "paid"
}) {
  return {
    id: eventId,
    object: "event",
    type: eventType,
    livemode: false,
    data: {
      object: {
        id: stripeSessionId,
        object: "checkout.session",
        livemode: false,
        mode: "payment",
        status: sessionStatus,
        payment_status: paymentStatus,
        currency: "usd",
        amount_total: expectedFinalBalanceCents,
        metadata: {
          quoteId,
          organizationId,
          portalKey,
          approvalRequestId: operationId,
          paymentKind: "final_balance",
          currency: "usd",
          checkoutGeneration: "1"
        }
      }
    }
  };
}

const finalBalanceQuoteId = "stripe-final-balance-paid-quote";
const finalBalancePortalKey = "stripe-final-balance-paid-portal-key-abcdefghijklmnop";
const finalBalanceSessionId = "cs_test_quotepilot_final_balance_paid";
const finalBalanceOperationId = "final_balance_webhook_acceptance";
const finalBalanceFixture = await seedFinalBalanceWebhookFixture({
  suffix: "paid",
  quoteId: finalBalanceQuoteId,
  portalKey: finalBalancePortalKey,
  stripeSessionId: finalBalanceSessionId,
  operationId: finalBalanceOperationId
});
const finalBalanceEvent = buildFinalBalanceWebhookEvent({
  eventId: "evt_quotepilot_final_balance_paid",
  quoteId: finalBalanceQuoteId,
  portalKey: finalBalancePortalKey,
  stripeSessionId: finalBalanceSessionId,
  operationId: finalBalanceOperationId
});
const finalBalancePaidAttempt = await callStripeWebhook(finalBalanceEvent);
assert.equal(finalBalancePaidAttempt.status, 200, finalBalancePaidAttempt.responseText);
assert.equal(finalBalancePaidAttempt.payload?.received, true);
const [finalBalancePaidQuote, finalBalancePaidPortal, finalBalancePaidAudit] = await Promise.all([
  finalBalanceFixture.quoteRef.get(),
  finalBalanceFixture.portalRef.get(),
  db.collection("webhookEvents").doc(`stripe-${finalBalanceEvent.id}`).get()
]);
const finalBalancePaidQuoteData = finalBalancePaidQuote.data() || {};
const finalBalancePaidPortalPayment = finalBalancePaidPortal.data()?.payment || {};
const finalBalancePaidPortalProjection = finalBalancePaidPortalPayment.finalBalance || {};
const finalBalancePaidLedgerEntry = finalBalancePaidQuoteData.payment?.ledger?.entries
  ?.find((entry) => entry.operationId === finalBalanceOperationId);
assert.equal(finalBalancePaidQuoteData.payment?.depositStatus, "paid");
assert.equal(
  finalBalancePaidQuoteData.payment?.stripeSessionId,
  finalBalanceFixture.paidDepositSessionId
);
assert.equal(finalBalancePaidQuoteData.payment?.finalBalance?.status, "paid");
assert.equal(finalBalancePaidQuoteData.payment?.finalBalance?.paymentLink, "");
assert.equal(finalBalancePaidQuoteData.payment?.finalBalance?.stripeSessionId, finalBalanceSessionId);
assert.equal(finalBalancePaidQuoteData.payment?.finalBalance?.stripeCheckoutState, "paid");
assert.ok(finalBalancePaidQuoteData.payment?.finalBalance?.confirmedAtISO);
assert.equal(finalBalancePaidLedgerEntry?.paymentKind, "final_balance");
assert.equal(finalBalancePaidLedgerEntry?.amountCents, expectedFinalBalanceCents);
assert.equal(finalBalancePaidLedgerEntry?.state, "paid");
assert.equal(finalBalancePaidLedgerEntry?.providerReference, finalBalanceSessionId);
assert.ok(finalBalancePaidLedgerEntry?.providerSettledAtISO);
assert.equal(finalBalancePaidPortalProjection.status, "paid");
assert.equal(finalBalancePaidPortalProjection.amountCents, expectedFinalBalanceCents);
assert.equal(finalBalancePaidPortalProjection.paymentLink, "");
assert.ok(finalBalancePaidPortalProjection.confirmedAtISO);
assert.equal(
  Object.prototype.hasOwnProperty.call(finalBalancePaidPortalProjection, "stripeSessionId"),
  false
);
assert.equal(
  Object.prototype.hasOwnProperty.call(finalBalancePaidPortalProjection, "knownStripeSessionIds"),
  false
);
assert.doesNotMatch(JSON.stringify(finalBalancePaidPortalPayment), /cs_[A-Za-z0-9_]+/);
assert.equal(finalBalancePaidAudit.data()?.status, "processed");
assert.equal(finalBalancePaidAudit.data()?.providerState, "paid");
assert.equal(finalBalancePaidAudit.data()?.paymentKind, "final_balance");
const duplicateFinalBalancePaidAttempt = await callStripeWebhook(finalBalanceEvent);
assert.equal(duplicateFinalBalancePaidAttempt.status, 200, duplicateFinalBalancePaidAttempt.responseText);
assert.equal(duplicateFinalBalancePaidAttempt.payload?.duplicate, true);

const lateSettlementQuoteId = "stripe-final-balance-late-paid-quote";
const lateSettlementPortalKey = "stripe-final-balance-late-paid-portal-abcdefghijklmnop";
const lateSettlementSessionId = "cs_test_quotepilot_final_balance_late";
const lateSettlementOperationId = "final_balance_late_settlement";
const lateSettlementFixture = await seedFinalBalanceWebhookFixture({
  suffix: "late",
  quoteId: lateSettlementQuoteId,
  portalKey: lateSettlementPortalKey,
  stripeSessionId: lateSettlementSessionId,
  operationId: lateSettlementOperationId
});
const failedFinalBalanceEvent = buildFinalBalanceWebhookEvent({
  eventId: "evt_quotepilot_final_balance_failed",
  quoteId: lateSettlementQuoteId,
  portalKey: lateSettlementPortalKey,
  stripeSessionId: lateSettlementSessionId,
  operationId: lateSettlementOperationId,
  eventType: "checkout.session.async_payment_failed",
  paymentStatus: "unpaid"
});
const failedFinalBalanceAttempt = await callStripeWebhook(failedFinalBalanceEvent);
assert.equal(failedFinalBalanceAttempt.status, 200, failedFinalBalanceAttempt.responseText);
const [failedFinalBalanceQuote, failedFinalBalanceAudit] = await Promise.all([
  lateSettlementFixture.quoteRef.get(),
  db.collection("webhookEvents").doc(`stripe-${failedFinalBalanceEvent.id}`).get()
]);
const failedFinalBalanceLedgerEntry = failedFinalBalanceQuote.data()?.payment?.ledger?.entries
  ?.find((entry) => entry.operationId === lateSettlementOperationId);
assert.equal(failedFinalBalanceQuote.data()?.payment?.depositStatus, "paid");
assert.equal(failedFinalBalanceQuote.data()?.payment?.finalBalance?.status, "unpaid");
assert.equal(failedFinalBalanceQuote.data()?.payment?.finalBalance?.stripeCheckoutState, "failed");
assert.equal(failedFinalBalanceLedgerEntry?.state, "failed");
assert.equal(failedFinalBalanceAudit.data()?.paymentKind, "final_balance");
assert.equal(failedFinalBalanceAudit.data()?.providerState, "failed");

const latePaidFinalBalanceEvent = buildFinalBalanceWebhookEvent({
  eventId: "evt_quotepilot_final_balance_late_paid",
  quoteId: lateSettlementQuoteId,
  portalKey: lateSettlementPortalKey,
  stripeSessionId: lateSettlementSessionId,
  operationId: lateSettlementOperationId,
  eventType: "checkout.session.async_payment_succeeded"
});
const latePaidFinalBalanceAttempt = await callStripeWebhook(latePaidFinalBalanceEvent);
assert.equal(latePaidFinalBalanceAttempt.status, 200, latePaidFinalBalanceAttempt.responseText);
assert.equal(latePaidFinalBalanceAttempt.payload?.received, true);
const [latePaidFinalBalanceQuote, latePaidFinalBalancePortal, latePaidFinalBalanceAudit] = await Promise.all([
  lateSettlementFixture.quoteRef.get(),
  lateSettlementFixture.portalRef.get(),
  db.collection("webhookEvents").doc(`stripe-${latePaidFinalBalanceEvent.id}`).get()
]);
const latePaidFinalBalanceLedgerEntry = latePaidFinalBalanceQuote.data()?.payment?.ledger?.entries
  ?.find((entry) => entry.operationId === lateSettlementOperationId);
const latePaidFinalBalancePortalPayment = latePaidFinalBalancePortal.data()?.payment || {};
assert.equal(latePaidFinalBalanceQuote.data()?.payment?.depositStatus, "paid");
assert.equal(latePaidFinalBalanceQuote.data()?.payment?.finalBalance?.status, "paid");
assert.equal(latePaidFinalBalanceQuote.data()?.payment?.finalBalance?.stripeCheckoutState, "paid");
assert.equal(latePaidFinalBalanceLedgerEntry?.state, "paid");
assert.equal(latePaidFinalBalanceLedgerEntry?.providerReference, lateSettlementSessionId);
assert.ok(latePaidFinalBalanceLedgerEntry?.providerSettledAtISO);
assert.equal(latePaidFinalBalancePortalPayment.finalBalance?.status, "paid");
assert.equal(
  Object.prototype.hasOwnProperty.call(
    latePaidFinalBalancePortalPayment.finalBalance || {},
    "stripeSessionId"
  ),
  false
);
assert.doesNotMatch(JSON.stringify(latePaidFinalBalancePortalPayment), /cs_[A-Za-z0-9_]+/);
assert.equal(latePaidFinalBalanceAudit.data()?.status, "processed");
assert.equal(latePaidFinalBalanceAudit.data()?.providerState, "paid");
assert.equal(latePaidFinalBalanceAudit.data()?.paymentKind, "final_balance");

assert.equal(
  String(process.env.BUYER_ACCESS_STRIPE_MODE || "").trim().toLowerCase(),
  "test",
  "BUYER_ACCESS_STRIPE_MODE=test is required for buyer invoice webhook acceptance."
);

function buyerAccessOrderIdForFixtureRequest(email = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return `ba-${createHash("sha256")
    .update(
      `quotepilot:buyer-access-order:v2:${normalizedEmail}:123e4567-e89b-42d3-a456-426614174000`,
      "utf8"
    )
    .digest("hex")
    .slice(0, 40)}`;
}

async function seedBuyerAccessInvoiceFixture({
  email,
  organizationName,
  ownerName,
  suffix
} = {}) {
  const normalizedSuffix = String(suffix || "").replace(/[^a-zA-Z0-9]/g, "");
  assert.ok(normalizedSuffix, "Buyer access fixture suffix is required.");
  const orderId = buyerAccessOrderIdForFixtureRequest(email);
  const organizationId = `buyer-access-${String(suffix || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")}-${createHash("sha256")
    .update(`buyer-access-org:${suffix}`, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
  const customerId = `cus_BuyerAccess${normalizedSuffix}`;
  const invoiceId = `in_BuyerAccess${normalizedSuffix}`;
  const invoiceItemId = `ii_BuyerAccess${normalizedSuffix}`;
  const paymentIntentId = `pi_BuyerAccess${normalizedSuffix}`;
  const hostedInvoiceUrl =
    `https://invoice.stripe.com/i/acct_test_${normalizedSuffix}/test_${normalizedSuffix}`;
  const orderRef = db.collection("buyerAccessOrders").doc(orderId);
  const organizationRef = db.collection("organizations").doc(organizationId);
  const settingsRef = organizationRef.collection("settings").doc("config");
  const provisioningOrderRef = db.collection("provisioningOrders").doc(orderId);
  const inviteRef = db
    .collection("organizationInvites")
    .doc(inviteIdFromEmail(email));
  const nowISO = new Date().toISOString();
  await orderRef.create({
    orderId,
    flow: "buyer_access",
    buyerAccessMode: "controlled_test",
    status: "invoice_open",
    providerStep: "sent",
    invoiceGeneration: 1,
    stripeCustomerId: customerId,
    stripeInvoiceId: invoiceId,
    stripeInvoiceItemId: invoiceItemId,
    hostedInvoiceUrl,
    organizationId,
    organizationName,
    ownerEmail: email,
    ownerName,
    plan: "starter",
    amountCents: 100,
    currency: "usd",
    statusTokenHash: createHash("sha256")
      .update(`buyer-access-status:${suffix}`, "utf8")
      .digest("hex"),
    accessGranted: false,
    workspaceReady: false,
    activationEmailSent: false,
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    createdAt: admin.FieldValue.serverTimestamp(),
    updatedAt: admin.FieldValue.serverTimestamp()
  });
  return {
    customerId,
    email,
    hostedInvoiceUrl,
    invoiceId,
    invoiceItemId,
    inviteRef,
    orderId,
    orderRef,
    organizationId,
    organizationName,
    organizationRef,
    ownerName,
    paymentIntentId,
    provisioningOrderRef,
    settingsRef
  };
}

function buildBuyerAccessInvoiceEvent(fixture, {
  amountDue = 100,
  customerId = fixture.customerId,
  eventId,
  eventType = "invoice.paid",
  invoiceId = fixture.invoiceId
} = {}) {
  const invoiceStatus = {
    "invoice.paid": "paid",
    "invoice.payment_failed": "open",
    "invoice.voided": "void",
    "invoice.marked_uncollectible": "uncollectible"
  }[eventType];
  assert.ok(invoiceStatus, `Unsupported buyer invoice fixture event type: ${eventType}`);
  const paid = eventType === "invoice.paid";
  const voided = eventType === "invoice.voided";
  const invoiceAmountDue = voided ? 0 : amountDue;
  return {
    id: eventId,
    object: "event",
    type: eventType,
    api_version: "2024-06-20",
    livemode: false,
    data: {
      object: {
        id: invoiceId,
        object: "invoice",
        livemode: false,
        status: invoiceStatus,
        collection_method: "send_invoice",
        customer: customerId,
        customer_email: fixture.email,
        currency: "usd",
        amount_due: invoiceAmountDue,
        total: amountDue,
        amount_paid: paid ? invoiceAmountDue : 0,
        amount_remaining: paid || voided ? 0 : invoiceAmountDue,
        paid_out_of_band: false,
        payment_intent: fixture.paymentIntentId,
        subscription: null,
        hosted_invoice_url: fixture.hostedInvoiceUrl,
        metadata: {
          flow: "buyer_access",
          buyerAccessOrderId: fixture.orderId,
          invoiceGeneration: "1",
          plan: "starter"
        }
      }
    }
  };
}

const buyerAccessFixture = await seedBuyerAccessInvoiceFixture({
  email: "buyer.access.webhook@example.test",
  organizationName: "Buyer Access Invoice Acceptance",
  ownerName: "Invoice Buyer",
  suffix: "Paid101"
});
const buyerAccessAmountMismatchEvent = buildBuyerAccessInvoiceEvent(
  buyerAccessFixture,
  {
    amountDue: 99,
    eventId: "evt_buyer_access_amount_mismatch"
  }
);
const genericBuyerAccessAttempt = await callStripeWebhook(
  buyerAccessAmountMismatchEvent
);
assert.equal(
  genericBuyerAccessAttempt.status,
  200,
  genericBuyerAccessAttempt.responseText
);
assert.equal(
  genericBuyerAccessAttempt.payload?.ignored,
  "buyer_access_uses_dedicated_webhook"
);
assert.equal(
  (await db.collection("webhookEvents")
    .doc(`stripe-${buyerAccessAmountMismatchEvent.id}`)
    .get()).exists,
  false
);

const nonBuyerDedicatedAttempt = await callBuyerAccessStripeWebhook({
  ...paymentEvent,
  api_version: "2024-06-20"
});
assert.equal(
  nonBuyerDedicatedAttempt.status,
  200,
  nonBuyerDedicatedAttempt.responseText
);
assert.equal(
  nonBuyerDedicatedAttempt.payload?.ignored,
  "non_buyer_access_invoice"
);
assert.equal(
  (await db.collection("webhookEvents")
    .doc(`stripe-buyer-${paymentEvent.id}`)
    .get()).exists,
  false
);

const buyerAccessAmountMismatchAttempt = await callBuyerAccessStripeWebhook(
  buyerAccessAmountMismatchEvent
);
assert.equal(
  buyerAccessAmountMismatchAttempt.status,
  200,
  buyerAccessAmountMismatchAttempt.responseText
);
assert.equal(
  buyerAccessAmountMismatchAttempt.payload?.ignored,
  "invalid_buyer_access_scope"
);
const buyerAccessInvoiceMismatchEvent = buildBuyerAccessInvoiceEvent(
  buyerAccessFixture,
  {
    eventId: "evt_buyer_access_invoice_mismatch",
    invoiceId: "in_DifferentBuyerInvoice101"
  }
);
const buyerAccessInvoiceMismatchAttempt = await callBuyerAccessStripeWebhook(
  buyerAccessInvoiceMismatchEvent
);
assert.equal(
  buyerAccessInvoiceMismatchAttempt.status,
  200,
  buyerAccessInvoiceMismatchAttempt.responseText
);
assert.equal(
  buyerAccessInvoiceMismatchAttempt.payload?.ignored,
  "invalid_buyer_access_scope"
);
const [
  buyerAccessOrderAfterMismatch,
  buyerAccessOrgAfterMismatch,
  buyerAccessSettingsAfterMismatch,
  buyerAccessProvisioningAfterMismatch,
  buyerAccessInviteAfterMismatch,
  buyerAccessAmountMismatchAudit,
  buyerAccessInvoiceMismatchAudit
] = await Promise.all([
  buyerAccessFixture.orderRef.get(),
  buyerAccessFixture.organizationRef.get(),
  buyerAccessFixture.settingsRef.get(),
  buyerAccessFixture.provisioningOrderRef.get(),
  buyerAccessFixture.inviteRef.get(),
  db.collection("webhookEvents")
    .doc(`stripe-buyer-${buyerAccessAmountMismatchEvent.id}`)
    .get(),
  db.collection("webhookEvents")
    .doc(`stripe-buyer-${buyerAccessInvoiceMismatchEvent.id}`)
    .get()
]);
assert.equal(buyerAccessOrderAfterMismatch.data()?.status, "invoice_open");
assert.equal(buyerAccessOrderAfterMismatch.data()?.accessGranted, false);
assert.equal(buyerAccessOrderAfterMismatch.data()?.workspaceReady, false);
assert.equal(buyerAccessOrderAfterMismatch.data()?.ownerUid, undefined);
assert.equal(buyerAccessOrgAfterMismatch.exists, false);
assert.equal(buyerAccessSettingsAfterMismatch.exists, false);
assert.equal(buyerAccessProvisioningAfterMismatch.exists, false);
assert.equal(buyerAccessInviteAfterMismatch.exists, false);
assert.equal(buyerAccessAmountMismatchAudit.data()?.status, "ignored");
assert.equal(
  buyerAccessAmountMismatchAudit.data()?.result,
  "invalid_buyer_access_scope"
);
assert.equal(buyerAccessInvoiceMismatchAudit.data()?.status, "ignored");
assert.equal(
  buyerAccessInvoiceMismatchAudit.data()?.result,
  "invalid_buyer_access_scope"
);

const buyerAccessPaidEvent = buildBuyerAccessInvoiceEvent(
  buyerAccessFixture,
  { eventId: "evt_buyer_access_paid" }
);
const buyerAccessPaidAttempt = await callBuyerAccessStripeWebhook(
  buyerAccessPaidEvent
);
assert.equal(
  buyerAccessPaidAttempt.status,
  200,
  buyerAccessPaidAttempt.responseText
);
assert.equal(buyerAccessPaidAttempt.payload?.received, true);
assert.equal(
  buyerAccessPaidAttempt.payload?.buyerAccessStatus,
  "activation_pending"
);
const [
  buyerAccessOrderAfterPaid,
  buyerAccessOrganizationAfterPaid,
  buyerAccessSettingsAfterPaid,
  buyerAccessProvisioningAfterPaid,
  buyerAccessInviteAfterPaid,
  buyerAccessPaidAudit
] = await Promise.all([
  buyerAccessFixture.orderRef.get(),
  buyerAccessFixture.organizationRef.get(),
  buyerAccessFixture.settingsRef.get(),
  buyerAccessFixture.provisioningOrderRef.get(),
  buyerAccessFixture.inviteRef.get(),
  db.collection("webhookEvents")
    .doc(`stripe-buyer-${buyerAccessPaidEvent.id}`)
    .get()
]);
const buyerAccessOrderAfterPaidData = buyerAccessOrderAfterPaid.data() || {};
const buyerAccessOrganizationAfterPaidData =
  buyerAccessOrganizationAfterPaid.data() || {};
const buyerAccessSettingsAfterPaidData = buyerAccessSettingsAfterPaid.data() || {};
const buyerAccessProvisioningAfterPaidData =
  buyerAccessProvisioningAfterPaid.data() || {};
const buyerAccessInviteAfterPaidData = buyerAccessInviteAfterPaid.data() || {};
assert.equal(buyerAccessOrderAfterPaidData.status, "activation_pending");
assert.equal(buyerAccessOrderAfterPaidData.workspaceReady, true);
assert.equal(buyerAccessOrderAfterPaidData.accessGranted, false);
assert.equal(buyerAccessOrderAfterPaidData.ownerUid, undefined);
assert.equal(
  buyerAccessOrderAfterPaidData.stripeInvoiceId,
  buyerAccessFixture.invoiceId
);
assert.equal(
  buyerAccessOrderAfterPaidData.stripeCustomerId,
  buyerAccessFixture.customerId
);
assert.equal(buyerAccessOrderAfterPaidData.buyerAccessMode, "controlled_test");
assert.equal(buyerAccessOrganizationAfterPaidData.status, "active");
assert.equal(buyerAccessOrganizationAfterPaidData.plan, "starter");
assert.equal(
  buyerAccessOrganizationAfterPaidData.buyerAccessOrderId,
  buyerAccessFixture.orderId
);
assert.equal(
  buyerAccessOrganizationAfterPaidData.buyerAccessMode,
  "controlled_test"
);
assert.equal(buyerAccessOrganizationAfterPaidData.ownerUid, "");
assert.equal(buyerAccessSettingsAfterPaidData.plan, "starter");
assert.equal(buyerAccessSettingsAfterPaidData.featureFlagsLocked, true);
assert.equal(
  buyerAccessSettingsAfterPaidData.featureFlags?.customerPortal,
  true
);
assert.equal(
  buyerAccessSettingsAfterPaidData.featureFlags?.eventSchedule,
  true
);
assert.equal(
  buyerAccessSettingsAfterPaidData.featureFlags?.guidedSelling,
  true
);
assert.equal(buyerAccessSettingsAfterPaidData.featureFlags?.aiAssist, true);
assert.equal(
  buyerAccessSettingsAfterPaidData.featureFlags?.reportingDashboard,
  false
);
assert.equal(buyerAccessSettingsAfterPaidData.taxRate, 0);
assert.equal(buyerAccessSettingsAfterPaidData.serviceFeePct, 0);
assert.deepEqual(buyerAccessSettingsAfterPaidData.menuSections, []);
assert.equal(
  buyerAccessSettingsAfterPaidData.buyerAccessOrderId,
  buyerAccessFixture.orderId
);
assert.equal(
  buyerAccessSettingsAfterPaidData.buyerAccessMode,
  "controlled_test"
);
assert.equal(buyerAccessSettingsAfterPaidData.ownerUid, "");
assert.equal(
  buyerAccessProvisioningAfterPaidData.status,
  "provisioned_email_failed"
);
assert.equal(
  buyerAccessProvisioningAfterPaidData.operation,
  "buyer_access_purchase"
);
assert.equal(buyerAccessProvisioningAfterPaidData.ownerUid, "");
assert.equal(
  buyerAccessProvisioningAfterPaidData.buyerAccessOrderId,
  buyerAccessFixture.orderId
);
assert.equal(
  buyerAccessProvisioningAfterPaidData.buyerAccessMode,
  "controlled_test"
);
assert.equal(buyerAccessProvisioningAfterPaidData.amountCents, 100);
assert.equal(buyerAccessProvisioningAfterPaidData.currency, "usd");
assert.equal(buyerAccessInviteAfterPaidData.status, "pending");
assert.equal(buyerAccessInviteAfterPaidData.role, "admin");
assert.equal(buyerAccessInviteAfterPaidData.email, buyerAccessFixture.email);
assert.equal(
  buyerAccessInviteAfterPaidData.organizationId,
  buyerAccessFixture.organizationId
);
assert.equal(
  buyerAccessInviteAfterPaidData.buyerAccessOrderId,
  buyerAccessFixture.orderId
);
assert.equal(
  buyerAccessInviteAfterPaidData.buyerAccessMode,
  "controlled_test"
);
const buyerInviteLifetimeMs =
  Date.parse(buyerAccessInviteAfterPaidData.expiresAtISO)
  - Date.parse(buyerAccessInviteAfterPaidData.createdAtISO);
assert.ok(
  buyerInviteLifetimeMs >= (7 * 24 * 60 * 60 * 1000) - 1_000
    && buyerInviteLifetimeMs <= (7 * 24 * 60 * 60 * 1000) + 1_000,
  "Buyer activation invite must expire after exactly seven days."
);
assert.equal(buyerAccessPaidAudit.data()?.flow, "buyer_access");
assert.equal(buyerAccessPaidAudit.data()?.buyerAccessMode, "controlled_test");
assert.equal(buyerAccessPaidAudit.data()?.status, "processed");
assert.equal(buyerAccessPaidAudit.data()?.providerState, "paid");
assert.equal(
  buyerAccessPaidAudit.data()?.stripeInvoiceId,
  buyerAccessFixture.invoiceId
);

const buyerAccessPrincipal = await createBuyerWithoutRole(
  buyerAccessFixture.email
);
const buyerAccessRoleRef = db
  .collection("userRoles")
  .doc(buyerAccessPrincipal.uid);
await expectCallableError(
  () => callFunction(
    "ensureOrganizationBootstrap",
    buyerAccessPrincipal.idToken,
    {}
  ),
  "FAILED_PRECONDITION"
);
assert.equal((await buyerAccessRoleRef.get()).exists, false);
assert.equal((await buyerAccessFixture.inviteRef.get()).data()?.status, "pending");
assert.equal((await buyerAccessFixture.orderRef.get()).data()?.accessGranted, false);

await auth.updateUser(buyerAccessPrincipal.uid, { emailVerified: true });
const verifiedBuyerToken = await signInEmulatorUser(buyerAccessFixture.email);
const buyerAccessBootstrap = await callFunction(
  "ensureOrganizationBootstrap",
  verifiedBuyerToken,
  {}
);
assert.equal(buyerAccessBootstrap.ok, true);
assert.equal(buyerAccessBootstrap.role, "admin");
assert.equal(
  buyerAccessBootstrap.organizationId,
  buyerAccessFixture.organizationId
);
const [
  buyerAccessOrderAfterActivation,
  buyerAccessInviteAfterActivation,
  buyerAccessRoleAfterActivation,
  buyerAccessAuthAfterActivation,
  buyerAccessOrganizationAfterActivation,
  buyerAccessSettingsAfterActivation,
  buyerAccessProvisioningAfterActivation
] = await Promise.all([
  buyerAccessFixture.orderRef.get(),
  buyerAccessFixture.inviteRef.get(),
  buyerAccessRoleRef.get(),
  auth.getUser(buyerAccessPrincipal.uid),
  buyerAccessFixture.organizationRef.get(),
  buyerAccessFixture.settingsRef.get(),
  buyerAccessFixture.provisioningOrderRef.get()
]);
assert.equal(buyerAccessOrderAfterActivation.data()?.status, "active");
assert.equal(buyerAccessOrderAfterActivation.data()?.accessGranted, true);
assert.equal(
  buyerAccessOrderAfterActivation.data()?.ownerUid,
  buyerAccessPrincipal.uid
);
assert.equal(
  buyerAccessOrderAfterActivation.data()?.claimsSyncStatus,
  "succeeded"
);
assert.equal(buyerAccessInviteAfterActivation.data()?.status, "consumed");
assert.equal(
  buyerAccessInviteAfterActivation.data()?.consumedByUid,
  buyerAccessPrincipal.uid
);
assert.equal(buyerAccessRoleAfterActivation.data()?.role, "admin");
assert.equal(
  buyerAccessRoleAfterActivation.data()?.organizationId,
  buyerAccessFixture.organizationId
);
assert.equal(
  buyerAccessRoleAfterActivation.data()?.buyerAccessOrderId,
  buyerAccessFixture.orderId
);
assert.equal(
  buyerAccessRoleAfterActivation.data()?.buyerAccessMode,
  "controlled_test"
);
assert.equal(
  buyerAccessAuthAfterActivation.customClaims?.organizationId,
  buyerAccessFixture.organizationId
);
assert.equal(buyerAccessAuthAfterActivation.customClaims?.role, "admin");

const buyerAccessActiveUpdateTimes = {
  order: buyerAccessOrderAfterActivation.updateTime.toMillis(),
  organization: buyerAccessOrganizationAfterActivation.updateTime.toMillis(),
  provisioning: buyerAccessProvisioningAfterActivation.updateTime.toMillis(),
  settings: buyerAccessSettingsAfterActivation.updateTime.toMillis()
};
await Promise.all([
  buyerAccessRoleRef.delete(),
  auth.setCustomUserClaims(buyerAccessPrincipal.uid, {})
]);
assert.equal((await buyerAccessRoleRef.get()).exists, false);
assert.equal(
  (await auth.getUser(buyerAccessPrincipal.uid)).customClaims?.organizationId,
  undefined
);

const duplicateBuyerAccessPaidAttempt = await callBuyerAccessStripeWebhook(
  buyerAccessPaidEvent
);
assert.equal(
  duplicateBuyerAccessPaidAttempt.status,
  200,
  duplicateBuyerAccessPaidAttempt.responseText
);
assert.equal(duplicateBuyerAccessPaidAttempt.payload?.duplicate, true);
const buyerAccessPaidReplayEvent = buildBuyerAccessInvoiceEvent(
  buyerAccessFixture,
  { eventId: "evt_buyer_access_paid_after_revocation" }
);
const buyerAccessPaidReplayAttempt = await callBuyerAccessStripeWebhook(
  buyerAccessPaidReplayEvent
);
assert.equal(
  buyerAccessPaidReplayAttempt.status,
  200,
  buyerAccessPaidReplayAttempt.responseText
);
assert.equal(buyerAccessPaidReplayAttempt.payload?.ignored, "already_active");
const [
  buyerAccessOrderAfterReplay,
  buyerAccessOrganizationAfterReplay,
  buyerAccessSettingsAfterReplay,
  buyerAccessRoleAfterReplay,
  buyerAccessProvisioningAfterReplay,
  buyerAccessReplayAudit,
  buyerAccessAuthAfterReplay
] = await Promise.all([
  buyerAccessFixture.orderRef.get(),
  buyerAccessFixture.organizationRef.get(),
  buyerAccessFixture.settingsRef.get(),
  buyerAccessRoleRef.get(),
  buyerAccessFixture.provisioningOrderRef.get(),
  db.collection("webhookEvents")
    .doc(`stripe-buyer-${buyerAccessPaidReplayEvent.id}`)
    .get(),
  auth.getUser(buyerAccessPrincipal.uid)
]);
assert.equal(
  buyerAccessOrderAfterReplay.updateTime.toMillis(),
  buyerAccessActiveUpdateTimes.order
);
assert.equal(
  buyerAccessOrganizationAfterReplay.updateTime.toMillis(),
  buyerAccessActiveUpdateTimes.organization
);
assert.equal(
  buyerAccessSettingsAfterReplay.updateTime.toMillis(),
  buyerAccessActiveUpdateTimes.settings
);
assert.equal(
  buyerAccessProvisioningAfterReplay.updateTime.toMillis(),
  buyerAccessActiveUpdateTimes.provisioning
);
assert.equal(buyerAccessRoleAfterReplay.exists, false);
assert.equal(
  buyerAccessAuthAfterReplay.customClaims?.organizationId,
  undefined
);
assert.equal(buyerAccessAuthAfterReplay.customClaims?.role, undefined);
assert.equal(buyerAccessReplayAudit.data()?.status, "ignored");
assert.equal(buyerAccessReplayAudit.data()?.result, "already_active");
assert.equal(
  buyerAccessReplayAudit.data()?.stripeInvoiceId,
  buyerAccessFixture.invoiceId
);

async function assertBuyerAccessUnfulfilledLifecycle({
  eventType,
  expectedStatus,
  suffix
} = {}) {
  const fixture = await seedBuyerAccessInvoiceFixture({
    email: `buyer.access.${suffix}@example.test`,
    organizationName: `Buyer Access ${suffix} Acceptance`,
    ownerName: `${suffix} Buyer`,
    suffix
  });
  const event = buildBuyerAccessInvoiceEvent(fixture, {
    eventId: `evt_buyer_access_${String(suffix).toLowerCase()}`,
    eventType
  });
  const expectedAmounts = {
    "invoice.payment_failed": {
      amountDue: 100,
      amountPaid: 0,
      amountRemaining: 100,
      total: 100
    },
    "invoice.voided": {
      amountDue: 0,
      amountPaid: 0,
      amountRemaining: 0,
      total: 100
    },
    "invoice.marked_uncollectible": {
      amountDue: 100,
      amountPaid: 0,
      amountRemaining: 100,
      total: 100
    }
  }[eventType];
  assert.deepEqual({
    amountDue: event.data.object.amount_due,
    amountPaid: event.data.object.amount_paid,
    amountRemaining: event.data.object.amount_remaining,
    total: event.data.object.total
  }, expectedAmounts);
  const attempt = await callBuyerAccessStripeWebhook(event);
  assert.equal(attempt.status, 200, attempt.responseText);
  assert.equal(attempt.payload?.received, true);
  assert.equal(attempt.payload?.buyerAccessStatus, expectedStatus);
  const [
    order,
    organization,
    settings,
    provisioningOrder,
    invite,
    audit
  ] = await Promise.all([
    fixture.orderRef.get(),
    fixture.organizationRef.get(),
    fixture.settingsRef.get(),
    fixture.provisioningOrderRef.get(),
    fixture.inviteRef.get(),
    db.collection("webhookEvents")
      .doc(`stripe-buyer-${event.id}`)
      .get()
  ]);
  assert.equal(order.data()?.status, expectedStatus);
  assert.equal(order.data()?.accessGranted, false);
  assert.equal(order.data()?.workspaceReady, false);
  assert.equal(order.data()?.ownerUid, undefined);
  assert.equal(organization.exists, false);
  assert.equal(settings.exists, false);
  assert.equal(provisioningOrder.exists, false);
  assert.equal(invite.exists, false);
  assert.equal(audit.data()?.status, "processed");
  assert.equal(audit.data()?.providerState, {
    "invoice.payment_failed": "failed",
    "invoice.voided": "void",
    "invoice.marked_uncollectible": "expired"
  }[eventType]);
}

await assertBuyerAccessUnfulfilledLifecycle({
  eventType: "invoice.payment_failed",
  expectedStatus: "payment_failed",
  suffix: "Failed102"
});
await assertBuyerAccessUnfulfilledLifecycle({
  eventType: "invoice.voided",
  expectedStatus: "void",
  suffix: "Void103"
});
await assertBuyerAccessUnfulfilledLifecycle({
  eventType: "invoice.marked_uncollectible",
  expectedStatus: "expired",
  suffix: "Expired104"
});

const retiredBulkPurgeQuoteId = "retired-bulk-purge-quote";
const retiredBulkPurgePortalKey = "retired-bulk-purge-portal-key";
await orgRef.collection("quotes").doc(retiredBulkPurgeQuoteId).create({
  organizationId,
  ownerUid: tenantMember.uid,
  portalKey: retiredBulkPurgePortalKey,
  status: "sent"
});
await db.collection("customerPortalQuotes").doc(retiredBulkPurgePortalKey).create({
  portalKey: retiredBulkPurgePortalKey,
  quoteId: retiredBulkPurgeQuoteId,
  organizationId,
  status: "sent"
});
const retiredBulkPurgeApproval = await requestAndApproveQuoteAction(
  retiredBulkPurgeQuoteId,
  "delete_quote",
  "Delete the legacy fixture through the exact approved path."
);
const retiredBulkPurgeDeletedAtISO = new Date().toISOString();
await orgRef.collection("quotes").doc(retiredBulkPurgeQuoteId).update({
  status: "deleted",
  deletedAtISO: retiredBulkPurgeDeletedAtISO
});
await db.collection("customerPortalQuotes").doc(retiredBulkPurgePortalKey).update({
  status: "deleted",
  deletedAtISO: retiredBulkPurgeDeletedAtISO
});
await expectCallableError(
  () => callFunction("purgeDeletedQuotesForOrganization", bootstrapToken, {
    organizationId,
    limit: 300
  }),
  "FAILED_PRECONDITION"
);
assert.equal(
  (await orgRef.collection("quotes").doc(retiredBulkPurgeQuoteId).get()).exists,
  true
);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(retiredBulkPurgePortalKey).get()).exists,
  true
);
const retiredBulkPurgeCleanup = await callFunction(
  "hardDeleteQuote",
  bootstrapToken,
  {
    organizationId,
    quoteId: retiredBulkPurgeQuoteId,
    approvalRequestId: retiredBulkPurgeApproval.id
  }
);
assert.equal(retiredBulkPurgeCleanup.ok, true);
assert.equal(
  (await orgRef.collection("quotes").doc(retiredBulkPurgeQuoteId).get()).exists,
  false
);
assert.equal(
  (await db.collection("customerPortalQuotes").doc(retiredBulkPurgePortalKey).get()).exists,
  false
);
const retiredBulkPurgeExecution = await orgRef
  .collection("quoteApprovalExecutions")
  .doc(retiredBulkPurgeApproval.id)
  .get();
assert.equal(retiredBulkPurgeExecution.data()?.state, "succeeded");
assert.equal(retiredBulkPurgeExecution.data()?.action, "delete_quote");
assert.equal(retiredBulkPurgeExecution.data()?.quoteId, retiredBulkPurgeQuoteId);
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
console.log("- direct browser acceptance was denied; the unauthenticated acceptance callable persisted signer, revision, and immutable receipt evidence");
console.log("- entitlement-only update preserved branding, catalog, and invite");
console.log("- approval requests, resolutions, and exact admin executions used server-owned identity, outcomes, idempotency, and replay protection");
console.log("- archived tenant resume/update was blocked");
console.log("- quote cleanup preserved cross-tenant, unscoped, and mismatched portal rows");
console.log("- provider/payment operations denied sales and rejected caller-supplied links");
console.log("- Stripe webhook rejected corrupt portals and underpayment, atomically accepted the exact paid session, and acknowledged a signed stale paid session with durable review evidence");
console.log("- stale final-balance approval scope closed before provider preparation and permitted a fresh exact-scope request");
console.log("- final-balance Stripe webhook atomically settled the quote ledger and customer-safe portal, deduped replay, and accepted late settlement after provider failure");
console.log("- buyer-access invoice webhook rejected amount and identity mismatches, created only a pending seven-day activation invite after paid settlement, required exact-email verification before access, and did not restore revoked access on replay");
console.log("- hard delete retired roles/invites/portal snapshots and tombstone blocked tenant resurrection");
