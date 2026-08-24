#!/usr/bin/env node
// Emulator acceptance for the Commercial Truth Loop evidence reader.
//
// Proves the supply chain against a real Firestore rather than a test double:
//   seeded Firestore -> reader -> exporter -> canonical bundle
//
// It asserts the guarantees that matter operationally and cannot be checked by
// reading the code: tenant isolation against a genuinely populated second
// organization, that no secret stored beside the evidence reaches the bundle,
// and that two reads of unchanged data produce identical bytes.
//
// This is emulator evidence only. It is not hosted verification, provider
// evidence, a production data path, or human acceptance.

import assert from "node:assert/strict";

import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";
import {
  eventCompletedBefore,
  readOrganizationEvidence
} from "../evidence/src/firestoreReader.mjs";
import { exportBundle } from "../evidence/src/exporterCore.mjs";
import { canonicalJson } from "../evidence/src/canonical.mjs";
import { guarded, producerRegistry } from "../evidence/src/producers/index.mjs";
import { createPayoutProducer } from "../evidence/src/producers/payoutProducer.mjs";
import { createFeeScheduleProducer } from "../evidence/src/producers/feeScheduleProducer.mjs";
import { createConsumptionProducer } from "../evidence/src/producers/consumptionProducer.mjs";
import { AVAILABILITY, missing } from "../evidence/src/availability.mjs";
import {
  IDS,
  acceptedRecords,
  quoteVersionDocument,
  settledDepositLedger
} from "../evidence/testing/authoritativeRecords.mjs";

const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();

if (!projectId.startsWith("demo-") || !firestoreHost) {
  throw new Error(
    "Truth Loop export acceptance is emulator-only. Use a demo-* project with the Firestore emulator."
  );
}

const admin = loadFirebaseAdmin();
if (!admin.getApps().length) admin.initializeApp({ projectId });
const db = admin.getFirestore();

const ORG = "truthloop-emulator-org";
const OTHER_ORG = "truthloop-emulator-other-org";
const EVALUATED_AT = "2026-08-21T14:00:00.000Z";

const PORTAL_KEY_SECRET = "portal_key_must_never_be_exported";
const BUYER_TOKEN_SECRET = "buyer_token_must_never_be_exported";
const WEBHOOK_SECRET = "whsec_must_never_be_exported";

// -- seed ------------------------------------------------------------------

const accepted = acceptedRecords();
accepted.quote.payment = { ledger: settledDepositLedger() };

const orgRef = db.collection("organizations").doc(ORG);
await orgRef.set({ organizationId: ORG });
await orgRef.collection("settings").doc("config").set({
  catalogRevision: 12,
  stripeWebhookSecret: WEBHOOK_SECRET
});
await orgRef.collection("quotes").doc(IDS.QUOTE_ID).set({
  ...accepted.quote,
  organizationId: ORG,
  portalKey: PORTAL_KEY_SECRET,
  buyerAccess: { token: BUYER_TOKEN_SECRET }
});
await orgRef
  .collection("proposalAcceptanceReceipts")
  .doc(IDS.RECEIPT_ID)
  .set({ ...accepted.acceptanceReceipt, organizationId: ORG });
await orgRef
  .collection("quotes").doc(IDS.QUOTE_ID)
  .collection("versions").doc(IDS.REVISION_ID)
  .set(quoteVersionDocument());

// A genuinely populated second tenant. Its documents must never appear.
const otherRef = db.collection("organizations").doc(OTHER_ORG);
await otherRef.set({ organizationId: OTHER_ORG });
await otherRef.collection("settings").doc("config").set({ catalogRevision: 99 });
await otherRef.collection("quotes").doc("other-tenant-quote").set({
  organizationId: OTHER_ORG,
  quoteNumber: "OTHER-9999",
  status: "accepted",
  portalKey: "other_tenant_portal_key"
});

// -- read ------------------------------------------------------------------

const result = await readOrganizationEvidence({
  db,
  organizationId: ORG,
  eventCompleted: eventCompletedBefore(EVALUATED_AT)
});

assert.equal(result.organizationId, ORG);
assert.equal(result.records.length, 1, "exactly the seeded quote for this tenant");
assert.equal(result.records[0].quoteId, IDS.QUOTE_ID);

// Tenant isolation, against a real populated neighbour.
const readSerialized = JSON.stringify(result);
assert.ok(!readSerialized.includes(OTHER_ORG), "no other-tenant identifier in the read");
assert.ok(!readSerialized.includes("OTHER-9999"), "no other-tenant quote in the read");
assert.ok(!readSerialized.includes("other_tenant_portal_key"), "no other-tenant secret in the read");

// Secrets stored beside the evidence never leave the reader.
for (const secret of [PORTAL_KEY_SECRET, BUYER_TOKEN_SECRET, WEBHOOK_SECRET]) {
  assert.ok(!readSerialized.includes(secret), `reader withheld ${secret.slice(0, 12)}…`);
}

// The other tenant reads independently and sees only its own quote.
const otherResult = await readOrganizationEvidence({ db, organizationId: OTHER_ORG });
assert.equal(otherResult.records.length, 1);
assert.equal(otherResult.records[0].quoteId, "other-tenant-quote");
assert.ok(!JSON.stringify(otherResult).includes(IDS.QUOTE_ID));

// -- export ----------------------------------------------------------------

function buildProducers(settings) {
  return producerRegistry([
    guarded(createPayoutProducer(), { missing }),
    guarded(
      createFeeScheduleProducer({ readOrganizationSettings: (id) => settings[id] || null }),
      { missing }
    ),
    guarded(createConsumptionProducer({ readConsumption: () => null }), { missing })
  ]);
}

function buildBundle(read) {
  return exportBundle(
    read.records.map((record) => ({
      ...record,
      organizationSettings: read.organizationSettings[read.organizationId] || null
    })),
    { evaluatedAtISO: EVALUATED_AT, producers: buildProducers(read.organizationSettings) }
  );
}

const bundle = buildBundle(result);
const evidence = bundle.records[0].evidence;

assert.equal(bundle.bundleVersion, "truthloop-evidence-bundle-v2");
assert.equal(evidence.acceptedSnapshot.availability, AVAILABILITY.AVAILABLE);
assert.equal(evidence.payments.availability, AVAILABILITY.AVAILABLE);
assert.equal(evidence.authorizedQuote.availability, AVAILABILITY.AVAILABLE);
assert.equal(evidence.operationalPlan.availability, AVAILABILITY.AVAILABLE);
assert.equal(evidence.costBasis.availability, AVAILABILITY.AVAILABLE);
// Acceptance itself writes a portalDecision (decision "accepted"), so this
// section is available on every accepted quote rather than absent. The
// freshness rule reads it and finds nothing contradicting the snapshot.
assert.equal(evidence.customerRequest.availability, AVAILABILITY.AVAILABLE);
assert.equal(evidence.customerRequest.value.decision, "accepted");
assert.equal(evidence.customerRequest.value.proposals.length, 0);

// The three structural gaps stay exactly as documented.
assert.equal(evidence.payouts.availability, AVAILABILITY.BLOCKED_BY_INTEGRATION);
assert.equal(evidence.payouts.blockedBy, "stripe_connect_stopping_point");
assert.equal(evidence.processorFeeSchedule.availability, AVAILABILITY.MISSING);
assert.equal(evidence.processorFeeSchedule.constraintClass, "business_policy");

// Provenance names the real Firestore paths an operator can open.
assert.equal(
  evidence.acceptedSnapshot.provenance.sourceObject,
  `organizations/${ORG}/proposalAcceptanceReceipts/${IDS.RECEIPT_ID}`
);
assert.equal(
  evidence.payments.provenance.sourceObject,
  `organizations/${ORG}/quotes/${IDS.QUOTE_ID}`
);

// No secret survives into the finished bundle either.
const bundleSerialized = canonicalJson(bundle);
for (const secret of [PORTAL_KEY_SECRET, BUYER_TOKEN_SECRET, WEBHOOK_SECRET, OTHER_ORG]) {
  assert.ok(!bundleSerialized.includes(secret), `bundle withheld ${secret.slice(0, 12)}…`);
}

// -- determinism -----------------------------------------------------------

const secondRead = await readOrganizationEvidence({
  db,
  organizationId: ORG,
  eventCompleted: eventCompletedBefore(EVALUATED_AT)
});
assert.equal(
  canonicalJson(buildBundle(secondRead)),
  bundleSerialized,
  "two reads of unchanged data produce identical bytes"
);

// -- refusal ---------------------------------------------------------------

await assert.rejects(
  () => readOrganizationEvidence({ db, organizationId: "" }),
  /explicit organizationId/,
  "there is no all-tenant read"
);

// A mis-filed document must abort rather than be silently skipped.
await orgRef.collection("quotes").doc("misfiled-quote").set({
  organizationId: OTHER_ORG,
  quoteNumber: "MISFILED-1"
});
await assert.rejects(
  () => readOrganizationEvidence({ db, organizationId: ORG }),
  /Refusing to build evidence across tenants/,
  "a cross-tenant document aborts the read"
);
await orgRef.collection("quotes").doc("misfiled-quote").delete();

console.log("Truth Loop export emulator acceptance passed.");
console.log(`- tenant-isolated read of ${result.records.length} record(s) from ${ORG}`);
console.log("- no portal key, buyer token, webhook secret, or foreign tenant in the bundle");
console.log("- provenance resolves to real Firestore paths");
console.log("- repeat read produced identical canonical bytes");
console.log("- all-tenant read and cross-tenant document both refused");
console.log("This is emulator evidence only: not hosted, provider, production, or human acceptance.");
