// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import AmbientOperationalReceipts from "../AmbientOperationalReceipts";
import { buildAmbientOperationalReceipts } from "../../lib/ambientOperationalReceipts";

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

function render(model) {
  act(() => root.render(<AmbientOperationalReceipts model={model} />));
}

describe("AmbientOperationalReceipts", () => {
  test("renders six separate accepted and booked evidence domains without inventing controls", () => {
    render(buildAmbientOperationalReceipts({
      id: "quote-booked-ui",
      status: "booked",
      lifecycle: {
        acceptedAtISO: "2026-08-01T15:00:00.000Z",
        bookedAtISO: "2026-08-02T15:00:00.000Z"
      },
      acceptanceReceipt: {
        receiptId: "acceptance-ui-1",
        quoteRevisionId: "revision-ui-1",
        acceptedAtISO: "2026-08-01T15:00:00.000Z"
      },
      booking: {
        contractNumber: "QP-UI-1",
        contractConvertedAtISO: "2026-08-02T15:00:00.000Z"
      },
      payment: {
        depositStatus: "paid",
        depositConfirmedAtISO: "2026-08-03T15:00:00.000Z",
        finalBalance: { status: "unpaid" }
      }
    }, { role: "admin" }));

    const surface = container.querySelector('[data-surface-contract-id="ambient-operational-receipts"]');
    expect(surface).not.toBeNull();
    expect(surface.dataset.surfacePurpose).toContain("reveal_context");
    expect(container.querySelectorAll("[data-operational-receipt]")).toHaveLength(6);
    expect(container.textContent).toContain("Exact customer acceptance is recorded");
    expect(container.textContent).toContain("Deposit is recorded; final settlement remains open");
    expect(container.textContent).toContain("Resolve payment evidence");
    expect(container.querySelector("button")).toBeNull();
  });

  test("does not add post-acceptance chrome to a draft opportunity", () => {
    render(buildAmbientOperationalReceipts({ id: "quote-draft-ui", status: "draft" }, { role: "admin" }));
    expect(container.innerHTML).toBe("");
  });
});
