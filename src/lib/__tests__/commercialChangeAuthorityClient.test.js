import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  COMMERCIAL_DEPENDENCY_GRAPH_ID,
  COMMERCIAL_DEPENDENCY_GRAPH_VERSION
} from "../commercialDependencyGraph";

const mockState = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  cloudFunctions: { id: "functions" }
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockState.httpsCallable
}));

vi.mock("../firebase", () => ({
  auth: null,
  cloudFunctions: mockState.cloudFunctions,
  db: null,
  firebaseReady: true
}));

import {
  COMMERCIAL_CHANGE_AUTHORITY_CALLABLES,
  authorizeCommercialQuoteChange,
  buildCommercialChangeRequestId,
  getCommercialDependencyState,
  getCommercialQuoteChangeAuthorizationState,
  isDefinitiveCommercialChangeError,
  reconcileCommercialQuoteChangeApplyOutcome,
  reconcileCommercialDependencyState,
  requestCommercialQuoteChangeAuthorization,
  simulateCommercialQuoteChange
} from "../commercialChangeAuthorityClient";

const SCOPE = Object.freeze({
  organizationId: "org-one",
  quoteId: "quote-one"
});
const BASE_REVISION_ID = "v0014";
const TARGET_REVISION_ID = "v0015";
const SIMULATION_REQUEST_ID = `change_sim_${"a".repeat(32)}`;
const APPROVAL_REQUEST_ID = `change_auth_request_${"b".repeat(32)}`;
const AUTHORIZATION_REQUEST_ID = `change_auth_${"c".repeat(32)}`;
const APPLY_REQUEST_ID = `change_apply_${"e".repeat(32)}`;
const RECONCILIATION_REQUEST_ID = `change_reconcile_${"d".repeat(32)}`;
const SIMULATION_RECEIPT_ID = `ccs_${"1".repeat(48)}`;
const AUTHORIZATION_RECEIPT_ID = `cca_${"2".repeat(48)}`;
const APPLY_RECEIPT_ID = `ccp_${"3".repeat(48)}`;
const INVALIDATION_ID = `cci_${"4".repeat(48)}`;
const RECONCILIATION_RECEIPT_ID = `ccr_${"5".repeat(48)}`;
const APPROVAL_ID = `ccar_${"6".repeat(48)}`;
const OPERATION_ID = `cco_${"7".repeat(48)}`;
const OUTCOME_RECEIPT_ID = `ccor_${"9".repeat(48)}`;
const DIGEST = "8".repeat(64);
const BOUNDARY = "Server evidence only; no dependent artifact is published.";
const SIMULATED_AT = "2026-08-09T12:00:00.000Z";
const EXPIRES_AT = "2026-08-09T12:15:00.000Z";

function actor(role = "sales") {
  return {
    uid: `${role}-uid`,
    email: `${role}@example.test`,
    role
  };
}

function commercialValues() {
  return {
    currency: "USD",
    authoritativeTotal: {
      before: 12480,
      proposedAfter: 16920,
      changed: true,
      beforeSourceLabel: "canonical_pricing_snapshot",
      proposedAfterSourceLabel: "authoritative_pricing_preview",
      authority: "server_authoritative"
    },
    depositRequirement: {
      before: 3120,
      proposedAfter: 4230,
      changed: true,
      beforeSourceLabel: "canonical_pricing_snapshot",
      proposedAfterSourceLabel: "authoritative_pricing_preview",
      authority: "server_authoritative"
    }
  };
}

function factDiffs() {
  return [{
    nodeId: "fact.event.guest_count",
    before: 125,
    proposedAfter: 175
  }];
}

function receiptImpact() {
  return {
    rootNodeIds: ["fact.event.guest_count"],
    dependentNodes: [{
      nodeId: "artifact.kitchen_beo",
      nodeKind: "artifact",
      distance: 1,
      triggeredBy: ["fact.event.guest_count"],
      classification: "STALE"
    }],
    counts: { total: 1, review: 0, stale: 1 }
  };
}

function projectedImpact() {
  return {
    rootNodeIds: ["fact.event.guest_count"],
    dependentNodes: [{
      id: "artifact.kitchen_beo",
      kind: "artifact",
      distance: 1,
      triggeredBy: ["fact.event.guest_count"],
      advisoryClass: "STALE"
    }],
    counts: { total: 1, review: 0, stale: 1 }
  };
}

function graph() {
  return {
    graphId: COMMERCIAL_DEPENDENCY_GRAPH_ID,
    graphVersion: COMMERCIAL_DEPENDENCY_GRAPH_VERSION
  };
}

function simulationReceipt(overrides = {}) {
  return {
    schemaVersion: "commercial-change-simulation-receipt-v1",
    authority: "server_authoritative",
    receiptType: "simulation",
    receiptId: SIMULATION_RECEIPT_ID,
    requestId: SIMULATION_REQUEST_ID,
    organizationId: SCOPE.organizationId,
    quoteId: SCOPE.quoteId,
    baseRevisionId: BASE_REVISION_ID,
    proposedRevisionId: "preview-v0015",
    proposalDigest: DIGEST,
    impactDigest: DIGEST,
    catalogAuthorityDigest: DIGEST,
    policyVersion: "commercial-change-policy-v1",
    graph: graph(),
    factDiffs: factDiffs(),
    commercialValues: commercialValues(),
    impact: receiptImpact(),
    authorizationRequired: true,
    simulatedAtISO: SIMULATED_AT,
    expiresAtISO: EXPIRES_AT,
    simulatedBy: actor("sales"),
    boundary: BOUNDARY,
    receiptDigest: DIGEST,
    ...overrides
  };
}

function simulationProjection(overrides = {}) {
  return {
    schemaVersion: "commercial-change-impact-v1",
    advisory: true,
    receiptId: SIMULATION_RECEIPT_ID,
    receiptDigest: DIGEST,
    authorizationRequired: true,
    expiresAtISO: EXPIRES_AT,
    identity: {
      organizationId: SCOPE.organizationId,
      quoteId: SCOPE.quoteId,
      beforeRevisionId: BASE_REVISION_ID,
      proposedRevisionId: "preview-v0015"
    },
    sources: {
      before: {
        label: "canonical_quote_revision",
        authority: "server_authoritative"
      },
      proposedAfter: {
        label: "authoritative_proposed_revision",
        authority: "server_authoritative"
      }
    },
    graph: graph(),
    factDiffs: factDiffs(),
    commercialValues: commercialValues(),
    impact: projectedImpact(),
    bounds: {
      declaredFactCount: 13,
      changedFactLimit: 32,
      dependentNodeLimit: 64,
      outputByteLimit: 262144
    },
    boundary: "Read-only advisory simulation.",
    ...overrides
  };
}

function persistedEffects(overrides = {}) {
  return {
    schemaVersion: "commercial-change-persisted-effects-v1",
    authority: "server_authoritative",
    source: "trusted_quote_edit_material_projection",
    identity: {
      organizationId: SCOPE.organizationId,
      quoteId: SCOPE.quoteId,
      baseRevisionId: BASE_REVISION_ID,
      projectedRevisionId: TARGET_REVISION_ID
    },
    requestedDelta: [{
      nodeId: "fact.event.guest_count",
      fieldPath: "fact.event.guest_count",
      before: 125,
      after: 175
    }],
    pricing: commercialValues(),
    staffing: {
      before: { servers: 8, chefs: 3, bartenders: 2 },
      after: { servers: 8, chefs: 3, bartenders: 2 },
      changed: false
    },
    status: { before: "draft", after: "draft", changed: false },
    version: {
      beforeRevisionId: BASE_REVISION_ID,
      afterRevisionId: TARGET_REVISION_ID,
      beforeVersionNumber: 14,
      afterVersionNumber: 15,
      createsImmutableVersion: true
    },
    proposal: {
      statusBefore: "draft",
      statusAfter: "draft",
      workflowEvidencePreserved: true,
      customerDeliveryTriggered: false,
      publicationTriggered: false
    },
    portal: {
      activeRevisionIdBefore: BASE_REVISION_ID,
      activeRevisionIdAfter: TARGET_REVISION_ID,
      projectionRefreshed: true,
      accessIdentityRetained: true,
      issuanceRecordedAtSave: true,
      expiryRecalculatedAtSave: true,
      customerDeliveryTriggered: false
    },
    lifecycle: {
      draftAtPreserved: true,
      draftAtAssignedIfMissing: false,
      editedAtRecordedAtSave: true,
      terminalDecisionEvidencePreserved: true
    },
    dependencies: {
      authorizationRequired: true,
      impact: receiptImpact()
    },
    boundary: "Exact trusted quote edit plan; no write or delivery occurred.",
    ...overrides
  };
}

function inventoryPreview(overrides = {}) {
  const eventRequirementRevisionId = `eir_${"a".repeat(48)}`;
  const coreProjection = {
    authorityVersion: "inventory-ingredient-authority-v2",
    schemaVersion: 1,
    projectionVersion: "ingredient-event-projection-v1",
    organizationId: SCOPE.organizationId,
    quoteId: SCOPE.quoteId,
    quoteRevisionId: TARGET_REVISION_ID,
    eventRequirementRevisionId,
    requirementDigest: DIGEST,
    requiredByISO: "2026-09-01T17:00:00.000Z",
    demandState: "complete",
    costState: "complete",
    availabilityState: "available",
    selections: [],
    ingredients: [],
    coverage: {
      selectedMenuItemCount: 0,
      compiledMenuItemCount: 0,
      ingredientCount: 0,
      costedIngredientCount: 0,
      knownCostIngredientCount: 0,
      stockKnownIngredientCount: 0,
      availableIngredientCount: 0,
      shortageIngredientCount: 0
    },
    sourceRevisions: {
      recipeRevisionIds: [],
      recipeCostResultDigests: [],
      stockRevisions: [],
      allocationRevisions: []
    },
    issues: [],
    projectionDigest: DIGEST
  };
  const requirementRevision = {
    authorityVersion: coreProjection.authorityVersion,
    schemaVersion: 1,
    requirementVersion: "ingredient-event-requirement-v1",
    organizationId: SCOPE.organizationId,
    quoteId: SCOPE.quoteId,
    quoteRevisionId: TARGET_REVISION_ID,
    requiredByISO: coreProjection.requiredByISO,
    demandState: coreProjection.demandState,
    costState: coreProjection.costState,
    selections: [],
    ingredients: [],
    coverage: {
      selectedMenuItemCount: 0,
      compiledMenuItemCount: 0,
      ingredientCount: 0,
      costedIngredientCount: 0,
      knownCostIngredientCount: 0
    },
    issues: [],
    eventRequirementRevisionId,
    requirementDigest: DIGEST
  };
  return {
    ok: true,
    schemaVersion: 2,
    organizationId: SCOPE.organizationId,
    quoteId: SCOPE.quoteId,
    quoteRevisionId: TARGET_REVISION_ID,
    preview: true,
    requirementRevision,
    ingredientLabels: [],
    projection: coreProjection,
    ...overrides
  };
}

function inventoryObservation(state = "not_requested", overrides = {}) {
  const common = {
    schemaVersion: "commercial-change-inventory-observation-v1",
    authority: "inventory_read_only_observation",
    state,
    organizationId: SCOPE.organizationId,
    quoteId: SCOPE.quoteId,
    baseQuoteRevisionId: BASE_REVISION_ID,
    proposedQuoteRevisionId: TARGET_REVISION_ID,
    commercialSimulationReceiptId: SIMULATION_RECEIPT_ID,
    commercialSimulationReceiptDigest: DIGEST,
    commercialPreviewRevisionId: "preview-v0015",
    observedAtISO: SIMULATED_AT,
    boundary: "Read-only Inventory observation; no requirement, allocation, movement, or order was written."
  };
  return state === "available"
    ? { ...common, inputDigest: DIGEST, preview: inventoryPreview(), ...overrides }
    : { ...common, reasonCode: state === "not_requested" ? "explicit_outputs_not_provided" : "inventory_unavailable", ...overrides };
}

function staffingObservation(state = "available", overrides = {}) {
  const requirementsByRole = { lead: 0, server: 2, chef: 1, bartender: 1 };
  const byRole = Object.fromEntries(Object.entries(requirementsByRole).map(([role, requiredCount]) => [
    role,
    {
      requiredCount,
      operatorConfirmedCount: requiredCount,
      gap: 0
    }
  ]));
  const common = {
    schemaVersion: "commercial-change-staffing-observation-v1",
    authority: "operational_staffing_read_only_observation",
    state,
    organizationId: SCOPE.organizationId,
    quoteId: SCOPE.quoteId,
    baseQuoteRevisionId: BASE_REVISION_ID,
    proposedQuoteRevisionId: TARGET_REVISION_ID,
    commercialSimulationReceiptId: SIMULATION_RECEIPT_ID,
    commercialSimulationReceiptDigest: DIGEST,
    commercialPreviewRevisionId: "preview-v0015",
    observedAtISO: SIMULATED_AT,
    boundary: "Read-only aggregate Staffing observation; no assignment was written or disclosed."
  };
  return state === "available"
    ? {
      ...common,
      inputDigest: DIGEST,
      preview: {
        proposed: {
          quoteRevisionId: TARGET_REVISION_ID,
          eventWindow: {
            startAtISO: "2026-08-18T22:00:00.000Z",
            endAtISO: "2026-08-19T04:00:00.000Z"
          },
          requirementsByRole,
          totalRequired: 4
        },
        currentPlanState: "current",
        comparison: {
          windowState: "same",
          coverage: {
            state: "coverage_confirmed",
            byRole,
            totalRequired: 4,
            totalOperatorConfirmedCount: 4,
            totalGap: 0,
            reasonCode: "current_assignments_compared_with_proposed_requirements"
          }
        },
        boundary: "Aggregate Staffing comparison only."
      },
      ...overrides
    }
    : { ...common, reasonCode: "operational_staffing_authority_disabled", ...overrides };
}

function simulationResponse(overrides = {}) {
  return {
    ok: true,
    storage: "firebase",
    ...SCOPE,
    idempotent: false,
    authorityState: "dormant",
    simulationReceipt: simulationReceipt(),
    simulation: simulationProjection(),
    inventoryObservation: inventoryObservation(),
    staffingObservation: staffingObservation(),
    persistedEffects: persistedEffects(),
    ...overrides
  };
}

function approval(state = "pending", overrides = {}) {
  const authorized = state === "authorized";
  return {
    schemaVersion: 1,
    authority: "server_projection",
    approvalRequestId: APPROVAL_ID,
    simulationReceiptId: SIMULATION_RECEIPT_ID,
    state,
    requestedAtISO: "2026-08-09T12:01:00.000Z",
    requestedBy: { email: "sales@example.test", role: "sales" },
    resolvedAtISO: authorized ? "2026-08-09T12:02:00.000Z" : "",
    resolvedBy: authorized
      ? { email: "admin@example.test", role: "admin" }
      : { email: "", role: "" },
    authorizationReceiptId: authorized ? AUTHORIZATION_RECEIPT_ID : "",
    expiresAtISO: EXPIRES_AT,
    ...overrides
  };
}

function authorizationReceipt(overrides = {}) {
  return {
    schemaVersion: "commercial-change-authorization-receipt-v1",
    authority: "server_authoritative",
    receiptType: "authorization",
    receiptId: AUTHORIZATION_RECEIPT_ID,
    requestId: AUTHORIZATION_REQUEST_ID,
    organizationId: SCOPE.organizationId,
    quoteId: SCOPE.quoteId,
    simulationReceiptId: SIMULATION_RECEIPT_ID,
    simulationDigest: DIGEST,
    baseRevisionId: BASE_REVISION_ID,
    proposedRevisionId: "preview-v0015",
    proposalDigest: DIGEST,
    catalogAuthorityDigest: DIGEST,
    policyVersion: "commercial-change-policy-v1",
    state: "authorized",
    authorizedAtISO: "2026-08-09T12:02:00.000Z",
    expiresAtISO: EXPIRES_AT,
    authorizedBy: actor("admin"),
    authorizedFor: actor("sales"),
    boundary: BOUNDARY,
    receiptDigest: DIGEST,
    ...overrides
  };
}

function invalidation(state = "open", overrides = {}) {
  const resolved = state === "resolved";
  return {
    invalidationId: INVALIDATION_ID,
    operationId: OPERATION_ID,
    applyReceiptId: APPLY_RECEIPT_ID,
    sourceRevisionId: BASE_REVISION_ID,
    targetRevisionId: TARGET_REVISION_ID,
    nodeId: "artifact.kitchen_beo",
    nodeKind: "artifact",
    classification: "STALE",
    triggeredBy: ["fact.event.guest_count"],
    decisionId: "",
    decisionType: "beo_finalization",
    state,
    createdAtISO: "2026-08-09T12:03:00.000Z",
    resolvedAtISO: resolved ? "2026-08-09T12:04:00.000Z" : "",
    resolution: resolved ? "artifact_current" : "",
    resolutionReceiptId: resolved ? RECONCILIATION_RECEIPT_ID : "",
    evidenceId: resolved ? `beo_${"9".repeat(48)}` : "",
    ...overrides
  };
}

function dependencyState(state = "BLOCKED", overrides = {}) {
  const ready = state === "READY";
  const invalidations = [invalidation(ready ? "resolved" : "open")];
  return {
    schemaVersion: 1,
    authority: "server_projection",
    source: "firebase_server_projection",
    organizationId: SCOPE.organizationId,
    quoteId: SCOPE.quoteId,
    customerId: "customer-one",
    eventDate: "2026-09-01",
    activeRevisionId: TARGET_REVISION_ID,
    observedAtISO: "2026-08-09T12:05:00.000Z",
    bounds: {
      invalidationLimit: 64,
      invalidationSetComplete: true,
      returnedCount: 1,
      truncated: false
    },
    state,
    safeToPublish: ready,
    latestApplyReceiptId: APPLY_RECEIPT_ID,
    totalInvalidationCount: 1,
    openInvalidationCount: ready ? 0 : 1,
    resolvedInvalidationCount: ready ? 1 : 0,
    invalidations,
    reasonCodes: [ready
      ? "all_named_dependencies_reconciled"
      : "governed_dependencies_unresolved"],
    ...overrides
  };
}

function reconciliationReceipt(overrides = {}) {
  return {
    schemaVersion: "commercial-change-reconciliation-receipt-v1",
    authority: "server_authoritative",
    receiptType: "reconciliation",
    receiptId: RECONCILIATION_RECEIPT_ID,
    requestId: RECONCILIATION_REQUEST_ID,
    organizationId: SCOPE.organizationId,
    quoteId: SCOPE.quoteId,
    applyReceiptId: APPLY_RECEIPT_ID,
    applyReceiptDigest: DIGEST,
    activeRevisionId: TARGET_REVISION_ID,
    resolutions: [{
      invalidationId: INVALIDATION_ID,
      invalidationReceiptId: INVALIDATION_ID,
      nodeId: "artifact.kitchen_beo",
      evidenceId: `beo_${"9".repeat(48)}`,
      evidenceDigest: DIGEST,
      resolution: "artifact_current"
    }],
    reconciledAtISO: "2026-08-09T12:04:00.000Z",
    reconciledBy: actor("sales"),
    boundary: BOUNDARY,
    receiptDigest: DIGEST,
    ...overrides
  };
}

function applyOutcomeReceipt(state = "committed", overrides = {}) {
  const committed = state === "committed";
  return {
    schemaVersion: "commercial-change-apply-outcome-receipt-v1",
    authority: "server_authoritative",
    receiptType: "outcome",
    receiptId: OUTCOME_RECEIPT_ID,
    outcomeReceiptId: OUTCOME_RECEIPT_ID,
    requestId: APPLY_REQUEST_ID,
    operationId: OPERATION_ID,
    organizationId: SCOPE.organizationId,
    quoteId: SCOPE.quoteId,
    simulationReceiptId: SIMULATION_RECEIPT_ID,
    simulationDigest: DIGEST,
    authorizationReceiptId: AUTHORIZATION_RECEIPT_ID,
    authorizationReceiptDigest: DIGEST,
    baseRevisionId: BASE_REVISION_ID,
    expectedApplyReceiptId: APPLY_RECEIPT_ID,
    state,
    activeRevisionId: committed ? TARGET_REVISION_ID : BASE_REVISION_ID,
    sourceChanged: committed,
    applyReceiptId: committed ? APPLY_RECEIPT_ID : "",
    applyReceiptDigest: committed ? DIGEST : "",
    newRevisionId: committed ? TARGET_REVISION_ID : "",
    appliedRevisionIsActive: committed,
    reconciledAtISO: "2026-08-09T12:05:00.000Z",
    reconciledBy: actor("sales"),
    boundary: BOUNDARY,
    receiptDigest: DIGEST,
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.httpsCallable.mockReturnValue(mockState.callable);
});

describe("Commercial Change Authority request identities", () => {
  test.each([
    ["simulation", /^change_sim_[a-f0-9]{32}$/u],
    ["approval", /^change_auth_request_[a-f0-9]{32}$/u],
    ["authorization", /^change_auth_[a-f0-9]{32}$/u],
    ["apply", /^change_apply_[a-f0-9]{32}$/u],
    ["reconciliation", /^change_reconcile_[a-f0-9]{32}$/u]
  ])("builds an exact %s request identity", (kind, pattern) => {
    expect(buildCommercialChangeRequestId(kind)).toMatch(pattern);
  });

  test("rejects an undeclared request kind", () => {
    expect(() => buildCommercialChangeRequestId("publish")).toThrow(/kind is invalid/i);
  });
});

describe("Commercial Change Authority simulation client", () => {
  test("sends only exact quote scope, revision, request, and form then validates both receipts", async () => {
    mockState.callable.mockResolvedValue({ data: simulationResponse() });
    const form = {
      eventName: "Annual picnic",
      guests: 175,
      customer: { email: "customer@example.test" }
    };

    const result = await simulateCommercialQuoteChange({
      ...SCOPE,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form,
      portalToken: "must-not-cross",
      browserProjection: { safeToPublish: true }
    });

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      COMMERCIAL_CHANGE_AUTHORITY_CALLABLES.simulate
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      ...SCOPE,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form,
      staffingObservationVersion: "v1"
    });
    expect(result).toMatchObject({
      ...SCOPE,
      authorityState: "dormant",
      simulationReceipt: {
        receiptId: SIMULATION_RECEIPT_ID,
        requestId: SIMULATION_REQUEST_ID,
        authorizationRequired: true
      },
      simulation: {
        receiptId: SIMULATION_RECEIPT_ID,
        impact: { counts: { total: 1, stale: 1 } }
      },
      inventoryObservation: {
        state: "not_requested",
        baseQuoteRevisionId: BASE_REVISION_ID,
        proposedQuoteRevisionId: TARGET_REVISION_ID,
        reasonCode: "explicit_outputs_not_provided"
      },
      staffingObservation: {
        state: "available",
        proposedQuoteRevisionId: TARGET_REVISION_ID,
        preview: {
          currentPlanState: "current",
          comparison: {
            windowState: "same",
            coverage: { totalGap: 0 }
          }
        }
      },
      persistedEffects: {
        identity: {
          baseRevisionId: BASE_REVISION_ID,
          projectedRevisionId: TARGET_REVISION_ID
        },
        version: {
          beforeVersionNumber: 14,
          afterVersionNumber: 15,
          createsImmutableVersion: true
        },
        portal: {
          projectionRefreshed: true,
          customerDeliveryTriggered: false
        }
      }
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.simulation.impact.dependentNodes)).toBe(true);
  });

  test("sends only exact output quantities and validates a separately bound Inventory observation", async () => {
    mockState.callable.mockResolvedValue({
      data: simulationResponse({ inventoryObservation: inventoryObservation("available") })
    });
    const eventIngredientOutputs = [
      { menuItemId: "chicken-pasta", requiredOutputQuantity: "175" },
      { menuItemId: "vegetable-pasta", requiredOutputQuantity: "25.5" }
    ];

    const result = await simulateCommercialQuoteChange({
      ...SCOPE,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form: { guests: 200 },
      eventIngredientOutputs,
      localScenarioFingerprint: "must-not-cross"
    });

    expect(mockState.callable).toHaveBeenCalledWith({
      ...SCOPE,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form: { guests: 200 },
      staffingObservationVersion: "v1",
      eventIngredientOutputs
    });
    expect(result.inventoryObservation).toMatchObject({
      authority: "inventory_read_only_observation",
      state: "available",
      baseQuoteRevisionId: BASE_REVISION_ID,
      proposedQuoteRevisionId: TARGET_REVISION_ID,
      commercialSimulationReceiptId: SIMULATION_RECEIPT_ID,
      commercialSimulationReceiptDigest: DIGEST,
      commercialPreviewRevisionId: "preview-v0015",
      inputDigest: DIGEST,
      preview: {
        quoteRevisionId: TARGET_REVISION_ID,
        projection: { quoteRevisionId: TARGET_REVISION_ID, freshness: "preview" }
      }
    });
    expect(Object.isFrozen(result.inventoryObservation.preview.projection)).toBe(true);
  });

  test("rejects malformed output rows before Firebase and cross-bound Inventory evidence after it", async () => {
    await expect(simulateCommercialQuoteChange({
      ...SCOPE,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form: { guests: 175 },
      eventIngredientOutputs: [{
        menuItemId: "chicken-pasta",
        requiredOutputQuantity: "0175",
        guestCount: 175
      }]
    })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mockState.callable).not.toHaveBeenCalled();

    const validInput = {
      ...SCOPE,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form: { guests: 175 },
      eventIngredientOutputs: [{ menuItemId: "chicken-pasta", requiredOutputQuantity: "175" }]
    };
    const divergentBindings = [
      { organizationId: "org-other" },
      { quoteId: "quote-other" },
      { baseQuoteRevisionId: "v0001" },
      { proposedQuoteRevisionId: "v0099" },
      { commercialSimulationReceiptId: `ccs_${"2".repeat(48)}` },
      { commercialSimulationReceiptDigest: "9".repeat(64) },
      { commercialPreviewRevisionId: "preview-v0099" },
      { preview: inventoryPreview({ quoteRevisionId: "v0099" }) }
    ];
    for (const divergence of divergentBindings) {
      mockState.callable.mockResolvedValue({
        data: simulationResponse({
          inventoryObservation: inventoryObservation("available", divergence)
        })
      });
      await expect(simulateCommercialQuoteChange(validInput))
        .rejects.toMatchObject({ code: "invalid-server-response" });
    }
  });

  test("preserves an explicit unavailable Inventory observation without treating it as commercial idempotency", async () => {
    mockState.callable.mockResolvedValue({
      data: simulationResponse({
        idempotent: true,
        inventoryObservation: inventoryObservation("unavailable", {
          reasonCode: "inventory_preview_failed"
        })
      })
    });

    const result = await simulateCommercialQuoteChange({
      ...SCOPE,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form: { guests: 175 },
      eventIngredientOutputs: [{ menuItemId: "chicken-pasta", requiredOutputQuantity: "175" }]
    });

    expect(result).toMatchObject({
      idempotent: true,
      inventoryObservation: {
        state: "unavailable",
        reasonCode: "inventory_preview_failed"
      }
    });
    expect(result.inventoryObservation).not.toHaveProperty("idempotent");
  });

  test("validates the separately bound aggregate Staffing observation and preserves explicit unavailability", async () => {
    mockState.callable.mockResolvedValue({ data: simulationResponse() });
    const input = {
      ...SCOPE,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form: { guests: 175 }
    };
    const result = await simulateCommercialQuoteChange(input);
    expect(result.staffingObservation).toMatchObject({
      authority: "operational_staffing_read_only_observation",
      state: "available",
      proposedQuoteRevisionId: TARGET_REVISION_ID,
      commercialSimulationReceiptId: SIMULATION_RECEIPT_ID,
      preview: {
        proposed: {
          quoteRevisionId: TARGET_REVISION_ID,
          requirementsByRole: { lead: 0, server: 2, chef: 1, bartender: 1 }
        },
        comparison: {
          windowState: "same",
          coverage: { state: "coverage_confirmed", totalGap: 0 }
        }
      }
    });
    expect(JSON.stringify(result.staffingObservation)).not.toContain("displayName");
    expect(JSON.stringify(result.staffingObservation)).not.toContain("staffId");

    mockState.callable.mockResolvedValue({
      data: simulationResponse({ staffingObservation: staffingObservation("unavailable") })
    });
    const unavailable = await simulateCommercialQuoteChange(input);
    expect(unavailable.staffingObservation).toMatchObject({
      state: "unavailable",
      reasonCode: "operational_staffing_authority_disabled"
    });
  });

  test.each([
    { organizationId: "org-other" },
    { quoteId: "quote-other" },
    { baseQuoteRevisionId: "v0001" },
    { proposedQuoteRevisionId: "v0099" },
    { commercialSimulationReceiptId: `ccs_${"2".repeat(48)}` },
    { commercialSimulationReceiptDigest: "9".repeat(64) },
    { commercialPreviewRevisionId: "preview-v0099" },
    { preview: { ...staffingObservation().preview, currentPlanState: "unknown" } }
  ])("rejects cross-bound or malformed Staffing observation %#", async (divergence) => {
    mockState.callable.mockResolvedValue({
      data: simulationResponse({
        staffingObservation: staffingObservation("available", divergence)
      })
    });
    await expect(simulateCommercialQuoteChange({
      ...SCOPE,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form: { guests: 175 }
    })).rejects.toMatchObject({ code: "invalid-server-response" });
  });

  test("rejects a cross-scope or receipt-divergent server projection as uncertain", async () => {
    mockState.callable.mockResolvedValueOnce({
      data: simulationResponse({ organizationId: "org-other" })
    });
    const input = {
      ...SCOPE,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form: { guests: 175 }
    };
    let error;
    try {
      await simulateCommercialQuoteChange(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "invalid-server-response" });
    expect(isDefinitiveCommercialChangeError(error)).toBe(false);

    mockState.callable.mockResolvedValueOnce({
      data: simulationResponse({
        simulation: simulationProjection({
          impact: projectedImpact(),
          commercialValues: {
            ...commercialValues(),
            authoritativeTotal: {
              ...commercialValues().authoritativeTotal,
              proposedAfter: 17000
            }
          }
        })
      })
    });
    await expect(simulateCommercialQuoteChange(input)).rejects.toThrow(/change flag|receipt/i);

    mockState.callable.mockResolvedValueOnce({
      data: simulationResponse({
        persistedEffects: persistedEffects({
          version: {
            ...persistedEffects().version,
            afterVersionNumber: 16
          }
        })
      })
    });
    await expect(simulateCommercialQuoteChange(input)).rejects.toThrow(/version effect/i);
  });

  test("rejects path, email, and content-bearing URL identities before calling Firebase", async () => {
    await expect(simulateCommercialQuoteChange({
      organizationId: "owner@example.test",
      quoteId: "quote-one",
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form: {}
    })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(simulateCommercialQuoteChange({
      organizationId: "org-one",
      quoteId: "quote/one?customer=secret",
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: SIMULATION_REQUEST_ID,
      form: {}
    })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mockState.callable).not.toHaveBeenCalled();
  });
});

describe("Commercial Change Authority approval client", () => {
  test("requests approval with the exact simulation and validates pending state", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        idempotent: false,
        approval: approval("pending")
      }
    });
    await expect(requestCommercialQuoteChangeAuthorization({
      ...SCOPE,
      simulationReceiptId: SIMULATION_RECEIPT_ID,
      requestId: APPROVAL_REQUEST_ID,
      proposedForm: { must: "not cross" }
    })).resolves.toMatchObject({
      approval: { state: "pending", simulationReceiptId: SIMULATION_RECEIPT_ID }
    });
    expect(mockState.callable).toHaveBeenCalledWith({
      ...SCOPE,
      simulationReceiptId: SIMULATION_RECEIPT_ID,
      requestId: APPROVAL_REQUEST_ID
    });
  });

  test("reads a null approval without adding navigation or content fields", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        approval: null
      }
    });
    await expect(getCommercialQuoteChangeAuthorizationState({
      ...SCOPE,
      simulationReceiptId: SIMULATION_RECEIPT_ID,
      customerEmail: "must-not-cross@example.test"
    })).resolves.toEqual({
      ok: true,
      storage: "firebase",
      ...SCOPE,
      approval: null
    });
    expect(mockState.callable).toHaveBeenCalledWith({
      ...SCOPE,
      simulationReceiptId: SIMULATION_RECEIPT_ID
    });
  });

  test("authorizes only the exact simulation and binds an optional approval projection", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        idempotent: false,
        authorizationReceipt: authorizationReceipt(),
        approval: approval("authorized")
      }
    });
    await expect(authorizeCommercialQuoteChange({
      ...SCOPE,
      simulationReceiptId: SIMULATION_RECEIPT_ID,
      requestId: AUTHORIZATION_REQUEST_ID
    })).resolves.toMatchObject({
      authorizationReceipt: {
        receiptId: AUTHORIZATION_RECEIPT_ID,
        authorizedBy: { role: "admin" }
      },
      approval: { state: "authorized" }
    });
    expect(mockState.callable).toHaveBeenCalledWith({
      ...SCOPE,
      simulationReceiptId: SIMULATION_RECEIPT_ID,
      requestId: AUTHORIZATION_REQUEST_ID
    });
  });
});

describe("Commercial Change Authority apply outcome client", () => {
  const input = {
    ...SCOPE,
    simulationReceiptId: SIMULATION_RECEIPT_ID,
    authorizationReceiptId: AUTHORIZATION_RECEIPT_ID,
    applyRequestId: APPLY_REQUEST_ID,
    expectedBaseRevisionId: BASE_REVISION_ID
  };

  test("reconciles the exact request as committed and validates its apply projection", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        idempotent: false,
        outcomeReceipt: applyOutcomeReceipt(),
        commercialChange: {
          authorityState: "enforced",
          applyReceiptId: APPLY_RECEIPT_ID,
          state: "BLOCKED",
          safeToPublish: false,
          openInvalidationCount: 1,
          totalInvalidationCount: 1
        }
      }
    });

    await expect(reconcileCommercialQuoteChangeApplyOutcome({
      ...input,
      form: { must: "not cross" }
    })).resolves.toMatchObject({
      outcomeReceipt: {
        receiptId: OUTCOME_RECEIPT_ID,
        state: "committed",
        applyReceiptId: APPLY_RECEIPT_ID,
        newRevisionId: TARGET_REVISION_ID
      },
      commercialChange: {
        state: "BLOCKED",
        applyReceiptId: APPLY_RECEIPT_ID
      }
    });
    expect(mockState.callable).toHaveBeenCalledWith(input);
  });

  test("accepts a fenced not-committed receipt only without apply evidence", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        idempotent: true,
        outcomeReceipt: applyOutcomeReceipt("not_committed"),
        commercialChange: null
      }
    });

    await expect(reconcileCommercialQuoteChangeApplyOutcome(input)).resolves.toMatchObject({
      idempotent: true,
      outcomeReceipt: {
        state: "not_committed",
        sourceChanged: false,
        applyReceiptId: ""
      },
      commercialChange: null
    });
  });

  test("rejects mismatched outcome evidence and malformed identities", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        idempotent: false,
        outcomeReceipt: applyOutcomeReceipt("not_committed", {
          applyReceiptId: APPLY_RECEIPT_ID,
          applyReceiptDigest: DIGEST
        }),
        commercialChange: null
      }
    });
    await expect(reconcileCommercialQuoteChangeApplyOutcome(input))
      .rejects.toThrow(/not-committed|claims apply evidence/i);

    await expect(reconcileCommercialQuoteChangeApplyOutcome({
      ...input,
      applyRequestId: "customer@example.test"
    })).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

describe("Commercial dependency state client", () => {
  test("reads a complete exact quote-scoped blocked state", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        dependencyState: dependencyState("BLOCKED")
      }
    });
    const result = await getCommercialDependencyState({
      ...SCOPE,
      query: "?customer=must-not-cross"
    });
    expect(result).toMatchObject({
      ...SCOPE,
      state: "BLOCKED",
      safeToPublish: false,
      openInvalidationCount: 1,
      invalidations: [{ invalidationId: INVALIDATION_ID, state: "open" }]
    });
    expect(mockState.callable).toHaveBeenCalledWith(SCOPE);
  });

  test("treats no governed apply receipt as not generated, never publication authority", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        dependencyState: dependencyState("NOT_GENERATED", {
          safeToPublish: false,
          latestApplyReceiptId: "",
          totalInvalidationCount: 0,
          openInvalidationCount: 0,
          resolvedInvalidationCount: 0,
          invalidations: [],
          bounds: {
            invalidationLimit: 64,
            invalidationSetComplete: true,
            returnedCount: 0,
            truncated: false
          },
          reasonCodes: ["no_governed_change_applied"]
        })
      }
    });

    await expect(getCommercialDependencyState(SCOPE)).resolves.toMatchObject({
      state: "NOT_GENERATED",
      safeToPublish: false,
      totalInvalidationCount: 0,
      invalidations: []
    });
  });

  test("fails closed for count drift or a wrong-tenant dependency projection", async () => {
    mockState.callable.mockResolvedValueOnce({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        dependencyState: dependencyState("BLOCKED", { openInvalidationCount: 0 })
      }
    });
    await expect(getCommercialDependencyState(SCOPE)).rejects.toThrow(/counts|gate/i);

    mockState.callable.mockResolvedValueOnce({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        dependencyState: dependencyState("BLOCKED", { organizationId: "org-other" })
      }
    });
    await expect(getCommercialDependencyState(SCOPE)).rejects.toThrow(/scope/i);
  });
});

describe("Commercial dependency reconciliation client", () => {
  test("sends only the exact named invalidations and accepts matching receipt and ready state", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        idempotent: false,
        reconciliationReceipt: reconciliationReceipt(),
        dependencyState: dependencyState("READY")
      }
    });
    const input = {
      ...SCOPE,
      applyReceiptId: APPLY_RECEIPT_ID,
      requestId: RECONCILIATION_REQUEST_ID,
      invalidationIds: [INVALIDATION_ID],
      resolutionNote: "Kitchen BEO regenerated and reviewed.",
      evidence: { browserAuthored: true }
    };
    await expect(reconcileCommercialDependencyState(input)).resolves.toMatchObject({
      reconciliationReceipt: {
        receiptId: RECONCILIATION_RECEIPT_ID,
        requestId: RECONCILIATION_REQUEST_ID,
        resolutions: [{ invalidationId: INVALIDATION_ID }]
      },
      dependencyState: { state: "READY", safeToPublish: true }
    });
    expect(mockState.callable).toHaveBeenCalledWith({
      ...SCOPE,
      applyReceiptId: APPLY_RECEIPT_ID,
      requestId: RECONCILIATION_REQUEST_ID,
      invalidationIds: [INVALIDATION_ID],
      resolutionNote: "Kitchen BEO regenerated and reviewed."
    });
  });

  test("rejects malformed or duplicate invalidation identities before any mutation", async () => {
    await expect(reconcileCommercialDependencyState({
      ...SCOPE,
      applyReceiptId: "quote-one",
      requestId: RECONCILIATION_REQUEST_ID,
      invalidationIds: [INVALIDATION_ID]
    })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(reconcileCommercialDependencyState({
      ...SCOPE,
      applyReceiptId: APPLY_RECEIPT_ID,
      requestId: RECONCILIATION_REQUEST_ID,
      invalidationIds: ["customer@example.test"]
    })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(reconcileCommercialDependencyState({
      ...SCOPE,
      applyReceiptId: APPLY_RECEIPT_ID,
      requestId: RECONCILIATION_REQUEST_ID,
      invalidationIds: [INVALIDATION_ID, INVALIDATION_ID]
    })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mockState.callable).not.toHaveBeenCalled();
  });

  test("rejects a reconciliation receipt that resolves a different invalidation", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        ...SCOPE,
        idempotent: false,
        reconciliationReceipt: reconciliationReceipt({
          resolutions: [{
            ...reconciliationReceipt().resolutions[0],
            invalidationId: `cci_${"a".repeat(48)}`,
            invalidationReceiptId: `cci_${"a".repeat(48)}`
          }]
        }),
        dependencyState: dependencyState("READY")
      }
    });
    await expect(reconcileCommercialDependencyState({
      ...SCOPE,
      applyReceiptId: APPLY_RECEIPT_ID,
      requestId: RECONCILIATION_REQUEST_ID,
      invalidationIds: [INVALIDATION_ID]
    })).rejects.toThrow(/different invalidation set/i);
  });
});

describe("Commercial Change Authority uncertainty and browser boundary", () => {
  test.each([
    ["functions/aborted", true],
    ["functions/already-exists", true],
    ["functions/failed-precondition", true],
    ["functions/invalid-argument", true],
    ["functions/permission-denied", true],
    ["functions/unavailable", false],
    ["functions/deadline-exceeded", false],
    ["invalid-server-response", false]
  ])("classifies %s without inventing a mutation outcome", (code, expected) => {
    expect(isDefinitiveCommercialChangeError({ code })).toBe(expected);
  });

  test("contains no browser persistence or URL construction path for quote contents", () => {
    const source = readFileSync(
      new URL("../commercialChangeAuthorityClient.js", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/localStorage|sessionStorage|URLSearchParams|pushState|replaceState/u);
  });
});

function boundEvidence(overrides = {}) {
  return {
    workflowPolicy: {
      organizationId: SCOPE.organizationId,
      definitionPin: { workflowKind: "quote_review", schemaVersion: 2, definitionId: "quote_review", versionId: "quote_review_v1", version: 1, definitionDigest: DIGEST },
      approvalPolicy: { basis: "absolute_total_delta_cents", thresholdCents: 0, allowedRoles: ["admin", "sales"] },
      declaredBy: "admin-one", declaredAtISO: "2026-08-01T00:00:00.000Z"
    },
    attendanceBinding: { ...SCOPE, sourceVersionId: BASE_REVISION_ID, acceptanceReceiptId: "acceptance-one", submissionReceiptId: "attendance-one", submissionReceiptDigest: DIGEST, count: 175 },
    approvalEvaluation: { currency: "USD", beforeTotalCents: 1248000, proposedTotalCents: 1692000, absoluteTotalDeltaCents: 444000, impactApprovalRequired: true, thresholdApprovalRequired: true },
    ...overrides
  };
}
describe("bound commercial review receipts", () => {
  const input = { ...SCOPE, expectedActiveVersionId: BASE_REVISION_ID, requestId: SIMULATION_REQUEST_ID, attendanceSubmissionReceiptId: "attendance-one", form: { guests: 175 } };
  test("preserves the exact published threshold and attendance binding in the review projection", async () => {
    mockState.callable.mockResolvedValue({ data: simulationResponse({ simulationReceipt: simulationReceipt({ schemaVersion: "commercial-change-simulation-receipt-v2", ...boundEvidence() }) }) });
    const result = await simulateCommercialQuoteChange(input);
    expect(result.simulation.workflowPolicy.approvalPolicy.thresholdCents).toBe(0);
    expect(result.simulation.attendanceBinding).toEqual(boundEvidence().attendanceBinding);
    expect(result.simulation.approvalEvaluation.thresholdApprovalRequired).toBe(true);
  });
  test("rejects contradictory policy, count, source, and evaluation instead of granting approval", async () => {
    const changes = [
      seal => { seal.attendanceBinding.sourceVersionId = "other-version"; },
      seal => { seal.attendanceBinding.count = 0; },
      seal => { seal.approvalEvaluation.thresholdApprovalRequired = false; },
      seal => { seal.approvalEvaluation.impactApprovalRequired = false; },
      seal => { seal.approvalEvaluation.beforeTotalCents = 1248001; seal.approvalEvaluation.absoluteTotalDeltaCents = 443999; },
      seal => { seal.workflowPolicy.approvalPolicy.allowedRoles = ["admin"]; },
      seal => { seal.workflowPolicy.definitionPin.versionId = "quote_review_v2"; },
      seal => { seal.workflowPolicy.declaredAtISO = "2099-01-01T00:00:00.000Z"; },
      seal => { seal.attendanceBinding.untrusted = true; }
    ];
    for (const mutate of changes) {
      const seal = boundEvidence(); mutate(seal);
      mockState.callable.mockResolvedValue({ data: simulationResponse({ simulationReceipt: simulationReceipt({ schemaVersion: "commercial-change-simulation-receipt-v2", ...seal }) }) });
      await expect(simulateCommercialQuoteChange(input)).rejects.toMatchObject({ code: "invalid-server-response" });
    }
  });
  test("accepts bound authorization and rejects v1 receipts that assert v2 authority", async () => {
    mockState.callable.mockResolvedValue({ data: { ok: true, storage: "firebase", ...SCOPE, idempotent: false, approval: approval("authorized"), authorizationReceipt: authorizationReceipt({ schemaVersion: "commercial-change-authorization-receipt-v2", ...boundEvidence() }) } });
    const result = await authorizeCommercialQuoteChange({ ...SCOPE, simulationReceiptId: SIMULATION_RECEIPT_ID, requestId: AUTHORIZATION_REQUEST_ID });
    expect(result.authorizationReceipt.workflowPolicy.definitionPin.version).toBe(1);
    mockState.callable.mockResolvedValue({ data: simulationResponse({ simulationReceipt: simulationReceipt(boundEvidence()) }) });
    await expect(simulateCommercialQuoteChange(input)).rejects.toMatchObject({ code: "invalid-server-response" });
  });
});
