import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const authority = require("../../../functions/eventOperatingHistory.js");
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
    ["userRoles/admin-one", { organizationId: "org-one", role: "admin", email: actor.email }],
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
  const db = { collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }), runTransaction: async (fn) => {
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
    history: (data = { organizationId: source.organizationId, quoteId: source.quoteId }) => exports.getEventOperatingHistory(data, {}),
    phaseRead: () => exports.getEventOperatingSnapshot(source, {}),
    phaseApply: (data = phaseRequest) => exports.applyEventOperatingCommand(data, {}),
    workApply: (data) => exports.applyEventOperatingWorkCommand(data, {}),
    read: (data = { organizationId: source.organizationId, quoteId: source.quoteId }) => exports.getEventOperatingActualsSnapshot(data, {}),
    apply: (data = request) => exports.applyEventOperatingActualsCommand(data, {})
  };
}

function historyFixture({ workCount = 25, actualsCount = 25, phaseCount = 3 } = {}) {
  const records = { phase: [], work: [], actuals: [] };
  let phase = phaseAuthority.planCommand({ request: phaseRequest, actor, source, nowISO });
  records.phase.push({ id: phase.receipt.receiptId, data: phase.receipt });
  for (let revision = 2; revision <= phaseCount; revision += 1) {
    phase = phaseAuthority.planCommand({ request: { ...phaseRequest, requestId: `history-phase-transition-${revision}`, command: "transition", expectedLedgerRevision: revision - 1, targetPhase: revision === 2 ? "in_progress" : "completed" }, actor, source, ledger: phase.nextLedger, nowISO });
    records.phase.push({ id: phase.receipt.receiptId, data: phase.receipt });
  }
  const result = { records, phase };
  appendWork(result, workCount);
  let actuals = null;
  for (let revision = 1; revision <= actualsCount; revision += 1) {
    actuals = actualsAuthority.planCommand({
      request: { ...source, requestId: `history-actual-declaration-${revision}`, actualsPolicyVersion: 1, expectedActualsRevision: revision - 1, command: "declare_category", category: "other", state: "partial", note: `Operator capture note ${revision}` },
      actor, source, phaseSnapshot: phase.snapshot, actualsState: actuals?.nextActualsState || null,
      currentReceipt: actuals?.receipt || null, nowISO
    });
    records.actuals.push({ id: actuals.receipt.receiptId, data: actuals.receipt });
  }
  return result;
}
function appendWork(fixture, count = 1) {
  let previous = fixture.records.work.at(-1)?.data || null;
  for (let index = 0; index < count; index += 1) {
    const revision = previous?.resultRevision || 0;
    const command = revision % 2 === 0 ? "checkpoint_record" : "checkpoint_reopen";
    const work = workAuthority.planCommand({
      request: { ...source, requestId: `history-work-checkpoint-${revision + 1}`, workPolicyVersion: 1, expectedWorkRevision: revision, command, checkpointCode: "venue_access", note: `Operator checkpoint note ${revision + 1}` },
      actor, source, phaseSnapshot: fixture.phase.snapshot,
      workState: previous?.resultWorkState || null, currentReceipt: previous, nowISO
    });
    fixture.records.work.push({ id: work.receipt.receiptId, data: work.receipt });
    previous = work.receipt;
  }
}
function heads(fixture) {
  return Object.fromEntries(authority.CHANNELS.map((channel) => {
    const last = fixture.records[channel].at(-1);
    return [channel, { revision: last?.data.resultRevision || 0, receiptId: last?.id || "" }];
  }));
}
function pageInputs(fixture, cursor = null) {
  const page = authority.preparePage({ source, currentHeads: heads(fixture), cursor: typeof cursor === "string" ? authority.decodeCursor(cursor) : cursor });
  const anchorDocuments = {};
  const boundaryDocuments = {};
  const documents = {};
  for (const channel of authority.CHANNELS) {
    anchorDocuments[channel] = fixture.records[channel].find((item) => item.id === page.anchors[channel].receiptId) || null;
    boundaryDocuments[channel] = fixture.records[channel].find((item) => item.id === page.positions[channel].lastConsumedReceiptId) || null;
    documents[channel] = [...fixture.records[channel]]
      .filter((item) => item.data.resultRevision <= page.positions[channel].nextRevision)
      .sort((a, b) => b.data.resultRevision - a.data.resultRevision)
      .slice(0, 20);
  }
  return { page, anchorDocuments, boundaryDocuments, documents };
}
function seedHistory(harness, fixture) {
  const path = `organizations/org-one/eventOperatingLedgers/${phaseAuthority.ledgerIdFor(source)}`;
  harness.store.set(path, structuredClone(fixture.records.phase.at(-1).data.resultLedger));
  for (const [channel, collectionName] of Object.entries({ phase: "receipts", work: "workReceipts", actuals: "actualsReceipts" })) {
    for (const item of fixture.records[channel]) harness.store.set(`${path}/${collectionName}/${item.id}`, structuredClone(item.data));
  }
  if (fixture.records.work.length) harness.store.set(`${path}/workState/current`, structuredClone(fixture.records.work.at(-1).data.resultWorkState));
  if (fixture.records.actuals.length) harness.store.set(`${path}/actualsState/current`, structuredClone(fixture.records.actuals.at(-1).data.resultActualsState));
}

describe("bounded operational history authority", () => {
  test("history paginates deterministic timestamp ties without gaps or duplicates", () => {
    const fixture = historyFixture();
    const collected = [];
    let cursor = null;
    let final;
    do {
      final = authority.buildPage(pageInputs(fixture, cursor));
      expect(final.rows.length).toBeLessThanOrEqual(20);
      expect(final.anchors).toEqual(heads(fixture));
      collected.push(...final.rows);
      cursor = final.nextCursor;
    } while (cursor);
    expect(collected).toHaveLength(53);
    expect(new Set(collected.map((row) => row.receiptId)).size).toBe(53);
    expect(collected.map((row) => `${row.channel}:${row.resultRevision}`)).toEqual([
      ...[3, 2, 1].map((revision) => `phase:${revision}`),
      ...Array.from({ length: 25 }, (_, index) => `work:${25 - index}`),
      ...Array.from({ length: 25 }, (_, index) => `actuals:${25 - index}`)
    ]);
    expect(final.completeForAnchors).toBe(true);
    expect(final.historyCoverage).toBe("operational_channels_at_anchors");
  });

  test("history keeps pinned heads while newer writes become available", () => {
    const fixture = historyFixture();
    const first = authority.buildPage(pageInputs(fixture));
    const originalAnchors = structuredClone(first.anchors);
    appendWork(fixture, 3);
    const second = authority.buildPage(pageInputs(fixture, first.nextCursor));
    expect(second.anchors).toEqual(originalAnchors);
    expect(second.newerAvailable).toBe(true);
    expect(second.rows.some((row) => row.channel === "work" && row.resultRevision > 25)).toBe(false);
    expect(authority.buildPage(pageInputs(fixture)).anchors.work.revision).toBe(28);
  });

  test("history cursor rejects forged bounds unsupported fields and source changes", () => {
    const fixture = historyFixture();
    const first = authority.buildPage(pageInputs(fixture));
    const cursor = authority.decodeCursor(first.nextCursor);
    expect(authority.encodeCursor(cursor)).toBe(first.nextCursor);
    expect(() => authority.normalizeRequest({ organizationId: "org-one", quoteId: "quote-one", cursor: "!" })).toThrow(/bounded/);
    expect(() => authority.normalizeRequest({ organizationId: "org-one", quoteId: "quote-one", limit: 100 })).toThrow(/unsupported/);
    expect(() => authority.normalizeRequest({ organizationId: "other-org", quoteId: "quote-one", cursor: first.nextCursor })).toThrow(/does not match/);
    const bad = structuredClone(cursor);
    bad.positions.work.nextRevision = bad.anchors.work.revision + 1;
    expect(() => authority.encodeCursor(bad)).toThrow(/outside/);
    expect(() => authority.preparePage({ source: { ...source, acceptanceReceiptId: "accepted-two" }, currentHeads: heads(fixture), cursor })).toThrow(/source changed/);
    const oversized = structuredClone(cursor);
    oversized.anchors.actuals.revision = Number.MAX_SAFE_INTEGER;
    oversized.positions.actuals.nextRevision = Number.MAX_SAFE_INTEGER;
    expect(() => authority.preparePage({ source, currentHeads: heads(fixture), cursor: oversized })).toThrow(/exceeds/);
    const boundary = structuredClone(cursor);
    boundary.positions.work.lastConsumedReceiptId = fixture.records.work[0].id;
    expect(() => authority.buildPage(pageInputs(fixture, boundary))).toThrow(/boundary/);
  });

  test("history fails closed on missing duplicate or corrupt receipts", () => {
    const fixture = historyFixture();
    const missing = pageInputs(fixture);
    missing.documents.work.splice(2, 1);
    expect(() => authority.buildPage(missing)).toThrow(/missing receipt/);
    const gap = pageInputs(fixture);
    gap.documents.work[2] = gap.documents.work[3];
    expect(() => authority.buildPage(gap)).toThrow(/gap or duplicate/);
    const corrupt = structuredClone(pageInputs(fixture));
    corrupt.documents.actuals[0].data.commandDigest = "tampered";
    expect(() => authority.buildPage(corrupt)).toThrow();
    const missingResult = structuredClone(fixture.records.phase[0]);
    delete missingResult.data.resultLedger;
    expect(() => authority.verifyRow("phase", missingResult, source)).toThrow(/no verified result/);
    const badAnchor = pageInputs(fixture);
    badAnchor.anchorDocuments.work = null;
    expect(() => authority.buildPage(badAnchor)).toThrow(/unavailable/);
  });

  test("history rejects revision order contradicted by recorded timestamps", () => {
    const fixture = historyFixture({ phaseCount: 1, workCount: 0, actualsCount: 0 });
    const running = phaseAuthority.planCommand({ request: { ...phaseRequest, requestId: "history-clock-reversal-0001", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" }, actor, source, ledger: fixture.phase.nextLedger, nowISO: "2026-09-05T17:59:59.000Z" });
    fixture.records.phase.push({ id: running.receipt.receiptId, data: running.receipt });
    expect(() => authority.buildPage(pageInputs(fixture))).toThrow(/timestamps contradict/);
  });

  test("history projects typed before after targets without raw private envelopes", () => {
    const fixture = historyFixture({ workCount: 1, actualsCount: 1 });
    const projected = authority.buildPage(pageInputs(fixture));
    expect(projected.rows.find((row) => row.channel === "phase")).toMatchObject({ targetType: "phase", actor: { uid: actor.uid, role: "admin" } });
    expect(projected.rows.find((row) => row.channel === "work")).toMatchObject({ targetType: "checkpoint", before: { state: "not_recorded" }, after: { state: "recorded" } });
    expect(projected.rows.find((row) => row.channel === "actuals")).toMatchObject({ targetType: "actuals_category", before: { state: "not_declared", note: "" }, after: { state: "partial" } });
    for (const forbidden of ["commandDigest", "resultActualsState", "priorActualsState", "resultWorkState", "resultLedger", actor.email, '"request":']) expect(JSON.stringify(projected)).not.toContain(forbidden);
    const cost = actualsAuthority.planCommand({ request, actor, source, phaseSnapshot: fixture.phase.snapshot, nowISO });
    const row = authority.verifyRow("actuals", { id: cost.receipt.receiptId, data: cost.receipt }, source);
    expect(row.before).toBeNull();
    expect(row.after).toEqual({ category: "other", state: "active", description: "Declared cost", costCents: 100, durationMinutes: null, laborRole: "" });
    const opened = workAuthority.planCommand({ request: { ...source, requestId: "history-issue-open-0001", workPolicyVersion: 1, expectedWorkRevision: 0, command: "issue_open", severity: "urgent", note: "Access blocked" }, actor, source, phaseSnapshot: fixture.phase.snapshot, nowISO });
    const issue = authority.verifyRow("work", { id: opened.receipt.receiptId, data: opened.receipt }, source);
    expect(issue.before).toBeNull();
    expect(issue.after).toEqual({ state: "open", description: "Access blocked", severity: "urgent" });
  });
});

describe("operational history callable wiring", () => {
  test("history callable pages verified streams with bounded queries and no writes", async () => {
    const harness = callableHarness();
    const fixture = historyFixture();
    seedHistory(harness, fixture);
    const before = JSON.stringify([...harness.store]);
    const first = await harness.history();
    expect(first.snapshot.rows).toHaveLength(20);
    const second = await harness.history({ organizationId: "org-one", quoteId: "quote-one", cursor: first.snapshot.nextCursor });
    expect(second.snapshot.rows).toHaveLength(20);
    expect(JSON.stringify([...harness.store])).toBe(before);
    expect(harness.queries.every((query) => [1, 20].includes(query.maximum))).toBe(true);
    expect(harness.queries.some((query) => query.maximum === 20 && query.filters[0].field === "resultRevision")).toBe(true);
  });

  test("history callable respects current roles gates exact source and snapshot anchors", async () => {
    const fixture = historyFixture();
    const harness = callableHarness();
    seedHistory(harness, fixture);
    const first = await harness.history();
    appendWork(fixture, 1);
    seedHistory(harness, fixture);
    const next = await harness.history({ organizationId: "org-one", quoteId: "quote-one", cursor: first.snapshot.nextCursor });
    expect(next.snapshot.newerAvailable).toBe(true);
    expect(next.snapshot.anchors).toEqual(first.snapshot.anchors);
    const changed = { ...harness.fixture.acceptance, receiptId: "accepted-two" };
    harness.store.set("organizations/org-one/proposalAcceptanceReceipts/accepted-two", changed);
    harness.store.set("organizations/org-one/quotes/quote-one", { ...harness.fixture.quote, acceptanceReceipt: changed });
    await expect(harness.history({ organizationId: "org-one", quoteId: "quote-one", cursor: first.snapshot.nextCursor })).rejects.toMatchObject({ code: "aborted" });
    expect((await harness.history()).snapshot.reasonCode).toBe("phase_ledger_missing");
    for (const type of ["global", "tenant", "role", "crossTenant"]) {
      const denied = callableHarness(type === "global" ? { globalEnabled: "false" } : type === "tenant" ? { tenantEnabled: false } : type === "crossTenant" ? { staff: { ...actor, principalOrganizationId: "other-org" } } : {});
      seedHistory(denied, fixture);
      if (type === "role") denied.store.set("userRoles/admin-one", { organizationId: "org-one", role: "customer" });
      const before = JSON.stringify([...denied.store]);
      await expect(denied.history()).rejects.toHaveProperty("code");
      expect(JSON.stringify([...denied.store])).toBe(before);
    }
    const sales = callableHarness({ staff: { ...actor, role: "sales" } });
    seedHistory(sales, fixture);
    sales.store.set("userRoles/admin-one", { organizationId: "org-one", role: "sales", email: actor.email });
    expect((await sales.history()).snapshot.availability).toBe("available");
  });

  test("history missing state and retained receipts fail closed across all channels", async () => {
    for (const missing of ["phase", "work", "actuals"]) {
      const harness = callableHarness();
      const fixture = historyFixture({ workCount: 1, actualsCount: 1 });
      seedHistory(harness, fixture);
      const ledgerPath = `organizations/org-one/eventOperatingLedgers/${phaseAuthority.ledgerIdFor(source)}`;
      harness.store.delete(missing === "phase" ? ledgerPath : `${ledgerPath}/${missing === "work" ? "workState" : "actualsState"}/current`);
      const before = JSON.stringify([...harness.store]);
      await expect(harness.history()).rejects.toMatchObject({ code: "data-loss" });
      expect(JSON.stringify([...harness.store])).toBe(before);
    }
  });

  test("history rejects a historical gap even when the current head remains valid", async () => {
    const harness = callableHarness();
    const fixture = historyFixture();
    seedHistory(harness, fixture);
    const ledgerPath = `organizations/org-one/eventOperatingLedgers/${phaseAuthority.ledgerIdFor(source)}`;
    harness.store.delete(`${ledgerPath}/workReceipts/${fixture.records.work[20].id}`);
    await expect(harness.history()).rejects.toMatchObject({ code: "data-loss" });
  });
});
