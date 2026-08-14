// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AdminCatalogView } from "../AdminCatalogModal";
import { createMenuItem as createMenuItemMock } from "../../lib/menuService";

vi.mock("../../lib/menuService", () => ({
  createCategory: vi.fn(async () => ({ id: "cat-1" })),
  createEventType: vi.fn(async () => ({ id: "evt-1" })),
  createMenuItem: vi.fn(async () => ({ catalogRevision: 1, id: "menu-item-1" })),
  deleteMenuItem: vi.fn(),
  getEventTypes: vi.fn(async () => [{ id: "evt-1", name: "Dinner" }]),
  getMenuCategories: vi.fn(async () => [{ id: "cat-1", name: "Starters" }]),
  getMenuItems: vi.fn(async () => []),
  isMenuCatalogRevisionConflict: vi.fn(() => false),
  updateCategory: vi.fn(),
  updateEventType: vi.fn(),
  updateMenuItem: vi.fn(async () => ({ catalogRevision: 1 }))
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function catalog() {
  return {
    authoritativeVersion: 1,
    packages: [{ id: "classic", name: "Classic", ppp: 20, active: true }],
    addons: [],
    rentals: [],
    settings: { pricingSetupConfirmed: true }
  };
}

function starterCatalog() {
  return {
    packages: [],
    addons: [],
    rentals: [],
    settings: {
      pricingSetupConfirmed: false
    }
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

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AdminCatalogModal save capability state", () => {
  test("starts ready with no unsaved changes and no message", () => {
    renderView({ onSave: async () => ({ ok: true }) });
    expect(container.innerHTML).toContain('data-capability-state="ready"');
  });

  test("reports dirty state and clears it after confirmed discard", () => {
    const onInteractionStateChange = vi.fn();
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderView({ onSave: async () => ({ ok: true }), onInteractionStateChange, onClose });
    makeUnsavedEdit();
    expect(onInteractionStateChange).toHaveBeenLastCalledWith({ dirty: true, busy: false });

    const back = [...container.querySelectorAll("button")]
      .find((element) => element.textContent.trim() === "Back to Home");
    act(() => back.click());

    expect(onInteractionStateChange).toHaveBeenLastCalledWith({ dirty: false, busy: false });
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("preserves a dirty draft when newer catalog evidence arrives", () => {
    const onInteractionStateChange = vi.fn();
    renderView({ onSave: async () => ({ ok: true }), onInteractionStateChange });
    makeUnsavedEdit();
    const changedCheckbox = [...container.querySelectorAll('input[type="checkbox"]')]
      .find((input) => input.getAttribute("aria-label") === "Package 1 active");
    expect(changedCheckbox.checked).toBe(false);

    renderView({
      catalog: {
        ...catalog(),
        authoritativeVersion: 2,
        settings: { pricingSetupConfirmed: true, catalogRevision: 2 }
      },
      onSave: async () => ({ ok: true }),
      onInteractionStateChange
    });

    expect(changedCheckbox.checked).toBe(false);
    expect(container.querySelector(".modal-foot").textContent)
      .toContain("A newer Library version is ready");
    expect([...container.querySelectorAll("button")]
      .find((element) => element.textContent.trim() === "Save catalog changes").disabled).toBe(true);
    expect(onInteractionStateChange).toHaveBeenLastCalledWith({ dirty: true, busy: false });
  });

  test("reports a typed managed-menu draft as unsaved and protects close", async () => {
    const onInteractionStateChange = vi.fn();
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderView({
      initialTab: "menu",
      onSave: async () => ({ ok: true }),
      onInteractionStateChange,
      onClose
    });
    await act(async () => Promise.resolve());
    const input = container.querySelector('input[aria-label="New menu item name"]');
    expect(input).toBeTruthy();
    setInputValue(input, "Seasonal soup");

    expect(onInteractionStateChange).toHaveBeenLastCalledWith({ dirty: true, busy: false });
    const back = [...container.querySelectorAll("button")]
      .find((element) => element.textContent.trim() === "Back to Home");
    act(() => back.click());
    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved catalog, menu, and branding changes?");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("keeps the main catalog save from closing over a separate managed-menu draft", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    renderView({ onSave });
    makeUnsavedEdit();
    const menuTab = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Menu");
    act(() => menuTab.click());
    await act(async () => Promise.resolve());
    const input = container.querySelector('input[aria-label="New menu item name"]');
    setInputValue(input, "Seasonal soup");

    await clickSave();

    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector(".modal-foot").textContent)
      .toContain("Finish or discard the separate menu edits first");
  });

  test("opens manual setup when a starter pack is blocked by existing catalog content", async () => {
    renderView({
      catalog: starterCatalog(),
      onApplyStarterPack: async () => ({
        ok: false,
        error: "This organization already has catalog content. Choose replacement only for an untouched staged pack."
      })
    });
    const applyButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Use Wedding & events");
    expect(applyButton).toBeTruthy();

    await act(async () => {
      applyButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.querySelector(".modal-foot").textContent).toContain(
      "Manual catalog setup has been opened so you can continue editing."
    );
    expect([...container.querySelectorAll("button")]
      .some((button) => button.textContent.trim() === "Packages")).toBe(true);
  });

  test("allows adding a menu item while a separate package catalog draft is pending", async () => {
    const onCatalogMutation = vi.fn();
    renderView({
      initialTab: "menu",
      onCatalogMutation
    });
    const packagesTab = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Packages");
    expect(packagesTab).toBeTruthy();
    act(() => packagesTab.click());
    await act(async () => Promise.resolve());
    makeUnsavedEdit();
    const menuTab = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Menu");
    act(() => menuTab.click());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const input = container.querySelector('input[aria-label="New menu item name"]');
    expect(input).toBeTruthy();
    setInputValue(input, "Seasonal soup");

    const addItem = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Add Item");
    expect(addItem, "add item button").toBeTruthy();
    expect(addItem.disabled).toBe(false);

    await act(async () => {
      addItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(createMenuItemMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".modal-foot").textContent)
      .toContain("Menu item added.");
    expect(container.querySelector(".modal-foot").textContent)
      .not.toContain("Finish or discard your other Library edits before making this saved change. Nothing changed.");
  });

  test("preserves a managed rename across newer evidence and discards it only after confirmation", async () => {
    const onInteractionStateChange = vi.fn();
    renderView({
      initialTab: "menu",
      onSave: async () => ({ ok: true }),
      onInteractionStateChange
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    const renameInput = container.querySelector('input[aria-label="New event type name"]');
    expect(renameInput).toBeTruthy();
    setInputValue(renameInput, "Seasonal celebrations");

    renderView({
      catalog: {
        ...catalog(),
        authoritativeVersion: 2,
        settings: { pricingSetupConfirmed: true, catalogRevision: 2 }
      },
      initialTab: "menu",
      onSave: async () => ({ ok: true }),
      onInteractionStateChange
    });
    await act(async () => Promise.resolve());

    expect(container.querySelector('input[aria-label="New event type name"]').value)
      .toBe("Seasonal celebrations");
    expect(container.querySelector(".modal-foot").textContent)
      .toContain("A newer Library version is ready");

    vi.spyOn(window, "confirm").mockReturnValue(true);
    const refresh = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Refresh latest catalog");
    expect(refresh).toBeTruthy();
    await act(async () => {
      refresh.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('input[aria-label="New event type name"]').value).toBe("");
    expect(container.querySelector(".modal-foot").textContent)
      .toContain("latest Library version is loaded");
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
