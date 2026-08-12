#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { initializeApp as initializeClientApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth as getClientAuth,
  signInWithEmailAndPassword
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore as getClientFirestore,
  setDoc,
  updateDoc
} from "firebase/firestore";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

const require = createRequire(import.meta.url);
const {
  buildOperationalStaffingReceiptId,
  deriveOperationalStaffingScheduleFenceRefs
} = require("../functions/operationalStaffingAuthority.js");

const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || "").trim();
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const emulatorHubHost = String(process.env.FIREBASE_EMULATOR_HUB || "").trim();
if (
  !projectId.startsWith("demo-")
  || !authHost
  || !firestoreHost
  || !emulatorHubHost
  || String(process.env.OPERATIONAL_STAFFING_AUTHORITY_ENABLED).toLowerCase() !== "true"
) {
  throw new Error(
    "Operational staffing acceptance is emulator-only and requires its global authority gate."
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
if (!functionsHost) throw new Error("Functions emulator is required.");

const admin = loadFirebaseAdmin();
if (!admin.getApps().length) admin.initializeApp({ projectId });
const auth = admin.getAuth();
const db = admin.getFirestore();

const REGION = "us-central1";
const ORG = "staffing-emulator-org";
const OTHER_ORG = "staffing-emulator-other-org";
const PASSWORD = "Staffing-Emulator-Only-2026!";
const ADMIN_EMAIL = "staffing-admin@local.test";
const SALES_EMAIL = "staffing-sales@local.test";
const CUSTOMER_EMAIL = "staffing-customer@local.test";
const PLATFORM_EMAIL = "staffing-platform@local.test";
const STAFF_A = "staff-avery";
const STAFF_B = "staff-blair";
const PROFILE_AVAILABILITY = [{
  availabilityId: "availability-september-2026",
  source: "operator_recorded",
  state: "available",
  startAtISO: "2026-09-01T00:00:00.000Z",
  endAtISO: "2026-10-01T00:00:00.000Z"
}];

function comparable(value) {
  if (value === null || typeof value === "undefined") return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, comparable(value[key])]));
  }
  return value;
}

async function createPrincipal({ email, role, organizationId, platformAdmin = false }) {
  const user = await auth.createUser({
    email,
    password: PASSWORD,
    emailVerified: true
  });
  await Promise.all([
    db.collection("userRoles").doc(user.uid).set({ role, organizationId, email }),
    auth.setCustomUserClaims(user.uid, {
      role,
      organizationId,
      platformAdmin,
      claimsVersion: 1
    })
  ]);
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true })
    }
  );
  assert.equal(response.ok, true, `Auth emulator sign-in failed for ${email}`);
  const payload = await response.json();
  assert.ok(payload.idToken);
  return { uid: user.uid, email, role, organizationId, idToken: payload.idToken };
}

async function callFunction(name, principal, data = {}) {
  const response = await fetch(
    `http://${functionsHost}/${projectId}/${REGION}/${name}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:4174",
        ...(principal?.idToken ? { Authorization: `Bearer ${principal.idToken}` } : {})
      },
      body: JSON.stringify({ data })
    }
  );
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${name} returned non-JSON (${response.status}): ${raw.slice(0, 180)}`);
  }
  if (payload?.error) {
    const error = new Error(payload.error.message || `${name} failed.`);
    error.status = String(payload.error.status || "");
    throw error;
  }
  return payload?.result || payload?.data || {};
}

async function expectCallableError(action, status, messagePattern) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected callable status ${status}`);
  assert.equal(caught.status, status);
  if (messagePattern) assert.match(caught.message, messagePattern);
  return caught;
}

function quoteRecord(quoteId, event, activeVersionId = "v0014") {
  return {
    id: quoteId,
    organizationId: ORG,
    activeVersionId,
    versionMeta: { versionId: activeVersionId, versionNumber: 14 },
    status: "draft",
    event: { ...event },
    payment: { deposit: { state: "not_requested" } },
    portalKey: `portal-${quoteId}`,
    booking: { confirmationStatus: "not_booked" }
  };
}

async function seedQuote(quoteId, event, { activeVersionId = "v0014", extraVersions = [] } = {}) {
  const quote = quoteRecord(quoteId, event, activeVersionId);
  const quoteRef = db.collection("organizations").doc(ORG).collection("quotes").doc(quoteId);
  await quoteRef.set(quote);
  const versions = [activeVersionId, ...extraVersions];
  await Promise.all(versions.map((versionId) => quoteRef.collection("versions").doc(versionId).set({
    versionId,
    quoteId,
    organizationId: ORG,
    versionNumber: Number(versionId.slice(1)) || 1,
    snapshot: {
      ...quote,
      activeVersionId: versionId,
      versionMeta: { versionId, versionNumber: Number(versionId.slice(1)) || 1 }
    }
  })));
  return quoteRef;
}

function profileRequest(staffId, requestId, overrides = {}) {
  return {
    requestId,
    organizationId: ORG,
    staffId,
    expectedRevision: 0,
    profile: {
      displayName: staffId === STAFF_A ? "Avery R." : "Blair M.",
      active: true,
      capabilities: ["server", "lead"],
      availabilityWindows: PROFILE_AVAILABILITY
    },
    ...overrides
  };
}

function planRequest(snapshot, {
  requestId,
  staffId,
  assignmentId,
  expectedStaffRevision = 1,
  expectedPlanRevision = 0,
  assignments,
  currentStaffIds,
  ...overrides
}) {
  const nextAssignments = assignments ?? [{
    assignmentId,
    staffId,
    role: "server",
    expectedStaffRevision,
    state: "operator_confirmed"
  }];
  const scopedStaff = new Set(currentStaffIds || nextAssignments.map((item) => item.staffId));
  return {
    requestId,
    organizationId: snapshot.organizationId,
    quoteId: snapshot.quoteId,
    expectedQuoteRevisionId: snapshot.activeQuoteRevisionId,
    expectedPlanRevision,
    eventWindow: snapshot.canonicalEventWindow,
    requirements: snapshot.canonicalRequirements,
    assignments: nextAssignments,
    expectedScheduleFences: snapshot.expectedScheduleFences
      .filter((fence) => scopedStaff.has(fence.staffId))
      .map(({ fenceId, revision }) => ({ fenceId, revision })),
    ...overrides
  };
}

async function browserDbFor(principal, name) {
  const app = initializeClientApp({ apiKey: "demo-key", projectId }, name);
  const clientAuth = getClientAuth(app);
  connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
  await signInWithEmailAndPassword(clientAuth, principal.email, PASSWORD);
  const browserDb = getClientFirestore(app);
  const [host, port] = firestoreHost.split(":");
  connectFirestoreEmulator(browserDb, host, Number(port));
  return { app, browserDb };
}

async function expectBrowserDenied(action) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "Expected Firestore rules to deny direct browser access");
  assert.match(String(caught.code || caught.message), /permission-denied|PERMISSION_DENIED/u);
}

const [adminPrincipal, salesPrincipal, customerPrincipal, platformPrincipal] = await Promise.all([
  createPrincipal({ email: ADMIN_EMAIL, role: "admin", organizationId: ORG }),
  createPrincipal({ email: SALES_EMAIL, role: "sales", organizationId: ORG }),
  createPrincipal({ email: CUSTOMER_EMAIL, role: "customer", organizationId: ORG }),
  createPrincipal({
    email: PLATFORM_EMAIL,
    role: "admin",
    organizationId: OTHER_ORG,
    platformAdmin: true
  })
]);

const orgRef = db.collection("organizations").doc(ORG);
const settingsRef = orgRef.collection("settings").doc("config");
await Promise.all([
  orgRef.set({ name: "Staffing Emulator Org", active: true, archived: false, status: "active" }),
  db.collection("organizations").doc(OTHER_ORG).set({
    name: "Other Staffing Emulator Org",
    active: true,
    archived: false,
    status: "active"
  }),
  settingsRef.set({
    businessTimeZone: "America/Chicago",
    operationalStaffingAuthorityEnabled: true
  })
]);

const quoteEvents = {
  primary: { date: "2026-09-12", time: "18:00", hours: 4, servers: 1, chefs: 0, bartenders: 0 },
  overlap: { date: "2026-09-12", time: "20:00", hours: 2, servers: 1, chefs: 0, bartenders: 0 },
  concurrentA: { date: "2026-09-20", time: "18:00", hours: 3, servers: 1, chefs: 0, bartenders: 0 },
  concurrentB: { date: "2026-09-20", time: "18:30", hours: 2, servers: 1, chefs: 0, bartenders: 0 },
  adjacent: { date: "2026-09-20", time: "21:00", hours: 2, servers: 1, chefs: 0, bartenders: 0 },
  atomic: { date: "2026-09-22", time: "18:00", hours: 2, servers: 1, chefs: 0, bartenders: 0 }
};
const quoteRefs = {
  primary: await seedQuote("quote-primary", quoteEvents.primary, { extraVersions: ["v0013"] }),
  overlap: await seedQuote("quote-overlap", quoteEvents.overlap),
  concurrentA: await seedQuote("quote-concurrent-a", quoteEvents.concurrentA),
  concurrentB: await seedQuote("quote-concurrent-b", quoteEvents.concurrentB),
  adjacent: await seedQuote("quote-adjacent", quoteEvents.adjacent),
  atomic: await seedQuote("quote-atomic", quoteEvents.atomic)
};
const portalRef = db.collection("customerPortalQuotes").doc("staffing-emulator-portal");
const beoRef = orgRef.collection("kitchenBeoArtifacts").doc("quote-primary");
await Promise.all([
  portalRef.set({ organizationId: ORG, quoteId: "quote-primary", state: "unchanged" }),
  beoRef.set({ organizationId: ORG, quoteId: "quote-primary", state: "unchanged" })
]);
const protectedBefore = comparable({
  quote: (await quoteRefs.primary.get()).data(),
  portal: (await portalRef.get()).data(),
  beo: (await beoRef.get()).data()
});

await expectCallableError(
  () => callFunction("getOperationalStaffingSnapshot", null, {
    organizationId: ORG,
    quoteId: "quote-primary"
  }),
  "UNAUTHENTICATED",
  /sign in/i
);
await expectCallableError(
  () => callFunction("getOperationalStaffingSnapshot", customerPrincipal, {
    organizationId: ORG,
    quoteId: "quote-primary"
  }),
  "PERMISSION_DENIED",
  /staff role/i
);
await expectCallableError(
  () => callFunction("getOperationalStaffingSnapshot", platformPrincipal, {
    organizationId: ORG,
    quoteId: "quote-primary"
  }),
  "PERMISSION_DENIED",
  /same-organization/i
);

await settingsRef.set({ operationalStaffingAuthorityEnabled: false }, { merge: true });
await expectCallableError(
  () => callFunction("getOperationalStaffingSnapshot", salesPrincipal, {
    organizationId: ORG,
    quoteId: "quote-primary"
  }),
  "FAILED_PRECONDITION",
  /disabled/i
);
await settingsRef.set({ operationalStaffingAuthorityEnabled: true }, { merge: true });

await expectCallableError(
  () => callFunction(
    "configureOperationalStaffProfile",
    salesPrincipal,
    profileRequest(STAFF_A, "profile-sales-denied-0001")
  ),
  "PERMISSION_DENIED",
  /admin role/i
);
const profileARequest = profileRequest(STAFF_A, "profile-command-avery-0001");
const profileA = await callFunction(
  "configureOperationalStaffProfile",
  adminPrincipal,
  profileARequest
);
assert.equal(profileA.ok, true);
assert.equal(profileA.idempotent, false);
assert.equal(profileA.snapshot.staffId, STAFF_A);
assert.equal(profileA.snapshot.revision, 1);
const profileAReplay = await callFunction(
  "configureOperationalStaffProfile",
  adminPrincipal,
  profileARequest
);
assert.equal(profileAReplay.idempotent, true);
assert.equal(profileAReplay.receipt.receiptId, profileA.receipt.receiptId);
await expectCallableError(
  () => callFunction("configureOperationalStaffProfile", adminPrincipal, {
    ...profileARequest,
    profile: { ...profileARequest.profile, displayName: "Collision Name" }
  }),
  "ALREADY_EXISTS",
  /different immutable command evidence/i
);
const profileB = await callFunction(
  "configureOperationalStaffProfile",
  adminPrincipal,
  profileRequest(STAFF_B, "profile-command-blair-0001")
);
assert.equal(profileB.snapshot.revision, 1);
await expectCallableError(
  () => callFunction("configureOperationalStaffProfile", adminPrincipal, profileRequest(
    STAFF_A,
    "profile-command-stale-revision-0001",
    { expectedRevision: 99 }
  )),
  "ABORTED",
  /profile revision changed/i
);

const adminSnapshot = await callFunction("getOperationalStaffingSnapshot", adminPrincipal, {
  organizationId: ORG,
  quoteId: "quote-primary"
});
const salesSnapshot = await callFunction("getOperationalStaffingSnapshot", salesPrincipal, {
  organizationId: ORG,
  quoteId: "quote-primary"
});
assert.equal(adminSnapshot.state, "empty");
assert.equal(salesSnapshot.state, "empty");
assert.deepEqual(adminSnapshot.canonicalEventWindow, {
  startAtISO: "2026-09-12T23:00:00.000Z",
  endAtISO: "2026-09-13T03:00:00.000Z"
});
assert.deepEqual(adminSnapshot.canonicalRequirements, {
  lead: 0,
  server: 1,
  chef: 0,
  bartender: 0
});

const primaryBase = planRequest(adminSnapshot, {
  requestId: "staffing-primary-command-0001",
  staffId: STAFF_A,
  assignmentId: "assignment-primary-avery"
});
await expectCallableError(
  () => callFunction("applyOperationalStaffingPlan", salesPrincipal, {
    ...primaryBase,
    requestId: "staffing-stale-profile-0001",
    assignments: [{ ...primaryBase.assignments[0], expectedStaffRevision: 99 }]
  }),
  "ABORTED",
  /staff profile revision changed/i
);
await expectCallableError(
  () => callFunction("applyOperationalStaffingPlan", salesPrincipal, {
    ...primaryBase,
    requestId: "staffing-forged-window-0001",
    eventWindow: {
      ...primaryBase.eventWindow,
      endAtISO: "2026-09-13T04:00:00.000Z"
    }
  }),
  "ABORTED",
  /canonical quote event window/i
);
await expectCallableError(
  () => callFunction("applyOperationalStaffingPlan", salesPrincipal, {
    ...primaryBase,
    requestId: "staffing-forged-counts-0001",
    requirements: { ...primaryBase.requirements, server: 2 }
  }),
  "ABORTED",
  /canonical commercial quote revision/i
);
await expectCallableError(
  () => callFunction("applyOperationalStaffingPlan", salesPrincipal, {
    ...primaryBase,
    requestId: "staffing-stale-quote-0001",
    expectedQuoteRevisionId: "v0013"
  }),
  "ABORTED",
  /active commercial quote revision changed/i
);
assert.equal((await orgRef.collection("eventStaffingPlans").doc("quote-primary").get()).exists, false);

const appliedPrimary = await callFunction(
  "applyOperationalStaffingPlan",
  salesPrincipal,
  primaryBase
);
assert.equal(appliedPrimary.ok, true);
assert.equal(appliedPrimary.idempotent, false);
assert.equal(appliedPrimary.snapshot.assignmentState, "operator_confirmed");
const replayedPrimary = await callFunction(
  "applyOperationalStaffingPlan",
  salesPrincipal,
  primaryBase
);
assert.equal(replayedPrimary.idempotent, true);
assert.equal(replayedPrimary.receipt.receiptId, appliedPrimary.receipt.receiptId);
await expectCallableError(
  () => callFunction("applyOperationalStaffingPlan", salesPrincipal, {
    ...primaryBase,
    assignments: [{ ...primaryBase.assignments[0], role: "lead" }]
  }),
  "ALREADY_EXISTS",
  /different immutable command evidence/i
);

const primaryAfter = await callFunction("getOperationalStaffingSnapshot", salesPrincipal, {
  organizationId: ORG,
  quoteId: "quote-primary"
});
await expectCallableError(
  () => callFunction("applyOperationalStaffingPlan", salesPrincipal, planRequest(primaryAfter, {
    requestId: "staffing-stale-plan-0001",
    staffId: STAFF_A,
    assignmentId: "assignment-primary-avery-next",
    expectedPlanRevision: 0
  })),
  "ABORTED",
  /plan revision changed/i
);
const staleFenceRequest = planRequest(primaryAfter, {
  requestId: "staffing-stale-fence-0001",
  staffId: STAFF_A,
  assignmentId: "assignment-primary-avery-next",
  expectedPlanRevision: 1
});
staleFenceRequest.expectedScheduleFences = staleFenceRequest.expectedScheduleFences.map((fence) => ({
  ...fence,
  revision: Math.max(0, fence.revision - 1)
}));
await expectCallableError(
  () => callFunction("applyOperationalStaffingPlan", salesPrincipal, staleFenceRequest),
  "ABORTED",
  /schedule fence revision changed/i
);

const overlapSnapshot = await callFunction("getOperationalStaffingSnapshot", salesPrincipal, {
  organizationId: ORG,
  quoteId: "quote-overlap"
});
await expectCallableError(
  () => callFunction("applyOperationalStaffingPlan", salesPrincipal, planRequest(overlapSnapshot, {
    requestId: "staffing-overlap-command-0001",
    staffId: STAFF_A,
    assignmentId: "assignment-overlap-avery"
  })),
  "FAILED_PRECONDITION",
  /overlapping operator-confirmed assignment/i
);

assert.deepEqual(comparable({
  quote: (await quoteRefs.primary.get()).data(),
  portal: (await portalRef.get()).data(),
  beo: (await beoRef.get()).data()
}), protectedBefore);
const primaryPlanCreatedAt = (await orgRef.collection("eventStaffingPlans")
  .doc("quote-primary").get()).data()?.createdAt?.toDate().toISOString();
const oldPrimaryFenceCreatedAt = new Map();
for (const fence of primaryBase.expectedScheduleFences) {
  const stored = (await orgRef.collection("staffingScheduleFences").doc(fence.fenceId).get()).data();
  oldPrimaryFenceCreatedAt.set(fence.fenceId, stored?.createdAt?.toDate().toISOString());
}
const movedEvent = {
  date: "2026-09-15",
  time: "18:00",
  hours: 4,
  servers: 1,
  chefs: 0,
  bartenders: 0
};
const movedQuote = {
  ...(await quoteRefs.primary.get()).data(),
  activeVersionId: "v0015",
  versionMeta: { versionId: "v0015", versionNumber: 15 },
  event: movedEvent
};
await Promise.all([
  quoteRefs.primary.set(movedQuote),
  quoteRefs.primary.collection("versions").doc("v0015").set({
    versionId: "v0015",
    quoteId: "quote-primary",
    organizationId: ORG,
    versionNumber: 15,
    snapshot: { ...movedQuote, id: "quote-primary" }
  })
]);
const movedSnapshot = await callFunction("getOperationalStaffingSnapshot", salesPrincipal, {
  organizationId: ORG,
  quoteId: "quote-primary"
});
assert.equal(movedSnapshot.state, "stale");
for (const oldFence of primaryBase.expectedScheduleFences) {
  assert.equal(
    movedSnapshot.expectedScheduleFences.some((fence) => fence.fenceId === oldFence.fenceId),
    true,
    "A moved active revision must still expose the old plan fence for atomic cleanup"
  );
}
const movedApplied = await callFunction(
  "applyOperationalStaffingPlan",
  adminPrincipal,
  planRequest(movedSnapshot, {
    requestId: "staffing-moved-revision-0001",
    staffId: STAFF_A,
    assignmentId: "assignment-moved-avery",
    expectedPlanRevision: 1
  })
);
assert.equal(movedApplied.snapshot.quoteRevisionId, "v0015");
assert.equal(
  (await orgRef.collection("eventStaffingPlans").doc("quote-primary").get())
    .data()?.createdAt?.toDate().toISOString(),
  primaryPlanCreatedAt
);
for (const oldFence of primaryBase.expectedScheduleFences) {
  const stored = (await orgRef.collection("staffingScheduleFences").doc(oldFence.fenceId).get()).data();
  assert.equal(
    (stored.assignments || []).some((assignment) => assignment.quoteId === "quote-primary"),
    false
  );
  assert.equal(stored.createdAt.toDate().toISOString(), oldPrimaryFenceCreatedAt.get(oldFence.fenceId));
}
const protectedAfterMove = comparable({
  quote: (await quoteRefs.primary.get()).data(),
  portal: (await portalRef.get()).data(),
  beo: (await beoRef.get()).data()
});

const [concurrentSnapshotA, concurrentSnapshotB] = await Promise.all([
  callFunction("getOperationalStaffingSnapshot", salesPrincipal, {
    organizationId: ORG,
    quoteId: "quote-concurrent-a"
  }),
  callFunction("getOperationalStaffingSnapshot", salesPrincipal, {
    organizationId: ORG,
    quoteId: "quote-concurrent-b"
  })
]);
const concurrentRequestA = planRequest(concurrentSnapshotA, {
  requestId: "staffing-concurrent-a-0001",
  staffId: STAFF_B,
  assignmentId: "assignment-concurrent-a-blair"
});
const concurrentRequestB = planRequest(concurrentSnapshotB, {
  requestId: "staffing-concurrent-b-0001",
  staffId: STAFF_B,
  assignmentId: "assignment-concurrent-b-blair"
});
const concurrentResults = await Promise.allSettled([
  callFunction("applyOperationalStaffingPlan", salesPrincipal, concurrentRequestA),
  callFunction("applyOperationalStaffingPlan", salesPrincipal, concurrentRequestB)
]);
assert.equal(concurrentResults.filter((item) => item.status === "fulfilled").length, 1);
assert.equal(concurrentResults.filter((item) => item.status === "rejected").length, 1);
const rejectedConcurrent = concurrentResults.find((item) => item.status === "rejected");
assert.match(rejectedConcurrent.reason.status, /ABORTED|FAILED_PRECONDITION/u);
const winningConcurrentKey = concurrentResults[0].status === "fulfilled" ? "concurrentA" : "concurrentB";
const winningQuoteId = winningConcurrentKey === "concurrentA"
  ? "quote-concurrent-a"
  : "quote-concurrent-b";

const adjacentSnapshot = await callFunction("getOperationalStaffingSnapshot", salesPrincipal, {
  organizationId: ORG,
  quoteId: "quote-adjacent"
});
const adjacentApplied = await callFunction(
  "applyOperationalStaffingPlan",
  salesPrincipal,
  planRequest(adjacentSnapshot, {
    requestId: "staffing-adjacent-command-0001",
    staffId: STAFF_B,
    assignmentId: "assignment-adjacent-blair"
  })
);
assert.equal(adjacentApplied.snapshot.assignments[0].staffId, STAFF_B);

const winningSnapshot = await callFunction("getOperationalStaffingSnapshot", salesPrincipal, {
  organizationId: ORG,
  quoteId: winningQuoteId
});
const clearedWinner = await callFunction(
  "applyOperationalStaffingPlan",
  salesPrincipal,
  planRequest(winningSnapshot, {
    requestId: "staffing-clear-winner-0001",
    assignments: [],
    currentStaffIds: [STAFF_B],
    expectedPlanRevision: 1
  })
);
assert.equal(clearedWinner.snapshot.assignments.length, 0);
for (const output of clearedWinner.receipt.scheduleFenceOutputs) {
  const storedFence = (await orgRef.collection("staffingScheduleFences").doc(output.fenceId).get()).data();
  assert.equal(
    (storedFence.assignments || []).some((assignment) => assignment.quoteId === winningQuoteId),
    false
  );
}

const atomicSnapshot = await callFunction("getOperationalStaffingSnapshot", salesPrincipal, {
  organizationId: ORG,
  quoteId: "quote-atomic"
});
const missingAssignment = {
  assignmentId: "assignment-atomic-missing",
  staffId: "staff-missing",
  role: "server",
  expectedStaffRevision: 1,
  state: "operator_confirmed"
};
const atomicFenceRefs = deriveOperationalStaffingScheduleFenceRefs({
  organizationId: ORG,
  eventWindow: atomicSnapshot.canonicalEventWindow,
  assignments: [missingAssignment]
});
const atomicRequest = {
  requestId: "staffing-atomic-failure-0001",
  organizationId: ORG,
  quoteId: "quote-atomic",
  expectedQuoteRevisionId: atomicSnapshot.activeQuoteRevisionId,
  expectedPlanRevision: 0,
  eventWindow: atomicSnapshot.canonicalEventWindow,
  requirements: atomicSnapshot.canonicalRequirements,
  assignments: [missingAssignment],
  expectedScheduleFences: atomicFenceRefs.map(({ fenceId }) => ({ fenceId, revision: 0 }))
};
await expectCallableError(
  () => callFunction("applyOperationalStaffingPlan", salesPrincipal, atomicRequest),
  "FAILED_PRECONDITION",
  /profile is unavailable/i
);
assert.equal((await orgRef.collection("eventStaffingPlans").doc("quote-atomic").get()).exists, false);
assert.equal(
  (await orgRef.collection("eventStaffingPlans").doc("quote-atomic")
    .collection("versions").doc(buildOperationalStaffingReceiptId(atomicRequest)).get()).exists,
  false
);
for (const ref of atomicFenceRefs) {
  assert.equal((await orgRef.collection("staffingScheduleFences").doc(ref.fenceId).get()).exists, false);
}

const profileCreatedAt = (await orgRef.collection("staffProfiles").doc(STAFF_A).get())
  .data()?.createdAt?.toDate().toISOString();
const updatedProfileA = await callFunction(
  "configureOperationalStaffProfile",
  adminPrincipal,
  profileRequest(STAFF_A, "profile-command-avery-0002", { expectedRevision: 1 })
);
assert.equal(updatedProfileA.snapshot.revision, 2);
assert.equal(
  (await orgRef.collection("staffProfiles").doc(STAFF_A).get())
    .data()?.createdAt?.toDate().toISOString(),
  profileCreatedAt
);

const profileReceiptRef = orgRef.collection("staffProfiles").doc(STAFF_A)
  .collection("versions").doc(profileA.receipt.receiptId);
const planReceiptRef = orgRef.collection("eventStaffingPlans").doc("quote-primary")
  .collection("versions").doc(appliedPrimary.receipt.receiptId);
const [storedProfile, storedProfileReceipt, storedPlan, storedPlanReceipt] = await Promise.all([
  orgRef.collection("staffProfiles").doc(STAFF_A).get(),
  profileReceiptRef.get(),
  orgRef.collection("eventStaffingPlans").doc("quote-primary").get(),
  planReceiptRef.get()
]);
assert.equal(storedProfile.exists, true);
assert.equal(storedProfileReceipt.exists, true);
assert.equal(storedPlan.exists, true);
assert.equal(storedPlanReceipt.exists, true);
assert.equal(typeof storedProfile.data()?.updatedAt?.toDate, "function");
assert.equal(typeof storedProfileReceipt.data()?.createdAt?.toDate, "function");
assert.equal(typeof storedPlan.data()?.updatedAt?.toDate, "function");
assert.equal(typeof storedPlanReceipt.data()?.createdAt?.toDate, "function");
assert.equal(JSON.stringify(storedProfile.data()).includes("@local.test"), false);
assert.equal(JSON.stringify(storedPlan.data()).includes("@local.test"), false);

const browser = await browserDbFor(salesPrincipal, "operational-staffing-rules-client");
const deniedPaths = [
  ["organizations", ORG, "staffProfiles", STAFF_A],
  ["organizations", ORG, "staffProfiles", STAFF_A, "versions", profileA.receipt.receiptId],
  ["organizations", ORG, "eventStaffingPlans", "quote-primary"],
  ["organizations", ORG, "eventStaffingPlans", "quote-primary", "versions", appliedPrimary.receipt.receiptId],
  ["organizations", ORG, "staffingScheduleFences", primaryBase.expectedScheduleFences[0].fenceId]
];
for (const path of deniedPaths) {
  const target = doc(browser.browserDb, ...path);
  await expectBrowserDenied(() => getDoc(target));
  await expectBrowserDenied(() => setDoc(target, { browserOwned: true }));
  await expectBrowserDenied(() => updateDoc(target, { browserOwned: true }));
  await expectBrowserDenied(() => deleteDoc(target));
}
await deleteApp(browser.app);

assert.deepEqual(comparable({
  quote: (await quoteRefs.primary.get()).data(),
  portal: (await portalRef.get()).data(),
  beo: (await beoRef.get()).data()
}), protectedAfterMove);

console.log("Authoritative operational staffing emulator acceptance passed.");
console.log("- global, tenant, role, customer, and exact principal-organization gates failed closed");
console.log("- canonical immutable revision window/count forgery and stale revisions/fences were rejected");
console.log("- profile and plan receipts reconciled exact lost-response retries and rejected collisions");
console.log("- atomic UTC-day fences prevented concurrent overlap and allowed half-open adjacency");
console.log("- a moved active quote revision atomically cleaned old-window fences and preserved createdAt");
console.log("- clearing a plan removed old fence projections without disturbing peer assignments");
console.log("- direct browser access to current docs, nested receipts, and fences was denied");
console.log("- failed commands left no plan, receipt, or fence writes and did not mutate quote/portal/payment/BEO evidence");
