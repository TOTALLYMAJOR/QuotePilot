// @vitest-environment jsdom

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EventTemplatesEditor } from "../EventTemplatesEditor";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TEMPLATE = Object.freeze({
  id: "wedding",
  name: "Wedding",
  style: "Plated",
  hours: 6,
  pkg: "deluxe",
  eventTypeId: "wedding",
  addons: [],
  rentals: ["linens"],
  menuItems: ["salad"],
  milesRT: 28,
  customTenantField: "preserve-me"
});

const BASE_PROPS = Object.freeze({
  templates: [TEMPLATE],
  eventTypes: [
    { id: "wedding", name: "Wedding" },
    { id: "corporate", name: "Corporate" }
  ],
  packages: [{ id: "deluxe", name: "Deluxe", active: true }],
  addons: [{ id: "coffee", name: "Coffee service", active: true }],
  rentals: [{ id: "linens", name: "Linens", active: true }],
  menuSections: [{
    id: "dinner",
    eventTypeId: "wedding",
    items: [{ id: "salad", name: "Garden salad", active: true }]
  }]
});

let container;
let root;
let originalRequestAnimationFrame;
let originalCancelAnimationFrame;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  originalRequestAnimationFrame = window.requestAnimationFrame;
  originalCancelAnimationFrame = window.cancelAnimationFrame;
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  window.cancelAnimationFrame = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.cancelAnimationFrame = originalCancelAnimationFrame;
});

function renderEditor(overrides = {}) {
  const props = { ...BASE_PROPS, onChange: vi.fn(), ...overrides };
  act(() => root.render(<EventTemplatesEditor {...props} />));
  return props;
}

function renderControlledEditor(overrides = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [controlledTemplates, setControlledTemplates] = React.useState(overrides.templates || BASE_PROPS.templates);
    return (
      <EventTemplatesEditor
        {...BASE_PROPS}
        {...overrides}
        templates={controlledTemplates}
        onChange={(nextTemplates, meta) => {
          onChange(nextTemplates, meta);
          setControlledTemplates(nextTemplates);
        }}
      />
    );
  }
  act(() => root.render(<Harness />));
  return { onChange };
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
    "value"
  )?.set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

function click(element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("EventTemplatesEditor", () => {
  test("renders exact selectors and keeps existing template IDs read-only", () => {
    renderEditor();

    expect(container.querySelector('[data-ambient-surface="event-templates-editor"]')).toBeTruthy();
    expect(container.querySelector('[data-template-id="wedding"]')).toBeTruthy();
    expect(container.querySelector(
      '[data-library-record-kind="event-template"][data-library-record-id="wedding"]'
    )).toBeTruthy();
    expect(container.querySelector('[data-template-action="add"]')).toBeTruthy();
    expect(container.querySelector('[data-template-action="remove"]')).toBeTruthy();
    expect(container.querySelector('[data-template-object-section="identity"]')).toBeTruthy();
    expect(container.querySelector('[data-template-completeness]')).toBeTruthy();
    expect(container.querySelector('[data-template-completeness-summary]')).toBeTruthy();

    const groups = [...container.querySelectorAll('[data-template-group]')];
    expect(groups.map((group) => group.dataset.templateGroup)).toEqual([
      "starting-offer",
      "event-context",
      "preselected-components",
      "service-rental-defaults",
      "staffing-resource-defaults",
      "pricing-policy-defaults",
      "remains-open",
      "advanced"
    ]);
    expect(groups.every((group) => group.open === false)).toBe(true);
    const idInput = container.querySelector('[data-template-field="id"]');
    expect(idInput.readOnly).toBe(true);
    expect(idInput.value).toBe("wedding");
    expect(idInput.closest('[data-template-group="advanced"]').open).toBe(false);
  });

  test("emits a parent-owned draft while preserving identity and unknown fields", () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
    setInputValue(container.querySelector('[data-template-field="name"]'), "Evening wedding");

    expect(onChange).toHaveBeenCalledOnce();
    const [nextTemplates, meta] = onChange.mock.calls[0];
    expect(nextTemplates[0]).toEqual(expect.objectContaining({
      id: "wedding",
      name: "Evening wedding",
      customTenantField: "preserve-me"
    }));
    expect(meta).toEqual({ type: "edit", templateId: "wedding", field: "name" });
  });

  test("adds a complete local draft with a noncolliding immutable ID", () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
    click(container.querySelector('[data-template-action="add"]'));

    const [nextTemplates, meta] = onChange.mock.calls[0];
    expect(nextTemplates).toHaveLength(2);
    expect(nextTemplates[1]).toEqual(expect.objectContaining({
      id: "template-1",
      name: "New template",
      eventTypeId: "wedding",
      pkg: "deluxe",
      addons: [],
      rentals: [],
      menuItems: []
    }));
    expect(meta).toEqual({ type: "add", templateId: "template-1", field: "name" });
  });

  test("moves focus into a newly added starting point after the parent accepts the draft", () => {
    const { onChange } = renderControlledEditor();
    click(container.querySelector('[data-template-action="add"]'));

    expect(onChange).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      container.querySelector('[data-template-id="template-1"] [data-template-field="name"]')
    );
  });

  test("removes only the requested draft and reports its exact identity", () => {
    const onChange = vi.fn();
    renderEditor({
      onChange,
      templates: [TEMPLATE, { ...TEMPLATE, id: "corporate", name: "Corporate", eventTypeId: "corporate" }]
    });
    click(container.querySelector('[data-template-id="wedding"] [data-template-action="remove"]'));

    expect(onChange).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "corporate" })],
      { type: "remove", templateId: "wedding" }
    );
  });

  test("moves focus to the adjacent starting point after removal", () => {
    renderControlledEditor({
      templates: [TEMPLATE, { ...TEMPLATE, id: "corporate", name: "Corporate", eventTypeId: "corporate" }]
    });
    click(container.querySelector('[data-template-id="wedding"] [data-template-action="remove"]'));

    expect(document.activeElement).toBe(
      container.querySelector('[data-template-id="corporate"] [data-template-field="summary"]')
    );
  });

  test("returns focus to Add template when the final starting point is removed", () => {
    renderControlledEditor();
    click(container.querySelector('[data-template-id="wedding"] [data-template-action="remove"]'));

    expect(document.activeElement).toBe(container.querySelector('[data-template-action="add"]'));
  });

  test("edits dependency lists through visible 44px checkbox rows", () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
    const group = container.querySelector('[data-template-group="service-rental-defaults"]');
    click(group.querySelector("summary"));
    const coffee = container.querySelector(
      '[data-template-dependency-kind="addons"][data-template-dependency-id="coffee"] input'
    );
    click(coffee);

    expect(onChange.mock.calls[0][0][0].addons).toEqual(["coffee"]);
    expect(onChange.mock.calls[0][1]).toEqual({ type: "edit", templateId: "wedding", field: "addons" });
  });

  test("labels partial menu inventory and preserves unseen saved references", () => {
    renderEditor({ menuSections: [], menuItems: [], menuInventoryComplete: false });

    const boundary = container.querySelector('[data-template-inventory-boundary="partial"]');
    const savedReference = container.querySelector(
      '[data-template-dependency-kind="menuItems"][data-template-dependency-id="salad"]'
    );
    expect(boundary.textContent).toContain("Only the currently loaded menu choices appear here");
    expect(savedReference.dataset.notLoaded).toBe("true");
    expect(container.querySelector('[data-template-warning-code="missing-menu-item"]')).toBeNull();
    expect(container.querySelector('[data-template-state="needs-check"]').textContent).toContain(
      "Saved menu choices are preserved until the complete Menu is available to compare"
    );
  });

  test("edits only staffing defaults already supported by the current template record", () => {
    const onChange = vi.fn();
    renderEditor({ onChange, templates: [{ ...TEMPLATE, bartenders: 1 }] });

    const staffingGroup = container.querySelector('[data-template-group="staffing-resource-defaults"]');
    click(staffingGroup.querySelector("summary"));
    setInputValue(container.querySelector('[data-template-field="bartenders"]'), "2");

    const [nextTemplates, meta] = onChange.mock.calls[0];
    expect(nextTemplates[0]).toEqual(expect.objectContaining({
      bartenders: 2,
      customTenantField: "preserve-me"
    }));
    expect(meta).toEqual({ type: "edit", templateId: "wedding", field: "bartenders" });
    expect(container.querySelector('[data-template-field="servers"]')).toBeNull();
    expect(container.querySelector('[data-template-field="chefs"]')).toBeNull();
  });

  test("keeps business defaults editable in their ordinary groups and true provenance advanced", () => {
    const onChange = vi.fn();
    renderEditor({
      onChange,
      templates: [{
        ...TEMPLATE,
        payMethod: "ach",
        taxRegion: "out_of_state",
        seasonProfileId: "holiday",
        staffingRateTypeId: "staff-premium",
        bartenderRateTypeId: "bar-standard",
        templateVersion: "v2",
        verticalType: "catering",
        starterPackId: "full-service",
        provenance: { source: "starter-pack" }
      }]
    });

    const staffingGroup = container.querySelector('[data-template-group="staffing-resource-defaults"]');
    const pricingGroup = container.querySelector('[data-template-group="pricing-policy-defaults"]');
    const advancedGroup = container.querySelector('[data-template-group="advanced"]');
    click(staffingGroup.querySelector("summary"));
    click(pricingGroup.querySelector("summary"));
    click(advancedGroup.querySelector("summary"));

    expect(container.querySelector('[data-template-field="payMethod"]').value).toBe("ach");
    expect(container.querySelector('[data-template-field="taxRegion"]').value).toBe("out_of_state");
    expect(container.querySelector('[data-template-field="seasonProfileId"]').value).toBe("holiday");
    expect(container.querySelector('[data-template-field="staffingRateTypeId"]').value).toBe("staff-premium");
    expect(container.querySelector('[data-template-field="bartenderRateTypeId"]').value).toBe("bar-standard");
    expect(advancedGroup.textContent).toContain("v2");
    expect(advancedGroup.textContent).toContain("starter-pack");
    expect(advancedGroup.textContent).not.toContain("out_of_state");
    expect(advancedGroup.textContent).not.toContain("staff-premium");

    setInputValue(container.querySelector('[data-template-field="taxRegion"]'), "local");
    setInputValue(container.querySelector('[data-template-field="staffingRateTypeId"]'), "staff-standard");

    expect(onChange.mock.calls[0][0][0]).toEqual(expect.objectContaining({
      id: "wedding",
      taxRegion: "local",
      customTenantField: "preserve-me",
      templateVersion: "v2",
      provenance: { source: "starter-pack" }
    }));
    expect(onChange.mock.calls[1][0][0]).toEqual(expect.objectContaining({
      id: "wedding",
      staffingRateTypeId: "staff-standard",
      customTenantField: "preserve-me"
    }));
  });

  test("focuses an exact requested field and emits contextual arrival", () => {
    const onFocusResolution = vi.fn();
    renderEditor({
      focusRequest: {
        id: "library-template-wedding-package",
        templateId: "wedding",
        field: "pkg",
        reason: "Review the starting package."
      },
      onFocusResolution
    });

    expect(document.activeElement).toBe(container.querySelector('[data-template-field="pkg"]'));
    expect(container.querySelector('[data-template-group="starting-offer"]').open).toBe(true);
    expect(onFocusResolution).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "library-template-wedding-package",
      status: "focused",
      result: "context",
      object: { type: "event-template", id: "wedding", field: "pkg" },
      reason: "Review the starting package."
    }));
  });

  test("opens collapsed advanced identity when exact arrival requests the stable ID", () => {
    renderEditor({
      focusRequest: {
        id: "library-template-wedding-id",
        templateId: "wedding",
        field: "id"
      }
    });

    const advanced = container.querySelector('[data-template-group="advanced"]');
    expect(advanced.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('[data-template-field="id"]'));
  });

  test("reports the actual summary fallback when an exact requested field is unavailable", () => {
    const onFocusResolution = vi.fn();
    renderEditor({
      focusRequest: {
        id: "library-template-wedding-missing-policy",
        templateId: "wedding",
        field: "staffingRateTypeId"
      },
      onFocusResolution
    });

    expect(document.activeElement).toBe(
      container.querySelector('[data-template-id="wedding"] [data-template-field="summary"]')
    );
    expect(onFocusResolution).toHaveBeenCalledWith(expect.objectContaining({
      object: { type: "event-template", id: "wedding", field: "summary" },
      reason: "The requested staffing rate policy control is unavailable; opened the starting point summary instead."
    }));
  });

  test("returns truthful recovery when a requested template is no longer available", () => {
    const onFocusResolution = vi.fn();
    renderEditor({
      focusRequest: { id: "missing-template", templateId: "retired", field: "name" },
      onFocusResolution
    });

    expect(onFocusResolution).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "missing-template",
      status: "recovery",
      result: "recovery",
      consequence: "No template field was changed."
    }));
  });

  test("shows useful empty-state action and fully disables mutations when requested", () => {
    const onChange = vi.fn();
    renderEditor({ templates: [], onChange, disabled: true });

    expect(container.querySelector('[data-template-state="empty"]')).toBeTruthy();
    expect(container.querySelector('[data-template-action="add"]').disabled).toBe(true);
    expect(container.querySelector('[data-template-action="add-empty"]').disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
