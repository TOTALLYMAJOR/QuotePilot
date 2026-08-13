import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createAmbientSignal } from "../ambientContracts";
import { buildProposalReadiness, buildWorkflowAttentionSummary } from "../quoteWorkflow";
import { buildUpsellRecommendations } from "../recommendations";
import { buildCascadePresentation } from "../../components/cascadePresentation";
import { parseChangeRequest } from "../../components/changeRequestParse";
import { buildMarginPresentation } from "../../components/marginPresentation";
import {
  AMBIENT_SIGNAL_NORMALIZATION_BOUNDS,
  AMBIENT_SIGNAL_NORMALIZATION_MODEL,
  normalizeAmbientSignals,
  normalizeCascadeSignals,
  normalizeChangeRequestSignals,
  normalizeCommercialDependencySignals,
  normalizeDecisionDebtSignals,
  normalizeGuidedSellingSignals,
  normalizeMarginSignals,
  normalizeNowAttentionSignals,
  normalizeProposalCompletenessSignals
} from "../ambientSignals";

const UNKNOWN_FRESHNESS = {
  state: "unknown",
  reason: "Fixture does not assert freshness."
};

function proposalReadiness(overrides = {}) {
  const criteria = [
    { id: "customer", label: "Customer", points: 40, passed: true },
    { id: "event", label: "Event", points: 32, passed: true },
    { id: "menu", label: "Menu", points: 28, passed: false }
  ];
  return {
    score: 72,
    status: { id: "needs_details", label: "Needs details" },
    criteria,
    gaps: [criteria[2]],
    complete: false,
    ...overrides
  };
}

function debtItem(overrides = {}) {
  return {
    id: `debt_${"a".repeat(40)}`,
    quoteId: "quote-a",
    sourceRevisionId: "v0014",
    decisionId: "guest-count-final",
    label: "Final guest count",
    resolutionState: "unresolved",
    daysUntilLock: 0,
    affectedNodeIds: ["artifact.kitchen_beo", "output.authoritative_total"],
    affectedDependencyCount: 2,
    commercialExposureCents: 2500001,
    scoreState: "KNOWN",
    score: 60,
    rawScore: 375,
    urgency: "high",
    ...overrides
  };
}

function debtSnapshot(items = [debtItem()], overrides = {}) {
  return {
    schemaVersion: "decision-debt-snapshot-v1",
    formulaVersion: "decision-debt-score-v1",
    authority: "server_derived",
    predictive: false,
    observedAtISO: "2026-08-11T14:00:00.000Z",
    graph: {
      graphId: "quotepilot-commercial",
      graphVersion: "commercial-dependency-graph-v1"
    },
    bounds: {
      returnedCount: items.length,
      eligibleCount: items.length,
      truncated: false
    },
    items,
    snapshotDigest: "f".repeat(64),
    ...overrides
  };
}

function cascade(overrides = {}) {
  return {
    modelId: "cascade-receipts-v1",
    applicable: true,
    status: "accepted",
    steps: [
      {
        id: "accepted",
        state: "done",
        label: "Proposal accepted",
        detail: "Acceptance receipt rec_123 is on file.",
        timeLabel: "Aug 11, 2026"
      },
      {
        id: "deposit-paid",
        state: "pending",
        label: "Deposit paid",
        detail: "Awaiting the provider's signed payment confirmation.",
        timeLabel: ""
      }
    ],
    boundsNote: "Each step reports only the evidence recorded on this quote.",
    ...overrides
  };
}

function dependencyImpact(nodes = [{
  id: "artifact.kitchen_beo",
  kind: "artifact",
  label: "Kitchen BEO",
  advisoryClass: "STALE"
}]) {
  return {
    schemaVersion: "commercial-change-impact-v1",
    advisory: true,
    identity: {
      organizationId: "org-a",
      quoteId: "quote-a",
      beforeRevisionId: "v0014",
      proposedRevisionId: "preview-v0015"
    },
    sources: {
      before: { authority: "server_authoritative", label: "canonical_quote_revision" },
      proposedAfter: { authority: "server_authoritative", label: "authoritative_proposed_revision" }
    },
    graph: {
      graphId: "quotepilot-commercial",
      graphVersion: "commercial-dependency-graph-v1"
    },
    impact: {
      rootNodeIds: ["fact.event.guest_count"],
      dependentNodes: nodes,
      counts: {
        total: nodes.length,
        review: nodes.filter((node) => node.advisoryClass === "REVIEW").length,
        stale: nodes.filter((node) => node.advisoryClass === "STALE").length
      }
    },
    boundary: "Read-only advisory simulation; no mutation, invalidation, regeneration, or publication occurs."
  };
}

function expectCanonical(signal) {
  expect(createAmbientSignal(signal)).toEqual(signal);
  expect(Object.isFrozen(signal)).toBe(true);
  if (signal.evidence.length > 0) expect(Object.isFrozen(signal.evidence[0])).toBe(true);
}

describe("AmbientSignal normalization kernel", () => {
  test("accepts the existing deterministic QuotePilot builders without reshaping their outputs first", () => {
    const form = {
      guests: 120,
      hours: 5,
      pkg: "base",
      addons: [],
      rentals: [],
      menuItems: [],
      addonQuantities: {},
      rentalQuantities: {},
      menuItemQuantities: {},
      servers: 0,
      chefs: 0,
      bartenders: 0
    };
    const catalog = {
      packages: [{ id: "base", name: "Base", ppp: 20, costPpp: 10 }],
      addons: [{ id: "coffee", name: "Coffee service", price: 2, pricingType: "per_person" }],
      rentals: [],
      settings: { menuSections: [] }
    };
    const settings = {
      guidedSellingEnabled: true,
      upsellRules: [{
        id: "coffee-rule",
        enabled: true,
        kind: "addon",
        targetId: "coffee",
        minGuests: 100,
        reason: "Guest threshold matched."
      }],
      staffingLaborEnabled: false,
      targetMarginPct: 0.3
    };
    const totals = {
      total: 2400,
      deposit: 720,
      base: 2400,
      addons: 0,
      rentals: 0,
      menu: 0,
      labor: 0,
      serviceFee: 0,
      addonMultiplier: 1,
      rentalMultiplier: 1,
      packageMultiplier: 1
    };
    const quote = {
      id: "quote-real-shape",
      status: "draft",
      customer: { name: "Avery", email: "avery@example.test", phone: "555-0100" },
      event: {
        name: "Wedding",
        date: "2026-08-18",
        time: "16:00",
        venue: "The Glass House",
        guests: 120,
        hours: 5
      },
      selection: { packageId: "base", menuItems: ["salad"] },
      totals,
      workflow: { followUp: { dueDate: "2026-08-11", completed: false, stage: "contacted" } }
    };
    const attention = buildWorkflowAttentionSummary([quote], { todayISO: "2026-08-11" });
    const readiness = buildProposalReadiness(quote);
    const recommendations = buildUpsellRecommendations({ form, catalog, totals, settings });
    const margin = buildMarginPresentation({ form, totals, catalog, settings });
    const changeRequest = parseChangeRequest("Please add coffee service", { form, catalog });
    const cascadeSource = buildCascadePresentation({
      ...quote,
      status: "accepted",
      lifecycle: { acceptedAtISO: "2026-08-11T14:00:00.000Z" },
      activeVersionId: "v0014",
      acceptanceReceipt: { receiptId: "receipt-a" }
    });

    const signals = normalizeAmbientSignals({
      nowAttention: attention,
      proposalCompleteness: readiness,
      guidedSelling: recommendations,
      margin,
      changeRequest,
      cascade: cascadeSource
    }, Object.fromEntries(
      ["nowAttention", "proposalCompleteness", "guidedSelling", "margin", "changeRequest", "cascade"]
        .map((key) => [key, { freshness: UNKNOWN_FRESHNESS }])
    ));

    expect(signals.length).toBeGreaterThan(6);
    expect(signals.every((signal) => signal.availability.state !== "unavailable")).toBe(true);
    expect(signals.some((signal) => signal.evidence[0]?.metric === "proposal_completeness")).toBe(true);
    expect(signals.some((signal) => signal.evidence[0]?.recommendationKey === "coffee-rule-addon-coffee")).toBe(true);
  });

  test("keeps every adapter pure, canonical, and aggregate output deeply frozen", () => {
    const signals = normalizeAmbientSignals({
      nowAttention: {
        itemCount: 1,
        items: [{
          id: "follow-up:q1",
          type: "follow_up",
          state: "overdue",
          quoteId: "q1",
          dateISO: "2026-08-10",
          daysOverdue: 1
        }]
      },
      proposalCompleteness: proposalReadiness(),
      guidedSelling: [{
        key: "rule-addon-coffee",
        kind: "addon",
        id: "coffee",
        label: "Add coffee service",
        reason: "Evening event rule matched.",
        impact: "~$180.00 impact"
      }],
      margin: {
        available: true,
        revenue: 1000,
        cost: 720,
        marginPct: 0.28,
        target: 0.3
      },
      decisionDebt: { snapshot: debtSnapshot(), stale: false },
      changeRequest: {
        modelId: "change-request-parse-v1",
        message: "Please add a server.",
        proposals: [{
          id: "staff-0",
          kind: "add_staff",
          title: "Add 1 server",
          clause: "Please add a server",
          field: "servers",
          count: 1
        }],
        ambiguities: [],
        unparsedClauses: []
      },
      cascade: cascade(),
      commercialDependency: dependencyImpact()
    }, {
      nowAttention: { freshness: UNKNOWN_FRESHNESS },
      proposalCompleteness: { freshness: UNKNOWN_FRESHNESS },
      guidedSelling: { freshness: UNKNOWN_FRESHNESS },
      margin: { freshness: UNKNOWN_FRESHNESS },
      changeRequest: { freshness: UNKNOWN_FRESHNESS },
      cascade: { freshness: UNKNOWN_FRESHNESS },
      commercialDependency: { freshness: UNKNOWN_FRESHNESS }
    });

    expect(signals).toHaveLength(9);
    expect(Object.isFrozen(signals)).toBe(true);
    signals.forEach(expectCanonical);
    expect(signals.every((signal) => signal.resolutionActionIds.length > 0)).toBe(true);
  });

  test("imports no Firebase, provider, client, network, or model runtime", () => {
    const source = readFileSync(new URL("../ambientSignals.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/firebase|httpsCallable|fetch\s*\(|XMLHttpRequest|WebSocket|openai|anthropic/iu);
    expect(source).toContain('import { createAmbientSignal } from "./ambientContracts"');
  });
});

describe("NOW attention adapter", () => {
  test("preserves exact item state without inferring customer delivery or engagement", () => {
    const [signal] = normalizeNowAttentionSignals({
      itemCount: 1,
      items: [{
        id: "unread-reply:attention-a",
        type: "unread_customer_reply",
        state: "open",
        quoteId: "quote-a",
        dateISO: "2026-08-11T13:00:00.000Z",
        sourceRequestId: "attention-a"
      }]
    }, { freshness: UNKNOWN_FRESHNESS });

    expect(signal).toMatchObject({
      id: "now-attention:unread-reply:attention-a",
      claim: "A customer reply is waiting for staff review.",
      severity: "attention",
      availability: { state: "available" }
    });
    expect(signal.consequence).toContain("does not establish delivery, read receipt, presence, or response intent");
    expect(signal.evidence[0]).toMatchObject({
      type: "unread_customer_reply",
      state: "open",
      quoteId: "quote-a",
      provenance: { source: "workflow_attention_summary" }
    });
  });

  test("keeps stale and truncated dimensions explicit at the same time", () => {
    const [signal] = normalizeNowAttentionSignals({
      itemCount: 2,
      items: [{
        id: "follow-up:q1",
        type: "follow_up",
        state: "overdue",
        quoteId: "q1",
        daysOverdue: 3
      }],
      stale: true,
      observedAtISO: "2026-08-10T14:00:00.000Z"
    });

    expect(signal.availability.state).toBe("stale");
    expect(signal.freshness.state).toBe("stale");
    expect(signal.evidence[0].provenance.quality).toEqual({
      stale: true,
      truncated: true,
      partial: false
    });
  });

  test("uses a bounded caught-up claim without implying operational completion", () => {
    const [signal] = normalizeNowAttentionSignals(
      { itemCount: 0, items: [] },
      { freshness: UNKNOWN_FRESHNESS }
    );
    expect(signal.id).toBe("now-attention:caught-up");
    expect(signal.claim).toContain("No tracked Workflow attention");
    expect(signal.evidence[0].doNothing).toContain("not an operational-completion claim");
  });

  test("bounds excess items and fails closed on malformed evidence", () => {
    const items = Array.from({ length: AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.attentionItems + 1 }, (_, index) => ({
      id: `follow-up:q${index}`,
      type: "follow_up",
      state: "due_today",
      quoteId: `q${index}`
    }));
    const bounded = normalizeNowAttentionSignals(
      { itemCount: items.length, items },
      { freshness: UNKNOWN_FRESHNESS }
    );
    expect(bounded).toHaveLength(AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.attentionItems);
    expect(bounded.every((signal) => signal.availability.state === "truncated")).toBe(true);

    const [invalid] = normalizeNowAttentionSignals({ itemCount: 1, items: [{ type: "made_up" }] });
    expect(invalid.availability.state).toBe("unavailable");
    expect(invalid.availability.reason).toContain("unsupported_attention");
    expect(invalid.evidence).toEqual([]);
  });
});

describe("proposal completeness adapter", () => {
  test("retains the existing percentage only as proposal completeness", () => {
    const [signal] = normalizeProposalCompletenessSignals(
      proposalReadiness(),
      { freshness: UNKNOWN_FRESHNESS }
    );
    expect(signal.claim).toBe("The proposal is 72% complete; 1 criterion remains.");
    expect(signal.evidence[0]).toMatchObject({
      metric: "proposal_completeness",
      completenessPercent: 72,
      provenance: { scope: "proposal_only" }
    });
    expect(signal.consequence).toContain("no event-wide readiness score is implied");
    expect(JSON.stringify(signal.evidence[0])).not.toMatch(/eventReadiness|blended/iu);
  });

  test("fails closed when score, criteria, gaps, or completion disagree", () => {
    const [signal] = normalizeProposalCompletenessSignals(proposalReadiness({ score: 80 }));
    expect(signal.availability.state).toBe("unavailable");
    expect(signal.availability.reason).toContain("inconsistent_completeness");
  });
});

describe("guided-selling adapter", () => {
  test("keeps recommendations advisory through staging and authoritative save", () => {
    const [signal] = normalizeGuidedSellingSignals([{
      key: "rule-package-premium",
      kind: "package",
      id: "premium",
      label: "Upgrade to Premium",
      reason: "Guest threshold matched this quote.",
      impact: "~$960.00 impact"
    }], { freshness: UNKNOWN_FRESHNESS });

    expect(signal.claim).toBe("Upgrade to Premium");
    expect(signal.evidence[0]).toMatchObject({
      kind: "package",
      targetId: "premium",
      basis: "Guest threshold matched this quote.",
      impact: "~$960.00 impact"
    });
    expect(signal.consequence).toContain("trusted save path still re-prices");
  });

  test("does not mistake disabled guidance for a healthy empty state", () => {
    const [signal] = normalizeGuidedSellingSignals({ enabled: false, recommendations: [] });
    expect(signal.availability.state).toBe("unavailable");
    expect(signal.availability.reason).toContain("disabled");
  });

  test("marks a source beyond the existing four-recommendation bound as truncated", () => {
    const recommendations = Array.from({ length: 5 }, (_, index) => ({
      key: `rule-addon-${index}`,
      kind: "addon",
      id: `addon-${index}`,
      label: `Add item ${index}`,
      reason: "Rule matched.",
      impact: "No pricing impact"
    }));
    const signals = normalizeGuidedSellingSignals(recommendations, { freshness: UNKNOWN_FRESHNESS });
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.availability.state === "truncated")).toBe(true);
  });
});

describe("margin adapter", () => {
  test("uses exact recorded-cost math and exposes a target gap without changing price", () => {
    const [signal] = normalizeMarginSignals({
      available: true,
      revenue: 1000,
      cost: 720,
      marginPct: 0.28,
      target: 0.3
    }, { freshness: UNKNOWN_FRESHNESS });

    expect(signal).toMatchObject({ severity: "warning", availability: { state: "available" } });
    expect(signal.claim).toContain("28.0%");
    expect(signal.evidence[0]).toMatchObject({
      revenue: 1000,
      cost: 720,
      marginPct: 0.28,
      target: 0.3,
      audience: "staff_only"
    });
    expect(signal.evidence[0].exclusions).toEqual(["travel", "tax"]);
    expect(signal.consequence).toContain("no price change is automatic");
  });

  test("preserves missing cost coverage as unavailable instead of estimating", () => {
    const [signal] = normalizeMarginSignals({
      available: false,
      missingCount: 2,
      missing: ["Premium package (costPpp)", "Settings (serverCostRate)"]
    }, { freshness: UNKNOWN_FRESHNESS });
    expect(signal.availability.state).toBe("unavailable");
    expect(signal.evidence[0].missingCount).toBe(2);
    expect(signal.evidence[0].doNothing).toContain("No cost is estimated");
  });

  test("fails closed on internally inconsistent margin math", () => {
    const [signal] = normalizeMarginSignals({
      available: true,
      revenue: 1000,
      cost: 700,
      marginPct: 0.5,
      target: null
    });
    expect(signal.availability.state).toBe("unavailable");
    expect(signal.availability.reason).toContain("margin_formula");
  });
});

describe("Decision Debt adapter", () => {
  test("preserves server-derived, non-predictive known priority and dependency evidence", () => {
    const [signal] = normalizeDecisionDebtSignals({ snapshot: debtSnapshot(), stale: false });
    expect(signal).toMatchObject({
      severity: "warning",
      availability: { state: "available" },
      freshness: { state: "fresh", observedAt: "2026-08-11T14:00:00.000Z" }
    });
    expect(signal.claim).toContain("high deterministic priority");
    expect(signal.evidence[0]).toMatchObject({
      scoreState: "KNOWN",
      score: 60,
      urgency: "high",
      affectedDependencyCount: 2,
      provenance: {
        authority: "server_derived_non_predictive",
        predictive: false
      }
    });
  });

  test("keeps unknown exposure and priority partial without inventing zero or urgency", () => {
    const unknown = debtItem({
      commercialExposureCents: null,
      scoreState: "UNKNOWN",
      score: null,
      rawScore: null,
      urgency: null
    });
    const [signal] = normalizeDecisionDebtSignals({ snapshot: debtSnapshot([unknown]), stale: false });
    expect(signal.availability.state).toBe("partial");
    expect(signal.claim).toContain("priority is unavailable");
    expect(signal.evidence[0]).toMatchObject({
      commercialExposureCents: null,
      scoreState: "UNKNOWN"
    });
    expect(signal.evidence[0]).not.toHaveProperty("score");
    expect(signal.evidence[0]).not.toHaveProperty("urgency");
  });

  test("preserves stale retained evidence plus source truncation explicitly", () => {
    const [signal] = normalizeDecisionDebtSignals({
      snapshot: debtSnapshot([debtItem()], {
        bounds: { returnedCount: 1, eligibleCount: 2, truncated: true }
      }),
      stale: true
    });
    expect(signal.availability.state).toBe("stale");
    expect(signal.freshness.state).toBe("stale");
    expect(signal.evidence[0].provenance.quality.truncated).toBe(true);
  });

  test("rejects predictive, malformed, pending, and errored authority shapes", () => {
    for (const source of [
      { snapshot: debtSnapshot([], { predictive: true }) },
      { loading: true },
      { error: "read failed" }
    ]) {
      const [signal] = normalizeDecisionDebtSignals(source);
      expect(signal.availability.state).toBe("unavailable");
      expect(signal.evidence).toEqual([]);
    }
  });
});

describe("change-request adapter", () => {
  test("keeps ambiguous and unread clauses explicit and performs no staging", () => {
    const [signal] = normalizeChangeRequestSignals({
      modelId: "change-request-parse-v1",
      message: "Swap chicken for salad and surprise us.",
      proposals: [],
      ambiguities: [{
        id: "choice-0",
        clause: "Swap chicken for salad",
        verb: "add",
        query: "salad",
        candidates: [
          { itemType: "menuItems", itemId: "garden", itemName: "Garden salad" },
          { itemType: "menuItems", itemId: "caesar", itemName: "Caesar salad" }
        ]
      }],
      unparsedClauses: ["surprise us"]
    }, { freshness: UNKNOWN_FRESHNESS });

    expect(signal.availability.state).toBe("partial");
    expect(signal.claim).toContain("needs clarification");
    expect(signal.evidence[0]).toMatchObject({
      ambiguities: [{ verb: "add", query: "salad" }],
      unparsedClauses: ["surprise us"]
    });
    expect(signal.consequence).toContain("no meaning is guessed");
    expect(signal.evidence[0].doNothing).toContain("draft remain unchanged");
  });

  test("describes deterministic proposals as previewable, never already applied", () => {
    const [signal] = normalizeChangeRequestSignals({
      modelId: "change-request-parse-v1",
      message: "Make it 130 guests.",
      proposals: [{
        id: "guests-0",
        kind: "set_guests",
        title: "Guest count → 130",
        clause: "Make it 130 guests",
        value: 130
      }],
      ambiguities: [],
      unparsedClauses: []
    }, { freshness: UNKNOWN_FRESHNESS });
    expect(signal.claim).toContain("can be previewed before staging");
    expect(signal.consequence).toContain("explicit staging");
    expect(signal.consequence).toContain("trusted save");
  });

  test("normalizes an exact package proposal without broadening its draft-only authority", () => {
    const [signal] = normalizeChangeRequestSignals({
      modelId: "change-request-parse-v1",
      message: "Switch package to Premium.",
      proposals: [{
        id: "package-0",
        kind: "set_package",
        title: "Package → Premium",
        clause: "Switch package to Premium",
        value: "premium",
        packageId: "premium",
        packageName: "Premium"
      }],
      ambiguities: [],
      unparsedClauses: []
    }, { freshness: UNKNOWN_FRESHNESS });
    expect(signal.evidence[0].proposals[0]).toMatchObject({
      kind: "set_package",
      value: "premium",
      packageId: "premium",
      packageName: "Premium"
    });
    expect(signal.claim).toContain("previewed before staging");
    expect(signal.consequence).toContain("trusted save");
  });
});

describe("cascade and commercial dependency adapters", () => {
  test("keeps each cascade evidence domain separate", () => {
    const signals = normalizeCascadeSignals(cascade(), { freshness: UNKNOWN_FRESHNESS });
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({
      id: "cascade:accepted",
      severity: "info",
      evidence: [{ state: "done" }]
    });
    expect(signals[0].consequence).toContain("only this recorded step");
    expect(signals[1]).toMatchObject({
      id: "cascade:deposit-paid",
      severity: "attention",
      evidence: [{ state: "pending" }]
    });
    expect(signals[1].consequence).toContain("No completion, provider, payment, booking, or readiness evidence is inferred");
  });

  test("does not manufacture cascade evidence before the source says it applies", () => {
    const [signal] = normalizeCascadeSignals(cascade({ applicable: false, steps: [] }));
    expect(signal.availability.state).toBe("unavailable");
    expect(signal.availability.reason).toContain("does not apply");
  });

  test("keeps dependency STALE as an advisory class rather than actual freshness", () => {
    const [signal] = normalizeCommercialDependencySignals(
      dependencyImpact(),
      { freshness: UNKNOWN_FRESHNESS }
    );
    expect(signal.claim).toContain("classified STALE by the read-only dependency simulation");
    expect(signal.availability.state).toBe("available");
    expect(signal.freshness.state).toBe("unknown");
    expect(signal.evidence[0]).toMatchObject({
      advisoryClass: "STALE",
      provenance: { authority: "server_authoritative_inputs_advisory_projection" }
    });
    expect(signal.consequence).toContain("does not establish actual freshness");
  });

  test("rejects dependency count drift and unsupported authority", () => {
    const malformed = dependencyImpact();
    malformed.impact.counts.total = 2;
    const [signal] = normalizeCommercialDependencySignals(malformed);
    expect(signal.availability.state).toBe("unavailable");
    expect(signal.availability.reason).toContain("dependency_bounds");
  });
});
