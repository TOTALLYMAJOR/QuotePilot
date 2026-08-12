import { classifyAttentionItem } from "../lib/statusSemantics";
import { getWorkflowAttentionFocusId } from "../lib/quoteWorkflow";
import { formatWorkspaceText } from "../lib/workspacePresentation";

// Deterministic presentation contract for the flag-gated NOW surface. It
// re-interprets the existing bounded Workflow attention evidence as
// decision-grammar cards: one sentence of interpretation plus the exact
// resolution target the item already routes to. It creates no new evidence,
// reads nothing itself, and never claims beyond the item state it was given.
export const NOW_PRESENTATION_MODEL = "now-presentation-v1";

export const NOW_CARD_LIMIT = 6;

const RISK_FAMILIES = new Set(["blocked", "failed", "expired"]);

function quoteFor(item, quotes) {
  if (Array.isArray(quotes)) {
    const match = quotes.find((quote) => quote?.id === item.quoteId);
    if (match) return match;
  }
  return item.quote || {};
}

function customerTitle(quote) {
  return String(quote?.customer?.name || quote?.customer?.email || "Customer").trim();
}

function overdueSentence(daysOverdue, dueCopy, overdueCopy) {
  if (Number(daysOverdue) > 0) {
    const days = Number(daysOverdue);
    return overdueCopy.replace("{days}", `${days} day${days === 1 ? "" : "s"}`);
  }
  return dueCopy;
}

export function buildNowCard(item, quotes = []) {
  const quote = quoteFor(item, quotes);
  const { family, label } = classifyAttentionItem(item.type, item.state);
  const title = customerTitle(quote);
  const meta = formatWorkspaceText(quote?.quoteNumber, { emptyLabel: "Quote number pending" });
  const workflowTarget = {
    surface: "workflow",
    quoteId: item.quoteId,
    attentionType: item.type,
    requestId: getWorkflowAttentionFocusId(item)
  };

  let sentence;
  let actionLabel = "Open in Workflow";
  let target = workflowTarget;
  let signal = RISK_FAMILIES.has(family) ? "risk" : "attend";

  if (item.type === "change_request") {
    const message = String(item.sourceMessage || "").trim();
    sentence = message
      ? `They wrote: “${message}”`
      : "The customer request has no readable message.";
    actionLabel = "Review request";
  } else if (item.type === "follow_up") {
    sentence = overdueSentence(
      item.daysOverdue,
      "This proposal's follow-up is due today.",
      "This proposal has waited {days} past its follow-up date."
    );
    actionLabel = "Follow up";
  } else if (item.type === "approval") {
    const count = Array.isArray(item.pendingRequests) ? item.pendingRequests.length : 0;
    sentence = `${count} pending approval${count === 1 ? " is" : "s are"} waiting on an admin decision.`;
    actionLabel = "Review approvals";
  } else if (item.type === "post_event_closeout") {
    if (item.state === "blocked_source") {
      sentence = "This booked legacy record needs accepted-source review before authoritative closeout actions are available.";
      signal = "risk";
    } else if (item.state === "blocked_configuration") {
      sentence = "Set a valid business time zone before internal closeout review can be recorded.";
      signal = "risk";
    } else {
      sentence = overdueSentence(
        item.daysOverdue,
        "The post-event review is due today.",
        "The post-event review is {days} overdue."
      );
    }
    actionLabel = "Close out";
  } else if (item.type === "unread_customer_reply") {
    sentence = "A customer reply is waiting in this event's conversation.";
    actionLabel = "Read reply";
  } else if (item.type === "anniversary_rebooking") {
    const eventName = formatWorkspaceText(item.eventName, { emptyLabel: "Prior event" });
    const boundWarning = item.sourceBound?.truncated
      ? " The latest quote-history scan is incomplete; check the client overview for older or matching records."
      : "";
    const calendarWarning = item.calendarContext?.source === "tenant"
      ? ""
      : ` ${formatWorkspaceText(item.calendarContext?.label, { emptyLabel: "Fallback anniversary calendar" })}.`;
    sentence = `${eventName} was booked this week last year. Review the exact accepted source before creating or resuming a rebook draft.${boundWarning}${calendarWarning}`;
    actionLabel = "Review rebook";
    if (quote?.customerId) {
      target = { surface: "customer", customerId: quote.customerId };
    }
  } else {
    sentence = "This needs a look in Workflow.";
  }

  return {
    id: item.id,
    type: item.type,
    quoteId: item.quoteId,
    signal,
    family,
    label,
    title,
    meta,
    sentence,
    action: { id: "resolve", label: actionLabel, target }
  };
}

export function buildNowCards({ items = [], quotes = [], limit = NOW_CARD_LIMIT } = {}) {
  const list = Array.isArray(items) ? items : [];
  const visible = list.slice(0, limit).map((item) => buildNowCard(item, quotes));
  return {
    modelId: NOW_PRESENTATION_MODEL,
    cards: visible,
    overflowCount: Math.max(0, list.length - visible.length)
  };
}

export function describeNowEmptyState({ truncated = false } = {}) {
  return truncated
    ? "No attention appears in this bounded snapshot. Additional records may remain outside the completed reads."
    : "Nothing needs you right now. New customer replies, change requests, overdue follow-ups, post-event closeouts, repeat-event opportunities, and pending approvals will appear here.";
}
