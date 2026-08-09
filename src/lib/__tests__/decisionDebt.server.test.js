import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const graphCore = require("../commercialDependencyGraphCore.cjs");
const {
  DECISION_DEBT_MAX_CANDIDATES,
  DECISION_DEBT_MAX_EXPOSURE_CENTS,
  DEFAULT_DECISION_DEBT_POLICY,
  DecisionDebtError,
  createDecisionDebtAuthority
} = require("../../../functions/decisionDebt.js");

const authority = createDecisionDebtAuthority({ graphCore });

function invalidation(overrides = {}) {
  return {
    invalidationId: "cci-open-1",
    operationId: "cco-operation-1",
    sourceRevisionId: "v0014",
    targetRevisionId: "v0015",
    nodeId: "output.plan.staffing_requirement",
    nodeKind: "output",
    classification: "REVIEW",
    triggeredBy: ["fact.event.guest_count"],
    state: "open",
    ...overrides
  };
}

function candidate(overrides = {}) {
  return {
    quoteId: "quote-a",
    customerId: "customer-a",
    sourceRevisionId: "v0014",
    eventDate: "2026-06-08",
    decisionId: "guest-count-final",
    decisionType: "guest_count",
    resolutionState: "unresolved",
    rootNodeIds: ["fact.event.guest_count"],
    commercialExposureCents: 2_500_001,
    ...overrides
  };
}

function snapshotInput(overrides = {}) {
  return {
    candidates: [candidate()],
    policy: DEFAULT_DECISION_DEBT_POLICY,
    nowISO: "2026-06-01T05:30:00.000Z",
    tenantTimeZone: "America/Chicago",
    limit: 50,
    ...overrides
  };
}

describe("deterministic Decision Debt authority", () => {
  test("requires the injected canonical dependency graph rather than a copied registry", () => {
    expect(() => createDecisionDebtAuthority()).toThrow(DecisionDebtError);
    expect(() => createDecisionDebtAuthority({ graphCore: {} })).toThrow(
      /canonical Commercial Dependency Graph core must be injected/i
    );
  });

  test("explains every deterministic factor from graph impact, lock proximity, bounded exposure, and reversibility", () => {
    const snapshot = authority.deriveSnapshot(snapshotInput());
    const item = snapshot.items[0];

    expect(snapshot).toMatchObject({
      authority: "server_derived",
      predictive: false,
      tenantTimeZone: "America/Chicago",
      tenantLocalDate: "2026-06-01",
      bounds: {
        candidateCount: 1,
        eligibleCount: 1,
        returnedCount: 1,
        truncated: false
      }
    });
    expect(snapshot.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(item).toMatchObject({
      quoteId: "quote-a",
      decisionId: "guest-count-final",
      lockDate: "2026-06-01",
      daysUntilLock: 0,
      commercialExposureCents: 2_500_001,
      score: 60,
      scoreState: "KNOWN",
      urgency: "high",
      factors: {
        dependency: {
          value: 5,
          source: "validated_tenant_policy_and_versioned_graph"
        },
        proximity: {
          value: 5,
          bucket: "due_or_overdue",
          lockWindowDays: 7
        },
        exposure: {
          value: 5,
          bucket: "over_20000",
          known: true,
          cents: 2_500_001
        },
        reversibility: {
          value: 3,
          classification: "constrained"
        }
      }
    });
    expect(item.affectedDependencyCount).toBeGreaterThan(5);
    expect(item.affectedNodeIds).toContain("artifact.kitchen_beo");
    expect(item.explanation).toHaveLength(4);
    expect(item.explanation.join(" ")).toContain("not predictive AI");
  });

  test("is deterministic for the same as-of instant and immutable policy", () => {
    const first = authority.deriveSnapshot(snapshotInput());
    const repeated = authority.deriveSnapshot(snapshotInput());

    expect(repeated).toEqual(first);
    expect(repeated.snapshotDigest).toBe(first.snapshotDigest);
    expect(first.items[0].id).toMatch(/^debt_[a-f0-9]{40}$/);
  });

  test("uses tenant-local calendar days across the daylight-saving transition", () => {
    const beforeLocalMidnight = authority.deriveSnapshot(snapshotInput({
      candidates: [candidate({ eventDate: "2026-03-14" })],
      nowISO: "2026-03-08T05:30:00.000Z"
    }));
    const afterLocalMidnight = authority.deriveSnapshot(snapshotInput({
      candidates: [candidate({ eventDate: "2026-03-14" })],
      nowISO: "2026-03-08T08:30:00.000Z"
    }));

    expect(beforeLocalMidnight).toMatchObject({
      tenantLocalDate: "2026-03-07",
      items: [{ lockDate: "2026-03-07", daysUntilLock: 0 }]
    });
    expect(afterLocalMidnight).toMatchObject({
      tenantLocalDate: "2026-03-08",
      items: [{ lockDate: "2026-03-07", daysUntilLock: -1 }]
    });
  });

  test("caps the formula at 100 and keeps unknown exposure unavailable rather than zero", () => {
    const maximum = authority.deriveSnapshot(snapshotInput({
      candidates: [candidate({
        decisionId: "beo-final",
        decisionType: "beo_finalization",
        eventDate: "2026-06-04",
        rootNodeIds: ["fact.event.time"]
      })]
    }));
    expect(maximum.items[0]).toMatchObject({
      rawScore: 625,
      score: 100,
      urgency: "critical"
    });

    const unavailable = authority.deriveSnapshot(snapshotInput({
      candidates: [candidate({ commercialExposureCents: null })]
    }));
    expect(unavailable.items[0]).toMatchObject({
      commercialExposureCents: null,
      rawScore: null,
      score: null,
      scoreState: "UNKNOWN",
      urgency: null,
      factors: {
        exposure: {
          value: null,
          bucket: "unavailable",
          known: false,
          cents: null
        }
      }
    });
    expect(unavailable.items[0].explanation.join(" ")).toContain(
      "is unavailable and is not coerced to zero"
    );
    expect(unavailable.items[0].explanation.join(" ")).toContain(
      "No priority score is assigned"
    );
  });

  test("sorts by score then lock urgency and exposes deterministic truncation", () => {
    const critical = candidate({
      quoteId: "quote-critical",
      decisionId: "beo-final",
      decisionType: "beo_finalization",
      eventDate: "2026-06-04",
      rootNodeIds: ["fact.event.time"]
    });
    const high = candidate({
      quoteId: "quote-high",
      decisionId: "guest-final"
    });
    const medium = candidate({
      quoteId: "quote-medium",
      decisionId: "rentals-final",
      decisionType: "rentals",
      rootNodeIds: ["fact.selection.rentals"]
    });
    const snapshot = authority.deriveSnapshot(snapshotInput({
      candidates: [medium, high, critical],
      limit: 2
    }));

    expect(snapshot.items.map((item) => item.quoteId)).toEqual([
      "quote-critical",
      "quote-high"
    ]);
    expect(snapshot.bounds).toMatchObject({
      candidateCount: 3,
      eligibleCount: 3,
      resultLimit: 2,
      returnedCount: 2,
      truncated: true
    });
  });

  test("reports deterministic skipped counts for resolved, past, and out-of-horizon work", () => {
    const snapshot = authority.deriveSnapshot(snapshotInput({
      candidates: [
        candidate(),
        candidate({
          quoteId: "quote-resolved",
          decisionId: "resolved",
          resolutionState: "resolved"
        }),
        candidate({
          quoteId: "quote-past",
          decisionId: "past",
          eventDate: "2026-05-31"
        }),
        candidate({
          quoteId: "quote-future",
          decisionId: "future",
          eventDate: "2027-06-02"
        })
      ]
    }));

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.bounds.skippedCounts).toEqual({
      resolved: 1,
      pastEvent: 1,
      beyondHorizon: 1,
      noAffectedDependencies: 0
    });
  });

  test("fails closed on unvalidated lock windows, exposure, graph nodes, and input bounds", () => {
    const invalidPolicy = {
      ...DEFAULT_DECISION_DEBT_POLICY,
      decisionTypes: {
        ...DEFAULT_DECISION_DEBT_POLICY.decisionTypes,
        guest_count: {
          ...DEFAULT_DECISION_DEBT_POLICY.decisionTypes.guest_count,
          lockWindowDays: 366
        }
      }
    };
    expect(() => authority.deriveSnapshot(snapshotInput({ policy: invalidPolicy }))).toThrow(
      /lock window.*0 to 365/i
    );
    expect(() => authority.deriveSnapshot(snapshotInput({
      candidates: [candidate({
        commercialExposureCents: DECISION_DEBT_MAX_EXPOSURE_CENTS + 1
      })]
    }))).toThrow(/commercial exposure cents.*0 to 1000000000/i);
    expect(() => authority.deriveSnapshot(snapshotInput({
      candidates: [candidate({ rootNodeIds: ["fact.unknown"] })]
    }))).toThrow(/unknown graph node/i);
    expect(() => authority.deriveSnapshot(snapshotInput({
      candidates: Array.from({ length: DECISION_DEBT_MAX_CANDIDATES + 1 }, (_, index) => (
        candidate({ quoteId: `quote-${index}`, decisionId: `decision-${index}` })
      ))
    }))).toThrow(/at most 500 candidates/i);
    expect(() => authority.deriveSnapshot(snapshotInput({ limit: 101 }))).toThrow(
      /result limit.*1 to 100/i
    );
  });

  test("rejects duplicate source-bound decision identities instead of double-counting debt", () => {
    expect(() => authority.deriveSnapshot(snapshotInput({
      candidates: [candidate(), candidate()]
    }))).toThrow(/candidate identity is duplicated/i);
  });

  test("builds debt only from explicit persisted unresolved invalidations", () => {
    const candidates = authority.buildCandidatesFromInvalidations({
      quoteId: "quote-a",
      customerId: "customer-a",
      eventDate: "2026-06-08",
      policy: DEFAULT_DECISION_DEBT_POLICY,
      commercialExposureCents: 444_000,
      invalidations: [
        invalidation(),
        invalidation({
          invalidationId: "cci-open-beo",
          nodeId: "artifact.kitchen_beo",
          nodeKind: "artifact"
        }),
        invalidation({
          invalidationId: "cci-resolved-rental",
          operationId: "cco-operation-2",
          nodeId: "output.plan.rental_quantity",
          triggeredBy: ["fact.selection.rentals"],
          state: "resolved"
        })
      ]
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        sourceRevisionId: "v0015",
        decisionType: "beo_finalization",
        resolutionState: "unresolved",
        rootNodeIds: ["fact.event.guest_count"],
        affectedNodeIds: ["artifact.kitchen_beo"],
        commercialExposureCents: 444_000
      }),
      expect.objectContaining({
        sourceRevisionId: "v0015",
        decisionType: "guest_count",
        resolutionState: "unresolved",
        rootNodeIds: ["fact.event.guest_count"],
        affectedNodeIds: [
          "artifact.kitchen_beo",
          "output.plan.staffing_requirement"
        ],
        commercialExposureCents: 444_000
      })
    ]);

    const snapshot = authority.deriveSnapshot(snapshotInput({ candidates }));
    const guestCountDebt = snapshot.items.find((item) => item.decisionType === "guest_count");
    expect(guestCountDebt).toMatchObject({
      affectedDependencyCount: 2,
      affectedNodeIds: [
        "artifact.kitchen_beo",
        "output.plan.staffing_requirement"
      ],
      factors: {
        dependency: {
          source: "persisted_unresolved_invalidations_and_versioned_graph"
        }
      }
    });
    expect(snapshot.items.some((item) => item.decisionType === "rentals")).toBe(false);
  });

  test("accepts declared derived-output roots while policy debt remains fact-root constrained", () => {
    const candidates = authority.buildCandidatesFromInvalidations({
      quoteId: "quote-a",
      customerId: "customer-a",
      eventDate: "2026-06-08",
      policy: DEFAULT_DECISION_DEBT_POLICY,
      invalidations: [
        invalidation({
          nodeId: "output.payment.final_balance",
          triggeredBy: [
            "fact.event.guest_count",
            "output.pricing.authoritative_total"
          ]
        })
      ]
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        decisionType: "guest_count",
        rootNodeIds: ["fact.event.guest_count"],
        affectedNodeIds: ["output.payment.final_balance"]
      })
    ]);
  });

  test("does not invent debt when no unresolved dependency state exists", () => {
    expect(authority.buildCandidatesFromInvalidations({
      quoteId: "quote-a",
      customerId: "customer-a",
      eventDate: "2026-06-08",
      policy: DEFAULT_DECISION_DEBT_POLICY,
      invalidations: []
    })).toEqual([]);

    expect(() => authority.buildCandidatesFromInvalidations({
      quoteId: "quote-a",
      customerId: "customer-a",
      eventDate: "2026-06-08",
      policy: DEFAULT_DECISION_DEBT_POLICY,
      invalidations: [invalidation({ state: "staff-read" })]
    })).toThrow(/explicit open, reopened, or resolved invalidation state/i);
  });
});
