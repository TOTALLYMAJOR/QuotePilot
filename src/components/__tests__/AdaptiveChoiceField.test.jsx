import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import AdaptiveChoiceField, { getAdaptiveChoiceMode } from "../AdaptiveChoiceField";
import FieldStateIndicator from "../FieldStateIndicator";

describe("AdaptiveChoiceField", () => {
  test("renders zero choices as a visible blocker with one recovery action", () => {
    const html = renderToStaticMarkup(
      <AdaptiveChoiceField
        id="event-type"
        label="Event type"
        description="Used to find the right menu."
        options={[]}
        emptyReason="No event types have been published for this organization."
        recoveryAction={{ label: "Set up event types", onClick: () => {} }}
      />
    );

    expect(html).toContain('data-adaptive-choice-mode="empty"');
    expect(html).toContain('aria-describedby="event-type-description event-type-error"');
    expect(html).toContain('id="event-type-error"');
    expect(html).toContain('data-field-state-primary="blocked"');
    expect(html).toContain("No event types have been published");
    expect(html).toContain("Set up event types");
    expect(html).not.toContain("<select");
  });

  test("fails closed when an empty field has no explanation or recovery", () => {
    expect(() => renderToStaticMarkup(
      <AdaptiveChoiceField label="Event type" options={[]} />
    )).toThrow("requires an emptyReason");
  });

  test("renders one choice as static confirmed and read-only context without a select", () => {
    const html = renderToStaticMarkup(
      <AdaptiveChoiceField
        id="organization"
        name="organizationId"
        label="Organization"
        options={[{ value: "org-1", label: "Toni Catering" }]}
      />
    );

    expect(html).toContain('data-adaptive-choice-mode="single"');
    expect(html).toContain('data-adaptive-choice-value="org-1"');
    expect(html).toContain('data-field-state-primary="confirmed"');
    expect(html).toContain("Read-only");
    expect(html).toContain('type="hidden"');
    expect(html).not.toContain("<select");
  });

  test("renders two or more choices as an accessible select with validation feedback", () => {
    const html = renderToStaticMarkup(
      <AdaptiveChoiceField
        id="package"
        name="packageId"
        label="Package"
        description="Choose the offer the client will see."
        options={[
          { value: "classic", label: "Classic buffet" },
          { value: "premium", label: "Premium buffet" }
        ]}
        value="classic"
        onChange={() => {}}
        error="Review this package before continuing."
      />
    );

    expect(html).toContain('data-adaptive-choice-mode="select"');
    expect(html).toContain('<label class="adaptive-choice-field__label" for="package">Package</label>');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Classic buffet");
    expect(html).toContain("Premium buffet");
  });

  test("classifies choice count deterministically and rejects duplicate values", () => {
    expect(getAdaptiveChoiceMode([])).toBe("empty");
    expect(getAdaptiveChoiceMode([{ value: "one", label: "One" }])).toBe("single");
    expect(getAdaptiveChoiceMode([
      { value: "one", label: "One" },
      { value: "two", label: "Two" }
    ])).toBe("select");
    expect(() => getAdaptiveChoiceMode([
      { value: 1, label: "One" },
      { value: "1", label: "Still one" }
    ])).toThrow("duplicated");
  });
});

describe("FieldStateIndicator", () => {
  test("renders one primary state with source provenance and supporting states as text", () => {
    const html = renderToStaticMarkup(
      <FieldStateIndicator
        state={{ origin: "historical_imported", editability: "read_only", evidence: "stale" }}
        label="Selling price state"
        reason="This value predates the active catalog revision."
        provenance="Menu.pdf, page 3"
        recoveryAction={{ label: "Review current price", href: "/app/catalog" }}
      />
    );

    expect(html).toContain('data-field-state-primary="stale"');
    expect(html.match(/field-state-indicator__primary/g)).toHaveLength(1);
    expect(html).toContain('data-field-state-provenance="true"');
    expect(html).toContain("Historical/imported");
    expect(html).toContain("Read-only");
  });

  test("announces transitional and failed outcomes with the correct urgency", () => {
    const saving = renderToStaticMarkup(
      <FieldStateIndicator state={{ persistence: "saving" }} label="Price state" />
    );
    expect(saving).toContain('role="status"');
    expect(saving).toContain('aria-live="polite"');

    const failed = renderToStaticMarkup(
      <FieldStateIndicator
        state={{ evidence: "failed" }}
        label="Price state"
        reason="The server rejected this save."
        recoveryAction={{ label: "Try saving again", onClick: () => {} }}
      />
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('aria-live="assertive"');
  });
});
