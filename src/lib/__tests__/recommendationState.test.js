import { describe, expect, test } from "vitest";
import { recommendationWouldChangeForm } from "../recommendationState";

describe("recommendation dirty-state detection", () => {
  test("detects package, add-on, rental, quantity, and template ownership mutations", () => {
    const custom = {
      eventTemplateId: "custom",
      pkg: "classic",
      addons: ["dessert"],
      addonQuantities: { dessert: 1 },
      rentals: ["linens"],
      rentalQuantities: { linens: 2 }
    };

    expect(recommendationWouldChangeForm(custom, { kind: "package", id: "classic" })).toBe(false);
    expect(recommendationWouldChangeForm(custom, { kind: "package", id: "premium" })).toBe(true);
    expect(recommendationWouldChangeForm(custom, { kind: "addon", id: "dessert" })).toBe(false);
    expect(recommendationWouldChangeForm(custom, { kind: "addon", id: "coffee" })).toBe(true);
    expect(recommendationWouldChangeForm(custom, { kind: "rental", id: "linens" })).toBe(false);
    expect(recommendationWouldChangeForm(custom, { kind: "rental", id: "chairs" })).toBe(true);
    expect(recommendationWouldChangeForm({ ...custom, addonQuantities: { dessert: 0 } }, {
      kind: "addon",
      id: "dessert"
    })).toBe(true);
    expect(recommendationWouldChangeForm({ ...custom, eventTemplateId: "wedding" }, {
      kind: "package",
      id: "classic"
    })).toBe(true);
  });

  test("ignores malformed and unknown recommendations", () => {
    expect(recommendationWouldChangeForm({}, null)).toBe(false);
    expect(recommendationWouldChangeForm({}, { kind: "addon", id: "" })).toBe(false);
    expect(recommendationWouldChangeForm({}, { kind: "other", id: "item" })).toBe(false);
  });
});
