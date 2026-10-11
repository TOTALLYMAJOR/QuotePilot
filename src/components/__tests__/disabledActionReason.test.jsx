import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { calculateQuote } from "../../lib/quoteCalculator";
import {
  baseFixtureForm,
  quoteCalculationCatalog,
  quoteCalculationSettings
} from "../../lib/__tests__/fixtures/quoteCalculationFixtures";
import DisabledActionReason, { mergeAriaDescribedBy } from "../DisabledActionReason";
import ProposalComposer from "../ProposalComposer";

describe("DisabledActionReason", () => {
  test("shows one visible blocker and associates every disabled child without changing eligibility", () => {
    const markup = renderToStaticMarkup(
      <DisabledActionReason id="quote-actions-blocked" reason="Complete the exact revision review first.">
        <button type="button" disabled aria-describedby="existing-detail">Download PDF</button>
        <button type="button" disabled>Print proposal</button>
        <button type="button">Open review</button>
      </DisabledActionReason>
    );

    expect(markup).toContain('aria-describedby="existing-detail quote-actions-blocked"');
    expect(markup).toContain('aria-describedby="quote-actions-blocked"');
    expect(markup.match(/id="quote-actions-blocked"/g)).toHaveLength(1);
    expect(markup).toContain('data-disabled-action-reason="visible"');
    expect(markup).toContain("Complete the exact revision review first.");
    expect(markup).toContain("<button type=\"button\">Open review</button>");
  });

  test("does not expose a blocker or disable an eligible action", () => {
    const markup = renderToStaticMarkup(
      <DisabledActionReason id="unused-reason" reason="This should stay hidden.">
        <button type="button">Continue</button>
      </DisabledActionReason>
    );

    expect(markup).toBe('<button type="button">Continue</button>');
  });

  test("merges description tokens without duplicates", () => {
    expect(mergeAriaDescribedBy("first second", "second", "third"))
      .toBe("first second third");
  });

  test("makes Proposal Composer save and compare blockers visible and associated", () => {
    const form = {
      ...baseFixtureForm,
      pkg: "",
      eventTypeId: "corporate",
      eventName: "Annual dinner",
      venue: "The Foundry",
      name: "Jordan Blake",
      email: "jordan@example.test"
    };
    const markup = renderToStaticMarkup(
      <ProposalComposer
        form={form}
        totals={calculateQuote(form, quoteCalculationCatalog, quoteCalculationSettings)}
        catalog={quoteCalculationCatalog}
        settings={quoteCalculationSettings}
        saveDisabled
        saveDisabledReason="Wait for the current authority check to finish."
        compareEnabled
        catalogLoading
        onFieldChange={() => {}}
        onEventTypeChange={() => {}}
        onGuidedMode={() => {}}
        onSaveQuote={() => {}}
      />
    );

    for (const id of [
      "proposal-header-save-disabled-reason",
      "proposal-pulse-save-disabled-reason",
      "proposal-mobile-save-disabled-reason"
    ]) {
      expect(markup).toContain(`aria-describedby="${id}"`);
      expect(markup).toContain(`id="${id}"`);
    }
    expect(markup).toContain('aria-describedby="proposal-header-compare-disabled-reason"');
    expect(markup).toContain('id="proposal-header-compare-disabled-reason"');
    expect(markup).toContain("Wait for the current catalog to finish loading.");
    expect(markup).not.toContain("title=\"Wait for the current authority check to finish.\"");
  });
});
