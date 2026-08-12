const MAX_DECISION_NOTE_LENGTH = 1200;
const SUPPORTED_OPTION_TYPES = new Set(["addon", "rental"]);
const SUPPORTED_PRICING_TYPES = new Set(["per_person", "per_item", "per_event"]);

function cleanText(value, maxLength = 200) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function finiteNonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function normalizeDecisionRoomOptions(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((option) => {
      const itemType = cleanText(option?.itemType, 16).toLowerCase();
      const name = cleanText(option?.name);
      if (!SUPPORTED_OPTION_TYPES.has(itemType) || !name) return null;
      const pricingTypeInput = cleanText(option?.pricingType, 32).toLowerCase();
      const pricingType = SUPPORTED_PRICING_TYPES.has(pricingTypeInput)
        ? pricingTypeInput
        : itemType === "addon" ? "per_person" : "per_item";
      const key = `${itemType}:${name.toLowerCase()}:${pricingType}:${finiteNonNegative(option?.price)}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return Object.freeze({
        key,
        itemType,
        name,
        price: finiteNonNegative(option?.price),
        pricingType
      });
    })
    .filter(Boolean)
    .slice(0, 12);
}

export function decisionRoomOptionSentence(option) {
  const name = cleanText(option?.name).replace(/[.!?]+$/u, "");
  return name ? `Please add ${name}.` : "";
}

export function decisionRoomOptionSelected(message, option) {
  const sentence = decisionRoomOptionSentence(option);
  if (!sentence) return false;
  return String(message || "")
    .split("\n")
    .some((line) => line.trim() === sentence);
}

export function toggleDecisionRoomOption({
  message = "",
  option,
  selected = false,
  maxLength = MAX_DECISION_NOTE_LENGTH
} = {}) {
  const current = String(message || "");
  const sentence = decisionRoomOptionSentence(option);
  if (!sentence) {
    return Object.freeze({ message: current, selected: false, outcome: "unavailable" });
  }

  const lines = current.split("\n");
  const selectedLine = lines.findIndex((line) => line.trim() === sentence);
  if (selected && selectedLine >= 0) {
    const next = lines
      .filter((_, index) => index !== selectedLine)
      .join("\n")
      .replace(/^\n+|\n+$/gu, "");
    return Object.freeze({ message: next, selected: false, outcome: "removed" });
  }

  if (selected) {
    return Object.freeze({ message: current, selected: false, outcome: "missing" });
  }

  if (selectedLine >= 0) {
    return Object.freeze({
      message: current,
      selected: false,
      outcome: "already_present"
    });
  }

  const prefix = current.trimEnd();
  const next = prefix ? `${prefix}\n${sentence}` : sentence;
  if (next.length > maxLength) {
    return Object.freeze({ message: current, selected: false, outcome: "limit" });
  }
  return Object.freeze({ message: next, selected: true, outcome: "added" });
}

export function discardGeneratedDecisionRoomOptions({
  message = "",
  options = [],
  selectedKeys = []
} = {}) {
  const generatedKeys = new Set(Array.isArray(selectedKeys) ? selectedKeys : []);
  let nextMessage = String(message || "");
  let removedCount = 0;

  normalizeDecisionRoomOptions(options).forEach((option) => {
    if (!generatedKeys.has(option.key)) return;
    const result = toggleDecisionRoomOption({
      message: nextMessage,
      option,
      selected: true
    });
    if (result.outcome !== "removed") return;
    nextMessage = result.message;
    removedCount += 1;
  });

  return Object.freeze({ message: nextMessage, removedCount });
}
