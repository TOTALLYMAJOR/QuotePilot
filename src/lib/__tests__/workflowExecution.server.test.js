import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const execution = require("../../../functions/workflowExecution");
const definitions = require("../../../functions/workflowDefinitions");
const source = { organizationId: "org-one", workflowKind: "event_execution", subjectId: "event-one", sourceVersionId: "v1", sourceReceiptId: "acceptance-one" };
const actor = { organizationId: source.organizationId, uid: "owner-one", role: "admin" };
const now = "2026-09-05T12:00:00.000Z";
const later = "2026-09-05T14:00:00.000Z";
const domainRef = { kind: "event_phase", revision: 1, receiptId: `event_ops_command_${"1".repeat(48)}`, policyDigest: "a".repeat(64), receiptDigest: "b".repeat(64) };
const actualsRef = { revision: 1, receiptId: `event_actuals_command_${"2".repeat(48)}`, receiptDigest: "c".repeat(64), totalCostCents: 500 };
function definition(configChanges = {}, version = 1) {
  const seed = definitions.seedPublishedVersion();
  const body = { ...structuredClone(seed), organizationId: source.organizationId, versionId: `event_execution_v${version}`, version, seed: false,
    config: { ...structuredClone(seed.config), ...configChanges }, publishedBy: actor, publishedAtISO: now };
  delete body.definitionDigest;
  return { ...body, definitionDigest: execution.digest(body) };
}
function initialize(def = definition(), customSource = source, fixtureOnly = false) {
  return execution.planCommand({ source: customSource, request: { requestId: "workflow-initialize-00001", command: "initialize", expectedRevision: 0 }, actor, definition: def, domainRef: fixtureOnly ? { ...domainRef, kind: "post_event_closeout" } : domainRef, nowISO: now, internal: true, fixtureOnly });
}
function command(plan, input, extras = {}) {
  return execution.planCommand({ source, instance: plan.nextInstance || plan.receipt.resultInstance, currentReceipt: plan.receipt,
    request: { requestId: `workflow-command-${String(plan.receipt.resultRevision).padStart(5, "0")}`, expectedRevision: plan.receipt.resultRevision, ...input }, actor, nowISO: later, ...extras });
}
function rehash(receipt) { const { receiptDigest, ...body } = receipt; return { ...body, receiptDigest: execution.digest(body) }; }

describe("pure workflow coordination", () => {
  it("workflow initialization pins immutable tenant or exact seed definitions", () => {
    const result = initialize();
    expect(result.nextInstance.definitionPin).toEqual(definitions.definitionPin(definition()));
    expect(result.nextInstance.domainRef).toEqual(domainRef);
    expect(result.nextInstance.tasks[0].state).toBe("pending");
    expect(initialize(definitions.seedPublishedVersion()).nextInstance.definition.version).toBe(0);
    const seed = structuredClone(definitions.seedPublishedVersion());
    seed.config.name = "Forged seed";
    const { definitionDigest, ...body } = seed;
    expect(() => initialize({ ...body, definitionDigest: execution.digest(body) })).toThrow();
    expect(() => initialize({ ...definition(), organizationId: "other" })).toThrow();
  });
  it("workflow task ownership never grants domain mutation authority", () => {
    const seed = definitions.seedPublishedVersion();
    const task = { ...seed.config.taskTemplates[0], ownerRole: "sales" };
    const first = initialize(definition({ taskTemplates: [task] }));
    const sales = { ...actor, uid: "sales-one", role: "sales" };
    const acknowledged = command(first, { command: "task_ack", taskKey: task.taskKey, note: "Reviewed accepted context" }, { actor: sales });
    expect(acknowledged.nextInstance.tasks[0].state).toBe("acknowledged");
    expect(acknowledged.nextInstance.domainRef).toEqual(first.nextInstance.domainRef);
    const reopened = command(acknowledged, { command: "task_reopen", taskKey: task.taskKey, note: "Context needs another review" }, { actor: sales });
    expect(reopened.nextInstance.tasks[0].state).toBe("pending");
    expect(() => command(initialize(), { command: "task_ack", taskKey: task.taskKey, note: "Wrong owner" }, { actor: sales })).toThrow(/owner role/);
    expect(() => command(first, { command: "observe_domain" }, { actor: sales, internal: true, domainRef: { ...domainRef, revision: 2 } })).toThrow(/Administrator/);
    expect(() => command(first, { command: "observe_domain" })).toThrow(/Unsupported/);
  });
  it("workflow due and escalation projections derive only from explicit observation time", () => {
    const first = initialize();
    const bytes = JSON.stringify(first);
    const before = execution.projectSnapshot({ source, instance: first.nextInstance, receipt: first.receipt, observedAtISO: now });
    const after = execution.projectSnapshot({ source, instance: first.nextInstance, receipt: first.receipt, observedAtISO: later });
    expect(before.tasks[0].urgency).toBe("due");
    expect(after.tasks[0].urgency).toBe("escalated");
    expect(after.tasks[0].escalationRole).toBe("admin");
    expect(JSON.stringify(first)).toBe(bytes);
    expect(() => execution.projectSnapshot({ source, instance: first.nextInstance, receipt: first.receipt, observedAtISO: "2026-09-04T12:00:00.000Z" })).toThrow();
  });
  it("workflow actuals review acknowledgement is invalidated by any new actuals revision", () => {
    const first = initialize(definition({ actualsReviewThresholdCents: 100 }));
    const review = command(first, { command: "review_ack", actualsRevision: 1, actualsReceiptId: actualsRef.receiptId, note: "Reviewed recorded costs" }, { actualsRef });
    const snapshot = (ref) => execution.projectSnapshot({ source, instance: review.nextInstance, receipt: review.receipt, observedAtISO: later, actualsRef: ref });
    expect(snapshot(actualsRef).actualsReview.state).toBe("acknowledged");
    expect(snapshot({ ...actualsRef, revision: 2, receiptId: `event_actuals_command_${"3".repeat(48)}` }).actualsReview.state).toBe("required");
    expect(snapshot(null).actualsReview.state).toBe("not_yet_available");
    expect(snapshot({ ...actualsRef, totalCostCents: 0 }).actualsReview.state).toBe("not_required");
    expect(() => command(first, { command: "review_ack", actualsRevision: 1, actualsReceiptId: actualsRef.receiptId, note: "Stale review" }, { actualsRef: { ...actualsRef, revision: 2 } })).toThrow(/Actuals changed/);
    expect(() => command(first, { command: "review_ack", actualsRevision: 1, actualsReceiptId: actualsRef.receiptId, note: "Unauthorized review" }, { actualsRef, actor: { ...actor, role: "sales" } })).toThrow(/Administrator/);
  });
  it("workflow review thresholds include exact positive and explicitly known zero equality", () => {
    for (const amount of [0, 500]) {
      const first = initialize(definition({ actualsReviewThresholdCents: amount }));
      const ref = { ...actualsRef, totalCostCents: amount };
      expect(execution.projectSnapshot({ source, instance: first.nextInstance, receipt: first.receipt, observedAtISO: now, actualsRef: ref }).actualsReview.state).toBe("required");
      const result = command(first, { command: "review_ack", actualsRevision: ref.revision, actualsReceiptId: ref.receiptId, note: "Reviewed explicit equality" }, { actualsRef: ref });
      expect(execution.projectSnapshot({ source, instance: result.nextInstance, receipt: result.receipt, observedAtISO: later, actualsRef: ref }).actualsReview.state).toBe("acknowledged");
      expect(() => command(first, { command: "review_ack", actualsRevision: ref.revision, actualsReceiptId: ref.receiptId, note: "Incomplete capture unavailable" }, { actualsRef: null })).toThrow(/Actuals changed/);
    }
  });
  it("workflow immutable replay binds exact actor payload and source before current freshness", () => {
    const first = initialize();
    const replay = execution.planCommand({ source, request: first.receipt.request, actor, existingReceipt: first.receipt, definition: null, nowISO: "bad", internal: true });
    expect(replay.idempotent).toBe(true);
    expect(replay.nextInstance).toBeNull();
    expect(replay.receipt).toEqual(first.receipt);
    expect(() => execution.planCommand({ source, request: first.receipt.request, actor: { ...actor, uid: "different" }, existingReceipt: first.receipt, internal: true })).toThrow(/another immutable/);
    expect(() => execution.planCommand({ source: { ...source, sourceReceiptId: "moved" }, request: first.receipt.request, actor, existingReceipt: first.receipt, internal: true })).toThrow(/another immutable/);
    expect(() => command(first, { command: "task_ack", taskKey: first.nextInstance.tasks[0].taskKey, note: "Reviewed", expectedRevision: 0 })).toThrow(/workflow changed/);
  });
  it("workflow rehashed tampering cannot fabricate structure transitions or policy provenance", () => {
    const first = initialize();
    const ack = command(first, { command: "task_ack", taskKey: first.nextInstance.tasks[0].taskKey, note: "Reviewed" });
    for (const edit of [
      (r) => { r.resultInstance.tasks[0].state = "pending"; },
      (r) => { r.resultInstance.tasks.push(r.resultInstance.tasks[0]); },
      (r) => { r.resultInstance.definitionPin.definitionDigest = "f".repeat(64); },
      (r) => { r.recordedBy.role = "sales"; r.commandDigest = execution.digest({ source, request: r.request, actor: r.recordedBy }); },
      (r) => { r.priorInstance.tasks[0].note = "Fabricated pristine note"; },
      (r) => { r.resultInstance.domainRef.receiptDigest = "0".repeat(64); },
      (r) => { r.domainRef = domainRef; },
      (r) => { r.recordedBy.privateEmail = "not-permitted@example.test"; }
    ]) {
      const changed = structuredClone(ack.receipt); edit(changed);
      expect(() => execution.verifyReceipt(rehash(changed))).toThrow();
    }
    expect(() => execution.projectSnapshot({ source, instance: null, receipt: first.receipt, observedAtISO: now })).toThrow(/without a current binding/);
  });
  it("workflow cannot record an instance or migration before its definition publication", () => {
    const future = definition({}, 2);
    future.publishedAtISO = "2026-09-06T00:00:00.000Z";
    const { definitionDigest, ...body } = future;
    future.definitionDigest = execution.digest(body);
    expect(() => initialize(future)).toThrow(/not yet published/);
    const first = initialize();
    const preview = execution.previewMigration({ source, instance: first.nextInstance, currentReceipt: first.receipt, targetDefinition: future });
    expect(() => command(first, { command: "migrate", previewDigest: preview.previewDigest, confirmation: preview.confirmation, note: "Too early" }, { definition: future })).toThrow(/not yet published/);
    const forged = structuredClone(first.receipt);
    forged.definition = future; forged.resultInstance.definition = future; forged.resultInstance.definitionPin = definitions.definitionPin(future);
    expect(() => execution.verifyReceipt(rehash(forged))).toThrow();
  });
  it("workflow migration requires exact compatible preview CAS and typed confirmation", () => {
    const first = initialize();
    const target = definition({ name: "Updated event coordination" }, 2);
    const preview = execution.previewMigration({ source, instance: first.nextInstance, currentReceipt: first.receipt, targetDefinition: target });
    expect(preview.compatible).toBe(true);
    expect(preview.targetConfiguration).toEqual(target.config);
    const { previewDigest, ...previewBody } = preview;
    expect(previewDigest).toBe(execution.digest(previewBody));
    const alteredPreviewBody = structuredClone(previewBody);
    alteredPreviewBody.targetConfiguration.name = "A different review surface";
    expect(execution.digest(alteredPreviewBody)).not.toBe(previewDigest);
    const original = JSON.stringify(first.receipt);
    const migrated = command(first, { command: "migrate", previewDigest: preview.previewDigest, confirmation: preview.confirmation, note: "Adopt revised instructions" }, { definition: target });
    expect(migrated.nextInstance.definitionPin.version).toBe(2);
    expect(migrated.nextInstance.definition.config).toEqual(preview.targetConfiguration);
    expect(execution.verifyReceipt(migrated.receipt).request.previewDigest).toBe(preview.previewDigest);
    const mismatchedTarget = definition({ name: "Different target with same version label" }, 2);
    expect(() => command(first, { command: "migrate", previewDigest: preview.previewDigest, confirmation: preview.confirmation, note: "Changed target config" }, { definition: mismatchedTarget })).toThrow(/preview/);
    expect(migrated.nextInstance.domainRef).toEqual(domainRef);
    expect(JSON.stringify(first.receipt)).toBe(original);
    expect(() => command(first, { command: "migrate", previewDigest: preview.previewDigest, confirmation: "MIGRATE wrong", note: "Wrong confirmation" }, { definition: target })).toThrow(/confirmation/);
    const incompatible = execution.previewMigration({ source, instance: first.nextInstance, currentReceipt: first.receipt, targetDefinition: definition({ actualsReviewThresholdCents: 10 }, 2) });
    expect(incompatible.reasons).toContain("threshold_policy_changed");
    expect(incompatible.targetConfiguration.actualsReviewThresholdCents).toBe(10);
    const ack = command(first, { command: "task_ack", taskKey: first.nextInstance.tasks[0].taskKey, note: "Reviewed" });
    const changedTask = { ...target.config.taskTemplates[0], instruction: "A materially changed instruction" };
    expect(execution.previewMigration({ source, instance: ack.nextInstance, currentReceipt: ack.receipt, targetDefinition: definition({ taskTemplates: [changedTask] }, 2) }).compatible).toBe(false);
    expect(execution.previewMigration({ source, instance: first.nextInstance, currentReceipt: first.receipt, targetDefinition: definition({ taskTemplates: [] }, 2) }).compatible).toBe(false);
  });
  it("workflow second thin fixture uses the same coordinator without runtime granting another kind", () => {
    const fixtureSource = { ...source, workflowKind: "post_event_review" };
    const fixtureDefinition = definitions.seedPublishedVersion("post_event_review", { fixtureOnly: true });
    const result = initialize(fixtureDefinition, fixtureSource, true);
    expect(result.nextInstance.domainRef.kind).toBe("post_event_closeout");
    expect(execution.projectSnapshot({ source: fixtureSource, instance: result.nextInstance, receipt: result.receipt, observedAtISO: now, fixtureOnly: true }).availability).toBe("available");
    expect(() => execution.verifyReceipt(result.receipt)).toThrow();
    expect(() => execution.normalizeSource(fixtureSource)).toThrow();
  });
  it("workflow fixture task transitions share the production reducer with explicit fixture opt in", () => {
    const fixtureSource = { ...source, workflowKind: "post_event_review" };
    const fixtureDefinition = definitions.seedPublishedVersion("post_event_review", { fixtureOnly: true });
    const first = initialize(fixtureDefinition, fixtureSource, true);
    const acknowledged = execution.planCommand({ source: fixtureSource, instance: first.nextInstance, currentReceipt: first.receipt,
      request: { requestId: "fixture-task-acknowledge-001", command: "task_ack", expectedRevision: 1, taskKey: first.nextInstance.tasks[0].taskKey, note: "Reviewed closeout observation" },
      actor, nowISO: later, fixtureOnly: true });
    expect(acknowledged.nextInstance.tasks[0].state).toBe("acknowledged");
    expect(acknowledged.nextInstance.domainRef).toEqual(first.nextInstance.domainRef);
    expect(() => execution.verifyReceipt(acknowledged.receipt)).toThrow();
  });
  it("workflow projection exposes effective policy and fixed manual handoff guidance", () => {
    const task = { ...definitions.seedPublishedVersion().config.taskTemplates[0], dueOffsetMinutes: 30, communicationTemplateRef: "internal_event_brief_v1" };
    const first = initialize(definition({ taskTemplates: [task], duePolicy: { offsetMinutes: 120 }, escalationPolicy: { afterMinutes: 60, role: "admin" } }));
    const projection = execution.projectSnapshot({ source, instance: first.nextInstance, receipt: first.receipt, observedAtISO: now });
    expect(projection.configuration).toEqual(first.nextInstance.definition.config);
    expect(projection.definitionSource).toBe("tenant_published");
    expect(projection.publishedBy).toEqual({ uid: actor.uid, role: "admin" });
    expect(projection.tasks[0].dueAtISO).toBe("2026-09-05T12:30:00.000Z");
    expect(projection.dueAtISO).toBe("2026-09-05T14:00:00.000Z");
    expect(projection.escalationAtISO).toBe("2026-09-05T15:00:00.000Z");
    expect(projection.tasks[0].communicationHandoff.label).toBe("Internal event brief");
    expect(projection.tasks[0].communicationHandoff.guidance).toContain("no send or delivery");
    const empty = initialize(definition({ taskTemplates: [] }));
    expect(execution.projectSnapshot({ source, instance: empty.nextInstance, receipt: empty.receipt, observedAtISO: now }).configuration.allowedRoles).toEqual(["admin", "sales"]);
  });
  it("workflow rejects unsupported command data and carries declared comparison provenance", () => {
    const first = initialize(definition({ comparisonPolicy: { laborBasisPoints: 500, purchasingBasisPoints: 1000, minimumCents: 100 } }));
    const projection = execution.projectSnapshot({ source, instance: first.nextInstance, receipt: first.receipt, observedAtISO: now });
    expect(projection.comparisonPolicy.declaredBy).toBe(actor.uid);
    expect(projection.comparisonPolicy).toEqual(definitions.comparisonPolicyEvidence(first.nextInstance.definition));
    expect(projection.comparisonPolicy.declaredAtISO).toBe(now);
    expect(() => command(first, { command: "task_ack", taskKey: first.nextInstance.tasks[0].taskKey, note: "Good", customerApproved: true })).toThrow(/unsupported fields/);
    expect(() => command(first, { command: "task_ack", taskKey: first.nextInstance.tasks[0].taskKey, note: "x".repeat(241) })).toThrow(/240/);
    expect(execution.projectSnapshot({ source, observedAtISO: now }).reasonCode).toBe("legacy_unbound");
  });
});


describe("version two observation primitives", () => {
  it("version two sources and domain observations reject forged scope and native revision claims", () => {
    const refs = { ...source, schemaVersion: 2, workflowKind: "quote_review" };
    const observation = { schemaVersion: 2, adapterId: "quote_review_v2", sourceDigest: execution.digest(refs), observationKind: "immutable_receipt", evidenceId: "simulation-one", evidenceDigest: "a".repeat(64), domainPolicyDigest: "b".repeat(64), stateCode: "simulated", recordedAtISO: now };
    expect(execution.normalizeSource(refs)).toEqual(refs);
    expect(execution.validateDomainRef(observation, refs)).toEqual(observation);
    expect(() => execution.validateDomainRef({ ...observation, revision: 1 }, refs)).toThrow();
    expect(() => execution.validateDomainRef({ ...observation, sourceDigest: "c".repeat(64) }, refs)).toThrow();
    expect(() => execution.normalizeSource({ ...refs, workflowKind: "post_event_review" }, { fixtureOnly: true })).toThrow();
    expect(() => execution.normalizeSource({ ...source, workflowKind: "quote_review" })).toThrow();
    expect(execution.POLICY.schemaVersion).toBe(1);
    expect(execution.POLICY_V2.schemaVersion).toBe(2);
  });
});


describe("version two immutable coordinator receipts", () => {
  const refs = { ...source, schemaVersion: 2, workflowKind: "quote_review" };
  const config = { ...structuredClone(definitions.seedPublishedVersion().config), schemaVersion: 2, workflowKind: refs.workflowKind, packPolicy: { approval: { basis: "absolute_total_delta_cents", thresholdCents: null, allowedRoles: ["admin", "sales"] } } };
  const body = { schemaVersion: 2, organizationId: refs.organizationId, definitionId: refs.workflowKind, workflowKind: refs.workflowKind, versionId: "quote_review_v1", version: 1, config, publishedBy: actor, publishedAtISO: now, seed: false };
  const version = { ...body, definitionDigest: execution.digest(body) };
  const observation = { schemaVersion: 2, adapterId: "quote_review_v2", sourceDigest: execution.digest(refs), observationKind: "immutable_receipt", evidenceId: "simulation-one", evidenceDigest: "a".repeat(64), domainPolicyDigest: "b".repeat(64), stateCode: "simulated", recordedAtISO: now };
  const initial = () => execution.planCommand({ source: refs, request: { requestId: "workflow-version-two-init-01", command: "initialize", expectedRevision: 0 }, actor, definition: version, domainRef: observation, scheduleAnchor: { kind: "instant", atISO: now }, nowISO: now, internal: true });
  it("version two receipts reproduce exact observations and reject rehashed mutation and replay identity drift", () => {
    const first = initial();
    expect(first.nextInstance.schemaVersion).toBe(2);
    expect(first.nextInstance.domainRef).not.toHaveProperty("revision");
    expect(execution.verifyReceipt(first.receipt)).toEqual(first.receipt);
    const nextObservation = { ...observation, evidenceId: "authorization-one", evidenceDigest: "c".repeat(64), stateCode: "authorized", recordedAtISO: later };
    const input = { source: refs, request: { requestId: "workflow-version-two-observe-01", command: "observe_domain", expectedRevision: 1 }, actor, instance: first.nextInstance, currentReceipt: first.receipt, domainRef: nextObservation, nowISO: later, internal: true };
    const next = execution.planCommand(input);
    expect(next.nextInstance.revision).toBe(2);
    expect(next.receipt.priorInstance.domainRef).toEqual(observation);
    expect(execution.planCommand({ ...input, existingReceipt: next.receipt, instance: null, currentReceipt: null }).idempotent).toBe(true);
    expect(() => execution.planCommand({ ...input, existingReceipt: next.receipt, actor: { ...actor, uid: "other-admin" } })).toThrow();
    const forged = structuredClone(next.receipt); forged.resultInstance.domainRef.evidenceDigest = "d".repeat(64);
    expect(() => execution.verifyReceipt(rehash(forged))).toThrow();
    const anchor = structuredClone(next.receipt); anchor.resultInstance.scheduleAnchor.atISO = later;
    expect(() => execution.verifyReceipt(rehash(anchor))).toThrow();
    expect(() => execution.planCommand({ ...input, domainRef: observation })).toThrow(/fresh/);
    expect(() => execution.planCommand({ ...input, internal: false })).toThrow(/Unsupported/);
  });
  it("version two anchor and schema boundaries remain exact", () => {
    expect(execution.validateScheduleAnchor({ kind: "tenant_calendar_date", date: "2026-11-01", timeZone: "America/Chicago" }).date).toBe("2026-11-01");
    expect(() => execution.validateScheduleAnchor({ kind: "tenant_calendar_date", date: "2026-02-30", timeZone: "America/Chicago" })).toThrow();
    expect(() => execution.validateScheduleAnchor({ kind: "tenant_calendar_date", date: "2026-11-01", timeZone: "invalid" })).toThrow();
    const first = initial();
    expect(() => execution.planCommand({ source: refs, request: { requestId: "workflow-version-two-migrate-01", command: "migrate", expectedRevision: 1, previewDigest: "a".repeat(64), confirmation: "MIGRATE event_execution_v0", note: "Attempt schema downgrade" }, actor, instance: first.nextInstance, currentReceipt: first.receipt, definition: definitions.seedPublishedVersion(), nowISO: later })).toThrow();
  });
});


describe("version two internal portal provenance", () => {
  it("customer observations cannot initialize acknowledge migrate change source or escape the attendance pack", () => {
    const refs = { ...source, schemaVersion: 2, workflowKind: "final_guest_count" };
    const body = { schemaVersion: 2, organizationId: refs.organizationId, definitionId: refs.workflowKind, workflowKind: refs.workflowKind, versionId: "final_guest_count_v1", version: 1, config: { ...structuredClone(definitions.seedPublishedVersion().config), schemaVersion: 2, workflowKind: refs.workflowKind, packPolicy: { responsibleRoles: ["admin", "sales"] } }, publishedBy: actor, publishedAtISO: now, seed: false };
    const version = { ...body, definitionDigest: execution.digest(body) };
    const observation = { schemaVersion: 2, adapterId: "final_guest_count_v2", sourceDigest: execution.digest(refs), observationKind: "immutable_receipt", evidenceId: "attendance-request-one", evidenceDigest: "a".repeat(64), domainPolicyDigest: "b".repeat(64), stateCode: "requested", recordedAtISO: now };
    const request = { requestId: "workflow-portal-initial-0001", command: "initialize", expectedRevision: 0 };
    const input = { source: refs, request, actor: { ...actor, role: "sales" }, definition: version, domainRef: observation, scheduleAnchor: { kind: "instant", atISO: now }, nowISO: now, internal: true };
    const first = execution.planCommand(input);
    const customer = { organizationId: refs.organizationId, role: "customer", portalKeySha256: "c".repeat(64), portalIssuedAtISO: now };
    expect(() => execution.planCommand({ ...input, actor: customer })).toThrow();
    const update = { source: refs, request: { requestId: "workflow-portal-observe-0001", command: "observe_domain", expectedRevision: 1 }, actor: customer, instance: first.nextInstance, currentReceipt: first.receipt, domainRef: { ...observation, evidenceId: "attendance-response-one", evidenceDigest: "d".repeat(64), stateCode: "response_recorded", recordedAtISO: later }, nowISO: later, internal: true };
    const observed = execution.planCommand(update);
    expect(observed.receipt.recordedBy).toEqual(customer);
    expect(observed.nextInstance.tasks).toEqual(first.nextInstance.tasks);
    expect(() => execution.planCommand({ ...update, internal: false })).toThrow(/Unsupported/);
    expect(() => execution.planCommand({ ...update, actor: { ...customer, organizationId: "other" } })).toThrow();
    expect(() => execution.planCommand({ ...update, instance: null, currentReceipt: null })).toThrow();
    expect(() => execution.planCommand({ ...update, request: { ...update.request, command: "task_ack", taskKey: "review_event_context", note: "Cannot acknowledge" } })).toThrow();
    expect(() => execution.planCommand({ ...update, source: { ...refs, workflowKind: "quote_review" } })).toThrow();
    expect(() => execution.planCommand({ ...update, existingReceipt: observed.receipt, actor: { ...customer, portalIssuedAtISO: later } })).toThrow();
    const tamper = structuredClone(observed.receipt); tamper.recordedBy.uid = "pretend-person";
    expect(() => execution.verifyReceipt(rehash(tamper))).toThrow();
  });
});


describe("version two calendar projections", () => {
  it("tenant calendar due dates retain timezone and do not become UTC midnight authority", () => {
    const refs = { ...source, schemaVersion: 2, workflowKind: "closeout_follow_up" };
    const body = { schemaVersion: 2, organizationId: refs.organizationId, definitionId: refs.workflowKind, workflowKind: refs.workflowKind, versionId: "closeout_follow_up_v1", version: 1, config: { ...structuredClone(definitions.seedPublishedVersion().config), schemaVersion: 2, workflowKind: refs.workflowKind, packPolicy: { responsibleRoles: ["admin"], followUpOffsetDays: 0 } }, publishedBy: actor, publishedAtISO: now, seed: false };
    const observation = { schemaVersion: 2, adapterId: "closeout_follow_up_v2", sourceDigest: execution.digest(refs), observationKind: "record_snapshot", evidenceId: "closeout-one", evidenceDigest: "a".repeat(64), domainPolicyDigest: "b".repeat(64), stateCode: "pending", recordedAtISO: now };
    const first = execution.planCommand({ source: refs, request: { requestId: "workflow-calendar-initial-0001", command: "initialize", expectedRevision: 0 }, actor, definition: { ...body, definitionDigest: execution.digest(body) }, domainRef: observation, scheduleAnchor: { kind: "tenant_calendar_date", date: "2026-11-01", timeZone: "America/Chicago" }, nowISO: now, internal: true });
    const bytes = JSON.stringify(first);
    const project = (observedAtISO) => execution.projectSnapshot({ source: refs, instance: first.nextInstance, receipt: first.receipt, observedAtISO });
    expect(project("2026-11-01T04:59:00.000Z").tasks[0].urgency).toBe("upcoming");
    const due = project("2026-11-01T05:00:00.000Z");
    expect(due.tasks[0].urgency).toBe("due");
    expect(due.due).toEqual({ kind: "tenant_calendar_date", date: "2026-11-01", minuteOfDay: 0, timeZone: "America/Chicago" });
    expect(due).not.toHaveProperty("dueAtISO");
    expect(due.configuration.packPolicy).toEqual(body.config.packPolicy);
    expect(JSON.stringify(first)).toBe(bytes);
  });
});
