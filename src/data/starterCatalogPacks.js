// The browser only needs chooser metadata. The complete versioned starter-pack
// manifests remain server-owned in functions/data/starterCatalogPacks.json and
// are applied through the existing guarded callable. Keeping that operational
// payload out of this presentation module avoids shipping every menu item and
// package inclusion to users who only need these four summaries.
const STARTER_CATALOG_PACK_SUMMARIES = [
  {
    id: "wedding-events",
    version: 2,
    name: "Wedding & events",
    description: "Reception-ready packages, service upgrades, rentals, and a polished event menu.",
    bestFor: "Receptions, cocktail hours, plated or buffet celebrations",
    outcome: "A polished full-service event catalog",
    counts: {
      packages: 3,
      addons: 4,
      rentals: 3,
      eventTypes: 1,
      menuSections: 6,
      menuItems: 22,
      packageInclusions: 18
    }
  },
  {
    id: "corporate-drop-off",
    version: 2,
    name: "Corporate drop-off",
    description: "Fast office ordering with breakfast, lunch, beverage, and meeting-service options.",
    bestFor: "Office breakfasts, team lunches, meetings, and drop-off orders",
    outcome: "A fast, repeatable workplace catering catalog",
    counts: {
      packages: 3,
      addons: 4,
      rentals: 3,
      eventTypes: 1,
      menuSections: 6,
      menuItems: 22,
      packageInclusions: 15
    }
  },
  {
    id: "bbq-southern",
    version: 2,
    name: "BBQ / Southern",
    description: "Smokehouse packages with familiar Southern sides, desserts, and buffet equipment.",
    bestFor: "Backyard events, smokehouse buffets, reunions, and casual service",
    outcome: "A focused BBQ and Southern favorites catalog",
    counts: {
      packages: 3,
      addons: 4,
      rentals: 3,
      eventTypes: 1,
      menuSections: 6,
      menuItems: 18,
      packageInclusions: 19
    }
  },
  {
    id: "church-community",
    version: 2,
    name: "Church & community",
    description: "Approachable group meals for fellowship events, community gatherings, and celebrations.",
    bestFor: "Fellowship meals, community groups, celebrations, and large gatherings",
    outcome: "An approachable group-meal catalog",
    counts: {
      packages: 3,
      addons: 4,
      rentals: 3,
      eventTypes: 1,
      menuSections: 6,
      menuItems: 20,
      packageInclusions: 19
    }
  }
];

export const STARTER_CATALOG_PACKS = Object.freeze(
  STARTER_CATALOG_PACK_SUMMARIES.map((pack) => Object.freeze({
    ...pack,
    counts: Object.freeze({ ...pack.counts })
  }))
);

export function getStarterCatalogPackSummary(packId = "", packVersion = null) {
  const normalizedId = String(packId || "").trim();
  return STARTER_CATALOG_PACKS.find((pack) => (
    pack.id === normalizedId
    && (packVersion === null || Number(pack.version) === Number(packVersion))
  )) || null;
}
