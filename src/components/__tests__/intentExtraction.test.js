import { describe, expect, test } from "vitest";
import { INTENT_EXTRACTION_MODEL, extractIntentDraft } from "../intentExtraction";

const NOW = new Date("2026-08-10T09:00:00");
const STYLES = ["Buffet", "Plated", "Stations", "Drop-off"];
const EVENT_TYPES = [
  { id: "corporate-dinner", name: "Corporate Dinner" },
  { id: "weddings", name: "Weddings & Celebrations" }
];

function run(text, options = {}) {
  return extractIntentDraft(text, { eventTypes: EVENT_TYPES, styles: STYLES, nowDate: NOW, ...options });
}

describe("extractIntentDraft", () => {
  test("structures the canonical corporate-dinner sentence", () => {
    const result = run(
      "Corporate dinner for about 80 people on September 12, upscale but relaxed, plated, budget around $12k."
    );
    expect(result.modelId).toBe(INTENT_EXTRACTION_MODEL);
    expect(result.draft.guests).toBe(80);
    expect(result.draft.date).toBe("2026-09-12");
    expect(result.draft.style).toBe("Plated");
    expect(result.draft.eventTypeId).toBe("corporate-dinner");

    const guests = result.facts.find((fact) => fact.id === "guests");
    expect(guests.kind).toBe("approximate");
    expect(guests.displayValue).toBe("~80 guests");
    expect(guests.source).toContain("about 80 people");

    const budget = result.notes.find((note) => note.id === "budget");
    expect(budget.amount).toBe(12000);
    expect(budget.text).toContain("$12,000");
    expect(budget.text).toContain("no budget field");
  });

  test("reads a guest range as its midpoint and preserves the band as a note", () => {
    const result = run("Somewhere between 100 to 130 guests for the reception.");
    const guests = result.facts.find((fact) => fact.id === "guests");
    expect(guests.kind).toBe("range");
    expect(guests.min).toBe(100);
    expect(guests.max).toBe(130);
    expect(result.draft.guests).toBe(115);
    const note = result.notes.find((item) => item.id === "guest-range");
    expect(note.text).toContain("100–130");
    expect(note.text).toContain("115");
  });

  test("parses ISO dates, meridiem times, durations with builder bounds, and contact details", () => {
    const result = run(
      "Service on 2026-12-05 at 6:30pm for a 14 hour marathon. Reach Dana at dana@client.test or 205-555-0142."
    );
    expect(result.draft.date).toBe("2026-12-05");
    expect(result.draft.time).toBe("18:30");
    expect(result.draft.hours).toBe(12);
    const hours = result.facts.find((fact) => fact.id === "hours");
    expect(hours.displayValue).toContain("builder bound: 12");
    expect(result.draft.email).toBe("dana@client.test");
    expect(result.draft.phone).toBe("205-555-0142");
  });

  test("infers the year for month-name dates and rolls past dates forward", () => {
    expect(run("Dinner on September 12.").draft.date).toBe("2026-09-12");
    expect(run("Dinner on March 3.").draft.date).toBe("2027-03-03");
    expect(run("Dinner on March 3, 2027.").draft.date).toBe("2027-03-03");
  });

  test("keeps venue guesses out of the draft until confirmed", () => {
    const result = run("Reception at the Riverside Loft for 120 guests.");
    expect(result.draft.venue).toBeUndefined();
    const venue = result.needsConfirmation.find((fact) => fact.id === "venue");
    expect(venue.value).toBe("Riverside Loft");
    expect(venue.confidence).toBe("low");
    expect(result.draft.guests).toBe(120);
  });

  test("matches tenant event types by keyword when the exact name is absent", () => {
    const result = run("A wedding for 120 people next spring.");
    const type = result.facts.find((fact) => fact.id === "eventTypeId");
    expect(type.value).toBe("weddings");
    expect(type.confidence).toBe("medium");
    expect(type.displayValue).toContain('matched "wedding"');
  });

  test("captures dietary clauses and title-case event names", () => {
    const result = run("The Rivera Wedding needs two stations; note a nut allergy and one vegan meal.");
    expect(result.draft.eventName).toBe("The Rivera Wedding");
    expect(result.draft.dietaryRestrictions).toContain("nut allergy");
    expect(result.draft.style).toBe("Stations");
  });

  test("never invents: unreadable text produces no facts and an empty draft", () => {
    const result = run("Looking forward to chatting soon!");
    expect(result.facts).toEqual([]);
    expect(result.needsConfirmation).toEqual([]);
    expect(result.draft).toEqual({});
    expect(result.empty).toBe(false);
  });

  test("flags empty input distinctly", () => {
    expect(run("").empty).toBe(true);
    expect(run("   ").empty).toBe(true);
  });

  test("does not misread counts adjacent to non-guest nouns", () => {
    const result = run("Please plan for 2 vegan meals across the menu.");
    expect(result.draft.guests).toBeUndefined();
  });
});
