// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ProposalComposer from "../ProposalComposerImpl";
import {
  buildDraftSaveBlockers,
  buildSaveActionModel,
  buildSaveBlockerRecovery
} from "../ProposalComposer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMPLETE_FORM = Object.freeze({
  name: "Morgan Lee",
  email: "morgan@example.test",
  eventTypeId: "wedding",
  eventName: "Morgan wedding",
  date: "2026-09-12",
  venue: "Pine Hall"
});

let container;
let root;

function composerProps(overrides = {}) {
  const form = {
    ...COMPLETE_FORM,
    time: "18:00",
    hours: 4,
    guests: 80,
    pkg: "standard",
    style: "Buffet",
    servers: 3,
    chefs: 1,
    bartenders: 0,
    addons: [],
    rentals: [],
    menuItems: ["chicken"],
    addonQuantities: {},
    rentalQuantities: {},
    menuItemQuantities: {},
    payMethod: "card",
    taxRegion: "local",
    seasonProfileId: "auto"
  };
  const settings = {
    brandName: "Test Catering",
    staffingLaborEnabled: true,
    quoteValidityDays: 30,
    taxRegions: [{ id: "local", name: "Local", rate: 0.08 }],
    seasonalProfiles: []
  };
  const menuSections = [{
    id: "mains",
    name: "Mains",
    items: [{ id: "chicken", name: "Roast chicken", price: 12, active: true }]
  }];
  return {
    form,
    totals: {
      guests: 80,
      total: 3200,
      deposit: 960,
      serverRateApplied: 25,
      chefRateApplied: 35,
      bartenderRateApplied: 30
    },
    catalog: {
      packages: [{ id: "standard", name: "Standard", ppp: 40, active: true }],
      addons: [],
      rentals: []
    },
    settings,
    menuSections,
    eventTypes: [
      { id: "wedding", name: "Wedding" },
      { id: "corporate", name: "Corporate" }
    ],
    onFieldChange: vi.fn(),
    onSelectionTouched: vi.fn(),
    onPatchForm: vi.fn(),
    onTemplateChange: vi.fn(),
    onEventTypeChange: vi.fn(),
    onSaveQuote: vi.fn(),
    onGuidedMode: vi.fn(),
    ...overrides
  };
}

async function renderComposer(overrides = {}) {
  const props = composerProps(overrides);
  await act(async () => root.render(React.createElement(ProposalComposer, props)));
  return props;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("Proposal Composer save readiness", () => {
  test("returns no known blockers for a complete current draft", () => {
    expect(buildDraftSaveBlockers({
      form: COMPLETE_FORM,
      totals: { guests: 120 },
      selectedMenuItemCount: 3
    })).toEqual([]);
  });

  test("names client, event, catalog, and menu requirements without claiming server approval", () => {
    expect(buildDraftSaveBlockers({
      form: { email: "not-an-email" },
      totals: { guests: 0 },
      catalogLoading: true,
      selectedMenuItemCount: 0
    }).map((blocker) => blocker.id)).toEqual([
      "catalog-loading",
      "guest-count",
      "client-name",
      "client-email-format",
      "event-type",
      "event-date",
      "event-name",
      "venue",
      "menu-selection"
    ]);
  });

  test("requires a current impact review before later authorization", () => {
    expect(buildDraftSaveBlockers({
      form: COMPLETE_FORM,
      totals: { guests: 120 },
      selectedMenuItemCount: 1,
      changeImpactReviewRequired: true,
      changeImpactAuthorizationRequired: true
    }).map((blocker) => blocker.id)).toEqual(["change-impact-review"]);
  });

  test("keeps every governed review as an explicit save blocker", () => {
    const common = {
      form: COMPLETE_FORM,
      totals: { guests: 120 },
      selectedMenuItemCount: 1
    };
    expect(buildDraftSaveBlockers({
      ...common,
      quoteEditUnavailable: true,
      pilotScenarioReviewPending: true,
      draftIntentReviewPending: true,
      changeImpactReviewRequired: true
    }).map((blocker) => blocker.id)).toEqual([
      "quote-edit-loading",
      "pilot-scenario-review",
      "draft-intent-review",
      "change-impact-review"
    ]);
    expect(buildDraftSaveBlockers({
      ...common,
      changeImpactAuthorizationRequired: true
    })).toEqual([{
      id: "change-impact-authorization",
      message: "Authorize and apply governed dependencies from Change Impact."
    }]);
  });

  test("turns a blocked save into an exact blocker-review action", () => {
    expect(buildSaveActionModel({
      saveBlockers: [
        { id: "client-name", message: "Add the client name." },
        { id: "venue", message: "Add the venue." }
      ]
    })).toEqual({ mode: "review", label: "Review 2 blockers", disabled: false });
    expect(buildSaveActionModel({
      saveBlockers: [],
      saveLabel: "Save Changes",
      saveDisabled: true
    })).toEqual({ mode: "save", label: "Save Changes", disabled: true });
  });

  test("maps resolvable blockers to deterministic domains and exact controls", () => {
    expect(buildSaveBlockerRecovery({ id: "client-email-format" })).toEqual({
      blockerId: "client-email-format",
      domainId: "customer",
      targetSelector: '[data-ambient-action-id="pc-edit-client-email"]',
      activate: true
    });
    expect(buildSaveBlockerRecovery({ id: "menu-selection" })).toEqual({
      blockerId: "menu-selection",
      domainId: "experience",
      targetSelector: '[data-testid="pc-edit-menu"]',
      activate: true,
      editor: "menu",
      focusSelector: "#pc-menu-search"
    });
    expect(buildSaveBlockerRecovery({ id: "catalog-loading" })).toBeNull();
  });

  test("dispatches the save-ready mobile action exactly once", async () => {
    const props = await renderComposer({ saveLabel: "Save changes", saveBlockers: [] });

    await act(async () => container.querySelector('[data-testid="pc-save-mobile"]').click());

    expect(props.onSaveQuote).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="pc-save-mobile"]').textContent).toBe("Save changes");
  });

  test("never saves from a blocked mobile action and sends recovery to the exact editor", async () => {
    const props = await renderComposer({
      saveBlockers: [{ id: "client-name", message: "Add the client name." }]
    });

    await act(async () => container.querySelector('[data-testid="pc-save-mobile"]').click());
    expect(props.onSaveQuote).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="pc-pulse"]').classList.contains("is-open")).toBe(true);

    await act(async () => {
      const recoveryAction = container.querySelector('[data-testid="pc-save-blocker-action-client-name"]');
      expect(recoveryAction.getAttribute("aria-label")).toBe("Fix now: Add the client name.");
      recoveryAction.click();
    });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 10)));

    expect(container.querySelector('[data-testid="pc-pulse"]').classList.contains("is-open")).toBe(false);
    const clientEditor = container.querySelector('[data-workbench-panel="customer"] .ambient-inline-value--editing input');
    expect(clientEditor).toBeTruthy();
    expect(document.activeElement).toBe(clientEditor);
    expect(props.onSaveQuote).not.toHaveBeenCalled();
  });
});
