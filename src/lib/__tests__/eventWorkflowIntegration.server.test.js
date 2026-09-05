import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const authority = require("../../../functions/eventOperatingHistory.js");
const definitions = require("../../../functions/workflowDefinitions.js");
const execution = require("../../../functions/workflowExecution.js");
const eventAdapter = require("../../../functions/eventWorkflowAdapter.js");
const configScope = { organizationId: "org-one", workflowKind: "event_execution" };
const phaseAuthority = require("../../../functions/eventOperations.js");
const workAuthority = require("../../../functions/eventOperatingWork.js");
const actualsAuthority = require("../../../functions/eventOperatingActuals.js");
const closeout = require("../../../functions/postEventCloseout.js");
const actor = { organizationId: "org-one", principalOrganizationId: "org-one", uid: "admin-one", role: "admin", email: "owner@example.test" };
const source = { organizationId: "org-one", quoteId: "quote-one", sourceVersionId: "v1", acceptanceReceiptId: "accepted-one" };
const nowISO = "2026-09-05T18:00:00.000Z";
const phaseRequest = { ...source, requestId: "history-phase-initialize-0001", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" };
const request = { ...source, requestId: "history-actuals-record-0001", actualsPolicyVersion: 1, expectedActualsRevision: 0, command: "record", category: "other", description: "Declared cost", costCents: 100 };
function acceptedFixture() {
  const portalIssuedAtISO = "2026-09-01T12:00:00.000Z";
  const proposalSnapshot = { organizationId: source.organizationId, quoteId: source.quoteId, revisionId: `v1@${portalIssuedAtISO}`, portalIssuedAtISO };
  const snapshotSha256 = createHash("sha256").update(JSON.stringify(proposalSnapshot)).digest("hex");
  const acceptance = { receiptId: source.acceptanceReceiptId, organizationId: source.organizationId, quoteId: source.quoteId, quoteRevisionId: proposalSnapshot.revisionId, acceptedAtISO: "2026-09-02T12:00:00.000Z", portalIssuedAtISO, snapshotSha256, proposalSnapshot };
  const quote = { id: source.quoteId, organizationId: source.organizationId, customerId: "customer-one", status: "booked", activeVersionId: "v1", event: { date: "2026-09-06" }, booking: { bookedAtISO: "2026-09-02T13:00:00.000Z" }, acceptanceReceipt: acceptance };
  const version = { versionId: "v1", quoteId: source.quoteId, organizationId: source.organizationId, customerId: "customer-one", snapshot: { id: source.quoteId, organizationId: source.organizationId, customerId: "customer-one", event: quote.event } };
  return { quote, version, acceptance };
}
function callableHarness({ globalEnabled = "true", tenantEnabled = true, staff = actor } = {}) {
  const fixture = acceptedFixture();
  const orgPath = "organizations/org-one";
  const store = new Map([
    [orgPath, { active: true, status: "active" }],
    [`userRoles/${staff.uid}`, { organizationId: staff.organizationId, role: staff.role, email: staff.email }],
    [`${orgPath}/settings/config`, { eventOperatingSpineEnabled: tenantEnabled }],
    [`${orgPath}/quotes/quote-one`, fixture.quote],
    [`${orgPath}/quotes/quote-one/versions/v1`, fixture.version],
    [`${orgPath}/proposalAcceptanceReceipts/accepted-one`, fixture.acceptance]
  ]);
  const reads = [];
  const queries = [];
  const collection = (path, filters = [], ordering = null, maximum = Infinity) => ({
    path, queryPrefix: `${path}/`, filters, ordering, maximum,
    doc: (id) => ref(`${path}/${id}`),
    where: (field, operator, value) => collection(path, [...filters, { field, operator, value }], ordering, maximum),
    orderBy: (field, direction) => collection(path, filters, { field, direction }, maximum),
    limit: (limit) => collection(path, filters, ordering, limit)
  });
  const ref = (path) => ({ path, id: path.split("/").at(-1), collection: (name) => collection(`${path}/${name}`) });
  let transactionTail = Promise.resolve();
  const transaction = async (fn) => {
    const writes = [];
    const tx = {
      get: async (reference) => {
        reads.push(reference.path);
        if (reference.queryPrefix) {
          queries.push({ path: reference.path, maximum: reference.maximum, filters: reference.filters });
          let rows = [...store].filter(([path, data]) => path.startsWith(reference.queryPrefix)
            && !path.slice(reference.queryPrefix.length).includes("/")
            && reference.filters.every((filter) => filter.operator === "<=" && data[filter.field] <= filter.value));
          if (reference.ordering) {
            rows.sort((left, right) => reference.ordering.direction === "desc"
              ? right[1][reference.ordering.field] - left[1][reference.ordering.field]
              : left[1][reference.ordering.field] - right[1][reference.ordering.field]);
          }
          rows = rows.slice(0, reference.maximum);
          return { empty: rows.length === 0, docs: rows.map(([path, data]) => ({ id: path.split("/").at(-1), data: () => structuredClone(data) })) };
        }
        const data = store.get(reference.path);
        return { exists: data !== undefined, id: reference.id, data: () => structuredClone(data) };
      },
      create: (reference, value) => { if (store.has(reference.path)) throw new Error("already exists"); writes.push([reference.path, value]); },
      set: (reference, value) => writes.push([reference.path, value])
    };
    const result = await fn(tx);
    writes.forEach(([path, value]) => store.set(path, structuredClone(value)));
    return result;
  };
  const db = { collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }), runTransaction: (fn) => {
    const result = transactionTail.then(() => transaction(fn));
    transactionTail = result.catch(() => {});
    return result;
  } };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const exports = {};
  const sandbox = { workflowDefinitions: require("../../../functions/workflowDefinitions.js"), workflowExecution: require("../../../functions/workflowExecution.js"), eventWorkflowAdapter: require("../../../functions/eventWorkflowAdapter.js"), exports, eventOperations: phaseAuthority, eventOperatingWork: workAuthority, eventOperatingActuals: actualsAuthority, eventOperatingHistory: authority, PostEventCloseoutError: closeout.PostEventCloseoutError, db, REGION: "test", ORGANIZATIONS_COLLECTION: "organizations", QUOTES_COLLECTION: "quotes", ORGANIZATION_TOMBSTONES_COLLECTION: "organizationTombstones", PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION: "proposalAcceptanceReceipts", process: { env: { EVENT_OPERATING_SPINE_ENABLED: globalEnabled } }, functions: { region: () => ({ https: { onCall: (handler) => handler } }), https: { HttpsError }, logger: { error: () => {} } }, assertStaff: async () => staff, normalizeText: (value) => String(value || "").trim(), normalizeEmail: (value) => String(value || "").trim().toLowerCase(), isOrganizationRecordActive: (value) => value?.active !== false && value?.archived !== true && [undefined, "", "active"].includes(value?.status) };
  const index = readFileSync(new URL("../../../functions/index.js", import.meta.url), "utf8");
  const start = index.indexOf("function eventOperatingActor(");
  const end = index.indexOf("exports.recordPostEventCloseoutReview =", start);
  expect(start).toBeGreaterThan(0);
  vm.runInNewContext(index.slice(start, end), sandbox);
  const workStart = index.indexOf("async function readEventOperatingWorkPhase(");
  expect(workStart).toBeGreaterThan(end);
  vm.runInNewContext(index.slice(workStart), sandbox);
  return {
    store, reads, queries, fixture,
    invoke: (name, data) => exports[name](data, {}),
    setStaff: (next) => { staff = next; store.set(`userRoles/${staff.uid}`, { organizationId: staff.organizationId, role: staff.role, email: staff.email }); },
    configuration: () => exports.getWorkflowConfiguration(configScope, {}),
    eventWorkflow: () => exports.getEventWorkflowSnapshot({ organizationId: source.organizationId, quoteId: source.quoteId }, {}),
    history: (data = { organizationId: source.organizationId, quoteId: source.quoteId }) => exports.getEventOperatingHistory(data, {}),
    phaseRead: () => exports.getEventOperatingSnapshot(source, {}),
    phaseApply: (data = phaseRequest) => exports.applyEventOperatingCommand(data, {}),
    workApply: (data) => exports.applyEventOperatingWorkCommand(data, {}),
    read: (data = { organizationId: source.organizationId, quoteId: source.quoteId }) => exports.getEventOperatingActualsSnapshot(data, {}),
    apply: (data = request) => exports.applyEventOperatingActualsCommand(data, {})
  };
}

function draftRequest(config = definitions.seedPublishedVersion().config, revision = 0, suffix = "first") {
  return { ...configScope, requestId: `configuration-save-draft-${suffix}`, expectedRevision: revision, command: "save_draft", config: structuredClone(config) };
}
async function publish(h, config = definitions.seedPublishedVersion().config, revision = 0, suffix = "first") {
  await h.invoke("applyWorkflowDefinitionCommand", draftRequest(config, revision, suffix));
  const { preview } = await h.invoke("previewWorkflowDefinition", { ...configScope, expectedRevision: revision + 1 });
  const request = { ...configScope, requestId: `configuration-publish-${suffix}`, expectedRevision: revision + 1, command: "publish", previewDigest: preview.previewDigest, confirmationText: preview.confirmationText };
  const result = await h.invoke("applyWorkflowDefinitionCommand", request);
  return { result, request, preview, version: (await h.configuration()).snapshot.activeVersion };
}
function movedSource(h) {
  const acceptance = { ...h.fixture.acceptance, receiptId: "accepted-two" };
  h.store.set("organizations/org-one/quotes/quote-one", { ...h.fixture.quote, acceptanceReceipt: acceptance });
  h.store.set("organizations/org-one/proposalAcceptanceReceipts/accepted-two", acceptance);
  return { ...source, acceptanceReceiptId: "accepted-two" };
}
const instancePath = () => `organizations/org-one/workflowInstances/${execution.instanceIdFor(eventAdapter.eventSource(source))}`;
const definitionPath = "organizations/org-one/workflowDefinitions/event_execution";

describe("event workflow integration", () => {
  test("event initialization atomically binds exact seed and current phase while legacy remains unbound", async () => {
    const h = callableHarness();
    const missing = (await h.eventWorkflow()).snapshot;
    expect(missing.reasonCode).toBe("phase_ledger_missing");
    expect(missing.initializationEligibility).toEqual({ eligible: true, reasonCode: "seed" });
    expect(missing.nextDefinition.version).toBe(0);
    const first = await h.phaseApply();
    const projected = (await h.eventWorkflow()).snapshot;
    expect(projected.definitionSource).toBe("source_controlled_seed");
    expect(projected.domainRef.receiptId).toBe(first.receipt.receiptId);
    expect(projected.phaseRevision).toBe(projected.domainRef.revision);
    expect(projected.phaseReceiptId).toBe(projected.domainRef.receiptId);
    expect(h.store.get(instancePath()).revision).toBe(1);
    expect([...h.store.keys()].filter((path) => path.startsWith(`${instancePath()}/receipts/`))).toHaveLength(1);
    expect(first.snapshot.configuration).toBeUndefined();
    await expect(h.phaseApply({ ...phaseRequest, configuration: { threshold: 0 } })).rejects.toMatchObject({ code: "invalid-argument" });
    const legacy = callableHarness();
    const old = phaseAuthority.planCommand({ request: phaseRequest, actor, source, nowISO });
    const path = `organizations/org-one/eventOperatingLedgers/${old.nextLedger.ledgerId}`;
    legacy.store.set(path, old.nextLedger); legacy.store.set(`${path}/receipts/${old.receipt.receiptId}`, old.receipt);
    expect((await legacy.eventWorkflow()).snapshot.reasonCode).toBe("legacy_unbound");
    expect([...legacy.store.keys()].some((key) => key.includes("workflowInstances"))).toBe(false);
  });
  test("event bindings retain immutable publications through later publish and retirement", async () => {
    const h = callableHarness();
    const firstPublication = await publish(h);
    await h.phaseApply();
    const pinned = structuredClone(h.store.get(instancePath()).definition);
    const second = await publish(h, { ...firstPublication.version.config, name: "New future workflow" }, 2, "second");
    expect((await h.eventWorkflow()).snapshot.definitionPin.version).toBe(1);
    expect(h.store.get(instancePath()).definition).toEqual(pinned);
    await h.invoke("applyWorkflowDefinitionCommand", { ...configScope, requestId: "configuration-retire-second-0001", expectedRevision: 4, command: "retire", versionId: second.version.versionId, reason: "Pause new bindings" });
    expect((await h.eventWorkflow()).snapshot.definitionPin.version).toBe(1);
    const moved = movedSource(h);
    const unavailable = (await h.eventWorkflow()).snapshot;
    expect(unavailable.initializationEligibility).toEqual({ eligible: false, reasonCode: "retired" });
    expect(unavailable.nextDefinition).toBeNull();
    const before = [...h.store];
    await expect(h.phaseApply({ ...phaseRequest, ...moved, requestId: "retired-new-event-initialize-01" })).rejects.toMatchObject({ code: "failed-precondition" });
    expect([...h.store]).toEqual(before);
  });
  test("event task commands honor configured ownership and exact historical immutable replay", async () => {
    const h = callableHarness();
    const seed = definitions.seedPublishedVersion().config;
    await publish(h, { ...seed, taskTemplates: [{ ...seed.taskTemplates[0], ownerRole: "sales" }] });
    await h.phaseApply();
    const sales = { ...actor, uid: "sales-one", role: "sales", email: "sales@example.test" };
    h.setStaff(sales);
    const task = (await h.eventWorkflow()).snapshot.tasks[0];
    const command = { ...source, requestId: "event-sales-task-acknowledge-01", expectedRevision: 1, command: "task_ack", taskKey: task.taskKey, note: "Reviewed the accepted context" };
    const phaseBefore = [...h.store].filter(([path]) => path.includes("eventOperatingLedgers"));
    const result = await h.invoke("applyEventWorkflowCommand", command);
    expect(result.receipt.resultRevision).toBe(2);
    expect(result.snapshot).toBeUndefined();
    expect((await h.eventWorkflow()).snapshot.tasks[0].state).toBe("acknowledged");
    expect([...h.store].filter(([path]) => path.includes("eventOperatingLedgers"))).toEqual(phaseBefore);
    movedSource(h);
    const before = [...h.store];
    expect((await h.invoke("applyEventWorkflowCommand", command)).idempotent).toBe(true);
    expect([...h.store]).toEqual(before);
    await expect(h.invoke("applyEventWorkflowCommand", { ...command, note: "Changed payload" })).rejects.toMatchObject({ code: "already-exists" });
    await expect(h.invoke("applyEventWorkflowCommand", { ...command, requestId: "event-stale-task-command-0001", command: "task_reopen", expectedRevision: 2 })).rejects.toMatchObject({ code: "aborted" });
    await expect(h.invoke("applyEventWorkflowCommand", { ...source, requestId: "public-observe-domain-00001", command: "observe_domain", expectedRevision: 2 })).rejects.toMatchObject({ code: "invalid-argument" });
  });
  test("event coordinator concurrency commits one task receipt and advances phase through trusted adapter", async () => {
    const h = callableHarness();
    await h.phaseApply();
    const taskKey = h.store.get(instancePath()).tasks[0].taskKey;
    const outcomes = await Promise.allSettled(["one", "two"].map((suffix) => h.invoke("applyEventWorkflowCommand", {
      ...source, requestId: `event-concurrent-task-${suffix}`, expectedRevision: 1, command: "task_ack", taskKey, note: "Reviewed" })));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected").reason.code).toBe("aborted");
    expect(h.store.get(instancePath()).revision).toBe(2);
    expect([...h.store.keys()].filter((path) => path.startsWith(`${instancePath()}/receipts/`))).toHaveLength(2);
    const moved = await h.phaseApply({ ...phaseRequest, requestId: "event-phase-with-binding-0001", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" });
    const current = (await h.eventWorkflow()).snapshot;
    expect(current.revision).toBe(3);
    expect(current.domainRef.receiptId).toBe(moved.receipt.receiptId);
    expect(current.tasks[0].state).toBe("acknowledged");
  });
  test("event review requires complete captured costs and invalidates acknowledgement on every new revision", async () => {
    const h = callableHarness();
    await publish(h, { ...definitions.seedPublishedVersion().config, actualsReviewThresholdCents: 0 });
    await h.phaseApply();
    expect((await h.eventWorkflow()).snapshot.actualsReview.state).toBe("not_yet_available");
    let revision = 0;
    let last;
    for (const category of ["labor", "purchasing", "other"]) {
      last = await h.apply({ ...source, requestId: `workflow-capture-complete-${category}`, actualsPolicyVersion: 1, expectedActualsRevision: revision++, command: "declare_category", category, state: "complete", note: "Confirmed zero captured category costs" });
    }
    expect((await h.eventWorkflow()).snapshot.actualsReview.state).toBe("required");
    const review = { ...source, requestId: "workflow-review-known-zero-001", command: "review_ack", expectedRevision: 1, actualsRevision: 3, actualsReceiptId: last.receipt.receiptId, note: "Reviewed complete known zero" };
    await h.invoke("applyEventWorkflowCommand", review);
    expect((await h.eventWorkflow()).snapshot.actualsReview.state).toBe("acknowledged");
    await h.apply({ ...source, requestId: "workflow-capture-now-partial-001", actualsPolicyVersion: 1, expectedActualsRevision: 3, command: "declare_category", category: "other", state: "partial", note: "Additional cost information pending" });
    expect((await h.eventWorkflow()).snapshot.actualsReview.state).toBe("not_yet_available");
    await expect(h.invoke("applyEventWorkflowCommand", { ...review, requestId: "workflow-review-incomplete-001", expectedRevision: 2 })).rejects.toMatchObject({ code: "aborted" });
    await h.apply({ ...source, requestId: "workflow-capture-complete-again", actualsPolicyVersion: 1, expectedActualsRevision: 4, command: "declare_category", category: "other", state: "complete", note: "Confirmed the reviewed costs again" });
    expect((await h.eventWorkflow()).snapshot.actualsReview.state).toBe("required");
  });
  test("event migration requires current active publication exact preview source and typed CAS", async () => {
    const h = callableHarness();
    await h.phaseApply();
    await publish(h, { ...definitions.seedPublishedVersion().config, name: "Tenant adopted workflow" });
    const { preview } = await h.invoke("previewEventWorkflowMigration", { ...source, expectedRevision: 1 });
    expect(preview.compatible).toBe(true);
    expect(preview.targetConfiguration.name).toBe("Tenant adopted workflow");
    expect(preview.targetConfiguration).toEqual((await h.configuration()).snapshot.activeVersion.config);
    const command = { ...source, requestId: "workflow-migrate-to-tenant-001", expectedRevision: 1, command: "migrate", previewDigest: preview.previewDigest, confirmation: preview.confirmation, note: "Adopt compatible tenant configuration" };
    await expect(h.invoke("applyEventWorkflowCommand", { ...command, confirmation: "MIGRATE wrong" })).rejects.toMatchObject({ code: "aborted" });
    const result = await h.invoke("applyEventWorkflowCommand", command);
    expect(result.receipt.definitionPin.version).toBe(1);
    expect((await h.eventWorkflow()).snapshot.definitionSource).toBe("tenant_published");
    expect((await h.invoke("applyEventWorkflowCommand", command)).idempotent).toBe(true);
    movedSource(h);
    await expect(h.invoke("previewEventWorkflowMigration", { ...source, expectedRevision: 2 })).rejects.toMatchObject({ code: "aborted" });
  });
  test("event workflow rejects missing pinned publications corrupt pairs and orphan resets while preserving exact retry", async () => {
    const h = callableHarness();
    await publish(h);
    const phase = await h.phaseApply();
    const versionPath = `${definitionPath}/versions/event_execution_v1`;
    const version = h.store.get(versionPath);
    h.store.delete(versionPath);
    await expect(h.eventWorkflow()).rejects.toMatchObject({ code: "data-loss" });
    h.store.set(versionPath, version);
    const instance = h.store.get(instancePath());
    h.store.set(instancePath(), { ...instance, domainRef: { ...instance.domainRef, revision: 2 } });
    await expect(h.eventWorkflow()).rejects.toMatchObject({ code: "data-loss" });
    h.store.set(instancePath(), instance);
    h.store.delete(instancePath());
    await expect(h.eventWorkflow()).rejects.toMatchObject({ code: "data-loss" });
    expect((await h.phaseApply()).idempotent).toBe(true);
    expect(h.store.has(instancePath())).toBe(false);
    h.store.set(instancePath(), instance);
    h.store.delete(`organizations/org-one/eventOperatingLedgers/${phase.snapshot.ledgerId}`);
    await expect(h.phaseApply({ ...phaseRequest, requestId: "workflow-orphan-phase-reset-001" })).rejects.toMatchObject({ code: "data-loss" });
    expect((await h.phaseApply()).idempotent).toBe(true);
  });
  test("event workflow callables enforce current staff authority gates and no public initialization", async () => {
    for (const options of [{ globalEnabled: "false" }, { tenantEnabled: false }]) {
      const h = callableHarness(options);
      await expect(h.eventWorkflow()).rejects.toMatchObject({ code: "failed-precondition" });
    }
    const h = callableHarness();
    await h.phaseApply();
    h.setStaff({ ...actor, uid: "sales-one", role: "sales", email: "sales@example.test" });
    expect((await h.eventWorkflow()).snapshot.availability).toBe("available");
    await expect(h.invoke("previewEventWorkflowMigration", { ...source, expectedRevision: 1 })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(h.invoke("applyEventWorkflowCommand", { ...source, requestId: "sales-wrong-owner-task-0001", expectedRevision: 1, command: "task_ack", taskKey: "review_event_context", note: "Wrong owner" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(h.invoke("applyEventWorkflowCommand", { ...source, requestId: "public-initialize-workflow-01", command: "initialize", expectedRevision: 0 })).rejects.toMatchObject({ code: "invalid-argument" });
    h.store.set("userRoles/sales-one", { organizationId: "other", role: "sales", email: "sales@example.test" });
    await expect(h.eventWorkflow()).rejects.toMatchObject({ code: "permission-denied" });
  });
});
