import starterCatalogPackData from "../../functions/data/starterCatalogPacks.json";

function countMenu(pack) {
  return (pack.eventTypes || []).reduce((totals, eventType) => {
    totals.sections += (eventType.sections || []).length;
    totals.items += (eventType.sections || []).reduce(
      (sum, section) => sum + (section.items || []).length,
      0
    );
    return totals;
  }, { sections: 0, items: 0 });
}

const latestById = new Map();
const summarizedPacks = [
  ...(starterCatalogPackData.packs || []),
  ...(starterCatalogPackData.packageInclusionVersions || []).map((version) => {
    const base = (starterCatalogPackData.packs || []).find((pack) => (
      pack.id === version.id && Number(pack.version) === Number(version.baseVersion)
    ));
    if (!base) return null;
    return {
      ...base,
      version: Number(version.version || 0),
      packageInclusions: version.packages || {}
    };
  }).filter(Boolean)
];

summarizedPacks.forEach((pack) => {
  const current = latestById.get(pack.id);
  if (!current || Number(pack.version || 0) > Number(current.version || 0)) {
    latestById.set(pack.id, pack);
  }
});

const PACK_CHOICE_GUIDANCE = Object.freeze({
  "wedding-events": Object.freeze({
    bestFor: "Receptions, cocktail hours, plated or buffet celebrations",
    outcome: "A polished full-service event catalog"
  }),
  "corporate-drop-off": Object.freeze({
    bestFor: "Office breakfasts, team lunches, meetings, and drop-off orders",
    outcome: "A fast, repeatable workplace catering catalog"
  }),
  "bbq-southern": Object.freeze({
    bestFor: "Backyard events, smokehouse buffets, reunions, and casual service",
    outcome: "A focused BBQ and Southern favorites catalog"
  }),
  "church-community": Object.freeze({
    bestFor: "Fellowship meals, community groups, celebrations, and large gatherings",
    outcome: "An approachable group-meal catalog"
  })
});

export const STARTER_CATALOG_PACKS = Object.freeze(
  Array.from(latestById.values()).map((pack) => {
    const menu = countMenu(pack);
    const guidance = PACK_CHOICE_GUIDANCE[pack.id] || {};
    return Object.freeze({
      id: pack.id,
      version: Number(pack.version || 1),
      name: pack.name,
      description: pack.description,
      bestFor: guidance.bestFor || pack.description,
      outcome: guidance.outcome || "A complete editable catering catalog",
      counts: Object.freeze({
        packages: (pack.packages || []).length,
        addons: (pack.addons || []).length,
        rentals: (pack.rentals || []).length,
        eventTypes: (pack.eventTypes || []).length,
        menuSections: menu.sections,
        menuItems: menu.items,
        packageInclusions: Object.values(pack.packageInclusions || {}).reduce(
          (sum, inclusion) => sum
            + (inclusion.includedMenuItemIds || []).length
            + (inclusion.includedAddonIds || []).length
            + (inclusion.includedRentalIds || []).length,
          0
        )
      })
    });
  })
);

export function getStarterCatalogPackSummary(packId = "", packVersion = null) {
  const normalizedId = String(packId || "").trim();
  return STARTER_CATALOG_PACKS.find((pack) => (
    pack.id === normalizedId
    && (packVersion === null || Number(pack.version) === Number(packVersion))
  )) || null;
}
