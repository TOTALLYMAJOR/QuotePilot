// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ChangeRequestPanel from "../ChangeRequestPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const settings = {
  perMileRate: 0.7,
  longDistancePerMileRate: 1.1,
  deliveryThresholdMiles: 30,
  serverRate: 22,
  chefRate: 28,
  bartenderRate: 30,
  serviceFeePct: 0.2,
  serviceFeeTiers: [{ id: "small", minGuests: 0, maxGuests: 9999, pct: 0.2 }],
  taxRate: 0.1,
  taxRegions: [{ id: "local", name: "Local", rate: 0.1 }],
  defaultTaxRegion: "local",
  depositPct: 0.3,
  seasonalProfiles: [{
    id: "standard", name: "Standard",
    startMonth: 1, startDay: 1, endMonth: 12, endDay: 31,
    packageMultiplier: 1, addonMultiplier: 1, rentalMultiplier: 1
  }],
  menuSections: [{
    id: "mains",
    name: "Mains",
    items: [
      { id: "salmon", name: "Grilled Salmon", price: 6, pricingType: "per_person" },
      { id: "chicken", name: "Herb Chicken", price: 4, pricingType: "per_person" }
    ]
  }]
};

const catalog = {
  packages: [{ id: "classic", name: "Classic", ppp: 20 }],
  addons: [],
  rentals: [],
  settings
};

const form = {
  pkg: "classic",
  guests: 120,
  hours: 6,
  servers: 8,
  chefs: 3,
  bartenders: 2,
  addons: [],
  rentals: [],
  menuItems: ["salmon"],
  addonQuantities: {},
  rentalQuantities: {},
  menuItemQuantities: {},
  milesRT: 0,
  date: "2026-03-15",
  style: "Plated"
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

function renderPanel(props = {}) {
  act(() => {
    root.render(
      <ChangeRequestPanel
        message="Could we do chicken instead of the salmon?"
        submittedAtISO="2026-08-10T11:24:00Z"
        requestId="req-9"
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

function clickByText(label) {
  const button = [...container.querySelectorAll("button")]
    .find((element) => element.textContent.trim() === label);
  expect(button, `button "${label}"`).toBeTruthy();
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ChangeRequestPanel structured record action", () => {
  test("offers the record boundary only after staging and holds the ready state", () => {
    renderPanel({ onRecordParse: vi.fn() });
    expect(container.querySelector('[data-capability-id="structured-change-request-record"]')).toBeNull();
    clickByText("Stage this");
    expect(container.innerHTML).toContain('data-capability-state="ready"');
    expect(container.innerHTML).toContain("does not reply to the customer");
  });

  test("records once through the callable boundary and lands on an internal receipt", async () => {
    let resolveCall;
    const onRecordParse = vi.fn(() => new Promise((resolve) => { resolveCall = resolve; }));
    renderPanel({ onRecordParse });
    clickByText("Stage this");
    clickByText("Record this review");
    expect(container.innerHTML).toContain('data-capability-state="submitting"');
    await act(async () => {
      resolveCall({
        resolutionId: `crr_${"a".repeat(48)}`,
        recordedAtISO: "2026-08-10T12:00:00Z",
        alreadyRecorded: false
      });
    });
    expect(container.innerHTML).toContain('data-capability-state="receipt"');
    expect(container.innerHTML).toContain("no version");
    expect(onRecordParse).toHaveBeenCalledTimes(1);
    const payload = onRecordParse.mock.calls[0][0];
    expect(payload.requestId).toBe("req-9");
    expect(payload.parseModelId).toBe("change-request-parse-v1");
    expect(payload.stagedProposalIds).toHaveLength(1);
  });

  test("treats a definitive server rejection as terminal without touching the staged draft", async () => {
    const definitive = Object.assign(new Error("raw-provider-detail"), { definitive: true });
    const onRecordParse = vi.fn(() => Promise.reject(definitive));
    renderPanel({ onRecordParse });
    clickByText("Stage this");
    await act(async () => {
      clickByText("Record this review");
    });
    expect(container.innerHTML).toContain('data-capability-state="error"');
    expect(container.innerHTML).toContain("staged draft is unchanged");
    expect(container.innerHTML).not.toContain("raw-provider-detail");
    expect([...container.querySelectorAll("button")].some(
      (button) => button.textContent.includes("Reconcile")
    )).toBe(false);
  });

  test("locks an ambiguous outcome to replay-stable reconciliation and recovers a transient failure", async () => {
    const transient = () => Object.assign(new Error("offline"), { definitive: false });
    let resolveReconcile;
    const onRecordParse = vi.fn()
      .mockImplementationOnce(() => Promise.reject(transient()))
      .mockImplementationOnce(() => Promise.reject(transient()))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveReconcile = resolve; }));
    renderPanel({ onRecordParse });
    clickByText("Stage this");
    await act(async () => {
      clickByText("Record this review");
    });
    expect(container.innerHTML).toContain('data-capability-state="uncertain"');
    expect(container.innerHTML).toContain("replay-stable");
    await act(async () => {
      clickByText("Reconcile record");
    });
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    expect(container.innerHTML).toContain("safe to repeat");
    clickByText("Try again");
    expect(container.innerHTML).toContain('data-capability-state="reconciliation"');
    await act(async () => {
      resolveReconcile({
        resolutionId: `crr_${"b".repeat(48)}`,
        recordedAtISO: "2026-08-10T12:06:00Z",
        alreadyRecorded: true
      });
    });
    expect(container.querySelector('[data-capability-state="receipt"]')).not.toBeNull();
    expect(container.innerHTML).toContain("already on file");
  });

  test("stays a read-and-stage surface when the callable boundary is unavailable", () => {
    renderPanel({ onRecordParse: null });
    clickByText("Stage this");
    expect(container.querySelector('[data-capability-id="structured-change-request-record"]')).toBeNull();
  });
});
