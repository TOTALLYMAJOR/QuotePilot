import { describe, expect, test } from "vitest";
import { buildDraftSaveBlockers, buildSaveActionModel } from "../ProposalComposer";

const COMPLETE_FORM = Object.freeze({
  name: "Morgan Lee",
  email: "morgan@example.test",
  eventTypeId: "wedding",
  eventName: "Morgan wedding",
  date: "2026-09-12",
  venue: "Pine Hall"
});

describe("Proposal Composer save readiness", () => {
  test("returns no known blockers for a complete current draft", () => {
    expect(buildDraftSaveBlockers({
      form: COMPLETE_FORM,
      totals: { guests: 120 },
      selectedMenuItemCount: 3
    })).toEqual([]);
  });

  test("names client, event, catalog, and menu requirements without claiming server approval", () => {
    expect(buildDraftSaveBlockers({
      form: { email: "not-an-email" },
      totals: { guests: 0 },
      catalogLoading: true,
      selectedMenuItemCount: 0
    }).map((blocker) => blocker.id)).toEqual([
      "catalog-loading",
      "guest-count",
      "client-name",
      "client-email-format",
      "event-type",
      "event-date",
      "event-name",
      "venue",
      "menu-selection"
    ]);
  });

  test("requires a current impact review before later authorization", () => {
    expect(buildDraftSaveBlockers({
      form: COMPLETE_FORM,
      totals: { guests: 120 },
      selectedMenuItemCount: 1,
      changeImpactReviewRequired: true,
      changeImpactAuthorizationRequired: true
    }).map((blocker) => blocker.id)).toEqual(["change-impact-review"]);
  });

  test("turns a blocked save into an exact blocker-review action", () => {
    expect(buildSaveActionModel({
      saveBlockers: [
        { id: "client-name", message: "Add the client name." },
        { id: "venue", message: "Add the venue." }
      ]
    })).toEqual({ mode: "review", label: "Review 2 blockers", disabled: false });
    expect(buildSaveActionModel({
      saveBlockers: [],
      saveLabel: "Save Changes",
      saveDisabled: true
    })).toEqual({ mode: "save", label: "Save Changes", disabled: true });
  });
});
