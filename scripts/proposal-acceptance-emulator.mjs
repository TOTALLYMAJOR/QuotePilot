#!/usr/bin/env node

import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  terminate,
  writeBatch
} from "firebase/firestore";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const functionsHost = String(process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5601").trim();
if (!projectId.startsWith("demo-") || !firestoreHost || !functionsHost) {
  throw new Error("Proposal acceptance verification is emulator-only.");
}

function parseAddress(value) {
  const normalized = String(value || "").replace(/^https?:\/\//, "");
  const separator = normalized.lastIndexOf(":");
  const host = normalized.slice(0, separator);
  const port = Number(normalized.slice(separator + 1));
  assert.ok(host && Number.isInteger(port) && port > 0, `Invalid emulator address: ${value}`);
  return { host, port };
}

async function callAcceptance(data) {
  const response = await fetch(
    `http://${functionsHost}/${projectId}/us-central1/acceptQuoteProposal`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:4174"
      },
      body: JSON.stringify({ data })
    }
  );
  const payload = await response.json();
  if (payload?.error) {
    const error = new Error(payload.error.message || "Proposal acceptance failed.");
    error.status = payload.error.status;
    throw error;
  }
  return payload.result;
}

const admin = loadFirebaseAdmin();
if (!admin.getApps().length) admin.initializeApp({ projectId });
const adminDb = admin.getFirestore();
const organizationId = "proposal-acceptance-org";
const quoteId = "proposal-acceptance-quote";
const portalKey = "proposal-acceptance-portal-key-00000001";
const issuedAtISO = new Date(Date.now() - 60_000).toISOString();
const expiresAtISO = new Date(Date.now() + 86_400_000).toISOString();
const revisionId = `v0001@${issuedAtISO}`;
const deliveryEvidence = {
  revisionId,
  state: "provider_accepted",
  portalActivationState: "active",
  portalKey,
  portalIssuedAtISO: issuedAtISO,
  providerAcceptedAtISO: issuedAtISO
};
const totals = {
  base: 4200,
  addons: 250.25,
  rentals: 100,
  menu: 0,
  labor: 500,
  travel: 50,
  serviceFee: 510.04,
  tax: 408.02,
  total: 6018.31,
  deposit: 1805.49
};
const lifecycle = { sentAtISO: issuedAtISO };
const quote = {
  organizationId,
  portalKey,
  portalIssuedAtISO: issuedAtISO,
  portalExpiresAtISO: expiresAtISO,
  quoteNumber: "Q-EMULATOR-0001",
  status: "sent",
  customer: { name: "Emulator Customer", email: "customer@example.test" },
  event: {
    name: "Emulator Reception",
    date: "2026-09-20",
    time: "17:30",
    hours: 5,
    guests: 100,
    style: "buffet",
    venue: "Test Hall",
    venueAddress: "100 Test Avenue"
  },
  selection: {
    packageName: "Classic",
    addonSnapshots: [{ name: "Dessert" }],
    rentalSnapshots: [{ name: "Linens" }],
    menuItemNames: ["Chicken", "Green Beans"]
  },
  totals,
  lifecycle,
  portalDecision: {},
  workflow: {
    quoteDelivery: {
      ...deliveryEvidence,
      provider: "emulator",
      providerMessageId: "emulator-provider-message"
    }
  }
};
const portal = {
  quoteId,
  organizationId,
  portalKey,
  portalIssuedAtISO: issuedAtISO,
  portalExpiresAtISO: expiresAtISO,
  portalExpiresAtMs: new Date(expiresAtISO).getTime(),
  quoteNumber: quote.quoteNumber,
  customerName: quote.customer.name,
  customerEmail: quote.customer.email,
  eventName: quote.event.name,
  eventDate: quote.event.date,
  eventTime: quote.event.time,
  eventHours: quote.event.hours,
  eventGuests: quote.event.guests,
  eventStyle: quote.event.style,
  venue: quote.event.venue,
  venueAddress: quote.event.venueAddress,
  total: totals.total,
  deposit: totals.deposit,
  totals,
  selection: {
    packageName: quote.selection.packageName,
    addons: ["Dessert"],
    rentals: ["Linens"],
    menuItems: ["Chicken", "Green Beans"]
  },
  status: "sent",
  portalDecision: {},
  lifecycle,
  deliveryEvidence,
  createdAtISO: issuedAtISO,
  updatedAtISO: issuedAtISO
};

await adminDb.collection("organizations").doc(organizationId).set({
  name: "Proposal Acceptance Test",
  active: true,
  archived: false,
  status: "active"
});
await adminDb.collection("organizations").doc(organizationId)
  .collection("quotes").doc(quoteId).set(quote);
await adminDb.collection("customerPortalQuotes").doc(portalKey).set(portal);

const app = initializeApp({
  apiKey: "demo-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId
}, "proposal-acceptance-emulator");
const clientDb = getFirestore(app);
const firestoreAddress = parseAddress(firestoreHost);
connectFirestoreEmulator(clientDb, firestoreAddress.host, firestoreAddress.port);

try {
  const portalRef = doc(clientDb, "customerPortalQuotes", portalKey);
  const quoteRef = doc(clientDb, "organizations", organizationId, "quotes", quoteId);
  assert.equal((await getDoc(portalRef)).exists(), true);

  const forgedAtISO = new Date().toISOString();
  const forgedPatch = {
    status: "accepted",
    updatedAtISO: forgedAtISO,
    lifecycle: { ...lifecycle, acceptedAtISO: forgedAtISO },
    portalDecision: {
      decision: "accepted",
      message: "",
      requestId: "forged-acceptance-000000000001",
      submittedAtISO: forgedAtISO
    }
  };
  const forgedBatch = writeBatch(clientDb);
  forgedBatch.update(portalRef, forgedPatch);
  forgedBatch.update(quoteRef, forgedPatch);
  await assert.rejects(() => forgedBatch.commit());

  const request = {
    portalKey,
    signerName: "Emulator Customer",
    consentVersion: "proposal-acceptance-v1",
    expectedRevisionId: revisionId,
    expectedPortalIssuedAtISO: issuedAtISO,
    message: "Approved in the acceptance emulator."
  };
  const [first, concurrentRetry] = await Promise.all([
    callAcceptance(request),
    callAcceptance(request)
  ]);
  assert.equal(first.ok, true);
  assert.equal(concurrentRetry.ok, true);
  assert.equal(first.acceptanceReceipt.receiptId, concurrentRetry.acceptanceReceipt.receiptId);
  assert.equal(
    [first.idempotent, concurrentRetry.idempotent].filter(Boolean).length,
    1
  );
  assert.equal(first.acceptanceReceipt.totalMinor, 601831);
  assert.equal(first.acceptanceReceipt.depositMinor, 180549);
  assert.match(first.acceptanceReceipt.snapshotSha256, /^[a-f0-9]{64}$/);

  const [storedQuote, storedPortal, storedReceipt] = await Promise.all([
    adminDb.collection("organizations").doc(organizationId).collection("quotes").doc(quoteId).get(),
    adminDb.collection("customerPortalQuotes").doc(portalKey).get(),
    adminDb.collection("organizations").doc(organizationId)
      .collection("proposalAcceptanceReceipts")
      .doc(first.acceptanceReceipt.receiptId)
      .get()
  ]);
  assert.equal(storedQuote.data()?.status, "accepted");
  assert.deepEqual(storedQuote.data()?.acceptanceReceipt, storedPortal.data()?.acceptanceReceipt);
  assert.equal(storedReceipt.exists, true);
  assert.equal(storedReceipt.data()?.proposalSnapshot?.totalsMinor?.total, 601831);

  await assert.rejects(
    () => callAcceptance({ ...request, signerName: "Different Signer" }),
    (error) => error.status === "FAILED_PRECONDITION"
  );
} finally {
  await terminate(clientDb);
  await deleteApp(app);
}

console.log("Proposal acceptance emulator passed.");
console.log("- direct browser acceptance denied");
console.log("- concurrent callable acceptance produced one immutable receipt");
console.log("- signer, revision, hash, and integer minor-unit totals persisted to both quote copies");
