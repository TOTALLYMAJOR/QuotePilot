export const WORKFLOW_TIMING_CUE_DEFAULT_LIMIT = 100;
export const WORKFLOW_TIMING_CUE_MAX_LIMIT = 100;
export const WORKFLOW_COMPLETION_RECEIPT_DEFAULT_LIMIT = 10;
export const WORKFLOW_COMPLETION_RECEIPT_MAX_LIMIT = 25;
export const WORKFLOW_TIMING_INPUT_SCAN_LIMIT = 200;

export const WORKFLOW_TIMING_CUE_EVIDENCE_BOUNDARY =
  "Calendar cues are derived from recorded timestamps in the supplied tenant-scoped snapshot; they are not persisted owners, SLAs, escalations, or provider notifications.";

export const WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY =
  "Internal completion receipts prove only the named staff workflow action; they do not prove customer contact, provider delivery, proposal resolution, payment, booking, or resolution of a later request.";

const ACTIVE_FOLLOW_UP_QUOTE_STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "accepted"
]);

const SOURCE_LABELS = Object.freeze({
  "workflow.attention": "Current workflow attention snapshot",
  "quote.workflow.follow_up": "Recorded quote follow-up",
  "quote.workflow.change_request": "Recorded current-request handling",
  "quote.workflow.approval": "Recorded approval decision"
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

function boundedText(value, limit = 120) {
  return text(value).slice(0, limit);
}

function normalizeLimit(value, fallback, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(parsed)));
}

function timezoneBearingISO(value) {
  let candidate = value;
  if (typeof value?.toDate === "function") candidate = value.toDate();
  if (candidate instanceof Date) {
    return Number.isNaN(candidate.getTime()) ? "" : candidate.toISOString();
  }

  const raw = text(candidate);
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(raw)
    || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
  ) {
    return "";
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeNowISO(value) {
  const normalized = timezoneBearingISO(value);
  if (!normalized) {
    throw new TypeError("buildWorkflowTimingCues requires a valid timezone-bearing nowISO.");
  }
  return normalized;
}

function normalizeTimeZone(value) {
  const requested = text(value) || "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: requested })
      .resolvedOptions()
      .timeZone;
  } catch {
    throw new TypeError("buildWorkflowTimingCues requires a valid IANA timeZone.");
  }
}

function calendarDateInTimeZone(instantISO, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(instantISO));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function calendarDaySerial(value) {
  const candidate = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== candidate
  ) {
    return null;
  }
  return parsed.getTime() / 86400000;
}

function quoteIdentity(record = {}) {
  return {
    quoteId: safeOpaqueId(record?.quoteId || record?.id),
    quoteNumber: boundedText(record?.quoteNumber)
  };
}

function elapsedTiming(ageDays) {
  if (ageDays < 0) return { timingState: "future_recorded", ageBand: "future" };
  if (ageDays === 0) return { timingState: "recorded_today", ageBand: "today" };
  if (ageDays <= 2) return { timingState: "waiting", ageBand: "recent" };
  if (ageDays <= 6) return { timingState: "waiting", ageBand: "aging" };
  return { timingState: "waiting", ageBand: "long_waiting" };
}

function elapsedLabel(subject, ageDays) {
  if (ageDays < 0) return `${subject} has a future recorded timestamp`;
  if (ageDays === 0) return `${subject} recorded today`;
  return `${subject} waiting ${ageDays} calendar ${ageDays === 1 ? "day" : "days"}`;
}

function dueTiming(dueDate, todaySerial) {
  const dueSerial = calendarDaySerial(dueDate);
  if (dueSerial === null) return null;
  const daysUntilDue = dueSerial - todaySerial;
  if (daysUntilDue < 0) {
    const daysOverdue = Math.abs(daysUntilDue);
    return {
      timingState: "overdue",
      ageBand: "overdue",
      daysOverdue,
      daysUntilDue,
      label: `Follow-up overdue by ${daysOverdue} calendar ${daysOverdue === 1 ? "day" : "days"}`
    };
  }
  if (daysUntilDue === 0) {
    return {
      timingState: "due_today",
      ageBand: "today",
      daysOverdue: 0,
      daysUntilDue: 0,
      label: "Follow-up due today"
    };
  }
  return {
    timingState: "upcoming",
    ageBand: "upcoming",
    daysOverdue: 0,
    daysUntilDue,
    label: `Follow-up due in ${daysUntilDue} calendar ${daysUntilDue === 1 ? "day" : "days"}`
  };
}

function addAttentionCue(candidates, dedupe, item, context) {
  const type = text(item?.type).toLowerCase();
  if (!["follow_up", "change_request", "approval"].includes(type)) return;

  const identity = quoteIdentity({
    quoteId: item?.quoteId || item?.quote?.id,
    quoteNumber: item?.quote?.quoteNumber
  });
  if (!identity.quoteId) return;
  const dedupeKey = `${type}:${identity.quoteId}`;
  if (dedupe.has(dedupeKey)) return;

  const workflowState = boundedText(item?.state, 40).toLowerCase();
  const base = {
    id: safeOpaqueId(item?.id) || `${type}:${identity.quoteId}`,
    type,
    workflowState,
    ...identity,
    source: "workflow.attention",
    sourceLabel: SOURCE_LABELS["workflow.attention"],
    evidenceBoundary: WORKFLOW_TIMING_CUE_EVIDENCE_BOUNDARY
  };

  if (type === "follow_up") {
    const dueDate = text(item?.dateISO);
    const timing = dueTiming(dueDate, context.todaySerial);
    if (!timing) return;
    candidates.push({
      ...base,
      dueDate,
      ageDays: null,
      ...timing
    });
    dedupe.add(dedupeKey);
    return;
  }

  const atISO = timezoneBearingISO(item?.dateISO);
  if (!atISO) return;
  const recordedDate = calendarDateInTimeZone(atISO, context.timeZone);
  const ageDays = context.todaySerial - calendarDaySerial(recordedDate);
  const timing = elapsedTiming(ageDays);
  const subject = type === "change_request"
    ? (workflowState === "acknowledged" ? "Acknowledged change request" : "Change request")
    : "Approval request";
  candidates.push({
    ...base,
    recordedAtISO: atISO,
    recordedDate,
    dueDate: "",
    daysOverdue: null,
    daysUntilDue: null,
    ageDays,
    ...timing,
    label: elapsedLabel(subject, ageDays)
  });
  dedupe.add(dedupeKey);
}

function addQuoteFollowUpCue(candidates, dedupe, quote, context) {
  const identity = quoteIdentity(quote);
  const quoteStatus = text(quote?.status).toLowerCase();
  if (!identity.quoteId || !ACTIVE_FOLLOW_UP_QUOTE_STATUSES.has(quoteStatus)) return;
  const followUp = quote?.workflow?.followUp;
  if (!followUp || typeof followUp !== "object" || Array.isArray(followUp)) return;
  if (
    followUp.completed === true
    || ["won", "lost"].includes(text(followUp.stage).toLowerCase())
  ) {
    return;
  }

  const dedupeKey = `follow_up:${identity.quoteId}`;
  if (dedupe.has(dedupeKey)) return;
  const dueDate = text(followUp.dueDate);
  const timing = dueTiming(dueDate, context.todaySerial);
  if (!timing) return;
  candidates.push({
    id: `follow-up:${identity.quoteId}`,
    type: "follow_up",
    workflowState: text(followUp.stage).toLowerCase(),
    ...identity,
    dueDate,
    ageDays: null,
    ...timing,
    source: "quote.workflow.follow_up",
    sourceLabel: SOURCE_LABELS["quote.workflow.follow_up"],
    evidenceBoundary: WORKFLOW_TIMING_CUE_EVIDENCE_BOUNDARY
  });
  dedupe.add(dedupeKey);
}

function receiptDaysAgo(completedAtISO, context) {
  const completedDate = calendarDateInTimeZone(completedAtISO, context.timeZone);
  return context.todaySerial - calendarDaySerial(completedDate);
}

function addReceipt(receipts, dedupe, {
  quoteId,
  quoteNumber,
  kind,
  label,
  completedAtISO,
  source,
  subjectId = "",
  requestId = ""
}, context) {
  const normalizedQuoteId = safeOpaqueId(quoteId);
  const normalizedAtISO = timezoneBearingISO(completedAtISO);
  if (
    !normalizedQuoteId
    || !normalizedAtISO
    || Date.parse(normalizedAtISO) > context.nowMs
    || !SOURCE_LABELS[source]
  ) {
    return;
  }
  const normalizedSubjectId = subjectId ? safeOpaqueId(subjectId) : "";
  const normalizedRequestId = requestId ? safeOpaqueId(requestId) : "";
  if (subjectId && !normalizedSubjectId) return;
  if (requestId && !normalizedRequestId) return;
  const dedupeKey = `${normalizedQuoteId}:${kind}:${normalizedSubjectId}:${normalizedAtISO}`;
  if (dedupe.has(dedupeKey)) return;
  dedupe.add(dedupeKey);
  receipts.push({
    id: dedupeKey,
    kind,
    label,
    completedAtISO: normalizedAtISO,
    daysAgo: receiptDaysAgo(normalizedAtISO, context),
    quoteId: normalizedQuoteId,
    quoteNumber: boundedText(quoteNumber),
    ...(normalizedRequestId ? { requestId: normalizedRequestId } : {}),
    source,
    sourceLabel: SOURCE_LABELS[source],
    evidenceBoundary: WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY
  });
}

function handlingMatchesCurrentRequest(quote) {
  const decision = quote?.portalDecision || {};
  const handling = quote?.workflow?.changeRequestHandling || {};
  const requestId = text(decision.requestId);
  const requestMessage = text(decision.message);
  return decision.decision === "changes_requested"
    && Boolean(timezoneBearingISO(decision.submittedAtISO))
    && Boolean(requestMessage)
    && text(handling.sourceSubmittedAtISO) === text(decision.submittedAtISO)
    && text(handling.sourceMessage) === requestMessage
    && (
      requestId
        ? text(handling.sourceRequestId) === requestId
        : !text(handling.sourceRequestId)
    );
}

function addQuoteReceipts(receipts, dedupe, quote, context, scanState) {
  const identity = quoteIdentity(quote);
  if (!identity.quoteId) return;
  const workflow = quote?.workflow && typeof quote.workflow === "object"
    ? quote.workflow
    : {};
  const followUp = workflow.followUp && typeof workflow.followUp === "object"
    ? workflow.followUp
    : {};
  if (followUp.completed === true) {
    addReceipt(receipts, dedupe, {
      ...identity,
      kind: "follow_up_completed",
      label: "Follow-up marked complete internally",
      completedAtISO: followUp.completedAtISO,
      source: "quote.workflow.follow_up"
    }, context);
  }

  const handling = workflow.changeRequestHandling
    && typeof workflow.changeRequestHandling === "object"
    ? workflow.changeRequestHandling
    : {};
  if (handlingMatchesCurrentRequest(quote)) {
    const handlingState = text(handling.state).toLowerCase();
    if (["acknowledged", "handled"].includes(handlingState)) {
      addReceipt(receipts, dedupe, {
        ...identity,
        kind: "change_request_acknowledged",
        label: "Current change request acknowledged internally",
        completedAtISO: handling.acknowledgedAtISO,
        source: "quote.workflow.change_request",
        subjectId: quote?.portalDecision?.requestId || quote?.portalDecision?.submittedAtISO
      }, context);
    }
    if (handlingState === "handled") {
      addReceipt(receipts, dedupe, {
        ...identity,
        kind: "change_request_handled",
        label: "Current change request marked handled internally",
        completedAtISO: handling.handledAtISO,
        source: "quote.workflow.change_request",
        subjectId: quote?.portalDecision?.requestId || quote?.portalDecision?.submittedAtISO
      }, context);
    }
  }

  const approvalRequests = Array.isArray(workflow.approvalRequests)
    ? workflow.approvalRequests
    : [];
  if (approvalRequests.length > WORKFLOW_TIMING_INPUT_SCAN_LIMIT) {
    scanState.nestedApprovalScanTruncated = true;
  }
  approvalRequests.slice(0, WORKFLOW_TIMING_INPUT_SCAN_LIMIT).forEach((request) => {
    const state = text(request?.state).toLowerCase();
    if (!["approved", "rejected"].includes(state)) return;
    const requestId = safeOpaqueId(request?.id);
    if (!requestId) return;
    addReceipt(receipts, dedupe, {
      ...identity,
      kind: "approval_decision_recorded",
      label: `Approval decision recorded internally: ${state}`,
      completedAtISO: request?.resolvedAtISO,
      source: "quote.workflow.approval",
      subjectId: requestId,
      requestId
    }, context);
  });
}

function cueSortRank(cue) {
  if (cue.timingState === "overdue") return 0;
  if (cue.timingState === "due_today") return 1;
  if (cue.ageBand === "long_waiting") return 2;
  if (cue.ageBand === "aging") return 3;
  if (cue.ageBand === "recent") return 4;
  if (cue.ageBand === "today") return 5;
  if (cue.timingState === "upcoming") return 6;
  return 7;
}

function sortCues(left, right) {
  return cueSortRank(left) - cueSortRank(right)
    || (right.ageDays ?? -1) - (left.ageDays ?? -1)
    || (left.daysUntilDue ?? 0) - (right.daysUntilDue ?? 0)
    || text(left.quoteNumber || left.quoteId).localeCompare(text(right.quoteNumber || right.quoteId))
    || left.type.localeCompare(right.type);
}

/**
 * Builds deterministic presentation-only timing cues and safe internal workflow
 * receipts from a tenant-scoped workflow snapshot. Callers must supply `nowISO`;
 * no ambient clock or persistence is used.
 */
export function buildWorkflowTimingCues({
  attentionSummary = {},
  quotes = [],
  nowISO,
  timeZone = "UTC",
  cueLimit,
  receiptLimit
} = {}) {
  const normalizedNowISO = normalizeNowISO(nowISO);
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const todayISO = calendarDateInTimeZone(normalizedNowISO, normalizedTimeZone);
  const context = {
    nowISO: normalizedNowISO,
    nowMs: Date.parse(normalizedNowISO),
    timeZone: normalizedTimeZone,
    todayISO,
    todaySerial: calendarDaySerial(todayISO)
  };
  const normalizedCueLimit = normalizeLimit(
    cueLimit,
    WORKFLOW_TIMING_CUE_DEFAULT_LIMIT,
    WORKFLOW_TIMING_CUE_MAX_LIMIT
  );
  const normalizedReceiptLimit = normalizeLimit(
    receiptLimit,
    WORKFLOW_COMPLETION_RECEIPT_DEFAULT_LIMIT,
    WORKFLOW_COMPLETION_RECEIPT_MAX_LIMIT
  );
  const attentionItems = Array.isArray(attentionSummary?.items)
    ? attentionSummary.items
    : [];
  const quoteRecords = Array.isArray(quotes) ? quotes : [];
  const scannedAttentionItems = attentionItems.slice(0, WORKFLOW_TIMING_INPUT_SCAN_LIMIT);
  const scannedQuotes = quoteRecords.slice(0, WORKFLOW_TIMING_INPUT_SCAN_LIMIT);

  const cueCandidates = [];
  const cueDedupe = new Set();
  scannedAttentionItems.forEach((item) => {
    addAttentionCue(cueCandidates, cueDedupe, item, context);
  });
  scannedQuotes.forEach((quote) => {
    addQuoteFollowUpCue(cueCandidates, cueDedupe, quote, context);
  });
  cueCandidates.sort(sortCues);

  const receiptCandidates = [];
  const receiptDedupe = new Set();
  const receiptScanState = { nestedApprovalScanTruncated: false };
  scannedQuotes.forEach((quote) => {
    addQuoteReceipts(receiptCandidates, receiptDedupe, quote, context, receiptScanState);
  });
  receiptCandidates.sort((left, right) => (
    right.completedAtISO.localeCompare(left.completedAtISO)
    || left.id.localeCompare(right.id)
  ));

  const sourceScanTruncated = attentionItems.length > scannedAttentionItems.length
    || quoteRecords.length > scannedQuotes.length;
  const cues = cueCandidates.slice(0, normalizedCueLimit);
  const receipts = receiptCandidates.slice(0, normalizedReceiptLimit);
  const receiptSourceScanTruncated = quoteRecords.length > scannedQuotes.length
    || receiptScanState.nestedApprovalScanTruncated;
  const truncated = sourceScanTruncated
    || receiptSourceScanTruncated
    || cues.length < cueCandidates.length
    || receipts.length < receiptCandidates.length;

  return {
    status: truncated ? "partial" : (cues.length || receipts.length ? "success" : "empty"),
    asOf: {
      nowISO: normalizedNowISO,
      timeZone: normalizedTimeZone,
      todayISO
    },
    cueEvidenceBoundary: WORKFLOW_TIMING_CUE_EVIDENCE_BOUNDARY,
    receiptEvidenceBoundary: WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY,
    cues,
    receipts,
    cuePageInfo: {
      limit: normalizedCueLimit,
      returned: cues.length,
      candidateCount: cueCandidates.length,
      sourceScanTruncated,
      truncated: sourceScanTruncated || cues.length < cueCandidates.length
    },
    receiptPageInfo: {
      limit: normalizedReceiptLimit,
      returned: receipts.length,
      candidateCount: receiptCandidates.length,
      sourceScanTruncated: receiptSourceScanTruncated,
      truncated: receiptSourceScanTruncated
        || receipts.length < receiptCandidates.length
    }
  };
}
