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

export const NOW_HORIZON_DAYS = 7;

const RISK_FAMILIES = new Set(["blocked", "failed", "expired"]);
const URGENT_STATES = new Set([
  "blocked_configuration",
  "blocked_source",
  "due_today",
  "invalid",
  "overdue"
]);

const COUNT_WORDS = Object.freeze([
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven"
]);

function countWord(count) {
  return COUNT_WORDS[count] || String(count);
}

function attentionTypeLabel(item = {}) {
  if (item.type === "follow_up") {
    return Number(item.daysOverdue) > 0 || item.state === "overdue"
      ? "Overdue follow-up"
      : "Follow-up due today";
  }
  if (item.type === "change_request") return "Customer request";
  if (item.type === "approval") return "Admin decision";
  if (item.type === "post_event_closeout") return "Post-event closeout";
  if (item.type === "unread_customer_reply") return "Customer reply";
  if (item.type === "anniversary_rebooking") return "Repeat-event review";
  return "Workflow review";
}

function consequenceFor(item = {}, signal = null) {
  if (item.type === "follow_up") return "No follow-up outcome is recorded yet.";
  if (item.type === "change_request") {
    return item.state === "invalid"
      ? "The request cannot be resolved until its recorded evidence is reviewed."
      : "No resolution is recorded for this customer request.";
  }
  if (item.type === "approval") return "No approval outcome is recorded.";
  if (item.type === "unread_customer_reply") {
    return "No staff review is recorded for this reply.";
  }
  if (item.type === "post_event_closeout") {
    if (item.state === "blocked_source") {
      return "Authoritative closeout actions remain unavailable until the accepted source is reviewed.";
    }
    if (item.state === "blocked_configuration") {
      return "Internal closeout review remains unavailable until a valid business time zone is set.";
    }
    return "No post-event review outcome is recorded.";
  }
  if (item.type === "anniversary_rebooking") {
    return "Creating or resuming a quote remains a separate operator action.";
  }
  return String(signal?.consequence || "The recorded Workflow item remains open until an outcome is recorded.").trim();
}

export function isNowPriorityUrgent({ item = {}, signal = {} } = {}) {
  return URGENT_STATES.has(String(item?.state || "").trim().toLowerCase())
    || Number(item?.daysOverdue) > 0
    || ["blocking", "warning"].includes(String(signal?.severity || "").trim().toLowerCase());
}

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

export function buildNowCard(item, quotes = [], { signal: evidenceSignal = null, timingCue = null } = {}) {
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
    typeLabel: attentionTypeLabel(item),
    urgent: isNowPriorityUrgent({ item, signal: evidenceSignal }),
    title,
    meta,
    sentence,
    consequence: consequenceFor(item, evidenceSignal),
    whyNow: item.type === "follow_up" || item.type === "post_event_closeout"
      ? ""
      : String(timingCue?.label || "").trim(),
    action: { id: "resolve", label: actionLabel, target }
  };
}

function upcomingSentence(upcomingEvents = []) {
  const events = Array.isArray(upcomingEvents) ? upcomingEvents : [];
  if (!events.length) return "";
  const statuses = new Set(events.map((event) => String(event?.status || "").trim().toLowerCase()));
  const noun = events.length === 1 ? "event" : "events";
  const verb = events.length === 1 ? "is" : "are";
  const status = statuses.size === 1 && statuses.has("accepted")
    ? "accepted"
    : statuses.size === 1 && statuses.has("booked")
      ? "booked"
      : "accepted or booked";
  return `${countWord(events.length)} ${status} ${noun} ${verb} scheduled in the next 7 days.`;
}

export function buildNowDecisionSummary({
  cards = [],
  upcomingEvents = [],
  commercialStepCount = 0,
  caughtUp = false,
  incomplete = false
} = {}) {
  const visibleCards = Array.isArray(cards) ? cards : [];
  const urgentCount = visibleCards.filter((card) => card?.urgent === true).length;
  const waitingCount = Math.max(0, visibleCards.length - urgentCount);
  let headline;

  if (urgentCount === 1) {
    const urgentCard = visibleCards.find((card) => card?.urgent === true);
    const urgentLabel = String(urgentCard?.typeLabel || "urgent item").toLowerCase();
    headline = `One ${urgentLabel === "follow-up due today" ? "follow-up" : urgentLabel} needs you today.`;
  } else if (urgentCount > 1) {
    headline = `${countWord(urgentCount)} urgent items need you today.`;
  } else if (visibleCards.length === 1) {
    headline = "One item is waiting for review.";
  } else if (visibleCards.length > 1) {
    headline = `${countWord(visibleCards.length)} items are waiting for review.`;
  } else if (commercialStepCount > 0) {
    headline = `${countWord(commercialStepCount)} commercial ${commercialStepCount === 1 ? "step remains" : "steps remain"}.`;
  } else if (caughtUp) {
    headline = "You're caught up on the work tracked here.";
  } else if (incomplete) {
    headline = "This view needs a little more context.";
  } else {
    headline = "Nothing needs you right now.";
  }

  const supporting = [];
  if (urgentCount > 0 && waitingCount > 0) {
    supporting.push(`${countWord(waitingCount)} other ${waitingCount === 1 ? "item is" : "items are"} waiting for review.`);
  }
  const upcoming = upcomingSentence(upcomingEvents);
  if (upcoming) supporting.push(upcoming);
  if (!supporting.length && caughtUp) {
    supporting.push("New customer replies, due work, and recorded operational pressure will appear here.");
  }

  return Object.freeze({
    headline,
    supporting: supporting.join(" "),
    urgentCount,
    waitingCount,
    visibleCount: visibleCards.length
  });
}

function calendarDateInTimeZone(nowISO, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(nowISO));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarDays(dateISO, dayOffset) {
  const date = new Date(`${dateISO}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

export function buildNowHorizon({
  nowISO,
  timeZone = "UTC",
  urgentCount = 0,
  upcomingEvents = []
} = {}) {
  if (!/T/u.test(String(nowISO || ""))) throw new Error("nowISO is required for the Now horizon.");
  const todayISO = calendarDateInTimeZone(nowISO, timeZone);
  const events = Array.isArray(upcomingEvents) ? upcomingEvents : [];
  return Object.freeze(Array.from({ length: NOW_HORIZON_DAYS }, (_, index) => {
    const dateISO = addCalendarDays(todayISO, index);
    const dayEvents = events.filter((event) => String(event?.event?.date || "") === dateISO);
    const firstEvent = dayEvents[0];
    const eventLabel = dayEvents.length > 1
      ? `${dayEvents.length} events`
      : dayEvents.length === 1
        ? [firstEvent?.event?.name || firstEvent?.quoteNumber, firstEvent?.event?.time]
            .filter(Boolean)
            .join(" · ")
        : "";
    const date = new Date(`${dateISO}T12:00:00.000Z`);
    return Object.freeze({
      dateISO,
      weekday: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      day: String(date.getUTCDate()),
      current: index === 0,
      urgentCount: index === 0 ? Math.max(0, Number(urgentCount) || 0) : 0,
      eventCount: dayEvents.length,
      eventLabel,
      state: index === 0 && urgentCount > 0
        ? (dayEvents.length ? "mixed" : "urgent")
        : dayEvents.length
          ? "event"
          : "quiet"
    });
  }));
}

export function formatNowReceiptAge(receipt = {}, nowISO) {
  const completedAtMs = Date.parse(receipt?.completedAtISO || "");
  const nowMs = Date.parse(nowISO || "");
  if (!Number.isFinite(completedAtMs) || !Number.isFinite(nowMs) || completedAtMs > nowMs) return "Recorded";
  const minutes = Math.floor((nowMs - completedAtMs) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 2880) return "Yesterday";
  return `${Math.floor(minutes / 1440)}d ago`;
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
