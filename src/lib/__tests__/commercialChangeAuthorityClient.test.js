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
  cloudFunctions: mockState.cloudFunctions,
  firebaseReady: true
}));

import {
  COMMERCIAL_CHANGE_AUTHORITY_CALLABLES,
  authorizeCommercialQuoteChange,
  buildCommercialChangeRequestId,
  getCommercialDependencyState,
  getCommercialQuoteChangeAuthorizationState,
  isDefinitiveCommercialChangeError,
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
const RECONCILIATION_REQUEST_ID = `change_reconcile_${"d".repeat(32)}`;
const SIMULATION_RECEIPT_ID = `ccs_${"1".repeat(48)}`;
const AUTHORIZATION_RECEIPT_ID = `cca_${"2".repeat(48)}`;
const APPLY_RECEIPT_ID = `ccp_${"3".repeat(48)}`;
const INVALIDATION_ID = `cci_${"4".repeat(48)}`;
const RECONCILIATION_RECEIPT_ID = `ccr_${"5".repeat(48)}`;
const APPROVAL_ID = `ccar_${"6".repeat(48)}`;
const OPERATION_ID = `cco_${"7".repeat(48)}`;
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

function simulationResponse(overrides = {}) {
  return {
    ok: true,
    storage: "firebase",
    ...SCOPE,
    idempotent: false,
    authorityState: "dormant",
    simulationReceipt: simulationReceipt(),
    simulation: simulationProjection(),
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
      form
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
      }
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.simulation.impact.dependentNodes)).toBe(true);
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
