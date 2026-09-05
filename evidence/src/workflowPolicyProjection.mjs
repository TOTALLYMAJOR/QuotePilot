// Pure verification of a pinned workflow comparison policy. This module never
// reads a current definition head: retirement/publication cannot rebase instances.
import { createRequire } from "node:module";
import { available, contradictory, missing, notYetAvailable, schemaDrift } from "./availability.mjs";
import { provenance } from "./provenance.mjs";
import { digestSha256 } from "./canonical.mjs";
import { actualsIdentityForRecord } from "./actualsProjection.mjs";

const require = createRequire(import.meta.url);
const phase = require("../../functions/eventOperations.js");
const execution = require("../../functions/workflowExecution.js");
const definitions = require("../../functions/workflowDefinitions.js");
const packs = require("../../functions/workflowPackAdapters.js");
const verified = new WeakSet();
const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const equal = (left, right) => digestSha256(left) === digestSha256(right);
const requireEvidence = (condition) => { if (!condition) throw new Error("Invalid pinned workflow policy evidence"); };
const sourceRefs = (value) => Object.fromEntries(["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"].map((key) => [key, value?.[key]]));
export function workflowSourceFor(refs, schemaVersion = 1) {
  requireEvidence([1, 2].includes(schemaVersion));
  return execution.normalizeSource({ ...(schemaVersion === 2 ? { schemaVersion: 2 } : {}), organizationId: refs.organizationId, workflowKind: "event_execution", subjectId: refs.quoteId, sourceVersionId: refs.sourceVersionId, sourceReceiptId: refs.acceptanceReceiptId });
}
export const workflowInstanceIdFor = (refs, schemaVersion = 1) => execution.instanceIdFor(workflowSourceFor(refs, schemaVersion));

export function projectWorkflowPolicyEvidence(proof) {
  const accepted = phase.resolveSource({ organizationId: proof?.organizationId, quoteId: proof?.quoteId, sourceQuote: proof?.sourceQuote, sourceVersion: proof?.sourceVersion, acceptanceReceiptDocument: proof?.acceptanceReceiptDocument });
  requireEvidence(proof.acceptanceReceiptDocument.proposalSnapshot.currency === "USD");
  const source = workflowSourceFor(accepted, proof.instance?.schemaVersion);
  requireEvidence(proof.instance && proof.instanceReceipt && proof.phaseLedger && proof.phaseReceipt);
  execution.verifyInstance(source, proof.instance, proof.instanceReceipt);
  const phaseSnapshot = phase.projectSnapshot(accepted, proof.phaseLedger, proof.phaseReceipt);
  requireEvidence(phaseSnapshot.availability === "available"
    && phaseSnapshot.revision === phase.POLICY.phases.indexOf(phaseSnapshot.phase) + 1
    && equal(proof.instance.domainRef, source.schemaVersion === 2
      ? packs.eventObservation({ source: accepted, ledger: proof.phaseLedger, receipt: proof.phaseReceipt }).domainRef
      : { kind: "event_phase", revision: phaseSnapshot.revision,
      receiptId: phaseSnapshot.lastReceiptId, policyDigest: phaseSnapshot.policyDigest, receiptDigest: proof.phaseReceipt.receiptDigest }));
  const embedded = definitions.validatePublishedVersion(proof.instance.definition);
  let published = embedded;
  if (!embedded.seed) {
    published = definitions.validatePublishedVersion(proof.publishedVersion, { allowSeed: false });
    requireEvidence(published.organizationId === accepted.organizationId && equal(published, embedded));
  } else if (proof.publishedVersion) {
    requireEvidence(equal(proof.publishedVersion, embedded));
  }
  requireEvidence(equal(proof.instance.definitionPin, definitions.definitionPin(published)));
  requireEvidence(proof.instance.createdAtISO >= accepted.acceptedAtISO && proof.instance.createdAtISO >= accepted.bookedAtISO);
  const value = definitions.comparisonPolicyEvidence(published);
  const instancePath = `organizations/${accepted.organizationId}/workflowInstances/${proof.instance.instanceId}`;
  const definitionPath = published.seed ? "quotepilot-source://workflowDefinitions/event_execution_v0"
    : `organizations/${accepted.organizationId}/workflowDefinitions/${published.definitionId}/versions/${published.versionId}`;
  const result = freeze({
    kind: "verified-workflow-comparison-policy-v1", source: sourceRefs(accepted), value,
    acceptanceSnapshotSha256: proof.sourceQuote.acceptanceReceipt.snapshotSha256,
    costBasisSha256: digestSha256(proof.sourceVersion.commercialSnapshot ?? null),
    evidenceThroughISO: [proof.instance.updatedAtISO, phaseSnapshot.updatedAtISO, published.publishedAtISO, accepted.acceptedAtISO, accepted.bookedAtISO].sort().at(-1),
    provenance: provenance({ sourceObject: definitionPath, sourceField: "config.comparisonPolicy", revision: published.versionId,
      sourceSchemaVersion: published.schemaVersion, observedAtISO: published.publishedAtISO,
      fields: {
        definitionPin: { sourceObject: instancePath, sourceField: "definitionPin", revision: String(proof.instance.revision), derivation: "Exact immutable published definition matches the instance pin", detail: published.definitionDigest },
        workflowReceipt: { sourceObject: `${instancePath}/receipts/${proof.instance.lastReceiptId}`, sourceField: "resultInstance", revision: String(proof.instance.revision), derivation: "Verified current instance and immutable workflow receipt" },
        acceptedSource: { sourceObject: `organizations/${accepted.organizationId}/proposalAcceptanceReceipts/${accepted.acceptanceReceiptId}`, sourceField: "proposalSnapshot", revision: accepted.sourceVersionId, derivation: "Exact private acceptance and immutable source verified" },
        phaseReceipt: { sourceObject: `organizations/${accepted.organizationId}/eventOperatingLedgers/${phaseSnapshot.ledgerId}/receipts/${phaseSnapshot.lastReceiptId}`, sourceField: "resultLedger", revision: String(phaseSnapshot.revision), derivation: "Exact trusted phase outcome matches the workflow domain reference" }
      }
    })
  });
  verified.add(result);
  return result;
}
export function unavailableWorkflowPolicyEvidence(refs, reason = "absent") {
  const result = freeze({ kind: "unavailable-workflow-comparison-policy-v1", source: sourceRefs(refs), reason });
  verified.add(result);
  return result;
}
export const isVerifiedWorkflowPolicyEvidence = (value) => Boolean(value && verified.has(value));

export function workflowPolicyEnvelope(source, evaluatedAtISO) {
  const candidate = source.workflowPolicyEvidence ?? source.workflowPolicyProof;
  const base = provenance({ sourceField: "definition.config.comparisonPolicy" });
  if (!candidate) return notYetAvailable(base, "No verified instance-pinned comparison policy is available; no tolerance is inferred.", "business_policy");
  let projection;
  try {
    if (isVerifiedWorkflowPolicyEvidence(candidate)) projection = candidate;
    else {
      if (!candidate.sourceQuote || !candidate.sourceVersion || !candidate.acceptanceReceiptDocument) return missing(base, "A comparison policy requires full private workflow proof; bare thresholds and serialized validation claims are not trusted.", "business_policy");
      if ([candidate.instance, candidate.publishedVersion].some((value) => value && ![1, 2].includes(value.schemaVersion))) return schemaDrift(base, "The workflow policy source schema is unsupported.");
      projection = projectWorkflowPolicyEvidence(candidate);
    }
    requireEvidence(equal(projection.source, actualsIdentityForRecord(source)));
    if (projection.kind === "verified-workflow-comparison-policy-v1") {
      requireEvidence(source.quoteVersion?.versionId === projection.source.sourceVersionId
        && source.quote.acceptanceReceipt.snapshotSha256 === projection.acceptanceSnapshotSha256
        && digestSha256(source.quoteVersion.commercialSnapshot ?? null) === projection.costBasisSha256);
    }
  } catch {
    return contradictory(base, { expected: "Exact pinned workflow, published definition and phase receipts", observed: "Invalid or mismatched private evidence" }, "Comparison policy did not verify. Declared-cost evidence remains independently assessed.");
  }
  if (projection.kind === "unavailable-workflow-comparison-policy-v1") {
    if (projection.reason === "invalid") return contradictory(base, { expected: "Exact pinned workflow evidence", observed: "Invalid or orphaned workflow evidence" }, "Comparison policy did not verify. Declared costs are independently assessed.");
    if (projection.reason === "schema_drift") return schemaDrift(base, "The workflow policy source schema is unsupported.");
    return notYetAvailable(base, "No instance-pinned comparison policy is available; existing events are not retroactively bound.", "business_policy");
  }
  if (!projection.value) return notYetAvailable(projection.provenance, "The pinned definition declares no comparison policy. Seed and null policy do not supply tolerances.", "business_policy");
  if (!Number.isFinite(Date.parse(evaluatedAtISO)) || Date.parse(projection.evidenceThroughISO) > Date.parse(evaluatedAtISO)) return notYetAvailable(projection.provenance, "Pinned policy evidence is later than the evaluation instant.", "business_policy");
  return available(projection.value, projection.provenance, "Explicit comparison tolerances from the exact instance-pinned immutable tenant publication; never inferred from costs or history.");
}
