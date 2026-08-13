import { describe, expect, test } from "vitest";

import {
  AmbientContractError,
  createAmbientAction,
  createAmbientActionResult,
  createAmbientCapabilityManifest,
  createAmbientContextSnapshot,
  createAmbientSignal,
  createImpactPreview,
  createIntelligentObjectDescriptor,
  createOpportunityMomentum,
  createSecurityDenialResult,
  createSurfacePurposeContract,
  evaluateAmbientCapability,
  rankAmbientNextActions
} from "../ambientContracts.js";

const opportunityObject = Object.freeze({
  id: "quote-42",
  type: "opportunity",
  label: "Nguyen wedding"
});

const availableProvenance = Object.freeze({
  sourceId: "quote-revision-7",
  label: "Saved quote revision 7",
  type: "recorded",
  state: "available",
  observedAt: "2026-08-11T15:00:00.000Z"
});

function validAction(overrides = {}) {
  return {
    id: "resolve-staffing",
    outcomeLabel: "Resolve staffing",
    purpose: "resolve",
    roles: ["admin", "sales"],
    authorityLevel: "draft",
    previewPolicy: "required",
    executionTarget: {
      kind: "context",
      targetId: "staffing-inspector",
      surfaceId: "living-opportunity"
    },
    receiptType: "preview",
    reversibility: { kind: "undo", actionId: "undo-staffing", windowMs: 10_000 },
    arrivalContract: {
      object: opportunityObject,
      reason: "Staffing is below the recorded house ratio.",
      consequence: "The proposal cannot be prepared until staffing is reviewed.",
      nextResolutionIds: ["use-staffing-recommendation", "keep-current-staffing"]
    },
    primary: true,
    enabled: true,
    ...overrides
  };
}

function momentumDomains() {
  return {
    proposal: {
      state: "attention",
      summary: "Proposal is missing staffing confirmation.",
      evidence: [{ source: "proposal-readiness", missing: ["staffing"] }],
      completenessPercent: 72
    },
    commercial: {
      state: "healthy",
      summary: "Recorded cost coverage supports the target margin.",
      evidence: [{ source: "recorded-costs", state: "complete" }]
    },
    customer: {
      state: "attention",
      summary: "The customer asked for a guest-count change.",
      evidence: [{ source: "customer-message", messageId: "message-1" }]
    },
    operational: {
      state: "blocked",
      summary: "A staff lead is not assigned.",
      evidence: [{ source: "staffing-receipt", leadAssigned: false }]
    }
  };
}

function nextActionCandidate(id, overrides = {}) {
  return {
    id,
    label: `Resolve ${id}`,
    category: "proposal_gap",
    severity: "attention",
    object: opportunityObject,
    reason: "A recorded proposal requirement is incomplete.",
    consequence: "The customer-ready proposal remains blocked.",
    resolutionActionId: `action-${id}`,
    dueAt: null,
    availability: "available",
    ...overrides
  };
}

describe("ambient contract builders", () => {
  test("creates a deeply immutable surface-purpose contract", () => {
    const contract = createSurfacePurposeContract({
      id: "living-opportunity",
      objectScopes: ["opportunity", "guest_count"],
      purposes: ["clarify", "resolve", "simulate"],
      entryReason: "The selected opportunity needs a decision.",
      allowedEmptyState: {
        kind: "caught_up",
        message: "This opportunity has no unresolved work."
      },
      recoveryBehavior: {
        message: "Keep the opportunity open and show a safe next step.",
        nextActionIds: ["review-opportunity"]
      }
    });

    expect(contract.allowedEmptyState).toEqual({
      kind: "caught_up",
      message: "This opportunity has no unresolved work.",
      actionId: null
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.recoveryBehavior.nextActionIds)).toBe(true);
  });

  test("rejects surfaces with no meaningful purpose or recovery", () => {
    expect(() => createSurfacePurposeContract({
      id: "generic-page",
      objectScopes: ["opportunity"],
      purposes: [],
      entryReason: "Open a page.",
      allowedEmptyState: null,
      recoveryBehavior: { message: "Try again.", nextActionIds: [] }
    })).toThrow(AmbientContractError);

    expect(() => createSurfacePurposeContract({
      id: "empty-modal",
      objectScopes: ["opportunity"],
      purposes: ["resolve"],
      entryReason: "Resolve the issue.",
      allowedEmptyState: { kind: "starting_action", message: "Start here." },
      recoveryBehavior: { message: "Return to the opportunity.", nextActionIds: ["return"] }
    })).toThrow(/actionId/);
  });

  test("normalizes complete context and rejects missing tenant context", () => {
    const snapshot = createAmbientContextSnapshot({
      organizationId: "org-1",
      role: "admin",
      route: "/app/quotes/quote-42",
      activeOpportunityId: "quote-42",
      selectedObject: opportunityObject,
      revision: 7,
      sourceFreshness: {
        state: "fresh",
        observedAt: "2026-08-11T15:00:00Z"
      },
      pendingPreview: null
    });

    expect(snapshot.sourceFreshness.observedAt).toBe("2026-08-11T15:00:00.000Z");
    expect(Object.isFrozen(snapshot.selectedObject)).toBe(true);
    expect(() => createAmbientContextSnapshot({
      ...snapshot,
      organizationId: ""
    })).toThrow(/organizationId/);
  });

  test("preserves unavailable signal evidence instead of manufacturing a claim", () => {
    const signal = createAmbientSignal({
      id: "margin-unavailable",
      claim: "Margin cannot be calculated from the recorded evidence.",
      evidence: [],
      availability: { state: "unavailable", reason: "Package cost is not recorded." },
      severity: "attention",
      consequence: "A margin recommendation would be unsupported.",
      freshness: { state: "unknown", reason: "There is no cost observation." },
      resolutionActionIds: ["record-package-cost"]
    });

    expect(signal.availability).toEqual({
      state: "unavailable",
      reason: "Package cost is not recorded."
    });
    expect(signal.evidence).toEqual([]);
    expect(() => createAmbientSignal({
      ...signal,
      availability: { state: "unavailable" }
    })).toThrow(/reason/);
    expect(() => createAmbientSignal({
      ...signal,
      availability: "available"
    })).toThrow(/evidence/);
  });

  test("requires exact action arrival context and receipts for high-authority work", () => {
    const action = createAmbientAction(validAction());

    expect(action.arrivalContract.object.id).toBe("quote-42");
    expect(Object.isFrozen(action.arrivalContract.nextResolutionIds)).toBe(true);
    expect(() => createAmbientAction(validAction({ arrivalContract: null }))).toThrow(/arrivalContract/);
    expect(() => createAmbientAction(validAction({
      authorityLevel: "trusted",
      receiptType: "none"
    }))).toThrow(/receipt/);
    expect(() => createAmbientAction(validAction({
      enabled: false,
      disabledReason: null
    }))).toThrow(/disabledReason/);
  });

  test("requires every result to carry consequence and a next resolution or caught-up state", () => {
    const result = createAmbientActionResult({
      kind: "preview",
      actionId: "resolve-staffing",
      object: opportunityObject,
      reason: "A supported staffing change was calculated.",
      consequence: "Using it would add two servers and $360.",
      nextResolutions: [
        { actionId: "use-staffing-recommendation", label: "Use recommendation" },
        { actionId: "keep-current-staffing", label: "Keep current" }
      ]
    });

    expect(result.nextResolutions[0].label).toBe("Use recommendation");
    expect(() => createAmbientActionResult({
      ...result,
      nextResolutions: []
    })).toThrow(/nextResolutions/);

    const caughtUp = createAmbientActionResult({
      kind: "resolved",
      actionId: "resolve-staffing",
      object: opportunityObject,
      reason: "Staffing is confirmed.",
      consequence: "There is no remaining staffing action.",
      nextResolutions: [],
      caughtUp: true
    });
    expect(caughtUp.caughtUp).toBe(true);
  });

  test("models a security denial as contextual recovery, not silent failure", () => {
    const denial = createSecurityDenialResult({
      actionId: "resolve-staffing",
      object: opportunityObject,
      reason: "This role cannot commit staffing changes.",
      consequence: "The draft remains unchanged.",
      nextResolutions: [
        { actionId: "review-read-only", label: "Review current staffing" },
        { actionId: "request-admin", label: "Request admin review" }
      ],
      requiredAuthority: "organization admin"
    });

    expect(denial.kind).toBe("recovery");
    expect(denial.payload).toEqual({
      recoveryType: "security_denial",
      requiredAuthority: "organization admin"
    });
  });

  test("requires why, consequence, do-nothing, confidence, and provenance on intelligent objects", () => {
    const descriptor = createIntelligentObjectDescriptor({
      id: "guest-count",
      type: "guest_count",
      label: "Guest count",
      summary: "120 guests",
      inspectorSurfaceId: "guest-count-inspector",
      dependencies: [{
        object: { id: "staffing", type: "staffing", label: "Staffing" },
        relationship: "House ratios scale staffing with guest count.",
        consequence: "A larger guest count may require additional servers."
      }],
      why: "The customer asked to move from 100 to 120 guests.",
      consequence: "The preview increases food, staffing, deposit, and total.",
      doNothing: "The proposal stays priced for 100 guests and conflicts with the request.",
      confidence: { level: "high", score: 0.98, basis: "The customer stated an exact count." },
      provenance: [availableProvenance],
      recommendation: {
        summary: "Preview 120 guests before staging the change.",
        actionId: "preview-guest-count"
      },
      permissions: {
        view: true,
        simulate: true,
        stage: true,
        commit: false,
        reason: "Saving remains a trusted quote action."
      },
      actionIds: ["preview-guest-count"]
    });

    expect(descriptor.doNothing).toContain("100 guests");
    expect(Object.isFrozen(descriptor.dependencies[0].object)).toBe(true);
    expect(() => createIntelligentObjectDescriptor({
      ...descriptor,
      doNothing: ""
    })).toThrow(/doNothing/);
    expect(() => createIntelligentObjectDescriptor({
      ...descriptor,
      confidence: { level: "unavailable", score: 0.5, basis: "No evidence." }
    })).toThrow(/score/);
  });

  test("keeps impact previews advisory and fails closed when effects are unavailable", () => {
    const preview = createImpactPreview({
      id: "guest-count-preview-1",
      object: opportunityObject,
      status: "unavailable",
      baseRevision: 7,
      source: {
        sourceId: "calculator-unavailable",
        label: "Client pricing preview",
        type: "calculated",
        state: "unavailable",
        reason: "The catalog revision is not loaded."
      },
      before: { guestCount: 100 },
      after: null,
      deltas: [],
      commercialDeltas: null,
      affectedDependencies: [],
      warnings: [],
      unavailableReasons: ["The current catalog revision is unavailable."]
    });

    expect(preview.authority).toBe("advisory");
    expect(preview).toMatchObject({
      schemaVersion: "ambient-impact-preview-v1",
      previewKind: "generic_advisory",
      evidenceAuthority: "advisory",
      provenance: [{ sourceId: "calculator-unavailable" }],
      freshness: null,
      confidence: null,
      why: null,
      consequence: null,
      doNothing: null,
      receipt: null
    });
    expect(preview.requiresAuthoritativeCommit).toBe(true);
    expect(() => createImpactPreview({
      ...preview,
      after: { guestCount: 120 }
    })).toThrow(/unavailable previews/);
  });

  test("requires explicit evidence metadata and receipt binding for specialized previews", () => {
    const base = {
      id: "server-preview",
      object: opportunityObject,
      previewKind: "server_simulation",
      evidenceAuthority: "server_authoritative",
      status: "available",
      baseRevision: "v0007",
      source: availableProvenance,
      freshness: { state: "fresh", observedAt: "2026-08-11T15:00:00.000Z" },
      confidence: { level: "high", basis: "Exact immutable simulation receipt." },
      why: "The customer requested a larger event.",
      consequence: "The exact commercial counterfactual is visible.",
      doNothing: "The canonical quote remains unchanged.",
      before: { guests: 100 },
      after: { guests: 120 },
      deltas: [{ field: "guests", before: 100, after: 120 }],
      commercialDeltas: { total: 2000 },
      affectedDependencies: [],
      warnings: [],
      unavailableReasons: []
    };

    expect(() => createImpactPreview(base)).toThrow(/receipt evidence/);
    expect(() => createImpactPreview({
      ...base,
      previewKind: "client_calculation",
      evidenceAuthority: "client_calculated",
      status: "available",
      receipt: null
    })).toThrow(/partial or unavailable/);
    expect(() => createImpactPreview({
      ...base,
      receipt: { id: "receipt-1" },
      why: ""
    })).toThrow(/ImpactPreview\.why/);
    expect(() => createImpactPreview({
      ...base,
      status: "unavailable",
      before: null,
      after: null,
      deltas: [],
      commercialDeltas: null,
      unavailableReasons: ["Receipt evidence expired."],
      receipt: { id: "receipt-1" }
    })).toThrow(/unavailable confidence/);
  });
});

describe("opportunity momentum", () => {
  test("ranks deterministically by category, severity, due date, then lexical id", () => {
    const ranked = rankAmbientNextActions([
      nextActionCandidate("zeta", { dueAt: "2026-08-12T12:00:00Z" }),
      nextActionCandidate("alpha", { dueAt: "2026-08-12T12:00:00Z" }),
      nextActionCandidate("deadline", {
        category: "deadline",
        severity: "info",
        dueAt: "2026-08-15T12:00:00Z"
      }),
      nextActionCandidate("safety", {
        category: "authority_or_safety_blocker",
        severity: "blocking",
        dueAt: null
      }),
      nextActionCandidate("unavailable", {
        category: "authority_or_safety_blocker",
        availability: { state: "unavailable", reason: "Authority evidence is unavailable." },
        resolutionActionId: null
      })
    ]);

    expect(ranked.map((candidate) => candidate.id)).toEqual([
      "safety",
      "deadline",
      "alpha",
      "zeta"
    ]);
    expect(ranked.map((candidate) => candidate.rank)).toEqual([1, 2, 3, 4]);
  });

  test("keeps four domains distinct and never fabricates a blended score", () => {
    const momentum = createOpportunityMomentum({
      domains: momentumDomains(),
      candidates: [
        nextActionCandidate("proposal"),
        nextActionCandidate("customer", {
          category: "customer_reply_or_approval",
          severity: "warning"
        }),
        nextActionCandidate("unsupported", {
          availability: { state: "unavailable", reason: "The source could not be read." },
          resolutionActionId: null
        })
      ]
    });

    expect(Object.keys(momentum.domains)).toEqual([
      "proposal",
      "commercial",
      "customer",
      "operational"
    ]);
    expect(Object.values(momentum.domains).map(({ domain, kind }) => [domain, kind])).toEqual([
      ["proposal", "proposal_completeness"],
      ["commercial", "commercial_health"],
      ["customer", "customer_state"],
      ["operational", "operational_evidence"]
    ]);
    expect(momentum.domains.proposal.completenessPercent).toBe(72);
    expect(momentum.domains.commercial).not.toHaveProperty("completenessPercent");
    expect(momentum.domains.customer).not.toHaveProperty("completenessPercent");
    expect(momentum.domains.operational).not.toHaveProperty("completenessPercent");
    expect(momentum.nextAction.id).toBe("customer");
    expect(momentum.unavailableActions).toHaveLength(1);
    expect(momentum.unavailableActions[0].availability.reason).toBe("The source could not be read.");

    expect(() => createOpportunityMomentum({
      domains: momentumDomains(),
      candidates: [],
      readinessPercent: 81,
      nextActionUnavailableReason: "No supported next action."
    })).toThrow(/blended/);
    expect(() => createOpportunityMomentum({
      domains: {
        ...momentumDomains(),
        commercial: {
          ...momentumDomains().commercial,
          completenessPercent: 80
        }
      },
      candidates: []
    })).toThrow(/only proposal/);
  });

  test("rejects score and percentage aliases outside proposal completeness", () => {
    for (const [domain, metric] of [
      ["commercial", { healthPercent: 80 }],
      ["customer", { confidenceScore: 0.9 }],
      ["operational", { readiness_percentage: 65 }]
    ]) {
      expect(() => createOpportunityMomentum({
        domains: {
          ...momentumDomains(),
          [domain]: { ...momentumDomains()[domain], ...metric }
        },
        candidates: [],
        nextActionUnavailableReason: "No supported next action."
      })).toThrow(/only proposal/);
    }

    expect(() => createOpportunityMomentum({
      domains: {
        ...momentumDomains(),
        proposal: { ...momentumDomains().proposal, score: 72 }
      },
      candidates: [],
      nextActionUnavailableReason: "No supported next action."
    })).toThrow(/only proposal/);

    expect(() => createOpportunityMomentum({
      domains: momentumDomains(),
      candidates: [],
      overallPercentage: 72,
      nextActionUnavailableReason: "No supported next action."
    })).toThrow(/blended/);
  });

  test("reports an explicit unavailable next action when evidence cannot support one", () => {
    const momentum = createOpportunityMomentum({
      domains: momentumDomains(),
      candidates: [nextActionCandidate("unsupported", {
        availability: { state: "unavailable", reason: "The quote revision is stale." },
        resolutionActionId: null
      })],
      nextActionUnavailableReason: "Refresh the quote before choosing a resolution."
    });

    expect(momentum.nextAction).toBeNull();
    expect(momentum.nextActionState).toBe("unavailable");
    expect(momentum.nextActionUnavailableReason).toContain("Refresh");
  });
});

describe("ambient capability manifest", () => {
  function manifest(overrides = {}) {
    return {
      schemaVersion: 1,
      ambientShellEnabled: true,
      presentationGates: { ambient_living_opportunity: true },
      authorityGates: { trusted_quote_save: false },
      capabilities: [{
        id: "guest-count-preview",
        enabled: true,
        mode: "dual",
        presentationGateIds: ["ambient_living_opportunity"],
        authorityGateIds: ["trusted_quote_save"]
      }],
      ...overrides
    };
  }

  test("keeps server authority gates independent and fail closed", () => {
    const contract = createAmbientCapabilityManifest(manifest());
    const result = evaluateAmbientCapability(contract, "guest-count-preview");

    expect(result.available).toBe(false);
    expect(result.reasonCodes).toEqual(["authority_gate_disabled:trusted_quote_save"]);
    expect(Object.isFrozen(contract.authorityGates)).toBe(true);
    expect(evaluateAmbientCapability(contract, "not-declared")).toEqual({
      capabilityId: "not-declared",
      available: false,
      reasonCodes: ["capability_not_declared"]
    });
  });

  test("rejects compatibility mappings to undeclared gates", () => {
    expect(() => createAmbientCapabilityManifest(manifest({
      capabilities: [{
        id: "guest-count-preview",
        enabled: true,
        mode: "ambient",
        presentationGateIds: ["missing-gate"],
        authorityGateIds: []
      }]
    }))).toThrow(/undeclared gate/);
  });
});
