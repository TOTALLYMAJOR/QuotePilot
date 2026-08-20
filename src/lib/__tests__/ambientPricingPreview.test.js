import { describe, expect, test, vi } from "vitest";

import {
  AMBIENT_PRICING_MARGIN_BOUNDARY,
  AMBIENT_PRICING_MARGIN_CONTEXT_SCHEMA_VERSION,
  AMBIENT_PRICING_PREVIEW_SCHEMA_VERSION,
  AMBIENT_SAVED_PRICING_MARGIN_MODEL,
  AMBIENT_SAVED_PRICING_MARGIN_SOURCE_LABEL,
  AMBIENT_SAVED_PRICING_MARGIN_SNAPSHOT_SOURCE_LABEL,
  AmbientPricingPreviewError,
  buildAmbientPricingMarginContext,
  buildSavedAmbientPricingMargin,
  prepareAmbientPricingPreview
} from "../ambientPricingPreview";
import {
  quoteCalculationCatalog,
  quoteCalculationSettings
} from "./fixtures/quoteCalculationFixtures";

const ORGANIZATION_ID = "org-one";
const QUOTE_ID = "quote-one";
const BASE_REVISION_ID = "v0012";
const REQUEST_ID = `change_sim_${"a".repeat(32)}`;
const RECEIPT_ID = `ccs_${"1".repeat(48)}`;
const DIGEST = "8".repeat(64);
const TIMESTAMP = "2026-08-11T15:05:00.000Z";
const SIMULATED_AT = "2026-08-11T15:00:00.000Z";
const EXPIRES_AT = "2026-08-11T15:15:00.000Z";

function quote(overrides = {}) {
  return {
    id: QUOTE_ID,
    quoteNumber: "Q-0012",
    organizationId: ORGANIZATION_ID,
    activeVersionId: BASE_REVISION_ID,
    status: "draft",
    customer: {
      name: "Maya Bennett",
      email: "maya@example.test"
    },
    event: {
      name: "Autumn Benefit Dinner",
      date: "2026-09-19",
      time: "18:00",
      hours: 5,
      venue: "The Foundry Hall",
      style: "Plated",
      guests: 100,
      servers: 5,
      chefs: 2,
      bartenders: 1
    },
    selection: {
      packageId: "basic",
      addons: [],
      rentals: [],
      menuItems: [],
      laborRateSnapshot: {
        serverRateApplied: 20,
        chefRateApplied: 40,
        bartenderRateApplied: 30
      },
      taxRegion: "local",
      seasonProfileId: "standard",
      milesRT: 0,
      payMethod: "card"
    },
    totals: {
      total: 2_000,
      deposit: 500
    },
    pricing: {
      authority: "server_authoritative",
      calculatedAt: SIMULATED_AT,
      inputs: { event: { guests: 100 } },
      grandTotal: 2_000,
      deposit: { amount: 500 },
      rulesSnapshot: { pricingSettingsVersion: 12 }
    },
    ...overrides
  };
}

function localInput(overrides = {}) {
  return {
    source: "local",
    organizationId: ORGANIZATION_ID,
    quote: quote(),
    guestCount: 130,
    catalog: quoteCalculationCatalog,
    settings: quoteCalculationSettings,
    timestamp: TIMESTAMP,
    requestId: "",
    ...overrides
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

function commercialValues() {
  return {
    currency: "USD",
    authoritativeTotal: {
      before: 2_000,
      proposedAfter: 2_600,
      changed: true,
      beforeSourceLabel: "canonical_pricing_snapshot",
      proposedAfterSourceLabel: "authoritative_pricing_preview",
      authority: "server_authoritative"
    },
    depositRequirement: {
      before: 500,
      proposedAfter: 650,
      changed: true,
      beforeSourceLabel: "canonical_pricing_snapshot",
      proposedAfterSourceLabel: "authoritative_pricing_preview",
      authority: "server_authoritative"
    }
  };
}

function graph() {
  return {
    graphId: "quotepilot-commercial",
    graphVersion: "commercial-dependency-graph-v1"
  };
}

function serverResult({
  organizationId = ORGANIZATION_ID,
  quoteId = QUOTE_ID,
  baseRevisionId = BASE_REVISION_ID,
  requestId = REQUEST_ID,
  beforeGuests = 100,
  afterGuests = 130,
  expiresAtISO = EXPIRES_AT
} = {}) {
  const factDiffs = [{
    nodeId: "fact.event.guest_count",
    before: beforeGuests,
    proposedAfter: afterGuests
  }];
  const receipt = {
    schemaVersion: "commercial-change-simulation-receipt-v1",
    authority: "server_authoritative",
    receiptType: "simulation",
    receiptId: RECEIPT_ID,
    requestId,
    organizationId,
    quoteId,
    baseRevisionId,
    proposedRevisionId: "preview-v0013",
    proposalDigest: DIGEST,
    impactDigest: DIGEST,
    catalogAuthorityDigest: DIGEST,
    policyVersion: "commercial-change-policy-v1",
    graph: graph(),
    factDiffs,
    commercialValues: commercialValues(),
    impact: impact(),
    authorizationRequired: true,
    simulatedAtISO: SIMULATED_AT,
    expiresAtISO,
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
    expiresAtISO,
    identity: {
      organizationId,
      quoteId,
      beforeRevisionId: baseRevisionId,
      proposedRevisionId: "preview-v0013"
    },
    sources: {
      before: { label: "canonical_quote_revision", authority: "server_authoritative" },
      proposedAfter: { label: "authoritative_proposed_revision", authority: "server_authoritative" }
    },
    graph: graph(),
    factDiffs,
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
    organizationId,
    quoteId,
    idempotent: false,
    authorityState: "dormant",
    simulationReceipt: receipt,
    simulation
  };
}

function firebaseInput(overrides = {}) {
  return {
    ...localInput(),
    source: "firebase",
    createRequestId: vi.fn(() => REQUEST_ID),
    simulate: vi.fn(async () => serverResult()),
    ...overrides
  };
}

function canonicalMargin({ totals }) {
  const revenue = ["base", "addons", "rentals", "menu", "labor", "serviceFee"]
    .reduce((sum, field) => sum + Number(totals[field] || 0), 0);
  const cost = revenue * 0.6;
  return {
    available: true,
    revenue,
    cost,
    marginPct: (revenue - cost) / revenue,
    target: 0.45
  };
}

describe("Ambient local pricing-preview host", () => {
  test("hydrates the exact saved draft and returns one bounded client ImpactPreview", async () => {
    const evaluateMargin = vi.fn(canonicalMargin);
    const input = localInput({ evaluateMargin });
    const originalQuote = structuredClone(input.quote);

    const result = await prepareAmbientPricingPreview(input);

    expect(result).toMatchObject({
      schemaVersion: AMBIENT_PRICING_PREVIEW_SCHEMA_VERSION,
      mode: "client",
      requestId: "",
      preview: {
        schemaVersion: "ambient-impact-preview-v1",
        previewKind: "client_calculation",
        evidenceAuthority: "client_calculated",
        status: "partial",
        baseRevision: BASE_REVISION_ID,
        source: { label: "Current tenant catalog calculation" },
        before: { facts: { guests: 100 } },
        after: { facts: { guests: 130 } },
        receipt: null
      },
      marginContext: {
        schemaVersion: AMBIENT_PRICING_MARGIN_CONTEXT_SCHEMA_VERSION,
        status: "available",
        authority: "advisory_client_cost_context"
      }
    });
    expect(result.preview.deltas).toEqual([{
      field: "guests",
      before: 100,
      after: 130,
      authority: "client_input"
    }]);
    expect(result.preview.affectedDependencies.map((entry) => entry.object.id)).toEqual([
      "staffing",
      "catalog-scope",
      "deposit-policy",
      "margin"
    ]);
    expect(result.preview.doNothing).toContain("$2,000.00");
    expect(evaluateMargin).toHaveBeenCalledTimes(2);
    expect(evaluateMargin.mock.calls[0][0].form.guests).toBe(100);
    expect(evaluateMargin.mock.calls[1][0].form.guests).toBe(130);
    expect(input.quote).toEqual(originalQuote);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.marginContext.deltas)).toBe(true);
  });

  test("never invokes an injected server simulator for local fallback", async () => {
    const simulate = vi.fn(() => {
      throw new Error("must not run");
    });
    const result = await prepareAmbientPricingPreview(localInput({ simulate }));

    expect(result.mode).toBe("client");
    expect(simulate).not.toHaveBeenCalled();
  });

  test("preserves a pending server identity instead of downgrading it to local evidence", async () => {
    await expect(prepareAmbientPricingPreview(localInput({ requestId: REQUEST_ID })))
      .rejects.toMatchObject({
        code: "pending_server_request_requires_reconciliation",
        definitive: false,
        requestId: REQUEST_ID
      });
  });

  test.each([
    ["unsupported source", { source: "cache" }, "preview_source_invalid"],
    ["missing organization", { organizationId: "" }, "organization_scope_missing"],
    ["cross-tenant quote", { quote: quote({ organizationId: "org-other" }) }, "organization_scope_mismatch"],
    ["missing quote ID", { quote: quote({ id: "" }) }, "quote_scope_missing"],
    ["invalid timestamp", { timestamp: "today" }, "preview_timestamp_invalid"],
    ["fractional guests", { guestCount: 130.5 }, "guest_count_out_of_bounds"],
    ["too many guests", { guestCount: 401 }, "guest_count_out_of_bounds"],
    ["unchanged scenario", { guestCount: 100 }, "pricing_scenario_unchanged"],
    ["missing saved package", { quote: quote({ selection: { packageId: "" } }) }, "saved_package_evidence_missing"],
    [
      "pricing guest mismatch",
      { quote: quote({ pricing: { inputs: { event: { guests: 99 } }, grandTotal: 2_000 } }) },
      "saved_pricing_scope_mismatch"
    ]
  ])("fails closed for %s", async (_label, overrides, code) => {
    await expect(prepareAmbientPricingPreview(localInput(overrides)))
      .rejects.toMatchObject({ code, definitive: true, requestId: "" });
  });

  test("fails closed instead of displaying values from incomplete client settings", async () => {
    const { serviceFeePct: _removed, ...incompleteSettings } = quoteCalculationSettings;

    await expect(prepareAmbientPricingPreview(localInput({ settings: incompleteSettings })))
      .rejects.toMatchObject({
        code: "client_pricing_evidence_incomplete",
        definitive: true,
        requestId: ""
      });
  });

  test("fails closed when the saved quote has no exact revision identity", async () => {
    await expect(prepareAmbientPricingPreview(localInput({
      quote: quote({ activeVersionId: "", versionMeta: null, updatedAtISO: "" })
    }))).rejects.toMatchObject({
      code: "saved_revision_missing",
      definitive: true,
      requestId: "",
      userMessage: expect.stringContaining("exact saved quote revision")
    });
  });
});

describe("Ambient connected pricing-preview host", () => {
  test("injects the exact tenant, quote, revision, request, and hydrated proposed form", async () => {
    const createRequestId = vi.fn(() => REQUEST_ID);
    const simulate = vi.fn(async () => serverResult());

    const result = await prepareAmbientPricingPreview(firebaseInput({
      createRequestId,
      simulate
    }));

    expect(createRequestId).toHaveBeenCalledWith("simulation");
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(simulate).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      expectedActiveVersionId: BASE_REVISION_ID,
      requestId: REQUEST_ID,
      form: expect.objectContaining({ guests: 130, pkg: "basic" })
    }));
    expect(Object.isFrozen(simulate.mock.calls[0][0].form)).toBe(true);
    expect(result).toMatchObject({
      schemaVersion: AMBIENT_PRICING_PREVIEW_SCHEMA_VERSION,
      mode: "server",
      requestId: REQUEST_ID,
      preview: {
        previewKind: "server_simulation",
        evidenceAuthority: "server_authoritative",
        status: "available",
        baseRevision: BASE_REVISION_ID,
        receipt: { id: RECEIPT_ID, requestId: REQUEST_ID }
      },
      marginContext: {
        status: "unavailable",
        current: null,
        proposed: null
      }
    });
    expect(result.preview.deltas).toContainEqual({
      field: "fact.event.guest_count",
      before: 100,
      after: 130,
      authority: "server_authoritative"
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("reuses an exact retained request without creating a second identity", async () => {
    const createRequestId = vi.fn(() => `change_sim_${"b".repeat(32)}`);
    const simulate = vi.fn(async () => serverResult());

    const result = await prepareAmbientPricingPreview(firebaseInput({
      requestId: REQUEST_ID,
      createRequestId,
      simulate
    }));

    expect(createRequestId).not.toHaveBeenCalled();
    expect(simulate.mock.calls[0][0].requestId).toBe(REQUEST_ID);
    expect(result.requestId).toBe(REQUEST_ID);
  });

  test("retains the exact request after an uncertain server outcome", async () => {
    const providerError = Object.assign(new Error("connection reset"), { code: "internal" });
    const simulate = vi.fn(async () => {
      throw providerError;
    });
    const isDefinitiveError = vi.fn(() => false);

    await expect(prepareAmbientPricingPreview(firebaseInput({
      requestId: REQUEST_ID,
      simulate,
      isDefinitiveError
    }))).rejects.toMatchObject({
      code: "server_simulation_uncertain",
      definitive: false,
      requestId: REQUEST_ID,
      userMessage: expect.stringContaining("Try the same request again")
    });
    expect(isDefinitiveError).toHaveBeenCalledWith(providerError);
  });

  test("clears the request only after a definitive server rejection", async () => {
    const rejection = Object.assign(new Error("revision conflict"), { code: "aborted" });

    await expect(prepareAmbientPricingPreview(firebaseInput({
      requestId: REQUEST_ID,
      simulate: vi.fn(async () => {
        throw rejection;
      }),
      isDefinitiveError: vi.fn(() => true)
    }))).rejects.toMatchObject({
      code: "server_simulation_rejected",
      definitive: true,
      requestId: ""
    });
  });

  test("does not manufacture a request identity when the server injection is absent", async () => {
    const createRequestId = vi.fn(() => REQUEST_ID);

    await expect(prepareAmbientPricingPreview(firebaseInput({
      simulate: null,
      createRequestId
    }))).rejects.toMatchObject({
      code: "server_simulation_unavailable",
      definitive: true,
      requestId: ""
    });
    expect(createRequestId).not.toHaveBeenCalled();
  });

  test("retains an existing request when the server injection becomes unavailable", async () => {
    await expect(prepareAmbientPricingPreview(firebaseInput({
      requestId: REQUEST_ID,
      simulate: null
    }))).rejects.toMatchObject({
      code: "server_simulation_unavailable",
      definitive: false,
      requestId: REQUEST_ID
    });
  });

  test("rejects an invalid generated request before invoking the server", async () => {
    const simulate = vi.fn();

    await expect(prepareAmbientPricingPreview(firebaseInput({
      createRequestId: vi.fn(() => "not-a-request"),
      simulate
    }))).rejects.toMatchObject({
      code: "simulation_request_id_invalid",
      definitive: true,
      requestId: ""
    });
    expect(simulate).not.toHaveBeenCalled();
  });

  test("retains uncertainty for a cross-scope or receipt-divergent response", async () => {
    await expect(prepareAmbientPricingPreview(firebaseInput({
      requestId: REQUEST_ID,
      simulate: vi.fn(async () => serverResult({ organizationId: "org-other" }))
    }))).rejects.toMatchObject({
      code: "server_simulation_scope_mismatch",
      definitive: false,
      requestId: REQUEST_ID
    });

    const divergent = serverResult();
    divergent.simulation.commercialValues.authoritativeTotal.proposedAfter = 2_700;
    await expect(prepareAmbientPricingPreview(firebaseInput({
      requestId: REQUEST_ID,
      simulate: vi.fn(async () => divergent)
    }))).rejects.toMatchObject({
      code: "server_simulation_receipt_uncertain",
      definitive: false,
      requestId: REQUEST_ID
    });
  });

  test("clears an exact but expired, wrong-revision, or wrong-fact receipt", async () => {
    await expect(prepareAmbientPricingPreview(firebaseInput({
      requestId: REQUEST_ID,
      timestamp: "2026-08-11T15:16:00.000Z",
      simulate: vi.fn(async () => serverResult())
    }))).rejects.toMatchObject({
      code: "server_simulation_receipt_unusable",
      definitive: true,
      requestId: ""
    });

    await expect(prepareAmbientPricingPreview(firebaseInput({
      requestId: REQUEST_ID,
      simulate: vi.fn(async () => serverResult({ baseRevisionId: "v0011" }))
    }))).rejects.toMatchObject({
      code: "server_simulation_revision_changed",
      definitive: true,
      requestId: ""
    });

    await expect(prepareAmbientPricingPreview(firebaseInput({
      requestId: REQUEST_ID,
      simulate: vi.fn(async () => serverResult({ beforeGuests: 90, afterGuests: 130 }))
    }))).rejects.toMatchObject({
      code: "server_simulation_fact_mismatch",
      definitive: true,
      requestId: ""
    });
  });
});

describe("Ambient pricing margin context", () => {
  const currentForm = {
    ...quoteCalculationCatalog.settings,
    guests: 100,
    hours: 0,
    servers: 0,
    chefs: 0,
    bartenders: 0,
    pkg: "basic",
    addons: [],
    rentals: [],
    menuItems: [],
    milesRT: 0,
    taxRegion: "local",
    seasonProfileId: "standard"
  };
  const proposedForm = { ...currentForm, guests: 130 };

  test("normalizes complete client cost evidence and exact margin deltas", () => {
    const result = buildAmbientPricingMarginContext({
      previewKind: "client_calculation",
      currentForm,
      proposedForm,
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      evaluateMargin: canonicalMargin
    });

    expect(result).toMatchObject({
      schemaVersion: AMBIENT_PRICING_MARGIN_CONTEXT_SCHEMA_VERSION,
      status: "available",
      authority: "advisory_client_cost_context",
      current: { marginPct: 0.4, target: 0.45 },
      proposed: { marginPct: 0.4, target: 0.45 },
      deltas: { marginPoints: 0 },
      missing: [],
      unavailableReasons: [],
      boundary: AMBIENT_PRICING_MARGIN_BOUNDARY
    });
    expect(result.deltas.revenue).toBeGreaterThan(0);
    expect(result.deltas.cost).toBeGreaterThan(0);
    expect(Object.isFrozen(result.current.targetGap)).toBe(true);
  });

  test("fails closed on missing, thrown, or internally inconsistent cost evidence", () => {
    const missing = buildAmbientPricingMarginContext({
      previewKind: "client_calculation",
      currentForm,
      proposedForm,
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      evaluateMargin: () => ({
        available: false,
        missing: ["Classic package (costPpp)"],
        note: "Cost missing."
      })
    });
    expect(missing).toMatchObject({
      status: "unavailable",
      current: null,
      proposed: null,
      deltas: null,
      missing: ["Classic package (costPpp)"]
    });

    const thrown = buildAmbientPricingMarginContext({
      previewKind: "client_calculation",
      currentForm,
      proposedForm,
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      evaluateMargin: () => {
        throw new Error("cost service unavailable");
      }
    });
    expect(thrown).toMatchObject({ status: "unavailable", current: null, proposed: null });

    const inconsistent = buildAmbientPricingMarginContext({
      previewKind: "client_calculation",
      currentForm,
      proposedForm,
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      evaluateMargin: () => ({
        available: true,
        revenue: 1_000,
        cost: 600,
        marginPct: 0.9,
        target: 0.5
      })
    });
    expect(inconsistent).toMatchObject({ status: "unavailable", current: null, proposed: null });
  });

  test("never invokes a client cost evaluator for a server preview", () => {
    const evaluateMargin = vi.fn(canonicalMargin);
    const result = buildAmbientPricingMarginContext({
      previewKind: "server_simulation",
      currentForm,
      proposedForm,
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      evaluateMargin
    });

    expect(result).toMatchObject({
      status: "unavailable",
      current: null,
      proposed: null,
      unavailableReasons: [expect.stringContaining("Connected pricing")]
    });
    expect(evaluateMargin).not.toHaveBeenCalled();
  });

  test("exports contextual errors without mutating the original cause", () => {
    const cause = new Error("original");
    const error = new AmbientPricingPreviewError("uncertain", "Retry exact request.", {
      requestId: REQUEST_ID,
      definitive: false,
      cause
    });

    expect(error).toMatchObject({
      name: "AmbientPricingPreviewError",
      code: "uncertain",
      userMessage: "Retry exact request.",
      requestId: REQUEST_ID,
      definitive: false
    });
    expect(error.cause).toBe(cause);
    expect(cause).toEqual(new Error("original"));
  });
});

describe("saved Pricing inspector margin", () => {
  test("prefers the saved commercial snapshot when it exists on the quote", () => {
    const result = buildSavedAmbientPricingMargin({
      organizationId: ORGANIZATION_ID,
      quote: quote({
        totals: {
          base: 1_200,
          addons: 200,
          rentals: 100,
          menu: 150,
          labor: 300,
          serviceFee: 120,
          total: 2_090,
          deposit: 500
        },
        pricing: {
          authority: "server_authoritative",
          commercialSnapshot: {
            version: "commercial-snapshot-v1",
            guestCount: 100,
            targetMarginPct: 0.45,
            package: {
              id: "basic",
              name: "Basic",
              unitCostPpp: 9,
              extendedCost: 900,
              missingReason: ""
            },
            addons: [],
            rentals: [],
            menuItems: [],
            staffing: {
              enabled: true,
              roles: [
                { id: "servers", label: "serverCostRate", count: 5, extendedCost: 250, missingReason: "" },
                { id: "chefs", label: "chefCostRate", count: 2, extendedCost: 180, missingReason: "" },
                { id: "bartenders", label: "bartenderCostRate", count: 1, extendedCost: 45, missingReason: "" }
              ]
            }
          }
        }
      })
    });

    expect(result).toMatchObject({
      modelId: AMBIENT_SAVED_PRICING_MARGIN_MODEL,
      available: true,
      revenue: 2_070,
      cost: 1_375,
      target: 0.45,
      evidenceAuthority: "advisory_saved_cost_snapshot",
      sourceLabel: AMBIENT_SAVED_PRICING_MARGIN_SNAPSHOT_SOURCE_LABEL,
      sourceRevisionId: BASE_REVISION_ID,
      boundary: AMBIENT_PRICING_MARGIN_BOUNDARY
    });
    expect(result.marginPct).toBeCloseTo((2070 - 1375) / 2070, 9);
  });

  test("hydrates the exact saved form and preserves the canonical margin-presentation shape", () => {
    const evaluateMargin = vi.fn(({ totals }) => {
      const evaluated = canonicalMargin({ totals });
      return {
        modelId: AMBIENT_SAVED_PRICING_MARGIN_MODEL,
        ...evaluated,
        targetNote: "5.0 points below your 45% target.",
        note: "Margin on the current tenant catalog cost context."
      };
    });

    const result = buildSavedAmbientPricingMargin({
      organizationId: ORGANIZATION_ID,
      quote: quote(),
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      evaluateMargin
    });

    expect(evaluateMargin).toHaveBeenCalledTimes(1);
    expect(evaluateMargin.mock.calls[0][0]).toMatchObject({
      form: {
        guests: 100,
        pkg: "basic",
        servers: 5,
        chefs: 2,
        bartenders: 1
      },
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings
    });
    expect(result).toMatchObject({
      modelId: AMBIENT_SAVED_PRICING_MARGIN_MODEL,
      available: true,
      marginPct: 0.4,
      target: 0.45,
      targetNote: "5.0 points below your 45% target.",
      evidenceAuthority: "advisory_current_catalog_cost_context",
      sourceLabel: AMBIENT_SAVED_PRICING_MARGIN_SOURCE_LABEL,
      sourceRevisionId: BASE_REVISION_ID,
      boundary: AMBIENT_PRICING_MARGIN_BOUNDARY
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("preserves explicit missing-cost evidence in an existing unavailable shape", () => {
    const result = buildSavedAmbientPricingMargin({
      organizationId: ORGANIZATION_ID,
      quote: quote(),
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      evaluateMargin: () => ({
        modelId: AMBIENT_SAVED_PRICING_MARGIN_MODEL,
        available: false,
        missingCount: 7,
        missing: ["Basic (costPpp)", "Settings (serverCostRate)"],
        note: "Margins unavailable — record costs to unlock them."
      })
    });

    expect(result).toMatchObject({
      modelId: AMBIENT_SAVED_PRICING_MARGIN_MODEL,
      available: false,
      missingCount: 7,
      missing: ["Basic (costPpp)", "Settings (serverCostRate)"],
      note: "Margins unavailable — record costs to unlock them.",
      evidenceCode: "cost_evidence_incomplete",
      evidenceAuthority: "advisory_current_catalog_cost_context",
      sourceLabel: AMBIENT_SAVED_PRICING_MARGIN_SOURCE_LABEL,
      boundary: AMBIENT_PRICING_MARGIN_BOUNDARY
    });
  });

  test.each([
    [
      "missing organization",
      { organizationId: "" },
      "organization_scope_missing",
      "organization scope"
    ],
    [
      "cross-tenant quote",
      { quote: quote({ organizationId: "org-other" }) },
      "organization_scope_mismatch",
      "does not belong"
    ],
    [
      "missing saved package",
      { quote: quote({ selection: { packageId: "missing" } }) },
      "saved_package_evidence_missing",
      "package is absent"
    ],
    [
      "saved pricing disagreement",
      { quote: quote({ pricing: { inputs: { event: { guests: 90 } } } }) },
      "saved_pricing_scope_mismatch",
      "show different guest counts"
    ]
  ])("fails closed for %s", (_label, overrides, code, note) => {
    const evaluateMargin = vi.fn(canonicalMargin);
    const result = buildSavedAmbientPricingMargin({
      organizationId: ORGANIZATION_ID,
      quote: quote(),
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      evaluateMargin,
      ...overrides
    });

    expect(result).toMatchObject({
      available: false,
      evidenceCode: code,
      evidenceAuthority: "advisory_current_catalog_cost_context"
    });
    expect(result.note).toMatch(new RegExp(note, "i"));
    expect(evaluateMargin).not.toHaveBeenCalled();
  });

  test("fails closed when evaluation throws or returns inconsistent evidence", () => {
    const thrown = buildSavedAmbientPricingMargin({
      organizationId: ORGANIZATION_ID,
      quote: quote(),
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      evaluateMargin: () => {
        throw new Error("not loaded");
      }
    });
    expect(thrown).toMatchObject({
      available: false,
      evidenceCode: "margin_evaluation_failed"
    });

    const inconsistent = buildSavedAmbientPricingMargin({
      organizationId: ORGANIZATION_ID,
      quote: quote(),
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      evaluateMargin: () => ({
        available: true,
        revenue: 1_000,
        cost: 600,
        marginPct: 0.95,
        target: 0.4
      })
    });
    expect(inconsistent).toMatchObject({
      available: false,
      evidenceCode: "margin_evidence_inconsistent"
    });
  });
});
