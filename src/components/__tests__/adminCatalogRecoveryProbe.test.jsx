// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const setupDraft = vi.hoisted(() => ({ current: null }));

vi.mock("firebase/storage", () => ({
  getDownloadURL: vi.fn(),
  ref: vi.fn(),
  uploadBytes: vi.fn()
}));

vi.mock("../../lib/firebase", () => ({
  firebaseReady: true,
  storage: {}
}));

vi.mock("../../hooks/useCatalogSetupDraft", () => ({
  useCatalogSetupDraft: () => setupDraft.current
}));

vi.mock("../../lib/menuService", () => ({
  getEventTypes: vi.fn(),
  getMenuCategories: vi.fn(),
  getMenuItems: vi.fn()
}));

import { AdminCatalogView } from "../AdminCatalogModal";
import {
  getEventTypes,
  getMenuCategories,
  getMenuItems
} from "../../lib/menuService";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CATALOG = Object.freeze({
  source: "firebase-org",
  authoritativeVersion: 4,
  packages: Object.freeze([
    Object.freeze({ id: "classic", name: "Classic", ppp: 25, active: true })
  ]),
  addons: Object.freeze([]),
  rentals: Object.freeze([]),
  settings: Object.freeze({
    catalogRevision: 4,
    pricingSetupConfirmed: true
  })
});

let container;
let root;

function draftController() {
  return {
    status: "idle",
    label: "Draft saved",
    generation: 0,
    changedRecordCount: 0,
    serverChanges: [],
    deviceChanges: [],
    changes: [],
    deviceOnly: false,
    error: "",
    receipt: null,
    queueChanges: vi.fn(() => true),
    discardDeviceChanges: vi.fn(() => true),
    syncNow: vi.fn(async () => ({ ok: true })),
    retry: vi.fn(async () => ({ ok: true })),
    review: vi.fn(async () => ({ readyToPublish: true })),
    publish: vi.fn(async () => ({ catalogRevisionAfter: 5 }))
  };
}

function mount({ organizationId = "org-alpha" } = {}) {
  act(() => {
    root.render(
      <AdminCatalogView
        open
        catalog={CATALOG}
        organizationId={organizationId}
        catalogSetupDraftController={setupDraft.current}
        onClose={() => {}}
        onSave={async () => ({ ok: true })}
        onApplyStarterPack={async () => ({ ok: true })}
        saving={false}
      />
    );
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    await Promise.resolve();
  });
}

beforeEach(() => {
  setupDraft.current = draftController();
  vi.mocked(getEventTypes).mockReset();
  vi.mocked(getMenuCategories).mockReset();
  vi.mocked(getMenuItems).mockReset();
  vi.mocked(getEventTypes).mockResolvedValue([{ id: "dinner", name: "Dinner" }]);
  vi.mocked(getMenuCategories).mockResolvedValue([{ id: "entrees", name: "Entrees" }]);
  vi.mocked(getMenuItems).mockResolvedValue([{ id: "chicken", name: "Herb chicken" }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Admin catalog confirmed-menu recovery probe", () => {
  test("shows a confirmed false result when menu recovery is not needed", async () => {
    mount();
    await settle();

    const result = container.querySelector('[data-menu-recovery-probe-state="present"]');
    expect(result).not.toBeNull();
    expect(result.textContent).toContain("Confirmed");
    expect(result.textContent).toContain("menu records are present");
    expect(container.querySelector('[data-menu-recovery-probe-state="empty"]')).toBeNull();
    expect(result.querySelector("button")).toBeNull();
  });

  test("keeps a failed probe distinct and retries it to a confirmed result", async () => {
    vi.mocked(getEventTypes).mockRejectedValue(new Error("Menu inventory read timed out."));
    mount();
    await settle();

    let result = container.querySelector('[data-menu-recovery-probe-state="failed"]');
    expect(result).not.toBeNull();
    expect(result.textContent).toContain("Failed");
    expect(result.textContent).toContain("Menu inventory read timed out.");

    vi.mocked(getEventTypes).mockResolvedValue([{ id: "dinner", name: "Dinner" }]);
    await act(async () => {
      result.querySelector("button").click();
      await Promise.resolve();
    });
    await settle();

    result = container.querySelector('[data-menu-recovery-probe-state="present"]');
    expect(result).not.toBeNull();
    expect(result.textContent).toContain("menu records are present");
  });

  test("explains when the probe is unavailable and keeps an explicit retry", async () => {
    mount({ organizationId: "" });
    await settle();

    const result = container.querySelector('[data-menu-recovery-probe-state="unavailable"]');
    expect(result).not.toBeNull();
    expect(result.textContent).toContain("Unavailable");
    expect(result.textContent).toContain("Choose an organization");
    expect(result.querySelector("button")?.textContent).toContain("Retry menu check");
  });

  test("keeps an empty confirmed inventory on the existing additive recovery path", async () => {
    vi.mocked(getMenuCategories).mockResolvedValue([]);
    vi.mocked(getMenuItems).mockResolvedValue([]);
    mount();
    await settle();

    const result = container.querySelector('[data-menu-recovery-probe-state="empty"]');
    expect(result).not.toBeNull();
    expect(result.textContent).toContain("confirmed catalog has no menu");
    expect(result.textContent).toContain("Choose a setup option");
  });
});
