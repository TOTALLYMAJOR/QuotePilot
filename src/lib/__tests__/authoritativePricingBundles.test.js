import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { calculateQuotePricingAuthoritative } = require("../../../functions/pricingEngine.js");

function docs(items) {
  return items.map((item) => ({ id: item.id, data: () => item }));
}

function fakePricingDb() {
  const collections = {
    catalogPackages: [
      {
        id: "premium",
        name: "Premium",
        ppp: 24,
        includedAddonIds: ["tea"],
        includedRentalIds: ["linens"],
        includedMenuItemIds: ["salad"]
      }
    ],
    catalogAddons: [{ id: "tea", name: "Sweet Tea", price: 2, pricingType: "per_person" }],
    catalogRentals: [{ id: "linens", name: "Linens", price: 8, pricingType: "per_item", qtyPerGuests: 8 }]
  };
  const settings = {
    serviceFeePct: 0,
    taxRate: 0,
    depositPct: 0,
    menuSections: [{
      id: "sides",
      name: "Sides",
      items: [{ id: "salad", name: "Salad", price: 3, pricingType: "per_person" }]
    }]
  };

  return {
    collection() {
      return {
        doc() {
          return {
            collection(name) {
              return {
                async get() {
                  return { docs: docs(collections[name] || []) };
                },
                doc() {
                  return {
                    async get() {
                      return { exists: true, data: () => settings };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

describe("server-authoritative package bundles", () => {
  test("marks selected bundle items as included and charges zero", async () => {
    const result = await calculateQuotePricingAuthoritative({
      db: fakePricingDb(),
      data: {
        organizationId: "demo-org",
        event: { guests: 40, hours: 4, date: "2026-09-12" },
        selection: {
          package: { id: "premium" },
          addons: [{ id: "tea" }],
          rentals: [{ id: "linens" }],
          menuItems: [{ id: "salad" }]
        }
      },
      staff: { organizationId: "demo-org", uid: "staff-1", role: "admin" }
    });

    const includedLines = result.pricing.lineItems.filter((line) => ["addon", "rental", "menu_item"].includes(line.category));
    expect(includedLines).toHaveLength(3);
    expect(includedLines.every((line) => line.total === 0)).toBe(true);
    expect(includedLines.every((line) => line.meta.includedInPackage === true)).toBe(true);
    expect(result.pricing.lineItems.find((line) => line.category === "package")?.total).toBe(960);
  });
});
