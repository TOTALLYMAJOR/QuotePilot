import { describe, expect, test } from "vitest";
import {
  normalizeProposalDocumentFontScale,
  proposalDocumentFontSize
} from "../proposalDocumentPreferences";

describe("proposal document preferences", () => {
  test("normalizes the bounded proposal font scale choices", () => {
    expect(normalizeProposalDocumentFontScale("compact")).toMatchObject({
      id: "compact",
      scale: 0.92
    });
    expect(normalizeProposalDocumentFontScale("large")).toMatchObject({
      id: "large",
      scale: 1.12
    });
    expect(normalizeProposalDocumentFontScale("unknown")).toMatchObject({
      id: "standard",
      scale: 1
    });
  });

  test("accepts older numeric values by mapping them to safe choices", () => {
    expect(normalizeProposalDocumentFontScale(0.9).id).toBe("compact");
    expect(normalizeProposalDocumentFontScale(1.01).id).toBe("standard");
    expect(normalizeProposalDocumentFontScale(1.2).id).toBe("large");
  });

  test("scales PDF point sizes without allowing unreadable text", () => {
    expect(proposalDocumentFontSize(10, "large")).toBe(11.2);
    expect(proposalDocumentFontSize(10, "compact")).toBe(9.2);
    expect(proposalDocumentFontSize(3, "compact")).toBe(6);
  });
});
