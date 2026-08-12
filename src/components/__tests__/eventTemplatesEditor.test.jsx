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
    const idInput = container.querySelector('[data-template-field="id"]');
    expect(idInput.readOnly).toBe(true);
    expect(idInput.value).toBe("wedding");
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

  test("edits dependency lists through visible 44px checkbox rows", () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
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
    expect(container.querySelector('[data-template-state="ready"]').textContent).toContain(
      "Saved menu choices are preserved and still need a current menu review"
    );
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
    expect(onFocusResolution).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "library-template-wedding-package",
      status: "focused",
      result: "context",
      object: { type: "event-template", id: "wedding", field: "pkg" },
      reason: "Review the starting package."
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
