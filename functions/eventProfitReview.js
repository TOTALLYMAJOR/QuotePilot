"use strict";

const { createHash } = require("node:crypto");

const EVENT_PROFIT_REVIEW_SCHEMA_VERSION = 1;
const REQUIRED_ACTUAL_FIELDS = Object.freeze([
  "grossRevenueCents", "discountsCents", "refundsCreditsCents", "foodCents",
  "laborCents", "deliverySetupCents", "rentalsVendorsCents",
  "packagingSuppliesCents", "paymentFeesCents", "otherDirectCents"
]);
const DIRECT_COST_FIELDS = Object.freeze([
  "foodCents", "laborCents", "deliverySetupCents", "rentalsVendorsCents",
  "packagingSuppliesCents", "paymentFeesCents", "otherDirectCents"
]);
const OPTIONAL_ACTUAL_FIELDS = Object.freeze(["allocatedOverheadCents"]);
const LOSS_SIGNAL_FIELDS = Object.freeze([
  "foodWasteCents", "overtimePremiumCents", "serviceRecoveryCents"
]);
const ACTION_SET = new Set(["save_draft", "finalize", "reopen"]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/;
const OPAQUE_ID_PATTERN = /^[^\s/?#\\\u0000]{1,256}$/u;
const MAX_CENTS = 100_000_000_000;

class EventProfitReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EventProfitReviewError";
    this.code = code;
  }
}

const text = (value) => String(value ?? "").trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function opaqueId(value, label) {
  const normalized = text(value);
  if (!OPAQUE_ID_PATTERN.test(normalized) || normalized === "." || normalized === "..") {
    throw new EventProfitReviewError("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function normalizeISO(value, label) {
  const normalized = text(value);
  const parsed = new Date(normalized);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(normalized) || Number.isNaN(parsed.getTime())) {
    throw new EventProfitReviewError("invalid-argument", `${label} must be an ISO timestamp.`);
  }
  return parsed.toISOString();
}

function normalizeActor(value, label = "operator") {
  const source = isRecord(value) ? value : {};
  const role = text(source.role).toLowerCase();
  const email = text(source.email).toLowerCase();
  if (!OPAQUE_ID_PATTERN.test(text(source.uid)) || role !== "admin" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EventProfitReviewError("permission-denied", `${label} must contain same-tenant admin evidence.`);
  }
  return deepFreeze({ uid: text(source.uid), email, role });
}

function normalizeCents(value, label, optional = false) {
  if (value === null || value === undefined || value === "") {
    if (optional) return null;
    throw new EventProfitReviewError("invalid-argument", `${label} is required.`);
  }
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > MAX_CENTS) {
    throw new EventProfitReviewError("invalid-argument", `${label} must be a non-negative integer number of USD cents.`);
  }
  return normalized;
}

function normalizeTargetMarginBps(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized >= 10_000) {
    throw new EventProfitReviewError("invalid-argument", "targetMarginBps must be an integer from 0 through 9999.");
  }
  return normalized;
}

function normalizeInputs(input = {}, allowIncomplete = false) {
  const source = isRecord(input) ? input : {};
  const rawActuals = isRecord(source.actuals) ? source.actuals : {};
  const actuals = {};
  REQUIRED_ACTUAL_FIELDS.forEach((field) => {
    const missing = rawActuals[field] === null || rawActuals[field] === undefined || rawActuals[field] === "";
    actuals[field] = allowIncomplete && missing ? null : normalizeCents(rawActuals[field], field);
  });
  OPTIONAL_ACTUAL_FIELDS.forEach((field) => {
    actuals[field] = normalizeCents(rawActuals[field], field, true);
  });
  const rawSignals = isRecord(source.lossSignals) ? source.lossSignals : {};
  const lossSignals = Object.fromEntries(LOSS_SIGNAL_FIELDS.map((field) => [field, normalizeCents(rawSignals[field], field, true)]));
  const allowedZeros = new Set([...REQUIRED_ACTUAL_FIELDS, ...OPTIONAL_ACTUAL_FIELDS]);
  const confirmedZeroFields = [...new Set((Array.isArray(source.confirmedZeroFields) ? source.confirmedZeroFields : []).map(text))]
    .filter((field) => allowedZeros.has(field) && actuals[field] === 0).sort();
  return deepFreeze({
    actuals,
    lossSignals,
    confirmedZeroFields,
    comparisonBasisConfirmed: source.comparisonBasisConfirmed === true,
    targetMarginBps: normalizeTargetMarginBps(source.targetMarginBps),
    notes: text(source.notes).slice(0, 1600)
  });
}

function buildInitialEventProfitReview({ sourceVersionId, acceptanceReceiptId } = {}) {
  return deepFreeze({
    schemaVersion: EVENT_PROFIT_REVIEW_SCHEMA_VERSION,
    state: "not_started",
    reviewRevision: 0,
    sourceVersionId: opaqueId(sourceVersionId, "sourceVersionId"),
    acceptanceReceiptId: opaqueId(acceptanceReceiptId, "acceptanceReceiptId"),
    actuals: Object.fromEntries([...REQUIRED_ACTUAL_FIELDS, ...OPTIONAL_ACTUAL_FIELDS].map((field) => [field, null])),
    lossSignals: Object.fromEntries(LOSS_SIGNAL_FIELDS.map((field) => [field, null])),
    confirmedZeroFields: [],
    comparisonBasisConfirmed: false,
    targetMarginBps: null,
    notes: "",
    summary: null,
    createdAtISO: "",
    createdBy: null,
    updatedAtISO: "",
    updatedBy: null,
    finalizedAtISO: "",
    finalizedBy: null,
    reopenedAtISO: "",
    reopenedBy: null,
    lastMutationReceiptId: ""
  });
}

function normalizeStoredEventProfitReview(value, binding = {}) {
  const initial = buildInitialEventProfitReview(binding);
  if (!isRecord(value)) return initial;
  const state = new Set(["not_started", "draft", "final"]).has(text(value.state)) ? text(value.state) : "not_started";
  const reviewRevision = Number(value.reviewRevision);
  if (text(value.sourceVersionId) !== initial.sourceVersionId || text(value.acceptanceReceiptId) !== initial.acceptanceReceiptId || !Number.isSafeInteger(reviewRevision) || reviewRevision < 0) {
    throw new EventProfitReviewError("failed-precondition", "The profit review is not bound to the exact accepted proposal source.");
  }
  return deepFreeze({ ...initial, ...value, ...normalizeInputs(value, state !== "final"), schemaVersion: EVENT_PROFIT_REVIEW_SCHEMA_VERSION, state, reviewRevision, sourceVersionId: initial.sourceVersionId, acceptanceReceiptId: initial.acceptanceReceiptId });
}

function moneyToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const normalized = Math.round(amount * 100);
  return Number.isSafeInteger(normalized) && normalized <= MAX_CENTS ? normalized : null;
}

function sumSnapshotLines(lines, missing) {
  return (Array.isArray(lines) ? lines : []).reduce((total, line) => {
    if (line?.extendedCost === null || line?.extendedCost === undefined) {
      missing.push(text(line?.name || line?.id || "recorded cost"));
      return total;
    }
    const value = moneyToCents(line.extendedCost);
    if (value === null) missing.push(text(line?.name || line?.id || "recorded cost"));
    return total + (value || 0);
  }, 0);
}

function buildAcceptedEstimateBasis(sourceVersion = {}) {
  const snapshot = isRecord(sourceVersion?.snapshot) ? sourceVersion.snapshot : {};
  const pricing = isRecord(snapshot.pricing) ? snapshot.pricing : {};
  const commercial = isRecord(pricing.commercialSnapshot) ? pricing.commercialSnapshot : null;
  const totals = isRecord(pricing.totals)
    ? pricing.totals
    : (isRecord(snapshot.totals) ? snapshot.totals : {});
  if (!commercial) {
    return deepFreeze({ available: false, reason: "accepted_cost_snapshot_missing" });
  }
  const missing = [];
  let foodCents = 0;
  if (commercial.package?.id) {
    const packageCost = moneyToCents(commercial.package.extendedCost);
    if (packageCost === null) missing.push(text(commercial.package.name || "package"));
    foodCents += packageCost || 0;
  }
  foodCents += sumSnapshotLines(commercial.addons, missing);
  foodCents += sumSnapshotLines(commercial.menuItems, missing);
  const rentalsVendorsCents = sumSnapshotLines(commercial.rentals, missing);
  let laborCents = 0;
  if (commercial.staffing?.enabled !== false) {
    (Array.isArray(commercial.staffing?.roles) ? commercial.staffing.roles : []).forEach((role) => {
      if (!(Number(role?.count) > 0)) return;
      const roleCost = moneyToCents(role?.extendedCost);
      if (roleCost === null) missing.push(text(role?.label || role?.id || "staffing"));
      laborCents += roleCost || 0;
    });
  }
  const revenueKeys = ["base", "addons", "rentals", "menu", "labor", "serviceFee"];
  const revenueValues = revenueKeys.map((key) => moneyToCents(totals[key] ?? 0));
  if (missing.length || revenueValues.some((value) => value === null)) {
    return deepFreeze({
      available: false,
      reason: missing.length ? "accepted_cost_basis_incomplete" : "accepted_revenue_basis_incomplete",
      missing: missing.slice(0, 5)
    });
  }
  const quotedNetRevenueCents = revenueValues.reduce((sum, value) => sum + value, 0);
  if (!(quotedNetRevenueCents > 0)) {
    return deepFreeze({ available: false, reason: "accepted_revenue_basis_incomplete" });
  }
  const quotedDirectCostCents = foodCents + laborCents + rentalsVendorsCents;
  const rawTarget = Number(commercial.targetMarginPct);
  const targetMarginBps = Number.isFinite(rawTarget) && rawTarget >= 0 && rawTarget < 1
    ? Math.round(rawTarget * 10_000)
    : null;
  return deepFreeze({
    available: true,
    currency: "USD",
    quotedNetRevenueCents,
    quotedDirectCostCents,
    quotedContributionCents: quotedNetRevenueCents - quotedDirectCostCents,
    costs: { foodCents, laborCents, rentalsVendorsCents },
    targetMarginBps
  });
}

function contributionMarginBps(contributionCents, netRevenueCents) {
  if (!(netRevenueCents > 0)) return null;
  return Math.round((contributionCents * 10_000) / netRevenueCents);
}

function buildComparison(actuals, estimateBasis, actualContributionCents, comparisonBasisConfirmed) {
  if (comparisonBasisConfirmed !== true) {
    return { available: false, reason: "actual_comparison_basis_not_confirmed" };
  }
  if (!estimateBasis?.available) {
    return { available: false, reason: text(estimateBasis?.reason || "accepted_basis_unavailable") };
  }
  const unrepresented = [
    "deliverySetupCents", "packagingSuppliesCents", "paymentFeesCents", "otherDirectCents"
  ].filter((field) => actuals[field] > 0);
  if (unrepresented.length) {
    return { available: false, reason: "comparison_basis_mismatch", unmatchedActualFields: unrepresented };
  }
  const netRevenueCents = actuals.grossRevenueCents - actuals.discountsCents - actuals.refundsCreditsCents;
  const drivers = [
    { code: "net_revenue", label: "Net event revenue", impactCents: netRevenueCents - estimateBasis.quotedNetRevenueCents },
    { code: "food", label: "Food cost", impactCents: estimateBasis.costs.foodCents - actuals.foodCents },
    { code: "labor", label: "Labor cost", impactCents: estimateBasis.costs.laborCents - actuals.laborCents },
    { code: "rentals_vendors", label: "Rentals and vendors", impactCents: estimateBasis.costs.rentalsVendorsCents - actuals.rentalsVendorsCents }
  ];
  const largest = drivers.reduce((selected, driver) => (
    Math.abs(driver.impactCents) > Math.abs(selected.impactCents) ? driver : selected
  ), drivers[0]);
  return {
    available: true,
    quotedNetRevenueCents: estimateBasis.quotedNetRevenueCents,
    quotedDirectCostCents: estimateBasis.quotedDirectCostCents,
    quotedContributionCents: estimateBasis.quotedContributionCents,
    contributionVarianceCents: actualContributionCents - estimateBasis.quotedContributionCents,
    largestVarianceDriver: largest
  };
}

function buildEventProfitSummary({ inputs, estimateBasis } = {}) {
  const normalized = normalizeInputs(inputs, false);
  const { actuals } = normalized;
  const netEventRevenueCents = actuals.grossRevenueCents - actuals.discountsCents - actuals.refundsCreditsCents;
  const directCostCents = DIRECT_COST_FIELDS.reduce((sum, field) => sum + actuals[field], 0);
  const contributionCents = netEventRevenueCents - directCostCents;
  const overheadRecorded = actuals.allocatedOverheadCents !== null;
  const recordedCostCents = directCostCents + (actuals.allocatedOverheadCents || 0);
  const targetMarginBps = normalized.targetMarginBps;
  return deepFreeze({
    currency: "USD",
    netEventRevenueCents,
    directCostCents,
    contributionCents,
    contributionMarginBps: contributionMarginBps(contributionCents, netEventRevenueCents),
    overheadRecorded,
    profitAfterAllocatedOverheadCents: overheadRecorded
      ? contributionCents - actuals.allocatedOverheadCents
      : null,
    comparison: buildComparison(actuals, estimateBasis, contributionCents, normalized.comparisonBasisConfirmed),
    targetMarginBps,
    advisoryNextEventPriceCents: targetMarginBps === null
      ? null
      : Math.ceil((recordedCostCents * 10_000) / (10_000 - targetMarginBps)),
    advisoryOnly: true
  });
}

function normalizeEventProfitReviewRequest(input = {}) {
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const quoteId = opaqueId(input.quoteId, "quoteId");
  const closeoutId = opaqueId(input.closeoutId, "closeoutId");
  const requestId = text(input.requestId);
  const action = text(input.action).toLowerCase();
  const expectedReviewRevision = Number(input.expectedReviewRevision);
  if (!REQUEST_ID_PATTERN.test(requestId) || !ACTION_SET.has(action)) {
    throw new EventProfitReviewError("invalid-argument", "Profit review requestId or action is invalid.");
  }
  if (!Number.isSafeInteger(expectedReviewRevision) || expectedReviewRevision < 0) {
    throw new EventProfitReviewError("invalid-argument", "expectedReviewRevision must be a non-negative integer.");
  }
  const inputs = action === "reopen" ? null : normalizeInputs(input, action === "save_draft");
  const payload = { organizationId, quoteId, closeoutId, requestId, action, expectedReviewRevision, inputs };
  const payloadDigest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const receiptDigest = createHash("sha256")
    .update([organizationId, quoteId, closeoutId, requestId].join("\u0000"))
    .digest("hex");
  return deepFreeze({
    ...payload,
    payloadDigest,
    receiptId: `profit_review_${receiptDigest.slice(0, 48)}`
  });
}

function assertReplay(existingReceipt, request) {
  if (!isRecord(existingReceipt)) return null;
  if (
    text(existingReceipt.requestId) !== request.requestId
    || text(existingReceipt.payloadDigest) !== request.payloadDigest
    || text(existingReceipt.receiptId) !== request.receiptId
  ) {
    throw new EventProfitReviewError("already-exists", "The profit review request ID is already bound to different input.");
  }
  return deepFreeze({
    kind: "replay",
    idempotent: true,
    request,
    nextProfitReview: null,
    receipt: existingReceipt
  });
}

function planEventProfitReviewMutation({
  request,
  currentProfitReview,
  binding,
  sourceVersion,
  actor,
  nowISO,
  existingReceipt = null
} = {}) {
  const normalizedRequest = normalizeEventProfitReviewRequest(request);
  const replay = assertReplay(existingReceipt, normalizedRequest);
  if (replay) return replay;
  const current = normalizeStoredEventProfitReview(currentProfitReview, binding);
  if (current.reviewRevision !== normalizedRequest.expectedReviewRevision) {
    throw new EventProfitReviewError(
      "aborted",
      `Profit review revision conflict. Expected ${normalizedRequest.expectedReviewRevision}; current revision is ${current.reviewRevision}.`
    );
  }
  const recordedAtISO = normalizeISO(nowISO, "recordedAtISO");
  const recordedBy = normalizeActor(actor, "profit review operator");
  const nextRevision = current.reviewRevision + 1;
  let nextState;
  let inputs;
  let summary = null;
  if (normalizedRequest.action === "reopen") {
    if (current.state !== "final") {
      throw new EventProfitReviewError("failed-precondition", "Only a finalized profit review can be reopened.");
    }
    nextState = "draft";
    inputs = normalizeInputs(current, true);
  } else {
    if (current.state === "final") {
      throw new EventProfitReviewError("failed-precondition", "Reopen the finalized profit review before editing it.");
    }
    nextState = normalizedRequest.action === "finalize" ? "final" : "draft";
    inputs = normalizedRequest.inputs;
    if (nextState === "final") {
      const zeroFields = [...REQUIRED_ACTUAL_FIELDS, ...OPTIONAL_ACTUAL_FIELDS]
        .filter((field) => inputs.actuals[field] === 0);
      const unconfirmedZeros = zeroFields.filter((field) => !inputs.confirmedZeroFields.includes(field));
      if (unconfirmedZeros.length) {
        throw new EventProfitReviewError(
          "failed-precondition",
          `Confirm explicit zero evidence before finalizing: ${unconfirmedZeros.join(", ")}.`
        );
      }
      summary = buildEventProfitSummary({
        inputs,
        estimateBasis: buildAcceptedEstimateBasis(sourceVersion)
      });
    }
  }
  const createdNow = current.state === "not_started";
  const nextProfitReview = deepFreeze({
    ...current,
    ...inputs,
    state: nextState,
    reviewRevision: nextRevision,
    summary,
    createdAtISO: createdNow ? recordedAtISO : current.createdAtISO,
    createdBy: createdNow ? recordedBy : current.createdBy,
    updatedAtISO: recordedAtISO,
    updatedBy: recordedBy,
    finalizedAtISO: nextState === "final" ? recordedAtISO : "",
    finalizedBy: nextState === "final" ? recordedBy : null,
    reopenedAtISO: normalizedRequest.action === "reopen" ? recordedAtISO : current.reopenedAtISO,
    reopenedBy: normalizedRequest.action === "reopen" ? recordedBy : current.reopenedBy,
    lastMutationReceiptId: normalizedRequest.receiptId
  });
  const receipt = deepFreeze({
    schemaVersion: EVENT_PROFIT_REVIEW_SCHEMA_VERSION,
    receiptId: normalizedRequest.receiptId,
    requestId: normalizedRequest.requestId,
    payloadDigest: normalizedRequest.payloadDigest,
    organizationId: normalizedRequest.organizationId,
    quoteId: normalizedRequest.quoteId,
    closeoutId: normalizedRequest.closeoutId,
    action: normalizedRequest.action,
    priorState: current.state,
    resultState: nextState,
    priorReviewRevision: current.reviewRevision,
    resultReviewRevision: nextRevision,
    recordedAtISO,
    recordedBy
  });
  return deepFreeze({ kind: "apply", idempotent: false, request: normalizedRequest, nextProfitReview, receipt });
}

function projectEventProfitReviewSummary(value, binding = {}) {
  const review = normalizeStoredEventProfitReview(value, binding);
  const base = {
    schemaVersion: EVENT_PROFIT_REVIEW_SCHEMA_VERSION,
    state: review.state,
    reviewRevision: review.reviewRevision,
    sourceVersionId: review.sourceVersionId,
    acceptanceReceiptId: review.acceptanceReceiptId,
    updatedAtISO: text(review.updatedAtISO)
  };
  if (review.state !== "final" || !isRecord(review.summary)) return deepFreeze(base);
  return deepFreeze({
    ...base,
    summary: review.summary,
    finalizedAtISO: text(review.finalizedAtISO),
    finalizedBy: isRecord(review.finalizedBy)
      ? { email: text(review.finalizedBy.email).toLowerCase(), role: text(review.finalizedBy.role) }
      : null
  });
}

function projectEventProfitReviewDetail(value, binding = {}) {
  const review = normalizeStoredEventProfitReview(value, binding);
  return deepFreeze({
    schemaVersion: review.schemaVersion,
    state: review.state,
    reviewRevision: review.reviewRevision,
    sourceVersionId: review.sourceVersionId,
    acceptanceReceiptId: review.acceptanceReceiptId,
    actuals: review.actuals,
    lossSignals: review.lossSignals,
    confirmedZeroFields: review.confirmedZeroFields,
    comparisonBasisConfirmed: review.comparisonBasisConfirmed,
    targetMarginBps: review.targetMarginBps,
    notes: review.notes,
    summary: review.summary,
    createdAtISO: text(review.createdAtISO),
    updatedAtISO: text(review.updatedAtISO),
    finalizedAtISO: text(review.finalizedAtISO),
    reopenedAtISO: text(review.reopenedAtISO)
  });
}

module.exports = {
  DIRECT_COST_FIELDS,
  EVENT_PROFIT_REVIEW_SCHEMA_VERSION,
  EventProfitReviewError,
  LOSS_SIGNAL_FIELDS,
  OPTIONAL_ACTUAL_FIELDS,
  REQUIRED_ACTUAL_FIELDS,
  buildAcceptedEstimateBasis,
  buildEventProfitSummary,
  buildInitialEventProfitReview,
  normalizeEventProfitReviewRequest,
  normalizeStoredEventProfitReview,
  planEventProfitReviewMutation,
  projectEventProfitReviewDetail,
  projectEventProfitReviewSummary
};
