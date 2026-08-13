import { describe, expect, test } from "vitest";
import {
  buildAmbientPackageMenuObjects,
  createAmbientMenuReorderIntent,
  createAmbientMenuReplacementIntent,
  createAmbientPackageReplacementIntent
} from "../ambientPackageMenuObjects";
import { normalizeAmbientPackageMenuDraftIntent } from "../ambientQuoteDraftPatch";
import {
  AMBIENT_PACKAGE_MENU_DRAFT_ADOPTION_MODEL,
  adoptAmbientPackageMenuDraftChange
} from "../ambientPackageMenuDraftAdoption";

function quoteFixture() {
  return {
    id: "quote-a",
    organizationId: "org-a",
    activeVersionId: "v0014",
    updatedAtISO: "2026-08-11T18:00:00.000Z",
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
      menuItemQuantities: { salad: 2, chicken: 3 }
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

function objects(quote = quoteFixture(), catalog = catalogFixture()) {
  return buildAmbientPackageMenuObjects(quote, {
    role: "admin",
    ordinaryEditAllowed: true,
    catalogEvidence: catalog
  });
}

function normalized(kind, { quote = quoteFixture(), catalog = catalogFixture(), interaction = "pointer" } = {}) {
  const model = objects(quote, catalog);
  const draftIntent = kind === "replace_package"
    ? createAmbientPackageReplacementIntent(model.package, "premium")
    : kind === "replace_menu_item"
      ? createAmbientMenuReplacementIntent(model.menu, {
          selectedItemId: "chicken",
          replacementItemId: "salmon"
        })
      : createAmbientMenuReorderIntent(model.menu, {
          itemId: "salad",
          toIndex: 1,
          interaction
        });
  return {
    catalogContext: model.catalogEvidence,
    intent: normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent,
      catalogContext: model.catalogEvidence,
      enabled: true
    })
  };
}

function formFixture() {
  return {
    pkg: "classic",
    menuItems: ["salad", "chicken"],
    menuItemQuantities: { salad: 2, chicken: 3 },
    preserved: { note: "keep me" }
  };
}

function clone(value) {
  return structuredClone(value);
}

describe("Ambient Package/Menu draft adoption", () => {
  test("exports a stable model id", () => {
    expect(AMBIENT_PACKAGE_MENU_DRAFT_ADOPTION_MODEL).toBe(
      "ambient-package-menu-draft-adoption-v1"
    );
  });

  test("adopts an exact package candidate without inventing package inclusions", () => {
    const { intent, catalogContext } = normalized("replace_package");
    const form = {
      ...formFixture(),
      packageInclusions: { preserved: true }
    };
    const before = clone(form);
    const result = adoptAmbientPackageMenuDraftChange({
      ambientDraftIntent: intent,
      form,
      catalogContext
    });

    expect(result).toMatchObject({
      ok: true,
      form: {
        pkg: "premium",
        packageInclusions: { preserved: true },
        preserved: { note: "keep me" }
      },
      dirtyFields: ["pkg"],
      acknowledgement: {
        kind: "preview",
        state: "draft_updated",
        actionId: "replace-package-in-draft",
        reconciliationRequired: ["selection.packageInclusions"],
        inclusionReconciliationRequired: true,
        saveRequired: true
      }
    });
    expect(form).toEqual(before);
    expect(result.form.packageInclusions).toEqual(before.packageInclusions);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.form.preserved)).toBe(true);
    expect(Object.isFrozen(result.acknowledgement.reconciliationRequired)).toBe(true);
  });

  test("accepts the hydration wrapper shape without an ok field", () => {
    const { intent, catalogContext } = normalized("replace_package");
    const { ok: _ok, ...hydratedIntent } = intent;

    expect(adoptAmbientPackageMenuDraftChange({
      ambientDraftIntent: hydratedIntent,
      form: formFixture(),
      catalogContext
    })).toMatchObject({ ok: true, form: { pkg: "premium" } });
  });

  test("replaces one exact menu item, preserves its position and quantity, and moves the quantity key", () => {
    const { intent, catalogContext } = normalized("replace_menu_item");
    const form = formFixture();
    const before = clone(form);
    const result = adoptAmbientPackageMenuDraftChange({
      ambientDraftIntent: intent,
      form,
      catalogContext
    });

    expect(result).toMatchObject({
      ok: true,
      form: {
        menuItems: ["salad", "salmon"],
        menuItemQuantities: { salad: 2, salmon: 3 }
      },
      dirtyFields: ["menuItems", "menuItemQuantities"],
      acknowledgement: {
        actionId: "replace-menu-item-in-draft",
        reconciliationRequired: [
          "selection.menuItemsSnapshot",
          "selection.menuItemNames",
          "selection.packageInclusions"
        ],
        inclusionReconciliationRequired: true
      }
    });
    expect(result.form.menuItemQuantities).not.toHaveProperty("chicken");
    expect(form).toEqual(before);
  });

  test.each(["pointer", "keyboard"])(
    "adopts the exact %s reorder while leaving quantities byte-for-byte equivalent",
    (interaction) => {
      const { intent, catalogContext } = normalized("reorder_menu", { interaction });
      const form = formFixture();
      const beforeQuantities = clone(form.menuItemQuantities);
      const result = adoptAmbientPackageMenuDraftChange({
        ambientDraftIntent: intent,
        form,
        catalogContext
      });

      expect(result).toMatchObject({
        ok: true,
        form: { menuItems: ["chicken", "salad"] },
        dirtyFields: ["menuItems"],
        acknowledgement: {
          actionId: "reorder-menu-in-draft",
          inclusionReconciliationRequired: false
        }
      });
      expect(result.form.menuItemQuantities).toEqual(beforeQuantities);
    }
  );

  test.each([
    ["family", (intent) => { intent.family = "event_logistics"; }],
    ["state", (intent) => { intent.draftChange.state = "resolved"; }],
    ["authority", (intent) => { intent.draftChange.authority = "trusted_mutation"; }],
    ["commit", (intent) => { intent.draftChange.commit = true; }],
    ["extra field", (intent) => { intent.draftChange.ambiguous = true; }]
  ])("rejects a normalized handoff with invalid %s", (_label, mutate) => {
    const { intent, catalogContext } = normalized("replace_package");
    const changed = clone(intent);
    mutate(changed);
    const form = formFixture();
    const result = adoptAmbientPackageMenuDraftChange({
      ambientDraftIntent: changed,
      form,
      catalogContext
    });

    expect(result).toMatchObject({
      ok: false,
      form,
      dirtyFields: [],
      acknowledgement: {
        kind: "recovery",
        code: "ambient_package_menu_adoption_intent_invalid"
      }
    });
  });

  test.each([
    ["stale", (context) => {
      context.state = "stale";
      context.freshness.state = "stale";
    }],
    ["organization", (context) => { context.organizationId = "org-b"; }],
    ["revision", (context) => { context.catalogRevision += 1; }],
    ["source", (context) => { context.sourceLabel = "Another source"; }],
    ["observation", (context) => {
      context.freshness.observedAt = "2026-08-11T18:02:00.000Z";
    }]
  ])("rejects %s catalog-context drift", (_label, mutate) => {
    const { intent, catalogContext } = normalized("replace_package");
    const changed = clone(catalogContext);
    mutate(changed);

    expect(adoptAmbientPackageMenuDraftChange({
      ambientDraftIntent: intent,
      form: formFixture(),
      catalogContext: changed
    })).toMatchObject({
      ok: false,
      acknowledgement: { code: "ambient_package_menu_adoption_intent_invalid" }
    });
  });

  test("rejects an inactive, renamed, missing, or duplicated exact package candidate", () => {
    const { intent, catalogContext } = normalized("replace_package");
    const mutations = [
      (context) => { context.packages[1].catalogActive = false; },
      (context) => { context.packages[1].name = "Renamed"; },
      (context) => { context.packages = context.packages.slice(0, 1); },
      (context) => { context.packages.push(clone(context.packages[1])); }
    ];

    for (const mutate of mutations) {
      const context = clone(catalogContext);
      mutate(context);
      const result = adoptAmbientPackageMenuDraftChange({
        ambientDraftIntent: intent,
        form: formFixture(),
        catalogContext: context
      });
      expect(result.ok).toBe(false);
      expect(result.form.pkg).toBe("classic");
    }
  });

  test.each([
    ["missing candidate", (intent) => { intent.draftChange.candidate = null; }],
    ["missing proposed order", (intent) => { intent.draftChange.proposed.order = null; }]
  ])("fails closed without throwing for malformed nested %s evidence", (_label, mutate) => {
    const kind = _label === "missing candidate" ? "replace_package" : "reorder_menu";
    const { intent, catalogContext } = normalized(kind);
    const changed = clone(intent);
    mutate(changed);

    expect(() => adoptAmbientPackageMenuDraftChange({
      ambientDraftIntent: changed,
      form: formFixture(),
      catalogContext
    })).not.toThrow();
    expect(adoptAmbientPackageMenuDraftChange({
      ambientDraftIntent: changed,
      form: formFixture(),
      catalogContext
    })).toMatchObject({
      ok: false,
      acknowledgement: { code: "ambient_package_menu_adoption_drift" }
    });
  });

  test.each([
    ["package selection", "replace_package", (form) => { form.pkg = "another"; }],
    ["menu order", "replace_menu_item", (form) => { form.menuItems.reverse(); }],
    ["menu quantity", "replace_menu_item", (form) => { form.menuItemQuantities.chicken = 4; }],
    ["stale quantity key", "replace_menu_item", (form) => { form.menuItemQuantities.old = 1; }],
    ["reorder base", "reorder_menu", (form) => { form.menuItems.reverse(); }]
  ])("fails closed on current editor %s drift", (_label, kind, mutate) => {
    const { intent, catalogContext } = normalized(kind);
    const form = formFixture();
    mutate(form);
    const before = clone(form);
    const result = adoptAmbientPackageMenuDraftChange({
      ambientDraftIntent: intent,
      form,
      catalogContext
    });

    expect(result).toMatchObject({
      ok: false,
      form: before,
      dirtyFields: [],
      acknowledgement: {
        code: "ambient_package_menu_adoption_drift",
        consequence: expect.stringContaining("not changed")
      }
    });
    expect(form).toEqual(before);
  });

  test("rejects a replacement candidate already present in the current menu", () => {
    const { intent, catalogContext } = normalized("replace_menu_item");
    const form = formFixture();
    form.menuItems = ["salmon", "chicken"];
    form.menuItemQuantities = { salmon: 2, chicken: 3 };

    expect(adoptAmbientPackageMenuDraftChange({
      ambientDraftIntent: intent,
      form,
      catalogContext
    })).toMatchObject({ ok: false, dirtyFields: [] });
  });

  test("rejects a tampered multi-item reorder instead of treating it as direct manipulation", () => {
    const quote = quoteFixture();
    quote.selection.menuItems = ["salad", "chicken", "salmon"];
    quote.selection.menuItemsSnapshot.push({
      id: "salmon",
      name: "Salmon",
      quantity: 1,
      includedInPackage: false
    });
    quote.selection.menuItemQuantities.salmon = 1;
    const model = objects(quote);
    const raw = createAmbientMenuReorderIntent(model.menu, {
      itemId: "salad",
      toIndex: 2,
      interaction: "pointer"
    });
    const intent = normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent: raw,
      catalogContext: model.catalogEvidence,
      enabled: true
    });
    const changed = clone(intent);
    changed.draftChange.proposed.order = ["chicken", "salmon", "salad"];
    const form = {
      ...formFixture(),
      menuItems: ["salad", "chicken", "salmon"],
      menuItemQuantities: { salad: 2, chicken: 3, salmon: 1 }
    };

    // The order above is still a valid single move. A true multi-move/tamper
    // for three elements reverses the untouched pair as well.
    changed.draftChange.proposed.order = ["salmon", "chicken", "salad"];
    expect(adoptAmbientPackageMenuDraftChange({
      ambientDraftIntent: changed,
      form,
      catalogContext: model.catalogEvidence
    })).toMatchObject({
      ok: false,
      acknowledgement: { code: "ambient_package_menu_adoption_drift" }
    });
  });

  test("returns immutable recovery without throwing for missing, cyclic, or unsupported form state", () => {
    const { intent, catalogContext } = normalized("replace_package");
    const cyclic = formFixture();
    cyclic.self = cyclic;
    for (const form of [null, cyclic, { ...formFixture(), unsupported: new Date() }]) {
      expect(() => adoptAmbientPackageMenuDraftChange({
        ambientDraftIntent: intent,
        form,
        catalogContext
      })).not.toThrow();
      const result = adoptAmbientPackageMenuDraftChange({
        ambientDraftIntent: intent,
        form,
        catalogContext
      });
      expect(result).toMatchObject({
        ok: false,
        form: null,
        dirtyFields: [],
        acknowledgement: { code: "ambient_package_menu_adoption_form_invalid" }
      });
      expect(Object.isFrozen(result)).toBe(true);
    }
  });
});
