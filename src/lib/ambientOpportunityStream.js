import {
  createAmbientAction,
  createOpportunityMomentum,
  createSurfacePurposeContract,
  rankAmbientNextActions
} from "./ambientContracts";
import {
  STATUS_FAMILY,
  classifyBookingConfirmation,
  classifyDepositStatus,
  classifyFinalBalanceDisplayStatus,
  classifyQuoteStatus
} from "./statusSemantics";
import {
  buildProposalReadiness,
  buildWorkflowAttentionSummary,
  getWorkflowAttentionFocusId
} from "./quoteWorkflow";
import {
  formatWorkspaceDate,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceSource,
  formatWorkspaceText,
  hasWorkspaceNumber
} from "./workspacePresentation";
import { readCommercialEvidencePresence } from "./commercialEvidencePresence";

export const AMBIENT_OPPORTUNITY_STREAM_MODEL = "ambient-opportunity-stream-v1";

export const AMBIENT_OPPORTUNITIES_SURFACE_CONTRACT = createSurfacePurposeContract({
  id: "ambient-opportunities-stream",
  objectScopes: ["opportunity", "quote-lifecycle-evidence", "workflow-item"],
  purposes: ["clarify", "advance", "resolve", "reveal_context"],
  entryReason: "Orient staff around each loaded opportunity, its bounded evidence, and one exact next step.",
  allowedEmptyState: {
    kind: "starting_action",
    message: "No opportunity records were returned by the completed bounded read.",
    actionId: "start-opportunity"
  },
  recoveryBehavior: {
    message: "Keep any completed records visible and ask the host to refresh the same tenant-scoped read.",
    nextActionIds: ["refresh-opportunities"]
  }
});

const QUOTE_LIFECYCLE_STATES = new Set([
  "draft",
  "sent",
  "viewed",
  "accepted",
  "booked",
  "declined",
  "expired",
  "deleted"
]);

const BOOKING_STATES = new Set(["pending", "sent", "confirmed", "cancelled"]);
const DEPOSIT_STATES = new Set(["unpaid", "sent", "paid", "refunded"]);
const FINAL_BALANCE_STATES = new Set([
  "unpaid",
  "sent",
  "prepared",
  "processing",
  "paid",
  "failed",
  "expired"
]);

const OPPORTUNITY_GROUPS = Object.freeze([
  Object.freeze({ id: "needs-attention", label: "Needs attention" }),
  Object.freeze({ id: "active-recent", label: "Active & recent" }),
  Object.freeze({ id: "recent-closed", label: "Recent & closed" })
]);

const OPPORTUNITY_GROUP_PRIORITY = Object.freeze(
  Object.fromEntries(OPPORTUNITY_GROUPS.map((group, index) => [group.id, index]))
);

const CLOSED_LIFECYCLE_STATES = new Set(["declined", "expired", "deleted"]);

function text(value) {
  return String(value ?? "").trim();
}

function normalizedText(value) {
  return text(value).toLowerCase();
}

function safeIso(value) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function normalizedRole(value) {
  return normalizedText(value) || "staff";
}

function unavailableFact(id, label, reason, raw = null) {
  return {
    id,
    label,
    raw,
    available: false,
    family: STATUS_FAMILY.INFO,
    value: "Not recorded",
    reason
  };
}

function semanticFact({ id, label, raw, allowed, classify }) {
  const normalized = normalizedText(raw);
  if (!normalized) {
    return unavailableFact(id, label, `${label} is absent from this quote record.`);
  }
  if (!allowed.has(normalized)) {
    return unavailableFact(
      id,
      label,
      `${label} uses an unrecognized value and is not interpreted.`,
      normalized
    );
  }
  const semantics = classify(normalized);
  return {
    id,
    label,
    raw: normalized,
    available: true,
    family: semantics.family,
    value: semantics.label,
    reason: `Recorded ${label.toLowerCase()} value: ${normalized}.`
  };
}

function statusFacts(quote) {
  const evidencePresence = readCommercialEvidencePresence(quote);
  const lifecycle = semanticFact({
    id: "quote-lifecycle",
    label: "Quote lifecycle",
    raw: quote?.status,
    allowed: QUOTE_LIFECYCLE_STATES,
    classify: classifyQuoteStatus
  });
  const booking = semanticFact({
    id: "booking-confirmation",
    label: "Booking confirmation",
    raw: evidencePresence.bookingStatus ? evidencePresence.bookingStatusValue : "",
    allowed: BOOKING_STATES,
    classify: classifyBookingConfirmation
  });
  const deposit = semanticFact({
    id: "deposit-status",
    label: "Deposit",
    raw: evidencePresence.depositStatus ? evidencePresence.depositStatusValue : "",
    allowed: DEPOSIT_STATES,
    classify: classifyDepositStatus
  });
  const finalBalanceStatus = normalizedText(evidencePresence.finalBalanceStatusValue);
  const finalBalanceCheckoutState = normalizedText(
    evidencePresence.finalBalanceCheckoutStateValue
  );
  const finalBalanceRaw = finalBalanceStatus === "paid"
    ? "paid"
    : finalBalanceCheckoutState || finalBalanceStatus;
  const finalBalance = semanticFact({
    id: "final-balance-status",
    label: "Final balance",
    raw: evidencePresence.finalBalanceStatus ? finalBalanceRaw : "",
    allowed: FINAL_BALANCE_STATES,
    classify: classifyFinalBalanceDisplayStatus
  });

  return { lifecycle, booking, deposit, finalBalance };
}

export function buildCommercialPriorityContext(quote) {
  const evidencePresence = readCommercialEvidencePresence(quote);
  const facts = statusFacts(quote);
  const proposal = evidencePresence.quote ? buildProposalReadiness(quote) : null;
  const rawTotal = quote?.totals?.total;
  const total = hasWorkspaceNumber(rawTotal) ? Number(rawTotal) : null;
  const totalAvailable = total !== null && total >= 0;
  const recommendedGapCount = proposal?.recommendedGaps.length || 0;

  return deepFreeze({
    value: {
      label: "Saved quote total",
      available: totalAvailable,
      amount: totalAvailable ? total : null,
      display: totalAvailable ? formatWorkspaceMoney(total) : "Value unavailable",
      reason: totalAvailable
        ? "Recorded on this saved quote; this view does not reprice, forecast, or validate margin."
        : "No valid saved quote total is available; missing value is not treated as zero."
    },
    position: {
      lifecycle: facts.lifecycle,
      proposal: proposal ? {
        id: "proposal-readiness",
        label: "Proposal",
        available: true,
        family: proposal.complete ? STATUS_FAMILY.CONFIRMED : STATUS_FAMILY.ACTION,
        value: proposal.complete ? "Proposal ready" : "Proposal needs review",
        complete: proposal.complete,
        gapCount: proposal.gaps.length,
        recommendedGapCount,
        completenessPercent: proposal.score,
        criteriaCount: proposal.requiredCriteria.length,
        recordedCriteriaCount: proposal.requiredCriteria.filter((criterion) => criterion.passed).length,
        reason: proposal.complete
          ? recommendedGapCount > 0
            ? `All required proposal fields are recorded; ${recommendedGapCount} recommended contact ${recommendedGapCount === 1 ? "detail remains" : "details remain"}.`
            : "All required proposal fields are recorded."
          : `${proposal.gaps.length} required proposal ${proposal.gaps.length === 1 ? "field needs" : "fields need"} review.`
      } : {
        ...unavailableFact(
          "proposal-readiness",
          "Proposal",
          "No saved quote identity is available, so proposal readiness is not asserted."
        ),
        complete: false,
        gapCount: 0,
        recommendedGapCount: 0,
        completenessPercent: null,
        criteriaCount: 0,
        recordedCriteriaCount: 0
      },
      booking: facts.booking,
      deposit: facts.deposit,
      finalBalance: facts.finalBalance
    },
    event: {
      date: formatWorkspaceDate(quote?.event?.date || quote?.date, {
        emptyLabel: "Event date not set"
      }),
      time: formatWorkspaceText(quote?.event?.time || quote?.time, {
        emptyLabel: "Time not set"
      }),
      venue: formatWorkspaceText(quote?.event?.venue || quote?.venue, {
        emptyLabel: "Venue not set"
      })
    }
  });
}

function identityFor(quote, quoteId) {
  return {
    quoteId,
    quoteNumber: formatWorkspaceText(quote?.quoteNumber, {
      emptyLabel: "Quote number not recorded"
    }),
    eventName: formatWorkspaceText(quote?.event?.name || quote?.eventName, {
      emptyLabel: "Event name not recorded"
    }),
    customerName: formatWorkspaceText(
      quote?.customer?.name || quote?.customer?.email || quote?.customerNameKey,
      { emptyLabel: "Customer not recorded" }
    ),
    eventDate: formatWorkspaceDate(quote?.event?.date || quote?.date, {
      emptyLabel: "Event date not set"
    }),
    venue: formatWorkspaceText(quote?.event?.venue || quote?.venue, {
      emptyLabel: "Venue not set"
    }),
    guests: formatWorkspaceInteger(quote?.event?.guests ?? quote?.guests, {
      emptyLabel: "Guest count not set"
    })
  };
}

function attentionLabel(item) {
  if (!item) return null;
  if (item.type === "change_request") {
    return {
      label: item.state === "invalid" ? "Review customer request" : "Review requested changes",
      reason: text(item.sourceMessage)
        || "A customer change request is recorded on this exact opportunity.",
      consequence: "The request remains unresolved, so the current proposal may no longer match what the customer asked for.",
      category: "customer_reply_or_approval",
      severity: item.state === "invalid" ? "warning" : "attention"
    };
  }
  if (item.type === "approval") {
    const count = Math.max(1, Array.isArray(item.pendingRequests) ? item.pendingRequests.length : 0);
    return {
      label: count === 1 ? "Review pending approval" : `Review ${count} pending approvals`,
      reason: "A role-gated approval request is waiting on this exact opportunity.",
      consequence: "The protected action cannot proceed until an authorized decision is recorded.",
      category: "authority_or_safety_blocker",
      severity: "warning"
    };
  }
  if (item.type === "follow_up") {
    return {
      label: item.state === "overdue" ? "Resolve overdue follow-up" : "Review today's follow-up",
      reason: item.dateISO
        ? `The tracked follow-up date is ${formatWorkspaceDate(item.dateISO)}.`
        : "A tracked follow-up is due on this exact opportunity.",
      consequence: "Until reviewed, this customer follow-up remains an unresolved commercial obligation.",
      category: "deadline",
      severity: item.state === "overdue" ? "warning" : "attention"
    };
  }
  const blocked = ["blocked_source", "blocked_configuration"].includes(item.state);
  return {
    label: blocked ? "Review closeout boundary" : "Review post-event closeout",
    reason: blocked
      ? "The bounded closeout record cannot advance until its source or configuration boundary is reviewed."
      : "A bounded post-event closeout is due on this exact opportunity.",
    consequence: blocked
      ? "Closeout remains blocked until the named source or configuration boundary is resolved."
      : "The internal post-event record remains incomplete until this closeout is reviewed.",
    category: blocked ? "authority_or_safety_blocker" : "deadline",
    severity: blocked || item.state === "overdue" ? "warning" : "attention"
  };
}

function workflowEvidence(quote, { nowISO, todayISO }) {
  const explicitClockAvailable = Boolean(safeIso(nowISO) || /^\d{4}-\d{2}-\d{2}$/.test(text(todayISO)));
  if (!explicitClockAvailable) {
    return {
      evaluated: false,
      item: null,
      reason: "Workflow timing was not evaluated because the caller did not supply an explicit clock."
    };
  }
  const summary = buildWorkflowAttentionSummary([quote], { nowISO, todayISO });
  return {
    evaluated: true,
    item: summary.items[0] || null,
    reason: summary.items.length
      ? "The highest-ranked item comes from the bounded Workflow projection on this quote record."
      : "No due Workflow item was found in the bounded quote record. This is not an event-completion claim."
  };
}

function customerMomentum(lifecycle) {
  if (!lifecycle.available) {
    return {
      state: "unavailable",
      summary: "Customer state is unavailable.",
      reason: "No recognized quote lifecycle evidence is recorded.",
      evidence: []
    };
  }
  if (["accepted", "booked"].includes(lifecycle.raw)) {
    return {
      state: "healthy",
      summary: `Recorded lifecycle: ${lifecycle.value}.`,
      evidence: [{ lifecycleStatus: lifecycle.raw }]
    };
  }
  if (["sent", "viewed"].includes(lifecycle.raw)) {
    return {
      state: "attention",
      summary: `Recorded lifecycle: ${lifecycle.value}.`,
      evidence: [{ lifecycleStatus: lifecycle.raw }]
    };
  }
  if (["declined", "expired"].includes(lifecycle.raw)) {
    return {
      state: "blocked",
      summary: `Recorded lifecycle: ${lifecycle.value}.`,
      evidence: [{ lifecycleStatus: lifecycle.raw }]
    };
  }
  return {
    state: "unavailable",
    summary: "Customer state is unavailable.",
    reason: `${lifecycle.value} does not establish customer delivery, review, or decision evidence.`,
    evidence: []
  };
}

function commercialMomentum(commercialPriority) {
  const hasRecordedTotal = commercialPriority.value.available;
  return {
    state: "unavailable",
    summary: hasRecordedTotal
      ? `A saved quoted total of ${commercialPriority.value.display} is recorded.`
      : "No valid saved quoted total is recorded.",
    reason: hasRecordedTotal
      ? "This saved total has not been checked against current pricing, complete costs, or margin."
      : "Pricing and margin still need an authoritative price and complete cost details.",
    evidence: hasRecordedTotal ? [{ savedTotalRecorded: true }] : []
  };
}

function operationalMomentum(workflow) {
  const item = workflow.item;
  if (item?.type === "post_event_closeout") {
    return {
      state: ["blocked_source", "blocked_configuration"].includes(item.state)
        ? "blocked"
        : "attention",
      summary: attentionLabel(item).label,
      evidence: [{ attentionType: item.type, attentionState: item.state }]
    };
  }
  return {
    state: "unavailable",
    summary: "Event planning evidence is unavailable.",
    reason: workflow.evaluated
      ? "No event-planning follow-up is due, but staffing, schedule, BEO, and event readiness are not confirmed here."
      : workflow.reason,
    evidence: []
  };
}

function queueSummary({ proposal, workflow, lifecycle }) {
  const item = workflow.item;
  if (item?.type === "change_request") {
    return {
      kind: "customer-request",
      text: item.state === "invalid"
        ? "Customer request needs review"
        : "Customer requested changes"
    };
  }
  if (item?.type === "approval") {
    const count = Math.max(1, Array.isArray(item.pendingRequests) ? item.pendingRequests.length : 0);
    return {
      kind: "approval",
      text: count === 1 ? "Approval is waiting" : `${count} approvals are waiting`
    };
  }
  if (item?.type === "follow_up") {
    return {
      kind: "follow-up",
      text: item.state === "overdue" ? "Follow-up is overdue" : "Follow-up is due today"
    };
  }
  if (item?.type === "post_event_closeout") {
    return {
      kind: "closeout",
      text: ["blocked_source", "blocked_configuration"].includes(item.state)
        ? "Closeout is blocked"
        : "Post-event closeout is due"
    };
  }
  if (!proposal.complete) {
    return {
      kind: "proposal",
      text: `${proposal.gapCount} proposal field${proposal.gapCount === 1 ? "" : "s"} need review`
    };
  }
  if (!workflow.evaluated) {
    return { kind: "boundary", text: "Next step needs review" };
  }
  if (!lifecycle.available) {
    return { kind: "lifecycle", text: "Lifecycle needs review" };
  }
  if (["sent", "viewed"].includes(lifecycle.raw)) {
    return { kind: "customer-decision", text: "Customer decision not recorded" };
  }
  if (lifecycle.raw === "declined") {
    return { kind: "closed", text: "Declined — no tracked follow-up" };
  }
  if (lifecycle.raw === "expired") {
    return { kind: "closed", text: "Expired — no tracked follow-up" };
  }
  if (lifecycle.raw === "deleted") {
    return { kind: "closed", text: "Deleted record" };
  }
  if (lifecycle.raw === "draft") {
    return { kind: "proposal", text: "Ready for proposal review" };
  }
  return { kind: "current", text: "No tracked follow-up due" };
}

function primaryIntent({ quoteId, identity, proposal, workflow, lifecycle, capabilities }) {
  const object = { id: quoteId, type: "opportunity", label: identity.eventName };
  const attention = attentionLabel(workflow.item);
  if (attention) {
    const workflowEnabled = capabilities.openWorkflow === true;
    const opportunityEnabled = capabilities.openOpportunity === true;
    const useWorkflow = workflowEnabled;
    const enabled = useWorkflow || opportunityEnabled;
    const actionId = useWorkflow
      ? `review-opportunity-workflow:${quoteId}:${getWorkflowAttentionFocusId(workflow.item)}`
      : `open-opportunity-context:${quoteId}`;
    return {
      id: actionId,
      label: useWorkflow ? attention.label : "Review opportunity context",
      category: attention.category,
      severity: attention.severity,
      object,
      reason: useWorkflow
        ? attention.reason
        : `${attention.reason} This task can’t open directly here, so the related opportunity will open instead.`,
      consequence: useWorkflow
        ? "The exact Workflow item opens for role-gated review; navigation changes no quote, customer, payment, or provider state."
        : "The exact opportunity opens without resolving the tracked Workflow item or changing any record.",
      purpose: useWorkflow ? "resolve" : "reveal_context",
      businessConsequence: attention.consequence,
      targetKind: useWorkflow ? "workflow" : "opportunity",
      targetId: useWorkflow ? getWorkflowAttentionFocusId(workflow.item) : quoteId,
      surfaceId: useWorkflow ? "workflow" : "living-opportunity",
      enabled,
      disabledReason: enabled
        ? null
        : "You can’t open this opportunity or its task from this view.",
      workflowTarget: {
        quoteId,
        attentionType: text(workflow.item.type),
        requestId: getWorkflowAttentionFocusId(workflow.item)
      }
    };
  }

  const enabled = capabilities.openOpportunity === true;
  const hasProposalGap = !proposal.complete;
  const lifecycleNeedsReview = ["declined", "expired"].includes(lifecycle.raw);
  const namedOpportunityLabel = identity.eventName === "Event name not recorded"
    ? lifecycleNeedsReview ? "Review opportunity" : "Open opportunity"
    : `${lifecycleNeedsReview ? "Review" : "Open"} ${identity.eventName}`;
  return {
    id: `${hasProposalGap ? "review-opportunity-proposal" : "open-opportunity"}:${quoteId}`,
    label: hasProposalGap ? "Review proposal details" : namedOpportunityLabel,
    category: hasProposalGap ? "proposal_gap" : "recommendation",
    severity: hasProposalGap ? "attention" : "info",
    object,
    reason: hasProposalGap
      ? `${proposal.gapCount} required proposal field${proposal.gapCount === 1 ? "" : "s"} need review.`
      : lifecycleNeedsReview
        ? `This opportunity is recorded as ${lifecycle.value.toLowerCase()}, and no tracked follow-up is due.`
      : "There isn’t a due follow-up or an unfinished proposal detail in this record.",
    consequence: "The exact opportunity opens for review. No quote, customer, payment, booking, or provider state changes through navigation.",
    businessConsequence: hasProposalGap
      ? "The proposal is not ready for customer review until the required details are resolved."
      : ["sent", "viewed"].includes(lifecycle.raw)
        ? "A customer decision is still outstanding; this record has no separate due follow-up."
        : lifecycleNeedsReview
          ? "This closed state has no tracked continuation, so any further pursuit requires a deliberate review."
          : "No due commercial obligation is recorded for this opportunity in the current bounded view.",
    purpose: hasProposalGap ? "resolve" : "reveal_context",
    targetKind: "opportunity",
    targetId: quoteId,
    surfaceId: "living-opportunity",
    enabled,
    disabledReason: enabled
      ? null
      : "You can’t open this opportunity from the current view.",
    workflowTarget: null
  };
}

function opportunityProjection(quote, options) {
  const quoteId = text(quote?.id || quote?.quoteId);
  const identity = identityFor(quote, quoteId);
  const commercialPriority = buildCommercialPriorityContext(quote);
  const facts = commercialPriority.position;
  const proposal = facts.proposal;
  const recommendedProposalGapCount = proposal.recommendedGapCount;
  const workflow = workflowEvidence(quote, options);
  const intent = primaryIntent({
    quoteId,
    identity,
    proposal,
    workflow,
    lifecycle: facts.lifecycle,
    capabilities: options.capabilities
  });
  const summary = queueSummary({ proposal, workflow, lifecycle: facts.lifecycle });
  const momentum = createOpportunityMomentum({
    domains: {
      proposal: {
        state: proposal.complete ? "healthy" : "attention",
        summary: proposal.reason,
        evidence: [{
          model: "proposal-readiness-v1",
          criteriaCount: proposal.criteriaCount,
          recordedCriteriaCount: proposal.recordedCriteriaCount,
          recommendedGapCount: recommendedProposalGapCount
        }],
        completenessPercent: proposal.completenessPercent
      },
      commercial: commercialMomentum(commercialPriority),
      customer: customerMomentum(facts.lifecycle),
      operational: operationalMomentum(workflow)
    },
    candidates: [{
      id: intent.id,
      label: intent.label,
      category: intent.category,
      severity: intent.severity,
      object: intent.object,
      reason: intent.reason,
      consequence: intent.consequence,
      dueAt: safeIso(workflow.item?.dateISO),
      ...(intent.enabled ? { resolutionActionId: intent.id } : {}),
      availability: intent.enabled
        ? "available"
        : { state: "unavailable", reason: intent.disabledReason }
    }],
    nextActionUnavailableReason: intent.disabledReason
      || "No exact role-safe opportunity action is available."
  });
  const primaryAction = createAmbientAction({
    id: intent.id,
    outcomeLabel: intent.label,
    purpose: intent.purpose,
    roles: [options.role],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: "route",
      targetId: intent.targetId,
      surfaceId: intent.surfaceId
    },
    receiptType: "none",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: intent.object,
      reason: intent.reason,
      consequence: intent.consequence,
      nextResolutionIds: [intent.targetKind === "workflow"
        ? "review-focused-workflow-outcome"
        : "review-opportunity-next-step"]
    },
    primary: true,
    enabled: intent.enabled,
    ...(!intent.enabled ? { disabledReason: intent.disabledReason } : {})
  });
  const requiresAttention = Boolean(workflow.item)
    || !facts.lifecycle.available
    || Object.values(momentum.domains).some(
      (domain) => ["attention", "blocked"].includes(domain.state)
    );
  const groupId = requiresAttention
    ? "needs-attention"
    : CLOSED_LIFECYCLE_STATES.has(facts.lifecycle.raw)
      ? "recent-closed"
      : "active-recent";

  return {
    quoteId,
    identity,
    statusFacts: {
      lifecycle: facts.lifecycle,
      booking: facts.booking,
      deposit: facts.deposit,
      finalBalance: facts.finalBalance
    },
    commercialPriority: deepFreeze({
      ...commercialPriority,
      significance: {
        label: summary.text,
        reason: intent.reason,
        consequence: intent.businessConsequence,
        timing: workflow.item?.dateISO
          ? formatWorkspaceDate(workflow.item.dateISO)
          : commercialPriority.event.date
      },
      nextActionId: primaryAction.id
    }),
    momentum,
    workflow: {
      evaluated: workflow.evaluated,
      attentionType: text(workflow.item?.type) || null,
      attentionState: text(workflow.item?.state) || null,
      priority: Number.isFinite(workflow.item?.priority) ? workflow.item.priority : null,
      dueAtISO: safeIso(workflow.item?.dateISO),
      target: intent.workflowTarget,
      reason: workflow.reason
    },
    queueSummary: summary,
    primaryAction,
    requiresAttention,
    groupId,
    ordering: {
      eventAtISO: safeIso(quote?.event?.date || quote?.date),
      updatedAtISO: safeIso(quote?.updatedAtISO || quote?.updatedAt || quote?.createdAtISO || quote?.createdAt),
      stableKey: text(quote?.quoteNumber || quoteId).toLowerCase()
    }
  };
}

function compareOpportunityRows(left, right, actionRankById) {
  const groupDelta = OPPORTUNITY_GROUP_PRIORITY[left.groupId]
    - OPPORTUNITY_GROUP_PRIORITY[right.groupId];
  if (groupDelta !== 0) return groupDelta;

  if (left.groupId === "needs-attention") {
    const workflowDelta = (left.workflow.priority ?? Number.POSITIVE_INFINITY)
      - (right.workflow.priority ?? Number.POSITIVE_INFINITY);
    if (workflowDelta !== 0) return workflowDelta;
    const actionDelta = (actionRankById.get(left.primaryAction.id) ?? Number.POSITIVE_INFINITY)
      - (actionRankById.get(right.primaryAction.id) ?? Number.POSITIVE_INFINITY);
    if (actionDelta !== 0) return actionDelta;
  }

  if (left.groupId === "recent-closed") {
    const leftUpdated = left.ordering.updatedAtISO
      ? Date.parse(left.ordering.updatedAtISO)
      : Number.NEGATIVE_INFINITY;
    const rightUpdated = right.ordering.updatedAtISO
      ? Date.parse(right.ordering.updatedAtISO)
      : Number.NEGATIVE_INFINITY;
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
  } else {
    const leftEvent = left.ordering.eventAtISO
      ? Date.parse(left.ordering.eventAtISO)
      : Number.POSITIVE_INFINITY;
    const rightEvent = right.ordering.eventAtISO
      ? Date.parse(right.ordering.eventAtISO)
      : Number.POSITIVE_INFINITY;
    if (leftEvent !== rightEvent) return leftEvent - rightEvent;
  }

  return left.ordering.stableKey.localeCompare(right.ordering.stableKey)
    || left.quoteId.localeCompare(right.quoteId);
}

function sourceBoundary(source) {
  if (source === "local") {
    return "These records are saved in this browser. Booking and payment labels show what is stored here; they do not confirm payment or outside-service completion.";
  }
  if (source === "firebase") {
    return "These quote records came from the staff workspace. Delivery, payment, and event completion still need their own receipts.";
  }
  if (source === "mixed") {
    return "These records come from more than one source. Confirm payment and event status before relying on either one.";
  }
  return "We could not confirm where these records came from, so they do not strengthen any lifecycle, payment, booking, or event-status claim.";
}

function normalizeReadBoundary(value, sourceOverride) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const source = normalizedText(sourceOverride || input.source);
  const loadedAtISO = safeIso(input.loadedAtISO || input.loadedAt);
  const loading = input.loading === true;
  const complete = input.complete === true;
  const partial = input.partial === true;
  const stale = input.stale === true;
  const truncated = input.truncated === true;
  const boundsKnown = input.truncationKnown === true;
  const error = text(input.error);
  const sourceKnown = ["firebase", "local", "mixed"].includes(source);
  const currentComplete = complete
    && sourceKnown
    && boundsKnown
    && !loading
    && !partial
    && !stale
    && !truncated
    && !error;
  const messages = [];
  if (loading) messages.push(complete ? "A refresh is in progress; the records already here remain visible." : "Your opportunities are still loading.");
  if (error) messages.push(complete ? "The latest refresh failed; the records already here remain visible." : "We couldn’t finish loading opportunities.");
  if (partial) messages.push("Only part of the opportunity list loaded.");
  if (stale) messages.push("These records may be out of date.");
  if (truncated) messages.push("This view reached its record limit.");
  if (!boundsKnown) messages.push("We do not know whether more records exist beyond this view.");
  if (!complete) messages.push("The workspace has not confirmed that all opportunity records loaded.");
  if (!loadedAtISO) messages.push("No reliable last-checked time is available.");
  if (!sourceKnown) messages.push("We could not confirm where these records came from.");

  return {
    source: source || "unknown",
    sourceLabel: formatWorkspaceSource(source),
    sourceBoundary: sourceBoundary(source),
    sourceKnown,
    loadedAtISO,
    loading,
    complete,
    partial,
    stale,
    truncated,
    boundsKnown,
    error: error || null,
    currentComplete,
    messages
  };
}

/**
 * Pure projection over caller-owned, already tenant-scoped quote records.
 * This function performs no reads, writes, authorization, or provider work.
 */
export function buildAmbientOpportunityStream({
  quotes = [],
  source = "",
  readBoundary = {},
  currentUserRole = "staff",
  capabilities = {},
  nowISO = "",
  todayISO = ""
} = {}) {
  const boundary = normalizeReadBoundary(readBoundary, source);
  const normalizedCapabilities = {
    openOpportunity: capabilities.openOpportunity === true,
    openWorkflow: capabilities.openWorkflow === true,
    startOpportunity: capabilities.startOpportunity === true,
    refresh: capabilities.refresh === true
  };
  const role = normalizedRole(currentUserRole);
  const seenQuoteIds = new Set();
  const omittedRecords = [];
  const rows = [];

  (Array.isArray(quotes) ? quotes : []).forEach((quote, index) => {
    const quoteId = text(quote?.id || quote?.quoteId);
    if (!quoteId) {
      omittedRecords.push({ index, reason: "Missing exact quote identity." });
      return;
    }
    if (seenQuoteIds.has(quoteId)) {
      omittedRecords.push({ index, quoteId, reason: "Duplicate quote identity." });
      return;
    }
    seenQuoteIds.add(quoteId);
    rows.push(opportunityProjection(quote, {
      capabilities: normalizedCapabilities,
      role,
      nowISO,
      todayISO
    }));
  });

  const rankedActions = rankAmbientNextActions(
    rows.flatMap((row) => row.momentum.nextAction ? [row.momentum.nextAction] : [])
  );
  const actionRankById = new Map(rankedActions.map((action) => [action.id, action.rank]));
  rows.sort((left, right) => compareOpportunityRows(left, right, actionRankById));
  const groups = OPPORTUNITY_GROUPS
    .map((group) => ({
      ...group,
      rows: rows.filter((row) => row.groupId === group.id)
    }))
    .filter((group) => group.rows.length > 0);

  const readTrustworthy = boundary.currentComplete && omittedRecords.length === 0;
  const workflowEvaluationComplete = rows.every((row) => row.workflow.evaluated);
  const caughtUp = {
    eligible: readTrustworthy
      && Boolean(boundary.loadedAtISO)
      && workflowEvaluationComplete
      && rows.length > 0
      && rows.every((row) => !row.requiresAttention),
    reason: ""
  };
  caughtUp.reason = caughtUp.eligible
    ? "No bounded Workflow item, proposal-completeness gap, declined state, or expired state needs attention in this current completed read. This is not event readiness."
    : !readTrustworthy
      ? "Caught-up language is withheld because the read boundary is incomplete or a record lacked exact identity."
      : !boundary.loadedAtISO
        ? "Caught-up language is withheld because no trustworthy read-completion time is recorded."
        : !workflowEvaluationComplete
          ? "Caught-up language is withheld because Workflow timing was not evaluated with an explicit clock."
          : rows.length === 0
            ? "No opportunity records are present; use the contextual empty state instead."
            : "At least one bounded opportunity signal needs attention.";

  let state = "ready";
  if (rows.length === 0 && boundary.loading && !boundary.complete) state = "loading";
  else if (rows.length === 0 && readTrustworthy) state = "empty";
  else if (rows.length === 0) state = "incomplete";
  else if (!readTrustworthy || !workflowEvaluationComplete) state = "bounded";

  return deepFreeze({
    modelId: AMBIENT_OPPORTUNITY_STREAM_MODEL,
    surfaceContract: AMBIENT_OPPORTUNITIES_SURFACE_CONTRACT,
    state,
    rows,
    groups,
    rowCount: rows.length,
    omittedRecords,
    readBoundary: boundary,
    caughtUp,
    capabilities: normalizedCapabilities,
    evidenceBoundary: "Caller-supplied, already tenant-scoped quote records only. This projection performs no data read, mutation, authorization, provider action, or cross-tenant lookup."
  });
}
