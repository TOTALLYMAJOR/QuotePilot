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

function packageSection(sectionId) {
  return container.querySelector(`[data-package-section="${sectionId}"]`);
}

function openPackageSection(sectionId) {
  const section = packageSection(sectionId);
  expect(section, `package section "${sectionId}"`).toBeTruthy();
  act(() => {
    section.open = true;
    section.dispatchEvent(new Event("toggle", { bubbles: false }));
  });
  return section;
}

describe("Offer package workspace", () => {
  test("uses native list semantics for the compact offer navigation", () => {
    renderView();

    const packageList = container.querySelector(".package-workspace-nav-list");
    expect(packageList.tagName).toBe("UL");
    expect(packageList.querySelectorAll(":scope > li")).toHaveLength(2);
    expect(packageList.querySelector('button[role="listitem"]')).toBeNull();
    expect(container.querySelector('.package-workspace-nav[aria-label="Offer list"]')).toBeTruthy();
    expect(container.textContent).toContain("Customer-ready catering packages");
    expect(container.querySelector('.package-workspace-mobile-switcher select[aria-label="Choose offer"]')).toBeTruthy();
  });

  test("shows a sole offer as confirmed read-only instead of a false mobile selector", () => {
    const fixture = catalog();
    fixture.packages = [fixture.packages[0]];
    renderView({ catalog: fixture });

    const switcher = container.querySelector(".package-workspace-mobile-switcher");
    expect(switcher.dataset.adaptiveChoiceMode).toBe("single");
    expect(switcher.querySelector("select")).toBeNull();
    expect(switcher.querySelector('[data-field-state-primary="confirmed"]')).toBeTruthy();
  });

  test("shows a sole menu event type as read-only after applying the presentation filter", async () => {
    renderView();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const filter = container.querySelector('[data-package-field="eventTypeFilter"]');
    expect(filter.querySelector('[data-adaptive-choice-mode="single"]')).toBeTruthy();
    expect(filter.querySelector("select")).toBeNull();
    expect(filter.textContent).toContain("Dinner");
  });

  test("explains how to recover when no menu event types are active", async () => {
    const menuService = await import("../../lib/menuService");
    menuService.getEventTypes.mockResolvedValueOnce([]);
    renderView();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const filter = container.querySelector('[data-package-field="eventTypeFilter"]');
    expect(filter.querySelector("select")).toBeNull();
    expect(filter.querySelector('[data-field-state-primary="not_provided"]')).toBeTruthy();
    expect(filter.textContent).toContain("Add or activate one in the Menu area");
  });

  test("keeps a package draft when switching between navigator rows", () => {
    renderView();

    const nameInput = container.querySelector('input[aria-label="Customer-facing offer name"]');
    expect(nameInput.value).toBe("Classic");
    setInputValue(nameInput, "Classic Plus");

    const deluxeButton = container.querySelector('button[data-package-id="deluxe"]');
    expect(deluxeButton).toBeTruthy();
    act(() => {
      deluxeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('input[aria-label="Customer-facing offer name"]').value).toBe("Deluxe");

    const classicButton = container.querySelector('button[data-package-id="classic"]');
    act(() => {
      classicButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('input[aria-label="Customer-facing offer name"]').value).toBe("Classic Plus");
  });

  test("applies staged add-on selections and keeps inactive options hidden", () => {
    renderView();

    const included = openPackageSection("included");
    clickButtonByText("Add add-ons");
    expect(container.textContent).toContain("Coffee service");
    expect(container.textContent).not.toContain("Retired add-on");

    const checkbox = [...container.querySelectorAll('input[type="checkbox"]')]
      .find((input) => input.closest(".package-workspace-option")?.textContent.includes("Coffee service"));
    expect(checkbox).toBeTruthy();
    act(() => {
      checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      included.open = false;
      included.dispatchEvent(new Event("toggle", { bubbles: false }));
      included.open = true;
      included.dispatchEvent(new Event("toggle", { bubbles: false }));
    });
    expect(checkbox.checked).toBe(true);

    expect(packageGroup("Add-ons").querySelector(".package-workspace-selection-list").textContent)
      .not.toContain("Coffee service");
    clickButtonByText("Apply 1 selection");
    expect(packageGroup("Add-ons").querySelector(".package-workspace-selection-list").textContent)
      .toContain("Coffee service");
    expect(packageGroup("Add-ons").textContent)
      .toContain("Included in the offer when chosen in a quote.");
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

  test("shows a sole picker category as context instead of a no-op filter", async () => {
    renderView();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    clickButtonByText("Add rentals");
    const category = packageGroup("Rentals").querySelector(".package-workspace-search[data-adaptive-choice-mode]");
    expect(category?.dataset.adaptiveChoiceMode).toBe("single");
    expect(category?.textContent).toContain("Rentals");
    expect(category?.querySelector("select")).toBeNull();
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
      .toContain("This offer cannot be made available yet.");

    clickButtonByText("Revert this offer");
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

    clickButtonByText("Offer actions");
    clickButtonByText("Delete offer…");

    const review = container.querySelector('[role="alertdialog"]');
    expect(review).toBeTruthy();
    expect(review.textContent).toContain("1 event template and 1 recommendation rule");
    clickButtonByText("Keep offer");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  test("reverts the selected package to the last saved catalog snapshot", () => {
    renderView();

    const nameInput = container.querySelector('input[aria-label="Customer-facing offer name"]');
    setInputValue(nameInput, "Classic Plus");

    clickButtonByText("Revert this offer");

    expect(container.querySelector('input[aria-label="Customer-facing offer name"]').value).toBe("Classic");
    expect(localStorage.getItem(catalogSetupDeviceBufferKey("test-org"))).toBeNull();
    expect(container.querySelector(".modal-foot").textContent).toContain("reverted to the last saved catalog state");
  });

  test("keeps identity, commercial summary, and next decision visible above supported offer sections", () => {
    renderView();

    const workspace = container.querySelector(".package-workspace-shell");
    expect(workspace.children).toHaveLength(2);
    expect(container.querySelector(".package-workspace-health-desktop")).toBeNull();
    expect(container.querySelector("[data-package-health]").textContent).toContain("Next decision");
    expect(container.querySelector(".package-workspace-overview").textContent).toContain("Classic");
    expect(container.querySelector(".package-workspace-primary-summary").textContent).toContain("$18.00");
    expect(container.querySelector(".package-workspace-primary-summary").textContent).toContain("Available");

    const disclosures = [...container.querySelectorAll(".package-workspace-object-section")];
    expect(disclosures.map((disclosure) => disclosure.dataset.packageSection)).toEqual([
      "basics",
      "included",
      "pricing",
      "usage",
      "advanced"
    ]);
    expect(disclosures.every((disclosure) => disclosure.open === false)).toBe(true);
    expect(packageSection("included").querySelector("summary").textContent).toContain("0 included items");
    expect(packageSection("pricing").querySelector("summary").textContent).toContain("margin");
    expect(packageSection("usage").querySelector("summary").textContent).toContain("1 template");
    expect(packageSection("options")).toBeNull();
  });

  test("opens collapsed pricing before focusing a cost action", async () => {
    const fixture = catalog();
    fixture.packages[0].costPpp = null;
    renderView({ catalog: fixture });

    const pricing = packageSection("pricing");
    expect(pricing.open).toBe(false);
    clickButtonByText("Record package cost");
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(pricing.open).toBe(true);
    expect(document.activeElement.getAttribute("aria-label")).toBe("Cost per person");
  });

  test("projects recorded choice groups without exposing unsupported authoring", () => {
    const fixture = catalog();
    fixture.packages[0].choiceGroups = [{
      id: "meal-selection-internal",
      label: "Choose a starter",
      componentType: "menu_item",
      componentIds: ["fruit", "missing-choice-internal"],
      minChoices: 1,
      maxChoices: 2
    }];
    renderView({ catalog: fixture });

    const choices = packageSection("choices");
    expect(choices.open).toBe(false);
    expect(choices.querySelector("summary").textContent).toContain("1 customer choice group");
    expect(choices.querySelector("summary").textContent).toContain("1 issue");
    openPackageSection("choices");
    expect(choices.textContent).toContain("Choose a starter");
    expect(choices.textContent).toContain("Choose at least 1 and no more than 2");
    expect(choices.textContent).toContain("Fresh fruit");
    expect(choices.textContent).toContain("Unavailable menu item");
    expect(choices.textContent).not.toContain("missing-choice-internal");
    expect(choices.querySelector("input, select, button")).toBeNull();
  });

  test("presents linked configuration rules by business meaning and flags unavailable references", () => {
    const fixture = catalog();
    fixture.packages[0].ruleRefs = ["large-event-staffing", "missing-internal-rule-id"];
    fixture.settings.configurationRules = [{
      id: "large-event-staffing",
      type: "requirement",
      reason: "Large events require confirmed server coverage.",
      enabled: true
    }];
    renderView({ catalog: fixture });

    const rules = openPackageSection("rules");
    expect(rules.querySelector("summary").textContent).toContain("2 linked rules");
    expect(rules.querySelector("summary").textContent).toContain("1 issue");
    expect(rules.textContent).toContain("Large events require confirmed server coverage.");
    expect(rules.textContent).not.toContain("missing-internal-rule-id");

    expect(rules.textContent).toContain("Unavailable linked rule");
    expect(rules.querySelector("input, select, button")).toBeNull();
  });

  test("keeps record identifiers in advanced details and out of the primary offer flow", () => {
    const fixture = catalog();
    fixture.packages = [{
      ...fixture.packages[0],
      id: "offer-record-9281",
      name: "Wedding dinner"
    }];
    fixture.settings.eventTemplates = [{
      id: "template-internal-441",
      name: "Wedding reception",
      pkg: "offer-record-9281"
    }];
    renderView({ catalog: fixture });

    const primarySections = [
      container.querySelector(".package-workspace-overview"),
      packageSection("basics"),
      packageSection("included"),
      packageSection("pricing"),
      packageSection("usage")
    ].filter(Boolean);
    expect(primarySections.every((section) => !section.textContent.includes("offer-record-9281"))).toBe(true);
    expect(packageSection("usage").textContent).toContain("Wedding reception");
    expect(packageSection("advanced").textContent).toContain("offer-record-9281");
  });
});
