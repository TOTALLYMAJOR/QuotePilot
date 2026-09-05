// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildAmbientPackageMenuCatalogEvidence } from "../../lib/ambientPackageMenuCatalogEvidence";

const catalogReadMocks = vi.hoisted(() => ({
  collection: vi.fn((...path) => ({ path })),
  doc: vi.fn((...path) => ({ path })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn((reference) => reference)
}));

vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal()),
  collection: catalogReadMocks.collection,
  doc: catalogReadMocks.doc,
  getDoc: catalogReadMocks.getDoc,
  getDocs: catalogReadMocks.getDocs,
  query: catalogReadMocks.query
}));

vi.mock("../../lib/firebase", async (importOriginal) => ({
  ...(await importOriginal()),
  db: { test: true },
  firebaseReady: true
}));

import {
  beginCatalogReloadState,
  createCatalogReloadCoordinator,
  useCatalogData
} from "../useCatalogData";

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

describe("catalog reload completion contract", () => {
  let container;
  let root;
  let current;

  function CatalogHarness() {
    current = useCatalogData({ enabled: true, organizationId: "org-1" });
    return null;
  }

  function emptyQuerySnapshot() {
    return { docs: [] };
  }

  function settingsSnapshot() {
    return {
      exists: () => true,
      data: () => ({
        catalogRevision: 4,
        eventTemplates: [],
        menuSections: []
      })
    };
  }

  async function mountLoadedCatalog() {
    catalogReadMocks.getDocs.mockResolvedValue(emptyQuerySnapshot());
    catalogReadMocks.getDoc.mockResolvedValue(settingsSnapshot());
    await act(async () => {
      root.render(<CatalogHarness />);
    });
    expect(current.loading).toBe(false);
    expect(current.source).toBe("firebase-org-empty");
    catalogReadMocks.getDocs.mockClear();
    catalogReadMocks.getDoc.mockClear();
  }

  beforeEach(() => {
    catalogReadMocks.collection.mockClear();
    catalogReadMocks.doc.mockClear();
    catalogReadMocks.getDoc.mockReset();
    catalogReadMocks.getDocs.mockReset();
    catalogReadMocks.query.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    current = null;
  });

  test("reload stays pending until the successful read is committed to hook state", async () => {
    await mountLoadedCatalog();
    const previousVersion = current.authoritativeVersion;
    let releaseRead;
    const pendingRead = new Promise((resolve) => {
      releaseRead = resolve;
    });
    catalogReadMocks.getDocs.mockImplementation(() => pendingRead);
    catalogReadMocks.getDoc.mockResolvedValue(settingsSnapshot());

    let reloadPromise;
    let stateAtResolution = null;
    act(() => {
      reloadPromise = current.reload({ background: true });
      reloadPromise.then(() => {
        stateAtResolution = current;
      });
    });

    await Promise.resolve();
    expect(stateAtResolution).toBeNull();
    expect(current.authoritativeVersion).toBe(previousVersion);

    await act(async () => {
      releaseRead(emptyQuerySnapshot());
      await pendingRead;
    });

    await expect(reloadPromise).resolves.toMatchObject({
      source: "firebase-org-empty"
    });
    expect(stateAtResolution.authoritativeVersion).toBe(previousVersion + 1);
    expect(stateAtResolution.source).toBe("firebase-org-empty");
  });

  test("reload rejects with the exact read error after the failure state is committed", async () => {
    await mountLoadedCatalog();
    const readError = new Error("Catalog read exploded.");
    catalogReadMocks.getDocs
      .mockRejectedValueOnce(readError)
      .mockResolvedValue(emptyQuerySnapshot());
    catalogReadMocks.getDoc.mockResolvedValue(settingsSnapshot());

    let reloadPromise;
    act(() => {
      reloadPromise = current.reload({ background: true });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await expect(reloadPromise).rejects.toBe(readError);
    expect(current.error).toBe(readError.message);
  });

  test("newer requests supersede older promises and unmount cancels the survivor", async () => {
    const coordinator = createCatalogReloadCoordinator();
    const first = coordinator.request({ scopeKey: "enabled:org-1" });
    const second = coordinator.request({ scopeKey: "enabled:org-1" });

    await expect(first.promise).rejects.toMatchObject({
      code: "catalog_reload_superseded"
    });
    coordinator.dispose();
    await expect(second.promise).rejects.toMatchObject({
      code: "catalog_reload_unmounted"
    });
  });
});
