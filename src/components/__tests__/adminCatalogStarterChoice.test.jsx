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
  blurManagedMenuItemOnEnter,
  hasNoMenuInventory,
  resolveManagedEventTypeId
} from "../AdminCatalogModal";

function renderCatalog(catalog) {
  return renderToStaticMarkup(
    <AdminCatalogModal
      open
      catalog={catalog}
      organizationId="test-org"
      onClose={() => {}}
      onSave={async () => ({ ok: true })}
      onApplyStarterPack={async () => ({ ok: true })}
      saving={false}
    />
  );
}

describe("Admin Catalog starter choice", () => {
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
});
