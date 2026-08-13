import { WORKSPACE_ROUTE_IDS } from "./workspaceRoutes.js";

export const GLOBAL_PILOT_OBJECT = Object.freeze({
  id: "global-pilot",
  type: "workspace-intelligence",
  label: "Pilot"
});

const NEW_DRAFT_OBJECT = Object.freeze({
  id: "new-draft",
  type: "quote-draft",
  label: "New quote draft"
});

export const OPPORTUNITIES_OBJECT = Object.freeze({
  id: "opportunities",
  type: "opportunity-collection",
  label: "Opportunities"
});

const ROUTE_LABELS = Object.freeze({
  [WORKSPACE_ROUTE_IDS.HOME]: "Now",
  [WORKSPACE_ROUTE_IDS.CUSTOMER_LIST]: "Clients",
  [WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL]: "Client",
  [WORKSPACE_ROUTE_IDS.QUOTE_LIST]: "Opportunities",
  [WORKSPACE_ROUTE_IDS.QUOTE_NEW]: "New quote",
  [WORKSPACE_ROUTE_IDS.QUOTE_DETAIL]: "Living Opportunity",
  [WORKSPACE_ROUTE_IDS.QUOTE_EDIT]: "Quote editor",
  [WORKSPACE_ROUTE_IDS.MESSAGING]: "Messages",
  [WORKSPACE_ROUTE_IDS.WORKFLOW]: "Workflow",
  [WORKSPACE_ROUTE_IDS.SCHEDULE]: "Schedule",
  [WORKSPACE_ROUTE_IDS.REPORTING]: "Reporting",
  [WORKSPACE_ROUTE_IDS.CATALOG]: "Library",
  [WORKSPACE_ROUTE_IDS.IMPORTS]: "Imports",
  [WORKSPACE_ROUTE_IDS.INTEGRATIONS]: "Integrations",
  [WORKSPACE_ROUTE_IDS.DIAGNOSTICS]: "Diagnostics",
  [WORKSPACE_ROUTE_IDS.NOT_FOUND]: "Workspace",
  [WORKSPACE_ROUTE_IDS.OUTSIDE]: "Workspace",
  [WORKSPACE_ROUTE_IDS.PORTAL]: "Customer decision room"
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function exactObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = text(value.id);
  const type = text(value.type);
  const label = text(value.label);
  if (!id || !type || !label) return null;
  return { id, type, label };
}

function targetModel({
  target,
  routeId,
  routeLabel,
  object,
  reason,
  consequence,
  nextResolution
}) {
  return deepFreeze({
    target,
    routeId,
    routeLabel,
    object: { ...object },
    reason,
    consequence,
    nextResolution: { ...nextResolution }
  });
}

/**
 * Resolves where the global Pilot trigger should place attention.
 *
 * This is a presentation-only decision. It performs no I/O, reads no tenant
 * data, and grants no command or mutation authority.
 */
export function resolveAmbientGlobalPilotTarget({
  routeId,
  opportunityId,
  draftObject,
  pilotCommandEnabled
} = {}) {
  const normalizedRouteId = text(routeId) || WORKSPACE_ROUTE_IDS.OUTSIDE;
  const routeLabel = ROUTE_LABELS[normalizedRouteId] || "Workspace";
  const normalizedOpportunityId = text(opportunityId);

  if (normalizedRouteId === WORKSPACE_ROUTE_IDS.QUOTE_DETAIL) {
    if (!normalizedOpportunityId) {
      return targetModel({
        target: "recovery",
        routeId: normalizedRouteId,
        routeLabel,
        object: GLOBAL_PILOT_OBJECT,
        reason: "The current opportunity could not be identified.",
        consequence: "No other opportunity will be guessed or opened.",
        nextResolution: {
          id: "open-opportunities",
          label: "Choose an opportunity"
        }
      });
    }

    return targetModel({
      target: "living_opportunity",
      routeId: normalizedRouteId,
      routeLabel,
      object: {
        id: normalizedOpportunityId,
        type: "opportunity",
        label: "Selected opportunity"
      },
      reason: "Pilot can explain what matters on this opportunity.",
      consequence: "Pilot opens the opportunity's existing explanation and next step. Nothing in the quote changes.",
      nextResolution: {
        id: "explain-next-action",
        label: "Review why this matters"
      }
    });
  }

  if (
    normalizedRouteId === WORKSPACE_ROUTE_IDS.QUOTE_NEW
    || normalizedRouteId === WORKSPACE_ROUTE_IDS.QUOTE_EDIT
  ) {
    const object = exactObject(draftObject) || NEW_DRAFT_OBJECT;
    if (pilotCommandEnabled === true) {
      return targetModel({
        target: "draft_command",
        routeId: normalizedRouteId,
        routeLabel,
        object,
        reason: "Pilot can work from the draft already open in the quote editor.",
        consequence: "Your cursor moves to Pilot; nothing is previewed, added to the draft, or saved until you ask.",
        nextResolution: {
          id: "focus-pilot-command",
          label: "Ask about this draft"
        }
      });
    }

    return targetModel({
      target: "recovery",
      routeId: normalizedRouteId,
      routeLabel,
      object,
      reason: "Pilot is not available for this draft in this build.",
      consequence: "The open draft remains unchanged and no command is inferred or staged.",
      nextResolution: {
        id: "continue-editing",
        label: "Continue editing"
      }
    });
  }

  return targetModel({
    target: "choose_opportunity",
    routeId: normalizedRouteId,
    routeLabel,
    object: OPPORTUNITIES_OBJECT,
    reason: `Choose an opportunity to see guidance based on its saved details here in ${routeLabel}.`,
    consequence: "No guidance appears until you choose one. Nothing in the workspace changes.",
    nextResolution: {
      id: "open-opportunities",
      label: "Choose an opportunity"
    }
  });
}
