import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { declaredActualsFixture, EVALUATED_AT } from "../../../evidence/testing/buildFixtures.mjs";
import { fakeFirestore } from "../../../evidence/testing/fakeFirestore.mjs";
import { readOrganizationEvidence } from "../../../evidence/src/firestoreReader.mjs";
import { exportBundle } from "../../../evidence/src/exporterCore.mjs";
import { buildProducers } from "../../../scripts/reconciliation-evidence-export.mjs";
import { projectWorkflowPolicyEvidence, isVerifiedWorkflowPolicyEvidence } from "../../../evidence/src/workflowPolicyProjection.mjs";
import { observedCoverage } from "../../../evidence/src/coverage.mjs";

const require = createRequire(import.meta.url);
const definitions = require("../../../functions/workflowDefinitions.js");
const execution = require("../../../functions/workflowExecution.js");
const adapter = require("../../../functions/eventWorkflowAdapter.js");
const POLICY = { laborBasisPoints: 0, purchasingBasisPoints: 100, minimumCents: 0 };
function publication(actor, comparisonPolicy = POLICY, previous = null, name = "Published event policy", schemaVersion = 1) {
  const config = { ...structuredClone(definitions.seedPublishedVersion().config), name, comparisonPolicy,
    ...(schemaVersion === 2 ? { schemaVersion: 2, packPolicy: {
      phaseConstraints: { in_progress: { requiredCheckpoints: [], blockOpenUrgentIssues: false }, completed: { requiredCheckpoints: [], blockOpenUrgentIssues: false } },
      checkpointPrerequisites: { venue_access: [], team_briefing: [], service_handoff: [], pack_down: [] }
    } } : {}) };
  const saved = definitions.planSaveDraft({ request: { organizationId: actor.organizationId, workflowKind: "event_execution", requestId: `policy-evidence-draft-${previous?.nextHead.revision || 0}`, expectedRevision: previous?.nextHead.revision || 0, command: "save_draft", config }, actor, head: previous?.nextHead, currentReceipt: previous?.receipt, nowISO: previous?.receipt.recordedAtISO || "2026-08-19T10:00:00.000Z" });
  const preview = definitions.previewPublish({ organizationId: actor.organizationId, actor, head: saved.nextHead, currentReceipt: saved.receipt });
  return definitions.planPublish({ request: { organizationId: actor.organizationId, workflowKind: "event_execution", requestId: `policy-evidence-publish-${saved.nextHead.revision}`, expectedRevision: saved.nextHead.revision, command: "publish", previewDigest: preview.previewDigest, confirmationText: preview.confirmationText }, actor, head: saved.nextHead, currentReceipt: saved.receipt, nowISO: "2026-08-19T10:01:00.000Z" });
}
function fixture({ comparisonPolicy = POLICY, seed = false, schemaVersion = 1 } = {}) {
  const base = declaredActualsFixture();
  const publisher = { organizationId: base.proof.organizationId, uid: "explicit-policy-publisher", role: "admin" };
  const published = seed ? null : publication(publisher, comparisonPolicy, null, "Published event policy", schemaVersion);
  const definition = published?.publishedVersion || definitions.seedPublishedVersion();
  const planned = adapter.planEventCommand({ source: base.proof, request: base.phase.receipt.request, actor: base.actor, definition, nowISO: base.phase.receipt.recordedAtISO });
  const proof = { organizationId: base.proof.organizationId, quoteId: base.proof.quoteId,
    sourceQuote: base.record.quote, sourceVersion: base.record.quoteVersion, acceptanceReceiptDocument: base.record.acceptanceReceipt,
    instance: planned.workflowPlan.nextInstance, instanceReceipt: planned.workflowPlan.receipt,
    publishedVersion: published?.publishedVersion || null, phaseLedger: planned.phasePlan.nextLedger, phaseReceipt: planned.phasePlan.receipt };
  base.record.workflowPolicyProof = proof;
  return { ...base, policyProof: proof, published, publisher };
}
const bundle = (records) => exportBundle(records, { evaluatedAtISO: EVALUATED_AT, producers: buildProducers() });
const output = (record) => bundle([record]).records[0];
function database(value) {
  const actuals = value.proof;
  const proof = value.policyProof;
  const org = `organizations/${actuals.organizationId}`;
  const ledger = `${org}/eventOperatingLedgers/${proof.phaseLedger.ledgerId}`;
  const instancePath = `${org}/workflowInstances/${proof.instance.instanceId}`;
  const documents = {
    [`${org}/quotes/${actuals.quoteId}`]: actuals.sourceQuote,
    [`${org}/quotes/${actuals.quoteId}/versions/${actuals.sourceVersionId}`]: actuals.sourceVersion,
    [`${org}/proposalAcceptanceReceipts/${actuals.acceptanceReceiptId}`]: actuals.acceptanceReceiptDocument,
    [ledger]: proof.phaseLedger,
    [`${ledger}/receipts/${proof.phaseReceipt.receiptId}`]: proof.phaseReceipt,
    [`${ledger}/actualsState/current`]: actuals.actualsState,
    ...Object.fromEntries(value.receipts.map((receipt) => [`${ledger}/actualsReceipts/${receipt.receiptId}`, receipt])),
    [instancePath]: proof.instance,
    [`${instancePath}/receipts/${proof.instanceReceipt.receiptId}`]: proof.instanceReceipt,
    ...(proof.publishedVersion ? { [`${org}/workflowDefinitions/event_execution/versions/${proof.publishedVersion.versionId}`]: proof.publishedVersion } : {})
  };
  return fakeFirestore(documents);
}
const read = async (db, value) => (await readOrganizationEvidence({ db, organizationId: value.proof.organizationId, quoteIds: [value.proof.quoteId] })).records[0];

describe("instance-pinned workflow comparison policy evidence", () => {
  test("workflow policy exports only exact tenant-published pinned tolerances with actor and time", () => {
    const value = fixture();
    const record = output(value.record);
    expect(record.overrunThresholds).toEqual({ ...POLICY, declaredBy: value.publisher.uid, declaredAtISO: "2026-08-19T10:01:00.000Z" });
    expect(record.overrunPolicyEvidence.availability).toBe("available");
    expect(record.overrunPolicyEvidence.provenance.sourceObject).toContain("/versions/event_execution_v1");
    expect(record.overrunPolicyEvidence.provenance.fields.definitionPin.detail).toBe(value.policyProof.publishedVersion.definitionDigest);
    expect(record.evidence.actualConsumption.availability).toBe("available");
    expect(observedCoverage(bundle([value.record])).rules.find((rule) => rule.ruleId === "operational_overrun").recordsWithCompleteEvidence).toBe(1);
  });

  test.each(["seed", "null", "absent", "corrupt"])("workflow %s policy stays unavailable without discarding verified costs", (kind) => {
    const value = fixture({ seed: kind === "seed", comparisonPolicy: kind === "null" ? null : POLICY });
    if (kind === "absent") delete value.record.workflowPolicyProof;
    if (kind === "corrupt") value.policyProof.instanceReceipt = { ...value.policyProof.instanceReceipt, receiptDigest: "0".repeat(64) };
    const record = output(value.record);
    expect(record.overrunThresholds).toBeUndefined();
    expect(record.overrunPolicyEvidence.availability).not.toBe("available");
    expect(record.evidence.actualConsumption.availability).toBe("available");
    expect(observedCoverage(bundle([value.record])).rules.find((rule) => rule.ruleId === "operational_overrun").recordsWithCompleteEvidence).toBe(0);
  });

  test("workflow policy ignores bare thresholds and copied validation brands", () => {
    const value = fixture();
    const branded = projectWorkflowPolicyEvidence(value.policyProof);
    expect(isVerifiedWorkflowPolicyEvidence(branded)).toBe(true);
    expect(Object.isFrozen(branded.value)).toBe(true);
    value.record.workflowPolicyEvidence = JSON.parse(JSON.stringify(branded));
    expect(output(value.record).overrunThresholds).toBeUndefined();
    delete value.record.workflowPolicyEvidence;
    delete value.record.workflowPolicyProof;
    value.record.overrunThresholds = { ...POLICY, declaredBy: "fabricated", declaredAtISO: EVALUATED_AT };
    expect(output(value.record).overrunThresholds).toBeUndefined();
  });

  test("workflow policy reader keeps the old pin after later publication and retirement", async () => {
    const value = fixture();
    const db = database(value);
    const later = publication(value.publisher, { ...POLICY, laborBasisPoints: 999 }, value.published, "Later policy");
    const org = `organizations/${value.proof.organizationId}`;
    db._store[`${org}/workflowDefinitions/event_execution`] = later.nextHead;
    db._store[`${org}/workflowDefinitions/event_execution/versions/event_execution_v2`] = later.publishedVersion;
    expect(output(await read(db, value)).overrunThresholds.laborBasisPoints).toBe(0);
    db._store[`${org}/workflowDefinitions/event_execution`] = { ...later.nextHead, activeVersionId: "" };
    expect(output(await read(db, value)).overrunThresholds.laborBasisPoints).toBe(0);
    delete db._store[`${org}/workflowDefinitions/event_execution/versions/event_execution_v1`];
    const missing = output(await read(db, value));
    expect(missing.overrunThresholds).toBeUndefined();
    expect(missing.evidence.actualConsumption.availability).toBe("available");
  });

  test("workflow migration preserves exact policy and rejects a changed comparison threshold", () => {
    const value = fixture();
    const proof = value.policyProof;
    const later = publication(value.publisher, POLICY, value.published, "Revised coordination name");
    const preview = execution.previewMigration({ source: proof.instance.source, instance: proof.instance, currentReceipt: proof.instanceReceipt, targetDefinition: later.publishedVersion });
    expect(preview.compatible).toBe(true);
    const migrated = execution.planCommand({ source: proof.instance.source, instance: proof.instance, currentReceipt: proof.instanceReceipt, actor: value.actor,
      request: { requestId: "policy-evidence-migration-0001", expectedRevision: 1, command: "migrate", previewDigest: preview.previewDigest, confirmation: preview.confirmation, note: "Explicit compatible coordination migration" }, definition: later.publishedVersion, nowISO: "2026-08-20T12:10:00.000Z" });
    proof.instance = migrated.nextInstance; proof.instanceReceipt = migrated.receipt; proof.publishedVersion = later.publishedVersion;
    expect(output(value.record).overrunThresholds).toEqual({ ...POLICY, declaredBy: value.publisher.uid, declaredAtISO: later.publishedVersion.publishedAtISO });
    const incompatible = publication(value.publisher, { ...POLICY, minimumCents: 1 }, later, "Changed tolerance");
    const denied = execution.previewMigration({ source: proof.instance.source, instance: proof.instance, currentReceipt: proof.instanceReceipt, targetDefinition: incompatible.publishedVersion });
    expect(denied.compatible).toBe(false);
    expect(denied.reasons).toContain("threshold_policy_changed");
  });

  test.each(["acceptance", "sourceVersion", "phase", "instance", "published", "missingPublished"])("workflow policy rejects mismatched private %s proof independently of costs", (kind) => {
    const value = fixture();
    value.record.workflowPolicyProof = structuredClone(value.policyProof);
    const proof = value.record.workflowPolicyProof;
    if (kind === "acceptance") proof.acceptanceReceiptDocument.proposalSnapshot.organizationId = "foreign-org";
    if (kind === "sourceVersion") proof.sourceVersion.snapshot.event.date = "2026-12-01";
    if (kind === "phase") proof.phaseReceipt.receiptDigest = "0".repeat(64);
    if (kind === "instance") proof.instance.source.organizationId = "foreign-org";
    if (kind === "published") proof.publishedVersion.definitionDigest = "0".repeat(64);
    if (kind === "missingPublished") proof.publishedVersion = null;
    const record = output(value.record);
    expect(record.overrunThresholds).toBeUndefined();
    expect(record.overrunPolicyEvidence.availability).toBe("contradictory");
    expect(record.evidence.actualConsumption.availability).toBe("available");
  });

  test("workflow reader preserves private boundaries and rejects orphan or cross-tenant state", async () => {
    const value = fixture();
    const db = database(value);
    const record = await read(db, value);
    expect(isVerifiedWorkflowPolicyEvidence(record.workflowPolicyEvidence)).toBe(true);
    expect(JSON.stringify(record.workflowPolicyEvidence)).not.toMatch(/"(?:priorInstance|resultInstance|recordedBy|requestId|taskTemplates)":|Private labor/);
    const path = Object.keys(db._store).find((path) => /\/workflowInstances\/[^/]+$/.test(path));
    db._store[path] = { ...db._store[path], source: { ...db._store[path].source, organizationId: "foreign-org" } };
    await expect(read(db, value)).rejects.toThrow(/Refusing to build evidence across tenants/);
    delete db._store[path];
    const orphan = output(await read(db, value));
    expect(orphan.overrunPolicyEvidence.availability).toBe("contradictory");
    expect(orphan.evidence.actualConsumption.availability).toBe("available");
  });

  test("workflow policy verification dependencies have no network credentials clock or write path", () => {
    for (const path of ["evidence/src/workflowPolicyProjection.mjs", "functions/workflowExecution.js", "functions/workflowDefinitions.js"]) {
      const text = readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
      expect(text).not.toMatch(/firebase-admin|fetch\s*\(|process\.env|Date\.now\s*\(|new Date\(\)|writeFile|\.collection\s*\(/);
    }
  });
});


describe("version two event comparison policy evidence", () => {
  test("V2 event policy verifies native phase proof and immutable pin through offline export and exact reader", async () => {
    const value = fixture({ schemaVersion: 2 });
    const record = output(value.record);
    expect(record.overrunThresholds).toEqual({ ...POLICY, declaredBy: value.publisher.uid, declaredAtISO: "2026-08-19T10:01:00.000Z" });
    expect(record.overrunPolicyEvidence.provenance.sourceSchemaVersion).toBe("2");
    expect(value.policyProof.instance.domainRef.schemaVersion).toBe(2);
    const db = database(value);
    const sourced = await read(db, value);
    expect(output(sourced).overrunThresholds).toEqual(record.overrunThresholds);
    expect(JSON.stringify(sourced)).not.toContain("portalKeySha256");
    expect(JSON.stringify(sourced)).not.toContain('"resultInstance":');
  });
  test("V2 event policy rejects altered phase observation pins and schema without losing actual costs", () => {
    for (const change of [
      (p) => { p.phaseReceipt.receiptDigest = "0".repeat(64); },
      (p) => { p.publishedVersion.definitionDigest = "0".repeat(64); },
      (p) => { p.instance.source.schemaVersion = 1; },
      (p) => { p.instance.schemaVersion = 3; }
    ]) {
      const value = fixture({ schemaVersion: 2 });
      value.policyProof = structuredClone(value.policyProof); value.record.workflowPolicyProof = value.policyProof; change(value.policyProof);
      const record = output(value.record);
      expect(record.overrunThresholds).toBeUndefined();
      expect(record.overrunPolicyEvidence.availability).not.toBe("available");
      expect(record.evidence.actualConsumption.availability).toBe("available");
    }
  });
  test("reader rejects dual schema event bindings and orphan alternate schema history", async () => {
    for (const orphan of [false, true]) {
      const v1 = fixture(), v2 = fixture({ schemaVersion: 2 });
      const db = database(v1);
      const other = v2.policyProof.instance;
      const path = `organizations/${v2.proof.organizationId}/workflowInstances/${other.instanceId}`;
      if (!orphan) db._store[path] = other;
      db._store[`${path}/receipts/${other.lastReceiptId}`] = v2.policyProof.instanceReceipt;
      const sourced = await read(db, v1);
      expect(output(sourced).overrunPolicyEvidence.availability).toBe("contradictory");
      expect(output(sourced).evidence.actualConsumption.availability).toBe("available");
    }
  });
});
