// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AdminCatalogView } from "../AdminCatalogModal";
import { getMenuCategories, getMenuItems } from "../../lib/menuService";

const setupDraft = vi.hoisted(() => ({ current: null }));
const setupPreset = vi.hoisted(() => ({ stage: vi.fn() }));

vi.mock("../../hooks/useCatalogSetupDraft", () => ({
  useCatalogSetupDraft: () => setupDraft.current
}));

vi.mock("../../lib/catalogSetupDraftService", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    stageCatalogSetupPreset: (...args) => setupPreset.stage(...args)
  };
});

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
  setupPreset.stage.mockReset();
  setupPreset.stage.mockResolvedValue({ ok: true, draft: { changedRecordCount: 1 } });
  setupDraft.current = {
    status: "idle",
    label: "Draft saved",
    generation: 0,
    changedRecordCount: 0,
    serverChanges: [],
    deviceChanges: [],
    changes: [],
    deviceOnly: false,
    error: "",
    receipt: null,
    queueChanges: vi.fn(() => true),
    discardDeviceChanges: vi.fn(() => true),
    syncNow: vi.fn(async () => ({ ok: true })),
    retry: vi.fn(async () => ({ ok: true })),
    review: vi.fn(async () => ({ readyToPublish: true })),
    publish: vi.fn(async () => ({ catalogRevisionAfter: 2 }))
  };
  vi.mocked(getMenuCategories).mockResolvedValue([{ id: "cat-1", eventTypeId: "evt-1", name: "Starters" }]);
  vi.mocked(getMenuItems).mockResolvedValue([]);
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
    .find((element) => element.textContent.trim() === "Sync draft now");
  expect(button, 'button "Sync draft now"').toBeTruthy();
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
  test("organizes Menu Builder as context, item list, and focused editor", async () => {
    vi.mocked(getMenuItems).mockResolvedValue([{
      id: "item-1",
      eventTypeId: "evt-1",
      categoryId: "cat-1",
      name: "Cocktail meatballs",
      price: 18,
      pricingType: "per_event",
      active: true
    }]);
    renderView({ initialTab: "menu" });

    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(container.querySelector('[aria-label="Menu context"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Menu items"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Edit Cocktail meatballs"]')).toBeTruthy();
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent)
      .toContain("Cocktail meatballs");
  });

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

  test("publishes one dismissal authority for browser traversal and explicit close", () => {
    const onDismissGuardChange = vi.fn();
    const onInteractionStateChange = vi.fn();
    const continuation = vi.fn();
    renderView({
      onSave: async () => ({ ok: true }),
      onDismissGuardChange,
      onInteractionStateChange
    });
    makeUnsavedEdit();
    const guard = onDismissGuardChange.mock.calls
      .map(([candidate]) => candidate)
      .filter(Boolean)
      .at(-1);
    expect(guard).toMatchObject({
      modelId: "catalog-editor-navigation-guard-v1",
      open: true,
      dirty: true,
      busy: false
    });

    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(guard.requestDismiss("browser_back", continuation)).toEqual({
      status: "guarded",
      reason: "dirty",
      trigger: "browser_back"
    });
    expect(continuation).not.toHaveBeenCalled();
    expect(guard.requestDismiss("browser_back", continuation)).toEqual({
      status: "dismissed",
      trigger: "browser_back"
    });
    expect(continuation).toHaveBeenCalledOnce();
    expect(onInteractionStateChange).toHaveBeenLastCalledWith({ dirty: false, busy: false });

    renderView({
      onSave: async () => ({ ok: true }),
      onDismissGuardChange,
      onInteractionStateChange,
      saving: true
    });
    const busyGuard = onDismissGuardChange.mock.calls
      .map(([candidate]) => candidate)
      .filter(Boolean)
      .at(-1);
    expect(busyGuard).toMatchObject({ open: true, busy: true });
    expect(busyGuard.requestDismiss("browser_back", continuation)).toMatchObject({
      status: "blocked",
      reason: "busy"
    });
  });

  test("confirmed dismissal clears device-only setup changes without touching server drafts", () => {
    const deviceChange = {
      collection: "settings",
      recordId: "config",
      intent: "update",
      payload: { brandName: "Private draft" }
    };
    setupDraft.current = {
      ...setupDraft.current,
      changedRecordCount: 2,
      serverChanges: [{ ...deviceChange, payload: { brandName: "Saved setup draft" } }],
      deviceChanges: [deviceChange],
      changes: [deviceChange],
      deviceOnly: true
    };
    const onDismissGuardChange = vi.fn();
    const continuation = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderView({ onDismissGuardChange });

    const guard = onDismissGuardChange.mock.calls
      .map(([candidate]) => candidate)
      .filter(Boolean)
      .at(-1);
    expect(guard).toMatchObject({ dirty: true });
    expect(guard.requestDismiss("browser_back", continuation)).toMatchObject({
      status: "dismissed"
    });
    expect(setupDraft.current.discardDeviceChanges).toHaveBeenCalledWith([deviceChange]);
    expect(continuation).toHaveBeenCalledOnce();
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
      .find((element) => element.textContent.trim() === "Sync draft now").disabled).toBe(true);
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
      .toContain("One menu edit is still in progress");
  });

  test("stages a setup preset through the shared durable draft", async () => {
    renderView({
      catalog: starterCatalog()
    });
    const applyButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Use Wedding & events");
    expect(applyButton).toBeTruthy();

    await act(async () => {
      applyButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(setupPreset.stage).toHaveBeenCalledWith({
      organizationId: "test-org",
      packId: "wedding-events",
      packVersion: 2
    });
    expect(container.querySelector(".modal-foot").textContent)
      .toContain("setup preset added to the shared draft");
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

    expect(setupDraft.current.queueChanges).toHaveBeenCalledWith([
      expect.objectContaining({
        collection: "menuItems",
        intent: "create",
        payload: expect.objectContaining({ name: "Seasonal soup" })
      })
    ]);
    expect(container.querySelector(".modal-foot").textContent)
      .toContain("Menu item added to the setup draft.");
    expect(container.querySelector(".modal-foot").textContent)
      .not.toContain("One Library edit is already in progress. Save or discard it, then try this change again. Nothing changed.");
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

  test("syncs unpublished intent without calling the retired active-catalog save", async () => {
    const onSave = vi.fn();
    renderView({ onSave });
    makeUnsavedEdit();
    await clickSave();
    expect(setupDraft.current.queueChanges).toHaveBeenCalled();
    expect(setupDraft.current.syncNow).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector(".modal-foot").textContent)
      .toContain("Active pricing is unchanged until publication");
  });

  test.each([
    ["error", { status: "error", error: "Draft validation failed." }],
    ["reconciliation", { status: "conflict", error: "Draft changed on another device." }],
    ["uncertain", { status: "sync_failed", deviceOnly: true, error: "Network unavailable." }],
    ["recovery", { status: "recovery", error: "Reload the latest catalog." }],
    ["receipt", { status: "saved", receipt: { receiptId: "publish-1" } }]
  ])("projects the draft authority %s state", (expected, nextState) => {
    setupDraft.current = { ...setupDraft.current, ...nextState };
    renderView();
    expect(container.innerHTML).toContain(`data-capability-state="${expected}"`);
  });

  test("rehydrates a device-only menu price and section move with truthful labels", async () => {
    setupDraft.current = {
      ...setupDraft.current,
      status: "sync_failed",
      label: "Sync failed — changes are device-only",
      changedRecordCount: 1,
      deviceOnly: true,
      deviceChanges: [{
        collection: "menuItems",
        recordId: "menu-a",
        intent: "update",
        payload: {
          name: "Roasted chicken",
          eventTypeId: "evt-1",
          categoryId: "cat-2",
          priceMinor: 1234,
          costMinor: 450,
          pricingType: "per_person",
          active: true
        }
      }]
    };
    setupDraft.current.changes = setupDraft.current.deviceChanges;
    vi.mocked(getMenuCategories).mockResolvedValue([
      { id: "cat-2", eventTypeId: "evt-1", name: "Specials" },
      { id: "cat-1", eventTypeId: "evt-1", name: "Starters" }
    ]);
    vi.mocked(getMenuItems).mockResolvedValue([{
      id: "menu-a",
      name: "Roasted chicken",
      eventTypeId: "evt-1",
      categoryId: "cat-1",
      price: 10,
      cost: 4,
      pricingType: "per_person",
      active: true
    }]);

    renderView({ initialTab: "menu" });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

    const itemEditor = container.querySelector('[aria-label="Edit Roasted chicken"]');
    expect(itemEditor.querySelector('input[type="number"]').value).toBe("12.34");
    expect(container.textContent).toContain("Device-only changes");
    expect(container.textContent).not.toContain("All changes saved");
  });
});
