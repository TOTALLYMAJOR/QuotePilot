import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  buildAmbientPackageMenuObjects,
  createAmbientMenuReorderIntent,
  createAmbientMenuReplacementIntent,
  createAmbientPackageReplacementIntent
} from "../ambientPackageMenuObjects";
import {
  AMBIENT_PACKAGE_MENU_DRAFT_INTENTS,
  hydrateSavedQuoteDraft,
  normalizeAmbientDraftIntent,
  normalizeAmbientPackageMenuDraftIntent
} from "../quoteDraftRuntime";

function quoteFixture() {
  return {
    id: "quote-a",
    quoteNumber: "Q-A",
    organizationId: "org-a",
    activeVersionId: "v0014",
    updatedAtISO: "2026-08-11T18:00:00.000Z",
    customer: {
      name: "Maya Bennett",
      email: "maya@example.test",
      phone: "555-0100",
      organization: "Bennett Foundation"
    },
    event: {
      name: "Autumn dinner",
      date: "2026-09-19",
      time: "18:00",
      hours: 6,
      venue: "The Foundry Hall",
      venueAddress: "100 Main St",
      guests: 120,
      servers: 8,
      chefs: 3,
      bartenders: 2
    },
    selection: {
      packageId: "classic",
      packageName: "Classic",
      packageInclusions: {
        menuItems: [{ id: "salad", name: "Garden salad" }],
        addons: [{ id: "tea", name: "Tea service" }],
        rentals: [{ id: "chafer", name: "Chafer" }]
      },
      menuItems: ["salad", "chicken"],
      menuItemsSnapshot: [
        { id: "salad", name: "Garden salad", quantity: 2, includedInPackage: true },
        { id: "chicken", name: "Herb chicken", quantity: 3, includedInPackage: false }
      ],
      menuItemNames: ["Garden salad", "Herb chicken"],
      menuItemQuantities: { salad: 2, chicken: 3 },
      addons: [],
      rentals: []
    }
  };
}

function catalogFixture() {
  return {
    organizationId: "org-a",
    sourceLabel: "Explicit organization catalog",
    catalogRevision: 12,
    freshness: {
      state: "fresh",
      observedAtISO: "2026-08-11T18:01:00.000Z"
    },
    packages: [
      {
        id: "classic",
        name: "Classic",
        active: true,
        includedMenuItemIds: ["salad"],
        includedAddonIds: ["tea"],
        includedRentalIds: ["chafer"]
      },
      {
        id: "premium",
        name: "Premium",
        active: true,
        includedMenuItemIds: ["salad", "chicken", "salmon"],
        includedAddonIds: ["tea"],
        includedRentalIds: ["chafer"]
      }
    ],
    menuSections: [{
      id: "entrees",
      name: "Entrees",
      items: [
        { id: "salad", name: "Garden salad", active: true },
        { id: "chicken", name: "Herb chicken", active: true },
        { id: "salmon", name: "Salmon", active: true }
      ]
    }]
  };
}

function intelligentObjects(quote = quoteFixture(), catalog = catalogFixture()) {
  return buildAmbientPackageMenuObjects(quote, {
    role: "admin",
    ordinaryEditAllowed: true,
    catalogEvidence: catalog
  });
}

function editorCatalogPackages(catalog = catalogFixture()) {
  return catalog.packages.map((item) => ({ ...item, ppp: 25 }));
}

function clone(value) {
  return structuredClone(value);
}

describe("Ambient package/menu draft runtime", () => {
  test("normalizes the exact package replacement wire contract without importing the object kernel", () => {
    const quote = quoteFixture();
    const objects = intelligentObjects(quote);
    const intent = createAmbientPackageReplacementIntent(objects.package, "premium");
    const normalized = normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent: intent,
      catalogContext: objects.catalogEvidence,
      enabled: true
    });

    expect(normalized).toEqual({
      ok: true,
      family: "package_menu",
      focusField: "",
      fields: ["selection.packageId", "selection.packageName"],
      kind: "replace_package",
      label: "Package replacement",
      draftChange: {
        state: "pending_review",
        actionId: "replace-package-in-draft",
        authority: "draft_only",
        commit: false,
        target: {
          objectId: "package",
          fieldPaths: ["selection.packageId", "selection.packageName"],
          trustedReconciliationRequired: ["selection.packageInclusions"]
        },
        catalogScope: {
          organizationId: "org-a",
          catalogRevision: 12,
          sourceLabel: "Explicit organization catalog",
          observedAt: "2026-08-11T18:01:00.000Z",
          freshness: "fresh"
        },
        before: { packageId: "classic" },
        proposed: { packageId: "premium", packageName: "Premium" },
        candidate: {
          id: "premium",
          name: "Premium",
          catalogActive: true,
          operationalAvailability: "not_evaluated"
        },
        consequencePreviewRequired: true,
        requiresOutcomeNamedSave: true
      }
    });
    expect(Object.isFrozen(normalized.draftChange.target.fieldPaths)).toBe(true);
  });

  test("hydrates package replacement as pending metadata while leaving the editor form unchanged", () => {
    const quote = quoteFixture();
    const beforeQuote = clone(quote);
    const objects = intelligentObjects(quote);
    const beforeCatalogContext = clone(objects.catalogEvidence);
    const intent = createAmbientPackageReplacementIntent(objects.package, "premium");
    const result = hydrateSavedQuoteDraft({
      quote,
      previousForm: { pkg: "classic", preserved: "yes" },
      catalogPackages: editorCatalogPackages(),
      ambientCatalogContext: objects.catalogEvidence,
      draftIntent: intent,
      ambientEnabled: true
    });

    expect(result).toMatchObject({
      ok: true,
      form: { pkg: "classic", preserved: "yes" },
      stagedFields: [],
      patchSource: "",
      ambientDraftIntent: {
        family: "package_menu",
        kind: "replace_package",
        focusField: "",
        draftChange: {
          state: "pending_review",
          before: { packageId: "classic" },
          proposed: { packageId: "premium", packageName: "Premium" },
          commit: false
        }
      }
    });
    expect(result.form.pkg).not.toBe("premium");
    expect(result).not.toHaveProperty("savedQuote");
    expect(result).not.toHaveProperty("pricingAuthority");
    expect(result).not.toHaveProperty("authoritativePricing");
    expect(quote).toEqual(beforeQuote);
    expect(objects.catalogEvidence).toEqual(beforeCatalogContext);
    expect(Object.isFrozen(result.ambientDraftIntent.draftChange)).toBe(true);
  });

  test("normalizes menu replacement with exact saved quantity and trusted reconciliation metadata", () => {
    const quote = quoteFixture();
    const objects = intelligentObjects(quote);
    const intent = createAmbientMenuReplacementIntent(objects.menu, {
      selectedItemId: "chicken",
      replacementItemId: "salmon"
    });
    const result = hydrateSavedQuoteDraft({
      quote,
      catalogPackages: editorCatalogPackages(),
      ambientCatalogContext: objects.catalogEvidence,
      draftIntent: intent,
      ambientEnabled: true
    });

    expect(result).toMatchObject({
      ok: true,
      form: {
        pkg: "classic",
        menuItems: ["salad", "chicken"],
        menuItemQuantities: { salad: 2, chicken: 3 }
      },
      stagedFields: [],
      ambientDraftIntent: {
        family: "package_menu",
        kind: "replace_menu_item",
        fields: ["selection.menuItems", "selection.menuItemQuantities"],
        draftChange: {
          before: { itemId: "chicken", orderIndex: 1, quantity: 3 },
          proposed: {
            itemId: "salmon",
            orderIndex: 1,
            quantity: 3,
            quantityPolicy: "preserve_explicit_saved_quantity"
          },
          target: {
            trustedReconciliationRequired: [
              "selection.menuItemsSnapshot",
              "selection.menuItemNames",
              "selection.packageInclusions"
            ]
          }
        }
      }
    });
    expect(result.form.menuItems).toEqual(["salad", "chicken"]);
  });

  test("normalizes pointer and keyboard reorder as the same pending order", () => {
    const quote = quoteFixture();
    const objects = intelligentObjects(quote);
    const results = ["pointer", "keyboard"].map((interaction) => {
      const intent = createAmbientMenuReorderIntent(objects.menu, {
        itemId: "salad",
        toIndex: 1,
        interaction
      });
      return normalizeAmbientDraftIntent({
        quote,
        draftIntent: intent,
        catalogContext: objects.catalogEvidence,
        enabled: true
      });
    });

    expect(results[0].draftChange.proposed.order).toEqual(["chicken", "salad"]);
    expect(results[1].draftChange.proposed.order).toEqual(results[0].draftChange.proposed.order);
    expect(results.map((result) => result.draftChange.interaction.method)).toEqual([
      "pointer",
      "keyboard"
    ]);
    expect(results[0].draftChange.interaction.equivalence).toBe(
      "pointer_and_keyboard_produce_the_same_order_intent"
    );
  });

  test("rejects stale revision and quote-scope mismatches distinctly", () => {
    const quote = quoteFixture();
    const objects = intelligentObjects(quote);
    const intent = createAmbientPackageReplacementIntent(objects.package, "premium");
    const stale = clone(intent);
    stale.baseContext.baseRevisionId = "v0013";
    const wrongQuote = clone(intent);
    wrongQuote.baseContext.quoteId = "quote-b";

    expect(normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent: stale,
      catalogContext: objects.catalogEvidence,
      enabled: true
    })).toMatchObject({
      ok: false,
      code: "ambient_package_menu_intent_revision_mismatch"
    });
    expect(normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent: wrongQuote,
      catalogContext: objects.catalogEvidence,
      enabled: true
    })).toMatchObject({
      ok: false,
      code: "ambient_package_menu_intent_quote_scope_mismatch"
    });
  });

  test.each([
    ["missing", null],
    ["stale", (context) => {
      context.state = "stale";
      context.freshness.state = "stale";
      context.freshness.reason = "A newer catalog may exist.";
    }],
    ["organization", (context) => { context.organizationId = "org-b"; }],
    ["revision", (context) => { context.catalogRevision = 13; }],
    ["source", (context) => { context.sourceLabel = "Another catalog source"; }],
    ["observation", (context) => { context.freshness.observedAt = "2026-08-11T18:02:00.000Z"; }]
  ])("rejects %s catalog scope instead of accepting a replacement", (_label, alter) => {
    const quote = quoteFixture();
    const objects = intelligentObjects(quote);
    const intent = createAmbientPackageReplacementIntent(objects.package, "premium");
    const context = alter ? clone(objects.catalogEvidence) : null;
    alter?.(context);

    expect(normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent: intent,
      catalogContext: context,
      enabled: true
    })).toMatchObject({
      ok: false,
      code: "ambient_package_menu_intent_catalog_scope_mismatch",
      consequence: expect.stringContaining("unchanged")
    });
  });

  test("rejects duplicate catalog identities as ambiguous catalog evidence", () => {
    const quote = quoteFixture();
    const objects = intelligentObjects(quote);
    const intent = createAmbientPackageReplacementIntent(objects.package, "premium");
    const context = clone(objects.catalogEvidence);
    context.packages.push(clone(context.packages[1]));

    expect(normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent: intent,
      catalogContext: context,
      enabled: true
    })).toMatchObject({
      ok: false,
      code: "ambient_package_menu_intent_catalog_scope_mismatch"
    });
  });

  test("rejects package or menu intent contents that no longer match saved evidence", () => {
    const quote = quoteFixture();
    const objects = intelligentObjects(quote);
    const packageIntent = clone(createAmbientPackageReplacementIntent(objects.package, "premium"));
    packageIntent.proposed.packageName = "Made up package";
    const menuIntent = clone(createAmbientMenuReplacementIntent(objects.menu, {
      selectedItemId: "chicken",
      replacementItemId: "salmon"
    }));
    menuIntent.before.quantity = 4;
    const reorderIntent = clone(createAmbientMenuReorderIntent(objects.menu, {
      itemId: "salad",
      toIndex: 1,
      interaction: "pointer"
    }));
    reorderIntent.proposedOrder = ["salad", "chicken"];

    for (const draftIntent of [packageIntent, menuIntent, reorderIntent]) {
      expect(normalizeAmbientPackageMenuDraftIntent({
        quote,
        draftIntent,
        catalogContext: objects.catalogEvidence,
        enabled: true
      })).toMatchObject({
        ok: false,
        code: "ambient_package_menu_intent_saved_scope_mismatch"
      });
    }
  });

  test("rejects extra wire fields and mixed patch-plus-intent handoffs", () => {
    const quote = quoteFixture();
    const objects = intelligentObjects(quote);
    const intent = {
      ...createAmbientPackageReplacementIntent(objects.package, "premium"),
      ambiguousExtra: true
    };

    expect(normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent: intent,
      catalogContext: objects.catalogEvidence,
      enabled: true
    })).toMatchObject({ ok: false, code: "ambient_package_menu_intent_invalid" });
    expect(hydrateSavedQuoteDraft({
      quote,
      ambientEnabled: true,
      ambientCatalogContext: objects.catalogEvidence,
      draftIntent: createAmbientPackageReplacementIntent(objects.package, "premium"),
      draftPatch: {
        source: "ambient-guest-scenario-v1",
        baseRevisionId: "v0014",
        event: { guests: 130 }
      }
    })).toMatchObject({
      ok: false,
      code: "ambient_draft_handoff_ambiguous"
    });
  });

  test("fails closed on cyclic reorder semantics instead of recursing or throwing", () => {
    const quote = quoteFixture();
    const objects = intelligentObjects(quote);
    const intent = clone(createAmbientMenuReorderIntent(objects.menu, {
      itemId: "salad",
      toIndex: 1,
      interaction: "pointer"
    }));
    intent.interactionSemantics.pointer = intent.interactionSemantics;

    expect(() => normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent: intent,
      catalogContext: objects.catalogEvidence,
      enabled: true
    })).not.toThrow();
    expect(normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent: intent,
      catalogContext: objects.catalogEvidence,
      enabled: true
    })).toMatchObject({
      ok: false,
      code: "ambient_package_menu_intent_saved_scope_mismatch"
    });
  });

  test("ignores package/menu handoffs while Ambient is disabled", () => {
    const quote = quoteFixture();
    const objects = intelligentObjects(quote);
    const result = hydrateSavedQuoteDraft({
      quote,
      catalogPackages: editorCatalogPackages(),
      ambientEnabled: false,
      draftIntent: createAmbientPackageReplacementIntent(objects.package, "premium"),
      ambientCatalogContext: { corrupted: true }
    });

    expect(result).toMatchObject({
      ok: true,
      form: { pkg: "classic" },
      stagedFields: [],
      ambientDraftIntent: null
    });
  });

  test("keeps the ordinary runtime independent from the large intelligent-object module", () => {
    const patchSource = readFileSync(
      fileURLToPath(new URL("../ambientQuoteDraftPatch.js", import.meta.url)),
      "utf8"
    );
    const runtimeSource = readFileSync(
      fileURLToPath(new URL("../quoteDraftRuntime.js", import.meta.url)),
      "utf8"
    );

    expect(patchSource).not.toContain("ambientPackageMenuObjects");
    expect(runtimeSource).not.toContain("ambientPackageMenuObjects");
    expect(AMBIENT_PACKAGE_MENU_DRAFT_INTENTS.replace_package).toMatchObject({
      actionId: "replace-package-in-draft",
      objectId: "package"
    });
  });
});
