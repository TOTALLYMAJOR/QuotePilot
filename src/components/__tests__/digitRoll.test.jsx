import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import DigitRoll, {
  buildRollPlan,
  numericValueOfFormatted,
  splitFormattedValue
} from "../DigitRoll";
import { currency } from "../../lib/quoteCalculator";

function textOf(markup) {
  return markup.replace(/<[^>]*>/g, "");
}

describe("DigitRoll static render", () => {
  test("output text equals the formatted currency exactly", () => {
    const formatted = currency(1024); // "$1024.00" in this app's format
    const markup = renderToStaticMarkup(<DigitRoll value={formatted} />);
    expect(textOf(markup)).toBe(formatted);
  });

  test("preserves grouping separators verbatim", () => {
    const markup = renderToStaticMarkup(<DigitRoll value="$1,024.00" />);
    expect(textOf(markup)).toBe("$1,024.00");
  });

  test("server/static render carries no odometer machinery", () => {
    const markup = renderToStaticMarkup(<DigitRoll value="$1,024.00" />);
    expect(markup).toContain('data-digit-roll="static"');
    expect(markup).not.toContain("digit-roll-track");
    expect(markup).not.toContain("digit-roll-strip");
    expect(markup).not.toContain("digit-roll-ghost");
  });

  test("nullish values coerce to an empty string without crashing", () => {
    expect(textOf(renderToStaticMarkup(<DigitRoll value={undefined} />))).toBe("");
    expect(textOf(renderToStaticMarkup(<DigitRoll value={null} />))).toBe("");
  });
});

describe("splitFormattedValue", () => {
  test("classifies digits vs static characters", () => {
    const cells = splitFormattedValue("$1,024.00");
    expect(cells.map((c) => c.char).join("")).toBe("$1,024.00");
    expect(cells.map((c) => (c.isDigit ? "d" : "-")).join("")).toBe("-d-ddd-dd");
  });

  test("handles empty and nullish input", () => {
    expect(splitFormattedValue("")).toEqual([]);
    expect(splitFormattedValue(null)).toEqual([]);
    expect(splitFormattedValue(undefined)).toEqual([]);
  });
});

describe("numericValueOfFormatted", () => {
  test("reads the numeric value out of formatted currency", () => {
    expect(numericValueOfFormatted("$1,024.00")).toBe(1024);
    expect(numericValueOfFormatted("$999.00")).toBe(999);
    expect(numericValueOfFormatted("$0.00")).toBe(0);
  });

  test("falls back to zero on unparseable input", () => {
    expect(numericValueOfFormatted("")).toBe(0);
    expect(numericValueOfFormatted(null)).toBe(0);
  });
});

describe("buildRollPlan", () => {
  test("cells reproduce the next formatted string exactly", () => {
    const plan = buildRollPlan("$999.00", "$1,024.00");
    expect(plan.cells.map((c) => c.char).join("")).toBe("$1,024.00");
  });

  test("right-aligned diff across a digit-count change marks only changed digits", () => {
    const plan = buildRollPlan("$999.00", "$1,024.00");
    expect(plan.direction).toBe("up");
    expect(plan.changedCount).toBe(4);
    // Cents and punctuation pair up from the right and stay static.
    expect(plan.cells.filter((c) => c.changed).map((c) => c.char)).toEqual(["1", "0", "2", "4"]);
    expect(plan.cells.filter((c) => !c.isDigit).every((c) => !c.changed)).toBe(true);
    const trailingCents = plan.cells.slice(-2);
    expect(trailingCents.every((c) => c.isDigit && !c.changed)).toBe(true);
  });

  test("a brand-new digit position rolls in from a blank slot", () => {
    const plan = buildRollPlan("$999.00", "$1,024.00");
    const thousands = plan.cells[1];
    expect(thousands.char).toBe("1");
    expect(thousands.changed).toBe(true);
    expect(thousands.glyphs[0]).toBe("\u00a0");
    expect(thousands.glyphs[1]).toBe("1");
  });

  test("stagger runs right-to-left in fixed steps", () => {
    const plan = buildRollPlan("$999.00", "$1,024.00", 20);
    const changed = plan.cells.filter((c) => c.changed);
    // Left-to-right reading order shows descending delays: rightmost first.
    expect(changed.map((c) => c.delayMs)).toEqual([60, 40, 20, 0]);
    expect(plan.maxDelayMs).toBe(60);
  });

  test("increase rolls up: incoming glyph sits below the outgoing one", () => {
    const plan = buildRollPlan("$5.00", "$6.00");
    expect(plan.direction).toBe("up");
    const cell = plan.cells.find((c) => c.changed);
    expect(cell.glyphs).toEqual(["5", "6"]);
    expect(cell.from).toBe(0);
    expect(cell.to).toBe(1);
  });

  test("decrease rolls down, including a digit-count shrink", () => {
    const plan = buildRollPlan("$1024.00", "$999.00");
    expect(plan.direction).toBe("down");
    expect(plan.cells.map((c) => c.char).join("")).toBe("$999.00");
    const changed = plan.cells.filter((c) => c.changed);
    expect(changed.map((c) => c.char)).toEqual(["9", "9", "9"]);
    for (const cell of changed) {
      expect(cell.glyphs[0]).toBe(cell.char); // target glyph on top
      expect(cell.from).toBe(1);
      expect(cell.to).toBe(0);
    }
  });

  test("identical values produce no changed cells", () => {
    const plan = buildRollPlan("$88.00", "$88.00");
    expect(plan.changedCount).toBe(0);
    expect(plan.maxDelayMs).toBe(0);
    expect(plan.cells.every((c) => !c.changed)).toBe(true);
  });

  test("keys are anchored from the right so cents keep identity across width changes", () => {
    const before = buildRollPlan("$999.00", "$999.00");
    const after = buildRollPlan("$999.00", "$1,024.00");
    const lastKeyBefore = before.cells[before.cells.length - 1].key;
    const lastKeyAfter = after.cells[after.cells.length - 1].key;
    expect(lastKeyBefore).toBe(lastKeyAfter);
  });
});
