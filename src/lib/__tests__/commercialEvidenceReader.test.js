// Containment tests for the read-only Firestore evidence reader.
//
// These run always-on (no emulator) against a fake Firestore that deliberately
// omits collectionGroup, so a cross-tenant query would throw rather than pass.
// The source documents are built by the real proposalAcceptance and
// paymentLedger planners, so the reader is exercised against the shapes
// QuotePilot actually writes.

import { describe, expect, it } from "vitest";

import {
  QUOTE_FIELDS,
  READER_VERSION,
  EvidenceReadError,
  eventCompletedBefore,
  readOrganizationEvidence
} from "../../../evidence/src/firestoreReader.mjs";
import { fakeFirestore } from "../../../evidence/testing/fakeFirestore.mjs";
import {
  IDS,
  acceptedRecords,
  quoteVersionDocument,
  settledDepositLedger
} from "../../../evidence/testing/authoritativeRecords.mjs";
import { EVALUATED_AT } from "../../../evidence/testing/buildFixtures.mjs";
import { exportBundle } from "../../../evidence/src/exporterCore.mjs";
import { guarded, producerRegistry } from "../../../evidence/src/producers/index.mjs";
import { createPayoutProducer } from "../../../evidence/src/producers/payoutProducer.mjs";
import { createFeeScheduleProducer } from "../../../evidence/src/producers/feeScheduleProducer.mjs";
import { createConsumptionProducer } from "../../../evidence/src/producers/consumptionProducer.mjs";
import { AVAILABILITY, missing } from "../../../evidence/src/availability.mjs";

const ORG = IDS.ORGANIZATION_ID;
const QUOTE = IDS.QUOTE_ID;

/** A Firestore populated the way production writes it. */
function seededDb({ organizationId = ORG, extraQuoteFields = {}, otherTenantQuote = false } = {}) {
  const accepted = acceptedRecords();
  accepted.quote.payment = { ledger: settledDepositLedger() };

  const documents = {
    [`organizations/${organizationId}`]: { organizationId },
    [`organizations/${organizationId}/settings/config`]: {
      catalogRevision: 12,
      // A secret living beside the fields we want, to prove the allowlist.
      stripeWebhookSecret: "whsec_must_never_be_exported"
    },
    [`organizations/${organizationId}/quotes/${QUOTE}`]: {
      ...accepted.quote,
      organizationId,
      // Grants portal access. Must never leave the reader.
      portalKey: "portal_secret_key_value",
      buyerAccess: { token: "buyer_token_value" },
      ...extraQuoteFields
    },
    [`organizations/${organizationId}/proposalAcceptanceReceipts/${IDS.RECEIPT_ID}`]: {
      ...accepted.acceptanceReceipt,
      organizationId
    },
    [`organizations/${organizationId}/quotes/${QUOTE}/versions/${IDS.REVISION_ID}`]:
      quoteVersionDocument()
  };

  if (otherTenantQuote) {
    documents[`organizations/${organizationId}/quotes/foreign_quote`] = {
      organizationId: "some_other_org",
      quoteNumber: "X-1"
    };
  }
  return fakeFirestore(documents);
}

const read = (db, overrides = {}) =>
  readOrganizationEvidence({ db, organizationId: ORG, ...overrides });

describe("evidence reader: tenant containment", () => {
  it("requires an explicit organization — there is no all-tenant read", async () => {
    await expect(readOrganizationEvidence({ db: seededDb(), organizationId: "" }))
      .rejects.toThrow(EvidenceReadError);
    await expect(readOrganizationEvidence({ db: seededDb() }))
      .rejects.toThrow(/explicit organizationId/);
  });

  it("requires a Firestore handle", async () => {
    await expect(readOrganizationEvidence({ organizationId: ORG }))
      .rejects.toThrow(/Firestore handle/);
  });

  it("aborts on a document that belongs to another tenant", async () => {
    // Filtering it out would hide a real data-integrity bug; refusing does not.
    await expect(read(seededDb({ otherTenantQuote: true })))
      .rejects.toThrow(/Refusing to build evidence across tenants/);
  });

  it("reads nothing from an organization that has no documents", async () => {
    const result = await readOrganizationEvidence({
      db: seededDb(),
      organizationId: "unrelated_org"
    });
    expect(result.records).toEqual([]);
  });

  it("never reaches for a collectionGroup query", async () => {
    // The fake omits collectionGroup entirely, so any use would throw here.
    const db = seededDb();
    expect(db.collectionGroup).toBeUndefined();
    await expect(read(db)).resolves.toBeDefined();
  });
});

describe("evidence reader: field allowlist", () => {
  it("does not carry the portal key or buyer token out of Firestore", async () => {
    const result = await read(seededDb());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("portal_secret_key_value");
    expect(serialized).not.toContain("buyer_token_value");
    expect(serialized).not.toContain("whsec_must_never_be_exported");
  });

  it("keeps a secret out even when it sits beside an allowlisted field", async () => {
    const result = await read(
      seededDb({ extraQuoteFields: { internalNotes: "do not export", apiKey: "sk_live_x" } })
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("do not export");
    expect(serialized).not.toContain("sk_live_x");
  });

  it("prunes nested payment fields to the ones the exporter needs", async () => {
    const db = seededDb();
    db._store[`organizations/${ORG}/quotes/${QUOTE}`].payment.internalReconciliationNote =
      "nested secret";
    const result = await read(db);
    expect(JSON.stringify(result)).not.toContain("nested secret");
    // ...while keeping the ledger the payment rules depend on.
    expect(result.records[0].quote.payment.ledger.entries).toHaveLength(1);
  });

  it("keeps the allowlist and the exporter's needs in sync", async () => {
    const result = await read(seededDb());
    const quote = result.records[0].quote;
    for (const field of ["status", "activeVersionId", "pricingCatalogAuthority", "event"]) {
      expect(quote[field], field).toBeDefined();
    }
    expect(QUOTE_FIELDS).not.toContain("portalKey");
    expect(QUOTE_FIELDS).not.toContain("buyerAccess");
  });
});

describe("evidence reader: assembly", () => {
  it("assembles all five source documents for a quote", async () => {
    const record = (await read(seededDb())).records[0];
    expect(record.quoteId).toBe(QUOTE);
    expect(record.acceptanceReceipt.proposalSnapshot.totalsMinor.total).toBe(2259200);
    expect(record.quoteVersion.commercialSnapshot.version).toBe("commercial-snapshot-v1");
    expect(record.organizationSettings.catalogRevision).toBe(12);
    // No open change request in this fixture.
    expect(record.changeRequestRecord).toBeNull();
  });

  it("reads the newest change-request resolution when a request is open", async () => {
    const db = seededDb();
    db._store[`organizations/${ORG}/quotes/${QUOTE}`].portalDecision = {
      decision: "changes_requested",
      requestId: "req_9",
      submittedAtISO: "2026-08-19T10:00:00.000Z",
      message: "more guests"
    };
    db._store[`organizations/${ORG}/quotes/${QUOTE}/changeRequestResolutions/older`] = {
      resolutionId: "older",
      recordedAtISO: "2026-08-18T10:00:00.000Z",
      proposals: [],
      stagedProposalIds: []
    };
    db._store[`organizations/${ORG}/quotes/${QUOTE}/changeRequestResolutions/newer`] = {
      resolutionId: "newer",
      recordedAtISO: "2026-08-20T10:00:00.000Z",
      proposals: [{ id: "p1", kind: "set_guests", value: 160 }],
      stagedProposalIds: ["p1"]
    };
    const record = (await read(db)).records[0];
    expect(record.changeRequestRecord.resolutionId).toBe("newer");
  });

  it("tolerates a quote whose acceptance receipt document is absent", async () => {
    const db = seededDb();
    delete db._store[`organizations/${ORG}/proposalAcceptanceReceipts/${IDS.RECEIPT_ID}`];
    const record = (await read(db)).records[0];
    // Left for the exporter to classify rather than papered over here.
    expect(record.acceptanceReceipt).toBeNull();
  });

  it("restricts to named quotes when asked", async () => {
    const db = seededDb();
    db._store[`organizations/${ORG}/quotes/other_quote`] = { organizationId: ORG, quoteNumber: "B" };
    expect((await read(db)).records).toHaveLength(2);
    expect((await read(db, { quoteIds: [QUOTE] })).records).toHaveLength(1);
  });

  it("returns records in a stable order regardless of store order", async () => {
    const db = seededDb();
    db._store[`organizations/${ORG}/quotes/aaa_quote`] = { organizationId: ORG, quoteNumber: "B" };
    const ids = (await read(db)).records.map((record) => record.quoteId);
    expect(ids).toEqual([...ids].sort());
  });

  it("decides event completion from the supplied instant, never a clock", async () => {
    const past = await read(seededDb(), { eventCompleted: eventCompletedBefore("2027-01-01") });
    expect(past.records[0].eventCompleted).toBe(true);
    const future = await read(seededDb(), { eventCompleted: eventCompletedBefore("2026-01-01") });
    expect(future.records[0].eventCompleted).toBe(false);
  });

  it("stamps its version for provenance", async () => {
    expect((await read(seededDb())).readerVersion).toBe(READER_VERSION);
  });
});

describe("evidence reader: end to end into the reconciler bundle", () => {
  it("produces a bundle the exporter accepts, with real evidence available", async () => {
    const result = await read(seededDb());
    const producers = producerRegistry([
      guarded(createPayoutProducer(), { missing }),
      guarded(
        createFeeScheduleProducer({
          readOrganizationSettings: (id) => result.organizationSettings[id] || null
        }),
        { missing }
      ),
      guarded(createConsumptionProducer({ readConsumption: () => null }), { missing })
    ]);
    const bundle = exportBundle(
      result.records.map((record) => ({
        ...record,
        organizationSettings: result.organizationSettings[ORG] || null
      })),
      { evaluatedAtISO: EVALUATED_AT, producers }
    );

    expect(bundle.bundleVersion).toBe("truthloop-evidence-bundle-v2");
    const evidence = bundle.records[0].evidence;
    // The six sections a real record can supply today.
    expect(evidence.acceptedSnapshot.availability).toBe(AVAILABILITY.AVAILABLE);
    expect(evidence.payments.availability).toBe(AVAILABILITY.AVAILABLE);
    expect(evidence.authorizedQuote.availability).toBe(AVAILABILITY.AVAILABLE);
    expect(evidence.operationalPlan.availability).toBe(AVAILABILITY.AVAILABLE);
    expect(evidence.costBasis.availability).toBe(AVAILABILITY.AVAILABLE);
    // And the three that structurally cannot.
    expect(evidence.payouts.availability).toBe(AVAILABILITY.BLOCKED_BY_INTEGRATION);
    expect(evidence.processorFeeSchedule.availability).toBe(AVAILABILITY.MISSING);
    expect(evidence.actualConsumption.availability).toBe(AVAILABILITY.NOT_YET_AVAILABLE);
  });

  it("stamps provenance at the real Firestore paths", async () => {
    const result = await read(seededDb());
    const bundle = exportBundle(
      result.records.map((record) => ({
        ...record,
        organizationSettings: result.organizationSettings[ORG] || null
      })),
      { evaluatedAtISO: EVALUATED_AT, producers: producerRegistry([]) }
    );
    const evidence = bundle.records[0].evidence;
    expect(evidence.acceptedSnapshot.provenance.sourceObject).toBe(
      `organizations/${ORG}/proposalAcceptanceReceipts/${IDS.RECEIPT_ID}`
    );
    expect(evidence.payments.provenance.sourceObject).toBe(
      `organizations/${ORG}/quotes/${QUOTE}`
    );
  });

  it("carries no secret from Firestore into the finished bundle", async () => {
    const result = await read(seededDb());
    const bundle = exportBundle(
      result.records.map((record) => ({
        ...record,
        organizationSettings: result.organizationSettings[ORG] || null
      })),
      { evaluatedAtISO: EVALUATED_AT, producers: producerRegistry([]) }
    );
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("portal_secret_key_value");
    expect(serialized).not.toContain("buyer_token_value");
    expect(serialized).not.toContain("whsec_must_never_be_exported");
  });
});
