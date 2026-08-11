// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AdminCatalogView } from "../AdminCatalogModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function catalog() {
  return {
    packages: [{ id: "classic", name: "Classic", ppp: 20, active: true }],
    addons: [],
    rentals: [],
    settings: { pricingSetupConfirmed: true }
  };
}

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

function renderView(props = {}) {
  act(() => {
    root.render(
      <AdminCatalogView
        open
        catalog={catalog()}
        organizationId="test-org"
        onClose={() => {}}
        onApplyStarterPack={async () => ({ ok: true })}
        saving={false}
        {...props}
      />
    );
  });
}

// Toggling the only package's Active checkbox is a click-based, controlled-input-safe
// way to create a real draft/saved diff (hasUnsavedChanges) without fighting React's
// native-setter tracking on text/number inputs.
function makeUnsavedEdit() {
  const checkbox = [...container.querySelectorAll('input[type="checkbox"]')]
    .find((input) => input.getAttribute("aria-label") === "Package 1 active");
  expect(checkbox, "Package 1 active checkbox").toBeTruthy();
  act(() => {
    checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function clickSave() {
  const button = [...container.querySelectorAll("button")]
    .find((element) => element.textContent.trim() === "Save catalog changes");
  expect(button, 'button "Save catalog changes"').toBeTruthy();
  return act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("AdminCatalogModal save capability state", () => {
  test("starts ready with no unsaved changes and no message", () => {
    renderView({ onSave: async () => ({ ok: true }) });
    expect(container.innerHTML).toContain('data-capability-state="ready"');
  });

  test("reflects submitting while the parent-owned saving prop is true", () => {
    renderView({ onSave: async () => ({ ok: true }), saving: true });
    expect(container.innerHTML).toContain('data-capability-state="submitting"');
  });

  test("lands on receipt after a clean save", async () => {
    renderView({ onSave: async () => ({ ok: true }) });
    makeUnsavedEdit();
    await clickSave();
    expect(container.innerHTML).toContain('data-capability-state="receipt"');
    expect(container.querySelector(".modal-foot").textContent).toContain("Catalog saved.");
  });

  test("reports a plain validation error as error, distinct from a conflict", async () => {
    renderView({
      onSave: async () => ({
        ok: false,
        error: "Add at least one specifically named package with a price above $0 before saving the catalog."
      })
    });
    makeUnsavedEdit();
    await clickSave();
    expect(container.innerHTML).toContain('data-capability-state="error"');
  });

  test("reports a reconciled concurrent-edit conflict as reconciliation", async () => {
    renderView({
      onSave: async () => ({
        ok: false,
        error: "Catalog changed while the save was in progress. Latest catalog state is loaded; review it and retry. (Catalog revision changed from 3 to 4.)"
      })
    });
    makeUnsavedEdit();
    await clickSave();
    expect(container.innerHTML).toContain('data-capability-state="reconciliation"');
  });

  test("reports a saved-but-unconfirmed revision as uncertain", async () => {
    renderView({
      onSave: async () => ({
        ok: false,
        error: "Catalog changes are saved at revision 4, but pricing is not confirmed for that revision. Latest catalog state is loaded; review Pricing and retry."
      })
    });
    makeUnsavedEdit();
    await clickSave();
    expect(container.innerHTML).toContain('data-capability-state="uncertain"');
  });

  test("offers recovery and its refresh action when reload itself failed", async () => {
    renderView({
      onSave: async () => ({
        ok: false,
        error: "Failed to save catalog. Refresh the latest catalog before retrying.",
        refreshRequired: true
      })
    });
    makeUnsavedEdit();
    await clickSave();
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    expect([...container.querySelectorAll("button")].some(
      (button) => button.textContent.trim() === "Refresh latest catalog"
    )).toBe(true);
  });

  test("recovery takes priority over a co-occurring reconciliation-shaped message", async () => {
    // The two flags can theoretically both be present; recovery (a concrete,
    // actionable "refresh now" affordance) should win over merely descriptive
    // reconciliation/uncertain text, since it is the one with a real next step.
    const onSave = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: "Catalog changed while the save was in progress. Latest catalog state is loaded; review it and retry.",
        refreshRequired: true
      });
    renderView({ onSave });
    makeUnsavedEdit();
    await clickSave();
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
  });
});
