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
const portalConversation = require("../../../functions/portalConversation.js");
const quoteDelivery = require("../../../functions/quoteDelivery.js");
const closeout = require("../../../functions/postEventCloseout.js");
const actor = { organizationId: "org-one", principalOrganizationId: "org-one", uid: "admin-one", role: "admin", email: "owner@example.test" };
const source = { organizationId: "org-one", quoteId: "quote-one", sourceVersionId: "v1", acceptanceReceiptId: "accepted-one" };
const nowISO = "2026-09-05T18:00:00.000Z";
const phaseRequest = { ...source, requestId: "history-phase-initialize-0001", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" };
const actualsRequest = { ...source, requestId: "history-actuals-record-0001", actualsPolicyVersion: 1, expectedActualsRevision: 0, command: "record", category: "other", description: "Declared cost", costCents: 100 };
function acceptedFixture() {
  const portalIssuedAtISO = "2026-09-01T12:00:00.000Z";
  const proposalSnapshot = { organizationId: source.organizationId, quoteId: source.quoteId, revisionId: `v1@${portalIssuedAtISO}`, portalIssuedAtISO };
  const snapshotSha256 = createHash("sha256").update(JSON.stringify(proposalSnapshot)).digest("hex");
  const acceptance = { receiptId: source.acceptanceReceiptId, organizationId: source.organizationId, quoteId: source.quoteId, quoteRevisionId: proposalSnapshot.revisionId, acceptedAtISO: "2026-09-02T12:00:00.000Z", portalIssuedAtISO, snapshotSha256, proposalSnapshot };
  const quote = { id: source.quoteId, organizationId: source.organizationId, customerId: "customer-one", status: "booked", activeVersionId: "v1", event: { date: "2026-09-16", guests: 80 }, booking: { bookedAtISO: "2026-09-02T13:00:00.000Z" }, acceptanceReceipt: acceptance };
  const version = { versionId: "v1", quoteId: source.quoteId, organizationId: source.organizationId, customerId: "customer-one", snapshot: { id: source.quoteId, organizationId: source.organizationId, customerId: "customer-one", event: quote.event } };
  return { quote, version, acceptance };
}
function callableHarness({ globalEnabled = "true", tenantEnabled = true, staff = actor } = {}) {
  const fixture = acceptedFixture();
  const orgPath = "organizations/org-one";
  const store = new Map([
    [orgPath, { active: true, status: "active" }],
    [`userRoles/${staff.uid}`, { organizationId: staff.organizationId, role: staff.role, email: staff.email }],
    [`${orgPath}/settings/config`, { eventOperatingSpineEnabled: tenantEnabled, businessTimeZone: "America/Chicago" }],
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
            && reference.filters.every((filter) => (filter.operator === "<=" && data[filter.field] <= filter.value || filter.operator === "==" && data[filter.field] === filter.value)));
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
      set: (reference, value) => writes.push([reference.path, value]),
      update: (reference, patch) => {
        const next = structuredClone(store.get(reference.path));
        for (const [key, value] of Object.entries(patch)) {
          const pieces = key.split("."); let target = next;
          for (const piece of pieces.slice(0, -1)) target = target[piece] ||= {};
          target[pieces.at(-1)] = value;
        }
        writes.push([reference.path, next]);
      }
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
  const sandbox = { ...closeout, FieldValue: { serverTimestamp: () => ({ localTimestamp: true }) }, normalizeOrganizationId: (value) => String(value || "").trim(), PortalConversationError: portalConversation.PortalConversationError, QuoteDeliveryError: quoteDelivery.QuoteDeliveryError, assertPortalConversationActivation: portalConversation.assertPortalConversationActivation, assertQuoteDeliveryPortalActivation: quoteDelivery.assertQuoteDeliveryPortalActivation, quoteAttendance: require("../../../functions/quoteAttendance.js"), workflowPackAdapters: require("../../../functions/workflowPackAdapters.js"), createHash, addCalendarDaysDateOnly: closeout.addCalendarDaysDateOnly, DECISION_DEBT_POLICIES_COLLECTION: "decisionDebtPolicies", PORTAL_COLLECTION: "quotePortals", decisionDebtPolicyRecord: (raw) => ({ revision: raw?.revision || 0, policy: require("../../../functions/decisionDebt.js").DEFAULT_DECISION_DEBT_POLICY }), workflowDefinitions: require("../../../functions/workflowDefinitions.js"), workflowExecution: require("../../../functions/workflowExecution.js"), eventWorkflowAdapter: require("../../../functions/eventWorkflowAdapter.js"), exports, eventOperations: phaseAuthority, eventOperatingWork: workAuthority, eventOperatingActuals: actualsAuthority, eventOperatingHistory: authority, PostEventCloseoutError: closeout.PostEventCloseoutError, db, REGION: "test", ORGANIZATIONS_COLLECTION: "organizations", QUOTES_COLLECTION: "quotes", ORGANIZATION_TOMBSTONES_COLLECTION: "organizationTombstones", PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION: "proposalAcceptanceReceipts", process: { env: { EVENT_OPERATING_SPINE_ENABLED: globalEnabled } }, functions: { region: () => ({ https: { onCall: (handler) => handler } }), https: { HttpsError }, logger: { error: () => {} } }, assertStaff: async () => staff, normalizeText: (value) => String(value || "").trim(), normalizeEmail: (value) => String(value || "").trim().toLowerCase(), isOrganizationRecordActive: (value) => value?.active !== false && value?.archived !== true && [undefined, "", "active"].includes(value?.status) };
  const index = readFileSync(new URL("../../../functions/index.js", import.meta.url), "utf8");
  const start = index.indexOf("function eventOperatingActor(");
  const end = index.indexOf("exports.recordPostEventCloseoutReview =", start);
  expect(start).toBeGreaterThan(0);
  vm.runInNewContext(index.slice(start, end), sandbox);
  const workStart = index.indexOf("async function readEventOperatingWorkPhase(");
  expect(workStart).toBeGreaterThan(end);
  vm.runInNewContext(index.slice(workStart), sandbox);
  const projectionStart = index.indexOf("function projectPostEventCloseoutToQuote(");
  vm.runInNewContext(index.slice(projectionStart, index.indexOf("function projectUnavailablePostEventCloseoutToQuote(", projectionStart)), sandbox);
  const closeoutStart = index.indexOf("exports.recordPostEventCloseoutReview =");
  const refreshStart = index.indexOf("exports.refreshPostEventCloseoutConfiguration =", closeoutStart);
  vm.runInNewContext(index.slice(closeoutStart, index.indexOf("exports.", refreshStart + 10)), sandbox);
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
    apply: (data = actualsRequest) => exports.applyEventOperatingActualsCommand(data, {})
  };
}


const attendanceScope = { accessMode: "staff", organizationId: source.organizationId, quoteId: source.quoteId };
const request = (revision = 0, suffix = "one") => ({ ...source, command: "request_confirmation", requestId: `attendance-request-${suffix}-00001`, expectedAttendanceRevision: revision });
async function publishPack(h, workflowKind) {
  const policy = workflowKind === "final_guest_count" ? { responsibleRoles: ["admin", "sales"] } : { responsibleRoles: ["admin"], followUpOffsetDays: 0 };
  const scope = { organizationId: source.organizationId, workflowKind };
  await h.invoke("applyWorkflowDefinitionCommand", { ...scope, requestId: `pack-config-save-${workflowKind}-0001`, expectedRevision: 0, command: "save_draft", config: { ...structuredClone(definitions.seedPublishedVersion().config), schemaVersion: 2, workflowKind, packPolicy: policy } });
  const { preview } = await h.invoke("previewWorkflowDefinition", { ...scope, expectedRevision: 1 });
  await h.invoke("applyWorkflowDefinitionCommand", { ...scope, requestId: `pack-config-publish-${workflowKind}-0001`, expectedRevision: 1, command: "publish", previewDigest: preview.previewDigest, confirmationText: preview.confirmationText });
}
describe("workflow pack runtime authority", () => {
  test("attendance callable uses exact accepted pricing and current role gates with atomic receipts", async () => {
    const h = callableHarness();
    const absent = await h.invoke("getQuoteAttendance", attendanceScope);
    expect(absent.snapshot).toMatchObject({ availability: "not_yet_available", pricedCount: 80, revision: 0 });
    await publishPack(h, "final_guest_count");
    const first = await h.invoke("applyQuoteAttendanceCommand", request());
    expect(first.receipt.command).toBe("request_confirmation");
    const snapshot = await h.invoke("getQuoteAttendance", attendanceScope);
    expect(snapshot.snapshot.request.dueDate).toBe("2026-09-09");
    expect([...h.store.keys()].filter((key) => key.includes("/workflowInstances/") && !key.includes("/receipts/")).length).toBe(1);
    const before = structuredClone([...h.store]);
    expect((await h.invoke("applyQuoteAttendanceCommand", request())).idempotent).toBe(true);
    expect([...h.store]).toEqual(before);
    h.store.get("userRoles/admin-one").role = "viewer";
    await expect(h.invoke("applyQuoteAttendanceCommand", request())).rejects.toMatchObject({ code: "permission-denied" });
    expect([...h.store.keys()]).toEqual(before.map(([key]) => key));
    const disabled = callableHarness({ tenantEnabled: false });
    await expect(disabled.invoke("getQuoteAttendance", attendanceScope)).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(disabled.invoke("applyQuoteAttendanceCommand", request())).rejects.toMatchObject({ code: "failed-precondition" });
  });
  test("attendance concurrent requests produce one winner and preserve commercial source bytes", async () => {
    const h = callableHarness();
    const quoteBefore = JSON.stringify(h.store.get("organizations/org-one/quotes/quote-one"));
    const results = await Promise.allSettled([h.invoke("applyQuoteAttendanceCommand", request(0, "left")), h.invoke("applyQuoteAttendanceCommand", request(0, "right"))]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.find((item) => item.status === "rejected").reason.code).toBe("aborted");
    expect([...h.store.keys()].filter((key) => key.includes("/quoteAttendance/") && key.includes("/receipts/")).length).toBe(1);
    expect(JSON.stringify(h.store.get("organizations/org-one/quotes/quote-one"))).toBe(quoteBefore);
    const journalPath = [...h.store.keys()].find((key) => key.includes("/quoteAttendance/") && !key.includes("/receipts/"));
    h.store.delete(journalPath);
    await expect(h.invoke("applyQuoteAttendanceCommand", request(0, "orphan"))).rejects.toMatchObject({ code: "data-loss" });
  });
});

describe("generic pack callable contract", () => {
  test("pack task commands bind exact current source and owner role while historical receipts survive source movement", async () => {
    const h = callableHarness();
    await publishPack(h, "final_guest_count");
    await h.invoke("applyQuoteAttendanceCommand", request());
    const scope = { organizationId: source.organizationId, quoteId: source.quoteId, workflowKind: "final_guest_count" };
    const first = await h.invoke("getWorkflowPackSnapshot", scope);
    expect(first.snapshot.schemaVersion).toBe(2);
    expect(first.snapshot.domainRef.stateCode).toBe("requested");
    expect(first.snapshot.due.kind).toBe("tenant_calendar_date");
    const command = { ...scope, sourceVersionId: source.sourceVersionId, sourceReceiptId: source.acceptanceReceiptId,
      requestId: "pack-task-acknowledge-0001", expectedRevision: 1, command: "task_ack", taskKey: "review_event_context", note: "Reviewed the requested guest count" };
    const before = structuredClone([...h.store]);
    h.setStaff({ ...actor, uid: "sales-one", role: "sales" });
    await expect(h.invoke("applyWorkflowPackCommand", command)).rejects.toMatchObject({ code: "permission-denied" });
    expect([...h.store.keys()].filter((key) => key.includes("/receipts/")).length).toBe(before.filter(([key]) => key.includes("/receipts/")).length);
    h.setStaff(actor);
    const applied = await h.invoke("applyWorkflowPackCommand", command);
    expect(applied.receipt.resultRevision).toBe(2);
    const quote = h.store.get("organizations/org-one/quotes/quote-one");
    h.store.set("organizations/org-one/quotes/quote-one", { ...quote, activeVersionId: "v2" });
    expect((await h.invoke("applyWorkflowPackCommand", command)).idempotent).toBe(true);
    await expect(h.invoke("getWorkflowPackSnapshot", scope)).rejects.toBeDefined();
    await expect(h.invoke("applyWorkflowPackCommand", { ...scope, sourceVersionId: "v1", sourceReceiptId: source.acceptanceReceiptId, requestId: "pack-public-initialize-001", command: "initialize", expectedRevision: 0 })).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

describe("version two event callable integration", () => {
  test("event callables enforce tenant checkpoints with native receipts and reject alternate-schema bindings", async () => {
    const h = callableHarness();
    const scope = { organizationId: source.organizationId, workflowKind: "event_execution" };
    const config = { ...structuredClone(definitions.seedPublishedVersion().config), schemaVersion: 2,
      packPolicy: { phaseConstraints: { in_progress: { requiredCheckpoints: ["venue_access"], blockOpenUrgentIssues: true }, completed: { requiredCheckpoints: [], blockOpenUrgentIssues: false } }, checkpointPrerequisites: { venue_access: [], team_briefing: ["venue_access"], service_handoff: [], pack_down: [] } } };
    await h.invoke("applyWorkflowDefinitionCommand", { ...scope, requestId: "event-pack-config-save-0001", expectedRevision: 0, command: "save_draft", config });
    const { preview } = await h.invoke("previewWorkflowDefinition", { ...scope, expectedRevision: 1 });
    await h.invoke("applyWorkflowDefinitionCommand", { ...scope, requestId: "event-pack-config-publish-0001", expectedRevision: 1, command: "publish", previewDigest: preview.previewDigest, confirmationText: preview.confirmationText });
    await h.phaseApply();
    const before = await h.eventWorkflow();
    expect(before.snapshot.schemaVersion).toBe(2);
    expect(before.snapshot.domainRef.evidenceId).toBe(before.snapshot.phaseReceiptId);
    const move = { ...phaseRequest, requestId: "event-pack-transition-0001", expectedLedgerRevision: 1, targetPhase: "in_progress", command: "transition" };
    const keys = [...h.store.keys()];
    await expect(h.phaseApply(move)).rejects.toMatchObject({ code: "failed-precondition" });
    expect([...h.store.keys()]).toEqual(keys);
    const work = { ...source, requestId: "event-pack-checkpoint-0001", workPolicyVersion: 1, expectedWorkRevision: 0, command: "checkpoint_record", checkpointCode: "venue_access", note: "" };
    await h.workApply(work);
    await h.phaseApply(move);
    const after = await h.eventWorkflow();
    expect(after.snapshot.domainRef.stateCode).toBe("in_progress");
    expect(after.snapshot.phaseRevision).toBe(2);
    const proofs = [...h.store.entries()].filter(([path]) => path.includes("/observations/"));
    expect(proofs).toHaveLength(2);
    const adapters = require("../../../functions/workflowPackAdapters.js");
    for (const [, proof] of proofs) expect(adapters.verifyEventConstraintProof(proof)).toEqual(proof);
    const workProof = proofs.find(([, proof]) => proof.sourceChannel === "work");
    h.store.delete(workProof[0]);
    await expect(h.workApply(work)).rejects.toMatchObject({ code: "data-loss" });
    h.store.set(...workProof);
    const phaseProof = proofs.find(([, proof]) => proof.sourceChannel === "phase");
    h.store.delete(phaseProof[0]);
    await expect(h.phaseApply(move)).rejects.toMatchObject({ code: "data-loss" });
    h.store.set(...phaseProof);
    const nativeWork = [...h.store].filter(([path]) => path.includes("/workState/") || path.includes("/workReceipts/"));
    nativeWork.forEach(([path]) => h.store.delete(path));
    await expect(h.invoke("getEventOperatingWorkSnapshot", { organizationId: source.organizationId, quoteId: source.quoteId })).rejects.toMatchObject({ code: "data-loss" });
    await expect(h.workApply({ ...work, requestId: "event-pack-reset-attempt-0001" })).rejects.toMatchObject({ code: "data-loss" });
    nativeWork.forEach(([path, value]) => h.store.set(path, value));
    const task = { ...source, requestId: "event-pack-old-api-task-0001", command: "task_ack", expectedRevision: 2, taskKey: "review_event_context", note: "Reviewed exact phase outcome" };
    expect((await h.invoke("applyEventWorkflowCommand", task)).receipt.resultRevision).toBe(3);
    const legacy = eventAdapter.planEventCommand({ request: phaseRequest, actor, source, definition: definitions.seedPublishedVersion(), nowISO });
    const path = `organizations/org-one/workflowInstances/${legacy.workflowPlan.nextInstance.instanceId}`;
    h.store.set(path, legacy.workflowPlan.nextInstance);
    h.store.set(`${path}/receipts/${legacy.workflowPlan.receipt.receiptId}`, legacy.workflowPlan.receipt);
    await expect(h.eventWorkflow()).rejects.toMatchObject({ code: "data-loss" });
  });
});


describe("attendance portal and paired replay integrity", () => {
  test("portal attendance uses actual delivery activation and preserves paired replay proof", async () => {
    const h = callableHarness();
    const portalKey = "local-portal-attendance-000001";
    const quote = h.store.get("organizations/org-one/quotes/quote-one");
    const portalIssuedAtISO = quote.acceptanceReceipt.portalIssuedAtISO;
    const portalExpiresAtISO = "2027-09-01T12:00:00.000Z";
    const delivery = { state: "provider_accepted", portalActivationState: "active", revisionId: `v1@${portalIssuedAtISO}`,
      portalKey, portalIssuedAtISO, providerAcceptedAtISO: "2026-09-01T12:01:00.000Z", providerMessageId: "local-provider-observation-only" };
    Object.assign(quote, { portalKey, portalIssuedAtISO, portalExpiresAtISO, workflow: { quoteDelivery: delivery } });
    h.store.set(`quotePortals/${portalKey}`, { organizationId: source.organizationId, quoteId: source.quoteId,
      portalKey, portalIssuedAtISO, portalExpiresAtISO, status: "booked", deliveryEvidence: delivery });
    await publishPack(h, "final_guest_count");
    const first = await h.invoke("applyQuoteAttendanceCommand", request());
    const read = await h.invoke("getQuoteAttendance", { accessMode: "portal", portalKey });
    expect(read.snapshot.request.requestReceiptId).toBe(first.receipt.receiptId);
    expect(read.snapshot).not.toHaveProperty("acceptanceReceiptId");
    expect(h.store.get(`quotePortals/${portalKey}`).attendanceAvailable).toBe(true);
    const input = { portalKey, confirmationRequestId: first.receipt.receiptId, expectedSourceVersionId: "v1", expectedPortalIssuedAtISO: portalIssuedAtISO,
      expectedAttendanceRevision: 1, requestId: "portal-attendance-submit-00001", count: 91 };
    const response = await h.invoke("submitQuoteAttendanceResponse", input);
    expect(response.receipt).toMatchObject({ count: 91, sourceType: "customer_portal" });
    expect((await h.invoke("submitQuoteAttendanceResponse", input)).idempotent).toBe(true);
    const nativeQuote = structuredClone(quote);
    expect(quote.event.guests).toBe(80);
    const receiptPath = [...h.store].find(([path, value]) => path.includes("/workflowInstances/") && path.includes("/receipts/") && value.request.requestId === input.requestId)[0];
    const storedReceipt = h.store.get(receiptPath);
    h.store.delete(receiptPath);
    await expect(h.invoke("submitQuoteAttendanceResponse", input)).rejects.toMatchObject({ code: "data-loss" });
    h.store.set(receiptPath, storedReceipt);
    quote.workflow.quoteDelivery.portalActivationState = "inactive";
    await expect(h.invoke("getQuoteAttendance", { accessMode: "portal", portalKey })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(h.invoke("submitQuoteAttendanceResponse", input)).rejects.toMatchObject({ code: "failed-precondition" });
    expect(quote.event).toEqual(nativeQuote.event);
  });
  test("native attendance retries predating configuration stay valid but missing paired commands fail closed", async () => {
    const h = callableHarness();
    const legacy = request(0, "legacy");
    await h.invoke("applyQuoteAttendanceCommand", legacy);
    await publishPack(h, "final_guest_count");
    const bound = request(1, "bound");
    await h.invoke("applyQuoteAttendanceCommand", bound);
    expect((await h.invoke("applyQuoteAttendanceCommand", legacy)).idempotent).toBe(true);
    const pair = [...h.store].find(([path, value]) => path.includes("/workflowInstances/") && path.includes("/receipts/") && value.request.requestId === bound.requestId);
    h.store.delete(pair[0]);
    await expect(h.invoke("applyQuoteAttendanceCommand", bound)).rejects.toMatchObject({ code: "data-loss" });
  });
});


describe("closeout owner callable workflow coordination", () => {
  test("native review and configuration refresh retain paired proofs without granting completion", async () => {
    const h = callableHarness();
    const quote = h.store.get("organizations/org-one/quotes/quote-one");
    const version = h.store.get("organizations/org-one/quotes/quote-one/versions/v1");
    quote.event.date = "2026-08-20";
    version.snapshot.event.date = quote.event.date;
    const record = closeout.buildPostEventCloseoutRecord({ organizationId: source.organizationId, quoteId: source.quoteId,
      sourceQuote: quote, sourceVersion: version, acceptanceReceiptDocument: h.fixture.acceptance,
      settings: { businessTimeZone: "America/Chicago" }, actor, nowISO: "2026-09-03T12:00:00.000Z" });
    const recordPath = `organizations/org-one/postEventCloseouts/${record.closeoutId}`;
    h.store.set(recordPath, record);
    await publishPack(h, "closeout_follow_up");
    const command = { organizationId: source.organizationId, quoteId: source.quoteId, closeoutId: record.closeoutId,
      itemCode: "internal_closeout", action: "review", requestId: "closeout-real-handler-review-0001", note: "Reviewed the internal closeout" };
    const reviewed = await h.invoke("recordPostEventCloseoutReview", command);
    expect(reviewed.receipt.resultItemState).toBe("reviewed");
    const scope = { organizationId: source.organizationId, quoteId: source.quoteId, workflowKind: "closeout_follow_up" };
    expect((await h.invoke("getWorkflowPackSnapshot", scope)).snapshot.domainRef.stateCode).toBe("pending");
    const settings = h.store.get("organizations/org-one/settings/config");
    settings.businessTimeZone = "America/New_York";
    const refresh = { organizationId: source.organizationId, quoteId: source.quoteId, closeoutId: record.closeoutId, requestId: "closeout-real-handler-refresh-0001" };
    const changed = await h.invoke("refreshPostEventCloseoutConfiguration", refresh);
    expect(changed.receipt.resultTimeZone).toBe("America/New_York");
    expect((await h.invoke("getWorkflowPackSnapshot", scope)).snapshot.domainRef.evidenceId).toBe(changed.receipt.receiptId);
    expect((await h.invoke("refreshPostEventCloseoutConfiguration", refresh)).idempotent).toBe(true);
    const proofs = [...h.store].filter(([path]) => path.includes("/observations/"));
    expect(proofs).toHaveLength(2);
    proofs.forEach(([, proof]) => expect(require("../../../functions/workflowPackAdapters.js").verifyCloseoutObservationProof(proof)).toEqual(proof));
    expect(h.store.get(recordPath).state).toBe("pending");
    const before = structuredClone([...h.store]);
    settings.eventOperatingSpineEnabled = false;
    await expect(h.invoke("refreshPostEventCloseoutConfiguration", { ...refresh, requestId: "closeout-disabled-refresh-0001" })).rejects.toMatchObject({ code: "failed-precondition" });
    expect([...h.store.keys()]).toEqual(before.map(([path]) => path));
  });
});
