// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
        >
          Catalog editor
          <button type="button" onClick={props.onClose}>Back</button>
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
  test("renders a purpose-bearing Library with Catalog and first-class Templates", () => {
    mount();

    const library = container.querySelector(".ambient-library");
    expect(library.dataset.surfaceContractId).toBe("ambient-library");
    expect(library.dataset.libraryContext).toBe("standalone");
    expect(container.querySelector("#ambient-library-title").textContent).toBe("The choices behind every quote.");
    expect(container.textContent).toContain("Packages, menus, services, rentals, templates, and pricing");
    expect(container.querySelector('[data-library-section="catalog"]')).not.toBeNull();
    expect(container.querySelector('[data-library-section="templates"]')).not.toBeNull();
    expect(container.querySelector('[data-library-record-kind="event-template"][data-library-record-id="wedding"]')).not.toBeNull();
    expect(container.querySelector("[data-library-return-context]")).toBeNull();
    expect(container.querySelector("#catalog-admin-title")).toBeNull();
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
    expect(container.querySelector("[data-library-acknowledgement]").textContent).toContain("Opening Packages");
    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
    await settleEditorOpen();

    expect(container.querySelector("[data-library-acknowledgement]").textContent).toContain("ready to review");
    expect(container.querySelector('[data-testid="catalog-editor"]').dataset.sectionId).toBe("packages");
    expect(container.querySelector('[data-testid="catalog-editor"]').dataset.recordId).toBe("");
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
    expect(container.textContent).toContain("Business Setup Center");
    expect(container.querySelector('[data-library-action-id="review-library-menu"]').disabled).toBe(true);
    expect(container.querySelector('[data-testid="catalog-editor"]')).toBeNull();
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
