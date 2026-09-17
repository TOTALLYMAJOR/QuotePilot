// @vitest-environment jsdom
import React, { act, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ProposalComposer, { QuoteEditorModeSurface } from "../ProposalComposer";
import { StepMenu, StepReview, StepServices } from "../WizardSteps";
import { buildAmbientLivingOpportunityPresentation } from "../ambientLivingOpportunityPresentation";
import {
  resolveQuoteWizardCompletionDestination,
  scheduleQuoteCompletionDestinationFocus
} from "../../lib/quoteCompletionDestination";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const form = {
  name: "Morgan Lee",
  email: "morgan@example.test",
  eventTypeId: "wedding",
  eventName: "Morgan wedding",
  date: "2026-09-12",
  time: "18:00",
  venue: "Pine Hall",
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
const totals = {
  guests: 80,
  total: 3200,
  deposit: 960,
  base: 2200,
  labor: 500,
  bartenderLabor: 0,
  travel: 0,
  tax: 200,
  serviceFee: 300,
  serviceFeePctApplied: 0.1,
  taxRateApplied: 0.08,
  addons: 0,
  rentals: 0,
  menu: 0,
  serverRateApplied: 25,
  chefRateApplied: 35,
  bartenderRateApplied: 30
};
const settings = {
  brandName: "Test Catering",
  staffingLaborEnabled: true,
  quoteValidityDays: 30,
  depositPct: 0.3,
  taxRegions: [{ id: "local", name: "Local", rate: 0.08 }],
  seasonalProfiles: [],
  menuSections: [{
    id: "mains",
    name: "Mains",
    items: [{ id: "chicken", name: "Roast chicken", price: 12, active: true }]
  }]
};
const readiness = {
  score: 100,
  complete: true,
  gaps: [],
  recommendedGaps: [],
  status: { id: "ready", label: "Ready to send" }
};

const catalog = {
  packages: [
    { id: "standard", name: "Standard", ppp: 40, active: true },
    { id: "premium", name: "Premium", ppp: 55, active: true }
  ],
  addons: [],
  rentals: [],
  settings
};

const composerMenuDestination = Object.freeze({
  surfaceId: "proposal-composer",
  step: 3,
  domainId: "experience",
  selector: '[data-testid="pc-edit-menu"]',
  focusSelector: "#pc-menu-search",
  activate: true
});

const composerExperienceDestination = Object.freeze({
  surfaceId: "proposal-composer",
  step: 2,
  domainId: "experience",
  selector: '[data-testid="pc-edit-experience"]',
  activate: true
});

function composerProps(overrides = {}) {
  return {
    form,
    totals,
    readiness,
    catalog: {
      packages: [{ id: "standard", name: "Standard", ppp: 40, active: true }],
      addons: [],
      rentals: []
    },
    settings,
    menuSections: settings.menuSections,
    eventTypes: [{ id: "wedding", name: "Wedding" }],
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

function ActualConditionalEditorSurface({ mode, destination }) {
  const [step, setStep] = useState(4);
  const [editorForm, setEditorForm] = useState(form);
  const editorRoot = useRef(null);

  useEffect(() => {
    scheduleQuoteCompletionDestinationFocus(destination, {
      editorMode: mode,
      root: editorRoot,
      setStep
    });
  }, [destination, mode]);

  return (
    <main ref={editorRoot} data-testid={`${mode}-editor-surface`}>
      <QuoteEditorModeSurface
        composerActive={mode === "composer"}
        composerSurface={<ProposalComposer {...composerProps({ form: editorForm })} />}
      >
        {step === 2 ? (
          <StepMenu
            form={editorForm}
            setForm={setEditorForm}
            menuSections={settings.menuSections}
            catalog={catalog}
            pricingSettings={settings}
            totals={totals}
            eventTypeLabel="Wedding"
            onSelectionTouched={vi.fn()}
          />
        ) : step === 3 ? (
          <StepServices
            form={editorForm}
            setForm={setEditorForm}
            catalog={catalog}
            recommendations={[]}
            guidedSellingEnabled={false}
            aiAssistEnabled={false}
            onSelectionTouched={vi.fn()}
            totals={totals}
            pricingSettings={settings}
          />
        ) : (
          <StepReview form={editorForm} totals={totals} settings={settings} readiness={readiness} />
        )}
      </QuoteEditorModeSurface>
    </main>
  );
}

function installFrameQueue() {
  const frames = [];
  window.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  return frames;
}

async function flushNextFrame(frames) {
  const pending = frames.splice(0);
  await act(async () => pending.forEach((callback) => callback(performance.now())));
}

let container;
let root;

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

describe("quote completion surface integrations", () => {
  test("Proposal Composer keeps the command path absent by default and uses it when enabled", async () => {
    await act(async () => root.render(<ProposalComposer {...composerProps()} />));
    expect(container.querySelector('[data-capability-id="quote-completion-command-path"]')).toBeNull();

    const props = composerProps({
      quoteCompletionCommandPathEnabled: true,
      quoteDirty: true
    });
    await act(async () => {
      root.render(<ProposalComposer {...props} />);
      await vi.dynamicImportSettled();
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-capability-id="quote-completion-command-path"]')).not.toBeNull();
    });
    const panel = container.querySelector('[data-capability-id="quote-completion-command-path"]');
    expect(panel?.getAttribute("data-capability-state")).toBe("review_required");
    expect(panel?.querySelector("button")?.textContent).toContain("Save exact revision");

    await act(async () => panel.querySelector("button").click());
    expect(props.onSaveQuote).toHaveBeenCalledTimes(1);
  });

  test("Proposal Composer reserves rejecting save propagation for the command runner", async () => {
    const directSave = vi.fn(() => Promise.resolve({ status: "saved" }));
    const commandSave = vi.fn(() => Promise.reject(new Error("save receipt unavailable")));
    const props = composerProps({
      onSaveQuote: directSave,
      onQuoteCompletionSave: commandSave,
      quoteDirty: true
    });

    await act(async () => root.render(<ProposalComposer {...props} />));
    await act(async () => {
      container.querySelector('[data-testid="pc-save-header"]').click();
      await Promise.resolve();
    });
    expect(directSave).toHaveBeenCalledOnce();
    expect(commandSave).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<ProposalComposer {...props} quoteCompletionCommandPathEnabled />);
      await vi.dynamicImportSettled();
    });
    await act(async () => {
      container.querySelector('[data-capability-id="quote-completion-command-path"] button').click();
      await Promise.resolve();
    });
    expect(commandSave).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-capability-id="quote-completion-command-path"]')?.dataset.commandState)
      .toBe("failure");
  });

  test("Proposal Composer continues a saved revision through the governed configured destination", async () => {
    const onQuoteCompletionNavigate = vi.fn(() => ({
      status: "pending",
      message: "Opening exact quote administration."
    }));
    const props = composerProps({
      quoteCompletionCommandPathEnabled: true,
      quoteDirty: false,
      saveMessage: "Editing Q-1. Save will update this quote.",
      editingQuote: {
        id: "quote-1",
        activeVersionId: "v0001",
        status: "draft"
      },
      quoteCompletionConfiguredActions: {
        state: { versionSaved: true, providerAccepted: false },
        actions: {
          send_quote: {
            id: "send_quote",
            label: "Send proposal",
            visible: true,
            enabled: true
          }
        },
        primaryAction: {
          id: "send_quote",
          label: "Send proposal",
          visible: true,
          enabled: true
        }
      },
      onQuoteCompletionNavigate
    });
    await act(async () => {
      root.render(<ProposalComposer {...props} />);
      await vi.dynamicImportSettled();
    });
    const panel = container.querySelector('[data-capability-id="quote-completion-command-path"]');

    expect(panel?.dataset.capabilityState).toBe("sendable");
    expect(panel?.querySelector("button")?.disabled).toBe(false);
    expect(panel?.querySelector("button")?.textContent).toContain("Send proposal");
    await act(async () => panel.querySelector("button").click());

    expect(onQuoteCompletionNavigate).toHaveBeenCalledWith(expect.objectContaining({
      id: "send_quote",
      kind: "send_proposal",
      destination: expect.objectContaining({
        surfaceId: "quote-administration",
        quoteId: "quote-1"
      })
    }));
    expect(panel.dataset.commandState).toBe("success");
  });

  test("Proposal Composer opens and focuses its exact Living evidence destination", async () => {
    const props = composerProps({
      quoteCompletionCommandPathEnabled: true,
      quoteDirty: false,
      editingQuote: { id: "quote-1", activeVersionId: "v0001", status: "draft" },
      quoteCompletionConfiguredActions: {
        state: { versionSaved: true, providerAccepted: false },
        actions: {},
        primaryAction: null
      },
      livingCommercialTwin: {
        scopeKey: "org-1:quote-1:v0001",
        baseQuoteRevisionId: "v0001",
        currentGuestCount: 80,
        proposedGuestCount: 80,
        projection: {
          state: "stale",
          reason: "The consequence evidence is stale.",
          nextAction: { label: "Review current evidence" }
        }
      }
    });
    await act(async () => {
      root.render(<ProposalComposer {...props} />);
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const panel = container.querySelector('[data-capability-id="quote-completion-command-path"]');
    const evidence = container.querySelector('[data-capability-id="commercial-scenario-workbench"]');

    expect(panel?.querySelector("button")?.textContent).toContain("Review current evidence");
    expect(evidence).not.toBeNull();
    await act(async () => panel.querySelector("button").click());

    expect(panel.dataset.commandState).toBe("success");
    expect(evidence.contains(document.activeElement) || document.activeElement === evidence).toBe(true);
  });

  test("review step replaces the legacy percentage as primary UX only when enabled", async () => {
    const legacy = renderToStaticMarkup(
      <StepReview form={form} totals={totals} settings={settings} readiness={readiness} />
    );
    await act(async () => {
      root.render(<StepReview
        form={form}
        totals={totals}
        settings={settings}
        readiness={readiness}
        quoteCompletionCommandPathEnabled
      />);
      await vi.dynamicImportSettled();
    });
    const enabled = container.innerHTML;

    expect(legacy).toContain("Proposal readiness");
    expect(legacy).toContain("<progress");
    expect(enabled).not.toContain("Proposal readiness");
    expect(enabled).not.toContain("<progress");
    expect(enabled).toContain('data-capability-id="quote-completion-command-path"');
    expect(enabled).toContain("Compatibility details");
  });

  test("guided editor receives the menu destination at its actual step and focuses its search", async () => {
    const frames = installFrameQueue();
    expect(resolveQuoteWizardCompletionDestination(composerMenuDestination)).toMatchObject({
      surfaceId: "quote-wizard",
      step: 2,
      selector: '[data-ambient-field="menuItems"]'
    });

    await act(async () => root.render(
      <ActualConditionalEditorSurface mode="guided" destination={composerMenuDestination} />
    ));
    await flushNextFrame(frames);
    await flushNextFrame(frames);

    const menuSearch = container.querySelector('[data-ambient-field="menuItems"] input[type="search"]');
    expect(menuSearch).not.toBeNull();
    expect(container.querySelector('[data-ambient-field="pkg"]')).toBeNull();
    expect(document.activeElement).toBe(menuSearch);
  });

  test("guided editor receives the package destination at its actual services step", async () => {
    const frames = installFrameQueue();
    expect(resolveQuoteWizardCompletionDestination(composerExperienceDestination)).toMatchObject({
      surfaceId: "quote-wizard",
      step: 3,
      selector: '[data-ambient-field="pkg"]'
    });

    await act(async () => root.render(
      <ActualConditionalEditorSurface mode="guided" destination={composerExperienceDestination} />
    ));
    await flushNextFrame(frames);
    await flushNextFrame(frames);

    const packageSelect = container.querySelector('[data-ambient-field="pkg"]');
    expect(packageSelect).not.toBeNull();
    expect(container.querySelector('[data-ambient-field="menuItems"]')).toBeNull();
    expect(document.activeElement).toBe(packageSelect);
  });

  test("Composer editor preserves and focuses its own destination without wizard translation", async () => {
    const frames = installFrameQueue();
    await act(async () => root.render(
      <ActualConditionalEditorSurface mode="composer" destination={composerMenuDestination} />
    ));
    await flushNextFrame(frames);
    await flushNextFrame(frames);

    const composerSearch = container.querySelector("#pc-menu-search");
    expect(container.querySelector('[data-testid="pc-edit-menu"]')).not.toBeNull();
    expect(container.querySelector('[data-ambient-field="menuItems"]')).toBeNull();
    expect(composerSearch).not.toBeNull();
    expect(container.querySelector('[data-testid="commercial-workbench-object"]')?.getAttribute("data-active-domain"))
      .toBe("experience");
    expect(container.querySelector('[data-testid="workbench-domain-experience"]')?.getAttribute("aria-current"))
      .toBe("step");
    expect(document.activeElement).toBe(composerSearch);
  });

  test("Ambient presentation composes configured actions only behind the gate", () => {
    const quote = {
      id: "quote-1",
      organizationId: "org-1",
      quoteNumber: "Q-1",
      activeVersionId: "v0001",
      updatedAtISO: "2026-09-12T18:00:00.000Z",
      portalKey: "portal-key-for-current-revision-12345",
      portalIssuedAtISO: "2026-09-12T18:00:00.000Z",
      portalExpiresAtISO: "2026-10-12T18:00:00.000Z",
      status: "draft",
      customer: { name: "Morgan Lee", email: "morgan@example.test" },
      event: {
        name: "Morgan wedding",
        date: "2026-09-12",
        time: "18:00",
        venue: "Pine Hall",
        hours: 4,
        guests: 80
      },
      selection: {
        packageId: "standard",
        packageName: "Standard",
        menuItems: ["chicken"],
        menuItemNames: ["Roast chicken"]
      },
      totals: { total: 3200, deposit: 960 },
      pricing: {
        authority: "server_authoritative",
        calculatedAt: "2026-09-12T17:00:00.000Z",
        grandTotal: 3200
      }
    };
    const configuredActions = {
      state: { versionSaved: true, providerAccepted: false },
      actions: {
        send_quote: { id: "send_quote", label: "Send proposal", visible: true, enabled: true }
      },
      primaryAction: { id: "send_quote", label: "Send proposal", visible: true, enabled: true }
    };
    const options = {
      source: "firebase",
      sourceFreshness: "fresh",
      role: "admin",
      ordinaryEditAllowed: true,
      now: new Date("2026-09-13T12:00:00.000Z"),
      configuredActions
    };

    expect(buildAmbientLivingOpportunityPresentation(quote, options).quoteCompletion).toBeNull();
    expect(buildAmbientLivingOpportunityPresentation(quote, {
      ...options,
      quoteCompletionCommandPathEnabled: true
    }).quoteCompletion).toMatchObject({
      schemaVersion: "quote-completion-contract-v1",
      state: "sendable",
      nextAction: { id: "send_quote" }
    });
  });
});
