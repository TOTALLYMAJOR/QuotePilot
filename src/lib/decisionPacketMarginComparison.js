import { calculateQuote } from "./quoteCalculator";
import { buildMarginPresentation } from "../components/marginPresentation";

// Read-only comparison for the decision-packet preview. No missing cost is inferred.
export function buildRecordedCostMarginComparison({
  isEditingQuote,
  editingQuote,
  catalog,
  effectiveSettings,
  proposedMargin
}) {
  if (!isEditingQuote || !editingQuote.baseForm) return { evidenceState: "missing" };
  const savedCatalogRevision = Number(editingQuote.pricingCatalogAuthority?.catalogRevision);
  const currentCatalogRevision = Number(effectiveSettings.catalogRevision);
  if (!Number.isSafeInteger(savedCatalogRevision) || !Number.isSafeInteger(currentCatalogRevision)) {
    return {
      evidenceState: "missing",
      boundary: "The saved and current catalog revisions are required before margin can be compared."
    };
  }
  if (savedCatalogRevision !== currentCatalogRevision) {
    return {
      evidenceState: "stale",
      boundary: "The saved quote and current catalog use different revisions; refresh the governed quote review before comparing margin."
    };
  }
  try {
    const currentTotals = calculateQuote(editingQuote.baseForm, catalog, effectiveSettings);
    const currentMargin = buildMarginPresentation({
      form: editingQuote.baseForm,
      totals: currentTotals,
      catalog,
      settings: effectiveSettings
    });
    if (!currentMargin?.available || !proposedMargin?.available) {
      return {
        evidenceState: "missing",
        boundary: "Complete recorded-cost coverage for both the saved and proposed quote is required before margin can be compared."
      };
    }
    return {
      evidenceState: "available",
      before: currentMargin.marginPct,
      proposedAfter: proposedMargin.marginPct
    };
  } catch {
    return {
      evidenceState: "unavailable",
      boundary: "The existing margin presentation could not compare both snapshots."
    };
  }
}

export default buildRecordedCostMarginComparison;
