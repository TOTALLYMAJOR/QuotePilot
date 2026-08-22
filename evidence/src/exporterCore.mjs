// Pure projection: Firestore document shapes -> canonical evidence bundle.
//
// No I/O. The caller supplies already-read documents; this module decides what
// each one proves, stamps provenance, and classifies availability. Keeping it
// pure is what makes the exporter testable against the real writer modules and
// what makes two runs over the same source state byte-identical.
//
// Source shapes it reads, and the module that writes each:
//   quote.portalDecision            functions/changeRequestRecord.js
//   quote.pricingCatalogAuthority   functions/pricingEngine.js
//   quote.acceptanceReceipt         functions/proposalAcceptance.js
//   receipt.proposalSnapshot        functions/proposalAcceptance.js
//   quote.payment.ledger            functions/paymentLedger.js
//   quote.selection|event|booking   src/lib/beoPayload.js
//   version.commercialSnapshot      src/lib/commercialSnapshot.js

import { createHash } from "node:crypto";

import {
  AVAILABILITY,
  available,
  blockedByIntegration,
  contradictory,
  missing,
  notApplicable,
  notYetAvailable,
  schemaDrift
} from "./availability.mjs";
import { canonicalize, digestSha256 } from "./canonical.mjs";
import {
  EXPORTER_VERSION,
  organizationPath,
  provenance,
  quotePath,
  quoteVersionPath,
  receiptPath
} from "./provenance.mjs";
import { checkSourceSchema, driftDetail, evidenceContract } from "./schemaDrift.mjs";
import { producerRegistry } from "./producers/index.mjs";

export const BUNDLE_VERSION = "truthloop-evidence-bundle-v2";

const PAYMENT_LEDGER_VERSION = 1;
const PROPOSAL_SNAPSHOT_VERSION = 2;

function text(value) {
  return String(value ?? "").trim();
}

function integer(value, fallback = 0) {
  return Number.isSafeInteger(value) ? value : fallback;
}

function names(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => text(item?.name ?? item))
    .filter(Boolean);
}

/**
 * Normalize a timestamp to canonical UTC, or return "" when unparseable.
 * The reconciler compares instants; the exporter must not hand it ambiguity.
 */
function utc(value) {
  const normalized = text(value);
  if (!normalized) return "";
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z");
}

// -- sections ---------------------------------------------------------------

function exportCustomerRequest(context) {
  const { quote } = context.source;
  const decision = quote?.portalDecision;
  const base = provenance({
    sourceObject: context.paths.quote,
    sourceField: "portalDecision",
    revision: text(quote?.activeVersionId),
    observedAtISO: utc(quote?.updatedAtISO)
  });

  if (!decision || !text(decision.requestId)) {
    return notApplicable(base, "The customer has not submitted a portal decision.");
  }
  const submittedAtISO = utc(decision.submittedAtISO);
  if (!submittedAtISO) {
    return missing(base, "The portal decision carries no valid submission timestamp.");
  }

  // A structured change record proves which parsed proposals were staged. Its
  // absence is not a data error; it means nobody has triaged the request yet,
  // which is precisely what the freshness rule should see.
  const record = context.source.changeRequestRecord || null;
  const message = text(decision.message);

  return available(
    {
      requestId: text(decision.requestId),
      decision: text(decision.decision),
      submittedAtISO,
      messageSha256: message
        ? createHash("sha256").update(message, "utf8").digest("hex")
        : "",
      proposals: Array.isArray(record?.proposals) ? canonicalize(record.proposals) : [],
      recordedProposalIds: Array.isArray(record?.stagedProposalIds)
        ? [...record.stagedProposalIds].map(text).filter(Boolean).sort()
        : []
    },
    provenance({
      ...base,
      fields: {
        proposals: {
          sourceObject: record ? context.paths.changeRequestRecord : "",
          sourceField: "proposals",
          derivation: record ? "structured change record" : "absent: request not triaged"
        },
        messageSha256: {
          sourceField: "portalDecision.message",
          derivation: "sha256 of the stored customer message"
        }
      }
    }),
    `Portal decision ${text(decision.decision)}.`
  );
}

function exportAuthorizedQuote(context) {
  const { quote } = context.source;
  const authority = quote?.pricingCatalogAuthority;
  const base = provenance({
    sourceObject: context.paths.quote,
    sourceField: "pricingCatalogAuthority",
    revision: text(quote?.activeVersionId),
    sourceSchemaVersion: authority?.schemaVersion ?? "",
    observedAtISO: utc(quote?.updatedAtISO)
  });

  if (!authority) {
    return missing(
      base,
      "The quote carries no pricing catalog authority, so the revision it was "
      + "priced against cannot be established."
    );
  }
  const check = checkSourceSchema("pricingCatalogAuthority", authority.schemaVersion);
  if (!check.known) {
    return schemaDrift(base, driftDetail("pricingCatalogAuthority", check));
  }

  return available(
    {
      revisionId: text(quote?.workflow?.quoteDelivery?.revisionId) || text(quote?.activeVersionId),
      activeVersionId: text(quote?.activeVersionId),
      latestVersionNumber: integer(quote?.latestVersionNumber),
      authorizedAtISO: utc(quote?.updatedAtISO),
      catalogAuthority: {
        catalogRevision: integer(authority.catalogRevision, -1),
        confirmedCatalogRevision: integer(authority.confirmedCatalogRevision, -1),
        settingsFingerprintSha256: text(authority.settingsFingerprintSha256),
        catalogSource: text(authority.catalogSource)
      }
    },
    base,
    `Priced on catalog revision ${integer(authority.catalogRevision, -1)}.`
  );
}

function exportAcceptedSnapshot(context) {
  const { quote, acceptanceReceipt } = context.source;
  const receipt = quote?.acceptanceReceipt;
  const base = provenance({
    sourceObject: context.paths.receipt,
    sourceField: "proposalSnapshot",
    revision: text(receipt?.quoteRevisionId),
    sourceSchemaVersion: acceptanceReceipt?.proposalSnapshot?.schemaVersion ?? "",
    observedAtISO: utc(receipt?.acceptedAtISO)
  });

  const quoteProvenance = provenance({
    ...base,
    sourceObject: context.paths.quote,
    sourceField: "acceptanceReceipt"
  });

  if (text(quote?.status).toLowerCase() !== "accepted") {
    // Not "not yet available": before acceptance there is no promise, so the
    // commercial chain has not started and there is nothing to reconcile. The
    // run metrics segment these records so they cannot flatter the rate.
    return notApplicable(
      quoteProvenance,
      "The quote has not been accepted, so there is no signed promise to reconcile."
    );
  }
  if (!receipt) {
    // Accepted with no receipt stub is a different fact from not accepted: the
    // promise exists and its evidence is gone. Reporting it as "nothing to
    // reconcile" would let a broken record read as a clean one.
    return missing(
      quoteProvenance,
      "The quote is accepted but carries no acceptance receipt stub, so the "
      + "signed promise cannot be located."
    );
  }

  const snapshot = acceptanceReceipt?.proposalSnapshot;
  if (!snapshot) {
    // The quote says accepted but the receipt document is absent or partial.
    // This is the partially-written-record case and must never be smoothed
    // over: the quote's own totals are not the signed promise.
    return missing(
      base,
      "The quote is accepted but its acceptance receipt document carries no "
      + "proposal snapshot. The signed promise cannot be read from the quote alone."
    );
  }

  const check = checkSourceSchema("proposalSnapshot", snapshot.schemaVersion);
  if (!check.known) {
    return schemaDrift(base, driftDetail("proposalSnapshot", check));
  }

  // The quote holds a digest of the snapshot the customer signed. If the
  // receipt no longer hashes to it, two authoritative sources disagree about
  // what was promised, and that is a finding rather than a tie to break.
  const recomputed = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  const storedDigest = text(receipt.snapshotSha256);
  if (storedDigest && storedDigest !== recomputed) {
    return contradictory(
      base,
      {
        quoteSnapshotSha256: storedDigest,
        receiptSnapshotSha256: recomputed,
        quoteTotalMinor: integer(receipt.totalMinor, -1),
        receiptTotalMinor: integer(snapshot?.totalsMinor?.total, -1)
      },
      "The acceptance receipt no longer hashes to the digest recorded on the "
      + "quote. The signed snapshot and the quote disagree."
    );
  }

  const totalsMinor = snapshot.totalsMinor || {};
  if (
    storedDigest
    && integer(receipt.totalMinor, -1) !== integer(totalsMinor.total, -2)
  ) {
    return contradictory(
      base,
      {
        quoteTotalMinor: integer(receipt.totalMinor, -1),
        receiptTotalMinor: integer(totalsMinor.total, -2)
      },
      "The quote's recorded accepted total differs from the signed snapshot total."
    );
  }

  return available(
    {
      revisionId: text(snapshot.revisionId),
      acceptedAtISO: utc(receipt.acceptedAtISO),
      totalsMinor: canonicalize(totalsMinor),
      guests: integer(snapshot?.event?.guests),
      hours: integer(snapshot?.event?.hours),
      style: text(snapshot?.event?.style),
      selection: {
        menuItems: names(snapshot?.selection?.menuItems),
        addons: names(snapshot?.selection?.addons),
        rentals: names(snapshot?.selection?.rentals)
      },
      staffing: {
        servers: integer(quote?.event?.servers),
        chefs: integer(quote?.event?.chefs),
        bartenders: integer(quote?.event?.bartenders)
      }
    },
    provenance({
      ...base,
      fields: {
        staffing: {
          sourceObject: context.paths.quote,
          sourceField: "event.servers|chefs|bartenders",
          derivation:
            "staffing is not carried on the signed snapshot; read from the quote "
            + "at the accepted revision"
        },
        acceptedAtISO: {
          sourceObject: context.paths.quote,
          sourceField: "acceptanceReceipt.acceptedAtISO"
        }
      }
    }),
    `Accepted revision ${text(snapshot.revisionId)}.`
  );
}

function exportPayments(context) {
  const { quote } = context.source;
  const ledger = quote?.payment?.ledger;
  const base = provenance({
    sourceObject: context.paths.quote,
    sourceField: "payment.ledger",
    revision: text(quote?.activeVersionId),
    sourceSchemaVersion: ledger?.version ?? "",
    observedAtISO: utc(quote?.updatedAtISO)
  });

  if (ledger) {
    const check = checkSourceSchema("paymentLedger", ledger.version);
    if (!check.known) {
      return schemaDrift(base, driftDetail("paymentLedger", check));
    }
    if (!Array.isArray(ledger.entries)) {
      return missing(base, "The stored payment ledger carries no entries array.");
    }
    return available(
      ledger.entries.map((entry) => ({
        operationId: text(entry.operationId),
        paymentKind: text(entry.paymentKind),
        amountCents: integer(entry.amountCents, -1),
        state: text(entry.state).toLowerCase(),
        providerReference: text(entry.providerReference),
        providerSettledAtISO: utc(entry.providerSettledAtISO)
      })),
      base,
      `${ledger.entries.length} ledger operation(s).`
    );
  }

  // Legacy quotes predate the ledger and carry a confirmed deposit on the
  // payment record. functions/finalBalancePayment.js derives an entry from it,
  // and so do we -- but provenance says derived, not read, so nobody mistakes
  // this for ledger evidence.
  const legacy = quote?.payment;
  const sessionId = text(legacy?.stripeSessionId);
  const confirmedAtISO = utc(legacy?.depositConfirmedAtISO);
  if (text(legacy?.depositStatus).toLowerCase() === "paid" && sessionId && confirmedAtISO) {
    return available(
      [
        {
          operationId: `legacy-deposit:${sessionId}`,
          paymentKind: "deposit",
          amountCents: integer(context.acceptedDepositCents, -1),
          state: "paid",
          providerReference: sessionId,
          providerSettledAtISO: confirmedAtISO
        }
      ],
      provenance({
        ...base,
        sourceField: "payment.stripeSessionId|depositConfirmedAtISO",
        fields: {
          operationId: {
            derivation: "synthesized legacy deposit id; no ledger operation exists"
          },
          amountCents: {
            sourceObject: context.paths.receipt,
            sourceField: "proposalSnapshot.totalsMinor.deposit",
            derivation: "legacy record stores no amount; taken from the accepted snapshot"
          }
        }
      }),
      "Derived from a legacy confirmed deposit."
    );
  }

  if (text(quote?.status).toLowerCase() !== "accepted") {
    return notApplicable(base, "The quote is not accepted, so no payment is due.");
  }
  return available([], base, "No payment operations recorded.");
}

function exportOperationalPlan(context) {
  const { quote } = context.source;
  const base = provenance({
    sourceObject: context.paths.quote,
    sourceField: "selection|event|booking",
    revision: text(quote?.activeVersionId),
    observedAtISO: utc(quote?.updatedAtISO)
  });

  if (text(quote?.status).toLowerCase() !== "accepted") {
    return notApplicable(base, "No operational plan exists before acceptance.");
  }
  if (!quote?.selection && !quote?.event) {
    return missing(base, "The accepted quote carries no selection or event data to plan from.");
  }

  return available(
    {
      sourceRevisionId: text(quote?.workflow?.quoteDelivery?.revisionId)
        || text(quote?.activeVersionId),
      guests: integer(quote?.event?.guests),
      selections: {
        menuItemNames: names(quote?.selection?.menuItemNames),
        addons: names(quote?.selection?.addons ?? quote?.selection?.addonSnapshots),
        rentals: names(quote?.selection?.rentals ?? quote?.selection?.rentalSnapshots)
      },
      staffing: {
        servers: integer(quote?.event?.servers),
        chefs: integer(quote?.event?.chefs),
        bartenders: integer(quote?.event?.bartenders)
      }
    },
    base,
    "Projected the same way the BEO payload projects the plan."
  );
}

function exportCostBasis(context) {
  const { quoteVersion } = context.source;
  const snapshot = quoteVersion?.commercialSnapshot;
  const base = provenance({
    sourceObject: context.paths.quoteVersion,
    sourceField: "commercialSnapshot",
    revision: text(quoteVersion?.versionId),
    sourceSchemaVersion: snapshot?.version ?? "",
    observedAtISO: utc(quoteVersion?.createdAtISO)
  });

  if (!snapshot) {
    return missing(
      base,
      "No commercial cost snapshot was captured with this quote version, so "
      + "contribution has no recorded basis."
    );
  }
  const check = checkSourceSchema("commercialSnapshot", snapshot.version);
  if (!check.known) {
    return schemaDrift(base, driftDetail("commercialSnapshot", check));
  }

  const planned = {};
  const missingCategories = [];
  const provisionalCategories = [];

  for (const [category, entry] of Object.entries(snapshot.categories || {})) {
    if (entry?.extendedCostCents === null || entry?.extendedCostCents === undefined) {
      missingCategories.push(category);
      continue;
    }
    if (!Number.isSafeInteger(entry.extendedCostCents)) {
      missingCategories.push(category);
      continue;
    }
    planned[category] = entry.extendedCostCents;
    if (entry.provisional === true) provisionalCategories.push(category);
  }

  return available(
    {
      plannedCostCents: canonicalize(planned),
      missingCostCategories: missingCategories.sort(),
      provisionalCostCategories: provisionalCategories.sort(),
      targetMarginBasisPoints: Number.isSafeInteger(snapshot.targetMarginBasisPoints)
        ? snapshot.targetMarginBasisPoints
        : -1
    },
    base,
    `${Object.keys(planned).length} costed categor(ies).`
  );
}

// -- record -----------------------------------------------------------------

const SECTION_EXPORTERS = Object.freeze({
  customerRequest: exportCustomerRequest,
  authorizedQuote: exportAuthorizedQuote,
  acceptedSnapshot: exportAcceptedSnapshot,
  payments: exportPayments,
  operationalPlan: exportOperationalPlan,
  costBasis: exportCostBasis
});

/** Sections supplied by a producer rather than projected from the quote. */
const PRODUCER_SECTIONS = Object.freeze(["payouts", "processorFeeSchedule", "actualConsumption"]);

function buildContext(source, { evaluatedAtISO }) {
  const organizationId = text(source.quote?.organizationId);
  const quoteId = text(source.quoteId ?? source.quote?.quoteId);
  const receiptId = text(source.quote?.acceptanceReceipt?.receiptId);
  const versionId = text(source.quoteVersion?.versionId ?? source.quote?.activeVersionId);
  const paths = {
    quote: quotePath(organizationId, quoteId),
    receipt: receiptId ? receiptPath(organizationId, receiptId) : "",
    organization: organizationPath(organizationId),
    quoteVersion: versionId ? quoteVersionPath(organizationId, quoteId, versionId) : "",
    changeRequestRecord: source.changeRequestRecord
      ? `${quotePath(organizationId, quoteId)}/changeRequestRecords/${text(source.changeRequestRecord.resolutionId)}`
      : ""
  };

  const context = {
    source,
    paths,
    evaluatedAtISO,
    acceptedDepositCents: integer(
      source.acceptanceReceipt?.proposalSnapshot?.totalsMinor?.deposit,
      -1
    ),
    record: {
      organizationId,
      quoteId,
      quoteNumber: text(source.quote?.quoteNumber),
      eventDate: text(source.quote?.event?.date),
      eventCompleted: source.eventCompleted === true
    },
    provenanceFor(section, overrides = {}) {
      const declared = evidenceContract().evidenceSections[section] || {};
      return provenance({
        sourceObject: overrides.sourceObject ?? "",
        sourceField: overrides.sourceField ?? declared.sourceField ?? "",
        revision: overrides.revision ?? "",
        observedAtISO: overrides.observedAtISO ?? "",
        fields: overrides.derivation
          ? { [section]: { derivation: overrides.derivation } }
          : null
      });
    }
  };
  return context;
}

/**
 * Project one already-read set of Firestore documents into a bundle record.
 *
 * @param {object} source
 * @param {object} source.quote               The quote document.
 * @param {object} [source.acceptanceReceipt] The acceptance receipt document.
 * @param {object} [source.quoteVersion]      The active quote version document.
 * @param {object} [source.changeRequestRecord] The structured change record.
 * @param {object} [source.organizationSettings] Organization settings.
 * @param {boolean} [source.eventCompleted]   Whether the event has been delivered.
 * @param {object} options
 * @param {string} options.evaluatedAtISO     The run instant, supplied not read.
 * @param {object} options.producers          Producer registry.
 */
export function exportRecord(source, { evaluatedAtISO, producers }) {
  const context = buildContext(source, { evaluatedAtISO });
  const evidence = {};

  for (const [section, exporter] of Object.entries(SECTION_EXPORTERS)) {
    evidence[section] = exporter(context);
  }

  // The accepted deposit is needed to derive a legacy payment amount, so the
  // payment section is re-run once the accepted snapshot is known.
  if (
    evidence.acceptedSnapshot.availability === AVAILABILITY.AVAILABLE
    && context.acceptedDepositCents < 0
  ) {
    context.acceptedDepositCents = integer(
      evidence.acceptedSnapshot.value.totalsMinor?.deposit,
      -1
    );
    evidence.payments = exportPayments(context);
  }

  for (const section of PRODUCER_SECTIONS) {
    const producer = producers.get(section);
    evidence[section] = producer
      ? producer.produce(context)
      : missing(
          context.provenanceFor(section),
          `No producer is registered for ${section}.`,
          "engineering"
        );
  }

  return canonicalize({
    ...context.record,
    currentCatalogRevision: integer(source.organizationSettings?.catalogRevision, -1),
    evidence
  });
}

/**
 * Export a whole bundle.
 *
 * Records are sorted by organization and quote id so the output is stable
 * regardless of read order, and the digest is taken over the canonical records
 * so an identical source state produces an identical file.
 */
export function exportBundle(sources, { evaluatedAtISO, producers } = {}) {
  if (!evaluatedAtISO) {
    throw new Error("exportBundle requires an explicit evaluatedAtISO.");
  }
  const registry = producers ?? producerRegistry([]);
  const records = sources
    .map((source) => exportRecord(source, { evaluatedAtISO, producers: registry }))
    .sort((left, right) =>
      `${left.organizationId}/${left.quoteId}`.localeCompare(
        `${right.organizationId}/${right.quoteId}`
      )
    );

  const contract = evidenceContract();
  return canonicalize({
    bundleVersion: BUNDLE_VERSION,
    evaluatedAtISO,
    exporter: {
      exporterVersion: EXPORTER_VERSION,
      contractVersion: contract.contractVersion,
      knownSourceSchemaVersions: contract.knownSourceSchemaVersions,
      producers: registry.list().map((producer) => ({
        section: producer.section,
        producerId: producer.producerId
      })),
      recordsDigestSha256: digestSha256(records)
    },
    records
  });
}

export { PAYMENT_LEDGER_VERSION, PROPOSAL_SNAPSHOT_VERSION };
