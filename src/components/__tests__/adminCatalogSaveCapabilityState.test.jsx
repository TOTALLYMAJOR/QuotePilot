// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AdminCatalogView } from "../AdminCatalogModal";
import { getEventTypes, getMenuCategories, getMenuItems } from "../../lib/menuService";

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
  vi.mocked(getEventTypes).mockResolvedValue([{ id: "evt-1", name: "Dinner" }]);
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
    .find((input) => input.getAttribute("aria-label") === "Offer 1 active");
  expect(checkbox, "Offer 1 active checkbox").toBeTruthy();
  act(() => {
    checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function clickSave() {
  const button = [...container.querySelectorAll("button")]
    .find((element) => element.textContent.trim() === "Save draft now");
  expect(button, 'button "Save draft now"').toBeTruthy();
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

  test("keeps a dirty recipe mounted by locking every menu-context control until recovery", async () => {
    vi.mocked(getEventTypes).mockResolvedValue([
      { id: "evt-1", name: "Dinner" },
      { id: "evt-2", name: "Reception" }
    ]);
    vi.mocked(getMenuCategories).mockImplementation(async (eventTypeId) => eventTypeId === "evt-2"
      ? [{ id: "cat-3", eventTypeId: "evt-2", name: "Canapes" }]
      : [
          { id: "cat-1", eventTypeId: "evt-1", name: "Entrees" },
          { id: "cat-2", eventTypeId: "evt-1", name: "Desserts" }
        ]);
    vi.mocked(getMenuItems).mockImplementation(async (eventTypeId) => eventTypeId === "evt-2"
      ? [{ id: "item-3", eventTypeId: "evt-2", categoryId: "cat-3", name: "Bruschetta", price: 8, active: true }]
      : [
          { id: "item-1", eventTypeId: "evt-1", categoryId: "cat-1", name: "Chicken Alfredo", price: 18, active: true },
          { id: "item-2", eventTypeId: "evt-1", categoryId: "cat-1", name: "Pasta Primavera", price: 16, active: true },
          { id: "item-4", eventTypeId: "evt-1", categoryId: "cat-2", name: "Tiramisu", price: 9, active: true }
        ]);
    const onEventTypeChange = vi.fn();
    const publishRecipe = vi.fn(async () => {
      throw Object.assign(new Error("Catalog revision changed."), {
        inventoryDefinitive: true,
        inventoryAttempt: { requestId: "recipe-rejected-1" }
      });
    });
    const resetRecipe = vi.fn(async () => ({ state: "idle" }));
    const recipeExtension = (recipeRevision = 1, outputYield = "10") => ({
      enabled: true,
      ingredients: [{ ingredientId: "chicken", name: "Chicken", baseUnitId: "lb" }],
      ingredientSourceState: "current",
      activeMenuItemId: "item-1",
      activeMenuCostProjectionState: "current",
      recipesByMenuItemId: {
        "item-1": {
          menuItemId: "item-1",
          recipeRevision,
          outputYield,
          outputUnitId: "portion",
          lines: [{ lineId: "line-chicken", ingredientId: "chicken", quantity: "2", unitKind: "standard", unitId: "lb", quantityBasis: "as_purchased" }]
        }
      },
      menuCostProjectionsByMenuItemId: {
        "item-1": {
          menuItemId: "item-1",
          state: "complete",
          projectedIngredientCostDisplay: "$6.00",
          costPerYieldUnitDisplay: "$0.60",
          recipeDefinition: { outputUnitId: "portion" }
        }
      },
      publishRecipe,
      resetRecipe
    });
    const renderRecipeView = (inventoryRecipeExtension) => renderView({
      initialTab: "menu",
      onEventTypeChange,
      catalog: {
        ...catalog(),
        source: "firebase",
        settings: { ...catalog().settings, catalogRevision: 1 }
      },
      inventoryRecipeExtension
    });
    renderRecipeView(recipeExtension());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

    const alternateSelection = container.querySelector('input[aria-label="Select Pasta Primavera"]');
    act(() => alternateSelection.click());
    const recipeYield = container.querySelector('[data-inventory-recipe-editor] fieldset input[inputmode="decimal"]');
    setInputValue(recipeYield, "12");
    await act(async () => Promise.resolve());

    const eventType = container.querySelector('[data-choice-field="catalog-event-type"] select');
    const menuSection = container.querySelector('[data-choice-field="catalog-menu-section"] select');
    const search = container.querySelector('input[type="search"][placeholder="Search by name"]');
    const availabilityFilter = container.querySelector(".admin-menu-availability-filter input");
    const alternateItem = [...container.querySelectorAll(".admin-menu-item-choice")]
      .find((button) => button.textContent.includes("Pasta Primavera"));
    const lockMessage = container.querySelector("#inventory-recipe-context-lock");

    expect(lockMessage?.textContent).toContain("Publish or discard recipe changes");
    expect(lockMessage?.textContent).toContain("recovery actions remain available");
    expect(eventType.disabled).toBe(true);
    expect(menuSection.disabled).toBe(true);
    expect(search.disabled).toBe(true);
    expect(availabilityFilter.disabled).toBe(true);
    expect(alternateItem.disabled).toBe(true);
    expect(alternateSelection.disabled).toBe(true);
    expect(container.querySelector(".admin-menu-item-fields input").disabled).toBe(true);
    expect([...container.querySelectorAll(".admin-menu-bulk-bar button")].every((button) => button.disabled)).toBe(true);
    expect(search.getAttribute("aria-describedby")).toBe("inventory-recipe-context-lock");
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Discard recipe changes")?.disabled).toBe(false);

    // Defense in depth: even if a host removes the DOM disabled property, the
    // route handler must refuse a context change and preserve the recipe draft.
    const eventTypeChangeCount = onEventTypeChange.mock.calls.length;
    eventType.disabled = false;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(eventType, "evt-2");
      eventType.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onEventTypeChange).toHaveBeenCalledTimes(eventTypeChangeCount);
    expect(container.querySelector("[data-inventory-recipe-editor]")?.dataset.menuItemId).toBe("item-1");
    expect(container.querySelector('[data-inventory-recipe-editor] fieldset input[inputmode="decimal"]').value).toBe("12");

    act(() => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Discard recipe changes")
        .click();
    });
    expect(container.querySelector("#inventory-recipe-context-lock")).toBeNull();
    expect(container.querySelector('[data-choice-field="catalog-event-type"] select').disabled).toBe(false);
    expect(container.querySelector('input[type="search"][placeholder="Search by name"]').disabled).toBe(false);

    setInputValue(container.querySelector('[data-inventory-recipe-editor] fieldset input[inputmode="decimal"]'), "13");
    const publishRecipeButton = container.querySelector('[data-inventory-recipe-editor] button[type="submit"]');
    expect(
      publishRecipeButton.disabled,
      container.querySelector("[data-recipe-publish-disabled]")?.textContent || "recipe publish should be enabled"
    ).toBe(false);
    await act(async () => publishRecipeButton.click());
    expect(container.querySelector("[data-recipe-operation-state='rejected']")).not.toBeNull();

    renderRecipeView(recipeExtension(2, "14"));
    await act(async () => Promise.resolve());
    act(() => [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Use current recipe"))?.click());
    expect(container.querySelector('[data-inventory-recipe-editor] fieldset input[inputmode="decimal"]').value).toBe("14");
    expect(container.querySelector("#inventory-recipe-context-lock")?.textContent)
      .toContain("Finish the current recipe outcome review");
    expect(container.querySelector('input[type="search"][placeholder="Search by name"]').disabled).toBe(true);

    await act(async () => [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Review and retry"))?.click());
    expect(resetRecipe).toHaveBeenCalledWith({ requestId: "recipe-rejected-1" });
    expect(container.querySelector("#inventory-recipe-context-lock")).toBeNull();
  });

  test("starts ready with no unsaved changes and no message", () => {
    renderView({ onSave: async () => ({ ok: true }) });
    expect(container.innerHTML).toContain('data-capability-state="ready"');
  });

  test("moves between Library sections with standard tab keys", () => {
    renderView();
    const offers = container.querySelector('[data-admin-tab-id="packages"]');
    const addons = container.querySelector('[data-admin-tab-id="addons"]');
    act(() => {
      offers.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(addons.getAttribute("aria-selected")).toBe("true");

    act(() => {
      addons.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(offers.getAttribute("aria-selected")).toBe("true");
  });

  test("edits the authoritative rule JSON source through structured controls", () => {
    renderView({
      initialTab: "rules",
      catalog: {
        ...catalog(),
        settings: {
          ...catalog().settings,
          configurationRules: [{
            id: "large-event-staffing",
            type: "requirement",
            conditions: [{
              path: "event.guests",
              operator: "gte",
              value: 100,
              futureConditionField: "preserve"
            }],
            effect: {
              operator: "require",
              target: "resources.servers",
              value: 4,
              futureEffectField: "preserve"
            },
            reason: "Large events need coverage.",
            futureRuleField: "preserve"
          }]
        }
      }
    });

    const editor = container.querySelector('[data-configuration-rule-editor="0"]');
    act(() => editor.querySelector("summary").click());
    const operator = editor.querySelector('[aria-label="Rule 1 condition 1 operator"]');
    act(() => {
      operator.value = "lte";
      operator.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const source = container.querySelector("[data-configuration-rules-editor]").value;
    const [updated] = JSON.parse(source);
    expect(updated.conditions[0]).toMatchObject({
      operator: "lte",
      futureConditionField: "preserve"
    });
    expect(updated.effect.futureEffectField).toBe("preserve");
    expect(updated.futureRuleField).toBe("preserve");
    expect(container.querySelector(".modal-foot").textContent)
      .toContain("Quote rule updated in this Library draft.");
  });

  test("opening Advanced policy keeps its business groups collapsed and fields singular", () => {
    renderView({ initialTab: "pricing" });
    const advanced = container.querySelector('[data-pricing-policy-group="advanced"]');
    expect(advanced.open).toBe(false);
    act(() => advanced.querySelector(":scope > summary").click());
    expect(advanced.open).toBe(true);

    const childGroups = [...advanced.querySelectorAll("[data-pricing-policy-advanced-section]")];
    expect(childGroups.length).toBeGreaterThanOrEqual(7);
    childGroups.forEach((group) => expect(group.open).toBe(false));

    const labelCount = (copy) => [...advanced.querySelectorAll("label")]
      .filter((label) => label.textContent.includes(copy)).length;
    expect(labelCount("Retry limit")).toBe(1);
    expect(labelCount("Enable guided selling recommendations")).toBe(1);
    expect(labelCount("Quote prepared by")).toBe(1);
    expect(labelCount("Business name")).toBe(1);
    expect(labelCount("Event Templates JSON")).toBe(1);
  });

  test("keeps an edited component draft when its object and collection disclosures change", () => {
    renderView({
      initialTab: "addons",
      catalog: {
        ...catalog(),
        addons: [{
          id: "coffee-service",
          name: "Coffee service",
          pricingType: "per_event",
          type: "per_event",
          price: 125,
          active: true
        }],
        rentals: [{
          id: "linen-set",
          name: "Linen set",
          pricingType: "per_item",
          type: "per_item",
          price: 12,
          qtyPerGuests: 8,
          active: true
        }]
      }
    });

    const component = container.querySelector('[data-commercial-component-id="coffee-service"]');
    const summary = component.querySelector("summary");
    act(() => summary.click());
    expect(component.open).toBe(true);

    const nameInput = component.querySelector('[aria-label="Add-on 1 display name"]');
    setInputValue(nameInput, "Espresso service");
    expect(nameInput.value).toBe("Espresso service");

    act(() => container.querySelector('[data-admin-tab-id="rentals"]').click());
    expect(container.querySelector('[data-commercial-component-id="linen-set"]')).toBeTruthy();
    act(() => container.querySelector('[data-admin-tab-id="addons"]').click());

    expect(container.querySelector('[aria-label="Add-on 1 display name"]').value)
      .toBe("Espresso service");
    expect(container.textContent).toContain("Espresso service");
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
      .find((input) => input.getAttribute("aria-label") === "Offer 1 active");
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
      .find((element) => element.textContent.trim() === "Save draft now").disabled).toBe(true);
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
      .find((button) => button.textContent.trim() === "Offers");
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
    expect(container.textContent).toContain("Changes waiting to save");
    expect(container.textContent).toContain("Library changes are waiting to save");
    expect(container.textContent).toContain("cannot be published yet");
    expect(container.textContent).not.toContain("All changes saved");
  });
});
