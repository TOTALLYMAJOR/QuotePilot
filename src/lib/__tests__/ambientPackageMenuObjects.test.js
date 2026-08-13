import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createIntelligentObjectDescriptor } from "../ambientContracts";
import {
  AMBIENT_MENU_REORDER_INTERACTION_SEMANTICS,
  AMBIENT_PACKAGE_MENU_BOUNDS,
  AMBIENT_PACKAGE_MENU_MODEL,
  buildAmbientPackageMenuObject,
  buildAmbientPackageMenuObjects,
  createAmbientMenuReorderIntent,
  createAmbientMenuReplacementIntent,
  createAmbientPackageReplacementIntent
} from "../ambientPackageMenuObjects";

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
      menuItemNames: ["Garden salad", "Herb chicken"],
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
        includedMenuItemIds: ["salad", "chicken"],
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
      },
      {
        id: "retired-package",
        name: "Retired package",
        active: false,
        includedMenuItemIds: [],
        includedAddonIds: [],
        includedRentalIds: []
      }
    ],
    menuSections: [{
      id: "entrees",
      name: "Entrees",
      items: [
        { id: "salad", name: "Garden salad", active: true },
        { id: "chicken", name: "Herb chicken", active: true },
        { id: "salmon", name: "Salmon", active: true },
        { id: "retired-item", name: "Retired item", active: false }
      ]
    }]
  };
}

function build(options = {}) {
  return buildAmbientPackageMenuObjects(options.quote || quoteFixture(), {
    role: "admin",
    ordinaryEditAllowed: true,
    catalogEvidence: options.catalog || catalogFixture(),
    ...options.runtime
  });
}

function descriptorShape(object) {
  return {
    id: object.id,
    type: object.type,
    label: object.label,
    summary: object.summary,
    inspectorSurfaceId: object.inspectorSurfaceId,
    dependencies: object.dependencies,
    why: object.why,
    consequence: object.consequence,
    doNothing: object.doNothing,
    confidence: object.confidence,
    provenance: object.provenance,
    recommendation: object.recommendation,
    permissions: object.permissions,
    actionIds: object.actionIds
  };
}

describe("ambient package and menu intelligent objects", () => {
  test("builds contract-valid frozen objects from saved selection and explicit catalog evidence", () => {
    const result = build();

    expect(result.modelId).toBe(AMBIENT_PACKAGE_MENU_MODEL);
    expect(result.quoteIdentity).toEqual({
      quoteId: "quote-a",
      organizationId: "org-a",
      revisionId: "v0014",
      observedAt: "2026-08-11T18:00:00.000Z"
    });
    expect(result.catalogEvidence).toMatchObject({
      state: "current",
      organizationId: "org-a",
      catalogRevision: 12
    });
    expect(result.package.savedSelection).toMatchObject({
      state: "available",
      packageId: "classic",
      packageName: "Classic",
      catalogMatch: { state: "matched_current" }
    });
    expect(result.menu.order).toEqual(["salad", "chicken"]);
    expect(result.menu.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      orderIndex: item.orderIndex,
      includedInPackage: item.includedInPackage
    }))).toEqual([
      { id: "salad", quantity: 2, orderIndex: 0, includedInPackage: true },
      { id: "chicken", quantity: 3, orderIndex: 1, includedInPackage: false }
    ]);
    expect(result.package.dependencies).toHaveLength(3);
    expect(result.menu.dependencies).toHaveLength(3);
    expect(result.package.why).toContain("saved quote");
    expect(result.package.consequence).toContain("only prepares a draft change");
    expect(result.package.doNothing).toContain("remains the saved package");
    expect(result.menu.confidence.level).toBe("high");
    expect(result.menu.provenance.map((entry) => entry.type)).toContain("tenant-catalog-evidence");
    expect(createIntelligentObjectDescriptor(descriptorShape(result.package))).toEqual(descriptorShape(result.package));
    expect(createIntelligentObjectDescriptor(descriptorShape(result.menu))).toEqual(descriptorShape(result.menu));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.menu.items[0].currentCatalogRecord.section)).toBe(true);
  });

  test("never reconstructs a saved package inclusion from today's catalog", () => {
    const result = build();

    expect(result.package.currentCatalogRecord.declaredInclusionIds.menuItems).toEqual(["salad", "chicken"]);
    expect(result.package.recordedInclusions.menuItems.map((item) => item.id)).toEqual(["salad"]);
    expect(result.package.recordedInclusions.menuItems).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "chicken" })])
    );
  });

  test("keeps saved names when the current catalog name changes", () => {
    const catalog = catalogFixture();
    catalog.packages[0].name = "Classic 2027";
    catalog.menuSections[0].items[0].name = "Seasonal garden salad";
    const result = build({ catalog });

    expect(result.package.savedSelection.packageName).toBe("Classic");
    expect(result.package.currentCatalogRecord.name).toBe("Classic 2027");
    expect(result.package.savedSelection.catalogMatch.state).toBe("name_changed");
    expect(result.menu.items[0].savedName).toBe("Garden salad");
    expect(result.menu.items[0].currentCatalogRecord.name).toBe("Seasonal garden salad");
    expect(result.menu.items[0].catalogMatch.state).toBe("name_changed");
    expect(result.menu.confidence.level).toBe("medium");
  });

  test("does not match missing catalog records by name", () => {
    const catalog = catalogFixture();
    catalog.packages[0] = { ...catalog.packages[0], id: "different-classic" };
    catalog.menuSections[0].items[0] = {
      ...catalog.menuSections[0].items[0],
      id: "different-salad"
    };
    const result = build({ catalog });

    expect(result.package.savedSelection.catalogMatch).toMatchObject({ state: "missing", record: null });
    expect(result.menu.items[0]).toMatchObject({
      id: "salad",
      catalogMatch: { state: "missing" },
      currentCatalogRecord: null
    });
    expect(result.menu.intentContracts.reorder.enabled).toBe(false);
  });

  test("keeps legacy inclusion names partial and never identity-matches them", () => {
    const quote = quoteFixture();
    quote.selection.packageInclusions.menuItems = ["Garden salad"];
    const result = build({ quote });

    expect(result.package.recordedInclusions.state).toBe("partial");
    expect(result.package.recordedInclusions.menuItems[0]).toMatchObject({
      id: null,
      name: "Garden salad",
      state: "partial"
    });
    expect(result.package.recordedInclusions.menuItems[0].reason).toContain("No catalog match is inferred");
  });

  test("surfaces conflicting saved inclusion evidence without choosing a winner", () => {
    const quote = quoteFixture();
    quote.selection.packageInclusions.menuItems.push({ id: "chicken", name: "Herb chicken" });
    const result = build({ quote });

    expect(result.menu.items[1]).toMatchObject({
      id: "chicken",
      includedInPackage: null,
      packageInclusionEvidence: "conflicting_saved_evidence"
    });
    expect(result.menu.items[1].packageInclusionReason).toContain("No precedence is inferred");
    expect(result.menu.savedSelection.state).toBe("partial");
    expect(result.menu.intentContracts.reorder.enabled).toBe(false);
  });

  test("does not invent a missing selected quantity", () => {
    const quote = quoteFixture();
    delete quote.selection.menuItemQuantities.chicken;
    quote.selection.menuItemsSnapshot[1] = {
      id: "chicken",
      name: "Herb chicken",
      includedInPackage: false
    };
    const result = build({ quote });

    expect(result.menu.items[1].quantity).toBeNull();
    expect(result.menu.items[1].quantityState).toBe("missing");
    expect(result.menu.savedSelection.state).toBe("partial");
    expect(result.menu.intentContracts.replace.enabled).toBe(false);
    expect(result.menu.intentContracts.replace.reason).toContain("explicit saved quantity");
  });

  test.each([
    ["stale", "The operator catalog may have changed."],
    ["unknown", "No observation timestamp is available."]
  ])("keeps %s catalog evidence inspectable but disables draft intents", (state, reason) => {
    const catalog = catalogFixture();
    catalog.freshness = state === "stale"
      ? { state, observedAtISO: "2026-08-10T18:01:00.000Z", reason }
      : { state, reason };
    const result = build({ catalog });

    expect(result.catalogEvidence.state).toBe(state);
    expect(result.package.currentCatalogRecord.id).toBe("classic");
    expect(result.package.intentContract.enabled).toBe(false);
    expect(result.menu.intentContracts.replace.enabled).toBe(false);
    expect(result.menu.intentContracts.reorder.enabled).toBe(false);
  });

  test("rejects cross-tenant and malformed catalog evidence as a whole", () => {
    const wrongTenant = catalogFixture();
    wrongTenant.organizationId = "org-b";
    const duplicate = catalogFixture();
    duplicate.packages.push({ ...duplicate.packages[0] });

    for (const catalog of [wrongTenant, duplicate]) {
      const result = build({ catalog });
      expect(result.catalogEvidence.state).toBe("unavailable");
      expect(result.catalogEvidence.packages).toEqual([]);
      expect(result.catalogEvidence.menuItems).toEqual([]);
      expect(result.package.replacementCandidates.items).toEqual([]);
      expect(result.menu.replacementCandidates.items).toEqual([]);
      expect(result.package.permissions.stage).toBe(false);
      expect(result.menu.permissions.stage).toBe(false);
    }
  });

  test("rejects over-bound catalog evidence instead of truncating source evidence", () => {
    const catalog = catalogFixture();
    catalog.packages = Array.from(
      { length: AMBIENT_PACKAGE_MENU_BOUNDS.packages + 1 },
      (_, index) => ({
        id: `package-${index}`,
        name: `Package ${index}`,
        active: true,
        includedMenuItemIds: [],
        includedAddonIds: [],
        includedRentalIds: []
      })
    );
    const result = build({ catalog });

    expect(result.catalogEvidence).toMatchObject({ state: "unavailable", packages: [], menuItems: [] });
    expect(result.catalogEvidence.reason).toContain("exceeds its bound");
  });

  test("bounds valid replacement candidates and exposes truncation", () => {
    const catalog = catalogFixture();
    catalog.packages = [catalog.packages[0], ...Array.from(
      { length: AMBIENT_PACKAGE_MENU_BOUNDS.packageReplacementCandidates + 3 },
      (_, index) => ({
        id: `replacement-${index}`,
        name: `Replacement ${index}`,
        active: true,
        includedMenuItemIds: [],
        includedAddonIds: [],
        includedRentalIds: []
      })
    )];
    catalog.menuSections[0].items.push(...Array.from(
      { length: AMBIENT_PACKAGE_MENU_BOUNDS.menuReplacementCandidates + 2 },
      (_, index) => ({ id: `candidate-${index}`, name: `Candidate ${index}`, active: true })
    ));
    const result = build({ catalog });

    expect(result.package.replacementCandidates).toMatchObject({
      total: AMBIENT_PACKAGE_MENU_BOUNDS.packageReplacementCandidates + 3,
      returned: AMBIENT_PACKAGE_MENU_BOUNDS.packageReplacementCandidates,
      truncated: true
    });
    expect(result.menu.replacementCandidates).toMatchObject({
      returned: AMBIENT_PACKAGE_MENU_BOUNDS.menuReplacementCandidates,
      truncated: true
    });
    expect(result.package.intentContract.candidateIds).toHaveLength(
      AMBIENT_PACKAGE_MENU_BOUNDS.packageReplacementCandidates
    );
  });

  test("withholds staff evidence and all draft intents from non-staff roles", () => {
    const result = build({ runtime: { role: "client", ordinaryEditAllowed: true } });

    expect(result.package.savedSelection).toMatchObject({ state: "unavailable", packageId: "" });
    expect(result.menu.items).toEqual([]);
    expect(result.package.permissions).toMatchObject({ view: false, stage: false, commit: false });
    expect(result.menu.permissions).toMatchObject({ view: false, stage: false, commit: false });
    expect(result.package.replacementCandidates.items).toEqual([]);
    expect(result.menu.replacementCandidates.items).toEqual([]);
  });

  test("keeps ordinary view-only staff inspection separate from draft authority", () => {
    const result = build({ runtime: { role: "sales", ordinaryEditAllowed: false } });

    expect(result.package.permissions).toMatchObject({ view: true, stage: false, commit: false });
    expect(result.menu.permissions).toMatchObject({ view: true, stage: false, commit: false });
    expect(result.package.intentContract.reason).toContain("view-only");
  });

  test("requires an exact saved revision before offering any draft intent", () => {
    const quote = quoteFixture();
    delete quote.activeVersionId;
    const result = build({ quote });

    expect(result.package.intentContract.enabled).toBe(false);
    expect(result.menu.intentContracts.replace.enabled).toBe(false);
    expect(result.menu.intentContracts.reorder.enabled).toBe(false);
    expect(result.package.intentContract.reason).toContain("exact saved quote revision");
  });

  test("creates a frozen draft-only package replacement intent without mutation", () => {
    const quote = quoteFixture();
    const before = structuredClone(quote);
    const result = build({ quote });
    const intent = createAmbientPackageReplacementIntent(result.package, "premium");

    expect(intent).toMatchObject({
      ok: true,
      kind: "replace_package",
      authority: "draft_only",
      commit: false,
      baseContext: {
        quoteId: "quote-a",
        organizationId: "org-a",
        baseRevisionId: "v0014",
        catalogRevision: 12
      },
      before: { packageId: "classic" },
      proposed: { packageId: "premium", packageName: "Premium" },
      candidate: { operationalAvailability: "not_evaluated" },
      consequencePreviewRequired: true,
      requiresOutcomeNamedSave: true
    });
    expect(intent.target).toEqual({
      objectId: "package",
      fieldPaths: ["selection.packageId", "selection.packageName"],
      trustedReconciliationRequired: ["selection.packageInclusions"]
    });
    expect(Object.isFrozen(intent.baseContext)).toBe(true);
    expect(quote).toEqual(before);
    expect(createAmbientPackageReplacementIntent(result.package, "retired-package")).toMatchObject({
      ok: false,
      code: "candidate_unavailable"
    });
  });

  test("creates a bounded menu replacement intent that preserves explicit quantity and order", () => {
    const quote = quoteFixture();
    const before = structuredClone(quote);
    const result = build({ quote });
    const intent = createAmbientMenuReplacementIntent(result.menu, {
      selectedItemId: "chicken",
      replacementItemId: "salmon"
    });

    expect(intent).toMatchObject({
      ok: true,
      kind: "replace_menu_item",
      authority: "draft_only",
      commit: false,
      before: { itemId: "chicken", orderIndex: 1, quantity: 3 },
      proposed: {
        itemId: "salmon",
        orderIndex: 1,
        quantity: 3,
        quantityPolicy: "preserve_explicit_saved_quantity"
      },
      candidate: { id: "salmon", catalogActive: true, operationalAvailability: "not_evaluated" }
    });
    expect(intent.target.trustedReconciliationRequired).toEqual([
      "selection.menuItemsSnapshot",
      "selection.menuItemNames",
      "selection.packageInclusions"
    ]);
    expect(quote).toEqual(before);
    expect(createAmbientMenuReplacementIntent(result.menu, {
      selectedItemId: "chicken",
      replacementItemId: "retired-item"
    })).toMatchObject({ ok: false, code: "selection_or_candidate_unavailable" });
  });

  test("makes pointer and keyboard reorder inputs produce equivalent order intents", () => {
    const result = build();
    const pointer = createAmbientMenuReorderIntent(result.menu, {
      itemId: "salad",
      toIndex: 1,
      interaction: "pointer"
    });
    const keyboard = createAmbientMenuReorderIntent(result.menu, {
      itemId: "salad",
      toIndex: 1,
      interaction: "keyboard"
    });

    expect(pointer.proposedOrder).toEqual(["chicken", "salad"]);
    expect(keyboard.proposedOrder).toEqual(pointer.proposedOrder);
    expect(pointer.beforeOrder).toEqual(["salad", "chicken"]);
    expect(result.menu.order).toEqual(["salad", "chicken"]);
    expect(pointer.interactionSemantics).toBe(AMBIENT_MENU_REORDER_INTERACTION_SEMANTICS);
    expect(pointer.target.trustedReconciliationRequired).toEqual([
      "selection.menuItemsSnapshot",
      "selection.menuItemNames"
    ]);
    expect(keyboard.interactionSemantics.equivalence).toContain("same_order_intent");
    expect(Object.isFrozen(pointer.proposedOrder)).toBe(true);

    for (const invalidInput of [
      { itemId: "salad", toIndex: 0, interaction: "pointer" },
      { itemId: "missing", toIndex: 1, interaction: "pointer" },
      { itemId: "salad", toIndex: 2, interaction: "keyboard" },
      { itemId: "salad", toIndex: 1, interaction: "voice" }
    ]) {
      expect(createAmbientMenuReorderIntent(result.menu, invalidInput)).toMatchObject({
        ok: false,
        code: "reorder_target_invalid"
      });
    }
  });

  test("builds one requested kind and rejects unsupported kinds", () => {
    expect(buildAmbientPackageMenuObject("package", quoteFixture(), {
      role: "admin",
      ordinaryEditAllowed: true,
      catalogEvidence: catalogFixture()
    }).id).toBe("package");
    expect(() => buildAmbientPackageMenuObject("pricing", quoteFixture(), {})).toThrow(
      /Unsupported ambient package\/menu object kind/
    );
  });

  test("stays pure and does not import pricing, authority, persistence, or network clients", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../ambientPackageMenuObjects.js", import.meta.url)),
      "utf8"
    );

    expect(source).toContain('import { createIntelligentObjectDescriptor } from "./ambientContracts";');
    expect(source.match(/^import /g)).toHaveLength(1);
    expect(source).not.toMatch(/firebase|quoteCalculator|quoteStore|fetch\s*\(|XMLHttpRequest|https?:\/\//);
    expect(source).not.toMatch(/unitPrice|commercialDeltas|marginPercent|authoritativePrice/);
  });
});
