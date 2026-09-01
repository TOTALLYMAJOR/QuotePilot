export const UNIFIED_CONSEQUENCE_REVIEW_MODEL = "unified-commercial-consequence-review-v1";

export const UNIFIED_CONSEQUENCE_GROUPS = Object.freeze([
  ["price-deposit", "Price and deposit"],
  ["staffing", "Staffing"],
  ["rentals", "Rentals"],
  ["guided-recommendations", "Guided recommendations"],
  ["margin-evidence", "Margin evidence"],
  ["proposal-readiness", "Proposal readiness"]
]);

function text(value) {
  return String(value ?? "").trim();
}

function item({ id, label, detail, source, authority, selectable = false, recommendation = null }) {
  return { id, label, detail, source, authority, selectable, recommendation };
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function factItems(model, matcher, group) {
  return (Array.isArray(model?.factDiffs) ? model.factDiffs : [])
    .filter((diff) => matcher.test(text(diff.nodeId)))
    .map((diff) => item({
      id: `${group}:${diff.nodeId}`,
      label: text(diff.nodeId).replace(/^fact\./, "").replaceAll("_", " ").replaceAll(".", " · "),
      detail: "Quoted and proposed values differ; inspect the exact before/after evidence below.",
      source: "Server-authoritative quote simulation",
      authority: "authoritative_quote_effect"
    }));
}

export function buildUnifiedCommercialConsequenceReview({
  model = null,
  recommendations = [],
  margin = null,
  proposalReadiness = null,
  catalogRevision = null
} = {}) {
  if (!model?.identity?.beforeRevisionId || !model?.identity?.proposedRevisionId) return null;
  const total = model.commercialValues?.authoritativeTotal || {};
  const deposit = model.commercialValues?.depositRequirement || {};
  const guided = (Array.isArray(recommendations) ? recommendations : []).map((recommendation) => item({
    id: `guided:${recommendation.key}`,
    label: recommendation.label,
    detail: `${recommendation.reason} ${recommendation.impact}`.trim(),
    source: "Operator-declared guided-selling policy",
    authority: "policy_recommendation",
    selectable: true,
    recommendation
  }));
  const marginItems = [item({
    id: "margin:status",
    label: margin?.available ? `${(Number(margin.marginPct) * 100).toFixed(1)}% projected margin` : "Margin unavailable",
    detail: margin?.note || "No complete cost evidence is available for this proposed form.",
    source: "Tenant-recorded staff-only cost evidence",
    authority: "internal_evidence"
  })];
  const readinessGaps = Array.isArray(proposalReadiness?.gaps) ? proposalReadiness.gaps : [];
  const proposalItems = [item({
    id: "proposal:status",
    label: proposalReadiness?.complete ? "Proposal ready to send" : `${readinessGaps.length} required proposal gap${readinessGaps.length === 1 ? "" : "s"}`,
    detail: proposalReadiness?.complete
      ? "All required draft fields are present; delivery authority remains separate."
      : readinessGaps.map((gap) => gap.label).join(", ") || "Proposal readiness is unavailable.",
    source: "Draft completeness policy",
    authority: "readiness_projection"
  })];
  const groups = {
    "price-deposit": [item({
      id: "price-deposit:authoritative",
      label: `${money(total.before)} → ${money(total.proposedAfter)}`,
      detail: `Deposit ${money(deposit.before)} → ${money(deposit.proposedAfter)}.`,
      source: "Server-authoritative quote simulation",
      authority: "authoritative_quote_effect"
    })],
    staffing: factItems(model, /staffing|duration|service_style/u, "staffing"),
    rentals: factItems(model, /rental/u, "rentals"),
    "guided-recommendations": guided,
    "margin-evidence": marginItems,
    "proposal-readiness": proposalItems
  };
  return {
    modelId: UNIFIED_CONSEQUENCE_REVIEW_MODEL,
    fence: {
      quoteRevisionId: text(model.identity.beforeRevisionId),
      proposedRevisionId: text(model.identity.proposedRevisionId),
      catalogRevision: Number.isSafeInteger(Number(catalogRevision)) ? Number(catalogRevision) : null
    },
    groups: UNIFIED_CONSEQUENCE_GROUPS.map(([id, label]) => ({ id, label, items: groups[id] || [] })),
    selectableRecommendationIds: guided.map((entry) => entry.id),
    sources: {
      authoritative: "Server-authoritative quote simulation",
      recommendations: "Operator-declared guided-selling policy",
      margin: "Tenant-recorded staff-only cost evidence",
      proposal: "Draft completeness policy"
    }
  };
}

export function applyUnifiedRecommendation(form = {}, recommendation = null) {
  if (!recommendation?.id) return { ...form };
  if (recommendation.kind === "package") {
    return { ...form, eventTemplateId: "custom", pkg: recommendation.id };
  }
  if (recommendation.kind === "addon") {
    const ids = new Set(Array.isArray(form.addons) ? form.addons : []);
    ids.add(recommendation.id);
    return {
      ...form,
      eventTemplateId: "custom",
      addons: [...ids],
      addonQuantities: { ...(form.addonQuantities || {}), [recommendation.id]: Math.max(1, Number(form.addonQuantities?.[recommendation.id] || 1)) }
    };
  }
  if (recommendation.kind === "rental") {
    const ids = new Set(Array.isArray(form.rentals) ? form.rentals : []);
    ids.add(recommendation.id);
    return {
      ...form,
      eventTemplateId: "custom",
      rentals: [...ids],
      rentalQuantities: { ...(form.rentalQuantities || {}), [recommendation.id]: Math.max(1, Number(form.rentalQuantities?.[recommendation.id] || 1)) }
    };
  }
  return { ...form };
}

export function buildUnifiedConsequenceProposedForm({ form = {}, review = null, selectedIds = [] } = {}) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const guided = review?.groups?.find((group) => group.id === "guided-recommendations")?.items || [];
  return guided.reduce((next, entry) => (
    selected.has(entry.id) ? applyUnifiedRecommendation(next, entry.recommendation) : next
  ), { ...form });
}

export function unifiedConsequenceFenceCurrent(review, { quoteRevisionId, proposedRevisionId, catalogRevision } = {}) {
  return Boolean(review?.fence)
    && review.fence.quoteRevisionId === text(quoteRevisionId)
    && review.fence.proposedRevisionId === text(proposedRevisionId)
    && review.fence.catalogRevision === (Number.isSafeInteger(Number(catalogRevision)) ? Number(catalogRevision) : null);
}
