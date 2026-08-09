import { beforeAll, describe, expect, test } from "vitest";
import { loadFirebaseAdmin } from "../../../scripts/firebase-admin-modular.mjs";
import { runCustomerIdBackfill } from "../../../scripts/backfill-customer-ids.mjs";

const PROJECT_ID = "demo-customer-id-backfill";
const ORGANIZATION_ID = "org-customer-id-backfill";
const HAS_EMULATOR = Boolean(String(process.env.FIRESTORE_EMULATOR_HOST || "").trim());

let db;

describe.skipIf(!HAS_EMULATOR)("customer identity backfill emulator acceptance", () => {
  beforeAll(async () => {
    const admin = loadFirebaseAdmin();
    if (!admin.getApps().length) admin.initializeApp({ projectId: PROJECT_ID });
    db = admin.getFirestore();
    await Promise.all([
      db.doc(`organizations/${ORGANIZATION_ID}/customers/customer-unique`).set({
        organizationId: ORGANIZATION_ID,
        name: "Unique Customer",
        email: "unique@example.com"
      }),
      db.doc(`organizations/${ORGANIZATION_ID}/customers/customer-duplicate-a`).set({
        organizationId: ORGANIZATION_ID,
        name: "Duplicate A",
        email: "duplicate@example.com"
      }),
      db.doc(`organizations/${ORGANIZATION_ID}/customers/customer-duplicate-b`).set({
        organizationId: ORGANIZATION_ID,
        name: "Duplicate B",
        emailKey: "duplicate@example.com",
        email: "DUPLICATE@example.com"
      }),
      db.doc(`organizations/${ORGANIZATION_ID}/quotes/quote-unique`).set({
        organizationId: ORGANIZATION_ID,
        customerEmailKey: "unique@example.com",
        customer: { name: "Unique Customer", email: "unique@example.com" }
      }),
      db.doc(`organizations/${ORGANIZATION_ID}/quotes/quote-duplicate`).set({
        organizationId: ORGANIZATION_ID,
        customerEmailKey: "duplicate@example.com",
        customer: { name: "Duplicate", email: "duplicate@example.com" }
      }),
      db.doc(`organizations/${ORGANIZATION_ID}/quotes/quote-unique/versions/v0001`).set({
        versionId: "v0001",
        quoteId: "quote-unique",
        organizationId: ORGANIZATION_ID,
        snapshot: { id: "quote-unique", organizationId: ORGANIZATION_ID }
      })
    ]);
  }, 30_000);

  test("dry-run is read-only and emulator apply binds only the unique match", async () => {
    const dryRun = await runCustomerIdBackfill({
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
      dryRun: true
    });
    expect(dryRun.plan.summary).toMatchObject({
      wouldBind: 1,
      duplicateCustomerMatch: 1
    });
    expect((await db.doc(
      `organizations/${ORGANIZATION_ID}/quotes/quote-unique`
    ).get()).data()).not.toHaveProperty("customerId");

    const applied = await runCustomerIdBackfill({
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
      dryRun: false,
      confirmation: `BACKFILL CUSTOMER IDS ${PROJECT_ID} ${ORGANIZATION_ID}`
    });
    const [quoteSnapshot, duplicateSnapshot, customerSnapshot, versionSnapshot] = await Promise.all([
      db.doc(`organizations/${ORGANIZATION_ID}/quotes/quote-unique`).get(),
      db.doc(`organizations/${ORGANIZATION_ID}/quotes/quote-duplicate`).get(),
      db.doc(`organizations/${ORGANIZATION_ID}/customers/customer-unique`).get(),
      db.doc(`organizations/${ORGANIZATION_ID}/quotes/quote-unique/versions/v0001`).get()
    ]);

    expect(applied.applySummary).toMatchObject({ bound: 1, conflicts: 0 });
    expect(quoteSnapshot.data().customerId).toBe("customer-unique");
    expect(duplicateSnapshot.data()).not.toHaveProperty("customerId");
    expect(customerSnapshot.data()).toMatchObject({
      customerId: "customer-unique",
      emailKey: "unique@example.com",
      nameKey: "unique customer"
    });
    expect(versionSnapshot.data()).toMatchObject({
      customerId: "customer-unique",
      snapshot: { customerId: "customer-unique" }
    });
  }, 30_000);
});
