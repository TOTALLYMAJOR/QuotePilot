import { beforeEach, describe, expect, test, vi } from "vitest";

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
  DECISION_DEBT_CALLABLES,
  configureDecisionDebtPolicy,
  getDecisionDebtSnapshot,
  isDefinitiveDecisionDebtError,
  normalizeDecisionDebtPolicy,
  readPendingDecisionDebtPolicyAttempt,
  reconcileDecisionDebtPolicy,
  resetDefinitiveDecisionDebtPolicyAttempt
} from "../decisionDebtClient";

function policy(overrides = {}) {
  return {
    schemaVersion: 1,
    maxEventHorizonDays: 365,
    decisionTypes: {
      guest_count: {
        label: "Final guest count",
        lockWindowDays: 7,
        dependencyWeight: 5,
        reversibility: "constrained"
      },
      beo_finalization: {
        label: "Kitchen BEO finalization",
        lockWindowDays: 3,
        dependencyWeight: 5,
        reversibility: "irreversible"
      }
    },
    ...overrides
  };
}

function debtItem(overrides = {}) {
  return {
    id: `debt_${"a".repeat(40)}`,
    quoteId: "quote-a",
    customerId: "customer-a",
    sourceRevisionId: "v0014",
    decisionId: "guest-count-final",
    decisionType: "guest_count",
    label: "Final guest count",
    resolutionState: "unresolved",
    eventDate: "2026-08-16",
    eventDaysAway: 7,
    lockDate: "2026-08-09",
    daysUntilLock: 0,
    rootNodeIds: ["fact.event.guest_count"],
    affectedNodeIds: ["artifact.kitchen_beo", "output.authoritative_total"],
    affectedDependencyCount: 2,
    commercialExposureCents: 2500001,
    factors: {
      dependency: {
        value: 5,
        affectedDependencyCount: 2,
        source: "validated_tenant_policy_and_versioned_graph"
      },
      proximity: {
        value: 5,
        bucket: "due_or_overdue",
        lockWindowDays: 7,
        lockDate: "2026-08-09",
        daysUntilLock: 0,
        source: "tenant_local_calendar"
      },
      exposure: {
        value: 5,
        bucket: "over_20000",
        known: true,
        cents: 2500001,
        source: "bounded_authoritative_commercial_delta"
      },
      reversibility: {
        value: 3,
        classification: "constrained",
        source: "validated_tenant_policy"
      }
    },
    rawScore: 375,
    score: 60,
    scoreState: "KNOWN",
    urgency: "high",
    explanation: [
      "2 graph dependencies remain exposed.",
      "The 7-day lock window is due or overdue.",
      "Recorded commercial exposure is 2500001 cents.",
      "Score 60/100 uses decision-debt-score-v1; it is deterministic, not predictive AI."
    ],
    ...overrides
  };
}

function snapshot(items = [debtItem()], overrides = {}) {
  return {
    schemaVersion: "decision-debt-snapshot-v1",
    formulaVersion: "decision-debt-score-v1",
    authority: "server_derived",
    predictive: false,
    observedAtISO: "2026-08-09T18:42:00.000Z",
    tenantTimeZone: "America/Chicago",
    tenantLocalDate: "2026-08-09",
    graph: {
      graphId: "quotepilot-commercial",
      graphVersion: "commercial-dependency-graph-v1"
    },
    policy: policy(),
    bounds: {
      candidateLimit: 500,
      candidateCount: items.length,
      eligibleCount: items.length,
      resultLimit: 50,
      returnedCount: items.length,
      truncated: false,
      maxAffectedNodesPerDecision: 64,
      maxCommercialExposureCents: 1000000000,
      skippedCounts: {
        resolved: 0,
        pastEvent: 0,
        beyondHorizon: 0,
        noAffectedDependencies: 0
      }
    },
    items,
    snapshotDigest: "f".repeat(64),
    ...overrides
  };
}

function readResponse(input, overrides = {}) {
  const projectedSnapshot = snapshot();
  return {
    ok: true,
    storage: "firebase",
    organizationId: input.organizationId,
    ...(input.quoteId ? { quoteId: input.quoteId } : {}),
    policyVersion: "decision-debt-policy-v7",
    snapshot: {
      ...projectedSnapshot,
      bounds: {
        ...projectedSnapshot.bounds,
        resultLimit: input.limit
      }
    },
    ...overrides
  };
}

function request(suffix, organizationId = `org-${suffix}`) {
  return {
    organizationId,
    expectedPolicyVersion: "decision-debt-policy-v6",
    policy: policy(),
    requestId: `decision_debt_request_${suffix.repeat(32)}`
  };
}

function mutationResponse(input, overrides = {}) {
  return {
    ok: true,
    storage: "firebase",
    organizationId: input.organizationId,
    policyVersion: "decision-debt-policy-v7",
    policy: policy(),
    receipt: {
      requestId: input.requestId,
      operation: "configure_policy",
      organizationId: input.organizationId,
      policyVersion: "decision-debt-policy-v7",
      recordedAtISO: "2026-08-09T19:00:00.000Z"
    },
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.httpsCallable.mockReturnValue(mockState.callable);
});

describe("Decision Debt client read contract", () => {
  test("sends only the exact tenant scope and bound then accepts server-derived non-predictive data", async () => {
    const input = { organizationId: "org-read", limit: 50 };
    mockState.callable.mockResolvedValue({ data: readResponse(input) });

    const result = await getDecisionDebtSnapshot(input);

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      DECISION_DEBT_CALLABLES.getSnapshot
    );
    expect(mockState.callable).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({
      organizationId: "org-read",
      policyVersion: "decision-debt-policy-v7",
      snapshot: {
        authority: "server_derived",
        predictive: false,
        items: [{ score: 60, urgency: "high" }]
      }
    });
    expect(Object.isFrozen(result.snapshot.items)).toBe(true);
  });

  test("binds an exact quote-record read without exposing customer content in the request", async () => {
    const input = { organizationId: "org-read", quoteId: "quote-42", limit: 10 };
    mockState.callable.mockResolvedValue({ data: readResponse(input) });

    const result = await getDecisionDebtSnapshot(input);

    expect(mockState.callable).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({
      organizationId: "org-read",
      quoteId: "quote-42",
      snapshot: { authority: "server_derived", predictive: false }
    });
  });

  test("accepts explicit UNKNOWN priority without inventing exposure, score, or urgency", async () => {
    const input = { organizationId: "org-read-unknown", limit: 50 };
    const known = debtItem();
    const unknown = debtItem({
      commercialExposureCents: null,
      factors: {
        ...known.factors,
        exposure: {
          ...known.factors.exposure,
          value: null,
          bucket: "unavailable",
          known: false,
          cents: null
        }
      },
      rawScore: null,
      score: null,
      scoreState: "UNKNOWN",
      urgency: null
    });
    mockState.callable.mockResolvedValue({
      data: readResponse(input, { snapshot: snapshot([unknown]) })
    });

    await expect(getDecisionDebtSnapshot(input)).resolves.toMatchObject({
      snapshot: {
        items: [{
          commercialExposureCents: null,
          rawScore: null,
          score: null,
          scoreState: "UNKNOWN",
          urgency: null,
          factors: { exposure: { value: null, known: false, cents: null } }
        }]
      }
    });
  });

  test("rejects UNKNOWN priority carrying a guessed exposure factor or score", async () => {
    const input = { organizationId: "org-read-unknown-invalid", limit: 50 };
    const known = debtItem();
    const unknown = debtItem({
      commercialExposureCents: null,
      factors: {
        ...known.factors,
        exposure: {
          ...known.factors.exposure,
          value: 1,
          bucket: "unavailable",
          known: false,
          cents: null
        }
      },
      rawScore: null,
      score: null,
      scoreState: "UNKNOWN",
      urgency: null
    });
    mockState.callable.mockResolvedValueOnce({
      data: readResponse(input, { snapshot: snapshot([unknown]) })
    });
    await expect(getDecisionDebtSnapshot(input)).rejects.toThrow(/must not carry a guessed factor/i);

    mockState.callable.mockResolvedValueOnce({
      data: readResponse(input, {
        snapshot: snapshot([{
          ...unknown,
          factors: {
            ...unknown.factors,
            exposure: { ...unknown.factors.exposure, value: null }
          },
          score: 1
        }])
      })
    });
    await expect(getDecisionDebtSnapshot(input)).rejects.toThrow(/must not carry a guessed score/i);
  });

  test("rejects browser-supplied candidate contents and out-of-range reads", async () => {
    await expect(getDecisionDebtSnapshot({
      organizationId: "org-read-guard",
      limit: 50,
      candidates: [{ score: 100 }]
    })).rejects.toThrow(/unsupported fields/i);
    await expect(getDecisionDebtSnapshot({
      organizationId: "org-read-guard",
      limit: 101
    })).rejects.toThrow(/between 1 and 100/i);
    expect(mockState.callable).not.toHaveBeenCalled();
  });

  test("rejects cross-tenant, predictive, and inconsistent bounded snapshots", async () => {
    const input = { organizationId: "org-read-invalid", limit: 50 };
    mockState.callable.mockResolvedValueOnce({
      data: readResponse(input, { organizationId: "org-other" })
    });
    await expect(getDecisionDebtSnapshot(input)).rejects.toThrow(/invalid scoped snapshot/i);

    mockState.callable.mockResolvedValueOnce({
      data: readResponse(input, { snapshot: snapshot([], { predictive: true }) })
    });
    await expect(getDecisionDebtSnapshot(input)).rejects.toThrow(/unsupported authority snapshot/i);

    mockState.callable.mockResolvedValueOnce({
      data: readResponse(input, {
        snapshot: snapshot([debtItem()], {
          bounds: {
            ...snapshot().bounds,
            candidateCount: 2,
            eligibleCount: 2,
            returnedCount: 1,
            truncated: false
          }
        })
      })
    });
    await expect(getDecisionDebtSnapshot(input)).rejects.toThrow(/inconsistent read bounds/i);
  });
});

describe("Decision Debt policy client authority", () => {
  test("normalizes an exact policy and rejects additional mutable authority", () => {
    expect(normalizeDecisionDebtPolicy(policy())).toEqual(policy());
    expect(() => normalizeDecisionDebtPolicy({
      ...policy(),
      predictiveModel: "browser-score-v2"
    })).toThrow(/must contain exactly/i);
    expect(() => normalizeDecisionDebtPolicy(policy({
      decisionTypes: {
        guest_count: {
          ...policy().decisionTypes.guest_count,
          dependencyWeight: 6
        }
      }
    }))).toThrow(/between 1 and 5/i);
  });

  test("accepts only the exact request-bound policy receipt and clears the attempt", async () => {
    const input = request("a", "org-configure");
    mockState.callable.mockResolvedValue({ data: mutationResponse(input) });

    await expect(configureDecisionDebtPolicy(input)).resolves.toMatchObject({
      organizationId: input.organizationId,
      policyVersion: "decision-debt-policy-v7",
      mutationMode: "submitting",
      receipt: {
        requestId: input.requestId,
        operation: "configure_policy"
      }
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      DECISION_DEBT_CALLABLES.configurePolicy
    );
    expect(mockState.callable).toHaveBeenCalledWith(input);
    expect(readPendingDecisionDebtPolicyAttempt(input)).toBeNull();
  });

  test("retains an uncertain request and reconciles the same identity without duplication", async () => {
    const input = request("b", "org-reconcile");
    const unavailable = Object.assign(new Error("network unavailable"), {
      code: "functions/unavailable"
    });
    mockState.callable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ data: mutationResponse(input, { idempotent: true }) });

    await expect(configureDecisionDebtPolicy(input)).rejects.toThrow("network unavailable");
    expect(readPendingDecisionDebtPolicyAttempt(input)).toMatchObject({
      requestId: input.requestId,
      state: "uncertain",
      definitive: false
    });

    const reconciled = await reconcileDecisionDebtPolicy({
      organizationId: input.organizationId,
      requestId: input.requestId
    });
    expect(reconciled).toMatchObject({
      idempotent: true,
      mutationMode: "reconciliation",
      receipt: { requestId: input.requestId }
    });
    expect(mockState.callable).toHaveBeenNthCalledWith(1, input);
    expect(mockState.callable).toHaveBeenNthCalledWith(2, input);
  });

  test("fails closed when no exact unresolved request exists to reconcile", async () => {
    await expect(reconcileDecisionDebtPolicy({
      organizationId: "org-no-pending"
    })).rejects.toThrow(/no unresolved Decision Debt policy request/i);
    expect(mockState.callable).not.toHaveBeenCalled();
  });

  test("refuses changed reconciliation input and requires exact reset after definitive rejection", async () => {
    const uncertain = request("c", "org-changed-reconcile");
    mockState.callable.mockRejectedValueOnce(Object.assign(new Error("timeout"), {
      code: "functions/deadline-exceeded"
    }));
    await expect(configureDecisionDebtPolicy(uncertain)).rejects.toThrow("timeout");
    await expect(configureDecisionDebtPolicy({
      ...uncertain,
      policy: policy({ maxEventHorizonDays: 180 })
    })).rejects.toThrow(/unchanged input/i);

    const rejected = request("d", "org-definitive");
    const denied = Object.assign(new Error("admin authority required"), {
      code: "functions/permission-denied"
    });
    mockState.callable.mockRejectedValueOnce(denied);
    await expect(configureDecisionDebtPolicy(rejected)).rejects.toThrow("admin authority required");
    expect(isDefinitiveDecisionDebtError(denied)).toBe(true);
    expect(readPendingDecisionDebtPolicyAttempt(rejected)).toMatchObject({
      state: "error",
      definitive: true
    });
    expect(resetDefinitiveDecisionDebtPolicyAttempt({
      organizationId: rejected.organizationId,
      requestId: `decision_debt_request_${"e".repeat(32)}`
    })).toBe(false);
    expect(resetDefinitiveDecisionDebtPolicyAttempt(rejected)).toBe(true);
    expect(readPendingDecisionDebtPolicyAttempt(rejected)).toBeNull();
  });

  test("does not accept a mismatched receipt, policy version, or policy body as success", async () => {
    const mismatch = request("f", "org-mismatch-receipt");
    mockState.callable.mockResolvedValueOnce({
      data: mutationResponse(mismatch, {
        receipt: {
          ...mutationResponse(mismatch).receipt,
          requestId: `decision_debt_request_${"0".repeat(32)}`
        }
      })
    });
    await expect(configureDecisionDebtPolicy(mismatch)).rejects.toThrow(/exact server receipt/i);

    const changedPolicy = request("1", "org-mismatch-policy");
    mockState.callable.mockResolvedValueOnce({
      data: mutationResponse(changedPolicy, {
        policy: policy({ maxEventHorizonDays: 180 })
      })
    });
    await expect(configureDecisionDebtPolicy(changedPolicy)).rejects.toThrow(/does not match/i);
  });
});
