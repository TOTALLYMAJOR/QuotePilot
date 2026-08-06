import { describe, expect, test } from "vitest";
import {
  applyEventTypeTemplateDefaults,
  buildStepStatus,
  createTemplateDefaultsOwnership,
  detectBreakdownValueChanges,
  findTemplateForEventType,
  MIN_EVENT_HOURS,
  normalizeEventHours,
  releaseTemplateDefaultsOwnership,
  resolveFirstValidPackageId,
  restoreTemplateOwnedDefaults,
  validateStep1
} from "../wizardUi";

const INITIAL_FORM = {
  date: "",
  time: "",
  hours: MIN_EVENT_HOURS,
  bartenders: 0,
  guests: 0,
  venue: "",
  venueAddress: "",
  eventName: "",
  clientOrg: "",
  style: "Buffet",
  name: "",
  phone: "",
  email: "",
  pkg: "",
  addons: [],
  addonQuantities: {},
  rentals: [],
  rentalQuantities: {},
  menuItems: [],
  menuItemQuantities: {},
  eventTypeId: "",
  bartenderRateTypeId: "",
  staffingRateTypeId: "",
  bartenderRateOverride: "",
  serverRateOverride: "",
  chefRateOverride: "",
  eventTemplateId: "custom",
  taxRegion: "",
  seasonProfileId: "auto",
  milesRT: 0,
  includeDisposables: true,
  depositLink: "",
  payMethod: "card"
};

describe("wizardUi", () => {
  test("validateStep1 returns required field errors", () => {
    const result = validateStep1({ ...INITIAL_FORM, guests: 0, email: "bad-email" });

    expect(result.valid).toBe(false);
    expect(result.fieldErrors.eventTypeId).toMatch(/event type/i);
    expect(result.fieldErrors.email).toMatch(/valid email/i);
    expect(result.missingFields.map((field) => field.key)).toContain("guests");
  });

  test("validateStep1 passes with complete required fields", () => {
    const result = validateStep1({
      ...INITIAL_FORM,
      eventTypeId: "wedding",
      date: "2026-07-05",
      guests: 85,
      eventName: "Client Celebration",
      venue: "River Hall",
      name: "Jordan Lee",
      email: "jordan@example.com"
    });

    expect(result.valid).toBe(true);
    expect(result.missingFields).toHaveLength(0);
  });

  test("buildStepStatus applies soft-lock statuses when step 1 is incomplete", () => {
    const statuses = buildStepStatus({
      currentStep: 1,
      stepValidation: {
        step1: {
          valid: false
        }
      }
    });

    expect(statuses).toEqual(["current", "locked", "locked", "locked", "locked"]);
  });

  test("buildStepStatus marks prior steps completed after unlock", () => {
    const statuses = buildStepStatus({
      currentStep: 3,
      stepValidation: {
        step1: {
          valid: true
        }
      }
    });

    expect(statuses).toEqual(["completed", "completed", "current", "incomplete", "incomplete"]);
  });

  test("findTemplateForEventType matches by template id then by name", () => {
    const templates = [
      { id: "corporate", name: "Corporate", pkg: "premium" },
      { id: "birthday_template", name: "Birthday", pkg: "classic" }
    ];
    const eventTypes = [
      { id: "birthday-party", name: "Birthday" }
    ];

    expect(findTemplateForEventType({ eventTypeId: "corporate", templates, eventTypes })?.id).toBe("corporate");
    expect(findTemplateForEventType({ eventTypeId: "birthday-party", templates, eventTypes })?.id).toBe("birthday_template");
  });

  test("new quote defaults use one billable hour and the first valid loaded package", () => {
    expect(MIN_EVENT_HOURS).toBe(1);
    expect(normalizeEventHours("")).toBe(1);
    expect(normalizeEventHours(0)).toBe(1);
    expect(normalizeEventHours(4)).toBe(4);
    expect(normalizeEventHours(99)).toBe(12);
    expect(resolveFirstValidPackageId([
      { id: "", name: "Missing id", ppp: 20 },
      { id: "draft", name: "Draft", ppp: 0 },
      { id: "corporate-essential", name: "Corporate Essential", ppp: 24 },
      { id: "wedding-signature", name: "Wedding Signature", ppp: 38 }
    ], "classic")).toBe("corporate-essential");
    expect(resolveFirstValidPackageId([
      { id: "corporate-essential", name: "Corporate Essential", ppp: 24 },
      { id: "wedding-signature", name: "Wedding Signature", ppp: 38 }
    ], "wedding-signature")).toBe("wedding-signature");
  });

  test("applyEventTypeTemplateDefaults only fills untouched/default fields", () => {
    const form = {
      ...INITIAL_FORM,
      eventTypeId: "corporate",
      addons: [],
      rentals: [],
      menuItems: []
    };
    const template = {
      id: "corporate",
      name: "Corporate",
      hours: 4,
      style: "Buffet",
      pkg: "premium",
      taxRegion: "reduced",
      seasonProfileId: "standard",
      milesRT: 22,
      payMethod: "ach",
      addons: ["coffee"],
      rentals: ["linens"],
      menuItems: ["shrimp-skewer"]
    };

    const { nextForm, appliedFields } = applyEventTypeTemplateDefaults({
      form,
      template,
      catalog: {
        addons: [{ id: "coffee" }],
        rentals: [{ id: "linens" }]
      },
      touchedFields: {},
      initialForm: INITIAL_FORM
    });

    expect(nextForm.pkg).toBe("premium");
    expect(nextForm.payMethod).toBe("ach");
    expect(nextForm.addons).toEqual(["coffee"]);
    expect(appliedFields).toContain("menuItems");
  });

  test("applyEventTypeTemplateDefaults preserves touched fields", () => {
    const form = {
      ...INITIAL_FORM,
      style: "Stations",
      pkg: "deluxe",
      payMethod: "card"
    };

    const { nextForm, appliedFields } = applyEventTypeTemplateDefaults({
      form,
      template: {
        id: "wedding",
        style: "Plated",
        pkg: "premium",
        payMethod: "ach"
      },
      touchedFields: {
        style: true,
        pkg: true,
        payMethod: true
      },
      initialForm: INITIAL_FORM
    });

    expect(nextForm.style).toBe("Stations");
    expect(nextForm.pkg).toBe("deluxe");
    expect(nextForm.payMethod).toBe("card");
    expect(appliedFields).not.toContain("style");
    expect(appliedFields).not.toContain("pkg");
    expect(appliedFields).not.toContain("payMethod");
  });

  test("clearing template defaults restores every untouched field and keeps later user edits", () => {
    const beforeForm = {
      ...INITIAL_FORM,
      eventTemplateId: "custom",
      hours: 1,
      style: "Buffet",
      pkg: "corporate-essential",
      servers: 0,
      chefs: 0,
      bartenders: 0,
      menuItems: ["house-salad"],
      menuItemQuantities: { "house-salad": 2 },
      addons: [],
      addonQuantities: {},
      rentals: [],
      rentalQuantities: {}
    };
    const afterForm = {
      ...beforeForm,
      eventTemplateId: "wedding",
      hours: 5,
      style: "Plated",
      pkg: "wedding-signature",
      servers: 4,
      chefs: 2,
      bartenders: 1,
      menuItems: ["canape"],
      menuItemQuantities: { canape: 1 },
      addons: ["coffee"],
      addonQuantities: { coffee: 1 },
      rentals: ["linens"],
      rentalQuantities: { linens: 1 }
    };
    let ownership = createTemplateDefaultsOwnership({
      beforeForm,
      afterForm,
      appliedFields: [
        "eventTemplateId",
        "hours",
        "style",
        "pkg",
        "servers",
        "chefs",
        "bartenders",
        "menuItems",
        "addons",
        "rentals"
      ]
    });
    ownership = releaseTemplateDefaultsOwnership(ownership, "addons", "coffee");
    ownership = releaseTemplateDefaultsOwnership(ownership, "pkg");

    const restored = restoreTemplateOwnedDefaults({
      form: {
        ...afterForm,
        hours: 6,
        pkg: "wedding-premium",
        menuItems: ["canape", "late-dessert"],
        menuItemQuantities: { canape: 1, "late-dessert": 3 },
        addonQuantities: { coffee: 2 }
      },
      ownership
    });

    expect(restored).toMatchObject({
      eventTemplateId: "custom",
      hours: 6,
      style: "Buffet",
      pkg: "wedding-premium",
      servers: 0,
      chefs: 0,
      bartenders: 0,
      menuItems: ["late-dessert", "house-salad"],
      menuItemQuantities: { "late-dessert": 3, "house-salad": 2 },
      addons: ["coffee"],
      addonQuantities: { coffee: 2 },
      rentals: [],
      rentalQuantities: {}
    });
  });

  test("detectBreakdownValueChanges returns deltas for changed keys", () => {
    const changes = detectBreakdownValueChanges(
      { total: 1200, tax: 100, serviceFee: 150 },
      { total: 1325, tax: 110, serviceFee: 155 }
    );

    expect(changes.total).toBeCloseTo(125, 5);
    expect(changes.tax).toBeCloseTo(10, 5);
    expect(changes.serviceFee).toBeCloseTo(5, 5);
  });
});
