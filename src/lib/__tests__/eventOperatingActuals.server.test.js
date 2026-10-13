import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const authority = require("../../../functions/eventOperatingActuals.js");
const phaseAuthority = require("../../../functions/eventOperations.js");
const workAuthority = require("../../../functions/eventOperatingWork.js");
const closeout = require("../../../functions/postEventCloseout.js");
const actor = { organizationId: "org-one", principalOrganizationId: "org-one", uid: "admin-one", role: "admin", email: "owner@example.test" };
const source = { organizationId: "org-one", quoteId: "quote-one", sourceVersionId: "v1", acceptanceReceiptId: "accepted-one" };
const nowISO = "2026-09-05T18:00:00.000Z";
const phaseRequest = { ...source, requestId: "event-operation-request-0001", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" };
const phase = () => phaseAuthority.planCommand({ request: phaseRequest, actor, source, nowISO });
const request = { ...source, requestId: "event-actuals-request-0001", actualsPolicyVersion: 1, expectedActualsRevision: 0, command: "record", category: "labor", description: "Operator-declared catering labor", costCents: 12500, durationMinutes: 180, laborRole: "server" };
const first = (overrides = {}) => authority.planCommand({ request: { ...request, ...overrides }, actor, source, phaseSnapshot: phase().snapshot, nowISO });
const next = (previous, command) => authority.planCommand({ request: { ...source, requestId: `event-actuals-next-request-${previous.nextActualsState.revision}`, actualsPolicyVersion: 1, expectedActualsRevision: previous.nextActualsState.revision, ...command }, actor, source, phaseSnapshot: phase().snapshot, actualsState: previous.nextActualsState, currentReceipt: previous.receipt, nowISO });
const declare = (previous, category, state = "complete") => next(previous, { command: "declare_category", category, state, note: "Operator reviewed the captured category" });
const purchase = { command: "record", category: "purchasing", description: "Declared purchased supplies", costCents: 1999 };
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
  const sandbox = { workflowDefinitions: require("../../../functions/workflowDefinitions.js"), workflowExecution: require("../../../functions/workflowExecution.js"), eventWorkflowAdapter: require("../../../functions/eventWorkflowAdapter.js"), exports, eventOperations: phaseAuthority, eventOperatingWork: workAuthority, eventOperatingActuals: authority, PostEventCloseoutError: closeout.PostEventCloseoutError, db, REGION: "test", ORGANIZATIONS_COLLECTION: "organizations", QUOTES_COLLECTION: "quotes", ORGANIZATION_TOMBSTONES_COLLECTION: "organizationTombstones", PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION: "proposalAcceptanceReceipts", process: { env: { EVENT_OPERATING_SPINE_ENABLED: globalEnabled } }, functions: { region: () => ({ https: { onCall: (handler) => handler } }), https: { HttpsError }, logger: { error: () => {} } }, assertStaff: async () => staff, normalizeText: (value) => String(value || "").trim(), normalizeEmail: (value) => String(value || "").trim().toLowerCase(), isOrganizationRecordActive: (value) => value?.active !== false && value?.archived !== true && [undefined, "", "active"].includes(value?.status) };
  sandbox.tenantWorkflowRuntimeEnabled = (flag, organizationId) => require("../../../functions/tenantWorkflowRuntime.js").tenantWorkflowRuntimeEnabled(flag, organizationId, sandbox.process.env);
  const index = readFileSync(new URL("../../../functions/index.js", import.meta.url), "utf8");
  const start = index.indexOf("function eventOperatingActor(");
  const end = index.indexOf("exports.recordPostEventCloseoutReview =", start);
  expect(start).toBeGreaterThan(0);
  vm.runInNewContext(index.slice(start, end), sandbox);
  const workStart = index.indexOf("async function readEventOperatingWorkPhase(");
  expect(workStart).toBeGreaterThan(end);
  vm.runInNewContext(index.slice(workStart), sandbox);
  return {
    store, reads, fixture,
    phaseRead: () => exports.getEventOperatingSnapshot(source, {}),
    phaseApply: (data = phaseRequest) => exports.applyEventOperatingCommand(data, {}),
    workApply: (data) => exports.applyEventOperatingWorkCommand(data, {}),
    read: (data = { organizationId: source.organizationId, quoteId: source.quoteId }) => exports.getEventOperatingActualsSnapshot(data, {}),
    apply: (data = request) => exports.applyEventOperatingActualsCommand(data, {})
  };
}

describe("event operational actuals authority", () => {
  test("actuals require explicit integer costs and bounded typed fields", () => {
    for (const bad of [
      { ...request, costCents: null }, { ...request, costCents: 1.5 }, { ...request, costCents: -1 },
      { ...request, costCents: 1_000_000_001 }, { ...request, costCents: "12500" },
      { ...request, durationMinutes: 0 }, { ...request, durationMinutes: 1.1 },
      { ...request, durationMinutes: 10081 }, { ...request, laborRole: "invented" },
      { ...request, description: " " }, { ...request, description: "x".repeat(241) },
      { ...request, description: "bad\u0000value" }, { ...request, actualsPolicyVersion: 2 },
      { ...request, currency: "EUR" }, { ...request, hourlyRate: 50 },
      { ...request, staffingRef: "fake" }, { ...request, category: "other" },
      { ...request, expectedActualsRevision: Number.MAX_SAFE_INTEGER }
    ]) expect(() => authority.normalizeRequest(bad)).toThrow();
    expect(authority.normalizeRequest({ ...request, costCents: 0 }).costCents).toBe(0);
    const missingCost = { ...request };
    delete missingCost.costCents;
    expect(() => authority.normalizeRequest(missingCost)).toThrow(/missing/);
    expect(() => authority.normalizeReadRequest({ ...source })).toThrow(/unsupported/);
  });

  test("actuals absence never implies zero completeness", () => {
    const missing = authority.projectSnapshot({ source, phaseInitialized: false });
    const empty = authority.projectSnapshot({ source });
    expect(missing.reasonCode).toBe("phase_ledger_missing");
    expect(empty).toMatchObject({ availability: "not_yet_available", reasonCode: "actuals_empty", revision: 0, captureComplete: false, currency: "USD" });
    expect(empty.totals.totalCostCents).toBe(0);
    expect(Object.values(empty.categories).every((value) => value.state === "not_declared")).toBe(true);
    expect(() => authority.planCommand({ request, actor, source, nowISO })).toThrow(/Initialize/);
  });

  test("actuals mutations invalidate only affected category completeness", () => {
    let result = first();
    result = declare(result, "labor");
    result = declare(result, "purchasing", "not_applicable");
    result = declare(result, "other", "not_applicable");
    expect(result.snapshot.captureComplete).toBe(true);
    const original = JSON.stringify(result);
    const recorded = next(result, purchase);
    expect(recorded.snapshot.captureComplete).toBe(false);
    expect(recorded.snapshot.categories.purchasing).toEqual({ state: "partial", note: "", declaredAtISO: "", lastDeclarationReceiptId: "" });
    expect(recorded.snapshot.categories.labor.state).toBe("complete");
    expect(recorded.snapshot.categories.other.state).toBe("not_applicable");
    expect(JSON.stringify(result)).toBe(original);
    expect(recorded.snapshot.totals).toMatchObject({ laborCostCents: 12500, purchasingCostCents: 1999, totalCostCents: 14499, durationMinutes: 180 });
  });

  test("explicit zero complete and not applicable differ from partial capture", () => {
    let result = authority.planCommand({ request: { ...source, requestId: "actuals-zero-declaration-0001", actualsPolicyVersion: 1, expectedActualsRevision: 0, command: "declare_category", category: "labor", state: "complete", note: "Confirmed no labor cost incurred" }, actor, source, phaseSnapshot: phase().snapshot, nowISO });
    result = declare(result, "purchasing", "not_applicable");
    result = declare(result, "other", "partial");
    expect(result.snapshot.captureComplete).toBe(false);
    expect(result.snapshot.categories.other.note).not.toBe("");
    result = declare(result, "other", "complete");
    expect(result.snapshot.captureComplete).toBe(true);
    expect(result.snapshot.entries).toEqual([]);
    expect(result.snapshot.totals.totalCostCents).toBe(0);
    expect(() => declare(first(), "labor", "not_applicable")).toThrow(/active entries/);
    expect(() => next(result, { command: "declare_category", category: "other", state: "complete", note: " " })).toThrow(/nonblank/);
  });

  test("actuals preserve category and entry identity through correction and void", () => {
    const initial = first();
    const entryId = initial.snapshot.entries[0].entryId;
    const corrected = next(initial, { command: "correct", entryId, category: "labor", description: "Corrected declared labor", costCents: 15000, laborRole: "server", durationMinutes: 240, reason: "Original duration was incomplete" });
    expect(corrected.snapshot.entries[0]).toMatchObject({ entryId, category: "labor", state: "active", costCents: 15000, durationMinutes: 240 });
    expect(corrected.snapshot.entries[0].createdAtISO).toBe(initial.snapshot.entries[0].createdAtISO);
    expect(initial.receipt.resultActualsState.entries[0].costCents).toBe(12500);
    expect(corrected.receipt.priorActualsState.entries[0].costCents).toBe(12500);
    const completed = declare(corrected, "labor");
    const voided = next(completed, { command: "void", entryId, reason: "Duplicate source declaration" });
    expect(voided.snapshot.entries[0].state).toBe("voided");
    expect(voided.snapshot.totals.laborCostCents).toBe(0);
    expect(voided.snapshot.categories.labor.state).toBe("partial");
    expect(() => next(voided, { command: "void", entryId, reason: "Again" })).toThrow(/terminal/);
    expect(() => next(initial, { ...purchase, command: "correct", entryId, reason: "Cannot reclassify" })).toThrow(/original cost category/);
    expect(() => next(initial, { command: "void", entryId, reason: "" })).toThrow(/nonblank/);
  });

  test("fifty retained entries include voided records but allow corrections and declarations", () => {
    let result = first();
    for (let index = 2; index <= 50; index += 1) {
      result = next(result, { ...purchase, requestId: `actuals-cap-record-${String(index).padStart(6, "0")}` });
    }
    result = next(result, { command: "void", entryId: result.snapshot.entries[0].entryId, reason: "Retain void evidence" });
    expect(result.snapshot.entries).toHaveLength(50);
    expect(() => next(result, purchase)).toThrow(/50 retained/);
    expect(declare(result, "labor", "not_applicable").snapshot.categories.labor.state).toBe("not_applicable");
  });

  test("actuals replay rejects changed payload actor and stale fresh intent", () => {
    const initial = first();
    const replay = authority.planCommand({ request, actor, existingReceipt: initial.receipt });
    expect(replay.idempotent).toBe(true);
    expect(replay.snapshot).toEqual(initial.snapshot);
    expect(replay.nextActualsState).toBeNull();
    expect(() => authority.planCommand({ request: { ...request, costCents: 999 }, actor, existingReceipt: initial.receipt })).toThrow(/different immutable/);
    expect(() => authority.planCommand({ request, actor: { ...actor, uid: "another-admin" }, existingReceipt: initial.receipt })).toThrow(/different immutable/);
    expect(() => next(initial, { ...purchase, expectedActualsRevision: 0 })).toThrow(/journal changed/);
    expect(() => authority.planCommand({ request, actor, source: { ...source, acceptanceReceiptId: "other" }, phaseSnapshot: phase().snapshot, nowISO })).toThrow(/source changed/);
    expect(() => authority.planCommand({ request, actor: { ...actor, role: "sales" }, existingReceipt: initial.receipt })).toThrow(/administrator/);
  });

  test("actuals reject rehashed malformed receipt and state evidence", () => {
    const canonical = (value) => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
    const changes = [
      (value) => { value.resultActualsState.entries[0].costCents = 1.5; },
      (value) => { value.resultActualsState.entries[0].costCents = 999; },
      (value) => { value.resultActualsState.categories.other.state = "complete"; },
      (value) => { value.resultActualsState.entries[0].description = "x".repeat(241); },
      (value) => { value.resultActualsState.entries[0].category = "other"; },
      (value) => { value.observedPhaseRevision = 0; },
      (value) => { value.priorActualsState.revision = 2; },
      (value) => { value.request.costCents = 500; },
      (value) => { value.resultActualsState.unknown = true; }
    ];
    for (const change of changes) {
      const receipt = structuredClone(first().receipt);
      change(receipt);
      delete receipt.receiptDigest;
      receipt.receiptDigest = createHash("sha256").update(JSON.stringify(canonical(receipt))).digest("hex");
      expect(() => authority.planCommand({ request, actor, existingReceipt: receipt })).toThrow();
    }
    const initial = first();
    expect(() => authority.projectSnapshot({ source, actualsState: { ...initial.nextActualsState, updatedAtISO: "2030-01-01T00:00:00.000Z" }, receipt: initial.receipt })).toThrow(/does not match/);
  });

  test("actuals reject stale completeness and hidden void history in a rehashed prior state", () => {
    const canonical = (value) => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
    const rehash = (receipt) => {
      delete receipt.receiptDigest;
      receipt.receiptDigest = createHash("sha256").update(JSON.stringify(canonical(receipt))).digest("hex");
      return receipt;
    };
    const initial = authority.planCommand({ request, actor, source, phaseSnapshot: phase().snapshot, nowISO: "2026-09-05T18:01:00.000Z" });
    const declarationRequest = { ...source, requestId: "actuals-explicit-complete-0001", actualsPolicyVersion: 1, expectedActualsRevision: 1, command: "declare_category", category: "labor", state: "complete", note: "Reviewed labor category" };
    const declared = authority.planCommand({ request: declarationRequest, actor, source, phaseSnapshot: phase().snapshot, actualsState: initial.nextActualsState, currentReceipt: initial.receipt, nowISO: "2026-09-05T18:02:00.000Z" });
    const otherRequest = { ...source, requestId: "actuals-unrelated-record-0001", actualsPolicyVersion: 1, expectedActualsRevision: 2, command: "record", category: "other", description: "Other declared cost", costCents: 100 };
    const other = authority.planCommand({ request: otherRequest, actor, source, phaseSnapshot: phase().snapshot, actualsState: declared.nextActualsState, currentReceipt: declared.receipt, nowISO: "2026-09-05T18:04:00.000Z" });
    const stale = structuredClone(other.receipt);
    stale.priorActualsState.entries[0].updatedAtISO = "2026-09-05T18:03:00.000Z";
    stale.priorActualsState.updatedAtISO = "2026-09-05T18:03:00.000Z";
    stale.resultActualsState.entries[0].updatedAtISO = "2026-09-05T18:03:00.000Z";
    expect(() => authority.planCommand({ request: otherRequest, actor, existingReceipt: rehash(stale) })).toThrow(/declaration time/);

    const voided = next(first(), { command: "void", entryId: first().snapshot.entries[0].entryId, reason: "Retained void" });
    const unrelated = next(voided, purchase);
    const hidden = structuredClone(unrelated.receipt);
    for (const state of [hidden.priorActualsState, hidden.resultActualsState]) {
      state.categories.labor = { state: "not_declared", note: "", declaredAtISO: "", lastDeclarationReceiptId: "" };
    }
    expect(() => authority.planCommand({ request: unrelated.receipt.request, actor, existingReceipt: rehash(hidden) })).toThrow(/contradicts retained/);
  });

  test("actuals pin independent policy and allow completed-phase capture without inferring completeness", () => {
    expect(authority.ACTUALS_POLICY_DIGEST).not.toBe(phaseAuthority.POLICY_DIGEST);
    expect(authority.ACTUALS_POLICY_DIGEST).not.toBe(workAuthority.WORK_POLICY_DIGEST);
    expect(Object.isFrozen(authority.ACTUALS_POLICY.categories)).toBe(true);
    const initialized = phase();
    const running = phaseAuthority.planCommand({ request: { ...phaseRequest, requestId: "actuals-phase-running-0001", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" }, actor, source, ledger: initialized.nextLedger, nowISO });
    const completed = phaseAuthority.planCommand({ request: { ...phaseRequest, requestId: "actuals-phase-complete-0001", command: "transition", expectedLedgerRevision: 2, targetPhase: "completed" }, actor, source, ledger: running.nextLedger, nowISO });
    const before = JSON.stringify(completed);
    const actuals = authority.planCommand({ request, actor, source, phaseSnapshot: completed.snapshot, nowISO });
    expect(actuals.snapshot.captureComplete).toBe(false);
    expect(actuals.receipt.observedPhaseRevision).toBe(3);
    expect(JSON.stringify(completed)).toBe(before);
  });
});

describe("event operational actuals callable wiring", () => {
  test("actuals callables enforce current role tenant and gates", async () => {
    for (const type of ["global", "tenant", "role", "email", "organization", "tombstone", "crossTenant"]) {
      const harness = callableHarness(type === "global" ? { globalEnabled: "false" } : type === "tenant" ? { tenantEnabled: false } : type === "crossTenant" ? { staff: { ...actor, principalOrganizationId: "other-org" } } : {});
      if (type === "role") harness.store.set("userRoles/admin-one", { organizationId: "org-one", role: "customer" });
      if (type === "email") harness.store.set("userRoles/admin-one", { organizationId: "org-one", role: "admin", email: "changed@example.test" });
      if (type === "organization") harness.store.set("organizations/org-one", { active: false });
      if (type === "tombstone") harness.store.set("organizationTombstones/org-one", {});
      const before = JSON.stringify([...harness.store]);
      await expect(harness.read()).rejects.toHaveProperty("code");
      await expect(harness.apply()).rejects.toHaveProperty("code");
      expect(JSON.stringify([...harness.store])).toBe(before);
    }
  });

  test("actuals callables preserve phase work and commercial authority bytes", async () => {
    const harness = callableHarness();
    expect((await harness.read()).snapshot.reasonCode).toBe("phase_ledger_missing");
    await expect(harness.apply()).rejects.toMatchObject({ code: "failed-precondition" });
    await harness.phaseApply();
    await harness.workApply({ ...source, requestId: "actuals-test-work-entry-0001", workPolicyVersion: 1, expectedWorkRevision: 0, command: "checkpoint_record", checkpointCode: "venue_access", note: "Prepared" });
    expect((await harness.read()).snapshot.reasonCode).toBe("actuals_empty");
    const before = JSON.stringify([...harness.store]);
    const result = await harness.apply();
    const domains = [...harness.store].filter(([path]) => !path.includes("/actualsState/") && !path.includes("/actualsReceipts/"));
    expect(JSON.stringify(domains)).toBe(before);
    expect((await harness.read()).snapshot).toEqual(result.snapshot);
    for (const privateKey of ["recordedBy", "commandDigest", "priorActualsState", "resultActualsState", actor.email]) expect(JSON.stringify(result)).not.toContain(privateKey);
  });

  test("actuals retained history prevents reset and permits exact historical retry", async () => {
    const harness = callableHarness();
    await harness.phaseApply();
    const result = await harness.apply();
    const ledgerPath = `organizations/org-one/eventOperatingLedgers/${result.snapshot.ledgerId}`;
    harness.store.delete(`${ledgerPath}/actualsState/current`);
    const before = JSON.stringify([...harness.store]);
    await expect(harness.read()).rejects.toMatchObject({ code: "data-loss" });
    await expect(harness.apply({ ...request, requestId: "actuals-reset-attempt-0001" })).rejects.toMatchObject({ code: "data-loss" });
    expect((await harness.apply()).idempotent).toBe(true);
    expect(JSON.stringify([...harness.store])).toBe(before);
    harness.store.delete(ledgerPath);
    await expect(harness.read()).rejects.toMatchObject({ code: "data-loss" });
    expect((await harness.apply()).idempotent).toBe(true);
  });

  test("actuals source movement keeps historical receipts and rejects substituted intent", async () => {
    const harness = callableHarness();
    await harness.phaseApply();
    await harness.apply();
    const before = JSON.stringify([...harness.store].filter(([path]) => path.includes("/actuals")));
    const changed = { ...harness.fixture.acceptance, receiptId: "accepted-two" };
    harness.store.set("organizations/org-one/proposalAcceptanceReceipts/accepted-two", changed);
    harness.store.set("organizations/org-one/quotes/quote-one", { ...harness.fixture.quote, acceptanceReceipt: changed });
    expect((await harness.read()).snapshot.reasonCode).toBe("phase_ledger_missing");
    expect((await harness.apply()).idempotent).toBe(true);
    await expect(harness.apply({ ...request, costCents: 123 })).rejects.toMatchObject({ code: "already-exists" });
    await expect(harness.apply({ ...request, requestId: "actuals-source-moved-0001", expectedActualsRevision: 1 })).rejects.toMatchObject({ code: "aborted" });
    const alternate = callableHarness({ staff: { ...actor, uid: "admin-two" } });
    for (const [path, value] of harness.store) alternate.store.set(path, structuredClone(value));
    alternate.store.set("userRoles/admin-two", { organizationId: "org-one", role: "admin", email: actor.email });
    await expect(alternate.apply()).rejects.toMatchObject({ code: "already-exists" });
    expect(JSON.stringify([...harness.store].filter(([path]) => path.includes("/actuals")))).toBe(before);
  });

  test("actuals fresh commands enforce CAS without partial writes and sales remain read only", async () => {
    const harness = callableHarness();
    await harness.phaseApply();
    await harness.apply();
    const before = JSON.stringify([...harness.store]);
    await expect(harness.apply({ ...request, requestId: "actuals-stale-cas-command-0001" })).rejects.toMatchObject({ code: "aborted" });
    expect(JSON.stringify([...harness.store])).toBe(before);
    const sales = callableHarness({ staff: { ...actor, role: "sales" } });
    for (const [path, value] of harness.store) sales.store.set(path, structuredClone(value));
    sales.store.set("userRoles/admin-one", { organizationId: "org-one", role: "sales", email: actor.email });
    expect((await sales.read()).snapshot.totals.laborCostCents).toBe(12500);
    await expect(sales.apply()).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("actuals reject tampered accepted parent and current receipt evidence", async () => {
    const harness = callableHarness();
    const initialized = await harness.phaseApply();
    const acceptancePath = "organizations/org-one/proposalAcceptanceReceipts/accepted-one";
    harness.store.get(acceptancePath).proposalSnapshot.forged = true;
    await expect(harness.apply()).rejects.toMatchObject({ code: "failed-precondition" });
    delete harness.store.get(acceptancePath).proposalSnapshot.forged;
    const phasePath = `organizations/org-one/eventOperatingLedgers/${initialized.snapshot.ledgerId}/receipts/${initialized.receipt.receiptId}`;
    const original = structuredClone(harness.store.get(phasePath));
    harness.store.get(phasePath).resultPhase = "completed";
    await expect(harness.apply()).rejects.toMatchObject({ code: "data-loss" });
    harness.store.set(phasePath, original);
    const captured = await harness.apply();
    const receiptPath = `organizations/org-one/eventOperatingLedgers/${captured.snapshot.ledgerId}/actualsReceipts/${captured.receipt.receiptId}`;
    harness.store.get(receiptPath).resultActualsState.entries[0].costCents = 12;
    await expect(harness.read()).rejects.toMatchObject({ code: "data-loss" });
    await expect(harness.apply()).rejects.toMatchObject({ code: "data-loss" });
  });
});
