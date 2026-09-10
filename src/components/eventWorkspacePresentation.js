import { classifyQuoteStatus } from "../lib/statusSemantics";
import { buildEventRunOfShowItem } from "../lib/eventRunOfShow";
import { buildCommercialPriorityContext } from "../lib/ambientOpportunityStream";
import {
  buildProposalReadiness,
  buildWorkflowAttentionSummary,
  getWorkflowAttentionFocusId
} from "../lib/quoteWorkflow";
import {
  formatWorkspaceDate,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceSource,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";

const LIFECYCLE_MILESTONES = Object.freeze([
  Object.freeze({ id: "draft", label: "Draft", fields: ["draftAtISO", "createdAtISO"] }),
  Object.freeze({ id: "sent", label: "Sent", fields: ["sentAtISO"] }),
  Object.freeze({ id: "accepted", label: "Accepted", fields: ["acceptedAtISO"] }),
  Object.freeze({ id: "booked", label: "Booked", fields: ["bookedAtISO", "contractConvertedAtISO"] })
]);

const STATUS_RANK = Object.freeze({
  draft: 0,
  sent: 1,
  viewed: 1,
  accepted: 2,
  booked: 3
});

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function itemName(value) {
  if (typeof value === "string") return text(value);
  return text(value?.name || value?.label || value?.id);
}

function namedItems(primary, fallback) {
  const preferred = list(primary).map(itemName).filter(Boolean);
  if (preferred.length) return preferred;
  return list(fallback).map(itemName).filter(Boolean);
}

function selectedQuantity(items, quantities = {}) {
  return list(items).reduce((total, item) => {
    const id = typeof item === "string" ? item : item?.id;
    const quantity = Number(quantities?.[id]);
    return total + (Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1);
  }, 0);
}

function formatEventTime(value) {
  const raw = text(value);
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return raw || "Time not set";
  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return raw;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${match[2]} ${suffix}`;
}

function firstTimestamp(quote, milestone) {
  const lifecycle = quote?.lifecycle || {};
  const booking = quote?.booking || {};
  for (const field of milestone.fields) {
    const value = text(lifecycle[field] || booking[field] || quote?.[field]);
    if (value) return value;
  }
  return "";
}

function buildLifecycle(quote) {
  const normalizedStatus = text(quote?.status || "draft").toLowerCase();
  const currentRank = STATUS_RANK[normalizedStatus];
  return LIFECYCLE_MILESTONES.map((milestone, index) => {
    const timestamp = firstTimestamp(quote, milestone);
    const reached = Boolean(timestamp) || (Number.isInteger(currentRank) && currentRank > index);
    const current = Number.isInteger(currentRank) && currentRank === index;
    return {
      ...milestone,
      timestamp,
      dateLabel: timestamp
        ? formatWorkspaceDate(timestamp, { emptyLabel: "Date not recorded" })
        : current
          ? "Current"
          : reached
            ? "Date not recorded"
            : "Pending",
      state: current ? "current" : reached ? "complete" : "upcoming"
    };
  });
}

function attentionPresentation(quote, { now, todayISO } = {}) {
  const summary = buildWorkflowAttentionSummary([quote], { now, todayISO });
  const item = summary.items[0] || null;
  if (!item) {
    return {
      state: "clear",
      label: "No tracked quote attention",
      title: "No tracked quote attention",
      detail: "No due Workflow item is recorded for this quote in the bounded history read. This is not an event-readiness or completion claim.",
      reasonCode: "no_tracked_workflow_attention",
      target: null
    };
  }

  const target = {
    quoteId: text(item.quoteId || quote?.id),
    attentionType: text(item.type),
    // The route calls this requestId for compatibility. For projected
    // follow-up/closeout rows it carries the canonical attention-item id,
    // never a fabricated request or mutation credential.
    requestId: getWorkflowAttentionFocusId(item)
  };

  if (item.type === "change_request") {
    return {
      state: "attention",
      label: "Needs attention",
      title: item.state === "invalid" ? "Customer request needs review" : "Customer requested changes",
      detail: text(item.sourceMessage) || "Review the exact customer request in Workflow before changing the quote.",
      reasonCode: item.state === "invalid"
        ? "customer_change_request_invalid"
        : "customer_change_request_requires_review",
      target
    };
  }
  if (item.type === "follow_up") {
    const overdue = item.state === "overdue";
    return {
      state: "attention",
      label: "Needs attention",
      title: overdue ? "Follow-up overdue" : "Follow-up due today",
      detail: item.dateISO
        ? `The tracked follow-up date is ${formatWorkspaceDate(item.dateISO)}.`
        : "Review the tracked follow-up in Workflow.",
      reasonCode: overdue ? "follow_up_overdue" : "follow_up_due_today",
      target
    };
  }
  if (item.type === "approval") {
    const count = Math.max(1, item.pendingRequests?.length || 0);
    return {
      state: "attention",
      label: "Needs attention",
      title: count === 1 ? "Approval waiting" : `${count} approvals waiting`,
      detail: "Review the exact pending request and its authority boundary in Workflow.",
      reasonCode: "approval_request_pending",
      target
    };
  }
  return {
    state: "attention",
    label: "Needs attention",
    title: item.state === "blocked_source"
      ? "Closeout source needs review"
      : item.state === "blocked_configuration"
        ? "Closeout configuration needs review"
        : item.state === "overdue"
          ? "Post-event closeout overdue"
          : "Post-event closeout due",
    detail: "Open the bounded closeout record in Workflow. This does not imply event completion or customer contact.",
    reasonCode: item.state === "blocked_source"
      ? "closeout_source_blocked"
      : item.state === "blocked_configuration"
        ? "closeout_configuration_blocked"
        : item.state === "overdue"
          ? "closeout_overdue"
          : "closeout_due",
    target
  };
}

function reasonCode(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const EXECUTION_FACT_LABELS = Object.freeze({
  "event.date": "Event date",
  "event.time": "Event start time",
  "event.hours": "Event duration",
  "event.venue": "Venue",
  "event.venueAddress": "Venue address",
  "event.guests": "Guest count",
  "staffing.staffLead": "Staff lead",
  "staffing.servers": "Server count",
  "staffing.chefs": "Chef count",
  "staffing.bartenders": "Bartender count"
});

function calendarDateAt(now, timeZone) {
  const current = now instanceof Date ? now : new Date(now || Date.now());
  if (Number.isNaN(current.getTime()) || !text(timeZone)) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(current);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    return "";
  }
}

function daysUntilEvent(date, todayISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text(date))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text(todayISO))) return null;
  const eventDay = new Date(`${date}T00:00:00.000Z`);
  const currentDay = new Date(`${todayISO}T00:00:00.000Z`);
  return Math.round((eventDay.getTime() - currentDay.getTime()) / 86_400_000);
}

function eventTimingLabel(event, { now, todayISO, tenantTimeZone } = {}) {
  const tenantToday = text(todayISO) || calendarDateAt(now, tenantTimeZone);
  const days = daysUntilEvent(event?.date, tenantToday);
  if (days === null) return text(event?.date) ? "Relative timing unavailable" : "Event date not set";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `${days} days away`;
  if (days === -1) return "1 day ago";
  return `${Math.abs(days)} days ago`;
}

function commercialEvidenceSummary(quote) {
  const position = buildCommercialPriorityContext(quote).position;
  const label = (fact, noun) => fact.available
    ? text(fact.value)
    : `${noun} status not recorded`;
  return {
    deposit: label(position.deposit, "Deposit"),
    finalBalance: position.finalBalance.available
      ? `Final ${text(position.finalBalance.value).toLowerCase()}`
      : "Final balance status not recorded",
    booking: position.booking.available
      ? text(position.booking.value)
      : quote?.status === "booked" ? "Booked lifecycle recorded" : "Booking confirmation not recorded",
    boundary: "Payment and booking labels report recorded evidence only; they do not infer provider settlement or delivery."
  };
}

function recordedExecutionEvidence(runOfShow, quote) {
  const evidence = [];
  const accepted = runOfShow?.milestones?.proposalAcceptance;
  const booked = runOfShow?.milestones?.booking;
  if (accepted?.state === "accepted") {
    evidence.push({
      id: "proposal-accepted",
      atISO: accepted.atISO,
      action: "Proposal accepted",
      transition: "Commercial proposal → Accepted commitment",
      actor: "Actor not recorded in this bounded read",
      channel: accepted.evidence || "Accepted quote state",
      revision: text(quote?.acceptanceReceipt?.quoteRevisionId)
        ? `Accepted revision ${text(quote.acceptanceReceipt.quoteRevisionId)}`
        : "Acceptance revision not established"
    });
  }
  if (booked?.state === "booked") {
    evidence.push({
      id: "event-booked",
      atISO: booked.atISO,
      action: "Event booked",
      transition: "Accepted commitment → Booked obligation",
      actor: "Actor not recorded in this bounded read",
      channel: booked.evidence || "Booked quote state",
      revision: booked.contractNumber ? `Contract ${booked.contractNumber}` : "Contract number not recorded"
    });
  }
  for (const group of runOfShow?.productionChecklist?.groups || []) {
    for (const item of group.items || []) {
      if (item.state !== "completed") continue;
      evidence.push({
        id: `checklist-${item.id}`,
        atISO: item.completedAtISO,
        action: item.label,
        transition: "Checklist item → Completed",
        actor: item.completedByEmail || "Actor not recorded",
        channel: `${group.group} checklist`,
        revision: "Operational checklist evidence"
      });
    }
  }
  return evidence.sort((left, right) => {
    if (left.atISO && right.atISO) return left.atISO.localeCompare(right.atISO);
    if (left.atISO) return -1;
    if (right.atISO) return 1;
    return left.id.localeCompare(right.id);
  });
}

export function buildCommitmentExecutionPresentation(quote = {}, {
  source = "",
  now,
  todayISO,
  tenantTimeZone,
  scheduleAvailable = true
} = {}) {
  const workspace = buildEventWorkspacePresentation(quote, { source, now });
  const runOfShow = buildEventRunOfShowItem(quote);
  if (!runOfShow) return null;
  const evidence = recordedExecutionEvidence(runOfShow, quote);
  const missingFacts = runOfShow.unknownFields
    .filter((field) => EXECUTION_FACT_LABELS[field])
    .map((field) => ({ id: field, label: EXECUTION_FACT_LABELS[field] }));
  const checklist = runOfShow.productionChecklist;
  const timingUnknownCount = runOfShow.timeline.filter((item) => item.timingState !== "known").length;
  const attention = [];
  if (workspace.intelligence.needsYou.target) {
    attention.push({
      id: "workflow",
      domain: "Commercial follow-through",
      title: workspace.intelligence.needsYou.title,
      detail: workspace.intelligence.needsYou.detail,
      action: { kind: "workflow", label: "Open in Workflow", target: workspace.intelligence.needsYou.target }
    });
  }
  if (missingFacts.length) {
    attention.push({
      id: "missing-plan-facts",
      domain: "Event plan",
      title: `${missingFacts.length} execution ${missingFacts.length === 1 ? "fact needs" : "facts need"} confirmation`,
      detail: missingFacts.map((item) => item.label).join(", "),
      action: { kind: "quote", label: "Open quote record" }
    });
  }
  if (checklist.state !== "complete") {
    attention.push({
      id: "production-checklist",
      domain: "Production",
      title: `${checklist.completedCount} of ${checklist.totalCount} checklist items recorded complete`,
      detail: checklist.unknownCount
        ? `${checklist.unknownCount} items have no recorded completion state.`
        : `${checklist.notCompletedCount} items are recorded not complete.`,
      action: { kind: "schedule", label: "Open Schedule" }
    });
  }
  const scheduleAction = scheduleAvailable
    ? { kind: "schedule", label: "Open exact event in Schedule", quoteId: text(quote.id) }
    : { kind: "quote", label: "Open quote record" };
  const checklistAttention = attention.find((item) => item.id === "production-checklist");
  if (checklistAttention) checklistAttention.action = scheduleAction;
  const nextAction = attention[0]?.action || scheduleAction;
  const staffingValues = [runOfShow.staffing.servers, runOfShow.staffing.chefs, runOfShow.staffing.bartenders];
  const recordedStaffingValues = staffingValues.filter((value) => value !== null);
  const staffingSummary = recordedStaffingValues.length === 0
    ? "Quoted staff counts not recorded"
    : recordedStaffingValues.length < staffingValues.length
      ? `${recordedStaffingValues.reduce((sum, value) => sum + value, 0)} quoted staff across ${recordedStaffingValues.length} of 3 recorded roles`
      : `${recordedStaffingValues.reduce((sum, value) => sum + value, 0)} quoted staff`;
  const acceptance = quote?.acceptanceReceipt && typeof quote.acceptanceReceipt === "object"
    ? quote.acceptanceReceipt
    : {};
  const acceptedRevisionId = text(acceptance.quoteRevisionId);
  return {
    workspace,
    runOfShow,
    timingLabel: eventTimingLabel(runOfShow.event, { now, todayISO, tenantTimeZone }),
    commercialEvidence: commercialEvidenceSummary(quote),
    commitment: {
      revision: Number(quote.latestVersionNumber || quote.versionMeta?.versionNumber) > 0
        ? `Version ${Number(quote.latestVersionNumber || quote.versionMeta?.versionNumber)}`
        : text(quote.activeVersionId || quote.versionMeta?.versionId) || "Revision identity not recorded",
      duration: runOfShow.event.hours === null ? "Duration not recorded" : `${runOfShow.event.hours} hours`,
      address: runOfShow.event.venueAddress || "Venue address not recorded",
      package: formatWorkspaceText(quote?.selection?.packageName || quote?.selection?.packageId, { emptyLabel: "Package not recorded" }),
      serviceStyle: formatWorkspaceText(runOfShow.event.style, { emptyLabel: "Service style not recorded" }),
      acceptance: text(acceptance.receiptId)
        ? acceptedRevisionId
          ? `Acceptance receipt for revision ${acceptedRevisionId}`
          : "Acceptance receipt recorded; accepted revision not established"
        : "Acceptance receipt not recorded"
    },
    staffingSummary,
    dependencyEvidence: {
      state: "not_read",
      summary: "Dependency invalidation not read here",
      detail: "Open commercial truth for the governed dependency graph; this planning projection does not infer a healthy state from absence."
    },
    missingFacts,
    timingUnknownCount,
    attention,
    nextAction,
    evidence,
    actuals: {
      state: "unavailable",
      title: "Live actuals are not recorded",
      detail: "Current phase, staff check-ins, issue timing, and plan-versus-actual measures require a server-owned live event session. QuotePilot does not infer them from the plan."
    },
    replay: {
      state: "unavailable",
      title: "Execution replay is not established",
      detail: evidence.length
        ? "The current record contains supporting milestones and checklist timestamps, but they are not an immutable event-session ledger and are not presented as an execution replay."
        : "The bounded record contains no timestamped supporting evidence. QuotePilot will not manufacture an event history from the plan."
    },
    proofBoundary: runOfShow.operationalReadiness.reason
  };
}

export function deriveEventIntelligence(quote = {}, {
  source = "",
  now,
  todayISO
} = {}) {
  const attention = attentionPresentation(quote, { now, todayISO });
  const proposal = buildProposalReadiness(quote);
  const readinessReasonCodes = proposal.gaps.length
    ? proposal.gaps.map((gap) => `proposal_missing_${reasonCode(gap.id)}`)
    : ["proposal_required_fields_recorded"];
  const attentionType = reasonCode(attention.target?.attentionType);
  const attentionReasonCode = reasonCode(attention.reasonCode)
    || `workflow_${attentionType || "attention"}_requires_review`;

  return {
    condition: {
      state: attention.target ? "attention" : "observed",
      title: attention.title,
      detail: attention.detail,
      reasonCodes: attention.target
        ? [attentionReasonCode]
        : ["no_tracked_workflow_attention"]
    },
    readiness: {
      state: proposal.status.id,
      label: "Proposal readiness",
      scopeLabel: "Proposal completeness only",
      score: proposal.score,
      statusLabel: proposal.complete ? "Required fields recorded" : proposal.status.label,
      detail: proposal.complete
        ? proposal.recommendedGaps.length > 0
          ? `All required proposal fields are recorded; ${proposal.recommendedGaps.length} recommended contact ${proposal.recommendedGaps.length === 1 ? "detail remains" : "details remain"}. This is not operational event readiness.`
          : "All required proposal fields in the existing readiness model are recorded. This is not operational event readiness."
        : `${proposal.gaps.length} required proposal field${proposal.gaps.length === 1 ? "" : "s"} need review. This is not operational event readiness.`,
      gaps: proposal.gaps.map((gap) => ({ id: gap.id, label: gap.label, points: gap.points })),
      reasonCodes: readinessReasonCodes,
      evidence: {
        model: "proposal-readiness-v1",
        criteriaCount: proposal.requiredCriteria.length,
        recordedCriteriaCount: proposal.requiredCriteria.filter((item) => item.passed).length,
        recommendedGapCount: proposal.recommendedGaps.length
      }
    },
    flexibility: {
      state: "unavailable",
      label: "Flexibility",
      score: null,
      statusLabel: "Unavailable",
      detail: "QuotePilot has no declared event-wide change-window authority for this record, so remaining room to change is not estimated.",
      reasonCodes: ["event_change_window_contract_absent"],
      evidence: { model: null, available: false }
    },
    needsYou: attention.target
      ? {
          state: "attention",
          title: attention.title,
          detail: attention.detail,
          actionLabel: "Open in Workflow",
          target: attention.target,
          reasonCodes: [`${attentionReasonCode}_highest_priority`]
        }
      : {
          state: "none_tracked",
          title: "No tracked operator decision",
          detail: "The bounded Workflow read contains no current item for this quote. This does not prove that no operational decision exists.",
          actionLabel: "",
          target: null,
          reasonCodes: ["no_tracked_operator_decision"]
        },
    alignment: {
      state: "unavailable",
      label: "Alignment",
      score: null,
      statusLabel: "Unavailable",
      detail: "Revision, dependency, and BEO evidence remain in separate governed reads; no combined transaction-integrity projection is available here.",
      reasonCodes: ["combined_transaction_integrity_projection_absent"],
      evidence: { model: null, available: false }
    },
    evidence: {
      source: formatWorkspaceSource(source),
      bounds: "One selected quote plus its bounded Workflow projection",
      reasonCodes: [
        ...(attention.target
          ? [attentionReasonCode]
          : ["no_tracked_workflow_attention"]),
        ...readinessReasonCodes,
        "event_change_window_contract_absent",
        "combined_transaction_integrity_projection_absent"
      ]
    }
  };
}

export function buildEventWorkspacePresentation(quote = {}, {
  source = "",
  ordinaryEditAllowed = false,
  now,
  todayISO
} = {}) {
  const event = quote?.event || {};
  const customer = quote?.customer || {};
  const selection = quote?.selection || {};
  const menuNames = namedItems(selection.menuItemNames, selection.menuItemDetails || selection.menuItems);
  const addonNames = namedItems(selection.addonNames, selection.addonDetails || selection.addons);
  const rentalNames = namedItems(selection.rentalNames, selection.rentalDetails || selection.rentals);
  const addonCount = selectedQuantity(selection.addons, selection.addonQuantities);
  const rentalCount = selectedQuantity(selection.rentals, selection.rentalQuantities);
  const staffingCount = [event.servers, event.chefs, event.bartenders]
    .reduce((total, value) => {
      const count = Number(value);
      return total + (Number.isFinite(count) && count > 0 ? Math.round(count) : 0);
    }, 0);
  const status = classifyQuoteStatus(quote?.status || "draft");
  const intelligence = deriveEventIntelligence(quote, { source, now, todayISO });
  const attention = {
    state: intelligence.condition.state === "attention" ? "attention" : "clear",
    label: intelligence.condition.state === "attention" ? "Needs attention" : "No tracked quote attention",
    title: intelligence.condition.title,
    detail: intelligence.condition.detail,
    target: intelligence.needsYou.target
  };
  const nextAction = attention.target
    ? {
        kind: "workflow",
        label: "Open in Workflow",
        title: attention.title,
        detail: attention.detail,
        target: attention.target
      }
    : ordinaryEditAllowed
      ? {
          kind: "edit",
          label: "Edit quote",
          title: "Review or edit this quote",
          detail: "Ordinary editing is available for this role and quote lifecycle. Saving remains intentional and versioned.",
          target: null
        }
      : {
          kind: "administration",
          label: "More quote actions",
          title: "Review quote administration",
          detail: "Use the existing Quotes surface for role-gated provider, payment, booking, portal, and contract actions.",
          target: null
        };

  const packageName = formatWorkspaceText(selection.packageName || selection.packageId, {
    emptyLabel: "Package not recorded"
  });
  const serviceStyle = formatWorkspaceText(event.style, { emptyLabel: "Service style not recorded" });
  const statusId = text(quote?.status || "draft").toLowerCase();
  const governedRevisionRequired = ["accepted", "booked"].includes(statusId);

  return {
    quoteId: text(quote?.id || quote?.quoteId),
    quoteNumber: formatWorkspaceText(quote?.quoteNumber, { emptyLabel: "Quote number pending" }),
    eventName: formatWorkspaceText(event.name, { emptyLabel: "Event name not recorded" }),
    customerId: text(quote?.customerId),
    customerName: formatWorkspaceText(customer.name || customer.email, { emptyLabel: "Customer not recorded" }),
    customerOrganization: text(customer.organization),
    eventDate: formatWorkspaceDate(event.date, { emptyLabel: "Event date not set" }),
    eventTime: formatEventTime(event.time),
    venue: formatWorkspaceText(event.venue, { emptyLabel: "Venue not recorded" }),
    guests: formatWorkspaceInteger(event.guests, { emptyLabel: "Guest count not set" }),
    total: formatWorkspaceMoney(quote?.totals?.total, { emptyLabel: "Quoted total not recorded" }),
    status,
    sourceLabel: formatWorkspaceSource(source),
    intelligence,
    attention,
    nextAction,
    ordinaryEditAllowed,
    editBoundary: governedRevisionRequired
      ? "Accepted or booked scope requires the governed change path; ordinary editing is not presented here."
      : ordinaryEditAllowed
        ? "Saving remains an intentional versioned quote action."
        : "Your role or the current quote/delivery state does not allow ordinary editing.",
    context: {
      schedule: {
        title: "Schedule",
        detail: `${formatWorkspaceDate(event.date, { emptyLabel: "Date not set" })} · ${formatEventTime(event.time)}`
      },
      staffing: {
        title: "Staffing",
        detail: staffingCount > 0 ? `${staffingCount} quoted staff` : "No quoted staff count"
      },
      rentals: {
        title: "Rentals & Equipment",
        detail: rentalCount > 0
          ? `${rentalNames.length || list(selection.rentals).length} line item${(rentalNames.length || list(selection.rentals).length) === 1 ? "" : "s"} · ${rentalCount} quoted unit${rentalCount === 1 ? "" : "s"}`
          : "No selected rentals"
      },
      production: {
        title: "Production / BEO",
        detail: source === "firebase"
          ? "Open server BEO status"
          : "Download browser-local BEO — no receipt"
      },
      customer: {
        title: "Customer",
        detail: text(customer.organization) || formatWorkspaceText(customer.name || customer.email, { emptyLabel: "Customer not recorded" })
      }
    },
    soldScope: [
      { id: "package", label: "Package", value: packageName },
      {
        id: "menu",
        label: "Menu",
        value: menuNames.length
          ? `${menuNames.length} selected item${menuNames.length === 1 ? "" : "s"}`
          : "No menu items recorded",
        detail: menuNames.slice(0, 3).join(", ")
      },
      {
        id: "addons",
        label: "Add-ons",
        value: addonCount > 0 ? `${addonCount} selected` : "None selected",
        detail: addonNames.slice(0, 3).join(", ")
      },
      {
        id: "rentals",
        label: "Rentals & Equipment",
        value: rentalCount > 0 ? `${rentalCount} quoted unit${rentalCount === 1 ? "" : "s"}` : "None selected",
        detail: rentalNames.slice(0, 3).join(", ")
      },
      { id: "service", label: "Service", value: serviceStyle }
    ],
    lifecycle: buildLifecycle(quote),
    evidenceNote: `Source: ${formatWorkspaceSource(source)}. Condition and next action use bounded quote and Workflow evidence only.`,
    eventTypeLabel: humanizeWorkspaceValue(
      quote?.eventTypeId || selection.eventTypeId || event.eventTypeId,
      { emptyLabel: "Event type not recorded" }
    )
  };
}
