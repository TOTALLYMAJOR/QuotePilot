/**
 * Fail-closed execution policy for Pilot command classes.
 *
 * This module grants no server authority. It only decides whether a command
 * class may reach an already-existing presentation, draft, or simulation
 * handler in the v1 Pilot boundary. Trusted mutations, communications, bulk
 * actions, and destructive actions remain classified but non-executable.
 */

export const PILOT_COMMAND_POLICY_MODEL = "pilot-command-policy-v1";

export const PILOT_COMMAND_CLASSES = Object.freeze([
  "navigation",
  "query",
  "draft_mutation",
  "simulation",
  "trusted_mutation",
  "communication",
  "bulk_action",
  "destructive_action"
]);

export const PILOT_V1_EXECUTABLE_COMMAND_CLASSES = Object.freeze([
  "navigation",
  "query",
  "draft_mutation",
  "simulation"
]);

const AUTHORITY_LEVELS = Object.freeze([
  "presentation",
  "draft",
  "trusted",
  "provider",
  "destructive"
]);

const COMMAND_CLASS_DEFINITIONS = Object.freeze({
  navigation: Object.freeze({
    label: "Navigation",
    maximumAuthority: "presentation",
    previewRequired: false,
    confirmationRequired: false,
    blockedReason: ""
  }),
  query: Object.freeze({
    label: "Query",
    maximumAuthority: "presentation",
    previewRequired: false,
    confirmationRequired: false,
    blockedReason: ""
  }),
  draft_mutation: Object.freeze({
    label: "Draft mutation",
    maximumAuthority: "draft",
    previewRequired: true,
    confirmationRequired: true,
    blockedReason: ""
  }),
  simulation: Object.freeze({
    label: "Simulation",
    maximumAuthority: "draft",
    previewRequired: false,
    confirmationRequired: true,
    blockedReason: ""
  }),
  trusted_mutation: Object.freeze({
    label: "Trusted mutation",
    maximumAuthority: "trusted",
    previewRequired: true,
    confirmationRequired: true,
    blockedReason: "Pilot v1 cannot execute trusted mutations. Use the exact governed workflow."
  }),
  communication: Object.freeze({
    label: "Communication",
    maximumAuthority: "provider",
    previewRequired: true,
    confirmationRequired: true,
    blockedReason: "Pilot v1 cannot send customer or provider communications. Use the exact communication workflow."
  }),
  bulk_action: Object.freeze({
    label: "Bulk action",
    maximumAuthority: "trusted",
    previewRequired: true,
    confirmationRequired: true,
    blockedReason: "Pilot v1 cannot execute bulk actions. Review each governed scope outside Pilot."
  }),
  destructive_action: Object.freeze({
    label: "Destructive action",
    maximumAuthority: "destructive",
    previewRequired: true,
    confirmationRequired: true,
    blockedReason: "Pilot v1 cannot execute destructive actions. Use the exact role-gated workflow."
  })
});

const DRAFT_PROPOSAL_KINDS = Object.freeze(new Set([
  "set_guests",
  "add_staff",
  "set_hours",
  "set_style",
  "set_package",
  "remove_item",
  "add_item",
  "swap_item"
]));

function normalizedEnum(value, allowed) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : "";
}

function frozenDecision(value) {
  return Object.freeze({
    modelId: PILOT_COMMAND_POLICY_MODEL,
    ...value
  });
}

export function getPilotCommandClassDefinition(commandClass) {
  const normalizedClass = normalizedEnum(commandClass, PILOT_COMMAND_CLASSES);
  if (!normalizedClass) return null;
  return Object.freeze({
    commandClass: normalizedClass,
    executableInV1: PILOT_V1_EXECUTABLE_COMMAND_CLASSES.includes(normalizedClass),
    ...COMMAND_CLASS_DEFINITIONS[normalizedClass]
  });
}

export function authorizePilotV1Command({
  commandClass,
  authorityLevel,
  previewAvailable = false,
  confirmed = false
} = {}) {
  const definition = getPilotCommandClassDefinition(commandClass);
  const normalizedAuthority = normalizedEnum(authorityLevel, AUTHORITY_LEVELS);

  if (!definition) {
    return frozenDecision({
      allowed: false,
      commandClass: "unclassified",
      authorityLevel: normalizedAuthority || "unclassified",
      reason: "Pilot could not classify this command, so nothing was executed."
    });
  }
  if (!normalizedAuthority) {
    return frozenDecision({
      allowed: false,
      commandClass: definition.commandClass,
      authorityLevel: "unclassified",
      reason: "Pilot could not verify the command authority, so nothing was executed."
    });
  }
  if (!definition.executableInV1) {
    return frozenDecision({
      allowed: false,
      commandClass: definition.commandClass,
      authorityLevel: normalizedAuthority,
      reason: definition.blockedReason
    });
  }
  if (normalizedAuthority !== definition.maximumAuthority) {
    return frozenDecision({
      allowed: false,
      commandClass: definition.commandClass,
      authorityLevel: normalizedAuthority,
      reason: `Pilot expected ${definition.maximumAuthority} authority for this ${definition.label.toLowerCase()} command.`
    });
  }
  if (definition.previewRequired && previewAvailable !== true) {
    return frozenDecision({
      allowed: false,
      commandClass: definition.commandClass,
      authorityLevel: normalizedAuthority,
      reason: "Pilot must show the exact draft preview before this command can be staged."
    });
  }
  if (definition.confirmationRequired && confirmed !== true) {
    return frozenDecision({
      allowed: false,
      commandClass: definition.commandClass,
      authorityLevel: normalizedAuthority,
      reason: "Pilot requires an explicit outcome confirmation before this command can run."
    });
  }

  return frozenDecision({
    allowed: true,
    commandClass: definition.commandClass,
    authorityLevel: normalizedAuthority,
    reason: "This command may continue to its existing bounded handler."
  });
}

export function classifyPilotDraftProposal(proposal) {
  const kind = String(proposal?.kind || "").trim().toLowerCase();
  const supported = DRAFT_PROPOSAL_KINDS.has(kind);
  const decision = supported
    ? authorizePilotV1Command({
        commandClass: "draft_mutation",
        authorityLevel: "draft",
        previewAvailable: true,
        confirmed: true
      })
    : authorizePilotV1Command({
        commandClass: "",
        authorityLevel: "draft",
        previewAvailable: true,
        confirmed: true
      });

  return frozenDecision({
    proposalKind: kind || "unclassified",
    commandClass: supported ? "draft_mutation" : "unclassified",
    authorityLevel: "draft",
    previewRequired: true,
    explicitConfirmationRequired: true,
    supported,
    allowed: supported && decision.allowed,
    reason: supported
      ? "This deterministic proposal may stage the current draft after its exact preview is confirmed. Saving remains a separate trusted action."
      : "Pilot does not recognize this proposal kind, so nothing can be staged."
  });
}
