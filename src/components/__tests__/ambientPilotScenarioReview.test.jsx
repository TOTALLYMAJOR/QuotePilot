// @vitest-environment jsdom
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AmbientPilotScenarioReview from "../AmbientPilotScenarioReview";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

const REVIEW = freeze({
  modelId: "pilot-scenario-draft-review-v1",
  reviewId: "pilot-scenario-review:under-budget:01",
  kind: "pilot_scenario_draft_review",
  state: "pending_review",
  commandClass: "simulation",
  authorityLevel: "draft",
  organizationScope: { organizationId: "scenario-org" },
  catalogScope: {
    sourceLabel: "firebase-org",
    catalogRevision: 17,
    observedAt: "2026-08-12T16:00:00.000Z",
    freshness: "fresh",
    fingerprint: "a".repeat(64)
  },
  proposalIdentity: {
    modelId: "pilot-bounded-scenarios-v1",
    proposalId: "pilot-bounded-scenario:under_budget:01",
    fingerprint: "b".repeat(64)
  },
  sourceSnapshot: {
    modelId: "pilot-scenario-source-snapshot-v1",
    fields: [
      { field: "eventTemplateId", present: true, encoding: "json", value: "wedding-template" },
      { field: "pkg", present: true, encoding: "json", value: "core" }
    ],
    fingerprint: "c".repeat(64)
  },
  changedFields: ["eventTemplateId", "pkg"],
  dimensions: ["event_template", "package"],
  patch: { eventTemplateId: "custom", pkg: "lean" },
  changes: [
    {
      field: "eventTemplateId",
      dimension: "event_template",
      before: { field: "eventTemplateId", present: true, encoding: "json", value: "wedding-template" },
      after: "custom"
    },
    {
      field: "pkg",
      dimension: "package",
      before: { field: "pkg", present: true, encoding: "json", value: "core" },
      after: "lean"
    }
  ],
  title: "Two explicit compromises under budget",
  summary: "$5,800.00 is $100.00 under the stated $5,900.00 budget.",
  compromises: [
    {
      dimension: "package",
      label: "Package",
      before: "Core package",
      after: "Lean package",
      why: "This is a named active package in the current tenant catalog."
    },
    {
      dimension: "event_template",
      label: "Template ownership",
      before: "Recorded event template",
      after: "Custom draft",
      why: "A package replacement must not silently retain a mismatched template identity."
    }
  ],
  clientPreview: {
    before: { currency: "USD", total: 6800, deposit: 2040, authority: "client_calculated_preview" },
    after: { currency: "USD", total: 5800, deposit: 1740, authority: "client_calculated_preview" },
    delta: { total: -1000, deposit: -300 }
  },
  marginEvidence: {
    before: { available: false },
    after: { available: false },
    deltaPercentagePoints: null
  },
  judgment: {
    why: "The bounded client calculation reaches the stated budget using only two visible compromises.",
    consequence: "The client preview total and deposit both change.",
    doNothing: "The current draft stays at $6,800.00 and nothing is staged.",
    confidence: {
      level: "medium",
      basis: "Both sides use the same client calculator and exact catalog observation."
    },
    provenance: [
      {
        source: "active_tenant_catalog",
        catalogRevision: 17,
        freshness: "fresh",
        observedAtISO: "2026-08-12T16:00:00.000Z"
      },
      { source: "quoteCalculator", authority: "client_calculated_preview" }
    ]
  },
  adoption: {
    required: true,
    allowedAfterExplicitConfirmation: true,
    applyLabel: "Apply scenario to draft",
    keepLabel: "Keep current draft",
    boundary: "Explicit adoption may stage only this exact patch."
  },
  boundary: "This review stages only the exact patch into an isolated editor draft. It does not save, reprice authoritatively, send, or publish."
});

let container;
let root;

function mount(props = {}) {
  act(() => {
    root.render(
      <AmbientPilotScenarioReview
        review={REVIEW}
        onApply={() => ({ ok: true })}
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

describe("AmbientPilotScenarioReview", () => {
  test("shows exact before and after values, every compromise, judgment, confidence, and provenance", () => {
    const markup = renderToStaticMarkup(
      <AmbientPilotScenarioReview review={REVIEW} onApply={() => ({ ok: true })} />
    );

    expect(markup).toContain('data-review-state="pending"');
    expect(markup).toContain("wedding-template");
    expect(markup).toContain("custom");
    expect(markup).toContain("core");
    expect(markup).toContain("lean");
    expect(markup).toContain("Core package to Lean package");
    expect(markup).toContain("Recorded event template to Custom draft");
    expect(markup).toContain("Proposed changes");
    expect(markup).toContain("Price preview");
    expect(markup).toContain("This is a preview. QuotePilot recalculates the final price when you save.");
    expect(markup).toContain("What this option changes");
    expect(markup).toContain("Why this is recommended");
    expect(markup).toContain("Why this scenario");
    expect(markup).toContain("If you do nothing");
    expect(markup).toContain("Confidence: medium");
    expect(markup).toContain("Confidence and sources");
    expect(markup).toContain("Technical details");
    expect(markup).toContain("active_tenant_catalog");
    expect(markup).toContain("quoteCalculator");
    expect(markup).toContain("Catalog revision");
    expect(markup).toContain("Apply scenario to draft");
    expect(markup).toContain("Keep current draft");
  });

  test("acknowledges applying immediately, resolves once, and moves focus to the receipt", async () => {
    let resolveApply;
    const onApply = vi.fn(() => new Promise((resolve) => {
      resolveApply = resolve;
    }));
    mount({ onApply });

    const apply = button("Apply scenario to draft");
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(document.activeElement).toBe(apply);
    act(() => {
      apply.click();
      apply.click();
    });
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(REVIEW);
    expect(container.querySelector('[data-review-state="applying"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]').textContent).toContain("saved quote remains unchanged");

    await act(async () => {
      resolveApply({
        ok: true,
        acknowledgement: {
          reason: "The exact reviewed scenario was applied to the isolated editor draft.",
          consequence: "The saved quote remains unchanged."
        }
      });
      await Promise.resolve();
    });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toContain("reviewed option is now in your draft");
    expect(document.activeElement).toBe(status);
    expect([...container.querySelectorAll("button")].every((item) => item.disabled)).toBe(true);
  });

  test("fails into contextual recovery, restores focus, and permits an exact retry", async () => {
    let queuedInitialFocus = null;
    const requestFrame = vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        queuedInitialFocus = callback;
        return 42;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const onApply = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        acknowledgement: { reason: "The catalog revision changed after review." }
      })
      .mockResolvedValueOnce({ ok: true });
    mount({ onApply });

    await clickAndFlush(button("Apply scenario to draft"));
    const alert = container.querySelector('[role="alert"]');
    expect(container.querySelector('[data-review-state="recovery"]')).not.toBeNull();
    expect(alert.textContent).toContain("catalog revision changed");
    expect(alert.textContent).toContain("current draft and saved quote were not changed");
    expect(document.activeElement).toBe(alert);
    act(() => queuedInitialFocus?.(performance.now()));
    expect(document.activeElement).toBe(alert);
    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(button("Apply scenario to draft").disabled).toBe(false);

    await clickAndFlush(button("Apply scenario to draft"));
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-review-state="resolved"]')).not.toBeNull();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  test("keeps the current draft as a complete local outcome without requiring a handler", async () => {
    mount({ onKeep: undefined });
    await clickAndFlush(button("Keep current draft"));

    const status = container.querySelector('[role="status"]');
    expect(container.querySelector('[data-review-state="resolved"]')).not.toBeNull();
    expect(status.textContent).toContain("Current draft kept");
    expect(status.textContent).toContain("saved, sent, or published");
    expect(document.activeElement).toBe(status);
  });

  test("fails closed without an exact review and exposes no enabled outcome", () => {
    mount({ review: { modelId: "pilot-scenario-draft-review-v1" } });

    expect(container.querySelector('[data-review-state="recovery"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]').textContent).toContain("This option is no longer current");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  test("keeps controls accessible and all layout in normal flow", () => {
    const css = readFileSync(
      join(process.cwd(), "src/components/ambientPilotScenarioReview.css"),
      "utf8"
    );
    const component = readFileSync(
      join(process.cwd(), "src/components/AmbientPilotScenarioReview.jsx"),
      "utf8"
    );

    expect(css).toMatch(/\.ambient-pilot-scenario-review__actions button\s*\{[^}]*min-height:\s*44px;/su);
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).not.toMatch(/position:\s*(?:fixed|absolute|sticky)/u);
    expect(css).not.toMatch(/\bz-index\s*:/u);
    expect(component).toContain('data-surface-purpose="clarify simulate resolve"');
    expect(component).toContain('aria-live={status.phase === "recovery" ? "assertive" : "polite"}');
    expect(component).not.toMatch(/[—–]/u);
  });
});
