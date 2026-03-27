import { describe, expect, test } from "vitest";
import {
  applyEventTypeTemplateDefaults,
  buildStepStatus,
  detectBreakdownValueChanges,
  findTemplateForEventType,
  validateStep1
} from "../wizardUi";

const INITIAL_FORM = {
  date: "",
  time: "",
  hours: 0,
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
  pkg: "classic",
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
