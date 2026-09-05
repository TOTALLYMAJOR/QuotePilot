import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import { simulateCommercialChangeImpact } from "../commercialChangeImpact";
const require = createRequire(import.meta.url);
const adapters = require("../../../functions/workflowPackAdapters");
const execution = require("../../../functions/workflowExecution");
const definitions = require("../../../functions/workflowDefinitions");
const phase = require("../../../functions/eventOperations");
const work = require("../../../functions/eventOperatingWork");
const attendance = require("../../../functions/quoteAttendance");
const closeout = require("../../../functions/postEventCloseout");
const { createCommercialChangeAuthority } = require("../../../functions/commercialChangeAuthority");
const { buildCommercialChangeImpactPreviewSnapshots } = require("../../../functions/commercialChangeImpactPreview");
const graphCore = require("../commercialDependencyGraphCore.cjs");
const authority = createCommercialChangeAuthority({ graphCore, buildPreviewSnapshots: buildCommercialChangeImpactPreviewSnapshots, simulateImpact: simulateCommercialChangeImpact });
const source = { organizationId: "org-one", quoteId: "quote-one", sourceVersionId: "v1", acceptanceReceiptId: "acceptance-one" };
const actor = { organizationId: source.organizationId, uid: "admin-one", role: "admin" };
const ownerActor = { uid: actor.uid, role: actor.role, email: "owner@example.test" };
const nowISO = "2026-09-05T12:00:00.000Z";
const later = "2026-09-05T13:00:00.000Z";
function version(kind, policy, options = {}) {
  const body = { schemaVersion: 2, organizationId: source.organizationId, workflowKind: kind, definitionId: kind,
    versionId: `${kind}_v1`, version: 1, config: { ...structuredClone(definitions.seedPublishedVersion().config), schemaVersion: 2,
      workflowKind: kind, packPolicy: policy, ...options }, seed: false, publishedBy: actor, publishedAtISO: nowISO };
  return { ...body, definitionDigest: execution.digest(body) };
}
const eventPolicy = () => ({ phaseConstraints: { in_progress: { requiredCheckpoints: ["venue_access"], blockOpenUrgentIssues: true }, completed: { requiredCheckpoints: [], blockOpenUrgentIssues: false } }, checkpointPrerequisites: { venue_access: [], team_briefing: ["venue_access"], service_handoff: [], pack_down: [] } });
function phaseInit() {
  return phase.planCommand({ request: { ...source, requestId: "pack-phase-initial-000001", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" }, actor, source, nowISO });
}
function closeoutFixture() {
  const domainSource = { ...source, customerId: "customer-one", acceptedAtISO: nowISO, portalIssuedAtISO: nowISO, bookedAtISO: nowISO, eventDate: "2026-08-20" };
  const record = { schemaVersion: 1, closeoutId: closeout.buildPostEventCloseoutId(domainSource), ...source, customerId: domainSource.customerId,
    sourceAcceptedAtISO: nowISO, sourcePortalIssuedAtISO: nowISO, sourceBookedAtISO: nowISO, eventDate: domainSource.eventDate,
    dueDate: closeout.addCalendarDaysDateOnly(domainSource.eventDate), policy: closeout.buildPostEventCloseoutPolicySnapshot({ businessTimeZone: "America/Chicago" }),
    state: "pending", reviewItems: Object.fromEntries(closeout.POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES.map((code) => [code, { state: "pending", reviewedAtISO: "", reviewedBy: null, lastActionReceiptId: "" }])),
    completedAtISO: "", completedBy: null, createdAtISO: nowISO, updatedAtISO: nowISO, createdBy: ownerActor };
  return { domainSource, record };
}

describe("version two workflow domain adapters", () => {
  test("event pack constraints add exact checkpoint denials without changing phase or work evidence", () => {
    const initial = phaseInit();
    const definition = version("event_execution", eventPolicy());
    const before = JSON.stringify(initial);
    const input = { source, definition, ledger: initial.nextLedger, phaseReceipt: initial.receipt, command: { command: "transition", targetPhase: "in_progress" } };
    expect(() => adapters.assertEventConstraints(input)).toThrow(/prerequisite/);
    expect(() => adapters.assertEventConstraints({ ...input, command: { command: "checkpoint_record", checkpointCode: "team_briefing" } })).toThrow(/prerequisite/);
    const first = work.planCommand({ request: { ...source, requestId: "pack-checkpoint-record-00001", workPolicyVersion: 1, command: "checkpoint_record", expectedWorkRevision: 0, checkpointCode: "venue_access", note: "" }, actor, source,
      phaseSnapshot: phase.projectSnapshot(source, initial.nextLedger, initial.receipt), nowISO });
    const allowed = adapters.assertEventConstraints({ ...input, workState: first.nextWorkState, workReceipt: first.receipt });
    expect(allowed.decision).toBe("allowed");
    expect(allowed.workReceiptDigest).toBe(first.receipt.receiptDigest);
    expect(JSON.stringify(initial)).toBe(before);
    const observed = adapters.eventObservation({ source, ledger: initial.nextLedger, receipt: initial.receipt });
    expect(observed.domainRef.evidenceDigest).toBe(initial.receipt.receiptDigest);
    expect(observed.domainRef).not.toHaveProperty("revision");
  });
  test("attendance pack observes exact portal issuance without claiming applied or actual attendance", () => {
    const domainSource = { ...source, pricedCount: 80 };
    const request = { ...source, requestId: "pack-attendance-request-0001", expectedAttendanceRevision: 0, command: "request_confirmation" };
    const timing = { dueDate: "2026-09-10", policyReferenceId: "final-count-policy-one", timezone: "America/Chicago" };
    const first = attendance.planCommand({ request, source: domainSource, actor, timing, nowISO });
    const def = version("final_guest_count", { responsibleRoles: ["admin", "sales"] });
    const initial = adapters.attendanceObservation({ source: domainSource, state: first.nextState, receipt: first.receipt });
    const coordinator = adapters.planObservation({ ...initial, definition: def, actor, requestId: request.requestId, nowISO });
    const portal = { organizationId: source.organizationId, role: "customer", portalKeySha256: "a".repeat(64), portalIssuedAtISO: nowISO };
    const submitted = attendance.planCommand({ request: { ...source, requestId: "pack-attendance-response-0001", expectedAttendanceRevision: 1, command: "submit_response", confirmationRequestId: first.receipt.receiptId, count: 80 }, source: domainSource, actor: portal, state: first.nextState, currentReceipt: first.receipt, nowISO: later });
    expect(() => adapters.attendanceObservation({ source: domainSource, state: submitted.nextState, receipt: submitted.receipt })).toThrow(/issuance/);
    const observation = adapters.attendanceObservation({ source: domainSource, state: submitted.nextState, receipt: submitted.receipt, portalIdentity: portal });
    const result = adapters.planObservation({ ...observation, actor: portal, requestId: submitted.receipt.request.requestId, instance: coordinator.nextInstance, currentReceipt: coordinator.receipt, nowISO: later });
    expect(result.nextInstance.domainRef.stateCode).toBe("response_recorded");
    expect(result.nextInstance.tasks).toEqual(coordinator.nextInstance.tasks);
    expect(result.nextInstance.domainRef.stateCode).not.toContain("applied");
    expect(() => adapters.attendanceObservation({ source: domainSource, state: submitted.nextState, receipt: submitted.receipt, portalIdentity: { ...portal, portalIssuedAtISO: later } })).toThrow();
  });
  test("closeout immutable observation proofs reproduce domain actions and reject rehashed fabricated completion", () => {
    const { domainSource, record } = closeoutFixture();
    const definition = version("closeout_follow_up", { responsibleRoles: ["admin", "sales"], followUpOffsetDays: 3 });
    const initialProof = adapters.buildCloseoutObservationProof({ source: domainSource, record });
    const first = adapters.closeoutObservation({ proof: initialProof, definition });
    expect(first.domainRef.observationKind).toBe("record_snapshot");
    expect(first.scheduleAnchor.date).toBe("2026-08-30");
    const request = { organizationId: source.organizationId, quoteId: source.quoteId, closeoutId: record.closeoutId, itemCode: "internal_closeout", action: "review", requestId: "pack-closeout-review-00001", note: "Reviewed event details" };
    const action = closeout.planPostEventCloseoutAction({ request, source: domainSource, record, actor: ownerActor, nowISO: later });
    const proof = adapters.buildCloseoutObservationProof({ source: domainSource, priorRecord: record, record: action.nextRecord, actionReceipt: { ...action.receipt, createdAt: { seconds: 100 } } });
    expect(adapters.verifyCloseoutObservationProof(proof)).toEqual(proof);
    expect(proof.actionReceipt).not.toHaveProperty("createdAt");
    expect(adapters.closeoutObservation({ proof, definition }).domainRef.evidenceDigest).toBe(proof.proofDigest);
    const forged = structuredClone(proof); forged.actionReceipt.applied = false;
    const { proofDigest, ...body } = forged; forged.proofDigest = execution.digest(body);
    expect(() => adapters.verifyCloseoutObservationProof(forged)).toThrow();
    expect(() => adapters.buildCloseoutObservationProof({ source: { ...domainSource, sourceVersionId: "v2" }, record })).toThrow();
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



describe("quote review adapter receipt DAG", () => {
  test("quote pack follows verified simulation authorization and apply pins without inventing a native revision", () => {
    const definition = version("quote_review", { approval: { basis: "absolute_total_delta_cents", thresholdCents: 0, allowedRoles: ["admin", "sales"] } });
    const trusted = { actor: ownerActor, nowISO, catalogAuthorityDigest: "c".repeat(64), policyVersion: "commercial-policy-v1", workflowPolicy: adapters.quotePolicy(definition), attendanceBinding: null };
    const simulation = authority.simulate({ request: { organizationId: source.organizationId, quoteId: source.quoteId, requestId: `change_sim_${"a".repeat(32)}`, expectedActiveVersionId: source.sourceVersionId }, canonicalQuote: canonicalQuote(), proposedForm: proposedForm(), proposedPricing: pricing({ guests: 175, total: 16000 }), trustedContext: trusted }).receipt;
    const first = adapters.quoteObservation({ authority, simulationReceipt: simulation, definition });
    expect(first.source.sourceReceiptId).toBe(simulation.receiptId);
    expect(first.source.sourceVersionId).toBe(source.sourceVersionId);
    expect(first.domainRef.stateCode).toBe("authorization_required");
    const current = { activeRevisionId: source.sourceVersionId, catalogAuthorityDigest: trusted.catalogAuthorityDigest, policyVersion: trusted.policyVersion };
    const authorization = authority.authorize({ simulationReceipt: simulation, request: { organizationId: source.organizationId, quoteId: source.quoteId, requestId: `change_auth_${"b".repeat(32)}` }, trustedContext: trusted, current }).receipt;
    const applied = authority.buildApply({ simulationReceipt: simulation, authorizationReceipt: authorization, request: { organizationId: source.organizationId, quoteId: source.quoteId, requestId: `change_apply_${"c".repeat(32)}`, newRevisionId: "v2" }, trustedContext: trusted, current }).receipt;
    const final = adapters.quoteObservation({ authority, simulationReceipt: simulation, authorizationReceipt: authorization, applyReceipt: applied, definition });
    expect(final.domainRef.stateCode).toBe("applied");
    expect(final.domainRef.evidenceDigest).toBe(applied.receiptDigest);
    expect(final.domainRef).not.toHaveProperty("revision");
    expect(final.source).toEqual(first.source);
    expect(() => adapters.quoteObservation({ authority, simulationReceipt: simulation, applyReceipt: applied, definition })).toThrow();
    const other = version("quote_review", { approval: { basis: "absolute_total_delta_cents", thresholdCents: 1, allowedRoles: ["admin", "sales"] } });
    expect(() => adapters.quoteObservation({ authority, simulationReceipt: simulation, definition: other })).toThrow();
    const tamper = structuredClone(applied); tamper.simulationDigest = "d".repeat(64); delete tamper.receiptDigest; tamper.receiptDigest = execution.digest(tamper);
    expect(() => adapters.quoteObservation({ authority, simulationReceipt: simulation, authorizationReceipt: authorization, applyReceipt: tamper, definition })).toThrow();
  });
});


describe("closeout snapshot evidence validation", () => {
  test("closeout snapshot seals reject malformed actors coerced schema and fabricated chronology", () => {
    const { domainSource, record } = closeoutFixture();
    for (const mutate of [
      (value) => { value.schemaVersion = "1"; },
      (value) => { value.createdBy = { uid: [], role: "customer", email: "invalid" }; },
      (value) => { value.createdAtISO = "2027-01-01T00:00:00.000Z"; },
      (value) => { value.completedAtISO = nowISO; value.completedBy = ownerActor; }
    ]) {
      const changed = structuredClone(record); mutate(changed);
      expect(() => adapters.buildCloseoutObservationProof({ source: domainSource, record: changed })).toThrow();
    }
  });
});


describe("closeout configuration observation", () => {
  test("closeout refresh proof reproduces the native timezone change without redefining completion", () => {
    const { domainSource, record } = closeoutFixture();
    const request = { organizationId: source.organizationId, quoteId: source.quoteId, closeoutId: record.closeoutId, requestId: "pack-closeout-timezone-refresh-001" };
    const refreshed = closeout.planPostEventCloseoutPolicyRefresh({ request, record, source: domainSource,
      settings: { businessTimeZone: "America/New_York" }, actor: ownerActor, nowISO: later });
    const proof = adapters.buildCloseoutObservationProof({ source: domainSource, priorRecord: record, record: refreshed.nextRecord, actionReceipt: refreshed.receipt });
    expect(adapters.verifyCloseoutObservationProof(proof).resultRecord.state).toBe("pending");
    expect(proof.actionReceipt.resultTimeZone).toBe("America/New_York");
    const forged = structuredClone(proof); forged.actionReceipt.resultTimeZone = "Europe/London";
    const { proofDigest, ...body } = forged; forged.proofDigest = execution.digest(body);
    expect(() => adapters.verifyCloseoutObservationProof(forged)).toThrow();
  });
});
