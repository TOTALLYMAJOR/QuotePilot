import { describe, expect, test } from "vitest";
import {
  DECIDE_STACK_BOUNDS_NOTE,
  DECIDE_STACK_MODEL,
  buildDecideStack,
  buildReadinessGapCards,
  buildStaffingCard
} from "../decideStackPresentation";

function platedQuote(overrides = {}) {
  return {
    status: "draft",
    customer: { name: "Elena Rivera", email: "elena@example.test" },
    event: {
      name: "Rivera Wedding",
      date: "2026-08-22",
      time: "18:00",
      guests: 120,
      hours: 6,
      style: "Plated",
      servers: 8,
      chefs: 3
    },
    selection: { packageId: "deluxe", menuItems: ["duet"] },
    totals: { total: 15423, serverLabor: 1056, chefLabor: 504 },
    ...overrides
  };
}

describe("buildStaffingCard", () => {
  test("derives the plated house-ratio gap and prices it from the quote's own recorded labor", () => {
    const card = buildStaffingCard(platedQuote(), { ordinaryEditAllowed: true });
    expect(card).not.toBeNull();
    expect(card.title).toBe("Staffing below the house ratio");
    expect(card.sentence).toContain("calls for 10 servers and 3 chefs");
    expect(card.sentence).toContain("records 8 servers and 3 chefs");
    expect(card.sentence).toContain("2 more servers");
    expect(card.basis).toBe("House staffing ratio for Plated: 1 server per 12 guests, minimum 3; 1 chef per 50 guests.");
    expect(card.impact).toBe("≈ +$264.00 labor at this quote's average recorded server rate.");
    expect(card.action).toEqual({ id: "edit", kind: "edit", label: "Adjust in editor" });
  });

  test("refuses to estimate labor when the record cannot support it", () => {
    const card = buildStaffingCard(
      platedQuote({
        event: { ...platedQuote().event, servers: 0, chefs: 0 },
        totals: { total: 15423, serverLabor: 0, chefLabor: 0 }
      }),
      { ordinaryEditAllowed: true }
    );
    expect(card.sentence).toContain("records 0 servers and 0 chefs");
    expect(card.impact).toBe("The labor cost effect is not derivable from this quote's recorded totals.");
  });

  test("returns no card when the quoted staffing meets the house ratio", () => {
    const card = buildStaffingCard(
      platedQuote({ event: { ...platedQuote().event, servers: 10, chefs: 3 } })
    );
    expect(card).toBeNull();
  });

  test("applies buffet minimums and skips chef requirements with an infinite ratio", () => {
    const short = buildStaffingCard({
      status: "draft",
      event: { style: "Buffet", guests: 30, servers: 1, chefs: 0 }
    });
    expect(short.sentence).toContain("calls for 2 servers");
    expect(short.sentence).not.toContain("chef");
    const met = buildStaffingCard({
      status: "draft",
      event: { style: "Buffet", guests: 100, servers: 4, chefs: 0 }
    });
    expect(met).toBeNull();
  });

  test("never produces a card for drop-off, unknown styles, or missing guest counts", () => {
    expect(buildStaffingCard({ status: "draft", event: { style: "Drop-off", guests: 200, servers: 0 } })).toBeNull();
    expect(buildStaffingCard({ status: "draft", event: { style: "Family Style", guests: 120, servers: 0 } })).toBeNull();
    expect(buildStaffingCard({ status: "draft", event: { style: "Plated", guests: 0, servers: 0 } })).toBeNull();
  });

  test("routes to quote administration when ordinary editing is not allowed", () => {
    const card = buildStaffingCard(platedQuote(), { ordinaryEditAllowed: false });
    expect(card.action).toEqual({ id: "administration", kind: "administration", label: "Review quote actions" });
  });
});

describe("buildReadinessGapCards", () => {
  test("surfaces the heaviest proposal gaps first, bounded to two, with honest scope language", () => {
    const cards = buildReadinessGapCards(platedQuote(), { ordinaryEditAllowed: true });
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("Record the venue");
    expect(cards[0].impact).toBe("+11 toward Ready to send.");
    expect(cards[0].sentence).toContain("11 percentage points toward required proposal completeness");
    expect(cards[0].sentence).toContain("This is not operational event readiness.");
    expect(cards.some((card) => card.title === "Record the customer phone")).toBe(false);
  });

  test("returns nothing once every weighted proposal field is recorded", () => {
    const complete = platedQuote({
      customer: { name: "Elena Rivera", email: "elena@example.test", phone: "555-0100" },
      event: { ...platedQuote().event, venue: "Hill Country Pavilion" }
    });
    expect(buildReadinessGapCards(complete)).toEqual([]);
  });
});

describe("buildDecideStack", () => {
  test("stacks staffing before readiness gaps for an editable pre-decision quote", () => {
    const stack = buildDecideStack(platedQuote(), { ordinaryEditAllowed: true });
    expect(stack.modelId).toBe(DECIDE_STACK_MODEL);
    expect(stack.suppressed).toBe(false);
    expect(stack.boundsNote).toBe(DECIDE_STACK_BOUNDS_NOTE);
    expect(stack.cards.map((card) => card.kind)).toEqual(["staffing", "readiness_gap"]);
  });

  test("suppresses every advisory card once the quote reaches governed or terminal state", () => {
    for (const status of ["accepted", "booked", "declined", "expired", "deleted"]) {
      const stack = buildDecideStack(platedQuote({ status }), { ordinaryEditAllowed: false });
      expect(stack.suppressed).toBe(true);
      expect(stack.cards).toEqual([]);
    }
  });

  test("treats a missing status as draft and stays advisory", () => {
    const stack = buildDecideStack(platedQuote({ status: undefined }));
    expect(stack.suppressed).toBe(false);
  });
});
