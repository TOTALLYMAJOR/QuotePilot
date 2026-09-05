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

describe("workflow configuration callable authority", () => {
  test("configuration reads exact seed only after bounded absence checks and never writes gates", async () => {
    const h = callableHarness();
    const before = structuredClone([...h.store]);
    const { snapshot } = await h.configuration();
    expect(snapshot.state).toBe("seed");
    expect(snapshot.activeVersion).toEqual(definitions.seedPublishedVersion());
    expect(snapshot.newInstanceEligible).toBe(true);
    expect([...h.store]).toEqual(before);
    expect(h.queries.filter((query) => query.path.includes("workflowDefinitions")).every((query) => query.maximum === 1)).toBe(true);
  });
  test("configuration callables require current admin tenant email and both gates", async () => {
    for (const options of [{ globalEnabled: "false" }, { tenantEnabled: false }, { staff: { ...actor, role: "sales" } }, { staff: { ...actor, organizationId: "other", principalOrganizationId: "other" } }]) {
      const h = callableHarness(options);
      const before = [...h.store];
      await expect(h.configuration()).rejects.toBeTruthy();
      await expect(h.invoke("applyWorkflowDefinitionCommand", draftRequest())).rejects.toBeTruthy();
      expect([...h.store]).toEqual(before);
    }
    const h = callableHarness();
    h.store.set("userRoles/admin-one", { organizationId: "org-one", role: "admin", email: "changed@example.test" });
    await expect(h.configuration()).rejects.toMatchObject({ code: "permission-denied" });
    await expect(h.invoke("getWorkflowConfiguration", { ...configScope, enabled: true })).rejects.toMatchObject({ code: "invalid-argument" });
  });
  test("configuration draft publication requires exact actor preview and immutable version creation", async () => {
    const h = callableHarness();
    const declared = { ...definitions.seedPublishedVersion().config, name: "Tenant event workflow", actualsReviewThresholdCents: 0 };
    const { result, request, version } = await publish(h, declared);
    expect(result.receipt.command).toBe("publish");
    expect(result.receipt.versionId).toBe("event_execution_v1");
    expect(result.snapshot).toBeUndefined();
    expect(version.config.actualsReviewThresholdCents).toBe(0);
    expect(version.publishedBy.uid).toBe(actor.uid);
    expect(h.store.get(`${definitionPath}/versions/event_execution_v1`)).toEqual(version);
    expect(h.store.get("organizations/org-one/settings/config").eventOperatingSpineEnabled).toBe(true);
    expect([...h.store.keys()].some((path) => path.includes("workflowInstances"))).toBe(false);
    await expect(h.invoke("applyWorkflowDefinitionCommand", { ...request, requestId: "configuration-publish-wrong-confirm", expectedRevision: 2, confirmationText: "PUBLISH without matching preview" })).rejects.toBeTruthy();
    expect(h.store.get(`${definitionPath}/versions/event_execution_v1`)).toEqual(version);
  });
  test("configuration concurrent drafts commit one CAS winner and no orphan receipt", async () => {
    const h = callableHarness();
    const outcomes = await Promise.allSettled([
      h.invoke("applyWorkflowDefinitionCommand", draftRequest(undefined, 0, "concurrent-one")),
      h.invoke("applyWorkflowDefinitionCommand", draftRequest(undefined, 0, "concurrent-two"))
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected").reason.code).toBe("aborted");
    expect(h.store.get(definitionPath).revision).toBe(1);
    expect([...h.store.keys()].filter((path) => path.includes("lifecycleReceipts"))).toHaveLength(1);
  });
  test("configuration retirement preserves versions and historical replay ignores current head freshness", async () => {
    const h = callableHarness();
    const published = await publish(h);
    const oldVersion = structuredClone(published.version);
    const retire = { ...configScope, requestId: "configuration-retire-first-0001", expectedRevision: 2, command: "retire", versionId: "event_execution_v1", reason: "Use a revised workflow for future events" };
    await h.invoke("applyWorkflowDefinitionCommand", retire);
    expect((await h.configuration()).snapshot.state).toBe("retired");
    expect((await h.configuration()).snapshot.newInstanceEligible).toBe(false);
    expect(h.store.get(`${definitionPath}/versions/event_execution_v1`)).toEqual(oldVersion);
    const before = [...h.store];
    const replay = await h.invoke("applyWorkflowDefinitionCommand", published.request);
    expect(replay.idempotent).toBe(true);
    expect([...h.store]).toEqual(before);
    await expect(h.invoke("applyWorkflowDefinitionCommand", { ...published.request, confirmationText: "Changed immutable payload" })).rejects.toMatchObject({ code: "already-exists" });
    h.store.delete(definitionPath);
    expect((await h.invoke("applyWorkflowDefinitionCommand", retire)).idempotent).toBe(true);
    await expect(h.configuration()).rejects.toMatchObject({ code: "data-loss" });
    await expect(h.invoke("applyWorkflowDefinitionCommand", draftRequest(undefined, 0, "orphan-reset"))).rejects.toMatchObject({ code: "data-loss" });
  });
  test("configuration rejects orphan versions corrupt receipts and unsupported runtime kinds", async () => {
    const orphan = callableHarness();
    orphan.store.set(`${definitionPath}/versions/event_execution_v1`, { retained: true });
    await expect(orphan.configuration()).rejects.toMatchObject({ code: "data-loss" });
    const h = callableHarness();
    await publish(h);
    const head = h.store.get(definitionPath);
    const receiptPath = `${definitionPath}/lifecycleReceipts/${head.lastReceiptId}`;
    h.store.set(receiptPath, { ...h.store.get(receiptPath), receiptDigest: "corrupt" });
    await expect(h.configuration()).rejects.toMatchObject({ code: "data-loss" });
    await expect(h.invoke("getWorkflowConfiguration", { ...configScope, workflowKind: "post_event_review" })).rejects.toMatchObject({ code: "invalid-argument" });
    const drift = callableHarness();
    drift.store.set(definitionPath, { schemaVersion: 999 });
    expect((await drift.configuration()).snapshot.availability).toBe("schema_drift");
    await expect(drift.phaseApply()).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
