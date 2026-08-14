import { describe, expect, it } from "vitest";
import { calculateQuote } from "../../lib/quoteCalculator";
import {
  buildCompositionLine,
  buildExperienceModel,
  buildGuestChangeConsequences,
  buildHeaderModel,
  buildInvestmentModel,
  buildMenuModel,
  buildPackageOptions,
  buildPulseValueMap,
  buildRentalSuggestionPatch,
  buildRentalSuggestions,
  buildSectionCompleteness,
  buildStaffingRecommendation,
  buildStaffingRecommendationPatch,
  buildStyleOptions,
  buildWatchingList,
  formatEventDateLong,
  impactPhrase,
  previewPatchImpact
} from "../proposalComposerPresentation";
import {
  baseFixtureForm,
  quoteCalculationCatalog,
  quoteCalculationSettings
} from "../../lib/__tests__/fixtures/quoteCalculationFixtures";

function draftForm(overrides = {}) {
  return {
    ...baseFixtureForm,
    eventTypeId: "corporate",
    eventName: "Acme Executive Dinner",
    venue: "The Foundry",
    venueAddress: "12 Foundry Way",
    dietaryRestrictions: "",
    clientOrg: "Acme",
    name: "Jordan Blake",
    phone: "555-0100",
    email: "jordan@acme.test",
    time: "18:00",
    addonQuantities: {},
    rentalQuantities: {},
    menuItemQuantities: {},
    eventTemplateId: "custom",
    includeDisposables: true,
    guests: 80,
    hours: 4,
    ...overrides
  };
}

function totalsFor(form) {
  return calculateQuote(form, quoteCalculationCatalog, quoteCalculationSettings);
}

describe("buildStaffingRecommendation", () => {
  it("computes plated requirements from the house rule", () => {
    const recommendation = buildStaffingRecommendation(
      draftForm({ style: "Plated", guests: 80, servers: 5, chefs: 1 })
    );
    expect(recommendation.available).toBe(true);
    expect(recommendation.requiredServers).toBe(7);
    expect(recommendation.requiredChefs).toBe(2);
    expect(recommendation.serverGap).toBe(2);
    expect(recommendation.chefGap).toBe(1);
    expect(recommendation.meetsRule).toBe(false);
    expect(recommendation.basis).toContain("1 server per 12 guests, minimum 3");
  });

  it("treats drop-off as always meeting the rule", () => {
    const recommendation = buildStaffingRecommendation(
      draftForm({ style: "Drop-off", guests: 120, servers: 0, chefs: 0 })
    );
    expect(recommendation.available).toBe(true);
    expect(recommendation.requiredServers).toBe(0);
    expect(recommendation.requiredChefs).toBe(0);
    expect(recommendation.meetsRule).toBe(true);
  });

  it("is unavailable without guests or a known style", () => {
    expect(buildStaffingRecommendation(draftForm({ guests: 0 })).available).toBe(false);
    expect(buildStaffingRecommendation(draftForm({ style: "Mystery" })).available).toBe(false);
  });
});

describe("buildStaffingRecommendationPatch", () => {
  it("raises only roles below the rule and never lowers over-staffing", () => {
    const patch = buildStaffingRecommendationPatch(
      draftForm({ style: "Plated", guests: 80, servers: 9, chefs: 0 })
    );
    expect(patch).toEqual({ chefs: 2 });
  });

  it("returns null when the rule is already met", () => {
    const patch = buildStaffingRecommendationPatch(
      draftForm({ style: "Buffet", guests: 40, servers: 2, chefs: 0 })
    );
    expect(patch).toBeNull();
  });
});

describe("rental suggestions", () => {
  it("suggests updates only for explicit quantities that lag the house rule", () => {
    const form = draftForm({
      guests: 100,
      rentals: ["chairs"],
      rentalQuantities: { chairs: 8 }
    });
    const suggestions = buildRentalSuggestions({ form, catalog: quoteCalculationCatalog });
    expect(suggestions).toEqual([
      { id: "chairs", name: "Banquet Chairs", currentQty: 8, suggestedQty: 10 }
    ]);
  });

  it("stays quiet when quantities float with the guest count", () => {
    const form = draftForm({ guests: 100, rentals: ["chairs"], rentalQuantities: {} });
    expect(buildRentalSuggestions({ form, catalog: quoteCalculationCatalog })).toEqual([]);
  });

  it("stays quiet when the explicit quantity already matches", () => {
    const form = draftForm({ guests: 100, rentals: ["chairs"], rentalQuantities: { chairs: 10 } });
    expect(buildRentalSuggestions({ form, catalog: quoteCalculationCatalog })).toEqual([]);
  });

  it("builds a quantity patch preserving other overrides", () => {
    const form = draftForm({ rentalQuantities: { chairs: 8, linens: 4 } });
    const patch = buildRentalSuggestionPatch(form, [
      { id: "chairs", name: "Banquet Chairs", currentQty: 8, suggestedQty: 10 }
    ]);
    expect(patch).toEqual({ rentalQuantities: { chairs: 10, linens: 4 } });
  });
});

describe("buildGuestChangeConsequences", () => {
  it("reports totals movement and follow-ups after a guest change", () => {
    const previousForm = draftForm({
      style: "Plated",
      guests: 80,
      servers: 7,
      chefs: 2,
      rentals: ["chairs"],
      rentalQuantities: { chairs: 8 }
    });
    const form = { ...previousForm, guests: 100 };
    const previousTotals = totalsFor(previousForm);
    const totals = totalsFor(form);

    const consequences = buildGuestChangeConsequences({
      previousForm,
      previousTotals,
      form,
      totals,
      catalog: quoteCalculationCatalog
    });

    expect(consequences.from).toBe(80);
    expect(consequences.to).toBe(100);
    expect(consequences.totalAfter).toBeGreaterThan(consequences.totalBefore);
    expect(consequences.totalDelta).toBeCloseTo(
      consequences.totalAfter - consequences.totalBefore,
      2
    );
    expect(consequences.staffing.serverGap).toBe(2);
    expect(consequences.rentalSuggestions).toHaveLength(1);
    expect(consequences.hasFollowUps).toBe(true);
  });

  it("returns null when the guest count did not change", () => {
    const form = draftForm();
    expect(
      buildGuestChangeConsequences({
        previousForm: form,
        previousTotals: totalsFor(form),
        form,
        totals: totalsFor(form),
        catalog: quoteCalculationCatalog
      })
    ).toBeNull();
  });
});

describe("buildWatchingList", () => {
  it("marks a missing client email as risk and missing travel as watch", () => {
    const form = draftForm({ email: "", milesRT: 0, menuItems: [] });
    const items = buildWatchingList({ form, totals: totalsFor(form) });
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    expect(byId["client-email"].state).toBe("risk");
    expect(byId.travel.state).toBe("watch");
    expect(byId.menu.state).toBe("risk");
  });

  it("goes healthy when the record supports it", () => {
    const form = draftForm({
      style: "Buffet",
      guests: 40,
      servers: 2,
      milesRT: 18,
      menuItems: ["salad"]
    });
    const items = buildWatchingList({ form, totals: totalsFor(form) });
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    expect(byId.staffing.state).toBe("ok");
    expect(byId["client-email"].state).toBe("ok");
    expect(byId.travel.detail).toBe("18 miles round trip");
    expect(byId.menu.state).toBe("ok");
  });

  it("carries the readiness score when provided", () => {
    const form = draftForm();
    const items = buildWatchingList({
      form,
      totals: totalsFor(form),
      readiness: { score: 85, complete: false, status: { label: "Final review" } }
    });
    const readiness = items.find((item) => item.id === "readiness");
    expect(readiness.state).toBe("watch");
    expect(readiness.detail).toBe("85/100 · Final review");
  });
});

describe("investment + pulse", () => {
  it("builds ruled rows, omitting zero optional lines and keeping core lines", () => {
    const form = draftForm({ guests: 40, servers: 2, hours: 4, addons: [], rentals: [] });
    const totals = totalsFor(form);
    const model = buildInvestmentModel({
      form,
      totals,
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings
    });

    const ids = model.rows.map((row) => row.id);
    expect(ids).toContain("base");
    expect(ids).toContain("labor");
    expect(ids).toContain("serviceFee");
    expect(ids).toContain("tax");
    expect(ids).not.toContain("addons");
    expect(ids).not.toContain("rentals");
    expect(ids).not.toContain("travel");
    expect(model.rows.find((row) => row.id === "base").label).toBe("Basic package");
    expect(model.perGuest).toBeCloseTo(Math.round((totals.total / 40) * 100) / 100, 2);
    expect(model.depositLabel).toBe("Deposit (25%)");
    expect(model.deposit).toBeCloseTo(totals.deposit, 2);
  });

  it("maps pulse values for change detection", () => {
    const totals = totalsFor(draftForm({ guests: 40, servers: 2 }));
    const map = buildPulseValueMap(totals);
    expect(map.total).toBeCloseTo(totals.total, 2);
    expect(Object.keys(map)).toContain("labor");
  });

  it("composes the composition line from the record", () => {
    const form = draftForm({ guests: 80, servers: 6, bartenders: 1, chefs: 0 });
    const parts = buildCompositionLine({
      form,
      totals: totalsFor(form),
      catalog: quoteCalculationCatalog
    });
    expect(parts).toContain("80 guests");
    expect(parts).toContain("Basic");
    expect(parts).toContain("6 servers");
    expect(parts).toContain("1 bartender");
  });
});

describe("what-if impact", () => {
  it("prices a package switch against the current draft", () => {
    const form = draftForm({ guests: 10 });
    const totals = totalsFor(form);
    const impact = previewPatchImpact({
      form,
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      totals,
      patch: { pkg: "premium" }
    });
    expect(impact.delta).toBeGreaterThan(0);
    expect(impact.nextTotals.total).toBeCloseTo(totals.total + impact.delta, 2);
  });

  it("fails closed on missing inputs", () => {
    expect(previewPatchImpact({}).delta).toBeNull();
  });

  it("phrases impact deltas for display", () => {
    expect(impactPhrase(null)).toBe("Impact shown after pricing");
    expect(impactPhrase(0)).toBe("No change to the total");
    expect(impactPhrase(12.5)).toBe("+$12.50");
    expect(impactPhrase(-3)).toBe("−$3.00");
  });
});

describe("experience + menu models", () => {
  it("describes the selected style and package factually", () => {
    const form = draftForm({ style: "Plated", menuItems: ["salad"] });
    const model = buildExperienceModel({ form, catalog: quoteCalculationCatalog });
    expect(model.title).toBe("Plated dinner service");
    expect(model.facts).toContain("Basic");
    expect(model.facts).toContain("$10.00 per guest");
    expect(model.facts).toContain("1 menu selection");
  });

  it("lists package options with deltas and the current selection", () => {
    const form = draftForm({ guests: 10 });
    const totals = totalsFor(form);
    const options = buildPackageOptions({
      form,
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      totals
    });
    expect(options).toHaveLength(2);
    const current = options.find((option) => option.selected);
    expect(current.id).toBe("basic");
    expect(current.delta).toBe(0);
    const premium = options.find((option) => option.id === "premium");
    expect(premium.delta).toBeGreaterThan(0);
  });

  it("lists style options for every house rule", () => {
    const form = draftForm({ guests: 10 });
    const options = buildStyleOptions({
      form,
      catalog: quoteCalculationCatalog,
      settings: quoteCalculationSettings,
      totals: totalsFor(form)
    });
    expect(options.map((option) => option.id)).toEqual(
      ["Buffet", "Plated", "Stations", "Drop-off"]
    );
    expect(options.find((option) => option.id === "Buffet").selected).toBe(true);
  });

  it("groups selected menu items by section with package inclusion flags", () => {
    const form = draftForm({ menuItems: ["salad"], menuItemQuantities: { salad: 3 } });
    const model = buildMenuModel({
      form,
      menuSections: quoteCalculationSettings.menuSections,
      packageIncludedIds: ["salad"]
    });
    expect(model.empty).toBe(false);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].name).toBe("Main");
    expect(model.groups[0].items[0]).toMatchObject({
      id: "salad",
      name: "Salad Bar",
      quantity: 3,
      includedInPackage: true
    });
  });
});

describe("completeness + header", () => {
  it("marks sections complete only when the record supports it", () => {
    const form = draftForm({ menuItems: ["salad"], servers: 2 });
    const completeness = buildSectionCompleteness({
      form,
      totals: totalsFor(form),
      catalog: quoteCalculationCatalog
    });
    expect(completeness.event).toBe(true);
    expect(completeness.client).toBe(true);
    expect(completeness.experience).toBe(true);
    expect(completeness.menu).toBe(true);
    expect(completeness.staffing).toBe(true);
    expect(completeness.investment).toBe(true);

    const incomplete = buildSectionCompleteness({
      form: draftForm({ email: "not-an-email", venue: "", servers: 0, chefs: 0, bartenders: 0 }),
      totals: totalsFor(form),
      catalog: quoteCalculationCatalog
    });
    expect(incomplete.event).toBe(false);
    expect(incomplete.client).toBe(false);
    expect(incomplete.staffing).toBe(false);
  });

  it("formats event dates without timezone drift", () => {
    expect(formatEventDateLong("2026-09-12")).toBe("September 12, 2026");
    expect(formatEventDateLong("")).toBe("");
    expect(formatEventDateLong("12/09/2026")).toBe("");
  });

  it("builds the header save state honestly", () => {
    const form = draftForm();
    expect(buildHeaderModel({ form, quoteDirty: true }).saveState).toEqual({
      id: "dirty",
      label: "Unsaved changes"
    });
    expect(buildHeaderModel({ form, saving: true }).saveState.id).toBe("saving");
    const editing = buildHeaderModel({
      form,
      editingQuote: { quoteNumber: "Q-1042" },
      quoteDirty: false
    });
    expect(editing.eyebrow).toBe("Editing quote Q-1042");
    expect(editing.saveState.id).toBe("saved");
    expect(buildHeaderModel({ form: { ...form, eventName: "" } }).title).toBe("Untitled event");
  });
});
