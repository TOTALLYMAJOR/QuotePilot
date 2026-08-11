// Deterministic presentation contract for the flag-gated guided-selling
// decide cards in the quote builder. It re-dresses the existing upsell
// recommendation output (already computed from the tenant's own rules,
// catalog, and live preview totals) in the shared decision grammar. It
// computes nothing new, reads nothing, and preserves the existing apply and
// autopilot semantics exactly.
export const GUIDED_SELLING_CARDS_MODEL = "guided-selling-cards-v1";

export const GUIDED_SELLING_BOUNDS_NOTE =
  "Advisory suggestions from your own guided-selling rules. Taking one updates this draft only; nothing is sent or saved, and saving re-prices on the server.";

const KIND_LABELS = Object.freeze({
  addon: "Add-on",
  rental: "Rental",
  package: "Package upgrade"
});

export function buildGuidedSellingCard(item, { aiAutopilotEnabled = false } = {}) {
  if (!item || !item.label) return null;
  const reason = String(item.reason || "Upsell rule matched this quote.").trim();
  return {
    id: `guided-${item.key || `${item.kind}-${item.id}`}`,
    kind: "guided_selling",
    signal: "attend",
    family: "info",
    label: "Advisory",
    title: item.label,
    meta: KIND_LABELS[item.kind] || "Suggestion",
    sentence: reason,
    basis: "A guided-selling rule in your catalog settings matched this quote's guest count and hours.",
    impact: String(item.impact || ""),
    why: [
      `Model: ${GUIDED_SELLING_CARDS_MODEL} over your tenant's guided-selling rules.`,
      `Rule reason: ${reason}`,
      "The impact figure is a live preview at this quote's current multipliers; saving re-prices authoritatively on the server."
    ],
    action: aiAutopilotEnabled
      ? { id: "apply", kind: "primary", label: "Auto", disabled: true }
      : { id: "apply", kind: "primary", label: "Take it" },
    recommendation: item
  };
}

export function buildGuidedSellingCards({ recommendations = [], aiAutopilotEnabled = false } = {}) {
  const cards = (Array.isArray(recommendations) ? recommendations : [])
    .map((item) => buildGuidedSellingCard(item, { aiAutopilotEnabled }))
    .filter(Boolean);
  return {
    modelId: GUIDED_SELLING_CARDS_MODEL,
    cards,
    boundsNote: GUIDED_SELLING_BOUNDS_NOTE
  };
}
