export const PROPOSAL_DOCUMENT_FONT_SCALE_OPTIONS = Object.freeze([
  {
    id: "compact",
    label: "Compact",
    scale: 0.92,
    description: "Fits denser itemized proposals."
  },
  {
    id: "standard",
    label: "Standard",
    scale: 1,
    description: "Balanced for most catering proposals."
  },
  {
    id: "large",
    label: "Large",
    scale: 1.12,
    description: "Increases client-facing readability."
  }
]);

const FONT_SCALE_BY_ID = new Map(
  PROPOSAL_DOCUMENT_FONT_SCALE_OPTIONS.map((option) => [option.id, option])
);

export function normalizeProposalDocumentFontScale(value, fallback = "standard") {
  const source = value && typeof value === "object"
    ? value.id ?? value.value ?? value.scale
    : value;
  const normalized = String(source ?? "").trim().toLowerCase();
  if (FONT_SCALE_BY_ID.has(normalized)) return FONT_SCALE_BY_ID.get(normalized);

  const numeric = Number(source);
  if (Number.isFinite(numeric)) {
    if (numeric <= 0.96) return FONT_SCALE_BY_ID.get("compact");
    if (numeric >= 1.06) return FONT_SCALE_BY_ID.get("large");
    return FONT_SCALE_BY_ID.get("standard");
  }

  return FONT_SCALE_BY_ID.get(fallback) || FONT_SCALE_BY_ID.get("standard");
}

export function proposalDocumentFontSize(baseSize, preference = "standard") {
  const numeric = Number(baseSize);
  if (!Number.isFinite(numeric)) return 10;
  const option = normalizeProposalDocumentFontScale(preference);
  return Math.max(6, Math.round(numeric * option.scale * 10) / 10);
}
