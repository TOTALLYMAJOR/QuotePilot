import { describe, expect, test } from "vitest";
import { calculateQuote } from "../../lib/quoteCalculator";
import {
  CHANGE_REQUEST_PARSE_MODEL,
  applyProposalToForm,
  buildChangeImpact,
  parseChangeRequest,
  proposalTouchedFields
} from "../changeRequestParse";

const settings = {
  perMileRate: 0.7,
  longDistancePerMileRate: 1.1,
  deliveryThresholdMiles: 30,
  serverRate: 22,
  chefRate: 28,
  bartenderRate: 30,
  serviceFeePct: 0.2,
  serviceFeeTiers: [
    { id: "small", minGuests: 0, maxGuests: 99, pct: 0.2 },
    { id: "large", minGuests: 100, maxGuests: 9999, pct: 0.18 }
  ],
  taxRate: 0.1,
  taxRegions: [{ id: "local", name: "Local", rate: 0.1 }],
  defaultTaxRegion: "local",
  depositPct: 0.3,
  seasonalProfiles: [{
    id: "standard", name: "Standard",
    startMonth: 1, startDay: 1, endMonth: 12, endDay: 31,
    packageMultiplier: 1, addonMultiplier: 1, rentalMultiplier: 1
  }],
  menuSections: [{
    id: "mains",
    name: "Mains",
    items: [
      { id: "salmon", name: "Grilled Salmon", price: 6, pricingType: "per_person" },
      { id: "chicken", name: "Herb Chicken", price: 4, pricingType: "per_person" }
    ]
  }]
};

const catalog = {
  packages: [{ id: "classic", name: "Classic", ppp: 20 }],
  addons: [
    { id: "premium-bar", name: "Premium Bar", type: "per_person", price: 15 },
    { id: "coffee", name: "Coffee Station", type: "per_event", price: 95 },
    { id: "photo-booth", name: "Photo Booth Station", type: "per_event", price: 400 }
  ],
  rentals: [{ id: "linens", name: "Linens", price: 9, qtyPerGuests: 8 }],
  settings
};

const form = {
  pkg: "classic",
  guests: 120,
  hours: 6,
  servers: 8,
  chefs: 3,
  bartenders: 2,
  addons: ["premium-bar"],
  rentals: ["linens"],
  menuItems: ["salmon"],
  addonQuantities: {},
  rentalQuantities: {},
  menuItemQuantities: { salmon: 1 },
  milesRT: 0,
  date: "2026-03-15",
  style: "Plated"
};

const STYLES = ["Buffet", "Plated", "Stations", "Drop-off"];

function parse(message) {
  return parseChangeRequest(message, { form, catalog, styles: STYLES });
}

describe("parseChangeRequest", () => {
  test("parses the canonical swap request into one resolved proposal", () => {
    const result = parse("Could we do chicken instead of the salmon?");
    expect(result.modelId).toBe(CHANGE_REQUEST_PARSE_MODEL);
    expect(result.proposals).toHaveLength(1);
    const swap = result.proposals[0];
    expect(swap.kind).toBe("swap_item");
    expect(swap.remove.itemId).toBe("salmon");
    expect(swap.add.itemId).toBe("chicken");
    expect(swap.title).toBe("Swap Grilled Salmon → Herb Chicken");
    expect(result.unparsedClauses).toEqual([]);
  });

  test("parses multi-clause requests: staff, guest count, and hours together", () => {
    const result = parse("Add another bartender, we're now at 135 guests, and extend to 7 hours.");
    const kinds = result.proposals.map((proposal) => proposal.kind);
    expect(kinds).toEqual(["add_staff", "set_guests", "set_hours"]);
    expect(result.proposals[0].field).toBe("bartenders");
    expect(result.proposals[1].value).toBe(135);
    expect(result.proposals[2].value).toBe(7);
  });

  test("removes only items that are actually selected, tolerating partial names", () => {
    const result = parse("Please remove the premium bar.");
    expect(result.proposals[0].kind).toBe("remove_item");
    expect(result.proposals[0].itemId).toBe("premium-bar");
    const notSelected = parse("Please remove the coffee station.");
    expect(notSelected.proposals).toEqual([]);
    expect(notSelected.unparsedClauses).toHaveLength(1);
  });

  test("adds only active catalog items and turns ambiguous references into choices", () => {
    const add = parse("Can we get the coffee station");
    expect(add.proposals[0].kind).toBe("add_item");
    expect(add.proposals[0].itemId).toBe("coffee");

    const ambiguous = parse("Please add a station");
    expect(ambiguous.proposals).toEqual([]);
    expect(ambiguous.ambiguities).toHaveLength(1);
    expect(ambiguous.ambiguities[0].candidates.map((candidate) => candidate.itemId).sort())
      .toEqual(["coffee", "photo-booth"]);
  });

  test("switches service style only to a known house style", () => {
    const result = parse("Could we switch dinner to buffet");
    expect(result.proposals[0]).toMatchObject({ kind: "set_style", value: "Buffet" });
    const unknown = parseChangeRequest("switch to buffet", { form, catalog, styles: [] });
    expect(unknown.proposals).toEqual([]);
  });

  test("ignores restatements that change nothing and keeps unreadable clauses honest", () => {
    const result = parse("We are still at 120 guests. Also my aunt is excited!");
    expect(result.proposals).toEqual([]);
    expect(result.unparsedClauses).toEqual(["Also my aunt is excited!"]);
  });
});

describe("applyProposalToForm and proposalTouchedFields", () => {
  test("swap removes the old selection, its quantity, and adds the new item", () => {
    const swap = parse("Could we do chicken instead of the salmon?").proposals[0];
    const next = applyProposalToForm(form, swap);
    expect(next.menuItems).toEqual(["chicken"]);
    expect(next.menuItemQuantities).toEqual({});
    expect(form.menuItems).toEqual(["salmon"]);
    expect(proposalTouchedFields(swap)).toEqual(["menuItems"]);
  });

  test("staff, guests, hours, and style apply as plain field changes", () => {
    expect(applyProposalToForm(form, { kind: "add_staff", field: "bartenders", count: 1 }).bartenders).toBe(3);
    expect(applyProposalToForm(form, { kind: "set_guests", value: 135 }).guests).toBe(135);
    expect(applyProposalToForm(form, { kind: "set_hours", value: 7 }).hours).toBe(7);
    expect(applyProposalToForm(form, { kind: "set_style", value: "Buffet" }).style).toBe("Buffet");
  });
});

describe("buildChangeImpact", () => {
  test("prices the proposal with the same preview calculator, cascade included", () => {
    const swap = parse("Could we do chicken instead of the salmon?").proposals[0];
    const impact = buildChangeImpact({ form, catalog, settings, proposal: swap });
    const before = calculateQuote(form, catalog, settings);
    const after = calculateQuote(applyProposalToForm(form, swap), catalog, settings);
    expect(impact.beforeTotal).toBe(before.total);
    expect(impact.afterTotal).toBe(after.total);
    expect(impact.delta).toBeCloseTo(after.total - before.total, 6);
    expect(impact.delta).toBeLessThan(0);
    expect(impact.depositDelta).toBeCloseTo(after.deposit - before.deposit, 6);
  });

  test("returns null without the inputs it needs", () => {
    expect(buildChangeImpact({ proposal: { kind: "set_guests", value: 1 } })).toBeNull();
  });
});
