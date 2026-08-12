import { describe, expect, test } from "vitest";

import {
  CLIENT_CALCULATION_PREVIEW_BOUNDARY,
  SERVER_SIMULATION_PREVIEW_BOUNDARY,
  buildClientCalculationImpactPreview,
  buildCommercialChangeSimulationImpactPreview
} from "../impactPreviewAdapter";
import {
  baseFixtureForm,
  quoteCalculationCatalog,
  quoteCalculationSettings
} from "./fixtures/quoteCalculationFixtures";

const OBJECT = Object.freeze({
  id: "quote-one",
  type: "opportunity",
  label: "Nguyen wedding"
});
const BASE_REVISION = "v0014";
const RECEIPT_ID = `ccs_${"1".repeat(48)}`;
const REQUEST_ID = `change_sim_${"a".repeat(32)}`;
const DIGEST = "8".repeat(64);
const SIMULATED_AT = "2026-08-11T15:00:00.000Z";
const EXPIRES_AT = "2026-08-11T15:15:00.000Z";

function dependency() {
  return {
    object: { id: "staffing", type: "staffing", label: "Staffing" },
    relationship: "Guest count changes the supported staffing scenario.",
    consequence: "The staffing recommendation may change."
  };
}

function clientInput(overrides = {}) {
  const currentForm = {
    ...baseFixtureForm,
    guests: 100,
    hours: 5,
    servers: 5,
    chefs: 2,
    bartenders: 1
  };
  const proposedForm = { ...currentForm, guests: 120 };
  return {
    id: "guest-count-client-preview",
    object: OBJECT,
    baseRevision: BASE_REVISION,
    currentForm,
    proposedForm,
    catalog: quoteCalculationCatalog,
    settings: quoteCalculationSettings,
    factDeltas: [{ field: "guests", before: 100, after: 120 }],
    affectedDependencies: [dependency()],
    calculatedAt: SIMULATED_AT,
    why: "The customer requested 120 guests.",
    consequence: "Food, staffing, tax, deposit, and total may change.",
    doNothing: "The draft remains modeled for 100 guests.",
    ...overrides
  };
}

function factDiffs() {
  return [{
    nodeId: "fact.event.guest_count",
    before: 100,
    proposedAfter: 120
  }];
}

function commercialValues() {
  return {
    currency: "USD",
    authoritativeTotal: {
      before: 12480,
      proposedAfter: 14320,
      changed: true,
      beforeSourceLabel: "canonical_pricing_snapshot",
      proposedAfterSourceLabel: "authoritative_pricing_preview",
      authority: "server_authoritative"
    },
    depositRequirement: {
      before: 3120,
      proposedAfter: 3580,
      changed: true,
      beforeSourceLabel: "canonical_pricing_snapshot",
      proposedAfterSourceLabel: "authoritative_pricing_preview",
      authority: "server_authoritative"
    }
  };
}

function impact() {
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

function graph() {
  return {
    graphId: "quotepilot-commercial",
    graphVersion: "commercial-dependency-graph-v1"
  };
}

function serverResult() {
  const receipt = {
    schemaVersion: "commercial-change-simulation-receipt-v1",
    authority: "server_authoritative",
    receiptType: "simulation",
    receiptId: RECEIPT_ID,
    requestId: REQUEST_ID,
    organizationId: "org-one",
    quoteId: "quote-one",
    baseRevisionId: BASE_REVISION,
    proposedRevisionId: "preview-v0015",
    proposalDigest: DIGEST,
    impactDigest: DIGEST,
    catalogAuthorityDigest: DIGEST,
    policyVersion: "commercial-change-policy-v1",
    graph: graph(),
    factDiffs: factDiffs(),
    commercialValues: commercialValues(),
    impact: impact(),
    authorizationRequired: true,
    simulatedAtISO: SIMULATED_AT,
    expiresAtISO: EXPIRES_AT,
    simulatedBy: {
      uid: "sales-uid",
      email: "sales@example.test",
      role: "sales"
    },
    boundary: "Server evidence only; no dependent artifact is published.",
    receiptDigest: DIGEST
  };
  const simulation = {
    schemaVersion: "commercial-change-impact-v1",
    advisory: true,
    receiptId: RECEIPT_ID,
    receiptDigest: DIGEST,
    authorizationRequired: true,
    expiresAtISO: EXPIRES_AT,
    identity: {
      organizationId: "org-one",
      quoteId: "quote-one",
      beforeRevisionId: BASE_REVISION,
      proposedRevisionId: "preview-v0015"
    },
    sources: {
      before: { label: "canonical_quote_revision", authority: "server_authoritative" },
      proposedAfter: { label: "authoritative_proposed_revision", authority: "server_authoritative" }
    },
    graph: graph(),
    factDiffs: factDiffs(),
    commercialValues: commercialValues(),
    impact: impact(),
    bounds: {
      declaredFactCount: 13,
      changedFactLimit: 32,
      dependentNodeLimit: 64,
      outputByteLimit: 262144
    },
    boundary: "Read-only advisory simulation."
  };
  return {
    ok: true,
    storage: "firebase",
    organizationId: "org-one",
    quoteId: "quote-one",
    idempotent: false,
    authorityState: "dormant",
    simulationReceipt: receipt,
    simulation
  };
}

function serverInput(overrides = {}) {
  return {
    id: "guest-count-server-preview",
    object: OBJECT,
    baseRevision: BASE_REVISION,
    result: serverResult(),
    evaluatedAt: "2026-08-11T15:05:00.000Z",
    why: "The customer requested 120 guests.",
    consequence: "The exact proposed total and dependent evidence are now visible.",
    doNothing: "The canonical v0014 quote remains unchanged.",
    ...overrides
  };
}

describe("client calculation ImpactPreview adapter", () => {
  test("normalizes calculateQuote output as partial advisory evidence", () => {
    const preview = buildClientCalculationImpactPreview(clientInput());

    expect(preview).toMatchObject({
      schemaVersion: "ambient-impact-preview-v1",
      previewKind: "client_calculation",
      evidenceAuthority: "client_calculated",
      status: "partial",
      authority: "advisory",
      requiresAuthoritativeCommit: true,
      baseRevision: BASE_REVISION,
      before: { facts: { guests: 100 }, commercial: { currency: "USD" } },
      after: { facts: { guests: 120 }, commercial: { currency: "USD" } },
      deltas: [{ field: "guests", before: 100, after: 120, authority: "client_input" }],
      receipt: null
    });
    expect(preview.after.commercial.total).toBeGreaterThan(preview.before.commercial.total);
    expect(preview.commercialDeltas.total.delta).toBe(
      preview.after.commercial.total - preview.before.commercial.total
    );
    expect(preview.unavailableReasons).toContain(
      "Exact authoritative repricing and current-revision confirmation remain unavailable until trusted save."
    );
    expect(preview.warnings).toContain(CLIENT_CALCULATION_PREVIEW_BOUNDARY);
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.commercialDeltas.total)).toBe(true);
  });

  test("fails closed when the catalog or explicit fact evidence is incomplete", () => {
    const preview = buildClientCalculationImpactPreview(clientInput({
      proposedForm: { ...clientInput().proposedForm, pkg: "missing-package" },
      factDeltas: [{ field: "guests", before: 100, after: 999 }]
    }));

    expect(preview.status).toBe("unavailable");
    expect(preview.before).toBeNull();
    expect(preview.after).toBeNull();
    expect(preview.deltas).toEqual([]);
    expect(preview.commercialDeltas).toBeNull();
    expect(preview.receipt).toBeNull();
    expect(preview.unavailableReasons.join(" ")).toMatch(/package pricing evidence|does not match/i);
  });

  test("requires explicit why, consequence, do-nothing, confidence, and freshness metadata", () => {
    expect(() => buildClientCalculationImpactPreview(clientInput({ why: "" }))).toThrow(/ImpactPreview\.why/);
    expect(() => buildClientCalculationImpactPreview(clientInput({ calculatedAt: "yesterday" })))
      .not.toThrow();
    expect(buildClientCalculationImpactPreview(clientInput({ calculatedAt: "yesterday" })))
      .toMatchObject({ status: "unavailable", freshness: { state: "unknown" } });
  });
});

describe("Commercial Change simulation ImpactPreview adapter", () => {
  test("exposes exact receipt-matched server evidence without granting mutation authority", () => {
    const preview = buildCommercialChangeSimulationImpactPreview(serverInput());

    expect(preview).toMatchObject({
      previewKind: "server_simulation",
      evidenceAuthority: "server_authoritative",
      status: "available",
      authority: "advisory",
      requiresAuthoritativeCommit: true,
      baseRevision: BASE_REVISION,
      before: {
        facts: { "fact.event.guest_count": 100 },
        commercial: { currency: "USD", total: 12480, deposit: 3120 }
      },
      after: {
        facts: { "fact.event.guest_count": 120 },
        commercial: { currency: "USD", total: 14320, deposit: 3580 }
      },
      receipt: {
        schemaVersion: "commercial-change-simulation-receipt-v1",
        type: "simulation",
        id: RECEIPT_ID,
        digest: DIGEST,
        requestId: REQUEST_ID,
        baseRevision: BASE_REVISION,
        proposedRevision: "preview-v0015",
        simulatedAt: SIMULATED_AT,
        expiresAt: EXPIRES_AT,
        authorizationRequired: true
      }
    });
    expect(preview.deltas).toEqual([{
      field: "fact.event.guest_count",
      before: 100,
      after: 120,
      authority: "server_authoritative"
    }]);
    expect(preview.affectedDependencies[0]).toMatchObject({
      object: { id: "artifact.kitchen_beo", type: "artifact" }
    });
    expect(preview.warnings).toContain(SERVER_SIMULATION_PREVIEW_BOUNDARY);
    expect(Object.isFrozen(preview.receipt)).toBe(true);
    expect(Object.isFrozen(preview.provenance)).toBe(true);
  });

  test("fails closed and strips values when the projection diverges from its receipt", () => {
    const result = serverResult();
    result.simulation.commercialValues.authoritativeTotal.proposedAfter = 15000;
    const preview = buildCommercialChangeSimulationImpactPreview(serverInput({ result }));

    expect(preview).toMatchObject({
      previewKind: "server_simulation",
      evidenceAuthority: "server_authoritative",
      status: "unavailable",
      before: null,
      after: null,
      commercialDeltas: null,
      receipt: null
    });
    expect(preview.deltas).toEqual([]);
    expect(preview.unavailableReasons[0]).toMatch(/does not match its immutable receipt/i);
  });

  test("retains receipt identity but strips expired simulated values", () => {
    const preview = buildCommercialChangeSimulationImpactPreview(serverInput({
      evaluatedAt: "2026-08-11T15:16:00.000Z"
    }));

    expect(preview).toMatchObject({
      status: "unavailable",
      freshness: { state: "stale", observedAt: SIMULATED_AT },
      source: { state: "stale" },
      receipt: { id: RECEIPT_ID, expiresAt: EXPIRES_AT },
      before: null,
      after: null,
      commercialDeltas: null
    });
    expect(preview.unavailableReasons[0]).toMatch(/expired/i);
  });

  test("rejects an evaluation instant that predates the server receipt", () => {
    const preview = buildCommercialChangeSimulationImpactPreview(serverInput({
      evaluatedAt: "2026-08-11T14:59:59.000Z"
    }));

    expect(preview).toMatchObject({
      status: "unavailable",
      receipt: { id: RECEIPT_ID },
      before: null,
      after: null
    });
    expect(preview.unavailableReasons[0]).toMatch(/precedes/i);
  });

  test("fails closed on missing simulation evidence and preserves immutable output", () => {
    const preview = buildCommercialChangeSimulationImpactPreview(serverInput({ result: null }));

    expect(preview.status).toBe("unavailable");
    expect(preview.baseRevision).toBe(BASE_REVISION);
    expect(preview.receipt).toBeNull();
    expect(Object.isFrozen(preview)).toBe(true);
  });
});
