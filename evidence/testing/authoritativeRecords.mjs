// Builders that produce Firestore documents through the REAL writer modules.
//
// The exporter's whole claim is "I read what QuotePilot actually writes". A
// hand-authored fixture cannot test that claim, because a fixture is just the
// exporter author's belief about the shape written down twice. So these
// builders call functions/proposalAcceptance.js and functions/paymentLedger.js
// and use whatever those modules emit. If the acceptance receipt shape changes,
// these tests break, which is the point.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const {
  ACCEPTANCE_CONSENT_VERSION,
  planProposalAcceptance
} = require(path.join(ROOT, "functions", "proposalAcceptance.js"));

export const {
  PAYMENT_LEDGER_VERSION,
  planPaymentLedgerTransition
} = require(path.join(ROOT, "functions", "paymentLedger.js"));

const ORGANIZATION_ID = "org_demo";
const QUOTE_ID = "quote_demo_1";
const PORTAL_KEY = "portal_demo_key_1";
const REVISION_ID = "rev_7";
const PORTAL_ISSUED_AT = "2026-08-02T15:00:00.000Z";
const PROVIDER_ACCEPTED_AT = "2026-08-02T15:00:05.000Z";
const ACCEPTED_AT = "2026-08-05T18:22:11.000Z";
const RECEIPT_ID = "rcpt_demo_1";

export const TOTALS = Object.freeze({
  base: 12000,
  addons: 1800,
  rentals: 2400,
  menu: 0,
  labor: 3200,
  travel: 450,
  serviceFee: 960,
  tax: 1782,
  total: 22592,
  deposit: 4800
});

const SELECTION = Object.freeze({
  packageName: "Harvest Table",
  packageInclusions: { menuItems: [], addons: [], rentals: [] },
  menuItemNames: ["Herb Roast Chicken", "Seasonal Vegetables"],
  addonSnapshots: [{ name: "Late Night Snack" }],
  rentalSnapshots: [{ name: "Farm Tables" }, { name: "Gold Flatware" }]
});

const EVENT = Object.freeze({
  name: "Autumn Reception",
  date: "2026-10-17",
  time: "17:30",
  hours: 5,
  guests: 145,
  style: "Buffet",
  venue: "Riverbend Hall",
  venueAddress: "12 Riverbend Road",
  servers: 6,
  chefs: 2,
  bartenders: 1
});

const delivery = () => ({
  revisionId: REVISION_ID,
  state: "provider_accepted",
  portalActivationState: "active",
  portalKey: PORTAL_KEY,
  portalIssuedAtISO: PORTAL_ISSUED_AT,
  providerAcceptedAtISO: PROVIDER_ACCEPTED_AT
});

/** A quote document in the state that precedes acceptance. */
export function sentQuoteDocument(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    quoteNumber: "QP-1042",
    status: "sent",
    portalKey: PORTAL_KEY,
    portalIssuedAtISO: PORTAL_ISSUED_AT,
    activeVersionId: REVISION_ID,
    latestVersionNumber: 7,
    updatedAtISO: "2026-08-02T15:00:00.000Z",
    customer: { name: "Dana Reyes", email: "dana@example.com", phone: "555-0100" },
    event: { ...EVENT },
    selection: { ...SELECTION },
    totals: { ...TOTALS },
    workflow: { quoteDelivery: delivery() },
    pricingCatalogAuthority: {
      schemaVersion: 1,
      organizationId: ORGANIZATION_ID,
      catalogSource: "organization",
      catalogRevision: 12,
      confirmedCatalogRevision: 12,
      settingsFingerprintSha256: "0f2c1b8a4d6e9f70112233445566778899aabbccddeeff001122334455667788"
    },
    ...overrides
  };
}

/** The customer-facing portal projection of the same quote. */
export function portalDocument(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    quoteNumber: "QP-1042",
    status: "sent",
    portalKey: PORTAL_KEY,
    portalIssuedAtISO: PORTAL_ISSUED_AT,
    portalExpiresAtMs: Date.parse("2026-12-31T00:00:00.000Z"),
    customerName: "Dana Reyes",
    customerEmail: "dana@example.com",
    eventName: EVENT.name,
    eventDate: EVENT.date,
    eventTime: EVENT.time,
    eventHours: EVENT.hours,
    eventGuests: EVENT.guests,
    eventStyle: EVENT.style,
    venue: EVENT.venue,
    venueAddress: EVENT.venueAddress,
    selection: {
      packageName: SELECTION.packageName,
      packageInclusions: SELECTION.packageInclusions,
      menuItems: SELECTION.menuItemNames,
      addons: SELECTION.addonSnapshots.map((item) => item.name),
      rentals: SELECTION.rentalSnapshots.map((item) => item.name)
    },
    totals: { ...TOTALS },
    total: TOTALS.total,
    deposit: TOTALS.deposit,
    deliveryEvidence: delivery(),
    ...overrides
  };
}

/**
 * Run the real acceptance planner and return the documents Firestore would
 * hold afterwards.
 */
export function acceptedRecords({ quote = sentQuoteDocument(), portal = portalDocument() } = {}) {
  const plan = planProposalAcceptance({
    quoteId: QUOTE_ID,
    quote,
    portal,
    portalKey: PORTAL_KEY,
    signerName: "Dana Reyes",
    consentVersion: ACCEPTANCE_CONSENT_VERSION,
    expectedRevisionId: REVISION_ID,
    expectedPortalIssuedAtISO: PORTAL_ISSUED_AT,
    message: "Looks great, please proceed.",
    acceptedAtISO: ACCEPTED_AT,
    receiptId: RECEIPT_ID,
    actor: { uid: "portal_user_1", email: "dana@example.com" }
  });

  return {
    quote: { ...quote, ...plan.quotePatch },
    acceptanceReceipt: plan.receiptDocument,
    plan
  };
}

/** Run the real ledger planner to produce a settled deposit ledger. */
export function settledDepositLedger({ totals = TOTALS } = {}) {
  const prepared = planPaymentLedgerTransition({
    quoteTotals: { total: totals.total, deposit: totals.deposit },
    entries: [],
    operationId: "op_deposit_1",
    paymentKind: "deposit",
    amountCents: Math.round(totals.deposit * 100),
    nextState: "prepared",
    providerReference: "cs_test_deposit_1042"
  });
  const settled = planPaymentLedgerTransition({
    quoteTotals: { total: totals.total, deposit: totals.deposit },
    entries: prepared.projection.entries,
    operationId: "op_deposit_1",
    paymentKind: "deposit",
    amountCents: Math.round(totals.deposit * 100),
    nextState: "paid",
    providerReference: "cs_test_deposit_1042",
    providerSettledAtISO: "2026-08-05T18:25:40.000Z"
  });
  return {
    version: PAYMENT_LEDGER_VERSION,
    entries: settled.projection.entries.map((entry) => ({ ...entry }))
  };
}

/** The quote version document carrying staff-recorded cost evidence. */
export function quoteVersionDocument(overrides = {}) {
  return {
    versionId: REVISION_ID,
    createdAtISO: "2026-08-01T15:04:05.000Z",
    commercialSnapshot: {
      version: "commercial-snapshot-v1",
      targetMarginBasisPoints: 3500,
      categories: {
        base: { extendedCostCents: 540000 },
        addons: { extendedCostCents: 72000 },
        rentals: { extendedCostCents: 96000 },
        labor: { extendedCostCents: 208000 }
      }
    },
    ...overrides
  };
}

export const IDS = Object.freeze({
  ORGANIZATION_ID,
  QUOTE_ID,
  PORTAL_KEY,
  REVISION_ID,
  RECEIPT_ID,
  ACCEPTED_AT,
  PORTAL_ISSUED_AT
});
