import { describe, expect, test } from "vitest";
import { buildBeoPayload } from "../beoPayload";
import { proposalPayloadFixtureQuote } from "./fixtures/proposalPayloadFixture";

describe("BEO payload", () => {
  test("derives event, staffing, and selection fields from the quote", () => {
    const payload = buildBeoPayload(proposalPayloadFixtureQuote);

    expect(payload.quoteNumber).toBe("Q-2026-0042");
    expect(payload.event).toEqual({
      name: "Spring Gala",
      date: "2026-04-20",
      time: "18:00",
      venue: "Pine Hall",
      venueAddress: "123 Garden Ave, Birmingham, AL",
      guests: 120,
      hours: 5,
      style: "Plated",
      dietaryRestrictions: "Nut allergy, vegetarian option for 12 guests"
    });
    expect(payload.staffing).toEqual({
      servers: 8,
      chefs: 3,
      bartenders: 2,
      staffLead: "Jamie Chen"
    });
    expect(payload.selections).toEqual({
      packageName: "Deluxe",
      menuItemNames: ["Salad Bar", "Setup Fee"],
      addons: ["Dessert", "Coffee Station"],
      rentals: ["Linens"]
    });
  });

  test("reads the internal organization name without falling back to brand name", () => {
    const payload = buildBeoPayload({
      ...proposalPayloadFixtureQuote,
      quoteMeta: {
        ...proposalPayloadFixtureQuote.quoteMeta,
        organizationName: "Acme Events Catering LLC"
      }
    });

    expect(payload.organizationName).toBe("Acme Events Catering LLC");
  });

  test("builds the kitchen checkpoint timeline from event timing and booking overrides", () => {
    const payload = buildBeoPayload(proposalPayloadFixtureQuote);

    expect(payload.checkpoints.map((item) => [item.id, item.minuteOffset, item.timeValue])).toEqual([
      ["prep-start", -180, "15:00"],
      ["line-check", -120, "16:00"],
      ["pack-out", -60, "17:00"],
      ["onsite-setup", -30, "17:30"],
      ["service-start", -15, "17:45"],
      ["service-end", 300, "23:00"],
      ["reset", 345, "23:45"]
    ]);
    expect(payload.checkpoints.find((item) => item.id === "service-start").label).toBe("Doors open");
  });

  test("groups the production checklist by phase, preserving definition order within each group", () => {
    const payload = buildBeoPayload(proposalPayloadFixtureQuote);

    expect(payload.productionChecklist.map((group) => group.group)).toEqual([
      "Plan",
      "Kitchen",
      "Logistics",
      "Team",
      "Service",
      "Closeout"
    ]);

    const plan = payload.productionChecklist.find((group) => group.group === "Plan");
    expect(plan.items.map((item) => item.id)).toEqual(["event-brief", "guest-count", "dietary-review"]);
    expect(plan.items[0]).toMatchObject({
      completed: true,
      completedAtISO: "2026-04-01T10:00:00.000Z",
      completedByEmail: "ops@acme.test"
    });
    expect(plan.items[1]).toMatchObject({ completed: false, completedAtISO: "", completedByEmail: "" });

    const logistics = payload.productionChecklist.find((group) => group.group === "Logistics");
    expect(logistics.items.map((item) => item.id)).toEqual(["equipment-plan", "pack-out"]);

    const kitchen = payload.productionChecklist.find((group) => group.group === "Kitchen");
    expect(kitchen.items[0]).toMatchObject({ id: "menu-prep", completed: true, completedByEmail: "chef@acme.test" });
  });

  test("throws without a quote", () => {
    expect(() => buildBeoPayload(null)).toThrow(/Missing quote data/);
  });
});
