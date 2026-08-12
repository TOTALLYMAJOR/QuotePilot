const FOLLOW_UP_STAGE_DEFINITIONS = [
  { id: "new", label: "New lead" },
  { id: "contacted", label: "Contacted" },
  { id: "proposal_sent", label: "Proposal sent" },
  { id: "awaiting_response", label: "Awaiting response" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" }
];

const APPROVAL_ACTION_DEFINITIONS = [
  { id: "send_payment_request", label: "Send payment request" },
  { id: "send_final_balance_request", label: "Send final balance request" },
  { id: "convert_to_contract", label: "Convert to contract" },
  { id: "rotate_portal_link", label: "Rotate portal link" },
  { id: "delete_quote", label: "Delete quote" }
];

const PRODUCTION_CHECKLIST_DEFINITIONS = [
  { id: "event-brief", label: "Event brief reviewed", group: "Plan" },
  { id: "guest-count", label: "Final guest count confirmed", group: "Plan" },
  { id: "dietary-review", label: "Dietary and allergen notes reviewed", group: "Plan" },
  { id: "menu-prep", label: "Menu prep plan completed", group: "Kitchen" },
  { id: "equipment-plan", label: "Rental and equipment plan confirmed", group: "Logistics" },
  { id: "staffing-plan", label: "Staffing lead and assignments confirmed", group: "Team" },
  { id: "pack-out", label: "Pack and load-out completed", group: "Logistics" },
  { id: "venue-setup", label: "Venue setup completed", group: "Service" },
  { id: "service-handoff", label: "Service handoff completed", group: "Service" },
  { id: "closeout", label: "Event closeout completed", group: "Closeout" }
];

export const FOLLOW_UP_STAGES = FOLLOW_UP_STAGE_DEFINITIONS.map((item) => ({ ...item }));
export const FOLLOW_UP_STAGE_IDS = FOLLOW_UP_STAGE_DEFINITIONS.map((item) => item.id);
export const APPROVAL_ACTIONS = APPROVAL_ACTION_DEFINITIONS.map((item) => ({ ...item }));
export const APPROVAL_ACTION_IDS = APPROVAL_ACTION_DEFINITIONS.map((item) => item.id);
export const APPROVAL_STATES = ["pending", "approved", "rejected"];
export const PRODUCTION_CHECKLIST_ITEMS = PRODUCTION_CHECKLIST_DEFINITIONS.map((item) => ({ ...item }));
export const PRODUCTION_CHECKLIST_IDS = PRODUCTION_CHECKLIST_DEFINITIONS.map((item) => item.id);

function hasUnfinishedApprovalRequest(quote, action, ignoreRequestId = "") {
  const requests = Array.isArray(quote?.workflow?.approvalRequests)
    ? quote.workflow.approvalRequests
    : [];
  return requests.some((request) => {
    if (ignoreRequestId && text(request?.id) === ignoreRequestId) return false;
    if (text(request?.action) !== action) return false;
    const state = text(request?.state).toLowerCase();
    const executionState = text(request?.executionState).toLowerCase();
    return state === "pending"
      || (state === "approved" && !["succeeded", "failed"].includes(executionState));
  });
}

function safeMoneyCents(value) {
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) ? cents : 0;
}

const PAYMENT_APPROVAL_ACTIONS = new Set([
  "send_payment_request",
  "send_final_balance_request"
]);

function resolveApprovalQuoteRevisionId(quote = {}) {
  const explicit = text(quote.activeVersionId || quote.versionMeta?.versionId).slice(0, 80);
  const versionNumber = Number(quote.latestVersionNumber || quote.versionMeta?.versionNumber);
  const contentRevisionId = explicit || (
    Number.isSafeInteger(versionNumber) && versionNumber > 0
      ? `v${String(versionNumber).padStart(4, "0")}`
      : ""
  );
  if (!contentRevisionId) return "";
  const portalIssuedAt = text(quote.portalIssuedAtISO);
  const parsedPortalIssuedAt = portalIssuedAt ? new Date(portalIssuedAt) : null;
  const portalIdentity = parsedPortalIssuedAt && !Number.isNaN(parsedPortalIssuedAt.getTime())
    ? parsedPortalIssuedAt.toISOString()
    : text(quote.portalKey).slice(0, 64);
  return portalIdentity ? `${contentRevisionId}@${portalIdentity}` : contentRevisionId;
}

function hasCurrentApprovalPortal(quote = {}, nowMs = Date.now()) {
  const portalKey = text(quote.portalKey);
  const portalIssuedAtISO = text(quote.portalIssuedAtISO);
  const portalExpiresAtISO = text(quote.portalExpiresAtISO || quote.expiresAtISO);
  const expiryMs = Date.parse(portalExpiresAtISO);
  const delivery = quote?.workflow?.quoteDelivery || {};
  const revisionId = resolveApprovalQuoteRevisionId(quote);
  return portalKey.length >= 20
    && Boolean(portalIssuedAtISO)
    && Number.isFinite(expiryMs)
    && expiryMs > nowMs
    && Boolean(revisionId)
    && text(delivery.revisionId) === revisionId
    && text(delivery.state).toLowerCase() === "provider_accepted"
    && text(delivery.portalActivationState).toLowerCase() === "active"
    && Boolean(text(delivery.providerMessageId))
    && text(delivery.portalKey) === portalKey
    && text(delivery.portalIssuedAtISO) === portalIssuedAtISO;
}

function expectedApprovalAmountCents(quote = {}, action = "") {
  if (action === "send_final_balance_request") {
    const storedAmountCents = Number(quote?.payment?.finalBalance?.amountCents);
    if (Number.isSafeInteger(storedAmountCents) && storedAmountCents > 0) {
      return storedAmountCents;
    }
    return safeMoneyCents(quote?.totals?.total) - safeMoneyCents(quote?.totals?.deposit);
  }
  return safeMoneyCents(quote?.totals?.deposit);
}

function normalizedApprovalISO(value) {
  const candidate = text(value);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function expectedFinalBalanceCheckoutGeneration(quote = {}, request = {}) {
  const finalBalance = quote?.payment?.finalBalance || {};
  const currentGeneration = Number(finalBalance.checkoutGeneration || 0);
  if (!Number.isSafeInteger(currentGeneration) || currentGeneration < 0) return -1;
  const currentSessionId = text(finalBalance.stripeSessionId);
  const currentProviderState = text(finalBalance.stripeCheckoutState).toLowerCase();
  const reusingPreparedCheckout = text(request?.executionState).toLowerCase() === "in_progress"
    || (currentSessionId && !["failed", "expired"].includes(currentProviderState));
  return reusingPreparedCheckout ? currentGeneration : currentGeneration + 1;
}

function paymentApprovalScopeMatchesQuote(quote = {}, request = {}) {
  const action = text(request?.action);
  if (!PAYMENT_APPROVAL_ACTIONS.has(action)) return true;
  const scope = request?.actionScope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return false;
  const expectedPaymentKind = action === "send_final_balance_request"
    ? "final_balance"
    : "deposit";
  const expectedKind = action === "send_final_balance_request"
    ? "stripe_checkout_final_balance_request"
    : "stripe_checkout_deposit_request";
  const expectedRevisionId = resolveApprovalQuoteRevisionId(quote);
  const expectedAmountCents = expectedApprovalAmountCents(quote, action);
  const commonScopeKeys = [
    "version",
    "kind",
    "organizationId",
    "quoteId",
    "quoteRevisionId",
    "portalKey",
    "portalIssuedAtISO",
    "portalExpiresAtISO",
    "customerEmail",
    "paymentKind",
    "currency",
    "amountCents"
  ];
  const expectedScopeKeys = action === "send_final_balance_request"
    ? [
      ...commonScopeKeys,
      "depositStatus",
      "depositAmountCents",
      "depositStripeSessionId",
      "depositConfirmedAtISO",
      "contractNumber",
      "contractConvertedAtISO",
      "checkoutGeneration"
    ]
    : commonScopeKeys;
  const scopeKeysMatch = JSON.stringify(Object.keys(scope).sort())
    === JSON.stringify(expectedScopeKeys.sort());
  const expectedPortalIssuedAtISO = normalizedApprovalISO(quote.portalIssuedAtISO);
  const expectedPortalExpiresAtISO = normalizedApprovalISO(
    quote.portalExpiresAtISO || quote.expiresAtISO
  );
  const commonScopeMatches = scopeKeysMatch
    && Number(scope.version) === 1
    && text(scope.kind) === expectedKind
    && text(scope.organizationId).toLowerCase() === text(quote.organizationId).toLowerCase()
    && text(scope.quoteId) === text(quote.id || quote.quoteId)
    && text(scope.paymentKind).toLowerCase() === expectedPaymentKind
    && text(scope.currency).toLowerCase() === "usd"
    && Number(scope.amountCents) === expectedAmountCents
    && expectedAmountCents > 0
    && text(scope.portalKey) === text(quote.portalKey)
    && Boolean(expectedPortalIssuedAtISO)
    && normalizedApprovalISO(scope.portalIssuedAtISO) === expectedPortalIssuedAtISO
    && Boolean(expectedPortalExpiresAtISO)
    && normalizedApprovalISO(scope.portalExpiresAtISO) === expectedPortalExpiresAtISO
    && text(scope.customerEmail).toLowerCase() === text(quote?.customer?.email).toLowerCase()
    && Boolean(expectedRevisionId)
    && text(scope.quoteRevisionId) === expectedRevisionId
    && /^[a-f0-9]{64}$/.test(text(request?.actionScopeDigest).toLowerCase());
  if (!commonScopeMatches || action !== "send_final_balance_request") {
    return commonScopeMatches;
  }

  return text(scope.depositStatus).toLowerCase() === "paid"
    && Number(scope.depositAmountCents) === safeMoneyCents(quote?.totals?.deposit)
    && text(scope.depositStripeSessionId) === text(quote?.payment?.stripeSessionId)
    && normalizedApprovalISO(scope.depositConfirmedAtISO)
      === normalizedApprovalISO(quote?.payment?.depositConfirmedAtISO)
    && text(scope.contractNumber) === text(quote?.booking?.contractNumber)
    && normalizedApprovalISO(scope.contractConvertedAtISO)
      === normalizedApprovalISO(quote?.booking?.contractConvertedAtISO)
    && Number(scope.checkoutGeneration)
      === expectedFinalBalanceCheckoutGeneration(quote, request);
}

export function getApprovalActionEligibility(quote = {}, action = "", options = {}) {
  const normalizedAction = text(action);
  const definition = APPROVAL_ACTION_DEFINITIONS.find((item) => item.id === normalizedAction);
  if (!definition) return { eligible: false, reason: "This action is not supported." };

  const status = text(quote?.status || "draft").toLowerCase();
  if (status === "deleted" || text(quote?.deletedAtISO)) {
    return { eligible: false, reason: "Deleted quotes cannot receive approval requests." };
  }
  if (hasUnfinishedApprovalRequest(quote, normalizedAction, text(options?.ignoreRequestId))) {
    return {
      eligible: false,
      reason: "This action already has an unresolved or unexecuted approval request."
    };
  }

  if (normalizedAction === "send_payment_request") {
    const depositStatus = text(quote?.payment?.depositStatus || "unpaid").toLowerCase();
    if (!["accepted", "booked"].includes(status)) {
      return { eligible: false, reason: "Payment requests become available after customer acceptance." };
    }
    if (!hasEmail(quote?.customer?.email)) {
      return { eligible: false, reason: "Add a valid customer email before requesting payment." };
    }
    if (safeMoneyCents(quote?.totals?.deposit) <= 0) {
      return { eligible: false, reason: "A positive deposit is required before requesting payment." };
    }
    if (
      !options?.allowSettledPayment
      && (["paid", "refunded"].includes(depositStatus) || text(quote?.payment?.depositConfirmedAtISO))
    ) {
      return { eligible: false, reason: "The deposit is already settled." };
    }
    if (options?.requireActivePortal && !hasCurrentApprovalPortal(quote, options?.nowMs)) {
      return { eligible: false, reason: "Deliver the current customer portal before requesting payment." };
    }
  }

  if (normalizedAction === "send_final_balance_request") {
    const amountCents = safeMoneyCents(quote?.totals?.total)
      - safeMoneyCents(quote?.totals?.deposit);
    const finalBalanceStatus = text(quote?.payment?.finalBalance?.status || "unpaid").toLowerCase();
    if (
      status !== "booked"
      || !text(quote?.booking?.contractNumber)
      || !text(quote?.booking?.contractConvertedAtISO)
    ) {
      return { eligible: false, reason: "Final balance requests require a converted contract." };
    }
    if (!hasEmail(quote?.customer?.email)) {
      return { eligible: false, reason: "Add a valid customer email before requesting the balance." };
    }
    if (
      text(quote?.payment?.depositStatus).toLowerCase() !== "paid"
      || !/^cs_[A-Za-z0-9_]+$/.test(text(quote?.payment?.stripeSessionId))
      || !text(quote?.payment?.depositConfirmedAtISO)
    ) {
      return { eligible: false, reason: "Confirm the Stripe-paid deposit before requesting the balance." };
    }
    if (!options?.allowSettledPayment && (amountCents <= 0 || finalBalanceStatus === "paid")) {
      return { eligible: false, reason: "No final balance remains due." };
    }
    if (options?.requireActivePortal && !hasCurrentApprovalPortal(quote, options?.nowMs)) {
      return { eligible: false, reason: "Deliver the current customer portal before requesting the balance." };
    }
  }

  if (normalizedAction === "convert_to_contract") {
    const hasContract = Boolean(text(quote?.booking?.contractNumber));
    if (status !== "accepted" && !(status === "booked" && !hasContract)) {
      return { eligible: false, reason: "Only an accepted quote without a contract can be converted." };
    }
  }

  if (
    normalizedAction === "rotate_portal_link"
    && !["draft", "sent", "viewed", "accepted", "booked"].includes(status)
  ) {
    return { eligible: false, reason: "Portal renewal is unavailable for this quote status." };
  }
  if (
    normalizedAction === "rotate_portal_link"
    && status === "booked"
    && (
      !text(quote?.booking?.contractNumber)
      || !text(quote?.booking?.contractConvertedAtISO)
    )
  ) {
    return { eligible: false, reason: "Booked portal renewal requires an authoritative contract." };
  }

  return { eligible: true, reason: "" };
}

export function getApprovalRequestExecutionEligibility(quote = {}, request = {}, options = {}) {
  const action = text(request?.action);
  const executionState = text(request?.executionState).toLowerCase();
  const isPaymentAction = PAYMENT_APPROVAL_ACTIONS.has(action);
  const resumable = isPaymentAction
    && executionState === "in_progress"
    && options?.allowInProgressRecovery === true;
  if (
    text(request?.state).toLowerCase() !== "approved"
    || (!resumable && executionState && executionState !== "awaiting_execution")
  ) {
    return { eligible: false, reason: "This approval is not awaiting execution." };
  }

  const eligibility = getApprovalActionEligibility(quote, action, {
    ...options,
    ignoreRequestId: text(request?.id),
    requireActivePortal: resumable ? false : options?.requireActivePortal,
    allowSettledPayment: resumable
  });
  if (!eligibility.eligible) return eligibility;
  if (!paymentApprovalScopeMatchesQuote(quote, request)) {
    return {
      eligible: false,
      reason: "This approval belongs to an older customer portal or commercial scope."
    };
  }
  return { eligible: true, reason: "" };
}

export function getRequestableApprovalActions(quote = {}, options = {}) {
  return APPROVAL_ACTIONS.filter((action) => (
    getApprovalActionEligibility(quote, action.id, options).eligible
  ));
}

const WORKFLOW_ATTENTION_STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "accepted"
]);
const WORKFLOW_ATTENTION_PRIORITY = {
  new_change_request: 0,
  blocked_closeout: 1,
  overdue_closeout: 2,
  overdue_follow_up: 3,
  pending_approval: 4,
  acknowledged_change_request: 5,
  due_closeout: 6,
  due_follow_up: 7
};

function text(value) {
  return String(value || "").trim();
}

/**
 * Returns the existing canonical identity that Workflow can use to focus one
 * attention row. Follow-up and closeout projections are queue items rather
 * than request records, so their stable attention-item id is the truthful
 * focus token. This helper derives no new identity and grants no mutation
 * authority.
 */
export function getWorkflowAttentionFocusId(item = {}) {
  const type = text(item?.type);
  const itemId = text(item?.id);
  if (["follow_up", "post_event_closeout"].includes(type)) return itemId;
  if (type === "approval") return text(item?.pendingRequests?.[0]?.id) || itemId;
  if (type === "change_request") return text(item?.sourceRequestId) || itemId;
  if (type === "unread_customer_reply") {
    return text(item?.sourceRequestId || item?.attentionId || item?.messageId) || itemId;
  }
  return text(
    item?.sourceRequestId
    || item?.attentionId
    || item?.messageId
    || item?.closeoutId
  ) || itemId;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value));
}

function safeIso(value) {
  const raw = text(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function localDateIso(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarDateInTimeZone(value, timeZone) {
  const instantISO = safeIso(value);
  const requestedTimeZone = text(timeZone);
  if (!instantISO || !requestedTimeZone) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: requestedTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(instantISO));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const result = `${values.year}-${values.month}-${values.day}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : "";
  } catch {
    return "";
  }
}

function daysBetweenDates(earlierDateIso, laterDateIso) {
  const earlier = Date.parse(`${earlierDateIso}T00:00:00.000Z`);
  const later = Date.parse(`${laterDateIso}T00:00:00.000Z`);
  if (!Number.isFinite(earlier) || !Number.isFinite(later)) return 0;
  return Math.max(0, Math.round((later - earlier) / 86400000));
}

export function buildWorkflowAttentionSummary(quotes = [], options = {}) {
  const todayISO = /^\d{4}-\d{2}-\d{2}$/.test(text(options.todayISO))
    ? text(options.todayISO)
    : localDateIso(options.now);
  const evaluationInstantISO = safeIso(options.nowISO || options.now)
    || (/^\d{4}-\d{2}-\d{2}$/.test(text(options.todayISO))
      ? `${text(options.todayISO)}T12:00:00.000Z`
      : new Date().toISOString());
  const items = [];

  (Array.isArray(quotes) ? quotes : []).forEach((quote) => {
    const quoteId = text(quote?.id);
    const quoteStatus = text(quote?.status).toLowerCase();
    if (!quoteId) return;
    const commercialAttentionEligible = WORKFLOW_ATTENTION_STATUSES.has(quoteStatus);

    const portalDecision = quote?.portalDecision || {};
    const requestSubmittedAtISO = safeIso(portalDecision.submittedAtISO);
    if (commercialAttentionEligible && portalDecision.decision === "changes_requested") {
      const handling = quote?.workflow?.changeRequestHandling || {};
      const requestId = text(portalDecision.requestId);
      const requestMessage = text(portalDecision.message);
      const matchesCurrentRequest = (
        text(handling.sourceSubmittedAtISO) === text(portalDecision.submittedAtISO)
        && text(handling.sourceMessage) === requestMessage
        && (
          requestId
            ? text(handling.sourceRequestId) === requestId
            : !text(handling.sourceRequestId)
        )
      );
      const handlingState = matchesCurrentRequest ? text(handling.state).toLowerCase() : "";
      if (!requestSubmittedAtISO || !requestMessage) {
        items.push({
          id: `change-request:${quoteId}:invalid`,
          type: "change_request",
          state: "invalid",
          priority: WORKFLOW_ATTENTION_PRIORITY.new_change_request,
          dateISO: safeIso(quote?.updatedAtISO) || safeIso(quote?.createdAtISO),
          quote,
          quoteId,
          sourceRequestId: requestId,
          sourceSubmittedAtISO: text(portalDecision.submittedAtISO),
          sourceMessage: requestMessage,
          unhandleable: true
        });
      } else if (handlingState !== "handled") {
        const acknowledged = handlingState === "acknowledged";
        items.push({
          id: `change-request:${quoteId}:${text(portalDecision.submittedAtISO)}`,
          type: "change_request",
          state: acknowledged ? "acknowledged" : "new",
          priority: WORKFLOW_ATTENTION_PRIORITY[
            acknowledged ? "acknowledged_change_request" : "new_change_request"
          ],
          dateISO: requestSubmittedAtISO,
          quote,
          quoteId,
          sourceRequestId: requestId,
          sourceSubmittedAtISO: text(portalDecision.submittedAtISO),
          sourceMessage: requestMessage
        });
      }
    }

    const followUp = quote?.workflow?.followUp || {};
    const dueDate = text(followUp.dueDate);
    const followUpClosed = followUp.completed === true || ["won", "lost"].includes(text(followUp.stage));
    if (
      commercialAttentionEligible
      && !followUpClosed
      && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      && dueDate <= todayISO
    ) {
      const daysOverdue = daysBetweenDates(dueDate, todayISO);
      items.push({
        id: `follow-up:${quoteId}`,
        type: "follow_up",
        state: daysOverdue > 0 ? "overdue" : "due_today",
        priority: WORKFLOW_ATTENTION_PRIORITY[daysOverdue > 0 ? "overdue_follow_up" : "due_follow_up"],
        dateISO: dueDate,
        daysOverdue,
        quote,
        quoteId
      });
    }

    const pendingRequests = (commercialAttentionEligible && Array.isArray(quote?.workflow?.approvalRequests)
      ? quote.workflow.approvalRequests
      : [])
      .filter((request) => request?.state === "pending")
      .sort((left, right) => text(left?.requestedAtISO).localeCompare(text(right?.requestedAtISO)));
    if (pendingRequests.length > 0) {
      items.push({
        id: `approval:${quoteId}`,
        type: "approval",
        state: "pending",
        priority: WORKFLOW_ATTENTION_PRIORITY.pending_approval,
        dateISO: safeIso(pendingRequests[0]?.requestedAtISO) || safeIso(quote?.updatedAtISO),
        pendingRequests,
        quote,
        quoteId
      });
    }

    const closeout = quote?.workflow?.postEventCloseout || {};
    const closeoutId = text(closeout.closeoutId);
    const closeoutState = text(closeout.state).toLowerCase();
    const closeoutPolicyState = text(closeout.policy?.state).toLowerCase();
    const sourceBlocked = closeoutState === "blocked_source";
    const closeoutScopeValid = quoteStatus === "booked"
      && (closeoutId || sourceBlocked)
      && text(closeout.quoteId) === quoteId
      && (!text(closeout.organizationId)
        || text(closeout.organizationId) === text(quote.organizationId))
      && (!text(closeout.customerId)
        || text(closeout.customerId) === text(quote.customerId));
    if (closeoutScopeValid && closeoutState !== "completed") {
      const dueDate = text(closeout.dueDate);
      if (sourceBlocked) {
        items.push({
          id: `post-event-closeout:${quoteId}:blocked-source`,
          type: "post_event_closeout",
          state: "blocked_source",
          priority: WORKFLOW_ATTENTION_PRIORITY.blocked_closeout,
          dateISO: dueDate || text(closeout.eventDate) || safeIso(quote.updatedAtISO),
          closeoutId: "",
          dueDate,
          quote,
          quoteId
        });
      } else if (closeoutPolicyState === "blocked_configuration") {
        items.push({
          id: `post-event-closeout:${quoteId}:${closeoutId}`,
          type: "post_event_closeout",
          state: "blocked_configuration",
          priority: WORKFLOW_ATTENTION_PRIORITY.blocked_closeout,
          dateISO: dueDate || text(closeout.eventDate) || safeIso(quote.updatedAtISO),
          closeoutId,
          dueDate,
          quote,
          quoteId
        });
      } else {
        const closeoutTodayISO = calendarDateInTimeZone(
          evaluationInstantISO,
          closeout.policy?.timeZone
        );
        if (!closeoutTodayISO) {
          items.push({
            id: `post-event-closeout:${quoteId}:${closeoutId}`,
            type: "post_event_closeout",
            state: "blocked_configuration",
            priority: WORKFLOW_ATTENTION_PRIORITY.blocked_closeout,
            dateISO: dueDate || text(closeout.eventDate) || safeIso(quote.updatedAtISO),
            closeoutId,
            dueDate,
            quote,
            quoteId
          });
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate <= closeoutTodayISO) {
          const daysOverdue = daysBetweenDates(dueDate, closeoutTodayISO);
          items.push({
            id: `post-event-closeout:${quoteId}:${closeoutId}`,
            type: "post_event_closeout",
            state: daysOverdue > 0 ? "overdue" : "due_today",
            priority: WORKFLOW_ATTENTION_PRIORITY[
              daysOverdue > 0 ? "overdue_closeout" : "due_closeout"
            ],
            dateISO: dueDate,
            daysOverdue,
            closeoutId,
            dueDate,
            quote,
            quoteId
          });
        }
      }
    }
  });

  items.sort((left, right) => (
    left.priority - right.priority
    || text(left.dateISO).localeCompare(text(right.dateISO))
    || text(left.quote?.quoteNumber || left.quoteId).localeCompare(text(right.quote?.quoteNumber || right.quoteId))
    || left.type.localeCompare(right.type)
  ));

  return {
    todayISO,
    quoteCount: new Set(items.map((item) => item.quoteId)).size,
    itemCount: items.length,
    counts: {
      changeRequests: items.filter((item) => item.type === "change_request").length,
      followUps: items.filter((item) => item.type === "follow_up").length,
      approvals: items.filter((item) => item.type === "approval").length,
      postEventCloseouts: items.filter((item) => item.type === "post_event_closeout").length
    },
    items
  };
}

export function mergeUnreadReplyAttention(
  attentionSummary = {},
  { attention = [], quotes = [] } = {}
) {
  const quoteById = new Map(
    (Array.isArray(quotes) ? quotes : [])
      .filter((quote) => text(quote?.id))
      .map((quote) => [text(quote.id), quote])
  );
  const seenAttentionIds = new Set();
  const unreadItems = (Array.isArray(attention) ? attention : []).flatMap((record) => {
    const attentionId = text(record?.attentionId);
    const quoteId = text(record?.quoteId);
    const messageId = text(record?.messageId);
    const kind = text(record?.kind).toLowerCase();
    const state = text(record?.state).toLowerCase();
    if (
      !attentionId
      || !quoteId
      || !messageId
      || kind !== "unread_customer_reply"
      || state !== "open"
      || seenAttentionIds.has(attentionId)
    ) {
      return [];
    }
    seenAttentionIds.add(attentionId);

    const canonicalQuote = quoteById.get(quoteId);
    const customerId = text(canonicalQuote?.customerId || record?.customerId);
    const customerName = text(
      canonicalQuote?.customer?.name
      || canonicalQuote?.customer?.email
      || record?.customerLabel
    );
    const quote = canonicalQuote
      ? {
          ...canonicalQuote,
          ...(customerId ? { customerId } : {}),
          customer: {
            ...(canonicalQuote.customer || {}),
            ...(!text(canonicalQuote?.customer?.name) && customerName ? { name: customerName } : {})
          }
        }
      : {
          id: quoteId,
          ...(customerId ? { customerId } : {}),
          quoteNumber: text(record?.quoteLabel),
          customer: customerName ? { name: customerName } : {}
        };
    const dateISO = safeIso(record?.receivedAtISO || record?.openedAtISO);
    return [{
      id: `unread-reply:${attentionId}`,
      type: "unread_customer_reply",
      state: "open",
      priority: WORKFLOW_ATTENTION_PRIORITY.new_change_request,
      dateISO,
      quote,
      quoteId,
      customerId,
      attentionId,
      messageId,
      sourceRequestId: attentionId
    }];
  });

  const baseItems = Array.isArray(attentionSummary?.items) ? attentionSummary.items : [];
  const items = [...baseItems, ...unreadItems].sort((left, right) => (
    number(left?.priority) - number(right?.priority)
    || text(left?.dateISO).localeCompare(text(right?.dateISO))
    || text(left?.quote?.quoteNumber || left?.quoteId)
      .localeCompare(text(right?.quote?.quoteNumber || right?.quoteId))
    || text(left?.type).localeCompare(text(right?.type))
  ));
  const counts = {
    ...(attentionSummary?.counts || {}),
    changeRequests: Number(attentionSummary?.counts?.changeRequests) || 0,
    followUps: Number(attentionSummary?.counts?.followUps) || 0,
    approvals: Number(attentionSummary?.counts?.approvals) || 0,
    postEventCloseouts: Number(attentionSummary?.counts?.postEventCloseouts) || 0,
    unreadCustomerReplies: unreadItems.length
  };

  return {
    ...attentionSummary,
    quoteCount: new Set(items.map((item) => text(item?.quoteId)).filter(Boolean)).size,
    itemCount: items.length,
    counts,
    items
  };
}

function cloneForm(form = {}) {
  return {
    ...form,
    addons: Array.isArray(form.addons) ? [...form.addons] : [],
    rentals: Array.isArray(form.rentals) ? [...form.rentals] : [],
    menuItems: Array.isArray(form.menuItems) ? [...form.menuItems] : [],
    addonQuantities: { ...(form.addonQuantities || {}) },
    rentalQuantities: { ...(form.rentalQuantities || {}) },
    menuItemQuantities: { ...(form.menuItemQuantities || {}) }
  };
}

export function buildProposalReadiness(source = {}, totalsOverride = null) {
  const customer = source.customer || {
    name: source.name,
    email: source.email,
    phone: source.phone
  };
  const event = source.event || {
    name: source.eventName,
    date: source.date,
    time: source.time,
    venue: source.venue,
    guests: source.guests,
    hours: source.hours
  };
  const selection = source.selection || {
    packageId: source.pkg,
    menuItems: source.menuItems
  };
  const totals = totalsOverride || source.totals || {};
  const menuItems = Array.isArray(selection.menuItems) ? selection.menuItems : [];
  const menuNames = Array.isArray(selection.menuItemNames) ? selection.menuItemNames : [];

  const criteria = [
    { id: "customer-name", label: "Customer name", points: 10, passed: Boolean(text(customer.name)) },
    { id: "customer-email", label: "Valid customer email", points: 10, passed: hasEmail(customer.email) },
    { id: "customer-phone", label: "Customer phone", points: 5, passed: Boolean(text(customer.phone)) },
    { id: "event-name", label: "Event name", points: 5, passed: Boolean(text(event.name)) },
    { id: "event-date", label: "Event date", points: 10, passed: Boolean(text(event.date)) },
    { id: "event-time", label: "Event time", points: 5, passed: Boolean(text(event.time)) },
    { id: "venue", label: "Venue", points: 10, passed: Boolean(text(event.venue)) },
    { id: "guest-count", label: "Guest count", points: 10, passed: number(event.guests) > 0 },
    { id: "duration", label: "Event duration", points: 5, passed: number(event.hours) > 0 },
    { id: "package", label: "Package selected", points: 10, passed: Boolean(text(selection.packageId || selection.packageName)) },
    { id: "menu", label: "Menu selected", points: 10, passed: menuItems.length > 0 || menuNames.length > 0 },
    { id: "total", label: "Calculated total", points: 10, passed: number(totals.total) > 0 }
  ];

  const score = criteria.reduce((sum, item) => sum + (item.passed ? item.points : 0), 0);
  const gaps = criteria.filter((item) => !item.passed);
  const status = score === 100
    ? { id: "ready", label: "Ready to send" }
    : score >= 80
      ? { id: "review", label: "Final review" }
      : { id: "needs_details", label: "Needs details" };

  return {
    score,
    status,
    criteria,
    gaps,
    complete: score === 100
  };
}

export function buildQuoteScenarios(form = {}, catalog = {}) {
  const packages = (Array.isArray(catalog.packages) ? catalog.packages : [])
    .filter((item) => item && item.active !== false && text(item.id))
    .sort((left, right) => number(left.ppp ?? left.price) - number(right.ppp ?? right.price));

  if (!packages.length) return [];

  const middleIndex = Math.floor((packages.length - 1) / 2);
  const packageByScenario = {
    good: packages[0],
    better: packages[middleIndex],
    best: packages[packages.length - 1]
  };
  const definitions = [
    {
      id: "good",
      label: "Good",
      description: "Essential package with optional add-ons and rentals removed."
    },
    {
      id: "better",
      label: "Better",
      description: "Balanced package with the current optional selections."
    },
    {
      id: "best",
      label: "Best",
      description: "Top package with the current optional selections."
    }
  ];

  return definitions.map((definition) => {
    const pkg = packageByScenario[definition.id];
    const nextForm = cloneForm(form);
    nextForm.pkg = pkg.id;
    nextForm.eventTemplateId = "custom";
    if (definition.id === "good") {
      nextForm.addons = [];
      nextForm.rentals = [];
      nextForm.addonQuantities = {};
      nextForm.rentalQuantities = {};
    }
    return {
      ...definition,
      packageId: pkg.id,
      packageName: text(pkg.name) || pkg.id,
      form: nextForm
    };
  });
}

function pushTimelineEvent(events, id, label, detail, tone, value) {
  const atISO = safeIso(value);
  if (!atISO) return;
  events.push({ id, label, detail, tone, atISO });
}

export function buildQuoteLifecycleTimeline(quote = {}) {
  const events = [];
  const lifecycle = quote.lifecycle || {};
  const lifecycleDefinitions = [
    ["draftAtISO", "Quote drafted", "draft"],
    ["sentAtISO", "Proposal sent", "sent"],
    ["viewedAtISO", "Proposal viewed", "viewed"],
    ["acceptedAtISO", "Proposal accepted", "accepted"],
    ["declinedAtISO", "Proposal declined", "declined"],
    ["expiredAtISO", "Proposal expired", "expired"],
    ["bookedAtISO", "Event booked", "booked"]
  ];

  lifecycleDefinitions.forEach(([field, label, tone]) => {
    pushTimelineEvent(events, `lifecycle-${field}`, label, "Quote lifecycle", tone, lifecycle[field]);
  });

  if (!events.some((item) => item.tone === "draft")) {
    pushTimelineEvent(
      events,
      "quote-created",
      "Quote created",
      quote.quoteNumber || "Quote lifecycle",
      "draft",
      quote.createdAtISO
    );
  }

  const payment = quote.payment || {};
  const booking = quote.booking || {};
  [
    ["deposit-paid", "Deposit marked paid", "Payment status", "paid", payment.depositConfirmedAtISO],
    ["contract-converted", "Contract created", booking.contractNumber || "Booking workflow", "booked", booking.contractConvertedAtISO],
    ["staff-assigned", "Staff lead assigned", booking.staffLead || "Operations", "operations", booking.staffAssignedAtISO],
    ["confirmation-sent", "Booking confirmation sent", booking.contractNumber || "Booking workflow", "operations", booking.confirmationSentAtISO],
    ["confirmation-confirmed", "Booking confirmed", booking.contractNumber || "Booking workflow", "accepted", booking.confirmedAtISO]
  ].forEach((event) => pushTimelineEvent(events, ...event));

  const portalDecision = quote.portalDecision || {};
  const decisionLabel = {
    accepted: "Customer accepted proposal",
    declined: "Customer declined proposal",
    changes_requested: "Customer requested changes"
  }[portalDecision.decision];
  if (decisionLabel) {
    pushTimelineEvent(
      events,
      "portal-decision",
      decisionLabel,
      text(portalDecision.message) || "Customer portal",
      portalDecision.decision,
      portalDecision.submittedAtISO
    );
  }

  const changeRequestHandling = quote.workflow?.changeRequestHandling || {};
  const handlingMatchesCurrentRequest = (
    text(changeRequestHandling.sourceSubmittedAtISO) === text(portalDecision.submittedAtISO)
    && text(changeRequestHandling.sourceMessage) === text(portalDecision.message)
    && (
      text(portalDecision.requestId)
        ? text(changeRequestHandling.sourceRequestId) === text(portalDecision.requestId)
        : !text(changeRequestHandling.sourceRequestId)
    )
  );
  if (
    portalDecision.decision === "changes_requested"
    && handlingMatchesCurrentRequest
  ) {
    pushTimelineEvent(
      events,
      "change-request-acknowledged",
      "Change request acknowledged internally",
      text(changeRequestHandling.acknowledgedByEmail) || "Sales workflow",
      "follow_up",
      changeRequestHandling.acknowledgedAtISO
    );
    if (changeRequestHandling.state === "handled") {
      pushTimelineEvent(
        events,
        "change-request-handled",
        "Change request marked handled internally",
        text(changeRequestHandling.note) || text(changeRequestHandling.handledByEmail) || "Sales workflow",
        "follow_up",
        changeRequestHandling.handledAtISO
      );
    }
  }

  const followUp = quote.workflow?.followUp || {};
  pushTimelineEvent(
    events,
    "follow-up-updated",
    followUp.completed ? "Follow-up completed" : "Follow-up updated",
    text(followUp.note) || text(followUp.stage) || "Sales workflow",
    "follow_up",
    followUp.completedAtISO || followUp.updatedAtISO
  );

  const approvals = Array.isArray(quote.workflow?.approvalRequests)
    ? quote.workflow.approvalRequests
    : [];
  approvals.forEach((request) => {
    const action = APPROVAL_ACTION_DEFINITIONS.find((item) => item.id === request.action);
    const detail = action?.label || request.action || "Sensitive action";
    pushTimelineEvent(events, `approval-requested-${request.id}`, "Approval requested", detail, "approval", request.requestedAtISO);
    if (request.state && request.state !== "pending") {
      pushTimelineEvent(
        events,
        `approval-resolved-${request.id}`,
        request.state === "approved" ? "Approval granted" : "Approval rejected",
        detail,
        request.state,
        request.resolvedAtISO
      );
    }
    if (request.executionState === "in_progress") {
      pushTimelineEvent(
        events,
        `approval-execution-started-${request.id}`,
        "Approved action started",
        detail,
        "approval",
        request.executionStartedAtISO
      );
    }
    if (["succeeded", "failed"].includes(request.executionState)) {
      pushTimelineEvent(
        events,
        `approval-execution-completed-${request.id}`,
        request.executionState === "succeeded"
          ? "Approved action completed"
          : "Approved action failed",
        request.executionReference || request.executionError || detail,
        request.executionState === "succeeded" ? "booked" : "rejected",
        request.executionCompletedAtISO
      );
    }
  });

  return events.sort((left, right) => new Date(left.atISO).getTime() - new Date(right.atISO).getTime());
}

export function buildProductionChecklist(quote = {}) {
  const persisted = Array.isArray(quote.booking?.productionChecklist)
    ? quote.booking.productionChecklist
    : [];
  const persistedById = new Map(
    persisted
      .filter((item) => PRODUCTION_CHECKLIST_IDS.includes(text(item?.id)))
      .map((item) => [text(item.id), item])
  );

  const items = PRODUCTION_CHECKLIST_DEFINITIONS.map((definition) => {
    const stored = persistedById.get(definition.id) || {};
    return {
      ...definition,
      completed: stored.completed === true,
      completedAtISO: safeIso(stored.completedAtISO),
      completedByEmail: text(stored.completedByEmail)
    };
  });
  const completed = items.filter((item) => item.completed).length;

  return {
    items,
    completed,
    total: items.length,
    percent: items.length ? Math.round((completed / items.length) * 100) : 0
  };
}

export function parseTimeToMinutes(value) {
  const text = String(value || "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(text)) return null;
  const [hRaw, mRaw] = text.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return (h * 60) + m;
}

function formatClock(minutesInDay) {
  const normalized = ((minutesInDay % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

export function formatCheckpointTime(totalMinutes) {
  const dayOffset = Math.floor(totalMinutes / 1440);
  const label = formatClock(totalMinutes);

  if (dayOffset === -1) return `${label} (prev day)`;
  if (dayOffset === 1) return `${label} (next day)`;
  if (dayOffset < -1 || dayOffset > 1) return `${label} (${dayOffset > 0 ? `+${dayOffset}` : dayOffset} days)`;
  return label;
}

export function formatMinutesToTimeInput(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function defaultKitchenCheckpointOffsets(durationMinutes) {
  return [
    { id: "prep-start", label: "Prep kickoff", minuteOffset: -180 },
    { id: "line-check", label: "Line check", minuteOffset: -120 },
    { id: "pack-out", label: "Pack and load-out", minuteOffset: -60 },
    { id: "onsite-setup", label: "On-site setup", minuteOffset: -30 },
    { id: "service-start", label: "Service start", minuteOffset: 0 },
    { id: "service-end", label: "Service wrap", minuteOffset: durationMinutes },
    { id: "reset", label: "Kitchen reset", minuteOffset: durationMinutes + 45 }
  ];
}

export function buildKitchenCheckpoints(event) {
  const startMinutes = parseTimeToMinutes(event.time);
  if (startMinutes === null) return [];

  const durationMinutes = Math.max(60, Math.round(number(event.hours) * 60));
  const defaults = defaultKitchenCheckpointOffsets(durationMinutes);
  const overrides = Array.isArray(event.kitchenCheckpointOverrides) ? event.kitchenCheckpointOverrides : [];
  const overrideById = new Map(
    overrides
      .map((item) => ({
        id: String(item?.id || "").trim(),
        label: String(item?.label || "").trim(),
        minuteOffset: Number(item?.minuteOffset)
      }))
      .filter((item) => item.id && Number.isFinite(item.minuteOffset))
      .map((item) => [item.id, item])
  );

  return defaults.map((item) => {
    const override = overrideById.get(item.id);
    const minuteOffset = override ? Math.round(override.minuteOffset) : item.minuteOffset;
    const minute = startMinutes + minuteOffset;
    const label = override?.label ? override.label.slice(0, 80) : item.label;
    return {
      id: item.id,
      label,
      minute,
      minuteOffset,
      timeLabel: formatCheckpointTime(minute),
      timeValue: formatMinutesToTimeInput(minute)
    };
  });
}
