// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import CreateIntake, { buildApplyPayload } from "../CreateIntake";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    expect(markup).toContain("Add 4 details to the draft");
    expect(markup).toContain("saving re-prices on the server");
  });

  test("says plainly when nothing structured could be read", () => {
    const markup = render({ initialText: "Looking forward to chatting soon!", autoStructure: true });
    expect(markup).toContain("Nothing structured could be read");
    expect(markup).toContain("nothing was changed");
    expect(markup).not.toContain("Apply ");
  });

  test("collapses an applied reading into a reversible draft handoff", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onApplyDraft = vi.fn();

    act(() => {
      root.render(
        <CreateIntake
          eventTypes={EVENT_TYPES}
          styles={STYLES}
          nowDate={NOW}
          onApplyDraft={onApplyDraft}
          initialText="Corporate dinner for 80 people on September 12, plated."
          autoStructure
        />
      );
    });
    const apply = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Add "));
    act(() => apply.click());

    expect(onApplyDraft).toHaveBeenCalledOnce();
    expect(container.innerHTML).toContain('data-create-intake-state="applied"');
    expect(container.textContent).toContain("details are in this draft");
    expect(container.textContent).not.toContain("Read from your note");
    expect(document.activeElement).toBe(container.querySelector("#create-intake-title"));

    const review = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Review intake");
    act(() => review.click());
    expect(container.textContent).toContain("Read from your note");
    expect(container.textContent).toContain("Added - review below");
    expect(onApplyDraft).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(container.querySelector("textarea"));

    act(() => root.unmount());
    container.remove();
  });
});


test("reviewed intake persists declared attendance uncertainty without inventing bounds or customer provenance", () => {
  const apply = fact => buildApplyPayload({ draft: { guests: fact.value }, facts: [{ id: "guests", field: "guests", ...fact }] });
  expect(apply({ kind: "range", value: 115, min: 100, max: 130 }).draft.attendancePlanning).toEqual({ kind: "range", value: 115, min: 100, max: 130, sourceType: "staff_intake" });
  expect(apply({ kind: "approximate", value: 80 }).draft.attendancePlanning).toEqual({ kind: "approximate", value: 80, min: null, max: null, sourceType: "staff_intake" });
  expect(apply({ kind: "exact", value: 80 }).draft.attendancePlanning).toEqual({ kind: "exact", value: 80, min: null, max: null, sourceType: "staff_intake" });
  expect(apply({ kind: "exact", value: 401 }).draft.attendancePlanning).toBeUndefined();
});
