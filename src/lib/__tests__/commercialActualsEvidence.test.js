import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { declaredActualsFixture, EVALUATED_AT } from "../../../evidence/testing/buildFixtures.mjs";
import { fakeFirestore } from "../../../evidence/testing/fakeFirestore.mjs";
import { readOrganizationEvidence } from "../../../evidence/src/firestoreReader.mjs";
import { projectActualsEvidence, isVerifiedActualsEvidence } from "../../../evidence/src/actualsProjection.mjs";
import { createConsumptionProducer } from "../../../evidence/src/producers/consumptionProducer.mjs";
import { exportRecord, exportBundle } from "../../../evidence/src/exporterCore.mjs";
import { buildProducers } from "../../../scripts/reconciliation-evidence-export.mjs";

const require = createRequire(import.meta.url);
const actuals = require("../../../functions/eventOperatingActuals.js");
const phaseAuthority = require("../../../functions/eventOperations.js");
const consume = (record, evaluatedAtISO = EVALUATED_AT) => createConsumptionProducer().produce({ source: record, evaluatedAtISO });
function database(fixture) {
  const { proof } = fixture;
  const org = `organizations/${proof.organizationId}`;
  const ledger = `${org}/eventOperatingLedgers/${proof.phaseLedger.ledgerId}`;
  return fakeFirestore({
    [`${org}/quotes/${proof.quoteId}`]: { ...proof.sourceQuote, internalNotes: "Private quote note", portalKey: "private-portal-access" },
    [`${org}/quotes/${proof.quoteId}/versions/${proof.sourceVersion.versionId}`]: proof.sourceVersion,
    [`${org}/proposalAcceptanceReceipts/${proof.acceptanceReceiptId}`]: proof.acceptanceReceiptDocument,
    [ledger]: proof.phaseLedger,
    [`${ledger}/receipts/${proof.phaseReceipt.receiptId}`]: proof.phaseReceipt,
    ...Object.fromEntries(Object.entries(proof.observedPhaseReceipts || {}).map(([id, receipt]) => [`${ledger}/receipts/${id}`, receipt])),
    [`${ledger}/actualsState/current`]: proof.actualsState,
    ...Object.fromEntries(fixture.receipts.map((receipt) => [`${ledger}/actualsReceipts/${receipt.receiptId}`, receipt]))
  });
}
const read = (db, fixture) => readOrganizationEvidence({ db, organizationId: fixture.proof.organizationId, quoteIds: [fixture.proof.quoteId] });

describe("verified declared actuals evidence", () => {
  test("exports only complete exact-source declared USD costs without a delivery heuristic", () => {
    const { record } = declaredActualsFixture();
    expect(record.quote.event.date > EVALUATED_AT.slice(0, 10)).toBe(true);
    expect(record.eventCompleted).toBe(false);
    const evidence = consume(record);
    expect(evidence.availability).toBe("available");
    expect(evidence.value).toEqual({ laborCostCents: 208000, purchasingCostCents: 612000, otherCostCents: 96000, recordedAtISO: "2026-08-20T12:00:06.000Z" });
    expect(evidence.provenance.sourceObject).toContain(`/actualsReceipts/${record.actualsProof.actualsReceipt.receiptId}`);
    expect(evidence.provenance.revision).toBe("6");
    for (const category of ["labor", "purchasing", "other"]) expect(evidence.provenance.fields[`${category}Declaration`].sourceObject).toContain("/actualsReceipts/");
    expect(JSON.stringify(evidence)).not.toMatch(/Private (labor|purchasing|other)|actuals-fixture-operator|recordedBy|commandDigest|customer-fixture|requestId/);
  });

  test("keeps undeclared and partial categories unavailable while explicit zero remains zero", () => {
    const partial = declaredActualsFixture({ complete: false });
    expect(consume(partial.record)).toMatchObject({ availability: "missing", constraintClass: "business_policy" });
    expect(consume(partial.record).value).toBeUndefined();
    const zero = consume(declaredActualsFixture({ costs: { labor: 0, purchasing: 0, other: 0 } }).record);
    expect(zero.availability).toBe("available");
    expect(zero.value.laborCostCents + zero.value.purchasingCostCents + zero.value.otherCostCents).toBe(0);
    const absent = { ...partial.record, actualsProof: null, eventCompleted: true };
    expect(consume(absent).availability).toBe("not_yet_available");
  });

  test("does not export future recorded costs into an earlier evaluation", () => {
    expect(consume(declaredActualsFixture().record, "2026-08-20T12:00:05.000Z").availability).toBe("not_yet_available");
  });

  test("rejects legacy quote-only aggregates and serialized or fabricated verification brands", () => {
    const fixture = declaredActualsFixture();
    const { actualsProof, ...record } = fixture.record;
    const aggregate = { laborCostCents: 1, purchasingCostCents: 2, otherCostCents: 0, recordedAtISO: EVALUATED_AT };
    const producers = buildProducers({ actualConsumption: { [record.quoteId]: aggregate } });
    expect(exportRecord(record, { evaluatedAtISO: EVALUATED_AT, producers }).evidence.actualConsumption.availability).toBe("not_yet_available");
    const branded = projectActualsEvidence(actualsProof);
    expect(isVerifiedActualsEvidence(branded)).toBe(true);
    expect(Object.isFrozen(branded.value)).toBe(true);
    const copied = JSON.parse(JSON.stringify(branded));
    expect(isVerifiedActualsEvidence(copied)).toBe(false);
    expect(consume({ ...record, actualsEvidence: copied }).availability).toBe("missing");
    expect(consume({ ...record, actualsProof: aggregate }).availability).toBe("missing");
  });

  test.each(["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"])("rejects projection substitution across exact %s", (field) => {
    const fixture = declaredActualsFixture();
    const branded = projectActualsEvidence(fixture.proof);
    const record = structuredClone(fixture.record);
    if (field === "organizationId") record.quote.organizationId = "other-org";
    if (field === "quoteId") record.quoteId = "other-quote";
    if (field === "sourceVersionId") record.quote.activeVersionId = "other-version";
    if (field === "acceptanceReceiptId") record.quote.acceptanceReceipt.receiptId = "other-acceptance";
    record.actualsEvidence = branded;
    expect(consume(record).availability).toBe("contradictory");
  });

  test.each(["acceptance", "version", "phase", "actuals", "declaration", "missingDeclaration"])("fails closed for tampered private %s evidence", (kind) => {
    const { record, proof } = declaredActualsFixture();
    if (kind === "acceptance") proof.acceptanceReceiptDocument.proposalSnapshot.organizationId = "wrong-org";
    if (kind === "version") proof.sourceVersion.snapshot.event.date = "2026-11-01";
    if (kind === "phase") proof.phaseReceipt.resultRevision += 1;
    if (kind === "actuals") proof.actualsReceipt.receiptDigest = "0".repeat(64);
    const id = proof.actualsState.categories.labor.lastDeclarationReceiptId;
    if (kind === "declaration") proof.declarationReceipts[id].recordedBy.uid = "substituted-actor";
    if (kind === "missingDeclaration") delete proof.declarationReceipts[id];
    expect(consume(record).availability).toBe("contradictory");
    expect(consume(record).value).toBeUndefined();
  });

  test("requires declaration receipts to match every retained row in that category", () => {
    const fixture = declaredActualsFixture();
    const different = declaredActualsFixture({ costs: { labor: 1, purchasing: 612000, other: 96000 } });
    const id = fixture.proof.actualsState.categories.labor.lastDeclarationReceiptId;
    fixture.proof.declarationReceipts[id] = different.proof.declarationReceipts[id];
    // Both receipts are internally valid and name the same source, request and
    // declaration. The changed retained cost must still prevent export.
    expect(consume(fixture.record).availability).toBe("contradictory");
  });

  test("rejects non-USD acceptance even when its private digest is internally consistent", () => {
    const fixture = declaredActualsFixture();
    const receipt = fixture.proof.acceptanceReceiptDocument;
    receipt.proposalSnapshot.currency = "EUR";
    const hash = createHash("sha256").update(JSON.stringify(receipt.proposalSnapshot)).digest("hex");
    receipt.snapshotSha256 = hash;
    fixture.proof.sourceQuote.acceptanceReceipt.snapshotSha256 = hash;
    expect(consume(fixture.record).availability).toBe("contradictory");
  });

  test("accepts explicitly not-applicable categories with no retained active costs", () => {
    const fixture = declaredActualsFixture();
    const refs = Object.fromEntries(["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"].map((key) => [key, fixture.proof[key]]));
    let previous = null;
    const declarations = {};
    for (const [index, category] of ["labor", "purchasing", "other"].entries()) {
      previous = actuals.planCommand({ source: refs, actor: fixture.actor, phaseSnapshot: fixture.phase.snapshot,
        actualsState: previous?.nextActualsState, currentReceipt: previous?.receipt, nowISO: `2026-08-20T13:00:0${index}.000Z`,
        request: { ...refs, requestId: `fixture-not-applicable-000${index}`, actualsPolicyVersion: 1, expectedActualsRevision: index, command: "declare_category", category, state: "not_applicable", note: "No costs apply in this category" } });
      declarations[previous.receipt.receiptId] = previous.receipt;
    }
    fixture.proof.actualsState = previous.nextActualsState;
    fixture.proof.actualsReceipt = previous.receipt;
    fixture.proof.declarationReceipts = declarations;
    const envelope = consume(fixture.record);
    expect(envelope.availability).toBe("available");
    expect(envelope.value.laborCostCents + envelope.value.purchasingCostCents + envelope.value.otherCostCents).toBe(0);
  });

  test("classifies unknown actuals schema separately from contradictory evidence", () => {
    const { record, proof } = declaredActualsFixture();
    proof.actualsState.schemaVersion = 99;
    expect(consume(record).availability).toBe("schema_drift");
  });

  test("binds declared costs to the accepted snapshot and immutable version cost evidence", () => {
    for (const field of ["version", "costs", "acceptance"]) {
      const fixture = declaredActualsFixture();
      const branded = projectActualsEvidence(fixture.proof);
      const record = structuredClone(fixture.record);
      record.actualsEvidence = branded;
      if (field === "version") record.quoteVersion.versionId = "different-version";
      if (field === "costs") record.quoteVersion.commercialSnapshot.categories.labor.extendedCostCents = 1;
      if (field === "acceptance") record.quote.acceptanceReceipt.snapshotSha256 = "0".repeat(64);
      expect(consume(record).availability).toBe("contradictory");
    }
  });

  test("correction and void invalidate export until explicit redeclaration", () => {
    const fixture = declaredActualsFixture();
    const { proof, actor } = fixture;
    const entry = proof.actualsState.entries[0];
    const corrected = actuals.planCommand({ source: proof, actor, phaseSnapshot: fixture.phase.snapshot,
      actualsState: proof.actualsState, currentReceipt: proof.actualsReceipt, nowISO: "2026-08-20T13:00:00.000Z",
      request: { ...Object.fromEntries(["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"].map((key) => [key, proof[key]])), requestId: "fixture-actuals-correction-0001", actualsPolicyVersion: 1, expectedActualsRevision: 6, command: "correct", category: "labor", entryId: entry.entryId, description: "Corrected operator cost", costCents: 9, durationMinutes: 480, laborRole: "lead", reason: "Reviewed actual amount" } });
    proof.actualsState = corrected.nextActualsState;
    proof.actualsReceipt = corrected.receipt;
    expect(consume(fixture.record).availability).toBe("missing");
    expect(consume(fixture.record).value).toBeUndefined();
    const voided = actuals.planCommand({ source: proof, actor, phaseSnapshot: fixture.phase.snapshot,
      actualsState: proof.actualsState, currentReceipt: proof.actualsReceipt, nowISO: "2026-08-20T13:01:00.000Z",
      request: { ...Object.fromEntries(["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"].map((key) => [key, proof[key]])), requestId: "fixture-actuals-void-00001", actualsPolicyVersion: 1, expectedActualsRevision: 7, command: "void", entryId: entry.entryId, reason: "Duplicate operator cost" } });
    proof.actualsState = voided.nextActualsState;
    proof.actualsReceipt = voided.receipt;
    expect(proof.actualsState.entries[0].state).toBe("voided");
    expect(consume(fixture.record).availability).toBe("missing");
    expect(consume(fixture.record).value).toBeUndefined();
  });

  test("verifies each older observed phase receipt after phase advancement", async () => {
    const fixture = declaredActualsFixture();
    const original = fixture.proof.phaseReceipt;
    const refs = Object.fromEntries(["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"].map((key) => [key, fixture.proof[key]]));
    const advanced = phaseAuthority.planCommand({ source: refs, actor: fixture.actor, ledger: fixture.proof.phaseLedger, nowISO: "2026-08-20T14:00:00.000Z",
      request: { ...refs, requestId: "fixture-phase-advance-0001", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" } });
    fixture.proof.phaseLedger = advanced.nextLedger;
    fixture.proof.phaseReceipt = advanced.receipt;
    expect(consume(fixture.record).availability).toBe("contradictory");
    fixture.proof.observedPhaseReceipts[original.receiptId] = original;
    expect(consume(fixture.record).availability).toBe("available");
    const db = database(fixture);
    expect(consume((await read(db, fixture)).records[0]).availability).toBe("available");
    const oldPath = Object.keys(db._store).find((path) => path.endsWith(`/receipts/${original.receiptId}`));
    delete db._store[oldPath];
    expect(consume((await read(db, fixture)).records[0]).availability).toBe("contradictory");
    fixture.proof.observedPhaseReceipts[original.receiptId] = advanced.receipt;
    expect(consume(fixture.record).availability).toBe("contradictory");
  });

  test("reader verifies private records and emits only branded allowlisted aggregates", async () => {
    const fixture = declaredActualsFixture();
    const output = await read(database(fixture), fixture);
    expect(isVerifiedActualsEvidence(output.records[0].actualsEvidence)).toBe(true);
    const serialized = JSON.stringify(output);
    expect(serialized).not.toMatch(/Private (labor|purchasing|other|quote)|actuals-fixture-operator|"priorActualsState":|"resultActualsState":|recordedBy|commandDigest|private-portal-access/);
    const bundle = exportBundle(output.records, { evaluatedAtISO: EVALUATED_AT, producers: buildProducers(output) });
    expect(bundle.records[0].evidence.actualConsumption.availability).toBe("available");
    expect(JSON.stringify(bundle)).not.toMatch(/Private (labor|purchasing|other|quote)/);
    expect(JSON.stringify(output)).toBe(serialized);
  });

  test("reader rejects cross-tenant actuals rather than silently omitting them", async () => {
    const fixture = declaredActualsFixture();
    const db = database(fixture);
    const path = Object.keys(db._store).find((path) => path.endsWith("/actualsState/current"));
    db._store[path] = { ...db._store[path], organizationId: "foreign-org" };
    await expect(read(db, fixture)).rejects.toThrow(/Refusing to build evidence across tenants/);
  });

  test("reader retains distinct orphan and absent evidence without restoring unknown totals", async () => {
    const fixture = declaredActualsFixture();
    const db = database(fixture);
    const statePath = Object.keys(db._store).find((path) => path.endsWith("/actualsState/current"));
    delete db._store[statePath];
    const orphan = await read(db, fixture);
    expect(consume(orphan.records[0]).availability).toBe("contradictory");
    for (const path of Object.keys(db._store)) if (path.includes("/actualsReceipts/")) delete db._store[path];
    const absent = await read(db, fixture);
    expect(consume(absent.records[0]).availability).toBe("not_yet_available");
  });

  test("pure verification dependencies contain no credential network clock or persistence access", () => {
    for (const path of ["evidence/src/actualsProjection.mjs", "functions/eventOperatingActuals.js", "functions/eventOperations.js", "functions/postEventCloseout.js"]) {
      const source = readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/firebase-admin|fetch\s*\(|https?:\/\/|process\.env|Date\.now\s*\(|new Date\(\)|writeFile|\.collection\s*\(/);
    }
  });
});
