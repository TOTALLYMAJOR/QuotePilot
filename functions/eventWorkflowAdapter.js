"use strict";

const phase = require("./eventOperations");
const actuals = require("./eventOperatingActuals");
const execution = require("./workflowExecution");
const packs = require("./workflowPackAdapters");
function eventSource(source, schemaVersion = 1) {
  if (schemaVersion === 2) return packs.acceptedSource(source, "event_execution");
  // Reuse the established exact accepted-source identifier validation.
  phase.ledgerIdFor(source);
  return execution.normalizeSource({ organizationId: source.organizationId, workflowKind: "event_execution",
    subjectId: source.quoteId, sourceVersionId: source.sourceVersionId, sourceReceiptId: source.acceptanceReceiptId });
}
function phaseReference(source, ledger, receipt, schemaVersion = 1) {
  if (schemaVersion === 2) return packs.eventObservation({ source, ledger, receipt }).domainRef;
  if (!ledger && receipt) throw new phase.EventOperationsError("data-loss", "Phase history exists without its current ledger.");
  const snapshot = phase.projectSnapshot(source, ledger, receipt);
  if (snapshot.availability !== "available") throw new phase.EventOperationsError("failed-precondition", "An initialized trusted phase receipt is required.");
  return { kind: "event_phase", revision: snapshot.revision, receiptId: snapshot.lastReceiptId,
    policyDigest: snapshot.policyDigest, receiptDigest: receipt.receiptDigest };
}
function actualsReference(source, state, receipt) {
  if (!state && receipt) throw new phase.EventOperationsError("data-loss", "Actuals history exists without its current state.");
  const snapshot = actuals.projectSnapshot({ source, actualsState: state, receipt });
  if (snapshot.availability !== "available" || snapshot.captureComplete !== true) return null;
  return { revision: snapshot.revision, receiptId: snapshot.lastReceiptId,
    receiptDigest: receipt.receiptDigest, totalCostCents: snapshot.totals.totalCostCents };
}
function planEventCommand({ request, actor, source, ledger = null, phaseCurrentReceipt = null,
  phaseExistingReceipt = null, instance = null, workflowCurrentReceipt = null,
  workflowExistingReceipt = null, definition = null, workState = null, workReceipt = null, nowISO }) {
  const schemaVersion = workflowExistingReceipt?.schemaVersion || instance?.schemaVersion || definition?.schemaVersion || 1;
  if (schemaVersion === 2 && !phaseExistingReceipt && request.command === "transition") {
    packs.assertEventConstraints({ source, definition: instance.definition, ledger, phaseReceipt: phaseCurrentReceipt, workState, workReceipt, command: request });
  }
  if (!phaseExistingReceipt && ledger) phase.projectSnapshot(source, ledger, phaseCurrentReceipt);
  const phasePlan = phase.planCommand({ request, actor, source, ledger, existingReceipt: phaseExistingReceipt, nowISO });
  const phaseResult = phasePlan.nextLedger || phasePlan.receipt.resultLedger;
  const exactSource = eventSource(request, schemaVersion);
  const domainRef = phaseReference(request, phaseResult, phasePlan.receipt, schemaVersion);
  if ((phasePlan.idempotent && instance && !workflowExistingReceipt)
    || (!phasePlan.idempotent && workflowExistingReceipt)
    || (!instance && workflowCurrentReceipt && !workflowExistingReceipt)) {
    throw new phase.EventOperationsError("data-loss", "Phase and workflow command receipts are not an atomic pair.");
  }
  // Existing legacy phase ledgers remain explicitly unbound, including historical retry.
  if (!instance && !workflowExistingReceipt && request.command !== "initialize") {
    if (workflowCurrentReceipt || workflowExistingReceipt) throw new phase.EventOperationsError("data-loss", "Workflow receipts exist without their instance.");
    return { phasePlan, workflowPlan: null, bindingStatus: "legacy_unbound" };
  }
  if (phasePlan.idempotent && !instance && !workflowExistingReceipt) {
    return { phasePlan, workflowPlan: null, bindingStatus: "legacy_unbound" };
  }
  const workflowPlan = execution.planCommand({ source: exactSource,
    request: { requestId: request.requestId, command: request.command === "initialize" ? "initialize" : "observe_domain",
      expectedRevision: workflowExistingReceipt?.request.expectedRevision ?? (instance?.revision || 0) },
    actor, instance, currentReceipt: workflowCurrentReceipt, existingReceipt: workflowExistingReceipt,
    definition: request.command === "initialize" ? definition : null, domainRef,
    ...(schemaVersion === 2 ? { scheduleAnchor: request.command === "initialize" ? { kind: "instant", atISO: phaseResult.createdAtISO } : null } : {}), nowISO, internal: true });
  if (execution.digest(workflowPlan.receipt.domainRef) !== execution.digest(domainRef)) {
    throw new phase.EventOperationsError("data-loss", "Workflow and phase receipts do not identify the same trusted outcome.");
  }
  return { phasePlan, workflowPlan, bindingStatus: "configured" };
}
module.exports = { eventSource, phaseReference, actualsReference, planEventCommand };
