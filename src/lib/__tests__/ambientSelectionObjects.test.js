import { describe, expect, test } from "vitest";
import {
  AMBIENT_SELECTION_GESTURE_SEMANTICS,
  AMBIENT_SELECTION_OBJECTS_MODEL,
  applyAmbientSelectionScenarioStep,
  buildAmbientSelectionObjects,
  selectionScenarioQuantity
} from "../ambientSelectionObjects";

const QUOTE = Object.freeze({
  id: "quote-selection",
  organizationId: "org-selection",
  activeVersionId: "version-7",
  event: Object.freeze({ guests: 120, hours: 6, style: "Plated" }),
  selection: Object.freeze({
    packageId: "classic",
    packageInclusions: Object.freeze({
      addons: Object.freeze([{ id: "tea", name: "Tea Service" }]),
      rentals: Object.freeze([{ id: "linens", name: "Table Linens" }])
    }),
    addons: Object.freeze(["dessert", "premium-bar", "tea"]),
    rentals: Object.freeze(["linens"]),
    addonQuantities: Object.freeze({ dessert: 2, "premium-bar": 2, tea: 120 }),
    rentalQuantities: Object.freeze({ linens: 15 }),
    addonSnapshots: Object.freeze([
      Object.freeze({ id: "dessert", name: "Dessert Upgrade", pricingType: "per_item", quantity: 2, price: 140 }),
      Object.freeze({ id: "premium-bar", name: "Premium Bar", pricingType: "per_event", quantity: 2, price: 475 }),
      Object.freeze({ id: "tea", name: "Tea Service", pricingType: "per_person", quantity: 120, price: 3 })
    ]),
    rentalSnapshots: Object.freeze([
      Object.freeze({ id: "linens", name: "Table Linens", pricingType: "per_item", quantity: 15, price: 12 })
    ])
  })
});

const CATALOG_EVIDENCE = Object.freeze({
  organizationId: "org-selection",
  sourceLabel: "firebase-org",
  catalogRevision: 14,
  freshness: Object.freeze({
    state: "fresh",
    observedAtISO: "2026-08-12T03:00:00.000Z",
    reason: ""
  }),
  addons: Object.freeze([
    Object.freeze({ id: "dessert", name: "Dessert Upgrade", pricingType: "per_item", price: 140, active: true }),
    Object.freeze({ id: "premium-bar", name: "Premium Bar", pricingType: "per_event", price: 475, active: true, staffRole: "bartender" }),
    Object.freeze({ id: "tea", name: "Tea Service", pricingType: "per_person", price: 3, active: true, staffRole: "server" })
  ]),
  rentals: Object.freeze([
    Object.freeze({ id: "linens", name: "Table Linens", pricingType: "per_item", price: 12, active: true, qtyPerGuests: 8 })
  ]),
  upsellRules: Object.freeze([
    Object.freeze({
      id: "bar-for-evening-events",
      name: "Evening bar review",
      kind: "addon",
      targetId: "premium-bar",
      enabled: true,
      minGuests: 100,
      minHours: 5,
      reason: "Events above 100 guests and five hours qualify for a tenant-recorded bar review."
    })
  ])
});

function build(options = {}) {
  return buildAmbientSelectionObjects(QUOTE, {
    source: "saved-local-quote",
    role: "sales",
    ordinaryEditAllowed: true,
    catalogEvidence: CATALOG_EVIDENCE,
    ...options
  });
}

describe("Ambient selection intelligent objects", () => {
  test("turns canonical add-on and rental rails into four evidence-bounded intelligent groups", () => {
    const model = build();

    expect(model.modelId).toBe(AMBIENT_SELECTION_OBJECTS_MODEL);
    expect(model.quoteIdentity).toEqual({
      quoteId: "quote-selection",
      organizationId: "org-selection",
      revisionId: "version-7"
    });
    expect(model.groups.map((group) => group.kind)).toEqual([
      "addon",
      "rental",
      "bar",
      "service"
    ]);
    expect(model.objects.map((item) => [item.label, item.kind, item.current.quantity])).toEqual([
      ["Dessert Upgrade", "addon", 2],
      ["Premium Bar", "bar", 2],
      ["Tea Service", "service", 120],
      ["Table Linens", "rental", 15]
    ]);
    expect(model.summary).toBe("4 saved selections across 4 groups.");
    expect(model.stageableCount).toBe(4);
    expect(model.permissions).toMatchObject({
      view: true,
      simulate: true,
      stage: true,
      commit: false
    });
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.objects[0].descriptor.dependencies)).toBe(true);
  });

  test("exposes dependencies, why, consequence, do-nothing, confidence, and provenance without claiming authority", () => {
    const model = build();
    const bar = model.objects.find((item) => item.kind === "bar");
    const service = model.objects.find((item) => item.kind === "service");
    const rental = model.objects.find((item) => item.kind === "rental");

    expect(bar.classification).toMatchObject({
      method: "recorded_staff_role",
      confidence: "high"
    });
    expect(bar.recommendationEvidence).toMatchObject({
      confidence: "high",
      provenanceLabel: expect.stringContaining("tenant catalog revision 14")
    });
    expect(bar.descriptor.why).toContain("does not prove necessity, availability, or price authority");
    expect(bar.descriptor.consequence).toContain("No saved value changes");
    expect(bar.descriptor.doNothing).toContain("No reprice, reservation, assignment, customer communication, or save occurs");
    expect(bar.descriptor.dependencies.map((item) => item.object.id)).toEqual([
      "pricing",
      "package",
      "guest-count",
      "staffing"
    ]);
    expect(service.descriptor.dependencies.map((item) => item.object.id)).toContain("service-style");
    expect(rental.current).toMatchObject({
      pricingType: "per_item",
      priceLabel: "$12.00 per item",
      includedInPackage: true,
      packageId: "classic"
    });
    expect(bar.descriptor.permissions.commit).toBe(false);
  });

  test("stages only bounded local quantity changes and returns exact recovery at limits", () => {
    const model = build();
    const rental = model.objects.find((item) => item.kind === "rental");
    const service = model.objects.find((item) => item.kind === "service");

    expect(AMBIENT_SELECTION_GESTURE_SEMANTICS).toMatchObject({
      minimumDistancePx: 48,
      visibleButtonAlternativeRequired: true,
      keyboardButtonAlternativeRequired: true
    });
    expect(selectionScenarioQuantity(rental, {})).toBe(15);
    expect(selectionScenarioQuantity(rental, { [rental.id]: 16 })).toBe(16);
    expect(applyAmbientSelectionScenarioStep(rental, 15, "increase")).toMatchObject({
      ok: true,
      quantity: 16,
      changedFromSaved: true,
      reason: "Table Linens is set to quantity 16 in the unsaved preview.",
      nextResolution: "Review what this affects, undo this change, or keep adjusting the preview."
    });
    expect(applyAmbientSelectionScenarioStep(rental, 0, "reduce")).toMatchObject({
      ok: false,
      quantity: 0,
      reason: expect.stringContaining("already removed")
    });
    expect(service.adjustment.quantityMutable).toBe(false);
    expect(applyAmbientSelectionScenarioStep(service, 120, "reduce")).toMatchObject({
      ok: true,
      quantity: 0,
      selected: false,
      reason: "Tea Service is removed from the unsaved preview."
    });
    expect(applyAmbientSelectionScenarioStep(service, 0, "increase")).toMatchObject({
      ok: true,
      quantity: 120,
      changedFromSaved: false
    });
    expect(QUOTE.selection.rentalQuantities.linens).toBe(15);
  });

  test("keeps saved evidence visible but fails staging closed for stale or mismatched catalog evidence", () => {
    const stale = build({
      catalogEvidence: {
        ...CATALOG_EVIDENCE,
        freshness: {
          state: "stale",
          observedAtISO: "2026-08-12T03:00:00.000Z",
          reason: "Catalog refresh failed."
        }
      }
    });
    const mismatched = build({
      catalogEvidence: { ...CATALOG_EVIDENCE, organizationId: "other-org" }
    });

    expect(stale.populated).toBe(true);
    expect(stale.objects).toHaveLength(4);
    expect(stale.stageableCount).toBe(0);
    expect(stale.objects.every((item) => item.adjustment.enabled === false)).toBe(true);
    expect(stale.objects.every((item) => item.descriptor.confidence.level === "low")).toBe(true);
    expect(mismatched.catalogContext.state).toBe("unknown");
    expect(mismatched.stageableCount).toBe(0);
    expect(mismatched.permissions.reason).toContain("does not match");
  });

  test.each(["non_staff", "customer", "manager", ""]) (
    "does not expose selection details to the %s role",
    (role) => {
      const model = build({ role });
      expect(model.objects).toEqual([]);
      expect(model.groups).toEqual([]);
      expect(model.populated).toBe(false);
      expect(model.permissions).toMatchObject({
        view: false,
        simulate: false,
        stage: false,
        commit: false
      });
      expect(model.permissions.reason).toContain("restricted to staff roles");
    }
  );
});
