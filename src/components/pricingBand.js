import { calculateQuote } from "../lib/quoteCalculator";
import { buildMarginPresentation } from "./marginPresentation";

// Deterministic band-pricing presentation for the draft preview
// (docs/POST_COMPETITIVE_DESIGN.md §4.2, docs/INTENT_INTAKE_ADR.md). A band
// exists only while the operator's own phrasing was uncertain (an intake
// range or "about" count). Both endpoints are priced by the SAME preview
// calculator the rail already uses — never a second pricing model — and the
// band never reaches authority: saving, sending, and every payment rail
// price the exact recorded guest count.
export const PRICING_BAND_MODEL = "pricing-band-v1";

const APPROXIMATE_SPREAD = 0.1;

export function deriveGuestBand(guestFact) {
  if (!guestFact || guestFact.field !== "guests") return null;
  const value = Number(guestFact.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (guestFact.kind === "range") {
    const min = Number(guestFact.min);
    const max = Number(guestFact.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= min) return null;
    return { kind: "range", min, max, appliedValue: value, source: String(guestFact.source || "") };
  }
  if (guestFact.kind === "approximate") {
    const min = Math.max(1, Math.round(value * (1 - APPROXIMATE_SPREAD)));
    const max = Math.round(value * (1 + APPROXIMATE_SPREAD));
    if (max <= min) return null;
    return { kind: "approximate", min, max, appliedValue: value, source: String(guestFact.source || "") };
  }
  return null;
}

export function buildPricingBand({ form, catalog, settings, band } = {}) {
  if (!band || !form || !catalog || !settings) return null;
  const min = Number(band.min);
  const max = Number(band.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= min) return null;

  const lowTotals = calculateQuote({ ...form, guests: min }, catalog, settings);
  const highTotals = calculateQuote({ ...form, guests: max }, catalog, settings);
  if (!lowTotals || !highTotals) return null;

  // Margin at both band ends, same fail-closed rule as the applied-count
  // strip: only ever shown when every selected line has a recorded cost at
  // BOTH endpoints. One end missing costs makes the whole range unavailable
  // rather than implying a false precision from a half-known range.
  const lowMargin = buildMarginPresentation({ form: { ...form, guests: min }, totals: lowTotals, catalog, settings });
  const highMargin = buildMarginPresentation({ form: { ...form, guests: max }, totals: highTotals, catalog, settings });
  const margin = lowMargin?.available && highMargin?.available
    ? { lowPct: lowMargin.marginPct, highPct: highMargin.marginPct }
    : null;

  return {
    modelId: PRICING_BAND_MODEL,
    kind: band.kind,
    min,
    max,
    appliedValue: Number(band.appliedValue) || null,
    lowTotal: Number(lowTotals.total || 0),
    highTotal: Number(highTotals.total || 0),
    lowDeposit: Number(lowTotals.deposit || 0),
    highDeposit: Number(highTotals.deposit || 0),
    margin,
    note: band.kind === "range"
      ? `Priced at the ends of the stated ${min}–${max} guest range. Confirming the count makes this exact.`
      : `Priced at ±10% around ~${band.appliedValue} guests. Confirming the count makes this exact.`
  };
}
