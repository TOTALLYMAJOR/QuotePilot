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

import AdminCatalogModal from "../AdminCatalogModal";

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
});
