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

import AdminCatalogModal, {
  AdminCatalogView,
  blurManagedMenuItemOnEnter,
  eventTemplateMenuItemReferences,
  hasUnrelatedManagedMenuDraft,
  hasNoMenuInventory,
  packageMenuItemReferences,
  parseEventTemplateDrafts,
  removeCatalogRowWithInclusions,
  resolveManagedEventTypeId,
  buildConfigurationRulesPresentation,
  buildCommercialComponentUsageProjection,
  buildAdvancedPricingPolicySummary,
  patchConfigurationRuleSource
} from "../AdminCatalogModal";
import { DEFAULT_SETTINGS } from "../../data/mockCatalog";
import { applyPortalThemePreset } from "../../data/portalThemePresets";

function renderCatalog(catalog, props = {}) {
  return renderToStaticMarkup(
    <AdminCatalogModal
      open
      catalog={catalog}
      organizationId="test-org"
      onClose={() => {}}
      onSave={async () => ({ ok: true })}
      onApplyStarterPack={async () => ({ ok: true })}
      saving={false}
      {...props}
    />
  );
}

describe("Admin Catalog starter choice", () => {
  test("preserves modal compatibility while exposing an embedded route presentation", () => {
    const catalog = {
      packages: [],
      addons: [],
      rentals: [],
      settings: { pricingSetupConfirmed: false }
    };
    const embeddedHtml = renderToStaticMarkup(
      <AdminCatalogView
        open
        catalog={catalog}
        organizationId="test-org"
        onClose={() => {}}
        onSave={async () => ({ ok: true })}
        onApplyStarterPack={async () => ({ ok: true })}
        saving={false}
      />
    );
    const modalHtml = renderCatalog(catalog);

    expect(embeddedHtml).toContain("container workspace-route-main embedded-workspace-route");
    expect(embeddedHtml).toContain('role="region"');
    expect(embeddedHtml).toContain("workspace-route-card");
    expect(embeddedHtml).not.toContain('aria-modal="true"');
    expect(embeddedHtml).toContain(">Back to Home</button>");
    expect(modalHtml).toContain("modal-overlay");
    expect(modalHtml).toContain('role="dialog"');
    expect(modalHtml).toContain('aria-modal="true"');
    expect(modalHtml).toContain(">Close</button>");
  });

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
    expect(html).toContain("Set up Library manually");
    expect(html).not.toContain(">Offers</button>");
    expect(html).not.toContain("Save catalog changes");
  });

  test("an incomplete catalog with existing records opens manual editing without calling it blank", () => {
    const html = renderCatalog({
      packages: [{ id: "existing", name: "Existing package", ppp: 30, active: true }],
      addons: [],
      rentals: [],
      eventTypes: [],
      settings: { pricingSetupConfirmed: false }
    }, { initialTab: "starter" });

    expect(html).toContain("Existing catalog records were found.");
    expect(html).toContain("Setup presets are staged intent");
    expect(html).toContain(">Offers</button>");
    expect(html).not.toContain("Use Wedding &amp; events");
  });

  test("empty confirmed pricing still shows starter packs to recover catalog data", () => {
    const html = renderCatalog({
      packages: [],
      addons: [],
      rentals: [],
      settings: { pricingSetupConfirmed: true }
    });

    expect(html).toContain("What kind of catering do you do most?");
    expect(html).toContain("Use Wedding &amp; events");
    expect(html).toContain("Use Corporate drop-off");
    expect(html).toContain("Set up Library manually");
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
    expect(html).toContain(">Offers</button>");
    expect(html).toContain(">Menu</button>");
    expect(html).toContain("View populated menu");
  });

  test("a confirmed catalog keeps starter provenance without a disabled pack decision", () => {
    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [],
      rentals: [],
      settings: {
        pricingSetupConfirmed: true,
        starterCatalogPack: {
          id: "wedding-events",
          version: 1,
          name: "Wedding & events",
          appliedCatalogRevision: 1
        }
      }
    });

    expect(html).toContain("Your Wedding &amp; events catalog is populated.");
    expect(html).not.toContain(">Setup</button>");
    expect(html).not.toContain("What kind of catering do you do most?");
    expect(html).not.toContain("Starter packs are available only during initial unconfirmed catalog setup.");
  });

  test("presents actual configuration rules in business language before advanced source", () => {
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
    const presentation = buildConfigurationRulesPresentation(JSON.stringify(rules));
    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [],
      rentals: [],
      settings: { pricingSetupConfirmed: true, configurationRules: rules }
    }, { initialTab: "rules" });

    expect(presentation.records[0]).toMatchObject({
      title: "Rule 1",
      type: "Recommendation",
      conditions: ["Service style is plated", "Guests is at least 100"],
      effect: "Recommend Servers: 10",
      reason: "Large plated events need server coverage."
    });
    expect(html).toContain("Quote rules");
    expect(html).toContain('data-configuration-rule-id="plated-server-coverage"');
    expect(html).toContain("Service style is plated AND Guests is at least 100");
    expect(html).toContain("Recommend Servers: 10");
    expect(html).toContain('data-rule-statement="when"');
    expect(html).toContain('data-rule-statement="then"');
    expect(html).toContain('data-rule-statement="why"');
    expect(html).toContain("Large plated events need server coverage.");
    expect(html).toContain('data-rule-conjunction="and"');
    const conditionOperator = html.match(/<select aria-label="Rule 1 condition 1 operator">[\s\S]*?<\/select>/)?.[0] || "";
    const effectOperator = html.match(/<select aria-label="Rule 1 result operator">[\s\S]*?<\/select>/)?.[0] || "";
    expect([...conditionOperator.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(["eq", "neq", "gte", "lte", "includes", "selected"]);
    expect([...effectOperator.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(["block", "require", "recommend", "select", "exclude"]);
    expect(html).toContain("Advanced rule source");
    expect(html).toContain("data-configuration-rule-technical-source");
    const advancedTag = html.match(/<details class="admin-menu-disclosure rule-source-disclosure"[^>]*>/)?.[0] || "";
    expect(advancedTag).not.toContain("open=");
  });

  test("validates structured rules without discarding catalog evidence boundaries", () => {
    const catalog = {
      addons: [{ id: "coffee-service", name: "Coffee service", active: true }],
      rentals: [],
      resources: [],
      menuItems: []
    };
    const rules = [{
      id: "unsupported-comparison",
      type: "requirement",
      conditions: [{ path: "event.guests", operator: "gt", value: 80 }],
      effect: { operator: "require", target: "resources.servers", value: 4 },
      reason: "Coverage is required."
    }, {
      id: "coffee-recommendation",
      type: "recommendation",
      conditions: [{ path: "event.serviceStyle", operator: "eq", value: "buffet" }],
      effect: {
        operator: "recommend",
        componentRef: { componentType: "addon", componentId: "coffee-service" }
      },
      reason: "Offer coffee with buffet service."
    }, {
      id: "menu-recommendation",
      type: "recommendation",
      conditions: [],
      effect: {
        operator: "recommend",
        componentRef: { componentType: "menu_item", componentId: "full-menu-item" }
      },
      reason: "Review the full menu."
    }];
    const partial = buildConfigurationRulesPresentation(JSON.stringify(rules), {
      catalog,
      menuInventoryComplete: false
    });
    const complete = buildConfigurationRulesPresentation(JSON.stringify(rules), {
      catalog: { ...catalog, menuInventoryComplete: true },
      menuInventoryComplete: true
    });

    expect(partial.records[0]).toMatchObject({ validationState: "attention", enabled: true });
    expect(partial.records[1]).toMatchObject({ validationState: "ready", effect: "Recommend Coffee service" });
    expect(partial.records[1].effect).not.toContain("coffee-service");
    expect(partial.records[2]).toMatchObject({ validationState: "needs-check" });
    expect(partial.records[2].effect).toContain("Menu item awaiting full Library check");
    expect(complete.records[2]).toMatchObject({ validationState: "attention" });
  });

  test("patches the existing rule source immutably while preserving forward fields", () => {
    const originalRules = [{
      id: "future-safe-rule",
      type: "recommendation",
      enabled: true,
      futureRuleField: { mode: "preserve" },
      conditions: [{
        path: "event.guests",
        operator: "gte",
        value: 100,
        futureConditionField: "preserve"
      }],
      effect: {
        operator: "recommend",
        value: true,
        futureEffectField: ["preserve"],
        componentRef: {
          componentType: "addon",
          componentId: "coffee-service",
          futureReferenceField: 7
        }
      },
      reason: "Original reason"
    }];
    const originalSource = JSON.stringify(originalRules);
    let nextSource = patchConfigurationRuleSource(originalSource, {
      ruleIndex: 0, field: "enabled", value: false
    });
    nextSource = patchConfigurationRuleSource(nextSource, {
      ruleIndex: 0, field: "type", value: "requirement"
    });
    nextSource = patchConfigurationRuleSource(nextSource, {
      section: "condition", ruleIndex: 0, conditionIndex: 0, field: "operator", value: "lte"
    });
    nextSource = patchConfigurationRuleSource(nextSource, {
      section: "condition", ruleIndex: 0, conditionIndex: 0, field: "value", value: 150
    });
    nextSource = patchConfigurationRuleSource(nextSource, {
      section: "effect", ruleIndex: 0, field: "value", value: false
    });
    nextSource = patchConfigurationRuleSource(nextSource, {
      section: "componentRef", ruleIndex: 0, field: "componentId", value: "tea-service"
    });
    nextSource = patchConfigurationRuleSource(nextSource, {
      ruleIndex: 0, field: "reason", value: "Updated reason"
    });
    const [updated] = JSON.parse(nextSource);

    expect(JSON.parse(originalSource)).toEqual(originalRules);
    expect(updated).toMatchObject({
      enabled: false,
      type: "requirement",
      reason: "Updated reason",
      futureRuleField: { mode: "preserve" }
    });
    expect(updated.conditions[0]).toEqual({
      path: "event.guests",
      operator: "lte",
      value: 150,
      futureConditionField: "preserve"
    });
    expect(updated.effect).toMatchObject({
      value: false,
      futureEffectField: ["preserve"],
      componentRef: {
        componentType: "addon",
        componentId: "tea-service",
        futureReferenceField: 7
      }
    });
  });

  test("keeps malformed advanced rule source explicit instead of inventing a summary", () => {
    const presentation = buildConfigurationRulesPresentation("{not-json}");
    expect(presentation.records).toEqual([]);
    expect(presentation.enabledCount).toBe(0);
    expect(presentation.error).toBeTruthy();
    expect(presentation.requiresAdvancedSource).toBe(true);

    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [],
      rentals: [],
      settings: { pricingSetupConfirmed: true, configurationRules: ["not-a-rule-record"] }
    }, { initialTab: "rules" });
    const advancedTag = html.match(/<details class="admin-menu-disclosure rule-source-disclosure"[^>]*>/)?.[0] || "";
    expect(advancedTag).toContain('open=""');
  });

  test("summarizes advanced pricing cost and source attention while closed", () => {
    expect(buildAdvancedPricingPolicySummary({
      marginsEnabled: true,
      activeCostCount: 4,
      recordedCostCount: 3,
      recordedStaffCostCount: 1,
      sourceErrorCount: 1
    })).toEqual({
      hasAttention: true,
      attention: ["3 cost entries need attention", "1 advanced source needs correction"],
      label: "Needs attention · 3 cost entries need attention · 1 advanced source needs correction"
    });
  });

  test("orients pricing around published readiness and quote-level explanation", () => {
    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [],
      rentals: [],
      settings: {
        pricingSetupConfirmed: false,
        catalogRevision: 7
      }
    }, { initialTab: "pricing" });

    expect(html).toContain("Pricing readiness");
    expect(html).toContain("line-by-line price explanation");
    expect(html).toContain("Pricing is not confirmed for this catalog revision");
    expect(html).toContain("I confirm these rates and defaults are ready for new quotes.");
    expect(html).toContain('data-pricing-policy-group="base"');
    expect(html).toContain('data-pricing-policy-group="adjustments-context"');
    expect(html).toContain('data-pricing-policy-group="fees"');
    expect(html).toContain('data-pricing-policy-group="tax"');
    expect(html).toContain('data-pricing-policy-group="deposit"');
    expect(html).toContain('data-pricing-policy-group="advanced"');
    expect(html.indexOf('data-pricing-policy-group="base"')).toBeLessThan(
      html.indexOf('data-pricing-policy-group="adjustments-context"')
    );
    expect(html.indexOf('data-pricing-policy-group="adjustments-context"')).toBeLessThan(
      html.indexOf('data-pricing-policy-group="fees"')
    );
    expect(html.indexOf('data-pricing-policy-group="fees"')).toBeLessThan(
      html.indexOf('data-pricing-policy-group="tax"')
    );
    expect(html.indexOf('data-pricing-policy-group="tax"')).toBeLessThan(
      html.indexOf('data-pricing-policy-group="deposit"')
    );
    expect(html.indexOf('data-pricing-policy-group="deposit"')).toBeLessThan(
      html.indexOf('data-pricing-policy-group="advanced"')
    );
    [
      "integration",
      "guided-recommendations",
      "workspace-access",
      "proposal-details",
      "customer-connections",
      "brand",
      "technical-sources"
    ].forEach((section) => {
      const tag = html.match(new RegExp(`<details[^>]*data-pricing-policy-advanced-section="${section}"[^>]*>`))?.[0] || "";
      expect(tag).toBeTruthy();
      expect(tag).not.toContain("open=");
    });
    expect(html.match(/>Retry limit</g)).toHaveLength(1);
    expect(html.match(/>Quote prepared by/g)).toHaveLength(1);
    expect(html.match(/>Business name/g)).toHaveLength(1);
  });

  test("surfaces malformed fee, tax, and advanced sources in their closed summaries", () => {
    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [],
      rentals: [],
      settings: {
        pricingSetupConfirmed: true,
        serviceFeeTiers: "not-an-array",
        taxRegions: { invalid: true },
        eventTemplates: "not-an-array"
      }
    }, { initialTab: "pricing" });

    expect(html).toContain("Needs attention · fee tiers source");
    expect(html).toContain("Needs attention · tax region source");
    expect(html).toContain("1 advanced source needs correction");
  });

  test("keeps component identity and sell price primary while nesting planning and technical detail", () => {
    const baseCatalog = {
      packages: [{
        id: "celebration",
        name: "Celebration",
        ppp: 28,
        includedAddonIds: ["coffee-service"],
        includedRentalIds: ["linen-set"]
      }],
      addons: [{ id: "coffee-service", name: "Coffee service", pricingType: "per_event", price: 125, active: true }],
      rentals: [{ id: "linen-set", name: "Linen set", pricingType: "per_item", price: 12, qtyPerGuests: 8, active: true }],
      settings: {
        pricingSetupConfirmed: true,
        eventTemplates: [{
          id: "formal-gala-template",
          name: "Formal gala",
          addons: ["coffee-service"],
          rentals: ["linen-set"]
        }]
      }
    };
    const addonHtml = renderCatalog(baseCatalog, { initialTab: "addons" });
    const rentalHtml = renderCatalog(baseCatalog, { initialTab: "rentals" });
    const addonUsage = buildCommercialComponentUsageProjection(baseCatalog, "addons", "coffee-service");
    const addonSummary = addonHtml.match(/<summary class="commercial-component-summary">[\s\S]*?<\/summary>/)?.[0] || "";
    const addonUsageMarkup = addonHtml.match(/<section class="commercial-component-usage"[\s\S]*?<\/section>/)?.[0] || "";

    expect(addonHtml).toContain('data-commercial-component-collection="addons"');
    expect(addonHtml).toContain('<details class="commercial-component-record"');
    expect(addonHtml).toContain('data-commercial-component-kind="addon"');
    expect(addonHtml).toContain('data-commercial-component-group="primary"');
    expect(addonHtml.indexOf('data-commercial-component-group="primary"')).toBeLessThan(
      addonHtml.indexOf('data-commercial-component-group="technical"')
    );
    expect(addonHtml).toContain("Coffee service sell price");
    expect(addonSummary).toContain("Coffee service");
    expect(addonSummary).toContain("$125.00");
    expect(addonSummary).toContain("per event");
    expect(addonSummary).toContain("Available");
    expect(addonSummary).not.toContain("coffee-service");
    expect(addonUsage).toEqual({
      offerNames: ["Celebration"],
      templateNames: ["Formal gala"],
      offerCount: 1,
      templateCount: 1,
      totalCount: 2
    });
    expect(addonUsageMarkup).toContain("Celebration");
    expect(addonUsageMarkup).toContain("Formal gala");
    expect(addonUsageMarkup).not.toContain("coffee-service");
    expect(addonUsageMarkup).not.toContain("formal-gala-template");
    expect(rentalHtml).toContain('data-commercial-component-collection="rentals"');
    expect(rentalHtml).toContain('data-commercial-component-group="quantity-planning"');
    expect(rentalHtml).toContain("Guests per item");
    expect(rentalHtml).not.toContain("One item per guests");
    expect(rentalHtml.indexOf('data-commercial-component-group="primary"')).toBeLessThan(
      rentalHtml.indexOf('data-commercial-component-group="quantity-planning"')
    );
    expect(rentalHtml.indexOf('data-commercial-component-group="quantity-planning"')).toBeLessThan(
      rentalHtml.indexOf('data-commercial-component-group="technical"')
    );
    expect(rentalHtml).toContain("Stable identity used by saved offers, templates, and quotes.");
    const rentalTechnicalMarkup = rentalHtml.match(/<details class="commercial-component-group commercial-component-technical"[\s\S]*?<\/details>/)?.[0] || "";
    expect(rentalTechnicalMarkup).toContain('value="linen-set"');
  });

  test("opens component records with invalid business fields and names the required correction", () => {
    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [{ id: "needs-business-fields", name: "", pricingType: "per_event", price: -1, active: true }],
      rentals: [],
      settings: { pricingSetupConfirmed: true, eventTemplates: [] }
    }, { initialTab: "addons" });

    expect(html).toContain('data-commercial-component-state="attention"');
    expect(html).toContain("Needs attention · Add a display name · Enter a valid sell price");
    expect(html).toContain("Price needs attention");
  });

  test("pricing admin exposes proposal font size and live brand readiness controls", () => {
    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [],
      rentals: [],
      settings: {
        pricingSetupConfirmed: true,
        brandName: "Acme Events",
        brandTagline: "Polished service",
        brandLogoUrl: "https://cdn.example.test/acme-logo.png",
        documentFontScale: "large"
      }
    }, { initialTab: "pricing" });

    expect(html).toContain("Proposal font size");
    expect(html).toContain("Controls client preview and PDF text size");
    expect(html).toContain("Large - Increases client-facing readability.");
    expect(html).toContain("Proposal letterhead");
    expect(html).toContain("Logo preview is active.");
    expect(html).toContain("Large proposal text");
  });

  test("package workspace defaults to current selections while keeping stale inclusions visible", () => {
    const html = renderCatalog({
      packages: [{
        id: "celebration",
        name: "Celebration",
        ppp: 28,
        includedAddonIds: ["retired-dessert"]
      }],
      addons: [
        { id: "active-dessert", name: "Active dessert", active: true },
        { id: "unused-retired-dessert", name: "Unused retired dessert", active: false },
        { id: "retired-dessert", name: "Retired dessert", active: false }
      ],
      rentals: [],
      settings: { pricingSetupConfirmed: true }
    });

    expect(html).toContain("Add add-ons");
    expect(html).not.toContain("Active dessert");
    expect(html).not.toContain("Unused retired dessert");
    expect(html).toContain("Retired dessert");
    expect(html).toContain("Inactive");
    expect(html).toContain("Nothing selected yet.");
  });

  test("removing add-ons or rentals also removes hidden package references", () => {
    const catalog = {
      packages: [{
        id: "celebration",
        includedAddonIds: ["dessert", "coffee"],
        includedRentalIds: ["linens", "chairs"]
      }],
      addons: [{ id: "dessert" }, { id: "coffee" }],
      rentals: [{ id: "linens" }, { id: "chairs" }],
      settings: {
        upsellRules: [
          { id: "dessert-rule", kind: "addon", targetId: "dessert" },
          { id: "chairs-rule", kind: "rental", targetId: "chairs" }
        ],
        eventTemplates: [{
          id: "wedding",
          pkg: "celebration",
          addons: ["dessert", "coffee"],
          rentals: ["linens", "chairs"]
        }]
      }
    };

    const withoutDessert = removeCatalogRowWithInclusions(catalog, "addons", 0);
    expect(withoutDessert.addons).toEqual([{ id: "coffee" }]);
    expect(withoutDessert.packages[0].includedAddonIds).toEqual(["coffee"]);
    expect(withoutDessert.packages[0].includedRentalIds).toEqual(["linens", "chairs"]);
    expect(withoutDessert.settings.upsellRules.map((rule) => rule.id)).toEqual(["chairs-rule"]);
    expect(withoutDessert.settings.eventTemplates[0].addons).toEqual(["coffee"]);

    const withoutLinens = removeCatalogRowWithInclusions(withoutDessert, "rentals", 0);
    expect(withoutLinens.rentals).toEqual([{ id: "chairs" }]);
    expect(withoutLinens.packages[0].includedRentalIds).toEqual(["chairs"]);
    expect(withoutLinens.settings.eventTemplates[0].rentals).toEqual(["chairs"]);
  });

  test("finds package references that must be removed before deleting a menu item", () => {
    const packages = [
      { id: "classic", name: "Classic", includedMenuItemIds: ["chicken"] },
      { id: "premium", name: "Premium", includedMenuItemIds: ["chicken", "rice"] },
      { id: "custom", name: "Custom", includedMenuItemIds: [] }
    ];

    expect(packageMenuItemReferences(packages, "chicken").map((pkg) => pkg.id))
      .toEqual(["classic", "premium"]);
    expect(packageMenuItemReferences(packages, "missing")).toEqual([]);
    const templates = [
      { id: "wedding", menuItems: ["chicken", "rice"] },
      { id: "corporate", menuItems: ["salad"] }
    ];
    expect(eventTemplateMenuItemReferences(templates, "chicken").map((template) => template.id))
      .toEqual(["wedding"]);
  });

  test("rejects malformed event-template dependencies instead of deleting through them", () => {
    expect(() => parseEventTemplateDrafts('{"id":"not-an-array"}')).toThrow("JSON array");
    expect(() => parseEventTemplateDrafts('[null]')).toThrow("must be an object");
    expect(() => parseEventTemplateDrafts('[{"id":"wedding","menuItems":"chicken"}]'))
      .toThrow("menuItems must be an array");
    expect(parseEventTemplateDrafts('[{"id":"wedding","menuItems":["chicken"]}]'))
      .toEqual([{ id: "wedding", menuItems: ["chicken"] }]);
  });

  test("Enter delegates menu item persistence to the single blur path", () => {
    const preventDefault = vi.fn();
    const blur = vi.fn();

    expect(blurManagedMenuItemOnEnter({
      key: "Enter",
      preventDefault,
      currentTarget: { blur }
    })).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(blur).toHaveBeenCalledOnce();

    expect(blurManagedMenuItemOnEnter({
      key: "Tab",
      preventDefault,
      currentTarget: { blur }
    })).toBe(false);
    expect(blur).toHaveBeenCalledOnce();
  });

  test("authoritative menu changes are blocked only by unrelated Admin drafts", () => {
    expect(hasUnrelatedManagedMenuDraft({
      catalogDraftDirty: true,
      targetItemId: "chicken"
    })).toBe(true);
    expect(hasUnrelatedManagedMenuDraft({
      menuItemDirty: { chicken: true },
      targetItemId: "chicken"
    })).toBe(false);
    expect(hasUnrelatedManagedMenuDraft({
      menuItemDirty: { chicken: true, rice: true },
      targetItemId: "chicken"
    })).toBe(true);
    expect(hasUnrelatedManagedMenuDraft({
      pendingMenuEditorDraft: true,
      targetItemId: "chicken"
    })).toBe(true);
  });

  test("a replaced pack falls back from a stale event selection to its first populated event", () => {
    const eventTypes = [
      { id: "wedding", name: "Wedding" },
      { id: "reception", name: "Reception" }
    ];

    expect(resolveManagedEventTypeId(eventTypes, "old-corporate-event")).toBe("wedding");
    expect(resolveManagedEventTypeId(eventTypes, "reception")).toBe("reception");
    expect(resolveManagedEventTypeId([], "old-corporate-event")).toBe("");
  });

  test("confirmed-menu recovery is offered only when the complete menu inventory is empty", () => {
    expect(hasNoMenuInventory([])).toBe(true);
    expect(hasNoMenuInventory([
      { categories: [], items: [] },
      { categories: [], items: [] }
    ])).toBe(true);
    expect(hasNoMenuInventory([
      { categories: [{ id: "mains" }], items: [] }
    ])).toBe(false);
    expect(hasNoMenuInventory([
      { categories: [], items: [{ id: "chicken" }] }
    ])).toBe(false);
  });

  test("pricing shows four named accessible portal presets and an immediate matching preview", () => {
    const html = renderCatalog({
      packages: [{ id: "celebration", name: "Celebration", ppp: 28 }],
      addons: [],
      rentals: [],
      settings: applyPortalThemePreset({
        ...DEFAULT_SETTINGS,
        brandName: "Northstar Catering",
        pricingSetupConfirmed: true
      }, "garden-sage")
    }, { initialTab: "pricing" });

    expect(html.match(/aria-label="Use /g)).toHaveLength(4);
    expect(html).toContain("Use Midnight Amber. Dark, cinematic backdrop with warm gold accents.");
    expect(html).toContain("Use Warm Linen. Soft neutral canvas for classic, elegant events.");
    expect(html).toContain("Use Garden Sage. Calm green palette for natural and community settings.");
    expect(html).toContain("Use Coastal Blue. Fresh blue palette for clean, modern proposals.");
    expect(html).toContain("aria-label=\"Customer portal preview: Garden Sage\"");
    expect(html).toContain("Your proposal from Northstar Catering");
    expect(html).toContain("aria-pressed=\"true\"");
  });
});
