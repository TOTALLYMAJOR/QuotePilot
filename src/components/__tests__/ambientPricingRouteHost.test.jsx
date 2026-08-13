// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  childProps: null,
  prepare: vi.fn(),
  savedMargin: vi.fn(),
  simulate: vi.fn(),
  createRequestId: vi.fn(() => "change_sim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
  isDefinitive: vi.fn(() => false)
}));

vi.mock("../../lib/ambientPricingPreview", () => ({
  prepareAmbientPricingPreview: mocks.prepare,
  buildSavedAmbientPricingMargin: mocks.savedMargin
}));

vi.mock("../../lib/commercialChangeAuthorityClient", () => ({
  simulateCommercialQuoteChange: mocks.simulate,
  buildCommercialChangeRequestId: mocks.createRequestId,
  isDefinitiveCommercialChangeError: mocks.isDefinitive
}));

vi.mock("../AmbientLivingOpportunity", async () => {
  const ReactModule = await import("react");
  return {
    default: ReactModule.forwardRef(function AmbientLivingOpportunityProbe(props, ref) {
      mocks.childProps = props;
      return (
        <main
          ref={ref}
          data-testid="ambient-pricing-route-probe"
          data-pricing-preview-available={String(props.pricingPreviewAvailable)}
          data-pricing-margin={props.pricingMargin?.evidenceCode || "available"}
        />
      );
    })
  };
});

import AmbientLivingOpportunityRoute from "../AmbientLivingOpportunityRoute";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUOTE = Object.freeze({
  id: "quote-route-pricing",
  organizationId: "org-alpha",
  activeVersionId: "v0012",
  event: Object.freeze({ name: "Autumn Benefit", guests: 120 }),
  selection: Object.freeze({ packageId: "classic" })
});
const CATALOG = Object.freeze({
  source: "firebase-org",
  observedAtISO: "2026-08-11T20:15:00.000Z",
  packages: Object.freeze([{ id: "classic" }]),
  settings: Object.freeze({ catalogRevision: 12, menuSections: Object.freeze([]) })
});
const SETTINGS = Object.freeze({ currency: "USD" });

function ambientContext(role = "sales") {
  return {
    organizationId: "org-alpha",
    role,
    route: "/app/quotes/quote-route-pricing",
    activeOpportunityId: QUOTE.id,
    selectedObject: { id: QUOTE.id, type: "opportunity", label: "Autumn Benefit" },
    revision: "v0012",
    sourceFreshness: { state: "unknown", reason: "Test fixture has no observation time." },
    pendingPreview: null
  };
}

describe("Ambient Living Opportunity pricing host", () => {
  let container;
  let root;

  beforeEach(() => {
    mocks.childProps = null;
    mocks.prepare.mockReset().mockResolvedValue({ schemaVersion: "ambient-pricing-preview-host-v1" });
    mocks.savedMargin.mockReset().mockReturnValue({ available: false, evidenceCode: "cost_evidence_incomplete" });
    mocks.simulate.mockReset();
    mocks.createRequestId.mockClear();
    mocks.isDefinitive.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(overrides = {}) {
    act(() => root.render(
      <AmbientLivingOpportunityRoute
        quote={QUOTE}
        source="local"
        ordinaryEditAllowed
        ambientContext={ambientContext()}
        ambientPricingCatalog={CATALOG}
        ambientPricingSettings={SETTINGS}
        {...overrides}
      />
    ));
  }

  test("attaches staff-only saved margin evidence and a deterministic local preview host", async () => {
    render();

    expect(container.querySelector("main")?.getAttribute("data-pricing-preview-available")).toBe("true");
    expect(container.querySelector("main")?.getAttribute("data-pricing-margin")).toBe("cost_evidence_incomplete");
    expect(mocks.savedMargin).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-alpha",
      quote: QUOTE,
      catalog: CATALOG,
      settings: SETTINGS,
      evaluateMargin: expect.any(Function)
    }));
    expect(mocks.childProps.packageMenuCatalogEvidence).toMatchObject({
      organizationId: "org-alpha",
      sourceLabel: "firebase-org",
      catalogRevision: 12,
      freshness: {
        state: "fresh",
        observedAtISO: "2026-08-11T20:15:00.000Z"
      }
    });

    await act(async () => {
      await mocks.childProps.onSimulatePricing({ guestCount: 140, requestId: "" });
    });
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      source: "local",
      organizationId: "org-alpha",
      quote: QUOTE,
      guestCount: 140,
      requestId: "",
      catalog: CATALOG,
      settings: SETTINGS,
      evaluateMargin: expect.any(Function)
    }));
    const localInput = mocks.prepare.mock.calls[0][0];
    expect(localInput.simulate).toBeUndefined();
    expect(localInput.createRequestId).toBeUndefined();
  });

  test("fails closed when role context is omitted or non-staff", () => {
    render({ ambientContext: null });
    expect(mocks.childProps.pricingPreviewAvailable).toBe(false);
    expect(mocks.childProps.onSimulatePricing).toBeUndefined();
    expect(mocks.childProps.pricingMargin).toBeNull();
    expect(mocks.savedMargin).not.toHaveBeenCalled();

    render({ ambientContext: ambientContext("customer") });
    expect(mocks.childProps.pricingPreviewAvailable).toBe(false);
    expect(mocks.childProps.onSimulatePricing).toBeUndefined();
    expect(mocks.childProps.pricingMargin).toBeNull();
  });

  test("does not enable a scenario when the exact saved package is absent from the loaded catalog", () => {
    render({ ambientPricingCatalog: { packages: [{ id: "different-package" }] } });

    expect(mocks.childProps.pricingPreviewAvailable).toBe(false);
    expect(mocks.childProps.onSimulatePricing).toBeUndefined();
    expect(mocks.childProps.pricingMargin).toEqual(expect.objectContaining({
      evidenceCode: "cost_evidence_incomplete"
    }));
  });

  test("injects the existing governed Commercial Change client only for the exact Firebase source", async () => {
    render({ source: "firebase" });

    await act(async () => {
      await mocks.childProps.onSimulatePricing({
        guestCount: 150,
        requestId: "change_sim_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      });
    });
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      source: "firebase",
      requestId: "change_sim_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      simulate: mocks.simulate,
      createRequestId: mocks.createRequestId,
      isDefinitiveError: mocks.isDefinitive
    }));
  });
});
