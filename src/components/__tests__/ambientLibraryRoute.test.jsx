// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const navigationHarness = vi.hoisted(() => ({ current: null }));

vi.mock("../../context/WorkspaceNavigationContext", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useOptionalWorkspaceNavigation: () => navigationHarness.current
  };
});

vi.mock("../AdminCatalogModal", async () => {
  const ReactModule = await import("react");
  return {
    AdminCatalogView: function MockAdminCatalogView(props) {
      const handledRef = ReactModule.useRef("");
      ReactModule.useEffect(() => {
        if (!props.focusRequest?.requestId || handledRef.current === props.focusRequest.requestId) return;
        handledRef.current = props.focusRequest.requestId;
        props.onFocusResolution?.({
          requestId: props.focusRequest.requestId,
          status: "focused",
          result: "context",
          object: {
            type: props.focusRequest.recordId ? "event-template" : "library-section",
            id: props.focusRequest.recordId || props.focusRequest.sectionId
          },
          nextResolutions: ["Review the focused object"]
        });
      }, [props.focusRequest, props.onFocusResolution]);
      ReactModule.useEffect(() => {
        props.onInteractionStateChange?.({ dirty: false, busy: false });
      }, [props.onInteractionStateChange]);
      if (!props.open) return null;
      return (
        <div
          data-testid="catalog-editor"
          data-section-id={props.focusRequest?.sectionId}
          data-record-id={props.focusRequest?.recordId}
          data-surface-title={props.surfaceTitle}
          data-recipe-extension={props.inventoryRecipeExtension?.enabled ? "enabled" : "disabled"}
        >
          Catalog editor
          <button type="button" onClick={props.onClose}>Back</button>
          <button
            type="button"
            data-testid="mock-pricing-tab"
            onClick={() => props.onActiveTabChange?.("pricing")}
          >Pricing tab</button>
        </div>
      );
    }
  };
});

import AmbientLibraryRoute from "../AmbientLibraryRoute";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CATALOG = {
  source: "firebase-org",
  observedAtISO: "2026-08-12T15:00:00.000Z",
  loading: false,
  saving: false,
  error: "",
  packages: [{ id: "package-plated", name: "Plated dinner", active: true }],
  addons: [{ id: "addon-dessert", name: "Dessert", active: true }],
  rentals: [{ id: "rental-linen", name: "Linens", active: true }],
  eventTypes: [{ id: "wedding", name: "Wedding", active: true }],
  settings: {
    catalogRevision: 7,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "admin-1",
      actorEmail: "admin@example.test",
      confirmedAtISO: "2026-08-12T14:55:00.000Z",
      confirmedCatalogRevision: 7
    },
    menuSections: [],
    taxRegions: [],
    seasonalProfiles: [],
    bartenderRateTypes: [],
    staffingRateTypes: [],
    eventTemplates: [{
      id: "wedding",
      name: "Wedding",
      style: "Plated",
      pkg: "package-plated",
      eventTypeId: "wedding",
      addons: ["addon-dessert"],
      rentals: ["rental-linen"],
      menuItems: ["menu-chicken"]
    }]
  }
};

const QUOTE_READY_CATALOG = {
  ...CATALOG,
  organizationName: "QuotePilot Catering",
  packages: [{ id: "package-plated", name: "Plated dinner", ppp: 42, active: true }],
  managedMenuItems: [{ id: "menu-chicken", name: "Chicken", cost: null, active: true }],
  settings: {
    ...CATALOG.settings,
    organizationName: "QuotePilot Catering",
    serviceFeePct: 0.2,
    taxRate: 0.08,
    depositPct: 0.3,
    perMileRate: 1,
    longDistancePerMileRate: 1,
    serverRate: 40,
    chefRate: 50,
    bartenderRate: 45,
    staffingLaborEnabled: false
  }
};

const BASE_PROPS = {
  open: true,
  catalog: CATALOG,
  organizationId: "org-library",
  currentUserRole: "admin",
  onClose: () => {},
  onSave: async () => ({ ok: true }),
  onReload: () => {},
  saving: false
};

let container;
let root;

beforeEach(() => {
  navigationHarness.current = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(props = {}) {
  act(() => root.render(<AmbientLibraryRoute {...BASE_PROPS} {...props} />));
}

async function settleEditorOpen() {
  await vi.waitFor(async () => {
    // Arrival schedules a frame and a subsequent task; flush React and wait
    // for the observable editor instead of assuming a frame fits in 40ms.
    await act(async () => {});
    expect(container.querySelector('[data-testid="catalog-editor"]')).not.toBeNull();
  }, { timeout: 3000 });
}

describe("AmbientLibraryRoute", () => {
  test("renders the selected commercial hierarchy with Library dominant and readiness secondary", () => {
    mount();

    const library = container.querySelector(".ambient-library");
    expect(library.dataset.surfaceContractId).toBe("ambient-library");
    expect(library.dataset.libraryContext).toBe("standalone");
    expect(container.querySelector("#ambient-library-title").textContent).toBe("The choices behind every quote.");
    expect(container.textContent).toContain("Define what you sell, what it is made from, where you start, and how it is governed");
    expect(container.querySelector('[data-library-workspace="commercial"]')).not.toBeNull();
    expect(container.querySelector(".ambient-library__catalog-column")).not.toBeNull();
    expect(container.querySelector("[data-library-readiness-rail]")).not.toBeNull();
    const readinessRail = container.querySelector("[data-library-readiness-rail]");
    const catalogColumn = container.querySelector(".ambient-library__catalog-column");
    expect(readinessRail.compareDocumentPosition(catalogColumn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).toContain("Offers");
    expect(container.textContent).toContain("Components");
    expect(container.textContent).toContain("Templates");
    expect(container.textContent).toContain("Pricing & rules");
    expect(container.querySelector('[data-library-record-id="rules"]')).not.toBeNull();
    expect(container.querySelector('[data-library-section="catalog"]')).not.toBeNull();
    expect(container.querySelector('[data-library-section="components"]')).not.toBeNull();
    expect(container.querySelector('[data-library-section="templates"]')).not.toBeNull();
    expect(container.querySelector('[data-library-section="policy"]')).not.toBeNull();
    expect(container.querySelector('[data-library-record-kind="event-template"][data-library-record-id="wedding"]')).not.toBeNull();
    expect(container.textContent).toContain("Starts with Plated dinner");
    expect(container.querySelector('[data-library-overview-section="packages"]')).not.toBeNull();
    expect(container.querySelector('[data-library-overview-section="packages"]').textContent).toContain("Plated dinnerActive");
    expect(container.querySelector('[data-library-overview-section="addons"]').textContent).toContain("DessertActive");
    expect(container.querySelector('[data-library-overview-section="rentals"]').textContent).toContain("LinensActive");
    expect(container.querySelector('[data-library-overview-section="templates"]').textContent).toContain("WeddingPlated · Linked items");
    expect(container.querySelector('[data-library-overview-section="pricing"]').textContent).toContain("Catalog version 7");
    expect(container.querySelector('[data-library-overview-section="pricing"]').textContent).toContain("Confirmed for current catalog");
    expect(container.querySelector('[data-library-overview-section="menu"]').getAttribute("data-library-overview-count")).toBe("0");
    expect(container.querySelector('[data-library-overview-section="menu"]').textContent).toContain("full menu is not available");
    expect(container.querySelector("[data-library-return-context]")).toBeNull();
    expect(container.querySelector("#catalog-admin-title")).toBeNull();
  });

  test("lets quote-ready sales staff continue into a new draft without claiming a saved outcome", () => {
    const onStartQuote = vi.fn(() => ({ status: "pending" }));
    mount({
      catalog: QUOTE_READY_CATALOG,
      currentUserRole: "sales",
      onStartQuote
    });

    const action = container.querySelector('[data-library-start-quote="true"]');
    expect(action).not.toBeNull();
    expect(action.textContent).toContain("Start a quote");
    expect(container.textContent).toContain("Opens a new quote draft. Nothing is saved until you complete and save it.");
    expect(container.textContent).not.toMatch(/Quote (created|saved|completed)/u);

    act(() => action.click());

    expect(onStartQuote).toHaveBeenCalledTimes(1);
  });

  test("uses the application quote-readiness authority when the Library summary is incomplete", () => {
    const onStartQuote = vi.fn();
    mount({
      catalog: CATALOG,
      currentUserRole: "admin",
      quoteCreationReady: true,
      onStartQuote
    });

    const action = container.querySelector('[data-library-start-quote="true"]');
    expect(action).not.toBeNull();
    const readiness = container.querySelector('[data-quote-ready="true"]');
    expect(readiness).not.toBeNull();
    expect(readiness.dataset.readinessState).toBe("quote-ready");

    act(() => action.click());

    expect(onStartQuote).toHaveBeenCalledTimes(1);
  });

  test("withholds the continuation when the application quote-readiness authority is false", () => {
    mount({
      catalog: QUOTE_READY_CATALOG,
      currentUserRole: "admin",
      quoteCreationReady: false,
      onStartQuote: vi.fn()
    });

    expect(container.querySelector('[data-library-start-quote="true"]')).toBeNull();
    expect(container.querySelector('[data-quote-ready="false"]')).not.toBeNull();
  });

  test("withholds the quote continuation from roles outside admin and sales", () => {
    mount({
      catalog: QUOTE_READY_CATALOG,
      currentUserRole: "viewer",
      onStartQuote: vi.fn()
    });

    expect(container.querySelector('[data-library-start-quote="true"]')).toBeNull();
  });

  test("carries exact menu-import intent from the first-quote setup path", () => {
    const navigate = vi.fn();
    navigationHarness.current = {
      navigate,
      location: { pathname: "/app/catalog", search: "", state: null }
    };
    mount({
      catalog: { ...QUOTE_READY_CATALOG, managedMenuItems: [] }
    });

    const action = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Import an existing menu"));
    expect(action).not.toBeNull();

    act(() => action.click());

    expect(navigate).toHaveBeenCalledWith(
      "/app/imports?source=library-first-quote&importType=menuItems",
      expect.objectContaining({
        preserveSearch: false,
        preserveHash: false,
        preserveReturnContext: true,
        returnContextSurfaceId: "ambient-library"
      })
    );
  });

  test("returns from contextual Library to the exact named opportunity without shortening the action", () => {
    const onReturn = vi.fn();
    const contextualOrigin = {
      label: "Rivera Wedding",
      quoteId: "quote-rivera",
      onReturn
    };
    mount({ contextualOrigin });

    const library = container.querySelector(".ambient-library");
    const returnAction = container.querySelector("[data-library-return-context]");
    expect(library.dataset.libraryContext).toBe("opportunity");
    expect(container.textContent).toContain("Working with Rivera Wedding");
    expect(returnAction.textContent).toContain("Return to Rivera Wedding");
    expect(returnAction.textContent.trim()).not.toBe("Return");

    act(() => returnAction.click());
    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(onReturn).toHaveBeenCalledWith(contextualOrigin);
  });

  test("uses Return to opportunity when contextual origin has no display name", () => {
    mount({ contextualOrigin: { quoteId: "quote-rivera", onReturn: () => {} } });

    expect(container.querySelector("[data-library-return-context]").textContent)
      .toContain("Return to opportunity");
  });

  test("keeps exact opportunity context and return action visible inside a contextual editor", async () => {
    const onReturn = vi.fn();
    const contextualOrigin = {
      label: "Rivera Wedding",
      quoteId: "quote-rivera",
      onReturn
    };
    mount({ contextualOrigin });

    act(() => container.querySelector('[data-library-action-id="review-library-menu"]').click());
    await settleEditorOpen();

    const library = container.querySelector(".ambient-library--editing");
    const returnAction = library.querySelector("[data-library-return-context]");
    expect(library.dataset.libraryContext).toBe("opportunity");
    expect(library.textContent).toContain("Working with Rivera Wedding");
    expect(returnAction.textContent).toContain("Return to Rivera Wedding");

    act(() => returnAction.click());
    expect(onReturn).toHaveBeenCalledWith(contextualOrigin);
  });

  test("acknowledges a section action immediately and opens only its exact editor context", async () => {
    mount();
    const button = container.querySelector('[data-library-action-id="review-library-packages"]');

    act(() => button.click());

    expect(container.querySelector("[data-library-acknowledgement]").dataset.resultKind).toBe("pending");
    expect(container.querySelector("[data-library-acknowledgement]").textContent).toContain("Opening Offers");
    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
    await settleEditorOpen();

    expect(container.querySelector("[data-library-acknowledgement]").textContent).toContain("ready to use");
    expect(container.querySelector('[data-testid="catalog-editor"]').dataset.surfaceTitle).toBe("Offers");
    expect(container.querySelector('[data-testid="catalog-editor"]').dataset.sectionId).toBe("packages");
    expect(container.querySelector('[data-testid="catalog-editor"]').dataset.recordId).toBe("");
  });

  test("keeps the outer editor identity synchronized with an internal section switch", async () => {
    mount();
    act(() => container.querySelector('[data-library-action-id="review-library-rules"]').click());
    await settleEditorOpen();

    expect(container.querySelector(".ambient-library__breadcrumb strong").textContent).toBe("Rules");
    expect(container.querySelector(".ambient-library--editing").dataset.libraryEditorSection).toBe("rules");

    act(() => container.querySelector('[data-testid="mock-pricing-tab"]').click());

    expect(container.querySelector(".ambient-library__breadcrumb strong").textContent).toBe("Pricing");
    expect(container.querySelector('[data-testid="catalog-editor"]').dataset.surfaceTitle).toBe("Pricing");
    expect(container.querySelector(".ambient-library--editing").dataset.libraryEditorSection).toBe("pricing");
  });

  test("consumes an exact template arrival without substituting another record", async () => {
    const onArrivalResolution = vi.fn();
    mount({
      arrivalAttempted: true,
      arrivalContext: {
        surfaceId: "ambient-library",
        intentId: "edit_event_template",
        object: { id: "wedding", type: "event-template", label: "Event template" },
        focus: { sectionId: "templates", recordId: "wedding" },
        reason: "An exact event template was selected for editing.",
        consequence: "Opening it changes no record.",
        nextResolution: "Review this template."
      },
      onArrivalResolution
    });
    await settleEditorOpen();

    expect(container.querySelector('[data-testid="catalog-editor"]').dataset.sectionId).toBe("templates");
    expect(container.querySelector('[data-testid="catalog-editor"]').dataset.recordId).toBe("wedding");
    expect(onArrivalResolution).toHaveBeenCalledWith({ status: "resolved" });
  });

  test("forwards an exact imported menu-item focus request into the admin editor", async () => {
    const onCatalogFocusResolution = vi.fn();
    mount({
      catalogFocusRequest: {
        sectionId: "menu",
        recordId: "menu-imported",
        eventTypeId: "evt-1",
        categoryId: "cat-1",
        importBatchId: "batch-1",
        sourceRowNumber: 2,
        requestId: "catalog-import:batch-1:menu-imported:2"
      },
      onCatalogFocusResolution
    });
    await settleEditorOpen();

    const editor = container.querySelector('[data-testid="catalog-editor"]');
    expect(editor.dataset.sectionId).toBe("menu");
    expect(editor.dataset.recordId).toBe("menu-imported");
    expect(onCatalogFocusResolution).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "catalog-import:batch-1:menu-imported:2",
      status: "focused"
    }));
  });

  test("keeps an imported-item focus request pending until the Library model is ready", async () => {
    const request = {
      sectionId: "menu",
      recordId: "menu-imported",
      eventTypeId: "evt-1",
      categoryId: "cat-1",
      importBatchId: "batch-1",
      sourceRowNumber: 2,
      requestId: "catalog-import:batch-1:menu-imported:2"
    };
    const onCatalogFocusResolution = vi.fn();
    mount({
      catalog: { ...CATALOG, loading: true },
      catalogFocusRequest: request,
      onCatalogFocusResolution
    });

    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
    expect(onCatalogFocusResolution).not.toHaveBeenCalled();

    mount({
      catalog: CATALOG,
      catalogFocusRequest: request,
      onCatalogFocusResolution
    });
    await settleEditorOpen();

    expect(container.querySelector('[data-testid="catalog-editor"]')?.dataset.recordId)
      .toBe("menu-imported");
    expect(onCatalogFocusResolution).toHaveBeenCalledWith(expect.objectContaining({
      requestId: request.requestId,
      status: "focused"
    }));
    expect(onCatalogFocusResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "recovery"
    }));
  });

  test("does not open an imported menu-item editor for a non-admin role", () => {
    const onCatalogFocusResolution = vi.fn();
    mount({
      currentUserRole: "sales",
      catalogFocusRequest: {
        sectionId: "menu",
        recordId: "menu-imported",
        requestId: "catalog-import:batch-1:menu-imported:2"
      },
      onCatalogFocusResolution
    });

    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
    expect(onCatalogFocusResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "recovery",
      consequence: expect.stringContaining("No catalog record")
    }));
  });

  test("closes copied import focus when the organization scope changes", async () => {
    const request = {
      sectionId: "menu",
      recordId: "menu-imported",
      eventTypeId: "evt-1",
      categoryId: "cat-1",
      requestId: "catalog-import:batch-1:menu-imported:2"
    };
    mount({ catalogFocusRequest: request, principalId: "admin-1" });
    await settleEditorOpen();

    mount({
      catalogFocusRequest: null,
      organizationId: "org-library-2",
      principalId: "admin-2"
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
    });
  });

  test("cancels an in-flight imported-item editor mount when scope changes", async () => {
    mount({
      principalId: "admin-1",
      catalogFocusRequest: {
        sectionId: "menu",
        recordId: "menu-imported",
        eventTypeId: "evt-1",
        categoryId: "cat-1",
        importBatchId: "batch-1",
        requestId: "catalog-import:batch-1:menu-imported:2"
      }
    });

    mount({
      catalogFocusRequest: null,
      organizationId: "org-library-2",
      principalId: "admin-2"
    });

    await new Promise((resolve) => window.setTimeout(resolve, 50));
    await act(async () => {});
    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
  });

  test("does not remount a stale imported-item request during a parent scope transition", async () => {
    const request = {
      sectionId: "menu",
      recordId: "menu-imported",
      eventTypeId: "evt-1",
      categoryId: "cat-1",
      importBatchId: "batch-1",
      requestId: "catalog-import:batch-1:menu-imported:2"
    };
    mount({
      organizationId: "org-library-1",
      principalId: "admin-1",
      catalogFocusRequest: request
    });

    mount({
      organizationId: "org-library-2",
      principalId: "admin-2",
      catalogFocusRequest: request
    });
    mount({
      organizationId: "org-library-2",
      principalId: "admin-2",
      catalogFocusRequest: null
    });

    await new Promise((resolve) => window.setTimeout(resolve, 50));
    await act(async () => {});
    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
  });

  test("does not finish a deferred imported-item mount after the Library route closes", async () => {
    const request = {
      sectionId: "menu",
      recordId: "menu-imported",
      eventTypeId: "evt-1",
      categoryId: "cat-1",
      importBatchId: "batch-1",
      requestId: "catalog-import:batch-1:menu-imported:2"
    };
    mount({ catalogFocusRequest: request });
    mount({ open: false, catalogFocusRequest: request });

    await new Promise((resolve) => window.setTimeout(resolve, 50));
    await act(async () => {});
    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
  });

  test("recovers truthfully when an arrived template is absent", () => {
    const onArrivalResolution = vi.fn();
    mount({
      arrivalAttempted: true,
      arrivalContext: {
        surfaceId: "ambient-library",
        intentId: "edit_event_template",
        object: { id: "missing-template", type: "event-template", label: "Event template" },
        focus: { sectionId: "templates", recordId: "missing-template" }
      },
      onArrivalResolution
    });

    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
    expect(onArrivalResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "recovery",
      reason: expect.stringContaining("not available"),
      consequence: expect.stringContaining("No different item")
    }));
    const recovery = container.querySelector('[data-library-acknowledgement][data-result-kind="recovery"]');
    expect(recovery).not.toBeNull();
    expect(recovery.textContent).toContain("The requested event template is not available");
    expect(recovery.textContent).toContain("No different item was opened");
    expect(recovery.textContent).toContain("Choose one of the Library items shown here");
  });

  test("processes a later exact arrival to the same template as a new handoff instance", async () => {
    const context = {
      surfaceId: "ambient-library",
      intentId: "edit_event_template",
      object: { id: "wedding", type: "event-template", label: "Event template" },
      focus: { sectionId: "templates", recordId: "wedding" },
      reason: "Review this exact event template.",
      consequence: "Opening it changes no record.",
      nextResolution: "Review this template."
    };
    mount({ arrivalAttempted: true, arrivalContext: context });
    await settleEditorOpen();
    act(() => container.querySelector('[data-testid="catalog-editor"] button').click());
    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();

    mount({ arrivalAttempted: true, arrivalContext: { ...context } });
    await settleEditorOpen();

    expect(container.querySelector('[data-testid="catalog-editor"]')).not.toBeNull();
  });

  test("keeps an open editor mounted while another route is active", async () => {
    mount();
    act(() => container.querySelector('[data-library-action-id="review-library-packages"]').click());
    await settleEditorOpen();

    mount({ open: false });
    const hiddenLibrary = container.querySelector('[data-library-draft-preserved="route-hidden"]');
    expect(hiddenLibrary).not.toBeNull();
    expect(hiddenLibrary.hidden).toBe(true);
    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();

    mount({ open: true });
    expect(container.querySelector('[data-testid="catalog-editor"]')).not.toBeNull();
  });

  test("keeps refresh contextual and leaves completed Library content visible", () => {
    const onReload = vi.fn();
    mount({ onReload });
    const button = container.querySelector('[data-library-action-id="refresh-library"]');

    act(() => button.click());

    expect(onReload).toHaveBeenCalledWith({ background: true });
    expect(container.querySelector("#ambient-library-title")).not.toBeNull();
    expect(container.querySelector("[data-library-acknowledgement]").textContent)
      .toContain("last completed view stays available");
  });

  test("gives sales one read-only Library main without mounting an editor", () => {
    mount({ currentUserRole: "sales" });
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.textContent).toContain("Your path to the first quote");
    expect(container.textContent).toContain("An administrator manages changes and publishing");
    expect(container.querySelector('[data-library-action-id="review-library-menu"]')).toBeNull();
    expect(container.textContent).not.toContain("View only");
    expect(container.querySelectorAll("[data-library-readonly]")).toHaveLength(1);
    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
  });

  test("shows bounded menu-cost intelligence to sales without exposing recipe mutation", () => {
    mount({
      currentUserRole: "sales",
      inventoryRecipeExtension: {
        enabled: true,
        menuCostProjections: [{
          menuItemId: "menu-chicken",
          menuItemName: "Chicken dinner",
          state: "partial",
          costPerYieldUnitDisplay: "$2.10 / portion"
        }]
      }
    });

    expect(container.querySelector("[data-menu-cost-summary]")).not.toBeNull();
    expect(container.textContent).toContain("Chicken dinner");
    expect(container.textContent).toContain("Partial · $2.10 / portion");
    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
  });

  test("forwards the prop-gated recipe authority seam to the exact menu editor", async () => {
    mount({ inventoryRecipeExtension: { enabled: true } });
    act(() => container.querySelector('[data-library-action-id="review-library-menu"]').click());
    await settleEditorOpen();

    expect(container.querySelector('[data-testid="catalog-editor"]').dataset.recipeExtension).toBe("enabled");
  });
});

test("workflow Studio Library entry requires enabled connected administrator scope", () => {
  mount({ principalId: "admin-one", workflowStudioEnabled: true, workflowSource: "firebase" });
  expect(container.querySelector('[data-workflow-studio-entry="library"]')).not.toBeNull();
  expect(container.querySelector('[data-library-record-id="workflow"] h3').textContent).toBe("Business workflows");
  expect(container.querySelector('[data-library-record-id="workflow"]').textContent).toContain("quote approval, final guest count, event execution, and closeout follow-up");
  mount({ principalId: "admin-one", workflowStudioEnabled: true, workflowSource: "firebase", currentUserRole: "sales" });
  expect(container.querySelector('[data-workflow-studio-entry="library"]')).toBeNull();
  mount({ principalId: "admin-one", workflowStudioEnabled: false, workflowSource: "firebase" });
  expect(container.querySelector('[data-workflow-studio-entry="library"]')).toBeNull();
  mount({ principalId: "admin-one", workflowStudioEnabled: true, workflowSource: "local" });
  expect(container.querySelector('[data-workflow-studio-entry="library"]')).toBeNull();
});
