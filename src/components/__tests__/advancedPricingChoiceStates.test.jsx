// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { StepEvent } from "../WizardSteps";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("advanced pricing choice states", () => {
  test("replaces sole template, style, tax, and season choices with confirmed context", () => {
    act(() => {
      root.render(
        <StepEvent
          form={{
            eventTypeId: "wedding",
            eventTemplateId: "custom",
            style: "Buffet",
            taxRegion: "local",
            seasonProfileId: "auto",
            date: "",
            time: "",
            hours: 4,
            guests: 0,
            servers: 0,
            chefs: 0,
            bartenders: 0,
            includeDisposables: false
          }}
          setForm={() => {}}
          onTemplateChange={() => {}}
          styles={["Buffet"]}
          settings={{ taxRegions: [{ id: "local", name: "Local", rate: 0.0825 }] }}
          eventTypes={[{ id: "wedding", name: "Wedding" }]}
        />
      );
    });

    const advancedTrigger = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Advanced Pricing Overrides"));
    act(() => advancedTrigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    for (const field of ["event-template", "service-style", "tax-region", "season-profile"]) {
      const surface = container.querySelector(`[data-choice-field="${field}"]`);
      expect(surface?.querySelector('[data-adaptive-choice-mode="single"]')).toBeTruthy();
      expect(surface?.querySelector("select")).toBeNull();
    }
    expect(container.textContent).toContain("Custom is the only available starting point");
    expect(container.textContent).toContain("no seasonal profiles have been published");
  });
});
