import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { simulateCommercialChangeImpact } from "../commercialChangeImpact";

const require = createRequire(import.meta.url);
const graphCore = require("../commercialDependencyGraphCore.cjs");
const {
  CommercialChangeAuthorityError,
  COMMERCIAL_CHANGE_AUTHORITY,
  COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY,
  COMMERCIAL_CHANGE_PUBLISH_BOUNDARY,
  COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION,
  createCommercialChangeAuthority
} = require("../../../functions/commercialChangeAuthority.js");
const {
  buildCommercialChangeImpactPreviewSnapshots
} = require("../../../functions/commercialChangeImpactPreview.js");

const authority = createCommercialChangeAuthority({
  graphCore,
  buildPreviewSnapshots: buildCommercialChangeImpactPreviewSnapshots,
  simulateImpact: simulateCommercialChangeImpact
});

const ORGANIZATION_ID = "org-1";
const QUOTE_ID = "quote-1";
const BASE_REVISION_ID = "v0014";
const TARGET_REVISION_ID = "v0015";
const CATALOG_DIGEST = "c".repeat(64);
const POLICY_VERSION = "commercial-policy-v1";
const SIMULATION_REQUEST_ID = `change_sim_${"a".repeat(32)}`;
const AUTHORIZATION_REQUEST_ID = `change_auth_${"b".repeat(32)}`;
const APPLY_REQUEST_ID = `change_apply_${"c".repeat(32)}`;
const RECONCILIATION_REQUEST_ID = `change_reconcile_${"d".repeat(32)}`;

const SALES_ACTOR = Object.freeze({
  uid: "sales-1",
  email: "sales@example.test",
  role: "sales"
});
const ADMIN_ACTOR = Object.freeze({
  uid: "admin-1",
  email: "admin@example.test",
  role: "admin"
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
    id: QUOTE_ID,
    organizationId: ORGANIZATION_ID,
    customerId: "customer-1",
    activeVersionId: BASE_REVISION_ID,
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

function trustedContext({
  actor = SALES_ACTOR,
  nowISO = "2026-08-09T12:00:00.000Z",
  catalogAuthorityDigest = CATALOG_DIGEST,
  policyVersion = POLICY_VERSION
} = {}) {
  return { actor, nowISO, catalogAuthorityDigest, policyVersion };
}

function currentAuthority(overrides = {}) {
  return {
    activeRevisionId: BASE_REVISION_ID,
    catalogAuthorityDigest: CATALOG_DIGEST,
    policyVersion: POLICY_VERSION,
    ...overrides
  };
}

function simulationRequest(requestId = SIMULATION_REQUEST_ID) {
  return {
    requestId,
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    expectedActiveVersionId: BASE_REVISION_ID
  };
}

function authorizationRequest(requestId = AUTHORIZATION_REQUEST_ID) {
  return { requestId, organizationId: ORGANIZATION_ID, quoteId: QUOTE_ID };
}

function applyRequest(requestId = APPLY_REQUEST_ID, newRevisionId = TARGET_REVISION_ID) {
  return {
    requestId,
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    newRevisionId
  };
}

function makeSimulation({
  request = simulationRequest(),
  form = proposedForm(),
  proposedPricing = pricing({ guests: 175, total: 16920, deposit: 4230 }),
  context = trustedContext(),
  existingReceipt = null
} = {}) {
  return authority.simulate({
    request,
    canonicalQuote: canonicalQuote(),
    proposedForm: form,
    proposedPricing,
    trustedContext: context,
    existingReceipt
  });
}

function makeAuthorization(simulationReceipt, overrides = {}) {
  return authority.authorize({
    simulationReceipt,
    request: authorizationRequest(),
    trustedContext: trustedContext({
      actor: ADMIN_ACTOR,
      nowISO: "2026-08-09T12:01:00.000Z"
    }),
    current: currentAuthority(),
    ...overrides
  });
}

function makeApply(simulationReceipt, authorizationReceipt, overrides = {}) {
  return authority.buildApply({
    simulationReceipt,
    authorizationReceipt,
    request: applyRequest(),
    trustedContext: trustedContext({ nowISO: "2026-08-09T12:02:00.000Z" }),
    current: currentAuthority(),
    ...overrides
  });
}

function makeApplyOutcome(simulationReceipt, authorizationReceipt, overrides = {}) {
  return authority.reconcileApplyOutcome({
    simulationReceipt,
    authorizationReceipt,
    applyReceipt: null,
    request: {
      requestId: APPLY_REQUEST_ID,
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      simulationReceiptId: simulationReceipt.receiptId,
      authorizationReceiptId: authorizationReceipt?.receiptId || "",
      expectedBaseRevisionId: BASE_REVISION_ID
    },
    trustedContext: {
      actor: SALES_ACTOR,
      nowISO: "2026-08-09T12:04:00.000Z"
    },
    current: { activeRevisionId: BASE_REVISION_ID },
    ...overrides
  });
}

function reconciliationEvidence(invalidation, index = 0, overrides = {}) {
  const artifactLike = ["artifact", "projection"].includes(invalidation.nodeKind);
  const resolution = invalidation.nodeKind === "artifact"
    ? "artifact_current"
    : invalidation.nodeKind === "projection"
      ? "projection_current"
      : "decision_resolved";
  return {
    schemaVersion: COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION,
    authority: COMMERCIAL_CHANGE_AUTHORITY,
    evidenceId: `trusted-evidence-${index}`,
    invalidationId: invalidation.invalidationId,
    nodeId: invalidation.nodeId,
    sourceRevisionId: TARGET_REVISION_ID,
    resolution,
    state: artifactLike ? "CURRENT" : "RESOLVED",
    ...overrides
  };
}

function evidenceMap(invalidations) {
  return Object.fromEntries(invalidations.map((invalidation, index) => [
    invalidation.invalidationId,
    reconciliationEvidence(invalidation, index)
  ]));
}

function makeReconciliation(applyReceipt, invalidations, overrides = {}) {
  return authority.reconcile({
    applyReceipt,
    request: {
      requestId: RECONCILIATION_REQUEST_ID,
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      invalidationIds: invalidations.map((item) => item.invalidationId)
    },
    evidenceByInvalidationId: evidenceMap(invalidations),
    trustedContext: trustedContext({ nowISO: "2026-08-09T12:03:00.000Z" }),
    current: { activeRevisionId: TARGET_REVISION_ID },
    ...overrides
  });
}

function expectAuthorityError(action, code, details = undefined) {
  let caught;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CommercialChangeAuthorityError);
  expect(caught).toMatchObject({ code });
  if (details) expect(caught.details).toMatchObject(details);
}

describe("server Commercial Change Authority foundation", () => {
  test("simulates exact commercial consequences without mutating or publishing", () => {
    const result = makeSimulation();
    const { receipt } = result;

    expect(result.idempotent).toBe(false);
    expect(receipt).toMatchObject({
      authority: "server_authoritative",
      receiptType: "simulation",
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      baseRevisionId: BASE_REVISION_ID,
      authorizationRequired: true,
      factDiffs: expect.arrayContaining([{
        nodeId: "fact.event.guest_count",
        before: 125,
        proposedAfter: 175
      }]),
      boundary: COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY
    });
    expect(receipt.receiptId).toMatch(/^ccs_[a-f0-9]{48}$/);
    expect(receipt.receiptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.commercialValues.authoritativeTotal).toMatchObject({
      before: 12480,
      proposedAfter: 16920,
      changed: true
    });
    expect(receipt.impact.dependentNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "artifact.kitchen_beo",
        nodeKind: "artifact",
        classification: "STALE"
      })
    ]));
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.impact.dependentNodes)).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain("publish succeeded");
    expect(JSON.stringify(receipt)).not.toContain("customer@example");
  });

  test("permits an unchanged revision without manufacturing authorization or invalidations", () => {
    const simulation = makeSimulation({
      form: proposedForm({ guests: 125 }),
      proposedPricing: pricing()
    }).receipt;

    expect(simulation).toMatchObject({
      authorizationRequired: false,
      factDiffs: [],
      impact: {
        rootNodeIds: [],
        dependentNodes: [],
        counts: { total: 0, review: 0, stale: 0 }
      }
    });
    expectAuthorityError(
      () => makeAuthorization(simulation),
      "failed-precondition"
    );

    const applied = makeApply(simulation, null).receipt;
    expect(applied).toMatchObject({
      authorizationConsumed: false,
      authorizationReceiptId: "",
      invalidationReceipts: [],
      decisionOpenings: [],
      safeToPublish: true
    });
    expect(authority.evaluatePublishGate({
      applyReceipt: applied,
      currentRevisionId: TARGET_REVISION_ID
    })).toMatchObject({ state: "READY", safeToPublish: true });
  });

  test("binds simulation request identity idempotently to exact immutable evidence", () => {
    const first = makeSimulation().receipt;
    const replay = makeSimulation({ existingReceipt: first });

    expect(replay).toEqual({ receipt: first, idempotent: true });
    expectAuthorityError(
      () => makeSimulation({
        existingReceipt: first,
        form: proposedForm({ guests: 200 }),
        proposedPricing: pricing({ guests: 200, total: 19200, deposit: 4800 })
      }),
      "already-exists"
    );
  });

  test("requires admin authority and binds authorization to the exact simulation", () => {
    const simulation = makeSimulation().receipt;
    expectAuthorityError(
      () => makeAuthorization(simulation, {
        trustedContext: trustedContext({
          actor: SALES_ACTOR,
          nowISO: "2026-08-09T12:01:00.000Z"
        })
      }),
      "permission-denied"
    );

    const authorization = makeAuthorization(simulation).receipt;
    expect(authorization).toMatchObject({
      receiptType: "authorization",
      state: "authorized",
      simulationReceiptId: simulation.receiptId,
      simulationDigest: simulation.receiptDigest,
      proposalDigest: simulation.proposalDigest,
      authorizedBy: ADMIN_ACTOR,
      authorizedFor: SALES_ACTOR
    });
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(makeAuthorization(simulation, { existingReceipt: authorization }))
      .toEqual({ receipt: authorization, idempotent: true });
  });

  test.each([
    ["quote revision", { activeRevisionId: "v0015" }, "quote_revision_changed"],
    ["catalog", { catalogAuthorityDigest: "e".repeat(64) }, "catalog_authority_changed"],
    ["policy", { policyVersion: "commercial-policy-v2" }, "policy_changed"]
  ])("rejects authorization when the %s authority changed", (_label, current, driftReason) => {
    const simulation = makeSimulation().receipt;
    expectAuthorityError(
      () => makeAuthorization(simulation, { current: currentAuthority(current) }),
      "aborted",
      { driftReason }
    );
  });

  test("rejects expired simulation authority", () => {
    const simulation = makeSimulation().receipt;
    expectAuthorityError(
      () => makeAuthorization(simulation, {
        trustedContext: trustedContext({
          actor: ADMIN_ACTOR,
          nowISO: "2026-08-09T12:15:00.001Z"
        })
      }),
      "failed-precondition",
      { driftReason: "authorization_expired" }
    );
  });

  test("requires the exact authorization before applying governed consequences", () => {
    const simulation = makeSimulation().receipt;
    expectAuthorityError(
      () => makeApply(simulation, null),
      "failed-precondition"
    );

    const otherSimulation = makeSimulation({
      request: simulationRequest(`change_sim_${"e".repeat(32)}`)
    }).receipt;
    const otherAuthorization = makeAuthorization(otherSimulation).receipt;
    expectAuthorityError(
      () => makeApply(simulation, otherAuthorization),
      "failed-precondition"
    );
  });

  test("applies as a new revision and emits immutable named invalidations and decisions", () => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    const result = makeApply(simulation, authorization);

    expect(result.receipt).toMatchObject({
      receiptType: "apply",
      baseRevisionId: BASE_REVISION_ID,
      newRevisionId: TARGET_REVISION_ID,
      simulationReceiptId: simulation.receiptId,
      authorizationReceiptId: authorization.receiptId,
      authorizationConsumed: true,
      safeToPublish: false,
      boundary: COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY
    });
    expect(result.invalidationReceipts).toHaveLength(simulation.impact.counts.total);
    expect(result.invalidationReceipts.every((item) => (
      item.initialState === "open"
      && Object.isFrozen(item)
      && item.targetRevisionId === TARGET_REVISION_ID
    ))).toBe(true);
    expect(result.invalidationReceipts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "artifact.kitchen_beo",
        classification: "STALE",
        initialState: "open"
      })
    ]));
    expect(result.decisionOpenings).toHaveLength(simulation.impact.counts.review);
    expect(result.decisionOpenings.every((item) => item.state === "open")).toBe(true);
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(simulation.authorizationRequired).toBe(true);
    expect(authorization.state).toBe("authorized");
  });

  test("rejects stale apply state and makes exact retries idempotent after the revision advances", () => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    expectAuthorityError(
      () => makeApply(simulation, authorization, {
        current: currentAuthority({ activeRevisionId: "v0099" })
      }),
      "aborted",
      { driftReason: "quote_revision_changed" }
    );

    const first = makeApply(simulation, authorization).receipt;
    const replay = makeApply(simulation, authorization, {
      existingReceipt: first,
      current: currentAuthority({ activeRevisionId: TARGET_REVISION_ID })
    });
    expect(replay).toMatchObject({ receipt: first, idempotent: true });
    expectAuthorityError(
      () => makeApply(simulation, authorization, {
        existingReceipt: first,
        request: applyRequest(APPLY_REQUEST_ID, "v0016"),
        current: currentAuthority({ activeRevisionId: TARGET_REVISION_ID })
      }),
      "already-exists"
    );
  });

  test("reconciles an exact apply as committed only with its immutable receipt and revision", () => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    const applied = makeApply(simulation, authorization).receipt;
    const result = makeApplyOutcome(simulation, authorization, {
      applyReceipt: applied,
      current: { activeRevisionId: TARGET_REVISION_ID }
    });

    expect(result.idempotent).toBe(false);
    expect(result.receipt).toMatchObject({
      receiptType: "outcome",
      state: "committed",
      requestId: APPLY_REQUEST_ID,
      operationId: applied.operationId,
      simulationReceiptId: simulation.receiptId,
      authorizationReceiptId: authorization.receiptId,
      baseRevisionId: BASE_REVISION_ID,
      activeRevisionId: TARGET_REVISION_ID,
      sourceChanged: true,
      applyReceiptId: applied.receiptId,
      applyReceiptDigest: applied.receiptDigest,
      newRevisionId: TARGET_REVISION_ID,
      appliedRevisionIsActive: true
    });
    expect(result.receipt.receiptId).toMatch(/^ccor_[a-f0-9]{48}$/u);
    expect(result.receipt.receiptDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(authority.reconcileApplyOutcome({
      simulationReceipt: simulation,
      authorizationReceipt: authorization,
      applyReceipt: applied,
      request: {
        requestId: APPLY_REQUEST_ID,
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        simulationReceiptId: simulation.receiptId,
        authorizationReceiptId: authorization.receiptId,
        expectedBaseRevisionId: BASE_REVISION_ID
      },
      trustedContext: {
        actor: SALES_ACTOR,
        nowISO: "2026-08-09T12:05:00.000Z"
      },
      current: { activeRevisionId: TARGET_REVISION_ID },
      existingReceipt: result.receipt
    })).toEqual({ receipt: result.receipt, idempotent: true });
  });

  test("creates a definitive not-committed outcome without inventing apply evidence", () => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    const result = makeApplyOutcome(simulation, authorization);

    expect(result.receipt).toMatchObject({
      state: "not_committed",
      sourceChanged: false,
      activeRevisionId: BASE_REVISION_ID,
      expectedApplyReceiptId: expect.stringMatching(/^ccp_[a-f0-9]{48}$/u),
      applyReceiptId: "",
      applyReceiptDigest: "",
      newRevisionId: "",
      appliedRevisionIsActive: false
    });
    expect(JSON.stringify(result.receipt)).toContain("fences that request identity");
  });

  test("rejects apply outcome evidence outside the exact request and authorization scope", () => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    const applied = makeApply(simulation, authorization).receipt;

    expectAuthorityError(() => makeApplyOutcome(simulation, authorization, {
      request: {
        requestId: APPLY_REQUEST_ID,
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        simulationReceiptId: simulation.receiptId,
        authorizationReceiptId: authorization.receiptId,
        expectedBaseRevisionId: "v0099"
      }
    }), "failed-precondition");
    expectAuthorityError(() => makeApplyOutcome(simulation, authorization, {
      applyReceipt: {
        ...applied,
        requestId: `change_apply_${"f".repeat(32)}`
      },
      current: { activeRevisionId: TARGET_REVISION_ID }
    }), "failed-precondition");
  });

  test("reconciles only explicitly named dependencies with trusted revision-bound evidence", () => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    const applied = makeApply(simulation, authorization).receipt;
    const named = applied.invalidationReceipts.slice(0, 2);
    const result = makeReconciliation(applied, named);

    expect(result.receipt).toMatchObject({
      receiptType: "reconciliation",
      applyReceiptId: applied.receiptId,
      applyReceiptDigest: applied.receiptDigest,
      activeRevisionId: TARGET_REVISION_ID,
      boundary: COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY
    });
    expect(result.receipt.resolutions.map((item) => item.invalidationId).sort())
      .toEqual(named.map((item) => item.invalidationId).sort());
    expect(result.receipt.resolutions.every((item) => (
      /^[a-f0-9]{64}$/.test(item.evidenceDigest)
    ))).toBe(true);
    expect(applied.invalidationReceipts.every((item) => item.initialState === "open")).toBe(true);
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(makeReconciliation(applied, named, { existingReceipt: result.receipt }))
      .toEqual({ receipt: result.receipt, idempotent: true });
  });

  test("accepts server-verified not-generated evidence for an absent dependent artifact", () => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    const applied = makeApply(simulation, authorization).receipt;
    const invalidation = applied.invalidationReceipts.find((item) => (
      item.nodeKind === "artifact"
    ));
    const result = makeReconciliation(applied, [invalidation], {
      evidenceByInvalidationId: {
        [invalidation.invalidationId]: reconciliationEvidence(invalidation, 0, {
          resolution: "artifact_not_generated",
          state: "NOT_GENERATED"
        })
      }
    });

    expect(result.receipt.resolutions).toEqual([
      expect.objectContaining({
        invalidationId: invalidation.invalidationId,
        resolution: "artifact_not_generated"
      })
    ]);
  });

  test.each([
    ["node", { nodeId: "artifact.customer_proposal" }],
    ["source revision", { sourceRevisionId: "v0014" }],
    ["state", { state: "STALE" }]
  ])("rejects reconciliation evidence with the wrong %s", (_label, evidenceOverride) => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    const applied = makeApply(simulation, authorization).receipt;
    const invalidation = applied.invalidationReceipts[0];
    expectAuthorityError(
      () => makeReconciliation(applied, [invalidation], {
        evidenceByInvalidationId: {
          [invalidation.invalidationId]: reconciliationEvidence(
            invalidation,
            0,
            evidenceOverride
          )
        }
      }),
      "failed-precondition"
    );
  });

  test("rejects unknown and already-resolved invalidation identities", () => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    const applied = makeApply(simulation, authorization).receipt;
    const invalidation = applied.invalidationReceipts[0];
    expectAuthorityError(
      () => makeReconciliation(applied, [invalidation], {
        request: {
          requestId: RECONCILIATION_REQUEST_ID,
          organizationId: ORGANIZATION_ID,
          quoteId: QUOTE_ID,
          invalidationIds: ["cci_unknown"]
        }
      }),
      "failed-precondition"
    );

    const first = makeReconciliation(applied, [invalidation]).receipt;
    expectAuthorityError(
      () => makeReconciliation(applied, [invalidation], {
        request: {
          requestId: `change_reconcile_${"e".repeat(32)}`,
          organizationId: ORGANIZATION_ID,
          quoteId: QUOTE_ID,
          invalidationIds: [invalidation.invalidationId]
        },
        priorReconciliationReceipts: [first]
      }),
      "failed-precondition"
    );
  });

  test("keeps publication blocked until every named dependency is reconciled", () => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    const applied = makeApply(simulation, authorization).receipt;
    const [firstInvalidation, ...remaining] = applied.invalidationReceipts;

    const blocked = authority.evaluatePublishGate({
      applyReceipt: applied,
      currentRevisionId: TARGET_REVISION_ID
    });
    expect(blocked).toMatchObject({
      state: "BLOCKED",
      safeToPublish: false,
      resolvedCount: 0,
      boundary: COMMERCIAL_CHANGE_PUBLISH_BOUNDARY
    });

    const first = makeReconciliation(applied, [firstInvalidation]).receipt;
    const partial = authority.evaluatePublishGate({
      applyReceipt: applied,
      reconciliationReceipts: [first],
      currentRevisionId: TARGET_REVISION_ID
    });
    expect(partial).toMatchObject({ state: "BLOCKED", safeToPublish: false, resolvedCount: 1 });

    const second = makeReconciliation(applied, remaining, {
      request: {
        requestId: `change_reconcile_${"f".repeat(32)}`,
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        invalidationIds: remaining.map((item) => item.invalidationId)
      },
      priorReconciliationReceipts: [first],
      trustedContext: trustedContext({ nowISO: "2026-08-09T12:04:00.000Z" })
    }).receipt;
    const ready = authority.evaluatePublishGate({
      applyReceipt: applied,
      reconciliationReceipts: [first, second],
      currentRevisionId: TARGET_REVISION_ID
    });
    expect(ready).toMatchObject({
      state: "READY",
      safeToPublish: true,
      resolvedCount: applied.invalidationReceipts.length,
      unresolvedInvalidations: [],
      reasonCodes: ["all_named_dependencies_reconciled"],
      boundary: COMMERCIAL_CHANGE_PUBLISH_BOUNDARY
    });
    expect(ready.boundary).toContain("does not publish");
  });

  test("fails the publication gate closed for stale or conflicting reconciliation evidence", () => {
    const simulation = makeSimulation().receipt;
    const authorization = makeAuthorization(simulation).receipt;
    const applied = makeApply(simulation, authorization).receipt;
    const reconciliation = makeReconciliation(
      applied,
      applied.invalidationReceipts
    ).receipt;

    expect(authority.evaluatePublishGate({
      applyReceipt: applied,
      reconciliationReceipts: [reconciliation],
      currentRevisionId: "v0016"
    })).toMatchObject({
      state: "STALE",
      safeToPublish: false,
      reasonCodes: ["active_revision_changed"]
    });
    expect(authority.evaluatePublishGate({
      applyReceipt: applied,
      reconciliationReceipts: [reconciliation, reconciliation],
      currentRevisionId: TARGET_REVISION_ID
    })).toMatchObject({
      state: "UNKNOWN",
      safeToPublish: false,
      reasonCodes: ["reconciliation_duplicate_resolution"]
    });
  });

  test("detects receipt tampering, wrong scope, and immutable replay collisions", () => {
    const simulation = makeSimulation().receipt;
    expectAuthorityError(
      () => authority.validateSimulationReceipt({
        ...simulation,
        proposalDigest: "f".repeat(64)
      }),
      "failed-precondition"
    );
    expectAuthorityError(
      () => authority.authorize({
        simulationReceipt: simulation,
        request: {
          ...authorizationRequest(),
          organizationId: "org-2"
        },
        trustedContext: trustedContext({
          actor: ADMIN_ACTOR,
          nowISO: "2026-08-09T12:01:00.000Z"
        }),
        current: currentAuthority()
      }),
      "permission-denied"
    );

    const exactReplay = authority.reconcileReceiptReplay({
      existingReceipt: simulation,
      proposedReceipt: simulation,
      type: "simulation"
    });
    expect(exactReplay).toEqual({ receipt: simulation, idempotent: true });

    const other = makeSimulation({
      request: simulationRequest(`change_sim_${"1".repeat(32)}`)
    }).receipt;
    expectAuthorityError(
      () => authority.reconcileReceiptReplay({
        existingReceipt: simulation,
        proposedReceipt: other,
        type: "simulation"
      }),
      "invalid-argument"
    );
  });

  test("requires bounded request identities and authority configuration", () => {
    expectAuthorityError(
      () => makeSimulation({
        request: simulationRequest("change_sim_not-random")
      }),
      "invalid-argument"
    );
    expectAuthorityError(
      () => createCommercialChangeAuthority({
        graphCore,
        buildPreviewSnapshots: buildCommercialChangeImpactPreviewSnapshots,
        simulateImpact: simulateCommercialChangeImpact,
        simulationTtlMs: 30_000
      }),
      "invalid-argument"
    );
  });
});

function publishedWorkflowPolicy(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    definitionPin: { workflowKind: "quote_review", schemaVersion: 2, definitionId: "quote_review", versionId: "quote_review_v1", version: 1, definitionDigest: "e".repeat(64) },
    approvalPolicy: { basis: "absolute_total_delta_cents", thresholdCents: 0, allowedRoles: ["admin", "sales"] },
    declaredBy: "tenant-admin", declaredAtISO: "2026-08-01T12:00:00.000Z", ...overrides
  };
}
function attendanceSubmissionBinding(overrides = {}) {
  return { organizationId: ORGANIZATION_ID, quoteId: QUOTE_ID, sourceVersionId: BASE_REVISION_ID,
    acceptanceReceiptId: "acceptance-125", submissionReceiptId: "attendance-response-125", submissionReceiptDigest: "f".repeat(64), count: 125, ...overrides };
}
function rehashCommercialReceipt(receipt, patch) {
  const { receiptDigest: _old, ...body } = { ...structuredClone(receipt), ...patch };
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  return { ...body, receiptDigest: require("node:crypto").createHash("sha256").update(graphCore.canonicalSerialize(body)).digest("hex") };
}

describe("workflow-pinned commercial authority", () => {
  test("converts authoritative USD totals by deterministic decimal minor units", () => {
    const { authoritativeMoneyToCents } = require("../../../functions/commercialChangeAuthority.js");
    expect([0, 1.005, 2.675, 1e-7, 1e12].map(authoritativeMoneyToCents)).toEqual([0, 101, 268, 0, 1e14]);
    for (const value of [-1, NaN, Infinity, "1.00", 1e12 + 1]) expectAuthorityError(() => authoritativeMoneyToCents(value), "failed-precondition");
  });

  test("workflow policy adds exact threshold approval without removing the impact floor", () => {
    const high = publishedWorkflowPolicy({ approvalPolicy: { basis: "absolute_total_delta_cents", thresholdCents: 1e9, allowedRoles: ["admin", "sales"] } });
    const simulation = makeSimulation({ context: { ...trustedContext(), workflowPolicy: high } }).receipt;
    expect(simulation.schemaVersion).toBe("commercial-change-simulation-receipt-v2");
    expect(simulation.approvalEvaluation).toMatchObject({ beforeTotalCents: 1248000, proposedTotalCents: 1692000, absoluteTotalDeltaCents: 444000, impactApprovalRequired: true, thresholdApprovalRequired: false });
    expect(simulation.authorizationRequired).toBe(true);
    const authorization = makeAuthorization(simulation).receipt;
    const applied = makeApply(simulation, authorization).receipt;
    expect(authorization.schemaVersion).toBe("commercial-change-authorization-receipt-v2");
    expect(applied.schemaVersion).toBe("commercial-change-apply-receipt-v2");
    expect(applied.workflowPolicy).toEqual(simulation.workflowPolicy);
    expect(applied.approvalEvaluation).toEqual(simulation.approvalEvaluation);
    expect(applied.authorizationConsumed).toBe(true);
  });

  test("an explicit zero threshold requires real admin authorization even for no impact", () => {
    const simulation = makeSimulation({ form: proposedForm({ guests: 125 }), proposedPricing: pricing(), context: { ...trustedContext(), workflowPolicy: publishedWorkflowPolicy() } }).receipt;
    expect(simulation.impact.counts.total).toBe(0);
    expect(simulation.approvalEvaluation).toMatchObject({ absoluteTotalDeltaCents: 0, impactApprovalRequired: false, thresholdApprovalRequired: true });
    expect(simulation.authorizationRequired).toBe(true);
    expectAuthorityError(() => makeApply(simulation, null), "failed-precondition");
    expectAuthorityError(() => makeAuthorization(simulation, { trustedContext: trustedContext() }), "permission-denied");
    const authorization = makeAuthorization(simulation).receipt;
    const applied = makeApply(simulation, authorization).receipt;
    expect(applied.newRevisionId).toBe(TARGET_REVISION_ID);
    expect(applied.invalidationReceipts).toEqual([]);
  });

  test("pinned allowed roles restrict simulation and apply without widening authorization", () => {
    const policy = publishedWorkflowPolicy({ approvalPolicy: { basis: "absolute_total_delta_cents", thresholdCents: null, allowedRoles: ["admin"] } });
    expectAuthorityError(() => makeSimulation({ context: { ...trustedContext(), workflowPolicy: policy } }), "permission-denied");
    const simulation = makeSimulation({ form: proposedForm({ guests: 125 }), proposedPricing: pricing(), context: { ...trustedContext({ actor: ADMIN_ACTOR }), workflowPolicy: policy } }).receipt;
    expectAuthorityError(() => makeApply(simulation, null), "permission-denied");
    expect(makeApply(simulation, null, { trustedContext: trustedContext({ actor: ADMIN_ACTOR }) }).receipt.appliedBy.role).toBe("admin");
  });

  test("equal attendance becomes applied evidence only through an exact new commercial revision", () => {
    const attendanceBinding = attendanceSubmissionBinding();
    const simulation = makeSimulation({ form: proposedForm({ guests: 125 }), proposedPricing: pricing(), context: { ...trustedContext(), attendanceBinding } }).receipt;
    expect(simulation.workflowPolicy).toBeNull();
    expect(simulation.authorizationRequired).toBe(false);
    const applied = makeApply(simulation, null).receipt;
    expect(applied.attendanceBinding).toEqual(attendanceBinding);
    expect(applied.baseRevisionId).toBe(BASE_REVISION_ID);
    expect(applied.newRevisionId).toBe(TARGET_REVISION_ID);
    expectAuthorityError(() => makeApply(simulation, null, { request: applyRequest(APPLY_REQUEST_ID, BASE_REVISION_ID) }), "invalid-argument");
    const outcome = makeApplyOutcome(simulation, null, { applyReceipt: applied, current: { activeRevisionId: TARGET_REVISION_ID } }).receipt;
    expect(outcome).toBeTruthy();
  });

  test("attendance and policy bindings reject changed source count scope and immutable retry", () => {
    const baseline = { form: proposedForm({ guests: 125 }), proposedPricing: pricing() };
    for (const [patch, code] of [[{ quoteId: "foreign" }, "permission-denied"], [{ organizationId: "foreign" }, "permission-denied"], [{ sourceVersionId: "old" }, "aborted"], [{ count: 126 }, "failed-precondition"], [{ count: 0 }, "failed-precondition"]]) {
      expectAuthorityError(() => makeSimulation({ ...baseline, context: { ...trustedContext(), attendanceBinding: attendanceSubmissionBinding(patch) } }), code);
    }
    expectAuthorityError(() => makeSimulation({ context: { ...trustedContext(), workflowPolicy: publishedWorkflowPolicy({ organizationId: "foreign" }) } }), "permission-denied");
    const first = makeSimulation({ ...baseline, context: { ...trustedContext(), attendanceBinding: attendanceSubmissionBinding() } }).receipt;
    expect(makeSimulation({ ...baseline, context: { ...trustedContext(), attendanceBinding: attendanceSubmissionBinding() }, existingReceipt: first }).idempotent).toBe(true);
    expectAuthorityError(() => makeSimulation({ ...baseline, context: { ...trustedContext(), attendanceBinding: attendanceSubmissionBinding({ submissionReceiptId: "different-receipt" }) }, existingReceipt: first }), "already-exists");
  });

  test("rehashing cannot remove threshold approval or replace the binding across receipt types", () => {
    const simulation = makeSimulation({ form: proposedForm({ guests: 125 }), proposedPricing: pricing(), context: { ...trustedContext(), workflowPolicy: publishedWorkflowPolicy() } }).receipt;
    expectAuthorityError(() => authority.validateSimulationReceipt(rehashCommercialReceipt(simulation, { authorizationRequired: false })), "failed-precondition");
    expectAuthorityError(() => authority.validateSimulationReceipt(rehashCommercialReceipt(simulation, { approvalEvaluation: { ...simulation.approvalEvaluation, beforeTotalCents: 0 } })), "failed-precondition");
    const authorization = makeAuthorization(simulation).receipt;
    const replaced = rehashCommercialReceipt(authorization, { workflowPolicy: { ...authorization.workflowPolicy, definitionPin: { ...authorization.workflowPolicy.definitionPin, versionId: "quote_review_v2", version: 2 } } });
    expectAuthorityError(() => makeApply(simulation, replaced), "failed-precondition");
    const missingSchema = rehashCommercialReceipt(makeApply(simulation, authorization).receipt, { schemaVersion: undefined });
    expectAuthorityError(() => authority.validateApplyReceipt(missingSchema), "failed-precondition");
  });

  test("version one receipts cannot claim workflow or attendance seals", () => {
    const legacy = makeSimulation().receipt;
    expect(legacy.schemaVersion).toBe("commercial-change-simulation-receipt-v1");
    expect(legacy).not.toHaveProperty("workflowPolicy");
    expectAuthorityError(() => authority.validateSimulationReceipt(rehashCommercialReceipt(legacy, { workflowPolicy: publishedWorkflowPolicy() })), "failed-precondition");
  });
});

test("versioned workflow bindings reject coerced strings and mismatched authorization replay seals", () => {
  for (const value of [42, ["tenant-admin"], " tenant-admin "]) {
    expectAuthorityError(() => makeSimulation({ context: { ...trustedContext(), workflowPolicy: publishedWorkflowPolicy({ declaredBy: value }) } }), "failed-precondition");
  }
  expectAuthorityError(() => makeSimulation({ context: { ...trustedContext(), workflowPolicy: publishedWorkflowPolicy({ declaredAtISO: ["2026-08-01T12:00:00.000Z"] }) } }), "failed-precondition");
  const uppercase = publishedWorkflowPolicy(); uppercase.definitionPin.definitionDigest = "E".repeat(64);
  expectAuthorityError(() => makeSimulation({ context: { ...trustedContext(), workflowPolicy: uppercase } }), "failed-precondition");
  for (const patch of [{ acceptanceReceiptId: ["acceptance-125"] }, { submissionReceiptId: ["attendance-response-125"] }, { submissionReceiptDigest: ["f".repeat(64)] }]) {
    expectAuthorityError(() => makeSimulation({ form: proposedForm({ guests: 125 }), proposedPricing: pricing(), context: { ...trustedContext(), attendanceBinding: attendanceSubmissionBinding(patch) } }), "failed-precondition");
  }
  const simulation = makeSimulation({ context: { ...trustedContext(), workflowPolicy: publishedWorkflowPolicy() } }).receipt;
  const authorization = makeAuthorization(simulation).receipt;
  const replaced = rehashCommercialReceipt(authorization, { workflowPolicy: { ...authorization.workflowPolicy, declaredBy: "different-admin" } });
  expectAuthorityError(() => makeAuthorization(simulation, { existingReceipt: replaced }), "failed-precondition");
});
