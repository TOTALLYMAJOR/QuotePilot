// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import QuickUpdatesPanel from "../QuickUpdatesPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUOTE = Object.freeze({
  id: "quote-alpha",
  organizationId: "org-alpha",
  activeVersionId: "version-alpha",
  quoteNumber: "Q-ALPHA",
  event: Object.freeze({
    name: "Autumn Benefit Dinner",
    style: "Plated"
  })
});
const DELTA = Object.freeze([Object.freeze({
  fieldPath: "event.style",
  label: "Service style",
  before: "Plated",
  after: "Buffet",
  beforeLabel: "Plated dinner",
  afterLabel: "Buffet"
})]);

function persistedEffects(overrides = {}) {
  return {
    schemaVersion: "commercial-change-persisted-effects-v1",
    authority: "server_authoritative",
    source: "trusted_quote_edit_material_projection",
    identity: {
      organizationId: QUOTE.organizationId,
      quoteId: QUOTE.id,
      baseRevisionId: QUOTE.activeVersionId,
      projectedRevisionId: "version-beta"
    },
    requestedDelta: [{
      nodeId: "fact.event.service_style",
      fieldPath: "event.style",
      before: "Plated",
      after: "Buffet"
    }],
    pricing: {
      currency: "USD",
      authoritativeTotal: {
        before: 8400,
        proposedAfter: 8400,
        changed: false
      },
      depositRequirement: {
        before: 2100,
        proposedAfter: 2100,
        changed: false
      }
    },
    staffing: {
      before: { servers: 8, chefs: 3, bartenders: 2 },
      after: { servers: 8, chefs: 3, bartenders: 2 },
      changed: false
    },
    status: { before: "draft", after: "draft", changed: false },
    version: {
      beforeRevisionId: QUOTE.activeVersionId,
      afterRevisionId: "version-beta",
      beforeVersionNumber: 1,
      afterVersionNumber: 2,
      createsImmutableVersion: true
    },
    proposal: {
      statusBefore: "draft",
      statusAfter: "draft",
      workflowEvidencePreserved: true,
      customerDeliveryTriggered: false,
      publicationTriggered: false
    },
    portal: {
      activeRevisionIdBefore: QUOTE.activeVersionId,
      activeRevisionIdAfter: "version-beta",
      projectionRefreshed: true,
      accessIdentityRetained: true,
      issuanceRecordedAtSave: true,
      expiryRecalculatedAtSave: true,
      customerDeliveryTriggered: false
    },
    lifecycle: {
      draftAtPreserved: true,
      draftAtAssignedIfMissing: false,
      editedAtRecordedAtSave: true,
      terminalDecisionEvidencePreserved: true
    },
    dependencies: {
      authorizationRequired: true,
      impact: { counts: { total: 3, review: 2, stale: 1 } }
    },
    boundary: "Exact trusted quote edit plan; no write or delivery occurred.",
    ...overrides
  };
}

function readyPreview(overrides = {}) {
  return {
    status: "ready",
    storage: "firebase",
    authorityState: "dormant",
    authorizationRequired: true,
    simulationReceiptId: "ccs_fixture",
    applyRequestId: "change_apply_fixture",
    baseRevisionId: QUOTE.activeVersionId,
    saveAllowed: true,
    delta: DELTA,
    persistedEffects: persistedEffects(),
    previewId: "preview-alpha",
    ...overrides
  };
}

function byButton(name) {
  return Array.from(document.querySelectorAll("button")).find((button) => (
    button.textContent.replace(/\s+/gu, " ").trim().includes(name)
    || button.getAttribute("aria-label") === name
  ));
}

function changeStyle(value = "Buffet") {
  const select = document.querySelector('select[aria-label="Service style"]')
    || document.querySelector(".qup-field select");
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return select;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

describe("QuickUpdatesPanel", () => {
  let container;
  let root;
  let trigger;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;
  let originalGetClientRects;

  beforeEach(() => {
    container = document.createElement("div");
    trigger = document.createElement("button");
    trigger.textContent = "Quick Updates trigger";
    container.appendChild(trigger);
    document.body.appendChild(container);
    root = createRoot(container);
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    originalGetClientRects = HTMLElement.prototype.getClientRects;
    window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
    HTMLElement.prototype.getClientRects = () => [{ width: 44, height: 44 }];
    trigger.focus();
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container.remove();
    document.querySelectorAll(".qup-root").forEach((node) => node.remove());
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    HTMLElement.prototype.getClientRects = originalGetClientRects;
    document.body.style.overflow = "";
  });

  function render(overrides = {}) {
    const props = {
      open: true,
      quote: QUOTE,
      serviceStyles: ["Buffet", "Plated", "Stations", "Drop-off"],
      staffingSummary: "8 servers · 3 chefs",
      pricingSummary: "$8,400 saved total",
      returnFocusRef: { current: trigger },
      onClose: vi.fn(),
      onPreviewQuickUpdate: vi.fn().mockResolvedValue(readyPreview()),
      onSaveQuickUpdate: vi.fn(async (request, hooks) => {
        hooks.onPersisted({ quoteId: QUOTE.id, organizationId: QUOTE.organizationId, activeVersionId: "version-beta" });
        return {
          status: "saved",
          quote: { ...QUOTE, activeVersionId: "version-beta", event: { ...QUOTE.event, style: request.patch.event.style } },
          receipt: { quoteId: QUOTE.id, organizationId: QUOTE.organizationId, activeVersionId: "version-beta" }
        };
      }),
      onReviewStaffing: vi.fn(),
      onReviewPricing: vi.fn(),
      onOpenQuickUpdatesLibrary: vi.fn(),
      onOpenAuthoritativeEditor: vi.fn(),
      onQuickUpdatesGuardChange: vi.fn(),
      ...overrides
    };
    act(() => root.render(<QuickUpdatesPanel {...props} />));
    return props;
  }

  test("opens as a write-free, service-style-only drawer using host-supplied options", async () => {
    const props = render();
    await settle();

    const dialog = document.querySelector('.qup-drawer[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog.textContent).toContain("Quick Updates");
    expect(dialog.textContent).toContain("Service style");
    expect(dialog.textContent).not.toContain("Courses");
    expect(dialog.querySelector('[data-quick-updates-scroll-region="body"]')).not.toBeNull();
    expect(dialog.querySelector('[data-quick-updates-scroll-target="library"]')).not.toBeNull();
    expect(dialog.querySelector('[data-quick-updates-fixed-footer="actions"]')).not.toBeNull();
    expect(byButton("Menu").getAttribute("aria-expanded")).toBe("true");
    expect(byButton("Staffing").getAttribute("aria-expanded")).toBe("false");
    expect(byButton("Pricing").getAttribute("aria-expanded")).toBe("false");
    expect(dialog.textContent).toContain("Nothing changes until you save");
    expect(dialog.querySelector('[data-adaptive-choice-mode="select"]')).not.toBeNull();
    expect(Array.from(dialog.querySelectorAll("option")).map((option) => option.value))
      .toEqual(["", "Plated", "Buffet", "Stations", "Drop-off"]);
    expect(props.onPreviewQuickUpdate).not.toHaveBeenCalled();
    expect(props.onSaveQuickUpdate).not.toHaveBeenCalled();
  });

  test("renders service-style zero, one, and stale choice states without inventing a replacement", async () => {
    const emptyQuote = { ...QUOTE, event: { ...QUOTE.event, style: "" } };
    render({ quote: emptyQuote, serviceStyles: [] });
    await settle();
    expect(document.querySelector('[data-adaptive-choice-mode="empty"]')).not.toBeNull();
    expect(document.querySelector('[data-field-state-primary="unavailable"]')).not.toBeNull();
    expect(document.querySelector(".qup-field select")).toBeNull();
    expect(byButton("Open full Library")).not.toBeUndefined();

    act(() => root.render(null));
    act(() => root.render(<QuickUpdatesPanel
      open
      quote={QUOTE}
      serviceStyles={["Plated"]}
      returnFocusRef={{ current: trigger }}
      onClose={vi.fn()}
      onPreviewQuickUpdate={vi.fn()}
      onSaveQuickUpdate={vi.fn()}
      onOpenQuickUpdatesLibrary={vi.fn()}
    />));
    await settle();
    expect(document.querySelector('[data-adaptive-choice-mode="single"]')).not.toBeNull();
    expect(document.querySelector('[data-field-state-primary="confirmed"]')).not.toBeNull();
    expect(document.querySelector(".qup-field select")).toBeNull();

    act(() => root.render(null));
    act(() => root.render(<QuickUpdatesPanel
      open
      quote={QUOTE}
      serviceStyles={["Buffet", "Stations"]}
      returnFocusRef={{ current: trigger }}
      onClose={vi.fn()}
      onPreviewQuickUpdate={vi.fn()}
      onSaveQuickUpdate={vi.fn()}
      onOpenQuickUpdatesLibrary={vi.fn()}
    />));
    await settle();
    const staleSelect = document.querySelector(".qup-field select");
    expect(staleSelect.value).toBe("Plated");
    expect(staleSelect.querySelector('option[value="Plated"]').disabled).toBe(true);
    expect(document.querySelector('[data-field-state-primary="stale"]')).not.toBeNull();
    expect(document.body.textContent).toContain("saved value remains visible");
  });

  test("isolates every background body surface while open and restores prior accessibility state", async () => {
    const priorSurface = document.createElement("div");
    priorSurface.setAttribute("aria-hidden", "false");
    document.body.appendChild(priorSurface);
    try {
      render({ dialogId: "quick-updates-dialog-alpha" });
      await settle();

      const dialog = document.getElementById("quick-updates-dialog-alpha");
      expect(dialog?.getAttribute("role")).toBe("dialog");
      expect(container.getAttribute("aria-hidden")).toBe("true");
      expect(container.hasAttribute("inert")).toBe(true);
      expect(priorSurface.getAttribute("aria-hidden")).toBe("true");
      expect(priorSurface.hasAttribute("inert")).toBe(true);

      act(() => byButton("Close Quick Updates").click());
      await settle();
      expect(container.hasAttribute("aria-hidden")).toBe(false);
      expect(container.hasAttribute("inert")).toBe(false);
      expect(priorSurface.getAttribute("aria-hidden")).toBe("false");
      expect(priorSurface.hasAttribute("inert")).toBe(false);
    } finally {
      priorSurface.remove();
    }
  });

  test("expands and collapses Menu, Staffing, and Pricing without navigation or mutation", async () => {
    const props = render();
    await settle();
    const select = changeStyle();

    act(() => byButton("Menu").click());
    expect(byButton("Menu").getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".qup-field select")).toBeNull();

    act(() => byButton("Staffing").click());
    expect(byButton("Staffing").getAttribute("aria-expanded")).toBe("true");
    expect(byButton("Review staffing")).not.toBeUndefined();

    act(() => byButton("Pricing").click());
    expect(byButton("Pricing").getAttribute("aria-expanded")).toBe("true");
    expect(byButton("Review pricing")).not.toBeUndefined();

    act(() => byButton("Menu").click());
    expect(document.querySelector(".qup-field select").value).toBe("Buffet");
    expect(document.body.textContent).toContain("1 unsaved change");
    expect(props.onPreviewQuickUpdate).not.toHaveBeenCalled();
    expect(props.onSaveQuickUpdate).not.toHaveBeenCalled();
    expect(props.onReviewStaffing).not.toHaveBeenCalled();
    expect(props.onReviewPricing).not.toHaveBeenCalled();
    expect(props.onOpenQuickUpdatesLibrary).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  test("traps keyboard focus inside the drawer and wraps in both directions", async () => {
    render();
    await settle();
    const close = byButton("Close Quick Updates");
    const cancel = byButton("Cancel");
    expect(document.activeElement).toBe(close);

    cancel.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(close);

    close.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(cancel);
  });

  test("previews the exact delta, saves only after confirmation, and waits for authoritative readback", async () => {
    const props = render();
    await settle();
    changeStyle();
    expect(document.body.textContent).toContain("1 unsaved change");
    expect(props.onPreviewQuickUpdate).not.toHaveBeenCalled();
    expect(props.onSaveQuickUpdate).not.toHaveBeenCalled();

    await act(async () => byButton("Review menu change").click());
    expect(props.onPreviewQuickUpdate).toHaveBeenCalledWith(expect.objectContaining({
      quoteId: "quote-alpha",
      organizationId: "org-alpha",
      baseRevisionId: "version-alpha",
      patch: { event: { style: "Buffet" } },
      delta: [expect.objectContaining({ fieldPath: "event.style", before: "Plated", after: "Buffet" })]
    }));
    expect(document.body.textContent).toContain("Service style before");
    expect(document.body.textContent).toContain("Plated dinner");
    expect(document.body.textContent).toContain("Service style after");
    expect(document.body.textContent).toContain("$8,400.00 → $8,400.00");
    expect(document.body.textContent).toContain("$2,100.00 → $2,100.00");
    expect(document.body.textContent).toContain("8 servers · 3 chefs · 2 bartenders — unchanged by the trusted edit plan");
    expect(document.body.textContent).not.toContain("Staffing and pricing will recalculate after save");
    expect(document.body.textContent).toContain("1 (version-alpha) → 2 (version-beta)");
    expect(document.body.textContent).toContain("It does not publish or deliver a proposal");
    expect(props.onSaveQuickUpdate).not.toHaveBeenCalled();

    await act(async () => byButton("Save menu change").click());
    expect(props.onSaveQuickUpdate).toHaveBeenCalledOnce();
    expect(props.onSaveQuickUpdate.mock.calls[0][0]).toEqual(expect.objectContaining({
      quoteId: "quote-alpha",
      patch: { event: { style: "Buffet" } },
      preview: expect.objectContaining({ previewId: "preview-alpha" })
    }));
    expect(props.onSaveQuickUpdate.mock.calls[0][1]).toEqual({ onPersisted: expect.any(Function) });
    expect(document.body.textContent).toContain("authoritative source");
    expect(document.body.textContent).toContain("version-beta");
    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("saved");
  });

  test("rejects a preview that does not match the exact requested persisted delta", async () => {
    const props = render({
      onPreviewQuickUpdate: vi.fn().mockResolvedValue({
        status: "ready",
        delta: [{ ...DELTA[0], after: "Stations", afterLabel: "Stations" }]
      })
    });
    await settle();
    const select = changeStyle();
    await act(async () => byButton("Review menu change").click());

    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("failure");
    expect(document.body.textContent).toContain("did not match this exact menu draft");
    expect(props.onSaveQuickUpdate).not.toHaveBeenCalled();
  });

  test("shows the host's structured failure reason", async () => {
    render({
      onPreviewQuickUpdate: vi.fn().mockResolvedValue({
        status: "failed",
        reason: "This change requires the existing Commercial Change authorization flow."
      })
    });
    await settle();
    changeStyle();
    await act(async () => byButton("Review menu change").click());

    expect(document.body.textContent).toContain("This change requires the existing Commercial Change authorization flow");
  });

  test("hands local or non-draft work to the full editor without offering an authoritative panel save", async () => {
    const onOpenAuthoritativeEditor = vi.fn();
    render({
      onPreviewQuickUpdate: vi.fn().mockResolvedValue({
        status: "handoff",
        reason: "Quick Updates can browse this quote, but it cannot claim an authoritative save.",
        recoveryAction: "open_editor",
        recoveryLabel: "Continue in quote editor",
        retryable: false
      }),
      onOpenAuthoritativeEditor
    });
    await settle();
    const select = changeStyle();
    await act(async () => byButton("Review menu change").click());

    expect(document.body.textContent).toContain("cannot claim an authoritative save");
    expect(byButton("Retry authoritative review")).toBeUndefined();
    expect(byButton("Save menu change")).toBeUndefined();
    act(() => byButton("Continue in quote editor").click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(onOpenAuthoritativeEditor).not.toHaveBeenCalled();
    act(() => byButton("Keep editing").click());
    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("dirty");
    expect(select.value).toBe("Buffet");
    await act(async () => byButton("Review menu change").click());
    act(() => byButton("Continue in quote editor").click());
    act(() => byButton("Discard draft").click());
    expect(onOpenAuthoritativeEditor).toHaveBeenCalledOnce();
  });

  test("renders governed effects but hands authorization-required saves to the full editor", async () => {
    const onOpenAuthoritativeEditor = vi.fn();
    render({
      onPreviewQuickUpdate: vi.fn().mockResolvedValue(readyPreview({
        authorityState: "enforced",
        saveAllowed: false,
        handoffReason: "Governed dependencies require authorization."
      })),
      onOpenAuthoritativeEditor
    });
    await settle();
    changeStyle();
    await act(async () => byButton("Review menu change").click());

    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("review");
    expect(document.body.textContent).toContain("Enumerated material save effects");
    expect(document.body.textContent).toContain("Continue in the full editor for governed authorization");
    expect(byButton("Save menu change")).toBeUndefined();
    act(() => byButton("Continue in quote editor").click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(onOpenAuthoritativeEditor).not.toHaveBeenCalled();
  });

  test("guards X and Escape, gives Keep editing initial focus, and discards once", async () => {
    const props = render();
    await settle();
    const select = changeStyle();
    select.focus();

    act(() => byButton("Close Quick Updates").click());
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(byButton("Keep editing"));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector(".qup-field select").value).toBe("Buffet");
    expect(document.activeElement).toBe(document.querySelector(".qup-field select"));

    act(() => byButton("Close Quick Updates").click());
    await settle();
    act(() => byButton("Discard draft").click());
    act(() => byButton("Discard draft")?.click());
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledWith({ reason: "close", discarded: true });
  });

  test("exposes only the nested discard alertdialog and traps focus inside it", async () => {
    render();
    await settle();
    changeStyle();
    act(() => byButton("Close Quick Updates").click());
    await settle();

    const drawer = document.querySelector(".qup-drawer");
    const surface = document.querySelector(".qup-drawer-surface");
    expect(drawer.getAttribute("role")).toBeNull();
    expect(drawer.getAttribute("aria-modal")).toBeNull();
    expect(surface.getAttribute("aria-hidden")).toBe("true");
    expect(surface.hasAttribute("inert")).toBe(true);
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(byButton("Keep editing"));

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(byButton("Discard draft"));
    act(() => byButton("Keep editing").click());
    await settle();
    expect(drawer.getAttribute("role")).toBe("dialog");
    expect(surface.hasAttribute("aria-hidden")).toBe(false);
    expect(surface.hasAttribute("inert")).toBe(false);
  });

  test("guards Cancel, backdrop, Library, and external navigation without running a continuation early", async () => {
    let latestGuard = null;
    const props = render({
      onQuickUpdatesGuardChange: vi.fn((guard) => { if (guard) latestGuard = guard; })
    });
    await settle();
    changeStyle();
    await settle();

    act(() => byButton("Cancel").click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => byButton("Keep editing").click());

    act(() => document.querySelector(".qup-root").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => byButton("Keep editing").click());

    act(() => byButton("Open full Library").click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(props.onOpenQuickUpdatesLibrary).not.toHaveBeenCalled();
    act(() => byButton("Keep editing").click());

    const navigate = vi.fn();
    expect(latestGuard.requestDismiss("navigation", navigate)).toEqual({ status: "guarded" });
    await settle();
    expect(navigate).not.toHaveBeenCalled();
    act(() => byButton("Discard draft").click());
    expect(navigate).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  test("carries exact Library context only after a clean dismissal", async () => {
    const props = render();
    await settle();
    act(() => byButton("Open full Library").click());
    await settle();
    expect(props.onClose).toHaveBeenCalledWith({ reason: "library" });
    expect(props.onOpenQuickUpdatesLibrary).toHaveBeenCalledWith({
      modelId: "quick-updates-library-handoff-v1",
      quoteId: "quote-alpha",
      opportunityId: "quote-alpha",
      organizationId: "org-alpha",
      sectionId: "overview",
      label: "Autumn Benefit Dinner",
      opportunityLabel: "Autumn Benefit Dinner",
      opportunity: { id: "quote-alpha", label: "Autumn Benefit Dinner" },
      requestedSection: "overview",
      returnLabel: "Return to Autumn Benefit Dinner"
    });
    expect(props.onQuickUpdatesGuardChange).toHaveBeenLastCalledWith(null);
  });

  test("blocks close, Escape, backdrop, and duplicate save while saving", async () => {
    const pending = deferred();
    const onSaveQuickUpdate = vi.fn((request, hooks) => {
      hooks.onPersisted({ activeVersionId: "version-beta" });
      return pending.promise;
    });
    const props = render({ onSaveQuickUpdate });
    await settle();
    changeStyle();
    await act(async () => byButton("Review menu change").click());
    const saveButton = byButton("Save menu change");
    act(() => {
      saveButton.click();
      saveButton.click();
    });
    await settle();

    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("refreshing");
    expect(document.querySelector(".qup-drawer").getAttribute("aria-busy")).toBe("true");
    expect(byButton("Close Quick Updates").disabled).toBe(true);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    act(() => document.querySelector(".qup-root").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(onSaveQuickUpdate).toHaveBeenCalledOnce();

    await act(async () => pending.resolve({
      status: "saved",
      quote: { ...QUOTE, activeVersionId: "version-beta", event: { ...QUOTE.event, style: "Buffet" } },
      receipt: { activeVersionId: "version-beta" }
    }));
    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("saved");
  });

  test("announces Saving and disables every edit and dismissal control until persistence resolves", async () => {
    const pending = deferred();
    let hooks;
    const onSaveQuickUpdate = vi.fn((_request, saveHooks) => {
      hooks = saveHooks;
      return pending.promise;
    });
    const props = render({ onSaveQuickUpdate });
    await settle();
    changeStyle();
    await act(async () => byButton("Review menu change").click());
    act(() => byButton("Save menu change").click());
    await settle();

    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("saving");
    expect(document.body.textContent).toContain("Saving…");
    expect(byButton("Close Quick Updates").disabled).toBe(true);
    expect(byButton("Menu").disabled).toBe(true);
    expect(byButton("Staffing").disabled).toBe(true);
    expect(byButton("Pricing").disabled).toBe(true);
    expect(byButton("Open full Library").disabled).toBe(true);
    expect(document.querySelector(".qup-field select").disabled).toBe(true);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(props.onClose).not.toHaveBeenCalled();
    const unloadWhileSaving = new Event("beforeunload", { cancelable: true });
    act(() => window.dispatchEvent(unloadWhileSaving));
    expect(unloadWhileSaving.defaultPrevented).toBe(true);

    act(() => hooks.onPersisted({ activeVersionId: "version-beta" }));
    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("refreshing");
    expect(document.body.textContent).toContain("Refreshing…");

    await act(async () => pending.resolve({
      status: "saved",
      quote: { ...QUOTE, activeVersionId: "version-beta", event: { ...QUOTE.event, style: "Buffet" } },
      receipt: { activeVersionId: "version-beta" }
    }));
    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("saved");
  });

  test("retains a failed draft and offers authoritative retry and guarded reconciliation", async () => {
    const onPreviewQuickUpdate = vi.fn()
      .mockResolvedValueOnce({ status: "failed", reason: "Authoritative preview is temporarily unavailable." })
      .mockResolvedValueOnce(readyPreview({ previewId: "preview-retry" }));
    const onOpenAuthoritativeEditor = vi.fn();
    render({ onPreviewQuickUpdate, onOpenAuthoritativeEditor });
    await settle();
    changeStyle();
    await act(async () => byButton("Review menu change").click());

    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("failure");
    expect(document.body.textContent).toContain("Your draft still changes Plated dinner to Buffet");
    expect(byButton("Retry authoritative review")).not.toBeUndefined();
    expect(byButton("Continue in quote editor")).not.toBeUndefined();

    act(() => byButton("Continue in quote editor").click());
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(onOpenAuthoritativeEditor).not.toHaveBeenCalled();
    act(() => byButton("Keep editing").click());
    expect(document.body.textContent).toContain("Your draft still changes Plated dinner to Buffet");

    await act(async () => byButton("Retry authoritative review").click());
    expect(onPreviewQuickUpdate).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("review");
    expect(document.body.textContent).toContain("Plated dinner");
    expect(document.body.textContent).toContain("Buffet");
  });

  test("does not claim saved when refreshed quote identity or style is not exact", async () => {
    render({
      onSaveQuickUpdate: vi.fn().mockResolvedValue({
        status: "saved",
        quote: { ...QUOTE, event: { ...QUOTE.event, style: "Plated" } },
        receipt: { activeVersionId: "version-beta" }
      })
    });
    await settle();
    changeStyle();
    await act(async () => byButton("Review menu change").click());
    await act(async () => byButton("Save menu change").click());

    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("uncertain");
    expect(document.body.textContent).toContain("did not confirm the exact menu change");
    expect(document.body.textContent).toContain("A write may have committed");
    expect(byButton("Retry authoritative review")).toBeUndefined();
    expect(byButton("Back to edit")).toBeUndefined();
    expect(byButton("Reconcile in quote editor")).not.toBeUndefined();
  });

  test("treats every failure after the write receipt as reconcile-only uncertainty", async () => {
    render({
      onSaveQuickUpdate: vi.fn(async (_request, hooks) => {
        hooks.onPersisted({
          quoteId: QUOTE.id,
          organizationId: QUOTE.organizationId,
          activeVersionId: "version-beta"
        });
        throw new Error("Authoritative readback timed out after the write returned.");
      })
    });
    await settle();
    changeStyle();
    await act(async () => byButton("Review menu change").click());
    await act(async () => byButton("Save menu change").click());

    expect(document.querySelector(".qup-root")?.dataset.quickUpdatesPhase).toBe("uncertain");
    expect(document.body.textContent).toContain("readback timed out after the write returned");
    expect(document.body.textContent).toContain("Do not retry this request");
    expect(byButton("Retry authoritative review")).toBeUndefined();
    expect(byButton("Reconcile in quote editor")).not.toBeUndefined();
  });
});
