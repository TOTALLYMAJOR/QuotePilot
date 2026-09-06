import {
  AMBIENT_SIGNAL_NORMALIZATION_BOUNDS,
  normalizeNowAttentionSignals
} from "./ambientSignals";
import {
  WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY,
  buildWorkflowTimingCues
} from "./workflowTimingCues";

/**
 * Pure, presentation-only model for the Ambient NOW briefing.
 *
 * The supplied commercial snapshot already owns tenant scoping, reads, and
 * Workflow ordering. This model performs no I/O and grants no authority. It
 * only narrows that bounded evidence into three priorities, safe internal
 * completion receipts, and an explicit freshness/caught-up contract.
 */
export const AMBIENT_NOW_BRIEFING_MODEL = "ambient-now-briefing-v1";
export const AMBIENT_NOW_PRIORITY_LIMIT = 3;
export const AMBIENT_NOW_QUIET_PROGRESS_LIMIT = 3;

const EXPECTED_READS = Object.freeze([
  "attention",
  "history",
  "unreadReplies"
]);

const QUIET_PROGRESS_KINDS = new Set([
  "follow_up_completed",
  "change_request_acknowledged",
  "change_request_handled",
  "approval_decision_recorded"
]);

const DEVICE_READ_CAVEAT =
  "The timestamp records when this device completed the bounded staff read; it is not provider, customer, payment, booking, or operational-completion evidence.";

function text(value) {
  return String(value ?? "").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function loadedAtISO(value) {
  let candidate = value;
  if (typeof value?.toDate === "function") candidate = value.toDate();
  if (candidate instanceof Date) {
    return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
  }
  if (typeof candidate === "number") {
    if (!Number.isFinite(candidate) || candidate <= 0) return null;
    const parsed = new Date(candidate);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (!text(candidate)) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readStates(reads) {
  return Object.freeze(Object.fromEntries(EXPECTED_READS.map((key) => [
    key,
    text(reads?.[key]?.status).toLowerCase() || "unknown"
  ])));
}

function declaredAttentionCount(summary, returnedCount) {
  const declared = Number(summary?.itemCount);
  if (!Number.isSafeInteger(declared) || declared < 0) return returnedCount;
  // A smaller declaration is malformed and the AmbientSignal adapter will
  // fail it closed. Still retain the returned count here so caught-up can
  // never be inferred while any supplied item remains visible.
  return Math.max(declared, returnedCount);
}

function buildFreshness(snapshot, {
  attentionItemCount,
  returnedAttentionCount
}) {
  const readState = readStates(snapshot?.reads);
  const loadedAt = loadedAtISO(snapshot?.loadedAt);
  const hasCompleteRead = Boolean(loadedAt);
  const allReadsSuccessful = EXPECTED_READS.every((key) => readState[key] === "success");
  const anyReadFailed = EXPECTED_READS.some((key) => readState[key] === "error");
  const loading = snapshot?.loading === true;
  const partial = snapshot?.partial === true || anyReadFailed;
  const stale = snapshot?.stale === true || (Boolean(text(snapshot?.error)) && hasCompleteRead);
  const truncated = snapshot?.truncated === true
    || attentionItemCount > returnedAttentionCount
    || returnedAttentionCount > AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.attentionItems;
  const boundsKnown = snapshot?.truncationKnown === true;
  const source = text(snapshot?.source);
  const unknown = !hasCompleteRead || !allReadsSuccessful || !boundsKnown || !source;

  let state = "current";
  let reason = "The bounded staff snapshot completed without a declared quality warning.";
  if (loading && !hasCompleteRead) {
    state = "loading";
    reason = "The first bounded staff snapshot is still loading.";
  } else if (!hasCompleteRead) {
    state = "unavailable";
    reason = text(snapshot?.error) || "No complete bounded staff snapshot is available yet.";
  } else if (stale) {
    state = "stale";
    reason = "The latest refresh did not complete; the retained complete snapshot may be out of date.";
  } else if (partial) {
    state = "partial";
    reason = "One or more bounded staff reads did not complete.";
  } else if (loading) {
    state = "refreshing";
    reason = "A new read is in progress while the last complete snapshot remains visible.";
  } else if (truncated) {
    state = "truncated";
    reason = "The completed snapshot reached a declared source or normalization bound.";
  } else if (unknown) {
    state = "unknown";
    reason = !boundsKnown
      ? "The read completed, but its truncation boundary is not known."
      : !allReadsSuccessful
        ? "The read completion state is not known for every NOW source."
        : "The snapshot source is not identified.";
  }

  return Object.freeze({
    state,
    source: source || null,
    loadedAtISO: loadedAt,
    loadedAtMeaning: "device_read_completion",
    readStates: readState,
    loading,
    partial,
    stale,
    truncated,
    boundsKnown,
    complete: hasCompleteRead && allReadsSuccessful,
    reason,
    caveat: DEVICE_READ_CAVEAT
  });
}

function ambientFreshness(freshness) {
  if (freshness.state === "current" || freshness.state === "truncated") {
    return {
      state: "fresh",
      observedAt: freshness.loadedAtISO,
      reason: null
    };
  }
  if (freshness.loadedAtISO && ["stale", "partial"].includes(freshness.state)) {
    return {
      state: "stale",
      observedAt: freshness.loadedAtISO,
      reason: freshness.reason
    };
  }
  return {
    state: "unknown",
    observedAt: freshness.loadedAtISO,
    reason: freshness.reason
  };
}

function normalizePrioritySignals(snapshot, freshness) {
  const summary = snapshot?.attentionSummary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return normalizeNowAttentionSignals({}, { freshness: ambientFreshness(freshness) });
  }
  return normalizeNowAttentionSignals({
    attentionSummary: summary,
    stale: freshness.stale,
    partial: freshness.partial,
    truncated: freshness.truncated,
    loadedAtISO: freshness.loadedAtISO || undefined
  }, {
    freshness: ambientFreshness(freshness)
  });
}

function workflowTimingFor(snapshot, { nowISO, timeZone }) {
  return buildWorkflowTimingCues({
    attentionSummary: snapshot?.attentionSummary || { items: [] },
    quotes: safeArray(snapshot?.quotes),
    nowISO,
    timeZone,
    cueLimit: AMBIENT_NOW_PRIORITY_LIMIT,
    receiptLimit: AMBIENT_NOW_QUIET_PROGRESS_LIMIT
  });
}

function quietProgressFor(timing) {
  const receipts = timing.receipts
    .filter((receipt) => QUIET_PROGRESS_KINDS.has(receipt.kind))
    .slice(0, AMBIENT_NOW_QUIET_PROGRESS_LIMIT)
    .map((receipt) => Object.freeze({ ...receipt }));

  return {
    items: Object.freeze(receipts),
    candidateCount: timing.receiptPageInfo.candidateCount,
    truncated: timing.receiptPageInfo.truncated,
    sourceScanTruncated: timing.receiptPageInfo.sourceScanTruncated,
    evidenceBoundary: WORKFLOW_COMPLETION_RECEIPT_EVIDENCE_BOUNDARY
  };
}

function caughtUpContract({
  attentionItemCount,
  prioritiesAvailable,
  emptyAttentionAvailable,
  freshness
}) {
  if (attentionItemCount > 0) {
    return Object.freeze({
      eligible: false,
      reason: prioritiesAvailable
        ? "Tracked Workflow attention remains in this bounded snapshot."
        : "Tracked Workflow attention was supplied but could not be normalized safely."
    });
  }
  if (!emptyAttentionAvailable) {
    return Object.freeze({
      eligible: false,
      reason: "The empty Workflow attention source could not be normalized safely."
    });
  }
  if (freshness.state !== "current") {
    return Object.freeze({
      eligible: false,
      reason: `Caught-up status is withheld because snapshot freshness is ${freshness.state}.`
    });
  }
  return Object.freeze({
    eligible: true,
    reason: "No tracked Workflow attention is present in this complete bounded snapshot; other evidence domains remain separate."
  });
}

/**
 * Builds one deterministic Ambient NOW briefing from the existing bounded
 * commercial snapshot. `nowISO` must be supplied explicitly so quiet-progress
 * receipt ages never depend on an ambient clock.
 */
export function buildAmbientNowBriefing({
  snapshot = {},
  nowISO,
  timeZone = "UTC"
} = {}) {
  const summary = snapshot?.attentionSummary;
  const attentionItems = safeArray(summary?.items);
  const attentionItemCount = declaredAttentionCount(summary, attentionItems.length);
  const freshness = buildFreshness(snapshot, {
    attentionItemCount,
    returnedAttentionCount: attentionItems.length
  });
  const signals = normalizePrioritySignals(snapshot, freshness);
  const workflowTiming = workflowTimingFor(snapshot, { nowISO, timeZone });
  const signalsAvailable = signals.length > 0
    && signals.every((signal) => signal.id !== "now-attention:unavailable")
    && signals[0]?.id !== "now-attention:caught-up";
  const emptyAttentionAvailable = signals.length === 1
    && signals[0]?.id === "now-attention:caught-up"
    && signals[0]?.availability?.state === "available";
  const priorities = signalsAvailable
    ? signals.slice(0, AMBIENT_NOW_PRIORITY_LIMIT).map((signal, index) => Object.freeze({
        item: attentionItems[index],
        signal,
        timingCue: workflowTiming.cues.find((cue) => (
          cue.quoteId === attentionItems[index]?.quoteId
          && cue.type === attentionItems[index]?.type
        )) || null
      }))
    : [];
  const overflowCount = Math.max(0, attentionItemCount - priorities.length);
  const quietProgress = quietProgressFor(workflowTiming);
  const caughtUp = caughtUpContract({
    attentionItemCount,
    prioritiesAvailable: signalsAvailable,
    emptyAttentionAvailable,
    freshness
  });

  let state = "incomplete";
  if (priorities.length > 0) state = "priorities";
  else if (caughtUp.eligible) state = "caught_up";
  else if (freshness.state === "loading") state = "loading";
  else if (freshness.state === "unavailable") state = "unavailable";

  return Object.freeze({
    modelId: AMBIENT_NOW_BRIEFING_MODEL,
    state,
    priorities: Object.freeze(priorities),
    overflowCount,
    caughtUp,
    quietProgress: Object.freeze(quietProgress),
    freshness,
    bounds: Object.freeze({
      priorityLimit: AMBIENT_NOW_PRIORITY_LIMIT,
      returnedPriorityCount: priorities.length,
      attentionItemCount,
      returnedAttentionCount: attentionItems.length,
      attentionNormalizationLimit: AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.attentionItems,
      quietProgressLimit: AMBIENT_NOW_QUIET_PROGRESS_LIMIT,
      returnedQuietProgressCount: quietProgress.items.length,
      quietProgressCandidateCount: quietProgress.candidateCount,
      quietProgressTruncated: quietProgress.truncated,
      quietProgressSourceScanTruncated: quietProgress.sourceScanTruncated
    })
  });
}
