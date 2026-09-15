import fs from "node:fs";
import { describe, expect, test } from "vitest";

const FUNCTIONS_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

function sourceBetween(startMarker, endMarker) {
  const start = FUNCTIONS_SOURCE.indexOf(startMarker);
  const end = FUNCTIONS_SOURCE.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Unable to locate source contract between ${startMarker} and ${endMarker}.`);
  }
  return FUNCTIONS_SOURCE.slice(start, end);
}

describe("Kitchen BEO callable source ownership", () => {
  test("keeps operational notes callable-owned, revision-bound, and receipt-backed", () => {
    const readCallable = sourceBetween(
      "exports.getEventOperationalNotesSnapshot =",
      "exports.applyEventOperationalNoteCommand ="
    );
    expect(readCallable).toContain("await assertStaff(context");
    expect(readCallable).toContain("eventOperationalNotes.normalizeReadRequest(data)");
    expect(readCallable).toContain("tx.get(refs.quoteRef)");
    expect(readCallable).toContain("tx.get(refs.journalRef)");
    expect(readCallable).toContain("eventOperationalNotes.projectStaffSnapshot({");
    expect(readCallable).toContain("projectEventBriefReviewConsequences(quote, snapshot)");
    expect(readCallable).not.toMatch(/data\?\.(notes|journal|receipt|actor)/u);

    const commandCallable = sourceBetween(
      "exports.applyEventOperationalNoteCommand =",
      "function kitchenBeoRefs"
    );
    expect(commandCallable).toContain("eventOperationalNotes.normalizeRequest(data)");
    expect(commandCallable).toContain("eventOperationalNotes.receiptIdFor(request)");
    expect(commandCallable).toContain("eventOperationalNotes.planCommand({");
    expect(commandCallable).toContain("tx.create(refs.receiptRef, planned.receipt)");
    expect(commandCallable).toContain("tx.set(refs.journalRef, planned.nextJournal)");
    expect(commandCallable).toContain("eventOperationalNotes.publicReceipt(planned.receipt)");
    expect(commandCallable).not.toContain("functions.logger.info");
  });

  test("derives artifact status from the canonical quote, private receipt, and invalidations", () => {
    const statusReader = sourceBetween(
      "async function readKitchenBeoStatus",
      "exports.getKitchenBeoArtifactStatus ="
    );
    expect(statusReader).toContain("refs.quoteRef.get()");
    expect(statusReader).toContain("refs.artifactRef.get()");
    expect(statusReader).toContain("refs.invalidationsRef.limit(101).get()");
    expect(statusReader).toContain("if (invalidationsSnap.size > 100)");
    expect(statusReader).toContain('reasonCodes: ["invalidation_evidence_truncated"]');
    expect(statusReader).toContain("readKitchenBeoReceiptHistory({");
    expect(statusReader).toContain("trustedReceipt: receiptHistory.trustedCurrentReceipt");
    expect(statusReader).toContain("receiptHistory: receiptHistory.projection");
    expect(statusReader).toContain("kitchenBeoAuthority.deriveArtifactStatus({");
    expect(statusReader).toContain("canonicalQuote: quote");
    expect(statusReader).toContain("invalidations: invalidationsSnap.docs");
    expect(statusReader).toContain('artifactNodeId || item.nodeId) === "artifact.kitchen_beo"');

    const callable = sourceBetween(
      "exports.getKitchenBeoArtifactStatus =",
      "exports.downloadKitchenBeoReceipt ="
    );
    expect(callable).toContain("await assertStaff(context");
    expect(callable).toContain("same-organization staff authority");
    expect(callable).toContain("await readKitchenBeoStatus({ organizationId, quoteId");
    expect(callable).not.toMatch(/data\?\.(status|receipt|fingerprint|payload)/u);
  });

  test("downloads only exact immutable receipt bytes after staff scope and digest validation", () => {
    const callable = sourceBetween(
      "exports.downloadKitchenBeoReceipt =",
      "exports.generateKitchenBeo ="
    );
    expect(callable).toContain("await assertStaff(context");
    expect(callable).toContain("same-organization staff authority");
    expect(callable).toContain("refs.quoteRef.get()");
    expect(callable).toContain("refs.receiptRef.get()");
    expect(callable).toContain("projectStoredKitchenBeoArtifact");

    const validation = sourceBetween(
      "function projectStoredKitchenBeoArtifact",
      "async function readKitchenBeoStatus"
    );
    expect(validation).toContain("kitchenBeoAuthority.validateStoredArtifact(record)");
    expect(validation).toContain("receipt.organizationId !== organizationId");
    expect(validation).toContain("artifact: stored.artifact");
    expect(validation).not.toMatch(/data\?\.(artifact|payload|fingerprint|bytes)/u);
  });

  test("projects the flat authority DTO consumed by the real client", () => {
    const projection = sourceBetween(
      "function projectKitchenBeoStatus",
      "async function readKitchenBeoStatus"
    );
    for (const field of [
      "currentDependencyFingerprint",
      "receiptId",
      "receiptDependencyFingerprint",
      "commercialSourceRevisionId",
      "unresolvedInvalidationIds"
    ]) {
      expect(projection).toContain(field);
    }
    expect(projection).not.toContain("status.currentFingerprint");
    expect(projection).not.toContain("status.receipt &&");
    expect(projection).toContain("KITCHEN_BEO_RECEIPT_HISTORY_LIMIT");
    expect(projection).toContain("recentReceiptIds");
    expect(projection).toContain("receiptHistoryTruncated");
    expect(projection).toContain("projectStoredKitchenBeoArtifact(record");
  });

  test("generates from server-read quote and notes, then rechecks the same canonical claim before persistence", () => {
    const callable = sourceBetween(
      "exports.generateKitchenBeo =",
      "exports.reopenQuote ="
    );
    expect(callable).toContain("await assertStaff(context");
    expect(callable).toContain("same-organization staff authority");
    expect(callable).toContain("const [initialQuoteSnap, initialOperationalNotesSnap] = await Promise.all([");
    expect(callable).toContain("initialRefs.quoteRef.get()");
    expect(callable).toContain("initialRefs.operationalNotesRef.get()");
    expect(callable).toContain("projectVerifiedOperationalNotesForBeo({");
    expect(callable).toMatch(
      /buildGenerationClaim\(\{[\s\S]{0,300}canonicalQuote,[\s\S]{0,200}operationalNotes:\s*initialOperationalNotes\.projection,[\s\S]{0,200}request:\s*\{ requestId \},[\s\S]{0,120}trustedContext/u
    );
    expect(callable).toMatch(
      /renderKitchenBeoPdf\(\{\s*payload:\s*claim\.payload,\s*provenance:\s*\{ \.\.\.claim, generatedAtISO \}\s*\}\)/u
    );

    const transactionRead = callable.indexOf("tx.get(refs.quoteRef)");
    const transactionNotesRead = callable.indexOf("tx.get(refs.operationalNotesRef)");
    const transactionClaim = callable.indexOf(
      "const transactionClaim = kitchenBeoAuthority.buildGenerationClaim"
    );
    const canonicalComparison = callable.indexOf(
      "commercialDependencyGraphCore.canonicalSerialize(transactionClaim)"
    );
    const dependencyStateRead = callable.indexOf("tx.get(refs.dependencyStateRef)");
    const reconciliationRead = callable.indexOf("tx.get(refs.applyReceiptsRef.doc(latestApplyReceiptId))");
    const receiptCreate = callable.indexOf("tx.create(refs.receiptRef, {");
    expect(transactionRead).toBeGreaterThan(-1);
    expect(transactionNotesRead).toBeGreaterThan(transactionRead);
    expect(dependencyStateRead).toBeGreaterThan(transactionRead);
    expect(transactionClaim).toBeGreaterThan(transactionNotesRead);
    expect(canonicalComparison).toBeGreaterThan(transactionClaim);
    expect(reconciliationRead).toBeGreaterThan(canonicalComparison);
    expect(receiptCreate).toBeGreaterThan(canonicalComparison);
    expect(receiptCreate).toBeGreaterThan(reconciliationRead);
    expect(callable).toContain("The canonical quote changed while the Kitchen BEO was generated");

    expect(callable).not.toMatch(/data\?\.(payload|provenance|artifact|dependencyFingerprint)/u);
    expect(callable).not.toContain("data.payload");
    expect(callable).not.toContain("data.provenance");
    expect(callable).not.toContain("data.artifact");
    expect(callable).toContain("projectStoredKitchenBeoArtifact(record");
    expect(callable).toContain("projectStoredKitchenBeoArtifact(persisted.record");
    expect(callable).toContain("receipt: projected.receipt");
    expect(callable).toContain("receiptHistory: current.receiptHistory");
    expect(callable).toContain("artifact: projected.artifact");
    expect(callable).not.toContain("projectKitchenBeoStatus({ receipt:");
  });

  test("atomically resolves only exact current Kitchen BEO invalidations", () => {
    const callable = sourceBetween(
      "exports.generateKitchenBeo =",
      "exports.reopenQuote ="
    );
    expect(callable).toContain("const openKitchenBeoInvalidations = invalidationRecords.filter");
    expect(callable).toContain('normalizeText(item.nodeKind) === "artifact"');
    expect(callable).toContain("normalizeText(item.targetRevisionId) === activeRevisionId");
    expect(callable).toContain("normalizeText(item.applyReceiptId) === latestApplyReceiptId");
    expect(callable).toContain("postGenerationStatus.state !== KITCHEN_BEO_FRESHNESS_STATES.CURRENT");
    expect(callable).toContain("commercialChangeAuthority.reconcile({");
    expect(callable).toContain('resolution: "artifact_current"');
    expect(callable).toContain("tx.update(refs.invalidationsRef.doc(invalidationId)");
    expect(callable).toContain("tx.create(reconciliationRef");
    expect(callable).toContain("tx.update(refs.dependencyStateRef");
    expect(callable).toContain("dependencyReconciliation");
  });
});
