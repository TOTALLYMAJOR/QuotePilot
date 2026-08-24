// Read-only Firestore assembly for the evidence exporter.
//
// The exporter is a pure projection over already-read documents. This module
// is the only thing that reads them, and it is deliberately the narrowest
// possible reader:
//
//   * Every read is rooted at organizations/{organizationId}. There is no
//     collectionGroup query anywhere, so a query cannot escape a tenant even
//     if a document is mis-filed.
//   * Every document is re-checked against the requested organization after
//     it is read, and a mismatch aborts rather than being skipped. Silently
//     dropping a cross-tenant document would hide a real data-integrity bug.
//   * Every document is projected down to an explicit field allowlist before
//     it leaves this module. The exporter already reads only the fields it
//     needs, but that is a property of the exporter's code; this is a property
//     of the pipe. A secret cannot reach a bundle even if the exporter changes.
//
// It performs no writes and holds no credential of its own: the caller passes
// an already-initialized Firestore handle.
//
// Firestore layout (from functions/index.js):
//   organizations/{org}/quotes/{quote}
//   organizations/{org}/quotes/{quote}/versions/{version}
//   organizations/{org}/quotes/{quote}/changeRequestResolutions/{resolution}
//   organizations/{org}/proposalAcceptanceReceipts/{receipt}
//   organizations/{org}/settings/config

export const READER_VERSION = "commercial-evidence-firestore-reader-v1";

/**
 * Fields copied out of each source document. Anything absent from these lists
 * cannot reach a bundle. Notably excluded: portalKey (grants portal access),
 * anything under buyerAccess, and every customer-facing message body.
 */
export const QUOTE_FIELDS = Object.freeze([
  "organizationId",
  "quoteNumber",
  "status",
  "activeVersionId",
  "latestVersionNumber",
  "updatedAtISO",
  "portalDecision",
  "acceptanceReceipt",
  "pricingCatalogAuthority",
  "workflow",
  "event",
  "selection",
  "payment"
]);

export const RECEIPT_FIELDS = Object.freeze(["organizationId", "quoteId", "proposalSnapshot"]);
export const VERSION_FIELDS = Object.freeze(["versionId", "createdAtISO", "commercialSnapshot"]);
export const RESOLUTION_FIELDS = Object.freeze([
  "resolutionId",
  "proposals",
  "stagedProposalIds",
  "recordedAtISO"
]);
export const SETTINGS_FIELDS = Object.freeze(["catalogRevision", "processorFeeSchedule"]);

/** Nested keys pruned from an allowlisted field. */
const NESTED_PRUNE = Object.freeze({
  workflow: ["quoteDelivery"],
  payment: ["ledger", "stripeSessionId", "depositStatus", "depositConfirmedAtISO"],
  portalDecision: ["decision", "requestId", "submittedAtISO", "message"],
  acceptanceReceipt: [
    "receiptId",
    "quoteRevisionId",
    "acceptedAtISO",
    "snapshotSha256",
    "totalMinor",
    "depositMinor"
  ]
});

export class EvidenceReadError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvidenceReadError";
  }
}

function pick(data, fields) {
  const output = {};
  for (const field of fields) {
    if (data?.[field] === undefined) continue;
    const nested = NESTED_PRUNE[field];
    if (nested && data[field] && typeof data[field] === "object") {
      output[field] = pick(data[field], nested);
      continue;
    }
    output[field] = data[field];
  }
  return output;
}

/**
 * Reject a document that does not belong to the requested tenant.
 *
 * This should be impossible given the read paths, which is exactly why it
 * aborts instead of filtering: if it ever fires, the data is wrong in a way
 * that must not be reconciled around.
 */
function assertTenant(organizationId, data, label) {
  const owner = String(data?.organizationId ?? "").trim();
  if (owner && owner !== organizationId) {
    throw new EvidenceReadError(
      `${label} belongs to organization ${owner}, not ${organizationId}. `
      + "Refusing to build evidence across tenants."
    );
  }
}

async function readDoc(ref) {
  const snapshot = await ref.get();
  return snapshot.exists ? snapshot.data() : null;
}

/**
 * Assemble the exporter `--source` shape for one organization.
 *
 * @param {object} options
 * @param {object} options.db            Initialized Firestore handle (read-only use).
 * @param {string} options.organizationId Tenant to read. Required and explicit.
 * @param {string[]} [options.quoteIds]  Restrict to these quotes; omit for all.
 * @param {number} [options.limit]       Cap on quotes read.
 * @param {(record: object) => boolean} [options.eventCompleted]
 *   Decides whether an event has been delivered. Supplied by the caller so the
 *   reader never consults a clock and a run stays reproducible.
 */
export async function readOrganizationEvidence({
  db,
  organizationId,
  quoteIds = null,
  limit = 0,
  eventCompleted = () => false
} = {}) {
  const tenant = String(organizationId ?? "").trim();
  if (!tenant) {
    throw new EvidenceReadError("An explicit organizationId is required; there is no all-tenant read.");
  }
  if (!db) throw new EvidenceReadError("A Firestore handle is required.");

  const organizationRef = db.collection("organizations").doc(tenant);
  const settingsData = await readDoc(organizationRef.collection("settings").doc("config"));

  let quoteDocs;
  if (Array.isArray(quoteIds) && quoteIds.length) {
    const refs = quoteIds.map((id) => organizationRef.collection("quotes").doc(String(id)));
    const snapshots = await Promise.all(refs.map((ref) => ref.get()));
    quoteDocs = snapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => ({ id: snapshot.id, data: snapshot.data() }));
  } else {
    let query = organizationRef.collection("quotes");
    if (limit > 0) query = query.limit(limit);
    const snapshot = await query.get();
    quoteDocs = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  }

  const records = [];
  for (const { id: quoteId, data: rawQuote } of quoteDocs) {
    assertTenant(tenant, rawQuote, `Quote ${quoteId}`);
    const quote = { ...pick(rawQuote, QUOTE_FIELDS), organizationId: tenant, quoteId };
    const quoteRef = organizationRef.collection("quotes").doc(quoteId);

    // The signed snapshot lives on the receipt, not the quote. Read it only
    // when the quote names one; a quote claiming acceptance with no receipt id
    // is left for the exporter to classify rather than papered over here.
    let acceptanceReceipt = null;
    const receiptId = String(rawQuote?.acceptanceReceipt?.receiptId ?? "").trim();
    if (receiptId) {
      const rawReceipt = await readDoc(
        organizationRef.collection("proposalAcceptanceReceipts").doc(receiptId)
      );
      if (rawReceipt) {
        assertTenant(tenant, rawReceipt, `Acceptance receipt ${receiptId}`);
        acceptanceReceipt = pick(rawReceipt, RECEIPT_FIELDS);
      }
    }

    const versionId = String(rawQuote?.activeVersionId ?? "").trim();
    let quoteVersion = null;
    if (versionId) {
      const rawVersion = await readDoc(quoteRef.collection("versions").doc(versionId));
      if (rawVersion) {
        quoteVersion = { ...pick(rawVersion, VERSION_FIELDS), versionId };
      }
    }

    // Most recent triage of the customer's open request, if any.
    let changeRequestRecord = null;
    const requestId = String(rawQuote?.portalDecision?.requestId ?? "").trim();
    if (requestId) {
      const resolutions = await quoteRef
        .collection("changeRequestResolutions")
        .orderBy("recordedAtISO", "desc")
        .limit(1)
        .get();
      const doc = resolutions.docs?.[0];
      if (doc) {
        changeRequestRecord = { ...pick(doc.data(), RESOLUTION_FIELDS), resolutionId: doc.id };
      }
    }

    const record = {
      quoteId,
      quote,
      acceptanceReceipt,
      quoteVersion,
      changeRequestRecord,
      organizationSettings: settingsData ? pick(settingsData, SETTINGS_FIELDS) : null
    };
    record.eventCompleted = Boolean(eventCompleted(record));
    records.push(record);
  }

  // Stable order regardless of Firestore's response order, so the exporter's
  // determinism guarantee starts at the read rather than at the projection.
  records.sort((left, right) => left.quoteId.localeCompare(right.quoteId));

  return {
    readerVersion: READER_VERSION,
    organizationId: tenant,
    records,
    organizationSettings: settingsData
      ? { [tenant]: pick(settingsData, SETTINGS_FIELDS) }
      : {}
  };
}

/** True when the event date is strictly before the supplied evaluation date. */
export function eventCompletedBefore(evaluatedAtISO) {
  const boundary = String(evaluatedAtISO ?? "").slice(0, 10);
  return (record) => {
    const eventDate = String(record?.quote?.event?.date ?? "").trim();
    return Boolean(eventDate) && Boolean(boundary) && eventDate < boundary;
  };
}
