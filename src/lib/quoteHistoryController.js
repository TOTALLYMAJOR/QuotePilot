export const QUOTE_HISTORY_CONTROLLER_MODEL = "quote-history-controller-v1";

const STAFF_ROLES = new Set(["admin", "sales"]);

function text(value, maximum = 256) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > maximum || /[\u0000-\u001f\u007f]/u.test(candidate)) return "";
  return candidate;
}

function role(value) {
  const normalized = text(value, 32).toLowerCase();
  return STAFF_ROLES.has(normalized) ? normalized : "customer";
}

function immutable(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => immutable(value[key], seen));
  return Object.freeze(value);
}

export function getQuoteActionPermissions(value) {
  const normalizedRole = role(value);
  const isAdmin = normalizedRole === "admin";
  const isSales = normalizedRole === "sales";
  const isStaff = isAdmin || isSales;
  return immutable({
    role: normalizedRole,
    isStaff,
    canEditQuote: isStaff,
    canDuplicateQuote: isStaff,
    canExportProposal: isStaff,
    canExportBeo: isStaff,
    canReviewDelivery: isStaff,
    canOpenConversation: isStaff,
    canSendQuoteEmail: isAdmin,
    canOpenIntegrationRecovery: isAdmin,
    canCopyArtifacts: isStaff,
    canCopyPaymentLink: isAdmin,
    canCopyFinalBalanceLink: isAdmin,
    canSendPaymentRequest: isAdmin,
    canSendFinalBalanceRequest: isAdmin,
    canReconcilePayment: isAdmin,
    canReconcileFinalBalance: isAdmin,
    canManageQuoteStatus: isAdmin,
    canConvertToContract: isAdmin,
    canManageConfirmation: isAdmin,
    canReopenQuote: isAdmin,
    canRotatePortalLink: isAdmin,
    canDeleteQuote: isAdmin
  });
}

const ACTION_DEFINITIONS = Object.freeze([
  ["edit", "Edit quote", "canEditQuote", "trusted_quote_editor", "draft_mutation"],
  ["duplicate", "Duplicate quote", "canDuplicateQuote", "quote_version_service", "trusted_mutation"],
  ["export_proposal", "Download proposal", "canExportProposal", "proposal_export", "read_artifact"],
  ["review_beo", "Review Kitchen BEO", "canExportBeo", "kitchen_beo_authority", "read_artifact"],
  ["review_delivery", "Review delivery evidence", "canReviewDelivery", "delivery_evidence_review", "read_artifact"],
  ["open_conversation", "Open event conversation", "canOpenConversation", "quote_conversation", "navigation"],
  ["send_quote", "Send quote", "canSendQuoteEmail", "quote_delivery_callable", "communication"],
  ["copy_artifacts", "Copy customer details", "canCopyArtifacts", "browser_clipboard", "read_artifact"],
  ["copy_email", "Copy email draft", "canCopyArtifacts", "browser_clipboard", "read_artifact"],
  ["copy_portal", "Copy customer portal link", "canCopyArtifacts", "browser_clipboard", "read_artifact"],
  ["copy_payment_link", "Copy deposit link", "canCopyPaymentLink", "browser_clipboard", "read_artifact"],
  ["copy_balance_link", "Copy final balance link", "canCopyFinalBalanceLink", "browser_clipboard", "read_artifact"],
  ["open_integration_recovery", "Review delivery setup", "canOpenIntegrationRecovery", "integration_operations", "navigation"],
  ["request_deposit", "Request deposit", "canSendPaymentRequest", "payment_dispatch_callable", "communication"],
  ["request_balance", "Request final balance", "canSendFinalBalanceRequest", "final_balance_dispatch_callable", "communication"],
  ["reconcile_deposit", "Check deposit outcome", "canReconcilePayment", "stripe_reconciliation_callable", "trusted_mutation"],
  ["reconcile_balance", "Check balance outcome", "canReconcileFinalBalance", "stripe_reconciliation_callable", "trusted_mutation"],
  ["change_status", "Change lifecycle status", "canManageQuoteStatus", "quote_store", "trusted_mutation"],
  ["convert_contract", "Convert to contract", "canConvertToContract", "contract_conversion_callable", "trusted_mutation"],
  ["manage_confirmation", "Record booking confirmation", "canManageConfirmation", "quote_store", "trusted_mutation"],
  ["reopen", "Reopen quote", "canReopenQuote", "quote_store", "trusted_mutation"],
  ["rotate_portal", "Rotate portal access", "canRotatePortalLink", "portal_rotation_callable", "trusted_mutation"],
  ["delete", "Delete quote", "canDeleteQuote", "quote_store", "destructive"]
]);

export function buildRoleSafeQuoteActionController({ quote = null, currentUserRole = "customer", source = "" } = {}) {
  const permissions = getQuoteActionPermissions(currentUserRole);
  const quoteId = text(quote?.id || quote?.quoteId);
  const quoteStatus = text(quote?.status, 32).toLowerCase() || "draft";
  const sourceMode = text(source, 32).toLowerCase() || "unknown";
  const actions = Object.fromEntries(ACTION_DEFINITIONS.map(([
    id,
    outcomeLabel,
    permission,
    executionTarget,
    authorityLevel
  ]) => {
    const roleAllowed = permissions[permission] === true;
    const sourceAllowed = ![
      "send_quote",
      "review_delivery",
      "open_integration_recovery",
      "request_deposit",
      "request_balance",
      "reconcile_deposit",
      "reconcile_balance",
      "convert_contract",
      "rotate_portal"
    ].includes(id) || sourceMode === "firebase";
    return [id, immutable({
      id,
      outcomeLabel,
      quoteId: quoteId || null,
      quoteStatus,
      role: permissions.role,
      authorityLevel,
      executionTarget,
      enabled: Boolean(quoteId && roleAllowed && sourceAllowed),
      disabledReason: !quoteId
        ? "Select an exact opportunity first."
        : !roleAllowed
          ? `${permissions.role === "sales" ? "Admin" : "Staff"} authority is required for this outcome.`
          : !sourceAllowed
            ? "This outcome requires the Firebase-backed authority path."
            : ""
    })];
  }));
  return immutable({
    modelId: "role-safe-quote-action-controller-v1",
    quoteId: quoteId || null,
    quoteStatus,
    source: sourceMode,
    permissions,
    actions
  });
}

export function buildQuoteHistoryController({
  quotes = [],
  visibleQuoteIds = [],
  focusQuoteId = "",
  currentUserRole = "customer",
  source = ""
} = {}) {
  // The quote store owns and bounds this collection. Do not add a second
  // presentation cap here: exact route focus must resolve any record the
  // caller can render, including records after the first 500.
  const boundedQuotes = Array.isArray(quotes) ? quotes : [];
  const visible = new Set((Array.isArray(visibleQuoteIds) ? visibleQuoteIds : []).map((value) => text(value)));
  const boundedIds = new Set(boundedQuotes.map((quote) => text(quote?.id || quote?.quoteId)).filter(Boolean));
  const boundedVisibleIds = [...visible].filter((id) => boundedIds.has(id));
  const focusedId = text(focusQuoteId);
  const focusedQuote = focusedId
    ? boundedQuotes.find((quote) => text(quote?.id || quote?.quoteId) === focusedId) || null
    : null;
  const actionController = buildRoleSafeQuoteActionController({
    quote: focusedQuote,
    currentUserRole,
    source
  });
  // Quote records are owned by the store/React state. Freeze only the controller
  // envelopes so this read model cannot mutate or freeze its caller's records.
  return Object.freeze({
    modelId: QUOTE_HISTORY_CONTROLLER_MODEL,
    opportunities: Object.freeze({
      records: boundedQuotes,
      visibleQuoteIds: Object.freeze(boundedVisibleIds),
      totalCount: boundedQuotes.length,
      visibleCount: boundedVisibleIds.length
    }),
    eventRoom: Object.freeze({
      quoteId: focusedId || null,
      quote: focusedQuote,
      visible: Boolean(focusedQuote && visible.has(focusedId)),
      missing: Boolean(focusedId && !focusedQuote)
    }),
    actions: actionController
  });
}
