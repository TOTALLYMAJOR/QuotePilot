import { createAmbientSignal } from "./ambientContracts";

/**
 * Pure presentation adapters for existing QuotePilot evidence shapes.
 *
 * This module performs no reads, writes, pricing, inference, or authority
 * transition. It keeps each evidence domain separate, refuses malformed
 * source shapes, and emits only canonical AmbientSignal contracts.
 */
export const AMBIENT_SIGNAL_NORMALIZATION_MODEL = "ambient-signal-normalization-v1";

export const AMBIENT_SIGNAL_SOURCE_KINDS = Object.freeze([
  "now_attention",
  "proposal_completeness",
  "guided_selling",
  "margin",
  "decision_debt",
  "change_request",
  "cascade",
  "commercial_dependency"
]);

export const AMBIENT_SIGNAL_NORMALIZATION_BOUNDS = Object.freeze({
  attentionItems: 50,
  proposalCriteria: 32,
  guidedSellingRecommendations: 4,
  marginMissingItems: 12,
  decisionDebtItems: 100,
  decisionDebtDependencies: 64,
  changeRequestArtifacts: 32,
  changeRequestCandidates: 12,
  cascadeSteps: 16,
  commercialDependencies: 64,
  textCharacters: 500,
  messageCharacters: 4_000,
  identifierCharacters: 256,
  resolutionActions: 8
});

export const AMBIENT_SIGNAL_RESOLUTION_ACTIONS = Object.freeze({
  nowAttention: "open-workflow-item",
  proposalCompleteness: "open-priced-draft",
  guidedSelling: "open-priced-editor",
  margin: "inspect-pricing",
  decisionDebt: "open-workflow-item",
  changeRequest: "open-workflow-item",
  cascade: "reveal-supporting-evidence",
  commercialDependency: "reveal-supporting-evidence"
});

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DEBT_URGENCY_SEVERITY = Object.freeze({
  low: "info",
  medium: "attention",
  high: "warning",
  critical: "blocking"
});
const ATTENTION_TYPES = new Set([
  "change_request",
  "follow_up",
  "approval",
  "post_event_closeout",
  "unread_customer_reply",
  "anniversary_rebooking"
]);
const CASCADE_STATES = new Set(["done", "pending", "blocked"]);
const DEPENDENCY_CLASSES = new Set(["REVIEW", "STALE"]);
const GUIDED_SELLING_KINDS = new Set(["addon", "rental", "package"]);
const DEBT_URGENCIES = new Set(Object.keys(DEBT_URGENCY_SEVERITY));

class AmbientSignalSourceError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = "AmbientSignalSourceError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AmbientSignalSourceError(code, message);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value, label) {
  if (!isRecord(value)) fail("invalid_record", `${label} must be a plain object.`);
  Object.keys(value).forEach((key) => {
    if (FORBIDDEN_KEYS.has(key)) fail("unsafe_key", `${label} contains an unsafe key.`);
  });
  return value;
}

function text(value, label, { optional = false, maximum = AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.textCharacters } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return "";
    fail("missing_text", `${label} is required.`);
  }
  if (typeof value !== "string") fail("invalid_text", `${label} must be text.`);
  const normalized = value.trim();
  if (!normalized && !optional) fail("missing_text", `${label} is required.`);
  if (normalized.length > maximum) fail("text_bound", `${label} exceeds the presentation bound.`);
  return normalized;
}

function identifier(value, label) {
  return text(value, label, {
    maximum: AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.identifierCharacters
  });
}

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("invalid_number", `${label} must be a finite number.`);
  }
  return value;
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("invalid_integer", `${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") fail("invalid_boolean", `${label} must be boolean.`);
  return value;
}

function iso(value, label, { optional = false } = {}) {
  const normalized = text(value, label, { optional, maximum: 64 });
  if (!normalized && optional) return "";
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail("invalid_timestamp", `${label} must be an exact ISO timestamp.`);
  }
  return normalized;
}

function array(value, label) {
  if (!Array.isArray(value)) fail("invalid_array", `${label} must be an array.`);
  return value;
}

function boundedArray(value, label, maximum) {
  const source = array(value, label);
  return {
    values: source.slice(0, maximum),
    truncated: source.length > maximum,
    totalCount: source.length
  };
}

function stableId(prefix, source, index = 0) {
  const raw = String(source ?? "").trim().toLowerCase();
  const safe = raw
    .replace(/[^a-z0-9:_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 180);
  return `${prefix}:${safe || index + 1}`;
}

function validResolutionActions(value, fallback) {
  const source = value === undefined ? [fallback] : value;
  const bounded = boundedArray(
    source,
    "resolutionActionIds",
    AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.resolutionActions
  );
  if (bounded.truncated || bounded.values.length === 0) {
    fail("resolution_action_bound", "Resolution actions must contain one to eight ids.");
  }
  const normalized = bounded.values.map((entry, index) => identifier(entry, `resolutionActionIds[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    fail("duplicate_resolution", "Resolution action ids must be unique.");
  }
  return normalized;
}

function normalizeFreshness(source = {}, options = {}) {
  const explicit = options.freshness;
  if (explicit !== undefined) {
    const value = record(explicit, "freshness");
    const state = text(value.state, "freshness.state", { maximum: 16 });
    if (!["fresh", "stale", "unknown"].includes(state)) {
      fail("invalid_freshness", "Freshness state is unsupported.");
    }
    const observedAt = iso(value.observedAt, "freshness.observedAt", { optional: true });
    const reason = text(value.reason, "freshness.reason", { optional: true });
    if (state === "fresh" && !observedAt) fail("freshness_evidence", "Fresh evidence requires an observation time.");
    if (state === "stale" && (!observedAt || !reason)) {
      fail("freshness_evidence", "Stale evidence requires an observation time and reason.");
    }
    if (state === "unknown" && !reason) fail("freshness_reason", "Unknown freshness requires a reason.");
    return { state, observedAt: observedAt || null, reason: reason || null };
  }

  const observedCandidate = options.observedAtISO
    ?? source.observedAtISO
    ?? source.snapshotAtISO
    ?? source.loadedAtISO;
  const observedAt = observedCandidate
    ? iso(observedCandidate, "source observation time", { optional: true })
    : "";
  const stale = options.stale === true || source.stale === true;
  if (stale && observedAt) {
    return {
      state: "stale",
      observedAt,
      reason: text(
        options.staleReason || source.staleReason || "The retained source is marked stale.",
        "stale reason"
      )
    };
  }
  if ((options.fresh === true || source.stale === false) && observedAt) {
    return { state: "fresh", observedAt, reason: null };
  }
  return {
    state: "unknown",
    observedAt: observedAt || null,
    reason: stale
      ? "The source is marked stale, but no exact observation time was supplied."
      : "The source does not declare a freshness guarantee."
  };
}

function evidenceQuality(source = {}, options = {}, intrinsic = {}) {
  return {
    stale: options.stale === true || source.stale === true || intrinsic.stale === true,
    truncated: options.truncated === true || source.truncated === true || intrinsic.truncated === true,
    partial: options.partial === true || source.partial === true || intrinsic.partial === true
  };
}

function availabilityFor(quality, unavailableReason = "") {
  if (unavailableReason) return { state: "unavailable", reason: unavailableReason };
  const qualifiers = [
    quality.truncated ? "Additional evidence may exist outside the bounded source." : "",
    quality.partial ? "Some source evidence is incomplete." : ""
  ].filter(Boolean).join(" ");
  if (quality.stale) {
    return {
      state: "stale",
      reason: `The retained evidence is stale.${qualifiers ? ` ${qualifiers}` : ""}`
    };
  }
  if (quality.truncated) {
    return {
      state: "truncated",
      reason: `The source reached a declared or presentation bound.${qualifiers ? ` ${qualifiers}` : ""}`
    };
  }
  if (quality.partial) {
    return { state: "partial", reason: "The source contains incomplete evidence." };
  }
  return { state: "available", reason: null };
}

function provenance(source, authority, quality, extra = {}) {
  return {
    modelId: AMBIENT_SIGNAL_NORMALIZATION_MODEL,
    source,
    authority,
    quality: { ...quality },
    ...extra
  };
}

function canonicalSignal({
  id,
  claim,
  evidence,
  availability,
  severity,
  consequence,
  freshness,
  resolutionActionIds
}) {
  return createAmbientSignal({
    id,
    claim,
    evidence,
    availability,
    severity,
    consequence,
    freshness,
    resolutionActionIds
  });
}

function unavailableSignal({ id, claim, reason, consequence, actionId }) {
  return canonicalSignal({
    id,
    claim,
    evidence: [],
    availability: { state: "unavailable", reason },
    severity: "attention",
    consequence,
    freshness: {
      state: "unknown",
      observedAt: null,
      reason: "No usable evidence was normalized."
    },
    resolutionActionIds: [actionId]
  });
}

function failClosed(adapter, fallback) {
  try {
    return Object.freeze(adapter());
  } catch (error) {
    const code = error instanceof AmbientSignalSourceError ? error.code : "invalid_source";
    return Object.freeze([unavailableSignal({
      ...fallback,
      reason: `${fallback.reason} (${code})`
    })]);
  }
}

function attentionClaim(item) {
  if (item.type === "change_request") {
    if (item.state === "invalid") return "Customer change-request evidence is incomplete.";
    if (item.state === "acknowledged") return "An acknowledged customer change request remains unresolved.";
    return "A customer change request needs review.";
  }
  if (item.type === "follow_up") {
    return item.state === "overdue"
      ? "A quote follow-up is overdue."
      : "A quote follow-up is due today.";
  }
  if (item.type === "approval") return "An approval decision is waiting.";
  if (item.type === "post_event_closeout") {
    if (["blocked_source", "blocked_configuration"].includes(item.state)) {
      return "A post-event closeout is blocked by recorded evidence.";
    }
    return item.state === "overdue"
      ? "A post-event closeout is overdue."
      : "A post-event closeout is due today.";
  }
  if (item.type === "unread_customer_reply") {
    return "A customer reply is waiting for staff review.";
  }
  return "A repeat-event opportunity is available for source review.";
}

function attentionSeverity(item) {
  if (
    item.state === "invalid"
    || item.state === "blocked_source"
    || item.state === "blocked_configuration"
  ) return "blocking";
  if (item.state === "overdue") return "warning";
  return item.type === "anniversary_rebooking" ? "info" : "attention";
}

function normalizeAttentionItem(item, index) {
  const value = record(item, `attention.items[${index}]`);
  const type = text(value.type, `attention.items[${index}].type`, { maximum: 64 });
  if (!ATTENTION_TYPES.has(type)) fail("unsupported_attention", "Workflow attention type is unsupported.");
  const state = text(value.state, `attention.items[${index}].state`, { maximum: 64 });
  const id = identifier(value.id, `attention.items[${index}].id`);
  const quoteId = identifier(value.quoteId, `attention.items[${index}].quoteId`);
  const dateISO = text(value.dateISO, `attention.items[${index}].dateISO`, {
    optional: true,
    maximum: 64
  });
  const daysOverdue = value.daysOverdue === undefined
    ? null
    : integer(value.daysOverdue, `attention.items[${index}].daysOverdue`, 0, 100_000);
  const sourceRequestId = text(value.sourceRequestId, `attention.items[${index}].sourceRequestId`, {
    optional: true,
    maximum: AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.identifierCharacters
  });
  const optionalId = (field) => text(value[field], `attention.items[${index}].${field}`, {
    optional: true,
    maximum: AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.identifierCharacters
  });
  const pendingRequestIds = value.pendingRequests === undefined
    ? []
    : boundedArray(
        value.pendingRequests,
        `attention.items[${index}].pendingRequests`,
        AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.resolutionActions
      ).values.map((entry, requestIndex) => identifier(
        record(entry, `attention.items[${index}].pendingRequests[${requestIndex}]`).id,
        `attention.items[${index}].pendingRequests[${requestIndex}].id`
      ));
  if (type === "approval" && pendingRequestIds.length === 0) {
    fail("approval_evidence", "Approval attention requires at least one pending request identity.");
  }
  return {
    id,
    type,
    state,
    quoteId,
    dateISO,
    daysOverdue,
    sourceRequestId,
    customerId: optionalId("customerId"),
    attentionId: optionalId("attentionId"),
    messageId: optionalId("messageId"),
    closeoutId: optionalId("closeoutId"),
    pendingRequestIds
  };
}

export function normalizeNowAttentionSignals(source = {}, options = {}) {
  const fallback = {
    id: "now-attention:unavailable",
    claim: "Workflow attention is unavailable.",
    reason: "The bounded Workflow attention source could not be normalized.",
    consequence: "No conclusion about current Workflow attention can be drawn from this source.",
    actionId: AMBIENT_SIGNAL_RESOLUTION_ACTIONS.nowAttention
  };
  return failClosed(() => {
    const container = record(source, "attention source");
    const summary = container.attentionSummary === undefined
      ? container
      : record(container.attentionSummary, "attentionSummary");
    const bounded = boundedArray(
      summary.items,
      "attention.items",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.attentionItems
    );
    const declaredCount = summary.itemCount === undefined
      ? bounded.totalCount
      : integer(summary.itemCount, "attention.itemCount", 0, 100_000);
    if (declaredCount < bounded.totalCount) {
      fail("attention_count_mismatch", "Workflow attention count is smaller than its supplied items.");
    }
    const intrinsic = {
      truncated: bounded.truncated || declaredCount > bounded.values.length,
      partial: false
    };
    const quality = evidenceQuality(container, options, intrinsic);
    const availability = availabilityFor(quality);
    const freshness = normalizeFreshness(container, options);
    const actions = validResolutionActions(
      options.resolutionActionIds,
      AMBIENT_SIGNAL_RESOLUTION_ACTIONS.nowAttention
    );
    const normalized = bounded.values.map(normalizeAttentionItem);
    if (normalized.length === 0) {
      return [canonicalSignal({
        id: "now-attention:caught-up",
        claim: quality.truncated
          ? "No Workflow attention appears in this bounded snapshot."
          : "No tracked Workflow attention is present in this snapshot.",
        evidence: [{
          returnedCount: 0,
          declaredCount,
          provenance: provenance(
            "workflow_attention_summary",
            "presentation_of_recorded_workflow_evidence",
            quality
          ),
          doNothing: "No action is required by this bounded source; this is not an operational-completion claim."
        }],
        availability,
        severity: "info",
        consequence: quality.truncated
          ? "Additional Workflow records may remain outside this bounded snapshot."
          : "No Workflow resolution is currently identified by this source; other evidence domains remain separate.",
        freshness,
        resolutionActionIds: actions
      })];
    }
    return normalized.map((item, index) => canonicalSignal({
      id: stableId("now-attention", item.id, index),
      claim: attentionClaim(item),
      evidence: [{
        itemId: item.id,
        quoteId: item.quoteId,
        type: item.type,
        state: item.state,
        dateISO: item.dateISO || null,
        daysOverdue: item.daysOverdue,
        sourceRequestId: item.sourceRequestId || null,
        customerId: item.customerId || null,
        attentionId: item.attentionId || null,
        messageId: item.messageId || null,
        closeoutId: item.closeoutId || null,
        pendingRequestIds: item.pendingRequestIds,
        provenance: provenance(
          "workflow_attention_summary",
          "presentation_of_recorded_workflow_evidence",
          quality
        ),
        doNothing: "The recorded Workflow item remains unresolved; this signal does not change the quote or mark customer activity read."
      }],
      availability,
      severity: attentionSeverity(item),
      consequence: item.type === "unread_customer_reply"
        ? "The reply remains awaiting staff review; this does not establish delivery, read receipt, presence, or response intent."
        : "The recorded Workflow item remains open until its existing role-gated resolution records an outcome.",
      freshness,
      resolutionActionIds: actions
    }));
  }, fallback);
}

export function normalizeProposalCompletenessSignals(source = {}, options = {}) {
  const fallback = {
    id: "proposal-completeness:unavailable",
    claim: "Proposal completeness is unavailable.",
    reason: "The proposal-completeness source could not be normalized.",
    consequence: "No proposal-completeness percentage or readiness conclusion can be trusted from this source.",
    actionId: AMBIENT_SIGNAL_RESOLUTION_ACTIONS.proposalCompleteness
  };
  return failClosed(() => {
    const value = record(source, "proposal completeness");
    const score = integer(value.score, "proposal completeness score", 0, 100);
    const complete = boolean(value.complete, "proposal completeness complete");
    const criteria = boundedArray(
      value.criteria,
      "proposal completeness criteria",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.proposalCriteria
    );
    if (criteria.truncated) fail("criteria_bound", "Proposal criteria exceed the supported model bound.");
    const normalizedCriteria = criteria.values.map((entry, index) => {
      const criterion = record(entry, `proposal criteria[${index}]`);
      return {
        id: identifier(criterion.id, `proposal criteria[${index}].id`),
        label: text(criterion.label, `proposal criteria[${index}].label`),
        points: integer(criterion.points, `proposal criteria[${index}].points`, 0, 100),
        passed: boolean(criterion.passed, `proposal criteria[${index}].passed`)
      };
    });
    if (new Set(normalizedCriteria.map((criterion) => criterion.id)).size !== normalizedCriteria.length) {
      fail("duplicate_criterion", "Proposal criteria ids must be unique.");
    }
    const expectedScore = normalizedCriteria.reduce(
      (sum, criterion) => sum + (criterion.passed ? criterion.points : 0),
      0
    );
    const totalPoints = normalizedCriteria.reduce((sum, criterion) => sum + criterion.points, 0);
    if (totalPoints !== 100 || expectedScore !== score || complete !== (score === 100)) {
      fail("inconsistent_completeness", "Proposal completeness fields are inconsistent.");
    }
    const gapIds = normalizedCriteria.filter((criterion) => !criterion.passed).map((criterion) => criterion.id);
    const suppliedGaps = boundedArray(
      value.gaps,
      "proposal completeness gaps",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.proposalCriteria
    );
    if (suppliedGaps.truncated) fail("gap_bound", "Proposal gaps exceed the supported model bound.");
    const normalizedGaps = suppliedGaps.values.map((entry, index) => {
      const gap = record(entry, `proposal gaps[${index}]`);
      return {
        id: identifier(gap.id, `proposal gaps[${index}].id`),
        label: text(gap.label, `proposal gaps[${index}].label`),
        points: integer(gap.points, `proposal gaps[${index}].points`, 0, 100)
      };
    });
    const expectedGaps = normalizedCriteria.filter((criterion) => !criterion.passed);
    if (
      JSON.stringify(normalizedGaps.map((gap) => gap.id)) !== JSON.stringify(gapIds)
      || normalizedGaps.some((gap, index) => (
        gap.label !== expectedGaps[index]?.label || gap.points !== expectedGaps[index]?.points
      ))
    ) {
      fail("inconsistent_gaps", "Proposal gaps do not match the failed criteria.");
    }
    const quality = evidenceQuality(value, options);
    const freshness = normalizeFreshness(value, options);
    const status = record(value.status, "proposal completeness status");
    const statusId = identifier(status.id, "proposal completeness status id");
    const statusLabel = text(status.label, "proposal completeness status label");
    const expectedStatusId = score === 100 ? "ready" : score >= 80 ? "review" : "needs_details";
    if (statusId !== expectedStatusId) {
      fail("inconsistent_status", "Proposal completeness status does not match its percentage.");
    }
    const actions = validResolutionActions(
      options.resolutionActionIds,
      AMBIENT_SIGNAL_RESOLUTION_ACTIONS.proposalCompleteness
    );
    return [canonicalSignal({
      id: "proposal-completeness:current",
      claim: complete
        ? "The proposal is 100% complete against its existing criteria."
        : `The proposal is ${score}% complete; ${normalizedGaps.length} ${normalizedGaps.length === 1 ? "criterion remains" : "criteria remain"}.`,
      evidence: [{
        metric: "proposal_completeness",
        completenessPercent: score,
        complete,
        status: { id: statusId, label: statusLabel },
        criteriaCount: normalizedCriteria.length,
        completedCriteriaCount: normalizedCriteria.filter((criterion) => criterion.passed).length,
        gaps: normalizedGaps,
        provenance: provenance(
          "buildProposalReadiness",
          "deterministic_proposal_criteria",
          quality,
          { scope: "proposal_only" }
        ),
        doNothing: complete
          ? "The proposal remains unchanged; other commercial, customer, and operational evidence still governs its own state."
          : "The missing proposal fields remain unresolved and the saved quote remains unchanged."
      }],
      availability: availabilityFor(quality),
      severity: complete ? "info" : "attention",
      consequence: complete
        ? "All completeness criteria are present; this does not establish pricing authorization, customer acceptance, payment, booking, or operational readiness."
        : "The proposal may omit fields required by this completeness model; no event-wide readiness score is implied.",
      freshness,
      resolutionActionIds: actions
    })];
  }, fallback);
}

export function normalizeGuidedSellingSignals(source = [], options = {}) {
  const fallback = {
    id: "guided-selling:unavailable",
    claim: "Guided-selling recommendations are unavailable.",
    reason: "The deterministic guided-selling source could not be normalized.",
    consequence: "No recommendation should be applied from this source.",
    actionId: AMBIENT_SIGNAL_RESOLUTION_ACTIONS.guidedSelling
  };
  return failClosed(() => {
    const container = Array.isArray(source) ? { recommendations: source } : record(source, "guided selling source");
    if (container.enabled === false) {
      return [unavailableSignal({
        ...fallback,
        reason: "The source reports that guided selling is disabled for this draft."
      })];
    }
    const bounded = boundedArray(
      container.recommendations,
      "guided selling recommendations",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.guidedSellingRecommendations
    );
    const quality = evidenceQuality(container, options, { truncated: bounded.truncated });
    const availability = availabilityFor(quality);
    const freshness = normalizeFreshness(container, options);
    const actions = validResolutionActions(
      options.resolutionActionIds,
      AMBIENT_SIGNAL_RESOLUTION_ACTIONS.guidedSelling
    );
    if (bounded.values.length === 0) {
      return [canonicalSignal({
        id: "guided-selling:none-supplied",
        claim: "No guided-selling recommendation is present in the supplied source.",
        evidence: [{
          recommendationCount: 0,
          provenance: provenance("buildUpsellRecommendations", "deterministic_advisory", quality),
          doNothing: "The draft remains unchanged."
        }],
        availability,
        severity: "info",
        consequence: "No draft mutation is proposed; this does not establish that every commercial option was evaluated.",
        freshness,
        resolutionActionIds: actions
      })];
    }
    return bounded.values.map((entry, index) => {
      const recommendation = record(entry, `guided selling recommendations[${index}]`);
      const kind = text(recommendation.kind, `guided selling recommendations[${index}].kind`, { maximum: 24 });
      if (!GUIDED_SELLING_KINDS.has(kind)) fail("unsupported_recommendation", "Guided-selling kind is unsupported.");
      const targetId = identifier(recommendation.id, `guided selling recommendations[${index}].id`);
      const key = identifier(recommendation.key, `guided selling recommendations[${index}].key`);
      const label = text(recommendation.label, `guided selling recommendations[${index}].label`);
      const reason = text(recommendation.reason, `guided selling recommendations[${index}].reason`);
      const impact = text(recommendation.impact, `guided selling recommendations[${index}].impact`);
      return canonicalSignal({
        id: stableId("guided-selling", key, index),
        claim: label,
        evidence: [{
          recommendationKey: key,
          kind,
          targetId,
          basis: reason,
          impact,
          provenance: provenance("buildUpsellRecommendations", "deterministic_advisory", quality),
          doNothing: "The current draft selection and saved quote remain unchanged."
        }],
        availability,
        severity: "info",
        consequence: "Taking this recommendation may stage a draft selection; the trusted save path still re-prices and versions the quote authoritatively.",
        freshness,
        resolutionActionIds: actions
      });
    });
  }, fallback);
}

export function normalizeMarginSignals(source, options = {}) {
  const fallback = {
    id: "margin:unavailable",
    claim: "Margin evidence is unavailable.",
    reason: "The staff-only margin presentation could not be normalized.",
    consequence: "No margin percentage or target conclusion should be presented from this source.",
    actionId: AMBIENT_SIGNAL_RESOLUTION_ACTIONS.margin
  };
  return failClosed(() => {
    const margin = record(source, "margin presentation");
    const quality = evidenceQuality(margin, options);
    const freshness = normalizeFreshness(margin, options);
    const actions = validResolutionActions(
      options.resolutionActionIds,
      AMBIENT_SIGNAL_RESOLUTION_ACTIONS.margin
    );
    if (margin.available === false) {
      const missing = boundedArray(
        margin.missing,
        "margin missing cost coverage",
        AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.marginMissingItems
      );
      const missingCount = integer(margin.missingCount, "margin missingCount", missing.totalCount, 10_000);
      const normalizedMissing = missing.values.map((entry, index) => text(entry, `margin missing[${index}]`));
      const unavailableQuality = evidenceQuality(margin, options, {
        truncated: missing.truncated || missingCount > normalizedMissing.length
      });
      return [canonicalSignal({
        id: "margin:cost-coverage-missing",
        claim: "Margin is unavailable because recorded cost coverage is incomplete.",
        evidence: [{
          missingCount,
          missing: normalizedMissing,
          provenance: provenance("buildMarginPresentation", "staff_only_recorded_cost_advisory", unavailableQuality),
          doNothing: "No cost is estimated and no saved commercial value changes."
        }],
        availability: {
          state: "unavailable",
          reason: "One or more selected revenue lines lack the tenant-recorded cost evidence required by the margin model."
        },
        severity: "attention",
        consequence: "No margin or target-gap conclusion is trusted until the named cost evidence is recorded.",
        freshness,
        resolutionActionIds: actions
      })];
    }
    if (margin.available !== true) fail("margin_availability", "Margin availability must be explicit.");
    const revenue = finite(margin.revenue, "margin revenue");
    const cost = finite(margin.cost, "margin cost");
    const marginPct = finite(margin.marginPct, "margin percentage");
    if (
      !(revenue > 0)
      || cost < 0
      || marginPct > 1
      || Math.abs(((revenue - cost) / revenue) - marginPct) > 1e-9
    ) {
      fail("margin_formula", "Margin values are inconsistent with the recorded-cost formula.");
    }
    const target = margin.target === null || margin.target === undefined
      ? null
      : finite(margin.target, "margin target");
    if (target !== null && (target < 0 || target > 1)) {
      fail("margin_target", "Margin target must be a ratio between zero and one.");
    }
    const belowTarget = target !== null && marginPct < target;
    const pct = (value) => `${(value * 100).toFixed(1)}%`;
    return [canonicalSignal({
      id: "margin:current",
      claim: belowTarget
        ? `Recorded-cost margin is ${pct(marginPct)}, ${pct(target - marginPct)} below target.`
        : target === null
          ? `Recorded-cost margin is ${pct(marginPct)}; no target is supplied.`
          : `Recorded-cost margin is ${pct(marginPct)} and meets the ${pct(target)} target.`,
      evidence: [{
        revenue,
        cost,
        marginPct,
        target,
        targetGap: target === null ? null : target - marginPct,
        exclusions: ["travel", "tax"],
        audience: "staff_only",
        provenance: provenance("buildMarginPresentation", "staff_only_recorded_cost_advisory", quality),
        doNothing: "The current price and recorded costs remain unchanged."
      }],
      availability: availabilityFor(quality),
      severity: belowTarget ? "warning" : "info",
      consequence: belowTarget
        ? "The quote remains below the tenant-recorded target at the current price and recorded costs; no price change is automatic."
        : "This confirms only the staff margin model; customer-facing totals and authoritative pricing remain separate.",
      freshness,
      resolutionActionIds: actions
    })];
  }, fallback);
}

function decisionDebtSnapshot(source) {
  const container = record(source, "Decision Debt source");
  if (container.loading === true && !container.snapshot) {
    fail("read_pending", "Decision Debt read is still pending.");
  }
  if (container.error && !container.snapshot) fail("read_error", "Decision Debt read has no retained snapshot.");
  const snapshot = container.schemaVersion === "decision-debt-snapshot-v1"
    ? container
    : record(container.snapshot, "Decision Debt snapshot");
  if (
    snapshot.schemaVersion !== "decision-debt-snapshot-v1"
    || snapshot.formulaVersion !== "decision-debt-score-v1"
    || snapshot.authority !== "server_derived"
    || snapshot.predictive !== false
  ) {
    fail("unsupported_debt_authority", "Decision Debt authority or formula is unsupported.");
  }
  return { container, snapshot };
}

function normalizeDebtItem(entry, index) {
  const item = record(entry, `Decision Debt items[${index}]`);
  const scoreState = text(item.scoreState, `Decision Debt items[${index}].scoreState`, { maximum: 16 }).toUpperCase();
  if (!["KNOWN", "UNKNOWN"].includes(scoreState)) fail("debt_score_state", "Decision Debt score state is unsupported.");
  const urgency = item.urgency === null || item.urgency === undefined
    ? null
    : text(item.urgency, `Decision Debt items[${index}].urgency`, { maximum: 16 }).toLowerCase();
  const score = item.score === null || item.score === undefined
    ? null
    : integer(item.score, `Decision Debt items[${index}].score`, 0, 100);
  const rawScore = item.rawScore === null || item.rawScore === undefined
    ? null
    : integer(item.rawScore, `Decision Debt items[${index}].rawScore`, 0, 625);
  if (scoreState === "KNOWN" && (score === null || rawScore === null || !DEBT_URGENCIES.has(urgency))) {
    fail("debt_known_evidence", "Known Decision Debt priority requires score and urgency evidence.");
  }
  if (scoreState === "UNKNOWN" && (score !== null || rawScore !== null || urgency !== null)) {
    fail("debt_unknown_evidence", "Unknown Decision Debt priority must not carry score or urgency.");
  }
  const dependencies = boundedArray(
    item.affectedNodeIds,
    `Decision Debt items[${index}].affectedNodeIds`,
    AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.decisionDebtDependencies
  );
  if (dependencies.truncated) fail("debt_dependency_bound", "Decision Debt dependencies exceed their declared bound.");
  const affectedNodeIds = dependencies.values.map((nodeId, nodeIndex) => text(
    nodeId,
    `Decision Debt items[${index}].affectedNodeIds[${nodeIndex}]`,
    { maximum: 160 }
  ));
  const affectedDependencyCount = integer(
    item.affectedDependencyCount,
    `Decision Debt items[${index}].affectedDependencyCount`,
    1,
    AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.decisionDebtDependencies
  );
  if (affectedDependencyCount !== affectedNodeIds.length) {
    fail("debt_dependency_count", "Decision Debt dependency count is inconsistent.");
  }
  const commercialExposureCents = item.commercialExposureCents === null
    ? null
    : integer(item.commercialExposureCents, `Decision Debt items[${index}].commercialExposureCents`, 0, 1_000_000_000_000);
  if (
    (scoreState === "KNOWN" && commercialExposureCents === null)
    || (scoreState === "UNKNOWN" && commercialExposureCents !== null)
  ) {
    fail("debt_exposure_state", "Decision Debt exposure conflicts with its score state.");
  }
  if (scoreState === "KNOWN") {
    const expectedScore = Math.min(100, Math.max(0, Math.round((rawScore / 625) * 100)));
    const expectedUrgency = expectedScore >= 80
      ? "critical"
      : expectedScore >= 50
        ? "high"
        : expectedScore >= 25
          ? "medium"
          : "low";
    if (score !== expectedScore || urgency !== expectedUrgency) {
      fail("debt_priority_formula", "Decision Debt score, raw score, and urgency are inconsistent.");
    }
  }
  const resolutionState = text(item.resolutionState, `Decision Debt items[${index}].resolutionState`, {
    optional: true,
    maximum: 32
  }) || "unresolved";
  if (resolutionState !== "unresolved") {
    fail("debt_resolution_state", "Decision Debt snapshots may normalize only unresolved items.");
  }
  return {
    id: identifier(item.id, `Decision Debt items[${index}].id`),
    quoteId: identifier(item.quoteId, `Decision Debt items[${index}].quoteId`),
    sourceRevisionId: identifier(item.sourceRevisionId, `Decision Debt items[${index}].sourceRevisionId`),
    decisionId: identifier(item.decisionId, `Decision Debt items[${index}].decisionId`),
    label: text(item.label, `Decision Debt items[${index}].label`),
    resolutionState,
    daysUntilLock: integer(item.daysUntilLock, `Decision Debt items[${index}].daysUntilLock`, -365, 730),
    affectedNodeIds,
    affectedDependencyCount,
    commercialExposureCents,
    scoreState,
    score,
    rawScore,
    urgency
  };
}

export function normalizeDecisionDebtSignals(source = {}, options = {}) {
  const fallback = {
    id: "decision-debt:unavailable",
    claim: "Decision Debt evidence is unavailable.",
    reason: "No supported retained server-derived Decision Debt snapshot could be normalized.",
    consequence: "No Decision Debt priority or dependency conclusion should be presented from this source.",
    actionId: AMBIENT_SIGNAL_RESOLUTION_ACTIONS.decisionDebt
  };
  return failClosed(() => {
    const { container, snapshot } = decisionDebtSnapshot(source);
    const bounds = record(snapshot.bounds, "Decision Debt bounds");
    const items = boundedArray(
      snapshot.items,
      "Decision Debt items",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.decisionDebtItems
    );
    const returnedCount = integer(bounds.returnedCount, "Decision Debt returnedCount", 0, AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.decisionDebtItems);
    const eligibleCount = integer(bounds.eligibleCount, "Decision Debt eligibleCount", returnedCount, 500);
    const truncated = boolean(bounds.truncated, "Decision Debt bounds.truncated");
    if (returnedCount !== items.totalCount || truncated !== (eligibleCount > returnedCount) || items.truncated) {
      fail("debt_bounds", "Decision Debt bounds are inconsistent.");
    }
    const quality = evidenceQuality(container, options, {
      stale: container.stale === true,
      truncated,
      partial: false
    });
    const freshness = normalizeFreshness({
      ...container,
      observedAtISO: snapshot.observedAtISO
    }, options);
    const actions = validResolutionActions(
      options.resolutionActionIds,
      AMBIENT_SIGNAL_RESOLUTION_ACTIONS.decisionDebt
    );
    const normalized = items.values.map(normalizeDebtItem);
    const graph = record(snapshot.graph, "Decision Debt graph");
    const graphId = identifier(graph.graphId, "Decision Debt graph id");
    const graphVersion = identifier(graph.graphVersion, "Decision Debt graph version");
    const snapshotDigest = text(snapshot.snapshotDigest, "Decision Debt snapshot digest", { maximum: 64 });
    if (!/^[a-f0-9]{64}$/u.test(snapshotDigest)) {
      fail("debt_snapshot_digest", "Decision Debt snapshot digest is invalid.");
    }
    const commonProvenance = provenance(
      "getDecisionDebtSnapshot",
      "server_derived_non_predictive",
      quality,
      {
        formulaVersion: snapshot.formulaVersion,
        graphId,
        graphVersion,
        snapshotDigest,
        observedAtISO: iso(snapshot.observedAtISO, "Decision Debt observedAtISO"),
        predictive: false,
        bounds: { returnedCount, eligibleCount, truncated }
      }
    );
    if (normalized.length === 0) {
      return [canonicalSignal({
        id: "decision-debt:none-in-bounds",
        claim: "No unresolved Decision Debt appears in this bounded server snapshot.",
        evidence: [{
          returnedCount,
          eligibleCount,
          provenance: commonProvenance,
          doNothing: "No decision or dependency is changed by this empty bounded result."
        }],
        availability: availabilityFor(quality),
        severity: "info",
        consequence: "This bounded result is not payment, booking, acceptance, completion, or customer-contact evidence.",
        freshness,
        resolutionActionIds: actions
      })];
    }
    return normalized.map((item, index) => {
      const priorityUnknown = item.scoreState === "UNKNOWN";
      const itemQuality = { ...quality, partial: quality.partial || priorityUnknown };
      const priorityEvidence = priorityUnknown
        ? { scoreState: "UNKNOWN" }
        : {
            scoreState: "KNOWN",
            score: item.score,
            rawScore: item.rawScore,
            urgency: item.urgency
          };
      return canonicalSignal({
        id: stableId("decision-debt", item.id, index),
        claim: priorityUnknown
          ? `${item.label} remains unresolved; priority is unavailable.`
          : `${item.label} remains unresolved with ${item.urgency} deterministic priority.`,
        evidence: [{
          debtId: item.id,
          quoteId: item.quoteId,
          sourceRevisionId: item.sourceRevisionId,
          decisionId: item.decisionId,
          resolutionState: item.resolutionState,
          daysUntilLock: item.daysUntilLock,
          affectedNodeIds: item.affectedNodeIds,
          affectedDependencyCount: item.affectedDependencyCount,
          commercialExposureCents: item.commercialExposureCents,
          ...priorityEvidence,
          provenance: {
            ...commonProvenance,
            quality: itemQuality
          },
          doNothing: "The unresolved decision and its recorded dependency exposure remain unchanged; this signal performs no mutation."
        }],
        availability: availabilityFor(itemQuality),
        severity: priorityUnknown ? "attention" : DEBT_URGENCY_SEVERITY[item.urgency],
        consequence: priorityUnknown
          ? "Commercial exposure is unavailable, so no score or urgency is inferred."
          : "Recorded dependencies remain exposed until the decision is resolved; the score is deterministic and not predictive AI.",
        freshness,
        resolutionActionIds: actions
      });
    });
  }, fallback);
}

function normalizeChangeProposal(entry, index) {
  const proposal = record(entry, `change request proposals[${index}]`);
  const kind = text(proposal.kind, `change request proposals[${index}].kind`, { maximum: 48 });
  const normalized = {
    id: identifier(proposal.id, `change request proposals[${index}].id`),
    kind,
    title: text(proposal.title, `change request proposals[${index}].title`),
    clause: text(proposal.clause, `change request proposals[${index}].clause`)
  };
  if (kind === "set_guests") {
    return { ...normalized, value: integer(proposal.value, "change-request guest count", 1, 4_000) };
  }
  if (kind === "set_hours") {
    return { ...normalized, value: finite(proposal.value, "change-request event hours") };
  }
  if (kind === "set_style") {
    return { ...normalized, value: text(proposal.value, "change-request service style", { maximum: 80 }) };
  }
  if (kind === "set_package") {
    const packageId = identifier(
      proposal.packageId || proposal.value,
      "change-request package id"
    );
    return {
      ...normalized,
      value: packageId,
      packageId,
      packageName: text(proposal.packageName, "change-request package name", { maximum: 160 })
    };
  }
  if (kind === "add_staff") {
    const field = text(proposal.field, "change-request staffing field", { maximum: 24 });
    if (!["servers", "chefs", "bartenders"].includes(field)) {
      fail("change_staff_field", "Change-request staffing field is unsupported.");
    }
    return {
      ...normalized,
      field,
      count: integer(proposal.count, "change-request staffing count", 1, 100)
    };
  }
  const itemReference = (value, label) => {
    const item = record(value, label);
    const itemType = text(item.itemType, `${label}.itemType`, { maximum: 32 });
    if (!["addons", "rentals", "menuItems"].includes(itemType)) {
      fail("change_item_type", "Change-request item type is unsupported.");
    }
    return {
      itemType,
      itemId: identifier(item.itemId, `${label}.itemId`),
      itemName: text(item.itemName, `${label}.itemName`)
    };
  };
  if (kind === "add_item" || kind === "remove_item") {
    return { ...normalized, ...itemReference(proposal, "change-request item") };
  }
  if (kind === "swap_item") {
    return {
      ...normalized,
      remove: itemReference(proposal.remove, "change-request removed item"),
      add: itemReference(proposal.add, "change-request added item")
    };
  }
  fail("change_proposal_kind", "Change-request proposal kind is unsupported.");
}

function normalizeChangeAmbiguity(entry, index) {
  const ambiguity = record(entry, `change request ambiguities[${index}]`);
  const candidates = boundedArray(
    ambiguity.candidates,
    `change request ambiguities[${index}].candidates`,
    AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.changeRequestCandidates
  );
  if (candidates.truncated) fail("ambiguity_bound", "Change-request ambiguity candidates exceed the safe bound.");
  return {
    id: identifier(ambiguity.id, `change request ambiguities[${index}].id`),
    clause: text(ambiguity.clause, `change request ambiguities[${index}].clause`),
    verb: text(ambiguity.verb, `change request ambiguities[${index}].verb`, { maximum: 32 }),
    query: text(ambiguity.query, `change request ambiguities[${index}].query`),
    candidates: candidates.values.map((candidate, candidateIndex) => {
      const value = record(candidate, `change request ambiguities[${index}].candidates[${candidateIndex}]`);
      return {
        itemType: text(value.itemType, "change-request candidate itemType", { maximum: 32 }),
        itemId: identifier(value.itemId, "change-request candidate itemId"),
        itemName: text(value.itemName, "change-request candidate itemName")
      };
    })
  };
}

export function normalizeChangeRequestSignals(source = {}, options = {}) {
  const fallback = {
    id: "change-request:unavailable",
    claim: "Customer change-request interpretation is unavailable.",
    reason: "The deterministic change-request parse could not be normalized.",
    consequence: "No customer-request clause should be staged or described as resolved from this source.",
    actionId: AMBIENT_SIGNAL_RESOLUTION_ACTIONS.changeRequest
  };
  return failClosed(() => {
    const value = record(source, "change-request parse");
    if (value.modelId !== "change-request-parse-v1") {
      fail("change_request_model", "Change-request parse model is unsupported.");
    }
    const message = text(value.message, "change-request message", {
      optional: true,
      maximum: AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.messageCharacters
    });
    const proposalBound = boundedArray(
      value.proposals,
      "change request proposals",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.changeRequestArtifacts
    );
    const ambiguityBound = boundedArray(
      value.ambiguities,
      "change request ambiguities",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.changeRequestArtifacts
    );
    const unparsedBound = boundedArray(
      value.unparsedClauses,
      "change request unparsed clauses",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.changeRequestArtifacts
    );
    const proposals = proposalBound.values.map(normalizeChangeProposal);
    const ambiguities = ambiguityBound.values.map(normalizeChangeAmbiguity);
    const unparsedClauses = unparsedBound.values.map((clause, index) => text(
      clause,
      `change request unparsed clauses[${index}]`
    ));
    const intrinsic = {
      truncated: proposalBound.truncated || ambiguityBound.truncated || unparsedBound.truncated,
      partial: ambiguities.length > 0 || unparsedClauses.length > 0
    };
    const quality = evidenceQuality(value, options, intrinsic);
    const freshness = normalizeFreshness(value, options);
    const actions = validResolutionActions(
      options.resolutionActionIds,
      AMBIENT_SIGNAL_RESOLUTION_ACTIONS.changeRequest
    );
    const claim = ambiguities.length > 0
      ? `${ambiguities.length} customer-request ${ambiguities.length === 1 ? "clause needs" : "clauses need"} clarification before staging.`
      : unparsedClauses.length > 0
        ? `${unparsedClauses.length} customer-request ${unparsedClauses.length === 1 ? "clause is" : "clauses are"} unreadable by the deterministic grammar.`
        : proposals.length > 0
          ? `${proposals.length} customer-request ${proposals.length === 1 ? "change can" : "changes can"} be previewed before staging.`
          : "No stageable change was derived from the supplied customer request.";
    return [canonicalSignal({
      id: "change-request:current-parse",
      claim,
      evidence: [{
        messagePresent: Boolean(message),
        proposals,
        ambiguities,
        unparsedClauses,
        provenance: provenance("parseChangeRequest", "deterministic_draft_advisory", quality),
        doNothing: "The customer's stored request and the current quote draft remain unchanged."
      }],
      availability: availabilityFor(quality),
      severity: ambiguities.length > 0 || unparsedClauses.length > 0 ? "attention" : "info",
      consequence: proposals.length > 0
        ? "Any selected interpretation still requires a priced preview, explicit staging, and the existing trusted save; this signal performs none of those actions."
        : "The customer request remains unresolved; no meaning is guessed for ambiguous or unreadable clauses.",
      freshness,
      resolutionActionIds: actions
    })];
  }, fallback);
}

export function normalizeCascadeSignals(source = {}, options = {}) {
  const fallback = {
    id: "cascade:unavailable",
    claim: "Commercial cascade evidence is unavailable.",
    reason: "The recorded cascade presentation could not be normalized.",
    consequence: "No acceptance, contract, payment, booking, or operational step should be inferred from this source.",
    actionId: AMBIENT_SIGNAL_RESOLUTION_ACTIONS.cascade
  };
  return failClosed(() => {
    const value = record(source, "cascade presentation");
    if (value.modelId !== "cascade-receipts-v1") fail("cascade_model", "Cascade model is unsupported.");
    const applicable = boolean(value.applicable, "cascade applicable");
    if (!applicable) {
      return [unavailableSignal({
        ...fallback,
        reason: "The source reports that the accepted/booked cascade does not apply to this quote."
      })];
    }
    const cascadeStatus = text(value.status, "cascade status", { maximum: 24 });
    if (!["accepted", "booked"].includes(cascadeStatus)) {
      fail("cascade_status", "An applicable cascade requires accepted or booked source status.");
    }
    const bounded = boundedArray(
      value.steps,
      "cascade steps",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.cascadeSteps
    );
    if (bounded.values.length === 0) fail("cascade_empty", "An applicable cascade must contain steps.");
    const quality = evidenceQuality(value, options, { truncated: bounded.truncated });
    const freshness = normalizeFreshness(value, options);
    const actions = validResolutionActions(
      options.resolutionActionIds,
      AMBIENT_SIGNAL_RESOLUTION_ACTIONS.cascade
    );
    return bounded.values.map((entry, index) => {
      const step = record(entry, `cascade steps[${index}]`);
      const id = identifier(step.id, `cascade steps[${index}].id`);
      const state = text(step.state, `cascade steps[${index}].state`, { maximum: 16 });
      if (!CASCADE_STATES.has(state)) fail("cascade_state", "Cascade step state is unsupported.");
      const label = text(step.label, `cascade steps[${index}].label`);
      const detail = text(step.detail, `cascade steps[${index}].detail`);
      const timeLabel = text(step.timeLabel, `cascade steps[${index}].timeLabel`, { optional: true });
      return canonicalSignal({
        id: stableId("cascade", id, index),
        claim: state === "done"
          ? `${label} is recorded in this cascade.`
          : state === "blocked"
            ? `${label} is blocked by its recorded state.`
            : `${label} has no completed evidence in this cascade.`,
        evidence: [{
          stepId: id,
          state,
          label,
          detail,
          timeLabel: timeLabel || null,
          provenance: provenance(
            "buildCascadePresentation",
            "recorded_step_evidence_only",
            quality,
            { boundsNote: text(value.boundsNote, "cascade bounds note") }
          ),
          doNothing: "No cascade step, quote status, payment state, or operational record changes from this signal."
        }],
        availability: availabilityFor(quality),
        severity: state === "blocked" ? "blocking" : state === "pending" ? "attention" : "info",
        consequence: state === "done"
          ? "This confirms only this recorded step and does not imply completion of any other step."
          : "No completion, provider, payment, booking, or readiness evidence is inferred beyond this step's exact detail.",
        freshness,
        resolutionActionIds: actions
      });
    });
  }, fallback);
}

export function normalizeCommercialDependencySignals(source = {}, options = {}) {
  const fallback = {
    id: "commercial-dependency:unavailable",
    claim: "Commercial dependency simulation evidence is unavailable.",
    reason: "The advisory Commercial Change dependency result could not be normalized.",
    consequence: "No dependency review or regeneration conclusion should be presented from this source.",
    actionId: AMBIENT_SIGNAL_RESOLUTION_ACTIONS.commercialDependency
  };
  return failClosed(() => {
    const value = record(source, "commercial dependency impact");
    if (value.schemaVersion !== "commercial-change-impact-v1" || value.advisory !== true) {
      fail("dependency_model", "Commercial dependency impact model is unsupported.");
    }
    const impact = record(value.impact, "commercial dependency impact result");
    const identity = record(value.identity, "commercial dependency identity");
    const normalizedIdentity = {
      organizationId: identifier(identity.organizationId, "commercial dependency organizationId"),
      quoteId: identifier(identity.quoteId, "commercial dependency quoteId"),
      beforeRevisionId: identifier(identity.beforeRevisionId, "commercial dependency beforeRevisionId"),
      proposedRevisionId: identifier(identity.proposedRevisionId, "commercial dependency proposedRevisionId")
    };
    const sources = record(value.sources, "commercial dependency sources");
    const beforeSource = record(sources.before, "commercial dependency before source");
    const proposedSource = record(sources.proposedAfter, "commercial dependency proposed source");
    if (
      beforeSource.authority !== "server_authoritative"
      || beforeSource.label !== "canonical_quote_revision"
      || proposedSource.authority !== "server_authoritative"
      || proposedSource.label !== "authoritative_proposed_revision"
    ) {
      fail("dependency_authority", "Commercial dependency sources are not the declared authoritative simulation inputs.");
    }
    const graph = record(value.graph, "commercial dependency graph");
    const normalizedGraph = {
      graphId: identifier(graph.graphId, "commercial dependency graph id"),
      graphVersion: identifier(graph.graphVersion, "commercial dependency graph version")
    };
    const bounded = boundedArray(
      impact.dependentNodes,
      "commercial dependent nodes",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.commercialDependencies
    );
    const counts = record(impact.counts, "commercial dependency counts");
    const total = integer(counts.total, "commercial dependency total", 0, AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.commercialDependencies);
    const reviewCount = integer(counts.review, "commercial dependency review count", 0, total);
    const staleCount = integer(counts.stale, "commercial dependency stale count", 0, total);
    if (total !== bounded.totalCount || bounded.truncated) {
      fail("dependency_bounds", "Commercial dependency counts exceed or conflict with their declared bound.");
    }
    const normalizedNodes = bounded.values.map((entry, index) => {
      const node = record(entry, `commercial dependent nodes[${index}]`);
      const nodeId = text(node.id, `commercial dependent nodes[${index}].id`, { maximum: 160 });
      const advisoryClass = text(node.advisoryClass, `commercial dependent nodes[${index}].advisoryClass`, { maximum: 16 }).toUpperCase();
      if (!DEPENDENCY_CLASSES.has(advisoryClass)) fail("dependency_class", "Commercial dependency class is unsupported.");
      return {
        nodeId,
        kind: text(node.kind, `commercial dependent nodes[${index}].kind`, { maximum: 32 }),
        label: text(node.label || nodeId, `commercial dependent nodes[${index}].label`),
        advisoryClass
      };
    });
    if (
      normalizedNodes.filter((node) => node.advisoryClass === "REVIEW").length !== reviewCount
      || normalizedNodes.filter((node) => node.advisoryClass === "STALE").length !== staleCount
    ) {
      fail("dependency_counts", "Commercial dependency class counts are inconsistent.");
    }
    const roots = boundedArray(
      impact.rootNodeIds,
      "commercial dependency roots",
      AMBIENT_SIGNAL_NORMALIZATION_BOUNDS.commercialDependencies
    );
    if (roots.truncated) fail("dependency_root_bound", "Commercial dependency roots exceed the safe bound.");
    const normalizedRoots = roots.values.map((entry, index) => text(
      entry,
      `commercial dependency roots[${index}]`,
      { maximum: 160 }
    ));
    const quality = evidenceQuality(value, options);
    const freshness = normalizeFreshness(value, options);
    const actions = validResolutionActions(
      options.resolutionActionIds,
      AMBIENT_SIGNAL_RESOLUTION_ACTIONS.commercialDependency
    );
    const dependencyProvenance = provenance(
      "simulateCommercialChangeImpact",
      "server_authoritative_inputs_advisory_projection",
      quality,
      {
        identity: normalizedIdentity,
        sources: {
          before: { authority: beforeSource.authority, label: beforeSource.label },
          proposedAfter: { authority: proposedSource.authority, label: proposedSource.label }
        },
        graph: normalizedGraph,
        boundary: text(value.boundary, "commercial dependency boundary")
      }
    );
    if (normalizedNodes.length === 0) {
      return [canonicalSignal({
        id: "commercial-dependency:no-affected-nodes",
        claim: "The advisory simulation reports no affected commercial dependencies.",
        evidence: [{
          changedRootNodeIds: normalizedRoots,
          provenance: dependencyProvenance,
          doNothing: "The canonical quote revision and every dependency remain unchanged."
        }],
        availability: availabilityFor(quality),
        severity: "info",
        consequence: "This read-only result does not authorize, invalidate, regenerate, publish, or mutate anything.",
        freshness,
        resolutionActionIds: actions
      })];
    }
    return normalizedNodes.map((node, index) => {
      const { nodeId, advisoryClass, kind, label } = node;
      return canonicalSignal({
        id: stableId("commercial-dependency", nodeId, index),
        claim: `${label} is classified ${advisoryClass} by the read-only dependency simulation.`,
        evidence: [{
          nodeId,
          kind,
          advisoryClass,
          changedRootNodeIds: normalizedRoots,
          provenance: dependencyProvenance,
          doNothing: "The dependency remains exactly as recorded; the simulation performs no invalidation or regeneration."
        }],
        availability: availabilityFor(quality),
        severity: advisoryClass === "STALE" ? "warning" : "attention",
        consequence: "This classification identifies simulated exposure only; it does not establish actual freshness or authorize any artifact change.",
        freshness,
        resolutionActionIds: actions
      });
    });
  }, fallback);
}

const AGGREGATE_ADAPTERS = Object.freeze([
  ["nowAttention", normalizeNowAttentionSignals],
  ["proposalCompleteness", normalizeProposalCompletenessSignals],
  ["guidedSelling", normalizeGuidedSellingSignals],
  ["margin", normalizeMarginSignals],
  ["decisionDebt", normalizeDecisionDebtSignals],
  ["changeRequest", normalizeChangeRequestSignals],
  ["cascade", normalizeCascadeSignals],
  ["commercialDependency", normalizeCommercialDependencySignals]
]);

export function normalizeAmbientSignals(sources = {}, options = {}) {
  const input = record(sources, "Ambient signal sources");
  const sourceOptions = options === undefined ? {} : record(options, "Ambient signal options");
  const signals = AGGREGATE_ADAPTERS.flatMap(([key, adapter]) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return [];
    const adapterOptions = sourceOptions[key] === undefined
      ? {}
      : record(sourceOptions[key], `Ambient signal options.${key}`);
    return adapter(input[key], adapterOptions);
  });
  return Object.freeze(signals);
}
