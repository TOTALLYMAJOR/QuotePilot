import {
  buildCustomerPath,
  buildMessagingPath,
  buildQuotePath,
  buildWorkflowPath,
  parseWorkspaceLocation,
  WORKSPACE_PATHS,
  WORKSPACE_ROUTE_IDS
} from "./workspaceRoutes";

/**
 * Pure transport contract for object-scoped workspace arrivals.
 *
 * The contract deliberately accepts semantic IDs rather than caller-authored
 * display text. This keeps customer names, message contents, and other free
 * prose out of both URLs and browser history state. It grants no data or
 * mutation authority.
 */

export const WORKSPACE_ARRIVAL_CONTRACT_MODEL = "workspace-arrival-contract-v1";

const STATE_KEY = "ambientArrival";
const MAX_ID_LENGTH = 160;
const MAX_QUERY_LENGTH = 768;
const MAX_SERIALIZED_STATE_LENGTH = 4096;

const DESTINATIONS = /* @__PURE__ */ Object.freeze([
  "client",
  "opportunity",
  "administration",
  "workflow",
  "approval",
  "messages",
  "schedule",
  "reporting",
  "library"
]);

const WORKFLOW_ATTENTION_TYPES = /* @__PURE__ */ Object.freeze([
  "change_request",
  "follow_up",
  "approval",
  "post_event_closeout",
  "decision_debt",
  "unread_customer_reply",
  "anniversary_rebooking"
]);

const REPORT_SCOPES = /* @__PURE__ */ Object.freeze(["opportunity", "pipeline", "operations"]);

const OBJECT_TYPE_LABELS = /* @__PURE__ */ Object.freeze({
  client: "Client",
  opportunity: "Opportunity",
  "workflow-item": "Workflow item",
  approval: "Approval",
  "customer-workflow-evidence": "Customer workflow evidence",
  "staff-workflow-evidence": "Staff workflow evidence",
  "customer-communication-evidence": "Conversation",
  "schedule-item": "Schedule item",
  "event-logistics-evidence": "Event logistics evidence",
  "operational-evidence": "Operational evidence",
  "report-signal": "Reporting signal",
  "commercial-evidence": "Commercial evidence",
  "payment-evidence": "Payment",
  "customer-decision-artifact": "Proposal",
  "intelligent-object": "Intelligent object",
  "organization-library": "Organization Library",
  "library-section": "Library section",
  "event-template": "Event template"
});

const DESTINATION_OBJECT_TYPES = /* @__PURE__ */ (() => Object.freeze({
  client: Object.freeze(["client"]),
  opportunity: Object.freeze(["opportunity"]),
  administration: Object.freeze([
    "opportunity",
    "payment-evidence",
    "customer-decision-artifact"
  ]),
  workflow: Object.freeze([
    "opportunity",
    "workflow-item",
    "customer-workflow-evidence",
    "staff-workflow-evidence",
    "customer-communication-evidence"
  ]),
  approval: Object.freeze([
    "opportunity",
    "approval",
    "workflow-item",
    "customer-workflow-evidence"
  ]),
  messages: Object.freeze([
    "opportunity",
    "customer-communication-evidence"
  ]),
  schedule: Object.freeze([
    "opportunity",
    "schedule-item",
    "event-logistics-evidence",
    "operational-evidence",
    "intelligent-object"
  ]),
  reporting: Object.freeze([
    "opportunity",
    "report-signal",
    "commercial-evidence",
    "operational-evidence",
    "intelligent-object"
  ]),
  library: Object.freeze([
    "organization-library",
    "library-section",
    "event-template"
  ])
}))();

const INTENTS = /* @__PURE__ */ (() => Object.freeze({
  client: Object.freeze({
    review_client: Object.freeze({
      reasonId: "exact_client_selected",
      reason: "The exact client was selected for relationship review.",
      consequenceId: "client_record_remains_unchanged",
      consequence: "Opening the client overview changes no client, quote, conversation, payment, booking, or provider evidence.",
      resolutionId: "review_client_relationship",
      resolution: "Review the client relationship and choose the available next step."
    })
  }),
  opportunity: Object.freeze({
    review_opportunity: Object.freeze({
      reasonId: "exact_opportunity_selected",
      reason: "The exact opportunity was selected for review.",
      consequenceId: "opportunity_remains_unchanged",
      consequence: "Opening the Living Opportunity changes no quote, pricing, customer, or operational evidence.",
      resolutionId: "review_living_opportunity",
      resolution: "Review the opportunity state and choose its available next resolution."
    }),
    review_proposal_gap: Object.freeze({
      reasonId: "recorded_proposal_gap_selected",
      reason: "A recorded proposal gap was selected for review.",
      consequenceId: "proposal_gap_remains_open",
      consequence: "The proposal gap remains open; navigation does not stage, save, or send anything.",
      resolutionId: "review_proposal_gap_in_opportunity",
      resolution: "Review the proposal evidence and choose an available resolution for the gap."
    })
  }),
  administration: Object.freeze({
    review_quote_controls: Object.freeze({
      reasonId: "exact_quote_controls_selected",
      reason: "The exact quote controls were selected for review.",
      consequenceId: "quote_controls_remain_unchanged",
      consequence: "Opening Quote administration changes no quote, pricing, proposal, payment, delivery, booking, or provider evidence.",
      resolutionId: "review_exact_quote_controls",
      resolution: "Review the exact role-safe quote controls and choose an available action.",
      objectTypes: Object.freeze(["opportunity"])
    }),
    review_payment_controls: Object.freeze({
      reasonId: "exact_payment_controls_selected",
      reason: "The exact opportunity payment controls were selected for review.",
      consequenceId: "payment_evidence_remains_unchanged",
      consequence: "Opening Quote administration does not request, collect, reconcile, or settle anything and changes no pricing or payment evidence.",
      resolutionId: "review_exact_payment_controls",
      resolution: "Review the exact quote's payment controls; any available action must recheck current role and provider evidence.",
      objectTypes: Object.freeze(["payment-evidence"])
    }),
    review_proposal_controls: Object.freeze({
      reasonId: "exact_proposal_controls_selected",
      reason: "The exact opportunity proposal controls were selected for review.",
      consequenceId: "proposal_evidence_remains_unchanged",
      consequence: "Opening Quote administration does not prepare, send, replace, retry, or recover anything and changes no proposal or delivery evidence.",
      resolutionId: "review_exact_proposal_controls",
      resolution: "Review the exact quote's proposal controls; any available action must recheck current role, revision, pricing, link, and delivery evidence.",
      objectTypes: Object.freeze(["customer-decision-artifact"])
    })
  }),
  workflow: Object.freeze({
    review_workflow_item: Object.freeze({
      reasonId: "recorded_workflow_item_selected",
      reason: "A recorded Workflow item was selected for review.",
      consequenceId: "workflow_item_remains_unresolved",
      consequence: "The item remains unresolved; opening Workflow does not change its status.",
      resolutionId: "review_role_gated_workflow_outcome",
      resolution: "Review the focused item and choose the next step available to your role.",
      attentionTypes: Object.freeze(WORKFLOW_ATTENTION_TYPES.filter((type) => type !== "approval"))
    }),
    review_customer_request: Object.freeze({
      reasonId: "recorded_customer_request_selected",
      reason: "A recorded customer request was selected for staff review.",
      consequenceId: "customer_request_remains_unresolved",
      consequence: "The request remains unresolved; navigation does not stage or save a quote change.",
      resolutionId: "review_customer_request_evidence",
      resolution: "Review the focused request and choose a response available to your role.",
      attentionTypes: Object.freeze(["change_request"])
    }),
    review_follow_up: Object.freeze({
      reasonId: "recorded_follow_up_selected",
      reason: "A recorded follow-up was selected for review.",
      consequenceId: "follow_up_remains_open",
      consequence: "The follow-up remains open; opening Workflow does not contact the customer.",
      resolutionId: "review_follow_up_outcome",
      resolution: "Review the focused follow-up and choose the next step available to your role.",
      attentionTypes: Object.freeze([
        "follow_up",
        "post_event_closeout",
        "anniversary_rebooking"
      ])
    }),
    review_decision_debt: Object.freeze({
      reasonId: "recorded_decision_debt_selected",
      reason: "A recorded quote decision was selected for review.",
      consequenceId: "decision_debt_remains_open",
      consequence: "The recorded decision remains open; navigation does not acknowledge or resolve it.",
      resolutionId: "review_decision_debt_evidence",
      resolution: "Review the focused details and choose the next step available to your role.",
      attentionTypes: Object.freeze(["decision_debt"])
    }),
    review_customer_reply: Object.freeze({
      reasonId: "recorded_customer_reply_selected",
      reason: "A recorded customer reply was selected for workflow review.",
      consequenceId: "customer_reply_remains_unresolved",
      consequence: "The reply remains unresolved; opening Workflow does not answer or mark it read.",
      resolutionId: "review_customer_reply_workflow",
      resolution: "Review the focused reply and choose a response available to your role.",
      attentionTypes: Object.freeze(["unread_customer_reply"])
    })
  }),
  approval: Object.freeze({
    review_approval: Object.freeze({
      reasonId: "recorded_approval_selected",
      reason: "A recorded approval request was selected for review.",
      consequenceId: "approval_remains_pending",
      consequence: "The approval remains pending; navigation does not approve, reject, or execute it.",
      resolutionId: "review_role_gated_approval",
      resolution: "Review the focused approval and choose the next step available to your role."
    })
  }),
  messages: Object.freeze({
    review_conversation: Object.freeze({
      reasonId: "opportunity_conversation_selected",
      reason: "The opportunity conversation was selected for review.",
      consequenceId: "conversation_remains_unchanged",
      consequence: "Opening the thread sends nothing and marks no message read.",
      resolutionId: "review_quote_scoped_conversation",
      resolution: "Review the quote-scoped thread and choose an available communication action.",
      requiresMessageId: false
    }),
    review_customer_reply: Object.freeze({
      reasonId: "customer_reply_thread_selected",
      reason: "An exact customer reply in this quote-scoped thread was selected for review.",
      consequenceId: "customer_reply_remains_unanswered",
      consequence: "The reply remains unanswered; focusing it sends nothing and marks nothing read.",
      resolutionId: "review_reply_in_conversation",
      resolution: "Review the focused customer reply and choose an available communication action.",
      requiresMessageId: true
    })
  }),
  schedule: Object.freeze({
    review_event_schedule: Object.freeze({
      reasonId: "opportunity_schedule_selected",
      reason: "The opportunity schedule was selected for review.",
      consequenceId: "schedule_remains_unchanged",
      consequence: "Schedule opens the exact accepted or booked opportunity without changing schedule details or assignments.",
      resolutionId: "review_exact_schedule_opportunity",
      resolution: "Review the focused event details and choose an available schedule action.",
      focusConsumerState: "supported",
      consumerObjectTypes: Object.freeze(["opportunity", "schedule-item"])
    }),
    review_staffing_schedule: Object.freeze({
      reasonId: "staffing_schedule_selected",
      reason: "The opportunity staffing schedule was selected for review.",
      consequenceId: "staffing_focus_consumer_pending",
      consequence: "Schedule cannot verify authoritative operational staffing from its legacy staff-lead field; no staffing assignment changes.",
      resolutionId: "retain_authoritative_staffing_context",
      resolution: "Keep the staffing object open until an exact operational-staffing destination is available."
    }),
    review_schedule_conflict: Object.freeze({
      reasonId: "schedule_conflict_selected",
      reason: "A recorded schedule conflict was selected for review.",
      consequenceId: "schedule_conflict_remains_unresolved",
      consequence: "Schedule focuses the exact opportunity only while current complete schedule evidence still records a conflict; the conflict remains unresolved.",
      resolutionId: "review_exact_schedule_conflict",
      resolution: "Review the focused event and choose an available action for the recorded conflict.",
      focusConsumerState: "supported",
      consumerObjectTypes: Object.freeze(["schedule-item"])
    })
  }),
  reporting: Object.freeze({
    review_opportunity_report: Object.freeze({
      reasonId: "opportunity_report_selected",
      reason: "An opportunity reporting view was selected for review.",
      consequenceId: "opportunity_report_remains_observational",
      consequence: "Reporting opens the exact opportunity summary without changing the quote or aggregate measures.",
      resolutionId: "review_exact_opportunity_summary",
      resolution: "Review the focused opportunity summary and its recorded quote and pricing state.",
      reportScopes: Object.freeze(["opportunity"]),
      reportSignals: Object.freeze(["opportunity-summary"]),
      defaultReportSignal: "opportunity-summary",
      requiresQuoteId: true,
      focusConsumerState: "supported",
      consumerObjectTypes: Object.freeze(["opportunity"])
    }),
    review_pipeline_report: Object.freeze({
      reasonId: "pipeline_report_selected",
      reason: "A pipeline reporting signal was selected for review.",
      consequenceId: "pipeline_report_remains_bounded",
      consequence: "Reporting focuses the bounded pipeline snapshot without changing records or claiming tenant-wide totals.",
      resolutionId: "review_bounded_pipeline_summary",
      resolution: "Review the focused pipeline measures together with their displayed-record scope.",
      reportScopes: Object.freeze(["pipeline"]),
      reportSignals: Object.freeze(["pipeline-summary"]),
      defaultReportSignal: "pipeline-summary",
      requiresQuoteId: false,
      focusConsumerState: "supported",
      consumerObjectTypes: Object.freeze(["report-signal"])
    }),
    review_operational_report: Object.freeze({
      reasonId: "operational_report_selected",
      reason: "An operational reporting signal was selected for review.",
      consequenceId: "operational_report_remains_observational",
      consequence: "Reporting focuses client-observed interaction health without inferring server timing or an operational outcome.",
      resolutionId: "review_ambient_interaction_health",
      resolution: "Review the focused interaction measures and their evidence boundaries.",
      reportScopes: Object.freeze(["operations"]),
      reportSignals: Object.freeze(["ambient-interaction-health"]),
      defaultReportSignal: "ambient-interaction-health",
      requiresQuoteId: false,
      focusConsumerState: "supported",
      consumerObjectTypes: Object.freeze(["report-signal"])
    })
  }),
  library: Object.freeze({
    browse_library: Object.freeze({
      reasonId: "organization_library_selected",
      reason: "The organization's Library was selected for review.",
      consequenceId: "library_remains_unchanged",
      consequence: "Opening Library changes no catalog, template, quote, pricing, or operational evidence.",
      resolutionId: "browse_organization_library",
      resolution: "Browse the organization's catalog and event templates, then choose an available role-gated action.",
      objectTypes: Object.freeze(["organization-library"]),
      requiresRecordId: false
    }),
    review_library_section: Object.freeze({
      reasonId: "exact_library_section_selected",
      reason: "An exact Library section was selected for review.",
      consequenceId: "library_section_remains_unchanged",
      consequence: "Opening the Library section changes no catalog, template, quote, pricing, or operational evidence.",
      resolutionId: "review_exact_library_section",
      resolution: "Review the focused Library section and choose an available role-gated action.",
      objectTypes: Object.freeze(["library-section"]),
      requiresRecordId: false
    }),
    edit_event_template: Object.freeze({
      reasonId: "exact_event_template_selected",
      reason: "An exact event template was selected for editing.",
      consequenceId: "event_template_remains_unchanged",
      consequence: "Opening the event template changes no template, catalog, quote, pricing, or operational evidence.",
      resolutionId: "edit_exact_event_template",
      resolution: "Review the focused event template, then use its role-gated controls to make an intentional change.",
      objectTypes: Object.freeze(["event-template"]),
      requiresRecordId: true
    })
  })
}))();

const DESTINATION_CONFIG = /* @__PURE__ */ (() => Object.freeze({
  client: Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL,
    surfaceId: "client-overview",
    focusTransport: "state_only",
    focusConsumerState: "supported"
  }),
  opportunity: Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.QUOTE_DETAIL,
    surfaceId: "living-opportunity",
    focusTransport: "state_only",
    focusConsumerState: "supported"
  }),
  administration: Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.QUOTE_LIST,
    surfaceId: "quote-administration",
    focusTransport: "state_only",
    focusConsumerState: "supported"
  }),
  workflow: Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.WORKFLOW,
    surfaceId: "workflow",
    focusTransport: "query_and_state",
    focusConsumerState: "supported"
  }),
  approval: Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.WORKFLOW,
    surfaceId: "workflow",
    focusTransport: "query_and_state",
    focusConsumerState: "supported"
  }),
  messages: Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.MESSAGING,
    surfaceId: "conversation",
    focusTransport: "query_and_state",
    focusConsumerState: "supported"
  }),
  schedule: Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.SCHEDULE,
    surfaceId: "schedule",
    focusTransport: "state_only",
    focusConsumerState: "pending"
  }),
  reporting: Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.REPORTING,
    surfaceId: "reporting",
    focusTransport: "state_only",
    focusConsumerState: "pending"
  }),
  library: Object.freeze({
    routeId: WORKSPACE_ROUTE_IDS.CATALOG,
    surfaceId: "ambient-library",
    focusTransport: "state_only",
    focusConsumerState: "supported"
  })
}))();

const CONTRACT_KEYS = /* @__PURE__ */ Object.freeze([
  "modelId",
  "destination",
  "routeId",
  "surfaceId",
  "focusTransport",
  "focusConsumerState",
  "arrivalState",
  "object",
  "intentId",
  "reasonId",
  "reason",
  "consequenceId",
  "consequence",
  "intendedResolutionId",
  "intendedResolution",
  "nextResolution",
  "focus"
]);

const RECOVERY_REASON = /* @__PURE__ */ Object.freeze({
  unsupported_destination: "The requested workspace destination is not supported by the exact-arrival contract.",
  unsupported_object: "The triggering object is not supported by the requested workspace destination.",
  unsupported_intent: "The requested arrival intent is not supported by the destination.",
  unsupported_combination: "The object, focus, and arrival intent do not describe one supported resolution path.",
  unsafe_identifier: "The exact-arrival context contains an unsafe or potentially sensitive identifier.",
  portal_context: "An authenticated workspace arrival contract cannot be accepted on a portal-token route.",
  route_mismatch: "The arrival contract does not belong to the current workspace route.",
  query_mismatch: "The destination query does not match the exact focus recorded by the arrival contract.",
  contract_mismatch: "The arrival contract was altered or does not match its canonical semantic text.",
  unexpected_state: "The browser arrival state contains unsupported or extra data.",
  oversized_state: "The browser arrival state exceeds the bounded exact-context transport size.",
  oversized_query: "The destination query exceeds the bounded exact-context transport size.",
  invalid_input: "The exact-arrival context is incomplete or malformed."
});

class WorkspaceArrivalError extends TypeError {
  constructor(code) {
    super(code);
    this.name = "WorkspaceArrivalError";
    this.code = code;
  }
}

function fail(code) {
  throw new WorkspaceArrivalError(code);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value, allowedKeys, errorCode = "invalid_input") {
  if (!isPlainRecord(value)) fail(errorCode);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.includes(key))) fail(errorCode);
  return value;
}

function requiredString(value, errorCode = "invalid_input") {
  if (typeof value !== "string" || value === "" || value !== value.trim()) fail(errorCode);
  return value;
}

function looksLikeEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value);
}

function looksLikeSecret(value) {
  return /^(?:(?:sk|rk)-|pk_live_|ghp_|github_pat_|xox[a-z]?-)\S+/iu.test(value)
    || /^eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}$/u.test(value);
}

function opaqueId(value) {
  const id = requiredString(value, "unsafe_identifier");
  if (
    id.length > MAX_ID_LENGTH
    || id === "."
    || id === ".."
    || looksLikeEmail(id)
    || looksLikeSecret(id)
    || !/^[A-Za-z0-9][A-Za-z0-9._:()~-]*$/u.test(id)
  ) {
    fail("unsafe_identifier");
  }
  return id;
}

function normalizeObject(value, destination) {
  const input = exactRecord(value, ["id", "type"]);
  const type = requiredString(input.type);
  if (!DESTINATION_OBJECT_TYPES[destination]?.includes(type)) fail("unsupported_object");
  return {
    id: opaqueId(input.id),
    type,
    label: OBJECT_TYPE_LABELS[type]
  };
}

function normalizeWorkflowFocus(value, destination, intent) {
  const approval = destination === "approval";
  const input = exactRecord(
    value,
    approval ? ["quoteId", "requestId"] : ["quoteId", "attentionType", "requestId"]
  );
  const quoteId = opaqueId(input.quoteId);
  const requestId = opaqueId(input.requestId);
  const attentionType = approval ? "approval" : requiredString(input.attentionType);
  if (!WORKFLOW_ATTENTION_TYPES.includes(attentionType)) fail("unsupported_combination");
  if (approval && intent !== INTENTS.approval.review_approval) fail("unsupported_combination");
  if (!approval && !intent.attentionTypes.includes(attentionType)) fail("unsupported_combination");
  return { quoteId, attentionType, requestId };
}

function normalizeFocus(value, destination, intent) {
  if (destination === "client") {
    const input = exactRecord(value, ["customerId"]);
    return { customerId: opaqueId(input.customerId) };
  }
  if (destination === "opportunity" || destination === "administration") {
    const input = exactRecord(value, ["quoteId"]);
    return { quoteId: opaqueId(input.quoteId) };
  }
  if (destination === "workflow" || destination === "approval") {
    return normalizeWorkflowFocus(value, destination, intent);
  }
  if (destination === "messages") {
    const input = exactRecord(
      value,
      intent.requiresMessageId ? ["quoteId", "messageId"] : ["quoteId"]
    );
    const quoteId = opaqueId(input.quoteId);
    if (intent.requiresMessageId) {
      return { quoteId, messageId: opaqueId(input.messageId) };
    }
    return { quoteId };
  }
  if (destination === "schedule") {
    const input = exactRecord(value, ["quoteId"]);
    return { quoteId: opaqueId(input.quoteId) };
  }
  if (destination === "library") {
    const input = exactRecord(value, ["sectionId", "recordId"]);
    const focus = { sectionId: opaqueId(input.sectionId) };
    const hasRecordId = Object.prototype.hasOwnProperty.call(input, "recordId");
    if (intent.requiresRecordId !== hasRecordId) fail("unsupported_combination");
    if (hasRecordId) focus.recordId = opaqueId(input.recordId);
    return focus;
  }
  const input = exactRecord(value, ["reportScope", "quoteId", "reportSignal"]);
  const reportScope = requiredString(input.reportScope);
  if (!REPORT_SCOPES.includes(reportScope) || !intent.reportScopes.includes(reportScope)) {
    fail("unsupported_combination");
  }
  const requestedReportSignal = input.reportSignal === undefined || input.reportSignal === ""
    ? ""
    : requiredString(input.reportSignal);
  if (requestedReportSignal && !intent.reportSignals.includes(requestedReportSignal)) {
    fail("unsupported_combination");
  }
  const reportSignal = requestedReportSignal || intent.defaultReportSignal;
  if (intent.requiresQuoteId) {
    return {
      reportScope,
      quoteId: opaqueId(input.quoteId),
      reportSignal
    };
  }
  if (input.quoteId !== undefined && input.quoteId !== "") fail("unsupported_combination");
  return {
    reportScope,
    quoteId: "",
    reportSignal
  };
}

function validateObjectFocusRelationship(destination, object, focus) {
  if (destination === "client" && object.id !== focus.customerId) {
    fail("unsupported_combination");
  }
  if (object.type === "opportunity") {
    if (!focus.quoteId || object.id !== focus.quoteId) fail("unsupported_combination");
  }
  if (
    destination === "administration"
    && ["payment-evidence", "customer-decision-artifact"].includes(object.type)
    && object.id !== focus.quoteId
  ) {
    fail("unsupported_combination");
  }
  if (
    ["workflow-item", "approval", "customer-workflow-evidence", "staff-workflow-evidence"].includes(object.type)
    && ["workflow", "approval"].includes(destination)
    && object.id !== focus.requestId
  ) {
    fail("unsupported_combination");
  }
  if (destination === "messages" && focus.messageId) {
    if (object.type !== "customer-communication-evidence" || object.id !== focus.messageId) {
      fail("unsupported_combination");
    }
  }
  if (
    destination === "schedule"
    && object.type === "schedule-item"
    && object.id !== focus.quoteId
  ) {
    fail("unsupported_combination");
  }
  if (destination === "reporting" && object.type === "opportunity" && focus.reportScope !== "opportunity") {
    fail("unsupported_combination");
  }
  if (
    destination === "reporting"
    && object.type === "report-signal"
    && object.id !== focus.reportSignal
  ) {
    fail("unsupported_combination");
  }
  if (
    destination === "library"
    && object.type === "library-section"
    && object.id !== focus.sectionId
  ) {
    fail("unsupported_combination");
  }
  if (
    destination === "library"
    && object.type === "event-template"
    && object.id !== focus.recordId
  ) {
    fail("unsupported_combination");
  }
}

function buildPath(destination, focus) {
  if (destination === "client") return buildCustomerPath(focus.customerId);
  if (destination === "opportunity") return buildQuotePath(focus.quoteId);
  if (destination === "administration") return WORKSPACE_PATHS.quotes;
  if (destination === "workflow" || destination === "approval") {
    return buildWorkflowPath(focus);
  }
  if (destination === "messages") return buildMessagingPath(focus);
  if (destination === "schedule") return WORKSPACE_PATHS.schedule;
  if (destination === "library") return WORKSPACE_PATHS.catalog;
  return WORKSPACE_PATHS.reporting;
}

function serializedLength(value, errorCode) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail(errorCode);
  }
  if (typeof serialized !== "string") fail(errorCode);
  return serialized.length;
}

function buildHandoff(value) {
  const input = exactRecord(value, ["destination", "object", "focus", "intentId"]);
  const destination = requiredString(input.destination, "unsupported_destination");
  if (!DESTINATIONS.includes(destination)) fail("unsupported_destination");
  const intentId = requiredString(input.intentId, "unsupported_intent");
  const intent = INTENTS[destination]?.[intentId];
  if (!intent) fail("unsupported_intent");
  const object = normalizeObject(input.object, destination);
  if (intent.objectTypes && !intent.objectTypes.includes(object.type)) {
    fail("unsupported_combination");
  }
  const focus = normalizeFocus(input.focus, destination, intent);
  validateObjectFocusRelationship(destination, object, focus);

  const config = DESTINATION_CONFIG[destination];
  const focusConsumerState = intent.focusConsumerState === "supported"
    && intent.consumerObjectTypes?.includes(object.type)
    ? "supported"
    : config.focusConsumerState;
  const path = buildPath(destination, focus);
  const queryIndex = path.indexOf("?");
  const query = queryIndex >= 0 ? path.slice(queryIndex + 1) : "";
  if (query.length > MAX_QUERY_LENGTH) fail("oversized_query");

  const contract = {
    modelId: WORKSPACE_ARRIVAL_CONTRACT_MODEL,
    destination,
    routeId: config.routeId,
    surfaceId: config.surfaceId,
    focusTransport: config.focusTransport,
    focusConsumerState,
    arrivalState: focusConsumerState === "supported"
      ? "focus_supported"
      : "context_carried_consumer_pending",
    object,
    intentId,
    reasonId: intent.reasonId,
    reason: intent.reason,
    consequenceId: intent.consequenceId,
    consequence: intent.consequence,
    intendedResolutionId: intent.resolutionId,
    intendedResolution: intent.resolution,
    nextResolution: intent.resolution,
    focus
  };
  const state = { [STATE_KEY]: contract };
  if (serializedLength(state, "oversized_state") > MAX_SERIALIZED_STATE_LENGTH) {
    fail("oversized_state");
  }

  return deepFreeze({
    ok: true,
    contract,
    navigation: {
      path,
      state,
      primaryActionReady: focusConsumerState === "supported"
    }
  });
}

function recovery(error) {
  const code = error instanceof WorkspaceArrivalError && RECOVERY_REASON[error.code]
    ? error.code
    : "invalid_input";
  return deepFreeze({
    ok: false,
    contract: null,
    navigation: null,
    recovery: {
      kind: "recovery",
      code,
      reason: RECOVERY_REASON[code],
      consequence: "No workspace navigation or arrival state was produced or accepted.",
      nextResolution: "Keep the current object open and use a supported exact-context action."
    }
  });
}

function sortedQueryEntries(search) {
  return Array.from(new URLSearchParams(search || "").entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildInputFromContract(contract) {
  exactRecord(contract, CONTRACT_KEYS, "unexpected_state");
  exactRecord(contract.object, ["id", "type", "label"], "unexpected_state");
  const destination = contract.destination;
  let focus = contract.focus;
  if (destination === "approval") {
    exactRecord(focus, ["quoteId", "attentionType", "requestId"], "unexpected_state");
    if (focus.attentionType !== "approval") fail("contract_mismatch");
    focus = { quoteId: focus.quoteId, requestId: focus.requestId };
  }
  return {
    destination,
    object: { id: contract.object.id, type: contract.object.type },
    focus,
    intentId: contract.intentId
  };
}

function canonicalContractForComparison(contract, handoff) {
  if (
    contract?.destination !== "reporting"
    || Object.prototype.hasOwnProperty.call(contract?.focus || {}, "reportSignal")
  ) {
    return contract;
  }
  return {
    ...contract,
    focus: {
      ...contract.focus,
      reportSignal: handoff.contract.focus.reportSignal
    }
  };
}

function validateParsedLocation(location, handoff) {
  const pathname = typeof location.pathname === "string" ? location.pathname : "";
  const search = typeof location.search === "string" ? location.search : "";
  const hash = typeof location.hash === "string" ? location.hash : "";
  if (hash) fail("query_mismatch");
  if (search.length > MAX_QUERY_LENGTH + 1) fail("oversized_query");

  const parsed = parseWorkspaceLocation({ pathname, search, hash });
  if (parsed.surface === "portal" || parsed.routeId === WORKSPACE_ROUTE_IDS.PORTAL) {
    fail("portal_context");
  }
  if (parsed.routeId !== handoff.contract.routeId) fail("route_mismatch");

  const expectedUrl = new URL(handoff.navigation.path, "http://quotepilot.local");
  if (parsed.pathname !== expectedUrl.pathname) fail("route_mismatch");
  if (!sameJson(sortedQueryEntries(search), sortedQueryEntries(expectedUrl.search))) {
    fail("query_mismatch");
  }

  if (["workflow", "approval"].includes(handoff.contract.destination)) {
    if (!sameJson(parsed.workflowFocus, handoff.contract.focus)) fail("query_mismatch");
  } else if (handoff.contract.destination === "messages") {
    // Message identity is intentionally private same-app history state. Only
    // the quote-scoped thread identity belongs in the shareable URL.
    if (!sameJson(parsed.messagingFocus, { quoteId: handoff.contract.focus.quoteId })) {
      fail("query_mismatch");
    }
  } else if (handoff.contract.destination === "client") {
    if (parsed.params?.customerId !== handoff.contract.focus.customerId) fail("route_mismatch");
  } else if (handoff.contract.destination === "opportunity") {
    if (parsed.params?.quoteId !== handoff.contract.focus.quoteId) fail("route_mismatch");
  }
}

/**
 * Builds a bounded same-app navigation handoff. Caller input failures become a
 * contextual recovery result; this function never throws for caller data.
 */
export function createWorkspaceArrivalHandoff(input) {
  try {
    return buildHandoff(input);
  } catch (error) {
    return recovery(error);
  }
}

/**
 * Re-validates history state against the active workspace route. Canonical
 * text, exact keys, focus IDs, route identity, and query values must all agree.
 */
export function parseWorkspaceArrivalHandoff(location) {
  try {
    if (!isPlainRecord(location)) fail("invalid_input");
    const state = location.state;
    if (serializedLength(state, "unexpected_state") > MAX_SERIALIZED_STATE_LENGTH) {
      fail("oversized_state");
    }
    exactRecord(state, [STATE_KEY], "unexpected_state");
    const contract = state[STATE_KEY];
    const input = buildInputFromContract(contract);
    const handoff = buildHandoff(input);
    if (!sameJson(canonicalContractForComparison(contract, handoff), handoff.contract)) {
      fail("contract_mismatch");
    }
    validateParsedLocation(location, handoff);
    return handoff;
  } catch (error) {
    return recovery(error);
  }
}
