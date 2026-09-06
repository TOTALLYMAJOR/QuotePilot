import { describe, expect, test } from "vitest";

import {
  IMPORT_TYPES,
  buildImportPreview,
  getImportTypeDefinition,
  parseCsvSource
} from "../importWorkbenchModel";
import { normalizeFieldState } from "../fieldState";

function sourceRow(values, rowNumber = 2) {
  return {
    rowNumber,
    sourceLocator: { kind: "csv", row: rowNumber },
    values
  };
}

describe("Import Workbench CSV inspection", () => {
  test("detects alternate delimiters and preserves duplicate headers as separate review fields", () => {
    const parsed = parseCsvSource([
      "\uFEFFName;Price;price",
      "Roast chicken;24.00;8.00"
    ].join("\r\n"));

    expect(parsed.delimiter).toBe(";");
    expect(parsed.headers).toEqual(["Name", "Price", "price (2)"]);
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 2,
      sourceLocator: { kind: "csv", row: 2 },
      values: {
        Name: "Roast chicken",
        Price: "24.00",
        "price (2)": "8.00"
      }
    });
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "info", code: "alternate_delimiter" }),
      expect.objectContaining({ severity: "warning", code: "duplicate_header", rowNumber: 1 })
    ]));
  });

  test("reports the source row where a quoted value was never closed", () => {
    const parsed = parseCsvSource([
      "Name,Notes",
      "Avery,Ready",
      'Morgan,"Needs review'
    ].join("\n"));

    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "unclosed_quote",
      rowNumber: 3
    }));
  });

  test("blocks overflow values that have no heading instead of discarding them", () => {
    const parsed = parseCsvSource("Name,Email\nMaya,maya@example.test,unassigned\n");
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "unassigned_overflow_values",
      rowNumber: 2
    }));
  });
});

describe("Import Workbench record contracts", () => {
  test("exposes the seven supported import types and keeps customers CSV-only", () => {
    expect(IMPORT_TYPES.map(({ id }) => id)).toEqual([
      "customers",
      "packages",
      "addons",
      "rentals",
      "eventTypes",
      "menuCategories",
      "menuItems"
    ]);
    expect(IMPORT_TYPES.find(({ id }) => id === "customers")?.sourceKinds).toEqual(["csv"]);
    expect(IMPORT_TYPES
      .filter(({ id }) => id !== "customers")
      .every(({ sourceKinds }) => sourceKinds.includes("csv") && sourceKinds.includes("pdf")))
      .toBe(true);
    expect(getImportTypeDefinition("packages").fields).not.toContain("description");
    expect(getImportTypeDefinition("addons").fields).not.toContain("description");
    expect(getImportTypeDefinition("rentals").fields).not.toContain("description");
  });

  test("rejects unknown money, boolean, and pricing values instead of coercing them", () => {
    const [preview] = buildImportPreview({
      importType: "addons",
      mapping: {
        name: "Name",
        price: "Price",
        active: "Active",
        type: "Pricing basis"
      },
      rows: [sourceRow({
        Name: "Chef station",
        Price: "$",
        Active: "sometimes",
        "Pricing basis": "hourly-ish"
      })]
    });

    expect(preview.ready).toBe(false);
    expect(preview.record).toMatchObject({ price: null, active: null, type: null, pricingType: null });
    expect(preview.errors).toEqual(expect.arrayContaining([
      "price must be a zero or positive amount",
      "active must say yes/no, true/false, active/inactive, or 1/0",
      "type must be per person, per item, or per event"
    ]));
    expect(preview.fieldStates.price).toMatchObject({ availability: "unknown", evidence: "failed" });
    expect(preview.fieldStates.active).toMatchObject({ availability: "unknown", evidence: "failed" });
    expect(preview.fieldStates.type).toMatchObject({ availability: "unknown", evidence: "failed" });
  });

  test("labels defaults for omitted boolean and pricing values instead of applying them silently", () => {
    const [preview] = buildImportPreview({
      importType: "addons",
      mapping: { name: "Name", price: "Price", active: "Active", type: "Pricing basis" },
      rows: [sourceRow({ Name: "Late-night station", Price: "425", Active: "", "Pricing basis": "" })]
    });

    expect(preview.ready).toBe(true);
    expect(preview.record).toMatchObject({ active: true, type: "per_event", pricingType: "per_event" });
    expect(preview.fieldStates.active).toMatchObject({ origin: "defaulted", editability: "read_only" });
    expect(preview.fieldStates.type).toMatchObject({ origin: "defaulted", editability: "read_only" });
    expect(preview.fieldStates.active).not.toHaveProperty("availability", "available");
    expect(() => Object.values(preview.fieldStates).forEach(normalizeFieldState)).not.toThrow();
    expect(preview.warnings).toEqual(expect.arrayContaining([
      "Active defaulted to yes",
      "Pricing basis defaulted to per event"
    ]));
  });

  test("resolves menu relationships by name and records confirmed provenance", () => {
    const [preview] = buildImportPreview({
      importType: "menuItems",
      mapping: {
        name: "Name",
        eventType: "Event",
        category: "Section",
        price: "Price",
        pricingType: "Pricing basis"
      },
      rows: [sourceRow({
        Name: "Roast chicken",
        Event: "Wedding",
        Section: "Entrees",
        Price: "24.00",
        "Pricing basis": "per person"
      })],
      catalogContext: {
        eventTypes: [{ id: "evt_wedding", name: "Wedding" }],
        categories: [{ id: "cat_entrees", name: "Entrees", eventTypeId: "evt_wedding" }]
      }
    });

    expect(preview.ready).toBe(true);
    expect(preview.record).toMatchObject({
      eventTypeId: "evt_wedding",
      eventTypeName: "Wedding",
      categoryId: "cat_entrees",
      categoryName: "Entrees"
    });
    expect(preview.fieldStates.eventType.evidence).toBe("confirmed");
    expect(preview.fieldStates.category.evidence).toBe("confirmed");
    expect(preview.warnings).toEqual(expect.arrayContaining([
      "Event type matched by name",
      "Menu section matched by name"
    ]));
  });

  test("blocks ambiguous package relationships rather than selecting the first name match", () => {
    const [preview] = buildImportPreview({
      importType: "packages",
      mapping: {
        name: "Name",
        ppp: "Price per person",
        includedMenuItems: "Included items"
      },
      rows: [sourceRow({
        Name: "Wedding dinner",
        "Price per person": "58",
        "Included items": "Roast chicken"
      })],
      catalogContext: {
        menuItems: [
          { id: "menu_alpha", name: "Roast chicken" },
          { id: "menu_beta", name: "Roast chicken" }
        ]
      }
    });

    expect(preview.ready).toBe(false);
    expect(preview.record.includedMenuItemIds).toEqual([]);
    expect(preview.fieldStates.includedMenuItems.evidence).toBe("failed");
    expect(preview.errors).toContain("Menu item “Roast chicken” matches more than one record");
  });

  test("requires an explicit rental ratio instead of silently pricing one unit per guest", () => {
    const input = {
      importType: "rentals",
      mapping: { name: "Name", price: "Price" },
      rows: [sourceRow({ Name: "Table linen", Price: "12" })]
    };

    const [missingRatio] = buildImportPreview(input);
    expect(missingRatio.ready).toBe(false);
    expect(missingRatio.errors).toContain("qty per guests is required");

    const [explicitRatio] = buildImportPreview({ ...input, constants: { qtyPerGuests: "8" } });
    expect(explicitRatio.ready).toBe(true);
    expect(explicitRatio.record.qtyPerGuests).toBe(8);

    const [zeroRatio] = buildImportPreview({ ...input, constants: { qtyPerGuests: "0" } });
    expect(zeroRatio.ready).toBe(false);
    expect(zeroRatio.errors).toContain("qtyPerGuests must be a whole number from 1 to 100000");

    const [fractionalRatio] = buildImportPreview({ ...input, constants: { qtyPerGuests: "1.5" } });
    expect(fractionalRatio.ready).toBe(false);
    expect(fractionalRatio.errors).toContain("qtyPerGuests must be a whole number from 1 to 100000");
  });

  test("rejects zero package price and amounts above the authoritative limit before preflight", () => {
    const [freePackage] = buildImportPreview({
      importType: "packages",
      mapping: { name: "Name", ppp: "Price" },
      rows: [sourceRow({ Name: "Free package", Price: "0" })]
    });
    expect(freePackage.ready).toBe(false);
    expect(freePackage.errors).toContain("ppp must be greater than zero");

    const [oversizedAddon] = buildImportPreview({
      importType: "addons",
      mapping: { name: "Name", price: "Price" },
      rows: [sourceRow({ Name: "Large fee", Price: "1000000.01" })]
    });
    expect(oversizedAddon.ready).toBe(false);
    expect(oversizedAddon.errors).toContain("price must not exceed 1000000.00");
  });
});
