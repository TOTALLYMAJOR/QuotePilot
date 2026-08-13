import { classifyQuoteStatus } from "../lib/statusSemantics";
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
        ? "All weighted proposal fields in the existing readiness model are recorded. This is not operational event readiness."
        : `${proposal.gaps.length} weighted proposal field${proposal.gaps.length === 1 ? "" : "s"} need review. This is not operational event readiness.`,
      gaps: proposal.gaps.map((gap) => ({ id: gap.id, label: gap.label, points: gap.points })),
      reasonCodes: readinessReasonCodes,
      evidence: {
        model: "proposal-readiness-v1",
        criteriaCount: proposal.criteria.length,
        recordedCriteriaCount: proposal.criteria.filter((item) => item.passed).length
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
