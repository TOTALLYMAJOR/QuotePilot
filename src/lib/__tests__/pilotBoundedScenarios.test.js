import { describe, expect, test } from "vitest";
import {
  PILOT_BOUNDED_SCENARIO_LIMITS,
  PILOT_BOUNDED_SCENARIO_MODEL,
  generatePilotBoundedScenarios,
  parsePilotBoundedScenarioIntent
} from "../pilotBoundedScenarios";

const ORGANIZATION_ID = "scenario-test-org";
const OBSERVED_AT = "2026-08-12T12:00:00.000Z";

function settings(overrides = {}) {
  return {
    depositPct: 0.3,
    serviceFeePct: 0,
    serviceFeeTiers: [],
    taxRate: 0,
    taxRegions: [],
    seasonalProfiles: [],
    staffingLaborEnabled: false,
    staffingChargeMode: "per_hour",
    serverRate: 0,
    chefRate: 0,
    bartenderRate: 0,
    perMileRate: 0,
    longDistancePerMileRate: 0,
    deliveryThresholdMiles: 0,
    targetMarginPct: 0.4,
    ...overrides
  };
}

function catalogEvidence(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    sourceLabel: "firebase-org",
    catalogRevision: 17,
    freshness: { state: "fresh", observedAtISO: OBSERVED_AT },
    packages: [
      { id: "core", name: "Core package", ppp: 50, costPpp: 30, active: true },
      { id: "lean", name: "Lean package", ppp: 40, costPpp: 20, active: true },
      { id: "premium", name: "Premium package", ppp: 70, costPpp: 30, active: true },
      { id: "inactive", name: "Inactive package", ppp: 5, costPpp: 2, active: false }
    ],
    addons: [
      {
        id: "champagne",
        name: "Champagne service",
        price: 1000,
        cost: 900,
        pricingType: "per_event",
        active: true
      },
      {
        id: "lighting",
        name: "Room lighting",
        price: 500,
        cost: 50,
        pricingType: "per_event",
        active: true
      },
      {
        id: "retired-addon",
        name: "Retired add-on",
        price: 1,
        cost: 0,
        pricingType: "per_event",
        active: false
      }
    ],
    rentals: [
      {
        id: "linen",
        name: "Linen",
        price: 10,
        cost: 8,
        pricingType: "per_item",
        active: true
      },
      {
        id: "chair",
        name: "Chair",
        price: 5,
        cost: 2,
        pricingType: "per_item",
        active: true
      }
    ],
    menuSections: [{
      id: "desserts",
      name: "Desserts",
      items: [
        {
          id: "dessert",
          name: "Dessert course",
          price: 8,
          cost: 7,
          pricingType: "per_person",
          active: true
        },
        {
          id: "coffee",
          name: "Coffee service",
          price: 5,
          cost: 1,
          pricingType: "per_person",
          active: true
        }
      ]
    }],
    upsellRules: [{
      id: "lighting-rule-private-label",
      enabled: true,
      kind: "addon",
      targetId: "lighting",
      minGuests: 50,
      minHours: 0,
      reason: "PRIVATE CUSTOMER WORDING MUST NOT ESCAPE"
    }],
    ...overrides
  };
}

function form(overrides = {}) {
  return {
    pkg: "core",
    eventTemplateId: "wedding-template",
    guests: 100,
    hours: 4,
    style: "Plated",
    servers: 0,
    chefs: 0,
    bartenders: 0,
    milesRT: 0,
    addons: ["champagne"],
    rentals: [],
    menuItems: ["dessert"],
    addonQuantities: {},
    rentalQuantities: {},
    menuItemQuantities: {},
    customerName: "PRIVATE CUSTOMER SENTINEL",
    eventName: "PRIVATE EVENT SENTINEL",
    venue: "PRIVATE VENUE SENTINEL",
    notes: "PRIVATE NOTES SENTINEL",
    ...overrides
  };
}

function staffingEvidence(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    state: "current",
    rules: [{
      id: "private-staffing-rule-id",
      active: true,
      style: "Plated",
      recommended: { servers: 4, chefs: 0, bartenders: 0 }
    }],
    ...overrides
  };
}

function generate(overrides = {}) {
  return generatePilotBoundedScenarios({
    intent: { kind: "under_budget", budget: 5900 },
    organizationId: ORGANIZATION_ID,
    form: form(),
    catalogEvidence: catalogEvidence(),
    settings: settings(),
    staffingEvidence: staffingEvidence(),
    lockedScope: [],
    clock: () => 0,
    ...overrides
  });
}

describe("parsePilotBoundedScenarioIntent", () => {
  test("recognizes only an explicit stated USD budget", () => {
    expect(parsePilotBoundedScenarioIntent("Get this under $6,250.50")).toEqual({
      kind: "under_budget",
      budget: 6250.5,
      currency: "USD",
      targetMarginPct: null
    });
    expect(parsePilotBoundedScenarioIntent("Keep it within a budget of USD 7,000")).toEqual({
      kind: "under_budget",
      budget: 7000,
      currency: "USD",
      targetMarginPct: null
    });
    expect(parsePilotBoundedScenarioIntent("Make it cheaper")).toBeNull();
    expect(parsePilotBoundedScenarioIntent("Keep it under budget")).toBeNull();
  });

  test("recognizes margin improvement without inventing a target", () => {
    expect(parsePilotBoundedScenarioIntent("Improve the margin")).toEqual({
      kind: "improve_margin",
      budget: null,
      currency: "USD",
      targetMarginPct: null
    });
    expect(parsePilotBoundedScenarioIntent("Raise margin to 42.5%")).toEqual({
      kind: "improve_margin",
      budget: null,
      currency: "USD",
      targetMarginPct: 0.425
    });
    expect(parsePilotBoundedScenarioIntent("Increase revenue")).toBeNull();
  });
});

describe("generatePilotBoundedScenarios", () => {
  test("returns frozen explicit-adoption proposals with every compromise and client preview", () => {
    const result = generate();

    expect(result).toMatchObject({
      modelId: PILOT_BOUNDED_SCENARIO_MODEL,
      state: "available",
      commandClass: "simulation",
      authorityLevel: "draft",
      adoption: { required: true }
    });
    expect(result.proposals.length).toBeGreaterThan(0);
    for (const proposal of result.proposals) {
      expect(proposal.compromises.length).toBeGreaterThan(0);
      expect(proposal.compromises).toHaveLength(Object.keys(
        Object.fromEntries(proposal.compromises.map((item) => [item.dimension, true]))
      ).length);
      expect(proposal.clientPreview.before).toMatchObject({ total: 6800, deposit: 2040 });
      expect(proposal.clientPreview.after.total).toBeLessThanOrEqual(5900);
      expect(proposal.clientPreview.after.deposit).toBe(
        proposal.clientPreview.after.total * 0.3
      );
      expect(proposal).toMatchObject({
        why: expect.any(String),
        consequence: expect.any(String),
        doNothing: expect.any(String),
        confidence: { level: "medium", basis: expect.any(String) },
        adoption: {
          required: true,
          outcomeLabel: "Adopt in draft review",
          allowedAfterExplicitConfirmation: true
        }
      });
      expect(proposal.boundary).toContain("does not mutate or save");
    }
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.proposals[0].patch)).toBe(true);
    expect(() => {
      result.proposals[0].patch.pkg = "inactive";
    }).toThrow();
  });

  test("preserves every caller-declared lock and never enumerates inactive catalog records", () => {
    const result = generate({
      lockedScope: ["package", "event_template", "staffing"]
    });

    expect(result.state).toBe("available");
    expect(result.lockedScope).toEqual(["event_template", "package", "staffing"]);
    expect(result.proposals.some((proposal) => proposal.patch.addons?.length === 0)).toBe(true);
    for (const proposal of result.proposals) {
      expect(proposal.changedFields).not.toContain("pkg");
      expect(proposal.changedFields).not.toContain("eventTemplateId");
      expect(proposal.changedFields).not.toContain("servers");
      expect(JSON.stringify(proposal)).not.toContain("inactive");
      expect(JSON.stringify(proposal)).not.toContain("retired-addon");
    }
  });

  test("returns no match instead of crossing a fully locked scope", () => {
    const result = generate({
      lockedScope: ["package", "event_template", "addons", "rentals", "menu", "staffing"]
    });

    expect(result.state).toBe("no_match");
    expect(result.proposals).toEqual([]);
    expect(result.bounds.candidatesEvaluated).toBe(0);
    expect(result.unavailableReasons.join(" ")).toContain("declared locked scope");
  });

  test("uses only an active exact-tenant staffing rule for a staffing alternative", () => {
    const staffingSettings = settings({
      staffingLaborEnabled: true,
      serverRate: 100,
      serverCostRate: 60,
      chefRate: 0,
      chefCostRate: 0,
      bartenderRate: 0,
      bartenderCostRate: 0
    });
    const result = generate({
      intent: { kind: "under_budget", budget: 7000 },
      form: form({
        addons: [],
        menuItems: [],
        servers: 10,
        eventTemplateId: "custom"
      }),
      settings: staffingSettings,
      lockedScope: ["package", "event_template", "addons", "rentals", "menu"],
      staffingEvidence: staffingEvidence({
        rules: [
          {
            active: false,
            style: "Plated",
            recommended: { servers: 1, chefs: 0, bartenders: 0 }
          },
          {
            active: true,
            style: "Plated",
            recommended: { servers: 4, chefs: 0, bartenders: 0 }
          },
          {
            active: true,
            style: "Buffet",
            recommended: { servers: 2, chefs: 0, bartenders: 0 }
          }
        ]
      })
    });

    expect(result.state).toBe("available");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].patch).toEqual({
      servers: 4,
      chefs: 0,
      bartenders: 0
    });
    expect(result.proposals[0].clientPreview).toMatchObject({
      before: { total: 9000, deposit: 2700 },
      after: { total: 6600, deposit: 1980 }
    });
    expect(result.proposals[0].compromises[0].why).toContain("active current-tenant staffing rule");
  });

  test("generates only provable recorded-cost margin improvements", () => {
    const result = generate({
      intent: { kind: "improve_margin" },
      marginEnabled: true,
      marginAuthorized: true,
      limits: { results: 5 },
      lockedScope: ["staffing"]
    });

    expect(result.state).toBe("available");
    expect(result.baseline.margin).toMatchObject({
      state: "available",
      available: true,
      revenue: 6800,
      cost: 4600
    });
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.proposals.some((proposal) => (
      proposal.compromises.some((item) => item.after === "Added add-on")
      && proposal.patch.addons?.includes("lighting")
    ))).toBe(true);
    for (const proposal of result.proposals) {
      expect(proposal.marginEvidence.before.available).toBe(true);
      expect(proposal.marginEvidence.after.available).toBe(true);
      expect(proposal.marginEvidence.deltaPercentagePoints).toBeGreaterThan(0);
      expect(proposal.marginEvidence.after.marginPct).toBeGreaterThan(
        proposal.marginEvidence.before.marginPct
      );
    }
  });

  test("fails margin generation closed for null, blank, missing, or unauthorized costs", () => {
    const missingCostEvidence = catalogEvidence({
      menuSections: [{
        id: "desserts",
        name: "Desserts",
        items: [{
          id: "dessert",
          name: "Dessert course",
          price: 8,
          cost: null,
          pricingType: "per_person",
          active: true
        }]
      }]
    });
    const missing = generate({
      intent: { kind: "improve_margin" },
      catalogEvidence: missingCostEvidence,
      marginEnabled: true,
      marginAuthorized: true
    });
    expect(missing.state).toBe("unavailable");
    expect(missing.proposals).toEqual([]);
    expect(missing.baseline.margin).toMatchObject({ available: false, state: "unavailable" });
    expect(missing.unavailableReasons.join(" ")).toContain("Dessert course (cost)");
    expect(missing.unavailableReasons.join(" ")).toContain("No zero-cost assumption");

    const unauthorized = generate({
      intent: { kind: "improve_margin" },
      catalogEvidence: catalogEvidence({
        packages: [{ id: "core", name: "Core package", ppp: 50, costPpp: 987.65, active: true }]
      }),
      form: form({ addons: [], menuItems: [] }),
      marginEnabled: true,
      marginAuthorized: false
    });
    expect(unauthorized.state).toBe("unavailable");
    expect(unauthorized.baseline.margin.reason).toContain("staff-commercial authorization");
    expect(JSON.stringify(unauthorized)).not.toContain("987.65");
  });

  test("keeps customer and user data out of every result and leaves every input untouched", () => {
    const privateForm = form();
    const privateCatalog = catalogEvidence();
    const privateStaffing = staffingEvidence();
    const inputSnapshot = JSON.parse(JSON.stringify({
      privateForm,
      privateCatalog,
      privateStaffing
    }));

    const result = generate({
      form: privateForm,
      catalogEvidence: privateCatalog,
      staffingEvidence: privateStaffing
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("PRIVATE CUSTOMER SENTINEL");
    expect(serialized).not.toContain("PRIVATE EVENT SENTINEL");
    expect(serialized).not.toContain("PRIVATE VENUE SENTINEL");
    expect(serialized).not.toContain("PRIVATE NOTES SENTINEL");
    expect(serialized).not.toContain("PRIVATE CUSTOMER WORDING MUST NOT ESCAPE");
    expect(serialized).not.toContain(ORGANIZATION_ID);
    expect(serialized).not.toContain("private-staffing-rule-id");
    expect({ privateForm, privateCatalog, privateStaffing }).toEqual(inputSnapshot);
  });

  test("fails closed for stale or cross-tenant catalog evidence", () => {
    const stale = generate({
      catalogEvidence: catalogEvidence({
        freshness: { state: "stale", observedAtISO: OBSERVED_AT }
      })
    });
    expect(stale.state).toBe("unavailable");
    expect(stale.proposals).toEqual([]);
    expect(stale.unavailableReasons.join(" ")).toContain("fresh, exact-revision");

    const crossTenant = generate({
      catalogEvidence: catalogEvidence({ organizationId: "different-org" })
    });
    expect(crossTenant.state).toBe("unavailable");
    expect(crossTenant.unavailableReasons.join(" ")).toContain("does not match");
  });

  test("stops at hard candidate, result, and runtime bounds", () => {
    const bounded = generate({
      limits: {
        atomicAlternatives: 2,
        candidates: 3,
        results: 1,
        runtimeMs: 1
      }
    });
    expect(bounded.bounds.atomicAlternativesEnumerated).toBeLessThanOrEqual(2);
    expect(bounded.bounds.candidatesEvaluated).toBeLessThanOrEqual(3);
    expect(bounded.proposals.length).toBeLessThanOrEqual(1);
    expect(bounded.bounds.truncated).toBe(true);

    let clockCalls = 0;
    const timedOut = generate({
      limits: { runtimeMs: PILOT_BOUNDED_SCENARIO_LIMITS.runtimeMs },
      clock: () => {
        clockCalls += 1;
        return clockCalls === 1 ? 0 : PILOT_BOUNDED_SCENARIO_LIMITS.runtimeMs + 1;
      }
    });
    expect(timedOut.bounds.deadlineReached).toBe(true);
    expect(timedOut.bounds.candidatesEvaluated).toBe(0);
    expect(timedOut.proposals).toEqual([]);
    expect(timedOut.unavailableReasons.join(" ")).toContain("runtime budget ended");
  });

  test("reports satisfied and no-match outcomes without inventing a compromise", () => {
    const alreadyUnder = generate({
      intent: { kind: "under_budget", budget: 7000 }
    });
    expect(alreadyUnder.state).toBe("satisfied");
    expect(alreadyUnder.proposals).toEqual([]);
    expect(alreadyUnder.why).toContain("already within");

    const unsupported = generate({ intent: "Make this awesome" });
    expect(unsupported.state).toBe("unavailable");
    expect(unsupported.proposals).toEqual([]);
    expect(unsupported.unavailableReasons.join(" ")).toContain("explicit");
  });
});
