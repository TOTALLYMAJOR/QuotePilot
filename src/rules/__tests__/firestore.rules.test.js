import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, afterAll, describe, test } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const PROJECT_ID = "quote-wizard-rules";
const RULES_PATH = path.resolve(process.cwd(), "firestore.rules");
const HAS_FIRESTORE_EMULATOR = Boolean(String(process.env.FIRESTORE_EMULATOR_HOST || "").trim());
const VALID_PORTAL_KEY = "abcdefghijklmnopqrstuvwxyz";
const EXPIRED_PORTAL_KEY = "expired-abcdefghijklmnopqrstuvwxyz";
const DELETED_PORTAL_KEY = "deleted-abcdefghijklmnopqrstuvwxyz";
const ACTIVE_PORTAL_EXPIRES_MS = 4102444800000; // 2100-01-01T00:00:00.000Z
const EXPIRED_PORTAL_EXPIRES_MS = 1577836800000; // 2020-01-01T00:00:00.000Z

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
    await setDoc(doc(db, "organizations", "org-a", "quotes", "q1"), {
      ownerUid: "sales-org-a",
      organizationId: "org-a",
      portalKey: VALID_PORTAL_KEY,
      status: "draft"
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
  const db = testEnv.authenticatedContext(uid, { email }).firestore();
  return doc(db, "organizations", orgId, "quotes", quoteId, "versions", versionId);
}

function quoteRefFor(uid, email, orgId, quoteId) {
  const db = testEnv.authenticatedContext(uid, { email }).firestore();
  return doc(db, "organizations", orgId, "quotes", quoteId);
}

function quoteRefForWithClaims(uid, email, claims = {}, orgId, quoteId) {
  const db = testEnv.authenticatedContext(uid, { email, ...claims }).firestore();
  return doc(db, "organizations", orgId, "quotes", quoteId);
}

function orgScopedRefFor(uid, email, orgId, collection, docId) {
  const db = testEnv.authenticatedContext(uid, { email }).firestore();
  return doc(db, "organizations", orgId, collection, docId);
}

function tenantDomainRefFor(uid, email, claims = {}, hostname = "tenant-a.mbmapps.com") {
  const db = testEnv.authenticatedContext(uid, { email, ...claims }).firestore();
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

function buildQuotePayload(ownerUid, organizationId, overrides = {}) {
  return {
    ownerUid,
    organizationId,
    portalKey: VALID_PORTAL_KEY,
    status: "draft",
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
    status: "draft",
    createdBy: {
      uid: "sales-org-a",
      email: "sales-a@example.com",
      role: "sales"
    },
    pricing: {
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
    },
    snapshot: {
      id: "q1",
      status: "draft"
    },
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
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedBaseData();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  test("org staff can create and read version docs in own org", async () => {
    const ref = versionRefFor("sales-org-a", "sales-a@example.com", "org-a");
    await assertSucceeds(setDoc(ref, buildVersionPayload()));
    await assertSucceeds(getDoc(ref));
  });

  test("version docs are immutable after create", async () => {
    const ref = versionRefFor("sales-org-a", "sales-a@example.com", "org-a");
    await assertSucceeds(setDoc(ref, buildVersionPayload()));

    await assertFails(updateDoc(ref, { reason: "mutated" }));
    await assertFails(deleteDoc(ref));
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

  test("org-a admin can write own org paths but cannot write org-b quotes/catalog/menu/settings", async () => {
    const ownOrgQuoteRef = quoteRefFor("admin-org-a", "admin-a@example.com", "org-a", "q-admin-own");
    await assertSucceeds(setDoc(ownOrgQuoteRef, buildQuotePayload("admin-org-a", "org-a")));

    const crossOrgQuoteRef = quoteRefFor("admin-org-a", "admin-a@example.com", "org-b", "q-admin-cross");
    await assertFails(setDoc(crossOrgQuoteRef, buildQuotePayload("admin-org-a", "org-b")));

    for (const { collection, docId, data } of ORG_SCOPED_ADMIN_WRITE_CASES) {
      const ownOrgRef = orgScopedRefFor("admin-org-a", "admin-a@example.com", "org-a", collection, docId);
      await assertSucceeds(setDoc(ownOrgRef, data));

      const crossOrgRef = orgScopedRefFor("admin-org-a", "admin-a@example.com", "org-b", collection, docId);
      await assertFails(setDoc(crossOrgRef, data));
    }
  });

  test("org-a sales cannot write org-b quotes/catalog/menu/settings", async () => {
    const ownOrgQuoteRef = quoteRefFor("sales-org-a", "sales-a@example.com", "org-a", "q-sales-own");
    await assertSucceeds(setDoc(ownOrgQuoteRef, buildQuotePayload("sales-org-a", "org-a")));

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

  test("customer cannot write staff-only org quote/catalog/menu/settings paths", async () => {
    const customerQuoteRef = quoteRefFor("customer-org-a", "customer-a@example.com", "org-a", "q-customer-own");
    await assertFails(setDoc(customerQuoteRef, buildQuotePayload("customer-org-a", "org-a")));

    await assertOrgScopedWritesFail("customer-org-a", "customer-a@example.com", "org-a");
  });

  test("portal snapshots allow active key reads/status updates and deny expired/deleted keys", async () => {
    const activeRef = portalSnapshotRefFor(VALID_PORTAL_KEY);
    await assertSucceeds(getDoc(activeRef));
    await assertSucceeds(updateDoc(activeRef, {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));
    await assertSucceeds(updateDoc(activeRef, {
      status: "viewed",
      updatedAtISO: "2026-03-21T01:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T01:00:00.000Z"
      },
      portalDecision: {
        decision: "changes_requested",
        message: "Please revise the entree.",
        submittedAtISO: "2026-03-21T01:00:00.000Z"
      }
    }));
    await assertFails(updateDoc(activeRef, {
      status: "viewed",
      updatedAtISO: "2026-03-21T02:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T02:00:00.000Z"
      },
      portalDecision: {
        decision: "changes_requested",
        message: "",
        submittedAtISO: "2026-03-21T02:00:00.000Z"
      }
    }));
    await assertFails(updateDoc(activeRef, {
      status: "accepted",
      updatedAtISO: "2026-03-21T02:30:00.000Z",
      lifecycle: {
        acceptedAtISO: "2026-03-21T02:30:00.000Z"
      },
      portalDecision: {
        decision: "declined",
        message: "",
        submittedAtISO: "2026-03-21T02:30:00.000Z"
      }
    }));

    const expiredRef = portalSnapshotRefFor(EXPIRED_PORTAL_KEY);
    await assertFails(getDoc(expiredRef));
    await assertFails(updateDoc(expiredRef, {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));

    const deletedRef = portalSnapshotRefFor(DELETED_PORTAL_KEY);
    await assertFails(getDoc(deletedRef));
    await assertFails(updateDoc(deletedRef, {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));
  });

  test("org quote portal status patch requires active portal snapshot", async () => {
    const activeQuoteRef = portalQuoteRefFor("org-a", "q1");
    await assertSucceeds(updateDoc(activeQuoteRef, {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      },
      portalDecision: {
        decision: "changes_requested",
        message: "Please revise the entree.",
        submittedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));

    const expiredQuoteRef = portalQuoteRefFor("org-a", "q-expired");
    await assertFails(updateDoc(expiredQuoteRef, {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));

    const deletedQuoteRef = portalQuoteRefFor("org-a", "q-deleted");
    await assertFails(updateDoc(deletedQuoteRef, {
      status: "viewed",
      updatedAtISO: "2026-03-21T00:00:00.000Z",
      lifecycle: {
        viewedAtISO: "2026-03-21T00:00:00.000Z"
      }
    }));
  });
});
