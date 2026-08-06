import { describe, expect, test } from "vitest";
import {
  catalogReconciliationNotice,
  reconcileCatalogSelections
} from "../catalogSelectionReconciliation";

describe("catalog selection reconciliation", () => {
  test("removes missing or inactive selections and their quantities without silently discarding valid choices", () => {
    const form = {
      pkg: "retired-package",
      addons: ["dessert", "retired-addon"],
      addonQuantities: { dessert: 2, "retired-addon": 3 },
      rentals: ["linens", "missing-rental"],
      rentalQuantities: { linens: 4, "missing-rental": 1 },
      menuItems: ["chicken", "retired-menu"],
      menuItemQuantities: { chicken: 1, "retired-menu": 2 }
    };
    const result = reconcileCatalogSelections({
      form,
      catalog: {
        packages: [{ id: "classic", name: "Classic", ppp: 20 }],
        addons: [
          { id: "dessert", active: true },
          { id: "retired-addon", active: false }
        ],
        rentals: [{ id: "linens", active: true }]
      },
      menuItemIds: new Set(["chicken"])
    });

    expect(result.changed).toBe(true);
    expect(result.userSelectionChanged).toBe(true);
    expect(result.form).toMatchObject({
      pkg: "classic",
      addons: ["dessert"],
      addonQuantities: { dessert: 2 },
      rentals: ["linens"],
      rentalQuantities: { linens: 4 },
      menuItems: ["chicken"],
      menuItemQuantities: { chicken: 1 }
    });
    expect(catalogReconciliationNotice(result.removed))
      .toContain("1 package, 1 add-on, 1 rental, 1 menu item");
  });

  test("defaults an empty package without treating it as discarded user work", () => {
    const result = reconcileCatalogSelections({
      form: { pkg: "", addons: [], rentals: [], menuItems: [] },
      catalog: { packages: [{ id: "classic", name: "Classic", ppp: 20 }] }
    });
    expect(result.changed).toBe(true);
    expect(result.userSelectionChanged).toBe(false);
    expect(result.form.pkg).toBe("classic");
  });
});
