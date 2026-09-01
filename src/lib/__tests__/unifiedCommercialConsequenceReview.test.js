import { describe, expect, test } from "vitest";
import {
  buildUnifiedCommercialConsequenceReview,
  buildUnifiedConsequenceProposedForm,
  unifiedConsequenceFenceCurrent
} from "../unifiedCommercialConsequenceReview";

function model() {
  return {
    identity: { beforeRevisionId: "v0002", proposedRevisionId: "preview-v0003" },
    factDiffs: [
      { nodeId: "fact.staffing.counts", before: { servers: 2 }, proposedAfter: { servers: 3 } },
      { nodeId: "fact.selection.rentals", before: [], proposedAfter: [{ id: "chair" }] }
    ],
    commercialValues: {
      authoritativeTotal: { before: 1000, proposedAfter: 1300 },
      depositRequirement: { before: 250, proposedAfter: 325 }
    }
  };
}

function review() {
  return buildUnifiedCommercialConsequenceReview({
    model: model(),
    recommendations: [
      { key: "coffee", kind: "addon", id: "coffee", label: "Add coffee", reason: "Guest threshold", impact: "~$100 impact" },
      { key: "chairs", kind: "rental", id: "chair", label: "Add chairs", reason: "Service style", impact: "~$80 impact" }
    ],
    margin: { available: false, note: "Margins unavailable — Salmon cost is missing." },
    proposalReadiness: { complete: false, gaps: [{ label: "Event time" }] },
    catalogRevision: 8
  });
}

describe("unified commercial consequence review", () => {
  test("groups the six consequences and names every authority source", () => {
    const result = review();
    expect(result.groups.map((group) => group.label)).toEqual([
      "Price and deposit", "Staffing", "Rentals", "Guided recommendations", "Margin evidence", "Proposal readiness"
    ]);
    expect(result.sources).toEqual({
      authoritative: "Server-authoritative quote simulation",
      recommendations: "Operator-declared guided-selling policy",
      margin: "Tenant-recorded staff-only cost evidence",
      proposal: "Draft completeness policy"
    });
    expect(result.groups.find((group) => group.id === "margin-evidence").items[0].label).toBe("Margin unavailable");
  });

  test("apply selected builds one exact form without mutating its input", () => {
    const form = { addons: [], rentals: [], addonQuantities: {}, rentalQuantities: {}, eventTemplateId: "template" };
    const result = review();
    const next = buildUnifiedConsequenceProposedForm({
      form,
      review: result,
      selectedIds: ["guided:coffee"]
    });
    expect(next).toMatchObject({ addons: ["coffee"], rentals: [], addonQuantities: { coffee: 1 }, eventTemplateId: "custom" });
    expect(form).toEqual({ addons: [], rentals: [], addonQuantities: {}, rentalQuantities: {}, eventTemplateId: "template" });
  });

  test("invalidates when quote, proposed, or catalog revision fences change", () => {
    const result = review();
    expect(unifiedConsequenceFenceCurrent(result, {
      quoteRevisionId: "v0002",
      proposedRevisionId: "preview-v0003",
      catalogRevision: 8
    })).toBe(true);
    expect(unifiedConsequenceFenceCurrent(result, {
      quoteRevisionId: "v0002",
      proposedRevisionId: "preview-v0003",
      catalogRevision: 9
    })).toBe(false);
  });
});
