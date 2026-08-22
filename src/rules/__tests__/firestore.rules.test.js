import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, afterAll, describe, expect, test } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  writeBatch
} from "firebase/firestore";

const PROJECT_ID = "demo-quote-wizard-rules";
const RULES_PATH = path.resolve(process.cwd(), "firestore.rules");
const HAS_FIRESTORE_EMULATOR = Boolean(String(process.env.FIRESTORE_EMULATOR_HOST || "").trim());
const VALID_PORTAL_KEY = "abcdefghijklmnopqrstuvwxyz";
const EXPIRED_PORTAL_KEY = "expired-abcdefghijklmnopqrstuvwxyz";
const DELETED_PORTAL_KEY = "deleted-abcdefghijklmnopqrstuvwxyz";
const ACTIVE_PORTAL_EXPIRES_MS = 4102444800000; // 2100-01-01T00:00:00.000Z
const EXPIRED_PORTAL_EXPIRES_MS = 1577836800000; // 2020-01-01T00:00:00.000Z
const PORTAL_ISSUED_AT_ISO = "2026-03-20T00:00:00.000Z";
const PORTAL_DELIVERY_EVIDENCE = {
  revisionId: `v0001@${PORTAL_ISSUED_AT_ISO}`,
  state: "provider_accepted",
  portalActivationState: "active",
  portalKey: VALID_PORTAL_KEY,
  portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
  providerAcceptedAtISO: PORTAL_ISSUED_AT_ISO
};
const RULES_PRICING = {
  pricingVersion: "pricing-v1",
  authority: "server_authoritative",
  calculatedAt: "2026-03-20T00:00:00.000Z",
  inputs: {},
  lineItems: [],
  fees: {},
  tax: {
    rate: 0,
    amount: 0,
    regionId: "local",
    regionName: "Local"
  },
  discountTotal: 0,
  deposit: {
    pct: 0.3,
    amount: 300
  },
  subtotal: 1000,
  grandTotal: 1000,
  rulesSnapshot: {}
};

const ORG_SCOPED_ADMIN_WRITE_CASES = [
  {
    collection: "settings",
    docId: "pricing",
    data: { serviceFeePct: 0.1 }
  },
  {
    collection: "catalogPackages",
    docId: "pkg-basic",
    data: { name: "Basic Package" }
  },
  {
    collection: "catalogAddons",
    docId: "addon-transport",
    data: { name: "Transport Addon" }
  },
  {
    collection: "catalogRentals",
    docId: "rental-table",
    data: { name: "Table Rental" }
  },
  {
    collection: "menuCategories",
    docId: "menu-entrees",
    data: { name: "Entrees" }
  },
  {
    collection: "menuItems",
    docId: "menu-item-1",
    data: { name: "Grilled Salmon" }
  }
];

const SERVER_OWNED_COMMERCIAL_AUTHORITY_PATHS = Object.freeze([
  ["organizations", "org-a", "kitchenBeoArtifacts", "q1"],
  ["organizations", "org-a", "kitchenBeoGenerationReceipts", "beo-receipt-1"],
  ["organizations", "org-a", "commercialChangeSimulations", "ccs-receipt-1"],
  ["organizations", "org-a", "commercialChangeApprovalRequests", "ccar-request-1"],
  ["organizations", "org-a", "commercialChangeAuthorizations", "cca-receipt-1"],
  ["organizations", "org-a", "commercialChangeApplyReceipts", "ccp-receipt-1"],
  ["organizations", "org-a", "commercialChangeApplyOutcomes", "ccor-receipt-1"],
  ["organizations", "org-a", "commercialChangeReconciliationReceipts", "ccr-receipt-1"],
  ["organizations", "org-a", "commercialDependencyState", "q1"],
  [
    "organizations",
    "org-a",
    "commercialDependencyState",
    "q1",
    "invalidations",
    "invalidation-1"
  ],
  ["organizations", "org-a", "decisionDebtPolicies", "current"],
  ["organizations", "org-a", "revenueAutopilotPolicy", "current"],
  ["organizations", "org-a", "revenueAutopilotTemplates", "quote-follow-up-v1"],
  ["organizations", "org-a", "revenueAutopilotJobs", "job-1"],
  ["organizations", "org-a", "revenueAutopilotAttention", "attention-1"],
  ["organizations", "org-a", "revenueAutopilotReceipts", "receipt-1"],
  ["organizations", "org-a", "revenueAutopilotProviderEvents", "provider-event-1"],
  ["organizations", "org-a", "revenueAutopilotEmailControls", "customer-1"],
  ["revenueAutopilotTenants", "org-a"],
  ["revenueAutopilotProviderMessageIndex", "provider-message-1"],
  ["revenueAutopilotSchedulerState", "global"]
]);

const OWNER_SMS_SERVER_ONLY_GLOBAL_COLLECTIONS = Object.freeze([
  ["ownerSmsAttempts", "sms-attempt-org-a-1"],
  ["ownerSmsProviderMessageIndex", "provider-message-org-a-1"],
  ["ownerSmsWebhookReceipts", "webhook-receipt-org-a-1"],
  ["ownerSmsRateLimits", "rate-limit-org-a-1"],
  ["ownerSmsOrganizationState", "organization-state-org-a-1"],
  ["ownerSmsProviderControls", "provider-control-org-a-1"],
  ["ownerSmsOutbox", "outbox-org-a-1"]
]);

const STEWARD_SERVER_ONLY_PATHS = Object.freeze([
  ["organizations", "org-a", "stewardRuns", "run-1"],
  ["organizations", "org-a", "stewardPackets", "packet-1"],
  ["organizations", "org-a", "stewardAuditReceipts", "audit-1"],
  ["organizations", "org-a", "stewardUsageBuckets", "usage-2026-08"],
  ["organizations", "org-a", "stewardEntitlementReceipts", "entitlement-1"],
  ["organizations", "org-a", "stewardClientMemory", "memory-1"],
  ["organizations", "org-a", "stewardPolicies", "policy-v1"],
  ["organizations", "org-a", "stewardDeletionReceipts", "deletion-1"],
  ["organizations", "org-a", "stewardIncidentDirectives", "incident-1"]
]);

test("enumerates every Steward private collection for browser denial coverage", () => {
  expect(STEWARD_SERVER_ONLY_PATHS.map((pathParts) => pathParts.at(-2))).toEqual([
    "stewardRuns",
    "stewardPackets",
    "stewardAuditReceipts",
    "stewardUsageBuckets",
    "stewardEntitlementReceipts",
    "stewardClientMemory",
    "stewardPolicies",
    "stewardDeletionReceipts",
    "stewardIncidentDirectives"
  ]);
});

test("enumerates every owner SMS private collection for browser denial coverage", () => {
  expect(OWNER_SMS_SERVER_ONLY_GLOBAL_COLLECTIONS.map(([collectionName]) => collectionName))
    .toEqual([
      "ownerSmsAttempts",
      "ownerSmsProviderMessageIndex",
      "ownerSmsWebhookReceipts",
      "ownerSmsRateLimits",
      "ownerSmsOrganizationState",
      "ownerSmsProviderControls",
      "ownerSmsOutbox"
    ]);
});

const SERVER_OWNED_OPERATIONAL_STAFFING_PATHS = Object.freeze([
  ["organizations", "org-a", "staffProfiles", "staff-profile-1"],
  ["organizations", "org-a", "staffProfiles", "staff-profile-1", "versions", "version-1"],
  ["organizations", "org-a", "staffRecords", "staff-profile-1"],
  ["organizations", "org-a", "staffRecords", "staff-profile-1", "versions", "version-1"],
  ["organizations", "org-a", "staffInvitations", "staff-invitation-1"],
  ["organizations", "org-a", "staffInvitations", "staff-invitation-1", "staffInvitationReceipts", "dispatch"],
  ["organizations", "org-a", "staffInvitationProviderEvents", "provider-event-1"],
  ["organizations", "org-a", "eventStaffingPlans", "q1"],
  ["organizations", "org-a", "eventStaffingPlans", "q1", "versions", "version-1"],
  ["organizations", "org-a", "staffingScheduleFences", "schedule-fence-1"],
  ["staffInvitationProviderMessageIndex", "provider-message-1"]
]);

const CATALOG_COLLECTIONS = new Set([
  "catalogPackages",
  "catalogAddons",
  "catalogRentals",
  "eventTypes",
  "menuCategories",
  "menuItems"
]);

function addCatalogRevisionAdvance(batch, db, organizationId, nextRevision) {
  batch.set(doc(db, "organizations", organizationId, "settings", "config"), {
    catalogRevision: nextRevision,
    pricingSetupConfirmed: false,
    pricingConfirmation: null,
    updatedAtISO: `2026-08-06T00:00:${String(nextRevision).padStart(2, "0")}.000Z`
  }, { merge: true });
}

let testEnv;

async function seedBaseData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "userRoles", "sales-org-a"), {
      role: "sales",
      email: "sales-a@example.com",
      organizationId: "org-a"
    });
    await setDoc(doc(db, "userRoles", "sales-org-b"), {
      role: "sales",
      email: "sales-b@example.com",
      organizationId: "org-b"
    });
    await setDoc(doc(db, "userRoles", "admin-org-a"), {
      role: "admin",
      email: "admin-a@example.com",
      organizationId: "org-a"
    });
    await setDoc(doc(db, "userRoles", "customer-org-a"), {
      role: "customer",
      email: "customer-a@example.com",
      organizationId: "org-a"
    });
    await setDoc(doc(db, "organizations", "org-a"), {
      name: "Organization A",
      active: true,
      archived: false,
      status: "active"
    });
    await setDoc(doc(db, "organizations", "org-b"), {
      name: "Organization B",
      active: true,
      archived: false,
      status: "active"
    });
    await setDoc(doc(db, "organizations", "org-a", "settings", "config"), {
      brandName: "Organization A",
      plan: "starter",
      featureFlagsLocked: true,
      featureFlagsPaid: ["customerPortal"],
      featureFlags: {
        customerPortal: true,
        integrationsOps: false
      },
      orderId: "order-a"
    });
    await setDoc(doc(db, "organizations", "org-a", "quotes", "q1"), {
      ownerUid: "sales-org-a",
      ownerEmail: "sales-a@example.com",
      organizationId: "org-a",
      customerEmailKey: "customer-a@example.com",
      portalKey: VALID_PORTAL_KEY,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      quoteNumber: "QP-RULES-001",
      customer: {
        name: "Rules Customer",
        email: "rules-customer@example.com"
      },
      event: {
        name: "Rules Event",
        date: "2026-05-01",
        time: "18:00",
        hours: 4,
        guests: 50,
        style: "Buffet",
        venue: "Rules Hall",
        venueAddress: "123 Rules Street",
        dietaryRestrictions: ""
      },
      selection: {
        packageId: "pkg-basic",
        packageName: "Basic Package"
      },
      totals: {
        total: 1000,
        deposit: 0
      },
      payment: {
        depositLink: "",
        depositStatus: "unpaid"
      },
      pricing: RULES_PRICING,
      status: "sent",
      expiresAtISO: "2099-12-31T00:00:00.000Z",
      updatedAtISO: "2026-03-20T00:00:00.000Z",
      lifecycle: {},
      portalDecision: {},
      workflow: {
        quoteDelivery: {
          revisionId: `v0001@${PORTAL_ISSUED_AT_ISO}`,
          state: "provider_accepted",
          provider: "resend",
          providerMessageId: "rules-provider-message-1",
          providerAcceptedAtISO: PORTAL_ISSUED_AT_ISO,
          portalActivationState: "active",
          portalKey: VALID_PORTAL_KEY,
          portalIssuedAtISO: PORTAL_ISSUED_AT_ISO
        }
      },
      latestVersionNumber: 0
    });
    await setDoc(doc(db, "organizations", "org-a", "quotes", "q-expired"), {
      ownerUid: "sales-org-a",
      organizationId: "org-a",
      portalKey: EXPIRED_PORTAL_KEY,
      status: "draft"
    });
    await setDoc(doc(db, "organizations", "org-a", "quotes", "q-deleted"), {
      ownerUid: "sales-org-a",
      organizationId: "org-a",
      portalKey: DELETED_PORTAL_KEY,
      status: "draft"
    });
    await setDoc(doc(db, "customerPortalQuotes", VALID_PORTAL_KEY), {
      portalKey: VALID_PORTAL_KEY,
      quoteId: "q1",
      organizationId: "org-a",
      status: "sent",
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      deliveryEvidence: PORTAL_DELIVERY_EVIDENCE,
      portalExpiresAtMs: ACTIVE_PORTAL_EXPIRES_MS,
      updatedAtISO: "2026-03-20T00:00:00.000Z",
      lifecycle: {}
    });
    await setDoc(doc(db, "customerPortalQuotes", EXPIRED_PORTAL_KEY), {
      portalKey: EXPIRED_PORTAL_KEY,
      quoteId: "q-expired",
      organizationId: "org-a",
      status: "sent",
      portalExpiresAtMs: EXPIRED_PORTAL_EXPIRES_MS,
      updatedAtISO: "2026-03-20T00:00:00.000Z",
      lifecycle: {}
    });
    await setDoc(doc(db, "customerPortalQuotes", DELETED_PORTAL_KEY), {
      portalKey: DELETED_PORTAL_KEY,
      quoteId: "q-deleted",
      organizationId: "org-a",
      status: "deleted",
      portalExpiresAtMs: ACTIVE_PORTAL_EXPIRES_MS,
      updatedAtISO: "2026-03-20T00:00:00.000Z",
      lifecycle: {}
    });
  });
}

function versionRefFor(uid, email, orgId, quoteId = "q1", versionId = "v0001") {
  const db = testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
  return doc(db, "organizations", orgId, "quotes", quoteId, "versions", versionId);
}

function quoteRefFor(uid, email, orgId, quoteId) {
  const db = testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
  return doc(db, "organizations", orgId, "quotes", quoteId);
}

function quoteRefForWithClaims(uid, email, claims = {}, orgId, quoteId) {
  const db = testEnv.authenticatedContext(uid, { email, email_verified: true, ...claims }).firestore();
  return doc(db, "organizations", orgId, "quotes", quoteId);
}

function orgScopedRefFor(uid, email, orgId, collection, docId) {
  const db = testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
  return doc(db, "organizations", orgId, collection, docId);
}

function tenantDomainRefFor(uid, email, claims = {}, hostname = "tenant-a.mbmapps.com") {
  const db = testEnv.authenticatedContext(uid, { email, email_verified: true, ...claims }).firestore();
  return doc(db, "tenantDomains", hostname);
}

function portalSnapshotRefFor(portalKey) {
  const db = testEnv.unauthenticatedContext().firestore();
  return doc(db, "customerPortalQuotes", portalKey);
}

function portalQuoteRefFor(orgId, quoteId) {
  const db = testEnv.unauthenticatedContext().firestore();
  return doc(db, "organizations", orgId, "quotes", quoteId);
}

function updatePortalPair(portalKey, organizationId, quoteId, patch) {
  const db = testEnv.unauthenticatedContext().firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, "customerPortalQuotes", portalKey), patch);
  batch.update(doc(db, "organizations", organizationId, "quotes", quoteId), patch);
  return batch.commit();
}

function updatePortalPairWithPatches(portalKey, organizationId, quoteId, portalPatch, quotePatch) {
  const db = testEnv.unauthenticatedContext().firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, "customerPortalQuotes", portalKey), portalPatch);
  batch.update(doc(db, "organizations", organizationId, "quotes", quoteId), quotePatch);
  return batch.commit();
}

function buildQuotePayload(ownerUid, organizationId, overrides = {}) {
  const createdAtISO = "2026-03-20T00:00:00.000Z";
  return {
    ownerUid,
    organizationId,
    portalKey: VALID_PORTAL_KEY,
    quoteNumber: "QP-RULES-001",
    status: "draft",
    customer: {
      name: "Rules Customer",
      email: "rules-customer@example.com"
    },
    event: {
      name: "Rules Event",
      date: "2026-05-01",
      guests: 50
    },
    selection: {
      packageId: "pkg-basic",
      packageName: "Basic Package"
    },
    totals: {
      total: 1000,
      deposit: 0
    },
    pricing: {
      authority: "server_authoritative",
      subtotal: 1000,
      grandTotal: 1000
    },
    portalDecision: {},
    lifecycle: {
      draftAtISO: createdAtISO
    },
    createdAtISO,
    ...overrides
  };
}

function buildVersionPayload(overrides = {}) {
  return {
    quoteId: "q1",
    organizationId: "org-a",
    versionId: "v0001",
    versionNumber: 1,
    createdAtISO: "2026-03-20T00:00:00.000Z",
    reason: "test",
    status: "sent",
    createdBy: {
      uid: "sales-org-a",
      email: "sales-a@example.com",
      role: "sales"
    },
    pricing: RULES_PRICING,
    snapshot: {
      id: "q1",
      organizationId: "org-a",
      quoteNumber: "QP-RULES-001",
      portalKey: VALID_PORTAL_KEY,
      ownerUid: "sales-org-a",
      ownerEmail: "sales-a@example.com",
      customer: {
        name: "Rules Customer",
        email: "rules-customer@example.com"
      },
      event: {
        name: "Rules Event",
        date: "2026-05-01",
        time: "18:00",
        hours: 4,
        guests: 50,
        style: "Buffet",
        venue: "Rules Hall",
        venueAddress: "123 Rules Street",
        dietaryRestrictions: ""
      },
      selection: {
        packageId: "pkg-basic",
        packageName: "Basic Package"
      },
      totals: {
        total: 1000,
        deposit: 0
      },
      pricing: RULES_PRICING,
      payment: {
        depositLink: "",
        depositStatus: "unpaid"
      },
      status: "sent"
    },
    ...overrides
  };
}

async function createOwnVersion() {
  const db = testEnv.authenticatedContext("sales-org-a", {
    email: "sales-a@example.com",
    email_verified: true
  }).firestore();
  const versionRef = doc(db, "organizations", "org-a", "quotes", "q1", "versions", "v0001");
  const quoteRef = doc(db, "organizations", "org-a", "quotes", "q1");
  const batch = writeBatch(db);
  batch.set(versionRef, buildVersionPayload());
  batch.update(quoteRef, {
    latestVersionNumber: 1,
    versionMeta: {
      versionId: "v0001",
      versionNumber: 1,
      createdAt: "2026-03-20T00:00:00.000Z",
      createdBy: {
        uid: "sales-org-a",
        email: "sales-a@example.com",
        role: "sales"
      },
      reason: "test"
    }
  });
  await batch.commit();
  return versionRef;
}

function buildCanonicalPortalPayload(overrides = {}) {
  return {
    portalKey: VALID_PORTAL_KEY,
    quoteId: "q1",
    organizationId: "org-a",
    portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
    deliveryEvidence: PORTAL_DELIVERY_EVIDENCE,
    quoteNumber: "QP-RULES-001",
    customerName: "Rules Customer",
    customerEmail: "rules-customer@example.com",
    eventName: "Rules Event",
    eventDate: "2026-05-01",
    eventTime: "18:00",
    eventHours: 4,
    eventGuests: 50,
    eventStyle: "Buffet",
    venue: "Rules Hall",
    venueAddress: "123 Rules Street",
    dietaryRestrictions: "",
    total: 1000,
    deposit: 0,
    status: "sent",
    expiresAtISO: "2099-12-31T00:00:00.000Z",
    portalExpiresAtMs: ACTIVE_PORTAL_EXPIRES_MS,
    payment: {
      depositLink: "",
      depositStatus: "unpaid"
    },
    portalDecision: {},
    lifecycle: {},
    ...overrides
  };
}

async function assertOrgScopedWritesFail(uid, email, orgId, cases = ORG_SCOPED_ADMIN_WRITE_CASES) {
  for (const { collection, docId, data } of cases) {
    const ref = orgScopedRefFor(uid, email, orgId, collection, docId);
    await assertFails(setDoc(ref, data));
  }
}

const rulesDescribe = HAS_FIRESTORE_EMULATOR ? describe : describe.skip;

rulesDescribe("firestore rules - org scoped access controls", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: fs.readFileSync(RULES_PATH, "utf8")
      }
    });
  }, 30_000);

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedBaseData();
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
  }, 30_000);

  test("org staff can create and read version docs in own org", async () => {
    const ref = await assertSucceeds(createOwnVersion());
    await assertSucceeds(getDoc(ref));
  });

  test("version authorship follows the authenticated actor, not the quote owner", async () => {
    const db = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    const versionRef = doc(
      db,
      "organizations",
      "org-a",
      "quotes",
      "q1",
      "versions",
      "v0001"
    );
    const quoteRef = doc(db, "organizations", "org-a", "quotes", "q1");
    const createdBy = {
      uid: "admin-org-a",
      email: "admin-a@example.com",
      role: "admin"
    };
    const batch = writeBatch(db);
    batch.set(versionRef, buildVersionPayload({ createdBy }));
    batch.update(quoteRef, {
      latestVersionNumber: 1,
      versionMeta: {
        versionId: "v0001",
        versionNumber: 1,
        createdAt: "2026-03-20T00:00:00.000Z",
        createdBy,
        reason: "test"
      }
    });

    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(versionRef));
  });

  test("version identity must match the canonical quote customer", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(
        doc(context.firestore(), "organizations", "org-a", "quotes", "q1"),
        { customerId: "customer-a" }
      );
    });

    const db = testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: true
    }).firestore();
    const versionRef = doc(
      db,
      "organizations",
      "org-a",
      "quotes",
      "q1",
      "versions",
      "v0001"
    );
    const quoteRef = doc(db, "organizations", "org-a", "quotes", "q1");
    const quotePointer = {
      latestVersionNumber: 1,
      versionMeta: {
        versionId: "v0001",
        versionNumber: 1,
        createdAt: "2026-03-20T00:00:00.000Z",
        createdBy: {
          uid: "sales-org-a",
          email: "sales-a@example.com",
          role: "sales"
        },
        reason: "test"
      }
    };

    const missingIdentityBatch = writeBatch(db);
    missingIdentityBatch.set(versionRef, buildVersionPayload());
    missingIdentityBatch.update(quoteRef, quotePointer);
    await assertFails(missingIdentityBatch.commit());

    const baseVersion = buildVersionPayload();
    const mismatchedIdentityBatch = writeBatch(db);
    mismatchedIdentityBatch.set(versionRef, {
      ...baseVersion,
      customerId: "customer-b",
      snapshot: {
        ...baseVersion.snapshot,
        customerId: "customer-b"
      }
    });
    mismatchedIdentityBatch.update(quoteRef, quotePointer);
    await assertFails(mismatchedIdentityBatch.commit());

    const matchingIdentityBatch = writeBatch(db);
    matchingIdentityBatch.set(versionRef, {
      ...baseVersion,
      customerId: "customer-a",
      snapshot: {
        ...baseVersion.snapshot,
        customerId: "customer-a"
      }
    });
    matchingIdentityBatch.update(quoteRef, quotePointer);
    await assertSucceeds(matchingIdentityBatch.commit());
  });

  test("version docs are immutable after create", async () => {
    const ref = await assertSucceeds(createOwnVersion());

    await assertFails(updateDoc(ref, { reason: "mutated" }));
    await assertFails(deleteDoc(ref));
  });

  test("version snapshots cannot forge payment provider evidence", async () => {
    const db = testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: true
    }).firestore();
    const versionRef = doc(db, "organizations", "org-a", "quotes", "q1", "versions", "v0001");
    const quoteRef = doc(db, "organizations", "org-a", "quotes", "q1");
    const version = buildVersionPayload();
    const batch = writeBatch(db);
    batch.set(versionRef, {
      ...version,
      snapshot: {
        ...version.snapshot,
        payment: {
          ...version.snapshot.payment,
          depositLink: "https://buy.stripe.com/forged-version",
          stripeSessionId: "cs_forged_version",
          lastEventType: "checkout.session.completed"
        }
      }
    });
    batch.update(quoteRef, {
      latestVersionNumber: 1,
      versionMeta: {
        versionId: "v0001",
        versionNumber: 1,
        createdAt: "2026-03-20T00:00:00.000Z",
        createdBy: version.createdBy,
        reason: "test"
      }
    });

    await assertFails(batch.commit());
  });

  test("browser staff cannot create or forge customer portal projections", async () => {
    const db = testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: true
    }).firestore();
    const portalRef = doc(db, "customerPortalQuotes", VALID_PORTAL_KEY);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), "customerPortalQuotes", VALID_PORTAL_KEY));
    });
    await assertFails(setDoc(portalRef, buildCanonicalPortalPayload()));
    await assertFails(setDoc(portalRef, buildCanonicalPortalPayload({
      total: 1
    })));
    await assertFails(setDoc(portalRef, buildCanonicalPortalPayload({
      payment: {
        depositLink: "https://checkout.stripe.com/c/pay/client-injected",
        depositStatus: "unpaid"
      }
    })));
    await assertFails(setDoc(portalRef, buildCanonicalPortalPayload({
      payment: {
        depositLink: "",
        stripeSessionId: "cs_client_injected",
        depositStatus: "unpaid"
      }
    })));
    await assertFails(setDoc(portalRef, buildCanonicalPortalPayload({
      deliveryEvidence: {
        ...PORTAL_DELIVERY_EVIDENCE,
        providerAcceptedAtISO: "2026-03-22T00:00:00.000Z"
      }
    })));
    await assertFails(setDoc(portalRef, buildCanonicalPortalPayload({
      portalExpiresAtISO: "2199-12-31T00:00:00.000Z",
      portalExpiresAtMs: 7258118400000
    })));
    for (const [field, value] of Object.entries({
      lastCheckoutCreatedAtISO: "2026-03-22T00:00:00.000Z",
      lastHost: "quotepilot.mbmapps.com",
      lastEventType: "checkout.session.created",
      lastOrganizationId: "org-a",
      checkoutGeneration: 1
    })) {
      await assertFails(setDoc(portalRef, buildCanonicalPortalPayload({
        payment: {
          depositLink: "",
          depositStatus: "unpaid",
          [field]: value
        }
      })));
    }
  });

  test("cross-org staff and customers cannot create/read org version docs", async () => {
    const crossOrgRef = versionRefFor("sales-org-a", "sales-a@example.com", "org-b", "q1", "v0001");
    await assertFails(setDoc(crossOrgRef, buildVersionPayload({
      organizationId: "org-b"
    })));

    const customerRef = versionRefFor("customer-org-a", "customer-a@example.com", "org-a", "q1", "v0001");
    await assertFails(setDoc(customerRef, buildVersionPayload()));
    await assertFails(getDoc(customerRef));
  });

  test("canonical quotes are staff-readable only while exact-token portal reads continue", async () => {
    const quotePath = ["organizations", "org-a", "quotes", "q1"];
    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    const salesDb = testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: true
    }).firestore();
    const customerDb = testEnv.authenticatedContext("customer-org-a", {
      email: "customer-a@example.com",
      email_verified: true
    }).firestore();
    const unassignedDb = testEnv.authenticatedContext("unassigned-customer", {
      email: "customer-a@example.com",
      email_verified: true
    }).firestore();
    const foreignDb = testEnv.authenticatedContext("sales-org-b", {
      email: "sales-b@example.com",
      email_verified: true
    }).firestore();
    const publicDb = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(adminDb, ...quotePath)));
    await assertSucceeds(getDoc(doc(salesDb, ...quotePath)));
    await assertFails(getDoc(doc(customerDb, ...quotePath)));
    await assertFails(getDoc(doc(unassignedDb, ...quotePath)));
    await assertFails(getDoc(doc(foreignDb, ...quotePath)));
    await assertFails(getDoc(doc(publicDb, ...quotePath)));
    await assertSucceeds(getDoc(doc(publicDb, "customerPortalQuotes", VALID_PORTAL_KEY)));
  });

  test("browser principals cannot create customer role documents", async () => {
    const customerDb = testEnv.authenticatedContext("new-customer", {
      email: "new-customer@example.com",
      email_verified: true
    }).firestore();
    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();

    await assertFails(setDoc(doc(customerDb, "userRoles", "new-customer"), {
      role: "customer",
      email: "new-customer@example.com",
      organizationId: "org-a"
    }));
    await assertFails(setDoc(doc(adminDb, "userRoles", "admin-created-customer"), {
      role: "customer",
      email: "customer@example.com",
      organizationId: "org-a"
    }));
  });

  test("customer projections and imported customer identity are server-owned", async () => {
    const adminProjectedRef = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "customers",
      "email-projected"
    );
    const salesProjectedRef = orgScopedRefFor(
      "sales-org-a",
      "sales-a@example.com",
      "org-a",
      "customers",
      "email-projected"
    );
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "organizations", "org-a", "customers", "email-projected"), {
        customerId: "email-projected",
        organizationId: "org-a",
        name: "Projected Customer",
        email: "projected@example.com",
        recordSource: "trusted_quote_projection",
        lastQuoteId: "q1"
      });
    });

    await assertSucceeds(getDoc(adminProjectedRef));
    await assertSucceeds(getDoc(salesProjectedRef));
    await assertFails(updateDoc(adminProjectedRef, { lastQuoteId: "forged" }));
    await assertFails(deleteDoc(adminProjectedRef));

    const adminImportRef = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "customers",
      "imported-customer"
    );
    const salesImportRef = orgScopedRefFor(
      "sales-org-a",
      "sales-a@example.com",
      "org-a",
      "customers",
      "sales-import"
    );
    const importRecord = {
      organizationId: "org-a",
      name: "Imported Customer",
      email: "imported@example.com",
      importSource: "import_studio",
      importBatchId: "batch-a"
    };
    await assertFails(setDoc(salesImportRef, importRecord));
    await assertFails(setDoc(adminImportRef, {
      ...importRecord,
      lastQuoteId: "forged"
    }));
    await assertFails(setDoc(adminImportRef, {
      ...importRecord,
      nameKey: "browser-forged-search-key",
      emailKey: "imported@example.com"
    }));
    await assertFails(setDoc(adminImportRef, importRecord));
    await assertFails(updateDoc(adminImportRef, { name: "Browser edit" }));
    await assertFails(deleteDoc(adminImportRef));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "organizations", "org-a", "customers", "imported-customer"), {
        ...importRecord,
        customerId: "imported-customer",
        nameKey: "imported customer",
        emailKey: "imported@example.com",
        recordSource: "import_studio",
        importBaselineHash: "server-owned-baseline"
      });
    });
    await assertSucceeds(getDoc(adminImportRef));
    await assertFails(updateDoc(adminImportRef, { nameKey: "forged" }));
    await assertFails(deleteDoc(adminImportRef));
  });

  test("customer directory lists require same-org staff and an explicit safe limit", async () => {
    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    const salesDb = testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: true
    }).firestore();
    const customerDb = testEnv.authenticatedContext("customer-org-a", {
      email: "customer-a@example.com",
      email_verified: true
    }).firestore();
    const foreignDb = testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: true
    }).firestore();
    const adminCustomers = collection(adminDb, "organizations", "org-a", "customers");
    const salesCustomers = collection(salesDb, "organizations", "org-a", "customers");

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "organizations", "org-a", "customers", "directory-a"), {
        customerId: "directory-a",
        organizationId: "org-a",
        name: "Directory Customer",
        nameKey: "directory customer",
        email: "directory@example.com",
        emailKey: "directory@example.com"
      });
    });

    await assertSucceeds(getDocs(query(adminCustomers, limit(101))));
    await assertSucceeds(getDocs(query(salesCustomers, limit(101))));
    await assertFails(getDocs(adminCustomers));
    await assertFails(getDocs(query(adminCustomers, limit(102))));
    await assertFails(getDocs(query(
      collection(customerDb, "organizations", "org-a", "customers"),
      limit(101)
    )));
    await assertFails(getDocs(query(
      collection(foreignDb, "organizations", "org-b", "customers"),
      limit(101)
    )));
  });

  test("customer email claim documents are inaccessible to every browser principal", async () => {
    const claimPath = [
      "organizations",
      "org-a",
      "customerEmailClaims",
      "email_claim_a"
    ];
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), ...claimPath), {
        organizationId: "org-a",
        customerId: "directory-a",
        emailKey: "directory@example.com"
      });
    });
    const contexts = [
      testEnv.unauthenticatedContext().firestore(),
      testEnv.authenticatedContext("admin-org-a", {
        email: "admin-a@example.com",
        email_verified: true
      }).firestore(),
      testEnv.authenticatedContext("sales-org-a", {
        email: "sales-a@example.com",
        email_verified: true
      }).firestore(),
      testEnv.authenticatedContext("customer-org-a", {
        email: "customer-a@example.com",
        email_verified: true
      }).firestore(),
      testEnv.authenticatedContext("unassigned-user", {
        email: "unassigned@example.com",
        email_verified: true
      }).firestore(),
      testEnv.authenticatedContext("sales-org-b", {
        email: "sales-b@example.com",
        email_verified: true
      }).firestore()
    ];

    for (const browserDb of contexts) {
      await assertFails(getDoc(doc(browserDb, ...claimPath)));
      await assertFails(getDocs(query(
        collection(browserDb, "organizations", "org-a", "customerEmailClaims"),
        limit(1)
      )));
    }

    const adminDb = contexts[1];
    const adminClaimRef = doc(adminDb, ...claimPath);
    await assertFails(setDoc(doc(
      adminDb,
      "organizations",
      "org-a",
      "customerEmailClaims",
      "browser-forged"
    ), {
      organizationId: "org-a",
      customerId: "browser-forged",
      emailKey: "forged@example.com"
    }));
    await assertFails(updateDoc(adminClaimRef, { customerId: "browser-forged" }));
    await assertFails(deleteDoc(adminClaimRef));
  });

  test("org-a admin can write own org paths but cannot write org-b quotes/catalog/menu/settings", async () => {
    const ownOrgQuoteRef = quoteRefFor("admin-org-a", "admin-a@example.com", "org-a", "q-admin-own");
    await assertFails(setDoc(ownOrgQuoteRef, buildQuotePayload("admin-org-a", "org-a")));

    const crossOrgQuoteRef = quoteRefFor("admin-org-a", "admin-a@example.com", "org-b", "q-admin-cross");
    await assertFails(setDoc(crossOrgQuoteRef, buildQuotePayload("admin-org-a", "org-b")));

    const ownOrgDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    let catalogRevision = 0;
    for (const { collection, docId, data } of ORG_SCOPED_ADMIN_WRITE_CASES) {
      const ownOrgRef = orgScopedRefFor("admin-org-a", "admin-a@example.com", "org-a", collection, docId);
      if (CATALOG_COLLECTIONS.has(collection)) {
        catalogRevision += 1;
        const batch = writeBatch(ownOrgDb);
        batch.set(doc(ownOrgDb, "organizations", "org-a", collection, docId), data);
        addCatalogRevisionAdvance(batch, ownOrgDb, "org-a", catalogRevision);
        await assertSucceeds(batch.commit());
      } else {
        await assertSucceeds(setDoc(ownOrgRef, data));
      }

      const crossOrgRef = orgScopedRefFor("admin-org-a", "admin-a@example.com", "org-b", collection, docId);
      await assertFails(setDoc(crossOrgRef, data));
    }
  });

  test("menu removal is callable-only while ordinary edits and reactivation remain admin-scoped", async () => {
    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    const activeRef = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "menuItems",
      "managed-active"
    );
    const createBatch = writeBatch(adminDb);
    createBatch.set(doc(adminDb, "organizations", "org-a", "menuItems", "managed-active"), {
      name: "Managed entrée",
      active: true,
      priceMinor: 1500,
      pricingType: "per_event"
    });
    addCatalogRevisionAdvance(createBatch, adminDb, "org-a", 1);
    await assertSucceeds(createBatch.commit());

    const editBatch = writeBatch(adminDb);
    editBatch.update(doc(adminDb, "organizations", "org-a", "menuItems", "managed-active"), {
      name: "Managed entree"
    });
    addCatalogRevisionAdvance(editBatch, adminDb, "org-a", 2);
    await assertSucceeds(editBatch.commit());
    await assertFails(updateDoc(activeRef, { active: false }));
    await assertFails(deleteDoc(activeRef));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "organizations", "org-a", "menuItems", "managed-inactive"),
        { name: "Inactive entrée", active: false, priceMinor: 1200, pricingType: "per_event" }
      );
    });
    const inactiveRef = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "menuItems",
      "managed-inactive"
    );
    const reactivateBatch = writeBatch(adminDb);
    reactivateBatch.update(doc(adminDb, "organizations", "org-a", "menuItems", "managed-inactive"), {
      active: true
    });
    addCatalogRevisionAdvance(reactivateBatch, adminDb, "org-a", 3);
    await assertSucceeds(reactivateBatch.commit());
  });

  test("catalog and pricing edits atomically advance revision and preserve pack provenance", async () => {
    const db = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    const settingsRef = doc(db, "organizations", "org-a", "settings", "config");
    const packageRef = doc(db, "organizations", "org-a", "catalogPackages", "guarded-package");

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, "organizations", "org-a", "settings", "config"), {
        catalogRevision: 10,
        pricingSetupConfirmed: true,
        pricingConfirmation: {
          actorUid: "admin-org-a",
          actorEmail: "admin-a@example.com",
          confirmedAtISO: "2026-08-06T00:00:00.000Z",
          confirmedCatalogRevision: 10
        },
        serviceFeePct: 0.2,
        brandName: "Organization A"
      }, { merge: true });
      await setDoc(doc(adminDb, "organizations", "org-a", "catalogPackages", "guarded-package"), {
        name: "Guarded Package",
        pppMinor: 2500,
        active: true,
        source: "starter-catalog-pack",
        starterPackId: "wedding-events",
        starterPackVersion: 2,
        starterPackBaselineHash: "baseline-hash",
        starterPackCatalogRevision: 10
      });
    });

    await assertFails(updateDoc(packageRef, { pppMinor: 2600 }));
    await assertFails(updateDoc(settingsRef, { serviceFeePct: 0.25 }));
    await assertSucceeds(updateDoc(settingsRef, { brandName: "Admin-Managed Brand" }));
    await assertFails(updateDoc(settingsRef, {
      starterCatalogPack: { id: "corporate-drop-off", version: 2 }
    }));
    await assertFails(updateDoc(settingsRef, {
      catalogRevision: 12,
      pricingSetupConfirmed: false,
      pricingConfirmation: null
    }));

    const priceBatch = writeBatch(db);
    priceBatch.update(packageRef, { pppMinor: 2600 });
    addCatalogRevisionAdvance(priceBatch, db, "org-a", 11);
    await assertSucceeds(priceBatch.commit());

    const provenanceBatch = writeBatch(db);
    provenanceBatch.update(packageRef, { starterPackBaselineHash: "forged" });
    addCatalogRevisionAdvance(provenanceBatch, db, "org-a", 12);
    await assertFails(provenanceBatch.commit());

    const pricingBatch = writeBatch(db);
    pricingBatch.update(settingsRef, { serviceFeePct: 0.25 });
    addCatalogRevisionAdvance(pricingBatch, db, "org-a", 12);
    await assertSucceeds(pricingBatch.commit());

    const forgedCreateBatch = writeBatch(db);
    forgedCreateBatch.set(
      doc(db, "organizations", "org-a", "catalogPackages", "forged-pack-record"),
      {
        name: "Forged",
        pppMinor: 1000,
        source: "starter-catalog-pack",
        starterPackId: "wedding-events"
      }
    );
    addCatalogRevisionAdvance(forgedCreateBatch, db, "org-a", 13);
    await assertFails(forgedCreateBatch.commit());

    const canonicalSeedBatch = writeBatch(db);
    canonicalSeedBatch.set(doc(db, "organizations", "org-a", "eventTypes", "seeded-event"), {
      name: "Seeded Event"
    });
    canonicalSeedBatch.set(doc(db, "organizations", "org-a", "menuCategories", "seeded-category"), {
      eventTypeId: "seeded-event",
      name: "Entrées",
      source: "canonical-menu-seed"
    });
    canonicalSeedBatch.set(doc(db, "organizations", "org-a", "menuItems", "seeded-item"), {
      eventTypeId: "seeded-event",
      categoryId: "seeded-category",
      name: "Roasted Chicken",
      priceMinor: 0,
      pricingType: "per_event",
      type: "per_event",
      active: true,
      source: "canonical-menu-seed"
    });
    addCatalogRevisionAdvance(canonicalSeedBatch, db, "org-a", 13);
    await assertSucceeds(canonicalSeedBatch.commit());
  });

  test("org-a sales cannot write org-b quotes/catalog/menu/settings", async () => {
    const ownOrgQuoteRef = quoteRefFor("sales-org-a", "sales-a@example.com", "org-a", "q-sales-own");
    await assertFails(setDoc(ownOrgQuoteRef, buildQuotePayload("sales-org-a", "org-a")));

    const crossOrgQuoteRef = quoteRefFor("sales-org-a", "sales-a@example.com", "org-b", "q-sales-cross");
    await assertFails(setDoc(crossOrgQuoteRef, buildQuotePayload("sales-org-a", "org-b")));

    await assertOrgScopedWritesFail("sales-org-a", "sales-a@example.com", "org-b");
  });

  test("mismatched claim organization is denied even when role doc exists", async () => {
    const ref = quoteRefForWithClaims(
      "sales-org-a",
      "sales-a@example.com",
      { role: "sales", organizationId: "org-b" },
      "org-a",
      "q-claim-mismatch"
    );
    await assertFails(setDoc(ref, buildQuotePayload("sales-org-a", "org-a")));
  });

  test("stale admin and platform claims cannot elevate a downgraded role document", async () => {
    const staleAdminRef = quoteRefForWithClaims(
      "sales-org-a",
      "sales-a@example.com",
      { role: "admin", organizationId: "org-a", platformAdmin: true },
      "org-b",
      "q-stale-admin"
    );
    await assertFails(setDoc(staleAdminRef, buildQuotePayload("sales-org-a", "org-b")));
  });

  test("unverified staff and customer emails have no organization data authority", async () => {
    const unverifiedStaffDb = testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: false
    }).firestore();
    const unverifiedCustomerDb = testEnv.authenticatedContext("customer-org-a", {
      email: "customer-a@example.com",
      email_verified: false
    }).firestore();

    await assertFails(getDoc(doc(unverifiedStaffDb, "organizations", "org-a", "quotes", "q1")));
    await assertFails(setDoc(
      doc(unverifiedStaffDb, "organizations", "org-a", "quotes", "q-unverified"),
      buildQuotePayload("sales-org-a", "org-a")
    ));
    await assertFails(getDoc(doc(unverifiedCustomerDb, "organizations", "org-a", "quotes", "q1")));
  });

  test("unverified admins cannot manage same-organization role documents", async () => {
    const db = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: false
    }).firestore();
    const existingRoleRef = doc(db, "userRoles", "sales-org-a");
    const newRoleRef = doc(db, "userRoles", "new-admin-org-a");

    await assertFails(getDoc(existingRoleRef));
    await assertFails(setDoc(newRoleRef, {
      role: "admin",
      email: "new-admin@example.com",
      organizationId: "org-a"
    }));
    await assertFails(updateDoc(existingRoleRef, {
      role: "admin"
    }));
    await assertFails(deleteDoc(existingRoleRef));
  });

  test("verified admins can read same-organization roles but cannot mutate role authority", async () => {
    const db = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    const ownRoleRef = doc(db, "userRoles", "new-sales-org-a");
    const crossOrgRoleRef = doc(db, "userRoles", "sales-org-b");

    await assertFails(setDoc(ownRoleRef, {
      role: "sales",
      email: "new-sales@example.com",
      organizationId: "org-a"
    }));
    await assertSucceeds(getDoc(doc(db, "userRoles", "sales-org-a")));
    await assertFails(updateDoc(doc(db, "userRoles", "sales-org-a"), {
      role: "admin"
    }));
    await assertFails(deleteDoc(doc(db, "userRoles", "sales-org-a")));

    await assertFails(getDoc(crossOrgRoleRef));
    await assertFails(updateDoc(crossOrgRoleRef, {
      role: "admin"
    }));
    await assertFails(deleteDoc(crossOrgRoleRef));
  });

  test("organization owner binding receipts are private and immutable in browsers", async () => {
    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    const receiptRef = doc(adminDb, "organizationOwnerBindingReceipts", "org-a");

    await assertFails(getDoc(receiptRef));
    await assertFails(setDoc(receiptRef, {
      organizationId: "org-a",
      ownerUid: "admin-org-a"
    }));
    await assertFails(updateDoc(receiptRef, { ownerUid: "sales-org-a" }));
    await assertFails(deleteDoc(receiptRef));
  });

  test("organization role authority receipts are private and immutable in browsers", async () => {
    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    const receiptRef = doc(adminDb, "organizationRoleAuthorityReceipts", "role-request-00000001");

    await assertFails(getDoc(receiptRef));
    await assertFails(setDoc(receiptRef, {
      organizationId: "org-a",
      actorUid: "admin-org-a",
      targetUid: "sales-org-a"
    }));
    await assertFails(updateDoc(receiptRef, { nextRole: "admin" }));
    await assertFails(deleteDoc(receiptRef));
  });

  test("direct quote creation is denied even with draft shape or fabricated authority labels", async () => {
    const draftRef = quoteRefFor("sales-org-a", "sales-a@example.com", "org-a", "q-direct-draft");
    const terminalRef = quoteRefFor("sales-org-a", "sales-a@example.com", "org-a", "q-terminal-create");
    const clientPricedRef = quoteRefFor("sales-org-a", "sales-a@example.com", "org-a", "q-client-priced");

    await assertFails(setDoc(draftRef, buildQuotePayload("sales-org-a", "org-a")));
    await assertFails(setDoc(terminalRef, buildQuotePayload("sales-org-a", "org-a", {
      status: "sent"
    })));
    await assertFails(setDoc(clientPricedRef, buildQuotePayload("sales-org-a", "org-a", {
      pricing: {
        authority: "client_estimate",
        subtotal: 1000,
        grandTotal: 1000
      }
    })));
  });

  test("portal keys cannot be rotated through a direct client quote update", async () => {
    const quoteRef = quoteRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "q1"
    );
    await assertFails(updateDoc(quoteRef, {
      portalKey: "rotated-direct-client-key-abcdefghijklmnopqrstuvwxyz",
      portalIssuedAtISO: "2026-03-22T00:00:00.000Z",
      portalExpiresAtISO: "2026-04-21T00:00:00.000Z",
      updatedAtISO: "2026-03-22T00:00:00.000Z"
    }));
  });

  test("staff cannot overwrite commercial quote content or server-authoritative pricing directly", async () => {
    for (const [uid, email] of [
      ["admin-org-a", "admin-a@example.com"],
      ["sales-org-a", "sales-a@example.com"]
    ]) {
      const quoteRef = quoteRefFor(uid, email, "org-a", "q1");
      await assertFails(updateDoc(quoteRef, {
        customer: {
          name: "Forged Customer",
          email: "forged@example.com"
        },
        totals: {
          total: 1,
          deposit: 1
        },
        pricing: {
          ...RULES_PRICING,
          grandTotal: 1
        },
        updatedAtISO: "2026-03-22T00:00:00.000Z"
      }));
      await assertFails(updateDoc(quoteRef, {
        status: "viewed",
        totals: {
          total: 1,
          deposit: 1
        },
        updatedAtISO: "2026-03-22T00:00:00.000Z",
        lifecycle: {
          viewedAtISO: "2026-03-22T00:00:00.000Z"
        }
      }));
    }
  });

  test("narrow operational quote patches remain available without commercial changes", async () => {
    const adminQuoteRef = quoteRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "q1"
    );
    const salesQuoteRef = quoteRefFor(
      "sales-org-a",
      "sales-a@example.com",
      "org-a",
      "q1"
    );
    await assertFails(updateDoc(salesQuoteRef, {
      payment: {
        depositLink: "",
        depositStatus: "paid",
        depositConfirmedAtISO: "2026-03-22T00:00:00.000Z"
      },
      updatedAtISO: "2026-03-22T00:00:00.000Z"
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      booking: {
        contractNumber: "FORGED-CONTRACT",
        contractConvertedAtISO: "2026-03-22T00:00:00.000Z"
      },
      updatedAtISO: "2026-03-22T00:00:00.000Z"
    }));
    await assertSucceeds(updateDoc(salesQuoteRef, {
      "booking.staffLead": "Schedule Lead",
      "booking.staffAssignedAtISO": "2026-03-22T00:00:00.000Z",
      updatedAtISO: "2026-03-22T00:00:00.000Z"
    }));
    await assertSucceeds(updateDoc(salesQuoteRef, {
      "workflow.followUp": {
        stage: "contacted",
        dueDate: "2026-03-30",
        note: "Follow up after menu review.",
        completed: false,
        completedAtISO: "",
        updatedAtISO: "2026-03-22T00:10:00.000Z",
        updatedByEmail: "sales-a@example.com"
      },
      updatedAtISO: "2026-03-22T00:10:00.000Z"
    }));
    const approvalRequest = {
      id: "approval-request-abcdefghijklmnopqrstuvwxyz",
      action: "send_payment_request",
      state: "pending",
      note: "Customer is ready for the deposit request.",
      requestedAtISO: "2026-03-22T00:20:00.000Z",
      requestedByEmail: "sales-a@example.com",
      resolvedAtISO: "",
      resolvedByEmail: "",
      resolutionNote: ""
    };
    await assertFails(updateDoc(salesQuoteRef, {
      "workflow.approvalRequests": [approvalRequest],
      updatedAtISO: "2026-03-22T00:20:00.000Z"
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      "workflow.approvalRequests": [{
        ...approvalRequest,
        state: "approved",
        resolvedAtISO: "2026-03-22T00:30:00.000Z",
        resolvedByEmail: "sales-a@example.com",
        resolutionNote: "Forged approval"
      }],
      updatedAtISO: "2026-03-22T00:30:00.000Z"
    }));
    await assertFails(updateDoc(adminQuoteRef, {
      "workflow.approvalRequests": [{
        ...approvalRequest,
        requestedByEmail: "admin-a@example.com"
      }],
      updatedAtISO: "2026-03-22T00:20:00.000Z"
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      integrations: {
        logs: [{ state: "success", message: "Forged provider delivery" }]
      },
      updatedAtISO: "2026-03-22T00:40:00.000Z"
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      latestVersionNumber: 1,
      versionMeta: {
        versionId: "v0001",
        versionNumber: 1,
        createdAt: "2026-03-22T00:50:00.000Z",
        createdBy: {
          uid: "sales-org-a",
          email: "sales-a@example.com",
          role: "sales"
        },
        reason: "forged_without_immutable_version"
      }
    }));
    await assertFails(updateDoc(adminQuoteRef, {
      payment: {
        depositLink: "",
        depositStatus: "paid",
        depositConfirmedAtISO: "2026-03-22T01:00:00.000Z"
      },
      updatedAtISO: "2026-03-22T01:00:00.000Z"
    }));
    await assertFails(updateDoc(adminQuoteRef, {
      booking: {
        contractNumber: "ADMIN-CONTRACT",
        contractConvertedAtISO: "2026-03-22T01:30:00.000Z"
      },
      updatedAtISO: "2026-03-22T01:30:00.000Z"
    }));
    await assertSucceeds(updateDoc(adminQuoteRef, {
      "booking.confirmationStatus": "sent",
      "booking.confirmationSentAtISO": "2026-03-22T01:35:00.000Z",
      updatedAtISO: "2026-03-22T01:35:00.000Z"
    }));
  });

  test("change-request handling is exact-request, tenant, actor, and transition bound", async () => {
    const requestSubmittedAtISO = "2026-03-22T02:00:00.000Z";
    const requestId = "change-request-000000000001";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "organizations", "org-a", "quotes", "q1"), {
        status: "viewed",
        portalDecision: {
          decision: "changes_requested",
          message: "Please revise the service plan.",
          requestId,
          submittedAtISO: requestSubmittedAtISO
        },
        lifecycle: { viewedAtISO: requestSubmittedAtISO },
        updatedAtISO: requestSubmittedAtISO,
        workflow: {}
      }, { merge: true });
    });

    const salesQuoteRef = quoteRefFor("sales-org-a", "sales-a@example.com", "org-a", "q1");
    const adminQuoteRef = quoteRefFor("admin-org-a", "admin-a@example.com", "org-a", "q1");
    const customerQuoteRef = quoteRefFor("customer-org-a", "customer-a@example.com", "org-a", "q1");
    const foreignQuoteRef = quoteRefFor("sales-org-b", "sales-b@example.com", "org-a", "q1");
    const conflictingClaimRef = quoteRefForWithClaims(
      "sales-org-a",
      "sales-a@example.com",
      { organizationId: "org-b" },
      "org-a",
      "q1"
    );
    const unverifiedQuoteRef = doc(
      testEnv.authenticatedContext("sales-org-a", {
        email: "sales-a@example.com",
        email_verified: false
      }).firestore(),
      "organizations",
      "org-a",
      "quotes",
      "q1"
    );
    const acknowledgedAtISO = "2026-03-22T02:10:00.000Z";
    const acknowledged = {
      sourceRequestId: requestId,
      sourceSubmittedAtISO: requestSubmittedAtISO,
      sourceMessage: "Please revise the service plan.",
      state: "acknowledged",
      acknowledgedAtISO,
      acknowledgedByEmail: "sales-a@example.com",
      handledAtISO: "",
      handledByEmail: "",
      note: ""
    };

    await assertFails(updateDoc(customerQuoteRef, {
      "workflow.changeRequestHandling": acknowledged,
      updatedAtISO: acknowledgedAtISO
    }));
    await assertFails(updateDoc(foreignQuoteRef, {
      "workflow.changeRequestHandling": acknowledged,
      updatedAtISO: acknowledgedAtISO
    }));
    await assertFails(updateDoc(conflictingClaimRef, {
      "workflow.changeRequestHandling": acknowledged,
      updatedAtISO: acknowledgedAtISO
    }));
    await assertFails(updateDoc(unverifiedQuoteRef, {
      "workflow.changeRequestHandling": acknowledged,
      updatedAtISO: acknowledgedAtISO
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      "workflow.changeRequestHandling": {
        ...acknowledged,
        acknowledgedByEmail: "forged@example.com"
      },
      updatedAtISO: acknowledgedAtISO
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      "workflow.changeRequestHandling": {
        ...acknowledged,
        sourceRequestId: "change-request-000000000099"
      },
      updatedAtISO: acknowledgedAtISO
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      "workflow.changeRequestHandling": {
        ...acknowledged,
        sourceSubmittedAtISO: "2026-03-22T01:00:00.000Z"
      },
      updatedAtISO: acknowledgedAtISO
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      "workflow.changeRequestHandling": {
        ...acknowledged,
        sourceMessage: "A different customer request."
      },
      updatedAtISO: acknowledgedAtISO
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      "workflow.changeRequestHandling": {
        ...acknowledged,
        state: "handled",
        handledAtISO: acknowledgedAtISO,
        handledByEmail: "sales-a@example.com",
        note: ""
      },
      updatedAtISO: acknowledgedAtISO
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      "workflow.changeRequestHandling": {
        ...acknowledged,
        state: "handled",
        handledAtISO: acknowledgedAtISO,
        handledByEmail: "sales-a@example.com",
        note: "x".repeat(801)
      },
      updatedAtISO: acknowledgedAtISO
    }));
    await assertFails(updateDoc(salesQuoteRef, {
      "workflow.changeRequestHandling": acknowledged,
      "workflow.followUp": {
        stage: "contacted",
        dueDate: "2026-03-30",
        note: "Compound write",
        completed: false,
        completedAtISO: "",
        updatedAtISO: acknowledgedAtISO,
        updatedByEmail: "sales-a@example.com"
      },
      updatedAtISO: acknowledgedAtISO
    }));

    await assertSucceeds(updateDoc(salesQuoteRef, {
      "workflow.changeRequestHandling": acknowledged,
      updatedAtISO: acknowledgedAtISO
    }));

    const handledAtISO = "2026-03-22T02:20:00.000Z";
    const handled = {
      ...acknowledged,
      state: "handled",
      handledAtISO,
      handledByEmail: "admin-a@example.com",
      note: "Revised the proposal and recorded the customer follow-up."
    };
    await assertSucceeds(updateDoc(adminQuoteRef, {
      "workflow.changeRequestHandling": handled,
      updatedAtISO: handledAtISO
    }));
    await assertFails(updateDoc(adminQuoteRef, {
      "workflow.changeRequestHandling": {
        ...handled,
        handledAtISO: "2026-03-22T02:30:00.000Z"
      },
      updatedAtISO: "2026-03-22T02:30:00.000Z"
    }));
    await assertFails(updateDoc(adminQuoteRef, {
      "workflow.changeRequestHandling": acknowledged,
      updatedAtISO: "2026-03-22T02:30:00.000Z"
    }));

    const persisted = await getDoc(adminQuoteRef);
    expect(persisted.data().portalDecision).toEqual({
      decision: "changes_requested",
      message: "Please revise the service plan.",
      requestId,
      submittedAtISO: requestSubmittedAtISO
    });
    expect(persisted.data().workflow.changeRequestHandling).toEqual(handled);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "customerPortalQuotes", VALID_PORTAL_KEY), {
        status: "viewed",
        portalDecision: persisted.data().portalDecision,
        lifecycle: { viewedAtISO: requestSubmittedAtISO },
        updatedAtISO: requestSubmittedAtISO
      });
    });
    const replayedAtISO = "2026-03-22T02:40:00.000Z";
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "viewed",
      portalDecision: {
        decision: "changes_requested",
        message: "A replayed request must not inherit handled state.",
        requestId,
        submittedAtISO: replayedAtISO
      },
      lifecycle: { viewedAtISO: replayedAtISO },
      updatedAtISO: replayedAtISO
    }));
    const nextRequestAtISO = "2026-03-22T02:45:00.000Z";
    await assertSucceeds(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "viewed",
      portalDecision: {
        decision: "changes_requested",
        message: "A new request identity reopens staff attention.",
        requestId: "change-request-000000000002",
        submittedAtISO: nextRequestAtISO
      },
      lifecycle: { viewedAtISO: nextRequestAtISO },
      updatedAtISO: nextRequestAtISO
    }));
  });

  test("approval execution audit is admin-readable and server-write-only", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "organizations", "org-a", "quoteApprovalExecutions", "approval-execution-0001"),
        {
          organizationId: "org-a",
          quoteId: "q1",
          approvalRequestId: "approval-execution-0001",
          action: "convert_to_contract",
          state: "succeeded"
        }
      );
    });
    const adminRef = doc(
      testEnv.authenticatedContext("admin-org-a", {
        email: "admin-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      }).firestore(),
      "organizations",
      "org-a",
      "quoteApprovalExecutions",
      "approval-execution-0001"
    );
    const salesRef = doc(
      testEnv.authenticatedContext("sales-org-a", {
        email: "sales-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      }).firestore(),
      "organizations",
      "org-a",
      "quoteApprovalExecutions",
      "approval-execution-0001"
    );
    await assertSucceeds(getDoc(adminRef));
    await assertFails(getDoc(salesRef));
    await assertFails(updateDoc(adminRef, { state: "failed" }));
    await assertFails(deleteDoc(adminRef));
  });

  test("private payment dispatch evidence is denied to every browser context", async () => {
    const dispatchId = "payment-dispatch-approval-0001";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "organizations", "org-a", "privatePaymentDispatches", dispatchId),
        {
          organizationId: "org-a",
          quoteId: "q1",
          approvalRequestId: dispatchId,
          privateDepositLink: "https://checkout.stripe.com/c/pay/private-dispatch-fixture",
          exposureState: "prepared"
        }
      );
    });

    const browserContexts = [
      ["public", testEnv.unauthenticatedContext()],
      ["admin", testEnv.authenticatedContext("admin-org-a", {
        email: "admin-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      })],
      ["sales", testEnv.authenticatedContext("sales-org-a", {
        email: "sales-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      })],
      ["customer", testEnv.authenticatedContext("customer-org-a", {
        email: "customer-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      })]
    ];

    for (const [label, context] of browserContexts) {
      const db = context.firestore();
      const existingRef = doc(
        db,
        "organizations",
        "org-a",
        "privatePaymentDispatches",
        dispatchId
      );
      const newRef = doc(
        db,
        "organizations",
        "org-a",
        "privatePaymentDispatches",
        `browser-created-${label}`
      );
      await assertFails(getDoc(existingRef));
      await assertFails(setDoc(newRef, {
        organizationId: "org-a",
        quoteId: "q1",
        privateDepositLink: "https://checkout.stripe.com/c/pay/browser-forgery"
      }));
      await assertFails(updateDoc(existingRef, { exposureState: "published" }));
      await assertFails(deleteDoc(existingRef));
    }
  });

  test("buyer access orders are denied to every browser context", async () => {
    const orderId = "buyer-access-order-0001";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "buyerAccessOrders", orderId), {
        ownerUid: "admin-org-a",
        ownerEmail: "admin-a@example.com",
        organizationId: "buyer-org-a",
        amountCents: 100,
        currency: "usd",
        status: "checkout_open"
      });
    });

    const browserContexts = [
      ["public", testEnv.unauthenticatedContext()],
      ["owner", testEnv.authenticatedContext("admin-org-a", {
        email: "admin-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      })],
      ["other-user", testEnv.authenticatedContext("customer-org-a", {
        email: "customer-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      })]
    ];

    for (const [label, context] of browserContexts) {
      const db = context.firestore();
      const existingRef = doc(db, "buyerAccessOrders", orderId);
      const newRef = doc(db, "buyerAccessOrders", `browser-created-${label}`);
      await assertFails(getDoc(existingRef));
      await assertFails(setDoc(newRef, {
        ownerUid: label,
        amountCents: 100,
        currency: "usd",
        status: "paid"
      }));
      await assertFails(updateDoc(existingRef, { status: "provisioned" }));
      await assertFails(deleteDoc(existingRef));
    }
  });

  test("proposal acceptance receipts are tenant-readable and server-write-only", async () => {
    const receiptId = "acceptance-12345678-1234-1234-1234-123456789012";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "organizations", "org-a", "proposalAcceptanceReceipts", receiptId),
        {
          organizationId: "org-a",
          quoteId: "q1",
          receiptId,
          signerName: "Portal Client",
          totalMinor: 720025
        }
      );
    });
    const adminReceipt = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "proposalAcceptanceReceipts",
      receiptId
    );
    const salesReceipt = orgScopedRefFor(
      "sales-org-a",
      "sales-a@example.com",
      "org-a",
      "proposalAcceptanceReceipts",
      receiptId
    );
    const customerReceipt = orgScopedRefFor(
      "customer-org-a",
      "customer-a@example.com",
      "org-a",
      "proposalAcceptanceReceipts",
      receiptId
    );
    const foreignReceipt = orgScopedRefFor(
      "sales-org-b",
      "sales-b@example.com",
      "org-a",
      "proposalAcceptanceReceipts",
      receiptId
    );

    await assertSucceeds(getDoc(adminReceipt));
    await assertSucceeds(getDoc(salesReceipt));
    await assertFails(getDoc(customerReceipt));
    await assertFails(getDoc(foreignReceipt));
    await assertFails(updateDoc(adminReceipt, { signerName: "Forged Signer" }));
    await assertFails(deleteDoc(adminReceipt));
  });

  test("quote conversations are callable-only even for same-org staff and an active bearer portal", async () => {
    const collections = [
      ["portalConversationMessages", "message-1"],
      ["portalConversationRequests", "request-1"],
      ["portalConversationRateLimits", "actor-1"],
      ["portalConversationState", "current"]
    ];
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const [collectionName, documentId] of collections) {
        await setDoc(
          doc(db, "organizations", "org-a", "quotes", "q1", collectionName, documentId),
          {
            organizationId: "org-a",
            quoteId: "q1",
            actorType: "staff",
            actorName: "Rules Staff",
            body: "Server-owned conversation data"
          }
        );
      }
    });

    await assertSucceeds(getDoc(portalSnapshotRefFor(VALID_PORTAL_KEY)));
    for (const [collectionName, documentId] of collections) {
      const adminDb = testEnv.authenticatedContext("admin-org-a", {
        email: "admin-a@example.com",
        email_verified: true
      }).firestore();
      const salesDb = testEnv.authenticatedContext("sales-org-a", {
        email: "sales-a@example.com",
        email_verified: true
      }).firestore();
      const publicDb = testEnv.unauthenticatedContext().firestore();
      const path = [
        "organizations",
        "org-a",
        "quotes",
        "q1",
        collectionName,
        documentId
      ];
      const adminRef = doc(adminDb, ...path);
      await assertFails(getDoc(adminRef));
      await assertFails(getDoc(doc(salesDb, ...path)));
      await assertFails(getDoc(doc(publicDb, ...path)));
      await assertFails(setDoc(adminRef, { body: "Browser-forged message" }));
      await assertFails(updateDoc(adminRef, { body: "Browser-edited message" }));
      await assertFails(deleteDoc(adminRef));
    }
    const adminQuote = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "quotes",
      "q1"
    );
    await assertFails(updateDoc(adminQuote, {
      conversationSummary: {
        schemaVersion: 1,
        messageCount: 999,
        latestMessageAtISO: "2026-03-22T05:00:00.000Z",
        latestActorType: "customer"
      }
    }));
  });

  test("post-event closeout records and action receipts are callable-only", async () => {
    const closeoutId = `closeout_${"a".repeat(48)}`;
    const receiptId = `closeout_action_${"b".repeat(48)}`;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, "organizations", "org-a", "postEventCloseouts", closeoutId),
        {
          organizationId: "org-a",
          quoteId: "q1",
          customerId: "customer-a",
          closeoutId,
          state: "pending",
          profitReview: {
            state: "draft",
            reviewRevision: 2,
            actuals: { grossRevenueCents: 500000, foodCents: 120000 },
            notes: "Callable-owned admin detail"
          }
        }
      );
      await setDoc(
        doc(
          db,
          "organizations",
          "org-a",
          "postEventCloseouts",
          closeoutId,
          "actionReceipts",
          receiptId
        ),
        {
          organizationId: "org-a",
          quoteId: "q1",
          closeoutId,
          receiptId
        }
      );
    });

    const contexts = [
      testEnv.unauthenticatedContext(),
      testEnv.authenticatedContext("customer-org-a", {
        email: "customer-a@example.com",
        email_verified: true
      }),
      testEnv.authenticatedContext("sales-org-a", {
        email: "sales-a@example.com",
        email_verified: true
      }),
      testEnv.authenticatedContext("admin-org-a", {
        email: "admin-a@example.com",
        email_verified: true
      }),
      testEnv.authenticatedContext("sales-org-b", {
        email: "sales-b@example.com",
        email_verified: true
      })
    ];

    for (const context of contexts) {
      const db = context.firestore();
      const closeoutRef = doc(db, "organizations", "org-a", "postEventCloseouts", closeoutId);
      const receiptRef = doc(closeoutRef, "actionReceipts", receiptId);
      await assertFails(getDoc(closeoutRef));
      await assertFails(getDoc(receiptRef));
      await assertFails(setDoc(closeoutRef, { organizationId: "org-a", state: "completed" }));
      await assertFails(updateDoc(closeoutRef, { state: "completed" }));
      await assertFails(deleteDoc(closeoutRef));
      await assertFails(setDoc(receiptRef, { forged: true }));
    }
  });

  test.each([
    ["same-org admin", () => testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true,
      organizationId: "org-a"
    })],
    ["same-org sales", () => testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: true,
      organizationId: "org-a"
    })],
    ["same-org customer", () => testEnv.authenticatedContext("customer-org-a", {
      email: "customer-a@example.com",
      email_verified: true,
      organizationId: "org-a"
    })],
    ["cross-tenant staff", () => testEnv.authenticatedContext("sales-org-b", {
      email: "sales-b@example.com",
      email_verified: true,
      organizationId: "org-b"
    })]
  ])("operational staffing authority denies every %s browser operation", async (_label, contextFactory) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const authorityPath of SERVER_OWNED_OPERATIONAL_STAFFING_PATHS) {
        await setDoc(doc(db, ...authorityPath), {
          schemaVersion: 1,
          organizationId: "org-a",
          serverOwned: true
        });
      }
    });

    const browserDb = contextFactory().firestore();
    for (const authorityPath of SERVER_OWNED_OPERATIONAL_STAFFING_PATHS) {
      const existingRef = doc(browserDb, ...authorityPath);
      const collectionPath = authorityPath.slice(0, -1);
      const browserDocumentPath = [
        ...collectionPath,
        `${authorityPath.at(-1)}-browser-created`
      ];

      await assertFails(getDoc(existingRef));
      await assertFails(getDocs(query(collection(browserDb, ...collectionPath), limit(5))));
      await assertFails(setDoc(doc(browserDb, ...browserDocumentPath), {
        organizationId: "org-a",
        serverOwned: false
      }));
      await assertFails(updateDoc(existingRef, { serverOwned: false }));
      await assertFails(deleteDoc(existingRef));
    }
  }, 30_000);

  test.each([
    ["unauthenticated", () => testEnv.unauthenticatedContext()],
    ["unassigned", () => testEnv.authenticatedContext("unassigned-commercial-user", {
      email: "unassigned-commercial@example.com",
      email_verified: true
    })],
    ["same-org customer", () => testEnv.authenticatedContext("customer-org-a", {
      email: "customer-a@example.com",
      email_verified: true,
      organizationId: "org-a"
    })],
    ["same-org sales", () => testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: true,
      organizationId: "org-a"
    })],
    ["same-org admin", () => testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true,
      organizationId: "org-a"
    })],
    ["cross-tenant staff", () => testEnv.authenticatedContext("sales-org-b", {
      email: "sales-b@example.com",
      email_verified: true,
      organizationId: "org-b"
    })]
  ])("server-owned commercial authority denies every %s browser operation", async (_label, contextFactory) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const authorityPath of SERVER_OWNED_COMMERCIAL_AUTHORITY_PATHS) {
        await setDoc(doc(db, ...authorityPath), {
          schemaVersion: 1,
          organizationId: "org-a",
          serverOwned: true,
          providerReference: "private-provider-reference",
          recipientKey: "private-recipient-key"
        });
      }
    });

    const browserDb = contextFactory().firestore();
    for (const authorityPath of SERVER_OWNED_COMMERCIAL_AUTHORITY_PATHS) {
      const existingRef = doc(browserDb, ...authorityPath);
      const collectionPath = authorityPath.slice(0, -1);
      const browserDocumentPath = [
        ...collectionPath,
        `${authorityPath.at(-1)}-browser-created`
      ];

      await assertFails(getDoc(existingRef));
      await assertFails(getDocs(query(collection(browserDb, ...collectionPath), limit(5))));
      await assertFails(setDoc(doc(browserDb, ...browserDocumentPath), {
        organizationId: "org-a",
        serverOwned: false
      }));
      await assertFails(updateDoc(existingRef, { serverOwned: false }));
      await assertFails(deleteDoc(existingRef));
    }
  }, 30_000);

  test("Steward private records deny every browser operation", async () => {
    const browserContexts = [
      ["unauthenticated", () => testEnv.unauthenticatedContext()],
      ["same-org customer", () => testEnv.authenticatedContext("customer-org-a", {
      email: "customer-a@example.com",
      email_verified: true,
      organizationId: "org-a"
      })],
      ["same-org sales", () => testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: true,
      organizationId: "org-a"
      })],
      ["same-org admin", () => testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true,
      organizationId: "org-a"
      })],
      ["cross-tenant staff", () => testEnv.authenticatedContext("sales-org-b", {
      email: "sales-b@example.com",
      email_verified: true,
      organizationId: "org-b"
      })]
    ];

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const privatePath of STEWARD_SERVER_ONLY_PATHS) {
        await setDoc(doc(db, ...privatePath), {
          schemaVersion: "steward-controls-v1",
          organizationId: "org-a",
          serverOwned: true
        });
      }
    });

    for (const [_label, contextFactory] of browserContexts) {
      const browserDb = contextFactory().firestore();
      for (const privatePath of STEWARD_SERVER_ONLY_PATHS) {
        const existingRef = doc(browserDb, ...privatePath);
        const collectionPath = privatePath.slice(0, -1);
        const forgedRef = doc(browserDb, ...collectionPath, `${privatePath.at(-1)}-browser-created`);
        await assertFails(getDoc(existingRef));
        await assertFails(getDocs(query(collection(browserDb, ...collectionPath), limit(5))));
        await assertFails(setDoc(forgedRef, { organizationId: "org-a", serverOwned: false }));
        await assertFails(updateDoc(existingRef, { serverOwned: false }));
        await assertFails(deleteDoc(existingRef));
      }
    }
  }, 30_000);

  test.each([
    ["signed-out", () => testEnv.unauthenticatedContext()],
    ["same-tenant admin", () => testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true,
      organizationId: "org-a"
    })],
    ["cross-tenant user", () => testEnv.authenticatedContext("sales-org-b", {
      email: "sales-b@example.com",
      email_verified: true,
      organizationId: "org-b"
    })]
  ])("owner SMS global collections deny %s document, list, and write access", async (_label, contextFactory) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const [collectionName, documentId] of OWNER_SMS_SERVER_ONLY_GLOBAL_COLLECTIONS) {
        await setDoc(doc(db, collectionName, documentId), {
          schemaVersion: 1,
          organizationId: "org-a",
          ownerUid: "admin-org-a",
          providerReference: "private-provider-reference",
          serverOwned: true
        });
      }
    });

    const browserDb = contextFactory().firestore();
    for (const [collectionName, documentId] of OWNER_SMS_SERVER_ONLY_GLOBAL_COLLECTIONS) {
      const existingRef = doc(browserDb, collectionName, documentId);
      const browserCreatedRef = doc(browserDb, collectionName, `${documentId}-browser-created`);

      await assertFails(getDoc(existingRef));
      await assertFails(getDocs(query(collection(browserDb, collectionName), limit(5))));
      await assertFails(setDoc(browserCreatedRef, {
        organizationId: "org-a",
        serverOwned: false
      }));
      await assertFails(updateDoc(existingRef, { serverOwned: false }));
      await assertFails(deleteDoc(existingRef));
    }
  }, 30_000);

  test("commercial change enforcement cannot be promoted by a browser administrator", async () => {
    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true,
      organizationId: "org-a"
    }).firestore();
    await assertFails(updateDoc(
      doc(adminDb, "organizations", "org-a", "settings", "config"),
      { commercialChangeAuthorityEnabled: true }
    ));
  });

  test("operational staffing authority cannot be promoted by a browser administrator", async () => {
    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true,
      organizationId: "org-a"
    }).firestore();
    const settingsRef = doc(adminDb, "organizations", "org-a", "settings", "config");
    await assertFails(updateDoc(
      settingsRef,
      { operationalStaffingAuthorityEnabled: true }
    ));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(
        context.firestore(),
        "organizations",
        "org-a",
        "settings",
        "config"
      ));
    });
    await assertFails(setDoc(settingsRef, {
      operationalStaffingAuthorityEnabled: true
    }));
  });

  test("product analytics events are callable-owned and cannot expose raw staff activity", async () => {
    const eventId = "analytics-event-0001";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "organizations", "org-a", "productAnalyticsEvents", eventId),
        {
          organizationId: "org-a",
          eventId,
          eventName: "wizard_started",
          sessionId: "session-1234567890",
          sequence: 1
        }
      );
    });
    const adminEvent = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "productAnalyticsEvents",
      eventId
    );
    const salesEvent = orgScopedRefFor(
      "sales-org-a",
      "sales-a@example.com",
      "org-a",
      "productAnalyticsEvents",
      eventId
    );

    await assertFails(getDoc(adminEvent));
    await assertFails(getDoc(salesEvent));
    await assertFails(setDoc(adminEvent, { eventName: "quote_saved" }));
    await assertFails(updateDoc(adminEvent, { eventName: "quote_saved" }));
    await assertFails(deleteDoc(adminEvent));
  });

  test("Stripe payment state, references, and provider audit fields remain server-owned", async () => {
    const depositLink = "https://checkout.stripe.com/c/pay/cs_test_server";
    const stripeSessionId = "cs_test_server";
    const protectedPaymentFields = {
      depositLink,
      stripeSessionId,
      stripeCheckoutState: "open",
      lastCheckoutCreatedAtISO: "2026-03-22T01:50:00.000Z",
      lastHost: "quotepilot.mbmapps.com",
      lastEventType: "checkout.session.created",
      lastOrganizationId: "org-a",
      checkoutGeneration: 1
    };
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const payment = {
        ...protectedPaymentFields,
        depositStatus: "unpaid",
        depositConfirmedAtISO: ""
      };
      await updateDoc(doc(db, "organizations", "org-a", "quotes", "q1"), {
        payment
      });
      await updateDoc(doc(db, "customerPortalQuotes", VALID_PORTAL_KEY), {
        payment
      });
    });

    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    const quoteRef = doc(adminDb, "organizations", "org-a", "quotes", "q1");
    const portalRef = doc(adminDb, "customerPortalQuotes", VALID_PORTAL_KEY);

    for (const ref of [quoteRef, portalRef]) {
      for (const field of Object.keys(protectedPaymentFields)) {
        await assertFails(updateDoc(ref, {
          [`payment.${field}`]: `client-overwrite-${field}`,
          updatedAtISO: "2026-03-22T02:00:00.000Z"
        }));
        await assertFails(updateDoc(ref, {
          [`payment.${field}`]: deleteField(),
          updatedAtISO: "2026-03-22T02:05:00.000Z"
        }));
      }
      for (const depositStatus of ["sent", "paid", "refunded"]) {
        await assertFails(updateDoc(ref, {
          "payment.depositStatus": depositStatus,
          updatedAtISO: "2026-03-22T02:10:00.000Z"
        }));
      }
      await assertFails(updateDoc(ref, {
        "payment.depositConfirmedAtISO": "2026-03-22T02:10:00.000Z",
        updatedAtISO: "2026-03-22T02:10:00.000Z"
      }));
    }

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const confirmedPayment = {
        ...protectedPaymentFields,
        depositStatus: "paid",
        depositConfirmedAtISO: "2026-03-22T02:20:00.000Z"
      };
      await updateDoc(doc(db, "organizations", "org-a", "quotes", "q1"), {
        payment: confirmedPayment
      });
      await updateDoc(doc(db, "customerPortalQuotes", VALID_PORTAL_KEY), {
        payment: confirmedPayment
      });
    });

    for (const ref of [quoteRef, portalRef]) {
      await assertFails(updateDoc(ref, {
        "payment.depositStatus": "unpaid",
        "payment.depositConfirmedAtISO": "",
        updatedAtISO: "2026-03-22T02:30:00.000Z"
      }));
    }
  });

  test("final-balance and ledger payment maps remain server-owned across browser roles", async () => {
    const protectedPaymentMaps = {
      finalBalance: {
        amountCents: 70000,
        currency: "usd",
        checkoutGeneration: 1,
        stripeSessionId: "cs_test_final_balance_server",
        stripeCheckoutState: "open"
      },
      ledger: {
        version: 1,
        totalCents: 100000,
        depositCents: 30000,
        finalBalanceCents: 70000,
        entries: [{
          operationId: "deposit-server-1",
          paymentKind: "deposit",
          amountCents: 30000,
          state: "paid",
          providerReference: "cs_test_deposit_server"
        }]
      }
    };
    const browserContexts = [
      ["admin", testEnv.authenticatedContext("admin-org-a", {
        email: "admin-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      })],
      ["sales", testEnv.authenticatedContext("sales-org-a", {
        email: "sales-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      })],
      ["customer", testEnv.authenticatedContext("customer-org-a", {
        email: "customer-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      })],
      ["public", testEnv.unauthenticatedContext()]
    ];

    for (const [label, context] of browserContexts) {
      const quoteRef = doc(context.firestore(), "organizations", "org-a", "quotes", "q1");
      for (const [field, value] of Object.entries(protectedPaymentMaps)) {
        await assertFails(updateDoc(quoteRef, {
          [`payment.${field}`]: value,
          updatedAtISO: `2026-03-22T04:0${label.length}:00.000Z`
        }));
      }
    }

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const ref of [
        doc(db, "organizations", "org-a", "quotes", "q1"),
        doc(db, "customerPortalQuotes", VALID_PORTAL_KEY)
      ]) {
        await updateDoc(ref, {
          "payment.finalBalance": protectedPaymentMaps.finalBalance,
          "payment.ledger": protectedPaymentMaps.ledger
        });
      }
    });

    for (const [label, context] of browserContexts) {
      const db = context.firestore();
      for (const ref of [
        doc(db, "organizations", "org-a", "quotes", "q1"),
        doc(db, "customerPortalQuotes", VALID_PORTAL_KEY)
      ]) {
        await assertFails(updateDoc(ref, {
          "payment.finalBalance.stripeCheckoutState": `forged-${label}`,
          updatedAtISO: "2026-03-22T04:20:00.000Z"
        }));
        await assertFails(updateDoc(ref, {
          "payment.ledger.entries": [],
          updatedAtISO: "2026-03-22T04:25:00.000Z"
        }));
        await assertFails(updateDoc(ref, {
          "payment.finalBalance": deleteField(),
          "payment.ledger": deleteField(),
          updatedAtISO: "2026-03-22T04:30:00.000Z"
        }));
      }
    }

    const salesQuoteRef = quoteRefFor(
      "sales-org-a",
      "sales-a@example.com",
      "org-a",
      "q1"
    );
    await assertSucceeds(updateDoc(salesQuoteRef, {
      "booking.staffLead": "Final Balance Event Lead",
      "booking.staffAssignedAtISO": "2026-03-22T04:35:00.000Z",
      updatedAtISO: "2026-03-22T04:35:00.000Z"
    }));
  });

  test("public and authenticated customer portal paths cannot forge Stripe payment evidence", async () => {
    const forgedAtISO = "2026-03-22T03:00:00.000Z";
    const forgedPayment = {
      depositLink: "https://checkout.stripe.com/c/pay/cs_test_browser_forged",
      depositStatus: "paid",
      depositConfirmedAtISO: forgedAtISO,
      stripeSessionId: "cs_test_browser_forged",
      stripeCheckoutState: "paid",
      checkoutGeneration: 99,
      lastCheckoutCreatedAtISO: forgedAtISO,
      lastHost: "attacker.example",
      lastEventType: "checkout.session.completed",
      lastOrganizationId: "org-a"
    };
    const browserContexts = [
      testEnv.unauthenticatedContext(),
      testEnv.authenticatedContext("customer-org-a", {
        email: "customer-a@example.com",
        email_verified: true,
        organizationId: "org-a"
      })
    ];

    for (const context of browserContexts) {
      const db = context.firestore();
      const quoteRef = doc(db, "organizations", "org-a", "quotes", "q1");
      const portalRef = doc(db, "customerPortalQuotes", VALID_PORTAL_KEY);

      await assertFails(updateDoc(quoteRef, {
        payment: forgedPayment,
        updatedAtISO: forgedAtISO
      }));
      await assertFails(updateDoc(portalRef, {
        payment: forgedPayment,
        updatedAtISO: forgedAtISO
      }));

      const pair = writeBatch(db);
      const otherwiseValidViewedPatch = {
        status: "viewed",
        lifecycle: {
          viewedAtISO: forgedAtISO
        },
        payment: forgedPayment,
        updatedAtISO: forgedAtISO
      };
      pair.update(quoteRef, otherwiseValidViewedPatch);
      pair.update(portalRef, otherwiseValidViewedPatch);
      await assertFails(pair.commit());
    }
  });

  test("direct staff writes cannot claim delivery while admins retain non-delivery lifecycle authority", async () => {
    const adminTransitionPortalKey = "admin-expiry-portal-abcdefghijklmnopqrstuvwxyz";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, "organizations", "org-a", "quotes", "q-sales-send"),
        buildQuotePayload("sales-org-a", "org-a", {
          status: "draft",
          lifecycle: {
            draftAtISO: "2026-03-20T00:00:00.000Z"
          }
        })
      );
      await setDoc(
        doc(db, "organizations", "org-a", "quotes", "q-admin-transition"),
        buildQuotePayload("admin-org-a", "org-a", {
          portalKey: adminTransitionPortalKey,
          status: "draft",
          lifecycle: {
            draftAtISO: "2026-03-20T00:00:00.000Z"
          }
        })
      );
      await setDoc(doc(db, "customerPortalQuotes", adminTransitionPortalKey), {
        portalKey: adminTransitionPortalKey,
        quoteId: "q-admin-transition",
        organizationId: "org-a",
        status: "draft",
        updatedAtISO: "2026-03-20T00:00:00.000Z",
        lifecycle: {
          draftAtISO: "2026-03-20T00:00:00.000Z"
        }
      });
    });

    const salesSendRef = quoteRefFor(
      "sales-org-a",
      "sales-a@example.com",
      "org-a",
      "q-sales-send"
    );
    await assertFails(updateDoc(salesSendRef, {
      status: "sent",
      updatedAtISO: "2026-03-22T00:00:00.000Z",
      lifecycle: {
        draftAtISO: "2026-03-20T00:00:00.000Z",
        sentAtISO: "2026-03-22T00:00:00.000Z"
      }
    }));
    await assertFails(updateDoc(salesSendRef, {
      status: "deleted",
      deletedAtISO: "2026-03-22T01:00:00.000Z",
      updatedAtISO: "2026-03-22T01:00:00.000Z",
      lifecycle: {
        draftAtISO: "2026-03-20T00:00:00.000Z",
        sentAtISO: "2026-03-22T00:00:00.000Z",
        deletedAtISO: "2026-03-22T01:00:00.000Z"
      }
    }));

    const adminTransitionRef = quoteRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "q-admin-transition"
    );
    await assertFails(updateDoc(adminTransitionRef, {
      status: "sent",
      updatedAtISO: "2026-03-22T01:30:00.000Z",
      lifecycle: {
        draftAtISO: "2026-03-20T00:00:00.000Z",
        sentAtISO: "2026-03-22T01:30:00.000Z"
      }
    }));
    await assertFails(updateDoc(adminTransitionRef, {
      status: "viewed",
      updatedAtISO: "2026-03-22T01:35:00.000Z",
      lifecycle: {
        draftAtISO: "2026-03-20T00:00:00.000Z",
        viewedAtISO: "2026-03-22T01:35:00.000Z"
      }
    }));
    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();
    await assertFails(updateDoc(doc(adminDb, "customerPortalQuotes", VALID_PORTAL_KEY), {
      status: "viewed",
      updatedAtISO: "2026-03-22T01:40:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-22T01:40:00.000Z"
      }
    }));
    await assertFails(updateDoc(doc(adminDb, "organizations", "org-a", "quotes", "q1"), {
      status: "draft",
      updatedAtISO: "2026-03-22T01:45:00.000Z",
      lifecycle: {
        draftAtISO: "2026-03-22T01:45:00.000Z"
      }
    }));
    const expiryPatch = {
      status: "expired",
      updatedAtISO: "2026-03-22T02:00:00.000Z",
      lifecycle: {
        draftAtISO: "2026-03-20T00:00:00.000Z",
        expiredAtISO: "2026-03-22T02:00:00.000Z"
      }
    };
    await assertFails(updateDoc(adminTransitionRef, expiryPatch));

    const expiryBatch = writeBatch(adminDb);
    expiryBatch.update(
      doc(adminDb, "organizations", "org-a", "quotes", "q-admin-transition"),
      expiryPatch
    );
    expiryBatch.update(
      doc(adminDb, "customerPortalQuotes", adminTransitionPortalKey),
      expiryPatch
    );
    await assertSucceeds(expiryBatch.commit());
  });

  test("staff cannot change lifecycle status while server quote delivery is unresolved", async () => {
    const deliveryPortalKey = "delivery-sending-abcdefghijklmnopqrstuvwxyz";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, "organizations", "org-a", "quotes", "q-delivery-sending"),
        buildQuotePayload("admin-org-a", "org-a", {
          portalKey: deliveryPortalKey,
          status: "draft",
          lifecycle: {
            draftAtISO: "2026-03-20T00:00:00.000Z"
          },
          workflow: {
            quoteDelivery: {
              revisionId: "v0001",
              state: "sending",
              attemptId: "attempt-a",
              leaseExpiresAtISO: "2099-03-22T00:00:00.000Z"
            }
          }
        })
      );
      await setDoc(doc(db, "customerPortalQuotes", deliveryPortalKey), {
        portalKey: deliveryPortalKey,
        quoteId: "q-delivery-sending",
        organizationId: "org-a",
        status: "draft",
        portalExpiresAtMs: ACTIVE_PORTAL_EXPIRES_MS,
        updatedAtISO: "2026-03-20T00:00:00.000Z",
        lifecycle: {
          draftAtISO: "2026-03-20T00:00:00.000Z"
        }
      });
    });

    for (const [uid, email] of [
      ["admin-org-a", "admin-a@example.com"],
      ["sales-org-a", "sales-a@example.com"]
    ]) {
      const quoteRef = quoteRefFor(uid, email, "org-a", "q-delivery-sending");
      await assertFails(updateDoc(quoteRef, {
        status: "sent",
        updatedAtISO: "2026-03-22T00:00:00.000Z",
        lifecycle: {
          draftAtISO: "2026-03-20T00:00:00.000Z",
          sentAtISO: "2026-03-22T00:00:00.000Z"
        }
      }));
      const staffDb = testEnv.authenticatedContext(uid, {
        email,
        email_verified: true
      }).firestore();
      await assertFails(updateDoc(doc(staffDb, "customerPortalQuotes", deliveryPortalKey), {
        status: "sent",
        updatedAtISO: "2026-03-22T00:00:00.000Z",
        lifecycle: {
          draftAtISO: "2026-03-20T00:00:00.000Z",
          sentAtISO: "2026-03-22T00:00:00.000Z"
        }
      }));
    }
  });

  test("customer portal decisions are blocked while quote delivery is unresolved", async () => {
    const quoteId = "q-customer-delivery-sending";
    const portalKey = "customer-delivery-sending-abcdefghijklmnopqrstuvwxyz";
    const sentAtISO = "2026-03-20T00:00:00.000Z";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, "organizations", "org-a", "quotes", quoteId),
        buildQuotePayload("admin-org-a", "org-a", {
          portalKey,
          status: "sent",
          lifecycle: { sentAtISO },
          workflow: {
            quoteDelivery: {
              revisionId: "v0001",
              state: "outcome_ambiguous",
              attemptId: "attempt-customer-race",
              leaseExpiresAtISO: ""
            }
          }
        })
      );
      await setDoc(doc(db, "customerPortalQuotes", portalKey), {
        portalKey,
        quoteId,
        organizationId: "org-a",
        status: "sent",
        portalExpiresAtMs: ACTIVE_PORTAL_EXPIRES_MS,
        updatedAtISO: sentAtISO,
        lifecycle: { sentAtISO },
        portalDecision: {}
      });
    });

    const acceptedAtISO = "2026-03-22T03:00:00.000Z";
    await assertFails(updatePortalPair(portalKey, "org-a", quoteId, {
      status: "accepted",
      updatedAtISO: acceptedAtISO,
      lifecycle: {
        sentAtISO,
        acceptedAtISO
      },
      portalDecision: {
        decision: "accepted",
        message: "",
        requestId: "portal-decision-delivery-race-0001",
        submittedAtISO: acceptedAtISO
      }
    }));
  });

  test("expired and deleted quotes cannot be reopened through direct staff updates", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, "organizations", "org-a", "quotes", "q-direct-reopen-expired"),
        buildQuotePayload("admin-org-a", "org-a", {
          status: "expired",
          lifecycle: {
            draftAtISO: "2026-03-20T00:00:00.000Z",
            expiredAtISO: "2026-03-21T00:00:00.000Z"
          }
        })
      );
      await setDoc(
        doc(db, "organizations", "org-a", "quotes", "q-direct-reopen-deleted"),
        buildQuotePayload("admin-org-a", "org-a", {
          status: "deleted",
          deletedAtISO: "2026-03-21T00:00:00.000Z",
          lifecycle: {
            draftAtISO: "2026-03-20T00:00:00.000Z",
            deletedAtISO: "2026-03-21T00:00:00.000Z"
          }
        })
      );
    });

    for (const [uid, email] of [
      ["admin-org-a", "admin-a@example.com"],
      ["sales-org-a", "sales-a@example.com"]
    ]) {
      for (const quoteId of ["q-direct-reopen-expired", "q-direct-reopen-deleted"]) {
        await assertFails(updateDoc(
          quoteRefFor(uid, email, "org-a", quoteId),
          {
            status: "draft",
            updatedAtISO: "2026-03-22T00:00:00.000Z",
            lifecycle: {
              draftAtISO: "2026-03-20T00:00:00.000Z",
              reopenedAtISO: "2026-03-22T00:00:00.000Z"
            }
          }
        ));
      }
    }
  });

  test("quote and portal deletes must use trusted cleanup callables", async () => {
    const salesDb = testEnv.authenticatedContext("sales-org-a", {
      email: "sales-a@example.com",
      email_verified: true
    }).firestore();
    const adminDb = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true
    }).firestore();

    await assertFails(deleteDoc(doc(salesDb, "customerPortalQuotes", VALID_PORTAL_KEY)));
    await assertFails(deleteDoc(doc(adminDb, "customerPortalQuotes", VALID_PORTAL_KEY)));
    await assertFails(deleteDoc(doc(adminDb, "organizations", "org-a", "quotes", "q1")));
  });

  test("platform claim does not grant direct cross-org Firestore authority", async () => {
    const crossOrgRef = quoteRefForWithClaims(
      "admin-org-a",
      "admin-a@example.com",
      { role: "admin", organizationId: "org-a", platformAdmin: true },
      "org-b",
      "q-platform-cross-org"
    );
    await assertFails(setDoc(crossOrgRef, buildQuotePayload("admin-org-a", "org-b")));
  });

  test("tenant admin cannot rewrite commercial entitlements or organization authority", async () => {
    const db = testEnv.authenticatedContext("admin-org-a", {
      email: "admin-a@example.com",
      email_verified: true,
      role: "admin",
      organizationId: "org-a"
    }).firestore();
    const orgRef = doc(db, "organizations", "org-a");
    const settingsRef = doc(db, "organizations", "org-a", "settings", "config");

    await assertFails(updateDoc(orgRef, {
      plan: "enterprise"
    }));
    await assertFails(deleteDoc(orgRef));
    await assertFails(updateDoc(settingsRef, {
      plan: "enterprise",
      featureFlagsPaid: ["customerPortal", "integrationsOps"],
      "featureFlags.integrationsOps": true
    }));
    await assertFails(updateDoc(settingsRef, {
      onboarding: {
        status: "complete"
      }
    }));
    await assertFails(updateDoc(settingsRef, {
      plan: deleteField(),
      featureFlags: deleteField()
    }));
    await assertFails(updateDoc(settingsRef, {
      pricingSetupConfirmed: true,
      pricingConfirmation: {
        actorUid: "admin-org-a",
        actorEmail: "admin-a@example.com",
        confirmedAtISO: "2026-08-05T00:00:00.000Z",
        confirmedCatalogRevision: 1
      }
    }));
    await assertFails(updateDoc(settingsRef, {
      pricingConfirmation: {
        actorUid: "admin-org-a",
        confirmedCatalogRevision: 1
      }
    }));
    await assertSucceeds(updateDoc(settingsRef, {
      pricingSetupConfirmed: false,
      pricingConfirmation: null,
      catalogRevision: 1
    }));
    await assertFails(deleteDoc(settingsRef));
    await assertSucceeds(updateDoc(settingsRef, {
      brandName: "Admin-Managed Brand"
    }));
  });

  test("tenant domain mapping writes are scoped to same-org admins", async () => {
    const ownOrgRef = tenantDomainRefFor(
      "admin-org-a",
      "admin-a@example.com",
      { role: "admin", organizationId: "org-a" },
      "alpha.mbmapps.com"
    );
    await assertSucceeds(setDoc(ownOrgRef, {
      organizationId: "org-a",
      active: true,
      environment: "prod"
    }));

    const crossOrgRef = tenantDomainRefFor(
      "admin-org-a",
      "admin-a@example.com",
      { role: "admin", organizationId: "org-a" },
      "beta.mbmapps.com"
    );
    await assertFails(setDoc(crossOrgRef, {
      organizationId: "org-b",
      active: true,
      environment: "prod"
    }));
  });

  test("import receipts are tenant-locked and admin-only", async () => {
    const ownReceipt = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "importBatches",
      "batch-a"
    );
    await assertFails(setDoc(ownReceipt, {
      organizationId: "org-a",
      importBatchId: "batch-a",
      importType: "customers",
      status: "completed"
    }));
    await assertSucceeds(getDoc(ownReceipt));
    await assertFails(updateDoc(ownReceipt, { status: "rolled_back" }));

    const crossOrgReceipt = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-b",
      "importBatches",
      "batch-b"
    );
    await assertFails(setDoc(crossOrgReceipt, {
      organizationId: "org-b",
      importBatchId: "batch-b",
      importType: "customers",
      status: "completed"
    }));

    const salesReceipt = orgScopedRefFor(
      "sales-org-a",
      "sales-a@example.com",
      "org-a",
      "importBatches",
      "batch-sales"
    );
    await assertFails(setDoc(salesReceipt, {
      organizationId: "org-a",
      importBatchId: "batch-sales",
      importType: "customers",
      status: "completed"
    }));

    const browserCatalogReceipt = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "importBatches",
      "batch-browser-catalog"
    );
    await assertFails(setDoc(browserCatalogReceipt, {
      organizationId: "org-a",
      importBatchId: "batch-browser-catalog",
      importType: "packages",
      status: "completed"
    }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "organizations", "org-a", "importBatches", "batch-server-customer"), {
        organizationId: "org-a",
        importBatchId: "batch-server-customer",
        importType: "customers",
        batchKind: "customer",
        operation: "customer_import",
        status: "completed"
      });
      await setDoc(doc(context.firestore(), "organizations", "org-a", "importBatches", "batch-server-catalog"), {
        organizationId: "org-a",
        importBatchId: "batch-server-catalog",
        importType: "packages",
        batchKind: "catalog",
        status: "completed"
      });
    });
    const serverCustomerReceipt = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "importBatches",
      "batch-server-customer"
    );
    await assertSucceeds(getDoc(serverCustomerReceipt));
    await assertFails(updateDoc(serverCustomerReceipt, { status: "rolled_back" }));
    const serverCatalogReceipt = orgScopedRefFor(
      "admin-org-a",
      "admin-a@example.com",
      "org-a",
      "importBatches",
      "batch-server-catalog"
    );
    await assertSucceeds(getDoc(serverCatalogReceipt));
    await assertFails(updateDoc(serverCatalogReceipt, { status: "rolled_back" }));
  });

  test("customer cannot write staff-only org quote/catalog/menu/settings paths", async () => {
    const customerQuoteRef = quoteRefFor("customer-org-a", "customer-a@example.com", "org-a", "q-customer-own");
    await assertFails(setDoc(customerQuoteRef, buildQuotePayload("customer-org-a", "org-a")));

    await assertOrgScopedWritesFail("customer-org-a", "customer-a@example.com", "org-a");
  });

  test("portal snapshots allow active key reads/status updates and deny expired/deleted keys", async () => {
    const activeRef = portalSnapshotRefFor(VALID_PORTAL_KEY);
    await assertSucceeds(getDoc(activeRef));
    await assertFails(updateDoc(activeRef, {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));
    await assertSucceeds(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));
    await assertSucceeds(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "viewed",
      updatedAtISO: "2026-03-21T01:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T01:00:00.000Z"
      },
      portalDecision: {
        decision: "changes_requested",
        message: "Please revise the entree.",
        requestId: "portal-decision-000000000001",
        submittedAtISO: "2026-03-21T01:00:00.000Z"
      }
    }));
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "viewed",
      updatedAtISO: "2026-03-21T01:10:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T01:10:00.000Z"
      },
      portalDecision: {
        decision: "changes_requested",
        message: " Please revise the entree. ",
        requestId: "portal-decision-000000000015",
        submittedAtISO: "2026-03-21T01:10:00.000Z"
      }
    }));
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "viewed",
      updatedAtISO: "2026-03-21T01:20:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T01:20:00.000Z"
      },
      portalDecision: {
        decision: "changes_requested",
        message: "Please revise the entree.",
        requestId: " portal-decision-000000000016 ",
        submittedAtISO: "2026-03-21T01:20:00.000Z"
      }
    }));
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "viewed",
      updatedAtISO: "2026-03-21T02:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T02:00:00.000Z"
      },
      portalDecision: {
        decision: "changes_requested",
        message: "",
        requestId: "portal-decision-000000000002",
        submittedAtISO: "2026-03-21T02:00:00.000Z"
      }
    }));
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "accepted",
      updatedAtISO: "2026-03-21T02:30:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T01:00:00.000Z",
        acceptedAtISO: "2026-03-21T02:30:00.000Z"
      },
      portalDecision: {
        decision: "declined",
        message: "",
        requestId: "portal-decision-000000000003",
        submittedAtISO: "2026-03-21T02:30:00.000Z"
      }
    }));
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "accepted",
      updatedAtISO: "2026-03-21T02:45:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T01:00:00.000Z",
        acceptedAtISO: "2026-03-21T02:45:00.000Z"
      }
    }));
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "accepted",
      updatedAtISO: "2026-03-21T03:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T01:00:00.000Z",
        acceptedAtISO: "2026-03-21T03:00:00.000Z"
      },
      portalDecision: {
        decision: "accepted",
        message: "",
        requestId: "portal-decision-000000000004",
        submittedAtISO: "2026-03-21T03:00:00.000Z"
      }
    }));
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "declined",
      updatedAtISO: "2026-03-21T03:15:00.000Z",
      lifecycle: {
        acceptedAtISO: "2026-03-21T03:00:00.000Z",
        declinedAtISO: "2026-03-21T03:15:00.000Z"
      },
      portalDecision: {
        decision: "declined",
        message: "",
        requestId: "portal-decision-000000000005",
        submittedAtISO: "2026-03-21T03:15:00.000Z"
      }
    }));

    const expiredRef = portalSnapshotRefFor(EXPIRED_PORTAL_KEY);
    await assertFails(getDoc(expiredRef));
    await assertFails(updatePortalPair(EXPIRED_PORTAL_KEY, "org-a", "q-expired", {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));

    const deletedRef = portalSnapshotRefFor(DELETED_PORTAL_KEY);
    await assertFails(getDoc(deletedRef));
    await assertFails(updatePortalPair(DELETED_PORTAL_KEY, "org-a", "q-deleted", {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));
  });

  test("public portal snapshots fail closed without current server delivery evidence", async () => {
    const activeRef = portalSnapshotRefFor(VALID_PORTAL_KEY);
    await assertSucceeds(getDoc(activeRef));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "customerPortalQuotes", VALID_PORTAL_KEY), {
        deliveryEvidence: deleteField()
      });
    });

    await assertFails(getDoc(activeRef));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "customerPortalQuotes", VALID_PORTAL_KEY), {
        portalIssuedAtISO: "",
        deliveryEvidence: {
          ...PORTAL_DELIVERY_EVIDENCE,
          portalIssuedAtISO: ""
        }
      });
    });

    await assertFails(getDoc(activeRef));
  });

  test("portal decisions reject drafts, divergent audit metadata, and injected lifecycle events", async () => {
    const draftPortalKey = "draft-portal-key-abcdefghijklmnopqrstuvwxyz";
    const draftQuoteId = "q-draft-portal";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "organizations", "org-a", "quotes", draftQuoteId), {
        ownerUid: "sales-org-a",
        organizationId: "org-a",
        portalKey: draftPortalKey,
        status: "draft",
        updatedAtISO: "2026-03-20T00:00:00.000Z",
        lifecycle: {
          draftAtISO: "2026-03-20T00:00:00.000Z"
        },
        portalDecision: {}
      });
      await setDoc(doc(db, "customerPortalQuotes", draftPortalKey), {
        quoteId: draftQuoteId,
        organizationId: "org-a",
        portalKey: draftPortalKey,
        status: "draft",
        portalExpiresAtMs: ACTIVE_PORTAL_EXPIRES_MS,
        updatedAtISO: "2026-03-20T00:00:00.000Z",
        lifecycle: {
          draftAtISO: "2026-03-20T00:00:00.000Z"
        },
        portalDecision: {}
      });
    });

    const acceptedAtISO = "2026-03-21T04:00:00.000Z";
    const acceptedPatch = {
      status: "accepted",
      updatedAtISO: acceptedAtISO,
      lifecycle: {
        draftAtISO: "2026-03-20T00:00:00.000Z",
        acceptedAtISO
      },
      portalDecision: {
        decision: "accepted",
        message: "",
        requestId: "portal-decision-000000000006",
        submittedAtISO: acceptedAtISO
      }
    };
    await assertFails(updatePortalPair(draftPortalKey, "org-a", draftQuoteId, acceptedPatch));

    const portalAcceptedAtISO = "2026-03-21T05:00:00.000Z";
    const quoteAcceptedAtISO = "2026-03-21T05:01:00.000Z";
    await assertFails(updatePortalPairWithPatches(
      VALID_PORTAL_KEY,
      "org-a",
      "q1",
      {
        status: "accepted",
        updatedAtISO: portalAcceptedAtISO,
        lifecycle: { acceptedAtISO: portalAcceptedAtISO },
        portalDecision: {
          decision: "accepted",
          message: "",
          requestId: "portal-decision-000000000007",
          submittedAtISO: portalAcceptedAtISO
        }
      },
      {
        status: "accepted",
        updatedAtISO: quoteAcceptedAtISO,
        lifecycle: { acceptedAtISO: quoteAcceptedAtISO },
        portalDecision: {
          decision: "accepted",
          message: "",
          requestId: "portal-decision-000000000007",
          submittedAtISO: quoteAcceptedAtISO
        }
      }
    ));

    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "accepted",
      updatedAtISO: acceptedAtISO,
      lifecycle: {
        acceptedAtISO,
        bookedAtISO: acceptedAtISO
      },
      portalDecision: {
        decision: "accepted",
        message: "",
        requestId: "portal-decision-000000000008",
        submittedAtISO: acceptedAtISO
      }
    }));
  });

  test("staff cannot fabricate or rewrite customer acceptance evidence", async () => {
    const salesQuote = quoteRefFor("sales-org-a", "sales-a@example.com", "org-a", "q1");
    const adminQuote = quoteRefFor("admin-org-a", "admin-a@example.com", "org-a", "q1");
    const acceptedAtISO = "2026-03-21T06:00:00.000Z";
    const fabricatedAcceptance = {
      status: "accepted",
      updatedAtISO: acceptedAtISO,
      lifecycle: {
        acceptedAtISO
      },
      portalDecision: {
        decision: "accepted",
        message: "",
        requestId: "portal-decision-000000000009",
        submittedAtISO: acceptedAtISO
      }
    };

    await assertFails(updateDoc(salesQuote, fabricatedAcceptance));
    await assertFails(updateDoc(adminQuote, fabricatedAcceptance));
    await assertFails(updateDoc(salesQuote, {
      status: "accepted",
      updatedAtISO: acceptedAtISO,
      lifecycle: {
        acceptedAtISO
      }
    }));
  });

  test("inactive or suspended organizations revoke staff and portal access", async () => {
    const portalRef = portalSnapshotRefFor(VALID_PORTAL_KEY);
    const salesQuote = quoteRefFor("sales-org-a", "sales-a@example.com", "org-a", "q1");
    const customerQuote = quoteRefFor("customer-org-a", "customer-a@example.com", "org-a", "q1");

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "organizations", "org-a"), {
        active: false
      });
    });
    await assertFails(getDoc(portalRef));
    await assertFails(getDoc(salesQuote));
    await assertFails(getDoc(customerQuote));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "organizations", "org-a"), {
        active: true,
        status: "suspended"
      });
    });
    await assertFails(getDoc(portalRef));
    await assertFails(getDoc(salesQuote));
    await assertFails(getDoc(customerQuote));
  });

  test("tombstoning an organization revokes its public portal token immediately", async () => {
    const activeRef = portalSnapshotRefFor(VALID_PORTAL_KEY);
    const staffQuote = quoteRefFor("sales-org-a", "sales-a@example.com", "org-a", "q1");
    await assertSucceeds(getDoc(activeRef));
    await assertSucceeds(getDoc(staffQuote));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "organizationTombstones", "org-a"), {
        organizationId: "org-a",
        state: "deleting"
      });
    });

    await assertFails(getDoc(activeRef));
    await assertFails(getDoc(staffQuote));
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "accepted",
      updatedAtISO: "2026-03-21T03:00:00.000Z",
      lifecycle: {
        acceptedAtISO: "2026-03-21T03:00:00.000Z"
      },
      portalDecision: {
        decision: "accepted",
        message: "",
        requestId: "portal-decision-000000000010",
        submittedAtISO: "2026-03-21T03:00:00.000Z"
      }
    }));
  });

  test("org quote portal status patch requires active portal snapshot", async () => {
    const activeQuoteRef = portalQuoteRefFor("org-a", "q1");
    await assertFails(updateDoc(activeQuoteRef, {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      },
      portalDecision: {
        decision: "changes_requested",
        message: "Please revise the entree.",
        requestId: "portal-decision-000000000011",
        submittedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));
    await assertSucceeds(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      },
      portalDecision: {
        decision: "changes_requested",
        message: "Please revise the entree.",
        requestId: "portal-decision-000000000011",
        submittedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));
    await assertFails(updateDoc(activeQuoteRef, {
      status: "accepted",
      updatedAtISO: "2026-03-21T01:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z",
        acceptedAtISO: "2026-03-21T01:00:00.000Z"
      }
    }));
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "accepted",
      updatedAtISO: "2026-03-21T01:15:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z",
        acceptedAtISO: "2026-03-21T01:15:00.000Z"
      },
      portalDecision: {
        decision: "accepted",
        message: "",
        requestId: "portal-decision-000000000012",
        submittedAtISO: "2026-03-21T01:15:00.000Z"
      }
    }));
    await assertFails(updatePortalPair(VALID_PORTAL_KEY, "org-a", "q1", {
      status: "declined",
      updatedAtISO: "2026-03-21T01:30:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z",
        acceptedAtISO: "2026-03-21T01:15:00.000Z",
        declinedAtISO: "2026-03-21T01:30:00.000Z"
      },
      portalDecision: {
        decision: "declined",
        message: "",
        requestId: "portal-decision-000000000013",
        submittedAtISO: "2026-03-21T01:30:00.000Z"
      }
    }));

    const expiredQuoteRef = portalQuoteRefFor("org-a", "q-expired");
    await assertFails(updatePortalPair(EXPIRED_PORTAL_KEY, "org-a", "q-expired", {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));

    const deletedQuoteRef = portalQuoteRefFor("org-a", "q-deleted");
    await assertFails(updatePortalPair(DELETED_PORTAL_KEY, "org-a", "q-deleted", {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));
  });

  test("browser acceptance is denied for newly provisioned organization records", async () => {
    const organizationId = "provisioned-org";
    const quoteId = "provisioned-quote";
    const portalKey = "provisioned-portal-key-abcdefghijklmnopqrstuvwxyz";
    const sentAtISO = "2026-03-21T00:00:00.000Z";
    const revisionId = `v0001@${sentAtISO}`;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "organizations", organizationId), {
        name: "Provisioned Organization",
        ownerEmail: "owner@example.test",
        plan: "growth",
        active: true,
        archived: false,
        status: "active"
      });
      await setDoc(doc(db, "organizations", organizationId, "quotes", quoteId), {
        quoteId,
        organizationId,
        portalKey,
        portalIssuedAtISO: sentAtISO,
        status: "sent",
        portalDecision: {},
        lifecycle: {
          sentAtISO
        },
        workflow: {
          quoteDelivery: {
            revisionId,
            state: "provider_accepted",
            provider: "resend",
            providerMessageId: "provisioned-provider-message-1",
            providerAcceptedAtISO: sentAtISO,
            portalActivationState: "active",
            portalKey,
            portalIssuedAtISO: sentAtISO
          }
        }
      });
      await setDoc(doc(db, "customerPortalQuotes", portalKey), {
        quoteId,
        organizationId,
        portalKey,
        portalIssuedAtISO: sentAtISO,
        deliveryEvidence: {
          revisionId,
          state: "provider_accepted",
          portalActivationState: "active",
          portalKey,
          portalIssuedAtISO: sentAtISO,
          providerAcceptedAtISO: sentAtISO
        },
        status: "sent",
        portalExpiresAtMs: ACTIVE_PORTAL_EXPIRES_MS,
        portalDecision: {},
        lifecycle: {
          sentAtISO
        }
      });
    });

    const acceptedAtISO = "2026-03-21T01:00:00.000Z";
    await assertFails(updatePortalPair(portalKey, organizationId, quoteId, {
      status: "accepted",
      updatedAtISO: acceptedAtISO,
      lifecycle: {
        sentAtISO,
        acceptedAtISO
      },
      portalDecision: {
        decision: "accepted",
        message: "",
        requestId: "portal-decision-000000000014",
        submittedAtISO: acceptedAtISO
      }
    }));
  });

  describe("change request resolution records", () => {
    test("browser principals can never write callable-owned change-request records", async () => {
      const db = testEnv.authenticatedContext("admin-org-a", {
        email: "admin-a@example.com",
        email_verified: true
      }).firestore();
      const ref = doc(db, "organizations", "org-a", "quotes", "q1", "changeRequestResolutions", "crr_browser");
      await assertFails(setDoc(ref, { schemaVersion: 1, stagedProposalIds: ["p1"] }));
      await assertFails(updateDoc(ref, { stagedProposalIds: [] }));
      await assertFails(deleteDoc(ref));
    });

    test("same-tenant staff read change-request records while foreign tenants stay denied", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), "organizations", "org-a", "quotes", "q1", "changeRequestResolutions", "crr_seeded"),
          { schemaVersion: 1, organizationId: "org-a", quoteId: "q1", stagedProposalIds: ["p1"] }
        );
      });
      const staffDb = testEnv.authenticatedContext("sales-org-a", {
        email: "sales-a@example.com",
        email_verified: true
      }).firestore();
      await assertSucceeds(getDoc(
        doc(staffDb, "organizations", "org-a", "quotes", "q1", "changeRequestResolutions", "crr_seeded")
      ));
      await assertFails(getDoc(
        doc(staffDb, "organizations", "org-b", "quotes", "q1", "changeRequestResolutions", "crr_seeded")
      ));
    });
  });
});
