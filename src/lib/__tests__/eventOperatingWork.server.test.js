import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const authority = require("../../../functions/eventOperatingWork.js");
const phaseAuthority = require("../../../functions/eventOperations.js");
const closeout = require("../../../functions/postEventCloseout.js");
const actor = { organizationId: "org-one", principalOrganizationId: "org-one", uid: "admin-one", role: "admin", email: "owner@example.test" };
const source = { organizationId: "org-one", quoteId: "quote-one", sourceVersionId: "v1", acceptanceReceiptId: "accepted-one" };
const nowISO = "2026-09-05T18:00:00.000Z";
const phaseRequest = { ...source, requestId: "event-operation-request-0001", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" };
const phase = () => phaseAuthority.planCommand({ request: phaseRequest, actor, source, nowISO });
const request = { ...source, requestId: "event-work-request-00001", workPolicyVersion: 1, expectedWorkRevision: 0, command: "checkpoint_record", checkpointCode: "venue_access", note: "Access recorded" };
const first = (overrides = {}) => authority.planCommand({ request: { ...request, ...overrides }, actor, source, phaseSnapshot: phase().snapshot, nowISO });
const next = (previous, command) => authority.planCommand({ request: { ...source, requestId: `event-work-next-request-${previous.nextWorkState.revision}`, workPolicyVersion: 1, expectedWorkRevision: previous.nextWorkState.revision, ...command }, actor, source, phaseSnapshot: phase().snapshot, workState: previous.nextWorkState, currentReceipt: previous.receipt, nowISO });
const openRequest = (number = 1) => ({ ...source, requestId: `event-work-open-issue-${String(number).padStart(4, "0")}`, workPolicyVersion: 1, expectedWorkRevision: 0, command: "issue_open", severity: "urgent", note: "Venue access changed" });
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
  const sandbox = { workflowDefinitions: require("../../../functions/workflowDefinitions.js"), workflowExecution: require("../../../functions/workflowExecution.js"), eventWorkflowAdapter: require("../../../functions/eventWorkflowAdapter.js"), exports, eventOperations: phaseAuthority, eventOperatingWork: authority, PostEventCloseoutError: closeout.PostEventCloseoutError, db, REGION: "test", ORGANIZATIONS_COLLECTION: "organizations", QUOTES_COLLECTION: "quotes", ORGANIZATION_TOMBSTONES_COLLECTION: "organizationTombstones", PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION: "proposalAcceptanceReceipts", process: { env: { EVENT_OPERATING_SPINE_ENABLED: globalEnabled } }, functions: { region: () => ({ https: { onCall: (handler) => handler } }), https: { HttpsError }, logger: { error: () => {} } }, assertStaff: async () => staff, normalizeText: (value) => String(value || "").trim(), normalizeEmail: (value) => String(value || "").trim().toLowerCase(), isOrganizationRecordActive: (value) => value?.active !== false && value?.archived !== true && [undefined, "", "active"].includes(value?.status) };
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
    read: (data = { organizationId: source.organizationId, quoteId: source.quoteId }) => exports.getEventOperatingWorkSnapshot(data, {}),
    apply: (data = request) => exports.applyEventOperatingWorkCommand(data, {})
  };
}

describe("event operating work authority", () => {
  test("pins an independent work policy without changing phase policy", () => {
    expect(authority.WORK_POLICY_DIGEST).not.toBe(phaseAuthority.POLICY_DIGEST);
    expect(authority.WORK_POLICY.phasePolicyDigest).toBe(phaseAuthority.POLICY_DIGEST);
    expect(Object.isFrozen(authority.WORK_POLICY.checkpointCodes)).toBe(true);
    expect(authority.WORK_POLICY.maximumRetainedIssues).toBe(25);
    expect(authority.WORK_POLICY.maximumNoteCharacters).toBe(240);
  });

  test("distinguishes missing phase ledger from empty work journal", () => {
    const absent = authority.projectSnapshot({ source, phaseInitialized: false });
    const empty = authority.projectSnapshot({ source });
    expect(absent).toMatchObject({ availability: "not_yet_available", reasonCode: "phase_ledger_missing", revision: 0, latestReceipt: null });
    expect(empty).toMatchObject({ availability: "not_yet_available", reasonCode: "journal_empty", revision: 0 });
    expect(empty.checkpoints.map((item) => item.code)).toEqual(["venue_access", "team_briefing", "service_handoff", "pack_down"]);
    expect(empty.checkpoints.every((item) => item.state === "not_recorded" && !item.note && !item.updatedAtISO)).toBe(true);
    expect(empty.issues).toEqual([]);
    expect(() => authority.planCommand({ request, actor, source, nowISO })).toThrow(/Initialize/);
  });

  test("strictly rejects unsupported fields enums revisions and invalid note data", () => {
    for (const bad of [
      { ...request, secret: "hidden" }, { ...request, issueId: "event_issue_1234" },
      { ...request, severity: "urgent" }, { ...request, workPolicyVersion: 2 },
      { ...request, expectedWorkRevision: -1 }, { ...request, expectedWorkRevision: Number.MAX_SAFE_INTEGER },
      { ...request, note: "x".repeat(241) }, { ...request, note: { html: "x" } },
      { ...request, note: "bad\u0000note" }, { ...request, checkpointCode: "arbitrary" },
      { ...openRequest(), severity: "critical" }, { ...openRequest(), title: "unsupported" },
      { ...openRequest(), note: " " }
    ]) expect(() => authority.normalizeRequest(bad)).toThrow();
    expect(() => authority.normalizeReadRequest({ organizationId: "org-one", quoteId: "quote-one", arbitrary: true })).toThrow(/unsupported/);
    expect(authority.normalizeRequest({ ...request, note: undefined }).note).toBe("");
  });

  test("requires nonblank reasons for reopen and resolution", () => {
    for (const candidate of [
      { ...request, command: "checkpoint_reopen", note: " " },
      { ...source, requestId: request.requestId, expectedWorkRevision: 1, workPolicyVersion: 1, command: "issue_resolve", issueId: `event_issue_${"a".repeat(32)}`, note: "" },
      { ...source, requestId: request.requestId, expectedWorkRevision: 1, workPolicyVersion: 1, command: "issue_reopen", issueId: `event_issue_${"a".repeat(32)}` }
    ]) expect(() => authority.normalizeRequest(candidate)).toThrow(/nonblank/);
  });

  test("records reopens and rerecords fixed checkpoints with immutable receipts", () => {
    const recorded = first();
    const reopened = next(recorded, { command: "checkpoint_reopen", checkpointCode: "venue_access", note: "Access changed" });
    expect(reopened.snapshot.checkpoints[0]).toMatchObject({ state: "reopened", note: "Access changed" });
    const rerecorded = next(reopened, { command: "checkpoint_record", checkpointCode: "venue_access" });
    expect(rerecorded.snapshot.checkpoints[0]).toMatchObject({ state: "recorded", note: "" });
    expect(recorded.snapshot.checkpoints[0].note).toBe("Access recorded");
    expect(() => next(recorded, { command: "checkpoint_record", checkpointCode: "venue_access" })).toThrow(/not allowed/);
    expect(() => next(recorded, { command: "checkpoint_reopen", checkpointCode: "team_briefing", note: "Changed" })).toThrow(/not allowed/);
  });

  test("opens resolves and reopens issues without rewriting description or severity", () => {
    const opened = authority.planCommand({ request: openRequest(), actor, source, phaseSnapshot: phase().snapshot, nowISO });
    const issueId = opened.snapshot.issues[0].issueId;
    expect(authority.publicReceipt(opened.receipt)).toMatchObject({ issueId, priorState: null, resultState: "open" });
    const resolved = next(opened, { command: "issue_resolve", issueId, note: "Access restored" });
    const reopened = next(resolved, { command: "issue_reopen", issueId, note: "Access blocked again" });
    expect(reopened.snapshot.issues[0]).toMatchObject({ state: "open", description: "Venue access changed", severity: "urgent", latestNote: "Access blocked again" });
    expect(() => next(opened, { command: "issue_reopen", issueId, note: "Reason" })).toThrow(/not allowed/);
    expect(() => next(opened, { command: "issue_resolve", issueId: `event_issue_${"a".repeat(32)}`, note: "Reason" })).toThrow(/unavailable/);
  });

  test("resolved issues still count toward the retained lifetime limit", () => {
    let result = authority.planCommand({ request: openRequest(), actor, source, phaseSnapshot: phase().snapshot, nowISO });
    for (let index = 2; index <= 25; index += 1) {
      result = next(result, { ...openRequest(index), expectedWorkRevision: result.nextWorkState.revision });
    }
    result = next(result, { command: "issue_resolve", issueId: result.snapshot.issues[0].issueId, note: "Resolved but retained" });
    expect(result.snapshot.issues).toHaveLength(25);
    expect(() => next(result, { ...openRequest(26), expectedWorkRevision: result.nextWorkState.revision })).toThrow(/25 retained issues/);
  });

  test("work receipts reconcile exact intent and reject actor payload or integrity changes", () => {
    const result = first();
    const replay = authority.planCommand({ request, actor, existingReceipt: result.receipt });
    expect(replay.idempotent).toBe(true);
    expect(replay.nextWorkState).toBeNull();
    expect(replay.snapshot).toEqual(result.snapshot);
    expect(() => authority.planCommand({ request: { ...request, note: "Other payload" }, actor, existingReceipt: result.receipt })).toThrow(/different immutable/);
    expect(() => authority.planCommand({ request, actor: { ...actor, uid: "other-admin" }, existingReceipt: result.receipt })).toThrow(/different immutable/);
    expect(() => authority.planCommand({ request, actor, existingReceipt: { ...result.receipt, resultState: "reopened" } })).toThrow(/integrity/);
    expect(() => authority.projectSnapshot({ source, workState: { ...result.nextWorkState, updatedAtISO: "2030-01-01T00:00:00.000Z" }, receipt: result.receipt })).toThrow(/does not match/);
  });

  test("rejects malformed transitions and state even after the receipt digest is recomputed", () => {
    const canonical = (value) => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
    const changes = [
      (receipt) => { receipt.resultState = "reopened"; },
      (receipt) => { receipt.resultWorkState.checkpoints[0].note = "x".repeat(241); },
      (receipt) => { receipt.resultWorkState.checkpoints[1].note = "Unrecorded but claimed"; },
      (receipt) => { receipt.resultWorkState.checkpoints[0].updatedAtISO = "2020-01-01T00:00:00.000Z"; },
      (receipt) => { receipt.observedPhaseRevision = 0; },
      (receipt) => { receipt.request.note = "Substituted intent"; },
      (receipt) => { receipt.priorWorkDigest = "a".repeat(64); },
      (receipt) => { receipt.resultWorkState.unsupported = true; }
    ];
    for (const change of changes) {
      const receipt = structuredClone(first().receipt);
      change(receipt);
      delete receipt.receiptDigest;
      receipt.receiptDigest = createHash("sha256").update(JSON.stringify(canonical(receipt))).digest("hex");
      expect(() => authority.planCommand({ request, actor, existingReceipt: receipt })).toThrow();
    }
  });

  test("rejects source revision drift and malformed stored work state", () => {
    const result = first();
    expect(() => authority.planCommand({ request, actor, source: { ...source, acceptanceReceiptId: "new-source" }, phaseSnapshot: phase().snapshot, nowISO })).toThrow(/source changed/);
    expect(() => next(result, { command: "checkpoint_record", checkpointCode: "team_briefing", expectedWorkRevision: 0 })).toThrow(/journal changed/);
    const malformed = structuredClone(result.nextWorkState);
    malformed.checkpoints[1].note = "x".repeat(241);
    expect(() => authority.projectSnapshot({ source, workState: malformed, receipt: result.receipt })).toThrow(/malformed/);
    const duplicate = structuredClone(result.nextWorkState);
    duplicate.checkpoints[1].code = "venue_access";
    expect(() => authority.projectSnapshot({ source, workState: duplicate, receipt: result.receipt })).toThrow(/invalid/);
  });

  test("accepts recording after phase completion without changing earlier phase evidence", () => {
    const initial = phase();
    const running = phaseAuthority.planCommand({ request: { ...phaseRequest, requestId: "phase-transition-running-0001", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" }, actor, source, ledger: initial.nextLedger, nowISO });
    const completed = phaseAuthority.planCommand({ request: { ...phaseRequest, requestId: "phase-transition-complete-0001", command: "transition", expectedLedgerRevision: 2, targetPhase: "completed" }, actor, source, ledger: running.nextLedger, nowISO });
    const original = JSON.stringify(completed);
    const work = authority.planCommand({ request, actor, source, phaseSnapshot: completed.snapshot, nowISO });
    expect(work.receipt.observedPhaseRevision).toBe(3);
    expect(JSON.stringify(completed)).toBe(original);
  });
});

describe("event operating work callable wiring", () => {
  test("work callables enforce current tenant role and rollout gates", async () => {
    for (const type of ["global", "tenant", "role", "email", "organization", "tombstone", "crossTenant"]) {
      const harness = callableHarness(type === "global" ? { globalEnabled: "false" } : type === "tenant" ? { tenantEnabled: false } : type === "crossTenant" ? { staff: { ...actor, principalOrganizationId: "other-org" } } : {});
      if (type === "role") harness.store.set("userRoles/admin-one", { organizationId: "org-one", role: "customer" });
      if (type === "email") harness.store.set("userRoles/admin-one", { organizationId: "org-one", role: "admin", email: "different@example.test" });
      if (type === "organization") harness.store.set("organizations/org-one", { active: false });
      if (type === "tombstone") harness.store.set("organizationTombstones/org-one", {});
      const before = JSON.stringify([...harness.store]);
      await expect(harness.read()).rejects.toHaveProperty("code");
      await expect(harness.apply()).rejects.toHaveProperty("code");
      expect(JSON.stringify([...harness.store])).toBe(before);
    }
  });

  test("work read distinguishes absent parent and journal without creating records", async () => {
    const harness = callableHarness();
    expect((await harness.read()).snapshot.reasonCode).toBe("phase_ledger_missing");
    expect(harness.reads.filter((path) => path.endsWith("/workState/current"))).toHaveLength(2);
    await expect(harness.apply()).rejects.toMatchObject({ code: "failed-precondition" });
    await harness.phaseApply();
    expect((await harness.read()).snapshot.reasonCode).toBe("journal_empty");
    expect([...harness.store.keys()].some((path) => path.includes("/workState/"))).toBe(false);
  });

  test("work read rejects orphaned journal state instead of reporting an empty event", async () => {
    const harness = callableHarness();
    const ledgerId = phaseAuthority.ledgerIdFor(source);
    harness.store.set(`organizations/org-one/eventOperatingLedgers/${ledgerId}/workState/current`, first().nextWorkState);
    await expect(harness.read()).rejects.toMatchObject({ code: "data-loss" });
  });

  test("retained work receipts prevent journal reset and preserve historical retry", async () => {
    const harness = callableHarness();
    await harness.phaseApply();
    const recorded = await harness.apply();
    const ledgerPath = `organizations/org-one/eventOperatingLedgers/${recorded.snapshot.ledgerId}`;
    harness.store.delete(`${ledgerPath}/workState/current`);
    const before = JSON.stringify([...harness.store]);
    await expect(harness.read()).rejects.toMatchObject({ code: "data-loss" });
    await expect(harness.apply({ ...request, requestId: "event-work-reset-attempt-0001" })).rejects.toMatchObject({ code: "data-loss" });
    expect((await harness.apply()).idempotent).toBe(true);
    expect(JSON.stringify([...harness.store])).toBe(before);
    harness.store.delete(ledgerPath);
    await expect(harness.read()).rejects.toMatchObject({ code: "data-loss" });
    expect((await harness.apply()).idempotent).toBe(true);
  });

  test("work commands preserve phase source and receipt bytes", async () => {
    const harness = callableHarness();
    await harness.phaseApply();
    const before = JSON.stringify([...harness.store]);
    const firstResult = await harness.apply();
    const afterDomains = [...harness.store].filter(([path]) => !path.includes("/workState/") && !path.includes("/workReceipts/"));
    expect(JSON.stringify(afterDomains)).toBe(before);
    expect((await harness.read()).snapshot).toEqual(firstResult.snapshot);
    expect((await harness.phaseRead()).snapshot.phase).toBe("prepared");
    expect(firstResult.snapshot.historyCoverage).toBe("latest_receipt_only");
    for (const hidden of ["recordedBy", "commandDigest", "resultWorkState", "priorWorkDigest", "owner@example.test"]) expect(JSON.stringify(firstResult)).not.toContain(hidden);
  });

  test("work history survives phase advancement and historical source replay", async () => {
    const harness = callableHarness();
    await harness.phaseApply();
    const recorded = await harness.apply();
    await harness.phaseApply({ ...phaseRequest, requestId: "phase-transition-next-0001", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" });
    expect((await harness.read()).snapshot).toEqual(recorded.snapshot);
    const originalWork = JSON.stringify([...harness.store].filter(([path]) => path.includes("/work")));
    const changed = { ...harness.fixture.acceptance, receiptId: "accepted-two" };
    harness.store.set("organizations/org-one/proposalAcceptanceReceipts/accepted-two", changed);
    harness.store.set("organizations/org-one/quotes/quote-one", { ...harness.fixture.quote, acceptanceReceipt: changed });
    expect((await harness.read()).snapshot.reasonCode).toBe("phase_ledger_missing");
    expect((await harness.apply()).idempotent).toBe(true);
    await expect(harness.apply({ ...request, note: "changed retry" })).rejects.toMatchObject({ code: "already-exists" });
    const alternateActor = callableHarness({ staff: { ...actor, uid: "admin-two" } });
    for (const [path, value] of harness.store) alternateActor.store.set(path, structuredClone(value));
    alternateActor.store.set("userRoles/admin-two", { organizationId: "org-one", role: "admin", email: actor.email });
    await expect(alternateActor.apply()).rejects.toMatchObject({ code: "already-exists" });
    await expect(harness.apply({ ...request, requestId: "event-work-new-source-0001", expectedWorkRevision: 1, checkpointCode: "team_briefing" })).rejects.toMatchObject({ code: "aborted" });
    expect(JSON.stringify([...harness.store].filter(([path]) => path.includes("/work")))).toBe(originalWork);
  });

  test("work handlers reject tampered accepted source and phase receipt evidence", async () => {
    const harness = callableHarness();
    const initialized = await harness.phaseApply();
    const acceptancePath = "organizations/org-one/proposalAcceptanceReceipts/accepted-one";
    harness.store.get(acceptancePath).proposalSnapshot.untrusted = true;
    let before = JSON.stringify([...harness.store]);
    await expect(harness.read()).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(harness.apply()).rejects.toMatchObject({ code: "failed-precondition" });
    expect(JSON.stringify([...harness.store])).toBe(before);
    delete harness.store.get(acceptancePath).proposalSnapshot.untrusted;
    const receiptPath = `organizations/org-one/eventOperatingLedgers/${initialized.snapshot.ledgerId}/receipts/${initialized.receipt.receiptId}`;
    harness.store.get(receiptPath).resultPhase = "completed";
    before = JSON.stringify([...harness.store]);
    await expect(harness.read()).rejects.toMatchObject({ code: "data-loss" });
    await expect(harness.apply()).rejects.toMatchObject({ code: "data-loss" });
    expect(JSON.stringify([...harness.store])).toBe(before);
  });

  test("work commands reject stale intent atomically and sales retain bounded read only", async () => {
    const harness = callableHarness();
    await harness.phaseApply();
    await harness.apply();
    const before = JSON.stringify([...harness.store]);
    await expect(harness.apply({ ...request, requestId: "event-work-stale-intent-0001", checkpointCode: "team_briefing" })).rejects.toMatchObject({ code: "aborted" });
    expect(JSON.stringify([...harness.store])).toBe(before);
    const sales = callableHarness({ staff: { ...actor, role: "sales" } });
    for (const [path, value] of harness.store) sales.store.set(path, structuredClone(value));
    sales.store.set("userRoles/admin-one", { organizationId: "org-one", role: "sales", email: actor.email });
    expect((await sales.read()).snapshot.availability).toBe("available");
    await expect(sales.apply()).rejects.toMatchObject({ code: "permission-denied" });
  });
});
