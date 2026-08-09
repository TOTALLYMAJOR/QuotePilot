import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loadFirebaseAdmin } from "../../../scripts/firebase-admin-modular.mjs";
import {
  parsePortalBackfillArgs,
  runPortalSnapshotBackfill
} from "../../../scripts/backfill-portal-snapshots.mjs";

const PROJECT_ID = "demo-portal-backfill";
const ORGANIZATION_ID = "org-backfill";
const PORTAL_ID = "portal-backfill-token-abcdefghijklmnopqrstuvwxyz";
const FOREIGN_PORTAL_ID = "portal-foreign-token-abcdefghijklmnopqrstuvwxyz";
const HAS_EMULATOR = Boolean(String(process.env.FIRESTORE_EMULATOR_HOST || "").trim());

let db;
let tempDir;

function activeQuote(portalKey, organizationId = ORGANIZATION_ID) {
  return {
    organizationId,
    portalKey,
    portalIssuedAtISO: "2026-08-03T00:00:00.000Z",
    portalExpiresAtISO: "2099-01-01T00:00:00.000Z",
    quoteNumber: "Q-BACKFILL-1",
    customer: { name: "Private Customer", email: "private@example.com" },
    event: {
      name: "Private Event",
      date: "2027-05-01",
      time: "17:30",
      hours: 5,
      guests: 120,
      venue: "Private Venue"
    },
    totals: { base: 9000, total: 10000, deposit: 3000 },
    selection: {
      packageName: "Full Service",
      addonSnapshots: [{ name: "Coffee" }],
      rentalSnapshots: [],
      menuItemNames: ["Dinner"]
    },
    quoteMeta: { brandName: "QuotePilot" },
    status: "sent",
    expiresAtISO: "2099-01-01T00:00:00.000Z",
    payment: { depositStatus: "unpaid", depositLink: "" },
    booking: { confirmationStatus: "pending" },
    portalDecision: {},
    lifecycle: { sentAtISO: "2026-08-03T00:00:00.000Z" },
    createdAtISO: "2026-08-03T00:00:00.000Z",
    updatedAtISO: "2026-08-03T00:00:00.000Z"
  };
}

describe.skipIf(!HAS_EMULATOR)("portal snapshot backfill emulator acceptance", () => {
  beforeAll(async () => {
    const admin = loadFirebaseAdmin();
    if (!admin.getApps().length) admin.initializeApp({ projectId: PROJECT_ID });
    db = admin.getFirestore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-portal-emulator-"));

    await Promise.all([
      db.doc(`organizations/${ORGANIZATION_ID}/quotes/quote-backfill`).set(activeQuote(PORTAL_ID)),
      db.doc(`organizations/${ORGANIZATION_ID}/quotes/quote-foreign`).set(
        activeQuote(FOREIGN_PORTAL_ID, "org-foreign")
      ),
      db.doc(`customerPortalQuotes/${PORTAL_ID}`).set({
        quoteId: "quote-backfill",
        organizationId: ORGANIZATION_ID,
        portalKey: PORTAL_ID,
        portalExpiresAtISO: "2099-01-01T00:00:00.000Z",
        portalExpiresAtMs: Date.parse("2099-01-01T00:00:00.000Z"),
        status: "sent",
        payment: { depositStatus: "unpaid", providerReference: "preserve-provider-proof" },
        operatorAnnotation: "preserve-operator-data"
      }),
      db.doc(`customerPortalQuotes/${FOREIGN_PORTAL_ID}`).set({
        quoteId: "quote-foreign",
        organizationId: "org-foreign",
        portalKey: FOREIGN_PORTAL_ID,
        portalExpiresAtISO: "2099-01-01T00:00:00.000Z",
        portalExpiresAtMs: Date.parse("2099-01-01T00:00:00.000Z"),
        status: "sent",
        marker: "must-remain-unchanged"
      })
    ]);
  }, 30_000);

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("keeps dry run read-only, then applies a tenant-scoped transaction with count-only evidence", async () => {
    const dryRunEvidencePath = path.join(tempDir, "dry-run-evidence.json");
    const dryRunOptions = parsePortalBackfillArgs([
      "--project", PROJECT_ID,
      "--organization", ORGANIZATION_ID,
      "--dry-run",
      "--evidence-out", dryRunEvidencePath
    ]);
    const dryRunResult = await runPortalSnapshotBackfill(dryRunOptions);
    const afterDryRun = await db.doc(`customerPortalQuotes/${PORTAL_ID}`).get();

    expect(dryRunResult.evidence.summary).toMatchObject({ wouldPatch: 1, patched: 0 });
    expect(afterDryRun.data()).not.toHaveProperty("portalProjectionVersion");

    const evidencePath = path.join(tempDir, "apply-evidence.json");
    const options = parsePortalBackfillArgs([
      "--project", PROJECT_ID,
      "--organization", ORGANIZATION_ID,
      "--apply",
      "--confirm", `BACKFILL PORTALS ${PROJECT_ID} ${ORGANIZATION_ID}`,
      "--evidence-out", evidencePath
    ]);

    const result = await runPortalSnapshotBackfill(options);
    const [portalSnapshot, foreignSnapshot] = await Promise.all([
      db.doc(`customerPortalQuotes/${PORTAL_ID}`).get(),
      db.doc(`customerPortalQuotes/${FOREIGN_PORTAL_ID}`).get()
    ]);
    const updated = portalSnapshot.data();
    const foreign = foreignSnapshot.data();

    expect(updated).toMatchObject({
      customerName: "Private Customer",
      eventName: "Private Event",
      total: 10000,
      selection: { packageName: "Full Service" },
      payment: {
        depositStatus: "unpaid",
        providerReference: "preserve-provider-proof"
      },
      operatorAnnotation: "preserve-operator-data",
      portalProjectionVersion: 2
    });
    expect(foreign).toMatchObject({
      marker: "must-remain-unchanged"
    });
    expect(foreign).not.toHaveProperty("portalProjectionVersion");

    const evidenceText = fs.readFileSync(evidencePath, "utf8");
    const evidence = JSON.parse(evidenceText);
    expect(result.evidence.summary).toMatchObject({ patched: 1, skippedForeignOrganization: 1 });
    expect(evidence.summary).toEqual(result.evidence.summary);
    expect(evidenceText).not.toContain(PORTAL_ID);
    expect(evidenceText).not.toContain("Private Customer");
    expect(evidenceText).not.toContain("private@example.com");
    expect(fs.statSync(evidencePath).mode & 0o777).toBe(0o600);
  }, 30_000);
});
