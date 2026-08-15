import { describe, expect, it } from "vitest";
import {
  formatDiffValue,
  humanizeTriggerList,
  summarizeExactDiff
} from "../commercialChangeDiffPresentation";

describe("summarizeExactDiff", () => {
  it("reduces primitive changes to a single row", () => {
    const summary = summarizeExactDiff(125, 175);
    expect(summary.rows).toEqual([
      { path: "value", label: "Value", before: "125", after: "175", kind: "changed" }
    ]);
    expect(summary.total).toBe(1);
    expect(summary.moreCount).toBe(0);
  });

  it("matches id-keyed catalog items and names their changed fields", () => {
    const before = [
      { id: "salmon", name: "Salmon Entrée", unitPrice: 28, quantity: 40 },
      { id: "torte", name: "Chocolate Torte", unitPrice: 9 }
    ];
    const after = [
      { id: "salmon", name: "Salmon Entrée", unitPrice: 32, quantity: 40 },
      { id: "brulee", name: "Crème Brûlée", unitPrice: 11 }
    ];
    const summary = summarizeExactDiff(before, after);
    const labels = summary.rows.map((row) => `${row.label}: ${row.before} → ${row.after}`);
    expect(labels).toContain("Salmon Entrée · Unit price: 28 → 32");
    expect(labels).toContain("Chocolate Torte: Included → Removed");
    expect(labels).toContain("Crème Brûlée: — → Added");
    expect(summary.rows.every((row) => row.path)).toBe(true);
  });

  it("walks nested objects with humanized key paths", () => {
    const summary = summarizeExactDiff(
      { taxRegions: { local: { rate: 0.05 } }, depositPct: 0.25 },
      { taxRegions: { local: { rate: 0.08 } }, depositPct: 0.25 }
    );
    expect(summary.rows).toEqual([
      {
        path: "taxRegions.local.rate",
        label: "Tax regions · Local · Rate",
        before: "0.05",
        after: "0.08",
        kind: "changed"
      }
    ]);
  });

  it("parses JSON strings before diffing and reports unchanged pairs as empty", () => {
    const summary = summarizeExactDiff('{"guests":80}', '{"guests":100}');
    expect(summary.rows).toEqual([
      { path: "guests", label: "Guests", before: "80", after: "100", kind: "changed" }
    ]);
    expect(summarizeExactDiff('{"a":1}', '{"a":1}').total).toBe(0);
  });

  it("caps displayed rows and reports the remainder", () => {
    const before = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, i]));
    const after = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, i + 1]));
    const summary = summarizeExactDiff(before, after, { maxRows: 5 });
    expect(summary.rows).toHaveLength(5);
    expect(summary.total).toBe(20);
    expect(summary.moreCount).toBe(15);
  });

  it("treats non-id arrays as one whole-value change", () => {
    const summary = summarizeExactDiff([1, 2, 3], [1, 2, 4]);
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].before).toBe("[1,2,3]");
    expect(summary.rows[0].after).toBe("[1,2,4]");
  });
});

describe("formatDiffValue", () => {
  it("formats leaves for reading", () => {
    expect(formatDiffValue(null)).toBe("—");
    expect(formatDiffValue(true)).toBe("Yes");
    expect(formatDiffValue(false)).toBe("No");
    expect(formatDiffValue("  Plated  ")).toBe("Plated");
    expect(formatDiffValue(12.345)).toBe("12.35");
    expect(formatDiffValue("x".repeat(80))).toHaveLength(48);
  });
});

describe("humanizeTriggerList", () => {
  it("strips fact prefixes and humanizes", () => {
    expect(humanizeTriggerList(["fact.guest_count", "fact.venue"])).toBe("Guest count, Venue");
    expect(humanizeTriggerList([])).toBe("");
  });
});
