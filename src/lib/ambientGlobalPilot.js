import {
  createAmbientAction,
  createSurfacePurposeContract
} from "./ambientContracts.js";
import {
  GLOBAL_PILOT_OBJECT,
  OPPORTUNITIES_OBJECT
} from "./ambientGlobalPilotTarget.js";

export { resolveAmbientGlobalPilotTarget } from "./ambientGlobalPilotTarget.js";

export const AMBIENT_GLOBAL_PILOT_ACTION = createAmbientAction({
  id: "open-global-pilot-context",
  outcomeLabel: "Open Pilot context",
  purpose: "reveal_context",
  roles: ["admin", "sales"],
  authorityLevel: "presentation",
  previewPolicy: "none",
  executionTarget: {
    kind: "context",
    targetId: "global-pilot",
    surfaceId: "ambient-global-pilot-context"
  },
  receiptType: "context",
  reversibility: {
    kind: "none",
    actionId: null,
    windowMs: null
  },
  arrivalContract: {
    object: GLOBAL_PILOT_OBJECT,
    reason: "Reveal Pilot guidance for the exact object or workspace context already in view.",
    consequence: "Pilot may reveal context or move focus, but this action cannot mutate, communicate, or save data.",
    nextResolutionIds: ["explain-next-action", "focus-pilot-command", "open-opportunities"]
  },
  primary: false,
  enabled: true
});

export const AMBIENT_GLOBAL_PILOT_DISMISS_ACTION = createAmbientAction({
  id: "dismiss-global-pilot-context",
  outcomeLabel: "Close Pilot context",
  purpose: "resolve",
  roles: ["admin", "sales"],
  authorityLevel: "presentation",
  previewPolicy: "none",
  executionTarget: {
    kind: "context",
    targetId: "global-pilot",
    surfaceId: "workspace"
  },
  receiptType: "resolved",
  reversibility: { kind: "none", actionId: null, windowMs: null },
  arrivalContract: {
    object: GLOBAL_PILOT_OBJECT,
    reason: "Close the populated Pilot context and restore focus to its global trigger.",
    consequence: "The workspace object in view remains unchanged.",
    nextResolutionIds: ["open-global-pilot-context", "open-opportunities"]
  },
  primary: false,
  enabled: true
});

export const AMBIENT_GLOBAL_PILOT_CHOOSE_ACTION = createAmbientAction({
  id: "open-opportunities",
  outcomeLabel: "Choose an opportunity",
  purpose: "reveal_context",
  roles: ["admin", "sales"],
  authorityLevel: "presentation",
  previewPolicy: "none",
  executionTarget: {
    kind: "route",
    targetId: "opportunities",
    surfaceId: "opportunities"
  },
  receiptType: "context",
  reversibility: { kind: "none", actionId: null, windowMs: null },
  arrivalContract: {
    object: OPPORTUNITIES_OBJECT,
    reason: "Choose the exact opportunity Pilot should use as context.",
    consequence: "The opportunity stream opens without changing any quote, customer, or provider state.",
    nextResolutionIds: ["open-opportunity"]
  },
  primary: false,
  enabled: true
});

export const AMBIENT_GLOBAL_PILOT_SURFACE_CONTRACT = createSurfacePurposeContract({
  id: "ambient-global-pilot-context",
  objectScopes: [
    "workspace-intelligence",
    "opportunity",
    "opportunity-collection",
    "quote-draft"
  ],
  purposes: ["clarify", "reveal_context", "resolve"],
  entryReason: "Keep Pilot grounded in the exact opportunity, draft, or workspace context already in view.",
  allowedEmptyState: {
    kind: "starting_action",
    message: "Choose an opportunity before asking Pilot for object-specific guidance.",
    actionId: "open-opportunities"
  },
  recoveryBehavior: {
    message: "Keep the current workspace state unchanged and offer one exact next step.",
    nextActionIds: ["open-opportunities", "dismiss-global-pilot-context"]
  }
});
