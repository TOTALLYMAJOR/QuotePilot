import { describe, expect, test } from "vitest";
import {
  PILOT_DETERMINISTIC_COMMAND_MODEL,
  PILOT_QUERY_KINDS,
  buildPilotCommandPreview,
  buildPilotDeterministicQuery
} from "../pilotDeterministicCommands";

const SETTINGS = Object.freeze({
  staffingChargeMode: "per_hour_per_staff",
  serverRate: 22,
  chefRate: 28,
  bartenderRate: 30,
  serverCostRate: 16,
  chefCostRate: 20,
  bartenderCostRate: 22,
  serviceFeePct: 0.2,
  taxRate: 0.1,
  depositPct: 0.3,
  targetMarginPct: 0.3,
  menuSections: Object.freeze([{
    id: "mains",
    name: "Mains",
    items: Object.freeze([
      Object.freeze({
        id: "salmon",
        name: "Grilled Salmon",
        price: 6,
        pricingType: "per_person",
        cost: 2.5,
        active: true
      })
    ])
  }])
});

const CATALOG = Object.freeze({
  packages: Object.freeze([
    Object.freeze({ id: "classic", name: "Classic", ppp: 20, costPpp: 8, active: true })
  ]),
  addons: Object.freeze([
    Object.freeze({ id: "bar", name: "Premium Bar", type: "per_person", price: 15, cost: 6, active: true }),
    Object.freeze({ id: "coffee", name: "Coffee Station", type: "per_event", price: 95, cost: 35, active: true }),
    Object.freeze({ id: "photo-booth", name: "Photo Booth Station", type: "per_event", price: 400, cost: 180, active: true })
  ]),
  rentals: Object.freeze([
    Object.freeze({ id: "linens", name: "Linens", price: 9, qtyPerGuests: 10, cost: 3, active: true })
  ]),
  settings: SETTINGS
});

const FORM = Object.freeze({
  name: "Maya Bennett",
  email: "maya.private@example.test",
  phone: "205-555-0184",
  eventName: "Autumn Benefit Dinner",
  date: "2026-09-19",
  time: "18:00",
  venue: "The Foundry Hall",
  pkg: "classic",
  guests: 100,
  hours: 6,
  servers: 5,
  chefs: 2,
  bartenders: 1,
  addons: Object.freeze(["bar"]),
  rentals: Object.freeze(["linens"]),
  menuItems: Object.freeze(["salmon"]),
  addonQuantities: Object.freeze({}),
  rentalQuantities: Object.freeze({}),
  menuItemQuantities: Object.freeze({}),
  milesRT: 0,
  style: "Plated",
  internalNote: "PRIVATE-OPERATIONS-NOTE"
});

const TOTALS = Object.freeze({
  selectedPkg: CATALOG.packages[0],
  base: 2_000,
  addons: 1_500,
  rentals: 90,
  menu: 600,
  labor: 900,
  travel: 50,
  serviceFee: 700,
  tax: 400,
  total: 6_240,
  deposit: 1_872
});

const CONTEXT = Object.freeze({
  form: FORM,
  catalog: CATALOG,
  settings: SETTINGS,
  totals: TOTALS,
  marginEnabled: true,
  marginAuthorized: true,
  styles: Object.freeze(["Buffet", "Plated", "Stations", "Drop-off"])
});

function expectReadOnlyQuery(query, kind) {
  expect(query).toMatchObject({
    id: `pilot-query:${kind}`,
    kind,
    commandClass: "query",
    authorityLevel: "presentation",
    allowed: true,
    boundary: expect.stringContaining("Read-only deterministic explanation")
  });
  expect(query.boundary).toContain("No draft, saved quote, customer communication");
  expect(query.consequence).toBeTruthy();
  expect(query.doNothing).toBeTruthy();
  expect(query.confidence).toBeTruthy();
  expect(query.provenance).toBeTruthy();
}

describe("Pilot deterministic query commands", () => {
  test("publishes the bounded query vocabulary in stable order", () => {
    expect(PILOT_QUERY_KINDS).toEqual([
      "proposal_blockers",
      "price_explanation",
      "margin_explanation",
      "client_summary"
    ]);
    expect(Object.isFrozen(PILOT_QUERY_KINDS)).toBe(true);
  });

  test("reports exact deterministic proposal blockers without inventing event readiness", () => {
    const incomplete = {
      ...FORM,
      email: "",
      phone: "",
      date: "",
      menuItems: []
    };
    const first = buildPilotDeterministicQuery("What does this proposal need?", {
      ...CONTEXT,
      form: incomplete
    });
    const second = buildPilotDeterministicQuery("WHAT DOES THIS PROPOSAL NEED?!", {
      ...CONTEXT,
      form: structuredClone(incomplete)
    });

    expectReadOnlyQuery(first, "proposal_blockers");
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      state: "attention",
      title: "Proposal gaps",
      summary: "4 fields are missing from the deterministic proposal-completeness contract."
    });
    expect(first.facts.map((fact) => fact.label)).toEqual([
      "Valid customer email",
      "Customer phone",
      "Event date",
      "Menu selected"
    ]);
    expect(first.facts.every((fact) => fact.value === "Needs review")).toBe(true);
    expect(first.summary).not.toMatch(/event readiness|ready to book/iu);
    expect(first.confidence).toContain("proposal criteria only");
  });

  test("returns a caught-up proposal result while preserving separate authority domains", () => {
    const query = buildPilotDeterministicQuery("Is this proposal ready?", CONTEXT);

    expectReadOnlyQuery(query, "proposal_blockers");
    expect(query).toMatchObject({
      state: "healthy",
      title: "Proposal completeness is caught up",
      facts: [{
        label: "Proposal completeness",
        value: "100%",
        detail: "Commercial, customer, and operational evidence remain separate."
      }]
    });
    expect(query.summary).toContain("not event-wide readiness");
    expect(query.doNothing).toContain("no proposal is prepared or sent");
  });

  test("explains every current price component and labels it as a client preview", () => {
    const query = buildPilotDeterministicQuery("Explain the price breakdown", CONTEXT);

    expectReadOnlyQuery(query, "price_explanation");
    expect(query).toMatchObject({
      state: "available",
      title: "How this draft price is composed",
      summary: "Classic produces a $6240.00 current client preview."
    });
    expect(query.facts.map((fact) => fact.label)).toEqual([
      "Package",
      "Add-ons",
      "Rentals",
      "Menu",
      "Staffing",
      "Travel",
      "Service fee",
      "Tax",
      "Total",
      "Deposit"
    ]);
    expect(query.facts.find((fact) => fact.label === "Total")).toEqual({
      label: "Total",
      value: "$6240.00",
      detail: "Client preview, not a saved authoritative price"
    });
    expect(query.consequence).toContain("server-authoritative repricing");
    expect(query.confidence).toContain("unavailable as saved-price authority");
  });

  test("fails price explanation closed when a positive preview is unavailable", () => {
    const query = buildPilotDeterministicQuery("Why is the total unavailable?", {
      ...CONTEXT,
      totals: { total: 0 }
    });

    expectReadOnlyQuery(query, "price_explanation");
    expect(query).toMatchObject({
      state: "unavailable",
      title: "Draft price unavailable",
      facts: []
    });
    expect(query.summary).toContain("does not produce a positive client-side price preview");
    expect(query.consequence).toContain("No price composition or commercial conclusion is inferred");
  });

  test("keeps margin unavailable when its presentation gate is disabled", () => {
    const query = buildPilotDeterministicQuery("Explain our margin", {
      ...CONTEXT,
      marginEnabled: false
    });

    expectReadOnlyQuery(query, "margin_explanation");
    expect(query).toMatchObject({
      state: "unavailable",
      title: "Margin explanation is gated off",
      facts: [],
      provenance: "VITE_PILOT_MARGINS_ENABLED is disabled."
    });
    expect(query.summary).toContain("cannot expose staff cost context");
    expect(JSON.stringify(query)).not.toContain("$2532.00");
  });

  test("keeps margin unavailable without explicit staff-commercial permission", () => {
    const query = buildPilotDeterministicQuery("Explain our margin", {
      ...CONTEXT,
      marginAuthorized: false
    });

    expectReadOnlyQuery(query, "margin_explanation");
    expect(query).toMatchObject({
      state: "unavailable",
      title: "Margin explanation is unavailable for this role",
      facts: [],
      provenance: "Current authenticated staff-commercial permission is absent."
    });
    expect(JSON.stringify(query)).not.toContain("$2532.00");
  });

  test("answers non-price queries without requiring a calculator-shaped catalog", () => {
    const blockers = buildPilotDeterministicQuery("What does this proposal need?", {
      form: FORM
    });
    expectReadOnlyQuery(blockers, "proposal_blockers");
    expect(blockers.facts.map((fact) => fact.label)).toContain("Calculated total");

    const gatedMargin = buildPilotDeterministicQuery("Explain our margin", {
      form: FORM,
      marginEnabled: false,
      marginAuthorized: true
    });
    expectReadOnlyQuery(gatedMargin, "margin_explanation");
    expect(gatedMargin.state).toBe("unavailable");
  });

  test("uses the catalog package identity with precomputed numeric totals", () => {
    const { selectedPkg: _selectedPkg, ...numericTotals } = TOTALS;
    const query = buildPilotDeterministicQuery("Explain the price", {
      ...CONTEXT,
      totals: numericTotals
    });
    expect(query.summary).toBe("Classic produces a $6240.00 current client preview.");
  });

  test("fails margin closed and names every missing tenant cost input", () => {
    const gappyCatalog = {
      ...CATALOG,
      packages: [{ id: "classic", name: "Classic", ppp: 20, active: true }],
      addons: [{ id: "bar", name: "Premium Bar", type: "per_person", price: 15, active: true }]
    };
    const query = buildPilotDeterministicQuery("Why is profit unavailable?", {
      ...CONTEXT,
      catalog: gappyCatalog
    });

    expectReadOnlyQuery(query, "margin_explanation");
    expect(query).toMatchObject({
      state: "unavailable",
      title: "Margin unavailable"
    });
    expect(query.facts).toEqual(expect.arrayContaining([
      {
        label: "Classic (costPpp)",
        value: "Missing cost evidence",
        detail: "No estimate substituted"
      },
      {
        label: "Premium Bar (cost)",
        value: "Missing cost evidence",
        detail: "No estimate substituted"
      }
    ]));
    expect(query.consequence).toContain("cannot calculate margin");
    expect(query.confidence).toContain("fails closed");
  });

  test("explains margin only when every selected line has recorded cost coverage", () => {
    const query = buildPilotDeterministicQuery("Break down the margin", CONTEXT);

    expectReadOnlyQuery(query, "margin_explanation");
    expect(query).toMatchObject({
      state: "available",
      title: "Recorded-cost margin",
      summary: "56.3% margin on the current catering-scope preview."
    });
    expect(query.facts).toEqual([
      { label: "Scope revenue", value: "$5790.00", detail: "Travel and tax excluded" },
      { label: "Recorded costs", value: "$2532.00", detail: "Tenant-recorded cost fields only" },
      { label: "Margin", value: "56.3%", detail: "Meets your 30% target." }
    ]);
    expect(query.consequence).toContain("staff-only advisory calculation");
    expect(query.confidence).toContain("every selected revenue line");
  });

  test("creates a client-safe summary from reviewable draft fields without sending anything", () => {
    const privacyContext = {
      ...CONTEXT,
      form: {
        ...FORM,
        email: "private-recipient@example.test",
        phone: "205-555-0101",
        internalNote: "PRIVATE-OPERATIONS-NOTE",
        providerToken: "PRIVATE-PROVIDER-TOKEN"
      },
      catalog: {
        ...CATALOG,
        packages: [{
          ...CATALOG.packages[0],
          costPpp: 987.65,
          internalSupplier: "PRIVATE-SUPPLIER"
        }]
      }
    };
    const query = buildPilotDeterministicQuery("Give me a client-friendly summary", privacyContext);
    const serialized = JSON.stringify(query);

    expectReadOnlyQuery(query, "client_summary");
    expect(query).toMatchObject({
      state: "available",
      title: "Client-safe draft summary"
    });
    expect(query.summary).toContain(
      "Autumn Benefit Dinner is planned for September 19, 2026 for 100 guests at The Foundry Hall."
    );
    expect(query.summary).toContain("current Classic draft is $6240.00");
    expect(query.summary).toContain("$1872.00 shown as the deposit requirement");
    expect(query.facts.find((fact) => fact.label === "Quoted preview")?.detail)
      .toContain("server repricing before save/send");
    [
      "private-recipient@example.test",
      "205-555-0101",
      "PRIVATE-OPERATIONS-NOTE",
      "PRIVATE-PROVIDER-TOKEN",
      "PRIVATE-SUPPLIER",
      "987.65"
    ].forEach((privateValue) => expect(serialized).not.toContain(privateValue));
    expect(query.consequence).toContain("does not prepare or send");
    expect(query.doNothing).toContain("No customer message");
  });

  test("fails client summary closed when the draft is not calculable", () => {
    const query = buildPilotDeterministicQuery("Summarize this for the customer", {
      ...CONTEXT,
      totals: { total: 0 }
    });

    expectReadOnlyQuery(query, "client_summary");
    expect(query).toMatchObject({
      state: "unavailable",
      title: "Client summary unavailable",
      facts: []
    });
    expect(query.summary).toContain("needs a calculable total");
    expect(query.doNothing).toContain("no message is prepared or sent");
  });
});

describe("Pilot deterministic command preview", () => {
  test("keeps a draft mutation and read-only query distinct in one mixed request", () => {
    const preview = buildPilotCommandPreview(
      "Add another bartender, and explain the price.",
      CONTEXT
    );

    expect(preview.modelId).toBe(PILOT_DETERMINISTIC_COMMAND_MODEL);
    expect(preview.message).toBe("Add another bartender, and explain the price.");
    expect(preview.proposals).toEqual([expect.objectContaining({
      id: "staff-0",
      kind: "add_staff",
      field: "bartenders",
      count: 1,
      clause: "Add another bartender"
    })]);
    expect(preview.queries).toHaveLength(1);
    expectReadOnlyQuery(preview.queries[0], "price_explanation");
    expect(preview.ambiguities).toEqual([]);
    expect(preview.unparsedClauses).toEqual([]);
    expect(FORM.bartenders).toBe(1);
  });

  test("preserves unknown and unread clauses without guessing or executing them", () => {
    expect(buildPilotDeterministicQuery("Schedule a call with the florist", CONTEXT)).toBeNull();

    const preview = buildPilotCommandPreview(
      "We are still at 100 guests. Also my aunt is excited!",
      CONTEXT
    );
    expect(preview.proposals).toEqual([]);
    expect(preview.queries).toEqual([]);
    expect(preview.ambiguities).toEqual([]);
    expect(preview.unparsedClauses).toEqual(["Also my aunt is excited!"]);

    const ambiguous = buildPilotCommandPreview("Please add a station", CONTEXT);
    expect(ambiguous.proposals).toEqual([]);
    expect(ambiguous.queries).toEqual([]);
    expect(ambiguous.unparsedClauses).toEqual([]);
    expect(ambiguous.ambiguities).toHaveLength(1);
    expect(ambiguous.ambiguities[0].candidates.map((candidate) => candidate.itemId).sort())
      .toEqual(["coffee", "photo-booth"]);
  });

  test("deep-freezes output while leaving all caller-owned context unchanged and mutable", () => {
    const context = structuredClone(CONTEXT);
    const before = structuredClone(context);
    const preview = buildPilotCommandPreview(
      "Add another bartender, and give me a client summary.",
      context
    );

    expect(context).toEqual(before);
    expect(Object.isFrozen(context)).toBe(false);
    expect(Object.isFrozen(context.form)).toBe(false);
    expect(Object.isFrozen(context.catalog)).toBe(false);
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.proposals)).toBe(true);
    expect(Object.isFrozen(preview.proposals[0])).toBe(true);
    expect(Object.isFrozen(preview.queries)).toBe(true);
    expect(Object.isFrozen(preview.queries[0])).toBe(true);
    expect(Object.isFrozen(preview.queries[0].facts)).toBe(true);
    expect(() => preview.queries[0].facts.push({})).toThrow(TypeError);
    expect(context).toEqual(before);
  });
});
