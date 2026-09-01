// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AdminCatalogView,
  packageCatalogDependencySummary
} from "../AdminCatalogModal";
import { catalogSetupDeviceBufferKey } from "../../hooks/useCatalogSetupDraft";

vi.mock("../../lib/menuService", () => ({
  createCategory: vi.fn(async () => ({ id: "cat-1" })),
  createEventType: vi.fn(async () => ({ id: "evt-1" })),
  createMenuItem: vi.fn(async () => ({ catalogRevision: 1, id: "menu-item-1" })),
  deleteMenuItem: vi.fn(),
  getEventTypes: vi.fn(async () => [{ id: "evt-1", name: "Dinner" }]),
  getMenuCategories: vi.fn(async () => [{ id: "cat-1", name: "Starters" }]),
  getMenuItems: vi.fn(async () => [
    { id: "fruit", name: "Fresh fruit", categoryId: "cat-1", active: true },
    { id: "soup", name: "Tomato soup", categoryId: "cat-1", active: false }
  ]),
  isMenuCatalogRevisionConflict: vi.fn(() => false),
  updateCategory: vi.fn(),
  updateEventType: vi.fn(),
  updateMenuItem: vi.fn(async () => ({ catalogRevision: 1 }))
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function catalog() {
  return {
    authoritativeVersion: 1,
    packages: [
      {
        id: "classic",
        name: "Classic",
        ppp: 18,
        costPpp: 11.4,
        active: true,
        includedMenuItemIds: [],
        includedAddonIds: [],
        includedRentalIds: []
      },
      {
        id: "deluxe",
        name: "Deluxe",
        ppp: 32,
        costPpp: 19.8,
        active: true,
        includedMenuItemIds: [],
        includedAddonIds: ["dessert"],
        includedRentalIds: []
      }
    ],
    addons: [
      { id: "dessert", name: "Dessert tray", active: true, pricingType: "per_person" },
      { id: "coffee", name: "Coffee service", active: true, pricingType: "per_event" },
      { id: "retired-addon", name: "Retired add-on", active: false }
    ],
    rentals: [
      { id: "linens", name: "Table linens", active: true }
    ],
    settings: {
      pricingSetupConfirmed: true,
      catalogRevision: 7,
      menuSections: [
        {
          id: "breakfast",
          items: [
            { id: "fruit", name: "Fresh fruit", active: true },
            { id: "bagels", name: "Bagels", active: true }
          ]
        }
      ],
      eventTemplates: [
        { id: "classic-template", name: "Classic event", pkg: "classic" }
      ],
      upsellRules: [
        { id: "classic-rule", kind: "package", targetId: "classic" }
      ]
    }
  };
}

let container;
let root;

beforeEach(() => {
  localStorage.clear();
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
        onSave={async () => ({ ok: true })}
        saving={false}
        {...props}
      />
    );
  });
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButtonByText(label) {
  const button = [...container.querySelectorAll("button")]
    .find((element) => element.textContent.trim() === label);
  expect(button, `button "${label}"`).toBeTruthy();
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function packageGroup(label) {
  return [...container.querySelectorAll(".package-workspace-group-card")]
    .find((element) => element.querySelector("h5")?.textContent.trim() === label);
}

describe("Package workspace", () => {
  test("uses native list semantics for package navigation", () => {
    renderView();

    const packageList = container.querySelector(".package-workspace-nav-list");
    expect(packageList.tagName).toBe("UL");
    expect(packageList.querySelectorAll(":scope > li")).toHaveLength(2);
    expect(packageList.querySelector('button[role="listitem"]')).toBeNull();
  });

  test("keeps a package draft when switching between navigator rows", () => {
    renderView();

    const nameInput = container.querySelector('input[aria-label="Customer-facing package name"]');
    expect(nameInput.value).toBe("Classic");
    setInputValue(nameInput, "Classic Plus");

    const deluxeButton = container.querySelector('button[data-package-id="deluxe"]');
    expect(deluxeButton).toBeTruthy();
    act(() => {
      deluxeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('input[aria-label="Customer-facing package name"]').value).toBe("Deluxe");

    const classicButton = container.querySelector('button[data-package-id="classic"]');
    act(() => {
      classicButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('input[aria-label="Customer-facing package name"]').value).toBe("Classic Plus");
  });

  test("applies staged add-on selections and keeps inactive options hidden", () => {
    renderView();

    clickButtonByText("Add add-ons");
    expect(container.textContent).toContain("Coffee service");
    expect(container.textContent).not.toContain("Retired add-on");

    const checkbox = [...container.querySelectorAll('input[type="checkbox"]')]
      .find((input) => input.closest(".package-workspace-option")?.textContent.includes("Coffee service"));
    expect(checkbox).toBeTruthy();
    act(() => {
      checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(packageGroup("Add-ons").querySelector(".package-workspace-selection-list").textContent)
      .not.toContain("Coffee service");
    clickButtonByText("Apply 1 selection");
    expect(packageGroup("Add-ons").querySelector(".package-workspace-selection-list").textContent)
      .toContain("Coffee service");
    expect(packageGroup("Add-ons").textContent)
      .toContain("Selected at $0 when chosen in Quote Builder.");
  });

  test("cancels a staged selection without changing the package draft", () => {
    renderView();

    clickButtonByText("Add rentals");
    const checkbox = packageGroup("Rentals").querySelector('.package-workspace-option input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    act(() => {
      checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    clickButtonByText("Cancel");

    expect(packageGroup("Rentals").querySelector(".package-workspace-selection-list").textContent)
      .toContain("Nothing selected yet.");
    expect(packageGroup("Rentals").querySelector('[data-package-group-toggle="rentals"]')?.getAttribute("aria-expanded"))
      .toBe("false");
  });

  test("blocks activation until a package is ready and clears stale notice on revert", () => {
    renderView();

    const activeToggle = container.querySelector(".package-workspace-active-toggle input");
    expect(activeToggle.checked).toBe(true);
    act(() => {
      activeToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(activeToggle.checked).toBe(false);
    act(() => {
      activeToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(activeToggle.checked).toBe(false);
    expect(container.querySelector(".package-workspace-activation-notice").textContent)
      .toContain("Activation is blocked until this package is ready.");

    clickButtonByText("Revert this package");
    expect(activeToggle.checked).toBe(true);
    expect(container.querySelector(".package-workspace-activation-notice")).toBeNull();
  });

  test("reviews exact package dependencies before deletion", () => {
    const fixture = catalog();
    expect(packageCatalogDependencySummary(fixture, "classic")).toEqual({
      available: true,
      eventTemplateCount: 1,
      ruleCount: 1,
      total: 2
    });
    renderView({ catalog: fixture });

    clickButtonByText("Package actions");
    clickButtonByText("Delete package…");

    const review = container.querySelector('[role="alertdialog"]');
    expect(review).toBeTruthy();
    expect(review.textContent).toContain("1 event template and 1 recommendation rule");
    clickButtonByText("Keep package");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  test("reverts the selected package to the last saved catalog snapshot", () => {
    renderView();

    const nameInput = container.querySelector('input[aria-label="Customer-facing package name"]');
    setInputValue(nameInput, "Classic Plus");

    clickButtonByText("Revert this package");

    expect(container.querySelector('input[aria-label="Customer-facing package name"]').value).toBe("Classic");
    expect(localStorage.getItem(catalogSetupDeviceBufferKey("test-org"))).toBeNull();
    expect(container.querySelector(".modal-foot").textContent).toContain("reverted to the last saved catalog state");
  });
});
