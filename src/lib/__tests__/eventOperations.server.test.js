import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const authority = require("../../../functions/eventOperations.js");
const closeout = require("../../../functions/postEventCloseout.js");
const actor = { organizationId: "org-one", principalOrganizationId: "org-one", uid: "admin-one", role: "admin", email: "owner@example.test" };
const source = { organizationId: "org-one", quoteId: "quote-one", sourceVersionId: "v1", acceptanceReceiptId: "accepted-one" };
const nowISO = "2026-09-05T18:00:00.000Z";
const request = { ...source, requestId: "event-operation-request-0001", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" };
const initialize = () => authority.planCommand({ request, actor, source, nowISO });
const transition = (initial, extras = {}) => authority.planCommand({ request: { ...request, requestId: "event-operation-request-0002", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress", ...extras }, actor, source, ledger: initial.nextLedger, nowISO });

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
  const ref = (path) => ({
    path, id: path.split("/").at(-1),
    collection: (name) => ({
      doc: (id) => ref(`${path}/${name}/${id}`),
      limit: (maximum) => ({ path: `${path}/${name}`, queryPrefix: `${path}/${name}/`, maximum })
    })
  });
  const db = { collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }), runTransaction: async (fn) => {
    const writes = [];
    const tx = {
      get: async (reference) => {
        reads.push(reference.path);
        if (reference.queryPrefix) {
          const rows = [...store].filter(([path]) => path.startsWith(reference.queryPrefix)
            && !path.slice(reference.queryPrefix.length).includes("/"))
            .slice(0, reference.maximum);
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
  const sandbox = { workflowDefinitions: require("../../../functions/workflowDefinitions.js"), workflowExecution: require("../../../functions/workflowExecution.js"), eventWorkflowAdapter: require("../../../functions/eventWorkflowAdapter.js"), exports, eventOperations: authority, PostEventCloseoutError: closeout.PostEventCloseoutError, db, REGION: "test", ORGANIZATIONS_COLLECTION: "organizations", QUOTES_COLLECTION: "quotes", ORGANIZATION_TOMBSTONES_COLLECTION: "organizationTombstones", PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION: "proposalAcceptanceReceipts", process: { env: { EVENT_OPERATING_SPINE_ENABLED: globalEnabled } }, functions: { region: () => ({ https: { onCall: (handler) => handler } }), https: { HttpsError }, logger: { error: () => {} } }, assertStaff: async () => staff, normalizeText: (value) => String(value || "").trim(), normalizeEmail: (value) => String(value || "").trim().toLowerCase(), isOrganizationRecordActive: (value) => value?.active !== false && value?.archived !== true && [undefined, "", "active"].includes(value?.status) };
  const index = readFileSync(new URL("../../../functions/index.js", import.meta.url), "utf8");
  const start = index.indexOf("function eventOperatingActor(");
  const end = index.indexOf("exports.recordPostEventCloseoutReview =", start);
  expect(start).toBeGreaterThan(0);
  vm.runInNewContext(index.slice(start, end), sandbox);
  return { store, reads, fixture, read: (data = source) => exports.getEventOperatingSnapshot(data, {}), apply: (data = request) => exports.applyEventOperatingCommand(data, {}) };
}

describe("event operating authority", () => {
  test("requires both environment and tenant gates", () => {
    expect(() => authority.assertEnabled(false, { eventOperatingSpineEnabled: true })).toThrow(/not enabled/);
    expect(() => authority.assertEnabled(true, { eventOperatingSpineEnabled: "true" })).toThrow(/not enabled/);
    expect(() => authority.assertEnabled(true, { eventOperatingSpineEnabled: true })).not.toThrow();
  });
  test("rejects cross-tenant actors and sales mutations", () => {
    expect(() => authority.planCommand({ request, actor: { ...actor, organizationId: "elsewhere" }, source, nowISO })).toThrow(/administrator/);
    expect(() => authority.planCommand({ request, actor: { ...actor, role: "sales" }, source, nowISO })).toThrow(/administrator/);
    expect(() => authority.normalizeActor({ ...actor, role: "sales" }, source.organizationId)).not.toThrow();
  });
  test("initializes and advances only the fixed phase sequence", () => {
    const initial = initialize();
    expect(initial.snapshot.phase).toBe("prepared");
    expect(() => transition(initial, { targetPhase: "completed" })).toThrow(/not allowed/);
    const running = transition(initial);
    const completed = authority.planCommand({ request: { ...request, requestId: "event-operation-request-0003", command: "transition", expectedLedgerRevision: 2, targetPhase: "completed" }, actor, source, ledger: running.nextLedger, nowISO });
    expect(completed.snapshot).toMatchObject({ revision: 3, phase: "completed", historyCoverage: "latest_receipt_only" });
    expect(() => authority.planCommand({ request: { ...request, command: "transition", expectedLedgerRevision: 3, targetPhase: "prepared" }, actor, source, ledger: completed.nextLedger, nowISO })).toThrow(/not allowed/);
  });
  test("rejects stale accepted source and stale ledger revisions", () => {
    expect(() => authority.planCommand({ request, actor, source: { ...source, acceptanceReceiptId: "new-acceptance" }, nowISO })).toThrow(/accepted source changed/);
    expect(() => transition(initialize(), { expectedLedgerRevision: 2 })).toThrow(/phase changed/);
  });
  test("reconciles identical commands and rejects request or actor substitution", () => {
    const first = initialize();
    const replay = authority.planCommand({ request, actor, existingReceipt: first.receipt });
    expect(replay.idempotent).toBe(true);
    expect(replay.nextLedger).toBeNull();
    expect(replay.snapshot).toEqual(first.snapshot);
    expect(() => authority.planCommand({ request: { ...request, command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" }, actor, existingReceipt: first.receipt })).toThrow(/different immutable command/);
    expect(() => authority.planCommand({ request, actor: { ...actor, uid: "other-admin" }, existingReceipt: first.receipt })).toThrow(/different immutable command/);
  });
  test("rejects tampered immutable receipts", () => {
    const first = initialize();
    expect(() => authority.planCommand({ request, actor, existingReceipt: { ...first.receipt, resultPhase: "completed" } })).toThrow(/integrity/);
    expect(() => authority.projectSnapshot(source, { ...first.nextLedger, phase: "completed" }, first.receipt)).toThrow(/does not match/);
  });
  test("rejects inconsistent receipt commands even with a recalculated envelope digest", () => {
    const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
    for (const field of ["commandDigest", "receiptId", "priorRevision", "recordedAtISO"]) {
      const receipt = structuredClone(initialize().receipt);
      receipt[field] = field === "priorRevision" ? 9 : "tampered";
      delete receipt.receiptDigest;
      receipt.receiptDigest = createHash("sha256").update(JSON.stringify(canonical(receipt))).digest("hex");
      expect(() => authority.planCommand({ request, actor, existingReceipt: receipt })).toThrow(/inconsistent/);
    }
  });
  test("pins immutable workflow policy and rejects altered ledger timestamps", () => {
    const first = initialize();
    expect(first.nextLedger.workflowKind).toBe("event_execution");
    expect(Object.isFrozen(authority.POLICY.transitions)).toBe(true);
    expect(Object.isFrozen(authority.POLICY.phases)).toBe(true);
    expect(() => authority.projectSnapshot(source, { ...first.nextLedger, updatedAtISO: "2030-01-01T00:00:00.000Z" }, first.receipt)).toThrow(/does not match/);
  });
  test("verifies the private accepted snapshot instead of trusting booked status", () => {
    const fixture = acceptedFixture();
    expect(authority.resolveSource({ ...source, sourceQuote: fixture.quote, sourceVersion: fixture.version, acceptanceReceiptDocument: fixture.acceptance })).toMatchObject(source);
    expect(() => authority.resolveSource({ ...source, sourceQuote: fixture.quote, sourceVersion: fixture.version, acceptanceReceiptDocument: { ...fixture.acceptance, proposalSnapshot: { ...fixture.acceptance.proposalSnapshot, forged: true } } })).toThrow(/does not verify/);
  });
  test("rejects unbounded revisions and unsupported requests", () => {
    expect(() => authority.normalizeRequest({ ...request, expectedLedgerRevision: Number.MAX_SAFE_INTEGER })).toThrow(/bounded/);
    expect(() => authority.normalizeRequest({ ...request, targetPhase: "ready" })).toThrow(/supported/);
  });
});

describe("event operating callable wiring", () => {
  test("callables enforce both rollout gates without any writes", async () => {
    for (const options of [{ globalEnabled: undefined }, { globalEnabled: "false" }, { tenantEnabled: false }]) {
      // Omitted environment values are false in deployed runtime; explicit empty reproduces that here.
      const harness = callableHarness({ ...options, ...(options.globalEnabled === undefined && !Object.hasOwn(options, "tenantEnabled") ? { globalEnabled: "" } : {}) });
      await expect(harness.read()).rejects.toMatchObject({ code: "failed-precondition" });
      await expect(harness.apply()).rejects.toMatchObject({ code: "failed-precondition" });
      expect([...harness.store.keys()].some((key) => key.includes("eventOperatingLedgers"))).toBe(false);
    }
  });
  test("callables recheck current role and organization inside transactions", async () => {
    for (const change of ["role", "organization", "tombstone"]) {
      const harness = callableHarness();
      if (change === "role") harness.store.set("userRoles/admin-one", { organizationId: "org-one", role: "sales" });
      if (change === "organization") harness.store.set("organizations/org-one", { active: false });
      if (change === "tombstone") harness.store.set("organizationTombstones/org-one", { retired: true });
      await expect(harness.read()).rejects.toHaveProperty("code");
      await expect(harness.apply()).rejects.toHaveProperty("code");
      expect([...harness.store.keys()].some((key) => key.includes("eventOperatingLedgers"))).toBe(false);
      expect(harness.reads).toContain("userRoles/admin-one");
    }
  });
  test("callables allow sales reads but reject sales and cross-tenant writes", async () => {
    const harness = callableHarness({ staff: { ...actor, role: "sales" } });
    harness.store.set("userRoles/admin-one", { organizationId: "org-one", role: "sales", email: actor.email });
    expect((await harness.read()).snapshot.availability).toBe("not_yet_available");
    await expect(harness.apply()).rejects.toMatchObject({ code: "permission-denied" });
    const crossTenant = callableHarness({ staff: { ...actor, principalOrganizationId: "other-org" } });
    await expect(crossTenant.read()).rejects.toMatchObject({ code: "permission-denied" });
  });
  test("callables return bounded snapshots without private receipt payloads", async () => {
    const harness = callableHarness();
    expect((await harness.read()).snapshot).toMatchObject({ availability: "not_yet_available", phase: null, revision: 0 });
    const first = await harness.apply();
    const replay = await harness.apply();
    expect(replay.idempotent).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
    expect((await harness.read()).snapshot).toEqual(first.snapshot);
    const serialized = JSON.stringify(first);
    for (const hidden of ["recordedBy", "commandDigest", "resultLedger", "proposalSnapshot", "snapshotSha256", "owner@example.test"]) expect(serialized).not.toContain(hidden);
    expect([...harness.store.keys()].filter((key) => key.includes("/eventOperatingLedgers/") && key.includes("/receipts/"))).toHaveLength(1);
  });
  test("callables preserve previous ledger when acceptance changes", async () => {
    const harness = callableHarness();
    const first = await harness.apply();
    const path = `organizations/org-one/eventOperatingLedgers/${first.snapshot.ledgerId}`;
    const historical = structuredClone(harness.store.get(path));
    const changed = { ...harness.fixture.acceptance, receiptId: "accepted-two" };
    harness.store.set("organizations/org-one/proposalAcceptanceReceipts/accepted-two", changed);
    harness.store.set("organizations/org-one/quotes/quote-one", { ...harness.fixture.quote, acceptanceReceipt: changed });
    const read = await harness.read();
    expect(read.snapshot).toMatchObject({ availability: "not_yet_available", acceptanceReceiptId: "accepted-two" });
    expect(read.snapshot.ledgerId).not.toBe(first.snapshot.ledgerId);
    expect(harness.store.get(path)).toEqual(historical);
    expect((await harness.apply()).idempotent).toBe(true);
    await expect(harness.apply({ ...request, requestId: "event-operation-request-0002", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" })).rejects.toMatchObject({ code: "aborted" });
    expect(harness.store.get(path)).toEqual(historical);
  });
  test("phase orphan history blocks fresh initialization while exact prior retry survives", async () => {
    const harness = callableHarness();
    const initialized = await harness.apply();
    const ledgerPath = `organizations/org-one/eventOperatingLedgers/${initialized.snapshot.ledgerId}`;
    harness.store.delete(ledgerPath);
    const before = JSON.stringify([...harness.store]);
    await expect(harness.read()).rejects.toMatchObject({ code: "data-loss" });
    await expect(harness.apply({ ...request, requestId: "event-phase-reset-attempt-0001" })).rejects.toMatchObject({ code: "data-loss" });
    expect((await harness.apply()).idempotent).toBe(true);
    expect(JSON.stringify([...harness.store])).toBe(before);
  });

  test("phase initialization cannot reset retained work or actuals children", async () => {
    for (const child of ["workState/current", "workReceipts/retained", "actualsState/current", "actualsReceipts/retained"]) {
      const harness = callableHarness();
      const ledgerPath = `organizations/org-one/eventOperatingLedgers/${authority.ledgerIdFor(source)}`;
      harness.store.set(`${ledgerPath}/${child}`, { retained: true });
      const before = JSON.stringify([...harness.store]);
      await expect(harness.read()).rejects.toMatchObject({ code: "data-loss" });
      await expect(harness.apply()).rejects.toMatchObject({ code: "data-loss" });
      expect(JSON.stringify([...harness.store])).toBe(before);
    }
  });

  test("callables reject stale simultaneous intent and tampered history", async () => {
    const harness = callableHarness();
    const first = await harness.apply();
    const second = { ...request, requestId: "event-operation-request-0002", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" };
    await harness.apply(second);
    await expect(harness.apply({ ...second, requestId: "event-operation-request-0003" })).rejects.toMatchObject({ code: "aborted" });
    const receiptPath = `organizations/org-one/eventOperatingLedgers/${first.snapshot.ledgerId}/receipts/${first.receipt.receiptId}`;
    harness.store.get(receiptPath).resultPhase = "completed";
    await expect(harness.apply()).rejects.toMatchObject({ code: "data-loss" });
  });
});
