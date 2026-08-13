import { describe, expect, it } from "vitest";
import starterCatalogPackData from "../../../functions/data/starterCatalogPacks.json";
import {
  getStarterCatalogPackSummary,
  STARTER_CATALOG_PACKS
} from "../starterCatalogPacks";

function countMenu(pack) {
  return (pack.eventTypes || []).reduce((totals, eventType) => ({
    sections: totals.sections + (eventType.sections || []).length,
    items: totals.items + (eventType.sections || []).reduce(
      (sum, section) => sum + (section.items || []).length,
      0
    )
  }), { sections: 0, items: 0 });
}

function latestManifestById() {
  const latest = new Map();
  const manifests = [
    ...(starterCatalogPackData.packs || []),
    ...(starterCatalogPackData.packageInclusionVersions || []).map((version) => {
      const base = (starterCatalogPackData.packs || []).find((pack) => (
        pack.id === version.id && Number(pack.version) === Number(version.baseVersion)
      ));
      return base
        ? {
            ...base,
            version: Number(version.version || 0),
            packageInclusions: version.packages || {}
          }
        : null;
    }).filter(Boolean)
  ];

  manifests.forEach((manifest) => {
    const current = latest.get(manifest.id);
    if (!current || Number(manifest.version || 0) > Number(current.version || 0)) {
      latest.set(manifest.id, manifest);
    }
  });
  return latest;
}

describe("starter catalog pack browser summaries", () => {
  it("stay synchronized with the latest server-owned manifests", () => {
    const manifests = latestManifestById();

    expect(STARTER_CATALOG_PACKS.map((pack) => pack.id)).toEqual(Array.from(manifests.keys()));
    STARTER_CATALOG_PACKS.forEach((summary) => {
      const manifest = manifests.get(summary.id);
      const menu = countMenu(manifest);
      expect(summary).toMatchObject({
        id: manifest.id,
        version: Number(manifest.version || 1),
        name: manifest.name,
        description: manifest.description,
        counts: {
          packages: (manifest.packages || []).length,
          addons: (manifest.addons || []).length,
          rentals: (manifest.rentals || []).length,
          eventTypes: (manifest.eventTypes || []).length,
          menuSections: menu.sections,
          menuItems: menu.items,
          packageInclusions: Object.values(manifest.packageInclusions || {}).reduce(
            (sum, inclusion) => sum
              + (inclusion.includedMenuItemIds || []).length
              + (inclusion.includedAddonIds || []).length
              + (inclusion.includedRentalIds || []).length,
            0
          )
        }
      });
    });
  });

  it("retains exact version lookup and frozen chooser metadata", () => {
    const wedding = getStarterCatalogPackSummary(" wedding-events ", 2);
    expect(wedding?.name).toBe("Wedding & events");
    expect(getStarterCatalogPackSummary("wedding-events", 1)).toBeNull();
    expect(Object.isFrozen(STARTER_CATALOG_PACKS)).toBe(true);
    expect(Object.isFrozen(wedding)).toBe(true);
    expect(Object.isFrozen(wedding?.counts)).toBe(true);
  });
});
