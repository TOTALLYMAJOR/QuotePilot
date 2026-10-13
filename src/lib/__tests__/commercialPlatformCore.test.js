import { describe, expect, test } from "vitest";
import {
  CATERING_VERTICAL_PACK,
  CommercialPlatformError,
  adaptEventTemplateToCommercialTemplate,
  adaptPackageToConfigurableOffer,
  applyCommercialTemplate,
  composeCommercialTemplate,
  evaluateConfigurationRules,
  evaluateOfferConfiguration,
  validateCommercialPublication,
  validateConfigurationRule,
  validateVerticalPack
} from "../commercialPlatform";

const catalog = {
  packages: [{
    id: "wedding",
    name: "Wedding Package",
    active: true,
    includedMenuItemIds: ["salad"],
    includedAddonIds: [],
    includedRentalIds: [],
    choiceGroups: [{
      id: "mains",
      label: "Mains",
      componentType: "menu_item",
      componentIds: ["chicken", "fish", "beef"],
      minChoices: 2,
      maxChoices: 2
    }]
  }],
  addons: [{ id: "bar", name: "Premium bar", active: true }],
  rentals: [{ id: "linen", name: "Linen", active: true }],
  settings: {
    menuSections: [{
      id: "food",
      name: "Food",
      items: ["salad", "chicken", "fish", "beef"].map((id) => ({ id, name: id, active: true }))
    }],
    eventTemplates: [{
      id: "wedding-reception",
      name: "Wedding Reception",
      pkg: "wedding",
      style: "Plated",
      hours: 6,
      addons: ["bar"],
      rentals: ["linen"],
      menuItems: ["salad"]
    }],
    configurationRules: []
  }
};

describe("commercial platform core", () => {
  test("adapts every existing Package into a simple Configurable Offer", () => {
    const offer = adaptPackageToConfigurableOffer({
      id: "classic",
      name: "Classic",
      includedMenuItemIds: ["salad"],
      includedAddonIds: [],
      includedRentalIds: []
    });
    expect(offer).toMatchObject({
      id: "classic",
      verticalType: "catering",
      legacyPackageId: "classic",
      choiceGroups: [],
      includedComponents: [{ componentType: "menu_item", componentId: "salad" }]
    });
    expect(Object.isFrozen(offer)).toBe(true);
  });

  test("enforces deterministic offer minimum and maximum choices", () => {
    const short = evaluateOfferConfiguration(catalog.packages[0], { mains: ["chicken"] }, catalog);
    const exact = evaluateOfferConfiguration(catalog.packages[0], { mains: ["chicken", "fish"] }, catalog);
    const long = evaluateOfferConfiguration(catalog.packages[0], { mains: ["chicken", "fish", "beef"] }, catalog);
    expect(short.violations[0].code).toBe("choice_minimum_not_met");
    expect(exact.valid).toBe(true);
    expect(long.violations[0].code).toBe("choice_maximum_exceeded");
  });

  test("fails closed when an offer references a missing or inactive component", () => {
    expect(() => evaluateOfferConfiguration({
      ...catalog.packages[0],
      choiceGroups: [{
        id: "mains",
        componentType: "menu_item",
        componentIds: ["missing"],
        minChoices: 1,
        maxChoices: 1
      }]
    }, { mains: ["missing"] }, catalog)).toThrowError(CommercialPlatformError);
  });

  test("adapts Event Templates and applies defaults without overwriting explicit work", () => {
    const template = adaptEventTemplateToCommercialTemplate(catalog.settings.eventTemplates[0]);
    const applied = applyCommercialTemplate({
      draft: { style: "Buffet", customerName: "Ada" },
      template,
      explicitFields: ["style"]
    });
    expect(template).toMatchObject({
      verticalType: "catering",
      offerRef: "wedding",
      componentSelections: { addons: ["bar"], rentals: ["linen"], menuItems: ["salad"] }
    });
    expect(applied.draft).toMatchObject({ style: "Buffet", customerName: "Ada", pkg: "wedding", hours: 6 });
    expect(applied.skippedExplicitFields).toEqual(["style"]);
    expect(applied.provenance.templateId).toBe("wedding-reception");
  });

  test("detects shallow template module collisions instead of silently choosing", () => {
    const result = composeCommercialTemplate(catalog.settings.eventTemplates[0], [{
      id: "premium-bar",
      componentSelections: { addons: ["bar"] },
      configurationDefaults: { style: "Cocktail" }
    }]);
    expect(result.valid).toBe(false);
    expect(result.collisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "configurationDefaults.style", moduleId: "premium-bar" })
    ]));
  });

  test("evaluates bounded declarative rules without mutating the quote context", () => {
    const context = Object.freeze({ event: { serviceStyle: "plated", demandQuantity: 120 }, selection: { premiumBar: true } });
    const rules = [{
      id: "plated-server-coverage",
      type: "recommendation",
      conditions: [
        { path: "event.serviceStyle", operator: "eq", value: "plated" },
        { path: "event.demandQuantity", operator: "gte", value: 100 }
      ],
      effect: { operator: "recommend", target: "resources.servers", value: 10 },
      reason: "Large plated events need server coverage.",
      enabled: true
    }];
    const before = JSON.stringify(context);
    const first = evaluateConfigurationRules(rules, context, catalog);
    const second = evaluateConfigurationRules(rules, context, catalog);
    expect(first).toEqual(second);
    expect(first.matched[0]).toMatchObject({ ruleId: "plated-server-coverage", matched: true });
    expect(JSON.stringify(context)).toBe(before);
  });

  test("rejects unknown rule operators and conflicting mandatory rules", () => {
    expect(() => validateConfigurationRule({
      id: "unsafe",
      type: "validation",
      conditions: [{ path: "event.guests", operator: "execute", value: "code" }],
      effect: { operator: "block" },
      enabled: true
    }, catalog)).toThrow(/unknown condition operator/i);

    expect(() => validateCommercialPublication({
      ...catalog,
      settings: {
        ...catalog.settings,
        configurationRules: [
          { id: "require-bar", type: "requirement", conditions: [], effect: { operator: "require", target: "selection.bar", value: true }, enabled: true },
          { id: "exclude-bar", type: "exclusion", conditions: [], effect: { operator: "exclude", target: "selection.bar", value: true }, enabled: true }
        ]
      }
    })).toThrow(/conflicting mandatory rules/i);
  });

  test("keeps catering language in the pack while the kernel contract stays neutral", () => {
    expect(CATERING_VERTICAL_PACK.terminology).toMatchObject({ demandQuantity: "Guests", configurableOffer: "Package" });
    expect(validateVerticalPack(CATERING_VERTICAL_PACK)).toStrictEqual(CATERING_VERTICAL_PACK);
  });
});
