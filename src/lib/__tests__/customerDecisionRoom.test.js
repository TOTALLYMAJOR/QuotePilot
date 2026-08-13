import { describe, expect, test } from "vitest";
import {
  decisionRoomOptionSelected,
  decisionRoomOptionSentence,
  discardGeneratedDecisionRoomOptions,
  normalizeDecisionRoomOptions,
  toggleDecisionRoomOption
} from "../customerDecisionRoom";

describe("customer decision room staged options", () => {
  test("keeps only bounded, supported, deduplicated customer-visible facts", () => {
    const options = normalizeDecisionRoomOptions([
      { itemType: "addon", name: " Premium Bar ", price: 15, pricingType: "per_person" },
      { itemType: "addon", name: "Premium Bar", price: 15, pricingType: "per_person" },
      { itemType: "rental", name: "Linens", price: 9, pricingType: "unexpected" },
      { itemType: "service", name: "Unapproved service", price: 30 },
      { itemType: "addon", name: "", price: 30 }
    ]);

    expect(options).toEqual([
      {
        key: "addon:premium bar:per_person:15",
        itemType: "addon",
        name: "Premium Bar",
        price: 15,
        pricingType: "per_person"
      },
      {
        key: "rental:linens:per_item:9",
        itemType: "rental",
        name: "Linens",
        price: 9,
        pricingType: "per_item"
      }
    ]);
    expect(Object.isFrozen(options[0])).toBe(true);
  });

  test("adds and removes only the exact generated request line", () => {
    const option = { name: "Premium Bar." };
    const original = "Please keep the existing dinner service.";
    const added = toggleDecisionRoomOption({ message: original, option });

    expect(decisionRoomOptionSentence(option)).toBe("Please add Premium Bar.");
    expect(added).toEqual({
      message: `${original}\nPlease add Premium Bar.`,
      selected: true,
      outcome: "added"
    });
    expect(decisionRoomOptionSelected(added.message, option)).toBe(true);

    const removed = toggleDecisionRoomOption({
      message: added.message,
      option,
      selected: true
    });
    expect(removed).toEqual({ message: original, selected: false, outcome: "removed" });
    expect(decisionRoomOptionSelected(removed.message, option)).toBe(false);
  });

  test("does not remove edited customer words or exceed the decision-note bound", () => {
    const option = { name: "Premium Bar" };
    const edited = "Please add Premium Bar for cocktail hour only.";
    const alongsideEdited = toggleDecisionRoomOption({ message: edited, option });

    expect(alongsideEdited.message).toBe(`${edited}\nPlease add Premium Bar.`);
    const limited = toggleDecisionRoomOption({
      message: "x".repeat(1195),
      option,
      maxLength: 1200
    });
    expect(limited).toEqual({
      message: "x".repeat(1195),
      selected: false,
      outcome: "limit"
    });
  });

  test("never treats an identical customer-authored sentence as reversible generated text", () => {
    const option = { name: "Premium Bar" };
    const customerWords = "Please add Premium Bar.";

    expect(toggleDecisionRoomOption({ message: customerWords, option })).toEqual({
      message: customerWords,
      selected: false,
      outcome: "already_present"
    });
  });

  test("discards only the exact selected lines generated for optional additions", () => {
    const options = normalizeDecisionRoomOptions([
      { itemType: "addon", name: "Premium Bar", price: 15, pricingType: "per_person" },
      { itemType: "rental", name: "Linens", price: 9, pricingType: "per_item" }
    ]);
    const message = [
      "Please keep the vegetarian option.",
      "Please add Premium Bar.",
      "Please add Linens for the head table only."
    ].join("\n");

    expect(discardGeneratedDecisionRoomOptions({
      message,
      options,
      selectedKeys: [options[0].key, options[1].key]
    })).toEqual({
      message: "Please keep the vegetarian option.\nPlease add Linens for the head table only.",
      removedCount: 1
    });
  });
});
