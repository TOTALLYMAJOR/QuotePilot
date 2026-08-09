export const CUSTOMER_COMMERCIAL_TIMELINE_DEFAULT_LIMIT = 40;
export const CUSTOMER_COMMERCIAL_TIMELINE_MAX_LIMIT = 50;

const WORKSPACE_SOURCE_LABELS = Object.freeze({
  firebase: "Firestore customer workspace",
  local: "Browser-local customer workspace",
  mixed: "Mixed customer workspace sources"
});

const RECORD_SOURCE_LABELS = Object.freeze({
  "quote.record": "Customer-scoped quote record",
  "quote.lifecycle": "Recorded quote lifecycle",
  "quote.delivery": "Recorded provider-acceptance audit",
  "quote.portal_decision": "Recorded customer portal decision",
  "quote.acceptance_receipt": "Recorded proposal acceptance receipt",
  "quote.booking": "Recorded booking state",
  "quote.payment": "Recorded provider-confirmed payment state",
  "quote.conversation_summary": "Server-owned quote conversation summary",
  "quote.version": "Immutable quote version"
});

function text(value) {
  return String(value ?? "").trim();
}

function safeOpaqueId(value) {
  const id = text(value);
  if (
    !id
    || id.length > 256
    || /[\s/?#\\\u0000]/u.test(id)
    || id === "."
    || id === ".."
    || /^[^@\s]+@[^@\s]+$/.test(id)
  ) {
    return "";
  }
  return id;
}

function evidenceISO(value) {
  let candidate = value;
  if (typeof value?.toDate === "function") candidate = value.toDate();
  if (candidate instanceof Date) {
    return Number.isNaN(candidate.getTime()) ? "" : candidate.toISOString();
  }
  const raw = text(candidate);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeWorkspaceSource(value) {
  const source = text(value).toLowerCase();
  return Object.hasOwn(WORKSPACE_SOURCE_LABELS, source) ? source : "unknown";
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === "") {
    return CUSTOMER_COMMERCIAL_TIMELINE_DEFAULT_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return CUSTOMER_COMMERCIAL_TIMELINE_DEFAULT_LIMIT;
  return Math.min(
    CUSTOMER_COMMERCIAL_TIMELINE_MAX_LIMIT,
    Math.max(1, Math.floor(parsed))
  );
}

function versionLabel(version = {}) {
  const versionNumber = Number(version.versionNumber);
  if (Number.isInteger(versionNumber) && versionNumber > 0) {
    return `Proposal version ${versionNumber} saved`;
  }
  return "Proposal version saved";
}

function addTimelineItem(items, dedupeKeys, {
  category,
  code,
  label,
  atISO,
  quoteId,
  quoteNumber = "",
  revisionId = "",
  source,
  dedupeGroup = code
}) {
  const normalizedAtISO = evidenceISO(atISO);
  const normalizedQuoteId = safeOpaqueId(quoteId);
  const normalizedRevisionId = revisionId ? safeOpaqueId(revisionId) : "";
  if (!normalizedAtISO || !normalizedQuoteId || !RECORD_SOURCE_LABELS[source]) return;
  const dedupeKey = `${normalizedQuoteId}:${dedupeGroup}:${normalizedAtISO}`;
  if (dedupeKeys.has(dedupeKey)) return;
  dedupeKeys.add(dedupeKey);
  items.push({
    id: `${normalizedQuoteId}:${code}:${normalizedRevisionId || normalizedAtISO}`,
    category,
    code,
    label,
    atISO: normalizedAtISO,
    quoteId: normalizedQuoteId,
    quoteNumber: text(quoteNumber),
    revisionId: normalizedRevisionId,
    source,
    sourceLabel: RECORD_SOURCE_LABELS[source]
  });
}

function addQuoteMilestones(items, dedupeKeys, quote) {
  const quoteId = safeOpaqueId(quote?.id || quote?.quoteId);
  if (!quoteId) return;
  const common = { quoteId, quoteNumber: quote?.quoteNumber };
  const lifecycle = quote?.lifecycle && typeof quote.lifecycle === "object"
    ? quote.lifecycle
    : {};
  const createdAtISO = evidenceISO(lifecycle.draftAtISO)
    ? lifecycle.draftAtISO
    : quote?.createdAtISO;
  addTimelineItem(items, dedupeKeys, {
    ...common,
    category: "quote",
    code: "quote_created",
    label: "Quote created",
    atISO: createdAtISO,
    source: evidenceISO(lifecycle.draftAtISO) ? "quote.lifecycle" : "quote.record"
  });

  addTimelineItem(items, dedupeKeys, {
    ...common,
    category: "delivery",
    code: "proposal_sent",
    label: "Proposal sent status recorded",
    atISO: lifecycle.sentAtISO,
    source: "quote.lifecycle"
  });
  addTimelineItem(items, dedupeKeys, {
    ...common,
    category: "view",
    code: "proposal_viewed",
    label: "Recipient proposal view recorded",
    atISO: lifecycle.viewedAtISO,
    source: "quote.lifecycle"
  });

  const delivery = quote?.workflow?.quoteDelivery
    && typeof quote.workflow.quoteDelivery === "object"
    ? quote.workflow.quoteDelivery
    : {};
  if (
    text(delivery.state).toLowerCase() === "provider_accepted"
    && safeOpaqueId(delivery.revisionId)
  ) {
    addTimelineItem(items, dedupeKeys, {
      ...common,
      category: "delivery",
      code: "provider_accepted",
      label: "Email provider accepted the send request",
      atISO: delivery.providerAcceptedAtISO,
      revisionId: delivery.revisionId,
      source: "quote.delivery"
    });
  }

  const decision = quote?.portalDecision && typeof quote.portalDecision === "object"
    ? quote.portalDecision
    : {};
  const decisionType = text(decision.decision).toLowerCase();
  const decisionLabels = {
    accepted: "Customer accepted the proposal",
    declined: "Customer declined the proposal",
    changes_requested: "Customer requested proposal changes"
  };
  if (decisionLabels[decisionType]) {
    addTimelineItem(items, dedupeKeys, {
      ...common,
      category: "decision",
      code: `decision_${decisionType}`,
      label: decisionLabels[decisionType],
      atISO: decision.submittedAtISO,
      source: "quote.portal_decision",
      dedupeGroup: `decision:${decisionType}`
    });
  }

  addTimelineItem(items, dedupeKeys, {
    ...common,
    category: "decision",
    code: "proposal_accepted",
    label: "Proposal acceptance recorded",
    atISO: lifecycle.acceptedAtISO,
    source: "quote.lifecycle",
    dedupeGroup: "decision:accepted"
  });
  addTimelineItem(items, dedupeKeys, {
    ...common,
    category: "decision",
    code: "proposal_declined",
    label: "Proposal decline recorded",
    atISO: lifecycle.declinedAtISO,
    source: "quote.lifecycle",
    dedupeGroup: "decision:declined"
  });

  const acceptanceReceipt = quote?.acceptanceReceipt
    && typeof quote.acceptanceReceipt === "object"
    ? quote.acceptanceReceipt
    : {};
  if (safeOpaqueId(acceptanceReceipt.quoteRevisionId)) {
    addTimelineItem(items, dedupeKeys, {
      ...common,
      category: "decision",
      code: "acceptance_receipt_recorded",
      label: "Typed acceptance evidence recorded",
      atISO: acceptanceReceipt.acceptedAtISO,
      revisionId: acceptanceReceipt.quoteRevisionId,
      source: "quote.acceptance_receipt"
    });
  }

  const booking = quote?.booking && typeof quote.booking === "object" ? quote.booking : {};
  const lifecycleBookedAtISO = evidenceISO(lifecycle.bookedAtISO);
  addTimelineItem(items, dedupeKeys, {
    ...common,
    category: "booking",
    code: "event_booked",
    label: "Event booking recorded",
    atISO: lifecycleBookedAtISO || booking.bookedAtISO,
    source: lifecycleBookedAtISO ? "quote.lifecycle" : "quote.booking",
    dedupeGroup: "booking:event"
  });
  addTimelineItem(items, dedupeKeys, {
    ...common,
    category: "booking",
    code: "contract_created",
    label: "Booking contract created",
    atISO: booking.contractConvertedAtISO,
    source: "quote.booking"
  });
}

function addVersionMilestones(items, dedupeKeys, versions, allowedQuoteIds) {
  (Array.isArray(versions) ? versions : []).forEach((version) => {
    const quoteId = safeOpaqueId(version?.quoteId);
    const revisionId = safeOpaqueId(version?.id || version?.revisionId);
    if (!quoteId || !revisionId || !allowedQuoteIds.has(quoteId)) return;
    addTimelineItem(items, dedupeKeys, {
      category: "version",
      code: "proposal_version_saved",
      label: versionLabel(version),
      atISO: version.createdAtISO || version.createdAt || version.timestamp,
      quoteId,
      quoteNumber: version.quoteNumber,
      revisionId,
      source: "quote.version",
      dedupeGroup: `version:${revisionId}`
    });
  });
}

function addPaymentMilestones(items, dedupeKeys, money, allowedQuoteIds, quoteNumbers) {
  (Array.isArray(money) ? money : []).forEach((payment) => {
    const quoteId = safeOpaqueId(payment?.quoteId);
    if (!quoteId || !allowedQuoteIds.has(quoteId)) return;
    const kind = text(payment?.kind).toLowerCase();
    const status = text(payment?.status).toLowerCase();
    if (kind === "deposit" && ["paid", "refunded"].includes(status)) {
      addTimelineItem(items, dedupeKeys, {
        category: "payment",
        code: "deposit_confirmed",
        label: status === "refunded"
          ? "Deposit payment was previously confirmed"
          : "Deposit payment confirmed",
        atISO: payment.evidenceAtISO,
        quoteId,
        quoteNumber: payment.quoteNumber || quoteNumbers.get(quoteId),
        source: "quote.payment"
      });
    }
    if (kind === "final_balance" && status === "paid") {
      addTimelineItem(items, dedupeKeys, {
        category: "payment",
        code: "final_balance_confirmed",
        label: "Final-balance payment confirmed",
        atISO: payment.evidenceAtISO,
        quoteId,
        quoteNumber: payment.quoteNumber || quoteNumbers.get(quoteId),
        source: "quote.payment"
      });
    }
  });
}

function addConversationMilestones(items, dedupeKeys, conversations, allowedQuoteIds, quoteNumbers) {
  (Array.isArray(conversations) ? conversations : []).forEach((conversation) => {
    const quoteId = safeOpaqueId(conversation?.quoteId);
    const messageCount = Number(conversation?.messageCount);
    if (
      !quoteId
      || !allowedQuoteIds.has(quoteId)
      || conversation?.summaryAvailable !== true
      || !Number.isFinite(messageCount)
      || messageCount < 1
    ) {
      return;
    }
    const actorType = text(conversation?.latestActorType).toLowerCase();
    const label = actorType === "customer"
      ? "Latest customer conversation activity recorded"
      : actorType === "staff"
        ? "Latest staff conversation activity recorded"
        : "Latest quote conversation activity recorded";
    addTimelineItem(items, dedupeKeys, {
      category: "conversation",
      code: "conversation_latest_activity",
      label,
      atISO: conversation.latestMessageAtISO,
      quoteId,
      quoteNumber: conversation.quoteNumber || quoteNumbers.get(quoteId),
      source: "quote.conversation_summary"
    });
  });
}

function emptyBounds(limit, workspace = {}, allowedQuoteIds = new Set()) {
  const truncatedVersionIds = Array.isArray(workspace?.versionPageInfo?.truncatedQuoteIds)
    ? workspace.versionPageInfo.truncatedQuoteIds
        .map(safeOpaqueId)
        .filter((quoteId) => quoteId && allowedQuoteIds.has(quoteId))
    : [];
  return {
    limit,
    returned: 0,
    candidateCount: 0,
    truncated: false,
    timelineTruncated: false,
    quoteReadTruncated: workspace?.quotePageInfo?.truncated === true,
    quoteReadLimit: Number(workspace?.quotePageInfo?.limit) || 0,
    versionReadTruncated: truncatedVersionIds.length > 0,
    versionReadTruncatedQuoteCount: new Set(truncatedVersionIds).size,
    versionPerQuoteLimit: Number(workspace?.versionPageInfo?.perQuoteLimit) || 0
  };
}

export function buildCustomerCommercialTimeline(customerWorkspace = {}, { limit } = {}) {
  const resolvedLimit = normalizeLimit(limit);
  const workspaceSource = normalizeWorkspaceSource(customerWorkspace?.source);
  const customerId = safeOpaqueId(
    customerWorkspace?.customer?.customerId || customerWorkspace?.customer?.id
  );
  if (!customerId) {
    throw new TypeError("A Customer 360 DTO with an opaque customerId is required.");
  }

  const quotes = (Array.isArray(customerWorkspace?.quotes) ? customerWorkspace.quotes : [])
    .filter((quote) => (
      safeOpaqueId(quote?.id || quote?.quoteId)
      && text(quote?.customerId) === customerId
    ));
  const allowedQuoteIds = new Set(quotes.map((quote) => safeOpaqueId(quote.id || quote.quoteId)));
  const quoteNumbers = new Map(quotes.map((quote) => [
    safeOpaqueId(quote.id || quote.quoteId),
    text(quote.quoteNumber)
  ]));
  const items = [];
  const dedupeKeys = new Set();

  quotes.forEach((quote) => addQuoteMilestones(items, dedupeKeys, quote));
  addVersionMilestones(
    items,
    dedupeKeys,
    customerWorkspace?.proposalVersions,
    allowedQuoteIds
  );
  addPaymentMilestones(
    items,
    dedupeKeys,
    customerWorkspace?.money,
    allowedQuoteIds,
    quoteNumbers
  );
  addConversationMilestones(
    items,
    dedupeKeys,
    customerWorkspace?.conversations,
    allowedQuoteIds,
    quoteNumbers
  );

  items.sort((left, right) => (
    right.atISO.localeCompare(left.atISO)
    || left.quoteId.localeCompare(right.quoteId)
    || left.code.localeCompare(right.code)
    || left.id.localeCompare(right.id)
  ));
  const pageInfo = emptyBounds(resolvedLimit, customerWorkspace, allowedQuoteIds);
  pageInfo.returned = Math.min(items.length, resolvedLimit);
  pageInfo.candidateCount = items.length;
  pageInfo.timelineTruncated = items.length > resolvedLimit;
  pageInfo.truncated = pageInfo.timelineTruncated
    || pageInfo.quoteReadTruncated
    || pageInfo.versionReadTruncated;
  const timelineItems = items.slice(0, resolvedLimit);

  return {
    status: pageInfo.truncated
      ? "partial"
      : timelineItems.length > 0
        ? "success"
        : "empty",
    source: workspaceSource,
    sourceLabel: WORKSPACE_SOURCE_LABELS[workspaceSource] || "Customer workspace source not confirmed",
    evidenceBoundary: "Recorded milestones only; provider acceptance, delivery, recipient view, booking, and payment remain distinct.",
    customerId,
    items: timelineItems,
    pageInfo
  };
}
