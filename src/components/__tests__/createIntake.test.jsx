import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import CreateIntake from "../CreateIntake";

const NOW = new Date("2026-08-10T09:00:00");
const STYLES = ["Buffet", "Plated", "Stations", "Drop-off"];
const EVENT_TYPES = [{ id: "corporate-dinner", name: "Corporate Dinner" }];

function render(props = {}) {
  return renderToStaticMarkup(
    <CreateIntake
      eventTypes={EVENT_TYPES}
      styles={STYLES}
      nowDate={NOW}
      onApplyDraft={() => {}}
      {...props}
    />
  );
}

describe("CreateIntake", () => {
  test("opens as a quiet canvas with an honest promise and a disabled action", () => {
    const markup = render();
    expect(markup).toContain("What are you planning?");
    expect(markup).toContain("Nothing is saved");
    expect(markup).toContain('data-create-intake="intent-extraction-v1"');
    expect(markup).toContain("Structure it");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("Read from your note");
  });

  test("shows read facts with source excerpts, confirmations, notes, and the apply action", () => {
    const markup = render({
      initialText: "Corporate dinner for about 80 people on September 12, plated, at the Riverside Loft, budget around $12k.",
      autoStructure: true
    });
    expect(markup).toContain("Read from your note");
    expect(markup).toContain("~80 guests");
    expect(markup).toContain("2026-09-12");
    expect(markup).toContain("from “");
    expect(markup).toContain("Needs your confirmation");
    expect(markup).toContain("Riverside Loft");
    expect(markup).toContain("Use as venue");
    expect(markup).toContain("no budget field");
    expect(markup).toContain("Apply 4 facts to the draft");
    expect(markup).toContain("saving re-prices on the server");
  });

  test("says plainly when nothing structured could be read", () => {
    const markup = render({ initialText: "Looking forward to chatting soon!", autoStructure: true });
    expect(markup).toContain("Nothing structured could be read");
    expect(markup).toContain("nothing was changed");
    expect(markup).not.toContain("Apply ");
  });
});
