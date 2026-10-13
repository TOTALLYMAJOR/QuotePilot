import { createWorkspaceArrivalHandoff } from "./workspaceArrivalContract";

const DESTINATIONS = Object.freeze({
  proposal: Object.freeze({
    destination: "administration",
    objectType: "customer-decision-artifact",
    intentId: "review_commercial_proposal_consequence"
  }),
  kitchen_beo: Object.freeze({
    destination: "administration",
    objectType: "kitchen-beo",
    intentId: "review_kitchen_beo_consequence"
  }),
  production_plan: Object.freeze({
    destination: "schedule",
    objectType: "production-plan",
    intentId: "review_production_consequence"
  }),
  staffing_requirement: Object.freeze({
    destination: "opportunity",
    objectType: "staffing-plan",
    intentId: "review_staffing_consequence"
  }),
  inventory_ingredient: Object.freeze({
    destination: "inventory",
    objectType: "inventory-ingredient",
    intentId: "review_inventory_ingredient_consequence"
  })
});

function text(value) {
  return String(value ?? "").trim();
}

function recovery(code, reason) {
  return Object.freeze({
    ok: false,
    contract: null,
    navigation: null,
    recovery: Object.freeze({
      kind: "recovery",
      code,
      reason,
      consequence: "No workspace navigation occurred and the reviewed commercial change remains unchanged.",
      nextResolution: "Keep this review open and choose a current affected object again."
    })
  });
}

export function createCommercialConsequenceHandoff(target = {}, {
  expectedQuoteId = ""
} = {}) {
  const kind = text(target.kind);
  const destination = DESTINATIONS[kind];
  if (!destination) {
    return recovery("unsupported_consequence", "This commercial consequence has no exact destination consumer.");
  }

  const quoteId = text(target.quoteId);
  const sourceRevisionId = text(target.beforeRevisionId);
  const proposedRevisionId = text(target.proposedRevisionId);
  const returnFocusId = text(target.returnFocusId);
  if (
    !quoteId
    || (text(expectedQuoteId) && quoteId !== text(expectedQuoteId))
    || !sourceRevisionId
    || !proposedRevisionId
    || !returnFocusId
  ) {
    return recovery("invalid_consequence_scope", "The affected object is not bound to this exact quote, revision pair, and initiating control.");
  }

  const focus = { quoteId, sourceRevisionId, proposedRevisionId };
  let objectId = quoteId;
  if (kind === "inventory_ingredient") {
    const ingredientId = text(target.targetId);
    const baseUnitId = text(target.baseUnitId);
    if (!ingredientId || !baseUnitId) {
      return recovery("invalid_inventory_target", "The Inventory consequence does not identify one exact ingredient and base unit.");
    }
    objectId = ingredientId;
    focus.ingredientId = ingredientId;
    focus.baseUnitId = baseUnitId;
  }

  const handoff = createWorkspaceArrivalHandoff({
    destination: destination.destination,
    object: { id: objectId, type: destination.objectType },
    focus,
    intentId: destination.intentId
  });
  if (!handoff.ok) return handoff;
  return Object.freeze({
    ...handoff,
    returnFocus: Object.freeze({
      kind: "commercial-consequence",
      objectId: quoteId,
      actionId: `review-commercial-consequence:${kind}`,
      controlId: returnFocusId
    })
  });
}

export function isCommercialConsequenceArrival(context = null) {
  return Boolean(
    context
    && Object.values(DESTINATIONS).some((entry) => entry.intentId === context.intentId)
  );
}

export const COMMERCIAL_CONSEQUENCE_INTENTS = Object.freeze(
  Object.fromEntries(Object.entries(DESTINATIONS).map(([kind, entry]) => [kind, entry.intentId]))
);
