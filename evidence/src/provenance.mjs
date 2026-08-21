// Provenance stamping.
//
// A finding that says "this payment is wrong" is only actionable if the
// operator can see which document, which field, which revision, and which
// point in time it came from. Provenance is therefore mandatory on every
// envelope, including envelopes with no value.

export const EXPORTER_VERSION = "commercial-evidence-exporter-v1";

/**
 * @param {object} input
 * @param {string} input.sourceObject   Firestore path, e.g. "quotes/q_1".
 * @param {string} input.sourceField    Dotted field path within that document.
 * @param {string} input.revision       Revision/version the value belongs to.
 * @param {string|number} input.sourceSchemaVersion Declared schema of the source.
 * @param {string} input.observedAtISO  When the source last changed, per the source.
 * @param {object} input.fields         Per-field overrides for values read elsewhere.
 */
export function provenance({
  sourceObject = "",
  sourceField = "",
  revision = "",
  sourceSchemaVersion = "",
  observedAtISO = "",
  fields = null
} = {}) {
  const stamped = {
    exporterVersion: EXPORTER_VERSION,
    sourceObject,
    sourceField,
    revision,
    sourceSchemaVersion: sourceSchemaVersion === "" ? "" : String(sourceSchemaVersion),
    observedAtISO
  };
  // Field overrides exist because a section is rarely one document. The
  // accepted snapshot lives on the receipt while the quote holds the digest;
  // a legacy deposit is derived rather than read. Recording that at field
  // level keeps the section-level stamp honest.
  if (fields && Object.keys(fields).length) {
    stamped.fields = Object.fromEntries(
      Object.entries(fields).map(([key, override]) => [
        key,
        {
          sourceObject: override.sourceObject ?? sourceObject,
          sourceField: override.sourceField ?? sourceField,
          revision: override.revision ?? revision,
          derivation: override.derivation ?? "",
          detail: override.detail ?? ""
        }
      ])
    );
  }
  return stamped;
}

export function quotePath(organizationId, quoteId) {
  return `organizations/${organizationId}/quotes/${quoteId}`;
}

export function receiptPath(organizationId, receiptId) {
  return `organizations/${organizationId}/acceptanceReceipts/${receiptId}`;
}

export function organizationPath(organizationId) {
  return `organizations/${organizationId}`;
}

export function quoteVersionPath(organizationId, quoteId, versionId) {
  return `organizations/${organizationId}/quotes/${quoteId}/versions/${versionId}`;
}
