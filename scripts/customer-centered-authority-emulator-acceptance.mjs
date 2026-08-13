#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

const require = createRequire(import.meta.url);
const functionsRequire = createRequire(new URL("../functions/package.json", import.meta.url));
const { Webhook } = functionsRequire("standardwebhooks");
const { DEFAULT_DECISION_DEBT_POLICY } = require("../functions/decisionDebt.js");
const revenueAutopilotCore = require("../functions/revenueAutopilot.js");

const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || "").trim();
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const emulatorHubHost = String(process.env.FIREBASE_EMULATOR_HUB || "").trim();
const tokenSecret = String(process.env.REVENUE_AUTOPILOT_TOKEN_SECRET || "").trim();
const webhookSecret = String(process.env.RESEND_WEBHOOK_SECRET || "").trim();

if (!projectId.startsWith("demo-") || !authHost || !firestoreHost || !emulatorHubHost) {
  throw new Error(
    "Customer-centered authority acceptance is emulator-only and requires demo-* Auth, Firestore, Functions, and hub endpoints."
  );
}
assert.equal(process.env.COMMERCIAL_CHANGE_AUTHORITY_ENABLED, "true");
assert.equal(process.env.REVENUE_AUTOPILOT_ENABLED, "true");
assert.equal(process.env.REVENUE_AUTOPILOT_SENDS_ENABLED, "false");
assert.equal(process.env.NOTIFICATIONS_EMAIL_PROVIDER, "none");
assert.ok(tokenSecret.length >= 32, "The emulator-only unsubscribe-token fixture is required.");
assert.match(webhookSecret, /^whsec_[A-Za-z0-9+/=]+$/u);

const emulatorResponse = await fetch(`http://${emulatorHubHost}/emulators`);
assert.equal(emulatorResponse.ok, true, "Firebase emulator hub must be reachable.");
const emulators = await emulatorResponse.json();
const functionsHost = [emulators?.functions?.host, emulators?.functions?.port]
  .filter(Boolean)
  .join(":");
assert.ok(functionsHost, "Functions emulator must be registered with the hub.");

const admin = loadFirebaseAdmin();
if (!admin.getApps().length) admin.initializeApp({ projectId });
const auth = admin.getAuth();
const db = admin.getFirestore();

const REGION = "us-central1";
const ORGANIZATION_ID = "customer-centered-authority-org";
const OTHER_ORGANIZATION_ID = "customer-centered-authority-other-org";
const ADMIN_EMAIL = "authority-admin@local.test";
const OTHER_ADMIN_EMAIL = "authority-other-admin@local.test";
const TEAM_ADMIN_EMAIL = "authority-team-admin@local.test";
const ROLE_TARGET_EMAIL = "authority-role-target@local.test";
const NEW_SALES_EMAIL = "authority-new-sales@local.test";
const STAFF_PASSWORD = "Authority-Emulator-Only-2026!";
const PACKAGE_ID = "authority-package";
const MENU_ITEM_ID = "authority-menu-item";
const EVENT_TYPE_ID = "authority-event-type";

function dateAtOffset(days) {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isoAtOffset(milliseconds) {
  return new Date(Date.now() + milliseconds).toISOString();
}

function requestId(prefix, character) {
  return `${prefix}_${character.repeat(32)}`;
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
      body: JSON.stringify({ email, password: STAFF_PASSWORD, returnSecureToken: true })
    }
  );
  assert.equal(response.ok, true, `Auth emulator sign-in failed for ${email}.`);
  const payload = await response.json();
  assert.ok(payload.idToken);
  return { uid: user.uid, idToken: payload.idToken };
}

async function callFunction(name, idToken, data = {}) {
  const response = await fetch(
    `http://${functionsHost}/${projectId}/${REGION}/${name}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:4174",
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
    throw new Error(`${name} returned ${response.status}: ${responseText.slice(0, 240)}`);
  }
  if (payload?.error) {
    const error = new Error(payload.error.message || `${name} failed.`);
    error.status = String(payload.error.status || "");
    error.details = payload.error.details;
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
  assert.ok(caught, `Expected callable error ${expectedStatus}.`);
  assert.equal(caught.status, expectedStatus);
  return caught;
}

function sourceForm() {
  return {
    name: "Alex Henderson",
    email: "events@henderson.local.test",
    phone: "205-555-0136",
    clientOrg: "Henderson Group",
    eventName: "Henderson Operations Review",
    date: dateAtOffset(5),
    time: "12:00",
    hours: 5,
    guests: 84,
    servers: 2,
    chefs: 1,
    bartenders: 0,
    style: "buffet",
    venue: "Authority Emulator Hall",
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
    taxRegion: "authority-local",
    seasonProfileId: "standard",
    includeDisposables: true
  };
}

const primaryAdmin = await createPrincipal({
  email: ADMIN_EMAIL,
  organizationId: ORGANIZATION_ID
});
const otherAdmin = await createPrincipal({
  email: OTHER_ADMIN_EMAIL,
  organizationId: OTHER_ORGANIZATION_ID
});
const teamAdmin = await createPrincipal({
  email: TEAM_ADMIN_EMAIL,
  organizationId: ORGANIZATION_ID
});
const roleTarget = await auth.createUser({
  email: ROLE_TARGET_EMAIL,
  password: STAFF_PASSWORD,
  emailVerified: true
});
const newSalesTarget = await auth.createUser({
  email: NEW_SALES_EMAIL,
  password: STAFF_PASSWORD,
  emailVerified: true
});
const confirmationAtISO = new Date().toISOString();

await Promise.all([
  db.collection("organizations").doc(ORGANIZATION_ID).set({
    name: "Customer-Centered Authority Emulator",
    ownerUid: primaryAdmin.uid,
    ownerEmail: ADMIN_EMAIL,
    active: true,
    archived: false,
    status: "active"
  }),
  db.collection("organizations").doc(OTHER_ORGANIZATION_ID).set({
    name: "Other Authority Emulator",
    ownerUid: otherAdmin.uid,
    ownerEmail: OTHER_ADMIN_EMAIL,
    active: true,
    archived: false,
    status: "active"
  }),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("settings").doc("config").set({
      catalogRevision: 1,
      pricingSetupConfirmed: true,
      pricingConfirmation: {
        actorUid: primaryAdmin.uid,
        actorEmail: ADMIN_EMAIL,
        confirmedAtISO: confirmationAtISO,
        confirmedCatalogRevision: 1
      },
      businessTimeZone: "America/Chicago",
      commercialChangeAuthorityEnabled: true,
      serviceFeePct: 0.15,
      serviceFeeTiers: [{ id: "authority-standard", minGuests: 0, maxGuests: 9999, pct: 0.15 }],
      taxRate: 0.08,
      taxRegions: [{ id: "authority-local", name: "Authority Local", rate: 0.08 }],
      defaultTaxRegion: "authority-local",
      depositPct: 0.25,
      staffingLaborEnabled: true,
      staffingChargeMode: "per_hour",
      serverRate: 22,
      chefRate: 28,
      bartenderRate: 24,
      quoteValidityDays: 30,
      updatedAtISO: confirmationAtISO
    }),
  db.collection("userRoles").doc(roleTarget.uid).set({
    role: "sales",
    organizationId: ORGANIZATION_ID,
    email: ROLE_TARGET_EMAIL,
    createdAt: admin.FieldValue.serverTimestamp(),
    updatedAt: admin.FieldValue.serverTimestamp()
  }),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("catalogPackages").doc(PACKAGE_ID).set({
      name: "Authority Package",
      description: "Deterministic authority-emulator package",
      pppMinor: 4200,
      active: true
    }),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("menuItems").doc(MENU_ITEM_ID).set({
      name: "Authority Entrée",
      eventTypeId: EVENT_TYPE_ID,
      categoryId: "authority-entrees",
      priceMinor: 0,
      pricingType: "per_event",
      type: "per_event",
      active: true
    })
]);

const created = await callFunction("createQuoteDraft", primaryAdmin.idToken, {
  organizationId: ORGANIZATION_ID,
  form: sourceForm()
});
assert.equal(created.ok, true);
assert.equal(created.activeVersionId, "v0001");
assert.ok(created.id);
assert.ok(created.customerId);
const quoteId = created.id;

await expectCallableError(
  () => callFunction("getCommercialDependencyState", otherAdmin.idToken, {
    organizationId: ORGANIZATION_ID,
    quoteId
  }),
  "PERMISSION_DENIED"
);

const initialDependency = await callFunction(
  "getCommercialDependencyState",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, quoteId }
);
assert.equal(initialDependency.dependencyState.state, "NOT_GENERATED");
assert.equal(initialDependency.dependencyState.safeToPublish, false);

const initialBeoStatus = await callFunction(
  "getKitchenBeoArtifactStatus",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, quoteId }
);
assert.equal(initialBeoStatus.status.state, "NOT_GENERATED");

const initialBeo = await callFunction("generateKitchenBeo", primaryAdmin.idToken, {
  organizationId: ORGANIZATION_ID,
  quoteId,
  requestId: "beo_initial_authority_emulator"
});
assert.equal(initialBeo.ok, true);
assert.match(initialBeo.receipt.receiptId, /^beo_[a-f0-9]{48}$/u);
assert.equal(initialBeo.status.state, "CURRENT");
assert.equal(Buffer.from(initialBeo.artifact.base64, "base64").length, initialBeo.receipt.artifactByteLength);

const initialBeoDownload = await callFunction(
  "downloadKitchenBeoReceipt",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    receiptId: initialBeo.receipt.receiptId
  }
);
assert.equal(initialBeoDownload.receipt.receiptId, initialBeo.receipt.receiptId);
assert.equal(initialBeoDownload.artifact.base64, initialBeo.artifact.base64);

const initialBeoReceiptRef = db.collection("organizations").doc(ORGANIZATION_ID)
  .collection("kitchenBeoGenerationReceipts").doc(initialBeo.receipt.receiptId);
const initialBeoReceiptRecord = (await initialBeoReceiptRef.get()).data() || {};
const originalArtifactBase64 = String(initialBeoReceiptRecord.artifactBase64 || "");
assert.ok(originalArtifactBase64.length > 16);
const tamperIndex = Math.floor(originalArtifactBase64.length / 2);
const tamperedArtifactBase64 = `${originalArtifactBase64.slice(0, tamperIndex)}${
  originalArtifactBase64[tamperIndex] === "A" ? "B" : "A"
}${originalArtifactBase64.slice(tamperIndex + 1)}`;
await initialBeoReceiptRef.update({ artifactBase64: tamperedArtifactBase64 });
try {
  await expectCallableError(
    () => callFunction("generateKitchenBeo", primaryAdmin.idToken, {
      organizationId: ORGANIZATION_ID,
      quoteId,
      requestId: "beo_initial_authority_emulator"
    }),
    "FAILED_PRECONDITION"
  );
  await expectCallableError(
    () => callFunction("downloadKitchenBeoReceipt", primaryAdmin.idToken, {
      organizationId: ORGANIZATION_ID,
      quoteId,
      receiptId: initialBeo.receipt.receiptId
    }),
    "FAILED_PRECONDITION"
  );
} finally {
  await initialBeoReceiptRef.set(initialBeoReceiptRecord);
}

const changedForm = { ...sourceForm(), guests: 126 };
const simulation = await callFunction(
  "simulateCommercialQuoteChange",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    expectedActiveVersionId: created.activeVersionId,
    requestId: requestId("change_sim", "a"),
    form: changedForm
  }
);
assert.equal(simulation.authorityState, "enforced");
assert.equal(simulation.simulationReceipt.authorizationRequired, true);
assert.ok(simulation.simulation.impact.counts.total > 0);

const approval = await callFunction(
  "requestCommercialQuoteChangeAuthorization",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    simulationReceiptId: simulation.simulationReceipt.receiptId,
    requestId: requestId("change_auth_request", "b")
  }
);
assert.equal(approval.approval.state, "pending");

const authorization = await callFunction(
  "authorizeCommercialQuoteChange",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    simulationReceiptId: simulation.simulationReceipt.receiptId,
    requestId: requestId("change_auth", "c")
  }
);
assert.equal(authorization.approval.state, "authorized");
assert.match(authorization.authorizationReceipt.receiptId, /^cca_[a-f0-9]{48}$/u);

const committedApplyRequestId = requestId("change_apply", "d");
const applied = await callFunction("updateQuoteDraft", primaryAdmin.idToken, {
  organizationId: ORGANIZATION_ID,
  quoteId,
  form: changedForm,
  commercialChangeAuthority: {
    simulationReceiptId: simulation.simulationReceipt.receiptId,
    authorizationReceiptId: authorization.authorizationReceipt.receiptId,
    applyRequestId: committedApplyRequestId
  }
});
assert.equal(applied.activeVersionId, "v0002");
assert.equal(applied.commercialChange.authorityState, "enforced");
assert.equal(applied.commercialChange.state, "BLOCKED");
assert.match(applied.commercialChange.applyReceiptId, /^ccp_[a-f0-9]{48}$/u);

const committedApplyOutcome = await callFunction(
  "reconcileCommercialQuoteChangeApplyOutcome",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    simulationReceiptId: simulation.simulationReceipt.receiptId,
    authorizationReceiptId: authorization.authorizationReceipt.receiptId,
    applyRequestId: committedApplyRequestId,
    expectedBaseRevisionId: created.activeVersionId
  }
);
assert.equal(committedApplyOutcome.outcomeReceipt.state, "committed");
assert.equal(committedApplyOutcome.outcomeReceipt.newRevisionId, "v0002");
assert.equal(
  committedApplyOutcome.outcomeReceipt.applyReceiptId,
  applied.commercialChange.applyReceiptId
);
assert.match(committedApplyOutcome.outcomeReceipt.receiptId, /^ccor_[a-f0-9]{48}$/u);
assert.equal(committedApplyOutcome.commercialChange.applyReceiptId, applied.commercialChange.applyReceiptId);
const committedApplyOutcomeReplay = await callFunction(
  "reconcileCommercialQuoteChangeApplyOutcome",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    simulationReceiptId: simulation.simulationReceipt.receiptId,
    authorizationReceiptId: authorization.authorizationReceipt.receiptId,
    applyRequestId: committedApplyRequestId,
    expectedBaseRevisionId: created.activeVersionId
  }
);
assert.equal(committedApplyOutcomeReplay.idempotent, true);
assert.deepEqual(committedApplyOutcomeReplay.outcomeReceipt, committedApplyOutcome.outcomeReceipt);

const fencedForm = { ...changedForm, guests: 127 };
const fencedSimulation = await callFunction(
  "simulateCommercialQuoteChange",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    expectedActiveVersionId: applied.activeVersionId,
    requestId: requestId("change_sim", "e"),
    form: fencedForm
  }
);
const fencedAuthorization = await callFunction(
  "authorizeCommercialQuoteChange",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    simulationReceiptId: fencedSimulation.simulationReceipt.receiptId,
    requestId: requestId("change_auth", "f")
  }
);
const fencedApplyRequestId = requestId("change_apply", "1");
const fencedApplyOutcome = await callFunction(
  "reconcileCommercialQuoteChangeApplyOutcome",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    simulationReceiptId: fencedSimulation.simulationReceipt.receiptId,
    authorizationReceiptId: fencedAuthorization.authorizationReceipt.receiptId,
    applyRequestId: fencedApplyRequestId,
    expectedBaseRevisionId: applied.activeVersionId
  }
);
assert.equal(fencedApplyOutcome.outcomeReceipt.state, "not_committed");
assert.equal(fencedApplyOutcome.commercialChange, null);
assert.match(fencedApplyOutcome.outcomeReceipt.receiptId, /^ccor_[a-f0-9]{48}$/u);
const fencedApplyError = await expectCallableError(
  () => callFunction("updateQuoteDraft", primaryAdmin.idToken, {
    organizationId: ORGANIZATION_ID,
    quoteId,
    form: fencedForm,
    commercialChangeAuthority: {
      simulationReceiptId: fencedSimulation.simulationReceipt.receiptId,
      authorizationReceiptId: fencedAuthorization.authorizationReceipt.receiptId,
      applyRequestId: fencedApplyRequestId
    }
  }),
  "FAILED_PRECONDITION"
);
assert.match(fencedApplyError.message, /permanently fenced/u);
const quoteAfterFenceRef = db.collection("organizations").doc(ORGANIZATION_ID)
  .collection("quotes").doc(quoteId);
const quoteAfterFence = (await quoteAfterFenceRef.get()).data() || {};
assert.equal(quoteAfterFence.activeVersionId, "v0002");
assert.equal((await quoteAfterFenceRef.collection("versions").doc("v0003").get()).exists, false);

const blockedDependency = await callFunction(
  "getCommercialDependencyState",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, quoteId }
);
assert.equal(blockedDependency.dependencyState.state, "BLOCKED");
assert.equal(blockedDependency.dependencyState.safeToPublish, false);
assert.ok(blockedDependency.dependencyState.openInvalidationCount > 1);
const beoInvalidation = blockedDependency.dependencyState.invalidations.find(
  (item) => item.nodeId === "artifact.kitchen_beo" && item.state === "open"
);
const outputInvalidation = blockedDependency.dependencyState.invalidations.find(
  (item) => item.nodeKind === "output" && item.state === "open"
);
assert.ok(beoInvalidation, "Guest-count change must invalidate the Kitchen BEO.");
assert.ok(outputInvalidation, "Guest-count change must create at least one decision invalidation.");

const staleBeo = await callFunction(
  "getKitchenBeoArtifactStatus",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, quoteId }
);
assert.equal(staleBeo.status.state, "STALE");
assert.equal(staleBeo.status.receiptId, initialBeo.receipt.receiptId);

const regeneratedBeo = await callFunction("generateKitchenBeo", primaryAdmin.idToken, {
  organizationId: ORGANIZATION_ID,
  quoteId,
  requestId: "beo_after_authorized_guest_change"
});
assert.equal(regeneratedBeo.receipt.commercialSourceRevisionId, "v0002");
assert.notEqual(regeneratedBeo.receipt.receiptId, initialBeo.receipt.receiptId);
assert.equal(regeneratedBeo.status.state, "CURRENT");
assert.deepEqual(
  regeneratedBeo.dependencyReconciliation.resolvedInvalidationIds,
  [beoInvalidation.invalidationId]
);
assert.equal(regeneratedBeo.dependencyReconciliation.resolvedCount, 1);
assert.equal(regeneratedBeo.receiptHistory.state, "COMPLETE");
assert.deepEqual(
  regeneratedBeo.receiptHistory.receipts.map((receipt) => receipt.receiptId),
  [regeneratedBeo.receipt.receiptId, initialBeo.receipt.receiptId]
);
const priorBeoDownload = await callFunction(
  "downloadKitchenBeoReceipt",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    receiptId: regeneratedBeo.receiptHistory.receipts[1].receiptId
  }
);
assert.equal(priorBeoDownload.receipt.receiptId, initialBeo.receipt.receiptId);
assert.equal(priorBeoDownload.artifact.base64, initialBeo.artifact.base64);

const dependencyAfterBeoGeneration = await callFunction(
  "getCommercialDependencyState",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, quoteId }
);
assert.ok(
  dependencyAfterBeoGeneration.dependencyState.openInvalidationCount
    < blockedDependency.dependencyState.openInvalidationCount
);
assert.equal(dependencyAfterBeoGeneration.dependencyState.safeToPublish, false);
assert.equal(
  dependencyAfterBeoGeneration.dependencyState.invalidations.find(
    (item) => item.invalidationId === beoInvalidation.invalidationId
  )?.state,
  "resolved"
);
assert.equal(
  dependencyAfterBeoGeneration.dependencyState.invalidations.find(
    (item) => item.invalidationId === outputInvalidation.invalidationId
  )?.state,
  "open"
);

const configuredDebt = await callFunction(
  "configureDecisionDebtPolicy",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    requestId: requestId("decision_debt_request", "e"),
    expectedPolicyVersion: "",
    policy: DEFAULT_DECISION_DEBT_POLICY
  }
);
assert.equal(configuredDebt.policyVersion, "decision-debt-policy-r1");
assert.equal(configuredDebt.idempotent, false);

const debtBeforeReconciliation = await callFunction(
  "getDecisionDebtSnapshot",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, quoteId, limit: 50 }
);
assert.equal(debtBeforeReconciliation.snapshot.authority, "server_derived");
assert.equal(debtBeforeReconciliation.snapshot.predictive, false);
assert.ok(debtBeforeReconciliation.snapshot.items.length > 0);
assert.match(debtBeforeReconciliation.snapshot.snapshotDigest, /^[a-f0-9]{64}$/u);
assert.ok(debtBeforeReconciliation.snapshot.items.every((item) => (
  !item.affectedNodeIds.includes("artifact.kitchen_beo")
)));

const reconciliation = await callFunction(
  "reconcileCommercialDependencyState",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    applyReceiptId: applied.commercialChange.applyReceiptId,
    requestId: requestId("change_reconcile", "f"),
    invalidationIds: [outputInvalidation.invalidationId],
    resolutionNote: "Reviewed and resolved the selected guest-count decision."
  }
);
assert.match(reconciliation.reconciliationReceipt.receiptId, /^ccr_[a-f0-9]{48}$/u);
assert.ok(
  reconciliation.dependencyState.openInvalidationCount
    < dependencyAfterBeoGeneration.dependencyState.openInvalidationCount
);
assert.equal(reconciliation.dependencyState.safeToPublish, false);
await expectCallableError(
  () => callFunction(
    "reconcileCommercialDependencyState",
    primaryAdmin.idToken,
    {
      organizationId: ORGANIZATION_ID,
      quoteId,
      applyReceiptId: applied.commercialChange.applyReceiptId,
      requestId: requestId("change_reconcile", "f"),
      invalidationIds: [outputInvalidation.invalidationId],
      resolutionNote: "Changed note must not replay under the same request identity."
    }
  ),
  "ALREADY_EXISTS"
);

const currentBeo = await callFunction(
  "getKitchenBeoArtifactStatus",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, quoteId }
);
assert.equal(currentBeo.status.state, "CURRENT");
assert.equal(currentBeo.status.receiptId, regeneratedBeo.receipt.receiptId);

const debtAfterReconciliation = await callFunction(
  "getDecisionDebtSnapshot",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, quoteId, limit: 50 }
);
assert.ok(
  debtAfterReconciliation.snapshot.items.every((item) => (
    !item.affectedNodeIds.includes("artifact.kitchen_beo")
  ))
);

const quoteRef = db.collection("organizations").doc(ORGANIZATION_ID)
  .collection("quotes").doc(quoteId);
const quoteSnap = await quoteRef.get();
const quote = quoteSnap.data() || {};
const portalKey = quote.portalKey;
const portalRef = db.collection("customerPortalQuotes").doc(portalKey);
const portalSnap = await portalRef.get();
assert.equal(portalSnap.exists, true);
const portal = portalSnap.data() || {};
const providerAcceptedAtISO = isoAtOffset(-60_000);
const revisionId = `${quote.activeVersionId}@${quote.portalIssuedAtISO}`;
const deliveryEvidence = {
  revisionId,
  state: "provider_accepted",
  portalActivationState: "active",
  portalKey,
  portalIssuedAtISO: quote.portalIssuedAtISO,
  providerAcceptedAtISO
};
await Promise.all([
  quoteRef.set({
    status: "sent",
    lifecycle: { ...(quote.lifecycle || {}), sentAtISO: providerAcceptedAtISO },
    workflow: {
      ...(quote.workflow || {}),
      quoteDelivery: {
        ...deliveryEvidence,
        provider: "resend",
        providerMessageId: "emulator-quote-delivery-message"
      }
    },
    updatedAt: admin.FieldValue.serverTimestamp()
  }, { merge: true }),
  portalRef.set({
    status: "sent",
    lifecycle: { ...(portal.lifecycle || {}), sentAtISO: providerAcceptedAtISO },
    deliveryEvidence,
    updatedAt: admin.FieldValue.serverTimestamp()
  }, { merge: true })
]);

const controlsBefore = await callFunction(
  "getRevenueAutopilotCustomerControls",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, customerId: created.customerId }
);
assert.equal(controlsBefore.controls.authorityState, "dormant");

const configuredControls = await callFunction(
  "configureRevenueAutopilotCustomerControls",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    customerId: created.customerId,
    requestId: requestId("ra_request", "1"),
    expectedRevision: 0,
    consentState: "granted",
    subscriptionState: "subscribed"
  }
);
assert.equal(configuredControls.idempotent, false);

const revenuePolicy = {
  enabled: true,
  timeZone: "America/Chicago",
  reviewRequestUrl: "",
  quietHours: { enabled: false, start: "21:00", end: "08:00" },
  maxAttempts: 3,
  kinds: {
    quote_follow_up: true,
    deposit_reminder: true,
    final_balance_reminder: true,
    post_event_review_request: false,
    unread_customer_reply: true
  },
  quoteFollowUpDayOffsets: [2, 5],
  depositReminderDayOffsets: [1, 3],
  finalBalanceReminderDayOffsets: [14, 7, 3]
};
const configuredRevenuePolicy = await callFunction(
  "configureRevenueAutopilotPolicy",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    requestId: requestId("ra_request", "2"),
    expectedPolicyVersion: "unconfigured-v1",
    policy: revenuePolicy
  }
);
assert.equal(configuredRevenuePolicy.idempotent, false);
assert.equal(configuredRevenuePolicy.policyVersion, "policy-r1");
assert.equal(configuredRevenuePolicy.receipt.policyVersion, "policy-r1");

const materialized = await callFunction(
  "materializeRevenueAutopilotJobs",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    requestId: requestId("ra_request", "3")
  }
);
assert.equal(materialized.createdCount, 0);
assert.equal(materialized.updatedCount, 0);
assert.equal(materialized.laneResults.quote_follow_up.state, "blocked");
const materializationReasonCodes =
  materialized.laneResults.quote_follow_up.reasonCodes;
assert.ok(
  materializationReasonCodes.length > 0,
  "Expected the quote follow-up lane to retain its independent materialization blocker."
);
assert.ok(!materializationReasonCodes.includes("global_sends_disabled"));
assert.ok(!materializationReasonCodes.includes("provider_configuration_missing"));
const materializedRetry = await callFunction(
  "materializeRevenueAutopilotJobs",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    requestId: requestId("ra_request", "3")
  }
);
assert.equal(materializedRetry.idempotent, true);
assert.equal(materializedRetry.createdCount, materialized.createdCount);
assert.equal(materializedRetry.updatedCount, materialized.updatedCount);
assert.deepEqual(materializedRetry.laneResults, materialized.laneResults);

const customerMessage = await callFunction(
  "sendQuotePortalConversationMessage",
  "",
  {
    accessMode: "portal",
    portalKey,
    clientRequestId: "customer-authority-reply-0001",
    body: "Please confirm the revised guest count and staffing plan."
  }
);
assert.equal(customerMessage.message.actorType, "customer");

const operationsWithAttention = await callFunction(
  "getRevenueAutopilotOperations",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, quoteId, jobLimit: 20, attentionLimit: 20 }
);
assert.equal(operationsWithAttention.policy.global.enabled, true);
assert.equal(operationsWithAttention.policy.global.sendsEnabled, false);
assert.equal(operationsWithAttention.policy.tenant.enabled, true);
assert.equal(operationsWithAttention.jobs.length, 0);
assert.equal(operationsWithAttention.attention.length, 1);
assert.equal(operationsWithAttention.attention[0].kind, "unread_customer_reply");
assert.equal(operationsWithAttention.attention[0].state, "open");
assert.equal(operationsWithAttention.attention[0].messageId, customerMessage.message.messageId);

const attention = operationsWithAttention.attention[0];
const acknowledgement = await callFunction(
  "acknowledgeRevenueAutopilotReply",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    quoteId,
    attentionId: attention.attentionId,
    messageId: attention.messageId,
    requestId: requestId("ra_request", "4")
  }
);
assert.equal(acknowledgement.idempotent, false);

const operationsAfterAcknowledgement = await callFunction(
  "getRevenueAutopilotOperations",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, quoteId, jobLimit: 20, attentionLimit: 20 }
);
assert.equal(operationsAfterAcknowledgement.attention.length, 0);
assert.equal(operationsAfterAcknowledgement.bounds.totalAttention, 0);
const resolvedAttention = await db.collection("organizations")
  .doc(ORGANIZATION_ID)
  .collection("revenueAutopilotAttention")
  .doc(attention.attentionId)
  .get();
assert.equal(resolvedAttention.exists, true);
assert.equal(resolvedAttention.data()?.type, "unread_customer_reply");
assert.equal(resolvedAttention.data()?.state, "resolved");
assert.equal(
  resolvedAttention.data()?.resolutionReason,
  "customer_reply_acknowledged"
);

await expectCallableError(
  () => callFunction("getRevenueAutopilotCustomerControls", otherAdmin.idToken, {
    organizationId: ORGANIZATION_ID,
    customerId: created.customerId
  }),
  "PERMISSION_DENIED"
);

const revokedControls = await callFunction(
  "configureRevenueAutopilotCustomerControls",
  primaryAdmin.idToken,
  {
    organizationId: ORGANIZATION_ID,
    customerId: created.customerId,
    requestId: requestId("ra_request", "5"),
    expectedRevision: 1,
    consentState: "revoked",
    subscriptionState: "unsubscribed"
  }
);
assert.equal(revokedControls.idempotent, false);
const controlsAfter = await callFunction(
  "getRevenueAutopilotCustomerControls",
  primaryAdmin.idToken,
  { organizationId: ORGANIZATION_ID, customerId: created.customerId }
);
assert.equal(controlsAfter.controls.revision, 2);
assert.equal(controlsAfter.controls.consent.state, "revoked");
assert.equal(controlsAfter.controls.subscription.state, "unsubscribed");

const webhookNowISO = isoAtOffset(-30_000);
const tenantDate = revenueAutopilotCore.tenantCalendarContext({
  nowISO: webhookNowISO,
  timeZone: "America/Chicago"
}).date;
const webhookPlan = revenueAutopilotCore.planRevenueAutopilotMaterialization({
  organizationId: ORGANIZATION_ID,
  quoteId,
  kind: "quote_follow_up",
  scopeKey: revisionId,
  stopScope: { organizationId: ORGANIZATION_ID, quoteId, revisionId },
  evidence: {
    portal: {
      source: "customer_portal_projection",
      organizationId: ORGANIZATION_ID,
      quoteId,
      revisionId,
      state: "sent",
      stateAtISO: providerAcceptedAtISO
    }
  },
  global: { enabled: true, sendsEnabled: true },
  tenantPolicy: {
    enabled: true,
    timeZone: "America/Chicago",
    quietHours: { enabled: false, start: "21:00", end: "08:00" },
    maxAttempts: 3,
    kinds: { quote_follow_up: { enabled: true } }
  },
  controls: {
    consent: {
      evidenceId: "webhook-consent",
      channel: "email",
      state: "granted",
      recordedAtISO: isoAtOffset(-120_000)
    },
    subscription: {
      evidenceId: "webhook-subscription",
      state: "subscribed",
      evaluatedAtISO: isoAtOffset(-120_000)
    },
    suppression: {
      evidenceId: "webhook-suppression",
      state: "clear",
      evaluatedAtISO: isoAtOffset(-120_000)
    },
    provider: {
      evidenceId: "webhook-provider",
      providerId: "resend",
      configurationId: "emulator-provider-configuration",
      state: "configured",
      evaluatedAtISO: isoAtOffset(-120_000)
    }
  },
  occurrences: [{ occurrenceKey: "anchor_plus_0", dueTenantDate: tenantDate }],
  template: {
    templateId: "emulator-webhook-template",
    version: "v1",
    fingerprint: "a".repeat(64)
  },
  policyVersion: "emulator-webhook-policy-v1",
  existingJobs: [],
  nowISO: webhookNowISO
});
assert.equal(webhookPlan.state, "ready");
assert.equal(webhookPlan.create.length, 1);
const claimedJob = revenueAutopilotCore.claimRevenueAutopilotJob({
  job: webhookPlan.create[0],
  attemptId: "emulator-webhook-attempt",
  nowISO: isoAtOffset(-25_000),
  leaseMs: 60_000
});
const providerMessageId = "emulator-resend-provider-message";
const acceptedJob = revenueAutopilotCore.recordRevenueAutopilotProviderAcceptance({
  job: claimedJob,
  provider: "resend",
  providerMessageId,
  nowISO: isoAtOffset(-20_000)
}).job;
const storedControls = (await db.collection("organizations").doc(ORGANIZATION_ID)
  .collection("revenueAutopilotEmailControls").doc(created.customerId).get()).data() || {};
const webhookJob = {
  ...acceptedJob,
  customerId: created.customerId,
  recipientKey: storedControls.recipientKey,
  quoteLabel: quote.quoteNumber,
  customerLabel: quote.customer?.name,
  updatedAtISO: isoAtOffset(-20_000)
};
const webhookJobRef = db.collection("organizations").doc(ORGANIZATION_ID)
  .collection("revenueAutopilotJobs").doc(webhookJob.jobId);
const messageIndexRef = db.collection("revenueAutopilotProviderMessageIndex")
  .doc(createHash("sha256").update(`resend|${providerMessageId}`).digest("hex"));
await Promise.all([
  webhookJobRef.set(webhookJob),
  messageIndexRef.set({
    provider: "resend",
    providerMessageId,
    organizationId: ORGANIZATION_ID,
    quoteId,
    jobId: webhookJob.jobId,
    customerId: created.customerId,
    recipientKey: storedControls.recipientKey,
    providerAcceptedAtISO: webhookJob.providerAcceptedAtISO
  })
]);

function signedWebhook({ eventId, event, tamper = false }) {
  const payload = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = new Webhook(webhookSecret).sign(
    eventId,
    new Date(Number(timestamp) * 1000),
    payload
  );
  return {
    body: tamper ? `${payload} ` : payload,
    headers: {
      "Content-Type": "application/json",
      "svix-id": eventId,
      "svix-timestamp": timestamp,
      "svix-signature": signature
    }
  };
}

async function postWebhook(request) {
  return await fetch(
    `http://${functionsHost}/${projectId}/${REGION}/revenueAutopilotResendWebhook`,
    { method: "POST", headers: request.headers, body: request.body }
  );
}

const deliveredEventId = "resend-emulator-delivered-event";
const deliveredEvent = {
  type: "email.delivered",
  created_at: isoAtOffset(-10_000),
  data: { email_id: providerMessageId, created_at: isoAtOffset(-10_000) }
};
const rejectedTamper = await postWebhook(signedWebhook({
  eventId: deliveredEventId,
  event: deliveredEvent,
  tamper: true
}));
assert.equal(rejectedTamper.status, 400);

const acceptedDelivery = await postWebhook(signedWebhook({
  eventId: deliveredEventId,
  event: deliveredEvent
}));
assert.equal(acceptedDelivery.status, 200);
assert.equal((await acceptedDelivery.json()).received, true);
const deliveredJob = (await webhookJobRef.get()).data() || {};
assert.equal(deliveredJob.state, "delivered");
assert.ok(deliveredJob.deliveredAtISO);

const replayedDelivery = await postWebhook(signedWebhook({
  eventId: deliveredEventId,
  event: deliveredEvent
}));
assert.equal(replayedDelivery.status, 200);
assert.equal((await replayedDelivery.json()).duplicate, true);

const openedEventId = "resend-emulator-opened-event";
const openedEvent = {
  type: "email.opened",
  created_at: new Date().toISOString(),
  data: { email_id: providerMessageId, created_at: new Date().toISOString() }
};
const ignoredOpened = await postWebhook(signedWebhook({
  eventId: openedEventId,
  event: openedEvent
}));
assert.equal(ignoredOpened.status, 200);
assert.equal((await ignoredOpened.json()).ignored, "unsupported_or_unbound_event");
const quoteAfterOpened = (await quoteRef.get()).data() || {};
assert.equal(quoteAfterOpened.status, "sent");
assert.equal(Boolean(quoteAfterOpened.lifecycle?.viewedAtISO), false);
const openedEventRecord = await db.collection("organizations").doc(ORGANIZATION_ID)
  .collection("revenueAutopilotProviderEvents")
  .doc(createHash("sha256").update(`resend|${openedEventId}`).digest("hex"))
  .get();
assert.equal(openedEventRecord.data()?.signatureVerified, true);
assert.equal(
  openedEventRecord.data()?.result,
  "engagement_event_never_establishes_portal_view"
);

const initialRoleRoster = await callFunction(
  "getOrganizationRoleRoster",
  primaryAdmin.idToken,
  {}
);
assert.equal(initialRoleRoster.ok, true);
assert.equal(initialRoleRoster.authority, "owner");
assert.equal(initialRoleRoster.appCheck, "monitoring");
assert.equal(initialRoleRoster.roles.find((row) => row.uid === primaryAdmin.uid)?.owner, true);

const ownerPromotionRequest = {
  requestId: "role-authority-emulator-0001",
  targetEmail: ROLE_TARGET_EMAIL,
  expectedCurrentRole: "sales",
  nextRole: "admin"
};
const ownerPromotion = await callFunction(
  "mutateOrganizationRole",
  primaryAdmin.idToken,
  ownerPromotionRequest
);
assert.equal(ownerPromotion.ok, true);
assert.equal(ownerPromotion.replayed, false);
assert.equal(ownerPromotion.claimsSync.succeeded, true);
assert.equal((await db.collection("userRoles").doc(roleTarget.uid).get()).data()?.role, "admin");
assert.equal((await auth.getUser(roleTarget.uid)).customClaims?.role, "admin");

const replayedPromotion = await callFunction(
  "mutateOrganizationRole",
  primaryAdmin.idToken,
  ownerPromotionRequest
);
assert.equal(replayedPromotion.ok, true);
assert.equal(replayedPromotion.replayed, true);

await expectCallableError(
  () => callFunction("mutateOrganizationRole", teamAdmin.idToken, {
    requestId: "role-authority-emulator-0002",
    targetEmail: ROLE_TARGET_EMAIL,
    expectedCurrentRole: "admin",
    nextRole: "sales"
  }),
  "PERMISSION_DENIED"
);
await expectCallableError(
  () => callFunction("mutateOrganizationRole", primaryAdmin.idToken, {
    requestId: "role-authority-emulator-0003",
    targetEmail: ADMIN_EMAIL,
    expectedCurrentRole: "admin",
    nextRole: "sales"
  }),
  "FAILED_PRECONDITION"
);

const adminSalesGrant = await callFunction(
  "mutateOrganizationRole",
  teamAdmin.idToken,
  {
    requestId: "role-authority-emulator-0004",
    targetEmail: NEW_SALES_EMAIL,
    expectedCurrentRole: "none",
    nextRole: "sales"
  }
);
assert.equal(adminSalesGrant.ok, true);
assert.equal(adminSalesGrant.nextRole, "sales");
assert.equal((await db.collection("userRoles").doc(newSalesTarget.uid).get()).data()?.role, "sales");
assert.equal((await auth.getUser(newSalesTarget.uid)).customClaims?.role, "sales");
const roleReceipt = await db.collection("organizationRoleAuthorityReceipts")
  .doc(ownerPromotionRequest.requestId)
  .get();
assert.equal(roleReceipt.exists, true);
assert.equal(roleReceipt.data()?.actorWasOwner, true);
assert.equal(roleReceipt.data()?.appCheckState, "unavailable");

console.log("Customer-centered authority emulator acceptance passed.");
console.log("- real callables created, authorized, applied, and partially reconciled one governed quote change");
console.log("- immutable Kitchen BEO receipts moved through NOT_GENERATED, CURRENT, STALE, and CURRENT");
console.log("- Decision Debt derived only from exact unresolved persisted dependency evidence");
console.log("- Revenue Autopilot policy and controls persisted while the independent outbound-send gate stayed off");
console.log("- a customer portal reply opened exact Attention and staff acknowledgement resolved it");
console.log("- a signed mock Resend webhook recorded delivery; tampering failed and open did not establish portal view");
console.log("- canonical owner/admin role authority passed promotion, sales grant, replay, cross-authority denial, and owner-demotion denial");
