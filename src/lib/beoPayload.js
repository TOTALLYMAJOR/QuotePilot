import { buildKitchenCheckpoints, PRODUCTION_CHECKLIST_ITEMS } from "./quoteWorkflow";

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toList(input) {
  return Array.isArray(input) ? input.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

// Cross-references the fixed checklist definitions against persisted completion
// state and groups the result by phase, preserving PRODUCTION_CHECKLIST_ITEMS's
// existing order within each group.
function buildProductionChecklistByPhase(quote) {
  const persisted = Array.isArray(quote.booking?.productionChecklist)
    ? quote.booking.productionChecklist
    : [];
  const persistedById = new Map(
    persisted
      .filter((item) => Boolean(cleanText(item?.id)))
      .map((item) => [cleanText(item.id), item])
  );

  const groups = [];
  const groupIndexByName = new Map();

  PRODUCTION_CHECKLIST_ITEMS.forEach((definition) => {
    const stored = persistedById.get(definition.id) || {};
    const item = {
      id: definition.id,
      label: definition.label,
      completed: stored.completed === true,
      completedAtISO: cleanText(stored.completedAtISO),
      completedByEmail: cleanText(stored.completedByEmail)
    };

    if (!groupIndexByName.has(definition.group)) {
      groupIndexByName.set(definition.group, groups.length);
      groups.push({ group: definition.group, items: [] });
    }
    groups[groupIndexByName.get(definition.group)].items.push(item);
  });

  return groups;
}

export function buildBeoPayload(quote) {
  if (!quote) {
    throw new Error("Missing quote data for BEO payload.");
  }

  return {
    quoteNumber: cleanText(quote.quoteNumber),
    organizationName: cleanText(quote.quoteMeta?.organizationName),
    event: {
      name: cleanText(quote.event?.name),
      date: cleanText(quote.event?.date),
      time: cleanText(quote.event?.time),
      venue: cleanText(quote.event?.venue),
      venueAddress: cleanText(quote.event?.venueAddress),
      guests: toNumber(quote.event?.guests, 0),
      hours: toNumber(quote.event?.hours, 0),
      style: cleanText(quote.event?.style),
      dietaryRestrictions: cleanText(quote.event?.dietaryRestrictions)
    },
    staffing: {
      servers: toNumber(quote.event?.servers, 0),
      chefs: toNumber(quote.event?.chefs, 0),
      bartenders: toNumber(quote.event?.bartenders, 0),
      staffLead: cleanText(quote.booking?.staffLead)
    },
    selections: {
      packageName: cleanText(quote.selection?.packageName),
      menuItemNames: toList(quote.selection?.menuItemNames),
      addons: toList(quote.selection?.addons),
      rentals: toList(quote.selection?.rentals)
    },
    checkpoints: buildKitchenCheckpoints({
      time: quote.event?.time,
      hours: quote.event?.hours,
      kitchenCheckpointOverrides: quote.booking?.kitchenCheckpoints
    }),
    productionChecklist: buildProductionChecklistByPhase(quote)
  };
}
