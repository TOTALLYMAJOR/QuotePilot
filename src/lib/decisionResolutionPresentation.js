import {
  APPROVAL_ACTIONS,
  getApprovalRequestExecutionEligibility
} from "./quoteWorkflow";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceSource,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "./workspacePresentation";

export const DECISION_RESOLUTION_PRESENTATION_MODEL = "clear-deck-decision-resolution-v1";

const KNOWN_LIFECYCLES = new Set([
  "draft",
  "sent",
  "viewed",
  "accepted",
  "booked",
  "declined",
  "expired",
  "deleted"
]);

const ACTION_LABELS = Object.freeze(
  Object.fromEntries(APPROVAL_ACTIONS.map((action) => [action.id, action.label]))
);

const PAYMENT_ACTIONS = new Set(["send_payment_request", "send_final_balance_request"]);

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function safeIso(value) {
  const raw = text(value);
  if (!raw) return "";
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function fact(id, label, state, value, reason) {
  return { id, label, state, value, reason };
}

function availableFact(id, label, value, reason = "Recorded on the exact approval scope.") {
  return fact(id, label, "available", value, reason);
}

function missingFact(id, label, reason) {
  return fact(id, label, "missing", "Not recorded", reason);
}

function contradictoryFact(id, label, reason) {
  return fact(id, label, "contradictory", "Does not match", reason);
}

function sourceMode(snapshot, item) {
  const value = lower(
    item?.source
    || item?.sourceMode
    || snapshot?.source
    || snapshot?.sourceMode
    || snapshot?.evidenceSource
  );
  return ["firebase", "local"].includes(value) ? value : "unknown";
}

function snapshotItems(snapshot) {
  if (Array.isArray(snapshot)) return snapshot;
  if (Array.isArray(snapshot?.items)) return snapshot.items;
  if (Array.isArray(snapshot?.attention?.items)) return snapshot.attention.items;
  if (Array.isArray(snapshot?.attentionSummary?.items)) return snapshot.attentionSummary.items;
  return [];
}

function exactQuoteId(item) {
  const itemQuoteId = text(item?.quoteId);
  const quoteId = text(item?.quote?.id);
  if (itemQuoteId && quoteId && itemQuoteId !== quoteId) {
    throw new DecisionResolutionPresentationError(
      "contradictory_quote_identity",
      "Approval attention quote identity does not match its quote record."
    );
  }
  const resolved = itemQuoteId || quoteId;
  if (!resolved) {
    throw new DecisionResolutionPresentationError(
      "missing_quote_identity",
      "Approval attention requires an exact quote identity."
    );
  }
  return resolved;
}

function quoteContentRevision(quote) {
  const explicit = text(quote?.activeVersionId || quote?.versionMeta?.versionId);
  if (explicit) return explicit;
  const versionNumber = Number(quote?.latestVersionNumber || quote?.versionMeta?.versionNumber);
  return Number.isSafeInteger(versionNumber) && versionNumber > 0
    ? `v${String(versionNumber).padStart(4, "0")}`
    : "";
}

function revisionPresentation(request, quote) {
  const requestRevision = text(request?.actionScope?.quoteRevisionId);
  if (requestRevision) {
    return { sourceRevisionTitle: "Request source revision", sourceRevisionLabel: requestRevision };
  }
  return {
    sourceRevisionTitle: "Current quote revision",
    sourceRevisionLabel: quoteContentRevision(quote) || "Current revision not recorded"
  };
}

function lifecycleLabel(quote) {
  const lifecycle = lower(quote?.status);
  return KNOWN_LIFECYCLES.has(lifecycle)
    ? humanizeWorkspaceValue(lifecycle)
    : "Lifecycle not recorded";
}

function customerLabel(quote) {
  return formatWorkspaceText(
    quote?.customer?.name || quote?.customer?.email || quote?.customerNameKey,
    { emptyLabel: "Customer not recorded" }
  );
}

function eventLabel(quote) {
  return formatWorkspaceText(quote?.event?.name || quote?.eventName, {
    emptyLabel: "Event name not recorded"
  });
}

function eventTiming(quote) {
  const date = text(quote?.event?.date || quote?.date);
  const startTime = text(
    quote?.event?.startTime
    || quote?.event?.time
    || quote?.startTime
    || quote?.time
  );
  if (!date && !startTime) {
    return {
      timingLabel: "Event timing",
      timingValue: "Event timing not recorded"
    };
  }
  const dateLabel = date
    ? formatWorkspaceDate(date, { emptyLabel: "Event date not recorded" })
    : "Event date not recorded";
  return {
    timingLabel: "Event timing",
    timingValue: startTime ? `${dateLabel} at ${startTime}` : dateLabel
  };
}

function requestAge(requestedAtISO, nowISO) {
  const requestedAt = safeIso(requestedAtISO);
  const reviewedAt = safeIso(nowISO);
  if (!requestedAt) {
    return {
      requestedAtLabel: "Request time not recorded",
      requestAgeLabel: "Waiting",
      requestAgeValue: "Age unavailable",
      requestAgeState: "missing"
    };
  }
  if (!reviewedAt) {
    return {
      requestedAtLabel: formatWorkspaceDateTime(requestedAt),
      requestAgeLabel: "Waiting",
      requestAgeValue: "Age unavailable without a review time",
      requestAgeState: "missing"
    };
  }
  const elapsedMinutes = Math.floor((Date.parse(reviewedAt) - Date.parse(requestedAt)) / 60000);
  if (elapsedMinutes < 0) {
    return {
      requestedAtLabel: formatWorkspaceDateTime(requestedAt),
      requestAgeLabel: "Waiting",
      requestAgeValue: "Request time is later than the review time",
      requestAgeState: "contradictory"
    };
  }
  const requestAgeValue = elapsedMinutes < 60
    ? "Less than 1 hour"
    : elapsedMinutes < 1440
      ? `${Math.floor(elapsedMinutes / 60)} hour${Math.floor(elapsedMinutes / 60) === 1 ? "" : "s"}`
      : `${Math.floor(elapsedMinutes / 1440)} day${Math.floor(elapsedMinutes / 1440) === 1 ? "" : "s"}`;
  return {
    requestedAtLabel: formatWorkspaceDateTime(requestedAt),
    requestAgeLabel: "Waiting",
    requestAgeValue,
    requestAgeState: "available"
  };
}

function governedDependencies(action, request, quote, source, nowISO) {
  if (!ACTION_LABELS[action]) {
    return {
      facts: [missingFact(
        "supported-action",
        "Supported action",
        "This approval action is not part of the supported governed-action set."
      )],
      summary: "The requested action is unsupported; do not decide from this presentation."
    };
  }
  const eligibility = getApprovalRequestExecutionEligibility(quote, {
    ...request,
    state: "approved",
    executionState: "awaiting_execution"
  }, {
    requireActivePortal: source === "firebase",
    ...(Number.isFinite(Date.parse(nowISO)) ? { nowMs: Date.parse(nowISO) } : {})
  });
  const factValue = eligibility.eligible
    ? "Current quote evidence satisfies the existing execution-eligibility authority"
    : eligibility.reason || "Current quote evidence no longer satisfies the existing authority.";
  const facts = [eligibility.eligible
    ? availableFact("governed-eligibility", "Governed eligibility", factValue)
    : contradictoryFact("governed-eligibility", "Governed eligibility", factValue)];
  const consequences = {
    send_payment_request: "Existing eligibility confirms the exact customer portal, source revision, customer email, and deposit amount; approval still requires separate execution and does not confirm payment.",
    send_final_balance_request: "Existing eligibility confirms the converted contract, paid-deposit evidence, current portal, and exact final balance; approval still requires separate execution and does not settle the balance.",
    convert_to_contract: "Approval permits a separate contract conversion; it does not create the contract.",
    rotate_portal_link: "Governed renewal replaces customer access and invalidates pending payment approvals tied to the prior portal.",
    delete_quote: "Approval permits a separate administrator-only permanent-delete confirmation."
  };
  return {
    facts,
    summary: eligibility.eligible
      ? consequences[action]
      : `Current quote evidence fails the existing governed eligibility check: ${factValue}`
  };
}

function stake(action, request, quote, dependencyFacts, source) {
  const knownSource = source === "firebase" || source === "local";
  if (PAYMENT_ACTIONS.has(action)) {
    const amountCents = Number(request?.actionScope?.amountCents);
    const trustworthy = knownSource
      && dependencyFacts.every((entry) => entry.state === "available")
      && Number.isSafeInteger(amountCents)
      && amountCents > 0
      && lower(request?.actionScope?.currency) === "usd";
    return {
      stakeLabel: action === "send_final_balance_request" ? "Final balance at stake" : "Deposit at stake",
      stakeValue: trustworthy
        ? formatWorkspaceMoney(amountCents / 100)
        : "Amount unavailable from the exact approval scope",
      stakeState: trustworthy ? "available" : "missing"
    };
  }
  if (action === "convert_to_contract") {
    const total = Number(quote?.totals?.total);
    const available = knownSource && Number.isFinite(total) && total >= 0;
    return {
      stakeLabel: "Accepted commitment at stake",
      stakeValue: available
        ? formatWorkspaceMoney(total)
        : "Quote total not recorded",
      stakeState: available ? "available" : "missing"
    };
  }
  if (action === "rotate_portal_link") {
    return {
      stakeLabel: "Customer access at stake",
      stakeValue: text(quote?.portalKey)
        ? "Current portal access will be replaced"
        : "Current portal evidence not recorded",
      stakeState: text(quote?.portalKey) ? "available" : "missing"
    };
  }
  if (action === "delete_quote") {
    return {
      stakeLabel: "Quote record at stake",
      stakeValue: "Permanent removal through the existing delete authority",
      stakeState: "available"
    };
  }
  return {
    stakeLabel: "Stake",
    stakeValue: "Not established for this action",
    stakeState: "missing"
  };
}

function evidenceSummary(source, dependencyFacts) {
  const hasContradiction = dependencyFacts.some((entry) => entry.state === "contradictory");
  const hasMissing = dependencyFacts.some((entry) => entry.state === "missing");
  if (hasContradiction) {
    return "The approval evidence conflicts with the loaded quote. Refresh the exact request before deciding.";
  }
  if (hasMissing) {
    return "Required approval evidence is missing. The presentation does not infer it; refresh before deciding.";
  }
  if (source === "firebase") {
    return "Connected tenant-scoped quote and approval records; provider delivery, payment settlement, and execution remain separate evidence.";
  }
  if (source === "local") {
    return "Browser-local quote and approval evidence only; no server, provider, payment, acceptance, or booking outcome is confirmed.";
  }
  return "Approval source is not confirmed. Refresh the bounded Workflow read before deciding.";
}

function buildPresentation(snapshot, item, request, nowISO) {
  const requestId = text(request?.id);
  if (!requestId) {
    throw new DecisionResolutionPresentationError(
      "missing_request_identity",
      "Pending approval presentation requires an exact request identity."
    );
  }
  const quoteId = exactQuoteId(item);
  const quote = item.quote || {};
  const action = text(request?.action);
  const actionLabel = ACTION_LABELS[action] || "Unsupported approval action";
  const source = sourceMode(snapshot, item);
  const age = requestAge(request?.requestedAtISO, nowISO);
  const timing = eventTiming(quote);
  const dependency = governedDependencies(action, request, quote, source, nowISO);
  const stakePresentation = stake(action, request, quote, dependency.facts, source);
  const evidence = evidenceSummary(source, dependency.facts);
  const supported = Boolean(ACTION_LABELS[action]);
  const sourceIncomplete = Boolean(
    snapshot?.loading
    || snapshot?.error
    || snapshot?.partial
    || snapshot?.stale
    || snapshot?.truncated
  );
  const reviewable = supported
    && source !== "unknown"
    && !sourceIncomplete
    && dependency.facts.every((entry) => entry.state === "available")
    && age.requestAgeState !== "contradictory";
  const nextStepLabel = reviewable ? "Approve or reject this request" : "Refresh the exact Workflow request";
  const revision = revisionPresentation(request, quote);

  return deepFreeze({
    model: DECISION_RESOLUTION_PRESENTATION_MODEL,
    id: requestId,
    stableId: `${quoteId}:${requestId}`,
    requestId,
    quoteId,
    attentionId: text(item?.id) || `approval:${quoteId}`,
    attentionType: "approval",
    actionId: action,
    actionLabel,
    title: supported ? `Decide ${actionLabel.toLowerCase()}` : "Review unsupported approval request",
    quoteLabel: formatWorkspaceText(quote?.quoteNumber, { emptyLabel: "Quote number not recorded" }),
    customerLabel: customerLabel(quote),
    eventLabel: eventLabel(quote),
    lifecycleLabel: lifecycleLabel(quote),
    requestSummary: text(request?.note) || "No request note was recorded.",
    requestNoteState: text(request?.note) ? "available" : "missing",
    ...stakePresentation,
    ...timing,
    ...age,
    requesterLabel: text(request?.requestedByEmail) || "Requester not recorded",
    requesterState: text(request?.requestedByEmail) ? "available" : "missing",
    ...revision,
    dependencySummary: dependency.summary,
    dependencies: dependency.facts,
    authoritySummary: "An administrator must approve or reject this exact request. Approval records authority for only the named action; execution remains separate.",
    evidenceSource: source,
    evidenceSourceLabel: source === "unknown" ? "Source not confirmed" : formatWorkspaceSource(source),
    evidenceSummary: sourceIncomplete
      ? "The bounded decision evidence is incomplete or stale. Refresh the exact Workflow request before deciding."
      : evidence,
    reviewable,
    nextStepLabel,
    nextStepSummary: reviewable
      ? "Record the administrator decision for this exact request; approval will not execute the action automatically."
      : "Reload the exact tenant-scoped Workflow evidence. Do not resolve or substitute another request."
  });
}

function buildDecisionDebtPresentation(snapshot, item) {
  const requestId = text(item?.id);
  if (!requestId) {
    throw new DecisionResolutionPresentationError(
      "missing_request_identity",
      "Decision Debt presentation requires an exact item identity."
    );
  }
  const quoteId = exactQuoteId(item);
  const quote = item.quote || {};
  const source = sourceMode(snapshot, item);
  const sourceIncomplete = Boolean(
    snapshot?.loading
    || snapshot?.error
    || snapshot?.partial
    || snapshot?.stale
    || snapshot?.truncated
  );
  const exposureCents = Number(item?.commercialExposureCents);
  const exposureKnown = Number.isSafeInteger(exposureCents) && exposureCents >= 0;
  const affected = Array.isArray(item?.affectedNodeIds) ? item.affectedNodeIds.filter(text) : [];
  const eventDate = text(item?.eventDate || quote?.event?.date);
  const lockDate = text(item?.lockDate);
  const currentRevision = text(item?.sourceRevisionId);
  const reviewable = source !== "unknown" && !sourceIncomplete;
  return deepFreeze({
    model: DECISION_RESOLUTION_PRESENTATION_MODEL,
    id: requestId,
    stableId: `${quoteId}:${requestId}`,
    requestId,
    quoteId,
    attentionId: requestId,
    attentionType: "decision_debt",
    actionId: text(item?.decisionType) || "review_decision_debt",
    actionLabel: "Review decision evidence",
    title: text(item?.label) || "Review unresolved commercial decision",
    quoteLabel: formatWorkspaceText(quote?.quoteNumber || item?.quoteLabel, { emptyLabel: "Quote number not recorded" }),
    customerLabel: customerLabel(quote),
    eventLabel: eventLabel(quote),
    lifecycleLabel: lifecycleLabel(quote),
    requestSummary: Array.isArray(item?.explanation) && item.explanation.length
      ? item.explanation.filter(text).join(" ")
      : "Workflow holds the current deterministic decision evidence.",
    requestNoteState: Array.isArray(item?.explanation) && item.explanation.length ? "available" : "missing",
    stakeLabel: "Recorded commercial exposure",
    stakeValue: exposureKnown ? formatWorkspaceMoney(exposureCents / 100) : "Exposure unavailable—not zero",
    stakeState: exposureKnown ? "available" : "missing",
    timingLabel: "Decision timing",
    timingValue: [
      eventDate ? `Event ${formatWorkspaceDate(eventDate)}` : "Event date not recorded",
      lockDate ? `lock ${formatWorkspaceDate(lockDate)}` : "lock date not recorded"
    ].join(" · "),
    requestAgeLabel: "Urgency",
    requestAgeValue: text(item?.urgency) ? humanizeWorkspaceValue(item.urgency) : "Urgency unavailable",
    requestAgeState: text(item?.urgency) ? "available" : "missing",
    requesterLabel: "Server-derived decision projection",
    requesterState: "available",
    sourceRevisionTitle: "Decision source revision",
    sourceRevisionLabel: currentRevision || "Source revision not recorded",
    dependencySummary: affected.length
      ? `${formatWorkspaceInteger(affected.length)} affected dependenc${affected.length === 1 ? "y" : "ies"}; review exact nodes in Workflow.`
      : "Affected dependencies were not included in this projection; review Workflow evidence.",
    dependencies: affected.map((nodeId) => availableFact(
      `dependency:${nodeId}`,
      "Affected dependency",
      nodeId,
      "Returned by the existing Decision Debt projection."
    )),
    authoritySummary: "Workflow owns Decision Debt evidence and its valid continuations. Clear the Deck does not acknowledge or resolve the underlying decision.",
    evidenceSource: source,
    evidenceSourceLabel: source === "unknown" ? "Source not confirmed" : formatWorkspaceSource(source),
    evidenceSummary: sourceIncomplete
      ? "The bounded decision evidence is incomplete or stale. Refresh Workflow before relying on it."
      : "Existing Decision Debt evidence only; no pricing, payment, booking, or resolution outcome is inferred.",
    reviewable,
    nextStepLabel: "Review decision evidence",
    nextStepSummary: reviewable
      ? "Open this exact Decision Debt item in Workflow; navigation does not resolve it."
      : "Refresh the exact Workflow decision. Do not substitute another item."
  });
}

export class DecisionResolutionPresentationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DecisionResolutionPresentationError";
    this.code = code;
  }
}

/**
 * Expands the existing quote-aggregated Workflow approval attention into one
 * decision-complete presentation per exact pending request. This projection
 * grants no resolution or execution authority and performs no I/O.
 */
export function buildClearDeckDecisionPresentations(snapshot = {}, { nowISO = "" } = {}) {
  const presentations = [];
  const identities = new Set();

  snapshotItems(snapshot).forEach((item) => {
    if (text(item?.type) === "decision_debt") {
      const presentation = buildDecisionDebtPresentation(snapshot, item);
      if (identities.has(presentation.stableId)) {
        throw new DecisionResolutionPresentationError(
          "duplicate_request_identity",
          "The same exact decision appears more than once in the Workflow snapshot."
        );
      }
      identities.add(presentation.stableId);
      presentations.push(presentation);
      return;
    }
    if (text(item?.type) !== "approval") return;
    const pendingRequests = Array.isArray(item?.pendingRequests) ? item.pendingRequests : [];
    pendingRequests.forEach((request) => {
      if (lower(request?.state) !== "pending") return;
      const presentation = buildPresentation(snapshot, item, request, nowISO);
      if (identities.has(presentation.stableId)) {
        throw new DecisionResolutionPresentationError(
          "duplicate_request_identity",
          "The same exact approval request appears more than once in the Workflow snapshot."
        );
      }
      identities.add(presentation.stableId);
      presentations.push(presentation);
    });
  });

  return deepFreeze(presentations);
}
