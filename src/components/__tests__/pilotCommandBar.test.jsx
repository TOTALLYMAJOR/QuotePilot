// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import PilotCommandBar from "../PilotCommandBar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const settings = {
  perMileRate: 0.7,
  longDistancePerMileRate: 1.1,
  deliveryThresholdMiles: 30,
  serverRate: 22,
  chefRate: 28,
  bartenderRate: 30,
  serviceFeePct: 0.2,
  serviceFeeTiers: [{ id: "all", minGuests: 0, maxGuests: 9999, pct: 0.2 }],
  taxRate: 0.1,
  taxRegions: [{ id: "local", name: "Local", rate: 0.1 }],
  defaultTaxRegion: "local",
  depositPct: 0.3,
  seasonalProfiles: [{
    id: "standard", name: "Standard",
    startMonth: 1, startDay: 1, endMonth: 12, endDay: 31,
    packageMultiplier: 1, addonMultiplier: 1, rentalMultiplier: 1
  }],
  menuSections: []
};

const catalog = { packages: [{ id: "classic", name: "Classic", ppp: 20 }], addons: [], rentals: [], settings };

const form = {
  pkg: "classic", guests: 120, hours: 6, servers: 8, chefs: 3, bartenders: 2,
  addons: [], rentals: [], menuItems: [], addonQuantities: {}, rentalQuantities: {},
  menuItemQuantities: {}, milesRT: 0, date: "2026-03-15", style: "Plated"
};

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

function render(props = {}) {
  act(() => {
    root.render(
      <PilotCommandBar
        form={form}
        catalog={catalog}
        settings={settings}
        styles={["Buffet", "Plated", "Stations", "Drop-off"]}
        onStageProposal={() => {}}
        {...props}
      />
    );
  });
}

function setCommand(value) {
  const input = container.querySelector(".pilot-command-input");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickByText(label) {
  const button = [...container.querySelectorAll("button")]
    .find((element) => element.textContent.trim() === label);
  expect(button, `button "${label}"`).toBeTruthy();
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("PilotCommandBar", () => {
  test("holds the preview-confirm contract: commands preview with a priced delta before anything applies", () => {
    const onStageProposal = vi.fn();
    render({ onStageProposal });
    setCommand("add another bartender and switch to buffet");
    clickByText("Preview");
    expect(container.innerHTML).toContain("Add 1 bartender");
    expect(container.innerHTML).toContain("Service style → Buffet");
    expect(container.innerHTML).toContain("total (preview, fee and tax cascade included)");
    expect(container.innerHTML).toContain("Nothing changes until you apply");
    expect(onStageProposal).not.toHaveBeenCalled();
  });

  test("applies exactly the confirmed proposal and marks it applied", () => {
    const onStageProposal = vi.fn();
    render({ onStageProposal });
    setCommand("add another bartender");
    clickByText("Preview");
    clickByText("Apply");
    expect(onStageProposal).toHaveBeenCalledTimes(1);
    expect(onStageProposal.mock.calls[0][0]).toMatchObject({ kind: "add_staff", field: "bartenders", count: 1 });
    expect(container.innerHTML).toContain("Applied to this draft.");
  });

  test("stays honest about unreadable commands and hides voice without browser support", () => {
    render();
    setCommand("please make it magnificent");
    clickByText("Preview");
    expect(container.innerHTML).toContain("nothing was read from this; the draft is unchanged");
    expect(container.innerHTML).not.toContain(">Speak<");
  });
});
