"use strict";

// Offline observations only. No credentials, transport, writes, clock, or apply path.
const phase = require("../functions/eventOperations");
const adapter = require("../functions/eventWorkflowAdapter");
const execution = require("../functions/workflowExecution");
const definitions = require("../functions/workflowDefinitions");
const MAX_EVENTS = 200;
const PHASE_ABSENCE = ["phaseReceipts", "workState", "workReceipts", "actualsState", "actualsReceipts"];
const STATUSES = ["fresh_candidate", "legacy_compatibility_only", "retained_bound_pin", "blocked"];
const fail = (reason) => { throw Object.assign(new Error("Inventory input or private evidence did not verify."), { inventoryReason: reason }); };
const exact = (value, fields) => { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) fail("invalid_shape"); };
const identifier = (value) => typeof value === "string" && /^[^\s/?#\\\u0000]{1,180}$/u.test(value) && ![".", ".."].includes(value);
const instant = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const day = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && instant(`${value}T00:00:00.000Z`);
const same = (a, b) => execution.digest(a) === execution.digest(b);
const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function observationTime(value, evaluatedAtISO) { if (!instant(value) || value > evaluatedAtISO) fail("invalid_observation_time"); }
function evidenceTime(observedAtISO, ...values) { if (values.some((value) => value && (!instant(value) || value > observedAtISO))) fail("observation_precedes_evidence"); }
function absence(value, fields) { exact(value, fields); if (fields.some((field) => !["empty", "present", "not_observed"].includes(value[field]))) fail("invalid_absence_observation"); }
function requireEmpty(value, fields) { if (fields.some((field) => value[field] === "present")) fail("orphan_history"); if (fields.some((field) => value[field] !== "empty")) fail("absence_not_observed"); }
function authorityReason(input) {
  const a = input.authority;
  const commercialFields = input.schemaVersion === 2 ? ["commercialAuthorityServerEnabled", "commercialAuthorityTenantEnabled"] : [];
  exact(a, [...commercialFields, "organizationId", "principalOrganizationId", "role", "currentRole", "emailVerified", "organizationActive", "serverEnabled", "tenantEnabled", "browserEnabled", "observedAtISO"]);
  observationTime(a.observedAtISO, input.evaluatedAtISO);
  if ([...commercialFields, "emailVerified", "organizationActive", "serverEnabled", "tenantEnabled", "browserEnabled"].some((field) => typeof a[field] !== "boolean")) fail("invalid_authority_observation");
  if (a.organizationId !== input.organizationId || a.principalOrganizationId !== input.organizationId) return "cross_tenant_authority";
  if (a.role !== "admin" || a.currentRole !== "admin") return "current_admin_required";
  if (!a.emailVerified || !a.organizationActive) return "inactive_or_unverified_authority";
  if (!a.serverEnabled || !a.tenantEnabled || !a.browserEnabled) return "rollout_gate_disabled";
  return "";
}
function currentConfiguration(input) {
  const c = input.configuration;
  exact(c, ["head", "receipt", "activeVersion", "absence", "observedAtISO"]);
  observationTime(c.observedAtISO, input.evaluatedAtISO);
  absence(c.absence, ["versions", "lifecycleReceipts"]);
  if (!c.head) requireEmpty(c.absence, ["versions", "lifecycleReceipts"]);
  const snapshot = definitions.projectDefinitionSnapshot({ organizationId: input.organizationId, head: c.head, currentReceipt: c.receipt, activeVersion: c.activeVersion });
  if (snapshot.availability !== "available") fail("unsupported_definition_schema");
  evidenceTime(c.observedAtISO, snapshot.updatedAtISO, snapshot.activeVersion?.publishedAtISO);
  if (!snapshot.newInstanceEligible) fail("definition_retired");
  if (![1, 2].includes(snapshot.activeVersion.schemaVersion) || snapshot.activeVersion.config.schemaVersion !== snapshot.activeVersion.schemaVersion) fail("unsupported_definition_schema");
  return { snapshot, expectedHeadDigest: execution.digest(c.head), expectedHeadRevision: snapshot.revision, targetDefinitionPin: definitions.definitionPin(snapshot.activeVersion) };
}
function inspectEvent(input, entry, globalReason) {
  exact(entry, ["quoteId", "sourceQuote", "sourceVersion", "acceptanceReceiptDocument", "phase", "workflow", "observedAtISO"]);
  if (!identifier(entry.quoteId)) fail("invalid_quote_id");
  const row = { quoteId: entry.quoteId, classification: "blocked", reasonCode: "", source: null, expectedObservations: null };
  try {
    observationTime(entry.observedAtISO, input.evaluatedAtISO);
    if (globalReason) fail(globalReason);
    if (!input.cohort.quoteIds.includes(entry.quoteId)) fail("outside_explicit_cohort");
    if (!entry.sourceQuote || !entry.sourceVersion || !entry.acceptanceReceiptDocument) fail("missing_source_fact");
    const source = phase.resolveSource({ organizationId: input.organizationId, quoteId: entry.quoteId, sourceQuote: entry.sourceQuote, sourceVersion: entry.sourceVersion, acceptanceReceiptDocument: entry.acceptanceReceiptDocument });
    row.source = Object.fromEntries(["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"].map((field) => [field, source[field]]));
    evidenceTime(entry.observedAtISO, source.acceptedAtISO, source.bookedAtISO);
    exact(entry.phase, ["ledger", "receipt", "absence"]); exact(entry.workflow, ["instance", "receipt", "publishedVersion", "absence"]);
    absence(entry.phase.absence, PHASE_ABSENCE); absence(entry.workflow.absence, ["receipts"]);
    if (entry.phase.ledger?.schemaVersion !== undefined && entry.phase.ledger.schemaVersion !== 1 || entry.workflow.instance?.schemaVersion !== undefined && ![1, 2].includes(entry.workflow.instance.schemaVersion)) fail("unsupported_instance_schema");
    row.expectedObservations = { observedAtISO: entry.observedAtISO, sourceDigest: execution.digest({ quote: entry.sourceQuote, version: entry.sourceVersion, acceptance: entry.acceptanceReceiptDocument }), phase: null, workflow: null };
    if (!entry.phase.ledger) {
      if (entry.phase.receipt || entry.workflow.instance || entry.workflow.receipt || entry.workflow.publishedVersion) fail("orphan_history");
      requireEmpty(entry.phase.absence, PHASE_ABSENCE); requireEmpty(entry.workflow.absence, ["receipts"]);
      const eventDate = entry.sourceVersion.snapshot?.event?.date;
      if (!day(eventDate)) fail("event_date_unavailable");
      if (eventDate < input.evaluatedAtISO.slice(0, 10) || eventDate < input.cohort.startsOn || eventDate > input.cohort.endsOn) fail("outside_future_pilot_window");
      const config = currentConfiguration(input);
      row.classification = "fresh_candidate"; row.reasonCode = "exact_source_no_observed_history";
      row.expectedObservations.configuration = { observedAtISO: input.configuration.observedAtISO, headDigest: config.expectedHeadDigest, headRevision: config.expectedHeadRevision, headReceiptId: config.snapshot.lastReceiptId, definitionPin: config.targetDefinitionPin };
      row.expectedObservations.absence = { phase: { ...entry.phase.absence }, workflow: { ...entry.workflow.absence } };
      return row;
    }
    const ref = adapter.phaseReference(source, entry.phase.ledger, entry.phase.receipt, entry.workflow.instance?.schemaVersion || 1);
    evidenceTime(entry.observedAtISO, entry.phase.ledger.updatedAtISO, entry.phase.receipt.recordedAtISO);
    row.expectedObservations.phase = { ledgerId: entry.phase.ledger.ledgerId, ...ref };
    if (!entry.workflow.instance) {
      if (entry.workflow.receipt || entry.workflow.publishedVersion) fail("orphan_history");
      requireEmpty(entry.workflow.absence, ["receipts"]);
      row.classification = "legacy_compatibility_only"; row.reasonCode = "existing_phase_stays_unbound";
      return row;
    }
    const instance = entry.workflow.instance;
    execution.verifyInstance(adapter.eventSource(source, instance.schemaVersion), instance, entry.workflow.receipt);
    if (!same(instance.domainRef, ref)) fail("phase_workflow_reference_mismatch");
    if (![1, 2].includes(instance.definition?.schemaVersion) || instance.definition?.config?.schemaVersion !== instance.definition?.schemaVersion) fail("unsupported_definition_schema");
    const definition = definitions.validatePublishedVersion(instance.definition);
    if (!definition.seed) {
      const published = definitions.validatePublishedVersion(entry.workflow.publishedVersion, { allowSeed: false });
      if (published.organizationId !== input.organizationId || !same(published, definition)) fail("pinned_publication_mismatch");
    } else if (entry.workflow.publishedVersion && !same(entry.workflow.publishedVersion, definition)) fail("pinned_publication_mismatch");
    evidenceTime(entry.observedAtISO, instance.updatedAtISO, entry.workflow.receipt.recordedAtISO, definition.publishedAtISO);
    row.expectedObservations.workflow = { instanceId: instance.instanceId, revision: instance.revision, receiptId: instance.lastReceiptId, receiptDigest: entry.workflow.receipt.receiptDigest, definitionPin: definitions.definitionPin(definition) };
    row.classification = "retained_bound_pin"; row.reasonCode = "verified_existing_binding_unchanged";
    // Existing bindings are valid independently of today's head/retirement.
    // A migration preview remains advisory and is never a command authorization.
    try {
      const config = currentConfiguration(input);
      if (!same(config.targetDefinitionPin, definitions.definitionPin(definition))) {
        const preview = execution.previewMigration({ source: instance.source, instance, currentReceipt: entry.workflow.receipt, targetDefinition: config.snapshot.activeVersion });
        row.migrationObservation = { availability: "available", compatible: preview.compatible, reasons: [...preview.reasons], targetDefinitionPin: preview.targetDefinitionPin, previewDigest: preview.previewDigest };
      }
    } catch { row.migrationObservation = { availability: "unavailable", reasonCode: "current_target_not_verified" }; }
    return row;
  } catch (error) {
    row.classification = "blocked"; row.reasonCode = error.inventoryReason || "private_evidence_invalid";
    return row;
  }
}
function buildInventory(input) {
  if (input?.schemaVersion === 2) return buildPackInventory(input);
  exact(input, ["schemaVersion", "organizationId", "evaluatedAtISO", "evidenceClass", "cohort", "authority", "configuration", "events"]);
  if (input.schemaVersion !== 1 || !identifier(input.organizationId) || !instant(input.evaluatedAtISO) || !["local_fixture", "tenant_read_only_export"].includes(input.evidenceClass)) fail("invalid_inventory_context");
  exact(input.cohort, ["cohortId", "quoteIds", "startsOn", "endsOn"]);
  if (!identifier(input.cohort.cohortId) || !Array.isArray(input.cohort.quoteIds) || !input.cohort.quoteIds.length || input.cohort.quoteIds.length > MAX_EVENTS || input.cohort.quoteIds.some((id) => !identifier(id)) || new Set(input.cohort.quoteIds).size !== input.cohort.quoteIds.length || !day(input.cohort.startsOn) || !day(input.cohort.endsOn) || input.cohort.startsOn > input.cohort.endsOn) fail("invalid_explicit_cohort");
  if (!Array.isArray(input.events) || input.events.length > MAX_EVENTS || new Set(input.events.map((event) => event?.quoteId)).size !== input.events.length) fail("invalid_event_inventory");
  const globalReason = authorityReason(input);
  const rows = input.events.map((entry) => inspectEvent(input, entry, globalReason)).sort((a, b) => a.quoteId.localeCompare(b.quoteId));
  for (const quoteId of input.cohort.quoteIds) if (!rows.some((row) => row.quoteId === quoteId)) rows.push({ quoteId, classification: "blocked", reasonCode: "cohort_source_not_supplied", source: null, expectedObservations: null });
  rows.sort((a, b) => a.quoteId.localeCompare(b.quoteId));
  return freeze({ schemaVersion: 1, reportKind: "event_workflow_migration_inventory", workflowKind: "event_execution", organizationId: input.organizationId, evaluatedAtISO: input.evaluatedAtISO,
    evidenceClass: input.evidenceClass, inputDigest: execution.digest(input), cohort: { cohortId: input.cohort.cohortId, startsOn: input.cohort.startsOn, endsOn: input.cohort.endsOn },
    advisory: true, appliesChanges: false, initializesEvents: false, sourceFactsVerifiedOnlyFromSuppliedDocuments: true,
    initializationBoundary: "The current initialize API binds the active definition inside its transaction. Recheck source, current role, all rollout gates and absence there; this inventory cannot authorize or pin an initialization. Record the actual resulting definition pin and receipt.",
    unverifiedEvidence: ["live_tenant_authority", "hosted_behavior", "operator_acceptance", "provider_outcomes", "customer_outcomes", "historical_task_completion", "work_and_actuals_journal_contents"],
    authorityObservation: { observedAtISO: input.authority.observedAtISO,
      inventoryRoleAuthorized: input.authority.role === "admin" && input.authority.currentRole === "admin",
      tenantMatched: input.authority.organizationId === input.organizationId && input.authority.principalOrganizationId === input.organizationId,
      emailVerified: input.authority.emailVerified, organizationActive: input.authority.organizationActive,
      serverEnabled: input.authority.serverEnabled, tenantEnabled: input.authority.tenantEnabled, browserEnabled: input.authority.browserEnabled },
    counts: Object.fromEntries(STATUSES.map((status) => [status, rows.filter((row) => row.classification === status).length])), rows });
}
module.exports = { buildInventory, MAX_EVENTS };

// Schema two is an explicit multi-pack observation set. It never upgrades a
// schema-one event or creates coordinator history for an existing domain record.
const packs = require("../functions/workflowPackAdapters");
const attendance = require("../functions/quoteAttendance");
const PACK_KINDS = ["quote_review", "final_guest_count", "event_execution", "closeout_follow_up"];
const quoteAuthority = require("../functions/commercialChangeAuthority").createCommercialChangeAuthority({
  graphCore: require("../src/lib/commercialDependencyGraphCore.cjs"),
  buildPreviewSnapshots: () => fail("offline_mutation_forbidden"),
  simulateImpact: () => fail("offline_mutation_forbidden")
});
function pinnedDefinition(entry, organizationId) {
  const value = definitions.validatePublishedVersion(entry.workflow.publishedVersion, { allowSeed: false, workflowKind: entry.workflowKind });
  if (value.schemaVersion !== 2 || value.organizationId !== organizationId) fail("pinned_publication_mismatch");
  return value;
}
function nativeObservation(input, entry, definition) {
  const proof = entry.domainProof;
  exact(proof, ["sourceQuote", "sourceVersion", "acceptanceReceiptDocument", "native"]);
  if (entry.workflowKind === "quote_review") {
    exact(proof.native, ["simulationReceipt", "authorizationReceipt", "applyReceipt", ...(Object.hasOwn(proof.native, "attendanceProof") ? ["attendanceProof"] : []), ...(Object.hasOwn(proof.native, "simulationDefinition") ? ["simulationDefinition"] : [])]);
    const binding = proof.native.simulationReceipt?.attendanceBinding;
    if (binding) {
      const supplied = proof.native.attendanceProof;
      exact(supplied, ["sourceQuote", "sourceVersion", "acceptanceReceiptDocument", "submissionReceipt"]);
      const accepted = attendance.resolveAcceptedSource({ organizationId: input.organizationId, quoteId: entry.quoteId, ...supplied });
      const submission = attendance.submissionReference(supplied.submissionReceipt);
      const expected = Object.fromEntries(["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"].map((key) => [key, accepted[key]]));
      Object.assign(expected, { submissionReceiptId: submission.submissionReceiptId, submissionReceiptDigest: submission.receiptDigest, count: submission.count });
      if (!same(expected, binding) || !same(supplied.submissionReceipt.source, { ...Object.fromEntries(["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"].map((key) => [key, accepted[key]])), pricedCount: supplied.sourceVersion.snapshot?.event?.guests })
        || submission.submittedAtISO > proof.native.simulationReceipt.simulatedAtISO) fail("attendance_binding_mismatch");
    } else if (proof.native.attendanceProof) fail("unbound_attendance_evidence");
    const originDefinition = proof.native.simulationDefinition
      ? definitions.validatePublishedVersion(proof.native.simulationDefinition, { allowSeed: false, workflowKind: "quote_review" }) : definition;
    const observed = packs.quoteObservation({ authority: quoteAuthority, ...proof.native, definition: originDefinition });
    const quote = proof.sourceQuote, version = proof.sourceVersion;
    const currentVersion = proof.native.applyReceipt?.newRevisionId || observed.source.sourceVersionId;
    if (!quote || quote.organizationId !== input.organizationId || quote.id !== entry.quoteId
      || quote.activeVersionId !== currentVersion || !version || version.versionId !== observed.source.sourceVersionId
      || version.organizationId && version.organizationId !== input.organizationId
      || version.quoteId && version.quoteId !== entry.quoteId) fail("current_source_mismatch");
    return { ...observed, nativeDefinitionPin: definitions.definitionPin(originDefinition) };
  }
  const accepted = (entry.workflowKind === "final_guest_count" ? attendance.resolveAcceptedSource : phase.resolveSource)({ organizationId: input.organizationId, quoteId: entry.quoteId, ...proof });
  evidenceTime(entry.observedAtISO, proof.sourceQuote.acceptanceReceipt?.acceptedAtISO, proof.sourceQuote.booking?.bookedAtISO);
  if (entry.workflowKind === "event_execution") {
    exact(proof.native, ["ledger", "receipt"]);
    return packs.eventObservation({ source: accepted, ...proof.native });
  }
  if (entry.workflowKind === "final_guest_count") {
    exact(proof.native, ["state", "receipt"]);
    const source = attendance.normalizeSource({ organizationId: accepted.organizationId, quoteId: accepted.quoteId,
      sourceVersionId: accepted.sourceVersionId, acceptanceReceiptId: accepted.acceptanceReceiptId,
      pricedCount: proof.sourceVersion.snapshot?.event?.guests });
    // Historical customer actors are verified receipt provenance, not a claim
    // that a supplied portal credential is currently authorized.
    attendance.verifyReceipt(proof.native.receipt);
    const receipt = proof.native.receipt;
    return packs.attendanceObservation({ source, state: proof.native.state, receipt,
      portalIdentity: receipt.actor.role === "customer" ? receipt.actor : null });
  }
  exact(proof.native, ["observationProof"]);
  const observedProof = packs.verifyCloseoutObservationProof(proof.native.observationProof);
  if (!same(observedProof.domainSource, accepted)) fail("accepted_closeout_source_mismatch");
  return packs.closeoutObservation({ proof: observedProof, definition });
}
function inspectPack(input, entry, globalReason) {
  exact(entry, ["workflowKind", "quoteId", "domainProof", "workflow", "observedAtISO"]);
  if (!PACK_KINDS.includes(entry.workflowKind) || !identifier(entry.quoteId)) fail("invalid_pack_identity");
  const row = { workflowKind: entry.workflowKind, quoteId: entry.quoteId, classification: "blocked", reasonCode: "", source: null, expectedObservations: null };
  try {
    observationTime(entry.observedAtISO, input.evaluatedAtISO);
    if (globalReason) fail(globalReason);
    if (entry.workflowKind === "quote_review" && (!input.authority.commercialAuthorityServerEnabled || !input.authority.commercialAuthorityTenantEnabled)) fail("commercial_authority_gate_disabled");
    if (entry.workflowKind === "final_guest_count") row.commercialApplyGateObservation = {
      serverEnabled: input.authority.commercialAuthorityServerEnabled, tenantEnabled: input.authority.commercialAuthorityTenantEnabled,
      allRequiredGatesObservedEnabled: input.authority.commercialAuthorityServerEnabled && input.authority.commercialAuthorityTenantEnabled,
      authorizesApply: false, boundary: "Requested or recorded counts remain separate from the exact authorized commercial apply command." };
    if (!input.cohort.subjects.some((s) => s.workflowKind === entry.workflowKind && s.quoteId === entry.quoteId)) fail("outside_explicit_cohort");
    exact(entry.workflow, ["instance", "receipt", "publishedVersion", "absence"]);
    absence(entry.workflow.absence, ["receipts", "observations"]);
    const instance = entry.workflow.instance;
    if (instance && instance.schemaVersion !== 2) fail("unsupported_instance_schema");
    if (!instance && entry.workflow.receipt) fail("orphan_history");
    const definition = pinnedDefinition(entry, input.organizationId);
    const observed = nativeObservation(input, entry, definition);
    if (observed.source.organizationId !== input.organizationId || observed.source.subjectId !== entry.quoteId) fail("cross_tenant_source");
    evidenceTime(entry.observedAtISO, observed.domainRef.recordedAtISO, definition.publishedAtISO);
    row.source = observed.source;
    row.expectedObservations = { observedAtISO: entry.observedAtISO, sourceDigest: execution.digest(entry.domainProof),
      domainRef: observed.domainRef, definitionPin: definitions.definitionPin(definition), workflow: null,
      ...(observed.nativeDefinitionPin ? { nativeDefinitionPin: observed.nativeDefinitionPin } : {}) };
    if (!instance) {
      requireEmpty(entry.workflow.absence, ["receipts", "observations"]);
      row.classification = "legacy_compatibility_only"; row.reasonCode = "existing_domain_evidence_stays_unbound";
      return row;
    }
    execution.verifyInstance(observed.source, instance, entry.workflow.receipt);
    if (!same(instance.domainRef, observed.domainRef)) fail("domain_workflow_reference_mismatch");
    if (!same(instance.definition, definition) || !same(instance.definitionPin, definitions.definitionPin(definition))) fail("pinned_publication_mismatch");
    evidenceTime(entry.observedAtISO, instance.updatedAtISO, entry.workflow.receipt.recordedAtISO);
    row.expectedObservations.workflow = { instanceId: instance.instanceId, revision: instance.revision,
      receiptId: instance.lastReceiptId, receiptDigest: entry.workflow.receipt.receiptDigest };
    row.classification = "retained_bound_pin"; row.reasonCode = "verified_existing_binding_unchanged";
    // Today's active head is intentionally irrelevant to an immutable binding.
    return row;
  } catch (error) { row.classification = "blocked"; row.reasonCode = error.inventoryReason || "private_evidence_invalid"; return row; }
}
function buildPackInventory(input) {
  exact(input, ["schemaVersion", "organizationId", "evaluatedAtISO", "evidenceClass", "cohort", "authority", "entries"]);
  if (!identifier(input.organizationId) || !instant(input.evaluatedAtISO) || !["local_fixture", "tenant_read_only_export"].includes(input.evidenceClass)) fail("invalid_inventory_context");
  exact(input.cohort, ["cohortId", "subjects"]);
  if (!identifier(input.cohort.cohortId) || !Array.isArray(input.cohort.subjects) || !input.cohort.subjects.length || input.cohort.subjects.length > MAX_EVENTS) fail("invalid_explicit_cohort");
  const key = (s) => `${s.workflowKind}:${s.quoteId}`;
  for (const subject of input.cohort.subjects) { exact(subject, ["workflowKind", "quoteId"]); if (!PACK_KINDS.includes(subject.workflowKind) || !identifier(subject.quoteId)) fail("invalid_explicit_cohort"); }
  if (new Set(input.cohort.subjects.map(key)).size !== input.cohort.subjects.length || !Array.isArray(input.entries) || input.entries.length > MAX_EVENTS || new Set(input.entries.map(key)).size !== input.entries.length) fail("invalid_pack_inventory");
  const reason = authorityReason(input);
  const rows = input.entries.map((entry) => inspectPack(input, entry, reason));
  for (const subject of input.cohort.subjects) if (!rows.some((row) => key(row) === key(subject))) rows.push({ ...subject, classification: "blocked", reasonCode: "cohort_source_not_supplied", source: null, expectedObservations: null });
  rows.sort((a, b) => key(a).localeCompare(key(b)));
  return freeze({ schemaVersion: 2, reportKind: "event_workflow_migration_inventory", organizationId: input.organizationId,
    evaluatedAtISO: input.evaluatedAtISO, evidenceClass: input.evidenceClass, inputDigest: execution.digest(input), cohort: structuredClone(input.cohort),
    advisory: true, appliesChanges: false, initializesEvents: false, sourceFactsVerifiedOnlyFromSuppliedDocuments: true,
    initializationBoundary: "Native owner evidence is retained without inventing coordinator history. Fresh event eligibility remains the separate exact-source event inventory with validated V1 or V2 publication. Recheck live source, roles, gates and actual resulting definition pin in the existing owner transaction.",
    unverifiedEvidence: ["live_tenant_authority", "current_portal_authorization", "hosted_behavior", "operator_acceptance", "provider_outcomes", "customer_outcomes", "historical_task_completion", "actual_attendance", "work_and_actuals_journal_contents"],
    counts: Object.fromEntries(STATUSES.map((status) => [status, rows.filter((row) => row.classification === status).length])), rows });
}
