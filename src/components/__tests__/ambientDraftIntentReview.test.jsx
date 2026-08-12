// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AmbientDraftIntentReview from "../AmbientDraftIntentReview";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const BASE_CHANGE = {
  state: "pending_review",
  authority: "draft_only",
  commit: false,
  target: {
    objectId: "package",
    fieldPaths: ["selection.packageId", "selection.packageName"],
    trustedReconciliationRequired: ["selection.packageInclusions"]
  },
  catalogScope: {
    organizationId: "org-a",
    catalogRevision: 12,
    sourceLabel: "Explicit organization catalog",
    observedAt: "2026-08-11T18:01:00.000Z",
    freshness: "fresh"
  },
  consequencePreviewRequired: true,
  requiresOutcomeNamedSave: true
};

const PACKAGE_INTENT = deepFreeze({
  family: "package_menu",
  kind: "replace_package",
  label: "Package replacement",
  fields: ["selection.packageId", "selection.packageName"],
  draftChange: {
    ...BASE_CHANGE,
    actionId: "replace-package-in-draft",
    before: { packageId: "classic" },
    proposed: { packageId: "premium", packageName: "Premium" },
    candidate: {
      id: "premium",
      name: "Premium",
      catalogActive: true,
      operationalAvailability: "not_evaluated"
    }
  }
});

const MENU_INTENT = deepFreeze({
  family: "package_menu",
  kind: "replace_menu_item",
  label: "Menu item replacement",
  fields: ["selection.menuItems", "selection.menuItemQuantities"],
  draftChange: {
    ...BASE_CHANGE,
    actionId: "replace-menu-item-in-draft",
    target: {
      objectId: "menu",
      fieldPaths: ["selection.menuItems", "selection.menuItemQuantities"],
      trustedReconciliationRequired: [
        "selection.menuItemsSnapshot",
        "selection.menuItemNames",
        "selection.packageInclusions"
      ]
    },
    before: { itemId: "chicken", orderIndex: 1, quantity: 3 },
    proposed: {
      itemId: "salmon",
      orderIndex: 1,
      quantity: 3,
      quantityPolicy: "preserve_explicit_saved_quantity"
    },
    candidate: {
      id: "salmon",
      name: "Salmon",
      section: { id: "entrees", label: "Entrees", orderIndex: 0 },
      catalogActive: true,
      operationalAvailability: "not_evaluated"
    }
  }
});

const ORDER_INTENT = deepFreeze({
  family: "package_menu",
  kind: "reorder_menu",
  label: "Menu reorder",
  fields: ["selection.menuItems"],
  draftChange: {
    ...BASE_CHANGE,
    actionId: "reorder-menu-in-draft",
    target: {
      objectId: "menu",
      fieldPaths: ["selection.menuItems"],
      trustedReconciliationRequired: [
        "selection.menuItemsSnapshot",
        "selection.menuItemNames"
      ]
    },
    before: { order: ["salad", "chicken"] },
    proposed: { order: ["chicken", "salad"] },
    interaction: {
      method: "keyboard",
      equivalence: "pointer_and_keyboard_produce_the_same_order_intent"
    }
  }
});

const ORDER_CATALOG_CONTEXT = deepFreeze({
  menuItems: [
    { id: "salad", name: "Garden Salad" },
    { id: "chicken", name: "Herb Chicken" }
  ]
});

let container;
let root;

function mount(props = {}) {
  act(() => {
    root.render(
      <AmbientDraftIntentReview
        intent={PACKAGE_INTENT}
        onApply={() => {}}
        onKeep={() => {}}
        {...props}
      />
    );
  });
}

function button(label) {
  return [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent.replace(/\s+/gu, " ").trim() === label);
}

async function clickAndFlush(target) {
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AmbientDraftIntentReview", () => {
  test("renders exact package before/proposed evidence and the draft-only save boundary", () => {
    const markup = renderToStaticMarkup(
      <AmbientDraftIntentReview
        intent={PACKAGE_INTENT}
        onApply={() => {}}
        onKeep={() => {}}
      />
    );

    expect(markup).toContain('data-review-state="pending"');
    expect(markup).toContain("classic");
    expect(markup).toContain("Premium");
    expect(markup).toContain("Explicit organization catalog");
    expect(markup).toContain("2026-08-11T18:01:00.000Z");
    expect(markup).toContain('data-reconciliation-field="selection.packageInclusions"');
    expect(markup).toContain("Package inclusions");
    expect(markup).toContain("Draft only. Nothing changes until you save.");
    expect(markup).toContain("does not save, reprice, update the proposal, or prove operational availability");
    expect(markup).toContain("Apply Premium to draft");
    expect(markup).toContain("Keep saved package");
  });

  test("renders exact menu quantity, order position, and trusted snapshot reconciliation", () => {
    const markup = renderToStaticMarkup(
      <AmbientDraftIntentReview intent={MENU_INTENT} onApply={() => {}} onKeep={() => {}} />
    );

    expect(markup).toContain("chicken");
    expect(markup).toContain("salmon");
    expect(markup).toContain("Salmon");
    expect(markup).toContain("preserve_explicit_saved_quantity");
    expect(markup).toContain('data-reconciliation-field="selection.menuItemsSnapshot"');
    expect(markup).toContain("Saved menu details");
    expect(markup).toContain('data-reconciliation-field="selection.menuItemNames"');
    expect(markup).toContain("Menu item names");
    expect(markup).toContain("Apply Salmon to draft");
    expect(markup).toContain("Keep saved menu");
  });

  test("renders the exact saved and proposed menu order with outcome-specific controls", () => {
    mount({ intent: ORDER_INTENT, catalogContext: ORDER_CATALOG_CONTEXT });

    const savedOrder = container.querySelector('[aria-label="before menu order"]');
    const proposedOrder = container.querySelector('[aria-label="proposed menu order"]');
    expect([...savedOrder.querySelectorAll("code")].map((item) => item.textContent))
      .toEqual(["salad", "chicken"]);
    expect([...proposedOrder.querySelectorAll("code")].map((item) => item.textContent))
      .toEqual(["chicken", "salad"]);
    expect(savedOrder.textContent).toContain("Garden Salad");
    expect(proposedOrder.textContent).toContain("Herb Chicken");
    expect(button("Apply proposed order to draft")).toBeDefined();
    expect(button("Keep saved order")).toBeDefined();
  });

  test("acknowledges pending, applying, and resolved while blocking duplicate dispatch", async () => {
    let resolveApply;
    const onApply = vi.fn(() => new Promise((resolve) => {
      resolveApply = resolve;
    }));
    const onKeep = vi.fn();
    mount({ onApply, onKeep });

    expect(container.querySelector('[data-review-state="pending"]')).not.toBeNull();
    const apply = button("Apply Premium to draft");
    act(() => {
      apply.click();
      apply.click();
      button("Keep saved package").click();
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(PACKAGE_INTENT);
    expect(onKeep).not.toHaveBeenCalled();
    expect(container.querySelector('[data-review-state="applying"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]').textContent).toContain("saved quote remains unchanged until you save");
    expect([...container.querySelectorAll("button")].every((item) => item.disabled)).toBe(true);

    await act(async () => {
      resolveApply({ ok: true });
      await Promise.resolve();
    });

    expect(container.querySelector('[data-review-state="resolved"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]').textContent).toContain("Draft updated");
    expect(container.textContent).toContain("named save action");
    expect([...container.querySelectorAll("button")].every((item) => item.disabled)).toBe(true);
  });

  test("enters contextual recovery on rejection and permits one deliberate retry", async () => {
    const onApply = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Catalog evidence changed."), {
        userMessage: "Refresh the exact tenant catalog."
      }))
      .mockResolvedValueOnce({ ok: true });
    mount({ onApply });

    await clickAndFlush(button("Apply Premium to draft"));
    expect(container.querySelector('[data-review-state="recovery"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]').textContent).toContain("Refresh the exact tenant catalog");
    expect(container.querySelector('[role="alert"]').textContent).toContain("saved quote was not changed");
    expect(button("Apply Premium to draft").disabled).toBe(false);

    await clickAndFlush(button("Apply Premium to draft"));
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-review-state="resolved"]')).not.toBeNull();
  });

  test("acknowledges keeping the saved outcome without mutating the normalized intent", async () => {
    const before = structuredClone(MENU_INTENT);
    const onKeep = vi.fn(() => ({ ok: true }));
    mount({ intent: MENU_INTENT, onKeep });

    await clickAndFlush(button("Keep saved menu"));

    expect(onKeep).toHaveBeenCalledOnce();
    expect(onKeep).toHaveBeenCalledWith(MENU_INTENT);
    expect(container.querySelector('[data-review-state="resolved"]')).not.toBeNull();
    expect(container.textContent).toContain("saved menu kept");
    expect(MENU_INTENT).toEqual(before);
    expect(Object.isFrozen(MENU_INTENT.draftChange)).toBe(true);
  });

  test("fails closed for a non-normalized intent and exposes no enabled outcome", () => {
    mount({
      intent: {
        family: "package_menu",
        kind: "replace_package",
        draftChange: { state: "pending_review", authority: "draft_only", commit: true }
      }
    });

    expect(container.querySelector('[data-review-state="recovery"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]').textContent).toContain("No current package or menu change");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).toContain("choose a package or menu change again");
  });

  test("keeps controls at 44px and contains no overlay positioning contract", () => {
    const css = readFileSync(
      join(process.cwd(), "src/components/ambientDraftIntentReview.css"),
      "utf8"
    );

    expect(css).toMatch(/\.ambient-draft-review__actions button\s*\{[^}]*min-height:\s*44px;/su);
    expect(css).not.toMatch(/position:\s*(?:fixed|absolute|sticky)/u);
    expect(css).not.toMatch(/\bz-index\s*:/u);
  });
});
