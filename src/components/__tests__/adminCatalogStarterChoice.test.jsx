import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("../../lib/firebase", () => ({
  firebaseReady: false,
  storage: null
}));

vi.mock("../../lib/menuService", () => ({
  createCategory: vi.fn(),
  createEventType: vi.fn(),
  createMenuItem: vi.fn(),
  deleteMenuItem: vi.fn(),
  getEventTypes: vi.fn().mockResolvedValue([]),
  getMenuCategories: vi.fn().mockResolvedValue([]),
  getMenuItems: vi.fn().mockResolvedValue([]),
  updateCategory: vi.fn(),
  updateEventType: vi.fn(),
  updateMenuItem: vi.fn()
}));

import AdminCatalogModal, {
  AdminCatalogView,
  blurManagedMenuItemOnEnter,
  eventTemplateMenuItemReferences,
  hasUnrelatedManagedMenuDraft,
  hasNoMenuInventory,
  packageMenuItemReferences,
  parseEventTemplateDrafts,
  removeCatalogRowWithInclusions,
  resolveManagedEventTypeId
} from "../AdminCatalogModal";
import { DEFAULT_SETTINGS } from "../../data/mockCatalog";
import { applyPortalThemePreset } from "../../data/portalThemePresets";

function renderCatalog(catalog, props = {}) {
  return renderToStaticMarkup(
    <AdminCatalogModal
      open
      catalog={catalog}
      organizationId="test-org"
      onClose={() => {}}
      onSave={async () => ({ ok: true })}
      onApplyStarterPack={async () => ({ ok: true })}
      saving={false}
      {...props}
    />
  );
}

describe("Admin Catalog starter choice", () => {
  test("preserves modal compatibility while exposing an embedded route presentation", () => {
    const catalog = {
      packages: [],
      addons: [],
      rentals: [],
      settings: { pricingSetupConfirmed: false }
    };
    const embeddedHtml = renderToStaticMarkup(
      <AdminCatalogView
        open
        catalog={catalog}
        organizationId="test-org"
        onClose={() => {}}
        onSave={async () => ({ ok: true })}
        onApplyStarterPack={async () => ({ ok: true })}
        saving={false}
      />
    );
    const modalHtml = renderCatalog(catalog);

    expect(embeddedHtml).toContain("container workspace-route-main embedded-workspace-route");
    expect(embeddedHtml).toContain('role="region"');
    expect(embeddedHtml).toContain("workspace-route-card");
    expect(embeddedHtml).not.toContain('aria-modal="true"');
    expect(embeddedHtml).toContain(">Back to Home</button>");
    expect(modalHtml).toContain("modal-overlay");
    expect(modalHtml).toContain('role="dialog"');
    expect(modalHtml).toContain('aria-modal="true"');
    expect(modalHtml).toContain(">Close</button>");
  });

  test("blank setup shows only meaningful pack choices and one manual escape hatch", () => {
    const html = renderCatalog({
      packages: [],
      addons: [],
      rentals: [],
      settings: { pricingSetupConfirmed: false }
    });

    expect(html).toContain("What kind of catering do you do most?");
    expect(html.match(/<strong>Best for:<\/strong>/g)).toHaveLength(4);
    expect(html).toContain("Use Wedding &amp; events");
    expect(html).toContain("Use Corporate drop-off");
    expect(html).toContain("Build my catalog manually");
    expect(html).not.toContain(">Packages</button>");
    expect(html).not.toContain("Save catalog changes");
  });

  test("a staged pack opens on the populated catalog with normal editing choices", () => {
    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [],
      rentals: [],
      settings: {
        pricingSetupConfirmed: false,
        starterCatalogPack: {
          id: "wedding-events",
          version: 1,
          name: "Wedding & events",
          appliedCatalogRevision: 1
        }
      }
    });

    expect(html).toContain("Your Wedding &amp; events catalog is populated.");
    expect(html).toContain(">Packages</button>");
    expect(html).toContain(">Menu</button>");
    expect(html).toContain("View populated menu");
  });

  test("a confirmed catalog keeps starter provenance without a disabled pack decision", () => {
    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [],
      rentals: [],
      settings: {
        pricingSetupConfirmed: true,
        starterCatalogPack: {
          id: "wedding-events",
          version: 1,
          name: "Wedding & events",
          appliedCatalogRevision: 1
        }
      }
    });

    expect(html).toContain("Your Wedding &amp; events catalog is populated.");
    expect(html).not.toContain(">Starter Packs</button>");
    expect(html).not.toContain("What kind of catering do you do most?");
    expect(html).not.toContain("Starter packs are available only during initial unconfirmed catalog setup.");
  });

  test("package inclusions hide unavailable choices while keeping stale selections removable", () => {
    const html = renderCatalog({
      packages: [{
        id: "celebration",
        name: "Celebration",
        ppp: 28,
        includedAddonIds: ["retired-dessert"]
      }],
      addons: [
        { id: "active-dessert", name: "Active dessert", active: true },
        { id: "unused-retired-dessert", name: "Unused retired dessert", active: false },
        { id: "retired-dessert", name: "Retired dessert", active: false }
      ],
      rentals: [],
      settings: { pricingSetupConfirmed: true }
    });

    expect(html).toContain("Active dessert");
    expect(html).not.toContain("Unused retired dessert");
    expect(html).toContain("Retired dessert (inactive — remove from this package before saving)");
    expect(html).toContain("No active rentals available.");
  });

  test("removing add-ons or rentals also removes hidden package references", () => {
    const catalog = {
      packages: [{
        id: "celebration",
        includedAddonIds: ["dessert", "coffee"],
        includedRentalIds: ["linens", "chairs"]
      }],
      addons: [{ id: "dessert" }, { id: "coffee" }],
      rentals: [{ id: "linens" }, { id: "chairs" }],
      settings: {
        upsellRules: [
          { id: "dessert-rule", kind: "addon", targetId: "dessert" },
          { id: "chairs-rule", kind: "rental", targetId: "chairs" }
        ],
        eventTemplates: [{
          id: "wedding",
          pkg: "celebration",
          addons: ["dessert", "coffee"],
          rentals: ["linens", "chairs"]
        }]
      }
    };

    const withoutDessert = removeCatalogRowWithInclusions(catalog, "addons", 0);
    expect(withoutDessert.addons).toEqual([{ id: "coffee" }]);
    expect(withoutDessert.packages[0].includedAddonIds).toEqual(["coffee"]);
    expect(withoutDessert.packages[0].includedRentalIds).toEqual(["linens", "chairs"]);
    expect(withoutDessert.settings.upsellRules.map((rule) => rule.id)).toEqual(["chairs-rule"]);
    expect(withoutDessert.settings.eventTemplates[0].addons).toEqual(["coffee"]);

    const withoutLinens = removeCatalogRowWithInclusions(withoutDessert, "rentals", 0);
    expect(withoutLinens.rentals).toEqual([{ id: "chairs" }]);
    expect(withoutLinens.packages[0].includedRentalIds).toEqual(["chairs"]);
    expect(withoutLinens.settings.eventTemplates[0].rentals).toEqual(["chairs"]);
  });

  test("finds package references that must be removed before deleting a menu item", () => {
    const packages = [
      { id: "classic", name: "Classic", includedMenuItemIds: ["chicken"] },
      { id: "premium", name: "Premium", includedMenuItemIds: ["chicken", "rice"] },
      { id: "custom", name: "Custom", includedMenuItemIds: [] }
    ];

    expect(packageMenuItemReferences(packages, "chicken").map((pkg) => pkg.id))
      .toEqual(["classic", "premium"]);
    expect(packageMenuItemReferences(packages, "missing")).toEqual([]);
    const templates = [
      { id: "wedding", menuItems: ["chicken", "rice"] },
      { id: "corporate", menuItems: ["salad"] }
    ];
    expect(eventTemplateMenuItemReferences(templates, "chicken").map((template) => template.id))
      .toEqual(["wedding"]);
  });

  test("rejects malformed event-template dependencies instead of deleting through them", () => {
    expect(() => parseEventTemplateDrafts('{"id":"not-an-array"}')).toThrow("JSON array");
    expect(() => parseEventTemplateDrafts('[null]')).toThrow("must be an object");
    expect(() => parseEventTemplateDrafts('[{"id":"wedding","menuItems":"chicken"}]'))
      .toThrow("menuItems must be an array");
    expect(parseEventTemplateDrafts('[{"id":"wedding","menuItems":["chicken"]}]'))
      .toEqual([{ id: "wedding", menuItems: ["chicken"] }]);
  });

  test("Enter delegates menu item persistence to the single blur path", () => {
    const preventDefault = vi.fn();
    const blur = vi.fn();

    expect(blurManagedMenuItemOnEnter({
      key: "Enter",
      preventDefault,
      currentTarget: { blur }
    })).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(blur).toHaveBeenCalledOnce();

    expect(blurManagedMenuItemOnEnter({
      key: "Tab",
      preventDefault,
      currentTarget: { blur }
    })).toBe(false);
    expect(blur).toHaveBeenCalledOnce();
  });

  test("authoritative menu changes are blocked only by unrelated Admin drafts", () => {
    expect(hasUnrelatedManagedMenuDraft({
      catalogDraftDirty: true,
      targetItemId: "chicken"
    })).toBe(true);
    expect(hasUnrelatedManagedMenuDraft({
      menuItemDirty: { chicken: true },
      targetItemId: "chicken"
    })).toBe(false);
    expect(hasUnrelatedManagedMenuDraft({
      menuItemDirty: { chicken: true, rice: true },
      targetItemId: "chicken"
    })).toBe(true);
    expect(hasUnrelatedManagedMenuDraft({
      pendingMenuEditorDraft: true,
      targetItemId: "chicken"
    })).toBe(true);
  });

  test("a replaced pack falls back from a stale event selection to its first populated event", () => {
    const eventTypes = [
      { id: "wedding", name: "Wedding" },
      { id: "reception", name: "Reception" }
    ];

    expect(resolveManagedEventTypeId(eventTypes, "old-corporate-event")).toBe("wedding");
    expect(resolveManagedEventTypeId(eventTypes, "reception")).toBe("reception");
    expect(resolveManagedEventTypeId([], "old-corporate-event")).toBe("");
  });

  test("confirmed-menu recovery is offered only when the complete menu inventory is empty", () => {
    expect(hasNoMenuInventory([])).toBe(true);
    expect(hasNoMenuInventory([
      { categories: [], items: [] },
      { categories: [], items: [] }
    ])).toBe(true);
    expect(hasNoMenuInventory([
      { categories: [{ id: "mains" }], items: [] }
    ])).toBe(false);
    expect(hasNoMenuInventory([
      { categories: [], items: [{ id: "chicken" }] }
    ])).toBe(false);
  });

  test("pricing shows four named accessible portal presets and an immediate matching preview", () => {
    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [],
      rentals: [],
      settings: applyPortalThemePreset({
        ...DEFAULT_SETTINGS,
        brandName: "Northstar Catering",
        pricingSetupConfirmed: true
      }, "garden-sage")
    }, { initialTab: "pricing" });

    expect(html.match(/aria-label="Use /g)).toHaveLength(4);
    expect(html).toContain("Use Midnight Amber. Dark, cinematic backdrop with warm gold accents.");
    expect(html).toContain("Use Warm Linen. Soft neutral canvas for classic, elegant events.");
    expect(html).toContain("Use Garden Sage. Calm green palette for natural and community settings.");
    expect(html).toContain("Use Coastal Blue. Fresh blue palette for clean, modern proposals.");
    expect(html).toContain("aria-label=\"Customer portal preview: Garden Sage\"");
    expect(html).toContain("Your proposal from Northstar Catering");
    expect(html).toContain("aria-pressed=\"true\"");
  });
});
