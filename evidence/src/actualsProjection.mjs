// Pure, read-only validation followed by an allowlisted evidence projection.
// Private writer records are transient inputs. The in-memory brand is neither
// serialized nor accepted from JSON; only this validator can create it.
import { createRequire } from "node:module";
import { available, contradictory, missing, notYetAvailable, schemaDrift } from "./availability.mjs";
import { provenance } from "./provenance.mjs";
import { canonicalJson, digestSha256 } from "./canonical.mjs";

const require = createRequire(import.meta.url);
const phase = require("../../functions/eventOperations.js");
const actuals = require("../../functions/eventOperatingActuals.js");
const verified = new WeakSet();
const identityKeys = ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"];
const categories = ["labor", "purchasing", "other"];
const receiptPattern = /^event_actuals_command_[a-f0-9]{48}$/;
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const identity = (value) => Object.fromEntries(identityKeys.map((key) => [key, value?.[key]]));
const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const requireEvidence = (condition) => { if (!condition) throw new Error("Invalid actuals evidence"); };

export const actualsLedgerIdFor = (refs) => phase.ledgerIdFor(refs);

export function actualsIdentityForRecord(source) {
  return {
    organizationId: source?.quote?.organizationId,
    quoteId: source?.quoteId ?? source?.quote?.quoteId,
    sourceVersionId: source?.quote?.activeVersionId,
    acceptanceReceiptId: source?.quote?.acceptanceReceipt?.receiptId
  };
}

/** Validate full private proof, then discard notes, entries, actors and requests. */
export function projectActualsEvidence(proof) {
  const source = phase.resolveSource({
    organizationId: proof?.organizationId,
    quoteId: proof?.quoteId,
    sourceQuote: proof?.sourceQuote,
    sourceVersion: proof?.sourceVersion,
    acceptanceReceiptDocument: proof?.acceptanceReceiptDocument
  });
  requireEvidence(proof.acceptanceReceiptDocument.proposalSnapshot.currency === "USD");
  const refs = identity(source);
  const ledgerId = phase.ledgerIdFor(source);
  const path = `organizations/${source.organizationId}/eventOperatingLedgers/${ledgerId}`;
  requireEvidence(proof.phaseLedger && proof.phaseReceipt);
  const phaseSnapshot = phase.projectSnapshot(source, proof.phaseLedger, proof.phaseReceipt);
  requireEvidence(phaseSnapshot.availability === "available"
    && phaseSnapshot.revision === phase.POLICY.phases.indexOf(phaseSnapshot.phase) + 1);
  const observedPhases = proof.observedPhaseReceipts ?? {};
  requireEvidence(observedPhases && typeof observedPhases === "object" && !Array.isArray(observedPhases)
    && Object.keys(observedPhases).length <= 2);
  requireEvidence(proof.actualsState && proof.actualsReceipt);
  const snapshot = actuals.projectSnapshot({ source, actualsState: proof.actualsState, receipt: proof.actualsReceipt });
  requireEvidence(snapshot.currency === "USD" && snapshot.availability === "available");
  const verifyObservedPhase = (receipt) => {
    requireEvidence(receipt.observedPhaseRevision <= phaseSnapshot.revision);
    const observed = receipt.observedPhaseReceiptId === phaseSnapshot.lastReceiptId
      ? proof.phaseReceipt : observedPhases[receipt.observedPhaseReceiptId];
    requireEvidence(observed && observed.receiptId === receipt.observedPhaseReceiptId);
    const historical = phase.projectSnapshot(source, observed.resultLedger, observed);
    requireEvidence(historical.revision === receipt.observedPhaseRevision
      && historical.revision === phase.POLICY.phases.indexOf(historical.phase) + 1
      && historical.updatedAtISO <= receipt.recordedAtISO);
    requireEvidence(receipt.recordedAtISO >= proof.phaseLedger.createdAtISO);
  };
  verifyObservedPhase(proof.actualsReceipt);
  requireEvidence(proof.actualsState.createdAtISO >= source.acceptedAtISO
    && proof.actualsState.createdAtISO >= source.bookedAtISO);
  const declarationFields = {};
  if (snapshot.captureComplete) {
    const receipts = proof.declarationReceipts;
    requireEvidence(receipts && typeof receipts === "object" && !Array.isArray(receipts)
      && Object.keys(receipts).length <= 3);
    const ids = categories.map((category) => snapshot.categories[category].lastDeclarationReceiptId);
    requireEvidence(new Set(ids).size === 3 && Object.keys(receipts).length === 3);
    for (const category of categories) {
      const declaration = snapshot.categories[category];
      const id = declaration.lastDeclarationReceiptId;
      requireEvidence(receiptPattern.test(id) && Object.hasOwn(receipts, id));
      const receipt = receipts[id];
      const declared = actuals.projectSnapshot({ source, actualsState: receipt?.resultActualsState, receipt });
      verifyObservedPhase(receipt);
      requireEvidence(receipt.request.command === "declare_category"
        && receipt.request.category === category
        && receipt.request.state === declaration.state
        && receipt.request.note === declaration.note
        && receipt.receiptId === id
        && receipt.recordedAtISO === declaration.declaredAtISO
        && receipt.resultRevision <= snapshot.revision
        && equal(declared.categories[category], declaration)
        && equal(declared.entries.filter((entry) => entry.category === category),
          snapshot.entries.filter((entry) => entry.category === category)));
      declarationFields[`${category}Declaration`] = {
        sourceObject: `${path}/actualsReceipts/${id}`,
        sourceField: "request.state",
        revision: String(receipt.resultRevision),
        derivation: "Explicit category declaration verified against retained category entries",
        detail: `Declared ${declaration.state} at ${declaration.declaredAtISO}`
      };
    }
  }
  const result = freeze({
    kind: "verified-declared-actuals-v1",
    source: refs,
    captureComplete: snapshot.captureComplete,
    acceptanceSnapshotSha256: proof.sourceQuote.acceptanceReceipt.snapshotSha256,
    costBasisSha256: digestSha256(proof.sourceVersion.commercialSnapshot ?? null),
    evidenceThroughISO: [snapshot.updatedAtISO, phaseSnapshot.updatedAtISO, source.acceptedAtISO, source.bookedAtISO].sort().at(-1),
    observedAtISO: snapshot.updatedAtISO,
    value: snapshot.captureComplete ? {
      laborCostCents: snapshot.totals.laborCostCents,
      purchasingCostCents: snapshot.totals.purchasingCostCents,
      otherCostCents: snapshot.totals.otherCostCents,
      recordedAtISO: snapshot.updatedAtISO
    } : null,
    provenance: provenance({
      sourceObject: `${path}/actualsReceipts/${snapshot.lastReceiptId}`,
      sourceField: "resultActualsState.entries",
      revision: String(snapshot.revision),
      sourceSchemaVersion: snapshot.schemaVersion,
      observedAtISO: snapshot.updatedAtISO,
      fields: {
        acceptedSource: { sourceObject: `organizations/${source.organizationId}/proposalAcceptanceReceipts/${source.acceptanceReceiptId}`, sourceField: "proposalSnapshot", revision: source.sourceVersionId, derivation: "Private acceptance digest and immutable accepted version verified" },
        phase: { sourceObject: `${path}/receipts/${phaseSnapshot.lastReceiptId}`, sourceField: "resultLedger", revision: String(phaseSnapshot.revision), derivation: "Initialized phase identity verified; no delivery inference" },
        ...declarationFields
      }
    })
  });
  verified.add(result);
  return result;
}

export function isVerifiedActualsEvidence(value) {
  return Boolean(value && verified.has(value));
}

// Reader failures are also branded, so JSON cannot forge an availability claim.
export function unavailableActualsEvidence(refs, reason = "absent") {
  const result = freeze({ kind: "unavailable-declared-actuals-v1", source: identity(refs), reason });
  verified.add(result);
  return result;
}

export function actualsEvidenceEnvelope(context, candidate) {
  const base = provenance({ sourceField: "actualsState/current" });
  if (!candidate) {
    return notYetAvailable(base, "No verified operator-declared actuals journal is available. Event dates and phase completion do not establish costs.", "business_policy");
  }
  let projection;
  try {
    if (isVerifiedActualsEvidence(candidate)) projection = candidate;
    else {
      if (!candidate.sourceQuote || !candidate.sourceVersion || !candidate.acceptanceReceiptDocument) {
        return missing(base, "Actual costs require full exact-source private proof; an aggregate or serialized verification claim is insufficient.", "business_policy");
      }
      if ([candidate.actualsState, candidate.actualsReceipt].some((item) => item && item.schemaVersion !== 1)) {
        return schemaDrift(base, "The declared-actuals source schema is unsupported.");
      }
      projection = projectActualsEvidence(candidate);
    }
    requireEvidence(equal(projection.source, actualsIdentityForRecord(context.source)));
    if (projection.kind === "verified-declared-actuals-v1") {
      requireEvidence(context.source.quoteVersion?.versionId === projection.source.sourceVersionId
        && context.source.quote.acceptanceReceipt.snapshotSha256 === projection.acceptanceSnapshotSha256
        && digestSha256(context.source.quoteVersion.commercialSnapshot ?? null) === projection.costBasisSha256);
    }
  } catch {
    return contradictory(base, { expected: "Verified exact-source acceptance, phase and actuals evidence", observed: "Invalid or mismatched private evidence" }, "Private declared-cost evidence did not verify; no costs were exported.");
  }
  if (projection.kind === "unavailable-declared-actuals-v1") {
    if (projection.reason === "invalid") {
      return contradictory(base, { expected: "Verified exact-source private evidence", observed: "Invalid or orphaned evidence" }, "Private declared-cost evidence did not verify; no costs were exported.");
    }
    if (projection.reason === "schema_drift") return schemaDrift(base, "The declared-actuals source schema is unsupported.");
    return notYetAvailable(base, "No verified operator-declared actuals journal is available. An elapsed event date is not cost evidence.", "business_policy");
  }
  if (!Number.isFinite(Date.parse(context.evaluatedAtISO))
    || Date.parse(projection.evidenceThroughISO) > Date.parse(context.evaluatedAtISO)) {
    return notYetAvailable(projection.provenance, "The recorded actuals are later than this evaluation instant.", "business_policy");
  }
  if (!projection.captureComplete) {
    return missing(projection.provenance, "Labor, purchasing and other costs must each be explicitly complete or not applicable. Captured partial totals are not zero or complete costs.", "business_policy");
  }
  return available(projection.value, projection.provenance, "Operator-declared USD costs with explicit category completeness. Not evidence of attendance, physical consumption, delivery, payment or settlement; no rate or tolerance was inferred.");
}
