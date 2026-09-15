import fs from "node:fs";
import { describe, expect, test } from "vitest";

const FUNCTIONS_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);
const RULES_SOURCE = fs.readFileSync(
  new URL("../../../firestore.rules", import.meta.url),
  "utf8"
);
const APP_SOURCE = fs.readFileSync(
  new URL("../../App.jsx", import.meta.url),
  "utf8"
);

function sourceBetween(startMarker, endMarker) {
  const start = FUNCTIONS_SOURCE.indexOf(startMarker);
  const end = FUNCTIONS_SOURCE.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Unable to locate source between ${startMarker} and ${endMarker}.`);
  }
  return FUNCTIONS_SOURCE.slice(start, end);
}

function appSourceBetween(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  const end = APP_SOURCE.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Unable to locate App source between ${startMarker} and ${endMarker}.`);
  }
  return APP_SOURCE.slice(start, end);
}

describe("Commercial Change Authority callable integration", () => {
  test("exposes scoped simulation, sales handoff, admin authorization, state, and reconciliation", () => {
    for (const exportName of [
      "simulateCommercialQuoteChange",
      "requestCommercialQuoteChangeAuthorization",
      "getCommercialQuoteChangeAuthorizationState",
      "authorizeCommercialQuoteChange",
      "reconcileCommercialQuoteChangeApplyOutcome",
      "getCommercialDependencyState",
      "reconcileCommercialDependencyState"
    ]) {
      expect(FUNCTIONS_SOURCE).toContain(`exports.${exportName} =`);
    }

    const simulation = sourceBetween(
      "exports.simulateCommercialQuoteChange =",
      "exports.requestCommercialQuoteChangeAuthorization ="
    );
    expect(simulation).toContain("await assertStaff(context");
    expect(simulation).toContain("calculateQuotePricingAuthoritative({");
    expect(simulation).toContain("buildCommercialChangeImpactPreviewSnapshots({");
    expect(simulation).toContain("buildTrustedQuoteEditDocuments({");
    expect(simulation).toContain("commercialChangeAuthority.simulate({");
    expect(simulation).toContain("tx.create(receiptRef");
    expect(simulation).toContain("inventoryAuthorityRuntime.previewProjectedEventInventory({");
    expect(simulation).toContain("projectedVersion: result.projectedVersion");
    expect(simulation).toContain("outputRows: data.eventIngredientOutputs");
    expect(simulation).toContain('authority: "inventory_read_only_observation"');
    expect(simulation).toContain('state: "not_requested"');
    expect(simulation).toContain('state: "unavailable"');
    expect(simulation).toContain("inventoryObservation,");
    expect(simulation).toContain('data.staffingObservationVersion === "v1"');
    expect(simulation).toContain("tx.get(refs.staffingPlanRef)");
    expect(simulation).toContain("buildProjectedOperationalStaffingObservation({");
    expect(simulation).toContain("projectedVersion: projectedEditDocuments.version");
    expect(simulation).toContain('authority: "operational_staffing_read_only_observation"');
    expect(simulation).toContain("...(staffingObservation ? { staffingObservation } : {})");
    expect(simulation).toContain("simulation: projectCommercialChangeSimulation");
    expect(simulation).toContain("persistedEffects: projectCommercialChangePersistedEffects({");
    expect(simulation.indexOf("inventoryAuthorityRuntime.previewProjectedEventInventory({"))
      .toBeGreaterThan(simulation.indexOf("await db.runTransaction(async (tx) =>"));
    const receiptWrite = simulation.slice(
      simulation.indexOf("tx.create(receiptRef"),
      simulation.indexOf("coordinator?.commit()")
    );
    expect(receiptWrite).not.toContain("inventoryObservation");
    expect(receiptWrite).not.toContain("staffingObservation");

    const approvalRequest = sourceBetween(
      "exports.requestCommercialQuoteChangeAuthorization =",
      "exports.getCommercialQuoteChangeAuthorizationState ="
    );
    expect(approvalRequest).toContain("normalizeText(existing.requestId).toLowerCase() !== requestId");
    expect(approvalRequest).toContain("different request or immutable simulation evidence");

    const authorization = sourceBetween(
      "exports.authorizeCommercialQuoteChange =",
      "function commercialChangeDecisionMetadata"
    );
    expect(authorization).toContain("assertAdminStaff(await assertStaff");
    expect(authorization).toContain("assertCommercialChangeSimulationCurrent({");
    expect(authorization).toContain("commercialChangeAuthority.authorize({");
    expect(authorization).toContain('state: "authorized"');

    const outcome = sourceBetween(
      "exports.reconcileCommercialQuoteChangeApplyOutcome =",
      "function commercialChangeDecisionMetadata"
    );
    expect(outcome).toContain("commercialChangeAuthority.applyIdentity({");
    expect(outcome).toContain("tx.get(applyRef)");
    expect(outcome).toContain("tx.get(outcomeRef)");
    expect(outcome).toContain("commercialChangeAuthority.reconcileApplyOutcome({");
    expect(outcome).toContain("tx.create(outcomeRef");
    expect(outcome).toContain("projectCommercialChangeApplyCommit(applyReceipt)");
  });

  test("keeps enforcement server-dormant until both independent gates are true", () => {
    const policy = sourceBetween(
      "const COMMERCIAL_CHANGE_POLICY_VERSION",
      "function commercialChangeActor"
    );
    expect(policy).toContain("COMMERCIAL_CHANGE_AUTHORITY_ENABLED");
    expect(policy).toContain("globalEnabled && tenantEnabled");
    expect(policy).toContain('authorityState:');
    expect(policy).toContain('"dormant"');

    const update = sourceBetween(
      "async function updateTrustedQuoteDraftInternal",
      "function quoteCreationFailure"
    );
    expect(update).toContain('if (enforcement.authorityState === "enforced")');
    expect(update).toContain('enforcement.authorityState === "dormant"');
    expect(update).toContain("assertCommercialChangeSimulationCurrent({");
    expect(update).toContain("existingReceipt: existingSimulation");
    expect(update).toContain("persistCommercialChangeApply({");
    expect(update).toContain("tx.get(refs.applyOutcomesRef.doc(applyOutcomeIdentity.outcomeReceiptId))");
    expect(update).toContain("was reconciled as not committed and is permanently fenced");
    const persistence = sourceBetween(
      "function persistCommercialChangeApply",
      "async function updateTrustedQuoteDraftInternal"
    );
    expect(persistence).toContain('authorityState: "dormant"');
    expect(persistence).toContain('state: "DORMANT"');
    expect(persistence).toContain("safeToPublish: false");
  });

  test("independently re-simulates before atomically writing the edit, apply receipt, and invalidations", () => {
    const update = sourceBetween(
      "async function updateTrustedQuoteDraftInternal",
      "function quoteCreationFailure"
    );
    const simulationIndex = update.indexOf("commercialChangeAuthority.simulate({");
    const applyIndex = update.indexOf("commercialChangeAuthority.buildApply(");
    const quoteWriteIndex = update.indexOf("tx.update(quoteRef");
    expect(simulationIndex).toBeGreaterThan(-1);
    expect(applyIndex).toBeGreaterThan(simulationIndex);
    expect(quoteWriteIndex).toBeGreaterThan(applyIndex);
    expect(update).toContain("customerId: customerProjection.customerId");
    expect(update).toContain("eventDate: normalizeText(boundDocuments.quotePatch.event?.date)");
    const persistence = sourceBetween(
      "function persistCommercialChangeApply",
      "async function updateTrustedQuoteDraftInternal"
    );
    expect(persistence).toContain("tx.create(plan.applyRef");
    expect(persistence).toContain("plan.invalidationsRef.doc");
    expect(persistence).toContain('state: "open"');
    expect(persistence).toContain("invalidationSetComplete: true");
    expect(persistence).toContain("openInvalidationCount");
  });

  test("fences every trusted edit to the exact loaded quote revision before building write documents", () => {
    const update = sourceBetween(
      "async function updateTrustedQuoteDraftInternal",
      "function quoteCreationFailure"
    );
    const revisionReadIndex = update.indexOf(
      "quote.activeVersionId || quote.versionMeta?.versionId"
    );
    const revisionFailureIndex = update.indexOf(
      "This quote changed after the draft was opened"
    );
    const documentBuildIndex = update.indexOf("buildTrustedQuoteEditDocuments({");

    expect(update).toContain("expectedActiveVersionId = \"\"");
    expect(update).toContain("const expectedRevisionId = normalizeText(expectedActiveVersionId)");
    expect(revisionReadIndex).toBeGreaterThan(-1);
    expect(revisionFailureIndex).toBeGreaterThan(revisionReadIndex);
    expect(documentBuildIndex).toBeGreaterThan(revisionFailureIndex);

    const callable = sourceBetween(
      "exports.updateQuoteDraft =",
      "// Structured change-request record"
    );
    expect(callable).toContain("expectedActiveVersionId: data?.expectedActiveVersionId");
  });

  test("binds Quick Updates review to Commercial Change receipts and delegates save calculations", () => {
    const preview = appSourceBetween(
      "const handlePreviewQuickUpdate =",
      "const handleSaveQuickUpdate ="
    );
    expect(preview).toContain("simulateCommercialQuoteChange({");
    expect(preview).toContain('buildCommercialChangeRequestId("apply")');
    expect(preview).toContain("simulationReceiptId:");

    const save = appSourceBetween(
      "const handleSaveQuickUpdate =",
      "const handleOpenQuickUpdatesLibrary ="
    );
    expect(save).toContain("const commercialChangeAuthority = {");
    expect(save).toContain("simulationReceiptId:");
    expect(save).toContain("applyRequestId:");
    expect(save).toContain("!isFirebaseQuickUpdateSource()");
    expect(save).toContain('trim().toLowerCase() !== "draft"');
    expect(save).toContain("quickUpdatePersistedEffectsMatch(preview, candidate)");
    expect(save).toContain("const result = await handleSubmitQuote({");
    expect(save).toContain("commercialChangeAuthority,");
    expect(save).toContain("onPersistenceResolved:");
    expect(save).toContain("expectedActiveVersionId: candidate.baseRevisionId");
    expect(save).toContain('getQuoteById(result.id, { serverOnly: true })');
    expect(save).toContain('status: "persisted"');
    expect(save).not.toContain('status: "saved"');
    expect(save).not.toContain("calculateQuotePricing(");
    expect(save).not.toContain("calculateQuote(");
    expect(save).toContain('action: "reconcile_only"');

    const sharedSave = appSourceBetween(
      "const handleSubmitQuote =",
      "const quickUpdateFailure ="
    );
    expect(sharedSave).toContain("calculateQuote(submissionForm, catalog, effectiveSettings)");
    expect(sharedSave).toContain("calculateQuotePricing({");
    expect(sharedSave).toContain("updateQuote({");
    expect(sharedSave).toContain("onPersistenceResolved(result)");
  });

  test("reconciliation resolves exact open invalidations and updates completeness atomically", () => {
    const callable = sourceBetween(
      "exports.reconcileCommercialDependencyState =",
      "function normalizeCommercialChangeApplyEnvelope"
    );
    expect(callable).toContain("commercialChangeAuthority.reconcile({");
    expect(callable).toContain('state: "resolved"');
    expect(callable).toContain("resolutionReceiptId: planned.receipt.receiptId");
    expect(callable).toContain("evidenceId:");
    expect(callable).toContain("tx.update(refs.dependencyStateRef");
    expect(callable).toContain("openInvalidationCount");
    expect(callable).toContain("Generate a current Kitchen BEO");
    expect(callable).toContain("noArtifactEvidence(");
    expect(callable).toContain("const requestFingerprint = commercialReconciliationRequestFingerprint({");
    expect(callable).toContain("reconciliationSnap.data()?.requestFingerprint");
    expect(callable).toContain("requestFingerprint,");
    expect(callable).toContain("resolutionNote");
  });

  test("keeps every authority collection and the tenant promotion setting browser-denied", () => {
    for (const collectionName of [
      "commercialChangeSimulations",
      "commercialChangeApprovalRequests",
      "commercialChangeAuthorizations",
      "commercialChangeApplyReceipts",
      "commercialChangeApplyOutcomes",
      "commercialChangeReconciliationReceipts",
      "commercialDependencyState"
    ]) {
      expect(RULES_SOURCE).toContain(`/${collectionName}/`);
    }
    expect(RULES_SOURCE).toMatch(
      /match \/organizations\/\{orgId\}\/commercialChangeSimulations\/\{receiptId\}[\s\S]*?allow read, write: if false;/u
    );
    expect(RULES_SOURCE).toContain('"commercialChangeAuthorityEnabled"');
  });
});
