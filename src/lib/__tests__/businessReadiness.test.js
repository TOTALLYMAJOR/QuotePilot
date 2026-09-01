import { describe, expect, test } from "vitest";
import { buildBusinessReadiness, SETUP_ROW_STATUSES } from "../businessReadiness";

function readyCatalog() {
  return {
    source: "firebase",
    observedAtISO: "2026-09-01T01:00:00.000Z",
    organizationName: "Toni Catering",
    packages: [{ id: "p", name: "Celebration", ppp: 48, costPpp: 22, active: true }],
    addons: [{ id: "a", name: "Coffee", cost: 2, active: true }],
    rentals: [{ id: "r", name: "Chair", cost: 4, active: true }],
    eventTypes: [{ id: "wedding", name: "Wedding", active: true }],
    settings: {
      organizationName: "Toni Catering",
      catalogRevision: 7,
      pricingSetupConfirmed: true,
      pricingConfirmation: {
        actorUid: "admin",
        actorEmail: "admin@example.com",
        confirmedCatalogRevision: 7,
        confirmedAtISO: "2026-09-01T01:00:00.000Z"
      },
      serviceFeePct: 0.2,
      taxRate: 0.08,
      depositPct: 0.25,
      perMileRate: 2,
      longDistancePerMileRate: 3,
      serverRate: 48,
      chefRate: 62,
      bartenderRate: 50,
      serverCostRate: 24,
      chefCostRate: 32,
      bartenderCostRate: 28,
      staffingLaborEnabled: true,
      menuSections: [{ id: "s", name: "Dinner", items: [{ id: "m", name: "Salmon", price: 34, cost: 15, active: true }] }],
      eventTemplates: []
    }
  };
}

describe("business readiness", () => {
  test("keeps quote readiness independent from optional costs, users, connections, and starting points", () => {
    const catalog = readyCatalog();
    catalog.settings.menuSections[0].items[0].cost = null;
    catalog.settings.serverCostRate = null;
    const model = buildBusinessReadiness({ catalog, providerConnected: false });
    expect(model.projections.businessReadyToQuote.ready).toBe(true);
    expect(model.projections.marginEvidenceComplete.ready).toBe(false);
    expect(model.projections.providerConnectionReady.ready).toBe(false);
    expect(model.rows.find((row) => row.id === "costs").detail).toContain("costs recorded");
  });

  test("uses exactly one approved status and next action for every ordered setup row", () => {
    const model = buildBusinessReadiness({ catalog: readyCatalog(), currentUserRole: "sales" });
    expect(model.rows.map((row) => row.label)).toEqual([
      "Identity", "Offerings", "Pricing", "Costs and margin evidence",
      "Quote starting points", "Staffing policy", "Users and roles", "Connections"
    ]);
    model.rows.forEach((row) => {
      expect(SETUP_ROW_STATUSES).toContain(row.status);
      expect(row.nextAction).toBeTruthy();
    });
    expect(model.rows.find((row) => row.id === "users").status).toBe("Unavailable by policy");
  });

  test("does not call 11 of 11 complete when a managed menu cost is missing", () => {
    const catalog = readyCatalog();
    catalog.settings.menuSections[0].items[0].cost = null;
    const model = buildBusinessReadiness({ catalog });
    expect(model.costs.complete).toBe(false);
    expect(model.costs.missing).toContain("Salmon");
  });
});
