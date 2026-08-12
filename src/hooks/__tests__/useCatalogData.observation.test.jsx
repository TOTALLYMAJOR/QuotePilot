// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildAmbientPackageMenuCatalogEvidence } from "../../lib/ambientPackageMenuCatalogEvidence";
import { beginCatalogReloadState, useCatalogData } from "../useCatalogData";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("catalog observation provenance", () => {
  let container;
  let root;
  let current;

  function CatalogHarness() {
    current = useCatalogData({ enabled: false, organizationId: "org-1" });
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T20:00:00.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<CatalogHarness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    current = null;
  });

  test("acceptCatalogMutation refreshes observedAtISO for each structured catalog mutation receipt", () => {
    expect(current.observedAtISO).toBe("");

    vi.setSystemTime(new Date("2026-08-11T20:05:00.000Z"));
    act(() => current.acceptCatalogMutation({
      catalogSettings: {
        ...current.settings,
        catalogRevision: 7
      }
    }));

    expect(current.observedAtISO).toBe("2026-08-11T20:05:00.000Z");
    expect(current.settings.catalogRevision).toBe(7);
    expect(buildAmbientPackageMenuCatalogEvidence({
      organizationId: "org-1",
      catalog: current
    }).freshness.state).toBe("unknown");

    vi.setSystemTime(new Date("2026-08-11T20:06:30.000Z"));
    act(() => current.acceptCatalogMutation({
      catalogSettings: {
        ...current.settings,
        catalogRevision: 8
      }
    }));

    expect(current.observedAtISO).toBe("2026-08-11T20:06:30.000Z");
    expect(current.settings.catalogRevision).toBe(8);
  });

  test("does not manufacture a new observation without catalogSettings evidence", () => {
    act(() => current.acceptCatalogMutation({
      catalogSettings: {
        ...current.settings,
        catalogRevision: 7
      }
    }));
    const acceptedObservation = current.observedAtISO;

    vi.setSystemTime(new Date("2026-08-11T21:00:00.000Z"));
    act(() => current.acceptCatalogMutation({}));

    expect(current.observedAtISO).toBe(acceptedObservation);
    expect(current.settings.catalogRevision).toBe(7);
  });

  test("a foreground catalog reload makes a previously observed snapshot non-fresh", () => {
    const observed = {
      source: "firebase-org",
      observedAtISO: "2026-08-11T19:55:00.000Z",
      loading: false,
      error: "",
      packages: [{ id: "classic", name: "Classic", active: true }],
      settings: {
        catalogRevision: 6,
        menuSections: []
      }
    };
    const loading = beginCatalogReloadState(observed);
    const evidence = buildAmbientPackageMenuCatalogEvidence({
      organizationId: "org-1",
      catalog: loading
    });

    expect(loading).toMatchObject({ loading: true, observedAtISO: observed.observedAtISO });
    expect(evidence.freshness).toMatchObject({
      state: "unknown",
      observedAtISO: observed.observedAtISO
    });
    expect(evidence.freshness.reason).toContain("still in progress");
  });
});
