import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const adapter = require("../../../functions/eventWorkflowAdapter");
const execution = require("../../../functions/workflowExecution");
const definitions = require("../../../functions/workflowDefinitions");
const phase = require("../../../functions/eventOperations");
const actuals = require("../../../functions/eventOperatingActuals");
const source = { organizationId: "org-one", quoteId: "quote-one", sourceVersionId: "v1", acceptanceReceiptId: "accepted-one" };
const actor = { organizationId: source.organizationId, uid: "admin-one", role: "admin" };
const nowISO = "2026-09-05T12:00:00.000Z";
const request = { ...source, requestId: "adapter-initialize-00001", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" };
const initialize = () => adapter.planEventCommand({ request, actor, source, definition: definitions.seedPublishedVersion(), nowISO });
const transitionRequest = { ...request, requestId: "adapter-transition-00001", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" };
const move = (first, extras = {}) => adapter.planEventCommand({ request: transitionRequest, actor, source,
  ledger: first.phasePlan.nextLedger, phaseCurrentReceipt: first.phasePlan.receipt,
  instance: first.workflowPlan.nextInstance, workflowCurrentReceipt: first.workflowPlan.receipt, nowISO, ...extras });

describe("event workflow adapter", () => {
  it("event adapter preserves original phase bytes and pins only trusted outcome references", () => {
    const first = initialize();
    const direct = phase.planCommand({ request, actor, source, nowISO });
    expect(first.phasePlan).toEqual(direct);
    expect(first.workflowPlan.nextInstance.domainRef.receiptDigest).toBe(direct.receipt.receiptDigest);
    const moved = move(first);
    expect(moved.phasePlan).toEqual(phase.planCommand({ request: transitionRequest, actor, source, ledger: first.phasePlan.nextLedger, nowISO }));
    expect(moved.workflowPlan.nextInstance.domainRef.revision).toBe(2);
    expect(moved.workflowPlan.nextInstance.tasks).toEqual(first.workflowPlan.nextInstance.tasks);
    expect(JSON.stringify(moved.workflowPlan.nextInstance)).not.toContain("resultLedger");
  });
  it("event adapter retains honest legacy unbound instances without retrofitting configuration", () => {
    const legacy = phase.planCommand({ request, actor, source, nowISO });
    const moved = adapter.planEventCommand({ request: transitionRequest, actor, source, ledger: legacy.nextLedger, phaseCurrentReceipt: legacy.receipt, nowISO });
    expect(moved.workflowPlan).toBeNull();
    expect(moved.bindingStatus).toBe("legacy_unbound");
    const replay = adapter.planEventCommand({ request, actor, source: null, phaseExistingReceipt: legacy.receipt, nowISO });
    expect(replay.phasePlan.idempotent).toBe(true);
    expect(replay.workflowPlan).toBeNull();
    expect(() => adapter.planEventCommand({ request, actor, source, nowISO })).toThrow(/initialization/);
  });
  it("event adapter exact historical paired replay survives source movement without fresh writes", () => {
    const first = initialize();
    const replay = adapter.planEventCommand({ request, actor, source: { ...source, acceptanceReceiptId: "new-accepted" },
      phaseExistingReceipt: first.phasePlan.receipt, workflowExistingReceipt: first.workflowPlan.receipt,
      instance: first.workflowPlan.nextInstance, workflowCurrentReceipt: first.workflowPlan.receipt, nowISO });
    expect(replay.phasePlan.idempotent).toBe(true);
    expect(replay.workflowPlan.idempotent).toBe(true);
    expect(replay.workflowPlan.nextInstance).toBeNull();
    expect(() => adapter.planEventCommand({ request, actor, source, phaseExistingReceipt: first.phasePlan.receipt,
      instance: first.workflowPlan.nextInstance, workflowCurrentReceipt: first.workflowPlan.receipt, nowISO })).toThrow(/atomic pair/);
    expect(() => adapter.planEventCommand({ request, actor: { ...actor, uid: "another-admin" }, source,
      phaseExistingReceipt: first.phasePlan.receipt, workflowExistingReceipt: first.workflowPlan.receipt, nowISO })).toThrow(/different immutable/);
  });
  it("event adapter preserves paired historical transition retry without recreating a missing instance", () => {
    const first = initialize();
    const transitioned = move(first);
    const replay = adapter.planEventCommand({ request: transitionRequest, actor, source: null,
      phaseExistingReceipt: transitioned.phasePlan.receipt, workflowExistingReceipt: transitioned.workflowPlan.receipt, nowISO });
    expect(replay.phasePlan.idempotent).toBe(true);
    expect(replay.workflowPlan.idempotent).toBe(true);
    expect(replay.workflowPlan.nextInstance).toBeNull();
  });
  it("event adapter rejects separately valid replay receipts with different trusted phase outcomes", () => {
    const first = initialize();
    const different = phase.planCommand({ request, actor, source, nowISO: "2026-09-05T12:01:00.000Z" });
    expect(different.receipt.receiptId).toBe(first.phasePlan.receipt.receiptId);
    expect(different.receipt.receiptDigest).not.toBe(first.phasePlan.receipt.receiptDigest);
    expect(() => adapter.planEventCommand({ request, actor, source,
      phaseExistingReceipt: different.receipt, workflowExistingReceipt: first.workflowPlan.receipt,
      instance: first.workflowPlan.nextInstance, workflowCurrentReceipt: first.workflowPlan.receipt, nowISO })).toThrow(/same trusted outcome/);
  });
  it("event adapter rejects corrupt phase actuals and orphan coordinator evidence", () => {
    const first = initialize();
    expect(() => move(first, { phaseCurrentReceipt: { ...first.phasePlan.receipt, receiptDigest: "bad" } })).toThrow();
    expect(() => move(first, { instance: null, workflowCurrentReceipt: first.workflowPlan.receipt })).toThrow(/atomic pair/);
    const cost = actuals.planCommand({ request: { ...source, requestId: "adapter-actual-cost-00001", actualsPolicyVersion: 1, expectedActualsRevision: 0, command: "record", category: "other", description: "Declared cost", costCents: 500 }, actor, source,
      phaseSnapshot: first.phasePlan.snapshot, nowISO });
    expect(adapter.actualsReference(source, cost.nextActualsState, cost.receipt)).toBeNull();
    let complete = cost;
    for (const category of ["labor", "purchasing", "other"]) {
      complete = actuals.planCommand({ request: { ...source, requestId: `adapter-declare-${category}-00001`, actualsPolicyVersion: 1,
        expectedActualsRevision: complete.nextActualsState.revision, command: "declare_category", category, state: "complete", note: "Confirmed captured category costs" },
        actor, source, phaseSnapshot: first.phasePlan.snapshot, actualsState: complete.nextActualsState, currentReceipt: complete.receipt, nowISO });
    }
    const ref = adapter.actualsReference(source, complete.nextActualsState, complete.receipt);
    expect(ref.totalCostCents).toBe(500);
    expect(ref.receiptDigest).toBe(complete.receipt.receiptDigest);
    expect(() => adapter.actualsReference(source, null, complete.receipt)).toThrow(/without its current state/);
    expect(() => adapter.actualsReference(source, cost.nextActualsState, { ...cost.receipt, receiptDigest: "bad" })).toThrow();
    expect(adapter.actualsReference(source, null, null)).toBeNull();
  });
  it("event adapter leaves administrator phase authority and exact accepted identity intact", () => {
    const first = initialize();
    expect(() => move(first, { actor: { ...actor, role: "sales" } })).toThrow(/administrator/);
    expect(() => move(first, { source: { ...source, acceptanceReceiptId: "moved" } })).toThrow();
    expect(adapter.eventSource({ ...source, quoteId: "accepted_événement" }).subjectId).toBe("accepted_événement");
    expect(execution.normalizeRequest.bind(null, { requestId: "forged-observe-domain-01", command: "observe_domain", expectedRevision: 1 })).toThrow();
  });
});


describe("version two event policy adapter", () => {
  it("event version two constraints add denial while preserving all original domain receipt bytes", () => {
    const seed = structuredClone(definitions.seedPublishedVersion());
    const body = { ...seed, schemaVersion: 2, organizationId: source.organizationId, seed: false, version: 1, versionId: "event_execution_v1", publishedBy: actor, publishedAtISO: nowISO,
      config: { ...seed.config, schemaVersion: 2, packPolicy: { phaseConstraints: { in_progress: { requiredCheckpoints: ["venue_access"], blockOpenUrgentIssues: false }, completed: { requiredCheckpoints: [], blockOpenUrgentIssues: false } }, checkpointPrerequisites: { venue_access: [], team_briefing: [], service_handoff: [], pack_down: [] } } } };
    delete body.definitionDigest;
    const definition = { ...body, definitionDigest: execution.digest(body) };
    const first = adapter.planEventCommand({ request, actor, source, definition, nowISO });
    expect(first.phasePlan).toEqual(phase.planCommand({ request, actor, source, nowISO }));
    expect(first.workflowPlan.nextInstance.schemaVersion).toBe(2);
    expect(first.workflowPlan.nextInstance.domainRef.stateCode).toBe("prepared");
    expect(() => move(first)).toThrow(/prerequisite/);
    const replay = adapter.planEventCommand({ request, actor, source: null, phaseExistingReceipt: first.phasePlan.receipt, workflowExistingReceipt: first.workflowPlan.receipt, nowISO });
    expect(replay.workflowPlan.idempotent).toBe(true);
    expect(replay.workflowPlan.nextInstance).toBeNull();
    expect(replay.phasePlan.idempotent).toBe(true);
  });
});
