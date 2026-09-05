import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { declaredActualsFixture } from "../../../evidence/testing/buildFixtures.mjs";
const require = createRequire(import.meta.url);
const { buildInventory } = require("../../../scripts/event-workflow-migration-inventory-core.cjs");
const definitions = require("../../../functions/workflowDefinitions.js");
const adapter = require("../../../functions/eventWorkflowAdapter.js");
const sourceFixture = () => declaredActualsFixture();
const TIME = "2026-09-06T12:00:00.000Z";
function fixture(kind = "fresh") {
  const base = sourceFixture();
  const organizationId = base.proof.organizationId;
  const input = { schemaVersion: 1, organizationId, evaluatedAtISO: TIME, evidenceClass: "local_fixture",
    cohort: { cohortId: "explicit-local-cohort", quoteIds: [base.proof.quoteId], startsOn: "2026-09-06", endsOn: "2026-12-31" },
    authority: { organizationId, principalOrganizationId: organizationId, role: "admin", currentRole: "admin", emailVerified: true, organizationActive: true, serverEnabled: true, tenantEnabled: true, browserEnabled: true, observedAtISO: TIME },
    configuration: { head: null, receipt: null, activeVersion: null, absence: { versions: "empty", lifecycleReceipts: "empty" }, observedAtISO: TIME },
    events: [{ quoteId: base.proof.quoteId, sourceQuote: base.record.quote, sourceVersion: base.record.quoteVersion, acceptanceReceiptDocument: base.record.acceptanceReceipt,
      phase: { ledger: null, receipt: null, absence: { phaseReceipts: "empty", workState: "empty", workReceipts: "empty", actualsState: "empty", actualsReceipts: "empty" } },
      workflow: { instance: null, receipt: null, publishedVersion: null, absence: { receipts: "empty" } }, observedAtISO: TIME }] };
  const entry = input.events[0];
  if (kind !== "fresh") {
    const planned = adapter.planEventCommand({ source: base.proof, request: base.phase.receipt.request, actor: base.actor, definition: definitions.seedPublishedVersion(), nowISO: "2026-09-05T12:00:00.000Z" });
    entry.phase.ledger = planned.phasePlan.nextLedger; entry.phase.receipt = planned.phasePlan.receipt;
    if (kind === "bound") { entry.workflow.instance = planned.workflowPlan.nextInstance; entry.workflow.receipt = planned.workflowPlan.receipt; }
  }
  return input;
}
const row = (input) => buildInventory(input).rows[0];
function publish(input, name = "Explicit tenant coordination") {
  const actor = { organizationId: input.organizationId, uid: "private-publisher", role: "admin" };
  const config = { ...structuredClone(definitions.seedPublishedVersion().config), name };
  const request = { organizationId: input.organizationId, workflowKind: "event_execution", requestId: "inventory-save-draft-0001", expectedRevision: 0, command: "save_draft", config };
  const saved = definitions.planSaveDraft({ request, actor, nowISO: "2026-09-04T10:00:00.000Z" });
  const preview = definitions.previewPublish({ organizationId: input.organizationId, actor, head: saved.nextHead, currentReceipt: saved.receipt });
  const published = definitions.planPublish({ request: { organizationId: input.organizationId, workflowKind: "event_execution", requestId: "inventory-publish-0001", expectedRevision: 1, command: "publish", previewDigest: preview.previewDigest, confirmationText: preview.confirmationText }, actor, head: saved.nextHead, currentReceipt: saved.receipt, nowISO: "2026-09-04T10:01:00.000Z" });
  input.configuration = { ...input.configuration, head: published.nextHead, receipt: published.receipt, activeVersion: published.publishedVersion };
  return { actor, published };
}

describe("offline tenant operating model inventory", () => {
  test("inventory classifies fresh exact sources legacy compatibility and retained pins without writes", () => {
    for (const [kind, expected] of [["fresh", "fresh_candidate"], ["legacy", "legacy_compatibility_only"], ["bound", "retained_bound_pin"]]) {
      const input = fixture(kind), original = JSON.stringify(input), report = buildInventory(input);
      expect(report.rows[0].classification).toBe(expected);
      expect(report.appliesChanges).toBe(false); expect(report.initializesEvents).toBe(false); expect(report.advisory).toBe(true);
      expect(report.inputDigest).toMatch(/^[a-f0-9]{64}$/); expect(report).toEqual(buildInventory(input));
      expect(Object.isFrozen(report.rows[0])).toBe(true); expect(JSON.stringify(input)).toBe(original);
      expect(report.initializationBoundary).toContain("actual resulting definition pin");
    }
  });
  test("inventory requires explicit cohort future dates evaluation time and observed absence", () => {
    const missing = fixture(); missing.events = []; expect(row(missing).reasonCode).toBe("cohort_source_not_supplied");
    const outside = fixture(); outside.cohort.quoteIds = ["different-quote"]; expect(buildInventory(outside).rows.find((entry) => entry.quoteId === outside.events[0].quoteId).reasonCode).toBe("outside_explicit_cohort");
    const date = fixture(); date.cohort.endsOn = "2026-09-07"; expect(row(date).reasonCode).toBe("outside_future_pilot_window");
    const unknown = fixture(); unknown.events[0].phase.absence.actualsReceipts = "not_observed"; expect(row(unknown).reasonCode).toBe("absence_not_observed");
    const omitted = fixture(); delete omitted.events[0].phase.absence.workState; expect(row(omitted).classification).toBe("blocked");
    const futureObservation = fixture(); futureObservation.events[0].observedAtISO = "2026-09-07T12:00:00.000Z"; expect(row(futureObservation).reasonCode).toBe("invalid_observation_time");
  });
  test.each(["phaseReceipts", "workState", "workReceipts", "actualsState", "actualsReceipts"])("inventory blocks orphan %s instead of inventing initialization history", (path) => {
    const input = fixture(); input.events[0].phase.absence[path] = "present";
    expect(row(input)).toMatchObject({ classification: "blocked", reasonCode: "orphan_history" });
  });
  test("inventory detects missing workflow current state and missing configuration heads", () => {
    const input = fixture("bound"); input.events[0].workflow.instance = null; expect(row(input).reasonCode).toBe("orphan_history");
    const retained = fixture("legacy"); retained.events[0].workflow.absence.receipts = "present"; expect(row(retained).reasonCode).toBe("orphan_history");
    const config = fixture(); config.configuration.absence.versions = "present"; expect(row(config).reasonCode).toBe("orphan_history");
  });
  test.each(["sales", "customer", "operations", "finance_read", "owner"])("inventory denies unsupported or nonadmin current %s role", (role) => {
    const input = fixture(); input.authority.role = role; input.authority.currentRole = role;
    expect(row(input)).toMatchObject({ classification: "blocked", reasonCode: "current_admin_required" });
  });
  test("inventory requires current tenant role verified active authority and every rollout gate", () => {
    const revoked = fixture(); revoked.authority.currentRole = "sales"; expect(row(revoked).reasonCode).toBe("current_admin_required");
    const other = fixture(); other.authority.principalOrganizationId = "foreign"; expect(row(other).reasonCode).toBe("cross_tenant_authority");
    for (const field of ["serverEnabled", "tenantEnabled", "browserEnabled"]) { const input = fixture(); input.authority[field] = false; expect(row(input).reasonCode).toBe("rollout_gate_disabled"); }
    for (const field of ["emailVerified", "organizationActive"]) { const input = fixture(); input.authority[field] = false; expect(row(input).reasonCode).toBe("inactive_or_unverified_authority"); }
  });
  test.each(["source", "phase", "workflow", "schema"])("inventory fails closed on corrupt or unsupported %s proof", (kind) => {
    const input = fixture("bound");
    if (kind === "source") input.events[0].acceptanceReceiptDocument.snapshotSha256 = "0".repeat(64);
    if (kind === "phase") input.events[0].phase.receipt.receiptDigest = "0".repeat(64);
    if (kind === "workflow") input.events[0].workflow.receipt.receiptDigest = "0".repeat(64);
    if (kind === "schema") input.events[0].workflow.instance.schemaVersion = 2;
    expect(row(input).classification).toBe("blocked");
  });
  test("inventory reports exact published candidates but never rebases existing bindings", () => {
    const input = fixture("bound"); const { actor, published } = publish(input);
    const observed = row(input); expect(observed.classification).toBe("retained_bound_pin"); expect(observed.expectedObservations.workflow.definitionPin.version).toBe(0);
    expect(observed.migrationObservation).toMatchObject({ availability: "available", compatible: true, targetDefinitionPin: { version: 1 } });
    const retired = definitions.planRetire({ request: { organizationId: input.organizationId, workflowKind: "event_execution", requestId: "inventory-retire-version-0001", expectedRevision: 2, command: "retire", versionId: "event_execution_v1", reason: "Pause new events" }, actor, head: published.nextHead, currentReceipt: published.receipt, nowISO: "2026-09-04T10:02:00.000Z" });
    input.configuration = { ...input.configuration, head: retired.nextHead, receipt: retired.receipt, activeVersion: null };
    expect(row(input).classification).toBe("retained_bound_pin");
    const fresh = fixture(); fresh.configuration = input.configuration; expect(row(fresh).reasonCode).toBe("definition_retired");
    const candidate = fixture(); publish(candidate); expect(row(candidate).expectedObservations.configuration.definitionPin.version).toBe(1);
  });
  test("inventory validates independently stored pinned publication rather than trusting embedded config", () => {
    const input = fixture(); const { published } = publish(input); const base = sourceFixture();
    const planned = adapter.planEventCommand({ source: base.proof, request: base.phase.receipt.request, actor: base.actor, definition: published.publishedVersion, nowISO: "2026-09-05T12:00:00.000Z" });
    Object.assign(input.events[0].phase, { ledger: planned.phasePlan.nextLedger, receipt: planned.phasePlan.receipt });
    Object.assign(input.events[0].workflow, { instance: planned.workflowPlan.nextInstance, receipt: planned.workflowPlan.receipt, publishedVersion: published.publishedVersion });
    expect(row(input).classification).toBe("retained_bound_pin");
    input.events[0].workflow.publishedVersion = null; expect(row(input).classification).toBe("blocked");
  });
  test("inventory output allowlist hides private source receipt actor and task payloads", () => {
    const input = fixture("bound"); const report = buildInventory(input); const output = JSON.stringify(report);
    expect(output).not.toMatch(/"(?:sourceQuote|sourceVersion|proposalSnapshot|recordedBy|requestId|taskTemplates|publishedBy|priorInstance|resultInstance)":/);
    expect(output).not.toContain("actuals-fixture-operator"); expect(output).not.toContain("customer-fixture");
    expect(report.unverifiedEvidence).toContain("operator_acceptance"); expect(report.evidenceClass).toBe("local_fixture");
  });
  test("inventory CLI emits a deterministic offline artifact with no network credential or mutation path", () => {
    const directory = mkdtempSync(join(tmpdir(), "event-inventory-"));
    try {
      const file = join(directory, "input.json"); writeFileSync(file, JSON.stringify(fixture("legacy")));
      const result = JSON.parse(execFileSync(process.execPath, ["scripts/event-workflow-migration-inventory.mjs", "--input", file], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" }));
      expect(result.rows[0].classification).toBe("legacy_compatibility_only");
    } finally { rmSync(directory, { recursive: true }); }
    for (const path of ["scripts/event-workflow-migration-inventory-core.cjs", "scripts/event-workflow-migration-inventory.mjs"]) {
      const source = readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/firebase-admin|fetch\s*\(|process\.env|Date\.now\s*\(|new Date\(\)|writeFile|\.collection\s*\(|planCommand\s*\(/);
    }
  });
  test("inventory rejects duplicate or unbounded inputs instead of losing cohort rows", () => {
    const input = fixture(); input.events.push(structuredClone(input.events[0])); expect(() => buildInventory(input)).toThrow();
    const absent = fixture(); delete absent.evaluatedAtISO; expect(() => buildInventory(absent)).toThrow();
    const injected = fixture(); injected.run = "apply"; expect(() => buildInventory(injected)).toThrow();
  });
});

function pricing({ guests = 125, total = 12480, deposit = 3120 } = {}) {
  return {
    authority: "server_authoritative",
    pricingVersion: "pricing-v1",
    grandTotal: total,
    deposit: { amount: deposit },
    inputs: {
      event: {
        guests,
        servers: 4,
        chefs: 2,
        bartenders: 1,
        milesRT: 20,
        taxRegionId: "central",
        seasonProfileId: "summer"
      },
      selection: {
        package: { id: "buffet", quantity: 1 },
        addons: [{ id: "coffee", quantity: 1 }],
        rentals: [{ id: "chair", quantity: guests }],
        menuItems: [{ id: "chicken", quantity: 1 }]
      }
    },
    lineItems: [{
      id: "buffet",
      category: "package",
      pricingMode: "per_person",
      unitPrice: total / guests,
      quantity: guests
    }],
    rulesSnapshot: {
      pricingSettingsVersion: 3,
      pricingSettingsUpdatedAtISO: "2026-08-01T00:00:00.000Z",
      settingsSnapshot: { depositPct: 0.25 },
      seasonProfileId: "summer",
      packageMultiplier: 1,
      taxRegionId: "central",
      taxRateApplied: 0.09,
      travel: { milesRT: 20 }
    }
  };
}

function canonicalQuote(overrides = {}) {
  return {
    id: source.quoteId,
    organizationId: source.organizationId,
    customerId: "customer-1",
    activeVersionId: source.sourceVersionId,
    status: "draft",
    event: {
      name: "Annual picnic",
      date: "2026-09-01",
      time: "12:00",
      venue: "North lawn",
      venueAddress: "1 Park Way",
      guests: 125,
      hours: 4,
      style: "Buffet",
      servers: 4,
      chefs: 2,
      bartenders: 1,
      dietaryRestrictions: "Vegetarian option"
    },
    pricing: pricing(),
    workflow: { quoteDelivery: { state: "idle" } },
    payment: { depositStatus: "unpaid" },
    booking: {},
    ...overrides
  };
}

function proposedForm(overrides = {}) {
  return {
    eventName: "Annual picnic",
    date: "2026-09-01",
    time: "12:00",
    venue: "North lawn",
    venueAddress: "1 Park Way",
    guests: 175,
    hours: 4,
    style: "Buffet",
    servers: 4,
    chefs: 2,
    bartenders: 1,
    dietaryRestrictions: "Vegetarian option",
    ...overrides
  };
}




const execution = require("../../../functions/workflowExecution");
const packs = require("../../../functions/workflowPackAdapters");
const attendance = require("../../../functions/quoteAttendance");
const closeout = require("../../../functions/postEventCloseout");
const phase = require("../../../functions/eventOperations");
import { simulateCommercialChangeImpact } from "../commercialChangeImpact";
const cca = require("../../../functions/commercialChangeAuthority").createCommercialChangeAuthority({
  graphCore: require("../commercialDependencyGraphCore.cjs"),
  buildPreviewSnapshots: require("../../../functions/commercialChangeImpactPreview").buildCommercialChangeImpactPreviewSnapshots,
  simulateImpact: simulateCommercialChangeImpact
});
const source = { organizationId: "org_demo", quoteId: "quote_demo_1", sourceVersionId: "rev_7", acceptanceReceiptId: "rcpt_demo_1" };
function packFixture(workflowKind, applied = false, linkedAttendance = false) {
  const old = fixture("legacy"), base = sourceFixture(), actor = base.actor;
  const accepted = phase.resolveSource({ organizationId: source.organizationId, quoteId: source.quoteId, sourceQuote: base.record.quote, sourceVersion: base.record.quoteVersion, acceptanceReceiptDocument: base.record.acceptanceReceipt });
  const policies = {
    event_execution: { phaseConstraints: { in_progress: { requiredCheckpoints: [], blockOpenUrgentIssues: false }, completed: { requiredCheckpoints: [], blockOpenUrgentIssues: false } }, checkpointPrerequisites: { venue_access: [], team_briefing: [], service_handoff: [], pack_down: [] } },
    final_guest_count: { responsibleRoles: ["admin", "sales"] },
    closeout_follow_up: { responsibleRoles: ["admin"], followUpOffsetDays: 3 },
    quote_review: { approval: { basis: "absolute_total_delta_cents", thresholdCents: 0, allowedRoles: ["admin", "sales"] } }
  };
  const body = { schemaVersion: 2, organizationId: source.organizationId, workflowKind, definitionId: workflowKind,
    version: 1, versionId: `${workflowKind}_v1`, seed: false, publishedBy: actor, publishedAtISO: "2026-08-19T10:00:00.000Z",
    config: { ...structuredClone(definitions.seedPublishedVersion().config), schemaVersion: 2, workflowKind, packPolicy: policies[workflowKind] } };
  const definition = { ...body, definitionDigest: execution.digest(body) };
  let native, observed, sourceQuote = base.record.quote, sourceVersion = base.record.quoteVersion;
  if (workflowKind === "event_execution") {
    native = { ledger: base.phase.nextLedger, receipt: base.phase.receipt };
    observed = packs.eventObservation({ source: accepted, ...native });
  } else if (workflowKind === "final_guest_count") {
    const domain = { ...source, pricedCount: base.record.quoteVersion.snapshot.event.guests };
    const plan = attendance.planCommand({ source: domain, actor, timing: { dueDate: "2026-10-10", policyReferenceId: "current-final-count-policy", timezone: "America/Chicago" }, nowISO: "2026-08-20T12:00:00.000Z",
      request: { ...source, requestId: "inventory-attendance-request-0001", command: "request_confirmation", expectedAttendanceRevision: 0 } });
    native = { state: plan.nextState, receipt: plan.receipt };
    observed = packs.attendanceObservation({ source: domain, ...native });
  } else if (workflowKind === "closeout_follow_up") {
    const record = { schemaVersion: 1, closeoutId: closeout.buildPostEventCloseoutId(accepted), ...source, customerId: accepted.customerId,
      sourceAcceptedAtISO: accepted.acceptedAtISO, sourcePortalIssuedAtISO: accepted.portalIssuedAtISO, sourceBookedAtISO: accepted.bookedAtISO, eventDate: accepted.eventDate,
      dueDate: closeout.addCalendarDaysDateOnly(accepted.eventDate), policy: closeout.buildPostEventCloseoutPolicySnapshot({ businessTimeZone: "America/Chicago" }), state: "pending",
      reviewItems: Object.fromEntries(closeout.POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES.map((code) => [code, { state: "pending", reviewedAtISO: "", reviewedBy: null, lastActionReceiptId: "" }])),
      completedAtISO: "", completedBy: null, createdAtISO: "2026-08-20T12:00:00.000Z", updatedAtISO: "2026-08-20T12:00:00.000Z", createdBy: { uid: actor.uid, role: "admin", email: "synthetic@example.test" } };
    native = { observationProof: packs.buildCloseoutObservationProof({ source: accepted, record }) };
    observed = packs.closeoutObservation({ proof: native.observationProof, definition });
  } else {
    sourceQuote = canonicalQuote();
    const trustedContext = { actor: { uid: actor.uid, role: "admin", email: "synthetic@example.test" }, nowISO: "2026-08-20T12:00:00.000Z", catalogAuthorityDigest: "c".repeat(64), policyVersion: "commercial-policy-v1", workflowPolicy: packs.quotePolicy(definition), attendanceBinding: null };
    let attendanceProof = null;
    if (linkedAttendance) {
      const attendanceSource = { ...source, pricedCount: base.record.quoteVersion.snapshot.event.guests };
      const requested = attendance.planCommand({ source: attendanceSource, actor, timing: { dueDate: "2026-10-10", policyReferenceId: "final-count-policy", timezone: "America/Chicago" }, nowISO: "2026-08-20T11:00:00.000Z", request: { ...source, requestId: "inventory-linked-request-0001", command: "request_confirmation", expectedAttendanceRevision: 0 } });
      const submitted = attendance.planCommand({ source: attendanceSource, actor, state: requested.nextState, currentReceipt: requested.receipt, nowISO: "2026-08-20T11:30:00.000Z", request: { ...source, requestId: "inventory-linked-response-0001", command: "record_response", expectedAttendanceRevision: 1, confirmationRequestId: requested.receipt.receiptId, count: 175, note: "Operator recorded customer request" } });
      trustedContext.attendanceBinding = { ...source, submissionReceiptId: submitted.receipt.receiptId, submissionReceiptDigest: submitted.receipt.receiptDigest, count: 175 };
      attendanceProof = { sourceQuote: base.record.quote, sourceVersion: base.record.quoteVersion, acceptanceReceiptDocument: base.record.acceptanceReceipt, submissionReceipt: submitted.receipt };
    }
    const simulationReceipt = cca.simulate({ request: { organizationId: source.organizationId, quoteId: source.quoteId, requestId: `change_sim_${"a".repeat(32)}`, expectedActiveVersionId: source.sourceVersionId }, canonicalQuote: sourceQuote,
      proposedForm: proposedForm(), proposedPricing: pricing({ guests: 175, total: 16000 }), trustedContext }).receipt;
    native = { simulationReceipt, authorizationReceipt: null, applyReceipt: null, ...(attendanceProof ? { attendanceProof } : {}) };
    if (applied) {
      const current = { activeRevisionId: source.sourceVersionId, catalogAuthorityDigest: trustedContext.catalogAuthorityDigest, policyVersion: trustedContext.policyVersion };
      native.authorizationReceipt = cca.authorize({ simulationReceipt, request: { organizationId: source.organizationId, quoteId: source.quoteId, requestId: `change_auth_${"b".repeat(32)}` }, trustedContext, current }).receipt;
      native.applyReceipt = cca.buildApply({ simulationReceipt, authorizationReceipt: native.authorizationReceipt, request: { organizationId: source.organizationId, quoteId: source.quoteId, requestId: `change_apply_${"c".repeat(32)}`, newRevisionId: "new-commercial-version" }, trustedContext, current }).receipt;
      sourceQuote = { ...sourceQuote, activeVersionId: native.applyReceipt.newRevisionId };
    }
    observed = packs.quoteObservation({ authority: cca, ...native, definition });
  }
  const coordinated = packs.planObservation({ ...observed, actor, definition, requestId: `inventory-${workflowKind}-bind-0001`, nowISO: "2026-08-20T12:00:00.000Z" });
  return { schemaVersion: 2, organizationId: source.organizationId, evaluatedAtISO: TIME, evidenceClass: "local_fixture",
    cohort: { cohortId: "four-pack-local-proof", subjects: [{ workflowKind, quoteId: source.quoteId }] }, authority: { ...old.authority, commercialAuthorityServerEnabled: true, commercialAuthorityTenantEnabled: true },
    entries: [{ workflowKind, quoteId: source.quoteId, observedAtISO: TIME,
      domainProof: { sourceQuote, sourceVersion, acceptanceReceiptDocument: base.record.acceptanceReceipt, native },
      workflow: { instance: coordinated.nextInstance, receipt: coordinated.receipt, publishedVersion: definition, absence: { receipts: "empty", observations: "empty" } } }] };
}

describe("offline version two pack inventory", () => {
  test.each(["quote_review", "final_guest_count", "event_execution", "closeout_follow_up"])("inventory verifies exact native %s evidence and immutable binding without fabricated history", (kind) => {
    const input = packFixture(kind), before = JSON.stringify(input), report = buildInventory(input);
    expect(report.rows[0]).toMatchObject({ classification: "retained_bound_pin", workflowKind: kind });
    expect(report.rows[0].expectedObservations.domainRef.schemaVersion).toBe(2);
    expect(report.rows[0].expectedObservations.domainRef).not.toHaveProperty("revision");
    expect(JSON.stringify(input)).toBe(before); expect(report.appliesChanges).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/"(?:sourceQuote|sourceVersion|publishedBy|portalKeySha256|priorInstance|resultInstance|customerId)":/);
    const unbound = structuredClone(input); unbound.entries[0].workflow.instance = null; unbound.entries[0].workflow.receipt = null;
    expect(buildInventory(unbound).rows[0].classification).toBe("legacy_compatibility_only");
    unbound.entries[0].workflow.absence.receipts = "present";
    expect(buildInventory(unbound).rows[0].reasonCode).toBe("orphan_history");
    const corrupt = structuredClone(input); corrupt.entries[0].workflow.receipt.receiptDigest = "0".repeat(64);
    expect(buildInventory(corrupt).rows[0].classification).toBe("blocked");
    const foreign = structuredClone(input); foreign.entries[0].workflow.publishedVersion.organizationId = "foreign-org";
    expect(buildInventory(foreign).rows[0].classification).toBe("blocked");
  });
  test("all four packs form one explicit offline cohort and the CLI preserves the verified report", () => {
    const inputs = ["quote_review", "final_guest_count", "event_execution", "closeout_follow_up"].map(packFixture);
    const input = { ...inputs[0], cohort: { ...inputs[0].cohort, subjects: inputs.flatMap((value) => value.cohort.subjects) }, entries: inputs.flatMap((value) => value.entries) };
    const report = buildInventory(input); expect(report.counts.retained_bound_pin).toBe(4);
    const directory = mkdtempSync(join(tmpdir(), "pack-inventory-"));
    try { const file = join(directory, "private-proof.json"); writeFileSync(file, JSON.stringify(input));
      const output = execFileSync(process.execPath, ["scripts/event-workflow-migration-inventory.mjs", "--input", file], { encoding: "utf8", env: { PATH: process.env.PATH } });
      expect(JSON.parse(output)).toEqual(report);
    } finally { rmSync(directory, { recursive: true, force: true }); }
    input.authority.tenantEnabled = false;
    expect(buildInventory(input).rows.every((entry) => entry.reasonCode === "rollout_gate_disabled")).toBe(true);
  });
});


test("pack inventory verifies complete applied quote DAG and rejects missing authorization current source or substituted native receipts", () => {
  const input = packFixture("quote_review", true);
  expect(buildInventory(input).rows[0].expectedObservations.domainRef.stateCode).toBe("applied");
  for (const change of [
    (entry) => { entry.domainProof.native.authorizationReceipt = null; },
    (entry) => { entry.domainProof.sourceQuote.activeVersionId = "other-version"; },
    (entry) => { entry.domainProof.native.applyReceipt.simulationDigest = "0".repeat(64); },
    (entry) => { entry.workflow.publishedVersion = null; },
    (entry) => { entry.observedAtISO = "2026-08-19T00:00:00.000Z"; }
  ]) { const broken = structuredClone(input); change(broken.entries[0]); expect(buildInventory(broken).rows[0].classification).toBe("blocked"); }
});

test("pack inventory fails closed on rehashed closeout observation and exact attendance priced source changes", () => {
  const closeoutInput = packFixture("closeout_follow_up");
  const proof = closeoutInput.entries[0].domainProof.native.observationProof;
  proof.resultRecord.state = "completed"; proof.recordDigest = execution.digest(proof.resultRecord);
  const { proofDigest, ...body } = proof; proof.proofDigest = execution.digest(body);
  expect(buildInventory(closeoutInput).rows[0].classification).toBe("blocked");
  const count = packFixture("final_guest_count");
  count.entries[0].domainProof.sourceVersion.snapshot.event.guests += 1;
  expect(buildInventory(count).rows[0].classification).toBe("blocked");
});


test("applied attendance binding requires the exact native submission accepted source count and receipt digest", () => {
  const input = packFixture("quote_review", true, true);
  expect(buildInventory(input).rows[0].classification).toBe("retained_bound_pin");
  expect(buildInventory(input).rows[0].expectedObservations.domainRef.stateCode).toBe("applied");
  const absent = structuredClone(input); delete absent.entries[0].domainProof.native.attendanceProof;
  expect(buildInventory(absent).rows[0].classification).toBe("blocked");
  const bad = structuredClone(input); bad.entries[0].domainProof.native.attendanceProof.submissionReceipt.receiptDigest = "0".repeat(64);
  expect(buildInventory(bad).rows[0].classification).toBe("blocked");
  expect(JSON.stringify(buildInventory(input))).not.toContain("Operator recorded customer request");
  expect(buildInventory(input).unverifiedEvidence).toContain("actual_attendance");
});


test("all-pack inventory requires separate commercial gates while attendance responses remain unapplied", () => {
  for (const field of ["commercialAuthorityServerEnabled", "commercialAuthorityTenantEnabled"]) {
    const quote = packFixture("quote_review"); quote.authority[field] = false;
    expect(buildInventory(quote).rows[0].reasonCode).toBe("commercial_authority_gate_disabled");
    const count = packFixture("final_guest_count"); count.authority[field] = false;
    const row = buildInventory(count).rows[0];
    expect(row.classification).toBe("retained_bound_pin");
    expect(row.commercialApplyGateObservation.allRequiredGatesObservedEnabled).toBe(false);
    expect(row.commercialApplyGateObservation.authorizesApply).toBe(false);
    expect(row.expectedObservations.domainRef.stateCode).toBe("requested");
  }
});


test("attendance inventory accepts verified pre-booking source without inventing booking or delivery", () => {
  const input = packFixture("final_guest_count");
  input.entries[0].domainProof.sourceQuote = { ...input.entries[0].domainProof.sourceQuote, status: "accepted", booking: {} };
  const result = buildInventory(input);
  expect(result.rows[0].classification).toBe("retained_bound_pin");
  expect(result.rows[0].source.workflowKind).toBe("final_guest_count");
  expect(result.unverifiedEvidence).toContain("actual_attendance");
});


test("quote inventory separates migrated coordination pin from immutable native commercial policy publication", () => {
  const input = packFixture("quote_review", true), entry = input.entries[0];
  const originalDefinition = structuredClone(entry.workflow.publishedVersion);
  const nextBody = { ...originalDefinition, version: 2, versionId: "quote_review_v2", publishedAtISO: "2026-08-21T12:00:00.000Z",
    config: { ...originalDefinition.config, name: "Compatible coordinator wording" } };
  delete nextBody.definitionDigest;
  const target = { ...nextBody, definitionDigest: execution.digest(nextBody) };
  const snapshot = entry.workflow.instance;
  const preview = execution.previewMigration({ source: snapshot.source, instance: snapshot, currentReceipt: entry.workflow.receipt, targetDefinition: target });
  const migrated = execution.planCommand({ source: snapshot.source, instance: snapshot, currentReceipt: entry.workflow.receipt, definition: target,
    actor: originalDefinition.publishedBy, nowISO: TIME, request: { requestId: "inventory-commercial-migration-0001", command: "migrate", expectedRevision: snapshot.revision,
      previewDigest: preview.previewDigest, confirmation: preview.confirmation, note: "Adopt coordination metadata only" } });
  entry.workflow = { ...entry.workflow, instance: migrated.nextInstance, receipt: migrated.receipt, publishedVersion: target };
  entry.domainProof.native.simulationDefinition = originalDefinition;
  const result = buildInventory(input).rows[0];
  expect(result.classification).toBe("retained_bound_pin");
  expect(result.expectedObservations.definitionPin.version).toBe(2);
  expect(result.expectedObservations.nativeDefinitionPin.version).toBe(1);
  expect(entry.domainProof.native.simulationReceipt.workflowPolicy.definitionPin.version).toBe(1);
  delete entry.domainProof.native.simulationDefinition;
  expect(buildInventory(input).rows[0].classification).toBe("blocked");
});
