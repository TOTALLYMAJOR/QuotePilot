#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

const require = createRequire(import.meta.url);
const { buildDuplicateQuoteForm } = require("../functions/quoteCreation.js");
const {
  buildRebookDraftId,
  buildRebookingRequestId
} = require("../functions/rebookQuoteDraft.js");

const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || "").trim();
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const emulatorHubHost = String(process.env.FIREBASE_EMULATOR_HUB || "").trim();

if (!projectId.startsWith("demo-") || !authHost || !firestoreHost || !emulatorHubHost) {
  throw new Error(
    "Rebook quote acceptance is emulator-only. Use a demo-* project with Auth, Firestore, and Functions emulators."
  );
}

const emulatorResponse = await fetch(`http://${emulatorHubHost}/emulators`);
if (!emulatorResponse.ok) {
  throw new Error(`Unable to inspect Firebase emulator hub (${emulatorResponse.status}).`);
}
const emulators = await emulatorResponse.json();
const functionsHost = [emulators?.functions?.host, emulators?.functions?.port]
  .filter(Boolean)
  .join(":");
if (!functionsHost) {
  throw new Error("Functions emulator is required for rebook quote acceptance.");
}

const admin = loadFirebaseAdmin();
if (!admin.getApps().length) admin.initializeApp({ projectId });
const auth = admin.getAuth();
const db = admin.getFirestore();

const REGION = "us-central1";
const ORGANIZATION_ID = "rebook-emulator-org";
const OTHER_ORGANIZATION_ID = "rebook-emulator-other-org";
const STAFF_EMAIL = "rebook-owner@local.test";
const OTHER_STAFF_EMAIL = "rebook-other-owner@local.test";
const STAFF_PASSWORD = "Rebook-Emulator-Only-2026!";
const PACKAGE_ID = "rebook-package";
const MENU_ITEM_ID = "rebook-menu-item";
const EVENT_TYPE_ID = "rebook-event-type";
const ACCEPTANCE_RECEIPT_ID = "rebook-acceptance-receipt-0001";
const SOURCE_EVENT_DATE = dateAtOffset(-365);
const REVIEWED_EVENT_DATE = dateAtOffset(90);
const pricingSettingsRef = db.collection("organizations").doc(ORGANIZATION_ID)
  .collection("settings").doc("config");

function dateAtOffset(days) {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isoAtOffset(days) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function comparableFirestoreValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value?.toDate === "function") {
    return { __timestamp: value.toDate().toISOString() };
  }
  if (Array.isArray(value)) return value.map(comparableFirestoreValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, comparableFirestoreValue(value[key])])
    );
  }
  return value;
}

async function createPrincipal({ email, organizationId }) {
  const user = await auth.createUser({
    email,
    password: STAFF_PASSWORD,
    emailVerified: true
  });
  await Promise.all([
    db.collection("userRoles").doc(user.uid).set({
      role: "admin",
      organizationId,
      email,
      createdAt: admin.FieldValue.serverTimestamp(),
      updatedAt: admin.FieldValue.serverTimestamp()
    }),
    auth.setCustomUserClaims(user.uid, {
      role: "admin",
      organizationId,
      platformAdmin: false,
      claimsVersion: 1
    })
  ]);

  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: STAFF_PASSWORD,
        returnSecureToken: true
      })
    }
  );
  assert.equal(response.ok, true, `Auth emulator sign-in failed for ${email}`);
  const payload = await response.json();
  assert.ok(payload.idToken, `Auth emulator did not return an ID token for ${email}`);
  return { uid: user.uid, idToken: payload.idToken };
}

async function callFunction(name, idToken, data = {}) {
  const response = await fetch(
    `http://${functionsHost}/${projectId}/${REGION}/${name}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:4174",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
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
    const error = new Error(payload.error.message || `${name} failed.`);
    error.status = String(payload.error.status || "");
    throw error;
  }
  return payload?.result || payload?.data || {};
}

async function expectCallableError(action, expectedStatus, expectedMessage) {
  let caught = null;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected callable error ${expectedStatus}`);
  assert.equal(caught.status, expectedStatus);
  if (expectedMessage) assert.match(caught.message, expectedMessage);
  return caught;
}

async function portalsForQuote(quoteId) {
  return db.collection("customerPortalQuotes").where("quoteId", "==", quoteId).get();
}

function sourceForm() {
  return {
    name: "Original Henderson Contact",
    email: "events@henderson.local.test",
    phone: "205-555-0100",
    clientOrg: "Henderson Group",
    eventName: "Henderson Corporate Picnic",
    date: SOURCE_EVENT_DATE,
    time: "12:00",
    hours: 5,
    guests: 84,
    servers: 2,
    chefs: 1,
    bartenders: 0,
    style: "buffet",
    venue: "Emulator Park",
    venueAddress: "100 Emulator Way",
    dietaryRestrictions: "One nut allergy",
    eventTypeId: EVENT_TYPE_ID,
    pkg: PACKAGE_ID,
    addons: [],
    rentals: [],
    menuItems: [MENU_ITEM_ID],
    addonQuantities: {},
    rentalQuantities: {},
    menuItemQuantities: { [MENU_ITEM_ID]: 1 },
    milesRT: 0,
    payMethod: "card",
    eventTemplateId: "custom",
    taxRegion: "rebook-local",
    seasonProfileId: "standard",
    includeDisposables: true
  };
}

const primaryStaff = await createPrincipal({
  email: STAFF_EMAIL,
  organizationId: ORGANIZATION_ID
});
const otherStaff = await createPrincipal({
  email: OTHER_STAFF_EMAIL,
  organizationId: OTHER_ORGANIZATION_ID
});
const confirmationAtISO = new Date().toISOString();

await Promise.all([
  db.collection("organizations").doc(ORGANIZATION_ID).set({
    name: "Rebook Emulator Organization",
    active: true,
    archived: false,
    status: "active"
  }),
  db.collection("organizations").doc(OTHER_ORGANIZATION_ID).set({
    name: "Other Rebook Emulator Organization",
    active: true,
    archived: false,
    status: "active"
  }),
  pricingSettingsRef.set({
      catalogRevision: 1,
      pricingSetupConfirmed: true,
      pricingConfirmation: {
        actorUid: primaryStaff.uid,
        actorEmail: STAFF_EMAIL,
        confirmedAtISO: confirmationAtISO,
        confirmedCatalogRevision: 1
      },
      businessTimeZone: "America/Chicago",
      serviceFeePct: 0.15,
      serviceFeeTiers: [{ id: "rebook-standard", minGuests: 0, maxGuests: 9999, pct: 0.15 }],
      taxRate: 0.08,
      taxRegions: [{ id: "rebook-local", name: "Rebook Local", rate: 0.08 }],
      defaultTaxRegion: "rebook-local",
      depositPct: 0.25,
      staffingLaborEnabled: true,
      staffingChargeMode: "per_hour",
      serverRate: 22,
      chefRate: 28,
      bartenderRate: 24,
      quoteValidityDays: 30,
      updatedAtISO: confirmationAtISO
    }),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("catalogPackages").doc(PACKAGE_ID).set({
      name: "Rebook Package",
      description: "Deterministic emulator package",
      pppMinor: 4200,
      active: true
    }),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("menuItems").doc(MENU_ITEM_ID).set({
      name: "Rebook Entrée",
      eventTypeId: EVENT_TYPE_ID,
      categoryId: "rebook-entrees",
      priceMinor: 0,
      pricingType: "per_event",
      type: "per_event",
      active: true
    })
]);

const sourceCreation = await callFunction(
  "createQuoteDraft",
  primaryStaff.idToken,
  { organizationId: ORGANIZATION_ID, form: sourceForm() }
);
assert.equal(sourceCreation.ok, true);
assert.equal(sourceCreation.activeVersionId, "v0001");

const sourceQuoteId = String(sourceCreation.id || "");
assert.ok(sourceQuoteId);
const sourceQuoteRef = db.collection("organizations").doc(ORGANIZATION_ID)
  .collection("quotes").doc(sourceQuoteId);
const sourceVersionRef = sourceQuoteRef.collection("versions").doc("v0001");
const initialSourceQuote = (await sourceQuoteRef.get()).data() || {};
const sourceCustomerId = String(initialSourceQuote.customerId || "");
assert.ok(sourceCustomerId);
const sourceCustomerRef = db.collection("organizations").doc(ORGANIZATION_ID)
  .collection("customers").doc(sourceCustomerId);
const sourcePortalRef = db.collection("customerPortalQuotes").doc(initialSourceQuote.portalKey);
const sourceIssuedAtISO = isoAtOffset(-400);
const sourceAcceptedAtISO = isoAtOffset(-390);
const acceptanceReceipt = {
  receiptId: ACCEPTANCE_RECEIPT_ID,
  quoteRevisionId: `v0001@${sourceIssuedAtISO}`,
  acceptedAtISO: sourceAcceptedAtISO,
  portalIssuedAtISO: sourceIssuedAtISO
};

await Promise.all([
  sourceQuoteRef.set({
    status: "booked",
    portalIssuedAtISO: sourceIssuedAtISO,
    acceptanceReceipt,
    lifecycle: {
      ...(initialSourceQuote.lifecycle || {}),
      acceptedAtISO: sourceAcceptedAtISO,
      bookedAtISO: sourceAcceptedAtISO
    },
    booking: {
      ...(initialSourceQuote.booking || {}),
      contractNumber: "CTR-REBOOK-EMULATOR-0001",
      contractConvertedAtISO: sourceAcceptedAtISO,
      confirmationStatus: "confirmed"
    },
    updatedAt: admin.FieldValue.serverTimestamp()
  }, { merge: true }),
  sourcePortalRef.set({
    status: "booked",
    portalIssuedAtISO: sourceIssuedAtISO,
    acceptanceReceipt,
    updatedAt: admin.FieldValue.serverTimestamp()
  }, { merge: true }),
  sourceCustomerRef.set({
    name: "Current Henderson Contact",
    phone: "205-555-0199",
    company: "Henderson Holdings LLC",
    updatedAt: admin.FieldValue.serverTimestamp()
  }, { merge: true })
]);

const acceptedVersionSnapshot = await sourceVersionRef.get();
assert.equal(acceptedVersionSnapshot.exists, true);
const acceptedVersion = acceptedVersionSnapshot.data() || {};
await sourceQuoteRef.collection("versions").doc("v0002").set({
  ...acceptedVersion,
  versionId: "v0002",
  versionNumber: 2,
  reason: "emulator_unaccepted_alternative",
  snapshot: {
    ...(acceptedVersion.snapshot || {}),
    event: {
      ...(acceptedVersion.snapshot?.event || {}),
      guests: 999
    },
    activeVersionId: "v0002",
    latestVersionNumber: 2
  }
});

const requestScope = {
  organizationId: ORGANIZATION_ID,
  sourceQuoteId,
  sourceVersionId: "v0001",
  acceptanceReceiptId: ACCEPTANCE_RECEIPT_ID
};
const rebookingRequestId = buildRebookingRequestId(requestScope);
const request = {
  ...requestScope,
  rebookingRequestId,
  customerName: "Browser supplied name must be ignored",
  eventDate: REVIEWED_EVENT_DATE,
  form: {
    ...sourceForm(),
    guests: 999,
    eventName: "Browser supplied scope must be ignored"
  }
};
const draftId = buildRebookDraftId(requestScope);
const draftRef = db.collection("organizations").doc(ORGANIZATION_ID)
  .collection("quotes").doc(draftId);

await expectCallableError(
  () => callFunction("createRebookQuoteDraft", otherStaff.idToken, request),
  "PERMISSION_DENIED",
  /organization/i
);
assert.equal((await draftRef.get()).exists, false);

const wrongVersionScope = { ...requestScope, sourceVersionId: "v0002" };
const wrongVersionRequest = {
  ...wrongVersionScope,
  rebookingRequestId: buildRebookingRequestId(wrongVersionScope)
};
const wrongVersionDraftId = buildRebookDraftId(wrongVersionScope);
await expectCallableError(
  () => callFunction("createRebookQuoteDraft", primaryStaff.idToken, wrongVersionRequest),
  "ABORTED",
  /accepted source version changed/i
);
assert.equal(
  (await db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("quotes").doc(wrongVersionDraftId).get()).exists,
  false
);

await draftRef.set({
  organizationId: ORGANIZATION_ID,
  status: "draft",
  occupiedBy: "unrelated-emulator-record"
});
const customerBeforeCollision = comparableFirestoreValue((await sourceCustomerRef.get()).data());
await expectCallableError(
  () => callFunction("createRebookQuoteDraft", primaryStaff.idToken, request),
  "ALREADY_EXISTS",
  /occupied by a different record/i
);
assert.deepEqual((await draftRef.get()).data(), {
  organizationId: ORGANIZATION_ID,
  status: "draft",
  occupiedBy: "unrelated-emulator-record"
});
assert.equal((await draftRef.collection("versions").get()).size, 0);
assert.equal((await portalsForQuote(draftId)).size, 0);
assert.deepEqual(
  comparableFirestoreValue((await sourceCustomerRef.get()).data()),
  customerBeforeCollision
);
await draftRef.delete();

const sourceQuoteBefore = comparableFirestoreValue((await sourceQuoteRef.get()).data());
const sourceVersionBefore = comparableFirestoreValue((await sourceVersionRef.get()).data());
const [firstCreate, concurrentRetry] = await Promise.all([
  callFunction("createRebookQuoteDraft", primaryStaff.idToken, request),
  callFunction("createRebookQuoteDraft", primaryStaff.idToken, request)
]);

assert.equal(firstCreate.ok, true);
assert.equal(concurrentRetry.ok, true);
assert.equal(firstCreate.id, draftId);
assert.equal(concurrentRetry.id, draftId);
assert.equal(firstCreate.portalKey, concurrentRetry.portalKey);
assert.equal(firstCreate.activeVersionId, "v0001");
assert.equal(concurrentRetry.activeVersionId, "v0001");
assert.equal([firstCreate, concurrentRetry].filter((result) => result.idempotent === true).length, 1);
assert.equal([firstCreate, concurrentRetry].filter((result) => result.idempotent === false).length, 1);

const [createdDraftSnapshot, createdVersions, createdPortals, customerMatches] = await Promise.all([
  draftRef.get(),
  draftRef.collection("versions").get(),
  portalsForQuote(draftId),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("customers").where("emailKey", "==", "events@henderson.local.test").get()
]);
assert.equal(createdDraftSnapshot.exists, true);
assert.equal(createdVersions.size, 1);
assert.equal(createdPortals.size, 1);
assert.equal(customerMatches.size, 1);
assert.equal(customerMatches.docs[0].id, sourceCustomerId);

const createdDraft = createdDraftSnapshot.data() || {};
const createdVersion = createdVersions.docs[0].data() || {};
const createdPortal = createdPortals.docs[0].data() || {};
assert.equal(createdDraft.status, "draft");
assert.equal(createdDraft.customerId, sourceCustomerId);
assert.equal(createdDraft.duplicatedFromQuoteId, sourceQuoteId);
assert.equal(createdDraft.pricing?.authority, "server_authoritative");
assert.equal(createdDraft.pricing?.rulesSnapshot?.settingsSnapshot?.catalogRevision, 1);
assert.equal(
  createdDraft.pricing?.rulesSnapshot?.settingsSnapshot?.pricingConfirmation?.confirmedCatalogRevision,
  1
);
assert.equal(createdDraft.customer?.name, "Current Henderson Contact");
assert.equal(createdDraft.customer?.phone, "205-555-0199");
assert.equal(createdDraft.customer?.organization, "Henderson Holdings LLC");
assert.equal(createdDraft.event?.name, "Henderson Corporate Picnic");
assert.equal(createdDraft.event?.guests, 84);
assert.equal(createdDraft.event?.date, SOURCE_EVENT_DATE);
assert.deepEqual(createdDraft.rebooking, {
  schemaVersion: 1,
  sourceOrganizationId: ORGANIZATION_ID,
  sourceQuoteId,
  sourceVersionId: "v0001",
  sourceCustomerId,
  sourceEventDate: SOURCE_EVENT_DATE,
  acceptanceReceiptId: ACCEPTANCE_RECEIPT_ID,
  sourceAcceptedAtISO,
  rebookingRequestId,
  draftCreatedAtISO: createdDraft.rebooking?.draftCreatedAtISO,
  state: "draft_created_for_staff_review"
});
assert.match(createdDraft.rebooking?.draftCreatedAtISO || "", /^\d{4}-\d{2}-\d{2}T/);
assert.equal(createdVersion.versionId, "v0001");
assert.equal(createdVersion.snapshot?.customerId, sourceCustomerId);
assert.deepEqual(createdVersion.snapshot?.rebooking, createdDraft.rebooking);
assert.equal(createdVersion.snapshot?.event?.guests, 84);
assert.equal(createdVersion.snapshot?.pricing?.rulesSnapshot?.settingsSnapshot?.catalogRevision, 1);
assert.equal(
  createdVersion.snapshot?.pricing?.rulesSnapshot?.settingsSnapshot?.pricingConfirmation
    ?.confirmedCatalogRevision,
  1
);
assert.equal(Object.hasOwn(createdPortal, "rebooking"), false);
assert.equal(JSON.stringify(createdPortal).includes(ACCEPTANCE_RECEIPT_ID), false);
assert.deepEqual(comparableFirestoreValue((await sourceQuoteRef.get()).data()), sourceQuoteBefore);
assert.deepEqual(comparableFirestoreValue((await sourceVersionRef.get()).data()), sourceVersionBefore);

const changedPricingAtISO = new Date().toISOString();
await pricingSettingsRef.set({
  catalogRevision: 2,
  pricingSetupConfirmed: false,
  depositPct: 0.3,
  pricingSettingsVersion: 2,
  pricingSettingsUpdatedAtISO: changedPricingAtISO,
  updatedAtISO: changedPricingAtISO
}, { merge: true });
await expectCallableError(
  () => callFunction("updateQuoteDraft", primaryStaff.idToken, {
    organizationId: ORGANIZATION_ID,
    quoteId: draftId,
    form: {
      ...buildDuplicateQuoteForm(createdDraft),
      date: REVIEWED_EVENT_DATE
    }
  }),
  "FAILED_PRECONDITION",
  /reviewed and confirmed for the current catalog revision/i
);
assert.equal((await draftRef.collection("versions").get()).size, 1);
assert.equal((await draftRef.get()).data()?.rebooking?.state, "draft_created_for_staff_review");

const reconfirmedPricingAtISO = new Date().toISOString();
await pricingSettingsRef.set({
  pricingSetupConfirmed: true,
  pricingConfirmation: {
    actorUid: primaryStaff.uid,
    actorEmail: STAFF_EMAIL,
    confirmedAtISO: reconfirmedPricingAtISO,
    confirmedCatalogRevision: 2
  },
  updatedAtISO: reconfirmedPricingAtISO
}, { merge: true });

const invalidReviewForm = {
  ...buildDuplicateQuoteForm(createdDraft),
  date: SOURCE_EVENT_DATE
};
await expectCallableError(
  () => callFunction("updateQuoteDraft", primaryStaff.idToken, {
    organizationId: ORGANIZATION_ID,
    quoteId: draftId,
    form: invalidReviewForm
  }),
  "FAILED_PRECONDITION",
  /current-or-future event date later/i
);
assert.equal((await draftRef.collection("versions").get()).size, 1);
assert.equal((await draftRef.get()).data()?.rebooking?.state, "draft_created_for_staff_review");

const reviewed = await callFunction("updateQuoteDraft", primaryStaff.idToken, {
  organizationId: ORGANIZATION_ID,
  quoteId: draftId,
  form: {
    ...buildDuplicateQuoteForm(createdDraft),
    date: REVIEWED_EVENT_DATE
  }
});
assert.equal(reviewed.ok, true);
assert.equal(reviewed.activeVersionId, "v0002");
assert.equal(reviewed.latestVersionNumber, 2);
assert.equal(reviewed.rebooking?.state, "staff_review_completed");
assert.equal(reviewed.rebooking?.reviewedEventDate, REVIEWED_EVENT_DATE);
assert.equal(reviewed.rebooking?.reviewedBy?.uid, primaryStaff.uid);
assert.equal(reviewed.rebooking?.reviewedBy?.email, STAFF_EMAIL);
assert.equal(reviewed.rebooking?.reviewedBy?.role, "admin");
assert.equal(reviewed.rebooking?.reviewCalendar?.timeZone, "America/Chicago");

const [reviewedDraftSnapshot, reviewedVersions, reviewedPortalSnapshot] = await Promise.all([
  draftRef.get(),
  draftRef.collection("versions").get(),
  db.collection("customerPortalQuotes").doc(reviewed.portalKey).get()
]);
const reviewedDraft = reviewedDraftSnapshot.data() || {};
const reviewedVersion = reviewedVersions.docs.find((snapshot) => snapshot.id === "v0002");
assert.equal(reviewedVersions.size, 2);
assert.ok(reviewedVersion);
assert.equal(reviewedDraft.event?.date, REVIEWED_EVENT_DATE);
assert.equal(reviewedDraft.rebooking?.state, "staff_review_completed");
assert.equal(reviewedDraft.rebooking?.sourceVersionId, "v0001");
assert.equal(reviewedDraft.rebooking?.acceptanceReceiptId, ACCEPTANCE_RECEIPT_ID);
assert.equal(reviewedDraft.pricing?.rulesSnapshot?.settingsSnapshot?.catalogRevision, 2);
assert.equal(
  reviewedDraft.pricing?.rulesSnapshot?.settingsSnapshot?.pricingConfirmation
    ?.confirmedCatalogRevision,
  2
);
assert.equal(reviewedDraft.pricing?.rulesSnapshot?.settingsSnapshot?.depositPct, 0.3);
assert.equal(reviewedVersion.data()?.snapshot?.rebooking?.state, "staff_review_completed");
assert.equal(reviewedVersion.data()?.snapshot?.event?.date, REVIEWED_EVENT_DATE);
assert.equal(
  reviewedVersion.data()?.snapshot?.pricing?.rulesSnapshot?.settingsSnapshot?.catalogRevision,
  2
);
assert.equal(
  reviewedVersion.data()?.snapshot?.pricing?.rulesSnapshot?.settingsSnapshot?.pricingConfirmation
    ?.confirmedCatalogRevision,
  2
);
assert.equal(
  reviewedVersion.data()?.snapshot?.pricing?.rulesSnapshot?.settingsSnapshot?.depositPct,
  0.3
);
assert.equal(reviewedPortalSnapshot.exists, true);
assert.equal(Object.hasOwn(reviewedPortalSnapshot.data() || {}, "rebooking"), false);

console.log("Exact-version rebook emulator acceptance passed.");
console.log("- cross-tenant staff was denied before any draft write");
console.log("- non-accepted immutable version and occupied deterministic ID failed without orphan writes");
console.log("- concurrent exact retries converged on one quote, one initial version, one portal, and one customer identity");
console.log("- accepted-version provenance ignored browser-supplied customer and quote content");
console.log("- rebook creation retained confirmed catalog revision 1; an unconfirmed revision 2 blocked the review write without a new version");
console.log("- confirmed revision 2 was transactionally repriced into the reviewed quote and immutable version");
console.log("- invalid review failed closed; a trusted later-date edit persisted staff-review evidence");
