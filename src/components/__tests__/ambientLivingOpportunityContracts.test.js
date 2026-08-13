import { describe, expect, test } from "vitest";
import { createAmbientActionResult } from "../../lib/ambientContracts";
import { assessAmbientActionObservation } from "../../lib/ambientInteractionAudit";
import { buildAmbientLivingOpportunityPresentation } from "../ambientLivingOpportunityPresentation";

const QUOTE = Object.freeze({
  id: "quote-contract-alpha",
  quoteNumber: "Q-CONTRACT",
  status: "draft",
  customer: Object.freeze({ name: "Maya Bennett", email: "maya@example.test" }),
  event: Object.freeze({
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    venue: "The Foundry Hall",
    style: "Plated",
    guests: 120,
    servers: 8,
    chefs: 3
  }),
  selection: Object.freeze({ packageName: "Classic" }),
  totals: Object.freeze({ total: 8400 })
});

function packageMenuQuote() {
  return {
    ...QUOTE,
    organizationId: "org-contract",
    activeVersionId: "version-contract",
    updatedAtISO: "2026-08-11T18:00:00.000Z",
    selection: {
      packageId: "classic",
      packageName: "Classic",
      packageInclusions: {
        menuItems: [{ id: "salad", name: "Garden salad" }],
        addons: [],
        rentals: []
      },
      menuItems: ["salad", "chicken"],
      menuItemsSnapshot: [
        { id: "salad", name: "Garden salad", quantity: 2, includedInPackage: true },
        { id: "chicken", name: "Herb chicken", quantity: 3, includedInPackage: false }
      ],
      menuItemNames: ["Garden salad", "Herb chicken"],
      menuItemQuantities: { salad: 2, chicken: 3 }
    }
  };
}

function packageMenuCatalog(freshness = {
  state: "fresh",
  observedAtISO: "2026-08-11T18:01:00.000Z"
}) {
  return {
    organizationId: "org-contract",
    sourceLabel: "Exact tenant catalog",
    catalogRevision: 7,
    freshness,
    packages: [
      {
        id: "classic",
        name: "Classic",
        active: true,
        includedMenuItemIds: ["salad", "chicken"],
        includedAddonIds: [],
        includedRentalIds: []
      },
      {
        id: "premium",
        name: "Premium",
        active: true,
        includedMenuItemIds: ["salad", "chicken", "salmon"],
        includedAddonIds: [],
        includedRentalIds: []
      }
    ],
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

function resultFor(action, kind = "context") {
  return createAmbientActionResult({
    kind,
    actionId: action.id,
    object: action.arrivalContract.object,
    reason: action.arrivalContract.reason,
    consequence: action.arrivalContract.consequence,
    nextResolutions: action.arrivalContract.nextResolutionIds.map((actionId) => ({
      actionId,
      label: `Continue with ${actionId}`
    }))
  });
}

describe("Living Opportunity interaction contracts", () => {
  test("acknowledges a populated guest inspector inside the 250ms dead-click gate", () => {
    const model = buildAmbientLivingOpportunityPresentation(QUOTE, {
      source: "local",
      ordinaryEditAllowed: true,
      role: "sales"
    });
    const action = model.actions.inspectGuestCount;
    const audit = assessAmbientActionObservation({
      action,
      activatedAtMs: 1000,
      observedAtMs: 1040,
      acknowledgement: {
        atMs: 1012,
        result: resultFor(action),
        destination: {
          surface: model.surfaceContracts.guestContext,
          isEmpty: false
        }
      }
    });

    expect(audit).toMatchObject({
      state: "acknowledged",
      deadClick: false,
      acknowledgementMs: 12
    });
  });

  test("acknowledges Proposal context and governed-control routing with exact arrival scope", () => {
    const model = buildAmbientLivingOpportunityPresentation(QUOTE, {
      source: "local",
      sourceFreshness: "unknown",
      ordinaryEditAllowed: true,
      legacyControlsAvailable: true,
      role: "sales"
    });
    const inspect = model.actions.inspectProposal;
    const inspectAudit = assessAmbientActionObservation({
      action: inspect,
      activatedAtMs: 1000,
      observedAtMs: 1040,
      acknowledgement: {
        atMs: 1012,
        result: resultFor(inspect),
        destination: {
          surface: model.surfaceContracts.proposalContext,
          isEmpty: false
        }
      }
    });
    expect(inspectAudit).toMatchObject({
      state: "acknowledged",
      deadClick: false,
      acknowledgementMs: 12
    });

    const controls = model.actions.openProposalControls;
    const controlsAudit = assessAmbientActionObservation({
      action: controls,
      activatedAtMs: 2000,
      observedAtMs: 2050,
      acknowledgement: {
        atMs: 2020,
        result: resultFor(controls),
        destination: {
          surface: model.surfaceContracts.legacyOpportunityControls,
          isEmpty: false
        }
      }
    });
    expect(controlsAudit).toMatchObject({
      state: "acknowledged",
      deadClick: false,
      acknowledgementMs: 20
    });
    expect(controls.arrivalContract.object.type).toBe("customer-decision-artifact");

    const review = model.actions.reviewProposalInEditor;
    const reviewAudit = assessAmbientActionObservation({
      action: review,
      activatedAtMs: 3000,
      observedAtMs: 3050,
      acknowledgement: {
        atMs: 3024,
        result: resultFor(review, "pending"),
        destination: {
          surface: model.surfaceContracts.quoteEditor,
          isEmpty: false
        }
      }
    });
    expect(reviewAudit).toMatchObject({
      state: "acknowledged",
      deadClick: false,
      acknowledgementMs: 24
    });
  });

  test("acknowledges the populated Money inspector without collapsing payment evidence", () => {
    const model = buildAmbientLivingOpportunityPresentation(QUOTE, {
      source: "local",
      ordinaryEditAllowed: true,
      role: "sales"
    });
    const action = model.actions.inspectMoney;
    const audit = assessAmbientActionObservation({
      action,
      activatedAtMs: 1000,
      observedAtMs: 1040,
      acknowledgement: {
        atMs: 1012,
        result: resultFor(action),
        destination: {
          surface: model.surfaceContracts.moneyContext,
          isEmpty: false
        }
      }
    });

    expect(model.moneyObject.stages.map((stage) => stage.id)).toEqual([
      "deposit-policy",
      "deposit-request",
      "deposit-settlement",
      "balance-request",
      "final-settlement"
    ]);
    expect(action.arrivalContract).toMatchObject({
      object: { id: "money", type: "commercial-evidence" },
      nextResolutionIds: ["dismiss-money-context"]
    });
    expect(audit).toMatchObject({ state: "acknowledged", deadClick: false });
  });

  test("acknowledges populated Conversation evidence and its exact governed handoff", () => {
    const conversationQuote = {
      ...QUOTE,
      organizationId: "org-contract-alpha",
      activeVersionId: "version-contract-alpha",
      updatedAtISO: "2026-08-12T18:00:00.000Z",
      conversationSummary: {
        messageCount: 2,
        latestMessageId: "message-customer-contract",
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
      workflowHandlerAvailable: true
    });
    const inspect = model.actions.inspectConversation;
    const inspectAudit = assessAmbientActionObservation({
      action: inspect,
      activatedAtMs: 1000,
      observedAtMs: 1040,
      acknowledgement: {
        atMs: 1011,
        result: resultFor(inspect),
        destination: {
          surface: model.surfaceContracts.conversationContext,
          isEmpty: false
        }
      }
    });
    const resolution = model.actions.continueConversationResolution;
    const resolutionAudit = assessAmbientActionObservation({
      action: resolution,
      activatedAtMs: 2000,
      observedAtMs: 2050,
      acknowledgement: {
        atMs: 2015,
        result: resultFor(resolution, "pending"),
        destination: {
          surface: model.surfaceContracts.conversation,
          isEmpty: false
        }
      }
    });

    expect(inspect.arrivalContract).toMatchObject({
      object: { id: "conversation", type: "customer-communication-evidence" },
      nextResolutionIds: ["continue-conversation-resolution", "dismiss-conversation-context"]
    });
    expect(resolution.arrivalContract).toMatchObject({
      reason: expect.stringContaining("latest exact conversation message is customer-authored"),
      consequence: expect.stringContaining("does not acknowledge, resolve, or answer"),
      nextResolutionIds: ["review-opportunity-conversation"]
    });
    expect(inspectAudit).toMatchObject({ state: "acknowledged", deadClick: false });
    expect(resolutionAudit).toMatchObject({ state: "acknowledged", deadClick: false });
  });

  test("carries the opportunity arrival contract into the exact quote editor", () => {
    const model = buildAmbientLivingOpportunityPresentation(QUOTE, {
      source: "local",
      ordinaryEditAllowed: true,
      role: "sales"
    });
    const action = model.actions.primary;
    const audit = assessAmbientActionObservation({
      action,
      activatedAtMs: 2000,
      observedAtMs: 2070,
      acknowledgement: {
        atMs: 2015,
        result: resultFor(action),
        destination: {
          surface: model.surfaceContracts.quoteEditor,
          isEmpty: false
        }
      }
    });

    expect(action.arrivalContract).toMatchObject({
      object: { id: QUOTE.id, type: "opportunity" },
      reason: expect.any(String),
      consequence: expect.any(String),
      nextResolutionIds: expect.any(Array)
    });
    expect(audit.deadClick).toBe(false);
    expect(audit.reasonCodes).toEqual([]);
  });

  test("carries a Workflow blocker into the exact focused Workflow surface", () => {
    const model = buildAmbientLivingOpportunityPresentation({
      ...QUOTE,
      workflow: {
        approvalRequests: [{
          id: "approval-contract",
          action: "rotate_portal_link",
          state: "pending",
          requestedAtISO: "2026-08-10T12:00:00.000Z"
        }]
      }
    }, {
      source: "firebase",
      ordinaryEditAllowed: true,
      role: "sales",
      now: new Date("2026-08-11T12:00:00.000Z")
    });
    const action = model.actions.primary;
    const audit = assessAmbientActionObservation({
      action,
      activatedAtMs: 3000,
      observedAtMs: 3080,
      acknowledgement: {
        atMs: 3010,
        result: resultFor(action),
        destination: {
          surface: model.surfaceContracts.workflow,
          isEmpty: false
        }
      }
    });

    expect(action.executionTarget.surfaceId).toBe("workflow");
    expect(action.arrivalContract.nextResolutionIds).toEqual(["review-exact-workflow-item"]);
    expect(audit).toMatchObject({ state: "acknowledged", deadClick: false });
  });

  test("opens the inline guest editor with its exact populated surface contract", () => {
    const model = buildAmbientLivingOpportunityPresentation(QUOTE, {
      source: "local",
      ordinaryEditAllowed: true,
      role: "sales"
    });
    const action = model.actions.openGuestInlineEdit;
    const audit = assessAmbientActionObservation({
      action,
      activatedAtMs: 4000,
      observedAtMs: 4060,
      acknowledgement: {
        atMs: 4010,
        result: resultFor(action),
        destination: {
          surface: model.surfaceContracts.guestInlineEditor,
          isEmpty: false
        }
      }
    });

    expect(action.arrivalContract.nextResolutionIds).toEqual([
      "simulate-guest-count",
      "cancel-guest-count-inline-edit"
    ]);
    expect(audit).toMatchObject({
      state: "acknowledged",
      deadClick: false,
      acknowledgementMs: 10
    });
  });

  test("represents the legacy handoff without enabling it by default", () => {
    const unavailable = buildAmbientLivingOpportunityPresentation(QUOTE, {
      source: "local",
      ordinaryEditAllowed: true,
      role: "sales"
    });
    const supplied = buildAmbientLivingOpportunityPresentation(QUOTE, {
      source: "local",
      ordinaryEditAllowed: true,
      legacyControlsAvailable: true,
      role: "sales"
    });
    const action = supplied.actions.openLegacyControls;
    const audit = assessAmbientActionObservation({
      action,
      activatedAtMs: 5000,
      observedAtMs: 5080,
      acknowledgement: {
        atMs: 5014,
        result: resultFor(action),
        destination: {
          surface: supplied.surfaceContracts.legacyOpportunityControls,
          isEmpty: false
        }
      }
    });

    expect(unavailable.actions.openLegacyControls).toMatchObject({
      enabled: false,
      disabledReason: expect.any(String)
    });
    expect(audit).toMatchObject({ state: "acknowledged", deadClick: false });
  });

  test("opens deterministic staffing guidance in its exact populated context", () => {
    const model = buildAmbientLivingOpportunityPresentation(QUOTE, {
      source: "local",
      ordinaryEditAllowed: true,
      role: "sales"
    });
    const action = model.actions.inspectStaffing;
    const audit = assessAmbientActionObservation({
      action,
      activatedAtMs: 6000,
      observedAtMs: 6080,
      acknowledgement: {
        atMs: 6011,
        result: resultFor(action),
        destination: {
          surface: model.surfaceContracts.staffingContext,
          isEmpty: false
        }
      }
    });

    expect(action.arrivalContract).toMatchObject({
      object: { id: "staffing", type: "intelligent-object" },
      reason: expect.stringContaining("Plated staffing guide"),
      consequence: expect.stringContaining("Review labor price"),
      nextResolutionIds: ["use-staffing-recommendation", "keep-current-staffing"]
    });
    expect(audit).toMatchObject({
      state: "acknowledged",
      deadClick: false,
      acknowledgementMs: 11
    });
  });

  test.each([
    ["inspectPackage", "packageContext", "package"],
    ["inspectMenu", "menuContext", "menu"]
  ])("acknowledges %s inside its exact populated context", (actionKey, surfaceKey, objectId) => {
    const model = buildAmbientLivingOpportunityPresentation(packageMenuQuote(), {
      source: "firebase",
      ordinaryEditAllowed: true,
      role: "sales",
      packageMenuCatalogEvidence: packageMenuCatalog()
    });
    const action = model.actions[actionKey];
    const audit = assessAmbientActionObservation({
      action,
      activatedAtMs: 7000,
      observedAtMs: 7080,
      acknowledgement: {
        atMs: 7013,
        result: resultFor(action),
        destination: {
          surface: model.surfaceContracts[surfaceKey],
          isEmpty: false
        }
      }
    });

    expect(model[`${objectId}Object`]).toMatchObject({
      id: objectId,
      permissions: { view: true }
    });
    expect(model.surfaceContracts[surfaceKey]).toMatchObject({
      objectScopes: ["intelligent-object"],
      allowedEmptyState: null
    });
    expect(audit).toMatchObject({
      state: "acknowledged",
      deadClick: false,
      acknowledgementMs: 13
    });
  });

  test("publishes exact draft-stage actions only for kernel-permitted package/menu intents", () => {
    const model = buildAmbientLivingOpportunityPresentation(packageMenuQuote(), {
      source: "firebase",
      ordinaryEditAllowed: true,
      role: "admin",
      packageMenuCatalogEvidence: packageMenuCatalog()
    });
    const expected = [
      ["replacePackageInDraft", model.packageObject.intentContract],
      ["replaceMenuItemInDraft", model.menuObject.intentContracts.replace],
      ["reorderMenuInDraft", model.menuObject.intentContracts.reorder]
    ];

    expected.forEach(([key, intent], index) => {
      const action = model.actions[key];
      expect(intent).toMatchObject({
        enabled: true,
        authority: "draft_only",
        commit: false,
        baseContext: {
          quoteId: QUOTE.id,
          organizationId: "org-contract",
          baseRevisionId: "version-contract",
          catalogRevision: 7
        },
        consequencePreviewRequired: true,
        requiresOutcomeNamedSave: true
      });
      expect(action).toMatchObject({
        id: intent.actionId,
        authorityLevel: "draft",
        previewPolicy: "required",
        executionTarget: {
          kind: "draft_mutation",
          targetId: QUOTE.id,
          surfaceId: "quote-editor"
        },
        enabled: true,
        disabledReason: null
      });
      const audit = assessAmbientActionObservation({
        action,
        activatedAtMs: 8000 + index * 100,
        observedAtMs: 8080 + index * 100,
        acknowledgement: {
          atMs: 8014 + index * 100,
          result: resultFor(action, "pending")
        }
      });
      expect(audit).toMatchObject({ state: "acknowledged", deadClick: false });
    });
  });

  test("omits draft-stage actions when catalog freshness or staff edit authority is insufficient", () => {
    const stale = buildAmbientLivingOpportunityPresentation(packageMenuQuote(), {
      source: "firebase",
      ordinaryEditAllowed: true,
      role: "sales",
      packageMenuCatalogEvidence: packageMenuCatalog({
        state: "stale",
        observedAtISO: "2026-08-10T18:01:00.000Z",
        reason: "The operator catalog may have changed."
      })
    });
    const viewOnly = buildAmbientLivingOpportunityPresentation(packageMenuQuote(), {
      source: "firebase",
      ordinaryEditAllowed: false,
      role: "sales",
      packageMenuCatalogEvidence: packageMenuCatalog()
    });
    const nonStaff = buildAmbientLivingOpportunityPresentation(packageMenuQuote(), {
      source: "firebase",
      ordinaryEditAllowed: true,
      role: "viewer",
      packageMenuCatalogEvidence: packageMenuCatalog()
    });

    [stale, viewOnly, nonStaff].forEach((model) => {
      expect(model.actions).not.toHaveProperty("replacePackageInDraft");
      expect(model.actions).not.toHaveProperty("replaceMenuItemInDraft");
      expect(model.actions).not.toHaveProperty("reorderMenuInDraft");
    });
    expect(stale.actions.inspectPackage.enabled).toBe(true);
    expect(viewOnly.actions.inspectMenu.enabled).toBe(true);
    expect(nonStaff.actions.inspectPackage).toMatchObject({
      enabled: false,
      disabledReason: expect.stringContaining("Staff role is required")
    });
  });
});
