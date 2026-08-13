import {
  createAmbientAction,
  createSurfacePurposeContract
} from "./ambientContracts";

export const AMBIENT_CLIENTS_MODEL = "ambient-clients-v1";
export const AMBIENT_CLIENT_RELATIONSHIP_MODEL = "ambient-client-relationship-v1";

export const AMBIENT_CLIENTS_LIST_SURFACE = createSurfacePurposeContract({
  id: "ambient-clients-list",
  objectScopes: ["client", "customer-directory-record"],
  purposes: ["clarify", "advance", "reveal_context"],
  entryReason: "Help staff find an exact client and continue with the relationship already recorded for them.",
  allowedEmptyState: {
    kind: "starting_action",
    message: "No client records were returned by this completed bounded read.",
    actionId: "start-client-opportunity"
  },
  recoveryBehavior: {
    message: "Keep any completed client records visible and refresh the same organization-scoped page.",
    nextActionIds: ["refresh-clients"]
  }
});

export const AMBIENT_CLIENT_RELATIONSHIP_SURFACE = createSurfacePurposeContract({
  id: "ambient-client-relationship",
  objectScopes: [
    "client",
    "opportunity",
    "relationship-evidence",
    "customer-communication-evidence"
  ],
  purposes: ["clarify", "advance", "resolve", "reveal_context"],
  entryReason: "Show who this client is, what is taking shape around them, and the next supported step.",
  allowedEmptyState: {
    kind: "caught_up",
    message: "No tracked client or opportunity follow-up needs attention in this bounded view."
  },
  recoveryBehavior: {
    message: "Keep the last completed client view visible and refresh this exact relationship.",
    nextActionIds: ["refresh-client-relationship"]
  }
});

const KNOWN_SOURCES = new Set(["firebase", "local", "mixed"]);
const ACTIVE_STATUSES = new Set(["draft", "sent", "viewed", "accepted", "booked"]);
const KNOWN_ATTENTION_TYPES = new Set([
  "approval",
  "change_request",
  "unread_customer_reply",
  "follow_up",
  "post_event_closeout"
]);

function text(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function lower(value, maximum = 80) {
  return text(value, maximum).toLowerCase();
}

function safeId(value) {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw.trim();
  if (
    !normalized
    || normalized !== raw
    || normalized.length > 256
    || /[\s/?#\\\u0000]/u.test(normalized)
    || normalized === "."
    || normalized === ".."
  ) return "";
  return normalized;
}

function safeIso(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return new Date(value).toISOString();
  }
  const raw = text(value, 80);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizedRole(value) {
  return lower(value, 40) || "staff";
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function sourceLabel(source) {
  if (source === "firebase") return "Connected staff workspace";
  if (source === "local") return "This browser";
  if (source === "mixed") return "More than one workspace source";
  return "Source not confirmed";
}

function sourceBoundary(source) {
  if (source === "firebase") {
    return "These records came from the staff workspace. Customer activity, delivery, payment, and event completion still need their own evidence.";
  }
  if (source === "local") {
    return "These records are saved in this browser. They do not independently confirm customer activity, delivery, payment, booking, or outside-service completion.";
  }
  if (source === "mixed") {
    return "This view contains more than one source. Confirm the exact record before relying on customer, payment, booking, or delivery details.";
  }
  return "The source could not be confirmed, so this view does not strengthen any customer, payment, booking, or delivery claim.";
}

function action({
  id,
  label,
  purpose = "reveal_context",
  role,
  object,
  targetId,
  surfaceId,
  reason,
  consequence,
  nextResolutionId,
  enabled,
  disabledReason,
  primary = false,
  targetKind = "route"
}) {
  return createAmbientAction({
    id,
    outcomeLabel: label,
    purpose,
    roles: [role],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: targetKind,
      targetId,
      surfaceId
    },
    receiptType: "none",
    reversibility: { kind: "none" },
    arrivalContract: {
      object,
      reason,
      consequence,
      nextResolutionIds: [nextResolutionId]
    },
    primary,
    enabled,
    ...(!enabled ? { disabledReason } : {})
  });
}

function normalizeDirectoryCapabilities(value = {}) {
  return {
    openClient: value.openClient === true,
    startOpportunity: value.startOpportunity === true,
    refresh: value.refresh === true
  };
}

function directoryBoundary(state = {}) {
  const source = lower(state.source);
  const loadedAtISO = safeIso(state.loadedAtISO || state.loadedAt);
  const loading = state.loading === true;
  const stale = state.stale === true;
  const error = text(state.error);
  const truncated = Boolean(text(state.nextCursor));
  const sourceKnown = KNOWN_SOURCES.has(source);
  const completed = Boolean(loadedAtISO) && !loading;
  const currentComplete = completed && sourceKnown && !stale && !error && !truncated;
  const notes = [];
  if (loading) notes.push(loadedAtISO
    ? "A refresh is in progress; the clients already here remain visible."
    : "Clients are still loading.");
  if (error) notes.push(loadedAtISO
    ? "The latest refresh did not finish; the clients already here may be out of date."
    : "The client read did not finish.");
  if (stale) notes.push("The displayed client records may be out of date.");
  if (truncated) notes.push("Another bounded page is available; this is not the full client list.");
  if (!sourceKnown) notes.push("The source of these client records could not be confirmed.");
  if (!loadedAtISO) notes.push("No reliable completion time is available for this page.");
  return {
    source: source || "unknown",
    sourceLabel: sourceLabel(source),
    sourceBoundary: sourceBoundary(source),
    loadedAtISO,
    loading,
    stale,
    error: error || null,
    truncated,
    currentComplete,
    notes
  };
}

function directoryIdentity(item) {
  return {
    name: text(item?.name || item?.email) || "Unnamed client",
    company: text(item?.company),
    email: text(item?.email, 320).toLowerCase(),
    phone: text(item?.phone, 80),
    lastQuoteId: safeId(item?.lastQuoteId),
    lastQuoteNumber: text(item?.lastQuoteNumber, 120),
    lastEventName: text(item?.lastEventName, 240),
    lastEventDate: text(item?.lastEventDate, 40)
  };
}

/**
 * Pure projection over the caller-owned CustomerDirectoryView state.
 * It performs no read, write, authorization, ranking, or cross-tenant lookup.
 */
export function buildAmbientClientsDirectory({
  state = {},
  currentUserRole = "staff",
  capabilities = {}
} = {}) {
  const boundary = directoryBoundary(state);
  const role = normalizedRole(currentUserRole);
  const available = normalizeDirectoryCapabilities(capabilities);
  const expectedOrganizationId = safeId(state.organizationId);
  const items = Array.isArray(state.items) ? state.items : [];
  const seen = new Set();
  const omittedRecords = [];
  const rows = [];

  items.forEach((item, index) => {
    const customerId = safeId(item?.customerId || item?.id);
    const recordId = safeId(item?.id || item?.customerId);
    const itemOrganizationId = safeId(item?.organizationId);
    let reason = "";
    if (!customerId || !recordId || customerId !== recordId) reason = "The exact client identity is missing or inconsistent.";
    else if (seen.has(customerId)) reason = "The client identity appears more than once on this page.";
    else if (expectedOrganizationId && itemOrganizationId && itemOrganizationId !== expectedOrganizationId) {
      reason = "The client record does not match this organization.";
    }
    if (reason) {
      omittedRecords.push({ index, ...(customerId ? { customerId } : {}), reason });
      return;
    }
    seen.add(customerId);
    const identity = directoryIdentity(item);
    const object = { id: customerId, type: "client", label: identity.name };
    const primaryAction = action({
      id: `review-client:${customerId}`,
      label: "Review client",
      role,
      object,
      targetId: customerId,
      surfaceId: AMBIENT_CLIENT_RELATIONSHIP_SURFACE.id,
      reason: "This exact client record was selected from the current bounded page.",
      consequence: "The client relationship opens without changing a quote, message, payment, booking, or customer record.",
      nextResolutionId: "review-client-next-step",
      enabled: available.openClient,
      disabledReason: "This view cannot open a client relationship right now.",
      primary: true
    });
    rows.push({ customerId, identity, primaryAction });
  });

  let viewState = "ready";
  if (rows.length === 0 && boundary.loading && !boundary.loadedAtISO) viewState = "loading";
  else if (rows.length === 0 && boundary.error && !boundary.loadedAtISO) viewState = "error";
  else if (rows.length === 0 && boundary.currentComplete) viewState = "empty";
  else if (boundary.stale || boundary.error) viewState = "stale";
  else if (!boundary.currentComplete || omittedRecords.length > 0) viewState = "bounded";

  return deepFreeze({
    modelId: AMBIENT_CLIENTS_MODEL,
    surfaceContract: AMBIENT_CLIENTS_LIST_SURFACE,
    state: viewState,
    rows,
    rowCount: rows.length,
    omittedRecords,
    boundary,
    capabilities: available,
    evidenceBoundary: "Caller-supplied, already organization-scoped directory records only. This projection performs no data read, mutation, authorization, provider action, or relationship inference."
  });
}

function normalizeRelationshipCapabilities(value = {}) {
  return {
    openOpportunity: value.openOpportunity === true,
    openWorkflow: value.openWorkflow === true,
    openConversation: value.openConversation === true,
    reviewRebook: value.reviewRebook === true || value.openRebook === true,
    reviewContext: value.reviewContext === true,
    refresh: value.refresh === true
  };
}

function validTimeZone(value) {
  const requested = text(value, 120);
  if (!requested) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: requested }).resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

function relationshipScope(workspace) {
  const customer = workspace?.customer && typeof workspace.customer === "object"
    ? workspace.customer
    : null;
  const clientId = safeId(customer?.customerId || customer?.id);
  const declaredClientIds = [safeId(customer?.customerId), safeId(customer?.id)].filter(Boolean);
  const organizationCandidates = [
    safeId(workspace?.organizationId),
    safeId(customer?.organizationId)
  ].filter(Boolean);
  const issues = [];
  if (!clientId) issues.push("The exact client identity is missing or malformed.");
  if (new Set(declaredClientIds).size > 1) issues.push("The client record contains conflicting identities.");
  if (new Set(organizationCandidates).size > 1) issues.push("The relationship sources do not agree on the organization.");

  let organizationId = organizationCandidates[0] || "";
  const quotes = [];
  const omittedQuotes = [];
  const seenQuoteIds = new Set();
  (Array.isArray(workspace?.quotes) ? workspace.quotes : []).forEach((quote, index) => {
    const quoteId = safeId(quote?.id || quote?.quoteId);
    const quoteClientId = safeId(quote?.customerId);
    const quoteOrganizationId = safeId(quote?.organizationId);
    let reason = "";
    if (!quoteId || !quoteClientId || !quoteOrganizationId) reason = "The opportunity identity or scope is incomplete.";
    else if (seenQuoteIds.has(quoteId)) reason = "The opportunity identity appears more than once.";
    else if (quoteClientId !== clientId) reason = "The opportunity belongs to a different client.";
    else if (organizationId && quoteOrganizationId !== organizationId) reason = "The opportunity belongs to a different organization.";
    if (reason) {
      omittedQuotes.push({ index, ...(quoteId ? { quoteId } : {}), reason });
      return;
    }
    if (!organizationId) organizationId = quoteOrganizationId;
    seenQuoteIds.add(quoteId);
    quotes.push(quote);
  });
  if (omittedQuotes.length) issues.push("One or more opportunities were left out because their exact client or organization scope could not be confirmed.");
  return { customer, clientId, organizationId, quotes, omittedQuotes, issues };
}

function relationshipBoundary({
  workspace,
  source,
  loadedAt,
  stale,
  loading,
  error,
  tenantTimeZone,
  radar,
  scope
}) {
  const normalizedSource = lower(source || workspace?.source);
  const sourceKnown = KNOWN_SOURCES.has(normalizedSource);
  const loadedAtISO = safeIso(loadedAt);
  const errorMessage = text(error);
  const quotePageInfo = workspace?.quotePageInfo && typeof workspace.quotePageInfo === "object"
    ? workspace.quotePageInfo
    : {};
  const versionPageInfo = workspace?.versionPageInfo && typeof workspace.versionPageInfo === "object"
    ? workspace.versionPageInfo
    : {};
  const quoteLimit = nonNegativeInteger(quotePageInfo.limit);
  const quoteBoundsKnown = quoteLimit !== null && typeof quotePageInfo.truncated === "boolean";
  const quoteReadTruncated = quotePageInfo.truncated === true;
  const versionLimit = nonNegativeInteger(versionPageInfo.perQuoteLimit);
  const truncatedQuoteIds = Array.isArray(versionPageInfo.truncatedQuoteIds)
    ? versionPageInfo.truncatedQuoteIds.map(safeId).filter(Boolean)
    : [];
  const versionBoundsKnown = versionLimit !== null && Array.isArray(versionPageInfo.truncatedQuoteIds);
  const versionReadTruncated = truncatedQuoteIds.length > 0;
  const radarSupplied = radar !== null && radar !== undefined;
  const radarTruncated = radarSupplied && radar?.pageInfo?.truncated === true;
  const requestedTimeZone = text(tenantTimeZone, 120);
  const timeZone = validTimeZone(requestedTimeZone);
  const issues = [...scope.issues];
  if (!sourceKnown) issues.push("The source of this relationship could not be confirmed.");
  if (!loadedAtISO) issues.push("No reliable completion time is available for this relationship.");
  if (!quoteBoundsKnown) issues.push("The linked-opportunity read limit was not reported.");
  if (!versionBoundsKnown) issues.push("The retained proposal-version read limit was not reported.");
  if (quoteReadTruncated) issues.push("Older linked opportunities exist beyond this bounded view.");
  if (versionReadTruncated) issues.push("Some displayed opportunities have older proposal versions beyond this view.");
  if (radarTruncated) issues.push("Additional repeat-event or closeout entries may exist beyond the supplied view.");
  if (requestedTimeZone && !timeZone) issues.push("The supplied tenant time zone could not be used.");
  if (stale) issues.push("The displayed relationship may be out of date.");
  if (errorMessage) issues.push("The latest relationship refresh did not finish.");
  if (loading) issues.push(loadedAtISO
    ? "A refresh is in progress; the last completed relationship remains visible."
    : "The client relationship is still loading.");
  const scopeValid = Boolean(scope.clientId) && scope.issues.length === 0;
  const currentComplete = scopeValid
    && sourceKnown
    && Boolean(loadedAtISO)
    && quoteBoundsKnown
    && versionBoundsKnown
    && !quoteReadTruncated
    && !versionReadTruncated
    && !radarTruncated
    && !stale
    && !loading
    && !errorMessage
    && (!requestedTimeZone || Boolean(timeZone));
  return {
    source: normalizedSource || "unknown",
    sourceLabel: sourceLabel(normalizedSource),
    sourceBoundary: sourceBoundary(normalizedSource),
    loadedAtISO,
    loading: loading === true,
    stale: stale === true,
    error: errorMessage || null,
    quoteRead: {
      limit: quoteLimit,
      displayed: scope.quotes.length,
      boundsKnown: quoteBoundsKnown,
      truncated: quoteReadTruncated
    },
    versionRead: {
      perOpportunityLimit: versionLimit,
      boundsKnown: versionBoundsKnown,
      truncated: versionReadTruncated,
      truncatedOpportunityIds: truncatedQuoteIds
    },
    rebookingRead: {
      supplied: radarSupplied,
      truncated: radarTruncated
    },
    calendar: {
      source: timeZone ? "tenant" : "upstream_relationship_read",
      timeZone: timeZone || null,
      reason: timeZone
        ? `Date context uses ${timeZone}.`
        : "This projection does not recalculate deadlines; it keeps the timing already supplied by the relationship read."
    },
    scopeValid,
    currentComplete,
    issues
  };
}

function clientIdentity(customer, clientId) {
  return {
    clientId,
    name: text(customer?.name || customer?.email) || "Unnamed client",
    company: text(customer?.company || customer?.organization),
    email: text(customer?.email, 320).toLowerCase(),
    phone: text(customer?.phone, 80)
  };
}

function quoteLabel(quote) {
  return text(quote?.event?.name || quote?.quoteNumber, 240) || "Opportunity";
}

function opportunityAction(quote, role, enabled, { primary = false, label = "Review opportunity", reason } = {}) {
  const quoteId = safeId(quote?.id || quote?.quoteId);
  const object = { id: quoteId, type: "opportunity", label: quoteLabel(quote) };
  return action({
    id: `${label === "Review deposit next step" ? "review-client-deposit" : "review-client-opportunity"}:${quoteId}`,
    label,
    role,
    object,
    targetId: quoteId,
    surfaceId: "living-opportunity",
    reason: reason || "This opportunity is part of the exact client relationship shown here.",
    consequence: "The opportunity opens without changing its quote, customer, pricing, payment, booking, or delivery state.",
    nextResolutionId: "review-opportunity-next-step",
    enabled,
    disabledReason: "This view cannot open the opportunity right now.",
    primary
  });
}

function activeOpportunityRows(quotes, role, capabilities) {
  return quotes
    .filter((quote) => ACTIVE_STATUSES.has(lower(quote?.status)))
    .sort((left, right) => (
      (safeIso(right?.updatedAtISO || right?.createdAtISO) || "")
        .localeCompare(safeIso(left?.updatedAtISO || left?.createdAtISO) || "")
      || text(left?.quoteNumber).localeCompare(text(right?.quoteNumber))
      || safeId(left?.id || left?.quoteId).localeCompare(safeId(right?.id || right?.quoteId))
    ))
    .map((quote) => {
      const quoteId = safeId(quote?.id || quote?.quoteId);
      return {
        quoteId,
        quoteNumber: text(quote?.quoteNumber, 120) || "Quote number not recorded",
        status: lower(quote?.status),
        eventName: quoteLabel(quote),
        eventDate: text(quote?.event?.date, 40),
        updatedAtISO: safeIso(quote?.updatedAtISO || quote?.createdAtISO),
        action: opportunityAction(quote, role, capabilities.openOpportunity)
      };
    });
}

function conversationRows(workspace, quoteById, role, capabilities) {
  const seen = new Set();
  return (Array.isArray(workspace?.conversations) ? workspace.conversations : []).flatMap((entry) => {
    const quoteId = safeId(entry?.quoteId);
    if (!quoteId || seen.has(quoteId) || !quoteById.has(quoteId)) return [];
    seen.add(quoteId);
    const messageCount = nonNegativeInteger(entry?.messageCount);
    const summaryAvailable = entry?.summaryAvailable === true && messageCount !== null;
    const latestActorType = ["customer", "staff"].includes(lower(entry?.latestActorType))
      ? lower(entry.latestActorType)
      : "";
    const latestMessageAtISO = safeIso(entry?.latestMessageAtISO);
    const object = { id: quoteId, type: "opportunity", label: quoteLabel(quoteById.get(quoteId)) };
    const reviewAction = action({
      id: `review-client-conversation:${quoteId}`,
      label: "Review conversation",
      role,
      object,
      targetId: quoteId,
      surfaceId: "conversation",
      reason: "A quote-scoped conversation is linked to this exact client opportunity.",
      consequence: "Opening the conversation sends nothing and does not mark any message read.",
      nextResolutionId: "review-quote-scoped-conversation",
      enabled: capabilities.openConversation,
      disabledReason: "This view cannot open the conversation right now.",
      primary: false
    });
    return [{
      quoteId,
      quoteNumber: text(entry?.quoteNumber, 120) || text(quoteById.get(quoteId)?.quoteNumber, 120),
      summaryAvailable,
      messageCount: summaryAvailable ? messageCount : null,
      latestMessageAtISO,
      latestActorType,
      latestActivity: latestActorType && latestMessageAtISO
        ? `Latest recorded message came from ${latestActorType}.`
        : "No exact latest-message summary is available.",
      unreadState: "not_inferred",
      action: reviewAction
    }];
  });
}

function radarScopeMatches(radar, clientId, organizationId) {
  if (radar === null || radar === undefined) return true;
  const radarClientId = safeId(radar?.customerId);
  const radarOrganizationId = safeId(radar?.organizationId);
  return Boolean(
    radarClientId
    && radarClientId === clientId
    && (!organizationId || (radarOrganizationId && radarOrganizationId === organizationId))
  );
}

function rebookRows(radar, quoteById, role, capabilities, scopeMatches) {
  if (!scopeMatches) return [];
  return (Array.isArray(radar?.opportunities) ? radar.opportunities : []).flatMap((entry) => {
    if (lower(entry?.type) !== "anniversary_rebooking") return [];
    const id = safeId(entry?.id);
    const quoteId = safeId(entry?.quoteId);
    const reviewed = entry?.reviewedAction && typeof entry.reviewedAction === "object"
      ? entry.reviewedAction
      : {};
    const state = lower(reviewed.state);
    const sourceQuoteId = safeId(reviewed.sourceQuoteId || quoteId);
    const sourceVersionId = safeId(reviewed.sourceVersionId);
    const existingQuoteId = safeId(reviewed.existingQuoteId);
    const ready = state === "ready_for_staff_review"
      && sourceQuoteId === quoteId
      && Boolean(sourceVersionId)
      && quoteById.has(sourceQuoteId);
    const existing = state === "existing_rebook"
      && Boolean(existingQuoteId)
      && quoteById.has(existingQuoteId);
    if (!id || !quoteId || !quoteById.has(quoteId)) return [];
    const targetQuoteId = existing ? existingQuoteId : sourceQuoteId;
    const exact = ready || existing;
    const label = existing ? "Review matching opportunity" : "Review repeat-event option";
    const object = { id: targetQuoteId || quoteId, type: "opportunity", label: quoteLabel(quoteById.get(targetQuoteId || quoteId)) };
    const reviewAction = action({
      id: `review-client-rebook:${id}`,
      label,
      role,
      object,
      targetId: id,
      surfaceId: "client-rebook",
      reason: existing
        ? "An exact matching repeat-event opportunity is recorded in this bounded relationship."
        : ready
          ? "The accepted source version is identified for a staff-reviewed repeat-event option."
          : "The repeat-event source is present, but its exact review path is not available.",
      consequence: "Reviewing this entry creates no draft, sends no message, and establishes no booking or payment outcome.",
      nextResolutionId: existing ? "review-matching-opportunity" : "review-repeat-event-source",
      enabled: exact && capabilities.reviewRebook,
      disabledReason: exact
        ? "This view cannot open the repeat-event review right now."
        : "The exact accepted source or matching opportunity could not be confirmed.",
      primary: false,
      targetKind: "context"
    });
    return [{
      id,
      quoteId,
      title: text(entry?.title, 300) || "Repeat-event option",
      eventName: text(entry?.event?.name, 240),
      eventDate: text(entry?.event?.date, 40),
      anniversaryDate: text(entry?.timing?.anniversaryDate, 40),
      state: exact ? state : "unavailable",
      exactSource: ready,
      matchingOpportunity: existing,
      sourceVersionId: ready ? sourceVersionId : null,
      action: reviewAction
    }];
  });
}

function attentionTarget(item, quoteById, role, capabilities) {
  const type = lower(item?.type);
  const state = lower(item?.state);
  const quoteId = safeId(item?.quoteId);
  const quote = quoteById.get(quoteId);
  if (!KNOWN_ATTENTION_TYPES.has(type) || !quote) return null;
  const requestId = safeId(
    type === "approval"
      ? item?.pendingRequests?.[0]?.id || item?.id
      : type === "unread_customer_reply"
        ? item?.attentionId || item?.sourceRequestId || item?.id
        : type === "change_request"
          ? item?.sourceRequestId || item?.id
          : item?.id
  );
  const messageId = safeId(item?.messageId);
  if (!requestId) return null;
  if (type === "unread_customer_reply" && (!messageId || state !== "open")) return null;
  const blocked = type === "approval"
    || (type === "post_event_closeout" && ["blocked_source", "blocked_configuration"].includes(state));
  const customerOriginated = type === "change_request" || type === "unread_customer_reply";
  const rank = blocked ? 0 : customerOriginated ? 1 : 2;
  let label = "Review client follow-up";
  if (type === "approval") label = "Review pending approval";
  else if (type === "change_request") label = "Review requested changes";
  else if (type === "unread_customer_reply") label = "Review customer reply";
  else if (type === "follow_up") label = state === "overdue" ? "Resolve overdue follow-up" : "Review today’s follow-up";
  else if (type === "post_event_closeout") label = blocked ? "Review event follow-up boundary" : "Review event follow-up";
  const useConversation = type === "unread_customer_reply" && capabilities.openConversation;
  const enabled = useConversation ? capabilities.openConversation : capabilities.openWorkflow;
  const surfaceId = useConversation ? "conversation" : "workflow";
  const targetId = useConversation ? messageId : requestId;
  const object = useConversation
    ? { id: messageId, type: "customer-communication-evidence", label: "Customer reply" }
    : { id: quoteId, type: "opportunity", label: quoteLabel(quote) };
  const primaryAction = action({
    id: `review-client-${type}:${quoteId}:${targetId}`,
    label,
    purpose: "resolve",
    role,
    object,
    targetId,
    surfaceId,
    reason: type === "unread_customer_reply"
      ? "An exact open customer-reply record is linked to this client opportunity."
      : type === "change_request"
        ? "An exact customer request is waiting on this client opportunity."
        : `A tracked ${type.replaceAll("_", " ")} is waiting on this client opportunity.`,
    consequence: useConversation
      ? "The exact reply opens without sending a response or marking it read."
      : "The exact task opens without resolving it or changing the client or opportunity.",
    nextResolutionId: useConversation ? "review-exact-customer-reply" : "review-exact-workflow-item",
    enabled,
    disabledReason: useConversation
      ? "This view cannot open the exact customer reply right now."
      : "This view cannot open the exact task right now.",
    primary: true
  });
  return {
    rank,
    sortDate: safeIso(item?.dateISO) || "",
    sortId: requestId,
    action: primaryAction,
    target: {
      kind: useConversation ? "messages" : "workflow",
      quoteId,
      attentionType: type,
      requestId,
      ...(messageId ? { messageId } : {})
    }
  };
}

function selectedRelationshipContext(workspace, quoteById, activeOpportunities, validAttention) {
  const nextEvent = workspace?.briefing?.nextEvent;
  const nextEventQuoteId = safeId(nextEvent?.quoteId);
  const safeNextEvent = nextEventQuoteId && quoteById.has(nextEventQuoteId)
    ? {
        quoteId: nextEventQuoteId,
        eventName: text(nextEvent?.eventName, 240) || quoteLabel(quoteById.get(nextEventQuoteId)),
        date: text(nextEvent?.date, 40),
        time: text(nextEvent?.time, 40)
      }
    : null;
  const activity = (Array.isArray(workspace?.recentActivity) ? workspace.recentActivity : [])
    .find((entry) => quoteById.has(safeId(entry?.quoteId)) && safeIso(entry?.atISO));
  return {
    displayedOpportunityCount: quoteById.size,
    activeOpportunityCount: activeOpportunities.length,
    attentionCount: validAttention.length,
    nextEvent: safeNextEvent,
    latestActivity: activity ? {
      quoteId: safeId(activity.quoteId),
      label: text(activity.label, 240) || "Recorded relationship activity",
      atISO: safeIso(activity.atISO)
    } : null,
    countsAreBounded: true
  };
}

function contextFallback(client, role, capabilities) {
  return {
    rank: 6,
    sortDate: "",
    sortId: client.clientId,
    action: action({
      id: `review-client-context:${client.clientId}`,
      label: "Review relationship history",
      role,
      object: { id: client.clientId, type: "client", label: client.name },
      targetId: client.clientId,
      surfaceId: AMBIENT_CLIENT_RELATIONSHIP_SURFACE.id,
      reason: "No higher-priority tracked step is available in this bounded client view.",
      consequence: "The relationship context stays read-only; no customer, quote, message, payment, or booking record changes.",
      nextResolutionId: "review-recorded-relationship-context",
      enabled: capabilities.reviewContext,
      disabledReason: "No additional relationship context can be opened from this view.",
      primary: true,
      targetKind: "context"
    }),
    target: { kind: "client_context", clientId: client.clientId }
  };
}

/**
 * Pure projection over an existing CustomerWorkspace DTO and an optional
 * already-evaluated rebooking radar. It never reads, writes, reprices, sends,
 * marks a message read, or grants authority to an underlying action.
 */
export function buildAmbientClientRelationship({
  workspace = null,
  source = "",
  loadedAt = null,
  stale = false,
  loading = false,
  error = "",
  rebookingRadar = null,
  currentUserRole = "staff",
  tenantTimeZone = "",
  capabilities = {}
} = {}) {
  const role = normalizedRole(currentUserRole);
  const available = normalizeRelationshipCapabilities(capabilities);
  const scope = relationshipScope(workspace);
  const radarMatches = radarScopeMatches(rebookingRadar, scope.clientId, scope.organizationId);
  if (!radarMatches) scope.issues.push("The repeat-event view does not match this exact client relationship.");
  const boundary = relationshipBoundary({
    workspace,
    source,
    loadedAt,
    stale,
    loading,
    error,
    tenantTimeZone,
    radar: rebookingRadar,
    scope
  });

  if (!scope.customer || !scope.clientId) {
    return deepFreeze({
      modelId: AMBIENT_CLIENT_RELATIONSHIP_MODEL,
      surfaceContract: AMBIENT_CLIENT_RELATIONSHIP_SURFACE,
      state: loading ? "loading" : error ? "error" : "unavailable",
      client: null,
      boundary,
      relationshipContext: null,
      activeOpportunities: [],
      conversations: [],
      rebookEntries: [],
      primaryAction: null,
      primaryTarget: null,
      caughtUp: {
        eligible: false,
        reason: "The exact client relationship could not be established."
      },
      omittedRecords: scope.omittedQuotes,
      capabilities: available,
      evidenceBoundary: "No relationship conclusion or action is available without one exact client identity."
    });
  }

  const client = clientIdentity(scope.customer, scope.clientId);
  const quoteById = new Map(scope.quotes.map((quote) => [safeId(quote?.id || quote?.quoteId), quote]));
  const activeOpportunities = activeOpportunityRows(scope.quotes, role, available);
  const conversations = conversationRows(workspace, quoteById, role, available);
  const rebookEntries = rebookRows(
    rebookingRadar,
    quoteById,
    role,
    available,
    radarMatches
  );
  const validAttention = (Array.isArray(workspace?.attention?.items) ? workspace.attention.items : [])
    .map((item) => attentionTarget(item, quoteById, role, available))
    .filter(Boolean);
  const candidates = [...validAttention];

  const acceptedWithoutDeposit = scope.quotes.find((quote) => (
    lower(quote?.status) === "accepted"
    && ["", "unpaid"].includes(lower(quote?.payment?.depositStatus))
  ));
  if (acceptedWithoutDeposit) {
    const depositAction = opportunityAction(acceptedWithoutDeposit, role, available.openOpportunity, {
      primary: true,
      label: "Review deposit next step",
      reason: "Proposal acceptance is recorded, while a provider-confirmed deposit is not recorded on this opportunity."
    });
    candidates.push({
      rank: 3,
      sortDate: safeIso(acceptedWithoutDeposit?.updatedAtISO) || "",
      sortId: safeId(acceptedWithoutDeposit?.id || acceptedWithoutDeposit?.quoteId),
      action: depositAction,
      target: {
        kind: "opportunity",
        quoteId: safeId(acceptedWithoutDeposit?.id || acceptedWithoutDeposit?.quoteId),
        focus: "money"
      }
    });
  }

  const exactRebook = rebookEntries.find((entry) => entry.exactSource || entry.matchingOpportunity);
  if (exactRebook) {
    candidates.push({
      rank: 4,
      sortDate: exactRebook.anniversaryDate || exactRebook.eventDate,
      sortId: exactRebook.id,
      action: action({
        ...{
          id: exactRebook.action.id,
          label: exactRebook.action.outcomeLabel,
          role,
          object: exactRebook.action.arrivalContract.object,
          targetId: exactRebook.action.executionTarget.targetId,
          surfaceId: exactRebook.action.executionTarget.surfaceId,
          reason: exactRebook.action.arrivalContract.reason,
          consequence: exactRebook.action.arrivalContract.consequence,
          nextResolutionId: exactRebook.action.arrivalContract.nextResolutionIds[0],
          enabled: exactRebook.action.enabled,
          disabledReason: exactRebook.action.disabledReason,
          primary: true,
          targetKind: "context"
        }
      }),
      target: { kind: "rebook", entryId: exactRebook.id, quoteId: exactRebook.quoteId }
    });
  }

  if (activeOpportunities.length > 0) {
    const selected = activeOpportunities[0];
    const quote = quoteById.get(selected.quoteId);
    candidates.push({
      rank: 5,
      sortDate: selected.updatedAtISO || "",
      sortId: selected.quoteId,
      action: opportunityAction(quote, role, available.openOpportunity, { primary: true }),
      target: { kind: "opportunity", quoteId: selected.quoteId }
    });
  }

  candidates.push(contextFallback(client, role, available));
  candidates.sort((left, right) => (
    left.rank - right.rank
    || left.sortDate.localeCompare(right.sortDate)
    || left.sortId.localeCompare(right.sortId)
  ));
  const primary = candidates[0];
  const relationshipContext = selectedRelationshipContext(
    workspace,
    quoteById,
    activeOpportunities,
    validAttention
  );
  const caughtUp = {
    eligible: boundary.currentComplete
      && primary.target.kind === "client_context"
      && rebookEntries.every((entry) => !entry.exactSource && !entry.matchingOpportunity),
    reason: ""
  };
  caughtUp.reason = caughtUp.eligible
    ? "No tracked client or opportunity follow-up needs attention in this current bounded view. This is not a lifetime-history, customer-activity, payment, booking, or event-readiness claim."
    : !boundary.currentComplete
      ? "Caught-up language is withheld because the relationship source, freshness, scope, or read bounds are incomplete."
      : "At least one supported next step is available in this bounded relationship.";

  let viewState = "ready";
  if (loading && !loadedAt) viewState = "loading";
  else if (error && !loadedAt) viewState = "error";
  else if (stale || error) viewState = "stale";
  else if (!boundary.currentComplete) viewState = "bounded";

  return deepFreeze({
    modelId: AMBIENT_CLIENT_RELATIONSHIP_MODEL,
    surfaceContract: AMBIENT_CLIENT_RELATIONSHIP_SURFACE,
    state: viewState,
    client,
    boundary,
    relationshipContext,
    activeOpportunities,
    conversations,
    rebookEntries,
    primaryAction: primary.action,
    primaryTarget: primary.target,
    caughtUp,
    omittedRecords: scope.omittedQuotes,
    capabilities: available,
    evidenceBoundary: "Caller-supplied Customer 360 evidence only. Counts describe displayed bounded records; latest-message summaries do not establish unread state, and no value here is a lifetime relationship total."
  });
}
