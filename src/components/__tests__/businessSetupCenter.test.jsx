import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import BusinessSetupCenter from "../BusinessSetupCenter";

describe("BusinessSetupCenter", () => {
  test("expands unresolved setup while giving sales one coherent read-only boundary", () => {
    const html = renderToStaticMarkup(<BusinessSetupCenter
      currentUserRole="sales"
      catalog={{ source: "firebase", packages: [], eventTypes: [], settings: { menuSections: [] } }}
    />);
    expect(html).toContain('data-capability-id="business-setup-readiness"');
    expect(html).toContain('data-readiness-state="attention"');
    expect(html).toContain("Your path to the first quote");
    expect(html).toContain("7 setup areas need attention");
    expect(html).toContain('aria-label="First quote setup path"');
    expect(html).toContain('data-activation-stage="basics"');
    expect(html).toContain('data-activation-stage="menu"');
    expect(html).toContain('data-activation-stage="selling-price"');
    expect(html).toContain('data-activation-stage="cost-visibility"');
    expect(html.indexOf("Identity")).toBeLessThan(html.indexOf("Offerings"));
    expect(html).toContain('data-readiness-icon="identity"');
    expect(html).toContain('data-readiness-icon="offerings"');
    expect(html).toContain('data-readiness-icon="connections"');
    expect(html).toContain("An administrator manages changes and publishing");
    expect(html).not.toContain("Ask an administrator");
    expect(html).not.toContain("Unavailable by policy");
    expect(html).not.toContain("<button");
  });

  test("offers an import path when offers and menu are the next incomplete activation stage", () => {
    const html = renderToStaticMarkup(<BusinessSetupCenter
      catalog={{
        source: "firebase-org",
        organizationName: "North Star Catering",
        packages: [],
        eventTypes: [],
        settings: { organizationName: "North Star Catering", menuSections: [] }
      }}
      onOpenSection={() => {}}
      onOpenImport={() => {}}
    />);

    expect(html).toContain('data-activation-current="true"');
    expect(html).toContain("Build offers and menu");
    expect(html).toContain("Import an existing menu");
    expect(html).toContain("Missing costs do not block quoting");
  });

  test("compresses complete setup behind one healthy outcome", () => {
    const catalog = {
      source: "firebase-org",
      organizationName: "QuotePilot Catering",
      packages: [{ id: "offer-1", name: "Dinner", ppp: 42, costPpp: 20, active: true }],
      eventTypes: [{ id: "dinner", name: "Dinner", active: true }],
      managedMenuItems: [{ id: "menu-1", name: "Chicken", cost: 8, active: true }],
      settings: {
        organizationName: "QuotePilot Catering",
        catalogRevision: 4,
        pricingSetupConfirmed: true,
        pricingConfirmation: {
          actorUid: "admin-1",
          actorEmail: "admin@example.test",
          confirmedCatalogRevision: 4,
          confirmedAtISO: "2026-09-04T20:00:00.000Z"
        },
        serviceFeePct: 0.2,
        taxRate: 0.08,
        depositPct: 0.3,
        perMileRate: 1,
        longDistancePerMileRate: 1,
        serverRate: 40,
        chefRate: 50,
        bartenderRate: 45,
        staffingLaborEnabled: false,
        eventTemplates: [{ id: "dinner", name: "Dinner" }]
      }
    };
    const html = renderToStaticMarkup(<BusinessSetupCenter catalog={catalog} providerConnected />);

    expect(html).toContain('data-readiness-state="ready"');
    expect(html).toContain("Ready for quoting.");
    expect(html).toContain("8 setup areas ready");
    expect(html).toContain('data-readiness-icon="identity"');
    expect(html).toContain('data-state="ready"');
    expect(html).not.toContain("setup areas need attention");
    expect(html).not.toContain("business-setup-center__attention");
  });

  test("states the publishing consequence without leading with infrastructure language", () => {
    const html = renderToStaticMarkup(<BusinessSetupCenter
      catalog={{ source: "local", packages: [], eventTypes: [], settings: { menuSections: [] } }}
      onRefresh={() => {}}
    />);

    expect(html).toContain("Published Library");
    expect(html).toContain('data-readiness-icon="publishing"');
    expect(html).toContain("Publishing unavailable");
    expect(html).toContain("Your currently published settings remain active.");
    expect(html).toContain("Check again");
    expect(html).not.toContain("Firebase");
    expect(html).not.toContain("browser");
    expect(html).not.toContain("device-only");
  });
});
