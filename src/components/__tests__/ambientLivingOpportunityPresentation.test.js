import { describe, expect, test } from "vitest";
import {
  AMBIENT_LIVING_OPPORTUNITY_MODEL,
  buildAmbientGuestObject,
  buildAmbientLivingOpportunityPresentation,
  buildAmbientPricingObject,
  buildAmbientStaffingObject,
  validateAmbientGuestCount
} from "../ambientLivingOpportunityPresentation";

function quote(overrides = {}) {
  return {
    id: "quote-alpha",
    quoteNumber: "Q-ALPHA",
    customerId: "customer-alpha",
    status: "draft",
    customer: { name: "Maya Bennett" },
    event: {
      name: "Autumn Benefit Dinner",
      date: "2026-09-19",
      time: "18:00",
      venue: "The Foundry Hall",
      style: "Plated",
      guests: 120,
      servers: 8,
      chefs: 3
    },
    selection: {
      packageName: "Classic",
      rentals: ["chairs"],
      addons: ["tea"]
    },
    totals: { total: 8_400, serverLabor: 1_200, chefLabor: 600 },
    ...overrides
  };
}

function packageMenuQuote(overrides = {}) {
  return quote({
    organizationId: "org-alpha",
    activeVersionId: "version-alpha",
    updatedAtISO: "2026-08-11T18:00:00.000Z",
    selection: {
      packageId: "classic",
      packageName: "Classic",
      packageInclusions: {
        menuItems: [{ id: "salad", name: "Garden salad" }],
        addons: [{ id: "tea", name: "Tea service" }],
        rentals: [{ id: "chafer", name: "Chafer" }]
      },
      menuItems: ["salad", "chicken"],
      menuItemsSnapshot: [
        { id: "salad", name: "Garden salad", quantity: 2, includedInPackage: true },
        { id: "chicken", name: "Herb chicken", quantity: 3, includedInPackage: false }
      ],
      menuItemNames: ["Garden salad", "Herb chicken"],
      menuItemQuantities: { salad: 2, chicken: 3 },
      rentals: ["chafer"],
      addons: ["tea"],
      addonQuantities: { tea: 120 },
      rentalQuantities: { chafer: 4 },
      addonSnapshots: [
        { id: "tea", name: "Tea service", pricingType: "per_person", quantity: 120, price: 3 }
      ],
      rentalSnapshots: [
        { id: "chafer", name: "Chafer", pricingType: "per_item", quantity: 4, price: 20 }
      ]
    },
    ...overrides
  });
}

function packageMenuCatalog(freshness = {
  state: "fresh",
  observedAtISO: "2026-08-11T18:01:00.000Z"
}) {
  return {
    organizationId: "org-alpha",
    sourceLabel: "Explicit organization catalog",
    catalogRevision: 12,
    freshness,
    packages: [
      {
        id: "classic",
        name: "Classic",
        active: true,
        includedMenuItemIds: ["salad", "chicken"],
        includedAddonIds: ["tea"],
        includedRentalIds: ["chafer"]
      },
      {
        id: "premium",
        name: "Premium",
        active: true,
        includedMenuItemIds: ["salad", "chicken", "salmon"],
        includedAddonIds: ["tea"],
        includedRentalIds: ["chafer"]
      }
    ],
    addons: [
      {
        id: "tea",
        name: "Tea service",
        pricingType: "per_person",
        price: 3,
        staffRole: "server",
        active: true
      }
    ],
    rentals: [
      {
        id: "chafer",
        name: "Chafer",
        pricingType: "per_item",
        price: 20,
        active: true
      }
    ],
    upsellRules: [],
    menuSections: [{
      id: "entrees",
      name: "Entrees",
      items: [
        { id: "salad", name: "Garden salad", active: true },
        { id: "chicken", name: "Herb chicken", active: true },
        { id: "salmon", name: "Salmon", active: true }
      ]
    }]
  };
}

describe("ambient Living Opportunity presentation", () => {
  test("turns saved pricing into a truthful intelligent object without inventing margin or discount authority", () => {
    const object = buildAmbientPricingObject(quote({
      pricing: {
        authority: "server_authoritative",
        calculatedAt: "2026-08-11T12:00:00.000Z",
        inputs: { event: { guests: 120 } },
        lineItems: [
          { id: "classic", category: "package", total: 6_000 },
          { id: "labor", category: "labor", total: 1_200 },
          { id: "service", category: "service_fee", total: 600 }
        ],
        tax: { amount: 600, regionId: "austin", regionName: "Austin" },
        discountTotal: 0,
        deposit: { pct: 0.3, amount: 2_520 },
        subtotal: 7_800,
        grandTotal: 8_400,
        rulesSnapshot: { pricingSettingsVersion: 12 }
      }
    }), {
      source: "firebase",
      ordinaryEditAllowed: true
    });

    expect(object).toMatchObject({
      available: true,
      exactSavedAuthority: true,
      total: 8_400,
      deposit: 2_520,
      discountTotal: 0,
      discountAdjustmentAvailable: false,
      descriptor: {
        id: "pricing",
        permissions: { simulate: true, commit: false },
        confidence: { level: "high" }
      }
    });
    expect(object.breakdown.map((item) => item.id)).toEqual([
      "package",
      "labor",
      "service_fee"
    ]);
    expect(object.missingCostEvidence[0]).toContain("cost context");
    expect(object.doNothing).toContain("No repricing, discount, authorization, or customer communication");
    expect(Object.isFrozen(object)).toBe(true);
  });

  test("exposes exact missing cost evidence and target margin gap without upgrading authority", () => {
    const base = quote({
      pricing: {
        authority: "legacy_derived",
        lineItems: [],
        deposit: { amount: 2_000 },
        grandTotal: 8_400
      }
    });
    const unavailable = buildAmbientPricingObject(base, {
      margin: {
        available: false,
        missing: ["Classic (costPpp)", "Selected item retired-addon (catalog item unavailable)"],
        note: "Margins unavailable."
      }
    });
    expect(unavailable.descriptor.confidence.level).toBe("medium");
    expect(unavailable.missingCostEvidence).toEqual([
      "Classic (costPpp)",
      "Selected item retired-addon (catalog item unavailable)"
    ]);

    const belowTarget = buildAmbientPricingObject(base, {
      margin: {
        available: true,
        revenue: 8_000,
        cost: 5_600,
        marginPct: 0.3,
        target: 0.4
      }
    });
    expect(belowTarget.targetGap.points).toBeCloseTo(10, 6);
    expect(belowTarget.targetGap.amount).toBeCloseTo(800, 6);
    expect(belowTarget.descriptor.recommendation.summary).toContain("target-margin gap");
  });

  test("answers identity, state, risk, and next action without blending readiness", () => {
    const model = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "local",
      ordinaryEditAllowed: true
    });

    expect(model.modelId).toBe(AMBIENT_LIVING_OPPORTUNITY_MODEL);
    expect(model.surface.object).toEqual({
      id: "quote-alpha",
      type: "opportunity",
      label: "Autumn Benefit Dinner"
    });
    expect(model.identity.total).toBe("$8,400.00");
    expect(model.momentum.proposal.detail).toContain("Proposal completeness only");
    expect(model.momentum.commercial).toMatchObject({
      kind: "commercial_health",
      state: "unavailable",
      value: "Not enough detail",
      detail: expect.stringContaining("does not establish")
    });
    expect(model.momentum).not.toHaveProperty("score");
    expect(model.risk).toMatchObject({
      id: "proposal-gap-customer-email",
      title: "Valid customer email needs review"
    });
    expect(model.nextAction).toMatchObject({
      kind: "edit",
      label: "Review draft",
      target: { quoteId: "quote-alpha" }
    });
    expect(model.nextAction.reason).toBeTruthy();
    expect(model.nextAction.consequence).toBeTruthy();
    expect(model.nextAction.nextResolution).toBeTruthy();
    expect(model.surfaceContract.purposes).toContain("simulate");
    expect(model.guestObject.descriptor).toMatchObject({
      id: "guest-count",
      why: expect.any(String),
      doNothing: expect.any(String)
    });
    expect(model.guestObject.impactPreview).toMatchObject({
      status: "unavailable",
      authority: "advisory",
      requiresAuthoritativeCommit: true
    });
    expect(model.momentumContract).not.toHaveProperty("score");
    expect(model.momentumContract.domains.commercial).toMatchObject({
      state: "unavailable",
      reason: expect.stringContaining("does not establish")
    });
    expect(model.disclosureLayers.operational.map((item) => item.id)).toEqual([
      "event",
      "menu",
      "staffing",
      "pricing"
    ]);
    expect(model.disclosureLayers.supporting.map((item) => item.id)).toEqual([
      "margin",
      "history",
      "activity",
      "automation"
    ]);
    expect(model.disclosureLayers.supporting[0]).toMatchObject({
      value: "Unavailable",
      state: "unavailable",
      detail: expect.stringContaining("not inferred")
    });
    expect(model.surfaceContracts.operationalFacts.id).toBe("operational-facts-layer");
    expect(model.surfaceContracts.supportingEvidence.id).toBe("supporting-evidence-layer");
    expect(model.actions.revealOperationalFacts.arrivalContract.nextResolutionIds)
      .toEqual(["reveal-supporting-evidence"]);
    expect(model.actions.openPricedEditor).toMatchObject({
      id: "open-priced-editor",
      executionTarget: { surfaceId: "quote-editor" },
      enabled: true,
      primary: false
    });
    expect(model.actions.reviewFinalCountDecision).toMatchObject({
      id: "review-final-guest-count-in-workflow",
      executionTarget: { surfaceId: "workflow" },
      enabled: false,
      primary: false
    });
    expect(model.actions.primary.primary).toBe(true);
  });

  test("registers a presentation-only final-count Workflow handoff when the host supplies it", () => {
    const model = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "firebase",
      ordinaryEditAllowed: true,
      workflowHandlerAvailable: true
    });

    expect(model.actions.reviewFinalCountDecision).toMatchObject({
      id: "review-final-guest-count-in-workflow",
      outcomeLabel: "Review final-count task",
      authorityLevel: "presentation",
      receiptType: "pending",
      enabled: true,
      disabledReason: null
    });
    expect(model.actions.reviewFinalCountDecision.arrivalContract.consequence)
      .toContain("does not confirm attendance");
  });

  test("puts an exact Workflow blocker ahead of advisory recommendations", () => {
    const model = buildAmbientLivingOpportunityPresentation(quote({
      workflow: {
        approvalRequests: [{
          id: "approval-alpha",
          action: "rotate_portal_link",
          state: "pending",
          requestedAtISO: "2026-08-10T12:00:00.000Z"
        }]
      }
    }), {
      source: "firebase",
      ordinaryEditAllowed: true,
      now: new Date("2026-08-11T12:00:00.000Z")
    });

    expect(model.risk.id).toBe("workflow-attention");
    expect(model.nextAction.kind).toBe("workflow");
    expect(model.nextAction.target.quoteId).toBe("quote-alpha");
    expect(model.actions.primary.id).toBe("open-workflow-item");
    expect(model.actions.openPricedEditor).toMatchObject({
      id: "open-priced-editor",
      primary: false,
      enabled: true
    });
  });

  test("registers every local interaction with a complete arrival contract", () => {
    const model = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "local",
      ordinaryEditAllowed: true,
      legacyControlsAvailable: true
    });
    const expectedActions = {
      openGuestInlineEdit: "open-guest-count-inline-edit",
      cancelGuestInlineEdit: "cancel-guest-count-inline-edit",
      validateGuestCount: "clarify-guest-count-validation",
      keepGuestScenario: "keep-guest-count-scenario",
      dismissGuestContext: "dismiss-guest-count-context",
      dismissPilotContext: "dismiss-pilot-context",
      undoGuestScenario: "undo-guest-scenario",
      clearScenarioHistory: "clear-scenario-history",
      clearGuestScenarioHistory: "clear-scenario-history",
      inspectStaffing: "inspect-staffing",
      useStaffingRecommendation: "use-staffing-recommendation",
      keepCurrentStaffing: "keep-current-staffing",
      stageStaffingInEditor: "stage-staffing-in-editor",
      dismissStaffingContext: "dismiss-staffing-context",
      undoStaffingScenario: "undo-staffing-scenario",
      inspectPricing: "inspect-pricing",
      simulatePricingCounterfactual: "simulate-pricing-counterfactual",
      stagePricingInEditor: "stage-pricing-in-editor",
      dismissPricingContext: "dismiss-pricing-context",
      openPricedEditor: "open-priced-editor",
      inspectConversation: "inspect-conversation",
      continueConversationResolution: "continue-conversation-resolution",
      dismissConversationContext: "dismiss-conversation-context",
      inspectProposal: "inspect-proposal",
      reviewProposalInEditor: "review-proposal-in-editor",
      openProposalControls: "open-governed-proposal-controls",
      dismissProposalContext: "dismiss-proposal-context",
      openLegacyControls: "open-full-opportunity-controls"
    };

    Object.entries(expectedActions).forEach(([key, id]) => {
      expect(model.actions[key]).toMatchObject({
        id,
        arrivalContract: {
          object: {
            id: expect.any(String),
            type: expect.any(String),
            label: expect.any(String)
          },
          reason: expect.any(String),
          consequence: expect.any(String),
          nextResolutionIds: expect.arrayContaining([expect.any(String)])
        }
      });
    });
    expect(model.surfaceContracts.guestInlineEditor).toMatchObject({
      id: "guest-count-inline-editor",
      objectScopes: ["intelligent-object"]
    });
    expect(model.surfaceContracts.staffingContext).toMatchObject({
      id: "staffing-context",
      objectScopes: ["intelligent-object"],
      allowedEmptyState: null
    });
    expect(model.surfaceContracts.pricingContext).toMatchObject({
      id: "pricing-context",
      objectScopes: ["intelligent-object"],
      allowedEmptyState: null
    });
    expect(model.surfaceContracts.legacyOpportunityControls).toMatchObject({
      id: "legacy-opportunity-controls",
      objectScopes: ["opportunity", "customer-decision-artifact"]
    });
    expect(model.surfaceContracts.proposalContext).toMatchObject({
      id: "proposal-context",
      objectScopes: ["customer-decision-artifact"],
      allowedEmptyState: null
    });
    expect(model.surfaceContracts.conversationContext).toMatchObject({
      id: "conversation-context",
      objectScopes: ["customer-communication-evidence"],
      allowedEmptyState: null
    });
    expect(model.actions.clearGuestScenarioHistory)
      .toBe(model.actions.clearScenarioHistory);
  });

  test("passes exact source, freshness, role, and explicit access into Conversation evidence", () => {
    const conversationQuote = {
      ...packageMenuQuote(),
      updatedAtISO: "2026-08-12T18:00:00.000Z",
      lifecycle: {
        sentAtISO: "2026-08-12T17:00:00.000Z",
        viewedAtISO: "2026-08-12T17:10:00.000Z"
      },
      conversationSummary: {
        messageCount: 2,
        latestMessageId: "message-customer-alpha",
        latestMessageAtISO: "2026-08-12T17:20:00.000Z",
        latestActorType: "customer"
      }
    };
    const model = buildAmbientLivingOpportunityPresentation(conversationQuote, {
      source: "firebase",
      sourceFreshness: "fresh",
      role: "sales",
      conversationAvailable: true,
      conversationHandlerAvailable: true,
      workflowHandlerAvailable: true,
      todayISO: "2026-08-12"
    });

    expect(model.conversationObject).toMatchObject({
      sourceMode: "firebase",
      role: "sales",
      state: "attention",
      access: { state: "available", available: true },
      nextResolution: {
        id: "review-latest-customer-reply",
        availability: "available"
      }
    });
    expect(model.actions.inspectConversation).toMatchObject({
      enabled: true,
      executionTarget: { surfaceId: "conversation-context" },
      arrivalContract: {
        object: {
          id: "conversation",
          type: "customer-communication-evidence",
          label: "Conversation"
        }
      }
    });
    expect(model.actions.continueConversationResolution).toMatchObject({
      enabled: true,
      outcomeLabel: "Review latest customer reply",
      executionTarget: {
        kind: "context",
        targetId: "message-customer-alpha",
        surfaceId: "conversation"
      }
    });
    expect(model.capabilityManifest.capabilities).toContainEqual({
      id: "conversation-context",
      enabled: true,
      mode: "ambient",
      presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
      authorityGateIds: []
    });
  });

  test("enables a Conversation follow-up handoff only with its canonical exact Workflow identity", () => {
    const conversationQuote = packageMenuQuote({
      workflow: {
        followUp: {
          stage: "awaiting_response",
          dueDate: "2026-08-11",
          completed: false
        }
      }
    });
    const model = buildAmbientLivingOpportunityPresentation(conversationQuote, {
      source: "firebase",
      sourceFreshness: "fresh",
      role: "sales",
      conversationAvailable: false,
      conversationHandlerAvailable: true,
      workflowHandlerAvailable: true,
      todayISO: "2026-08-12"
    });

    expect(model.conversationObject.nextResolution).toMatchObject({
      id: "review-opportunity-follow-up",
      availability: "available",
      target: {
        surfaceId: "workflow",
        quoteId: "quote-alpha",
        attentionType: "follow_up",
        requestId: "follow-up:quote-alpha"
      }
    });
    expect(model.actions.continueConversationResolution).toMatchObject({
      enabled: true,
      executionTarget: {
        kind: "route",
        targetId: "follow-up:quote-alpha",
        surfaceId: "workflow"
      }
    });
  });

  test("keeps a change-request Workflow action disabled without an exact request identity", () => {
    const conversationQuote = packageMenuQuote({
      portalDecision: {
        decision: "changes_requested",
        submittedAtISO: "2026-08-12T17:30:00.000Z",
        message: "Please move dinner to 7 PM."
      }
    });
    const model = buildAmbientLivingOpportunityPresentation(conversationQuote, {
      source: "firebase",
      sourceFreshness: "fresh",
      role: "sales",
      conversationAvailable: false,
      conversationHandlerAvailable: true,
      workflowHandlerAvailable: true,
      todayISO: "2026-08-12"
    });

    expect(model.conversationObject.nextResolution).toMatchObject({
      id: "review-customer-change-request",
      availability: "blocked",
      reason: expect.stringContaining("no exact request identity"),
      target: {
        quoteId: "quote-alpha",
        attentionType: "change_request",
        requestId: ""
      }
    });
    expect(model.actions.continueConversationResolution).toMatchObject({
      enabled: false,
      disabledReason: expect.stringContaining("no exact request identity")
    });
  });

  test("passes exact source freshness and staff role into the descriptive Proposal object", () => {
    const proposalQuote = packageMenuQuote({
      customer: {
        name: "Maya Bennett",
        email: "maya@example.test",
        phone: "205-555-0142"
      },
      event: {
        ...quote().event,
        hours: 6
      },
      totals: {
        subtotal: 7_800,
        tax: 600,
        total: 8_400,
        deposit: 2_520
      },
      pricing: {
        authority: "server_authoritative",
        calculatedAt: "2026-08-11T17:59:00.000Z",
        grandTotal: 8_400
      },
      portalKey: "proposal-living-opportunity-key-000001",
      portalIssuedAtISO: "2026-08-11T18:00:00.000Z",
      portalExpiresAtISO: "2026-09-11T18:00:00.000Z",
      workflow: { quoteDelivery: {} }
    });
    const current = buildAmbientLivingOpportunityPresentation(proposalQuote, {
      source: "firebase",
      sourceFreshness: "fresh",
      ordinaryEditAllowed: true,
      legacyControlsAvailable: true,
      role: "admin",
      now: new Date("2026-08-12T12:00:00.000Z")
    });

    expect(current.proposalObject).toMatchObject({
      state: "current",
      sourceMode: "firebase",
      role: "admin",
      savedEvidence: { state: "exact_current", exact: true },
      readiness: { complete: true, score: 100 }
    });
    expect(current.actions.inspectProposal).toMatchObject({
      enabled: true,
      executionTarget: { surfaceId: "proposal-context" },
      arrivalContract: {
        object: {
          id: "proposal",
          type: "customer-decision-artifact",
          label: "Proposal"
        }
      }
    });
    expect(current.actions.openProposalControls).toMatchObject({
      enabled: true,
      outcomeLabel: "Open proposal controls",
      authorityLevel: "presentation",
      executionTarget: { surfaceId: "legacy-opportunity-controls" }
    });
    expect(current.actions.openProposalControls.arrivalContract.reason)
      .toContain("Replace customer link");
    expect(current.actions.openProposalControls.arrivalContract.consequence)
      .toMatch(/independently recheck role, exact revision, authoritative pricing/iu);

    const unknown = buildAmbientLivingOpportunityPresentation(proposalQuote, {
      source: "firebase",
      sourceFreshness: "unknown",
      ordinaryEditAllowed: true,
      legacyControlsAvailable: true,
      role: "sales",
      now: new Date("2026-08-12T12:00:00.000Z")
    });
    expect(unknown.proposalObject).toMatchObject({
      sourceMode: "firebase",
      role: "sales",
      state: "unavailable",
      savedEvidence: { state: "malformed", exact: false }
    });
    expect(unknown.proposalObject.savedEvidence.reason).toMatch(/freshness is unknown/iu);
  });

  test("keeps guest simulation and editor-handoff contracts stable across scenarios", () => {
    const current = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "local",
      ordinaryEditAllowed: true,
      scenarioGuestCount: 120
    });
    const changed = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "local",
      ordinaryEditAllowed: true,
      scenarioGuestCount: 150
    });

    expect(changed.guestObject.consequence).not.toBe(current.guestObject.consequence);
    expect(changed.actions.simulateGuestCount.arrivalContract)
      .toEqual(current.actions.simulateGuestCount.arrivalContract);
    expect(changed.actions.stageGuestCount.arrivalContract)
      .toEqual(current.actions.stageGuestCount.arrivalContract);
    expect(changed.actions.stageGuestCount.arrivalContract).toMatchObject({
      reason: "Continue the active guest-count preview in the exact quote editor.",
      nextResolutionIds: ["review-live-price", "leave-existing-version-unchanged"]
    });
  });

  test("keeps legacy controls disabled unless the host explicitly supplies the handoff", () => {
    const unavailable = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "local",
      ordinaryEditAllowed: true
    });
    const supplied = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "local",
      ordinaryEditAllowed: true,
      legacyControlsAvailable: true
    });

    expect(unavailable.actions.openLegacyControls).toMatchObject({
      id: "open-full-opportunity-controls",
      enabled: false,
      disabledReason: expect.any(String)
    });
    expect(supplied.actions.openLegacyControls).toMatchObject({
      id: "open-full-opportunity-controls",
      outcomeLabel: "Open quote workspace",
      enabled: true,
      disabledReason: null
    });
  });

  test("maps operational staffing context to its independent default-off presentation gate", () => {
    const disabled = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "firebase",
      ordinaryEditAllowed: true
    });
    const enabled = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "firebase",
      ordinaryEditAllowed: true,
      operationalStaffingEnabled: true
    });

    expect(disabled.capabilityManifest.presentationGates).toMatchObject({
      VITE_AMBIENT_UI_ENABLED: true,
      VITE_OPERATIONAL_STAFFING_ENABLED: false
    });
    expect(enabled.capabilityManifest.presentationGates)
      .toMatchObject({ VITE_OPERATIONAL_STAFFING_ENABLED: true });
    expect(enabled.capabilityManifest.capabilities).toContainEqual({
      id: "operational-staffing-context",
      enabled: true,
      mode: "ambient",
      presentationGateIds: [
        "VITE_AMBIENT_UI_ENABLED",
        "VITE_OPERATIONAL_STAFFING_ENABLED"
      ],
      authorityGateIds: []
    });
  });

  test("exposes guest dependencies, counterfactuals, confidence, and provenance", () => {
    const object = buildAmbientGuestObject(quote(), 150);

    expect(object.scenarioChanged).toBe(true);
    expect(object.scenarioStaffing).toMatchObject({
      available: true,
      guestCount: 150,
      servers: 13,
      chefs: 3
    });
    expect(object.dependencies.map((item) => item.id)).toEqual([
      "commercial-scope",
      "staffing",
      "quantities"
    ]);
    expect(object.why).toContain("house guide");
    expect(object.consequence).toContain("cannot price that delta");
    expect(object.doNothing).toContain("quote remains");
    expect(object.confidence).toBe("high");
    expect(object.provenance).toContain("house staffing guide");
    expect(object.preview).toMatchObject({
      available: false,
      nextResolution: expect.stringContaining("Stage 150 guests")
    });
  });

  test("builds deterministic staffing judgment from the saved quote and static house ratios", () => {
    const object = buildAmbientStaffingObject(quote(), {
      source: "local",
      ordinaryEditAllowed: true
    });

    expect(object).toMatchObject({
      id: "staffing",
      guestCount: 120,
      usesLocalGuestScenario: false,
      current: { servers: 8, chefs: 3, bartenders: 0 },
      recommended: { servers: 10, chefs: 3, bartenders: 0 },
      serverGap: 2,
      chefGap: 0,
      hasRecommendation: true,
      recommendationAvailable: true
    });
    expect(object.why).toContain("1 server per 12 guests");
    expect(object.why).toContain("no bartender rule");
    expect(object.consequence).toContain("Review labor price");
    expect(object.doNothing).toContain("planning prompt");
    expect(object.dependencies.map((dependency) => dependency.object.id)).toEqual([
      "guest-count",
      "service-style",
      "labor-pricing",
      "staffing-operations"
    ]);
    expect(object.descriptor).toMatchObject({
      id: "staffing",
      why: object.why,
      consequence: object.consequence,
      doNothing: object.doNothing,
      confidence: {
        level: "high",
        basis: expect.stringContaining("does not confirm availability")
      },
      recommendation: {
        actionId: "use-staffing-recommendation"
      },
      permissions: {
        view: true,
        simulate: true,
        stage: true,
        commit: false
      }
    });
    expect(object.provenance.map((entry) => entry.sourceId)).toEqual([
      "quote:quote-alpha",
      "house-staffing-ratios"
    ]);
    expect(object.provenance.some((entry) => entry.sourceId.includes("history"))).toBe(false);
  });

  test("recalculates staffing guidance from the active local guest scenario without inventing price impact", () => {
    const model = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "local",
      ordinaryEditAllowed: true,
      scenarioGuestCount: 150
    });

    expect(model.staffingObject).toMatchObject({
      guestCount: 150,
      usesLocalGuestScenario: true,
      recommended: { servers: 13, chefs: 3, bartenders: 0 },
      serverGap: 5,
      hasRecommendation: true
    });
    expect(model.staffingObject.provenance.map((entry) => entry.sourceId)).toEqual([
      "quote:quote-alpha",
      "local:guest-count-scenario",
      "house-staffing-ratios"
    ]);
    expect(model.staffingObject).not.toHaveProperty("priceDelta");
    expect(model.staffingObject.impactPreview).toMatchObject({
      status: "partial",
      authority: "advisory",
      requiresAuthoritativeCommit: true,
      before: { servers: 8, chefs: 3, bartenders: 0 },
      after: { servers: 13, chefs: 3, bartenders: 0 },
      commercialDeltas: null
    });
    expect(model.actions.useStaffingRecommendation.arrivalContract.consequence)
      .toContain("Review labor price");
  });

  test("fails staffing recommendation actions closed when the service style has no declared rule", () => {
    const object = buildAmbientStaffingObject(quote({
      event: {
        name: "Autumn Benefit Dinner",
        style: "Family style",
        guests: 120,
        servers: 8,
        chefs: 3
      }
    }), {
      source: "firebase",
      ordinaryEditAllowed: true
    });
    const model = buildAmbientLivingOpportunityPresentation(quote({
      event: {
        name: "Autumn Benefit Dinner",
        style: "Family style",
        guests: 120,
        servers: 8,
        chefs: 3
      }
    }), {
      source: "firebase",
      ordinaryEditAllowed: true
    });

    expect(object).toMatchObject({
      hasRecommendation: false,
      recommendationAvailable: false,
      descriptor: {
        confidence: { level: "unavailable" },
        recommendation: null
      }
    });
    expect(object.why).toContain("does not have a staffing guide");
    ["useStaffingRecommendation", "stageStaffingInEditor"]
      .forEach((key) => {
        expect(model.actions[key]).toMatchObject({
          enabled: false,
          disabledReason: expect.stringContaining("does not have a staffing guide")
        });
      });
    expect(model.actions.undoStaffingScenario.enabled).toBe(true);
    expect(model.actions.inspectStaffing.enabled).toBe(true);
    expect(model.actions.keepCurrentStaffing.enabled).toBe(true);
  });

  test("requires manual review instead of clamping recommendations above editor bounds", () => {
    const highGuestQuote = quote({
      event: {
        name: "Large Plated Benefit",
        style: "Plated",
        guests: 400,
        servers: 8,
        chefs: 3,
        bartenders: 0
      }
    });
    const model = buildAmbientLivingOpportunityPresentation(highGuestQuote, {
      source: "local",
      ordinaryEditAllowed: true
    });

    expect(model.staffingObject).toMatchObject({
      recommended: { servers: 34, chefs: 8, bartenders: 0 },
      hasRecommendation: true,
      recommendationWithinEditorBounds: false,
      recommendationAvailable: false,
      unavailableReason: expect.stringContaining("above the quote editor bounds")
    });
    expect(model.staffingObject.recommended.servers).toBe(34);
    expect(model.staffingObject.descriptor.recommendation).toMatchObject({
      actionId: "inspect-staffing",
      summary: expect.stringContaining("Manual review is required")
    });
    ["useStaffingRecommendation", "stageStaffingInEditor"]
      .forEach((key) => {
        expect(model.actions[key]).toMatchObject({
          enabled: false,
          disabledReason: expect.stringContaining("above the quote editor bounds")
        });
      });
    expect(model.actions.undoStaffingScenario.enabled).toBe(true);
  });

  test("does not turn a total staffing ratio into base staff when saved add-on labor exists", () => {
    const model = buildAmbientLivingOpportunityPresentation(quote({
      totals: {
        total: 8_400,
        addonServers: 2,
        addonChefs: 0,
        addonBartenders: 0
      }
    }), {
      source: "firebase",
      ordinaryEditAllowed: true
    });

    expect(model.staffingObject).toMatchObject({
      addonStaffing: { servers: 2, chefs: 0, bartenders: 0 },
      hasAddonStaffingEvidence: true,
      recommendationAvailable: false,
      unavailableReason: expect.stringContaining("from add-ons")
    });
    expect(model.staffingObject.consequence).toContain("Review how those roles combine");
    expect(model.staffingObject.doNothing).toContain("No total-staffing sufficiency claim");
    ["useStaffingRecommendation", "stageStaffingInEditor"]
      .forEach((key) => {
        expect(model.actions[key]).toMatchObject({
          enabled: false,
          disabledReason: expect.stringContaining("from add-ons")
        });
      });
    expect(model.actions.undoStaffingScenario.enabled).toBe(true);
  });

  test("validates the quote calculator's supported guest range", () => {
    expect(validateAmbientGuestCount("120")).toBe("");
    expect(validateAmbientGuestCount("120.5")).toContain("whole");
    expect(validateAmbientGuestCount(0)).toContain("1 to 400");
    expect(validateAmbientGuestCount(401)).toContain("1 to 400");
  });

  test("integrates populated package and menu context with exact kernel-permitted draft actions", () => {
    const model = buildAmbientLivingOpportunityPresentation(packageMenuQuote(), {
      source: "firebase",
      role: "sales",
      ordinaryEditAllowed: true,
      packageMenuCatalogEvidence: packageMenuCatalog()
    });

    expect(model.packageObject).toMatchObject({
      id: "package",
      savedSelection: {
        state: "available",
        packageId: "classic",
        catalogMatch: { state: "matched_current" }
      },
      permissions: { view: true, stage: true, commit: false },
      intentContract: {
        actionId: "replace-package-in-draft",
        enabled: true,
        authority: "draft_only",
        commit: false,
        baseContext: {
          quoteId: "quote-alpha",
          organizationId: "org-alpha",
          baseRevisionId: "version-alpha",
          catalogRevision: 12
        }
      }
    });
    expect(model.menuObject).toMatchObject({
      id: "menu",
      savedSelection: { state: "available", allCatalogMatched: true },
      permissions: { view: true, stage: true, commit: false },
      intentContracts: {
        replace: { actionId: "replace-menu-item-in-draft", enabled: true },
        reorder: { actionId: "reorder-menu-in-draft", enabled: true }
      }
    });
    expect(model.surfaceContracts.packageContext).toMatchObject({
      id: "package-context",
      objectScopes: ["intelligent-object"],
      allowedEmptyState: null
    });
    expect(model.surfaceContracts.menuContext).toMatchObject({
      id: "menu-context",
      objectScopes: ["intelligent-object"],
      allowedEmptyState: null
    });
    expect(model.actions.inspectPackage).toMatchObject({
      id: "inspect-package",
      enabled: true,
      executionTarget: { kind: "context", surfaceId: "package-context" },
      arrivalContract: {
        object: { id: "package", type: "intelligent-object" },
        nextResolutionIds: ["replace-package-in-draft", "dismiss-package-context"]
      }
    });
    expect(model.actions.inspectMenu.arrivalContract.nextResolutionIds).toEqual([
      "replace-menu-item-in-draft",
      "reorder-menu-in-draft",
      "dismiss-menu-context"
    ]);
    expect(model.actions.dismissPackageContext.enabled).toBe(true);
    expect(model.actions.dismissMenuContext.enabled).toBe(true);
    expect(model.selectionObjects).toMatchObject({
      populated: true,
      stageableCount: 2,
      permissions: { view: true, stage: true, commit: false }
    });
    expect(model.surfaceContracts.selectionContext).toMatchObject({
      id: "selection-context",
      objectScopes: ["intelligent-object-collection", "selection-intelligent-object"],
      allowedEmptyState: null
    });
    expect(model.actions.inspectSelections).toMatchObject({
      id: "inspect-event-selections",
      enabled: true,
      executionTarget: {
        kind: "context",
        targetId: "event-selections",
        surfaceId: "selection-context"
      },
      arrivalContract: {
        object: {
          id: "event-selections",
          type: "intelligent-object-collection"
        },
        reason: expect.any(String),
        consequence: expect.any(String),
        nextResolutionIds: expect.arrayContaining(["dismiss-selection-context"])
      }
    });
    model.selectionObjects.objects.forEach((selectionObject) => {
      const actions = model.selectionObjectActions[selectionObject.id];
      expect(actions.reduce).toMatchObject({
        enabled: true,
        authorityLevel: "draft",
        previewPolicy: "required",
        receiptType: "preview",
        arrivalContract: {
          object: {
            id: selectionObject.id,
            type: "selection-intelligent-object",
            label: selectionObject.label
          },
          reason: expect.any(String),
          consequence: expect.any(String),
          nextResolutionIds: expect.arrayContaining([selectionObject.actionIds.undo])
        }
      });
      expect(actions.increase.enabled).toBe(true);
      expect(actions.keep.arrivalContract).toMatchObject({
        object: { id: selectionObject.id },
        consequence: expect.stringContaining("saved quote remains unchanged")
      });
      expect(actions.undo.arrivalContract.nextResolutionIds).toEqual([
        selectionObject.actionIds.reduce,
        selectionObject.actionIds.increase
      ]);
    });
    expect(model.actions.replacePackageInDraft).toMatchObject({
      id: model.packageObject.intentContract.actionId,
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "draft_mutation",
        targetId: "quote-alpha",
        surfaceId: "quote-editor"
      },
      arrivalContract: { object: { id: "package", type: "intelligent-object" } },
      enabled: true
    });
    expect(model.actions.replaceMenuItemInDraft.id)
      .toBe(model.menuObject.intentContracts.replace.actionId);
    expect(model.actions.reorderMenuInDraft.id)
      .toBe(model.menuObject.intentContracts.reorder.actionId);
    expect(model.capabilityManifest.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "package-context", enabled: true, mode: "ambient" }),
      expect.objectContaining({
        id: "package-draft-intent",
        enabled: true,
        mode: "dual",
        authorityGateIds: ["ordinary_quote_edit"]
      }),
      expect.objectContaining({ id: "menu-context", enabled: true, mode: "ambient" }),
      expect.objectContaining({
        id: "menu-draft-intent",
        enabled: true,
        mode: "dual",
        authorityGateIds: ["ordinary_quote_edit"]
      })
    ]));
  });

  test.each([
    [
      "stale",
      {
        state: "stale",
        observedAtISO: "2026-08-10T18:01:00.000Z",
        reason: "The operator catalog may have changed."
      }
    ],
    ["unknown", { state: "unknown", reason: "No observation timestamp is available." }]
  ])("keeps %s package/menu evidence inspectable without publishing draft actions", (state, freshness) => {
    const model = buildAmbientLivingOpportunityPresentation(packageMenuQuote(), {
      source: "firebase",
      role: "admin",
      ordinaryEditAllowed: true,
      packageMenuCatalogEvidence: packageMenuCatalog(freshness)
    });

    expect(model.packageObject.currentCatalogRecord.id).toBe("classic");
    expect(model.packageObject.provenance.at(-1)).toMatchObject({
      state: state === "stale" ? "stale" : "unavailable"
    });
    expect(model.packageObject.intentContract).toMatchObject({
      enabled: false,
      reason: expect.stringContaining(`catalog state is ${state}`)
    });
    expect(model.menuObject.intentContracts.replace.enabled).toBe(false);
    expect(model.menuObject.intentContracts.reorder.enabled).toBe(false);
    expect(model.actions.inspectPackage).toMatchObject({ enabled: true, disabledReason: null });
    expect(model.actions.inspectMenu).toMatchObject({ enabled: true, disabledReason: null });
    expect(model.actions.inspectPackage.arrivalContract.nextResolutionIds)
      .toEqual(["dismiss-package-context"]);
    expect(model.actions.inspectMenu.arrivalContract.nextResolutionIds)
      .toEqual(["dismiss-menu-context"]);
    expect(model.actions).not.toHaveProperty("replacePackageInDraft");
    expect(model.actions).not.toHaveProperty("replaceMenuItemInDraft");
    expect(model.actions).not.toHaveProperty("reorderMenuInDraft");
    expect(model.capabilityManifest.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "package-context", enabled: true }),
      expect.objectContaining({ id: "package-draft-intent", enabled: false }),
      expect.objectContaining({ id: "menu-context", enabled: true }),
      expect.objectContaining({ id: "menu-draft-intent", enabled: false })
    ]));
  });

  test("separates view-only staff inspection from the non-staff evidence boundary", () => {
    const viewOnly = buildAmbientLivingOpportunityPresentation(packageMenuQuote(), {
      source: "firebase",
      role: "sales",
      ordinaryEditAllowed: false,
      packageMenuCatalogEvidence: packageMenuCatalog()
    });
    const nonStaff = buildAmbientLivingOpportunityPresentation(packageMenuQuote(), {
      source: "firebase",
      role: "viewer",
      ordinaryEditAllowed: true,
      packageMenuCatalogEvidence: packageMenuCatalog()
    });

    expect(viewOnly.packageObject.permissions).toMatchObject({
      view: true,
      stage: false,
      commit: false,
      reason: expect.stringContaining("view-only")
    });
    expect(viewOnly.menuObject.permissions).toMatchObject({ view: true, stage: false });
    expect(viewOnly.actions.inspectPackage.enabled).toBe(true);
    expect(viewOnly.actions.inspectMenu.enabled).toBe(true);
    expect(viewOnly.actions.dismissPackageContext.enabled).toBe(true);
    expect(viewOnly.actions).not.toHaveProperty("replacePackageInDraft");
    expect(viewOnly.actions).not.toHaveProperty("replaceMenuItemInDraft");
    expect(viewOnly.actions).not.toHaveProperty("reorderMenuInDraft");

    expect(nonStaff.packageObject).toMatchObject({
      savedSelection: { state: "unavailable", packageId: "" },
      permissions: { view: false, stage: false, commit: false }
    });
    expect(nonStaff.menuObject.items).toEqual([]);
    expect(nonStaff.actions.inspectPackage).toMatchObject({
      enabled: false,
      disabledReason: expect.stringContaining("Staff role is required")
    });
    expect(nonStaff.actions.inspectMenu.enabled).toBe(false);
    expect(nonStaff.actions.dismissPackageContext.enabled).toBe(true);
    expect(nonStaff.actions.dismissMenuContext.enabled).toBe(true);
    expect(nonStaff.actions).not.toHaveProperty("replacePackageInDraft");
    expect(nonStaff.actions).not.toHaveProperty("replaceMenuItemInDraft");
    expect(nonStaff.actions).not.toHaveProperty("reorderMenuInDraft");
  });

  test("keeps read-only context available while edit-authority actions fail closed", () => {
    const model = buildAmbientLivingOpportunityPresentation(quote(), {
      source: "firebase",
      ordinaryEditAllowed: false,
      conversationAvailable: true,
      role: "viewer"
    });

    expect(model.actions.inspectGuestCount.enabled).toBe(true);
    expect(model.actions.simulateGuestCount).toMatchObject({
      enabled: false,
      disabledReason: expect.any(String)
    });
    expect(model.actions.stageGuestCount).toMatchObject({
      enabled: false,
      disabledReason: expect.any(String)
    });
    [
      "openGuestInlineEdit",
      "cancelGuestInlineEdit",
      "validateGuestCount",
      "keepGuestScenario",
      "openPricedEditor",
      "undoGuestScenario",
      "clearScenarioHistory",
      "clearGuestScenarioHistory",
      "useStaffingRecommendation",
      "stageStaffingInEditor",
      "undoStaffingScenario"
    ].forEach((key) => {
      expect(model.actions[key]).toMatchObject({
        enabled: false,
        disabledReason: expect.any(String)
      });
    });
    expect(model.guestObject.descriptor.permissions).toMatchObject({
      view: true,
      simulate: false,
      stage: false,
      commit: false
    });
    expect(model.staffingObject.descriptor.permissions).toMatchObject({
      view: true,
      simulate: false,
      stage: false,
      commit: false
    });
    expect(model.actions.inspectStaffing.enabled).toBe(true);
    expect(model.actions.keepCurrentStaffing.enabled).toBe(true);
    expect(model.nextAction.kind).toBe("caught_up");
    expect(model.nextAction.reason).toContain("ordinary editing is unavailable");
  });
});
