import { describe, expect, test } from "vitest";
import {
  COMMERCIAL_CHANGE_IMPACT_AUTHORITY,
  COMMERCIAL_CHANGE_IMPACT_BOUNDARY,
  COMMERCIAL_CHANGE_IMPACT_ERROR_CODES,
  COMMERCIAL_CHANGE_IMPACT_FACT_NODE_IDS,
  COMMERCIAL_CHANGE_IMPACT_MAX_FACT_BYTES,
  COMMERCIAL_CHANGE_IMPACT_MAX_OUTPUT_BYTES,
  COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS,
  COMMERCIAL_CHANGE_IMPACT_SNAPSHOT_SCHEMA_VERSION,
  simulateCommercialChangeImpact
} from "../commercialChangeImpact";

const IDENTITY = Object.freeze({
  organizationId: "org-1",
  quoteId: "quote-1",
  beforeRevisionId: "v0014",
  proposedRevisionId: "v0015-preview"
});

function facts(revisionId, overrides = {}) {
  const values = Object.fromEntries(COMMERCIAL_CHANGE_IMPACT_FACT_NODE_IDS.map((nodeId) => (
    [nodeId, null]
  )));
  return {
    ...values,
    "fact.quote.identity": { organizationId: "org-1", quoteId: "quote-1" },
    "fact.quote.active_revision": revisionId,
    "fact.quote.accepted_revision": "v0014",
    "fact.event.guest_count": 125,
    ...overrides
  };
}

function snapshot(role, overrides = {}) {
  const before = role === "before";
  const revisionId = before ? IDENTITY.beforeRevisionId : IDENTITY.proposedRevisionId;
  return {
    schemaVersion: COMMERCIAL_CHANGE_IMPACT_SNAPSHOT_SCHEMA_VERSION,
    source: {
      label: before
        ? COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.before
        : COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.proposedAfter,
      authority: COMMERCIAL_CHANGE_IMPACT_AUTHORITY,
      organizationId: IDENTITY.organizationId,
      quoteId: IDENTITY.quoteId,
      revisionId
    },
    facts: facts(IDENTITY.beforeRevisionId),
    pricing: {
      sourceLabel: before
        ? COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.beforePricing
        : COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.proposedAfterPricing,
      authority: COMMERCIAL_CHANGE_IMPACT_AUTHORITY,
      currency: "USD",
      authoritativeTotal: before ? 12480 : 16920,
      depositRequirement: before ? 3120 : 4321
    },
    protectedEvidence: {
      lifecycle: { state: "accepted", acceptedAtISO: "2026-08-01T12:00:00.000Z" },
      provider: { deliveryState: "provider_accepted" },
      payment: { depositStatus: "unpaid" },
      portal: { decision: "accepted" },
      booking: null
    },
    ...overrides
  };
}

function simulate(overrides = {}) {
  return simulateCommercialChangeImpact({
    identity: IDENTITY,
    beforeSnapshot: snapshot("before"),
    proposedAfterSnapshot: snapshot("proposedAfter", {
      facts: facts(IDENTITY.beforeRevisionId, { "fact.event.guest_count": 175 })
    }),
    ...overrides
  });
}

function expectCode(action, code) {
  expect(action).toThrow(expect.objectContaining({ code }));
}

describe("commercial change-impact simulation", () => {
  test("reports exact declared fact and supplied commercial-value changes without calculating them", () => {
    const result = simulate();

    expect(result.factDiffs).toEqual([
      {
        nodeId: "fact.event.guest_count",
        before: 125,
        proposedAfter: 175
      },
    ]);
    expect(result.commercialValues).toMatchObject({
      currency: "USD",
      authoritativeTotal: {
        before: 12480,
        proposedAfter: 16920,
        changed: true,
        authority: "server_authoritative"
      },
      depositRequirement: {
        before: 3120,
        proposedAfter: 4321,
        changed: true,
        authority: "server_authoritative"
      }
    });
    expect(result.impact.rootNodeIds).toEqual([
      "fact.event.guest_count",
      "output.payment.deposit_requirement",
      "output.pricing.authoritative_total"
    ]);
    expect(result.impact.dependentNodes.length).toBeGreaterThan(0);
    expect(result.impact.dependentNodes.every((node) => (
      ["REVIEW", "STALE"].includes(node.advisoryClass)
    ))).toBe(true);
    expect(result.impact.dependentNodes.find((node) => node.id === "artifact.kitchen_beo"))
      .toMatchObject({ kind: "artifact", advisoryClass: "STALE" });
    expect(result.impact.dependentNodes.find((node) => node.id === "output.plan.staffing_requirement"))
      .toMatchObject({ kind: "output", advisoryClass: "REVIEW" });
    expect(result.boundary).toBe(COMMERCIAL_CHANGE_IMPACT_BOUNDARY);
    expect(result.boundary).toContain("Authorization and reconciliation are required");
    expect(JSON.stringify(result)).not.toContain("provider_accepted");
    expect(JSON.stringify(result)).not.toContain("acceptedAtISO");
  });

  test("deep-freezes a detached, bounded result", () => {
    const proposedAfterSnapshot = snapshot("proposedAfter", {
      facts: facts(IDENTITY.beforeRevisionId, {
        "fact.event.guest_count": 175,
        "fact.event.venue": { id: "venue-1", name: "Atrium" }
      })
    });
    const result = simulate({ proposedAfterSnapshot });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.factDiffs)).toBe(true);
    expect(Object.isFrozen(
      result.factDiffs.find((diff) => diff.nodeId === "fact.event.venue")?.proposedAfter
    )).toBe(true);
    proposedAfterSnapshot.facts["fact.event.venue"].name = "Changed later";
    expect(JSON.stringify(result)).not.toContain("Changed later");
    expect(result.bounds.declaredFactCount).toBe(COMMERCIAL_CHANGE_IMPACT_FACT_NODE_IDS.length);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength)
      .toBeLessThanOrEqual(COMMERCIAL_CHANGE_IMPACT_MAX_OUTPUT_BYTES);
  });

  test("is deterministic across object insertion order and does not mutate inputs", () => {
    const beforeSnapshot = snapshot("before");
    const afterFacts = facts(IDENTITY.beforeRevisionId, {
      "fact.event.venue": { z: 2, a: 1 }
    });
    const reversedFacts = Object.fromEntries(Object.entries(afterFacts).reverse());
    const afterA = snapshot("proposedAfter", { facts: afterFacts });
    const afterB = snapshot("proposedAfter", {
      facts: {
        ...reversedFacts,
        "fact.event.venue": { a: 1, z: 2 }
      }
    });
    const original = structuredClone(afterA);

    const first = simulateCommercialChangeImpact({ identity: IDENTITY, beforeSnapshot, proposedAfterSnapshot: afterA });
    const second = simulateCommercialChangeImpact({ identity: IDENTITY, beforeSnapshot, proposedAfterSnapshot: afterB });

    expect(first).toEqual(second);
    expect(afterA).toEqual(original);
  });

  test.each(["lifecycle", "provider", "payment", "portal", "booking"])(
    "rejects a proposed %s evidence change without returning its contents",
    (category) => {
      const after = snapshot("proposedAfter", {
        facts: facts(IDENTITY.beforeRevisionId, { "fact.event.guest_count": 175 })
      });
      after.protectedEvidence[category] = { changed: true, secret: "must-not-escape" };
      let error;
      try {
        simulate({ proposedAfterSnapshot: after });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        code: COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.PROTECTED_EVIDENCE_CHANGE,
        details: { categories: [category] }
      });
      expect(JSON.stringify(error)).not.toContain("must-not-escape");
    }
  );

  test("rejects missing or cross-scope identity and inconsistent revisions", () => {
    expectCode(
      () => simulateCommercialChangeImpact({}),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_INPUT
    );
    const { proposedRevisionId: _missingRevision, ...missingIdentity } = IDENTITY;
    expectCode(
      () => simulate({ identity: missingIdentity }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_IDENTITY
    );
    expectCode(
      () => simulate({ identity: { ...IDENTITY, organizationId: "org-2" } }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.SCOPE_MISMATCH
    );
    expectCode(
      () => simulate({ identity: { ...IDENTITY, quoteId: "quote-2" } }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.SCOPE_MISMATCH
    );
    const after = snapshot("proposedAfter");
    after.source.revisionId = "different-revision";
    expectCode(
      () => simulate({ proposedAfterSnapshot: after }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.REVISION_MISMATCH
    );
    const inconsistentFact = snapshot("proposedAfter", {
      facts: facts("different-revision")
    });
    expectCode(
      () => simulate({ proposedAfterSnapshot: inconsistentFact }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.REVISION_MISMATCH
    );
  });

  test("rejects untrusted snapshot and pricing sources", () => {
    const untrustedSnapshot = snapshot("proposedAfter");
    untrustedSnapshot.source.authority = "client_preview";
    expectCode(
      () => simulate({ proposedAfterSnapshot: untrustedSnapshot }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.UNTRUSTED_SOURCE
    );

    const untrustedPricing = snapshot("proposedAfter");
    untrustedPricing.pricing.authority = "client_preview";
    expectCode(
      () => simulate({ proposedAfterSnapshot: untrustedPricing }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.UNTRUSTED_PRICING_SOURCE
    );
    const mislabeledPricing = snapshot("proposedAfter");
    mislabeledPricing.pricing.sourceLabel = COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.beforePricing;
    expectCode(
      () => simulate({ proposedAfterSnapshot: mislabeledPricing }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.UNTRUSTED_PRICING_SOURCE
    );
  });

  test("requires the exact declared fact and protected-evidence contracts", () => {
    const missingFact = snapshot("proposedAfter");
    delete missingFact.facts["fact.event.time"];
    expectCode(
      () => simulate({ proposedAfterSnapshot: missingFact }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_FACT_SET
    );

    const undeclaredFact = snapshot("proposedAfter");
    undeclaredFact.facts["fact.customer.secret"] = "not declared";
    expectCode(
      () => simulate({ proposedAfterSnapshot: undeclaredFact }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_FACT_SET
    );

    const mutableRootField = snapshot("proposedAfter");
    mutableRootField.lifecycle = { status: "booked" };
    expectCode(
      () => simulate({ proposedAfterSnapshot: mutableRootField }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_SNAPSHOT
    );
  });

  test("rejects noncanonical, invalid-money, and oversized values", () => {
    const cyclic = {};
    cyclic.self = cyclic;
    const cyclicSnapshot = snapshot("proposedAfter", {
      facts: facts(IDENTITY.beforeRevisionId, { "fact.event.venue": cyclic })
    });
    expectCode(
      () => simulate({ proposedAfterSnapshot: cyclicSnapshot }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_SNAPSHOT
    );

    const invalidPricing = snapshot("proposedAfter");
    invalidPricing.pricing.authoritativeTotal = Number.NaN;
    expectCode(
      () => simulate({ proposedAfterSnapshot: invalidPricing }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.INVALID_SNAPSHOT
    );

    const oversized = snapshot("proposedAfter", {
      facts: facts(IDENTITY.beforeRevisionId, {
        "fact.event.venue": "x".repeat(COMMERCIAL_CHANGE_IMPACT_MAX_FACT_BYTES + 1)
      })
    });
    expectCode(
      () => simulate({ proposedAfterSnapshot: oversized }),
      COMMERCIAL_CHANGE_IMPACT_ERROR_CODES.BOUNDS_EXCEEDED
    );
  });

  test("returns no inferred state or proof claims when declared values are unchanged", () => {
    const beforeSnapshot = snapshot("before");
    const proposedAfterSnapshot = snapshot("proposedAfter", {
      facts: facts(IDENTITY.beforeRevisionId),
      pricing: {
        sourceLabel: COMMERCIAL_CHANGE_IMPACT_SOURCE_LABELS.proposedAfterPricing,
        authority: COMMERCIAL_CHANGE_IMPACT_AUTHORITY,
        currency: "USD",
        authoritativeTotal: 12480,
        depositRequirement: 3120
      }
    });
    const result = simulateCommercialChangeImpact({
      identity: IDENTITY,
      beforeSnapshot,
      proposedAfterSnapshot
    });
    const serialized = JSON.stringify(result);

    expect(result.factDiffs).toEqual([]);
    expect(result.impact.rootNodeIds).toEqual([]);
    expect(result.impact.dependentNodes).toEqual([]);
    expect(result.commercialValues.authoritativeTotal.changed).toBe(false);
    expect(result.commercialValues.depositRequirement.changed).toBe(false);
    for (const forbiddenClaim of [
      "safeToPublish",
      "receipt",
      "artifactFreshness",
      "contractChanged",
      "paymentChanged",
      "customerDecisionChanged",
      "ai"
    ]) {
      expect(serialized).not.toContain(forbiddenClaim);
    }
  });
});
